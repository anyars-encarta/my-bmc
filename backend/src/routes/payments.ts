import { Router } from "express";
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  MomoApiError,
  MomoConfigError,
  initiateMomoTransfer,
  pollMomoTransferStatus,
} from "../lib/momo.js";
import {
  insertPaymentSchema,
  paymentRecipients,
  payments,
  updatePaymentSchema,
} from "../db/schema/app.js";

const router = Router();

async function recalculatePaymentTotal(paymentId: string) {
  const recipients = await db
    .select({ amount: paymentRecipients.amount, status: paymentRecipients.status })
    .from(paymentRecipients)
    .where(eq(paymentRecipients.paymentId, paymentId));

  const totalAmount = recipients.reduce((total, recipient) => {
    if (recipient.status === "disapproved") {
      return total;
    }

    return total + Number(recipient.amount);
  }, 0);

  await db
    .update(payments)
    .set({ totalAmount: totalAmount.toFixed(2), updatedAt: new Date() })
    .where(eq(payments.id, paymentId));
}

router.get("/", async (_req, res, next) => {
  try {
    const records = await db.query.payments.findMany({
      with: {
        category: true,
        recipients: { with: { staff: true } },
      },
      orderBy: (payment, { desc }) => [desc(payment.createdAt)],
    });

    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };

    const record = await db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
      with: {
        category: true,
        recipients: { with: { staff: true } },
      },
    });

    if (!record) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = insertPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const createdBy = req.user.id;

    const [created] = await db
      .insert(payments)
      .values({ ...parsed.data, createdBy })
      .returning();

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = updatePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { id: paymentId } = req.params as { id: string };
    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));

    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (current.status !== "draft") {
      res.status(409).json({ error: "Only draft payments can be edited" });
      return;
    }

    const [updated] = await db
      .update(payments)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };
    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));

    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (current.status !== "draft") {
      res.status(409).json({ error: "Only draft payments can be deleted" });
      return;
    }

    const [deleted] = await db
      .delete(payments)
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/submit", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };
    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));

    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (current.status !== "draft") {
      res.status(409).json({ error: "Only draft payments can be submitted" });
      return;
    }

    const recipients = await db
      .select({ id: paymentRecipients.id })
      .from(paymentRecipients)
      .where(eq(paymentRecipients.paymentId, paymentId));

    if (recipients.length === 0) {
      res.status(422).json({ error: "Payment must have at least one recipient" });
      return;
    }

    const approvingOfficer =
      typeof req.body?.approvingOfficer === "string" && req.body.approvingOfficer.trim()
        ? req.body.approvingOfficer.trim()
        : null;

    const [updated] = await db
      .update(payments)
      .set({
        status: "pending_approval",
        approvingOfficer,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (current.status !== "pending_approval") {
      res.status(409).json({ error: "Only pending approval payments can be approved" });
      return;
    }

    const pendingRecipients = await db
      .select({ status: paymentRecipients.status })
      .from(paymentRecipients)
      .where(eq(paymentRecipients.paymentId, paymentId));

    if (pendingRecipients.length === 0) {
      res.status(422).json({ error: "Payment must have at least one recipient" });
      return;
    }

    if (!pendingRecipients.some((recipient) => recipient.status === "approved")) {
      res.status(422).json({ error: "At least one beneficiary must be approved before payment approval" });
      return;
    }

    if (pendingRecipients.some((recipient) => recipient.status === "pending")) {
      res.status(422).json({ error: "All beneficiaries must be reviewed before approval" });
      return;
    }

    const approverName =
      typeof req.user.name === "string" && req.user.name.trim()
        ? req.user.name.trim()
        : req.user.id;

    const [updated] = await db
      .update(payments)
      .set({
        status: "approved",
        approvedBy: approverName,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/process-eligible", async (req, res, next) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const updated = await db
      .update(payments)
      .set({
        status: "processing",
        processedBy: req.user.id,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.status, "approved"))
      .returning({ id: payments.id });

    res.json({
      data: {
        processedCount: updated.length,
        ids: updated.map((item) => item.id),
      },
      message:
        updated.length > 0
          ? `Queued ${updated.length} batch${updated.length === 1 ? "" : "es"} for processing`
          : "No eligible approved batches found",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/process", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (current.status !== "approved") {
      res.status(409).json({ error: "Payment must be approved before processing" });
      return;
    }

    const [updated] = await db
      .update(payments)
      .set({
        status: "processing",
        processedBy: req.user.id,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: updated, message: "Payment queued for MTN MoMo processing" });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/disburse", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!["approved", "processing"].includes(current.status)) {
      res
        .status(409)
        .json({ error: "Payment must be approved before direct disbursement" });
      return;
    }

    const approvedRecipients = await db.query.paymentRecipients.findMany({
      where: and(
        eq(paymentRecipients.paymentId, paymentId),
        eq(paymentRecipients.status, "approved"),
      ),
      with: {
        staff: true,
      },
      orderBy: (recipient, { asc }) => [asc(recipient.createdAt)],
    });

    if (!approvedRecipients.length) {
      res.status(422).json({ error: "No approved beneficiaries found for disbursement" });
      return;
    }

    const batchReferenceId = crypto.randomUUID();

    await db
      .update(payments)
      .set({
        status: "processing",
        processedBy: req.user.id,
        processedAt: new Date(),
        momoReferenceId: batchReferenceId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    const results: Array<{
      recipientId: string;
      staffId: string;
      momoNumber: string;
      amount: string;
      referenceId?: string;
      status: "success" | "failed" | "pending";
      transferStatus?: "SUCCESSFUL" | "FAILED" | "PENDING" | "UNKNOWN";
      message?: string;
    }> = [];

    for (const recipient of approvedRecipients) {
      if (recipient.momoTransferStatus === "SUCCESSFUL") {
        results.push({
          recipientId: recipient.id,
          staffId: recipient.staffId,
          momoNumber: recipient.staff.momoNumber,
          amount: String(recipient.amount),
          referenceId: recipient.momoTransferReferenceId ?? undefined,
          status: "success",
          transferStatus: "SUCCESSFUL",
          message: "Transfer already completed",
        });
        continue;
      }

      if (recipient.momoTransferReferenceId) {
        const finalTransferStatus = await pollMomoTransferStatus({
          referenceId: recipient.momoTransferReferenceId,
        });

        await db
          .update(paymentRecipients)
          .set({
            momoTransferStatus: finalTransferStatus.status,
            momoTransferStatusReason:
              finalTransferStatus.reason ??
              (finalTransferStatus.status === "FAILED"
                ? "MTN MoMo marked this transfer as failed"
                : finalTransferStatus.status === "SUCCESSFUL"
                  ? null
                  : "Transfer is still pending MTN final confirmation"),
            momoTransferCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentRecipients.id, recipient.id));

        results.push({
          recipientId: recipient.id,
          staffId: recipient.staffId,
          momoNumber: recipient.staff.momoNumber,
          amount: String(recipient.amount),
          referenceId: recipient.momoTransferReferenceId,
          status:
            finalTransferStatus.status === "SUCCESSFUL"
              ? "success"
              : finalTransferStatus.status === "FAILED"
                ? "failed"
                : "pending",
          transferStatus: finalTransferStatus.status,
          ...(finalTransferStatus.reason
            ? { message: finalTransferStatus.reason }
            : finalTransferStatus.status === "FAILED"
              ? { message: "MTN MoMo marked this transfer as failed" }
              : finalTransferStatus.status === "SUCCESSFUL"
                ? { message: "Transfer already completed" }
                : { message: "Transfer is still pending MTN final confirmation" }),
        });
        continue;
      }

      try {
        const transfer = await initiateMomoTransfer({
          amount: String(recipient.amount),
          currency: process.env.MTN_MOMO_CURRENCY || "GHS",
          phoneNumber: recipient.staff.momoNumber,
          externalId: `${paymentId}-${recipient.id}`,
          payerMessage: `Payment: ${current.title}`,
          payeeNote: `Beneficiary ${recipient.staff.firstName} ${recipient.staff.lastName}`,
        });

        const finalTransferStatus = await pollMomoTransferStatus({
          referenceId: transfer.referenceId,
        });

        if (finalTransferStatus.status === "SUCCESSFUL") {
          await db
            .update(paymentRecipients)
            .set({
              momoTransferReferenceId: transfer.referenceId,
              momoTransferStatus: finalTransferStatus.status,
              momoTransferStatusReason: finalTransferStatus.reason ?? null,
              momoTransferCheckedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(paymentRecipients.id, recipient.id));

          results.push({
            recipientId: recipient.id,
            staffId: recipient.staffId,
            momoNumber: recipient.staff.momoNumber,
            amount: String(recipient.amount),
            referenceId: transfer.referenceId,
            status: "success",
            transferStatus: finalTransferStatus.status,
            ...(finalTransferStatus.reason
              ? { message: finalTransferStatus.reason }
              : {}),
          });
          continue;
        }

        if (finalTransferStatus.status === "FAILED") {
          await db
            .update(paymentRecipients)
            .set({
              momoTransferReferenceId: transfer.referenceId,
              momoTransferStatus: finalTransferStatus.status,
              momoTransferStatusReason:
                finalTransferStatus.reason || "MTN MoMo marked this transfer as failed",
              momoTransferCheckedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(paymentRecipients.id, recipient.id));

          results.push({
            recipientId: recipient.id,
            staffId: recipient.staffId,
            momoNumber: recipient.staff.momoNumber,
            amount: String(recipient.amount),
            referenceId: transfer.referenceId,
            status: "failed",
            transferStatus: finalTransferStatus.status,
            message: finalTransferStatus.reason || "MTN MoMo marked this transfer as failed",
          });
          continue;
        }

        await db
          .update(paymentRecipients)
          .set({
            momoTransferReferenceId: transfer.referenceId,
            momoTransferStatus: finalTransferStatus.status,
            momoTransferStatusReason:
              finalTransferStatus.reason ||
              "Transfer is still pending MTN final confirmation",
            momoTransferCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentRecipients.id, recipient.id));

        results.push({
          recipientId: recipient.id,
          staffId: recipient.staffId,
          momoNumber: recipient.staff.momoNumber,
          amount: String(recipient.amount),
          referenceId: transfer.referenceId,
          status: "pending",
          transferStatus: finalTransferStatus.status,
          message:
            finalTransferStatus.reason ||
            "Transfer is still pending MTN final confirmation",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to initiate MTN MoMo transfer";

        await db
          .update(paymentRecipients)
          .set({
            momoTransferStatus: "FAILED",
            momoTransferStatusReason: message,
            momoTransferCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentRecipients.id, recipient.id));

        results.push({
          recipientId: recipient.id,
          staffId: recipient.staffId,
          momoNumber: recipient.staff.momoNumber,
          amount: String(recipient.amount),
          status: "failed",
          message,
        });
      }
    }

    const successCount = results.filter((item) => item.status === "success").length;
    const failureCount = results.filter((item) => item.status === "failed").length;
    const pendingCount = results.filter((item) => item.status === "pending").length;

    if (failureCount === 0 && pendingCount === 0) {
      await db
        .update(payments)
        .set({
          status: "completed",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId));
    }

    res.json({
      data: {
        paymentId,
        batchReferenceId,
        attemptedCount: results.length,
        successCount,
        failureCount,
        pendingCount,
        results,
      },
      message:
        failureCount === 0 && pendingCount === 0
          ? "Direct disbursement completed successfully for all approved beneficiaries"
          : pendingCount > 0
            ? `Disbursement is still processing: ${successCount} successful, ${failureCount} failed, ${pendingCount} pending final MTN status`
            : `Disbursement completed with ${failureCount} failed transfer${failureCount === 1 ? "" : "s"}`,
    });
  } catch (error) {
    if (error instanceof MomoConfigError || error instanceof MomoApiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    next(error);
  }
});

router.post("/sync-status", async (req, res, next) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const processingPayments = await db
      .select({ id: payments.id, title: payments.title })
      .from(payments)
      .where(eq(payments.status, "processing"));

    if (!processingPayments.length) {
      res.json({
        data: {
          paymentsChecked: 0,
          recipientsPolled: 0,
          paymentsCompleted: 0,
          paymentsStillProcessing: 0,
          paymentResults: [],
        },
        message: "No processing payments found to sync.",
      });
      return;
    }

    const paymentResults: Array<{
      paymentId: string;
      paymentTitle: string;
      polledRecipients: number;
      successCount: number;
      failureCount: number;
      pendingCount: number;
      finalized: boolean;
    }> = [];

    let recipientsPolled = 0;
    let paymentsCompleted = 0;

    for (const payment of processingPayments) {
      const recipientsToPoll = await db
        .select({
          id: paymentRecipients.id,
          referenceId: paymentRecipients.momoTransferReferenceId,
        })
        .from(paymentRecipients)
        .where(
          and(
            eq(paymentRecipients.paymentId, payment.id),
            eq(paymentRecipients.status, "approved"),
            isNotNull(paymentRecipients.momoTransferReferenceId),
          ),
        );

      for (const recipient of recipientsToPoll) {
        if (!recipient.referenceId) {
          continue;
        }

        const transferStatus = await pollMomoTransferStatus({
          referenceId: recipient.referenceId,
        });

        await db
          .update(paymentRecipients)
          .set({
            momoTransferStatus: transferStatus.status,
            momoTransferStatusReason: transferStatus.reason ?? null,
            momoTransferCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paymentRecipients.id, recipient.id));

        recipientsPolled += 1;
      }

      const allApprovedRecipients = await db
        .select({
          status: paymentRecipients.status,
          transferStatus: paymentRecipients.momoTransferStatus,
        })
        .from(paymentRecipients)
        .where(
          and(
            eq(paymentRecipients.paymentId, payment.id),
            eq(paymentRecipients.status, "approved"),
          ),
        );

      const successCount = allApprovedRecipients.filter(
        (recipient) => recipient.transferStatus === "SUCCESSFUL",
      ).length;
      const failureCount = allApprovedRecipients.filter(
        (recipient) => recipient.transferStatus === "FAILED",
      ).length;
      const pendingCount = allApprovedRecipients.filter(
        (recipient) => !recipient.transferStatus || ["PENDING", "UNKNOWN"].includes(recipient.transferStatus),
      ).length;

      let finalized = false;
      if (allApprovedRecipients.length > 0 && failureCount === 0 && pendingCount === 0) {
        await db
          .update(payments)
          .set({
            status: "completed",
            updatedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        finalized = true;
        paymentsCompleted += 1;
      }

      paymentResults.push({
        paymentId: payment.id,
        paymentTitle: payment.title,
        polledRecipients: recipientsToPoll.length,
        successCount,
        failureCount,
        pendingCount,
        finalized,
      });
    }

    const paymentsStillProcessing = processingPayments.length - paymentsCompleted;

    res.json({
      data: {
        paymentsChecked: processingPayments.length,
        recipientsPolled,
        paymentsCompleted,
        paymentsStillProcessing,
        paymentResults,
      },
      message:
        paymentsCompleted > 0
          ? `Sync complete: finalized ${paymentsCompleted} payment${paymentsCompleted === 1 ? "" : "s"}.`
          : "Sync complete: no payments were ready to finalize.",
    });
  } catch (error) {
    if (error instanceof MomoConfigError || error instanceof MomoApiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    next(error);
  }
});

router.post("/:id/cancel", async (req, res, next) => {
  try {
    const { id: paymentId } = req.params as { id: string };
    const [current] = await db.select().from(payments).where(eq(payments.id, paymentId));

    if (!current) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!["draft", "pending_approval"].includes(current.status)) {
      res.status(409).json({ error: "Payment cannot be cancelled in its current state" });
      return;
    }

    const [updated] = await db
      .update(payments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(payments.id, paymentId))
      .returning();

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export { recalculatePaymentTotal };
export default router;
