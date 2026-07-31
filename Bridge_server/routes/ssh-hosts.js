import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireLogin } from './auth.js';
import { listForEmail, upsertForEmail, deleteForEmail } from '../db/ssh-host-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sshHostsPath = path.join(__dirname, '..', 'ssh-hosts.txt');

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

// See the matching comment in routes/auth.js: an async handler nobody
// awaits turns a rejected DB call into an unhandled rejection, which
// crashes the whole process, not just this request.
function guard(fn, label) {
  return (req, res, ctx) => {
    fn(req, res, ctx).catch(err => {
      ctx.logger.error(`[ssh-hosts] ${label} failed: ${err.stack || err.message}`);
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
      catch (err) { reject(new Error('Invalid JSON body')); }
    });
  });
}

function toClientShape(row) {
  return { id: row.id, name: row.name, host: row.host, port: row.port, user: row.sshUser ?? row.user ?? '' };
}

// ── Hosted (BRIDGE_MULTI_TENANT): scoped per account in Postgres ──────

async function handleGetMultiTenant(req, res) {
  const email = requireLogin(req, res);
  if (!email) return;
  const rows = await listForEmail(email);
  send(res, 200, rows.map(toClientShape));
}

async function handlePostMultiTenant(req, res, { logger }) {
  const email = requireLogin(req, res);
  if (!email) return;

  let p;
  try { p = await readJsonBody(req); }
  catch { send(res, 400, { error: 'Invalid JSON body' }); return; }

  if (!p.id || !p.host) { send(res, 400, { error: 'id and host required' }); return; }
  await upsertForEmail(email, {
    id: p.id, name: p.name || p.id, host: p.host,
    port: parseInt(p.port, 10) || 22, sshUser: p.user || '',
  });
  logger.info(`[api] SSH host "${p.id}" saved for ${email}`);
  send(res, 200, { ok: true });
}

async function handleDeleteMultiTenant(req, res) {
  const email = requireLogin(req, res);
  if (!email) return;
  const id = decodeURIComponent(req.url.slice('/api/ssh-hosts/'.length).split('?')[0]);
  await deleteForEmail(email, id);
  send(res, 200, { ok: true });
}

// ── Internal/OpenShift: single shared ssh-hosts.txt, no accounts ──────

function handleGetSingleTenant(req, res, { config }) {
  send(res, 200, config.sshHosts);
}

function handlePostSingleTenant(req, res, { config }) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      if (!p.id || !p.host) { send(res, 400, { error: 'id and host required' }); return; }
      let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : ['# id, name, host/IP, port, user'];
      const newLine = [p.id, p.name || p.id, p.host, p.port || 22, p.user || ''].join(', ');
      const idx = lines.findIndex(l => { const t = l.trim(); return t && !t.startsWith('#') && t.split(',')[0].trim() === p.id; });
      if (idx >= 0) lines[idx] = newLine; else lines.push(newLine);
      fs.writeFileSync(sshHostsPath, lines.join('\n'));
      config.sshHosts = config.loadSshHostsFile();
      send(res, 200, { ok: true });
    } catch (err) { send(res, 500, { error: err.message }); }
  });
}

function handleDeleteSingleTenant(req, res, { config }) {
  const id = decodeURIComponent(req.url.slice('/api/ssh-hosts/'.length).split('?')[0]);
  try {
    let lines = fs.existsSync(sshHostsPath) ? fs.readFileSync(sshHostsPath, 'utf8').split('\n') : [];
    lines = lines.filter(l => { const t = l.trim(); return !t || t.startsWith('#') || t.split(',')[0].trim() !== id; });
    fs.writeFileSync(sshHostsPath, lines.join('\n'));
    config.sshHosts = config.loadSshHostsFile();
    send(res, 200, { ok: true });
  } catch (err) { send(res, 500, { error: err.message }); }
}

export function handle(req, res, ctx) {
  const { config } = ctx;

  if (req.url === '/api/ssh-hosts' && req.method === 'GET') {
    if (config.bridge.multiTenant) guard(handleGetMultiTenant, 'get')(req, res, ctx);
    else handleGetSingleTenant(req, res, ctx);
    return true;
  }

  if (req.url === '/api/ssh-hosts' && req.method === 'POST') {
    if (config.bridge.multiTenant) guard(handlePostMultiTenant, 'post')(req, res, ctx);
    else handlePostSingleTenant(req, res, ctx);
    return true;
  }

  if (req.url.startsWith('/api/ssh-hosts/') && req.method === 'DELETE') {
    if (config.bridge.multiTenant) guard(handleDeleteMultiTenant, 'delete')(req, res, ctx);
    else handleDeleteSingleTenant(req, res, ctx);
    return true;
  }

  return false;
}
