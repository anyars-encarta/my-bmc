import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const fetchFacilityLocalDate = async () => {
  const response = await fetch(`${apiBase}/v1/facility`, {
    credentials: "include",
    headers: createAuthHeaders(),
  });
  const payload = (await response.json()) as {
    meta?: { clock?: { localDateTime?: string } };
    message?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Failed to load the facility clock.");
  }

  const localDate = payload.meta?.clock?.localDateTime?.slice(0, 10);
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("The facility clock returned an invalid local date.");
  }
  return localDate;
};
