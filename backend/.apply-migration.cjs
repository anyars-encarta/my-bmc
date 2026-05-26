const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const migrationFile = path.join(process.cwd(), 'drizzle', '0000_busy_bishop.sql');
  const content = fs.readFileSync(migrationFile, 'utf8');
  const statements = content
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await sql.query(stmt);
  }

  await sql.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  await sql.query(`
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    SELECT '0000_busy_bishop', ${Date.now()}
    WHERE NOT EXISTS (
      SELECT 1 FROM "__drizzle_migrations" WHERE hash = '0000_busy_bishop'
    )
  `);

  console.log('MANUAL_MIGRATION_APPLIED=1');
})().catch((e) => {
  console.error('MANUAL_MIGRATION_FAILED=' + (e?.message || String(e)));
  process.exit(1);
});
