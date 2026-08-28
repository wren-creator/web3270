// ESM Fingerprint panel — passive display of the server-side classifier.
// The bridge is authoritative: it pushes `esm.fingerprint` messages whenever
// the verdict moves. This module just renders them and offers reset/export.
import { state } from './state.js';
import { saveAs } from './utils.js';

let _verdict = null; // last { product, confidence, runnerUp, scores, evidence, firstSeen }

const PRODUCT_COLOR = {
  RACF: '#cc5a5a', ACF2: '#e07840', TopSecret: '#d0b84a', unknown: '#666',
};

// Called from profiles.js for both `screen` (ignored — server-authoritative)
// and `esm.fingerprint` (the verdict push).
export function esmFingerprintOnScreen(msg) {
  if (!msg || msg.type !== 'esm.fingerprint') return;
  _verdict = msg;
  _render();
}

export function esmFingerprintReset() {
  _send({ type: 'sec.esm.reset' });
}

export function esmFingerprintExport() {
  if (!_verdict || !_verdict.evidence?.length) return;
  const rows = [['screen', 'row', 'col', 'product', 'kind', 'weight', 'matched', 'rule', 'timestamp']];
  for (const e of _verdict.evidence) {
    rows.push([
      e.screenSeq, e.row, e.col, e.product, e.kind, e.weight,
      e.matched, e.ruleId, new Date(e.ts).toISOString(),
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }),
    `esm-fingerprint-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function _send(obj) {
  const s = state.sessions.get(state.activeSession);
  if (!s || !s.ws || s.ws.readyState !== WebSocket.OPEN) return;
  s.ws.send(JSON.stringify(obj));
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _render() {
  const el = document.getElementById('esmFpBody');
  if (!el) return;

  if (!_verdict || _verdict.product === 'unknown') {
    el.innerHTML =
      '<div style="color:var(--text-muted);font-size:10px;padding:4px 0">' +
      'No external security manager identified yet. Connect and reach a logon or ' +
      'error screen.</div>';
    return;
  }

  const v = _verdict;
  const pct = Math.round((v.confidence || 0) * 100);
  const color = PRODUCT_COLOR[v.product] || '#999';

  const bar =
    `<div style="height:6px;border-radius:3px;background:#2a3547;overflow:hidden;margin:4px 0">` +
    `<div style="height:100%;width:${pct}%;background:${color}"></div></div>`;

  const evidence = (v.evidence || []).slice().reverse().map(e =>
    `<tr>` +
    `<td style="padding:2px 4px;color:#666">${e.screenSeq}</td>` +
    `<td style="padding:2px 4px;color:#666">${e.row},${e.col}</td>` +
    `<td style="padding:2px 4px;color:${PRODUCT_COLOR[e.product] || '#999'}">${_esc(e.product)}</td>` +
    `<td style="padding:2px 4px;color:#777">${_esc(e.kind)}</td>` +
    `<td style="padding:2px 4px;color:#999;font-family:'IBM Plex Mono',monospace;font-size:9px">${_esc(e.matched)}</td>` +
    `<td style="padding:2px 4px;color:#555;font-size:9px">${_esc(e.ruleId)}</td>` +
    `</tr>`
  ).join('');

  el.innerHTML =
    `<div style="display:flex;align-items:baseline;gap:8px">` +
      `<span style="font-weight:700;color:${color};font-size:13px">${_esc(v.product)}</span>` +
      `<span style="color:var(--text-muted);font-size:10px">${pct}% confidence</span>` +
      (v.runnerUp ? `<span style="color:#555;font-size:9px">vs ${_esc(v.runnerUp)}</span>` : '') +
    `</div>` +
    bar +
    `<div style="color:#666;font-size:9px;margin-bottom:4px">scores — ` +
      Object.entries(v.scores || {}).map(([p, s]) => `${p}:${s}`).join('  ') + `</div>` +
    (evidence
      ? `<table style="width:100%;border-collapse:collapse;font-size:10px">` +
        `<tr style="color:var(--text-muted)">` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">SCR</th>` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">R,C</th>` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">PROD</th>` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">KIND</th>` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">MATCHED</th>` +
        `<th style="text-align:left;padding:2px 4px;font-weight:normal">RULE</th></tr>` +
        evidence + `</table>`
      : '');
}

Object.assign(window, { esmFingerprintOnScreen, esmFingerprintReset, esmFingerprintExport });
