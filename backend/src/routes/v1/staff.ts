import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { insertStaffSchema, staff, updateStaffSchema } from "../../db/schema/index.js";
import { badRequest, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { requireAnyRole } from "../../lib/platform.js";

const router = Router();

const staffCreateSchema = insertStaffSchema.extend({
  userId: z.string().optional(),
});

const parseRouteId = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const resolveSort = (field: string, descending: boolean) => {
  if (field === "firstName") return descending ? desc(staff.firstName) : asc(staff.firstName);
  if (field === "lastName") return descending ? desc(staff.lastName) : asc(staff.lastName);
  if (field === "email") return descending ? desc(staff.email) : asc(staff.email);
  if (field === "employeeId") return descending ? desc(staff.employeeId) : asc(staff.employeeId);
  return descending ? desc(staff.createdAt) : asc(staff.createdAt);
};

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["firstName", "lastName", "email", "employeeId", "createdAt"],
      filterable: ["status", "department", "staffCategory", "scheduleMode"],
      defaultSort: "-createdAt",
    });

    const filters = [];
    if (query.q) {
      filters.push(
        or(
          ilike(staff.firstName, `%${query.q}%`),
          ilike(staff.lastName, `%${query.q}%`),
          ilike(staff.email, `%${query.q}%`),
        ),
      );
    }

    for (const filter of query.filters) {
      if (filter.operator !== "eq" || typeof filter.value !== "string") {
        continue;
      }

      if (filter.field === "status") {
        filters.push(eq(staff.status, filter.value as "active" | "inactive"));
      }
      if (filter.field === "department") {
        filters.push(eq(staff.department, filter.value));
      }
      if (filter.field === "staffCategory") {
        filters.push(eq(staff.staffCategory, filter.value as "CLINICAL" | "NON_CLINICAL"));
      }
      if (filter.field === "scheduleMode") {
        filters.push(eq(staff.scheduleMode, filter.value as "FIXED_WEEKDAY" | "ROSTERED"));
      }
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const sort = query.sort[0] ?? { field: "createdAt", descending: true };

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(staff)
        .where(where)
        .orderBy(resolveSort(sort.field, sort.descending))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ total: count() }).from(staff).where(where),
    ]);

    res.json(toPageResponse(rows, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const parsed = staffCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const [created] = await db.insert(staff).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const staffId = parseRouteId(req.params.id);
    if (!staffId) {
      throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
    }

    const [record] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
    if (!record) {
      throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
    }
    res.json({ data: record });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]),
  async (req, res, next) => {
    try {
      const staffId = parseRouteId(req.params.id);
      if (!staffId) {
        throw badRequest("Staff ID is required.", "STAFF_ID_REQUIRED");
      }

      const parsed = updateStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        throw validationError("Validation failed.", "VALIDATION_FAILED", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }

      const updatePayload = Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      );

      const [updated] = await db
        .update(staff)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(eq(staff.id, staffId))
        .returning();

      if (!updated) {
        throw notFound("Staff member not found.", "STAFF_NOT_FOUND");
      }

      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
