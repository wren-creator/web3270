import { getPool } from './pool.js';

export async function createAccount({ email, passwordHash, isAdmin = false }) {
  await getPool().query(
    `INSERT INTO accounts (email, password_hash, is_admin) VALUES ($1, $2, $3)`,
    [email, passwordHash, isAdmin],
  );
}

export async function getAccount(email) {
  const { rows } = await getPool().query(`SELECT * FROM accounts WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function setPasswordHash(email, passwordHash) {
  await getPool().query(`UPDATE accounts SET password_hash = $2 WHERE email = $1`, [email, passwordHash]);
}

export async function setFrozen(email, frozen) {
  await getPool().query(`UPDATE accounts SET frozen = $2 WHERE email = $1`, [email, frozen]);
}
