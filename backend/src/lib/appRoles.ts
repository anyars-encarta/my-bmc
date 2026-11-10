export const APP_ROLES = [
  "super_admin",
  "hospital_admin",
  "hr_manager",
  "payroll_officer",
  "unit_manager",
  "roster_officer",
  "registrar",
  "records_officer",
  "cashier",
  "accounts",
  "billing_officer",
  "doctor",
  "nurse",
  "midwife",
  "pharmacist",
  "pharmacy_tech",
  "lab_scientist",
  "radiographer",
  "radiologist",
  "store_keeper",
  "procurement_officer",
  "report_viewer",
  "auditor",
  "dpo",
  "staff",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type StoredUserRole = AppRole | "admin";
export const AUTH_ROLE_VALUES = [
  "accounts",
  "admin",
  ...APP_ROLES.filter((role) => role !== "accounts"),
] as const;

const APP_ROLE_SET = new Set<string>(APP_ROLES);

export const isAppRole = (value: unknown): value is AppRole =>
  typeof value === "string" && APP_ROLE_SET.has(value);
