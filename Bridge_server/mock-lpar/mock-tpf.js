/**
 * mock-lpar/mock-tpf.js
 * WebTerm/3270 — Mock z/TPF Operator Console Daemon
 *
 * Simulates a z/TPF system operator console over real TN3270(E) protocol.
 *
 * Screen flow:
 *   Operator Logon
 *       │  ENTER (valid credentials)
 *       ▼
 *   TPF Console (scrolling output log + command input)
 *       │  ZSHOW S / ZSHOW SYSTEM   → System status
 *       │  ZSHOW E / ZSHOW ENTRY    → Entry point list (ECB enumeration)
 *       │  ZSHOW P / ZSHOW POOLS    → Memory pool status
 *       │  ZSHOW T / ZSHOW TRANS    → Active transactions
 *       │  ZSHOW O / ZSHOW OPER     → Operator list
 *       │  ZSHOW V / ZSHOW VERSION  → z/TPF release info
 *       │  ZTEST ENTRY,xxx          → Probe a specific entry point
 *       │  ZSTOP,xxx                → Stop entry point (SYSOP+ only)
 *       │  ZENTRY,xxx               → Entry point management (SYSOP+ only)
 *       │  ZPROG,xxx                → Program management (SYSOP+ only)
 *       │  ZEND                     → System control (ADMIN only)
 *       │  LOGOFF                   → End session
 *
 * Privilege levels:
 *   OPER   (TPFOP01 / TPF1)   — ZSHOW only
 *   SYSOP  (SYSOP01 / SYS1)   — ZSHOW + ZSTOP + ZENTRY + ZPROG
 *   ADMIN  (ADMIN01 / ADMIN)   — All commands including ZEND
 *
 * Usage: MOCK_PORT=3274 MOCK_SYSID=TPFPROD node mock-tpf.js
 */

'use strict';

const net = require('net');

const PORT    = parseInt(process.env.MOCK_PORT  || '3274', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const SYSNAME = process.env.MOCK_SYSID || 'TPFPROD';
const RELEASE = 'z/TPF 1.1.0';

// ── Telnet / TN3270E constants ─────────────────────────────────────────────
const IAC  = 0xFF, DONT = 0xFE, DO   = 0xFD;
const WONT = 0xFC, WILL = 0xFB, SB   = 0xFA, SE = 0xF0;
const EOR  = 0xEF, NOP  = 0xF1;

const OPT_BINARY  = 0x00;
const OPT_EOR     = 0x19;
const OPT_TTYPE   = 0x18;
const OPT_TN3270E = 0x28;

const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

// ── 3270 stream constants ──────────────────────────────────────────────────
const CMD_ERASE_WRITE = 0xF5;
const CMD_WRITE       = 0xF1;
const ORDER_SF   = 0x1D;
const ORDER_SFE  = 0x29;
const ORDER_SA   = 0x28;
const ORDER_SBA  = 0x11;
const ORDER_IC   = 0x13;

const FA_PROTECTED       = 0x60;
const FA_PROTECTED_HIGH  = 0xE0;
const FA_UNPROTECTED     = 0x40;
const FA_UNPROTECTED_NUM = 0x50;
const FA_DARK            = 0x6C;  // protected + non-display (for password)

const COL_BLUE   = 0xF1;
const COL_RED    = 0xF2;
const COL_PINK   = 0xF3;
const COL_GREEN  = 0xF4;
const COL_TURQ   = 0xF5;
const COL_YELLOW = 0xF6;
const COL_WHITE  = 0xF7;

const HL_BLINK   = 0xF1;
const HL_REVERSE = 0xF2;
const HL_UNDER   = 0xF4;
const HL_INTENS  = 0xF8;

const AID_ENTER = 0x7D;
const AID_PF3   = 0xF3;
const AID_PF12  = 0xC3;
const AID_CLEAR = 0x6D;

// ── EBCDIC tables ─────────────────────────────────────────────────────────
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

function encodeAddr(addr) {
  const hi = (addr >> 6) & 0x3F;
  const lo =  addr       & 0x3F;
  const encode6 = n => n < 0x3F ? 0x40 + n : 0xC0 + (n - 0x3F);
  return [encode6(hi), encode6(lo)];
}

function sba(row, col) { return [ORDER_SBA, ...encodeAddr(row * 80 + col)]; }

function buildScreen(eraseFirst, fields) {
  const parts = [eraseFirst ? CMD_ERASE_WRITE : CMD_WRITE, 0xC3];
  for (const f of fields) {
    parts.push(...sba(f.row, f.col));
    if (f.fa !== undefined) {
      if (f.color !== undefined || f.highlight !== undefined) {
        const pairs = [[0xC0, f.fa]];
        if (f.color     !== undefined) pairs.push([0x42, f.color]);
        if (f.highlight !== undefined) pairs.push([0x41, f.highlight]);
        parts.push(ORDER_SFE, pairs.length);
        for (const [t, v] of pairs) parts.push(t, v);
      } else {
        parts.push(ORDER_SF, f.fa);
      }
    }
    if (f.ic) parts.push(ORDER_IC);
    if (f.saColor     !== undefined) parts.push(ORDER_SA, 0x42, f.saColor);
    if (f.saHighlight !== undefined) parts.push(ORDER_SA, 0x41, f.saHighlight);
    if (f.text) for (const b of toEbcdic(f.text)) parts.push(b);
    if (f.saColor !== undefined || f.saHighlight !== undefined) parts.push(ORDER_SA, 0x00, 0x00);
  }
  return Buffer.from(parts);
}

function wrapEOR(data) {
  const escaped = [];
  for (const b of data) { escaped.push(b); if (b === IAC) escaped.push(IAC); }
  escaped.push(IAC, EOR);
  return Buffer.from(escaped);
}

// ── Simulated Entry Control Blocks (ECBs / program segments) ──────────────
const ECB_TABLE = [
  { name: 'AARES', type: 'APPL',   status: 'ACTIVE', entries: 4,  transactions: 148203, desc: 'Airline Reservation Entry',     priv: false },
  { name: 'AUDT',  type: 'SYSTEM', status: 'ACTIVE', entries: 1,  transactions: 891442, desc: 'Audit Trail Logger',             priv: false },
  { name: 'AUTH',  type: 'APPL',   status: 'ACTIVE', entries: 3,  transactions: 291007, desc: 'Authorization Handler',          priv: true  },
  { name: 'AVAIL', type: 'APPL',   status: 'ACTIVE', entries: 6,  transactions: 504318, desc: 'Availability Check Engine',      priv: false },
  { name: 'BKNG',  type: 'APPL',   status: 'ACTIVE', entries: 8,  transactions: 338812, desc: 'Booking Engine',                 priv: false },
  { name: 'CCARD', type: 'APPL',   status: 'ACTIVE', entries: 2,  transactions: 782150, desc: 'Credit Card Authorization',      priv: true  },
  { name: 'CMGR',  type: 'SYSTEM', status: 'ACTIVE', entries: 1,  transactions: 1024000,desc: 'Connection Manager',             priv: true  },
  { name: 'DBAC',  type: 'SYSTEM', status: 'ACTIVE', entries: 2,  transactions: 2048901,desc: 'Database Access Layer',          priv: true  },
  { name: 'FARES', type: 'APPL',   status: 'ACTIVE', entries: 5,  transactions: 612441, desc: 'Fare Calculation Module',        priv: false },
  { name: 'HOTEL', type: 'APPL',   status: 'ACTIVE', entries: 3,  transactions: 98234,  desc: 'Hotel Reservation Handler',      priv: false },
  { name: 'LOGR',  type: 'SYSTEM', status: 'ACTIVE', entries: 1,  transactions: 2891003,desc: 'Transaction Logger',             priv: false },
  { name: 'PAYM',  type: 'APPL',   status: 'ACTIVE', entries: 4,  transactions: 441209, desc: 'Payment Processing',             priv: true  },
  { name: 'RPRT',  type: 'APPL',   status: 'IDLE',   entries: 2,  transactions: 12004,  desc: 'Reporting Module',               priv: false },
  { name: 'SECU',  type: 'SYSTEM', status: 'ACTIVE', entries: 3,  transactions: 291007, desc: 'Security Module',                priv: true  },
  { name: 'ADMN',  type: 'SYSTEM', status: 'ACTIVE', entries: 1,  transactions: 441,    desc: 'Admin Functions',                priv: true  },
];

const POOL_TABLE = [
  { name: 'ECBPOOL', size: '512M',  used: '389M',  pct: 76, type: 'ECB Storage',        warn: false },
  { name: 'FPOOL',   size: '256M',  used: '198M',  pct: 77, type: 'Fixed Storage',       warn: false },
  { name: 'GPOOL',   size: '128M',  used: '44M',   pct: 34, type: 'General Storage',     warn: false },
  { name: 'IPOOL',   size: '64M',   used: '61M',   pct: 95, type: 'I/O Buffer Pool',     warn: true  },
  { name: 'TPOOL',   size: '1024M', used: '712M',  pct: 70, type: 'Transaction Pool',    warn: false },
  { name: 'XPOOL',   size: '32M',   used: '31M',   pct: 97, type: 'Extended Storage',    warn: true  },
];

// ── Credentials + privilege levels ────────────────────────────────────────
// PRIV: 1=OPER (view only), 2=SYSOP (stop/manage), 3=ADMIN (all)
const CREDENTIALS = {
  'TPFOP01': { password: 'TPF1',  priv: 1, role: 'OPER'    },
  'SYSOP01': { password: 'SYS1',  priv: 2, role: 'SYSOP'   },
  'ADMIN01': { password: 'ADMIN', priv: 3, role: 'SYSPROG'  },
};

// ── Screens ────────────────────────────────────────────────────────────────
function screenLogon() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '/');
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:0,  col:24, text: `z/TPF OPERATOR CONSOLE LOGON` },
    { row:2,  col:2,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:2,  col:2,  text: `System  . . . : ${SYSNAME}       Release: ${RELEASE}` },
    { row:3,  col:2,  text: `Date/Time . . : ${dateStr}  ${timeStr}` },
    { row:5,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:5,  col:2,  text: 'Operator ID . :' },
    { row:5,  col:18, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:5,  col:18, text: '        ' },
    { row:6,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:6,  col:2,  text: 'Password  . . :' },
    { row:6,  col:18, fa: FA_DARK },
    { row:6,  col:18, text: '        ' },
    { row:9,  col:2,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:9,  col:2,  text: 'WARNING: Authorized users only. All sessions are monitored and logged.' },
    { row:11, col:2,  fa: FA_PROTECTED, color: COL_YELLOW },
    { row:11, col:2,  text: 'This system is for EDUCATIONAL DEMONSTRATION purposes only.' },
    { row:12, col:2,  text: 'Not connected to any live production z/TPF system.' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'ENTER=Logon   PF3=Exit' },
  ]);
}

function screenLogonError(operId) {
  return buildScreen(true, [
    { row:0,  col:24, fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:0,  col:24, text: `z/TPF OPERATOR CONSOLE LOGON` },
    { row:2,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_INTENS },
    { row:2,  col:2,  text: 'ZTPF001E OPERATOR AUTHENTICATION FAILURE' },
    { row:3,  col:2,  fa: FA_PROTECTED, color: COL_RED },
    { row:3,  col:2,  text: `ZTPF002E OPERATOR ID '${(operId || '').padEnd(8)}' NOT AUTHORIZED OR INVALID PASSWORD` },
    { row:5,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:5,  col:2,  text: 'Operator ID . :' },
    { row:5,  col:18, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:5,  col:18, text: '        ' },
    { row:6,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:6,  col:2,  text: 'Password  . . :' },
    { row:6,  col:18, fa: FA_DARK },
    { row:6,  col:18, text: '        ' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'ENTER=Retry   PF3=Exit' },
  ]);
}

// The main console screen — scrolling log + command input
function screenConsole(operId, role, outputLog) {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '/');

  // Header
  const fields = [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:0,  col:1,  text: `z/TPF SYSTEM - ${SYSNAME} - ${dateStr} ${timeStr}   OPER: ${operId.padEnd(8)} [${role}]` },
    { row:1,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:1,  col:0,  text: '─'.repeat(79) },
  ];

  // Output log — last 18 lines, rows 2–19
  const LOG_ROWS = 18;
  const displayLines = outputLog.slice(-LOG_ROWS);
  for (let i = 0; i < LOG_ROWS; i++) {
    const line = displayLines[i] || '';
    const isErr  = line.match(/^ZTPF\d{3}[EW]/);
    const isWarn = line.match(/^ZTPF\d{3}W/);
    const isHead = line.startsWith('──') || line.startsWith('  ') && line.includes('──');
    fields.push({ row: 2 + i, col: 0, fa: FA_PROTECTED, color: isErr ? (isWarn ? COL_YELLOW : COL_RED) : isHead ? COL_TURQ : COL_WHITE });
    if (line) fields.push({ row: 2 + i, col: 1, text: line.slice(0, 78) });
  }

  // Separator + command input
  fields.push(
    { row:20, col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:20, col:0,  text: '─'.repeat(79) },
    { row:21, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:21, col:1,  text: 'ENTER TPF COMMAND:' },
    { row:21, col:20, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:21, col:20, text: '                                                    ' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'ENTER=Execute   PF3=Logoff   PF12=Clear Log   LOGOFF=End session' },
  );

  return buildScreen(true, fields);
}

// ── Command handlers — return array of output lines ────────────────────────
function cmdZshowSystem() {
  const upDays = Math.floor(Math.random() * 60 + 10);
  const upHrs  = Math.floor(Math.random() * 24);
  const upMins = Math.floor(Math.random() * 60);
  const cpu    = (Math.random() * 20 + 5).toFixed(1);
  const trans  = Math.floor(Math.random() * 500 + 200);
  return [
    `ZTPF100I SYSTEM STATUS REPORT`,
    `ZTPF101I SYSTEM: ${SYSNAME}    RELEASE: ${RELEASE}`,
    `ZTPF102I STATUS: OPERATIONAL`,
    `ZTPF103I UPTIME: ${upDays} DAYS ${String(upHrs).padStart(2,'0')}:${String(upMins).padStart(2,'0')}:00`,
    `ZTPF104I ACTIVE ENTRY POINTS: ${ECB_TABLE.filter(e=>e.status==='ACTIVE').length}`,
    `ZTPF105I TOTAL TRANSACTIONS/SEC: ${trans}`,
    `ZTPF106I CPU UTILIZATION: ${cpu}%`,
    `ZTPF107I OPERATORS LOGGED ON: 3`,
    `ZTPF108I SYSTEM ALERTS: ${POOL_TABLE.filter(p=>p.warn).length} WARNING(S) ACTIVE`,
  ];
}

function cmdZshowEntry() {
  const lines = [
    `ZTPF200I ENTRY POINT DIRECTORY - ${ECB_TABLE.length} ENTRIES`,
    `ZTPF201I ${'NAME'.padEnd(8)} ${'TYPE'.padEnd(8)} ${'STATUS'.padEnd(8)} ${'ENTRIES'.padStart(7)} ${'TRANSACTIONS'.padStart(13)}  DESCRIPTION`,
    `         ${'────'.padEnd(8)} ${'────'.padEnd(8)} ${'──────'.padEnd(8)} ${'───────'.padStart(7)} ${'────────────'.padStart(13)}  ───────────────────────`,
  ];
  for (const e of ECB_TABLE) {
    const flag = e.priv ? ' [PRIV]' : '';
    lines.push(`         ${e.name.padEnd(8)} ${e.type.padEnd(8)} ${e.status.padEnd(8)} ${String(e.entries).padStart(7)} ${String(e.transactions).padStart(13)}  ${e.desc}${flag}`);
  }
  lines.push(`ZTPF202I END OF ENTRY POINT DIRECTORY`);
  return lines;
}

function cmdZshowPools() {
  const lines = [
    `ZTPF300I MEMORY POOL STATUS`,
    `ZTPF301I ${'POOL'.padEnd(8)} ${'TYPE'.padEnd(22)} ${'SIZE'.padStart(6)} ${'USED'.padStart(6)} ${'PCT'.padStart(4)}  STATUS`,
    `         ${'────'.padEnd(8)} ${'────'.padEnd(22)} ${'────'.padStart(6)} ${'────'.padStart(6)} ${'───'.padStart(4)}  ──────`,
  ];
  for (const p of POOL_TABLE) {
    const status = p.warn ? `*** WARNING: ${p.pct}% UTILIZED ***` : 'OK';
    lines.push(`         ${p.name.padEnd(8)} ${p.type.padEnd(22)} ${p.size.padStart(6)} ${p.used.padStart(6)} ${String(p.pct).padStart(3)}%  ${status}`);
  }
  const warnPools = POOL_TABLE.filter(p => p.warn);
  if (warnPools.length > 0) {
    lines.push(`ZTPF302W ${warnPools.length} POOL(S) ABOVE 90% CAPACITY - IMMEDIATE ATTENTION REQUIRED`);
  } else {
    lines.push(`ZTPF302I ALL POOLS WITHIN NORMAL LIMITS`);
  }
  return lines;
}

function cmdZshowTrans() {
  const now = Date.now();
  const trans = [
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'AARES', lu: 'LU00423', age:  124, aid: 'A1F3' },
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'CCARD', lu: 'LU00891', age:   38, aid: 'C2B4' },
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'BKNG',  lu: 'LU01204', age:  891, aid: 'B3A1' },
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'PAYM',  lu: 'LU00077', age: 2341, aid: 'P1C2' },
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'AVAIL', lu: 'LU00334', age:   12, aid: 'A2D5' },
    { id: `T${Math.floor(Math.random()*900000+100000)}`, entry: 'FARES', lu: 'LU01088', age:  441, aid: 'F1A3' },
  ];
  const lines = [
    `ZTPF400I ACTIVE TRANSACTION DISPLAY`,
    `ZTPF401I ${'TRANS-ID'.padEnd(12)} ${'ENTRY'.padEnd(8)} ${'LU NAME'.padEnd(10)} ${'AGE(ms)'.padStart(8)} ${'AID'.padStart(6)}`,
    `         ${'────────'.padEnd(12)} ${'─────'.padEnd(8)} ${'───────'.padEnd(10)} ${'───────'.padStart(8)} ${'───'.padStart(6)}`,
  ];
  for (const t of trans) {
    const ageWarn = t.age > 1000;
    lines.push(`         ${t.id.padEnd(12)} ${t.entry.padEnd(8)} ${t.lu.padEnd(10)} ${String(t.age).padStart(8)} ${t.aid.padStart(6)}${ageWarn ? '  *** LONG RUNNING ***' : ''}`);
  }
  lines.push(`ZTPF402I ${trans.length} ACTIVE TRANSACTIONS DISPLAYED`);
  return lines;
}

function cmdZshowOper() {
  const lines = [
    `ZTPF500I OPERATOR CONSOLE STATUS`,
    `ZTPF501I ${'OPER-ID'.padEnd(10)} ${'ROLE'.padEnd(10)} ${'LOGON-TIME'.padEnd(12)} ${'TERMINAL'.padEnd(10)} LAST-CMD`,
    `         ${'───────'.padEnd(10)} ${'────'.padEnd(10)} ${'──────────'.padEnd(12)} ${'────────'.padEnd(10)} ────────`,
    `         TPFOP01    OPER       09:14:22     TRM001     ZSHOW S`,
    `         SYSOP01    SYSOP      07:32:01     TRM002     ZSHOW E`,
    `         ADMIN01    SYSPROG    06:00:00     TRM003     ZEND CHECK`,
    `ZTPF502I 3 OPERATOR(S) CURRENTLY LOGGED ON`,
  ];
  return lines;
}

function cmdZshowVersion() {
  return [
    `ZTPF600I z/TPF VERSION INFORMATION`,
    `ZTPF601I PRODUCT  : IBM z/Transaction Processing Facility`,
    `ZTPF602I RELEASE  : ${RELEASE}`,
    `ZTPF603I BUILD    : PTF-2024-0612-001`,
    `ZTPF604I PLATFORM : IBM Z (z16 compatible)`,
    `ZTPF605I PROTOCOL : TN3270E RFC-2355`,
    `ZTPF606I CONSOLE  : Operator Console Daemon v2.1`,
  ];
}

function cmdZtestEntry(entryName) {
  if (!entryName) return [`ZTPF700E ZTEST ENTRY - ENTRY NAME REQUIRED`, `ZTPF701I SYNTAX: ZTEST ENTRY,<name>`];
  const e = ECB_TABLE.find(x => x.name === entryName.toUpperCase());
  if (!e) {
    return [
      `ZTPF700E ZTEST - ENTRY POINT '${entryName.toUpperCase()}' NOT FOUND IN DIRECTORY`,
      `ZTPF701I USE ZSHOW E TO LIST AVAILABLE ENTRY POINTS`,
    ];
  }
  const respMs = Math.floor(Math.random() * 40 + 5);
  return [
    `ZTPF710I ZTEST ENTRY '${e.name}' - PROBE INITIATED`,
    `ZTPF711I DESCRIPTION  : ${e.desc}`,
    `ZTPF712I TYPE         : ${e.type}`,
    `ZTPF713I STATUS       : ${e.status}`,
    `ZTPF714I ENTRY POINTS : ${e.entries}`,
    `ZTPF715I PRIVILEGED   : ${e.priv ? 'YES - REQUIRES AUTH' : 'NO'}`,
    `ZTPF716I PROBE RESULT : ENTRY POINT RESPONDED IN ${respMs}ms`,
    `ZTPF717I TRANSACTIONS : ${e.transactions.toLocaleString()} (lifetime)`,
    e.priv
      ? `ZTPF718W ENTRY POINT HANDLES PRIVILEGED DATA - MONITOR ACCESS`
      : `ZTPF718I ENTRY POINT STATUS: HEALTHY`,
  ];
}

function cmdZstop(entryName, priv) {
  if (priv < 2) return [`ZTPF800E ZSTOP - AUTHORIZATION FAILURE`, `ZTPF801E ROLE 'OPER' NOT AUTHORIZED FOR ZSTOP`, `ZTPF802E REQUIRES: SYSOP OR SYSPROG`];
  if (!entryName) return [`ZTPF800E ZSTOP - ENTRY NAME REQUIRED`, `ZTPF801I SYNTAX: ZSTOP,<name>`];
  const e = ECB_TABLE.find(x => x.name === entryName.toUpperCase());
  if (!e) return [`ZTPF800E ZSTOP - ENTRY POINT '${entryName.toUpperCase()}' NOT FOUND`];
  if (e.type === 'SYSTEM') return [
    `ZTPF803W ZSTOP - '${e.name}' IS A SYSTEM ENTRY POINT`,
    `ZTPF804W STOPPING SYSTEM ENTRY POINTS MAY CAUSE SYSTEM INSTABILITY`,
    `ZTPF805I ZSTOP REJECTED - USE ZEND FOR SYSTEM PROGRAM CONTROL`,
  ];
  e.status = 'STOPPED';
  return [
    `ZTPF810I ZSTOP - ENTRY POINT '${e.name}' STOP INITIATED`,
    `ZTPF811I DRAINING IN-FLIGHT TRANSACTIONS...`,
    `ZTPF812I ENTRY POINT '${e.name}' STATUS: STOPPED`,
    `ZTPF813W NEW TRANSACTIONS TO '${e.name}' WILL BE REJECTED UNTIL RESTARTED`,
  ];
}

function cmdZentry(entryName, priv) {
  if (priv < 2) return [`ZTPF850E ZENTRY - AUTHORIZATION FAILURE`, `ZTPF851E REQUIRES: SYSOP OR SYSPROG`];
  if (!entryName) return [`ZTPF850E ZENTRY - ENTRY NAME REQUIRED`, `ZTPF851I SYNTAX: ZENTRY,<name>`];
  const e = ECB_TABLE.find(x => x.name === entryName.toUpperCase());
  if (!e) return [`ZTPF850E ZENTRY - '${entryName.toUpperCase()}' NOT FOUND`];
  const addr = (0x0F000000 + Math.floor(Math.random() * 0x00FFFFFF)).toString(16).toUpperCase();
  return [
    `ZTPF860I ZENTRY '${e.name}' - ENTRY POINT DETAIL`,
    `ZTPF861I BASE ADDRESS : 0x${addr}`,
    `ZTPF862I ENTRY COUNT  : ${e.entries}`,
    `ZTPF863I LOAD MODULE  : ${e.name}00`,
    `ZTPF864I AUTH LEVEL   : ${e.priv ? 'PRIVILEGED' : 'STANDARD'}`,
    `ZTPF865I ACTIVE CONNS : ${Math.floor(Math.random() * 50)}`,
  ];
}

function cmdZprog(arg, priv) {
  if (priv < 2) return [`ZTPF870E ZPROG - AUTHORIZATION FAILURE`, `ZTPF871E REQUIRES: SYSOP OR SYSPROG`];
  return [
    `ZTPF880I ZPROG ${arg || ''} - PROGRAM CONTROL`,
    `ZTPF881I LOADED SEGMENTS: ${ECB_TABLE.length}`,
    `ZTPF882I ACTIVE        : ${ECB_TABLE.filter(e=>e.status==='ACTIVE').length}`,
    `ZTPF883I IDLE/STOPPED  : ${ECB_TABLE.filter(e=>e.status!=='ACTIVE').length}`,
    `ZTPF884I USE ZSHOW E FOR FULL SEGMENT LISTING`,
  ];
}

function cmdZend(arg, priv) {
  if (priv < 3) {
    return [
      `ZTPF900E ZEND - AUTHORIZATION FAILURE`,
      `ZTPF901E OPERATOR PRIVILEGE LEVEL INSUFFICIENT`,
      `ZTPF902E ZEND REQUIRES: SYSPROG AUTHORITY`,
      `ZTPF903E THIS ATTEMPT HAS BEEN LOGGED`,
    ];
  }
  if (!arg) {
    return [
      `ZTPF910I ZEND - SYSTEM CONTROL FACILITY`,
      `ZTPF911I SUBCOMMANDS: CHECK, STATUS, QUIESCE, RESUME`,
      `ZTPF912I SYNTAX: ZEND <subcommand>`,
    ];
  }
  switch (arg.toUpperCase()) {
    case 'CHECK':
      return [
        `ZTPF920I ZEND CHECK - SYSTEM INTEGRITY VERIFICATION`,
        `ZTPF921I CHECKING ENTRY POINT TABLE...    OK`,
        `ZTPF922I CHECKING POOL INTEGRITY...       ${POOL_TABLE.filter(p=>p.warn).length > 0 ? 'WARNING' : 'OK'}`,
        `ZTPF923I CHECKING OPERATOR SESSIONS...    OK`,
        `ZTPF924I CHECKING SECURITY MODULE...      OK`,
        POOL_TABLE.filter(p=>p.warn).length > 0
          ? `ZTPF925W ${POOL_TABLE.filter(p=>p.warn).length} POOL WARNING(S) DETECTED`
          : `ZTPF925I ALL CHECKS PASSED`,
      ];
    case 'STATUS':
      return [
        `ZTPF930I ZEND STATUS - SYSTEM CONTROL STATE`,
        `ZTPF931I SYSTEM STATE  : OPERATIONAL`,
        `ZTPF932I QUIESCE STATE : NOT QUIESCED`,
        `ZTPF933I DRAIN STATE   : NOT DRAINING`,
        `ZTPF934I MAINT MODE    : INACTIVE`,
      ];
    case 'QUIESCE':
      return [
        `ZTPF940W ZEND QUIESCE - INITIATED (EDUCATIONAL SIMULATION ONLY)`,
        `ZTPF941W IN A LIVE SYSTEM: NEW TRANSACTIONS WOULD BE REJECTED`,
        `ZTPF942W IN A LIVE SYSTEM: IN-FLIGHT TRANSACTIONS WOULD DRAIN`,
        `ZTPF943I SIMULATION: NO ACTUAL QUIESCE PERFORMED`,
      ];
    default:
      return [`ZTPF900E ZEND - UNKNOWN SUBCOMMAND: ${arg}`, `ZTPF901I VALID: CHECK STATUS QUIESCE RESUME`];
  }
}

function cmdUnknown(cmd) {
  return [
    `ZTPF999E COMMAND NOT RECOGNIZED: ${cmd}`,
    `ZTPF999I VALID COMMANDS: ZSHOW, ZTEST, ZSTOP, ZENTRY, ZPROG, ZEND, LOGOFF`,
    `ZTPF999I FOR HELP: ZSHOW <option>  OPTIONS: S E P T O V`,
  ];
}

// ── Parse and dispatch a TPF command ──────────────────────────────────────
function dispatchCommand(raw, priv) {
  const input = raw.trim().toUpperCase();
  if (!input) return [];

  const ts    = new Date().toLocaleTimeString('en-US', { hour12: false });
  const echo  = [`${ts} ${raw.trim()}`];

  let result;
  if (input === 'ZSHOW S' || input === 'ZSHOW SYSTEM')         result = cmdZshowSystem();
  else if (input === 'ZSHOW E' || input === 'ZSHOW ENTRY')     result = cmdZshowEntry();
  else if (input === 'ZSHOW P' || input === 'ZSHOW POOLS')     result = cmdZshowPools();
  else if (input === 'ZSHOW T' || input === 'ZSHOW TRANS')     result = cmdZshowTrans();
  else if (input === 'ZSHOW O' || input === 'ZSHOW OPER')      result = cmdZshowOper();
  else if (input === 'ZSHOW V' || input === 'ZSHOW VERSION')   result = cmdZshowVersion();
  else if (input.startsWith('ZTEST ENTRY,'))                   result = cmdZtestEntry(input.slice('ZTEST ENTRY,'.length));
  else if (input.startsWith('ZSTOP,'))                         result = cmdZstop(input.slice('ZSTOP,'.length), priv);
  else if (input.startsWith('ZENTRY,'))                        result = cmdZentry(input.slice('ZENTRY,'.length), priv);
  else if (input.startsWith('ZPROG'))                          result = cmdZprog(input.slice('ZPROG').trim(), priv);
  else if (input.startsWith('ZEND'))                           result = cmdZend(input.slice('ZEND').trim(), priv);
  else                                                         result = cmdUnknown(input);

  return [...echo, ...result, ''];
}

// ── TN3270 connection handler ──────────────────────────────────────────────
let connCount = 0;

function handleConnection(socket) {
  const id = ++connCount;
  log(`[${id}] Connected from ${socket.remoteAddress}:${socket.remotePort}`);

  let recvBuf            = Buffer.alloc(0);
  let tn3270eMode        = false;
  let negotiationComplete = false;
  let currentScreen      = 'logon';
  let operId             = '';
  let operPriv           = 0;
  let operRole           = '';
  let outputLog          = [];
  let loginAttempts      = 0;

  // Initial TN3270E negotiation
  socket.write(Buffer.from([
    IAC, DO,   OPT_TN3270E,
    IAC, DO,   OPT_BINARY,
    IAC, WILL, OPT_BINARY,
    IAC, DO,   OPT_EOR,
    IAC, WILL, OPT_EOR,
  ]));

  socket.on('data', chunk => { recvBuf = Buffer.concat([recvBuf, chunk]); processBuffer(); });
  socket.on('end',   () => log(`[${id}] Disconnected`));
  socket.on('error', err => log(`[${id}] Error: ${err.message}`));

  function processBuffer() {
    let i = 0;
    while (i < recvBuf.length) {
      if (recvBuf[i] !== IAC) { i++; continue; }
      const cmd = recvBuf[i + 1];
      if (cmd === undefined) break;
      if (cmd === NOP) { i += 2; continue; }
      if (cmd === EOR) {
        const record = [];
        for (let j = 0; j < i; j++) {
          if (recvBuf[j] === IAC && recvBuf[j+1] === IAC) { record.push(0xFF); j++; }
          else record.push(recvBuf[j]);
        }
        recvBuf = recvBuf.slice(i + 2);
        if (record.length > 0) handle3270Record(Buffer.from(record));
        i = 0; continue;
      }
      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= recvBuf.length) break;
        handleTelnetCmd(cmd, recvBuf[i + 2]);
        recvBuf = Buffer.concat([recvBuf.slice(0, i), recvBuf.slice(i + 3)]);
        continue;
      }
      if (cmd === SB) {
        const seIdx = findSE(i + 2);
        if (seIdx === -1) break;
        handleSubneg(recvBuf.slice(i + 2, seIdx));
        recvBuf = Buffer.concat([recvBuf.slice(0, i), recvBuf.slice(seIdx + 2)]);
        continue;
      }
      i += 2;
    }
  }

  function findSE(start) {
    for (let j = start; j < recvBuf.length - 1; j++) {
      if (recvBuf[j] === IAC && recvBuf[j+1] === SE) return j;
    }
    return -1;
  }

  function handleTelnetCmd(cmd, opt) {
    if (opt === OPT_TN3270E) {
      if (cmd === WILL) {
        tn3270eMode = true;
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_REQUEST,
          ...Buffer.from('IBM-3278-2'), IAC, SE,
        ]));
      } else if (cmd === WONT) {
        tn3270eMode = false;
        socket.write(Buffer.from([IAC, SB, OPT_TTYPE, TN3E_SEND, IAC, SE]));
      }
      return;
    }
    if (opt === OPT_TTYPE && cmd === WILL) socket.write(Buffer.from([IAC, SB, OPT_TTYPE, TN3E_SEND, IAC, SE]));
    if (opt === OPT_BINARY && cmd === WILL) socket.write(Buffer.from([IAC, DO, OPT_BINARY]));
    if (opt === OPT_EOR    && cmd === WILL) socket.write(Buffer.from([IAC, DO, OPT_EOR]));
  }

  function handleSubneg(data) {
    const opt = data[0], func = data[1];
    if (opt === OPT_TN3270E) {
      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_IS) {
        socket.write(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST, IAC, SE]));
      }
      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REQUEST) {
        socket.write(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS, ...Buffer.from('IBM-3278-2'), IAC, SE]));
      }
      if (func === TN3E_FUNCTIONS && (data[2] === TN3E_IS || data[2] === TN3E_REQUEST)) {
        if (data[2] === TN3E_REQUEST) {
          socket.write(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS, ...data.slice(3), IAC, SE]));
        }
        if (!negotiationComplete) { negotiationComplete = true; setImmediate(() => sendCurrentScreen()); }
      }
    }
    if (opt === OPT_TTYPE && func === TN3E_IS) {
      if (!negotiationComplete) { negotiationComplete = true; setImmediate(() => sendCurrentScreen()); }
    }
  }

  function handle3270Record(data) {
    if (data.length === 0) return;
    const aid = data[0];
    debug(`[${id}] ← AID 0x${aid.toString(16).toUpperCase()} screen='${currentScreen}'`);

    let inputText = '';
    if (data.length > 3) {
      let j = 3;
      while (j < data.length) {
        const b = data[j];
        if (b === 0x11 && j + 2 < data.length) { inputText += ' '; j += 3; }
        else if (b >= 0x40 || b === 0x00) { inputText += String.fromCharCode(EBCDIC_TO_ASCII[b] || 0x20); j++; }
        else j++;
      }
      inputText = inputText.trim();
    }
    debug(`[${id}] Input: '${inputText}'`);

    switch (currentScreen) {
      case 'logon':
      case 'logonError':
        if (aid === AID_ENTER) {
          const parts     = inputText.split(/\s+/).filter(Boolean);
          const enteredId = (parts[0] || '').toUpperCase().slice(0, 8);
          const enteredPw = parts[1] || '';
          const cred      = CREDENTIALS[enteredId];
          if (cred && enteredPw === cred.password) {
            loginAttempts = 0;
            operId   = enteredId;
            operPriv = cred.priv;
            operRole = cred.role;
            log(`[${id}] Logon success: ${operId} [${operRole}]`);
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
            outputLog = [
              `ZTPF000I LOGON ACCEPTED - OPERATOR ${operId} [${operRole}]`,
              `ZTPF001I SESSION STARTED AT ${ts}`,
              `ZTPF002I SYSTEM: ${SYSNAME}  RELEASE: ${RELEASE}`,
              ``,
              `ZTPF003I TYPE ZSHOW S FOR SYSTEM STATUS`,
              `ZTPF004I TYPE ZSHOW E TO LIST ALL ENTRY POINTS`,
              ``,
            ];
            currentScreen = 'console';
          } else {
            loginAttempts++;
            log(`[${id}] Logon failed for '${enteredId}' — attempt ${loginAttempts}`);
            currentScreen = 'logonError';
          }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'console':
        if (aid === AID_ENTER) {
          const rawCmd = inputText.replace(/\s+/g, ' ').trim();
          if (rawCmd.toUpperCase() === 'LOGOFF' || rawCmd.toUpperCase() === 'LOGOFF,HOLD') {
            log(`[${id}] Operator ${operId} logged off`);
            socket.end(); return;
          }
          if (rawCmd) {
            const lines = dispatchCommand(rawCmd, operPriv);
            outputLog.push(...lines);
            // Keep log bounded to 500 lines
            if (outputLog.length > 500) outputLog = outputLog.slice(-500);
            log(`[${id}] CMD: '${rawCmd}'`);
          }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          log(`[${id}] Operator ${operId} logged off (PF3)`);
          socket.end();
        } else if (aid === AID_PF12 || aid === AID_CLEAR) {
          outputLog = [`ZTPF010I CONSOLE LOG CLEARED BY ${operId}`, ``];
          sendCurrentScreen();
        }
        break;
    }
  }

  function sendCurrentScreen() {
    let ds;
    switch (currentScreen) {
      case 'logon':      ds = screenLogon();                            break;
      case 'logonError': ds = screenLogonError(operId);                 break;
      case 'console':    ds = screenConsole(operId, operRole, outputLog); break;
      default:           ds = screenLogon();
    }
    if (tn3270eMode) ds = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), ds]);
    socket.write(wrapEOR(ds));
    log(`[${id}] → Screen: ${currentScreen}`);
  }
}

function log(msg)   { console.log(`${new Date().toISOString()} [INFO ] ${msg}`); }
function debug(msg) { if (LOG) console.log(`${new Date().toISOString()} [DEBUG] ${msg}`); }

const server = net.createServer(handleConnection);
server.listen(PORT, '0.0.0.0', () => {
  log('─────────────────────────────────────────────────────');
  log(`  WebTerm/3270 Mock z/TPF Daemon`);
  log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  log(`  System ID     ${SYSNAME}`);
  log(`  Release       ${RELEASE}`);
  log(`  Credentials   TPFOP01/TPF1 (OPER) | SYSOP01/SYS1 (SYSOP) | ADMIN01/ADMIN (SYSPROG)`);
  log('─────────────────────────────────────────────────────');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') log(`ERROR: Port ${PORT} already in use`);
  else log(`ERROR: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT',  () => { log('Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('Shutting down...'); server.close(() => process.exit(0)); });
