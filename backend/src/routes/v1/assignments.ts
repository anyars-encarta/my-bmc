import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  jobRole,
  orgUnit,
  rosterEntry,
  session,
  shiftType,
  staff,
  staffAssignment,
  transferBatch,
  transferBatchItem,
  unitStaffingRequirement,
  user,
  workforceEvent,
} from "../../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { isRetroactiveAssignmentDate, resolveEffectiveAssignment } from "../../lib/assignmentRules.js";
import { isAppRole, requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";
import { nowAtFacility } from "../../lib/facilityClock.js";

const router = Router();

const HR_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"] as const;
const READ_ROLES = [
  "SUPER_ADMIN",
  "HOSPITAL_ADMIN",
  "HR_MANAGER",
  "PAYROLL_OFFICER",
  "UNIT_MANAGER",
  "ROSTER_OFFICER",
] as const;

const assignmentReason = z.enum([
  "INITIAL",
  "TRANSFER",
  "RESHUFFLE",
  "SECONDMENT",
  "COVER",
  "PROMOTION",
  "RETURN",
]);
const transferSchema = z.object({
  toUnitId: z.string().uuid(),
  effectiveFrom: z.string().date(),
  reason: z.enum(["TRANSFER", "RESHUFFLE", "PROMOTION", "RETURN"]).default("TRANSFER"),
  note: z.string().trim().max(1000).optional(),
});
const temporaryAssignmentSchema = z.object({
  orgUnitId: z.string().uuid(),
  assignmentType: z.enum(["TEMPORARY", "COVER"]),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date(),
  reason: z.enum(["SECONDMENT", "COVER"]).optional(),
  note: z.string().trim().max(1000).optional(),
});
const batchItemSchema = z.object({
  staffId: z.string().uuid(),
  toUnitId: z.string().uuid(),
  reason: z.enum(["RESHUFFLE", "TRANSFER", "PROMOTION", "RETURN"]).default("RESHUFFLE"),
  note: z.string().trim().max(1000).optional(),
});
const batchPayloadSchema = z.object({
  title: z.string().trim().min(1).max(150),
  effectiveFrom: z.string().date(),
  items: z.array(batchItemSchema).min(1).max(500),
});
const staffingRequirementSchema = z.object({
  orgUnitId: z.string().uuid(),
  shiftTypeId: z.string().uuid(),
  jobRoleId: z.string().uuid().nullable().optional(),
  minStaff: z.number().int().min(0).max(10000),
});

type DatabaseExecutor = typeof db;
type AssignmentRow = {
  id: string;
  staffId: string;
  orgUnitId: string;
  assignmentType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const parseRouteId = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const facilityToday = async () => (await nowAtFacility()).localDateTime.slice(0, 10);
const previousDate = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};
const ensureNonRetroactive = async (date: string) => {
  if (isRetroactiveAssignmentDate(date, await facilityToday())) {
    throw validationError("Assignment dates cannot be in the past.", "ASSIGNMENT_DATE_IN_PAST");
  }
};

const getAssignmentOn = async (executor: DatabaseExecutor, staffId: string, date: string) =>
  executor
    .select()
    .from(staffAssignment)
    .where(
      and(
        eq(staffAssignment.staffId, staffId),
        eq(staffAssignment.assignmentType, "PRIMARY"),
        lte(staffAssignment.effectiveFrom, date),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, date)),
      ),
    )
    .orderBy(desc(staffAssignment.effectiveFrom))
    .limit(1);

const validateStaffAndUnit = async (
  executor: DatabaseExecutor,
  staffId: string,
  orgUnitId: string,
) => {
  const [person] = await executor
    .select({ id: staff.id, status: staff.status })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!person) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
  if (person.status !== "active") {
    throw validationError("Inactive staff cannot be assigned.", "STAFF_INACTIVE");
  }

  const [unit] = await executor
    .select({ id: orgUnit.id, active: orgUnit.active })
    .from(orgUnit)
    .where(eq(orgUnit.id, orgUnitId))
    .limit(1);
  if (!unit || !unit.active) {
    throw validationError("The destination org unit is not active.", "ORG_UNIT_INACTIVE");
  }
};

export const transferPrimary = async (
  executor: DatabaseExecutor,
  input: {
    staffId: string;
    toUnitId: string;
    effectiveFrom: string;
    reason: z.infer<typeof assignmentReason>;
    note?: string;
    batchId?: string;
    actorId?: string;
  },
) => {
  await ensureNonRetroactive(input.effectiveFrom);
  await validateStaffAndUnit(executor, input.staffId, input.toUnitId);

  if (input.batchId) {
    const [alreadyApplied] = await executor
      .select()
      .from(staffAssignment)
      .where(and(
        eq(staffAssignment.staffId, input.staffId),
        eq(staffAssignment.transferBatchId, input.batchId),
        eq(staffAssignment.effectiveFrom, input.effectiveFrom),
      ))
      .limit(1);
    if (alreadyApplied) {
      if (alreadyApplied.orgUnitId !== input.toUnitId) {
        throw conflict("A different transfer for this batch is already applied.", "TRANSFER_BATCH_ITEM_ALREADY_APPLIED");
      }
      return alreadyApplied;
    }
  }

  const [current] = await getAssignmentOn(executor, input.staffId, input.effectiveFrom);
  if (!current) throw validationError("No primary assignment exists on that date.", "NO_CURRENT_ASSIGNMENT");
  if (current.orgUnitId === input.toUnitId) {
    throw validationError("Staff member is already assigned to that unit.", "ALREADY_ASSIGNED_TO_UNIT");
  }

  const dateBeforeTransfer = previousDate(input.effectiveFrom);
  const [previous] = await getAssignmentOn(executor, input.staffId, dateBeforeTransfer);
  if (!previous) {
    throw validationError(
      "A transfer must begin after the current primary assignment starts.",
      "EFFECTIVE_DATE_NOT_AFTER_CURRENT_ASSIGNMENT_START",
    );
  }

  const [closedPrevious] = await executor
    .update(staffAssignment)
    .set({ effectiveTo: dateBeforeTransfer })
    .where(and(
      eq(staffAssignment.id, previous.id),
      previous.effectiveTo === null
        ? isNull(staffAssignment.effectiveTo)
        : eq(staffAssignment.effectiveTo, previous.effectiveTo),
    ))
    .returning({ id: staffAssignment.id });
  if (!closedPrevious) {
    throw conflict("The primary assignment changed while the transfer was being applied.", "ASSIGNMENT_CHANGED_RETRY");
  }

  let removedAssignments: typeof staffAssignment.$inferSelect[] = [];
  let nextAssignment: typeof staffAssignment.$inferSelect | undefined;
  let updatedRoster: Array<{ id: string; orgUnitId: string }> = [];
  try {
    removedAssignments = await executor
      .delete(staffAssignment)
      .where(
        and(
          eq(staffAssignment.staffId, input.staffId),
          eq(staffAssignment.assignmentType, "PRIMARY"),
          gte(staffAssignment.effectiveFrom, input.effectiveFrom),
        ),
      )
      .returning();

    const [created] = await executor
      .insert(staffAssignment)
      .values({
        staffId: input.staffId,
        orgUnitId: input.toUnitId,
        assignmentType: "PRIMARY",
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        note: input.note ?? null,
        approvedBy: input.actorId ?? null,
        approvedAt: new Date(),
        transferBatchId: input.batchId ?? null,
      })
      .returning();
    if (!created) throw badRequest("Unable to create the new primary assignment.", "ASSIGNMENT_CREATE_FAILED");
    nextAssignment = created;

    updatedRoster = await executor
      .update(rosterEntry)
      .set({ orgUnitId: input.toUnitId })
      .where(
        and(
          eq(rosterEntry.staffId, input.staffId),
          eq(rosterEntry.status, "ACTIVE"),
          ne(rosterEntry.source, "COVER"),
          gte(rosterEntry.rosterDate, input.effectiveFrom),
        ),
      )
      .returning({ id: rosterEntry.id, orgUnitId: rosterEntry.orgUnitId });

    await executor.insert(workforceEvent).values({
      eventType: "StaffTransferred",
      aggregateId: input.staffId,
      payload: {
        staffId: input.staffId,
        fromUnitId: previous.orgUnitId,
        toUnitId: input.toUnitId,
        effectiveFrom: input.effectiveFrom,
        transferBatchId: input.batchId ?? null,
      },
    });

    return created;
  } catch (error) {
    try {
      for (const entry of updatedRoster) {
        await executor.update(rosterEntry).set({ orgUnitId: entry.orgUnitId }).where(eq(rosterEntry.id, entry.id));
      }
      if (nextAssignment) {
        await executor.delete(staffAssignment).where(eq(staffAssignment.id, nextAssignment.id));
      }
      if (removedAssignments.length > 0) {
        await executor.insert(staffAssignment).values(removedAssignments);
      }
      await executor
        .update(staffAssignment)
        .set({ effectiveTo: previous.effectiveTo })
        .where(and(
          eq(staffAssignment.id, previous.id),
          eq(staffAssignment.effectiveTo, dateBeforeTransfer),
        ));
    } catch (compensationError) {
      console.error("Unable to roll back a partially applied staff transfer:", compensationError);
    }
    throw error;
  }
};

const checkManagedStaff = async (
  userId: string | undefined,
  roles: string[] | undefined,
  staffId: string,
) => {
  const appRoles = (roles ?? []).filter(isAppRole);
  const managedIds = userId ? await resolveManagedUnitIds(userId, appRoles) : [];
  if (managedIds === null) return;
  if (managedIds.length === 0) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }

  const today = await facilityToday();
  const [assignment] = await db
    .select({ orgUnitId: staffAssignment.orgUnitId })
    .from(staffAssignment)
    .where(
      and(
        eq(staffAssignment.staffId, staffId),
        eq(staffAssignment.assignmentType, "PRIMARY"),
        lte(staffAssignment.effectiveFrom, today),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, today)),
      ),
    )
    .orderBy(desc(staffAssignment.effectiveFrom))
    .limit(1);
  if (!assignment || !managedIds.includes(assignment.orgUnitId)) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }
};

router.get(
  "/staff/:staffId/assignments",
  requireAnyRole([...READ_ROLES]),
  async (req, res, next) => {
    try {
      const staffId = parseRouteId(req.params.staffId);
      if (!staffId) throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
      await checkManagedStaff(req.user?.id, req.user?.roles, staffId);
      const records = await db
        .select({
          id: staffAssignment.id,
          orgUnitId: staffAssignment.orgUnitId,
          unitName: orgUnit.name,
          unitCode: orgUnit.code,
          assignmentType: staffAssignment.assignmentType,
          effectiveFrom: staffAssignment.effectiveFrom,
          effectiveTo: staffAssignment.effectiveTo,
          reason: staffAssignment.reason,
          note: staffAssignment.note,
          transferBatchId: staffAssignment.transferBatchId,
        })
        .from(staffAssignment)
        .innerJoin(orgUnit, eq(orgUnit.id, staffAssignment.orgUnitId))
        .where(eq(staffAssignment.staffId, staffId))
        .orderBy(desc(staffAssignment.effectiveFrom), asc(staffAssignment.assignmentType));
      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/staff/:staffId/effective-unit",
  requireAnyRole([...READ_ROLES]),
  async (req, res, next) => {
    try {
      const staffId = parseRouteId(req.params.staffId);
      if (!staffId) throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
      const date = typeof req.query.on === "string" ? req.query.on : await facilityToday();
      if (!z.string().date().safeParse(date).success) {
        throw validationError("Provide a valid date in YYYY-MM-DD format.", "INVALID_DATE");
      }
      await checkManagedStaff(req.user?.id, req.user?.roles, staffId);
      const records = await db
        .select({
          id: staffAssignment.id,
          orgUnitId: staffAssignment.orgUnitId,
          unitName: orgUnit.name,
          unitCode: orgUnit.code,
          assignmentType: staffAssignment.assignmentType,
          effectiveFrom: staffAssignment.effectiveFrom,
          effectiveTo: staffAssignment.effectiveTo,
        })
        .from(staffAssignment)
        .innerJoin(orgUnit, eq(orgUnit.id, staffAssignment.orgUnitId))
        .where(
          and(
            eq(staffAssignment.staffId, staffId),
            lte(staffAssignment.effectiveFrom, date),
            or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, date)),
          ),
        )
        .orderBy(desc(staffAssignment.effectiveFrom));
      const effective = resolveEffectiveAssignment(records);
      res.json({ data: { on: date, assignment: effective } });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/staff/:staffId/transfers",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const staffId = parseRouteId(req.params.staffId);
      if (!staffId) throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const created = await transferPrimary(db, {
        staffId,
        toUnitId: parsed.data.toUnitId,
        effectiveFrom: parsed.data.effectiveFrom,
        reason: parsed.data.reason,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(req.user?.id ? { actorId: req.user.id } : {}),
      });
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/staff/:staffId/assignments",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const staffId = parseRouteId(req.params.staffId);
      if (!staffId) throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
      const parsed = temporaryAssignmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const { effectiveFrom, effectiveTo, assignmentType } = parsed.data;
      await ensureNonRetroactive(effectiveFrom);
      if (effectiveTo < effectiveFrom) {
        throw validationError("End date must be on or after the start date.", "ASSIGNMENT_DATE_RANGE_INVALID");
      }
      await validateStaffAndUnit(db, staffId, parsed.data.orgUnitId);
      const [created] = await db
        .insert(staffAssignment)
        .values({
          staffId,
          orgUnitId: parsed.data.orgUnitId,
          assignmentType,
          effectiveFrom,
          effectiveTo,
          reason: parsed.data.reason ?? (assignmentType === "COVER" ? "COVER" : "SECONDMENT"),
          note: parsed.data.note ?? null,
          approvedBy: req.user?.id ?? null,
          approvedAt: new Date(),
        })
        .returning();
      if (!created) throw badRequest("Unable to create the assignment.", "ASSIGNMENT_CREATE_FAILED");
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

const loadBatch = async (batchId: string) => {
  const [batch] = await db.select().from(transferBatch).where(eq(transferBatch.id, batchId)).limit(1);
  if (!batch) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
  const items = await db
    .select({
      id: transferBatchItem.id,
      staffId: transferBatchItem.staffId,
      staffName: staff.firstName,
      staffLastName: staff.lastName,
      employeeId: staff.employeeId,
      toUnitId: transferBatchItem.toOrgUnitId,
      toUnitName: orgUnit.name,
      toUnitCode: orgUnit.code,
      reason: transferBatchItem.reason,
      note: transferBatchItem.note,
    })
    .from(transferBatchItem)
    .innerJoin(staff, eq(staff.id, transferBatchItem.staffId))
    .innerJoin(orgUnit, eq(orgUnit.id, transferBatchItem.toOrgUnitId))
    .where(eq(transferBatchItem.transferBatchId, batchId))
    .orderBy(asc(staff.lastName), asc(staff.firstName));
  return { ...batch, items };
};

const validateBatchItems = async (
  executor: DatabaseExecutor,
  items: z.infer<typeof batchItemSchema>[],
  effectiveFrom: string,
) => {
  if (new Set(items.map((item) => item.staffId)).size !== items.length) {
    throw validationError("A staff member can only appear once in a batch.", "TRANSFER_BATCH_DUPLICATE_STAFF");
  }
  for (const item of items) {
    await validateStaffAndUnit(executor, item.staffId, item.toUnitId);
    const [current] = await getAssignmentOn(executor, item.staffId, effectiveFrom);
    if (!current) {
      throw validationError(
        "Every staff member must have a primary assignment on the effective date.",
        "NO_CURRENT_ASSIGNMENT",
        { staffId: item.staffId },
      );
    }
    if (current.orgUnitId === item.toUnitId) {
      throw validationError(
        "A move must change the staff member's assigned unit.",
        "ALREADY_ASSIGNED_TO_UNIT",
        { staffId: item.staffId },
      );
    }
  }
};

const previewBatch = async (batchId: string) => {
  const [batch] = await db.select().from(transferBatch).where(eq(transferBatch.id, batchId)).limit(1);
  if (!batch) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
  const items = await db
    .select({
      staffId: transferBatchItem.staffId,
      toUnitId: transferBatchItem.toOrgUnitId,
      staffName: staff.firstName,
      staffLastName: staff.lastName,
      employeeId: staff.employeeId,
      fromUnitId: staffAssignment.orgUnitId,
    })
    .from(transferBatchItem)
    .innerJoin(staff, eq(staff.id, transferBatchItem.staffId))
    .leftJoin(
      staffAssignment,
      and(
        eq(staffAssignment.staffId, transferBatchItem.staffId),
        eq(staffAssignment.assignmentType, "PRIMARY"),
        lte(staffAssignment.effectiveFrom, batch.effectiveFrom),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, batch.effectiveFrom)),
      ),
    )
    .where(eq(transferBatchItem.transferBatchId, batchId));
  const activeAssignments = await db
    .select({
      staffId: staffAssignment.staffId,
      orgUnitId: staffAssignment.orgUnitId,
      assignmentType: staffAssignment.assignmentType,
      effectiveFrom: staffAssignment.effectiveFrom,
      effectiveTo: staffAssignment.effectiveTo,
      jobRoleId: staff.jobRoleId,
    })
    .from(staffAssignment)
    .innerJoin(staff, eq(staff.id, staffAssignment.staffId))
    .where(
      and(
        eq(staff.status, "active"),
        lte(staffAssignment.effectiveFrom, batch.effectiveFrom),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, batch.effectiveFrom)),
      ),
    );
  const destinationByStaff = new Map(items.map((item) => [item.staffId, item.toUnitId]));
  const currentByStaff = new Map<string, (typeof activeAssignments)[number]>();
  const assignmentsByStaff = new Map<string, (typeof activeAssignments)>();
  for (const assignment of activeAssignments) {
    const current = assignmentsByStaff.get(assignment.staffId) ?? [];
    current.push(assignment);
    assignmentsByStaff.set(assignment.staffId, current);
  }
  for (const [staffId, assignments] of assignmentsByStaff) {
    const effective = resolveEffectiveAssignment(assignments);
    if (effective) currentByStaff.set(staffId, effective);
  }
  const affectedUnitIds = new Set<string>();
  for (const item of items) {
    if (item.fromUnitId) affectedUnitIds.add(item.fromUnitId);
    affectedUnitIds.add(item.toUnitId);
  }
  const affectedIds = [...affectedUnitIds];
  if (affectedIds.length === 0) {
    return { batchId, effectiveFrom: batch.effectiveFrom, moves: items, coverage: [] };
  }
  const [requirements, units, shifts, roles] = await Promise.all([
    db
      .select()
      .from(unitStaffingRequirement)
      .where(inArray(unitStaffingRequirement.orgUnitId, affectedIds)),
    db.select({ id: orgUnit.id, name: orgUnit.name, code: orgUnit.code }).from(orgUnit)
      .where(inArray(orgUnit.id, affectedIds)),
    db.select({ id: shiftType.id, name: shiftType.name }).from(shiftType),
    db.select({ id: jobRole.id, name: jobRole.name }).from(jobRole),
  ]);
  const unitLabels = new Map(units.map((unit) => [unit.id, `${unit.name} (${unit.code})`]));
  const shiftLabels = new Map(shifts.map((shift) => [shift.id, shift.name]));
  const roleLabels = new Map(roles.map((role) => [role.id, role.name]));
  const shiftIds = [...new Set(requirements.map((requirement) => requirement.shiftTypeId))];
  const rosteredStaff = shiftIds.length > 0
    ? await db
        .select({
          staffId: rosterEntry.staffId,
          orgUnitId: rosterEntry.orgUnitId,
          shiftTypeId: rosterEntry.shiftTypeId,
        })
        .from(rosterEntry)
        .where(
          and(
            eq(rosterEntry.rosterDate, batch.effectiveFrom),
            eq(rosterEntry.status, "ACTIVE"),
            inArray(rosterEntry.shiftTypeId, shiftIds),
          ),
        )
    : [];
  const countAt = (
    unitId: string,
    shiftTypeId: string,
    roleId: string | null,
    projected: boolean,
  ) => {
    const countedStaff = new Set<string>();
    for (const rostered of rosteredStaff) {
      if (rostered.shiftTypeId !== shiftTypeId) continue;
      const assignment = currentByStaff.get(rostered.staffId);
      if (!assignment || (roleId !== null && assignment.jobRoleId !== roleId)) continue;
      const unitIdForStaff = projected && assignment.assignmentType === "PRIMARY"
        ? destinationByStaff.get(rostered.staffId) ?? rostered.orgUnitId
        : rostered.orgUnitId;
      if (unitIdForStaff === unitId) countedStaff.add(rostered.staffId);
    }
    return countedStaff.size;
  };
  const coverage = requirements.map((requirement) => {
    const currentStaff = countAt(
      requirement.orgUnitId,
      requirement.shiftTypeId,
      requirement.jobRoleId,
      false,
    );
    const projectedStaff = countAt(
      requirement.orgUnitId,
      requirement.shiftTypeId,
      requirement.jobRoleId,
      true,
    );
    return {
      unitName: unitLabels.get(requirement.orgUnitId) ?? "Org unit",
      shiftName: shiftLabels.get(requirement.shiftTypeId) ?? "Shift",
      roleName: requirement.jobRoleId ? roleLabels.get(requirement.jobRoleId) ?? "Role" : "All roles",
      minimum: requirement.minStaff,
      currentStaff,
      projectedStaff,
      currentShortfall: Math.max(0, requirement.minStaff - currentStaff),
      projectedShortfall: Math.max(0, requirement.minStaff - projectedStaff),
      impact: projectedStaff > currentStaff ? "IMPROVED" : projectedStaff < currentStaff ? "REDUCED" : "UNCHANGED",
    };
  });

  return {
    batchId,
    title: batch.title,
    effectiveFrom: batch.effectiveFrom,
    moves: items.map((item) => ({
      staffName: `${item.staffName} ${item.staffLastName}`,
      employeeId: item.employeeId,
      fromUnit: item.fromUnitId ? unitLabels.get(item.fromUnitId) ?? "Unassigned" : "Unassigned",
      toUnit: unitLabels.get(item.toUnitId) ?? "Org unit",
    })),
    coverage,
  };
};

router.get("/transfer-batches", requireAnyRole([...HR_ROLES]), async (_req, res, next) => {
  try {
    const batches = await db.select().from(transferBatch).orderBy(desc(transferBatch.effectiveFrom));
    const data = await Promise.all(batches.map((batch) => loadBatch(batch.id)));
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/transfer-batches", requireAnyRole([...HR_ROLES]), async (req, res, next) => {
  try {
    const parsed = batchPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    await ensureNonRetroactive(parsed.data.effectiveFrom);
    await validateBatchItems(db, parsed.data.items, parsed.data.effectiveFrom);
    const [batch] = await db
      .insert(transferBatch)
      .values({ title: parsed.data.title, effectiveFrom: parsed.data.effectiveFrom })
      .returning();
    if (!batch) throw badRequest("Unable to create transfer batch.", "TRANSFER_BATCH_CREATE_FAILED");
    try {
      await db.insert(transferBatchItem).values(
        parsed.data.items.map((item) => ({
          transferBatchId: batch.id,
          staffId: item.staffId,
          toOrgUnitId: item.toUnitId,
          reason: item.reason,
          note: item.note ?? null,
        })),
      );
    } catch (error) {
      try {
        await db.delete(transferBatch).where(eq(transferBatch.id, batch.id));
      } catch (compensationError) {
        console.error("Unable to remove a transfer batch after its items failed to save:", compensationError);
      }
      throw error;
    }
    res.status(201).json({ data: await loadBatch(batch.id) });
  } catch (error) {
    next(error);
  }
});

router.patch("/transfer-batches/:id", requireAnyRole([...HR_ROLES]), async (req, res, next) => {
  try {
    const batchId = parseRouteId(req.params.id);
    if (!batchId) throw badRequest("Transfer batch ID is required.", "TRANSFER_BATCH_ID_REQUIRED");
    const parsed = batchPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    await ensureNonRetroactive(parsed.data.effectiveFrom);
    const [existing] = await db
      .select()
      .from(transferBatch)
      .where(eq(transferBatch.id, batchId))
      .limit(1);
    if (!existing) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
    if (existing.status !== "DRAFT") {
      throw conflict("Only draft batches can be edited.", "TRANSFER_BATCH_NOT_DRAFT");
    }
    await validateBatchItems(db, parsed.data.items, parsed.data.effectiveFrom);
    const previousItems = await db
      .select()
      .from(transferBatchItem)
      .where(eq(transferBatchItem.transferBatchId, batchId));
    const [updated] = await db
      .update(transferBatch)
      .set({ title: parsed.data.title, effectiveFrom: parsed.data.effectiveFrom })
      .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "DRAFT")))
      .returning();
    if (!updated) {
      throw conflict("Only draft batches can be edited.", "TRANSFER_BATCH_NOT_DRAFT");
    }
    try {
      await db.delete(transferBatchItem).where(eq(transferBatchItem.transferBatchId, batchId));
      await db.insert(transferBatchItem).values(
        parsed.data.items.map((item) => ({
          transferBatchId: batchId,
          staffId: item.staffId,
          toOrgUnitId: item.toUnitId,
          reason: item.reason,
          note: item.note ?? null,
        })),
      );
    } catch (error) {
      try {
        await db.delete(transferBatchItem).where(eq(transferBatchItem.transferBatchId, batchId));
        if (previousItems.length > 0) {
          await db.insert(transferBatchItem).values(previousItems);
        }
        await db
          .update(transferBatch)
          .set({ title: existing.title, effectiveFrom: existing.effectiveFrom })
          .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "DRAFT")));
      } catch (compensationError) {
        console.error("Unable to restore a transfer batch after its items failed to update:", compensationError);
      }
      throw error;
    }
    res.json({ data: await loadBatch(updated.id) });
  } catch (error) {
    next(error);
  }
});

router.get("/transfer-batches/:id/preview", requireAnyRole([...HR_ROLES]), async (req, res, next) => {
  try {
    const batchId = parseRouteId(req.params.id);
    if (!batchId) throw badRequest("Transfer batch ID is required.", "TRANSFER_BATCH_ID_REQUIRED");
    res.json({ data: await previewBatch(batchId) });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/transfer-batches/:id/approve",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const batchId = parseRouteId(req.params.id);
      if (!batchId) throw badRequest("Transfer batch ID is required.", "TRANSFER_BATCH_ID_REQUIRED");
      const [batch] = await db
        .select()
        .from(transferBatch)
        .where(eq(transferBatch.id, batchId))
        .limit(1);
      if (!batch) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
      if (batch.status !== "DRAFT") {
        throw conflict("Only draft batches can be approved.", "TRANSFER_BATCH_NOT_DRAFT");
      }
      await ensureNonRetroactive(batch.effectiveFrom);
      const items = await db
        .select()
        .from(transferBatchItem)
        .where(eq(transferBatchItem.transferBatchId, batchId));
      if (items.length === 0) {
        throw validationError("A batch must contain at least one move.", "TRANSFER_BATCH_EMPTY");
      }
      await validateBatchItems(
        db,
        items.map((item) => ({
          staffId: item.staffId,
          toUnitId: item.toOrgUnitId,
          reason: item.reason as z.infer<typeof batchItemSchema>["reason"],
          ...(item.note ? { note: item.note } : {}),
        })),
        batch.effectiveFrom,
      );
      const [updated] = await db
        .update(transferBatch)
        .set({ status: "APPROVED", approvedBy: req.user?.id ?? null, approvedAt: new Date() })
        .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "DRAFT")))
        .returning({ id: transferBatch.id });
      if (!updated) {
        const [existing] = await db.select({ id: transferBatch.id }).from(transferBatch)
          .where(eq(transferBatch.id, batchId)).limit(1);
        if (!existing) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
        throw conflict("Only draft batches can be approved.", "TRANSFER_BATCH_NOT_DRAFT");
      }
      res.json({ data: await loadBatch(batchId) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/transfer-batches/:id/cancel",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const batchId = parseRouteId(req.params.id);
      if (!batchId) throw badRequest("Transfer batch ID is required.", "TRANSFER_BATCH_ID_REQUIRED");
      const [updated] = await db
        .update(transferBatch)
        .set({ status: "CANCELLED" })
        .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "APPROVED")))
        .returning({ id: transferBatch.id });
      if (!updated) {
        const [existing] = await db
          .select({ id: transferBatch.id })
          .from(transferBatch)
          .where(eq(transferBatch.id, batchId))
          .limit(1);
        if (!existing) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
        throw conflict("Only approved batches can be cancelled.", "TRANSFER_BATCH_NOT_APPROVED");
      }
      res.json({ data: await loadBatch(batchId) });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/transfer-batches/:id/apply", requireAnyRole([...HR_ROLES]), async (req, res, next) => {
  try {
    const batchId = parseRouteId(req.params.id);
    if (!batchId) throw badRequest("Transfer batch ID is required.", "TRANSFER_BATCH_ID_REQUIRED");
    const [batch] = await db
      .select()
      .from(transferBatch)
      .where(eq(transferBatch.id, batchId))
      .limit(1);
    if (!batch) throw notFound("Transfer batch not found.", "TRANSFER_BATCH_NOT_FOUND");
    if (batch.status !== "APPROVED") {
      throw conflict("Only approved batches can be applied.", "TRANSFER_BATCH_NOT_APPROVED");
    }
    const [claimed] = await db
      .update(transferBatch)
      .set({ status: "APPLYING" })
      .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "APPROVED")))
      .returning({ id: transferBatch.id });
    if (!claimed) {
      throw conflict("The transfer batch status changed before it could be applied.", "TRANSFER_BATCH_NOT_APPROVED");
    }

    try {
      const items = await db
        .select()
        .from(transferBatchItem)
        .where(eq(transferBatchItem.transferBatchId, batchId))
        .orderBy(asc(transferBatchItem.id));
      if (items.length === 0) {
        throw validationError("A batch must contain at least one move.", "TRANSFER_BATCH_EMPTY");
      }
      for (const item of items) {
        await transferPrimary(db, {
          staffId: item.staffId,
          toUnitId: item.toOrgUnitId,
          effectiveFrom: batch.effectiveFrom,
          reason: item.reason as z.infer<typeof assignmentReason>,
          ...(item.note !== null ? { note: item.note } : {}),
          batchId,
          ...(req.user?.id ? { actorId: req.user.id } : {}),
        });
      }
      const [applied] = await db
        .update(transferBatch)
        .set({ status: "APPLIED" })
        .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "APPLYING")))
        .returning({ id: transferBatch.id });
      if (!applied) {
        throw conflict("The transfer batch status changed while it was being applied.", "TRANSFER_BATCH_STATUS_CHANGED");
      }
    } catch (error) {
      try {
        await db
          .update(transferBatch)
          .set({ status: "APPROVED" })
          .where(and(eq(transferBatch.id, batchId), eq(transferBatch.status, "APPLYING")));
      } catch (compensationError) {
        console.error("Unable to restore an interrupted transfer batch to APPROVED:", compensationError);
      }
      throw error;
    }
    res.json({ data: await loadBatch(batchId) });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/unit-staffing-requirements",
  requireAnyRole([...READ_ROLES]),
  async (req, res, next) => {
    try {
      const roles = (req.user?.roles ?? []).filter(isAppRole);
      const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, roles) : [];
      if (managedIds !== null && managedIds.length === 0) {
        res.json({ data: [] });
        return;
      }
      const records = await db
        .select({
          id: unitStaffingRequirement.id,
          orgUnitId: unitStaffingRequirement.orgUnitId,
          unitName: orgUnit.name,
          unitCode: orgUnit.code,
          shiftTypeId: unitStaffingRequirement.shiftTypeId,
          shiftName: shiftType.name,
          jobRoleId: unitStaffingRequirement.jobRoleId,
          roleName: jobRole.name,
          minStaff: unitStaffingRequirement.minStaff,
        })
        .from(unitStaffingRequirement)
        .innerJoin(orgUnit, eq(orgUnit.id, unitStaffingRequirement.orgUnitId))
        .innerJoin(shiftType, eq(shiftType.id, unitStaffingRequirement.shiftTypeId))
        .leftJoin(jobRole, eq(jobRole.id, unitStaffingRequirement.jobRoleId))
        .where(managedIds === null ? undefined : inArray(unitStaffingRequirement.orgUnitId, managedIds))
        .orderBy(asc(orgUnit.name), asc(shiftType.name), asc(jobRole.name));
      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/unit-staffing-requirements",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const parsed = staffingRequirementSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const [created] = await db
        .insert(unitStaffingRequirement)
        .values({ ...parsed.data, jobRoleId: parsed.data.jobRoleId ?? null })
        .returning();
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/unit-staffing-requirements/:id",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const id = parseRouteId(req.params.id);
      if (!id) throw badRequest("Requirement ID is required.", "STAFFING_REQUIREMENT_ID_REQUIRED");
      const parsed = staffingRequirementSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      if (Object.keys(parsed.data).length === 0) {
        throw validationError("At least one field is required.", "EMPTY_UPDATE");
      }
      const [updated] = await db
        .update(unitStaffingRequirement)
        .set(parsed.data)
        .where(eq(unitStaffingRequirement.id, id))
        .returning();
      if (!updated) throw notFound("Staffing requirement not found.", "STAFFING_REQUIREMENT_NOT_FOUND");
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/unit-staffing-requirements/:id",
  requireAnyRole([...HR_ROLES]),
  async (req, res, next) => {
    try {
      const id = parseRouteId(req.params.id);
      if (!id) throw badRequest("Requirement ID is required.", "STAFFING_REQUIREMENT_ID_REQUIRED");
      const [deleted] = await db
        .delete(unitStaffingRequirement)
        .where(eq(unitStaffingRequirement.id, id))
        .returning();
      if (!deleted) throw notFound("Staffing requirement not found.", "STAFFING_REQUIREMENT_NOT_FOUND");
      res.json({ data: deleted });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
