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

type DisbursementPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  momoReferenceId?: string | null;
  processedAt?: string | null;
  recipients?: Array<{ id: string }>;
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
  const [momoBalance, setMomoBalance] = useState(0);
  const [momoCurrency, setMomoCurrency] = useState("GHS");
  const [isLoadingMomoBalance, setIsLoadingMomoBalance] = useState(true);
  const [momoBalanceError, setMomoBalanceError] = useState<string | null>(null);

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
      }));
  }, [paymentsResult?.data]);

  const eligibleCount = useMemo(
    () =>
      (paymentsResult?.data ?? []).filter(
        (payment) => payment.status === "approved",
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
          <Button variant="outline" className="cursor-pointer" disabled>
            Sync Status
          </Button>
          <Button variant="outline" className="cursor-pointer" disabled>
            Download Settlement Report
          </Button>
        </CardContent>
      </Card>

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
                <CardTitle className="text-base">{item.paymentTitle}</CardTitle>
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
