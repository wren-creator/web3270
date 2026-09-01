// GET /api/default-accounts
//
// Serves an operator-supplied default-credential wordlist from a fixed path
// on the bridge host, ~/mainframe/default-accounts.txt, for the RACF PROBE
// tool's "Load defaults" action. One credential per line, "user:pass" or
// "user,pass"; blank lines and lines starting with # are ignored.
//
// The path is fixed (no filename parameter), so there is no traversal
// surface. On a multi-tenant / hosted deployment the bridge's own home dir
// is not a per-customer resource, so the route returns { found:false }
// there and the client falls back to its built-in lists.

import fs from 'fs';
import os from 'os';
import path from 'path';

const FILE = path.join(os.homedir(), 'mainframe', 'default-accounts.txt');
const DISPLAY_PATH = '~/mainframe/default-accounts.txt';

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
    if (err) { json({ found: false, path: DISPLAY_PATH }); return; }
    const pairs = parsePairs(text);
    ctx?.logger?.info?.(`[default-accounts] served ${pairs.length} pair(s) from ${FILE}`);
    json({ found: pairs.length > 0, path: DISPLAY_PATH, count: pairs.length, pairs });
  });
  return true;
}
