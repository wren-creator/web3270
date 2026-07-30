/**
 * auth/windows-auth.js
 * ─────────────────────────────────────────────────────────────────────────
 * Windows-integrated authentication (SPNEGO/Kerberos) plus Active
 * Directory group authorization, for gating access to anything that
 * shouldn't be reachable by "anyone who knows a shared string."
 *
 * ══════════════════════════════════════════════════════════════════════
 * STATUS: written against the real, installed API surface of `kerberos`
 * and `ldapts` (checked their .d.ts files directly, not written from
 * memory), and the fail-closed error handling below is real and
 * deliberate. What is NOT true: this has never been run against an
 * actual Key Distribution Center, a real keytab, or a real Active
 * Directory. There is no test AD/Kerberos realm available in the
 * environment this was written in. Code that looks correct and code
 * that IS correct are different claims — only the second one has been
 * earned here for the rest of this codebase, not for this file yet.
 *
 * DO NOT wire this into a live route until someone with access to a
 * real domain (a real keytab, a real KDC, a real AD bind account) has
 * exercised it end to end. routes/macro-run.js still uses the
 * shared-key check for exactly this reason — swap it for
 * authenticateAndAuthorize() only after that validation has happened,
 * not before.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Required environment, once someone is ready to validate this:
 *   KRB5_SERVICE_PRINCIPAL   e.g. "HTTP@bridge.internal.example.com" —
 *                            this server's own identity. The matching
 *                            keytab must be reachable the normal MIT/
 *                            Heimdal Kerberos way (KRB5_KTNAME env var
 *                            pointing at the keytab file) — that's OS/
 *                            Kerberos-library configuration, not
 *                            something this module sets.
 *   AD_LDAP_URL              e.g. "ldaps://dc01.internal.example.com"
 *   AD_BIND_DN / AD_BIND_PASSWORD   a service account, read-only, used
 *                            only to look up group membership, never to
 *                            authenticate the caller — Kerberos already
 *                            did that part.
 *   AD_BASE_DN                the search base, e.g. "dc=internal,dc=example,dc=com"
 *   AD_REQUIRED_GROUP_DN      the group whose membership grants access,
 *                            e.g. "cn=Claims-Processors,ou=Groups,dc=internal,dc=example,dc=com"
 */

import kerberos from 'kerberos';
import { Client as LdapClient } from 'ldapts';
import logger from '../logger.cjs';

/**
 * Validates an incoming request's SPNEGO/Kerberos token.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ principal: string, negotiateResponse: string|null }>}
 *   Resolves with the authenticated principal (e.g. "jsmith@REALM.EXAMPLE.COM")
 *   on success. Rejects on anything else — missing header, malformed
 *   token, failed negotiation, missing server config. Never resolves
 *   with an empty or falsy principal; that would be a fail-open bug.
 */
export async function validateKerberos(req) {
  const servicePrincipal = process.env.KRB5_SERVICE_PRINCIPAL;
  if (!servicePrincipal) {
    throw new Error('KRB5_SERVICE_PRINCIPAL is not configured — refusing to attempt Kerberos validation without a known server identity.');
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Negotiate ')) {
    // Standard SPNEGO flow: no token yet means "challenge and wait for
    // one," not "reject outright" — the caller (route handler) decides
    // whether to send a 401 + WWW-Authenticate: Negotiate challenge.
    const err = new Error('No Negotiate token present');
    err.code = 'NO_TOKEN';
    throw err;
  }

  const clientToken = authHeader.slice('Negotiate '.length).trim();
  if (!clientToken) {
    throw new Error('Negotiate header present but empty');
  }

  let ctx;
  try {
    ctx = await kerberos.initializeServer(servicePrincipal);
    await ctx.step(clientToken);
  } catch (err) {
    // Any failure here — bad token, keytab problem, wrong service
    // principal — is a rejection, not a fallback to "let them through."
    throw new Error(`Kerberos negotiation failed: ${err.message}`);
  }

  if (!ctx.contextComplete || !ctx.username) {
    // Belt and suspenders: even if step() didn't throw, an incomplete
    // context or missing username is not a successful authentication.
    // Multi-round NTLM-style negotiation would need the caller to send
    // ctx.response back as a 401 challenge and retry — SPNEGO/Kerberos
    // proper is normally single-round, but this is deliberately strict
    // rather than assuming that's always true.
    throw new Error('Kerberos context did not complete — authentication not established.');
  }

  return { principal: ctx.username, negotiateResponse: ctx.response || null };
}

/**
 * Checks whether an authenticated principal is a member of the
 * configured required AD group. Uses a service account bind, read-only,
 * never the caller's own credentials — Kerberos already established who
 * they are; this only answers "are they allowed."
 *
 * @param {string} principal  e.g. "jsmith@REALM.EXAMPLE.COM" from validateKerberos()
 * @returns {Promise<boolean>}
 */
export async function isAuthorizedMember(principal) {
  const { AD_LDAP_URL, AD_BIND_DN, AD_BIND_PASSWORD, AD_BASE_DN, AD_REQUIRED_GROUP_DN } = process.env;
  if (!AD_LDAP_URL || !AD_BIND_DN || !AD_BIND_PASSWORD || !AD_BASE_DN || !AD_REQUIRED_GROUP_DN) {
    throw new Error('AD_LDAP_URL/AD_BIND_DN/AD_BIND_PASSWORD/AD_BASE_DN/AD_REQUIRED_GROUP_DN must all be set — refusing to authorize without a configured directory to check against.');
  }

  const samAccountName = principal.split('@')[0];
  const client = new LdapClient({ url: AD_LDAP_URL });

  try {
    await client.bind(AD_BIND_DN, AD_BIND_PASSWORD);

    const { searchEntries } = await client.search(AD_BASE_DN, {
      filter: `(sAMAccountName=${escapeLdapFilterValue(samAccountName)})`,
      attributes: ['memberOf'],
    });

    if (searchEntries.length === 0) {
      logger.warn(`[auth] No AD entry found for principal derived as "${samAccountName}" — denying.`);
      return false;
    }

    const memberOf = [].concat(searchEntries[0].memberOf || []);
    return memberOf.some(dn => dn.toLowerCase() === AD_REQUIRED_GROUP_DN.toLowerCase());
  } finally {
    try { await client.unbind(); } catch { /* best effort */ }
  }
}

// Minimal RFC 4515 escaping for the one value we interpolate into a filter.
function escapeLdapFilterValue(value) {
  return value.replace(/[\\*()\0]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * Combined check: authenticate via Kerberos, then authorize via AD group
 * membership. Fails closed on any error from either step — the caller
 * should treat any rejection as "deny," full stop, not inspect the error
 * for a reason to let the request through anyway.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ principal: string }>}
 */
export async function authenticateAndAuthorize(req) {
  const { principal } = await validateKerberos(req);
  const authorized = await isAuthorizedMember(principal);
  if (!authorized) {
    throw new Error(`${principal} authenticated successfully but is not a member of the required AD group.`);
  }
  return { principal };
}
