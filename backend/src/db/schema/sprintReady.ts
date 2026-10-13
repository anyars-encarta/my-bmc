import {
  bigint,
  boolean,
  char,
  date,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Generated from drizzle/0005_sprint_ready_schema.sql to keep Drizzle schema in sync.

export const appUserRole = pgTable("app_user_role", {
  userId: text("user_id").notNull(),
  role: varchar("role", { length: 30 }).notNull(),
  grantedBy: text("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppUserRole = typeof appUserRole.$inferSelect;
export type NewAppUserRole = typeof appUserRole.$inferInsert;

export const userUnitScope = pgTable("user_unit_scope", {
  userId: text("user_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  scope: varchar("scope", { length: 8 }).default('MANAGE').notNull(),
  includeDescendants: boolean("include_descendants").default(true).notNull(),
});

export type UserUnitScope = typeof userUnitScope.$inferSelect;
export type NewUserUnitScope = typeof userUnitScope.$inferInsert;

export const documentSequence = pgTable("document_sequence", {
  docType: varchar("doc_type", { length: 20 }).notNull(),
  periodKey: varchar("period_key", { length: 8 }).notNull(),
  lastValue: bigint("last_value", { mode: "number" }).default(0).notNull(),
});

export type DocumentSequence = typeof documentSequence.$inferSelect;
export type NewDocumentSequence = typeof documentSequence.$inferInsert;

export const consent = pgTable("consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: varchar("subject_type", { length: 8 }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  consentType: varchar("consent_type", { length: 30 }).notNull(),
  status: varchar("status", { length: 10 }).notNull(),
  policyVersion: varchar("policy_version", { length: 20 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  captureMethod: varchar("capture_method", { length: 20 }).notNull(),
  capturedBy: text("captured_by").notNull(),
  witnessStaffId: uuid("witness_staff_id"),
  guardianName: varchar("guardian_name", { length: 150 }),
  guardianRelationship: varchar("guardian_relationship", { length: 40 }),
  evidenceAttachmentId: uuid("evidence_attachment_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Consent = typeof consent.$inferSelect;
export type NewConsent = typeof consent.$inferInsert;

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  actorUserId: text("actor_user_id"),
  actorStaffId: uuid("actor_staff_id"),
  actorRoles: text("actor_roles").array(),
  action: varchar("action", { length: 20 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: text("entity_id"),
  patientId: uuid("patient_id"),
  orgUnitId: uuid("org_unit_id"),
  requestId: varchar("request_id", { length: 40 }),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  reason: text("reason"),
  before: jsonb("before"),
  after: jsonb("after"),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

export const breakGlassAccess = pgTable("break_glass_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewOutcome: varchar("review_outcome", { length: 12 }),
});

export type BreakGlassAccess = typeof breakGlassAccess.$inferSelect;
export type NewBreakGlassAccess = typeof breakGlassAccess.$inferInsert;

export const attachment = pgTable("attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageProvider: varchar("storage_provider", { length: 12 }).default('CLOUDINARY').notNull(),
  storageKey: text("storage_key").notNull(),
  publicId: text("public_id"),
  classification: varchar("classification", { length: 12 }).default('GENERAL').notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Attachment = typeof attachment.$inferSelect;
export type NewAttachment = typeof attachment.$inferInsert;

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: varchar("channel", { length: 8 }).notNull(),
  recipientType: varchar("recipient_type", { length: 8 }).notNull(),
  recipientId: uuid("recipient_id"),
  toAddress: varchar("to_address", { length: 255 }),
  template: varchar("template", { length: 60 }).notNull(),
  payload: jsonb("payload").default('{}').notNull(),
  status: varchar("status", { length: 20 }).default('QUEUED').notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  relatedEntityType: varchar("related_entity_type", { length: 40 }),
  relatedEntityId: uuid("related_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

export const idempotencyRecord = pgTable("idempotency_record", {
  idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
  userId: text("user_id").notNull(),
  endpoint: varchar("endpoint", { length: 120 }).notNull(),
  requestHash: char("request_hash", { length: 64 }).notNull(),
  responseStatus: smallint("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type IdempotencyRecord = typeof idempotencyRecord.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecord.$inferInsert;

export const shedlock = pgTable("shedlock", {
  name: varchar("name", { length: 64 }).primaryKey(),
  lockUntil: timestamp("lock_until", { withTimezone: true }).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
  lockedBy: varchar("locked_by", { length: 255 }).notNull(),
});

export type Shedlock = typeof shedlock.$inferSelect;
export type NewShedlock = typeof shedlock.$inferInsert;

export const orgUnit = pgTable("org_unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id"),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  unitType: varchar("unit_type", { length: 20 }).notNull(),
  isClinical: boolean("is_clinical").notNull(),
  operates24h: boolean("operates_24h").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  headStaffId: uuid("head_staff_id"),
});

export type OrgUnit = typeof orgUnit.$inferSelect;
export type NewOrgUnit = typeof orgUnit.$inferInsert;

export const shiftType = pgTable("shift_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  category: varchar("category", { length: 12 }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  crossesMidnight: boolean("crosses_midnight"),
  breakMinutes: integer("break_minutes").default(0).notNull(),
  earlyInMinutes: integer("early_in_minutes").default(60).notNull(),
  lateOutMinutes: integer("late_out_minutes").default(120).notNull(),
  graceLateMinutes: integer("grace_late_minutes").default(15).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type ShiftType = typeof shiftType.$inferSelect;
export type NewShiftType = typeof shiftType.$inferInsert;

export const jobRole = pgTable("job_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  staffCategory: varchar("staff_category", { length: 12 }).notNull(),
  requiresLicense: boolean("requires_license").default(false).notNull(),
});

export type JobRole = typeof jobRole.$inferSelect;
export type NewJobRole = typeof jobRole.$inferInsert;

export const staffLicense = pgTable("staff_license", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  licensingBody: varchar("licensing_body", { length: 10 }).notNull(),
  licenceNo: varchar("licence_no", { length: 40 }).notNull(),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on").notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  attachmentId: uuid("attachment_id"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export type StaffLicense = typeof staffLicense.$inferSelect;
export type NewStaffLicense = typeof staffLicense.$inferInsert;

export const transferBatch = pgTable("transfer_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 150 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export type TransferBatch = typeof transferBatch.$inferSelect;
export type NewTransferBatch = typeof transferBatch.$inferInsert;

export const staffAssignment = pgTable("staff_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  assignmentType: varchar("assignment_type", { length: 10 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: varchar("reason", { length: 30 }).default('INITIAL').notNull(),
  note: text("note"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  transferBatchId: uuid("transfer_batch_id"),
});

export type StaffAssignment = typeof staffAssignment.$inferSelect;
export type NewStaffAssignment = typeof staffAssignment.$inferInsert;

export const rosterPeriod = pgTable("roster_period", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgUnitId: uuid("org_unit_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  publishedBy: text("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type RosterPeriod = typeof rosterPeriod.$inferSelect;
export type NewRosterPeriod = typeof rosterPeriod.$inferInsert;

export const rosterEntry = pgTable("roster_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  rosterPeriodId: uuid("roster_period_id"),
  staffId: uuid("staff_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  rosterDate: date("roster_date").notNull(),
  shiftTypeId: uuid("shift_type_id").notNull(),
  plannedStart: timestamp("planned_start", { withTimezone: true }).notNull(),
  plannedEnd: timestamp("planned_end", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 12 }).notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  version: integer("version").default(0).notNull(),
});

export type RosterEntry = typeof rosterEntry.$inferSelect;
export type NewRosterEntry = typeof rosterEntry.$inferInsert;

export const unitStaffingRequirement = pgTable("unit_staffing_requirement", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgUnitId: uuid("org_unit_id").notNull(),
  shiftTypeId: uuid("shift_type_id").notNull(),
  jobRoleId: uuid("job_role_id"),
  minStaff: integer("min_staff").notNull(),
});

export type UnitStaffingRequirement = typeof unitStaffingRequirement.$inferSelect;
export type NewUnitStaffingRequirement = typeof unitStaffingRequirement.$inferInsert;

export const shiftSwapRequest = pgTable("shift_swap_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterEntryId: uuid("requester_entry_id").notNull(),
  counterpartyEntryId: uuid("counterparty_entry_id"),
  status: varchar("status", { length: 12 }).default('PENDING').notNull(),
  reason: text("reason"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export type ShiftSwapRequest = typeof shiftSwapRequest.$inferSelect;
export type NewShiftSwapRequest = typeof shiftSwapRequest.$inferInsert;

export const publicHoliday = pgTable("public_holiday", {
  holidayDate: date("holiday_date").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
});

export type PublicHoliday = typeof publicHoliday.$inferSelect;
export type NewPublicHoliday = typeof publicHoliday.$inferInsert;

export const staffCredential = pgTable("staff_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  credentialType: varchar("credential_type", { length: 12 }).notNull(),
  credentialRef: varchar("credential_ref", { length: 120 }).notNull(),
  cardVersion: integer("card_version").default(1).notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
});

export type StaffCredential = typeof staffCredential.$inferSelect;
export type NewStaffCredential = typeof staffCredential.$inferInsert;

export const attendanceDevice = pgTable("attendance_device", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  deviceType: varchar("device_type", { length: 24 }).notNull(),
  vendor: varchar("vendor", { length: 50 }),
  model: varchar("model", { length: 50 }),
  serialNumber: varchar("serial_number", { length: 80 }),
  orgUnitId: uuid("org_unit_id"),
  apiKeyHash: varchar("api_key_hash", { length: 100 }).notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastClockSkewSeconds: integer("last_clock_skew_seconds"),
});

export type AttendanceDevice = typeof attendanceDevice.$inferSelect;
export type NewAttendanceDevice = typeof attendanceDevice.$inferInsert;

export const punchLog = pgTable("punch_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull(),
  deviceEventId: varchar("device_event_id", { length: 80 }).notNull(),
  credentialType: varchar("credential_type", { length: 12 }).notNull(),
  credentialRef: varchar("credential_ref", { length: 120 }).notNull(),
  staffId: uuid("staff_id"),
  punchedAt: timestamp("punched_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  directionHint: varchar("direction_hint", { length: 6 }).default('AUTO').notNull(),
  verifyMode: varchar("verify_mode", { length: 20 }),
  rawPayload: jsonb("raw_payload"),
  result: varchar("result", { length: 32 }).default('RECEIVED').notNull(),
  processed: boolean("processed").default(false).notNull(),
});

export type PunchLog = typeof punchLog.$inferSelect;
export type NewPunchLog = typeof punchLog.$inferInsert;

export const attendanceRecord = pgTable("attendance_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  rosterEntryId: uuid("roster_entry_id"),
  attendanceDate: date("attendance_date").notNull(),
  orgUnitId: uuid("org_unit_id"),
  shiftTypeId: uuid("shift_type_id"),
  clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull(),
  clockInPunchId: uuid("clock_in_punch_id").notNull(),
  clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
  clockOutPunchId: uuid("clock_out_punch_id"),
  status: varchar("status", { length: 12 }).default('OPEN').notNull(),
  workedMinutes: integer("worked_minutes"),
  lateMinutes: integer("late_minutes").default(0).notNull(),
  earlyLeaveMinutes: integer("early_leave_minutes").default(0).notNull(),
  overtimeMinutes: integer("overtime_minutes").default(0).notNull(),
  version: integer("version").default(0).notNull(),
});

export type AttendanceRecord = typeof attendanceRecord.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecord.$inferInsert;

export const attendanceException = pgTable("attendance_exception", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  attendanceRecordId: uuid("attendance_record_id"),
  rosterEntryId: uuid("roster_entry_id"),
  exceptionDate: date("exception_date").notNull(),
  exceptionType: varchar("exception_type", { length: 24 }).notNull(),
  status: varchar("status", { length: 10 }).default('OPEN').notNull(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  note: text("note"),
});

export type AttendanceException = typeof attendanceException.$inferSelect;
export type NewAttendanceException = typeof attendanceException.$inferInsert;

export const attendanceCorrection = pgTable("attendance_correction", {
  id: uuid("id").primaryKey().defaultRandom(),
  attendanceRecordId: uuid("attendance_record_id").notNull(),
  oldClockIn: timestamp("old_clock_in", { withTimezone: true }),
  oldClockOut: timestamp("old_clock_out", { withTimezone: true }),
  newClockIn: timestamp("new_clock_in", { withTimezone: true }),
  newClockOut: timestamp("new_clock_out", { withTimezone: true }),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export type AttendanceCorrection = typeof attendanceCorrection.$inferSelect;
export type NewAttendanceCorrection = typeof attendanceCorrection.$inferInsert;

export const patient = pgTable("patient", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrn: varchar("mrn", { length: 20 }).notNull(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  middleName: varchar("middle_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  preferredName: varchar("preferred_name", { length: 100 }),
  sex: varchar("sex", { length: 10 }).notNull(),
  dateOfBirth: date("date_of_birth"),
  dobEstimated: boolean("dob_estimated").default(false).notNull(),
  estimatedAgeYears: smallint("estimated_age_years"),
  maritalStatus: varchar("marital_status", { length: 15 }),
  nationality: varchar("nationality", { length: 60 }).default('Ghanaian'),
  religion: varchar("religion", { length: 40 }),
  occupation: varchar("occupation", { length: 100 }),
  bloodGroup: varchar("blood_group", { length: 4 }),
  phone: varchar("phone", { length: 25 }),
  phoneE164: varchar("phone_e164", { length: 16 }),
  altPhone: varchar("alt_phone", { length: 25 }),
  email: varchar("email", { length: 255 }),
  addressLine: varchar("address_line", { length: 200 }),
  town: varchar("town", { length: 100 }),
  district: varchar("district", { length: 100 }),
  region: varchar("region", { length: 60 }),
  digitalAddress: varchar("digital_address", { length: 20 }),
  photoUrl: varchar("photo_url", { length: 255 }),
  photoPublicId: varchar("photo_public_id", { length: 255 }),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  mergedIntoId: uuid("merged_into_id"),
  deceasedAt: timestamp("deceased_at", { withTimezone: true }),
  confidentiality: varchar("confidentiality", { length: 10 }).default('NORMAL').notNull(),
  isUnidentified: boolean("is_unidentified").default(false).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
  registeredUnitId: uuid("registered_unit_id"),
  nameKey: text("name_key"),
  surnamePhonetic: text("surname_phonetic"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
  version: integer("version").default(0).notNull(),
});

export type Patient = typeof patient.$inferSelect;
export type NewPatient = typeof patient.$inferInsert;

export const patientIdentifier = pgTable("patient_identifier", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  idType: varchar("id_type", { length: 20 }).notNull(),
  idValue: varchar("id_value", { length: 60 }).notNull(),
  issuer: varchar("issuer", { length: 100 }),
  validTo: date("valid_to"),
  verified: boolean("verified").default(false).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
});

export type PatientIdentifier = typeof patientIdentifier.$inferSelect;
export type NewPatientIdentifier = typeof patientIdentifier.$inferInsert;

export const patientContact = pgTable("patient_contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  contactType: varchar("contact_type", { length: 15 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  relationship: varchar("relationship", { length: 40 }),
  phone: varchar("phone", { length: 25 }),
  address: varchar("address", { length: 255 }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  canConsent: boolean("can_consent").default(false).notNull(),
});

export type PatientContact = typeof patientContact.$inferSelect;
export type NewPatientContact = typeof patientContact.$inferInsert;

export const patientAllergy = pgTable("patient_allergy", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  category: varchar("category", { length: 8 }).notNull(),
  substance: varchar("substance", { length: 150 }).notNull(),
  drugId: uuid("drug_id"),
  reaction: varchar("reaction", { length: 200 }),
  severity: varchar("severity", { length: 18 }),
  status: varchar("status", { length: 18 }).default('ACTIVE').notNull(),
  notedOn: date("noted_on"),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PatientAllergy = typeof patientAllergy.$inferSelect;
export type NewPatientAllergy = typeof patientAllergy.$inferInsert;

export const patientCondition = pgTable("patient_condition", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  icd10Code: varchar("icd10_code", { length: 10 }),
  description: varchar("description", { length: 200 }).notNull(),
  onsetDate: date("onset_date"),
  isChronic: boolean("is_chronic").default(false).notNull(),
  status: varchar("status", { length: 18 }).default('ACTIVE').notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PatientCondition = typeof patientCondition.$inferSelect;
export type NewPatientCondition = typeof patientCondition.$inferInsert;

export const patientMergeLog = pgTable("patient_merge_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  survivorId: uuid("survivor_id").notNull(),
  mergedId: uuid("merged_id").notNull(),
  mergedBy: text("merged_by").notNull(),
  mergedAt: timestamp("merged_at", { withTimezone: true }).defaultNow().notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
});

export type PatientMergeLog = typeof patientMergeLog.$inferSelect;
export type NewPatientMergeLog = typeof patientMergeLog.$inferInsert;

export const patientDuplicateCandidate = pgTable("patient_duplicate_candidate", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientAId: uuid("patient_a_id").notNull(),
  patientBId: uuid("patient_b_id").notNull(),
  score: numeric("score", { precision: 4, scale: 3 }).notNull(),
  reasons: text("reasons").array().notNull(),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type PatientDuplicateCandidate = typeof patientDuplicateCandidate.$inferSelect;
export type NewPatientDuplicateCandidate = typeof patientDuplicateCandidate.$inferInsert;

export const patientMergeTask = pgTable("patient_merge_task", {
  id: uuid("id").primaryKey().defaultRandom(),
  mergeLogId: uuid("merge_log_id").notNull(),
  module: varchar("module", { length: 30 }).notNull(),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
  rowsMoved: integer("rows_moved"),
  lastError: varchar("last_error", { length: 500 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type PatientMergeTask = typeof patientMergeTask.$inferSelect;
export type NewPatientMergeTask = typeof patientMergeTask.$inferInsert;

export const serviceItem = pgTable("service_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 15 }).notNull(),
  defaultOrgUnitId: uuid("default_org_unit_id"),
  inventoryItemId: uuid("inventory_item_id"),
  nhisTariffCode: varchar("nhis_tariff_code", { length: 30 }),
  gdrgCode: varchar("gdrg_code", { length: 15 }),
  isBillable: boolean("is_billable").default(true).notNull(),
  allowDiscount: boolean("allow_discount").default(true).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type ServiceItem = typeof serviceItem.$inferSelect;
export type NewServiceItem = typeof serviceItem.$inferInsert;

export const priceList = pgTable("price_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  payerType: varchar("payer_type", { length: 12 }).notNull(),
  payerId: uuid("payer_id"),
  currency: char("currency", { length: 3 }).default('GHS').notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type PriceList = typeof priceList.$inferSelect;
export type NewPriceList = typeof priceList.$inferInsert;

export const priceListItem = pgTable("price_list_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  priceListId: uuid("price_list_id").notNull(),
  serviceItemId: uuid("service_item_id").notNull(),
  price: numeric("price", { precision: 14, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export type PriceListItem = typeof priceListItem.$inferSelect;
export type NewPriceListItem = typeof priceListItem.$inferInsert;

export const clinicSessionTemplate = pgTable("clinic_session_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgUnitId: uuid("org_unit_id").notNull(),
  providerStaffId: uuid("provider_staff_id"),
  weekday: smallint("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  slotMinutes: smallint("slot_minutes").notNull(),
  capacityPerSlot: smallint("capacity_per_slot").default(1).notNull(),
  overbookLimit: smallint("overbook_limit").default(0).notNull(),
  consultationServiceId: uuid("consultation_service_id"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  active: boolean("active").default(true).notNull(),
});

export type ClinicSessionTemplate = typeof clinicSessionTemplate.$inferSelect;
export type NewClinicSessionTemplate = typeof clinicSessionTemplate.$inferInsert;

export const appointmentSlot = pgTable("appointment_slot", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id"),
  orgUnitId: uuid("org_unit_id").notNull(),
  providerStaffId: uuid("provider_staff_id"),
  rosterEntryId: uuid("roster_entry_id"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: smallint("capacity").notNull(),
  bookedCount: smallint("booked_count").default(0).notNull(),
  status: varchar("status", { length: 8 }).default('OPEN').notNull(),
});

export type AppointmentSlot = typeof appointmentSlot.$inferSelect;
export type NewAppointmentSlot = typeof appointmentSlot.$inferInsert;

export const appointment = pgTable("appointment", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  slotId: uuid("slot_id"),
  orgUnitId: uuid("org_unit_id").notNull(),
  providerStaffId: uuid("provider_staff_id"),
  appointmentType: varchar("appointment_type", { length: 10 }).notNull(),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 12 }).default('BOOKED').notNull(),
  reason: varchar("reason", { length: 300 }),
  bookedVia: varchar("booked_via", { length: 12 }).default('FRONT_DESK').notNull(),
  bookedBy: text("booked_by").notNull(),
  cancelledReason: varchar("cancelled_reason", { length: 300 }),
  rescheduledFromId: uuid("rescheduled_from_id"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  visitId: uuid("visit_id"),
});

export type Appointment = typeof appointment.$inferSelect;
export type NewAppointment = typeof appointment.$inferInsert;

export const visit = pgTable("visit", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitNo: varchar("visit_no", { length: 20 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  visitType: varchar("visit_type", { length: 10 }).notNull(),
  visitDate: date("visit_date").notNull(),
  payerType: varchar("payer_type", { length: 12 }).default('CASH').notNull(),
  patientInsuranceId: uuid("patient_insurance_id"),
  exemptReason: varchar("exempt_reason", { length: 100 }),
  registrationUnitId: uuid("registration_unit_id"),
  currentUnitId: uuid("current_unit_id"),
  appointmentId: uuid("appointment_id"),
  referralId: uuid("referral_id"),
  isNewAttendance: boolean("is_new_attendance").default(false).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  status: varchar("status", { length: 10 }).default('OPEN').notNull(),
  disposition: varchar("disposition", { length: 20 }),
});

export type Visit = typeof visit.$inferSelect;
export type NewVisit = typeof visit.$inferInsert;

export const queueTicket = pgTable("queue_ticket", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  stage: varchar("stage", { length: 12 }).notNull(),
  ticketNo: varchar("ticket_no", { length: 10 }).notNull(),
  priority: smallint("priority").default(3).notNull(),
  status: varchar("status", { length: 8 }).default('WAITING').notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  calledAt: timestamp("called_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  counter: varchar("counter", { length: 20 }),
  calledBy: text("called_by"),
  recallCount: smallint("recall_count").default(0).notNull(),
});

export type QueueTicket = typeof queueTicket.$inferSelect;
export type NewQueueTicket = typeof queueTicket.$inferInsert;

export const triageAssessment = pgTable("triage_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id").notNull(),
  assessedByStaffId: uuid("assessed_by_staff_id").notNull(),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).defaultNow().notNull(),
  triageCategory: varchar("triage_category", { length: 8 }).notNull(),
  chiefComplaint: varchar("chief_complaint", { length: 300 }).notNull(),
  vitalSignId: uuid("vital_sign_id"),
  isolationRequired: boolean("isolation_required").default(false).notNull(),
  pregnant: boolean("pregnant"),
  mobility: varchar("mobility", { length: 15 }),
  notes: text("notes"),
});

export type TriageAssessment = typeof triageAssessment.$inferSelect;
export type NewTriageAssessment = typeof triageAssessment.$inferInsert;

export const icd10Code = pgTable("icd10_code", {
  code: varchar("code", { length: 10 }).primaryKey(),
  title: varchar("title", { length: 300 }).notNull(),
  chapter: varchar("chapter", { length: 10 }),
  block: varchar("block", { length: 20 }),
  isNotifiable: boolean("is_notifiable").default(false).notNull(),
  sexRestriction: varchar("sex_restriction", { length: 6 }),
  active: boolean("active").default(true).notNull(),
});

export type Icd10Code = typeof icd10Code.$inferSelect;
export type NewIcd10Code = typeof icd10Code.$inferInsert;

export const encounter = pgTable("encounter", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterType: varchar("encounter_type", { length: 15 }).notNull(),
  providerStaffId: uuid("provider_staff_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: varchar("status", { length: 16 }).default('OPEN').notNull(),
  chiefComplaint: varchar("chief_complaint", { length: 300 }),
  disposition: varchar("disposition", { length: 20 }),
  followUpDate: date("follow_up_date"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signedByStaffId: uuid("signed_by_staff_id"),
});

export type Encounter = typeof encounter.$inferSelect;
export type NewEncounter = typeof encounter.$inferInsert;

export const clinicalNote = pgTable("clinical_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  encounterId: uuid("encounter_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  noteType: varchar("note_type", { length: 15 }).notNull(),
  body: text("body").notNull(),
  sensitivity: varchar("sensitivity", { length: 10 }).default('NORMAL').notNull(),
  version: integer("version").default(1).notNull(),
  amendsId: uuid("amends_id"),
  status: varchar("status", { length: 16 }).default('DRAFT').notNull(),
  authoredByStaffId: uuid("authored_by_staff_id").notNull(),
  authoredAt: timestamp("authored_at", { withTimezone: true }).defaultNow().notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signerLicenceNo: varchar("signer_licence_no", { length: 40 }),
});

export type ClinicalNote = typeof clinicalNote.$inferSelect;
export type NewClinicalNote = typeof clinicalNote.$inferInsert;

export const vitalSign = pgTable("vital_sign", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id"),
  encounterId: uuid("encounter_id"),
  admissionId: uuid("admission_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  recordedByStaffId: uuid("recorded_by_staff_id").notNull(),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
  pulseBpm: smallint("pulse_bpm"),
  respRate: smallint("resp_rate"),
  systolic: smallint("systolic"),
  diastolic: smallint("diastolic"),
  spo2: smallint("spo2"),
  weightKg: numeric("weight_kg", { precision: 5, scale: 1 }),
  heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
  bmi: numeric("bmi", { precision: 4, scale: 1 }),
  painScore: smallint("pain_score"),
  bloodGlucoseMmol: numeric("blood_glucose_mmol", { precision: 4, scale: 1 }),
  gcs: smallint("gcs"),
  avpu: varchar("avpu", { length: 1 }),
  muacCm: numeric("muac_cm", { precision: 4, scale: 1 }),
  ewsScore: smallint("ews_score"),
  ewsBand: varchar("ews_band", { length: 8 }),
  source: varchar("source", { length: 8 }).default('MANUAL').notNull(),
});

export type VitalSign = typeof vitalSign.$inferSelect;
export type NewVitalSign = typeof vitalSign.$inferInsert;

export const diagnosis = pgTable("diagnosis", {
  id: uuid("id").primaryKey().defaultRandom(),
  encounterId: uuid("encounter_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  icd10Code: varchar("icd10_code", { length: 10 }).notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  diagnosisType: varchar("diagnosis_type", { length: 12 }).notNull(),
  certainty: varchar("certainty", { length: 12 }).default('PROVISIONAL').notNull(),
  isNewCase: boolean("is_new_case").default(true).notNull(),
  onsetDate: date("onset_date"),
  status: varchar("status", { length: 16 }).default('ACTIVE').notNull(),
  notedByStaffId: uuid("noted_by_staff_id").notNull(),
  notedAt: timestamp("noted_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Diagnosis = typeof diagnosis.$inferSelect;
export type NewDiagnosis = typeof diagnosis.$inferInsert;

export const clinicalOrder = pgTable("clinical_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 20 }).notNull(),
  encounterId: uuid("encounter_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  admissionId: uuid("admission_id"),
  orderType: varchar("order_type", { length: 12 }).notNull(),
  priority: varchar("priority", { length: 7 }).default('ROUTINE').notNull(),
  status: varchar("status", { length: 12 }).default('ORDERED').notNull(),
  serviceItemId: uuid("service_item_id"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).default("1").notNull(),
  clinicalIndication: varchar("clinical_indication", { length: 500 }),
  notes: text("notes"),
  paymentRequired: boolean("payment_required").default(false).notNull(),
  paymentClearedAt: timestamp("payment_cleared_at", { withTimezone: true }),
  orderedByStaffId: uuid("ordered_by_staff_id").notNull(),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).defaultNow().notNull(),
  cancelledBy: text("cancelled_by"),
  cancelledReason: varchar("cancelled_reason", { length: 300 }),
});

export type ClinicalOrder = typeof clinicalOrder.$inferSelect;
export type NewClinicalOrder = typeof clinicalOrder.$inferInsert;

export const referral = pgTable("referral", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id"),
  direction: varchar("direction", { length: 3 }).notNull(),
  facilityName: varchar("facility_name", { length: 200 }),
  toUnitId: uuid("to_unit_id"),
  specialty: varchar("specialty", { length: 100 }),
  urgency: varchar("urgency", { length: 9 }).default('ROUTINE').notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  summaryAttachmentId: uuid("summary_attachment_id"),
  status: varchar("status", { length: 10 }).default('REQUESTED').notNull(),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Referral = typeof referral.$inferSelect;
export type NewReferral = typeof referral.$inferInsert;

export const medicalCertificate = pgTable("medical_certificate", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateNo: varchar("certificate_no", { length: 20 }).notNull(),
  verificationCode: varchar("verification_code", { length: 12 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  certType: varchar("cert_type", { length: 12 }).notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date"),
  remarks: varchar("remarks", { length: 500 }),
  issuedByStaffId: uuid("issued_by_staff_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
});

export type MedicalCertificate = typeof medicalCertificate.$inferSelect;
export type NewMedicalCertificate = typeof medicalCertificate.$inferInsert;

export const drug = pgTable("drug", {
  id: uuid("id").primaryKey().defaultRandom(),
  genericName: varchar("generic_name", { length: 200 }).notNull(),
  brandName: varchar("brand_name", { length: 200 }),
  form: varchar("form", { length: 15 }).notNull(),
  strengthValue: numeric("strength_value", { precision: 12, scale: 4 }),
  strengthUnit: varchar("strength_unit", { length: 15 }),
  strengthText: varchar("strength_text", { length: 60 }),
  defaultRoute: varchar("default_route", { length: 15 }),
  atcCode: varchar("atc_code", { length: 10 }),
  inventoryItemId: uuid("inventory_item_id"),
  nhisListed: boolean("nhis_listed").default(false).notNull(),
  essentialList: boolean("essential_list").default(false).notNull(),
  controlledClass: varchar("controlled_class", { length: 10 }).default('NONE').notNull(),
  isHighAlert: boolean("is_high_alert").default(false).notNull(),
  isAntibiotic: boolean("is_antibiotic").default(false).notNull(),
  otcAllowed: boolean("otc_allowed").default(false).notNull(),
  maxDailyDose: numeric("max_daily_dose", { precision: 12, scale: 3 }),
  doseUnit: varchar("dose_unit", { length: 15 }),
  pregnancyCategory: varchar("pregnancy_category", { length: 2 }),
  active: boolean("active").default(true).notNull(),
});

export type Drug = typeof drug.$inferSelect;
export type NewDrug = typeof drug.$inferInsert;

export const drugInteraction = pgTable("drug_interaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  genericA: varchar("generic_a", { length: 200 }).notNull(),
  genericB: varchar("generic_b", { length: 200 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull(),
  effect: varchar("effect", { length: 500 }),
  management: varchar("management", { length: 500 }),
  source: varchar("source", { length: 100 }),
});

export type DrugInteraction = typeof drugInteraction.$inferSelect;
export type NewDrugInteraction = typeof drugInteraction.$inferInsert;

export const prescription = pgTable("prescription", {
  id: uuid("id").primaryKey().defaultRandom(),
  rxNo: varchar("rx_no", { length: 20 }).notNull(),
  orderId: uuid("order_id"),
  encounterId: uuid("encounter_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  admissionId: uuid("admission_id"),
  prescriberStaffId: uuid("prescriber_staff_id").notNull(),
  prescriberLicenceNo: varchar("prescriber_licence_no", { length: 40 }),
  status: varchar("status", { length: 20 }).default('DRAFT').notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validUntil: date("valid_until"),
  notes: varchar("notes", { length: 500 }),
});

export type Prescription = typeof prescription.$inferSelect;
export type NewPrescription = typeof prescription.$inferInsert;

export const prescriptionItem = pgTable("prescription_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id").notNull(),
  drugId: uuid("drug_id").notNull(),
  dose: numeric("dose", { precision: 10, scale: 3 }).notNull(),
  doseUnit: varchar("dose_unit", { length: 15 }).notNull(),
  frequencyCode: varchar("frequency_code", { length: 8 }).notNull(),
  route: varchar("route", { length: 15 }).notNull(),
  durationDays: smallint("duration_days"),
  quantityPrescribed: numeric("quantity_prescribed", { precision: 12, scale: 3 }).notNull(),
  quantityDispensed: numeric("quantity_dispensed", { precision: 12, scale: 3 }).default("0").notNull(),
  isPrn: boolean("is_prn").default(false).notNull(),
  prnReason: varchar("prn_reason", { length: 200 }),
  instructions: varchar("instructions", { length: 300 }),
  indication: varchar("indication", { length: 200 }),
  substitutionAllowed: boolean("substitution_allowed").default(true).notNull(),
  startAt: timestamp("start_at", { withTimezone: true }),
  stopAt: timestamp("stop_at", { withTimezone: true }),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  stoppedReason: varchar("stopped_reason", { length: 200 }),
  alertOverrideReason: varchar("alert_override_reason", { length: 300 }),
});

export type PrescriptionItem = typeof prescriptionItem.$inferSelect;
export type NewPrescriptionItem = typeof prescriptionItem.$inferInsert;

export const bill = pgTable("bill", {
  id: uuid("id").primaryKey().defaultRandom(),
  billNo: varchar("bill_no", { length: 20 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id"),
  admissionId: uuid("admission_id"),
  payerType: varchar("payer_type", { length: 12 }).notNull(),
  patientInsuranceId: uuid("patient_insurance_id"),
  priceListId: uuid("price_list_id").notNull(),
  currency: char("currency", { length: 3 }).default('GHS').notNull(),
  status: varchar("status", { length: 15 }).default('OPEN').notNull(),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  waiverAmount: numeric("waiver_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  insurerAmount: numeric("insurer_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  insurerPaidAmount: numeric("insurer_paid_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  patientAmount: numeric("patient_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  depositApplied: numeric("deposit_applied", { precision: 14, scale: 2 }).default("0").notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }),
  finalisedAt: timestamp("finalised_at", { withTimezone: true }),
  finalisedBy: text("finalised_by"),
  version: integer("version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by"),
});

export type Bill = typeof bill.$inferSelect;
export type NewBill = typeof bill.$inferInsert;

export const billLine = pgTable("bill_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  billId: uuid("bill_id").notNull(),
  lineNo: integer("line_no").notNull(),
  serviceItemId: uuid("service_item_id").notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  sourceType: varchar("source_type", { length: 10 }).notNull(),
  sourceId: uuid("source_id"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  coveredAmount: numeric("covered_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  patientAmount: numeric("patient_amount", { precision: 14, scale: 2 }).notNull(),
  status: varchar("status", { length: 8 }).default('BILLED').notNull(),
  priceFlag: varchar("price_flag", { length: 14 }),
  serviceDate: date("service_date").notNull(),
  performedUnitId: uuid("performed_unit_id"),
  voidedBy: text("voided_by"),
  voidedReason: varchar("voided_reason", { length: 300 }),
});

export type BillLine = typeof billLine.$inferSelect;
export type NewBillLine = typeof billLine.$inferInsert;

export const cashierSession = pgTable("cashier_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  cashierUserId: text("cashier_user_id").notNull(),
  tillCode: varchar("till_code", { length: 20 }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  openingFloat: numeric("opening_float", { precision: 14, scale: 2 }).default("0").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expectedCash: numeric("expected_cash", { precision: 14, scale: 2 }),
  countedCash: numeric("counted_cash", { precision: 14, scale: 2 }),
  variance: numeric("variance", { precision: 14, scale: 2 }),
  status: varchar("status", { length: 10 }).default('OPEN').notNull(),
  reconciledBy: text("reconciled_by"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  note: varchar("note", { length: 300 }),
});

export type CashierSession = typeof cashierSession.$inferSelect;
export type NewCashierSession = typeof cashierSession.$inferInsert;

export const patientPayment = pgTable("patient_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: varchar("idempotency_key", { length: 60 }).notNull(),
  billId: uuid("bill_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  method: varchar("method", { length: 14 }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: char("currency", { length: 3 }).default('GHS').notNull(),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
  tendered: numeric("tendered", { precision: 14, scale: 2 }),
  changeGiven: numeric("change_given", { precision: 14, scale: 2 }),
  momoReferenceId: varchar("momo_reference_id", { length: 100 }),
  momoPhone: varchar("momo_phone", { length: 20 }),
  providerStatus: varchar("provider_status", { length: 20 }),
  providerCheckedAt: timestamp("provider_checked_at", { withTimezone: true }),
  cashierSessionId: uuid("cashier_session_id"),
  receivedBy: text("received_by").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  reversalOfId: uuid("reversal_of_id"),
  reversalReason: varchar("reversal_reason", { length: 300 }),
});

export type PatientPayment = typeof patientPayment.$inferSelect;
export type NewPatientPayment = typeof patientPayment.$inferInsert;

export const cashierLedger = pgTable("cashier_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  cashierSessionId: uuid("cashier_session_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  entryType: varchar("entry_type", { length: 14 }).notNull(),
  method: varchar("method", { length: 14 }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  refType: varchar("ref_type", { length: 20 }),
  refId: uuid("ref_id"),
  createdBy: text("created_by").notNull(),
});

export type CashierLedger = typeof cashierLedger.$inferSelect;
export type NewCashierLedger = typeof cashierLedger.$inferInsert;

export const receipt = pgTable("receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNo: varchar("receipt_no", { length: 20 }).notNull(),
  patientPaymentId: uuid("patient_payment_id").notNull(),
  billId: uuid("bill_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  printedCount: smallint("printed_count").default(0).notNull(),
  voided: boolean("voided").default(false).notNull(),
  pdfAttachmentId: uuid("pdf_attachment_id"),
});

export type Receipt = typeof receipt.$inferSelect;
export type NewReceipt = typeof receipt.$inferInsert;

export const patientDeposit = pgTable("patient_deposit", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  admissionId: uuid("admission_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
  receivedPaymentId: uuid("received_payment_id"),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
});

export type PatientDeposit = typeof patientDeposit.$inferSelect;
export type NewPatientDeposit = typeof patientDeposit.$inferInsert;

export const refund = pgTable("refund", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientPaymentId: uuid("patient_payment_id"),
  depositId: uuid("deposit_id"),
  billId: uuid("bill_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  status: varchar("status", { length: 10 }).default('REQUESTED').notNull(),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  paidVia: varchar("paid_via", { length: 14 }),
  cashierSessionId: uuid("cashier_session_id"),
});

export type Refund = typeof refund.$inferSelect;
export type NewRefund = typeof refund.$inferInsert;

export const waiverRequest = pgTable("waiver_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  billId: uuid("bill_id").notNull(),
  billLineId: uuid("bill_line_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reasonCode: varchar("reason_code", { length: 14 }).notNull(),
  note: varchar("note", { length: 500 }),
  evidenceAttachmentId: uuid("evidence_attachment_id"),
  status: varchar("status", { length: 10 }).default('REQUESTED').notNull(),
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export type WaiverRequest = typeof waiverRequest.$inferSelect;
export type NewWaiverRequest = typeof waiverRequest.$inferInsert;

export const creditNote = pgTable("credit_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  creditNoteNo: varchar("credit_note_no", { length: 20 }).notNull(),
  billId: uuid("bill_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CreditNote = typeof creditNote.$inferSelect;
export type NewCreditNote = typeof creditNote.$inferInsert;

export const labTest = pgTable("lab_test", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  loincCode: varchar("loinc_code", { length: 15 }),
  department: varchar("department", { length: 15 }).notNull(),
  specimenType: varchar("specimen_type", { length: 20 }).notNull(),
  container: varchar("container", { length: 30 }),
  minVolumeMl: numeric("min_volume_ml", { precision: 5, scale: 1 }),
  resultType: varchar("result_type", { length: 8 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  decimals: smallint("decimals").default(1),
  tatRoutineMinutes: integer("tat_routine_minutes").default(240).notNull(),
  tatStatMinutes: integer("tat_stat_minutes").default(60).notNull(),
  requiresFasting: boolean("requires_fasting").default(false).notNull(),
  collectionInstructions: varchar("collection_instructions", { length: 300 }),
  serviceItemId: uuid("service_item_id"),
  active: boolean("active").default(true).notNull(),
});

export type LabTest = typeof labTest.$inferSelect;
export type NewLabTest = typeof labTest.$inferInsert;

export const labPanel = pgTable("lab_panel", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  serviceItemId: uuid("service_item_id"),
  active: boolean("active").default(true).notNull(),
});

export type LabPanel = typeof labPanel.$inferSelect;
export type NewLabPanel = typeof labPanel.$inferInsert;

export const labPanelItem = pgTable("lab_panel_item", {
  panelId: uuid("panel_id").notNull(),
  testId: uuid("test_id").notNull(),
  sortOrder: smallint("sort_order").default(0).notNull(),
});

export type LabPanelItem = typeof labPanelItem.$inferSelect;
export type NewLabPanelItem = typeof labPanelItem.$inferInsert;

export const labReferenceRange = pgTable("lab_reference_range", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull(),
  sex: varchar("sex", { length: 6 }).default('ANY').notNull(),
  ageMinDays: integer("age_min_days").default(0).notNull(),
  ageMaxDays: integer("age_max_days").default(43800).notNull(),
  low: numeric("low", { precision: 12, scale: 4 }),
  high: numeric("high", { precision: 12, scale: 4 }),
  criticalLow: numeric("critical_low", { precision: 12, scale: 4 }),
  criticalHigh: numeric("critical_high", { precision: 12, scale: 4 }),
  unit: varchar("unit", { length: 20 }),
  rangeText: varchar("range_text", { length: 100 }),
});

export type LabReferenceRange = typeof labReferenceRange.$inferSelect;
export type NewLabReferenceRange = typeof labReferenceRange.$inferInsert;

export const labOrder = pgTable("lab_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  labOrderNo: varchar("lab_order_no", { length: 20 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  priority: varchar("priority", { length: 7 }).notNull(),
  status: varchar("status", { length: 10 }).default('ORDERED').notNull(),
  clinicalNotes: varchar("clinical_notes", { length: 500 }),
  collectionLocationId: uuid("collection_location_id"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
});

export type LabOrder = typeof labOrder.$inferSelect;
export type NewLabOrder = typeof labOrder.$inferInsert;

export const specimen = pgTable("specimen", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessionNo: varchar("accession_no", { length: 20 }).notNull(),
  labOrderId: uuid("lab_order_id").notNull(),
  specimenType: varchar("specimen_type", { length: 20 }).notNull(),
  container: varchar("container", { length: 30 }),
  status: varchar("status", { length: 10 }).default('COLLECTED').notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }),
  collectedByStaffId: uuid("collected_by_staff_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  receivedByStaffId: uuid("received_by_staff_id"),
  rejectionReason: varchar("rejection_reason", { length: 15 }),
  storageLocation: varchar("storage_location", { length: 50 }),
});

export type Specimen = typeof specimen.$inferSelect;
export type NewSpecimen = typeof specimen.$inferInsert;

export const labOrderItem = pgTable("lab_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  labOrderId: uuid("lab_order_id").notNull(),
  testId: uuid("test_id").notNull(),
  panelId: uuid("panel_id"),
  specimenId: uuid("specimen_id"),
  status: varchar("status", { length: 11 }).default('ORDERED').notNull(),
});

export type LabOrderItem = typeof labOrderItem.$inferSelect;
export type NewLabOrderItem = typeof labOrderItem.$inferInsert;

export const labResult = pgTable("lab_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  labOrderItemId: uuid("lab_order_item_id").notNull(),
  analyteCode: varchar("analyte_code", { length: 20 }).notNull(),
  valueNum: numeric("value_num", { precision: 14, scale: 4 }),
  valueText: varchar("value_text", { length: 500 }),
  valueCoded: varchar("value_coded", { length: 30 }),
  unit: varchar("unit", { length: 20 }),
  refLow: numeric("ref_low", { precision: 12, scale: 4 }),
  refHigh: numeric("ref_high", { precision: 12, scale: 4 }),
  refText: varchar("ref_text", { length: 100 }),
  flag: varchar("flag", { length: 4 }),
  isCritical: boolean("is_critical").default(false).notNull(),
  status: varchar("status", { length: 11 }).default('PRELIMINARY').notNull(),
  source: varchar("source", { length: 8 }).default('MANUAL').notNull(),
  instrumentId: varchar("instrument_id", { length: 40 }),
  resultedByStaffId: uuid("resulted_by_staff_id").notNull(),
  resultedAt: timestamp("resulted_at", { withTimezone: true }).defaultNow().notNull(),
  validatedByStaffId: uuid("validated_by_staff_id"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  amendsId: uuid("amends_id"),
  comment: varchar("comment", { length: 500 }),
});

export type LabResult = typeof labResult.$inferSelect;
export type NewLabResult = typeof labResult.$inferInsert;

export const criticalResultNotification = pgTable("critical_result_notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: varchar("source_type", { length: 8 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  notifiedToStaffId: uuid("notified_to_staff_id").notNull(),
  notifiedByStaffId: uuid("notified_by_staff_id").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }).defaultNow().notNull(),
  method: varchar("method", { length: 8 }).notNull(),
  readBackConfirmed: boolean("read_back_confirmed").default(false).notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export type CriticalResultNotification = typeof criticalResultNotification.$inferSelect;
export type NewCriticalResultNotification = typeof criticalResultNotification.$inferInsert;

export const imagingModality = pgTable("imaging_modality", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 8 }).notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  orgUnitId: uuid("org_unit_id"),
  active: boolean("active").default(true).notNull(),
});

export type ImagingModality = typeof imagingModality.$inferSelect;
export type NewImagingModality = typeof imagingModality.$inferInsert;

export const imagingProcedure = pgTable("imaging_procedure", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  modalityId: uuid("modality_id").notNull(),
  bodyPart: varchar("body_part", { length: 60 }),
  usesContrast: boolean("uses_contrast").default(false).notNull(),
  ionising: boolean("ionising").default(true).notNull(),
  pregnancySensitive: boolean("pregnancy_sensitive").default(false).notNull(),
  estDurationMin: smallint("est_duration_min").default(15).notNull(),
  prepInstructions: varchar("prep_instructions", { length: 500 }),
  serviceItemId: uuid("service_item_id"),
  active: boolean("active").default(true).notNull(),
});

export type ImagingProcedure = typeof imagingProcedure.$inferSelect;
export type NewImagingProcedure = typeof imagingProcedure.$inferInsert;

export const imagingOrder = pgTable("imaging_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  accessionNo: varchar("accession_no", { length: 20 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  procedureId: uuid("procedure_id").notNull(),
  laterality: varchar("laterality", { length: 9 }),
  priority: varchar("priority", { length: 7 }).notNull(),
  clinicalIndication: varchar("clinical_indication", { length: 500 }).notNull(),
  status: varchar("status", { length: 11 }).default('ORDERED').notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  performedAt: timestamp("performed_at", { withTimezone: true }),
  performedByStaffId: uuid("performed_by_staff_id"),
  pregnancyChecked: boolean("pregnancy_checked"),
  contrastAllergyChecked: boolean("contrast_allergy_checked"),
  renalFunctionChecked: boolean("renal_function_checked"),
  transportRequired: boolean("transport_required").default(false).notNull(),
});

export type ImagingOrder = typeof imagingOrder.$inferSelect;
export type NewImagingOrder = typeof imagingOrder.$inferInsert;

export const imagingStudy = pgTable("imaging_study", {
  id: uuid("id").primaryKey().defaultRandom(),
  imagingOrderId: uuid("imaging_order_id").notNull(),
  studyInstanceUid: varchar("study_instance_uid", { length: 128 }).notNull(),
  viewerUrl: varchar("viewer_url", { length: 500 }),
  imageCount: integer("image_count"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ImagingStudy = typeof imagingStudy.$inferSelect;
export type NewImagingStudy = typeof imagingStudy.$inferInsert;

export const imagingReport = pgTable("imaging_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  imagingOrderId: uuid("imaging_order_id").notNull(),
  version: integer("version").default(1).notNull(),
  addendumOfId: uuid("addendum_of_id"),
  findings: text("findings").notNull(),
  impression: text("impression").notNull(),
  criticalFinding: boolean("critical_finding").default(false).notNull(),
  status: varchar("status", { length: 11 }).default('PRELIMINARY').notNull(),
  reportedByStaffId: uuid("reported_by_staff_id").notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow().notNull(),
  verifiedByStaffId: uuid("verified_by_staff_id"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export type ImagingReport = typeof imagingReport.$inferSelect;
export type NewImagingReport = typeof imagingReport.$inferInsert;

export const room = pgTable("room", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgUnitId: uuid("org_unit_id").notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  roomType: varchar("room_type", { length: 15 }).notNull(),
  genderPolicy: varchar("gender_policy", { length: 6 }).default('MIXED').notNull(),
  active: boolean("active").default(true).notNull(),
});

export type Room = typeof room.$inferSelect;
export type NewRoom = typeof room.$inferInsert;

export const bed = pgTable("bed", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  bedNo: varchar("bed_no", { length: 15 }).notNull(),
  bedClass: varchar("bed_class", { length: 13 }).notNull(),
  serviceItemId: uuid("service_item_id"),
  status: varchar("status", { length: 12 }).default('AVAILABLE').notNull(),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow().notNull(),
  active: boolean("active").default(true).notNull(),
});

export type Bed = typeof bed.$inferSelect;
export type NewBed = typeof bed.$inferInsert;

export const bedBlock = pgTable("bed_block", {
  id: uuid("id").primaryKey().defaultRandom(),
  bedId: uuid("bed_id").notNull(),
  reason: varchar("reason", { length: 20 }).notNull(),
  blockedFrom: timestamp("blocked_from", { withTimezone: true }).notNull(),
  blockedTo: timestamp("blocked_to", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  note: varchar("note", { length: 300 }),
});

export type BedBlock = typeof bedBlock.$inferSelect;
export type NewBedBlock = typeof bedBlock.$inferInsert;

export const bedRequest = pgTable("bed_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  requestedUnitId: uuid("requested_unit_id"),
  requestedClass: varchar("requested_class", { length: 13 }),
  priority: varchar("priority", { length: 9 }).default('ROUTINE').notNull(),
  isolationRequired: boolean("isolation_required").default(false).notNull(),
  clinicalSummary: varchar("clinical_summary", { length: 500 }),
  requestedByStaffId: uuid("requested_by_staff_id").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }),
});

export type BedRequest = typeof bedRequest.$inferSelect;
export type NewBedRequest = typeof bedRequest.$inferInsert;

export const admission = pgTable("admission", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionNo: varchar("admission_no", { length: 20 }).notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  bedRequestId: uuid("bed_request_id"),
  admittingEncounterId: uuid("admitting_encounter_id"),
  attendingStaffId: uuid("attending_staff_id").notNull(),
  currentUnitId: uuid("current_unit_id").notNull(),
  admissionType: varchar("admission_type", { length: 10 }).notNull(),
  status: varchar("status", { length: 16 }).default('PENDING_BED').notNull(),
  admittedAt: timestamp("admitted_at", { withTimezone: true }),
  expectedDischargeDate: date("expected_discharge_date"),
  dischargePlannedAt: timestamp("discharge_planned_at", { withTimezone: true }),
  dischargedAt: timestamp("discharged_at", { withTimezone: true }),
  dischargeType: varchar("discharge_type", { length: 16 }),
  primaryDiagnosisIcd10: varchar("primary_diagnosis_icd10", { length: 10 }),
  isolationStatus: varchar("isolation_status", { length: 10 }).default('NONE').notNull(),
  timeOfDeath: timestamp("time_of_death", { withTimezone: true }),
  causeOfDeathIcd10: varchar("cause_of_death_icd10", { length: 10 }),
});

export type Admission = typeof admission.$inferSelect;
export type NewAdmission = typeof admission.$inferInsert;

export const bedAssignment = pgTable("bed_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  bedId: uuid("bed_id").notNull(),
  orgUnitId: uuid("org_unit_id").notNull(),
  assignedFrom: timestamp("assigned_from", { withTimezone: true }).notNull(),
  assignedTo: timestamp("assigned_to", { withTimezone: true }),
  reason: varchar("reason", { length: 10 }).notNull(),
  assignedBy: text("assigned_by").notNull(),
});

export type BedAssignment = typeof bedAssignment.$inferSelect;
export type NewBedAssignment = typeof bedAssignment.$inferInsert;

export const dischargeSummary = pgTable("discharge_summary", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  version: integer("version").default(1).notNull(),
  amendsId: uuid("amends_id"),
  dischargeDiagnosis: text("discharge_diagnosis").notNull(),
  icd10Primary: varchar("icd10_primary", { length: 10 }),
  procedures: text("procedures"),
  hospitalCourse: text("hospital_course").notNull(),
  conditionAtDischarge: varchar("condition_at_discharge", { length: 200 }).notNull(),
  dischargeMedications: text("discharge_medications"),
  followUpInstructions: text("follow_up_instructions"),
  followUpDate: date("follow_up_date"),
  status: varchar("status", { length: 8 }).default('DRAFT').notNull(),
  authoredByStaffId: uuid("authored_by_staff_id").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
});

export type DischargeSummary = typeof dischargeSummary.$inferSelect;
export type NewDischargeSummary = typeof dischargeSummary.$inferInsert;

export const nursingAssessment = pgTable("nursing_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  assessmentType: varchar("assessment_type", { length: 16 }).notNull(),
  score: numeric("score", { precision: 5, scale: 1 }),
  riskLevel: varchar("risk_level", { length: 8 }),
  formData: jsonb("form_data").notNull(),
  formVersion: varchar("form_version", { length: 10 }).notNull(),
  assessedByStaffId: uuid("assessed_by_staff_id").notNull(),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NursingAssessment = typeof nursingAssessment.$inferSelect;
export type NewNursingAssessment = typeof nursingAssessment.$inferInsert;

export const carePlan = pgTable("care_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  problem: varchar("problem", { length: 300 }).notNull(),
  goal: varchar("goal", { length: 300 }).notNull(),
  targetDate: date("target_date"),
  status: varchar("status", { length: 12 }).default('ACTIVE').notNull(),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CarePlan = typeof carePlan.$inferSelect;
export type NewCarePlan = typeof carePlan.$inferInsert;

export const carePlanTask = pgTable("care_plan_task", {
  id: uuid("id").primaryKey().defaultRandom(),
  carePlanId: uuid("care_plan_id"),
  admissionId: uuid("admission_id").notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  recurrence: varchar("recurrence", { length: 20 }),
  status: varchar("status", { length: 10 }).default('DUE').notNull(),
  source: varchar("source", { length: 10 }).default('MANUAL').notNull(),
  completedByStaffId: uuid("completed_by_staff_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  skipReason: varchar("skip_reason", { length: 200 }),
});

export type CarePlanTask = typeof carePlanTask.$inferSelect;
export type NewCarePlanTask = typeof carePlanTask.$inferInsert;

export const medicationAdministration = pgTable("medication_administration", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  prescriptionItemId: uuid("prescription_item_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 10 }).default('SCHEDULED').notNull(),
  isPrn: boolean("is_prn").default(false).notNull(),
  administeredAt: timestamp("administered_at", { withTimezone: true }),
  administeredByStaffId: uuid("administered_by_staff_id"),
  witnessedByStaffId: uuid("witnessed_by_staff_id"),
  doseGiven: numeric("dose_given", { precision: 10, scale: 3 }),
  doseUnit: varchar("dose_unit", { length: 15 }),
  route: varchar("route", { length: 15 }),
  stockBatchId: uuid("stock_batch_id"),
  reason: varchar("reason", { length: 300 }),
  scanVerified: boolean("scan_verified").default(false).notNull(),
});

export type MedicationAdministration = typeof medicationAdministration.$inferSelect;
export type NewMedicationAdministration = typeof medicationAdministration.$inferInsert;

export const intakeOutput = pgTable("intake_output", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  direction: varchar("direction", { length: 6 }).notNull(),
  category: varchar("category", { length: 8 }).notNull(),
  volumeMl: numeric("volume_ml", { precision: 7, scale: 1 }).notNull(),
  recordedByStaffId: uuid("recorded_by_staff_id").notNull(),
});

export type IntakeOutput = typeof intakeOutput.$inferSelect;
export type NewIntakeOutput = typeof intakeOutput.$inferInsert;

export const nursingNote = pgTable("nursing_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull(),
  noteType: varchar("note_type", { length: 10 }).notNull(),
  body: text("body").notNull(),
  shiftTypeId: uuid("shift_type_id"),
  authoredByStaffId: uuid("authored_by_staff_id").notNull(),
  authoredAt: timestamp("authored_at", { withTimezone: true }).defaultNow().notNull(),
  amendsId: uuid("amends_id"),
});

export type NursingNote = typeof nursingNote.$inferSelect;
export type NewNursingNote = typeof nursingNote.$inferInsert;

export const shiftHandover = pgTable("shift_handover", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgUnitId: uuid("org_unit_id").notNull(),
  fromRosterDate: date("from_roster_date").notNull(),
  fromShiftTypeId: uuid("from_shift_type_id").notNull(),
  outgoingStaffId: uuid("outgoing_staff_id").notNull(),
  incomingStaffId: uuid("incoming_staff_id"),
  status: varchar("status", { length: 12 }).default('DRAFT').notNull(),
  summary: text("summary"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export type ShiftHandover = typeof shiftHandover.$inferSelect;
export type NewShiftHandover = typeof shiftHandover.$inferInsert;

export const handoverItem = pgTable("handover_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id").notNull(),
  admissionId: uuid("admission_id").notNull(),
  situation: text("situation"),
  background: text("background"),
  assessment: text("assessment"),
  recommendation: text("recommendation"),
  pendingTasks: text("pending_tasks"),
  ewsBand: varchar("ews_band", { length: 8 }),
  isolation: boolean("isolation"),
  fallsRisk: boolean("falls_risk"),
  pressureRisk: boolean("pressure_risk"),
});

export type HandoverItem = typeof handoverItem.$inferSelect;
export type NewHandoverItem = typeof handoverItem.$inferInsert;

export const nursePatientAllocation = pgTable("nurse_patient_allocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  rosterEntryId: uuid("roster_entry_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  admissionId: uuid("admission_id").notNull(),
  role: varchar("role", { length: 9 }).default('PRIMARY').notNull(),
  allocatedFrom: timestamp("allocated_from", { withTimezone: true }).notNull(),
  allocatedTo: timestamp("allocated_to", { withTimezone: true }),
  allocatedBy: text("allocated_by").notNull(),
});

export type NursePatientAllocation = typeof nursePatientAllocation.$inferSelect;
export type NewNursePatientAllocation = typeof nursePatientAllocation.$inferInsert;

export const store = pgTable("store", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  storeType: varchar("store_type", { length: 12 }).notNull(),
  orgUnitId: uuid("org_unit_id"),
  parentStoreId: uuid("parent_store_id"),
  isDispensing: boolean("is_dispensing").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type Store = typeof store.$inferSelect;
export type NewStore = typeof store.$inferInsert;

export const itemCategory = pgTable("item_category", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  parentId: uuid("parent_id"),
});

export type ItemCategory = typeof itemCategory.$inferSelect;
export type NewItemCategory = typeof itemCategory.$inferInsert;

export const item = pgTable("item", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  itemType: varchar("item_type", { length: 12 }).notNull(),
  categoryId: uuid("category_id"),
  uom: varchar("uom", { length: 15 }).notNull(),
  packSize: numeric("pack_size", { precision: 10, scale: 2 }).default("1").notNull(),
  isBatchTracked: boolean("is_batch_tracked").default(true).notNull(),
  isExpiryTracked: boolean("is_expiry_tracked").default(true).notNull(),
  isControlled: boolean("is_controlled").default(false).notNull(),
  storageCondition: varchar("storage_condition", { length: 10 }).default('AMBIENT').notNull(),
  reorderLevel: numeric("reorder_level", { precision: 14, scale: 3 }).default("0").notNull(),
  reorderQty: numeric("reorder_qty", { precision: 14, scale: 3 }).default("0").notNull(),
  maxLevel: numeric("max_level", { precision: 14, scale: 3 }),
  active: boolean("active").default(true).notNull(),
});

export type Item = typeof item.$inferSelect;
export type NewItem = typeof item.$inferInsert;

export const supplier = pgTable("supplier", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  tin: varchar("tin", { length: 20 }),
  contactName: varchar("contact_name", { length: 100 }),
  phone: varchar("phone", { length: 25 }),
  email: varchar("email", { length: 255 }),
  address: varchar("address", { length: 255 }),
  paymentTermsDays: smallint("payment_terms_days").default(30).notNull(),
  momoNumber: varchar("momo_number", { length: 20 }),
  bankDetails: varchar("bank_details", { length: 255 }),
  active: boolean("active").default(true).notNull(),
});

export type Supplier = typeof supplier.$inferSelect;
export type NewSupplier = typeof supplier.$inferInsert;

export const stockBatch = pgTable("stock_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),
  itemId: uuid("item_id").notNull(),
  batchNo: varchar("batch_no", { length: 40 }),
  expiryDate: date("expiry_date"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  qtyOnHand: numeric("qty_on_hand", { precision: 14, scale: 3 }).default("0").notNull(),
  qtyReserved: numeric("qty_reserved", { precision: 14, scale: 3 }).default("0").notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  supplierId: uuid("supplier_id"),
});

export type StockBatch = typeof stockBatch.$inferSelect;
export type NewStockBatch = typeof stockBatch.$inferInsert;

export const stockLedger = pgTable("stock_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  storeId: uuid("store_id").notNull(),
  itemId: uuid("item_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  txnType: varchar("txn_type", { length: 16 }).notNull(),
  qtyDelta: numeric("qty_delta", { precision: 14, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 14, scale: 3 }).notNull(),
  refType: varchar("ref_type", { length: 20 }).notNull(),
  refId: uuid("ref_id").notNull(),
  lineNo: integer("line_no").default(1).notNull(),
  reason: varchar("reason", { length: 300 }),
  createdBy: text("created_by").notNull(),
});

export type StockLedger = typeof stockLedger.$inferSelect;
export type NewStockLedger = typeof stockLedger.$inferInsert;

export const requisition = pgTable("requisition", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqNo: varchar("req_no", { length: 20 }).notNull(),
  fromStoreId: uuid("from_store_id").notNull(),
  toStoreId: uuid("to_store_id").notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  issuedBy: text("issued_by"),
  receivedBy: text("received_by"),
  note: varchar("note", { length: 300 }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Requisition = typeof requisition.$inferSelect;
export type NewRequisition = typeof requisition.$inferInsert;

export const requisitionLine = pgTable("requisition_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").notNull(),
  itemId: uuid("item_id").notNull(),
  qtyRequested: numeric("qty_requested", { precision: 14, scale: 3 }).notNull(),
  qtyApproved: numeric("qty_approved", { precision: 14, scale: 3 }),
  qtyIssued: numeric("qty_issued", { precision: 14, scale: 3 }),
  qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }),
});

export type RequisitionLine = typeof requisitionLine.$inferSelect;
export type NewRequisitionLine = typeof requisitionLine.$inferInsert;

export const purchaseOrder = pgTable("purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNo: varchar("po_no", { length: 20 }).notNull(),
  supplierId: uuid("supplier_id").notNull(),
  storeId: uuid("store_id").notNull(),
  status: varchar("status", { length: 18 }).default('DRAFT').notNull(),
  orderDate: date("order_date").notNull(),
  expectedDate: date("expected_date"),
  currency: char("currency", { length: 3 }).default('GHS').notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export type PurchaseOrder = typeof purchaseOrder.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrder.$inferInsert;

export const purchaseOrderLine = pgTable("purchase_order_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  itemId: uuid("item_id").notNull(),
  qtyOrdered: numeric("qty_ordered", { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
  qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }).default("0").notNull(),
});

export type PurchaseOrderLine = typeof purchaseOrderLine.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLine.$inferInsert;

export const goodsReceivedNote = pgTable("goods_received_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  grnNo: varchar("grn_no", { length: 20 }).notNull(),
  purchaseOrderId: uuid("purchase_order_id"),
  supplierId: uuid("supplier_id").notNull(),
  storeId: uuid("store_id").notNull(),
  deliveryNoteNo: varchar("delivery_note_no", { length: 40 }),
  invoiceNo: varchar("invoice_no", { length: 40 }),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  receivedBy: text("received_by").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
});

export type GoodsReceivedNote = typeof goodsReceivedNote.$inferSelect;
export type NewGoodsReceivedNote = typeof goodsReceivedNote.$inferInsert;

export const grnLine = pgTable("grn_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  grnId: uuid("grn_id").notNull(),
  poLineId: uuid("po_line_id"),
  itemId: uuid("item_id").notNull(),
  batchNo: varchar("batch_no", { length: 40 }),
  expiryDate: date("expiry_date"),
  qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }).notNull(),
  qtyRejected: numeric("qty_rejected", { precision: 14, scale: 3 }).default("0").notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
  rejectReason: varchar("reject_reason", { length: 200 }),
});

export type GrnLine = typeof grnLine.$inferSelect;
export type NewGrnLine = typeof grnLine.$inferInsert;

export const stockTake = pgTable("stock_take", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull(),
  takeType: varchar("take_type", { length: 10 }).notNull(),
  status: varchar("status", { length: 10 }).default('OPEN').notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  startedBy: text("started_by").notNull(),
  approvedBy: text("approved_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
});

export type StockTake = typeof stockTake.$inferSelect;
export type NewStockTake = typeof stockTake.$inferInsert;

export const stockTakeLine = pgTable("stock_take_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockTakeId: uuid("stock_take_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  systemQty: numeric("system_qty", { precision: 14, scale: 3 }).notNull(),
  countedQty: numeric("counted_qty", { precision: 14, scale: 3 }),
  variance: numeric("variance", { precision: 14, scale: 3 }),
  reason: varchar("reason", { length: 200 }),
});

export type StockTakeLine = typeof stockTakeLine.$inferSelect;
export type NewStockTakeLine = typeof stockTakeLine.$inferInsert;

export const supplierInvoice = pgTable("supplier_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull(),
  invoiceNo: varchar("invoice_no", { length: 40 }).notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  purchaseOrderId: uuid("purchase_order_id"),
  grnId: uuid("grn_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  matchStatus: varchar("match_status", { length: 10 }).default('UNMATCHED').notNull(),
  status: varchar("status", { length: 10 }).default('RECEIVED').notNull(),
  paymentId: uuid("payment_id"),
});

export type SupplierInvoice = typeof supplierInvoice.$inferSelect;
export type NewSupplierInvoice = typeof supplierInvoice.$inferInsert;

export const dispense = pgTable("dispense", {
  id: uuid("id").primaryKey().defaultRandom(),
  dispenseNo: varchar("dispense_no", { length: 20 }).notNull(),
  saleType: varchar("sale_type", { length: 12 }).default('PRESCRIPTION').notNull(),
  prescriptionId: uuid("prescription_id"),
  patientId: uuid("patient_id"),
  visitId: uuid("visit_id"),
  admissionId: uuid("admission_id"),
  storeId: uuid("store_id").notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  paymentStatus: varchar("payment_status", { length: 14 }).default('NOT_REQUIRED').notNull(),
  preparedByStaffId: uuid("prepared_by_staff_id"),
  verifiedByStaffId: uuid("verified_by_staff_id"),
  dispensedAt: timestamp("dispensed_at", { withTimezone: true }),
  counselled: boolean("counselled").default(false).notNull(),
});

export type Dispense = typeof dispense.$inferSelect;
export type NewDispense = typeof dispense.$inferInsert;

export const dispenseItem = pgTable("dispense_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  dispenseId: uuid("dispense_id").notNull(),
  prescriptionItemId: uuid("prescription_item_id"),
  drugId: uuid("drug_id").notNull(),
  stockBatchId: uuid("stock_batch_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  substitutedForDrugId: uuid("substituted_for_drug_id"),
  labelText: varchar("label_text", { length: 500 }),
});

export type DispenseItem = typeof dispenseItem.$inferSelect;
export type NewDispenseItem = typeof dispenseItem.$inferInsert;

export const dispenseReturn = pgTable("dispense_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  dispenseItemId: uuid("dispense_item_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  returnedBy: text("returned_by").notNull(),
  acceptedByStaffId: uuid("accepted_by_staff_id").notNull(),
  restock: boolean("restock").default(false).notNull(),
  returnedAt: timestamp("returned_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DispenseReturn = typeof dispenseReturn.$inferSelect;
export type NewDispenseReturn = typeof dispenseReturn.$inferInsert;

export const controlledDrugRegister = pgTable("controlled_drug_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryNo: bigint("entry_no", { mode: "number" }),
  storeId: uuid("store_id").notNull(),
  itemId: uuid("item_id").notNull(),
  batchId: uuid("batch_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  txnType: varchar("txn_type", { length: 12 }).notNull(),
  qtyDelta: numeric("qty_delta", { precision: 12, scale: 3 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 3 }).notNull(),
  patientId: uuid("patient_id"),
  prescriptionItemId: uuid("prescription_item_id"),
  performedByStaffId: uuid("performed_by_staff_id").notNull(),
  witnessedByStaffId: uuid("witnessed_by_staff_id"),
  note: varchar("note", { length: 300 }),
});

export type ControlledDrugRegister = typeof controlledDrugRegister.$inferSelect;
export type NewControlledDrugRegister = typeof controlledDrugRegister.$inferInsert;

export const pharmacyIntervention = pgTable("pharmacy_intervention", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id").notNull(),
  pharmacistStaffId: uuid("pharmacist_staff_id").notNull(),
  type: varchar("type", { length: 14 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  outcome: varchar("outcome", { length: 200 }),
  prescriberNotifiedAt: timestamp("prescriber_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PharmacyIntervention = typeof pharmacyIntervention.$inferSelect;
export type NewPharmacyIntervention = typeof pharmacyIntervention.$inferInsert;

export const wardStockIssue = pgTable("ward_stock_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromStoreId: uuid("from_store_id").notNull(),
  toStoreId: uuid("to_store_id").notNull(),
  admissionId: uuid("admission_id"),
  itemId: uuid("item_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  issuedByStaffId: uuid("issued_by_staff_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WardStockIssue = typeof wardStockIssue.$inferSelect;
export type NewWardStockIssue = typeof wardStockIssue.$inferInsert;

export const payer = pgTable("payer", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  payerType: varchar("payer_type", { length: 12 }).notNull(),
  contactName: varchar("contact_name", { length: 100 }),
  phone: varchar("phone", { length: 25 }),
  email: varchar("email", { length: 255 }),
  address: varchar("address", { length: 255 }),
  claimFormat: varchar("claim_format", { length: 20 }).default('CSV').notNull(),
  priceListId: uuid("price_list_id"),
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  paymentTermsDays: smallint("payment_terms_days").default(60).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type Payer = typeof payer.$inferSelect;
export type NewPayer = typeof payer.$inferInsert;

export const insurancePlan = pgTable("insurance_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  payerId: uuid("payer_id").notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  priceListId: uuid("price_list_id"),
  copayPercent: numeric("copay_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  annualLimit: numeric("annual_limit", { precision: 14, scale: 2 }),
  requiresReferral: boolean("requires_referral").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type InsurancePlan = typeof insurancePlan.$inferSelect;
export type NewInsurancePlan = typeof insurancePlan.$inferInsert;

export const coverageRule = pgTable("coverage_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull(),
  serviceCategory: varchar("service_category", { length: 15 }),
  serviceItemId: uuid("service_item_id"),
  coveredPercent: numeric("covered_percent", { precision: 5, scale: 2 }).default("100").notNull(),
  perVisitLimit: numeric("per_visit_limit", { precision: 14, scale: 2 }),
  requiresPreauth: boolean("requires_preauth").default(false).notNull(),
  isExclusion: boolean("is_exclusion").default(false).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export type CoverageRule = typeof coverageRule.$inferSelect;
export type NewCoverageRule = typeof coverageRule.$inferInsert;

export const patientInsurance = pgTable("patient_insurance", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id").notNull(),
  payerId: uuid("payer_id").notNull(),
  planId: uuid("plan_id"),
  memberNo: varchar("member_no", { length: 40 }).notNull(),
  cardExpiry: date("card_expiry"),
  principalMemberName: varchar("principal_member_name", { length: 150 }),
  relationship: varchar("relationship", { length: 8 }).default('SELF').notNull(),
  isPrimary: boolean("is_primary").default(true).notNull(),
  status: varchar("status", { length: 10 }).default('ACTIVE').notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  verificationMethod: varchar("verification_method", { length: 12 }),
  cardAttachmentId: uuid("card_attachment_id"),
});

export type PatientInsurance = typeof patientInsurance.$inferSelect;
export type NewPatientInsurance = typeof patientInsurance.$inferInsert;

export const eligibilityCheck = pgTable("eligibility_check", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientInsuranceId: uuid("patient_insurance_id").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  checkedBy: text("checked_by").notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  status: varchar("status", { length: 12 }).notNull(),
  reference: varchar("reference", { length: 100 }),
  responseSummary: varchar("response_summary", { length: 500 }),
});

export type EligibilityCheck = typeof eligibilityCheck.$inferSelect;
export type NewEligibilityCheck = typeof eligibilityCheck.$inferInsert;

export const preauthorization = pgTable("preauthorization", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientInsuranceId: uuid("patient_insurance_id").notNull(),
  visitId: uuid("visit_id"),
  admissionId: uuid("admission_id"),
  serviceItemId: uuid("service_item_id"),
  description: varchar("description", { length: 300 }).notNull(),
  requestedAmount: numeric("requested_amount", { precision: 14, scale: 2 }),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  status: varchar("status", { length: 10 }).default('REQUESTED').notNull(),
  authNumber: varchar("auth_number", { length: 60 }),
  validUntil: date("valid_until"),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: varchar("decision_note", { length: 300 }),
});

export type Preauthorization = typeof preauthorization.$inferSelect;
export type NewPreauthorization = typeof preauthorization.$inferInsert;

export const claimRejectionCode = pgTable("claim_rejection_code", {
  code: varchar("code", { length: 15 }).primaryKey(),
  description: varchar("description", { length: 300 }).notNull(),
  category: varchar("category", { length: 15 }).notNull(),
  resubmittable: boolean("resubmittable").default(true).notNull(),
});

export type ClaimRejectionCode = typeof claimRejectionCode.$inferSelect;
export type NewClaimRejectionCode = typeof claimRejectionCode.$inferInsert;

export const claimBatch = pgTable("claim_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNo: varchar("batch_no", { length: 20 }).notNull(),
  payerId: uuid("payer_id").notNull(),
  periodYear: smallint("period_year").notNull(),
  periodMonth: smallint("period_month").notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  claimCount: integer("claim_count").default(0).notNull(),
  totalClaimed: numeric("total_claimed", { precision: 14, scale: 2 }).default("0").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: text("submitted_by"),
  submissionReference: varchar("submission_reference", { length: 100 }),
  exportAttachmentId: uuid("export_attachment_id"),
});

export type ClaimBatch = typeof claimBatch.$inferSelect;
export type NewClaimBatch = typeof claimBatch.$inferInsert;

export const claim = pgTable("claim", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimNo: varchar("claim_no", { length: 20 }).notNull(),
  payerId: uuid("payer_id").notNull(),
  patientInsuranceId: uuid("patient_insurance_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  billId: uuid("bill_id").notNull(),
  visitId: uuid("visit_id"),
  admissionId: uuid("admission_id"),
  claimBatchId: uuid("claim_batch_id"),
  claimType: varchar("claim_type", { length: 3 }).notNull(),
  serviceFrom: date("service_from").notNull(),
  serviceTo: date("service_to").notNull(),
  primaryIcd10: varchar("primary_icd10", { length: 10 }),
  drgCode: varchar("drg_code", { length: 15 }),
  status: varchar("status", { length: 15 }).default('DRAFT').notNull(),
  claimedAmount: numeric("claimed_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  copayAmount: numeric("copay_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  resubmissionOfId: uuid("resubmission_of_id"),
  version: integer("version").default(0).notNull(),
});

export type Claim = typeof claim.$inferSelect;
export type NewClaim = typeof claim.$inferInsert;

export const claimLine = pgTable("claim_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull(),
  billLineId: uuid("bill_line_id").notNull(),
  serviceItemId: uuid("service_item_id").notNull(),
  tariffCode: varchar("tariff_code", { length: 30 }),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  claimedAmount: numeric("claimed_amount", { precision: 14, scale: 2 }).notNull(),
  approvedAmount: numeric("approved_amount", { precision: 14, scale: 2 }),
  rejectionCode: varchar("rejection_code", { length: 15 }),
  rejectionNote: varchar("rejection_note", { length: 300 }),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
});

export type ClaimLine = typeof claimLine.$inferSelect;
export type NewClaimLine = typeof claimLine.$inferInsert;

export const remittance = pgTable("remittance", {
  id: uuid("id").primaryKey().defaultRandom(),
  remittanceNo: varchar("remittance_no", { length: 20 }).notNull(),
  payerId: uuid("payer_id").notNull(),
  receivedDate: date("received_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  method: varchar("method", { length: 8 }).notNull(),
  reference: varchar("reference", { length: 100 }),
  status: varchar("status", { length: 11 }).default('UNALLOCATED').notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Remittance = typeof remittance.$inferSelect;
export type NewRemittance = typeof remittance.$inferInsert;

export const remittanceAllocation = pgTable("remittance_allocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  remittanceId: uuid("remittance_id").notNull(),
  claimId: uuid("claim_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  allocatedBy: text("allocated_by").notNull(),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RemittanceAllocation = typeof remittanceAllocation.$inferSelect;
export type NewRemittanceAllocation = typeof remittanceAllocation.$inferInsert;

export const leaveType = pgTable("leave_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  isPaid: boolean("is_paid").default(true).notNull(),
  entitlementDays: numeric("entitlement_days", { precision: 5, scale: 1 }).default("0").notNull(),
  accrualMethod: varchar("accrual_method", { length: 8 }).default('UPFRONT').notNull(),
  carryOverMaxDays: numeric("carry_over_max_days", { precision: 5, scale: 1 }).default("0").notNull(),
  countsCalendarDays: boolean("counts_calendar_days").default(false).notNull(),
  minNoticeDays: smallint("min_notice_days").default(0).notNull(),
  maxConsecutiveDays: smallint("max_consecutive_days"),
  requiresAttachmentAfterDays: smallint("requires_attachment_after_days"),
  genderRestriction: varchar("gender_restriction", { length: 6 }),
  appliesTo: varchar("applies_to", { length: 12 }).default('ALL').notNull(),
  active: boolean("active").default(true).notNull(),
});

export type LeaveType = typeof leaveType.$inferSelect;
export type NewLeaveType = typeof leaveType.$inferInsert;

export const leaveBalance = pgTable("leave_balance", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  leaveYear: smallint("leave_year").notNull(),
  entitled: numeric("entitled", { precision: 5, scale: 1 }).default("0").notNull(),
  accrued: numeric("accrued", { precision: 5, scale: 1 }).default("0").notNull(),
  carriedOver: numeric("carried_over", { precision: 5, scale: 1 }).default("0").notNull(),
  adjusted: numeric("adjusted", { precision: 5, scale: 1 }).default("0").notNull(),
  taken: numeric("taken", { precision: 5, scale: 1 }).default("0").notNull(),
  pending: numeric("pending", { precision: 5, scale: 1 }).default("0").notNull(),
  available: numeric("available", { precision: 5, scale: 1 }),
});

export type LeaveBalance = typeof leaveBalance.$inferSelect;
export type NewLeaveBalance = typeof leaveBalance.$inferInsert;

export const leaveRequest = pgTable("leave_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestNo: varchar("request_no", { length: 20 }).notNull(),
  staffId: uuid("staff_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  startHalfDay: boolean("start_half_day").default(false).notNull(),
  endHalfDay: boolean("end_half_day").default(false).notNull(),
  days: numeric("days", { precision: 5, scale: 1 }).notNull(),
  status: varchar("status", { length: 12 }).default('DRAFT').notNull(),
  reason: varchar("reason", { length: 500 }),
  reliefStaffId: uuid("relief_staff_id"),
  attachmentId: uuid("attachment_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  coverageWarning: varchar("coverage_warning", { length: 300 }),
});

export type LeaveRequest = typeof leaveRequest.$inferSelect;
export type NewLeaveRequest = typeof leaveRequest.$inferInsert;

export const leaveApproval = pgTable("leave_approval", {
  id: uuid("id").primaryKey().defaultRandom(),
  leaveRequestId: uuid("leave_request_id").notNull(),
  step: smallint("step").notNull(),
  approverUserId: text("approver_user_id").notNull(),
  approverStaffId: uuid("approver_staff_id"),
  decision: varchar("decision", { length: 8 }).notNull(),
  comment: varchar("comment", { length: 300 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LeaveApproval = typeof leaveApproval.$inferSelect;
export type NewLeaveApproval = typeof leaveApproval.$inferInsert;

export const overtimeRequest = pgTable("overtime_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  attendanceRecordId: uuid("attendance_record_id"),
  workDate: date("work_date").notNull(),
  minutes: integer("minutes").notNull(),
  reason: varchar("reason", { length: 300 }),
  source: varchar("source", { length: 10 }).default('SUGGESTED').notNull(),
  status: varchar("status", { length: 10 }).default('PENDING').notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export type OvertimeRequest = typeof overtimeRequest.$inferSelect;
export type NewOvertimeRequest = typeof overtimeRequest.$inferInsert;

export const salaryScale = pgTable("salary_scale", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  grade: varchar("grade", { length: 20 }).notNull(),
  step: smallint("step").default(1).notNull(),
  baseAmount: numeric("base_amount", { precision: 14, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export type SalaryScale = typeof salaryScale.$inferSelect;
export type NewSalaryScale = typeof salaryScale.$inferInsert;

export const staffCompensation = pgTable("staff_compensation", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  salaryScaleId: uuid("salary_scale_id"),
  baseSalary: numeric("base_salary", { precision: 14, scale: 2 }).notNull(),
  payoutMethod: varchar("payout_method", { length: 6 }).notNull(),
  momoNumber: varchar("momo_number", { length: 20 }),
  momoName: varchar("momo_name", { length: 200 }),
  bankName: varchar("bank_name", { length: 100 }),
  bankAccount: varchar("bank_account", { length: 40 }),
  ssnitNumber: varchar("ssnit_number", { length: 20 }),
  tin: varchar("tin", { length: 20 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export type StaffCompensation = typeof staffCompensation.$inferSelect;
export type NewStaffCompensation = typeof staffCompensation.$inferInsert;

export const payElement = pgTable("pay_element", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  elementType: varchar("element_type", { length: 12 }).notNull(),
  calcMethod: varchar("calc_method", { length: 12 }).notNull(),
  isTaxable: boolean("is_taxable").default(true).notNull(),
  isPensionable: boolean("is_pensionable").default(false).notNull(),
  isRecurring: boolean("is_recurring").default(true).notNull(),
  exportCode: varchar("export_code", { length: 30 }),
  sortOrder: smallint("sort_order").default(100).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type PayElement = typeof payElement.$inferSelect;
export type NewPayElement = typeof payElement.$inferInsert;

export const staffPayElement = pgTable("staff_pay_element", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").notNull(),
  payElementId: uuid("pay_element_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  percent: numeric("percent", { precision: 7, scale: 4 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  note: varchar("note", { length: 200 }),
});

export type StaffPayElement = typeof staffPayElement.$inferSelect;
export type NewStaffPayElement = typeof staffPayElement.$inferInsert;

export const allowanceRule = pgTable("allowance_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  payElementId: uuid("pay_element_id").notNull(),
  shiftCategory: varchar("shift_category", { length: 12 }),
  dayType: varchar("day_type", { length: 8 }),
  staffCategory: varchar("staff_category", { length: 12 }),
  jobRoleId: uuid("job_role_id"),
  orgUnitType: varchar("org_unit_type", { length: 15 }),
  unitOfMeasure: varchar("unit_of_measure", { length: 9 }).notNull(),
  rate: numeric("rate", { precision: 14, scale: 2 }),
  multiplier: numeric("multiplier", { precision: 5, scale: 2 }),
  minWorkedMinutes: integer("min_worked_minutes").default(0).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  active: boolean("active").default(true).notNull(),
});

export type AllowanceRule = typeof allowanceRule.$inferSelect;
export type NewAllowanceRule = typeof allowanceRule.$inferInsert;

export const statutoryRate = pgTable("statutory_rate", {
  id: uuid("id").primaryKey().defaultRandom(),
  rateType: varchar("rate_type", { length: 16 }).notNull(),
  bandFrom: numeric("band_from", { precision: 14, scale: 2 }).default("0").notNull(),
  bandTo: numeric("band_to", { precision: 14, scale: 2 }),
  ratePercent: numeric("rate_percent", { precision: 7, scale: 4 }),
  fixedAmount: numeric("fixed_amount", { precision: 14, scale: 2 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  sourceNote: varchar("source_note", { length: 200 }),
});

export type StatutoryRate = typeof statutoryRate.$inferSelect;
export type NewStatutoryRate = typeof statutoryRate.$inferInsert;

export const payrollPeriod = pgTable("payroll_period", {
  id: uuid("id").primaryKey().defaultRandom(),
  payYear: smallint("pay_year").notNull(),
  payMonth: smallint("pay_month").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: varchar("status", { length: 10 }).default('OPEN').notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
});

export type PayrollPeriod = typeof payrollPeriod.$inferSelect;
export type NewPayrollPeriod = typeof payrollPeriod.$inferInsert;

export const payrollRun = pgTable("payroll_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  runNo: varchar("run_no", { length: 20 }).notNull(),
  payrollPeriodId: uuid("payroll_period_id").notNull(),
  runType: varchar("run_type", { length: 13 }).default('REGULAR').notNull(),
  status: varchar("status", { length: 10 }).default('DRAFT').notNull(),
  calculationVersion: integer("calculation_version").default(0).notNull(),
  runBy: text("run_by").notNull(),
  reviewedBy: text("reviewed_by"),
  approvedBy: text("approved_by"),
  staffCount: integer("staff_count").default(0).notNull(),
  totalGross: numeric("total_gross", { precision: 16, scale: 2 }).default("0").notNull(),
  totalDeductions: numeric("total_deductions", { precision: 16, scale: 2 }).default("0").notNull(),
  totalNet: numeric("total_net", { precision: 16, scale: 2 }).default("0").notNull(),
  totalEmployerCost: numeric("total_employer_cost", { precision: 16, scale: 2 }).default("0").notNull(),
  payoutBatchId: uuid("payout_batch_id"),
});

export type PayrollRun = typeof payrollRun.$inferSelect;
export type NewPayrollRun = typeof payrollRun.$inferInsert;

export const attendanceSnapshot = pgTable("attendance_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  payrollRunId: uuid("payroll_run_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  orgUnitId: uuid("org_unit_id"),
  scheduledDays: numeric("scheduled_days", { precision: 5, scale: 1 }).notNull(),
  workedDays: numeric("worked_days", { precision: 5, scale: 1 }).notNull(),
  absentDays: numeric("absent_days", { precision: 5, scale: 1 }).notNull(),
  paidLeaveDays: numeric("paid_leave_days", { precision: 5, scale: 1 }).default("0").notNull(),
  unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 5, scale: 1 }).default("0").notNull(),
  lateMinutes: integer("late_minutes").default(0).notNull(),
  overtimeMinutesApproved: integer("overtime_minutes_approved").default(0).notNull(),
  nightShifts: integer("night_shifts").default(0).notNull(),
  weekendShifts: integer("weekend_shifts").default(0).notNull(),
  holidayShifts: integer("holiday_shifts").default(0).notNull(),
});

export type AttendanceSnapshot = typeof attendanceSnapshot.$inferSelect;
export type NewAttendanceSnapshot = typeof attendanceSnapshot.$inferInsert;

export const payslip = pgTable("payslip", {
  id: uuid("id").primaryKey().defaultRandom(),
  payslipNo: varchar("payslip_no", { length: 24 }).notNull(),
  payrollRunId: uuid("payroll_run_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  status: varchar("status", { length: 8 }).default('DRAFT').notNull(),
  basicPay: numeric("basic_pay", { precision: 14, scale: 2 }).notNull(),
  grossPay: numeric("gross_pay", { precision: 14, scale: 2 }).notNull(),
  taxableIncome: numeric("taxable_income", { precision: 14, scale: 2 }).notNull(),
  paye: numeric("paye", { precision: 14, scale: 2 }).default("0").notNull(),
  ssnitEmployee: numeric("ssnit_employee", { precision: 14, scale: 2 }).default("0").notNull(),
  ssnitEmployer: numeric("ssnit_employer", { precision: 14, scale: 2 }).default("0").notNull(),
  otherDeductions: numeric("other_deductions", { precision: 14, scale: 2 }).default("0").notNull(),
  netPay: numeric("net_pay", { precision: 14, scale: 2 }).notNull(),
  payoutMethod: varchar("payout_method", { length: 6 }).notNull(),
  payoutAccountMasked: varchar("payout_account_masked", { length: 40 }),
  paymentRecipientId: uuid("payment_recipient_id"),
});

export type Payslip = typeof payslip.$inferSelect;
export type NewPayslip = typeof payslip.$inferInsert;

export const payslipLine = pgTable("payslip_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  payslipId: uuid("payslip_id").notNull(),
  payElementId: uuid("pay_element_id").notNull(),
  description: varchar("description", { length: 150 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).default("1").notNull(),
  rate: numeric("rate", { precision: 14, scale: 4 }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  lineType: varchar("line_type", { length: 12 }).notNull(),
  sourceType: varchar("source_type", { length: 12 }).notNull(),
  sourceRef: uuid("source_ref"),
});

export type PayslipLine = typeof payslipLine.$inferSelect;
export type NewPayslipLine = typeof payslipLine.$inferInsert;

export const reportDefinition = pgTable("report_definition", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 40 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  module: varchar("module", { length: 20 }).notNull(),
  description: varchar("description", { length: 500 }),
  queryRef: varchar("query_ref", { length: 80 }).notNull(),
  parametersSchema: jsonb("parameters_schema").default('{}').notNull(),
  allowedRoles: text("allowed_roles").array().notNull(),
  exportFormats: text("export_formats").array().notNull(),
  containsPersonalData: boolean("contains_personal_data").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
});

export type ReportDefinition = typeof reportDefinition.$inferSelect;
export type NewReportDefinition = typeof reportDefinition.$inferInsert;

export const reportRun = pgTable("report_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  purpose: varchar("purpose", { length: 200 }),
  params: jsonb("params").default('{}').notNull(),
  format: varchar("format", { length: 5 }).notNull(),
  status: varchar("status", { length: 8 }).default('QUEUED').notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowCount: bigint("row_count", { mode: "number" }),
  fileAttachmentId: uuid("file_attachment_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  error: varchar("error", { length: 500 }),
});

export type ReportRun = typeof reportRun.$inferSelect;
export type NewReportRun = typeof reportRun.$inferInsert;

export const kpiSnapshot = pgTable("kpi_snapshot", {
  kpiCode: varchar("kpi_code", { length: 40 }).notNull(),
  periodDate: date("period_date").notNull(),
  orgUnitId: uuid("org_unit_id"),
  value: numeric("value", { precision: 18, scale: 4 }),
  numerator: numeric("numerator", { precision: 18, scale: 4 }),
  denominator: numeric("denominator", { precision: 18, scale: 4 }),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type KpiSnapshot = typeof kpiSnapshot.$inferSelect;
export type NewKpiSnapshot = typeof kpiSnapshot.$inferInsert;

export const dhims2Mapping = pgTable("dhims2_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetCode: varchar("dataset_code", { length: 40 }).notNull(),
  dataElementCode: varchar("data_element_code", { length: 60 }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  sourceView: varchar("source_view", { length: 60 }).notNull(),
  filterExpression: varchar("filter_expression", { length: 500 }),
  disaggregation: varchar("disaggregation", { length: 40 }),
  active: boolean("active").default(true).notNull(),
});

export type Dhims2Mapping = typeof dhims2Mapping.$inferSelect;
export type NewDhims2Mapping = typeof dhims2Mapping.$inferInsert;

export const dataSubjectRequest = pgTable("data_subject_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestNo: varchar("request_no", { length: 20 }).notNull(),
  subjectType: varchar("subject_type", { length: 8 }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  requestType: varchar("request_type", { length: 14 }).notNull(),
  status: varchar("status", { length: 12 }).default('RECEIVED').notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  identityVerifiedBy: text("identity_verified_by"),
  identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
  handledBy: text("handled_by"),
  outcome: varchar("outcome", { length: 10 }),
  outcomeNote: text("outcome_note"),
  responseAttachmentId: uuid("response_attachment_id"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export type DataSubjectRequest = typeof dataSubjectRequest.$inferSelect;
export type NewDataSubjectRequest = typeof dataSubjectRequest.$inferInsert;

export const retentionPolicy = pgTable("retention_policy", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataClass: varchar("data_class", { length: 40 }).notNull(),
  retentionMonths: integer("retention_months").notNull(),
  autoDispose: boolean("auto_dispose").default(false).notNull(),
  disposalAction: varchar("disposal_action", { length: 10 }).default('ARCHIVE').notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  note: varchar("note", { length: 300 }),
});

export type RetentionPolicy = typeof retentionPolicy.$inferSelect;
export type NewRetentionPolicy = typeof retentionPolicy.$inferInsert;

export const retentionRun = pgTable("retention_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  dryRun: boolean("dry_run").default(true).notNull(),
  candidates: integer("candidates").default(0).notNull(),
  processed: integer("processed").default(0).notNull(),
  status: varchar("status", { length: 10 }).default('COMPLETED').notNull(),
  reportAttachmentId: uuid("report_attachment_id"),
  runBy: text("run_by"),
});

export type RetentionRun = typeof retentionRun.$inferSelect;
export type NewRetentionRun = typeof retentionRun.$inferInsert;
