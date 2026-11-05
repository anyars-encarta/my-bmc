export type GhanaPublicHoliday = {
  holidayDate: string;
  name: string;
};

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const easterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

const firstFridayOfDecember = (year: number) => {
  const date = new Date(Date.UTC(year, 11, 1));
  while (date.getUTCDay() !== 5) date.setUTCDate(date.getUTCDate() + 1);
  return date;
};

export const getGhanaPublicHolidays = (year: number): GhanaPublicHoliday[] => {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new RangeError("Holiday year must be an integer between 1900 and 2200.");
  }

  const fixedDates: Array<[number, number, string]> = [
    [0, 1, "New Year's Day"],
    [0, 7, "Constitution Day"],
    [2, 6, "Independence Day"],
    [4, 1, "May Day"],
    [4, 25, "Africa Union Day"],
    [6, 1, "Republic Day"],
    [7, 4, "Founders' Day"],
    [8, 21, "Kwame Nkrumah Memorial Day"],
    [11, 25, "Christmas Day"],
    [11, 26, "Boxing Day"],
  ];

  const holidays = new Map<string, string>();
  const add = (date: Date, name: string) => {
    holidays.set(formatDate(date), name);
  };

  for (const [month, day, name] of fixedDates) {
    const date = new Date(Date.UTC(year, month, day));
    add(date, name);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      const observed = new Date(date);
      observed.setUTCDate(observed.getUTCDate() + (date.getUTCDay() === 6 ? 2 : 1));
      add(observed, `${name} (observed)`);
    }
  }

  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setUTCDate(easterMonday.getUTCDate() + 1);
  add(goodFriday, "Good Friday");
  add(easterMonday, "Easter Monday");
  add(firstFridayOfDecember(year), "Farmers' Day");

  return Array.from(holidays, ([holidayDate, name]) => ({ holidayDate, name }))
    .sort((left, right) => left.holidayDate.localeCompare(right.holidayDate));
};
