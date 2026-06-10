import { APP_TAGLINE } from "@/constants/app";
import { formatCurrency } from "@/lib/currency";
import {
  ListView,
  ListViewHeader,
} from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, CircleCheck, Clock3, Wallet } from "lucide-react";
import MetricCard from "@/components/MetricCard";
import MonthlyPaymentsTrendChart from "@/components/MonthlyPaymentsTrendChart";
import type { PaymentRecord } from "@/types/domain";
import { useList } from "@refinedev/core";

type DashboardPayment = PaymentRecord & {
  recipients?: Array<{ status?: string }>;
};

export const DashboardPage = () => {
  const { result: paymentResult, query: paymentQuery } = useList<DashboardPayment>({
    resource: "payments",
    pagination: {
      pageSize: 500,
    },
  });

  const payments = paymentResult?.data ?? [];
  const totalPayments = payments.length;

  const draftPayments = payments.filter((payment) => payment.status === "draft");
  const pendingApprovals = payments.filter(
    (payment) => payment.status === "pending_approval",
  );
  const processingPayments = payments.filter(
    (payment) => payment.status === "processing",
  );

  const approvedVolume = payments.reduce((total, payment) => {
    if (!["approved", "processing", "completed"].includes(payment.status)) {
      return total;
    }

    const amount = Number(payment.totalAmount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const paymentsWithRecipients = payments.filter(
    (payment) => (payment.recipients?.length ?? 0) > 0,
  ).length;

  const calcPercent = (value: number) => {
    if (totalPayments === 0) return 0;
    return Math.round((value / totalPayments) * 100);
  };

  const reviewStages = [
    {
      label: "Recipients Added",
      percent: calcPercent(paymentsWithRecipients),
    },
    {
      label: "Approving Officer Review",
      percent: calcPercent(
        payments.filter((payment) =>
          ["pending_approval", "approved", "processing", "completed"].includes(
            payment.status,
          ),
        ).length,
      ),
    },
    {
      label: "Ready for Processing",
      percent: calcPercent(
        payments.filter((payment) =>
          ["approved", "processing", "completed"].includes(payment.status),
        ).length,
      ),
    },
    {
      label: "MTN MoMo Submitted",
      percent: calcPercent(
        payments.filter((payment) => ["processing", "completed"].includes(payment.status))
          .length,
      ),
    },
  ];

  return (
    <ListView className="space-y-6">
      <ListViewHeader title="Operations Dashboard" canCreate={false} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {paymentQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={`kpi-skeleton-${index}`} className="border-0 shadow-sm ring-1 ring-border">
              <CardContent className="space-y-3 pt-6">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-36" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <MetricCard
              title="Draft Payments"
              value={draftPayments.length.toString()}
              description="Awaiting recipient setup"
              icon={<Clock3 className="h-4 w-4" />}
            />
            <MetricCard
              title="Pending Approval"
              value={pendingApprovals.length.toString()}
              description="Needs officer review"
              icon={<Activity className="h-4 w-4" />}
            />
            <MetricCard
              title="Currently Processing"
              value={processingPayments.length.toString()}
              description="Queued for MTN bulk run"
              icon={<Wallet className="h-4 w-4" />}
            />
            <MetricCard
              title="Approved Volume"
              value={formatCurrency(approvedVolume)}
              description="Current records"
              icon={<CircleCheck className="h-4 w-4" />}
            />
          </>
        )}
      </section>

      <section>
        <MonthlyPaymentsTrendChart />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="overflow-hidden border-0 shadow-md ring-1 ring-border">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Review Pipeline
              <Badge variant="outline">Live</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {reviewStages.map((stage, index) => (
              <div
                key={stage.label}
                className="space-y-2 animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex items-center justify-between text-sm">
                  <p className="font-medium">{stage.label}</p>
                  <span className="text-muted-foreground">
                    {stage.percent}%
                  </span>
                </div>
                <Progress value={stage.percent} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm ring-1 ring-border bg-linear-to-br from-cyan-500/10 via-transparent to-emerald-500/10">
          <CardHeader>
            <CardTitle>Quick Lens</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="officer" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="officer">Officer</TabsTrigger>
                <TabsTrigger value="approver">Approver</TabsTrigger>
              </TabsList>
              <TabsContent value="officer" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Build payment batches, attach qualified staff, then submit for
                  approval.
                </p>
                <Badge className="bg-sky-600 text-white">Focus: Accuracy</Badge>
              </TabsContent>
              <TabsContent value="approver" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Review each recipient, adjust amounts, and gate payment
                  release.
                </p>
                <Badge className="bg-emerald-600 text-white">
                  Focus: Compliance
                </Badge>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>
    </ListView>
  );
};
