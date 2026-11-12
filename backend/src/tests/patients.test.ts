import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import express from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

// Database-backed scenarios from docs/10 §1.5. They run only when TEST_DATABASE_URL points at a
// disposable database that has all migrations applied.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

type TestUser = { id: string; name: string; roles: string[] };
type ApiResult = { status: number; body: any; headers: Headers; raw: Buffer };

describe("patient registry", { skip: !testDatabaseUrl }, () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 10);
  const user = (role: string, ...extra: string[]): TestUser => ({
    id: `tst-${role}-${token}`,
    name: `Test ${role}`,
    roles: [role, ...extra],
  });
  const registrar = user("registrar");
  const records = user("records_officer");
  const doctor = user("doctor");
  const nurse = user("nurse");
  const cashier = user("cashier");
  const dpo = user("dpo");
  const hr = user("hr_manager");
  const manager = user("unit_manager");

  const patientIds: string[] = [];
  let db: typeof import("../db/index.js").db;
  let schema: typeof import("../db/schema/index.js");
  let registry: typeof import("../lib/patientRegistry.js");
  let server: import("node:http").Server;
  let baseUrl = "";
  let unitId = "";
  let staffId = "";
  let phoneCounter = 0;
  // Limits name searches to this run's patients so the suite also passes on a populated database.
  const sinceFilter = `&registeredAt__gte=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`;

  const uniquePhone = () => {
    phoneCounter += 1;
    const digits = String(parseInt(token.slice(0, 6), 16) % 1_000_000).padStart(6, "0");
    return `024${digits.slice(0, 4)}${String(phoneCounter).padStart(3, "0")}`;
  };
  const randomDob = () => {
    const year = 1950 + Math.floor(Math.random() * 45);
    const month = 1 + Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const api = async (actor: TestUser, method: string, path: string, body?: unknown): Promise<ApiResult> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-user": JSON.stringify(actor) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = Buffer.from(await response.arrayBuffer());
    const isJson = (response.headers.get("content-type") ?? "").includes("json");
    return { status: response.status, body: isJson ? JSON.parse(raw.toString("utf8")) : null, headers: response.headers, raw };
  };

  const consents = [
    { consentType: "TREATMENT", status: "GRANTED" },
    { consentType: "DATA_PROCESSING", status: "GRANTED" },
  ];
  const draft = (overrides: Record<string, unknown> = {}) => ({
    firstName: "Kwame",
    lastName: `Mensah`,
    sex: "MALE",
    dateOfBirth: randomDob(),
    phone: uniquePhone(),
    consents,
    captureMethod: "PAPER",
    ...overrides,
  });
  const register = async (overrides: Record<string, unknown> = {}, actor = registrar) => {
    const result = await api(actor, "POST", "/patients", draft(overrides));
    if (result.status === 201) patientIds.push(result.body.data.id);
    return result;
  };
  const mustRegister = async (overrides: Record<string, unknown> = {}, actor = registrar) => {
    const result = await register({ acknowledgeDuplicates: true, duplicateOverrideReason: "Integration test fixture", ...overrides }, actor);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.data as { id: string; mrn: string; version: number; [key: string]: unknown };
  };
  const auditRows = (patientId: string, action: string) =>
    db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.patientId, patientId), eq(schema.auditLog.action, action)))
      .orderBy(desc(schema.auditLog.occurredAt));

  before(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const [dbModule, schemaModule, registryModule, patients, breakGlass, merge, problems, platform] = await Promise.all([
      import("../db/index.js"),
      import("../db/schema/index.js"),
      import("../lib/patientRegistry.js"),
      import("../routes/v1/patients.js"),
      import("../routes/v1/breakGlass.js"),
      import("../routes/v1/patientMerge.js"),
      import("../middleware/problemHandler.js"),
      import("../lib/platform.js"),
    ]);
    db = dbModule.db;
    schema = schemaModule;
    registry = registryModule;
    await platform.ensureAuditPartitions();

    await db.insert(schema.user).values(
      [registrar, records, doctor, nurse, cashier, dpo, hr, manager].map((entry) => ({
        id: entry.id,
        name: entry.name,
        email: `${entry.id}@example.test`,
      })),
    );
    const [unit] = await db
      .insert(schema.orgUnit)
      .values({ code: `TSTP_${token}`, name: `Patient test unit ${token}`, unitType: "CLINIC", isClinical: true })
      .returning();
    const [person] = await db
      .insert(schema.staff)
      .values({
        firstName: "Nurse",
        lastName: "Tester",
        email: `staff-${token}@example.test`,
        employeeId: `TSTP-${token}`,
        momoNumber: "0000000000",
        status: "active",
        userId: nurse.id,
      })
      .returning();
    assert.ok(unit && person);
    unitId = unit.id;
    staffId = person.id;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const header = req.header("x-test-user");
      if (header) req.user = JSON.parse(header);
      req.requestId = randomUUID();
      next();
    });
    app.use("/patients", patients.default);
    app.use("/break-glass", breakGlass.default);
    app.use("/privacy/break-glass-reviews", breakGlass.breakGlassReviewRoutes);
    app.use("/merge-tasks", merge.mergeTaskRoutes);
    app.use(problems.problemHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    if (!db) return;
    if (patientIds.length > 0) {
      const logs = await db
        .select({ id: schema.patientMergeLog.id })
        .from(schema.patientMergeLog)
        .where(or(inArray(schema.patientMergeLog.survivorId, patientIds), inArray(schema.patientMergeLog.mergedId, patientIds)));
      if (logs.length > 0) {
        const logIds = logs.map((log) => log.id);
        await db.delete(schema.patientMergeTask).where(inArray(schema.patientMergeTask.mergeLogId, logIds));
        await db.delete(schema.patientMergeLog).where(inArray(schema.patientMergeLog.id, logIds));
      }
      await db
        .delete(schema.patientDuplicateCandidate)
        .where(
          or(
            inArray(schema.patientDuplicateCandidate.patientAId, patientIds),
            inArray(schema.patientDuplicateCandidate.patientBId, patientIds),
          ),
        );
      await db.delete(schema.encounter).where(inArray(schema.encounter.patientId, patientIds));
      await db.delete(schema.visit).where(inArray(schema.visit.patientId, patientIds));
      await db.delete(schema.appointment).where(inArray(schema.appointment.patientId, patientIds));
      await db.delete(schema.consent).where(inArray(schema.consent.subjectId, patientIds));
      const grants = await db
        .delete(schema.breakGlassAccess)
        .where(inArray(schema.breakGlassAccess.patientId, patientIds))
        .returning({ id: schema.breakGlassAccess.id });
      if (grants.length > 0) {
        await db.delete(schema.notification).where(inArray(schema.notification.relatedEntityId, grants.map((grant) => grant.id)));
      }
      for (const table of [schema.patientIdentifier, schema.patientContact, schema.patientAllergy, schema.patientCondition]) {
        await db.delete(table).where(inArray(table.patientId, patientIds));
      }
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.patientId, patientIds));
      await db
        .update(schema.patient)
        .set({ status: "INACTIVE", mergedIntoId: null })
        .where(inArray(schema.patient.id, patientIds));
      await db.delete(schema.patient).where(inArray(schema.patient.id, patientIds));
    }
    if (staffId) await db.delete(schema.staff).where(eq(schema.staff.id, staffId));
    if (unitId) await db.delete(schema.orgUnit).where(eq(schema.orgUnit.id, unitId));
    await db.delete(schema.user).where(sql`${schema.user.id} LIKE ${`tst-%-${token}`}`);
  });

  test("search finds 'Kwame Mensah' for 'Kwame Mensa' and 'Mensah Kwame'", async () => {
    const phone = uniquePhone();
    const created = await mustRegister({ phone, identifiers: [{ idType: "NHIS", idValue: `7${token.replace(/\D/g, "0").slice(0, 7).padEnd(7, "3")}` }] });
    assert.match(created.mrn, /^MRN-\d{4}-\d{6}$/);

    for (const q of ["Kwame Mensa", "Mensah Kwame", "kwame mensah", "Mensa", created.mrn, created.mrn.toLowerCase(), phone]) {
      const result = await api(registrar, "GET", `/patients?q=${encodeURIComponent(q)}&limit=100${sinceFilter}`);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const ids = result.body.data.map((row: { id: string }) => row.id);
      assert.ok(ids.includes(created.id), `'${q}' should find the patient`);
      assert.equal(result.body.pagination.page, 1);
      assert.ok(result.body.pagination.total >= 1);
    }
    const exact = await api(registrar, "GET", `/patients?q=${created.mrn}`);
    assert.equal(exact.body.data[0].id, created.id, "an exact MRN match ranks first");
    assert.equal(exact.body.data[0].phone, phone);

    // No direct match: the search widens to surnames that sound alike.
    const rareName = token.replace(/[0-9]/g, (digit) => "ghjkmnpqrs"[Number(digit)] ?? "x").slice(0, 6);
    const soundAlike = await mustRegister({ firstName: rareName, lastName: "Kofi" });
    const phonetic = await api(registrar, "GET", `/patients?q=${rareName}%20Kauphy`);
    assert.deepEqual(phonetic.body.data.map((row: { id: string }) => row.id), [soundAlike.id]);
    assert.equal((await api(registrar, "GET", `/patients?q=${rareName}%20Zzyzx`)).body.pagination.total, 0);

    assert.equal((await api(registrar, "GET", "/patients?q=K")).status, 422);
    assert.equal((await api(registrar, "GET", "/patients?sort=height")).body.code, "LIST_FIELD_UNKNOWN");
    assert.equal((await api(hr, "GET", "/patients")).status, 403);
  });

  test("registration enforces consent, guardian and duplicate rules", async () => {
    const noConsent = await register({ consents: [{ consentType: "TREATMENT", status: "GRANTED" }] });
    assert.equal(noConsent.status, 422);
    assert.equal(noConsent.body.code, "PATIENT_CONSENT_REQUIRED");

    const minor = await register({ firstName: "Abena", dateOfBirth: `${new Date().getUTCFullYear() - 6}-01-15` });
    assert.equal(minor.status, 422);
    assert.equal(minor.body.code, "PATIENT_GUARDIAN_REQUIRED");
    const minorWithGuardian = await register({
      firstName: "Abena",
      lastName: `Owusu`,
      dateOfBirth: `${new Date().getUTCFullYear() - 6}-01-15`,
      phone: null,
      contacts: [{ contactType: "GUARDIAN", name: "Ama Owusu", relationship: "Mother", phone: uniquePhone(), canConsent: true }],
      acknowledgeDuplicates: true,
      duplicateOverrideReason: "Integration test fixture",
    });
    assert.equal(minorWithGuardian.status, 201, JSON.stringify(minorWithGuardian.body));
    assert.equal(minorWithGuardian.body.data.isMinor, true);
    const [minorConsent] = await db
      .select()
      .from(schema.consent)
      .where(eq(schema.consent.subjectId, minorWithGuardian.body.data.id))
      .limit(1);
    assert.equal(minorConsent?.guardianName, "Ama Owusu");

    const dateOfBirth = randomDob();
    const phone = uniquePhone();
    const original = await mustRegister({ firstName: "Yaa", lastName: "Asantewaa", dateOfBirth, phone });

    const probable = await register({ firstName: "Yaa", lastName: "Asantewaa", dateOfBirth, phone });
    assert.equal(probable.status, 409);
    assert.equal(probable.body.code, "PATIENT_DUPLICATE_CANDIDATES");
    assert.equal(probable.body.details.blocking, true);
    const candidate = probable.body.details.candidates.find((entry: any) => entry.patient.id === original.id);
    assert.ok(candidate && candidate.score >= 0.85 && candidate.level === "BLOCK");

    const live = await api(registrar, "POST", "/patients/duplicate-check", { firstName: "Yaa", lastName: "Asantewaa", dateOfBirth, phone });
    assert.equal(live.body.data.blocking, true);

    const withoutReason = await register({ firstName: "Yaa", lastName: "Asantewaa", dateOfBirth, phone, acknowledgeDuplicates: true });
    assert.equal(withoutReason.status, 422);
    assert.equal(withoutReason.body.code, "PATIENT_DUPLICATE_REASON_REQUIRED");

    const overridden = await register({
      firstName: "Yaa",
      lastName: "Asantewaa",
      dateOfBirth,
      phone,
      acknowledgeDuplicates: true,
      duplicateOverrideReason: "Twin sister sharing a family phone",
    });
    assert.equal(overridden.status, 201, JSON.stringify(overridden.body));
    const [override] = await auditRows(overridden.body.data.id, "OVERRIDE");
    assert.equal(override?.reason, "Twin sister sharing a family phone");
    const queue = await api(records, "GET", "/patients/duplicates?limit=100");
    const pair = queue.body.data.find((row: any) => [row.patientA.id, row.patientB.id].includes(overridden.body.data.id));
    assert.ok(pair, "the overridden pair is queued for records review");
    assert.equal(pair.source, "REGISTRATION");

    const similar = await register({ firstName: "Yaa", lastName: "Asantewa", dateOfBirth, phone: uniquePhone() });
    assert.equal(similar.status, 409);
    assert.equal(similar.body.details.blocking, false);
    const noneOfThese = await register({ firstName: "Yaa", lastName: "Asantewa", dateOfBirth, phone: uniquePhone(), acknowledgeDuplicates: true });
    assert.equal(noneOfThese.status, 201, JSON.stringify(noneOfThese.body));

    assert.equal((await api(records, "POST", `/patients/duplicates/${pair.id}/dismiss`)).status, 200);
    assert.equal((await api(records, "POST", `/patients/duplicates/${pair.id}/dismiss`)).status, 409);
    assert.equal((await api(registrar, "GET", "/patients/duplicates")).status, 403);
  });

  test("an identifier that is already in use cannot be registered again", async () => {
    const card = `GHA-${String(Date.now()).slice(-9)}-${Math.floor(Math.random() * 10)}`;
    const holder = await mustRegister({ firstName: "Kofi", lastName: "Boateng", identifiers: [{ idType: "GHANA_CARD", idValue: card }] });
    const second = await register({
      firstName: "Esi",
      lastName: "Quaye",
      sex: "FEMALE",
      identifiers: [{ idType: "GHANA_CARD", idValue: card.replace(/-/g, "").toLowerCase() }],
      acknowledgeDuplicates: true,
      duplicateOverrideReason: "Trying to reuse an identifier",
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "PATIENT_IDENTIFIER_IN_USE");
    assert.equal(second.body.details.candidates[0].patient.id, holder.id);

    const bad = await register({ identifiers: [{ idType: "NHIS", idValue: "12" }] });
    assert.equal(bad.body.code, "PATIENT_IDENTIFIER_INVALID");
  });

  test("MRNs are gapless under 50 concurrent registrations and failed registrations use no number", async () => {
    const lastValue = async () => {
      const { year } = await registry.facilityToday();
      const [row] = await db
        .select({ lastValue: schema.documentSequence.lastValue })
        .from(schema.documentSequence)
        .where(and(eq(schema.documentSequence.docType, "MRN"), eq(schema.documentSequence.periodKey, year)));
      return row?.lastValue ?? 0;
    };
    const start = await lastValue();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        register({ firstName: `Load${index}`, lastName: `Zz${token}${index}`, acknowledgeDuplicates: true, duplicateOverrideReason: "Load test fixture" }),
      ),
    );
    assert.deepEqual([...new Set(results.map((result) => result.status))], [201]);
    const numbers = results.map((result) => Number(result.body.data.mrn.split("-")[2])).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: 50 }, (_unused, index) => start + index + 1));
    assert.equal(await lastValue(), start + 50);

    // A registration that fails inside the statement must roll its MRN allocation back.
    const taken = await db
      .select({ idType: schema.patientIdentifier.idType, idValue: schema.patientIdentifier.idValue })
      .from(schema.patientIdentifier)
      .where(and(inArray(schema.patientIdentifier.patientId, patientIds), eq(schema.patientIdentifier.status, "ACTIVE")))
      .limit(1);
    assert.ok(taken[0]);
    await assert.rejects(
      registry.createPatient(
        {
          unidentified: false,
          firstName: "Rollback",
          middleName: null,
          lastName: `Zz${token}`,
          preferredName: null,
          sex: "MALE",
          dateOfBirth: "1980-01-01",
          dobEstimated: false,
          estimatedAgeYears: null,
          maritalStatus: null,
          nationality: null,
          religion: null,
          occupation: null,
          bloodGroup: null,
          phone: null,
          altPhone: null,
          email: null,
          addressLine: null,
          town: null,
          district: null,
          region: null,
          digitalAddress: null,
          confidentiality: "NORMAL",
          registeredUnitId: null,
          identifiers: [{ idType: taken[0].idType as "NHIS", idValue: taken[0].idValue, issuer: null, validTo: null }],
          contacts: [],
          consents: [],
          captureMethod: "PAPER",
          witnessStaffId: null,
          guardianName: null,
          guardianRelationship: null,
          policyVersion: "test",
        },
        registrar.id,
      ),
      (error: { code?: string }) => error.code === "PATIENT_IDENTIFIER_IN_USE",
    );
    assert.equal(await lastValue(), start + 50);
    const next = await mustRegister({ firstName: "After", lastName: `Zz${token}` });
    assert.equal(Number(next.mrn.split("-")[2]), start + 51);
  });

  test("a restricted chart needs break-glass, is audited and lands in the review queue", async () => {
    const vip = await mustRegister({ firstName: "Nana", lastName: `Vip${token}`, confidentiality: "VIP" }, records);

    const denied = await api(doctor, "GET", `/patients/${vip.id}`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "BREAK_GLASS_REQUIRED");
    assert.equal(denied.body.details.restriction, "VIP");
    assert.equal(JSON.stringify(denied.body).includes(`Vip${token}`), false, "the refusal must not echo PHI");
    const [deniedAudit] = await auditRows(vip.id, "READ_RESTRICTED");
    assert.ok(deniedAudit?.reason?.startsWith("DENIED"));
    assert.equal(deniedAudit?.actorUserId, doctor.id);

    const masked = await api(doctor, "GET", `/patients?q=${encodeURIComponent(`Nana Vip${token}`)}`);
    const maskedRow = masked.body.data.find((row: any) => row.id === vip.id);
    assert.equal(maskedRow.masked, true);
    assert.equal(maskedRow.lastName, null);
    assert.equal(maskedRow.mrn, null);

    const tooShort = await api(doctor, "POST", "/break-glass", { patientId: vip.id, reason: "curious" });
    assert.equal(tooShort.status, 422);
    assert.equal(tooShort.body.code, "BREAK_GLASS_REASON_TOO_SHORT");
    const reason = "Emergency resuscitation in the ED";
    const granted = await api(doctor, "POST", "/break-glass", { patientId: vip.id, reason });
    assert.equal(granted.status, 201, JSON.stringify(granted.body));
    const hours = (new Date(granted.body.data.expiresAt).getTime() - new Date(granted.body.data.grantedAt).getTime()) / 3_600_000;
    assert.ok(Math.abs(hours - 4) < 0.01, "grants last four hours");
    assert.equal((await api(doctor, "POST", "/break-glass", { patientId: vip.id, reason })).body.data.id, granted.body.data.id);
    assert.equal((await auditRows(vip.id, "BREAK_GLASS"))[0]?.reason, reason);

    const opened = await api(doctor, "GET", `/patients/${vip.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.data.lastName, `Vip${token}`);
    assert.equal(opened.body.data.restriction, "VIP");
    assert.equal(opened.body.data.breakGlass.reason, reason);
    const unmasked = await api(doctor, "GET", `/patients?q=${encodeURIComponent(`Nana Vip${token}`)}`);
    assert.equal(unmasked.body.data.find((row: any) => row.id === vip.id).masked, false);
    assert.equal((await api(nurse, "GET", `/patients/${vip.id}`)).status, 403, "grants are per user");

    const queue = await api(dpo, "GET", "/privacy/break-glass-reviews?status=PENDING&limit=100");
    assert.equal(queue.status, 200);
    const entry = queue.body.data.find((row: any) => row.id === granted.body.data.id);
    assert.equal(entry.userName, doctor.name);
    assert.equal(entry.patientMrn, vip.mrn);
    assert.equal(entry.reason, reason);
    assert.equal((await api(doctor, "GET", "/privacy/break-glass-reviews")).status, 403);

    // A unit manager only reviews access to patients registered in their own units.
    const unscoped = await api(manager, "GET", "/privacy/break-glass-reviews?status=ALL&limit=100");
    assert.equal(unscoped.status, 200);
    assert.deepEqual(unscoped.body.data, []);
    assert.equal((await api(manager, "POST", `/privacy/break-glass-reviews/${entry.id}/review`, { outcome: "JUSTIFIED" })).status, 404);

    const selfReview = await api({ ...doctor, roles: ["doctor", "dpo"] }, "POST", `/privacy/break-glass-reviews/${entry.id}/review`, { outcome: "JUSTIFIED" });
    assert.equal(selfReview.status, 403);
    assert.equal(selfReview.body.code, "BREAK_GLASS_SELF_REVIEW");
    assert.equal((await api(dpo, "POST", `/privacy/break-glass-reviews/${entry.id}/review`, { outcome: "UNJUSTIFIED" })).status, 422);
    const reviewed = await api(dpo, "POST", `/privacy/break-glass-reviews/${entry.id}/review`, { outcome: "JUSTIFIED", note: "ED attendance confirmed" });
    assert.equal(reviewed.status, 200);
    assert.equal((await api(dpo, "POST", `/privacy/break-glass-reviews/${entry.id}/review`, { outcome: "JUSTIFIED" })).status, 409);
    const reviewedQueue = await api(dpo, "GET", "/privacy/break-glass-reviews?status=REVIEWED&limit=100");
    assert.equal(reviewedQueue.body.data.find((row: any) => row.id === entry.id).reviewOutcome, "JUSTIFIED");
  });

  test("staff cannot open their own patient record without break-glass", async () => {
    const own = await mustRegister({
      firstName: "Nurse",
      lastName: `Self${token}`,
      sex: "FEMALE",
      identifiers: [{ idType: "STAFF_ID", idValue: `TSTP-${token}` }],
    });
    const self = await api(nurse, "GET", `/patients/${own.id}`);
    assert.equal(self.status, 403);
    assert.equal(self.body.details.restriction, "SELF");
    assert.equal((await api(doctor, "GET", `/patients/${own.id}`)).status, 200);
  });

  test("the serializer is role-aware and partial updates leave other fields alone", async () => {
    const phone = uniquePhone();
    const created = await mustRegister({ firstName: "Efua", lastName: `Role${token}`, sex: "FEMALE", phone, occupation: "Trader", town: "Tamale" });

    const minimal = await api(cashier, "GET", `/patients/${created.id}`);
    assert.equal(minimal.status, 200);
    assert.equal(minimal.body.data.mrn, created.mrn);
    assert.equal("phone" in minimal.body.data, false);
    assert.equal("occupation" in minimal.body.data, false);
    assert.ok(minimal.body.data.redacted.includes("phone"));
    assert.equal((await api(cashier, "GET", `/patients/${created.id}/identifiers`)).status, 403);
    assert.equal((await api(cashier, "GET", `/patients/${created.id}/allergies`)).status, 200);
    assert.equal((await api(cashier, "PATCH", `/patients/${created.id}`, { occupation: "x" })).status, 403);

    const patched = await api(registrar, "PATCH", `/patients/${created.id}`, { occupation: "Seamstress", version: created.version });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.data.occupation, "Seamstress");
    assert.equal(patched.body.data.phone, phone);
    assert.equal(patched.body.data.town, "Tamale");
    assert.equal(patched.body.data.dobEstimated, false);
    assert.equal(patched.body.data.version, created.version + 1);
    const [updateAudit] = await auditRows(created.id, "UPDATE");
    assert.deepEqual(updateAudit?.after, { occupation: "[REDACTED]" });

    const stale = await api(registrar, "PATCH", `/patients/${created.id}`, { occupation: "Farmer", version: created.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "CONCURRENT_MODIFICATION");
    assert.equal((await api(registrar, "PATCH", `/patients/${created.id}`, { phone: null })).body.code, "PATIENT_CONTACT_REQUIRED");

    const deceased = await api(records, "PATCH", `/patients/${created.id}`, { status: "DECEASED" });
    assert.equal(deceased.body.data.status, "DECEASED");
    assert.ok(deceased.body.data.deceasedAt);
    assert.equal((await auditRows(created.id, "STATUS_CHANGE")).length, 1);
  });

  test("chart items, consent-gated photo and prints", async (t) => {
    const child = await mustRegister({
      firstName: "Kojo",
      lastName: `Item${token}`,
      dateOfBirth: `${new Date().getUTCFullYear() - 9}-03-03`,
      contacts: [{ contactType: "GUARDIAN", name: "Akua Item", relationship: "Mother", canConsent: true }],
      registeredUnitId: unitId,
    });
    const base = `/patients/${child.id}`;

    const contacts = await api(registrar, "GET", `${base}/contacts`);
    assert.equal(contacts.body.data.length, 1);
    const guardianId = contacts.body.data[0].id;
    assert.equal((await api(registrar, "DELETE", `${base}/contacts/${guardianId}`)).body.code, "PATIENT_GUARDIAN_REQUIRED");
    assert.equal((await api(registrar, "PATCH", `${base}/contacts/${guardianId}`, { canConsent: false })).body.code, "PATIENT_GUARDIAN_REQUIRED");
    const renamed = await api(registrar, "PATCH", `${base}/contacts/${guardianId}`, { phone: "0200000001" });
    assert.equal(renamed.body.data.name, "Akua Item");
    assert.equal(renamed.body.data.canConsent, true);

    const identifier = await api(registrar, "POST", `${base}/identifiers`, { idType: "NHIS", idValue: String(Date.now()).slice(-8) });
    assert.equal(identifier.status, 201, JSON.stringify(identifier.body));
    assert.equal((await api(registrar, "POST", `${base}/identifiers`, { idType: "NHIS", idValue: "87654321" })).body.code, "PATIENT_IDENTIFIER_DUPLICATE");
    const verified = await api(registrar, "PATCH", `${base}/identifiers/${identifier.body.data.id}`, { verified: true });
    assert.equal(verified.body.data.verified, true);
    const listed = await api(registrar, "GET", `${base}/identifiers`);
    assert.equal(listed.body.data[0].verifiedByName, registrar.name);
    assert.equal("verifiedBy" in listed.body.data[0], false);
    const alternateIdentifier = await api(registrar, "POST", `${base}/identifiers`, {
      idType: "NHIS",
      idValue: String(Date.now() - 1).slice(-8),
    });
    assert.equal(alternateIdentifier.status, 201);
    await api(registrar, "PATCH", `${base}/identifiers/${identifier.body.data.id}`, { status: "INACTIVE" });
    const blockedReactivation = await api(registrar, "PATCH", `${base}/identifiers/${identifier.body.data.id}`, {
      status: "ACTIVE",
    });
    assert.equal(blockedReactivation.body.code, "PATIENT_IDENTIFIER_IN_USE");
    await api(registrar, "PATCH", `${base}/identifiers/${alternateIdentifier.body.data.id}`, { status: "INACTIVE" });
    const reactivated = await api(registrar, "PATCH", `${base}/identifiers/${identifier.body.data.id}`, {
      status: "ACTIVE",
    });
    assert.equal(reactivated.body.data.status, "ACTIVE");

    assert.equal((await api(registrar, "POST", `${base}/allergies`, { category: "DRUG", substance: "Penicillin" })).status, 403);
    const allergy = await api(nurse, "POST", `${base}/allergies`, { category: "DRUG", substance: "Penicillin", severity: "SEVERE", reaction: "Anaphylaxis" });
    assert.equal(allergy.status, 201, JSON.stringify(allergy.body));
    const chart = await api(nurse, "GET", base);
    assert.equal(chart.body.data.allergies[0].substance, "Penicillin");
    const resolved = await api(doctor, "PATCH", `${base}/allergies/${allergy.body.data.id}`, { status: "ENTERED_IN_ERROR" });
    assert.equal(resolved.body.data.status, "ENTERED_IN_ERROR");
    assert.equal(resolved.body.data.severity, "SEVERE");

    const condition = await api(doctor, "POST", `${base}/conditions`, { description: "Asthma", icd10Code: "j45", isChronic: true });
    assert.equal(condition.body.data.icd10Code, "J45");
    assert.equal((await api(doctor, "GET", `${base}/conditions`)).body.data[0].recordedByName, doctor.name);

    await t.test(
      "patient photo upload validation and photography consent",
      { skip: !process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET },
      async () => {
        const { cloudinary } = await import("../lib/cloudinary.js");
        const cloudinaryConfig = cloudinary.config();
        assert.ok(cloudinaryConfig.cloud_name && cloudinaryConfig.api_secret);
        const photoPublicId = `patients/${child.id}/photo`;
        const photoUploadVersion = 1794413500;
        const photo = {
          photoUrl: `https://res.cloudinary.com/${cloudinaryConfig.cloud_name}/image/upload/v${photoUploadVersion}/${photoPublicId}.jpg`,
          photoPublicId,
          photoUploadSignature: createHash("sha1")
            .update(`public_id=${photoPublicId}&version=${photoUploadVersion}${cloudinaryConfig.api_secret}`)
            .digest("hex"),
          photoUploadVersion,
        };
        const unownedPhoto = {
          photoUrl: "https://res.cloudinary.com/demo/image/upload/patients/another-patient/photo.jpg",
          photoPublicId: "patients/another-patient/photo",
        };
        const ownershipRefused = await api(registrar, "POST", `${base}/photo`, unownedPhoto);
        assert.equal(ownershipRefused.status, 422);
        assert.equal(ownershipRefused.body.code, "PATIENT_PHOTO_OWNERSHIP_INVALID");
        const forgedUpload = await api(registrar, "POST", `${base}/photo`, {
          ...photo,
          photoUploadSignature: "0".repeat(40),
        });
        assert.equal(forgedUpload.status, 422);
        assert.equal(forgedUpload.body.code, "PATIENT_PHOTO_OWNERSHIP_INVALID");
        const refused = await api(registrar, "POST", `${base}/photo`, photo);
        assert.equal(refused.status, 403);
        assert.equal(refused.body.code, "CONSENT_REQUIRED");
        const verbal = await api(registrar, "POST", `${base}/consents`, { consentType: "PHOTOGRAPHY", status: "GRANTED", captureMethod: "VERBAL_WITNESSED" });
        assert.equal(verbal.body.code, "PATIENT_CONSENT_WITNESS_REQUIRED");
        const consent = await api(registrar, "POST", `${base}/consents`, {
          consentType: "PHOTOGRAPHY",
          status: "GRANTED",
          captureMethod: "VERBAL_WITNESSED",
          witnessStaffId: staffId,
          guardianName: "Akua Item",
          guardianRelationship: "Mother",
        });
        assert.equal(consent.status, 201, JSON.stringify(consent.body));
        const consentView = await api(registrar, "GET", `${base}/consents`);
        assert.equal(consentView.body.data.effective.find((row: any) => row.consentType === "PHOTOGRAPHY").status, "GRANTED");
        assert.equal(consentView.body.data.effective.find((row: any) => row.consentType === "SMS_CONTACT").status, "NOT_RECORDED");
        assert.equal(consentView.body.data.history[0].witnessName, "Nurse Tester");
        assert.equal((await api(registrar, "POST", `${base}/photo`, photo)).body.data.photoUrl, photo.photoUrl);
      },
    );

    for (const kind of ["wristband", "card"]) {
      const pdf = await api(nurse, "GET", `${base}/${kind}`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.ok(pdf.raw.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
      assert.ok(pdf.raw.toString("latin1").includes(Buffer.from(child.mrn, "latin1").toString("hex")));
    }
    assert.equal((await auditRows(child.id, "PRINT")).length, 2);
    assert.equal((await api(cashier, "GET", `${base}/card`)).status, 403);

    const audit = await api(records, "GET", `${base}/audit?limit=100`);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.data.some((row: any) => row.action === "PRINT" && row.actorName === nurse.name));
    assert.equal(audit.body.data.every((row: any) => !("actorUserId" in row)), true);
    assert.equal((await api(registrar, "GET", `${base}/audit`)).status, 403);
  });

  test("unidentified patient is identified, or merged into an existing record with re-pointing", async () => {
    const unknown = await api(doctor, "POST", "/patients", { unidentified: true, sex: "MALE", estimatedAgeYears: 40, registeredUnitId: unitId });
    assert.equal(unknown.status, 201, JSON.stringify(unknown.body));
    patientIds.push(unknown.body.data.id);
    assert.equal(unknown.body.data.firstName, "UNKNOWN");
    assert.match(unknown.body.data.lastName, /^MALE \d{8}-\d{2}$/);
    assert.equal(unknown.body.data.isUnidentified, true);
    assert.equal(unknown.body.data.ageYears, 40);

    const second = await api(doctor, "POST", "/patients", { unidentified: true, sex: "MALE", estimatedAgeYears: 25 });
    patientIds.push(second.body.data.id);
    assert.notEqual(second.body.data.lastName, unknown.body.data.lastName);
    assert.equal((await api(registrar, "PATCH", `/patients/${second.body.data.id}`, { firstName: "Kofi" })).body.code, "PATIENT_IDENTIFY_REQUIRED");
    const identified = await api(registrar, "POST", `/patients/${second.body.data.id}/identify`, {
      ...draft({ firstName: "Kofi", lastName: `Found${token}` }),
      identifiers: [{ idType: "PASSPORT", idValue: `G${String(Date.now()).slice(-7)}` }],
    });
    assert.equal(identified.status, 200, JSON.stringify(identified.body));
    assert.equal(identified.body.data.isUnidentified, false);
    assert.equal(identified.body.data.mrn, second.body.data.mrn);
    assert.equal(identified.body.data.lastName, `Found${token}`);
    assert.equal((await api(registrar, "GET", `/patients/${second.body.data.id}/identifiers`)).body.data.length, 1);
    assert.equal((await api(registrar, "POST", `/patients/${second.body.data.id}/identify`, draft())).body.code, "PATIENT_ALREADY_IDENTIFIED");

    const unknownId = unknown.body.data.id as string;
    await api(doctor, "POST", `/patients/${unknownId}/allergies`, { category: "FOOD", substance: "Groundnut", severity: "MODERATE" });
    const start = new Date(Date.now() + 86_400_000);
    await db.insert(schema.appointment).values({
      patientId: unknownId,
      orgUnitId: unitId,
      appointmentType: "NEW",
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 1_800_000),
      bookedBy: registrar.id,
    });
    const [visit] = await db
      .insert(schema.visit)
      .values({ visitNo: `V${token}`.slice(0, 20), patientId: unknownId, visitType: "EMERGENCY", visitDate: "2026-10-12", currentUnitId: unitId })
      .returning();
    assert.ok(visit);
    await db.insert(schema.encounter).values({
      visitId: visit.id,
      patientId: unknownId,
      encounterType: "ED_CONSULT",
      providerStaffId: staffId,
      orgUnitId: unitId,
    });

    const existing = await mustRegister({ firstName: "Yaw", lastName: `Known${token}` });
    const merged = await api(doctor, "POST", `/patients/${unknownId}/identify`, {
      mergeIntoPatientId: existing.id,
      reason: "Relatives confirmed the identity at the bedside",
    });
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.data.status, "DONE");

    for (const table of [schema.appointment, schema.visit, schema.encounter, schema.patientAllergy]) {
      const moved = await db.select({ patientId: table.patientId }).from(table).where(inArray(table.patientId, [unknownId, existing.id]));
      assert.deepEqual([...new Set(moved.map((row) => row.patientId))], [existing.id]);
    }
    const tasks = await api(records, "GET", `/merge-tasks/${merged.body.data.mergeLogId}`);
    assert.equal(tasks.body.data.status, "DONE");
    assert.equal(tasks.body.data.tasks.length, registry.MERGE_MODULES.length);
    assert.equal(tasks.body.data.tasks.find((task: any) => task.module === "appointments").rowsMoved, 2);
    assert.equal(tasks.body.data.merged.mrn, unknown.body.data.mrn);
    assert.ok((await api(records, "GET", "/merge-tasks")).body.data.some((row: any) => row.id === merged.body.data.mergeLogId));

    const pointer = await api(doctor, "GET", `/patients/${unknownId}`);
    assert.deepEqual(pointer.body.data, { id: unknownId, mrn: unknown.body.data.mrn, status: "MERGED", mergedIntoId: existing.id });
    const byOldMrn = await api(registrar, "GET", `/patients?q=${unknown.body.data.mrn}`);
    assert.equal(byOldMrn.body.data.length, 1);
    assert.equal(byOldMrn.body.data[0].id, existing.id);
    assert.equal(byOldMrn.body.meta.mergedFromMrn, unknown.body.data.mrn);
    assert.equal((await api(doctor, "GET", `/patients/${unknownId}/allergies`)).status, 404);

    const timeline = await api(doctor, "GET", `/patients/${existing.id}/timeline`);
    const types = timeline.body.data.map((event: any) => event.type);
    for (const type of ["REGISTRATION", "MERGE", "APPOINTMENT", "VISIT", "ENCOUNTER"]) assert.ok(types.includes(type), type);
    assert.equal(timeline.body.data.find((event: any) => event.type === "VISIT").unitName, `Patient test unit ${token}`);
    assert.equal((await api(registrar, "GET", `/patients/${existing.id}/timeline`)).status, 403);
  });

  test("merge applies pre-checks, field picks and tracks a failing module until it is retried", async () => {
    const stamp = String(Date.now()).slice(-7);
    const survivor = await mustRegister({ firstName: "Adwoa", lastName: `Keep${token}`, sex: "FEMALE", identifiers: [{ idType: "NHIS", idValue: `1${stamp}` }] });
    const duplicate = await mustRegister({ firstName: "Adwoa", lastName: `Drop${token}`, sex: "FEMALE", occupation: "Baker", identifiers: [{ idType: "NHIS", idValue: `2${stamp}` }] });
    const duplicatePhone = (await api(records, "GET", `/patients/${duplicate.id}`)).body.data.phone;

    const preview = await api(records, "GET", `/patients/merge/preview?survivorId=${survivor.id}&mergedId=${duplicate.id}`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.canMerge, false);
    assert.equal(preview.body.data.prechecks.find((check: any) => !check.passed).code, "PATIENT_MERGE_IDENTIFIER_CONFLICT");
    const payload = { survivorId: survivor.id, mergedId: duplicate.id, reason: "Same person registered twice", takeFromMerged: ["phone", "occupation"] };
    const blocked = await api(records, "POST", "/patients/merge", payload);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "PATIENT_MERGE_IDENTIFIER_CONFLICT");
    assert.equal((await api(registrar, "POST", "/patients/merge", payload)).status, 403);
    assert.equal((await api(records, "POST", "/patients/merge", { ...payload, mergedId: survivor.id })).status, 422);

    const duplicateIdentifiers = await api(records, "GET", `/patients/${duplicate.id}/identifiers`);
    await api(records, "PATCH", `/patients/${duplicate.id}/identifiers/${duplicateIdentifiers.body.data[0].id}`, { status: "INACTIVE" });

    // Overlapping booked appointments violate the patient-overlap constraint when re-pointed.
    const start = new Date(Date.now() + 2 * 86_400_000);
    const slot = { orgUnitId: unitId, appointmentType: "REVIEW", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 1_800_000), bookedBy: registrar.id };
    await db.insert(schema.appointment).values({ ...slot, patientId: survivor.id });
    const [clash] = await db.insert(schema.appointment).values({ ...slot, patientId: duplicate.id }).returning();
    assert.ok(clash);

    const merged = await api(records, "POST", "/patients/merge", payload);
    assert.equal(merged.status, 201, JSON.stringify(merged.body));
    assert.equal(merged.body.data.status, "FAILED");
    const failing = merged.body.data.tasks.find((task: any) => task.module === "appointments");
    assert.equal(failing.status, "FAILED");
    assert.ok(failing.note.length > 0);
    assert.equal(merged.body.data.tasks.filter((task: any) => task.status === "DONE").length, registry.MERGE_MODULES.length - 1);

    const kept = await api(records, "GET", `/patients/${survivor.id}`);
    assert.equal(kept.body.data.phone, duplicatePhone);
    assert.equal(kept.body.data.occupation, "Baker");
    assert.equal(kept.body.data.lastName, `Keep${token}`);
    const [log] = await db.select().from(schema.patientMergeLog).where(eq(schema.patientMergeLog.id, merged.body.data.mergeLogId));
    assert.equal((log?.snapshot as any).merged.lastName, `Drop${token}`);
    assert.equal((log?.snapshot as any).survivor.identifiers.length, 1);
    assert.equal((await api(records, "POST", "/patients/merge", payload)).status, 409, "a merged record cannot be merged again");

    await db.update(schema.appointment).set({ status: "CANCELLED" }).where(eq(schema.appointment.id, clash.id));
    const retried = await api(records, "POST", `/merge-tasks/${merged.body.data.mergeLogId}/retry`);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.data.status, "DONE");
    assert.equal(retried.body.data.tasks.find((task: any) => task.module === "appointments").attempts, 2);
  });

  test("the duplicate sweep queues pairs that slipped past registration", async () => {
    const dateOfBirth = randomDob();
    const first = await mustRegister({ firstName: "Akosua", lastName: `Sweep${token}`, sex: "FEMALE", dateOfBirth });
    const [second] = await db
      .insert(schema.patient)
      .values({ mrn: `TST-${token}`, firstName: "Akosua", lastName: `Sweep${token}`, sex: "FEMALE", dateOfBirth })
      .returning();
    assert.ok(second);
    patientIds.push(second.id);

    const sweep = await api(records, "POST", "/patients/duplicates/sweep", { sinceDays: 1 });
    assert.equal(sweep.status, 200, JSON.stringify(sweep.body));
    assert.ok(sweep.body.data.scanned >= 2);
    const [pair] = await db
      .select()
      .from(schema.patientDuplicateCandidate)
      .where(
        and(
          inArray(schema.patientDuplicateCandidate.patientAId, [first.id, second.id]),
          inArray(schema.patientDuplicateCandidate.patientBId, [first.id, second.id]),
        ),
      );
    assert.equal(pair?.status, "PENDING");
    assert.equal(pair?.source, "SWEEP");
    assert.ok(Number(pair?.score) >= 0.85);
  });
});
