# 00 — Context, Decisions & Glossary

## 1. What already exists

The repo is a **staff payment system** for the facility: a Node/Express 5 API
(`backend/`, Drizzle ORM, Neon Postgres, Better Auth, Arcjet, Cloudinary, MTN MoMo) and a
Refine + shadcn/ui SPA (`frontend/`). It is **not** yet a hospital system. It models staff,
payment batches with a maker-checker approval flow, and MoMo disbursements.

This guide turns it into a Hospital Administration Management System (**HAMS**), implemented
as a **Spring Boot 3 modular monolith** that takes over from Express module by module
(strangler pattern), on the **same PostgreSQL database** and the **same Refine frontend**.

### Reusable as-is (platform layer)

| Capability | Where it is today | What happens to it |
|---|---|---|
| Staff CRUD (`staff` table with payment-oriented fields: MoMo number/name, employee id) | `backend/src/routes/staff.ts`, `db/schema/app.ts` | Ported to Spring `workforce`; table **extended**, not recreated ([09](09-module-workforce.md) §5) |
| Auth (Better Auth: email/password, cookie sessions, `user.role` ∈ `accounts`/`admin`, `status`) | `backend/src/lib/auth.ts`, `middleware/requireAuth.ts` | Kept during transition; Spring validates its JWT ([ADR-015](#adr-015--authentication-bridge-first-replace-later)) |
| Rate limiting / bot shield | `middleware/security.ts`, `config/arcjet.ts` | Replaced in Spring by Bucket4j + reverse-proxy limits |
| Payment batches: `payments` → `payment_recipients`, states `draft → pending_approval → approved → processing → completed/cancelled`, approver ≠ creator | `routes/payments.ts`, `paymentRecipients.ts` | **Kept** as the *disbursement engine*; becomes the payout step of Payroll ([12](12-module-hr-payroll-reporting.md) §2) |
| MTN MoMo client (`collection` + `disbursement` products, status polling, balance) | `backend/src/lib/momo.ts`, `routes/momo.ts` | Ported to Spring `MomoGateway` port; `collection` product now used by patient billing ([11](11-module-supply-and-revenue.md) §3) |
| Categories (payment categories) | `routes/categories.ts` | Kept; seeded with `PAYROLL`, `ALLOWANCE`, `SUPPLIER` |
| Facility setup (name, code, telephone, email, address, logo) | `routes/setup.ts`, `facility_setup` | Kept; extended with `timezone`, `currency`, policy versions |
| Cloudinary client-side signed uploads | `lib/cloudinary.ts`, `routes/cloudinary.ts` | Kept for staff/patient photos; Spring only stores URLs + public IDs |
| Users admin UI, dashboard, approvals UI, disbursements UI | `frontend/src/pages/*` | Kept; navigation regrouped ([04](04-frontend-blueprint.md)) |
| Refine app (data/auth providers, resource registry, shadcn components, theme, kbar) | `frontend/src/App.tsx`, `providers/`, `constants/resources` | Kept; new resources added per sprint |

### Existing tables: keep, extend, or rename

| Existing table | Decision | Rationale |
|---|---|---|
| `user`, `session`, `account`, `verification` | **Keep** (Better Auth core) | Until ADR-015 option B |
| `user.role` single enum (`accounts`,`admin`) | **Replace** with `app_user_role` (many-to-many) in Sprint 1 | A person can be *doctor + unit_manager*; map `admin→super_admin`, `accounts→accounts` |
| `staff` | **Extend** (category, schedule mode, job role, badge, hire date, user link) | Sprint 2; `department` text migrated to `org_unit` |
| `facility_setup` | **Extend** | Timezone drives every shift/business-date calculation |
| `categories`, `payments`, `payment_recipients` | **Keep, rename conceptually** to *payout batches* | Naming collision avoided: patient money lives in `patient_payment` (never `payments`) |
| `staff.momo_number`, `staff.momo_name` | **Keep** | Payroll payout details; moved to `staff_compensation` payout fields in Sprint 18 |

> **`user` ≠ `staff` ≠ `patient`.** `user` is a login account. `staff` is an employee
> (may or may not have a login: `staff.user_id` is nullable + unique). `patient` is a
> person receiving care (never has a login in v1; patient portal is post-v1).

## 2. Architecture decision records

### ADR-001 — Monorepo, three deployables during transition
`backend/` (legacy Express, frozen except bug fixes), `backend-spring/` (new), `frontend/`.
All **domain** routes are ported to Spring by Sprint 19. Express then shrinks to an
**auth-only service** hosting Better Auth (and the user-admin routes that wrap it) until
ADR-015 option B retires it. Each package keeps its own lockfile/build.
**Consequence:** simple CI matrix; nothing blocks the live payment workflow while the
hospital domain is built.

### ADR-002 — Strangler migration; Flyway owns the schema from a baseline
Express keeps serving existing routes until each is re-implemented in Spring. The Drizzle
schema is dumped to `V1__baseline.sql`; from then on **only Flyway** changes the schema.
`backend/drizzle/` is read-only history. **Consequence:** no dual-writer schema drift; the
rule "never hand-edit a table" becomes "never edit a *released* migration".

### ADR-003 — Modular monolith (Spring Modulith), not microservices
One deployable, one database, strict module boundaries verified in CI
(`ApplicationModules.verify()`). Cross-module calls go through a module's public API
interface or through domain events. **Consequence:** transactional integrity for billing,
stock and clinical flows; an extraction path exists later because boundaries are enforced.

### ADR-004 — Roles are a set; sensitivity gates are separate from roles
Coarse access: `@PreAuthorize` on roles (multi-role per user). Fine access: a
`UnitAccessEvaluator` (a manager sees only their unit subtree) and a `SensitiveAccessPolicy`
for **restricted/VIP patients, mental-health, HIV/STI, adolescent-SRH notes, payroll, and
biometric metadata**. Restricted records require a stated purpose ("break-glass") that is
audited. **Consequence:** no per-record ACL tables in v1; sensitive fields are omitted by the
serializer, not hidden by the UI ([06](06-security-privacy-compliance.md)).

### ADR-004a — Clinical authority follows professional registration
Only staff with an active, unexpired licence in `staff_license` and a clinical `job_role` can
sign notes, prescribe, validate lab results or administer scheduled drugs. Checked in the
service layer, not just the UI.

### ADR-005 — OpenAPI is the contract; TypeScript types are generated
Controllers + DTO records are annotated with springdoc. CI fails if `openapi.json` changes
without a committed regeneration; the frontend runs `npm run types:emit` (openapi-typescript)
to produce `frontend/src/types/api.d.ts`. **Consequence:** no hand-maintained duplicate
interfaces. (Replaces Zod-as-source-of-truth from the Node stack.)

### ADR-006 — Keep the custom Refine data provider; make it server-driven
`frontend/src/providers/data.ts` already adapts the API envelope, but today it **fetches whole lists and filters,
sorts and paginates in the browser**. That cannot work for 300,000 patients, so Sprint 1 (S1-7) rewrites it to send the
single list-query contract in [03](03-api-contract.md) (page/limit/sort/filters/`q`) and to read the `pagination` block.
The provider stays generic (no per-resource branches).

### ADR-007 — Consent is a versioned record, not a boolean
One `consent` table (`subject_type` = `PATIENT` | `STAFF`) stores `(subject, consent_type,
status, policy_version, granted_at, withdrawn_at, captured_by, capture_method, evidence)`. SMS reminders, insurer data sharing,
research use and staff biometric capture are gated by an active-consent check at query time
(Ghana Data Protection Act, 2012 — Act 843).

### ADR-008 — Money is `numeric(14,2)` + ISO currency; `BigDecimal` in Java
Never `double`. Amounts are **strings** at the JSON boundary. Currency defaults to `GHS`
from `facility_setup`. Rounding mode `HALF_EVEN` at line level, totals are sums of rounded
lines (so printed receipts always add up).

### ADR-009 — Time: `timestamptz` + one facility zone + business dates
All new columns are `timestamptz`; JSON uses ISO-8601 with offset. One `Clock` and one
`ZoneId` bean (`facility_setup.timezone`, default `Africa/Accra`). A *business date* (roster
date, attendance date, billing day) is a `date` computed in the facility zone — a night shift
belongs to the date it **starts**.

### ADR-010 — Append-only ledgers; corrections are compensating entries
`punch_log`, `stock_ledger`, `cashier_ledger`, `controlled_drug_register`, `audit_log`,
`bed_assignment` history and `payslip` snapshots are never updated or deleted. Mistakes are
fixed by a reversing entry that references the original.

### ADR-011 — Clinical records are amended, never overwritten
Signed notes, results and prescriptions are versioned (`amends_id`, `version`,
`signed_at`). "Delete" does not exist; `status = ENTERED_IN_ERROR` hides it from default views
but retains it for medico-legal review.

### ADR-012 — Cross-module consistency by events with a publication registry
Spring Modulith stores events in `event_publication` inside the publishing transaction and
re-delivers on failure; **every listener is idempotent** (natural key or
`UNIQUE(source_type, source_id)`), e.g. charge capture is unique per order line.

### ADR-013 — External systems sit behind ports
`AttendanceDeviceAdapter`, `EligibilityGateway` (NHIA), `PacsGateway`, `AnalyzerGateway`,
`MomoGateway`, `SmsGateway`, `EmailGateway`, `ObjectStore`. Each has a fake for tests and a
feature flag. **Consequence:** pilot with fakes; swap in vendors without touching domain code.

### ADR-014 — Naming collision: "payments"
Existing `payments`/`payment_recipients` = staff payout batches (kept, unchanged). Anything
patient-facing is `patient_payment`, `cashier_session`, `receipt`. Java packages: `payroll`
(payout) vs `billing` (patient money).

### ADR-015 — Authentication: bridge first, replace later
Phase A (Sprints 0–19): Better Auth issues a JWT (JWT plugin); Spring is an OAuth2 resource
server validating via JWKS. Phase B (decision gate at Sprint 19, story S19-7): move to Keycloak or
Spring Authorization Server with OIDC if SSO/MFA requirements justify it. Spring only ever
sees `sub` + roles, so the switch is configuration. *Verify the exact JWKS URL and claim
names against the installed Better Auth version in Sprint 1.*

### ADR-016 — Human-readable numbers are gapless and per-period
MRN, visit, admission, bill, receipt, claim, PO and payslip numbers come from
`document_sequence(doc_type, period_key, last_value)` updated with
`SELECT … FOR UPDATE` in the same transaction as the insert — not `count(*)+1`, and not a
Postgres `SEQUENCE` where gaplessness is an audit requirement (receipts, claims).

### ADR-017 — Offline tolerance is limited to attendance capture in v1
Terminals and kiosks buffer punches and upload later (idempotent). Clinical and billing
workflows require connectivity; downtime procedures (paper forms + back-entry with reason)
are documented in [07](07-testing-quality-cicd.md#8-downtime--business-continuity).

### ADR-018 — Reporting reads from read models, not the OLTP tables
Dashboards and statutory returns read from materialised views / summary tables refreshed by
scheduled jobs (and optionally a read replica), never from ad-hoc joins on live
transactional tables ([12](12-module-hr-payroll-reporting.md) §3).

## 3. Scope map

| Domain | Modules | Spec |
|---|---|---|
| Workforce | organization, workforce, scheduling (rosters), attendance | [09](09-module-workforce.md) |
| Clinical | patient, appointment/OPD, admission (ADT/beds), nursing, laboratory, radiology | [10](10-module-clinical.md) |
| Supply & revenue | inventory, pharmacy, billing, insurance (NHIS & private) | [11](11-module-supply-and-revenue.md) |
| Corporate | leave, payroll, reporting & analytics | [12](12-module-hr-payroll-reporting.md) |
| Platform | identity, audit, consent, settings, documents, notifications | [01](01-architecture-and-setup.md), [02](02-data-model.md), [06](06-security-privacy-compliance.md) |

### Out of scope for v1 (post-v1 candidates are listed at the end of [05](05-sprint-plan.md))
Patient portal/app, telemedicine, theatre scheduling & anaesthesia records, maternity
partograph, blood bank, mortuary, dietetics, assets/maintenance, general ledger accounting,
PACS image storage (links only), DICOM viewer.

## 4. Non-functional targets

Assumptions: a **~500-bed referral hospital**; confirm in Sprint 0 (S0-2).

| Attribute | Target |
|---|---|
| Staff | 1,500 active (≈ 3,000 punches/day, ≈ 1.1 M/year) |
| OPD | 1,500 visits/day; 300,000 registered patients; 5 M clinical rows/year |
| Concurrent users | 150 interactive + devices |
| p95 API latency (list endpoints) | < 400 ms; patient search < 300 ms at 300 k patients |
| Punch ingestion | p95 < 150 ms to acknowledge (processing is asynchronous, < 5 s end-to-end) |
| Availability | 99.5 % monthly (core hours 06:00–22:00 : 99.9 %) |
| Backup | PITR 7 days + nightly logical dump, 35-day retention; quarterly restore drill |
| RTO / RPO | 4 h / 15 min (PITR) |
| Accessibility | WCAG 2.1 AA for staff screens; large-touch kiosk mode |
| Audit | 100 % of reads of restricted patient records and all writes to clinical, financial, HR data |

## 5. Glossary (Ghana health-sector terms used throughout)

| Term | Meaning |
|---|---|
| **GHS** | Ghana cedi (ISO 4217 currency code is `GHS`); also *Ghana Health Service* — context disambiguates |
| **NHIS / NHIA** | National Health Insurance Scheme / Authority; main public payer, claims submitted monthly |
| **G-DRG** | Ghana Diagnosis-Related Groups — NHIS case-based tariff code for claims |
| **Ghana Card** | National ID; capture the PIN as a patient/staff identifier (optional) |
| **DHIMS2** | District Health Information Management System 2 — national routine health reporting |
| **MRN** | Medical Record Number: the facility's unique patient number |
| **OPD / IPD** | Out-patient / in-patient department |
| **ADT** | Admission–Discharge–Transfer |
| **MAR** | Medication Administration Record |
| **FEFO** | First-Expired-First-Out stock picking |
| **GRN** | Goods Received Note |
| **MEWS** | Modified Early Warning Score (derived from vitals) |
| **SSNIT** | Social Security and National Insurance Trust (pension contributions) |
| **PAYE** | Pay-As-You-Earn income tax (Ghana Revenue Authority) |
| **NMC / MDC / PC** | Nursing & Midwifery Council / Medical & Dental Council / Pharmacy Council — clinical licensing bodies |
| **Roster** | Planned duty schedule; the *duty roster* decides each clinical staff member's days on/off |
| **Punch** | A single raw clock event from a fingerprint terminal or card scanner |
| **Business date** | The date a shift/charge/attendance belongs to (night shift → start date) |
| **Break-glass** | Audited override to open a restricted record with a stated reason |

## 6. Assumptions and open questions

Locale/legal assumptions are inferred from the repo (MTN MoMo, `GHS`) and are **to be
confirmed in Sprint 0 (S0-2)**.

| # | Question | Default used in this guide | Blocks |
|---|---|---|---|
| Q1 | Country/regulator: Ghana (DPA 2012, NHIA, GHS/DHIMS2) | Yes | [06](06-security-privacy-compliance.md), Sprints 16, 20 |
| Q2 | Facility timezone and public-holiday calendar | `Africa/Accra`; Ghana statutory holidays seeded | Sprint 4 |
| Q3 | Fingerprint terminal vendor/model and protocol (push vs pull) | Vendor-neutral REST upload + adapter port | Sprint 5 |
| Q4 | Do standard-hours clinical staff work 7 days (rostered)? | Yes, rostered | Sprint 4 |
| Q5 | Lateness/overtime policy: grace minutes, early-arrival pay, overtime pre-approval | 15 min grace, early arrival not paid, OT needs approval | Sprints 5, 17, 18 |
| Q6 | Double shifts and minimum rest hours | 11 h rest; HR can override | Sprint 4 |
| Q7 | Auth direction (ADR-015) | Bridge first | Sprint 1 |
| Q8 | Cash handling: pay-before-service (cash-and-carry) or bill-after? | Pay-before for OPD cash patients; NHIS patients bill-after | Sprint 10 |
| Q9 | Lab analyzer / PACS vendors | Manual entry + ports | Sprint 11 |
| Q10 | NHIA eligibility/claims electronic interface availability | Manual verification + CSV claim batch; gateway port ready | Sprint 16 |
| Q11 | Payroll rules (grades, allowances, SSNIT/PAYE bands) and who runs payroll today (CAGD vs facility) | Configurable rule tables; facility-run | Sprint 18 |
| Q12 | Data residency and hosting target | Containers + managed Postgres in-country/region approved by DPO | Sprint 0 |
| Q13 | Does the hospital operate a pharmacy for outpatients as retail (cash) as well as inpatient dispensing? | Both | Sprint 15 |
| Q14 | Team size and velocity | 2 BE + 1 FE + 1 full-stack + 1 QA + 0.5 PO, 36–42 pts/sprint | [05](05-sprint-plan.md) |
