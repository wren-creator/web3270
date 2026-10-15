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
  parseCallStack, evaluateAdoptedAuthority, parseDftPwd, evaluateDftPwd, parseLibraryNames, isAppLibrary, evaluateLibCrtaut,
  parseSqlResultTable, parseCveInfo, evaluateCveRow, parsePtfCurrency, evaluatePtfGroupRow,
  SERVICE_GROUPS, svcStatement, splitSqlStatement, parseNetstatRows, evaluateServiceGroup,
  GROUP_QUERIES, parseSuppGroups, parsePrimaryGroups, parseHolders, groupTableOk, evaluateGroups,
  OWNED_BY, OWNED_STATEMENT, parseOwnedObjects, evaluateOwnedObjects,
  parseAdoptLibraries, adoptProgramStatement, adoptPublicStatement, parseAdoptPrograms, parsePublicAuth, evaluateAdopting,
  OUTQ_STATEMENTS, outqRows, evaluateOutq,
  JOURNAL_GROUPS, JOURNAL_CONFIG, parseJournalDays, journalStatement, parseJournalRows, evaluateJournal,
  EXIT_STATEMENTS, EXIT_JOURNAL_DAYS, EXIT_JOURNAL_TYPES, EXIT_MAX_LIBS, parseExitPrograms, parseLibPublic, evaluateExitPrograms,
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
    paged: true,   // 33 values, Roll Up while the panel says "More..."

    single: lines => parseSysvals(lines).map(sv => {
      const { risk, rec } = evaluateSysval(sv.name, sv.value, sv.full);
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
  // ANZDFTPWD ACTION(*NONE): report only, the tool never issues an action that
  // changes a profile. See parseDftPwd in as400sec-parse.js.
  DFTPWD: {
    cmd: 'ANZDFTPWD ACTION(*NONE)', title: 'Analyze Default Passwords', ids: 'Dftpwd',
    single: lines => {
      const hits = parseDftPwd(lines);
      if (!hits.length) return [{ name: '(none)', value: '—', risk: 'OK', detail: 'No profile has a default password.' }];
      return hits.map(h => {
        const { risk, finding } = evaluateDftPwd(h);
        return { name: h.name, value: `${h.status} ${h.special}`.trim(), risk, detail: finding };
      });
    },
  },
  // Library CRTAUT vs QCRTAUT. Drill: the first item reads the QCRTAUT system value,
  // then DSPLIBD per application library, each judged against it. Items are issued in
  // order, so _crtaut is set before any library is evaluated.
  CRTAUT: {
    cmd: 'WRKLIB', title: 'Work with Libraries', ids: 'Crtaut',
    drill: {
      collect: lines => [
        { key: 'QCRTAUT', cmd: 'DSPSYSVAL SYSVAL(QCRTAUT)', detailTitle: 'Display System Value', sysval: true },
        ...parseLibraryNames(lines).filter(isAppLibrary).map(n => ({ key: n, cmd: `DSPLIBD LIB(${n})` })),
      ],
      detailTitle: 'Display Library Description',
      parse: (lines, text, item) => {
        if (item.sysval) {
          _qcrtaut = parseLabelValue(lines, 'Current value');
          return { name: 'QCRTAUT (system value)', value: _qcrtaut, risk: 'INFO',
            detail: 'The fallback for libraries that say *SYSVAL. Each library below keeps its own CRTAUT, which wins.' };
        }
        const crtaut = parseLabelValue(lines, 'Create authority');
        const { risk, value, detail } = evaluateLibCrtaut({ lib: item.key, crtaut, qcrtaut: _qcrtaut });
        return { name: item.key, value, risk, detail };
      },
    },
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
  // Menu/Command-Line Bypass Probe, the PTF/CVE Currency Checker and the Listening
  // Services Inventory are driven by their own bespoke state machines below (not the generic
  // single/drill shape), these entries exist only so the shared
  // _render()/_status() helpers have somewhere to look up DOM ids.
  BYPASS: { ids: 'Bypass' },
  PTFCVE: { ids: 'Ptfcve' },
  SVCINV: { ids: 'Svcinv' },
  GRPREV: { ids: 'Grprev' },
  OWNSEC: { ids: 'Ownsec' },
  ADOPT:  { ids: 'Adopt' },
  OUTQ:   { ids: 'Outq' },
  JRN:    { ids: 'Jrn' },
  EXITPGM: { ids: 'Exitpgm' },
};

// Persisted results per tool (so all tables/CSV survive across scans).
const RESULTS = {
  USRPRF: [], SHIPPRF: [], SYSVAL: [], OBJ: [], NETATTR: [], JOBD: [], AUTL: [], ACTJOB: [],
  REGINF: [], NETSVR: [], DFTPWD: [], CRTAUT: [], IFS: [], PGMSTK: [], BYPASS: [], PTFCVE: [], SVCINV: [], GRPREV: [], OWNSEC: [], ADOPT: [], OUTQ: [], JRN: [], EXITPGM: [],
};

// ── State machine ───────────────────────────────────────────────────────────
let _qcrtaut = '*UNKNOWN';   // QCRTAUT as read by the Library CRTAUT drill, its first item
let as400 = { running: false, tool: null, expecting: null, items: [], idx: 0, pageItems: [], pages: 0 };

export function as400OnScreen(msg) {
  _bypassOnScreen(msg); // independent state machine, guards on its own .running
  _sqlOnScreen(msg);    // independent state machine, guards on its own .running
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
      let rows = T.single(lines);
      if (T.paged) {
        // Parse each page on its own (row offsets are per screen), Roll Up while
        // the panel still says "More...", then de-dupe by name.
        as400.pageItems.push(...rows);
        if (text.includes('More...') && as400.pages < 12) {
          as400.pages++;
          _pressPgDn();
          return;
        }
        const seen = new Set();
        rows = as400.pageItems.filter(r => !seen.has(r.name) && seen.add(r.name));
        as400.pageItems = [];
        as400.pages = 0;
      }
      RESULTS[tool] = rows;
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
  if (T.drill && as400.expecting === 'DETAIL' && text.includes(as400.items[as400.idx]?.detailTitle || T.drill.detailTitle)) {
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
  DFTPWD:  ['PROFILE', 'STATUS / AUTHORITY'],
  CRTAUT:  ['LIBRARY', 'CRTAUT → EFFECTIVE'],
  IFS:     ['OBJECT LINK', 'OWNER / *PUBLIC'],
  PGMSTK:  ['PROGRAM', 'OWNER'],
  BYPASS:  ['SCREEN', 'COMMAND TESTED'],
  PTFCVE:  ['CVE / PTF GROUP', 'CVSS / LEVEL'],
  SVCINV:  ['PORT / SERVICE', 'STATE / BIND'],
  GRPREV:  ['GROUP / USER', 'AUTHORITY / VIA'],
  OWNSEC:  ['LIBRARY', 'QSECOFR-OWNED'],
  ADOPT:   ['PROGRAM', 'OWNER / *PUBLIC'],
  OUTQ:    ['QUEUE / CHECK', 'SETTINGS'],
  JRN:     ['ENTRY GROUP: USER', 'ENTRIES'],
  EXITPGM: ['EXIT PROGRAM', 'EXIT POINTS / OWNER / *PUBLIC'],
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

// ── SQL-driven tools: PTF/CVE Currency Checker, Listening Services Inventory ─
// Both drive STRSQL and read the result grid, so they share one state machine.
// The PTF/CVE checker queries IBM i's two real built-in SQL services,
// SYSTOOLS.CVE_INFO() and SYSTOOLS.GROUP_PTF_CURRENCY_LOCAL(), and classifies
// whatever rows come back (CVSS-band risk, PTF level-gap/staleness risk). No CVE
// list lives in this file or as400sec-parse.js — see the comment on
// evaluateCveRow() in as400sec-parse.js and ROADMAP.md's Security Tools
// section for why that's deliberate. The Listening Services Inventory runs one
// narrow QSYS2.NETSTAT_INFO query per service group (as400sec-parse.js,
// SERVICE_GROUPS).
//
// Bespoke state machine (not the generic single/drill TOOLS shape) because it
// drives STRSQL through several statements in one run rather than a single
// WRK*/DSP* command. Unlike the Bypass Probe, every stage here checks the
// arriving screen's actual content before acting — STRSQL's fillField-then-
// Enter sequence emits an echo screen first (same risk the generic TOOLS
// machine guards against, see this file's header), and checking content rather
// than reacting to "a screen arrived" at all is the more robust way to skip it.
//
// Each query is { key, stmt, fresh(lines, isError), collect(table, info, ctx), onError(ctx) }:
//   fresh   → true once the screen is this query's real result, not an echo or
//             the previous query's leftover grid
//   collect → result rows [{ name, value, risk, detail }]. table = { cols, rows }
//             is the WHOLE result, merged across every page (the runner Rolls Up
//             while the grid says "More..."), info = { selected, truncated } where
//             selected is the host's "N rows selected." count and truncated means
//             fewer rows were read than selected. ctx is shared across the run.
// A tool can also give finalize(ctx), run once after the last query, for findings
// that need more than one query's rows (the Group Profile Review).
const PTFCVE_QUERIES = [
  { key: 'CVE', stmt: 'SELECT * FROM SYSTOOLS.CVE_INFO()',
    fresh: (lines, isError) => isError || parseSqlResultTable(lines).cols.includes('CVE_ID'),
    collect: table => parseCveInfo(table.cols, table.rows).map(row => {
      const { risk, detail } = evaluateCveRow(row);
      return { name: row.CVE_ID, value: `CVSS ${row.CVSS_SCORE ?? '?'}`, risk, detail };
    }) },
  { key: 'PTF', stmt: 'SELECT * FROM SYSTOOLS.GROUP_PTF_CURRENCY_LOCAL()',
    fresh: (lines, isError) => isError || parseSqlResultTable(lines).cols.includes('PTF_GROUP'),
    collect: table => parsePtfCurrency(table.cols, table.rows).map(row => {
      const { risk, detail } = evaluatePtfGroupRow(row);
      return { name: row.PTF_GROUP, value: `level ${row.LVL_INST ?? '?'}`, risk, detail };
    }) },
];

// Every group's grid has the same three columns, so the column check the PTF
// queries use cannot tell this query's result from the previous one's. The mock
// clears both statement rows when it runs the statement, while an echo still
// shows the typed text, so blank input rows mean "this is the real result".
const _sqlInputBlank = lines => [5, 6, 7].every(r => !((lines[r] || '').slice(7).trim()));

const SVCINV_QUERIES = SERVICE_GROUPS.map(g => ({
  key: g.key, stmt: svcStatement(g),
  fresh: _sqlInputBlank,
  collect: (table, info) => {
    const parsed = parseNetstatRows(table.cols, table.rows);
    if (!parsed) return [{ name: g.key, value: '—', risk: 'INFO', detail: 'query returned no LOCAL_PORT column, skipped' }];
    return evaluateServiceGroup(g, parsed, { truncated: info.truncated });
  },
}));

// Objects owned by QSECOFR: one read, judged at once.
const OWNSEC_QUERIES = [{
  key: 'OWNER', stmt: OWNED_STATEMENT, fresh: _sqlInputBlank,
  collect: (table, info) => {
    const objs = parseOwnedObjects(table);
    if (!objs) return [{ name: 'OBJECT_OWNERSHIP', value: '—', risk: 'INFO', detail: 'query returned the wrong columns, skipped' }];
    return evaluateOwnedObjects(objs, { truncated: info.truncated });
  },
}];

// Static Adopted-Authority Scan: the queries depend on the libraries the operator names
// (blank = every library not named Q*), so they are built at start. Reads only store
// their rows, finalize() judges them together.
function _adoptQuery(key, stmt, label, onTable) {
  return { key, stmt, fresh: _sqlInputBlank, onError: ctx => ctx.incomplete.push(label),
    collect: (table, info, ctx) => {
      const parsed = onTable(table, ctx);
      if (!parsed || info.truncated) ctx.incomplete.push(label);
      return [];
    } };
}
function _buildAdoptQueries() {
  const { libs, bad, capped } = parseAdoptLibraries(document.getElementById('as400AdoptLibs')?.value);
  if (bad.length) return { error: `Not a library name: ${bad.join(', ')}` };
  const scopes = libs.length ? libs : [null];
  const qs = [];
  for (const lib of scopes) {
    const tag = lib || 'all non-Q*';
    qs.push(_adoptQuery(`PROG ${tag}`, adoptProgramStatement(lib), `programs in ${tag}`, (table, ctx) => {
      const p = parseAdoptPrograms(table); if (p) ctx.programs.push(...p); return p; }));
    qs.push(_adoptQuery(`PUBLIC ${tag}`, adoptPublicStatement(lib), `*PUBLIC authority in ${tag}`, (table, ctx) => {
      const p = parsePublicAuth(table); if (p) ctx.publicAuth.push(...p); return p; }));
  }
  qs.push(_grpQuery('ALLOBJ', '*ALLOBJ holders', ['AUTHORIZATION_NAME', 'STATUS'], 'allobj'));
  qs.push(_grpQuery('SECADM', '*SECADM holders', ['AUTHORIZATION_NAME', 'STATUS'], 'secadm'));
  return { queries: qs, note: capped ? 'Only the first 8 libraries are read.' : '' };
}

// Output Queue and Spool Audit: per library the inventory, remote queues and *PUBLIC
// authority, then once the special queues, *SPLCTL and *JOBCTL holders and the two QAUDLVL
// checks. Reads only store their rows, finalize() judges them together.
const _OUTQ_PRIV = [['SYSTEM_OBJECT_SCHEMA', 'LIB'], ['SYSTEM_OBJECT_NAME', 'OUTQ'], ['OBJECT_AUTHORITY', 'AUTH']];
const _OUTQ_COLS = {
  inv1: ['OUTQ', 'LIB', 'DSPDTA'], inv2: ['OUTQ', 'LIB', 'AUTCHK', 'OPRCTL'], remote: ['OUTQ', 'LIB', 'RMTSYS'],
  pub: _OUTQ_PRIV, joblog: _OUTQ_PRIV, qprint: _OUTQ_PRIV,
  splctl: ['USR', 'STATUS'], jobctl: ['USR', 'STATUS'], audspl: ['SYSTEM_VALUE_NAME'], audprt: ['SYSTEM_VALUE_NAME'],
};
function _outqQuery(kind, lib, label) {
  return { key: `${kind}${lib ? ' ' + lib : ''}`, stmt: OUTQ_STATEMENTS[kind](lib), fresh: _sqlInputBlank,
    onError: ctx => ctx.incomplete.push(label),
    collect: (table, info, ctx) => {
      const rows = outqRows(table, _OUTQ_COLS[kind]);
      if (!rows || info.truncated) ctx.incomplete.push(label);
      if (rows) ctx[kind === 'joblog' || kind === 'qprint' ? 'special' : kind] = (ctx[kind === 'joblog' || kind === 'qprint' ? 'special' : kind] || []).concat(rows);
      return [];
    } };
}
function _buildOutqQueries() {
  const { libs, bad, capped } = parseAdoptLibraries(document.getElementById('as400OutqLibs')?.value);
  if (bad.length) return { error: `Not a library name: ${bad.join(', ')}` };
  const qs = [];
  for (const lib of (libs.length ? libs : [null])) {
    const tag = lib || 'all non-Q*';
    qs.push(_outqQuery('inv1', lib, `queue settings in ${tag}`), _outqQuery('inv2', lib, `queue authority checks in ${tag}`),
      _outqQuery('pub', lib, `*PUBLIC authority on queues in ${tag}`));
  }
  qs.push(_outqQuery('remote', null, 'remote queues'), _outqQuery('joblog', null, 'QPJOBLOG authority'), _outqQuery('qprint', null, 'QPRINT authority'), _outqQuery('splctl', null, '*SPLCTL holders'),
    _outqQuery('jobctl', null, '*JOBCTL holders'), _outqQuery('audspl', null, 'QAUDLVL *SPLFDTA check'),
    _outqQuery('audprt', null, 'QAUDLVL *PRTDTA check'));
  return { queries: qs, note: capped ? 'Only the first 8 libraries are read.' : '' };
}

// Exit Program Integrity and Authority: find the registered programs outside Q* libraries, then read
// *PUBLIC on those programs and their libraries, the owner of each (a statement built from the
// libraries the first read found), and the audit journal for the programs being changed or restored.
function _exitQuery(key, stmt, label, onTable) {
  return { key, stmt, fresh: _sqlInputBlank, onError: ctx => ctx.incomplete.push(label),
    collect: (table, info, ctx) => {
      const ok = onTable(table, info, ctx);
      if (!ok || info.truncated) ctx.incomplete.push(label);
      return [];
    } };
}
const EXITPGM_QUERIES = [
  _exitQuery('programs', EXIT_STATEMENTS.programs, 'registered exit programs', (table, info, ctx) => {
    const p = parseExitPrograms(table); if (!p) return false;
    ctx.exits = p;
    const libs = [...new Set(p.map(e => e.lib))];
    ctx.exitLibs = libs.slice(0, EXIT_MAX_LIBS); ctx.libsCapped = libs.length > EXIT_MAX_LIBS;
    return true;
  }),
  _exitQuery('program authority', adoptPublicStatement(null), '*PUBLIC authority on programs', (table, info, ctx) => {
    const p = parsePublicAuth(table); if (!p) return false; ctx.progPub = p; return true; }),
  _exitQuery('library authority', EXIT_STATEMENTS.libpub, '*PUBLIC authority on libraries', (table, info, ctx) => {
    const p = parseLibPublic(table); if (!p) return false; ctx.libPub = p; return true; }),
  // Built from what the first read found, skipped when it found no libraries.
  { ..._exitQuery('owners', null, 'program owners', (table, info, ctx) => {
      const p = parseAdoptPrograms(table); if (!p) return false; ctx.owners = p; return true; }),
    stmt: ctx => (ctx.exitLibs && ctx.exitLibs.length ? EXIT_STATEMENTS.owners(ctx.exitLibs) : null) },
  _exitQuery('audit config', JOURNAL_CONFIG.audlvl, 'audit setting', (table, info, ctx) => { ctx.auditOn = table.rows.length > 0; return true; }),
  _exitQuery('journal', journalStatement(EXIT_JOURNAL_TYPES, EXIT_JOURNAL_DAYS), 'audit journal read', (table, info, ctx) => {
    const r = parseJournalRows(table); if (!r) return false;
    ctx.journal = r; ctx.journalTruncated = !!info.truncated; return true; }),
];

// Audit Journal Review: six tiny config checks (is auditing on, and are the levels these entry
// types need set), then one journal read per group of entry types, over the days the operator
// chose. Reads only store their rows, finalize() judges them together.
function _buildJournalQueries() {
  const { days, error } = parseJournalDays(document.getElementById('as400JrnDays')?.value);
  if (error) return { error };
  const qs = [];
  for (const [name, stmt] of Object.entries(JOURNAL_CONFIG)) {
    qs.push({ key: `config ${name}`, stmt, fresh: _sqlInputBlank,
      onError: ctx => ctx.incomplete.push(`audit setting ${name}`),
      collect: (table, info, ctx) => { (ctx.cfg = ctx.cfg || {})[name] = table.rows.length > 0; return []; } });
  }
  for (const g of JOURNAL_GROUPS) {
    qs.push({ key: `journal ${g.types}`, stmt: journalStatement(g.types, days), fresh: _sqlInputBlank,
      onError: ctx => ctx.incomplete.push(`${g.label.toLowerCase()} journal read`),
      collect: (table, info, ctx) => {
        const rows = parseJournalRows(table);
        if (!rows) { ctx.incomplete.push(`${g.label.toLowerCase()} journal read`); return []; }
        (ctx.jrows = ctx.jrows || {})[g.key] = rows;
        if (info.truncated) (ctx.jtrunc = ctx.jtrunc || {})[g.key] = true;
        return [];
      } });
  }
  return { queries: qs, days };
}

// Group Profile Review: four reads that only store their rows, finalize() judges them together.
const _grpQuery = (key, label, cols, store) => ({
  key, stmt: GROUP_QUERIES[key], fresh: _sqlInputBlank,
  onError: ctx => ctx.incomplete.push(label),
  collect: (table, info, ctx) => {
    if (!groupTableOk(table, cols[0], cols[1]) || info.truncated) ctx.incomplete.push(label);
    ctx[store] = store === 'supp' ? parseSuppGroups(table) : store === 'primary' ? parsePrimaryGroups(table) : parseHolders(table);
    return [];
  },
});
const GRPREV_QUERIES = [
  _grpQuery('SUPP',    'supplemental groups',   ['GROUP_PROFILE_NAME', 'USER_PROFILE_NAME'], 'supp'),
  _grpQuery('PRIMARY', 'primary groups',        ['AUTHORIZATION_NAME', 'GROUP_PROFILE_NAME'], 'primary'),
  _grpQuery('ALLOBJ',  '*ALLOBJ holders',       ['AUTHORIZATION_NAME', 'STATUS'], 'allobj'),
  _grpQuery('SECADM',  '*SECADM holders',       ['AUTHORIZATION_NAME', 'STATUS'], 'secadm'),
];

const SQL_TOOLS = {
  PTFCVE: {
    queries: PTFCVE_QUERIES, btn: 'as400PtfcveBtn',
    done: () => {
      const bad = RESULTS.PTFCVE.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad}/${RESULTS.PTFCVE.length} finding(s) need attention.`, bad };
    },
  },
  SVCINV: {
    queries: SVCINV_QUERIES, btn: 'as400SvcinvBtn',
    done: () => {
      const bad = RESULTS.SVCINV.filter(r => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(r.risk)).length;
      return { text: `Done — ${bad}/${RESULTS.SVCINV.length} service(s) need attention.`, bad };
    },
  },
  EXITPGM: {
    queries: EXITPGM_QUERIES, btn: 'as400ExitpgmBtn',
    finalize: ctx => evaluateExitPrograms({ exits: ctx.exits, progPub: ctx.progPub, libPub: ctx.libPub, owners: ctx.owners,
      journal: ctx.journal, auditOn: ctx.auditOn, journalTruncated: ctx.journalTruncated, libsCapped: ctx.libsCapped, incomplete: ctx.incomplete }),
    done: () => {
      const bad = RESULTS.EXITPGM.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad} exit program(s) rated HIGH or worse.`, bad };
    },
  },
  JRN: {
    queries: [], btn: 'as400JrnBtn', build: _buildJournalQueries,
    finalize: ctx => evaluateJournal({ days: sqlrun.days, cfg: ctx.cfg, rows: ctx.jrows, truncated: ctx.jtrunc, incomplete: ctx.incomplete }),
    done: () => {
      const bad = RESULTS.JRN.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad} audit journal finding(s) rated HIGH or worse.`, bad };
    },
  },
  OUTQ: {
    queries: [], btn: 'as400OutqBtn', build: _buildOutqQueries,
    finalize: ctx => evaluateOutq({ ...ctx }),
    done: () => {
      const bad = RESULTS.OUTQ.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad} queue/audit finding(s) rated HIGH or worse.`, bad };
    },
  },
  ADOPT: {
    queries: [], btn: 'as400AdoptBtn', build: _buildAdoptQueries,
    finalize: ctx => evaluateAdopting({ programs: ctx.programs, publicAuth: ctx.publicAuth, allobj: ctx.allobj || [],
      secadm: ctx.secadm || [], incomplete: ctx.incomplete }),
    done: () => {
      const bad = RESULTS.ADOPT.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad} adopting program(s) owned by a powerful profile and open to *PUBLIC.`, bad };
    },
  },
  OWNSEC: {
    queries: OWNSEC_QUERIES, btn: 'as400OwnsecBtn',
    done: () => {
      const bad = RESULTS.OWNSEC.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      const libs = RESULTS.OWNSEC.filter(r => r.risk !== 'OK' && r.risk !== 'INFO').length;
      return { text: `Done — ${libs} ${libs === 1 ? 'library' : 'libraries'} with ${OWNED_BY}-owned objects, ${bad} holding code.`, bad };
    },
  },
  GRPREV: {
    queries: GRPREV_QUERIES, btn: 'as400GrprevBtn',
    finalize: ctx => evaluateGroups({ supp: ctx.supp || [], primary: ctx.primary || [], allobj: ctx.allobj || [],
      secadm: ctx.secadm || [], incomplete: ctx.incomplete }),
    done: () => {
      const bad = RESULTS.GRPREV.filter(r => r.risk === 'CRITICAL' || r.risk === 'HIGH').length;
      return { text: `Done — ${bad} privileged group finding(s).`, bad };
    },
  },
};

let sqlrun = { running: false, tool: null, idx: 0, stage: null, tables: [], selected: 0, lastText: '', ctx: null, days: 30 };

// Type a statement into STRSQL, wrapping onto the continuation line when it is
// longer than one input line (as a real STRSQL statement area does).
function _fillSqlStatement(stmt) {
  const scr  = state.liveScreen;
  const cols = scr?.cols || 80;
  const inputs = (scr?.fields || []).filter(f => !f.protected);
  const parts = splitSqlStatement(stmt);
  if (inputs.length < parts.length) { _fillFirstInput(stmt); return; }
  parts.forEach((part, i) => {
    const da = inputs[i].startAddr + 1;
    _send({ type: 'fillField', row: Math.floor(da / cols), col: da % cols, text: part });
  });
}

function _sqlStep() {
  const T = SQL_TOOLS[sqlrun.tool];
  const q = T.queries[sqlrun.idx];
  if (!q) { _sqlEnd(); return; }
  // A statement may be built from what earlier reads found, and null means skip it.
  const stmt = typeof q.stmt === 'function' ? q.stmt(sqlrun.ctx) : q.stmt;
  if (stmt == null) { _sqlAdvance(); return; }
  _status(sqlrun.tool, `[${sqlrun.idx + 1}/${T.queries.length}] Running ${stmt}…`);
  sqlrun.stage = 'RESULT';
  sqlrun.tables = [];
  _fillSqlStatement(stmt);
  _pressEnter();
}

// One query is finished: hand the merged table to its collector, then move on.
function _sqlQueryDone() {
  const tool = sqlrun.tool;
  const T = SQL_TOOLS[tool];
  const q = T.queries[sqlrun.idx];
  const rows = sqlrun.tables.flatMap(t => t.rows);
  const table = { cols: sqlrun.tables[0].cols, rows };
  const info = { selected: sqlrun.selected, truncated: sqlrun.selected > rows.length };
  RESULTS[tool].push(...q.collect(table, info, sqlrun.ctx));
  _render(tool);
  _sqlAdvance();
}

function _sqlAdvance() {
  sqlrun.idx++;
  if (sqlrun.idx < SQL_TOOLS[sqlrun.tool].queries.length) _sqlStep();
  else _sqlEnd();
}

function _sqlEnd() {
  const T = SQL_TOOLS[sqlrun.tool];
  if (T.finalize) { RESULTS[sqlrun.tool].push(...T.finalize(sqlrun.ctx)); _render(sqlrun.tool); }
  sqlrun.stage = 'BACK';
  _pressF3();
}

function _sqlOnScreen(msg) {
  if (!sqlrun.running) return;
  const lines = _screenLines(msg);
  const text  = lines.join('\n');
  const tool  = sqlrun.tool;
  const T = SQL_TOOLS[tool];
  const q = T.queries[sqlrun.idx];

  if (sqlrun.stage === 'NAV') {
    if (!text.includes('Interactive SQL')) return; // still the menu echo, keep waiting
    _sqlStep();
    return;
  }

  if (sqlrun.stage === 'RESULT') {
    const sqlError = /SQL\d{4}/.exec(text);
    const rowsSelected = /(\d+) rows selected\./.exec(text);
    if (!sqlError && !rowsSelected) return; // fillField echo of the typed statement, keep waiting

    // On the second+ query, the screen's result area doesn't repaint until
    // the real Enter-driven redraw -- fillField's own echo after typing the
    // NEXT statement still shows the PREVIOUS query's "N rows selected."
    // message and result grid untouched, which also satisfies rowsSelected
    // above. Each query's own fresh() is what distinguishes "my real result"
    // from "stale previous result", not just the presence of rows-selected
    // text. (The very first query has no previous result to be stale.)
    if (!q.fresh(lines, !!sqlError)) return;

    if (sqlError) {
      RESULTS[tool].push({ name: q.key, value: '—', risk: 'INFO', detail: `query failed: ${sqlError[0]} — skipped` });
      if (q.onError) q.onError(sqlrun.ctx);
      _render(tool);
      _sqlAdvance();
      return;
    }
    sqlrun.selected = parseInt(rowsSelected[1], 10);
    sqlrun.tables.push(parseSqlResultTable(lines));
    sqlrun.lastText = text;
    // A result longer than a screen says "More...": Roll Up for the rest, so no
    // query is capped at ten rows. Bounded, and a short read shows as truncated.
    if (text.includes('More...') && sqlrun.tables.length < 60) { sqlrun.stage = 'PAGE'; _pressPgDn(); return; }
    _sqlQueryDone();
    return;
  }

  if (sqlrun.stage === 'PAGE') {
    if (text === sqlrun.lastText) return; // the key has not repainted the grid yet
    sqlrun.tables.push(parseSqlResultTable(lines));
    sqlrun.lastText = text;
    if (text.includes('More...') && sqlrun.tables.length < 60) { _pressPgDn(); return; }
    _sqlQueryDone();
    return;
  }

  if (sqlrun.stage === 'BACK') {
    if (!text.includes('Selection or command')) return; // still the SQL screen's own F3 echo
    _sqlFinish();
  }
}

function _sqlFinish() {
  const tool = sqlrun.tool;
  sqlrun.running = false;
  const btn = document.getElementById(SQL_TOOLS[tool].btn);
  if (btn) btn.disabled = false;
  const { text, bad } = SQL_TOOLS[tool].done();
  _status(tool, text, bad ? 'error' : 'success');
}

function _startSqlTool(tool) {
  if (sqlrun.running) return;
  if (!state.liveScreen || !(state.liveScreenText || '').includes('Selection or command')) {
    _status(tool, 'Sign on and navigate to an AS/400 menu (with a command line) first.', 'error');
    return;
  }
  let days;
  if (SQL_TOOLS[tool].build) {
    const b = SQL_TOOLS[tool].build();
    if (b.error) { _status(tool, b.error, 'error'); return; }
    SQL_TOOLS[tool].queries = b.queries;
    days = b.days;
  }
  RESULTS[tool] = [];
  _render(tool);
  sqlrun = { running: true, tool, idx: 0, stage: 'NAV', tables: [], selected: 0, lastText: '', ctx: { incomplete: [], programs: [], publicAuth: [] }, days };
  const btn = document.getElementById(SQL_TOOLS[tool].btn);
  if (btn) btn.disabled = true;
  _status(tool, 'Issuing STRSQL…');
  _fillFirstInput('STRSQL');
  _pressEnter();
}

export function startAs400PtfCveScan() { _startSqlTool('PTFCVE'); }
export function startAs400SvcInvScan() { _startSqlTool('SVCINV'); }
export function startAs400GrpRevScan() { _startSqlTool('GRPREV'); }
export function startAs400OwnSecScan() { _startSqlTool('OWNSEC'); }
export function startAs400AdoptScan()  { _startSqlTool('ADOPT'); }
export function startAs400OutqScan()   { _startSqlTool('OUTQ'); }
export function startAs400JrnScan()    { _startSqlTool('JRN'); }
export function startAs400ExitPgmScan() { _startSqlTool('EXITPGM'); }

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
export function startAs400DftpwdScan()  { _start('DFTPWD'); }
export function startAs400CrtautScan()  { _qcrtaut = '*UNKNOWN'; _start('CRTAUT'); }
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
  add('DFTPWD',  'default-password-report');
  add('CRTAUT',  'library-crtaut-review');
  add('IFS',     'ifs-permission-sweep');
  add('PGMSTK',  'adopted-authority-scanner');
  add('BYPASS',  'menu-bypass-probe');
  add('PTFCVE',  'ptf-cve-currency-checker');
  add('SVCINV',  'listening-services-inventory');
  add('GRPREV',  'group-profile-review');
  add('OWNSEC',  'qsecofr-owned-objects');
  add('ADOPT',   'static-adopted-authority-scan');
  add('OUTQ',    'output-queue-spool-audit');
  add('JRN',     'audit-journal-review');
  add('EXITPGM', 'exit-program-integrity-authority');
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
  startAs400ReginfScan, startAs400NetsvrScan, startAs400DftpwdScan, startAs400CrtautScan, startAs400IfsScan,
  startAs400PgmstkScan, startAs400BypassProbe, startAs400PtfCveScan, startAs400SvcInvScan, startAs400GrpRevScan, startAs400OwnSecScan, startAs400AdoptScan, startAs400OutqScan, startAs400JrnScan, startAs400ExitPgmScan,
});
