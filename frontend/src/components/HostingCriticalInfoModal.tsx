import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/use-auth";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { Separator } from "./ui/separator";
import { formatDate } from "@/lib/timeFormat";
import { SetupRecord } from "@/types/domain";

type HostingModalVariant = "temporal-hosting" | "hosting-expiry" | null;

const MILLISECONDS_IN_A_DAY = 1000 * 60 * 60 * 24;

const getDaysUntilExpiry = (hostingExpiryDate: string | null | undefined) => {
  if (!hostingExpiryDate) {
    return null;
  }

  const expiryDate = new Date(`${hostingExpiryDate}T00:00:00`);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Math.floor(
    (expiryDate.getTime() - todayStart.getTime()) / MILLISECONDS_IN_A_DAY,
  );
};

const HostingCriticalInfoModal = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [systemSettings, setSystemSettings] = useState<SetupRecord | null>(
    null,
  );
  const [hasFetchedSettings, setHasFetchedSettings] = useState(false);
  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [actionCompleted, setActionCompleted] = useState(false);
  const [modalVariant, setModalVariant] = useState<HostingModalVariant>(null);
  const hasHandledExpiredHosting = useRef(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    let isActive = true;
    setHasFetchedSettings(false);
    setInitialized(false);

    const loadSystemSettings = async () => {
      try {
        const response = await apiGet<{ data: SetupRecord }>(
          "/settings/business",
        );
        if (isActive) {
          setSystemSettings(response.data ?? null);
        }
      } catch {
        if (isActive) {
          setSystemSettings(null);
        }
      } finally {
        if (isActive) {
          setHasFetchedSettings(true);
        }
      }
    };

    void loadSystemSettings();

    return () => {
      isActive = false;
    };
  }, [user]);

  const daysUntilExpiry = getDaysUntilExpiry(systemSettings?.hostingExpiryDate);

  const isHostingExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;

  useEffect(() => {
    if (!user || initialized || !hasFetchedSettings) {
      return;
    }

    if (!systemSettings) {
      setInitialized(true);
      return;
    }

    if (isHostingExpired) {
      if (hasHandledExpiredHosting.current) {
        return;
      }

      hasHandledExpiredHosting.current = true;
      setOpen(false);
      setModalVariant(null);
      setInitialized(true);
      toast.error("Hosting has expired", {
        id: "hosting-expired",
        richColors: true,
      });
      navigate("/hosting-renewal", { replace: true });
      return;
    }

    if (
      systemSettings.hosted === false &&
      daysUntilExpiry !== null &&
      daysUntilExpiry <= 7
    ) {
      setModalVariant("temporal-hosting");
      setActionCompleted(false);
      setOpen(true);
      setInitialized(true);
      return;
    }

    if (
      systemSettings.hosted === true &&
      daysUntilExpiry !== null &&
      daysUntilExpiry <= 7
    ) {
      setModalVariant("hosting-expiry");
      setActionCompleted(false);
      setOpen(true);
      setInitialized(true);
      return;
    }

    setInitialized(true);
  }, [
    daysUntilExpiry,
    hasFetchedSettings,
    initialized,
    isHostingExpired,
    navigate,
    systemSettings,
    user,
  ]);

  if (!user) {
    return null;
  }

  const canDismiss = actionCompleted;
  const isTemporalHostingModal = modalVariant === "temporal-hosting";
  const formattedExpiryDate = formatDate(
    systemSettings?.hostingExpiryDate ?? undefined,
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || canDismiss) {
          setOpen(nextOpen);
        }
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (!canDismiss) {
            event.preventDefault();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400">
            {isTemporalHostingModal ? "CRITICAL INFO" : "HOSTING EXPIRY NOTICE"}
          </AlertDialogTitle>
          <Separator />
          <AlertDialogDescription>
            {isTemporalHostingModal ? (
              <>
                This system is currently on Temporal Hosting and would be
                expiring on{" "}
                <span className="text-red-400 font-bold">
                  {formattedExpiryDate}
                </span>
                .
                <br />
                <br />
                Please contact your software developer immediately to avoid
                service interruption.
              </>
            ) : (
              <>
                {daysUntilExpiry !== null && daysUntilExpiry < 0
                  ? "This system hosting has expired."
                  : `This system hosting will expire in ${
                      daysUntilExpiry ?? 0
                    } day(s).`}{" "}
                Expiry date:{" "}
                <span className="text-red-400 font-bold">
                  {formattedExpiryDate}
                </span>
                .
                <br />
                <br />
                Please renew or contact your software developer as soon as
                possible to avoid service interruption.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Separator />

        <div className="flex items-start space-x-2">
          <Checkbox
            id="hosting-critical-ack"
            checked={actionCompleted}
            onCheckedChange={(checked) =>
              setActionCompleted(checked === "indeterminate" ? false : checked)
            }
          />
          <Label htmlFor="hosting-critical-ack" className="leading-5">
            {isTemporalHostingModal
              ? "I have read this critical information and will contact the software developer."
              : "I have read this hosting expiry notice and will take action immediately."}
          </Label>
        </div>

        <AlertDialogAction
          className="cursor-pointer"
          disabled={!actionCompleted}
        >
          I Understand
        </AlertDialogAction>

        <Separator />
        <span className="text-xs text-muted-foreground text-end">
          The Hosting Team
        </span>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default HostingCriticalInfoModal;
