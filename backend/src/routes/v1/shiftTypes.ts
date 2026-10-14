import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { shiftType } from "../../db/schema/index.js";
import { notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

const shiftPayloadSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(60),
  category: z.enum(["STANDARD", "MORNING", "AFTERNOON", "NIGHT"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).default(0),
  earlyInMinutes: z.number().int().min(0).default(60),
  lateOutMinutes: z.number().int().min(0).default(120),
  graceLateMinutes: z.number().int().min(0).default(15),
  active: z.boolean().optional(),
});

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["code", "name", "category"],
      filterable: ["category", "active"],
      defaultSort: "code",
    });

    const filters = [];
    if (query.q) {
      filters.push(ilike(shiftType.name, `%${query.q}%`));
    }

    for (const filter of query.filters) {
      if (filter.field === "category" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(shiftType.category, filter.value));
      }
      if (filter.field === "active" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(shiftType.active, filter.value === "true"));
      }
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const sort = query.sort[0] ?? { field: "code", descending: false };
    const orderBy =
      sort.field === "name"
        ? sort.descending
          ? desc(shiftType.name)
          : asc(shiftType.name)
        : sort.field === "category"
          ? sort.descending
            ? desc(shiftType.category)
            : asc(shiftType.category)
          : sort.descending
            ? desc(shiftType.code)
            : asc(shiftType.code);

    const [rows, totalRows] = await Promise.all([
      db.select().from(shiftType).where(where).orderBy(orderBy).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(shiftType).where(where),
    ]);

    res.json(toPageResponse(rows, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const parsed = shiftPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [created] = await db
      .insert(shiftType)
      .values({
        ...parsed.data,
        crossesMidnight: parsed.data.endTime <= parsed.data.startTime,
      })
      .returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const shiftId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!shiftId) {
      throw notFound("Shift type not found.", "SHIFT_TYPE_NOT_FOUND");
    }

    const parsed = shiftPayloadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db.select().from(shiftType).where(eq(shiftType.id, shiftId)).limit(1);
    if (!existing) {
      throw notFound("Shift type not found.", "SHIFT_TYPE_NOT_FOUND");
    }

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    ) as Record<string, unknown>;

    if (updateData.startTime !== undefined || updateData.endTime !== undefined) {
      const nextStart = typeof updateData.startTime === "string" ? updateData.startTime : existing.startTime;
      const nextEnd = typeof updateData.endTime === "string" ? updateData.endTime : existing.endTime;
      updateData.crossesMidnight = nextEnd <= nextStart;
    }

    const [updated] = await db.update(shiftType).set(updateData).where(eq(shiftType.id, shiftId)).returning();
    if (!updated) {
      throw notFound("Shift type not found.", "SHIFT_TYPE_NOT_FOUND");
    }
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
