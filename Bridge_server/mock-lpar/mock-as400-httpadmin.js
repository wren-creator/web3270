'use strict';
// Mock IBM i "HTTP Server Administration" GUI (IBM Web Administration for i),
// the ADMIN instance a real IBM i serves on 2001 (HTTP) and 2010 (HTTPS).
//
// Started from mock-as400.js, sharing its user profiles and credentials, so
// the Default Credential Audit findings carry straight over: any enabled
// profile with a password can sign in (low privilege, like CVSS PR:L).
//
// THE DELIBERATE FLAW (class only, CWE-94 code injection). IBM has not
// published the real vulnerable parameter for CVE-2026-96119, so this does
// NOT reproduce the real bug. It models the same weakness class: the
// "description" field on Create HTTP Server is built into a page template
// that evaluates SSI-style directives, <!--#exec cmd="..." -->, with no
// neutralizing of the special elements. Execution is SIMULATED against the
// canned tables below. Nothing real ever runs, no shell, no eval, no fs.
//
// MOCK_AS400_HTTPADMIN_PATCHED=1 stands in for the PTF: the field is
// HTML-escaped and never evaluated, and /about lists the fix.
//
// Pure request handler (handle) plus a thin listener (start), so the tests
// need no sockets.

const http = require('http');
const https = require('https');
const fs = require('fs');

const SERVER_HEADER = 'IBM HTTP Server for i';
const REALM = 'IBM i HTTP Server Administration';

// Cap on the form body, a mock-sized guard against a runaway request.
const MAX_BODY = 8 * 1024;

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function osInfo(env) {
  const level = env.MOCK_AS400_OSLEVEL || 'V7R4M0';
  const patched = env.MOCK_AS400_HTTPADMIN_PATCHED === '1';
  const ptf = { V7R3M0: 'SJ11641', V7R4M0: 'SJ11643', V7R5M0: 'SJ11644', V7R6M0: 'SJ11645' }[level];
  return { level, patched, ptf };
}

// The profile the ADMIN instance runs under. A directive executes with its
// authority, not the signed-in user's, which is the "scope changed" part of
// the real CVSS vector.
const RUN_AS = 'QTMHHTTP';

// Simulated command execution. Only these commands do anything; everything
// else gets a not-found message. Output comes from the mock's own tables.
function simulateCommand(cmd, ctx) {
  const c = String(cmd).trim().toUpperCase().replace(/\s+/g, ' ');
  if (c === 'RTVJOBA' || c === 'WHOAMI') {
    return `CURRENT USER . . . . : ${RUN_AS}\nJOB . . . . . . . . . : 000417/${RUN_AS}/ADMIN`;
  }
  if (c === 'WRKUSRPRF' || c === 'WRKUSRPRF *ALL') {
    return ctx.usrprfs.map((p) => `${p.name.padEnd(10)} ${p.status.padEnd(10)} ${p.text}`).join('\n');
  }
  const dsp = c.match(/^DSPUSRPRF (?:USRPRF\()?([A-Z0-9_]{1,10})\)?$/);
  if (dsp) {
    const p = ctx.usrprfs.find((u) => u.name === dsp[1]);
    if (!p) return `CPF2204 User profile ${dsp[1]} not found.`;
    return [
      `User profile . . . . . : ${p.name}`,
      `Status . . . . . . . . : ${p.status}`,
      `Special authority  . . : ${p.specialAuth.join(' ') || '*NONE'}`,
      `Password last changed  : ${p.pwdChg}`,
    ].join('\n');
  }
  return `CPD0030 Command not found or not allowed: ${String(cmd).slice(0, 60)}`;
}

// The vulnerable template step: replaces each exec directive with the
// simulated command output.
function evaluateDirectives(text, ctx) {
  return text.replace(/<!--#exec\s+cmd="([^"]*)"\s*-->/gi,
    (_m, cmd) => simulateCommand(cmd, ctx));
}

function renderDescription(raw, ctx) {
  if (ctx.os.patched) return esc(raw);
  // Unpatched: evaluate first, then emit the result as markup, with no
  // escaping on either side.
  return evaluateDirectives(raw, ctx);
}

function page(title, body, ctx) {
  const os = ctx.os;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:14px Arial,sans-serif;margin:0;color:#161616}
header{background:#161616;color:#fff;padding:10px 18px}
header b{font-weight:600} nav a{color:#78a9ff;margin-right:14px;text-decoration:none}
main{padding:18px} table{border-collapse:collapse} td,th{border:1px solid #c6c6c6;padding:5px 10px;text-align:left}
footer{color:#6f6f6f;padding:18px;font-size:12px} pre{background:#f4f4f4;padding:8px}
</style></head><body>
<header><b>IBM Web Administration for i</b> &nbsp; ${esc(ctx.sysname)} &nbsp; ${esc(os.level)}</header>
<main><nav><a href="/HTTPAdmin">Home</a><a href="/HTTPAdmin/servers">Manage</a><a href="/HTTPAdmin/create">Create HTTP Server</a><a href="/HTTPAdmin/about">About</a></nav>
<h2>${esc(title)}</h2>
${body}
</main>
<footer>IBM i ${esc(os.level)} &middot; ${esc(SERVER_HEADER)}</footer>
</body></html>`;
}

function reply(status, body, extra = {}) {
  return {
    status,
    headers: { 'Server': SERVER_HEADER, 'Content-Type': 'text/html; charset=utf-8', ...extra },
    body,
  };
}

function parseBasic(header) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header || '');
  if (!m) return null;
  const dec = Buffer.from(m[1], 'base64').toString('utf8');
  const i = dec.indexOf(':');
  if (i < 0) return null;
  return { user: dec.slice(0, i).toUpperCase(), pass: dec.slice(i + 1) };
}

function authenticate(header, ctx) {
  const cred = parseBasic(header);
  if (!cred) return null;
  const prf = ctx.usrprfs.find((p) => p.name === cred.user);
  if (!prf || prf.status !== '*ENABLED' || prf.pwdNone) return null;
  const expected = ctx.credentials[cred.user];
  if (expected === undefined || expected !== cred.pass) return null;
  return cred.user;
}

function parseForm(body) {
  const out = {};
  for (const pair of String(body || '').split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
    out[dec(i < 0 ? pair : pair.slice(0, i))] = i < 0 ? '' : dec(pair.slice(i + 1));
  }
  return out;
}

function newState() {
  return {
    servers: [
      { name: 'ADMIN',      status: 'Running', description: 'HTTP Server Administration instance' },
      { name: 'APACHEDFT',  status: 'Stopped', description: 'Default HTTP server instance' },
      { name: 'MYAPP',      status: 'Running', description: 'Payroll web front end' },
    ],
  };
}

// req: { method, url, headers, body } -> { status, headers, body }
function handle(req, ctx) {
  const url = String(req.url || '/').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();

  if (url === '/' || url === '') {
    return reply(302, '', { 'Location': '/HTTPAdmin' });
  }
  if (!url.startsWith('/HTTPAdmin')) {
    return reply(404, page('Not found', '<p>The requested page was not found.</p>', ctx));
  }

  const user = authenticate(req.headers && req.headers.authorization, ctx);
  if (!user) {
    ctx.log(`HTTP admin: 401 ${method} ${url}`);
    return reply(401, page('Authorization required', '<p>Sign in with an IBM i user profile.</p>', ctx),
      { 'WWW-Authenticate': `Basic realm="${REALM}"` });
  }

  if (url === '/HTTPAdmin' || url === '/HTTPAdmin/') {
    return reply(200, page('Welcome', `<p>Signed in as <b>${esc(user)}</b>.</p>
<p>Use <b>Manage</b> to work with HTTP server instances, or <b>Create HTTP Server</b> to add one.</p>`, ctx));
  }

  if (url === '/HTTPAdmin/about') {
    const os = ctx.os;
    return reply(200, page('About', `<table>
<tr><th>Product</th><td>5770-DG1 IBM HTTP Server for i</td></tr>
<tr><th>OS release</th><td>${esc(os.level)}</td></tr>
<tr><th>HTTP Server Admin fix</th><td>${os.patched ? esc(os.ptf || 'applied') : 'not installed'}</td></tr>
</table>`, ctx));
  }

  if (url === '/HTTPAdmin/servers') {
    if (method === 'POST') return createServer(req, ctx, user);
    const rows = ctx.state.servers.map((s) =>
      `<tr><td>${esc(s.name)}</td><td>${esc(s.status)}</td><td>${renderDescription(s.description, ctx)}</td></tr>`).join('\n');
    return reply(200, page('HTTP servers', `<table><tr><th>Name</th><th>Status</th><th>Description</th></tr>
${rows}</table>`, ctx));
  }

  if (url === '/HTTPAdmin/create') {
    return reply(200, page('Create HTTP Server', `<form method="POST" action="/HTTPAdmin/servers">
<p>Server name <input name="name" maxlength="10"></p>
<p>Description <input name="description" size="60"></p>
<p><button type="submit">Finish</button></p></form>`, ctx));
  }

  return reply(404, page('Not found', '<p>The requested page was not found.</p>', ctx));
}

function createServer(req, ctx, user) {
  const form = parseForm(req.body);
  const name = String(form.name || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(name)) {
    return reply(400, page('Create HTTP Server', '<p>Server name must be 1 to 10 characters, letters, digits or underscore, starting with a letter.</p>', ctx));
  }
  if (ctx.state.servers.some((s) => s.name === name)) {
    return reply(409, page('Create HTTP Server', `<p>HTTP server ${esc(name)} already exists.</p>`, ctx));
  }
  const description = String(form.description || '');
  ctx.state.servers.push({ name, status: 'Stopped', description });
  ctx.log(`HTTP admin: ${user} created server ${name}`);
  return reply(302, '', { 'Location': '/HTTPAdmin/servers' });
}

function makeContext({ sysname, usrprfs, credentials, log, env = process.env }) {
  return { sysname, usrprfs, credentials, log, os: osInfo(env), state: newState() };
}

function listener(ctx) {
  return (req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      const out = handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }, ctx);
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    });
  };
}

// Starts 2001 (HTTP) and, when a cert is present, 2010 (HTTPS).
function start({ sysname, usrprfs, credentials, log, env = process.env }) {
  const ctx = makeContext({ sysname, usrprfs, credentials, log, env });
  const httpPort = parseInt(env.MOCK_AS400_HTTPADMIN_PORT || '2001', 10);
  const httpsPort = parseInt(env.MOCK_AS400_HTTPADMIN_TLS_PORT || '2010', 10);

  http.createServer(listener(ctx)).listen(httpPort, '0.0.0.0', () => {
    log(`Mock IBM i HTTP Server Administration (HTTP) listening on 0.0.0.0:${httpPort}` +
        (ctx.os.patched ? ' [PATCHED]' : ' [UNPATCHED]'));
  });

  const keyPath = env.MOCK_AS400_HTTPADMIN_KEY || '/app/certs/key.pem';
  const certPath = env.MOCK_AS400_HTTPADMIN_CERT || '/app/certs/cert.pem';
  try {
    const opts = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    https.createServer(opts, listener(ctx)).listen(httpsPort, '0.0.0.0', () => {
      log(`Mock IBM i HTTP Server Administration (HTTPS) listening on 0.0.0.0:${httpsPort}`);
    });
  } catch {
    log(`HTTP admin: no TLS cert at ${certPath}, HTTPS ${httpsPort} not started`);
  }
  return ctx;
}

module.exports = { handle, start, makeContext, listener, simulateCommand, osInfo };
