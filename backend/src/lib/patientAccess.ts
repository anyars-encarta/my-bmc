import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Request } from "express";

import { db } from "../db/index.js";
import {
  auditLog,
  breakGlassAccess,
  patientIdentifier,
  staff,
  type BreakGlassAccess,
  type Patient,
} from "../db/schema/index.js";
import { forbidden } from "./errors.js";
import { resolvePatientAccessLevel, type PatientAccessLevel } from "./patientRules.js";

export type PatientActor = {
  userId: string;
  roles: string[];
  level: PatientAccessLevel;
};

export type PatientRestriction = "RESTRICTED" | "VIP" | "SELF";

type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "READ_RESTRICTED"
  | "BREAK_GLASS"
  | "PRINT"
  | "OVERRIDE"
  | "APPROVE"
  | "REJECT";

/** Resolves the caller's registry access level, rejecting roles with no patient access. */
export const patientActor = (req: Request): PatientActor => {
  const roles = req.user?.roles ?? [];
  const level = resolvePatientAccessLevel(roles);
  if (!req.user?.id || !level) {
    throw forbidden("You do not have access to the patient registry.");
  }
  return { userId: req.user.id, roles, level };
};

const clientIp = (req: Request) => {
  const ip = req.ip;
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
};

/**
 * Writes a patient-scoped audit entry. Failures are logged rather than thrown so that an audit
 * outage cannot leave a completed change looking as if it had failed.
 */
export const writePatientAudit = async (
  req: Request,
  values: {
    action: AuditAction;
    entityType: string;
    entityId: string | null;
    patientId: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    orgUnitId?: string | null;
  },
) => {
  try {
    await db.insert(auditLog).values({
      action: values.action,
      entityType: values.entityType,
      entityId: values.entityId,
      actorUserId: req.user?.id ?? null,
      actorRoles: req.user?.roles ?? [],
      requestId: req.requestId ?? null,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
      patientId: values.patientId,
      orgUnitId: values.orgUnitId ?? null,
      reason: values.reason ?? null,
      before: values.before ?? null,
      after: values.after ?? null,
    });
  } catch (error) {
    console.error("Failed to write patient audit entry", {
      action: values.action,
      entityType: values.entityType,
      requestId: req.requestId,
      error,
    });
  }
};

export const findActiveBreakGlass = async (userId: string, patientId: string) => {
  const [grant] = await db
    .select()
    .from(breakGlassAccess)
    .where(
      and(
        eq(breakGlassAccess.userId, userId),
        eq(breakGlassAccess.patientId, patientId),
        gt(breakGlassAccess.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(breakGlassAccess.expiresAt))
    .limit(1);
  return grant ?? null;
};

/** Patients (from the given set) the user currently holds a break-glass grant for. */
export const findActiveBreakGlassPatientIds = async (userId: string, patientIds: string[]) => {
  if (patientIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ patientId: breakGlassAccess.patientId })
    .from(breakGlassAccess)
    .where(
      and(
        eq(breakGlassAccess.userId, userId),
        inArray(breakGlassAccess.patientId, patientIds),
        gt(breakGlassAccess.expiresAt, sql`now()`),
      ),
    );
  return new Set(rows.map((row) => row.patientId));
};

/** True when the patient carries the caller's own Employee ID as an active identifier. */
export const isOwnPatientRecord = async (userId: string, patientId: string) => {
  const [row] = await db
    .select({ id: patientIdentifier.id })
    .from(patientIdentifier)
    .innerJoin(staff, sql`upper(${staff.employeeId}) = upper(${patientIdentifier.idValue})`)
    .where(
      and(
        eq(patientIdentifier.patientId, patientId),
        eq(patientIdentifier.idType, "STAFF_ID"),
        eq(patientIdentifier.status, "ACTIVE"),
        eq(staff.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
};

export const resolveRestriction = async (
  patient: Pick<Patient, "id" | "confidentiality">,
  userId: string,
): Promise<PatientRestriction | null> => {
  if (patient.confidentiality === "VIP") return "VIP";
  if (patient.confidentiality === "RESTRICTED") return "RESTRICTED";
  return (await isOwnPatientRecord(userId, patient.id)) ? "SELF" : null;
};

export type ChartAccess = {
  restriction: PatientRestriction | null;
  grant: BreakGlassAccess | null;
};

/**
 * Object-level check for every `/patients/:id` route. Restricted, VIP and own records need an
 * active break-glass grant; both the refusal and the permitted read are audited.
 */
export const assertChartAccess = async (
  req: Request,
  actor: PatientActor,
  patient: Pick<Patient, "id" | "confidentiality">,
  entityType = "patient",
): Promise<ChartAccess> => {
  const restriction = await resolveRestriction(patient, actor.userId);
  if (!restriction) return { restriction: null, grant: null };

  const grant = await findActiveBreakGlass(actor.userId, patient.id);
  if (!grant) {
    await writePatientAudit(req, {
      action: "READ_RESTRICTED",
      entityType,
      entityId: patient.id,
      patientId: patient.id,
      reason: `DENIED: break-glass required (${restriction})`,
    });
    throw forbidden("This record is restricted. Break-glass access is required.", "BREAK_GLASS_REQUIRED", {
      patientId: patient.id,
      restriction,
    });
  }

  await writePatientAudit(req, {
    action: "READ_RESTRICTED",
    entityType,
    entityId: patient.id,
    patientId: patient.id,
    reason: `Break-glass: ${grant.reason}`,
  });
  return { restriction, grant };
};
