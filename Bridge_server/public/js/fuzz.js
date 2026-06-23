import { state } from './state.js';
import { saveAs } from './utils.js';

const FUZZ_ORDERS = [
  { label: 'SF  0x1D — Start Field',          byte: 0x1D },
  { label: 'SFE 0x29 — Start Field Extended', byte: 0x29 },
  { label: 'SBA 0x11 — Set Buffer Address',   byte: 0x11 },
  { label: 'SA  0x28 — Set Attribute',        byte: 0x28 },
  { label: 'IC  0x13 — Insert Cursor',        byte: 0x13 },
  { label: 'RA  0x3C — Repeat to Address',    byte: 0x3C },
  { label: 'EUA 0x12 — Erase Unprotected',    byte: 0x12 },
  { label: 'MF  0x2C — Modify Field',         byte: 0x2C },
  { label: 'PT  0x05 — Program Tab',          byte: 0x05 },
  { label: 'IAC 0xFF — Telnet escape',        byte: 0xFF },
  { label: 'NUL 0x00 — Null byte',            byte: 0x00 },
];

const FUZZ_SBA_CASES = [
  { label: 'addr 0x0000 — zero',              hi: 0x00, lo: 0x00 },
  { label: 'addr 0x3FFF — max 14-bit',        hi: 0x3F, lo: 0xFF },
  { label: 'addr 0xFFFF — all bits set',      hi: 0xFF, lo: 0xFF },
  { label: 'addr 0x8000 — high bit set',      hi: 0x80, lo: 0x00 },
  { label: 'addr 0xC000 — both top bits',     hi: 0xC0, lo: 0x00 },
  { label: 'addr 0x4000 — 12-bit encoding',   hi: 0x40, lo: 0x00 },
  { label: 'addr 0x7E7F — EBCDIC boundary',   hi: 0x7E, lo: 0x7F },
];

let _fuzzRunning  = false;
let _fuzzAborted  = false;
let _fuzzResults  = [];
let _fuzzResultCb = null;

export function fuzzOnResult(msg) {
  if (_fuzzResultCb) {
    const cb = _fuzzResultCb;
    _fuzzResultCb = null;
    cb(msg);
  }
}

function _fuzzWaitResult(ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { _fuzzResultCb = null; reject(new Error('result timeout')); }, ms);
    _fuzzResultCb = msg => { clearTimeout(t); resolve(msg); };
  });
}

function _fuzzSend(label, rawBytes, timeoutMs) {
  const s = state.sessions.get(state.activeSession);
  if (!s || s.ws.readyState !== WebSocket.OPEN) throw new Error('No active session');
  s.ws.send(JSON.stringify({ type: 'sec.fuzz', label, rawBytes, timeoutMs }));
}

function _fuzzSetStatus(msg) {
  const el = document.getElementById('fuzzStatus');
  if (el) el.textContent = msg;
}

function _fuzzCursorBytes() {
  const cols = (state.liveScreen && state.liveScreen.cols) || 80;
  const addr = state.cursorRow * cols + state.cursorCol;
  return [(addr >> 8) & 0x3F, addr & 0xFF];
}

function _buildAidSweepPacket(aidByte) {
  return [aidByte, 0x00, 0x00];
}

function _buildFieldOverflowPacket(fieldAddr, length, pattern) {
  const ENTER = 0x7D, SBA = 0x11;
  const addrHi = (fieldAddr >> 8) & 0x3F;
  const addrLo  = fieldAddr & 0xFF;
  let payload;
  if (pattern === 'null') payload = new Array(length).fill(0x00);
  else if (pattern === 'ff') payload = new Array(length).fill(0xFF);
  else payload = Array.from({ length }, (_, i) => 0xC1 + (i % 26));
  const [cHi, cLo] = _fuzzCursorBytes();
  return [ENTER, cHi, cLo, SBA, addrHi, addrLo, ...payload];
}

function _buildOrderInjectPacket(fieldAddr, orderByte) {
  const ENTER = 0x7D, SBA = 0x11;
  const addrHi = (fieldAddr >> 8) & 0x3F;
  const addrLo  = fieldAddr & 0xFF;
  const [cHi, cLo] = _fuzzCursorBytes();
  return [ENTER, cHi, cLo, SBA, addrHi, addrLo, orderByte, 0x40, 0x40, 0x40, 0x40];
}

function _buildSbaMutationPacket(mutHi, mutLo) {
  const ENTER = 0x7D, SBA = 0x11;
  const [cHi, cLo] = _fuzzCursorBytes();
  return [ENTER, cHi, cLo, SBA, mutHi, mutLo, 0x40];
}

async function _runAidSweep() {
  const startEl   = document.getElementById('fuzzAidStart');
  const endEl     = document.getElementById('fuzzAidEnd');
  const timeoutEl = document.getElementById('fuzzTimeout');
  const delayEl   = document.getElementById('fuzzDelay');
  const start   = Math.max(0,   Math.min(255, parseInt(startEl?.value  || '0',   16)));
  const end     = Math.max(0,   Math.min(255, parseInt(endEl?.value    || 'FF',  16)));
  const timeout = parseInt(timeoutEl?.value || '3000', 10) || 3000;
  const delay   = parseInt(delayEl?.value   || '200',  10) || 200;

  for (let b = start; b <= end; b++) {
    if (_fuzzAborted) break;
    const label = `AID 0x${b.toString(16).padStart(2,'0').toUpperCase()}`;
    _fuzzSetStatus(`[${b - start + 1}/${end - start + 1}] ${label}`);
    _fuzzSend(label, _buildAidSweepPacket(b), timeout);
    const result = await _fuzzWaitResult(timeout + 1000);
    _fuzzResults.push(result);
    _fuzzRenderResults();
    if (result.response === 'disconnect') { _fuzzSetStatus(`Disconnect on ${label} — stopped`); break; }
    await new Promise(r => setTimeout(r, delay));
  }
}

async function _runFieldOverflow() {
  const addrEl    = document.getElementById('fuzzFieldAddr');
  const lenEl     = document.getElementById('fuzzOverflowLen');
  const patEl     = document.getElementById('fuzzOverflowPattern');
  const timeoutEl = document.getElementById('fuzzTimeout');
  const fieldAddr = parseInt(addrEl?.value  || '415', 10);
  const length    = Math.min(parseInt(lenEl?.value || '100', 10), 4096);
  const pattern   = patEl?.value || 'alpha';
  const timeout   = parseInt(timeoutEl?.value || '3000', 10) || 3000;

  const label = `Overflow addr=${fieldAddr} len=${length} pat=${pattern}`;
  _fuzzSetStatus(label);
  _fuzzSend(label, _buildFieldOverflowPacket(fieldAddr, length, pattern), timeout);
  const result = await _fuzzWaitResult(timeout + 1000);
  _fuzzResults.push(result);
  _fuzzRenderResults();
}

async function _runOrderInject() {
  const addrEl    = document.getElementById('fuzzOrderFieldAddr');
  const orderEl   = document.getElementById('fuzzOrderByte');
  const timeoutEl = document.getElementById('fuzzTimeout');
  const delayEl   = document.getElementById('fuzzDelay');
  const fieldAddr = parseInt(addrEl?.value || '415', 10);
  const timeout   = parseInt(timeoutEl?.value || '3000', 10) || 3000;
  const delay     = parseInt(delayEl?.value  || '200',  10) || 200;

  const specific = orderEl?.value !== '' ? parseInt(orderEl.value, 16) : null;
  const toRun    = specific !== null
    ? [{ label: `Order 0x${specific.toString(16).toUpperCase()} in field ${fieldAddr}`, byte: specific }]
    : FUZZ_ORDERS.map(o => ({ ...o, label: `${o.label} → field ${fieldAddr}` }));

  for (let i = 0; i < toRun.length; i++) {
    if (_fuzzAborted) break;
    const { label, byte } = toRun[i];
    _fuzzSetStatus(`[${i+1}/${toRun.length}] ${label}`);
    _fuzzSend(label, _buildOrderInjectPacket(fieldAddr, byte), timeout);
    const result = await _fuzzWaitResult(timeout + 1000);
    _fuzzResults.push(result);
    _fuzzRenderResults();
    if (result.response === 'disconnect') { _fuzzSetStatus(`Disconnect on ${label} — stopped`); break; }
    await new Promise(r => setTimeout(r, delay));
  }
}

async function _runSbaMutation() {
  const timeoutEl = document.getElementById('fuzzTimeout');
  const delayEl   = document.getElementById('fuzzDelay');
  const timeout   = parseInt(timeoutEl?.value || '3000', 10) || 3000;
  const delay     = parseInt(delayEl?.value   || '200',  10) || 200;

  for (let i = 0; i < FUZZ_SBA_CASES.length; i++) {
    if (_fuzzAborted) break;
    const { label, hi, lo } = FUZZ_SBA_CASES[i];
    _fuzzSetStatus(`[${i+1}/${FUZZ_SBA_CASES.length}] ${label}`);
    _fuzzSend(label, _buildSbaMutationPacket(hi, lo), timeout);
    const result = await _fuzzWaitResult(timeout + 1000);
    _fuzzResults.push(result);
    _fuzzRenderResults();
    if (result.response === 'disconnect') { _fuzzSetStatus(`Disconnect on ${label} — stopped`); break; }
    await new Promise(r => setTimeout(r, delay));
  }
}

export async function startFuzz() {
  if (_fuzzRunning) return;
  const mode = (document.getElementById('fuzzMode') || {}).value || 'aidSweep';

  _fuzzRunning = true;
  _fuzzAborted = false;
  _fuzzResults = [];
  _fuzzRenderResults();

  document.getElementById('fuzzStartBtn').style.display = 'none';
  document.getElementById('fuzzStopBtn').style.display  = '';

  try {
    switch (mode) {
      case 'aidSweep':     await _runAidSweep();     break;
      case 'fieldOverflow':await _runFieldOverflow(); break;
      case 'orderInject':  await _runOrderInject();   break;
      case 'sbaMutation':  await _runSbaMutation();   break;
    }
  } catch (err) {
    _fuzzSetStatus('Error: ' + err.message);
  }

  _fuzzRunning = false;
  document.getElementById('fuzzStartBtn').style.display = '';
  document.getElementById('fuzzStopBtn').style.display  = 'none';

  const counts = { screen: 0, 'no-response': 0, disconnect: 0, error: 0 };
  _fuzzResults.forEach(r => { if (counts[r.response] !== undefined) counts[r.response]++; });
  if (!_fuzzAborted) {
    _fuzzSetStatus(
      `Done — ${_fuzzResults.length} sent · screen:${counts.screen} · no-resp:${counts['no-response']} · disc:${counts.disconnect} · err:${counts.error}`
    );
  }
}

export function stopFuzz() {
  _fuzzAborted  = true;
  _fuzzRunning  = false;
  _fuzzResultCb = null;
  _fuzzSetStatus('Stopped');
  document.getElementById('fuzzStartBtn').style.display = '';
  document.getElementById('fuzzStopBtn').style.display  = 'none';
}

export function fuzzModeChanged() {
  const mode = (document.getElementById('fuzzMode') || {}).value;
  document.querySelectorAll('.fuzz-mode-cfg').forEach(el => el.style.display = 'none');
  const active = document.getElementById('fuzzCfg_' + mode);
  if (active) active.style.display = '';
}

export function fuzzExportCsv() {
  if (!_fuzzResults.length) return;
  const rows = [
    ['#', 'label', 'response', 'raw_hex'],
    ..._fuzzResults.map((r, i) => [
      i + 1, r.label, r.response,
      (r.rawBytes || []).map(b => b.toString(16).padStart(2,'0')).join(' '),
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, `fuzz-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
}

function _fuzzRenderResults() {
  const el = document.getElementById('fuzzResultsTable');
  if (!el) return;
  if (!_fuzzResults.length) { el.innerHTML = ''; return; }
  const C = { screen: '#3a9a6a', 'no-response': '#777', disconnect: '#e06060', error: '#e0a060' };
  const esc = window.esc ?? (s => String(s));
  const rows = _fuzzResults.slice(-50);
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:4px">' +
    '<tr style="color:var(--text-muted)">' +
    '<th style="text-align:left;padding:2px 3px;font-weight:normal">#</th>' +
    '<th style="text-align:left;padding:2px 3px;font-weight:normal">Label</th>' +
    '<th style="text-align:left;padding:2px 3px;font-weight:normal">Response</th></tr>' +
    rows.map((r, i) => {
      const c = C[r.response] || '#777';
      const n = _fuzzResults.length - rows.length + i + 1;
      return `<tr>` +
        `<td style="padding:2px 3px;color:#555">${n}</td>` +
        `<td style="padding:2px 3px;color:#aaa;font-family:'IBM Plex Mono',monospace;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.label)}">${esc(r.label)}</td>` +
        `<td style="padding:2px 3px;color:${c};font-weight:700">${esc(r.response)}</td></tr>`;
    }).join('') + '</table>' +
    (_fuzzResults.length > 50 ? `<div style="font-size:9px;color:#555;margin-top:2px">Showing last 50 of ${_fuzzResults.length}</div>` : '');
}

Object.assign(window, { fuzzOnResult, startFuzz, stopFuzz, fuzzModeChanged, fuzzExportCsv });
