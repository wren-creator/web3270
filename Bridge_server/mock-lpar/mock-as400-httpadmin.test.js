'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ha = require('./mock-as400-httpadmin');

const USRPRFS = [
  { name: 'QSECOFR',  status: '*ENABLED',  pwdNone: false, text: 'Security officer', specialAuth: ['*ALLOBJ'], pwdChg: '06/28/26' },
  { name: 'JSMITH',   status: '*ENABLED',  pwdNone: false, text: 'Accounting',       specialAuth: [],          pwdChg: '07/02/26' },
  { name: 'QSRV',     status: '*DISABLED', pwdNone: false, text: 'Service',          specialAuth: ['*ALLOBJ'], pwdChg: '01/01/24' },
  { name: 'QSYS',     status: '*DISABLED', pwdNone: true,  text: 'Internal',         specialAuth: [],          pwdChg: '*NA' },
];
const CREDS = { QSECOFR: 'QSECOFR', JSMITH: 'Summer2026', QSRV: 'QSRV' };

const ctxFor = (env = {}) => ha.makeContext({ sysname: 'T', usrprfs: USRPRFS, credentials: CREDS, log: () => {}, env });
const auth = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const get = (ctx, url, a) => ha.handle({ method: 'GET', url, headers: a ? { authorization: a } : {} }, ctx);
const post = (ctx, url, body, a) => ha.handle({ method: 'POST', url, headers: { authorization: a }, body }, ctx);
const form = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

test('unauthenticated /HTTPAdmin gets a 401 that fingerprints the server', () => {
  const r = get(ctxFor(), '/HTTPAdmin');
  assert.equal(r.status, 401);
  assert.match(r.headers['WWW-Authenticate'], /Basic realm="IBM i HTTP Server Administration"/);
  assert.equal(r.headers.Server, 'IBM HTTP Server for i');
});

test('root redirects to /HTTPAdmin', () => {
  const r = get(ctxFor(), '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, '/HTTPAdmin');
});

test('sign-in follows the profile rules: valid enabled profile only', () => {
  const ctx = ctxFor();
  assert.equal(get(ctx, '/HTTPAdmin', auth('JSMITH', 'Summer2026')).status, 200);
  assert.equal(get(ctx, '/HTTPAdmin', auth('jsmith', 'Summer2026')).status, 200, 'profile name is case-insensitive');
  assert.equal(get(ctx, '/HTTPAdmin', auth('JSMITH', 'wrong')).status, 401);
  assert.equal(get(ctx, '/HTTPAdmin', auth('QSRV', 'QSRV')).status, 401, 'disabled profile');
  assert.equal(get(ctx, '/HTTPAdmin', auth('QSYS', 'x')).status, 401, 'password *NONE profile');
  assert.equal(get(ctx, '/HTTPAdmin', auth('NOSUCH', 'x')).status, 401);
});

test('/about leaks the OS release and shows the fix as not installed when unpatched', () => {
  const r = get(ctxFor({ MOCK_AS400_OSLEVEL: 'V7R4M0' }), '/HTTPAdmin/about', auth('JSMITH', 'Summer2026'));
  assert.match(r.body, /V7R4M0/);
  assert.match(r.body, /not installed/);
});

test('unpatched: an exec directive in the description is evaluated (simulated)', () => {
  const ctx = ctxFor();
  const a = auth('JSMITH', 'Summer2026');
  const c = post(ctx, '/HTTPAdmin/servers',
    form({ name: 'PWN', description: '<!--#exec cmd="RTVJOBA"-->' }), a);
  assert.equal(c.status, 302);
  const list = get(ctx, '/HTTPAdmin/servers', a).body;
  assert.match(list, /CURRENT USER \. \. \. \. : QTMHHTTP/, 'ran as the server profile, not the signed-in user');
  assert.doesNotMatch(list, /<!--#exec/);
});

test('unpatched: DSPUSRPRF discloses profile data from the mock tables', () => {
  const ctx = ctxFor();
  const a = auth('JSMITH', 'Summer2026');
  post(ctx, '/HTTPAdmin/servers', form({ name: 'LEAK', description: '<!--#exec cmd="DSPUSRPRF QSECOFR"-->' }), a);
  assert.match(get(ctx, '/HTTPAdmin/servers', a).body, /Special authority\s+\. \. : \*ALLOBJ/);
});

test('unknown commands are refused, nothing real runs', () => {
  const out = ha.simulateCommand('rm -rf /', { usrprfs: USRPRFS });
  assert.match(out, /^CPD0030/);
});

test('patched: the same description is escaped and never evaluated', () => {
  const ctx = ctxFor({ MOCK_AS400_HTTPADMIN_PATCHED: '1', MOCK_AS400_OSLEVEL: 'V7R4M0' });
  const a = auth('JSMITH', 'Summer2026');
  post(ctx, '/HTTPAdmin/servers', form({ name: 'SAFE', description: '<!--#exec cmd="RTVJOBA"-->' }), a);
  const list = get(ctx, '/HTTPAdmin/servers', a).body;
  assert.match(list, /&lt;!--#exec cmd=&quot;RTVJOBA&quot;--&gt;/);
  assert.doesNotMatch(list, /CURRENT USER/);
  assert.match(get(ctx, '/HTTPAdmin/about', a).body, /SJ11643/);
});

test('server name is validated and duplicates are rejected', () => {
  const ctx = ctxFor();
  const a = auth('JSMITH', 'Summer2026');
  assert.equal(post(ctx, '/HTTPAdmin/servers', form({ name: '1bad', description: '' }), a).status, 400);
  assert.equal(post(ctx, '/HTTPAdmin/servers', form({ name: 'ADMIN', description: '' }), a).status, 409);
});
