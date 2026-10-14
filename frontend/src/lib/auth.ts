import type { AuthUser, SessionPayload } from "@/types/auth";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveApiBaseUrl = () => {
  // In production, use same-origin requests so Vercel rewrites keep auth cookies first-party.
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return normalizeBaseUrl(window.location.origin);
  }

  const rawBaseUrl = import.meta.env.VITE_API_URL?.trim();
  return rawBaseUrl && rawBaseUrl.length > 0 ? normalizeBaseUrl(rawBaseUrl) : "";
};

const API_BASE_URL = resolveApiBaseUrl();

const authUrl = (path: string) => `${API_BASE_URL}/api/auth${path.startsWith("/") ? path : `/${path}`}`;
const apiUrl = (path: string) => `${API_BASE_URL}/api${path.startsWith("/") ? path : `/${path}`}`;

const parseError = async (response: Response) => {
  try {
    const json = (await response.json()) as {
      message?: string;
      error?: string;
    };
    return json.message ?? json.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

const networkErrorMessage = "Unable to reach the authentication service. Check that the backend is running and reachable.";

const toRequestError = (error: unknown) => {
  if (error instanceof Error) {
    return new Error(error.message || networkErrorMessage);
  }

  return new Error(networkErrorMessage);
};

const getCurrentUser = async (): Promise<AuthUser | null> => {
  try {
    const response = await fetch(apiUrl("/users/me"), {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: AuthUser;
    };

    return payload.data ?? null;
  } catch {
    return null;
  }
};

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const response = await fetch(authUrl("/get-session"), {
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as SessionPayload | null;
    if (!payload) {
      return null;
    }

    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return payload;
    }

    return {
      ...payload,
      user: {
        ...payload.user,
        ...currentUser,
      },
    };
  } catch {
    return null;
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const response = await fetch(authUrl("/sign-in/email"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(await parseError(response));
    }
  } catch (error) {
    throw toRequestError(error);
  }
}

export async function signOutSession() {
  try {
    const response = await fetch(authUrl("/sign-out"), {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(await parseError(response));
    }
  } catch (error) {
    throw toRequestError(error);
  }
}
