import { Loader } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useEffect, useState } from "react";

import type { AppRole } from "@/types/auth";
import { useAuth } from "@/contexts/use-auth";
import { getPublicApiBase } from "@/lib/public-api";

type ProtectedRouteProps = {
  allowRoles?: AppRole[];
};

export function ProtectedRoute({ allowRoles }: ProtectedRouteProps) {
  const { user, isLoading, refreshSession } = useAuth();
  const location = useLocation();
  const [redirectPath, setRedirectPath] = useState<"/login" | "/hosting-renewal" | null>(null);

  useEffect(() => {
    if (isLoading || user) {
      setRedirectPath(null);
      return;
    };

    let isActive = true;

    const resolveRedirectPath = async () => {
      try {
        const refreshedUser = await refreshSession();
        if (!isActive) return;

        if (refreshedUser) {
          return;
        }

        const response = await fetch(`${getPublicApiBase()}/public/hosting-renewal/info`);
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { hosted?: boolean; hostingExpiryDate?: string | null };
        };

        if (!isActive) return;

        const expiryDate = payload.success ? payload.data?.hostingExpiryDate ?? null : null;

        if (expiryDate) {
          const dueDate = new Date(`${expiryDate}T00:00:00Z`);
          const today = new Date();
          const todayStart = new Date(Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
          ));

          if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < todayStart.getTime()) {
            setRedirectPath("/hosting-renewal");
            return;
          }
        }

        setRedirectPath("/login");
      } catch {
        if (!isActive) return;
        setRedirectPath("/login");
      }
    };

    void resolveRedirectPath();

    return () => {
      isActive = false;
    };
  }, [isLoading, user, refreshSession]);

  if (isLoading || (!user && !redirectPath)) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader className="size-4 animate-spin" />
        Checking session...
      </div>
    );
  }

  if (!user) {
    if (redirectPath === "/hosting-renewal") {
      return <Navigate to="/hosting-renewal" replace />;
    }

    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowRoles && !allowRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
