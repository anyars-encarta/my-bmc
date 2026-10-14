export type ShiftClock = {
  startTime: string;
  endTime: string;
  crossesMidnight?: boolean | null;
};

const parseDate = (dateIso: string) => {
  const [yearRaw, monthRaw, dayRaw] = dateIso.split("-");
  const year = Number.parseInt(yearRaw ?? "", 10);
  const month = Number.parseInt(monthRaw ?? "", 10);
  const day = Number.parseInt(dayRaw ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date value: ${dateIso}`);
  }
  return { year, month, day };
};

const parseTime = (value: string) => {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return { hours, minutes };
};

const parseOffsetMinutes = (offsetToken: string) => {
  if (offsetToken === "GMT" || offsetToken === "UTC") {
    return 0;
  }

  const normalized = offsetToken.replace("GMT", "").replace("UTC", "");
  const sign = normalized.startsWith("-") ? -1 : 1;
  const raw = normalized.replace(/^[+-]/, "");
  const [hoursRaw, minutesRaw] = raw.split(":");
  const hours = Number.parseInt(hoursRaw ?? "0", 10);
  const minutes = Number.parseInt(minutesRaw ?? "0", 10);
  return sign * (hours * 60 + minutes);
};

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getOffsetMinutes = (instant: Date, timeZone: string) => {
  let formatter = offsetFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "shortOffset",
      hour12: false,
    });
    offsetFormatterCache.set(timeZone, formatter);
  }

  const offsetPart = formatter
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  return parseOffsetMinutes(offsetPart ?? "GMT");
};

const makeInstantFromLocal = (dateIso: string, time: string, timeZone: string) => {
  const { year, month, day } = parseDate(dateIso);
  const { hours, minutes } = parseTime(time);

  let utcMillis = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(utcMillis), timeZone);
    const corrected = Date.UTC(year, month - 1, day, hours, minutes, 0) - offsetMinutes * 60_000;
    if (corrected === utcMillis) {
      break;
    }
    utcMillis = corrected;
  }

  return new Date(utcMillis);
};

const addDays = (dateIso: string, days: number) => {
  const { year, month, day } = parseDate(dateIso);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const shiftStart = (dateIso: string, shift: ShiftClock, timeZone: string) =>
  makeInstantFromLocal(dateIso, shift.startTime, timeZone);

export const shiftEnd = (dateIso: string, shift: ShiftClock, timeZone: string) => {
  const start = shiftStart(dateIso, shift, timeZone);
  const candidateSameDay = makeInstantFromLocal(dateIso, shift.endTime, timeZone);
  const explicitCross = shift.crossesMidnight === true;

  if (explicitCross || candidateSameDay <= start) {
    return makeInstantFromLocal(addDays(dateIso, 1), shift.endTime, timeZone);
  }

  return candidateSameDay;
};
