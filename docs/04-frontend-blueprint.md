# 04 — Frontend Blueprint (Refine + shadcn/ui + Tailwind + TypeScript)

The frontend **already exists** (`frontend/`): Vite + React 19, `@refinedev/core` 5, `react-router` 7, shadcn/ui,
Tailwind 4, better-auth client, dashboards for staff, categories, payments, approvals and disbursements.
This blueprint extends it; nothing is rewritten except the **data provider** (server-side lists) and the
**resource registry** (grouped navigation + permissions).

## 1. Application root (changes to `App.tsx`)

Keep: `BrowserRouter`, `RefineKbarProvider`, `ThemeProvider`, `Layout`, `Authenticated`, notification provider, splash.
Add:

```tsx
<Refine
  dataProvider={dataProvider}                      // rewritten, §2
  authProvider={authProvider}                      // extended, §3
  accessControlProvider={accessControlProvider}    // NEW, §4
  auditLogProvider={auditLogProvider}              // NEW: client-side "view patient" beacons for restricted records
  notificationProvider={notificationProvider}
  routerProvider={routerProvider}
  resources={appResources.map(toRefineResource)}   // grouped + permissioned, §5
  options={{ syncWithLocation: true, warnWhenUnsavedChanges: true }}
>
  <IdleLock timeoutMinutes={10} />                 // clinical workstations (§7.9)
  <Routes>…</Routes>
</Refine>
```

Routes are split by lazy-loaded groups (`React.lazy`) so the first load stays small:

```
/login, /forgot-password                       guest
/kiosk                                         device-authenticated, no sidebar (§9)
/                                              Layout (sidebar, header, breadcrumb)
  /dashboard
  /front-desk/*   /clinical/*   /pharmacy/*   /stores/*   /finance/*   /workforce/*   /payroll/*   /reports/*   /admin/*
```

## 2. Data provider (rewrite of `providers/data.ts`)

Problems in the current provider: whole-list fetch + client-side search/sort/paginate (`listCache`), resource-specific
branches (`isUsersResource`), error mapping loses the `code`. Replace with a **generic, server-driven** provider that
implements the contract in [03](03-api-contract.md) §2.

```ts
// providers/data.ts (shape)
const toQuery = ({ pagination, sorters, filters, meta }: GetListParams) => {
  const p = new URLSearchParams();
  p.set("page", String(pagination?.currentPage ?? 1));
  p.set("limit", String(pagination?.pageSize ?? 25));
  if (sorters?.length) p.set("sort", sorters.map(s => (s.order === "desc" ? "-" : "") + s.field).join(","));
  for (const f of filters ?? []) {
    if (!("field" in f)) continue;
    if (f.field === "q") p.set("q", String(f.value));
    else p.set(OPERATOR_SUFFIX[f.operator] ? `${f.field}${OPERATOR_SUFFIX[f.operator]}` : f.field, serialise(f.value));
  }
  if (meta?.include) p.set("include", meta.include.join(","));
  return p;
};

export const dataProvider: DataProvider = {
  getList: async ({ resource, ...params }) => {
    const { data, pagination } = await http<ListEnvelope>(`/${meta.path ?? resource}?${toQuery(params)}`);
    return { data, total: pagination.total };
  },
  getOne:   ({ resource, id, meta }) => http(`/${pathOf(resource, meta)}/${id}`).then(unwrap),
  create:   ({ resource, variables, meta }) => http(`/${pathOf(resource, meta)}`, { method: "POST", body: variables, idempotencyKey: meta?.idempotencyKey }).then(unwrap),
  update:   ({ resource, id, variables, meta }) => http(`/${pathOf(resource, meta)}/${id}`, { method: "PATCH", body: variables, ifMatch: meta?.version }).then(unwrap),
  deleteOne:({ resource, id }) => http(`/${resource}/${id}`, { method: "DELETE" }).then(unwrap),
  custom:   ({ url, method, payload, headers }) => http(url, { method, body: payload, headers }),   // actions: /bills/:id/finalise …
  getApiUrl: () => API_URL,
};
```

Rules:
- **One `http()` wrapper** adds `Authorization: Bearer …`, `X-Request-Id`, JSON handling, and converts errors to Refine `HttpError` **keeping `code`, `details`, `requestId`** (`error.errors = payload`).
- **Legacy routes** (until ported): `resourceRouting` map sends `payments`, `categories`, `momo`, `users` to `VITE_LEGACY_API_URL`, everything else to `VITE_API_URL`. Remove entries as Spring takes over.
- **Actions are not CRUD**: state transitions (`/bills/:id/finalise`, `/admissions/:id/discharge`, `/roster-periods/:id/publish`) go through `useCustomMutation` wrapped in small typed hooks (`useFinaliseBill`), never through `update`.
- **Optimistic locking:** entities expose `version`; edit forms send it (`If-Match`); `409 CONCURRENT_MODIFICATION` opens a "record changed — reload / compare" dialog.
- **Types** come from `src/types/api.d.ts` (generated, ADR-005): `components["schemas"]["PatientDetail"]`.
- **Money** stays a string in state; the `<Money>` component formats with `Intl.NumberFormat(locale, { style: "currency", currency })` from facility settings; arithmetic uses `decimal.js` (never `Number`).
- **Dates**: display in the **facility timezone** (`date-fns-tz` / `Intl.DateTimeFormat({ timeZone })`) regardless of the browser zone — a night shift must look the same on every PC.

## 3. Auth provider (extend `providers/auth.ts`)

- Keep the Better Auth client login/logout/forgot-password flow ([ADR-015](00-context-and-decisions.md#adr-015--authentication-bridge-first-replace-later) option A).
- After sign-in, fetch a **JWT** for the API (`authClient.token()` via the JWT plugin) and keep it **in memory** (not localStorage); refresh transparently on `401` once, then redirect to `/login`.
- `getIdentity` → `GET /me` (user, roles, staff id, unit scopes, `permissions`); `getPermissions` returns the role list.
- `onError`: `401` → logout; `403 BREAK_GLASS_REQUIRED` → open the **break-glass dialog** and retry; other errors pass through.
- Session cap 8 h; `IdleLock` (§7.9) locks the UI after inactivity without destroying unsaved clinical drafts (kept in `sessionStorage` encrypted-at-rest is *not* assumed — drafts are discarded on logout).

## 4. Access control provider

```ts
export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action, params }) => {
    const me = await getMe();                               // cached, refreshed on login
    const rule = me.permissions[resource];                  // { list, show, create, edit, delete, actions: { finalise: true, … } }
    if (!rule) return { can: false };
    if (action === "action") return { can: !!rule.actions?.[params?.name] };
    return { can: !!rule[action as keyof typeof rule] };
  },
};
```

- The **permission matrix is authoritative on the server** (`/me.permissions`, derived from [06](06-security-privacy-compliance.md) §3); the UI only hides what the API would refuse anyway. **Never rely on hiding for security.**
- Use `<CanAccess resource="bills" action="action" params={{ name: "finalise" }}>` around buttons; sidebar items are filtered with the same provider.
- Unit scope: pickers (unit selectors, roster grid) are pre-filtered by `me.unitScopes`.
- Field-level: sensitive fields arrive **absent** from the API; components render a `—` placeholder with a lock tooltip when `meta.redacted` lists the field.

## 5. Resource registry (`constants/resources.ts`)

Extend the existing `AppResource` type:

```ts
type AppResource = {
  name: string; label: string; icon: LucideIcon; group: NavGroup;
  list: string; create?: string; edit?: string; show?: string; canDelete?: boolean;
  api?: { base?: "spring" | "legacy"; path?: string };      // routing for the data provider
  roles?: Role[];                                           // hint for sidebar only
  badge?: "queue" | "alerts";                               // live counters (SSE)
};
```

### Navigation groups & resources

| Group | Resource (route) | Sprint | Notes |
|---|---|---|---|
| **Dashboard** | `dashboard` | 1 → 20 | role-specific cards |
| **Front desk** | `patients` (`/patients`) · `appointments` · `visits` · `queue` | 7–9 | patient search is the home of the registrar |
| **Clinical** | `encounters` (OPD workbench) · `lab-worklist` · `lab-results` · `radiology-worklist` · `reporting-queue` | 9, 11 | |
| **Wards** | `ward-board` · `admissions` · `bed-requests` · `nursing-worklist` · `mar` · `handovers` | 12–13 | |
| **Pharmacy & stores** | `pharmacy-queue` · `dispenses` · `controlled-drugs` · `stock` · `requisitions` · `purchase-orders` · `grns` · `stock-takes` · `suppliers` | 14–15 | |
| **Finance** | `cashier` · `bills` · `refunds` · `claims` · `claim-batches` · `remittances` · `payers` · `price-lists` · **existing:** `payments` (payouts) · `approvals` · `disbursements` · `categories` | 8, 10, 16 | existing items move here, unchanged |
| **Workforce** | `staff` (existing, extended) · `org-units` · `rosters` · `shift-swaps` · `attendance` · `attendance-exceptions` · `devices` · `leave` · `overtime` · `transfers` | 2–6, 17 | |
| **Payroll** | `payroll-periods` · `payroll-runs` · `payslips` · `salary-scales` · `pay-elements` | 18–19 | |
| **Reports** | `dashboards` · `reports` · `dhims2` · `data-quality` | 20–21 | |
| **Administration** | `users` (existing) · `setup` (existing, facility) · `audit-log` · `break-glass-review` · `privacy` | 1, 21 | |

## 6. Screen inventory (by module and role)

| Module | Screen | Primary roles | Key behaviour |
|---|---|---|---|
| Patients | Search/list with filters | RG RC DR NU | debounced `q`, keyboard-first, result shows MRN/age/sex/phone; restricted rows masked |
| | Register / edit patient wizard | RG | live duplicate check panel; consent capture step; photo capture; print card/wristband |
| | Patient chart (tabs: Summary, Visits, Notes, Vitals, Orders, Results, Meds, Allergies, Documents, Billing, Audit*) | DR NU | persistent `PatientBanner`; *Audit tab only for RC/DP |
| | Merge duplicates | RC | side-by-side compare, field picker, pre-check results |
| Appointments | Calendar by clinic/provider; slot picker | RG | slots shown only when the provider is rostered; conflict handling `SLOT_FULL` |
| | Check-in & queue board | RG NU | ticket print; **public display** route `/queue-display` (read-only, no PHI: ticket numbers only) |
| OPD | Triage screen | NU | vitals form with plausibility hints; EWS chip; category picker |
| | Doctor workbench | DR | queue → patient chart → note (SOAP) → diagnoses (ICD-10 typeahead) → orders/prescriptions (safety alerts) → disposition |
| Lab | Worklist, collection (scan), receipt (scan), result entry grid, validation | NU LS | flags coloured **and** iconised; critical banner; cumulative results |
| Radiology | Worklist, safety checklist, reporting editor, addendum | RT RL | |
| Wards | **Bed board** (ward map), admit/transfer/discharge dialogs | UM NU DR | SSE updates, status colours + icons, drag-to-assign with confirmation |
| Nursing | Worklist (due tasks/MAR/vitals), MAR chart (timeline), scan-to-administer, I/O chart, handover (SBAR) | NU | big touch targets; offline-tolerant *read* only |
| Pharmacy | Rx queue, dispense (FEFO picker), verification, controlled register | PH PT | scan labels; shortage handling |
| Stores | Stock by store/batch, requisition, GRN (batch+expiry), PO, stock-take (blind) | SK PR | |
| Billing | Cashier till (open/close session), bill view, take payment (cash/MoMo), receipts, refunds, waivers | CS BO | MoMo pending state with live poll; change calculator |
| Insurance | Eligibility, pre-auth, claim builder/validator, batches, adjudication, remittance allocation | BO AC | validator findings list with jump-to-line |
| Workforce | Staff profile (tabs: Details, Employment, Credentials, Assignments, Licences, Schedule, Attendance, Leave, Compensation*) | HR UM | *Compensation tab only for HR/PO |
| | Org tree editor | HR | drag to reparent (confirm) |
| | **Roster grid editor** | RO UM | staff × days grid; shift chips; violations panel; publish/lock |
| | Attendance log, exception queue, correction requests, devices & credentials | UM HR | |
| | Transfers: single and **batch reshuffle** with coverage preview | HR | |
| Leave | Request form (live days & balance), approval inbox, calendar | ST UM HR | |
| Payroll | Period readiness, run wizard (calculate → review variance → approve), payslip viewer/PDF, payout batch link | PO HR AC | |
| Reports | Dashboard cards/charts (Recharts), report catalogue, run history | RV HA + others | async exports with status |
| Admin | Users & roles, facility setup, audit explorer, privacy centre (DSRs, break-glass review, retention) | SA DP AU | |

## 7. UI patterns

### 7.1 `PatientBanner` (mandatory in every clinical/billing/pharmacy context)
Photo · full name · MRN · age/sex · DOB · allergies chip (red if any severe) · isolation chip · EWS chip · payer type · `RESTRICTED/VIP` marker · deceased marker. Sticky at the top; **never** collapses. A name/ID mismatch guard asks to confirm the patient when switching tabs after > N minutes.

### 7.2 Safety alerts & overrides
`<ClinicalAlertDialog severity="stop|warn">` lists findings; `stop` requires a coded reason + free text before **Override**; the choice is sent in the request body (`overrides: [{code, reason}]`) and echoed in the audit view. Same component for allergy, interaction, pregnancy, duplicate patient, safety checklist, payment gate.

### 7.3 Work queues
One reusable `<WorkQueue>`: server-sorted by priority then age, SSE-driven row insertion, row-level "claim" lock (shows who is working it), SLA timers (turning amber/red), keyboard navigation. Used by lab, radiology, pharmacy, queue, bed requests, exceptions, approvals.

### 7.4 Roster grid
Virtualised table (TanStack Table + `react-virtual`): rows = staff (grouped by role), columns = dates (weekend/holiday shading, today marker). Cells show shift chips (`M`, `A`, `N`, `D`) with accessible labels; paint mode (select a chip, click/drag across cells), copy-week, templates, undo/redo (local), live validation badge per cell and a violations drawer (click → scroll to cell). Saves as one bulk `PUT …/entries`; shows server violations authoritative.

### 7.5 Bed board
Ward map by room; each bed card: status (icon + colour + text), patient initials/name (masked if restricted), days-in, EWS band, isolation, expected discharge. Actions via side sheet. Cleaning and blocked states are explicit.

### 7.6 Scanner input (`useScanner`)
Keyboard-wedge scanners type fast and end with Enter: a hook detects bursts (< 30 ms between chars) and routes the value to the focused handler (patient wristband, specimen accession, drug/batch label, ID card). Camera scanning (`BarcodeDetector` API with `html5-qrcode` fallback) for tablets. Every scan result is validated server-side.

### 7.7 Printing
- Receipts: 80 mm thermal CSS (`@page { size: 80mm auto }`) or the server PDF; **reprint** carries "DUPLICATE".
- Labels (50×25 mm): specimen, drug, wristband (Code 128 MRN) — generated by the backend (ZXing) and printed via the browser dialog or a local print agent.
- Clinical documents (prescription, requests, referral, certificate, discharge summary, payslip) use server PDFs with letterhead from facility settings and a verification QR where applicable.

### 7.8 Forms & tables
Keep the existing `refine-ui` primitives (`DataTable`, `ListView`, `CreateView`, `EditView`, form components) and add: `PatientPicker`, `StaffPicker`, `UnitPicker` (scope-aware), `IcdPicker`, `DrugPicker` (with stock/availability), `Money`, `FacilityDateTime`, `StatusBadge` (single source for state-machine colours/icons), `ConfirmTransitionDialog`. Forms: React Hook Form + Zod; server `fieldErrors` mapped to fields; unsaved-changes guard (already enabled).

### 7.9 Shared workstations & session safety
`IdleLock` after 10 min (configurable) shows a lock overlay (PIN/password re-entry) that hides all PHI; sign-out on logout clears in-memory token and query cache; no PHI in `localStorage`; browser tab titles never include patient names; `autocomplete="off"` on clinical fields.

### 7.10 Localisation
`en-GH` base (dates `dd MMM yyyy`, 24-hour times, `GH₵`/`GHS`). i18n scaffolding (`i18next`) with message keys from the **error `code`** namespace; local-language stubs (Twi/Ga/Ewe) for patient-facing prints (labels, appointment SMS) only.

## 8. Performance & accessibility
- Budgets: initial JS ≤ 250 kB gz (shell + dashboard); each group chunk ≤ 150 kB gz; patient search first result < 300 ms server + < 100 ms render; roster grid renders 150 staff × 31 days smoothly (virtualised).
- WCAG 2.1 AA: all status uses **icon + text + colour**; focus-visible everywhere; dialog focus traps (Radix); `aria-live` for queue/critical alerts; minimum 44 px targets in nursing/kiosk modes; high-contrast theme (next-themes already present); axe checks in CI on key screens.
- Data-heavy lists use server pagination, `staleTime` 15 s for work-queues, and SSE rather than aggressive polling.

## 9. Attendance kiosk & offline punch queue (Sprint 5–6)

Route `/kiosk` (no sidebar, full-screen, large type). Authenticates **as a registered `KIOSK` device** (device code + key entered once by HR, stored in `localStorage` on a locked-down browser profile — it is a *device* credential, not a user session).

```
 ┌────────────────────────────────────────────────────────┐
 │  BMC — Clock in / out         09:58:41  Mon 12 Oct 2026 │
 │                                                        │
 │   [ Scan your ID card or use the fingerprint reader ]  │
 │                                                        │
 │   ✔ Ama Mensah — Staff Nurse, Male Medical Ward         │
 │     CLOCKED IN 06:58  ·  Morning shift 07:00–14:00      │
 └────────────────────────────────────────────────────────┘
```

- Input: auto-focused scanner field (keyboard wedge) or camera QR; sends `POST /kiosk/punch { credentialType, credentialRef, deviceEventId (UUIDv7), punchedAt }`. The response shows name, photo, IN/OUT and shift — **never** other personal data.
- **Offline queue:** if the request fails, the punch is stored in IndexedDB with its `deviceEventId` and `punchedAt` (server-time-corrected using the offset from `/device/ping`), shown as "saved — will sync", and retried with back-off; replays are safe because the server de-duplicates on `(device, deviceEventId)`.
- Fingerprint terminals are **not** browsers; they use the device API directly ([09](09-module-workforce.md) §7.6).
- Optional camera snapshot per punch (only with documented consent, stored with the punch for audit) to deter buddy punching.
- Tablet at a ward station may also show the **handover reminder** if the clocking-out nurse has an unsubmitted handover (soft prompt).

## 10. Frontend testing & quality
- **Unit/component:** Vitest + Testing Library (data-provider query building, access control, `StatusBadge` transitions, `useScanner`, money maths).
- **E2E:** Playwright against the preview environment for the journeys in [07](07-testing-quality-cicd.md) §1.
- **Accessibility:** `@axe-core/playwright` on login, patient search, doctor workbench, bed board, roster grid, cashier.
- **Visual:** snapshot tests for prints (receipt, label, wristband) to catch layout regressions.
- **Lint/type:** ESLint (existing config), `tsc --noEmit`, `npm run types:emit` drift check.

## 11. Folder conventions

```
src/pages/<resource>/{index.ts, list.tsx, create.tsx, edit.tsx, show.tsx, components/, hooks.ts}
src/components/clinical/   PatientBanner, ClinicalAlertDialog, WorkQueue, ScanInput, PrintButton
src/components/workforce/  RosterGrid, ShiftChip, ViolationsDrawer, OrgTree
src/components/finance/    Money, TillStatus, ReceiptView
src/lib/                   http.ts, facility-time.ts, money.ts, permissions.ts, scanner.ts
src/types/api.d.ts         generated — never edit by hand
```
