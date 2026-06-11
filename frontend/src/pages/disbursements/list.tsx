import {
  ListView,
  ListViewHeader,
} from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BACKEND_BASE_URL } from "@/constants";
import { formatCurrency } from "@/lib/currency";
import { useCustomMutation, useList, useNotification } from "@refinedev/core";
import type { DisbursementRecord, PaymentStatus } from "@/types/domain";
import { useEffect, useMemo, useState } from "react";
import { MomoBalanceResponse } from "@/types/momo";
import PageLoader from "@/components/PageLoader";

type DisbursementPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  momoReferenceId?: string | null;
  processedAt?: string | null;
  period: string;
  recipients?: Array<{ id: string }>;
};

type DirectDisbursementResponse = {
  paymentId: string;
  batchReferenceId: string;
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  pendingCount?: number;
};

type SyncStatusResponse = {
  paymentsChecked: number;
  recipientsPolled: number;
  paymentsCompleted: number;
  paymentsStillProcessing: number;
  paymentResults?: Array<{
    paymentId: string;
    paymentTitle: string;
    polledRecipients: number;
    successCount: number;
    failureCount: number;
    pendingCount: number;
    finalized: boolean;
  }>;
};

const toDisbursementStatus = (
  status: PaymentStatus,
): DisbursementRecord["status"] => {
  if (status === "completed") return "successful";
  if (status === "processing") return "sent";
  if (status === "cancelled") return "failed";
  return "queued";
};

export const DisbursementList = () => {
  const LAST_SYNC_STORAGE_KEY = "disbursements:lastSyncResult";
  const [momoBalance, setMomoBalance] = useState(0);
  const [momoCurrency, setMomoCurrency] = useState("GHS");
  const [isLoadingMomoBalance, setIsLoadingMomoBalance] = useState(true);
  const [momoBalanceError, setMomoBalanceError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<{
    syncedAt: string;
    data: SyncStatusResponse;
  } | null>(null);

  useEffect(() => {
    try {
      const storedValue = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
      if (!storedValue) {
        return;
      }

      const parsed = JSON.parse(storedValue) as {
        syncedAt?: string;
        data?: SyncStatusResponse;
      };

      if (!parsed?.syncedAt || !parsed?.data) {
        return;
      }

      setLastSyncResult({
        syncedAt: parsed.syncedAt,
        data: parsed.data,
      });
    } catch {
      localStorage.removeItem(LAST_SYNC_STORAGE_KEY);
    }
  }, []);

  const { open: notify } = useNotification();
  const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
  const { result: paymentsResult, query: paymentsQuery } =
    useList<DisbursementPayment>({
      resource: "payments",
      pagination: {
        pageSize: 500,
      },
    });
  const { mutateAsync: runEligibleBatches, mutation } = useCustomMutation<{
    processedCount?: number;
    ids?: string[];
  }>();
  const { mutateAsync: disbursePayment, mutation: disbursementMutation } =
    useCustomMutation<DirectDisbursementResponse>();
  const {
    mutateAsync: syncDisbursementStatuses,
    mutation: syncStatusMutation,
  } = useCustomMutation<SyncStatusResponse>();

  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const isRunningEligible = mutation.status === "pending";

  const disbursements = useMemo<DisbursementRecord[]>(() => {
    const payments = paymentsResult?.data ?? [];

    return payments
      .filter((payment) =>
        ["approved", "processing", "completed", "cancelled"].includes(
          payment.status,
        ),
      )
      .map((payment) => ({
        id: payment.id,
        paymentTitle: payment.title,
        momoBatchId: payment.momoReferenceId || "Pending reference",
        recipientsCount: payment.recipients?.length ?? 0,
        totalAmount: payment.totalAmount,
        status: toDisbursementStatus(payment.status),
        processedAt: payment.processedAt
          ? new Date(payment.processedAt).toLocaleString()
          : "-",
        period: payment.period,
      }));
  }, [paymentsResult?.data]);

  const eligibleCount = useMemo(
    () =>
      (paymentsResult?.data ?? []).filter(
        (payment) => payment.status === "approved",
      ).length,
    [paymentsResult?.data],
  );

  const processingCount = useMemo(
    () =>
      (paymentsResult?.data ?? []).filter(
        (payment) => payment.status === "processing",
      ).length,
    [paymentsResult?.data],
  );

  const handleRunEligibleBatches = async () => {
    try {
      const response = await runEligibleBatches({
        url: `${apiBase}/payments/process-eligible`,
        method: "post",
        values: {},
      });

      const processedCount = Number(response?.data?.processedCount ?? 0);
      await paymentsQuery.refetch();
      notify?.({
        type: "success",
        message:
          processedCount > 0
            ? `Queued ${processedCount} batch${
                processedCount === 1 ? "" : "es"
              } for processing.`
            : "No eligible approved batches found.",
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to run eligible batches.",
      });
    }
  };

  const handleDisburseSelectedPayment = async (
    paymentId: string,
    paymentTitle: string,
  ) => {
    setActivePaymentId(paymentId);

    try {
      const response = await disbursePayment({
        url: `${apiBase}/payments/${paymentId}/disburse`,
        method: "post",
        values: {},
      });

      const attemptedCount = Number(response?.data?.attemptedCount ?? 0);
      const successCount = Number(response?.data?.successCount ?? 0);
      const failureCount = Number(response?.data?.failureCount ?? 0);
      const pendingCount = Number(response?.data?.pendingCount ?? 0);

      await paymentsQuery.refetch();

      notify?.({
        type: "success",
        message:
          failureCount > 0 || pendingCount > 0
            ? `${paymentTitle}: ${successCount}/${attemptedCount} successful, ${failureCount} failed, ${pendingCount} pending final MTN confirmation.`
            : `${paymentTitle}: all ${successCount} beneficiary transfer(s) confirmed successful.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to disburse selected payment.",
      });
    } finally {
      setActivePaymentId(null);
    }
  };

  const handleSyncStatuses = async () => {
    try {
      const response = await syncDisbursementStatuses({
        url: `${apiBase}/payments/sync-status`,
        method: "post",
        values: {},
      });

      const paymentsChecked = Number(response?.data?.paymentsChecked ?? 0);
      const recipientsPolled = Number(response?.data?.recipientsPolled ?? 0);
      const paymentsCompleted = Number(response?.data?.paymentsCompleted ?? 0);
      const paymentsStillProcessing = Number(
        response?.data?.paymentsStillProcessing ?? 0,
      );

      if (response?.data) {
        const nextSyncResult = {
          syncedAt: new Date().toLocaleString(),
          data: response.data,
        };
        setLastSyncResult(nextSyncResult);
        localStorage.setItem(
          LAST_SYNC_STORAGE_KEY,
          JSON.stringify(nextSyncResult),
        );
      }

      await paymentsQuery.refetch();

      notify?.({
        type: "success",
        message:
          paymentsChecked === 0
            ? "No processing payments found to sync."
            : `Sync complete: ${recipientsPolled} transfers polled, ${paymentsCompleted} payment(s) finalized, ${paymentsStillProcessing} still processing.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to sync disbursement statuses.",
      });
    }
  };

  const finalizedInLastSync = useMemo(
    () =>
      (lastSyncResult?.data.paymentResults ?? []).filter(
        (payment) => payment.finalized,
      ),
    [lastSyncResult],
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadMomoBalance = async () => {
      setIsLoadingMomoBalance(true);
      setMomoBalanceError(null);

      try {
        const response = await fetch(`${apiBase}/momo/balance`, {
          credentials: "include",
          signal: controller.signal,
        });

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as MomoBalanceResponse) : {};

        if (!response.ok) {
          const message =
            payload.error || payload.message || "Unable to fetch MoMo balance.";
          throw new Error(message);
        }

        const availableBalance = Number(payload.data?.availableBalance ?? 0);
        setMomoBalance(
          Number.isFinite(availableBalance) ? availableBalance : 0,
        );
        setMomoCurrency(payload.data?.currency || "GHS");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setMomoBalanceError(
          error instanceof Error
            ? error.message
            : "Unable to fetch MoMo balance.",
        );
      } finally {
        setIsLoadingMomoBalance(false);
      }
    };

    void loadMomoBalance();

    return () => controller.abort();
  }, [apiBase]);

  const formattedMomoBalance = useMemo(() => {
    if (momoCurrency === "GHS") {
      return formatCurrency(momoBalance);
    }

    try {
      return new Intl.NumberFormat("en-GH", {
        style: "currency",
        currency: momoCurrency,
        minimumFractionDigits: 2,
      }).format(momoBalance);
    } catch {
      return `${momoCurrency} ${momoBalance.toFixed(2)}`;
    }
  }, [momoBalance, momoCurrency]);

  return (
    <ListView className="space-y-4">
      <div className="flex items-center justify-between">
        <ListViewHeader title="Bulk Disbursement" canCreate={false} />

        <div className="text-right">
          <p className="text-sm font-medium">
            MoMo Balance:{" "}
            {isLoadingMomoBalance ? "Loading..." : formattedMomoBalance}
          </p>
          {momoBalanceError && (
            <p className="text-xs text-destructive">{momoBalanceError}</p>
          )}
        </div>
      </div>

      <Card className="border-0 shadow-sm ring-1 ring-border bg-linear-to-r from-cyan-500/10 via-transparent to-emerald-500/10">
        <CardHeader>
          <CardTitle className="text-base">Disbursement Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            onClick={handleRunEligibleBatches}
            className="cursor-pointer"
            disabled={
              isRunningEligible ||
              paymentsQuery.isLoading ||
              eligibleCount === 0
            }
          >
            {isRunningEligible
              ? "Running..."
              : `Run Eligible Batches${
                  eligibleCount > 0 ? ` (${eligibleCount})` : ""
                }`}
          </Button>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={handleSyncStatuses}
            disabled={
              syncStatusMutation.status === "pending" ||
              paymentsQuery.isLoading ||
              processingCount === 0
            }
          >
            {syncStatusMutation.status === "pending"
              ? "Syncing..."
              : `Sync Status${
                  processingCount > 0 ? ` (${processingCount})` : ""
                }`}
          </Button>
          <Button variant="outline" className="cursor-pointer" disabled>
            Download Settlement Report
          </Button>
        </CardContent>
      </Card>

      {lastSyncResult && (
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last Sync Result</CardTitle>
            <p className="text-xs text-muted-foreground">
              Synced at {lastSyncResult.syncedAt}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                Checked {lastSyncResult.data.paymentsChecked}
              </Badge>
              <Badge variant="outline">
                Polled {lastSyncResult.data.recipientsPolled}
              </Badge>
              <Badge className="bg-emerald-600 text-white">
                Finalized {lastSyncResult.data.paymentsCompleted}
              </Badge>
              <Badge variant="secondary">
                Still Processing {lastSyncResult.data.paymentsStillProcessing}
              </Badge>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Payments Finalized In This Sync
              </p>
              {finalizedInLastSync.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No payments were finalized in the most recent sync.
                </p>
              ) : (
                <div className="space-y-2">
                  {finalizedInLastSync.map((payment) => (
                    <div
                      key={payment.paymentId}
                      className="rounded-md border border-border p-2"
                    >
                      <p className="font-medium">{payment.paymentTitle}</p>
                      <p className="text-xs text-muted-foreground">
                        {payment.successCount} successful of{" "}
                        {payment.polledRecipients} polled
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {paymentsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading disbursements...
        </p>
      )}
      {!paymentsQuery.isLoading && disbursements.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No disbursements found yet.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {disbursements.map((item, index) => (
          <Card
            key={item.id}
            className="border-0 shadow-sm ring-1 ring-border animate-in fade-in zoom-in-95"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  {item.paymentTitle} - {item.period}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Batch {item.momoBatchId}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <DataLine
                label="Recipients"
                value={String(item.recipientsCount)}
              />
              <DataLine
                label="Amount"
                value={formatCurrency(item.totalAmount)}
              />
              <DataLine label="Processed At" value={item.processedAt} />
              <DataLine label="Batch Reference" value={item.id} />

              <div className="sm:col-span-2 pt-1">
                <Button
                  className="cursor-pointer"
                  onClick={() =>
                    handleDisburseSelectedPayment(item.id, item.paymentTitle)
                  }
                  disabled={
                    item.status !== "queued" ||
                    disbursementMutation.status === "pending"
                  }
                >
                  {disbursementMutation.status === "pending" &&
                  activePaymentId === item.id ? (
                    <>
                      <PageLoader />
                      <span>Disbursing...</span>
                    </>
                  ) : item.status === "queued" ? (
                    "Disburse Selected Payment"
                  ) : (
                    "Disbursement Not Available"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ListView>
  );
};

function StatusBadge({ status }: { status: DisbursementRecord["status"] }) {
  if (status === "successful") {
    return <Badge className="bg-emerald-600 text-white">Successful</Badge>;
  }
  if (status === "sent") {
    return <Badge className="bg-sky-600 text-white">Sent</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }

  return <Badge variant="outline">Queued</Badge>;
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
