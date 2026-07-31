import { getPool } from './pool.js';

export async function recordAcceptance({ email, tier, disclaimerVersion, ipAddress }) {
  await getPool().query(
    `INSERT INTO disclaimer_acceptances (email, tier, disclaimer_version, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [email, tier, disclaimerVersion, ipAddress],
  );
}

export async function getAcceptances(email) {
  const { rows } = await getPool().query(
    `SELECT * FROM disclaimer_acceptances WHERE email = $1 ORDER BY accepted_at DESC`,
    [email],
  );
  return rows;
}

export async function hasAccepted(email, tier, disclaimerVersion) {
  const { rows } = await getPool().query(
    `SELECT 1 FROM disclaimer_acceptances WHERE email = $1 AND tier = $2 AND disclaimer_version = $3 LIMIT 1`,
    [email, tier, disclaimerVersion],
  );
  return rows.length > 0;
}
