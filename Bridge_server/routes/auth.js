/**
 * routes/auth.js
 * ─────────────────────────────────────────────────────────────────
 * POST /api/signup       — creates a pending_signups row, texts a
 *                           phone OTP. No account exists yet.
 * POST /api/verify-phone — confirms the OTP, promotes the pending
 *                           signup into real accounts/profiles rows.
 * POST /api/resend-code  — regenerates the OTP for a pending signup.
 * POST /api/login         — verifies password, issues a session cookie.
 * POST /api/logout        — clears the session cookie.
 * POST /api/send-email-code — post-login, emails a verification code.
 * POST /api/verify-email  — confirms that code, sets profiles.email_verified.
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
import { createProfile, setEmailVerified } from '../db/profiles.js';
import { createPendingSignup, getPendingSignup, updateOtp, deletePendingSignup } from '../db/pending-signups.js';
import { setCode, getCode, deleteCode } from '../db/verification-codes.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { generateOtp, otpExpiry, isExpired } from '../auth/otp.js';
import { createSessionCookie, clearSessionCookie, getSessionEmail } from '../auth/session.js';
import { normalizePhone } from '../utils/phone.js';
import { sendSms } from '../notifications/telnyx-sms.js';
import { sendEmail } from '../notifications/smtp-email.js';

const VALID_SKUS = new Set(['base', 'training', 'full']);
const RESEND_COOLDOWN_MS = 60 * 1000;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Handlers below don't wrap every DB call in try/catch — a rejected
// promise from an async route handler that nothing awaits is an
// unhandled rejection, which crashes the whole process by default in
// modern Node, not just this one request. Routing every handler
// through this keeps a DB hiccup (or an unset DATABASE_URL) a 500 for
// one caller instead of an outage for everyone connected.
function guard(fn, label) {
  return (req, res, ctx) => {
    fn(req, res, ctx).catch(err => {
      ctx.logger.error(`[auth] ${label} failed: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
    });
  };
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

/**
 * Shared login guard for this and other route modules (billing, etc.).
 * Returns the logged-in email, or sends a 401 and returns null.
 */
export function requireLogin(req, res) {
  const email = getSessionEmail(req);
  if (!email) {
    send(res, 401, { error: 'Not logged in' });
    return null;
  }
  return email;
}

async function handleLogin(req, res) {
  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const { email, password } = params;
  if (!email || !password) {
    send(res, 400, { error: 'Missing required field: email and password are required' });
    return;
  }

  const account = await getAccount(email);
  // Same generic message either way — don't let login responses reveal
  // whether an email is registered.
  if (!account || account.frozen || !verifyPassword(password, account.password_hash)) {
    send(res, 401, { error: 'Invalid email or password' });
    return;
  }

  res.setHeader('Set-Cookie', createSessionCookie(email));
  send(res, 200, { status: 'logged_in', email });
}

async function handleLogout(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  send(res, 200, { status: 'logged_out' });
}

async function handleSendEmailCode(req, res, { logger }) {
  const email = requireLogin(req, res);
  if (!email) return;

  const code = generateOtp();
  const expiresAt = otpExpiry(10);
  await setCode({ email, channel: 'email', code, expiresAt });

  try {
    await sendEmail(email, 'Verify your email — webterm-3270.com', `Your verification code is ${code}. It expires in 10 minutes.`);
  } catch (err) {
    logger.error(`[auth] email verification send failed for ${email}: ${err.message}`);
    send(res, 502, { error: 'Could not send verification email — try again shortly' });
    return;
  }

  send(res, 200, { status: 'code_sent' });
}

async function handleVerifyEmail(req, res) {
  const email = requireLogin(req, res);
  if (!email) return;

  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const { code } = params;
  if (!code) { send(res, 400, { error: 'Missing required field: code' }); return; }

  const stored = await getCode(email, 'email');
  if (!stored) {
    send(res, 404, { error: 'No verification code pending — request one via /api/send-email-code' });
    return;
  }
  if (isExpired(stored.expires_at)) {
    send(res, 400, { error: 'Verification code has expired — request a new one' });
    return;
  }
  if (code !== stored.code) {
    send(res, 401, { error: 'Incorrect verification code' });
    return;
  }

  await setEmailVerified(email, true);
  await deleteCode(email, 'email');
  send(res, 200, { status: 'email_verified' });
}

export function handle(req, res, ctx) {
  if (req.method !== 'POST') return false;
  if (req.url === '/api/signup')          { guard(handleSignup, 'signup')(req, res, ctx);         return true; }
  if (req.url === '/api/verify-phone')    { guard(handleVerifyPhone, 'verify-phone')(req, res, ctx);    return true; }
  if (req.url === '/api/resend-code')     { guard(handleResendCode, 'resend-code')(req, res, ctx);     return true; }
  if (req.url === '/api/login')           { guard(handleLogin, 'login')(req, res, ctx);          return true; }
  if (req.url === '/api/logout')          { guard(handleLogout, 'logout')(req, res, ctx);         return true; }
  if (req.url === '/api/send-email-code') { guard(handleSendEmailCode, 'send-email-code')(req, res, ctx);  return true; }
  if (req.url === '/api/verify-email')    { guard(handleVerifyEmail, 'verify-email')(req, res, ctx);    return true; }
  return false;
}
