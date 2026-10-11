// ── Z/LINUX ON Z/VM audit ───────────────────────────────────────────────
// Drives the three checks for the guest-to-hypervisor boundary. The
// classifiers that decide what the output means live in zlinux-parse.js;
// this file only talks to the session, the scope guard and the page.
//
//   1. CP Privilege Class Check   at a CP session (a guest's own CP prompt)
//   2. Guest Console + #CP Escape at a Linux guest's 3270 console
//   3. Virtual Network Audit     QUERY VSWITCH / VMLAN, at CP or a Linux console
//   4. Directory Review           IUCV and password rules from a pasted export
//   5. SMAPI Check                standalone network probe, no session needed
//   6. XAUTOLOG Start Probe       INTRUSIVE — can start another guest
//   7. SEND CP Probe              INTRUSIVE — can run a command as another guest
//
// Every check asks the RoE scope guard first (POST /api/scope/check). With no
// scope.json the guard is off and the check goes ahead; with one, a denial
// stops the check and says why. Checks 6 and 7 can change state on another
// guest (XAUTOLOG can start one), so beyond the scope guard they also put up
// a native confirm() dialog spelling out exactly what is about to run, and a
// Cancel stops it cold — no scope file, no RoE entry, and no silent default
// bypasses that prompt.
import { state } from './state.js';
import { esc, saveAs, exportFindingsJson } from './utils.js';
import {
  PRIV_PROBES, FINDING_COLUMNS, parsePrivClasses, classifyConsole, consoleHostname,
  privFindings, consoleFindings, smapiFindings,
  classifyCpResult, parseVswitches, parseVmlans, parseAccessList, networkFindings,
  xautologFindings, sendCpFindings,
} from './zlinux-parse.js';
import { parseDirectory, directoryFindings } from './zlinux-directory.js';

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
      // Fields carry startAddr (the FA byte); input begins one cell after it.
      const da = (f.startAddr + 1) % (scr.rows.length * cols);
      _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
      return;
    }
  }
  throw new Error('No input field on the current screen');
}

// Type one line at the current prompt, return what the host showed next.
async function _command(line) {
  // The bridge echoes a screen after every fill. Wait that one out first, or
  // it gets mistaken for the reply to ENTER and we read the screen from
  // before the command ran.
  const echo = _waitScreen();
  _fillInput(line);
  await echo;
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
    // At a Linux guest's console, CP is reached with a #CP prefix. At a plain
    // CP prompt, commands go straight in.
    const atLinux = classifyConsole(screen) === 'linux-login';
    if (!atLinux && !/z\/VM CP|Ready;/i.test(screen)) {
      _status('Log on to a guest first, so the screen shows its CP prompt or its Linux console.'); return;
    }
    const prefix = atLinux ? '#CP ' : '';
    const guest = _guestFromScreen();
    if (!guest) { _status('Could not read the userid from the screen. Type it in the Guest field.'); return; }
    if (!(await _gate(guest, 'cp-privclass'))) return;

    _status(`Querying ${guest}'s privilege classes...`);
    const q = await _command(`${prefix}QUERY PRIVCLASS`);
    const classes = parsePrivClasses(q);
    const probes = [];
    for (const p of PRIV_PROBES) {
      _status(`Asking CP to run ${p.name} (read-only)...`);
      probes.push({ ...p, result: await _command(`${prefix}${p.cmd}`) });
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

export function zlinuxNetworkAudit() {
  return _run('Network audit', async () => {
    const screen = state.liveScreenText || '';
    const atLinux = classifyConsole(screen) === 'linux-login';
    if (!atLinux && !/z\/VM CP|Ready;/i.test(screen)) {
      _status('Log on to a guest first, so the screen shows its CP prompt or its Linux console.'); return;
    }
    const prefix = atLinux ? '#CP ' : '';
    const guest = _guestFromScreen();
    if (!guest) { _status('Could not read the userid from the screen. Type it in the Guest field.'); return; }
    if (!(await _gate(guest, 'cp-network'))) return;

    _status('Reading virtual switches...');
    const vsText = await _command(`${prefix}QUERY VSWITCH`);
    _status('Reading guest LANs...');
    const lanText = await _command(`${prefix}QUERY VMLAN`);
    const vswitches = parseVswitches(vsText);
    const accessLists = {};
    for (const v of vswitches) {
      _status(`Trying the access list for ${v.name}...`);
      const t = await _command(`${prefix}QUERY VSWITCH ${v.name} ACCESSLIST`);
      const users = parseAccessList(t);
      accessLists[v.name] = classifyCpResult(t) === 'denied' ? { status: 'denied', users: [] }
        : users.length ? { status: 'read', users } : { status: 'unreadable', users: [] };
    }
    _add(networkFindings(guest, vswitches, parseVmlans(lanText), accessLists));
    _status(`Network audit done for ${guest}: ${vswitches.length} switch(es), ${parseVmlans(lanText).length} guest LAN(s).`);
  });
}

// Offline review of a directory export pasted into the panel. Nothing is sent
// to any system, so there is no target for the scope guard to check.
export function zlinuxDirectoryReview() {
  const text = document.getElementById('zlDirText')?.value || '';
  if (!text.trim()) { _status('Paste a directory export first, or load the training sample.'); return; }
  const parsed = parseDirectory(text);
  _add(directoryFindings(parsed));
  _status(`Directory reviewed: ${parsed.users.length} USER entr${parsed.users.length === 1 ? 'y' : 'ies'}.`);
}

export async function zlinuxLoadSample() {
  try {
    const r = await fetch('/samples/zvm-directory-sample.txt');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    document.getElementById('zlDirText').value = await r.text();
    _status('Training sample loaded. It is invented, not a real directory.');
  } catch (e) { _status(`Could not load the sample: ${e.message}`); }
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

// Native confirm() in front of an intrusive probe. Separate from the scope
// guard on purpose: the guard can be off entirely (no scope.json), and even
// when it is on and allows the activity, a human still has to read what is
// about to run and say yes. There is no setting that skips this.
function _confirmIntrusive(summary) {
  return window.confirm(
    `⚠ INTRUSIVE — this changes state on another z/VM guest.\n\n${summary}\n\n` +
    `Only proceed if this is explicitly authorized in the Rules of Engagement.\n\nRun it?`
  );
}

export function zlinuxXautologProbe() {
  return _run('XAUTOLOG probe', async () => {
    const screen = state.liveScreenText || '';
    const atLinux = classifyConsole(screen) === 'linux-login';
    if (!atLinux && !/z\/VM CP|Ready;/i.test(screen)) {
      _status('Log on to a guest first, so the screen shows its CP prompt or its Linux console.'); return;
    }
    const caller = _guestFromScreen();
    const target = document.getElementById('zlXautologTarget')?.value.trim().toUpperCase();
    if (!caller) { _status('Could not read the userid from the screen. Type it in the Guest field.'); return; }
    if (!target) { _status('Enter the target userid to XAUTOLOG.'); return; }
    if (!(await _gate(caller, 'xautolog-start'))) return;
    if (!_confirmIntrusive(
      `${caller} will issue XAUTOLOG against ${target}.\n` +
      `If ${target} is authorized and not already running, CP will start it.\n` +
      `If it is already up, nothing changes — only the authorization verdict is new information.`
    )) { _status('XAUTOLOG probe canceled.'); return; }

    const prefix = atLinux ? '#CP ' : '';
    _status(`Trying XAUTOLOG ${target} as ${caller}...`);
    const result = await _command(`${prefix}XAUTOLOG ${target}`);
    _add(xautologFindings(caller, target, result));
    _status(`XAUTOLOG probe done: ${caller} -> ${target}.`);
  });
}

export function zlinuxSendCpProbe() {
  return _run('SEND CP probe', async () => {
    const screen = state.liveScreenText || '';
    const atLinux = classifyConsole(screen) === 'linux-login';
    if (!atLinux && !/z\/VM CP|Ready;/i.test(screen)) {
      _status('Log on to a guest first, so the screen shows its CP prompt or its Linux console.'); return;
    }
    const caller = _guestFromScreen();
    const target = document.getElementById('zlSendCpTarget')?.value.trim().toUpperCase();
    if (!caller) { _status('Could not read the userid from the screen. Type it in the Guest field.'); return; }
    if (!target) { _status('Enter the target userid for SEND CP.'); return; }
    if (!(await _gate(caller, 'send-cp'))) return;
    if (!_confirmIntrusive(
      `${caller} will try to SEND CP a harmless query (QUERY TIME) to run as ${target}.\n` +
      `If CP allows it, this guest can trigger CP commands under ${target}'s authority.`
    )) { _status('SEND CP probe canceled.'); return; }

    const prefix = atLinux ? '#CP ' : '';
    _status(`Trying SEND CP ${target} as ${caller}...`);
    const result = await _command(`${prefix}SEND CP ${target} QUERY TIME`);
    _add(sendCpFindings(caller, target, result));
    _status(`SEND CP probe done: ${caller} -> ${target}.`);
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
  zlinuxOnScreen, zlinuxPrivCheck, zlinuxConsoleAudit, zlinuxNetworkAudit, zlinuxDirectoryReview, zlinuxLoadSample, zlinuxSmapiCheck,
  zlinuxXautologProbe, zlinuxSendCpProbe,
  zlinuxExportCsv, zlinuxExportJson, zlinuxClear,
});
