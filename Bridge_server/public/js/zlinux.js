// ── Z/LINUX ON Z/VM audit ───────────────────────────────────────────────
// Drives the three checks for the guest-to-hypervisor boundary. The
// classifiers that decide what the output means live in zlinux-parse.js;
// this file only talks to the session, the scope guard and the page.
//
//   1. CP Privilege Class Check   at a CP session (a guest's own CP prompt)
//   2. Guest Console + #CP Escape at a Linux guest's 3270 console
//   3. SMAPI Check                standalone network probe, no session needed
//
// Every check asks the RoE scope guard first (POST /api/scope/check). With no
// scope.json the guard is off and the check goes ahead; with one, a denial
// stops the check and says why.
import { state } from './state.js';
import { esc, saveAs, exportFindingsJson } from './utils.js';
import {
  PRIV_PROBES, FINDING_COLUMNS, parsePrivClasses, classifyConsole, consoleHostname,
  privFindings, consoleFindings, smapiFindings,
} from './zlinux-parse.js';

let _findings = [];
let _running = false;
let _screenCb = null;

export function zlinuxOnScreen(msg) {
  if (_screenCb) { const cb = _screenCb; _screenCb = null; cb(msg); }
}
function _waitScreen(ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { _screenCb = null; reject(new Error('timeout waiting for the host')); }, ms);
    _screenCb = msg => { clearTimeout(t); resolve(msg); };
  });
}
function _text(msg) {
  if (!msg || !msg.rows) return '';
  return msg.rows.map(r => r.map(c => c.char || ' ').join('')).join('\n');
}
function _send(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}
function _fillInput(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  for (const f of scr?.fields || []) {
    if (!(f.fa & 0x20)) {
      const da = (f.addr + 1) % (scr.rows.length * cols);
      _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
      return;
    }
  }
  throw new Error('No input field on the current screen');
}

// Type one line at the current prompt, return what the host showed next.
async function _command(line) {
  _fillInput(line);
  const next = _waitScreen();
  _send({ type: 'key', aid: 'ENTER', fields: [] });
  const text = _text(await next);
  // Some replies land on a "press Enter to continue" screen. Step past it so
  // the next command starts at the prompt again, but keep what we read.
  if (/Enter=Continue/i.test(text)) {
    const back = _waitScreen();
    _send({ type: 'key', aid: 'ENTER', fields: [] });
    await back.catch(() => {});
  }
  return text;
}

function _status(msg) { const el = document.getElementById('zlStatus'); if (el) el.textContent = msg; }

async function _scope(kind, target) {
  try {
    const r = await fetch('/api/scope/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, target }),
    });
    return await r.json();
  } catch (e) {
    // Cannot reach the guard at all. Do not guess it is off.
    return { allowed: false, reason: `scope guard unreachable (${e.message})` };
  }
}
async function _gate(guest, activity) {
  for (const [kind, target] of [['guest', guest], ['activity', activity]]) {
    if (!target) continue;
    const r = await _scope(kind, target);
    if (!r.allowed) { _status(`Blocked by RoE scope guard: ${r.reason}`); return false; }
  }
  return true;
}

function _guestFromScreen() {
  const typed = document.getElementById('zlGuestId')?.value.trim();
  if (typed) return typed.toUpperCase();
  const m = /z\/VM CP\s+\S+\s+(\S+)\s+Logged On/i.exec(state.liveScreenText || '');
  return m ? m[1].toUpperCase() : '';
}

async function _run(label, fn) {
  if (_running) return;
  _running = true;
  document.querySelectorAll('.zlBtn').forEach(b => { b.disabled = true; });
  try { await fn(); }
  catch (e) { _status(`${label} stopped: ${e.message}`); }
  finally {
    _running = false;
    document.querySelectorAll('.zlBtn').forEach(b => { b.disabled = false; });
  }
}

function _add(rows) {
  const ts = new Date().toISOString();
  for (const r of rows) _findings.push({ ...r, timestamp: ts });
  _render();
}

export function zlinuxPrivCheck() {
  return _run('Privilege check', async () => {
    const screen = state.liveScreenText || '';
    if (!/z\/VM CP|Ready;/i.test(screen) || classifyConsole(screen) === 'linux-login') {
      _status('Open a CP prompt first (a guest logged on, not sitting at its Linux login).'); return;
    }
    const guest = _guestFromScreen();
    if (!guest) { _status('Could not read the userid from the screen. Type it in the Guest field.'); return; }
    if (!(await _gate(guest, 'cp-privclass'))) return;

    _status(`Querying ${guest}'s privilege classes...`);
    const q = await _command('QUERY PRIVCLASS');
    const classes = parsePrivClasses(q);
    const probes = [];
    for (const p of PRIV_PROBES) {
      _status(`Asking CP to run ${p.name} (read-only)...`);
      probes.push({ ...p, result: await _command(p.cmd) });
    }
    _add(privFindings(guest, classes, probes));
    _status(`Privilege check done for ${guest}: ${classes || 'class not parsed'}.`);
  });
}

export function zlinuxConsoleAudit() {
  return _run('Console audit', async () => {
    const before = state.liveScreenText || '';
    if (classifyConsole(before) !== 'linux-login') {
      _status('Log on to a Linux guest userid first, so its console shows a login prompt.'); return;
    }
    const guest = _guestFromScreen() || (consoleHostname(before) || '').toUpperCase();
    if (!guest) { _status('Could not identify the guest. Type its userid in the Guest field.'); return; }
    if (!(await _gate(guest, 'cp-console-escape'))) return;

    _status(`Trying #CP at ${guest}'s console (read-only query)...`);
    const escape = await _command('#CP QUERY PRIVCLASS');
    _add(consoleFindings(guest, before, escape));
    _status(`Console audit done for ${guest}.`);
  });
}

export function zlinuxSmapiCheck() {
  return _run('SMAPI check', async () => {
    const host = document.getElementById('zlSmapiHost')?.value.trim();
    if (!host) { _status('Enter the z/VM host to check.'); return; }
    _status(`Probing SMAPI ports on ${host}...`);
    const res = await fetch('/api/smapi-audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host }),
    });
    const body = await res.json();
    if (!res.ok) { _status(body.error || `SMAPI check failed (${res.status})`); return; }
    _add(smapiFindings(host, body.results));
    _status(`SMAPI check done for ${host}.`);
  });
}

const SEV_COLOR = { CRITICAL: '#e06060', HIGH: '#e08060', MEDIUM: '#e0a060', INFO: '#6a8ab0', OK: '#3a9a6a' };

function _render() {
  const el = document.getElementById('zlResults');
  if (!el) return;
  if (!_findings.length) { el.innerHTML = ''; return; }
  el.innerHTML = _findings.slice().reverse().map(f =>
    `<div style="border-left:3px solid ${SEV_COLOR[f.severity] || '#555'};padding:3px 6px;margin-top:4px;font-size:10px">` +
    `<span style="color:${SEV_COLOR[f.severity] || '#aaa'};font-weight:700">${esc(f.severity)}</span> ` +
    `<span style="color:var(--text-muted)">${esc(f.check)} · ${esc(f.target)}</span><br>` +
    `<span style="color:#bbb">${esc(f.finding)}</span>` +
    (f.evidence ? `<br><span style="color:#666;font-family:'IBM Plex Mono',monospace">${esc(f.evidence)}</span>` : '') +
    `</div>`).join('');
}

function _rows() {
  return [[...FINDING_COLUMNS, 'timestamp'], ..._findings.map(f => [...FINDING_COLUMNS.map(c => f[c]), f.timestamp])];
}

export function zlinuxExportCsv() {
  if (!_findings.length) return;
  const csv = _rows().map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `zlinux-zvm-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}
export function zlinuxExportJson() {
  if (!_findings.length) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('zlinux-zvm-audit', _rows(), `zlinux-zvm-audit-${ts}.json`);
}
export function zlinuxClear() { _findings = []; _render(); _status(''); }

Object.assign(window, {
  zlinuxOnScreen, zlinuxPrivCheck, zlinuxConsoleAudit, zlinuxSmapiCheck,
  zlinuxExportCsv, zlinuxExportJson, zlinuxClear,
});
