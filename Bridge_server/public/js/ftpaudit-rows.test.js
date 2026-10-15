import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFtpAuditRows, FTP_AUDIT_HEADER } from './ftpaudit-rows.js';

test('no result gives just the header', () => {
  assert.deepEqual(buildFtpAuditRows(null), [FTP_AUDIT_HEADER]);
});

test('one row per finding, carrying host, verdict and severity', () => {
  const rows = buildFtpAuditRows({
    host: '10.0.0.5', verdict: 'FINDING',
    findings: [
      { severity: 'CRITICAL', text: 'anonymous works' },
      { severity: 'INFO', text: 'banner' },
    ],
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['10.0.0.5', 'FINDING', 'CRITICAL', 'anonymous works']);
  assert.deepEqual(rows[2], ['10.0.0.5', 'FINDING', 'INFO', 'banner']);
});
