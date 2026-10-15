'use strict';
// Mock IBM i FTP server (the QTCP FTP server a real IBM i runs on 21, with
// implicit TLS on 990). Started from mock-as400.js, sharing its user profiles
// and credentials, so the Default Credential Audit and the FTP Service Audit
// see the same accounts.
//
// A loose shop on purpose, so the audit has something to find:
//   - clear text sign-on is accepted (USER is answered 331 before any TLS)
//   - explicit TLS is offered (AUTH TLS) but not required
//   - implicit TLS on the TLS port is off unless MOCK_AS400_FTP_IMPLICIT=1
//   - anonymous sign-on is refused unless MOCK_AS400_FTP_ANON=1
//   - any enabled profile with the right password can sign on, browse the
//     libraries and the IFS, and sees the OS release in SYST. Nothing limits
//     it, which is what an unregistered FTP exit point looks like from outside.
// MOCK_AS400_FTP_REQUIRE_TLS=1 models CHGFTPA-style "TLS only": USER is
// refused until the session is secure.
//
// Read-only by construction: there is no STOR, DELE, MKD, RMD, RNFR or RCMD
// handler. RCMD is listed in HELP, as a real server does, and refused if sent.
// Every command received is kept in ctx.seen so tests can prove the audit
// never sent anything it should not.
//
// Throwaway cert for the TLS port is the same one the HTTP admin mock uses.

const net = require('net');
const tls = require('tls');
const fs = require('fs');

const LIBRARIES = ['APPLIB', 'HRLIB', 'MYLIB', 'PAYROLL', 'QGPL', 'QSYS', 'QTEMP', 'TOOLLIB'];
const LIBRARY_OBJECTS = {
  QGPL: ['QBATCH      *JOBQ', 'QDFTJOBD    *JOBD', 'QPRINT      *OUTQ'],
  PAYROLL: ['EMPMAST     *FILE', 'PAYHIST     *FILE', 'PAYRPTQ     *OUTQ'],
};
const IFS_ROOT = ['QSYS.LIB', 'QOpenSys', 'QDLS', 'home', 'www', 'tmp'];

const MAX_LINE = 1024;
const IDLE_MS = 30000;

function makeContext({ sysname, usrprfs, credentials, log, env = process.env }) {
  return {
    sysname, usrprfs, credentials, log: log || (() => {}),
    osLevel: env.MOCK_AS400_OSLEVEL || 'V7R4M0',
    anon: env.MOCK_AS400_FTP_ANON === '1',
    requireTls: env.MOCK_AS400_FTP_REQUIRE_TLS === '1',
    offerTls: env.MOCK_AS400_FTP_NOTLS !== '1',
    tlsOpts: null,
    seen: [],           // every command line received, for tests
    fails: new Map(),   // profile -> failed sign-ons, for the log only
  };
}

function reply(sock, code, text) {
  // A multi-line reply uses "code-" on every line but the last.
  const lines = String(text).split('\n');
  sock.write(lines.map((l, i) => `${code}${i === lines.length - 1 ? ' ' : '-'}${l}`).join('\r\n') + '\r\n');
}

function listLines(names, isDir) {
  return names.map(n => `${isDir ? 'drwxrwsrwx' : '-rwxrwxrwx'}   1 QSYS            0         4096 Oct 14 08:00 ${n}`).join('\r\n') + '\r\n';
}

// One control connection. socket may be a plain socket or a TLS socket, and
// AUTH TLS swaps it for a TLS one in place.
function session(rawSocket, ctx, { secure = false } = {}) {
  let sock = rawSocket;
  const st = { secure, user: null, authed: false, anonymous: false, namefmt: 0, cwd: 'QGPL', pasv: null, buf: '' };
  sock.setTimeout(IDLE_MS, () => { try { reply(sock, 421, 'Timeout, closing connection.'); } catch {} sock.destroy(); });

  reply(sock, 220, `QTCP at ${ctx.sysname}.\nConnection will close if idle more than 5 minutes.`);

  const needLogin = () => { reply(sock, 530, 'Log in with USER and PASS first.'); };

  function pasvOpen(then) {
    if (st.pasv) { try { st.pasv.server.close(); } catch {} st.pasv = null; }
    const server = net.createServer();
    server.on('connection', ds => { if (st.pasv && st.pasv.server === server) st.pasv.sock = ds; });
    server.listen(0, '0.0.0.0', () => {
      const p = server.address().port;
      st.pasv = { server, port: p, sock: null, send: null };
      then(p);
    });
    server.on('error', () => {});
  }

  function sendData(text) {
    if (!st.pasv) { reply(sock, 425, 'Use PASV first.'); return; }
    const p = st.pasv; st.pasv = null;
    reply(sock, 150, 'Opening data connection.');
    const finish = ds => { ds.end(text); ds.on('close', () => { try { p.server.close(); } catch {} }); reply(sock, 226, 'Transfer complete.'); };
    if (p.sock) finish(p.sock); else p.server.once('connection', finish);
  }

  function cmdLine(line) {
    ctx.seen.push(line);
    const m = /^(\S+)(?:\s+(.*))?$/.exec(line.trim());
    if (!m) { reply(sock, 500, 'Command not understood.'); return; }
    const cmd = m[1].toUpperCase(); const arg = (m[2] || '').trim();

    switch (cmd) {
      case 'USER':
        if (ctx.requireTls && !st.secure) { reply(sock, 534, 'Policy requires SSL/TLS before sign-on.'); return; }
        st.user = arg; st.authed = false; st.anonymous = false;
        reply(sock, 331, `Enter password.`); return;
      case 'PASS': {
        if (!st.user) { reply(sock, 503, 'Send USER first.'); return; }
        const u = st.user.toUpperCase();
        if (ctx.anon && /^(anonymous|ftp)$/i.test(st.user)) {
          st.authed = true; st.anonymous = true; reply(sock, 230, `${st.user} logged on.`); return;
        }
        const p = ctx.usrprfs.find(x => x.name === u);
        const ok = p && p.status === '*ENABLED' && ctx.credentials[u] !== undefined && ctx.credentials[u] === arg;
        if (ok) { st.authed = true; reply(sock, 230, `${u} logged on.`); return; }
        ctx.fails.set(u, (ctx.fails.get(u) || 0) + 1);
        ctx.log(`FTP: failed sign-on for ${u} (${ctx.fails.get(u)})`);
        reply(sock, 530, `Log on attempt by user ${u} rejected.`); return;
      }
      case 'AUTH':
        if (!ctx.offerTls || !ctx.tlsOpts) { reply(sock, 502, 'AUTH not supported.'); return; }
        if (!/^TLS(-C)?$|^SSL$/i.test(arg)) { reply(sock, 504, 'Security mechanism not supported.'); return; }
        if (st.secure) { reply(sock, 503, 'Already secure.'); return; }
        reply(sock, 234, 'Security environment established - ready for negotiation.');
        upgrade(); return;
      case 'PBSZ': reply(sock, 200, 'PBSZ=0'); return;
      case 'PROT':
        if (/^C$/i.test(arg)) reply(sock, 200, 'Data channel protection level set to clear.');
        else reply(sock, 536, 'Only PROT C is supported by this mock.');
        return;
      case 'FEAT':
        reply(sock, 211, ['Extensions supported:', ...(ctx.offerTls ? [' AUTH TLS', ' PBSZ', ' PROT'] : []), ' NAMEFMT', 'END'].join('\n')); return;
      case 'SYST':
        if (!st.authed) { needLogin(); return; }
        reply(sock, 215, `OS/400 is the remote operating system. The TCP/IP version is "${ctx.osLevel}".`); return;
      case 'NOOP': reply(sock, 200, 'OK.'); return;
      case 'TYPE': reply(sock, 200, `Representation type is ${arg || 'A'}.`); return;
      case 'HELP':
        if (!st.authed) { needLogin(); return; }
        reply(sock, 214, 'The following commands are recognized:\nUSER PASS AUTH PBSZ PROT SYST FEAT PWD CWD NAMEFMT TYPE PASV LIST NLST HELP NOOP QUIT\nSite commands: RCMD (run a CL command), ADDLIBLE, DLTF\nEnd of help.'); return;
      case 'NAMEFMT':
        if (!st.authed) { needLogin(); return; }
        if (arg === '0') { st.namefmt = 0; st.cwd = 'QGPL'; }
        else if (arg === '1') { st.namefmt = 1; st.cwd = '/'; }
        else { reply(sock, 501, 'NAMEFMT 0 or 1.'); return; }
        reply(sock, 250, `Now using naming format "${st.namefmt}".`); return;
      case 'PWD':
        if (!st.authed) { needLogin(); return; }
        reply(sock, 257, st.namefmt === 0 ? `"${st.cwd}" is current library.` : `"${st.cwd}" is current directory.`); return;
      case 'CWD':
        if (!st.authed) { needLogin(); return; }
        if (st.namefmt === 1) {
          if (arg === '/' || arg === '/QSYS.LIB' || /^\/QSYS\.LIB\/[A-Z0-9]+\.LIB$/.test(arg)) { st.cwd = arg; reply(sock, 250, `Current directory changed to ${arg}.`); }
          else reply(sock, 550, `${arg} not found.`);
        } else if (LIBRARIES.includes(arg.toUpperCase())) { st.cwd = arg.toUpperCase(); reply(sock, 250, `Library ${st.cwd} is current library.`); }
        else reply(sock, 550, `Library ${arg} not found.`);
        return;
      case 'PASV':
        if (!st.authed) { needLogin(); return; }
        pasvOpen(p => reply(sock, 227, `Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255}).`)); return;
      case 'LIST': case 'NLST': {
        if (!st.authed) { needLogin(); return; }
        let text;
        if (st.namefmt === 1) {
          if (st.cwd === '/') text = listLines(IFS_ROOT, true);
          else if (st.cwd === '/QSYS.LIB') text = listLines(LIBRARIES.map(l => `${l}.LIB`), true);
          else text = listLines(['(objects in this library)'], false);
        } else {
          text = (LIBRARY_OBJECTS[st.cwd] || ['(no objects listed)']).join('\r\n') + '\r\n';
        }
        sendData(text); return;
      }
      case 'QUIT': reply(sock, 221, 'Goodbye.'); sock.end(); return;
      default:
        // STOR, DELE, MKD, RMD, RNFR, RCMD and everything else: refused, and
        // recorded in ctx.seen above.
        reply(sock, cmd === 'RCMD' ? 502 : 500, cmd === 'RCMD' ? 'RCMD is not allowed by this mock.' : 'Command not understood.');
    }
  }

  function onData(chunk) {
    st.buf += chunk.toString('latin1');
    if (st.buf.length > MAX_LINE * 4) { sock.destroy(); return; }
    let i;
    while ((i = st.buf.indexOf('\n')) !== -1) {
      const line = st.buf.slice(0, i).replace(/\r$/, ''); st.buf = st.buf.slice(i + 1);
      if (line.length > MAX_LINE) { reply(sock, 500, 'Line too long.'); continue; }
      cmdLine(line);
    }
  }

  function upgrade() {
    const plain = sock;
    plain.removeAllListeners('data');
    const secureSock = new tls.TLSSocket(plain, { isServer: true, ...ctx.tlsOpts });
    secureSock.on('error', () => secureSock.destroy());
    secureSock.setTimeout(IDLE_MS, () => secureSock.destroy());
    sock = secureSock; st.secure = true; st.buf = '';
    sock.on('data', onData);
  }

  sock.on('data', onData);
  sock.on('error', () => {});
  sock.on('close', () => { if (st.pasv) { try { st.pasv.server.close(); } catch {} } });
}

function plainServer(ctx) {
  return net.createServer(s => session(s, ctx, { secure: false }));
}
function implicitServer(ctx) {
  return tls.createServer(ctx.tlsOpts, s => session(s, ctx, { secure: true }));
}

function loadCert(env) {
  const keyPath = env.MOCK_AS400_HTTPADMIN_KEY || '/app/certs/key.pem';
  const certPath = env.MOCK_AS400_HTTPADMIN_CERT || '/app/certs/cert.pem';
  try { return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }; } catch { return null; }
}

function start({ sysname, usrprfs, credentials, log, env = process.env }) {
  const ctx = makeContext({ sysname, usrprfs, credentials, log, env });
  ctx.tlsOpts = loadCert(env);
  // The real ports are 21 and 990. A container user cannot bind below 1024, so
  // the mock listens on 2121 and 2990 and the audit is pointed at those.
  const port = parseInt(env.MOCK_AS400_FTP_PORT || '2121', 10);
  const tlsPort = parseInt(env.MOCK_AS400_FTP_TLS_PORT || '2990', 10);
  plainServer(ctx).listen(port, '0.0.0.0', () => {
    ctx.log(`Mock IBM i FTP listening on 0.0.0.0:${port}` +
      (ctx.requireTls ? ' [TLS required]' : ' [clear text accepted]') + (ctx.anon ? ' [anonymous on]' : ''));
  });
  if (env.MOCK_AS400_FTP_IMPLICIT === '1' && ctx.tlsOpts) {
    implicitServer(ctx).listen(tlsPort, '0.0.0.0', () => ctx.log(`Mock IBM i FTP (implicit TLS) listening on 0.0.0.0:${tlsPort}`));
  }
  return ctx;
}

module.exports = { start, makeContext, plainServer, implicitServer, session, LIBRARIES };
