import { formatCurrency } from "@/lib/currency";
import type { PaymentRecord } from "@/types/domain";
import { useList } from "@refinedev/core";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Skeleton } from "./ui/skeleton";

const buildMonthlyTrend = (payments: PaymentRecord[]) => {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      month: monthDate.toLocaleString("en-US", { month: "short" }),
      amount: 0,
    };
  });

  const monthMap = new Map(months.map((item) => [item.key, item]));

  payments.forEach((payment) => {
    if (!payment.createdAt) return;

    const createdAt = new Date(payment.createdAt);
    if (Number.isNaN(createdAt.getTime())) return;

    const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
    const row = monthMap.get(key);
    if (!row) return;

    const amount = Number(payment.totalAmount);
    row.amount += Number.isFinite(amount) ? amount : 0;
  });

  return months;
};

const MonthlyPaymentsTrendChart = () => {
  const { result: paymentsResult, query: paymentsQuery } = useList<PaymentRecord>({
    resource: "payments",
    pagination: {
      pageSize: 500,
    },
  });

  const payments = paymentsResult?.data ?? [];
  const monthlyTrend = buildMonthlyTrend(payments);

  return (
    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-border">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Monthly Payments Trend
          <Badge variant="outline">Last 6 Months</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Total payment value created per month.
        </p>
      </CardHeader>
      <CardContent>
        {paymentsQuery.isLoading ? (
          <Skeleton className="h-70 w-full" />
        ) : (
          <ChartContainer
            className="h-70 w-full"
            config={{
              amount: {
                label: "Payments",
                color: "var(--chart-2)",
              },
            }}
          >
            <AreaChart data={monthlyTrend} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatCurrency(Number(value) || 0)}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="var(--color-amount)"
                fill="var(--color-amount)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default MonthlyPaymentsTrendChart;