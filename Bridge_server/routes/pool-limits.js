// GET /api/pool-limits — serves the operator-configured per-LPAR session
// thresholds (pool-limits.json) to the VTAM-Operator Pool/Session Dashboard,
// which combines this with /api/sessions (live counts) and /api/profiles
// (LPAR id/name) to compute WARN/CRIT per LPAR client-side.
import { loadPoolLimits } from '../features/pool-limits.js';

export function handle(req, res) {
  if (req.url === '/api/pool-limits' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(loadPoolLimits()));
    return true;
  }
  return false;
}
