import type { AuthProvider } from "@refinedev/core";

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
        onError: () => undefined,
      },
    );

    if (response.error) {
      return {
        success: false,
        error: new Error(response.error.message || "Invalid email or password."),
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
      const session = await getSessionData();

      if (session?.user && session?.session) {
        try {
          const me = await fetchMe(true);
          if (!me) {
            return {
              authenticated: false,
              redirectTo: "/login",
              logout: true,
            };
          }
        } catch {
          return {
            authenticated: true,
          };
        }
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
    const me = await fetchMe();
    const currentUser = me?.user;

    if (!currentUser) {
      return null;
    }

    const [firstName = currentUser.name, ...rest] = currentUser.name.split(" ");
    const lastName = rest.join(" ");

    return {
      id: currentUser.id,
      email: currentUser.email,
      firstName,
      lastName,
      fullName: currentUser.name || currentUser.email,
      avatar: undefined,
      role: me?.roles?.[0] || undefined,
      roles: me?.roles ?? [],
      permissions: me?.permissions ?? [],
      status: currentUser.status || undefined,
    };
  },
  getPermissions: async () => {
    const me = await fetchMe();
    return me?.permissions ?? null;
  },
};