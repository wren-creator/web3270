import { esc, saveAs, exportFindingsJson } from './utils.js';
import { buildIbmiReconRows, buildIbmiReconServerRows, buildIbmiReconFactRows } from './ibmirecon-rows.js';

// ── IBM i Host Server Recon ─────────────────────────────────────────────
// Standalone, read-only network check against an operator-named host, not
// tied to an open terminal session. One POST to /api/ibmi-recon does the
// work (features/ibmi-recon.js). No credential is asked for and none is
// sent: the probe only talks to the server mapper and the sign-on server.

let _lastResult = null;

const VERDICT_COLOR = { FINDING: '#e06060', INCONCLUSIVE: '#e0a060', SECURE: '#3a6a3a' };
const SEVERITY_COLOR = { CRITICAL: '#ff4040', FINDING: '#e06060', INFO: '#6a8aaa' };

function _reconStatus(msg) {
  const el = document.getElementById('ibmiReconStatus');
  if (el) el.textContent = msg;
}

function _table(rows, header) {
  if (!rows.length) return '';
  const cells = header
    ? `<tr>${rows[0].map(h => `<th style="text-align:left;color:#6a8aaa;font-weight:600;padding:1px 8px 1px 0">${esc(h)}</th>`).join('')}</tr>`
    : '';
  const body = (header ? rows.slice(1) : rows).map(r =>
    `<tr>${r.map(v => `<td style="color:#aaa;padding:1px 8px 1px 0">${esc(v)}</td>`).join('')}</tr>`).join('');
  return `<table style="font-size:10px;border-collapse:collapse;margin:4px 0">${cells}${body}</table>`;
}

async function startIbmiRecon() {
  const host = document.getElementById('ibmiReconHost')?.value.trim();
  const mapperPort = parseInt(document.getElementById('ibmiReconPort')?.value, 10) || 449;
  const banner = !!document.getElementById('ibmiReconBanner')?.checked;
  const out = document.getElementById('ibmiReconOut');
  const btn = document.getElementById('ibmiReconBtn');

  if (!host) { _reconStatus('Host is required.'); return; }

  if (btn) btn.disabled = true;
  _reconStatus(`Reading ${host} (server mapper ${mapperPort}${banner ? ', with sign-on screen' : ''})…`);
  if (out) out.innerHTML = '';

  try {
    const res = await fetch('/api/ibmi-recon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, mapperPort, banner }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    _lastResult = data;
    const c = VERDICT_COLOR[data.verdict] || '#333';
    if (out) {
      const facts = buildIbmiReconFactRows(data);
      const servers = buildIbmiReconServerRows(data);
      out.innerHTML =
        `<div style="padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${c};border-radius:2px">` +
        `<div style="font-size:10px;font-weight:700;color:${c};margin-bottom:4px">${esc(data.verdict)}</div>` +
        (facts.length ? _table(facts, false) : '') +
        (servers.length > 1 ? _table(servers, true) : '') +
        data.findings.map(f =>
          `<div style="font-size:10px;color:#aaa;margin-bottom:3px"><span style="color:${SEVERITY_COLOR[f.severity] || '#888'};font-weight:700">${esc(f.severity)}</span> ${esc(f.text)}</div>`
        ).join('') +
        `</div>`;
    }
    _reconStatus(`${host}, ${data.verdict}`);
  } catch (err) {
    _reconStatus('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function ibmiReconExportCsv() {
  if (!_lastResult) return;
  const rows = buildIbmiReconRows(_lastResult);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `ibmi-recon-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function ibmiReconExportJson() {
  if (!_lastResult) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('ibmi-host-server-recon', buildIbmiReconRows(_lastResult), `ibmi-recon-${ts}.json`);
}

Object.assign(window, { startIbmiRecon, ibmiReconExportCsv, ibmiReconExportJson });
