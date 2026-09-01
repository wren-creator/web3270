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
  // Screens below commonly declare a field's attribute and its label text as
  // two separate entries at the SAME row/col (attribute occupies that cell;
  // the label is meant to start right after it). Track the most recent FA
  // placement so a text-only entry reusing those exact coordinates skips its
  // own SBA and lands on the content cell the FA's implicit advance already
  // points at, instead of re-targeting the FA byte's own cell and stepping
  // on it — which used to just silently eat the label's first character, but
  // now (session.js clearing stale .fa on overwrite, see #19) blows away the
  // field boundary itself and lets one field's color bleed across the rest
  // of the screen.
  let lastFaPos = null;
  for (const f of fields) {
    const attachedToFa = f.fa === undefined && lastFaPos && f.row === lastFaPos.row && f.col === lastFaPos.col;
    if (!attachedToFa) parts.push(...sba(f.row, f.col));
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
      lastFaPos = { row: f.row, col: f.col };
    } else if (!attachedToFa) {
      lastFaPos = null;
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

// Mainframe 105 (Book 5) cross-platform token chain, hop 4 of 4: ZBOOK
// requires both the Batch Control Number (from the z/OS mock's DATACHK
// job, validated by the AS/400 mock's CHKBCN) and the System
// Authorization Value (from the z/VM mock's VERIFY REXX exec) before it
// will finalize a booking. Both values are fixed, not derived from
// anything at runtime, so this mock can validate independently with no
// shared datastore between mocks — see Bridge_server/ROADMAP.md's
// "Cross-Platform Token Chain" section.
const EXPECTED_BCN = 'BCN-7742';
const EXPECTED_SAV = 'SAV-2081';

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

// ── z/TPF hardening surfaces (ZINET / ZCRAS / ZAUTH / POSIX) ─────────────
// Seeded as a training lab that was stood up and never locked back down:
// internet daemons with anonymous / no auth, an alternate CRAS on a
// network-reachable line, a STUDENT terminal class that can route
// restricted operator commands, and leftover demo accounts in the POSIX
// file system. Each is a finding the z/TPF Hardening Audit tool surfaces;
// harden one by editing its row here — nothing else needs to change.
const ZINET_SERVERS = [
  { name:'FTPD',   port:21, state:'ACTIVE', model:'NOLISTEN', auth:'ANONYMOUS', tls:'NO'  },
  { name:'TELNET', port:23, state:'ACTIVE', model:'CHILD',    auth:'PASSWORD',  tls:'NO'  },
  { name:'SSHD',   port:22, state:'ACTIVE', model:'CHILD',    auth:'KEY',       tls:'N/A' },
  { name:'HTTPD',  port:80, state:'ACTIVE', model:'CHILD',    auth:'NONE',      tls:'NO'  },
  { name:'TFTPD',  port:69, state:'ACTIVE', model:'NOLISTEN', auth:'NONE',      tls:'NO'  },
];

const ZCRAS_TERMINALS = [
  { role:'PRIME', sym:'CRAS',  line:'L2201',  restricted:'YES', note:'console room, controlled'          },
  { role:'ALT',   sym:'CRAS2', line:'L4407',  restricted:'YES', note:'ops annex, controlled'            },
  { role:'ALT',   sym:'CRAS3', line:'LTCP01', restricted:'YES', note:'TCP/IP console, network-reachable' },
];

const ZCRAS_POOLS = [
  { pool:'POOL1', cls:'AGENT',   terms:240, rcmds:'NO'  },
  { pool:'POOL2', cls:'STUDENT', terms: 32, rcmds:'YES' },
  { pool:'POOL3', cls:'ADMIN',   terms:  8, rcmds:'YES' },
];

// Command-level authorization matrix (ZAUTH). Which terminal class may issue
// which restricted operator command — enforced by the UUSR user exit.
const ZAUTH_MATRIX = [
  { cmd:'ZFILE', classes:['ADMIN','STUDENT'] },
  { cmd:'ZDCP',  classes:['ADMIN','STUDENT'] },
  { cmd:'ZLOGP', classes:['ADMIN'] },
  { cmd:'ZSTOP', classes:['ADMIN'] },
  { cmd:'ZEND',  classes:['ADMIN'] },
  { cmd:'ZINET', classes:['ADMIN','AGENT'] },
];

// POSIX file system, reachable through ZFILE. Demo accounts left with login
// shells; system accounts correctly locked. Shadow field: '!' / '*' = locked,
// '' = no password at all, '$1$' = weak MD5, '$6$' = sha512.
const POSIX_PASSWD = [
  { user:'root',    uid:0,   gid:0,   home:'/root',          shell:'/bin/sh'       },
  { user:'tpf',     uid:1,   gid:1,   home:'/',              shell:'/bin/false'    },
  { user:'daemon',  uid:2,   gid:2,   home:'/',              shell:'/sbin/nologin' },
  { user:'sshd',    uid:74,  gid:74,  home:'/var/empty',     shell:'/sbin/nologin' },
  { user:'tpfuser', uid:500, gid:500, home:'/home/tpfuser',  shell:'/bin/sh'       },
  { user:'guest',   uid:501, gid:501, home:'/home/guest',    shell:'/bin/sh'       },
  { user:'test',    uid:502, gid:502, home:'/home/test',     shell:'/bin/sh'       },
];
const POSIX_SHADOW = {
  root:    '$6$rA9x$sha512hash',
  tpf:     '!',
  daemon:  '*',
  sshd:    '*',
  tpfuser: '$1$xO3kf1$md5hash',
  guest:   '$1$Ab9Qz2$md5hash',
  test:    '',
};

// ── ZTEST interactive debugger state ──────────────────────────────────────
// Real z/TPF ZTEST attaches to one program at a time, so the mock keeps a
// single module-level session. DISPLAY / STEP / GO / REG / STOR all read and
// mutate the same registers between console commands. Fake register and
// storage values are derived deterministically from the program name and the
// address, so a given walkthrough always sees the same numbers.
const ZTEST_SESSION = {
  active: false,
  prog:   '',
  base:   0,   // load address of the entry point
  pc:     0,   // next-instruction address (low 31 bits of the PSW)
  regs:   new Array(16).fill(0),
  bps:    [],  // breakpoint addresses, ascending
  trace:  false,
  steps:  0,   // instructions executed this session
};

const ZTEST_INSTRS = [
  'L     R1,0(,R2)',
  'LA    R1,4(,R1)',
  'CLC   0(8,R1),0(,R4)',
  'BC    7,SCAN',
  'MVC   WORK(16),0(,R5)',
  'ST    R1,72(,R13)',
  'LR    R15,R1',
  'AHI   R3,-1',
  'BCT   R3,SCAN',
  'BR    R14',
];

function hex8(n) { return (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
function hex2(n) { return (n & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }

// Deterministic pseudo-bytes from a 32-bit seed — the same address always
// dumps the same storage, within a session and across restarts.
function ztestBytes(seed, n) {
  let x = seed >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push((x >>> 16) & 0xFF);
  }
  return out;
}

function ztestSeedRegs(name) {
  let x = 0x0001B845 >>> 0;
  for (const ch of name) x = (Math.imul(x, 31) + ch.charCodeAt(0)) >>> 0;
  const regs = [];
  for (let i = 0; i < 16; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; regs.push(x >>> 0); }
  regs[13] = (0x00A04000 + (regs[13] & 0xFFF)) >>> 0;  // R13 → save area
  regs[14] = 0x80C12A6C;                               // R14 → return address
  regs[15] = 0x00000000;                               // R15 → return code
  return regs;
}

function instrAt(pc) { return ZTEST_INSTRS[(pc >>> 2) % ZTEST_INSTRS.length]; }

// In-memory PNR store for the ZBOOK/ZLOOK/ZCXL "simple ticketing system"
// 101 exercise -- keyed by a generated 6-char locator. Data shape is
// inspired by (not ported from) a PNR/reservation record model used
// elsewhere in this user's projects, written fresh here for the mock.
const PNR_TABLE = {};
const PNR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I -- avoids ambiguity

function genPnr() {
  let pnr;
  do {
    pnr = Array.from({ length: 6 }, () => PNR_CHARS[Math.floor(Math.random() * PNR_CHARS.length)]).join('');
  } while (PNR_TABLE[pnr]);
  return pnr;
}

// ── Command dispatch ──────────────────────────────────────────────────────
function dispatchCommand(raw, priv) {
  const upper = raw.trim().toUpperCase();
  const [verb, ...args] = upper.split(/[\s,]+/);
  const rest = args.join(' ');

  switch (verb) {
    case 'ZSHOW':
      switch (args[0]) {
        case 'E': case 'ENTRY':               return cmdZshowEntry();
        case 'P': case 'POOL': case 'POOLS':  return cmdZshowPools();
        case 'S': case 'SYS': case 'SYSTEM':  return cmdZshowSystem();
        case 'T': case 'TRANS':               return cmdZshowTrans();
        case 'O': case 'OPER':                return cmdZshowOper();
        case 'V': case 'VERSION':             return cmdZshowVersion();
        case 'B': case 'BOOK': case 'BOOKINGS': return cmdZshowBookings();
        case 'UTIL':                          return cmdZshowUtil();
        case 'LOCK': case 'LOCKS':            return cmdZshowLock();
        case 'PROG': case 'APPL':             return cmdZshowProg();
        case 'MQP': case 'QUEUE':             return cmdZshowMqp();
        case 'ALLOC':                         return cmdZshowAlloc();
        default:  return [`ZTPF001E ZSHOW ${args[0] || ''} — unknown subcommand. Use E P S T O V B UTIL LOCK PROG MQP ALLOC`];
      }
    case 'ZTEST':
      if (args[0] === 'ENTRY' && args[1]) return cmdZtestEntry(args[1]);
      return cmdZtest(args);
    case 'ZBOOK':
      if (args.length < 4) return ['ZTPF851E Syntax: ZBOOK passenger,flight,date,seat[,bcn,sav]'];
      return cmdZbook(args[0], args[1], args[2], args[3], args[4], args[5]);
    case 'ZLOOK':
      if (!args[0]) return ['ZTPF861E Syntax: ZLOOK pnr'];
      return cmdZlook(args[0]);
    case 'ZCXL':
      if (!args[0]) return ['ZTPF871E Syntax: ZCXL pnr'];
      return cmdZcxl(args[0]);
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
    case 'ZINET':
      return cmdZinet(args);
    case 'ZCRAS':
      return cmdZcras(args);
    case 'ZAUTH':
      return cmdZauth(args);
    case 'ZFILE':
      return cmdZfile(raw);
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

function cmdZshowBookings() {
  const pnrs = Object.values(PNR_TABLE);
  const lines = [
    `ZTPF880I ACTIVE BOOKING DIRECTORY — ${pnrs.length} RECORD${pnrs.length === 1 ? '' : 'S'}`,
    `ZTPF880I ${'PNR   '} PASSENGER       FLIGHT DATE     SEAT STATUS`,
    `ZTPF880I ${'------'} --------------- ------ -------- ---- ---------`,
  ];
  for (const p of pnrs) {
    lines.push(`ZTPF880I ${p.pnr.padEnd(6)} ${p.passenger.padEnd(15)} ${p.flight.padEnd(6)} ${p.date.padEnd(8)} ${p.seat.padEnd(4)} ${p.status}`);
  }
  lines.push(`ZTPF882I END OF BOOKING DIRECTORY`);
  return lines;
}

function cmdZshowUtil() {
  return [
    `ZTPF110I CPU UTILIZATION — 16 I-STREAMS ONLINE`,
    `ZTPF110I  RANGE       I-STREAMS`,
    `ZTPF110I  ---------   ---------`,
    `ZTPF110I  0 - 25%         3`,
    `ZTPF110I  26 - 50%        9`,
    `ZTPF110I  51 - 75%        4`,
    `ZTPF110I  76 - 100%       0`,
    `ZTPF111I SYSTEM AVERAGE: 38%   BUSIEST: CP07 AT 61%`,
    `ZTPF112I CPU-LOOP DETECTION: NONE   MPIF: LOOSELY-COUPLED (1 PROC)`,
  ];
}

function cmdZshowLock() {
  return [
    `ZTPF120I LOCK TABLE — HELD RECORD / RESOURCE LOCKS`,
    `ZTPF120I HOLDER  RESOURCE           TYPE   WAITERS  HELD-MS`,
    `ZTPF120I ------  -----------------  -----  -------  -------`,
    `ZTPF120I BKNG    PNR#00A4F210       EXCL         0       12`,
    `ZTPF120I FARES   FARE#0117C088      SHARE        2       88`,
    `ZTPF120I RSVP    SEAT#00C41A90      EXCL         1       41`,
    `ZTPF120I PAYM    ACCT#00920C14      EXCL         7    4,210`,
    `ZTPF122I 4 LOCKS HELD   10 ECB(S) WAITING`,
    `ZTPF123W PAYM HAS HELD ACCT#00920C14 FOR 4,210ms — LONGEST HOLD`,
  ];
}

function cmdZshowProg() {
  const lines = [
    `ZTPF130I PROGRAM ALLOCATION TABLE — ${ECB_TABLE.length} LOADED`,
    `ZTPF130I NAME    TYPE    BASE-ADDR  VERSION   STATE`,
    `ZTPF130I ------  ------  ---------  --------  ------`,
  ];
  for (const e of ECB_TABLE) {
    const base = 0x00C10000
               + ((e.name.charCodeAt(0) & 0x0F) << 12)
               + ((e.name.charCodeAt(1) & 0x0F) << 6);
    const ver = `1.${String((e.name.charCodeAt(0) % 9) + 1).padStart(2, '0')}.${String(e.name.charCodeAt(e.name.length - 1) % 9).padStart(2, '0')}`;
    const priv = e.priv ? ' [PRIV]' : '';
    lines.push(`ZTPF130I ${e.name.padEnd(6)}  ${e.type.padEnd(6)}  ${hex8(base).slice(2)}   ${ver.padEnd(8)}  ${e.status.padEnd(6)}${priv}`);
  }
  lines.push(`ZTPF132I END OF PROGRAM ALLOCATION TABLE`);
  return lines;
}

function cmdZshowMqp() {
  return [
    `ZTPF140I MESSAGE / PROCESSOR QUEUE STATUS`,
    `ZTPF141I INPUT LIST     :        12 ENTRIES`,
    `ZTPF142I READY LIST     :         4 ENTRIES`,
    `ZTPF143I DEFERRED LIST  :     1,842 ENTRIES   <-- ELEVATED`,
    `ZTPF144I CROSS LIST     :         0 ENTRIES`,
    `ZTPF145I SUSPEND LIST   :         3 ENTRIES`,
    `ZTPF146W DEFERRED LIST DEPTH ABNORMAL — RUN ZTEST ENTRY,PAYM`,
  ];
}

function cmdZshowAlloc() {
  return [
    `ZTPF150I FIXED-FILE RECORD ALLOCATION`,
    `ZTPF150I REC-TYPE   SIZE   PRIME     OVERFLOW   USED%`,
    `ZTPF150I ---------  -----  --------  ---------  -----`,
    `ZTPF150I #PNRREC     1055   400,000     40,000     72%`,
    `ZTPF150I #FARREC      381   120,000     12,000     54%`,
    `ZTPF150I #SEATREC     224   250,000     25,000     63%`,
    `ZTPF150I #ACCREC      767   200,000     20,000     91%  ***`,
    `ZTPF152I END OF ALLOCATION DISPLAY`,
    `ZTPF153W #ACCREC AT 91% — PAYMENT POSTING WILL FAIL IF PRIME FILLS`,
  ];
}

// ── Hardening surfaces: ZINET / ZCRAS / ZAUTH / ZFILE ───────────────────
function cmdZinet(args) {
  if ((args[0] || 'DISPLAY') !== 'DISPLAY') {
    return [`ZTPF160E Syntax: ZINET DISPLAY`];
  }
  const lines = [
    `ZTPF160I ZINET SERVER TABLE — ${ZINET_SERVERS.length} DEFINED`,
    `ZTPF160I SERVER  PORT  STATE   MODEL     AUTH       TLS`,
    `ZTPF160I ------  ----  ------  --------  ---------  ---`,
  ];
  for (const s of ZINET_SERVERS) {
    const flag = (s.auth === 'ANONYMOUS' || s.auth === 'NONE' || s.tls === 'NO') ? ' *' : '';
    lines.push(`ZTPF160I ${s.name.padEnd(6)}  ${String(s.port).padStart(4)}  ${s.state.padEnd(6)}  ${s.model.padEnd(8)}  ${s.auth.padEnd(9)}  ${s.tls.padEnd(3)}${flag}`);
  }
  lines.push(`ZTPF162I END OF ZINET SERVER TABLE`);
  const anon = ZINET_SERVERS.filter(s => s.auth === 'ANONYMOUS' || s.auth === 'NONE');
  if (anon.length) lines.push(`ZTPF163W ${anon.map(s => s.name).join(', ')} ACCEPT UNAUTHENTICATED CONNECTIONS`);
  return lines;
}

function cmdZcras(args) {
  if ((args[0] || 'DISPLAY') !== 'DISPLAY') {
    return [`ZTPF170E Syntax: ZCRAS DISPLAY`];
  }
  const lines = [
    `ZTPF170I COMPUTER ROOM AGENT SET (CRAS)`,
    `ZTPF170I ROLE   SYMBOL  LINE    RESTRICTED  NOTE`,
    `ZTPF170I -----  ------  ------  ----------  ------------------------------`,
  ];
  for (const t of ZCRAS_TERMINALS) {
    const flag = /TCP/i.test(t.line) ? ' *' : '';
    lines.push(`ZTPF170I ${t.role.padEnd(5)}  ${t.sym.padEnd(6)}  ${t.line.padEnd(6)}  ${t.restricted.padEnd(10)}  ${t.note}${flag}`);
  }
  lines.push(`ZTPF171I TERMINAL POOLS — RESTRICTED-COMMAND ROUTING`);
  lines.push(`ZTPF171I POOL   CLASS    TERMS  RESTRICTED-CMDS`);
  lines.push(`ZTPF171I -----  -------  -----  --------------`);
  for (const p of ZCRAS_POOLS) {
    const flag = (p.rcmds === 'YES' && p.cls !== 'ADMIN') ? ' *' : '';
    lines.push(`ZTPF171I ${p.pool.padEnd(5)}  ${p.cls.padEnd(7)}  ${String(p.terms).padStart(5)}  ${p.rcmds}${flag}`);
  }
  lines.push(`ZTPF172I END OF CRAS DISPLAY`);
  const netCras = ZCRAS_TERMINALS.filter(t => /TCP/i.test(t.line));
  const badPool = ZCRAS_POOLS.filter(p => p.rcmds === 'YES' && p.cls !== 'ADMIN');
  if (netCras.length) lines.push(`ZTPF173W ${netCras.map(t => t.sym).join(', ')} IS AN ALTERNATE CRAS ON A NETWORK-REACHABLE LINE`);
  if (badPool.length) lines.push(`ZTPF173W POOL(S) ${badPool.map(p => p.pool).join(', ')} ROUTE RESTRICTED COMMANDS FOR A NON-ADMIN CLASS`);
  return lines;
}

function cmdZauth(args) {
  if ((args[0] || 'DISPLAY') !== 'DISPLAY') {
    return [`ZTPF180E Syntax: ZAUTH DISPLAY`];
  }
  const lines = [
    `ZTPF180I COMMAND AUTHORIZATION MATRIX (UUSR USER EXIT)`,
    `ZTPF180I COMMAND  AUTHORIZED TERMINAL CLASSES`,
    `ZTPF180I -------  ---------------------------`,
  ];
  const RESTRICTED = ['ZFILE', 'ZDCP', 'ZLOGP', 'ZSTOP', 'ZEND'];
  for (const e of ZAUTH_MATRIX) {
    const nonAdmin = e.classes.filter(c => c !== 'ADMIN' && c !== 'AGENT');
    const flag = (RESTRICTED.includes(e.cmd) && nonAdmin.length) ? ' *' : '';
    lines.push(`ZTPF180I ${e.cmd.padEnd(7)}  ${e.classes.join(' ')}${flag}`);
  }
  lines.push(`ZTPF182I END OF AUTHORIZATION MATRIX`);
  const leaks = ZAUTH_MATRIX.filter(e => RESTRICTED.includes(e.cmd) && e.classes.some(c => c !== 'ADMIN' && c !== 'AGENT'));
  if (leaks.length) lines.push(`ZTPF183W ${leaks.map(e => e.cmd).join(', ')} REACHABLE FROM A NON-ADMIN TERMINAL CLASS`);
  return lines;
}

function cmdZfile(raw) {
  // dispatchCommand upper-cased the line, so re-parse the original for the
  // case-sensitive POSIX path.
  const m = raw.trim().match(/^ZFILE\s+(\w+)\s+(\S+)/i);
  if (!m) return [`ZTPF190E Syntax: ZFILE cat <path>   (/etc/passwd, /etc/shadow)`];
  const op = m[1].toLowerCase();
  const path = m[2];
  if (op !== 'cat') return [`ZTPF190E ZFILE: only 'cat' is modelled in this mock`];

  if (/^\/etc\/passwd$/i.test(path)) {
    const lines = [`ZTPF190I ZFILE cat /etc/passwd`];
    for (const p of POSIX_PASSWD) {
      const login = p.shell !== '/bin/false' && p.shell !== '/sbin/nologin';
      const demo = /^(tpfuser|guest|test)$/.test(p.user);
      const flag = (login && demo) ? '   <- demo account with a login shell' : '';
      lines.push(`ZTPF190I ${p.user}:x:${p.uid}:${p.gid}::${p.home}:${p.shell}${flag}`);
    }
    lines.push(`ZTPF192I END OF FILE (${POSIX_PASSWD.length} ENTRIES)`);
    return lines;
  }

  if (/^\/etc\/shadow$/i.test(path)) {
    const lines = [`ZTPF190I ZFILE cat /etc/shadow`];
    for (const p of POSIX_PASSWD) {
      const h = POSIX_SHADOW[p.user] ?? '';
      let note = '';
      if (h === '') note = '   <- NO PASSWORD';
      else if (h.startsWith('$1$')) note = '   <- weak MD5';
      lines.push(`ZTPF190I ${p.user}:${h}:19700::::::${note}`);
    }
    lines.push(`ZTPF192I END OF FILE (${POSIX_PASSWD.length} ENTRIES)`);
    const weak = POSIX_PASSWD.filter(p => { const h = POSIX_SHADOW[p.user] ?? ''; return h === '' || h.startsWith('$1$'); });
    if (weak.length) lines.push(`ZTPF193W ${weak.map(p => p.user).join(', ')} HAVE A WEAK OR ABSENT PASSWORD HASH`);
    return lines;
  }

  return [`ZTPF191E ZFILE: ${path} not found (mock models /etc/passwd and /etc/shadow)`];
}

// bcn/sav are optional — omitted entirely, ZBOOK books exactly as it
// always has (Book 1 and Book 4 both document and teach the plain
// 4-argument form; that path is untouched, byte-for-byte, same
// discipline as the z/OS mock's JCL_MEMBERS additions). Supplied, they
// gate the booking on the Mainframe 105 token chain.
function cmdZbook(passenger, flight, date, seat, bcn, sav) {
  if (bcn !== undefined || sav !== undefined) {
    if (bcn !== EXPECTED_BCN) return [`ZTPF852E BOOKING REJECTED — BATCH CONTROL NUMBER ${bcn} NOT RECOGNIZED`];
    if (sav !== EXPECTED_SAV) return [`ZTPF853E BOOKING REJECTED — SYSTEM AUTHORIZATION VALUE ${sav} NOT RECOGNIZED`];
  }
  const pnr = genPnr();
  PNR_TABLE[pnr] = { pnr, passenger, flight, date, seat, status: 'ACTIVE', created: new Date().toISOString() };
  return [
    `ZTPF850I BOOKING CONFIRMED — PNR: ${pnr}`,
    `ZTPF850I PASSENGER: ${passenger}  FLIGHT: ${flight}  DATE: ${date}  SEAT: ${seat}`,
  ];
}

function cmdZlook(pnrArg) {
  const pnr = pnrArg.toUpperCase();
  const rec = PNR_TABLE[pnr];
  if (!rec) return [`ZTPF861E PNR NOT FOUND: ${pnr}`];
  return [
    `ZTPF860I PNR: ${rec.pnr}  STATUS: ${rec.status}`,
    `ZTPF860I PASSENGER: ${rec.passenger}  FLIGHT: ${rec.flight}  DATE: ${rec.date}  SEAT: ${rec.seat}`,
    `ZTPF860I CREATED: ${rec.created}`,
  ];
}

function cmdZcxl(pnrArg) {
  const pnr = pnrArg.toUpperCase();
  const rec = PNR_TABLE[pnr];
  if (!rec) return [`ZTPF871E PNR NOT FOUND: ${pnr}`];
  if (rec.status === 'CANCELLED') return [`ZTPF872W PNR ${pnr} ALREADY CANCELLED`];
  rec.status = 'CANCELLED';
  return [`ZTPF870I PNR ${pnr} CANCELLED`];
}

function cmdZtestEntry(name) {
  const ecb = ECB_TABLE.find(e => e.name === name.toUpperCase());
  if (!ecb) {
    return [`ZTPF710E ENTRY POINT ${name.toUpperCase()} NOT FOUND IN DIRECTORY`];
  }
  const ms   = 1 + Math.floor(Math.random() * 8);
  const priv = ecb.priv ? ' [HANDLES PRIVILEGED DATA]' : '';
  const lines = [
    `ZTPF710I ENTRY POINT TEST: ${ecb.name}`,
    `ZTPF711I STATUS : ${ecb.status}   TYPE: ${ecb.type}${priv}`,
    `ZTPF712I RESPONDED IN ${ms}ms`,
    `ZTPF713I TRANSACTIONS: ${ecb.txn}`,
  ];
  // Mainframe 205 (200 series capstone) vignette: PAYM has sat in
  // ECB_TABLE since Book 1, real, privileged, never individually probed.
  // This is where the incident is actually felt first -- responds fine
  // (STATUS/RESPONDED above are completely normal), the backlog is a
  // queue problem, not an entry-point failure. CYC-0826 is the same run
  // label independently hardcoded into mock-lpar.js (z/OS), mock-zvm.js
  // (z/VM), and mock-as400.js's seedMessages() (IBM i, the real origin).
  if (ecb.name === 'PAYM') {
    lines.push(`ZTPF714I QUEUE DEPTH: 1,842 (RISING)`);
    lines.push(`ZTPF715I AWAITING CONFIRMATION FEED -- CYC-0826`);
  }
  return lines;
}

// ── ZTEST interactive debugger ───────────────────────────────────────────
// Everything except `ZTEST ENTRY,<ecb>` (still handled in dispatchCommand)
// lands here. Models the real z/TPF debugger: START attaches to a program,
// then BP / STEP / GO / DISPLAY / REG / STOR / TRACE / STOP.
function cmdZtest(args) {
  switch (args[0] || '') {
    case 'START':                       return ztestStart(args[1]);
    case 'STOP': case 'END': case 'QUIT': return ztestStop();
    case 'DISPLAY': case 'D': case 'STATUS': return ztestDisplay();
    case 'BP': case 'AT': case 'BREAK':  return ztestBp(args[1]);
    case 'CLEAR': case 'DELETE':         return ztestClear(args[1]);
    case 'STEP':                         return ztestStep();
    case 'GO': case 'G': case 'RUN':     return ztestGo();
    case 'REG': case 'GPR':              return ztestReg(args[1], args[2]);
    case 'STOR': case 'STORAGE': case 'DUMP': return ztestStor(args[1], args[2]);
    case 'TRACE':                        return ztestTrace(args[1]);
    default:
      return [
        `ZTPF002E Syntax: ZTEST ENTRY,<ecbname>   (entry-point probe)`,
        `ZTPF002I    or   ZTEST START,<prog> | DISPLAY | BP,addr | CLEAR,addr|ALL`,
        `ZTPF002I         ZTEST STEP | GO | REG,n[,val] | STOR,addr[,len] | TRACE ON|OFF | STOP`,
      ];
  }
}

function ztestNotActive() {
  return [`ZTPF720E NO ZTEST DEBUG SESSION ACTIVE — ZTEST START,<prog> FIRST`];
}

function ztestParseAddr(s) {
  if (!s) return NaN;
  return parseInt(String(s).replace(/^0X/, ''), 16);
}

function ztestStart(name) {
  if (!name) return [`ZTPF720E Syntax: ZTEST START,<prog>`];
  const prog = name.toUpperCase();
  const ecb = ECB_TABLE.find(e => e.name === prog);
  if (!ecb) return [`ZTPF720E PROGRAM ${prog} NOT FOUND IN DIRECTORY`];
  if (ZTEST_SESSION.active) {
    return [`ZTPF720E DEBUG SESSION ALREADY ACTIVE ON ${ZTEST_SESSION.prog} — ZTEST STOP FIRST`];
  }
  const base = (0x00C10000 + ((prog.charCodeAt(0) & 0x0F) << 12)) >>> 0;
  const len  = 0x200 + ((prog.charCodeAt(prog.length - 1) & 0x0F) << 5);
  Object.assign(ZTEST_SESSION, {
    active: true, prog, base, pc: base,
    regs: ztestSeedRegs(prog), bps: [], trace: false, steps: 0,
  });
  return [
    `ZTPF720I ZTEST DEBUG SESSION STARTED — PROGRAM: ${prog} (${ecb.type})`,
    `ZTPF720I ENTRY POINT LOADED @ ${hex8(base)}   LENGTH ${hex8(len).slice(2)}`,
    `ZTPF720I EXECUTION SUSPENDED AT ENTRY — NEXT: ${instrAt(base)}`,
    `ZTPF720I SET BREAKPOINTS WITH ZTEST BP,addr THEN ZTEST GO — ZTEST DISPLAY FOR STATE`,
  ];
}

function ztestStop() {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  const { prog, steps } = ZTEST_SESSION;
  ZTEST_SESSION.active = false;
  ZTEST_SESSION.prog = '';
  return [`ZTPF726I ZTEST DEBUG SESSION ENDED — PROGRAM: ${prog}   ${steps} INSTRUCTION(S) STEPPED`];
}

function ztestDisplay() {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  const s = ZTEST_SESSION;
  const r = s.regs.map(hex8);
  const lines = [
    `ZTPF721I ZTEST SESSION — PROGRAM: ${s.prog}   STATE: ${s.pc === s.base ? 'AT ENTRY' : 'STOPPED'}`,
    `ZTPF721I PSW: 070C0000 ${hex8(0x80000000 | s.pc)}   NEXT: ${instrAt(s.pc)}`,
    `ZTPF721I GPR  0-3 : ${r[0]} ${r[1]} ${r[2]} ${r[3]}`,
    `ZTPF721I GPR  4-7 : ${r[4]} ${r[5]} ${r[6]} ${r[7]}`,
    `ZTPF721I GPR  8-11: ${r[8]} ${r[9]} ${r[10]} ${r[11]}`,
    `ZTPF721I GPR 12-15: ${r[12]} ${r[13]} ${r[14]} ${r[15]}`,
    s.bps.length
      ? `ZTPF721I BREAKPOINTS: ${s.bps.map(hex8).join('  ')}   (${s.bps.length})`
      : `ZTPF721I BREAKPOINTS: NONE SET`,
    `ZTPF721I TRACE: ${s.trace ? 'ON' : 'OFF'}   STEPPED: ${s.steps}`,
  ];
  if (s.prog === 'PAYM') {
    lines.push(`ZTPF721W R13 SAVE-AREA CHAIN SHOWS 1,842 UNPOSTED ITEMS — CYC-0826`);
  }
  return lines;
}

function ztestBp(addrArg) {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  if (!addrArg) return [`ZTPF727E Syntax: ZTEST BP,<hex-address>`];
  const addr = ztestParseAddr(addrArg);
  if (Number.isNaN(addr)) return [`ZTPF727E INVALID ADDRESS: ${addrArg}`];
  const a = addr >>> 0;
  if (ZTEST_SESSION.bps.includes(a)) return [`ZTPF727W BREAKPOINT ALREADY SET @ ${hex8(a)}`];
  ZTEST_SESSION.bps.push(a);
  ZTEST_SESSION.bps.sort((x, y) => x - y);
  return [`ZTPF727I BREAKPOINT SET @ ${hex8(a)}   (${ZTEST_SESSION.bps.length} ACTIVE)`];
}

function ztestClear(addrArg) {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  if (!addrArg) return [`ZTPF728E Syntax: ZTEST CLEAR,<hex-address>|ALL`];
  if (addrArg === 'ALL' || addrArg === '*') {
    const n = ZTEST_SESSION.bps.length;
    ZTEST_SESSION.bps = [];
    return [`ZTPF728I ALL BREAKPOINTS CLEARED   (${n} REMOVED)`];
  }
  const a = ztestParseAddr(addrArg) >>> 0;
  const idx = ZTEST_SESSION.bps.indexOf(a);
  if (idx === -1) return [`ZTPF728W NO BREAKPOINT AT ${hex8(a)}`];
  ZTEST_SESSION.bps.splice(idx, 1);
  return [`ZTPF728I BREAKPOINT CLEARED @ ${hex8(a)}   (${ZTEST_SESSION.bps.length} REMAINING)`];
}

function ztestStep() {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  const s = ZTEST_SESSION;
  const at = s.pc;
  const executed = instrAt(at);
  s.regs[1] = (s.regs[1] + 4) >>> 0;   // move a register so DISPLAY changes
  s.pc = (s.pc + 4) >>> 0;
  s.steps++;
  const lines = [
    `ZTPF722I STEP @ ${hex8(at)}   EXECUTED: ${executed}`,
    `ZTPF722I R1 = ${hex8(s.regs[1])}   PSW NOW 070C0000 ${hex8(0x80000000 | s.pc)}`,
    `ZTPF722I NEXT: ${instrAt(s.pc)}`,
  ];
  if (s.bps.includes(s.pc)) lines.push(`ZTPF722W NEXT INSTRUCTION IS A BREAKPOINT @ ${hex8(s.pc)}`);
  return lines;
}

function ztestGo() {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  const s = ZTEST_SESSION;
  const from = s.pc;
  const ahead = s.bps.filter(b => b > s.pc).sort((a, b) => a - b);
  if (ahead.length) {
    const hit = ahead[0];
    const count = (hit - s.pc) >> 2;
    s.pc = hit;
    s.steps += count;
    s.regs[1] = (s.regs[1] + count * 4) >>> 0;
    return [
      `ZTPF723I GO — RESUMING FROM ${hex8(from)}`,
      `ZTPF723W BREAKPOINT REACHED @ ${hex8(hit)}   (AFTER ${count} INSTRUCTION(S))`,
      `ZTPF723I NEXT: ${instrAt(hit)} — ZTEST DISPLAY FOR STATE`,
    ];
  }
  s.pc = s.base;
  s.regs[15] = 0x00000000;
  return [
    `ZTPF723I GO — RESUMING FROM ${hex8(from)}`,
    `ZTPF723I PROGRAM ${s.prog} RAN TO COMPLETION — R15 = 00000000 (EXIT OK)`,
    `ZTPF723I SESSION STILL ACTIVE, PC RESET TO ENTRY — ZTEST STOP TO END`,
  ];
}

function ztestReg(numArg, valArg) {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  if (numArg === undefined) return [`ZTPF729E Syntax: ZTEST REG,<0-15>[,<hex-value>]`];
  const n = parseInt(numArg, 10);
  if (Number.isNaN(n) || n < 0 || n > 15) return [`ZTPF729E REGISTER OUT OF RANGE: ${numArg} (0-15)`];
  if (valArg === undefined) return [`ZTPF729I GPR ${n} = ${hex8(ZTEST_SESSION.regs[n])}`];
  const v = ztestParseAddr(valArg);
  if (Number.isNaN(v)) return [`ZTPF729E INVALID VALUE: ${valArg}`];
  const old = ZTEST_SESSION.regs[n];
  ZTEST_SESSION.regs[n] = v >>> 0;
  return [`ZTPF729I GPR ${n} SET TO ${hex8(v)}   (WAS ${hex8(old)})`];
}

function ztestStor(addrArg, lenArg) {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  if (!addrArg) return [`ZTPF724E Syntax: ZTEST STOR,<hex-address>[,<len>]`];
  const base = ztestParseAddr(addrArg);
  if (Number.isNaN(base)) return [`ZTPF724E INVALID ADDRESS: ${addrArg}`];
  let len = parseInt(lenArg, 10);
  if (Number.isNaN(len) || len <= 0) len = 32;
  len = Math.min(len, 128);
  const bytes = ztestBytes(base >>> 0, len);
  const lines = [`ZTPF725I STORAGE @ ${hex8(base)}   ${len} BYTE(S)`];
  for (let off = 0; off < len; off += 8) {
    const row = bytes.slice(off, off + 8);
    const hexpart = row.map(hex2).join(' ');
    const chrpart = row.map(b => {
      const c = EBCDIC_TO_ASCII[b];
      return (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : '.';
    }).join('');
    lines.push(`ZTPF725I ${hex8((base >>> 0) + off)}  ${hexpart.padEnd(23)}  *${chrpart}*`);
  }
  return lines;
}

function ztestTrace(arg) {
  if (!ZTEST_SESSION.active) return ztestNotActive();
  const a = (arg || '').toUpperCase();
  if (a !== 'ON' && a !== 'OFF') return [`ZTPF722E Syntax: ZTEST TRACE ON|OFF`];
  ZTEST_SESSION.trace = (a === 'ON');
  return [`ZTPF722I INSTRUCTION TRACE ${a}${a === 'ON' ? ' — STEP/GO WILL LOG EACH INSTRUCTION' : ''}`];
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
    `ZTPF000I ZSHOW B         — Show active bookings`,
    `ZTPF000I ZSHOW UTIL      — CPU utilization detail`,
    `ZTPF000I ZSHOW LOCK      — Held record/resource locks`,
    `ZTPF000I ZSHOW PROG      — Program allocation table`,
    `ZTPF000I ZSHOW MQP       — Message/processor queue status`,
    `ZTPF000I ZSHOW ALLOC     — Fixed-file record allocation`,
    `ZTPF000I ZTEST ENTRY,ecb — Test entry point response`,
    `ZTPF000I ZTEST START,prog — Attach the interactive debugger`,
    `ZTPF000I ZTEST DISPLAY   — Show debugger registers and state`,
    `ZTPF000I ZTEST BP,addr / CLEAR,addr|ALL — Manage breakpoints`,
    `ZTPF000I ZTEST STEP / GO — Single-step / run to breakpoint or exit`,
    `ZTPF000I ZTEST REG,n[,v] / STOR,addr[,len] — Registers / storage`,
    `ZTPF000I ZTEST TRACE ON|OFF / STOP — Trace toggle / end session`,
    `ZTPF000I ZINET DISPLAY   — Internet daemon (ZINET) server table`,
    `ZTPF000I ZCRAS DISPLAY   — CRAS terminals + restricted-command routing`,
    `ZTPF000I ZAUTH DISPLAY   — Command authorization matrix (UUSR)`,
    `ZTPF000I ZFILE cat path  — Read a POSIX file (/etc/passwd, /etc/shadow)`,
    `ZTPF000I ZBOOK passenger,flight,date,seat[,bcn,sav] — Create a PNR`,
    `ZTPF000I ZLOOK pnr       — Look up a PNR`,
    `ZTPF000I ZCXL pnr        — Cancel a PNR`,
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
    else if (/ZTPF\d{3}W/.test(line)) color = COL_YELLOW;
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
    if (aid === AID_PF3) {
      // PF3 = LOGOFF. From the console, return to the operator logon screen
      // (the line stays up, matching a VTAM-connected 3270 and letting a
      // credential sweep sign off and try the next id). From the logon
      // screen itself, drop the connection.
      if (loggedIn) { loggedIn = false; operId = ''; role = 'OPER'; priv = 1; outputLog = []; showLogon(); return; }
      socket.end(); return;
    }

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
