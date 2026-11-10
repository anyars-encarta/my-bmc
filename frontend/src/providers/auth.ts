import type { AuthProvider } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { authClient } from "@/lib/auth-client";
import { APP_ROLES, type AppRole } from "@/types/auth";
import { clearMeCache, createAuthHeaders, fetchMe } from "./me";

type AuthUser = {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
  roles?: string[];
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
  name?: string;
  password: string;
  role?: AppRole;
  adminCreate?: boolean;
  image?: string | null;
  imageCldPubId?: string | null;
};

const sessionUrl = `${BACKEND_BASE_URL.replace(/\/+$/, "")}/auth/get-session`;
const usersUrl = `${BACKEND_BASE_URL.replace(/\/+$/, "")}/v1/users`;

const normalizeRole = (value: string | null | undefined): AppRole | undefined => {
  if (value === "admin") return "super_admin";
  return APP_ROLES.find((role) => role === value);
};

const getSessionData = async (): Promise<AuthSessionData | null> => {
  const response = await fetch(sessionUrl, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return null;
    throw new Error(`Session lookup failed with status ${response.status}.`);
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

    let session: AuthSessionData | null;
    try {
      session = await withTimeout(getSessionData(), 5000);
    } catch {
      clearMeCache();
      return {
        success: true,
      };
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
          let currentUser: Awaited<ReturnType<typeof fetchMe>> = null;
          try {
            currentUser = await fetchMe(true);
          } catch {
            return { authenticated: true };
          }

          if (currentUser?.user.status === "active") {
            return { authenticated: true };
          }

          clearMeCache();
          const signOut = await authClient.signOut({
            fetchOptions: { onError: () => undefined },
          });
          if (signOut.error) {
            console.error("Unable to clear an inactive user session:", signOut.error);
          }
          return { authenticated: false, redirectTo: "/login" };
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
  register: async ({
    email,
    name,
    password,
    role,
    adminCreate,
    image,
    imageCldPubId,
  }: RegisterParams) => {
    if (adminCreate) {
      try {
        const response = await fetch(usersUrl, {
          method: "POST",
          credentials: "include",
          headers: createAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            name: name?.trim() || email,
            email,
            password,
            roles: [role ?? "staff"],
            image,
            imageCldPubId,
          }),
        });
        const payload = (await response.json()) as { message?: string; error?: string };
        if (!response.ok) {
          return {
            success: false,
            error: new Error(payload.message || payload.error || "Unable to create user."),
          };
        }
        clearMeCache();
        return { success: true, redirectTo: "/users" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error("Unable to create user."),
        };
      }
    }

    const response = await authClient.signUp.email(
      {
        email,
        password,
        name: name?.trim() || email,
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
    let fetchFailed = false;
    try {
      me = await fetchMe();
    } catch {
      fetchFailed = true;
    }

    if (!fetchFailed && !me?.user) {
      return null;
    }

    if (fetchFailed) {
      const session = await getSessionData();
      const sessionUser = session?.user;
      if (!sessionUser?.id || !sessionUser.email) {
        return null;
      }
      let explicitRoles: string[] = [];
      try {
        const response = await fetch(
          `${BACKEND_BASE_URL.replace(/\/+$/, "")}/v1/users/${encodeURIComponent(sessionUser.id)}/roles`,
          {
            credentials: "include",
            cache: "no-store",
            headers: createAuthHeaders(),
          },
        );
        if (!response.ok) {
          throw new Error(`Role lookup failed with status ${response.status}.`);
        }
        const payload = (await response.json()) as { data?: unknown };
          explicitRoles = Array.isArray(payload.data)
            ? payload.data.filter((role): role is string =>
              typeof role === "string" && Boolean(normalizeRole(role)))
            : [];
      } catch (error) {
        console.error("Unable to load application roles for the current user:", error);
      }

      const sessionRole = normalizeRole(sessionUser.role);
      const roles = explicitRoles.length > 0
        ? explicitRoles.map((role) => normalizeRole(role)).filter((role): role is AppRole => Boolean(role))
        : sessionRole
          ? [sessionRole]
          : [];

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
        role: roles[0],
        roles,
        permissions: [],
        status: sessionUser.status || undefined,
      };
    }

    const currentUser = me?.user;
    if (!currentUser) return null;

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
      role: me?.roles?.[0] ?? normalizeRole(currentUser.role),
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