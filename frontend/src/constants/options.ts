import type { PaymentStatus, ScheduleMode, StaffCategory, StaffStatus } from "@/types/domain";

export const staffStatusOptions: { label: string; value: StaffStatus }[] = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
];

export const paymentStatusOptions: { label: string; value: PaymentStatus }[] = [
  { label: "Draft", value: "draft" },
  { label: "Pending Approval", value: "pending_approval" },
  { label: "Approved", value: "approved" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

export const staffCategoryOptions: { label: string; value: StaffCategory }[] = [
  { label: "Clinical", value: "CLINICAL" },
  { label: "Non-Clinical", value: "NON_CLINICAL" },
];

export const scheduleModeOptions: { label: string; value: ScheduleMode }[] = [
  { label: "Fixed Weekday", value: "FIXED_WEEKDAY" },
  { label: "Rostered", value: "ROSTERED" },
];

export const orgUnitTypeOptions = [
  "DIVISION",
  "DEPARTMENT",
  "UNIT",
  "WARD",
  "CLINIC",
  "THEATRE",
  "SERVICE_POINT",
] as const;

export const licensingBodyOptions = [
  { label: "Medical and Dental Council", value: "MDC" },
  { label: "Nursing and Midwifery Council", value: "NMC" },
  { label: "Pharmacy Council", value: "PC" },
  { label: "Health Professions Council", value: "HPC" },
  { label: "Allied Health Professions Council", value: "AHPC" },
  { label: "Other", value: "OTHER" },
] as const;
