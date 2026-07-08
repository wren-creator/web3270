// public/js/as400sec.js
// IBM i (TN5250) Security Audit tools.
//
// Tool 2 — User Profile & Special-Authority Enumerator.
//   WRKUSRPRF discovers the profile names, then DSPUSRPRF USRPRF(x) is issued
//   once per profile to read status / limit-capabilities / special authorities
//   / default-password warning, which are classified into a risk rating.
//
// This is a push-driven state machine: unlike the z/OS tools (which pull with
// _waitScreen), every screen the bridge emits is fed to as400OnScreen(), and
// we advance based on which screen arrived. Two things about the TN5250 mock
// shape this design:
//
//   1. A DSP* detail screen has no command line — Enter/F3/F12 all return to
//      the previous panel (mock-as400.js). So we can't chain DSPUSRPRF from a
//      detail screen; instead we discover names from WRKUSRPRF once, F3 back to
//      the MAIN menu, and issue every DSPUSRPRF from the menu command line
//      (which _fillFirstInput targets reliably, since it is the only input).
//
//   2. fillField echoes a screen (session.fillField calls _emitScreen). To
//      avoid acting on our own command echo, we only ever react to the ONE
//      screen we are `expecting`; echoes (always a menu while we await a
//      detail) are ignored.

import { state } from './state.js';
import { saveAs } from './utils.js';
import { parseProfileNames, parseLabelValue, parseSpecialAuths, evaluateProfile } from './as400sec-parse.js';

// ── Screen / transport helpers ─────────────────────────────────────────────
function _screenLines(msg) {
  if (!msg || !msg.rows) return [];
  return msg.rows.map(r => r.map(c => c.char || ' ').join(''));
}
function _send(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify(obj));
}
function _pressEnter() { _send({ type: 'key', aid: 'ENTER', fields: [] }); }
function _pressF3()    { _send({ type: 'key', aid: 'F3', fields: [] }); }

// Fill the first unprotected input field on the current screen. On the mock's
// menus that is the "Selection or command" line — the only input — so this is
// the safe way to type a CL command. 5250 fields expose startAddr/protected
// (the FA byte sits at startAddr, data begins at startAddr+1).
function _fillFirstInput(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  const f = scr?.fields?.find(fld => !fld.protected);
  if (!f) return false;
  const da = f.startAddr + 1;
  _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
  return true;
}

// ── State machine ───────────────────────────────────────────────────────────
let as400 = {
  running: false,
  tool: null,
  expecting: null,   // 'LIST' | 'MENU' | 'DETAIL' — the only screen we act on
  names: [],
  idx: 0,
  results: [],
};

export function as400OnScreen(msg) {
  if (!as400.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');

  if (as400.tool !== 'USRPRF') return;

  // WRKUSRPRF list → collect profile names, then F3 back to the menu.
  if (as400.expecting === 'LIST' && text.includes('Work with User Profiles')) {
    as400.names = parseProfileNames(lines);
    if (!as400.names.length) {
      _status('No user profiles discovered on the WRKUSRPRF list.', 'error');
      _finish();
      return;
    }
    as400.idx = 0;
    as400.results = [];
    as400.expecting = 'MENU';
    _pressF3();
    return;
  }

  // Back on a menu (command line present) → drive the next DSPUSRPRF, or finish.
  if (as400.expecting === 'MENU' && text.includes('Selection or command')) {
    if (as400.idx < as400.names.length) {
      const name = as400.names[as400.idx];
      _status(`Auditing ${as400.idx + 1}/${as400.names.length}: ${name}…`);
      as400.expecting = 'DETAIL';
      _fillFirstInput(`DSPUSRPRF USRPRF(${name})`);
      _pressEnter();
    } else {
      _render();
      _status(`Done — ${as400.results.length} profile(s) audited.`, 'success');
      _finish();
    }
    return;
  }

  // DSPUSRPRF detail → parse, classify, then Enter back to the menu.
  if (as400.expecting === 'DETAIL' && text.includes('Display User Profile')) {
    const name       = as400.names[as400.idx];
    const status     = parseLabelValue(lines, 'Status');
    const lmtCpb      = parseLabelValue(lines, 'Limit capabilities');
    const auths      = parseSpecialAuths(text);
    const defaultPwd = text.includes('password matches profile name');
    const { risk, finding } = evaluateProfile({ status, lmtCpb, auths, defaultPwd });

    as400.results.push({ profile: name, status, lmtCpb, auths: auths.join(' '), risk, finding });
    _render();

    as400.idx++;
    as400.expecting = 'MENU';
    _pressEnter();
    return;
  }
}

function _finish() {
  as400.running = false;
  as400.expecting = null;
  const btn = document.getElementById('as400UsrprfBtn');
  if (btn) btn.disabled = false;
}

// ── UI ──────────────────────────────────────────────────────────────────────
function _status(text, type = 'info') {
  const el = document.getElementById('as400UsrprfStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = type === 'error' ? '#e06060' : type === 'success' ? '#3a8a3a' : 'var(--text-muted)';
}

const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#d0c060', OK: '#3a6a3a' };
const RISK_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, OK: 3 };

function _render() {
  const el = document.getElementById('as400UsrprfOut');
  if (!el) return;
  if (!as400.results.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sorted = [...as400.results].sort((a, b) => (RISK_ORDER[a.risk] ?? 4) - (RISK_ORDER[b.risk] ?? 4));
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)">' +
      '<th style="text-align:left;padding:2px 4px;font-weight:normal">PROFILE</th>' +
      '<th style="text-align:left;padding:2px 4px;font-weight:normal">STATUS</th>' +
      '<th style="text-align:left;padding:2px 4px;font-weight:normal">AUTHORITIES</th>' +
      '<th style="text-align:left;padding:2px 4px;font-weight:normal">RISK</th>' +
      '<th style="text-align:left;padding:2px 4px;font-weight:normal">FINDING</th></tr>' +
    sorted.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:#ccc;font-family:'IBM Plex Mono',monospace">${esc(r.profile)}</td>` +
      `<td style="padding:2px 4px;color:${r.status === '*DISABLED' ? '#888' : '#aaa'};font-size:9px">${esc(r.status)}</td>` +
      `<td style="padding:2px 4px;color:#888;font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(r.auths || '*NONE')}</td>` +
      `<td style="padding:2px 4px;color:${RISK_C[r.risk] || '#999'};font-weight:${r.risk === 'CRITICAL' ? '700' : 'normal'}">${esc(r.risk)}</td>` +
      `<td style="padding:2px 4px;color:#999;font-size:9px">${esc(r.finding)}</td></tr>`
    ).join('') + '</table>';
}

export function startAs400UserScan() {
  if (as400.running) return;
  const scr = state.liveScreen;
  if (!scr || !(state.liveScreenText || '').includes('Selection or command')) {
    _status('Sign on and navigate to an AS/400 menu (with a command line) first.', 'error');
    return;
  }
  as400 = { running: true, tool: 'USRPRF', expecting: 'LIST', names: [], idx: 0, results: [] };
  const btn = document.getElementById('as400UsrprfBtn');
  if (btn) btn.disabled = true;
  _status('Issuing WRKUSRPRF…');
  _fillFirstInput('WRKUSRPRF');
  _pressEnter();
}

export function as400ExportCsv() {
  if (!as400.results.length) return;
  const ts = new Date().toISOString();
  const rows = [['tool', 'profile', 'status', 'authorities', 'risk', 'finding', 'timestamp']];
  for (const r of as400.results)
    rows.push(['usrprf-enum', r.profile, r.status, r.auths, r.risk, r.finding, ts]);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `as400-usrprf-${ts.slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, { as400OnScreen, startAs400UserScan, as400ExportCsv });
