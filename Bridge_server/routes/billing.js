/**
 * routes/billing.js
 * ─────────────────────────────────────────────────────────────────
 * POST /api/billing/checkout — logged-in user picks a tier, we create
 *                               a PayPal subscription and hand back an
 *                               approval URL to redirect them to.
 * GET  /api/billing/return    — PayPal's return_url after approval.
 *                               Fallback reconciliation: check the
 *                               subscription's real status directly.
 * POST /api/billing/webhook   — PayPal's async event delivery. This is
 *                               the primary path — unlike
 *                               stock-alarm-service, which only
 *                               reconciles on return-url and misses
 *                               anything that happens later (a failed
 *                               renewal, a cancellation), this catches
 *                               subscription state changes whenever
 *                               PayPal reports them, not just the one
 *                               moment the buyer lands back on our site.
 *
 * Full-tier note: checkout for sku='full' is gated on having accepted
 * the current disclaimer version (routes/disclaimer.js), which is also
 * where the reach-out notification to Britley fires. Once the
 * subscription activates, applySkuUpdate() below sets review_status
 * to 'pending' if it isn't already something further along.
 */

import { getProfile, setSku, setPaypalSubscriptionId, setReviewStatus, findByPaypalSubscriptionId } from '../db/profiles.js';
import { requireLogin } from './auth.js';
import { hasAcceptedCurrent } from './disclaimer.js';
import * as paypal from '../billing/paypal.js';

const VALID_SKUS = new Set(['base', 'training', 'full']);
const ACTIVE_STATUSES = new Set(['ACTIVE']);
const DOWNGRADE_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
]);

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// See the matching comment in routes/auth.js: an async handler nobody
// awaits turns a rejected DB call into an unhandled rejection, which
// crashes the whole process, not just this request. handleWebhook is
// the sharpest edge here since PayPal calls it unattended.
function guard(fn, label) {
  return (req, res, ctx) => {
    fn(req, res, ctx).catch(err => {
      ctx.logger.error(`[billing] ${label} failed: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'Internal server error' });
    });
  };
}

function readRawBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function baseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
}

async function applySkuUpdate(email, sku, logger) {
  await setSku(email, sku);
  if (sku === 'full') {
    const profile = await getProfile(email);
    if (profile.review_status === 'n/a') {
      await setReviewStatus(email, 'pending');
      logger.info(`[billing] ${email} activated full tier — review_status set to pending`);
    }
  }
}

async function handleCheckout(req, res, { logger }) {
  const email = requireLogin(req, res);
  if (!email) return;

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let params;
    try { params = body ? JSON.parse(body) : {}; }
    catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

    const sku = params.sku;
    if (!VALID_SKUS.has(sku)) {
      send(res, 400, { error: `sku must be one of: ${[...VALID_SKUS].join(', ')}` });
      return;
    }

    if (sku === 'full' && !(await hasAcceptedCurrent(email))) {
      send(res, 403, { error: 'Accept the full-tier disclaimer before checkout', disclaimerRequired: true });
      return;
    }

    const returnUrl = `${baseUrl(req)}/api/billing/return`;
    const cancelUrl = `${baseUrl(req)}/billing`;

    try {
      const { subscriptionId, approveUrl } = await paypal.createCheckoutUrl(email, sku, returnUrl, cancelUrl);
      // Persist right away, before the buyer has even approved, so
      // cancellation/status checks work even if they never finish —
      // same rationale as stock-alarm-service's api_billing_checkout().
      await setPaypalSubscriptionId(email, subscriptionId);
      send(res, 200, { approveUrl });
    } catch (err) {
      logger.error(`[billing] checkout creation failed for ${email}: ${err.message}`);
      send(res, 502, { error: 'Could not start checkout — try again shortly' });
    }
  });
}

async function handleReturn(req, res, { logger }) {
  const email = requireLogin(req, res);
  if (!email) return;

  const profile = await getProfile(email);
  if (!profile?.paypal_subscription_id) {
    send(res, 400, { error: 'No pending subscription on file' });
    return;
  }

  try {
    const { status, planId } = await paypal.getSubscription(profile.paypal_subscription_id);
    if (ACTIVE_STATUSES.has(status)) {
      const sku = paypal.skuForPlanId(planId);
      if (sku) await applySkuUpdate(email, sku, logger);
    }
    send(res, 200, { status });
  } catch (err) {
    logger.error(`[billing] return-url reconciliation failed for ${email}: ${err.message}`);
    send(res, 502, { error: 'Could not confirm subscription status' });
  }
}

async function handleWebhook(req, res, { logger }) {
  const rawBody = await readRawBody(req);

  let verified;
  try {
    verified = await paypal.verifyWebhookSignature(req.headers, rawBody);
  } catch (err) {
    logger.error(`[billing] webhook verification error: ${err.message}`);
    send(res, 503, { error: 'Webhook verification is not configured' });
    return;
  }
  if (!verified) {
    logger.warn('[billing] webhook rejected: signature did not verify');
    send(res, 400, { error: 'Invalid signature' });
    return;
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  const subscriptionId = event.resource?.id;
  if (!subscriptionId) { send(res, 200, { status: 'ignored' }); return; }

  const profile = await findByPaypalSubscriptionId(subscriptionId);
  if (!profile) {
    logger.warn(`[billing] webhook for unknown subscription ${subscriptionId} (${event.event_type})`);
    send(res, 200, { status: 'ignored' });
    return;
  }

  if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const sku = paypal.skuForPlanId(event.resource.plan_id);
    if (sku) await applySkuUpdate(profile.email, sku, logger);
  } else if (DOWNGRADE_EVENTS.has(event.event_type)) {
    await setSku(profile.email, 'base');
    logger.info(`[billing] ${profile.email} subscription ${event.event_type} — reverted to base tier`);
  }

  send(res, 200, { status: 'ok' });
}

export function handle(req, res, ctx) {
  if (req.method === 'POST' && req.url === '/api/billing/checkout') { guard(handleCheckout, 'checkout')(req, res, ctx); return true; }
  if (req.method === 'GET'  && req.url.startsWith('/api/billing/return')) { guard(handleReturn, 'return')(req, res, ctx); return true; }
  if (req.method === 'POST' && req.url === '/api/billing/webhook') { guard(handleWebhook, 'webhook')(req, res, ctx); return true; }
  return false;
}
