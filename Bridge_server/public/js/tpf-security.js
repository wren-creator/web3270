// ── z/TPF Security Tools ──────────────────────────────────────────────────
// Auto-detects z/TPF operator console sessions and provides:
//   ECB Enumerator, Privilege Scanner, Entry Point Prober, Pool Monitor

import { state } from './state.js';
import { screenToText } from './rendering.js';
import { sendKey } from './keyboard.js';

// ── Detection state ────────────────────────────────────────────────────────
let _detected  = false;
let _privLevel = 0;   // 0=unknown, 1=OPER, 2=SYSOP, 3=ADMIN

// ── Async command queue ────────────────────────────────────────────────────
const _queue = [];
let _pendingResolve = null;

function _injectCmd(cmd) {
  if (!state.liveScreen || !state.liveScreen.fields) return;
  const cols        = state.liveScreen.cols || 80;
  const inputField  = state.liveScreen.fields.find(f => !f.protected && !f.nondisplay);
  if (!inputField) return;
  const dataStart   = inputField.startAddr + 1;
  const row         = Math.floor(dataStart / cols);
  const col         = dataStart % cols;
  const session     = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'fillField', row, col, text: cmd }));
  setTimeout(() => sendKey('ENTER'), 80);
}

function _drainQueue() {
  if (_queue.length === 0) return;
  const { cmd, resolve } = _queue.shift();
  _pendingResolve = resolve;
  _injectCmd(cmd);
}

function _tpfCmd(cmd) {
  return new Promise(resolve => {
    _queue.push({ cmd, resolve });
    if (!_pendingResolve) _drainQueue();
  });
}

// Console output lines arrive prefixed with their ZTPFnnnI/W/E message id
// (e.g. "ZTPF200I AARES  APPL  ACTIVE ..."). Strip it so table rows can be
// matched positionally, and keep a plain line splitter next to it.
function _stripMsgId(line) {
  return String(line).replace(/^\s*ZTPF\d{3}[IWE]\s+/, '').trim();
}
function _splitLines(text) {
  return String(text).split('\n').map(l => l.trim()).filter(Boolean);
}

// ── Screen hook — called on every screen event ─────────────────────────────
export function tpfOnScreen(msg) {
  const text = screenToText(msg);

  const isTpf = /z\/TPF|ZTPF\d{3}[IWE]|ENTER TPF COMMAND/i.test(text);

  if (isTpf && !_detected) {
    _detected = true;
    state.tpfDetected = true;
    _showTpfSection();
  } else if (!isTpf && _detected && /TSO\/E LOGON|ISPF PRIMARY|z\/VM|CP LOGON|CICS/i.test(text)) {
    _detected = false;
    state.tpfDetected = false;
    _hideTpfSection();
  }

  // Infer privilege level from rejection messages
  if (isTpf) {
    if (/AUTHORIZATION FAILURE/i.test(text) && /SYSPROG AUTHORITY/i.test(text) && _privLevel < 2) {
      _privLevel = 2;
      _updatePrivBadge();
    } else if (/AUTHORIZATION FAILURE/i.test(text) && _privLevel === 0) {
      _privLevel = 1;
      _updatePrivBadge();
    }
  }

  // Resolve pending tool command
  if (_pendingResolve) {
    const resolve   = _pendingResolve;
    _pendingResolve = null;
    resolve(text);
    setTimeout(_drainQueue, 120);
  }
}

function _showTpfSection() {
  const el = document.getElementById('tpfSection');
  if (el) el.style.display = '';
  // Switch to Security tab so the panel is visible
  const secTab = document.getElementById('secPanelTab');
  if (secTab && secTab.style.display === 'none') return; // not unlocked yet
}

function _hideTpfSection() {
  const el = document.getElementById('tpfSection');
  if (el) el.style.display = 'none';
  _clearResults();
}

function _updatePrivBadge() {
  const badge  = document.getElementById('tpfPrivBadge');
  if (!badge) return;
  const labels = ['UNKNOWN', 'OPER', 'SYSOP', 'SYSPROG'];
  const colors = ['#3a3a3a', '#c07020', '#20a070', '#20c050'];
  badge.textContent        = labels[_privLevel] || 'UNKNOWN';
  badge.style.background   = colors[_privLevel] || '#3a3a3a';
  badge.style.display      = 'inline-block';
}

// ── Tool: ECB Enumerator ───────────────────────────────────────────────────
export async function tpfEnumEcbs() {
  if (!_detected) return;
  _setResults('<div class="tpf-running">Running ZSHOW E — enumerating entry points…</div>');

  const text = await _tpfCmd('ZSHOW E');
  const lines = _splitLines(text);

  // Every console line carries a ZTPF200I prefix, header rows included, so
  // gating on that marker would skip the whole table. Strip the message id
  // and trust the positional row shape instead; stop at the end marker.
  const ecbs = [];
  for (const raw of lines) {
    if (/ZTPF202I|END OF ECB DIRECTORY/.test(raw)) break;
    const line = _stripMsgId(raw);
    const m = line.match(/^([A-Z]{4,8})\s+(APPL|SYSTEM)\s+(ACTIVE|IDLE|STOPPED)\s+(\d+)\s+([\d,]+)/);
    if (m) ecbs.push({ name: m[1], type: m[2], status: m[3], entries: m[4], txn: m[5], priv: /\[PRIV\]/.test(raw) });
  }

  state.tpfEcbList = ecbs;

  if (ecbs.length === 0) {
    _setResults('<div class="tpf-running">No ECBs parsed — try connecting to a z/TPF console and re-running.</div>');
    return;
  }

  _setResults(`
    <div class="tpf-result-hdr">ECB DIRECTORY — ${ecbs.length} ENTRY POINTS</div>
    <table class="tpf-table">
      <thead><tr><th>NAME</th><th>TYPE</th><th>STATUS</th><th>TRANS</th><th></th></tr></thead>
      <tbody>
        ${ecbs.map(e => `
          <tr class="${e.priv ? 'tpf-priv-row' : ''}">
            <td class="tpf-mono">${esc(e.name)}</td>
            <td class="tpf-dim">${esc(e.type)}</td>
            <td class="${e.status === 'ACTIVE' ? 'tpf-ok' : 'tpf-idle'}">${esc(e.status)}</td>
            <td class="tpf-mono tpf-dim">${esc(e.txn)}</td>
            <td>${e.priv ? '<span class="tpf-priv-flag">PRIV</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="tpf-result-note">${ecbs.filter(e => e.priv).length} privileged · ${ecbs.filter(e => e.status === 'ACTIVE').length} active</div>
  `);
}

// ── Tool: Privilege Boundary Scanner ──────────────────────────────────────
export async function tpfScanPriv() {
  if (!_detected) return;
  _setResults('<div class="tpf-running">Scanning privilege boundary…</div>');

  const showText = await _tpfCmd('ZSHOW S');
  const canShow  = /ZTPF100I/i.test(showText);

  const stopText = await _tpfCmd('ZSTOP,RPRT');
  const canStop  = !/AUTHORIZATION FAILURE/i.test(stopText);

  const endText  = await _tpfCmd('ZEND CHECK');
  const canEnd   = !/AUTHORIZATION FAILURE/i.test(endText);

  _privLevel = canEnd ? 3 : canStop ? 2 : canShow ? 1 : 0;
  _updatePrivBadge();

  const labels = ['UNKNOWN', 'OPER — view only', 'SYSOP — stop + manage', 'SYSPROG — full system control'];
  const risks  = [
    'Could not determine privilege level.',
    'Read-only console access. Can enumerate ECBs and pools, cannot modify system state.',
    'Can stop entry points and manage programs. A compromised SYSOP session can disrupt transaction processing.',
    'CRITICAL — full system control. ZEND QUIESCE would halt all transaction processing.'
  ];
  const riskLevels = ['', 'low', 'medium', 'critical'];

  _setResults(`
    <div class="tpf-result-hdr">PRIVILEGE BOUNDARY SCAN</div>
    <div class="tpf-priv-result tpf-priv-${riskLevels[_privLevel]}">
      <div class="tpf-priv-role">${esc(labels[_privLevel])}</div>
      <div class="tpf-priv-risk">${esc(risks[_privLevel])}</div>
    </div>
    <table class="tpf-table" style="margin-top:8px">
      <thead><tr><th>COMMAND</th><th>RESULT</th><th>REQUIRES</th></tr></thead>
      <tbody>
        <tr>
          <td class="tpf-mono">ZSHOW S</td>
          <td class="${canShow ? 'tpf-ok' : 'tpf-deny'}">${canShow ? '✓ Allowed' : '✗ Denied'}</td>
          <td class="tpf-dim">OPER</td>
        </tr>
        <tr>
          <td class="tpf-mono">ZSTOP,RPRT</td>
          <td class="${canStop ? 'tpf-ok' : 'tpf-deny'}">${canStop ? '✓ Allowed' : '✗ Denied'}</td>
          <td class="tpf-dim">SYSOP</td>
        </tr>
        <tr>
          <td class="tpf-mono">ZEND CHECK</td>
          <td class="${canEnd ? 'tpf-ok' : 'tpf-deny'}">${canEnd ? '✓ Allowed' : '✗ Denied'}</td>
          <td class="tpf-dim">SYSPROG</td>
        </tr>
      </tbody>
    </table>
  `);
}

// ── Tool: Entry Point Prober ───────────────────────────────────────────────
export async function tpfProbeEntries() {
  if (!_detected) return;

  const targets = (state.tpfEcbList?.length)
    ? state.tpfEcbList.map(e => e.name)
    : ['AARES','AUTH','AVAIL','BKNG','CCARD','FARES','HOTEL','LOGR','PAYM','SECU'];

  _setResults(`<div class="tpf-running">Probing ${targets.length} entry points…</div>`);

  const results = [];
  for (const name of targets) {
    const text      = await _tpfCmd(`ZTEST ENTRY,${name}`);
    const responded = /ZTPF71[0-9]I/.test(text);
    const priv      = /HANDLES PRIVILEGED DATA/i.test(text);
    const m         = text.match(/RESPONDED IN (\d+)ms/i);
    const respMs    = m ? parseInt(m[1]) : null;
    const status    = text.match(/STATUS\s*:\s*(\S+)/i)?.[1] || '—';
    results.push({ name, responded, priv, respMs, status });
  }

  const responded = results.filter(r => r.responded).length;
  const privCount = results.filter(r => r.priv).length;

  _setResults(`
    <div class="tpf-result-hdr">ENTRY POINT PROBE — ${targets.length} TARGETS</div>
    <table class="tpf-table">
      <thead><tr><th>ECB</th><th>RESP</th><th>TIME</th><th>STATUS</th><th></th></tr></thead>
      <tbody>
        ${results.map(r => `
          <tr class="${r.priv ? 'tpf-priv-row' : ''}">
            <td class="tpf-mono">${esc(r.name)}</td>
            <td class="${r.responded ? 'tpf-ok' : 'tpf-deny'}">${r.responded ? '✓' : '✗'}</td>
            <td class="tpf-mono tpf-dim">${r.respMs !== null ? r.respMs + 'ms' : '—'}</td>
            <td class="tpf-dim">${esc(r.status)}</td>
            <td>${r.priv ? '<span class="tpf-priv-flag">PRIV</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="tpf-result-note">${responded}/${targets.length} responded · ${privCount} privileged entry points</div>
  `);
}

// ── Tool: Pool Monitor ─────────────────────────────────────────────────────
export async function tpfCheckPools() {
  if (!_detected) return;
  _setResults('<div class="tpf-running">Running ZSHOW P — checking memory pools…</div>');

  const text  = await _tpfCmd('ZSHOW P');
  const lines = _splitLines(text);

  const pools = [];
  for (const raw of lines) {
    const m = _stripMsgId(raw).match(/^(ECBPOOL|FPOOL|GPOOL|IPOOL|TPOOL|XPOOL)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
    if (m) pools.push({ name: m[1], size: m[2], used: m[3], pct: parseInt(m[4]), warn: parseInt(m[4]) >= 90 });
  }

  const warnCount = pools.filter(p => p.warn).length;

  _setResults(pools.length === 0
    ? '<div class="tpf-running">No pool data parsed — run ZSHOW P manually to verify.</div>'
    : `
      <div class="tpf-result-hdr">MEMORY POOL STATUS${warnCount > 0 ? ` — ${warnCount} WARNING${warnCount > 1 ? 'S' : ''}` : ''}</div>
      <table class="tpf-table">
        <thead><tr><th>POOL</th><th>SIZE</th><th>USED</th><th>PCT</th><th>STATUS</th></tr></thead>
        <tbody>
          ${pools.map(p => `
            <tr class="${p.warn ? 'tpf-warn-row' : ''}">
              <td class="tpf-mono">${esc(p.name)}</td>
              <td class="tpf-dim">${esc(p.size)}</td>
              <td class="tpf-mono">${esc(p.used)}</td>
              <td class="${p.warn ? 'tpf-warn' : 'tpf-ok'}">${p.pct}%</td>
              <td class="${p.warn ? 'tpf-warn' : 'tpf-dim'}">${p.warn ? '⚠ NEAR CAPACITY' : 'OK'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tpf-result-note">${warnCount > 0 ? `${warnCount} pool(s) above 90% — risk of transaction rejection` : 'All pools within normal limits'}</div>
    `
  );
}

// ── Tool: System Diagnostics ──────────────────────────────────────────────
// Resource-containment sweep. Runs the four diagnostic ZSHOW subcommands and
// flags the anomalies. On the mock these all trace back to one seeded
// incident (CYC-0826) rather than four independent faults — the lesson is
// reading them together instead of chasing each in isolation.
export async function tpfSysDiag() {
  if (!_detected) return;
  _setResults('<div class="tpf-running">Resource sweep — ZSHOW UTIL / LOCK / MQP / ALLOC…</div>');

  const util  = _splitLines(await _tpfCmd('ZSHOW UTIL')).map(_stripMsgId);
  const lock  = _splitLines(await _tpfCmd('ZSHOW LOCK')).map(_stripMsgId);
  const mqp   = _splitLines(await _tpfCmd('ZSHOW MQP')).map(_stripMsgId);
  const alloc = _splitLines(await _tpfCmd('ZSHOW ALLOC')).map(_stripMsgId);

  // ZSHOW UTIL — system average + busiest I-stream. A single I-stream in the
  // 60s is normal headroom on this platform; the real tells are a hot stream
  // (≥ 85%) or the CPU-loop detector reporting anything other than NONE.
  const avgLine  = util.find(l => /SYSTEM AVERAGE/i.test(l)) || '';
  const avgPct   = avgLine.match(/AVERAGE:\s*(\d+)%/i)?.[1] ?? '—';
  const busiest  = avgLine.match(/BUSIEST:\s*(CP\d+)\s+AT\s+(\d+)%/i);
  const loopLine = util.find(l => /CPU-LOOP DETECTION/i.test(l)) || '';
  const cpuLoop  = !!loopLine && !/CPU-LOOP DETECTION:\s*NONE\b/i.test(loopLine);
  const cpuAnom  = cpuLoop || (busiest ? parseInt(busiest[2]) >= 85 : false);

  // ZSHOW LOCK — held record locks
  const locks = [];
  for (const l of lock) {
    const m = l.match(/^(\w+)\s+(\S+)\s+(EXCL|SHARE)\s+(\d+)\s+([\d,]+)$/);
    if (m) locks.push({ holder: m[1], resource: m[2], type: m[3], waiters: +m[4], heldMs: +m[5].replace(/,/g, '') });
  }
  const lockAnoms = locks.filter(l => l.heldMs >= 1000 || l.waiters >= 5);

  // ZSHOW MQP — scheduler list depths
  const lists = [];
  for (const l of mqp) {
    const m = l.match(/^([A-Z]+ LIST)\s*:\s*([\d,]+)\s+ENTRIES/i);
    if (m) lists.push({ name: m[1], count: +m[2].replace(/,/g, '') });
  }
  const deferred = lists.find(r => /DEFERRED/i.test(r.name));
  const mqpAnom  = deferred ? deferred.count >= 1000 : false;

  // ZSHOW ALLOC — fixed-file record allocation
  const recs = [];
  for (const l of alloc) {
    const m = l.match(/^(#\w+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+(\d+)%/);
    if (m) recs.push({ type: m[1], size: m[2], prime: m[3], overflow: m[4], pct: +m[5] });
  }
  const recAnoms = recs.filter(r => r.pct >= 90);

  const anomCount = (cpuAnom ? 1 : 0) + lockAnoms.length + (mqpAnom ? 1 : 0) + recAnoms.length;

  const lockRows = locks.map(l => `
    <tr class="${(l.heldMs >= 1000 || l.waiters >= 5) ? 'tpf-warn-row' : ''}">
      <td class="tpf-mono">${esc(l.holder)}</td>
      <td class="tpf-mono tpf-dim">${esc(l.resource)}</td>
      <td class="tpf-dim">${esc(l.type)}</td>
      <td class="${l.waiters >= 5 ? 'tpf-warn' : 'tpf-dim'}">${l.waiters}</td>
      <td class="${l.heldMs >= 1000 ? 'tpf-warn' : 'tpf-dim'}">${l.heldMs.toLocaleString()}ms</td>
    </tr>`).join('');

  const listRows = lists.map(r => `
    <tr class="${(/DEFERRED/i.test(r.name) && r.count >= 1000) ? 'tpf-warn-row' : ''}">
      <td class="tpf-mono">${esc(r.name)}</td>
      <td class="${(/DEFERRED/i.test(r.name) && r.count >= 1000) ? 'tpf-warn' : 'tpf-mono tpf-dim'}">${r.count.toLocaleString()}</td>
    </tr>`).join('');

  const recRows = recs.map(r => `
    <tr class="${r.pct >= 90 ? 'tpf-warn-row' : ''}">
      <td class="tpf-mono">${esc(r.type)}</td>
      <td class="tpf-dim">${esc(r.prime)}</td>
      <td class="${r.pct >= 90 ? 'tpf-warn' : 'tpf-ok'}">${r.pct}%</td>
    </tr>`).join('');

  _setResults(`
    <div class="tpf-result-hdr">RESOURCE DIAGNOSTICS${anomCount > 0 ? ` — ${anomCount} ANOMAL${anomCount > 1 ? 'IES' : 'Y'}` : ' — CLEAR'}</div>
    <div class="tpf-result-note" style="padding:4px 8px">
      CPU: ${esc(avgPct)}% avg${busiest ? `, busiest ${esc(busiest[1])} at <span class="${cpuAnom ? 'tpf-warn' : 'tpf-dim'}">${esc(busiest[2])}%</span>` : ''}
    </div>
    <table class="tpf-table">
      <thead><tr><th>LOCK HOLDER</th><th>RESOURCE</th><th>TYPE</th><th>WAIT</th><th>HELD</th></tr></thead>
      <tbody>${lockRows || '<tr><td colspan="5" class="tpf-dim">no locks parsed</td></tr>'}</tbody>
    </table>
    <table class="tpf-table" style="margin-top:6px">
      <thead><tr><th>SCHEDULER LIST</th><th>DEPTH</th></tr></thead>
      <tbody>${listRows || '<tr><td colspan="2" class="tpf-dim">no lists parsed</td></tr>'}</tbody>
    </table>
    <table class="tpf-table" style="margin-top:6px">
      <thead><tr><th>RECORD TYPE</th><th>PRIME</th><th>USED</th></tr></thead>
      <tbody>${recRows || '<tr><td colspan="3" class="tpf-dim">no allocation parsed</td></tr>'}</tbody>
    </table>
    <div class="tpf-result-note">${anomCount > 0
      ? `${anomCount} anomaly signal(s). On the mock these are downstream symptoms of one incident (CYC-0826), not separate faults — correlate before remediating.`
      : 'All four diagnostic areas within normal limits.'}</div>
  `);
}

// ── Tool: Entry Point Debugger ────────────────────────────────────────────
// Drives the console debugger (ZTEST beyond ENTRY) through a full
// START → DISPLAY → BP → STEP → GO → STOR → STOP cycle against a privileged
// ECB. The finding is that ZTEST is not privilege-gated: any operator
// session that reaches the console can attach a debugger to privileged code.
export async function tpfDebugEntry() {
  if (!_detected) return;
  const target = state.tpfEcbList?.find(e => e.priv)?.name || 'PAYM';
  _setResults(`<div class="tpf-running">Attaching ZTEST debugger to ${esc(target)}…</div>`);

  const startT   = _splitLines(await _tpfCmd(`ZTEST START,${target}`)).map(_stripMsgId);
  const started  = startT.some(l => /DEBUG SESSION STARTED/i.test(l));
  if (!started) {
    // NOT FOUND, ALREADY ACTIVE, or a syntax refusal — clear any stale
    // session and report the first line the console gave back.
    await _tpfCmd('ZTEST STOP');
    const why = startT.find(l => /NOT FOUND|ALREADY ACTIVE|Syntax/i.test(l)) || startT[0] || 'no response';
    _setResults(`<div class="tpf-running">ZTEST START rejected for ${esc(target)} — ${esc(why)}</div>`);
    return;
  }
  const base = startT.find(l => /LOADED @/i.test(l))?.match(/LOADED @ ([0-9A-F]{8})/i)?.[1] || null;
  const len  = startT.find(l => /LENGTH/i.test(l))?.match(/LENGTH ([0-9A-F]+)/i)?.[1] || '—';

  const disp = _splitLines(await _tpfCmd('ZTEST DISPLAY')).map(_stripMsgId);
  const psw  = disp.find(l => /PSW:/i.test(l))?.match(/PSW:\s*([0-9A-F]{8})\s+([0-9A-F]{8})/i);
  const regs = [];
  for (const l of disp) {
    const m = l.match(/GPR\s+\d+-\d+\s*:\s*([0-9A-F]{8})\s+([0-9A-F]{8})\s+([0-9A-F]{8})\s+([0-9A-F]{8})/i);
    if (m) regs.push(m[1], m[2], m[3], m[4]);
  }
  const cycNote = disp.find(l => /CYC-0826/i.test(l)) || null;

  let stepLine = null, bpHit = null;
  if (base) {
    const bpAddr = (parseInt(base, 16) + 8).toString(16).toUpperCase().padStart(8, '0');
    await _tpfCmd(`ZTEST BP,${bpAddr}`);
    stepLine = _splitLines(await _tpfCmd('ZTEST STEP')).map(_stripMsgId).find(l => /EXECUTED:/i.test(l)) || null;
    const goT = _splitLines(await _tpfCmd('ZTEST GO')).map(_stripMsgId);
    bpHit = goT.find(l => /BREAKPOINT REACHED/i.test(l)) || goT.find(l => /RAN TO COMPLETION/i.test(l)) || null;
  }

  let dump = [];
  if (base) {
    dump = _splitLines(await _tpfCmd(`ZTEST STOR,${base},32`)).map(_stripMsgId)
      .filter(l => /^[0-9A-F]{8}\s+[0-9A-F]{2}\s/i.test(l)).slice(0, 4);
  }

  await _tpfCmd('ZTEST STOP');

  const regRows = [];
  for (let i = 0; i < regs.length; i += 4) {
    regRows.push(`<tr>
      <td class="tpf-dim">R${i}-R${i + 3}</td>
      <td class="tpf-mono">${regs.slice(i, i + 4).map(esc).join(' ')}</td>
    </tr>`);
  }

  _setResults(`
    <div class="tpf-result-hdr">ENTRY POINT DEBUGGER — ${esc(target)}</div>
    <div class="tpf-priv-result tpf-priv-critical">
      <div class="tpf-priv-role">ZTEST debugger attached to a privileged handler from an operator session</div>
      <div class="tpf-priv-risk">ZTEST beyond ENTRY is a live debugger — registers, breakpoints, single-step, storage — and it is not privilege-gated. Console reach equals debugger reach on privileged code.</div>
    </div>
    <table class="tpf-table" style="margin-top:8px">
      <tbody>
        <tr><td class="tpf-dim">LOADED AT</td><td class="tpf-mono">${esc(base || '—')}</td></tr>
        <tr><td class="tpf-dim">LENGTH</td><td class="tpf-mono">${esc(len)}</td></tr>
        ${psw ? `<tr><td class="tpf-dim">PSW</td><td class="tpf-mono">${esc(psw[1])} ${esc(psw[2])}</td></tr>` : ''}
        ${stepLine ? `<tr><td class="tpf-dim">STEPPED</td><td class="tpf-mono">${esc(stepLine)}</td></tr>` : ''}
        ${bpHit ? `<tr><td class="tpf-dim">RESUMED</td><td class="tpf-mono">${esc(bpHit)}</td></tr>` : ''}
      </tbody>
    </table>
    ${regRows.length ? `<table class="tpf-table" style="margin-top:6px">
      <thead><tr><th>REGISTERS</th><th>VALUE</th></tr></thead>
      <tbody>${regRows.join('')}</tbody>
    </table>` : ''}
    ${dump.length ? `<div class="tpf-result-note" style="padding:4px 8px">STORAGE @ ${esc(base)}</div>
    <table class="tpf-table"><tbody>${dump.map(l => `<tr><td class="tpf-mono">${esc(l)}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="tpf-result-note">${cycNote
      ? `DISPLAY also surfaced the seeded incident marker: ${esc(cycNote)}`
      : 'Debug session opened and closed cleanly (ZTEST STOP issued).'}</div>
  `);
}

// ── Tool: Hardening Audit ────────────────────────────────────────────────
// Sweeps the four surfaces a z/TPF training lab is usually left exposed on:
// internet daemons (ZINET), CRAS console/terminal routing (ZCRAS), the
// command authorization matrix (ZAUTH), and the POSIX account files
// (ZFILE cat /etc/passwd, /etc/shadow). Every finding is a config leftover,
// not a live incident.
export async function tpfHardeningAudit() {
  if (!_detected) return;
  _setResults('<div class="tpf-running">Hardening sweep — ZINET / ZCRAS / ZAUTH / /etc/passwd / /etc/shadow…</div>');

  const inet   = _splitLines(await _tpfCmd('ZINET DISPLAY')).map(_stripMsgId);
  const cras   = _splitLines(await _tpfCmd('ZCRAS DISPLAY')).map(_stripMsgId);
  const auth   = _splitLines(await _tpfCmd('ZAUTH DISPLAY')).map(_stripMsgId);
  const passwd = _splitLines(await _tpfCmd('ZFILE cat /etc/passwd')).map(_stripMsgId);
  const shadow = _splitLines(await _tpfCmd('ZFILE cat /etc/shadow')).map(_stripMsgId);

  const F = [];  // { area, item, sev, detail }

  // ZINET — daemons with weak or no authentication
  for (const l of inet) {
    const m = l.match(/^([A-Z]+)\s+(\d+)\s+(ACTIVE|INACTIVE)\s+\S+\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    const [, name, port, , iauth, tls] = m;
    if (iauth === 'ANONYMOUS')  F.push({ area: 'ZINET', item: `${name}:${port}`, sev: 'CRITICAL', detail: 'accepts ANONYMOUS logins — disable anon access in the ZINET config' });
    else if (iauth === 'NONE')  F.push({ area: 'ZINET', item: `${name}:${port}`, sev: 'HIGH',     detail: `no authentication${tls === 'NO' ? ' and no TLS' : ''} — require auth or stop the daemon` });
    else if (tls === 'NO')      F.push({ area: 'ZINET', item: `${name}:${port}`, sev: 'MEDIUM',   detail: 'password auth over cleartext — enable TLS or move to SSH' });
  }

  // ZCRAS — network-reachable alternate CRAS, and restricted-command routing
  for (const l of cras) {
    let m = l.match(/^(?:PRIME|ALT)\s+(\S+)\s+(\S+)\s+(?:YES|NO)\b/);
    if (m && /TCP/i.test(m[2])) F.push({ area: 'ZCRAS', item: m[1], sev: 'HIGH', detail: `alternate CRAS on line ${m[2]} — an operator console reachable from the network` });
    m = l.match(/^(POOL\d+)\s+(\S+)\s+\d+\s+(YES|NO)\b/);
    if (m && m[3] === 'YES' && m[2] !== 'ADMIN') F.push({ area: 'ZCRAS', item: `${m[1]} (${m[2]})`, sev: 'HIGH', detail: 'terminal pool routes restricted operator commands for a non-admin class' });
  }

  // ZAUTH — restricted commands reachable from a non-admin terminal class
  for (const l of auth) {
    const m = l.match(/^(Z[A-Z]+)\s+([A-Z].*?)\s*\*?$/);
    if (!m) continue;
    if (!['ZFILE', 'ZDCP', 'ZLOGP', 'ZSTOP', 'ZEND'].includes(m[1])) continue;
    const bad = m[2].trim().split(/\s+/).filter(c => c !== 'ADMIN' && c !== 'AGENT');
    if (bad.length) F.push({ area: 'ZAUTH', item: m[1], sev: 'HIGH', detail: `authorized for ${bad.join(', ')} — restrict to ADMIN in the UUSR exit` });
  }

  // POSIX — demo accounts, login shells, weak/absent password hashes
  const demo   = /^(tpfuser|guest|test|admin)$/;
  const shells = {};
  for (const l of passwd) {
    const m = l.match(/^(\w+):x:\d+:\d+::[^:]*:(\S+)/);
    if (m) shells[m[1]] = m[2];
  }
  for (const l of shadow) {
    const m = l.match(/^(\w+):([^:]*):/);
    if (!m) continue;
    const [, user, hash] = m;
    const login = shells[user] && shells[user] !== '/bin/false' && shells[user] !== '/sbin/nologin';
    if (hash === '')                       F.push({ area: '/etc/shadow', item: user, sev: 'CRITICAL', detail: 'no password field at all — passwordless login if the account is reachable' });
    else if (hash.startsWith('$1$') && demo.test(user)) F.push({ area: '/etc/shadow', item: user, sev: 'HIGH', detail: `demo account with a weak MD5 hash${login ? ' and a login shell' : ''} — remove the account` });
    else if (demo.test(user) && login)    F.push({ area: '/etc/passwd', item: user, sev: 'MEDIUM', detail: `demo account with login shell ${shells[user]} — set /sbin/nologin or remove` });
  }

  const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  F.sort((a, b) => (SEV[a.sev] ?? 9) - (SEV[b.sev] ?? 9) || a.area.localeCompare(b.area));
  const critHigh = F.filter(f => f.sev === 'CRITICAL' || f.sev === 'HIGH').length;

  _setResults(`
    <div class="tpf-result-hdr">z/TPF HARDENING AUDIT — ${F.length} FINDING${F.length === 1 ? '' : 'S'}</div>
    <table class="tpf-table">
      <thead><tr><th>AREA</th><th>ITEM</th><th>SEV</th><th>DETAIL</th></tr></thead>
      <tbody>
        ${F.map(f => `
          <tr class="${(f.sev === 'CRITICAL' || f.sev === 'HIGH') ? 'tpf-warn-row' : ''}">
            <td class="tpf-mono tpf-dim">${esc(f.area)}</td>
            <td class="tpf-mono">${esc(f.item)}</td>
            <td class="${(f.sev === 'CRITICAL' || f.sev === 'HIGH') ? 'tpf-warn' : 'tpf-dim'}">${f.sev}</td>
            <td class="tpf-dim">${esc(f.detail)}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="tpf-dim">No findings — all four surfaces are locked down.</td></tr>'}
      </tbody>
    </table>
    <div class="tpf-result-note">${F.length
      ? `${critHigh} critical/high. Config leftovers, not a live incident: anonymous daemons, a network-reachable CRAS, restricted commands reachable from a student terminal class, and demo accounts with real password hashes.`
      : 'ZINET, CRAS routing, the ZAUTH matrix, and the POSIX account files are all clean.'}</div>
  `);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _setResults(html) {
  const content = document.getElementById('tpfResultsContent');
  const panel   = document.getElementById('tpfResults');
  if (content) content.innerHTML = html;
  if (panel)   panel.style.display = html ? '' : 'none';
}

function _clearResults() {
  _setResults('');
  _privLevel = 0;
  state.tpfEcbList = null;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.tpfOnScreen      = tpfOnScreen;
window.tpfEnumEcbs      = tpfEnumEcbs;
window.tpfScanPriv      = tpfScanPriv;
window.tpfProbeEntries  = tpfProbeEntries;
window.tpfCheckPools    = tpfCheckPools;
window.tpfSysDiag       = tpfSysDiag;
window.tpfDebugEntry    = tpfDebugEntry;
window.tpfHardeningAudit = tpfHardeningAudit;
