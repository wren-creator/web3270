// Pure row builder for the HTTP Admin GUI Audit exports. No DOM, no
// imports, so node --test can load it. The result object comes from
// POST /api/http-admin-audit and never contains the supplied password.
export const HTTP_ADMIN_AUDIT_HEADER = ['host', 'verdict', 'severity', 'finding'];

export function buildHttpAdminAuditRows(result) {
  const rows = [HTTP_ADMIN_AUDIT_HEADER];
  if (!result) return rows;
  for (const f of result.findings || []) {
    rows.push([result.host, result.verdict, f.severity, f.text]);
  }
  return rows;
}
