import { getPool } from './pool.js';

export async function listForEmail(email) {
  const { rows } = await getPool().query(
    `SELECT * FROM ssh_host_profiles WHERE email = $1 ORDER BY created_at`,
    [email],
  );
  return rows;
}

export async function upsertForEmail(email, p) {
  await getPool().query(
    `INSERT INTO ssh_host_profiles (email, id, name, host, port, ssh_user, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (email, id) DO UPDATE SET
       name = $3, host = $4, port = $5, ssh_user = $6, updated_at = now()`,
    [email, p.id, p.name, p.host, p.port, p.sshUser],
  );
}

export async function deleteForEmail(email, id) {
  const { rowCount } = await getPool().query(
    `DELETE FROM ssh_host_profiles WHERE email = $1 AND id = $2`,
    [email, id],
  );
  return rowCount > 0;
}
