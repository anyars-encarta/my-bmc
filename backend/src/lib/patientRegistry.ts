import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  admission,
  appointment,
  claim,
  encounter,
  imagingOrder,
  labOrder,
  orgUnit,
  patient,
  patientAllergy,
  patientCondition,
  patientContact,
  patientDuplicateCandidate,
  patientIdentifier,
  patientMergeLog,
  patientMergeTask,
  visit,
  type Patient,
} from "../db/schema/index.js";
import { ApiError, conflict, notFound, validationError } from "./errors.js";
import { nowAtFacility } from "./facilityClock.js";
import type { ListQuery } from "./listQuery.js";
import {
  classifyDuplicate,
  duplicateReasons,
  getPatientConfig,
  looksLikeMrn,
  normalizePhoneE164,
  orderDuplicatePair,
  scoreDuplicate,
  unidentifiedSexLabel,
  type DuplicateLevel,
  type DuplicateSignals,
  type IdentifierType,
  type PatientConfig,
  type PatientSex,
} from "./patientRules.js";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

export const facilityToday = async () => {
  const clock = await nowAtFacility();
  const todayIso = clock.localDateTime.slice(0, 10);
  return { todayIso, year: todayIso.slice(0, 4) };
};

/** Finds the SQLSTATE and constraint of a database error, including wrapped driver errors. */
export const databaseErrorInfo = (error: unknown) => {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        sqlState: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : "",
        message: typeof candidate.message === "string" ? candidate.message : "",
      };
    }
    current = candidate.cause;
  }
  return null;
};

const isIdentifierConflict = (error: unknown) => {
  const info = databaseErrorInfo(error);
  return (
    info?.sqlState === "23505" &&
    (info.constraint === "patient_identifier_active_uq" || info.message.includes("patient_identifier_active_uq"))
  );
};

export const identifierInUse = () =>
  conflict("This identifier is already registered to another patient.", "PATIENT_IDENTIFIER_IN_USE");

const affectedRows = (result: unknown) => Number((result as { rowCount?: number | null }).rowCount ?? 0);

const nameKeyOf = (value: string) => sql`immutable_unaccent(lower(${value}))`;

export const loadPatient = async (id: string) => {
  const [row] = await db.select().from(patient).where(eq(patient.id, id)).limit(1);
  return row ?? null;
};

/** Follows `merged_into_id` to the surviving record. */
export const resolveSurvivor = async (start: Patient) => {
  let current = start;
  for (let hop = 0; hop < 10 && current.status === "MERGED" && current.mergedIntoId; hop += 1) {
    const next = await loadPatient(current.mergedIntoId);
    if (!next) break;
    current = next;
  }
  return current;
};

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export type PatientSearchResult = {
  rows: Patient[];
  total: number;
  mergedFromMrn: string | null;
};

const SORT_COLUMNS = {
  lastName: patient.lastName,
  registeredAt: patient.registeredAt,
  mrn: patient.mrn,
} as const;

const parseDateFilter = (field: string, value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError(`${field} filter must be a valid date.`, "LIST_FILTER_INVALID", { field, value });
  }
  return parsed;
};

const buildFilterPredicates = (query: ListQuery) => {
  const predicates: SQL[] = [];
  let statusFiltered = false;

  for (const filter of query.filters) {
    const { field, operator, value } = filter;
    if (field === "status" && operator === "eq" && typeof value === "string") {
      predicates.push(eq(patient.status, value));
      statusFiltered = true;
    } else if (field === "status" && operator === "in" && Array.isArray(value)) {
      predicates.push(inArray(patient.status, value));
      statusFiltered = true;
    } else if (field === "sex" && operator === "eq" && typeof value === "string") {
      predicates.push(eq(patient.sex, value));
    } else if (field === "confidentiality" && operator === "eq" && typeof value === "string") {
      predicates.push(eq(patient.confidentiality, value));
    } else if (field === "isUnidentified" && operator === "eq" && typeof value === "string") {
      predicates.push(eq(patient.isUnidentified, value === "true"));
    } else if (field === "registeredAt" && operator === "gte" && typeof value === "string") {
      predicates.push(gte(patient.registeredAt, parseDateFilter(field, value)));
    } else if (field === "registeredAt" && operator === "lte" && typeof value === "string") {
      predicates.push(lte(patient.registeredAt, parseDateFilter(field, value)));
    } else {
      throw validationError(`Unsupported filter '${field}__${operator}'.`, "LIST_FILTER_UNSUPPORTED", {
        field,
        operator,
      });
    }
  }

  if (!statusFiltered) predicates.push(ne(patient.status, "MERGED"));
  return predicates;
};

const findPatientIdsByIdentifierValue = async (value: string) => {
  const rows = await db
    .select({ patientId: patientIdentifier.patientId })
    .from(patientIdentifier)
    .where(and(eq(patientIdentifier.status, "ACTIVE"), eq(patientIdentifier.idValue, value)))
    .limit(20);
  return rows.map((row) => row.patientId);
};

/**
 * Patient search (docs/10 ?1): exact lookups by MRN, phone and identifier number plus word-level
 * trigram similarity on the unaccented name key. When nothing matches directly, the search widens
 * to surnames that sound alike (double metaphone).
 */
export const searchPatients = async (
  query: ListQuery,
  options: { unitIds: string[] | null; sortExplicit: boolean },
): Promise<PatientSearchResult> => {
  const filters = buildFilterPredicates(query);
  if (options.unitIds !== null) {
    if (options.unitIds.length === 0) return { rows: [], total: 0, mergedFromMrn: null };
    filters.push(inArray(patient.registeredUnitId, options.unitIds));
  }

  const sortKeys = () =>
    query.sort.map((entry) => {
      const column = SORT_COLUMNS[entry.field as keyof typeof SORT_COLUMNS];
      return entry.descending ? desc(column) : asc(column);
    });

  // The match, ranking and count run over a narrow projection; only the page itself is widened to
  // full rows, which keeps broad searches (a common surname) cheap.
  const runPage = async (match: SQL | undefined, rank: SQL<number> | null) => {
    const where = and(...filters, match);
    const ranked = rank !== null && !options.sortExplicit;
    const hits = db
      .select({
        id: patient.id,
        rank: (rank ?? sql<number>`0`).as("rank"),
        total: sql<number>`count(*) OVER()`.as("total"),
      })
      .from(patient)
      .where(where)
      .orderBy(
        // Sorting by the output column avoids computing the similarity a second time per row.
        ...(ranked
          ? [sql`"rank" DESC`, asc(patient.lastName), asc(patient.firstName), asc(patient.id)]
          : [...sortKeys(), asc(patient.id)]),
      )
      .limit(query.limit)
      .offset(query.offset)
      .as("hits");

    const rows = await db
      .select({ row: patient, total: hits.total })
      .from(hits)
      .innerJoin(patient, eq(patient.id, hits.id))
      .orderBy(
        ...(ranked
          ? [desc(hits.rank), asc(patient.lastName), asc(patient.firstName), asc(patient.id)]
          : [...sortKeys(), asc(patient.id)]),
      );

    let total = Number(rows[0]?.total ?? 0);
    if (rows.length === 0 && query.offset > 0) {
      const [counted] = await db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(patient)
        .where(where);
      total = counted?.total ?? 0;
    }
    return { rows: rows.map((entry) => entry.row), total, mergedFromMrn: null };
  };

  const q = query.q?.trim() ?? "";
  if (!q) return runPage(undefined, null);

  const upper = q.toUpperCase();
  if (looksLikeMrn(upper)) {
    const [byMrn] = await db.select().from(patient).where(eq(patient.mrn, upper)).limit(1);
    if (byMrn?.status === "MERGED") {
      const survivor = await resolveSurvivor(byMrn);
      const visible =
        survivor.status !== "MERGED" &&
        (options.unitIds === null ||
          (survivor.registeredUnitId !== null && options.unitIds.includes(survivor.registeredUnitId)));
      return visible
        ? { rows: [survivor], total: 1, mergedFromMrn: upper }
        : { rows: [], total: 0, mergedFromMrn: null };
    }
  }

  const exactArms: SQL[] = [eq(patient.mrn, upper)];
  if (/^MRN-?\d/.test(upper)) {
    exactArms.push(sql`${patient.mrn} LIKE ${`${upper.replace(/[\\%_]/g, "\\$&")}%`}`);
  }
  const phone = normalizePhoneE164(q);
  if (phone) exactArms.push(eq(patient.phoneE164, phone));
  if (/\d{4,}/.test(q)) {
    const identifierPatientIds = await findPatientIdsByIdentifierValue(upper.replace(/\s+/g, ""));
    if (identifierPatientIds.length > 0) exactArms.push(inArray(patient.id, identifierPatientIds));
  }

  const tokens = q.split(/\s+/).filter((token) => /^\p{L}{2,}/u.test(token)).slice(0, 4);
  const key = nameKeyOf(q);
  const rank = sql<number>`CASE WHEN ${or(...exactArms)} THEN 2 ELSE similarity(${patient.nameKey}, ${key}) END`;
  if (tokens.length === 0) return runPage(or(...exactArms), rank);

  // `name_key %> key` is the form the trigram index stores, so the planner does not re-check it as a filter.
  const direct = await runPage(or(...exactArms, sql`${patient.nameKey} %> ${key}`), rank);
  if (direct.total > 0) return direct;

  const soundsAlike = sql`(${patient.surnamePhonetic} IN (${sql.join(
    tokens.map((token) => sql`dmetaphone(immutable_unaccent(${token}))`),
    sql`, `,
  )}) AND word_similarity(${key}, ${patient.nameKey}) >= 0.3)`;
  return runPage(soundsAlike, rank);
};

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

export type DuplicateDraft = {
  firstName: string;
  middleName?: string | null | undefined;
  lastName: string;
  dateOfBirth?: string | null | undefined;
  phone?: string | null | undefined;
  identifiers?: Array<{ idType: IdentifierType; idValue: string }> | undefined;
  excludePatientId?: string | null | undefined;
};

export type DuplicateCandidate = {
  patient: Patient;
  score: number;
  level: Exclude<DuplicateLevel, "NONE">;
  reasons: string[];
  signals: DuplicateSignals;
};

// Without a date-of-birth, phone or identifier match a candidate can score at most 0.5 + 0.05.
const MAX_NAME_ONLY_SCORE = 0.55;

/** `DuplicateDetector.findCandidates` from docs/10 §1.3. */
export const findDuplicateCandidates = async (
  draft: DuplicateDraft,
  config: PatientConfig = getPatientConfig(),
): Promise<DuplicateCandidate[]> => {
  const key = nameKeyOf(`${draft.lastName} ${draft.firstName} ${draft.middleName ?? ""}`);
  const dob = draft.dateOfBirth ?? null;
  const phone = normalizePhoneE164(draft.phone);
  const identifiers = draft.identifiers ?? [];

  let identifierPatientIds: string[] = [];
  if (identifiers.length > 0) {
    const rows = await db
      .select({ patientId: patientIdentifier.patientId })
      .from(patientIdentifier)
      .where(
        and(
          eq(patientIdentifier.status, "ACTIVE"),
          or(
            ...identifiers.map((identifier) =>
              and(
                eq(patientIdentifier.idType, identifier.idType),
                eq(patientIdentifier.idValue, identifier.idValue),
              ),
            ),
          ),
        ),
      );
    identifierPatientIds = [...new Set(rows.map((row) => row.patientId))];
  }

  const arms: SQL[] = [];
  if (dob) arms.push(sql`${patient.dateOfBirth} = ${dob}::date`);
  if (phone) arms.push(eq(patient.phoneE164, phone));
  if (identifierPatientIds.length > 0) arms.push(inArray(patient.id, identifierPatientIds));
  if (config.duplicateWarnThreshold <= MAX_NAME_ONLY_SCORE) {
    arms.push(sql`${patient.nameKey} % ${key}`);
    arms.push(sql`${patient.surnamePhonetic} = dmetaphone(immutable_unaccent(${draft.lastName}))`);
  }
  if (arms.length === 0) return [];

  const nameSimilarity = sql<number>`similarity(${patient.nameKey}, ${key})`.mapWith(Number);
  const dobMatch = dob
    ? sql<boolean>`coalesce(${patient.dateOfBirth} = ${dob}::date, false)`
    : sql<boolean>`false`;
  const phoneMatch = phone
    ? sql<boolean>`coalesce(${patient.phoneE164} = ${phone}, false)`
    : sql<boolean>`false`;
  const phoneticMatch = sql<boolean>`coalesce(${patient.surnamePhonetic} = dmetaphone(immutable_unaccent(${draft.lastName})), false)`;
  const identifierMatch =
    identifierPatientIds.length > 0
      ? sql<boolean>`${inArray(patient.id, identifierPatientIds)}`
      : sql<boolean>`false`;
  const sqlScore = sql<number>`CASE WHEN ${identifierMatch} THEN 1.0 ELSE
    0.5 * similarity(${patient.nameKey}, ${key}) + 0.3 * (${dobMatch})::int
    + 0.15 * (${phoneMatch})::int + 0.05 * (${phoneticMatch})::int END`;

  const predicates: SQL[] = [inArray(patient.status, ["ACTIVE", "INACTIVE"]), or(...arms) as SQL];
  if (draft.excludePatientId) predicates.push(ne(patient.id, draft.excludePatientId));

  const rows = await db
    .select({ row: patient, nameSimilarity, dobMatch, phoneMatch, phoneticMatch, identifierMatch })
    .from(patient)
    .where(and(...predicates))
    .orderBy(desc(sqlScore), asc(patient.id))
    .limit(25);

  return rows
    .map((entry) => {
      const signals: DuplicateSignals = {
        nameSimilarity: entry.nameSimilarity,
        dobMatch: entry.dobMatch === true,
        phoneMatch: entry.phoneMatch === true,
        phoneticMatch: entry.phoneticMatch === true,
        identifierMatch: entry.identifierMatch === true,
      };
      const score = scoreDuplicate(signals);
      return { patient: entry.row, score, level: classifyDuplicate(score, config), reasons: duplicateReasons(signals), signals };
    })
    .filter((candidate): candidate is DuplicateCandidate => candidate.level !== "NONE")
    .slice(0, 10);
};

/** Queues candidate pairs for records-officer review; existing pairs are left untouched. */
export const recordDuplicateCandidates = async (
  patientId: string,
  candidates: Array<Pick<DuplicateCandidate, "score" | "reasons"> & { patient: Pick<Patient, "id"> }>,
  source: "REGISTRATION" | "SWEEP" | "MANUAL",
) => {
  const values = candidates
    .filter((candidate) => candidate.patient.id !== patientId)
    .map((candidate) => {
      const [patientAId, patientBId] = orderDuplicatePair(patientId, candidate.patient.id);
      return {
        patientAId,
        patientBId,
        score: candidate.score.toFixed(3),
        reasons: candidate.reasons,
        source,
      };
    });
  if (values.length === 0) return 0;
  const inserted = await db
    .insert(patientDuplicateCandidate)
    .values(values)
    .onConflictDoNothing({
      target: [patientDuplicateCandidate.patientAId, patientDuplicateCandidate.patientBId],
    })
    .returning({ id: patientDuplicateCandidate.id });
  return inserted.length;
};

/** Nightly sweep: re-checks recently registered or changed patients against the whole registry. */
export const sweepDuplicateCandidates = async (options: { sinceHours?: number; limit?: number } = {}) => {
  const sinceHours = options.sinceHours ?? 25;
  const recent = await db
    .select()
    .from(patient)
    .where(
      and(
        inArray(patient.status, ["ACTIVE", "INACTIVE"]),
        eq(patient.isUnidentified, false),
        sql`${patient.updatedAt} >= now() - make_interval(hours => ${sinceHours})`,
      ),
    )
    .orderBy(desc(patient.updatedAt))
    .limit(options.limit ?? 500);

  const config = getPatientConfig();
  let queued = 0;
  for (const row of recent) {
    const identifiers = await db
      .select({ idType: patientIdentifier.idType, idValue: patientIdentifier.idValue })
      .from(patientIdentifier)
      .where(and(eq(patientIdentifier.patientId, row.id), eq(patientIdentifier.status, "ACTIVE")));
    const candidates = await findDuplicateCandidates(
      {
        firstName: row.firstName,
        middleName: row.middleName,
        lastName: row.lastName,
        dateOfBirth: row.dateOfBirth,
        phone: row.phoneE164,
        identifiers: identifiers as Array<{ idType: IdentifierType; idValue: string }>,
        excludePatientId: row.id,
      },
      config,
    );
    queued += await recordDuplicateCandidates(row.id, candidates, "SWEEP");
  }
  return { scanned: recent.length, queued };
};

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export type PatientDemographics = {
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  sex: PatientSex;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  estimatedAgeYears: number | null;
  maritalStatus: string | null;
  nationality: string | null;
  religion: string | null;
  occupation: string | null;
  bloodGroup: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  addressLine: string | null;
  town: string | null;
  district: string | null;
  region: string | null;
  digitalAddress: string | null;
};

export type PatientChildRecords = {
  identifiers: Array<{ idType: IdentifierType; idValue: string; issuer: string | null; validTo: string | null }>;
  contacts: Array<{
    contactType: string;
    name: string;
    relationship: string | null;
    phone: string | null;
    address: string | null;
    isPrimary: boolean;
    canConsent: boolean;
  }>;
  consents: Array<{ consentType: string; status: string; note: string | null }>;
  captureMethod: string;
  witnessStaffId: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  policyVersion: string;
};

export type CreatePatientInput = PatientDemographics &
  PatientChildRecords & {
    unidentified: boolean;
    confidentiality: string;
    registeredUnitId: string | null;
  };

/** Data-modifying CTEs that attach identifiers, contacts and consents to the row in `source`. */
const childRecordCtes = (source: SQL, input: PatientChildRecords, userId: string) => {
  const identifiers = JSON.stringify(
    input.identifiers.map((entry) => ({
      id_type: entry.idType,
      id_value: entry.idValue,
      issuer: entry.issuer,
      valid_to: entry.validTo,
    })),
  );
  const contacts = JSON.stringify(
    input.contacts.map((entry) => ({
      contact_type: entry.contactType,
      name: entry.name,
      relationship: entry.relationship,
      phone: entry.phone,
      address: entry.address,
      is_primary: entry.isPrimary,
      can_consent: entry.canConsent,
    })),
  );
  const consents = JSON.stringify(
    input.consents.map((entry) => ({ consent_type: entry.consentType, status: entry.status, note: entry.note })),
  );

  return sql`
    new_identifiers AS (
      INSERT INTO patient_identifier (patient_id, id_type, id_value, issuer, valid_to)
      SELECT src.id, x.id_type, x.id_value, x.issuer, x.valid_to
      FROM ${source} src
      CROSS JOIN jsonb_to_recordset(${identifiers}::jsonb)
        AS x(id_type text, id_value text, issuer text, valid_to date)
      RETURNING id
    ),
    new_contacts AS (
      INSERT INTO patient_contact (patient_id, contact_type, name, relationship, phone, address, is_primary, can_consent)
      SELECT src.id, x.contact_type, x.name, x.relationship, x.phone, x.address,
             coalesce(x.is_primary, false), coalesce(x.can_consent, false)
      FROM ${source} src
      CROSS JOIN jsonb_to_recordset(${contacts}::jsonb)
        AS x(contact_type text, name text, relationship text, phone text, address text,
             is_primary boolean, can_consent boolean)
      RETURNING id
    ),
    new_consents AS (
      INSERT INTO consent (subject_type, subject_id, consent_type, status, policy_version, granted_at,
                           capture_method, captured_by, witness_staff_id, guardian_name,
                           guardian_relationship, note)
      SELECT 'PATIENT', src.id, x.consent_type, x.status, ${input.policyVersion}::text,
             CASE WHEN x.status = 'GRANTED' THEN now() END,
             ${input.captureMethod}::text, ${userId}::text, ${input.witnessStaffId}::uuid,
             ${input.guardianName}::text, ${input.guardianRelationship}::text, x.note
      FROM ${source} src
      CROSS JOIN jsonb_to_recordset(${consents}::jsonb) AS x(consent_type text, status text, note text)
      RETURNING id
    )`;
};

/**
 * Registers a patient in one statement: the MRN allocation, the patient row and its identifiers,
 * contacts and consents commit or roll back together, which keeps MRNs gapless without an
 * interactive transaction.
 */
export const createPatient = async (input: CreatePatientInput, userId: string) => {
  const { todayIso, year } = await facilityToday();
  const dateKey = todayIso.replace(/-/g, "");
  const lastName = input.unidentified
    ? sql`${unidentifiedSexLabel(input.sex)}::text || ' ' || ${dateKey}::text || '-' || lpad(next_doc_number('UNKNOWN_PT', ${dateKey}::text)::text, 2, '0')`
    : sql`${input.lastName}`;

  try {
    const result = await db.execute<{ id: string }>(sql`
      WITH new_patient AS (
        INSERT INTO patient (
          mrn, first_name, middle_name, last_name, preferred_name, sex, date_of_birth, dob_estimated,
          estimated_age_years, marital_status, nationality, religion, occupation, blood_group, phone,
          phone_e164, alt_phone, email, address_line, town, district, region, digital_address,
          confidentiality, is_unidentified, registered_unit_id, created_by, updated_by
        ) VALUES (
          'MRN-' || ${year}::text || '-' || lpad(next_doc_number('MRN', ${year}::text)::text, 6, '0'),
          ${input.unidentified ? "UNKNOWN" : input.firstName}, ${input.middleName}, ${lastName},
          ${input.preferredName}, ${input.sex}, ${input.dateOfBirth}, ${input.dobEstimated},
          ${input.estimatedAgeYears}, ${input.maritalStatus}, ${input.nationality}, ${input.religion},
          ${input.occupation}, ${input.bloodGroup}, ${input.phone}, ${normalizePhoneE164(input.phone)},
          ${input.altPhone}, ${input.email}, ${input.addressLine}, ${input.town}, ${input.district},
          ${input.region}, ${input.digitalAddress}, ${input.confidentiality}, ${input.unidentified},
          ${input.registeredUnitId}, ${userId}, ${userId}
        )
        RETURNING id
      ),
      ${childRecordCtes(sql`new_patient`, input, userId)}
      SELECT id FROM new_patient
    `);
    const id = (result.rows[0] as { id?: string } | undefined)?.id;
    const created = id ? await loadPatient(id) : null;
    if (!created) throw new ApiError(500, "PATIENT_CREATE_FAILED", "The patient could not be registered.");
    return created;
  } catch (error) {
    if (isIdentifierConflict(error)) throw identifierInUse();
    throw error;
  }
};

/** Converts an unidentified patient into an identified one, attaching the captured records. */
export const identifyPatient = async (
  id: string,
  expectedVersion: number,
  input: PatientDemographics & PatientChildRecords,
  userId: string,
) => {
  try {
    const result = await db.execute<{ id: string }>(sql`
      WITH identified AS (
        UPDATE patient SET
          first_name = ${input.firstName}, middle_name = ${input.middleName}, last_name = ${input.lastName},
          preferred_name = ${input.preferredName}, sex = ${input.sex}, date_of_birth = ${input.dateOfBirth},
          dob_estimated = ${input.dobEstimated}, estimated_age_years = ${input.estimatedAgeYears},
          marital_status = ${input.maritalStatus}, nationality = ${input.nationality},
          religion = ${input.religion}, occupation = ${input.occupation}, blood_group = ${input.bloodGroup},
          phone = ${input.phone}, phone_e164 = ${normalizePhoneE164(input.phone)},
          alt_phone = ${input.altPhone}, email = ${input.email}, address_line = ${input.addressLine},
          town = ${input.town}, district = ${input.district}, region = ${input.region},
          digital_address = ${input.digitalAddress}, is_unidentified = false,
          updated_at = now(), updated_by = ${userId}, version = version + 1
        WHERE id = ${id}::uuid AND is_unidentified = true AND version = ${expectedVersion}::int
        RETURNING id
      ),
      ${childRecordCtes(sql`identified`, input, userId)}
      SELECT id FROM identified
    `);
    if (!(result.rows[0] as { id?: string } | undefined)?.id) {
      throw conflict("This patient changed. Refresh and try again.", "CONCURRENT_MODIFICATION");
    }
    const updated = await loadPatient(id);
    if (!updated) throw notFound("Patient not found.", "PATIENT_NOT_FOUND");
    return updated;
  } catch (error) {
    if (isIdentifierConflict(error)) throw identifierInUse();
    throw error;
  }
};

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

const OPEN_ADMISSION_STATUSES = ["PENDING_BED", "ADMITTED", "DISCHARGE_PLANNED"];
const PENDING_CLAIM_STATUSES = ["DRAFT", "READY", "SUBMITTED", "QUERIED"];
const UNSUBMITTED_CLAIM_STATUSES = ["DRAFT", "READY"];

export const MERGEABLE_FIELDS = {
  preferredName: "preferred_name",
  dateOfBirth: "date_of_birth",
  maritalStatus: "marital_status",
  nationality: "nationality",
  religion: "religion",
  occupation: "occupation",
  bloodGroup: "blood_group",
  phone: "phone",
  altPhone: "alt_phone",
  email: "email",
  addressLine: "address_line",
  town: "town",
  district: "district",
  region: "region",
  digitalAddress: "digital_address",
  photoUrl: "photo_url",
} as const;

export type MergeableField = keyof typeof MERGEABLE_FIELDS;

export type MergePrecheck = { code: string; passed: boolean; message: string };

const loadMergeBundle = async (id: string) => {
  const [identifiers, contacts, allergies, conditions] = await Promise.all([
    db.select().from(patientIdentifier).where(eq(patientIdentifier.patientId, id)),
    db.select().from(patientContact).where(eq(patientContact.patientId, id)),
    db.select().from(patientAllergy).where(eq(patientAllergy.patientId, id)),
    db.select().from(patientCondition).where(eq(patientCondition.patientId, id)),
  ]);
  return { identifiers, contacts, allergies, conditions };
};

/** Pre-checks from docs/10 §1.4 step 2. */
export const runMergePrechecks = async (survivor: Patient, merged: Patient): Promise<MergePrecheck[]> => {
  const ids = [survivor.id, merged.id];
  const [openAdmissions, activeIdentifiers, pendingClaims] = await Promise.all([
    db
      .select({ patientId: admission.patientId })
      .from(admission)
      .where(and(inArray(admission.patientId, ids), inArray(admission.status, OPEN_ADMISSION_STATUSES))),
    db
      .select({
        patientId: patientIdentifier.patientId,
        idType: patientIdentifier.idType,
        idValue: patientIdentifier.idValue,
      })
      .from(patientIdentifier)
      .where(and(inArray(patientIdentifier.patientId, ids), eq(patientIdentifier.status, "ACTIVE"))),
    db
      .select({ patientId: claim.patientId })
      .from(claim)
      .where(and(inArray(claim.patientId, ids), inArray(claim.status, PENDING_CLAIM_STATUSES))),
  ]);

  const bothHave = (rows: Array<{ patientId: string }>) =>
    rows.some((row) => row.patientId === survivor.id) && rows.some((row) => row.patientId === merged.id);
  const survivorTypes = new Map(
    activeIdentifiers.filter((row) => row.patientId === survivor.id).map((row) => [row.idType, row.idValue]),
  );
  const conflictingTypes = activeIdentifiers
    .filter((row) => row.patientId === merged.id)
    .filter((row) => survivorTypes.has(row.idType) && survivorTypes.get(row.idType) !== row.idValue)
    .map((row) => row.idType);

  return [
    {
      code: "PATIENT_MERGE_SAME_RECORD",
      passed: survivor.id !== merged.id,
      message: "The surviving and duplicate records must be different patients.",
    },
    {
      code: "PATIENT_MERGE_ALREADY_MERGED",
      passed: survivor.status !== "MERGED" && merged.status !== "MERGED",
      message: "Neither record may already be merged.",
    },
    {
      code: "PATIENT_MERGE_OPEN_ADMISSIONS",
      passed: !bothHave(openAdmissions),
      message: "Both records must not have an open admission.",
    },
    {
      code: "PATIENT_MERGE_IDENTIFIER_CONFLICT",
      passed: conflictingTypes.length === 0,
      message:
        conflictingTypes.length === 0
          ? "Identifiers do not conflict."
          : `Both records hold different active identifiers of the same type (${[...new Set(conflictingTypes)].join(", ")}). Deactivate one first.`,
    },
    {
      code: "PATIENT_MERGE_PENDING_CLAIMS",
      passed: !bothHave(pendingClaims),
      message: "Both records must not have a pending insurance claim.",
    },
  ];
};

type MergeModule = {
  module: string;
  run: (survivorId: string, mergedId: string) => Promise<{ rowsMoved: number; manualReview?: string }>;
};

const repoint = async (table: string, survivorId: string, mergedId: string, extra: SQL = sql``) =>
  affectedRows(
    await db.execute(
      sql`UPDATE ${sql.identifier(table)} SET patient_id = ${survivorId}::uuid WHERE patient_id = ${mergedId}::uuid ${extra}`,
    ),
  );

const repointAll = (tables: string[]) => async (survivorId: string, mergedId: string) => {
  let rowsMoved = 0;
  for (const table of tables) rowsMoved += await repoint(table, survivorId, mergedId);
  return { rowsMoved };
};

const countRemaining = async (table: string, mergedId: string) => {
  const result = await db.execute(
    sql`SELECT count(*)::int AS remaining FROM ${sql.identifier(table)} WHERE patient_id = ${mergedId}::uuid`,
  );
  return Number((result.rows[0] as { remaining?: number | string } | undefined)?.remaining ?? 0);
};

/**
 * One entry per module that owns patient-linked rows. Every step is a single idempotent UPDATE,
 * so a failed or repeated task can simply be run again.
 */
export const MERGE_MODULES: MergeModule[] = [
  {
    module: "registry",
    run: async (survivorId, mergedId) => {
      const consents = affectedRows(
        await db.execute(
          sql`UPDATE consent SET subject_id = ${survivorId}::uuid WHERE subject_type = 'PATIENT' AND subject_id = ${mergedId}::uuid`,
        ),
      );
      const attachments = affectedRows(
        await db.execute(
          sql`UPDATE attachment SET entity_id = ${survivorId}::uuid WHERE upper(entity_type) = 'PATIENT' AND entity_id = ${mergedId}::uuid`,
        ),
      );
      return { rowsMoved: consents + attachments };
    },
  },
  { module: "appointments", run: repointAll(["appointment", "visit"]) },
  {
    module: "clinical",
    run: repointAll([
      "encounter",
      "clinical_note",
      "vital_sign",
      "diagnosis",
      "clinical_order",
      "referral",
      "medical_certificate",
      "prescription",
    ]),
  },
  { module: "laboratory", run: repointAll(["lab_order"]) },
  { module: "radiology", run: repointAll(["imaging_order"]) },
  { module: "admissions", run: repointAll(["bed_request", "admission"]) },
  { module: "nursing", run: repointAll(["nursing_assessment"]) },
  { module: "pharmacy", run: repointAll(["dispense", "controlled_drug_register"]) },
  {
    module: "billing",
    run: async (survivorId, mergedId) => {
      // Bills with a submitted claim stay under the merged record; `merged_into_id` is the pointer.
      const bills = await repoint(
        "bill",
        survivorId,
        mergedId,
        sql`AND NOT EXISTS (
          SELECT 1 FROM claim c WHERE c.bill_id = bill.id
            AND c.status NOT IN (${sql.join(UNSUBMITTED_CLAIM_STATUSES.map((status) => sql`${status}`), sql`, `)})
        )`,
      );
      const payments = await repoint(
        "patient_payment",
        survivorId,
        mergedId,
        sql`AND bill_id IN (SELECT b.id FROM bill b WHERE b.patient_id = ${survivorId}::uuid)`,
      );
      const deposits = await repoint("patient_deposit", survivorId, mergedId);
      const remaining = await countRemaining("bill", mergedId);
      return {
        rowsMoved: bills + payments + deposits,
        ...(remaining > 0
          ? { manualReview: `${remaining} bill(s) with a submitted claim remain under the merged record.` }
          : {}),
      };
    },
  },
  {
    module: "insurance",
    run: async (survivorId, mergedId) => {
      const policies = await repoint(
        "patient_insurance",
        survivorId,
        mergedId,
        sql`AND NOT EXISTS (
          SELECT 1 FROM patient_insurance s
          WHERE s.patient_id = ${survivorId}::uuid
            AND s.payer_id = patient_insurance.payer_id AND s.member_no = patient_insurance.member_no
        )`,
      );
      const claims = await repoint(
        "claim",
        survivorId,
        mergedId,
        sql`AND status IN (${sql.join(UNSUBMITTED_CLAIM_STATUSES.map((status) => sql`${status}`), sql`, `)})`,
      );
      const remainingClaims = await countRemaining("claim", mergedId);
      const remainingPolicies = await countRemaining("patient_insurance", mergedId);
      const notes = [
        remainingClaims > 0 ? `${remainingClaims} submitted claim(s) need manual review.` : "",
        remainingPolicies > 0 ? `${remainingPolicies} duplicate insurance membership(s) were left in place.` : "",
      ].filter(Boolean);
      return {
        rowsMoved: policies + claims,
        ...(notes.length > 0 ? { manualReview: notes.join(" ") } : {}),
      };
    },
  },
];

const MAX_MERGE_TASK_ATTEMPTS = 5;

/** Runs every unfinished re-pointing task of a merge and returns the task list. */
export const processMergeTasks = async (mergeLogId: string) => {
  const [log] = await db.select().from(patientMergeLog).where(eq(patientMergeLog.id, mergeLogId)).limit(1);
  if (!log) throw notFound("Merge not found.", "PATIENT_MERGE_NOT_FOUND");

  const tasks = await db
    .select()
    .from(patientMergeTask)
    .where(and(eq(patientMergeTask.mergeLogId, mergeLogId), inArray(patientMergeTask.status, ["PENDING", "FAILED"])));

  for (const task of tasks) {
    const definition = MERGE_MODULES.find((entry) => entry.module === task.module);
    const attempts = task.attempts + 1;
    try {
      if (!definition) throw new Error(`No merge handler is registered for module '${task.module}'.`);
      const outcome = await definition.run(log.survivorId, log.mergedId);
      await db
        .update(patientMergeTask)
        .set({
          status: outcome.manualReview ? "MANUAL_REVIEW" : "DONE",
          rowsMoved: (task.rowsMoved ?? 0) + outcome.rowsMoved,
          lastError: outcome.manualReview?.slice(0, 500) ?? null,
          completedAt: new Date(),
          attempts,
        })
        .where(eq(patientMergeTask.id, task.id));
    } catch (error) {
      const exhausted = attempts >= MAX_MERGE_TASK_ATTEMPTS;
      const message = databaseErrorInfo(error)?.message || (error instanceof Error ? error.message : String(error));
      if (exhausted) {
        console.error("Patient merge task needs manual review after repeated failures.", {
          mergeLogId,
          module: task.module,
          message,
        });
      }
      await db
        .update(patientMergeTask)
        .set({ status: exhausted ? "MANUAL_REVIEW" : "FAILED", lastError: message.slice(0, 500), attempts })
        .where(eq(patientMergeTask.id, task.id));
    }
  }

  return db
    .select()
    .from(patientMergeTask)
    .where(eq(patientMergeTask.mergeLogId, mergeLogId))
    .orderBy(asc(patientMergeTask.module));
};

/** Retries re-pointing tasks left unfinished by an earlier request (scheduled job). */
export const retryOpenMergeTasks = async () => {
  const open = await db
    .selectDistinct({ mergeLogId: patientMergeTask.mergeLogId })
    .from(patientMergeTask)
    .where(inArray(patientMergeTask.status, ["PENDING", "FAILED"]))
    .limit(50);
  for (const entry of open) await processMergeTasks(entry.mergeLogId);
  return open.length;
};

export const summarizeMergeStatus = (tasks: Array<{ status: string }>) => {
  if (tasks.some((task) => task.status === "PENDING")) return "IN_PROGRESS";
  if (tasks.some((task) => task.status === "FAILED")) return "FAILED";
  if (tasks.some((task) => task.status === "MANUAL_REVIEW")) return "MANUAL_REVIEW";
  return "DONE";
};

/**
 * Merges `merged` into `survivor` (docs/10 §1.4). The merge log, status change, demographic picks,
 * allergy/condition union and task rows are written by one statement; module re-pointing then runs
 * as tracked, idempotent tasks.
 */
export const mergePatients = async (params: {
  survivor: Patient;
  merged: Patient;
  reason: string;
  takeFromMerged: MergeableField[];
  userId: string;
}) => {
  const { survivor, merged, reason, takeFromMerged, userId } = params;
  const failed = (await runMergePrechecks(survivor, merged)).filter((check) => !check.passed);
  if (failed.length > 0) {
    throw conflict(failed[0]?.message ?? "The records cannot be merged.", failed[0]?.code ?? "PATIENT_MERGE_BLOCKED", {
      prechecks: failed,
    });
  }

  const [survivorBundle, mergedBundle] = await Promise.all([loadMergeBundle(survivor.id), loadMergeBundle(merged.id)]);
  const snapshot = JSON.stringify({
    survivor: { ...survivor, ...survivorBundle },
    merged: { ...merged, ...mergedBundle },
    takeFromMerged,
  });

  const picks: SQL[] = [];
  for (const field of new Set(takeFromMerged)) {
    const column = MERGEABLE_FIELDS[field];
    picks.push(sql`${sql.identifier(column)} = m.${sql.identifier(column)}`);
    if (field === "phone") picks.push(sql`phone_e164 = m.phone_e164`);
    if (field === "dateOfBirth") {
      picks.push(sql`dob_estimated = m.dob_estimated`, sql`estimated_age_years = m.estimated_age_years`);
    }
    if (field === "photoUrl") picks.push(sql`photo_public_id = m.photo_public_id`);
  }
  const survivorSet = sql.join(
    [...picks, sql`updated_at = now()`, sql`updated_by = ${userId}`, sql`version = p.version + 1`],
    sql`, `,
  );
  const modules = `{${MERGE_MODULES.map((entry) => entry.module).join(",")}}`;

  const result = await db.execute<{ id: string }>(sql`
    WITH guard AS (
      SELECT s.id AS survivor_id, m.id AS merged_id
      FROM patient s CROSS JOIN patient m
      WHERE s.id = ${survivor.id}::uuid AND m.id = ${merged.id}::uuid AND s.id <> m.id
        AND s.status <> 'MERGED' AND m.status <> 'MERGED'
        AND s.version = ${survivor.version}::int AND m.version = ${merged.version}::int
    ),
    merge_log AS (
      INSERT INTO patient_merge_log (survivor_id, merged_id, merged_by, reason, snapshot)
      SELECT g.survivor_id, g.merged_id, ${userId}::text, ${reason}::text, ${snapshot}::jsonb FROM guard g
      RETURNING id
    ),
    merged_row AS (
      UPDATE patient p SET status = 'MERGED', merged_into_id = g.survivor_id, updated_at = now(),
             updated_by = ${userId}, version = p.version + 1
      FROM guard g WHERE p.id = g.merged_id
      RETURNING p.id
    ),
    survivor_row AS (
      UPDATE patient p SET ${survivorSet}
      FROM guard g JOIN patient m ON m.id = g.merged_id
      WHERE p.id = g.survivor_id
      RETURNING p.id
    ),
    moved_allergies AS (
      UPDATE patient_allergy a SET patient_id = g.survivor_id
      FROM guard g
      WHERE a.patient_id = g.merged_id AND NOT EXISTS (
        SELECT 1 FROM patient_allergy s
        WHERE s.patient_id = g.survivor_id AND s.category = a.category
          AND lower(s.substance) = lower(a.substance)
      )
      RETURNING a.id
    ),
    moved_conditions AS (
      UPDATE patient_condition c SET patient_id = g.survivor_id
      FROM guard g
      WHERE c.patient_id = g.merged_id AND NOT EXISTS (
        SELECT 1 FROM patient_condition s
        WHERE s.patient_id = g.survivor_id AND lower(s.description) = lower(c.description)
          AND coalesce(s.icd10_code, '') = coalesce(c.icd10_code, '')
      )
      RETURNING c.id
    ),
    moved_identifiers AS (
      UPDATE patient_identifier i SET patient_id = g.survivor_id
      FROM guard g
      WHERE i.patient_id = g.merged_id AND NOT EXISTS (
        SELECT 1 FROM patient_identifier s
        WHERE s.patient_id = g.survivor_id AND s.id_type = i.id_type
          AND s.status = 'ACTIVE' AND i.status = 'ACTIVE'
      )
      RETURNING i.id
    ),
    moved_contacts AS (
      UPDATE patient_contact c SET patient_id = g.survivor_id
      FROM guard g
      WHERE c.patient_id = g.merged_id AND NOT EXISTS (
        SELECT 1 FROM patient_contact s
        WHERE s.patient_id = g.survivor_id AND s.contact_type = c.contact_type
          AND lower(s.name) = lower(c.name)
      )
      RETURNING c.id
    ),
    reviewed_candidates AS (
      UPDATE patient_duplicate_candidate d
      SET status = CASE
            WHEN g.survivor_id IN (d.patient_a_id, d.patient_b_id) THEN 'MERGED' ELSE 'DISMISSED' END,
          reviewed_by = ${userId}, reviewed_at = now()
      FROM guard g
      WHERE d.status = 'PENDING' AND g.merged_id IN (d.patient_a_id, d.patient_b_id)
      RETURNING d.id
    ),
    new_tasks AS (
      INSERT INTO patient_merge_task (merge_log_id, module)
      SELECT l.id, t.module FROM merge_log l CROSS JOIN unnest(${modules}::text[]) AS t(module)
      RETURNING id
    )
    SELECT id FROM merge_log
  `);

  const mergeLogId = (result.rows[0] as { id?: string } | undefined)?.id;
  if (!mergeLogId) {
    throw conflict("One of the records changed. Refresh and try again.", "CONCURRENT_MODIFICATION");
  }

  const tasks = await processMergeTasks(mergeLogId);
  return { mergeLogId, tasks, status: summarizeMergeStatus(tasks) };
};

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export type TimelineEvent = {
  type: "REGISTRATION" | "MERGE" | "APPOINTMENT" | "VISIT" | "ENCOUNTER" | "ADMISSION" | "LAB_ORDER" | "IMAGING_ORDER";
  occurredAt: Date;
  title: string;
  status: string | null;
  reference: string | null;
  unitName: string | null;
};

/** Visits, encounters, results and admissions for the chart, newest first. */
export const loadPatientTimeline = async (target: Patient, limit = 100): Promise<TimelineEvent[]> => {
  const id = target.id;
  const [appointments, visits, encounters, admissions, labOrders, imagingOrders, merges] = await Promise.all([
    db
      .select({
        at: appointment.scheduledStart,
        kind: appointment.appointmentType,
        status: appointment.status,
        unitName: orgUnit.name,
      })
      .from(appointment)
      .leftJoin(orgUnit, eq(orgUnit.id, appointment.orgUnitId))
      .where(eq(appointment.patientId, id))
      .orderBy(desc(appointment.scheduledStart))
      .limit(limit),
    db
      .select({
        at: visit.openedAt,
        kind: visit.visitType,
        status: visit.status,
        reference: visit.visitNo,
        unitName: orgUnit.name,
      })
      .from(visit)
      .leftJoin(orgUnit, eq(orgUnit.id, visit.currentUnitId))
      .where(eq(visit.patientId, id))
      .orderBy(desc(visit.openedAt))
      .limit(limit),
    db
      .select({
        at: encounter.startedAt,
        kind: encounter.encounterType,
        status: encounter.status,
        unitName: orgUnit.name,
      })
      .from(encounter)
      .leftJoin(orgUnit, eq(orgUnit.id, encounter.orgUnitId))
      .where(eq(encounter.patientId, id))
      .orderBy(desc(encounter.startedAt))
      .limit(limit),
    db
      .select({
        at: admission.admittedAt,
        kind: admission.admissionType,
        status: admission.status,
        reference: admission.admissionNo,
        unitName: orgUnit.name,
      })
      .from(admission)
      .leftJoin(orgUnit, eq(orgUnit.id, admission.currentUnitId))
      .where(eq(admission.patientId, id))
      .limit(limit),
    db
      .select({ at: labOrder.orderedAt, status: labOrder.status, reference: labOrder.labOrderNo })
      .from(labOrder)
      .where(eq(labOrder.patientId, id))
      .orderBy(desc(labOrder.orderedAt))
      .limit(limit),
    db
      .select({
        at: sql<Date | null>`coalesce(${imagingOrder.performedAt}, ${imagingOrder.scheduledAt})`.mapWith(
          imagingOrder.performedAt,
        ),
        status: imagingOrder.status,
        reference: imagingOrder.accessionNo,
      })
      .from(imagingOrder)
      .where(eq(imagingOrder.patientId, id))
      .limit(limit),
    db
      .select({ at: patientMergeLog.mergedAt, mergedMrn: patient.mrn })
      .from(patientMergeLog)
      .innerJoin(patient, eq(patient.id, patientMergeLog.mergedId))
      .where(eq(patientMergeLog.survivorId, id))
      .limit(limit),
  ]);

  const label = (value: string) =>
    value
      .toLowerCase()
      .split("_")
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");

  const events: TimelineEvent[] = [
    {
      type: "REGISTRATION",
      occurredAt: target.registeredAt,
      title: target.isUnidentified ? "Registered as an unidentified patient" : "Registered",
      status: null,
      reference: target.mrn,
      unitName: null,
    },
    ...merges.map((row) => ({
      type: "MERGE" as const,
      occurredAt: row.at,
      title: "Duplicate record merged into this chart",
      status: null,
      reference: row.mergedMrn,
      unitName: null,
    })),
    ...appointments.map((row) => ({
      type: "APPOINTMENT" as const,
      occurredAt: row.at,
      title: `${label(row.kind)} appointment`,
      status: row.status,
      reference: null,
      unitName: row.unitName,
    })),
    ...visits.map((row) => ({
      type: "VISIT" as const,
      occurredAt: row.at,
      title: `${label(row.kind)} visit`,
      status: row.status,
      reference: row.reference,
      unitName: row.unitName,
    })),
    ...encounters.map((row) => ({
      type: "ENCOUNTER" as const,
      occurredAt: row.at,
      title: `${label(row.kind)} encounter`,
      status: row.status,
      reference: null,
      unitName: row.unitName,
    })),
    ...admissions
      .filter((row): row is typeof row & { at: Date } => row.at !== null)
      .map((row) => ({
        type: "ADMISSION" as const,
        occurredAt: row.at,
        title: `${label(row.kind)} admission`,
        status: row.status,
        reference: row.reference,
        unitName: row.unitName,
      })),
    ...labOrders.map((row) => ({
      type: "LAB_ORDER" as const,
      occurredAt: row.at,
      title: "Laboratory request",
      status: row.status,
      reference: row.reference,
      unitName: null,
    })),
    ...imagingOrders
      .filter((row): row is typeof row & { at: Date } => row.at !== null)
      .map((row) => ({
        type: "IMAGING_ORDER" as const,
        occurredAt: row.at,
        title: "Imaging request",
        status: row.status,
        reference: row.reference,
        unitName: null,
      })),
  ];

  return events.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, limit);
};
