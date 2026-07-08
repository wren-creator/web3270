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
import {
  parseProfileNames, parseLabelValue, parseSpecialAuths, evaluateProfile,
  parseSysvals, evaluateSysval, parseObjects, parseObjectGrants, evaluateObjectDetail,
} from './as400sec-parse.js';

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

// ── Per-tool definitions ────────────────────────────────────────────────────
// Each tool has DOM ids and the list command/title it waits for. A tool is
// either single-screen (`single(lines)` → result rows, everything is on the
// one list screen) or drill-down (`drill`): the list yields items, and each
// item's DSP* detail is read from the menu command line (see file header).
//   drill.collect(lines)          → [{ key, cmd, ...item fields }]
//   drill.detailTitle             → detail screen title substring
//   drill.parse(lines, text, item)→ a result row { name, value, risk, detail }
const TOOLS = {
  SYSVAL: {
    cmd: 'WRKSYSVAL', title: 'Work with System Values', ids: 'Sysval',
    single: lines => parseSysvals(lines).map(sv => {
      const { risk, rec } = evaluateSysval(sv.name, sv.value);
      return { name: sv.name, value: sv.value, risk, detail: rec };
    }),
  },
  USRPRF: {
    cmd: 'WRKUSRPRF', title: 'Work with User Profiles', ids: 'Usrprf',
    drill: {
      collect: lines => parseProfileNames(lines).map(n => ({ key: n, cmd: `DSPUSRPRF USRPRF(${n})` })),
      detailTitle: 'Display User Profile',
      parse: (lines, text, item) => {
        const status     = parseLabelValue(lines, 'Status');
        const lmtCpb     = parseLabelValue(lines, 'Limit capabilities');
        const auths      = parseSpecialAuths(text);
        const defaultPwd = text.includes('password matches profile name');
        const { risk, finding } = evaluateProfile({ status, lmtCpb, auths, defaultPwd });
        return { name: item.key, value: auths.join(' '), risk, detail: finding };
      },
    },
  },
  OBJ: {
    cmd: 'WRKOBJ', title: 'Work with Objects', ids: 'Obj',
    drill: {
      collect: lines => parseObjects(lines).map(o => ({
        key: `${o.lib}/${o.name}`, cmd: `DSPOBJAUT OBJ(${o.lib}/${o.name})`, lib: o.lib, name: o.name,
      })),
      detailTitle: 'Display Object Authority',
      parse: (lines, text, item) => {
        const publicAuth = parseLabelValue(lines, '*PUBLIC authority');
        const grants     = parseObjectGrants(lines);
        const { risk, finding } = evaluateObjectDetail({ name: item.name, lib: item.lib, publicAuth, grants });
        return { name: item.key, value: publicAuth, risk, detail: finding };
      },
    },
  },
};

// Persisted results per tool (so all three tables/CSV survive across scans).
const RESULTS = { USRPRF: [], SYSVAL: [], OBJ: [] };

// ── State machine ───────────────────────────────────────────────────────────
let as400 = { running: false, tool: null, expecting: null, items: [], idx: 0 };

export function as400OnScreen(msg) {
  if (!as400.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');
  const tool  = as400.tool;
  const T = TOOLS[tool];
  if (!T) return;

  // Every tool starts by waiting for its list screen.
  if (as400.expecting === 'LIST' && text.includes(T.title)) {
    if (T.drill) {
      as400.items = T.drill.collect(lines);
      if (!as400.items.length) { _status(tool, 'Nothing discovered on the list.', 'error'); _finish(); return; }
      RESULTS[tool] = [];
      as400.idx = 0;
      as400.expecting = 'MENU';
      _pressF3();          // return to the menu; each detail is driven from there
    } else {
      RESULTS[tool] = T.single(lines);
      _render(tool);
      const n = RESULTS[tool].length;
      _status(tool, n ? `Done — ${n} item(s) analyzed.` : 'Nothing parsed from the list.', n ? 'success' : 'error');
      as400.expecting = 'MENU';   // F3 back to leave a clean menu, then finish
      _pressF3();
    }
    return;
  }

  // Drill-down tools: bounce through the menu issuing each DSP* command.
  if (T.drill && as400.expecting === 'MENU' && text.includes('Selection or command')) {
    if (as400.idx < as400.items.length) {
      const item = as400.items[as400.idx];
      _status(tool, `Auditing ${as400.idx + 1}/${as400.items.length}: ${item.key}…`);
      as400.expecting = 'DETAIL';
      _fillFirstInput(item.cmd);
      _pressEnter();
    } else {
      _render(tool);
      _status(tool, `Done — ${RESULTS[tool].length} item(s) audited.`, 'success');
      _finish();
    }
    return;
  }

  // Single-screen tools: the F3 after rendering lands back on the menu → finish.
  if (!T.drill && as400.expecting === 'MENU' && text.includes('Selection or command')) {
    _finish();
    return;
  }

  // Drill-down detail screen → parse, classify, then Enter back to the menu.
  if (T.drill && as400.expecting === 'DETAIL' && text.includes(T.drill.detailTitle)) {
    RESULTS[tool].push(T.drill.parse(lines, text, as400.items[as400.idx]));
    _render(tool);
    as400.idx++;
    as400.expecting = 'MENU';
    _pressEnter();
  }
}

function _finish() {
  const btn = document.getElementById('as400' + (TOOLS[as400.tool]?.ids || '') + 'Btn');
  if (btn) btn.disabled = false;
  as400 = { running: false, tool: null, expecting: null, items: [], idx: 0 };
}

// ── UI ──────────────────────────────────────────────────────────────────────
function _status(tool, text, type = 'info') {
  const el = document.getElementById('as400' + TOOLS[tool].ids + 'Status');
  if (!el) return;
  el.textContent = text;
  el.style.color = type === 'error' ? '#e06060' : type === 'success' ? '#3a8a3a' : 'var(--text-muted)';
}

const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#d0c060', LOW: '#9a9a5a', INFO: '#666', OK: '#3a6a3a' };
const RISK_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, OK: 5 };

// Column headers per tool for the first two data columns (risk/detail are shared).
const COLS = {
  USRPRF: ['PROFILE', 'AUTHORITIES'],
  SYSVAL: ['SYSTEM VALUE', 'CURRENT'],
  OBJ:    ['OBJECT', '*PUBLIC'],
};

function _render(tool) {
  const el = document.getElementById('as400' + TOOLS[tool].ids + 'Out');
  if (!el) return;
  const rows = RESULTS[tool];
  if (!rows.length) { el.innerHTML = ''; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const [c1, c2] = COLS[tool];
  const sorted = [...rows].sort((a, b) => (RISK_ORDER[a.risk] ?? 6) - (RISK_ORDER[b.risk] ?? 6));
  const th = t => `<th style="text-align:left;padding:2px 4px;font-weight:normal">${t}</th>`;
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    `<tr style="color:var(--text-muted)">${th(c1)}${th(c2)}${th('RISK')}${th('DETAIL')}</tr>` +
    sorted.map(r =>
      `<tr>` +
      `<td style="padding:2px 4px;color:#ccc;font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(r.name)}</td>` +
      `<td style="padding:2px 4px;color:#999;font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(r.value || '*NONE')}</td>` +
      `<td style="padding:2px 4px;color:${RISK_C[r.risk] || '#999'};font-weight:${r.risk === 'CRITICAL' ? '700' : 'normal'}">${esc(r.risk)}</td>` +
      `<td style="padding:2px 4px;color:#999;font-size:9px">${esc(r.detail)}</td></tr>`
    ).join('') + '</table>';
}

function _start(tool) {
  if (as400.running) return;
  if (!state.liveScreen || !(state.liveScreenText || '').includes('Selection or command')) {
    _status(tool, 'Sign on and navigate to an AS/400 menu (with a command line) first.', 'error');
    return;
  }
  RESULTS[tool] = [];
  _render(tool);
  as400 = { running: true, tool, expecting: 'LIST', items: [], idx: 0 };
  const btn = document.getElementById('as400' + TOOLS[tool].ids + 'Btn');
  if (btn) btn.disabled = true;
  _status(tool, `Issuing ${TOOLS[tool].cmd}…`);
  _fillFirstInput(TOOLS[tool].cmd);
  _pressEnter();
}

export function startAs400UserScan()   { _start('USRPRF'); }
export function startAs400SysvalScan() { _start('SYSVAL'); }
export function startAs400ObjScan()    { _start('OBJ'); }

export function as400ExportCsv() {
  const ts = new Date().toISOString();
  const rows = [['tool', 'item', 'value', 'risk', 'detail', 'timestamp']];
  const add = (tool, label) => RESULTS[tool].forEach(r => rows.push([label, r.name, r.value, r.risk, r.detail, ts]));
  add('SYSVAL', 'sysval-analyzer');
  add('USRPRF', 'usrprf-enum');
  add('OBJ',    'object-scanner');
  if (rows.length === 1) return;
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `as400-audit-${ts.slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, {
  as400OnScreen, startAs400UserScan, startAs400SysvalScan, startAs400ObjScan, as400ExportCsv,
});
