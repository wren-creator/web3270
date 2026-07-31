/**
 * routes/disclaimer.js
 * ─────────────────────────────────────────────────────────────────
 * GET  /api/disclaimer        — current full-tier disclaimer text + version.
 * POST /api/disclaimer/accept — records acceptance and notifies Britley
 *                                to reach out manually, since full tier
 *                                (security/recon/fuzzing tools against
 *                                real hosts) is not pure self-serve.
 *
 * This is the actual gate mentioned in routes/billing.js (task 4):
 * checkout for sku='full' refuses to proceed until this has been
 * accepted for the current DISCLAIMER_VERSION. Bumping the version
 * string here re-gates every account, since db/disclaimers.js checks
 * acceptance against an exact (email, tier, version) match.
 */

import { recordAcceptance, hasAccepted } from '../db/disclaimers.js';
import { requireLogin } from './auth.js';
import { sendEmail } from '../notifications/smtp-email.js';

export const DISCLAIMER_TIER = 'full';
export const DISCLAIMER_VERSION = '2026-07-30-v1';
export const DISCLAIMER_TEXT =
  'The full tier includes security, reconnaissance, and fuzzing tools ' +
  'capable of testing real TN3270/5250 hosts. You are solely ' +
  'responsible for having authorization to test any host you point ' +
  'these tools at. Full-tier accounts are reviewed manually before ' +
  'these tools are enabled.';

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// See the matching comment in routes/auth.js: an async handler nobody
// awaits turns a rejected DB call into an unhandled rejection, which
// crashes the whole process, not just this request.
function guard(fn, label) {
  return (req, res, ctx) => {
    fn(req, res, ctx).catch(err => {
      ctx.logger.error(`[disclaimer] ${label} failed: ${err.stack || err.message}`);
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
      catch (err) { reject(err); }
    });
  });
}

function handleGet(req, res) {
  send(res, 200, { tier: DISCLAIMER_TIER, version: DISCLAIMER_VERSION, text: DISCLAIMER_TEXT });
}

async function notifyAdmin(email, logger) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (!adminEmail) {
    logger.warn('[disclaimer] ADMIN_NOTIFY_EMAIL is not configured — skipping full-tier reach-out notification');
    return;
  }
  try {
    await sendEmail(
      adminEmail,
      'Full-tier disclaimer accepted — reach-out needed',
      `${email} accepted the full-tier disclaimer (version ${DISCLAIMER_VERSION}). ` +
      `Review the account and reach out to get them onboarded.`,
    );
  } catch (err) {
    // Don't fail the request over a notification hiccup — the
    // acceptance is already recorded and review_status is already
    // 'pending' from billing.js, so this is a delayed reach-out at
    // worst, not a blocked signup.
    logger.error(`[disclaimer] admin notify email failed for ${email}: ${err.message}`);
  }
}

async function handleAccept(req, res, { logger }) {
  const email = requireLogin(req, res);
  if (!email) return;

  let params;
  try { params = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  if (params.version !== DISCLAIMER_VERSION) {
    send(res, 409, { error: 'Disclaimer version is out of date, reload and try again' });
    return;
  }

  const ipAddress = req.socket?.remoteAddress || null;
  await recordAcceptance({ email, tier: DISCLAIMER_TIER, disclaimerVersion: DISCLAIMER_VERSION, ipAddress });
  await notifyAdmin(email, logger);

  send(res, 200, { status: 'accepted' });
}

/**
 * Shared gate for routes/billing.js: has this email accepted the
 * current disclaimer version for the full tier?
 */
export async function hasAcceptedCurrent(email) {
  return hasAccepted(email, DISCLAIMER_TIER, DISCLAIMER_VERSION);
}

export function handle(req, res, ctx) {
  if (req.method === 'GET'  && req.url === '/api/disclaimer') { handleGet(req, res); return true; }
  if (req.method === 'POST' && req.url === '/api/disclaimer/accept') { guard(handleAccept, 'accept')(req, res, ctx); return true; }
  return false;
}
