import type { Patient } from "../db/schema/sprintReady.js";

export const PATIENT_SEXES = ["MALE", "FEMALE", "INTERSEX", "UNKNOWN"] as const;
export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const CONFIDENTIALITY_LEVELS = ["NORMAL", "RESTRICTED", "VIP"] as const;
export const IDENTIFIER_TYPES = [
  "NHIS",
  "GHANA_CARD",
  "PASSPORT",
  "DRIVERS_LICENCE",
  "VOTER_ID",
  "SSNIT",
  "STAFF_ID",
  "EXTERNAL_MRN",
] as const;
export const CONTACT_TYPES = ["NEXT_OF_KIN", "EMERGENCY", "GUARDIAN", "EMPLOYER"] as const;
export const ALLERGY_CATEGORIES = ["DRUG", "FOOD", "LATEX", "ENVIRON", "OTHER"] as const;
export const ALLERGY_SEVERITIES = ["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING"] as const;
export const CLINICAL_ITEM_STATUSES = ["ACTIVE", "RESOLVED", "ENTERED_IN_ERROR"] as const;
export const PATIENT_CONSENT_TYPES = [
  "TREATMENT",
  "DATA_PROCESSING",
  "SMS_CONTACT",
  "INSURER_SHARING",
  "PHOTOGRAPHY",
  "RESEARCH",
] as const;
export const REQUIRED_REGISTRATION_CONSENTS = ["TREATMENT", "DATA_PROCESSING"] as const;
export const CONSENT_STATUSES = ["GRANTED", "WITHDRAWN", "DECLINED"] as const;
export const CONSENT_CAPTURE_METHODS = ["PAPER", "ELECTRONIC", "VERBAL_WITNESSED"] as const;
export const BREAK_GLASS_OUTCOMES = ["JUSTIFIED", "UNJUSTIFIED", "ESCALATED"] as const;

export type PatientSex = (typeof PATIENT_SEXES)[number];
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type ContactType = (typeof CONTACT_TYPES)[number];
export type PatientConsentType = (typeof PATIENT_CONSENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

// SUPER_ADMIN is listed explicitly so the registry follows the same convention as every other
// module (`userHasRole` lets it through). Remove it here to apply the stricter
// "no clinical data by default" posture from docs/06 §3.
export const PATIENT_FULL_READ_ROLES = [
  "super_admin",
  "registrar",
  "records_officer",
  "doctor",
  "nurse",
  "midwife",
  "dpo",
] as const;
export const PATIENT_MINIMAL_READ_ROLES = [
  "hospital_admin",
  "unit_manager",
  "cashier",
  "billing_officer",
  "pharmacist",
  "pharmacy_tech",
  "lab_scientist",
  "radiographer",
  "radiologist",
] as const;
export const PATIENT_READ_ROLES = [...PATIENT_FULL_READ_ROLES, ...PATIENT_MINIMAL_READ_ROLES] as const;
export const PATIENT_REGISTER_ROLES = ["super_admin", "registrar", "records_officer", "doctor"] as const;
export const PATIENT_EDIT_ROLES = ["super_admin", "registrar", "records_officer"] as const;
export const PATIENT_IDENTIFY_ROLES = ["super_admin", "registrar", "records_officer", "doctor"] as const;
export const PATIENT_DEMOGRAPHIC_ITEM_ROLES = [
  "super_admin",
  "registrar",
  "records_officer",
  "doctor",
  "nurse",
  "midwife",
] as const;
export const PATIENT_ALLERGY_WRITE_ROLES = ["super_admin", "doctor", "nurse", "midwife", "pharmacist"] as const;
export const PATIENT_CONDITION_WRITE_ROLES = ["super_admin", "doctor", "nurse", "midwife"] as const;
export const PATIENT_CONSENT_WRITE_ROLES = ["super_admin", "registrar", "records_officer"] as const;
export const PATIENT_PHOTO_ROLES = ["super_admin", "registrar", "records_officer"] as const;
export const PATIENT_PRINT_ROLES = [
  "super_admin",
  "registrar",
  "records_officer",
  "doctor",
  "nurse",
  "midwife",
] as const;
export const PATIENT_TIMELINE_ROLES = ["super_admin", "doctor", "nurse", "midwife", "records_officer"] as const;
export const PATIENT_MERGE_ROLES = ["super_admin", "records_officer"] as const;
export const PATIENT_AUDIT_ROLES = ["super_admin", "records_officer", "dpo"] as const;
// Unit managers review access to patients registered in their own unit subtree.
export const BREAK_GLASS_REVIEW_READ_ROLES = ["super_admin", "dpo", "auditor", "unit_manager"] as const;
export const BREAK_GLASS_REVIEW_WRITE_ROLES = ["super_admin", "dpo", "unit_manager"] as const;

export type PatientAccessLevel = "FULL" | "MINIMAL";

const hasAny = (roles: readonly string[], allowed: readonly string[]) =>
  roles.some((role) => allowed.includes(role));

export const resolvePatientAccessLevel = (roles: readonly string[]): PatientAccessLevel | null => {
  if (hasAny(roles, PATIENT_FULL_READ_ROLES)) return "FULL";
  if (hasAny(roles, PATIENT_MINIMAL_READ_ROLES)) return "MINIMAL";
  return null;
};

/** Unit managers only see patients registered in their own unit subtree. */
export const isUnitScopedPatientReader = (roles: readonly string[]) =>
  !hasAny(roles, PATIENT_FULL_READ_ROLES) &&
  roles.includes("unit_manager") &&
  !hasAny(roles, PATIENT_MINIMAL_READ_ROLES.filter((role) => role !== "unit_manager"));

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const readNumber = (raw: string | undefined, fallback: number, min: number, max: number) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

export type PatientConfig = {
  duplicateBlockThreshold: number;
  duplicateWarnThreshold: number;
  minorAgeThreshold: number;
  breakGlassReasonMinChars: number;
  breakGlassHours: number;
  privacyPolicyVersion: string | null;
  dpoEmail: string | null;
};

export const getPatientConfig = (env: Record<string, string | undefined> = process.env): PatientConfig => {
  const duplicateBlockThreshold = readNumber(env.HAMS_PATIENT_DUP_BLOCK, 0.85, 0, 1);
  const warn = readNumber(env.HAMS_PATIENT_DUP_WARN, 0.6, 0, 1);
  return {
    duplicateBlockThreshold,
    duplicateWarnThreshold: Math.min(warn, duplicateBlockThreshold),
    minorAgeThreshold: Math.trunc(readNumber(env.HAMS_MINOR_AGE_THRESHOLD, 18, 1, 30)),
    breakGlassReasonMinChars: Math.trunc(readNumber(env.HAMS_BREAK_GLASS_REASON_MIN_CHARS, 15, 1, 500)),
    breakGlassHours: 4,
    privacyPolicyVersion: env.HAMS_PRIVACY_POLICY_VERSION?.trim() || null,
    dpoEmail: env.HAMS_DPO_EMAIL?.trim() || null,
  };
};

/* ------------------------------------------------------------------ */
/* MRN, phone and identifiers                                          */
/* ------------------------------------------------------------------ */

export const MRN_PATTERN = /^MRN-\d{4}-\d{6,}$/;

export const formatMrn = (year: string | number, sequence: number) =>
  `MRN-${year}-${String(sequence).padStart(6, "0")}`;

export const looksLikeMrn = (value: string) => MRN_PATTERN.test(value.trim().toUpperCase());

/** Normalises a phone number to E.164, assuming Ghana (+233) for national formats. */
export const normalizePhoneE164 = (raw: string | null | undefined, countryCode = "233") => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `${countryCode}${digits.slice(1)}`;
  else if (digits.length === 9) digits = `${countryCode}${digits}`;
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith(countryCode) && digits.length !== countryCode.length + 9) return null;
  return `+${digits}`;
};

const IDENTIFIER_RULES: Record<IdentifierType, { pattern: RegExp; hint: string }> = {
  NHIS: { pattern: /^\d{8}$/, hint: "NHIS numbers have 8 digits." },
  GHANA_CARD: { pattern: /^GHA-\d{9}-\d$/, hint: "Ghana Card numbers look like GHA-123456789-0." },
  PASSPORT: { pattern: /^[A-Z0-9]{6,12}$/, hint: "Passport numbers have 6 to 12 letters and digits." },
  DRIVERS_LICENCE: { pattern: /^[A-Z0-9][A-Z0-9/-]{4,24}$/, hint: "Enter the licence number as printed." },
  VOTER_ID: { pattern: /^\d{10}$/, hint: "Voter card numbers have 10 digits." },
  SSNIT: { pattern: /^[A-Z0-9]{8,15}$/, hint: "SSNIT numbers have 8 to 15 letters and digits." },
  STAFF_ID: { pattern: /^[A-Z0-9][A-Z0-9/_.-]{0,49}$/, hint: "Enter the Employee ID as issued." },
  EXTERNAL_MRN: { pattern: /^[A-Z0-9][A-Z0-9/_.-]{1,59}$/, hint: "Enter the record number as printed." },
};

export const normalizeIdentifierValue = (type: IdentifierType, raw: string) => {
  let value = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (type === "GHANA_CARD") {
    const compact = value.replace(/-/g, "");
    if (/^GHA\d{10}$/.test(compact)) {
      value = `GHA-${compact.slice(3, 12)}-${compact.slice(12)}`;
    }
  }
  return value;
};

export const validateIdentifier = (type: IdentifierType, raw: string) => {
  const value = normalizeIdentifierValue(type, raw);
  const rule = IDENTIFIER_RULES[type];
  if (!rule.pattern.test(value)) {
    return { ok: false as const, value, message: rule.hint };
  }
  return { ok: true as const, value };
};

/* ------------------------------------------------------------------ */
/* Age                                                                 */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidIsoDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day
  );
};

/** Whole years between an ISO date and a reference ISO date (both facility-local). */
export const yearsBetween = (fromIso: string, toIso: string) => {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let years = (ty ?? 0) - (fy ?? 0);
  if ((tm ?? 0) < (fm ?? 0) || ((tm ?? 0) === (fm ?? 0) && (td ?? 0) < (fd ?? 0))) years -= 1;
  return years;
};

export type AgeSource = {
  dateOfBirth: string | null;
  estimatedAgeYears: number | null;
  registeredAt?: Date | string | null;
};

/**
 * Current age in whole years. When only an estimated age was captured, it is aged forward by the
 * time elapsed since registration.
 */
export const resolveAgeYears = (source: AgeSource, todayIso: string): number | null => {
  if (source.dateOfBirth) return Math.max(0, yearsBetween(source.dateOfBirth, todayIso));
  if (source.estimatedAgeYears === null || source.estimatedAgeYears === undefined) return null;
  if (!source.registeredAt) return source.estimatedAgeYears;
  const registeredIso =
    source.registeredAt instanceof Date
      ? source.registeredAt.toISOString().slice(0, 10)
      : String(source.registeredAt).slice(0, 10);
  if (!isValidIsoDate(registeredIso)) return source.estimatedAgeYears;
  return source.estimatedAgeYears + Math.max(0, yearsBetween(registeredIso, todayIso));
};

export const isMinorAge = (ageYears: number | null, threshold: number) =>
  ageYears !== null && ageYears < threshold;

/* ------------------------------------------------------------------ */
/* Unidentified patients                                               */
/* ------------------------------------------------------------------ */

export const unidentifiedSexLabel = (sex: PatientSex) => (sex === "UNKNOWN" ? "PERSON" : sex);

/** Placeholder name for an emergency "unknown patient", e.g. `UNKNOWN MALE 20261012-03`. */
export const unidentifiedPlaceholderName = (sex: PatientSex, localDate: string, sequence: number) => ({
  firstName: "UNKNOWN",
  lastName: `${unidentifiedSexLabel(sex)} ${localDate.replace(/-/g, "")}-${String(sequence).padStart(2, "0")}`,
});

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

export type DuplicateSignals = {
  nameSimilarity: number;
  dobMatch: boolean;
  phoneMatch: boolean;
  phoneticMatch: boolean;
  identifierMatch: boolean;
};

export type DuplicateLevel = "BLOCK" | "WARN" | "NONE";

export const scoreDuplicate = (signals: DuplicateSignals) => {
  if (signals.identifierMatch) return 1;
  const score =
    0.5 * Math.max(0, Math.min(1, signals.nameSimilarity)) +
    0.3 * (signals.dobMatch ? 1 : 0) +
    0.15 * (signals.phoneMatch ? 1 : 0) +
    0.05 * (signals.phoneticMatch ? 1 : 0);
  return Math.round(score * 1000) / 1000;
};

export const classifyDuplicate = (
  score: number,
  thresholds: Pick<PatientConfig, "duplicateBlockThreshold" | "duplicateWarnThreshold">,
): DuplicateLevel => {
  if (score >= thresholds.duplicateBlockThreshold) return "BLOCK";
  if (score >= thresholds.duplicateWarnThreshold) return "WARN";
  return "NONE";
};

export const duplicateReasons = (signals: DuplicateSignals) => {
  const reasons: string[] = [];
  if (signals.identifierMatch) reasons.push("IDENTIFIER");
  if (signals.nameSimilarity >= 0.5) reasons.push("NAME");
  if (signals.dobMatch) reasons.push("DATE_OF_BIRTH");
  if (signals.phoneMatch) reasons.push("PHONE");
  if (signals.phoneticMatch) reasons.push("SURNAME_SOUNDS_ALIKE");
  return reasons;
};

/** Orders a pair so that it satisfies `patient_dup_order_ck` (a < b, compared as uuid). */
export const orderDuplicatePair = (first: string, second: string): [string, string] =>
  first.toLowerCase() < second.toLowerCase() ? [first, second] : [second, first];

/* ------------------------------------------------------------------ */
/* Registration rules                                                  */
/* ------------------------------------------------------------------ */

export type RegistrationContactDraft = {
  contactType: ContactType;
  name: string;
  phone?: string | null | undefined;
  canConsent?: boolean | undefined;
};

export type RegistrationConsentDraft = {
  consentType: PatientConsentType;
  status: (typeof CONSENT_STATUSES)[number];
};

export type RegistrationDraft = {
  unidentified: boolean;
  dateOfBirth: string | null;
  estimatedAgeYears: number | null;
  phone: string | null;
  contacts: RegistrationContactDraft[];
  consents: RegistrationConsentDraft[];
  captureMethod?: (typeof CONSENT_CAPTURE_METHODS)[number] | undefined;
  witnessStaffId?: string | null | undefined;
  identifiers: Array<{ idType: IdentifierType; idValue: string }>;
};

export type RuleViolation = { code: string; message: string; field: string };

const CONTACTABLE_TYPES: ContactType[] = ["NEXT_OF_KIN", "EMERGENCY", "GUARDIAN"];

export const hasConsentingGuardian = (
  contacts: ReadonlyArray<{ contactType: string; canConsent?: boolean | undefined }>,
) => contacts.some((contact) => contact.contactType === "GUARDIAN" && contact.canConsent === true);

export const hasContactPerson = (contacts: ReadonlyArray<{ contactType: string }>) =>
  contacts.some((contact) => (CONTACTABLE_TYPES as string[]).includes(contact.contactType));

/**
 * Business rules from docs/10 §1.2. Identity, consent and contact rules are waived for the
 * emergency unidentified-patient flow; they are enforced when the patient is identified.
 */
export const checkRegistrationRules = (
  draft: RegistrationDraft,
  context: { todayIso: string; config: Pick<PatientConfig, "minorAgeThreshold"> },
): RuleViolation[] => {
  const violations: RuleViolation[] = [];

  if (draft.dateOfBirth) {
    if (!isValidIsoDate(draft.dateOfBirth)) {
      violations.push({
        code: "PATIENT_DOB_INVALID",
        field: "dateOfBirth",
        message: "Date of birth must be a valid date.",
      });
    } else if (draft.dateOfBirth > context.todayIso) {
      violations.push({
        code: "PATIENT_DOB_INVALID",
        field: "dateOfBirth",
        message: "Date of birth must be in the past.",
      });
    } else if (yearsBetween(draft.dateOfBirth, context.todayIso) > 130) {
      violations.push({
        code: "PATIENT_DOB_INVALID",
        field: "dateOfBirth",
        message: "Date of birth is too far in the past.",
      });
    }
  } else if (draft.estimatedAgeYears === null) {
    violations.push({
      code: "PATIENT_AGE_REQUIRED",
      field: "dateOfBirth",
      message: "Enter the date of birth or an estimated age.",
    });
  }

  const seenTypes = new Set<string>();
  draft.identifiers.forEach((identifier, index) => {
    const result = validateIdentifier(identifier.idType, identifier.idValue);
    if (!result.ok) {
      violations.push({
        code: "PATIENT_IDENTIFIER_INVALID",
        field: `identifiers.${index}.idValue`,
        message: result.message,
      });
    }
    if (seenTypes.has(identifier.idType)) {
      violations.push({
        code: "PATIENT_IDENTIFIER_DUPLICATE",
        field: `identifiers.${index}.idType`,
        message: "Each identifier type can only be captured once.",
      });
    }
    seenTypes.add(identifier.idType);
  });

  if (draft.phone && !normalizePhoneE164(draft.phone)) {
    violations.push({ code: "PATIENT_PHONE_INVALID", field: "phone", message: "Enter a valid phone number." });
  }

  if (draft.unidentified) return violations;

  if (!draft.phone && !hasContactPerson(draft.contacts)) {
    violations.push({
      code: "PATIENT_CONTACT_REQUIRED",
      field: "phone",
      message: "Capture a phone number or a next of kin.",
    });
  }

  const ageKnown = !violations.some(
    (violation) => violation.code === "PATIENT_DOB_INVALID" || violation.code === "PATIENT_AGE_REQUIRED",
  );
  const age = ageKnown
    ? resolveAgeYears(
        { dateOfBirth: draft.dateOfBirth, estimatedAgeYears: draft.estimatedAgeYears },
        context.todayIso,
      )
    : null;
  if (isMinorAge(age, context.config.minorAgeThreshold) && !hasConsentingGuardian(draft.contacts)) {
    violations.push({
      code: "PATIENT_GUARDIAN_REQUIRED",
      field: "contacts",
      message: `Patients under ${context.config.minorAgeThreshold} need a guardian who can consent.`,
    });
  }

  for (const required of REQUIRED_REGISTRATION_CONSENTS) {
    const granted = draft.consents.some(
      (entry) => entry.consentType === required && entry.status === "GRANTED",
    );
    if (!granted) {
      violations.push({
        code: "PATIENT_CONSENT_REQUIRED",
        field: "consents",
        message: "Treatment and data-processing consent must be granted at registration.",
      });
      break;
    }
  }

  if (draft.captureMethod === "VERBAL_WITNESSED" && !draft.witnessStaffId) {
    violations.push({
      code: "PATIENT_CONSENT_WITNESS_REQUIRED",
      field: "witnessStaffId",
      message: "Verbal consent needs a staff witness.",
    });
  }

  return violations;
};

/* ------------------------------------------------------------------ */
/* Role-aware serialisation                                            */
/* ------------------------------------------------------------------ */

const MINIMAL_REDACTED_FIELDS = [
  "maritalStatus",
  "nationality",
  "religion",
  "occupation",
  "bloodGroup",
  "phone",
  "altPhone",
  "email",
  "addressLine",
  "town",
  "district",
  "region",
  "digitalAddress",
  "identifiers",
  "contacts",
] as const;

export const fullName = (patient: Pick<Patient, "firstName" | "middleName" | "lastName">) =>
  [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(" ");

export type SerializeContext = { level: PatientAccessLevel; todayIso: string; minorAgeThreshold: number };

const baseIdentity = (patient: Patient, context: SerializeContext) => {
  const ageYears = resolveAgeYears(patient, context.todayIso);
  return {
    id: patient.id,
    mrn: patient.mrn,
    firstName: patient.firstName,
    middleName: patient.middleName,
    lastName: patient.lastName,
    preferredName: patient.preferredName,
    fullName: fullName(patient),
    sex: patient.sex,
    dateOfBirth: patient.dateOfBirth,
    dobEstimated: patient.dobEstimated,
    estimatedAgeYears: patient.estimatedAgeYears,
    ageYears,
    isMinor: isMinorAge(ageYears, context.minorAgeThreshold),
    photoUrl: patient.photoUrl,
    status: patient.status,
    deceasedAt: patient.deceasedAt,
    confidentiality: patient.confidentiality,
    isUnidentified: patient.isUnidentified,
    registeredAt: patient.registeredAt,
    masked: false as const,
  };
};

/** Row for search/list results. */
export const serializePatientSummary = (patient: Patient, context: SerializeContext) => {
  const identity = baseIdentity(patient, context);
  if (context.level === "MINIMAL") {
    return { ...identity, redacted: ["phone"] };
  }
  return { ...identity, phone: patient.phone, redacted: [] as string[] };
};

/** Search row for a RESTRICTED/VIP patient the caller holds no break-glass grant for. */
export const maskPatientSummary = (patient: Pick<Patient, "id" | "confidentiality" | "status">) => ({
  id: patient.id,
  mrn: null,
  firstName: null,
  middleName: null,
  lastName: null,
  preferredName: null,
  fullName: "Restricted record",
  sex: null,
  dateOfBirth: null,
  dobEstimated: false,
  estimatedAgeYears: null,
  ageYears: null,
  isMinor: false,
  photoUrl: null,
  status: patient.status,
  deceasedAt: null,
  confidentiality: patient.confidentiality,
  isUnidentified: false,
  registeredAt: null,
  masked: true as const,
  redacted: ["identity"],
});

/** Full chart header. Restricted fields are absent (not null) for minimal roles. */
export const serializePatientDetail = (patient: Patient, context: SerializeContext) => {
  const identity = baseIdentity(patient, context);
  if (context.level === "MINIMAL") {
    return { ...identity, redacted: [...MINIMAL_REDACTED_FIELDS] as string[] };
  }
  return {
    ...identity,
    maritalStatus: patient.maritalStatus,
    nationality: patient.nationality,
    religion: patient.religion,
    occupation: patient.occupation,
    bloodGroup: patient.bloodGroup,
    phone: patient.phone,
    altPhone: patient.altPhone,
    email: patient.email,
    addressLine: patient.addressLine,
    town: patient.town,
    district: patient.district,
    region: patient.region,
    digitalAddress: patient.digitalAddress,
    photoPublicId: patient.photoPublicId,
    mergedIntoId: patient.mergedIntoId,
    registeredUnitId: patient.registeredUnitId,
    version: patient.version,
    updatedAt: patient.updatedAt,
    redacted: [] as string[],
  };
};

/* ------------------------------------------------------------------ */
/* Audit redaction                                                     */
/* ------------------------------------------------------------------ */

const AUDIT_CLEAR_FIELDS = new Set([
  "sex",
  "dobEstimated",
  "maritalStatus",
  "bloodGroup",
  "status",
  "confidentiality",
  "isUnidentified",
  "registeredUnitId",
  "mergedIntoId",
  "version",
  "idType",
  "contactType",
  "category",
  "severity",
  "isChronic",
  "isPrimary",
  "canConsent",
  "verified",
  "consentType",
  "captureMethod",
]);

/** Keeps the shape of a change for the audit trail while removing personal values. */
export const redactForAudit = (record: Record<string, unknown> | null | undefined) => {
  if (!record) return null;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      output[key] = null;
    } else if (AUDIT_CLEAR_FIELDS.has(key) || typeof value === "boolean") {
      output[key] = value;
    } else {
      output[key] = "[REDACTED]";
    }
  }
  return output;
};

/** Fields that differ between two versions of a record. */
export const changedFields = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.keys(after).filter((key) => {
    const left = before[key];
    const right = after[key];
    if (left instanceof Date && right instanceof Date) return left.getTime() !== right.getTime();
    return (left ?? null) !== (right ?? null);
  });
