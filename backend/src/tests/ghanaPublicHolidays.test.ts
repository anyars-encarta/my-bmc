import test from "node:test";
import assert from "node:assert/strict";

import { getGhanaPublicHolidays } from "../lib/ghanaPublicHolidays.js";

test("Ghana holiday seed contains fixed observances, Easter dates, and Farmers' Day", () => {
  const holidays = getGhanaPublicHolidays(2026);
  const byNameAndDate = new Set(holidays.map((holiday) => `${holiday.name}:${holiday.holidayDate}`));

  assert.ok(byNameAndDate.has("Independence Day:2026-03-06"));
  assert.ok(byNameAndDate.has("Good Friday:2026-04-03"));
  assert.ok(byNameAndDate.has("Easter Monday:2026-04-06"));
  assert.ok(byNameAndDate.has("Farmers' Day:2026-12-04"));
  assert.equal(new Set(holidays.map((holiday) => holiday.holidayDate)).size, holidays.length);
});

test("weekend holidays receive the following Monday observance", () => {
  const holidays = getGhanaPublicHolidays(2027);
  assert.ok(holidays.some((holiday) =>
    holiday.name === "Independence Day (observed)" && holiday.holidayDate === "2027-03-08",
  ));
});

test("holiday seed rejects invalid years", () => {
  assert.throws(() => getGhanaPublicHolidays(1899), RangeError);
});
