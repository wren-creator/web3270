// SSH No-Credential Access Checker — probes an SSH target for two
// specific misconfigurations, rather than brute-forcing anything: does
// the server grant a session via the 'none' auth method (zero credentials
// at all), and, only if the server actually advertises password auth,
// does it accept an empty password string for the named account. Each is
// a single attempt against a single connection, never a sweep — the same
// restraint the RACF Probe and APF Writability Checker already use.
//
// Built on ssh2's authHandler hook (already a dependency via features/ssh.js)
// rather than any lower-level protocol surgery: passing a custom
// authHandler function gives full control over which method is offered on
// each attempt and, critically, exposes methodsLeft — the auth methods the
// server says are still available — straight from the library, which is
// what lets the empty-password check be skipped cleanly when a server
// doesn't offer password auth at all instead of reporting a meaningless
// rejection.
import { Client as SshClient } from 'ssh2';

const CONNECT_TIMEOUT_MS = 8000;

function tryAuth({ host, port, username, method, password }) {
  return new Promise(resolve => {
    const conn = new SshClient();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* already closed */ }
      resolve(result);
    };

    conn.on('ready', () => finish({ outcome: 'accepted' }));
    conn.on('error', err => finish({ outcome: 'error', message: err.message }));

    conn.connect({
      host, port, username,
      readyTimeout: CONNECT_TIMEOUT_MS,
      authHandler: (methodsLeft, partialSuccess, callback) => {
        if (methodsLeft === null) {
          return callback(method === 'password' ? { type: 'password', username, password } : 'none');
        }
        // The one attempt was rejected — capture what the server says it
        // actually offers and stop there, no fallback to a second method.
        finish({ outcome: 'rejected', methodsLeft });
        return callback(false);
      },
    });
  });
}

export async function auditSshAuth({ host, port, username }) {
  const noAuth = await tryAuth({ host, port, username, method: 'none' });

  if (noAuth.outcome === 'error') {
    return {
      verdict: 'INCONCLUSIVE',
      findings: [`Could not reach ${host}:${port} — ${noAuth.message}`],
    };
  }
  if (noAuth.outcome === 'accepted') {
    return {
      verdict: 'FINDING',
      findings: [`Server granted a session for "${username}" using the 'none' authentication method — no credential of any kind was required.`],
    };
  }

  const offered = noAuth.methodsLeft || [];
  if (!offered.includes('password')) {
    return {
      verdict: offered.length ? 'SECURE' : 'INCONCLUSIVE',
      findings: offered.length
        ? [`'none' auth correctly rejected. Server only offers: ${offered.join(', ')} — password auth isn't offered, so the empty-password check doesn't apply.`]
        : [`'none' auth correctly rejected, but the server didn't advertise any further authentication methods to test.`],
    };
  }

  const emptyPass = await tryAuth({ host, port, username, method: 'password', password: '' });
  if (emptyPass.outcome === 'error') {
    return {
      verdict: 'INCONCLUSIVE',
      findings: [`'none' auth correctly rejected. Could not complete the empty-password check — ${emptyPass.message}`],
    };
  }
  if (emptyPass.outcome === 'accepted') {
    return {
      verdict: 'FINDING',
      findings: [`Server accepted an empty password for "${username}" — password authentication is misconfigured to allow a blank credential.`],
    };
  }

  return {
    verdict: 'SECURE',
    findings: [`'none' auth and an empty password were both correctly rejected for "${username}".`],
  };
}
