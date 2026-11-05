import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  facilitySetup,
  jobRole,
  notification,
  orgUnit,
  publicHoliday,
  rosterEntry,
  rosterEntryChange,
  rosterPeriod,
  rosterTemplate,
  rosterTemplateEntry,
  shiftSwapRequest,
  shiftType,
  staff,
  staffAssignment,
  unitStaffingRequirement,
  workforceEvent,
} from "../../db/schema/index.js";
import { materializeFixedSchedules, getScheduleDateAfterDays } from "../../jobs/fixedScheduleMaterializer.js";
import { seedGhanaPublicHolidays } from "../../jobs/ghanaHolidaySeed.js";
import { shiftEnd, shiftStart } from "../../lib/shiftTimes.js";
import { badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { isAppRole, requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";
import { nowAtFacility } from "../../lib/facilityClock.js";
import { validateRoster, type RosterRuleEntry } from "../../lib/rosterRules.js";

const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"] as const;
const READ_ROLES = [
  "SUPER_ADMIN",
  "HOSPITAL_ADMIN",
  "HR_MANAGER",
  "UNIT_MANAGER",
  "ROSTER_OFFICER",
] as const;
const EDIT_ROLES = ["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER"] as const;
const HR_OVERRIDE_ROLES = ["SUPER_ADMIN", "HR_MANAGER"] as const;
const PERIOD_CREATE_ROLES = ["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER"] as const;
const periodMutationQueues = new Map<string, Promise<void>>();
const periodInputSchema = z.object({
  orgUnitId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});
const rosterEntryInputSchema = z.object({
  staffId: z.string().uuid(),
  rosterDate: z.string().date(),
  shiftTypeId: z.string().uuid().nullable(),
  overrideReason: z.string().trim().max(500).nullable().optional(),
});
const bulkEntriesSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  entries: z.array(rosterEntryInputSchema).min(1).max(5000),
});
const templateInputSchema = z.object({
  orgUnitId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  entries: z.array(z.object({
    staffId: z.string().uuid(),
    dayOfWeek: z.number().int().min(0).max(6),
    shiftTypeId: z.string().uuid(),
  })).max(5000),
});
const holidayInputSchema = z.object({
  holidayDate: z.string().date(),
  name: z.string().trim().min(1).max(100),
});

type AppRole = Parameters<typeof resolveManagedUnitIds>[1][number];
type PeriodWithUnit = typeof rosterPeriod.$inferSelect & {
  unitName: string;
  operates24h: boolean;
};
type RequestEntry = z.infer<typeof rosterEntryInputSchema>;

const routeId = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const getRoles = (roles: unknown): AppRole[] =>
  Array.isArray(roles) ? roles.filter(isAppRole) : [];
const hasAny = (roles: AppRole[], allowed: readonly string[]) =>
  roles.includes("SUPER_ADMIN") || allowed.some((role) => roles.includes(role as AppRole));
const addDays = (date: string, days: number) => getScheduleDateAfterDays(date, days);

const ensureUnitAccess = async (
  userId: string | undefined,
  roles: AppRole[],
  orgUnitId: string,
) => {
  const managedIds = userId ? await resolveManagedUnitIds(userId, roles) : [];
  if (managedIds !== null && !managedIds.includes(orgUnitId)) {
    throw forbidden("You do not have access to this org unit's roster.", "ROSTER_UNIT_FORBIDDEN");
  }
};

const getPeriod = async (id: string): Promise<PeriodWithUnit> => {
  const [period] = await db.select({
    id: rosterPeriod.id,
    orgUnitId: rosterPeriod.orgUnitId,
    startDate: rosterPeriod.startDate,
    endDate: rosterPeriod.endDate,
    status: rosterPeriod.status,
    publishedBy: rosterPeriod.publishedBy,
    publishedAt: rosterPeriod.publishedAt,
    unitName: orgUnit.name,
    operates24h: orgUnit.operates24h,
  }).from(rosterPeriod)
    .innerJoin(orgUnit, eq(orgUnit.id, rosterPeriod.orgUnitId))
    .where(eq(rosterPeriod.id, id))
    .limit(1);
  if (!period) throw notFound("Roster period not found.", "ROSTER_PERIOD_NOT_FOUND");
  return period;
};

const isDatabaseConflict = (error: unknown) => {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  return code === "23505" || code === "23P01" || code === "23514";
};

const periodDates = (period: { startDate: string; endDate: string }) => {
  const dates: string[] = [];
  for (let date = period.startDate; date <= period.endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
};

const entryKey = (staffId: string, rosterDate: string) => `${staffId}:${rosterDate}`;

const withPeriodMutationLock = async <T,>(
  periodId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = periodMutationQueues.get(periodId) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  periodMutationQueues.set(periodId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (periodMutationQueues.get(periodId) === queued) {
      periodMutationQueues.delete(periodId);
    }
  }
};

const buildRuleContext = async (
  period: PeriodWithUnit,
  replacements: Map<string, RosterRuleEntry[]> = new Map(),
  options: {
    additionalEntries?: RosterRuleEntry[];
    excludedEntryIds?: Set<string>;
  } = {},
) => {
  const currentPeriodRows = await db.select().from(rosterEntry).where(and(
    eq(rosterEntry.rosterPeriodId, period.id),
    eq(rosterEntry.status, "ACTIVE"),
  ));
  const retainedPeriodRows = currentPeriodRows.filter(
    (entry) =>
      !replacements.has(entryKey(entry.staffId, entry.rosterDate)) &&
      !options.excludedEntryIds?.has(entry.id),
  );
  const candidateEntries = [
    ...Array.from(replacements.values()).flat(),
    ...(options.additionalEntries ?? []),
  ];
  const staffIds = Array.from(new Set([
    ...retainedPeriodRows.map((entry) => entry.staffId),
    ...candidateEntries.map((entry) => entry.staffId),
  ]));
  const externalRows = staffIds.length === 0
    ? []
    : await db.select().from(rosterEntry).where(and(
      inArray(rosterEntry.staffId, staffIds),
      gte(rosterEntry.rosterDate, addDays(period.startDate, -7)),
      lte(rosterEntry.rosterDate, addDays(period.endDate, 7)),
      eq(rosterEntry.status, "ACTIVE"),
      or(isNull(rosterEntry.rosterPeriodId), ne(rosterEntry.rosterPeriodId, period.id)),
    ));

  const entries = [
    ...retainedPeriodRows.map((entry) => ({ ...entry, inPeriod: true })),
    ...candidateEntries,
    ...externalRows.map((entry) => ({ ...entry, inPeriod: false })),
  ];
  const allStaffIds = Array.from(new Set(entries.map((entry) => entry.staffId)));
  const [people, shifts, assignments, holidays, requirements, facility] = await Promise.all([
    allStaffIds.length === 0
      ? Promise.resolve([])
      : db.select({
        id: staff.id,
        employeeId: staff.employeeId,
        firstName: staff.firstName,
        lastName: staff.lastName,
        staffCategory: staff.staffCategory,
        scheduleMode: staff.scheduleMode,
        jobRoleId: staff.jobRoleId,
      }).from(staff).where(inArray(staff.id, allStaffIds)),
    db.select().from(shiftType),
    allStaffIds.length === 0
      ? Promise.resolve([])
      : db.select().from(staffAssignment).where(and(
        inArray(staffAssignment.staffId, allStaffIds),
        lte(staffAssignment.effectiveFrom, addDays(period.endDate, 7)),
        or(
          isNull(staffAssignment.effectiveTo),
          gte(staffAssignment.effectiveTo, addDays(period.startDate, -7)),
        ),
      )),
    db.select({ holidayDate: publicHoliday.holidayDate }).from(publicHoliday).where(and(
      gte(publicHoliday.holidayDate, period.startDate),
      lte(publicHoliday.holidayDate, period.endDate),
    )),
    db.select({
      shiftTypeId: unitStaffingRequirement.shiftTypeId,
      jobRoleId: unitStaffingRequirement.jobRoleId,
      minStaff: unitStaffingRequirement.minStaff,
      jobRoleName: jobRole.name,
    }).from(unitStaffingRequirement)
      .leftJoin(jobRole, eq(jobRole.id, unitStaffingRequirement.jobRoleId))
      .where(eq(unitStaffingRequirement.orgUnitId, period.orgUnitId)),
    db.select({ timezone: facilitySetup.timezone }).from(facilitySetup).limit(1),
  ]);
  return {
    context: {
      period,
      operates24h: period.operates24h,
      entries,
      staff: people,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        name: shift.name,
        category: shift.category,
        breakMinutes: shift.breakMinutes,
      })),
      holidays: new Set(holidays.map((holiday) => holiday.holidayDate)),
      assignments,
      requirements,
    },
    timezone: facility[0]?.timezone ?? "Africa/Accra",
    currentPeriodRows,
  };
};

const hasPersistedRestOverrides = (context: { entries: RosterRuleEntry[] }) =>
  context.entries.some((entry) => entry.inPeriod && Boolean(entry.overrideReason?.trim()));

const buildCandidateEntries = async (
  period: PeriodWithUnit,
  inputEntries: RequestEntry[],
  roles: AppRole[],
  timezone: string,
) => {
  const holidayDateSet = new Set(
    (await db.select({ holidayDate: publicHoliday.holidayDate }).from(publicHoliday).where(and(
      gte(publicHoliday.holidayDate, period.startDate),
      lte(publicHoliday.holidayDate, period.endDate),
    ))).map((holiday) => holiday.holidayDate),
  );
  const dates = new Set(periodDates(period));
  const staffIds = Array.from(new Set(inputEntries.map((entry) => entry.staffId)));
  const shiftIds = Array.from(new Set(inputEntries.flatMap((entry) => entry.shiftTypeId ? [entry.shiftTypeId] : [])));
  const [people, shifts] = await Promise.all([
    staffIds.length === 0 ? Promise.resolve([]) : db.select({
      id: staff.id,
      status: staff.status,
      staffCategory: staff.staffCategory,
      scheduleMode: staff.scheduleMode,
    }).from(staff).where(inArray(staff.id, staffIds)),
    shiftIds.length === 0 ? Promise.resolve([]) : db.select().from(shiftType).where(inArray(shiftType.id, shiftIds)),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const candidateByDate = new Map<string, RosterRuleEntry[]>();
  const seen = new Map<string, Set<string | null>>();

  for (const entry of inputEntries) {
    const key = entryKey(entry.staffId, entry.rosterDate);
    if (!dates.has(entry.rosterDate)) {
      throw validationError("Roster dates must fall within the selected period.", "ROSTER_DATE_OUTSIDE_PERIOD");
    }
    const shiftsForCell = seen.get(key) ?? new Set<string | null>();
    if (
      shiftsForCell.has(entry.shiftTypeId) ||
      shiftsForCell.has(null) ||
      (entry.shiftTypeId === null && shiftsForCell.size > 0)
    ) {
      throw validationError("A roster cell cannot contain duplicate shifts or combine a cleared cell with shifts.", "DUPLICATE_ROSTER_CELL");
    }
    shiftsForCell.add(entry.shiftTypeId);
    seen.set(key, shiftsForCell);
    if (entry.overrideReason?.trim() && !hasAny(roles, HR_OVERRIDE_ROLES)) {
      throw forbidden("Only HR may override minimum rest, and an override reason is required.", "ROSTER_OVERRIDE_FORBIDDEN");
    }
    if (!entry.shiftTypeId) {
      candidateByDate.set(key, []);
      continue;
    }

    const person = peopleById.get(entry.staffId);
    if (!person || person.status !== "active") {
      throw validationError("Only active staff can be placed on a roster.", "STAFF_NOT_ACTIVE");
    }
    if (person.scheduleMode !== "ROSTERED") {
      throw validationError("Only staff configured for rostered schedules can be edited here.", "STAFF_NOT_ROSTERED");
    }
    const shift = shiftsById.get(entry.shiftTypeId);
    if (!shift || !shift.active) {
      throw validationError("Choose an active shift type.", "SHIFT_TYPE_INACTIVE");
    }
    if (
      person.staffCategory === "NON_CLINICAL" &&
      ((new Date(`${entry.rosterDate}T00:00:00.000Z`).getUTCDay() === 0) ||
        new Date(`${entry.rosterDate}T00:00:00.000Z`).getUTCDay() === 6 ||
        holidayDateSet.has(entry.rosterDate))
    ) {
      throw validationError("Non-clinical staff cannot be rostered on weekends or public holidays.", "NON_CLINICAL_NON_WORKING_DAY");
    }
    const candidates = candidateByDate.get(key) ?? [];
    candidates.push({
      staffId: entry.staffId,
      orgUnitId: period.orgUnitId,
      rosterDate: entry.rosterDate,
      shiftTypeId: entry.shiftTypeId,
      plannedStart: shiftStart(entry.rosterDate, shift, timezone),
      plannedEnd: shiftEnd(entry.rosterDate, shift, timezone),
      source: "MANUAL",
      overrideReason: entry.overrideReason?.trim() || null,
      inPeriod: true,
    });
    candidateByDate.set(key, candidates);
  }

  return candidateByDate;
};

const persistRosterEntries = async (
  period: PeriodWithUnit,
  inputEntries: RequestEntry[],
  roles: AppRole[],
  actorUserId: string,
  reason?: string,
) => withPeriodMutationLock(period.id, async () => {
  period = await getPeriod(period.id);
  if (period.status === "LOCKED") {
    throw conflict("Locked rosters cannot be changed.", "ROSTER_PERIOD_LOCKED");
  }

  const { timezone } = await buildRuleContext(period);
  const replacements = await buildCandidateEntries(period, inputEntries, roles, timezone);
  const { context, currentPeriodRows } = await buildRuleContext(period, replacements);
  const violations = validateRoster({
    ...context,
    allowRestOverride: hasAny(roles, HR_OVERRIDE_ROLES),
  });
  const blocking = violations.filter((violation) => violation.level === "error");
  if (blocking.length > 0) {
    return { saved: false, violations };
  }

  const touched = new Set(inputEntries.map((entry) => entryKey(entry.staffId, entry.rosterDate)));
  const before = currentPeriodRows.filter((entry) => touched.has(entryKey(entry.staffId, entry.rosterDate)));
  const changedIds = before.map((entry) => entry.id);
  const created: Array<typeof rosterEntry.$inferSelect> = [];
  let cancelledIds: string[] = [];

  try {
    if (changedIds.length > 0) {
      const cancelled = await db.update(rosterEntry)
        .set({
          status: "CANCELLED",
          version: sql`${rosterEntry.version} + 1`,
        })
        .where(and(
          inArray(rosterEntry.id, changedIds),
          eq(rosterEntry.status, "ACTIVE"),
          eq(rosterEntry.rosterPeriodId, period.id),
        ))
        .returning({ id: rosterEntry.id });
      cancelledIds = cancelled.map((entry) => entry.id);
      if (cancelledIds.length !== changedIds.length) {
        throw conflict("Roster entries changed while you were editing. Reload the grid and retry.", "ROSTER_VERSION_CONFLICT");
      }
    }

    const values = Array.from(replacements.values()).flat();
    if (values.length > 0) {
      const saved = await db.insert(rosterEntry).values(values.map((entry) => ({
        rosterPeriodId: period.id,
        staffId: entry.staffId,
        orgUnitId: period.orgUnitId,
        rosterDate: entry.rosterDate,
        shiftTypeId: entry.shiftTypeId,
        plannedStart: entry.plannedStart instanceof Date ? entry.plannedStart : new Date(entry.plannedStart),
        plannedEnd: entry.plannedEnd instanceof Date ? entry.plannedEnd : new Date(entry.plannedEnd),
        source: entry.source,
        status: "ACTIVE",
        overrideReason: entry.overrideReason ?? null,
      }))).returning();
      created.push(...saved);
    }
  } catch (error) {
    if (cancelledIds.length > 0) {
      try {
        await db.update(rosterEntry)
          .set({ status: "ACTIVE", version: sql`${rosterEntry.version} + 1` })
          .where(and(inArray(rosterEntry.id, cancelledIds), eq(rosterEntry.status, "CANCELLED")));
      } catch (compensationError) {
        console.error("Roster save compensation failed; manually review the affected period.", {
          periodId: period.id,
          changedEntryIds: changedIds,
          compensationError,
        });
      }
    }
    throw error;
  }

  const afterByKey = new Map<string, typeof created>();
  for (const entry of created) {
    const key = entryKey(entry.staffId, entry.rosterDate);
    const rows = afterByKey.get(key) ?? [];
    rows.push(entry);
    afterByKey.set(key, rows);
  }
  const oldByKey = new Map<string, typeof before>();
  for (const entry of before) {
    const key = entryKey(entry.staffId, entry.rosterDate);
    const rows = oldByKey.get(key) ?? [];
    rows.push(entry);
    oldByKey.set(key, rows);
  }
  const changes = Array.from(touched, (key) => {
    const [staffId = "", rosterDate = ""] = key.split(":");
    const oldEntries = oldByKey.get(key) ?? [];
    const newEntries = afterByKey.get(key) ?? [];
    return {
      rosterPeriodId: period.id,
      rosterEntryId: newEntries[0]?.id ?? oldEntries[0]?.id ?? null,
      staffId,
      rosterDate,
      action: newEntries.length > 0 ? oldEntries.length > 0 ? "UPDATED" : "CREATED" : "CANCELLED",
      before: oldEntries,
      after: newEntries,
      reason: reason ?? null,
      actorUserId,
    } as const;
  });

  const warnings: string[] = [];
  if (period.status === "PUBLISHED" && changes.length > 0) {
    try {
      await db.insert(rosterEntryChange).values(changes);
      await db.insert(workforceEvent).values({
        eventType: "RosterEntryChanged",
        aggregateId: period.id,
        payload: { rosterPeriodId: period.id, changedCells: changes.length, actorUserId },
      });
    } catch (error) {
      console.error("Roster changed but its published-roster audit event could not be recorded.", error);
      warnings.push("Roster saved, but the change notification could not be recorded.");
    }
  }

  return { saved: true, violations, warnings, changedCells: changes.length };
});

router.get("/roster-periods", requireAnyRole([...READ_ROLES]), async (req, res, next) => {
  try {
    const roles = getRoles(req.user?.roles);
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, roles) : [];
    const requestedUnit = typeof req.query.orgUnitId === "string" ? req.query.orgUnitId : null;
    if (requestedUnit) await ensureUnitAccess(req.user?.id, roles, requestedUnit);
    const periods = await db.select({
      id: rosterPeriod.id,
      orgUnitId: rosterPeriod.orgUnitId,
      unitName: orgUnit.name,
      startDate: rosterPeriod.startDate,
      endDate: rosterPeriod.endDate,
      status: rosterPeriod.status,
      publishedAt: rosterPeriod.publishedAt,
    }).from(rosterPeriod)
      .innerJoin(orgUnit, eq(orgUnit.id, rosterPeriod.orgUnitId))
      .where(and(
        requestedUnit ? eq(rosterPeriod.orgUnitId, requestedUnit) : undefined,
        managedIds === null ? undefined : managedIds.length > 0 ? inArray(rosterPeriod.orgUnitId, managedIds) : sql`false`,
      ))
      .orderBy(desc(rosterPeriod.startDate), asc(orgUnit.name))
      .limit(200);
    res.json({ data: periods });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-periods", requireAnyRole([...PERIOD_CREATE_ROLES]), async (req, res, next) => {
  try {
    const parsed = periodInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Provide a unit and a valid roster date range.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const { orgUnitId, startDate, endDate } = parsed.data;
    if (endDate < startDate || periodDates({ startDate, endDate }).length > 62) {
      throw validationError("A roster period must cover 1 to 62 days.", "ROSTER_PERIOD_RANGE_INVALID");
    }
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, orgUnitId);
    const [unit] = await db.select({ id: orgUnit.id, active: orgUnit.active })
      .from(orgUnit).where(eq(orgUnit.id, orgUnitId)).limit(1);
    if (!unit || !unit.active) throw notFound("Active org unit not found.", "ORG_UNIT_NOT_FOUND");

    const [created] = await db.insert(rosterPeriod).values({
      orgUnitId,
      startDate,
      endDate,
      status: "DRAFT",
    }).returning();
    if (!created) throw badRequest("Unable to create roster period.", "ROSTER_PERIOD_CREATE_FAILED");
    res.status(201).json({ data: created });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("This unit already has a roster period that overlaps those dates.", "ROSTER_PERIOD_OVERLAP"));
      return;
    }
    next(error);
  }
});

router.get("/roster-periods/:id/grid", requireAnyRole([...READ_ROLES]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    const period = await getPeriod(periodId);
    await ensureUnitAccess(req.user?.id, getRoles(req.user?.roles), period.orgUnitId);
    const [entries, assignmentRows] = await Promise.all([
      db.select({
        id: rosterEntry.id,
        staffId: rosterEntry.staffId,
        rosterDate: rosterEntry.rosterDate,
        shiftTypeId: rosterEntry.shiftTypeId,
        shiftName: shiftType.name,
        plannedStart: rosterEntry.plannedStart,
        plannedEnd: rosterEntry.plannedEnd,
        source: rosterEntry.source,
        version: rosterEntry.version,
        overrideReason: rosterEntry.overrideReason,
      }).from(rosterEntry)
        .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
        .where(and(
          eq(rosterEntry.rosterPeriodId, period.id),
          eq(rosterEntry.status, "ACTIVE"),
        ))
        .orderBy(asc(rosterEntry.rosterDate), asc(shiftType.startTime)),
      db.select({
        staffId: staffAssignment.staffId,
        effectiveFrom: staffAssignment.effectiveFrom,
        effectiveTo: staffAssignment.effectiveTo,
        assignmentType: staffAssignment.assignmentType,
        approvedAt: staffAssignment.approvedAt,
      }).from(staffAssignment).where(and(
        eq(staffAssignment.orgUnitId, period.orgUnitId),
        lte(staffAssignment.effectiveFrom, period.endDate),
        or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, period.startDate)),
      )),
    ]);
    const eligibleStaffIds = Array.from(new Set(assignmentRows
      .filter((row) => row.assignmentType !== "COVER" || row.approvedAt !== null)
      .map((row) => row.staffId)));
    const people = eligibleStaffIds.length === 0
      ? []
      : await db.select({
        id: staff.id,
        employeeId: staff.employeeId,
        firstName: staff.firstName,
        lastName: staff.lastName,
        staffCategory: staff.staffCategory,
        jobRoleName: jobRole.name,
        scheduleMode: staff.scheduleMode,
      }).from(staff)
        .leftJoin(jobRole, eq(jobRole.id, staff.jobRoleId))
        .where(and(
          inArray(staff.id, eligibleStaffIds),
          eq(staff.status, "active"),
          eq(staff.scheduleMode, "ROSTERED"),
        ))
        .orderBy(asc(staff.lastName), asc(staff.firstName));
    const { context } = await buildRuleContext(period);
    const violations = validateRoster({
      ...context,
      allowRestOverride: hasPersistedRestOverrides(context),
    });
    res.json({
      data: {
        period,
        dates: periodDates(period),
        staff: people,
        shifts: context.shifts,
        entries,
        violations,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/roster-periods/:id/entries", requireAnyRole([...EDIT_ROLES]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    const parsed = bulkEntriesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Provide valid roster grid entries.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const period = await getPeriod(periodId);
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, period.orgUnitId);
    const result = await persistRosterEntries(
      period,
      parsed.data.entries,
      roles,
      req.user?.id ?? "system",
      parsed.data.reason,
    );
    if (!result.saved) {
      res.status(422).json({
        error: "Roster validation failed.",
        code: "ROSTER_VALIDATION_FAILED",
        violations: result.violations,
      });
      return;
    }
    res.json({ data: { changedCells: result.changedCells }, violations: result.violations, warnings: result.warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A conflicting active roster entry exists. Reload the grid and resolve it.", "ROSTER_ENTRY_CONFLICT"));
      return;
    }
    next(error);
  }
});

router.post("/roster-periods/:id/validate", requireAnyRole([...READ_ROLES]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    const period = await getPeriod(periodId);
    await ensureUnitAccess(req.user?.id, getRoles(req.user?.roles), period.orgUnitId);
    const { context } = await buildRuleContext(period);
    const violations = validateRoster(context);
    res.json({ data: violations, valid: violations.every((item) => item.level !== "error") });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-periods/:id/publish", requireAnyRole(["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER"]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    const period = await getPeriod(periodId);
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, period.orgUnitId);
    if (period.status !== "DRAFT") {
      throw conflict("Only a draft roster can be published.", "ROSTER_PERIOD_NOT_DRAFT");
    }
    const { context } = await buildRuleContext(period);
    const violations = validateRoster({
      ...context,
      publishing: true,
      allowRestOverride: hasPersistedRestOverrides(context),
    });
    const blocking = violations.filter((violation) => violation.level === "error");
    if (blocking.length > 0) {
      res.status(422).json({ error: "Roster cannot be published.", code: "ROSTER_VALIDATION_FAILED", violations });
      return;
    }
    const [published] = await db.update(rosterPeriod)
      .set({ status: "PUBLISHED", publishedBy: req.user?.id ?? null, publishedAt: new Date() })
      .where(and(eq(rosterPeriod.id, period.id), eq(rosterPeriod.status, "DRAFT")))
      .returning();
    if (!published) throw conflict("Roster period changed while publishing.", "ROSTER_PERIOD_VERSION_CONFLICT");

    const recipientIds = Array.from(new Set(context.entries
      .filter((entry) => entry.inPeriod)
      .map((entry) => entry.staffId)));
    const warnings: string[] = [];
    try {
      if (recipientIds.length > 0) {
        await db.insert(notification).values(recipientIds.map((recipientId) => ({
          channel: "IN_APP",
          recipientType: "STAFF",
          recipientId,
          template: "ROSTER_PUBLISHED",
          payload: {
            unitName: period.unitName,
            startDate: period.startDate,
            endDate: period.endDate,
          },
          status: "SENT",
          sentAt: new Date(),
          relatedEntityType: "roster_period",
          relatedEntityId: period.id,
        })));
      }
      await db.insert(workforceEvent).values({
        eventType: "RosterPublished",
        aggregateId: period.id,
        payload: { rosterPeriodId: period.id, orgUnitId: period.orgUnitId },
      });
    } catch (error) {
      console.error("Roster published, but one or more staff notifications could not be recorded.", error);
      warnings.push("Roster was published, but one or more in-app notifications could not be recorded.");
    }
    res.json({ data: published, violations, warnings });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-periods/:id/lock", requireAnyRole(["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER"]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    const period = await getPeriod(periodId);
    await ensureUnitAccess(req.user?.id, getRoles(req.user?.roles), period.orgUnitId);
    if (period.status !== "PUBLISHED") {
      throw conflict("Only a published roster can be locked.", "ROSTER_PERIOD_NOT_PUBLISHED");
    }
    const [locked] = await db.update(rosterPeriod)
      .set({ status: "LOCKED" })
      .where(and(eq(rosterPeriod.id, period.id), eq(rosterPeriod.status, "PUBLISHED")))
      .returning();
    if (!locked) throw conflict("Roster period changed while locking.", "ROSTER_PERIOD_VERSION_CONFLICT");
    res.json({ data: locked });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-periods/:id/copy", requireAnyRole([...EDIT_ROLES]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    const sourcePeriodId = z.string().uuid().safeParse(req.body?.sourcePeriodId);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    if (!sourcePeriodId.success) {
      throw validationError("Choose a source roster period.", "SOURCE_ROSTER_PERIOD_REQUIRED");
    }
    const [period, sourcePeriod] = await Promise.all([
      getPeriod(periodId),
      getPeriod(sourcePeriodId.data),
    ]);
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, period.orgUnitId);
    await ensureUnitAccess(req.user?.id, roles, sourcePeriod.orgUnitId);
    if (period.status !== "DRAFT") throw conflict("Only a draft roster can be copied into.", "ROSTER_PERIOD_NOT_DRAFT");
    if (period.orgUnitId !== sourcePeriod.orgUnitId) {
      throw validationError("A roster can only be copied from the same org unit.", "ROSTER_COPY_UNIT_MISMATCH");
    }

    const [sourceEntries] = await Promise.all([
      db.select().from(rosterEntry).where(and(
        eq(rosterEntry.rosterPeriodId, sourcePeriod.id),
        eq(rosterEntry.status, "ACTIVE"),
      )),
    ]);
    const sourceDates = periodDates(sourcePeriod);
    const targetDates = periodDates(period);
    const staffIds = Array.from(new Set(sourceEntries.map((entry) => entry.staffId)));
    const sourceMap = new Map<string, typeof sourceEntries>();
    for (const entry of sourceEntries) {
      const key = entryKey(entry.staffId, entry.rosterDate);
      const entriesForDate = sourceMap.get(key) ?? [];
      entriesForDate.push(entry);
      sourceMap.set(key, entriesForDate);
    }
    const entries: RequestEntry[] = [];
    for (const staffId of staffIds) {
      for (let index = 0; index < targetDates.length; index += 1) {
        const sourceDate = sourceDates[index % sourceDates.length];
        const targetDate = targetDates[index];
        if (!sourceDate || !targetDate) continue;
        const sourceDateEntries = sourceMap.get(entryKey(staffId, sourceDate)) ?? [];
        if (sourceDateEntries.length === 0) {
          entries.push({ staffId, rosterDate: targetDate, shiftTypeId: null });
        } else {
          for (const sourceEntry of sourceDateEntries) {
            entries.push({
              staffId,
              rosterDate: targetDate,
              shiftTypeId: sourceEntry.shiftTypeId,
              overrideReason: sourceEntry.overrideReason ?? null,
            });
          }
        }
      }
    }
    if (entries.length > 5000) throw validationError("The copied roster exceeds the bulk edit limit.", "ROSTER_COPY_TOO_LARGE");
    if (entries.length === 0) {
      res.json({ data: { changedCells: 0 }, violations: [] });
      return;
    }
    const result = await persistRosterEntries(period, entries, roles, req.user?.id ?? "system", "Copied from a previous roster period.");
    if (!result.saved) {
      res.status(422).json({ error: "Copied roster requires changes before it can be saved.", code: "ROSTER_VALIDATION_FAILED", violations: result.violations });
      return;
    }
    res.json({ data: { changedCells: result.changedCells }, violations: result.violations, warnings: result.warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A conflicting active roster entry exists. Reload the period and retry.", "ROSTER_ENTRY_CONFLICT"));
      return;
    }
    next(error);
  }
});

router.get("/roster-templates", requireAnyRole([...READ_ROLES]), async (req, res, next) => {
  try {
    const roles = getRoles(req.user?.roles);
    const requestedUnit = typeof req.query.orgUnitId === "string" ? req.query.orgUnitId : null;
    if (requestedUnit) await ensureUnitAccess(req.user?.id, roles, requestedUnit);
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, roles) : [];
    const templates = await db.select({
      id: rosterTemplate.id,
      orgUnitId: rosterTemplate.orgUnitId,
      unitName: orgUnit.name,
      name: rosterTemplate.name,
      createdAt: rosterTemplate.createdAt,
    }).from(rosterTemplate)
      .innerJoin(orgUnit, eq(orgUnit.id, rosterTemplate.orgUnitId))
      .where(and(
        requestedUnit ? eq(rosterTemplate.orgUnitId, requestedUnit) : undefined,
        managedIds === null ? undefined : managedIds.length > 0 ? inArray(rosterTemplate.orgUnitId, managedIds) : sql`false`,
      ))
      .orderBy(asc(orgUnit.name), asc(rosterTemplate.name));
    res.json({ data: templates });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-templates", requireAnyRole([...EDIT_ROLES]), async (req, res, next) => {
  try {
    const parsed = templateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Provide a template name and valid weekly entries.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, parsed.data.orgUnitId);
    if (new Set(parsed.data.entries.map((entry) => `${entry.staffId}:${entry.dayOfWeek}`)).size !== parsed.data.entries.length) {
      throw validationError("A template can contain only one shift per staff member and weekday.", "DUPLICATE_TEMPLATE_CELL");
    }
    const [created] = await db.insert(rosterTemplate).values({
      orgUnitId: parsed.data.orgUnitId,
      name: parsed.data.name,
      createdBy: req.user?.id ?? "system",
    }).returning();
    if (!created) throw badRequest("Unable to create roster template.", "ROSTER_TEMPLATE_CREATE_FAILED");
    try {
      if (parsed.data.entries.length > 0) {
        await db.insert(rosterTemplateEntry).values(parsed.data.entries.map((entry) => ({
          rosterTemplateId: created.id,
          ...entry,
        })));
      }
    } catch (error) {
      try {
        await db.delete(rosterTemplate).where(eq(rosterTemplate.id, created.id));
      } catch (compensationError) {
        console.error("Roster template creation compensation failed.", { templateId: created.id, compensationError });
      }
      throw error;
    }
    res.status(201).json({ data: created });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A template with that name already exists for this unit.", "ROSTER_TEMPLATE_NAME_EXISTS"));
      return;
    }
    next(error);
  }
});

router.delete("/roster-templates/:id", requireAnyRole([...EDIT_ROLES]), async (req, res, next) => {
  try {
    const templateId = routeId(req.params.id);
    if (!templateId) throw badRequest("Template ID is required.", "ROSTER_TEMPLATE_ID_REQUIRED");
    const [template] = await db.select().from(rosterTemplate)
      .where(eq(rosterTemplate.id, templateId)).limit(1);
    if (!template) throw notFound("Roster template not found.", "ROSTER_TEMPLATE_NOT_FOUND");
    await ensureUnitAccess(req.user?.id, getRoles(req.user?.roles), template.orgUnitId);
    const [deleted] = await db.delete(rosterTemplate)
      .where(eq(rosterTemplate.id, template.id))
      .returning({ id: rosterTemplate.id });
    if (!deleted) throw conflict("Roster template changed while deleting.", "ROSTER_TEMPLATE_CHANGED");
    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

router.post("/roster-periods/:id/apply-template", requireAnyRole([...EDIT_ROLES]), async (req, res, next) => {
  try {
    const periodId = routeId(req.params.id);
    const templateId = z.string().uuid().safeParse(req.body?.templateId);
    if (!periodId) throw badRequest("Roster period ID is required.", "ROSTER_PERIOD_ID_REQUIRED");
    if (!templateId.success) throw validationError("Choose a weekly template.", "ROSTER_TEMPLATE_REQUIRED");
    const [period, template] = await Promise.all([
      getPeriod(periodId),
      db.select().from(rosterTemplate).where(eq(rosterTemplate.id, templateId.data)).limit(1).then((rows) => rows[0]),
    ]);
    if (!template) throw notFound("Roster template not found.", "ROSTER_TEMPLATE_NOT_FOUND");
    const roles = getRoles(req.user?.roles);
    await ensureUnitAccess(req.user?.id, roles, period.orgUnitId);
    if (period.status !== "DRAFT") throw conflict("Only a draft roster can receive a template.", "ROSTER_PERIOD_NOT_DRAFT");
    if (period.orgUnitId !== template.orgUnitId) {
      throw validationError("The template must belong to the same org unit.", "ROSTER_TEMPLATE_UNIT_MISMATCH");
    }
    const templateEntries = await db.select().from(rosterTemplateEntry)
      .where(eq(rosterTemplateEntry.rosterTemplateId, template.id));
    const staffIds = Array.from(new Set(templateEntries.map((entry) => entry.staffId)));
    const entryByCell = new Map(templateEntries.map((entry) => [`${entry.staffId}:${entry.dayOfWeek}`, entry]));
    const entries: RequestEntry[] = [];
    for (const staffId of staffIds) {
      for (const date of periodDates(period)) {
        const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
        const templateEntry = entryByCell.get(`${staffId}:${dayOfWeek}`);
        entries.push({
          staffId,
          rosterDate: date,
          shiftTypeId: templateEntry?.shiftTypeId ?? null,
        });
      }
    }
    if (entries.length > 5000) throw validationError("The applied template exceeds the bulk edit limit.", "ROSTER_TEMPLATE_TOO_LARGE");
    if (entries.length === 0) {
      res.json({ data: { changedCells: 0 }, violations: [] });
      return;
    }
    const result = await persistRosterEntries(period, entries, roles, req.user?.id ?? "system", `Applied template: ${template.name}`);
    if (!result.saved) {
      res.status(422).json({ error: "Template requires changes before it can be saved.", code: "ROSTER_VALIDATION_FAILED", violations: result.violations });
      return;
    }
    res.json({ data: { changedCells: result.changedCells }, violations: result.violations, warnings: result.warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A conflicting active roster entry exists. Reload the period and retry.", "ROSTER_ENTRY_CONFLICT"));
      return;
    }
    next(error);
  }
});

const refreshFixedSchedulesForHolidayChange = async (holidayDate: string) => {
  const today = (await nowAtFacility()).localDateTime.slice(0, 10);
  const windowEnd = addDays(today, 60);
  if (holidayDate < today || holidayDate > windowEnd) return;
  await materializeFixedSchedules(today, windowEnd);
};

const reconcileNonClinicalHolidayEntries = async (
  holidayDates: string[],
  actorUserId: string,
) => {
  if (holidayDates.length === 0) return { cancelled: 0, auditFailed: false };
  const candidates = await db.select({ entry: rosterEntry })
    .from(rosterEntry)
    .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
    .where(and(
      inArray(rosterEntry.rosterDate, holidayDates),
      eq(rosterEntry.status, "ACTIVE"),
      ne(rosterEntry.source, "AUTO_FIXED"),
      isNotNull(rosterEntry.rosterPeriodId),
      eq(staff.staffCategory, "NON_CLINICAL"),
    ));
  if (candidates.length === 0) return { cancelled: 0, auditFailed: false };

  const beforeById = new Map(candidates.map(({ entry }) => [entry.id, entry]));
  const cancelled: Array<(typeof candidates)[number]["entry"]> = [];
  const candidateIds = Array.from(beforeById.keys());
  for (let index = 0; index < candidateIds.length; index += 500) {
    const batch = await db.update(rosterEntry)
      .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
      .where(and(
        inArray(rosterEntry.id, candidateIds.slice(index, index + 500)),
        eq(rosterEntry.status, "ACTIVE"),
      ))
      .returning();
    cancelled.push(...batch);
  }
  if (cancelled.length === 0) return { cancelled: 0, auditFailed: false };

  const changes = cancelled.flatMap((entry) => {
    const before = beforeById.get(entry.id);
    if (!before || !entry.rosterPeriodId) return [];
    return [{
      rosterPeriodId: entry.rosterPeriodId,
      rosterEntryId: entry.id,
      staffId: entry.staffId,
      rosterDate: entry.rosterDate,
      action: "CANCELLED",
      before,
      after: entry,
      reason: `Cancelled because ${entry.rosterDate} is a public holiday.`,
      actorUserId,
    }];
  });

  try {
    if (changes.length > 0) {
      for (let index = 0; index < changes.length; index += 500) {
        await db.insert(rosterEntryChange).values(changes.slice(index, index + 500));
      }
      const periodGroups = new Map<string, { holidayDates: Set<string>; cancelledCells: number }>();
      for (const change of changes) {
        const group = periodGroups.get(change.rosterPeriodId) ?? {
          holidayDates: new Set<string>(),
          cancelledCells: 0,
        };
        group.holidayDates.add(change.rosterDate);
        group.cancelledCells += 1;
        periodGroups.set(change.rosterPeriodId, group);
      }
      const events = Array.from(periodGroups, ([periodId, group]) => ({
        eventType: "RosterEntryChanged",
        aggregateId: periodId,
        payload: {
          rosterPeriodId: periodId,
          holidayDates: Array.from(group.holidayDates),
          cancelledCells: group.cancelledCells,
          actorUserId,
        },
      }));
      for (let index = 0; index < events.length; index += 500) {
        await db.insert(workforceEvent).values(events.slice(index, index + 500));
      }
    }
    return { cancelled: cancelled.length, auditFailed: false };
  } catch (error) {
    console.error("Non-clinical holiday shifts were cancelled, but their audit records could not be completed.", error);
    return { cancelled: cancelled.length, auditFailed: true };
  }
};

router.get("/public-holidays", requireAnyRole([...READ_ROLES]), async (req, res, next) => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (Boolean(from) !== Boolean(to)) {
      throw validationError("Provide both holiday range dates or neither.", "HOLIDAY_DATE_RANGE_INVALID");
    }
    if (from && to && (
      !z.string().date().safeParse(from).success ||
      !z.string().date().safeParse(to).success ||
      from > to
    )) {
      throw validationError("Provide a valid holiday date range.", "HOLIDAY_DATE_RANGE_INVALID");
    }
    const holidays = from && to
      ? await db.select().from(publicHoliday).where(and(
        gte(publicHoliday.holidayDate, from),
        lte(publicHoliday.holidayDate, to),
      )).orderBy(asc(publicHoliday.holidayDate))
      : await db.select().from(publicHoliday).orderBy(asc(publicHoliday.holidayDate));
    res.json({ data: holidays });
  } catch (error) {
    next(error);
  }
});

router.post("/public-holidays/seed", requireAnyRole([...ADMIN_ROLES]), async (_req, res, next) => {
  try {
    const currentYear = (await nowAtFacility()).localDateTime.slice(0, 4);
    const insertedHolidayDates = await seedGhanaPublicHolidays(Number(currentYear), 5);
    const today = (await nowAtFacility()).localDateTime.slice(0, 10);
    const warnings: string[] = [];
    try {
      const reconciliation = await reconcileNonClinicalHolidayEntries(
        insertedHolidayDates,
        _req.user?.id ?? "system",
      );
      if (reconciliation.cancelled > 0) {
        warnings.push(`Cancelled ${reconciliation.cancelled} non-clinical roster shift(s) on newly added holidays.`);
      }
      if (reconciliation.auditFailed) {
        warnings.push("Holiday shifts were cancelled, but one or more audit records could not be saved.");
      }
    } catch (error) {
      console.error("Holidays were seeded, but non-clinical roster shifts could not be reconciled.", error);
      warnings.push("Holidays were seeded, but active non-clinical roster shifts could not be reconciled.");
    }
    try {
      await materializeFixedSchedules(today, addDays(today, 60));
    } catch (error) {
      console.error("Holidays were seeded, but fixed weekday schedules could not be refreshed.", error);
      warnings.push("Holidays were seeded, but fixed schedules could not be refreshed.");
    }
    res.json({ data: { inserted: insertedHolidayDates.length }, warnings });
  } catch (error) {
    next(error);
  }
});

router.post("/public-holidays", requireAnyRole([...ADMIN_ROLES]), async (req, res, next) => {
  try {
    const parsed = holidayInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Provide a holiday date and name.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const [created] = await db.insert(publicHoliday).values(parsed.data).returning();
    if (!created) throw badRequest("Unable to create public holiday.", "PUBLIC_HOLIDAY_CREATE_FAILED");
    const warnings: string[] = [];
    try {
      const reconciliation = await reconcileNonClinicalHolidayEntries(
        [created.holidayDate],
        req.user?.id ?? "system",
      );
      if (reconciliation.cancelled > 0) {
        warnings.push(`Cancelled ${reconciliation.cancelled} non-clinical roster shift(s) on the holiday.`);
      }
      if (reconciliation.auditFailed) {
        warnings.push("Holiday shifts were cancelled, but one or more audit records could not be saved.");
      }
    } catch (error) {
      console.error("Public holiday saved, but non-clinical roster shifts could not be reconciled.", error);
      warnings.push("Holiday saved, but active non-clinical roster shifts could not be reconciled.");
    }
    try {
      await refreshFixedSchedulesForHolidayChange(created.holidayDate);
    } catch (error) {
      console.error("Public holiday saved, but fixed weekday schedules could not be refreshed.", error);
      warnings.push("Holiday saved, but fixed schedules could not be refreshed.");
    }
    res.status(201).json({ data: created, warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A public holiday already exists on that date.", "PUBLIC_HOLIDAY_DATE_EXISTS"));
      return;
    }
    next(error);
  }
});

router.patch("/public-holidays/:date", requireAnyRole([...ADMIN_ROLES]), async (req, res, next) => {
  try {
    const holidayDate = routeId(req.params.date);
    if (!holidayDate || !z.string().date().safeParse(holidayDate).success) {
      throw validationError("Provide a valid holiday date.", "INVALID_HOLIDAY_DATE");
    }
    const parsed = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      holidayDate: z.string().date().optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Provide a holiday name or replacement date.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const [updated] = await db.update(publicHoliday)
      .set(parsed.data)
      .where(eq(publicHoliday.holidayDate, holidayDate))
      .returning();
    if (!updated) throw notFound("Public holiday not found.", "PUBLIC_HOLIDAY_NOT_FOUND");
    const warnings: string[] = [];
    try {
      const reconciliation = await reconcileNonClinicalHolidayEntries(
        [updated.holidayDate],
        req.user?.id ?? "system",
      );
      if (reconciliation.cancelled > 0) {
        warnings.push(`Cancelled ${reconciliation.cancelled} non-clinical roster shift(s) on the holiday.`);
      }
      if (reconciliation.auditFailed) {
        warnings.push("Holiday shifts were cancelled, but one or more audit records could not be saved.");
      }
    } catch (error) {
      console.error("Public holiday updated, but non-clinical roster shifts could not be reconciled.", error);
      warnings.push("Holiday updated, but active non-clinical roster shifts could not be reconciled.");
    }
    try {
      await refreshFixedSchedulesForHolidayChange(holidayDate);
      if (updated.holidayDate !== holidayDate) {
        await refreshFixedSchedulesForHolidayChange(updated.holidayDate);
      }
    } catch (error) {
      console.error("Public holiday updated, but fixed weekday schedules could not be refreshed.", error);
      warnings.push("Holiday updated, but fixed schedules could not be refreshed.");
    }
    res.json({ data: updated, warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("A public holiday already exists on that date.", "PUBLIC_HOLIDAY_DATE_EXISTS"));
      return;
    }
    next(error);
  }
});

router.delete("/public-holidays/:date", requireAnyRole([...ADMIN_ROLES]), async (req, res, next) => {
  try {
    const holidayDate = routeId(req.params.date);
    if (!holidayDate || !z.string().date().safeParse(holidayDate).success) {
      throw validationError("Provide a valid holiday date.", "INVALID_HOLIDAY_DATE");
    }
    const [deleted] = await db.delete(publicHoliday)
      .where(eq(publicHoliday.holidayDate, holidayDate))
      .returning();
    if (!deleted) throw notFound("Public holiday not found.", "PUBLIC_HOLIDAY_NOT_FOUND");
    const warnings: string[] = [];
    try {
      await refreshFixedSchedulesForHolidayChange(holidayDate);
    } catch (error) {
      console.error("Public holiday deleted, but fixed weekday schedules could not be refreshed.", error);
      warnings.push("Holiday deleted, but fixed schedules could not be refreshed.");
    }
    res.json({ data: deleted, warnings });
  } catch (error) {
    next(error);
  }
});

const scheduleQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
}).refine((range) =>
  range.from <= range.to &&
  periodDates({ startDate: range.from, endDate: range.to }).length <= 93,
);

const getScheduleForStaff = async (staffId: string, from: string, to: string) =>
  db.select({
    id: rosterEntry.id,
    staffId: rosterEntry.staffId,
    employeeId: staff.employeeId,
    staffName: sql<string>`concat(${staff.firstName}, ' ', ${staff.lastName})`,
    rosterPeriodId: rosterEntry.rosterPeriodId,
    orgUnitId: rosterEntry.orgUnitId,
    unitName: orgUnit.name,
    rosterDate: rosterEntry.rosterDate,
    shiftTypeId: rosterEntry.shiftTypeId,
    shiftName: shiftType.name,
    startTime: shiftType.startTime,
    endTime: shiftType.endTime,
    plannedStart: rosterEntry.plannedStart,
    plannedEnd: rosterEntry.plannedEnd,
    source: rosterEntry.source,
    status: rosterPeriod.status,
  }).from(rosterEntry)
    .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
    .innerJoin(orgUnit, eq(orgUnit.id, rosterEntry.orgUnitId))
    .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
    .leftJoin(rosterPeriod, eq(rosterPeriod.id, rosterEntry.rosterPeriodId))
    .where(and(
      eq(rosterEntry.staffId, staffId),
      eq(rosterEntry.status, "ACTIVE"),
      gte(rosterEntry.rosterDate, from),
      lte(rosterEntry.rosterDate, to),
      or(
        isNull(rosterEntry.rosterPeriodId),
        inArray(rosterPeriod.status, ["PUBLISHED", "LOCKED"]),
      ),
    ))
    .orderBy(asc(rosterEntry.rosterDate), asc(shiftType.startTime));

router.get("/me/schedule", requireAnyRole([...READ_ROLES, "STAFF"]), async (req, res, next) => {
  try {
    if (!req.user?.id) throw forbidden("Sign in to view your schedule.", "SCHEDULE_SELF_REQUIRED");
    const parsed = scheduleQuerySchema.safeParse({
      from: req.query.from,
      to: req.query.to,
    });
    if (!parsed.success) {
      throw validationError("Provide from and to dates spanning no more than 93 days.", "SCHEDULE_DATE_RANGE_INVALID");
    }
    const [person] = await db.select({ id: staff.id }).from(staff)
      .where(eq(staff.userId, req.user.id)).limit(1);
    if (!person) throw notFound("No staff profile is linked to this account.", "STAFF_PROFILE_NOT_FOUND");
    res.json({ data: await getScheduleForStaff(person.id, parsed.data.from, parsed.data.to) });
  } catch (error) {
    next(error);
  }
});

router.get("/staff/:staffId/schedule", requireAnyRole([...READ_ROLES, "STAFF"]), async (req, res, next) => {
  try {
    const staffId = routeId(req.params.staffId);
    if (!staffId) throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    const parsed = scheduleQuerySchema.safeParse({ from: req.query.from, to: req.query.to });
    if (!parsed.success) {
      throw validationError("Provide from and to dates spanning no more than 93 days.", "SCHEDULE_DATE_RANGE_INVALID");
    }
    const roles = getRoles(req.user?.roles);
    if (!hasAny(roles, READ_ROLES)) {
      const [person] = await db.select({ userId: staff.userId }).from(staff)
        .where(eq(staff.id, staffId)).limit(1);
      if (!person || person.userId !== req.user?.id) {
        throw forbidden("Staff may only view their own schedule.", "SCHEDULE_STAFF_FORBIDDEN");
      }
      res.json({ data: await getScheduleForStaff(staffId, parsed.data.from, parsed.data.to) });
      return;
    }

    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, roles) : [];
    const schedule = await getScheduleForStaff(staffId, parsed.data.from, parsed.data.to);
    const visibleSchedule = managedIds === null
      ? schedule
      : schedule.filter((entry) => managedIds.includes(entry.orgUnitId));
    res.json({ data: visibleSchedule });
  } catch (error) {
    next(error);
  }
});

router.get("/me/notifications", requireAnyRole([...READ_ROLES, "STAFF"]), async (req, res, next) => {
  try {
    if (!req.user?.id) throw forbidden("Sign in to view notifications.", "NOTIFICATION_SELF_REQUIRED");
    const [person] = await db.select({ id: staff.id }).from(staff)
      .where(eq(staff.userId, req.user.id)).limit(1);
    if (!person) throw notFound("No staff profile is linked to this account.", "STAFF_PROFILE_NOT_FOUND");
    const records = await db.select().from(notification).where(and(
      eq(notification.channel, "IN_APP"),
      eq(notification.recipientType, "STAFF"),
      eq(notification.recipientId, person.id),
    )).orderBy(desc(notification.createdAt)).limit(100);
    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.post("/me/notifications/:id/read", requireAnyRole([...READ_ROLES, "STAFF"]), async (req, res, next) => {
  try {
    if (!req.user?.id) throw forbidden("Sign in to update notifications.", "NOTIFICATION_SELF_REQUIRED");
    const notificationId = routeId(req.params.id);
    if (!notificationId) throw badRequest("Notification ID is required.", "NOTIFICATION_ID_REQUIRED");
    const [person] = await db.select({ id: staff.id }).from(staff)
      .where(eq(staff.userId, req.user.id)).limit(1);
    if (!person) throw notFound("No staff profile is linked to this account.", "STAFF_PROFILE_NOT_FOUND");
    const [updated] = await db.update(notification)
      .set({ status: "READ" })
      .where(and(
        eq(notification.id, notificationId),
        eq(notification.channel, "IN_APP"),
        eq(notification.recipientType, "STAFF"),
        eq(notification.recipientId, person.id),
      ))
      .returning({ id: notification.id });
    if (!updated) throw notFound("Notification not found.", "NOTIFICATION_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

const swapInputSchema = z.object({
  requesterEntryId: z.string().uuid(),
  counterpartyEntryId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

const getCurrentStaff = async (userId: string | undefined) => {
  if (!userId) throw forbidden("Sign in to manage shift swaps.", "SHIFT_SWAP_SELF_REQUIRED");
  const [person] = await db.select({
    id: staff.id,
    employeeId: staff.employeeId,
    firstName: staff.firstName,
    lastName: staff.lastName,
  }).from(staff).where(eq(staff.userId, userId)).limit(1);
  if (!person) throw notFound("No staff profile is linked to this account.", "STAFF_PROFILE_NOT_FOUND");
  return person;
};

router.get("/shift-swaps/eligible", requireAnyRole(["STAFF"]), async (req, res, next) => {
  try {
    const person = await getCurrentStaff(req.user?.id);
    const entryId = typeof req.query.entryId === "string" ? req.query.entryId : "";
    if (!z.string().uuid().safeParse(entryId).success) {
      throw validationError("Choose one of your shifts first.", "SHIFT_SWAP_ENTRY_REQUIRED");
    }
    const entry = await getSwapEntry(entryId);
    if (!entry || entry.staffId !== person.id || !entry.rosterPeriodId || entry.status !== "ACTIVE") {
      throw forbidden("You may only request swaps for your own active shifts.", "SHIFT_SWAP_REQUESTER_FORBIDDEN");
    }
    const period = await getPeriod(entry.rosterPeriodId);
    if (period.status !== "PUBLISHED") {
      throw validationError("Only published shifts can be swapped.", "SHIFT_SWAP_PERIOD_NOT_PUBLISHED");
    }
    const candidates = await db.select({
      id: rosterEntry.id,
      employeeId: staff.employeeId,
      staffName: sql<string>`concat(${staff.firstName}, ' ', ${staff.lastName})`,
      rosterDate: rosterEntry.rosterDate,
      shiftName: shiftType.name,
      shiftTypeId: rosterEntry.shiftTypeId,
    }).from(rosterEntry)
      .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
      .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
      .where(and(
        eq(rosterEntry.rosterPeriodId, period.id),
        eq(rosterEntry.status, "ACTIVE"),
        ne(rosterEntry.staffId, person.id),
      ))
      .orderBy(asc(rosterEntry.rosterDate), asc(staff.lastName), asc(staff.firstName));
    res.json({
      data: candidates.filter((candidate) =>
        candidate.rosterDate !== entry.rosterDate || candidate.shiftTypeId !== entry.shiftTypeId,
      ),
    });
  } catch (error) {
    next(error);
  }
});

const getSwapEntry = async (id: string) => {
  const [entry] = await db.select({
    id: rosterEntry.id,
    staffId: rosterEntry.staffId,
    rosterPeriodId: rosterEntry.rosterPeriodId,
    orgUnitId: rosterEntry.orgUnitId,
    rosterDate: rosterEntry.rosterDate,
    shiftTypeId: rosterEntry.shiftTypeId,
    plannedStart: rosterEntry.plannedStart,
    plannedEnd: rosterEntry.plannedEnd,
    source: rosterEntry.source,
    status: rosterEntry.status,
    version: rosterEntry.version,
    shiftName: shiftType.name,
    staffName: sql<string>`concat(${staff.firstName}, ' ', ${staff.lastName})`,
    employeeId: staff.employeeId,
  }).from(rosterEntry)
    .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
    .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
    .where(eq(rosterEntry.id, id))
    .limit(1);
  return entry ?? null;
};

router.get("/shift-swaps", requireAnyRole([...READ_ROLES, "STAFF"]), async (req, res, next) => {
  try {
    const roles = getRoles(req.user?.roles);
    const selfOnly = !hasAny(roles, READ_ROLES);
    const person = selfOnly ? await getCurrentStaff(req.user?.id) : null;
    const managedIds = selfOnly
      ? null
      : req.user?.id
        ? await resolveManagedUnitIds(req.user.id, roles)
        : [];
    const records = await db.select().from(shiftSwapRequest)
      .orderBy(desc(shiftSwapRequest.decidedAt))
      .limit(200);
    const data = [];
    for (const record of records) {
      const requester = await getSwapEntry(record.requesterEntryId);
      if (!requester) continue;
      const counterparty = record.counterpartyEntryId
        ? await getSwapEntry(record.counterpartyEntryId)
        : null;
      if (selfOnly && person?.id !== requester.staffId && person?.id !== counterparty?.staffId) continue;
      if (!selfOnly && managedIds !== null && !managedIds.includes(requester.orgUnitId)) continue;
      data.push({
        id: record.id,
        status: record.status,
        reason: record.reason,
        decidedAt: record.decidedAt,
        requester: {
          employeeId: requester.employeeId,
          name: requester.staffName,
          date: requester.rosterDate,
          shift: requester.shiftName,
        },
        counterparty: counterparty ? {
          employeeId: counterparty.employeeId,
          name: counterparty.staffName,
          date: counterparty.rosterDate,
          shift: counterparty.shiftName,
        } : null,
        canAccept: selfOnly && person?.id === counterparty?.staffId && record.status === "PENDING",
        canReject: selfOnly &&
          (person?.id === requester.staffId || person?.id === counterparty?.staffId) &&
          ["PENDING", "ACCEPTED"].includes(record.status),
      });
    }
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/shift-swaps", requireAnyRole(["STAFF"]), async (req, res, next) => {
  try {
    const parsed = swapInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Choose both shifts and provide a reason.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const person = await getCurrentStaff(req.user?.id);
    if (parsed.data.requesterEntryId === parsed.data.counterpartyEntryId) {
      throw validationError("Choose two different shifts.", "SHIFT_SWAP_SAME_ENTRY");
    }
    const [requester, counterparty] = await Promise.all([
      getSwapEntry(parsed.data.requesterEntryId),
      getSwapEntry(parsed.data.counterpartyEntryId),
    ]);
    if (!requester || !counterparty) throw notFound("One of the selected shifts no longer exists.", "ROSTER_ENTRY_NOT_FOUND");
    if (requester.staffId !== person.id) {
      throw forbidden("You may only request swaps for your own shifts.", "SHIFT_SWAP_REQUESTER_FORBIDDEN");
    }
    if (requester.staffId === counterparty.staffId) {
      throw validationError("Choose a shift assigned to another staff member.", "SHIFT_SWAP_SAME_STAFF");
    }
    if (
      requester.status !== "ACTIVE" ||
      counterparty.status !== "ACTIVE" ||
      !requester.rosterPeriodId ||
      requester.rosterPeriodId !== counterparty.rosterPeriodId
    ) {
      throw validationError("Both shifts must be active in the same roster period.", "SHIFT_SWAP_PERIOD_INVALID");
    }
    const period = await getPeriod(requester.rosterPeriodId);
    if (period.status !== "PUBLISHED") {
      throw validationError("Shift swaps are available only for published rosters.", "SHIFT_SWAP_PERIOD_NOT_PUBLISHED");
    }
    if (requester.rosterDate === counterparty.rosterDate && requester.shiftTypeId === counterparty.shiftTypeId) {
      throw validationError("The selected shifts are identical and do not need to be swapped.", "SHIFT_SWAP_IDENTICAL_SHIFTS");
    }
    const [created] = await db.insert(shiftSwapRequest).values({
      requesterEntryId: requester.id,
      counterpartyEntryId: counterparty.id,
      reason: parsed.data.reason,
      status: "PENDING",
    }).returning();
    if (!created) throw badRequest("Unable to create shift swap request.", "SHIFT_SWAP_CREATE_FAILED");
    res.status(201).json({ data: { id: created.id, status: created.status } });
  } catch (error) {
    next(error);
  }
});

router.post("/shift-swaps/:id/accept", requireAnyRole(["STAFF"]), async (req, res, next) => {
  try {
    const swapId = routeId(req.params.id);
    if (!swapId) throw badRequest("Shift swap ID is required.", "SHIFT_SWAP_ID_REQUIRED");
    const person = await getCurrentStaff(req.user?.id);
    const [request] = await db.select().from(shiftSwapRequest)
      .where(eq(shiftSwapRequest.id, swapId)).limit(1);
    if (!request || !request.counterpartyEntryId) {
      throw notFound("Shift swap request not found.", "SHIFT_SWAP_NOT_FOUND");
    }
    const counterparty = await getSwapEntry(request.counterpartyEntryId);
    if (!counterparty || counterparty.staffId !== person.id) {
      throw forbidden("Only the selected counterparty may accept this request.", "SHIFT_SWAP_ACCEPT_FORBIDDEN");
    }
    const [updated] = await db.update(shiftSwapRequest)
      .set({ status: "ACCEPTED", decidedBy: req.user?.id ?? null, decidedAt: new Date() })
      .where(and(eq(shiftSwapRequest.id, request.id), eq(shiftSwapRequest.status, "PENDING")))
      .returning();
    if (!updated) throw conflict("This swap request is no longer pending.", "SHIFT_SWAP_NOT_PENDING");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/shift-swaps/:id/reject", requireAnyRole(["STAFF", ...READ_ROLES]), async (req, res, next) => {
  try {
    const swapId = routeId(req.params.id);
    if (!swapId) throw badRequest("Shift swap ID is required.", "SHIFT_SWAP_ID_REQUIRED");
    const [request] = await db.select().from(shiftSwapRequest)
      .where(eq(shiftSwapRequest.id, swapId)).limit(1);
    if (!request) throw notFound("Shift swap request not found.", "SHIFT_SWAP_NOT_FOUND");
    const roles = getRoles(req.user?.roles);
    if (!hasAny(roles, READ_ROLES)) {
      const person = await getCurrentStaff(req.user?.id);
      const requester = await getSwapEntry(request.requesterEntryId);
      const counterparty = request.counterpartyEntryId
        ? await getSwapEntry(request.counterpartyEntryId)
        : null;
      if (person.id !== requester?.staffId && person.id !== counterparty?.staffId) {
        throw forbidden("Only the swap participants may reject this request.", "SHIFT_SWAP_REJECT_FORBIDDEN");
      }
    } else {
      const requester = await getSwapEntry(request.requesterEntryId);
      if (!requester) throw notFound("Roster entry not found.", "ROSTER_ENTRY_NOT_FOUND");
      await ensureUnitAccess(req.user?.id, roles, requester.orgUnitId);
    }
    const [updated] = await db.update(shiftSwapRequest)
      .set({ status: "REJECTED", decidedBy: req.user?.id ?? null, decidedAt: new Date() })
      .where(and(
        eq(shiftSwapRequest.id, request.id),
        inArray(shiftSwapRequest.status, ["PENDING", "ACCEPTED"]),
      ))
      .returning();
    if (!updated) throw conflict("Only pending or accepted swap requests may be rejected.", "SHIFT_SWAP_NOT_REJECTABLE");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/shift-swaps/:id/approve", requireAnyRole(["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER"]), async (req, res, next) => {
  try {
    const swapId = routeId(req.params.id);
    if (!swapId) throw badRequest("Shift swap ID is required.", "SHIFT_SWAP_ID_REQUIRED");
    const [request] = await db.select().from(shiftSwapRequest)
      .where(eq(shiftSwapRequest.id, swapId)).limit(1);
    if (!request || !request.counterpartyEntryId) {
      throw notFound("Accepted shift swap request not found.", "SHIFT_SWAP_NOT_FOUND");
    }
    if (request.status !== "ACCEPTED") throw conflict("Only accepted swaps can be approved.", "SHIFT_SWAP_NOT_ACCEPTED");
    const [requesterEntry, counterpartyEntry] = await Promise.all([
      getSwapEntry(request.requesterEntryId),
      getSwapEntry(request.counterpartyEntryId),
    ]);
    if (
      !requesterEntry || !counterpartyEntry ||
      requesterEntry.status !== "ACTIVE" ||
      counterpartyEntry.status !== "ACTIVE" ||
      !requesterEntry.rosterPeriodId ||
      requesterEntry.rosterPeriodId !== counterpartyEntry.rosterPeriodId
    ) {
      throw conflict("The shifts changed after this request was accepted.", "SHIFT_SWAP_ENTRIES_CHANGED");
    }
    const period = await getPeriod(requesterEntry.rosterPeriodId);
    await ensureUnitAccess(req.user?.id, getRoles(req.user?.roles), period.orgUnitId);
    if (period.status !== "PUBLISHED") throw conflict("Only published rosters can be swapped.", "SHIFT_SWAP_PERIOD_NOT_PUBLISHED");

    const requesterReplacement: RosterRuleEntry = {
      staffId: counterpartyEntry.staffId,
      orgUnitId: period.orgUnitId,
      rosterDate: requesterEntry.rosterDate,
      shiftTypeId: requesterEntry.shiftTypeId,
      plannedStart: requesterEntry.plannedStart,
      plannedEnd: requesterEntry.plannedEnd,
      source: "SWAP",
      inPeriod: true,
    };
    const counterpartyReplacement: RosterRuleEntry = {
      staffId: requesterEntry.staffId,
      orgUnitId: period.orgUnitId,
      rosterDate: counterpartyEntry.rosterDate,
      shiftTypeId: counterpartyEntry.shiftTypeId,
      plannedStart: counterpartyEntry.plannedStart,
      plannedEnd: counterpartyEntry.plannedEnd,
      source: "SWAP",
      inPeriod: true,
    };
    const originalEntries = [requesterEntry, counterpartyEntry];
    const originalIds = originalEntries.map((entry) => entry.id);
    const { context } = await buildRuleContext(period, new Map(), {
      additionalEntries: [requesterReplacement, counterpartyReplacement],
      excludedEntryIds: new Set(originalIds),
    });
    const violations = validateRoster(context);
    if (violations.some((violation) => violation.level === "error")) {
      res.status(422).json({ error: "The swap violates roster rules.", code: "SHIFT_SWAP_VALIDATION_FAILED", violations });
      return;
    }

    const cancelled = await db.update(rosterEntry)
      .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
      .where(and(
        inArray(rosterEntry.id, originalIds),
        eq(rosterEntry.status, "ACTIVE"),
      ))
      .returning();
    if (cancelled.length !== 2) {
      if (cancelled.length > 0) {
        await db.update(rosterEntry).set({ status: "ACTIVE" })
          .where(inArray(rosterEntry.id, cancelled.map((entry) => entry.id)));
      }
      throw conflict("One or both shifts changed while approving the swap.", "SHIFT_SWAP_ENTRIES_CHANGED");
    }

    let swappedEntries: Array<typeof rosterEntry.$inferSelect> = [];
    try {
      swappedEntries = await db.insert(rosterEntry).values([
        {
          rosterPeriodId: period.id,
          staffId: requesterReplacement.staffId,
          orgUnitId: period.orgUnitId,
          rosterDate: requesterReplacement.rosterDate,
          shiftTypeId: requesterReplacement.shiftTypeId,
          plannedStart: requesterReplacement.plannedStart instanceof Date
            ? requesterReplacement.plannedStart
            : new Date(requesterReplacement.plannedStart),
          plannedEnd: requesterReplacement.plannedEnd instanceof Date
            ? requesterReplacement.plannedEnd
            : new Date(requesterReplacement.plannedEnd),
          source: "SWAP",
          status: "ACTIVE",
        },
        {
          rosterPeriodId: period.id,
          staffId: counterpartyReplacement.staffId,
          orgUnitId: period.orgUnitId,
          rosterDate: counterpartyReplacement.rosterDate,
          shiftTypeId: counterpartyReplacement.shiftTypeId,
          plannedStart: counterpartyReplacement.plannedStart instanceof Date
            ? counterpartyReplacement.plannedStart
            : new Date(counterpartyReplacement.plannedStart),
          plannedEnd: counterpartyReplacement.plannedEnd instanceof Date
            ? counterpartyReplacement.plannedEnd
            : new Date(counterpartyReplacement.plannedEnd),
          source: "SWAP",
          status: "ACTIVE",
        },
      ]).returning();
      const [approved] = await db.update(shiftSwapRequest)
        .set({ status: "APPROVED", decidedBy: req.user?.id ?? null, decidedAt: new Date() })
        .where(and(eq(shiftSwapRequest.id, request.id), eq(shiftSwapRequest.status, "ACCEPTED")))
        .returning();
      if (!approved) throw conflict("Swap request changed while approving.", "SHIFT_SWAP_STATUS_CONFLICT");
    } catch (error) {
      if (swappedEntries.length > 0) {
        await db.update(rosterEntry)
          .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
          .where(inArray(rosterEntry.id, swappedEntries.map((entry) => entry.id)));
      }
      try {
        await db.update(rosterEntry)
          .set({ status: "ACTIVE", version: sql`${rosterEntry.version} + 1` })
          .where(inArray(rosterEntry.id, originalIds));
      } catch (compensationError) {
        console.error("Shift swap compensation failed; manually review the affected roster.", {
          swapId: request.id,
          entryIds: originalIds,
          compensationError,
        });
      }
      throw error;
    }

    const warnings: string[] = [];
    try {
      await db.insert(rosterEntryChange).values(originalEntries.map((entry, index) => ({
        rosterPeriodId: period.id,
        rosterEntryId: swappedEntries[index]?.id ?? null,
        staffId: swappedEntries[index]?.staffId ?? entry.staffId,
        rosterDate: entry.rosterDate,
        action: "UPDATED",
        before: entry,
        after: swappedEntries[index] ?? null,
        reason: `Approved shift swap ${request.id}`,
        actorUserId: req.user?.id ?? "system",
      })));
      await db.insert(workforceEvent).values({
        eventType: "RosterEntryChanged",
        aggregateId: period.id,
        payload: { rosterPeriodId: period.id, shiftSwapRequestId: request.id },
      });
      const swappedStaffIds = Array.from(new Set(swappedEntries.map((entry) => entry.staffId)));
      await db.insert(notification).values(swappedStaffIds.map((recipientId) => ({
        channel: "IN_APP",
        recipientType: "STAFF",
        recipientId,
        template: "SHIFT_SWAP_APPROVED",
        payload: { unitName: period.unitName },
        status: "SENT",
        sentAt: new Date(),
        relatedEntityType: "roster_period",
        relatedEntityId: period.id,
      })));
    } catch (error) {
      console.error("Shift swap approved, but its audit or notification records could not be completed.", error);
      warnings.push("Swap approved, but its audit or in-app notifications could not be recorded.");
    }
    res.json({ data: { status: "APPROVED" }, violations, warnings });
  } catch (error) {
    if (isDatabaseConflict(error)) {
      next(conflict("The swap would create an overlapping or duplicate roster entry.", "SHIFT_SWAP_ENTRY_CONFLICT"));
      return;
    }
    next(error);
  }
});

export default router;
