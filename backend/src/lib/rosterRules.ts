export type RosterRuleEntry = {
  id?: string;
  staffId: string;
  orgUnitId: string;
  rosterDate: string;
  shiftTypeId: string;
  plannedStart: Date | string;
  plannedEnd: Date | string;
  source: string;
  overrideReason?: string | null;
  inPeriod: boolean;
};

export type RosterRuleStaff = {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  staffCategory: string;
  scheduleMode: string;
  jobRoleId: string | null;
};

export type RosterRuleShift = {
  id: string;
  name: string;
  category: string;
  breakMinutes: number;
};

export type RosterViolation = {
  level: "error" | "warning";
  code: string;
  message: string;
  staffId: string | null;
  date: string;
};

export type RosterRuleContext = {
  period: { orgUnitId: string; startDate: string; endDate: string };
  operates24h: boolean;
  entries: RosterRuleEntry[];
  staff: RosterRuleStaff[];
  shifts: RosterRuleShift[];
  holidays: Set<string>;
  assignments: Array<{
    staffId: string;
    orgUnitId: string;
    assignmentType: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    approvedAt: Date | string | null;
  }>;
  requirements: Array<{
    shiftTypeId: string;
    jobRoleId: string | null;
    minStaff: number;
  }>;
  allowRestOverride?: boolean;
  publishing?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REST_MS = 11 * 60 * 60 * 1000;

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const datesBetween = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
};

const weekStart = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
};

const toMillis = (date: Date | string) =>
  date instanceof Date ? date.getTime() : new Date(date).getTime();

const overlaps = (left: RosterRuleEntry, right: RosterRuleEntry) =>
  toMillis(left.plannedStart) < toMillis(right.plannedEnd) &&
  toMillis(right.plannedStart) < toMillis(left.plannedEnd);

export const validateRoster = (context: RosterRuleContext): RosterViolation[] => {
  const violations: RosterViolation[] = [];
  const staffById = new Map(context.staff.map((person) => [person.id, person]));
  const shiftsById = new Map(context.shifts.map((shift) => [shift.id, shift]));
  const activeEntries = context.entries
    .filter((entry) =>
      entry.inPeriod ||
      (entry.rosterDate >= addDays(context.period.startDate, -7) &&
        entry.rosterDate <= addDays(context.period.endDate, 7)),
    )
    .sort((left, right) =>
      left.staffId.localeCompare(right.staffId) ||
      toMillis(left.plannedStart) - toMillis(right.plannedStart),
    );
  const periodEntries = activeEntries.filter((entry) => entry.inPeriod);
  const assignmentsByStaff = new Map<string, RosterRuleContext["assignments"]>();
  for (const assignment of context.assignments) {
    const records = assignmentsByStaff.get(assignment.staffId) ?? [];
    records.push(assignment);
    assignmentsByStaff.set(assignment.staffId, records);
  }

  const addViolation = (violation: RosterViolation) => {
    if (!violations.some((current) =>
      current.code === violation.code &&
      current.staffId === violation.staffId &&
      current.date === violation.date &&
      current.message === violation.message,
    )) violations.push(violation);
  };

  for (const entry of periodEntries) {
    const person = staffById.get(entry.staffId);
    const shift = shiftsById.get(entry.shiftTypeId);
    if (!person || !shift) {
      addViolation({
        level: "error",
        code: "ROSTER_REFERENCE_MISSING",
        message: "The staff member or shift type is no longer available.",
        staffId: entry.staffId,
        date: entry.rosterDate,
      });
      continue;
    }

    if (person.scheduleMode !== "ROSTERED") {
      addViolation({
        level: "error",
        code: "STAFF_NOT_ROSTERED",
        message: "This staff member is not configured for a rostered schedule.",
        staffId: person.id,
        date: entry.rosterDate,
      });
    }

    if (
      person.staffCategory === "NON_CLINICAL" &&
      (new Date(`${entry.rosterDate}T00:00:00.000Z`).getUTCDay() === 0 ||
        new Date(`${entry.rosterDate}T00:00:00.000Z`).getUTCDay() === 6 ||
        context.holidays.has(entry.rosterDate))
    ) {
      addViolation({
        level: "error",
        code: "NON_CLINICAL_NON_WORKING_DAY",
        message: "Non-clinical staff cannot be rostered on weekends or public holidays.",
        staffId: person.id,
        date: entry.rosterDate,
      });
    }

    const effectiveAssignment = (assignmentsByStaff.get(entry.staffId) ?? [])
      .filter((assignment) =>
        assignment.effectiveFrom <= entry.rosterDate &&
        (!assignment.effectiveTo || assignment.effectiveTo >= entry.rosterDate) &&
        (assignment.assignmentType !== "COVER" || assignment.approvedAt !== null),
      )
      .sort((left, right) => {
        const priority = (type: string) => type === "COVER" || type === "TEMPORARY" ? 0 : 1;
        return priority(left.assignmentType) - priority(right.assignmentType) ||
          right.effectiveFrom.localeCompare(left.effectiveFrom);
      })[0];
    if (!effectiveAssignment || effectiveAssignment.orgUnitId !== context.period.orgUnitId) {
      addViolation({
        level: "error",
        code: "STAFF_NOT_ASSIGNED_TO_UNIT",
        message: "Staff must have an effective assignment to this unit on the roster date.",
        staffId: entry.staffId,
        date: entry.rosterDate,
      });
    }
  }

  for (let index = 1; index < activeEntries.length; index += 1) {
    const previous = activeEntries[index - 1];
    const current = activeEntries[index];
    if (!previous || !current || previous.staffId !== current.staffId) continue;

    if (overlaps(previous, current)) {
      const affected = current.inPeriod ? current : previous.inPeriod ? previous : null;
      if (affected) addViolation({
        level: "error",
        code: "ROSTER_SHIFT_OVERLAP",
        message: "A staff member cannot be assigned to overlapping shifts.",
        staffId: current.staffId,
        date: affected.rosterDate,
      });
      continue;
    }

    const rest = toMillis(current.plannedStart) - toMillis(previous.plannedEnd);
    if (
      rest < MIN_REST_MS &&
      (previous.inPeriod || current.inPeriod) &&
      !(
        context.allowRestOverride &&
        ((previous.inPeriod && previous.overrideReason?.trim()) ||
          (current.inPeriod && current.overrideReason?.trim()))
      )
    ) {
      const affected = current.inPeriod ? current : previous;
      addViolation({
        level: "error",
        code: "MINIMUM_REST",
        message: "At least 11 hours of rest are required between shifts. HR may override with a reason.",
        staffId: current.staffId,
        date: affected.rosterDate,
      });
    }
  }

  const workDaysByStaff = new Map<string, Set<string>>();
  const nightsByStaff = new Map<string, Set<string>>();
  const hoursByStaffWeek = new Map<string, Map<string, number>>();
  for (const entry of activeEntries) {
    const person = staffById.get(entry.staffId);
    const shift = shiftsById.get(entry.shiftTypeId);
    if (!person || !shift) continue;

    const workDays = workDaysByStaff.get(entry.staffId) ?? new Set<string>();
    workDays.add(entry.rosterDate);
    workDaysByStaff.set(entry.staffId, workDays);

    if (shift.category === "NIGHT") {
      const nights = nightsByStaff.get(entry.staffId) ?? new Set<string>();
      nights.add(entry.rosterDate);
      nightsByStaff.set(entry.staffId, nights);
    }

    const week = weekStart(entry.rosterDate);
    const weekHours = hoursByStaffWeek.get(entry.staffId) ?? new Map<string, number>();
    const currentHours = weekHours.get(week) ?? 0;
    const durationHours =
      (toMillis(entry.plannedEnd) - toMillis(entry.plannedStart)) / (60 * 60 * 1000);
    weekHours.set(week, currentHours + Math.max(0, durationHours - shift.breakMinutes / 60));
    hoursByStaffWeek.set(entry.staffId, weekHours);
  }

  for (const [staffId, workDays] of workDaysByStaff) {
    const dates = Array.from(workDays).sort();
    let consecutive = 0;
    let previous: string | null = null;
    for (const date of dates) {
      consecutive = previous && addDays(previous, 1) === date ? consecutive + 1 : 1;
      previous = date;
      if (consecutive > 6 && date >= context.period.startDate && date <= context.period.endDate) {
        addViolation({
          level: "warning",
          code: "MAX_CONSECUTIVE_DAYS",
          message: "More than six consecutive working days are scheduled.",
          staffId,
          date,
        });
      }
    }
  }

  for (const [staffId, nightDates] of nightsByStaff) {
    const dates = Array.from(nightDates).sort();
    let consecutive = 0;
    let previous: string | null = null;
    for (const date of dates) {
      consecutive = previous && addDays(previous, 1) === date ? consecutive + 1 : 1;
      previous = date;
      if (consecutive > 5 && date >= context.period.startDate && date <= context.period.endDate) {
        addViolation({
          level: "warning",
          code: "MAX_CONSECUTIVE_NIGHTS",
          message: "More than five consecutive night shifts are scheduled.",
          staffId,
          date,
        });
      }
    }
  }

  for (const [staffId, weekHours] of hoursByStaffWeek) {
    for (const [week, hours] of weekHours) {
      const weekEnd = addDays(week, 6);
      if (
        hours > 48 &&
        weekEnd >= context.period.startDate &&
        week <= context.period.endDate
      ) {
        addViolation({
          level: "warning",
          code: "MAX_WEEKLY_HOURS",
          message: `Scheduled hours exceed 48 for the week of ${week}.`,
          staffId,
          date: week,
        });
      }
    }
  }

  for (const date of datesBetween(context.period.startDate, context.period.endDate)) {
    for (const requirement of context.requirements) {
      const actual = periodEntries.filter((entry) => {
        if (entry.rosterDate !== date || entry.shiftTypeId !== requirement.shiftTypeId) return false;
        return requirement.jobRoleId === null ||
          staffById.get(entry.staffId)?.jobRoleId === requirement.jobRoleId;
      }).length;
      if (actual < requirement.minStaff) {
        addViolation({
          level: context.publishing ? "error" : "warning",
          code: "STAFFING_REQUIREMENT",
          message: `Coverage requires at least ${requirement.minStaff} staff; ${actual} are assigned.`,
          staffId: null,
          date,
        });
      }
    }

    if (context.operates24h) {
      for (const category of ["MORNING", "AFTERNOON", "NIGHT"]) {
        const covered = periodEntries.some((entry) =>
          entry.rosterDate === date &&
          shiftsById.get(entry.shiftTypeId)?.category === category,
        );
        if (!covered) addViolation({
          level: "error",
          code: "24H_SHIFT_COVERAGE",
          message: `A 24-hour unit requires at least one ${category.toLowerCase()} shift each day.`,
          staffId: null,
          date,
        });
      }
    }
  }

  return violations;
};
