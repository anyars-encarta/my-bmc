import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { db } from "../db/index.js";
import { appUserRole, auditLog, user, userUnitScope } from "../db/schema/index.js";
import {
  APP_ROLES,
  isAppRole,
  type AppRole,
  type StoredUserRole,
} from "./appRoles.js";

export { APP_ROLES, isAppRole };
export type { AppRole };

const ROLE_PERMISSION_MAP: Record<AppRole, string[]> = {
  super_admin: ["*"],
  hospital_admin: [
    "facility.read",
    "facility.write",
    "users.read",
    "users.write",
    "users.roles.write",
    "staff.read",
    "audit.read",
    "patient.read",
  ],
  hr_manager: ["staff.read", "staff.write", "roster.read", "roster.write"],
  payroll_officer: ["payroll.read", "payroll.write", "staff.read"],
  unit_manager: [
    "staff.read",
    "roster.read",
    "roster.publish",
    "patient.read",
    "break_glass.review.read",
    "break_glass.review.write",
  ],
  roster_officer: ["roster.read", "roster.write", "staff.read"],
  registrar: ["patient.read", "patient.write", "consent.read", "consent.write", "break_glass.request"],
  records_officer: [
    "patient.read",
    "patient.write",
    "patient.merge",
    "patient.audit.read",
    "consent.read",
    "consent.write",
    "break_glass.request",
  ],
  cashier: ["billing.read", "billing.write", "patient.read"],
  accounts: ["payments.read", "payments.write", "users.read"],
  billing_officer: ["billing.read", "billing.write", "patient.read"],
  doctor: ["patient.read", "patient.write", "encounter.read", "encounter.write", "consent.read", "break_glass.request"],
  nurse: ["patient.read", "encounter.read", "encounter.write", "consent.read", "break_glass.request"],
  midwife: ["patient.read", "encounter.read", "encounter.write", "consent.read", "break_glass.request"],
  pharmacist: ["pharmacy.read", "pharmacy.write", "patient.read"],
  pharmacy_tech: ["pharmacy.read", "pharmacy.write", "patient.read"],
  lab_scientist: ["laboratory.read", "laboratory.write", "patient.read"],
  radiographer: ["radiology.read", "radiology.write", "patient.read"],
  radiologist: ["radiology.read", "radiology.report.write", "patient.read"],
  store_keeper: ["inventory.read", "inventory.write"],
  procurement_officer: ["inventory.read", "procurement.write"],
  report_viewer: ["reporting.read"],
  auditor: ["audit.read", "reporting.read", "break_glass.review.read"],
  dpo: [
    "audit.read",
    "privacy.read",
    "consent.read",
    "patient.read",
    "patient.audit.read",
    "break_glass.review.read",
    "break_glass.review.write",
  ],
  staff: ["self.read", "schedule.read"],
};

const LEGACY_TO_APP_ROLE: Record<"admin" | "accounts", AppRole> = {
  admin: "super_admin",
  accounts: "accounts",
};

/** Maps an HTTP method to the audit action used for successful writes. */
const mapMethodToAction = (method: string) => {
  if (method === "POST") return "CREATE";
  if (method === "PATCH" || method === "PUT") return "UPDATE";
  if (method === "DELETE") return "DELETE";
  return null;
};

/** Extracts the API entity and its first path identifier for audit records. */
const parseEntity = (path: string) => {
  const clean = path.split("?")[0] ?? "";
  const segments = clean.replace(/^\/api(\/v1)?\/?/, "").split("/").filter(Boolean);
  const entityType = segments[0] ?? "unknown";
  const entityId = segments[1] ?? null;

  return { entityType, entityId };
};

/** Normalizes IPv4-mapped IPv6 addresses before they are stored in the audit log. */
const parseClientIp = (ip?: string | null) => {
  if (!ip) return null;
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
};

/** Resolves the sorted union of permissions granted by a user's assigned roles. */
export const resolveRolePermissions = (roles: AppRole[]) => {
  if (roles.includes("super_admin")) {
    return ["*"];
  }

  const values = new Set<string>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSION_MAP[role] ?? []) {
      values.add(permission);
    }
  }

  return Array.from(values).sort();
};

/** Loads assigned application roles, falling back to the supported legacy role. */
export const loadUserRoles = async (userId: string, legacyRole: StoredUserRole) => {
  const rows = await db
    .select({ role: appUserRole.role })
    .from(appUserRole)
    .where(eq(appUserRole.userId, userId));

  const roles = rows.map((row) => row.role).filter((role): role is AppRole => isAppRole(role));
  if (roles.length > 0) {
    return roles;
  }

  return [legacyRole === "admin" ? LEGACY_TO_APP_ROLE.admin : legacyRole];
};

/** Determines whether a user's roles satisfy an allowed-role list. */
export const userHasRole = (userRoles: AppRole[], allowed: readonly string[]) => {
  if (userRoles.includes("super_admin")) {
    return true;
  }

  return allowed.some((role) => userRoles.includes(role as AppRole));
};

/** Creates middleware that rejects requests without an allowed application role. */
export const requireAnyRole = (allowed: readonly string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles = (req.user?.roles ?? []).filter((role): role is AppRole => isAppRole(role));

    if (!userHasRole(roles, allowed)) {
      return res.status(403).json({
        type: "https://hams.example/problems/forbidden",
        title: "Forbidden",
        status: 403,
        error: "Forbidden",
        message: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
        requestId: req.requestId,
      });
    }

    next();
  };
};

/** Creates the monthly audit-log partition for a YYYY-MM period. */
export const ensureAuditPartition = async (period: string) => {
  const [yearPart, monthPart] = period.split("-");
  const parsedYear = Number.parseInt(yearPart ?? "", 10);
  const parsedMonth = Number.parseInt(monthPart ?? "", 10);
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getUTCFullYear();
  const month = Number.isFinite(parsedMonth) ? parsedMonth : 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const tableName = `audit_log_${year}_${String(month).padStart(2, "0")}`;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${tableName}
    PARTITION OF audit_log
    FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')
  `));
};

/** Ensures that audit-log partitions exist for the current and next month. */
export const ensureAuditPartitions = async () => {
  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const nextDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const next = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}`;

  await ensureAuditPartition(current);
  await ensureAuditPartition(next);
};

/** Generates a unique request identifier. */
export const createRequestId = () => randomUUID();

/** Attaches a request identifier to the request and response headers. */
export const attachRequestId = (req: Request, res: Response, next: NextFunction) => {
  req.requestId = req.header("x-request-id")?.trim() || createRequestId();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

/** Writes a generic audit record after a successful mutating response. */
export const auditWriteMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const action = mapMethodToAction(req.method);
  if (!action) {
    return next();
  }

  res.on("finish", async () => {
    if (res.statusCode >= 400) {
      return;
    }

    try {
      const { entityType, entityId } = parseEntity(req.path);

      await db.insert(auditLog).values({
        action,
        entityType,
        entityId,
        actorUserId: req.user?.id ?? null,
        actorRoles: req.user?.roles ?? [],
        requestId: req.requestId,
        ip: parseClientIp(req.ip),
        userAgent: req.get("user-agent") ?? null,
        patientId: null,
        orgUnitId: null,
        reason: null,
        before: null,
        after: null,
      });
    } catch (error) {
      console.error("Failed to write audit log", error);
    }
  });

  next();
};

/** Loads the current user's profile, assigned roles, permissions, and unit scopes. */
export const loadMePayload = async (userId: string, fallbackRole: StoredUserRole) => {
  const [currentUser] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!currentUser) {
    return null;
  }

  const roles = await loadUserRoles(userId, fallbackRole);
  const permissions = resolveRolePermissions(roles);

  const scopes = await db
    .select({
      orgUnitId: userUnitScope.orgUnitId,
      scope: userUnitScope.scope,
      includeDescendants: userUnitScope.includeDescendants,
    })
    .from(userUnitScope)
    .where(eq(userUnitScope.userId, userId));

  return {
    user: currentUser,
    roles,
    unitScopes: scopes,
    permissions,
  };
};

/** Checks whether a user has a specific assigned application role. */
export const roleExistsForUser = async (userId: string, role: AppRole) => {
  const [row] = await db
    .select({ role: appUserRole.role })
    .from(appUserRole)
    .where(and(eq(appUserRole.userId, userId), eq(appUserRole.role, role)))
    .limit(1);

  return Boolean(row);
};
