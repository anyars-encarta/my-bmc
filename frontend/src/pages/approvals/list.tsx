import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { ApprovalQueueRecord } from "@/types/domain";

const records: ApprovalQueueRecord[] = [
  {
    id: "APP-001",
    paymentTitle: "Teacher Retention Incentive",
    categoryName: "Retention",
    recipientsCount: 45,
    pendingReviewCount: 8,
    totalAmount: "34250",
    approvingOfficer: "Finance Director",
    status: "pending_approval",
  },
  {
    id: "APP-002",
    paymentTitle: "Support Staff Transport",
    categoryName: "Logistics",
    recipientsCount: 28,
    pendingReviewCount: 0,
    totalAmount: "15800",
    approvingOfficer: "Deputy Director",
    status: "approved",
  },
];

export const ApprovalQueueList = () => {
  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Approval Queue" canCreate={false} />
      <div className="grid gap-4 xl:grid-cols-2">
        {records.map((item, index) => (
          <Card
            key={item.id}
            className="border-0 shadow-sm ring-1 ring-border animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.paymentTitle}</CardTitle>
                <p className="text-sm text-muted-foreground">{item.categoryName}</p>
              </div>
              <Badge variant="outline" className={paymentStatusTone(item.status)}>
                {toTitleCase(item.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <DataLine label="Recipients" value={String(item.recipientsCount)} />
                <DataLine
                  label="Pending Verification"
                  value={String(item.pendingReviewCount)}
                />
                <DataLine label="Amount" value={formatCurrency(item.totalAmount)} />
                <DataLine label="Approver" value={item.approvingOfficer} />
              </div>
              <div className="flex gap-2">
                <Button size="sm">Open Review</Button>
                <Button size="sm" variant="outline">
                  Adjust Recipients
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ListView>
  );
};

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
