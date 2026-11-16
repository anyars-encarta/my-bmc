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
import { conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { calculateEws, evaluateDrugSafety, ewsRulesSchema } from "../../lib/clinicalSafety.js";
import { assertChartAccess, patientActor } from "../../lib/patientAccess.js";
import { requireAnyRole } from "../../lib/platform.js";

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
const diagnosisSchema = z.object({
  icd10Code: z.string().trim().min(1).max(10),
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
    context.addIssue({ code: "custom", path: ["rules"], message: "Provide valid, governance-approved scoring ranges." });
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
    const rows = await db.select().from(triageAssessment).where(eq(triageAssessment.visitId, visitId))
      .orderBy(desc(triageAssessment.assessedAt));
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "triage_assessment", entityId: null,
      patientId: visitRow.patientId, orgUnitId: visitRow.currentUnitId,
    });
    res.json({ data: rows });
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
    const status = typeof req.query.status === "string" ? req.query.status : "OPEN";
    const rows = await db.select({
      task: outpatientTask,
      patientName: sql<string>`concat(${patient.firstName}, ' ', ${patient.lastName})`,
      mrn: patient.mrn,
      unitName: orgUnit.name,
    }).from(outpatientTask)
      .innerJoin(patient, eq(patient.id, outpatientTask.patientId))
      .innerJoin(orgUnit, eq(orgUnit.id, outpatientTask.orgUnitId))
      .where(status === "ALL" ? undefined : eq(outpatientTask.status, status))
      .orderBy(desc(outpatientTask.priority), asc(outpatientTask.createdAt))
      .limit(listLimit(req.query.limit, 50));
    const visible = [];
    for (const row of rows) {
      await requireChart(req, row.task.patientId, row.task.orgUnitId);
      visible.push(row);
    }
    if (visible.length) {
      await db.insert(auditLog).values(visible.map((row) => ({
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
    res.json({ data: visible });
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
    if (visitRow.status !== "OPEN") throw conflict("The visit is closed.", "VISIT_CLOSED");
    if (!visitRow.currentUnitId) throw validationError("The visit needs a clinical unit.", "VISIT_UNIT_REQUIRED");
    const clinician = await actorStaff(req);
    const [created] = await db.insert(encounter).values({
      visitId,
      patientId: visitRow.patientId,
      encounterType: payload.encounterType,
      providerStaffId: clinician.id,
      orgUnitId: visitRow.currentUnitId,
      chiefComplaint: payload.chiefComplaint,
    }).returning();
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
    const payload = parseBody(noteSchema.partial(), req.body);
    const author = await actorStaff(req);
    if (current.authoredByStaffId !== author.id) throw forbidden("Only the note author can edit this draft.", "NOTE_AUTHOR_REQUIRED");
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
    const payload = parseBody(noteSchema.pick({ body: true, sensitivity: true }).extend({
      body: z.string().trim().min(1).max(20_000),
    }), req.body);
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
  if (last[0]?.id === record.id && !record.disposition) {
    throw validationError("Set the visit disposition before signing the last encounter.", "ENCOUNTER_DISPOSITION_REQUIRED");
  }
  const signer = await actorStaff(req);
  const licence = await ensureLicence(signer.id);
  await db.execute(sql`
    WITH signed_encounter AS (
      UPDATE encounter SET status = 'SIGNED', signed_at = now(),
        signed_by_staff_id = ${signer.id}::uuid, ended_at = now()
      WHERE id = ${encounterId}::uuid AND status = 'OPEN'
      RETURNING id
    ),
    signed_notes AS (
      UPDATE clinical_note SET status = 'SIGNED', signed_at = now(), signer_licence_no = ${licence.licenceNo}
      WHERE encounter_id IN (SELECT id FROM signed_encounter) AND status = 'DRAFT'
      RETURNING id
    )
    SELECT id FROM signed_encounter
  `);
  const [updated] = await db.select().from(encounter).where(eq(encounter.id, encounterId)).limit(1);
  if (!updated || updated.status !== "SIGNED") throw conflict("The encounter has already changed.", "CONCURRENT_MODIFICATION");
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
    const [code] = await db.select().from(icd10Code)
      .where(and(eq(icd10Code.code, payload.icd10Code), eq(icd10Code.active, true))).limit(1);
    if (!code) throw validationError("Select an active ICD-10 diagnosis.", "ICD10_CODE_INVALID");
    const [created] = await db.insert(diagnosis).values({
      encounterId,
      patientId: record.patientId,
      icd10Code: code.code,
      description: code.title,
      diagnosisType: payload.diagnosisType,
      certainty: payload.certainty,
      isNewCase: payload.isNewCase,
      onsetDate: payload.onsetDate,
      notedByStaffId: (await actorStaff(req)).id,
    }).returning();
    await writeAudit(req, {
      action: "CREATE", entityType: "diagnosis", entityId: created?.id ?? null,
      patientId: record.patientId, orgUnitId: record.orgUnitId,
      after: { icd10Code: code.code, diagnosisType: payload.diagnosisType },
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
    const rows = await db.select().from(vitalSign).where(eq(vitalSign.patientId, patientId))
      .orderBy(desc(vitalSign.recordedAt)).limit(listLimit(req.query.limit, 100));
    res.json({ data: rows });
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
      payload.serviceItemId ? eq(clinicalOrder.serviceItemId, payload.serviceItemId) : isNull(clinicalOrder.serviceItemId),
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
    const [updated] = await db.update(clinicalOrder).set({
      status: "CANCELLED",
      cancelledBy: req.user?.id ?? null,
      cancelledReason: payload.reason,
    }).where(and(eq(clinicalOrder.id, orderId), eq(clinicalOrder.status, "ORDERED"))).returning();
    if (!updated) throw conflict("The order has already changed.", "ORDER_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "clinical_order", entityId: orderId,
      patientId: current.patientId, orgUnitId: record.orgUnitId, reason: payload.reason,
      before: { status: current.status }, after: { status: "CANCELLED" },
    });
    res.json({ data: updated });
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
    const payload = parseBody(drugSchema.partial(), req.body);
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
    if (!payload.dryRun) {
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
  genericA: z.string().trim().min(1).max(200),
  genericB: z.string().trim().min(1).max(200),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR", "CONTRAINDICATED"]),
  effect: optionalText(500),
  management: optionalText(500),
  source: optionalText(100),
}).refine((value) => value.genericA.localeCompare(value.genericB) < 0, {
  message: "Generic A must sort before Generic B.",
  path: ["genericA"],
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
    const payload = parseBody(interactionSchema.partial(), req.body);
    const [updated] = await db.update(drugInteraction).set(payload).where(eq(drugInteraction.id, id)).returning();
    if (!updated) throw notFound("Drug interaction not found.", "DRUG_INTERACTION_NOT_FOUND");
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
        ...activeMedicationRows.map((item) => item.genericName),
        ...payload.items
          .filter((other) => other.drugId !== itemDrug.id)
          .map((other) => drugRows.find((candidate) => candidate.id === other.drugId)?.genericName)
          .filter((name): name is string => Boolean(name)),
      ]));
      const interactions = interactingGenerics.length
        ? await db.select().from(drugInteraction).where(or(
          and(eq(drugInteraction.genericA, itemDrug.genericName), inArray(drugInteraction.genericB, interactingGenerics)),
          and(eq(drugInteraction.genericB, itemDrug.genericName), inArray(drugInteraction.genericA, interactingGenerics)),
        ))
        : [];
      alerts.push(...evaluateDrugSafety({
        drug: { id: itemDrug.id, genericName: itemDrug.genericName },
        allergies,
        activeDrugs: interactingGenerics,
        interactions,
      }));
      if (activeMedicationRows.some((active) => active.genericName.toLowerCase() === itemDrug.genericName.toLowerCase())) {
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
    const [updated] = await db.update(prescription).set({
      status: "ISSUED",
      issuedAt: new Date(),
      prescriberLicenceNo: licence.licenceNo,
    }).where(and(eq(prescription.id, id), eq(prescription.status, "DRAFT"))).returning();
    if (!updated) throw conflict("The prescription has already changed.", "PRESCRIPTION_STATE_CONFLICT");
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
    await db.execute(sql`
      WITH cancelled_prescription AS (
        UPDATE prescription SET status = 'CANCELLED'
        WHERE id = ${id}::uuid AND status IN ('DRAFT', 'ISSUED', 'PARTIALLY_DISPENSED')
        RETURNING id
      ),
      cancelled_items AS (
        UPDATE prescription_item SET status = 'CANCELLED', stopped_reason = ${payload.reason}
        WHERE prescription_id IN (SELECT id FROM cancelled_prescription) AND status = 'ACTIVE'
        RETURNING id
      )
      SELECT id FROM cancelled_prescription
    `);
    const [updated] = await db.select().from(prescription).where(eq(prescription.id, id)).limit(1);
    if (!updated || updated.status !== "CANCELLED") throw conflict("The prescription has already changed.", "PRESCRIPTION_STATE_CONFLICT");
    await writeAudit(req, {
      action: "STATUS_CHANGE", entityType: "prescription", entityId: id, patientId: current.patientId,
      orgUnitId: record.orgUnitId, reason: payload.reason,
      before: { status: current.status }, after: { status: "CANCELLED" },
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
    await requireChart(req, record.patientId, null);
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "referral", entityId: id,
      patientId: record.patientId, orgUnitId: null,
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
      await db.execute(sql`
        WITH new_request AS (
          INSERT INTO bed_request (
            id, patient_id, visit_id, requested_unit_id, priority, clinical_summary, requested_by_staff_id
          ) SELECT
            ${bedRequestId}::uuid, ${record.patientId}::uuid, ${record.visitId}::uuid,
            ${payload.requestedUnitId}::uuid, 'ROUTINE', ${payload.clinicalSummary}, ${clinician.id}::uuid
          FROM encounter WHERE id = ${encounterId}::uuid AND status = 'OPEN'
          RETURNING id
        ),
        updated_encounter AS (
          UPDATE encounter SET disposition = 'ADMITTED'
          WHERE id = ${encounterId}::uuid AND status = 'OPEN'
            AND EXISTS (SELECT 1 FROM new_request)
          RETURNING visit_id
        )
        UPDATE visit SET status = 'ADMITTED', disposition = 'ADMITTED'
        WHERE id IN (SELECT visit_id FROM updated_encounter)
      `);
      const [updated] = await db.select({ id: encounter.id }).from(encounter)
        .where(and(eq(encounter.id, encounterId), eq(encounter.disposition, "ADMITTED"))).limit(1);
      if (!updated) throw conflict("The encounter has already changed.", "ENCOUNTER_STATE_CONFLICT");
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
        referral_id = CASE WHEN ${payload.disposition} = 'REFERRED_OUT' THEN ${payload.referralId}::uuid ELSE referral_id END,
        status = CASE WHEN ${payload.disposition} IN ('DISCHARGED_HOME', 'LEFT_WITHOUT_BEING_SEEN') THEN 'CLOSED' ELSE status END,
        closed_at = CASE WHEN ${payload.disposition} IN ('DISCHARGED_HOME', 'LEFT_WITHOUT_BEING_SEEN') THEN now() ELSE closed_at END
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
    await requireChart(req, record.patientId, null);
    await writeAudit(req, {
      action: "READ_RESTRICTED", entityType: "medical_certificate", entityId: id,
      patientId: record.patientId, orgUnitId: null,
    });
    res.json({ data: record });
  } catch (error) { next(error); }
});

export default router;
