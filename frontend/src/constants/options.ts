import type { PaymentStatus, StaffStatus } from "@/types/domain";

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
