import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { useList } from "@refinedev/core";
import type { DisbursementRecord, PaymentStatus } from "@/types/domain";
import { useMemo } from "react";

type DisbursementPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  momoReferenceId?: string | null;
  processedAt?: string | null;
  recipients?: Array<{ id: string }>;
};

const toDisbursementStatus = (status: PaymentStatus): DisbursementRecord["status"] => {
  if (status === "completed") return "successful";
  if (status === "processing") return "sent";
  if (status === "cancelled") return "failed";
  return "queued";
};

export const DisbursementList = () => {
  const { result: paymentsResult, query: paymentsQuery } = useList<DisbursementPayment>({
    resource: "payments",
    pagination: {
      pageSize: 500,
    },
  });

  const disbursements = useMemo<DisbursementRecord[]>(() => {
    const payments = paymentsResult?.data ?? [];

    return payments
      .filter((payment) => ["approved", "processing", "completed", "cancelled"].includes(payment.status))
      .map((payment) => ({
        id: payment.id,
        paymentTitle: payment.title,
        momoBatchId: payment.momoReferenceId || "Pending reference",
        recipientsCount: payment.recipients?.length ?? 0,
        totalAmount: payment.totalAmount,
        status: toDisbursementStatus(payment.status),
        processedAt: payment.processedAt ? new Date(payment.processedAt).toLocaleString() : "-",
      }));
  }, [paymentsResult?.data]);

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Bulk Disbursement" canCreate={false} />

      <Card className="border-0 shadow-sm ring-1 ring-border bg-linear-to-r from-cyan-500/10 via-transparent to-emerald-500/10">
        <CardHeader>
          <CardTitle className="text-base">Disbursement Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled>Run Eligible Batches</Button>
          <Button variant="outline" disabled>Sync Status</Button>
          <Button variant="outline" disabled>Download Settlement Report</Button>
        </CardContent>
      </Card>

      {paymentsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading disbursements...</p>}
      {!paymentsQuery.isLoading && disbursements.length === 0 && (
        <p className="text-sm text-muted-foreground">No disbursements found yet.</p>
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
                <p className="text-sm text-muted-foreground">Batch {item.momoBatchId}</p>
              </div>
              <StatusBadge status={item.status} />
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <DataLine label="Recipients" value={String(item.recipientsCount)} />
              <DataLine label="Amount" value={formatCurrency(item.totalAmount)} />
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
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
