import { Router } from "express";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { categories, insertCategorySchema, updateCategorySchema } from "../db/schema/app.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const records = await db.select().from(categories).orderBy(categories.name);
    res.json({ data: records });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const [record] = await db.select().from(categories).where(eq(categories.id, req.params.id));

    if (!record) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [created] = await db.insert(categories).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const [updated] = await db
      .update(categories)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(categories.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [deleted] = await db.delete(categories).where(eq(categories.id, req.params.id)).returning();

    if (!deleted) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ data: deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
