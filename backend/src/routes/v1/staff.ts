import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, notExists, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  insertStaffSchema,
  consent,
  jobRole,
  orgUnit,
  rosterEntry,
  shiftType,
  staff,
  staffAssignment,
  staffCredential,
  staffLicense,
  updateStaffSchema,
  workforceEvent,
} from "../../db/schema/index.js";
import {
  getScheduleDateAfterDays,
  materializeFixedScheduleForStaff,
  materializeFixedSchedules,
} from "../../jobs/fixedScheduleMaterializer.js";
import { session, user } from "../../db/schema/auth.js";
import { badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { isAppRole, requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";
import { nowAtFacility } from "../../lib/facilityClock.js";

const router = Router();

const STAFF_WRITE_ROLES = ["super_admin", "hospital_admin", "hr_manager", "payroll_officer"] as const;

const normalizeEmptyStaffInputs = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const payload = { ...value } as Record<string, unknown>;
  for (const field of [
    "defaultShiftTypeId",
    "jobRoleId",
    "orgUnitId",
    "userId",
  ]) {
    if (typeof payload[field] === "string" && payload[field].trim() === "") {
      payload[field] = undefined;
    }
  }
  if (typeof payload.badgeNumber === "string" && payload.badgeNumber.trim() === "") {
    payload.badgeNumber = null;
  }
  for (const field of ["hireDate", "terminationDate"]) {
    if (typeof payload[field] === "string" && payload[field].trim() === "") {
      payload[field] = null;
    }
  }
  return payload;
};

const licenseCreateSchema = z.object({
  licensingBody: z.enum(["MDC", "NMC", "PC", "HPC", "AHPC", "OTHER"]),
  licenceNo: z.string().min(1).max(40),
  issuedOn: z.string().date().optional(),
  expiresOn: z.string().date(),
  status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED"]).default("ACTIVE"),
  attachmentId: z.string().uuid().optional(),
  note: z.string().max(300).optional(),
});

const staffCreateSchema = z.preprocess(
  normalizeEmptyStaffInputs,
  insertStaffSchema
    .extend({
      userId: z.string().optional(),
      orgUnitId: z.string().uuid().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.staffCategory === "NON_CLINICAL" && value.scheduleMode !== "FIXED_WEEKDAY") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduleMode"],
          message: "Non-clinical staff must use FIXED_WEEKDAY schedule mode.",
        });
      }
    }),
);
const staffUpdateInputSchema = z.preprocess(normalizeEmptyStaffInputs, updateStaffSchema);
const staffSqlColumns: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  phone: "phone",
  employeeId: "employee_id",
  department: "department",
  position: "position",
  momoNumber: "momo_number",
  momoName: "momo_name",
  imageUrl: "image_url",
  staffCategory: "staff_category",
  scheduleMode: "schedule_mode",
  defaultShiftTypeId: "default_shift_type_id",
  jobRoleId: "job_role_id",
  badgeNumber: "badge_number",
  hireDate: "hire_date",
  terminationDate: "termination_date",
  userId: "user_id",
};

const parseRouteId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const mapSort = (field: string, descending: boolean) => {
  if (field === "firstName") return descending ? desc(staff.firstName) : asc(staff.firstName);
  if (field === "lastName") return descending ? desc(staff.lastName) : asc(staff.lastName);
  if (field === "email") return descending ? desc(staff.email) : asc(staff.email);
  if (field === "employeeId") return descending ? desc(staff.employeeId) : asc(staff.employeeId);
  return descending ? desc(staff.createdAt) : asc(staff.createdAt);
};

const canViewPayout = (roles: string[]) =>
  roles.some((role) => ["super_admin", "hospital_admin", "hr_manager", "payroll_officer"].includes(role));

const sanitizeStaffRecord = (record: typeof staff.$inferSelect, roles: string[]) => {
  if (canViewPayout(roles)) {
    return record;
  }

  return {
    ...record,
    momoName: null,
    momoNumber: "***********",
  };
};

const parseAppRoles = (roles: string[] | undefined) =>
  (roles ?? []).filter((role): role is Parameters<typeof resolveManagedUnitIds>[1][number] => isAppRole(role));

const validateJobRoleCategory = async (jobRoleId: string | null | undefined, staffCategory: string | undefined) => {
  if (!jobRoleId || !staffCategory) return;
  const [role] = await db.select().from(jobRole).where(eq(jobRole.id, jobRoleId)).limit(1);
  if (!role) {
    throw validationError("Job role not found.", "JOB_ROLE_NOT_FOUND");
  }
  if (role.staffCategory !== staffCategory) {
    throw validationError(
      "Job role category must match staff category.",
      "STAFF_JOB_ROLE_CATEGORY_MISMATCH",
      { expected: staffCategory, actual: role.staffCategory },
    );
  }
};

const ensureStaffRules = async (payload: Partial<typeof staff.$inferInsert>) => {
  const category = payload.staffCategory;
  const mode = payload.scheduleMode;
  if (category === "NON_CLINICAL" && mode && mode !== "FIXED_WEEKDAY") {
    throw validationError(
      "Non-clinical staff cannot be rostered.",
      "STAFF_NONCLINICAL_FIXED",
      { staffCategory: category, scheduleMode: mode },
    );
  }
  await validateJobRoleCategory(payload.jobRoleId, category);
};

const ensureStaffUserLinkAvailable = async (
  userId: string | null | undefined,
  staffId?: string,
  currentUserId?: string | null,
) => {
  if (!userId) return;

  const [account] = await db
    .select({ id: user.id, status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!account) {
    throw validationError("The selected login account could not be found.", "STAFF_USER_NOT_FOUND");
  }
  if (account.status !== "active" && userId !== currentUserId) {
    throw validationError("Only active login accounts can be linked.", "STAFF_USER_INACTIVE");
  }

  const existingLink = staffId
    ? and(eq(staff.userId, userId), ne(staff.id, staffId))
    : eq(staff.userId, userId);
  const [linkedStaff] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(existingLink)
    .limit(1);
  if (linkedStaff) {
    throw conflict("The selected login account is already linked to another staff member.", "STAFF_USER_ALREADY_LINKED");
  }
};

const attachCurrentOrgUnits = async <T extends { id: string }>(rows: T[]) => {
  if (rows.length === 0) return rows.map((row) => ({ ...row, orgUnitId: null }));

  const today = new Date().toISOString().slice(0, 10);
  const assignments = await db
    .select({
      staffId: staffAssignment.staffId,
      orgUnitId: staffAssignment.orgUnitId,
      effectiveFrom: staffAssignment.effectiveFrom,
      assignmentType: staffAssignment.assignmentType,
    })
    .from(staffAssignment)
    .where(
      and(
        inArray(
          staffAssignment.staffId,
          rows.map((row) => row.id),
        ),
        lte(staffAssignment.effectiveFrom, today),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, today)),
      ),
    )
    .orderBy(desc(staffAssignment.effectiveFrom));

  const orgByStaff = new Map<string, string>();
  const assignmentPriority = new Map<string, number>();
  for (const assignment of assignments) {
    const priority = assignment.assignmentType === "TEMPORARY" || assignment.assignmentType === "COVER" ? 0 : 1;
    const currentPriority = assignmentPriority.get(assignment.staffId);
    if (currentPriority === undefined || priority < currentPriority) {
      orgByStaff.set(assignment.staffId, assignment.orgUnitId);
      assignmentPriority.set(assignment.staffId, priority);
    }
  }

  return rows.map((row) => ({ ...row, orgUnitId: orgByStaff.get(row.id) ?? null }));
};

const ensureManagedStaffAccess = async (
  user: { id?: string; roles?: string[] } | undefined,
  staffId: string,
) => {
  const [existing] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!existing) {
    throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
  }

  const managedIds = user?.id ? await resolveManagedUnitIds(user.id, parseAppRoles(user.roles)) : [];
  if (managedIds === null) {
    return;
  }
  if (managedIds.length === 0) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }

  const today = new Date().toISOString().slice(0, 10);
  const [currentAssignment] = await db
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

  if (!currentAssignment || !managedIds.includes(currentAssignment.orgUnitId)) {
    throw forbidden("You do not have access to this staff member.", "STAFF_FORBIDDEN");
  }
};

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["firstName", "lastName", "email", "employeeId", "createdAt"],
      filterable: ["status", "department", "staffCategory", "scheduleMode", "orgUnitId", "jobRoleId"],
      defaultSort: "-createdAt",
    });

    const roles = req.user?.roles ?? [];
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, parseAppRoles(roles)) : [];

    const filters = [];
    if (query.q) {
      filters.push(
        or(
          ilike(staff.firstName, `%${query.q}%`),
          ilike(staff.lastName, `%${query.q}%`),
          ilike(staff.email, `%${query.q}%`),
          ilike(staff.employeeId, `%${query.q}%`),
        ),
      );
    }

    let filterOrgUnitId: string | null = null;
    for (const filter of query.filters) {
      if (filter.operator !== "eq" || typeof filter.value !== "string") {
        continue;
      }
      if (filter.field === "status") filters.push(eq(staff.status, filter.value as "active" | "inactive"));
      if (filter.field === "department") filters.push(eq(staff.department, filter.value));
      if (filter.field === "staffCategory") filters.push(eq(staff.staffCategory, filter.value as "CLINICAL" | "NON_CLINICAL"));
      if (filter.field === "scheduleMode") filters.push(eq(staff.scheduleMode, filter.value as "FIXED_WEEKDAY" | "ROSTERED"));
      if (filter.field === "jobRoleId") filters.push(eq(staff.jobRoleId, filter.value));
      if (filter.field === "orgUnitId") filterOrgUnitId = filter.value;
    }

    const today = new Date().toISOString().slice(0, 10);
    const whereParts = [...filters];
    if (managedIds !== null) {
      if (managedIds.length === 0) {
        res.json(toPageResponse([], query, 0));
        return;
      }

      whereParts.push(
        sql`exists (
          select 1
          from ${staffAssignment}
          where ${staffAssignment.staffId} = ${staff.id}
            and ${staffAssignment.assignmentType} = 'PRIMARY'
            and ${staffAssignment.effectiveFrom} <= ${today}
            and (${staffAssignment.effectiveTo} is null or ${staffAssignment.effectiveTo} >= ${today})
            and ${staffAssignment.orgUnitId} in (${sql.join(managedIds.map((id) => sql`${id}`), sql`, `)})
        )`,
      );
    }
    if (filterOrgUnitId) {
      whereParts.push(
        sql`exists (
          select 1
          from ${staffAssignment}
          where ${staffAssignment.staffId} = ${staff.id}
            and ${staffAssignment.assignmentType} = 'PRIMARY'
            and ${staffAssignment.effectiveFrom} <= ${today}
            and (${staffAssignment.effectiveTo} is null or ${staffAssignment.effectiveTo} >= ${today})
            and ${staffAssignment.orgUnitId} = ${filterOrgUnitId}
        )`,
      );
    }

    const where = whereParts.length > 0 ? and(...whereParts) : undefined;
    const sort = query.sort[0] ?? { field: "createdAt", descending: true };
    const [rows, totalRows] = await Promise.all([
      db.select().from(staff).where(where).orderBy(mapSort(sort.field, sort.descending)).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(staff).where(where),
    ]);

    const withUnits = await attachCurrentOrgUnits(rows);

    res.json(
      toPageResponse(
        withUnits.map((row) => sanitizeStaffRecord(row, roles)),
        query,
        Number(totalRows[0]?.total ?? withUnits.length),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole([...STAFF_WRITE_ROLES]), async (req, res, next) => {
  try {
    const parsed = staffCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    await ensureStaffRules(parsed.data);
    await ensureStaffUserLinkAvailable(parsed.data.userId);

    if (parsed.data.orgUnitId) {
      const [unit] = await db
        .select({ id: orgUnit.id, active: orgUnit.active })
        .from(orgUnit)
        .where(eq(orgUnit.id, parsed.data.orgUnitId))
        .limit(1);
      if (!unit || !unit.active) {
        throw validationError("The selected org unit is not active.", "ORG_UNIT_INACTIVE");
      }
    }

    const [created] = await db.insert(staff).values(parsed.data).returning();
    if (!created) {
      throw badRequest("Unable to create staff member.", "STAFF_CREATE_FAILED");
    }
    if (parsed.data.orgUnitId) {
      try {
        await db.insert(staffAssignment).values({
          staffId: created.id,
          orgUnitId: parsed.data.orgUnitId,
          assignmentType: "PRIMARY",
          effectiveFrom: parsed.data.hireDate ?? new Date().toISOString().slice(0, 10),
          reason: "INITIAL",
        });
      } catch (error) {
        try {
          await db.delete(staff).where(eq(staff.id, created.id));
        } catch (compensationError) {
          console.error("Unable to remove a staff record after its initial assignment failed:", compensationError);
        }
        throw error;
      }
    }

    const warnings: string[] = [];
    try {
      await materializeFixedScheduleForStaff(created.id);
    } catch (error) {
      console.error("Staff member created, but the fixed weekday schedule could not be materialized.", error);
      warnings.push("Staff member created, but the automatic schedule could not be refreshed.");
    }

    res.status(201).json({ data: sanitizeStaffRecord(created, req.user?.roles ?? []), warnings });
  } catch (error) {
    next(error);
  }
});

router.get("/linkable-users", requireAnyRole([...STAFF_WRITE_ROLES]), async (req, res, next) => {
  try {
    const parsed = z.object({ staffId: z.string().uuid().optional() }).safeParse(req.query);
    if (!parsed.success) {
      throw validationError("Provide a valid staff record.", "STAFF_ID_INVALID");
    }

    let currentUserId: string | null = null;
    if (parsed.data.staffId) {
      const [existingStaff] = await db
        .select({ userId: staff.userId })
        .from(staff)
        .where(eq(staff.id, parsed.data.staffId))
        .limit(1);
      if (!existingStaff) {
        throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
      }
      currentUserId = existingStaff.userId;
    }

    const query = parseListQuery(req, {
      sortable: ["name", "email"],
      filterable: [],
      defaultSort: "name",
      ignoredQueryParams: ["staffId"],
    });
    const statusFilter = currentUserId
      ? or(eq(user.status, "active"), eq(user.id, currentUserId))
      : eq(user.status, "active");
    const assignmentQuery = db
      .select({ id: staff.id })
      .from(staff)
      .where(parsed.data.staffId
        ? and(eq(staff.userId, user.id), ne(staff.id, parsed.data.staffId))
        : eq(staff.userId, user.id));
    const searchFilter = query.q
      ? or(ilike(user.name, `%${query.q}%`), ilike(user.email, `%${query.q}%`))
      : undefined;
    const where = and(statusFilter, notExists(assignmentQuery), searchFilter);
    const sort = query.sort[0] ?? { field: "name", descending: false };
    const sortColumn = sort.field === "email" ? user.email : user.name;
    const [accounts, totalRows] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
        })
        .from(user)
        .where(where)
        .orderBy(sort.descending ? desc(sortColumn) : asc(sortColumn))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ total: count() }).from(user).where(where),
    ]);

    res.json(toPageResponse(accounts, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    await ensureManagedStaffAccess(req.user, staffId);

    const [record] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!record) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    const [withUnit] = await attachCurrentOrgUnits([record]);
    res.json({ data: sanitizeStaffRecord(withUnit ?? { ...record, orgUnitId: null }, req.user?.roles ?? []) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole([...STAFF_WRITE_ROLES]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    if (req.body && typeof req.body === "object" && "status" in req.body) {
      throw validationError("Use the deactivation workflow to change staff status.", "USE_DEACTIVATION_WORKFLOW");
    }
    if (req.body && typeof req.body === "object" && "orgUnitId" in req.body) {
      throw validationError("Use the transfer workflow to change a staff member's org unit.", "USE_TRANSFER_WORKFLOW");
    }

    const parsed = staffUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!existing) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    const mergedForValidation = {
      ...existing,
      ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)),
    };
    await ensureStaffRules(mergedForValidation);
    await ensureStaffUserLinkAvailable(parsed.data.userId, staffId, existing.userId);
    const wasFixedWeekdayStaff =
      existing.status === "active" &&
      existing.staffCategory === "NON_CLINICAL" &&
      existing.scheduleMode === "FIXED_WEEKDAY";
    const isFixedWeekdayStaff =
      mergedForValidation.status === "active" &&
      mergedForValidation.staffCategory === "NON_CLINICAL" &&
      mergedForValidation.scheduleMode === "FIXED_WEEKDAY";
    const enteringFixedWeekdayMode = isFixedWeekdayStaff && !wasFixedWeekdayStaff;
    let fixedScheduleWindow: { from: string; to: string } | null = null;
    let previousFixedRows: Array<typeof rosterEntry.$inferSelect> = [];

    if (enteringFixedWeekdayMode) {
      const activeShiftTypes = await db.select({
        id: shiftType.id,
        code: shiftType.code,
        category: shiftType.category,
      }).from(shiftType).where(eq(shiftType.active, true));
      const hasConfiguredShift = mergedForValidation.defaultShiftTypeId
        ? activeShiftTypes.some((shift) => shift.id === mergedForValidation.defaultShiftTypeId)
        : activeShiftTypes.some((shift) => shift.code === "STD" || shift.category === "STANDARD");
      if (!hasConfiguredShift) {
        throw validationError(
          "Configure an active default shift or standard shift before switching to a fixed weekday schedule.",
          "FIXED_SCHEDULE_SHIFT_NOT_CONFIGURED",
        );
      }

      const from = (await nowAtFacility()).localDateTime.slice(0, 10);
      const to = getScheduleDateAfterDays(from, 60);
      fixedScheduleWindow = { from, to };
      previousFixedRows = await db.select().from(rosterEntry).where(and(
        eq(rosterEntry.staffId, staffId),
        eq(rosterEntry.source, "AUTO_FIXED"),
        eq(rosterEntry.status, "ACTIVE"),
        gte(rosterEntry.rosterDate, from),
        lte(rosterEntry.rosterDate, to),
      ));
    }

    let updated: typeof staff.$inferSelect | undefined;
    if (
      parsed.data.badgeNumber !== undefined &&
      parsed.data.badgeNumber !== existing.badgeNumber
    ) {
      const currentConsent = sql`
        COALESCE((
          SELECT latest.status = 'GRANTED' AND latest.withdrawn_at IS NULL
          FROM consent AS latest
          WHERE latest.subject_type = 'STAFF'
            AND latest.subject_id = ${staffId}
            AND latest.consent_type = 'BIOMETRIC_ATTENDANCE'
          ORDER BY latest.created_at DESC
          LIMIT 1
        ), false)
      `;
      const hasActiveFingerprint = sql`
        EXISTS (
          SELECT 1
          FROM staff_credential AS active_fingerprint
          WHERE active_fingerprint.staff_id = person.id
            AND active_fingerprint.credential_type = 'FINGERPRINT'
            AND active_fingerprint.status = 'ACTIVE'
        )
      `;
      const assignments = Object.entries(parsed.data)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => {
          const column = staffSqlColumns[field];
          if (!column) throw new Error(`Unsupported staff update field: ${field}`);
          return sql`${sql.raw(`"${column}"`)} = ${value}`;
        });
      assignments.push(sql`updated_at = now()`);

      const pinUpdate = await db.execute(sql<{ id: string }>`
        WITH current_staff AS MATERIALIZED (
          SELECT person.id,
            ${hasActiveFingerprint} AS has_active_fingerprint,
            ${currentConsent} AS biometric_consent_granted
          FROM staff AS person
          WHERE person.id = ${staffId}
        ),
        updated_staff AS (
          UPDATE staff AS person
          SET ${sql.join(assignments, sql`, `)}
          FROM current_staff
          WHERE person.id = current_staff.id
            AND (
              NOT current_staff.has_active_fingerprint
              OR (
                current_staff.biometric_consent_granted
                AND CAST(${parsed.data.badgeNumber} AS text) IS NOT NULL
              )
            )
          RETURNING person.id
        ),
        updated_fingerprint AS (
          UPDATE staff_credential AS credential
          SET credential_ref = ${parsed.data.badgeNumber},
              issued_at = now()
          FROM updated_staff
          WHERE credential.staff_id = updated_staff.id
            AND credential.credential_type = 'FINGERPRINT'
            AND credential.status = 'ACTIVE'
          RETURNING credential.id
        )
        SELECT updated_staff.id
        FROM updated_staff
        LEFT JOIN updated_fingerprint ON TRUE
      `);
      if (!pinUpdate.rows[0]) {
        throw conflict(
          "Changing the badge PIN for an enrolled fingerprint requires current biometric consent and a non-empty PIN.",
          "FINGERPRINT_PIN_UPDATE_REQUIRES_CONSENT",
        );
      }
      [updated] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    } else {
      [updated] = await db
        .update(staff)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(staff.id, staffId))
        .returning();
    }

    if (!updated) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }

    const [withUnit] = await attachCurrentOrgUnits([updated]);
    const warnings: string[] = [];
    if (wasFixedWeekdayStaff && !isFixedWeekdayStaff) {
      try {
        await db.update(rosterEntry)
          .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
          .where(and(
            eq(rosterEntry.staffId, staffId),
            eq(rosterEntry.source, "AUTO_FIXED"),
            eq(rosterEntry.status, "ACTIVE"),
            gte(rosterEntry.plannedStart, new Date()),
          ));
      } catch (error) {
        console.error("Staff record updated, but future fixed weekday schedules could not be cancelled.", error);
        warnings.push("Staff record updated, but future automatic weekday shifts could not be cancelled.");
      }
    } else if (enteringFixedWeekdayMode && fixedScheduleWindow) {
      let cancelledManualRows: Array<typeof rosterEntry.$inferSelect> = [];
      try {
        cancelledManualRows = await db.update(rosterEntry)
          .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
          .where(and(
            eq(rosterEntry.staffId, staffId),
            ne(rosterEntry.source, "AUTO_FIXED"),
            eq(rosterEntry.status, "ACTIVE"),
            gte(rosterEntry.plannedStart, new Date()),
          ))
          .returning();
        await materializeFixedSchedules(fixedScheduleWindow.from, fixedScheduleWindow.to, [staffId]);
      } catch (error) {
        const compensationErrors: Array<{ step: string; error: unknown }> = [];
        const attemptCompensation = async (step: string, action: () => Promise<unknown>) => {
          try {
            await action();
          } catch (compensationError) {
            compensationErrors.push({ step, error: compensationError });
          }
        };
        let currentFixedRows: Array<{ id: string }> = [];
        await attemptCompensation("finding generated fixed shifts", async () => {
          currentFixedRows = await db.select({ id: rosterEntry.id })
            .from(rosterEntry)
            .where(and(
              eq(rosterEntry.staffId, staffId),
              eq(rosterEntry.source, "AUTO_FIXED"),
              eq(rosterEntry.status, "ACTIVE"),
              gte(rosterEntry.rosterDate, fixedScheduleWindow.from),
              lte(rosterEntry.rosterDate, fixedScheduleWindow.to),
            ));
        });
        const originalFixedIds = new Set(previousFixedRows.map((entry) => entry.id));
        const newFixedIds = currentFixedRows
          .map((entry) => entry.id)
          .filter((id) => !originalFixedIds.has(id));
        if (newFixedIds.length > 0) {
          await attemptCompensation("cancelling generated fixed shifts", () =>
            db.update(rosterEntry)
              .set({
                status: "CANCELLED",
                version: sql`${rosterEntry.version} + 1`,
              })
              .where(and(inArray(rosterEntry.id, newFixedIds), eq(rosterEntry.status, "ACTIVE"))),
          );
        }
        for (const previousEntry of previousFixedRows) {
          await attemptCompensation(`restoring fixed shift ${previousEntry.id}`, () =>
            db.update(rosterEntry)
              .set({
                orgUnitId: previousEntry.orgUnitId,
                rosterDate: previousEntry.rosterDate,
                shiftTypeId: previousEntry.shiftTypeId,
                plannedStart: previousEntry.plannedStart,
                plannedEnd: previousEntry.plannedEnd,
                rosterPeriodId: previousEntry.rosterPeriodId,
                source: previousEntry.source,
                status: "ACTIVE",
                overrideReason: previousEntry.overrideReason,
                version: sql`${rosterEntry.version} + 1`,
              })
              .where(eq(rosterEntry.id, previousEntry.id)),
          );
        }
        for (let index = 0; index < cancelledManualRows.length; index += 500) {
          const batch = cancelledManualRows.slice(index, index + 500);
          await attemptCompensation(`restoring cancelled manual shifts ${index}-${index + batch.length - 1}`, () =>
            db.update(rosterEntry)
              .set({ status: "ACTIVE", version: sql`${rosterEntry.version} + 1` })
              .where(and(
                inArray(rosterEntry.id, batch.map((entry) => entry.id)),
                eq(rosterEntry.status, "CANCELLED"),
              )),
          );
        }
        await attemptCompensation("restoring staff scheduling fields", () =>
          db.update(staff)
            .set({
              staffCategory: existing.staffCategory,
              scheduleMode: existing.scheduleMode,
              defaultShiftTypeId: existing.defaultShiftTypeId,
              updatedAt: new Date(),
            })
            .where(eq(staff.id, staffId)),
        );
        if (compensationErrors.length > 0) {
          console.error("Fixed weekday transition failed and its schedule compensation was incomplete.", {
            staffId,
            error,
            compensationErrors,
          });
        }
        throw error;
      }
    } else if (isFixedWeekdayStaff) {
      try {
        await materializeFixedScheduleForStaff(staffId);
      } catch (error) {
        console.error("Staff record updated, but the fixed weekday schedule could not be refreshed.", error);
        warnings.push("Staff record updated, but the automatic weekday schedule could not be refreshed.");
      }
    }
    res.json({
      data: sanitizeStaffRecord(withUnit ?? { ...updated, orgUnitId: null }, req.user?.roles ?? []),
      warnings,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/deactivate", requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      throw validationError("Deactivation reason is required.", "STAFF_DEACTIVATION_REASON_REQUIRED");
    }
    if (reason.length > 500) {
      throw validationError("Deactivation reason must be 500 characters or fewer.", "STAFF_DEACTIVATION_REASON_TOO_LONG");
    }

    const [existing] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    if (!existing) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    const [linkedUser] = existing.userId
      ? await db
        .select({ status: user.status })
        .from(user)
        .where(eq(user.id, existing.userId))
        .limit(1)
      : [];
    const linkedUserWasActive = linkedUser?.status === "active";

    const [updated] = await db
      .update(staff)
      .set({ status: "inactive", terminationDate: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(and(eq(staff.id, staffId), eq(staff.status, "active")))
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: staff.id, userId: staff.userId })
        .from(staff)
        .where(eq(staff.id, staffId))
        .limit(1);
      if (!existing) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
      if (existing.userId) {
        await db.update(user)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(eq(user.id, existing.userId));
        await db.delete(session).where(eq(session.userId, existing.userId));
      }
      throw conflict("Staff member is already inactive.", "STAFF_ALREADY_INACTIVE");
    }

    if (updated.userId) {
      await db.update(user).set({ status: "inactive", updatedAt: new Date() }).where(eq(user.id, updated.userId));
      await db.delete(session).where(eq(session.userId, updated.userId));
    }

    await db
      .update(rosterEntry)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(rosterEntry.staffId, staffId),
          eq(rosterEntry.status, "ACTIVE"),
          gte(rosterEntry.plannedStart, new Date()),
        ),
      );

    await db.insert(workforceEvent).values({
      eventType: "StaffDeactivated",
      aggregateId: staffId,
      payload: {
        staffId,
        reason,
        linkedUserId: existing.userId,
        linkedUserWasActive,
        deactivatedBy: req.user?.id ?? null,
      },
    });

    res.json({ data: { ...updated, deactivationReason: reason } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/reactivate", requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      throw validationError("Reactivation reason is required.", "STAFF_REACTIVATION_REASON_REQUIRED");
    }
    if (reason.length > 500) {
      throw validationError("Reactivation reason must be 500 characters or fewer.", "STAFF_REACTIVATION_REASON_TOO_LONG");
    }

    const [existing] = await db
      .select({ userId: staff.userId, status: staff.status })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    if (!existing) throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    if (existing.status !== "inactive") {
      throw conflict("Only inactive staff can be reactivated.", "STAFF_NOT_INACTIVE");
    }

    type ReactivationResult = {
      staff_id: string;
      linked_user_reactivated: boolean;
      linked_user_was_active: boolean;
      has_deactivation_event: boolean;
      has_linked_user_status: boolean;
      linked_user_id_matches: boolean;
    };
    const result = await db.execute(sql<ReactivationResult>`
      WITH prior_deactivation AS MATERIALIZED (
        SELECT payload
        FROM workforce_event
        WHERE event_type = 'StaffDeactivated'
          AND aggregate_id = ${staffId}
        ORDER BY occurred_at DESC
        LIMIT 1
      ),
      updated_staff AS (
        UPDATE staff
        SET status = 'active',
            termination_date = NULL,
            updated_at = now()
        WHERE id = ${staffId}
          AND status = 'inactive'
        RETURNING id, user_id, status
      ),
      updated_linked_user AS (
        UPDATE "user" AS linked
        SET status = 'active',
            updated_at = now()
        FROM updated_staff AS person
        JOIN prior_deactivation AS event ON TRUE
        WHERE linked.id = person.user_id
          AND linked.id = event.payload->>'linkedUserId'
          AND event.payload->>'linkedUserWasActive' = 'true'
        RETURNING linked.id
      ),
      inserted_event AS (
        INSERT INTO workforce_event (event_type, aggregate_id, payload)
        SELECT
          'StaffReactivated',
          person.id,
          jsonb_build_object(
            'staffId', person.id,
            'reason', ${reason}::text,
            'linkedUserReactivated', EXISTS (SELECT 1 FROM updated_linked_user),
            'reactivatedBy', ${req.user?.id ?? null}::text
          )
        FROM updated_staff AS person
        RETURNING aggregate_id
      )
      SELECT
        person.id AS staff_id,
        EXISTS (SELECT 1 FROM updated_linked_user) AS linked_user_reactivated,
        COALESCE((
          SELECT event.payload->>'linkedUserWasActive' = 'true'
          FROM prior_deactivation AS event
        ), false) AS linked_user_was_active,
        EXISTS (SELECT 1 FROM prior_deactivation) AS has_deactivation_event,
        COALESCE((
          SELECT event.payload ? 'linkedUserWasActive'
          FROM prior_deactivation AS event
        ), false) AS has_linked_user_status,
        COALESCE((
          SELECT event.payload->>'linkedUserId' = person.user_id
          FROM prior_deactivation AS event
        ), false) AS linked_user_id_matches
      FROM updated_staff AS person
      JOIN inserted_event ON inserted_event.aggregate_id = person.id
    `);
    const reactivated = result.rows[0];
    if (!reactivated) {
      throw conflict("Staff status changed before reactivation could be completed.", "STAFF_STATUS_CHANGED");
    }

    const warnings: string[] = [];
    if (
      existing.userId &&
      (
        !reactivated.has_deactivation_event ||
        !reactivated.has_linked_user_status ||
        !reactivated.linked_user_id_matches
      )
    ) {
      warnings.push("The linked login may need manual re-enabling because its prior status or staff linkage could not be verified.");
    }
    try {
      await materializeFixedScheduleForStaff(staffId);
    } catch (error) {
      console.error("Staff member reactivated, but the fixed weekday schedule could not be materialized.", error);
      warnings.push("Staff member reactivated, but the automatic schedule could not be refreshed.");
    }

    res.json({
      data: {
        id: reactivated.staff_id,
        status: "active",
        linkedUserReactivated: reactivated.linked_user_reactivated,
        linkedUserWasActive: reactivated.linked_user_was_active,
      },
      warnings,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/licenses", async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    await ensureManagedStaffAccess(req.user, staffId);

    const list = await db.select().from(staffLicense).where(eq(staffLicense.staffId, staffId)).orderBy(desc(staffLicense.expiresOn));
    res.json({ data: list });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/licenses", requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const parsed = licenseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [created] = await db.insert(staffLicense).values({ ...parsed.data, staffId }).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/licenses/:licenseId", requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]), async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    const licenseId = parseRouteId(req.params.licenseId);
    if (!staffId || !licenseId) {
      throw badRequest("Staff ID and license ID are required.", "STAFF_LICENSE_ID_REQUIRED");
    }

    const parsed = licenseCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );
    const [updated] = await db
      .update(staffLicense)
      .set(updateData)
      .where(and(eq(staffLicense.id, licenseId), eq(staffLicense.staffId, staffId)))
      .returning();

    if (!updated) {
      throw notFound("License not found.", "STAFF_LICENSE_NOT_FOUND");
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/migrations/department-org-units/dry-run",
  requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]),
  async (_req, res, next) => {
    try {
      const staffRows = await db.select().from(staff).orderBy(asc(staff.department), asc(staff.lastName));
      const existingUnits = await db.select().from(orgUnit);
      const byName = new Map(existingUnits.map((unit) => [unit.name.trim().toLowerCase(), unit]));

      const normalizedDepartments = new Map<
        string,
        { rawValue: string; staffCount: number; mappedOrgUnitId: string | null; unmappedStaffIds: string[] }
      >();

      for (const row of staffRows) {
        const raw = (row.department ?? "").trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const existing = normalizedDepartments.get(key) ?? {
          rawValue: raw,
          staffCount: 0,
          mappedOrgUnitId: byName.get(key)?.id ?? null,
          unmappedStaffIds: [],
        };
        existing.staffCount += 1;
        if (!existing.mappedOrgUnitId) {
          existing.unmappedStaffIds.push(row.id);
        }
        normalizedDepartments.set(key, existing);
      }

      const report = Array.from(normalizedDepartments.values()).sort((a, b) =>
        a.rawValue.localeCompare(b.rawValue),
      );
      res.json({
        data: {
          totalDepartments: report.length,
          unmappedDepartments: report.filter((row) => !row.mappedOrgUnitId).length,
          report,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/migrations/department-org-units/apply",
  requireAnyRole(["super_admin", "hospital_admin", "hr_manager"]),
  async (_req, res, next) => {
    try {
      const staffRows = await db.select().from(staff).where(eq(staff.status, "active"));
      const existingUnits = await db.select().from(orgUnit);
      const byName = new Map(existingUnits.map((unit) => [unit.name.trim().toLowerCase(), unit]));
      const existingCodes = new Set(existingUnits.map((unit) => unit.code.toUpperCase()));
      const createdUnitIds: string[] = [];
      const today = new Date().toISOString().slice(0, 10);

      for (const row of staffRows) {
        const department = (row.department ?? "").trim();
        if (!department) continue;
        const key = department.toLowerCase();
        let unit = byName.get(key);

        if (!unit) {
          const baseCode =
            department
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "")
              .slice(0, 30) || `UNIT_${createdUnitIds.length + 1}`;
          let code = baseCode;
          let suffix = 2;
          while (existingCodes.has(code)) {
            const suffixText = `_${suffix}`;
            code = `${baseCode.slice(0, Math.max(1, 30 - suffixText.length))}${suffixText}`;
            suffix += 1;
          }

          const [createdUnit] = await db
            .insert(orgUnit)
            .values({
              code,
              name: department,
              unitType: "DEPARTMENT",
              isClinical: false,
              operates24h: false,
              active: true,
            })
            .returning();
          if (!createdUnit) {
            throw badRequest("Unable to create org unit for department migration.", "ORG_UNIT_CREATE_FAILED");
          }
          unit = createdUnit;
          byName.set(key, unit);
          existingCodes.add(code);
          createdUnitIds.push(unit.id);
        }

        const [existingPrimary] = await db
          .select()
          .from(staffAssignment)
          .where(and(eq(staffAssignment.staffId, row.id), eq(staffAssignment.assignmentType, "PRIMARY")))
          .limit(1);

        if (!existingPrimary) {
          await db.insert(staffAssignment).values({
            staffId: row.id,
            orgUnitId: unit.id,
            assignmentType: "PRIMARY",
            effectiveFrom: row.hireDate ?? today,
            reason: "INITIAL",
          });
        }
      }

      res.json({ data: { createdUnits: createdUnitIds.length, message: "Department migration applied." } });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
