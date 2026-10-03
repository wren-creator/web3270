import { saveAs, exportFindingsJson } from './utils.js';

// ── VTAM-Operator Pool/Session Dashboard ────────────────────────────────────
// Aggregates the live sessions Map by LPAR (no new /api/pool route needed —
// every field this needs is already exposed: /api/sessions for state and
// the poolRejected flag, /api/negotiate for the LU requested/granted split
// routes/negotiate.js already computes, /api/profiles to match a session's
// host:port back to its LPAR id/name, the same matching key the bridge
// itself uses server-side (PROFILE_BY_HOST_PORT in handlers/ws.js), since a
// session only ever carries host/port, not a profile id). Manual refresh,
// matching the TN3270E Negotiation Analyzer's own UX, whose card styling
// this panel reuses directly.

let _poolData = []; // [{ id, name, count, max, severity, rejectedCount, sessions: [...] }]

function _poolStatus(msg) {
  const el = document.getElementById('poolStatus');
  if (el) el.textContent = msg;
}

export async function poolRefresh() {
  if (window.location.protocol === 'file:') { _poolStatus('Not available in file mode'); return; }
  try {
    _poolStatus('Fetching…');
    const [sessions, negotiate, profiles, limits] = await Promise.all(
      ['/api/sessions', '/api/negotiate', '/api/profiles', '/api/pool-limits'].map(u => fetch(u).then(r => r.json()))
    );

    const negByWsId = new Map(negotiate.map(n => [n.wsId, n]));
    const profileByHostPort = new Map(profiles.map(p => [`${p.host}:${p.port}`, p]));

    const groups = new Map(); // lparId -> { id, name, sessions: [] }
    for (const s of sessions) {
      if (s.orphaned) continue; // a dead socket doesn't hold a real pool slot
      const prof = profileByHostPort.get(`${s.host}:${s.port}`);
      const id   = prof?.id || `${s.host}:${s.port}`;
      const name = prof?.name || s.host;
      const neg  = negByWsId.get(s.wsId) || {};
      if (!groups.has(id)) groups.set(id, { id, name, sessions: [] });
      groups.get(id).sessions.push({
        wsId: s.wsId, state: s.state, poolRejected: s.poolRejected,
        luRequested: neg.luRequested || null, lu: neg.lu || null,
      });
    }

    _poolData = [...groups.values()].map(g => {
      const limit = limits[g.id] || {};
      const max   = Number.isFinite(limit.maxSessions) ? limit.maxSessions : null;
      const count = g.sessions.length;
      const rejectedCount = g.sessions.filter(s => s.poolRejected).length;
      let severity = 'OK';
      if (rejectedCount > 0) severity = 'CRITICAL';
      else if (max != null && count >= max) severity = 'CRITICAL';
      else if (max != null && count / max >= 0.8) severity = 'WARN';
      return { ...g, max, count, rejectedCount, severity };
    }).sort((a, b) => {
      const order = { CRITICAL: 0, WARN: 1, OK: 2 };
      return (order[a.severity] - order[b.severity]) || a.name.localeCompare(b.name);
    });

    _renderPool();
    const activeCount = sessions.filter(s => !s.orphaned).length;
    _poolStatus(`${_poolData.length} LPAR${_poolData.length === 1 ? '' : 's'}, ${activeCount} active session${activeCount === 1 ? '' : 's'}`);
  } catch (err) {
    _poolStatus('Error: ' + err.message);
  }
}

const SEV_COLOR = { CRITICAL: '#e06060', WARN: '#e0a060', OK: '#3a6a3a' };

function _renderPool() {
  const el = document.getElementById('poolOut');
  if (!el) return;
  if (!_poolData.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:4px 0">No active sessions — connect to a host first, then click Refresh.</div>';
    return;
  }
  const esc = s => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  el.innerHTML = _poolData.map(g => {
    const c = SEV_COLOR[g.severity] || '#333';
    const capText = g.max != null ? `${g.count} / ${g.max}` : `${g.count} (no threshold configured)`;

    const sessionRows = g.sessions.map(s =>
      `<tr><td style="padding:2px 8px 2px 0;color:var(--text-muted);font-size:9px">#${s.wsId}</td>` +
      `<td style="padding:2px 8px 2px 0;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:9px">${esc(s.luRequested)} → ${esc(s.lu)}</td>` +
      `<td style="padding:2px 0;color:#777;font-size:9px">${esc(s.state)}${s.poolRejected ? ' <span style="color:#e06060;font-weight:700">REJECT-PATTERN MATCH</span>' : ''}</td></tr>`
    ).join('');

    return `<div style="margin-bottom:10px;padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${c};border-radius:2px">` +
      `<div style="font-size:10px;font-weight:600;color:#aaa;margin-bottom:4px">${esc(g.name)} <span style="color:${c};font-weight:700;margin-left:8px">${g.severity}</span></div>` +
      `<div style="font-size:9px;color:var(--text-muted);margin-bottom:6px">Sessions: ${capText}${g.rejectedCount ? ` · ${g.rejectedCount} reject-pattern match(es)` : ''}</div>` +
      `<table style="border-collapse:collapse;width:100%">` +
      `<tr style="color:var(--text-muted)">` +
      `<th style="text-align:left;padding:2px 8px 2px 0;font-size:9px;font-weight:normal">Sess</th>` +
      `<th style="text-align:left;padding:2px 8px 2px 0;font-size:9px;font-weight:normal">LU req → granted</th>` +
      `<th style="text-align:left;padding:2px 0;font-size:9px;font-weight:normal">State</th></tr>` +
      sessionRows +
      `</table></div>`;
  }).join('');
}

function _buildPoolRows() {
  const rows = [['lparId', 'lparName', 'count', 'max', 'severity', 'rejectedCount']];
  for (const g of _poolData) rows.push([g.id, g.name, g.count, g.max ?? '', g.severity, g.rejectedCount]);
  return rows;
}

export function poolExportCsv() {
  if (!_poolData.length) return;
  const rows = _buildPoolRows();
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `pool-dashboard-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

export function poolExportJson() {
  if (!_poolData.length) return;
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  exportFindingsJson('vtam-pool-dashboard', _buildPoolRows(), `pool-dashboard-${ts}.json`);
}

Object.assign(window, { poolRefresh, poolExportCsv, poolExportJson });
