/**
 * public/js/wire-correlate.js
 * ─────────────────────────────────────────────────────────────────
 * Stateful correlation pass over decodeCapture()'s record list
 * (tn3270/wire-decode.js, server-side — this module consumes its JSON
 * output over /api/wire, not the module itself). Unlike that decoder,
 * which labels one record at a time with no memory of what came before,
 * this walks a session's full record list chronologically looking for a
 * pattern no single record can show on its own: repeated AID=ENTER
 * records, redisplayed logon screens, and same-userid retries, matched
 * against the same real RACF message IDs the live per-screen anomaly
 * pipeline (features/anomaly.js) already keys off of — IKJ56425I (bad
 * password), IKJ56421I/IKJ56422I (lockout/revoked).
 *
 * Pure and DOM-free (lives under public/js/ rather than tn3270/ so the
 * browser can actually fetch it — tn3270/ is server-only, never served
 * statically) so it can run identically in the browser (wire.html) and
 * in a Node test/verification harness — it only ever touches the plain
 * record objects decodeCapture() already produces.
 */

const RACF_PATTERNS = {
  badPassword: /IKJ56425I/,
  lockout:     /IKJ56421I|IKJ56422I/,
  logonScreen: /TSO\/E LOGON|Enter LOGON parameters/i,
};

// Every DATA order's `meaning` is a quoted `"text"` string — joining them in
// record order reconstructs enough of the screen's visible text to pattern-
// match against, without needing real row/col placement.
function screenText(record) {
  return (record.orders || [])
    .filter(o => o.type === 'DATA')
    .map(o => o.meaning.replace(/^"|"$/g, ''))
    .join(' ');
}

// Best-effort "what did they type" for an outbound AID record — the first
// non-masked DATA order's text (a masked/nondisplay one is the password
// field itself, never useful here and never something to surface anyway).
function typedValue(record) {
  const d = (record.orders || []).find(o => o.type === 'DATA' && !o.danger);
  if (!d) return null;
  return d.meaning.replace(/^"|"$/g, '').trim() || null;
}

function classify(streak, sameUser) {
  if (streak >= 3 && !sameUser) return 'CRITICAL'; // different userids in sequence — enumeration/sweep shape
  if (streak >= 3) return 'HIGH';                  // same userid, repeated — password guessing
  return 'MEDIUM';                                 // streak === 2 — worth watching, not definitive yet
}

function flushStreak(findings, wsId, streak, streakNos, streakValues) {
  if (streak < 2) return;
  const sameUser = streakValues.every(v => v && v === streakValues[0]);
  findings.push({
    wsId,
    severity: classify(streak, sameUser),
    summary: sameUser
      ? `${streak} consecutive failed logons for the same userid (${streakValues[0] || 'unknown'}) — possible password guessing`
      : `${streak} consecutive failed logons across different userids — looks like a brute-force/enumeration sweep`,
    recordNos: [...streakNos],
  });
}

/**
 * @param {Array} records — decodeCapture()'s full output, every record
 *   carrying at least {no, dir, kind, aid, wsId, orders}.
 * @returns {Array<{wsId, severity, summary, recordNos}>} findings, sorted
 *   by session then by first record number.
 */
export function correlateAnomalies(records) {
  const bySession = new Map();
  for (const r of records) {
    if (!bySession.has(r.wsId)) bySession.set(r.wsId, []);
    bySession.get(r.wsId).push(r);
  }

  const findings = [];

  for (const [wsId, recs] of bySession) {
    let streak = 0, streakNos = [], streakValues = [];

    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!(r.dir === 'sent' && r.kind === 'aid' && r.aid === 'ENTER')) continue;

      const next = recs.slice(i + 1).find(x => x.dir === 'recv' && x.kind === 'write');
      if (!next) continue;

      const text = screenText(next);
      const val  = typedValue(r);

      if (RACF_PATTERNS.lockout.test(text)) {
        findings.push({
          wsId, severity: 'CRITICAL',
          summary: `RACF lockout after ${streak + 1} consecutive failed logon attempt${streak === 0 ? '' : 's'}`,
          recordNos: [...streakNos, r.no, next.no],
        });
        streak = 0; streakNos = []; streakValues = [];
        continue;
      }

      if (RACF_PATTERNS.badPassword.test(text) || RACF_PATTERNS.logonScreen.test(text)) {
        streak++;
        streakNos.push(r.no, next.no);
        streakValues.push(val);
        continue;
      }

      // Any other response (a real READY prompt, a menu) ends the streak.
      flushStreak(findings, wsId, streak, streakNos, streakValues);
      streak = 0; streakNos = []; streakValues = [];
    }

    // A streak still open when the capture ends (e.g. capture stopped
    // mid-attempt) is still worth surfacing.
    flushStreak(findings, wsId, streak, streakNos, streakValues);
  }

  findings.sort((a, b) => a.wsId - b.wsId || a.recordNos[0] - b.recordNos[0]);
  return findings;
}
