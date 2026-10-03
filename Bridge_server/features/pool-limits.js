// Operator-configured per-LPAR session thresholds and shop-specific "no
// session available" reject-text patterns, for the VTAM-Operator Pool/
// Session Dashboard's exhaustion alerting. Lives in its own pool-limits.json
// (gitignored, like lpars.txt/ssh-hosts.txt — this is operator/shop-specific
// config, not something to ship defaults for) rather than as optional
// trailing columns on lpars.txt: that file is already a dense 10-column
// format, and session-pool thresholds aren't a property of the connection
// itself the way host/port/model are, they're a separate operational
// concern an operator sets (or doesn't) independent of the profile list.
//
// Read fresh on every call rather than cached at startup — this is a small
// file an operator edits while the bridge is running (to tune a threshold
// after seeing a false WARN, say), and a stale in-memory copy would need a
// bridge restart to pick up the change, same tradeoff default-accounts.txt
// and macros-security.json already made.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'pool-limits.json');

// { "<lparId>": { maxSessions?: number, rejectPattern?: string } }
export function loadPoolLimits() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    // Malformed file — behave as if nothing were configured rather than
    // crash a connect or a dashboard refresh over a typo in someone's JSON.
    return {};
  }
}

// Compiles and caches rejectPattern regexes per call — these files are tiny
// and read infrequently (once per new connection, once per dashboard
// refresh), so there's no real cost to re-compiling rather than invalidating
// a cache on file change.
export function rejectPatternFor(lparId) {
  const limits = loadPoolLimits();
  const pattern = limits[lparId]?.rejectPattern;
  if (!pattern) return null;
  try { return new RegExp(pattern, 'i'); } catch { return null; }
}
