import { Loader } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useEffect, useState } from "react";

import type { AppRole } from "@/types/auth";
import { useAuth } from "@/contexts/use-auth";

type ProtectedRouteProps = {
  allowRoles?: AppRole[];
};

export function ProtectedRoute({ allowRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [redirectPath, setRedirectPath] = useState<"/login" | "/hosting-renewal" | null>(null);
  const [checkingHostingStatus, setCheckingHostingStatus] = useState(false);

  useEffect(() => {
    if (isLoading || user) {
      setRedirectPath(null);
      setCheckingHostingStatus(false);
      return;
    }

    let isActive = true;
    setCheckingHostingStatus(true);

    const resolveRedirectPath = async () => {
      try {
        const response = await fetch("/api/public/hosting-renewal/info");
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { hosted?: boolean; hostingExpiryDate?: string | null };
        };

        if (!isActive) return;

        const expiryDate = payload.success ? payload.data?.hostingExpiryDate ?? null : null;

        if (expiryDate) {
          const dueDate = new Date(`${expiryDate}T00:00:00`);
          const today = new Date();
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

          if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() <= todayStart.getTime()) {
            setRedirectPath("/hosting-renewal");
            setCheckingHostingStatus(false);
            return;
          }
        }

        setRedirectPath("/login");
      } catch {
        if (!isActive) return;
        setRedirectPath("/login");
      } finally {
        if (isActive) {
          setCheckingHostingStatus(false);
        }
      }
    };

    void resolveRedirectPath();

    return () => {
      isActive = false;
    };
  }, [isLoading, user]);

  if (isLoading || (!user && checkingHostingStatus && !redirectPath)) {
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
