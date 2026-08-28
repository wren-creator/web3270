// Passive ESM (External Security Manager) fingerprinting.
//
// Watches the screens already flowing through a session and works out which
// security product is installed — IBM RACF, Broadcom ACF2, or Broadcom Top
// Secret — from message-ID prefixes and product banners that are already on
// screen. It never sends anything to the host; `observe()` is the only entry
// point and it only reads.
//
// This is the existing `_fingerprintScreen` heuristic (public/js/rendering.js)
// promoted to a per-session module with weighted scoring, an evidence trail,
// and a stable verdict.

// kind: 'msgid'    — a product-specific message identifier. Definitive.
//       'banner'   — a product name or logon-panel label. Strong but not proof.
//       'behavior' — wording that usually goes with a product. Weak, often shared.
export const RULES = [
  // ── IBM RACF ────────────────────────────────────────────────────────────
  { id: 'racf-ich-msgid', product: 'RACF', kind: 'msgid',  weight: 10,
    pattern: /\bICH\d{3,5}[IEWA]\b/, note: 'RACF message prefix ICHnnnnI' },
  { id: 'racf-irr-msgid', product: 'RACF', kind: 'msgid',  weight: 10,
    pattern: /\bIRR\d{3,5}[IEWA]\b/, note: 'RACF component message prefix IRRnnnnI' },
  { id: 'racf-ikj564',    product: 'RACF', kind: 'msgid',  weight: 6,
    pattern: /\bIKJ564\d\d[IEWA]\b/, note: 'TSO/RACF logon message IKJ564xx' },
  { id: 'racf-logon-hdr', product: 'RACF', kind: 'banner',  weight: 6,
    pattern: /RACF\s+LOGON/i, note: '"RACF LOGON parameters" panel header' },
  { id: 'racf-word',      product: 'RACF', kind: 'banner',  weight: 4,
    pattern: /\bRACF\b/, note: 'literal "RACF" on screen' },
  { id: 'racf-revoked',   product: 'RACF', kind: 'behavior', weight: 3,
    pattern: /HAS BEEN REVOKED/i, note: 'RACF revoke wording' },

  // ── Broadcom ACF2 ──────────────────────────────────────────────────────
  { id: 'acf2-msgid',     product: 'ACF2', kind: 'msgid',  weight: 10,
    pattern: /\bACF0\d{4}\b/, note: 'ACF2 message prefix ACF0nnnn' },
  { id: 'acf2-word',      product: 'ACF2', kind: 'banner',  weight: 7,
    pattern: /\bACF2\b/i, note: 'literal "ACF2" on screen' },
  { id: 'acf2-logonid',   product: 'ACF2', kind: 'banner',  weight: 6,
    pattern: /LOGONID\s*(===>|:)/i, note: 'ACF2 "LOGONID" logon field' },
  { id: 'acf2-logon-hdr', product: 'ACF2', kind: 'banner',  weight: 6,
    pattern: /\bACF\s+LOGON\b/i, note: 'ACF2 logon panel header' },
  { id: 'acf2-noncancel', product: 'ACF2', kind: 'behavior', weight: 2,
    pattern: /NON-?CANCEL/i, note: 'ACF2 non-cancellable wording' },

  // ── Broadcom Top Secret ────────────────────────────────────────────────
  { id: 'tss-msgid',      product: 'TopSecret', kind: 'msgid',  weight: 10,
    pattern: /\bTSS\d{4}[EIWA]\b/, note: 'Top Secret message prefix TSSnnnnE' },
  { id: 'tss-ca-name',    product: 'TopSecret', kind: 'banner',  weight: 8,
    pattern: /CA[- ]TOP SECRET|TOP SECRET\/MVS/i, note: 'CA/Top Secret product name' },
  { id: 'tss-logon-hdr',  product: 'TopSecret', kind: 'banner',  weight: 6,
    pattern: /\bTSS\s+LOGON\b|TOP SECRET LOGON/i, note: 'Top Secret logon panel header' },
  { id: 'tss-tssutil',    product: 'TopSecret', kind: 'banner',  weight: 5,
    pattern: /\bTSSUTIL\b/i, note: 'Top Secret TSSUTIL utility' },
  { id: 'tss-accessorid', product: 'TopSecret', kind: 'banner',  weight: 4,
    pattern: /ACCESSOR ?ID/i, note: 'Top Secret "Accessor ID" (ACID)' },
];

const PRODUCTS = ['RACF', 'ACF2', 'TopSecret'];
const K = 4; // confidence denominator softener

export function screenText(screenData) {
  return (screenData?.rows || [])
    .map(row => (Array.isArray(row) ? row : [])
      .map(c => (c && c.char && c.char !== '\x00' ? c.char : ' ')).join(''))
    .join('\n');
}

// Build a screenData-shaped object from plain text — for tests and fixtures.
export function fromText(str) {
  const lines = String(str).split('\n');
  return {
    rows: lines.map(line => line.split('').map(ch => ({ char: ch }))),
    cols: Math.max(80, ...lines.map(l => l.length)),
    numRows: lines.length,
  };
}

export class EsmFingerprint {
  constructor() {
    this.scores = { RACF: 0, ACF2: 0, TopSecret: 0 };
    this.evidence = [];
    this.screenSeq = 0;
    this.firstSeen = null;
    this._seen = new Set(); // ruleId|matchedText — score/record each hit once
  }

  observe(screenData) {
    this.screenSeq++;
    const text = screenText(screenData);
    for (const rule of RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      const key = `${rule.id}|${m[0]}`;
      if (this._seen.has(key)) continue;
      this._seen.add(key);
      this.scores[rule.product] += rule.weight;
      const before = text.slice(0, m.index);
      const row = before.split('\n').length - 1;
      const col = m.index - before.lastIndexOf('\n') - 1;
      const entry = {
        ts: Date.now(),
        screenSeq: this.screenSeq,
        row, col,
        matched: m[0].slice(0, 60),
        ruleId: rule.id,
        kind: rule.kind,
        product: rule.product,
        weight: rule.weight,
      };
      this.evidence.push(entry);
      if (this.firstSeen === null) this.firstSeen = entry.ts;
    }
    return this.verdict();
  }

  verdict() {
    // Rank by score, then break ties toward the product with a definitive
    // message-ID hit, then toward the more recently seen evidence.
    const lastTs = { RACF: 0, ACF2: 0, TopSecret: 0 };
    const hasMsg = { RACF: false, ACF2: false, TopSecret: false };
    for (const e of this.evidence) {
      if (e.ts > lastTs[e.product]) lastTs[e.product] = e.ts;
      if (e.kind === 'msgid') hasMsg[e.product] = true;
    }
    const ranked = PRODUCTS
      .map(p => [p, this.scores[p], hasMsg[p] ? 1 : 0, lastTs[p]])
      .sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]) || (b[3] - a[3]));
    const [topP, topS] = ranked[0];
    const [, secondS] = ranked[1];

    if (topS === 0) {
      return { product: 'unknown', confidence: 0, runnerUp: null, scores: { ...this.scores }, evidence: [], firstSeen: null };
    }

    let confidence = topS / (topS + secondS + K);
    // A product-specific message ID is definitive — floor the confidence.
    if (hasMsg[topP]) confidence = Math.max(confidence, 0.85);

    return {
      product: topP,
      confidence: Math.round(confidence * 100) / 100,
      runnerUp: secondS > 0 ? ranked[1][0] : null,
      scores: { ...this.scores },
      evidence: this.evidence.slice(-50),
      firstSeen: this.firstSeen,
    };
  }

  reset() {
    this.scores = { RACF: 0, ACF2: 0, TopSecret: 0 };
    this.evidence = [];
    this.screenSeq = 0;
    this.firstSeen = null;
    this._seen.clear();
  }
}
