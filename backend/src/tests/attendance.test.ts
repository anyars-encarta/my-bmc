import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import assert from "node:assert/strict";

import {
  attendanceClockOutDeadline,
  calculateAttendanceMetrics,
  credentialIsUsable,
  decideOpenPunch,
  facilityDate,
  findNearestShift,
  punchHasClockSkew,
  punchIsDebounced,
  punchIsTooFarInFuture,
} from "../lib/attendance.js";
import { TerminalSimulatorAdapter, type RawPunch } from "../lib/deviceAdapter.js";

const instant = (value: string) => new Date(value);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("night attendance keeps the roster start date after clock-out next morning", () => {
  const night = {
    id: "night-entry",
    rosterDate: "2026-10-12",
    plannedStart: instant("2026-10-12T19:00:00Z"),
    plannedEnd: instant("2026-10-13T07:00:00Z"),
    earlyInMinutes: 60,
  };
  const matched = findNearestShift([night], instant("2026-10-12T19:50:00Z"));

  assert.equal(matched?.rosterDate, "2026-10-12");
  assert.equal(facilityDate(instant("2026-10-13T07:04:00Z"), "Africa/Accra"), "2026-10-13");
});

test("a punch with no eligible roster entry remains unrostered", () => {
  const saturday = instant("2026-10-17T09:00:00Z");
  assert.equal(findNearestShift([], saturday), undefined);
});

test("07:00 clock-out closes the open night record before matching a morning shift", () => {
  const deadline = attendanceClockOutDeadline(
    instant("2026-10-12T19:50:00Z"),
    instant("2026-10-13T07:00:00Z"),
    120,
  );
  assert.equal(decideOpenPunch(instant("2026-10-13T07:00:00Z"), deadline), "CLOCK_OUT");
});

test("morning shift metrics include worked time and ignore early clock-in for lateness", () => {
  const result = calculateAttendanceMetrics({
    clockInAt: instant("2026-10-12T06:55:00Z"),
    clockOutAt: instant("2026-10-12T14:03:00Z"),
    plannedStart: instant("2026-10-12T07:00:00Z"),
    plannedEnd: instant("2026-10-12T14:00:00Z"),
    graceLateMinutes: 15,
    breakMinutes: 0,
  });
  assert.deepEqual(result, {
    workedMinutes: 420,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 3,
  });
});

test("afternoon shift applies the grace period to lateness", () => {
  const result = calculateAttendanceMetrics({
    clockInAt: instant("2026-10-12T14:20:00Z"),
    clockOutAt: instant("2026-10-12T20:00:00Z"),
    plannedStart: instant("2026-10-12T14:00:00Z"),
    plannedEnd: instant("2026-10-12T20:00:00Z"),
    graceLateMinutes: 15,
    breakMinutes: 0,
  });
  assert.equal(result.lateMinutes, 5);
});

test("approved overtime is included in worked minutes", () => {
  const result = calculateAttendanceMetrics({
    clockInAt: instant("2026-10-12T07:00:00Z"),
    clockOutAt: instant("2026-10-12T15:00:00Z"),
    plannedStart: instant("2026-10-12T07:00:00Z"),
    plannedEnd: instant("2026-10-12T14:00:00Z"),
    graceLateMinutes: 15,
    breakMinutes: 0,
    approvedOvertimeMinutes: 60,
  });
  assert.equal(result.workedMinutes, 480);
  assert.equal(result.overtimeMinutes, 60);
});

test("open morning state wins at shift handoff, then afternoon entry becomes eligible", () => {
  const handoff = instant("2026-10-12T14:00:00Z");
  assert.equal(
    decideOpenPunch(handoff, instant("2026-10-12T16:00:00Z")),
    "CLOCK_OUT",
  );
  const afternoon = findNearestShift([{
    id: "afternoon-entry",
    rosterDate: "2026-10-12",
    plannedStart: handoff,
    plannedEnd: instant("2026-10-12T20:00:00Z"),
    earlyInMinutes: 60,
  }], instant("2026-10-12T14:01:00Z"));
  assert.equal(afternoon?.id, "afternoon-entry");
});

test("debounces punches less than sixty seconds apart and flags older offline replay as skew", () => {
  const prior = instant("2026-10-12T06:58:00Z");
  assert.equal(punchIsDebounced(prior, prior), true);
  assert.equal(punchIsDebounced(prior, instant("2026-10-12T06:58:59Z")), true);
  assert.equal(punchIsDebounced(prior, instant("2026-10-12T06:59:00Z")), false);
  assert.equal(punchHasClockSkew(prior, instant("2026-10-13T06:58:00Z")), true);
  assert.equal(
    punchIsTooFarInFuture(instant("2026-10-12T07:06:00Z"), instant("2026-10-12T07:00:00Z")),
    true,
  );
});

test("revoked and expired cards are unusable", () => {
  const now = instant("2026-10-12T07:00:00Z");
  assert.equal(credentialIsUsable("REVOKED", null, now), false);
  assert.equal(credentialIsUsable("ACTIVE", instant("2026-10-12T06:59:59Z"), now), false);
  assert.equal(credentialIsUsable("ACTIVE", instant("2026-10-13T07:00:00Z"), now), true);
});

test("simulated offline batches replay stable event ids for idempotent ingestion", async () => {
  const batch: RawPunch[] = Array.from({ length: 500 }, (_, index) => ({
    deviceEventId: `offline-${index}`,
    credentialType: "CARD_QR",
    credentialRef: `opaque-${index}`,
    punchedAt: "2026-10-12T07:00:00Z",
  }));
  const adapter = new TerminalSimulatorAdapter(batch);
  const device = {
    id: "simulator",
    deviceType: "KIOSK",
    vendor: "HAMS simulator",
  } as Parameters<TerminalSimulatorAdapter["pull"]>[0];

  const firstUpload = await adapter.pull(device, new Date(0));
  const replay = await adapter.pull(device, new Date(0));
  assert.equal(firstUpload.length, 500);
  assert.deepEqual(replay.map((punch) => punch.deviceEventId), firstUpload.map((punch) => punch.deviceEventId));
});

test(
  "authenticated simulator batch replay persists one punch per device event",
  { skip: !testDatabaseUrl },
  async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const [{ db }, { attendanceDevice, punchLog }, { hashDeviceKey }, { default: deviceRoutes }] =
      await Promise.all([
        import("../db/index.js"),
        import("../db/schema/index.js"),
        import("../lib/deviceAuthentication.js"),
        import("../routes/v1/device.js"),
      ]);
    const suffix = randomUUID().replace(/-/g, "");
    const deviceCode = `TST${suffix.slice(0, 20)}`;
    const deviceKey = randomUUID();
    const eventId = `sim-replay-${suffix}`;
    const [device] = await db.insert(attendanceDevice).values({
      code: deviceCode,
      name: "Attendance replay integration test",
      deviceType: "KIOSK",
      apiKeyHash: await hashDeviceKey(deviceKey),
      status: "ACTIVE",
    }).returning({ id: attendanceDevice.id });
    assert.ok(device);

    const app = express();
    app.use(express.json());
    app.use(deviceRoutes);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const upload = async () => fetch(`http://127.0.0.1:${address.port}/punches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Code": deviceCode,
        "X-Device-Key": deviceKey,
      },
      body: JSON.stringify({
        punches: [{
          deviceEventId: eventId,
          credentialType: "CARD_QR",
          credentialRef: `unknown-${suffix}`,
          punchedAt: new Date().toISOString(),
        }],
      }),
    });

    try {
      const firstResponse = await upload();
      const first = await firstResponse.json() as {
        data: { results: Array<{ result: string }> };
      };
      const replayResponse = await upload();
      const replay = await replayResponse.json() as {
        data: { results: Array<{ result: string }> };
      };
      assert.equal(firstResponse.status, 200);
      assert.equal(first.data.results[0]?.result, "UNKNOWN_CREDENTIAL");
      assert.equal(replayResponse.status, 200);
      assert.equal(replay.data.results[0]?.result, "DUPLICATE");

      const persisted = await db.select({ id: punchLog.id })
        .from(punchLog)
        .where(and(
          eq(punchLog.deviceId, device.id),
          eq(punchLog.deviceEventId, eventId),
        ));
      assert.equal(persisted.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await db.update(attendanceDevice)
        .set({ status: "DISABLED" })
        .where(eq(attendanceDevice.id, device.id));
    }
  },
);

test(
  "night clock-out processing closes the existing roster-date record once",
  { skip: !testDatabaseUrl },
  async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const [{ db }, schema, { processPunch }] = await Promise.all([
      import("../db/index.js"),
      import("../db/schema/index.js"),
      import("../lib/punchProcessor.js"),
    ]);
    const suffix = randomUUID().replace(/-/g, "");
    const [person] = await db.insert(schema.staff).values({
      firstName: "Attendance",
      lastName: "Replay",
      email: `${suffix}@example.test`,
      employeeId: `TST-${suffix.slice(0, 20)}`,
      momoNumber: "0000000000",
      status: "active",
    }).returning({ id: schema.staff.id });
    assert.ok(person);
    const [device] = await db.insert(schema.attendanceDevice).values({
      code: `TST${suffix.slice(0, 20)}`,
      name: "Night attendance integration test",
      deviceType: "KIOSK",
      apiKeyHash: "unused-test-hash",
      status: "ACTIVE",
    }).returning({ id: schema.attendanceDevice.id });
    assert.ok(device);
    const clockInAt = instant("2026-10-12T19:50:00Z");
    const [clockIn] = await db.insert(schema.punchLog).values({
      deviceId: device.id,
      deviceEventId: `night-in-${suffix}`,
      credentialType: "CARD_QR",
      credentialRef: `night-${suffix}`,
      staffId: person.id,
      punchedAt: clockInAt,
      result: "CLOCK_IN",
      processed: true,
    }).returning({ id: schema.punchLog.id });
    assert.ok(clockIn);
    const [record] = await db.insert(schema.attendanceRecord).values({
      staffId: person.id,
      attendanceDate: "2026-10-12",
      clockInAt,
      clockInPunchId: clockIn.id,
      status: "OPEN",
    }).returning({ id: schema.attendanceRecord.id });
    assert.ok(record);
    const [clockOut] = await db.insert(schema.punchLog).values({
      deviceId: device.id,
      deviceEventId: `night-out-${suffix}`,
      credentialType: "CARD_QR",
      credentialRef: `night-${suffix}`,
      staffId: person.id,
      punchedAt: instant("2026-10-13T07:00:00Z"),
      result: "RECEIVED",
      processed: false,
    }).returning({ id: schema.punchLog.id });
    assert.ok(clockOut);

    const outcome = await processPunch(clockOut.id);
    assert.equal(outcome, "ACCEPTED");
    const [closed] = await db.select().from(schema.attendanceRecord)
      .where(eq(schema.attendanceRecord.id, record.id));
    const [processedPunch] = await db.select().from(schema.punchLog)
      .where(eq(schema.punchLog.id, clockOut.id));
    const staffRecords = await db.select({ id: schema.attendanceRecord.id })
      .from(schema.attendanceRecord)
      .where(eq(schema.attendanceRecord.staffId, person.id));
    assert.equal(closed?.attendanceDate, "2026-10-12");
    assert.equal(closed?.status, "CLOSED");
    assert.equal(closed?.clockInPunchId, clockIn.id);
    assert.equal(closed?.clockOutPunchId, clockOut.id);
    assert.equal(processedPunch?.result, "CLOCK_OUT");
    assert.equal(processedPunch?.processed, true);
    assert.equal(staffRecords.length, 1);

    await db.update(schema.attendanceDevice)
      .set({ status: "DISABLED" })
      .where(eq(schema.attendanceDevice.id, device.id));
  },
);
