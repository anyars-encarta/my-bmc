export type AppRole = "super_admin"
  | "hospital_admin"
  | "hr_manager"
  | "payroll_officer"
  | "unit_manager"
  | "roster_officer"
  | "registrar"
  | "records_officer"
  | "cashier"
  | "accounts"
  | "billing_officer"
  | "doctor"
  | "nurse"
  | "midwife"
  | "pharmacist"
  | "pharmacy_tech"
  | "lab_scientist"
  | "radiographer"
  | "radiologist"
  | "store_keeper"
  | "procurement_officer"
  | "report_viewer"
  | "auditor"
  | "dpo"
  | "staff";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  imageCldPubId?: string | null;
  role: AppRole;
  status?: "active" | "inactive";
  branchId?: number | null;
  branchName?: string | null;
  branchCode?: string | null;
  employeeCode?: string | null;
};

export type SessionPayload = {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
  };
};

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  refreshSession: () => Promise<AuthUser | null>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
