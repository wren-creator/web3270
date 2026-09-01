// GET /api/default-accounts
//
// Serves an operator-supplied default-credential wordlist for the RACF
// PROBE tool's "Load list" action. One credential per line, "user:pass" or
// "user,pass"; blank lines and lines starting with # are ignored.
//
// Path resolution:
//   DEFAULT_ACCOUNTS_FILE env var, if set (this is what docker-compose.yml
//   uses: it bind-mounts ./default-accounts.txt to /app/default-accounts.txt
//   and points this var there, so the container reads a host file live).
//   Otherwise ~/mainframe/default-accounts.txt for a plain Node/WSL run.
//
// The path comes only from env/default, never from the request, so there is
// no traversal surface. On a multi-tenant / hosted deployment the bridge's
// filesystem is not a per-customer resource, so the route returns
// { found:false } there and the client falls back to its built-in lists.

import fs from 'fs';
import os from 'os';
import path from 'path';

const FILE = process.env.DEFAULT_ACCOUNTS_FILE
  || path.join(os.homedir(), 'mainframe', 'default-accounts.txt');

function parsePairs(text) {
  const pairs = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s*[:,]\s*(.*)$/);
    if (!m) continue;
    const user = m[1].trim();
    const pass = m[2].trim();
    if (user && pass) pairs.push([user, pass]);
  }
  return pairs;
}

export function handle(req, res, ctx) {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath !== '/api/default-accounts' || req.method !== 'GET') return false;

  const json = body => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
  };

  if (ctx?.config?.bridge?.multiTenant) { json({ found: false, reason: 'multi-tenant' }); return true; }

  fs.readFile(FILE, 'utf8', (err, text) => {
    if (err) { json({ found: false, path: FILE }); return; }
    const pairs = parsePairs(text);
    ctx?.logger?.info?.(`[default-accounts] served ${pairs.length} pair(s) from ${FILE}`);
    json({ found: pairs.length > 0, path: FILE, count: pairs.length, pairs });
  });
  return true;
}
