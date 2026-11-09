import { randomUUID } from "node:crypto";
import { and, eq, exists, isNull, lte, or } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  attendanceException,
  attendanceRecord,
  attendanceCorrection,
  manualPunchRequest,
  overtimeRequest,
  rosterEntry,
  shiftType,
  staff,
} from "../db/schema/index.js";
import { calculateAttendanceMetrics, facilityDate } from "./attendance.js";
import { resolveFacilityTimezone } from "./facilityClock.js";
import {
  findClockInShift,
  getApprovedOvertimeMinutes,
  getEffectiveUnitId,
} from "./punchProcessor.js";

const APPLY_CLAIM_LEASE_MS = 5 * 60_000;

const rejectManualPunch = async (id: string, reason: string, claimToken: string) => {
  const [updated] = await db.update(manualPunchRequest)
    .set({ status: "REJECTED", decisionReason: reason })
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
      eq(manualPunchRequest.applyClaimToken, claimToken),
    ))
    .returning({ id: manualPunchRequest.id, status: manualPunchRequest.status });
  return updated;
};

const completeManualPunch = async (id: string, claimToken: string) => {
  const [updated] = await db.update(manualPunchRequest)
    .set({ status: "APPROVED" })
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
      eq(manualPunchRequest.applyClaimToken, claimToken),
    ))
    .returning({ id: manualPunchRequest.id, status: manualPunchRequest.status });
  return updated;
};

const rejectAttendanceCorrection = async (
  id: string,
  claimToken: string,
  reason: string,
) => {
  const [updated] = await db.update(attendanceCorrection)
    .set({ status: "REJECTED", decisionReason: reason })
    .where(and(
      eq(attendanceCorrection.id, id),
      eq(attendanceCorrection.status, "APPLYING"),
      eq(attendanceCorrection.applyClaimToken, claimToken),
    ))
    .returning({ id: attendanceCorrection.id, status: attendanceCorrection.status });
  return updated;
};

const completeAttendanceCorrection = async (id: string, claimToken: string) => {
  const [updated] = await db.update(attendanceCorrection)
    .set({ status: "APPROVED", appliedAt: new Date() })
    .where(and(
      eq(attendanceCorrection.id, id),
      eq(attendanceCorrection.status, "APPLYING"),
      eq(attendanceCorrection.applyClaimToken, claimToken),
    ))
    .returning({ id: attendanceCorrection.id, status: attendanceCorrection.status });
  return updated;
};

const ensureManualClockInExceptions = async (
  request: typeof manualPunchRequest.$inferSelect,
  record: {
    id: string;
    staffId: string;
    attendanceDate: string;
    clockInAt: Date;
    rosterEntryId: string | null;
  },
  roster: typeof rosterEntry.$inferSelect | null,
  shift: typeof shiftType.$inferSelect | null,
) => {
  if (!record.rosterEntryId) {
    const jobKey = `UNROSTERED_MANUAL:${request.id}`;
    await db.insert(attendanceException).values({
      staffId: record.staffId,
      exceptionDate: record.attendanceDate,
      exceptionType: "UNROSTERED_PUNCH",
      attendanceRecordId: record.id,
      note: `Approved manual clock-in: ${request.reason}`,
      jobKey,
    }).onConflictDoNothing();
    await db.update(attendanceException)
      .set({ attendanceRecordId: record.id })
      .where(and(
        eq(attendanceException.jobKey, jobKey),
        isNull(attendanceException.attendanceRecordId),
      ));
    return;
  }
  if (!roster || !shift) {
    throw new Error("The roster or shift linked to the manual clock-in is unavailable.");
  }
  const metrics = calculateAttendanceMetrics({
    clockInAt: record.clockInAt,
    clockOutAt: record.clockInAt,
    plannedStart: roster.plannedStart,
    plannedEnd: roster.plannedEnd,
    graceLateMinutes: shift.graceLateMinutes,
    breakMinutes: shift.breakMinutes,
  });
  if (metrics.lateMinutes > 0) {
    await db.insert(attendanceException).values({
      staffId: record.staffId,
      exceptionDate: record.attendanceDate,
      exceptionType: "LATE",
      attendanceRecordId: record.id,
      rosterEntryId: record.rosterEntryId,
      note: `Approved manual clock-in: ${request.reason}`,
      jobKey: `LATE_MANUAL:${request.id}`,
    }).onConflictDoNothing();
  }
};

export const applyManualPunch = async (id: string) => {
  const claimToken = randomUUID();
  const claimCutoff = new Date(Date.now() - APPLY_CLAIM_LEASE_MS);
  const [request] = await db.update(manualPunchRequest)
    .set({ applyClaimToken: claimToken, applyClaimedAt: new Date() })
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
      or(
        isNull(manualPunchRequest.applyClaimedAt),
        lte(manualPunchRequest.applyClaimedAt, claimCutoff),
      ),
    ))
    .returning();
  if (!request) return undefined;
  if (request.punchedAt > new Date()) {
    return rejectManualPunch(id, "A manual punch cannot be applied in the future.", claimToken);
  }

  const existing = await db.select({ id: attendanceRecord.id })
    .from(attendanceRecord)
    .where(or(
      eq(attendanceRecord.manualClockInRequestId, id),
      eq(attendanceRecord.manualClockOutRequestId, id),
    ))
    .limit(1);
  if (existing[0]) {
    if (request.direction === "IN") {
      const [linked] = await db.select({
        record: attendanceRecord,
        roster: rosterEntry,
        shift: shiftType,
      }).from(attendanceRecord)
        .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceRecord.rosterEntryId))
        .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
        .where(eq(attendanceRecord.manualClockInRequestId, id))
        .limit(1);
      if (linked) {
        await ensureManualClockInExceptions(
          request,
          linked.record,
          linked.roster,
          linked.shift,
        );
      }
    }
    return completeManualPunch(id, claimToken);
  }

  const [person] = await db.select({
    id: staff.id,
    status: staff.status,
  }).from(staff).where(eq(staff.id, request.staffId)).limit(1);
  if (!person || person.status !== "active") {
    return rejectManualPunch(id, "The selected employee is no longer active.", claimToken);
  }

  if (request.direction === "IN") {
    const [openRecord] = await db.select({ id: attendanceRecord.id })
      .from(attendanceRecord)
      .where(and(
        eq(attendanceRecord.staffId, request.staffId),
        eq(attendanceRecord.status, "OPEN"),
      ))
      .limit(1);
    if (openRecord) {
      return rejectManualPunch(id, "This employee already has an open attendance record.", claimToken);
    }

    const matched = await findClockInShift(request.staffId, request.punchedAt);
    const timezone = await resolveFacilityTimezone();
    const attendanceDate = matched?.entry.rosterDate ??
      facilityDate(request.punchedAt, timezone);
    const unitId = matched?.entry.orgUnitId ??
      await getEffectiveUnitId(request.staffId, attendanceDate);
    const metrics = matched
      ? calculateAttendanceMetrics({
        clockInAt: request.punchedAt,
        clockOutAt: request.punchedAt,
        plannedStart: matched.entry.plannedStart,
        plannedEnd: matched.entry.plannedEnd,
        graceLateMinutes: matched.shift.graceLateMinutes,
        breakMinutes: matched.shift.breakMinutes,
      })
      : null;

    const [created] = await db.insert(attendanceRecord).values({
      staffId: request.staffId,
      rosterEntryId: matched?.entry.id ?? null,
      attendanceDate,
      orgUnitId: unitId,
      shiftTypeId: matched?.entry.shiftTypeId ?? null,
      clockInAt: request.punchedAt,
      clockInPunchId: null,
      manualClockInRequestId: id,
      status: "OPEN",
      source: "MANUAL",
      workedMinutes: 0,
      lateMinutes: metrics?.lateMinutes ?? 0,
    }).returning({ id: attendanceRecord.id });
    if (!created) throw new Error("The manual attendance record could not be created.");
    await ensureManualClockInExceptions(
      request,
      {
        id: created.id,
        staffId: request.staffId,
        attendanceDate,
        clockInAt: request.punchedAt,
        rosterEntryId: matched?.entry.id ?? null,
      },
      matched?.entry ?? null,
      matched?.shift ?? null,
    );
    return completeManualPunch(id, claimToken);
  }

  const [open] = await db.select({
    record: attendanceRecord,
    roster: rosterEntry,
    shift: shiftType,
  }).from(attendanceRecord)
    .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceRecord.rosterEntryId))
    .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
    .where(and(
      eq(attendanceRecord.staffId, request.staffId),
      eq(attendanceRecord.status, "OPEN"),
    ))
    .limit(1);
  if (!open) return rejectManualPunch(id, "There is no open attendance record to clock out.", claimToken);
  if (request.punchedAt <= open.record.clockInAt) {
    return rejectManualPunch(id, "The manual clock-out must be later than the clock-in.", claimToken);
  }

  const plannedEnd = open.roster?.plannedEnd ?? open.record.clockInAt;
  const approvedOvertimeMinutes = await getApprovedOvertimeMinutes(open.record.id);
  const metrics = calculateAttendanceMetrics({
    clockInAt: open.record.clockInAt,
    clockOutAt: request.punchedAt,
    plannedStart: open.roster?.plannedStart ?? open.record.clockInAt,
    plannedEnd,
    graceLateMinutes: open.shift?.graceLateMinutes ?? 0,
    breakMinutes: open.shift?.breakMinutes ?? 0,
    approvedOvertimeMinutes,
  });
  const [closed] = await db.update(attendanceRecord)
    .set({
      clockOutAt: request.punchedAt,
      manualClockOutRequestId: id,
      status: "CLOSED",
      source: "MANUAL",
      workedMinutes: metrics.workedMinutes,
      lateMinutes: metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      version: open.record.version + 1,
    })
    .where(and(
      eq(attendanceRecord.id, open.record.id),
      eq(attendanceRecord.status, "OPEN"),
      eq(attendanceRecord.version, open.record.version),
    ))
    .returning({ id: attendanceRecord.id });
  if (!closed) return rejectManualPunch(id, "The attendance record changed before this request was applied.", claimToken);

  if (metrics.earlyLeaveMinutes > 0) {
    await db.insert(attendanceException).values({
      staffId: request.staffId,
      exceptionDate: open.record.attendanceDate,
      exceptionType: "EARLY_LEAVE",
      attendanceRecordId: open.record.id,
      rosterEntryId: open.record.rosterEntryId,
      note: `Approved manual clock-out: ${request.reason}`,
      jobKey: `EARLY_LEAVE_MANUAL:${id}`,
    }).onConflictDoNothing();
  }
  return completeManualPunch(id, claimToken);
};

export const applyAttendanceCorrection = async (id: string) => {
  const claimToken = randomUUID();
  const claimCutoff = new Date(Date.now() - APPLY_CLAIM_LEASE_MS);
  const [correction] = await db.update(attendanceCorrection)
    .set({ applyClaimToken: claimToken, applyClaimedAt: new Date() })
    .where(and(
      eq(attendanceCorrection.id, id),
      eq(attendanceCorrection.status, "APPLYING"),
      or(
        isNull(attendanceCorrection.applyClaimedAt),
        lte(attendanceCorrection.applyClaimedAt, claimCutoff),
      ),
    ))
    .returning();
  if (!correction) return undefined;

  const [current] = await db.select({
    record: attendanceRecord,
    roster: rosterEntry,
    shift: shiftType,
  }).from(attendanceRecord)
    .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceRecord.rosterEntryId))
    .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
    .where(eq(attendanceRecord.id, correction.attendanceRecordId))
    .limit(1);
  if (!current || !correction.newClockIn || !correction.newClockOut) {
    return rejectAttendanceCorrection(
      id,
      claimToken,
      "The attendance record or requested clock times are no longer available.",
    );
  }

  if (
    current.record.clockInAt.getTime() === correction.newClockIn.getTime() &&
    current.record.clockOutAt?.getTime() === correction.newClockOut.getTime()
  ) {
    return completeAttendanceCorrection(id, claimToken);
  }

  if (
    !["CLOSED", "AUTO_CLOSED"].includes(current.record.status) ||
    current.record.clockInAt.getTime() !== correction.oldClockIn?.getTime() ||
    current.record.clockOutAt?.getTime() !== correction.oldClockOut?.getTime()
  ) {
    return rejectAttendanceCorrection(
      id,
      claimToken,
      "The attendance record changed after this correction was requested.",
    );
  }

  const approvedOvertimeMinutes = await getApprovedOvertimeMinutes(current.record.id);
  const metrics = calculateAttendanceMetrics({
    clockInAt: correction.newClockIn,
    clockOutAt: correction.newClockOut,
    plannedStart: current.roster?.plannedStart ?? correction.newClockIn,
    plannedEnd: current.roster?.plannedEnd ?? correction.newClockOut,
    graceLateMinutes: current.shift?.graceLateMinutes ?? 0,
    breakMinutes: current.shift?.breakMinutes ?? 0,
    approvedOvertimeMinutes,
  });
  const [updated] = await db.update(attendanceRecord)
    .set({
      clockInAt: correction.newClockIn,
      clockOutAt: correction.newClockOut,
      status: "CLOSED",
      workedMinutes: metrics.workedMinutes,
      lateMinutes: metrics.lateMinutes,
      earlyLeaveMinutes: metrics.earlyLeaveMinutes,
      overtimeMinutes: metrics.overtimeMinutes,
      version: current.record.version + 1,
    })
    .where(and(
      eq(attendanceRecord.id, correction.attendanceRecordId),
      eq(attendanceRecord.version, current.record.version),
      or(eq(attendanceRecord.status, "CLOSED"), eq(attendanceRecord.status, "AUTO_CLOSED")),
      exists(db.select({ id: attendanceCorrection.id }).from(attendanceCorrection)
        .where(and(
          eq(attendanceCorrection.id, id),
          eq(attendanceCorrection.status, "APPLYING"),
          eq(attendanceCorrection.applyClaimToken, claimToken),
        ))),
    ))
    .returning({ id: attendanceRecord.id });
  if (!updated) {
    return rejectAttendanceCorrection(
      id,
      claimToken,
      "The attendance record changed while the correction was being approved.",
    );
  }

  return completeAttendanceCorrection(id, claimToken);
};

export const recoverAttendanceApprovals = async () => {
  const claimCutoff = new Date(Date.now() - APPLY_CLAIM_LEASE_MS);
  const [manual, corrections] = await Promise.all([
    db.select({ id: manualPunchRequest.id }).from(manualPunchRequest)
      .where(and(
        eq(manualPunchRequest.status, "APPLYING"),
        or(
          isNull(manualPunchRequest.applyClaimedAt),
          lte(manualPunchRequest.applyClaimedAt, claimCutoff),
        ),
      )).limit(100),
    db.select({ id: attendanceCorrection.id }).from(attendanceCorrection)
      .where(and(
        eq(attendanceCorrection.status, "APPLYING"),
        or(
          isNull(attendanceCorrection.applyClaimedAt),
          lte(attendanceCorrection.applyClaimedAt, claimCutoff),
        ),
      )).limit(100),
  ]);
  let recovered = 0;
  for (const request of manual) {
    try {
      if (await applyManualPunch(request.id)) recovered += 1;
    } catch (error) {
      console.error("Failed to recover manual attendance approval.", {
        requestId: request.id,
        error,
      });
    }
  }
  for (const correction of corrections) {
    try {
      if (await applyAttendanceCorrection(correction.id)) recovered += 1;
    } catch (error) {
      console.error("Failed to recover attendance correction approval.", {
        correctionId: correction.id,
        error,
      });
    }
  }
  return recovered;
};
