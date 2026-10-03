import { esc, saveAs, exportFindingsJson } from './utils.js';

// ── SSH No-Credential Access Checker ────────────────────────────────────
// Standalone network probe against an operator-named host, not tied to any
// open terminal session. One POST to /api/ssh-audit does the real work
// (features/ssh-audit.js): a single 'none'-auth attempt, then — only if
// the server tells us it offers password auth — a single empty-password
// attempt for the named account. SECURE/FINDING/INCONCLUSIVE, same
// severity vocabulary the rest of the security tools use.

let _sshHosts = [];
let _lastResult = null;

async function sshAuditLoadHosts() {
  try {
    const res = await fetch('/api/ssh-hosts');
    _sshHosts = await res.json();
    const sel = document.getElementById('sshAuditHostSelect');
    if (!sel) return;
    const placeholder = '<option value="">— Pick a saved host, or type one below —</option>';
    sel.innerHTML = placeholder + _sshHosts.map(h =>
      `<option value="${esc(h.id)}" data-host="${esc(h.host)}" data-port="${h.port}" data-user="${esc(h.user)}">${esc(h.name)} (${esc(h.host)})</option>`
    ).join('');
  } catch (e) {
    console.warn('sshaudit: could not load ssh-hosts.txt', e);
  }
}

function sshAuditHostChanged() {
  const sel = document.getElementById('sshAuditHostSelect');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  const hostEl = document.getElementById('sshAuditHost');
  const portEl = document.getElementById('sshAuditPort');
  const userEl = document.getElementById('sshAuditUser');
  if (hostEl) hostEl.value = opt.dataset.host || '';
  if (portEl) portEl.value = opt.dataset.port || '22';
  if (userEl && opt.dataset.user) userEl.value = opt.dataset.user;
}

function _sshAuditStatus(msg) {
  const el = document.getElementById('sshAuditStatus');
  if (el) el.textContent = msg;
}

const VERDICT_COLOR = { FINDING: '#e06060', INCONCLUSIVE: '#e0a060', SECURE: '#3a6a3a' };

async function startSshAudit() {
  const host     = document.getElementById('sshAuditHost')?.value.trim();
  const port     = parseInt(document.getElementById('sshAuditPort')?.value, 10) || 22;
  const username = document.getElementById('sshAuditUser')?.value.trim();
  const out  = document.getElementById('sshAuditOut');
  const btn  = document.getElementById('sshAuditBtn');

  if (!host || !username) {
    _sshAuditStatus('Host and username are both required.');
    return;
  }

  if (btn) btn.disabled = true;
  _sshAuditStatus(`Probing ${username}@${host}:${port}…`);
  if (out) out.innerHTML = '';

  try {
    const res = await fetch('/api/ssh-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, username }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    _lastResult = data;
    const c = VERDICT_COLOR[data.verdict] || '#333';
    if (out) {
      out.innerHTML =
        `<div style="padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${c};border-radius:2px">` +
        `<div style="font-size:10px;font-weight:700;color:${c};margin-bottom:4px">${esc(data.verdict)}</div>` +
        data.findings.map(f => `<div style="font-size:10px;color:#aaa;margin-bottom:2px">${esc(f)}</div>`).join('') +
        `</div>`;
    }
    _sshAuditStatus(`${username}@${host}:${port} — ${data.verdict}`);
  } catch (err) {
    _sshAuditStatus('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _buildSshAuditRows() {
  if (!_lastResult) return [['host', 'port', 'username', 'verdict', 'finding']];
  const rows = [['host', 'port', 'username', 'verdict', 'finding']];
  for (const f of _lastResult.findings) {
    rows.push([_lastResult.host, _lastResult.port, _lastResult.username, _lastResult.verdict, f]);
  }
  return rows;
}

function sshAuditExportCsv() {
  if (!_lastResult) return;
  const rows = _buildSshAuditRows();
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `ssh-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

function sshAuditExportJson() {
  if (!_lastResult) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('ssh-no-credential-access-checker', _buildSshAuditRows(), `ssh-audit-${ts}.json`);
}

Object.assign(window, {
  sshAuditLoadHosts, sshAuditHostChanged, startSshAudit, sshAuditExportCsv, sshAuditExportJson,
});
