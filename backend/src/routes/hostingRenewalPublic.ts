import express from "express";
import { desc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { hostingRenewal, facilitySetup } from "../db/schema/index.js";

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim() || "";
const PAYSTACK_SERVICE_SECRET_KEY =
  process.env.PAYSTACK_SERVICE_SECRET_KEY?.trim() || "";
const PAYSTACK_VERIFY_TIMEOUT_MS = Number(process.env.PAYSTACK_VERIFY_TIMEOUT_MS) || 10000;

const parseDateToLocalISO = (value: Date) => value.toISOString().slice(0, 10);

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
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

    return {
      success: true as const,
      reference: payload.data.reference || String(payload.data.id || reference),
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

const confirmHostingRenewal = async (req: express.Request, res: express.Response) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        error: "Paystack secret key is not configured",
      });
    }

    const quantityInMonths = Number.parseInt(String(req.body?.quantityInMonths ?? ""), 10);
    if (!Number.isFinite(quantityInMonths) || quantityInMonths < 1) {
      return res.status(400).json({
        success: false,
        error: "quantityInMonths must be a positive integer",
      });
    }

    const totalCediEquivalentRaw = Number(req.body?.totalCediEquivalent);
    if (!Number.isFinite(totalCediEquivalentRaw) || totalCediEquivalentRaw <= 0) {
      return res.status(400).json({
        success: false,
        error: "totalCediEquivalent must be a positive number",
      });
    }

    const totalCediEquivalent = Number(totalCediEquivalentRaw.toFixed(2));

    const payment = req.body?.payment as PaystackPaymentPayload | undefined;
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: "payment details are required",
      });
    }

    const transactionId = String(payment.transactionId ?? "").trim();
    const paymentAmount = Number(payment.amount ?? 0);
    const serviceChargeRaw = Number(payment.serviceCharge ?? 0);
    const serviceCharge =
      Number.isFinite(serviceChargeRaw) && serviceChargeRaw > 0
        ? Number(serviceChargeRaw.toFixed(2))
        : 0;
    const expectedTotalAmount = Number((totalCediEquivalent + serviceCharge).toFixed(2));
    const paymentCurrency = String(payment.currency ?? "").trim().toUpperCase();
    const paymentStatus = String(payment.status ?? "").trim().toLowerCase();
    const fallbackReference = String(payment.reference ?? "").trim();
    const serviceChargeReference = String(payment.serviceChargeReference ?? "").trim();
    const verificationReference = fallbackReference || transactionId;

    if (!verificationReference) {
      return res.status(400).json({
        success: false,
        error: "Paystack transaction reference is required",
      });
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

      if (!serviceChargeReference) {
        return res.status(400).json({
          success: false,
          error: "Service charge reference is required",
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

    const configuredSchool = await loadHostingContext();
    if (!configuredSchool || configuredSchool.monthlyRenewalFee == null) {
      return res.status(422).json({
        success: false,
        error: "Monthly renewal fee is not configured in school details",
      });
    }

    const monthlyDollarRate = Number(configuredSchool.monthlyRenewalFee);
    const totalDollarAmount = monthlyDollarRate * quantityInMonths;
    const startDate = parseDateToLocalISO(new Date());
    const endDate = parseDateToLocalISO(addMonths(new Date(), quantityInMonths));
    const verifiedReference = verificationResult.reference || fallbackReference || null;

    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(hostingRenewal)
        .values({
          monthlyDollarRate: String(monthlyDollarRate),
          quantityInMonths,
          startDate,
          endDate,
          totalDollarAmount: String(totalDollarAmount),
          totalCediEquivalent: String(Number(totalCediEquivalent.toFixed(2))),
        })
        .returning();

      if (!created) {
        throw new Error("Failed to persist hosting renewal");
      }

      const [updatedSchool] = await tx
        .update(facilitySetup)
        .set({
          hosted: true,
          hostingExpiryDate: endDate,
        })
        .where(eq(facilitySetup.id, configuredSchool.id))
        .returning({
          id: facilitySetup.id,
          hosted: facilitySetup.hosted,
          hostingExpiryDate: facilitySetup.hostingExpiryDate,
        });

      if (!updatedSchool) {
        throw new Error("Failed to update school hosting status");
      }

      return {
        renewal: created,
        school: updatedSchool,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Hosting renewal confirmed successfully",
      data: {
        ...result,
        paymentReference: verifiedReference,
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
      .orderBy(desc(hostingRenewal.id))
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
