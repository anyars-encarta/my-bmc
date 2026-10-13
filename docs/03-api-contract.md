# 03 — API Contract

Base URL: `/api/v1`. Auth: `Authorization: Bearer <JWT>` (ADR-015). Device endpoints live under
`/api/v1/device/**` with `X-Device-Code` / `X-Device-Key`. Public surfaces, when added, live under
`/api/public/*`.

> The existing Refine data provider (`frontend/src/providers/data.ts`) currently **fetches whole lists and
> filters/paginates in the browser** (`listCache`). That is fine for 200 staff and impossible for 300,000 patients.
> Sprint 1 rewrites it to send the list-query contract in §2 and read the `pagination` block (ADR-006).

## 1. Response envelope (compatible with the existing provider)

Success (single):
```json
{ "data": { "id": "6f0c…", "mrn": "MRN-2026-000123" } }
```

Success (list):
```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 25, "total": 1340, "totalPages": 54, "hasMore": true }
}
```

Error (RFC 7807 `application/problem+json` **plus** the `error`/`message` members the current provider reads):
```json
{
  "type": "https://hams.example/problems/bed-not-available",
  "title": "Conflict", "status": 409,
  "error": "Conflict",
  "message": "The selected bed is no longer available.",
  "code": "BED_NOT_AVAILABLE",
  "requestId": "01J9ZK3X…",
  "details": { "bedId": "…" }
}
```

Validation error (`422`): `details.fieldErrors` = `{ "dateOfBirth": ["must be in the past"] }`.

### Error codes

| HTTP | `error` | When |
|---|---|---|
| 400 | `Bad Request` | Malformed JSON, bad parameter type |
| 401 | `Unauthorized` | Missing/invalid/expired token |
| 403 | `Forbidden` | Role/scope not permitted, inactive account, **restricted record without break-glass** (`code=BREAK_GLASS_REQUIRED`), consent missing (`CONSENT_REQUIRED`) |
| 404 | `Not Found` | Missing resource (also used instead of 403 when existence itself is sensitive) |
| 409 | `Conflict` | Duplicate, overlap (`ROSTER_OVERLAP`, `BED_NOT_AVAILABLE`, `SLOT_FULL`), optimistic lock (`CONCURRENT_MODIFICATION`), illegal state transition (`ILLEGAL_TRANSITION`) |
| 422 | `Unprocessable Entity` | Validation failure or business rule (`code` identifies the rule) |
| 423 | `Locked` | Period/record locked (`ROSTER_LOCKED`, `PAYROLL_LOCKED`, `ENCOUNTER_SIGNED`) |
| 429 | `Too Many Requests` | Rate limit; includes `Retry-After` |
| 500 | `Internal Server Error` | Unhandled; details never leaked; logged with `requestId` |
| 503 | `Service Unavailable` | Dependency down (e.g. `NHIA_UNAVAILABLE`); callers should degrade (manual path) |

Every response carries `X-Request-Id`; error bodies echo it as `requestId`.

**Business error `code` namespace** (UPPER_SNAKE, stable, documented in OpenAPI):
`ROSTER_*` `ATTENDANCE_*` `DEVICE_*` `ASSIGNMENT_*` `LEAVE_*` `PATIENT_*` `APPOINTMENT_*` `ENCOUNTER_*` `ORDER_*` `RX_*`
`LAB_*` `IMAGING_*` `ADMISSION_*` `BED_*` `NURSING_*` `STOCK_*` `PO_*` `DISPENSE_*` `BILL_*` `PAYMENT_*` `CLAIM_*` `PAYROLL_*` `REPORT_*`.
The frontend maps codes to localised messages; free text in `message` is for logs.

## 2. Standard list query contract (implement in Sprint 1)

A `ListQueryResolver` (Spring `HandlerMethodArgumentResolver`) parses every list endpoint identically.

```
GET /api/v1/<resource>
  ?page=1                       # 1-based, default 1
  &limit=25                     # default 25, max 200
  &sort=lastName                # camelCase, whitelisted per resource; prefix '-' for desc  (e.g. sort=-createdAt)
  &q=mensah                     # free-text search, resource-specific
  &<field>=<value>              # equality, e.g. status=ACTIVE
  &<field>__in=a,b,c            # set
  &<field>__gte=2026-01-01      # range: __gt __gte __lt __lte
  &<field>__ne=INACTIVE
  &<field>__null=true|false
  &include=unit,jobRole         # relation expansion, whitelisted
```

```java
public record ListQuery(int page, int limit, int offset, List<SortKey> sort, String q,
                        List<Filter> filters, Set<String> include) {}

@Target(PARAMETER) @Retention(RUNTIME)
public @interface ListSpec {
    String[] sortable(); String[] filterable(); String[] includable() default {};
    String defaultSort(); int maxLimit() default 200;
}

@GetMapping
public Page<PatientSummary> list(@ListSpec(sortable = {"lastName","registeredAt","mrn"},
                                           filterable = {"status","sex","registeredAt","confidentiality"},
                                           defaultSort = "-registeredAt") ListQuery q) { … }
```

Unknown `sort`/filter fields return **422 `LIST_FIELD_UNKNOWN`**, never a silent ignore.
Implemented with Spring Data `Specification`s for simple resources and explicit SQL (`JdbcClient`) for
heavy ones (patient search, work-queues, reports). `q` semantics per resource are listed in OpenAPI.

## 3. Endpoint map

Role legend: `SA` SUPER_ADMIN · `HA` HOSPITAL_ADMIN · `HR` HR_MANAGER · `PO` PAYROLL_OFFICER · `UM` UNIT_MANAGER ·
`RO` ROSTER_OFFICER · `RG` REGISTRAR · `RC` RECORDS_OFFICER · `CS` CASHIER · `AC` ACCOUNTS · `BO` BILLING_OFFICER ·
`DR` DOCTOR · `NU` NURSE · `PH` PHARMACIST · `PT` PHARMACY_TECH · `LS` LAB_SCIENTIST · `RT` RADIOGRAPHER ·
`RL` RADIOLOGIST · `SK` STORE_KEEPER · `PR` PROCUREMENT_OFFICER · `RV` REPORT_VIEWER · `AU` AUDITOR (read-only) ·
`DP` DPO · `ST` STAFF (own data only). "scoped" = limited to the caller's unit subtree.

### Platform, identity & facility — Sprint 1

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/me` | any | user, roles, staff link, unit scopes, permissions (drives the UI) |
| GET/POST/PATCH | `/users` · `/users/:id/roles` | SA HA | multi-role; port of existing users admin (Better Auth calls stay in Express until ADR-015-B) |
| GET/PUT | `/facility` | SA HA | name, code, timezone, currency, policy versions, logo |
| GET | `/public-holidays` · POST · PATCH · DELETE | HR (write), any (read) | Sprint 4 |
| POST | `/break-glass` | DR NU RG RC … | `{ patientId, reason }` → 4 h grant; audited |
| GET | `/audit-log` | SA AU DP | filters: entity, patient, actor, action, date; read of restricted data is itself audited |
| GET | `/references/:name` | any | roles, job-roles, shift-types, leave-types, icd10 (search), drugs (search) … |
| POST | `/attachments` · GET `/attachments/:id` | by entity rule | metadata only; binary goes to Cloudinary/S3 with signed URL |

### Organisation, staff & assignments — Sprints 2–3

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/org-units` · `/org-units/tree` | any | |
| POST/PATCH | `/org-units` | SA HA HR | deactivate, never delete |
| GET | `/org-units/:id/staff?on=YYYY-MM-DD` | UM(scoped) HR RO | roster-effective assignment on a date |
| GET/POST/PATCH | `/staff` | HR SA (write), UM(scoped, read) | port of existing; category/mode/role/badge; payout fields only for HR/PO |
| GET | `/staff/:id` | HR UM(scoped) ST(own) | |
| POST | `/staff/:id/deactivate` | HR | publishes `StaffDeactivated`; reason required |
| GET/POST/PATCH | `/job-roles` · `/staff/:id/licenses` | HR | licences gate clinical acts |
| GET | `/staff/:id/assignments` | HR UM(scoped) | history |
| POST | `/staff/:id/transfers` | HR (UM requests) | `{ toUnitId, effectiveFrom, reason, note }` |
| POST | `/staff/:id/assignments` | HR | TEMPORARY / COVER |
| POST/GET | `/transfer-batches` · `/:id/preview` · `/:id/approve` · `/:id/apply` | HR HA | mass reshuffle; preview = coverage impact |

### Scheduling (rosters) — Sprints 3–4

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/shift-types` | any / HR | |
| GET/POST | `/roster-periods` | RO UM(scoped) | one period per unit/date range (exclusion constraint) |
| GET | `/roster-periods/:id/grid` | RO UM | staff × date grid with violations |
| PUT | `/roster-periods/:id/entries` | RO | bulk upsert; response lists `violations[]` (level, code, staff, date) |
| POST | `/roster-periods/:id/validate` · `/publish` · `/lock` | RO · UM · HR | publish/lock publish events |
| GET | `/staff/:id/schedule?from&to` · `/me/schedule` | UM(scoped) ST(own) | |
| POST | `/shift-swaps` · `/:id/accept` · `/:id/approve` · `/:id/reject` | ST · ST · UM | |
| GET/PUT | `/units/:id/staffing-requirements` | UM HR | minimum coverage |

### Attendance & devices — Sprints 5–6

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/device/punches` | DEVICE | batch, idempotent on `(device, deviceEventId)`; per-item result |
| GET | `/device/ping` | DEVICE | heartbeat; returns server time for clock-skew correction |
| GET/POST/PATCH | `/devices` · `/devices/:id/rotate-key` · `/disable` | HR SA | key shown once |
| POST/GET | `/staff/:id/credentials` · `/:cid/revoke` · `/staff/:id/fingerprint-enrolment` | HR | card issue returns printable QR/barcode |
| GET | `/attendance?unitId&staffId&from&to` | HR UM(scoped) AC(read) | |
| GET | `/me/attendance` | ST | |
| GET | `/attendance/exceptions?status=OPEN` · POST `/:id/resolve` | UM(scoped) HR | |
| POST | `/attendance/:id/corrections` · `/corrections/:cid/approve` | UM → HR | two-step, reasoned |
| POST | `/attendance/manual-punch` | UM | when a device is down; approval required |
| GET | `/attendance/summary?month&unitId` | HR PO AC | feeds payroll |
| POST | `/kiosk/punch` | KIOSK device | browser kiosk variant of device punch |

### Leave & overtime — Sprint 17

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/leave-types` · `/me/leave-balances` · `/staff/:id/leave-balances` | any · ST · HR UM | |
| POST | `/leave-requests` (draft) · `/:id/submit` · `/:id/cancel` | ST | days & coverage warning computed server-side |
| POST | `/leave-requests/:id/approve` · `/reject` | UM (step 1) · HR (step 2) | self-approval blocked |
| POST | `/leave-requests/:id/recall` | HR | restores roster entries |
| GET | `/leave-calendar?unitId&from&to` | UM HR | |
| GET/POST | `/overtime-requests` · `/:id/approve` | UM HR | suggested ones appear automatically |

### Patients — Sprint 7

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/patients?q=` | RG RC DR NU … | trigram + phonetic; masked rows for RESTRICTED/VIP |
| POST | `/patients` | RG RC DR(ED) | duplicate check → `409 PATIENT_DUPLICATE_CANDIDATES` with candidates unless `acknowledgeDuplicates` + reason |
| GET | `/patients/:id` | clinical + RG RC | RESTRICTED → `403 BREAK_GLASS_REQUIRED` |
| PATCH | `/patients/:id` | RG RC | audited demographic change |
| POST | `/patients/:id/identify` | RG DR | unidentified → identified |
| GET/POST/PATCH | `/patients/:id/identifiers` · `/contacts` · `/allergies` · `/conditions` | RG DR NU | allergies: DR NU PH write |
| POST/GET | `/patients/:id/consents` | RG | records `consent` rows |
| GET | `/patients/:id/timeline` | clinical | visits, encounters, results, admissions |
| POST | `/patients/:id/photo` | RG | |
| GET | `/patients/duplicates` · POST `/patients/merge` | RC | `{ survivorId, mergedId, reason }`; async re-pointing, status poll `/merge-tasks/:id` |
| GET | `/patients/:id/wristband` · `/card` | RG NU | PDF with Code 128 MRN |

### Appointments, visits & queue — Sprints 8–9

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/clinic-session-templates` | UM HA | provider optional (pooled clinic) |
| GET | `/appointment-slots?unitId&providerId&from&to&available=true` | RG DR | derived from rosters |
| POST | `/appointments` | RG | atomic slot claim; `409 SLOT_FULL` |
| PATCH | `/appointments/:id` · POST `/:id/cancel` · `/:id/reschedule` · `/:id/check-in` | RG | check-in opens the visit |
| GET | `/visits?status=OPEN&unitId` · POST `/visits` (walk-in/emergency) · POST `/:id/close` | RG DR NU | |
| GET/POST | `/queue?unitId&stage=` · `/queue/:id/call` · `/recall` · `/skip` · `/complete` | RG NU DR | display board uses SSE `/queue/stream?unitId=` |
| POST/GET | `/visits/:id/triage` | NU DR | triage category + vitals |
| GET/POST | `/service-items` · `/price-lists` · `/price-lists/:id/items` | BO AC HA | Sprint 8; price edits are dated (exclusion constraint) |

### Encounters, orders & prescribing — Sprint 9

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/visits/:id/encounters` · GET `/encounters/:id` | DR NU | |
| POST/PATCH | `/encounters/:id/notes` · POST `/notes/:nid/sign` · `/amend` | DR (NU for nursing notes) | signing needs licence; `423 ENCOUNTER_SIGNED` on edit after sign |
| POST/GET | `/encounters/:id/vitals` · `/patients/:id/vitals?from` | NU DR | EWS computed |
| POST/DELETE | `/encounters/:id/diagnoses` | DR | ICD-10 required |
| POST | `/encounters/:id/orders` · POST `/orders/:id/cancel` | DR | safety checks run; `422 ORDER_SAFETY_HARD_STOP` + override payload |
| POST | `/encounters/:id/prescriptions` · `/prescriptions/:id/issue` · `/cancel` | DR | alerts & overrides recorded |
| POST | `/encounters/:id/disposition` | DR | ADMITTED → bed request; REFERRED_OUT → referral |
| POST/GET | `/referrals` · `/medical-certificates` | DR | certificate PDF with verification code |
| GET | `/icd10?q=` · `/drugs?q=` | DR | typeahead |

### Laboratory — Sprint 11

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/lab/tests` · `/panels` · `/reference-ranges` | LS HA | catalogue |
| GET | `/lab/worklist?status&priority&department` | LS | `AWAITING_PAYMENT` flag for gated cash orders |
| POST | `/lab/orders/:id/collect` · `/specimens/:acc/receive` · `/reject` | NU LS | barcode scan endpoints |
| POST | `/lab/order-items/:id/results` | LS | manual entry; flags computed |
| POST | `/lab/results/:id/validate` · `/amend` | LS (≠ enterer) | |
| POST | `/lab/critical-results/:id/notify` · `/ack` | LS · DR NU | read-back captured |
| GET | `/patients/:id/lab-results?analyte&from` | DR NU LS | cumulative view |
| POST | `/integration/analyzer/results` | ANALYZER gateway key | unmatched → queue |
| GET | `/lab/orders/:id/report.pdf` | DR NU LS | |

### Radiology — Sprint 11

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST | `/radiology/procedures` · `/modalities` | RL RT HA | |
| GET | `/radiology/worklist?modality&status` · `/reporting-queue` | RT · RL | |
| POST | `/radiology/orders/:id/schedule` · `/checklist` · `/perform` | RT | checklist must be complete |
| POST | `/radiology/orders/:id/studies` | RT / gateway | study UID + viewer link |
| POST | `/radiology/orders/:id/reports` · `/:rid/verify` · `/addendum` | RL | |

### Admissions & beds — Sprint 12

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/wards/:id/board` | NU UM DR | beds + occupants (masked if restricted); SSE `/wards/:id/board/stream` |
| GET/POST | `/bed-requests` · `/:id/allocate` · `/cancel` | UM NU | allocation checks gender/isolation/class |
| POST | `/admissions` · `/:id/arrive` · `/:id/transfer` · `/:id/plan-discharge` · `/:id/discharge` · `/:id/death` · `/:id/lama` | DR NU UM | discharge needs signed summary (or override) |
| GET | `/admissions/:id` · `/admissions?status&unitId` | clinical | |
| POST/PATCH/POST | `/admissions/:id/discharge-summary` · `/sign` | DR | |
| GET/POST/PATCH | `/rooms` · `/beds` · `/beds/:id/status` · `/bed-blocks` | UM HA | cleaning, maintenance |
| GET | `/census?date&unitId` | UM RV | |

### Nursing — Sprint 13

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/nursing/worklist?unitId` | NU | due MAR, tasks, vitals due, EWS |
| POST | `/admissions/:id/assessments` · `/care-plans` · `/care-plan-tasks/:tid/complete` | NU | |
| GET | `/admissions/:id/mar?from&to` | NU DR PH | |
| POST | `/mar/:id/administer` · `/hold` · `/refuse` | NU | scan payload (`patientMrn`, `batchLabel`) or `override`; controlled → witness required |
| POST | `/admissions/:id/intake-output` · `/notes` | NU | |
| GET/POST | `/handovers?unitId&date` · `/:id/submit` · `/:id/acknowledge` | NU | pre-filled drafts |
| GET/POST | `/nursing/allocations` | NU (charge) | only rostered staff |

### Inventory & procurement — Sprint 14

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/stores` · `/items` · `/item-categories` · `/suppliers` | SK PR HA | |
| GET | `/stock?storeId&itemId&nearExpiry` · `/stock/:batchId/ledger` | SK PH PT UM(own store) | |
| POST | `/requisitions` · `/:id/submit` · `/approve` · `/issue` · `/receive` | UM SK NU | two-step transfer |
| POST/GET | `/purchase-orders` · `/:id/approve` · `/send` · `/cancel` | PR (approve by tier) | |
| POST | `/grns` · `/:id/post` | SK | batch+expiry mandatory |
| POST/GET | `/stock-takes` · `/:id/lines` · `/approve` · `/post` | SK · HA | blind count |
| POST | `/stock-adjustments` · `/write-offs` | SK → HA | approver ≠ requester |
| GET/POST | `/supplier-invoices` · `/:id/match` · `/approve` · `/batch-for-payment` | AC PR | creates a payout batch |
| GET | `/inventory/alerts` | SK PH | reorder & expiry |

### Pharmacy — Sprints 9 & 15

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/drugs` · `/drug-interactions` | PH HA | formulary maintenance; import from EML/NHIS list |
| GET | `/pharmacy/queue?status` | PH PT | |
| POST | `/dispenses` (from Rx) · `/:id/allocate` · `/:id/verify` · `/:id/dispense` · `/:id/cancel` | PT PH | verify ≠ prepare; FEFO suggestion |
| POST | `/dispenses/otc` | PH PT CS | otc-allowed drugs only |
| POST | `/dispense-items/:id/return` | PH | restock decision |
| POST | `/pharmacy/interventions` | PH | |
| GET/POST | `/controlled-drugs/register?itemId` · `/count` | PH (+witness) | append-only |
| POST | `/ward-stock-issues` | PH PT | named-patient supply |

### Billing — Sprints 8 & 10

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/bills?patientId&status` · `/bills/:id` | CS BO AC DR(read own patients) | |
| POST | `/bills/:id/lines` (manual) · `/lines/:lid/void` | BO | reason; manual lines flagged |
| POST | `/bills/:id/finalise` · `/reopen` | BO · BO(reason) | blocks on `PRICE_MISSING` |
| POST | `/bills/:id/payments` | CS | `Idempotency-Key` required; cash needs open session |
| POST | `/payments/momo/request` · GET `/payments/:id` | CS | collection `requestToPay`; poll status |
| POST | `/integrations/momo/callback` | MoMo (signature) | |
| POST | `/payments/:id/reverse` | CS(supervisor) AC | |
| GET | `/receipts/:id.pdf` · POST `/receipts/:id/reprint` | CS | DUPLICATE watermark |
| POST/GET | `/cashier-sessions` · `/:id/close` · `/:id/reconcile` | CS · AC | blind count |
| POST/GET | `/deposits` · `/refunds` · `/refunds/:id/approve` | CS · AC | four-eyes |
| POST/GET | `/waivers` · `/:id/decide` | BO · HA (tiered) | |
| GET | `/billing/receivables?bucket` · `/billing/pending-price` | AC BO | work-queues |
| POST | `/orders/:id/payment-override` | CS BO UM | reason; audited |

### Insurance — Sprint 16

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/payers` · `/plans` · `/plans/:id/coverage-rules` | BO HA | |
| POST/GET | `/patients/:id/insurance` · `/:iid/verify` | RG BO | eligibility port or manual verification |
| POST/GET | `/preauthorizations` · `/:id/decide` | BO | |
| GET | `/claims?status&payerId&batch` · `/claims/:id` | BO AC AU | |
| POST | `/claims/build?visitId|admissionId` · `/claims/:id/validate` · `/ready` | BO | `validate` returns all findings |
| POST | `/claim-batches` · `/:id/export` · `/:id/submit` | BO | batch immutable after submit |
| POST | `/claims/:id/adjudication` · `/resubmit` · `/write-off` | BO · AC(approval) | |
| POST/GET | `/remittances` · `/:id/allocations` | AC | Σ allocation ≤ amount |

### Payroll — Sprints 18–19

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/salary-scales` · `/pay-elements` · `/allowance-rules` · `/statutory-rates` | HR PO AC | dated rows |
| GET/PUT | `/staff/:id/compensation` · `/pay-elements` | HR PO | payout details masked for others |
| POST/GET | `/payroll-periods` · `/:id/readiness` | PO HR | blockers list |
| POST | `/payroll-runs` · `/:id/calculate` · `/review` · `/approve` · `/cancel` | PO · HR · AC/HA | three distinct people |
| GET | `/payroll-runs/:id/payslips` · `/variance` | PO HR AC | |
| POST | `/payroll-runs/:id/payout` | AC | creates `payments` payout batch (existing flow) |
| GET | `/me/payslips` · `/payslips/:id.pdf` | ST · PO HR | own only for ST |
| GET | `/payroll/reports/ssnit` · `/paye` · `/journal` · `/bank-file` | PO AC | |
| *(existing, retained)* | `/payments` · `/payments/:id/recipients` · `/momo/*` · `/categories` | AC HA | ported unchanged in Sprint 19 |

### Reporting — Sprint 20

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/dashboards/:code` | by definition | cards + series (executive, unit, finance, HR, pharmacy) |
| GET | `/reports` · `/reports/:code` | by definition | metadata + parameter schema |
| POST | `/reports/:code/runs` | by definition | `{ params, format, purpose }` → `202` + run id |
| GET | `/report-runs/:id` · `/report-runs/:id/download` | requester | signed URL, expires |
| GET | `/kpis?codes&from&to&unitId` | RV HA UM | trend series |
| GET/POST | `/dhims2/datasets?month` · `/:id/lock` · `/:id/export` | RC HA | review → lock → export |
| GET | `/data-quality/scorecard` | RC HA | |

### Privacy & retention — Sprint 21

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST/GET | `/data-subject-requests` · `/:id/verify` · `/fulfil` · `/reject` | DP | patient or staff DSRs |
| GET | `/privacy/break-glass-reviews` · POST `/:id/review` | DP UM | |
| GET | `/retention/policies` · POST `/retention/runs/dry-run` | DP SA | |
| GET | `/consents?subjectType&subjectId` | DP RG | |

## 4. Conventions every handler must follow

```java
@RestController
@RequestMapping("/api/v1/patients")
@RequiredArgsConstructor
class PatientController {

    private final PatientService patients;

    @GetMapping
    @PreAuthorize("hasAnyRole('REGISTRAR','RECORDS_OFFICER','DOCTOR','NURSE','SUPER_ADMIN')")
    PageResponse<PatientSummary> list(@ListSpec(sortable = {"lastName","registeredAt","mrn"},
                                                filterable = {"status","sex","registeredAt"},
                                                defaultSort = "-registeredAt") ListQuery q) {
        return PageResponse.of(patients.search(q, CurrentUser.get()));      // serializer masks RESTRICTED rows
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('REGISTRAR','RECORDS_OFFICER','DOCTOR','SUPER_ADMIN')")
    DataResponse<PatientDetail> create(@Valid @RequestBody RegisterPatientRequest body,
                                       @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return DataResponse.of(patients.register(body, key));               // 409 PATIENT_DUPLICATE_CANDIDATES from the service
    }
}
```

Checklist (each item is a CI/review gate — see [05](05-sprint-plan.md) DoD):

1. `@PreAuthorize` on every handler; unit-scoped endpoints add `@unitAccess.canManage(authentication, #unitId)`; sensitive reads call `SensitiveAccessPolicy`.
2. Request/response are **record DTOs** with Bean Validation annotations; entities never leave the module.
3. Response mapping goes through a role-aware **serializer** (`PatientView.forRole(...)`) — fields a role must not see are *absent*, not null.
4. Service methods are `@Transactional`; state transitions via entity methods (`canTransitionTo`) → `409 ILLEGAL_TRANSITION`.
5. Domain events are published **inside** the transaction (Modulith registry).
6. Audit: create/update/transition/override/print/export are recorded by `AuditInterceptor`/`@Audited`; restricted reads by `SensitiveAccessPolicy`.
7. Money as `BigDecimal` serialised as **string**; instants ISO-8601 with offset; business dates `YYYY-MM-DD`.
8. Pagination via `ListQuery`; no unbounded lists; exports are async.
9. Errors only through `BusinessRuleException(code, details)` / validation — never `RuntimeException` with free text.
10. Every endpoint has an OpenAPI summary, role list, and example (contract tests read the spec).

## 5. Idempotency

Retried requests must not duplicate money, stock, orders or punches.

| Endpoint class | Mechanism |
|---|---|
| Device punches | `UNIQUE (device_id, device_event_id)`; per-item result echoes `ACCEPTED/DUPLICATE` |
| Payments, refunds, deposits | **`Idempotency-Key` required** → `patient_payment.idempotency_key UNIQUE`; replay returns the original with `Idempotent-Replayed: true` |
| Charge capture, stock posting, MAR generation | Natural keys on `bill_line(source_type, source_id)`, `stock_ledger(ref…)`, `medication_administration(prescription_item_id, scheduled_at)` |
| Order placement, admission, bed allocation | Optional `Idempotency-Key` stored in `idempotency_record(key, user, endpoint, request_hash, response, expires_at)`; same key + different body → `422 IDEMPOTENCY_KEY_REUSED` |
| Webhooks (MoMo callbacks) | Provider reference de-duplication + status monotonicity (never move `CONFIRMED` back) |

## 6. Rate limits (Bucket4j on top of the reverse proxy)

| Surface | Limit (per key) |
|---|---|
| `/api/v1/**` authenticated | 300 / min per user; 60 / min on `/patients?q=` (search abuse), 20 / min on exports |
| `/api/v1/device/**` | 600 / min per device (batches count once); bursts allowed for offline back-fill |
| Login / token endpoints (Better Auth side) | 10 / min per IP + account |
| `/integrations/*/callback` | 120 / min per source IP, signature required |

Exceeded → `429` with `Retry-After`; events are logged with the principal for abuse review.

## 7. Real-time & downloads
- **SSE** (`text/event-stream`) for the bed board, queue display and lab/pharmacy work-lists (`Last-Event-ID` resume; polling fallback every 15 s). No WebSockets in v1.
- Files (receipts, wristbands, payslips, reports) are generated on demand or as async runs and returned via short-lived signed URLs; sensitive PDFs are `Cache-Control: no-store`.

## 8. API documentation & versioning
- springdoc generates `/v3/api-docs`; CI commits `openapi/openapi.json` and **fails on unreviewed drift**; `frontend` runs `npm run types:emit` → `src/types/api.d.ts`.
- Contract tests (REST-assured + `swagger-request-validator`) validate a sample of responses against the spec.
- Breaking changes require `/api/v2` for the affected module; deprecations are announced via the `Deprecation`/`Sunset` headers for one release.
- Swagger UI is disabled in production for non-`SUPER_ADMIN` callers.
