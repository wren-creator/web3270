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
  const lines = text.split('\n').map(l => l.trim());

  const ecbs = [];
  let inTable = false;
  for (const line of lines) {
    if (/ZTPF200I/.test(line)) { inTable = true; continue; }
    if (/ZTPF202I/.test(line)) { inTable = false; continue; }
    if (inTable) {
      const m = line.match(/^([A-Z]{4,8})\s+(APPL|SYSTEM)\s+(ACTIVE|IDLE|STOPPED)\s+(\d+)\s+([\d,]+)/);
      if (m) ecbs.push({ name: m[1], type: m[2], status: m[3], entries: m[4], txn: m[5], priv: line.includes('[PRIV]') });
    }
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
  const lines = text.split('\n').map(l => l.trim());

  const pools = [];
  for (const line of lines) {
    const m = line.match(/^(ECBPOOL|FPOOL|GPOOL|IPOOL|TPOOL|XPOOL)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
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
