type UserRoles =
  | "SUPER_ADMIN"
  | "HOSPITAL_ADMIN"
  | "HR_MANAGER"
  | "PAYROLL_OFFICER"
  | "UNIT_MANAGER"
  | "ROSTER_OFFICER"
  | "REGISTRAR"
  | "RECORDS_OFFICER"
  | "CASHIER"
  | "ACCOUNTS"
  | "BILLING_OFFICER"
  | "DOCTOR"
  | "NURSE"
  | "PHARMACIST"
  | "PHARMACY_TECH"
  | "LAB_SCIENTIST"
  | "RADIOGRAPHER"
  | "RADIOLOGIST"
  | "STORE_KEEPER"
  | "PROCUREMENT_OFFICER"
  | "REPORT_VIEWER"
  | "AUDITOR"
  | "DPO"
  | "STAFF";

type RateLimitRole = UserRoles | "guest";

type EnrollmentMode = "admission" | "promotion" | "repeat";

type NormalizedAttendanceEntry = {
  studentId: number | null;
  status: unknown;
  remarks: string | null;
};