import { db } from "../db/index.js";
import { facilitySetup } from "../db/schema/index.js";

export const DEFAULT_FACILITY_TIMEZONE = "UTC";

export const resolveFacilityTimezone = async () => {
  const [record] = await db.select({ timezone: facilitySetup.timezone }).from(facilitySetup).limit(1);
  return record?.timezone ?? DEFAULT_FACILITY_TIMEZONE;
};

export const nowAtFacility = async () => {
  const timezone = await resolveFacilityTimezone();
  const now = new Date();
  const zonedIso = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(" ", "T");

  return {
    timezone,
    instant: now.toISOString(),
    localDateTime: zonedIso,
  };
};
