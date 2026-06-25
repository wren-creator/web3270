function _extractCertChain(sock) {
  try {
    const leaf = sock.getPeerCertificate?.();
    if (!leaf || !leaf.subject) return [];
    const chain = [];
    let cur = sock.getPeerCertificate?.(true); // full chain
    const seen = new Set();
    while (cur && cur.subject) {
      const fp = cur.fingerprint256 || cur.fingerprint || JSON.stringify(cur.subject);
      if (seen.has(fp)) break;
      seen.add(fp);
      chain.push({
        subject:    cur.subject?.CN  || Object.values(cur.subject || {}).join(', '),
        issuer:     cur.issuer?.CN   || Object.values(cur.issuer  || {}).join(', '),
        validFrom:  cur.valid_from   || null,
        validTo:    cur.valid_to     || null,
        fingerprint: cur.fingerprint256 || cur.fingerprint || null,
        selfSigned: cur.subject?.CN === cur.issuer?.CN,
        serialNumber: cur.serialNumber || null,
      });
      cur = cur.issuerCertificate;
    }
    return chain;
  } catch { return []; }
}

export function handle(req, res, { sessions }) {
  if (req.url !== '/api/negotiate' || req.method !== 'GET') return false;

  const result = [];
  for (const [wsId, session] of sessions) {
    const sock = session.socket;
    let cipher = null, certSubject = null, certIssuer = null, certExpiry = null,
        certSelfSigned = false, certChain = [], sessionReused = false;

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
        certChain    = _extractCertChain(sock);
        sessionReused = sock.isSessionReused?.() || false;
      } catch { /* socket may have closed */ }
    }

    const luRequested  = session.luName    || null;
    const luGranted    = session.negotiatedLu || null;
    const luFixation   = luRequested
      ? (luGranted === luRequested ? 'ACCEPTED' : (luGranted ? 'REJECTED' : 'NO_LU'))
      : 'NOT_REQUESTED';

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
      certChain,
      sessionReused,
      tn3270e:       session.tn3270eEnabled || false,
      model:         session.model  || null,
      lu:            luGranted,
      luRequested,
      luFixation,
      tn3270eLog:    session.tn3270eLog || [],
    });
  }

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(result));
  return true;
}
