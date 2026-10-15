// Pure row builder for the FTP Service Audit exports. No DOM, no imports, so
// node --test can load it. The result object comes from POST /api/ftp-audit
// and never contains the supplied password.
export const FTP_AUDIT_HEADER = ['host', 'verdict', 'severity', 'finding'];

export function buildFtpAuditRows(result) {
  const rows = [FTP_AUDIT_HEADER];
  if (!result) return rows;
  for (const f of result.findings || []) {
    rows.push([result.host, result.verdict, f.severity, f.text]);
  }
  return rows;
}
