import type { AuthProvider } from "@refinedev/core";

import { authClient } from "@/lib/auth-client";

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

const getSessionData = async (): Promise<AuthSessionData | null> => {
  const response = await authClient.getSession();
  return (response?.data as AuthSessionData | null) ?? null;
};

export const authProvider: AuthProvider = {
  login: async ({ email, password, rememberMe }) => {
    const response = await authClient.signIn.email(
      {
        email,
        password,
        rememberMe: Boolean(rememberMe),
      },
      {
        onError: (ctx) => ctx,
      },
    );

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Invalid email or password."),
      };
    }

    return {
      success: true,
      redirectTo: "/dashboard",
    };
  },
  logout: async () => {
    const response = await authClient.signOut({
      fetchOptions: {
        onError: (ctx) => ctx,
      },
    });

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Logout failed."),
      };
    }

    return {
      success: true,
      redirectTo: "/login",
    };
  },
  check: async () => {
    try {
      const session = await getSessionData();

      if (session?.user && session?.session) {
        return {
          authenticated: true,
        };
      }

      return {
        authenticated: false,
        redirectTo: "/login",
        logout: true,
      };
    } catch (error) {
      return {
        authenticated: false,
        redirectTo: "/login",
        logout: true,
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
    const response = await authClient.forgetPassword(
      {
        email,
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : undefined,
      },
      {
        onError: (ctx) => ctx,
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
  getIdentity: async () => {
    const session = await getSessionData();
    const currentUser = session?.user;

    if (!currentUser) {
      return null;
    }

    return {
      id: currentUser.id,
      email: currentUser.email,
      fullName: currentUser.name || currentUser.email,
      avatar: currentUser.image || undefined,
      role: currentUser.role || undefined,
      status: currentUser.status || undefined,
    };
  },
  getPermissions: async () => {
    const session = await getSessionData();
    return session?.user?.role ?? null;
  },
};