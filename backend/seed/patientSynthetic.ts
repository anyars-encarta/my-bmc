import { sql } from "drizzle-orm";

import { db } from "../src/db/index.js";

// Synthetic patients for search/duplicate performance testing (Sprint 7, S7-3).
// Rows are generated inside the database with generate_series, carry an `SYN-` MRN so that they
// never consume the real MRN sequence, and can be removed again with `--purge`.
//
//   npm run seed:patients -- --count=300000 --seed=7
//   npm run seed:patients -- --purge

const firstNames = [
  "Kwame", "Kofi", "Kwasi", "Kwadwo", "Kwabena", "Kwaku", "Yaw", "Kojo", "Ama", "Afia", "Akosua", "Adwoa",
  "Abena", "Akua", "Yaa", "Esi", "Efua", "Araba", "Ekow", "Fiifi", "Nana", "Nii", "Naa", "Adjoa", "Abla",
  "Mawuli", "Selorm", "Dzifa", "Elikem", "Senam", "Abdul", "Fatima", "Ibrahim", "Amina", "Issah", "Rukaya",
  "Emmanuel", "Grace", "Samuel", "Mary", "Daniel", "Comfort", "Joseph", "Patience", "Isaac", "Mercy",
  "Michael", "Gifty", "Stephen", "Abigail", "Prince", "Rita", "Richard", "Linda", "Ebenezer", "Janet",
  "Francis", "Vida", "Benjamin", "Felicia",
];
const lastNames = [
  "Mensah", "Owusu", "Osei", "Boateng", "Asante", "Appiah", "Agyeman", "Tetteh", "Asare", "Amoah", "Addo",
  "Ansah", "Boakye", "Danso", "Darko", "Frimpong", "Gyamfi", "Kyei", "Lamptey", "Nkansah", "Ofori", "Opoku",
  "Oppong", "Quaye", "Sarpong", "Yeboah", "Acheampong", "Adjei", "Agyei", "Amankwah", "Ampofo", "Antwi",
  "Arthur", "Awuah", "Baah", "Badu", "Bonsu", "Donkor", "Essien", "Fosu", "Kumi", "Larbi", "Manu", "Nartey",
  "Nyarko", "Obeng", "Ocran", "Odoom", "Okyere", "Otoo", "Quartey", "Sackey", "Takyi", "Wiredu", "Abubakar",
  "Alhassan", "Iddrisu", "Mohammed", "Seidu", "Yakubu", "Zakari", "Agbeko", "Amegashie", "Dzamesi", "Gbedemah",
  "Kpodo", "Tamakloe", "Aryee", "Ankrah", "Bruce", "Cudjoe", "Dadzie", "Eshun", "Ghartey", "Hammond",
];
const towns = ["Accra", "Kumasi", "Tamale", "Takoradi", "Cape Coast", "Ho", "Koforidua", "Sunyani", "Bolgatanga", "Wa"];

const readArgument = (name: string) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];

const readInteger = (name: string, fallback: number, minimum: number, maximum: number) => {
  const raw = readArgument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
};

const textArray = (values: string[]) => sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;

const main = async () => {
  if (process.argv.includes("--purge")) {
    const result = await db.execute(sql`DELETE FROM patient WHERE mrn LIKE 'SYN-%'`);
    console.log(`Removed ${result.rowCount ?? 0} synthetic patient(s).`);
    return;
  }

  const count = readInteger("count", 5000, 1, 2_000_000);
  const batchSize = readInteger("batch", 20_000, 100, 100_000);
  const seed = readInteger("seed", Math.floor(Date.now() / 1000) % 60_000_000, 0, 60_466_175);
  const seedCode = seed.toString(36).toUpperCase().padStart(5, "0");
  const started = Date.now();

  // A squared uniform value skews picks towards the head of each list, so that common names
  // (Kwame, Ama, Mensah, Owusu …) dominate the way they do in real registers.
  const pick = (salt: string, size: number) =>
    sql`(floor(power((abs(hashtext(${salt} || g::text || ${seedCode})) % 100000) / 100000.0, 2) * ${size})::int + 1)`;

  for (let from = 1; from <= count; from += batchSize) {
    const to = Math.min(count, from + batchSize - 1);
    await db.execute(sql`
      INSERT INTO patient (
        mrn, first_name, middle_name, last_name, sex, date_of_birth, phone, phone_e164, town,
        registered_at, created_by, updated_by
      )
      SELECT
        'SYN-' || ${seedCode} || '-' || lpad(g::text, 7, '0'),
        (${textArray(firstNames)})[${pick("f", firstNames.length)}],
        CASE WHEN abs(hashtext('m' || g::text || ${seedCode})) % 4 = 0
          THEN (${textArray(firstNames)})[${pick("x", firstNames.length)}] END,
        (${textArray(lastNames)})[${pick("l", lastNames.length)}],
        CASE WHEN abs(hashtext('s' || g::text || ${seedCode})) % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END,
        date '1930-01-01' + (abs(hashtext('d' || g::text || ${seedCode})) % 34000),
        '02' || lpad((abs(hashtext('p' || g::text || ${seedCode})) % 100000000)::text, 8, '0'),
        '+2332' || lpad((abs(hashtext('p' || g::text || ${seedCode})) % 100000000)::text, 8, '0'),
        (${textArray(towns)})[abs(hashtext('t' || g::text || ${seedCode})) % ${towns.length} + 1],
        now() - make_interval(days => abs(hashtext('r' || g::text || ${seedCode})) % 1500),
        'synthetic-seed', 'synthetic-seed'
      FROM generate_series(${from}::int, ${to}::int) AS g
      ON CONFLICT (mrn) DO NOTHING
    `);
    console.log(`  ${to}/${count} synthetic patients`);
  }

  await db.execute(sql`ANALYZE patient`);
  console.log(
    `Generated ${count} synthetic patients with seed ${seed} (MRN prefix SYN-${seedCode}) in ${Math.round((Date.now() - started) / 1000)}s.`,
  );
  console.log("They are synthetic records: remove them with `npm run seed:patients -- --purge`.");
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Synthetic patient seed failed:", error);
    process.exit(1);
  });
