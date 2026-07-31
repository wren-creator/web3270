/**
 * db/migrate.js
 * ─────────────────────────────────────────────────────────────────
 * Applies db/schema.sql against DATABASE_URL. Run via `npm run db:migrate`.
 * Every statement in schema.sql is CREATE TABLE/INDEX IF NOT EXISTS,
 * so this is safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = getPool();
  await pool.query(sql);
  console.log('[db:migrate] Schema applied successfully.');
  await pool.end();
}

migrate().catch(err => {
  console.error('[db:migrate] Failed:', err.message);
  process.exit(1);
});
