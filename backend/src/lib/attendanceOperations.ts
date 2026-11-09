import { and, eq, isNull, or } from "drizzle-orm";

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
import { findClockInShift, getEffectiveUnitId } from "./punchProcessor.js";

const rejectManualPunch = async (id: string, reason: string) => {
  const [updated] = await db.update(manualPunchRequest)
    .set({ status: "REJECTED", decisionReason: reason })
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
    ))
    .returning({ id: manualPunchRequest.id, status: manualPunchRequest.status });
  return updated ?? { id, status: "REJECTED" };
};

const completeManualPunch = async (id: string) => {
  const [updated] = await db.update(manualPunchRequest)
    .set({ status: "APPROVED" })
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
    ))
    .returning({ id: manualPunchRequest.id, status: manualPunchRequest.status });
  return updated ?? { id, status: "APPROVED" };
};

export const applyManualPunch = async (id: string) => {
  const [request] = await db.select().from(manualPunchRequest)
    .where(and(
      eq(manualPunchRequest.id, id),
      eq(manualPunchRequest.status, "APPLYING"),
    ))
    .limit(1);
  if (!request) return undefined;

  const existing = await db.select({ id: attendanceRecord.id })
    .from(attendanceRecord)
    .where(or(
      eq(attendanceRecord.manualClockInRequestId, id),
      eq(attendanceRecord.manualClockOutRequestId, id),
    ))
    .limit(1);
  if (existing[0]) return completeManualPunch(id);

  const [person] = await db.select({
    id: staff.id,
    status: staff.status,
  }).from(staff).where(eq(staff.id, request.staffId)).limit(1);
  if (!person || person.status !== "active") {
    return rejectManualPunch(id, "The selected employee is no longer active.");
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
      return rejectManualPunch(id, "This employee already has an open attendance record.");
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

    await db.insert(attendanceRecord).values({
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
    });

    if (!matched) {
      await db.insert(attendanceException).values({
        staffId: request.staffId,
        exceptionDate: attendanceDate,
        exceptionType: "UNROSTERED_PUNCH",
        note: `Approved manual clock-in: ${request.reason}`,
        jobKey: `UNROSTERED_MANUAL:${id}`,
      }).onConflictDoNothing();
    }
    return completeManualPunch(id);
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
  if (!open) return rejectManualPunch(id, "There is no open attendance record to clock out.");
  if (request.punchedAt <= open.record.clockInAt) {
    return rejectManualPunch(id, "The manual clock-out must be later than the clock-in.");
  }

  const plannedEnd = open.roster?.plannedEnd ?? open.record.clockInAt;
  const metrics = calculateAttendanceMetrics({
    clockInAt: open.record.clockInAt,
    clockOutAt: request.punchedAt,
    plannedStart: open.roster?.plannedStart ?? open.record.clockInAt,
    plannedEnd,
    graceLateMinutes: open.shift?.graceLateMinutes ?? 0,
    breakMinutes: open.shift?.breakMinutes ?? 0,
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
  if (!closed) return rejectManualPunch(id, "The attendance record changed before this request was applied.");

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
  return completeManualPunch(id);
};

export const applyAttendanceCorrection = async (id: string) => {
  const [correction] = await db.select().from(attendanceCorrection)
    .where(and(
      eq(attendanceCorrection.id, id),
      eq(attendanceCorrection.status, "APPLYING"),
    ))
    .limit(1);
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
    await db.update(attendanceCorrection)
      .set({
        status: "REJECTED",
        decisionReason: "The attendance record or requested clock times are no longer available.",
      })
      .where(and(
        eq(attendanceCorrection.id, id),
        eq(attendanceCorrection.status, "APPLYING"),
      ));
    return { id, status: "REJECTED" };
  }

  if (
    current.record.clockInAt.getTime() === correction.newClockIn.getTime() &&
    current.record.clockOutAt?.getTime() === correction.newClockOut.getTime()
  ) {
    const [completed] = await db.update(attendanceCorrection)
      .set({ status: "APPROVED", appliedAt: new Date() })
      .where(and(
        eq(attendanceCorrection.id, id),
        eq(attendanceCorrection.status, "APPLYING"),
      ))
      .returning({ id: attendanceCorrection.id, status: attendanceCorrection.status });
    return completed ?? { id, status: "APPROVED" };
  }

  if (
    !["CLOSED", "AUTO_CLOSED"].includes(current.record.status) ||
    current.record.clockInAt.getTime() !== correction.oldClockIn?.getTime() ||
    current.record.clockOutAt?.getTime() !== correction.oldClockOut?.getTime()
  ) {
    await db.update(attendanceCorrection)
      .set({
        status: "REJECTED",
        decisionReason: "The attendance record changed after this correction was requested.",
      })
      .where(and(
        eq(attendanceCorrection.id, id),
        eq(attendanceCorrection.status, "APPLYING"),
      ));
    return { id, status: "REJECTED" };
  }

  const metrics = calculateAttendanceMetrics({
    clockInAt: correction.newClockIn,
    clockOutAt: correction.newClockOut,
    plannedStart: current.roster?.plannedStart ?? correction.newClockIn,
    plannedEnd: current.roster?.plannedEnd ?? correction.newClockOut,
    graceLateMinutes: current.shift?.graceLateMinutes ?? 0,
    breakMinutes: current.shift?.breakMinutes ?? 0,
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
    ))
    .returning({ id: attendanceRecord.id });
  if (!updated) {
    await db.update(attendanceCorrection)
      .set({
        status: "REJECTED",
        decisionReason: "The attendance record changed while the correction was being approved.",
      })
      .where(and(
        eq(attendanceCorrection.id, id),
        eq(attendanceCorrection.status, "APPLYING"),
      ));
    return { id, status: "REJECTED" };
  }

  const [completed] = await db.update(attendanceCorrection)
    .set({ status: "APPROVED", appliedAt: new Date() })
    .where(and(
      eq(attendanceCorrection.id, id),
      eq(attendanceCorrection.status, "APPLYING"),
    ))
    .returning({ id: attendanceCorrection.id, status: attendanceCorrection.status });
  return completed ?? { id, status: "APPROVED" };
};

export const recoverAttendanceApprovals = async () => {
  const [manual, corrections] = await Promise.all([
    db.select({ id: manualPunchRequest.id }).from(manualPunchRequest)
      .where(eq(manualPunchRequest.status, "APPLYING")).limit(100),
    db.select({ id: attendanceCorrection.id }).from(attendanceCorrection)
      .where(eq(attendanceCorrection.status, "APPLYING")).limit(100),
  ]);
  for (const request of manual) await applyManualPunch(request.id);
  for (const correction of corrections) await applyAttendanceCorrection(correction.id);
  return manual.length + corrections.length;
};
