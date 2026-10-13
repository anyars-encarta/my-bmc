# 09 — Workforce Module Specification

Organization, staff (clinical / non-clinical), shift types, duty rosters, attendance (fingerprint & ID-card), unit/ward assignment and re-shuffling.
This document is the **authoritative specification** for the workforce domain; platform-wide topics it used to repeat now live in
[00](00-context-and-decisions.md) (decisions), [01](01-architecture-and-setup.md) (stack, layout, events, config), [03](03-api-contract.md) (API conventions),
[06](06-security-privacy-compliance.md) (security/privacy) and [07](07-testing-quality-cicd.md) (testing, jobs). Sprint mapping: Sprints 2–6 in [05](05-sprint-plan.md).

> **Migration numbering note.** Flyway versions follow [02](02-data-model.md) §8 (sprint order): `V4 org_unit`, `V5 shift_type`, `V6 staff_extension`, `V7 staff_assignment`,
> `V8 roster`, `V9 attendance`. DDL below is annotated accordingly. **Name every constraint** (`<table>_<what>_<pk|fk|uq|ck|ex>`, [02](02-data-model.md) §1) when implementing —
> the unnamed ones below are shown that way for brevity.

---

## 1. Goals and Scope

| # | Requirement | Section |
|---|-------------|---------|
| R1 | Two staff categories (clinical / non-clinical) with different working-time rules | §5, §6 |
| R2 | Daily clock-in/out by fingerprint **or** ID card (QR / barcode scanner) | §7 |
| R3 | Assignment of staff to units / departments / wards, with re-shuffling | §8 |

The rest of the hospital domain (patients, OPD, wards, nursing, pharmacy, lab/radiology, billing, insurance, inventory, leave, payroll, reporting) is specified in
[10](10-module-clinical.md)–[12](12-module-hr-payroll-reporting.md). Attendance and leave feed payroll ([12](12-module-hr-payroll-reporting.md) §2); rosters feed appointment slots
([10](10-module-clinical.md) §2.3) and nurse allocation ([10](10-module-clinical.md) §4).

### 1.1 Working-time rules (from the requirements)

| Staff group | Schedule | Days | Shift(s) |
|-------------|----------|------|----------|
| Non-clinical (all) | Standard day | Mon–Fri only | `STD` 07:00–16:00 |
| Clinical — standard-hours (some) | Standard day | All 7 days, off days set by duty roster | `STD` 07:00–16:00 |
| Clinical — shift workers (majority) | Rostered | All 7 days, off days set by duty roster | `MORNING` 07:00–14:00, `AFTERNOON` 14:00–20:00, `NIGHT` 20:00–07:00 (+1 day) |

Consequences that drive the design:

1. **Every clinical staff member is rostered**, including the standard-hours ones; only the shift type differs. Non-clinical staff are *never* rostered for weekends/holidays.
2. **The Night shift crosses midnight.** A shift instance belongs to the *date it starts*; the clock-out lands on the next calendar day.
3. **Shifts touch each other** (07:00 Night-out vs Morning-in, 14:00, 20:00). The punch-to-shift matching algorithm must therefore be driven by *open attendance state*, not by time-of-day alone (§7.4).
4. "Off day" is not a stored state for clinical staff; it is the absence of a published roster entry for that staff and date.

---

## 2. Technology Baseline

See [01](01-architecture-and-setup.md) §8 (Maven dependencies) and [00](00-context-and-decisions.md) §2 (ADRs). Workforce-specific notes:

- **PostgreSQL ≥ 15** with `btree_gist` — exclusion constraints on `roster_entry`, `roster_period`, `staff_assignment` double as the overlap guards and indexes.
- **ShedLock + `@Scheduled`** for `FixedScheduleMaterializer`, `AutoCloseJob`, `AbsenceDetectionJob`, `DeviceHealthJob`, `PunchRetryJob` ([07](07-testing-quality-cicd.md) §5).
- **Spring Modulith events** (`StaffTransferred`, `RosterEntryChanged`, `PunchAccepted`, `AttendanceClosed`, `LeaveApproved`) — see [01](01-architecture-and-setup.md) §4.
- **One `Clock` + one `ZoneId`** (facility zone) for every business-date and shift computation (ADR-009); never `ZoneId.systemDefault()`.

---

## 3. Migration from the Current Codebase

The existing `staff` table and `/api/staff` routes are **extended and ported**, not recreated ([00](00-context-and-decisions.md) §1, ADR-001/002/015; [02](02-data-model.md) §8; Sprint 2 story S2-4):

1. `V1__baseline` adopts the live schema; Flyway owns it from then on.
2. `V6__staff_extension` adds category/mode/role/badge/user link to the existing `staff` rows (defaults: `NON_CLINICAL`, `FIXED_WEEKDAY`, default shift `STD`) — HR then reclassifies clinical staff.
3. The free-text `staff.department` becomes `org_unit` rows and `INITIAL` `staff_assignment` rows through a Java migration with a **dry-run report** (unmapped values listed for HR); the column is dropped one release later (expand → contract).
4. `momo_number/momo_name` stay on `staff` until `staff_compensation` takes over in Sprint 18.
5. Existing login accounts are linked through `staff.user_id` where emails match (reviewed manually).

---

## 4. Module Architecture

Packages `organization`, `workforce`, `scheduling`, `attendance` follow the module template in [01](01-architecture-and-setup.md) §1; dependency rules in §3 there
(`attendance ─► scheduling ─► workforce ─► organization`; `payroll`, `appointment`, `nursing`, `leave` consume workforce APIs/events).
The event catalogue is in [01](01-architecture-and-setup.md) §4; the workforce-owned events are:

| Event | Publisher | Consumers |
|-------|-----------|-----------|
| `StaffTransferred(staffId, fromUnit, toUnit, effectiveFrom)` | workforce | scheduling (re-point future roster entries) |
| `StaffDeactivated(staffId, effectiveDate)` | workforce | scheduling (cancel future entries), identity |
| `RosterPublished(periodId)` / `RosterEntryChanged(entryId)` | scheduling | notification / attendance, appointment (slots) |
| `PunchAccepted(punchId)` | attendance | attendance processor |
| `AttendanceClosed(recordId)` | attendance | leave (overtime suggestions), payroll, reporting |

---

## 5. Data Model — Workforce Foundations

PostgreSQL DDL for Flyway, in the order shown. Conventions: `uuid` PKs with `gen_random_uuid()`, `timestamptz` for instants, `created_at/updated_at/created_by/updated_by` on every table (omitted below for brevity), enum-like columns as `varchar` + `CHECK` (mapped with `@Enumerated(EnumType.STRING)`).

### 5.1 Facility timezone

`V3__facility_settings` (see [02](02-data-model.md) §4.5) adds `facility_setup.timezone` (set to `Africa/Accra` for this deployment), currency, locale and the
`btree_gist` extension is created in `V2__platform`. Every shift/business-date calculation reads the zone from there.

### 5.2 Organisation hierarchy (R3)

Replaces the free-text `staff.department`.

```sql
-- V4__org_unit.sql
CREATE TABLE org_unit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid REFERENCES org_unit(id),
  code         varchar(30)  NOT NULL UNIQUE,
  name         varchar(150) NOT NULL,
  unit_type    varchar(20)  NOT NULL
               CHECK (unit_type IN ('DIVISION','DEPARTMENT','UNIT','WARD','CLINIC','THEATRE','SERVICE_POINT')),
  is_clinical  boolean NOT NULL,
  operates_24h boolean NOT NULL DEFAULT false,  -- wards/emergency: all three shifts must be covered
  active       boolean NOT NULL DEFAULT true,
  head_staff_id uuid                            -- FK added in V6 once staff is extended
);
CREATE INDEX org_unit_parent_idx ON org_unit(parent_id);
```

Example tree: `Hospital → Nursing Services (DEPARTMENT) → Male Medical Ward (WARD)`; `Hospital → Finance (DEPARTMENT) → Accounts (UNIT)`.

### 5.3 Shift types (R1)

```sql
-- V5__shift_type.sql
CREATE TABLE shift_type (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(20) NOT NULL UNIQUE,
  name           varchar(60) NOT NULL,
  category       varchar(12) NOT NULL CHECK (category IN ('STANDARD','MORNING','AFTERNOON','NIGHT')),
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  crosses_midnight boolean GENERATED ALWAYS AS (end_time <= start_time) STORED,
  break_minutes  int NOT NULL DEFAULT 0,
  early_in_minutes   int NOT NULL DEFAULT 60,   -- earliest accepted clock-in before start
  late_out_minutes   int NOT NULL DEFAULT 120,  -- latest accepted clock-out after end (handover/overtime)
  grace_late_minutes int NOT NULL DEFAULT 15,   -- lateness tolerance
  active         boolean NOT NULL DEFAULT true
);

INSERT INTO shift_type (code, name, category, start_time, end_time, break_minutes) VALUES
 ('STD',       'Standard Day', 'STANDARD',  '07:00', '16:00', 60),
 ('MORNING',   'Morning',      'MORNING',   '07:00', '14:00', 0),
 ('AFTERNOON', 'Afternoon',    'AFTERNOON', '14:00', '20:00', 0),
 ('NIGHT',     'Night',        'NIGHT',     '20:00', '07:00', 0);
```

Times are **facility-local wall-clock**; instants are computed per roster date (DST-safe if the zone has any).

### 5.4 Staff extension (R1)

```sql
-- V6__staff_extension.sql
ALTER TABLE staff
  ADD COLUMN staff_category varchar(12) NOT NULL DEFAULT 'NON_CLINICAL'
        CHECK (staff_category IN ('CLINICAL','NON_CLINICAL')),
  ADD COLUMN schedule_mode  varchar(16) NOT NULL DEFAULT 'FIXED_WEEKDAY'
        CHECK (schedule_mode IN ('FIXED_WEEKDAY','ROSTERED')),
  ADD COLUMN default_shift_type_id uuid REFERENCES shift_type(id),
  ADD COLUMN job_role_id      uuid,                  -- FK added in §5.5
  ADD COLUMN badge_number     varchar(20),           -- PIN on fingerprint terminals / printed on ID card
  ADD COLUMN hire_date        date,
  ADD COLUMN termination_date date,
  ADD COLUMN user_id          text UNIQUE REFERENCES "user"(id),   -- login account, optional
  ADD CONSTRAINT staff_nonclinical_fixed
        CHECK (staff_category = 'CLINICAL' OR schedule_mode = 'FIXED_WEEKDAY');

CREATE UNIQUE INDEX staff_badge_idx ON staff(badge_number) WHERE badge_number IS NOT NULL;

UPDATE staff SET default_shift_type_id = (SELECT id FROM shift_type WHERE code = 'STD');

ALTER TABLE org_unit ADD CONSTRAINT org_unit_head_fk FOREIGN KEY (head_staff_id) REFERENCES staff(id);

-- Data migration of the old free-text column (separate script): create org_unit rows from
-- DISTINCT staff.department, create INITIAL staff_assignment rows (§8), then drop the column in a later release.
```

Staff-type matrix, enforced by a `StaffScheduleRules` service validator as well as the `CHECK`:

| `staff_category` | `schedule_mode` | `default_shift_type` | Roster entries come from |
|------------------|-----------------|----------------------|--------------------------|
| `NON_CLINICAL` | `FIXED_WEEKDAY` | `STD` | Auto-generated Mon–Fri, skipping public holidays and approved leave |
| `CLINICAL` | `ROSTERED` | `STD` (standard-hours clinical) or a shift type | Manual / template roster, all 7 days, off days chosen by the roster officer |
| `CLINICAL` | `FIXED_WEEKDAY` | `STD` | Optional: clinical staff in admin-type roles who work weekdays only |

### 5.5 Job roles

```sql
CREATE TABLE job_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,           -- Medical Officer, Staff Nurse, Pharmacist, Accountant, Driver…
  staff_category varchar(12) NOT NULL CHECK (staff_category IN ('CLINICAL','NON_CLINICAL')),
  requires_license boolean NOT NULL DEFAULT false
);
ALTER TABLE staff ADD CONSTRAINT staff_job_role_fk FOREIGN KEY (job_role_id) REFERENCES job_role(id);
```

The job role's category must equal `staff.staff_category` (validated on save).

### 5.6 Professional licences

Clinical acts are authorised by an **active, unexpired licence** (ADR-004a); `LicenceExpiryJob` notifies at 90/30/7 days ([12](12-module-hr-payroll-reporting.md) §1.2). Part of `V6__staff_extension`:

```sql
CREATE TABLE staff_license (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  licensing_body varchar(10) NOT NULL CHECK (licensing_body IN ('MDC','NMC','PC','HPC','AHPC','OTHER')),  -- confirm council list with HR
  licence_no varchar(40) NOT NULL, issued_on date, expires_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','SUSPENDED','REVOKED')),
  attachment_id uuid, verified_by text, verified_at timestamptz,
  UNIQUE (licensing_body, licence_no)
);
CREATE INDEX staff_license_expiry_ix ON staff_license(expires_on) WHERE status = 'ACTIVE';
```

`LicenceApi.isValid(staffId, onDate, requiredBody)` is the single check used by encounter signing, prescribing, lab validation, MAR witnessing and dispensing verification.

---

## 6. Rostering & Fixed Schedules (R1, R3)

### 6.1 Tables

```sql
-- V8__roster.sql
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

CREATE TABLE roster_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_period_id uuid REFERENCES roster_period(id),     -- null for AUTO_FIXED entries
  staff_id      uuid NOT NULL REFERENCES staff(id),
  org_unit_id   uuid NOT NULL REFERENCES org_unit(id),    -- snapshot: where the staff was rostered that day
  roster_date   date NOT NULL,                            -- business date = date the shift STARTS
  shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  planned_start timestamptz NOT NULL,
  planned_end   timestamptz NOT NULL,
  source varchar(12) NOT NULL CHECK (source IN ('AUTO_FIXED','MANUAL','TEMPLATE','SWAP','COVER')),
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  version int NOT NULL DEFAULT 0,
  UNIQUE (staff_id, roster_date, shift_type_id),
  -- a person cannot be on two overlapping shifts
  EXCLUDE USING gist (staff_id WITH =, tstzrange(planned_start, planned_end) WITH &&)
          WHERE (status = 'ACTIVE')
);
CREATE INDEX roster_entry_unit_date_idx ON roster_entry(org_unit_id, roster_date);
CREATE INDEX roster_entry_staff_window  ON roster_entry(staff_id, planned_start, planned_end);

CREATE TABLE unit_staffing_requirement (          -- minimum coverage rules
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id   uuid NOT NULL REFERENCES org_unit(id),
  shift_type_id uuid NOT NULL REFERENCES shift_type(id),
  job_role_id   uuid REFERENCES job_role(id),
  min_staff int NOT NULL CHECK (min_staff >= 0),
  UNIQUE NULLS NOT DISTINCT (org_unit_id, shift_type_id, job_role_id)   -- PostgreSQL 15+
);

CREATE TABLE shift_swap_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_entry_id    uuid NOT NULL REFERENCES roster_entry(id),
  counterparty_entry_id uuid REFERENCES roster_entry(id),
  status varchar(12) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','ACCEPTED','APPROVED','REJECTED','CANCELLED')),
  reason text, decided_by text, decided_at timestamptz
);

CREATE TABLE public_holiday (
  holiday_date date PRIMARY KEY,
  name varchar(100) NOT NULL
);
```

The `roster_entry` exclusion constraint is the safety net; the application validator (§6.3) produces friendly messages before the DB rejects.

### 6.2 Materialising schedules for `FIXED_WEEKDAY` staff

Non-clinical staff have no hand-built roster. A nightly job keeps a **rolling 60-day window** of `AUTO_FIXED` entries so attendance logic treats every staff member uniformly.

```java
@Component
@RequiredArgsConstructor
class FixedScheduleMaterializer {

    private final StaffApi staffApi;                 // workforce public API
    private final AssignmentApi assignmentApi;
    private final PublicHolidayRepository holidays;
    private final LeaveApi leaveApi;                 // approved leave (no-op stub until the leave module exists)
    private final RosterEntryRepository rosterRepo;
    private final ShiftTypeRepository shiftTypes;
    private final ZoneId facilityZone;
    private final Clock clock;

    @Scheduled(cron = "0 15 1 * * *", zone = "${hams.facility-zone}")
    @SchedulerLock(name = "materializeFixedSchedules", lockAtMostFor = "PT30M")
    public void nightly() {
        LocalDate from = LocalDate.now(clock);
        materialize(from, from.plusDays(60));
    }

    /** Idempotent: also called after a transfer, hire, or holiday change. */
    @Transactional
    public void materialize(LocalDate from, LocalDate to) {
        Set<LocalDate> holidayDates = holidays.datesBetween(from, to);
        for (var staff : staffApi.activeFixedWeekday()) {
            ShiftType shift = shiftTypes.getById(staff.defaultShiftTypeId());
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                boolean weekend = d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY;
                boolean beforeHire = staff.hireDate() != null && d.isBefore(staff.hireDate());
                if (weekend || beforeHire || holidayDates.contains(d) || leaveApi.isOnLeave(staff.id(), d)) {
                    rosterRepo.cancelAutoFixed(staff.id(), d);       // remove if conditions changed
                    continue;
                }
                assignmentApi.effectiveUnit(staff.id(), d).ifPresent(unit ->
                    rosterRepo.upsertAutoFixed(staff.id(), unit.id(), d, shift,
                        ShiftTimes.start(d, shift, facilityZone),
                        ShiftTimes.end(d, shift, facilityZone)));
            }
        }
    }
}
```

The only place that converts wall-clock shift times to instants:

```java
final class ShiftTimes {
    static Instant start(LocalDate date, ShiftType s, ZoneId zone) {
        return date.atTime(s.startTime()).atZone(zone).toInstant();
    }
    static Instant end(LocalDate date, ShiftType s, ZoneId zone) {
        LocalDate endDate = s.crossesMidnight() ? date.plusDays(1) : date;
        return endDate.atTime(s.endTime()).atZone(zone).toInstant();
    }
}
```

### 6.3 Roster validation rules (on save and on publish)

| Rule | Default | Level |
|------|---------|-------|
| Non-clinical staff cannot be placed on Sat/Sun/public holiday | enforced | error |
| Staff must have an effective assignment to the roster's unit for that date (or an approved COVER) | enforced | error |
| No overlapping shifts per staff | enforced (DB + app) | error |
| Minimum rest between consecutive shifts | 11 h (blocks Night → Morning next day) | error, overridable by HR (e.g., deliberate double shift) |
| Max consecutive working days | 6 | warning |
| Max consecutive night shifts | 5 | warning |
| Max weekly hours | 48 | warning |
| Coverage per `unit_staffing_requirement` | per unit | warning on draft; blocking on publish if configured |
| `operates_24h` units: ≥1 staff on each of the three shifts every day | enforced on publish | error |

Implement as a chain of `RosterRule` beans returning `Violation(level, code, message, staffId, date)`; the API returns all violations so the grid UI can highlight cells.

### 6.4 Roster workflow

`DRAFT` (roster officer edits; copy previous period / apply weekly template) → `PUBLISHED` (staff notified; edits create change-log entries; swaps need approval) → `LOCKED` (after payroll close; changes only via attendance correction).

Changes to a published roster publish `RosterEntryChanged` so attendance can re-evaluate affected records.

### 6.5 REST API

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| GET | `/api/v1/shift-types` | List shift types | authenticated |
| POST/PATCH | `/api/v1/shift-types` | Maintain | HR_ADMIN |
| GET/POST | `/api/v1/roster-periods` | List / create period for a unit | ROSTER_OFFICER |
| GET | `/api/v1/roster-periods/{id}/grid` | Staff × date grid | UNIT_MANAGER, ROSTER_OFFICER |
| PUT | `/api/v1/roster-periods/{id}/entries` | Bulk upsert entries (returns violations) | ROSTER_OFFICER |
| POST | `/api/v1/roster-periods/{id}/validate` | Dry-run validation | ROSTER_OFFICER |
| POST | `/api/v1/roster-periods/{id}/publish` | Publish | UNIT_MANAGER |
| GET | `/api/v1/staff/{id}/schedule?from=&to=` | A person's schedule | self / UNIT_MANAGER |
| GET | `/api/v1/me/schedule` | Self-service | STAFF |
| POST | `/api/v1/shift-swaps`, `/{id}/accept`, `/{id}/approve` | Swaps | STAFF / UNIT_MANAGER |
| CRUD | `/api/v1/public-holidays` | Holidays | HR_ADMIN |

---

## 7. Attendance — Clock-In / Clock-Out (R2)

### 7.1 Principles

1. **Raw punches are immutable** (`punch_log`); processed attendance (`attendance_record`) is derived and re-derivable.
2. Devices only *report identity + time*. All interpretation (in vs out, which shift) happens server-side.
3. Ingestion is **idempotent** and **offline-tolerant** (terminals buffer punches and upload later).
4. Corrections never overwrite; they create an audited `attendance_correction`.

### 7.2 Supported capture methods

| Method | Hardware | How identity reaches HAMS |
|--------|----------|---------------------------|
| Fingerprint | Network terminals (ZKTeco, Suprema, Hikvision, …) | Terminal matches the template **on-device** and reports the staff `badge_number` (device PIN) + timestamp. HAMS never needs fingerprint images/templates. Integrate via the vendor's push protocol or a small on-prem gateway that forwards to the REST endpoint (§7.6). |
| ID card — QR | Wall/kiosk QR scanners, or a browser kiosk using the camera | Scanner emits the QR payload (credential token) |
| ID card — Barcode | USB/serial scanners (keyboard-wedge) | Scanner emits the barcode string (credential token) |

### 7.3 Tables

```sql
-- V9__attendance.sql
CREATE TABLE staff_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  credential_type varchar(12) NOT NULL CHECK (credential_type IN ('FINGERPRINT','CARD_QR','CARD_BARCODE')),
  credential_ref  varchar(120) NOT NULL,   -- FINGERPRINT: badge PIN; cards: opaque random token (NOT the employee id)
  card_version int NOT NULL DEFAULT 1,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','LOST','EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz, revoked_at timestamptz, revoked_reason text
);
CREATE UNIQUE INDEX staff_credential_active_uq
  ON staff_credential(credential_type, credential_ref) WHERE status = 'ACTIVE';

CREATE TABLE attendance_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  device_type varchar(24) NOT NULL
     CHECK (device_type IN ('FINGERPRINT_TERMINAL','QR_SCANNER','BARCODE_SCANNER','KIOSK')),
  vendor varchar(50), model varchar(50), serial_number varchar(80),
  org_unit_id uuid REFERENCES org_unit(id),           -- physical location
  api_key_hash varchar(100) NOT NULL,                 -- bcrypt/argon2 hash of the device key
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  last_seen_at timestamptz, last_clock_skew_seconds int
);

CREATE TABLE punch_log (                               -- append-only
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES attendance_device(id),
  device_event_id varchar(80) NOT NULL,                -- idempotency key from the device
  credential_type varchar(12) NOT NULL,
  credential_ref  varchar(120) NOT NULL,
  staff_id uuid REFERENCES staff(id),                  -- null if unresolved
  punched_at  timestamptz NOT NULL,                    -- device time
  received_at timestamptz NOT NULL DEFAULT now(),
  direction_hint varchar(6) NOT NULL DEFAULT 'AUTO' CHECK (direction_hint IN ('IN','OUT','AUTO')),
  verify_mode varchar(20), raw_payload jsonb,
  result varchar(32) NOT NULL DEFAULT 'RECEIVED',
  processed boolean NOT NULL DEFAULT false,
  UNIQUE (device_id, device_event_id)
);
CREATE INDEX punch_log_staff_time_idx ON punch_log(staff_id, punched_at);
CREATE INDEX punch_log_unprocessed_idx ON punch_log(received_at) WHERE processed = false;

CREATE TABLE attendance_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  roster_entry_id uuid REFERENCES roster_entry(id),    -- null = unrostered punch
  attendance_date date NOT NULL,                       -- business date (shift start date)
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
CREATE UNIQUE INDEX attendance_one_open_per_staff ON attendance_record(staff_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX attendance_one_per_roster_entry ON attendance_record(roster_entry_id) WHERE roster_entry_id IS NOT NULL;
CREATE INDEX attendance_date_idx ON attendance_record(attendance_date, org_unit_id);

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

CREATE TABLE attendance_correction (                   -- audit of manual changes
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid NOT NULL REFERENCES attendance_record(id),
  old_clock_in timestamptz, old_clock_out timestamptz,
  new_clock_in timestamptz, new_clock_out timestamptz,
  reason text NOT NULL, requested_by text NOT NULL, approved_by text, approved_at timestamptz
);
```

### 7.4 Punch processing algorithm

The core problem: a punch at **07:00** can be a Night clock-out, a Morning/Standard clock-in, or both (likewise 14:00 and 20:00). Rule: **open state wins**.

```
processPunch(p):
  1. staff = resolveStaff(p.credential)     -- reject UNKNOWN_CREDENTIAL / inactive staff / revoked or expired card
  2. debounce: if the staff has another punch < 60 s earlier -> DUPLICATE (ignored)
  3. open = attendance_record where staff_id = ? and status = OPEN
  4. if open exists:
        deadline = open.planned_end + shift.late_out_minutes    (unrostered: open.clock_in + 16 h)
        if p.time <= deadline:  CLOCK-OUT -> close(open, p)
        else:                   open.status = AUTO_CLOSED (clock_out = planned_end), raise MISSING_CLOCK_OUT,
                                then treat p as a CLOCK-IN (step 5)
  5. CLOCK-IN:
        entry = nearest ACTIVE roster_entry of the staff, not yet used, where
                planned_start - early_in <= p.time <= planned_end   (closest planned_start wins)
        entry found  -> attendance_record(entry, attendance_date = entry.roster_date, org_unit = entry.org_unit)
        none         -> unrostered record (org_unit = effective assignment on that date),
                        raise UNROSTERED_PUNCH   -- legitimate for emergency cover; needs supervisor confirmation
```

Metrics:

```
late_minutes        = max(0, clock_in  - (planned_start + grace_late))     -- 0 if unrostered
early_leave_minutes = max(0, planned_end - clock_out)
worked_minutes      = (min(clock_out, planned_end + approved_overtime) - max(clock_in, planned_start)) - break_minutes
overtime_minutes    = max(0, clock_out - planned_end)    -- payable only when an overtime approval exists
```

Business date is always `entry.roster_date`: a Night clock-out at 06:55 on Tuesday is stored against **Monday's** record, which is what rosters and payroll expect.

Service sketch (one transaction per punch; row lock on the staff to serialise simultaneous punches from two terminals):

```java
@Service
@RequiredArgsConstructor
class PunchProcessor {

    private final PunchLogRepository punches;
    private final AttendanceRecordRepository records;
    private final RosterApi roster;
    private final CredentialResolver credentials;
    private final AttendanceExceptionService exceptions;
    private final AssignmentApi assignments;
    private final ZoneId facilityZone;

    @Transactional
    public void process(UUID punchId) {
        PunchLog p = punches.findByIdForUpdate(punchId).orElseThrow();
        if (p.isProcessed()) return;

        Optional<Staff> maybeStaff = credentials.resolve(p.getCredentialType(), p.getCredentialRef());
        if (maybeStaff.isEmpty()) { reject(p, PunchResult.UNKNOWN_CREDENTIAL); return; }
        Staff staff = maybeStaff.get();
        if (!staff.isActive()) { reject(p, PunchResult.INACTIVE_STAFF); return; }
        p.assignStaff(staff.id());

        records.lockStaff(staff.id());                      // SELECT ... FOR UPDATE on the staff row
        if (punches.existsWithin(staff.id(), p.getPunchedAt().minusSeconds(60), p.getId())) {
            reject(p, PunchResult.DUPLICATE); return;
        }

        Instant t = p.getPunchedAt();
        Optional<AttendanceRecord> open = records.findOpen(staff.id());
        if (open.isPresent()) {
            AttendanceRecord rec = open.get();
            if (!t.isAfter(rec.clockOutDeadline())) { rec.close(p, t); accept(p, PunchResult.CLOCK_OUT); return; }
            rec.autoClose(exceptions);                      // flags MISSING_CLOCK_OUT
        }
        clockIn(staff, p, t);
    }

    private void clockIn(Staff staff, PunchLog p, Instant t) {
        AttendanceRecord rec = roster.findEntryForClockIn(staff.id(), t)
            .map(e -> AttendanceRecord.rostered(staff, e, p, t))
            .orElseGet(() -> {
                LocalDate d = t.atZone(facilityZone).toLocalDate();
                UUID unit = assignments.effectiveUnit(staff.id(), d).map(UnitRef::id).orElse(null);
                exceptions.unrosteredPunch(staff.id(), d);
                return AttendanceRecord.unrostered(staff, unit, d, p, t);
            });
        records.save(rec);
        accept(p, PunchResult.CLOCK_IN);
    }
}
```

`findEntryForClockIn` native query:

```sql
SELECT re.* FROM roster_entry re JOIN shift_type st ON st.id = re.shift_type_id
WHERE re.staff_id = :staffId AND re.status = 'ACTIVE'
  AND :t >= re.planned_start - make_interval(mins => st.early_in_minutes)
  AND :t <= re.planned_end
  AND NOT EXISTS (SELECT 1 FROM attendance_record ar WHERE ar.roster_entry_id = re.id)
ORDER BY abs(extract(epoch FROM (re.planned_start - :t))) LIMIT 1
```

### 7.5 Scheduled jobs (all ShedLock-guarded)

| Job | Cadence | Action |
|-----|---------|--------|
| `PunchRetryJob` | 1 min | Process `punch_log.processed = false` (covers async failures) |
| `AutoCloseJob` | 15 min | Close `OPEN` records past `planned_end + late_out`; raise `MISSING_CLOCK_OUT` |
| `AbsenceDetectionJob` | 15 min | Roster entries past `planned_end + late_out` with no attendance record and no approved leave → `ABSENT` exception |
| `DeviceHealthJob` | 5 min | Alert if an ACTIVE device has not been seen in 15 min |
| `FixedScheduleMaterializer` | nightly | §6.2 |

### 7.6 Device ingestion API

Device authentication: `X-Device-Code` + `X-Device-Key` headers (hashed lookup) over TLS; optionally mTLS for fixed terminals. Devices are **not** users: give them a separate `SecurityFilterChain` matching `/api/v1/device/**` with a `DEVICE` authority and rate limiting.

```http
POST /api/v1/device/punches
X-Device-Code: FP-WARD-A1
X-Device-Key: ********

{
  "punches": [
    {
      "deviceEventId": "000123456",
      "credentialType": "FINGERPRINT",
      "credentialRef": "10432",
      "punchedAt": "2026-10-12T06:58:41Z",
      "directionHint": "AUTO"
    }
  ]
}
```

`credentialType` ∈ `FINGERPRINT | CARD_QR | CARD_BARCODE`; `credentialRef` is the badge PIN or the card token.

Response: per-item results (`ACCEPTED`, `DUPLICATE`, `UNKNOWN_CREDENTIAL`, `REJECTED_FUTURE_TIME`) so the device can drop confirmed items from its buffer. Idempotency is guaranteed by `UNIQUE (device_id, device_event_id)`.

Flow: validate → skew check (`punchedAt` vs `receivedAt` difference > 5 min records `DEVICE_CLOCK_SKEW` but is **accepted**, since offline buffering is legitimate; punches more than 5 min in the future are rejected) → insert `punch_log` → publish `PunchAccepted` → return. Processing runs in the event listener/retry job so a slow DB never blocks the terminal.

Vendor integration sits behind a strategy so pull-style devices are supported too:

```java
interface DeviceAdapter {
    boolean supports(AttendanceDevice device);
    List<RawPunch> pull(AttendanceDevice device, Instant since);   // push-style devices call the REST endpoint instead
}
```

Other endpoints:

| Method | Path | Purpose | Role |
|--------|------|---------|------|
| POST | `/api/v1/device/punches` | Device upload | DEVICE |
| GET/POST/PATCH | `/api/v1/devices` | Register / rotate key / disable | HR_ADMIN |
| POST | `/api/v1/staff/{id}/credentials` | Issue card (generate token; QR/barcode image for ID printing) | HR_ADMIN |
| POST | `/api/v1/staff/{id}/credentials/{cid}/revoke` | Lost/stolen; re-issue bumps `card_version` | HR_ADMIN |
| POST | `/api/v1/staff/{id}/fingerprint-enrolment` | Records that the badge PIN is enrolled (template stays on terminals) | HR_ADMIN |
| GET | `/api/v1/attendance?unitId=&from=&to=&staffId=` | Attendance log | UNIT_MANAGER, HR |
| GET | `/api/v1/me/attendance` | Own history | STAFF |
| GET | `/api/v1/attendance/exceptions?status=OPEN` | Exception queue | UNIT_MANAGER |
| POST | `/api/v1/attendance/exceptions/{id}/resolve` | Excuse / confirm / correct | UNIT_MANAGER |
| POST | `/api/v1/attendance/{id}/corrections` | Request correction (two-step approval) | UNIT_MANAGER → HR_ADMIN |
| GET | `/api/v1/attendance/summary?month=` | Monthly summary per staff (late, absent, hours, overtime) | HR, ACCOUNTS |
| POST | `/api/v1/attendance/manual-punch` | When a device is down (reason mandatory, audited, approval required) | UNIT_MANAGER |

### 7.7 Security and integrity of attendance data

- **Card tokens are opaque and random** (≥128-bit), not the employee ID; the QR/barcode encodes only the token. A photographed QR can still be replayed, so prefer fingerprint at high-risk locations, apply the per-staff debounce, and optionally capture a kiosk camera snapshot for audit.
- **Biometric data is sensitive personal data.** Templates stay on the terminals; HAMS stores the badge PIN and enrolment metadata only. Obtain documented consent, define retention/deletion at termination, and follow the applicable local data-protection law.
- Device API keys: shown once, stored hashed, rotatable, instantly disableable.
- Every manual intervention (manual punch, correction, exception resolution) is audited with actor, reason and before/after values.
- Clock manipulation: `received_at` is always recorded, skew is flagged, terminals should sync via NTP.

### 7.8 Frontend (Refine/shadcn)

- **Kiosk page** `/kiosk` (no sidebar): auto-focused input for USB barcode/QR wedge scanners (they type the token + Enter), or camera scanning with a QR library (e.g., `html5-qrcode`); shows photo + name + "Clocked IN/OUT" for ~3 s. Authenticates as a registered `KIOSK` device.
- Resources: `attendance`, `attendance-exceptions`, `devices`, `rosters` (grid editor with shift chips and a violation panel), `shift-types`, `org-units` (tree), `staff` (extended with category, job role, credentials, assignment-history tabs).
- Self-service: "My schedule", "My attendance", "Request swap".

---

## 8. Unit / Department / Ward Assignment and Re-shuffling (R3)

### 8.1 Model

Assignments are **temporal**: history is never overwritten, so past attendance and payroll stay attributable to the unit where the person actually worked.

```sql
-- V7__staff_assignment.sql
CREATE TABLE transfer_batch (                          -- a reshuffle exercise (many moves at once)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(150) NOT NULL, effective_from date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','APPLIED','CANCELLED')),
  approved_by text, approved_at timestamptz
);

CREATE TABLE staff_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id),
  org_unit_id uuid NOT NULL REFERENCES org_unit(id),
  assignment_type varchar(10) NOT NULL CHECK (assignment_type IN ('PRIMARY','TEMPORARY','COVER')),
  effective_from date NOT NULL,
  effective_to   date,                                  -- null = open-ended
  reason varchar(30) NOT NULL DEFAULT 'INITIAL'
      CHECK (reason IN ('INITIAL','TRANSFER','RESHUFFLE','SECONDMENT','COVER','PROMOTION','RETURN')),
  note text, approved_by text, approved_at timestamptz,
  transfer_batch_id uuid REFERENCES transfer_batch(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- one PRIMARY assignment at a time per person
  EXCLUDE USING gist (staff_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
          WHERE (assignment_type = 'PRIMARY')
);
CREATE INDEX staff_assignment_unit_idx ON staff_assignment(org_unit_id, effective_from, effective_to);
```

**Effective unit on date D** = a `TEMPORARY`/`COVER` assignment covering D if one exists (latest `effective_from` wins), otherwise the `PRIMARY` one. A person can also appear in another unit's roster as a `COVER` entry without changing their primary assignment.

### 8.2 Transfer service

```java
@Service
@RequiredArgsConstructor
class AssignmentService implements AssignmentApi {

    private final StaffAssignmentRepository repo;
    private final ApplicationEventPublisher events;

    /** Move a person's PRIMARY assignment to a new unit from `effectiveFrom` (may be future-dated). */
    @Transactional
    @PreAuthorize("hasAnyRole('HR_ADMIN','SUPER_ADMIN')")
    public StaffAssignment transfer(UUID staffId, UUID toUnitId, LocalDate effectiveFrom,
                                    AssignmentReason reason, String note) {
        StaffAssignment current = repo.findPrimaryOn(staffId, effectiveFrom)
            .orElseThrow(() -> new BusinessRuleException("NO_CURRENT_ASSIGNMENT"));
        if (current.getOrgUnitId().equals(toUnitId)) {
            throw new BusinessRuleException("ALREADY_ASSIGNED_TO_UNIT");
        }
        if (!effectiveFrom.isAfter(current.getEffectiveFrom())) {
            throw new BusinessRuleException("EFFECTIVE_DATE_NOT_AFTER_CURRENT_ASSIGNMENT_START");
        }
        repo.deleteStartingAfter(staffId, effectiveFrom, AssignmentType.PRIMARY);   // supersede not-yet-started moves
        current.endOn(effectiveFrom.minusDays(1));
        StaffAssignment next = repo.save(StaffAssignment.primary(staffId, toUnitId, effectiveFrom, reason, note));

        events.publishEvent(new StaffTransferred(staffId, current.getOrgUnitId(), toUnitId, effectiveFrom));
        return next;
    }
}
```

Handler in `scheduling` (after commit, via Modulith's `@ApplicationModuleListener`):

```java
@ApplicationModuleListener
void on(StaffTransferred e) {
    // Re-point FUTURE roster entries only; history is untouched.
    rosterRepo.moveFutureEntries(e.staffId(), e.toUnit(), e.effectiveFrom());   // ACTIVE entries with roster_date >= effectiveFrom
    fixedScheduleMaterializer.materialize(e.effectiveFrom(), e.effectiveFrom().plusDays(60));
    // ROSTERED staff: entries are moved to the new unit; both units' roster officers get a coverage warning to review.
}
```

Re-shuffle scenarios:

| Scenario | Behaviour |
|----------|-----------|
| Permanent transfer (immediate or future-dated) | `transfer()`; future entries re-pointed; old unit gets a coverage warning |
| Mass reshuffle | `transfer_batch` with many pending assignments; HR approves; `apply` runs all `transfer()` calls in one transaction; `preview` reports coverage impact per unit/shift |
| Temporary secondment (e.g., 3 months) | `TEMPORARY` assignment with `effective_to`; reverts automatically, no manual step |
| One-off cover for a shift | `COVER` roster entry in another unit (assignment unchanged) |
| Move while a shift is in progress | Attendance keeps the `org_unit_id` of the roster entry it was clocked against |
| Category change (non-clinical ↔ clinical) | Dedicated operation: updates `staff_category`, `schedule_mode`, `job_role`, regenerates schedule; validated against the §5.4 matrix |

### 8.3 API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/org-units`, `/api/v1/org-units/tree` | Hierarchy |
| POST/PATCH | `/api/v1/org-units` | Maintain units (HR_ADMIN) |
| GET | `/api/v1/org-units/{id}/staff?on=YYYY-MM-DD` | Who is assigned on a date |
| GET | `/api/v1/staff/{id}/assignments` | Assignment history |
| POST | `/api/v1/staff/{id}/transfers` | `{toUnitId, effectiveFrom, reason, note}` |
| POST | `/api/v1/transfer-batches`, `/{id}/preview`, `/{id}/approve`, `/{id}/apply` | Reshuffle exercise |
| POST | `/api/v1/staff/{id}/assignments` | Temporary / cover assignment |

---

## 9. Security and Access Control

Role model and the full RBAC matrix: [06](06-security-privacy-compliance.md) §3. Workforce-relevant points:

| Role | Workforce capabilities |
|------|------------------------|
| `HR_MANAGER` | Staff, org units, shift types, credentials, devices, transfers, attendance-correction approval, public holidays |
| `UNIT_MANAGER` | Own unit subtree: publish roster, view attendance, resolve exceptions, request transfers, approve swaps |
| `ROSTER_OFFICER` | Edit draft rosters for assigned units |
| `PAYROLL_OFFICER` / `ACCOUNTS` | Read attendance summaries and compensation data (not rosters) |
| `STAFF` | Own schedule, attendance, swap requests |
| `SUPER_ADMIN` | Configuration and user administration only |
| `DEVICE` | **Not a user role**: only `/api/v1/device/**` (separate filter chain, API-key auth) |

**Unit-scoped authorisation:** a manager acts only on units where they are `head_staff_id` or have a `user_unit_scope` row (descendants in the org tree included).

```java
@Component("unitAccess")
class UnitAccessEvaluator {
    boolean canManage(Authentication auth, UUID unitId) { /* role check + scope check incl. descendants */ }
}

@PreAuthorize("hasRole('SUPER_ADMIN') or @unitAccess.canManage(authentication, #unitId)")
public RosterGrid grid(UUID unitId, UUID periodId) { ... }
```

Workforce data is **P2 Confidential**; biometric handling rules (templates stay on terminals, consent, card-only alternative) are in [06](06-security-privacy-compliance.md) §4.

---

## 10. Cross-Cutting Concerns

Error model, list queries, idempotency and conventions: [03](03-api-contract.md) §1–§5. Workforce specifics:

- **Concurrency:** optimistic locking (`@Version`) on `roster_entry` and `attendance_record`; pessimistic lock on the staff row during punch processing.
- **Idempotency:** device punches (unique key), roster publish, transfer-batch apply.
- **Config:** `hams.facility-zone`, `hams.attendance.debounce-seconds=60`, `hams.attendance.max-skew-minutes=5`, `hams.roster.min-rest-hours=11` ([01](01-architecture-and-setup.md) §7).
- **Metrics:** `punch.received`, `punch.rejected{reason}`, `attendance.open`, `exceptions.open`, `roster.violations` ([07](07-testing-quality-cicd.md) §4).

---

## 11. Testing Strategy

| Layer | Focus |
|-------|-------|
| Unit | `ShiftTimes` (incl. Night crossing midnight), metrics calculation, roster rules |
| Component (Testcontainers + real PostgreSQL) | Exclusion constraints, partial unique indexes, native window query, Flyway migration from baseline |
| Module tests (Spring Modulith) | Events (transfer → roster re-point); `ApplicationModules.verify()` for boundaries |
| API (MockMvc / REST-assured) | Security matrix per role, device auth, idempotent ingestion |
| Scenario tests | below |

Mandatory attendance scenarios (fixed `Clock`):

1. Non-clinical Mon 06:50 in, 16:05 out → on time, no exceptions. A Saturday punch → `UNROSTERED_PUNCH` (no auto entry exists for weekends).
2. Morning: in 06:55, out 14:03 → closed, 0 late.
3. Afternoon: in 14:20 → `late_minutes = 5` (15-min grace applied).
4. **Night**: Mon 19:50 in, Tue 07:04 out → one record dated **Monday**; a Tuesday Morning shift for the same person is rejected by the 11 h rest rule unless HR overrides.
5. Night worker forgets to clock out → `AutoCloseJob` closes at `planned_end` and raises `MISSING_CLOCK_OUT`; the next clock-in is not mistaken for a clock-out.
6. HR-approved double shift (Morning then Afternoon): the 14:00 punch closes Morning (open state wins); the next punch opens Afternoon.
7. Duplicate punch within 60 s from two terminals → one record.
8. Offline terminal uploads a buffered batch next morning, then replays it → no duplicates.
9. Revoked card rejected; re-issued card works.
10. Transfer effective next Monday: past attendance keeps old unit; future roster entries move; materializer regenerates non-clinical entries.
11. Clinical staff with no entry on a date → no `ABSENT`; a punch that day → `UNROSTERED_PUNCH`.

---

## 12. Where the rest of the hospital connects

| Module | Connection to workforce | Spec |
|--------|-------------------------|------|
| Appointments | Slots exist only when the provider has an ACTIVE roster entry | [10](10-module-clinical.md) §2.3 |
| Nursing | Allocation and handover tie to `roster_entry`; clock-out reminder for unsubmitted handover | [10](10-module-clinical.md) §4 |
| Leave | Approved leave cancels roster entries and excuses absence | [12](12-module-hr-payroll-reporting.md) §1 |
| Payroll | Attendance snapshot (scheduled vs worked, night/weekend/holiday shifts, approved overtime) drives allowances | [12](12-module-hr-payroll-reporting.md) §2 |
| Reporting | `mv_attendance_daily`, `mv_roster_coverage_daily` | [12](12-module-hr-payroll-reporting.md) §3 |

Interoperability (post-v1): `org_unit` ↔ FHIR `Location`/`Organization`, `staff` ↔ `Practitioner`.

---

## 13. Delivery of this module

Sprints 2–6 in [05](05-sprint-plan.md): organisation & staff (S2), assignments & transfers (S3), rostering (S4), attendance capture (S5), attendance operations + pilot (S6, **Release 1**).

**Definition of done:** all §11 scenarios pass in CI, and R1–R3 are demonstrable end-to-end — non-clinical weekday schedules generated automatically; clinical rosters with off days and all three shifts (Night across midnight); fingerprint and QR/barcode punches resolve to the correct shift and business date; a reshuffle moves a staff member and their future roster without altering history.

---

## 14. Open Questions

Tracked centrally as Q1–Q14 in [00](00-context-and-decisions.md) §6 — those that block this module: **Q2** (timezone & holidays), **Q3** (terminal vendor/protocol), **Q4** (are standard-hours clinical staff
rostered over 7 days — this design assumes yes), **Q5** (grace/early-arrival/overtime policy), **Q6** (double shifts & minimum rest), **Q7** (auth direction).
The data-protection regime for biometrics is covered in [06](06-security-privacy-compliance.md) §4.
