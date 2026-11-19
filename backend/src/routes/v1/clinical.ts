import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  admission,
  auditLog,
  clinicalNote,
  clinicalOrder,
  diagnosis,
  drug,
  drugInteraction,
  ewsPolicy,
  encounter,
  icd10Code,
  medicalCertificate,
  notification,
  orgUnit,
  outpatientTask,
  patient,
  patientAllergy,
  prescription,
  prescriptionItem,
  referral,
  serviceItem,
  staff,
  staffLicense,
  triageAssessment,
  visit,
  vitalSign,
} from "../../db/schema/index.js";
import { ApiError, badRequest, conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { calculateEws, evaluateDrugSafety, ewsRulesSchema } from "../../lib/clinicalSafety.js";
import { findIcd11Code, searchIcd11 } from "../../lib/icd11.js";
import { searchLabInvestigations } from "../../lib/lab-investigations.js";
import { searchOpenFdaMedications } from "../../lib/open-fda.js";
import { assertChartAccess, patientActor } from "../../lib/patientAccess.js";
import { parsePresent } from "../../lib/patientHttp.js";
import { requireAnyRole } from "../../lib/platform.js";
import { resolveManagedUnitIds } from "../../lib/unitAccess.js";

const router = Router();

const CLINICAL_READ = [
  "super_admin", "hospital_admin", "doctor", "nurse", "midwife", "pharmacist",
  "pharmacy_tech", "lab_scientist", "radiographer", "registrar", "records_officer",
  "unit_manager", "roster_officer",
] as const;
const CLINICAL_WRITE = ["super_admin", "hospital_admin", "doctor", "nurse", "midwife"] as const;
const DOCTORS = ["super_admin", "hospital_admin", "doctor", "midwife"] as const;
const NURSES = ["super_admin", "hospital_admin", "doctor", "nurse", "midwife"] as const;
const PHARMACY_READ = [...CLINICAL_READ, "pharmacist", "pharmacy_tech"] as const;
const PHARMACY_WRITE = ["super_admin", "hospital_admin", "doctor", "midwife", "pharmacist"] as const;
const ADMIN = ["super_admin", "hospital_admin"] as const;
const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (limit: number) => z.string().trim().max(limit).nullish().transform((value) => value || null);
const overrideSchema = z.array(z.object({
  code: z.string().min(1).max(60),
  reason: z.string().trim().min(3).max(300),
})).default([]);
const overrideMap = (overrides: Array<{ code: string; reason: string }>) =>
  new Map(overrides.map((override) => [override.code, override.reason]));
const listLimit = (value: unknown, fallback = 20) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
};
const requestId = (req: Request, key: string) => {
  const value = req.params[key];
  if (typeof value !== "string" || !uuid.safeParse(value).success) {
    throw validationError("A valid record reference is required.", "INVALID_ID");
  }
  return value;
};
const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw validationError("Some fields are invalid.", "VALIDATION_ERROR", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  return parsed.data;
};
const actorStaff = async (req: Request, clinicalOnly = true) => {
  if (!req.user?.id) throw forbidden("A signed-in clinical staff account is required.");
  const [record] = await db.select().from(staff).where(and(
    eq(staff.userId, req.user.id),
    eq(staff.status, "active"),
    ...(clinicalOnly ? [eq(staff.staffCategory, "CLINICAL")] : []),
  )).limit(1);
  if (!record) throw forbidden("Link your account to an active staff profile before continuing.", "CLINICAL_STAFF_REQUIRED");
  return record;
};
const ensureLicence = async (staffId: string) => {
  const today = new Date().toISOString().slice(0, 10);
  const [licence] = await db.select().from(staffLicense).where(and(
    eq(staffLicense.staffId, staffId),
    eq(staffLicense.status, "ACTIVE"),
    gte(staffLicense.expiresOn, today),
    sql`${staffLicense.verifiedAt} IS NOT NULL`,
  )).orderBy(desc(staffLicense.expiresOn)).limit(1);
  if (!licence) throw forbidden("A current verified clinical licence is required.", "CLINICAL_LICENCE_REQUIRED");
  return licence;
};
const requireChart = async (req: Request, patientId: string, unitId: string | null) => {
  const [subject] = await db.select({
    id: patient.id,
    confidentiality: patient.confidentiality,
  }).from(patient).where(eq(patient.id, patientId)).limit(1);
  if (!subject) throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
  await assertChartAccess(req, patientActor(req), subject, "clinical_record");
  if (unitId) {
    const roles = req.user?.roles ?? [];
    if (roles.includes("unit_manager") || roles.includes("roster_officer")) {
      const { resolveManagedUnitIds } = await import("../../lib/unitAccess.js");
      const units = await resolveManagedUnitIds(req.user!.id!, roles);
      if (units && !units.includes(unitId)) throw forbidden("You do not have access to this clinic.", "UNIT_SCOPE_FORBIDDEN");
    }
  }
};
const loadVisit = async (req: Request, visitId: string) => {
  const [record] = await db.select().from(visit)
    .innerJoin(patient, eq(patient.id, visit.patientId))
    .where(eq(visit.id, visitId)).limit(1);
  if (!record) throw notFound("Visit not found.", "VISIT_NOT_FOUND");
  const visitRow = record.visit;
  await requireChart(req, visitRow.patientId, visitRow.currentUnitId);
  return visitRow;
};
const loadEncounter = async (req: Request, encounterId: string) => {
  const [record] = await db.select().from(encounter)
    .innerJoin(patient, eq(patient.id, encounter.patientId))
    .where(eq(encounter.id, encounterId)).limit(1);
  if (!record) throw notFound("Encounter not found.", "ENCOUNTER_NOT_FOUND");
  await requireChart(req, record.encounter.patientId, record.encounter.orgUnitId);
  return record.encounter;
};
const assertOpenEncounter = (record: { status: string }) => {
  if (record.status !== "OPEN") throw conflict("This encounter is signed and cannot be changed.", "ENCOUNTER_SIGNED");
};
type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "READ_RESTRICTED"
  | "BREAK_GLASS" | "LOGIN" | "LOGOUT" | "EXPORT" | "PRINT" | "OVERRIDE"
  | "APPROVE" | "REJECT" | "DEVICE_ACTION";
const writeAudit = (req: Request, values: {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  patientId: string;
  orgUnitId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}) => db.insert(auditLog).values({
  action: values.action,
  entityType: values.entityType,
  entityId: values.entityId,
  patientId: values.patientId,
  orgUnitId: values.orgUnitId ?? null,
  actorUserId: req.user?.id ?? null,
  actorRoles: req.user?.roles ?? [],
  requestId: req.requestId ?? null,
  ip: req.ip?.replace(/^::ffff:/, "") ?? null,
  userAgent: req.get("user-agent") ?? null,
  reason: values.reason ?? null,
  before: values.before ?? null,
  after: values.after ?? null,
});
const recordSafetyOverrides = (
  alerts: Array<{ code: string; severity: "STOP" | "WARN"; message: string }>,
  overrides: Array<{ code: string; reason: string }>,
) => {
  const reasons = overrideMap(overrides);
  const missing = alerts.filter((alert) => alert.severity === "STOP" && !reasons.has(alert.code));
  if (missing.length) {
    throw validationError("A reason is required to override each hard-stop alert.", "ORDER_SAFETY_HARD_STOP", {
      alerts,
      requiredOverrides: missing.map(({ code, message }) => ({ code, message })),
    });
  }
  return reasons;
};
const auditSafetyOverrides = async (
  req: Request,
  patientId: string,
  encounterId: string,
  unitId: string,
  alerts: Array<{ code: string; severity: "STOP" | "WARN"; message: string }>,
  reasons: Map<string, string>,
) => {
  const entries = alerts.flatMap((alert) => {
    const reason = reasons.get(alert.code);
    return reason ? [{
      action: "OVERRIDE",
      entityType: "clinical_safety",
      entityId: encounterId,
      patientId,
      orgUnitId: unitId,
      actorUserId: req.user?.id ?? null,
      actorRoles: req.user?.roles ?? [],
      requestId: req.requestId ?? null,
      ip: req.ip?.replace(/^::ffff:/, "") ?? null,
      userAgent: req.get("user-agent") ?? null,
      reason,
      after: { code: alert.code, message: alert.message },
    }] : [];
  });
  if (entries.length) await db.insert(auditLog).values(entries);
};

const vitalSchema = z.object({
  temperatureC: z.coerce.number().min(25).max(45).nullish(),
  pulseBpm: z.coerce.number().int().min(0).max(300).nullish(),
  respRate: z.coerce.number().int().min(0).max(100).nullish(),
  systolic: z.coerce.number().int().min(0).max(300).nullish(),
  diastolic: z.coerce.number().int().min(0).max(200).nullish(),
  spo2: z.coerce.number().int().min(0).max(100).nullish(),
  weightKg: z.coerce.number().positive().max(500).nullish(),
  heightCm: z.coerce.number().positive().max(300).nullish(),
  painScore: z.coerce.number().int().min(0).max(10).nullish(),
  bloodGlucoseMmol: z.coerce.number().min(0).max(100).nullish(),
  gcs: z.coerce.number().int().min(3).max(15).nullish(),
  avpu: z.enum(["A", "V", "P", "U"]).nullish(),
  muacCm: z.coerce.number().positive().max(100).nullish(),
});
type VitalPayload = z.infer<typeof vitalSchema>;
const activePolicy = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const policies = await db.select().from(ewsPolicy).where(and(
    eq(ewsPolicy.active, true),
    sql`${ewsPolicy.effectiveFrom} <= ${today}`,
    or(isNull(ewsPolicy.effectiveTo), sql`${ewsPolicy.effectiveTo} >= ${today}`),
  )).orderBy(desc(ewsPolicy.effectiveFrom), desc(ewsPolicy.version));
  if (policies.length > 1) {
    throw validationError("More than one EWS policy is effective. Deactivate overlapping policies before recording observations.", "EWS_POLICY_AMBIGUOUS");
  }
  return policies[0] ?? null;
};
const recordVitals = async (
  req: Request,
  subject: { patientId: string; visitId: string; encounterId: string | null; unitId: string | null },
  payload: VitalPayload,
  staffId: string,
  triage?: { category: string; chiefComplaint: string; isolationRequired: boolean; pregnant: boolean | null; mobility: string | null; notes: string | null },
) => {
  const policy = await activePolicy();
  if (!policy) throw validationError("An approved EWS policy must be configured before recording vitals.", "EWS_POLICY_NOT_CONFIGURED");
  const ews = calculateEws(payload as Record<string, number | string | null | undefined>, policy.rules);
  const vitalsId = randomUUID();
  const taskId = randomUUID();
  const unitId = subject.unitId;
  if (!unitId) throw validationError("The visit needs a clinical unit before vitals can be recorded.", "VISIT_UNIT_REQUIRED");
  const execute = await db.execute(sql`
    WITH saved_vital AS (
      INSERT INTO vital_sign (
        id, patient_id, visit_id, encounter_id, recorded_by_staff_id,
        temperature_c, pulse_bpm, resp_rate, systolic, diastolic, spo2,
        weight_kg, height_cm, pain_score, blood_glucose_mmol, gcs, avpu, muac_cm,
        ews_score, ews_band, source
      ) VALUES (
        ${vitalsId}::uuid, ${subject.patientId}::uuid, ${subject.visitId}::uuid,
        ${subject.encounterId}::uuid, ${staffId}::uuid,
        ${payload.temperatureC ?? null}, ${payload.pulseBpm ?? null}, ${payload.respRate ?? null},
        ${payload.systolic ?? null}, ${payload.diastolic ?? null}, ${payload.spo2 ?? null},
        ${payload.weightKg ?? null}, ${payload.heightCm ?? null}, ${payload.painScore ?? null},
        ${payload.bloodGlucoseMmol ?? null}, ${payload.gcs ?? null}, ${payload.avpu ?? null},
        ${payload.muacCm ?? null}, ${ews.score}, ${ews.band}, 'MANUAL'
      ) RETURNING id, patient_id, visit_id, encounter_id
    ),
    saved_triage AS (
      ${triage ? sql`
        INSERT INTO triage_assessment (
          visit_id, assessed_by_staff_id, triage_category, chief_complaint, vital_sign_id,
          isolation_required, pregnant, mobility, notes
        ) SELECT ${subject.visitId}::uuid, ${staffId}::uuid, ${triage.category},
          ${triage.chiefComplaint}, id, ${triage.isolationRequired}, ${triage.pregnant},
          ${triage.mobility}, ${triage.notes}
        FROM saved_vital RETURNING id
      ` : sql`SELECT NULL::uuid AS id`}
    ),
    raised_task AS (
      INSERT INTO outpatient_task (
        id, patient_id, visit_id, vital_sign_id, org_unit_id, task_type, description, priority
      )
      SELECT ${taskId}::uuid, patient_id, visit_id, id, ${unitId}::uuid, 'EWS_HIGH',
        ${`High early-warning score (${ews.score}) — prompt nursing review.`}, 'URGENT'
      FROM saved_vital WHERE ${ews.band} = 'HIGH'
      RETURNING id
    ),
    raised_alert AS (
      INSERT INTO notification (
        channel, recipient_type, recipient_id, template, payload, related_entity_type, related_entity_id
      )
      SELECT 'IN_APP', 'STAFF', staff.user_id, 'EWS_HIGH',
        jsonb_build_object('taskId', raised_task.id, 'priority', 'URGENT', 'message', 'High early-warning score needs nursing review.'),
        'outpatient_task', raised_task.id
      FROM raised_task
      JOIN org_unit ON org_unit.id = ${unitId}::uuid
      JOIN staff ON staff.id = org_unit.head_staff_id
      WHERE staff.user_id IS NOT NULL
      RETURNING id
    )
    SELECT id FROM saved_vital
  `);
  void execute;
  const [saved] = await db.select().from(vitalSign).where(eq(vitalSign.id, vitalsId)).limit(1);
  if (!saved) throw new Error("Vitals were not saved.");
  await writeAudit(req, {
    action: "CREATE",
    entityType: "vital_sign",
    entityId: vitalsId,
    patientId: subject.patientId,
    orgUnitId: unitId,
    after: { ewsScore: ews.score, ewsBand: ews.band },
  });
  return { vital: saved, ews, taskId: ews.band === "HIGH" ? taskId : null };
};

const encounterCreateSchema = z.object({
  encounterType: z.enum(["TRIAGE", "CONSULTATION", "PROCEDURE", "REVIEW", "ED_CONSULT", "WARD_ROUND", "ANTENATAL", "NURSING"]).default("CONSULTATION"),
  chiefComplaint: optionalText(300),
});
const noteSchema = z.object({
  noteType: z.enum(["HISTORY", "EXAMINATION", "SOAP", "PROGRESS", "PROCEDURE", "CONSULT_RESPONSE", "DISCHARGE", "ADDENDUM"]).default("SOAP"),
  body: z.string().trim().min(1).max(20_000),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).default("NORMAL"),
});
const notePatchSchema = z.object({
  noteType: z.enum(["HISTORY", "EXAMINATION", "SOAP", "PROGRESS", "PROCEDURE", "CONSULT_RESPONSE", "DISCHARGE", "ADDENDUM"]).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: "Provide at least one note field to update.",
});
const noteAmendmentSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).optional(),
});
const diagnosisSchema = z.object({
  icd10Code: z.string().trim().min(1).max(10),
  codeSystem: z.enum(["ICD-10", "ICD-11"]).default("ICD-10"),
  diagnosisType: z.enum(["PRIMARY", "SECONDARY", "DIFFERENTIAL"]).default("SECONDARY"),
  certainty: z.enum(["PROVISIONAL", "CONFIRMED", "RULED_OUT"]).default("PROVISIONAL"),
  isNewCase: z.boolean().default(true),
  onsetDate: dateOnly.nullish().transform((value) => value ?? null),
});
const triageSchema = z.object({
  triageCategory: z.enum(["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"]),
  chiefComplaint: z.string().trim().min(1).max(300),
  isolationRequired: z.boolean().default(false),
  pregnant: z.boolean().nullish().transform((value) => value ?? null),
  mobility: z.enum(["INDEPENDENT", "ASSISTED", "WHEELCHAIR", "STRETCHER"]).nullish().transform((value) => value ?? null),
  notes: optionalText(2000),
  vitals: vitalSchema,
});
const dispositionSchema = z.object({
  disposition: z.enum(["DISCHARGED_HOME", "ADMITTED", "REFERRED_OUT", "OBSERVATION", "FOLLOW_UP", "LAMA", "DIED", "LEFT_WITHOUT_BEING_SEEN"]),
  followUpDate: dateOnly.nullish().transform((value) => value ?? null),
  requestedUnitId: uuid.nullish().transform((value) => value ?? null),
  clinicalSummary: optionalText(500),
  referralId: uuid.nullish().transform((value) => value ?? null),
}).superRefine((value, context) => {
  if (value.disposition === "FOLLOW_UP" && !value.followUpDate) {
    context.addIssue({ code: "custom", path: ["followUpDate"], message: "A follow-up date is required." });
  }
  if (value.disposition === "REFERRED_OUT" && !value.referralId) {
    context.addIssue({ code: "custom", path: ["referralId"], message: "Create a referral before selecting REFERRED_OUT." });
  }
});

router.get("/clinical/references", requireAnyRole(CLINICAL_READ), async (_req, res, next) => {
  try {
    const [units, policies] = await Promise.all([
      db.select({ id: orgUnit.id, code: orgUnit.code, name: orgUnit.name })
        .from(orgUnit).where(and(eq(orgUnit.active, true), eq(orgUnit.isClinical, true))).orderBy(asc(orgUnit.name)),
      db.select().from(ewsPolicy).orderBy(desc(ewsPolicy.effectiveFrom), desc(ewsPolicy.version)),
    ]);
    res.json({ data: { units, ewsPolicies: policies } });
  } catch (error) { next(error); }
});

router.get("/icd10", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) throw validationError("Enter at least 2 characters to search.", "SEARCH_TOO_SHORT");
    const rows = await db.select().from(icd10Code).where(and(
      eq(icd10Code.active, true),
      or(ilike(icd10Code.code, `%${q}%`), ilike(icd10Code.title, `%${q}%`)),
    )).orderBy(asc(icd10Code.code)).limit(listLimit(req.query.limit));
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get("/lab-investigations", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) throw validationError("Enter at least 2 characters to search.", "SEARCH_TOO_SHORT");
    res.json({ data: searchLabInvestigations(q, listLimit(req.query.limit, 20)) });
  } catch (error) { next(error); }
});

const icd11SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(128),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  language: z.string().trim().min(2).max(12).optional(),
});

router.get("/icd11/search", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const parsed = icd11SearchQuerySchema.safeParse({
      q: req.query.q,
      limit: req.query.limit,
      language: req.query.language,
    });
    if (!parsed.success) {
      throw badRequest("Invalid ICD-11 search parameters.", "ICD11_QUERY_INVALID", parsed.error.flatten());
    }
    res.json({
      data: await searchIcd11(parsed.data.q, parsed.data.limit ?? 8, parsed.data.language),
    });
  } catch (error) { next(error); }
});

const icdImportSchema = z.object({
  dryRun: z.boolean().default(false),
  rows: z.array(z.object({
    code: z.string().trim().min(1).max(10),
    title: z.string().trim().min(1).max(300),
    chapter: optionalText(10),
    block: optionalText(20),
    isNotifiable: z.boolean().default(false),
    sexRestriction: z.enum(["MALE", "FEMALE"]).nullish().transform((value) => value ?? null),
  })).min(1).max(20_000),
});
router.post("/icd10/import", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const payload = parseBody(icdImportSchema, req.body);
    const rows = payload.rows.filter((row, index, list) => list.findIndex((other) => other.code === row.code) === index);
    const existing = rows.length
      ? await db.select({ code: icd10Code.code }).from(icd10Code)
        .where(inArray(icd10Code.code, rows.map((row) => row.code)))
      : [];
    let imported = 0;
    if (!payload.dryRun) {
      const saved = await db.insert(icd10Code).values(rows.map((row) => ({ ...row })))
        .onConflictDoUpdate({
          target: icd10Code.code,
          set: {
            title: sql`excluded.title`,
            chapter: sql`excluded.chapter`,
            block: sql`excluded.block`,
            isNotifiable: sql`excluded.is_notifiable`,
            sexRestriction: sql`excluded.sex_restriction`,
            active: true,
          },
        }).returning({ code: icd10Code.code });
      imported = saved.length;
      await db.insert(auditLog).values({
        action: "CREATE",
        entityType: "icd10_import",
        actorUserId: req.user?.id ?? "system",
        actorRoles: req.user?.roles ?? [],
        requestId: req.requestId ?? null,
        after: { importedCount: imported },
      });
    }
    res.status(payload.dryRun ? 200 : 201).json({ data: {
      dryRun: payload.dryRun,
      imported,
      validRows: rows.length,
      existingRows: existing.length,
      duplicatesSkipped: payload.rows.length - rows.length,
    } });
  } catch (error) { next(error); }
});

const ewsPolicySchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  version: z.coerce.number().int().positive(),
  effectiveFrom: dateOnly,
  effectiveTo: dateOnly.nullish().transform((value) => value ?? null),
  rules: z.unknown(),
  active: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "End date must be on or after the start date." });
  }
  const parsedRules = ewsRulesSchema.safeParse(value.rules);
  if (!parsedRules.success) {
    for (const issue of parsedRules.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["rules", ...issue.path],
        message: issue.message,
      });
    }
  }
});
router.get("/ews-policies", requireAnyRole(CLINICAL_READ), async (_req, res, next) => {
  try {
    res.json({ data: await db.select().from(ewsPolicy).orderBy(desc(ewsPolicy.effectiveFrom), desc(ewsPolicy.version)) });
  } catch (error) { next(error); }
});
router.post("/ews-policies", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const payload = parseBody(ewsPolicySchema, req.body);
    const [created] = await db.insert(ewsPolicy).values({
      ...payload,
      approvedBy: req.user?.id ?? "system",
    }).returning();
    if (!created) throw new Error("EWS policy was not created.");
    await db.insert(auditLog).values({
      action: "CREATE",
      entityType: "ews_policy",
      entityId: created.id,
      actorUserId: req.user?.id ?? null,
      actorRoles: req.user?.roles ?? [],
      requestId: req.requestId ?? null,
      after: { code: payload.code, version: payload.version, active: payload.active },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.patch("/ews-policies/:id", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const payload = parseBody(z.object({ active: z.boolean() }), req.body);
    const [current] = await db.select().from(ewsPolicy).where(eq(ewsPolicy.id, id)).limit(1);
    if (!current) throw notFound("EWS policy not found.", "EWS_POLICY_NOT_FOUND");
    const [updated] = await db.update(ewsPolicy).set(payload)
      .where(eq(ewsPolicy.id, id)).returning();
    await db.insert(auditLog).values({
      action: "STATUS_CHANGE",
      entityType: "ews_policy",
      entityId: id,
      actorUserId: req.user?.id ?? null,
      actorRoles: req.user?.roles ?? [],
      requestId: req.requestId ?? null,
      before: { active: current.active },
      after: { active: updated?.active },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

router.get("/visits/:id/triage", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const visitId = requestId(req, "id");
    const visitRow = await loadVisit(req, visitId);
    const rows = await db.select({
      assessment: triageAssessment,
      vital: vitalSign,
    }).from(triageAssessment)
      .leftJoin(vitalSign, eq(triageAssessment.vitalSignId, vitalSign.id))
      .where(eq(triageAssessment.visitId, visitId))
      .orderBy(desc(triageAssessment.assessedAt));
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "triage_assessment", entityId: null,
      patientId: visitRow.patientId, orgUnitId: visitRow.currentUnitId,
    });
    res.json({ data: rows.map(({ assessment, vital }) => ({ ...assessment, vitals: vital })) });
  } catch (error) { next(error); }
});
router.post("/visits/:id/triage", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const visitId = requestId(req, "id");
    const payload = parseBody(triageSchema, req.body);
    const visitRow = await loadVisit(req, visitId);
    if (visitRow.status !== "OPEN") throw conflict("The visit is closed.", "VISIT_CLOSED");
    const clinician = await actorStaff(req);
    const result = await recordVitals(req, {
      patientId: visitRow.patientId,
      visitId,
      encounterId: null,
      unitId: visitRow.currentUnitId,
    }, payload.vitals, clinician.id, {
      category: payload.triageCategory,
      chiefComplaint: payload.chiefComplaint,
      isolationRequired: payload.isolationRequired,
      pregnant: payload.pregnant,
      mobility: payload.mobility,
      notes: payload.notes,
    });
    res.status(201).json({ data: { triage: result.vital, ews: result.ews, taskId: result.taskId } });
  } catch (error) { next(error); }
});

router.get("/outpatient-tasks", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const parsedStatuses = z.array(z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]))
      .min(1).safeParse(typeof req.query.status === "string" && req.query.status !== "ALL"
        ? req.query.status.split(",")
        : ["OPEN"]);
    const status = typeof req.query.status === "string" && req.query.status === "ALL"
      ? "ALL"
      : parsedStatuses.success ? parsedStatuses.data : null;
    if (!status) throw validationError("Task status filter is invalid.", "TASK_STATUS_INVALID");
    const roles = req.user?.roles ?? [];
    const managedUnitIds = req.user?.id && roles.some((role) =>
      role === "unit_manager" || role === "roster_officer")
      ? await resolveManagedUnitIds(req.user.id, roles)
      : null;
    if (managedUnitIds !== null && managedUnitIds.length === 0) {
      res.json({ data: [] });
      return;
    }
    const rows = await db.select({
      task: outpatientTask,
      patientName: sql<string>`concat(${patient.firstName}, ' ', ${patient.lastName})`,
      mrn: patient.mrn,
      unitName: orgUnit.name,
    }).from(outpatientTask)
      .innerJoin(patient, eq(patient.id, outpatientTask.patientId))
      .innerJoin(orgUnit, eq(orgUnit.id, outpatientTask.orgUnitId))
      .where(and(
        status === "ALL" ? undefined : inArray(outpatientTask.status, status),
        managedUnitIds === null ? undefined : inArray(outpatientTask.orgUnitId, managedUnitIds),
      ))
      .orderBy(desc(outpatientTask.priority), asc(outpatientTask.createdAt));
    const visible = [];
    for (const row of rows) {
      try {
        await requireChart(req, row.task.patientId, null);
        visible.push(row);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error;
      }
    }
    const result = visible.slice(0, listLimit(req.query.limit, 50));
    if (result.length) {
      await db.insert(auditLog).values(result.map((row) => ({
        action: "READ_RESTRICTED",
        entityType: "outpatient_task",
        entityId: row.task.id,
        patientId: row.task.patientId,
        orgUnitId: row.task.orgUnitId,
        actorUserId: req.user?.id ?? null,
        actorRoles: req.user?.roles ?? [],
        requestId: req.requestId ?? null,
        ip: req.ip?.replace(/^::ffff:/, "") ?? null,
        userAgent: req.get("user-agent") ?? null,
      })));
    }
    res.json({ data: result });
  } catch (error) { next(error); }
});
router.post("/outpatient-tasks/:id/acknowledge", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(outpatientTask).where(eq(outpatientTask.id, id)).limit(1);
    if (!current) throw notFound("Nursing task not found.", "OUTPATIENT_TASK_NOT_FOUND");
    await requireChart(req, current.patientId, current.orgUnitId);
    const clinician = await actorStaff(req);
    const [updated] = await db.update(outpatientTask).set({
      status: "ACKNOWLEDGED",
      acknowledgedByStaffId: clinician.id,
      acknowledgedAt: new Date(),
    }).where(and(eq(outpatientTask.id, id), eq(outpatientTask.status, "OPEN"))).returning();
    if (!updated) throw conflict("The task is no longer open.", "OUTPATIENT_TASK_NOT_OPEN");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "outpatient_task", entityId: id,
      patientId: current.patientId, orgUnitId: current.orgUnitId,
      before: { status: current.status }, after: { status: updated.status },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});
router.post("/outpatient-tasks/:id/resolve", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(outpatientTask).where(eq(outpatientTask.id, id)).limit(1);
    if (!current) throw notFound("Nursing task not found.", "OUTPATIENT_TASK_NOT_FOUND");
    await requireChart(req, current.patientId, current.orgUnitId);
    const clinician = await actorStaff(req);
    const [updated] = await db.update(outpatientTask).set({
      status: "RESOLVED",
      resolvedByStaffId: clinician.id,
      resolvedAt: new Date(),
    }).where(and(inArray(outpatientTask.status, ["OPEN", "ACKNOWLEDGED"]), eq(outpatientTask.id, id))).returning();
    if (!updated) throw conflict("The task is already closed.", "OUTPATIENT_TASK_NOT_OPEN");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "outpatient_task", entityId: id,
      patientId: current.patientId, orgUnitId: current.orgUnitId,
      before: { status: current.status }, after: { status: updated.status },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

router.post("/visits/:id/encounters", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const visitId = requestId(req, "id");
    const payload = parseBody(encounterCreateSchema, req.body);
    const visitRow = await loadVisit(req, visitId);
    if (!visitRow.currentUnitId) throw validationError("The visit needs a clinical unit.", "VISIT_UNIT_REQUIRED");
    const clinician = await actorStaff(req);
    const creation = await db.execute(sql<{ id: string }>`
      WITH eligible_visit AS (
        UPDATE visit
        SET open_encounter_count = open_encounter_count + 1
        WHERE id = ${visitId}::uuid AND status = 'OPEN'
        RETURNING id, patient_id, current_unit_id
      ),
      created_encounter AS (
        INSERT INTO encounter (
          visit_id, patient_id, encounter_type, provider_staff_id, org_unit_id, chief_complaint
        )
        SELECT eligible_visit.id, eligible_visit.patient_id, ${payload.encounterType},
          ${clinician.id}::uuid, eligible_visit.current_unit_id, ${payload.chiefComplaint}
        FROM eligible_visit
        RETURNING id
      )
      SELECT id FROM created_encounter
    `);
    const createdId = creation.rows[0]?.id;
    if (typeof createdId !== "string") throw conflict("The visit is closed.", "VISIT_CLOSED");
    const [created] = await db.select().from(encounter).where(eq(encounter.id, createdId)).limit(1);
    if (!created) throw new Error("Encounter was not created.");
    await writeAudit(req, {
      action: "CREATE", entityType: "encounter", entityId: created.id,
      patientId: created.patientId, orgUnitId: created.orgUnitId, after: { encounterType: created.encounterType },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.get("/visits/:id/encounters", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const visitId = requestId(req, "id");
    const visitRow = await loadVisit(req, visitId);
    const rows = await db.select().from(encounter).where(eq(encounter.visitId, visitId))
      .orderBy(desc(encounter.startedAt));
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "encounter", entityId: null,
      patientId: visitRow.patientId, orgUnitId: visitRow.currentUnitId,
    });
    res.json({ data: rows.map((row) => ({ ...row, patientId: visitRow.patientId })) });
  } catch (error) { next(error); }
});
router.get("/encounters/:id", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const record = await loadEncounter(req, id);
    const [notes, diagnoses, vitals, orders, prescriptions] = await Promise.all([
      db.select().from(clinicalNote).where(eq(clinicalNote.encounterId, id)).orderBy(asc(clinicalNote.version), asc(clinicalNote.authoredAt)),
      db.select().from(diagnosis).where(eq(diagnosis.encounterId, id)).orderBy(desc(diagnosis.notedAt)),
      db.select().from(vitalSign).where(eq(vitalSign.encounterId, id)).orderBy(desc(vitalSign.recordedAt)),
      db.select().from(clinicalOrder).where(eq(clinicalOrder.encounterId, id)).orderBy(desc(clinicalOrder.orderedAt)),
      db.select().from(prescription).where(eq(prescription.encounterId, id)).orderBy(desc(prescription.issuedAt)),
    ]);
    const items = prescriptions.length
      ? await db.select().from(prescriptionItem).where(inArray(prescriptionItem.prescriptionId, prescriptions.map((row) => row.id)))
      : [];
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "encounter", entityId: id,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
    });
    res.json({ data: { ...record, notes, diagnoses, vitals, orders, prescriptions: prescriptions.map((row) => ({
      ...row,
      items: items.filter((item) => item.prescriptionId === row.id),
    })) } });
  } catch (error) { next(error); }
});

router.post("/encounters/:id/notes", requireAnyRole(CLINICAL_WRITE), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(noteSchema, req.body);
    const author = await actorStaff(req);
    const privilegedNoteAuthor = (req.user?.roles ?? []).some((role) =>
      ["super_admin", "hospital_admin", "doctor", "midwife"].includes(role));
    if (!privilegedNoteAuthor && payload.noteType !== "PROGRESS") {
      throw forbidden("Nursing notes must use the progress note type.", "NURSING_NOTE_TYPE_REQUIRED");
    }
    const [created] = await db.insert(clinicalNote).values({
      encounterId,
      patientId: record.patientId,
      noteType: payload.noteType,
      body: payload.body,
      sensitivity: payload.sensitivity,
      authoredByStaffId: author.id,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "clinical_note", entityId: created?.id ?? null,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { noteType: payload.noteType, status: "DRAFT" },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.patch("/notes/:id", requireAnyRole(CLINICAL_WRITE), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(clinicalNote).where(eq(clinicalNote.id, id)).limit(1);
    if (!current) throw notFound("Note not found.", "NOTE_NOT_FOUND");
    const record = await loadEncounter(req, current.encounterId);
    assertOpenEncounter(record);
    if (current.status !== "DRAFT") throw conflict("Only draft notes can be edited.", "ENCOUNTER_SIGNED");
    const payload = parseBody(notePatchSchema, req.body);
    const author = await actorStaff(req);
    if (current.authoredByStaffId !== author.id) throw forbidden("Only the note author can edit this draft.", "NOTE_AUTHOR_REQUIRED");
    const privilegedNoteAuthor = (req.user?.roles ?? []).some((role) =>
      ["super_admin", "hospital_admin", "doctor", "midwife"].includes(role));
    if (!privilegedNoteAuthor && payload.noteType && payload.noteType !== "PROGRESS") {
      throw forbidden("Nursing notes must use the progress note type.", "NURSING_NOTE_TYPE_REQUIRED");
    }
    const [updated] = await db.update(clinicalNote).set(payload)
      .where(and(eq(clinicalNote.id, id), eq(clinicalNote.status, "DRAFT"))).returning();
    if (!updated) throw conflict("The note was signed while it was being edited.", "ENCOUNTER_SIGNED");
    await writeAudit(req, {
      action: "UPDATE", entityType: "clinical_note", entityId: id,
      patientId: current.patientId, orgUnitId: record.orgUnitId,
      before: { status: current.status }, after: { status: updated.status, version: updated.version },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});
router.post("/notes/:id/amend", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(clinicalNote).where(eq(clinicalNote.id, id)).limit(1);
    if (!current) throw notFound("Note not found.", "NOTE_NOT_FOUND");
    const record = await loadEncounter(req, current.encounterId);
    if (current.status !== "SIGNED") throw conflict("Only a signed note can be amended.", "NOTE_NOT_SIGNED");
    const payload = parseBody(noteAmendmentSchema, req.body);
    const author = await actorStaff(req);
    const licence = await ensureLicence(author.id);
    const latest = await db.select({ version: clinicalNote.version }).from(clinicalNote)
      .where(and(eq(clinicalNote.encounterId, current.encounterId), eq(clinicalNote.noteType, current.noteType)))
      .orderBy(desc(clinicalNote.version)).limit(1);
    const [created] = await db.insert(clinicalNote).values({
      encounterId: current.encounterId,
      patientId: current.patientId,
      noteType: current.noteType,
      body: payload.body,
      sensitivity: payload.sensitivity ?? current.sensitivity,
      version: (latest[0]?.version ?? current.version) + 1,
      amendsId: current.id,
      authoredByStaffId: author.id,
      status: "SIGNED",
      signedAt: new Date(),
      signerLicenceNo: licence.licenceNo,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "clinical_note", entityId: created?.id ?? null,
      patientId: current.patientId, orgUnitId: record.orgUnitId,
      reason: "Signed note amended.",
      after: { noteType: current.noteType, version: created?.version, amendsId: current.id },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});

const signEncounter = async (req: Request, encounterId: string) => {
  const record = await loadEncounter(req, encounterId);
  assertOpenEncounter(record);
  const activeDiagnoses = await db.select({ id: diagnosis.id }).from(diagnosis)
    .where(and(eq(diagnosis.encounterId, encounterId), eq(diagnosis.status, "ACTIVE"))).limit(1);
  if (activeDiagnoses.length === 0 && record.disposition !== "LEFT_WITHOUT_BEING_SEEN") {
    throw validationError("Add at least one active diagnosis before signing.", "ENCOUNTER_NO_DIAGNOSIS");
  }
  const last = await db.select({ id: encounter.id }).from(encounter)
    .where(eq(encounter.visitId, record.visitId)).orderBy(desc(encounter.startedAt)).limit(1);
  const isLastEncounter = last[0]?.id === record.id;
  if (isLastEncounter && !record.disposition) {
    throw validationError("Set the visit disposition before signing the last encounter.", "ENCOUNTER_DISPOSITION_REQUIRED");
  }
  const signer = await actorStaff(req);
  const licence = await ensureLicence(signer.id);
  const signing = await db.execute(sql<{ id: string }>`
    WITH signed_encounter AS (
      UPDATE encounter SET status = 'SIGNED', signed_at = now(),
        signed_by_staff_id = ${signer.id}::uuid, ended_at = now()
      WHERE id = ${encounterId}::uuid AND status = 'OPEN'
      RETURNING id, visit_id, disposition
    ),
    signed_notes AS (
      UPDATE clinical_note SET status = 'SIGNED', signed_at = now(), signer_licence_no = ${licence.licenceNo}
      WHERE encounter_id IN (SELECT id FROM signed_encounter) AND status = 'DRAFT'
      RETURNING id
    ),
    closed_visit AS (
      UPDATE visit SET
        open_encounter_count = open_encounter_count - 1,
        status = CASE
          WHEN status = 'OPEN' AND open_encounter_count = 1
            AND disposition IN ('DISCHARGED_HOME', 'LEFT_WITHOUT_BEING_SEEN') THEN 'CLOSED'
          ELSE status
        END,
        closed_at = CASE
          WHEN status = 'OPEN' AND open_encounter_count = 1
            AND disposition IN ('DISCHARGED_HOME', 'LEFT_WITHOUT_BEING_SEEN') THEN now()
          ELSE closed_at
        END
      WHERE id IN (SELECT visit_id FROM signed_encounter) AND open_encounter_count > 0
      RETURNING id, patient_id, current_unit_id, status
    ),
    visit_status_audit AS (
      INSERT INTO audit_log (
        actor_user_id, actor_roles, action, entity_type, entity_id, patient_id, org_unit_id,
        request_id, ip, user_agent, reason, before, after
      )
      SELECT ${req.user?.id ?? null}, ${sql.param(req.user?.roles ?? [], auditLog.actorRoles)}, 'STATUS_CHANGE', 'visit',
        id::text, patient_id, current_unit_id, ${req.requestId ?? null},
        ${req.ip?.replace(/^::ffff:/, "") ?? null}::inet, ${req.get("user-agent") ?? null},
        'Visit closed after its last encounter was signed.',
        jsonb_build_object('status', 'OPEN'), jsonb_build_object('status', 'CLOSED')
      FROM closed_visit WHERE status = 'CLOSED'
      RETURNING entity_id
    )
    SELECT id FROM signed_encounter
  `);
  if (!signing.rows[0]) {
    throw conflict("The encounter has already changed.", "CONCURRENT_MODIFICATION");
  }
  const [updated] = await db.select().from(encounter).where(eq(encounter.id, encounterId)).limit(1);
  if (!updated) throw new Error("The signed encounter could not be reloaded.");
  await writeAudit(req, {
    action: "APPROVE", entityType: "encounter", entityId: encounterId,
    patientId: record.patientId, orgUnitId: record.orgUnitId,
    after: { status: "SIGNED", licenceNo: licence.licenceNo },
  });
  return updated;
};
router.post("/encounters/:id/sign", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    res.json({ data: await signEncounter(req, requestId(req, "id")) });
  } catch (error) { next(error); }
});
router.post("/notes/:id/sign", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [note] = await db.select().from(clinicalNote).where(eq(clinicalNote.id, id)).limit(1);
    if (!note) throw notFound("Note not found.", "NOTE_NOT_FOUND");
    await signEncounter(req, note.encounterId);
    const [updated] = await db.select().from(clinicalNote).where(eq(clinicalNote.id, id)).limit(1);
    res.json({ data: updated });
  } catch (error) { next(error); }
});

router.post("/encounters/:id/diagnoses", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(diagnosisSchema, req.body);
    let resolvedCode: { code: string; description: string } | null;
    if (payload.codeSystem === "ICD-11") {
      const code = await findIcd11Code(payload.icd10Code);
      resolvedCode = code ? { code: code.code, description: code.description } : null;
    } else {
      const [code] = await db.select().from(icd10Code)
        .where(and(eq(icd10Code.code, payload.icd10Code), eq(icd10Code.active, true))).limit(1);
      resolvedCode = code ? { code: code.code, description: code.title } : null;
    }
    if (!resolvedCode) {
      const codeSystem = payload.codeSystem;
      throw validationError(
        codeSystem === "ICD-11" ? "Select a valid WHO ICD-11 diagnosis." : "Select an active ICD-10 diagnosis.",
        codeSystem === "ICD-11" ? "ICD11_CODE_INVALID" : "ICD10_CODE_INVALID",
      );
    }
    const [created] = await db.insert(diagnosis).values({
      encounterId,
      patientId: record.patientId,
      icd10Code: resolvedCode.code,
      codeSystem: payload.codeSystem,
      description: resolvedCode.description,
      diagnosisType: payload.diagnosisType,
      certainty: payload.certainty,
      isNewCase: payload.isNewCase,
      onsetDate: payload.onsetDate,
      notedByStaffId: (await actorStaff(req)).id,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "diagnosis", entityId: created?.id ?? null,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { code: resolvedCode.code, codeSystem: payload.codeSystem, diagnosisType: payload.diagnosisType },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.delete("/encounters/:id/diagnoses/:diagnosisId", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const diagnosisId = requestId(req, "diagnosisId");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const [updated] = await db.update(diagnosis).set({ status: "ENTERED_IN_ERROR" })
      .where(and(eq(diagnosis.id, diagnosisId), eq(diagnosis.encounterId, encounterId), eq(diagnosis.status, "ACTIVE")))
      .returning();
    if (!updated) throw notFound("Active diagnosis not found.", "DIAGNOSIS_NOT_FOUND");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "diagnosis", entityId: diagnosisId,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      before: { status: "ACTIVE" }, after: { status: updated.status },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

router.get("/encounters/:id/vitals", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    await loadEncounter(req, encounterId);
    res.json({ data: await db.select().from(vitalSign).where(eq(vitalSign.encounterId, encounterId)).orderBy(desc(vitalSign.recordedAt)) });
  } catch (error) { next(error); }
});
router.post("/encounters/:id/vitals", requireAnyRole(NURSES), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    const payload = parseBody(vitalSchema, req.body);
    const clinician = await actorStaff(req);
    const result = await recordVitals(req, {
      patientId: record.patientId,
      visitId: record.visitId,
      encounterId,
      unitId: record.orgUnitId,
    }, payload, clinician.id);
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.get("/patients/:id/vitals", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const patientId = requestId(req, "id");
    await requireChart(req, patientId, null);
    const roles = req.user?.roles ?? [];
    const managedUnitIds = req.user?.id && roles.some((role) =>
      role === "unit_manager" || role === "roster_officer")
      ? await resolveManagedUnitIds(req.user.id, roles)
      : null;
    const rows = await db.select({
      vital: vitalSign,
      orgUnitId: sql<string | null>`coalesce(${encounter.orgUnitId}, ${visit.currentUnitId}, ${admission.currentUnitId})`,
    }).from(vitalSign)
      .leftJoin(encounter, eq(encounter.id, vitalSign.encounterId))
      .leftJoin(visit, eq(visit.id, vitalSign.visitId))
      .leftJoin(admission, eq(admission.id, vitalSign.admissionId))
      .where(eq(vitalSign.patientId, patientId))
      .orderBy(desc(vitalSign.recordedAt));
    const visible = [];
    for (const row of rows) {
      if (managedUnitIds !== null && (!row.orgUnitId || !managedUnitIds.includes(row.orgUnitId))) continue;
      try {
        await requireChart(req, patientId, row.orgUnitId);
        visible.push(row.vital);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error;
      }
    }
    res.json({ data: visible.slice(0, listLimit(req.query.limit, 100)) });
  } catch (error) { next(error); }
});

const orderSchema = z.object({
  orderType: z.enum(["LAB", "IMAGING", "PROCEDURE", "REFERRAL", "NURSING", "CONSULT_REQUEST", "DIET"]),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).default("ROUTINE"),
  serviceItemId: uuid.nullish().transform((value) => value ?? null),
  quantity: z.coerce.number().positive().max(1_000_000).default(1),
  clinicalIndication: optionalText(500),
  notes: optionalText(2000),
  overrides: overrideSchema,
});
const paymentGateEnabled = () => process.env.HAMS_PAY_BEFORE_SERVICE_OPD === "true";
const orderPaymentRequired = (visitRow: { payerType: string; visitType: string }, priority: string) =>
  paymentGateEnabled() && visitRow.payerType === "CASH" &&
  visitRow.visitType !== "EMERGENCY" && visitRow.visitType !== "INPATIENT" && priority !== "STAT";

router.post("/encounters/:id/orders", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(orderSchema, req.body);
    if (payload.serviceItemId) {
      const [service] = await db.select({ id: serviceItem.id }).from(serviceItem)
        .where(and(eq(serviceItem.id, payload.serviceItemId), eq(serviceItem.active, true))).limit(1);
      if (!service) throw validationError("Choose an active service.", "ORDER_SERVICE_INVALID");
    }
    const duplicate = await db.select({ id: clinicalOrder.id }).from(clinicalOrder).where(and(
      eq(clinicalOrder.encounterId, encounterId),
      eq(clinicalOrder.orderType, payload.orderType),
      eq(clinicalOrder.status, "ORDERED"),
      payload.serviceItemId
        ? eq(clinicalOrder.serviceItemId, payload.serviceItemId)
        : payload.clinicalIndication
          ? eq(clinicalOrder.clinicalIndication, payload.clinicalIndication)
          : isNull(clinicalOrder.serviceItemId),
    )).limit(1);
    const alerts = duplicate.length ? [{
      code: "DUPLICATE_ACTIVE_ORDER",
      severity: "STOP" as const,
      message: "An active order for this service already exists in this encounter.",
    }] : [];
    const safetyReasons = recordSafetyOverrides(alerts, payload.overrides);
    const [visitRow] = await db.select().from(visit).where(eq(visit.id, record.visitId)).limit(1);
    if (!visitRow) throw notFound("Visit not found.", "VISIT_NOT_FOUND");
    const clinician = await actorStaff(req);
    await ensureLicence(clinician.id);
    const [created] = await db.insert(clinicalOrder).values({
      orderNo: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      encounterId,
      patientId: record.patientId,
      visitId: record.visitId,
      orderType: payload.orderType,
      priority: payload.priority,
      status: "ORDERED",
      serviceItemId: payload.serviceItemId,
      quantity: String(payload.quantity),
      clinicalIndication: payload.clinicalIndication,
      notes: payload.notes,
      paymentRequired: orderPaymentRequired(visitRow, payload.priority),
      orderedByStaffId: clinician.id,
    }).returning();
    if (!created) throw new Error("Clinical order was not created.");
    await auditSafetyOverrides(req, record.patientId, encounterId, record.orgUnitId, alerts, safetyReasons);
    await writeAudit(req, {
      action: "CREATE", entityType: "clinical_order", entityId: created.id,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { orderType: created.orderType, priority: created.priority, paymentRequired: created.paymentRequired },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.post("/orders/:id/cancel", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const orderId = requestId(req, "id");
    const payload = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const [current] = await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, orderId)).limit(1);
    if (!current) throw notFound("Order not found.", "ORDER_NOT_FOUND");
    const record = await loadEncounter(req, current.encounterId);
    if (current.status !== "ORDERED") {
      throw conflict("Only an order that has not started can be cancelled. Request cancellation from the performing department.", "ORDER_CANCELLATION_REQUEST_REQUIRED");
    }
    const issuedMedication = current.orderType === "MEDICATION"
      ? await db.select({ id: prescription.id }).from(prescription).where(and(
        eq(prescription.orderId, orderId),
        inArray(prescription.status, ["ISSUED", "PARTIALLY_DISPENSED"]),
      )).limit(1)
      : [];
    if (issuedMedication.length) {
      throw conflict("Cancel an issued medication through the pharmacy workflow.", "PRESCRIPTION_CANCELLATION_REQUIRED");
    }
    await db.execute(sql`
      WITH cancelled_order AS (
        UPDATE clinical_order SET status = 'CANCELLED',
          cancelled_by = ${req.user?.id ?? null}, cancelled_reason = ${payload.reason}
        WHERE id = ${orderId}::uuid AND status = 'ORDERED'
        RETURNING id
      ),
      cancelled_prescriptions AS (
        UPDATE prescription SET status = 'CANCELLED'
        WHERE order_id IN (SELECT id FROM cancelled_order) AND status = 'DRAFT'
        RETURNING id
      ),
      cancelled_items AS (
        UPDATE prescription_item SET status = 'CANCELLED', stopped_reason = ${payload.reason}
        WHERE prescription_id IN (SELECT id FROM cancelled_prescriptions) AND status = 'ACTIVE'
        RETURNING id
      )
      SELECT id FROM cancelled_order
    `);
    const [updated] = await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, orderId)).limit(1);
    if (!updated || updated.status !== "CANCELLED") throw conflict("The order has already changed.", "ORDER_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "clinical_order", entityId: orderId,
      patientId: current.patientId, orgUnitId: record.orgUnitId, reason: payload.reason,
      before: { status: current.status }, after: { status: "CANCELLED" },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});
router.post("/orders/:id/payment-clearance", requireAnyRole(["super_admin", "hospital_admin", "cashier", "billing_officer"]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const payload = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const [current] = await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, id)).limit(1);
    if (!current) throw notFound("Order not found.", "ORDER_NOT_FOUND");
    if (!current.paymentRequired) throw conflict("This order does not require payment clearance.", "ORDER_PAYMENT_NOT_REQUIRED");
    if (current.paymentClearedAt) {
      const [clearanceAudit] = await db.select({ id: auditLog.id }).from(auditLog).where(and(
        eq(auditLog.action, "OVERRIDE"),
        eq(auditLog.entityType, "clinical_order"),
        eq(auditLog.entityId, id),
        sql`${auditLog.after} ? 'paymentClearedAt'`,
      )).limit(1);
      if (!clearanceAudit) {
        throw conflict("Payment clearance is missing its audit record and needs reconciliation.", "ORDER_PAYMENT_AUDIT_MISSING");
      }
      res.json({ data: { id: current.id, paymentCleared: true, paymentClearedAt: current.paymentClearedAt } });
      return;
    }
    await db.execute(sql`
      WITH cleared_order AS (
        UPDATE clinical_order SET payment_cleared_at = now()
        WHERE id = ${id}::uuid AND payment_required = true AND payment_cleared_at IS NULL
        RETURNING id, patient_id, payment_cleared_at
      ),
      clearance_audit AS (
        INSERT INTO audit_log (
          actor_user_id, actor_roles, action, entity_type, entity_id, patient_id,
          request_id, ip, user_agent, reason, before, after
        )
        SELECT ${req.user?.id ?? null}, ${sql.param(req.user?.roles ?? [], auditLog.actorRoles)}, 'OVERRIDE', 'clinical_order',
          cleared_order.id::text, cleared_order.patient_id, ${req.requestId ?? null},
          ${req.ip?.replace(/^::ffff:/, "") ?? null}::inet, ${req.get("user-agent") ?? null},
          ${payload.reason}, jsonb_build_object('paymentClearedAt', null),
          jsonb_build_object('paymentClearedAt', cleared_order.payment_cleared_at)
        FROM cleared_order
        RETURNING entity_id
      )
      SELECT cleared_order.id
      FROM cleared_order
      INNER JOIN clearance_audit ON clearance_audit.entity_id = cleared_order.id::text
    `);
    const [updated] = await db.select({
      id: clinicalOrder.id,
      paymentClearedAt: clinicalOrder.paymentClearedAt,
    }).from(clinicalOrder).where(and(eq(clinicalOrder.id, id), eq(clinicalOrder.paymentRequired, true)));
    if (!updated?.paymentClearedAt) throw conflict("Payment clearance changed while it was being recorded.", "ORDER_PAYMENT_STATE_CONFLICT");
    res.json({ data: { ...updated, paymentCleared: true } });
  } catch (error) { next(error); }
});
router.patch("/orders/:id/status", requireAnyRole([...DOCTORS, "lab_scientist", "radiographer", "pharmacist"]), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const payload = parseBody(z.object({
      status: z.enum(["IN_PROGRESS", "COMPLETED", "REJECTED"]),
      reason: optionalText(300),
    }), req.body);
    const [current] = await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, id)).limit(1);
    if (!current) throw notFound("Order not found.", "ORDER_NOT_FOUND");
    await loadEncounter(req, current.encounterId);
    const allowed = current.status === "ORDERED"
      ? ["IN_PROGRESS", "REJECTED"]
      : current.status === "IN_PROGRESS" ? ["COMPLETED", "REJECTED"] : [];
    if (!allowed.includes(payload.status)) throw conflict("This order transition is not allowed.", "ORDER_STATE_CONFLICT");
    if (current.paymentRequired && !current.paymentClearedAt && ["IN_PROGRESS", "COMPLETED"].includes(payload.status)) {
      throw conflict("Payment must be cleared before this order can proceed.", "ORDER_PAYMENT_REQUIRED");
    }
    const [updated] = await db.update(clinicalOrder).set({ status: payload.status })
      .where(and(eq(clinicalOrder.id, id), eq(clinicalOrder.status, current.status))).returning();
    if (!updated) throw conflict("The order has already changed.", "ORDER_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "clinical_order", entityId: id,
      patientId: current.patientId, reason: payload.reason,
      before: { status: current.status }, after: { status: updated.status },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

const drugForms = ["TABLET", "CAPSULE", "SYRUP", "SUSPENSION", "INJECTION", "IV_FLUID", "CREAM", "OINTMENT", "DROPS", "INHALER", "SUPPOSITORY", "OTHER"] as const;
const drugSchema = z.object({
  genericName: z.string().trim().min(1).max(200),
  brandName: optionalText(200),
  form: z.enum(drugForms),
  strengthValue: z.coerce.number().positive().nullish().transform((value) => value === undefined || value === null ? null : String(value)),
  strengthUnit: optionalText(15),
  strengthText: optionalText(60),
  defaultRoute: optionalText(15),
  atcCode: optionalText(10),
  nhisListed: z.boolean().default(false),
  essentialList: z.boolean().default(false),
  controlledClass: z.enum(["NONE", "SCHEDULE_2", "SCHEDULE_3", "SCHEDULE_4"]).default("NONE"),
  isHighAlert: z.boolean().default(false),
  isAntibiotic: z.boolean().default(false),
  otcAllowed: z.boolean().default(false),
  maxDailyDose: z.coerce.number().positive().nullish().transform((value) => value === undefined || value === null ? null : String(value)),
  doseUnit: optionalText(15),
  pregnancyCategory: z.string().trim().max(2).nullish().transform((value) => value ?? null),
  active: z.boolean().default(true),
});
router.get("/drugs", requireAnyRole(PHARMACY_READ), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) throw validationError("Enter at least 2 characters to search.", "SEARCH_TOO_SHORT");
    const rows = await db.select().from(drug).where(and(
      eq(drug.active, true),
      or(ilike(drug.genericName, `%${q}%`), ilike(drug.brandName, `%${q}%`), ilike(drug.strengthText, `%${q}%`)),
    )).orderBy(asc(drug.genericName)).limit(listLimit(req.query.limit));
    res.json({ data: rows });
  } catch (error) { next(error); }
});

const openFdaSearchSchema = z.object({
  q: z.string().trim().min(2).max(128),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const normalizeDrugText = (value: string | null | undefined) =>
  (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

const normalizeDrugStrength = (value: string | null | undefined) =>
  (value ?? "").trim().toLocaleLowerCase().replace(/\s*\/\s*1\b/g, "").replace(/[^a-z0-9.]/g, "");

const mapOpenFdaForm = (dosageForm: string | null) => {
  const form = (dosageForm ?? "").toLocaleUpperCase();
  if (form.includes("TABLET")) return "TABLET";
  if (form.includes("CAPSULE")) return "CAPSULE";
  if (form.includes("SYRUP")) return "SYRUP";
  if (form.includes("SUSPENSION")) return "SUSPENSION";
  if (/INTRAVENOUS.*(SOLUTION|FLUID)|(SOLUTION|FLUID).*INTRAVENOUS/.test(form)) return "IV_FLUID";
  if (form.includes("INJECTION") || form.includes("INJECTABLE")) return "INJECTION";
  if (form.includes("CREAM")) return "CREAM";
  if (form.includes("OINTMENT")) return "OINTMENT";
  if (form.includes("DROP")) return "DROPS";
  if (form.includes("INHALER") || form.includes("AEROSOL") || form.includes("INHALATION")) return "INHALER";
  if (form.includes("SUPPOSITORY")) return "SUPPOSITORY";
  return null;
};

const normalizeDrugRoute = (value: string | null | undefined) => {
  const route = (value ?? "").toLocaleUpperCase();
  if (/\bORAL\b|\bBY MOUTH\b|\bPO\b/.test(route)) return "ORAL";
  if (/\bIV\b|INTRAVENOUS/.test(route)) return "IV";
  if (/\bIM\b|INTRAMUSCULAR/.test(route)) return "IM";
  if (/SUBCUT|SUB-Q|\bSC\b/.test(route)) return "SC";
  if (/TOPICAL|CUTANEOUS/.test(route)) return "TOPICAL";
  if (/INHALATION|RESPIRATORY/.test(route)) return "INHALATION";
  if (/OPHTHALMIC/.test(route)) return "OPHTHALMIC";
  if (/OTIC/.test(route)) return "OTIC";
  return route.trim();
};

router.get("/medications/search", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const parsed = openFdaSearchSchema.safeParse({ q: req.query.q, limit: req.query.limit });
    if (!parsed.success) {
      throw badRequest("Invalid medication search parameters.", "OPEN_FDA_QUERY_INVALID", parsed.error.flatten());
    }

    const results = await searchOpenFdaMedications(parsed.data.q, parsed.data.limit ?? 8);
    const genericNames = Array.from(new Set(results
      .map((item) => normalizeDrugText(item.genericName))
      .filter(Boolean)));
    const brandNames = Array.from(new Set(results
      .map((item) => normalizeDrugText(item.name))
      .filter(Boolean)));
    const nameConditions = [];
    if (genericNames.length) nameConditions.push(inArray(sql<string>`lower(${drug.genericName})`, genericNames));
    if (brandNames.length) nameConditions.push(inArray(sql<string>`lower(${drug.brandName})`, brandNames));

    const localDrugs = nameConditions.length
      ? await db.select({
        id: drug.id,
        genericName: drug.genericName,
        brandName: drug.brandName,
        form: drug.form,
        strengthText: drug.strengthText,
        defaultRoute: drug.defaultRoute,
      }).from(drug).where(and(eq(drug.active, true), or(...nameConditions)))
      : [];

    const usedDrugIds = new Set<string>();
    const matched = results.flatMap((item) => {
      const form = mapOpenFdaForm(item.dosageForm);
      if (!form) return [];
      const match = localDrugs.find((candidate) => {
        const nameMatches = normalizeDrugText(candidate.genericName) === normalizeDrugText(item.genericName) ||
          normalizeDrugText(candidate.brandName) === normalizeDrugText(item.name);
        const route = normalizeDrugRoute(item.route);
        const localRoute = normalizeDrugRoute(candidate.defaultRoute);
        return nameMatches && candidate.form === form &&
          normalizeDrugStrength(candidate.strengthText) === normalizeDrugStrength(item.dose) &&
          (!route || !localRoute || route === localRoute);
      });
      if (!match || usedDrugIds.has(match.id)) return [];
      usedDrugIds.add(match.id);
      return [{
        id: match.id,
        name: item.name,
        genericName: item.genericName ?? match.genericName,
        productNdc: item.productNdc,
        dosageForm: item.dosageForm,
        labelerName: item.labelerName,
        route: match.defaultRoute ?? item.route,
        dose: item.dose,
      }];
    });
    res.json({ data: matched.slice(0, parsed.data.limit ?? 8) });
  } catch (error) { next(error); }
});

router.post("/drugs", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const payload = parseBody(drugSchema, req.body);
    const [created] = await db.insert(drug).values(payload).returning();
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.patch("/drugs/:id", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const payload = parsePresent(drugSchema.shape, req.body);
    if (Object.keys(payload).length === 0) throw validationError("Provide at least one drug field to update.", "PATCH_EMPTY");
    const [updated] = await db.update(drug).set(payload).where(eq(drug.id, id)).returning();
    if (!updated) throw notFound("Drug not found.", "DRUG_NOT_FOUND");
    res.json({ data: updated });
  } catch (error) { next(error); }
});
const drugImportSchema = z.object({
  source: z.enum(["EML", "NHIS"]),
  dryRun: z.boolean().default(true),
  rows: z.array(drugSchema.partial().extend({
    genericName: z.string().trim().min(1).max(200),
    form: z.enum(drugForms),
  })).min(1).max(10_000),
});
router.post("/drugs/import", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const payload = parseBody(drugImportSchema, req.body);
    const uniqueRows = payload.rows.filter((row, index, list) =>
      list.findIndex((other) => other.genericName.toLowerCase() === row.genericName.toLowerCase() &&
        other.form === row.form && other.strengthText === row.strengthText) === index);
    const names = Array.from(new Set(uniqueRows.map((row) => row.genericName.toLowerCase())));
    const existing = names.length
      ? await db.select({
        genericName: drug.genericName,
        form: drug.form,
        strengthText: drug.strengthText,
      }).from(drug).where(inArray(sql<string>`lower(${drug.genericName})`, names))
      : [];
    const existingKeys = new Set(existing.map((row) =>
      `${row.genericName.toLowerCase()}|${row.form}|${row.strengthText ?? ""}`));
    const newRows = uniqueRows.filter((row) =>
      !existingKeys.has(`${row.genericName.toLowerCase()}|${row.form}|${row.strengthText ?? ""}`));
    let imported = 0;
    if (!payload.dryRun && newRows.length > 0) {
      const inserted = await db.insert(drug).values(newRows.map((row) => ({
        ...drugSchema.parse({
          ...row,
          nhisListed: payload.source === "NHIS" || row.nhisListed,
          essentialList: payload.source === "EML" || row.essentialList,
        }),
      }))).onConflictDoNothing().returning({ id: drug.id });
      imported = inserted.length;
    }
    res.json({ data: {
      dryRun: payload.dryRun,
      source: payload.source,
      validRows: newRows.length,
      imported,
      duplicatesSkipped: payload.rows.length - newRows.length,
    } });
  } catch (error) { next(error); }
});

const interactionSchema = z.object({
  genericA: z.string().trim().min(1).max(200).transform((value) => value.toLocaleLowerCase()),
  genericB: z.string().trim().min(1).max(200).transform((value) => value.toLocaleLowerCase()),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR", "CONTRAINDICATED"]),
  effect: optionalText(500),
  management: optionalText(500),
  source: optionalText(100),
}).refine((value) => value.genericA.localeCompare(value.genericB) < 0, {
  message: "Generic A must sort before Generic B.",
  path: ["genericA"],
});
const interactionPatchSchema = z.object({
  genericA: z.string().trim().min(1).max(200).transform((value) => value.toLocaleLowerCase()).optional(),
  genericB: z.string().trim().min(1).max(200).transform((value) => value.toLocaleLowerCase()).optional(),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR", "CONTRAINDICATED"]).optional(),
  effect: optionalText(500).optional(),
  management: optionalText(500).optional(),
  source: optionalText(100).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: "Provide at least one interaction field to update.",
});
router.get("/drug-interactions", requireAnyRole(PHARMACY_READ), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const where = q ? or(ilike(drugInteraction.genericA, `%${q}%`), ilike(drugInteraction.genericB, `%${q}%`)) : undefined;
    res.json({ data: await db.select().from(drugInteraction).where(where).orderBy(asc(drugInteraction.genericA), asc(drugInteraction.genericB)).limit(listLimit(req.query.limit, 100)) });
  } catch (error) { next(error); }
});
router.post("/drug-interactions", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const payload = parseBody(interactionSchema, req.body);
    const [created] = await db.insert(drugInteraction).values(payload).returning();
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.patch("/drug-interactions/:id", requireAnyRole(ADMIN), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(drugInteraction).where(eq(drugInteraction.id, id)).limit(1);
    if (!current) throw notFound("Drug interaction not found.", "DRUG_INTERACTION_NOT_FOUND");
    const patch = parseBody(interactionPatchSchema, req.body);
    parseBody(interactionSchema, { ...current, ...patch });
    const conditions = [
      eq(drugInteraction.id, id),
      eq(drugInteraction.genericA, current.genericA),
      eq(drugInteraction.genericB, current.genericB),
    ];
    const [updated] = await db.update(drugInteraction).set(patch).where(and(...conditions)).returning();
    if (!updated) {
      const [stillExists] = await db.select({ id: drugInteraction.id }).from(drugInteraction)
        .where(eq(drugInteraction.id, id)).limit(1);
      if (stillExists) throw conflict("The interaction pair changed while it was being updated.", "DRUG_INTERACTION_CHANGED");
      throw notFound("Drug interaction not found.", "DRUG_INTERACTION_NOT_FOUND");
    }
    res.json({ data: updated });
  } catch (error) { next(error); }
});

const prescriptionItemSchema = z.object({
  drugId: uuid,
  dose: z.coerce.number().positive().max(1_000_000),
  doseUnit: z.string().trim().min(1).max(15),
  frequencyCode: z.enum(["OD", "BD", "TDS", "QID", "Q4H", "Q6H", "Q8H", "Q12H", "NOCTE", "STAT", "PRN", "WEEKLY"]),
  route: z.string().trim().min(1).max(15),
  durationDays: z.coerce.number().int().positive().max(365).nullish().transform((value) => value ?? null),
  quantityPrescribed: z.coerce.number().positive().max(1_000_000),
  isPrn: z.boolean().default(false),
  prnReason: optionalText(200),
  instructions: optionalText(300),
  indication: optionalText(200),
  substitutionAllowed: z.boolean().default(true),
}).refine((item) => !item.isPrn || Boolean(item.prnReason), {
  message: "A reason is required for PRN medication.",
  path: ["prnReason"],
});
const prescriptionCreateSchema = z.object({
  notes: optionalText(500),
  validUntil: dateOnly,
  items: z.array(prescriptionItemSchema).min(1).max(50),
  overrides: overrideSchema,
});

router.post("/encounters/:id/prescriptions", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(prescriptionCreateSchema, req.body);
    if (payload.validUntil < new Date().toISOString().slice(0, 10)) {
      throw validationError("Prescription expiry cannot be in the past.", "PRESCRIPTION_EXPIRY_INVALID");
    }
    const clinician = await actorStaff(req);
    const licence = await ensureLicence(clinician.id);
    const visitRow = await loadVisit(req, record.visitId);
    const drugRows = await db.select().from(drug)
      .where(and(eq(drug.active, true), inArray(drug.id, payload.items.map((item) => item.drugId))));
    if (drugRows.length !== new Set(payload.items.map((item) => item.drugId)).size) {
      throw validationError("One or more selected medicines are inactive or unavailable.", "PRESCRIPTION_DRUG_INVALID");
    }
    const allergies = await db.select({
      drugId: patientAllergy.drugId,
      substance: patientAllergy.substance,
      severity: patientAllergy.severity,
    }).from(patientAllergy).where(and(
      eq(patientAllergy.patientId, record.patientId),
      eq(patientAllergy.status, "ACTIVE"),
    ));
    const activeMedicationRows = await db.select({ genericName: drug.genericName })
      .from(prescriptionItem)
      .innerJoin(prescription, eq(prescription.id, prescriptionItem.prescriptionId))
      .innerJoin(drug, eq(drug.id, prescriptionItem.drugId))
      .where(and(eq(prescription.patientId, record.patientId), inArray(prescription.status, ["ISSUED", "PARTIALLY_DISPENSED"])));
    const alerts: Array<{ code: string; severity: "STOP" | "WARN"; message: string }> = [];
    for (const prescribed of payload.items) {
      const itemDrug = drugRows.find((candidate) => candidate.id === prescribed.drugId);
      if (!itemDrug) continue;
      const interactingGenerics = Array.from(new Set([
        ...activeMedicationRows.map((item) => item.genericName.toLocaleLowerCase()),
        ...payload.items
          .filter((other) => other.drugId !== itemDrug.id)
          .map((other) => drugRows.find((candidate) => candidate.id === other.drugId)?.genericName.toLocaleLowerCase())
          .filter((name): name is string => Boolean(name)),
      ]));
      const interactions = interactingGenerics.length
        ? await db.select().from(drugInteraction).where(or(
          and(eq(sql<string>`lower(${drugInteraction.genericA})`, itemDrug.genericName.toLocaleLowerCase()),
            inArray(sql<string>`lower(${drugInteraction.genericB})`, interactingGenerics)),
          and(eq(sql<string>`lower(${drugInteraction.genericB})`, itemDrug.genericName.toLocaleLowerCase()),
            inArray(sql<string>`lower(${drugInteraction.genericA})`, interactingGenerics)),
        ))
        : [];
      alerts.push(...evaluateDrugSafety({
        drug: { id: itemDrug.id, genericName: itemDrug.genericName },
        allergies,
        activeDrugs: interactingGenerics,
        interactions,
      }));
      if (activeMedicationRows.some((active) => active.genericName.toLocaleLowerCase() === itemDrug.genericName.toLocaleLowerCase())) {
        alerts.push({
          code: `DUPLICATE_MEDICATION_${itemDrug.id}`,
          severity: "STOP",
          message: `${itemDrug.genericName} is already on an active prescription.`,
        });
      }
    }
    const reasons = recordSafetyOverrides(alerts, payload.overrides);
    const items = payload.items.map((item) => {
      const matchingDrug = drugRows.find((candidate) => candidate.id === item.drugId);
      const alert = alerts.find((candidate) => matchingDrug &&
        candidate.message.toLocaleLowerCase().includes(matchingDrug.genericName.toLocaleLowerCase()));
      return {
        ...item,
        alertOverrideReason: alert ? reasons.get(alert.code) ?? null : null,
      };
    });
    const orderId = randomUUID();
    const prescriptionId = randomUUID();
    const orderNo = `ORD-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const rxNo = `RX-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const rowsJson = JSON.stringify(items.map((item) => ({
      drug_id: item.drugId,
      dose: String(item.dose),
      dose_unit: item.doseUnit,
      frequency_code: item.frequencyCode,
      route: item.route,
      duration_days: item.durationDays,
      quantity_prescribed: String(item.quantityPrescribed),
      is_prn: item.isPrn,
      prn_reason: item.prnReason,
      instructions: item.instructions,
      indication: item.indication,
      substitution_allowed: item.substitutionAllowed,
      alert_override_reason: item.alertOverrideReason,
    })));
    const paymentRequired = orderPaymentRequired(visitRow, payload.items.some((item) => item.frequencyCode === "STAT") ? "STAT" : "ROUTINE");
    await db.execute(sql`
      WITH created_order AS (
        INSERT INTO clinical_order (
          id, order_no, encounter_id, patient_id, visit_id, order_type, priority, status,
          quantity, clinical_indication, notes, payment_required, ordered_by_staff_id
        ) VALUES (
          ${orderId}::uuid, ${orderNo}, ${encounterId}::uuid, ${record.patientId}::uuid, ${record.visitId}::uuid,
          'MEDICATION', ${payload.items.some((item) => item.frequencyCode === "STAT") ? "STAT" : "ROUTINE"},
          'ORDERED', ${items.length}, ${payload.notes}, ${payload.notes}, ${paymentRequired}, ${clinician.id}::uuid
        ) RETURNING id
      ),
      created_prescription AS (
        INSERT INTO prescription (
          id, rx_no, order_id, encounter_id, patient_id, visit_id, prescriber_staff_id,
          prescriber_licence_no, status, valid_until, notes
        ) SELECT ${prescriptionId}::uuid, ${rxNo}, id, ${encounterId}::uuid, ${record.patientId}::uuid,
          ${record.visitId}::uuid, ${clinician.id}::uuid, ${licence.licenceNo}, 'DRAFT',
          ${payload.validUntil}, ${payload.notes}
        FROM created_order RETURNING id
      ),
      created_items AS (
        INSERT INTO prescription_item (
          prescription_id, drug_id, dose, dose_unit, frequency_code, route, duration_days,
          quantity_prescribed, is_prn, prn_reason, instructions, indication,
          substitution_allowed, alert_override_reason
        )
        SELECT created_prescription.id, item.drug_id::uuid, item.dose::numeric, item.dose_unit,
          item.frequency_code, item.route, item.duration_days::smallint, item.quantity_prescribed::numeric,
          item.is_prn, item.prn_reason, item.instructions, item.indication,
          item.substitution_allowed, item.alert_override_reason
        FROM created_prescription
        CROSS JOIN jsonb_to_recordset(${rowsJson}::jsonb) AS item(
          drug_id text, dose text, dose_unit text, frequency_code text, route text, duration_days text,
          quantity_prescribed text, is_prn boolean, prn_reason text, instructions text, indication text,
          substitution_allowed boolean, alert_override_reason text
        )
        RETURNING id
      )
      SELECT id FROM created_prescription
    `);
    const [created] = await db.select().from(prescription).where(eq(prescription.id, prescriptionId)).limit(1);
    if (!created) throw new Error("Prescription was not created.");
    await auditSafetyOverrides(req, record.patientId, encounterId, record.orgUnitId, alerts, reasons);
    await writeAudit(req, {
      action: "CREATE", entityType: "prescription", entityId: prescriptionId,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { status: "DRAFT", itemCount: items.length, orderId },
    });
    res.status(201).json({ data: { ...created, items: await db.select().from(prescriptionItem).where(eq(prescriptionItem.prescriptionId, prescriptionId)) } });
  } catch (error) { next(error); }
});

router.post("/prescriptions/:id/issue", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [current] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!current) throw notFound("Prescription not found.", "PRESCRIPTION_NOT_FOUND");
    const record = await loadEncounter(req, current.encounterId);
    const clinician = await actorStaff(req);
    const licence = await ensureLicence(clinician.id);
    if (current.prescriberStaffId !== clinician.id) throw forbidden("Only the prescriber may issue this prescription.", "PRESCRIBER_MISMATCH");
    if (current.status !== "DRAFT") throw conflict("Only draft prescriptions can be issued.", "PRESCRIPTION_STATE_CONFLICT");
    if (current.validUntil && current.validUntil < new Date().toISOString().slice(0, 10)) {
      throw validationError("An expired prescription cannot be issued.", "PRESCRIPTION_EXPIRED");
    }
    const items = await db.select({ id: prescriptionItem.id }).from(prescriptionItem)
      .where(and(eq(prescriptionItem.prescriptionId, id), eq(prescriptionItem.status, "ACTIVE"))).limit(1);
    if (!items.length) throw validationError("Add at least one active medication before issuing.", "PRESCRIPTION_EMPTY");
    const [relatedOrder] = current.orderId
      ? await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, current.orderId)).limit(1)
      : [];
    if (current.orderId && !relatedOrder) throw conflict("The medication order is unavailable.", "ORDER_NOT_FOUND");
    if (relatedOrder && !["ORDERED", "IN_PROGRESS"].includes(relatedOrder.status)) {
      throw conflict("The medication order is no longer ready to issue.", "ORDER_STATE_CONFLICT");
    }
    if (relatedOrder?.paymentRequired && !relatedOrder.paymentClearedAt) {
      throw conflict("Payment must be cleared before this prescription can be issued.", "ORDER_PAYMENT_REQUIRED");
    }
    await db.execute(sql`
      WITH progressed_order AS (
        UPDATE clinical_order SET status = 'IN_PROGRESS'
        WHERE id = ${current.orderId}::uuid AND status IN ('ORDERED', 'IN_PROGRESS')
          AND (payment_required = false OR payment_cleared_at IS NOT NULL)
        RETURNING id
      ),
      issued_prescription AS (
        UPDATE prescription SET status = 'ISSUED', issued_at = now(),
          prescriber_licence_no = ${licence.licenceNo}
        WHERE id = ${id}::uuid AND status = 'DRAFT'
          AND (order_id IS NULL OR order_id IN (SELECT id FROM progressed_order))
        RETURNING id
      )
      SELECT id FROM issued_prescription
    `);
    const [updated] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!updated) throw conflict("The prescription has already changed.", "PRESCRIPTION_STATE_CONFLICT");
    if (updated.status !== "ISSUED") throw conflict("The prescription order is no longer ready to issue.", "PRESCRIPTION_STATE_CONFLICT");
    await writeAudit(req, {
      action: "APPROVE", entityType: "prescription", entityId: id,
      patientId: current.patientId, orgUnitId: record.orgUnitId,
      after: { status: "ISSUED", licenceNo: licence.licenceNo },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});
router.post("/prescriptions/:id/cancel", requireAnyRole(PHARMACY_WRITE), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const payload = parseBody(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    const [current] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!current) throw notFound("Prescription not found.", "PRESCRIPTION_NOT_FOUND");
    const record = await loadEncounter(req, current.encounterId);
    if (!["DRAFT", "ISSUED", "PARTIALLY_DISPENSED"].includes(current.status)) {
      throw conflict("This prescription cannot be cancelled.", "PRESCRIPTION_STATE_CONFLICT");
    }
    if (current.orderId) {
      const [relatedOrder] = await db.select().from(clinicalOrder).where(eq(clinicalOrder.id, current.orderId)).limit(1);
      if (!relatedOrder || !["ORDERED", "IN_PROGRESS"].includes(relatedOrder.status)) {
        throw conflict("The medication order can no longer be cancelled.", "ORDER_STATE_CONFLICT");
      }
    }
    const cancellation = await db.execute(sql<{ id: string; prior_status: string }>`
      WITH locked_order AS MATERIALIZED (
        SELECT orders.id, orders.status
        FROM clinical_order AS orders
        WHERE orders.id = ${current.orderId}::uuid
        FOR UPDATE OF orders
      ),
      locked_prescription AS MATERIALIZED (
        SELECT rx.id, rx.order_id, rx.status, rx.valid_until
        FROM prescription AS rx
        LEFT JOIN locked_order AS orders ON orders.id = rx.order_id
        WHERE rx.id = ${id}::uuid
          AND (rx.order_id IS NULL OR orders.id IS NOT NULL)
        FOR UPDATE OF rx
      ),
      eligible_prescription AS MATERIALIZED (
        SELECT rx.id, rx.order_id, rx.status
        FROM locked_prescription AS rx
        LEFT JOIN locked_order AS orders ON orders.id = rx.order_id
        WHERE rx.status IN ('DRAFT', 'ISSUED', 'PARTIALLY_DISPENSED')
          AND (rx.valid_until IS NULL OR rx.valid_until >= CURRENT_DATE)
          AND (rx.order_id IS NULL OR orders.status IN ('ORDERED', 'IN_PROGRESS'))
      ),
      cancelled_order AS (
        UPDATE clinical_order AS orders SET status = 'CANCELLED',
          cancelled_by = ${req.user?.id ?? null}, cancelled_reason = ${payload.reason}
        FROM eligible_prescription AS eligible
        WHERE eligible.order_id = orders.id AND orders.status IN ('ORDERED', 'IN_PROGRESS')
        RETURNING orders.id
      ),
      cancelled_prescription AS (
        UPDATE prescription AS rx SET status = 'CANCELLED'
        FROM eligible_prescription AS eligible
        WHERE rx.id = eligible.id
          AND (rx.order_id IS NULL OR rx.order_id IN (SELECT id FROM cancelled_order))
        RETURNING rx.id, eligible.status AS prior_status
      ),
      cancelled_items AS (
        UPDATE prescription_item SET status = 'CANCELLED', stopped_reason = ${payload.reason}
        WHERE prescription_id IN (SELECT id FROM cancelled_prescription) AND status = 'ACTIVE'
        RETURNING id
      )
      SELECT id, prior_status FROM cancelled_prescription
    `);
    if (!cancellation.rows[0]) {
      throw conflict("The prescription or linked order changed before cancellation.", "PRESCRIPTION_STATE_CONFLICT");
    }
    const [updated] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!updated || updated.status !== "CANCELLED") throw conflict("The prescription has already changed.", "PRESCRIPTION_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "prescription", entityId: id, patientId: current.patientId,
      orgUnitId: record.orgUnitId, reason: payload.reason,
      before: { status: cancellation.rows[0].prior_status }, after: { status: "CANCELLED" },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});
router.get("/prescriptions/:id", requireAnyRole(PHARMACY_READ), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [record] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!record) throw notFound("Prescription not found.", "PRESCRIPTION_NOT_FOUND");
    await loadEncounter(req, record.encounterId);
    res.json({ data: { ...record, items: await db.select().from(prescriptionItem).where(eq(prescriptionItem.prescriptionId, id)) } });
  } catch (error) { next(error); }
});

export const expirePrescriptions = async () => {
  const updated = await db.update(prescription).set({ status: "EXPIRED" })
    .where(and(inArray(prescription.status, ["ISSUED", "PARTIALLY_DISPENSED"]), sql`${prescription.validUntil} < current_date`))
    .returning({ id: prescription.id, patientId: prescription.patientId });
  return updated.length;
};

const referralSchema = z.object({
  facilityName: optionalText(200),
  toUnitId: uuid.nullish().transform((value) => value ?? null),
  specialty: optionalText(100),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE"),
  reason: z.string().trim().min(1).max(500),
});
router.post("/encounters/:id/referrals", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(referralSchema, req.body);
    const clinician = await actorStaff(req);
    const [created] = await db.insert(referral).values({
      patientId: record.patientId,
      visitId: record.visitId,
      direction: "OUT",
      ...payload,
      createdByStaffId: clinician.id,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "referral", entityId: created?.id ?? null,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { direction: "OUT", urgency: payload.urgency },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.get("/referrals/:id", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [record] = await db.select().from(referral).where(eq(referral.id, id)).limit(1);
    if (!record) throw notFound("Referral not found.", "REFERRAL_NOT_FOUND");
    const visitRow = record.visitId ? await loadVisit(req, record.visitId) : null;
    if (visitRow && visitRow.patientId !== record.patientId) {
      throw notFound("Referral not found.", "REFERRAL_NOT_FOUND");
    }
    if (!visitRow) await requireChart(req, record.patientId, null);
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "referral", entityId: id,
      patientId: record.patientId, orgUnitId: visitRow?.currentUnitId ?? null,
    });
    res.json({ data: record });
  } catch (error) { next(error); }
});

router.post("/encounters/:id/disposition", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    assertOpenEncounter(record);
    const payload = parseBody(dispositionSchema, req.body);
    const clinician = await actorStaff(req);
    if (payload.disposition === "REFERRED_OUT") {
      const [ref] = await db.select({ id: referral.id }).from(referral).where(and(
        eq(referral.id, payload.referralId!),
        eq(referral.patientId, record.patientId),
        eq(referral.visitId, record.visitId),
        eq(referral.direction, "OUT"),
      )).limit(1);
      if (!ref) throw validationError("Create an outgoing referral for this visit first.", "REFERRAL_REQUIRED");
    }
    if (payload.disposition === "ADMITTED") {
      const bedRequestId = randomUUID();
      const admission = await db.execute(sql<{ id: string }>`
        WITH locked_encounter AS MATERIALIZED (
          SELECT id, patient_id, visit_id
          FROM encounter
          WHERE id = ${encounterId}::uuid AND status = 'OPEN'
          FOR UPDATE
        ),
        updated_encounter AS (
          UPDATE encounter AS target SET disposition = 'ADMITTED'
          FROM locked_encounter
          WHERE target.id = locked_encounter.id AND target.status = 'OPEN'
          RETURNING target.patient_id, target.visit_id
        ),
        updated_visit AS (
          UPDATE visit SET status = 'ADMITTED', disposition = 'ADMITTED'
          WHERE id IN (SELECT visit_id FROM updated_encounter)
          RETURNING id
        ),
        new_request AS (
          INSERT INTO bed_request (
            id, patient_id, visit_id, requested_unit_id, priority, clinical_summary, requested_by_staff_id
          )
          SELECT ${bedRequestId}::uuid, updated_encounter.patient_id, updated_encounter.visit_id,
            ${payload.requestedUnitId}::uuid, 'ROUTINE', ${payload.clinicalSummary}, ${clinician.id}::uuid
          FROM updated_encounter
          INNER JOIN updated_visit ON updated_visit.id = updated_encounter.visit_id
          RETURNING id
        )
        SELECT id FROM new_request
      `);
      if (!admission.rows[0]) throw conflict("The encounter has already changed.", "ENCOUNTER_STATE_CONFLICT");
      await writeAudit(req, {
        action: "STATUS_CHANGE", entityType: "encounter", entityId: encounterId,
        patientId: record.patientId, orgUnitId: record.orgUnitId,
        after: { disposition: "ADMITTED", bedRequestId },
      });
      res.json({ data: { disposition: "ADMITTED", bedRequestId } });
      return;
    }
    await db.execute(sql`
      WITH updated_encounter AS (
        UPDATE encounter SET disposition = ${payload.disposition},
          follow_up_date = ${payload.disposition === "FOLLOW_UP" ? payload.followUpDate : null}
        WHERE id = ${encounterId}::uuid AND status = 'OPEN'
        RETURNING visit_id
      )
      UPDATE visit SET
        disposition = ${payload.disposition},
        referral_id = CASE WHEN ${payload.disposition} = 'REFERRED_OUT' THEN ${payload.referralId}::uuid ELSE referral_id END
      WHERE id IN (SELECT visit_id FROM updated_encounter)
    `);
    const [updated] = await db.select().from(encounter).where(eq(encounter.id, encounterId)).limit(1);
    if (!updated || updated.disposition !== payload.disposition) throw conflict("The encounter has already changed.", "ENCOUNTER_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "encounter", entityId: encounterId,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { disposition: updated.disposition },
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

const certificateSchema = z.object({
  certType: z.enum(["SICK_LEAVE", "FITNESS", "ATTENDANCE", "MATERNITY"]),
  fromDate: dateOnly,
  toDate: dateOnly.nullish().transform((value) => value ?? null),
  remarks: optionalText(500),
}).refine((value) => !value.toDate || value.toDate >= value.fromDate, {
  message: "The end date must be on or after the start date.",
  path: ["toDate"],
});
router.post("/encounters/:id/medical-certificates", requireAnyRole(DOCTORS), async (req, res, next) => {
  try {
    const encounterId = requestId(req, "id");
    const record = await loadEncounter(req, encounterId);
    const payload = parseBody(certificateSchema, req.body);
    const clinician = await actorStaff(req);
    const licence = await ensureLicence(clinician.id);
    void licence;
    const [created] = await db.insert(medicalCertificate).values({
      certificateNo: `CERT-${new Date().getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
      verificationCode: randomBytes(6).toString("hex").toUpperCase(),
      patientId: record.patientId,
      encounterId,
      ...payload,
      issuedByStaffId: clinician.id,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "medical_certificate", entityId: created?.id ?? null,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { certType: payload.certType, fromDate: payload.fromDate, toDate: payload.toDate },
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});
router.get("/medical-certificates/:id", requireAnyRole(CLINICAL_READ), async (req, res, next) => {
  try {
    const id = requestId(req, "id");
    const [record] = await db.select().from(medicalCertificate).where(eq(medicalCertificate.id, id)).limit(1);
    if (!record) throw notFound("Medical certificate not found.", "CERTIFICATE_NOT_FOUND");
    const encounterRow = await loadEncounter(req, record.encounterId);
    if (encounterRow.patientId !== record.patientId) {
      throw notFound("Medical certificate not found.", "CERTIFICATE_NOT_FOUND");
    }
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "medical_certificate", entityId: id,
      patientId: record.patientId, orgUnitId: encounterRow.orgUnitId,
    });
    res.json({ data: record });
  } catch (error) { next(error); }
});

export default router;
