import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";

export type StaffLoginAccount = {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const fetchStaffLoginAccounts = async (staffId?: string) => {
  const accounts: StaffLoginAccount[] = [];

  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ page: String(page), limit: "200" });
    if (staffId) params.set("staffId", staffId);

    const response = await fetch(`${apiBase}/v1/staff/linkable-users?${params}`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as {
      data?: StaffLoginAccount[];
      pagination?: { hasMore?: boolean };
      message?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Failed to load login accounts.");
    }

    accounts.push(...(payload.data ?? []));
    if (!payload.pagination?.hasMore) return accounts;
  }
};
