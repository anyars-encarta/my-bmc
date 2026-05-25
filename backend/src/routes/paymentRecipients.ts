import { Router } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  insertRecipientSchema,
  paymentRecipients,
  payments,
  reviewRecipientSchema,
  updateRecipientAmountSchema,
} from "../db/schema/app.js";
import { recalculatePaymentTotal } from "./payments.js";

const router = Router({ mergeParams: true });

async function loadPayment(paymentId: string) {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return payment ?? null;
}

async function finalizeApprovalIfReady(paymentId: string, approverId: string) {
  const recipients = await db
    .select({ status: paymentRecipients.status })
    .from(paymentRecipients)
    .where(eq(paymentRecipients.paymentId, paymentId));

  if (recipients.some((recipient) => recipient.status === "pending")) {
    return;
  }

  await db
    .update(payments)
    .set({
      status: "approved",
      approvedBy: approverId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));
}

router.get("/", async (req, res, next) => {
  try {
    const { paymentId } = req.params as { paymentId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const records = await db.query.paymentRecipients.findMany({
      where: eq(paymentRecipients.paymentId, paymentId),
      with: { staff: true },
      orderBy: (recipient, { asc }) => [asc(recipient.createdAt)],
    });

    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.get("/:recipientId", async (req, res, next) => {
  try {
    const { paymentId, recipientId } = req.params as { paymentId: string; recipientId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const [record] = await db
      .select()
      .from(paymentRecipients)
      .where(
        and(
          eq(paymentRecipients.id, recipientId),
          eq(paymentRecipients.paymentId, paymentId),
        ),
      );

    if (!record) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { paymentId } = req.params as { paymentId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!["draft", "pending_approval"].includes(payment.status)) {
      res.status(409).json({ error: "Recipients can only be added while a payment is open" });
      return;
    }

    const parsed = insertRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [existing] = await db
      .select()
      .from(paymentRecipients)
      .where(
        and(
          eq(paymentRecipients.paymentId, paymentId),
          eq(paymentRecipients.staffId, parsed.data.staffId),
        ),
      );

    if (existing) {
      res.status(409).json({ error: "This staff member is already a recipient" });
      return;
    }

    const [created] = await db
      .insert(paymentRecipients)
      .values({
        ...parsed.data,
        paymentId,
        addedBy: req.user.id,
      })
      .returning();

    await recalculatePaymentTotal(paymentId);
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:recipientId", async (req, res, next) => {
  try {
    const { paymentId, recipientId } = req.params as { paymentId: string; recipientId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!["draft", "pending_approval"].includes(payment.status)) {
      res.status(409).json({ error: "Recipients can only be updated while a payment is open" });
      return;
    }

    const parsed = updateRecipientAmountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [updated] = await db
      .update(paymentRecipients)
      .set({ amount: parsed.data.amount, updatedAt: new Date() })
      .where(
        and(
          eq(paymentRecipients.id, recipientId),
          eq(paymentRecipients.paymentId, paymentId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    await recalculatePaymentTotal(paymentId);
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:recipientId", async (req, res, next) => {
  try {
    const { paymentId, recipientId } = req.params as { paymentId: string; recipientId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (!["draft", "pending_approval"].includes(payment.status)) {
      res.status(409).json({ error: "Recipients can only be removed while a payment is open" });
      return;
    }

    const [deleted] = await db
      .delete(paymentRecipients)
      .where(
        and(
          eq(paymentRecipients.id, recipientId),
          eq(paymentRecipients.paymentId, paymentId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    await recalculatePaymentTotal(paymentId);
    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

router.post("/:recipientId/review", async (req, res, next) => {
  try {
    const { paymentId, recipientId } = req.params as { paymentId: string; recipientId: string };

    const payment = await loadPayment(paymentId);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (payment.status !== "pending_approval") {
      res.status(409).json({ error: "Recipients can only be reviewed after submission" });
      return;
    }

    const parsed = reviewRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    if (!req.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [updated] = await db
      .update(paymentRecipients)
      .set({
        status: parsed.data.status,
        note: parsed.data.note ?? null,
        verifiedBy: req.user.id,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentRecipients.id, recipientId),
          eq(paymentRecipients.paymentId, paymentId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    await recalculatePaymentTotal(paymentId);
    await finalizeApprovalIfReady(paymentId, req.user.id);

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
