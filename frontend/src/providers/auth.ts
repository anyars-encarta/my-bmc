import type { AuthProvider } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { authClient } from "@/lib/auth-client";
import { clearMeCache, fetchMe } from "./me";

type AuthUser = {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
  status?: string | null;
  image?: string | null;
};

type AuthSessionData = {
  user?: AuthUser | null;
  session?: {
    id: string;
  } | null;
};

type RegisterParams = {
  email: string;
  password: string;
  role?: string;
  image?: string | null;
  imageCldPubId?: string | null;
};

const sessionUrl = `${BACKEND_BASE_URL.replace(/\/+$/, "")}/auth/get-session`;

const getSessionData = async (): Promise<AuthSessionData | null> => {
  const response = await fetch(sessionUrl, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AuthSessionData | null;
  return payload ?? null;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("AUTH_CHECK_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const authProvider: AuthProvider = {
  login: async ({ email, password, rememberMe }) => {
    const response = await authClient.signIn.email(
      {
        email,
        password,
        rememberMe: Boolean(rememberMe),
      },
      {
        onError: () => undefined,
      },
    );

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Invalid email or password."),
      };
    }

    let session: AuthSessionData | null = null;
    try {
      session = await withTimeout(getSessionData(), 5000);
    } catch {
      session = null;
    }

    if (!session?.user || !session?.session) {
      return {
        success: false,
        error: new Error("Login did not establish a session. Please try again."),
      };
    }

    clearMeCache();
    return {
      success: true,
      redirectTo: "/dashboard",
    };
  },
  logout: async () => {
    const response = await authClient.signOut({
      fetchOptions: {
        onError: () => undefined,
      },
    });

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Logout failed."),
      };
    }

    clearMeCache();
    return {
      success: true,
      redirectTo: "/login",
    };
  },
  check: async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let session: AuthSessionData | null = null;
        try {
          session = await withTimeout(getSessionData(), 3000);
        } catch {
          session = null;
        }

        if (session?.user && session?.session) {
          return {
            authenticated: true,
          };
        }

        if (attempt < 2) {
          await wait(400);
        }
      }

      return {
        authenticated: false,
        redirectTo: "/login",
      };
    } catch (error) {
      return {
        authenticated: false,
        redirectTo: "/login",
        error: error instanceof Error ? error : new Error("Authentication check failed."),
      };
    }
  },
  onError: async (error) => {
    const statusCode =
      typeof error?.statusCode === "number"
        ? error.statusCode
        : typeof error?.status === "number"
          ? error.status
          : undefined;

    if (statusCode === 401 || statusCode === 403) {
      return {
        logout: true,
        redirectTo: "/login",
        error,
      };
    }

    return { error };
  },
  forgotPassword: async ({ email }) => {
    const clientWithForgotPassword = authClient as unknown as {
      forgetPassword?: (
        payload: { email: string; redirectTo?: string },
        options?: { onError?: () => void },
      ) => Promise<{ error?: { message?: string } }>;
    };

    if (!clientWithForgotPassword.forgetPassword) {
      return {
        success: false,
        error: new Error("Password reset is not configured for this deployment."),
      };
    }

    const response = await clientWithForgotPassword.forgetPassword(
      {
        email,
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : undefined,
      },
      {
        onError: () => undefined,
      },
    );

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Unable to send reset link."),
      };
    }

    return {
      success: true,
    };
  },
  register: async ({ email, password, role, image, imageCldPubId }: RegisterParams) => {
    const roleValue = role === "admin" ? "admin" : "accounts";
    const response = await authClient.signUp.email(
      {
        email,
        password,
        name: email,
        role: roleValue,
        status: "active",
        image: typeof image === "string" ? image : undefined,
        imageCldPubId: typeof imageCldPubId === "string" ? imageCldPubId : "",
      },
      {
        onError: () => undefined,
      },
    );

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Unable to create user."),
      };
    }

    clearMeCache();
    return {
      success: true,
      redirectTo: "/users",
    };
  },
  getIdentity: async () => {
    let me = null as Awaited<ReturnType<typeof fetchMe>>;
    try {
      me = await fetchMe();
    } catch {
      me = null;
    }

    const currentUser = me?.user;
    if (!currentUser) {
      const session = await getSessionData();
      const sessionUser = session?.user;
      if (!sessionUser?.id || !sessionUser.email) {
        return null;
      }

      const fallbackName =
        typeof sessionUser.name === "string" && sessionUser.name.trim().length > 0
          ? sessionUser.name.trim()
          : sessionUser.email;
      const [firstName = fallbackName, ...rest] = fallbackName.split(" ");
      const lastName = rest.join(" ");

      return {
        id: sessionUser.id,
        email: sessionUser.email,
        firstName,
        lastName,
        fullName: fallbackName,
        avatar: typeof sessionUser.image === "string" ? sessionUser.image : undefined,
        role: sessionUser.role || undefined,
        roles: [],
        permissions: [],
        status: sessionUser.status || undefined,
      };
    }

    const safeName =
      typeof currentUser.name === "string" && currentUser.name.trim().length > 0
        ? currentUser.name.trim()
        : currentUser.email;
    const [firstName = safeName, ...rest] = safeName.split(" ");
    const lastName = rest.join(" ");

    return {
      id: currentUser.id,
      email: currentUser.email,
      firstName,
      lastName,
      fullName: safeName,
      avatar: undefined,
      role: me?.roles?.[0] || undefined,
      roles: me?.roles ?? [],
      permissions: me?.permissions ?? [],
      status: currentUser.status || undefined,
    };
  },
  getPermissions: async () => {
    try {
      const me = await fetchMe();
      return me?.permissions ?? null;
    } catch {
      return null;
    }
  },
};