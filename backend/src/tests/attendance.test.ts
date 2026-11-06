import test from "node:test";
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
