import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import ha from '../mock-lpar/mock-as400-httpadmin.js';
import { auditHttpAdmin } from './http-admin-audit.js';

const USRPRFS = [{ name: 'JSMITH', status: '*ENABLED', pwdNone: false, text: 'Accounting', specialAuth: [], pwdChg: '07/02/26' }];
const CREDS = { JSMITH: 'Summer2026' };

function startMock(env) {
  const ctx = ha.makeContext({ sysname: 'T', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env });
  return new Promise(resolve => {
    const srv = http.createServer(ha.listener(ctx)).listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const closed = srv => new Promise(r => srv.close(r));
const texts = r => r.findings.map(f => f.text).join('\n');

test('reports the cleartext console and flags the missing fix when unpatched', async () => {
  const srv = await startMock({ MOCK_AS400_OSLEVEL: 'V7R4M0' });
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'Summer2026' },
    });
    assert.equal(r.verdict, 'FINDING');
    assert.match(texts(r), /cleartext port/);
    assert.match(texts(r), /V7R4M0/);
    assert.match(texts(r), /fix for CVE-2026-96119 is not installed/);
    assert.equal(r.facts.httpServer, 'IBM HTTP Server for i');
  } finally { await closed(srv); }
});

test('patched box: no missing-fix finding', async () => {
  const srv = await startMock({ MOCK_AS400_HTTPADMIN_PATCHED: '1', MOCK_AS400_OSLEVEL: 'V7R4M0' });
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'Summer2026' },
    });
    assert.doesNotMatch(texts(r), /not installed/);
    assert.match(texts(r), /fix reported as SJ11643/);
  } finally { await closed(srv); }
});

test('without credentials it never reads the About page', async () => {
  const srv = await startMock({});
  try {
    const r = await auditHttpAdmin({ host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1 });
    assert.equal(r.facts.osLevel, undefined);
    assert.doesNotMatch(texts(r), /About page/);
  } finally { await closed(srv); }
});

test('a wrong password is reported, not retried', async () => {
  const srv = await startMock({});
  try {
    const r = await auditHttpAdmin({
      host: '127.0.0.1', httpPort: srv.address().port, tlsPort: 1,
      auth: { user: 'JSMITH', pass: 'nope' },
    });
    assert.match(texts(r), /returned HTTP 401/);
  } finally { await closed(srv); }
});

test('nothing listening gives INCONCLUSIVE', async () => {
  const r = await auditHttpAdmin({ host: '127.0.0.1', httpPort: 1, tlsPort: 1 });
  assert.equal(r.verdict, 'INCONCLUSIVE');
});
