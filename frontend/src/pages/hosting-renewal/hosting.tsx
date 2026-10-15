import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import { BACKEND_BASE_URL } from "@/constants/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { openPaystackCheckout } from "@/lib/paystack-inline";
import { Loader } from "lucide-react";

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const toLocalDateString = (date: Date) => date.toISOString().slice(0, 10);

const formatDisplayDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
};

const getPublicApiBase = () =>
  BACKEND_BASE_URL.replace(/\/+$/, "").replace(/\/api$/, "");

type HostingInfo = {
  facilityName: string | null;
  logoUrl: string | null;
  businessEmail: string | null;
  monthlyRenewalFee: string | null;
  hosted: boolean;
  hostingExpiryDate: string | null;
};

type ExchangeRateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; rate: number; fetchedAt: Date };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; endDate: string; totalCedi: number; paymentReference: string | null }
  | { status: "error"; message: string };

const fetchUsdToGhsRate = async (): Promise<number> => {
  const response = await fetch("https://api.frankfurter.dev/v2/rate/USD/GHS");

  if (!response.ok) {
    throw new Error(`Exchange rate API responded with ${response.status}`);
  }

  const payload = (await response.json()) as { rate?: number };
  const rate = Number(payload.rate);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Unable to load USD to GHS exchange rate");
  }

  return rate;
};

const HostingRenewal = () => {
  const navigate = useNavigate();
  const [info, setInfo] = useState<HostingInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [months, setMonths] = useState("1");
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateState>({ status: "idle" });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  const paystackPublicKey =
    (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined) ?? "";

  const today = new Date();
  const startDate = toLocalDateString(today);
  const quantityInMonths = Math.max(1, Number.parseInt(months, 10) || 1);
  const endDate = toLocalDateString(addMonths(today, quantityInMonths));

  const monthlyDollarRate = info?.monthlyRenewalFee ? Number(info.monthlyRenewalFee) : null;
  const totalDollarAmount = monthlyDollarRate !== null ? monthlyDollarRate * quantityInMonths : null;
  const totalCediEquivalent =
    totalDollarAmount !== null && exchangeRate.status === "loaded"
      ? totalDollarAmount * exchangeRate.rate
      : null;
  const paymentAmount = totalCediEquivalent !== null ? Number(totalCediEquivalent.toFixed(2)) : 0;

  const paystackReference = useMemo(
    () => `hosting-renewal-${quantityInMonths}-${Date.now()}`,
    [quantityInMonths],
  );

  useEffect(() => {
    const loadInfo = async () => {
      setInfoLoading(true);
      setInfoError(null);

      try {
        const response = await fetch(`${getPublicApiBase()}/public/hosting-renewal/info`);
        const payload = (await response.json()) as {
          success?: boolean;
          data?: Partial<
            HostingInfo & {
              businessName: string | null;
              businessLogo: string | null;
            }
          >;
          error?: string;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Failed to load hosting info");
        }

        const data = payload.data;
        if (!data) {
          setInfo(null);
          return;
        }

        setInfo({
          facilityName: data.facilityName ?? data.businessName ?? null,
          logoUrl: data.logoUrl ?? data.businessLogo ?? null,
          businessEmail: data.businessEmail ?? null,
          monthlyRenewalFee: data.monthlyRenewalFee ?? null,
          hosted: data.hosted ?? false,
          hostingExpiryDate: data.hostingExpiryDate ?? null,
        });
      } catch (error) {
        setInfoError(error instanceof Error ? error.message : "Failed to load hosting info");
      } finally {
        setInfoLoading(false);
      }
    };

    void loadInfo();
  }, []);

  const loadExchangeRate = useCallback(async () => {
    setExchangeRate({ status: "loading" });

    try {
      const rate = await fetchUsdToGhsRate();
      setExchangeRate({ status: "loaded", rate, fetchedAt: new Date() });
    } catch (error) {
      setExchangeRate({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to fetch exchange rate",
      });
    }
  }, []);

  useEffect(() => {
    void loadExchangeRate();
  }, [loadExchangeRate]);

  const confirmRenewal = useCallback(
    async (payment: {
      reference?: unknown;
      transactionId?: unknown;
      serviceChargeReference?: unknown;
      status?: unknown;
      serviceCharge?: unknown;
      amount: number;
      currency: string;
    }) => {
      const response = await fetch(`${getPublicApiBase()}/public/hosting-renewal/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantityInMonths,
          totalCediEquivalent: Number(totalCediEquivalent?.toFixed(2) ?? 0),
          payment,
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        data?: {
          paymentReference?: string | null;
          renewal?: { endDate?: string };
        };
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.message || "Failed to confirm hosting renewal");
      }

      setSubmitState({
        status: "success",
        endDate: payload.data?.renewal?.endDate ?? endDate,
        totalCedi: Number(totalCediEquivalent?.toFixed(2) ?? 0),
        paymentReference: payload.data?.paymentReference ?? null,
      });

      navigate("/login", { replace: true });
    },
    [endDate, navigate, quantityInMonths, totalCediEquivalent],
  );

  const handlePay = useCallback(() => {
    if (!paystackPublicKey) {
      setSubmitState({ status: "error", message: "Paystack public key is not configured." });
      return;
    }

    if (exchangeRate.status !== "loaded" || totalCediEquivalent === null || paymentAmount <= 0) {
      setSubmitState({ status: "error", message: "The renewal amount is not ready yet." });
      return;
    }

    setSubmitState({ status: "submitting" });

    const email = info?.businessEmail || "billing@business.local";
    const [firstName, ...restName] = (info?.facilityName || "Business").split(" ").filter(Boolean);
    const lastName = restName.join(" ") || undefined;

    void openPaystackCheckout({
      key: paystackPublicKey,
      email,
      amount: paymentAmount,
      currency: "GHS",
      reference: paystackReference,
      firstname: firstName || "Business",
      lastname: lastName,
      metadata: {
        quantityInMonths,
        purpose: "hosting_renewal",
      },
      onSuccess: async (response) => {
        const isSuccessful = String(response.status ?? "").toLowerCase() === "success";
        const resolvedReference =
          String(response.reference ?? "").trim() ||
          String(response.trans ?? "").trim() ||
          String(response.transaction ?? "").trim() ||
          String(response.trxref ?? "").trim() ||
          paystackReference;

        if (!isSuccessful || !resolvedReference) {
          setSubmitState({ status: "error", message: "Paystack did not confirm this payment." });
          return;
        }

        try {
          await confirmRenewal({
            reference: resolvedReference,
            transactionId: resolvedReference,
            status: response.status,
            amount: paymentAmount,
            currency: "GHS",
          });
        } catch (error) {
          setSubmitState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to confirm hosting renewal.",
          });
        }
      },
      onClose: () => {
        setSubmitState((current) => (current.status === "submitting" ? { status: "idle" } : current));
      },
    }).catch((error: unknown) => {
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to open Paystack checkout.",
      });
    });
  }, [
    confirmRenewal,
    exchangeRate.status,
    info?.businessEmail,
    info?.facilityName,
    paystackPublicKey,
    paystackReference,
    paymentAmount,
    quantityInMonths,
    totalCediEquivalent,
  ]);

  if (infoLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (infoError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Unable to Load Page
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{infoError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitState.status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle>Renewal Completed</CardTitle>
            <CardDescription>Your hosting renewal has been saved successfully.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">
                  {quantityInMonths} month{quantityInMonths > 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total (GHS)</span>
                <span className="font-medium">{formatCurrency(submitState.totalCedi, "GHS")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valid until</span>
                <span className="font-medium">{formatDisplayDate(submitState.endDate)}</span>
              </div>
              {submitState.paymentReference ? (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Reference</span>
                  <span className="font-medium text-right break-all">{submitState.paymentReference}</span>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              The facility hosting status and expiry date were updated in the background.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mb-4 flex flex-col items-center justify-center gap-3 border-b pb-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {info?.logoUrl ? (
                <img src={info.logoUrl} alt={info.facilityName ?? "Business"} className="h-full w-full object-contain" />
              ) : (
                <span className="text-sm text-muted-foreground">Logo</span>
              )}
            </div>
            <p className="text-xl font-semibold tracking-wider">{info?.facilityName || "Business"}</p>
          </div>
          <CardTitle className="text-2xl">Hosting Renewal</CardTitle>
          <CardDescription>
            Pay the converted amount below to renew hosting for your facility.
          </CardDescription>
        </CardHeader>

        <Separator />

        <CardContent className="pt-6">
          <form
            className="space-y-6"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              handlePay();
            }}
          >
            <div className="space-y-1.5">
              <Label>Monthly Rate (USD)</Label>
              <Input
                readOnly
                value={monthlyDollarRate !== null ? formatCurrency(monthlyDollarRate, "USD") : "Not configured"}
                className="bg-muted cursor-not-allowed"
              />
              {monthlyDollarRate === null ? (
                <p className="text-xs text-destructive">
                  Monthly renewal fee has not been configured in facility settings.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="months">Number of Months</Label>
              <Input
                id="months"
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(event) => setMonths(event.target.value)}
                placeholder="e.g. 3"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input readOnly value={formatDisplayDate(startDate)} className="bg-muted cursor-not-allowed" />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input readOnly value={formatDisplayDate(endDate)} className="bg-muted cursor-not-allowed" />
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <Label>USD → GHS Exchange Rate</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => void loadExchangeRate()}
                  disabled={exchangeRate.status === "loading"}
                >
                  <RefreshCw className={`h-3 w-3 ${exchangeRate.status === "loading" ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {exchangeRate.status === "loading" ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader className="h-8 w-8 animate-spin" />
                  Fetching live rate...
                </div>
              ) : null}

              {exchangeRate.status === "error" ? (
                <p className="text-xs text-destructive">{exchangeRate.message}</p>
              ) : null}

              {exchangeRate.status === "loaded" ? (
                <div className="space-y-1">
                  <Input readOnly value={`1 USD = ${exchangeRate.rate.toFixed(4)} GHS`} className="bg-muted cursor-not-allowed" />
                  <p className="text-xs text-muted-foreground">
                    Rate fetched at {exchangeRate.fetchedAt.toLocaleTimeString()}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="rounded-md border bg-muted/50 p-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Total (USD)</span>
                <span className="font-semibold">
                  {totalDollarAmount !== null ? formatCurrency(totalDollarAmount, "USD") : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Total (GHS)</span>
                <span className="font-semibold text-green-700 dark:text-green-400">
                  {totalCediEquivalent !== null
                    ? formatCurrency(totalCediEquivalent, "GHS")
                    : exchangeRate.status === "error"
                      ? "Rate unavailable"
                      : "—"}
                </span>
              </div>
            </div>

            {submitState.status === "error" ? (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {submitState.message}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full cursor-pointer"
              disabled={
                monthlyDollarRate === null ||
                exchangeRate.status !== "loaded" ||
                submitState.status === "submitting"
              }
            >
              {submitState.status === "submitting" ? (
                <span className="flex items-center gap-2">
                  <Loader className="h-8 w-8 animate-spin" />
                  Opening payment gateway...
                </span>
              ) : (
                `Pay ${formatCurrency(paymentAmount, "GHS")} & Renew Hosting`
              )}
            </Button>
          </form>

          <a
            href="/login"
            className="bottom-4 right-4 text-sm font-medium text-primary flex justify-end underline underline-offset-4 hover:text-primary/80"
          >
            Go to Login page
          </a>
        </CardContent>
      </Card>
    </div>
  );
};

export default HostingRenewal;
