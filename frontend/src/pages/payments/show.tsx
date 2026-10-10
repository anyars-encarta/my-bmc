import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PageLoader from "@/components/PageLoader";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import { useShow } from "@refinedev/core";
import type { PaymentRecord } from "@/types/domain";

export const PaymentShow = () => {
  const { result: record, query } = useShow<PaymentRecord>({});

  if (query.isLoading) {
    return <PageLoader />;
  }

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Payment Details" />
      <Card>
        <CardHeader>
          <CardTitle>{record?.title || "Payment"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DataItem label="Category" value={record?.category?.name || record?.categoryId} />
          <DataItem label="Period" value={record?.period} />
          <DataItem label="Payment Officer" value={record?.createdBy} />
          <DataItem label="Approving Officer" value={record?.approvingOfficer} />
          <DataItem label="Approved By" value={record?.approvedBy} />
          <DataItem label="MoMo Reference" value={record?.momoReferenceId} />
          <DataItem label="Total Amount" value={formatCurrency(record?.totalAmount || 0)} />
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            {record?.status ? (
              <Badge variant="outline" className={paymentStatusTone(record.status)}>
                {toTitleCase(record.status)}
              </Badge>
            ) : (
              <p className="text-sm">-</p>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="text-sm font-medium">{record?.description || "-"}</p>
          </div>
        </CardContent>
      </Card>
    </ShowView>
  );
};

function DataItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}
