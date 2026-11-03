import express from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db } from "../db/index.js";
import { hostingRenewal, facilitySetup } from "../db/schema/index.js";
import { nowAtFacility } from "../lib/facilityClock.js";

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim() || "";
const PAYSTACK_SERVICE_SECRET_KEY =
  process.env.PAYSTACK_SERVICE_SECRET_KEY?.trim() || "";
const PAYSTACK_VERIFY_TIMEOUT_MS = Number(process.env.PAYSTACK_VERIFY_TIMEOUT_MS) || 10000;
const EXCHANGE_RATE_TIMEOUT_MS = 10000;
const HOSTING_QUOTE_LIFETIME_MS = 30 * 60 * 1000;

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

const fetchUsdToGhsRate = async () => {
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
    const startDate = facilityClock.localDateTime.slice(0, 10);
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

const confirmHostingRenewal = async (req: express.Request, res: express.Response) => {
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

    const totalCediEquivalentRaw = Number(req.body?.totalCediEquivalent);
    if (!Number.isFinite(totalCediEquivalentRaw) || totalCediEquivalentRaw <= 0) {
      return res.status(400).json({
        success: false,
        error: "totalCediEquivalent must be a positive number",
      });
    }

    const payment = req.body?.payment as PaystackPaymentPayload | undefined;
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "payment details are required",
      });
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
    if (storedRenewal.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        error: "This hosting renewal has already been confirmed.",
      });
    }
    const quoteAge = Date.now() - new Date(storedRenewal.createdAt).getTime();
    if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > HOSTING_QUOTE_LIFETIME_MS) {
      return res.status(410).json({
        success: false,
        error: "This hosting renewal quote has expired. Prepare a new quote before paying.",
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
    const totalDollarAmount = monthlyDollarRate * quantityInMonths;
    const totalCediEquivalent = Number((totalDollarAmount * exchangeRate).toFixed(2));
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
      return res.status(400).json({
        success: false,
        error: "Service charge reference is required",
      });
    }

    if (serviceChargeReference) {
      const [boundRenewal] = await db
        .select({ id: hostingRenewal.id })
        .from(hostingRenewal)
        .where(eq(hostingRenewal.serviceChargeReference, serviceChargeReference))
        .limit(1);
      if (boundRenewal && boundRenewal.id !== storedRenewal.id) {
        return res.status(409).json({
          success: false,
          error: "This service charge reference is already associated with another renewal.",
        });
      }
    }

    if (!Number.isFinite(paymentAmount) || Math.abs(paymentAmount - expectedTotalAmount) > 0.0001) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment amount",
      });
    }

    if (!paymentCurrency || paymentCurrency !== "GHS") {
      return res.status(400).json({
        success: false,
        error: "Invalid payment currency",
      });
    }

    if (paymentStatus && paymentStatus !== "success") {
      return res.status(400).json({
        success: false,
        error: "Payment is not successful",
      });
    }

    const verificationResult = await verifyPaystackPayment(verificationReference, totalCediEquivalent, "GHS");

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        error: verificationResult.reason,
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

    if (serviceCharge > 0) {
      try {
        const [boundRenewal] = await db
          .update(hostingRenewal)
          .set({ serviceChargeReference })
          .where(and(
            eq(hostingRenewal.id, storedRenewal.id),
            eq(hostingRenewal.status, "PENDING"),
            or(
              isNull(hostingRenewal.serviceChargeReference),
              eq(hostingRenewal.serviceChargeReference, serviceChargeReference),
            ),
          ))
          .returning({ id: hostingRenewal.id });
        if (!boundRenewal) {
          return res.status(409).json({
            success: false,
            error: "A different service charge reference is already associated with this renewal.",
          });
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "23505"
        ) {
          return res.status(409).json({
            success: false,
            error: "This service charge reference is already associated with another renewal.",
          });
        }
        throw error;
      }
    }

    const configuredSchool = await loadHostingContext();
    if (!configuredSchool) {
      return res.status(422).json({
        success: false,
        error: "Facility details are not configured.",
      });
    }

    if (verificationResult.reference !== storedRenewal.paymentReference) {
      return res.status(400).json({
        success: false,
        error: "Verified payment reference does not match the stored renewal.",
      });
    }

    const confirmationClock = await nowAtFacility();
    const confirmedStartDate = confirmationClock.localDateTime.slice(0, 10);
    const confirmedEndDate = addMonths(confirmedStartDate, quantityInMonths);
    const [completedRenewal] = await db
      .update(hostingRenewal)
      .set({
        status: "COMPLETED",
        startDate: confirmedStartDate,
        endDate: confirmedEndDate,
        totalCediEquivalent: String(totalCediEquivalent),
      })
      .where(and(
        eq(hostingRenewal.id, storedRenewal.id),
        eq(hostingRenewal.status, "PENDING"),
      ))
      .returning();

    if (!completedRenewal) {
      return res.status(409).json({
        success: false,
        error: "This hosting renewal is no longer awaiting confirmation.",
      });
    }

    let updatedSchool: {
      id: string;
      hosted: boolean;
      hostingExpiryDate: string | null;
    };
    try {
      const [school] = await db
        .update(facilitySetup)
        .set({
          hosted: true,
          hostingExpiryDate: completedRenewal.endDate,
        })
        .where(eq(facilitySetup.id, configuredSchool.id))
        .returning({
          id: facilitySetup.id,
          hosted: facilitySetup.hosted,
          hostingExpiryDate: facilitySetup.hostingExpiryDate,
        });
      if (!school) throw new Error("Failed to update school hosting status");
      updatedSchool = school;
    } catch (error) {
      try {
        await db
          .update(hostingRenewal)
          .set({ status: "PENDING" })
          .where(and(
            eq(hostingRenewal.id, storedRenewal.id),
            eq(hostingRenewal.status, "COMPLETED"),
          ));
      } catch (compensationError) {
        console.error("Unable to restore the pending hosting renewal:", compensationError);
      }
      throw error;
    }

    const result = {
      renewal: completedRenewal,
      school: updatedSchool,
    };

    return res.status(201).json({
      success: true,
      message: "Hosting renewal confirmed successfully",
      data: {
        ...result,
        paymentReference: storedRenewal.paymentReference,
      },
    });
  } catch (error) {
    console.error("POST /public/hosting-renewal/confirm error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to confirm hosting renewal",
    });
  }
};

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
