import assert from "node:assert/strict";
import test from "node:test";

import type { Patient } from "../db/schema/sprintReady.js";
import {
  checkRegistrationRules,
  classifyDuplicate,
  duplicateReasons,
  formatMrn,
  getPatientConfig,
  isUnitScopedPatientReader,
  looksLikeMrn,
  maskPatientSummary,
  normalizePhoneE164,
  orderDuplicatePair,
  redactForAudit,
  resolveAgeYears,
  resolvePatientAccessLevel,
  scoreDuplicate,
  serializePatientDetail,
  serializePatientSummary,
  unidentifiedPlaceholderName,
  validateIdentifier,
  type RegistrationDraft,
} from "../lib/patientRules.js";

const config = getPatientConfig({});
const today = "2026-10-12";

const baseDraft: RegistrationDraft = {
  unidentified: false,
  dateOfBirth: "1990-05-20",
  estimatedAgeYears: null,
  phone: "0244123456",
  contacts: [],
  consents: [
    { consentType: "TREATMENT", status: "GRANTED" },
    { consentType: "DATA_PROCESSING", status: "GRANTED" },
  ],
  captureMethod: "PAPER",
  witnessStaffId: null,
  identifiers: [],
};

const codes = (draft: RegistrationDraft) =>
  checkRegistrationRules(draft, { todayIso: today, config }).map((violation) => violation.code);

const samplePatient = (overrides: Partial<Patient> = {}): Patient => ({
  id: "6f0c1c1e-0000-4000-8000-000000000001",
  mrn: "MRN-2026-000123",
  firstName: "Kwame",
  middleName: null,
  lastName: "Mensah",
  preferredName: null,
  sex: "MALE",
  dateOfBirth: "1990-05-20",
  dobEstimated: false,
  estimatedAgeYears: null,
  maritalStatus: "MARRIED",
  nationality: "Ghanaian",
  religion: null,
  occupation: "Teacher",
  bloodGroup: "O+",
  phone: "0244123456",
  phoneE164: "+233244123456",
  altPhone: null,
  email: null,
  addressLine: "12 Ring Road",
  town: "Accra",
  district: null,
  region: "Greater Accra",
  digitalAddress: "GA-123-4567",
  photoUrl: null,
  photoPublicId: null,
  status: "ACTIVE",
  mergedIntoId: null,
  deceasedAt: null,
  confidentiality: "NORMAL",
  isUnidentified: false,
  registeredAt: new Date("2026-01-05T09:00:00Z"),
  registeredUnitId: null,
  nameKey: "mensah kwame ",
  surnamePhonetic: "MNS",
  createdAt: new Date("2026-01-05T09:00:00Z"),
  createdBy: "user-1",
  updatedAt: new Date("2026-01-05T09:00:00Z"),
  updatedBy: "user-1",
  version: 0,
  ...overrides,
});

test("MRNs are formatted as MRN-YYYY-NNNNNN", () => {
  assert.equal(formatMrn(2026, 123), "MRN-2026-000123");
  assert.equal(looksLikeMrn("mrn-2026-000123"), true);
  assert.equal(looksLikeMrn("Kwame Mensah"), false);
});

test("Ghana phone numbers normalise to E.164", () => {
  assert.equal(normalizePhoneE164("0244 123 456"), "+233244123456");
  assert.equal(normalizePhoneE164("+233244123456"), "+233244123456");
  assert.equal(normalizePhoneE164("233-244-123-456"), "+233244123456");
  assert.equal(normalizePhoneE164("244123456"), "+233244123456");
  assert.equal(normalizePhoneE164("+447911123456"), "+447911123456");
  assert.equal(normalizePhoneE164("02441234"), null);
  assert.equal(normalizePhoneE164("not a phone"), null);
  assert.equal(normalizePhoneE164(""), null);
});

test("NHIS and Ghana Card numbers are validated and normalised", () => {
  assert.deepEqual(validateIdentifier("NHIS", " 12345678 "), { ok: true, value: "12345678" });
  assert.equal(validateIdentifier("NHIS", "1234").ok, false);
  assert.deepEqual(validateIdentifier("GHANA_CARD", "gha7123456789"), { ok: true, value: "GHA-712345678-9" });
  assert.deepEqual(validateIdentifier("GHANA_CARD", "GHA-712345678-9"), { ok: true, value: "GHA-712345678-9" });
  assert.equal(validateIdentifier("GHANA_CARD", "712345678").ok, false);
  assert.deepEqual(validateIdentifier("STAFF_ID", "bmc-0042"), { ok: true, value: "BMC-0042" });
});

test("age comes from the date of birth, or an estimated age aged forward from registration", () => {
  assert.equal(resolveAgeYears({ dateOfBirth: "1990-05-20", estimatedAgeYears: null }, "2026-05-19"), 35);
  assert.equal(resolveAgeYears({ dateOfBirth: "1990-05-20", estimatedAgeYears: null }, "2026-05-20"), 36);
  assert.equal(
    resolveAgeYears(
      { dateOfBirth: null, estimatedAgeYears: 40, registeredAt: new Date("2024-03-01T00:00:00Z") },
      "2026-03-02",
    ),
    42,
  );
  assert.equal(resolveAgeYears({ dateOfBirth: null, estimatedAgeYears: null }, today), null);
});

test("unidentified patients get a dated placeholder name", () => {
  assert.deepEqual(unidentifiedPlaceholderName("MALE", "2026-10-12", 3), {
    firstName: "UNKNOWN",
    lastName: "MALE 20261012-03",
  });
  assert.equal(unidentifiedPlaceholderName("UNKNOWN", "2026-10-12", 12).lastName, "PERSON 20261012-12");
});

test("duplicate score follows the documented weights and thresholds", () => {
  const nearIdentical = { nameSimilarity: 0.9, dobMatch: true, phoneMatch: true, phoneticMatch: true, identifierMatch: false };
  assert.equal(scoreDuplicate(nearIdentical), 0.95);
  assert.equal(classifyDuplicate(scoreDuplicate(nearIdentical), config), "BLOCK");

  const sameNameAndDob = { nameSimilarity: 0.667, dobMatch: true, phoneMatch: false, phoneticMatch: true, identifierMatch: false };
  assert.equal(scoreDuplicate(sameNameAndDob), 0.684);
  assert.equal(classifyDuplicate(scoreDuplicate(sameNameAndDob), config), "WARN");

  const nameOnly = { nameSimilarity: 1, dobMatch: false, phoneMatch: false, phoneticMatch: true, identifierMatch: false };
  assert.equal(classifyDuplicate(scoreDuplicate(nameOnly), config), "NONE");

  const identifier = { nameSimilarity: 0, dobMatch: false, phoneMatch: false, phoneticMatch: false, identifierMatch: true };
  assert.equal(scoreDuplicate(identifier), 1);
  assert.deepEqual(duplicateReasons(identifier), ["IDENTIFIER"]);
  assert.equal(classifyDuplicate(0.85, config), "BLOCK");
  assert.equal(classifyDuplicate(0.6, config), "WARN");
});

test("duplicate thresholds are configurable and stay ordered", () => {
  const custom = getPatientConfig({ HAMS_PATIENT_DUP_BLOCK: "0.9", HAMS_PATIENT_DUP_WARN: "0.95" });
  assert.equal(custom.duplicateBlockThreshold, 0.9);
  assert.equal(custom.duplicateWarnThreshold, 0.9);
  assert.equal(getPatientConfig({ HAMS_MINOR_AGE_THRESHOLD: "21" }).minorAgeThreshold, 21);
  assert.equal(getPatientConfig({ HAMS_MINOR_AGE_THRESHOLD: "nonsense" }).minorAgeThreshold, 18);
});

test("candidate pairs are ordered for the pair constraint", () => {
  const low = "0a000000-0000-4000-8000-000000000000";
  const high = "f0000000-0000-4000-8000-000000000000";
  assert.deepEqual(orderDuplicatePair(high, low), [low, high]);
  assert.deepEqual(orderDuplicatePair(low, high), [low, high]);
});

test("registration needs an age, a contact route and both mandatory consents", () => {
  assert.deepEqual(codes(baseDraft), []);
  assert.deepEqual(codes({ ...baseDraft, dateOfBirth: null }), ["PATIENT_AGE_REQUIRED"]);
  assert.deepEqual(codes({ ...baseDraft, dateOfBirth: null, estimatedAgeYears: 34 }), []);
  assert.deepEqual(codes({ ...baseDraft, dateOfBirth: "2027-01-01" }), ["PATIENT_DOB_INVALID"]);
  assert.deepEqual(codes({ ...baseDraft, phone: null }), ["PATIENT_CONTACT_REQUIRED"]);
  assert.deepEqual(
    codes({ ...baseDraft, phone: null, contacts: [{ contactType: "NEXT_OF_KIN", name: "Ama Mensah" }] }),
    [],
  );
  assert.deepEqual(
    codes({ ...baseDraft, consents: [{ consentType: "TREATMENT", status: "GRANTED" }] }),
    ["PATIENT_CONSENT_REQUIRED"],
  );
  assert.deepEqual(
    codes({
      ...baseDraft,
      consents: [
        { consentType: "TREATMENT", status: "GRANTED" },
        { consentType: "DATA_PROCESSING", status: "DECLINED" },
      ],
    }),
    ["PATIENT_CONSENT_REQUIRED"],
  );
  assert.deepEqual(codes({ ...baseDraft, captureMethod: "VERBAL_WITNESSED" }), ["PATIENT_CONSENT_WITNESS_REQUIRED"]);
});

test("minors need a guardian who can consent", () => {
  const minor = { ...baseDraft, dateOfBirth: "2015-02-01" };
  assert.deepEqual(codes(minor), ["PATIENT_GUARDIAN_REQUIRED"]);
  assert.deepEqual(
    codes({ ...minor, contacts: [{ contactType: "GUARDIAN", name: "Ama Mensah", canConsent: false }] }),
    ["PATIENT_GUARDIAN_REQUIRED"],
  );
  assert.deepEqual(
    codes({ ...minor, contacts: [{ contactType: "GUARDIAN", name: "Ama Mensah", canConsent: true }] }),
    [],
  );
});

test("the unidentified-patient flow waives contact, guardian and consent rules", () => {
  assert.deepEqual(
    codes({ ...baseDraft, unidentified: true, dateOfBirth: null, estimatedAgeYears: 8, phone: null, consents: [] }),
    [],
  );
});

test("identifier formats and repeats are rejected at registration", () => {
  assert.deepEqual(
    codes({
      ...baseDraft,
      identifiers: [
        { idType: "NHIS", idValue: "123" },
        { idType: "NHIS", idValue: "12345678" },
      ],
    }),
    ["PATIENT_IDENTIFIER_INVALID", "PATIENT_IDENTIFIER_DUPLICATE"],
  );
});

test("roles map to full, minimal or no registry access", () => {
  assert.equal(resolvePatientAccessLevel(["registrar"]), "FULL");
  assert.equal(resolvePatientAccessLevel(["cashier", "doctor"]), "FULL");
  assert.equal(resolvePatientAccessLevel(["cashier"]), "MINIMAL");
  assert.equal(resolvePatientAccessLevel(["hr_manager", "payroll_officer"]), null);
  assert.equal(isUnitScopedPatientReader(["unit_manager"]), true);
  assert.equal(isUnitScopedPatientReader(["unit_manager", "nurse"]), false);
  assert.equal(isUnitScopedPatientReader(["unit_manager", "hospital_admin"]), false);
});

test("the role-aware serializer leaves restricted fields out for minimal roles", () => {
  const patient = samplePatient();
  const context = { todayIso: today, minorAgeThreshold: 18 };

  const full = serializePatientDetail(patient, { ...context, level: "FULL" });
  assert.equal(full.fullName, "Kwame Mensah");
  assert.equal(full.ageYears, 36);
  assert.equal("phone" in full && full.phone, "0244123456");
  assert.deepEqual(full.redacted, []);

  const minimal = serializePatientDetail(patient, { ...context, level: "MINIMAL" });
  assert.equal(minimal.mrn, "MRN-2026-000123");
  for (const field of ["phone", "email", "addressLine", "occupation", "bloodGroup", "digitalAddress"]) {
    assert.equal(field in minimal, false, `${field} must be absent`);
  }
  assert.ok(minimal.redacted.includes("phone"));
  assert.equal("phone" in serializePatientSummary(patient, { ...context, level: "MINIMAL" }), false);
  assert.equal("nameKey" in full, false);
});

test("restricted search rows hide the patient's identity", () => {
  const masked = maskPatientSummary(samplePatient({ confidentiality: "VIP" }));
  assert.equal(masked.masked, true);
  assert.equal(masked.mrn, null);
  assert.equal(masked.lastName, null);
  assert.equal(masked.dateOfBirth, null);
  assert.equal(masked.confidentiality, "VIP");
  assert.equal(JSON.stringify(masked).includes("Mensah"), false);
});

test("audit payloads keep the shape of a change without personal values", () => {
  assert.deepEqual(
    redactForAudit({ firstName: "Kwame", phone: "0244123456", status: "ACTIVE", dobEstimated: false, email: null }),
    { firstName: "[REDACTED]", phone: "[REDACTED]", status: "ACTIVE", dobEstimated: false, email: null },
  );
});
