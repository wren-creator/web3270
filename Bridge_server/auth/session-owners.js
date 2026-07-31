/**
 * auth/session-owners.js
 * ─────────────────────────────────────────────────────────────────
 * wsId -> email, hosted (BRIDGE_MULTI_TENANT) deployment only.
 *
 * wsId is a plain incrementing integer (handlers/ws.js), so it's
 * guessable/enumerable — routes/traffic.js, routes/recording.js, and
 * routes/logs.js use this to verify a caller actually owns the wsId
 * they're asking about before handing back session data, instead of
 * trusting whatever id shows up in the query string. Entries are kept
 * after the session closes (not just while it's live) so a customer
 * can still pull their own traffic log or pcap after disconnecting —
 * same lifetime as the trafficLog/pcap capture data itself.
 */
export const sessionOwners = new Map();
