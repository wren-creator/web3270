import { getPool } from './pool.js';

export async function listForEmail(email) {
  const { rows } = await getPool().query(
    `SELECT * FROM session_profiles WHERE email = $1 ORDER BY created_at`,
    [email],
  );
  return rows;
}

export async function upsertForEmail(email, p) {
  await getPool().query(
    `INSERT INTO session_profiles (email, id, name, host, port, tls, type, model, tn3270e, protocol, codepage, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (email, id) DO UPDATE SET
       name = $3, host = $4, port = $5, tls = $6, type = $7, model = $8,
       tn3270e = $9, protocol = $10, codepage = $11, updated_at = now()`,
    [email, p.id, p.name, p.host, p.port, p.tls, p.type, p.model, p.tn3270e, p.protocol, p.codepage],
  );
}

export async function deleteForEmail(email, id) {
  const { rowCount } = await getPool().query(
    `DELETE FROM session_profiles WHERE email = $1 AND id = $2`,
    [email, id],
  );
  return rowCount > 0;
}
