import type { AppRole } from "./lib/appRoles.js";

type UserRoles = AppRole;
type RateLimitRole = AppRole | "guest";

type EnrollmentMode = "admission" | "promotion" | "repeat";

type NormalizedAttendanceEntry = {
  studentId: number | null;
  status: unknown;
  remarks: string | null;
};