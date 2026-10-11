// z/VM Systems Management API (SMAPI) exposure probe. SMAPI can provision
// guests and rewrite the directory, and its requests carry a userid and
// password, so the first question is whether the listener is reachable and
// whether it protects that traffic.
//
// This is a network-level look only. It opens a TCP connection and, if the
// port answers, tries a TLS handshake. It sends no SMAPI request and tries no
// credentials, so there is nothing here that can lock an account or change
// state on the target.
import net from 'net';
import tls from 'tls';

export const SMAPI_PORTS = [44444, 44445];

function tcpOpen(host, port, timeoutMs) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    let done = false;
    const end = r => { if (done) return; done = true; s.destroy(); resolve(r); };
    s.setTimeout(timeoutMs, () => end({ state: 'filtered' }));
    s.once('connect', () => end({ state: 'open' }));
    s.once('error', e => end({ state: e.code === 'ECONNREFUSED' ? 'closed' : 'filtered', error: e.code }));
  });
}

function tlsHandshake(host, port, timeoutMs) {
  return new Promise(resolve => {
    const s = tls.connect({ host, port, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host });
    let done = false;
    const end = r => { if (done) return; done = true; s.destroy(); resolve(r); };
    s.setTimeout(timeoutMs, () => end({ tls: false }));
    s.once('secureConnect', () => end({ tls: true, protocol: s.getProtocol?.() || null, cipher: s.getCipher?.()?.name || null }));
    s.once('error', () => end({ tls: false }));
  });
}

export async function auditSmapi({ host, ports = SMAPI_PORTS, timeoutMs = 4000 }) {
  const results = [];
  for (const port of ports) {
    const r = await tcpOpen(host, port, timeoutMs);
    if (r.state === 'open') Object.assign(r, await tlsHandshake(host, port, timeoutMs));
    results.push({ port, ...r });
  }
  return { results };
}
