import { Router } from "express";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  facilitySetup,
  insertFacilitySetupSchema,
  updateFacilitySetupSchema,
} from "../db/schema/app.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const records = await db.select().from(facilitySetup).orderBy(facilitySetup.createdAt);
    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [record] = await db
      .select()
      .from(facilitySetup)
      .where(eq(facilitySetup.id, req.params.id));

    if (!record) {
      res.status(404).json({ error: "Setup record not found" });
      return;
    }

    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = insertFacilitySetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const existing = await db.select({ id: facilitySetup.id }).from(facilitySetup).limit(1);

    if (existing.length > 0) {
      res.status(409).json({
        error: "Setup already exists",
        message: "Only one setup record is allowed. Update the existing record instead.",
      });
      return;
    }

    const [created] = await db.insert(facilitySetup).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = updateFacilitySetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [updated] = await db
      .update(facilitySetup)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(facilitySetup.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Setup record not found" });
      return;
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [deleted] = await db
      .delete(facilitySetup)
      .where(eq(facilitySetup.id, req.params.id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Setup record not found" });
      return;
    }

    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
