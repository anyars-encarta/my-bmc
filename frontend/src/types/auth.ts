export type AppRole = "accounts" | "admin";

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
  refreshSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
