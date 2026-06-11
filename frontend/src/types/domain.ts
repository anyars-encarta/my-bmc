export type StaffStatus = "active" | "inactive";

export type PaymentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "processing"
  | "completed"
  | "cancelled";

export type RecipientStatus = "pending" | "approved" | "disapproved";

export interface StaffRecord {
  id: string;
  firstName: string;
  lastName: string;
  imageUrl?: string;
  email: string;
  employeeId: string;
  momoNumber: string;
  momoName?: string;
  department?: string;
  position?: string;
  phone?: string;
  status: StaffStatus;
}

export interface CategoryRecord {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export interface PaymentRecord {
  id: string;
  title: string;
  description?: string;
  period?: string;
  categoryId: string;
  category?: {
    name?: string;
  };
  status: PaymentStatus;
  totalAmount: string;
  createdBy: string;
  approvingOfficer?: string;
  approvedBy?: string;
  momoReferenceId?: string;
  createdAt?: string;
}

export interface ApprovalQueueRecord {
  id: string;
  paymentTitle: string;
  categoryName: string;
  recipientsCount: number;
  pendingReviewCount: number;
  totalAmount: string;
  approvingOfficer: string;
  status: PaymentStatus;
}

export interface DisbursementRecord {
  id: string;
  paymentTitle: string;
  momoBatchId: string;
  recipientsCount: number;
  totalAmount: string;
  status: "queued" | "sent" | "successful" | "failed";
  processedAt: string;
}

export interface SetupRecord {
  id: string;
  facilityName: string;
  facilityCode: string;
  telephone?: string;
  email?: string;
  address?: string;
  logoUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}
