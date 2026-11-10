import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import { appUserRole, user } from "../../db/schema/index.js";
import { auth } from "../../lib/auth.js";
import { badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import {
  APP_ROLES,
  isAppRole,
  requireAnyRole,
  resolveRolePermissions,
  type AppRole,
} from "../../lib/platform.js";

const router = Router();

const LIST_ROLES = ["super_admin", "hospital_admin"] as const;

const roleSetSchema = z.object({
  roles: z.array(z.enum(APP_ROLES)).min(1).refine(
    (roles) => new Set(roles).size === roles.length,
    "Roles must not contain duplicates.",
  ),
});

const roleAddSchema = z.object({
  role: z.enum(APP_ROLES),
});

const normalizeRoles = (roles: readonly AppRole[]) =>
  APP_ROLES.filter((role) => roles.includes(role));

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  password: z.string().min(8),
  roles: roleSetSchema.shape.roles,
  image: z.string().url().nullable().optional(),
  imageCldPubId: z.string().max(255).nullable().optional(),
});

const patchUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  roles: roleSetSchema.shape.roles.optional(),
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
    return new Map<string, AppRole[]>();
  }

  const roles = await db
    .select({ userId: appUserRole.userId, role: appUserRole.role })
    .from(appUserRole)
    .where(inArray(appUserRole.userId, userIds));

  const map = new Map<string, AppRole[]>();
  for (const role of roles) {
    if (!isAppRole(role.role)) continue;
    const existing = map.get(role.userId) ?? [];
    existing.push(role.role);
    map.set(role.userId, existing);
  }
  for (const assignedRoles of map.values()) {
    assignedRoles.sort((left, right) => APP_ROLES.indexOf(left) - APP_ROLES.indexOf(right));
  }

  return map;
};

const replaceUserRoles = async (
  userId: string,
  roles: AppRole[],
  grantedBy: string | null,
) => {
  const normalizedRoles = normalizeRoles(roles);
  const previous = await db.select().from(appUserRole).where(eq(appUserRole.userId, userId));
  const [previousUser] = await db.select({ role: user.role }).from(user)
    .where(eq(user.id, userId)).limit(1);
  if (!previousUser) throw notFound("User not found.", "USER_NOT_FOUND");

  await db.delete(appUserRole).where(eq(appUserRole.userId, userId));
  try {
    await db.insert(appUserRole).values(normalizedRoles.map((role) => ({
      userId,
      role,
      grantedBy,
    })));
    await db.update(user).set({
      role: normalizedRoles[0] ?? "staff",
      updatedAt: new Date(),
    }).where(eq(user.id, userId));
  } catch (error) {
    try {
      await db.delete(appUserRole).where(eq(appUserRole.userId, userId));
      if (previous.length > 0) {
        await db.insert(appUserRole).values(previous);
      }
      await db.update(user).set({ role: previousUser.role }).where(eq(user.id, userId));
    } catch (compensationError) {
      console.error("Unable to restore user roles after the role update failed:", compensationError);
    }
    throw error;
  }
};

const rejectUnauthorizedSuperAdmin = (
  requestedRoles: AppRole[],
  actorRoles: AppRole[],
  currentRoles: AppRole[] = [],
) => {
  if (
    (requestedRoles.includes("super_admin") || currentRoles.includes("super_admin")) &&
    !actorRoles.includes("super_admin")
  ) {
    throw forbidden("Only super_admin can assign the super_admin role.", "ROLE_ASSIGNMENT_FORBIDDEN");
  }
};

router.post("/", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError("Validation failed.", "VALIDATION_FAILED", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const actorRoles = req.user?.roles ?? [];
    rejectUnauthorizedSuperAdmin(parsed.data.roles, actorRoles);

    const created = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
        ...(parsed.data.image ? { image: parsed.data.image } : {}),
        ...(parsed.data.imageCldPubId ? { imageCldPubId: parsed.data.imageCldPubId } : {}),
      },
    });
    const roles = normalizeRoles(parsed.data.roles);
    await replaceUserRoles(created.user.id, parsed.data.roles, req.user?.id ?? null);

    res.status(201).json({
      data: {
        ...created.user,
        roles,
        role: roles[0],
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
        role: user.role,
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
        const assignedRoles = rolesMap.get(row.id) ?? [];
        const roles = assignedRoles.length > 0
          ? assignedRoles
          : row.role === "admin"
            ? ["super_admin" as const]
            : isAppRole(row.role)
              ? [row.role]
              : [];
        return {
          ...row,
          role: roles[0],
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

    const { roles: requestedRoles, ...userFields } = parsed.data;
    const actorRoles = req.user?.roles ?? [];
    if (requestedRoles) {
      const currentRoleMap = await toRoleMap([userId]);
      const [currentUser] = await db.select({ role: user.role })
        .from(user).where(eq(user.id, userId)).limit(1);
      if (!currentUser) throw notFound("User not found.", "USER_NOT_FOUND");
      const currentRoles = currentRoleMap.get(userId) ?? (
        currentUser.role === "admin"
          ? ["super_admin" as const]
          : isAppRole(currentUser.role)
            ? [currentUser.role]
            : []
      );
      rejectUnauthorizedSuperAdmin(requestedRoles, actorRoles, currentRoles);
    }
    const updatePayload = Object.fromEntries(
      Object.entries(userFields).filter(([, value]) => value !== undefined),
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

    if (requestedRoles) {
      await replaceUserRoles(userId, requestedRoles, req.user?.id ?? null);
    }
    const rolesMap = await toRoleMap([updated.id]);
    const assignedRoles = rolesMap.get(updated.id) ?? [];
    const roles = assignedRoles.length > 0
      ? assignedRoles
      : updated.role === "admin"
        ? ["super_admin" as const]
        : isAppRole(updated.role)
          ? [updated.role]
          : [];

    res.json({
      data: {
        ...updated,
        role: roles[0],
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

router.get("/:id", requireAnyRole([...LIST_ROLES]), async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    const [record] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!record) throw notFound("User not found.", "USER_NOT_FOUND");

    const assignedRoles = await toRoleMap([userId]);
    const roles = assignedRoles.get(userId) ?? (
      record.role === "admin"
        ? ["super_admin" as const]
        : isAppRole(record.role)
          ? [record.role]
          : []
    );
    res.json({
      data: {
        ...record,
        role: roles[0],
        roles,
        permissions: resolveRolePermissions(roles),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/roles", async (req, res, next) => {
  try {
    const userId = parseRouteId(req.params.id);
    if (!userId) {
      throw badRequest("User ID is required.", "USER_ID_REQUIRED");
    }
    if (
      req.user?.id !== userId &&
      !(req.user?.roles ?? []).some((role) => LIST_ROLES.includes(role as (typeof LIST_ROLES)[number]))
    ) {
      throw forbidden("You are not allowed to view these roles.", "ROLE_READ_FORBIDDEN");
    }

    const [existing] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    const rolesMap = await toRoleMap([userId]);
    const roles = rolesMap.get(userId) ?? (
      existing.role === "admin"
        ? ["super_admin" as const]
        : isAppRole(existing.role)
          ? [existing.role]
          : []
    );
    res.json({ data: roles });
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
    const [existing] = await db.select({ id: user.id, role: user.role })
      .from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    const currentRoles = await toRoleMap([userId]);
    const existingRoles = currentRoles.get(userId) ?? (
      existing.role === "admin"
        ? ["super_admin" as const]
        : isAppRole(existing.role)
          ? [existing.role]
          : []
    );
    const roles = normalizeRoles(Array.from(new Set([...existingRoles, parsed.data.role])));
    rejectUnauthorizedSuperAdmin(roles, req.user?.roles ?? [], existingRoles);
    await replaceUserRoles(userId, roles, req.user?.id ?? null);
    res.json({ data: roles });
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
    const [existing] = await db.select({ id: user.id, role: user.role })
      .from(user).where(eq(user.id, userId)).limit(1);
    if (!existing) {
      throw notFound("User not found.", "USER_NOT_FOUND");
    }

    const currentRoles = await toRoleMap([userId]);
    const currentAssignedRoles = currentRoles.get(userId) ?? (
      existing.role === "admin"
        ? ["super_admin" as const]
        : isAppRole(existing.role)
          ? [existing.role]
          : []
    );
    rejectUnauthorizedSuperAdmin(parsed.data.roles, req.user?.roles ?? [], currentAssignedRoles);
    const roles = normalizeRoles(parsed.data.roles);
    await replaceUserRoles(userId, roles, req.user?.id ?? null);

    res.json({ data: roles });
  } catch (error) {
    next(error);
  }
});

export default router;
