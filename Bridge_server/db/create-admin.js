/**
 * db/create-admin.js
 * ─────────────────────────────────────────────────────────────────
 * Creates (or promotes an existing account to) an admin: is_admin=true
 * so it can reach /api/logs/* (routes/logs.js, admin-only on the
 * hosted deployment), sku='full' with review_status pre-approved so
 * it isn't stuck behind the same manual full-tier review a paying
 * customer would go through, and phone/email marked verified since
 * there's no signup flow to have done that.
 *
 * Run via `npm run admin:create -- <email> <password>` against
 * whichever DATABASE_URL is active. Only account/profile creation is
 * new here — SKUs and review status still use routes/billing.js's
 * existing rules on this profile going forward, this is a one-time
 * bootstrap, not a special account type the rest of the app knows
 * about beyond is_admin.
 */
import { getAccount, createAccount, setAdmin } from './accounts.js';
import { getProfile, createProfile, setSku, setReviewStatus, setEmailVerified } from './profiles.js';
import { hashPassword } from '../auth/password.js';
import { getPool } from './pool.js';

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node db/create-admin.js <email> <password>');
    process.exit(1);
  }

  const existing = await getAccount(email);
  if (existing) {
    await setAdmin(email, true);
    console.log(`[create-admin] ${email} already had an account — promoted to admin.`);
  } else {
    await createAccount({ email, passwordHash: hashPassword(password), isAdmin: true });
    await createProfile({ email, phone: null, sku: 'full', phoneVerified: true });
    console.log(`[create-admin] Created admin account for ${email}.`);
  }

  const profile = await getProfile(email);
  if (profile.sku !== 'full') await setSku(email, 'full');
  if (profile.review_status !== 'approved') await setReviewStatus(email, 'approved');
  await setEmailVerified(email, true);

  console.log(`[create-admin] ${email} is now an admin with full-tier access.`);
}

main()
  .catch(err => {
    console.error('[create-admin] Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
