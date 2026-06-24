export function handle(req, res, { sessions }) {
  if (req.url !== '/api/negotiate' || req.method !== 'GET') return false;

  const result = [];
  for (const [wsId, session] of sessions) {
    const sock = session.socket;
    let cipher = null, certSubject = null, certIssuer = null, certExpiry = null, certSelfSigned = false;

    if (sock && session.useTls) {
      try {
        const c = sock.getCipher?.();
        cipher = c ? (c.standardName || c.name || null) : null;
        const cert = sock.getPeerCertificate?.();
        if (cert && cert.subject) {
          certSubject    = cert.subject.CN || Object.values(cert.subject).join(', ');
          certIssuer     = cert.issuer?.CN || null;
          certExpiry     = cert.valid_to  || null;
          certSelfSigned = cert.subject?.CN === cert.issuer?.CN;
        }
      } catch { /* socket may have closed between sessions loop */ }
    }

    result.push({
      wsId,
      host:          session.host,
      port:          session.port,
      tls:           session.tlsVersion || 'PLAIN',
      cipher,
      certSubject,
      certIssuer,
      certExpiry,
      certSelfSigned,
      tn3270e:       session.tn3270eEnabled || false,
      model:         session.model  || null,
      lu:            session.negotiatedLu || null,
    });
  }

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(result));
  return true;
}
