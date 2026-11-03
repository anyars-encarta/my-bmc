import express from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { hostingRenewal, facilitySetup } from "../db/schema/index.js";
import { nowAtFacility } from "../lib/facilityClock.js";
import securityMiddleware from "../middleware/security.js";

const router = express.Router();
router.use(securityMiddleware);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim() || "";
const PAYSTACK_SERVICE_SECRET_KEY =
  process.env.PAYSTACK_SERVICE_SECRET_KEY?.trim() || "";
const PAYSTACK_VERIFY_TIMEOUT_MS = Number(process.env.PAYSTACK_VERIFY_TIMEOUT_MS) || 10000;
const EXCHANGE_RATE_TIMEOUT_MS = 10000;
const HOSTING_QUOTE_LIFETIME_MS = 30 * 60 * 1000;
const EXCHANGE_RATE_CACHE_TTL_MS = 5 * 60 * 1000;
let exchangeRateCache: { rate: number; expiresAt: number } | null = null;
let exchangeRateRequest: Promise<number> | null = null;

const isQuoteExpired = (createdAt: Date) => {
  const age = Date.now() - createdAt.getTime();
  return !Number.isFinite(age) || age < 0 || age > HOSTING_QUOTE_LIFETIME_MS;
};

const addMonths = (date: string, months: number) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
};

const startDateForRenewal = (facilityDate: string, hostingExpiryDate: string | null) =>
  hostingExpiryDate && hostingExpiryDate > facilityDate ? hostingExpiryDate : facilityDate;

const requestUsdToGhsRate = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_RATE_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/rate/USD/GHS", {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Exchange rate provider responded with ${response.status}`);
    }

    const payload = (await response.json()) as { rate?: number };
    const rate = Number(payload.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Exchange rate provider returned an invalid USD to GHS rate.");
    }
    return Number(rate.toFixed(6));
  } finally {
    clearTimeout(timeout);
  }
};

const fetchUsdToGhsRate = async () => {
  if (exchangeRateCache && exchangeRateCache.expiresAt > Date.now()) {
    return exchangeRateCache.rate;
  }
  if (!exchangeRateRequest) {
    const request = requestUsdToGhsRate()
      .then((rate) => {
        exchangeRateCache = { rate, expiresAt: Date.now() + EXCHANGE_RATE_CACHE_TTL_MS };
        return rate;
      })
      .finally(() => {
        if (exchangeRateRequest === request) exchangeRateRequest = null;
      });
    exchangeRateRequest = request;
  }
  return exchangeRateRequest;
};

type PaystackPaymentPayload = {
  reference?: unknown;
  transactionId?: unknown;
  serviceChargeReference?: unknown;
  status?: unknown;
  serviceCharge?: unknown;
  amount?: unknown;
  currency?: unknown;
};

const verifyPaystackPaymentWithSecret = async (
  secretKey: string,
  reference: string,
  expectedAmount: number,
  expectedCurrency: string,
) => {
  if (!secretKey) {
    return { success: false as const, reason: "Paystack secret key is not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYSTACK_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    clearTimeout(timeout);

    const payload = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        amount?: number;
        currency?: string;
        reference?: string;
        id?: number;
      };
    };

    if (!response.ok || !payload.status || !payload.data) {
      return {
        success: false as const,
        reason: payload.message || "Payment verification failed",
      };
    }

    const paymentStatus = String(payload.data.status ?? "").toLowerCase();
    const paidAmount = Number(payload.data.amount ?? 0);
    const paidCurrency = String(payload.data.currency ?? "").toUpperCase();
    const expectedAmountSubunit = Math.round(expectedAmount * 100);
    const paidAmountSubunit = Math.round(paidAmount);

    if (paymentStatus !== "success") {
      return { success: false as const, reason: "Payment is not successful" };
    }

    if (Math.abs(paidAmountSubunit - expectedAmountSubunit) > 0) {
      return { success: false as const, reason: "Payment amount mismatch" };
    }

    if (paidCurrency !== expectedCurrency.toUpperCase()) {
      return { success: false as const, reason: "Payment currency mismatch" };
    }

    const verifiedReference = String(payload.data.reference ?? "").trim();
    if (verifiedReference !== reference) {
      return { success: false as const, reason: "Payment reference mismatch" };
    }

    return {
      success: true as const,
      reference: verifiedReference,
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false as const,
        reason: "Payment verification timed out",
      };
    }

    return {
      success: false as const,
      reason: "Payment verification failed",
    };
  }
};

const verifyPaystackPayment = async (
  reference: string,
  expectedAmount: number,
  expectedCurrency: string,
) =>
  verifyPaystackPaymentWithSecret(
    PAYSTACK_SECRET_KEY,
    reference,
    expectedAmount,
    expectedCurrency,
  );

const loadHostingContext = async () => {
  const [configuredSchool] = await db
    .select({
      id: facilitySetup.id,
      facilityName: facilitySetup.facilityName,
      logoUrl: facilitySetup.logoUrl,
      businessEmail: facilitySetup.email,
      monthlyRenewalFee: facilitySetup.monthlyRenewalFee,
      hosted: facilitySetup.hosted,
      hostingExpiryDate: facilitySetup.hostingExpiryDate,
    })
    .from(facilitySetup)
    .orderBy(desc(facilitySetup.id))
    .limit(1);

  return configuredSchool ?? null;
};

router.post("/reference", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        error: "Paystack secret key is not configured",
      });
    }

    const quantityInMonths = Number(req.body?.quantityInMonths);
    if (!Number.isInteger(quantityInMonths) || quantityInMonths < 1 || quantityInMonths > 36) {
      return res.status(400).json({
        success: false,
        error: "quantityInMonths must be an integer from 1 to 36",
      });
    }

    const configuredSchool = await loadHostingContext();
    if (!configuredSchool || configuredSchool.monthlyRenewalFee == null) {
      return res.status(422).json({
        success: false,
        error: "Monthly renewal fee is not configured in facility details.",
      });
    }

    await db
      .delete(hostingRenewal)
      .where(and(
        eq(hostingRenewal.status, "PENDING"),
        lt(hostingRenewal.createdAt, new Date(Date.now() - HOSTING_QUOTE_LIFETIME_MS)),
        isNull(hostingRenewal.paymentStartedAt),
      ));

    const monthlyDollarRate = Number(configuredSchool.monthlyRenewalFee);
    if (!Number.isFinite(monthlyDollarRate) || monthlyDollarRate <= 0) {
      return res.status(422).json({
        success: false,
        error: "Monthly renewal fee must be greater than zero.",
      });
    }

    const exchangeRate = await fetchUsdToGhsRate();
    const totalDollarAmount = monthlyDollarRate * quantityInMonths;
    const totalCediEquivalent = Number((totalDollarAmount * exchangeRate).toFixed(2));
    if (!Number.isFinite(totalCediEquivalent) || totalCediEquivalent <= 0) {
      return res.status(422).json({
        success: false,
        error: "Unable to calculate a valid hosting renewal amount.",
      });
    }

    const facilityClock = await nowAtFacility();
    const createdAt = new Date(facilityClock.instant);
    const startDate = startDateForRenewal(
      facilityClock.localDateTime.slice(0, 10),
      configuredSchool.hostingExpiryDate,
    );
    const endDate = addMonths(startDate, quantityInMonths);
    const reference = `hosting-renewal-${randomUUID()}`;
    const [renewal] = await db
      .insert(hostingRenewal)
      .values({
        monthlyDollarRate: String(monthlyDollarRate),
        quantityInMonths,
        startDate,
        endDate,
        totalDollarAmount: String(totalDollarAmount),
        totalCediEquivalent: String(totalCediEquivalent),
        paymentReference: reference,
        usdToGhsRate: exchangeRate.toFixed(6),
        status: "PENDING",
        createdAt,
      })
      .returning({ id: hostingRenewal.id });

    if (!renewal) {
      throw new Error("Failed to persist hosting renewal payment reference.");
    }

    return res.status(201).json({
      success: true,
      data: {
        reference,
        quantityInMonths,
        exchangeRate,
        totalCediEquivalent,
        startDate,
        endDate,
        expiresAt: new Date(createdAt.getTime() + HOSTING_QUOTE_LIFETIME_MS).toISOString(),
      },
    });
  } catch (error) {
    console.error("POST /public/hosting-renewal/reference error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to prepare hosting renewal payment.",
    });
  }
});

router.post("/start", async (req, res) => {
  try {
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
    if (!reference) {
      return res.status(400).json({ success: false, error: "A payment reference is required." });
    }

    const cutoff = new Date(Date.now() - HOSTING_QUOTE_LIFETIME_MS);
    const [started] = await db
      .update(hostingRenewal)
      .set({
        paymentStartedAt: sql`coalesce(${hostingRenewal.paymentStartedAt}, ${new Date()})`,
      })
      .where(and(
        eq(hostingRenewal.paymentReference, reference),
        eq(hostingRenewal.status, "PENDING"),
        gte(hostingRenewal.createdAt, cutoff),
      ))
      .returning({ id: hostingRenewal.id });

    if (!started) {
      const [renewal] = await db
        .select({ status: hostingRenewal.status, createdAt: hostingRenewal.createdAt })
        .from(hostingRenewal)
        .where(eq(hostingRenewal.paymentReference, reference))
        .limit(1);
      if (!renewal) {
        return res.status(404).json({ success: false, error: "Hosting renewal quote not found." });
      }
      if (renewal.status !== "PENDING") {
        return res.status(409).json({ success: false, error: "This hosting renewal is no longer pending." });
      }
      if (isQuoteExpired(renewal.createdAt)) {
        return res.status(410).json({
          success: false,
          error: "This hosting renewal quote has expired. Prepare a new quote before paying.",
        });
      }
      return res.status(409).json({ success: false, error: "Unable to start this hosting renewal payment." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("POST /public/hosting-renewal/start error:", error);
    return res.status(500).json({ success: false, error: "Failed to start hosting renewal payment." });
  }
});

type RenewalCompletionOutcome =
  | {
      kind: "completed";
      renewal: typeof hostingRenewal.$inferSelect;
      school: { id: string; hosted: boolean; hostingExpiryDate: string | null };
      alreadyCompleted: boolean;
    }
  | { kind: "conflict" }
  | { kind: "facility-missing" };

const persistVerifiedRenewal = async (
  renewal: typeof hostingRenewal.$inferSelect,
  totalCediEquivalent: number,
  serviceChargeReference: string | null,
): Promise<RenewalCompletionOutcome> => {
  const configuredSchool = await loadHostingContext();
  if (!configuredSchool) return { kind: "facility-missing" };

  const facilityClock = await nowAtFacility();
  const facilityDate = facilityClock.localDateTime.slice(0, 10);
  let completion: {
    candidate_id: string;
    candidate_status: "PENDING" | "COMPLETED";
    completed_id: string | null;
    facility_id: string | null;
    facility_hosted: boolean;
    facility_expiry_date: string | null;
  } | undefined;

  try {
    const result = await db.execute(sql<{
      candidate_id: string;
      candidate_status: "PENDING" | "COMPLETED";
      completed_id: string | null;
      facility_id: string | null;
      facility_hosted: boolean;
      facility_expiry_date: string | null;
    }>`
      WITH candidate AS MATERIALIZED (
        SELECT renewal.id, renewal.status, renewal.start_date, renewal.end_date,
               renewal.quantity_in_months
        FROM ${hostingRenewal} AS renewal
        WHERE renewal.id = ${renewal.id}
          AND renewal.status IN ('PENDING', 'COMPLETED')
          AND (${serviceChargeReference}::text IS NULL
            OR renewal.service_charge_reference IS NULL
            OR renewal.service_charge_reference = ${serviceChargeReference})
        FOR UPDATE
      ),
      facility AS MATERIALIZED (
        SELECT setup.id,
               setup.hosted,
               setup.hosting_expiry_date,
               GREATEST(
                 ${facilityDate}::date,
                 COALESCE(setup.hosting_expiry_date, ${facilityDate}::date)
               ) AS renewal_start_date
        FROM ${facilitySetup} AS setup
        WHERE setup.id = ${configuredSchool.id}
        FOR UPDATE
      ),
      renewal_dates AS MATERIALIZED (
        SELECT candidate.id,
               candidate.status,
               CASE
                 WHEN candidate.status = 'PENDING' THEN facility.renewal_start_date
                 ELSE candidate.start_date
               END AS start_date,
               CASE
                 WHEN candidate.status = 'PENDING' THEN
                   (facility.renewal_start_date
                     + make_interval(months => candidate.quantity_in_months))::date
                 ELSE candidate.end_date
               END AS end_date
        FROM candidate
        CROSS JOIN facility
      ),
      facility_updated AS (
        UPDATE ${facilitySetup} AS setup
        SET hosted = CASE
              WHEN renewal_dates.status = 'PENDING' THEN TRUE
              ELSE setup.hosted
            END,
            hosting_expiry_date = GREATEST(
              COALESCE(setup.hosting_expiry_date, DATE '0001-01-01'),
              renewal_dates.end_date
            )
        FROM renewal_dates, facility
        WHERE setup.id = facility.id
        RETURNING setup.id, setup.hosted, setup.hosting_expiry_date
      ),
      completed AS (
        UPDATE ${hostingRenewal} AS renewal
        SET status = 'COMPLETED',
            start_date = renewal_dates.start_date,
            end_date = renewal_dates.end_date,
            total_cedi_equivalent = CASE
              WHEN renewal.status = 'PENDING' THEN ${String(totalCediEquivalent)}
              ELSE renewal.total_cedi_equivalent
            END,
            service_charge_reference = COALESCE(
              ${serviceChargeReference},
              renewal.service_charge_reference
            )
        FROM candidate
        JOIN renewal_dates ON renewal_dates.id = candidate.id
        WHERE renewal.id = candidate.id
          AND renewal.status = candidate.status
          AND EXISTS (SELECT 1 FROM facility_updated)
        RETURNING renewal.id
      )
      SELECT candidate.id AS candidate_id,
             candidate.status AS candidate_status,
             completed.id AS completed_id,
             facility_updated.id AS facility_id,
             facility_updated.hosted AS facility_hosted,
             facility_updated.hosting_expiry_date::text AS facility_expiry_date
      FROM candidate
      LEFT JOIN completed ON completed.id = candidate.id
      LEFT JOIN facility_updated ON TRUE
    `);
    const row = result.rows[0];
    if (
      row &&
      typeof row.candidate_id === "string" &&
      (row.candidate_status === "PENDING" || row.candidate_status === "COMPLETED") &&
      (typeof row.completed_id === "string" || row.completed_id === null) &&
      (typeof row.facility_id === "string" || row.facility_id === null) &&
      typeof row.facility_hosted === "boolean" &&
      (typeof row.facility_expiry_date === "string" || row.facility_expiry_date === null)
    ) {
      completion = {
        candidate_id: row.candidate_id,
        candidate_status: row.candidate_status,
        completed_id: row.completed_id,
        facility_id: row.facility_id,
        facility_hosted: row.facility_hosted,
        facility_expiry_date: row.facility_expiry_date,
      };
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return { kind: "conflict" };
    }
    throw error;
  }

  if (!completion) return { kind: "conflict" };
  if (!completion.facility_id) return { kind: "facility-missing" };
  if (!completion.completed_id) return { kind: "conflict" };

  const [completedRenewal] = await db
    .select()
    .from(hostingRenewal)
    .where(and(
      eq(hostingRenewal.id, renewal.id),
      eq(hostingRenewal.status, "COMPLETED"),
    ))
    .limit(1);
  if (!completedRenewal) return { kind: "conflict" };

  return {
    kind: "completed",
    renewal: completedRenewal,
    school: {
      id: completion.facility_id,
      hosted: completion.facility_hosted,
      hostingExpiryDate: completion.facility_expiry_date,
    },
    alreadyCompleted: completion.candidate_status === "COMPLETED",
  };
};

const sendRenewalCompletion = (
  res: express.Response,
  outcome: RenewalCompletionOutcome,
  paymentReference: string,
) => {
  if (outcome.kind === "conflict") {
    return res.status(409).json({
      success: false,
      error: "This hosting renewal or service charge reference is already associated with another payment.",
    });
  }
  if (outcome.kind === "facility-missing") {
    return res.status(422).json({
      success: false,
      error: "Facility details are not configured or could not be updated.",
    });
  }
  return res.status(outcome.alreadyCompleted ? 200 : 201).json({
    success: true,
    message: "Hosting renewal confirmed successfully",
    data: {
      renewal: outcome.renewal,
      school: outcome.school,
      paymentReference,
    },
  });
};

const confirmHostingRenewal = async (req: express.Request, res: express.Response) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, error: "Paystack secret key is not configured" });
    }

    const quantityInMonths = Number(req.body?.quantityInMonths);
    if (!Number.isInteger(quantityInMonths) || quantityInMonths < 1 || quantityInMonths > 36) {
      return res.status(400).json({
        success: false,
        error: "quantityInMonths must be an integer from 1 to 36",
      });
    }

    const totalCediEquivalentRaw = Number(req.body?.totalCediEquivalent);
    if (!Number.isFinite(totalCediEquivalentRaw) || totalCediEquivalentRaw <= 0) {
      return res.status(400).json({
        success: false,
        error: "totalCediEquivalent must be a positive number",
      });
    }

    const payment = req.body?.payment as PaystackPaymentPayload | undefined;
    if (!payment) {
      return res.status(400).json({ success: false, error: "payment details are required" });
    }
    const verificationReference = String(payment.reference ?? "").trim();
    if (!verificationReference) {
      return res.status(400).json({
        success: false,
        error: "Paystack transaction reference is required",
      });
    }

    const [storedRenewal] = await db
      .select()
      .from(hostingRenewal)
      .where(eq(hostingRenewal.paymentReference, verificationReference))
      .limit(1);
    if (!storedRenewal) {
      return res.status(404).json({
        success: false,
        error: "No hosting renewal matches this payment reference.",
      });
    }
    if (storedRenewal.status !== "PENDING" && storedRenewal.status !== "COMPLETED") {
      return res.status(409).json({
        success: false,
        error: "This hosting renewal is no longer awaiting confirmation.",
      });
    }
    if (
      storedRenewal.status === "PENDING" &&
      storedRenewal.paymentStartedAt === null &&
      isQuoteExpired(storedRenewal.createdAt)
    ) {
      return res.status(410).json({
        success: false,
        error: "This hosting renewal quote expired before payment started. Prepare a new quote.",
      });
    }
    if (storedRenewal.quantityInMonths !== quantityInMonths) {
      return res.status(400).json({
        success: false,
        error: "The payment reference does not match the requested renewal duration.",
      });
    }

    const monthlyDollarRate = Number(storedRenewal.monthlyDollarRate);
    const exchangeRate = Number(storedRenewal.usdToGhsRate);
    if (!Number.isFinite(monthlyDollarRate) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return res.status(409).json({
        success: false,
        error: "The stored renewal quote is invalid.",
      });
    }
    const totalCediEquivalent = Number((monthlyDollarRate * quantityInMonths * exchangeRate).toFixed(2));
    if (Math.abs(totalCediEquivalentRaw - totalCediEquivalent) > 0.0001) {
      return res.status(400).json({
        success: false,
        error: "Submitted renewal total does not match the server-calculated amount.",
      });
    }

    const paymentAmount = Number(payment.amount ?? 0);
    const serviceChargeRaw = Number(payment.serviceCharge ?? 0);
    const serviceCharge =
      Number.isFinite(serviceChargeRaw) && serviceChargeRaw > 0
        ? Number(serviceChargeRaw.toFixed(2))
        : 0;
    const expectedTotalAmount = Number((totalCediEquivalent + serviceCharge).toFixed(2));
    const paymentCurrency = String(payment.currency ?? "").trim().toUpperCase();
    const paymentStatus = String(payment.status ?? "").trim().toLowerCase();
    const serviceChargeReference = String(payment.serviceChargeReference ?? "").trim();

    if (serviceCharge > 0 && !serviceChargeReference) {
      return res.status(400).json({ success: false, error: "Service charge reference is required" });
    }
    if (!Number.isFinite(paymentAmount) || Math.abs(paymentAmount - expectedTotalAmount) > 0.0001) {
      return res.status(400).json({ success: false, error: "Invalid payment amount" });
    }
    if (paymentCurrency !== "GHS") {
      return res.status(400).json({ success: false, error: "Invalid payment currency" });
    }
    if (paymentStatus && paymentStatus !== "success") {
      return res.status(400).json({ success: false, error: "Payment is not successful" });
    }

    const verificationResult = await verifyPaystackPayment(
      verificationReference,
      totalCediEquivalent,
      "GHS",
    );
    if (!verificationResult.success) {
      return res.status(400).json({ success: false, error: verificationResult.reason });
    }
    if (verificationResult.reference !== storedRenewal.paymentReference) {
      return res.status(400).json({
        success: false,
        error: "Verified payment reference does not match the stored renewal.",
      });
    }

    if (serviceCharge > 0) {
      if (!PAYSTACK_SERVICE_SECRET_KEY) {
        return res.status(503).json({
          success: false,
          error: "Paystack service secret key is not configured",
        });
      }
      const serviceVerification = await verifyPaystackPaymentWithSecret(
        PAYSTACK_SERVICE_SECRET_KEY,
        serviceChargeReference,
        serviceCharge,
        "GHS",
      );
      if (!serviceVerification.success) {
        return res.status(400).json({
          success: false,
          error: `Service charge verification failed: ${serviceVerification.reason}`,
        });
      }
    }

    const outcome = await persistVerifiedRenewal(
      storedRenewal,
      totalCediEquivalent,
      serviceCharge > 0 ? serviceChargeReference : null,
    );
    return sendRenewalCompletion(res, outcome, verificationReference);
  } catch (error) {
    console.error("POST /public/hosting-renewal/confirm error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to confirm hosting renewal",
    });
  }
};

const reconcileHostingRenewal = async (req: express.Request, res: express.Response) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, error: "Paystack secret key is not configured" });
    }
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim() : "";
    if (!reference) {
      return res.status(400).json({ success: false, error: "A payment reference is required." });
    }
    const [storedRenewal] = await db
      .select()
      .from(hostingRenewal)
      .where(eq(hostingRenewal.paymentReference, reference))
      .limit(1);
    if (!storedRenewal) {
      return res.status(404).json({ success: false, error: "Hosting renewal quote not found." });
    }
    if (
      storedRenewal.status === "PENDING" &&
      storedRenewal.paymentStartedAt === null &&
      isQuoteExpired(storedRenewal.createdAt)
    ) {
      return res.status(410).json({
        success: false,
        error: "This hosting renewal quote expired before payment started. Prepare a new quote.",
      });
    }

    const monthlyDollarRate = Number(storedRenewal.monthlyDollarRate);
    const exchangeRate = Number(storedRenewal.usdToGhsRate);
    if (!Number.isFinite(monthlyDollarRate) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return res.status(409).json({ success: false, error: "The stored renewal quote is invalid." });
    }
    const totalCediEquivalent = Number(
      (monthlyDollarRate * storedRenewal.quantityInMonths * exchangeRate).toFixed(2),
    );
    const verificationResult = await verifyPaystackPayment(reference, totalCediEquivalent, "GHS");
    if (!verificationResult.success || verificationResult.reference !== storedRenewal.paymentReference) {
      return res.status(202).json({
        success: false,
        pending: true,
        error: verificationResult.success
          ? "Verified payment reference does not match the stored renewal."
          : verificationResult.reason,
      });
    }

    const outcome = await persistVerifiedRenewal(storedRenewal, totalCediEquivalent, null);
    return sendRenewalCompletion(res, outcome, reference);
  } catch (error) {
    console.error("POST /public/hosting-renewal/reconcile error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to reconcile hosting renewal payment",
    });
  }
};

router.post("/reconcile", reconcileHostingRenewal);

router.post("/webhook", async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ success: false, error: "Paystack secret key is not configured" });
    }

    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
    const signature = req.get("x-paystack-signature") ?? "";
    if (!rawBody || !/^[a-f\d]{128}$/i.test(signature)) {
      return res.status(401).json({ success: false, error: "Invalid Paystack webhook signature." });
    }
    const expectedSignature = createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest();
    const receivedSignature = Buffer.from(signature, "hex");
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return res.status(401).json({ success: false, error: "Invalid Paystack webhook signature." });
    }

    const event = req.body as { event?: unknown; data?: unknown } | null;
    if (!event || event.event !== "charge.success") {
      return res.status(200).json({ success: true, ignored: true });
    }
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) {
      return res.status(400).json({ success: false, error: "Invalid Paystack charge event." });
    }

    const charge = event.data as Record<string, unknown>;
    const reference = typeof charge.reference === "string" ? charge.reference.trim() : "";
    const amount = Number(charge.amount);
    const currency = typeof charge.currency === "string" ? charge.currency.toUpperCase() : "";
    const status = typeof charge.status === "string" ? charge.status.toLowerCase() : "";
    if (!reference || status !== "success" || currency !== "GHS" || !Number.isInteger(amount)) {
      return res.status(400).json({ success: false, error: "Invalid Paystack charge details." });
    }

    const [storedRenewal] = await db
      .select()
      .from(hostingRenewal)
      .where(eq(hostingRenewal.paymentReference, reference))
      .limit(1);
    if (
      !storedRenewal ||
      !storedRenewal.paymentStartedAt ||
      (storedRenewal.status !== "PENDING" && storedRenewal.status !== "COMPLETED")
    ) {
      console.warn("Ignoring Paystack charge without a started hosting renewal:", reference);
      return res.status(200).json({ success: true, ignored: true });
    }

    const monthlyDollarRate = Number(storedRenewal.monthlyDollarRate);
    const exchangeRate = Number(storedRenewal.usdToGhsRate);
    if (!Number.isFinite(monthlyDollarRate) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return res.status(409).json({ success: false, error: "The stored renewal quote is invalid." });
    }
    const totalCediEquivalent = Number(
      (monthlyDollarRate * storedRenewal.quantityInMonths * exchangeRate).toFixed(2),
    );
    if (amount !== Math.round(totalCediEquivalent * 100)) {
      return res.status(400).json({ success: false, error: "Paystack charge amount mismatch." });
    }

    const verification = await verifyPaystackPayment(reference, totalCediEquivalent, "GHS");
    if (!verification.success || verification.reference !== storedRenewal.paymentReference) {
      return res.status(400).json({
        success: false,
        error: verification.success
          ? "Verified payment reference does not match the started renewal."
          : verification.reason,
      });
    }

    const outcome = await persistVerifiedRenewal(storedRenewal, totalCediEquivalent, null);
    if (outcome.kind === "conflict") {
      return res.status(409).json({ success: false, error: "Hosting renewal completion conflicted." });
    }
    if (outcome.kind === "facility-missing") {
      return res.status(422).json({ success: false, error: "Facility details could not be updated." });
    }
    return res.status(200).json({ success: true, paymentReference: reference });
  } catch (error) {
    console.error("POST /public/hosting-renewal/webhook error:", error);
    return res.status(500).json({ success: false, error: "Failed to process Paystack webhook." });
  }
});

/**
 * GET /public/hosting-renewal/info
 * Returns the monthlyRenewalFee and branding used by the public renewal page.
 */
router.get("/info", async (_req, res) => {
  try {
    const configuredBusiness = await loadHostingContext();

    if (!configuredBusiness) {
      return res.status(404).json({
        success: false,
        error: "Facility details not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        facilityName: configuredBusiness.facilityName,
        logoUrl: configuredBusiness.logoUrl,
        businessEmail: configuredBusiness.businessEmail,
        monthlyRenewalFee: configuredBusiness.monthlyRenewalFee,
        hosted: configuredBusiness.hosted,
        hostingExpiryDate: configuredBusiness.hostingExpiryDate,
      },
    });
  } catch (error) {
    console.error("GET /public/hosting-renewal/info error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch hosting renewal info",
    });
  }
});

router.post("/confirm", confirmHostingRenewal);
router.post("/", confirmHostingRenewal);

/**
 * GET /public/hosting-renewal/latest
 * Returns the most recent hosting renewal record (for display purposes).
 */
router.get("/latest", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(hostingRenewal)
      .where(eq(hostingRenewal.status, "COMPLETED"))
      .orderBy(desc(hostingRenewal.createdAt))
      .limit(1);

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "No hosting renewal records found." });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("GET /public/hosting-renewal/latest error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch latest hosting renewal." });
  }
});

export default router;
