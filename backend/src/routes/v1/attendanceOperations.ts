import { and, desc, eq, exists, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  attendanceCorrection,
  attendanceDevice,
  attendanceException,
  attendancePilotSetup,
  attendanceRecord,
  auditLog,
  manualPunchRequest,
  orgUnit,
  publicHoliday,
  rosterEntry,
  shiftType,
  staff,
  staffAssignment,
  userUnitScope,
} from "../../db/schema/index.js";
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from "../../lib/errors.js";
import { requireAnyRole } from "../../lib/platform.js";
import {
  applyAttendanceCorrection,
  applyManualPunch,
} from "../../lib/attendanceOperations.js";

const router = Router();

const HR_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"] as const;
const GLOBAL_READ_ROLES = [
  ...HR_ROLES,
  "PAYROLL_OFFICER",
  "ACCOUNTS",
] as const;
const ATTENDANCE_READ_ROLES = [...GLOBAL_READ_ROLES, "UNIT_MANAGER"] as const;
const ATTENDANCE_WRITE_ROLES = [...HR_ROLES, "UNIT_MANAGER"] as const;
const MAX_ROWS = 1000;

const staffSummary = {
  staffId: staff.id,
  employeeId: staff.employeeId,
  firstName: staff.firstName,
  lastName: staff.lastName,
};

const requestActor = (req: Request) => {
  if (!req.user?.id) throw forbidden("An authenticated user is required.");
  return {
    userId: req.user.id,
    roles: req.user.roles ?? [],
  };
};

const parseUuid = (value: unknown, field: string) => {
  const parsed = z.string().uuid().safeParse(
    Array.isArray(value) ? value[0] : value,
  );
  if (!parsed.success) {
    throw validationError(`${field} must be a valid identifier.`, "VALIDATION_FAILED", {
      fieldErrors: { [field]: ["A valid identifier is required."] },
    });
  }
  return parsed.data;
};

const parseDate = (value: unknown, field: string, required = false) => {
  if (value === undefined && !required) return undefined;
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(value);
  if (!parsed.success || Number.isNaN(Date.parse(`${parsed.data ?? ""}T00:00:00Z`))) {
    throw validationError(`${field} must be a valid YYYY-MM-DD date.`, "VALIDATION_FAILED", {
      fieldErrors: { [field]: ["Use a valid YYYY-MM-DD date."] },
    });
  }
  const [year, month, day] = (parsed.data ?? "").split("-").map(Number);
  const check = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== (month ?? 1) - 1 ||
    check.getUTCDate() !== day
  ) {
    throw validationError(`${field} must be a valid YYYY-MM-DD date.`, "VALIDATION_FAILED", {
      fieldErrors: { [field]: ["Use a valid YYYY-MM-DD date."] },
    });
  }
  return parsed.data;
};

const validateDateRange = (from: string | undefined, to: string | undefined) => {
  if (from && to && from > to) {
    throw validationError("The start date must not be after the end date.", "DATE_RANGE_INVALID");
  }
};

const getUnitScope = async (userId: string, roles: readonly string[]) => {
  if (roles.some((role) => GLOBAL_READ_ROLES.includes(role as typeof GLOBAL_READ_ROLES[number]))) {
    return null;
  }
  const scopes = await db.select({
    orgUnitId: userUnitScope.orgUnitId,
    includeDescendants: userUnitScope.includeDescendants,
  }).from(userUnitScope).where(eq(userUnitScope.userId, userId));

  const allowed = new Set(scopes.map((scope) => scope.orgUnitId));
  let frontier = scopes
    .filter((scope) => scope.includeDescendants)
    .map((scope) => scope.orgUnitId);
  while (frontier.length > 0) {
    const children = await db.select({ id: orgUnit.id, parentId: orgUnit.parentId })
      .from(orgUnit)
      .where(inArray(orgUnit.parentId, frontier));
    frontier = children
      .map((unit) => unit.id)
      .filter((id) => !allowed.has(id));
    frontier.forEach((id) => allowed.add(id));
  }
  return [...allowed];
};

const checkUnitAccess = (
  requestedUnitId: string | undefined,
  allowedUnitIds: string[] | null,
) => {
  if (
    requestedUnitId &&
    allowedUnitIds !== null &&
    !allowedUnitIds.includes(requestedUnitId)
  ) {
    throw forbidden("You do not have attendance access to this unit.");
  }
};

const assertRecordScope = async (
  record: { orgUnitId: string | null },
  allowedUnitIds: string[] | null,
) => {
  if (
    allowedUnitIds !== null &&
    (!record.orgUnitId || !allowedUnitIds.includes(record.orgUnitId))
  ) {
    throw notFound("Attendance record not found.", "ATTENDANCE_NOT_FOUND");
  }
};

const assertStaffScope = async (
  staffId: string,
  date: string,
  allowedUnitIds: string[] | null,
) => {
  if (allowedUnitIds === null) return;
  if (allowedUnitIds.length === 0) {
    throw forbidden("You do not have attendance access to this employee.");
  }
  const assignments = await db.select({ orgUnitId: staffAssignment.orgUnitId })
    .from(staffAssignment)
    .where(and(
      eq(staffAssignment.staffId, staffId),
      lte(staffAssignment.effectiveFrom, date),
      or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, date)),
    ));
  if (!assignments.some(({ orgUnitId }) => allowedUnitIds.includes(orgUnitId))) {
    throw forbidden("You do not have attendance access to this employee.");
  }
};

const addAuditEntry = async (
  req: Request,
  values: {
    action: "CREATE" | "UPDATE";
    entityType: string;
    entityId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    orgUnitId?: string | null;
  },
) => {
  const actor = requestActor(req);
  await db.insert(auditLog).values({
    action: values.action,
    entityType: values.entityType,
    entityId: values.entityId,
    actorUserId: actor.userId,
    actorRoles: actor.roles,
    requestId: req.requestId ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    patientId: null,
    orgUnitId: values.orgUnitId ?? null,
    reason: values.reason,
    before: values.before ?? null,
    after: values.after ?? null,
  });
};

const attendanceWhere = ({
  from,
  to,
  staffId,
  unitId,
  allowedUnitIds,
}: {
  from: string | undefined;
  to: string | undefined;
  staffId: string | undefined;
  unitId: string | undefined;
  allowedUnitIds: string[] | null;
}) => {
  const predicates = [];
  if (from) predicates.push(gte(attendanceRecord.attendanceDate, from));
  if (to) predicates.push(lte(attendanceRecord.attendanceDate, to));
  if (staffId) predicates.push(eq(attendanceRecord.staffId, staffId));
  if (unitId) predicates.push(eq(attendanceRecord.orgUnitId, unitId));
  if (allowedUnitIds !== null) {
    predicates.push(
      allowedUnitIds.length > 0
        ? inArray(attendanceRecord.orgUnitId, allowedUnitIds)
        : sql`false`,
    );
  }
  return and(...predicates);
};

const selectAttendanceRows = async (where: ReturnType<typeof attendanceWhere>) =>
  db.select({
    attendanceRecordId: attendanceRecord.id,
    ...staffSummary,
    attendanceDate: attendanceRecord.attendanceDate,
    clockInAt: attendanceRecord.clockInAt,
    clockOutAt: attendanceRecord.clockOutAt,
    status: attendanceRecord.status,
    source: attendanceRecord.source,
    workedMinutes: attendanceRecord.workedMinutes,
    lateMinutes: attendanceRecord.lateMinutes,
    earlyLeaveMinutes: attendanceRecord.earlyLeaveMinutes,
    overtimeMinutes: attendanceRecord.overtimeMinutes,
    unitName: orgUnit.name,
    shiftName: shiftType.name,
  }).from(attendanceRecord)
    .innerJoin(staff, eq(staff.id, attendanceRecord.staffId))
    .leftJoin(orgUnit, eq(orgUnit.id, attendanceRecord.orgUnitId))
    .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
    .where(where)
    .orderBy(desc(attendanceRecord.attendanceDate), desc(attendanceRecord.clockInAt))
    .limit(MAX_ROWS);

router.get(
  "/attendance/references",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const referenceDate = new Date().toISOString().slice(0, 10);
      let staffIds: string[] | null = null;
      if (allowedUnitIds !== null) {
        if (allowedUnitIds.length === 0) {
          staffIds = [];
        } else {
          const assignments = await db.select({
            staffId: staffAssignment.staffId,
          }).from(staffAssignment)
            .where(and(
              inArray(staffAssignment.orgUnitId, allowedUnitIds),
              lte(staffAssignment.effectiveFrom, referenceDate),
              or(
                isNull(staffAssignment.effectiveTo),
                gte(staffAssignment.effectiveTo, referenceDate),
              ),
            ));
          staffIds = [...new Set(assignments.map((assignment) => assignment.staffId))];
        }
      }

      const employeePredicates = [eq(staff.status, "active")];
      if (staffIds !== null) {
        employeePredicates.push(staffIds.length > 0
          ? inArray(staff.id, staffIds)
          : sql`false`);
      }
      const [employees, units] = await Promise.all([
        db.select({
          id: staff.id,
          firstName: staff.firstName,
          lastName: staff.lastName,
          employeeId: staff.employeeId,
          email: staff.email,
        }).from(staff).where(and(...employeePredicates)),
        db.select({
          id: orgUnit.id,
          parentId: orgUnit.parentId,
          code: orgUnit.code,
          name: orgUnit.name,
          unitType: orgUnit.unitType,
          isClinical: orgUnit.isClinical,
          operates24h: orgUnit.operates24h,
          active: orgUnit.active,
        }).from(orgUnit).where(and(
          eq(orgUnit.active, true),
          ...(allowedUnitIds === null
            ? []
            : allowedUnitIds.length > 0
              ? [inArray(orgUnit.id, allowedUnitIds)]
              : [sql`false`]),
        )),
      ]);
      res.json({ data: { staff: employees, units } });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const from = parseDate(req.query.from, "from");
      const to = parseDate(req.query.to, "to");
      validateDateRange(from, to);
      const staffId = req.query.staffId === undefined
        ? undefined
        : parseUuid(req.query.staffId, "staffId");
      const unitId = req.query.unitId === undefined
        ? undefined
        : parseUuid(req.query.unitId, "unitId");
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      checkUnitAccess(unitId, allowedUnitIds);
      const records = await selectAttendanceRows(attendanceWhere({
        from,
        to,
        staffId,
        unitId,
        allowedUnitIds,
      }));
      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/me/attendance",
  requireAnyRole(["STAFF", ...ATTENDANCE_READ_ROLES]),
  async (req, res, next) => {
    try {
      const actor = requestActor(req);
      const [person] = await db.select({ id: staff.id })
        .from(staff).where(eq(staff.userId, actor.userId)).limit(1);
      if (!person) {
        throw notFound("The current user is not linked to an employee record.", "STAFF_PROFILE_NOT_LINKED");
      }
      const from = parseDate(req.query.from, "from");
      const to = parseDate(req.query.to, "to");
      validateDateRange(from, to);
      const records = await selectAttendanceRows(attendanceWhere({
        from,
        to,
        staffId: person.id,
        unitId: undefined,
        allowedUnitIds: null,
      }));
      res.json({ data: records });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/exceptions",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const status = req.query.status === undefined ? "OPEN" : String(req.query.status);
      if (!["OPEN", "EXCUSED", "CONFIRMED", "RESOLVED"].includes(status)) {
        throw validationError("status is not supported.", "VALIDATION_FAILED");
      }
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const predicates = [eq(attendanceException.status, status)];
      const unitId = req.query.unitId === undefined
        ? undefined
        : parseUuid(req.query.unitId, "unitId");
      checkUnitAccess(unitId, allowedUnitIds);
      const from = parseDate(req.query.from, "from");
      const to = parseDate(req.query.to, "to");
      validateDateRange(from, to);
      if (from) predicates.push(gte(attendanceException.exceptionDate, from));
      if (to) predicates.push(lte(attendanceException.exceptionDate, to));
      if (allowedUnitIds !== null) {
        predicates.push(allowedUnitIds.length > 0
          ? or(
            inArray(attendanceRecord.orgUnitId, allowedUnitIds),
            inArray(rosterEntry.orgUnitId, allowedUnitIds),
            and(
              isNull(attendanceRecord.id),
              isNull(rosterEntry.id),
              exists(db.select({ id: staffAssignment.id }).from(staffAssignment)
                .where(and(
                  eq(staffAssignment.staffId, attendanceException.staffId),
                  lte(staffAssignment.effectiveFrom, attendanceException.exceptionDate),
                  or(
                    isNull(staffAssignment.effectiveTo),
                    gte(staffAssignment.effectiveTo, attendanceException.exceptionDate),
                  ),
                  inArray(staffAssignment.orgUnitId, allowedUnitIds),
                ))),
            ),
          )!
          : sql`false`);
      }
      if (unitId) {
        predicates.push(or(
          eq(attendanceRecord.orgUnitId, unitId),
          eq(rosterEntry.orgUnitId, unitId),
          and(
            isNull(attendanceRecord.id),
            isNull(rosterEntry.id),
            exists(db.select({ id: staffAssignment.id }).from(staffAssignment)
              .where(and(
                eq(staffAssignment.staffId, attendanceException.staffId),
                lte(staffAssignment.effectiveFrom, attendanceException.exceptionDate),
                or(
                  isNull(staffAssignment.effectiveTo),
                  gte(staffAssignment.effectiveTo, attendanceException.exceptionDate),
                ),
                eq(staffAssignment.orgUnitId, unitId),
              ))),
          ),
        )!);
      }
      const exceptions = await db.select({
        exceptionId: attendanceException.id,
        ...staffSummary,
        attendanceDate: attendanceException.exceptionDate,
        exceptionType: attendanceException.exceptionType,
        status: attendanceException.status,
        note: attendanceException.note,
        recordStatus: attendanceRecord.status,
        unitName: orgUnit.name,
        resolvedAt: attendanceException.resolvedAt,
      }).from(attendanceException)
        .innerJoin(staff, eq(staff.id, attendanceException.staffId))
        .leftJoin(attendanceRecord, eq(attendanceRecord.id, attendanceException.attendanceRecordId))
        .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceException.rosterEntryId))
        .leftJoin(orgUnit, eq(
          orgUnit.id,
          sql`COALESCE(${attendanceRecord.orgUnitId}, ${rosterEntry.orgUnitId})`,
        ))
        .where(and(...predicates))
        .orderBy(desc(attendanceException.exceptionDate), desc(attendanceException.id))
        .limit(MAX_ROWS);
      res.json({ data: exceptions });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/attendance/exceptions/:exceptionId/resolve",
  requireAnyRole(ATTENDANCE_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const exceptionId = parseUuid(req.params.exceptionId, "exceptionId");
      const body = z.object({
        action: z.enum(["EXCUSE", "CONFIRM"]),
        reason: z.string().trim().min(3).max(500),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("Choose how to resolve the exception and provide a reason.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const [exception] = await db.select({
        exception: attendanceException,
        recordUnitId: attendanceRecord.orgUnitId,
        rosterUnitId: rosterEntry.orgUnitId,
        attendanceRecordLinkId: attendanceException.attendanceRecordId,
        rosterEntryLinkId: attendanceException.rosterEntryId,
      }).from(attendanceException)
        .leftJoin(attendanceRecord, eq(attendanceRecord.id, attendanceException.attendanceRecordId))
        .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceException.rosterEntryId))
        .where(eq(attendanceException.id, exceptionId))
        .limit(1);
      if (!exception) throw notFound("Attendance exception not found.", "ATTENDANCE_EXCEPTION_NOT_FOUND");
      if (
        allowedUnitIds !== null &&
        ![exception.recordUnitId, exception.rosterUnitId].some(
          (unitId) => unitId && allowedUnitIds.includes(unitId),
        )
      ) {
        const isUnlinked = !exception.attendanceRecordLinkId && !exception.rosterEntryLinkId;
        const assignments = isUnlinked && allowedUnitIds.length > 0
          ? await db.select({ id: staffAssignment.id })
            .from(staffAssignment)
            .where(and(
              eq(staffAssignment.staffId, exception.exception.staffId),
              lte(staffAssignment.effectiveFrom, exception.exception.exceptionDate),
              or(
                isNull(staffAssignment.effectiveTo),
                gte(staffAssignment.effectiveTo, exception.exception.exceptionDate),
              ),
              inArray(staffAssignment.orgUnitId, allowedUnitIds),
            ))
            .limit(1)
          : [];
        if (assignments.length === 0) {
          throw notFound("Attendance exception not found.", "ATTENDANCE_EXCEPTION_NOT_FOUND");
        }
      }
      if (exception.exception.status !== "OPEN") {
        throw conflict("Only open attendance exceptions can be resolved.", "ATTENDANCE_EXCEPTION_ALREADY_RESOLVED");
      }
      const nextStatus = body.data.action === "EXCUSE" ? "EXCUSED" : "CONFIRMED";
      const priorNote = exception.exception.note?.trim();
      const [updated] = await db.update(attendanceException)
        .set({
          status: nextStatus,
          resolvedBy: actor.userId,
          resolvedAt: new Date(),
          note: [priorNote, `${body.data.action}: ${body.data.reason}`].filter(Boolean).join("\n"),
        })
        .where(and(
          eq(attendanceException.id, exceptionId),
          eq(attendanceException.status, "OPEN"),
        ))
        .returning({
          id: attendanceException.id,
          status: attendanceException.status,
          resolvedAt: attendanceException.resolvedAt,
        });
      if (!updated) throw conflict("This exception was resolved by another user.", "CONCURRENT_MODIFICATION");
      await addAuditEntry(req, {
        action: "UPDATE",
        entityType: "attendance_exception",
        entityId: exceptionId,
        reason: body.data.reason,
        before: { status: "OPEN" },
        after: { status: nextStatus },
        orgUnitId: exception.recordUnitId ?? exception.rosterUnitId,
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/corrections",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const status = req.query.status === undefined ? undefined : String(req.query.status);
      if (status && !["PENDING", "APPLYING", "APPROVED", "REJECTED"].includes(status)) {
        throw validationError("status is not supported.", "VALIDATION_FAILED");
      }
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const predicates = [];
      if (status) predicates.push(eq(attendanceCorrection.status, status));
      if (allowedUnitIds !== null) {
        predicates.push(allowedUnitIds.length > 0
          ? inArray(attendanceRecord.orgUnitId, allowedUnitIds)
          : sql`false`);
      }
      const corrections = await db.select({
        correctionId: attendanceCorrection.id,
        ...staffSummary,
        attendanceDate: attendanceRecord.attendanceDate,
        oldClockIn: attendanceCorrection.oldClockIn,
        oldClockOut: attendanceCorrection.oldClockOut,
        newClockIn: attendanceCorrection.newClockIn,
        newClockOut: attendanceCorrection.newClockOut,
        reason: attendanceCorrection.reason,
        requestedAt: attendanceCorrection.requestedAt,
        requestedBy: attendanceCorrection.requestedBy,
        status: attendanceCorrection.status,
        decisionReason: attendanceCorrection.decisionReason,
        unitName: orgUnit.name,
      }).from(attendanceCorrection)
        .innerJoin(attendanceRecord, eq(attendanceRecord.id, attendanceCorrection.attendanceRecordId))
        .innerJoin(staff, eq(staff.id, attendanceRecord.staffId))
        .leftJoin(orgUnit, eq(orgUnit.id, attendanceRecord.orgUnitId))
        .where(and(...predicates))
        .orderBy(desc(attendanceCorrection.requestedAt))
        .limit(MAX_ROWS);
      res.json({ data: corrections });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/attendance/:attendanceId/corrections",
  requireAnyRole(["STAFF", ...ATTENDANCE_WRITE_ROLES]),
  async (req, res, next) => {
    try {
      const attendanceId = parseUuid(req.params.attendanceId, "attendanceId");
      const body = z.object({
        newClockIn: z.string().datetime({ offset: true }),
        newClockOut: z.string().datetime({ offset: true }),
        reason: z.string().trim().min(5).max(1000),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("Provide both corrected clock times and a reason.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const newClockIn = new Date(body.data.newClockIn);
      const newClockOut = new Date(body.data.newClockOut);
      if (newClockOut <= newClockIn) {
        throw validationError("Clock-out must be later than clock-in.", "ATTENDANCE_TIME_RANGE_INVALID");
      }
      const actor = requestActor(req);
      const [record] = await db.select({
        record: attendanceRecord,
        userId: staff.userId,
      }).from(attendanceRecord)
        .innerJoin(staff, eq(staff.id, attendanceRecord.staffId))
        .where(eq(attendanceRecord.id, attendanceId))
        .limit(1);
      if (!record) throw notFound("Attendance record not found.", "ATTENDANCE_NOT_FOUND");
      const isSelf = record.userId === actor.userId;
      if (actor.roles.includes("STAFF") && !isSelf) {
        throw notFound("Attendance record not found.", "ATTENDANCE_NOT_FOUND");
      }
      if (!isSelf || actor.roles.some((role) => ATTENDANCE_WRITE_ROLES.includes(role as typeof ATTENDANCE_WRITE_ROLES[number]))) {
        const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
        await assertRecordScope(record.record, allowedUnitIds);
      }
      if (!record.record.clockOutAt || !["CLOSED", "AUTO_CLOSED"].includes(record.record.status)) {
        throw conflict("Only closed attendance records can be corrected.", "ATTENDANCE_RECORD_NOT_CLOSED");
      }

      const [created] = await db.insert(attendanceCorrection).values({
        attendanceRecordId: attendanceId,
        oldClockIn: record.record.clockInAt,
        oldClockOut: record.record.clockOutAt,
        newClockIn,
        newClockOut,
        reason: body.data.reason,
        requestedBy: actor.userId,
      }).returning({
        correctionId: attendanceCorrection.id,
        status: attendanceCorrection.status,
        requestedAt: attendanceCorrection.requestedAt,
      });
      if (!created) throw new Error("The attendance correction request could not be created.");
      await addAuditEntry(req, {
        action: "CREATE",
        entityType: "attendance_correction",
        entityId: created.correctionId,
        reason: body.data.reason,
        before: {
          clockInAt: record.record.clockInAt,
          clockOutAt: record.record.clockOutAt,
        },
        after: { newClockIn, newClockOut, status: created.status },
        orgUnitId: record.record.orgUnitId,
      });
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/attendance/corrections/:correctionId/decision",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const correctionId = parseUuid(req.params.correctionId, "correctionId");
      const body = z.object({
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().trim().min(3).max(500),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("A decision and reason are required.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const actor = requestActor(req);
      const [correction] = await db.select().from(attendanceCorrection)
        .where(eq(attendanceCorrection.id, correctionId))
        .limit(1);
      if (!correction) throw notFound("Attendance correction request not found.", "CORRECTION_NOT_FOUND");
      if (correction.status !== "PENDING") {
        throw conflict("Only pending correction requests can be decided.", "CORRECTION_ALREADY_DECIDED");
      }
      if (correction.requestedBy === actor.userId) {
        throw forbidden("A correction request must be approved by a different user.", "SELF_APPROVAL_FORBIDDEN");
      }

      const nextStatus = body.data.decision === "APPROVE" ? "APPLYING" : "REJECTED";
      const [claimed] = await db.update(attendanceCorrection)
        .set({
          status: nextStatus,
          approvedBy: actor.userId,
          approvedAt: new Date(),
          applyClaimToken: null,
          applyClaimedAt: null,
          decisionReason: body.data.reason,
        })
        .where(and(
          eq(attendanceCorrection.id, correctionId),
          eq(attendanceCorrection.status, "PENDING"),
        ))
        .returning({ id: attendanceCorrection.id });
      if (!claimed) throw conflict("This correction request was decided by another user.", "CONCURRENT_MODIFICATION");
      const outcome = nextStatus === "APPLYING"
        ? await applyAttendanceCorrection(correctionId)
        : { id: correctionId, status: nextStatus };
      if (!outcome) {
        throw conflict("This correction is already being applied.", "ATTENDANCE_APPROVAL_IN_PROGRESS");
      }
      await addAuditEntry(req, {
        action: "UPDATE",
        entityType: "attendance_correction",
        entityId: correctionId,
        reason: body.data.reason,
        before: { status: "PENDING" },
        after: { status: outcome.status },
      });
      res.json({ data: { id: correctionId, status: outcome.status } });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/manual-punch-requests",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const status = req.query.status === undefined ? undefined : String(req.query.status);
      if (status && !["PENDING", "APPLYING", "APPROVED", "REJECTED"].includes(status)) {
        throw validationError("status is not supported.", "VALIDATION_FAILED");
      }
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const predicates = [];
      if (status) predicates.push(eq(manualPunchRequest.status, status));
      if (allowedUnitIds !== null) {
        predicates.push(allowedUnitIds.length > 0
          ? exists(db.select({ id: staffAssignment.id }).from(staffAssignment)
            .where(and(
              eq(staffAssignment.staffId, manualPunchRequest.staffId),
              lte(staffAssignment.effectiveFrom, sql`CAST(${manualPunchRequest.punchedAt} AS date)`),
              or(
                isNull(staffAssignment.effectiveTo),
                gte(staffAssignment.effectiveTo, sql`CAST(${manualPunchRequest.punchedAt} AS date)`),
              ),
              inArray(staffAssignment.orgUnitId, allowedUnitIds),
            )))
          : sql`false`);
      }
      const requests = await db.select({
        requestId: manualPunchRequest.id,
        ...staffSummary,
        punchedAt: manualPunchRequest.punchedAt,
        direction: manualPunchRequest.direction,
        reason: manualPunchRequest.reason,
        requestedAt: manualPunchRequest.requestedAt,
        requestedBy: manualPunchRequest.requestedBy,
        status: manualPunchRequest.status,
        decisionReason: manualPunchRequest.decisionReason,
      }).from(manualPunchRequest)
        .innerJoin(staff, eq(staff.id, manualPunchRequest.staffId))
        .where(and(...predicates))
        .orderBy(desc(manualPunchRequest.requestedAt))
        .limit(MAX_ROWS);
      res.json({ data: requests });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/attendance/manual-punch",
  requireAnyRole(ATTENDANCE_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = z.object({
        staffId: z.string().uuid(),
        punchedAt: z.string().datetime({ offset: true }),
        direction: z.enum(["IN", "OUT"]),
        reason: z.string().trim().min(5).max(1000),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("Employee, time, direction, and reason are required.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      const punchedAt = new Date(body.data.punchedAt);
      if (punchedAt > new Date()) {
        throw validationError("A manual punch cannot be scheduled in the future.", "ATTENDANCE_FUTURE_PUNCH");
      }
      await assertStaffScope(
        body.data.staffId,
        punchedAt.toISOString().slice(0, 10),
        allowedUnitIds,
      );
      const [person] = await db.select({ id: staff.id })
        .from(staff).where(eq(staff.id, body.data.staffId)).limit(1);
      if (!person) throw notFound("Employee not found.", "STAFF_NOT_FOUND");
      const [created] = await db.insert(manualPunchRequest).values({
        staffId: body.data.staffId,
        punchedAt,
        direction: body.data.direction,
        reason: body.data.reason,
        requestedBy: actor.userId,
      }).returning({
        requestId: manualPunchRequest.id,
        status: manualPunchRequest.status,
        requestedAt: manualPunchRequest.requestedAt,
      });
      if (!created) throw new Error("The manual punch request could not be created.");
      await addAuditEntry(req, {
        action: "CREATE",
        entityType: "manual_punch_request",
        entityId: created.requestId,
        reason: body.data.reason,
        after: { status: created.status, direction: body.data.direction, punchedAt },
      });
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/attendance/manual-punch-requests/:requestId/decision",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const requestId = parseUuid(req.params.requestId, "requestId");
      const body = z.object({
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().trim().min(3).max(500),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("A decision and reason are required.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      const actor = requestActor(req);
      const [request] = await db.select().from(manualPunchRequest)
        .where(eq(manualPunchRequest.id, requestId))
        .limit(1);
      if (!request) throw notFound("Manual punch request not found.", "MANUAL_PUNCH_NOT_FOUND");
      if (request.status !== "PENDING") {
        throw conflict("Only pending manual punch requests can be decided.", "MANUAL_PUNCH_ALREADY_DECIDED");
      }
      if (request.requestedBy === actor.userId) {
        throw forbidden("A manual punch must be approved by a different user.", "SELF_APPROVAL_FORBIDDEN");
      }
      const nextStatus = body.data.decision === "APPROVE" ? "APPLYING" : "REJECTED";
      const [claimed] = await db.update(manualPunchRequest)
        .set({
          status: nextStatus,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          applyClaimToken: null,
          applyClaimedAt: null,
          decisionReason: body.data.reason,
        })
        .where(and(
          eq(manualPunchRequest.id, requestId),
          eq(manualPunchRequest.status, "PENDING"),
        ))
        .returning({ id: manualPunchRequest.id });
      if (!claimed) throw conflict("This manual punch was decided by another user.", "CONCURRENT_MODIFICATION");
      const outcome = nextStatus === "APPLYING"
        ? await applyManualPunch(requestId)
        : { id: requestId, status: nextStatus };
      if (!outcome) {
        throw conflict("This manual punch is already being applied.", "ATTENDANCE_APPROVAL_IN_PROGRESS");
      }
      await addAuditEntry(req, {
        action: "UPDATE",
        entityType: "manual_punch_request",
        entityId: requestId,
        reason: body.data.reason,
        before: { status: "PENDING" },
        after: { status: outcome.status },
      });
      res.json({ data: { id: requestId, status: outcome.status } });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/summary",
  requireAnyRole(ATTENDANCE_READ_ROLES),
  async (req, res, next) => {
    try {
      const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(req.query.month);
      if (!month.success) {
        throw validationError("month must use YYYY-MM format.", "VALIDATION_FAILED", {
          fieldErrors: { month: ["Use YYYY-MM."] },
        });
      }
      const [yearText, monthText] = month.data.split("-");
      const year = Number(yearText);
      const monthNumber = Number(monthText);
      if (monthNumber < 1 || monthNumber > 12) {
        throw validationError("month must use a valid calendar month.", "VALIDATION_FAILED");
      }
      const from = `${month.data}-01`;
      const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
      const unitId = req.query.unitId === undefined
        ? undefined
        : parseUuid(req.query.unitId, "unitId");
      const actor = requestActor(req);
      const allowedUnitIds = await getUnitScope(actor.userId, actor.roles);
      checkUnitAccess(unitId, allowedUnitIds);
      const unitIds = unitId ? [unitId] : allowedUnitIds;
      const base = unitIds === null
        ? undefined
        : unitIds.length > 0
          ? inArray(rosterEntry.orgUnitId, unitIds)
          : sql`false`;
      const recordsBase = unitIds === null
        ? undefined
        : unitIds.length > 0
          ? inArray(attendanceRecord.orgUnitId, unitIds)
          : sql`false`;

      const rosterRows = await db.select({
        ...staffSummary,
        attendanceDate: rosterEntry.rosterDate,
        shiftCategory: shiftType.category,
      }).from(rosterEntry)
        .innerJoin(staff, eq(staff.id, rosterEntry.staffId))
        .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
        .where(and(
          eq(rosterEntry.status, "ACTIVE"),
          gte(rosterEntry.rosterDate, from),
          lte(rosterEntry.rosterDate, to),
          ...(base ? [base] : []),
        ));
      const attendanceRows = await db.select({
        ...staffSummary,
        attendanceDate: attendanceRecord.attendanceDate,
        workedMinutes: attendanceRecord.workedMinutes,
        lateMinutes: attendanceRecord.lateMinutes,
        overtimeMinutes: attendanceRecord.overtimeMinutes,
        shiftCategory: shiftType.category,
      }).from(attendanceRecord)
        .innerJoin(staff, eq(staff.id, attendanceRecord.staffId))
        .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
        .where(and(
          gte(attendanceRecord.attendanceDate, from),
          lte(attendanceRecord.attendanceDate, to),
          ...(recordsBase ? [recordsBase] : []),
        ));
      const absencePredicates = [
        eq(attendanceException.exceptionType, "ABSENT"),
        gte(attendanceException.exceptionDate, from),
        lte(attendanceException.exceptionDate, to),
        sql`${attendanceException.status} <> 'EXCUSED'`,
      ];
      if (unitIds !== null) {
        absencePredicates.push(unitIds.length > 0
          ? or(
            inArray(attendanceRecord.orgUnitId, unitIds),
            inArray(rosterEntry.orgUnitId, unitIds),
          )!
          : sql`false`);
      }
      const absenceRows = await db.select({
        ...staffSummary,
      }).from(attendanceException)
        .innerJoin(staff, eq(staff.id, attendanceException.staffId))
        .leftJoin(attendanceRecord, eq(attendanceRecord.id, attendanceException.attendanceRecordId))
        .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceException.rosterEntryId))
        .where(and(...absencePredicates));
      const holidayRows = await db.select({ date: publicHoliday.holidayDate })
        .from(publicHoliday)
        .where(and(
          gte(publicHoliday.holidayDate, from),
          lte(publicHoliday.holidayDate, to),
        ));
      const holidays = new Set(holidayRows.map(({ date }) => date));
      const summary = new Map<string, {
        staffId: string;
        employeeId: string;
        firstName: string;
        lastName: string;
        scheduled: number;
        worked: number;
        absent: number;
        late: number;
        lateMinutes: number;
        overtimeMinutes: number;
        night: number;
        weekend: number;
        holiday: number;
        workedMinutes: number;
      }>();
      const getRow = (person: { staffId: string; employeeId: string; firstName: string; lastName: string }) => {
        let row = summary.get(person.staffId);
        if (!row) {
          row = {
            ...person,
            scheduled: 0,
            worked: 0,
            absent: 0,
            late: 0,
            lateMinutes: 0,
            overtimeMinutes: 0,
            night: 0,
            weekend: 0,
            holiday: 0,
            workedMinutes: 0,
          };
          summary.set(person.staffId, row);
        }
        return row;
      };
      for (const roster of rosterRows) getRow(roster).scheduled += 1;
      for (const record of attendanceRows) {
        const row = getRow(record);
        row.worked += 1;
        row.workedMinutes += record.workedMinutes ?? 0;
        row.lateMinutes += record.lateMinutes;
        row.overtimeMinutes += record.overtimeMinutes;
        if (record.lateMinutes > 0) row.late += 1;
        const weekday = new Date(`${record.attendanceDate}T00:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6) row.weekend += 1;
        if (holidays.has(record.attendanceDate)) row.holiday += 1;
        if (record.shiftCategory === "NIGHT") row.night += 1;
      }
      for (const absent of absenceRows) getRow(absent).absent += 1;
      res.json({
        data: [...summary.values()].sort((left, right) =>
          left.lastName.localeCompare(right.lastName) ||
          left.firstName.localeCompare(right.firstName),
        ),
        month: month.data,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/devices/health",
  requireAnyRole(HR_ROLES),
  async (_req, res, next) => {
    try {
      const now = new Date();
      const devices = await db.select({
        deviceId: attendanceDevice.id,
        code: attendanceDevice.code,
        name: attendanceDevice.name,
        deviceType: attendanceDevice.deviceType,
        status: attendanceDevice.status,
        createdAt: attendanceDevice.createdAt,
        lastSeenAt: attendanceDevice.lastSeenAt,
        healthAlertedAt: attendanceDevice.healthAlertedAt,
        orgUnitName: orgUnit.name,
      }).from(attendanceDevice)
        .leftJoin(orgUnit, eq(orgUnit.id, attendanceDevice.orgUnitId))
        .where(eq(attendanceDevice.status, "ACTIVE"))
        .orderBy(attendanceDevice.name);
      res.json({
        data: devices.map((device) => ({
          ...device,
          online: Boolean(device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() <= 15 * 60_000),
          alert: Boolean(device.healthAlertedAt),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/pilot",
  requireAnyRole(HR_ROLES),
  async (_req, res, next) => {
    try {
      const [setup] = await db.select({
        wardUnitId: attendancePilotSetup.wardUnitId,
        officeUnitId: attendancePilotSetup.officeUnitId,
        fingerprintDeviceId: attendancePilotSetup.fingerprintDeviceId,
        qrDeviceId: attendancePilotSetup.qrDeviceId,
        wardName: orgUnit.name,
        wardCode: orgUnit.code,
        trainingSignedBy: attendancePilotSetup.trainingSignedBy,
        trainingSignedAt: attendancePilotSetup.trainingSignedAt,
        tuningConfirmedAt: attendancePilotSetup.tuningConfirmedAt,
        updatedAt: attendancePilotSetup.updatedAt,
        fingerprintDeviceName: attendanceDevice.name,
        fingerprintDeviceCode: attendanceDevice.code,
      }).from(attendancePilotSetup)
        .innerJoin(orgUnit, eq(orgUnit.id, attendancePilotSetup.wardUnitId))
        .innerJoin(attendanceDevice, eq(attendanceDevice.id, attendancePilotSetup.fingerprintDeviceId))
        .where(eq(attendancePilotSetup.scope, "RELEASE1"))
        .limit(1);
      if (!setup) {
        res.json({ data: null });
        return;
      }

      const [office] = await db.select({
        name: orgUnit.name,
        code: orgUnit.code,
      }).from(orgUnit)
        .innerJoin(attendancePilotSetup, eq(attendancePilotSetup.officeUnitId, orgUnit.id))
        .where(eq(attendancePilotSetup.scope, "RELEASE1"))
        .limit(1);
      const [qrDevice] = await db.select({
        name: attendanceDevice.name,
        code: attendanceDevice.code,
      }).from(attendanceDevice)
        .innerJoin(attendancePilotSetup, eq(attendancePilotSetup.qrDeviceId, attendanceDevice.id))
        .where(eq(attendancePilotSetup.scope, "RELEASE1"))
        .limit(1);
      res.json({
        data: {
          wardUnitId: setup.wardUnitId,
          officeUnitId: setup.officeUnitId,
          fingerprintDeviceId: setup.fingerprintDeviceId,
          qrDeviceId: setup.qrDeviceId,
          ward: { name: setup.wardName, code: setup.wardCode },
          office: office ?? null,
          fingerprintDevice: {
            name: setup.fingerprintDeviceName,
            code: setup.fingerprintDeviceCode,
          },
          qrDevice: qrDevice ?? null,
          trainingSignedBy: setup.trainingSignedBy,
          trainingSignedAt: setup.trainingSignedAt,
          tuningConfirmedAt: setup.tuningConfirmedAt,
          updatedAt: setup.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/attendance/pilot",
  requireAnyRole(HR_ROLES),
  async (req, res, next) => {
    try {
      const body = z.object({
        wardUnitId: z.string().uuid(),
        officeUnitId: z.string().uuid(),
        fingerprintDeviceId: z.string().uuid(),
        qrDeviceId: z.string().uuid(),
        trainingCompleted: z.boolean(),
        tuningConfirmed: z.boolean(),
      }).safeParse(req.body);
      if (!body.success) {
        throw validationError("Pilot units, devices, and completion checks are required.", "VALIDATION_FAILED", {
          fieldErrors: body.error.flatten().fieldErrors,
        });
      }
      if (body.data.wardUnitId === body.data.officeUnitId ||
        body.data.fingerprintDeviceId === body.data.qrDeviceId) {
        throw validationError("Choose different units and devices for the ward and office pilot.", "ATTENDANCE_PILOT_CONFIGURATION_INVALID");
      }

      const actor = requestActor(req);
      const [ward] = await db.select({
        id: orgUnit.id,
        name: orgUnit.name,
        code: orgUnit.code,
        unitType: orgUnit.unitType,
      }).from(orgUnit).where(eq(orgUnit.id, body.data.wardUnitId)).limit(1);
      const [office] = await db.select({
        id: orgUnit.id,
        name: orgUnit.name,
        code: orgUnit.code,
        isClinical: orgUnit.isClinical,
      }).from(orgUnit).where(eq(orgUnit.id, body.data.officeUnitId)).limit(1);
      const [fingerprint] = await db.select({
        id: attendanceDevice.id,
        name: attendanceDevice.name,
        code: attendanceDevice.code,
        deviceType: attendanceDevice.deviceType,
        orgUnitId: attendanceDevice.orgUnitId,
        status: attendanceDevice.status,
      }).from(attendanceDevice).where(eq(attendanceDevice.id, body.data.fingerprintDeviceId)).limit(1);
      const [qr] = await db.select({
        id: attendanceDevice.id,
        name: attendanceDevice.name,
        code: attendanceDevice.code,
        deviceType: attendanceDevice.deviceType,
        orgUnitId: attendanceDevice.orgUnitId,
        status: attendanceDevice.status,
      }).from(attendanceDevice).where(eq(attendanceDevice.id, body.data.qrDeviceId)).limit(1);
      if (!ward || ward.unitType !== "WARD") {
        throw validationError("Select an organization unit configured as a ward.", "ATTENDANCE_PILOT_WARD_REQUIRED");
      }
      if (!office || office.isClinical) {
        throw validationError("Select a non-clinical unit for the admin office pilot.", "ATTENDANCE_PILOT_OFFICE_REQUIRED");
      }
      if (
        !fingerprint ||
        fingerprint.deviceType !== "FINGERPRINT_TERMINAL" ||
        fingerprint.status !== "ACTIVE" ||
        fingerprint.orgUnitId !== ward.id
      ) {
        throw validationError("The active fingerprint terminal must be assigned to the selected ward.", "ATTENDANCE_PILOT_FINGERPRINT_DEVICE_REQUIRED");
      }
      if (
        !qr ||
        qr.deviceType !== "QR_SCANNER" ||
        qr.status !== "ACTIVE" ||
        qr.orgUnitId !== office.id
      ) {
        throw validationError("The active QR scanner must be assigned to the selected admin office.", "ATTENDANCE_PILOT_QR_DEVICE_REQUIRED");
      }

      const now = new Date();
      const [existing] = await db.select({
        trainingSignedBy: attendancePilotSetup.trainingSignedBy,
        trainingSignedAt: attendancePilotSetup.trainingSignedAt,
        tuningConfirmedAt: attendancePilotSetup.tuningConfirmedAt,
      }).from(attendancePilotSetup)
        .where(eq(attendancePilotSetup.scope, "RELEASE1"))
        .limit(1);
      const [saved] = await db.insert(attendancePilotSetup).values({
        scope: "RELEASE1",
        wardUnitId: ward.id,
        officeUnitId: office.id,
        fingerprintDeviceId: fingerprint.id,
        qrDeviceId: qr.id,
        trainingSignedBy: body.data.trainingCompleted
          ? existing?.trainingSignedBy ?? actor.userId
          : null,
        trainingSignedAt: body.data.trainingCompleted
          ? existing?.trainingSignedAt ?? now
          : null,
        tuningConfirmedAt: body.data.tuningConfirmed
          ? existing?.tuningConfirmedAt ?? now
          : null,
        updatedBy: actor.userId,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: attendancePilotSetup.scope,
        set: {
          wardUnitId: ward.id,
          officeUnitId: office.id,
          fingerprintDeviceId: fingerprint.id,
          qrDeviceId: qr.id,
          trainingSignedBy: body.data.trainingCompleted
            ? existing?.trainingSignedBy ?? actor.userId
            : null,
          trainingSignedAt: body.data.trainingCompleted
            ? existing?.trainingSignedAt ?? now
            : null,
          tuningConfirmedAt: body.data.tuningConfirmed
            ? existing?.tuningConfirmedAt ?? now
            : null,
          updatedBy: actor.userId,
          updatedAt: now,
        },
      }).returning({ scope: attendancePilotSetup.scope });
      if (!saved) throw new Error("The attendance pilot setup could not be saved.");
      await addAuditEntry(req, {
        action: "UPDATE",
        entityType: "attendance_pilot_setup",
        entityId: saved.scope,
        reason: "Release 1 attendance pilot readiness update.",
        after: {
          wardUnitId: ward.id,
          officeUnitId: office.id,
          fingerprintDeviceCode: fingerprint.code,
          qrDeviceCode: qr.code,
          trainingCompleted: body.data.trainingCompleted,
          tuningConfirmed: body.data.tuningConfirmed,
        },
      });
      res.json({
        data: {
          wardUnitId: ward.id,
          officeUnitId: office.id,
          fingerprintDeviceId: fingerprint.id,
          qrDeviceId: qr.id,
          ward: { name: ward.name, code: ward.code },
          office: { name: office.name, code: office.code },
          fingerprintDevice: { name: fingerprint.name, code: fingerprint.code },
          qrDevice: { name: qr.name, code: qr.code },
          trainingSignedAt: body.data.trainingCompleted
            ? existing?.trainingSignedAt ?? now
            : null,
          tuningConfirmedAt: body.data.tuningConfirmed
            ? existing?.tuningConfirmedAt ?? now
            : null,
          updatedAt: now,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/attendance/me/corrections",
  requireAnyRole(["STAFF", ...ATTENDANCE_READ_ROLES]),
  async (req, res, next) => {
    try {
      const actor = requestActor(req);
      const corrections = await db.select({
        correctionId: attendanceCorrection.id,
        attendanceDate: attendanceRecord.attendanceDate,
        oldClockIn: attendanceCorrection.oldClockIn,
        oldClockOut: attendanceCorrection.oldClockOut,
        newClockIn: attendanceCorrection.newClockIn,
        newClockOut: attendanceCorrection.newClockOut,
        reason: attendanceCorrection.reason,
        requestedAt: attendanceCorrection.requestedAt,
        status: attendanceCorrection.status,
        decisionReason: attendanceCorrection.decisionReason,
      }).from(attendanceCorrection)
        .innerJoin(attendanceRecord, eq(attendanceRecord.id, attendanceCorrection.attendanceRecordId))
        .innerJoin(staff, eq(staff.id, attendanceRecord.staffId))
        .where(eq(attendanceCorrection.requestedBy, actor.userId))
        .orderBy(desc(attendanceCorrection.requestedAt))
        .limit(MAX_ROWS);
      res.json({ data: corrections });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
