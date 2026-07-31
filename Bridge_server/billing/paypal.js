/**
 * billing/paypal.js
 * ─────────────────────────────────────────────────────────────────
 * Subscription billing via PayPal's REST API, no vendor SDK, matching
 * this codebase's other provider modules (notifications/telnyx-sms.js,
 * notifications/smtp-email.js). Ported from stock-alarm-service's
 * paypal_billing.py, same endpoint shapes, rebuilt for this project's
 * three named tiers (base/training/full) instead of generic sku1-3.
 *
 * PAYPAL_ENV picks sandbox vs live (defaults to sandbox so nothing
 * accidentally points at real money). Credentials and plan ids are
 * kept in separate env vars per environment so flipping PAYPAL_ENV
 * never mixes sandbox and live state.
 */

const TIMEOUT_MS = 10000;

function paypalEnv() {
  return (process.env.PAYPAL_ENV || 'sandbox').trim().toLowerCase();
}

function apiBase() {
  return paypalEnv() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

const PLAN_ID_ENV_VARS = { base: 'PAYPAL_PLAN_ID_BASE', training: 'PAYPAL_PLAN_ID_TRAINING', full: 'PAYPAL_PLAN_ID_FULL' };
const LIVE_PLAN_ID_ENV_VARS = { base: 'PAYPAL_LIVE_PLAN_ID_BASE', training: 'PAYPAL_LIVE_PLAN_ID_TRAINING', full: 'PAYPAL_LIVE_PLAN_ID_FULL' };

export class BillingError extends Error {}

function credentials() {
  if (paypalEnv() === 'live') {
    return [process.env.PAYPAL_LIVE_CLIENT_ID, process.env.PAYPAL_LIVE_CLIENT_SECRET];
  }
  return [process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET];
}

export function isConfigured() {
  const [clientId, clientSecret] = credentials();
  return Boolean(clientId && clientSecret);
}

function planId(sku) {
  const envVars = paypalEnv() === 'live' ? LIVE_PLAN_ID_ENV_VARS : PLAN_ID_ENV_VARS;
  const envVar = envVars[sku];
  const id = envVar ? process.env[envVar] : '';
  if (!id) throw new BillingError(`No PayPal plan configured for sku "${sku}"`);
  return id;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new BillingError(`connection timed out after ${TIMEOUT_MS}ms`);
    throw new BillingError(`connection failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function accessToken() {
  const [clientId, clientSecret] = credentials();
  if (!clientId || !clientSecret) throw new BillingError('PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET not fully set');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetchWithTimeout(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new BillingError(`auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function approveLink(links = []) {
  return links.find(l => l.rel === 'approve')?.href || null;
}

/**
 * Creates a new PayPal subscription for the given sku and returns
 * { subscriptionId, approveUrl }. The subscription starts in PayPal's
 * APPROVAL_PENDING state until the buyer completes checkout at
 * approveUrl — callers should persist subscriptionId right away so
 * cancellation/status checks work even if the buyer never finishes.
 */
export async function createCheckoutUrl(email, sku, returnUrl, cancelUrl) {
  if (!isConfigured()) throw new BillingError('PayPal is not connected yet');
  const plan = planId(sku);
  const token = await accessToken();

  const res = await fetchWithTimeout(`${apiBase()}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      plan_id: plan,
      custom_id: email,
      application_context: {
        brand_name: 'WebTerm/3270',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new BillingError(`checkout creation failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const url = approveLink(data.links);
  if (!url) throw new BillingError('PayPal did not return an approval link');
  return { subscriptionId: data.id, approveUrl: url };
}

/**
 * Returns { status, planId } for the given subscription. PayPal is the
 * source of truth for which plan is active, not whatever profiles.sku
 * last stored — this is what return-url and webhook reconciliation
 * both check against.
 */
export async function getSubscription(subscriptionId) {
  if (!isConfigured()) throw new BillingError('PayPal is not connected yet');
  const token = await accessToken();
  const res = await fetchWithTimeout(`${apiBase()}/v1/billing/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: headers(token),
  });
  if (!res.ok) throw new BillingError(`status check failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { status: data.status, planId: data.plan_id };
}

export async function cancelSubscription(subscriptionId) {
  if (!isConfigured()) throw new BillingError('PayPal is not connected yet');
  if (!subscriptionId) throw new BillingError('No PayPal subscription on file');
  const token = await accessToken();
  const res = await fetchWithTimeout(`${apiBase()}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ reason: 'Customer requested cancellation' }),
  });
  if (res.status !== 204) throw new BillingError(`cancellation failed: ${res.status} ${await res.text()}`);
}

/**
 * Reverse lookup: which sku (if any) currently maps to this plan_id
 * under the active PAYPAL_ENV. Used to translate a webhook/return-url
 * plan_id back into one of our tier names.
 */
export function skuForPlanId(planIdToMatch) {
  const envVars = paypalEnv() === 'live' ? LIVE_PLAN_ID_ENV_VARS : PLAN_ID_ENV_VARS;
  for (const [sku, envVar] of Object.entries(envVars)) {
    if (process.env[envVar] === planIdToMatch) return sku;
  }
  return null;
}

/**
 * Verifies an inbound webhook's signature via PayPal's own
 * verify-webhook-signature endpoint, PayPal's documented recommended
 * approach (server-to-server call, not local cert parsing). Returns
 * true only on an explicit VERIFIED response — anything else,
 * including a request error, is treated as unverified.
 */
export async function verifyWebhookSignature(headersIn, rawBody) {
  const webhookId = paypalEnv() === 'live' ? process.env.PAYPAL_LIVE_WEBHOOK_ID : process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new BillingError('PAYPAL_WEBHOOK_ID is not configured — refusing to accept webhooks.');
  if (!isConfigured()) throw new BillingError('PayPal is not connected yet');

  const transmissionId = headersIn['paypal-transmission-id'];
  const transmissionTime = headersIn['paypal-transmission-time'];
  const certUrl = headersIn['paypal-cert-url'];
  const authAlgo = headersIn['paypal-auth-algo'];
  const transmissionSig = headersIn['paypal-transmission-sig'];
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  const token = await accessToken();
  const res = await fetchWithTimeout(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}
