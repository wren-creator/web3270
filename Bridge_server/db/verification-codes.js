import { getPool } from './pool.js';

export async function setCode({ email, channel, code, expiresAt }) {
  await getPool().query(
    `INSERT INTO verification_codes (email, channel, code, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email, channel) DO UPDATE SET code = $3, expires_at = $4`,
    [email, channel, code, expiresAt],
  );
}

export async function getCode(email, channel) {
  const { rows } = await getPool().query(
    `SELECT * FROM verification_codes WHERE email = $1 AND channel = $2`,
    [email, channel],
  );
  return rows[0] || null;
}

export async function deleteCode(email, channel) {
  await getPool().query(`DELETE FROM verification_codes WHERE email = $1 AND channel = $2`, [email, channel]);
}
