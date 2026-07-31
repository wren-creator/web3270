/**
 * routes/auth.js
 * ─────────────────────────────────────────────────────────────────
 * POST /api/signup       — creates a pending_signups row, texts a
 *                           phone OTP. No account exists yet.
 * POST /api/verify-phone — confirms the OTP, promotes the pending
 *                           signup into real accounts/profiles rows.
 * POST /api/resend-code  — regenerates the OTP for a pending signup.
 *
 * Security note: `sku` captured at signup is intent only (which
 * pricing button the user clicked), not entitlement. The account
 * created here always starts on `profiles.sku = 'base'` regardless
 * of what was requested — real tier elevation only happens once
 * PayPal confirms payment (routes/billing.js, task 4). Trusting a
 * client-supplied sku here would let anyone grant themselves the
 * full tier for free by editing the signup request body.
 */

import { createAccount, getAccount } from '../db/accounts.js';
import { createProfile } from '../db/profiles.js';
import { createPendingSignup, getPendingSignup, updateOtp, deletePendingSignup } from '../db/pending-signups.js';
import { hashPassword } from '../auth/password.js';
import { generateOtp, otpExpiry, isExpired } from '../auth/otp.js';
import { normalizePhone } from '../utils/phone.js';
import { sendSms } from '../notifications/telnyx-sms.js';

const VALID_SKUS = new Set(['base', 'training', 'full']);
const RESEND_COOLDOWN_MS = 60 * 1000;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
  });
}

async function handleSignup(req, res, { logger }) {
  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const { email, password, firstName, lastName, phone } = params;
  const requestedSku = VALID_SKUS.has(params.sku) ? params.sku : 'base';

  if (!email || !password || !phone) {
    send(res, 400, { error: 'Missing required field: email, password, and phone are all required' });
    return;
  }

  let normalizedPhone;
  try { normalizedPhone = normalizePhone(phone); }
  catch (err) { send(res, 400, { error: err.message }); return; }

  const existing = await getAccount(email);
  if (existing) {
    send(res, 409, { error: 'An account with this email already exists' });
    return;
  }

  const passwordHash = hashPassword(password);
  const otpCode = generateOtp();
  const otpExpiresAt = otpExpiry(10);

  await createPendingSignup({
    email, firstName, lastName, phone: normalizedPhone,
    passwordHash, sku: requestedSku, otpCode, otpExpiresAt,
  });

  try {
    await sendSms(normalizedPhone, `Your webterm-3270.com verification code is ${otpCode}. It expires in 10 minutes.`);
  } catch (err) {
    logger.error(`[auth] signup SMS send failed for ${email}: ${err.message}`);
    send(res, 502, { error: 'Could not send verification code — try again shortly' });
    return;
  }

  send(res, 200, { status: 'otp_sent' });
}

async function handleVerifyPhone(req, res, { logger }) {
  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const { email, code } = params;
  if (!email || !code) {
    send(res, 400, { error: 'Missing required field: email and code are required' });
    return;
  }

  const pending = await getPendingSignup(email);
  if (!pending) {
    send(res, 404, { error: 'No pending signup found for this email — start over at /api/signup' });
    return;
  }

  if (isExpired(pending.otp_expires_at)) {
    send(res, 400, { error: 'Verification code has expired — request a new one via /api/resend-code' });
    return;
  }

  if (code !== pending.otp_code) {
    send(res, 401, { error: 'Incorrect verification code' });
    return;
  }

  await createAccount({ email: pending.email, passwordHash: pending.password_hash });
  // profiles.sku intentionally stays at its 'base' default here — see
  // the module header note. pending.sku is only surfaced back to the
  // caller so the frontend can redirect straight into checkout for the
  // plan the user actually asked for.
  await createProfile({
    email: pending.email,
    firstName: pending.first_name,
    lastName: pending.last_name,
    phone: pending.phone,
    phoneVerified: true,
  });
  await deletePendingSignup(email);

  logger.info(`[auth] account created: ${email} (requested tier: ${pending.sku})`);
  send(res, 200, { status: 'account_created', requestedSku: pending.sku });
}

async function handleResendCode(req, res, { logger }) {
  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const { email } = params;
  if (!email) { send(res, 400, { error: 'Missing required field: email' }); return; }

  const pending = await getPendingSignup(email);
  if (!pending) {
    send(res, 404, { error: 'No pending signup found for this email — start over at /api/signup' });
    return;
  }

  const codeGeneratedAt = new Date(pending.otp_expires_at).getTime() - 10 * 60 * 1000;
  const msSinceLastCode = Date.now() - codeGeneratedAt;
  if (msSinceLastCode < RESEND_COOLDOWN_MS) {
    send(res, 429, { error: 'Please wait a minute before requesting another code' });
    return;
  }

  const otpCode = generateOtp();
  const otpExpiresAt = otpExpiry(10);
  await updateOtp(email, otpCode, otpExpiresAt);

  try {
    await sendSms(pending.phone, `Your webterm-3270.com verification code is ${otpCode}. It expires in 10 minutes.`);
  } catch (err) {
    logger.error(`[auth] resend SMS send failed for ${email}: ${err.message}`);
    send(res, 502, { error: 'Could not send verification code — try again shortly' });
    return;
  }

  send(res, 200, { status: 'otp_sent' });
}

export function handle(req, res, ctx) {
  if (req.method !== 'POST') return false;
  if (req.url === '/api/signup')        { handleSignup(req, res, ctx);       return true; }
  if (req.url === '/api/verify-phone')  { handleVerifyPhone(req, res, ctx);  return true; }
  if (req.url === '/api/resend-code')   { handleResendCode(req, res, ctx);   return true; }
  return false;
}
