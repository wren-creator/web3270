import { getPool } from './pool.js';

export async function createPendingSignup({ email, firstName, lastName, phone, passwordHash, sku = 'base', otpCode, otpExpiresAt }) {
  await getPool().query(
    `INSERT INTO pending_signups (email, first_name, last_name, phone, password_hash, sku, otp_code, otp_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO UPDATE SET
       first_name = $2, last_name = $3, phone = $4, password_hash = $5,
       sku = $6, otp_code = $7, otp_expires_at = $8, created_at = now()`,
    [email, firstName || null, lastName || null, phone, passwordHash, sku, otpCode, otpExpiresAt],
  );
}

export async function getPendingSignup(email) {
  const { rows } = await getPool().query(`SELECT * FROM pending_signups WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function updateOtp(email, otpCode, otpExpiresAt) {
  await getPool().query(
    `UPDATE pending_signups SET otp_code = $2, otp_expires_at = $3 WHERE email = $1`,
    [email, otpCode, otpExpiresAt],
  );
}

export async function deletePendingSignup(email) {
  await getPool().query(`DELETE FROM pending_signups WHERE email = $1`, [email]);
}
