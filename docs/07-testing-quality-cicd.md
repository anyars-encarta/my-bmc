# 07 — Testing, Quality, CI/CD & Operations

## 1. Test strategy

| Layer | Tooling | Scope | Target |
|---|---|---|---|
| Unit | JUnit 5, AssertJ, Mockito (sparingly) | Domain rules, state machines, calculators (`ShiftTimes`, `PayrollCalculator`, `CoverageEngine`, `DuplicateDetector`, `ResultFlagger`) | ≥ 80 % line / ≥ 70 % branch on `domain` + `service` packages |
| Property-based | jqwik | Money invariants (bill totals, payslip net), roster overlap rules, stock ledger arithmetic | every money/stock calculator |
| Persistence / component | **Testcontainers PostgreSQL 16** + Flyway | Constraints (exclusion, partial unique, generated columns), native queries, migrations from baseline, materialised views | every migration + every native query |
| Module | Spring Modulith `@ApplicationModuleTest` | Module in isolation with events published/consumed | each module |
| Architecture | ArchUnit + `ApplicationModules.verify()` | No cycles, no cross-module `internal` access, no entities in controllers, no `double` for money | on every PR |
| API | MockMvc / REST-assured + `spring-security-test` | Happy path, **401, 403 per role**, 404, 409, 422 for each endpoint; OpenAPI contract validation | each endpoint |
| Integration (fakes) | WireMock + fake gateways | MoMo, SMS, email, NHIA, PACS, analyzer, device uploads | each adapter |
| Scenario | Cucumber-style or plain JUnit "story" tests | Cross-module journeys below | listed journeys |
| E2E | Playwright (Chromium) on preview env | UI journeys + axe a11y | critical journeys |
| Security | OWASP ZAP baseline, dependency-check, CodeQL, secret scan | Every PR (fast set) / nightly (full) | no high/critical findings |
| Performance | k6 | §6 | before each release |
| Clinical safety review | Checklist + clinical lead sign-off | §9 | before each clinical release |

### Critical E2E journeys (all must pass before a release)

1. **Workforce:** HR creates a nurse → assigns to a ward → roster officer builds a week with Morning/Afternoon/Night + off days → publishes → nurse clocks in by QR and out by fingerprint (device simulator) → attendance record dated on the shift start date (including the night shift) → a transfer re-points future rostered days only.
2. **Non-clinical weekday rule:** an accountant gets auto-generated Mon–Fri `STD` entries, none on weekends or holidays; a Saturday punch raises `UNROSTERED_PUNCH`.
3. **OPD cash patient:** register (duplicate check) → book from rostered slot → check-in → pay consultation (cash, receipt) → triage → doctor note + diagnosis + lab + prescription → pay lab → specimen → result validated → review → pay for drugs → dispense (FEFO) → visit closed; stock ledger and bill totals reconcile.
4. **Emergency:** unidentified patient registered → triage RED → orders processed **without payment** → admitted to ED boarding → later identified/merged.
5. **NHIS OPD:** verify membership → services covered/copay → claim built → validator passes → batch submitted → remittance allocated → claim PAID.
6. **Admission:** bed request → allocation (gender/isolation rules) → admit → MAR generated → nurse administers with scan → transfer → discharge with signed summary; bed-day charges posted once each night; discharge with unpaid balance succeeds.
7. **Critical result:** analyzer/manual result flagged critical → notification → read-back → acknowledgement; unacknowledged result escalates.
8. **Procurement to payment:** requisition → PO (approval by tier) → GRN with batch/expiry → supplier invoice 3-way match → payout batch via existing approval + MoMo.
9. **Leave to roster:** leave request approved → roster entries cancelled → no `ABSENT` raised → recall restores entries.
10. **Payroll:** period readiness → snapshot → calculate → review → approve (3 people) → lock → payout batch → payslips visible to staff.
11. **Privacy:** restricted patient search masked → break-glass → access appears in the review queue; DSR access request produces the "who accessed" report.

### Backend test conventions

```java
@SpringBootTest
@Testcontainers
@ActiveProfiles("test")
abstract class IntegrationTest {
    @Container static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16")
            .withReuse(true);                                   // one container per run
    @DynamicPropertySource static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", pg::getJdbcUrl);
        r.add("spring.datasource.username", pg::getUsername);
        r.add("spring.datasource.password", pg::getPassword);
    }
    @TestConfiguration static class Fixed {
        @Bean @Primary Clock clock() { return Clock.fixed(Instant.parse("2026-10-12T06:30:00Z"), ZoneOffset.UTC); }
        @Bean ZoneId facilityZone() { return ZoneId.of("Africa/Accra"); }
    }
}
```

- **Fixed `Clock` and facility zone** in every test touching time; scenario helpers `at("2026-10-12T19:50")`.
- **Role matrix test** per controller: parameterised over all 24 roles asserting 200/403 against the matrix in [06](06-security-privacy-compliance.md) §3 (the matrix is also a machine-readable fixture `permissions.yml` used by the UI seed).
- **Builders/fixtures** (`StaffFixture`, `PatientFixture`, `RosterFixture`) create valid aggregates; no shared mutable data between tests (transaction rollback or `@Sql` cleanup).
- **Golden files** for payslips, claims exports, DHIMS2 datasets, PDFs (text extraction) — reviewed like code.
- **Concurrency tests** with `ExecutorService` for: last bed, last slot, last stock unit, double payment, simultaneous punches.
- **Time-travel tests** for jobs (`AutoCloseJob`, `BedDayAccrualJob`, `NoShowSweepJob`) by invoking the job class with an advanced clock.

### What must never be mocked
PostgreSQL (constraints are part of the business rules), Flyway migrations, the Spring Security filter chain in API tests, the event publication registry in module tests, and money/stock calculators.

## 2. Quality gates on every PR

| Gate | Threshold |
|---|---|
| Build + unit + Testcontainers tests | green |
| Spotless (format), Checkstyle (minimal), SpotBugs | no new violations |
| `ApplicationModules.verify()` + ArchUnit | green |
| Coverage (JaCoCo) | ≥ 80 % on changed `domain`/`service` code; no decrease on the module |
| Flyway: `validate` + "migrate from V1 baseline on empty DB" + "migrate on a populated DB snapshot" | green |
| OpenAPI drift check (`openapi.json` regenerated and committed) | no diff |
| Dependency-check / Dependabot / CodeQL / secret scan | no high/critical |
| Frontend: ESLint, `tsc --noEmit`, `types:emit` drift, Vitest, bundle-size budget | green |
| Story linked, Conventional Commit, ≥ 1 approval (≥ 2 for money, security, migrations) | enforced by branch protection |

## 3. CI/CD pipelines

### `.github/workflows/backend-spring.yml`

```yaml
name: backend-spring
on:
  pull_request: { paths: ["backend-spring/**", ".github/workflows/backend-spring.yml"] }
  push: { branches: [main], paths: ["backend-spring/**"] }
concurrency: { group: backend-spring-${{ github.ref }}, cancel-in-progress: true }

jobs:
  verify:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend-spring } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21, cache: maven }
      - name: Format, static analysis, tests (Testcontainers needs Docker — available on ubuntu runners)
        run: ./mvnw -B -ntp spotless:check verify
      - name: Module + architecture verification
        run: ./mvnw -B -ntp -Dtest='*ArchitectureTest,*ModulithTest' test
      - name: OpenAPI drift
        run: |
          ./mvnw -B -ntp springdoc-openapi:generate
          git diff --exit-code openapi/openapi.json
      - name: Dependency check (SBOM + CVEs)
        run: ./mvnw -B -ntp org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom org.owasp:dependency-check-maven:check
      - uses: actions/upload-artifact@v4
        with: { name: jacoco, path: backend-spring/target/site/jacoco }

  image:
    needs: verify
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - uses: docker/build-push-action@v6
        with:
          context: backend-spring
          push: true
          tags: ghcr.io/${{ github.repository }}/hams-api:${{ github.sha }}
      # image scan (Trivy) and signing (cosign) steps follow
```

### `.github/workflows/frontend.yml` (extend the existing frontend pipeline)
`npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run types:emit && git diff --exit-code src/types/api.d.ts` → `vitest run` →
`vite build` (+ bundle-size budget) → Playwright (against the preview URL, on PRs labelled `e2e` and nightly).

### Deployment

```
PR            → preview: backend image + ephemeral DB (migrated + synthetic seed) + frontend preview; torn down on close
merge to main → staging (auto): image → Flyway migrate → smoke tests (health, login, one journey)
release tag   → production (manual approval): promote the SAME image; Flyway migrates on start (single instance gets the lock);
                canary/blue-green behind the reverse proxy; rollback = redeploy previous image (migrations are expand-contract, forward-compatible)
```

Production checklist items in §7. Database changes follow **expand → migrate → contract** so a rollback of the application is always safe; destructive contract steps ship one release later.

## 4. Observability

| Signal | Tooling | Examples |
|---|---|---|
| Logs | JSON (logstash-encoder) → log platform; `requestId`, `userId`, `module` in MDC; **no PHI** | |
| Metrics | Micrometer → Prometheus/Grafana | `punch.received`, `punch.rejected{reason}`, `attendance.open`, `roster.violations`, `appt.slots.booked`, `orders.gated`, `lab.tat.seconds`, `lab.critical.unacked`, `bed.occupied`, `stock.ledger.drift`, `payment.momo.pending`, `claims.validation.fail`, `payroll.run.seconds`, `report.refresh.seconds{view}`, `event.publication.incomplete` |
| Traces | OpenTelemetry (optional) | slow endpoints, event handling |
| Errors | Sentry (scrubbed) | exceptions with request id |
| Health | `/actuator/health/{liveness,readiness}` (DB, Flyway, disk, devices-fresh, momo-reachable) | |
| Alerts | Alertmanager/Grafana → email/SMS/WhatsApp to on-call | see below |

**Alerts (page):** API 5xx > 2 % for 5 min; DB connections > 80 %; Flyway failed; event-publication registry backlog > 100 for 10 min; ledger drift > 0; MoMo pending > 15 min;
critical lab/imaging result unacknowledged beyond threshold; **no punches from any device for 30 min in working hours**; backup failed; certificate expiring ≤ 14 days; break-glass spike.

## 5. Scheduled jobs

All jobs use ShedLock (`lockAtMostFor` set), run in the facility timezone where relevant, are **idempotent**, and emit start/finish/duration/count metrics.

| Job | Module | Cadence | Notes |
|---|---|---|---|
| `FixedScheduleMaterializer` | scheduling | nightly 01:15 + on-demand | rolling 60 days |
| `PunchRetryJob` | attendance | 1 min | unprocessed punches |
| `AutoCloseJob` | attendance | 15 min | `planned_end + late_out` passed |
| `AbsenceDetectionJob` | attendance | 15 min | respects leave |
| `DeviceHealthJob` | attendance | 5 min | device silent > 15 min |
| `AppointmentReminderJob` | appointment | 15 min | consent-gated SMS |
| `NoShowSweepJob`, `VisitSweepJob` | appointment | nightly | |
| `SlotGenerator` | appointment | nightly + on `RosterEntryChanged` | |
| `MissedDoseJob`, `HandoverDraftJob`, `TaskOverdueJob` | nursing | 10 min | |
| `BedDayAccrualJob` | admission | 00:05 | midnight census charge |
| `CriticalResultEscalationJob` | laboratory/radiology | 5 min | unacked > threshold |
| `ExpiryAlertJob`, `ReorderPointJob`, `LedgerReconciliationJob` | inventory | nightly | |
| `RxExpiryJob` | pharmacy | nightly | |
| `MomoCollectionPollJob` | billing | 20 s (fresh) / 5 min (stale) | |
| `BillAgeingJob` | billing | nightly | |
| `ClaimDeadlineJob` | insurance | nightly | filing deadline warnings |
| `LeaveAccrualJob`, `LeaveYearEndJob` | leave | monthly / yearly | |
| `LicenceExpiryJob` | workforce | weekly | 90/30/7-day notices |
| `ReportRefreshJob` | reporting | nightly 02:30 | `REFRESH … CONCURRENTLY` |
| `ReportRunCleanupJob` | reporting | hourly | expire files |
| `RetentionJob` | shared | nightly | dry-run unless approved |
| `AuditPartitionJob`, `AuditHashVerifyJob` | shared | monthly / nightly | |
| `OutboxRetryJob` | shared | 1 min | re-publish incomplete events |

## 6. Performance budget & load tests

| Scenario (k6) | Load | Pass criteria |
|---|---|---|
| Patient search (300 k rows) | 50 rps | p95 < 300 ms, no seq-scan on `patient` (checked via `EXPLAIN` in a test) |
| OPD morning peak | 150 VU mixed: search, check-in, triage, orders, payments | p95 < 400 ms, error < 0.5 % |
| Device punches | 40 devices × 5 rps bursts, 5 000 offline back-fill | ack p95 < 150 ms; all processed < 5 s; zero duplicates |
| Shift-change spike | 300 punches in 5 min (07:00, 14:00, 20:00) | no deadlocks; one open record per staff |
| Roster grid | 150 staff × 31 days load/save | < 1.5 s |
| Bed board / queue SSE | 100 concurrent streams | < 1 s propagation |
| Billing | 30 cashiers, concurrent payments on shared bills | exact totals, no lost updates |
| Reports | 20 concurrent async exports (100 k rows) | memory flat (streaming), < 60 s |
| Nightly jobs | at 5 M rows in ledgers/audit | finish within window (< 30 min total) |

Run with production-like data volume (synthetic, 300 k patients, 5 M clinical rows) on staging before each release; keep a baseline report (`pg_stat_statements` top 20) in the release notes.

## 7. Release checklist

- [ ] All sprint stories meet the Definition of Done; no open P1/P2 defects
- [ ] Critical E2E journeys (§1) green on staging; a11y checks green
- [ ] Migrations reviewed by a second engineer; tested on a copy of production-size data; forward-fix note present
- [ ] Backup taken and **restore verified** within the last 30 days; PITR window healthy
- [ ] Secrets rotated if any exposure suspected; `.env` files absent from the image
- [ ] OpenAPI + `api.d.ts` regenerated; changelog and user release notes written
- [ ] Clinical safety review signed (§9) for any clinical-rule change; DPO sign-off for privacy-impacting change
- [ ] Training materials updated; super-users briefed; downtime kit current
- [ ] Rollback plan rehearsed (previous image + DB forward compatibility confirmed)
- [ ] Post-release smoke test and 24-h hyper-care roster published

## 8. Downtime & business continuity

| Situation | Procedure |
|---|---|
| **HAMS unavailable (planned/unplanned)** | Switch to **paper downtime kits** (registration cards, OPD notes, lab/imaging requests, prescriptions, MAR sheets, cash receipt books numbered in advance). Roster and attendance fall back to paper rosters + manual register |
| **Back-entry** | After recovery, staff enter downtime records with `entered_late = true` and the original timestamp + reason; cashier receipts keep their paper numbers in `external_receipt_no` |
| **Attendance** | Terminals buffer punches and upload on recovery (idempotent); kiosk queue likewise; HR reviews exceptions |
| **Network down at one site** | Terminals keep buffering; wards use printed census/MAR snapshots produced hourly (`/reports/downtime-snapshot` PDF — pre-printed at shift change) |
| **Data centre/region failure** | RTO 4 h / RPO 15 min: restore latest PITR to the standby environment; DNS switch; verify ledgers and open admissions first |
| **Ransomware** | Isolate; restore from offline/immutable backup; rotate secrets; incident process ([06](06-security-privacy-compliance.md) §8) |
| **Power** | UPS for servers/terminals; terminals are battery-tolerant; generator test monthly |

Run a **downtime drill** per quarter (one ward + front desk + pharmacy) and a **restore drill** per quarter.

## 9. Clinical safety, UAT & go-live

### Clinical safety (applies to every clinical module)
- A **clinical safety lead** (a senior clinician) owns a *hazard log*: each hazard (wrong patient, wrong drug/dose, missed critical result, lost specimen, bed double-allocation, duplicate MRN, incorrect result flag, incorrect payment gating of emergency) has a cause, control (design feature), test that proves it, and residual risk.
- Clinical rule content (EWS chart, dose limits, interaction list, reference ranges, critical limits, safety checklists) is **configuration owned by clinical governance**, versioned, with change approval and a regression suite.
- Every clinical release needs: hazard-log update, scenario tests green, clinical lead sign-off, and a rollback plan.

### UAT
Scripts per role (registrar, cashier, nurse, doctor, pharmacist, lab scientist, radiographer, store keeper, billing officer, HR, roster officer, payroll officer, unit manager). Each script lists steps, expected result, and *what must **not** be possible* (negative tests, e.g. "nurse cannot sign a diagnosis", "cashier cannot approve own refund"). UAT runs on staging with synthetic data and the **pilot device set**.

### Phased go-live (recommended)
| Phase | Scope | Gate |
|---|---|---|
| Pilot A (Sprint 6) | Workforce + attendance in **one ward + one admin office** with terminals | Punch accuracy ≥ 99 %, exceptions manageable |
| Release 1 | Workforce for all units; staff roster live | HR/roster officers signed off |
| Release 2 (MVP, Sprint 10) | Registration, appointments, OPD, cashier — in **one clinic**, then all OPD | 2 weeks parallel run (paper + HAMS) with reconciliation of counts and cash |
| Release 3 | Lab/radiology, then wards/nursing | Pilot ward first; paper MAR retained until scan-to-administer is stable |
| Release 4 | Stores, pharmacy, insurance claims | Stock opening balances counted and signed; first NHIS batch reviewed manually |
| Release 5 | Leave, payroll (parallel payroll run for ≥ 2 months), reporting | Payroll variance within agreed tolerance |
| v1.0 | Hardening, DR drill, training complete | Launch checklist |

**Data migration:** staff (from the existing `staff` table), org units (from `department` text), historical payments (stay in place), patients (import from any legacy list via a staged,
de-duplicated CSV with a dry-run and a reviewer report — *never* auto-merge), price lists, formulary, stock opening balances (counted), leave balances (opening entries), payroll YTD (for tax continuity).
Each import has a dry-run mode, row-level error report, and is repeatable until cut-over.

**Hyper-care:** 24/7 on-call for the first 2 weeks of each release; daily stand-up with super-users; triage board with SLAs (P1 1 h, P2 4 h, P3 next sprint).
