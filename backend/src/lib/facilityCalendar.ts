/** Formats an instant as a calendar date in the selected facility timezone. */
export const facilityDate = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Returns the date after the requested weekdays, excluding configured public holidays. */
export const addFacilityWorkingDays = (date: string, count: number, holidays: Set<string>) => {
  const result = new Date(`${date}T00:00:00.000Z`);
  let remaining = count;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const iso = result.toISOString().slice(0, 10);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(iso)) remaining -= 1;
  }
  return result.toISOString().slice(0, 10);
};
