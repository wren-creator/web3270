import { esc, saveAs, exportFindingsJson } from './utils.js';
import { buildHttpAdminAuditRows } from './httpadminaudit-rows.js';

// ── HTTP Admin GUI Audit (IBM i) ────────────────────────────────────────
// Standalone, read-only network check against an operator-named host, not
// tied to an open terminal session. One POST to /api/http-admin-audit does
// the work (features/http-admin-audit.js). The optional profile and
// password are sent once for that request, and are never kept in page
// state, localStorage, or the exports.

let _lastResult = null;

const VERDICT_COLOR = { FINDING: '#e06060', INCONCLUSIVE: '#e0a060', SECURE: '#3a6a3a' };
const SEVERITY_COLOR = { FINDING: '#e06060', INFO: '#6a8aaa' };

function _httpAdminStatus(msg) {
  const el = document.getElementById('httpAdminAuditStatus');
  if (el) el.textContent = msg;
}

async function startHttpAdminAudit() {
  const host     = document.getElementById('httpAdminAuditHost')?.value.trim();
  const httpPort = parseInt(document.getElementById('httpAdminAuditHttpPort')?.value, 10) || 2001;
  const tlsPort  = parseInt(document.getElementById('httpAdminAuditTlsPort')?.value, 10) || 2010;
  const userEl   = document.getElementById('httpAdminAuditUser');
  const passEl   = document.getElementById('httpAdminAuditPass');
  const out = document.getElementById('httpAdminAuditOut');
  const btn = document.getElementById('httpAdminAuditBtn');

  if (!host) {
    _httpAdminStatus('Host is required.');
    return;
  }
  const username = userEl?.value.trim() || '';
  const password = passEl?.value || '';
  if ((username && !password) || (!username && password)) {
    _httpAdminStatus('Give both a profile and a password, or neither.');
    return;
  }

  if (btn) btn.disabled = true;
  _httpAdminStatus(`Checking ${host} (${httpPort}/${tlsPort})…`);
  if (out) out.innerHTML = '';

  try {
    const res = await fetch('/api/http-admin-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, httpPort, tlsPort, username, password }),
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
    _httpAdminStatus(`${host}, ${data.verdict}`);
  } catch (err) {
    _httpAdminStatus('Error: ' + err.message);
  } finally {
    // The password is cleared as soon as the request is done.
    if (passEl) passEl.value = '';
    if (btn) btn.disabled = false;
  }
}

function httpAdminAuditExportCsv() {
  if (!_lastResult) return;
  const rows = buildHttpAdminAuditRows(_lastResult);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `http-admin-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function httpAdminAuditExportJson() {
  if (!_lastResult) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('http-admin-gui-audit', buildHttpAdminAuditRows(_lastResult), `http-admin-audit-${ts}.json`);
}

Object.assign(window, { startHttpAdminAudit, httpAdminAuditExportCsv, httpAdminAuditExportJson });
