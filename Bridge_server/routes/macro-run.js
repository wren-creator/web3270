/**
 * routes/macro-run.js
 * ─────────────────────────────────────────────────────────────────
 * POST /api/macro-run — synchronous, headless macro execution.
 *
 * The proof-of-concept endpoint for the Rocket/Rumba migration: a
 * VBA-side HTTP shim (see ~/git/my-code/vbmacro/new) calls this once
 * per claim instead of driving a desktop 3270 emulator through COM.
 * No browser, no WebSocket, no session left running afterward — it
 * opens a session, runs one macro, returns the result, disconnects.
 *
 * Request body:
 *   {
 *     "host": "mock-claims", "port": 3273, "tls": false,
 *     "protocol": "3270",                    // or "5250"
 *     "macroName": "RM2P Claim Override (Mock POC)",
 *     "vars": { "claimNumber": "CLAIM9990012", "lineNumber": "01", "providerNumber": "99999" },
 *     "timeoutMs": 30000                      // optional, default 30000
 *   }
 *
 * A macro body can be sent inline instead of macroName:
 *   { "macro": { "name": "...", "steps": [...] }, ... }
 *
 * Response, 200 either way — a macro `fail` step is a normal business
 * outcome (the equivalent of the old VBA writing "NOT FOUND" into a
 * spreadsheet cell), not an HTTP error:
 *   { "status": "completed" }
 *   { "status": "failed", "message": "NOT FOUND" }
 *
 * Non-200 is reserved for things that mean the call itself didn't
 * work — bad request body, couldn't reach the host, macro not found.
 *
 * Auth: if MACRO_RUN_API_KEY is set in the environment, callers must
 * send it as the X-Macro-Run-Key header. Unset by default so the POC
 * runs locally with no setup, but this is a stub, not a real
 * credential model — see docs/rocket-migration-statement-of-review.md
 * §6, "what's the credential model for a server-side batch job," for
 * why that's still an open question before this goes anywhere near
 * production.
 */

import Tn3270Session from '../tn3270/session.js';
import Tn5250Session from '../tn5250/session.js';
import MacroEngine from '../macros/engine.js';
import { MacroStore, SecurityMacroStore } from '../macros/store.js';

const store    = new MacroStore();
const secStore = new SecurityMacroStore();

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function connectSession(params, config) {
  const protocol = (params.protocol || '3270').toLowerCase();
  const tlsOptions = {}; // client-cert auth isn't exposed to this endpoint yet — see header comment

  let session;
  if (protocol === '5250') {
    session = new Tn5250Session({
      host: params.host, port: params.port, useTls: !!params.tls,
      luName: params.luName || null, model: params.model || '3179-2',
      codepage: params.codepage || config.defaults.codepage,
      user: params.user, keepAliveSec: 0, tlsOptions,
    });
  } else {
    session = new Tn3270Session({
      host: params.host, port: params.port, useTls: !!params.tls,
      luName: params.luName || null, model: params.model || config.defaults.model,
      codepage: params.codepage || config.defaults.codepage,
      useTn3270e: params.tn3270e ?? true, keepAliveSec: 0, tlsOptions,
    });
  }

  const connectTimeoutMs = params.connectTimeoutMs || 10000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Connect to ${params.host}:${params.port} timed out`)), connectTimeoutMs);
    session.once('connected', () => { clearTimeout(timer); resolve(session); });
    session.once('error', err => { clearTimeout(timer); reject(err); });
    session.connect();
  });
}

async function loadMacro(params) {
  if (params.macro) return params.macro;
  if (!params.macroName) return null;
  return SecurityMacroStore.loadFromEither(params.macroName, store, secStore);
}

export function handle(req, res, { config, logger }) {
  if (req.url !== '/api/macro-run' || req.method !== 'POST') return false;

  const apiKey = process.env.MACRO_RUN_API_KEY;
  if (apiKey && req.headers['x-macro-run-key'] !== apiKey) {
    send(res, 401, { error: 'Missing or invalid X-Macro-Run-Key header' });
    return true;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let params;
    try { params = JSON.parse(body); }
    catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

    if (!params.host) { send(res, 400, { error: 'Missing required field: host' }); return; }
    if (!params.port) { send(res, 400, { error: 'Missing required field: port' }); return; }
    if (!params.macro && !params.macroName) { send(res, 400, { error: 'Provide either "macro" or "macroName"' }); return; }

    let macro;
    try { macro = await loadMacro(params); }
    catch (err) { send(res, 500, { error: `Failed to load macro: ${err.message}` }); return; }
    if (!macro) { send(res, 404, { error: `Macro not found: ${params.macroName}` }); return; }

    let session;
    try {
      session = await connectSession(params, config);
    } catch (err) {
      logger.error(`[api] macro-run connect failed: ${err.message}`);
      send(res, 502, { error: `Could not connect to ${params.host}:${params.port} — ${err.message}` });
      return;
    }

    const vars = params.vars || {};
    const engine = new MacroEngine(session, store);
    engine.on('promptRequired', varName => {
      // Headless — answer immediately from the supplied vars, no human in the loop.
      setImmediate(() => engine.deliverPromptResponse(varName, vars[varName] ?? ''));
    });

    const runTimeoutMs = params.timeoutMs || 30000;
    try {
      await Promise.race([
        engine.run(macro),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Macro run timed out after ${runTimeoutMs}ms`)), runTimeoutMs)),
      ]);
      session.disconnect('macro-run: completed');
      logger.info(`[api] macro-run "${macro.name}" completed`);
      send(res, 200, { status: 'completed' });
    } catch (err) {
      try { session.disconnect('macro-run: failed'); } catch { /* already gone */ }
      logger.info(`[api] macro-run "${macro.name}" failed: ${err.message}`);
      send(res, 200, { status: 'failed', message: err.message });
    }
  });

  return true;
}
