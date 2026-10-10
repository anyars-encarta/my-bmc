import {
  ListView,
  ListViewHeader,
} from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BACKEND_BASE_URL } from "@/constants";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { PaymentStatus } from "@/types/domain";
import { useGetIdentity, useList } from "@refinedev/core";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { MomoBalanceResponse } from "@/types/momo";

type ApprovalPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  period: string;
  approvingOfficer?: string | null;
  category?: {
    name?: string;
  };
  recipients?: ApprovalRecipient[];
};

type ApprovalRecipient = {
  id: string;
  status: "pending" | "approved" | "disapproved";
};

type Identity = {
  id: string;
  email?: string;
  fullName?: string;
  role?: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const ApprovalQueueList = () => {
  const navigate = useNavigate();
  const { data: identity } = useGetIdentity<Identity>();
  const [searchQuery, setSearchQuery] = useState("");

  const { result: paymentsResult, query: paymentsQuery } =
    useList<ApprovalPayment>({
      resource: "payments",
      pagination: {
        pageSize: 200,
      },
    });

  const [momoBalance, setMomoBalance] = useState(0);
  const [momoCurrency, setMomoCurrency] = useState("GHS");
  const [isLoadingMomoBalance, setIsLoadingMomoBalance] = useState(true);
  const [momoBalanceError, setMomoBalanceError] = useState<string | null>(null);

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
  }, []);

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

  const queueItems = useMemo(() => {
    const payments = paymentsResult?.data ?? [];
    const identityTokens = [identity?.id, identity?.email, identity?.fullName]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim());
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return payments
      .filter((payment) => {
        if (identity?.role === "admin" || identity?.role === "accounts") {
          return true;
        }

        if (!payment.approvingOfficer) {
          return false;
        }

        const approver = payment.approvingOfficer.toLowerCase().trim();
        return identityTokens.includes(approver);
      })
      .filter((payment) => {
        if (!normalizedSearch) {
          return true;
        }

        const searchableText = [
          payment.title,
          payment.category?.name,
          payment.status,
          payment.approvingOfficer,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
          .join(" ");

        return searchableText.includes(normalizedSearch);
      })
      .map((payment) => {
        const pendingReviewCount = (payment.recipients ?? []).filter(
          (recipient) => recipient.status === "pending",
        ).length;

        return {
          id: payment.id,
          paymentTitle: payment.title,
          period: payment.period,
          categoryName: payment.category?.name || "-",
          recipientsCount: payment.recipients?.length ?? 0,
          pendingReviewCount,
          totalAmount: payment.totalAmount,
          approvingOfficer: payment.approvingOfficer || "-",
          status: payment.status,
          raw: payment,
        };
      });
  }, [
    identity?.email,
    identity?.fullName,
    identity?.id,
    identity?.role,
    paymentsResult?.data,
    searchQuery,
  ]);

  return (
    <ListView className="space-y-4">
      <div className="flex items-center justify-between">
        <ListViewHeader title="Approval Queue" canCreate={false} />

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

      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search approvals by payment, category, status, or approver"
          className="pl-10"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>
      {paymentsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading approvals...</p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {queueItems.map((item, index) => (
          <Card
            key={item.id}
            className="border-0 shadow-sm ring-1 ring-border animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.paymentTitle} - {item.period}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {item.categoryName}
                </p>
              </div>
              <Badge
                variant="outline"
                className={paymentStatusTone(item.status)}
              >
                {toTitleCase(item.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <DataLine
                  label="Recipients"
                  value={String(item.recipientsCount)}
                />
                <DataLine
                  label="Pending Verification"
                  value={String(item.pendingReviewCount)}
                />
                <DataLine
                  label="Amount"
                  value={formatCurrency(item.totalAmount)}
                />
                <DataLine label="Approver" value={item.approvingOfficer} />
              </div>
              <div className="flex gap-2">
                {identity?.role === "accounts" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => navigate(`/approvals/${item.id}`)}
                  >
                    Manage Beneficiaries
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => navigate(`/approvals/${item.id}`)}
                  >
                    Open Review
                  </Button>
                )}
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
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
