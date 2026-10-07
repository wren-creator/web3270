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
import { saveAs, exportFindingsJson } from './utils.js';
import { credAuditFindings } from './probe.js';
import {
  parseProfileNames, parseLabelValue, parseSpecialAuths, evaluateProfile, evaluateShippedProfile,
  parseSysvals, evaluateSysval, parseObjects, parseObjectGrants, evaluateObjectDetail,
  parseNetattrs, evaluateNetattr, parseJobds, evaluateJobd,
  parseAutls, parseAutlSecured, evaluateAutl, parseActjobs, evaluateActjob,
  evaluateExitPoint, evaluateNetsvr, parseIfsObjects, evaluateIfsObject,
  parseCallStack, evaluateAdoptedAuthority,
  parseSqlResultTable, parseCveInfo, evaluateCveRow, parsePtfCurrency, evaluatePtfGroupRow,
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
function _pressPgDn()  { _send({ type: 'key', aid: 'PGDN', fields: [] }); }

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
  // Shipped Profile Audit — same discovery/drill machinery as USRPRF, but
  // scoped to IBM-supplied (Q*) profiles and classified against the
  // "shipped profile must be non-interactive" rule (evaluateShippedProfile).
  SHIPPRF: {
    cmd: 'WRKUSRPRF', title: 'Work with User Profiles', ids: 'Shipprf',
    drill: {
      collect: lines => parseProfileNames(lines)
        .filter(n => /^Q/.test(n))
        .map(n => ({ key: n, cmd: `DSPUSRPRF USRPRF(${n})` })),
      detailTitle: 'Display User Profile',
      parse: (lines, text, item) => {
        const status     = parseLabelValue(lines, 'Status');
        const pwdNone    = parseLabelValue(lines, 'No password');
        const pwdChg     = parseLabelValue(lines, 'Date password last changed');
        const auths      = parseSpecialAuths(text);
        const defaultPwd = text.includes('password matches profile name');
        const { risk, finding } = evaluateShippedProfile({ name: item.key, status, pwdNone, defaultPwd, auths, pwdChg });
        const pwd = pwdNone === '*YES' ? '*NONE' : 'password set';
        return { name: item.key, value: `${status} · ${pwd}`, risk, detail: finding };
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

  // ── Wave 2 ────────────────────────────────────────────────────────────────
  NETATTR: {
    cmd: 'DSPNETA', title: 'Display Network Attributes', ids: 'Netattr',
    single: lines => parseNetattrs(lines).map(a => {
      const { risk, rec } = evaluateNetattr(a.name, a.value);
      return { name: a.name, value: a.value, risk, detail: rec };
    }),
  },
  JOBD: {
    cmd: 'WRKJOBD', title: 'Work with Job Descriptions', ids: 'Jobd',
    single: lines => parseJobds(lines).map(j => {
      const { risk, finding } = evaluateJobd(j);
      return { name: `${j.lib}/${j.name}`, value: `${j.user} / ${j.publicAuth}`, risk, detail: finding };
    }),
  },
  AUTL: {
    cmd: 'WRKAUTL', title: 'Work with Authorization Lists', ids: 'Autl',
    drill: {
      collect: lines => parseAutls(lines).map(a => ({ key: a.name, cmd: `DSPAUTL AUTL(${a.name})` })),
      detailTitle: 'Display Authorization List',
      parse: (lines, text, item) => {
        const publicAuth = parseLabelValue(lines, '*PUBLIC authority');
        const secured    = parseAutlSecured(lines);
        const { risk, finding } = evaluateAutl({ publicAuth, secured });
        return { name: item.key, value: publicAuth, risk, detail: finding };
      },
    },
  },
  ACTJOB: {
    cmd: 'WRKACTJOB', title: 'Work with Active Jobs', ids: 'Actjob',
    // Cross-references profiles the User-Profile Enumerator already rated
    // CRITICAL/HIGH, so running that scan first sharpens this one.
    single: lines => {
      const priv = new Set(RESULTS.USRPRF.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').map(r => r.name));
      return parseActjobs(lines).map(j => {
        const { risk, finding } = evaluateActjob(j, priv);
        return { name: j.job, value: j.user, risk, detail: `${j.sbs} · ${j.func} · ${finding}` };
      });
    },
  },

  // ── Wave: Exit Point / IFS / NetServer audit ───────────────────────────────
  REGINF: {
    cmd: 'WRKREGINF', title: 'Work with Registration Information', ids: 'Reginf',
    single: lines => parseNetattrs(lines).map(a => {
      const { risk, rec } = evaluateExitPoint(a.name, a.value);
      return { name: a.name, value: a.value, risk, detail: rec };
    }),
  },
  NETSVR: {
    cmd: 'DSPNETSVR', title: 'Display NetServer Attributes', ids: 'Netsvr',
    single: lines => parseNetattrs(lines).map(a => {
      const { risk, rec } = evaluateNetsvr(a.name, a.value);
      return { name: a.name, value: a.value, risk, detail: rec };
    }),
  },
  IFS: {
    cmd: 'WRKLNK', title: 'Work with Object Links', ids: 'Ifs',
    single: lines => parseIfsObjects(lines).map(o => {
      const { risk, finding } = evaluateIfsObject(o);
      return { name: o.path, value: `${o.owner} / ${o.auth}`, risk, detail: finding };
    }),
  },
  PGMSTK: {
    cmd: 'WRKJOB OPTION(*PGMSTK)', title: 'Display Call Stack', ids: 'Pgmstk',
    drill: {
      // Only stack levels that actually adopt are worth a DSPPGM round trip —
      // an entry that doesn't adopt can't be this finding regardless of owner.
      collect: lines => parseCallStack(lines).filter(e => e.adopt).map(e => ({
        key: `${e.lib}/${e.program}`, cmd: `DSPPGM PGM(${e.lib}/${e.program})`,
      })),
      detailTitle: 'Display Program',
      parse: (lines, text, item) => {
        const owner           = parseLabelValue(lines, 'Owner');
        const useAdoptedAuth  = parseLabelValue(lines, 'Use adopted authority');
        const { risk, finding } = evaluateAdoptedAuthority({ owner, useAdoptedAuth });
        return { name: item.key, value: `owner=${owner}`, risk, detail: finding };
      },
    },
  },
  // Menu/Command-Line Bypass Probe and the PTF/CVE Currency Checker are each
  // driven by their own bespoke state machine below (not the generic
  // single/drill shape), these entries exist only so the shared
  // _render()/_status() helpers have somewhere to look up DOM ids.
  BYPASS: { ids: 'Bypass' },
  PTFCVE: { ids: 'Ptfcve' },
};

// Persisted results per tool (so all tables/CSV survive across scans).
const RESULTS = {
  USRPRF: [], SHIPPRF: [], SYSVAL: [], OBJ: [], NETATTR: [], JOBD: [], AUTL: [], ACTJOB: [],
  REGINF: [], NETSVR: [], IFS: [], PGMSTK: [], BYPASS: [], PTFCVE: [],
};

// ── State machine ───────────────────────────────────────────────────────────
let as400 = { running: false, tool: null, expecting: null, items: [], idx: 0, pageItems: [], pages: 0 };

export function as400OnScreen(msg) {
  _bypassOnScreen(msg); // independent state machine, guards on its own .running
  _ptfcveOnScreen(msg); // independent state machine, guards on its own .running
  if (!as400.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');
  const tool  = as400.tool;
  const T = TOOLS[tool];
  if (!T) return;

  // Every tool starts by waiting for its list screen.
  if (as400.expecting === 'LIST' && text.includes(T.title)) {
    if (T.drill) {
      // WRKUSRPRF now pages (full IBM-supplied Q* set). Accumulate each page,
      // Roll Up while the panel still says "More...", then de-dupe by key.
      // Short list panels never render "More..." so they fall straight through.
      as400.pageItems.push(...T.drill.collect(lines));
      if (text.includes('More...') && as400.pages < 12) {
        as400.pages++;
        _pressPgDn();
        return;
      }
      const seen = new Set();
      as400.items = as400.pageItems.filter(it => !seen.has(it.key) && seen.add(it.key));
      as400.pageItems = [];
      as400.pages = 0;
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
  as400 = { running: false, tool: null, expecting: null, items: [], idx: 0, pageItems: [], pages: 0 };
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
  USRPRF:  ['PROFILE', 'AUTHORITIES'],
  SHIPPRF: ['Q* PROFILE', 'STATUS / PWD'],
  SYSVAL:  ['SYSTEM VALUE', 'CURRENT'],
  OBJ:     ['OBJECT', '*PUBLIC'],
  NETATTR: ['ATTRIBUTE', 'VALUE'],
  JOBD:    ['JOB DESC', 'USER / *PUBLIC'],
  AUTL:    ['AUTH LIST', '*PUBLIC'],
  ACTJOB:  ['JOB', 'USER'],
  REGINF:  ['EXIT POINT', 'EXIT PROGRAM'],
  NETSVR:  ['ATTRIBUTE', 'VALUE'],
  IFS:     ['OBJECT LINK', 'OWNER / *PUBLIC'],
  PGMSTK:  ['PROGRAM', 'OWNER'],
  BYPASS:  ['SCREEN', 'COMMAND TESTED'],
  PTFCVE:  ['CVE / PTF GROUP', 'CVSS / LEVEL'],
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
  as400 = { running: true, tool, expecting: 'LIST', items: [], idx: 0, pageItems: [], pages: 0 };
  const btn = document.getElementById('as400' + TOOLS[tool].ids + 'Btn');
  if (btn) btn.disabled = true;
  _status(tool, `Issuing ${TOOLS[tool].cmd}…`);
  _fillFirstInput(TOOLS[tool].cmd);
  _pressEnter();
}

// ── Menu/Command-Line Bypass Probe ──────────────────────────────────────────
// LMTCPB(*YES) only gates the sign-on session's own command line. A custom
// menu system that routes a restricted user into stock "Work with X"
// screens often leaves THOSE screens' own command lines live, since LMTCPB
// is never re-checked there. This drives a fixed set of stock utilities and
// actually executes a real command from each one's command line, not just
// checking whether a field exists — contrasted against DSPJOB's options
// screen (a numeric-only selection field, never a raw command line) to show
// the difference live, same two-bucket shape a real audit would use.
const BYPASS_CANDIDATES = [
  { cmd: 'WRKSPLF',   label: 'Work with Spooled Files',    test: 'WRKACTJOB', testLabel: 'Work with Active Jobs' },
  { cmd: 'WRKOUTQ',   label: 'Work with Output Queues',    test: 'WRKACTJOB', testLabel: 'Work with Active Jobs' },
  { cmd: 'WRKJOBD',   label: 'Work with Job Descriptions', test: 'WRKACTJOB', testLabel: 'Work with Active Jobs' },
  { cmd: 'WRKUSRJOB', label: 'Work with User Jobs',        test: 'WRKACTJOB', testLabel: 'Work with Active Jobs' },
  { cmd: 'WRKACTJOB', label: 'Work with Active Jobs',      test: 'WRKOUTQ',   testLabel: 'Work with Output Queues' },
  { cmd: 'DSPJOB',    label: 'Display Job (options menu)', test: 'WRKACTJOB', testLabel: 'Work with Active Jobs' },
];

let bypass = { running: false, idx: 0, stage: null };

// Unlike _fillFirstInput (right for a menu's single command line), a "Work
// with" list screen's Opt column fields come BEFORE its trailing command
// line in buffer order — the LAST unprotected field is the one we want here,
// and it degrades to the same single field _fillFirstInput would find on a
// screen (like DSPJOB's options panel) that only has one input at all.
function _fillCommandLine(text) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  const unprotected = scr?.fields?.filter(fld => !fld.protected) || [];
  const f = unprotected[unprotected.length - 1];
  if (!f) return false;
  const da = f.startAddr + 1;
  _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text });
  return true;
}

function _bypassStep() {
  const cand = BYPASS_CANDIDATES[bypass.idx];
  if (!cand) { _bypassFinish(); return; }
  _status('BYPASS', `[${bypass.idx + 1}/${BYPASS_CANDIDATES.length}] Testing ${cand.cmd}…`);
  bypass.stage = 'NAV';
  _fillCommandLine(cand.cmd);
  _pressEnter();
}

function _bypassOnScreen(msg) {
  if (!bypass.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');
  const cand  = BYPASS_CANDIDATES[bypass.idx];

  if (bypass.stage === 'NAV') {
    // Arrived at the candidate's own screen — now try the test command from
    // here, whatever "here" turns out to expose as an input field.
    bypass.stage = 'PROBE';
    _fillCommandLine(cand.test);
    _pressEnter();
    return;
  }

  if (bypass.stage === 'PROBE') {
    const executed = text.includes(cand.testLabel);
    const risk     = executed ? 'CRITICAL' : 'OK';
    const finding  = executed
      ? `command entry succeeded from this screen (ran ${cand.test} and landed on its output) — LMTCPB(*YES) does not reach this screen`
      : `no live command entry here — ${cand.test} was rejected or not modelled`;
    RESULTS.BYPASS.push({ name: cand.label, value: cand.cmd, risk, detail: finding });
    _render('BYPASS');
    bypass.stage = 'BACK';
    _send({ type: 'key', aid: 'F12', fields: [] });
    return;
  }

  if (bypass.stage === 'BACK') {
    if (!text.includes('Selection or command')) {
      _send({ type: 'key', aid: 'F12', fields: [] }); // one more hop back out
      return;
    }
    bypass.idx++;
    _bypassStep();
  }
}

function _bypassFinish() {
  bypass.running = false;
  const btn = document.getElementById('as400BypassBtn');
  if (btn) btn.disabled = false;
  const crit = RESULTS.BYPASS.filter(r => r.risk === 'CRITICAL').length;
  _status('BYPASS', `Done — ${crit}/${RESULTS.BYPASS.length} screen(s) had a live command line.`, crit ? 'error' : 'success');
}

// ── PTF/CVE Currency Checker ────────────────────────────────────────────────
// Queries IBM i's two real built-in SQL services, SYSTOOLS.CVE_INFO() and
// SYSTOOLS.GROUP_PTF_CURRENCY_LOCAL(), via STRSQL, then classifies whatever
// rows come back (CVSS-band risk, PTF level-gap/staleness risk). No CVE list
// lives in this file or as400sec-parse.js — see the comment on
// evaluateCveRow() in as400sec-parse.js and ROADMAP.md's Security Tools
// section for why that's deliberate.
//
// Bespoke state machine (not the generic single/drill TOOLS shape) because
// it drives STRSQL through two different statements in one run rather than
// a single WRK*/DSP* command. Unlike the Bypass Probe, every stage here
// checks the arriving screen's actual content before acting — STRSQL's
// fillField-then-Enter sequence emits an echo screen first (same risk the
// generic TOOLS machine guards against, see this file's header), and
// checking content rather than reacting to "a screen arrived" at all is the
// more robust way to skip that echo.
const PTFCVE_QUERIES = [
  { key: 'CVE', stmt: 'SELECT * FROM SYSTOOLS.CVE_INFO()',
    parse: lines => { const { cols, rows } = parseSqlResultTable(lines); return parseCveInfo(cols, rows); },
    evaluate: evaluateCveRow, nameCol: 'CVE_ID', valueCol: 'CVSS_SCORE', valuePrefix: 'CVSS ' },
  { key: 'PTF', stmt: 'SELECT * FROM SYSTOOLS.GROUP_PTF_CURRENCY_LOCAL()',
    parse: lines => { const { cols, rows } = parseSqlResultTable(lines); return parsePtfCurrency(cols, rows); },
    evaluate: evaluatePtfGroupRow, nameCol: 'PTF_GROUP', valueCol: 'LVL_INST', valuePrefix: 'level ' },
];

let ptfcve = { running: false, idx: 0, stage: null };

function _ptfcveStep() {
  const q = PTFCVE_QUERIES[ptfcve.idx];
  if (!q) { _ptfcveFinish(); return; }
  _status('PTFCVE', `[${ptfcve.idx + 1}/${PTFCVE_QUERIES.length}] Running ${q.stmt}…`);
  ptfcve.stage = 'RESULT';
  _fillFirstInput(q.stmt);
  _pressEnter();
}

function _ptfcveOnScreen(msg) {
  if (!ptfcve.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');
  const q = PTFCVE_QUERIES[ptfcve.idx];

  if (ptfcve.stage === 'NAV') {
    if (!text.includes('Interactive SQL')) return; // still the menu echo, keep waiting
    ptfcve.stage = 'RESULT';
    _fillFirstInput(q.stmt);
    _pressEnter();
    return;
  }

  if (ptfcve.stage === 'RESULT') {
    const sqlError = /SQL\d{4}/.exec(text);
    const rowsSelected = /(\d+) rows selected\./.exec(text);
    if (!sqlError && !rowsSelected) return; // fillField echo of the typed statement, keep waiting

    // On the second+ query, the screen's result area doesn't repaint until
    // the real Enter-driven redraw -- fillField's own echo after typing the
    // NEXT statement still shows the PREVIOUS query's "N rows selected."
    // message and result grid untouched, which also satisfies rowsSelected
    // above. Checking that this query's own name column is actually present
    // is what distinguishes "my real result" from "stale previous result",
    // not just the presence of rows-selected text. (The very first query has
    // no previous result to be stale, so this never blocks it.)
    if (!sqlError && !parseSqlResultTable(lines).cols.includes(q.nameCol)) return;

    if (sqlError) {
      RESULTS.PTFCVE.push({ name: q.key, value: '—', risk: 'INFO', detail: `query failed: ${sqlError[0]} — skipped` });
    } else {
      q.parse(lines).forEach(row => {
        const { risk, detail } = q.evaluate(row);
        RESULTS.PTFCVE.push({ name: row[q.nameCol], value: `${q.valuePrefix}${row[q.valueCol] ?? '?'}`, risk, detail });
      });
    }
    _render('PTFCVE');
    ptfcve.idx++;
    if (ptfcve.idx < PTFCVE_QUERIES.length) {
      _ptfcveStep();
    } else {
      ptfcve.stage = 'BACK';
      _pressF3();
    }
    return;
  }

  if (ptfcve.stage === 'BACK') {
    if (!text.includes('Selection or command')) return; // still the SQL screen's own F3 echo
    _ptfcveFinish();
  }
}

function _ptfcveFinish() {
  ptfcve.running = false;
  const btn = document.getElementById('as400PtfcveBtn');
  if (btn) btn.disabled = false;
  const bad = RESULTS.PTFCVE.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
  _status('PTFCVE', `Done — ${bad}/${RESULTS.PTFCVE.length} finding(s) need attention.`, bad ? 'error' : 'success');
}

export function startAs400PtfCveScan() {
  if (ptfcve.running) return;
  if (!state.liveScreen || !(state.liveScreenText || '').includes('Selection or command')) {
    _status('PTFCVE', 'Sign on and navigate to an AS/400 menu (with a command line) first.', 'error');
    return;
  }
  RESULTS.PTFCVE = [];
  _render('PTFCVE');
  ptfcve = { running: true, idx: 0, stage: 'NAV' };
  const btn = document.getElementById('as400PtfcveBtn');
  if (btn) btn.disabled = true;
  _status('PTFCVE', 'Issuing STRSQL…');
  _fillFirstInput('STRSQL');
  _pressEnter();
}

export function startAs400BypassProbe() {
  if (bypass.running) return;
  if (!state.liveScreen || !(state.liveScreenText || '').includes('Selection or command')) {
    _status('BYPASS', 'Sign on and navigate to an AS/400 menu (with a command line) first.', 'error');
    return;
  }
  RESULTS.BYPASS = [];
  _render('BYPASS');
  bypass = { running: true, idx: 0, stage: null };
  const btn = document.getElementById('as400BypassBtn');
  if (btn) btn.disabled = true;
  _bypassStep();
}

export function startAs400UserScan()    { _start('USRPRF'); }
export function startAs400ShippedAudit() { _start('SHIPPRF'); }
export function startAs400SysvalScan()  { _start('SYSVAL'); }
export function startAs400ObjScan()     { _start('OBJ'); }
export function startAs400NetattrScan() { _start('NETATTR'); }
export function startAs400JobdScan()    { _start('JOBD'); }
export function startAs400AutlScan()    { _start('AUTL'); }
export function startAs400ActjobScan()  { _start('ACTJOB'); }
export function startAs400ReginfScan()  { _start('REGINF'); }
export function startAs400NetsvrScan()  { _start('NETSVR'); }
export function startAs400IfsScan()     { _start('IFS'); }
export function startAs400PgmstkScan()  { _start('PGMSTK'); }

function _buildAs400Rows() {
  const ts = new Date().toISOString();
  const rows = [['tool', 'item', 'value', 'risk', 'detail', 'timestamp']];
  const add = (tool, label) => RESULTS[tool].forEach(r => rows.push([label, r.name, r.value, r.risk, r.detail, ts]));
  add('SYSVAL',  'sysval-analyzer');
  add('USRPRF',  'usrprf-enum');
  add('SHIPPRF', 'shipped-profile-audit');
  add('OBJ',     'object-scanner');
  add('NETATTR', 'netattr-analyzer');
  add('JOBD',    'jobd-privesc');
  add('AUTL',    'authlist-scanner');
  add('ACTJOB',  'actjob-scanner');
  add('REGINF',  'exit-point-audit');
  add('NETSVR',  'netserver-audit');
  add('IFS',     'ifs-permission-sweep');
  add('PGMSTK',  'adopted-authority-scanner');
  add('BYPASS',  'menu-bypass-probe');
  add('PTFCVE',  'ptf-cve-currency-checker');
  // Pre sign-on tool: its results live in probe.js, not RESULTS.
  credAuditFindings().forEach(r => rows.push(['default-credential-audit', r.name, r.value, r.risk, r.detail, ts]));
  return { rows, ts };
}

export function as400ExportCsv() {
  const { rows, ts } = _buildAs400Rows();
  if (rows.length === 1) return;
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `as400-audit-${ts.slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function as400ExportJson() {
  const { rows, ts } = _buildAs400Rows();
  exportFindingsJson('as400-audit', rows, `as400-audit-${ts.slice(0, 19).replace(/:/g, '-')}.json`);
}

Object.assign(window, {
  as400OnScreen, as400ExportCsv, as400ExportJson,
  startAs400UserScan, startAs400ShippedAudit, startAs400SysvalScan, startAs400ObjScan,
  startAs400NetattrScan, startAs400JobdScan, startAs400AutlScan, startAs400ActjobScan,
  startAs400ReginfScan, startAs400NetsvrScan, startAs400IfsScan,
  startAs400PgmstkScan, startAs400BypassProbe, startAs400PtfCveScan,
});
