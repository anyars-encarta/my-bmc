import { sql } from "drizzle-orm";

import { db } from "../src/db/index.js";
import type { ListQuery } from "../src/lib/listQuery.js";
import { findDuplicateCandidates, searchPatients } from "../src/lib/patientRegistry.js";

// Patient search performance check (Sprint 7 acceptance: "Kwame Mensah" is found for
// "Kwame Mensa" / "Mensah Kwame" in < 300 ms at 300 k rows).
//
//   npm run seed:patients -- --count=300000
//   npm run perf:patient-search -- --budget=300 --iterations=15
//
// Timings are wall-clock per search, so they include the network round trip to the database.

const readNumber = (name: string, fallback: number) => {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number.`);
  return value;
};

const listQuery = (q: string): ListQuery => ({
  page: 1,
  limit: 25,
  offset: 0,
  q,
  include: [],
  sort: [{ field: "registeredAt", descending: true }],
  filters: [],
});

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

const main = async () => {
  const budget = readNumber("budget", 300);
  const iterations = Math.trunc(readNumber("iterations", 15));

  const [{ total } = { total: 0 }] = (
    await db.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM patient WHERE status <> 'MERGED'`)
  ).rows as Array<{ total: number }>;
  const sample = (
    await db.execute(sql`
      SELECT mrn, phone FROM patient
      WHERE first_name = 'Kwame' AND last_name = 'Mensah' AND status = 'ACTIVE' AND confidentiality = 'NORMAL'
      LIMIT 1
    `)
  ).rows[0] as { mrn: string; phone: string | null } | undefined;
  if (!sample) {
    throw new Error("No 'Kwame Mensah' patient exists. Seed synthetic patients first: npm run seed:patients");
  }
  console.log(`Patients: ${total}. Budget: p95 < ${budget} ms over ${iterations} runs.\n`);

  type Row = { firstName: string; lastName: string; mrn: string; phone: string | null };
  const kwameMensah = (rows: Row[]) => rows.some((row) => row.firstName === "Kwame" && row.lastName === "Mensah");
  const searches: Array<{ q: string; expect: (rows: Row[]) => boolean }> = [
    { q: "Kwame Mensa", expect: kwameMensah },
    { q: "Mensah Kwame", expect: kwameMensah },
    { q: "kwame mensah", expect: kwameMensah },
    { q: "Mensa", expect: (rows) => rows[0]?.lastName === "Mensah" },
    { q: "Akosua Frimpon", expect: (rows) => rows[0]?.firstName === "Akosua" && rows[0]?.lastName === "Frimpong" },
    { q: sample.mrn, expect: (rows) => rows[0]?.mrn === sample.mrn },
    { q: sample.phone ?? "0200000000", expect: (rows) => !sample.phone || rows.some((row) => row.phone === sample.phone) },
  ];

  const cases: Array<{ label: string; run: () => Promise<{ rows: number; found: boolean }> }> = [
    ...searches.map(({ q, expect }) => ({
      label: `search "${q}"`,
      run: async () => {
        const result = await searchPatients(listQuery(q), { unitIds: null, sortExplicit: false });
        return { rows: result.total, found: expect(result.rows) };
      },
    })),
    {
      label: "duplicate check (name + DOB + phone)",
      run: async () => {
        const candidates = await findDuplicateCandidates({
          firstName: "Kwame",
          lastName: "Mensah",
          dateOfBirth: "1984-06-15",
          phone: sample.phone,
        });
        return { rows: candidates.length, found: true };
      },
    },
  ];

  let failed = false;
  for (const entry of cases) {
    await entry.run();
    const timings: number[] = [];
    let last = { rows: 0, found: true };
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      last = await entry.run();
      timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    const p50 = percentile(timings, 0.5);
    const p95 = percentile(timings, 0.95);
    const ok = p95 < budget && last.found;
    failed ||= !ok;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${entry.label.padEnd(40)} p50 ${p50.toFixed(0).padStart(4)} ms  p95 ${p95
        .toFixed(0)
        .padStart(4)} ms  matches ${last.rows}${last.found ? "" : "  (expected patient not on the first page)"}`,
    );
  }

  if (failed) {
    console.error(`\nPatient search exceeded the ${budget} ms budget or missed an expected result.`);
    process.exit(1);
  }
  console.log("\nPatient search is within budget.");
  process.exit(0);
};

main().catch((error: unknown) => {
  console.error("Patient search performance check failed:", error);
  process.exit(1);
});
