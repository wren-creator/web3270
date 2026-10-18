// Pure row builders for the IBM i Host Server Recon panel and its exports.
// No DOM, no imports, so node --test can load it. The result comes from
// POST /api/ibmi-recon; it carries no credential because none is ever sent.
export const IBMI_RECON_HEADER = ['host', 'verdict', 'severity', 'finding'];
export const IBMI_RECON_SERVER_HEADER = ['server', 'plain port', 'TLS port'];

export function buildIbmiReconRows(result) {
  const rows = [IBMI_RECON_HEADER];
  if (!result) return rows;
  for (const f of result.findings || []) {
    rows.push([result.host, result.verdict, f.severity, f.text]);
  }
  return rows;
}

// One row per host server the mapper named, in the order it was asked.
// A server the mapper did not name at all is left out, not shown as closed:
// the mapper not knowing a name says nothing about the port.
export function buildIbmiReconServerRows(result) {
  const rows = [IBMI_RECON_SERVER_HEADER];
  const servers = (result && result.facts && result.facts.servers) || {};
  for (const [label, s] of Object.entries(servers)) {
    if (!s || (!s.plain && !s.secure)) continue;
    rows.push([`as-${label}`, s.plain ? String(s.plain) : 'none', s.secure ? String(s.secure) : 'none']);
  }
  return rows;
}

// What the sign-on server said, as label and value pairs.
export function buildIbmiReconFactRows(result) {
  const f = (result && result.facts) || {};
  const rows = [];
  if (f.osVersion) rows.push(['OS release', f.osVersion]);
  if (f.passwordLevel !== undefined) rows.push(['Password level (QPWDLVL)', String(f.passwordLevel)]);
  if (f.serverJob) rows.push(['Sign-on server job', f.serverJob]);
  if (f.tlsProtocol) rows.push(['Sign-on TLS', f.tlsProtocol]);
  return rows;
}
