type UserRoles = "admin" | "accounts";

type RateLimitRole = UserRoles | "guest";

type EnrollmentMode = "admission" | "promotion" | "repeat";

type NormalizedAttendanceEntry = {
  studentId: number | null;
  status: unknown;
  remarks: string | null;
};