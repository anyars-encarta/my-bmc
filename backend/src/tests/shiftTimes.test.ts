import test from "node:test";
import assert from "node:assert/strict";

import { shiftEnd, shiftStart } from "../lib/shiftTimes.js";

const formatLocal = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(instant)
    .replace(" ", "T");

test("night shift 20:00-07:00 ends the next calendar day", () => {
  const zone = "Africa/Accra";
  const start = shiftStart(
    "2026-02-16",
    { startTime: "20:00", endTime: "07:00", crossesMidnight: true },
    zone,
  );
  const end = shiftEnd(
    "2026-02-16",
    { startTime: "20:00", endTime: "07:00", crossesMidnight: true },
    zone,
  );

  assert.equal(formatLocal(start, zone), "2026-02-16T20:00");
  assert.equal(formatLocal(end, zone), "2026-02-17T07:00");
  assert.equal((end.getTime() - start.getTime()) / (60 * 60 * 1000), 11);
});

test("shift conversion remains timezone-safe around DST transitions", () => {
  const zone = "Europe/Berlin";
  const start = shiftStart(
    "2026-03-29",
    { startTime: "01:30", endTime: "03:30", crossesMidnight: false },
    zone,
  );
  const end = shiftEnd(
    "2026-03-29",
    { startTime: "01:30", endTime: "03:30", crossesMidnight: false },
    zone,
  );

  assert.equal(formatLocal(start, zone), "2026-03-29T01:30");
  assert.equal(formatLocal(end, zone), "2026-03-29T03:30");
  assert.ok(end.getTime() > start.getTime());
});
