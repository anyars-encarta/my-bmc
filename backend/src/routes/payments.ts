import { Router } from "express";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
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

    const [created] = await db
      .insert(payments)
      .values({ ...parsed.data, createdBy: req.user.id })
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
