import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db/index.js";
import {
  attendanceException,
  attendanceRecord,
  attendanceDevice,
  consent,
  punchLog,
  rosterEntry,
  rosterPeriod,
  shiftType,
  staff,
  staffAssignment,
  staffCredential,
  overtimeRequest,
} from "../db/schema/index.js";
import {
  attendanceClockOutDeadline,
  calculateAttendanceMetrics,
  credentialIsUsable,
  decideOpenPunch,
  facilityDate,
  findNearestShift,
  punchHasClockSkew,
  punchIsDebounced,
  punchIsTooFarInFuture,
  type AttendanceShiftCandidate,
} from "./attendance.js";
import { resolveFacilityTimezone } from "./facilityClock.js";

type PunchOutcome =
  | "ACCEPTED"
  | "DUPLICATE"
  | "UNKNOWN_CREDENTIAL"
  | "INACTIVE_STAFF"
  | "BIOMETRIC_CONSENT_REQUIRED"
  | "REJECTED_FUTURE_TIME";

type CredentialIdentity = {
  staffId: string;
  status: string;
  credentialStatus: string;
  credentialExpiresAt: Date | null;
};

const isUniqueViolation = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: string }).code === "23505");

const localLocks = new Map<string, Promise<void>>();
const MAX_CONCURRENT_PREFLIGHTS = 16;
let activePreflights = 0;
const preflightWaiters: Array<() => void> = [];

export const withPreflightLimit = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (activePreflights >= MAX_CONCURRENT_PREFLIGHTS) {
    await new Promise<void>((resolve) => preflightWaiters.push(resolve));
  }
  activePreflights += 1;
  try {
    return await operation();
  } finally {
    activePreflights -= 1;
    preflightWaiters.shift()?.();
  }
};

const withStaffLock = async <T>(staffId: string, operation: () => Promise<T>) => {
  const previous = localLocks.get(staffId) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  localLocks.set(staffId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localLocks.get(staffId) === current) localLocks.delete(staffId);
  }
};

const findCredentialIdentity = async (
  credentialType: string,
  credentialRef: string,
  activeOnly: boolean,
  asOf: Date,
): Promise<CredentialIdentity | undefined> => {
  const conditions = [
    eq(staffCredential.credentialType, credentialType),
    eq(staffCredential.credentialRef, credentialRef),
  ];
  if (activeOnly) {
    conditions.push(eq(staffCredential.status, "ACTIVE"));
    conditions.push(or(isNull(staffCredential.expiresAt), gte(staffCredential.expiresAt, asOf))!);
  }
  const [identity] = await db
    .select({
      staffId: staff.id,
      status: staff.status,
      credentialStatus: staffCredential.status,
      credentialExpiresAt: staffCredential.expiresAt,
    })
    .from(staffCredential)
    .innerJoin(staff, eq(staff.id, staffCredential.staffId))
    .where(and(...conditions))
    .limit(1);
  return identity;
};

export const preflightPunch = async ({
  credentialType,
  credentialRef,
  punchedAt,
  receivedAt,
}: {
  credentialType: string;
  credentialRef: string;
  punchedAt: Date;
  receivedAt: Date;
}): Promise<{ outcome: PunchOutcome | null; staffId: string | null }> => {
  const activeIdentity = await findCredentialIdentity(
    credentialType,
    credentialRef,
    true,
    receivedAt,
  );
  const identity = activeIdentity ?? await findCredentialIdentity(
    credentialType,
    credentialRef,
    false,
    receivedAt,
  );
  if (
    !activeIdentity ||
    !credentialIsUsable(activeIdentity.credentialStatus, activeIdentity.credentialExpiresAt, receivedAt)
  ) {
    return { outcome: "UNKNOWN_CREDENTIAL", staffId: identity?.staffId ?? null };
  }
  if (activeIdentity.status !== "active") {
    return { outcome: "INACTIVE_STAFF", staffId: activeIdentity.staffId };
  }
  if (credentialType === "FINGERPRINT") {
    const [latestConsent] = await db.select({
      status: consent.status,
      withdrawnAt: consent.withdrawnAt,
    }).from(consent)
      .where(and(
        eq(consent.subjectType, "STAFF"),
        eq(consent.subjectId, activeIdentity.staffId),
        eq(consent.consentType, "BIOMETRIC_ATTENDANCE"),
      ))
      .orderBy(sql`${consent.createdAt} DESC`)
      .limit(1);
    if (latestConsent?.status !== "GRANTED" || latestConsent.withdrawnAt) {
      return { outcome: "BIOMETRIC_CONSENT_REQUIRED", staffId: activeIdentity.staffId };
    }
  }
  if (punchIsTooFarInFuture(punchedAt, receivedAt)) {
    return { outcome: "REJECTED_FUTURE_TIME", staffId: activeIdentity.staffId };
  }
  return { outcome: null, staffId: activeIdentity.staffId };
};

const logException = async ({
  staffId,
  exceptionDate,
  exceptionType,
  attendanceRecordId,
  rosterEntryId,
  note,
}: {
  staffId: string;
  exceptionDate: string;
  exceptionType: string;
  attendanceRecordId?: string | null;
  rosterEntryId?: string | null;
  note?: string | null;
}) => {
  await db.insert(attendanceException).values({
    staffId,
    exceptionDate,
    exceptionType,
    attendanceRecordId: attendanceRecordId ?? null,
    rosterEntryId: rosterEntryId ?? null,
    note: note ?? null,
  });
};

const updatePunch = async (
  punchId: string,
  values: { staffId?: string | null; result: string; processed: boolean },
) => {
  await db.update(punchLog)
    .set({ ...values, processingStartedAt: null })
    .where(eq(punchLog.id, punchId));
};

const findOpenAttendance = async (staffId: string) => {
  const [open] = await db
    .select({
      record: attendanceRecord,
      roster: rosterEntry,
      shift: shiftType,
    })
    .from(attendanceRecord)
    .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceRecord.rosterEntryId))
    .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
    .where(and(eq(attendanceRecord.staffId, staffId), eq(attendanceRecord.status, "OPEN")))
    .limit(1);
  return open;
};

const getApprovedOvertimeMinutes = async (attendanceRecordId: string) => {
  const requests = await db.select({ minutes: overtimeRequest.minutes })
    .from(overtimeRequest)
    .where(and(
      eq(overtimeRequest.attendanceRecordId, attendanceRecordId),
      eq(overtimeRequest.status, "APPROVED"),
    ));
  return requests.reduce((total, request) => total + request.minutes, 0);
};

const findClockInShift = async (staffId: string, punchedAt: Date) => {
  const candidates = await db
    .select({
      entry: rosterEntry,
      shift: shiftType,
      periodStatus: rosterPeriod.status,
    })
    .from(rosterEntry)
    .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
    .leftJoin(rosterPeriod, eq(rosterPeriod.id, rosterEntry.rosterPeriodId))
    .where(and(
      eq(rosterEntry.staffId, staffId),
      eq(rosterEntry.status, "ACTIVE"),
      lte(rosterEntry.plannedStart, new Date(punchedAt.getTime() + 24 * 60 * 60_000)),
      gte(rosterEntry.plannedEnd, new Date(punchedAt.getTime() - 24 * 60 * 60_000)),
    ));

  const eligible = candidates.filter(({ entry, periodStatus }) =>
    (!entry.rosterPeriodId || periodStatus === "PUBLISHED" || periodStatus === "LOCKED"),
  );
  const existing = eligible.length === 0
    ? []
    : await db
      .select({ rosterEntryId: attendanceRecord.rosterEntryId })
      .from(attendanceRecord)
      .where(and(
        inArray(attendanceRecord.rosterEntryId, eligible.map(({ entry }) => entry.id)),
        sql`${attendanceRecord.rosterEntryId} IS NOT NULL`,
      ));
  const used = new Set(existing.map((row) => row.rosterEntryId));
  const byId = new Map(eligible.map((candidate) => [candidate.entry.id, candidate]));
  const nearest = findNearestShift(
    eligible
      .filter(({ entry }) => !used.has(entry.id))
      .map(({ entry, shift }): AttendanceShiftCandidate => ({
        id: entry.id,
        rosterDate: entry.rosterDate,
        plannedStart: entry.plannedStart,
        plannedEnd: entry.plannedEnd,
        earlyInMinutes: shift.earlyInMinutes,
      })),
    punchedAt,
  );
  return nearest ? byId.get(nearest.id) : undefined;
};

const getEffectiveUnitId = async (staffId: string, onDate: string) => {
  const assignments = await db
    .select({
      id: staffAssignment.orgUnitId,
      type: staffAssignment.assignmentType,
      effectiveFrom: staffAssignment.effectiveFrom,
    })
    .from(staffAssignment)
    .where(and(
      eq(staffAssignment.staffId, staffId),
      lte(staffAssignment.effectiveFrom, onDate),
      or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, onDate)),
    ))
    .orderBy(sql`CASE WHEN ${staffAssignment.assignmentType} IN ('TEMPORARY', 'COVER') THEN 0 ELSE 1 END`);
  assignments.sort((left, right) =>
    left.type === right.type
      ? right.effectiveFrom.localeCompare(left.effectiveFrom)
      : (left.type === "TEMPORARY" || left.type === "COVER" ? 0 : 1) -
        (right.type === "TEMPORARY" || right.type === "COVER" ? 0 : 1),
  );
  return assignments[0]?.id ?? null;
};

const markClockSkew = async (punch: typeof punchLog.$inferSelect, timeZone: string) => {
  const skewSeconds = Math.trunc((punch.punchedAt.getTime() - punch.receivedAt.getTime()) / 1000);
  if (!punchHasClockSkew(punch.punchedAt, punch.receivedAt)) return;

  await db.update(attendanceDevice)
    .set({ lastClockSkewSeconds: skewSeconds })
    .where(eq(attendanceDevice.id, punch.deviceId));
  if (punch.staffId) {
    await logException({
      staffId: punch.staffId,
      exceptionDate: facilityDate(punch.punchedAt, timeZone),
      exceptionType: "DEVICE_CLOCK_SKEW",
      note: `Device timestamp differed from server time by ${skewSeconds} seconds.`,
    });
  }
};

const autoClose = async (
  open: NonNullable<Awaited<ReturnType<typeof findOpenAttendance>>>,
) => {
  const { record, roster, shift } = open;
  const plannedEnd = roster?.plannedEnd ?? new Date(record.clockInAt.getTime() + 16 * 60 * 60_000);
  const closeAt = new Date(Math.max(plannedEnd.getTime(), record.clockInAt.getTime() + 1));
  const metrics = calculateAttendanceMetrics({
    clockInAt: record.clockInAt,
    clockOutAt: closeAt,
    plannedStart: roster?.plannedStart ?? record.clockInAt,
    plannedEnd,
    graceLateMinutes: shift?.graceLateMinutes ?? 0,
    breakMinutes: shift?.breakMinutes ?? 0,
  });
  const [closed] = await db.update(attendanceRecord)
    .set({
      status: "AUTO_CLOSED",
      clockOutAt: closeAt,
      workedMinutes: metrics.workedMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      version: record.version + 1,
    })
    .where(and(eq(attendanceRecord.id, record.id), eq(attendanceRecord.status, "OPEN")))
    .returning({ id: attendanceRecord.id });
  if (closed) {
    await logException({
      staffId: record.staffId,
      exceptionDate: record.attendanceDate,
      exceptionType: "MISSING_CLOCK_OUT",
      attendanceRecordId: record.id,
      rosterEntryId: record.rosterEntryId,
      note: `Automatically closed at ${closeAt.toISOString()}.`,
    });
  }
};

const processKnownPunch = async (
  punch: typeof punchLog.$inferSelect,
  staffId: string,
  timeZone: string,
): Promise<PunchOutcome> => withStaffLock(staffId, async () => {
  const [currentPunch] = await db.select().from(punchLog).where(eq(punchLog.id, punch.id)).limit(1);
  if (!currentPunch || currentPunch.processed) {
    return (currentPunch?.result as PunchOutcome | undefined) ?? "ACCEPTED";
  }

  const [recordedAttendance] = await db.select({
    clockInPunchId: attendanceRecord.clockInPunchId,
    clockOutPunchId: attendanceRecord.clockOutPunchId,
  }).from(attendanceRecord)
    .where(or(
      eq(attendanceRecord.clockInPunchId, punch.id),
      eq(attendanceRecord.clockOutPunchId, punch.id),
    ))
    .limit(1);
  if (recordedAttendance) {
    const result = recordedAttendance.clockInPunchId === punch.id ? "CLOCK_IN" : "CLOCK_OUT";
    await updatePunch(punch.id, { staffId, result, processed: true });
    return "ACCEPTED";
  }

  const previousPunches = await db.select({ punchedAt: punchLog.punchedAt })
    .from(punchLog)
    .where(and(
      eq(punchLog.staffId, staffId),
      inArray(punchLog.result, ["CLOCK_IN", "CLOCK_OUT"]),
      gte(punchLog.punchedAt, new Date(punch.punchedAt.getTime() - 60_000)),
      lte(punchLog.punchedAt, punch.punchedAt),
      ne(punchLog.id, punch.id),
    ))
    .limit(1);
  if (previousPunches[0] && punchIsDebounced(previousPunches[0].punchedAt, punch.punchedAt)) {
    await updatePunch(punch.id, { staffId, result: "DUPLICATE", processed: true });
    await markClockSkew(punch, timeZone);
    return "DUPLICATE";
  }

  const open = await findOpenAttendance(staffId);
  if (open) {
    if (punch.punchedAt < open.record.clockInAt) {
      await logException({
        staffId,
        exceptionDate: facilityDate(punch.punchedAt, timeZone),
        exceptionType: "PUNCH_RECONCILIATION_REQUIRED",
        note: `Accepted punch ${punch.id} predates open attendance ${open.record.id}; manual attendance reconciliation is required.`,
      });
      await updatePunch(punch.id, {
        staffId,
        result: "RECONCILIATION_REQUIRED",
        processed: true,
      });
      await markClockSkew(punch, timeZone);
      return "ACCEPTED";
    }

    const deadline = attendanceClockOutDeadline(
      open.record.clockInAt,
      open.roster?.plannedEnd ?? null,
      open.shift?.lateOutMinutes ?? 0,
    );
    if (decideOpenPunch(punch.punchedAt, deadline) === "CLOCK_OUT") {
      const plannedEnd = open.roster?.plannedEnd ?? open.record.clockInAt;
      const approvedOvertimeMinutes = await getApprovedOvertimeMinutes(open.record.id);
      const metrics = calculateAttendanceMetrics({
        clockInAt: open.record.clockInAt,
        clockOutAt: punch.punchedAt,
        plannedStart: open.roster?.plannedStart ?? open.record.clockInAt,
        plannedEnd,
        graceLateMinutes: open.shift?.graceLateMinutes ?? 0,
        breakMinutes: open.shift?.breakMinutes ?? 0,
        approvedOvertimeMinutes,
      });
      const [closed] = await db.update(attendanceRecord)
        .set({
          status: "CLOSED",
          clockOutAt: punch.punchedAt,
          clockOutPunchId: punch.id,
          workedMinutes: metrics.workedMinutes,
          earlyLeaveMinutes: metrics.earlyLeaveMinutes,
          overtimeMinutes: metrics.overtimeMinutes,
          version: open.record.version + 1,
        })
        .where(and(eq(attendanceRecord.id, open.record.id), eq(attendanceRecord.status, "OPEN")))
        .returning({ id: attendanceRecord.id });
      if (!closed) {
        await updatePunch(punch.id, { staffId, result: "RECEIVED", processed: false });
        return "ACCEPTED";
      }
      if (metrics.earlyLeaveMinutes > 0) {
        await logException({
          staffId,
          exceptionDate: open.record.attendanceDate,
          exceptionType: "EARLY_LEAVE",
          attendanceRecordId: open.record.id,
          rosterEntryId: open.record.rosterEntryId,
        });
      }
      await updatePunch(punch.id, { staffId, result: "CLOCK_OUT", processed: true });
      await markClockSkew(punch, timeZone);
      return "ACCEPTED";
    }

    await autoClose(open);
  }

  const matched = await findClockInShift(staffId, punch.punchedAt);
  const date = matched?.entry.rosterDate ?? facilityDate(punch.punchedAt, timeZone);
  const unitId = matched?.entry.orgUnitId ?? await getEffectiveUnitId(staffId, date);
  const metrics = matched
    ? calculateAttendanceMetrics({
      clockInAt: punch.punchedAt,
      clockOutAt: punch.punchedAt,
      plannedStart: matched.entry.plannedStart,
      plannedEnd: matched.entry.plannedEnd,
      graceLateMinutes: matched.shift.graceLateMinutes,
      breakMinutes: matched.shift.breakMinutes,
    })
    : null;

  try {
    const [created] = await db.insert(attendanceRecord).values({
      staffId,
      rosterEntryId: matched?.entry.id ?? null,
      attendanceDate: date,
      orgUnitId: unitId,
      shiftTypeId: matched?.entry.shiftTypeId ?? null,
      clockInAt: punch.punchedAt,
      clockInPunchId: punch.id,
      lateMinutes: metrics?.lateMinutes ?? 0,
    }).returning({ id: attendanceRecord.id });
    if (!created) throw new Error("The attendance record could not be created.");

    if (matched && metrics && metrics.lateMinutes > 0) {
      await logException({
        staffId,
        exceptionDate: date,
        exceptionType: "LATE",
        attendanceRecordId: created.id,
        rosterEntryId: matched.entry.id,
      });
    } else if (!matched) {
      await logException({
        staffId,
        exceptionDate: date,
        exceptionType: "UNROSTERED_PUNCH",
        attendanceRecordId: created.id,
      });
    }
    await updatePunch(punch.id, { staffId, result: "CLOCK_IN", processed: true });
    await markClockSkew(punch, timeZone);
    return "ACCEPTED";
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [existing] = await db.select({ id: attendanceRecord.id })
        .from(attendanceRecord)
        .where(and(
          eq(attendanceRecord.staffId, staffId),
          eq(attendanceRecord.status, "OPEN"),
        ))
        .limit(1);
      if (existing) {
        await updatePunch(punch.id, { staffId, result: "RECEIVED", processed: false });
        return "ACCEPTED";
      }
    }
    throw error;
  }
});

const outcomeForStoredResult = (result: string): PunchOutcome =>
  result === "DUPLICATE" ||
    result === "UNKNOWN_CREDENTIAL" ||
    result === "INACTIVE_STAFF" ||
    result === "BIOMETRIC_CONSENT_REQUIRED" ||
    result === "REJECTED_FUTURE_TIME"
    ? result
    : "ACCEPTED";

export const processPunch = async (punchId: string): Promise<PunchOutcome> => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const [punch] = await db.update(punchLog)
    .set({ processingStartedAt: now })
    .where(and(
      eq(punchLog.id, punchId),
      eq(punchLog.processed, false),
      or(isNull(punchLog.processingStartedAt), lt(punchLog.processingStartedAt, staleBefore)),
    ))
    .returning();
  if (!punch) {
    const [existing] = await db.select().from(punchLog).where(eq(punchLog.id, punchId)).limit(1);
    if (!existing) throw new Error("Punch log record not found.");
    return existing.processed ? outcomeForStoredResult(existing.result) : "ACCEPTED";
  }

  try {
    const timeZone = await resolveFacilityTimezone();
    if (punch.result !== "RECEIVED") {
      await updatePunch(punch.id, { staffId: punch.staffId, result: punch.result, processed: true });
      if (punch.staffId && punch.result !== "DUPLICATE") {
        await logException({
          staffId: punch.staffId,
          exceptionDate: facilityDate(punch.punchedAt, timeZone),
          exceptionType: punch.result,
          note: `Preflight rejected ${punch.credentialType} credential.`,
        });
      }
      return outcomeForStoredResult(punch.result);
    }

    if (!punch.staffId) {
      await updatePunch(punch.id, {
        result: "UNKNOWN_CREDENTIAL",
        processed: true,
      });
      return "UNKNOWN_CREDENTIAL";
    }

    return processKnownPunch(punch, punch.staffId, timeZone);
  } catch (error) {
    await db.update(punchLog)
      .set({ processingStartedAt: null })
      .where(and(eq(punchLog.id, punch.id), eq(punchLog.processed, false)));
    throw error;
  }
};
