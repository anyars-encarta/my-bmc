import { inArray } from "drizzle-orm";
import type { Request } from "express";
import { z } from "zod";

import { db } from "../db/index.js";
import { staff, user, type Patient } from "../db/schema/index.js";
import { notFound, validationError } from "./errors.js";
import {
  assertChartAccess,
  findActiveBreakGlassPatientIds,
  patientActor,
  type ChartAccess,
  type PatientActor,
} from "./patientAccess.js";
import { facilityToday, loadPatient } from "./patientRegistry.js";
import {
  getPatientConfig,
  isUnitScopedPatientReader,
  maskPatientSummary,
  serializePatientSummary,
  type SerializeContext,
} from "./patientRules.js";
import { resolveManagedUnitIds } from "./unitAccess.js";

export const parseId = (value: unknown, field = "id") => {
  const parsed = z.string().uuid().safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) {
    throw validationError("The requested record reference is not valid.", "VALIDATION_FAILED", {
      fieldErrors: { [field]: ["A valid record reference is required."] },
    });
  }
  return parsed.data;
};

/** Parses a request body, mapping zod issues to the standard `details.fieldErrors` shape. */
export const parseBody = <Schema extends z.ZodType>(schema: Schema, body: unknown): z.infer<Schema> => {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw validationError("Validation failed.", "VALIDATION_FAILED", { fieldErrors });
  }
  return parsed.data;
};

/**
 * Parses a PATCH body against only the fields the caller actually sent, so that defaults and
 * null-normalising transforms never overwrite fields that were left out.
 */
export const parsePresent = <Shape extends Record<string, z.ZodType>>(shape: Shape, body: unknown) => {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const present = Object.fromEntries(Object.entries(shape).filter(([key]) => Object.hasOwn(source, key)));
  return parseBody(z.object(present), source) as Partial<{ [Key in keyof Shape]: z.infer<Shape[Key]> }>;
};

export const serializeContextFor = (actor: PatientActor, todayIso: string): SerializeContext => ({
  level: actor.level,
  todayIso,
  minorAgeThreshold: getPatientConfig().minorAgeThreshold,
});

/** Unit subtree a unit manager is limited to, or `null` when the caller is not unit-scoped. */
export const resolvePatientUnitScope = async (actor: PatientActor) => {
  if (!isUnitScopedPatientReader(actor.roles)) return null;
  return (await resolveManagedUnitIds(actor.userId, ["unit_manager"])) ?? [];
};

/**
 * Serialises list rows for the caller. RESTRICTED and VIP patients are masked unless the caller
 * holds an active break-glass grant for them.
 */
export const presentPatientSummaries = async (rows: Patient[], actor: PatientActor, todayIso: string) => {
  const restrictedIds = rows.filter((row) => row.confidentiality !== "NORMAL").map((row) => row.id);
  const granted = await findActiveBreakGlassPatientIds(actor.userId, restrictedIds);
  const context = serializeContextFor(actor, todayIso);
  return rows.map((row) =>
    row.confidentiality !== "NORMAL" && !granted.has(row.id)
      ? maskPatientSummary(row)
      : serializePatientSummary(row, context),
  );
};

export type PatientContext = {
  actor: PatientActor;
  patient: Patient;
  access: ChartAccess;
  todayIso: string;
};

/**
 * Loads the patient addressed by `:id` and applies the object-level checks shared by every chart
 * route: registry access, unit scope and break-glass for restricted records.
 */
export const loadPatientContext = async (
  req: Request,
  options: { entityType?: string; allowMerged?: boolean } = {},
): Promise<PatientContext> => {
  const actor = patientActor(req);
  const id = parseId(req.params.id);
  const [found, { todayIso }, unitIds] = await Promise.all([
    loadPatient(id),
    facilityToday(),
    resolvePatientUnitScope(actor),
  ]);

  const outOfScope =
    found && unitIds !== null && (!found.registeredUnitId || !unitIds.includes(found.registeredUnitId));
  if (!found || outOfScope || (found.status === "MERGED" && !options.allowMerged)) {
    throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
  }

  const access =
    found.status === "MERGED"
      ? { restriction: null, grant: null }
      : await assertChartAccess(req, actor, found, options.entityType ?? "patient");
  return { actor, patient: found, access, todayIso };
};

/** Display names for user ids, so that the UI never has to show an account id. */
export const loadUserNames = async (userIds: Array<string | null | undefined>) => {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
};

export const loadStaffNames = async (staffIds: Array<string | null | undefined>) => {
  const ids = [...new Set(staffIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName })
    .from(staff)
    .where(inArray(staff.id, ids));
  return new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`]));
};
