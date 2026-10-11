import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkScope, scopeStatus, inCidr, hostMatches, auditAction } from './scope.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'));
  process.env.BRIDGE_SCOPE_FILE = path.join(dir, 'scope.json');
  process.env.BRIDGE_SCOPE_AUDIT = path.join(dir, 'audit.log');
});
afterEach(() => {
  delete process.env.BRIDGE_SCOPE_FILE; delete process.env.BRIDGE_SCOPE_AUDIT;
  fs.rmSync(dir, { recursive: true, force: true });
});
const write = obj => fs.writeFileSync(process.env.BRIDGE_SCOPE_FILE, typeof obj === 'string' ? obj : JSON.stringify(obj));
const auditLines = () => fs.existsSync(process.env.BRIDGE_SCOPE_AUDIT)
  ? fs.readFileSync(process.env.BRIDGE_SCOPE_AUDIT, 'utf8').trim().split('\n').map(JSON.parse) : [];
const noDns = async () => { throw new Error('ENOTFOUND'); };

test('no scope.json: guard is off, everything allowed, nothing logged', async () => {
  const r = await checkScope('host', 'anything.example.com');
  assert.equal(r.allowed, true); assert.equal(r.guard, 'off');
  assert.deepEqual(auditLines(), []);
  assert.deepEqual(scopeStatus(), { guard: 'off' });
});

test('scope.json as a directory (Docker bind of a missing file) counts as off', async () => {
  fs.mkdirSync(process.env.BRIDGE_SCOPE_FILE);
  assert.equal((await checkScope('host', 'x.example.com')).guard, 'off');
});

test('malformed scope.json fails closed', async () => {
  write('{ not json');
  const r = await checkScope('host', 'zvm1.example.com');
  assert.equal(r.allowed, false); assert.match(r.reason, /unreadable/);
});

test('host: exact, wildcard, and CIDR matching', async () => {
  write({ hosts: ['zvm1.example.com', '*.lab.example.com'], cidrs: ['10.20.0.0/16'] });
  const ok = async h => (await checkScope('host', h, { resolve: noDns })).allowed;
  assert.equal(await ok('zvm1.example.com'), true);
  assert.equal(await ok('ZVM1.Example.com'), true);
  assert.equal(await ok('a.lab.example.com'), true);
  assert.equal(await ok('lab.example.com'), false);          // bare suffix is not under the wildcard
  assert.equal(await ok('evil-lab.example.com'), false);
  assert.equal(await ok('10.20.5.9'), true);
  assert.equal(await ok('10.21.0.1'), false);
  assert.equal(await ok('other.example.com'), false);
});

test('host: unlisted name resolving into scope is allowed only if every record is in range', async () => {
  write({ cidrs: ['10.20.0.0/16'] });
  const inRange  = async () => [{ address: '10.20.1.1' }, { address: '10.20.2.2' }];
  const mixed    = async () => [{ address: '10.20.1.1' }, { address: '8.8.8.8' }];
  assert.equal((await checkScope('host', 'h.example.com', { resolve: inRange })).allowed, true);
  assert.equal((await checkScope('host', 'h.example.com', { resolve: mixed })).allowed, false);
});

test('engagement window: before, inside, after', async () => {
  write({ hosts: ['h.example.com'], windowStart: '2026-10-12T00:00:00Z', windowEnd: '2026-10-30T00:00:00Z' });
  const at = iso => checkScope('host', 'h.example.com', { now: Date.parse(iso) });
  assert.match((await at('2026-10-01T00:00:00Z')).reason, /not opened/);
  assert.equal((await at('2026-10-15T00:00:00Z')).allowed, true);
  assert.match((await at('2026-11-01T00:00:00Z')).reason, /closed/);
});

test('bad window date fails closed', async () => {
  write({ hosts: ['h.example.com'], windowEnd: 'next tuesday' });
  assert.equal((await checkScope('host', 'h.example.com')).allowed, false);
});

test('guest check is case-insensitive and list-bound', async () => {
  write({ guests: ['LNXGST01'] });
  assert.equal((await checkScope('guest', 'lnxgst01')).allowed, true);
  assert.equal((await checkScope('guest', 'MAINT')).allowed, false);
});

test('activities: intrusive ones need explicit naming, even with no list', async () => {
  write({ hosts: ['h.example.com'] });
  assert.equal((await checkScope('activity', 'cp-privclass')).allowed, true);
  assert.equal((await checkScope('activity', 'hipersockets-sweep')).allowed, false);
  write({ activities: ['hipersockets-sweep'] });
  assert.equal((await checkScope('activity', 'hipersockets-sweep')).allowed, true);
  assert.equal((await checkScope('activity', 'cp-privclass')).allowed, false); // list present = only what is named
});

test('every decision is audited when the guard is on, with engagement and verdict', async () => {
  write({ engagement: 'T-1', hosts: ['h.example.com'] });
  await checkScope('host', 'h.example.com', { source: '1.2.3.4' });
  await checkScope('host', 'nope.example.com', { source: '1.2.3.4', resolve: noDns });
  auditAction('sec.fuzz', { wsId: 7 });
  const l = auditLines();
  assert.equal(l.length, 3);
  assert.equal(l[0].allowed, true); assert.equal(l[0].engagement, 'T-1');
  assert.equal(l[1].allowed, false); assert.equal(l[1].target, 'nope.example.com');
  assert.equal(l[2].action, 'sec.fuzz');
});

test('helpers', () => {
  assert.equal(inCidr('10.0.0.5', '10.0.0.0/24'), true);
  assert.equal(inCidr('10.0.1.5', '10.0.0.0/24'), false);
  assert.equal(inCidr('1.2.3.4', '0.0.0.0/0'), true);
  assert.equal(inCidr('300.1.1.1', '10.0.0.0/8'), false);
  assert.equal(hostMatches('a.b.com', '*.b.com'), true);
});
