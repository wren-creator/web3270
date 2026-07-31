/**
 * auth/session.js
 * ─────────────────────────────────────────────────────────────────
 * Hand-rolled HMAC-signed session cookie — no Express here, so no
 * express-session. Cookie value is base64url(JSON payload) + "." +
 * base64url(HMAC-SHA256 signature). Verified with a constant-time
 * comparison so this can't be timed into a forgery.
 *
 * Reused for both the HTTP routes (req.headers.cookie) and the
 * WebSocket upgrade request in handlers/ws.js — browsers attach
 * cookies to the WS handshake the same as any other request.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'wt3270_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set — refusing to issue or verify sessions.');
  }
  return secret;
}

function sign(encodedPayload) {
  return createHmac('sha256', getSecret()).update(encodedPayload).digest('base64url');
}

function secureAttr() {
  return process.env.COOKIE_SECURE !== 'false' ? '; Secure' : '';
}

export function createSessionCookie(email) {
  const payload = JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload).toString('base64url');
  const value = `${encoded}.${sign(encoded)}`;
  return `${COOKIE_NAME}=${value}; HttpOnly${secureAttr()}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly${secureAttr()}; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return [pair.trim(), ''];
    return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
  }));
}

/**
 * Returns the logged-in email for a request, or null if there's no
 * session, the signature doesn't verify, or it's expired. Never
 * throws on a bad/missing cookie — only on a missing SESSION_SECRET,
 * which is a deployment misconfiguration, not a client error.
 */
export function getSessionEmail(req) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return null;

  const [encoded, sig] = value.split('.');
  if (!encoded || !sig) return null;

  const expectedSig = sign(encoded);
  const provided = Buffer.from(sig);
  const expected = Buffer.from(expectedSig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()); }
  catch { return null; }

  if (!payload.email || !payload.exp || payload.exp < Date.now()) return null;
  return payload.email;
}
