'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zl = require('./zvm-linux');

const run = (cmd, user, roster) => {
  const gs = zl.newGuestState();
  return zl.handleGuestCommand(cmd, user, zl.LINUX_GUESTS[user]?.classes || 'G', gs, roster);
};

test('class G guest is refused the gated queries, over-privileged guest is not', () => {
  assert.match(run('INDICATE LOAD', 'LNXGST01'), /HCPCQF040E.*class E/);
  assert.match(run('QUERY SRM', 'LNXGST01'), /HCPCQF040E/);
  assert.match(run('INDICATE LOAD', 'LNXGST02'), /AVGPROC/);
  assert.match(run('q srm', 'LNXGST02'), /IABIAS/);
});

test('commands this module does not own return null', () => {
  assert.equal(run('QUERY PRIVCLASS', 'LNXGST01'), null);
  assert.equal(run('LINK MAINT 190 200 RR', 'LNXGST01'), null);
});

test('spool punch needs a target first, then lands in the target reader', () => {
  const gs = zl.newGuestState();
  assert.match(zl.handleGuestCommand('PUNCH CANARY', 'LNXGST01', 'G', gs), /HCPPUN031E/);
  zl.handleGuestCommand('SPOOL PUNCH TO MAINT', 'LNXGST01', 'G', gs);
  assert.match(zl.handleGuestCommand('PUNCH CANARY', 'LNXGST01', 'G', gs), /RDR FILE \d{4} SENT FROM LNXGST01/);
  assert.equal(zl.RDR_QUEUES.MAINT.at(-1).name, 'CANARY');
});

test('class G sees its own reader, not another user\'s', () => {
  assert.match(run('QUERY RDR ALL', 'LNXGST01'), /WELCOME/);
  assert.match(run('QUERY RDR ALL USER MAINT', 'LNXGST01'), /HCPQRD040E/);
});

test('SEND CP is gated, SET SECUSER only redirects the caller', () => {
  assert.match(run('SEND CP MAINT QUERY TIME', 'LNXGST01'), /HCPSEN040E/);
  assert.match(run('SEND CP MAINT QUERY TIME', 'LNXGST02'), /command sent/);
  const gs = zl.newGuestState();
  zl.handleGuestCommand('SET SECUSER LNXGST02', 'LNXGST01', 'G', gs);
  assert.equal(gs.secuser, 'LNXGST02');
});

test('vswitch access list is class-gated; the plain query is not', () => {
  assert.doesNotMatch(run('QUERY VSWITCH', 'LNXGST01'), /Authorized/);
  assert.match(run('QUERY VSWITCH VSW1 ACCESSLIST', 'LNXGST01'), /HCPQVS040E/);
  assert.match(run('QUERY VSWITCH VSW1 ACCESSLIST', 'LNXGST02'), /Authorized users/);
});

test('vswitch and vmlan queries answer; console banner and login failure', () => {
  assert.match(run('QUERY VSWITCH', 'LNXGST01'), /Isolation Status/);
  assert.match(run('QUERY VMLAN', 'LNXGST01'), /HIPERS/);
  assert.match(zl.linuxConsoleBanner('LNXGST01'), /lnxgst01 login:/);
  assert.match(zl.linuxLoginResponse('LNXGST01', 'root'), /Login incorrect/);
});
