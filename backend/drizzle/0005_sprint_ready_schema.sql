-- Consolidated sprint-ready schema migration sourced from docs

-- Source: 02-data-model.md block#1 (V2)
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE app_user_role (
  user_id    text        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role       varchar(30) NOT NULL,
  granted_by text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_role_pk PRIMARY KEY (user_id, role),
  CONSTRAINT app_user_role_ck CHECK (role IN (
    'SUPER_ADMIN','HOSPITAL_ADMIN','HR_MANAGER','PAYROLL_OFFICER','UNIT_MANAGER','ROSTER_OFFICER',
    'REGISTRAR','RECORDS_OFFICER','CASHIER','ACCOUNTS','BILLING_OFFICER',
    'DOCTOR','NURSE','PHARMACIST','PHARMACY_TECH','LAB_SCIENTIST','RADIOGRAPHER','RADIOLOGIST',
    'STORE_KEEPER','PROCUREMENT_OFFICER','REPORT_VIEWER','AUDITOR','DPO','STAFF'))
);
--> statement-breakpoint
INSERT INTO app_user_role(user_id, role)
SELECT id, CASE role WHEN 'admin' THEN 'SUPER_ADMIN' ELSE 'ACCOUNTS' END FROM "user";
--> statement-breakpoint
CREATE TABLE user_unit_scope (                   
  user_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  org_unit_id uuid NOT NULL,                     
  scope       varchar(8) NOT NULL DEFAULT 'MANAGE' CHECK (scope IN ('MANAGE','VIEW')),
  include_descendants boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, org_unit_id, scope)
);
--> statement-breakpoint

-- Source: 02-data-model.md block#2 (V2)
CREATE TABLE document_sequence (
  doc_type   varchar(20) NOT NULL,          
  period_key varchar(8)  NOT NULL,          
  last_value bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, period_key)
);
--> statement-breakpoint
CREATE FUNCTION next_doc_number(p_type text, p_period text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO document_sequence(doc_type, period_key, last_value) VALUES (p_type, p_period, 1)
  ON CONFLICT (doc_type, period_key) DO UPDATE SET last_value = document_sequence.last_value + 1
  RETURNING last_value;
$$;
--> statement-breakpoint

-- Source: 02-data-model.md block#3 (V2)
CREATE TABLE consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type varchar(8) NOT NULL CHECK (subject_type IN ('PATIENT','STAFF')),
  subject_id   uuid NOT NULL,
  consent_type varchar(30) NOT NULL CHECK (consent_type IN
    ('TREATMENT','DATA_PROCESSING','SMS_CONTACT','INSURER_SHARING','RESEARCH','PHOTOGRAPHY',
     'BIOMETRIC_ATTENDANCE','STAFF_DATA_PROCESSING')),
  status       varchar(10) NOT NULL CHECK (status IN ('GRANTED','WITHDRAWN','DECLINED')),
  policy_version varchar(20) NOT NULL,
  granted_at   timestamptz, withdrawn_at timestamptz,
  capture_method varchar(20) NOT NULL CHECK (capture_method IN ('PAPER','ELECTRONIC','VERBAL_WITNESSED')),
  captured_by  text NOT NULL,
  witness_staff_id uuid,                                 
  guardian_name varchar(150), guardian_relationship varchar(40),   
  evidence_attachment_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX consent_subject_idx ON consent(subject_type, subject_id, consent_type, status);
--> statement-breakpoint

-- Source: 02-data-model.md block#4 (V2)
CREATE TABLE audit_log (                           
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id text, actor_staff_id uuid, actor_roles text[],
  action varchar(20) NOT NULL CHECK (action IN
    ('CREATE','UPDATE','DELETE','STATUS_CHANGE','READ_RESTRICTED','BREAK_GLASS','LOGIN','LOGOUT',
     'EXPORT','PRINT','OVERRIDE','APPROVE','REJECT','DEVICE_ACTION')),
  entity_type varchar(40) NOT NULL, entity_id text,
  patient_id uuid,                                 
  org_unit_id uuid,
  request_id varchar(40), ip inet, user_agent text,
  reason text,                                     
  before jsonb, after jsonb,                       
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE INDEX audit_entity_idx  ON audit_log(entity_type, entity_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_patient_idx ON audit_log(patient_id, occurred_at DESC) WHERE patient_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX audit_actor_idx   ON audit_log(actor_user_id, occurred_at DESC);
--> statement-breakpoint
CREATE TABLE break_glass_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL, patient_id uuid NOT NULL,
  reason varchar(500) NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                 
  reviewed_by text, reviewed_at timestamptz,
  review_outcome varchar(12) CHECK (review_outcome IN ('JUSTIFIED','UNJUSTIFIED','ESCALATED'))
);
--> statement-breakpoint
CREATE TABLE attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL,
  file_name varchar(255) NOT NULL, content_type varchar(100) NOT NULL, size_bytes bigint NOT NULL,
  storage_provider varchar(12) NOT NULL DEFAULT 'CLOUDINARY' CHECK (storage_provider IN ('CLOUDINARY','S3','LOCAL')),
  storage_key text NOT NULL, public_id text,
  classification varchar(12) NOT NULL DEFAULT 'GENERAL' CHECK (classification IN ('GENERAL','CLINICAL','HR','FINANCIAL')),
  uploaded_by text NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX attachment_entity_idx ON attachment(entity_type, entity_id);
--> statement-breakpoint
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel varchar(8) NOT NULL CHECK (channel IN ('SMS','EMAIL','IN_APP')),
  recipient_type varchar(8) NOT NULL CHECK (recipient_type IN ('PATIENT','STAFF','USER','EXTERNAL')),
  recipient_id uuid, to_address varchar(255),
  template varchar(60) NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL DEFAULT 'QUEUED'
     CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED_NO_CONSENT','CANCELLED')),
  attempts int NOT NULL DEFAULT 0, last_error text,
  scheduled_for timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  related_entity_type varchar(40), related_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX notification_due_idx ON notification(scheduled_for) WHERE status = 'QUEUED';
--> statement-breakpoint
CREATE TABLE idempotency_record (                  
  idempotency_key varchar(80) NOT NULL, user_id text NOT NULL, endpoint varchar(120) NOT NULL,
  request_hash char(64) NOT NULL, response_status smallint, response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  PRIMARY KEY (idempotency_key, user_id, endpoint)
);
--> statement-breakpoint
CREATE TABLE shedlock (                            
  name varchar(64) PRIMARY KEY, lock_until timestamptz NOT NULL,
  locked_at timestamptz NOT NULL, locked_by varchar(255) NOT NULL
);
--> statement-breakpoint

-- Source: 02-data-model.md block#5 (V3)
ALTER TABLE facility_setup
  ADD COLUMN timezone varchar(60) NOT NULL DEFAULT 'UTC',          
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'GHS',
  ADD COLUMN locale varchar(10) NOT NULL DEFAULT 'en-GH',
  ADD COLUMN privacy_policy_version varchar(20),
  ADD COLUMN financial_year_start_month smallint NOT NULL DEFAULT 1 CHECK (financial_year_start_month BETWEEN 1 AND 12),
  ADD COLUMN nhia_facility_code varchar(30),
  ADD COLUMN gps_digital_address varchar(20),
  ADD COLUMN registration_number varchar(40);
--> statement-breakpoint
CREATE UNIQUE INDEX facility_setup_singleton_ux ON facility_setup ((true));
--> statement-breakpoint

-- Source: 09-module-workforce.md block#1 (V4)
CREATE TABLE org_unit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid REFERENCES org_unit(id),
  code         varchar(30)  NOT NULL UNIQUE,
  name         varchar(150) NOT NULL,
  unit_type    varchar(20)  NOT NULL
               CHECK (unit_type IN ('DIVISION','DEPARTMENT','UNIT','WARD','CLINIC','THEATRE','SERVICE_POINT')),
  is_clinical  boolean NOT NULL,
  operates_24h boolean NOT NULL DEFAULT false,  
  active       boolean NOT NULL DEFAULT true,
  head_staff_id uuid                            
);
--> statement-breakpoint
CREATE INDEX org_unit_parent_idx ON org_unit(parent_id);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#2 (V5)
CREATE TABLE shift_type (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20) NOT NULL UNIQUE,
  name           varchar(60) NOT NULL,
  category       varchar(12) NOT NULL CHECK (category IN ('STANDARD','MORNING','AFTERNOON','NIGHT')),
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  crosses_midnight boolean GENERATED ALWAYS AS (end_time <= start_time) STORED,
  break_minutes  int NOT NULL DEFAULT 0,
  early_in_minutes   int NOT NULL DEFAULT 60,   
  late_out_minutes   int NOT NULL DEFAULT 120,  
  grace_late_minutes int NOT NULL DEFAULT 15,   
  active         boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
INSERT INTO shift_type (code, name, category, start_time, end_time, break_minutes) VALUES
 ('STD',       'Standard Day', 'STANDARD',  '07:00', '16:00', 60),
 ('MORNING',   'Morning',      'MORNING',   '07:00', '14:00', 0),
 ('AFTERNOON', 'Afternoon',    'AFTERNOON', '14:00', '20:00', 0),
 ('NIGHT',     'Night',        'NIGHT',     '20:00', '07:00', 0);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#3 (V6)
ALTER TABLE staff
  ADD COLUMN staff_category varchar(12) NOT NULL DEFAULT 'NON_CLINICAL'
        CHECK (staff_category IN ('CLINICAL','NON_CLINICAL')),
  ADD COLUMN schedule_mode  varchar(16) NOT NULL DEFAULT 'FIXED_WEEKDAY'
        CHECK (schedule_mode IN ('FIXED_WEEKDAY','ROSTERED')),
  ADD COLUMN default_shift_type_id uuid REFERENCES shift_type(id),
  ADD COLUMN job_role_id      uuid,                  
  ADD COLUMN badge_number     varchar(20),           
  ADD COLUMN hire_date        date,
  ADD COLUMN termination_date date,
  ADD COLUMN user_id          text UNIQUE REFERENCES "user"(id),   
  ADD CONSTRAINT staff_nonclinical_fixed
        CHECK (staff_category = 'CLINICAL' OR schedule_mode = 'FIXED_WEEKDAY');
--> statement-breakpoint
CREATE UNIQUE INDEX staff_badge_idx ON staff(badge_number) WHERE badge_number IS NOT NULL;
--> statement-breakpoint
UPDATE staff SET default_shift_type_id = (SELECT id FROM shift_type WHERE code = 'STD');
--> statement-breakpoint
ALTER TABLE org_unit ADD CONSTRAINT org_unit_head_fk FOREIGN KEY (head_staff_id) REFERENCES staff(id);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#4 (V6)
CREATE TABLE job_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,           
  staff_category varchar(12) NOT NULL CHECK (staff_category IN ('CLINICAL','NON_CLINICAL')),
  requires_license boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
ALTER TABLE staff ADD CONSTRAINT staff_job_role_fk FOREIGN KEY (job_role_id) REFERENCES job_role(id);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#5 (V6)
CREATE TABLE staff_license (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  licensing_body varchar(10) NOT NULL CHECK (licensing_body IN ('MDC','NMC','PC','HPC','AHPC','OTHER')),  
  licence_no varchar(40) NOT NULL, issued_on date, expires_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','SUSPENDED','REVOKED')),
  attachment_id uuid, verified_by text, verified_at timestamptz,
  UNIQUE (licensing_body, licence_no)
);
--> statement-breakpoint
CREATE INDEX staff_license_expiry_ix ON staff_license(expires_on) WHERE status = 'ACTIVE';
--> statement-breakpoint

-- Source: 09-module-workforce.md block#9 (V7)
CREATE TABLE transfer_batch (                          
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(150) NOT NULL, effective_from date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','APPLIED','CANCELLED')),
  approved_by text, approved_at timestamptz
);
--> statement-breakpoint
CREATE TABLE staff_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  assignment_type varchar(10) NOT NULL CHECK (assignment_type IN ('PRIMARY','TEMPORARY','COVER')),
  effective_from date NOT NULL,
  effective_to   date,                                  
  reason varchar(30) NOT NULL DEFAULT 'INITIAL'
      CHECK (reason IN ('INITIAL','TRANSFER','RESHUFFLE','SECONDMENT','COVER','PROMOTION','RETURN')),
  note text, approved_by text, approved_at timestamptz,
  transfer_batch_id uuid REFERENCES transfer_batch(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  
  EXCLUDE USING gist (staff_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
          WHERE (assignment_type = 'PRIMARY')
);
--> statement-breakpoint
CREATE INDEX staff_assignment_unit_idx ON staff_assignment(org_unit_id, effective_from, effective_to);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#6 (V8)
CREATE TABLE roster_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','LOCKED')),
  published_by text, published_at timestamptz,
  CHECK (end_date >= start_date),
  EXCLUDE USING gist (org_unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);
--> statement-breakpoint
CREATE TABLE roster_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_period_id uuid REFERENCES roster_period(id),     
  staff_id      uuid NOT NULL REFERENCES staff(id),
  org_unit_id   uuid NOT NULL REFERENCES org_unit(id),    
  roster_date   date NOT NULL,                            
  shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  planned_start timestamptz NOT NULL,
  planned_end   timestamptz NOT NULL,
  source varchar(12) NOT NULL CHECK (source IN ('AUTO_FIXED','MANUAL','TEMPLATE','SWAP','COVER')),
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  version int NOT NULL DEFAULT 0,
  UNIQUE (staff_id, roster_date, shift_type_id),
  
  EXCLUDE USING gist (staff_id WITH =, tstzrange(planned_start, planned_end) WITH &&)
          WHERE (status = 'ACTIVE')
);
--> statement-breakpoint
CREATE INDEX roster_entry_unit_date_idx ON roster_entry(org_unit_id, roster_date);
--> statement-breakpoint
CREATE INDEX roster_entry_staff_window  ON roster_entry(staff_id, planned_start, planned_end);
--> statement-breakpoint
CREATE TABLE unit_staffing_requirement (          
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id   uuid NOT NULL REFERENCES org_unit(id),
  shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  job_role_id   uuid REFERENCES job_role(id),
  min_staff int NOT NULL CHECK (min_staff >= 0),
  UNIQUE NULLS NOT DISTINCT (org_unit_id, shift_type_id, job_role_id)   
);
--> statement-breakpoint
CREATE TABLE shift_swap_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_entry_id    uuid NOT NULL REFERENCES roster_entry(id),
  counterparty_entry_id uuid REFERENCES roster_entry(id),
  status varchar(12) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','ACCEPTED','APPROVED','REJECTED','CANCELLED')),
  reason text, decided_by text, decided_at timestamptz
);
--> statement-breakpoint
CREATE TABLE public_holiday (
  holiday_date date PRIMARY KEY,
  name varchar(100) NOT NULL
);
--> statement-breakpoint

-- Source: 09-module-workforce.md block#7 (V9)
CREATE TABLE staff_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  credential_type varchar(12) NOT NULL CHECK (credential_type IN ('FINGERPRINT','CARD_QR','CARD_BARCODE')),
  credential_ref  varchar(120) NOT NULL,   
  card_version int NOT NULL DEFAULT 1,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','LOST','EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz, revoked_at timestamptz, revoked_reason text
);
--> statement-breakpoint
CREATE UNIQUE INDEX staff_credential_active_uq
  ON staff_credential(credential_type, credential_ref) WHERE status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE attendance_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  device_type varchar(24) NOT NULL
     CHECK (device_type IN ('FINGERPRINT_TERMINAL','QR_SCANNER','BARCODE_SCANNER','KIOSK')),
  vendor varchar(50), model varchar(50), serial_number varchar(80),
  org_unit_id uuid REFERENCES org_unit(id),           
  api_key_hash varchar(100) NOT NULL,                 
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  last_seen_at timestamptz, last_clock_skew_seconds int
);
--> statement-breakpoint
CREATE TABLE punch_log (                               
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES attendance_device(id),
  device_event_id varchar(80) NOT NULL,                
  credential_type varchar(12) NOT NULL,
  credential_ref  varchar(120) NOT NULL,
  staff_id uuid REFERENCES staff(id),                  
  punched_at  timestamptz NOT NULL,                    
  received_at timestamptz NOT NULL DEFAULT now(),
  direction_hint varchar(6) NOT NULL DEFAULT 'AUTO' CHECK (direction_hint IN ('IN','OUT','AUTO')),
  verify_mode varchar(20), raw_payload jsonb,
  result varchar(32) NOT NULL DEFAULT 'RECEIVED',
  processed boolean NOT NULL DEFAULT false,
  UNIQUE (device_id, device_event_id)
);
--> statement-breakpoint
CREATE INDEX punch_log_staff_time_idx ON punch_log(staff_id, punched_at);
--> statement-breakpoint
CREATE INDEX punch_log_unprocessed_idx ON punch_log(received_at) WHERE processed = false;
--> statement-breakpoint
CREATE TABLE attendance_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  roster_entry_id uuid REFERENCES roster_entry(id),    
  attendance_date date NOT NULL,                       
  org_unit_id uuid REFERENCES org_unit(id),
  shift_type_id uuid REFERENCES shift_type(id),
  clock_in_at  timestamptz NOT NULL,
  clock_in_punch_id uuid NOT NULL REFERENCES punch_log(id),
  clock_out_at timestamptz,
  clock_out_punch_id uuid REFERENCES punch_log(id),
  status varchar(12) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','CLOSED','AUTO_CLOSED','CORRECTED')),
  worked_minutes int, late_minutes int NOT NULL DEFAULT 0,
  early_leave_minutes int NOT NULL DEFAULT 0, overtime_minutes int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 0,
  CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_one_open_per_staff ON attendance_record(staff_id) WHERE status = 'OPEN';
--> statement-breakpoint
CREATE UNIQUE INDEX attendance_one_per_roster_entry ON attendance_record(roster_entry_id) WHERE roster_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX attendance_date_idx ON attendance_record(attendance_date, org_unit_id);
--> statement-breakpoint
CREATE TABLE attendance_exception (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  attendance_record_id uuid REFERENCES attendance_record(id),
  roster_entry_id uuid REFERENCES roster_entry(id),
  exception_date date NOT NULL,
  exception_type varchar(24) NOT NULL CHECK (exception_type IN
     ('LATE','EARLY_LEAVE','MISSING_CLOCK_OUT','ABSENT','UNROSTERED_PUNCH','DEVICE_CLOCK_SKEW','UNKNOWN_CREDENTIAL')),
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','EXCUSED','CONFIRMED','CORRECTED')),
  resolved_by text, resolved_at timestamptz, note text
);
--> statement-breakpoint
CREATE TABLE attendance_correction (                   
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES attendance_record(id),
  old_clock_in timestamptz, old_clock_out timestamptz,
  new_clock_in timestamptz, new_clock_out timestamptz,
  reason text NOT NULL, requested_by text NOT NULL, approved_by text, approved_at timestamptz
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#1 (V10)
CREATE FUNCTION immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
--> statement-breakpoint
CREATE TABLE patient (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn varchar(20) NOT NULL,
  first_name varchar(100) NOT NULL, middle_name varchar(100), last_name varchar(100) NOT NULL,
  preferred_name varchar(100),
  sex varchar(10) NOT NULL CHECK (sex IN ('MALE','FEMALE','INTERSEX','UNKNOWN')),
  date_of_birth date, dob_estimated boolean NOT NULL DEFAULT false, estimated_age_years smallint,
  marital_status varchar(15) CHECK (marital_status IN ('SINGLE','MARRIED','DIVORCED','WIDOWED','SEPARATED','OTHER')),
  nationality varchar(60) DEFAULT 'Ghanaian', religion varchar(40), occupation varchar(100),
  blood_group varchar(4) CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  phone varchar(25), phone_e164 varchar(16), alt_phone varchar(25), email varchar(255),
  address_line varchar(200), town varchar(100), district varchar(100), region varchar(60),
  digital_address varchar(20),                           
  photo_url varchar(255), photo_public_id varchar(255),
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','DECEASED','MERGED')),
  merged_into_id uuid REFERENCES patient(id),
  deceased_at timestamptz,
  confidentiality varchar(10) NOT NULL DEFAULT 'NORMAL' CHECK (confidentiality IN ('NORMAL','RESTRICTED','VIP')),
  is_unidentified boolean NOT NULL DEFAULT false,        
  registered_at timestamptz NOT NULL DEFAULT now(), registered_unit_id uuid REFERENCES org_unit(id),
  name_key text GENERATED ALWAYS AS (
     immutable_unaccent(lower(last_name || ' ' || first_name || ' ' || coalesce(middle_name,'')))) STORED,
  surname_phonetic text GENERATED ALWAYS AS (dmetaphone(last_name)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text, updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text, version int NOT NULL DEFAULT 0,
  CONSTRAINT patient_mrn_uq UNIQUE (mrn),
  CONSTRAINT patient_age_ck CHECK (date_of_birth IS NOT NULL OR estimated_age_years IS NOT NULL),
  CONSTRAINT patient_merge_ck CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX patient_name_trgm_ix ON patient USING gin (name_key gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX patient_phone_ix     ON patient(phone_e164);
--> statement-breakpoint
CREATE INDEX patient_dob_ix       ON patient(date_of_birth);
--> statement-breakpoint
CREATE INDEX patient_phonetic_ix  ON patient(surname_phonetic, date_of_birth);
--> statement-breakpoint
CREATE TABLE patient_identifier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  id_type varchar(20) NOT NULL CHECK (id_type IN
    ('NHIS','GHANA_CARD','PASSPORT','DRIVERS_LICENCE','VOTER_ID','SSNIT','STAFF_ID','EXTERNAL_MRN')),
  id_value varchar(60) NOT NULL, issuer varchar(100), valid_to date,
  verified boolean NOT NULL DEFAULT false, verified_at timestamptz, verified_by text,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX patient_identifier_active_uq ON patient_identifier(id_type, id_value) WHERE status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE patient_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  contact_type varchar(15) NOT NULL CHECK (contact_type IN ('NEXT_OF_KIN','EMERGENCY','GUARDIAN','EMPLOYER')),
  name varchar(150) NOT NULL, relationship varchar(40), phone varchar(25), address varchar(255),
  is_primary boolean NOT NULL DEFAULT false, can_consent boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE patient_allergy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  category varchar(8) NOT NULL CHECK (category IN ('DRUG','FOOD','LATEX','ENVIRON','OTHER')),
  substance varchar(150) NOT NULL, drug_id uuid,                
  reaction varchar(200), severity varchar(18) CHECK (severity IN ('MILD','MODERATE','SEVERE','LIFE_THREATENING')),
  status varchar(18) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED','ENTERED_IN_ERROR')),
  noted_on date, recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX patient_allergy_patient_ix ON patient_allergy(patient_id) WHERE status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE patient_condition (                                  
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  icd10_code varchar(10), description varchar(200) NOT NULL, onset_date date,
  is_chronic boolean NOT NULL DEFAULT false,
  status varchar(18) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED','ENTERED_IN_ERROR')),
  recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE patient_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id uuid NOT NULL REFERENCES patient(id), merged_id uuid NOT NULL REFERENCES patient(id),
  merged_by text NOT NULL, merged_at timestamptz NOT NULL DEFAULT now(),
  reason varchar(500) NOT NULL, snapshot jsonb NOT NULL,           
  CONSTRAINT patient_merge_distinct_ck CHECK (survivor_id <> merged_id)
);
--> statement-breakpoint
CREATE TABLE patient_duplicate_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_a_id uuid NOT NULL REFERENCES patient(id), patient_b_id uuid NOT NULL REFERENCES patient(id),
  score numeric(4,3) NOT NULL, reasons text[] NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DISMISSED','MERGED')),
  reviewed_by text, reviewed_at timestamptz,
  CONSTRAINT patient_dup_pair_uq UNIQUE (patient_a_id, patient_b_id),
  CONSTRAINT patient_dup_order_ck CHECK (patient_a_id < patient_b_id)
);
--> statement-breakpoint
CREATE TABLE patient_merge_task (                         
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_log_id uuid NOT NULL REFERENCES patient_merge_log(id), module varchar(30) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED','MANUAL_REVIEW')),
  rows_moved int, last_error varchar(500), completed_at timestamptz,
  UNIQUE (merge_log_id, module)
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#3 (V12)
CREATE TABLE service_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE, name varchar(200) NOT NULL,
  category varchar(15) NOT NULL CHECK (category IN
    ('REGISTRATION','CONSULTATION','PROCEDURE','LAB','IMAGING','DRUG','CONSUMABLE','BED_DAY','NURSING','OTHER')),
  default_org_unit_id uuid REFERENCES org_unit(id),
  inventory_item_id uuid,                              
  nhis_tariff_code varchar(30), gdrg_code varchar(15), 
  is_billable boolean NOT NULL DEFAULT true, allow_discount boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  payer_type varchar(12) NOT NULL CHECK (payer_type IN ('CASH','NHIS','PRIVATE','CORPORATE','STAFF','EXEMPT')),
  payer_id uuid, currency char(3) NOT NULL DEFAULT 'GHS',
  is_default boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE price_list_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES price_list(id), service_item_id uuid NOT NULL REFERENCES service_item(id),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  effective_from date NOT NULL, effective_to date,
  CONSTRAINT price_list_item_period_ck CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT price_list_item_overlap_ex EXCLUDE USING gist
    (price_list_id WITH =, service_item_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);
--> statement-breakpoint
CREATE TABLE clinic_session_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),             
  provider_staff_id uuid REFERENCES staff(id),                   
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),     
  start_time time NOT NULL, end_time time NOT NULL CHECK (end_time > start_time),
  slot_minutes smallint NOT NULL CHECK (slot_minutes BETWEEN 5 AND 120),
  capacity_per_slot smallint NOT NULL DEFAULT 1, overbook_limit smallint NOT NULL DEFAULT 0,
  consultation_service_id uuid REFERENCES service_item(id),
  valid_from date NOT NULL, valid_to date, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE appointment_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES clinic_session_template(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  provider_staff_id uuid REFERENCES staff(id), roster_entry_id uuid REFERENCES roster_entry(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  capacity smallint NOT NULL, booked_count smallint NOT NULL DEFAULT 0,
  status varchar(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','BLOCKED')),
  CONSTRAINT appointment_slot_booked_ck CHECK (booked_count >= 0),
  CONSTRAINT appointment_slot_uq UNIQUE NULLS NOT DISTINCT (org_unit_id, provider_staff_id, starts_at)
);
--> statement-breakpoint
CREATE INDEX appointment_slot_open_ix ON appointment_slot(org_unit_id, starts_at) WHERE status = 'OPEN';
--> statement-breakpoint
CREATE TABLE appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  slot_id uuid REFERENCES appointment_slot(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  provider_staff_id uuid REFERENCES staff(id),
  appointment_type varchar(10) NOT NULL CHECK (appointment_type IN ('NEW','FOLLOW_UP','REVIEW','PROCEDURE','WALK_IN')),
  scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'BOOKED' CHECK (status IN
    ('BOOKED','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED')),
  reason varchar(300), booked_via varchar(12) NOT NULL DEFAULT 'FRONT_DESK'
    CHECK (booked_via IN ('FRONT_DESK','PHONE','ONLINE','REFERRAL','CLINIC')),
  booked_by text NOT NULL, cancelled_reason varchar(300), rescheduled_from_id uuid REFERENCES appointment(id),
  reminder_sent_at timestamptz, checked_in_at timestamptz, visit_id uuid,        
  CONSTRAINT appointment_patient_overlap_ex EXCLUDE USING gist
    (patient_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&)
    WHERE (status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_PROGRESS'))
);
--> statement-breakpoint
CREATE TABLE visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_no varchar(20) NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patient(id),
  visit_type varchar(10) NOT NULL CHECK (visit_type IN ('OPD','EMERGENCY','INPATIENT','DAY_CASE','OUTREACH')),
  visit_date date NOT NULL,
  payer_type varchar(12) NOT NULL DEFAULT 'CASH' CHECK (payer_type IN ('CASH','NHIS','PRIVATE','CORPORATE','STAFF','EXEMPT')),
  patient_insurance_id uuid,                                       
  exempt_reason varchar(100),
  registration_unit_id uuid REFERENCES org_unit(id), current_unit_id uuid REFERENCES org_unit(id),
  appointment_id uuid REFERENCES appointment(id), referral_id uuid,
  is_new_attendance boolean NOT NULL DEFAULT false,                
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ADMITTED','CANCELLED')),
  disposition varchar(20)
);
--> statement-breakpoint
ALTER TABLE appointment ADD CONSTRAINT appointment_visit_fk FOREIGN KEY (visit_id) REFERENCES visit(id);
--> statement-breakpoint
CREATE UNIQUE INDEX visit_one_open_opd_ux ON visit(patient_id, visit_date)
  WHERE visit_type = 'OPD' AND status = 'OPEN';
--> statement-breakpoint
CREATE TABLE queue_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id), org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  stage varchar(12) NOT NULL CHECK (stage IN ('CASHIER','TRIAGE','CONSULTATION','LAB','IMAGING','PHARMACY')),
  ticket_no varchar(10) NOT NULL, priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4), 
  status varchar(8) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','CALLED','SERVING','DONE','SKIPPED')),
  issued_at timestamptz NOT NULL DEFAULT now(), called_at timestamptz, started_at timestamptz, completed_at timestamptz,
  counter varchar(20), called_by text, recall_count smallint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX queue_ticket_waiting_ix ON queue_ticket(org_unit_id, stage, priority, issued_at) WHERE status IN ('WAITING','CALLED');
--> statement-breakpoint
CREATE TABLE triage_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id), assessed_by_staff_id uuid NOT NULL REFERENCES staff(id),
  assessed_at timestamptz NOT NULL DEFAULT now(),
  triage_category varchar(8) NOT NULL CHECK (triage_category IN ('RED','ORANGE','YELLOW','GREEN','BLUE')),
  chief_complaint varchar(300) NOT NULL, vital_sign_id uuid,                
  isolation_required boolean NOT NULL DEFAULT false, pregnant boolean, mobility varchar(15),
  notes text
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#5 (V14)
CREATE TABLE icd10_code (
  code varchar(10) PRIMARY KEY, title varchar(300) NOT NULL, chapter varchar(10), block varchar(20),
  is_notifiable boolean NOT NULL DEFAULT false, sex_restriction varchar(6) CHECK (sex_restriction IN ('MALE','FEMALE')),
  active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE encounter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id), patient_id uuid NOT NULL REFERENCES patient(id),
  encounter_type varchar(15) NOT NULL CHECK (encounter_type IN
    ('TRIAGE','CONSULTATION','PROCEDURE','REVIEW','ED_CONSULT','WARD_ROUND','ANTENATAL','NURSING')),
  provider_staff_id uuid NOT NULL REFERENCES staff(id), org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SIGNED','ENTERED_IN_ERROR')),
  chief_complaint varchar(300),
  disposition varchar(20) CHECK (disposition IN
    ('DISCHARGED_HOME','ADMITTED','REFERRED_OUT','OBSERVATION','FOLLOW_UP','LAMA','DIED','LEFT_WITHOUT_BEING_SEEN')),
  follow_up_date date, signed_at timestamptz, signed_by_staff_id uuid REFERENCES staff(id),
  CONSTRAINT encounter_sign_ck CHECK ((status = 'SIGNED') = (signed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX encounter_patient_ix ON encounter(patient_id, started_at DESC);
--> statement-breakpoint
CREATE TABLE clinical_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter(id), patient_id uuid NOT NULL REFERENCES patient(id),
  note_type varchar(15) NOT NULL CHECK (note_type IN
    ('HISTORY','EXAMINATION','SOAP','PROGRESS','PROCEDURE','CONSULT_RESPONSE','DISCHARGE','ADDENDUM')),
  body text NOT NULL, sensitivity varchar(10) NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL','SENSITIVE')),
  version int NOT NULL DEFAULT 1, amends_id uuid REFERENCES clinical_note(id),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SIGNED','ENTERED_IN_ERROR')),
  authored_by_staff_id uuid NOT NULL REFERENCES staff(id), authored_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz, signer_licence_no varchar(40)                    
);
--> statement-breakpoint
CREATE TABLE vital_sign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid REFERENCES visit(id),
  encounter_id uuid REFERENCES encounter(id), admission_id uuid,            
  recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by_staff_id uuid NOT NULL REFERENCES staff(id),
  temperature_c numeric(4,1) CHECK (temperature_c BETWEEN 25 AND 45),
  pulse_bpm smallint CHECK (pulse_bpm BETWEEN 0 AND 300),
  resp_rate smallint CHECK (resp_rate BETWEEN 0 AND 100),
  systolic smallint CHECK (systolic BETWEEN 0 AND 300), diastolic smallint CHECK (diastolic BETWEEN 0 AND 200),
  spo2 smallint CHECK (spo2 BETWEEN 0 AND 100),
  weight_kg numeric(5,1), height_cm numeric(5,1),
  bmi numeric(4,1) GENERATED ALWAYS AS (CASE WHEN height_cm > 0 AND weight_kg > 0
        THEN round((weight_kg / ((height_cm/100)*(height_cm/100)))::numeric, 1) END) STORED,
  pain_score smallint CHECK (pain_score BETWEEN 0 AND 10),
  blood_glucose_mmol numeric(4,1), gcs smallint CHECK (gcs BETWEEN 3 AND 15),
  avpu varchar(1) CHECK (avpu IN ('A','V','P','U')), muac_cm numeric(4,1),
  ews_score smallint, ews_band varchar(8) CHECK (ews_band IN ('LOW','MEDIUM','HIGH')),
  source varchar(8) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','DEVICE'))
);
--> statement-breakpoint
CREATE INDEX vital_sign_patient_ix ON vital_sign(patient_id, recorded_at DESC);
--> statement-breakpoint
ALTER TABLE triage_assessment ADD CONSTRAINT triage_vital_fk FOREIGN KEY (vital_sign_id) REFERENCES vital_sign(id);
--> statement-breakpoint
CREATE TABLE diagnosis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter(id), patient_id uuid NOT NULL REFERENCES patient(id),
  icd10_code varchar(10) NOT NULL REFERENCES icd10_code(code), description varchar(300) NOT NULL,   
  diagnosis_type varchar(12) NOT NULL CHECK (diagnosis_type IN ('PRIMARY','SECONDARY','DIFFERENTIAL')),
  certainty varchar(12) NOT NULL DEFAULT 'PROVISIONAL' CHECK (certainty IN ('PROVISIONAL','CONFIRMED','RULED_OUT')),
  is_new_case boolean NOT NULL DEFAULT true, onset_date date,                
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENTERED_IN_ERROR')),
  noted_by_staff_id uuid NOT NULL REFERENCES staff(id), noted_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX diagnosis_one_primary_ux ON diagnosis(encounter_id)
  WHERE diagnosis_type = 'PRIMARY' AND status = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE clinical_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(20) NOT NULL UNIQUE,
  encounter_id uuid NOT NULL REFERENCES encounter(id), patient_id uuid NOT NULL REFERENCES patient(id),
  visit_id uuid NOT NULL REFERENCES visit(id), admission_id uuid,
  order_type varchar(12) NOT NULL CHECK (order_type IN
    ('LAB','IMAGING','MEDICATION','PROCEDURE','REFERRAL','NURSING','CONSULT_REQUEST','DIET')),
  priority varchar(7) NOT NULL DEFAULT 'ROUTINE' CHECK (priority IN ('ROUTINE','URGENT','STAT')),
  status varchar(12) NOT NULL DEFAULT 'ORDERED' CHECK (status IN
    ('DRAFT','ORDERED','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED')),
  service_item_id uuid REFERENCES service_item(id), quantity numeric(10,3) NOT NULL DEFAULT 1,
  clinical_indication varchar(500), notes text,
  payment_required boolean NOT NULL DEFAULT false, payment_cleared_at timestamptz,     
  ordered_by_staff_id uuid NOT NULL REFERENCES staff(id), ordered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by text, cancelled_reason varchar(300)
);
--> statement-breakpoint
CREATE INDEX clinical_order_open_ix ON clinical_order(order_type, priority, ordered_at)
  WHERE status IN ('ORDERED','IN_PROGRESS');
--> statement-breakpoint
CREATE TABLE referral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid REFERENCES visit(id),
  direction varchar(3) NOT NULL CHECK (direction IN ('IN','OUT')),
  facility_name varchar(200), to_unit_id uuid REFERENCES org_unit(id), specialty varchar(100),
  urgency varchar(9) NOT NULL DEFAULT 'ROUTINE' CHECK (urgency IN ('ROUTINE','URGENT','EMERGENCY')),
  reason varchar(500) NOT NULL, summary_attachment_id uuid,
  status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','SENT','ACCEPTED','COMPLETED','CANCELLED')),
  created_by_staff_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE visit ADD CONSTRAINT visit_referral_fk FOREIGN KEY (referral_id) REFERENCES referral(id);
--> statement-breakpoint
CREATE TABLE medical_certificate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_no varchar(20) NOT NULL UNIQUE, verification_code varchar(12) NOT NULL,
  patient_id uuid NOT NULL REFERENCES patient(id), encounter_id uuid NOT NULL REFERENCES encounter(id),
  cert_type varchar(12) NOT NULL CHECK (cert_type IN ('SICK_LEAVE','FITNESS','ATTENDANCE','MATERNITY')),
  from_date date NOT NULL, to_date date, remarks varchar(500),
  issued_by_staff_id uuid NOT NULL REFERENCES staff(id), issued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Source: 11-module-supply-and-revenue.md block#2 (V15)
CREATE TABLE drug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name varchar(200) NOT NULL, brand_name varchar(200),
  form varchar(15) NOT NULL CHECK (form IN
    ('TABLET','CAPSULE','SYRUP','SUSPENSION','INJECTION','IV_FLUID','CREAM','OINTMENT','DROPS','INHALER','SUPPOSITORY','OTHER')),
  strength_value numeric(12,4), strength_unit varchar(15), strength_text varchar(60),
  default_route varchar(15), atc_code varchar(10),
  inventory_item_id uuid,                                              
  nhis_listed boolean NOT NULL DEFAULT false, essential_list boolean NOT NULL DEFAULT false,
  controlled_class varchar(10) NOT NULL DEFAULT 'NONE' CHECK (controlled_class IN ('NONE','SCHEDULE_2','SCHEDULE_3','SCHEDULE_4')),
  is_high_alert boolean NOT NULL DEFAULT false, is_antibiotic boolean NOT NULL DEFAULT false,
  otc_allowed boolean NOT NULL DEFAULT false, max_daily_dose numeric(12,3), dose_unit varchar(15),
  pregnancy_category varchar(2), active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE INDEX drug_name_trgm_ix ON drug USING gin ((lower(generic_name || ' ' || coalesce(brand_name,''))) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE patient_allergy ADD CONSTRAINT patient_allergy_drug_fk FOREIGN KEY (drug_id) REFERENCES drug(id);
--> statement-breakpoint
CREATE TABLE drug_interaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_a varchar(200) NOT NULL, generic_b varchar(200) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('MINOR','MODERATE','MAJOR','CONTRAINDICATED')),
  effect varchar(500), management varchar(500), source varchar(100),
  CONSTRAINT drug_interaction_order_ck CHECK (generic_a < generic_b), UNIQUE (generic_a, generic_b)
);
--> statement-breakpoint
CREATE TABLE prescription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rx_no varchar(20) NOT NULL UNIQUE,
  order_id uuid UNIQUE REFERENCES clinical_order(id),
  encounter_id uuid NOT NULL REFERENCES encounter(id), patient_id uuid NOT NULL REFERENCES patient(id),
  visit_id uuid NOT NULL REFERENCES visit(id), admission_id uuid,                 
  prescriber_staff_id uuid NOT NULL REFERENCES staff(id), prescriber_licence_no varchar(40),   
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','ISSUED','PARTIALLY_DISPENSED','DISPENSED','CANCELLED','EXPIRED')),
  issued_at timestamptz, valid_until date, notes varchar(500)
);
--> statement-breakpoint
CREATE INDEX prescription_queue_ix ON prescription(issued_at) WHERE status IN ('ISSUED','PARTIALLY_DISPENSED');
--> statement-breakpoint
CREATE TABLE prescription_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES prescription(id) ON DELETE CASCADE, drug_id uuid NOT NULL REFERENCES drug(id),
  dose numeric(10,3) NOT NULL, dose_unit varchar(15) NOT NULL,
  frequency_code varchar(8) NOT NULL CHECK (frequency_code IN
    ('OD','BD','TDS','QID','Q4H','Q6H','Q8H','Q12H','NOCTE','STAT','PRN','WEEKLY')),
  route varchar(15) NOT NULL, duration_days smallint, quantity_prescribed numeric(12,3) NOT NULL CHECK (quantity_prescribed > 0),
  quantity_dispensed numeric(12,3) NOT NULL DEFAULT 0, is_prn boolean NOT NULL DEFAULT false, prn_reason varchar(200),
  instructions varchar(300), indication varchar(200), substitution_allowed boolean NOT NULL DEFAULT true,
  start_at timestamptz, stop_at timestamptz,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','STOPPED','CANCELLED')),
  stopped_reason varchar(200), alert_override_reason varchar(300),
  CONSTRAINT rx_item_qty_ck CHECK (quantity_dispensed <= quantity_prescribed)
);
--> statement-breakpoint

-- Source: 11-module-supply-and-revenue.md block#4 (V16)
CREATE TABLE bill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no varchar(20) NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patient(id),
  visit_id uuid REFERENCES visit(id), admission_id uuid,                          
  payer_type varchar(12) NOT NULL CHECK (payer_type IN ('CASH','NHIS','PRIVATE','CORPORATE','STAFF','EXEMPT')),
  patient_insurance_id uuid, price_list_id uuid NOT NULL REFERENCES price_list(id),
  currency char(3) NOT NULL DEFAULT 'GHS',
  status varchar(15) NOT NULL DEFAULT 'OPEN' CHECK (status IN
    ('OPEN','FINALISED','PARTIALLY_PAID','PAID','CANCELLED','WRITTEN_OFF')),
  gross_amount numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  waiver_amount numeric(14,2) NOT NULL DEFAULT 0,
  insurer_amount numeric(14,2) NOT NULL DEFAULT 0, insurer_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  patient_amount numeric(14,2) NOT NULL DEFAULT 0,       
  paid_amount numeric(14,2) NOT NULL DEFAULT 0, deposit_applied numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) GENERATED ALWAYS AS (patient_amount - paid_amount - deposit_applied) STORED,
  finalised_at timestamptz, finalised_by text, version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  CONSTRAINT bill_amounts_ck CHECK (gross_amount >= 0 AND patient_amount >= 0 AND paid_amount >= 0)
);
--> statement-breakpoint
CREATE INDEX bill_patient_ix ON bill(patient_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX bill_outstanding_ix ON bill(status) WHERE status IN ('FINALISED','PARTIALLY_PAID');
--> statement-breakpoint
CREATE TABLE bill_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  line_no int NOT NULL, service_item_id uuid NOT NULL REFERENCES service_item(id), description varchar(300) NOT NULL,
  source_type varchar(10) NOT NULL CHECK (source_type IN ('VISIT','ORDER','DISPENSE','BED_DAY','PROCEDURE','MANUAL')),
  source_id uuid, quantity numeric(10,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL, gross_amount numeric(14,2) NOT NULL,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0, covered_amount numeric(14,2) NOT NULL DEFAULT 0,   
  patient_amount numeric(14,2) NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'BILLED' CHECK (status IN ('PENDING','BILLED','VOIDED')),
  price_flag varchar(14) CHECK (price_flag IN ('PRICE_MISSING','PRICE_OVERRIDDEN')),
  service_date date NOT NULL, performed_unit_id uuid REFERENCES org_unit(id),
  voided_by text, voided_reason varchar(300),
  UNIQUE (bill_id, line_no)
);
--> statement-breakpoint
CREATE UNIQUE INDEX bill_line_source_ux ON bill_line(source_type, source_id)
  WHERE source_id IS NOT NULL AND status <> 'VOIDED';
--> statement-breakpoint
CREATE TABLE cashier_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_user_id text NOT NULL, till_code varchar(20) NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(), opening_float numeric(14,2) NOT NULL DEFAULT 0,
  closed_at timestamptz, expected_cash numeric(14,2), counted_cash numeric(14,2),
  variance numeric(14,2) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','RECONCILED')),
  reconciled_by text, reconciled_at timestamptz, note varchar(300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX cashier_session_one_open_ux ON cashier_session(cashier_user_id) WHERE status = 'OPEN';
--> statement-breakpoint
CREATE TABLE patient_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key varchar(60) NOT NULL UNIQUE,
  bill_id uuid NOT NULL REFERENCES bill(id), patient_id uuid NOT NULL REFERENCES patient(id),
  method varchar(14) NOT NULL CHECK (method IN ('CASH','MOMO','CARD','BANK_TRANSFER','CHEQUE','DEPOSIT')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0), currency char(3) NOT NULL DEFAULT 'GHS',
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED','REVERSED')),
  tendered numeric(14,2), change_given numeric(14,2),
  momo_reference_id varchar(100), momo_phone varchar(20), provider_status varchar(20), provider_checked_at timestamptz,
  cashier_session_id uuid REFERENCES cashier_session(id),
  received_by text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  reversal_of_id uuid REFERENCES patient_payment(id), reversal_reason varchar(300),
  CONSTRAINT payment_cash_session_ck CHECK (method <> 'CASH' OR cashier_session_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE cashier_ledger (                                                  
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cashier_session_id uuid NOT NULL REFERENCES cashier_session(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entry_type varchar(14) NOT NULL CHECK (entry_type IN ('PAYMENT_IN','REFUND_OUT','FLOAT_IN','SAFE_DROP','REVERSAL','VARIANCE_ADJ')),
  method varchar(14) NOT NULL, amount numeric(14,2) NOT NULL, ref_type varchar(20), ref_id uuid, created_by text NOT NULL
);
--> statement-breakpoint
CREATE TABLE receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_no varchar(20) NOT NULL UNIQUE,
  patient_payment_id uuid NOT NULL UNIQUE REFERENCES patient_payment(id), bill_id uuid NOT NULL REFERENCES bill(id),
  issued_at timestamptz NOT NULL DEFAULT now(), printed_count smallint NOT NULL DEFAULT 0,
  voided boolean NOT NULL DEFAULT false, pdf_attachment_id uuid
);
--> statement-breakpoint
CREATE TABLE patient_deposit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  admission_id uuid, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance numeric(14,2) NOT NULL CHECK (balance >= 0), received_payment_id uuid REFERENCES patient_payment(id),
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','APPLIED','REFUNDED'))
);
--> statement-breakpoint
CREATE TABLE refund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_payment_id uuid REFERENCES patient_payment(id),
  deposit_id uuid REFERENCES patient_deposit(id), bill_id uuid REFERENCES bill(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0), reason varchar(300) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','PAID','REJECTED')),
  requested_by text NOT NULL, approved_by text, paid_via varchar(14), cashier_session_id uuid REFERENCES cashier_session(id),
  CONSTRAINT refund_four_eyes_ck CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
--> statement-breakpoint
CREATE TABLE waiver_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid NOT NULL REFERENCES bill(id), bill_line_id uuid REFERENCES bill_line(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason_code varchar(14) NOT NULL CHECK (reason_code IN ('INDIGENT','EMERGENCY','STAFF','CHARITY','ADMIN_ERROR','OTHER')),
  note varchar(500), evidence_attachment_id uuid,
  status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
  requested_by text NOT NULL, decided_by text, decided_at timestamptz,
  CONSTRAINT waiver_four_eyes_ck CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
--> statement-breakpoint
CREATE TABLE credit_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credit_note_no varchar(20) NOT NULL UNIQUE,
  bill_id uuid NOT NULL REFERENCES bill(id), amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason varchar(300) NOT NULL, issued_by text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#8 (V17)
CREATE TABLE lab_test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE, name varchar(150) NOT NULL, loinc_code varchar(15),
  department varchar(15) NOT NULL CHECK (department IN
    ('HAEMATOLOGY','CHEMISTRY','MICROBIOLOGY','SEROLOGY','PARASITOLOGY','URINALYSIS','HISTOLOGY','BLOOD_BANK','OTHER')),
  specimen_type varchar(20) NOT NULL, container varchar(30), min_volume_ml numeric(5,1),
  result_type varchar(8) NOT NULL CHECK (result_type IN ('NUMERIC','TEXT','CODED','PANEL')),
  unit varchar(20), decimals smallint DEFAULT 1,
  tat_routine_minutes int NOT NULL DEFAULT 240, tat_stat_minutes int NOT NULL DEFAULT 60,
  requires_fasting boolean NOT NULL DEFAULT false, collection_instructions varchar(300),
  service_item_id uuid REFERENCES service_item(id), active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE lab_panel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(150) NOT NULL,
  service_item_id uuid REFERENCES service_item(id), active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE lab_panel_item (
  panel_id uuid NOT NULL REFERENCES lab_panel(id) ON DELETE CASCADE, test_id uuid NOT NULL REFERENCES lab_test(id),
  sort_order smallint NOT NULL DEFAULT 0, PRIMARY KEY (panel_id, test_id)
);
--> statement-breakpoint
CREATE TABLE lab_reference_range (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_id uuid NOT NULL REFERENCES lab_test(id),
  sex varchar(6) NOT NULL DEFAULT 'ANY' CHECK (sex IN ('ANY','MALE','FEMALE')),
  age_min_days int NOT NULL DEFAULT 0, age_max_days int NOT NULL DEFAULT 43800,
  low numeric(12,4), high numeric(12,4), critical_low numeric(12,4), critical_high numeric(12,4),
  unit varchar(20), range_text varchar(100),
  CONSTRAINT lab_ref_age_ck CHECK (age_max_days > age_min_days),
  CONSTRAINT lab_ref_overlap_ex EXCLUDE USING gist
    (test_id WITH =, sex WITH =, int4range(age_min_days, age_max_days, '[)') WITH &&)
);
--> statement-breakpoint
CREATE TABLE lab_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES clinical_order(id),
  lab_order_no varchar(20) NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid NOT NULL REFERENCES visit(id),
  priority varchar(7) NOT NULL CHECK (priority IN ('ROUTINE','URGENT','STAT')),
  status varchar(10) NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('ORDERED','PARTIAL','COMPLETE','CANCELLED')),
  clinical_notes varchar(500), collection_location_id uuid REFERENCES org_unit(id), ordered_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE specimen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accession_no varchar(20) NOT NULL UNIQUE,                                  
  lab_order_id uuid NOT NULL REFERENCES lab_order(id),
  specimen_type varchar(20) NOT NULL, container varchar(30),
  status varchar(10) NOT NULL DEFAULT 'COLLECTED' CHECK (status IN ('COLLECTED','RECEIVED','REJECTED','STORED','DISCARDED')),
  collected_at timestamptz, collected_by_staff_id uuid REFERENCES staff(id),
  received_at timestamptz, received_by_staff_id uuid REFERENCES staff(id),
  rejection_reason varchar(15) CHECK (rejection_reason IN
    ('HAEMOLYSED','INSUFFICIENT','MISLABELLED','CLOTTED','WRONG_CONTAINER','DELAYED','CONTAMINATED','OTHER')),
  storage_location varchar(50)
);
--> statement-breakpoint
CREATE TABLE lab_order_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id uuid NOT NULL REFERENCES lab_order(id), test_id uuid NOT NULL REFERENCES lab_test(id),
  panel_id uuid REFERENCES lab_panel(id), specimen_id uuid REFERENCES specimen(id),
  status varchar(11) NOT NULL DEFAULT 'ORDERED' CHECK (status IN
    ('ORDERED','COLLECTED','RECEIVED','IN_PROGRESS','RESULTED','VALIDATED','REJECTED','CANCELLED')),
  UNIQUE (lab_order_id, test_id)
);
--> statement-breakpoint
CREATE INDEX lab_item_worklist_ix ON lab_order_item(status) WHERE status IN ('ORDERED','COLLECTED','RECEIVED','IN_PROGRESS','RESULTED');
--> statement-breakpoint
CREATE TABLE lab_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_item_id uuid NOT NULL REFERENCES lab_order_item(id),
  analyte_code varchar(20) NOT NULL,                                          
  value_num numeric(14,4), value_text varchar(500), value_coded varchar(30),
  unit varchar(20), ref_low numeric(12,4), ref_high numeric(12,4), ref_text varchar(100),   
  flag varchar(4) CHECK (flag IN ('N','L','H','LL','HH','A','POS','NEG')), is_critical boolean NOT NULL DEFAULT false,
  status varchar(11) NOT NULL DEFAULT 'PRELIMINARY' CHECK (status IN ('PRELIMINARY','FINAL','CORRECTED')),
  source varchar(8) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','ANALYZER')), instrument_id varchar(40),
  resulted_by_staff_id uuid NOT NULL REFERENCES staff(id), resulted_at timestamptz NOT NULL DEFAULT now(),
  validated_by_staff_id uuid REFERENCES staff(id), validated_at timestamptz,
  amends_id uuid REFERENCES lab_result(id), comment varchar(500),
  CONSTRAINT lab_result_value_ck CHECK (value_num IS NOT NULL OR value_text IS NOT NULL OR value_coded IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE critical_result_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_type varchar(8) NOT NULL CHECK (source_type IN ('LAB','IMAGING')),
  source_id uuid NOT NULL, notified_to_staff_id uuid NOT NULL REFERENCES staff(id),
  notified_by_staff_id uuid NOT NULL REFERENCES staff(id), notified_at timestamptz NOT NULL DEFAULT now(),
  method varchar(8) NOT NULL CHECK (method IN ('PHONE','IN_APP','SMS','IN_PERSON')),
  read_back_confirmed boolean NOT NULL DEFAULT false, acknowledged_at timestamptz
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#9 (V18)
CREATE TABLE imaging_modality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(8) NOT NULL UNIQUE,    
  name varchar(60) NOT NULL, org_unit_id uuid REFERENCES org_unit(id), active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE imaging_procedure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(150) NOT NULL,
  modality_id uuid NOT NULL REFERENCES imaging_modality(id), body_part varchar(60),
  uses_contrast boolean NOT NULL DEFAULT false, ionising boolean NOT NULL DEFAULT true,
  pregnancy_sensitive boolean NOT NULL DEFAULT false, est_duration_min smallint NOT NULL DEFAULT 15,
  prep_instructions varchar(500), service_item_id uuid REFERENCES service_item(id), active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE imaging_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES clinical_order(id), accession_no varchar(20) NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid NOT NULL REFERENCES visit(id),
  procedure_id uuid NOT NULL REFERENCES imaging_procedure(id),
  laterality varchar(9) CHECK (laterality IN ('LEFT','RIGHT','BILATERAL','NA')),
  priority varchar(7) NOT NULL CHECK (priority IN ('ROUTINE','URGENT','STAT')),
  clinical_indication varchar(500) NOT NULL,
  status varchar(11) NOT NULL DEFAULT 'ORDERED' CHECK (status IN
    ('ORDERED','SCHEDULED','IN_PROGRESS','REPORTED','VERIFIED','CANCELLED')),
  scheduled_at timestamptz, performed_at timestamptz, performed_by_staff_id uuid REFERENCES staff(id),
  pregnancy_checked boolean, contrast_allergy_checked boolean, renal_function_checked boolean,
  transport_required boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE imaging_study (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), imaging_order_id uuid NOT NULL REFERENCES imaging_order(id),
  study_instance_uid varchar(128) NOT NULL UNIQUE, viewer_url varchar(500), image_count int, received_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE imaging_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), imaging_order_id uuid NOT NULL REFERENCES imaging_order(id),
  version int NOT NULL DEFAULT 1, addendum_of_id uuid REFERENCES imaging_report(id),
  findings text NOT NULL, impression text NOT NULL, critical_finding boolean NOT NULL DEFAULT false,
  status varchar(11) NOT NULL DEFAULT 'PRELIMINARY' CHECK (status IN ('PRELIMINARY','FINAL','ADDENDUM')),
  reported_by_staff_id uuid NOT NULL REFERENCES staff(id), reported_at timestamptz NOT NULL DEFAULT now(),
  verified_by_staff_id uuid REFERENCES staff(id), verified_at timestamptz, UNIQUE (imaging_order_id, version)
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#6 (V19)
CREATE TABLE room (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),                         
  code varchar(20) NOT NULL, room_type varchar(15) NOT NULL CHECK (room_type IN
    ('GENERAL_BAY','SIDE_ROOM','ISOLATION','ICU_BAY','LABOUR','NURSERY')),
  gender_policy varchar(6) NOT NULL DEFAULT 'MIXED' CHECK (gender_policy IN ('MIXED','MALE','FEMALE')),
  active boolean NOT NULL DEFAULT true, UNIQUE (org_unit_id, code)
);
--> statement-breakpoint
CREATE TABLE bed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES room(id), org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  bed_no varchar(15) NOT NULL,
  bed_class varchar(13) NOT NULL CHECK (bed_class IN
    ('GENERAL','SEMI_PRIVATE','PRIVATE','ICU','HDU','NICU','ISOLATION','MATERNITY')),
  service_item_id uuid REFERENCES service_item(id),                          
  status varchar(12) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN
    ('AVAILABLE','OCCUPIED','RESERVED','CLEANING','MAINTENANCE','BLOCKED')),
  status_changed_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  UNIQUE (org_unit_id, bed_no)
);
--> statement-breakpoint
CREATE TABLE bed_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bed_id uuid NOT NULL REFERENCES bed(id),
  reason varchar(20) NOT NULL CHECK (reason IN ('MAINTENANCE','INFECTION_CONTROL','CLEANING_DEEP','STAFFING','OTHER')),
  blocked_from timestamptz NOT NULL, blocked_to timestamptz, created_by text NOT NULL, note varchar(300)
);
--> statement-breakpoint
CREATE TABLE bed_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid NOT NULL REFERENCES visit(id),
  requested_unit_id uuid REFERENCES org_unit(id), requested_class varchar(13),
  priority varchar(9) NOT NULL DEFAULT 'ROUTINE' CHECK (priority IN ('ROUTINE','URGENT','EMERGENCY')),
  isolation_required boolean NOT NULL DEFAULT false, clinical_summary varchar(500),
  requested_by_staff_id uuid NOT NULL REFERENCES staff(id), requested_at timestamptz NOT NULL DEFAULT now(),
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ALLOCATED','CANCELLED','EXPIRED')),
  allocated_at timestamptz
);
--> statement-breakpoint
CREATE INDEX bed_request_pending_ix ON bed_request(priority, requested_at) WHERE status = 'PENDING';
--> statement-breakpoint
CREATE TABLE admission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_no varchar(20) NOT NULL UNIQUE,
  patient_id uuid NOT NULL REFERENCES patient(id), visit_id uuid NOT NULL REFERENCES visit(id),
  bed_request_id uuid REFERENCES bed_request(id), admitting_encounter_id uuid REFERENCES encounter(id),
  attending_staff_id uuid NOT NULL REFERENCES staff(id), current_unit_id uuid NOT NULL REFERENCES org_unit(id),
  admission_type varchar(10) NOT NULL CHECK (admission_type IN ('EMERGENCY','ELECTIVE','TRANSFER_IN','MATERNITY','NEWBORN')),
  status varchar(16) NOT NULL DEFAULT 'PENDING_BED' CHECK (status IN
    ('PENDING_BED','ADMITTED','DISCHARGE_PLANNED','DISCHARGED','DECEASED','LAMA','ABSCONDED','REFERRED_OUT','CANCELLED')),
  admitted_at timestamptz, expected_discharge_date date, discharge_planned_at timestamptz,
  discharged_at timestamptz,
  discharge_type varchar(16) CHECK (discharge_type IN
    ('RECOVERED','IMPROVED','REFERRED_OUT','LAMA','ABSCONDED','DECEASED','TRANSFERRED_OUT')),
  primary_diagnosis_icd10 varchar(10) REFERENCES icd10_code(code),
  isolation_status varchar(10) NOT NULL DEFAULT 'NONE' CHECK (isolation_status IN ('NONE','CONTACT','DROPLET','AIRBORNE')),
  time_of_death timestamptz, cause_of_death_icd10 varchar(10) REFERENCES icd10_code(code),
  CONSTRAINT admission_dates_ck CHECK (discharged_at IS NULL OR discharged_at >= admitted_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX admission_one_active_per_patient_ux ON admission(patient_id)
  WHERE status IN ('PENDING_BED','ADMITTED','DISCHARGE_PLANNED');
--> statement-breakpoint
ALTER TABLE vital_sign ADD CONSTRAINT vital_admission_fk FOREIGN KEY (admission_id) REFERENCES admission(id);
--> statement-breakpoint
ALTER TABLE clinical_order ADD CONSTRAINT order_admission_fk FOREIGN KEY (admission_id) REFERENCES admission(id);
--> statement-breakpoint
ALTER TABLE prescription ADD CONSTRAINT prescription_admission_fk FOREIGN KEY (admission_id) REFERENCES admission(id);
--> statement-breakpoint
ALTER TABLE bill ADD CONSTRAINT bill_admission_fk FOREIGN KEY (admission_id) REFERENCES admission(id);
--> statement-breakpoint
ALTER TABLE patient_deposit ADD CONSTRAINT patient_deposit_admission_fk FOREIGN KEY (admission_id) REFERENCES admission(id);
--> statement-breakpoint
CREATE TABLE bed_assignment (                                                 
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admission(id), bed_id uuid NOT NULL REFERENCES bed(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),                          
  assigned_from timestamptz NOT NULL, assigned_to timestamptz,                
  reason varchar(10) NOT NULL CHECK (reason IN ('ADMISSION','TRANSFER','ISOLATION','UPGRADE','DOWNGRADE','CLINICAL')),
  assigned_by text NOT NULL,
  CONSTRAINT bed_assignment_period_ck CHECK (assigned_to IS NULL OR assigned_to > assigned_from),
  CONSTRAINT bed_assignment_bed_overlap_ex EXCLUDE USING gist
    (bed_id WITH =, tstzrange(assigned_from, assigned_to) WITH &&),
  CONSTRAINT bed_assignment_adm_overlap_ex EXCLUDE USING gist
    (admission_id WITH =, tstzrange(assigned_from, assigned_to) WITH &&)
);
--> statement-breakpoint
CREATE TABLE discharge_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admission(id),
  version int NOT NULL DEFAULT 1, amends_id uuid REFERENCES discharge_summary(id),
  discharge_diagnosis text NOT NULL, icd10_primary varchar(10) REFERENCES icd10_code(code),
  procedures text, hospital_course text NOT NULL, condition_at_discharge varchar(200) NOT NULL,
  discharge_medications text, follow_up_instructions text, follow_up_date date,
  status varchar(8) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SIGNED')),
  authored_by_staff_id uuid NOT NULL REFERENCES staff(id), signed_at timestamptz,
  UNIQUE (admission_id, version)
);
--> statement-breakpoint

-- Source: 10-module-clinical.md block#7 (V20)
CREATE TABLE nursing_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admission(id), patient_id uuid NOT NULL REFERENCES patient(id),
  assessment_type varchar(16) NOT NULL CHECK (assessment_type IN
    ('ADMISSION','SHIFT','FALLS_RISK','PRESSURE_INJURY','NUTRITION','PAIN','DISCHARGE')),
  score numeric(5,1), risk_level varchar(8) CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  form_data jsonb NOT NULL,                       
  form_version varchar(10) NOT NULL,
  assessed_by_staff_id uuid NOT NULL REFERENCES staff(id), assessed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE care_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admission(id), problem varchar(300) NOT NULL, goal varchar(300) NOT NULL,
  target_date date, status varchar(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MET','DISCONTINUED')),
  created_by_staff_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE care_plan_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid REFERENCES care_plan(id), admission_id uuid NOT NULL REFERENCES admission(id),
  description varchar(300) NOT NULL, due_at timestamptz NOT NULL, recurrence varchar(20),   
  status varchar(10) NOT NULL DEFAULT 'DUE' CHECK (status IN ('DUE','DONE','SKIPPED','OVERDUE','CANCELLED')),
  source varchar(10) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','EWS','ORDER','PROTOCOL')),
  completed_by_staff_id uuid REFERENCES staff(id), completed_at timestamptz, skip_reason varchar(200)
);
--> statement-breakpoint
CREATE INDEX care_plan_task_due_ix ON care_plan_task(admission_id, due_at) WHERE status IN ('DUE','OVERDUE');
--> statement-breakpoint
CREATE TABLE medication_administration (                                       
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admission(id),
  prescription_item_id uuid NOT NULL REFERENCES prescription_item(id),
  scheduled_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','GIVEN','HELD','REFUSED','MISSED')),
  is_prn boolean NOT NULL DEFAULT false,
  administered_at timestamptz, administered_by_staff_id uuid REFERENCES staff(id),
  witnessed_by_staff_id uuid REFERENCES staff(id),
  dose_given numeric(10,3), dose_unit varchar(15), route varchar(15), stock_batch_id uuid,   
  reason varchar(300), scan_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT mar_slot_uq UNIQUE (prescription_item_id, scheduled_at),
  CONSTRAINT mar_given_ck CHECK (status <> 'GIVEN' OR (administered_at IS NOT NULL AND administered_by_staff_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX mar_due_ix ON medication_administration(admission_id, scheduled_at) WHERE status = 'SCHEDULED';
--> statement-breakpoint
CREATE TABLE intake_output (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES admission(id),
  recorded_at timestamptz NOT NULL, direction varchar(6) NOT NULL CHECK (direction IN ('INTAKE','OUTPUT')),
  category varchar(8) NOT NULL CHECK (category IN ('ORAL','IV','NG','URINE','DRAIN','VOMIT','STOOL','OTHER')),
  volume_ml numeric(7,1) NOT NULL CHECK (volume_ml >= 0), recorded_by_staff_id uuid NOT NULL REFERENCES staff(id)
);
--> statement-breakpoint
CREATE TABLE nursing_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES admission(id),
  note_type varchar(10) NOT NULL CHECK (note_type IN ('SHIFT','INCIDENT','PROCEDURE','FAMILY','ADDENDUM')),
  body text NOT NULL, shift_type_id uuid REFERENCES shift_type(id),
  authored_by_staff_id uuid NOT NULL REFERENCES staff(id), authored_at timestamptz NOT NULL DEFAULT now(),
  amends_id uuid REFERENCES nursing_note(id)
);
--> statement-breakpoint
CREATE TABLE shift_handover (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  from_roster_date date NOT NULL, from_shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  outgoing_staff_id uuid NOT NULL REFERENCES staff(id), incoming_staff_id uuid REFERENCES staff(id),
  status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','ACKNOWLEDGED')),
  summary text, submitted_at timestamptz, acknowledged_at timestamptz,
  UNIQUE (org_unit_id, from_roster_date, from_shift_type_id, outgoing_staff_id)
);
--> statement-breakpoint
CREATE TABLE handover_item (                                                   
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), handover_id uuid NOT NULL REFERENCES shift_handover(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES admission(id),
  situation text, background text, assessment text, recommendation text,
  pending_tasks text, ews_band varchar(8), isolation boolean, falls_risk boolean, pressure_risk boolean
);
--> statement-breakpoint
CREATE TABLE nurse_patient_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_entry_id uuid NOT NULL REFERENCES roster_entry(id),                  
  staff_id uuid NOT NULL REFERENCES staff(id), admission_id uuid NOT NULL REFERENCES admission(id),
  role varchar(9) NOT NULL DEFAULT 'PRIMARY' CHECK (role IN ('PRIMARY','ASSISTING')),
  allocated_from timestamptz NOT NULL, allocated_to timestamptz, allocated_by text NOT NULL,
  CONSTRAINT nurse_alloc_primary_ex EXCLUDE USING gist
    (admission_id WITH =, tstzrange(allocated_from, allocated_to) WITH &&) WHERE (role = 'PRIMARY')
);
--> statement-breakpoint

-- Source: 11-module-supply-and-revenue.md block#1 (V21)
CREATE TABLE store (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  store_type varchar(12) NOT NULL CHECK (store_type IN ('MAIN','PHARMACY','WARD','LAB','RADIOLOGY','THEATRE','GENERAL')),
  org_unit_id uuid REFERENCES org_unit(id), parent_store_id uuid REFERENCES store(id),
  is_dispensing boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE item_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  parent_id uuid REFERENCES item_category(id)
);
--> statement-breakpoint
CREATE TABLE item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE, name varchar(200) NOT NULL,
  item_type varchar(12) NOT NULL CHECK (item_type IN ('DRUG','CONSUMABLE','REAGENT','EQUIPMENT','GENERAL')),
  category_id uuid REFERENCES item_category(id),
  uom varchar(15) NOT NULL, pack_size numeric(10,2) NOT NULL DEFAULT 1,        
  is_batch_tracked boolean NOT NULL DEFAULT true, is_expiry_tracked boolean NOT NULL DEFAULT true,
  is_controlled boolean NOT NULL DEFAULT false,
  storage_condition varchar(10) NOT NULL DEFAULT 'AMBIENT' CHECK (storage_condition IN ('AMBIENT','COLD_CHAIN','FROZEN')),
  reorder_level numeric(14,3) NOT NULL DEFAULT 0, reorder_qty numeric(14,3) NOT NULL DEFAULT 0, max_level numeric(14,3),
  active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
ALTER TABLE service_item ADD CONSTRAINT service_item_inventory_fk FOREIGN KEY (inventory_item_id) REFERENCES item(id);
--> statement-breakpoint
ALTER TABLE drug ADD CONSTRAINT drug_inventory_fk FOREIGN KEY (inventory_item_id) REFERENCES item(id);
--> statement-breakpoint
CREATE TABLE supplier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE, name varchar(200) NOT NULL, tin varchar(20),
  contact_name varchar(100), phone varchar(25), email varchar(255), address varchar(255),
  payment_terms_days smallint NOT NULL DEFAULT 30, momo_number varchar(20), bank_details varchar(255),
  active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE stock_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES store(id), item_id uuid NOT NULL REFERENCES item(id),
  batch_no varchar(40), expiry_date date, unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  qty_on_hand numeric(14,3) NOT NULL DEFAULT 0, qty_reserved numeric(14,3) NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','QUARANTINE','EXPIRED','RECALLED')),
  received_at timestamptz NOT NULL DEFAULT now(), supplier_id uuid REFERENCES supplier(id),
  CONSTRAINT stock_batch_qty_ck CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_reserved <= qty_on_hand),
  CONSTRAINT stock_batch_uq UNIQUE NULLS NOT DISTINCT (store_id, item_id, batch_no, expiry_date)
);
--> statement-breakpoint
CREATE INDEX stock_batch_fefo_ix ON stock_batch(store_id, item_id, expiry_date NULLS LAST) WHERE status = 'ACTIVE' AND qty_on_hand > 0;
--> statement-breakpoint
ALTER TABLE medication_administration ADD CONSTRAINT mar_batch_fk FOREIGN KEY (stock_batch_id) REFERENCES stock_batch(id);
--> statement-breakpoint
CREATE TABLE stock_ledger (                                                   
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now(),
  store_id uuid NOT NULL REFERENCES store(id), item_id uuid NOT NULL REFERENCES item(id),
  batch_id uuid NOT NULL REFERENCES stock_batch(id),
  txn_type varchar(16) NOT NULL CHECK (txn_type IN
    ('GRN','TRANSFER_OUT','TRANSFER_IN','DISPENSE','DISPENSE_RETURN','CONSUMPTION',
     'ADJUST_IN','ADJUST_OUT','WRITE_OFF','STOCK_TAKE_ADJ','QUARANTINE')),
  qty_delta numeric(14,3) NOT NULL CHECK (qty_delta <> 0), unit_cost numeric(14,4) NOT NULL,
  balance_after numeric(14,3) NOT NULL,                                        
  ref_type varchar(20) NOT NULL, ref_id uuid NOT NULL, line_no int NOT NULL DEFAULT 1,
  reason varchar(300), created_by text NOT NULL,
  CONSTRAINT stock_ledger_ref_uq UNIQUE (ref_type, ref_id, line_no, batch_id, txn_type)    
);
--> statement-breakpoint
CREATE INDEX stock_ledger_item_ix ON stock_ledger(store_id, item_id, occurred_at DESC);
--> statement-breakpoint
CREATE TABLE requisition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), req_no varchar(20) NOT NULL UNIQUE,
  from_store_id uuid NOT NULL REFERENCES store(id),                            
  to_store_id uuid NOT NULL REFERENCES store(id),                              
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','ISSUED','RECEIVED','REJECTED','CANCELLED')),
  requested_by text NOT NULL, approved_by text, issued_by text, received_by text, note varchar(300),
  requested_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT requisition_stores_ck CHECK (from_store_id <> to_store_id)
);
--> statement-breakpoint
CREATE TABLE requisition_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requisition_id uuid NOT NULL REFERENCES requisition(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES item(id), qty_requested numeric(14,3) NOT NULL CHECK (qty_requested > 0),
  qty_approved numeric(14,3), qty_issued numeric(14,3), qty_received numeric(14,3), UNIQUE (requisition_id, item_id)
);
--> statement-breakpoint
CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), po_no varchar(20) NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES supplier(id), store_id uuid NOT NULL REFERENCES store(id),
  status varchar(18) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  order_date date NOT NULL, expected_date date, currency char(3) NOT NULL DEFAULT 'GHS',
  total_amount numeric(14,2) NOT NULL DEFAULT 0, created_by text NOT NULL, approved_by text, approved_at timestamptz
);
--> statement-breakpoint
CREATE TABLE purchase_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES item(id), qty_ordered numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0), qty_received numeric(14,3) NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE goods_received_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grn_no varchar(20) NOT NULL UNIQUE,
  purchase_order_id uuid REFERENCES purchase_order(id), supplier_id uuid NOT NULL REFERENCES supplier(id),
  store_id uuid NOT NULL REFERENCES store(id), delivery_note_no varchar(40), invoice_no varchar(40),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  received_by text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
);
--> statement-breakpoint
CREATE TABLE grn_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grn_id uuid NOT NULL REFERENCES goods_received_note(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES purchase_order_line(id), item_id uuid NOT NULL REFERENCES item(id),
  batch_no varchar(40), expiry_date date, qty_received numeric(14,3) NOT NULL CHECK (qty_received > 0),
  qty_rejected numeric(14,3) NOT NULL DEFAULT 0, unit_cost numeric(14,4) NOT NULL, reject_reason varchar(200)
);
--> statement-breakpoint
CREATE TABLE stock_take (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES store(id),
  take_type varchar(10) NOT NULL CHECK (take_type IN ('FULL','CYCLE','CONTROLLED')),
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COUNTED','APPROVED','POSTED','CANCELLED')),
  snapshot_at timestamptz NOT NULL, started_by text NOT NULL, approved_by text, posted_at timestamptz
);
--> statement-breakpoint
CREATE TABLE stock_take_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stock_take_id uuid NOT NULL REFERENCES stock_take(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES stock_batch(id), system_qty numeric(14,3) NOT NULL, counted_qty numeric(14,3),
  variance numeric(14,3) GENERATED ALWAYS AS (counted_qty - system_qty) STORED, reason varchar(200),
  UNIQUE (stock_take_id, batch_id)
);
--> statement-breakpoint
CREATE TABLE supplier_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL REFERENCES supplier(id),
  invoice_no varchar(40) NOT NULL, invoice_date date NOT NULL, due_date date NOT NULL,
  purchase_order_id uuid REFERENCES purchase_order(id), grn_id uuid REFERENCES goods_received_note(id),
  amount numeric(14,2) NOT NULL, match_status varchar(10) NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('MATCHED','VARIANCE','UNMATCHED')),
  status varchar(10) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','APPROVED','PAYMENT_BATCHED','PAID','DISPUTED')),
  payment_id uuid REFERENCES payments(id),                                       
  UNIQUE (supplier_id, invoice_no)
);
--> statement-breakpoint

-- Source: 11-module-supply-and-revenue.md block#3 (V22)
CREATE TABLE dispense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispense_no varchar(20) NOT NULL UNIQUE,
  sale_type varchar(12) NOT NULL DEFAULT 'PRESCRIPTION' CHECK (sale_type IN ('PRESCRIPTION','OTC','WARD_SUPPLY')),
  prescription_id uuid REFERENCES prescription(id), patient_id uuid REFERENCES patient(id),
  visit_id uuid REFERENCES visit(id), admission_id uuid REFERENCES admission(id),
  store_id uuid NOT NULL REFERENCES store(id),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VERIFIED','DISPENSED','CANCELLED')),
  payment_status varchar(14) NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (payment_status IN ('NOT_REQUIRED','AWAITING','CLEARED','OVERRIDDEN')),
  prepared_by_staff_id uuid REFERENCES staff(id), verified_by_staff_id uuid REFERENCES staff(id),
  dispensed_at timestamptz, counselled boolean NOT NULL DEFAULT false,
  CONSTRAINT dispense_rx_ck CHECK (sale_type <> 'PRESCRIPTION' OR prescription_id IS NOT NULL),
  CONSTRAINT dispense_verify_ck CHECK (status <> 'DISPENSED' OR verified_by_staff_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE dispense_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispense_id uuid NOT NULL REFERENCES dispense(id) ON DELETE CASCADE,
  prescription_item_id uuid REFERENCES prescription_item(id), drug_id uuid NOT NULL REFERENCES drug(id),
  stock_batch_id uuid NOT NULL REFERENCES stock_batch(id), quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL, substituted_for_drug_id uuid REFERENCES drug(id), label_text varchar(500)
);
--> statement-breakpoint
CREATE TABLE dispense_return (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispense_item_id uuid NOT NULL REFERENCES dispense_item(id),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0), reason varchar(300) NOT NULL,
  returned_by text NOT NULL, accepted_by_staff_id uuid NOT NULL REFERENCES staff(id), restock boolean NOT NULL DEFAULT false,
  returned_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE controlled_drug_register (                                       
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_no bigint GENERATED ALWAYS AS IDENTITY,
  store_id uuid NOT NULL REFERENCES store(id), item_id uuid NOT NULL REFERENCES item(id),
  batch_id uuid REFERENCES stock_batch(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  txn_type varchar(12) NOT NULL CHECK (txn_type IN ('RECEIPT','DISPENSE','ADMINISTER','WASTE','TRANSFER','RETURN','ADJUSTMENT')),
  qty_delta numeric(12,3) NOT NULL, balance_after numeric(12,3) NOT NULL,
  patient_id uuid REFERENCES patient(id), prescription_item_id uuid REFERENCES prescription_item(id),
  performed_by_staff_id uuid NOT NULL REFERENCES staff(id), witnessed_by_staff_id uuid REFERENCES staff(id), note varchar(300),
  CONSTRAINT cd_witness_ck CHECK (txn_type IN ('RECEIPT','ADJUSTMENT') OR witnessed_by_staff_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE pharmacy_intervention (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_id uuid NOT NULL REFERENCES prescription(id),
  pharmacist_staff_id uuid NOT NULL REFERENCES staff(id),
  type varchar(14) NOT NULL CHECK (type IN ('DOSE_ADJUST','SUBSTITUTION','CLARIFICATION','REJECTION','INTERACTION','STOCKOUT')),
  description varchar(500) NOT NULL, outcome varchar(200), prescriber_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE ward_stock_issue (                                                
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_store_id uuid NOT NULL REFERENCES store(id),
  to_store_id uuid NOT NULL REFERENCES store(id), admission_id uuid REFERENCES admission(id),
  item_id uuid NOT NULL REFERENCES item(id), batch_id uuid NOT NULL REFERENCES stock_batch(id),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0), issued_by_staff_id uuid NOT NULL REFERENCES staff(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Source: 11-module-supply-and-revenue.md block#5 (V23)
CREATE TABLE payer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(200) NOT NULL,
  payer_type varchar(12) NOT NULL CHECK (payer_type IN ('NHIS','PRIVATE','CORPORATE','GOVERNMENT')),
  contact_name varchar(100), phone varchar(25), email varchar(255), address varchar(255),
  claim_format varchar(20) NOT NULL DEFAULT 'CSV', price_list_id uuid REFERENCES price_list(id),
  credit_limit numeric(14,2), payment_terms_days smallint NOT NULL DEFAULT 60, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
ALTER TABLE price_list ADD CONSTRAINT price_list_payer_fk FOREIGN KEY (payer_id) REFERENCES payer(id);
--> statement-breakpoint
CREATE TABLE insurance_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payer_id uuid NOT NULL REFERENCES payer(id),
  code varchar(20) NOT NULL, name varchar(150) NOT NULL, price_list_id uuid REFERENCES price_list(id),
  copay_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (copay_percent BETWEEN 0 AND 100),
  annual_limit numeric(14,2), requires_referral boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  UNIQUE (payer_id, code)
);
--> statement-breakpoint
CREATE TABLE coverage_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES insurance_plan(id),
  service_category varchar(15), service_item_id uuid REFERENCES service_item(id),     
  covered_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (covered_percent BETWEEN 0 AND 100),
  per_visit_limit numeric(14,2), requires_preauth boolean NOT NULL DEFAULT false, is_exclusion boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL, effective_to date,
  CONSTRAINT coverage_rule_target_ck CHECK (service_category IS NOT NULL OR service_item_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE patient_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patient(id),
  payer_id uuid NOT NULL REFERENCES payer(id), plan_id uuid REFERENCES insurance_plan(id),
  member_no varchar(40) NOT NULL, card_expiry date, principal_member_name varchar(150),
  relationship varchar(8) NOT NULL DEFAULT 'SELF' CHECK (relationship IN ('SELF','SPOUSE','CHILD','PARENT','OTHER')),
  is_primary boolean NOT NULL DEFAULT true,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','SUSPENDED','INACTIVE')),
  verified_at timestamptz, verified_by text, verification_method varchar(12) CHECK (verification_method IN ('ELECTRONIC','MANUAL','CARD_PHOTO')),
  card_attachment_id uuid, UNIQUE (payer_id, member_no, patient_id)
);
--> statement-breakpoint
ALTER TABLE visit ADD CONSTRAINT visit_insurance_fk FOREIGN KEY (patient_insurance_id) REFERENCES patient_insurance(id);
--> statement-breakpoint
ALTER TABLE bill  ADD CONSTRAINT bill_insurance_fk  FOREIGN KEY (patient_insurance_id) REFERENCES patient_insurance(id);
--> statement-breakpoint
CREATE TABLE eligibility_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_insurance_id uuid NOT NULL REFERENCES patient_insurance(id),
  checked_at timestamptz NOT NULL DEFAULT now(), checked_by text NOT NULL,
  method varchar(10) NOT NULL CHECK (method IN ('ELECTRONIC','MANUAL')),
  status varchar(12) NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','NOT_FOUND','UNAVAILABLE')),
  reference varchar(100), response_summary varchar(500)
);
--> statement-breakpoint
CREATE TABLE preauthorization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_insurance_id uuid NOT NULL REFERENCES patient_insurance(id),
  visit_id uuid REFERENCES visit(id), admission_id uuid REFERENCES admission(id),
  service_item_id uuid REFERENCES service_item(id), description varchar(300) NOT NULL,
  requested_amount numeric(14,2), approved_amount numeric(14,2),
  status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','DENIED','EXPIRED','USED')),
  auth_number varchar(60), valid_until date, requested_by text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decision_note varchar(300)
);
--> statement-breakpoint
CREATE TABLE claim_rejection_code (
  code varchar(15) PRIMARY KEY, description varchar(300) NOT NULL,
  category varchar(15) NOT NULL CHECK (category IN ('ELIGIBILITY','CODING','TARIFF','DOCUMENTATION','DUPLICATE','TIMELY_FILING','OTHER')),
  resubmittable boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE claim_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_no varchar(20) NOT NULL UNIQUE,
  payer_id uuid NOT NULL REFERENCES payer(id), period_year smallint NOT NULL, period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','CLOSED')),
  claim_count int NOT NULL DEFAULT 0, total_claimed numeric(14,2) NOT NULL DEFAULT 0,
  submitted_at timestamptz, submitted_by text, submission_reference varchar(100), export_attachment_id uuid
);
--> statement-breakpoint
CREATE TABLE claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_no varchar(20) NOT NULL UNIQUE,
  payer_id uuid NOT NULL REFERENCES payer(id), patient_insurance_id uuid NOT NULL REFERENCES patient_insurance(id),
  patient_id uuid NOT NULL REFERENCES patient(id), bill_id uuid NOT NULL REFERENCES bill(id),
  visit_id uuid REFERENCES visit(id), admission_id uuid REFERENCES admission(id),
  claim_batch_id uuid REFERENCES claim_batch(id), claim_type varchar(3) NOT NULL CHECK (claim_type IN ('OPD','IPD')),
  service_from date NOT NULL, service_to date NOT NULL, primary_icd10 varchar(10) REFERENCES icd10_code(code), drg_code varchar(15),
  status varchar(15) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','READY','SUBMITTED','QUERIED','ACCEPTED','REJECTED','PARTIALLY_PAID','PAID','WRITTEN_OFF')),
  claimed_amount numeric(14,2) NOT NULL DEFAULT 0, approved_amount numeric(14,2), paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  copay_amount numeric(14,2) NOT NULL DEFAULT 0, submitted_at timestamptz,
  resubmission_of_id uuid REFERENCES claim(id), version int NOT NULL DEFAULT 0,
  CONSTRAINT claim_dates_ck CHECK (service_to >= service_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX claim_one_active_per_bill_ux ON claim(bill_id) WHERE status NOT IN ('REJECTED','WRITTEN_OFF');
--> statement-breakpoint
CREATE TABLE claim_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  bill_line_id uuid NOT NULL REFERENCES bill_line(id), service_item_id uuid NOT NULL REFERENCES service_item(id),
  tariff_code varchar(30), quantity numeric(10,3) NOT NULL, claimed_amount numeric(14,2) NOT NULL,
  approved_amount numeric(14,2), rejection_code varchar(15) REFERENCES claim_rejection_code(code), rejection_note varchar(300),
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','ADJUSTED')),
  UNIQUE (claim_id, bill_line_id)
);
--> statement-breakpoint
CREATE TABLE remittance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), remittance_no varchar(20) NOT NULL UNIQUE,
  payer_id uuid NOT NULL REFERENCES payer(id), received_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method varchar(8) NOT NULL CHECK (method IN ('BANK','MOMO','CHEQUE')), reference varchar(100),
  status varchar(11) NOT NULL DEFAULT 'UNALLOCATED' CHECK (status IN ('UNALLOCATED','PARTIAL','ALLOCATED')),
  recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE remittance_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), remittance_id uuid NOT NULL REFERENCES remittance(id),
  claim_id uuid NOT NULL REFERENCES claim(id), amount numeric(14,2) NOT NULL CHECK (amount > 0),
  allocated_by text NOT NULL, allocated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Source: 12-module-hr-payroll-reporting.md block#1 (V24)
CREATE TABLE leave_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  is_paid boolean NOT NULL DEFAULT true,
  entitlement_days numeric(5,1) NOT NULL DEFAULT 0,                     
  accrual_method varchar(8) NOT NULL DEFAULT 'UPFRONT' CHECK (accrual_method IN ('UPFRONT','MONTHLY','NONE')),
  carry_over_max_days numeric(5,1) NOT NULL DEFAULT 0,
  counts_calendar_days boolean NOT NULL DEFAULT false,                  
  min_notice_days smallint NOT NULL DEFAULT 0, max_consecutive_days smallint,
  requires_attachment_after_days smallint,                              
  gender_restriction varchar(6) CHECK (gender_restriction IN ('FEMALE','MALE')),
  applies_to varchar(12) NOT NULL DEFAULT 'ALL' CHECK (applies_to IN ('ALL','CLINICAL','NON_CLINICAL')),
  active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE leave_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id), leave_type_id uuid NOT NULL REFERENCES leave_type(id), leave_year smallint NOT NULL,
  entitled numeric(5,1) NOT NULL DEFAULT 0, accrued numeric(5,1) NOT NULL DEFAULT 0,
  carried_over numeric(5,1) NOT NULL DEFAULT 0, adjusted numeric(5,1) NOT NULL DEFAULT 0,
  taken numeric(5,1) NOT NULL DEFAULT 0, pending numeric(5,1) NOT NULL DEFAULT 0,
  available numeric(5,1) GENERATED ALWAYS AS (accrued + carried_over + adjusted - taken - pending) STORED,
  UNIQUE (staff_id, leave_type_id, leave_year)
);
--> statement-breakpoint
CREATE TABLE leave_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_no varchar(20) NOT NULL UNIQUE,
  staff_id uuid NOT NULL REFERENCES staff(id), leave_type_id uuid NOT NULL REFERENCES leave_type(id),
  start_date date NOT NULL, end_date date NOT NULL, start_half_day boolean NOT NULL DEFAULT false, end_half_day boolean NOT NULL DEFAULT false,
  days numeric(5,1) NOT NULL CHECK (days > 0),                          
  status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','APPROVED_L1','APPROVED','REJECTED','CANCELLED','RECALLED')),
  reason varchar(500), relief_staff_id uuid REFERENCES staff(id), attachment_id uuid,
  submitted_at timestamptz, coverage_warning varchar(300),
  CONSTRAINT leave_dates_ck CHECK (end_date >= start_date),
  CONSTRAINT leave_overlap_ex EXCLUDE USING gist
    (staff_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (status IN ('SUBMITTED','APPROVED_L1','APPROVED'))
);
--> statement-breakpoint
CREATE TABLE leave_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), leave_request_id uuid NOT NULL REFERENCES leave_request(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step IN (1,2)),                         
  approver_user_id text NOT NULL, approver_staff_id uuid REFERENCES staff(id),
  decision varchar(8) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), comment varchar(300),
  decided_at timestamptz NOT NULL DEFAULT now(), UNIQUE (leave_request_id, step)
);
--> statement-breakpoint
CREATE TABLE overtime_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES staff(id),
  attendance_record_id uuid REFERENCES attendance_record(id), work_date date NOT NULL,
  minutes int NOT NULL CHECK (minutes > 0), reason varchar(300),
  source varchar(10) NOT NULL DEFAULT 'SUGGESTED' CHECK (source IN ('SUGGESTED','REQUESTED','PRE_APPROVED')),
  status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by text, approved_at timestamptz, UNIQUE (attendance_record_id)
);
--> statement-breakpoint

-- Source: 12-module-hr-payroll-reporting.md block#2 (V25)
CREATE TABLE salary_scale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL, grade varchar(20) NOT NULL, step smallint NOT NULL DEFAULT 1,
  base_amount numeric(14,2) NOT NULL CHECK (base_amount >= 0), effective_from date NOT NULL, effective_to date,
  UNIQUE (code, grade, step, effective_from)
);
--> statement-breakpoint
CREATE TABLE staff_compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES staff(id),
  salary_scale_id uuid REFERENCES salary_scale(id), base_salary numeric(14,2) NOT NULL CHECK (base_salary >= 0),
  payout_method varchar(6) NOT NULL CHECK (payout_method IN ('MOMO','BANK')),
  momo_number varchar(20), momo_name varchar(200),                              
  bank_name varchar(100), bank_account varchar(40), ssnit_number varchar(20), tin varchar(20),
  effective_from date NOT NULL, effective_to date,
  CONSTRAINT staff_comp_overlap_ex EXCLUDE USING gist
    (staff_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);
--> statement-breakpoint
CREATE TABLE pay_element (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  element_type varchar(12) NOT NULL CHECK (element_type IN ('EARNING','DEDUCTION','STATUTORY','EMPLOYER')),
  calc_method varchar(12) NOT NULL CHECK (calc_method IN ('FIXED','PCT_OF_BASIC','PER_UNIT','ATTENDANCE','STATUTORY')),
  is_taxable boolean NOT NULL DEFAULT true, is_pensionable boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT true, export_code varchar(30), sort_order smallint NOT NULL DEFAULT 100, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE staff_pay_element (                                                 
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES staff(id),
  pay_element_id uuid NOT NULL REFERENCES pay_element(id), amount numeric(14,2), percent numeric(7,4),
  effective_from date NOT NULL, effective_to date, note varchar(200),
  CONSTRAINT staff_pay_element_ck CHECK (amount IS NOT NULL OR percent IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE allowance_rule (                                                    
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(30) NOT NULL UNIQUE, name varchar(120) NOT NULL,
  pay_element_id uuid NOT NULL REFERENCES pay_element(id),
  shift_category varchar(12) CHECK (shift_category IN ('STANDARD','MORNING','AFTERNOON','NIGHT')),
  day_type varchar(8) CHECK (day_type IN ('WEEKDAY','WEEKEND','HOLIDAY')),
  staff_category varchar(12) CHECK (staff_category IN ('CLINICAL','NON_CLINICAL')),
  job_role_id uuid REFERENCES job_role(id), org_unit_type varchar(15),
  unit_of_measure varchar(9) NOT NULL CHECK (unit_of_measure IN ('PER_SHIFT','PER_HOUR','PER_DAY')),
  rate numeric(14,2), multiplier numeric(5,2),                                   
  min_worked_minutes int NOT NULL DEFAULT 0, effective_from date NOT NULL, effective_to date, active boolean NOT NULL DEFAULT true,
  CONSTRAINT allowance_rule_rate_ck CHECK ((rate IS NOT NULL) <> (multiplier IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE statutory_rate (                                                    
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_type varchar(16) NOT NULL CHECK (rate_type IN ('SSNIT_EMPLOYEE','SSNIT_EMPLOYER','TIER2','PAYE_BAND','TAX_RELIEF','OTHER')),
  band_from numeric(14,2) NOT NULL DEFAULT 0, band_to numeric(14,2), rate_percent numeric(7,4), fixed_amount numeric(14,2),
  effective_from date NOT NULL, effective_to date, source_note varchar(200),
  UNIQUE (rate_type, band_from, effective_from)
);
--> statement-breakpoint
CREATE TABLE payroll_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pay_year smallint NOT NULL, pay_month smallint NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  period_start date NOT NULL, period_end date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CALCULATED','REVIEWED','APPROVED','LOCKED','PAID')),
  locked_at timestamptz, locked_by text, UNIQUE (pay_year, pay_month)
);
--> statement-breakpoint
CREATE TABLE payroll_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_no varchar(20) NOT NULL UNIQUE,
  payroll_period_id uuid NOT NULL REFERENCES payroll_period(id),
  run_type varchar(13) NOT NULL DEFAULT 'REGULAR' CHECK (run_type IN ('REGULAR','SUPPLEMENTARY','ARREARS')),
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CALCULATED','REVIEWED','APPROVED','PAID','CANCELLED')),
  calculation_version int NOT NULL DEFAULT 0,
  run_by text NOT NULL, reviewed_by text, approved_by text,
  staff_count int NOT NULL DEFAULT 0, total_gross numeric(16,2) NOT NULL DEFAULT 0, total_deductions numeric(16,2) NOT NULL DEFAULT 0,
  total_net numeric(16,2) NOT NULL DEFAULT 0, total_employer_cost numeric(16,2) NOT NULL DEFAULT 0,
  payout_batch_id uuid REFERENCES payments(id),                                  
  CONSTRAINT payroll_run_three_eyes_ck CHECK (
    (reviewed_by IS NULL OR reviewed_by <> run_by) AND
    (approved_by IS NULL OR (approved_by <> run_by AND approved_by IS DISTINCT FROM reviewed_by)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_run_one_regular_ux ON payroll_run(payroll_period_id) WHERE run_type = 'REGULAR' AND status <> 'CANCELLED';
--> statement-breakpoint
CREATE TABLE attendance_snapshot (                                              
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_run_id uuid NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id), org_unit_id uuid REFERENCES org_unit(id),     
  scheduled_days numeric(5,1) NOT NULL, worked_days numeric(5,1) NOT NULL, absent_days numeric(5,1) NOT NULL,
  paid_leave_days numeric(5,1) NOT NULL DEFAULT 0, unpaid_leave_days numeric(5,1) NOT NULL DEFAULT 0,
  late_minutes int NOT NULL DEFAULT 0, overtime_minutes_approved int NOT NULL DEFAULT 0,
  night_shifts int NOT NULL DEFAULT 0, weekend_shifts int NOT NULL DEFAULT 0, holiday_shifts int NOT NULL DEFAULT 0,
  UNIQUE (payroll_run_id, staff_id)
);
--> statement-breakpoint
CREATE TABLE payslip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payslip_no varchar(24) NOT NULL UNIQUE,
  payroll_run_id uuid NOT NULL REFERENCES payroll_run(id), staff_id uuid NOT NULL REFERENCES staff(id),
  status varchar(8) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PAID','FAILED')),
  basic_pay numeric(14,2) NOT NULL, gross_pay numeric(14,2) NOT NULL, taxable_income numeric(14,2) NOT NULL,
  paye numeric(14,2) NOT NULL DEFAULT 0, ssnit_employee numeric(14,2) NOT NULL DEFAULT 0, ssnit_employer numeric(14,2) NOT NULL DEFAULT 0,
  other_deductions numeric(14,2) NOT NULL DEFAULT 0, net_pay numeric(14,2) NOT NULL,
  payout_method varchar(6) NOT NULL, payout_account_masked varchar(40),
  payment_recipient_id uuid REFERENCES payment_recipients(id),
  UNIQUE (payroll_run_id, staff_id),
  CONSTRAINT payslip_net_ck CHECK (net_pay = gross_pay - paye - ssnit_employee - other_deductions)
);
--> statement-breakpoint
CREATE TABLE payslip_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payslip_id uuid NOT NULL REFERENCES payslip(id) ON DELETE CASCADE,
  pay_element_id uuid NOT NULL REFERENCES pay_element(id), description varchar(150) NOT NULL,       
  quantity numeric(10,3) NOT NULL DEFAULT 1, rate numeric(14,4), amount numeric(14,2) NOT NULL,
  line_type varchar(12) NOT NULL CHECK (line_type IN ('EARNING','DEDUCTION','STATUTORY','EMPLOYER')),
  source_type varchar(12) NOT NULL CHECK (source_type IN ('BASIC','STAFF_ELEMENT','ALLOWANCE_RULE','OVERTIME','LEAVE','ABSENCE','ADJUSTMENT')),
  source_ref uuid
);
--> statement-breakpoint

-- Source: 12-module-hr-payroll-reporting.md block#3 (V26)
CREATE FUNCTION facility_date(ts timestamptz) RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (ts AT TIME ZONE (SELECT timezone FROM facility_setup LIMIT 1))::date $$;
--> statement-breakpoint
CREATE TABLE report_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(40) NOT NULL UNIQUE, name varchar(150) NOT NULL,
  module varchar(20) NOT NULL, description varchar(500), query_ref varchar(80) NOT NULL,         
  parameters_schema jsonb NOT NULL DEFAULT '{}',
  allowed_roles text[] NOT NULL, export_formats text[] NOT NULL DEFAULT '{XLSX,CSV,PDF}',
  contains_personal_data boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE report_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES report_definition(id),
  requested_by text NOT NULL, purpose varchar(200), params jsonb NOT NULL DEFAULT '{}', format varchar(5) NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','READY','FAILED','EXPIRED')),
  requested_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  row_count bigint, file_attachment_id uuid, expires_at timestamptz, error varchar(500)
);
--> statement-breakpoint
CREATE TABLE kpi_snapshot (
  kpi_code varchar(40) NOT NULL, period_date date NOT NULL, org_unit_id uuid, value numeric(18,4), numerator numeric(18,4),
  denominator numeric(18,4), computed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX kpi_snapshot_ux ON kpi_snapshot(kpi_code, period_date, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'));
--> statement-breakpoint
CREATE TABLE dhims2_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_code varchar(40) NOT NULL, data_element_code varchar(60) NOT NULL,
  label varchar(200) NOT NULL, source_view varchar(60) NOT NULL, filter_expression varchar(500),
  disaggregation varchar(40), active boolean NOT NULL DEFAULT true, UNIQUE (dataset_code, data_element_code, disaggregation)
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS reporting;
--> statement-breakpoint
CREATE MATERIALIZED VIEW reporting.mv_bed_occupancy_daily AS
WITH days AS (SELECT gs::date AS census_date FROM generate_series(current_date - 730, current_date, interval '1 day') gs),
     tz   AS (SELECT timezone FROM facility_setup LIMIT 1)
SELECT d.census_date, b.org_unit_id,
       count(DISTINCT b.id) FILTER (WHERE b.active) AS beds_available,
       count(ba.id)                                 AS beds_occupied_midnight
FROM days d
CROSS JOIN tz
CROSS JOIN bed b
LEFT JOIN bed_assignment ba
  ON ba.bed_id = b.id
 AND ba.assigned_from <  ((d.census_date + 1)::timestamp AT TIME ZONE tz.timezone)
 AND (ba.assigned_to IS NULL OR ba.assigned_to >= ((d.census_date + 1)::timestamp AT TIME ZONE tz.timezone))
GROUP BY d.census_date, b.org_unit_id;
--> statement-breakpoint
CREATE UNIQUE INDEX ON reporting.mv_bed_occupancy_daily(census_date, org_unit_id);
--> statement-breakpoint

-- Source: 06-security-privacy-compliance.md block#2 (V27)
CREATE TABLE data_subject_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_no varchar(20) NOT NULL UNIQUE,
  subject_type varchar(8) NOT NULL CHECK (subject_type IN ('PATIENT','STAFF')), subject_id uuid NOT NULL,
  request_type varchar(14) NOT NULL CHECK (request_type IN
    ('ACCESS','RECTIFICATION','OBJECTION','RESTRICTION','ERASURE','PORTABILITY')),
  status varchar(12) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN
    ('RECEIVED','VERIFYING','IN_PROGRESS','FULFILLED','REJECTED','WITHDRAWN')),
  received_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL,
  identity_verified_by text, identity_verified_at timestamptz, handled_by text,
  outcome varchar(10) CHECK (outcome IN ('FULFILLED','RESTRICTED','PARTIAL','REJECTED')),
  outcome_note text, response_attachment_id uuid, closed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX data_subject_request_open_ix ON data_subject_request(due_at) WHERE status NOT IN ('FULFILLED','REJECTED','WITHDRAWN');
--> statement-breakpoint
CREATE TABLE retention_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_class varchar(40) NOT NULL UNIQUE,   
  retention_months int NOT NULL CHECK (retention_months > 0),
  auto_dispose boolean NOT NULL DEFAULT false,                                           
  disposal_action varchar(10) NOT NULL DEFAULT 'ARCHIVE' CHECK (disposal_action IN ('ARCHIVE','ANONYMISE','DELETE')),
  approved_by text, approved_at timestamptz, note varchar(300)
);
--> statement-breakpoint
CREATE TABLE retention_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES retention_policy(id),
  run_at timestamptz NOT NULL DEFAULT now(), dry_run boolean NOT NULL DEFAULT true,
  candidates int NOT NULL DEFAULT 0, processed int NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','FAILED')),
  report_attachment_id uuid, run_by text
);
--> statement-breakpoint
