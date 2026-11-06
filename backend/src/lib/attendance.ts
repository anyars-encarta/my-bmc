export const ATTENDANCE_DEBOUNCE_SECONDS = 60;
export const DEVICE_MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export const MAX_DEVICE_BATCH_SIZE = 500;

export type AttendanceShiftCandidate = {
  id: string;
  rosterDate: string;
  plannedStart: Date | string;
  plannedEnd: Date | string;
  earlyInMinutes: number;
};

export type AttendanceMetrics = {
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
};

export const findNearestShift = (
  shifts: AttendanceShiftCandidate[],
  punchedAt: Date,
) =>
  shifts
    .filter((shift) => {
      const start = new Date(shift.plannedStart).getTime();
      const end = new Date(shift.plannedEnd).getTime();
      return punchedAt.getTime() >= start - shift.earlyInMinutes * 60_000 &&
        punchedAt.getTime() <= end;
    })
    .sort((left, right) =>
      Math.abs(new Date(left.plannedStart).getTime() - punchedAt.getTime()) -
      Math.abs(new Date(right.plannedStart).getTime() - punchedAt.getTime()),
    )[0];

export const punchIsDebounced = (previousPunchAt: Date, punchedAt: Date) =>
  punchedAt.getTime() >= previousPunchAt.getTime() &&
  punchedAt.getTime() - previousPunchAt.getTime() < ATTENDANCE_DEBOUNCE_SECONDS * 1000;

export const punchIsTooFarInFuture = (punchedAt: Date, receivedAt: Date) =>
  punchedAt.getTime() - receivedAt.getTime() > DEVICE_MAX_CLOCK_SKEW_SECONDS * 1000;

export const punchHasClockSkew = (punchedAt: Date, receivedAt: Date) =>
  Math.abs(punchedAt.getTime() - receivedAt.getTime()) > DEVICE_MAX_CLOCK_SKEW_SECONDS * 1000;

export const credentialIsUsable = (
  status: string,
  expiresAt: Date | null,
  now: Date,
) => status === "ACTIVE" && (!expiresAt || expiresAt.getTime() > now.getTime());

export const attendanceClockOutDeadline = (
  clockInAt: Date,
  plannedEnd: Date | null,
  lateOutMinutes: number,
) => new Date(
  (plannedEnd?.getTime() ?? clockInAt.getTime() + 16 * 60 * 60 * 1000) +
    lateOutMinutes * 60_000,
);

export const decideOpenPunch = (punchedAt: Date, deadline: Date) =>
  punchedAt.getTime() <= deadline.getTime() ? "CLOCK_OUT" : "AUTO_CLOSE_AND_CLOCK_IN";

export const calculateAttendanceMetrics = ({
  clockInAt,
  clockOutAt,
  plannedStart,
  plannedEnd,
  graceLateMinutes,
  breakMinutes,
  approvedOvertimeMinutes = 0,
}: {
  clockInAt: Date;
  clockOutAt: Date;
  plannedStart: Date;
  plannedEnd: Date;
  graceLateMinutes: number;
  breakMinutes: number;
  approvedOvertimeMinutes?: number;
}): AttendanceMetrics => ({
  workedMinutes: Math.max(
    0,
    Math.floor(
      (
        Math.min(
          clockOutAt.getTime(),
          plannedEnd.getTime() + approvedOvertimeMinutes * 60_000,
        ) -
        Math.max(clockInAt.getTime(), plannedStart.getTime())
      ) / 60_000,
    ) - breakMinutes,
  ),
  lateMinutes: Math.max(
    0,
    Math.floor(
      (clockInAt.getTime() - plannedStart.getTime()) / 60_000,
    ) - graceLateMinutes,
  ),
  earlyLeaveMinutes: Math.max(
    0,
    Math.floor((plannedEnd.getTime() - clockOutAt.getTime()) / 60_000),
  ),
  overtimeMinutes: Math.max(
    0,
    Math.floor((clockOutAt.getTime() - plannedEnd.getTime()) / 60_000),
  ),
});

export const facilityDate = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
