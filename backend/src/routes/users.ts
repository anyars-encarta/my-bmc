import express from "express";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { account, appUserRole, user } from "../db/schema/index.js";
import { hashPassword } from "better-auth/crypto";
import type { StoredUserRole } from "../lib/appRoles.js";
import { isAppRole } from "../lib/platform.js";

const router = express.Router();

const parsePositiveInt = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
};

const isValidRole = (value: unknown): value is StoredUserRole =>
  value === "admin" || isAppRole(value);

const isSuperAdminTarget = async (userId: string, legacyRole: string) => {
  const rows = await db.select({ role: appUserRole.role })
    .from(appUserRole)
    .where(eq(appUserRole.userId, userId));
  const assignedRoles = rows
    .map(({ role }) => role.toLowerCase())
    .filter((role) => role === "admin" || isAppRole(role));
  const effectiveRoles = assignedRoles.length > 0
    ? assignedRoles
    : [legacyRole === "admin" ? "super_admin" : legacyRole];
  return effectiveRoles.includes("admin") || effectiveRoles.includes("super_admin");
};

const isSuperAdminActor = (req: express.Request) => {
  const roles = req.user?.roles ?? [];
  return roles.includes("super_admin") || (
    roles.length === 0 &&
    (req.user?.legacyRole === "admin" || req.user?.role === "super_admin")
  );
};

const isValidStatus = (value: unknown): value is "active" | "inactive" => {
  return value === "active" || value === "inactive";
};

// GET /api/users - list users with pagination, search, role filter
router.get("/", async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page) ?? 1;
    const limit = parsePositiveInt(req.query.limit) ?? 10;
    const offset = (page - 1) * limit;

    const searchRaw = req.query.search;
    const search =
      typeof searchRaw === "string" && searchRaw.trim()
        ? searchRaw.trim()
        : null;

    const roleRaw = req.query.role;
    const role = isValidRole(roleRaw) ? roleRaw : null;

    const statusRaw = req.query.status;
    const status = isValidStatus(statusRaw) ? statusRaw : null;

    const conditions = [];
    const escapeIlike = (str: string) =>
      str.replace(/[%_\\]/g, (c) => `\\${c}`);

    if (search) {
      conditions.push(
        or(
          ilike(user.name, `%${escapeIlike(search)}%`),
          ilike(user.email, `%${escapeIlike(search)}%`),
        ),
      );
    }

    if (role) {
      conditions.push(eq(user.role, role));
    }

    if (status) {
      conditions.push(eq(user.status, status));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          imageCldPubId: user.imageCldPubId,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(where)
        .orderBy(desc(user.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(user).where(where),
    ]);

    const total = Number(totalRows[0]?.total ?? 0);

    return res.json({
      success: true,
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch users." });
  }
});

// GET /api/users/:id - get single user
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [found] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        imageCldPubId: user.imageCldPubId,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    if (!found) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    return res.json({ success: true, data: found });
  } catch (error) {
    console.error("GET /api/users/:id error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch user." });
  }
});

// PUT /api/users/:id - update a user's name, email, role, image, and optionally password
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const isSelf = req.user?.id === id;
    const isAdmin =
      req.user?.legacyRole === "admin" ||
      req.user?.roles?.includes("super_admin") ||
      req.user?.roles?.includes("hospital_admin");

    // Only admins can update other users
    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: "You can only update your own profile.",
      });
    }

    const [found] = await db
      .select({ id: user.id, email: user.email, status: user.status, role: user.role })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    if (!found) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    if (!isSuperAdminActor(req) && await isSuperAdminTarget(id, found.role)) {
      return res.status(403).json({
        success: false,
        error: "Only super_admin can update a super_admin account.",
      });
    }

    // --- name ---
    const nameRaw = req.body?.name;
    const name =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, error: "name is required." });
    }

    // --- email ---
    const emailRaw = req.body?.email;
    const newEmail =
      typeof emailRaw === "string" && emailRaw.trim()
        ? emailRaw.trim().toLowerCase()
        : null;
    if (!newEmail) {
      return res
        .status(400)
        .json({ success: false, error: "email is required." });
    }
    const emailChanged = newEmail !== found.email;
    if (emailChanged) {
      const [existing] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, newEmail))
        .limit(1);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: "Email is already in use by another account.",
        });
      }
    }

    // --- status (admin can set status for other users) ---
    const statusRaw = req.body?.status;
    const status = isValidStatus(statusRaw) ? statusRaw : null;
    if (!isSelf && !status) {
      return res.status(400).json({
        success: false,
        error: "status must be one of: active, inactive.",
      });
    }
    if (isSelf && status && status !== found.status) {
      return res.status(403).json({
        success: false,
        error: "You cannot change your own account status.",
      });
    }

    // --- image ---
    const image =
      typeof req.body?.image === "string" && req.body.image.trim()
        ? req.body.image.trim()
        : null;
    const imageCldPubId =
      typeof req.body?.imageCldPubId === "string" &&
      req.body.imageCldPubId.trim()
        ? req.body.imageCldPubId.trim()
        : null;

    // --- password (optional) ---
    const passwordRaw = req.body?.password;
    const plainPassword =
      typeof passwordRaw === "string" && passwordRaw.trim()
        ? passwordRaw.trim()
        : null;

    // Update user table
    const [updated] = await db
      .update(user)
      .set({
        name,
        ...(emailChanged ? { email: newEmail, emailVerified: false } : {}),
        ...(!isSelf && status ? { status } : {}),
        image,
        imageCldPubId,
        updatedAt: new Date(),
      })
      .where(eq(user.id, id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        imageCldPubId: user.imageCldPubId,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });

    // Update auth account row if email or password changed
    if (emailChanged || plainPassword) {
      const accountSetData: { accountId?: string; password?: string } = {};
      if (emailChanged) accountSetData.accountId = newEmail;
      if (plainPassword)
        accountSetData.password = await hashPassword(plainPassword);

      const updatedAccounts = await db
        .update(account)
        .set(accountSetData)
        .where(
          and(
            eq(account.userId, id),
            or(
              eq(account.providerId, "credential"),
              eq(account.providerId, "credentials"),
            ),
          ),
        )
        .returning({ id: account.id });

      if (!updatedAccounts.length) {
        return res.status(404).json({
          success: false,
          error: "Auth account record not found for this user.",
        });
      }
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("PUT /api/users/:id error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to update user." });
  }
});

// DELETE /api/users/:id - delete a user (admin only)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Only admins can delete users
    const canDelete =
      req.user?.legacyRole === "admin" ||
      req.user?.roles?.includes("super_admin") ||
      req.user?.roles?.includes("hospital_admin");
    if (!canDelete) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can delete users.",
      });
    }

    // Prevent self-deletion
    if (req.user?.id === id) {
      return res.status(409).json({
        success: false,
        error: "You cannot delete your own account.",
      });
    }

    const [found] = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    if (!found) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    if (!isSuperAdminActor(req) && await isSuperAdminTarget(id, found.role)) {
      return res.status(403).json({
        success: false,
        error: "Only super_admin can delete a super_admin account.",
      });
    }

    await db.delete(user).where(eq(user.id, id));

    return res.json({ success: true, message: "User deleted successfully." });
  } catch (error) {
    console.error("DELETE /api/users/:id error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to delete user." });
  }
});

export default router;
