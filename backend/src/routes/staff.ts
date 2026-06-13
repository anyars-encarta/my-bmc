import { Router } from "express";
import { count, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  insertStaffSchema,
  paymentRecipients,
  staff,
  updateStaffSchema,
} from "../db/schema/app.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const records = await db.select().from(staff).orderBy(staff.createdAt);
    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [record] = await db.select().from(staff).where(eq(staff.id, req.params.id));

    if (!record) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = insertStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [created] = await db.insert(staff).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = updateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [updated] = await db
      .update(staff)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(staff.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [usage] = await db
      .select({ total: count() })
      .from(paymentRecipients)
      .where(eq(paymentRecipients.staffId, req.params.id));

    if (Number(usage?.total ?? 0) > 0) {
      res.status(409).json({
        error:
          "Cannot delete staff linked to payment records. Set the staff status to inactive instead.",
      });
      return;
    }

    const [deleted] = await db.delete(staff).where(eq(staff.id, req.params.id)).returning();

    if (!deleted) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }

    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
