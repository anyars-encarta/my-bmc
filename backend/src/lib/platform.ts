import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { db } from "../db/index.js";
import { appUserRole, auditLog, user, userUnitScope } from "../db/schema/index.js";

export const APP_ROLES = [
  "SUPER_ADMIN",
  "HOSPITAL_ADMIN",
  "HR_MANAGER",
  "PAYROLL_OFFICER",
  "UNIT_MANAGER",
  "ROSTER_OFFICER",
  "REGISTRAR",
  "RECORDS_OFFICER",
  "CASHIER",
  "ACCOUNTS",
  "BILLING_OFFICER",
  "DOCTOR",
  "NURSE",
  "PHARMACIST",
  "PHARMACY_TECH",
  "LAB_SCIENTIST",
  "RADIOGRAPHER",
  "RADIOLOGIST",
  "STORE_KEEPER",
  "PROCUREMENT_OFFICER",
  "REPORT_VIEWER",
  "AUDITOR",
  "DPO",
  "STAFF",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

const ROLE_SET = new Set<AppRole>(APP_ROLES);

const ROLE_PERMISSION_MAP: Record<AppRole, string[]> = {
  SUPER_ADMIN: ["*"],
  HOSPITAL_ADMIN: [
    "facility.read",
    "facility.write",
    "users.read",
    "users.write",
    "users.roles.write",
    "staff.read",
    "audit.read",
  ],
  HR_MANAGER: ["staff.read", "staff.write", "roster.read", "roster.write"],
  PAYROLL_OFFICER: ["payroll.read", "payroll.write", "staff.read"],
  UNIT_MANAGER: ["staff.read", "roster.read", "roster.publish"],
  ROSTER_OFFICER: ["roster.read", "roster.write", "staff.read"],
  REGISTRAR: ["patient.read", "patient.write", "consent.read", "consent.write"],
  RECORDS_OFFICER: ["patient.read", "consent.read"],
  CASHIER: ["billing.read", "billing.write"],
  ACCOUNTS: ["payments.read", "payments.write", "users.read"],
  BILLING_OFFICER: ["billing.read", "billing.write"],
  DOCTOR: ["patient.read", "encounter.read", "encounter.write", "consent.read"],
  NURSE: ["patient.read", "encounter.read", "encounter.write", "consent.read"],
  PHARMACIST: ["pharmacy.read", "pharmacy.write", "patient.read"],
  PHARMACY_TECH: ["pharmacy.read", "pharmacy.write"],
  LAB_SCIENTIST: ["laboratory.read", "laboratory.write", "patient.read"],
  RADIOGRAPHER: ["radiology.read", "radiology.write", "patient.read"],
  RADIOLOGIST: ["radiology.read", "radiology.report.write", "patient.read"],
  STORE_KEEPER: ["inventory.read", "inventory.write"],
  PROCUREMENT_OFFICER: ["inventory.read", "procurement.write"],
  REPORT_VIEWER: ["reporting.read"],
  AUDITOR: ["audit.read", "reporting.read"],
  DPO: ["audit.read", "privacy.read", "consent.read"],
  STAFF: ["self.read", "schedule.read"],
};

const LEGACY_TO_APP_ROLE: Record<"admin" | "accounts", AppRole> = {
  admin: "SUPER_ADMIN",
  accounts: "ACCOUNTS",
};

const mapMethodToAction = (method: string) => {
  if (method === "POST") return "CREATE";
  if (method === "PATCH" || method === "PUT") return "UPDATE";
  if (method === "DELETE") return "DELETE";
  return null;
};

const parseEntity = (path: string) => {
  const clean = path.split("?")[0] ?? "";
  const segments = clean.replace(/^\/api(\/v1)?\/?/, "").split("/").filter(Boolean);
  const entityType = segments[0] ?? "unknown";
  const entityId = segments[1] ?? null;

  return { entityType, entityId };
};

const parseClientIp = (ip?: string | null) => {
  if (!ip) return null;
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
};

export const isAppRole = (value: unknown): value is AppRole => {
  return typeof value === "string" && ROLE_SET.has(value as AppRole);
};

export const resolveRolePermissions = (roles: AppRole[]) => {
  if (roles.includes("SUPER_ADMIN")) {
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

export const loadUserRoles = async (userId: string, legacyRole: "admin" | "accounts") => {
  const rows = await db
    .select({ role: appUserRole.role })
    .from(appUserRole)
    .where(eq(appUserRole.userId, userId));

  const roles = rows.map((row) => row.role).filter((role): role is AppRole => isAppRole(role));
  if (roles.length > 0) {
    return roles;
  }

  return [LEGACY_TO_APP_ROLE[legacyRole]];
};

export const userHasRole = (userRoles: AppRole[], allowed: readonly string[]) => {
  if (userRoles.includes("SUPER_ADMIN")) {
    return true;
  }

  return allowed.some((role) => userRoles.includes(role as AppRole));
};

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

export const ensureAuditPartitions = async () => {
  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const nextDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const next = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}`;

  await ensureAuditPartition(current);
  await ensureAuditPartition(next);
};

export const createRequestId = () => randomUUID();

export const attachRequestId = (req: Request, res: Response, next: NextFunction) => {
  req.requestId = req.header("x-request-id")?.trim() || createRequestId();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

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
      await ensureAuditPartitions();
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

export const loadMePayload = async (userId: string, fallbackRole: "admin" | "accounts") => {
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

export const roleExistsForUser = async (userId: string, role: AppRole) => {
  const [row] = await db
    .select({ role: appUserRole.role })
    .from(appUserRole)
    .where(and(eq(appUserRole.userId, userId), eq(appUserRole.role, role)))
    .limit(1);

  return Boolean(row);
};
