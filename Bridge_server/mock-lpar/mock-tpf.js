'use strict';

const net = require('net');

const PORT    = parseInt(process.env.MOCK_PORT  || '3274', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const LU_NAME = process.env.MOCK_LU    || 'TPFLU01';
const SYSNAME = process.env.MOCK_SYSID || 'TPFSYS1';

// ── Telnet constants ──────────────────────────────────────────────────────
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

// ── 3270 datastream constants ─────────────────────────────────────────────
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

const HL_BLINK   = 0xF1;
const HL_REVERSE = 0xF2;
const HL_UNDER   = 0xF4;
const HL_INTENS  = 0xF8;

const AID_ENTER = 0x7D;
const AID_CLEAR = 0x6D;
const AID_PF3   = 0xF3;

// ── EBCDIC tables (CP037) ─────────────────────────────────────────────────
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

// Screen dims by negotiated device type — mirrors tn3270/session.js's MODEL_DIMS
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

// Set from the connection's negotiated device type just before each screen is
// built — buildScreen/sba run synchronously off that, so this is safe despite
// being module-level shared state.
let mockCols = 80;

function encodeAddr(addr) {
  const hi = (addr >> 6) & 0x3F;
  const lo =  addr       & 0x3F;
  const encode6 = n => n < 0x3F ? 0x40 + n : 0xC0 + (n - 0x3F);
  return [encode6(hi), encode6(lo)];
}

function sba(row, col) { return [ORDER_SBA, ...encodeAddr(row * mockCols + col)]; }

function buildScreen(eraseFirst, fields) {
  // Per the 3270 datastream spec, plain Erase Write selects the DEFAULT
  // 24×80 screen; only Erase Write Alternate activates the model's wider
  // geometry. So when addressing a non-80-col screen we must send EWA,
  // or a conforming client (x3270, our bridge) will decode at stride 80.
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

// ── z/TPF system data ─────────────────────────────────────────────────────
const CREDENTIALS = {
  TPFOP01: { pass: 'TPF1',  role: 'OPER',    priv: 1 },
  SYSOP01: { pass: 'SYS1',  role: 'SYSOP',   priv: 2 },
  ADMIN01: { pass: 'ADMIN', role: 'SYSPROG',  priv: 3 },
};

const ECB_TABLE = [
  { name:'AARES', type:'APPL',   status:'ACTIVE',  entries:3,  txn:'1,482,933', priv:false },
  { name:'AUTH',  type:'SYSTEM', status:'ACTIVE',  entries:1,  txn:'  928,441', priv:true  },
  { name:'AVAIL', type:'APPL',   status:'ACTIVE',  entries:2,  txn:'  447,021', priv:false },
  { name:'BKNG',  type:'APPL',   status:'ACTIVE',  entries:5,  txn:'2,118,834', priv:false },
  { name:'CCARD', type:'SYSTEM', status:'ACTIVE',  entries:2,  txn:'  782,119', priv:true  },
  { name:'FARES', type:'APPL',   status:'ACTIVE',  entries:4,  txn:'3,042,551', priv:false },
  { name:'HOTEL', type:'APPL',   status:'ACTIVE',  entries:3,  txn:'  612,280', priv:false },
  { name:'LOGR',  type:'SYSTEM', status:'ACTIVE',  entries:1,  txn:'5,119,002', priv:true  },
  { name:'PAYM',  type:'SYSTEM', status:'ACTIVE',  entries:2,  txn:'1,334,867', priv:true  },
  { name:'SECU',  type:'SYSTEM', status:'ACTIVE',  entries:1,  txn:'  203,441', priv:true  },
  { name:'RSVP',  type:'APPL',   status:'ACTIVE',  entries:3,  txn:'  881,320', priv:false },
  { name:'SCHD',  type:'APPL',   status:'IDLE',    entries:2,  txn:'       0',  priv:false },
  { name:'TCKP',  type:'APPL',   status:'ACTIVE',  entries:4,  txn:'1,029,447', priv:false },
  { name:'UPGD',  type:'APPL',   status:'IDLE',    entries:1,  txn:'       0',  priv:false },
  { name:'WLST',  type:'APPL',   status:'ACTIVE',  entries:2,  txn:'  447,992', priv:false },
];

const POOL_TABLE = [
  { name:'ECBPOOL', addr:'00A00000', size:'128M', used:' 64M', pct:50  },
  { name:'FPOOL',   addr:'01000000', size:'256M', used:'128M', pct:50  },
  { name:'GPOOL',   addr:'02000000', size:'512M', used:'320M', pct:62  },
  { name:'IPOOL',   addr:'04000000', size:'128M', used:'122M', pct:95  },
  { name:'TPOOL',   addr:'05000000', size:'256M', used:'180M', pct:70  },
  { name:'XPOOL',   addr:'06000000', size: '64M', used:' 62M', pct:97  },
];

// ── Command dispatch ──────────────────────────────────────────────────────
function dispatchCommand(raw, priv) {
  const upper = raw.trim().toUpperCase();
  const [verb, ...args] = upper.split(/[\s,]+/);
  const rest = args.join(' ');

  switch (verb) {
    case 'ZSHOW':
      switch (args[0]) {
        case 'E': return cmdZshowEntry();
        case 'P': return cmdZshowPools();
        case 'S': return cmdZshowSystem();
        case 'T': return cmdZshowTrans();
        case 'O': return cmdZshowOper();
        case 'V': return cmdZshowVersion();
        default:  return [`ZTPF001E ZSHOW ${args[0] || ''} — unknown subcommand. Use E P S T O V`];
      }
    case 'ZTEST':
      if (args[0] === 'ENTRY' && args[1]) return cmdZtestEntry(args[1]);
      return ['ZTPF002E Syntax: ZTEST ENTRY,<ecbname>'];
    case 'ZSTOP':
      if (priv < 2) return authFail(verb, 'SYSOP');
      return cmdZstop(args.join(','));
    case 'ZENTRY':
      if (priv < 2) return authFail(verb, 'SYSOP');
      return cmdZentry(args[0], args[1]);
    case 'ZPROG':
      if (priv < 2) return authFail(verb, 'SYSOP');
      return cmdZprog(args[0]);
    case 'ZEND':
      if (priv < 3) return authFail(verb, 'SYSPROG');
      return cmdZend(args[0]);
    case 'HELP': case '?':
      return cmdHelp(priv);
    default:
      return [`ZTPF000E INVALID COMMAND: ${upper}`, `ZTPF000I Type HELP for available commands.`];
  }
}

function authFail(verb, required) {
  return [
    `ZTPF900E AUTHORIZATION FAILURE — ${verb} REQUIRES ${required} AUTHORITY`,
    `ZTPF900I THIS ATTEMPT HAS BEEN LOGGED.`,
  ];
}

function cmdZshowSystem() {
  const now = new Date();
  const ts  = now.toISOString().replace('T',' ').slice(0,19);
  return [
    `ZTPF100I SYSTEM STATUS DISPLAY`,
    `ZTPF100I SYSTEM: ${SYSNAME}   TIME: ${ts}`,
    `ZTPF101I CPU UTIL: 38%   ONLINE PROCS: 16/16`,
    `ZTPF102I ACTIVE ECBS: ${ECB_TABLE.filter(e=>e.status==='ACTIVE').length}   IDLE: ${ECB_TABLE.filter(e=>e.status==='IDLE').length}`,
    `ZTPF103I TRANS/SEC: 4,821   PEAK: 12,440`,
    `ZTPF104I TOTAL TRANS TODAY: 18,203,451`,
    `ZTPF105I SYSTEM HEALTH: NORMAL`,
  ];
}

function cmdZshowEntry() {
  const lines = [
    `ZTPF200I ECB DIRECTORY — ${ECB_TABLE.length} ENTRIES`,
    `ZTPF200I ${'NAME    '} TYPE   STATUS   ENT  TRANSACTIONS`,
    `ZTPF200I ${'--------'} ------  -------  ---  ----------------`,
  ];
  for (const e of ECB_TABLE) {
    const priv = e.priv ? ' [PRIV]' : '';
    lines.push(`ZTPF200I ${e.name.padEnd(8)} ${e.type.padEnd(7)} ${e.status.padEnd(8)} ${String(e.entries).padStart(3)}  ${e.txn.padStart(13)}${priv}`);
  }
  lines.push(`ZTPF202I END OF ECB DIRECTORY`);
  return lines;
}

function cmdZshowPools() {
  const lines = [
    `ZTPF300I MEMORY POOL STATUS`,
    `ZTPF300I ${'POOL    '} ADDRESS   SIZE   USED   PCT`,
    `ZTPF300I ${'--------'} --------- -----  -----  ---`,
  ];
  for (const p of POOL_TABLE) {
    const warn = p.pct >= 90 ? ' ***' : '';
    lines.push(`ZTPF300I ${p.name.padEnd(8)} ${p.addr}  ${p.size.padStart(5)}  ${p.used.padStart(5)}  ${String(p.pct).padStart(3)}%${warn}`);
  }
  lines.push(`ZTPF302I END OF POOL STATUS`);
  const warn = POOL_TABLE.filter(p=>p.pct>=90);
  if (warn.length) lines.push(`ZTPF303W ${warn.length} POOL(S) ABOVE 90% CAPACITY — TRANSACTION REJECTION POSSIBLE`);
  return lines;
}

function cmdZshowTrans() {
  return [
    `ZTPF400I TRANSACTION MONITOR`,
    `ZTPF401I CURRENT TPS   : 4,821`,
    `ZTPF402I PEAK TPS TODAY: 12,440 AT 09:14:03`,
    `ZTPF403I TOTAL TODAY   : 18,203,451`,
    `ZTPF404I QUEUED        : 12`,
    `ZTPF405I REJECTED      : 0`,
    `ZTPF406I AVG RESP TIME : 2.4ms`,
  ];
}

function cmdZshowOper() {
  return [
    `ZTPF500I ACTIVE OPERATORS`,
    `ZTPF501I OPERID    ROLE     LOGON-TIME   TERMINAL`,
    `ZTPF501I --------  -------  -----------  --------`,
    `ZTPF501I TPFOP01   OPER     08:03:11     CONS001`,
    `ZTPF501I SYSOP01   SYSOP    07:55:22     CONS002`,
    `ZTPF502I END OF OPERATOR LIST`,
  ];
}

function cmdZshowVersion() {
  return [
    `ZTPF600I ${SYSNAME} — IBM z/TPF V1R1 (SIMULATED)`,
    `ZTPF601I BUILD  : 2024.365`,
    `ZTPF602I IPL    : 2024-12-31 00:01:03`,
    `ZTPF603I UPTIME : 176 DAYS 09:12:44`,
  ];
}

function cmdZtestEntry(name) {
  const ecb = ECB_TABLE.find(e => e.name === name.toUpperCase());
  if (!ecb) {
    return [`ZTPF710E ENTRY POINT ${name.toUpperCase()} NOT FOUND IN DIRECTORY`];
  }
  const ms   = 1 + Math.floor(Math.random() * 8);
  const priv = ecb.priv ? ' [HANDLES PRIVILEGED DATA]' : '';
  return [
    `ZTPF710I ENTRY POINT TEST: ${ecb.name}`,
    `ZTPF711I STATUS : ${ecb.status}   TYPE: ${ecb.type}${priv}`,
    `ZTPF712I RESPONDED IN ${ms}ms`,
    `ZTPF713I TRANSACTIONS: ${ecb.txn}`,
  ];
}

function cmdZstop(arg) {
  if (arg === 'RPRT') {
    return [
      `ZTPF800I ZSTOP REPORT MODE — NO ACTION TAKEN`,
      `ZTPF801I ${ECB_TABLE.filter(e=>e.status==='ACTIVE').length} ACTIVE ENTRY POINTS WOULD BE STOPPED`,
    ];
  }
  const ecb = ECB_TABLE.find(e=>e.name===arg);
  if (!ecb) return [`ZTPF800E ENTRY POINT ${arg} NOT FOUND`];
  return [`ZTPF800I ZSTOP ACCEPTED FOR ${ecb.name} — QUIESCING TRANSACTIONS`];
}

function cmdZentry(name, action) {
  const ecb = ECB_TABLE.find(e=>e.name===name);
  if (!ecb) return [`ZTPF810E ENTRY POINT ${name} NOT FOUND`];
  return [`ZTPF810I ZENTRY ${action||'START'} ACCEPTED FOR ${ecb.name}`];
}

function cmdZprog(name) {
  return [`ZTPF820I ZPROG LOAD INITIATED FOR ${name||'?'} — LINK-EDIT PENDING`];
}

function cmdZend(qualifier) {
  if (!qualifier || qualifier === 'CHECK') {
    return [
      `ZTPF830I ZEND CHECK — ${qualifier==='CHECK'?'WOULD':'WILL'} QUIESCE ALL ${ECB_TABLE.filter(e=>e.status==='ACTIVE').length} ACTIVE ENTRY POINTS`,
      `ZTPF830I THIS IS A SIMULATED ENVIRONMENT — NO ACTION TAKEN`,
    ];
  }
  return [
    `ZTPF830W ZEND ${qualifier} — THIS IS A SIMULATED ENVIRONMENT`,
    `ZTPF830I NO ACTUAL SYSTEM HALT PERFORMED`,
  ];
}

function cmdHelp(priv) {
  const lines = [
    `ZTPF000I z/TPF OPERATOR COMMAND SUMMARY`,
    `ZTPF000I ZSHOW E         — List ECB directory`,
    `ZTPF000I ZSHOW P         — Show memory pool status`,
    `ZTPF000I ZSHOW S         — Show system status`,
    `ZTPF000I ZSHOW T         — Show transaction monitor`,
    `ZTPF000I ZSHOW O         — Show active operators`,
    `ZTPF000I ZSHOW V         — Show system version`,
    `ZTPF000I ZTEST ENTRY,ecb — Test entry point response`,
  ];
  if (priv >= 2) {
    lines.push(`ZTPF000I ZSTOP,RPRT      — Report stoppable entry points (SYSOP)`);
    lines.push(`ZTPF000I ZSTOP,ecb       — Stop a specific entry point (SYSOP)`);
    lines.push(`ZTPF000I ZENTRY ecb      — Manage entry point (SYSOP)`);
    lines.push(`ZTPF000I ZPROG name      — Load program module (SYSOP)`);
  }
  if (priv >= 3) {
    lines.push(`ZTPF000I ZEND CHECK      — Show what ZEND would stop (SYSPROG)`);
    lines.push(`ZTPF000I ZEND QUIESCE    — Halt all transactions (SYSPROG)`);
  }
  return lines;
}

// ── Screen builders ───────────────────────────────────────────────────────
function screenLogon() {
  const now = new Date();
  const ts  = now.toLocaleTimeString('en-US',{hour12:false}) + ' ' +
              now.toLocaleDateString('en-US');
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:1,  col:2,  text: `z/TPF OPERATOR CONSOLE - ${SYSNAME}` },
    { row:2,  col:1,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:2,  col:2,  text: `IBM Transaction Processing Facility (Simulated)` },
    { row:4,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:4,  col:2,  text: 'OPER ID  ==>' },
    { row:4,  col:14, fa: FA_UNPROTECTED },
    { row:4,  col:15, text: '        ', ic: true },
    { row:4,  col:23, fa: FA_PROTECTED },
    { row:6,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:6,  col:2,  text: 'PASSWORD ==>' },
    { row:6,  col:14, fa: 0x4C },
    { row:6,  col:15, text: '        ' },
    { row:6,  col:23, fa: FA_PROTECTED },
    { row:9,  col:1,  fa: FA_PROTECTED, color: COL_YELLOW },
    { row:9,  col:2,  text: 'Credentials: TPFOP01/TPF1 (OPER)  SYSOP01/SYS1 (SYSOP)  ADMIN01/ADMIN (SYSPROG)' },
    { row:21, col:1,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:21, col:2,  text: `${ts}   PRESS ENTER TO LOGON` },
  ]);
}

function screenLogonError(operId) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:1,  col:2,  text: `z/TPF OPERATOR CONSOLE - ${SYSNAME}` },
    { row:4,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:4,  col:2,  text: 'OPER ID  ==>' },
    { row:4,  col:14, fa: FA_UNPROTECTED },
    { row:4,  col:15, text: '        ', ic: true },
    { row:4,  col:23, fa: FA_PROTECTED },
    { row:6,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:6,  col:2,  text: 'PASSWORD ==>' },
    { row:6,  col:14, fa: 0x4C },
    { row:6,  col:15, text: '        ' },
    { row:6,  col:23, fa: FA_PROTECTED },
    { row:8,  col:1,  fa: FA_PROTECTED, color: COL_RED, highlight: HL_REVERSE },
    { row:8,  col:2,  text: `ZTPF901E INVALID OPER ID OR PASSWORD: ${operId.toUpperCase()}` },
    { row:21, col:1,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:21, col:2,  text: 'ENTER VALID CREDENTIALS AND PRESS ENTER' },
  ]);
}

function screenConsole(operId, role, outputLog) {
  const now  = new Date();
  const ts   = now.toLocaleTimeString('en-US',{hour12:false});
  const hdr  = `${SYSNAME}   ${ts}   ${operId.toUpperCase()} / ${role}   ENTER TPF COMMAND`;

  const fields = [
    { row:0,  col:0,  fa: FA_PROTECTED },
    { row:0,  col:1,  fa: FA_PROTECTED_HIGH, color: COL_GREEN },
    { row:0,  col:2,  text: hdr.slice(0,76) },
    { row:1,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:1,  col:1,  text: `${'─'.repeat(78)}` },
  ];

  // Output log: rows 2–19, 18 lines max
  const LOG_ROWS = 18;
  const logLines = outputLog.slice(-LOG_ROWS);
  for (let i = 0; i < LOG_ROWS; i++) {
    const line = logLines[i] || '';
    let color = COL_WHITE;
    if (/ZTPF[89]\d{2}[EW]/.test(line)) color = COL_RED;
    else if (/ZTPF[3][0-9]{2}W/.test(line)) color = COL_YELLOW;
    else if (/ZTPF\d{3}I/.test(line))    color = COL_TURQ;
    fields.push({ row: 2 + i, col: 0, fa: FA_PROTECTED, color });
    fields.push({ row: 2 + i, col: 1, text: line.slice(0,78) });
  }

  // Separator + command input
  fields.push({ row:20, col:0, fa: FA_PROTECTED, color: COL_BLUE });
  fields.push({ row:20, col:1, text: `${'─'.repeat(78)}` });
  fields.push({ row:21, col:0,  fa: FA_PROTECTED, color: COL_YELLOW });
  fields.push({ row:21, col:1,  text: `${operId.toUpperCase()} ==>` });
  fields.push({ row:21, col:10, fa: FA_UNPROTECTED });
  fields.push({ row:21, col:11, text: ' '.repeat(66), ic: true });
  fields.push({ row:21, col:78, fa: FA_PROTECTED });
  fields.push({ row:22, col:0,  fa: FA_PROTECTED, color: COL_BLUE });
  fields.push({ row:22, col:1,  text: `PF3=LOGOFF  HELP=?` });

  return buildScreen(true, fields);
}

// ── Extract field text from client write ─────────────────────────────────
function extractInputText(data) {
  let i = 3; // skip AID (1) + cursor address (2)
  let fieldAddr = -1;
  const fields = {};
  while (i < data.length) {
    const b = data[i];
    if (b === ORDER_SBA && i + 2 < data.length) {
      // Bridge uses raw 12-bit binary addressing (not 6-bit encoded)
      fieldAddr = (data[i+1] << 8) | data[i+2];
      if (!(fieldAddr in fields)) fields[fieldAddr] = [];
      i += 3; continue;
    }
    if (b === ORDER_IC) { i++; continue; }
    if (b >= 0x40 || b === 0x00) {
      // Accumulate all bytes under the current field's start address
      if (fieldAddr >= 0) fields[fieldAddr].push(b);
      i++;
    } else { i++; }
  }
  // Return fields in ascending address order, space-separated:
  //   logon  → "TPFOP01 TPF1"   (split gives id + password)
  //   console → "ZSHOW E"        (passed straight to dispatchCommand)
  const addrs = Object.keys(fields).map(Number).sort((a, b) => a - b);
  const result = [];
  for (const a of addrs) {
    const s = fields[a].map(b => EBCDIC_TO_ASCII[b])
                       .filter(c => c >= 0x20 && c < 0x7F)
                       .map(c => String.fromCharCode(c)).join('').trim();
    if (s.length > 0) result.push(s);
  }
  return result.join(' ');
}

// ── TN3270E negotiation state ─────────────────────────────────────────────
function createSession(socket) {
  let tn3270e = false;
  let negotiated = false;
  let cols       = 80;
  let loggedIn   = false;
  let operId     = '';
  let role       = 'OPER';
  let priv       = 1;
  let outputLog  = [];

  function send(buf) {
    try { if (!socket.destroyed) socket.write(buf); } catch {}
  }

  function sendScreen(screenBuf) {
    mockCols = cols;
    let payload;
    if (tn3270e) {
      // TN3270E header: DATA-TYPE=0x00, REQUEST=0x00, RESPONSE=0x00, SEQ=0x0000
      const hdr = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      payload   = Buffer.concat([hdr, screenBuf]);
    } else {
      payload = screenBuf;
    }
    send(wrapEOR(payload));
  }

  function showLogon()        { sendScreen(screenLogon()); }
  function showLogonError(id) { sendScreen(screenLogonError(id)); }
  function showConsole()      { sendScreen(screenConsole(operId, role, outputLog)); }

  function addOutput(lines) {
    for (const l of lines) outputLog.push(l);
    // Keep at most 200 lines of history
    if (outputLog.length > 200) outputLog = outputLog.slice(-200);
  }

  function handleCommand(raw) {
    if (!raw) return;
    const lines = dispatchCommand(raw, priv);
    addOutput(lines);
    showConsole();
  }

  // ── Negotiation ──────────────────────────────────────────────────────
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
      // IAC sequence
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

      // EOR-terminated 3270 data
      const eorIdx = findEOR(buf);
      if (eorIdx < 0) return;
      const frame = buf.slice(0, eorIdx);
      buf = buf.slice(eorIdx + 2); // skip IAC EOR
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
      // Send DEVICE-TYPE REQUEST
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
      // Client confirmed device type — pick up the real model it asked for
      // so screen addressing (sba) matches the width the client will render at.
      const deviceStr = sb.slice(3).toString('ascii');
      const match = deviceStr.match(/IBM-(3278|3279)-(\d)(-E)?/);
      if (match) {
        const model = `${match[1]}-${match[2]}${match[3] || ''}`;
        const dims  = MODEL_DIMS[model];
        if (dims) cols = dims.cols;
      }
      // Now send FUNCTIONS REQUEST
      send(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST, IAC, SE]));
    }

    if (type === TN3E_DEVICE_TYPE && sb[2] === TN3E_REQUEST) {
      // Client requesting device type — accept whatever model it asked for
      // by echoing it back, and adopt that model's screen width. Device-type
      // strings in TN3270E negotiation are ASCII, not EBCDIC.
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
      // Client reported its capabilities — negotiation complete, send first screen
      if (!negotiated) { negotiated = true; setImmediate(() => showLogon()); }
    }

    if (type === TN3E_FUNCTIONS && sb[2] === TN3E_REQUEST) {
      // Client requesting functions — echo back and send screen
      const requested = sb.slice(3);
      send(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS, ...requested, IAC, SE]));
      if (!negotiated) { negotiated = true; setImmediate(() => showLogon()); }
    }
  }

  function handleFrame(frame) {
    const data = frame;
    // Un-escape IAC IAC
    const unesc = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] === IAC && data[i+1] === IAC) { unesc.push(IAC); i++; }
      else unesc.push(data[i]);
    }
    // Tn3270Session._sendDataRecord() always prepends the TN3270E 5-byte
    // header on outbound client->host records once negotiated (see
    // tn3270/session.js), symmetric with the header sendScreen() prepends
    // above — strip it here or every AID byte reads as the header's
    // DATA-TYPE 0x00 instead of the real AID.
    let d = Buffer.from(unesc);
    if (tn3270e) d = d.slice(5);
    if (d.length < 1) return;

    const aid = d[0];

    if (aid === AID_CLEAR) { showConsole(); return; }
    if (aid === AID_PF3)   { socket.end(); return; }

    if (aid !== AID_ENTER) return;

    if (!loggedIn) {
      // Parse oper id from field data
      const entered = extractInputText(d).split(/\s+/);
      const id   = entered[0]?.toUpperCase() || '';
      const pass = entered[1] || '';
      const cred = CREDENTIALS[id];
      if (cred && cred.pass === pass) {
        loggedIn = true;
        operId   = id;
        role     = cred.role;
        priv     = cred.priv;
        addOutput([
          `ZTPF001I LOGON ACCEPTED — ${id} — ROLE: ${role}   PRIV: ${priv}`,
          `ZTPF001I ${SYSNAME} READY`,
        ]);
        showConsole();
      } else {
        showLogonError(id || '?');
      }
    } else {
      const cmd = extractInputText(d);
      handleCommand(cmd);
    }
  }

  socket.on('data', onData);
  socket.on('error', () => {});
  socket.on('close', () => {});
  startNegotiation();
}

// ── Server ────────────────────────────────────────────────────────────────
const server = net.createServer(socket => createSession(socket));

server.listen(PORT, '0.0.0.0', () => {
  console.log('─────────────────────────────────────────────────────');
  console.log('  WebTerm/3270 Mock z/TPF Daemon');
  console.log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  console.log(`  System ID     ${SYSNAME}`);
  console.log(`  LU Name       ${LU_NAME}`);
  console.log('  Protocol      TN3270E + classic TN3270 fallback');
  console.log('  Screens       Logon → z/TPF Operator Console');
  console.log('  Credentials   TPFOP01/TPF1  SYSOP01/SYS1  ADMIN01/ADMIN');
  console.log('─────────────────────────────────────────────────────');
});
