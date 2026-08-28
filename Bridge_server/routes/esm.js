// GET /api/esm-fingerprint — the passive ESM verdict for every live session.
// Read-only. Modeled on routes/negotiate.js.
import { esmFingerprints } from '../features/esm-store.js';

export function handle(req, res, { sessions }) {
  if (req.url !== '/api/esm-fingerprint' || req.method !== 'GET') return false;

  const result = [];
  for (const [wsId, fp] of esmFingerprints) {
    const session = sessions.get(wsId);
    result.push({
      wsId,
      host: session?.host ?? null,
      port: session?.port ?? null,
      ...fp.verdict(),
    });
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(result));
  return true;
}
