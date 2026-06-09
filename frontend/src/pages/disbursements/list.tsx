import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import type { DisbursementRecord } from "@/types/domain";

const disbursements: DisbursementRecord[] = [
  {
    id: "BATCH-101",
    paymentTitle: "Teacher Retention Incentive",
    momoBatchId: "MTN-2026-001",
    recipientsCount: 45,
    totalAmount: "34250",
    status: "sent",
    processedAt: "2026-06-09 10:04",
  },
  {
    id: "BATCH-102",
    paymentTitle: "Support Staff Transport",
    momoBatchId: "MTN-2026-002",
    recipientsCount: 28,
    totalAmount: "15800",
    status: "queued",
    processedAt: "2026-06-09 11:30",
  },
];

export const DisbursementList = () => {
  return (
    <ListView className="space-y-4">
      <ListViewHeader title="MTN Bulk Disbursement" canCreate={false} />

      <Card className="border-0 shadow-sm ring-1 ring-border bg-linear-to-r from-cyan-500/10 via-transparent to-emerald-500/10">
        <CardHeader>
          <CardTitle className="text-base">Disbursement Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Run Eligible Batches</Button>
          <Button variant="outline">Sync MTN Status</Button>
          <Button variant="outline">Download Settlement Report</Button>
        </CardContent>
      </Card>

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
