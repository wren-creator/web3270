import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { execFileSync } from 'child_process';
import tls from 'tls';
import { auditSmapi } from './smapi-audit.js';

const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

test('closed port reports closed; plaintext listener reports open with tls false', async () => {
  const plain = net.createServer(s => s.on('error', () => {}));
  const port = await listen(plain);
  const free = net.createServer(); const freePort = await listen(free); await new Promise(r => free.close(r));
  const { results } = await auditSmapi({ host: '127.0.0.1', ports: [port, freePort], timeoutMs: 800 });
  plain.close();
  assert.deepEqual([results[0].state, results[0].tls], ['open', false]);
  assert.equal(results[1].state, 'closed');
});

test('TLS listener reports tls true with protocol', async t => {
  let key, cert;
  try {
    const out = execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', '/dev/stdout', '-subj', '/CN=localhost', '-days', '1'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    key = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/.exec(out)?.[0];
    cert = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(out)?.[0];
  } catch { /* no openssl */ }
  if (!key || !cert) return t.skip('openssl unavailable');
  const srv = tls.createServer({ key, cert }, s => s.on('error', () => {}));
  const port = await listen(srv);
  const { results } = await auditSmapi({ host: '127.0.0.1', ports: [port], timeoutMs: 2000 });
  srv.close();
  assert.equal(results[0].tls, true); assert.match(results[0].protocol, /TLS/);
});
