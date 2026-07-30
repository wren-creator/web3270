'use strict';

/**
 * mock-claims.js
 * ─────────────────────────────────────────────────────────────────────────
 * Mock TN3270 daemon simulating the "RM2P" 2nd-pass medical claims entry
 * screen, built to let the D9ATP_Override macro (from the legacy Rumba/VBA
 * workbook at ~/git/my-code/vbcode) be re-authored and tested against a
 * fake claims system instead of production data.
 *
 * Screen field coordinates below are taken directly from the coordinates
 * the VBA macro (D9QC1ComeUp.bas, sub D9ATP_Override) reads and writes —
 * .GetDisplayText(row, col, len) / .MoveCursor(row, col) calls. Those use
 * classic 1-based HLLAPI row/col numbering (row 1 = top row). This bridge's
 * screen model, like every other mock in this folder, is 0-based, so every
 * coordinate here is the VBA's row/col minus 1. Get this wrong and a macro
 * built against this mock will look right here and be off-by-one against
 * the real host.
 *
 * All twelve claim numbers below are synthetic test fixtures, not real
 * claims. Each one is built to deterministically land on exactly one of
 * the eleven distinct outcomes the VBA macro can produce, so a JSON macro
 * (or anything else) can be regression-tested against every branch without
 * ever touching real medical data. Field labels/screen dressing around the
 * verified coordinates are reasonable placeholders, not real BCBS screen
 * text — only the coordinates and the message strings' matched substrings
 * are taken from source.
 *
 * NOT modeled: the RMIM/RMIH "wrong menu" retry loop the VBA guards against
 * right after typing "rm2p" (GetDisplayText(1,28,4)/(1,30,4)). What actually
 * triggers those two screen states in the real host isn't known from the
 * VBA alone, and they're a defensive retry, not one of the macro's eleven
 * logged outcomes — so this mock goes straight from the main menu to the
 * RM2P entry screen every time.
 */

const net = require('net');

const PORT    = parseInt(process.env.MOCK_CLAIMS_PORT || '3273', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const LU_NAME = process.env.MOCK_CLAIMS_LU    || 'CLAIMLU1';
const SYSNAME = process.env.MOCK_CLAIMS_SYSID || 'CLAIMSYS';

// ── Telnet constants ────────────────────────────────────────────────────
const IAC  = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB   = 0xFA, SE   = 0xF0, EOR = 0xEF;

const OPT_BINARY  = 0x00;
const OPT_EOR     = 0x19;
const OPT_TTYPE   = 0x18;
const OPT_TN3270E = 0x28;

const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

// ── 3270 datastream constants ───────────────────────────────────────────
const CMD_ERASE_WRITE     = 0xF5;
const CMD_ERASE_WRITE_ALT = 0x7E;
const CMD_WRITE           = 0xF1;
const ORDER_SF  = 0x1D;
const ORDER_SFE = 0x29;
const ORDER_SA  = 0x28;
const ORDER_SBA = 0x11;
const ORDER_IC  = 0x13;

const FA_PROTECTED      = 0x60;
const FA_PROTECTED_HIGH = 0xE0;
const FA_UNPROTECTED    = 0x40;

const COL_BLUE   = 0xF1;
const COL_RED    = 0xF2;
const COL_PINK   = 0xF3;
const COL_GREEN  = 0xF4;
const COL_TURQ   = 0xF5;
const COL_YELLOW = 0xF6;
const COL_WHITE  = 0xF7;

const HL_INTENS  = 0xF8;

const AID_ENTER = 0x7D;
const AID_CLEAR = 0x6D;
const AID_PF2   = 0xF2;
const AID_PF3   = 0xF3;
const AID_PF4   = 0xF4;

// ── EBCDIC tables (CP037) ───────────────────────────────────────────────
const EBCDIC_TO_ASCII = Buffer.from([
  0x00,0x01,0x02,0x03,0x9C,0x09,0x86,0x7F,0x97,0x8D,0x8E,0x0B,0x0C,0x0D,0x0E,0x0F,
  0x10,0x11,0x12,0x13,0x9D,0x0A,0x08,0x87,0x18,0x19,0x92,0x8F,0x1C,0x1D,0x1E,0x1F,
  0x80,0x81,0x82,0x83,0x84,0x85,0x17,0x1B,0x88,0x89,0x8A,0x8B,0x8C,0x05,0x06,0x07,
  0x90,0x91,0x16,0x93,0x94,0x95,0x96,0x04,0x98,0x99,0x9A,0x9B,0x14,0x15,0x9E,0x1A,
  0x20,0xA0,0xE2,0xE4,0xE0,0xE1,0xE3,0xE5,0xE7,0xF1,0xA2,0x2E,0x3C,0x28,0x2B,0x7C,
  0x26,0xE9,0xEA,0xEB,0xE8,0xED,0xEE,0xEF,0xEC,0xDF,0x21,0x24,0x2A,0x29,0x3B,0x5E,
  0x2D,0x2F,0xC2,0xC4,0xC0,0xC1,0xC3,0xC5,0xC7,0xD1,0xA6,0x2C,0x25,0x5F,0x3E,0x3F,
  0xF8,0xC9,0xCA,0xCB,0xC8,0xCD,0xCE,0xCF,0xCC,0x60,0x3A,0x23,0x40,0x27,0x3D,0x22,
  0xD8,0x61,0x62,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0xAB,0xBB,0xF0,0xFD,0xFE,0xB1,
  0xB0,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,0x70,0x71,0x72,0xAA,0xBA,0xE6,0xB8,0xC6,0xA4,
  0xB5,0x7E,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7A,0xA1,0xBF,0xD0,0x5B,0xDE,0xAE,
  0xAC,0xA3,0xA5,0xB7,0xA9,0xA7,0xB6,0xBC,0xBD,0xBE,0xDD,0xA8,0xAF,0x5D,0xB4,0xD7,
  0x7B,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0xAD,0xF4,0xF6,0xF2,0xF3,0xF5,
  0x7D,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,0x50,0x51,0x52,0xB9,0xFB,0xFC,0xF9,0xFA,0xFF,
  0x5C,0xF7,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0xB2,0xD4,0xD6,0xD2,0xD3,0xD5,
  0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0xB3,0xDB,0xDC,0xD9,0xDA,0x9F,
]);

const ASCII_TO_EBCDIC = Buffer.alloc(256, 0x3F);
for (let eb = 0; eb < 256; eb++) {
  const asc = EBCDIC_TO_ASCII[eb];
  if (ASCII_TO_EBCDIC[asc] === 0x3F) ASCII_TO_EBCDIC[asc] = eb;
}

function toEbcdic(str) {
  const buf = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = ASCII_TO_EBCDIC[str.charCodeAt(i)] ?? 0x3F;
  return buf;
}

const MODEL_DIMS = {
  '3278-2':   { rows: 24, cols: 80  },
  '3278-3':   { rows: 32, cols: 80  },
  '3278-4':   { rows: 43, cols: 80  },
  '3278-5':   { rows: 27, cols: 132 },
  '3178':     { rows: 24, cols: 80  },
  '3279-2':   { rows: 24, cols: 80  },
  '3279-2-E': { rows: 24, cols: 80  },
  '3279-3':   { rows: 32, cols: 80  },
  '3279-3-E': { rows: 32, cols: 80  },
  '3279-4':   { rows: 43, cols: 132 },
  '3279-4-E': { rows: 43, cols: 132 },
  '3279-5':   { rows: 27, cols: 132 },
  '3279-5-E': { rows: 27, cols: 132 },
};

let mockCols = 80;

// This bridge's own SBA decoder (tn3270/session.js, decode3270Address) does
// NOT implement the real IBM 3270 6-bit GE-character address table — it
// reads two-byte SBA operands as a plain 14-bit value: b1's top two bits
// forced to 0, low 6 bits are the address's high bits, b2 is the low 8
// bits. That's also exactly what session.js's own outbound writer emits
// (_sendDataRecord's SBA helper). Encoding this any other way — including
// the standard 6-bit-compressed scheme other mocks in this folder use via
// an encode6()-style helper — silently corrupts any address whose low 6
// bits reach 0x3F, since that's where the two schemes diverge. Confirmed
// by testing directly against this engine, not assumed from the 3270 spec.
function encodeAddr(addr) {
  return [(addr >> 8) & 0x3F, addr & 0xFF];
}

function sba(row, col) { return [ORDER_SBA, ...encodeAddr(row * mockCols + col)]; }

function buildScreen(eraseFirst, fields) {
  const eraseCmd = mockCols !== 80 ? CMD_ERASE_WRITE_ALT : CMD_ERASE_WRITE;
  const parts = [eraseFirst ? eraseCmd : CMD_WRITE, 0xC3];
  for (const f of fields) {
    parts.push(...sba(f.row, f.col));
    if (f.fa !== undefined) {
      if (f.color !== undefined || f.highlight !== undefined) {
        const pairs = [[0xC0, f.fa]];
        if (f.color)     pairs.push([0x42, f.color]);
        if (f.highlight) pairs.push([0x41, f.highlight]);
        parts.push(ORDER_SFE, pairs.length);
        for (const [t, v] of pairs) parts.push(t, v);
      } else {
        parts.push(ORDER_SF, f.fa);
      }
    }
    if (f.ic) parts.push(ORDER_IC);
    if (f.saColor)     parts.push(ORDER_SA, 0x42, f.saColor);
    if (f.saHighlight) parts.push(ORDER_SA, 0x41, f.saHighlight);
    if (f.text) for (const b of toEbcdic(f.text)) parts.push(b);
    if (f.saColor || f.saHighlight) parts.push(ORDER_SA, 0x00, 0x00);
  }
  return Buffer.from(parts);
}

function wrapEOR(payload) {
  const out = [];
  for (const b of payload) { if (b === IAC) out.push(IAC, IAC); else out.push(b); }
  out.push(IAC, EOR);
  return Buffer.from(out);
}

// ── Mock claims data ─────────────────────────────────────────────────────
// One synthetic claim number per distinct outcome the VBA macro can log.
// "msg" is what appears on the row-22 status line; its leading characters
// are exactly what D9ATP_Override string-matches against, so don't shorten
// them without checking the comparison windows in the header comment above.
//
// kind:
//   'notfound' | 'alreadyprocessed' | 'invalid' | 'support' | 'wip'
//     → terminal message shown immediately after claim number entry
//   'valid'
//     → proceeds to line-number entry; see `lines`, `providerType`, `slots`, `overrideCode`
const MOCK_CLAIMS = {
  'CLAIM9990001': { kind: 'notfound' },
  'CLAIM9990002': { kind: 'alreadyprocessed' },
  'CLAIM9990003': { kind: 'invalid' },
  'CLAIM9990004': { kind: 'support' },
  'CLAIM9990005': { kind: 'wip' },

  // Valid claim, but no line numbers on file → INVALID LINE N on any input
  'CLAIM9990006': { kind: 'valid', lines: [], providerType: null, slots: null, overrideCode: null },

  // Valid claim, line '01' accepted, provider already ATTENDING / RENDERING
  'CLAIM9990007': { kind: 'valid', lines: ['01'], providerType: 'ATTENDING', slots: null, overrideCode: null },
  'CLAIM9990008': { kind: 'valid', lines: ['01'], providerType: 'RENDERING', slots: null, overrideCode: null },

  // Valid claim, line '01' accepted, all six provider slots already full
  'CLAIM9990009': { kind: 'valid', lines: ['01'], providerType: null, slots: [true, true, true, true, true, true], overrideCode: null },

  // Valid claim, one open slot, override rejected two different ways
  'CLAIM9990010': { kind: 'valid', lines: ['01'], providerType: null, slots: [true, true, true, true, true, false], overrideCode: 'EE562' },
  'CLAIM9990011': { kind: 'valid', lines: ['01'], providerType: null, slots: [true, true, true, true, true, false], overrideCode: 'EI940' },

  // Valid claim, one open slot, nothing wrong — the happy path
  'CLAIM9990012': { kind: 'valid', lines: ['01'], providerType: null, slots: [true, true, true, true, true, false], overrideCode: null },
};

const TERMINAL_MESSAGE = {
  notfound:         'CLAIM DOES NOT EXIST IN CLAIMS FILE',
  alreadyprocessed: 'CLAIM ALREADY PROCESSED - NO ACTION TAKEN',
  invalid:          'INVALID CLAIM POINTER - REBILL REQUIRED',
  support:          'CLAIM CANNOT BE PROCESSED - CONTACT SUPPORT',
  wip:              'FUNCTION INVALID - CONTACT SUPPORT (WIP)',
  invalidline:      'INVALID LINE NUMBER FOR THIS CLAIM',
  attending:        'ATTENDING PROVIDER ALREADY ON FILE',
  rendering:        'RENDERING PROVIDER ALREADY ON FILE',
  ee562:            'EE562 - INVALID OVERRIDE CODE ENTERED',
  ei940:            'EI940 - DUPLICATE CHARGES ON FILE',
};

// Row/col below are 0-based (this bridge's convention) — see header comment
// for the VBA's original 1-based coordinate and the conversion.
const F = {
  MENU_CMD:     { row: 2,  col: 12 },  // VBA: none — this screen isn't in the macro
  TRANSTYPE:    { row: 3,  col: 30 },  // VBA MoveCursor 4,31 / WaitForEvent rcEnterPos 4,31
  SUBTYPE:      { row: 7,  col: 30 },  // VBA MoveCursor 8,31
  CLAIMNUM:     { row: 13, col: 30 },  // VBA MoveCursor 14,31
  STATUS:       { row: 21, col: 6  },  // VBA GetDisplayText(22,7,len)
  LINEENTRY:    { row: 15, col: 16 },  // no VBA coordinate — cursor auto-lands here (IC)
  SLOTS: [
    { row: 6, col: 21 }, { row: 6, col: 27 }, { row: 6, col: 33 },  // VBA cols 22/28/34
    { row: 6, col: 39 }, { row: 6, col: 45 }, { row: 6, col: 51 },  // VBA cols 40/46/52
  ],
};

// ── Screen builders ──────────────────────────────────────────────────────
function screenMenu(note) {
  const fields = [
    { row: 0, col: 0, fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row: 0, col: 1, text: `MOCK BCBS CLAIMS SYSTEM - MAIN MENU  (${SYSNAME})` },
    { row: 1, col: 0, fa: FA_PROTECTED, color: COL_YELLOW },
    { row: 1, col: 1, text: 'Test data only — no real claims. Type RM2P and press Enter.' },
    { row: F.MENU_CMD.row, col: 0, fa: FA_PROTECTED, color: COL_WHITE },
    { row: F.MENU_CMD.row, col: 1, text: 'COMMAND ===>' },
    { row: F.MENU_CMD.row, col: F.MENU_CMD.col, fa: FA_UNPROTECTED },
    { row: F.MENU_CMD.row, col: F.MENU_CMD.col + 1, text: ' '.repeat(8), ic: true },
    { row: F.MENU_CMD.row, col: F.MENU_CMD.col + 9, fa: FA_PROTECTED },
  ];
  if (note) {
    fields.push({ row: 4, col: 0, fa: FA_PROTECTED, color: COL_RED });
    fields.push({ row: 4, col: 1, text: note.slice(0, 78) });
  }
  return buildScreen(true, fields);
}

function screenEntry() {
  return buildScreen(true, [
    { row: 0, col: 0,  fa: FA_PROTECTED_HIGH, color: COL_TURQ },
    { row: 0, col: 1,  text: 'RM72M70            RM2P 2ND PASS MEDICAL CLAIMS ENTRY' },
    { row: F.TRANSTYPE.row, col: 18, fa: FA_PROTECTED, color: COL_WHITE },
    { row: F.TRANSTYPE.row, col: 18, text: 'TRANS TYPE:' },
    { row: F.TRANSTYPE.row, col: F.TRANSTYPE.col - 1, fa: FA_UNPROTECTED, ic: true },
    { row: F.TRANSTYPE.row, col: F.TRANSTYPE.col, text: '  ' },
    { row: F.TRANSTYPE.row, col: F.TRANSTYPE.col + 2, fa: FA_PROTECTED },
    { row: F.SUBTYPE.row, col: 18, fa: FA_PROTECTED, color: COL_WHITE },
    { row: F.SUBTYPE.row, col: 18, text: 'SUB TYPE  :' },
    { row: F.SUBTYPE.row, col: F.SUBTYPE.col - 1, fa: FA_UNPROTECTED },
    { row: F.SUBTYPE.row, col: F.SUBTYPE.col, text: '  ' },
    { row: F.SUBTYPE.row, col: F.SUBTYPE.col + 2, fa: FA_PROTECTED },
    { row: F.CLAIMNUM.row, col: 12, fa: FA_PROTECTED, color: COL_WHITE },
    { row: F.CLAIMNUM.row, col: 12, text: 'CLAIM NUMBER:' },
    { row: F.CLAIMNUM.row, col: F.CLAIMNUM.col - 1, fa: FA_UNPROTECTED },
    { row: F.CLAIMNUM.row, col: F.CLAIMNUM.col, text: ' '.repeat(13) },
    { row: F.CLAIMNUM.row, col: F.CLAIMNUM.col + 13, fa: FA_PROTECTED },
    { row: F.STATUS.row, col: 0, fa: FA_PROTECTED, color: COL_RED },
    { row: F.STATUS.row, col: 1, text: '' },
    { row: 23, col: 0, fa: FA_PROTECTED, color: COL_BLUE },
    { row: 23, col: 1, text: 'PF3=RETURN TO MENU' },
  ]);
}

function screenTerminal(message) {
  return buildScreen(true, [
    { row: 0, col: 0,  fa: FA_PROTECTED_HIGH, color: COL_TURQ },
    { row: 0, col: 1,  text: 'RM72M70            RM2P 2ND PASS MEDICAL CLAIMS ENTRY' },
    { row: F.STATUS.row, col: 0, fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_INTENS },
    { row: F.STATUS.row, col: F.STATUS.col, text: message.slice(0, 74) },
    { row: 23, col: 0, fa: FA_PROTECTED, color: COL_BLUE },
    { row: 23, col: 1, text: 'ENTER or CLEAR to continue' },
  ]);
}

function screenLineEntry(claimNum) {
  return buildScreen(true, [
    { row: 0, col: 0,  fa: FA_PROTECTED_HIGH, color: COL_TURQ },
    { row: 0, col: 1,  text: 'RM72M70            RM2P 2ND PASS MEDICAL CLAIMS ENTRY' },
    { row: 1, col: 0, fa: FA_PROTECTED, color: COL_WHITE },
    { row: 1, col: 1, text: `CLAIM: ${claimNum}` },
    { row: F.LINEENTRY.row, col: 0, fa: FA_PROTECTED, color: COL_WHITE },
    { row: F.LINEENTRY.row, col: 1, text: 'LINE (N + line #):' },
    { row: F.LINEENTRY.row, col: F.LINEENTRY.col - 1, fa: FA_UNPROTECTED, ic: true },
    { row: F.LINEENTRY.row, col: F.LINEENTRY.col, text: ' '.repeat(6) },
    { row: F.LINEENTRY.row, col: F.LINEENTRY.col + 6, fa: FA_PROTECTED },
    { row: F.STATUS.row, col: 0, fa: FA_PROTECTED, color: COL_RED },
    { row: F.STATUS.row, col: 1, text: '' },
  ]);
}

function screenSlots(claimNum, slots, openIdx) {
  const fields = [
    { row: 0, col: 0,  fa: FA_PROTECTED_HIGH, color: COL_TURQ },
    { row: 0, col: 1,  text: 'RM72M70            RM2P 2ND PASS MEDICAL CLAIMS ENTRY' },
    { row: 1, col: 0, fa: FA_PROTECTED, color: COL_WHITE },
    { row: 1, col: 1, text: `CLAIM: ${claimNum}   LINE: 01` },
    { row: 5, col: 0, fa: FA_PROTECTED, color: COL_YELLOW },
    { row: 5, col: 1, text: 'PROVIDER SLOTS:' },
    { row: F.STATUS.row, col: 0, fa: FA_PROTECTED, color: COL_RED },
    { row: F.STATUS.row, col: 1, text: '' },
    { row: 23, col: 0, fa: FA_PROTECTED, color: COL_BLUE },
    { row: 23, col: 1, text: 'ENTER when slot filled, then PF2' },
  ];
  slots.forEach((filled, i) => {
    const pos = F.SLOTS[i];
    if (filled) {
      fields.push({ row: pos.row, col: pos.col - 1, fa: FA_PROTECTED, color: COL_WHITE });
      fields.push({ row: pos.row, col: pos.col, text: '12345' });
    } else {
      fields.push({ row: pos.row, col: pos.col - 1, fa: FA_UNPROTECTED, ic: i === openIdx });
      fields.push({ row: pos.row, col: pos.col, text: '     ' });
    }
  });
  return buildScreen(true, fields);
}

function screenPf2Wait(claimNum) {
  return buildScreen(true, [
    { row: 0, col: 0,  fa: FA_PROTECTED_HIGH, color: COL_TURQ },
    { row: 0, col: 1,  text: 'RM72M70            RM2P 2ND PASS MEDICAL CLAIMS ENTRY' },
    { row: 1, col: 0, fa: FA_PROTECTED, color: COL_WHITE },
    { row: 1, col: 1, text: `CLAIM: ${claimNum}   LINE: 01   SLOT FILLED — PRESS PF2 TO CONFIRM` },
    { row: F.STATUS.row, col: 0, fa: FA_PROTECTED, color: COL_RED },
    { row: F.STATUS.row, col: 1, text: '' },
  ]);
}

// ── Extract field text from client write ────────────────────────────────
function extractInputText(data) {
  let i = 3; // skip AID (1) + cursor address (2)
  let fieldAddr = -1;
  const fields = {};
  while (i < data.length) {
    const b = data[i];
    if (b === ORDER_SBA && i + 2 < data.length) {
      fieldAddr = (data[i+1] << 8) | data[i+2];
      if (!(fieldAddr in fields)) fields[fieldAddr] = [];
      i += 3; continue;
    }
    if (b === ORDER_IC) { i++; continue; }
    if (b >= 0x40 || b === 0x00) {
      if (fieldAddr >= 0) fields[fieldAddr].push(b);
      i++;
    } else { i++; }
  }
  const addrs = Object.keys(fields).map(Number).sort((a, b) => a - b);
  const result = [];
  for (const a of addrs) {
    const s = fields[a].map(b => EBCDIC_TO_ASCII[b])
                       .filter(c => c >= 0x20 && c < 0x7F)
                       .map(c => String.fromCharCode(c)).join('').trim();
    result.push(s);
  }
  return result;
}

// ── Session ──────────────────────────────────────────────────────────────
function createSession(socket) {
  let tn3270e = false;
  let negotiated = false;
  let cols = 80;

  // State machine: 'menu' | 'entry' | 'terminal' | 'lineEntry' | 'slots' | 'pf2wait'
  let state = 'menu';
  let currentClaim = null;   // { num, ...MOCK_CLAIMS entry }
  let openSlotIdx = -1;

  function send(buf) {
    try { if (!socket.destroyed) socket.write(buf); } catch {}
  }

  function sendScreen(screenBuf) {
    mockCols = cols;
    let payload;
    if (tn3270e) {
      const hdr = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      payload = Buffer.concat([hdr, screenBuf]);
    } else {
      payload = screenBuf;
    }
    send(wrapEOR(payload));
  }

  function showMenu(note)          { state = 'menu';      sendScreen(screenMenu(note)); }
  function showEntry()              { state = 'entry';     sendScreen(screenEntry()); }
  function showTerminal(msg)        { state = 'terminal';  sendScreen(screenTerminal(msg)); }
  function showLineEntry(claimNum)  { state = 'lineEntry'; sendScreen(screenLineEntry(claimNum)); }
  function showSlots(claimNum, slots, idx) { state = 'slots'; sendScreen(screenSlots(claimNum, slots, idx)); }
  function showPf2Wait(claimNum)    { state = 'pf2wait';   sendScreen(screenPf2Wait(claimNum)); }

  function handleMenuEnter(d) {
    const [cmd] = extractInputText(d);
    if ((cmd || '').trim().toUpperCase() === 'RM2P') { showEntry(); return; }
    showMenu(cmd ? `Unrecognized command: ${cmd}` : undefined);
  }

  function handleEntryEnter(d) {
    const [, , claimNumRaw] = extractInputText(d);
    const claimNum = (claimNumRaw || '').trim().toUpperCase();
    const claim = MOCK_CLAIMS[claimNum];

    if (!claim || claim.kind !== 'valid') {
      const kind = claim ? claim.kind : 'notfound';
      currentClaim = null;
      showTerminal(TERMINAL_MESSAGE[kind]);
      return;
    }

    currentClaim = { num: claimNum, ...claim };
    showLineEntry(claimNum);
  }

  function handleLineEntryEnter(d) {
    const [lineRaw] = extractInputText(d);
    const line = (lineRaw || '').replace(/^N/i, '').trim();

    if (!currentClaim.lines.includes(line)) {
      showTerminal(TERMINAL_MESSAGE.invalidline);
      return;
    }
    if (currentClaim.providerType === 'ATTENDING') { showTerminal(TERMINAL_MESSAGE.attending); return; }
    if (currentClaim.providerType === 'RENDERING') { showTerminal(TERMINAL_MESSAGE.rendering); return; }

    const slots = currentClaim.slots || [false, false, false, false, false, false];
    openSlotIdx = slots.findIndex(filled => !filled);
    // openSlotIdx === -1 means every slot's full — the VBA never gets a host
    // message for this, it just reads all six as non-blank and logs "FULL"
    // client-side, so the mock only needs to render them all filled.
    showSlots(currentClaim.num, slots, openSlotIdx);
  }

  function handleSlotsEnter() {
    if (openSlotIdx === -1) { showSlots(currentClaim.num, currentClaim.slots, -1); return; }
    showPf2Wait(currentClaim.num);
  }

  function handlePf2() {
    if (state !== 'pf2wait') return;
    const code = currentClaim.overrideCode;
    if (code === 'EE562') { showTerminal(TERMINAL_MESSAGE.ee562); return; }
    if (code === 'EI940') { showTerminal(TERMINAL_MESSAGE.ei940); return; }
    // Nothing flagged — this is "Complete": a clean status line, no message
    // to match, exactly what the real macro treats as success by omission.
    showTerminal('');
  }

  // ── Negotiation (identical shape to the other mocks in this folder) ──
  function startNegotiation() {
    send(Buffer.from([
      IAC, DO,   OPT_BINARY,
      IAC, WILL, OPT_BINARY,
      IAC, DO,   OPT_EOR,
      IAC, WILL, OPT_EOR,
      IAC, DO,   OPT_TN3270E,
    ]));
  }

  let buf = Buffer.alloc(0);

  function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (LOG) console.log('←', chunk.toString('hex'));
    parse();
  }

  function parse() {
    while (buf.length > 0) {
      if (buf[0] === IAC) {
        if (buf.length < 2) return;
        const cmd = buf[1];
        if (cmd === SB) {
          const seEnd = buf.indexOf(Buffer.from([IAC, SE]));
          if (seEnd < 0) return;
          const sb = buf.slice(2, seEnd);
          buf = buf.slice(seEnd + 2);
          handleSB(sb);
          continue;
        }
        if (buf.length < 3) return;
        const opt = buf[2];
        buf = buf.slice(3);
        handleOption(cmd, opt);
        continue;
      }
      const eorIdx = findEOR(buf);
      if (eorIdx < 0) return;
      const frame = buf.slice(0, eorIdx);
      buf = buf.slice(eorIdx + 2);
      handleFrame(frame);
    }
  }

  function findEOR(b) {
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i] === IAC && b[i+1] === EOR) return i;
    }
    return -1;
  }

  function handleOption(cmd, opt) {
    if (cmd === WILL && opt === OPT_TN3270E) {
      const devName = toEbcdic('IBM-3278-2-E');
      const luBuf   = toEbcdic(LU_NAME);
      send(Buffer.from([
        IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_REQUEST,
        ...devName, 0x01, ...luBuf, IAC, SE,
      ]));
    }
    if (cmd === WILL && opt === OPT_BINARY)  send(Buffer.from([IAC, DO,   OPT_BINARY]));
    if (cmd === DO   && opt === OPT_BINARY)  send(Buffer.from([IAC, WILL, OPT_BINARY]));
    if (cmd === DO   && opt === OPT_EOR)     send(Buffer.from([IAC, WILL, OPT_EOR]));
    if (cmd === WILL && opt === OPT_TTYPE)   send(Buffer.from([IAC, DONT, OPT_TTYPE]));
    if (cmd === WONT && opt === OPT_TN3270E) { /* classic TN3270 fallback */ }
  }

  function handleSB(sb) {
    if (sb[0] !== OPT_TN3270E) return;
    const type = sb[1];

    if (type === TN3E_DEVICE_TYPE && sb[2] === TN3E_IS) {
      tn3270e = true;
      const deviceStr = sb.slice(3).toString('ascii');
      const match = deviceStr.match(/IBM-(3278|3279)-(\d)(-E)?/);
      if (match) {
        const model = `${match[1]}-${match[2]}${match[3] || ''}`;
        const dims  = MODEL_DIMS[model];
        if (dims) cols = dims.cols;
      }
      send(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST, IAC, SE]));
    }

    if (type === TN3E_DEVICE_TYPE && sb[2] === TN3E_REQUEST) {
      const reqStr = sb.slice(3).toString('ascii');
      const match  = reqStr.match(/IBM-(3278|3279)-(\d)(-E)?/);
      let accepted = 'IBM-3278-2';
      if (match) {
        const model = `${match[1]}-${match[2]}${match[3] || ''}`;
        const dims  = MODEL_DIMS[model];
        if (dims) { accepted = `IBM-${model}`; cols = dims.cols; }
      }
      send(Buffer.from([
        IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS,
        ...Buffer.from(accepted), IAC, SE,
      ]));
    }

    if (type === TN3E_FUNCTIONS && sb[2] === TN3E_IS) {
      if (!negotiated) { negotiated = true; setImmediate(() => showMenu()); }
    }

    if (type === TN3E_FUNCTIONS && sb[2] === TN3E_REQUEST) {
      const requested = sb.slice(3);
      send(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS, ...requested, IAC, SE]));
      if (!negotiated) { negotiated = true; setImmediate(() => showMenu()); }
    }
  }

  function handleFrame(frame) {
    const data = frame;
    const unesc = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === IAC && data[i+1] === IAC) { unesc.push(IAC); i++; }
      else unesc.push(data[i]);
    }
    let d = Buffer.from(unesc);
    if (tn3270e) d = d.slice(5);
    if (d.length < 1) return;

    const aid = d[0];

    if (aid === AID_CLEAR) { showMenu(); return; }
    if (aid === AID_PF3)   { showMenu(); return; }
    if (aid === AID_PF2)   { handlePf2(); return; }
    if (aid === AID_PF4)   { return; } // E4747 retry key — no distinct outcome modeled here
    if (aid !== AID_ENTER) return;

    switch (state) {
      case 'menu':      handleMenuEnter(d);      break;
      case 'entry':      handleEntryEnter(d);     break;
      case 'terminal':   showMenu();              break; // mirrors the VBA clearing the screen after logging a status
      case 'lineEntry':  handleLineEntryEnter(d);  break;
      case 'slots':      handleSlotsEnter();       break;
      case 'pf2wait':    /* waiting specifically for PF2 */ break;
      default:           showMenu();
    }
  }

  socket.on('data', onData);
  socket.on('error', () => {});
  socket.on('close', () => {});
  startNegotiation();
}

// ── Server ───────────────────────────────────────────────────────────────
const server = net.createServer(socket => createSession(socket));

server.listen(PORT, '0.0.0.0', () => {
  console.log('─────────────────────────────────────────────────────');
  console.log('  WebTerm/3270 Mock Claims Daemon (RM2P)');
  console.log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  console.log(`  System ID     ${SYSNAME}`);
  console.log(`  LU Name       ${LU_NAME}`);
  console.log('  Protocol      TN3270E + classic TN3270 fallback');
  console.log('  Screens       Main Menu → RM2P Entry → Detail/Slots/PF2');
  console.log('  Test claims   CLAIM9990001 .. CLAIM9990012 (see MOCK_CLAIMS)');
  console.log('─────────────────────────────────────────────────────');
});
