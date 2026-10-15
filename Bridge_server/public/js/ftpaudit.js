import { esc, saveAs, exportFindingsJson } from './utils.js';
import { buildFtpAuditRows } from './ftpaudit-rows.js';

// ── FTP Service Audit (IBM i) ───────────────────────────────────────────
// Standalone, read-only network check against an operator-named host, not
// tied to an open terminal session. One POST to /api/ftp-audit does the
// work (features/ftp-audit.js). The optional profile and password are sent
// once for that request, and are never kept in page state, localStorage, or
// the exports.

let _lastResult = null;

const VERDICT_COLOR = { FINDING: '#e06060', INCONCLUSIVE: '#e0a060', SECURE: '#3a6a3a' };
const SEVERITY_COLOR = { CRITICAL: '#ff4040', FINDING: '#e06060', INFO: '#6a8aaa' };

function _ftpStatus(msg) {
  const el = document.getElementById('ftpAuditStatus');
  if (el) el.textContent = msg;
}

async function startFtpAudit() {
  const host    = document.getElementById('ftpAuditHost')?.value.trim();
  const port    = parseInt(document.getElementById('ftpAuditPort')?.value, 10) || 21;
  const tlsPort = parseInt(document.getElementById('ftpAuditTlsPort')?.value, 10) || 990;
  const userEl  = document.getElementById('ftpAuditUser');
  const passEl  = document.getElementById('ftpAuditPass');
  const allowCleartext = !!document.getElementById('ftpAuditClear')?.checked;
  const tryDefaults    = !!document.getElementById('ftpAuditDefaults')?.checked;
  const out = document.getElementById('ftpAuditOut');
  const btn = document.getElementById('ftpAuditBtn');

  if (!host) { _ftpStatus('Host is required.'); return; }
  const username = userEl?.value.trim() || '';
  const password = passEl?.value || '';
  if ((username && !password) || (!username && password)) {
    _ftpStatus('Give both a profile and a password, or neither.');
    return;
  }

  if (btn) btn.disabled = true;
  _ftpStatus(`Checking ${host} (${port}/${tlsPort})…`);
  if (out) out.innerHTML = '';

  try {
    const res = await fetch('/api/ftp-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, tlsPort, username, password, allowCleartext, tryDefaults }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    _lastResult = data;
    const c = VERDICT_COLOR[data.verdict] || '#333';
    if (out) {
      out.innerHTML =
        `<div style="padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${c};border-radius:2px">` +
        `<div style="font-size:10px;font-weight:700;color:${c};margin-bottom:4px">${esc(data.verdict)}</div>` +
        data.findings.map(f =>
          `<div style="font-size:10px;color:#aaa;margin-bottom:3px"><span style="color:${SEVERITY_COLOR[f.severity] || '#888'};font-weight:700">${esc(f.severity)}</span> ${esc(f.text)}</div>`
        ).join('') +
        `</div>`;
    }
    _ftpStatus(`${host}, ${data.verdict}`);
  } catch (err) {
    _ftpStatus('Error: ' + err.message);
  } finally {
    // The password is cleared as soon as the request is done.
    if (passEl) passEl.value = '';
    if (btn) btn.disabled = false;
  }
}

function ftpAuditExportCsv() {
  if (!_lastResult) return;
  const rows = buildFtpAuditRows(_lastResult);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `ftp-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function ftpAuditExportJson() {
  if (!_lastResult) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('ftp-service-audit', buildFtpAuditRows(_lastResult), `ftp-audit-${ts}.json`);
}

Object.assign(window, { startFtpAudit, ftpAuditExportCsv, ftpAuditExportJson });
