import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";

import { db } from "../../db/index.js";
import {
  auditLog,
  consent,
  facilitySetup,
  orgUnit,
  patient,
  patientAllergy,
  patientCondition,
  patientContact,
  patientIdentifier,
  staff,
  type Patient,
} from "../../db/schema/index.js";
import { conflict, forbidden, notFound, validationError } from "../../lib/errors.js";
import { parseListQuery, toPageResponse } from "../../lib/listQuery.js";
import { patientActor, writePatientAudit, type PatientActor } from "../../lib/patientAccess.js";
import { buildPatientCardPdf, buildWristbandPdf, type PatientPrintData } from "../../lib/patientDocuments.js";
import {
  loadPatientContext,
  loadStaffNames,
  loadUserNames,
  parseBody,
  parseId,
  parsePresent,
  presentPatientSummaries,
  resolvePatientUnitScope,
  serializeContextFor,
  type PatientContext,
} from "../../lib/patientHttp.js";
import {
  createPatient,
  databaseErrorInfo,
  facilityToday,
  findDuplicateCandidates,
  identifierInUse,
  identifyPatient,
  loadPatient,
  loadPatientTimeline,
  mergePatients,
  recordDuplicateCandidates,
  resolveSurvivor,
  searchPatients,
  type DuplicateCandidate,
  type PatientChildRecords,
  type PatientDemographics,
} from "../../lib/patientRegistry.js";
import {
  ALLERGY_CATEGORIES,
  ALLERGY_SEVERITIES,
  BLOOD_GROUPS,
  changedFields,
  checkRegistrationRules,
  CLINICAL_ITEM_STATUSES,
  CONFIDENTIALITY_LEVELS,
  CONSENT_CAPTURE_METHODS,
  CONSENT_STATUSES,
  CONTACT_TYPES,
  getPatientConfig,
  hasConsentingGuardian,
  hasContactPerson,
  IDENTIFIER_TYPES,
  isMinorAge,
  MARITAL_STATUSES,
  normalizePhoneE164,
  PATIENT_ALLERGY_WRITE_ROLES,
  PATIENT_AUDIT_ROLES,
  PATIENT_CONDITION_WRITE_ROLES,
  PATIENT_CONSENT_TYPES,
  PATIENT_CONSENT_WRITE_ROLES,
  PATIENT_DEMOGRAPHIC_ITEM_ROLES,
  PATIENT_EDIT_ROLES,
  PATIENT_IDENTIFY_ROLES,
  PATIENT_PHOTO_ROLES,
  PATIENT_PRINT_ROLES,
  PATIENT_READ_ROLES,
  PATIENT_REGISTER_ROLES,
  PATIENT_SEXES,
  PATIENT_TIMELINE_ROLES,
  redactForAudit,
  resolveAgeYears,
  serializePatientDetail,
  validateIdentifier,
  type IdentifierType,
  type RuleViolation,
} from "../../lib/patientRules.js";
import { requireAnyRole } from "../../lib/platform.js";
import patientMergeRoutes from "./patientMerge.js";

const router = Router();

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEnum = <const Values extends readonly [string, ...string[]]>(values: Values) =>
  z.preprocess((value) => (value === "" ? null : value), z.enum(values).nullish()).transform((value) => value ?? null);

const isoDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid YYYY-MM-DD date.")
    .nullish(),
);

const demographicsShape = {
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  middleName: optionalText(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  preferredName: optionalText(100),
  sex: z.enum(PATIENT_SEXES),
  dateOfBirth: isoDate.transform((value) => value ?? null),
  dobEstimated: z.boolean().default(false),
  estimatedAgeYears: z.number().int().min(0).max(130).nullish().transform((value) => value ?? null),
  maritalStatus: optionalEnum(MARITAL_STATUSES),
  nationality: optionalText(60),
  religion: optionalText(40),
  occupation: optionalText(100),
  bloodGroup: optionalEnum(BLOOD_GROUPS),
  phone: optionalText(25),
  altPhone: optionalText(25),
  email: z
    .preprocess((value) => (value === "" ? null : value), z.string().trim().email().max(255).nullish())
    .transform((value) => value ?? null),
  addressLine: optionalText(200),
  town: optionalText(100),
  district: optionalText(100),
  region: optionalText(60),
  digitalAddress: optionalText(20),
};

const identifierSchema = z.object({
  idType: z.enum(IDENTIFIER_TYPES),
  idValue: z.string().trim().min(1).max(60),
  issuer: optionalText(100),
  validTo: isoDate.transform((value) => value ?? null),
});

const contactSchema = z.object({
  contactType: z.enum(CONTACT_TYPES),
  name: z.string().trim().min(1, "Name is required.").max(150),
  relationship: optionalText(40),
  phone: optionalText(25),
  address: optionalText(255),
  isPrimary: z.boolean().default(false),
  canConsent: z.boolean().default(false),
});

const consentEntrySchema = z.object({
  consentType: z.enum(PATIENT_CONSENT_TYPES),
  status: z.enum(CONSENT_STATUSES),
  note: optionalText(500),
});

const childRecordsShape = {
  identifiers: z.array(identifierSchema).max(10).default([]),
  contacts: z.array(contactSchema).max(10).default([]),
  consents: z.array(consentEntrySchema).max(PATIENT_CONSENT_TYPES.length).default([]),
  captureMethod: z.enum(CONSENT_CAPTURE_METHODS).default("PAPER"),
  witnessStaffId: z.string().uuid().nullish().transform((value) => value ?? null),
  acknowledgeDuplicates: z.boolean().default(false),
  duplicateOverrideReason: optionalText(500),
};

const registrationSchema = z.object({
  ...demographicsShape,
  ...childRecordsShape,
  unidentified: z.literal(false).default(false),
  confidentiality: z.enum(CONFIDENTIALITY_LEVELS).default("NORMAL"),
  registeredUnitId: z.string().uuid().nullish().transform((value) => value ?? null),
});

const unidentifiedSchema = z.object({
  unidentified: z.literal(true),
  sex: z.enum(PATIENT_SEXES),
  estimatedAgeYears: z.number().int().min(0).max(130),
  registeredUnitId: z.string().uuid().nullish().transform((value) => value ?? null),
});

const identifySchema = z.object({
  ...demographicsShape,
  ...childRecordsShape,
  version: z.number().int().min(0).optional(),
});

const identifyByMergeSchema = z.object({
  mergeIntoPatientId: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
});

const duplicateCheckSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  middleName: optionalText(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: isoDate.transform((value) => value ?? null),
  phone: optionalText(25),
  identifiers: z
    .array(z.object({ idType: z.enum(IDENTIFIER_TYPES), idValue: z.string().trim().min(1).max(60) }))
    .max(10)
    .default([]),
  excludePatientId: z.string().uuid().nullish(),
});

const updateShape = {
  ...demographicsShape,
  dobEstimated: z.boolean(),
  confidentiality: z.enum(CONFIDENTIALITY_LEVELS),
  status: z.enum(["ACTIVE", "INACTIVE", "DECEASED"]),
  deceasedAt: z.string().datetime({ offset: true }).nullable(),
  registeredUnitId: z.string().uuid().nullable(),
  version: z.number().int().min(0),
};

const identifierUpdateShape = {
  issuer: optionalText(100),
  validTo: isoDate.transform((value) => value ?? null),
  verified: z.boolean(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
};

const contactShape = {
  contactType: z.enum(CONTACT_TYPES),
  name: z.string().trim().min(1, "Name is required.").max(150),
  relationship: optionalText(40),
  phone: optionalText(25),
  address: optionalText(255),
  isPrimary: z.boolean(),
  canConsent: z.boolean(),
};

const allergySchema = z.object({
  category: z.enum(ALLERGY_CATEGORIES),
  substance: z.string().trim().min(1, "Substance is required.").max(150),
  reaction: optionalText(200),
  severity: optionalEnum(ALLERGY_SEVERITIES),
  notedOn: isoDate.transform((value) => value ?? null),
});

const allergyUpdateShape = {
  reaction: optionalText(200),
  severity: optionalEnum(ALLERGY_SEVERITIES),
  status: z.enum(CLINICAL_ITEM_STATUSES),
};

const conditionSchema = z.object({
  icd10Code: optionalText(10),
  description: z.string().trim().min(1, "Description is required.").max(200),
  onsetDate: isoDate.transform((value) => value ?? null),
  isChronic: z.boolean().default(false),
});

const conditionUpdateShape = {
  description: z.string().trim().min(1).max(200),
  onsetDate: isoDate.transform((value) => value ?? null),
  isChronic: z.boolean(),
  status: z.enum(CLINICAL_ITEM_STATUSES),
};

const consentRecordSchema = consentEntrySchema.extend({
  captureMethod: z.enum(CONSENT_CAPTURE_METHODS),
  witnessStaffId: z.string().uuid().nullish().transform((value) => value ?? null),
  guardianName: optionalText(150),
  guardianRelationship: optionalText(40),
});

const photoSchema = z.object({
  photoUrl: z
    .string()
    .trim()
    .url()
    .max(255)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
      } catch {
        return false;
      }
    }, "The photo must be an uploaded image.")
    .nullable(),
  photoPublicId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_./-]{1,255}$/)
    .nullish()
    .transform((value) => value ?? null),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const definedEntries = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

const throwViolations = (violations: RuleViolation[]) => {
  const first = violations[0];
  if (!first) return;
  const fieldErrors: Record<string, string[]> = {};
  for (const violation of violations) (fieldErrors[violation.field] ??= []).push(violation.message);
  throw validationError(first.message, first.code, { fieldErrors });
};

const normalizeIdentifiers = (
  identifiers: Array<{ idType: IdentifierType; idValue: string; issuer: string | null; validTo: string | null }>,
) =>
  identifiers.map((entry) => {
    const result = validateIdentifier(entry.idType, entry.idValue);
    return { ...entry, idValue: result.value };
  });

const pickDemographics = (input: PatientDemographics): PatientDemographics => ({
  firstName: input.firstName,
  middleName: input.middleName,
  lastName: input.lastName,
  preferredName: input.preferredName,
  sex: input.sex,
  dateOfBirth: input.dateOfBirth,
  dobEstimated: input.dobEstimated,
  estimatedAgeYears: input.dateOfBirth && !input.dobEstimated ? null : input.estimatedAgeYears,
  maritalStatus: input.maritalStatus,
  nationality: input.nationality,
  religion: input.religion,
  occupation: input.occupation,
  bloodGroup: input.bloodGroup,
  phone: input.phone,
  altPhone: input.altPhone,
  email: input.email,
  addressLine: input.addressLine,
  town: input.town,
  district: input.district,
  region: input.region,
  digitalAddress: input.digitalAddress,
});

const resolvePolicyVersion = async () => {
  const [facility] = await db
    .select({ privacyPolicyVersion: facilitySetup.privacyPolicyVersion })
    .from(facilitySetup)
    .limit(1);
  return facility?.privacyPolicyVersion ?? getPatientConfig().privacyPolicyVersion ?? "1.0";
};

const assertReferencesExist = async (registeredUnitId: string | null, witnessStaffId: string | null) => {
  const [unit, witness] = await Promise.all([
    registeredUnitId
      ? db.select({ id: orgUnit.id }).from(orgUnit).where(eq(orgUnit.id, registeredUnitId)).limit(1)
      : Promise.resolve([{ id: "" }]),
    witnessStaffId
      ? db.select({ id: staff.id }).from(staff).where(eq(staff.id, witnessStaffId)).limit(1)
      : Promise.resolve([{ id: "" }]),
  ]);
  if (unit.length === 0) {
    throw validationError("The registration unit was not found.", "PATIENT_UNIT_NOT_FOUND", {
      fieldErrors: { registeredUnitId: ["Choose a valid unit."] },
    });
  }
  if (witness.length === 0) {
    throw validationError("The consent witness was not found.", "PATIENT_CONSENT_WITNESS_NOT_FOUND", {
      fieldErrors: { witnessStaffId: ["Choose a valid staff witness."] },
    });
  }
};

const presentCandidates = async (candidates: DuplicateCandidate[], actor: PatientActor, todayIso: string) => {
  const summaries = await presentPatientSummaries(
    candidates.map((candidate) => candidate.patient),
    actor,
    todayIso,
  );
  return candidates.map((candidate, index) => ({
    patient: summaries[index],
    score: candidate.score,
    level: candidate.level,
    reasons: candidate.reasons,
  }));
};

type RegistrationPayload = Omit<
  z.infer<typeof registrationSchema>,
  "unidentified" | "confidentiality" | "registeredUnitId"
>;

/**
 * Shared by registration and identification: applies the registration rules, then the duplicate
 * gate. Returns the acknowledged candidates so the caller can queue them for review.
 */
const runRegistrationChecks = async (
  payload: RegistrationPayload,
  actor: PatientActor,
  todayIso: string,
  excludePatientId: string | null,
) => {
  const config = getPatientConfig();
  throwViolations(
    checkRegistrationRules(
      {
        unidentified: false,
        dateOfBirth: payload.dateOfBirth,
        estimatedAgeYears: payload.estimatedAgeYears,
        phone: payload.phone,
        contacts: payload.contacts,
        consents: payload.consents,
        captureMethod: payload.captureMethod,
        witnessStaffId: payload.witnessStaffId,
        identifiers: payload.identifiers,
      },
      { todayIso, config },
    ),
  );

  const identifiers = normalizeIdentifiers(payload.identifiers);
  const candidates = await findDuplicateCandidates(
    {
      firstName: payload.firstName,
      middleName: payload.middleName,
      lastName: payload.lastName,
      dateOfBirth: payload.dateOfBirth,
      phone: payload.phone,
      identifiers,
      excludePatientId,
    },
    config,
  );

  if (candidates.some((candidate) => candidate.signals.identifierMatch)) {
    throw conflict(
      "An identifier is already registered to another patient. Open the existing record instead.",
      "PATIENT_IDENTIFIER_IN_USE",
      { candidates: await presentCandidates(candidates, actor, todayIso) },
    );
  }

  const blocking = candidates.some((candidate) => candidate.level === "BLOCK");
  if (candidates.length > 0 && !payload.acknowledgeDuplicates) {
    throw conflict(
      blocking
        ? "This looks like an existing patient. Open the existing record or give a reason to continue."
        : "Similar patients were found. Confirm that none of them is this patient.",
      "PATIENT_DUPLICATE_CANDIDATES",
      { blocking, candidates: await presentCandidates(candidates, actor, todayIso) },
    );
  }
  if (blocking && (payload.duplicateOverrideReason?.length ?? 0) < 10) {
    throw validationError(
      "Give a reason of at least 10 characters for registering a probable duplicate.",
      "PATIENT_DUPLICATE_REASON_REQUIRED",
      { fieldErrors: { duplicateOverrideReason: ["Give a reason of at least 10 characters."] } },
    );
  }

  const age = resolveAgeYears(
    { dateOfBirth: payload.dateOfBirth, estimatedAgeYears: payload.estimatedAgeYears },
    todayIso,
  );
  const guardian = isMinorAge(age, config.minorAgeThreshold)
    ? payload.contacts.find((contact) => contact.contactType === "GUARDIAN" && contact.canConsent)
    : undefined;

  return {
    identifiers,
    candidates,
    blocking,
    guardianName: guardian?.name ?? null,
    guardianRelationship: guardian?.relationship ?? null,
  };
};

const auditDuplicateOverride = async (
  req: Request,
  patientId: string,
  candidates: DuplicateCandidate[],
  reason: string | null,
  blocking: boolean,
) => {
  if (candidates.length === 0) return;
  await recordDuplicateCandidates(patientId, candidates, "REGISTRATION");
  await writePatientAudit(req, {
    action: "OVERRIDE",
    entityType: "patient_duplicate_check",
    entityId: patientId,
    patientId,
    reason: reason ?? (blocking ? null : "Registrar confirmed none of the suggested patients match."),
    after: {
      blocking,
      candidates: candidates.map((candidate) => ({
        patientId: candidate.patient.id,
        score: candidate.score,
        level: candidate.level,
        reasons: candidate.reasons,
      })),
    },
  });
};

const serializeDetail = (context: PatientContext) =>
  serializePatientDetail(context.patient, serializeContextFor(context.actor, context.todayIso));

const requireFullAccess = (context: PatientContext) => {
  if (context.actor.level !== "FULL") {
    throw forbidden("Your role only has minimal access to patient records.");
  }
};

const loadActiveAllergies = (patientId: string) =>
  db
    .select({
      id: patientAllergy.id,
      category: patientAllergy.category,
      substance: patientAllergy.substance,
      reaction: patientAllergy.reaction,
      severity: patientAllergy.severity,
    })
    .from(patientAllergy)
    .where(and(eq(patientAllergy.patientId, patientId), eq(patientAllergy.status, "ACTIVE")))
    .orderBy(asc(patientAllergy.substance));

/* ------------------------------------------------------------------ */
/* Search, duplicate check and registration                            */
/* ------------------------------------------------------------------ */

router.get("/", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const query = parseListQuery(req, {
      sortable: ["lastName", "registeredAt", "mrn"],
      filterable: ["status", "sex", "registeredAt", "confidentiality", "isUnidentified"],
      defaultSort: "-registeredAt",
      maxLimit: 100,
    });
    if (query.q && query.q.length < 2) {
      throw validationError("Enter at least 2 characters to search.", "PATIENT_SEARCH_TOO_SHORT");
    }

    const [unitIds, { todayIso }] = await Promise.all([resolvePatientUnitScope(actor), facilityToday()]);
    const result = await searchPatients(query, { unitIds, sortExplicit: typeof req.query.sort === "string" });
    const data = await presentPatientSummaries(result.rows, actor, todayIso);

    res.json({ ...toPageResponse(data, query, result.total), meta: { mergedFromMrn: result.mergedFromMrn } });
  } catch (error) {
    next(error);
  }
});

router.post("/duplicate-check", requireAnyRole(PATIENT_REGISTER_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const draft = parseBody(duplicateCheckSchema, req.body);
    const { todayIso } = await facilityToday();
    const identifiers = draft.identifiers
      .map((entry) => ({ idType: entry.idType, result: validateIdentifier(entry.idType, entry.idValue) }))
      .filter((entry) => entry.result.ok)
      .map((entry) => ({ idType: entry.idType, idValue: entry.result.value }));
    const candidates = await findDuplicateCandidates({ ...draft, identifiers });

    res.json({
      data: {
        blocking: candidates.some((candidate) => candidate.level === "BLOCK"),
        identifierInUse: candidates.some((candidate) => candidate.signals.identifierMatch),
        candidates: await presentCandidates(candidates, actor, todayIso),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAnyRole(PATIENT_REGISTER_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const { todayIso } = await facilityToday();

    if ((req.body as { unidentified?: unknown } | undefined)?.unidentified === true) {
      const payload = parseBody(unidentifiedSchema, req.body);
      await assertReferencesExist(payload.registeredUnitId, null);
      const created = await createPatient(
        {
          unidentified: true,
          firstName: "UNKNOWN",
          middleName: null,
          lastName: "UNKNOWN",
          preferredName: null,
          sex: payload.sex,
          dateOfBirth: null,
          dobEstimated: true,
          estimatedAgeYears: payload.estimatedAgeYears,
          maritalStatus: null,
          nationality: null,
          religion: null,
          occupation: null,
          bloodGroup: null,
          phone: null,
          altPhone: null,
          email: null,
          addressLine: null,
          town: null,
          district: null,
          region: null,
          digitalAddress: null,
          confidentiality: "NORMAL",
          registeredUnitId: payload.registeredUnitId,
          identifiers: [],
          contacts: [],
          consents: [],
          captureMethod: "PAPER",
          witnessStaffId: null,
          guardianName: null,
          guardianRelationship: null,
          policyVersion: "n/a",
        },
        actor.userId,
      );
      await writePatientAudit(req, {
        action: "CREATE",
        entityType: "patient",
        entityId: created.id,
        patientId: created.id,
        reason: "Emergency registration of an unidentified patient",
        after: redactForAudit({ sex: created.sex, isUnidentified: true, status: created.status }),
        orgUnitId: created.registeredUnitId,
      });
      res.status(201).json({ data: serializePatientDetail(created, serializeContextFor(actor, todayIso)) });
      return;
    }

    const payload = parseBody(registrationSchema, req.body);
    const demographics = pickDemographics(payload);
    const checks = await runRegistrationChecks(
      { ...payload, estimatedAgeYears: demographics.estimatedAgeYears },
      actor,
      todayIso,
      null,
    );
    await assertReferencesExist(payload.registeredUnitId, payload.witnessStaffId);

    const created = await createPatient(
      {
        ...demographics,
        unidentified: false,
        confidentiality: payload.confidentiality,
        registeredUnitId: payload.registeredUnitId,
        identifiers: checks.identifiers,
        contacts: payload.contacts,
        consents: payload.consents,
        captureMethod: payload.captureMethod,
        witnessStaffId: payload.captureMethod === "VERBAL_WITNESSED" ? payload.witnessStaffId : null,
        guardianName: checks.guardianName,
        guardianRelationship: checks.guardianRelationship,
        policyVersion: await resolvePolicyVersion(),
      },
      actor.userId,
    );

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "patient",
      entityId: created.id,
      patientId: created.id,
      after: redactForAudit({
        ...demographics,
        confidentiality: created.confidentiality,
        status: created.status,
        registeredUnitId: created.registeredUnitId,
      }),
      orgUnitId: created.registeredUnitId,
    });
    await auditDuplicateOverride(req, created.id, checks.candidates, payload.duplicateOverrideReason, checks.blocking);

    res.status(201).json({
      data: serializePatientDetail(created, serializeContextFor(actor, todayIso)),
      meta: { acknowledgedDuplicates: checks.candidates.length },
    });
  } catch (error) {
    next(error);
  }
});

/** Pick-list data for the registry screens, so that forms never ask for a record reference. */
router.get("/references", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const actor = patientActor(req);
    const config = getPatientConfig();
    const canPickStaff = [...PATIENT_REGISTER_ROLES, ...PATIENT_CONSENT_WRITE_ROLES].some((role) =>
      actor.roles.includes(role),
    );
    const [units, witnesses, { todayIso }] = await Promise.all([
      db
        .select({ id: orgUnit.id, name: orgUnit.name, code: orgUnit.code, unitType: orgUnit.unitType })
        .from(orgUnit)
        .where(eq(orgUnit.active, true))
        .orderBy(asc(orgUnit.name)),
      canPickStaff
        ? db
            .select({
              id: staff.id,
              firstName: staff.firstName,
              lastName: staff.lastName,
              employeeId: staff.employeeId,
            })
            .from(staff)
            .where(eq(staff.status, "active"))
            .orderBy(asc(staff.lastName), asc(staff.firstName))
        : Promise.resolve([]),
      facilityToday(),
    ]);
    res.json({
      data: {
        units,
        staff: witnesses,
        today: todayIso,
        minorAgeThreshold: config.minorAgeThreshold,
        breakGlassReasonMinChars: config.breakGlassReasonMinChars,
        accessLevel: actor.level,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Duplicate review, merge preview and merge live under /patients/duplicates and /patients/merge.
router.use("/", patientMergeRoutes);

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

router.get("/:id", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { allowMerged: true });
    if (context.patient.status === "MERGED") {
      const survivor = await resolveSurvivor(context.patient);
      res.json({
        data: {
          id: context.patient.id,
          mrn: context.patient.mrn,
          status: "MERGED",
          mergedIntoId: survivor.status === "MERGED" ? null : survivor.id,
        },
      });
      return;
    }

    const allergies = await loadActiveAllergies(context.patient.id);
    res.json({
      data: {
        ...serializeDetail(context),
        allergies,
        restriction: context.access.restriction,
        breakGlass: context.access.grant
          ? { expiresAt: context.access.grant.expiresAt, reason: context.access.grant.reason }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireAnyRole(PATIENT_EDIT_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req);
    const { patient: current, actor, todayIso } = context;
    const { version, deceasedAt, ...changes } = parsePresent(updateShape, req.body);
    const config = getPatientConfig();

    if (current.isUnidentified && (changes.firstName !== undefined || changes.lastName !== undefined)) {
      throw validationError(
        "Use the identify action to name an unidentified patient.",
        "PATIENT_IDENTIFY_REQUIRED",
      );
    }

    const proposed = { ...current, ...definedEntries(changes) };
    throwViolations(
      checkRegistrationRules(
        {
          unidentified: true,
          dateOfBirth: proposed.dateOfBirth,
          estimatedAgeYears: proposed.estimatedAgeYears,
          phone: changes.phone ?? null,
          contacts: [],
          consents: [],
          identifiers: [],
        },
        { todayIso, config },
      ),
    );

    const ageChanged = changes.dateOfBirth !== undefined || changes.estimatedAgeYears !== undefined;
    const phoneCleared = changes.phone === null && current.phone !== null;
    if (!current.isUnidentified && (ageChanged || phoneCleared)) {
      const contacts = await db.select().from(patientContact).where(eq(patientContact.patientId, current.id));
      const age = resolveAgeYears(
        {
          dateOfBirth: proposed.dateOfBirth,
          estimatedAgeYears: proposed.estimatedAgeYears,
          registeredAt: current.registeredAt,
        },
        todayIso,
      );
      if (ageChanged && isMinorAge(age, config.minorAgeThreshold) && !hasConsentingGuardian(contacts)) {
        throw validationError(
          `Patients under ${config.minorAgeThreshold} need a guardian who can consent.`,
          "PATIENT_GUARDIAN_REQUIRED",
        );
      }
      if (phoneCleared && !hasContactPerson(contacts)) {
        throw validationError("Capture a phone number or a next of kin.", "PATIENT_CONTACT_REQUIRED", {
          fieldErrors: { phone: ["Capture a phone number or a next of kin."] },
        });
      }
    }

    if (changes.registeredUnitId) await assertReferencesExist(changes.registeredUnitId, null);

    const statusChanged = changes.status !== undefined && changes.status !== current.status;
    const values: Partial<typeof patient.$inferInsert> = {
      ...definedEntries(changes),
      updatedAt: new Date(),
      updatedBy: actor.userId,
      version: current.version + 1,
    };
    if (changes.phone !== undefined) values.phoneE164 = normalizePhoneE164(changes.phone);
    if (proposed.dateOfBirth && !proposed.dobEstimated) values.estimatedAgeYears = null;
    if (proposed.status === "DECEASED") {
      if (statusChanged || deceasedAt) {
        const timeOfDeath = deceasedAt ? new Date(deceasedAt) : new Date();
        if (timeOfDeath.getTime() > Date.now()) {
          throw validationError("The time of death cannot be in the future.", "PATIENT_DECEASED_AT_INVALID", {
            fieldErrors: { deceasedAt: ["The time of death cannot be in the future."] },
          });
        }
        values.deceasedAt = timeOfDeath;
      }
    } else if (statusChanged) {
      values.deceasedAt = null;
    }

    const [updated] = await db
      .update(patient)
      .set(values)
      .where(
        and(
          eq(patient.id, current.id),
          eq(patient.version, version ?? current.version),
          ne(patient.status, "MERGED"),
        ),
      )
      .returning();
    if (!updated) {
      throw conflict("This patient changed. Refresh and try again.", "CONCURRENT_MODIFICATION");
    }

    const changed = changedFields(current as Record<string, unknown>, updated as Record<string, unknown>).filter(
      (field) => !["updatedAt", "updatedBy", "version", "nameKey", "surnamePhonetic", "phoneE164"].includes(field),
    );
    const pick = (source: Patient) =>
      redactForAudit(Object.fromEntries(changed.map((field) => [field, (source as Record<string, unknown>)[field]])));
    await writePatientAudit(req, {
      action: statusChanged ? "STATUS_CHANGE" : "UPDATE",
      entityType: "patient",
      entityId: updated.id,
      patientId: updated.id,
      before: pick(current),
      after: pick(updated),
      orgUnitId: updated.registeredUnitId,
    });

    const allergies = await loadActiveAllergies(updated.id);
    res.json({
      data: {
        ...serializePatientDetail(updated, serializeContextFor(actor, todayIso)),
        allergies,
        restriction: context.access.restriction,
        breakGlass: context.access.grant
          ? { expiresAt: context.access.grant.expiresAt, reason: context.access.grant.reason }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/identify", requireAnyRole(PATIENT_IDENTIFY_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req);
    const { patient: current, actor, todayIso } = context;
    if (!current.isUnidentified) {
      throw conflict("This patient has already been identified.", "PATIENT_ALREADY_IDENTIFIED");
    }

    if ((req.body as { mergeIntoPatientId?: unknown } | undefined)?.mergeIntoPatientId) {
      const payload = parseBody(identifyByMergeSchema, req.body);
      const survivor = await loadPatient(payload.mergeIntoPatientId);
      if (!survivor || survivor.status === "MERGED") {
        throw notFound("The existing patient record was not found.", "PATIENT_NOT_FOUND");
      }
      const result = await mergePatients({
        survivor,
        merged: current,
        reason: payload.reason,
        takeFromMerged: [],
        userId: actor.userId,
      });
      await writePatientAudit(req, {
        action: "UPDATE",
        entityType: "patient_merge",
        entityId: result.mergeLogId,
        patientId: survivor.id,
        reason: `Unidentified patient identified as an existing record: ${payload.reason}`,
        after: { mergedPatientId: current.id, status: result.status },
      });
      res.json({ data: { mergedIntoId: survivor.id, mergeLogId: result.mergeLogId, status: result.status } });
      return;
    }

    const payload = parseBody(identifySchema, req.body);
    const demographics = pickDemographics(payload);
    const checks = await runRegistrationChecks(
      { ...payload, estimatedAgeYears: demographics.estimatedAgeYears },
      actor,
      todayIso,
      current.id,
    );
    await assertReferencesExist(null, payload.witnessStaffId);

    const identified = await identifyPatient(
      current.id,
      payload.version ?? current.version,
      {
        ...demographics,
        identifiers: checks.identifiers,
        contacts: payload.contacts,
        consents: payload.consents,
        captureMethod: payload.captureMethod,
        witnessStaffId: payload.captureMethod === "VERBAL_WITNESSED" ? payload.witnessStaffId : null,
        guardianName: checks.guardianName,
        guardianRelationship: checks.guardianRelationship,
        policyVersion: await resolvePolicyVersion(),
      },
      actor.userId,
    );

    await writePatientAudit(req, {
      action: "UPDATE",
      entityType: "patient",
      entityId: identified.id,
      patientId: identified.id,
      reason: "Unidentified patient identified",
      before: redactForAudit({ isUnidentified: true, firstName: current.firstName, lastName: current.lastName }),
      after: redactForAudit({ ...demographics, isUnidentified: false }),
      orgUnitId: identified.registeredUnitId,
    });
    await auditDuplicateOverride(req, identified.id, checks.candidates, payload.duplicateOverrideReason, checks.blocking);

    res.json({ data: serializePatientDetail(identified, serializeContextFor(actor, todayIso)) });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

router.get("/:id/identifiers", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_identifier" });
    requireFullAccess(context);
    const rows = await db
      .select()
      .from(patientIdentifier)
      .where(eq(patientIdentifier.patientId, context.patient.id))
      .orderBy(asc(patientIdentifier.idType));
    const names = await loadUserNames(rows.map((row) => row.verifiedBy));
    res.json({
      data: rows.map(({ verifiedBy, patientId: _patientId, ...row }) => ({
        ...row,
        verifiedByName: verifiedBy ? (names.get(verifiedBy) ?? null) : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/identifiers", requireAnyRole(PATIENT_DEMOGRAPHIC_ITEM_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_identifier" });
    const payload = parseBody(identifierSchema, req.body);
    const result = validateIdentifier(payload.idType, payload.idValue);
    if (!result.ok) {
      throw validationError(result.message, "PATIENT_IDENTIFIER_INVALID", {
        fieldErrors: { idValue: [result.message] },
      });
    }

    const [existing] = await db
      .select({ id: patientIdentifier.id })
      .from(patientIdentifier)
      .where(
        and(
          eq(patientIdentifier.patientId, context.patient.id),
          eq(patientIdentifier.idType, payload.idType),
          eq(patientIdentifier.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (existing) {
      throw conflict(
        "This patient already has an active identifier of this type. Deactivate it first.",
        "PATIENT_IDENTIFIER_DUPLICATE",
      );
    }

    let created;
    try {
      [created] = await db
        .insert(patientIdentifier)
        .values({
          patientId: context.patient.id,
          idType: payload.idType,
          idValue: result.value,
          issuer: payload.issuer,
          validTo: payload.validTo,
        })
        .returning();
    } catch (error) {
      if (databaseErrorInfo(error)?.sqlState === "23505") throw identifierInUse();
      throw error;
    }
    if (!created) throw conflict("The identifier could not be saved.", "PATIENT_IDENTIFIER_NOT_SAVED");

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "patient_identifier",
      entityId: created.id,
      patientId: context.patient.id,
      after: redactForAudit({ idType: created.idType, idValue: created.idValue }),
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id/identifiers/:identifierId",
  requireAnyRole(PATIENT_DEMOGRAPHIC_ITEM_ROLES),
  async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: "patient_identifier" });
      const identifierId = parseId(req.params.identifierId, "identifierId");
      const payload = parsePresent(identifierUpdateShape, req.body);
      const [current] = await db
        .select()
        .from(patientIdentifier)
        .where(and(eq(patientIdentifier.id, identifierId), eq(patientIdentifier.patientId, context.patient.id)))
        .limit(1);
      if (!current) throw notFound("Identifier not found.", "PATIENT_IDENTIFIER_NOT_FOUND");

      const values: Partial<typeof patientIdentifier.$inferInsert> = {};
      if (payload.issuer !== undefined) values.issuer = payload.issuer;
      if (payload.validTo !== undefined) values.validTo = payload.validTo;
      if (payload.status !== undefined) values.status = payload.status;
      if (payload.verified !== undefined && payload.verified !== current.verified) {
        values.verified = payload.verified;
        values.verifiedAt = payload.verified ? new Date() : null;
        values.verifiedBy = payload.verified ? context.actor.userId : null;
      }
      if (Object.keys(values).length === 0) {
        res.json({ data: current });
        return;
      }

      let updated;
      try {
        [updated] = await db
          .update(patientIdentifier)
          .set(values)
          .where(eq(patientIdentifier.id, current.id))
          .returning();
      } catch (error) {
        if (databaseErrorInfo(error)?.sqlState === "23505") throw identifierInUse();
        throw error;
      }

      await writePatientAudit(req, {
        action: "UPDATE",
        entityType: "patient_identifier",
        entityId: current.id,
        patientId: context.patient.id,
        before: redactForAudit({ status: current.status, verified: current.verified }),
        after: redactForAudit({ status: updated?.status, verified: updated?.verified }),
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

router.get("/:id/contacts", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_contact" });
    requireFullAccess(context);
    const rows = await db
      .select()
      .from(patientContact)
      .where(eq(patientContact.patientId, context.patient.id))
      .orderBy(desc(patientContact.isPrimary), asc(patientContact.name));
    res.json({ data: rows.map(({ patientId: _patientId, ...row }) => row) });
  } catch (error) {
    next(error);
  }
});

const assertContactPhone = (phone: string | null | undefined) => {
  if (phone && !normalizePhoneE164(phone)) {
    throw validationError("Enter a valid phone number.", "PATIENT_PHONE_INVALID", {
      fieldErrors: { phone: ["Enter a valid phone number."] },
    });
  }
};

router.post("/:id/contacts", requireAnyRole(PATIENT_DEMOGRAPHIC_ITEM_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_contact" });
    const payload = parseBody(contactSchema, req.body);
    assertContactPhone(payload.phone);
    const [created] = await db
      .insert(patientContact)
      .values({ ...payload, patientId: context.patient.id })
      .returning();
    if (!created) throw conflict("The contact could not be saved.", "PATIENT_CONTACT_NOT_SAVED");

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "patient_contact",
      entityId: created.id,
      patientId: context.patient.id,
      after: redactForAudit({ contactType: created.contactType, canConsent: created.canConsent, name: created.name }),
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

/** A minor must keep at least one guardian who can consent. */
const assertGuardianRemains = async (context: PatientContext, removedContactId: string) => {
  const age = resolveAgeYears(context.patient, context.todayIso);
  if (context.patient.isUnidentified || !isMinorAge(age, getPatientConfig().minorAgeThreshold)) return;
  const others = await db
    .select()
    .from(patientContact)
    .where(and(eq(patientContact.patientId, context.patient.id), ne(patientContact.id, removedContactId)));
  if (!hasConsentingGuardian(others)) {
    throw validationError(
      "A minor must keep at least one guardian who can consent.",
      "PATIENT_GUARDIAN_REQUIRED",
    );
  }
};

router.patch(
  "/:id/contacts/:contactId",
  requireAnyRole(PATIENT_DEMOGRAPHIC_ITEM_ROLES),
  async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: "patient_contact" });
      const contactId = parseId(req.params.contactId, "contactId");
      const payload = parsePresent(contactShape, req.body);
      assertContactPhone(payload.phone);
      const [current] = await db
        .select()
        .from(patientContact)
        .where(and(eq(patientContact.id, contactId), eq(patientContact.patientId, context.patient.id)))
        .limit(1);
      if (!current) throw notFound("Contact not found.", "PATIENT_CONTACT_NOT_FOUND");

      const values = definedEntries(payload);
      const merged = { ...current, ...values };
      if (
        current.contactType === "GUARDIAN" &&
        current.canConsent &&
        !(merged.contactType === "GUARDIAN" && merged.canConsent)
      ) {
        await assertGuardianRemains(context, current.id);
      }
      if (Object.keys(values).length === 0) {
        res.json({ data: current });
        return;
      }

      const [updated] = await db.update(patientContact).set(values).where(eq(patientContact.id, current.id)).returning();
      await writePatientAudit(req, {
        action: "UPDATE",
        entityType: "patient_contact",
        entityId: current.id,
        patientId: context.patient.id,
        before: redactForAudit(Object.fromEntries(Object.keys(values).map((key) => [key, (current as Record<string, unknown>)[key]]))),
        after: redactForAudit(values),
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id/contacts/:contactId",
  requireAnyRole(PATIENT_DEMOGRAPHIC_ITEM_ROLES),
  async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: "patient_contact" });
      const contactId = parseId(req.params.contactId, "contactId");
      const [current] = await db
        .select()
        .from(patientContact)
        .where(and(eq(patientContact.id, contactId), eq(patientContact.patientId, context.patient.id)))
        .limit(1);
      if (!current) throw notFound("Contact not found.", "PATIENT_CONTACT_NOT_FOUND");
      if (current.contactType === "GUARDIAN" && current.canConsent) {
        await assertGuardianRemains(context, current.id);
      }

      await db.delete(patientContact).where(eq(patientContact.id, current.id));
      await writePatientAudit(req, {
        action: "DELETE",
        entityType: "patient_contact",
        entityId: current.id,
        patientId: context.patient.id,
        before: redactForAudit({ contactType: current.contactType, canConsent: current.canConsent, name: current.name }),
      });
      res.json({ data: { success: true } });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Allergies and conditions                                            */
/* ------------------------------------------------------------------ */

router.get("/:id/allergies", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_allergy" });
    const rows = await db
      .select()
      .from(patientAllergy)
      .where(eq(patientAllergy.patientId, context.patient.id))
      .orderBy(asc(patientAllergy.status), desc(patientAllergy.recordedAt));
    const names = await loadUserNames(rows.map((row) => row.recordedBy));
    res.json({
      data: rows.map(({ recordedBy, patientId: _patientId, drugId: _drugId, ...row }) => ({
        ...row,
        recordedByName: names.get(recordedBy) ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/allergies", requireAnyRole(PATIENT_ALLERGY_WRITE_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_allergy" });
    const payload = parseBody(allergySchema, req.body);
    if (payload.notedOn && payload.notedOn > context.todayIso) {
      throw validationError("The noted date cannot be in the future.", "PATIENT_ALLERGY_DATE_INVALID", {
        fieldErrors: { notedOn: ["The noted date cannot be in the future."] },
      });
    }
    const [created] = await db
      .insert(patientAllergy)
      .values({ ...payload, patientId: context.patient.id, recordedBy: context.actor.userId })
      .returning();
    if (!created) throw conflict("The allergy could not be saved.", "PATIENT_ALLERGY_NOT_SAVED");

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "patient_allergy",
      entityId: created.id,
      patientId: context.patient.id,
      after: redactForAudit({ category: created.category, severity: created.severity, substance: created.substance }),
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id/allergies/:allergyId",
  requireAnyRole(PATIENT_ALLERGY_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: "patient_allergy" });
      const allergyId = parseId(req.params.allergyId, "allergyId");
      const payload = parsePresent(allergyUpdateShape, req.body);
      const values = definedEntries(payload);
      const [current] = await db
        .select()
        .from(patientAllergy)
        .where(and(eq(patientAllergy.id, allergyId), eq(patientAllergy.patientId, context.patient.id)))
        .limit(1);
      if (!current) throw notFound("Allergy not found.", "PATIENT_ALLERGY_NOT_FOUND");
      if (Object.keys(values).length === 0) {
        res.json({ data: current });
        return;
      }

      const [updated] = await db.update(patientAllergy).set(values).where(eq(patientAllergy.id, current.id)).returning();
      await writePatientAudit(req, {
        action: payload.status && payload.status !== current.status ? "STATUS_CHANGE" : "UPDATE",
        entityType: "patient_allergy",
        entityId: current.id,
        patientId: context.patient.id,
        before: redactForAudit({ status: current.status, severity: current.severity }),
        after: redactForAudit({ status: updated?.status, severity: updated?.severity }),
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/:id/conditions", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_condition" });
    requireFullAccess(context);
    const rows = await db
      .select()
      .from(patientCondition)
      .where(eq(patientCondition.patientId, context.patient.id))
      .orderBy(asc(patientCondition.status), desc(patientCondition.recordedAt));
    const names = await loadUserNames(rows.map((row) => row.recordedBy));
    res.json({
      data: rows.map(({ recordedBy, patientId: _patientId, ...row }) => ({
        ...row,
        recordedByName: names.get(recordedBy) ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/conditions", requireAnyRole(PATIENT_CONDITION_WRITE_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_condition" });
    const payload = parseBody(conditionSchema, req.body);
    if (payload.onsetDate && payload.onsetDate > context.todayIso) {
      throw validationError("The onset date cannot be in the future.", "PATIENT_CONDITION_DATE_INVALID", {
        fieldErrors: { onsetDate: ["The onset date cannot be in the future."] },
      });
    }
    const [created] = await db
      .insert(patientCondition)
      .values({
        ...payload,
        icd10Code: payload.icd10Code?.toUpperCase() ?? null,
        patientId: context.patient.id,
        recordedBy: context.actor.userId,
      })
      .returning();
    if (!created) throw conflict("The condition could not be saved.", "PATIENT_CONDITION_NOT_SAVED");

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "patient_condition",
      entityId: created.id,
      patientId: context.patient.id,
      after: redactForAudit({ isChronic: created.isChronic, description: created.description }),
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id/conditions/:conditionId",
  requireAnyRole(PATIENT_CONDITION_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: "patient_condition" });
      const conditionId = parseId(req.params.conditionId, "conditionId");
      const payload = parsePresent(conditionUpdateShape, req.body);
      const values = definedEntries(payload);
      const [current] = await db
        .select()
        .from(patientCondition)
        .where(and(eq(patientCondition.id, conditionId), eq(patientCondition.patientId, context.patient.id)))
        .limit(1);
      if (!current) throw notFound("Condition not found.", "PATIENT_CONDITION_NOT_FOUND");
      if (Object.keys(values).length === 0) {
        res.json({ data: current });
        return;
      }

      const [updated] = await db
        .update(patientCondition)
        .set(values)
        .where(eq(patientCondition.id, current.id))
        .returning();
      await writePatientAudit(req, {
        action: payload.status && payload.status !== current.status ? "STATUS_CHANGE" : "UPDATE",
        entityType: "patient_condition",
        entityId: current.id,
        patientId: context.patient.id,
        before: redactForAudit({ status: current.status, isChronic: current.isChronic }),
        after: redactForAudit({ status: updated?.status, isChronic: updated?.isChronic }),
      });
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Consents                                                            */
/* ------------------------------------------------------------------ */

router.get("/:id/consents", requireAnyRole(PATIENT_READ_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "consent" });
    requireFullAccess(context);
    const rows = await db
      .select()
      .from(consent)
      .where(and(eq(consent.subjectType, "PATIENT"), eq(consent.subjectId, context.patient.id)))
      .orderBy(desc(consent.createdAt));
    const [userNames, staffNames] = await Promise.all([
      loadUserNames(rows.map((row) => row.capturedBy)),
      loadStaffNames(rows.map((row) => row.witnessStaffId)),
    ]);

    const history = rows.map(
      ({ capturedBy, witnessStaffId, subjectId: _subjectId, subjectType: _subjectType, evidenceAttachmentId: _evidence, ...row }) => ({
        ...row,
        capturedByName: userNames.get(capturedBy) ?? null,
        witnessName: witnessStaffId ? (staffNames.get(witnessStaffId) ?? null) : null,
      }),
    );
    // The effective consent for a type is its latest row.
    const effective = PATIENT_CONSENT_TYPES.map((consentType) => {
      const latest = history.find((row) => row.consentType === consentType);
      return { consentType, status: latest?.status ?? "NOT_RECORDED", recordedAt: latest?.createdAt ?? null };
    });
    res.json({ data: { effective, history } });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/consents", requireAnyRole(PATIENT_CONSENT_WRITE_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "consent" });
    const payload = parseBody(consentRecordSchema, req.body);
    if (payload.captureMethod === "VERBAL_WITNESSED" && !payload.witnessStaffId) {
      throw validationError("Verbal consent needs a staff witness.", "PATIENT_CONSENT_WITNESS_REQUIRED", {
        fieldErrors: { witnessStaffId: ["Choose the staff member who witnessed the consent."] },
      });
    }
    await assertReferencesExist(null, payload.witnessStaffId);

    const now = new Date();
    const [created] = await db
      .insert(consent)
      .values({
        subjectType: "PATIENT",
        subjectId: context.patient.id,
        consentType: payload.consentType,
        status: payload.status,
        policyVersion: await resolvePolicyVersion(),
        captureMethod: payload.captureMethod,
        grantedAt: payload.status === "GRANTED" ? now : null,
        withdrawnAt: payload.status === "WITHDRAWN" ? now : null,
        capturedBy: context.actor.userId,
        witnessStaffId: payload.captureMethod === "VERBAL_WITNESSED" ? payload.witnessStaffId : null,
        guardianName: payload.guardianName,
        guardianRelationship: payload.guardianRelationship,
        note: payload.note,
      })
      .returning();
    if (!created) throw conflict("The consent could not be saved.", "PATIENT_CONSENT_NOT_SAVED");

    await writePatientAudit(req, {
      action: "CREATE",
      entityType: "consent",
      entityId: created.id,
      patientId: context.patient.id,
      after: redactForAudit({
        consentType: created.consentType,
        status: created.status,
        captureMethod: created.captureMethod,
      }),
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Timeline, photo, prints and audit                                   */
/* ------------------------------------------------------------------ */

router.get("/:id/timeline", requireAnyRole(PATIENT_TIMELINE_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_timeline" });
    res.json({ data: await loadPatientTimeline(context.patient) });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/photo", requireAnyRole(PATIENT_PHOTO_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_photo" });
    const payload = parseBody(photoSchema, req.body);
    const current = context.patient;

    if (payload.photoUrl) {
      const [latest] = await db
        .select({ status: consent.status })
        .from(consent)
        .where(
          and(
            eq(consent.subjectType, "PATIENT"),
            eq(consent.subjectId, current.id),
            eq(consent.consentType, "PHOTOGRAPHY"),
          ),
        )
        .orderBy(desc(consent.createdAt))
        .limit(1);
      if (latest?.status !== "GRANTED") {
        throw forbidden("Photography consent is required before saving a patient photo.", "CONSENT_REQUIRED", {
          consentType: "PHOTOGRAPHY",
        });
      }
    }

    const [updated] = await db
      .update(patient)
      .set({
        photoUrl: payload.photoUrl,
        photoPublicId: payload.photoUrl ? payload.photoPublicId : null,
        updatedAt: new Date(),
        updatedBy: context.actor.userId,
        version: current.version + 1,
      })
      .where(and(eq(patient.id, current.id), eq(patient.version, current.version)))
      .returning();
    if (!updated) {
      throw conflict("This patient changed. Refresh and try again.", "CONCURRENT_MODIFICATION");
    }

    // Only images in the patient folder are ever removed from storage on behalf of this route.
    if (current.photoPublicId?.startsWith("patients/") && current.photoPublicId !== updated.photoPublicId) {
      try {
        const { cloudinary } = await import("../../lib/cloudinary.js");
        await cloudinary.uploader.destroy(current.photoPublicId);
      } catch (error) {
        console.error("Failed to remove the replaced patient photo from storage", {
          requestId: req.requestId,
          error,
        });
      }
    }

    await writePatientAudit(req, {
      action: "UPDATE",
      entityType: "patient_photo",
      entityId: current.id,
      patientId: current.id,
      reason: payload.photoUrl ? "Patient photo saved" : "Patient photo removed",
    });
    res.json({ data: { photoUrl: updated.photoUrl, photoPublicId: updated.photoPublicId, version: updated.version } });
  } catch (error) {
    next(error);
  }
});

const loadPrintData = async (context: PatientContext): Promise<PatientPrintData> => {
  const [[facility], allergies] = await Promise.all([
    db.select({ facilityName: facilitySetup.facilityName }).from(facilitySetup).limit(1),
    loadActiveAllergies(context.patient.id),
  ]);
  const current = context.patient;
  return {
    facilityName: facility?.facilityName ?? "Hospital",
    firstName: current.firstName,
    middleName: current.middleName,
    lastName: current.lastName,
    mrn: current.mrn,
    sex: current.sex,
    dateOfBirth: current.dateOfBirth,
    dobEstimated: current.dobEstimated,
    ageYears: resolveAgeYears(current, context.todayIso),
    bloodGroup: context.actor.level === "FULL" ? current.bloodGroup : null,
    hasActiveAllergy: allergies.length > 0,
    hasSevereAllergy: allergies.some(
      (allergy) => allergy.severity === "SEVERE" || allergy.severity === "LIFE_THREATENING",
    ),
    printedOn: context.todayIso,
  };
};

const printRoute = (kind: "wristband" | "card", build: (data: PatientPrintData) => Buffer) =>
  router.get(`/:id/${kind}`, requireAnyRole(PATIENT_PRINT_ROLES), async (req, res, next) => {
    try {
      const context = await loadPatientContext(req, { entityType: `patient_${kind}` });
      const pdf = build(await loadPrintData(context));
      await writePatientAudit(req, {
        action: "PRINT",
        entityType: `patient_${kind}`,
        entityId: context.patient.id,
        patientId: context.patient.id,
      });
      res
        .status(200)
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${kind}-${context.patient.mrn}.pdf"`,
          "Cache-Control": "no-store",
        })
        .send(pdf);
    } catch (error) {
      next(error);
    }
  });

printRoute("wristband", buildWristbandPdf);
printRoute("card", buildPatientCardPdf);

router.get("/:id/audit", requireAnyRole(PATIENT_AUDIT_ROLES), async (req, res, next) => {
  try {
    const context = await loadPatientContext(req, { entityType: "patient_audit", allowMerged: true });
    const query = parseListQuery(req, {
      sortable: ["occurredAt"],
      filterable: ["action"],
      defaultSort: "-occurredAt",
      maxLimit: 100,
    });
    const predicates = [eq(auditLog.patientId, context.patient.id)];
    for (const filter of query.filters) {
      if (filter.field === "action" && filter.operator === "eq" && typeof filter.value === "string") {
        predicates.push(eq(auditLog.action, filter.value));
      } else if (filter.field === "action" && filter.operator === "in" && Array.isArray(filter.value)) {
        predicates.push(inArray(auditLog.action, filter.value));
      }
    }
    const where = and(...predicates);
    const [rows, totals] = await Promise.all([
      db
        .select({
          id: auditLog.id,
          occurredAt: auditLog.occurredAt,
          actorUserId: auditLog.actorUserId,
          actorRoles: auditLog.actorRoles,
          action: auditLog.action,
          entityType: auditLog.entityType,
          reason: auditLog.reason,
        })
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.occurredAt))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ total: count() }).from(auditLog).where(where),
    ]);
    const names = await loadUserNames(rows.map((row) => row.actorUserId));
    const data = rows.map(({ actorUserId, ...row }) => ({
      ...row,
      actorName: actorUserId ? (names.get(actorUserId) ?? "Unknown user") : "System",
    }));
    res.json(toPageResponse(data, query, Number(totals[0]?.total ?? 0)));
  } catch (error) {
    next(error);
  }
});

export default router;
