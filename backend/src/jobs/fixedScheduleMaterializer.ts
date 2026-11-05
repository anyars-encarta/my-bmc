import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  facilitySetup,
  leaveRequest,
  publicHoliday,
  rosterEntry,
  shiftType,
  staff,
  staffAssignment,
} from "../db/schema/index.js";
import { resolveEffectiveAssignment } from "../lib/assignmentRules.js";
import { nowAtFacility } from "../lib/facilityClock.js";
import { shiftEnd, shiftStart } from "../lib/shiftTimes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

const getDayOfWeek = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

export const materializeFixedSchedules = async (
  from: string,
  to: string,
  onlyStaffIds?: string[],
) => {
  if (from > to) throw new RangeError("Schedule start date must not be after end date.");

  const [activeStaff, shiftTypes, holidays, facility, leaves] = await Promise.all([
    db.select().from(staff).where(and(
      eq(staff.status, "active"),
      eq(staff.staffCategory, "NON_CLINICAL"),
      eq(staff.scheduleMode, "FIXED_WEEKDAY"),
      ...(onlyStaffIds?.length ? [inArray(staff.id, onlyStaffIds)] : []),
    )),
    db.select().from(shiftType).where(eq(shiftType.active, true)),
    db.select().from(publicHoliday),
    db.select({ timezone: facilitySetup.timezone }).from(facilitySetup).limit(1),
    db.select({
      staffId: leaveRequest.staffId,
      startDate: leaveRequest.startDate,
      endDate: leaveRequest.endDate,
    }).from(leaveRequest).where(and(
      eq(leaveRequest.status, "APPROVED"),
      lte(leaveRequest.startDate, to),
      gte(leaveRequest.endDate, from),
    )),
  ]);

  const holidayDates = new Set(
    holidays
      .map((holiday) => holiday.holidayDate)
      .filter((date) => date >= from && date <= to),
  );
  const leaveDatesByStaff = new Map<string, Set<string>>();
  for (const leave of leaves) {
    const dates = leaveDatesByStaff.get(leave.staffId) ?? new Set<string>();
    for (const date of datesBetween(
      leave.startDate < from ? from : leave.startDate,
      leave.endDate > to ? to : leave.endDate,
    )) dates.add(date);
    leaveDatesByStaff.set(leave.staffId, dates);
  }

  const timezone = facility[0]?.timezone ?? "Africa/Accra";
  const shiftsById = new Map(shiftTypes.map((shift) => [shift.id, shift]));
  const standardShift =
    shiftTypes.find((shift) => shift.code === "STD") ??
    shiftTypes.find((shift) => shift.category === "STANDARD");
  const staffIds = activeStaff.map((person) => person.id);
  const assignments = staffIds.length === 0
    ? []
    : await db.select().from(staffAssignment).where(and(
      inArray(staffAssignment.staffId, staffIds),
      lte(staffAssignment.effectiveFrom, to),
      or(isNull(staffAssignment.effectiveTo), gte(staffAssignment.effectiveTo, from)),
    ));

  const rows: Array<typeof rosterEntry.$inferInsert> = [];
  const cancelDatesByStaff = new Map<string, string[]>();
  const existingManualRows = staffIds.length === 0
    ? []
    : await db.select({
      staffId: rosterEntry.staffId,
      rosterDate: rosterEntry.rosterDate,
    }).from(rosterEntry).where(and(
      inArray(rosterEntry.staffId, staffIds),
      gte(rosterEntry.rosterDate, from),
      lte(rosterEntry.rosterDate, to),
      eq(rosterEntry.status, "ACTIVE"),
      sql`${rosterEntry.source} <> 'AUTO_FIXED'`,
    ));
  const manualKeys = new Set(existingManualRows.map((entry) => `${entry.staffId}:${entry.rosterDate}`));

  for (const person of activeStaff) {
    const personAssignments = assignments
      .filter((assignment) =>
        assignment.staffId === person.id &&
        assignment.effectiveFrom <= to &&
        (!assignment.effectiveTo || assignment.effectiveTo >= from) &&
        (assignment.assignmentType !== "COVER" || assignment.approvedAt !== null),
      );
    const defaultShift = person.defaultShiftTypeId
      ? shiftsById.get(person.defaultShiftTypeId)
      : standardShift;
    if (!defaultShift) {
      throw new Error(
        `Cannot materialize fixed schedule for ${person.employeeId}: no active standard shift is configured.`,
      );
    }

    for (const date of datesBetween(from, to)) {
      const weekday = getDayOfWeek(date);
      const isLeave = leaveDatesByStaff.get(person.id)?.has(date) ?? false;
      const assignment = resolveEffectiveAssignment(
        personAssignments.filter((row) =>
          row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date),
        ),
      );
      if (
        weekday === 0 ||
        weekday === 6 ||
        (person.hireDate && date < person.hireDate) ||
        holidayDates.has(date) ||
        isLeave ||
        !assignment
      ) {
        const dates = cancelDatesByStaff.get(person.id) ?? [];
        dates.push(date);
        cancelDatesByStaff.set(person.id, dates);
        continue;
      }

      if (manualKeys.has(`${person.id}:${date}`)) {
        throw new Error(
          `Cannot materialize fixed schedule for ${person.employeeId} on ${date}: an active manual roster entry already exists.`,
        );
      }

      rows.push({
        staffId: person.id,
        orgUnitId: assignment.orgUnitId,
        rosterDate: date,
        shiftTypeId: defaultShift.id,
        plannedStart: shiftStart(date, defaultShift, timezone),
        plannedEnd: shiftEnd(date, defaultShift, timezone),
        rosterPeriodId: null,
        source: "AUTO_FIXED",
        status: "ACTIVE",
      });
    }
  }

  for (const [staffId, dates] of cancelDatesByStaff) {
    if (dates.length === 0) continue;
    await db.update(rosterEntry)
      .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
      .where(and(
        eq(rosterEntry.staffId, staffId),
        eq(rosterEntry.source, "AUTO_FIXED"),
        eq(rosterEntry.status, "ACTIVE"),
        inArray(rosterEntry.rosterDate, dates),
      ));
  }

  const desiredShiftByDate = new Map(
    rows.map((row) => [`${row.staffId}:${row.rosterDate}`, row.shiftTypeId]),
  );
  const desiredStaffIds = Array.from(new Set(rows.map((row) => row.staffId)));
  let staleShiftCancelled = 0;
  if (desiredStaffIds.length > 0) {
    const activeFixedRows = await db.select({
      id: rosterEntry.id,
      staffId: rosterEntry.staffId,
      rosterDate: rosterEntry.rosterDate,
      shiftTypeId: rosterEntry.shiftTypeId,
    }).from(rosterEntry).where(and(
      inArray(rosterEntry.staffId, desiredStaffIds),
      gte(rosterEntry.rosterDate, from),
      lte(rosterEntry.rosterDate, to),
      eq(rosterEntry.source, "AUTO_FIXED"),
      eq(rosterEntry.status, "ACTIVE"),
    ));
    const staleIds = activeFixedRows
      .filter((entry) => desiredShiftByDate.get(`${entry.staffId}:${entry.rosterDate}`) !== entry.shiftTypeId)
      .map((entry) => entry.id);
    if (staleIds.length > 0) {
      const cancelledRows = await db.update(rosterEntry)
        .set({ status: "CANCELLED", version: sql`${rosterEntry.version} + 1` })
        .where(and(inArray(rosterEntry.id, staleIds), eq(rosterEntry.status, "ACTIVE")))
        .returning({ id: rosterEntry.id });
      staleShiftCancelled = cancelledRows.length;
    }
  }

  const cancelled =
    Array.from(cancelDatesByStaff.values()).reduce((sum, dates) => sum + dates.length, 0) +
    staleShiftCancelled;
  if (rows.length === 0) return { materialized: 0, cancelled };

  let insertedCount = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const inserted = await db.insert(rosterEntry)
      .values(rows.slice(offset, offset + 500))
      .onConflictDoUpdate({
        target: [rosterEntry.staffId, rosterEntry.rosterDate, rosterEntry.shiftTypeId],
        targetWhere: sql`${rosterEntry.status} = 'ACTIVE'`,
        setWhere: eq(rosterEntry.source, "AUTO_FIXED"),
        set: {
          orgUnitId: sql`excluded.org_unit_id`,
          rosterPeriodId: null,
          plannedStart: sql`excluded.planned_start`,
          plannedEnd: sql`excluded.planned_end`,
          source: "AUTO_FIXED",
          status: "ACTIVE",
          version: sql`${rosterEntry.version} + 1`,
        },
      })
      .returning({ id: rosterEntry.id });
    insertedCount += inserted.length;
  }

  if (insertedCount !== rows.length) {
    throw new Error("Some fixed schedules were not materialized because an active non-fixed roster entry conflicts.");
  }

  return { materialized: insertedCount, cancelled };
};

export const materializeFixedScheduleWindow = async () => {
  const today = (await nowAtFacility()).localDateTime.slice(0, 10);
  return materializeFixedSchedules(today, addDays(today, 60));
};

export const materializeFixedScheduleForStaff = async (staffId: string) => {
  const today = (await nowAtFacility()).localDateTime.slice(0, 10);
  const to = addDays(today, 60);
  return materializeFixedSchedules(today, to, [staffId]).then((result) => ({ staffId, ...result }));
};

export const getScheduleDateAfterDays = addDays;

export const materializeFixedSchedulesForDate = async (date: string) => {
  return materializeFixedSchedules(date, getScheduleDateAfterDays(date, 60));
};
