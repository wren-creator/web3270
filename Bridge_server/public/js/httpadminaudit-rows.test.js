import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHttpAdminAuditRows, HTTP_ADMIN_AUDIT_HEADER } from './httpadminaudit-rows.js';

test('no result gives just the header', () => {
  assert.deepEqual(buildHttpAdminAuditRows(null), [HTTP_ADMIN_AUDIT_HEADER]);
});

test('one row per finding, carrying host, verdict and severity', () => {
  const rows = buildHttpAdminAuditRows({
    host: '10.0.0.5', verdict: 'FINDING',
    findings: [
      { severity: 'FINDING', text: 'cleartext port' },
      { severity: 'INFO', text: 'server banner' },
    ],
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['10.0.0.5', 'FINDING', 'FINDING', 'cleartext port']);
  assert.deepEqual(rows[2], ['10.0.0.5', 'FINDING', 'INFO', 'server banner']);
});

test('a password can never appear in the rows', () => {
  const rows = buildHttpAdminAuditRows({
    host: 'h', verdict: 'SECURE', password: 'hunter2', username: 'JSMITH',
    findings: [{ severity: 'INFO', text: 'ok' }],
  });
  assert.doesNotMatch(JSON.stringify(rows), /hunter2|JSMITH/);
});
