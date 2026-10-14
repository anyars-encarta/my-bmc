import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { orgUnit, staff, staffAssignment } from "../../db/schema/index.js";
import { badRequest, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { isAppRole, requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";

const router = Router();

const payloadSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(150),
  unitType: z.enum(["DIVISION", "DEPARTMENT", "UNIT", "WARD", "CLINIC", "THEATRE", "SERVICE_POINT"]),
  isClinical: z.boolean(),
  operates24h: z.boolean().default(false),
  active: z.boolean().optional(),
  headStaffId: z.string().uuid().nullable().optional(),
});

const parseRouteId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const buildTree = (rows: Array<typeof orgUnit.$inferSelect>) => {
  const nodes = rows.map((row) => ({ ...row, children: [] as Array<typeof row & { children: unknown[] }> }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: typeof nodes = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId);
      parent?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};

router.get("/", async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["name", "code", "unitType"],
      filterable: ["unitType", "active", "isClinical", "parentId"],
      defaultSort: "name",
    });

    const roleSet = (req.user?.roles ?? []).filter((role): role is string => typeof role === "string");
    const typedRoles = roleSet.filter((role): role is Parameters<typeof resolveManagedUnitIds>[1][number] =>
      isAppRole(role),
    );
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, typedRoles) : [];

    const filters = [];
    if (query.q) {
      filters.push(or(ilike(orgUnit.name, `%${query.q}%`), ilike(orgUnit.code, `%${query.q}%`)));
    }

    for (const filter of query.filters) {
      if (filter.field === "unitType" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.unitType, filter.value));
      }
      if (filter.field === "parentId" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.parentId, filter.value));
      }
      if (filter.field === "active" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.active, filter.value === "true"));
      }
      if (filter.field === "isClinical" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(orgUnit.isClinical, filter.value === "true"));
      }
    }

    if (managedIds !== null) {
      if (managedIds.length === 0) {
        res.json(toPageResponse([], query, 0));
        return;
      }
      filters.push(inArray(orgUnit.id, managedIds));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const firstSort = query.sort[0] ?? { field: "name", descending: false };
    const orderBy =
      firstSort.field === "code"
        ? firstSort.descending
          ? desc(orgUnit.code)
          : asc(orgUnit.code)
        : firstSort.field === "unitType"
          ? firstSort.descending
            ? desc(orgUnit.unitType)
            : asc(orgUnit.unitType)
          : firstSort.descending
            ? desc(orgUnit.name)
            : asc(orgUnit.name);

    const [records, totalRows] = await Promise.all([
      db.select().from(orgUnit).where(where).orderBy(orderBy).limit(query.limit).offset(query.offset),
      db.select({ total: count() }).from(orgUnit).where(where),
    ]);

    res.json(toPageResponse(records, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.get("/tree", async (req, res, next) => {
  try {
    const roles = (req.user?.roles ?? []).filter((role): role is Parameters<typeof resolveManagedUnitIds>[1][number] =>
      isAppRole(role),
    );
    const managedIds = req.user?.id ? await resolveManagedUnitIds(req.user.id, roles) : [];

    const rows =
      managedIds === null
        ? await db.select().from(orgUnit).orderBy(asc(orgUnit.name))
        : managedIds.length === 0
          ? []
          : await db.select().from(orgUnit).where(inArray(orgUnit.id, managedIds)).orderBy(asc(orgUnit.name));

    res.json({ data: buildTree(rows) });
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

    const [created] = await db.insert(orgUnit).values(parsed.data).returning();
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"]), async (req, res, next) => {
  try {
    const unitId = parseRouteId(req.params.id);
    if (!unitId) {
      throw badRequest("Unit ID is required.", "ORG_UNIT_ID_REQUIRED");
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
    const [updated] = await db.update(orgUnit).set(updateData).where(eq(orgUnit.id, unitId)).returning();
    if (!updated) {
      throw notFound("Org unit not found.", "ORG_UNIT_NOT_FOUND");
    }
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/staff", async (req, res, next) => {
  try {
    const unitId = parseRouteId(req.params.id);
    if (!unitId) {
      throw badRequest("Unit ID is required.", "ORG_UNIT_ID_REQUIRED");
    }

    const queryDate = typeof req.query.on === "string" && req.query.on ? req.query.on : null;
    const onDate = queryDate ?? new Date().toISOString().slice(0, 10);

    const rows = await db
      .select({
        assignmentId: staffAssignment.id,
        staffId: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
        employeeId: staff.employeeId,
        email: staff.email,
        orgUnitId: staffAssignment.orgUnitId,
        assignmentType: staffAssignment.assignmentType,
        effectiveFrom: staffAssignment.effectiveFrom,
        effectiveTo: staffAssignment.effectiveTo,
      })
      .from(staffAssignment)
      .innerJoin(staff, eq(staff.id, staffAssignment.staffId))
      .where(
        and(
          eq(staffAssignment.orgUnitId, unitId),
          lte(staffAssignment.effectiveFrom, onDate),
          or(eq(staffAssignment.effectiveTo, null), gte(staffAssignment.effectiveTo, onDate)),
        ),
      )
      .orderBy(asc(staff.lastName), asc(staff.firstName));

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
