# 05 — Sprint Plan (Sprint 0 → Sprint 22)

2-week sprints (≈ 46 weeks). Points are relative (1, 2, 3, 5, 8, 13). Target velocity **40 pts**
(team: 2 backend, 1 frontend, 1 full-stack, 1 QA, 0.5 PO); each sprint is scoped to 38–42 pts with stated stretch items.
Calibrate after Sprint 2 and re-forecast; every release below is date-driven by *measured* velocity, not by this table.

**Components:** `BE` backend · `FE` frontend · `FS` full-stack · `OPS` DevOps/security · `QA` quality · `PO` product/clinical/analysis.

## Definition of Ready

A story may enter a sprint only when it has: a user-facing description, acceptance criteria, the affected API endpoints and tables named
([03](03-api-contract.md), [02](02-data-model.md)), role/permission impact ([06](06-security-privacy-compliance.md) §3), **privacy impact**
(does it touch P3–P5 data?), **clinical-safety impact** (does it change a clinical rule or a hazard-log item?), and a testable demo path.

## Definition of Done

- [ ] Code merged to `main` via reviewed PR (2 reviewers for money, security, migrations), Conventional Commit, story ID linked
- [ ] `@PreAuthorize` on every new endpoint; Bean Validation on every DTO; role-aware serializer for any new patient/staff/payroll data
- [ ] Unit tests for domain logic; API tests for each endpoint (happy path + **401 + 403 per role** + 404/409/422); Testcontainers tests for every constraint and native query
- [ ] Money/stock/time logic covered by property or golden-file tests; fixed `Clock` used in time-dependent tests
- [ ] Flyway migration reviewed by a second engineer, tested from baseline **and** on a populated snapshot, forward-fix note in the PR
- [ ] `ApplicationModules.verify()` + ArchUnit green; no cross-module `internal` access
- [ ] Audit entries emitted for create/update/transition/override/export of personal, clinical, financial or HR data
- [ ] OpenAPI regenerated and committed; `frontend/src/types/api.d.ts` regenerated
- [ ] Frontend: component test for the primary interaction; axe clean; works with keyboard only
- [ ] Hazard log updated for clinical stories; clinical lead sign-off where a rule changed
- [ ] `.env.example`, docs ([00](00-context-and-decisions.md)–[12](12-module-hr-payroll-reporting.md)) updated if config or contract changed
- [ ] Deployed to staging and accepted by the PO against the acceptance criteria
- [ ] No new high/critical findings in dependency-check / CodeQL / secret scan

---

# Sprint 0 — Foundation & Spring skeleton
**Goal:** the repo, environments, pipelines and decision record are in place; the team can ship on day one of Sprint 1.
**Entry criteria:** hosting/registry accounts available; access to the Neon/production DB (read-only) for the baseline; named product owner and clinical lead.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S0-1 | `backend-spring/` skeleton: Boot 3, Java 21, Maven wrapper, Modulith, module package template ([01](01-architecture-and-setup.md) §1), Dockerfile, docker-compose (Postgres 16, Mailpit, WireMock), `.env.example`, README | 5 | BE |
| S0-2 | Requirements and policy workshop: resolve Q1–Q14 in [00](00-context-and-decisions.md) §6 (timezone, shift policy, cash policy, NHIA, payroll scope, hosting), privacy-policy text, role list | 5 | PO |
| S0-3 | Flyway `V1__baseline.sql` from the current Drizzle schema, verified against a copy of the live DB (`baseline-on-migrate`), Drizzle migrations frozen | 5 | BE |
| S0-4 | CI for `backend-spring` ([07](07-testing-quality-cicd.md) §3): spotless, tests (Testcontainers), Modulith/ArchUnit, OpenAPI drift, SBOM | 5 | OPS |
| S0-5 | Environments: preview per PR with ephemeral DB, staging, production; secret store; container registry; deploy pipeline | 5 | OPS |
| S0-6 | Observability baseline: JSON logging with request id, Actuator health, Micrometer/Prometheus, Sentry with scrubbing | 3 | BE |
| S0-7 | Security baseline: Dependabot/Renovate, CodeQL, secret scanning, branch protection, **audit git history for committed `.env` secrets and rotate** | 3 | OPS |
| S0-8 | Threat-model workshop v1, hazard log created, DPO nominated, Data Protection Commission registration status confirmed | 3 | PO |
| S0-9 | Backlog imported ([08-backlog.csv](08-backlog.csv)), board configured, DoR/DoD posted, ADR log committed | 2 | PO |
| S0-10 | Spike: Better Auth JWT plugin → Spring resource server via JWKS; document claim mapping and token lifetimes (ADR-015) | 3 | BE |

**Acceptance:** a trivial PR opens a preview with its own migrated database and all checks green; the baseline migration reproduces the live schema exactly (schema diff empty).
**Demo:** open a throwaway PR; show preview + CI + Flyway history table; call a JWT-protected `/actuator/info` from Postman using a Better Auth token.
**Risk:** ADR-015 token mechanics — mitigated by the spike; if the JWT plugin is unsuitable, fall back to Keycloak early (adds ~1 sprint).

---

# Sprint 1 — Platform hardening
**Goal:** a secure, auditable, contract-driven Spring platform and a frontend that talks to it with server-side lists.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S1-1 | JWT resource-server config, `/me` endpoint, `V2__platform` (`app_user_role` multi-role + backfill from legacy role, `user_unit_scope`), 24-role model, method security | 8 | BE |
| S1-2 | `ListQuery` resolver + `PageResponse` envelope + `GlobalExceptionHandler` (RFC 7807 + compat fields + `requestId`) + SQLSTATE→error-code mapper ([03](03-api-contract.md) §1–2) | 8 | BE |
| S1-3 | Audit: partitioned `audit_log`, `AuditInterceptor`, `@Audited`, partition-creation job, per-patient index | 5 | BE |
| S1-4 | `V3__facility_settings` + port of `/setup` endpoints, `Clock`/`ZoneId` beans, `document_sequence` + `next_doc_number()` with concurrency test | 5 | BE |
| S1-5 | Generic `consent` table + `ConsentApi` (latest-row-wins) | 3 | BE |
| S1-6 | springdoc OpenAPI + `types:emit` + CI drift check | 3 | FS |
| S1-7 | Frontend: **rewrite data provider** (server pagination/sort/filter, error `code` mapping, legacy-vs-Spring routing), `/me`-driven `accessControlProvider`, JWT handling, `IdleLock` | 8 | FE |

**Acceptance:** `GET /api/v1/org-units?sort=bogus` → `422 LIST_FIELD_UNKNOWN`; a 200-row staff list in the UI is server-paginated; legacy `payments` pages still work through the routing map; every write appears in `audit_log`; gapless numbers hold under 50 concurrent allocations.
**Demo:** sign in as `HOSPITAL_ADMIN` and `STAFF`, show different `/me.permissions`, trigger a 403 and a 409 and show their error codes in the UI.
**Stretch:** Bucket4j rate limits and security headers (moved to Sprint 2 if not finished).

---

# Sprint 2 — Organisation & staff
**Goal:** the hospital's structure and staff records exist in Spring with clinical/non-clinical categories and licences.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S2-1 | `V4__org_unit` + CRUD/tree API, `UnitAccessEvaluator` (subtree scope), `user_unit_scope` FK | 8 | BE |
| S2-2 | `V5__shift_type` + seed (`STD`, `MORNING`, `AFTERNOON`, `NIGHT`) + `ShiftTimes` utility; tests incl. night crossing midnight and DST-safe conversion | 3 | BE |
| S2-3 | `V6__staff_extension`: category, schedule mode, default shift, job role, badge, hire/termination dates, user link, `staff_nonclinical_fixed` check, `staff_license`; `StaffScheduleRules` validator | 8 | BE |
| S2-4 | Port staff CRUD from Express to Spring (payout fields guarded); Java Flyway migration turning `staff.department` text into `org_unit` rows (dry-run mode + report) | 8 | BE |
| S2-5 | Job roles CRUD + seed; licence CRUD + `LicenceExpiryJob` (90/30/7-day notices) | 3 | BE |
| S2-6 | Frontend: org-unit tree editor; staff list/create/edit/show extended (category, role, badge, schedule mode), licences tab | 8 | FE |
| S2-7 | Rate limiting (Bucket4j), security headers, CORS allow-list parity with Express (carried from Sprint 1) | 3 | BE |

**Acceptance:** creating a non-clinical staff member with `ROSTERED` mode is rejected (`STAFF_NONCLINICAL_FIXED`); a unit manager sees only their subtree; migrated staff all link to an org unit; `StaffShiftTimesTest` proves 20:00–07:00 ends on the next calendar day.
**Demo:** build the org tree, create a nurse and an accountant, show validation rules, edit a licence expiry and see the alert.
**Risk:** free-text `department` values are messy — the dry-run report lists unmapped values for HR to resolve before the real run.

---

# Sprint 3 — Assignments & transfers
**Goal:** staff can be assigned and re-shuffled between units/wards with history preserved.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S3-1 | `V7__staff_assignment` + `transfer_batch`, GiST exclusion for one PRIMARY at a time, backfill INITIAL assignments from the Sprint 2 org-unit mapping | 5 | BE |
| S3-2 | `AssignmentService.transfer` (future-dated), TEMPORARY/COVER assignments, `effectiveUnit(staff, date)` API, `StaffTransferred` event | 8 | BE |
| S3-3 | Transfer batches: draft → coverage **preview** → approve → apply (single transaction) | 5 | BE |
| S3-4 | Staff deactivation: `StaffDeactivated` event, login disabled, future work cancelled hook (no-op until rosters exist) | 3 | BE |
| S3-5 | Frontend: assignment history tab, transfer dialog, temporary assignment, batch reshuffle UI with coverage preview | 8 | FE |
| S3-6 | `unit_staffing_requirement` CRUD + UI (minimum coverage per unit/shift/role) | 3 | FS |
| S3-7 | Tests: assignment overlap & concurrency, retroactive-transfer rejection, history intact after transfers | 5 | QA |
| S3-8 | Synthetic data generator v1 (staff, units, assignments) for demo/staging/perf | 3 | BE |

**Acceptance:** transferring a nurse effective next Monday keeps this week's unit unchanged and moves next week; a mass reshuffle of 30 staff applies atomically; overlapping PRIMARY assignments are impossible at DB level.
**Demo:** reshuffle three nurses between wards with the coverage preview; show the unit history.

---

# Sprint 4 — Rostering
**Goal:** non-clinical staff get automatic weekday schedules; clinical rosters (shifts + off days) can be built, validated and published.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S4-1 | `V8__roster`: periods, entries (GiST no-overlap), requirements, swaps, `public_holiday` + CRUD + Ghana holiday seed | 8 | BE |
| S4-2 | `FixedScheduleMaterializer`: rolling 60-day `AUTO_FIXED` entries, Mon–Fri only, holidays/leave aware, idempotent; re-run on transfer/hire/holiday change | 8 | BE |
| S4-3 | Roster rules engine ([09](09-module-workforce.md) §6.3): overlap, min rest 11 h, consecutive days/nights, weekly hours, non-clinical weekend, coverage, 24-h-unit rule; violations API | 8 | BE |
| S4-4 | Roster period workflow (DRAFT → PUBLISHED → LOCKED), copy previous period, weekly template, bulk upsert endpoint | 5 | BE |
| S4-5 | Frontend: **roster grid editor** (virtualised, paint mode, violations drawer, publish/lock) | 8 | FE |
| S4-6 | "My schedule" self-service + publish notifications (in-app) | 3 | FS |
| S4-7 | Shift swap requests (request → accept → approve) *(stretch)* | 3 | FS |

**Acceptance:** an accountant has no weekend/holiday entries and a Saturday roster placement is rejected; a nurse placed Night Mon then Morning Tue is blocked by the rest rule (HR override allowed); a 24-hour ward publish fails if any shift lacks coverage; two overlapping periods for one unit are impossible.
**Demo:** build a ward week with off days, see violations, fix, publish; show an accountant's auto schedule skipping a public holiday.
**Risk:** UX of the roster grid is the adoption driver — usability test with 2 real roster officers mid-sprint.

---

# Sprint 5 — Attendance capture
**Goal:** fingerprint terminals and ID-card scanners can deliver punches that become correct attendance records.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S5-1 | `V9__attendance`: credentials, devices, `punch_log` (append-only), records, exceptions, corrections, one-OPEN-per-staff index | 8 | BE |
| S5-2 | Device registry + separate `/device/**` security chain (key auth), rate limits, `/device/ping` with server time for skew | 5 | BE |
| S5-3 | Ingestion API: batch, idempotent, per-item results, skew rules; `DeviceAdapter` port + **terminal simulator** CLI for tests | 8 | BE |
| S5-4 | `PunchProcessor` ([09](09-module-workforce.md) §7.4): open-state-wins, debounce, nearest-shift matching, business date, metrics (late/early/worked/overtime) | 8 | BE |
| S5-5 | Credentials: card token issue/revoke, badge PIN, fingerprint-enrolment record, `BIOMETRIC_ATTENDANCE` consent check | 3 | BE |
| S5-6 | Frontend: devices admin (register, rotate key, disable), device health tiles | 3 | FE |
| S5-7 | Scenario tests ([09](09-module-workforce.md) §11): night shift dated to the start day, double shifts, duplicate punch, offline replay, revoked card, unrostered punch | 5 | QA |

**Acceptance:** a Night shift clocked 19:50 → 07:04 yields one record dated the *start* day; 07:00 punches close an open Night record instead of opening a Morning one; replaying a 500-punch offline batch creates zero duplicates; an unknown or revoked credential is rejected and logged.
**Demo:** run the simulator for a day of three shifts and show attendance, exceptions and metrics.
**Risk:** vendor protocol unknown until Q3 — the REST contract + adapter port keeps this sprint unblocked.

---

# Sprint 6 — Attendance operations  ★ Release 1 (Workforce)
**Goal:** HR and unit managers run attendance day to day; pilot goes live on one ward and one admin office.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S6-1 | Jobs: `PunchRetryJob`, `AutoCloseJob`, `AbsenceDetectionJob`, `DeviceHealthJob` + alerts | 5 | BE |
| S6-2 | Exceptions queue + resolve (excuse/confirm), two-step corrections, manual punch with approval | 8 | BE |
| S6-3 | Monthly attendance summary per staff (scheduled/worked/absent/late/overtime, night/weekend/holiday counts) | 5 | BE |
| S6-4 | Frontend: attendance log, exception queue, correction requests, "my attendance" | 8 | FE |
| S6-5 | **Kiosk page**: scanner input, camera QR, IndexedDB offline queue, large-type feedback | 8 | FE |
| S6-6 | ID-card QR/barcode PDF, credentials tab UI, fingerprint-enrolment UI | 3 | FE |
| S6-7 | **Pilot:** 1 fingerprint terminal + 1 QR scanner on one ward and one office; train staff; tune grace/early/late windows | 5 | PO |

**Acceptance:** exception queue shows MISSING_CLOCK_OUT/ABSENT/UNROSTERED correctly; clinical off days raise no ABSENT; a staff member on leave (stub) is excused; kiosk works offline and syncs without duplicates.
**Release 1 (end of Sprint 6):** workforce module live for pilot units, then rolled out unit by unit.
**Demo:** live clock-in by fingerprint and ID card at the pilot ward; show payroll-ready monthly summary.

---

# Sprint 7 — Patient registry
**Goal:** patients can be registered, found, protected and de-duplicated.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S7-1 | `V10`/`V11` patient tables, identifiers, contacts, allergies, conditions, merge tables, `immutable_unaccent`, trigram/phonetic indexes; MRN generator | 8 | BE |
| S7-2 | Patient CRUD + role-aware serializer, consent capture at registration, minor/guardian rules, unidentified-patient flow | 8 | BE |
| S7-3 | Search (trigram + phonetic) and `DuplicateDetector` (block/warn), perf test on 300 k synthetic patients | 8 | BE |
| S7-4 | Break-glass flow, RESTRICTED/VIP masking, self-access block, review-queue API | 5 | BE |
| S7-5 | Merge procedure with module re-pointing saga + `merge_task` tracking | 5 | BE |
| S7-6 | Frontend: patient search, registration wizard (duplicate panel, consent, photo), chart shell with `PatientBanner`, wristband/card print | 8 | FE |

**Acceptance:** search returns "Kwame Mensah" for "Kwame Mensa"/"Mensah Kwame" in < 300 ms at 300 k rows; a probable duplicate is blocked until acknowledged with reason; a restricted chart returns `403 BREAK_GLASS_REQUIRED`, then opens with a banner after break-glass and appears in the review queue; MRN numbers are gapless under load.
**Demo:** register a patient with a near-duplicate, break-glass a VIP chart, print a wristband.
**Risk:** duplicate thresholds need real name data — run with anonymised samples in UAT and tune.

---

# Sprint 8 — Appointments & charge master
**Goal:** clinics publish bookable slots from the duty roster; patients check in and join a queue; services and prices are defined.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S8-1 | `V12__charge_master`: service items, price lists, dated price items (exclusion), CRUD + CSV import with dry-run | 8 | BE |
| S8-2 | `V13`: clinic session templates, **slot generation from rosters** (nightly + on `RosterEntryChanged`), atomic booking, patient-overlap constraint | 8 | BE |
| S8-3 | Appointment lifecycle (book/cancel/reschedule/check-in/no-show), visit open, queue tickets and stages | 8 | BE |
| S8-4 | Notification service (SMS/email ports + fakes, outbox, consent gate) + reminder job | 5 | BE |
| S8-5 | Frontend: slot picker/calendar, appointment list, check-in, queue board + public ticket display | 8 | FE |
| S8-6 | Frontend: price-list/service management + import UI | 5 | FE |

**Acceptance:** slots exist only when the provider is rostered; a leave/roster change closes future slots and creates re-book tasks; 50 concurrent bookings on the last slot yield exactly one success; reminders skip patients without SMS consent.
**Demo:** roster a doctor, watch slots appear, book, check in, call the ticket.

---

# Sprint 9 — OPD encounters & prescribing
**Goal:** triage and doctors can document a visit, order tests/medications and decide disposition safely.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S9-1 | `V14`: encounters, notes (sign/amend/versions), vitals, diagnoses, ICD-10 import | 8 | BE |
| S9-2 | Triage + EWS policy configuration, vitals API, HIGH-band task/alert | 5 | BE |
| S9-3 | `clinical_order` lifecycle + `OrderSafetyService` (allergy, duplicate) + payment-gate flag + disposition → bed request / referral / follow-up | 8 | BE |
| S9-4 | `V15`: formulary import (EML/NHIS list), interaction table, prescriptions (issue/cancel/expire) with safety checks and override audit | 8 | BE |
| S9-5 | Frontend: triage screen, doctor workbench (SOAP, diagnoses, orders, Rx, alert dialog), referral/certificate prints | 13 | FE |

**Acceptance:** signing without a diagnosis is rejected (`ENCOUNTER_NO_DIAGNOSIS`); amending a signed note preserves history; a SEVERE penicillin allergy blocks a penicillin order until overridden with a reason (audited); EWS HIGH raises a nurse task; `REFERRED_OUT` requires a referral.
**Demo:** a complete OPD consultation from queue to disposition with an allergy alert override.
**Risk:** clinical rule content (EWS, dose limits) needs clinical-governance sign-off — scheduled mid-sprint.

---

# Sprint 10 — Billing core  ★ Release 2 (MVP)
**Goal:** every OPD service is charged correctly; cash and MoMo payments are taken and reconciled; cash patients are gated without ever blocking emergencies.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S10-1 | `V16`: bills, lines, payments, receipts, cashier tables; charge-capture listeners (visit, order), price resolution, `PRICE_MISSING` handling | 8 | BE |
| S10-2 | Cashier sessions, cash payments with change, gapless receipts, **blind cash-up**, payment reversal | 8 | BE |
| S10-3 | MoMo **collection** port from `momo.ts` to a Spring `MomoGateway`: requestToPay, signed callback, poller, reconciliation queue | 8 | BE |
| S10-4 | Pay-before-service gate + overrides + `OrderCleared`; emergency/STAT/inpatient exemptions | 5 | BE |
| S10-5 | Frontend: cashier till, bill view, payments (cash/MoMo), receipt print, gate indicators in work-lists | 8 | FE |
| S10-6 | MVP UAT: one-clinic parallel run (paper + HAMS), defect burn-down | 4 | QA |
| S10-7 | Refunds and waivers with four-eyes *(stretch)* | 3 | BE |

**Acceptance:** bill totals satisfy the invariants (property tests); replaying `OrderPlaced` never double-charges; a STAT or emergency order is never gated; a MoMo callback and the poller racing produce exactly one confirmation; cash-up variance is computed from a blind count.
**Release 2 — MVP GA (end of Sprint 10):** workforce + patients + appointments + OPD + billing/cashier live, clinic by clinic.
**Demo:** register → book → pay consultation (MoMo) → triage → consult → order lab (gated until paid) → STAT order not gated → receipt reprint "DUPLICATE" → cash-up.
**Risk:** MoMo sandbox ≠ production behaviour — run a controlled live test with small amounts before go-live.

---

# Sprint 11 — Laboratory & radiology
**Goal:** orders reach the lab/radiology, specimens are tracked, results are validated and critical results are acknowledged.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S11-1 | `V17`: lab catalogue/panels/reference ranges (GiST no-overlap) + import | 5 | BE |
| S11-2 | Lab orders → specimens (accession labels, collection/receipt scan, rejection → recollect) | 8 | BE |
| S11-3 | Results: entry, sex/age-based flagging, delta check, four-eyes validation, corrections, critical notification + escalation job | 8 | BE |
| S11-4 | `V18`: radiology procedures, orders, safety checklist, scheduling, study links, reporting/verification/addendum | 8 | BE |
| S11-5 | Frontend: lab worklist, scan screens, result-entry grid, validation, cumulative results; radiology worklist + reporting editor | 13 | FE |
| S11-6 | Analyzer gateway port + unmatched-message queue *(stretch)* | 3 | BE |

**Acceptance:** day-28 vs day-29 infants get different ranges; a critical result unacknowledged beyond the threshold escalates; validator ≠ enterer enforced; contrast CT cannot start without allergy/renal checks; STAT orders bypass payment gating.
**Demo:** order → collect → receive → result critical → read-back → clinician acknowledges; radiology order to verified report.

---

# Sprint 12 — Admissions & beds
**Goal:** the bed board is the truth; admissions, transfers and discharges flow with correct charging.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S12-1 | `V19`: rooms, beds, bed requests, admissions, `bed_assignment` (double GiST no-overlap), bed import | 8 | BE |
| S12-2 | Admission workflow: request → allocate → arrive → transfer → plan-discharge → discharge → death/LAMA; gender/isolation/class rules; bed status lifecycle | 13 | BE |
| S12-3 | Discharge summary (versioned) + discharge rules; `BedDayAccrualJob` (midnight census, idempotent) + patient deposits | 8 | BE |
| S12-4 | Census + ward board endpoint + SSE stream | 5 | BE |
| S12-5 | Frontend: ward board, bed requests, admit/transfer/discharge dialogs, discharge-summary editor | 8 | FE |

**Acceptance:** two concurrent allocations of one bed → one wins; transfers keep exactly one current assignment; a male patient to a female-only room is rejected; discharge with an unpaid bill **succeeds** (advisory clearance only); bed-day accrual run twice posts once.
**Demo:** ED boarder → bed allocated → admitted → transferred → discharged; board updates live.

---

# Sprint 13 — Nursing  ★ Release 3 (Clinical)
**Goal:** nurses document, administer and hand over safely with barcode verification.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S13-1 | `V20`: assessments (falls, pressure injury, nutrition), care plans/tasks, intake-output, notes | 8 | BE |
| S13-2 | MAR generation, administer/hold/refuse, scan verification (patient + drug/batch), witness for controlled/high-alert, missed-dose job | 8 | BE |
| S13-3 | Nurse–patient allocation tied to roster entries (+ ratio warnings) | 5 | BE |
| S13-4 | Shift handover (SBAR draft job, submit/ack) + clock-out reminder integration with attendance | 5 | BE |
| S13-5 | Frontend: nursing worklist, MAR chart, scan-to-administer, I/O chart, assessments, allocation board, handover | 13 | FE |
| S13-6 | Release 3 pilot ward, UAT, clinical-safety review sign-off | 3 | PO |

**Acceptance:** MAR regeneration is idempotent; giving a drug without a scan is flagged `scan_verified = false`; a controlled drug without a witness is rejected; allocating a nurse who is not on that unit's roster is rejected; handover drafts pre-fill from active admissions and open tasks.
**Release 3 (end of Sprint 13):** lab, radiology, wards and nursing live on a pilot ward, then all wards.
**Demo:** night-shift nurse takes allocation, administers with scan, submits handover; incoming nurse acknowledges.

---

# Sprint 14 — Inventory & procurement
**Goal:** every stock movement is a ledger entry; procurement runs from requisition to supplier invoice.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S14-1 | `V21`: stores, items, categories, suppliers, batches, ledger; `StockService.post` (atomic, idempotent) + nightly reconciliation job | 8 | BE |
| S14-2 | GRN + purchase orders (tiered approval) + supplier invoices + three-way match | 8 | BE |
| S14-3 | Requisitions and two-step transfers (in-transit), ward sub-stores | 5 | BE |
| S14-4 | Stock-take (blind), adjustments, write-offs (four-eyes), expiry/reorder/recall jobs and alerts | 8 | BE |
| S14-5 | Frontend: stock views, GRN, PO, requisition, stock-take, alerts | 8 | FE |
| S14-6 | Opening-balance import, valuation view, supplier payout batching hook (used in Sprint 19) | 5 | BE |

**Acceptance:** 100 concurrent issues of the last unit → one succeeds and ledger equals on-hand; replaying a posting is a no-op; transfer in-transit totals are exact; a recalled batch is excluded from picking; reconciliation detects a manual DB edit.
**Demo:** PO → GRN with batch/expiry → requisition to a ward → stock-take variance approval.

---

# Sprint 15 — Pharmacy dispensing
**Goal:** prescriptions are dispensed safely with FEFO stock, controlled-drug control and correct billing.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S15-1 | `V22`: dispense, returns, controlled-drug register, interventions, ward issues | 5 | BE |
| S15-2 | Dispense workflow: queue, payment gate, FEFO allocation, verify ≠ prepare (licence), label, counselling; stock + billing posting | 13 | BE |
| S15-3 | Substitution, stock-out handling, interventions; returns/restock + credit note; OTC sales | 5 | BE |
| S15-4 | Controlled-drug register with running balance, daily two-person count, discrepancy incident | 5 | BE |
| S15-5 | Frontend: Rx queue, dispense/verify, label print, controlled register, returns | 8 | FE |
| S15-6 | Inpatient named-patient supply + MAR batch link | 3 | BE |

**Acceptance:** an unverified dispense is impossible (API and DB check); FEFO picks earliest-expiry batches and excludes near-expiry per config; a controlled dispense without a witness is rejected; replaying `DispenseCompleted` posts stock and bill line once.
**Demo:** prescription → payment → FEFO dispense → label → controlled drug witnessed → return with restock.

---

# Sprint 16 — Insurance & NHIS claims  ★ Release 4 (Supply & revenue)
**Goal:** insured patients are verified, covered correctly, and claims are built, validated, submitted and reconciled.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S16-1 | `V23`: payers, plans, coverage rules, patient insurance, eligibility checks, pre-authorisations | 5 | BE |
| S16-2 | Eligibility port (manual verification + fake NHIA) and registration/visit payer-switch flow | 3 | FS |
| S16-3 | `CoverageEngine` at bill finalisation (covered %, copay, limits, exclusions, pre-auth required) | 8 | BE |
| S16-4 | Claims: builder, `ClaimValidator`, batches + CSV export, lifecycle, adjudication, resubmission | 13 | BE |
| S16-5 | Remittance + allocation (Σ ≤ amount), write-off approvals, ageing view | 5 | BE |
| S16-6 | Frontend: insurance capture, pre-auth, claim builder/validator, batches, remittance allocation | 8 | FE |

**Acceptance:** a bill line can never appear on two active claims; validator reports expired membership and missing ICD-10 together; a submitted batch is immutable; allocations cannot exceed a remittance; exports are refused without insurer-sharing consent or recorded statutory basis.
**Release 4 (end of Sprint 16):** stores, pharmacy and insurance claims live; first NHIS batch reviewed manually with Finance.
**Demo:** NHIS visit → coverage → claim → validation errors fixed → batch export → remittance allocated → PAID.
**Risk:** NHIA interface (Q10) — CSV/manual path is the baseline; electronic gateway is a later increment.

---

# Sprint 17 — Leave & HR
**Goal:** leave is requested, approved and reflected in rosters, attendance and payroll inputs.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S17-1 | `V24`: leave types/balances/requests/approvals/overtime tables + seed per Act 651 minimums and facility conditions | 5 | BE |
| S17-2 | `LeaveDayCalculator` (rostered vs weekday staff, holidays, half-days) + request/approval chain + balances + accrual/year-end jobs | 13 | BE |
| S17-3 | Roster integration: cancel/restore entries, absence suppression, coverage check at submit | 8 | BE |
| S17-4 | Overtime suggestions from attendance + approval flow | 5 | BE |
| S17-5 | Frontend: leave request, approval inbox, calendar, balances, overtime approvals | 8 | FE |
| S17-6 | Expired licence blocks clinical acts + roster warning for clinical units | 3 | BE |

**Acceptance:** a rostered nurse's leave counts only her rostered days; self-approval is impossible; approving leave cancels roster entries and a recall restores them; approvals that drop a 24-hour ward below minimum require an override reason.
**Demo:** request → unit manager → HR approval → roster and attendance reflect it → recall.

---

# Sprint 18 — Payroll engine
**Goal:** a payroll run is calculated reproducibly from approved attendance, leave and overtime.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S18-1 | `V25`: scales, compensation, elements, allowance rules, statutory rates, periods, runs, payslips, snapshots | 5 | BE |
| S18-2 | `PayrollReadinessService` + attendance snapshot + deterministic `PayrollCalculator` (basic, elements, allowance rules, overtime, SSNIT/PAYE from dated rates); golden payslip tests | 13 | BE |
| S18-3 | Run workflow: calculate/review/approve/lock with three-eyes, variance report, supplementary/arrears runs | 5 | BE |
| S18-4 | Payslip PDFs and staff self-service (own only) | 5 | BE |
| S18-5 | Frontend: period/run wizard, readiness blockers, variance review, payslip viewer, rules admin | 8 | FE |
| S18-6 | Statutory and management outputs: SSNIT schedule, PAYE schedule, payroll journal, cost by unit | 5 | BE |

**Acceptance:** golden payslips match Finance's hand calculations; clinical off days produce no absence deductions; reruns are deterministic; three distinct people are required (API and DB check); statutory values come only from dated rows.
**Demo:** run a month for a pilot unit; show readiness blockers being cleared; compare with a manual calculation.
**Risk:** payroll rules (Q11) — Finance must supply and sign off reference cases in Sprint 17.

---

# Sprint 19 — Payout, legacy port & parallel run
**Goal:** payroll pays through the existing, now-ported payout engine; Express domain routes are retired.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S19-1 | Port `payments`/`payment_recipients`/`categories`/approvals to Spring (same states, maker-checker, tests) | 8 | BE |
| S19-2 | Port MoMo **disbursement**, balance and status polling to the Spring `MomoGateway` | 5 | BE |
| S19-3 | Payroll payout: create `payments` batch + recipients from payslips, bank-file export, status sync back to payslips | 8 | BE |
| S19-4 | Frontend: switch payments/approvals/disbursements to Spring; remove legacy routing entries | 5 | FE |
| S19-5 | Supplier payout batches (from S14-6) and staff advance categories | 3 | BE |
| S19-6 | Parallel payroll harness (two-month dual run) + reconciliation report vs existing process | 5 | QA |
| S19-7 | **ADR-015 decision gate:** keep Better Auth bridge or move to Keycloak/Spring Authorization Server; plan migration if B | 5 | BE |

**Acceptance:** an approved run produces a payout batch whose recipient amounts equal payslip nets; the existing approval workflow works unchanged from the new API; no frontend call goes to the legacy domain routes (auth-only remains).
**Demo:** approve a payroll run → payout batch → MoMo disbursement sandbox → payslips marked PAID.

---

# Sprint 20 — Reporting & analytics  ★ Release 5 (Corporate)
**Goal:** management, units and statutory reporting run from read models.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S20-1 | `V26`: `facility_date()`, MVs — OPD, morbidity, bed occupancy, wait times, attendance, roster coverage, revenue | 8 | BE |
| S20-2 | MVs — lab/imaging TAT, pharmacy, stock valuation, claims ageing, payroll cost, leave; `ReportRefreshJob` + metrics | 5 | BE |
| S20-3 | `report_definition`/`report_run`: async XLSX/CSV/PDF (streaming), purpose + audit, small-cell suppression | 8 | BE |
| S20-4 | KPI snapshots + dashboards (executive, unit, finance, HR, pharmacy) | 5 | BE |
| S20-5 | DHIMS2 mapping + monthly dataset generate → review → lock → export | 8 | BE |
| S20-6 | Frontend: dashboards (Recharts), report catalogue/runs, DHIMS2 workflow, data-quality scorecard | 8 | FE |

**Acceptance:** views match hand-computed fixtures (occupancy across midnight, ALOS with transfers); `REFRESH … CONCURRENTLY` works; an export of personal data requires purpose and is audited; counts < 5 in sensitive categories are suppressed; a locked DHIMS2 dataset is reproducible.
**Release 5 (end of Sprint 20):** leave, payroll (after the parallel run), reporting live.
**Demo:** executive dashboard, unit census, DHIMS2 monthly dataset review and lock.

---

# Sprint 21 — Privacy centre, retention & data quality
**Goal:** data-subject rights, retention and integrity controls are operational.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S21-1 | `V27`: DSR + retention tables; DSR workflow API and the per-patient "who accessed my record" report | 8 | BE |
| S21-2 | `RetentionJob` (dry-run default), anonymisation routine, staff offboarding purge of biometric metadata | 8 | BE |
| S21-3 | Audit hash chain + nightly verifier; break-glass review reports; anomalous-access alerts | 5 | BE |
| S21-4 | Application-level AES-GCM for P5 fields + blind index + key-rotation procedure | 8 | BE |
| S21-5 | Frontend: privacy centre (DSRs, break-glass reviews, retention dry-run), audit explorer | 8 | FE |
| S21-6 | Data quality: duplicate sweep, missing diagnoses/discharge summaries, unmatched MoMo dashboards | 5 | FS |

**Acceptance:** a DSR access request produces the record and access report; erasure of a clinical record is *restricted*, not deleted, with a written explanation; tampering with `audit_log` is detected by the verifier; bank/SSNIT/TIN/Ghana Card values are encrypted at rest and searchable only by blind index.
**Demo:** end-to-end DSR; show an unjustified break-glass escalating to HR.

---

# Sprint 22 — Hardening, UAT & launch  ★ v1.0
**Goal:** the whole system is proven at scale, secure, rehearsed and handed over.

| ID | Story | Pts | Comp |
|---|---|---|---|
| S22-1 | Performance: k6 suites at full volume, query/index tuning, caching where measured | 8 | BE |
| S22-2 | Security: external penetration test, ZAP, remediation, dependency and secrets review | 8 | OPS |
| S22-3 | DR and downtime drills: restore test, failover rehearsal, paper kits ([07](07-testing-quality-cicd.md) §8) | 5 | OPS |
| S22-4 | UAT for all roles; defect burn-down | 8 | QA |
| S22-5 | Training materials, super-user programme, role quick-guides, help content | 5 | PO |
| S22-6 | Final data-migration rehearsal, cut-over plan, go/no-go | 5 | PO |
| S22-7 | Accessibility audit and fixes; i18n polish | 3 | FE |

**Acceptance:** all §6 performance budgets met; no open critical/high findings; restore drill within RTO/RPO; every role's UAT script passes including negative tests; go/no-go signed by HOSPITAL_ADMIN, DPO and the clinical safety lead.
**Release v1.0 (end of Sprint 22).**

---

## Cross-cutting work reserved every sprint

~15 % of capacity is **not** itemised above and is reserved for: bug-fixes from previous releases, dependency upgrades, test-data upkeep, runbook/ADR updates, hazard-log upkeep, UAT support and production support during hyper-care.
Itemised stories sum to ≈ 40 pts; commit to ≈ 34 and treat the rest as buffer until velocity is proven.

## Ceremonies

| Ceremony | Cadence | Notes |
|---|---|---|
| Planning | Day 1 | Confirm DoR, entry criteria, clinical/privacy impact |
| Daily stand-up | Daily | 15 min; include DevOps/QA |
| Backlog refinement | Mid-sprint | Next sprint's stories to DoR; clinical lead attends for clinical sprints |
| Review / demo | Last day | Demo script per sprint; PO acceptance against criteria; invite super-users |
| Retrospective | Last day | One improvement action per sprint, tracked |
| **Clinical safety review** | Before any clinical release (S9, S11, S13, S15) | Hazard log + rule sign-off |
| **Architecture/security review** | Sprints 1, 5, 10, 16, 21 | ADR changes, threat-model refresh |

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Scope: "full HAMS" is large; stakeholders expect everything at once | High | High | MVP at Sprint 10; release train; strict acceptance per sprint; change-control board |
| R2 | Fingerprint terminal protocol/vendor unknown | Medium | High | REST contract + adapter port; simulator; vendor chosen by Sprint 4 (Q3) |
| R3 | Roster UX not adopted → shadow spreadsheets | Medium | High | Usability tests with roster officers; import from Excel; coach super-users |
| R4 | Wrong-patient / duplicate MRN harms | Medium | Critical | Duplicate blocking, banner, scan verification, hazard log, merge audit |
| R5 | Payroll rules unclear or contested | High | High | Finance-signed golden cases; parallel run ≥ 2 months; statutory rates as data |
| R6 | NHIA electronic interface unavailable | Medium | Medium | Manual/CSV baseline; gateway port ready |
| R7 | Connectivity/power outages | High | High | Downtime procedures; offline punch buffering; UPS; quarterly drills |
| R8 | Data migration quality (legacy patients/stock) | High | Medium | Dry-runs, reviewer reports, never auto-merge, opening counts signed |
| R9 | Authentication bridge (ADR-015) proves brittle | Medium | Medium | Spike in S0; decision gate S19; configuration-only switch |
| R10 | Key-person dependency on clinical/finance SMEs | Medium | High | Named SMEs per module; booked review slots; recorded decisions |
| R11 | Security incident / PHI leak | Low | Critical | Controls in [06](06-security-privacy-compliance.md); pen test; break-glass review; drills |
| R12 | Team velocity lower than 40 pts | Medium | Medium | Re-forecast after Sprint 2; drop stretch items first; defer Sprint 21 data-quality items |
| R13 | Existing payment system must keep running throughout | Medium | High | Strangler approach; legacy routes untouched until Sprint 19; parallel tests |

## Post-v1 candidates (not scheduled)

Patient portal/mobile app and online booking; telemedicine; theatre scheduling and anaesthesia records; maternity partograph/antenatal registry; blood bank; mortuary; dietetics;
asset management & biomedical maintenance; general-ledger accounting integration; PACS image storage/DICOM worklist; analyzer/ADT HL7/FHIR interfaces; electronic NHIA claims submission;
order sets and clinical pathways; e-prescribing to external pharmacies; staff self-service shift bidding; multi-facility (group of hospitals); data warehouse and ML-based forecasting.
