import assert from "node:assert/strict";
import test from "node:test";

import { addFacilityWorkingDays, facilityDate } from "../lib/facilityCalendar.js";

test("facility working-day deadlines skip weekends and configured public holidays", () => {
  assert.equal(addFacilityWorkingDays("2026-03-06", 2, new Set()), "2026-03-10");
  assert.equal(addFacilityWorkingDays("2026-03-06", 2, new Set(["2026-03-09"])), "2026-03-11");
});

test("facility dates use the facility timezone rather than UTC", () => {
  assert.equal(facilityDate(new Date("2026-03-10T02:00:00.000Z"), "America/New_York"), "2026-03-09");
});
