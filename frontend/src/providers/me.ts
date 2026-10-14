import { BACKEND_BASE_URL } from "@/constants";
import { ACCESS_TOKEN_KEY } from "@/constants";

export type MeResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    role?: string | null;
  };
  roles: string[];
  unitScopes: Array<{
    orgUnitId: string;
    scope: "MANAGE" | "VIEW";
    includeDescendants: boolean;
  }>;
  permissions: string[];
};

const meUrl = `${BACKEND_BASE_URL}/v1/me`;

let meCache: MeResponse | null = null;
let mePromise: Promise<MeResponse | null> | null = null;

const readAccessToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

export const createAuthHeaders = (base?: HeadersInit) => {
  const headers = new Headers(base ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = readAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
};

export const clearMeCache = () => {
  meCache = null;
  mePromise = null;
};

export const fetchMe = async (force = false): Promise<MeResponse | null> => {
  if (!force && meCache) {
    return meCache;
  }

  if (!force && mePromise) {
    return mePromise;
  }

  mePromise = fetch(meUrl, {
    credentials: "include",
    headers: createAuthHeaders(),
  })
    .then(async (response) => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return null;
        }
        throw new Error(`Failed to load /me: ${response.status}`);
      }

      const payload = (await response.json()) as { data?: MeResponse };
      meCache = payload.data ?? null;
      return meCache;
    })
    .finally(() => {
      mePromise = null;
    });

  return mePromise;
};
