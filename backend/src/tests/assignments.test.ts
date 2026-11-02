import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import { isRetroactiveAssignmentDate, resolveEffectiveAssignment } from "../lib/assignmentRules.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("retroactive assignment dates are rejected", () => {
  assert.equal(isRetroactiveAssignmentDate("2026-03-02", "2026-03-03"), true);
  assert.equal(isRetroactiveAssignmentDate("2026-03-03", "2026-03-03"), false);
});

test("temporary and cover assignments override primary assignments", () => {
  const effective = resolveEffectiveAssignment([
    { assignmentType: "PRIMARY", effectiveFrom: "2026-01-01", effectiveTo: null },
    { assignmentType: "TEMPORARY", effectiveFrom: "2026-02-01", effectiveTo: "2026-03-01" },
    { assignmentType: "COVER", effectiveFrom: "2026-02-15", effectiveTo: "2026-02-15" },
  ]);
  assert.equal(effective?.assignmentType, "COVER");
  assert.equal(effective?.effectiveFrom, "2026-02-15");
});

test(
  "primary transfer rejects retroactive dates and preserves assignment history",
  { skip: !testDatabaseUrl },
  async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const [{ db }, { orgUnit, staff, staffAssignment, workforceEvent }, { transferPrimary }] =
      await Promise.all([
        import("../db/index.js"),
        import("../db/schema/index.js"),
        import("../routes/v1/assignments.js"),
      ]);

    const token = randomUUID().replace(/-/g, "").slice(0, 12);
    const unitIds: string[] = [];
    const staffIds: string[] = [];
    const createUnit = async (suffix: string) => {
      const [unit] = await db
        .insert(orgUnit)
        .values({
          code: `TST_${token}_${suffix}`,
          name: `Assignment test ${suffix}`,
          unitType: "UNIT",
          isClinical: true,
        })
        .returning();
      assert.ok(unit);
      unitIds.push(unit.id);
      return unit;
    };
    const createStaff = async (suffix: string, unitId: string) => {
      const [person] = await db
        .insert(staff)
        .values({
          firstName: "Test",
          lastName: suffix,
          email: `${token}.${suffix}@example.test`,
          employeeId: `TST-${token}-${suffix}`,
          momoNumber: "0000000000",
          status: "active",
        })
        .returning();
      assert.ok(person);
      staffIds.push(person.id);
      await db.insert(staffAssignment).values({
        staffId: person.id,
        orgUnitId: unitId,
        assignmentType: "PRIMARY",
        effectiveFrom: new Date().toISOString().slice(0, 10),
        reason: "INITIAL",
      });
      return person;
    };
    const addDays = (count: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + count);
      return date.toISOString().slice(0, 10);
    };

    try {
      const [origin, destinationOne, destinationTwo] = await Promise.all([
        createUnit("origin"),
        createUnit("one"),
        createUnit("two"),
      ]);

      const historyPerson = await createStaff("history", origin.id);
      await assert.rejects(
        db.transaction((tx) =>
          transferPrimary(tx, {
            staffId: historyPerson.id,
            toUnitId: destinationOne.id,
            effectiveFrom: addDays(-1),
            reason: "TRANSFER",
          }),
        ),
        (error: unknown) =>
          error instanceof Error && error.message.includes("Assignment dates cannot be in the past."),
      );

      await db.transaction((tx) =>
        transferPrimary(tx, {
          staffId: historyPerson.id,
          toUnitId: destinationOne.id,
          effectiveFrom: addDays(1),
          reason: "TRANSFER",
        }),
      );
      await db.transaction((tx) =>
        transferPrimary(tx, {
          staffId: historyPerson.id,
          toUnitId: destinationTwo.id,
          effectiveFrom: addDays(2),
          reason: "TRANSFER",
        }),
      );
      const history = await db
        .select()
        .from(staffAssignment)
        .where(eq(staffAssignment.staffId, historyPerson.id))
        .orderBy(asc(staffAssignment.effectiveFrom));
      assert.equal(history.length, 3);
      assert.equal(history[0]?.effectiveTo, addDays(0));
      assert.equal(history[1]?.effectiveTo, addDays(1));

      const concurrentPerson = await createStaff("concurrent", origin.id);
      const results = await Promise.allSettled([
        db.transaction((tx) =>
          transferPrimary(tx, {
            staffId: concurrentPerson.id,
            toUnitId: destinationOne.id,
            effectiveFrom: addDays(1),
            reason: "TRANSFER",
          }),
        ),
        db.transaction((tx) =>
          transferPrimary(tx, {
            staffId: concurrentPerson.id,
            toUnitId: destinationTwo.id,
            effectiveFrom: addDays(1),
            reason: "TRANSFER",
          }),
        ),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const concurrentAssignments = await db
        .select()
        .from(staffAssignment)
        .where(eq(staffAssignment.staffId, concurrentPerson.id));
      assert.equal(concurrentAssignments.length, 2);
      assert.equal(
        concurrentAssignments.filter((assignment) => assignment.effectiveFrom === addDays(1)).length,
        1,
      );

      const [unassigned] = await db
        .insert(staff)
        .values({
          firstName: "Test",
          lastName: "constraint",
          email: `${token}.constraint@example.test`,
          employeeId: `TST-${token}-constraint`,
          momoNumber: "0000000000",
          status: "active",
        })
        .returning();
      assert.ok(unassigned);
      staffIds.push(unassigned.id);
      const overlappingInserts = await Promise.allSettled([
        db.transaction((tx) =>
          tx.insert(staffAssignment).values({
            staffId: unassigned.id,
            orgUnitId: destinationOne.id,
            assignmentType: "PRIMARY",
            effectiveFrom: addDays(1),
            reason: "INITIAL",
          }),
        ),
        db.transaction((tx) =>
          tx.insert(staffAssignment).values({
            staffId: unassigned.id,
            orgUnitId: destinationTwo.id,
            assignmentType: "PRIMARY",
            effectiveFrom: addDays(1),
            reason: "INITIAL",
          }),
        ),
      ]);
      assert.equal(overlappingInserts.filter((result) => result.status === "fulfilled").length, 1);
      const persistedConcurrent = await db
        .select()
        .from(staffAssignment)
        .where(eq(staffAssignment.staffId, unassigned.id));
      assert.equal(persistedConcurrent.length, 1);
    } finally {
      if (staffIds.length > 0) {
        await db.delete(workforceEvent).where(inArray(workforceEvent.aggregateId, staffIds));
        await db.delete(staffAssignment).where(inArray(staffAssignment.staffId, staffIds));
        await db.delete(staff).where(inArray(staff.id, staffIds));
      }
      if (unitIds.length > 0) await db.delete(orgUnit).where(inArray(orgUnit.id, unitIds));
    }
  },
);
