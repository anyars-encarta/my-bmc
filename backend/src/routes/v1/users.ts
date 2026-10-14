import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { appUserRole, user } from "../../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { APP_ROLES, isAppRole, requireAnyRole, resolveRolePermissions } from "../../lib/platform.js";

const router = Router();

const LIST_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"] as const;

const roleSetSchema = z.object({
  roles: z.array(z.enum(APP_ROLES)).min(1),
});

const roleAddSchema = z.object({
  role: z.enum(APP_ROLES),
});

const patchUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const parseRouteId = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const toSortColumn = (field: string, descending: boolean) => {
  if (field === "name") {
    return descending ? desc(user.name) : asc(user.name);
  }
  if (field === "email") {
    return descending ? desc(user.email) : asc(user.email);
  }
  if (field === "status") {
    return descending ? desc(user.status) : asc(user.status);
  }
  return descending ? desc(user.createdAt) : asc(user.createdAt);
};

const toRoleMap = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, string[]>();
  }

  const roles = await db
    .select({ userId: appUserRole.userId, role: appUserRole.role })
    .from(appUserRole)
    .where(inArray(appUserRole.userId, userIds));

  const map = new Map<string, string[]>();
  for (const role of roles) {
    const existing = map.get(role.userId) ?? [];
    existing.push(role.role);
    map.set(role.userId, existing);
  }

  return map;
};

router.get("/", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const query = parseListQuery(req, {
      sortable: ["name", "email", "status", "createdAt"],
      filterable: ["status", "role"],
      defaultSort: "-createdAt",
    });

    const filters = [];
    if (query.q) {
      filters.push(or(ilike(user.name, `%${query.q}%`), ilike(user.email, `%${query.q}%`)));
    }

    let requiredRoles: string[] = [];
    for (const filter of query.filters) {
      if (filter.field === "status" && filter.operator === "eq" && typeof filter.value === "string") {
        filters.push(eq(user.status, filter.value as "active" | "inactive"));
      }

      if (filter.field === "role") {
        if (filter.operator === "eq" && typeof filter.value === "string") {
          requiredRoles = [filter.value];
        }

        if (filter.operator === "in" && Array.isArray(filter.value)) {
          requiredRoles = filter.value;
        }
      }
    }

    if (requiredRoles.length > 0) {
      const roleMatches = await db
        .selectDistinct({ userId: appUserRole.userId })
        .from(appUserRole)
        .where(inArray(appUserRole.role, requiredRoles));

      const userIds = roleMatches.map((entry) => entry.userId);
      if (userIds.length === 0) {
        res.json(toPageResponse([], query, 0));
        return;
      }
      filters.push(inArray(user.id, userIds));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const sort = query.sort[0] ?? { field: "createdAt", descending: true };

    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(where)
      .orderBy(toSortColumn(sort.field, sort.descending))
      .limit(query.limit)
      .offset(query.offset);

    const totalRows = await db.select({ total: count() }).from(user).where(where);
    const rolesMap = await toRoleMap(rows.map((row) => row.id));

    const data = rows
      .map((row) => {
        const roles = (rolesMap.get(row.id) ?? []).filter((role): role is (typeof APP_ROLES)[number] =>
          isAppRole(role),
        );
        return {
          ...row,
          roles,
          permissions: resolveRolePermissions(roles),
        };
      });

    res.json(toPageResponse(data, query, Number(totalRows[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    }

    const parsed = patchUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const updatePayload = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    );

    const [updated] = await db
      .update(user)
      .set({
        ...updatePayload,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
      .returning();

    if (!updated) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    const rolesMap = await toRoleMap([updated.id]);
    const roles = (rolesMap.get(updated.id) ?? []).filter((role): role is (typeof APP_ROLES)[number] =>
      isAppRole(role),
    );

    res.json({
      data: {
        ...updated,
        roles,
        permissions: resolveRolePermissions(roles),
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      next(conflict("A user with this email already exists.", "USER_EMAIL_DUPLICATE"));
      return;
    }
    next(error);
  }
});

router.get("/:id/roles", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    }

    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    const rolesMap = await toRoleMap([userId]);
    res.json({ data: rolesMap.get(userId) ?? [] });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/roles", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    }

    const parsed = roleAddSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    if (parsed.data.role === "SUPER_ADMIN" && !((req.user?.roles ?? []).includes("SUPER_ADMIN"))) {
      throw forbidden("Only SUPER_ADMIN can assign SUPER_ADMIN role.", "ROLE_ASSIGNMENT_FORBIDDEN");
    }

    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    await db
      .insert(appUserRole)
      .values({
        userId,
        role: parsed.data.role,
        grantedBy: req.user?.id ?? null,
      })
      .onConflictDoNothing();

    const rolesMap = await toRoleMap([userId]);
    res.json({ data: rolesMap.get(userId) ?? [] });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/roles", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    }

    const parsed = roleSetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    if (parsed.data.roles.includes("SUPER_ADMIN") && !((req.user?.roles ?? []).includes("SUPER_ADMIN"))) {
      throw forbidden("Only SUPER_ADMIN can assign SUPER_ADMIN role.", "ROLE_ASSIGNMENT_FORBIDDEN");
    }

    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    await db.transaction(async (tx) => {
      await tx.delete(appUserRole).where(eq(appUserRole.userId, userId));
      await tx.insert(appUserRole).values(
        parsed.data.roles.map((role) => ({
          userId,
          role,
          grantedBy: req.user?.id ?? null,
        })),
      );
    });

    res.json({ data: parsed.data.roles });
  } catch (error) {
    next(error);
  }
});

export default router;
