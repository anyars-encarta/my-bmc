import { db } from "../db/index.js";
import { publicHoliday } from "../db/schema/index.js";
import { getGhanaPublicHolidays } from "../lib/ghanaPublicHolidays.js";

export const seedGhanaPublicHolidays = async (year = new Date().getUTCFullYear(), yearsAhead = 5) => {
  const holidays = Array.from({ length: yearsAhead + 1 }, (_, offset) =>
    getGhanaPublicHolidays(year + offset),
  ).flat();

  if (holidays.length === 0) return 0;
  const inserted = await db.insert(publicHoliday)
    .values(holidays)
    .onConflictDoNothing({ target: publicHoliday.holidayDate })
    .returning({ holidayDate: publicHoliday.holidayDate });
  return inserted.length;
};
