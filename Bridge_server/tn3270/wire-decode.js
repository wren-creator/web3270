/**
 * tn3270/wire-decode.js
 * ─────────────────────────────────────────────────────────────────
 * Stateless-replay decoder for the Wire Inspector. Takes the raw byte
 * frames already captured by features/pcap.js — {ts, dir, data} in
 * chronological order, every byte that ever crossed the wire in either
 * direction (see Tn3270Session._onData / _send, which emit('raw', …)
 * before any telnet/3270 parsing happens) — and turns them into a list
 * of decoded, human-readable records for display.
 *
 * This deliberately does NOT reuse Tn3270Session directly: that class
 * renders a live *screen*, mutating a stateful buffer as a side effect
 * of parsing. Here we only need to reconstruct enough state to label
 * each record correctly — primarily a map of "which buffer address has
 * which field attribute" so outbound field writes can be flagged as
 * touching a nondisplay (password) field. Two genuinely non-trivial
 * pieces of session.js ARE reused directly to avoid drift: the 12/14-bit
 * buffer address decoder and the TN3270E sub-negotiation describer.
 */

import * as Ebcdic from './ebcdic.js';
import { decode3270Address, AIDS, _decodeTn3270eSubneg as decodeTn3270eSubneg } from './session.js';

// ── Telnet framing ───────────────────────────────────────────────────
const IAC = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB = 0xFA, SE = 0xF0, EOR = 0xEF, NOP = 0xF1;

const CMD_NAMES = { [DO]: 'DO', [DONT]: "DON'T", [WILL]: 'WILL', [WONT]: "WON'T" };
const OPT_NAMES = { 0x00: 'BINARY', 0x18: 'TTYPE', 0x19: 'EOR', 0x28: 'TN3270E' };

// ── 3270 orders (same values as session.js — re-declared here so this
// module stays a self-contained decoder, matching the convention the
// mock daemons already use for their own protocol constants) ─────────
const ORDER_SF = 0x1D, ORDER_SFE = 0x29, ORDER_SBA = 0x11, ORDER_SA = 0x28;
const ORDER_MF = 0x2C, ORDER_IC = 0x13, ORDER_PT = 0x05, ORDER_RA = 0x3C;
const ORDER_EUA = 0x12, ORDER_GE = 0x08;
const ORDER_BYTES = new Set([ORDER_SF, ORDER_SFE, ORDER_SBA, ORDER_SA, ORDER_MF, ORDER_IC, ORDER_PT, ORDER_RA, ORDER_EUA, ORDER_GE]);

const WCC_RESET = 0x40;
const FA_PROTECTED = 0x20, FA_NUMERIC = 0x10, FA_MDT = 0x01, FA_INTENSITY = 0x0C, FA_NONDISPLAY = 0x0C;
const isNonDisplayFa = fa => (fa & FA_INTENSITY) === FA_NONDISPLAY;

// Command bytes — CCW and SNA encodings both appear in the wild (see
// Tn3270Session._handle3270Record, which accepts both).
const CMD_INFO = {
  0x01: { name: 'Write',                      kind: 'write', erase: false },
  0xF1: { name: 'Write',                      kind: 'write', erase: false },
  0x05: { name: 'Erase/Write',                kind: 'write', erase: true  },
  0xF5: { name: 'Erase/Write',                kind: 'write', erase: true  },
  0x0D: { name: 'Erase/Write Alternate',      kind: 'write', erase: true  },
  0x7E: { name: 'Erase/Write Alternate',      kind: 'write', erase: true  },
  0x0F: { name: 'Erase All Unprotected',      kind: 'eau'   },
  0x6F: { name: 'Erase All Unprotected',      kind: 'eau'   },
  0x02: { name: 'Read Buffer',                kind: 'read'  },
  0xF2: { name: 'Read Buffer',                kind: 'read'  },
  0x06: { name: 'Read Modified',              kind: 'read'  },
  0xF6: { name: 'Read Modified',              kind: 'read'  },
  0x6E: { name: 'Read Modified All',          kind: 'read'  },
  0x11: { name: 'Write Structured Field',     kind: 'wsf'   },
  0xF3: { name: 'Write Structured Field',     kind: 'wsf'   },
};

const AID_BY_BYTE = Object.fromEntries(Object.entries(AIDS).map(([name, byte]) => [byte, name]));

const CP037 = 37;
const toAscii = buf => Ebcdic.toAscii(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), CP037);

function describeFa(fa) {
  const bits = [];
  bits.push(fa & FA_PROTECTED ? 'PROTECTED' : 'UNPROTECTED');
  if (isNonDisplayFa(fa)) bits.push('NONDISPLAY');
  else if ((fa & FA_INTENSITY) === 0x08) bits.push('INTENSIFIED');
  if (fa & FA_NUMERIC) bits.push('NUMERIC');
  if (fa & FA_MDT) bits.push('MDT');
  return `FA=0x${fa.toString(16).toUpperCase().padStart(2, '0')} (${bits.join(', ')})`;
}

// ── Telnet-level framing pass ──────────────────────────────────────
// Walks `buf` exactly like Tn3270Session._processBuffer does, but instead
// of dispatching into a live session, returns the logical units found and
// how many leading bytes were fully consumed (the rest — an in-progress
// negotiation triplet or 3270 data record split across a TCP chunk
// boundary — is left for the next frame to complete).
function extractUnits(buf) {
  const units = [];
  let i = 0, safeIdx = 0;
  let recordBytes = null, recordStart = null;
  let negoRun = null;

  const flushNego = () => {
    if (negoRun) {
      units.push({ type: 'negotiation', start: negoRun.start, end: i, items: negoRun.items });
      negoRun = null;
    }
  };

  while (i < buf.length) {
    const b = buf[i];

    if (recordBytes !== null) {
      if (b === IAC) {
        const nxt = buf[i + 1];
        if (nxt === undefined) break; // ambiguous — wait for more
        if (nxt === IAC) { recordBytes.push(0xFF); i += 2; continue; }
        if (nxt === EOR) {
          units.push({ type: 'data', start: recordStart, end: i + 2, bytes: Buffer.from(recordBytes) });
          recordBytes = null; recordStart = null;
          i += 2; safeIdx = i; continue;
        }
        i += 2; continue; // malformed mid-record IAC — drop 2 bytes, matches session.js
      }
      recordBytes.push(b); i++; continue;
    }

    if (b !== IAC) {
      flushNego();
      recordStart = i; recordBytes = [b]; i++;
      continue;
    }

    const cmd = buf[i + 1];
    if (cmd === undefined) { flushNego(); break; }

    if (cmd === NOP) { i += 2; safeIdx = i; continue; }

    if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
      const opt = buf[i + 2];
      if (opt === undefined) break; // wait for the option byte
      if (!negoRun) negoRun = { start: i, items: [] };
      negoRun.items.push({ cmd, opt });
      i += 3; safeIdx = i; continue;
    }

    if (cmd === SB) {
      const seIdx = buf.indexOf(Buffer.from([IAC, SE]), i + 2);
      if (seIdx === -1) { flushNego(); break; }
      flushNego();
      units.push({ type: 'subneg', start: i, end: seIdx + 2, bytes: buf.slice(i + 2, seIdx) });
      i = seIdx + 2; safeIdx = i; continue;
    }

    i += 2; safeIdx = i; // unrecognized two-byte IAC command — skip
  }

  if (recordBytes === null) flushNego();
  return { units, consumed: safeIdx };
}

// ── Inbound (host→client) 3270 write decode ────────────────────────
function decodeWrite(bytes, faMap, cols, totalCells) {
  const cmdByte = bytes[0];
  const info = CMD_INFO[cmdByte];
  const cmdName = info ? info.name : `Unknown command 0x${cmdByte.toString(16)}`;

  if (!info || info.kind === 'read' || info.kind === 'eau') {
    if (info?.kind === 'eau') faMap.forEach((fa, addr) => { if (!(fa & FA_PROTECTED)) faMap.delete(addr); });
    return { summary: cmdName, orders: [{ type: info?.kind === 'read' ? 'READ' : 'CMD', meaning: cmdName, range: [0, bytes.length - 1] }], danger: false, aid: null };
  }
  if (info.kind === 'wsf') {
    return { summary: `${cmdName} (${bytes.length}B)`, orders: [{ type: 'WSF', meaning: 'Write Structured Field — payload not decoded (query reply / IND$FILE / etc.)', range: [0, bytes.length - 1] }], danger: false, aid: null };
  }

  if (info.erase) faMap.clear();

  const orders = [];
  const wcc = bytes[1];
  orders.push({ type: 'WCC', meaning: `Write Control Character 0x${(wcc ?? 0).toString(16).padStart(2, '0')}${wcc & WCC_RESET ? ' — reset MDT bits' : ''}`, range: [1, 1] });

  let addr = 0, i = 2, danger = false;

  while (i < bytes.length) {
    const b = bytes[i];

    if (b === ORDER_SF) {
      const fa = bytes[i + 1];
      faMap.set(addr, fa);
      const nd = isNonDisplayFa(fa);
      if (nd) danger = true;
      orders.push({ type: 'SF', meaning: `Start Field — ${describeFa(fa)}`, range: [i, i + 1], danger: nd });
      addr = (addr + 1) % totalCells; i += 2; continue;
    }

    if (b === ORDER_SBA) {
      const newAddr = decode3270Address(bytes[i + 1], bytes[i + 2], cols);
      orders.push({ type: 'SBA', meaning: `Set Buffer Address → row ${Math.floor(newAddr / cols) + 1}, col ${(newAddr % cols) + 1}`, range: [i, i + 2] });
      addr = newAddr; i += 3; continue;
    }

    if (b === ORDER_IC) {
      orders.push({ type: 'IC', meaning: 'Insert Cursor here', range: [i, i] });
      i += 1; continue;
    }

    if (b === ORDER_SFE) {
      const pairCount = bytes[i + 1];
      let baseFa = 0x60, j = i + 2;
      for (let p = 0; p < pairCount; p++) {
        if (bytes[j] === 0xC0) baseFa = bytes[j + 1];
        j += 2;
      }
      faMap.set(addr, baseFa);
      const nd = isNonDisplayFa(baseFa);
      if (nd) danger = true;
      orders.push({ type: 'SFE', meaning: `Start Field Extended — ${describeFa(baseFa)} (${pairCount} attr pair${pairCount === 1 ? '' : 's'})`, range: [i, j - 1], danger: nd });
      addr = (addr + 1) % totalCells; i = j; continue;
    }

    if (b === ORDER_SA) {
      const type = bytes[i + 1], value = bytes[i + 2];
      const label = type === 0x42 ? 'color' : type === 0x41 ? 'highlight' : 'reset';
      orders.push({ type: 'SA', meaning: `Set Attribute — ${label}${type !== 0x00 ? ` 0x${(value ?? 0).toString(16)}` : ''} for following characters`, range: [i, i + 2] });
      i += 3; continue;
    }

    if (b === ORDER_MF) {
      const pairCount = bytes[i + 1];
      let j = i + 2, newFa = null;
      for (let p = 0; p < pairCount; p++) {
        if (bytes[j] === 0xC0) newFa = bytes[j + 1];
        j += 2;
      }
      if (newFa != null) faMap.set(addr, newFa);
      orders.push({ type: 'MF', meaning: `Modify Field attributes${newFa != null ? ` — ${describeFa(newFa)}` : ''}`, range: [i, j - 1] });
      addr = (addr + 1) % totalCells; i = j; continue;
    }

    if (b === ORDER_RA) {
      const toAddr = decode3270Address(bytes[i + 1], bytes[i + 2], cols);
      const charByte = bytes[i + 3];
      const ch = charByte >= 0x40 ? toAscii([charByte]) : '·';
      orders.push({ type: 'RA', meaning: `Repeat '${ch}' to row ${Math.floor(toAddr / cols) + 1}, col ${(toAddr % cols) + 1}`, range: [i, i + 3] });
      addr = toAddr; i += 4; continue;
    }

    if (b === ORDER_EUA) {
      const toAddr = decode3270Address(bytes[i + 1], bytes[i + 2], cols);
      orders.push({ type: 'EUA', meaning: `Erase Unprotected to row ${Math.floor(toAddr / cols) + 1}, col ${(toAddr % cols) + 1}`, range: [i, i + 2] });
      addr = toAddr; i += 3; continue;
    }

    if (b === ORDER_PT) {
      orders.push({ type: 'PT', meaning: 'Program Tab — advance to next unprotected field', range: [i, i] });
      i += 1; continue;
    }

    if (b === ORDER_GE) {
      orders.push({ type: 'GE', meaning: 'Graphic Escape', range: [i, i + 1] });
      i += 2; continue;
    }

    // Coalesce a run of plain character data into one readable order.
    let j = i;
    while (j < bytes.length && !ORDER_BYTES.has(bytes[j])) j++;
    const text = toAscii(bytes.slice(i, j));
    orders.push({ type: 'DATA', meaning: `"${text}"`, range: [i, j - 1] });
    addr = (addr + (j - i)) % totalCells;
    i = j;
  }

  const fieldCount = orders.filter(o => o.type === 'SF' || o.type === 'SFE').length;
  const summary = `${cmdName} · ${fieldCount} field${fieldCount === 1 ? '' : 's'}${danger ? ' · nondisplay field written' : ''}`;
  return { summary, orders, danger, aid: null };
}

// ── Outbound (client→host) AID record decode ───────────────────────
// Matches the exact layout Tn3270Session.sendAid() documents and builds:
// AID(1) + cursorAddr(2, raw — no SBA prefix) + repeating[SBA(3) + data].
function decodeAid(bytes, faMap, cols, totalCells) {
  if (bytes.length < 3) return null;
  const aidByte = bytes[0];
  const aidName = AID_BY_BYTE[aidByte];
  if (!aidName) return null; // not a recognized AID — caller falls back to a generic label

  const cursorAddr = decode3270Address(bytes[1], bytes[2], cols);
  const orders = [
    { type: 'AID', meaning: `${aidName} — transmit modified fields`, range: [0, 0] },
    { type: 'Cursor', meaning: `Cursor at row ${Math.floor(cursorAddr / cols) + 1}, col ${(cursorAddr % cols) + 1}`, range: [1, 2] },
  ];

  let i = 3, danger = false;
  while (i < bytes.length) {
    if (bytes[i] !== ORDER_SBA) {
      orders.push({ type: 'DATA', meaning: `${bytes.length - i} unstructured byte(s) — not SBA-delimited (raw send / EDIT input line?)`, range: [i, bytes.length - 1] });
      break;
    }
    const fieldAddr = decode3270Address(bytes[i + 1], bytes[i + 2], cols);
    const faAddr = (fieldAddr - 1 + totalCells) % totalCells;
    const fa = faMap.get(faAddr);
    const nd = fa !== undefined && isNonDisplayFa(fa);
    let j = i + 3;
    while (j < bytes.length && bytes[j] !== ORDER_SBA) j++;
    const dataBytes = bytes.slice(i + 3, j);
    if (nd) danger = true;

    orders.push({ type: 'SBA', meaning: `Field @ row ${Math.floor(fieldAddr / cols) + 1}, col ${(fieldAddr % cols) + 1}${nd ? ' (nondisplay)' : ''}`, range: [i, i + 2] });
    orders.push({
      type: 'DATA',
      meaning: nd ? `${dataBytes.length} byte(s) — nondisplay field content, masked` : `"${toAscii(dataBytes)}"`,
      range: [i + 3, j - 1],
      danger: nd,
    });
    i = j;
  }

  const summary = `AID=${aidName}${danger ? ' · touches nondisplay field' : ''}`;
  return { summary, orders, danger, aid: aidName };
}

// ── Top-level entry point ──────────────────────────────────────────
/**
 * @param {Array<{ts:number, dir:'sent'|'recv', data:Buffer}>} frames — in
 *   chronological order, exactly as stored by features/pcap.js.
 * @param {{cols?:number}} opts
 * @returns {Array} decoded records: {ts, dir, kind, raw, summary, aid, orders, danger}
 */
export function decodeCapture(frames, opts = {}) {
  let cols = opts.cols || 80;
  const rows = opts.rows || 24;
  let totalCells = cols * rows;
  const faMap = new Map();
  let tn3270e = false;

  const streams = { sent: Buffer.alloc(0), recv: Buffer.alloc(0) };
  const out = [];

  for (const frame of frames) {
    if (frame.dir !== 'sent' && frame.dir !== 'recv') continue;
    streams[frame.dir] = Buffer.concat([streams[frame.dir], frame.data]);
    const { units, consumed } = extractUnits(streams[frame.dir]);
    streams[frame.dir] = streams[frame.dir].slice(consumed);

    for (const u of units) {
      if (u.type === 'negotiation') {
        const parts = u.items.map(it => {
          const optName = OPT_NAMES[it.opt] || `0x${it.opt.toString(16)}`;
          if (it.opt === 0x28) { // TN3270E
            if (it.cmd === DO || it.cmd === WILL) tn3270e = true;
            if (it.cmd === DONT || it.cmd === WONT) tn3270e = false;
          }
          return `IAC ${CMD_NAMES[it.cmd]} ${optName}`;
        });
        out.push({
          ts: frame.ts, dir: frame.dir, kind: 'negotiation',
          raw: streamsRawSlice(frame, u),
          summary: parts.join(' · '), aid: null, orders: [], danger: false,
        });
        continue;
      }

      if (u.type === 'subneg') {
        const opt = u.bytes[0];
        const isTn3270e = opt === 0x28;
        const summary = isTn3270e ? decodeTn3270eSubneg(u.bytes) : `SB opt=0x${opt.toString(16)} (${u.bytes.length}B)`;
        if (isTn3270e && (u.bytes[1] === 0x03 || u.bytes[1] === 0x02)) tn3270e = true; // FUNCTIONS or DEVICE-TYPE exchange implies TN3270E active
        out.push({
          ts: frame.ts, dir: frame.dir, kind: 'tn3270e-subneg',
          raw: u.bytes, summary, aid: null, orders: [], danger: false,
        });
        continue;
      }

      if (u.type === 'data') {
        let body = u.bytes;
        // Only inbound (host→client) records carry the TN3270E 5-byte
        // header in this codebase — Tn3270Session._sendDataRecord() never
        // prepends one on send, and the mock hosts never expect one on
        // receipt either (see Tn3270Session._handle3270Record, which only
        // strips it when `this.tn3270eEnabled` gates *incoming* bytes).
        if (tn3270e && frame.dir === 'recv') {
          const dataType = body[0];
          if (dataType === 0x05) { // BIND-IMAGE
            out.push({ ts: frame.ts, dir: frame.dir, kind: 'bind-image', raw: body, summary: 'BIND-IMAGE (session parameters)', aid: null, orders: [], danger: false });
            continue;
          }
          if (dataType !== 0x00) {
            out.push({ ts: frame.ts, dir: frame.dir, kind: 'unknown', raw: body, summary: `Unrecognized TN3270E data-type 0x${dataType.toString(16)}`, aid: null, orders: [], danger: false });
            continue;
          }
          body = body.slice(5); // strip 5-byte TN3270E header
        }

        if (frame.dir === 'recv') {
          const decoded = decodeWrite(body, faMap, cols, totalCells);
          out.push({ ts: frame.ts, dir: frame.dir, kind: 'write', raw: body, ...decoded });
        } else {
          const decoded = decodeAid(body, faMap, cols, totalCells);
          if (decoded) {
            out.push({ ts: frame.ts, dir: frame.dir, kind: 'aid', raw: body, ...decoded });
          } else {
            out.push({ ts: frame.ts, dir: frame.dir, kind: 'unknown', raw: body, summary: `Raw outbound data (${body.length}B) — not a recognized AID record`, aid: null, orders: [], danger: false });
          }
        }
      }
    }
  }

  out.sort((a, b) => a.ts - b.ts);
  out.forEach((r, idx) => { r.no = idx + 1; });
  return out;
}

// extractUnits works on the accumulated per-direction buffer, not the
// individual frame, so a unit's raw bytes for negotiation/data records
// come from `u.bytes` (data) or need reconstructing for negotiation. We
// only need something reasonable for the hex pane, so negotiation frames
// just show their constituent IAC bytes.
function streamsRawSlice(frame, u) {
  const parts = [];
  for (const it of u.items) parts.push(IAC, it.cmd, it.opt);
  return Buffer.from(parts);
}
