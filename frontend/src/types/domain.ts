export type StaffStatus = "active" | "inactive";
export type StaffCategory = "CLINICAL" | "NON_CLINICAL";
export type ScheduleMode = "FIXED_WEEKDAY" | "ROSTERED";

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
  orgUnitId?: string | null;
  jobRoleId?: string | null;
  defaultShiftTypeId?: string | null;
  badgeNumber?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  userId?: string | null;
  staffCategory?: StaffCategory;
  scheduleMode?: ScheduleMode;
  position?: string;
  phone?: string;
  status: StaffStatus;
}

export interface OrgUnitRecord {
  id: string;
  parentId?: string | null;
  code: string;
  name: string;
  unitType: "DIVISION" | "DEPARTMENT" | "UNIT" | "WARD" | "CLINIC" | "THEATRE" | "SERVICE_POINT";
  isClinical: boolean;
  operates24h: boolean;
  active: boolean;
  headStaffId?: string | null;
  children?: OrgUnitRecord[];
}

export interface ShiftTypeRecord {
  id: string;
  code: string;
  name: string;
  category: "STANDARD" | "MORNING" | "AFTERNOON" | "NIGHT";
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface JobRoleRecord {
  id: string;
  code: string;
  name: string;
  staffCategory: StaffCategory;
  requiresLicense: boolean;
}

export interface StaffLicenseRecord {
  id: string;
  staffId: string;
  licensingBody: "MDC" | "NMC" | "PC" | "HPC" | "AHPC" | "OTHER";
  licenceNo: string;
  issuedOn?: string | null;
  expiresOn: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "REVOKED";
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
  period: string;
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
  hosted: boolean;
  hostingExpiryDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
