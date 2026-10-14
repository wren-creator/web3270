// HTTP Admin GUI Audit (IBM i). A read-only exposure check for the HTTP
// Server Administration GUI (IBM Web Administration for i, the ADMIN
// instance on 2001 plain / 2010 TLS). It answers the questions a defender
// asks about that console, and nothing more:
//
//   - Is it reachable from where the operator is standing at all?
//   - Does it serve the sign-in over cleartext HTTP (Basic auth in the clear)?
//   - Does the TLS port present a usable certificate, or a self-signed,
//     expired or not-yet-valid one, and on which protocol version?
//   - What does an unauthenticated request reveal (Server header, realm)?
//   - Optionally, with credentials the operator already holds, what OS
//     release and fix status does the About page report, and is the fix
//     for CVE-2026-96119 installed?
//
// It sends GETs only. It never submits a form, never touches the Create
// HTTP Server page, and tries no credential beyond the single pair the
// operator typed in. Nothing here exploits anything.
import http from 'http';
import https from 'https';

const TIMEOUT_MS = 6000;
const MAX_BODY = 64 * 1024;

function request({ host, port, tls, path = '/HTTPAdmin', auth }) {
  return new Promise(resolve => {
    const mod = tls ? https : http;
    const headers = { 'User-Agent': 'webterm-http-admin-audit' };
    if (auth) headers.Authorization = 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
    const req = mod.request({
      host, port, path, method: 'GET', headers, timeout: TIMEOUT_MS,
      // The point of the TLS check is to look at whatever cert is
      // presented, so validation is off here and judged below instead.
      ...(tls ? { rejectUnauthorized: false } : {}),
    }, res => {
      let body = '';
      res.on('data', c => { if (body.length < MAX_BODY) body += c; });
      res.on('end', () => {
        const sock = res.socket;
        const cert = tls && sock.getPeerCertificate ? sock.getPeerCertificate() : null;
        resolve({
          ok: true,
          status: res.statusCode,
          headers: res.headers,
          body,
          tlsProtocol: tls && sock.getProtocol ? sock.getProtocol() : null,
          cert: cert && cert.subject ? cert : null,
        });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', err => resolve({ ok: false, message: err.message }));
    req.end();
  });
}

function certFindings(cert, now) {
  const out = [];
  if (!cert) return out;
  const from = Date.parse(cert.valid_from);
  const to = Date.parse(cert.valid_to);
  if (Number.isFinite(to) && to < now) out.push(['FINDING', `Certificate expired ${cert.valid_to}.`]);
  else if (Number.isFinite(from) && from > now) out.push(['FINDING', `Certificate is not valid until ${cert.valid_from}.`]);
  const selfSigned = cert.issuer && cert.subject &&
    JSON.stringify(cert.issuer) === JSON.stringify(cert.subject);
  if (selfSigned) out.push(['INFO', 'Certificate is self-signed, so clients cannot verify the console they are signing in to.']);
  if (cert.bits && cert.bits < 2048) out.push(['FINDING', `Certificate key is ${cert.bits} bits, below 2048.`]);
  return out;
}

function parseAbout(body) {
  const text = String(body || '');
  const level = /OS release<\/th><td>([^<]+)</.exec(text);
  const fix = /HTTP Server Admin fix<\/th><td>([^<]+)</.exec(text);
  return {
    osLevel: level ? level[1].trim() : null,
    fix: fix ? fix[1].trim() : null,
  };
}

// Returns { verdict, findings: [{ severity, text }], facts }.
// verdict: FINDING when any finding is FINDING, INCONCLUSIVE when nothing
// answered, SECURE otherwise.
export async function auditHttpAdmin({ host, httpPort = 2001, tlsPort = 2010, auth = null, now = Date.now() }) {
  const findings = [];
  const add = (severity, text) => findings.push({ severity, text });
  const facts = { host, httpPort, tlsPort };

  const [plain, secure] = await Promise.all([
    request({ host, port: httpPort, tls: false }),
    request({ host, port: tlsPort, tls: true }),
  ]);

  if (!plain.ok && !secure.ok) {
    return {
      verdict: 'INCONCLUSIVE',
      findings: [{ severity: 'INFO', text: `Neither ${httpPort} nor ${tlsPort} answered on ${host} (${plain.message} / ${secure.message}). The console is either not running or not reachable from here.` }],
      facts,
    };
  }

  if (plain.ok) {
    facts.httpServer = plain.headers.server || null;
    add('FINDING', `The admin console answers on cleartext port ${httpPort} from this network. Sign-in over it sends the IBM i password in the clear (HTTP Basic).`);
  } else {
    add('INFO', `Cleartext port ${httpPort} did not answer (${plain.message}).`);
  }

  if (secure.ok) {
    facts.tlsProtocol = secure.tlsProtocol;
    facts.httpsServer = secure.headers.server || null;
    if (/^TLSv1(\.1)?$/.test(secure.tlsProtocol || '')) {
      add('FINDING', `TLS port ${tlsPort} negotiated ${secure.tlsProtocol}, which is deprecated.`);
    }
    for (const [sev, text] of certFindings(secure.cert, now)) add(sev, text);
    add('FINDING', `The admin console is reachable on TLS port ${tlsPort} from this network. It should only be reachable from admin workstations.`);
  } else {
    add('INFO', `TLS port ${tlsPort} did not answer (${secure.message}).`);
  }

  const probe = plain.ok ? plain : secure;
  if (probe.status === 401 || probe.status === 200) {
    const server = probe.headers.server;
    if (server) add('INFO', `Unauthenticated response identifies the server as "${server}".`);
  }

  if (auth && (plain.ok || secure.ok)) {
    const useTls = secure.ok;
    const about = await request({ host, port: useTls ? tlsPort : httpPort, tls: useTls, path: '/HTTPAdmin/about', auth });
    if (about.ok && about.status === 200) {
      const info = parseAbout(about.body);
      facts.osLevel = info.osLevel;
      facts.fix = info.fix;
      if (info.osLevel) add('INFO', `About page reports OS release ${info.osLevel}.`);
      if (info.fix && /not installed/i.test(info.fix)) {
        add('FINDING', `The HTTP Server Administration fix for CVE-2026-96119 is not installed. Apply the PTF for this release (SJ11641 7.3, SJ11643 7.4, SJ11644 7.5, SJ11645 7.6), or upgrade if the release is no longer supported.`);
      } else if (info.fix) {
        add('INFO', `HTTP Server Administration fix reported as ${info.fix}.`);
      }
    } else if (about.ok) {
      add('INFO', `About page returned HTTP ${about.status} for the supplied profile, so version and fix status could not be read.`);
    } else {
      add('INFO', `Could not read the About page (${about.message}).`);
    }
  }

  const verdict = findings.some(f => f.severity === 'FINDING') ? 'FINDING' : 'SECURE';
  return { verdict, findings, facts };
}
