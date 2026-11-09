import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  attendanceDevice,
  attendanceException,
  attendanceRecord,
  leaveRequest,
  rosterEntry,
  shiftType,
} from "../db/schema/index.js";
import { calculateAttendanceMetrics } from "../lib/attendance.js";
import { recoverAttendanceApprovals } from "../lib/attendanceOperations.js";
import { recoverPendingPunches } from "../lib/punchProcessing.js";

const jobIntervals = new Map<string, ReturnType<typeof setInterval>>();
const runningJobs = new Set<string>();

const runSafely = (name: string, operation: () => Promise<unknown>) => async () => {
  if (runningJobs.has(name)) return;
  runningJobs.add(name);
  try {
    await operation();
  } catch (error) {
    console.error(`${name} failed.`, error);
  } finally {
    runningJobs.delete(name);
  }
};

export const runPunchRetryJob = async () => {
  const recovered = await recoverPendingPunches();
  if (recovered > 0) console.info(`Attendance punch retry queued ${recovered} event(s).`);
  const approvals = await recoverAttendanceApprovals();
  if (approvals > 0) console.info(`Attendance approval recovery processed ${approvals} request(s).`);
};

export const runAutoCloseJob = async (now = new Date()) => {
  const openRecords = await db.select({
    record: attendanceRecord,
    roster: rosterEntry,
    shift: shiftType,
  }).from(attendanceRecord)
    .leftJoin(rosterEntry, eq(rosterEntry.id, attendanceRecord.rosterEntryId))
    .leftJoin(shiftType, eq(shiftType.id, attendanceRecord.shiftTypeId))
    .where(eq(attendanceRecord.status, "OPEN"))
    .orderBy(asc(attendanceRecord.clockInAt))
    .limit(500);

  let closedCount = 0;
  for (const { record, roster, shift } of openRecords) {
    const plannedEnd = roster?.plannedEnd ??
      new Date(record.clockInAt.getTime() + 16 * 60 * 60_000);
    const deadline = new Date(plannedEnd.getTime() + (shift?.lateOutMinutes ?? 120) * 60_000);
    if (deadline > now) continue;

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
        lateMinutes: metrics.lateMinutes,
        earlyLeaveMinutes: metrics.earlyLeaveMinutes,
        overtimeMinutes: metrics.overtimeMinutes,
        version: record.version + 1,
      })
      .where(and(
        eq(attendanceRecord.id, record.id),
        eq(attendanceRecord.status, "OPEN"),
        eq(attendanceRecord.version, record.version),
      ))
      .returning({ id: attendanceRecord.id });
    if (!closed) continue;

    await db.insert(attendanceException).values({
      staffId: record.staffId,
      exceptionDate: record.attendanceDate,
      exceptionType: "MISSING_CLOCK_OUT",
      attendanceRecordId: record.id,
      rosterEntryId: record.rosterEntryId,
      note: `Automatically closed at ${closeAt.toISOString()}.`,
      jobKey: `MISSING_CLOCK_OUT:${record.id}`,
    }).onConflictDoNothing();
    closedCount += 1;
  }
  return closedCount;
};

export const runAbsenceDetectionJob = async (now = new Date()) => {
  const startDate = new Date(now.getTime() - 60 * 24 * 60 * 60_000)
    .toISOString().slice(0, 10);
  const entries = await db.select({
    entry: rosterEntry,
    lateOutMinutes: shiftType.lateOutMinutes,
  }).from(rosterEntry)
    .innerJoin(shiftType, eq(shiftType.id, rosterEntry.shiftTypeId))
    .leftJoin(attendanceRecord, eq(attendanceRecord.rosterEntryId, rosterEntry.id))
    .where(and(
      eq(rosterEntry.status, "ACTIVE"),
      gte(rosterEntry.rosterDate, startDate),
      isNull(attendanceRecord.id),
      lte(rosterEntry.plannedEnd, now),
      sql`NOT EXISTS (
        SELECT 1
        FROM attendance_exception
        WHERE attendance_exception.job_key = CONCAT('ABSENT:', ${rosterEntry.id})
      )`,
    ))
    .limit(2000);
  if (entries.length === 0) return 0;

  const staffIds = [...new Set(entries.map(({ entry }) => entry.staffId))];
  const leaveRows = await db.select({
    staffId: leaveRequest.staffId,
    startDate: leaveRequest.startDate,
    endDate: leaveRequest.endDate,
  }).from(leaveRequest)
    .where(and(
      inArray(leaveRequest.staffId, staffIds),
      eq(leaveRequest.status, "APPROVED"),
    ));
  const approvedLeave = new Set(
    leaveRows.flatMap((leave) => {
      const dates: string[] = [];
      for (let date = leave.startDate; date <= leave.endDate; date = nextDate(date)) {
        dates.push(`${leave.staffId}:${date}`);
      }
      return dates;
    }),
  );

  let detectedCount = 0;
  for (const { entry, lateOutMinutes } of entries) {
    const deadline = new Date(entry.plannedEnd.getTime() + lateOutMinutes * 60_000);
    if (deadline > now || approvedLeave.has(`${entry.staffId}:${entry.rosterDate}`)) continue;
    const [created] = await db.insert(attendanceException).values({
      staffId: entry.staffId,
      exceptionDate: entry.rosterDate,
      exceptionType: "ABSENT",
      rosterEntryId: entry.id,
      note: "No attendance record was found after the scheduled shift grace window.",
      jobKey: `ABSENT:${entry.id}`,
    }).onConflictDoNothing().returning({ id: attendanceException.id });
    if (created) detectedCount += 1;
  }
  return detectedCount;
};

const nextDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1))
    .toISOString().slice(0, 10);
};

export const runDeviceHealthJob = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - 15 * 60_000);
  const devices = await db.select({
    id: attendanceDevice.id,
    code: attendanceDevice.code,
    name: attendanceDevice.name,
    createdAt: attendanceDevice.createdAt,
    lastSeenAt: attendanceDevice.lastSeenAt,
    healthAlertedAt: attendanceDevice.healthAlertedAt,
  }).from(attendanceDevice)
    .where(eq(attendanceDevice.status, "ACTIVE"));

  let alertedCount = 0;
  for (const device of devices) {
    const overdue = device.createdAt <= cutoff &&
      (!device.lastSeenAt || device.lastSeenAt <= cutoff);
    if (overdue && !device.healthAlertedAt) {
      const [alerted] = await db.update(attendanceDevice)
        .set({ healthAlertedAt: now })
        .where(and(
          eq(attendanceDevice.id, device.id),
          eq(attendanceDevice.status, "ACTIVE"),
          isNull(attendanceDevice.healthAlertedAt),
          lte(attendanceDevice.createdAt, cutoff),
          or(
            isNull(attendanceDevice.lastSeenAt),
            lte(attendanceDevice.lastSeenAt, cutoff),
          ),
        ))
        .returning({ id: attendanceDevice.id });
      if (alerted) {
        console.warn("Attendance device has not checked in for more than 15 minutes.", {
          deviceCode: device.code,
          deviceName: device.name,
          lastSeenAt: device.lastSeenAt,
        });
        alertedCount += 1;
      }
    } else if (!overdue && device.healthAlertedAt) {
      await db.update(attendanceDevice)
        .set({ healthAlertedAt: null })
        .where(and(
          eq(attendanceDevice.id, device.id),
          eq(attendanceDevice.healthAlertedAt, device.healthAlertedAt),
        ));
    }
  }
  return alertedCount;
};

export const startAttendanceJobs = () => {
  const schedule = (name: string, cadenceMs: number, operation: () => Promise<unknown>) => {
    if (jobIntervals.has(name)) return;
    const run = runSafely(name, operation);
    void run();
    jobIntervals.set(name, setInterval(() => void run(), cadenceMs));
  };

  schedule("PunchRetryJob", 60_000, runPunchRetryJob);
  schedule("AutoCloseJob", 15 * 60_000, () => runAutoCloseJob());
  schedule("AbsenceDetectionJob", 15 * 60_000, () => runAbsenceDetectionJob());
  schedule("DeviceHealthJob", 5 * 60_000, () => runDeviceHealthJob());
};
