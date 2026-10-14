import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { jobRole } from "../../db/schema/index.js";
import { notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

const payloadSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  staffCategory: z.enum(["CLINICAL", "NON_CLINICAL"]),
  requiresLicense: z.boolean().default(false),
});

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["code", "name", "staffCategory"],
      filterable: ["staffCategory", "requiresLicense"],
      defaultSort: "name",
    });

    const filters = [];
    if (query.q) {
      filters.push(ilike(jobRole.name, `%${query.q}%`));
    }

    for (const filter of query.filters) {
      if (filter.field === "staffCategory" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(jobRole.staffCategory, filter.value));
      }
      if (filter.field === "requiresLicense" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(jobRole.requiresLicense, filter.value === "true"));
      }
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const sort = query.sort[0] ?? { field: "name", descending: false };
    const orderBy =
      sort.field === "code"
        ? sort.descending
          ? desc(jobRole.code)
          : asc(jobRole.code)
        : sort.field === "staffCategory"
          ? sort.descending
            ? desc(jobRole.staffCategory)
            : asc(jobRole.staffCategory)
          : sort.descending
            ? desc(jobRole.name)
            : asc(jobRole.name);

    const [rows, totalRows] = await Promise.all([
      db.select().from(jobRole).where(where).orderBy(orderBy).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(jobRole).where(where),
    ]);

    res.json(toPageResponse(rows, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [created] = await db.insert(jobRole).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const roleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!roleId) {
      throw notFound("Job role not found.", "JOB_ROLE_NOT_FOUND");
    }

    const parsed = payloadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );
    const [updated] = await db.update(jobRole).set(updateData).where(eq(jobRole.id, roleId)).returning();
    if (!updated) {
      throw notFound("Job role not found.", "JOB_ROLE_NOT_FOUND");
    }

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
