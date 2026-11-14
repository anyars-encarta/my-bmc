import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("Sprint 8 appointment booking and charge import", { skip: !testDatabaseUrl }, () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 10);
  const registrar = { id: `tst-registrar-${token}`, roles: ["registrar"] };
  const cashier = { id: `tst-cashier-${token}`, roles: ["cashier"] };
  let db: typeof import("../db/index.js").db;
  let schema: typeof import("../db/schema/index.js");
  let server: import("node:http").Server;
  let baseUrl = "";
  let unitId = "";
  let slotId = "";
  let overlapSlotId = "";
  let serviceId = "";
  let priceListId = "";
  let patientIds: string[] = [];
  let bookedPatientId = "";

  const api = async (actor: typeof registrar | typeof cashier, path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": JSON.stringify(actor) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };

  before(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const [dbModule, schemaModule, appointments, problems] = await Promise.all([
      import("../db/index.js"),
      import("../db/schema/index.js"),
      import("../routes/v1/appointments.js"),
      import("../middleware/problemHandler.js"),
    ]);
    db = dbModule.db;
    schema = schemaModule;

    const [unit] = await db.insert(schema.orgUnit).values({
      code: `TSTA_${token}`,
      name: `Appointment test clinic ${token}`,
      unitType: "CLINIC",
      isClinical: true,
    }).returning();
    assert.ok(unit);
    unitId = unit.id;

    const [slot] = await db.insert(schema.appointmentSlot).values({
      orgUnitId: unitId,
      startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      endsAt: new Date(Date.now() + 24 * 60 * 60_000 + 30 * 60_000),
      capacity: 1,
      bookedCount: 0,
      status: "OPEN",
    }).returning();
    assert.ok(slot);
    slotId = slot.id;

    patientIds = (await db.insert(schema.patient).values(
      Array.from({ length: 50 }, (_, index) => ({
        mrn: `TSTA-${token}-${String(index).padStart(2, "0")}`,
        firstName: "Booking",
        lastName: `Patient${index}`,
        sex: "OTHER",
        registeredUnitId: unitId,
      })),
    ).returning({ id: schema.patient.id })).map((patient) => patient.id);

    const [service] = await db.insert(schema.serviceItem).values({
      code: `TSTA_${token}`,
      name: "Appointment test consultation",
      category: "CONSULTATION",
    }).returning();
    const [priceList] = await db.insert(schema.priceList).values({
      code: `TSTA_${token}`,
      name: "Appointment test cash prices",
      payerType: "CASH",
    }).returning();
    assert.ok(service && priceList);
    serviceId = service.id;
    priceListId = priceList.id;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const header = req.header("x-test-user");
      if (header) req.user = JSON.parse(header);
      req.requestId = randomUUID();
      next();
    });
    app.use("/v1", appointments.default);
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
      await db.delete(schema.appointment).where(inArray(schema.appointment.patientId, patientIds));
      await db.delete(schema.patient).where(inArray(schema.patient.id, patientIds));
    }
    if (slotId) await db.delete(schema.appointmentSlot).where(eq(schema.appointmentSlot.id, slotId));
    if (overlapSlotId) await db.delete(schema.appointmentSlot).where(eq(schema.appointmentSlot.id, overlapSlotId));
    if (priceListId) await db.delete(schema.priceListItem).where(eq(schema.priceListItem.priceListId, priceListId));
    if (priceListId) await db.delete(schema.priceList).where(eq(schema.priceList.id, priceListId));
    if (serviceId) await db.delete(schema.serviceItem).where(eq(schema.serviceItem.id, serviceId));
    if (unitId) await db.delete(schema.orgUnit).where(eq(schema.orgUnit.id, unitId));
  });

  test("50 simultaneous requests cannot claim a single appointment slot", async () => {
    const results = await Promise.all(patientIds.map((patientId) => api(registrar, "/v1/appointments", {
      patientId,
      slotId,
      appointmentType: "NEW",
    })));
    assert.equal(results.filter((result) => result.status === 201).length, 1);
    assert.equal(results.filter((result) => result.status === 409 && result.body.code === "SLOT_FULL").length, 49);
    bookedPatientId = results.find((result) => result.status === 201)!.body.data.patientId;
  });

  test("an overlapping appointment is rejected without consuming another slot", async () => {
    const [existingSlot] = await db.select().from(schema.appointmentSlot).where(eq(schema.appointmentSlot.id, slotId));
    assert.ok(existingSlot);
    const [overlapSlot] = await db.insert(schema.appointmentSlot).values({
      orgUnitId: unitId,
      startsAt: new Date(existingSlot.startsAt.getTime() + 15 * 60_000),
      endsAt: new Date(existingSlot.endsAt.getTime() + 15 * 60_000),
      capacity: 1,
      bookedCount: 0,
      status: "OPEN",
    }).returning();
    assert.ok(overlapSlot);
    overlapSlotId = overlapSlot.id;

    const result = await api(registrar, "/v1/appointments", {
      patientId: bookedPatientId,
      slotId: overlapSlotId,
      appointmentType: "FOLLOW_UP",
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "PATIENT_APPOINTMENT_OVERLAP");
    const [unchangedSlot] = await db.select().from(schema.appointmentSlot).where(eq(schema.appointmentSlot.id, overlapSlotId));
    assert.equal(unchangedSlot?.bookedCount, 0);
  });

  test("CSV dry-run excludes rows with overlapping dated prices from validRows", async () => {
    const result = await api(cashier, `/v1/price-lists/${priceListId}/import`, {
      dryRun: true,
      csv: [
        "service_code,price,effective_from,effective_to",
        `${`TSTA_${token}`},25.00,2035-01-01,2035-01-31`,
        `${`TSTA_${token}`},30.00,2035-01-20,2035-02-01`,
      ].join("\n"),
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.validRows, 1);
    assert.deepEqual(result.body.data.errors.map((error: { row: number }) => error.row), [3]);
  });
});
