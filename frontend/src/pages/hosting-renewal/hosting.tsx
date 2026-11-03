import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import { getPublicApiBase } from "@/lib/public-api";
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
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(
    date.getDate(),
    new Date(targetYear, targetMonth + 1, 0).getDate(),
  );
  return new Date(
    targetYear,
    targetMonth,
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
};

const toLocalDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const formatDisplayDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
};

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
  | { status: "success"; months: number; endDate: string; totalCedi: number; paymentReference: string | null }
  | { status: "error"; message: string };

type RenewalReference = {
  reference: string;
  quantityInMonths: number;
  exchangeRate: number;
  totalCediEquivalent: number;
  startDate: string;
  endDate: string;
  expiresAt: string;
};

type AcceptedCharge = {
  reference: string;
  quantityInMonths: number;
  amount: number;
  exchangeRate: number;
  startDate: string;
  endDate: string;
};

const ACCEPTED_CHARGE_STORAGE_KEY = "hosting-renewal-accepted-charge";

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
  const [info, setInfo] = useState<HostingInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [months, setMonths] = useState("1");
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateState>({ status: "idle" });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [renewalReference, setRenewalReference] = useState<RenewalReference | null>(null);
  const [acceptedCharge, setAcceptedCharge] = useState<AcceptedCharge | null>(null);

  const paystackPublicKey =
    (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined) ?? "";

  const today = new Date();
  const startDate = toLocalDateString(today);
  const quantityInMonths = Math.max(1, Number.parseInt(months, 10) || 1);
  const endDate = toLocalDateString(addMonths(today, quantityInMonths));

  const monthlyDollarRate = info?.monthlyRenewalFee ? Number(info.monthlyRenewalFee) : null;
  const totalDollarAmount = monthlyDollarRate !== null ? monthlyDollarRate * quantityInMonths : null;
  const totalCediEquivalent = renewalReference?.quantityInMonths === quantityInMonths
    ? renewalReference.totalCediEquivalent
    : totalDollarAmount !== null && exchangeRate.status === "loaded"
      ? totalDollarAmount * exchangeRate.rate
      : null;
  const displayedExchangeRate = renewalReference?.quantityInMonths === quantityInMonths
    ? renewalReference.exchangeRate
    : exchangeRate.status === "loaded"
      ? exchangeRate.rate
      : null;
  const paymentAmount = totalCediEquivalent !== null ? Number(totalCediEquivalent.toFixed(2)) : 0;
  const displayedStartDate = renewalReference?.quantityInMonths === quantityInMonths
    ? renewalReference.startDate
    : startDate;
  const displayedEndDate = renewalReference?.quantityInMonths === quantityInMonths
    ? renewalReference.endDate
    : endDate;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ACCEPTED_CHARGE_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<AcceptedCharge>;
      if (
        typeof parsed.reference !== "string" ||
        !parsed.reference ||
        !Number.isInteger(parsed.quantityInMonths) ||
        typeof parsed.amount !== "number" ||
        !Number.isFinite(parsed.amount) ||
        typeof parsed.exchangeRate !== "number" ||
        !Number.isFinite(parsed.exchangeRate) ||
        typeof parsed.startDate !== "string" ||
        typeof parsed.endDate !== "string"
      ) {
        window.localStorage.removeItem(ACCEPTED_CHARGE_STORAGE_KEY);
        return;
      }
      const charge = parsed as AcceptedCharge;
      setMonths(String(charge.quantityInMonths));
      setAcceptedCharge(charge);
      setRenewalReference({
        reference: charge.reference,
        quantityInMonths: charge.quantityInMonths,
        exchangeRate: charge.exchangeRate,
        totalCediEquivalent: charge.amount,
        startDate: charge.startDate,
        endDate: charge.endDate,
        expiresAt: "",
      });
    } catch (error) {
      console.error("Unable to restore the accepted hosting renewal payment:", error);
    }
  }, []);

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

  const confirmRenewal = useCallback(async (charge: AcceptedCharge) => {
      const response = await fetch(`${getPublicApiBase()}/public/hosting-renewal/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: charge.reference }),
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
        months: charge.quantityInMonths,
        endDate: payload.data?.renewal?.endDate ?? charge.endDate,
        totalCedi: charge.amount,
        paymentReference: payload.data?.paymentReference ?? charge.reference,
      });
      setAcceptedCharge(null);
      try {
        window.localStorage.removeItem(ACCEPTED_CHARGE_STORAGE_KEY);
      } catch (error) {
        console.error("Unable to clear the confirmed hosting renewal payment:", error);
      }
    }, []);

  const handlePay = useCallback(async () => {
    if (acceptedCharge) {
      setSubmitState({ status: "submitting" });
      try {
        await confirmRenewal(acceptedCharge);
      } catch (error) {
        setSubmitState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to confirm hosting renewal.",
        });
      }
      return;
    }

    const email = info?.businessEmail?.trim();
    if (!email) {
      setSubmitState({ status: "error", message: "The facility business email is not configured." });
      return;
    }

    if (!paystackPublicKey) {
      setSubmitState({ status: "error", message: "Paystack public key is not configured." });
      return;
    }

    if (monthlyDollarRate === null) {
      setSubmitState({ status: "error", message: "Monthly renewal fee is not configured." });
      return;
    }

    setSubmitState({ status: "submitting" });
    const [firstName, ...restName] = (info?.facilityName || "Business").split(" ").filter(Boolean);
    const lastName = restName.join(" ") || undefined;

    try {
      const referenceResponse = await fetch(`${getPublicApiBase()}/public/hosting-renewal/reference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityInMonths }),
      });
      const referencePayload = (await referenceResponse.json()) as {
        success?: boolean;
        error?: string;
        data?: RenewalReference;
      };
      if (!referenceResponse.ok || !referencePayload.success || !referencePayload.data) {
        throw new Error(referencePayload.error || "Failed to prepare hosting renewal payment.");
      }
      const quote = referencePayload.data;
      if (
        !quote.reference ||
        quote.quantityInMonths !== quantityInMonths ||
        !Number.isFinite(quote.exchangeRate) ||
        !Number.isFinite(quote.totalCediEquivalent) ||
        quote.totalCediEquivalent <= 0 ||
        typeof quote.expiresAt !== "string"
      ) {
        throw new Error("The server returned an invalid hosting renewal quote.");
      }

      setRenewalReference(quote);
      setExchangeRate({ status: "loaded", rate: quote.exchangeRate, fetchedAt: new Date() });
      if (
        totalCediEquivalent === null ||
        Math.round(quote.totalCediEquivalent * 100) !== Math.round(paymentAmount * 100)
      ) {
        setSubmitState({ status: "idle" });
        return;
      }

      const startResponse = await fetch(`${getPublicApiBase()}/public/hosting-renewal/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: quote.reference }),
      });
      const startPayload = (await startResponse.json()) as { success?: boolean; error?: string };
      if (!startResponse.ok || !startPayload.success) {
        throw new Error(startPayload.error || "This hosting renewal quote is no longer valid.");
      }

      const charge: AcceptedCharge = {
        reference: quote.reference,
        quantityInMonths: quote.quantityInMonths,
        amount: quote.totalCediEquivalent,
        exchangeRate: quote.exchangeRate,
        startDate: quote.startDate,
        endDate: quote.endDate,
      };
      let successReported = false;
      await openPaystackCheckout({
        key: paystackPublicKey,
        email,
        amount: charge.amount,
        currency: "GHS",
        reference: charge.reference,
        firstname: firstName || "Business",
        lastname: lastName,
        onSuccess: (response) => {
          if (String(response.status ?? "").toLowerCase() !== "success") {
            setSubmitState({ status: "error", message: "Paystack did not confirm this payment." });
            return;
          }
          successReported = true;
          try {
            window.localStorage.setItem(ACCEPTED_CHARGE_STORAGE_KEY, JSON.stringify(charge));
          } catch (error) {
            console.error("Unable to persist the accepted hosting renewal payment:", error);
          }
          setAcceptedCharge(charge);
          void confirmRenewal(charge).catch((error: unknown) => {
            setSubmitState({
              status: "error",
              message: error instanceof Error ? error.message : "Unable to confirm hosting renewal.",
            });
          });
        },
        onClose: () => {
          if (!successReported) {
            setSubmitState((current) => (current.status === "submitting" ? { status: "idle" } : current));
          }
        },
      });
    } catch (error) {
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to open Paystack checkout.",
      });
    }
  }, [
    acceptedCharge,
    confirmRenewal,
    info?.businessEmail,
    info?.facilityName,
    monthlyDollarRate,
    paystackPublicKey,
    quantityInMonths,
    paymentAmount,
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
                  {submitState.months} month{submitState.months > 1 ? "s" : ""}
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
                disabled={Boolean(acceptedCharge) || submitState.status === "submitting"}
                onChange={(event) => {
                  setMonths(event.target.value);
                  setRenewalReference(null);
                }}
                placeholder="e.g. 3"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input readOnly value={formatDisplayDate(displayedStartDate)} className="bg-muted cursor-not-allowed" />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input readOnly value={formatDisplayDate(displayedEndDate)} className="bg-muted cursor-not-allowed" />
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

              {exchangeRate.status === "loading" && displayedExchangeRate === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader className="h-8 w-8 animate-spin" />
                  Fetching live rate...
                </div>
              ) : null}

              {exchangeRate.status === "error" && displayedExchangeRate === null ? (
                <p className="text-xs text-destructive">{exchangeRate.message}</p>
              ) : null}

              {displayedExchangeRate !== null ? (
                <div className="space-y-1">
                  <Input readOnly value={`1 USD = ${displayedExchangeRate.toFixed(6)} GHS`} className="bg-muted cursor-not-allowed" />
                  <p className="text-xs text-muted-foreground">
                    {renewalReference?.quantityInMonths === quantityInMonths
                      ? "Saved rate for this quote."
                      : exchangeRate.status === "loaded"
                        ? `Rate fetched at ${exchangeRate.fetchedAt.toLocaleTimeString()}`
                        : "Rate unavailable."}
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
                submitState.status === "submitting" ||
                (!acceptedCharge && monthlyDollarRate === null)
              }
            >
              {submitState.status === "submitting" ? (
                <span className="flex items-center gap-2">
                  <Loader className="h-8 w-8 animate-spin" />
                  {acceptedCharge ? "Confirming payment..." : "Preparing payment..."}
                </span>
              ) : acceptedCharge ? (
                "Retry confirmation"
              ) : totalCediEquivalent === null ? (
                "Get current GHS quote & renew hosting"
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
