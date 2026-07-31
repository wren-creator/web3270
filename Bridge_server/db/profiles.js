import { getPool } from './pool.js';

export async function createProfile({ email, firstName, lastName, phone, sku = 'base', phoneVerified = false }) {
  await getPool().query(
    `INSERT INTO profiles (email, first_name, last_name, phone, phone_verified, sku)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email, firstName || null, lastName || null, phone, phoneVerified, sku],
  );
}

export async function getProfile(email) {
  const { rows } = await getPool().query(`SELECT * FROM profiles WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function setSku(email, sku) {
  await getPool().query(`UPDATE profiles SET sku = $2, updated_at = now() WHERE email = $1`, [email, sku]);
}

export async function setPaypalSubscriptionId(email, subscriptionId) {
  await getPool().query(
    `UPDATE profiles SET paypal_subscription_id = $2, updated_at = now() WHERE email = $1`,
    [email, subscriptionId],
  );
}

export async function setPhoneVerified(email, verified) {
  await getPool().query(`UPDATE profiles SET phone_verified = $2, updated_at = now() WHERE email = $1`, [email, verified]);
}

export async function setEmailVerified(email, verified) {
  await getPool().query(`UPDATE profiles SET email_verified = $2, updated_at = now() WHERE email = $1`, [email, verified]);
}

export async function setReviewStatus(email, status) {
  await getPool().query(`UPDATE profiles SET review_status = $2, updated_at = now() WHERE email = $1`, [email, status]);
}

export async function findByPaypalSubscriptionId(subscriptionId) {
  const { rows } = await getPool().query(`SELECT * FROM profiles WHERE paypal_subscription_id = $1`, [subscriptionId]);
  return rows[0] || null;
}
