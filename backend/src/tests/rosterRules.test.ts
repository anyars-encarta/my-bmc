import test from "node:test";
import assert from "node:assert/strict";

import { validateRoster, type RosterRuleContext } from "../lib/rosterRules.js";

const staffId = "staff-1";
const unitId = "unit-1";
const shifts = [
  { id: "morning", name: "Morning", category: "MORNING", breakMinutes: 0 },
  { id: "afternoon", name: "Afternoon", category: "AFTERNOON", breakMinutes: 0 },
  { id: "night", name: "Night", category: "NIGHT", breakMinutes: 0 },
];

const baseContext = (overrides: Partial<RosterRuleContext> = {}): RosterRuleContext => ({
  period: { orgUnitId: unitId, startDate: "2026-03-02", endDate: "2026-03-08" },
  operates24h: false,
  entries: [],
  staff: [{
    id: staffId,
    employeeId: "EMP-001",
    firstName: "Roster",
    lastName: "Test",
    staffCategory: "CLINICAL",
    scheduleMode: "ROSTERED",
    jobRoleId: null,
  }],
  shifts,
  holidays: new Set<string>(),
  assignments: [{
    staffId,
    orgUnitId: unitId,
    assignmentType: "PRIMARY",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    approvedAt: null,
  }],
  requirements: [],
  ...overrides,
});

const entry = (
  rosterDate: string,
  shiftTypeId: string,
  plannedStart: string,
  plannedEnd: string,
  inPeriod = true,
) => ({
  staffId,
  orgUnitId: unitId,
  rosterDate,
  shiftTypeId,
  plannedStart: new Date(plannedStart),
  plannedEnd: new Date(plannedEnd),
  source: "MANUAL",
  inPeriod,
});

test("non-clinical staff cannot be rostered on weekends or public holidays", () => {
  const violations = validateRoster(baseContext({
    staff: [{
      id: staffId,
      employeeId: "EMP-001",
      firstName: "Office",
      lastName: "Staff",
      staffCategory: "NON_CLINICAL",
      scheduleMode: "ROSTERED",
      jobRoleId: null,
    }],
    entries: [entry("2026-03-07", "morning", "2026-03-07T07:00:00Z", "2026-03-07T14:00:00Z")],
  }));
  assert.ok(violations.some((violation) => violation.code === "NON_CLINICAL_NON_WORKING_DAY"));
});

test("minimum rest blocks a Night-to-Morning turn and accepts a reasoned HR override", () => {
  const entries = [
    entry("2026-03-02", "night", "2026-03-02T20:00:00Z", "2026-03-03T07:00:00Z"),
    entry("2026-03-03", "morning", "2026-03-03T07:00:00Z", "2026-03-03T14:00:00Z"),
  ];
  assert.ok(validateRoster(baseContext({ entries })).some((violation) => violation.code === "MINIMUM_REST"));

  const overridden = [
    entries[0]!,
    { ...entries[1]!, overrideReason: "Emergency staffing approved by HR." },
  ];
  assert.ok(!validateRoster(baseContext({
    entries: overridden,
    allowRestOverride: true,
  })).some((violation) => violation.code === "MINIMUM_REST"));
});

test("touching shift boundaries do not count as overlap but still enforce minimum rest", () => {
  const violations = validateRoster(baseContext({
    entries: [
      entry("2026-03-02", "morning", "2026-03-02T07:00:00Z", "2026-03-02T14:00:00Z"),
      entry("2026-03-02", "afternoon", "2026-03-02T14:00:00Z", "2026-03-02T20:00:00Z"),
    ],
  }));
  assert.ok(!violations.some((violation) => violation.code === "ROSTER_SHIFT_OVERLAP"));
  assert.ok(violations.some((violation) => violation.code === "MINIMUM_REST"));
});

test("coverage is a draft warning and a publish-blocking error; 24-hour units require all shift types", () => {
  const context = baseContext({
    period: { orgUnitId: unitId, startDate: "2026-03-02", endDate: "2026-03-02" },
    operates24h: true,
    requirements: [{ shiftTypeId: "morning", jobRoleId: null, minStaff: 2 }],
    entries: [entry("2026-03-02", "morning", "2026-03-02T07:00:00Z", "2026-03-02T14:00:00Z")],
  });
  const draftViolations = validateRoster(context);
  assert.ok(draftViolations.some((violation) => violation.code === "STAFFING_REQUIREMENT" && violation.level === "warning"));
  assert.equal(draftViolations.filter((violation) => violation.code === "24H_SHIFT_COVERAGE").length, 2);

  const publishViolations = validateRoster({ ...context, publishing: true });
  assert.ok(publishViolations.some((violation) => violation.code === "STAFFING_REQUIREMENT" && violation.level === "error"));
  assert.ok(publishViolations.some((violation) => violation.code === "24H_SHIFT_COVERAGE" && violation.level === "error"));
});

test("roster entries require an effective assignment to the period unit", () => {
  const violations = validateRoster(baseContext({
    assignments: [],
    entries: [entry("2026-03-02", "morning", "2026-03-02T07:00:00Z", "2026-03-02T14:00:00Z")],
  }));
  assert.ok(violations.some((violation) => violation.code === "STAFF_NOT_ASSIGNED_TO_UNIT"));
});
