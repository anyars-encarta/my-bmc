import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

type JournalEntry = {
  idx: number;
  tag: string;
  when?: number;
};

type JournalFile = {
  entries: JournalEntry[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function getSqlStatements(fileContent: string): string[] {
  return fileContent
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function readJournal(): Promise<JournalEntry[]> {
  const journalPath = path.join(projectRoot, "drizzle", "meta", "_journal.json");
  const raw = await fs.readFile(journalPath, "utf8");
  const journal = JSON.parse(raw) as JournalFile;

  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

async function ensureMigrationsTable(sql: ReturnType<typeof neon>) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function getAppliedHashes(sql: ReturnType<typeof neon>): Promise<Set<string>> {
  const rows = await sql.query<{ hash: string }>(`
    SELECT hash FROM "__drizzle_migrations"
  `);

  return new Set(rows.map((row) => row.hash));
}

async function applyMigration(
  sql: ReturnType<typeof neon>,
  entry: JournalEntry,
): Promise<void> {
  const migrationPath = path.join(projectRoot, "drizzle", `${entry.tag}.sql`);
  const sqlFile = await fs.readFile(migrationPath, "utf8");
  const statements = getSqlStatements(sqlFile);

  for (const statement of statements) {
    await sql.query(statement);
  }

  await sql.query(`
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES ('${entry.tag}', ${entry.when ?? Date.now()})
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = neon(process.env.DATABASE_URL);

  await ensureMigrationsTable(sql);

  const entries = await readJournal();
  const appliedHashes = await getAppliedHashes(sql);

  let appliedCount = 0;

  for (const entry of entries) {
    if (appliedHashes.has(entry.tag)) {
      console.log(`skip ${entry.tag}`);
      continue;
    }

    await applyMigration(sql, entry);
    appliedCount += 1;
    console.log(`apply ${entry.tag}`);
  }

  if (appliedCount === 0) {
    console.log("No pending migrations.");
    return;
  }

  console.log(`Applied ${appliedCount} migration(s).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exit(1);
});
