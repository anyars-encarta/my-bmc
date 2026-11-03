import { and, eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { orgUnit, staff, staffAssignment } from "../src/db/schema/index.js";

const firstNames = ["Ama", "Kojo", "Abena", "Kofi", "Akua", "Yaw", "Efua", "Kwame"];
const lastNames = ["Mensah", "Owusu", "Asare", "Boateng", "Osei", "Appiah", "Agyeman", "Tetteh"];

const readCount = (name: string, fallback: number, maximum: number) => {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`--${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
};

const readSeed = () => {
  const raw = process.argv.find((argument) => argument.startsWith("--seed="))?.split("=")[1];
  if (!raw) return Math.floor(Date.now() / 1000);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("--seed must be a non-negative integer.");
  }
  return value;
};

const makeRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const main = async () => {
  const unitCount = readCount("units", 4, 100);
  const staffCount = readCount("staff", 40, 10000);
  const seed = readSeed();
  const seedCode = seed.toString(36).toUpperCase();
  const random = makeRandom(seed);
  const today = new Date().toISOString().slice(0, 10);
  const createdUnits: Array<{ id: string; name: string; code: string }> = [];

  for (let index = 1; index <= unitCount; index += 1) {
    const code = `SYN${seedCode}_U${String(index).padStart(3, "0")}`;
    await db
      .insert(orgUnit)
      .values({
        code,
        name: `Demo Ward ${index}`,
        unitType: index === 1 ? "DEPARTMENT" : "WARD",
        parentId: createdUnits[0]?.id ?? null,
        isClinical: true,
        operates24h: true,
        active: true,
      })
      .onConflictDoNothing({ target: orgUnit.code });
    const [unit] = await db.select().from(orgUnit).where(eq(orgUnit.code, code)).limit(1);
    if (!unit) throw new Error(`Failed to load generated org unit ${code}.`);
    createdUnits.push(unit);
  }

  for (let index = 1; index <= staffCount; index += 1) {
    const employeeId = `SYN-${seedCode}-${String(index).padStart(5, "0")}`;
    const email = `workforce.${seedCode}.${index}@example.test`;
    const unit = createdUnits[(index - 1) % createdUnits.length];
    if (!unit) throw new Error("No generated org unit is available.");
    await db
      .insert(staff)
      .values({
        firstName: firstNames[Math.floor(random() * firstNames.length)] ?? "Demo",
        lastName: lastNames[Math.floor(random() * lastNames.length)] ?? "Staff",
        email,
        employeeId,
        momoNumber: `020${String(1000000 + index).slice(-7)}`,
        department: unit.name,
        position: "Clinical Staff",
        status: "active",
        staffCategory: "CLINICAL",
        scheduleMode: "ROSTERED",
        hireDate: today,
      })
      .onConflictDoNothing({ target: staff.employeeId });
    const [person] = await db.select().from(staff).where(eq(staff.employeeId, employeeId)).limit(1);
    if (!person) throw new Error(`Failed to load generated staff member ${employeeId}.`);
    const [assignment] = await db
      .select({ id: staffAssignment.id })
      .from(staffAssignment)
      .where(
        and(
          eq(staffAssignment.staffId, person.id),
          eq(staffAssignment.assignmentType, "PRIMARY"),
        ),
      )
      .limit(1);
    if (!assignment) {
      await db.insert(staffAssignment).values({
        staffId: person.id,
        orgUnitId: unit.id,
        assignmentType: "PRIMARY",
        effectiveFrom: today,
        reason: "INITIAL",
      });
    }
  }

  console.log(
    `Synthetic workforce ready: ${unitCount} units, ${staffCount} staff, seed ${seed}.`,
  );
};

main().catch((error: unknown) => {
  console.error("Synthetic workforce generation failed.", error);
  process.exitCode = 1;
});
