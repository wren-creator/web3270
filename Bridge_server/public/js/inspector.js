import { state } from './state.js';

let inspectorActive   = false;
let _inspectorEl      = null;
let _inspectorFaAddr  = null;
let _inspectorCurFa   = null;

export function toggleInspector() {
  inspectorActive = !inspectorActive;
  const btn = document.getElementById('abiBtn');
  if (btn) btn.classList.toggle('sec-panel-btn-active', inspectorActive);
  if (!inspectorActive) _dismissInspector();
}

export function _decodeFa(fa) {
  const prot    = !!(fa & 0x20);
  const intens  = (fa & 0x0C) >> 2;
  const mdt     = !!(fa & 0x01);
  const numeric = !!(fa & 0x10);
  let intensLabel = 'NORMAL';
  if (intens === 2) intensLabel = 'INTENS';
  if (intens === 3) intensLabel = 'HIDDEN';
  return { prot, intens, mdt, numeric, intensLabel };
}

function _patchFa(newFa) {
  const session = state.sessions.get(state.activeSession);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  session.ws.send(JSON.stringify({ type: 'sec.patchFa', addr: _inspectorFaAddr, fa: newFa }));
  _dismissInspector();
}

export function _initInspectorListener() {
  const term = document.getElementById('terminal');
  if (!term || term.dataset.inspectorBound) return;
  term.dataset.inspectorBound = '1';
  term.addEventListener('click', e => {
    if (!inspectorActive) return;
    const cellEl = e.target.closest('.screen-cell');
    if (!cellEl) return;
    const ri = parseInt(cellEl.dataset.ri, 10);
    const ci = parseInt(cellEl.dataset.ci, 10);
    if (isNaN(ri) || isNaN(ci) || !state.liveScreen) return;
    const row  = (state.liveScreen.rows || [])[ri] || [];
    const cell = row[ci] || {};
    const cols    = state.liveScreen.cols || 80;
    const numRows = (state.liveScreen.rows || []).length;
    let fa = null, faAddr = null;
    let pos = ri * cols + ci;
    for (let i = 0; i <= numRows * cols; i++) {
      const p   = ((pos - i) + numRows * cols) % (numRows * cols);
      const r2  = Math.floor(p / cols);
      const c2  = p % cols;
      const c   = ((state.liveScreen.rows || [])[r2] || [])[c2] || {};
      if (c.fa !== undefined) { fa = c.fa; faAddr = p; break; }
    }
    const isFaCell = cell.fa !== undefined;
    if (isFaCell) { fa = cell.fa; faAddr = ri * cols + ci; }
    _showInspector(e.clientX, e.clientY, ri, ci, fa, faAddr, cell, isFaCell);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _dismissInspector(); });
  document.addEventListener('click', e => {
    if (_inspectorEl && !_inspectorEl.contains(e.target) && !e.target.closest('.screen-cell'))
      _dismissInspector();
  }, true);
}

function _showInspector(x, y, ri, ci, fa, faAddr, cell, isFaCell) {
  _dismissInspector();
  if (fa === null) return;
  _inspectorFaAddr = faAddr;
  _inspectorCurFa  = fa;
  const d      = _decodeFa(fa);
  const faHex  = '0x' + fa.toString(16).toUpperCase().padStart(2, '0');
  const faBin  = fa.toString(2).padStart(8, '0');
  const addr   = faAddr !== null ? faAddr : '?';
  const row14  = faAddr !== null ? `R${String(Math.floor(faAddr / (state.liveScreen.cols||80)) + 1).padStart(2,'0')} C${String((faAddr % (state.liveScreen.cols||80)) + 1).padStart(2,'0')}` : '?';
  const field  = (state.liveScreen.fields || []).find(f => f.startAddr === faAddr);
  const contentLen = field ? field.content.trimEnd().length : '?';
  const bit = (n, label, val) =>
    `<tr><td class="abi-bit">bit ${n}</td><td class="abi-label">${label}</td><td class="abi-val ${val ? 'abi-on' : 'abi-off'}">${val ? '1 ✓' : '0'}</td></tr>`;
  const el = document.createElement('div');
  el.className = 'attr-inspector';
  el.innerHTML = `
    <div class="abi-header">
      <span class="abi-title">Field Attribute Byte</span>
      <span class="abi-addr">${row14} · addr ${addr}</span>
      <button class="abi-close" onclick="_dismissInspector()">✕</button>
    </div>
    <div class="abi-hex">
      <span class="abi-hexval">${faHex}</span>
      <span class="abi-bin">${faBin.slice(0,2)}<b>${faBin.slice(2,4)}</b><b>${faBin[4]}</b>${faBin[5]}<b>${faBin[6]}</b><b>${faBin[7]}</b></span>
    </div>
    <table class="abi-table">
      ${bit(5, 'Protected',   d.prot)}
      ${bit(4, 'Numeric',     d.numeric)}
      <tr><td class="abi-bit">3-2</td><td class="abi-label">Intensity</td><td class="abi-val">${['NORMAL','NORMAL','INTENSIFIED','NONDISPLAY'][d.intens]}</td></tr>
      <tr><td class="abi-bit">1</td><td class="abi-label">Reserved</td><td class="abi-val abi-off">—</td></tr>
      ${bit(0, 'MDT (modified)', d.mdt)}
    </table>
    <div class="abi-footer">
      <span class="${d.prot ? 'abi-tag-prot' : 'abi-tag-unprot'}">${d.prot ? 'PROTECTED' : 'UNPROTECTED'}</span>
      ${d.numeric     ? '<span class="abi-tag-num">NUMERIC</span>' : ''}
      ${d.intens === 3 ? '<span class="abi-tag-hidden">NONDISPLAY</span>' : ''}
      ${d.intens === 2 ? '<span class="abi-tag-intens">INTENSIFIED</span>' : ''}
      ${d.mdt         ? '<span class="abi-tag-mdt">MDT SET</span>' : ''}
      <span class="abi-len">content: ${contentLen} chars</span>
    </div>
    <div class="abi-mutations">
      <span class="abi-mut-label" title="Mutations write directly to the bridge session buffer. The host is not notified — changes persist until the host redraws this field.">MUTATE FA →</span>
      <button class="abi-mut-btn abi-mut-prot" title="${d.prot ? 'Remove PROTECTED bit (0x20) — field becomes writable' : 'Set PROTECTED bit (0x20) — field becomes read-only'}"
              onclick="_patchFa(${fa ^ 0x20})">${d.prot ? '🔓 UNPROTECT' : '🔒 PROTECT'}</button>
      <button class="abi-mut-btn" title="${d.numeric ? 'Clear NUMERIC bit (0x10) — allow any character' : 'Set NUMERIC bit (0x10) — restrict to digits'}"
              onclick="_patchFa(${fa ^ 0x10})">${d.numeric ? 'ALPHA' : 'NUMERIC'}</button>
      ${d.intens === 3
        ? `<button class="abi-mut-btn abi-mut-reveal" title="Clear nondisplay bits (0x0C) → normal display — reveals password fields on screen"
                   onclick="_patchFa(${fa & ~0x0C})">👁 REVEAL</button>`
        : `<button class="abi-mut-btn" title="Set nondisplay bits (0x0C) — hides field content"
                   onclick="_patchFa(${(fa & ~0x0C) | 0x0C})">HIDE</button>`}
      ${d.mdt
        ? `<button class="abi-mut-btn" title="Clear MDT bit (0x01) — field will not transmit on next AID key"
                   onclick="_patchFa(${fa & ~0x01})">CLR MDT</button>`
        : `<button class="abi-mut-btn" title="Set MDT bit (0x01) — force field to transmit on next AID key even if unmodified"
                   onclick="_patchFa(${fa | 0x01})">SET MDT</button>`}
    </div>`;
  document.body.appendChild(el);
  _inspectorEl = el;
  const rect = el.getBoundingClientRect();
  let px = x + 12, py = y + 12;
  if (px + rect.width  > window.innerWidth  - 8) px = x - rect.width  - 12;
  if (py + rect.height > window.innerHeight - 8) py = y - rect.height - 12;
  el.style.left = px + 'px';
  el.style.top  = py + 'px';
}

export function _dismissInspector() {
  if (_inspectorEl) { _inspectorEl.remove(); _inspectorEl = null; }
}

Object.assign(window, { toggleInspector, _decodeFa, _initInspectorListener, _dismissInspector, _patchFa });
