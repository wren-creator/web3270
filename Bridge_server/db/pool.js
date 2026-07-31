/**
 * db/pool.js
 * ─────────────────────────────────────────────────────────────────
 * Shared Postgres connection pool. Every store module imports
 * getPool() rather than talking to `pg` directly.
 */

import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — refusing to connect without a configured database.');
  }

  // Render's managed Postgres requires SSL; local/dev Postgres usually
  // doesn't have a cert to verify. Default to on (Render), opt out for
  // local dev via DATABASE_SSL=false rather than the other way around,
  // so a forgotten env var fails toward the safer option in production.
  const useSsl = process.env.DATABASE_SSL !== 'false';

  pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });

  return pool;
}
