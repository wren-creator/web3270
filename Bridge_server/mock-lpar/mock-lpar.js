/**
 * mock-lpar/mock-lpar.js
 * Fixed: screen is sent only after full TN3270E negotiation completes
 * (after client sends FUNCTIONS REQUEST, not after mock sends FUNCTIONS IS)
 */

'use strict';

const net = require('net');

const PORT    = parseInt(process.env.MOCK_PORT  || '3270', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const LU_NAME = process.env.MOCK_LU    || 'MOCKLU01';
const SYSNAME = process.env.MOCK_SYSID || 'MOCKPROD';

const IAC  = 0xFF, DONT = 0xFE, DO   = 0xFD;
const WONT = 0xFC, WILL = 0xFB, SB   = 0xFA, SE = 0xF0;
const EOR  = 0xEF, NOP  = 0xF1;

const OPT_BINARY  = 0x00;
const OPT_EOR     = 0x19;
const OPT_TTYPE   = 0x18;
const OPT_TN3270E = 0x28;

const TN3E_CONNECT     = 0x01;
const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

const CMD_ERASE_WRITE     = 0xF5;
const CMD_ERASE_WRITE_ALT = 0x7E;
const CMD_WRITE           = 0xF1;
const CMD_WSF             = 0xF3;  // Write Structured Field (SNA encoding)
const ORDER_SF  = 0x1D;
const ORDER_SFE = 0x29;  // Start Field Extended (with color/highlight pairs)
const ORDER_SA  = 0x28;  // Set Attribute (character-level color/highlight)
const ORDER_SBA = 0x11;
const ORDER_IC  = 0x13;

const FA_PROTECTED        = 0x60;
const FA_PROTECTED_HIGH   = 0xE0;
const FA_UNPROTECTED      = 0x40;
const FA_UNPROTECTED_NUM  = 0x50;
const FA_UNPROTECTED_HIDDEN = 0x4C;  // unprotected + nondisplay (bits 3-2 = 11) — real password-field FA

// 3270 extended color codes (SFE/SA type 0x42)
const COL_BLUE   = 0xF1;
const COL_RED    = 0xF2;
const COL_PINK   = 0xF3;
const COL_GREEN  = 0xF4;
const COL_TURQ   = 0xF5;
const COL_YELLOW = 0xF6;
const COL_WHITE  = 0xF7;

// 3270 highlight codes (SFE/SA type 0x41)
const HL_BLINK   = 0xF1;
const HL_REVERSE = 0xF2;
const HL_UNDER   = 0xF4;
const HL_INTENS  = 0xF8;

const AID_ENTER = 0x7D;
const AID_CLEAR = 0x6D;
const AID_PF3   = 0xF3;
const AID_PF7   = 0xF7;
const AID_PF8   = 0xF8;

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
// built (see sendCurrentScreen) — buildScreen/sba run synchronously off that,
// so this is safe despite being module-level shared state.
let mockCols = 80;

// ── Cross-session buffer bleed simulation ──────────────────────────────
// A real 3270 controller only clears its buffer on an Erase command; if a
// pooled LU is handed to a new logical session before the app issues its
// own Erase/Write, whatever was left in the old field data (incl. MDT-set,
// nondisplay fields) can still be present for a brief window. We model that
// here: on disconnect, cache the last-typed userid/password for the LU the
// client requested; on the next connection that asks for the *same* LU
// within BUFFER_BLEED_WINDOW_MS, replay that stale field data as a non-
// erasing Write before the fresh (erased) logon screen goes out.
const _luBufferCache = new Map(); // luName -> { user, pass, ts }
const BUFFER_BLEED_WINDOW_MS = 90000;

function encodeAddr(addr) {
  const hi = (addr >> 6) & 0x3F;
  const lo =  addr       & 0x3F;
  const encode6 = n => n < 0x3F ? 0x40 + n : 0xC0 + (n - 0x3F);
  return [encode6(hi), encode6(lo)];
}

function sba(row, col) {
  return [ORDER_SBA, ...encodeAddr(row * mockCols + col)];
}

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
        // SFE: pair count, then [type, value] pairs
        const pairs = [[0xC0, f.fa]];                          // basic FA pair
        if (f.color     !== undefined) pairs.push([0x42, f.color]);
        if (f.highlight !== undefined) pairs.push([0x41, f.highlight]);
        parts.push(ORDER_SFE, pairs.length);
        for (const [t, v] of pairs) parts.push(t, v);
      } else {
        parts.push(ORDER_SF, f.fa);
      }
    }
    if (f.ic) parts.push(ORDER_IC);
    // Inline SA — character-level color/highlight before text, reset after
    if (f.saColor     !== undefined) parts.push(ORDER_SA, 0x42, f.saColor);
    if (f.saHighlight !== undefined) parts.push(ORDER_SA, 0x41, f.saHighlight);
    if (f.text) for (const b of toEbcdic(f.text)) parts.push(b);
    if (f.saColor !== undefined || f.saHighlight !== undefined) parts.push(ORDER_SA, 0x00, 0x00);
  }
  return Buffer.from(parts);
}

function screenLogon() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = now.toLocaleDateString('en-GB');
  return buildScreen(true, [
    { row:1,  col:20, fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:1,  col:21, text: `IBM z/OS  -  ${SYSNAME}  -  TSO/E LOGON` },
    { row:3,  col:2,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:3,  col:2,  text: 'Enter LOGON parameters below:' },
    { row:3,  col:40, text: 'RACF LOGON parameters:' },
    { row:5,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:5,  col:2,  text: 'Userid  ===>' },
    { row:5,  col:14, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:5,  col:14, text: '        ' },
    { row:6,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:6,  col:2,  text: 'Password===>' },
    { row:6,  col:14, fa: FA_UNPROTECTED_HIDDEN, color: COL_GREEN },
    { row:6,  col:14, text: '        ' },
    { row:7,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:7,  col:2,  text: 'Procedure==> TSOPROC' },
    { row:7,  col:40, fa: FA_PROTECTED, color: COL_BLUE },
    { row:7,  col:40, text: 'Acct Nmbr===> DEMO01' },
    { row:10, col:2,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:10, col:2,  text: "Enter an 'S' before each option desired below:" },
    { row:11, col:18, text: '-Nomail         -Nonotice       -Reconnect' },
    { row:13, col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:13, col:2,  text: 'PF1/PF13 ==> Help   PF3/PF15 ==> Logoff   PA1 ==> Attention' },
    { row:15, col:2,  fa: FA_PROTECTED, color: COL_GREEN },
    { row:15, col:2,  text: `${SYSNAME} - Mock LPAR Daemon v1.0  ${dateStr}  ${timeStr}` },
  ]);
}

// Non-erasing Write that pokes stale userid/password bytes into the logon
// screen's field coordinates with MDT forced on — simulates a controller
// buffer that still holds a prior session's modified fields.
function screenBufferBleed(cached) {
  const fields = [];
  if (cached.user) fields.push({ row:5, col:14, fa: FA_UNPROTECTED | 0x01,        color: COL_GREEN, text: cached.user.padEnd(8, ' ').slice(0, 8) });
  if (cached.pass) fields.push({ row:6, col:14, fa: FA_UNPROTECTED_HIDDEN | 0x01, color: COL_GREEN, text: cached.pass.padEnd(8, ' ').slice(0, 8) });
  return buildScreen(false, fields); // false = Write, not Erase/Write — buffer is not cleared
}

function screenISPF(userid = 'DEMO') {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
  return buildScreen(true, [
    { row:0,  col:24, fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_UNDER },
    { row:0,  col:25, text: 'ISPF Primary Option Menu' },
    { row:2,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_WHITE },
    { row:2,  col:2,  text: 'Option ===>' },
    { row:2,  col:13, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:2,  col:13, text: '    ' },
    // Each option: yellow number, turquoise description — two SFE fields per row
    { row:4,  col:2,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:4,  col:5,  saColor: COL_YELLOW, text: '0' },
    { row:4,  col:8,  text: 'Settings       Terminal and user parameters' },
    { row:5,  col:5,  saColor: COL_YELLOW, text: '1' },
    { row:5,  col:8,  text: 'View           Display source data or listings' },
    { row:6,  col:5,  saColor: COL_YELLOW, text: '2' },
    { row:6,  col:8,  text: 'Edit           Create or change source data' },
    { row:7,  col:5,  saColor: COL_YELLOW, text: '3' },
    { row:7,  col:8,  text: 'Utilities      Perform utility functions' },
    { row:7,  col:40, saColor: COL_PINK, text: '3.4 Dataset List' },
    { row:8,  col:5,  saColor: COL_YELLOW, text: '4' },
    { row:8,  col:8,  text: 'Foreground     Interactive language processing' },
    { row:9,  col:5,  saColor: COL_YELLOW, text: '5' },
    { row:9,  col:8,  text: 'Batch          Submit job for language processing' },
    { row:10, col:5,  saColor: COL_YELLOW, text: '6' },
    { row:10, col:8,  text: 'Command        Enter TSO or Workstation commands' },
    { row:11, col:5,  saColor: COL_YELLOW, text: 'M' },
    { row:11, col:8,  text: 'SDSF           System Display and Search Facility' },
    { row:13, col:5,  saColor: COL_YELLOW, text: 'X' },
    { row:13, col:8,  text: 'Exit           Terminate ISPF using log/list defaults' },
    { row:20, col:1,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:20, col:1,  text: ` User ID . : ${userid.padEnd(8)}    Time. . .: ${timeStr}` },
    { row:21, col:1,  text: ` System ID : ${SYSNAME.padEnd(8)}    Terminal .: 3278` },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'F1=Help   F2=Split  F3=Exit   F7=Backward  F8=Forward  F12=Cancel' },
  ]);
}

function screenISPF34(userid = 'DEMO', dsLevel = '') {
  const level = dsLevel || userid.toUpperCase();
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'ISPF  Data Set List Utility' },
    { row:0,  col:55, fa: FA_PROTECTED, color: COL_BLUE },
    { row:0,  col:55, text: 'Row 1 of 10' },
    { row:1,  col:0,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:1,  text: 'Command ==>' },
    { row:1,  col:12, fa: FA_UNPROTECTED, color: COL_GREEN },
    { row:1,  col:12, text: '                                    ' },
    { row:1,  col:49, fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:49, text: 'Scroll ===> CSR' },
    { row:2,  col:1,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:2,  col:1,  text: 'Dsname Level. . ' + level.padEnd(8) },
    { row:3,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:3,  col:1,  text: 'Volume serial .        Optionally enter a volume serial' },
    { row:4,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_YELLOW },
    { row:4,  col:1,  text: 'Name                             Tracks  XT Used  XT Dsorg Recfm Lrecl BlkSz' },
    { row:5,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:5,  col:1,  text: ' ' + level + '.JCL.CNTL                       15   1   15   1 PO    FB       80 27920' },
    { row:6,  col:1,  text: ' ' + level + '.REXX.EXEC                        5   1    5   1 PO    VB       80  6160' },
    { row:7,  col:1,  text: ' ' + level + '.DATA.INPUT                      20   1   18   1 PS    FB       80 27920' },
    { row:8,  col:1,  text: ' ' + level + '.DATA.OUTPUT                     20   1    0   0 PS    FB       80 27920' },
    { row:9,  col:1,  text: ' ' + level + '.LOAD                            30   1   22   1 PO    U         0 32760' },
    { row:10, col:1,  text: ' ' + level + '.PROCLIB                         10   1    8   1 PO    FB       80 27920' },
    { row:11, col:1,  text: ' ' + level + '.CLIST                            5   1    4   1 PO    VB      255  6160' },
    { row:12, col:1,  text: ' ' + level + '.PANELS                           5   1    5   1 PO    FB       80  6160' },
    { row:13, col:1,  text: ' ' + level + '.MSGS                             5   1    5   1 PO    FB       80  6160' },
    { row:14, col:1,  text: ' ' + level + '.WORK.DATA                       10   1    3   1 PS    FB       80 27920' },
    { row:15, col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE },
    { row:15, col:1,  text: '**END**' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'F1=Help  F2=Split  F3=Exit  F5=Reset  F7=Up  F8=Down  F10=Left  F11=Right' },
  ]);
}

function screenEdit() {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'Edit - DEMO.JCL.CNTL(MYJOB) - 01.00          Columns 00001 00072' },
    { row:1,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:1,  text: 'Command ===>' },
    { row:1,  col:13, fa: FA_UNPROTECTED, color: COL_GREEN },
    { row:1,  col:13, text: '                                    ' },
    { row:1,  col:50, fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:50, text: 'Scroll ===> CSR' },
    // Line numbers in green, JCL text in turquoise via SA
    { row:2,  col:0,  fa: FA_PROTECTED, color: COL_GREEN },
    { row:2,  col:0,  saColor: COL_GREEN,  text: '000001' },
    { row:2,  col:7,  saColor: COL_TURQ,   text: '//MYJOB    JOB (DEMO),' },
    { row:3,  col:0,  saColor: COL_GREEN,  text: '000002' },
    { row:3,  col:7,  saColor: COL_TURQ,   text: "//             'DEMO BATCH JOB'," },
    { row:4,  col:0,  saColor: COL_GREEN,  text: '000003' },
    { row:4,  col:7,  saColor: COL_TURQ,   text: '//             CLASS=A,MSGCLASS=X,' },
    { row:5,  col:0,  saColor: COL_GREEN,  text: '000004' },
    { row:5,  col:7,  saColor: COL_TURQ,   text: '//             NOTIFY=&SYSUID' },
    { row:6,  col:0,  saColor: COL_GREEN,  text: '000005' },
    { row:6,  col:7,  saColor: COL_YELLOW, text: '//*' },
    { row:7,  col:0,  saColor: COL_GREEN,  text: '000006' },
    { row:7,  col:7,  saColor: COL_TURQ,   text: '//COPY     EXEC PGM=IEBGENER' },
    { row:8,  col:0,  saColor: COL_GREEN,  text: '000007' },
    { row:8,  col:7,  saColor: COL_TURQ,   text: '//SYSPRINT DD SYSOUT=*' },
    { row:9,  col:0,  saColor: COL_GREEN,  text: '000008' },
    { row:9,  col:7,  saColor: COL_TURQ,   text: '//SYSUT1   DD DSN=PROD.INPUT.DATA,DISP=SHR' },
    { row:10, col:0,  saColor: COL_GREEN,  text: '000009' },
    { row:10, col:7,  saColor: COL_TURQ,   text: '//SYSUT2   DD DSN=WORK.OUTPUT.DATA,' },
    { row:11, col:0,  saColor: COL_GREEN,  text: '000010' },
    { row:11, col:7,  saColor: COL_TURQ,   text: '//             DISP=(NEW,CATLG,DELETE),' },
    { row:12, col:0,  saColor: COL_GREEN,  text: '000011' },
    { row:12, col:7,  saColor: COL_TURQ,   text: '//             SPACE=(CYL,(5,2),RLSE),' },
    { row:13, col:0,  saColor: COL_GREEN,  text: '000012' },
    { row:13, col:7,  saColor: COL_TURQ,   text: '//             DCB=(RECFM=FB,LRECL=80,BLKSIZE=27920)' },
    { row:14, col:0,  saColor: COL_GREEN,  text: '000013' },
    { row:14, col:7,  saColor: COL_TURQ,   text: '//SYSIN    DD DUMMY' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'F2=Split  F3=Exit  F5=Rfind  F6=Rchange  F7=Up  F8=Down  F14=Save' },
  ]);
}

function screenSDSF() {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'SDSF OUTPUT DISPLAY MYJOB   JOB07432  DSID   2 LINE 0    COLUMNS 02-81' },
    { row:1,  col:1,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:1,  text: 'COMMAND INPUT ===>' },
    { row:1,  col:18, fa: FA_UNPROTECTED, color: COL_GREEN },
    { row:1,  col:18, text: '                              ' },
    { row:1,  col:49, fa: FA_PROTECTED, color: COL_WHITE },
    { row:1,  col:49, text: 'SCROLL ===> PAGE' },
    { row:3,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:3,  col:9,  text: '1 //MYJOB    JOB (DEMO),CLASS=A,MSGCLASS=X' },
    { row:4,  col:9,  text: '2 //*' },
    { row:5,  col:9,  text: '3 //STEP1    EXEC PGM=IEFBR14' },
    { row:8,  col:1,  saColor: COL_GREEN, text: 'IEF142I MYJOB STEP1 - STEP WAS EXECUTED - COND CODE 0000' },
    { row:9,  col:1,  saColor: COL_GREEN, text: 'IEF285I   PROD.DATA.FILE                             KEPT' },
    { row:18, col:1,  fa: FA_PROTECTED_HIGH, color: COL_YELLOW },
    { row:18, col:1,  text: '*** END OF DATA ***' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'F1=Help  F3=End  F5=RFind  F7=Up  F8=Down  F10=Left  F11=Right' },
  ]);
}

function screenError(cmd) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_REVERSE },
    { row:0,  col:1,  text: 'ISPF  ***  ERROR  ***' },
    { row:2,  col:2,  fa: FA_PROTECTED, color: COL_RED },
    { row:2,  col:2,  text: `Unknown option: '${(cmd || '').trim()}'` },
    { row:4,  col:2,  saColor: COL_TURQ, text: 'Valid primary options: 0 1 2 3 4 5 6 M X' },
    { row:5,  col:2,  saColor: COL_TURQ, text: 'Press PF3 to return to the Primary Option Menu.' },
    { row:7,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_INTENS },
    { row:7,  col:2,  text: 'IKJ56500I COMMAND NOT FOUND' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'F3=Return  F12=Cancel' },
  ]);
}

function screenReady(userid = 'DEMO', lastMsg = '') {
  const fields = [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: `${SYSNAME} TSO/E - Ready` },
    { row:0,  col:40, fa: FA_PROTECTED, color: COL_BLUE },
    { row:0,  col:40, text: `User: ${userid.padEnd(8)}` },
  ];
  if (lastMsg) {
    fields.push({ row:2, col:0, fa: FA_PROTECTED, color: COL_GREEN });
    fields.push({ row:2, col:1, text: lastMsg });
  }
  fields.push(
    { row:4,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:4,  col:1,  text: 'Type a TSO command or ISPF to enter ISPF.' },
    { row:4,  col:50, fa: FA_PROTECTED, color: COL_BLUE },
    { row:4,  col:50, text: 'PF3=Logoff' },
    { row:6,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_GREEN, highlight: HL_INTENS },
    { row:6,  col:1,  text: 'READY' },
    { row:7,  col:0,  fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:7,  col:1,  text: '                                                ' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: `${SYSNAME}  TSO READY  PF3=Logoff` },
  );
  return buildScreen(true, fields);
}

function screenListapf() {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'LISTAPF Output' },
    { row:1,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:1,  col:1,  text: 'APF-Authorized Libraries:' },
    { row:3,  col:1,  saColor: COL_YELLOW, text: 'Volume  Dataset Name' },
    { row:4,  col:1,  saColor: COL_YELLOW, text: '------  --------------------------------------------------------' },
    { row:5,  col:1,  text: 'SYSRES  SYS1.LINKLIB' },
    { row:6,  col:1,  text: 'SYSRES  SYS1.LPALIB' },
    { row:7,  col:1,  text: 'SYSRES  SYS1.MIGLIB' },
    { row:8,  col:1,  text: 'SYSRES  SYS1.SVCLIB' },
    { row:9,  col:1,  text: 'PROD01  CEE.SCEERUN' },
    { row:10, col:1,  text: 'PROD01  ISP.SISPLOAD' },
    { row:11, col:1,  text: 'PROD01  SYS1.CSSLIB' },
    // Writable APF entry — dataset name normal, warning text blinks red
    { row:12, col:1,  text: 'WORK01  USER.LOADLIB                    ' },
    { row:12, col:42, saColor: COL_RED, saHighlight: HL_BLINK, text: '*** WRITABLE ***' },
    { row:14, col:0,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_INTENS },
    { row:14, col:1,  text: 'IKJ56250I 8 entries found. USER.LOADLIB on WORK01 may be writable.' },
    { row:16, col:0,  fa: FA_PROTECTED, color: COL_GREEN, highlight: HL_INTENS },
    { row:16, col:1,  text: 'READY' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'Press ENTER or PF3 to return to READY prompt.' },
  ]);
}

function screenLista(userid = 'DEMO') {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'LISTA Output - Allocated Datasets' },
    { row:2,  col:0,  fa: FA_PROTECTED, color: COL_TURQ },
    { row:2,  col:1,  saColor: COL_YELLOW, text: `DDNAME   DSNAME                           DISP` },
    { row:3,  col:1,  saColor: COL_YELLOW, text: '-------- -------------------------------- ----' },
    { row:4,  col:1,  text: `SYSPROC  ${userid.toUpperCase()}.CLIST                    SHR` },
    { row:5,  col:1,  text: `ISPPLIB  ISP.SISPPENU                     SHR` },
    { row:6,  col:1,  text: `ISPSLIB  ISP.SISPSLIB                     SHR` },
    { row:7,  col:1,  text: `ISPTLIB  ISP.SISPTENU                     SHR` },
    { row:8,  col:1,  text: `ISPLLIB  ISP.SISPLOAD                     SHR` },
    { row:9,  col:1,  text: `SYSEXEC  ${userid.toUpperCase()}.REXX.EXEC               SHR` },
    { row:10, col:1,  text: `SYSTSIN  NULLFILE                         OLD` },
    { row:11, col:1,  text: `SYSTSPRT SYSOUT=*                         OLD` },
    { row:13, col:0,  fa: FA_PROTECTED_HIGH, color: COL_GREEN },
    { row:13, col:1,  text: 'IKJ56250I 8 DD allocations listed.' },
    { row:15, col:0,  fa: FA_PROTECTED, color: COL_GREEN, highlight: HL_INTENS },
    { row:15, col:1,  text: 'READY' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'Press ENTER or PF3 to return to READY prompt.' },
  ]);
}

function screenLogonError(userid, attempts, maxAttempts = 3) {
  const remaining = maxAttempts - attempts;
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: `IBM z/OS  -  ${SYSNAME}  -  TSO/E LOGON` },
    { row:2,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_INTENS },
    { row:2,  col:2,  text: 'IKJ56425I PASSWORD NOT CORRECT' },
    { row:3,  col:2,  fa: FA_PROTECTED, color: COL_RED },
    { row:3,  col:2,  text: `IKJ56477I ${remaining} ATTEMPT${remaining !== 1 ? 'S' : ''} REMAINING BEFORE RACF LOCKOUT` },
    { row:5,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:5,  col:2,  text: 'Userid  ===>' },
    { row:5,  col:14, fa: FA_UNPROTECTED, color: COL_GREEN },
    { row:5,  col:15, text: userid.padEnd(8) },
    { row:6,  col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:6,  col:2,  text: 'Password===>' },
    { row:6,  col:14, fa: FA_UNPROTECTED_NUM, color: COL_GREEN, ic: true },
    { row:6,  col:14, text: '        ' },
    { row:13, col:2,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:13, col:2,  text: 'PF1/PF13 ==> Help   PF3/PF15 ==> Logoff   PA1 ==> Attention' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_RED },
    { row:23, col:0,  text: 'Re-enter password and press ENTER.' },
  ]);
}

function screenRacfLockout(userid) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: `IBM z/OS  -  ${SYSNAME}  -  TSO/E LOGON` },
    { row:3,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_REVERSE },
    { row:3,  col:2,  text: 'IKJ56421I RACF AUTHORIZATION FAILURE' },
    { row:4,  col:2,  fa: FA_PROTECTED, color: COL_RED },
    { row:4,  col:2,  text: `IKJ56422I USERID ${userid.toUpperCase().padEnd(8)} HAS BEEN REVOKED` },
    { row:5,  col:2,  saColor: COL_RED, text: 'IKJ56423I CONTACT YOUR SECURITY ADMINISTRATOR TO RESET' },
    { row:8,  col:2,  fa: FA_PROTECTED_HIGH, color: COL_RED, highlight: HL_BLINK },
    { row:8,  col:2,  text: '*** LOGON REJECTED - ACCOUNT LOCKED ***' },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'PF3=Exit' },
  ]);
}

// ── GDDM graphics demo ──────────────────────────────────────────────
// Alphanumeric frame only in rows 0/23 — the graphics area (rows 1-22)
// is left blank so the Object Data WSF's chart (drawn client-side as a
// canvas overlay) doesn't compete with DOM text in the same screen
// region, matching how a real GDDM operator window is a distinct area
// from the surrounding alphanumeric chrome.
function screenGDDM(userid) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'GDDM GRAPHICS DEMO' },
    { row:0,  col:40, fa: FA_PROTECTED, color: COL_BLUE },
    { row:0,  col:40, text: `User: ${userid.padEnd(8)}` },
    { row:23, col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0,  text: 'PF3=Exit to TSO READY' },
  ]);
}

// GDF (Graphics Data Format) order encoders — GDDM Base Application
// Programming Reference ch.10. Byte layouts match tn3270/gddm.js's
// decoder exactly (both were validated against the manual's own worked
// examples, e.g. "C1 08 0002 0003 0004 0006" = Line (2,3)->(4,6)).
function gdfHalfwords(...nums) {
  const buf = Buffer.alloc(nums.length * 2);
  nums.forEach((n, i) => buf.writeInt16BE(n, i * 2));
  return buf;
}
function gdfOrder(code, operand) {
  return Buffer.concat([Buffer.from([code, operand.length]), operand]);
}
function gdfShortOrder(code, byte) {
  return Buffer.from([code, byte]);
}

// Builds a full 3270 Write Structured Field (CMD_WSF + Object Data SF)
// carrying a hand-authored GDF bar chart — "Q4 Regional Sales", four
// colored bars with labels, an axis, and a trend-marker line. This is
// the kind of output GDDM-PGF's Interactive Chart Utility historically
// produced from a TSO/CMS session.
function buildGddmObjectDataWsf() {
  // Heights and label/title y-positions are kept below y=620 (out of the
  // declared yU=700 picture boundary) on purpose — the canvas overlay
  // spans the full terminal, and the alphanumeric frame's header row
  // (row 0, "GDDM GRAPHICS DEMO ... User: ...") lives in roughly the top
  // 8% of that same space (~y>642). Anything drawn above ~y=620 visibly
  // collides with that DOM text (confirmed via screenshot — title and a
  // bar's value label were overlapping "User: IBMUSER").
  const bars = [
    { name: 'NORTH', x: 100, h: 380, color: 0x01 }, // blue
    { name: 'SOUTH', x: 350, h: 250, color: 0x02 }, // red
    { name: 'EAST',  x: 600, h: 480, color: 0x04 }, // green
    { name: 'WEST',  x: 850, h: 170, color: 0x06 }, // yellow
  ];
  const baseY = 100, barWidth = 150;
  const COL_NEUTRAL_WHITE = 0x07, COL_GDF_YELLOW = 0x06;

  const parts = [];
  // Picture boundary (Comment order, coordType=2 → 2-byte integers)
  parts.push(gdfOrder(0x01, Buffer.concat([gdfHalfwords(2), gdfHalfwords(0, 1000, 0, 700)])));

  // Title
  parts.push(gdfShortOrder(0x0A, COL_NEUTRAL_WHITE));
  parts.push(gdfOrder(0xC3, Buffer.concat([gdfHalfwords(280, 610), toEbcdic('Q4 REGIONAL SALES')])));

  // Axes
  parts.push(gdfOrder(0xC1, gdfHalfwords(50, baseY, 950, baseY))); // baseline
  parts.push(gdfOrder(0xC1, gdfHalfwords(50, baseY, 50, 600)));    // left axis

  const markerPoints = [];
  for (const bar of bars) {
    const top = baseY + bar.h;
    parts.push(gdfShortOrder(0x0A, bar.color));
    parts.push(gdfOrder(0xC1, gdfHalfwords(
      bar.x, baseY,
      bar.x, top,
      bar.x + barWidth, top,
      bar.x + barWidth, baseY,
      bar.x, baseY,
    )));
    parts.push(gdfOrder(0xC3, Buffer.concat([gdfHalfwords(bar.x + 20, baseY - 30), toEbcdic(bar.name)])));
    parts.push(gdfOrder(0xC3, Buffer.concat([gdfHalfwords(bar.x + 20, top + 15), toEbcdic(String(bar.h))])));
    markerPoints.push(bar.x + barWidth / 2, top);
  }

  // Trend line across bar tops
  parts.push(gdfShortOrder(0x0A, COL_GDF_YELLOW));
  parts.push(gdfOrder(0xC2, gdfHalfwords(...markerPoints)));

  const gdfData = Buffer.concat(parts);
  const pid = 0x00, flags = 0x03, objtyp = 0x00; // first&last/immediate, Graphics
  const sfBody = Buffer.concat([Buffer.from([pid, flags, objtyp]), gdfData]);
  const sfid = Buffer.from([0x0F, 0x0F]); // Object Data (GA23-0059 ch.5)
  const sfLen = 2 + sfid.length + sfBody.length; // length field counts itself
  const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(sfLen, 0);
  return Buffer.concat([Buffer.from([CMD_WSF]), lenBuf, sfid, sfBody]);
}

function screenTsoCommand(userid = 'DEMO', lastOutput = '') {
  const fields = [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH, color: COL_WHITE, highlight: HL_INTENS },
    { row:0,  col:1,  text: 'ISPF Command Shell' },
    { row:1,  col:0,  fa: FA_PROTECTED, color: COL_BLUE },
    { row:1,  col:1,  text: `Userid: ${userid.padEnd(8)}   System: ${SYSNAME}` },
    { row:3,  col:0,  fa: FA_PROTECTED, color: COL_WHITE },
    { row:3,  col:1,  text: 'TSO Command ===>' },
    { row:3,  col:17, fa: FA_UNPROTECTED, color: COL_GREEN, ic: true },
    { row:3,  col:17, text: '                                        ' },
  ];
  if (lastOutput) {
    const lines = lastOutput.split('\n').slice(0, 14);
    lines.forEach((line, i) => {
      const isErr = line.startsWith('IKJ') && line.includes('NOT FOUND');
      fields.push({ row: 5 + i, col: 0, fa: FA_PROTECTED, color: isErr ? COL_RED : COL_TURQ });
      fields.push({ row: 5 + i, col: 1, text: line.slice(0, 78) });
    });
  }
  fields.push(
    { row:23, col:0, fa: FA_PROTECTED, color: COL_BLUE },
    { row:23, col:0, text: 'ENTER=Execute  PF3=Exit to ISPF  PF12=Cancel' },
  );
  return buildScreen(true, fields);
}

function wrapEOR(data) {
  const escaped = [];
  for (const b of data) {
    escaped.push(b);
    if (b === IAC) escaped.push(IAC);
  }
  escaped.push(IAC, EOR);
  return Buffer.from(escaped);
}

let connCount = 0;

function handleConnection(socket) {
  const id = ++connCount;
  log(`[${id}] Connected from ${socket.remoteAddress}:${socket.remotePort}`);

  let recvBuf       = Buffer.alloc(0);
  let tn3270eMode   = false;
  let cols          = 80;
  let currentScreen = 'logon';
  let lastScreen    = null;
  let userid        = 'DEMO';
  let negotiationComplete = false;
  let requestedLu   = null;   // LU the client asked for via TN3270E CONNECT
  let lastEnteredUser = '';   // last-typed logon fields, for buffer-bleed cache on disconnect
  let lastEnteredPass = '';
  let firstScreenSent = false;

  // Track what we've agreed to
  let clientWillTN3270E  = false;
  let clientFunctionsDone = false;

  const state = { record: [], errorCmd: '', tsoOutput: '' };
  let loginAttempts = 0;
  let accountLocked = false;
  const MAX_ATTEMPTS = 3;

  // Valid credentials for the mock — userid: password (case-insensitive userid, exact password)
  const VALID_CREDENTIALS = {
    'IBMUSER': 'SYS1',
    'DEMO':    'DEMO',
    'USER1':   'PASS1',
  };

  // Send initial negotiation — offer TN3270E, BINARY, EOR
  socket.write(Buffer.from([
    IAC, DO,   OPT_TN3270E,
    IAC, DO,   OPT_BINARY,
    IAC, WILL, OPT_BINARY,
    IAC, DO,   OPT_EOR,
    IAC, WILL, OPT_EOR,
  ]));
  debug(`[${id}] → Initial negotiation sent`);

  socket.on('data', chunk => {
    recvBuf = Buffer.concat([recvBuf, chunk]);
    processBuffer();
  });

  function cacheBufferOnExit() {
    if (requestedLu && (lastEnteredUser || lastEnteredPass)) {
      _luBufferCache.set(requestedLu, { user: lastEnteredUser, pass: lastEnteredPass, ts: Date.now() });
      debug(`[${id}] Cached residual buffer for LU=${requestedLu}`);
    }
  }
  socket.on('end',   () => { log(`[${id}] Disconnected`); cacheBufferOnExit(); });
  socket.on('error', err => { log(`[${id}] Error: ${err.message}`); cacheBufferOnExit(); });

  function processBuffer() {
    // Strip and handle IAC telnet commands first, then find IAC EOR delimiters
    let i = 0;
    while (i < recvBuf.length) {
      if (recvBuf[i] !== IAC) { i++; continue; }

      const cmd = recvBuf[i + 1];
      if (cmd === undefined) break;

      if (cmd === NOP) { i += 2; continue; }

      if (cmd === EOR) {
        // IAC EOR — extract everything before this as a 3270 record
        const record = [];
        for (let j = 0; j < i; j++) {
          // Un-escape IAC IAC → IAC
          if (recvBuf[j] === IAC && recvBuf[j + 1] === IAC) { record.push(0xFF); j++; }
          else record.push(recvBuf[j]);
        }
        recvBuf = recvBuf.slice(i + 2);
        if (record.length > 0) handle3270Record(Buffer.from(record));
        i = 0;
        continue;
      }

      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= recvBuf.length) break;
        handleTelnetCmd(cmd, recvBuf[i + 2]);
        // Remove the telnet command bytes from buffer
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
      if (recvBuf[j] === IAC && recvBuf[j + 1] === SE) return j;
    }
    return -1;
  }

  function handleTelnetCmd(cmd, opt) {
    const n = { [DO]:'DO',[DONT]:'DONT',[WILL]:'WILL',[WONT]:'WONT' };
    const o = { [OPT_BINARY]:'BINARY',[OPT_EOR]:'EOR',[OPT_TTYPE]:'TTYPE',[OPT_TN3270E]:'TN3270E' };
    debug(`[${id}] ← ${n[cmd]} ${o[opt] || '0x'+opt.toString(16)}`);

    if (opt === OPT_TN3270E) {
      if (cmd === WILL) {
        // Client agreed to TN3270E — send device-type request
        tn3270eMode = true;
        clientWillTN3270E = true;
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_REQUEST,
          ...Buffer.from('IBM-3278-2'),
          IAC, SE,
        ]));
        debug(`[${id}] → SB TN3270E DEVICE-TYPE REQUEST IBM-3278-2`);
      } else if (cmd === WONT) {
        // Client refused TN3270E — fall back to classic TN3270
        tn3270eMode = false;
        debug(`[${id}] Client refused TN3270E — classic TN3270 mode`);
        // Ask for terminal type to complete classic negotiation
        socket.write(Buffer.from([IAC, SB, OPT_TTYPE, TN3E_SEND, IAC, SE]));
      }
      return;
    }

    if (opt === OPT_TTYPE && cmd === WILL) {
      socket.write(Buffer.from([IAC, SB, OPT_TTYPE, TN3E_SEND, IAC, SE]));
      return;
    }

    if (opt === OPT_BINARY && cmd === WILL) {
      socket.write(Buffer.from([IAC, DO, OPT_BINARY]));
    }
    if (opt === OPT_EOR && cmd === WILL) {
      socket.write(Buffer.from([IAC, DO, OPT_EOR]));
    }
  }

  function handleSubneg(data) {
    const opt  = data[0];
    const func = data[1];
    debug(`[${id}] Subneg raw: ${[...data].map(b=>'0x'+b.toString(16)).join(' ')}`);

    if (opt === OPT_TN3270E) {

      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_IS) {
        // Client confirmed device-type — pick up the real model it asked for
        // so screen addressing (sba) matches the width the client will render at.
        const deviceStr = data.slice(3).toString('ascii');
        const match = deviceStr.match(/IBM-(3278|3279)-(\d)(-E)?/);
        if (match) {
          const model = `${match[1]}-${match[2]}${match[3] || ''}`;
          const dims  = MODEL_DIMS[model];
          if (dims) { cols = dims.cols; debug(`[${id}] Client device-type ${model} → cols=${cols}`); }
        }
        // Now host must send FUNCTIONS REQUEST
        // (RFC 2355: host asks what functions client wants to use)
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST,
          IAC, SE,
        ]));
        debug(`[${id}] → TN3270E FUNCTIONS REQUEST (asking client)`);
        // Do NOT send screen yet — wait for client's FUNCTIONS IS
      }

      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REQUEST) {
        // Client requesting device type — accept whatever model it asked
        // for by echoing it back, and adopt that model's screen width.
        // Replying with a different type than requested desyncs clients
        // (like x3270) that honor the server's IS.
        const reqStr = data.slice(3).toString('ascii');
        const match  = reqStr.match(/IBM-(3278|3279)-(\d)(-E)?/);
        let accepted = 'IBM-3278-2';
        if (match) {
          const model = `${match[1]}-${match[2]}${match[3] || ''}`;
          const dims  = MODEL_DIMS[model];
          if (dims) { accepted = `IBM-${model}`; cols = dims.cols; }
        }
        // Client may ask for a specific LU via a CONNECT sub-marker after the
        // device-type string — accept whatever it asks for (no allocation
        // check) and echo it back, same as a real VTAM pool would.
        const connIdx = data.indexOf(TN3E_CONNECT, 3);
        if (connIdx !== -1) {
          requestedLu = data.slice(connIdx + 1).toString('ascii');
          debug(`[${id}] ← DEVICE-TYPE REQUEST CONNECT LU=${requestedLu}`);
        }
        const isParts = [IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS, ...Buffer.from(accepted)];
        if (requestedLu) isParts.push(TN3E_CONNECT, ...Buffer.from(requestedLu));
        isParts.push(IAC, SE);
        socket.write(Buffer.from(isParts));
        debug(`[${id}] → TN3270E DEVICE-TYPE IS ${accepted}${requestedLu ? ' CONNECT LU=' + requestedLu : ''} (cols=${cols})`);
      }

      if (func === TN3E_FUNCTIONS && data[2] === TN3E_IS) {
        // Client told us what functions it supports — negotiation complete!
        const supported = data.slice(3);
        debug(`[${id}] ← TN3270E FUNCTIONS IS [${[...supported].map(b=>'0x'+b.toString(16)).join(' ')}]`);
        if (!negotiationComplete) {
          negotiationComplete = true;
          setImmediate(() => sendInitialScreen());
        }
      }

      if (func === TN3E_FUNCTIONS && data[2] === TN3E_REQUEST) {
        // Client requesting functions (unusual but handle gracefully)
        const requested = data.slice(3);
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS,
          ...requested,
          IAC, SE,
        ]));
        debug(`[${id}] → TN3270E FUNCTIONS IS (echoing client request)`);
        if (!negotiationComplete) {
          negotiationComplete = true;
          setImmediate(() => sendInitialScreen());
        }
      }
    }

    if (opt === OPT_TTYPE && func === TN3E_IS) {
      const ttype = data.slice(2).toString('ascii');
      debug(`[${id}] ← TTYPE IS ${ttype}`);
      const match = ttype.match(/IBM-(3278|3279)-(\d)(-E)?/);
      if (match) {
        const model = `${match[1]}-${match[2]}${match[3] || ''}`;
        const dims  = MODEL_DIMS[model];
        if (dims) { cols = dims.cols; debug(`[${id}] Client TTYPE ${model} → cols=${cols}`); }
      }
      if (!negotiationComplete) {
        negotiationComplete = true;
        setImmediate(() => sendInitialScreen());
      }
    }
  }

  function handle3270Record(data) {
    // Once TN3270E is negotiated, the client prepends the same 5-byte header
    // (DATA-TYPE/REQUEST-FLAG/RESPONSE-FLAG/SEQ-NUMBER) it expects to receive —
    // strip it before parsing the AID record underneath.
    const payload = tn3270eMode ? data.slice(5) : data;
    if (payload.length === 0) return;

    const aid = payload[0];
    debug(`[${id}] ← AID 0x${aid.toString(16).toUpperCase()} screen='${currentScreen}'`);

    let inputText = '';
    if (payload.length > 3) {
      // 3270 AID record: AID(1) + cursor-address(2) + [SBA(3) + data]...
      // The cursor address after AID is raw 2 bytes, NOT wrapped in SBA
      let j = 3; // skip AID + 2-byte cursor address
      while (j < payload.length) {
        const b = payload[j];
        if (b === 0x11 && j + 2 < payload.length) {
          // SBA — field boundary, inject space then skip 3 bytes
          inputText += ' ';
          j += 3;
        } else if (b === 0x13 && j + 3 < payload.length) {
          j += 4; // RA order
        } else if ((b === 0x1C || b === 0x1D || b === 0x28 || b === 0x29) && j + 1 < payload.length) {
          j += 2; // SA, SF, MF, SFE
        } else if (b >= 0x40 || b === 0x00) {
          inputText += String.fromCharCode(EBCDIC_TO_ASCII[b] || 0x20);
          j++;
        } else {
          j++;
        }
      }
      inputText = inputText.trim();
    }

    debug(`[${id}] Input: '${inputText}'`);

    switch (currentScreen) {
      case 'logon':
      case 'logonError':
        if (aid === AID_ENTER) {
          if (accountLocked) { sendCurrentScreen(); break; }
          // Parse userid from first field, password from second
          // inputText contains all field data concatenated — split on whitespace
          const parts = inputText.split(/\s+/).filter(Boolean);
          const enteredUser = (parts[0] || 'DEMO').toUpperCase().slice(0, 8);
          const enteredPass = parts[1] || '';
          userid = enteredUser;
          lastEnteredUser = enteredUser;
          lastEnteredPass = enteredPass;
          const validPass = VALID_CREDENTIALS[enteredUser];
          // Case-insensitive on purpose: the real terminal deliberately does
          // NOT force-uppercase nondisplay (password) fields client-side
          // (see public/js/keyboard.js — that matters for real case-sensitive
          // RACF passwords elsewhere), so this mock's own demo credentials
          // shouldn't require the user to remember to type them in caps.
          if (validPass && enteredPass.toUpperCase() === validPass) {
            // Successful logon
            loginAttempts = 0;
            log(`[${id}] Logon success: userid='${userid}'`);
            currentScreen = 'ready';
            state.readyMsg = `IKJ56455I ${userid} LOGGED ON AT ${new Date().toLocaleTimeString('en-US',{hour12:false})}`;
          } else {
            loginAttempts++;
            log(`[${id}] Logon failed for '${enteredUser}' — attempt ${loginAttempts}/${MAX_ATTEMPTS}`);
            if (loginAttempts >= MAX_ATTEMPTS) {
              accountLocked = true;
              currentScreen = 'lockout';
            } else {
              currentScreen = 'logonError';
            }
          }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'lockout':
        if (aid === AID_PF3 || aid === AID_ENTER) socket.end();
        break;

      case 'ready':
      case 'readyOutput':
        if (aid === AID_ENTER) {
          const cmd = inputText.toUpperCase().trim();
          if (!cmd) { sendCurrentScreen(); break; }
          log(`[${id}] TSO command: '${cmd}'`);
          if (cmd === 'ISPF' || cmd === 'ISRDDN') {
            currentScreen = 'ispf'; sendCurrentScreen();
          } else if (cmd === 'LISTAPF') {
            currentScreen = 'listapf'; sendCurrentScreen();
          } else if (cmd === 'LISTA' || cmd === 'LISTA STATUS') {
            currentScreen = 'lista'; sendCurrentScreen();
          } else if (cmd === 'GDDM') {
            currentScreen = 'gddm'; sendCurrentScreen();
            writeRaw(buildGddmObjectDataWsf());
          } else if (cmd === 'WHOAMI' || cmd === 'LISTUSER') {
            state.tsoOutput = `USERID: ${userid}\nSYSTEM: ${SYSNAME}\nGROUPS: SYS1 DEMOGRP\nATTRIBUTES: NONE`;
            currentScreen = 'tsoCmd'; sendCurrentScreen();
          } else if (cmd.startsWith('PROFILE')) {
            state.tsoOutput = `PROFILE NOINTERCOM MSGID NOPROMPT SIZE(32767) LINE(24)\n  MODE(LINE) WTPMSG INTERCOM NOHIGHLIGHT`;
            currentScreen = 'tsoCmd'; sendCurrentScreen();
          } else {
            state.tsoOutput = `IKJ56500I COMMAND ${cmd} NOT FOUND\nIKJ56501I ENTER HELP for list of valid commands`;
            currentScreen = 'tsoCmd'; sendCurrentScreen();
          }
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'listapf':
      case 'lista':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = 'ready'; state.readyMsg = ''; sendCurrentScreen();
        }
        break;

      case 'tsoCmd':
        if (aid === AID_ENTER) {
          const cmd = inputText.toUpperCase().trim();
          if (!cmd) { sendCurrentScreen(); break; }
          log(`[${id}] TSO command shell: '${cmd}'`);
          if (cmd === 'LISTAPF') {
            currentScreen = 'listapf'; sendCurrentScreen();
          } else if (cmd === 'LISTA' || cmd === 'LISTA STATUS') {
            currentScreen = 'lista'; sendCurrentScreen();
          } else if (cmd === 'ISPF') {
            currentScreen = 'ispf'; sendCurrentScreen();
          } else if (cmd === 'GDDM') {
            currentScreen = 'gddm'; sendCurrentScreen();
            writeRaw(buildGddmObjectDataWsf());
          } else {
            state.tsoOutput = `IKJ56500I COMMAND ${cmd} NOT FOUND`;
            sendCurrentScreen();
          }
        } else if (aid === AID_PF3) {
          currentScreen = 'ispf'; sendCurrentScreen();
        }
        break;

      case 'ispf':
        if (aid === AID_ENTER) {
          const opt = inputText.toUpperCase();
          if      (opt === '2')                { lastScreen = 'ispf'; currentScreen = 'edit'; }
          else if (opt === '3' || opt === '3.4') { lastScreen = 'ispf'; currentScreen = 'ispf34'; }
          else if (opt === '6')                { lastScreen = 'ispf'; currentScreen = 'tsoCmd'; state.tsoOutput = ''; }
          else if (opt === 'M' || opt === 'SDSF') { lastScreen = 'ispf'; currentScreen = 'sdsf'; }
          else if (opt === 'X')                { socket.end(); return; }
          else if (opt !== '')                 { lastScreen = 'ispf'; currentScreen = 'error'; state.errorCmd = opt; }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'edit':
      case 'ispf34':
      case 'sdsf':
      case 'error':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = lastScreen || 'ispf';
          sendCurrentScreen();
        } else if (aid === AID_PF7 || aid === AID_PF8) {
          sendCurrentScreen();
        }
        break;

      case 'gddm':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = 'ready'; state.readyMsg = ''; sendCurrentScreen();
        }
        break;
    }
  }

  function writeRaw(ds) {
    if (tn3270eMode) {
      ds = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), ds]);
    }
    socket.write(wrapEOR(ds));
  }

  // First screen of the connection: if this LU had a residual buffer cached
  // from a prior session (see cacheBufferOnExit), flash that stale content
  // as a non-erasing Write before the real (erased) logon screen — see the
  // BUFFER_BLEED comment near _luBufferCache above.
  function sendInitialScreen() {
    if (!firstScreenSent) {
      firstScreenSent = true;
      mockCols = cols;
      const cached = requestedLu ? _luBufferCache.get(requestedLu) : null;
      if (cached && Date.now() - cached.ts < BUFFER_BLEED_WINDOW_MS) {
        _luBufferCache.delete(requestedLu); // one-shot — buffer is "read" now
        log(`[${id}] Buffer bleed: replaying stale LU=${requestedLu} field data before fresh logon`);
        writeRaw(screenBufferBleed(cached));
        setTimeout(() => sendCurrentScreen(), 400);
        return;
      }
    }
    sendCurrentScreen();
  }

  function sendCurrentScreen() {
    mockCols = cols;
    let ds;
    switch (currentScreen) {
      case 'logon':     ds = screenLogon();                          break;
      case 'logonError':ds = screenLogonError(userid, loginAttempts); break;
      case 'lockout':   ds = screenRacfLockout(userid);              break;
      case 'ready':
      case 'readyOutput': ds = screenReady(userid, state.readyMsg || ''); state.readyMsg = ''; break;
      case 'listapf':   ds = screenListapf();                        break;
      case 'lista':     ds = screenLista(userid);                    break;
      case 'tsoCmd':    ds = screenTsoCommand(userid, state.tsoOutput); break;
      case 'ispf':      ds = screenISPF(userid);                     break;
      case 'edit':      ds = screenEdit();                           break;
      case 'ispf34':    ds = screenISPF34(userid);                   break;
      case 'sdsf':      ds = screenSDSF();                           break;
      case 'error':     ds = screenError(state.errorCmd);            break;
      case 'gddm':      ds = screenGDDM(userid);                     break;
      default:          ds = screenISPF(userid);
    }

    if (tn3270eMode) {
      // TN3270E 5-byte header: data-type=0x00 (3270-DATA), request=0x00, response=0x00, seq=0x00 0x00
      ds = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), ds]);
    }

    socket.write(wrapEOR(ds));
    log(`[${id}] → Screen: ${currentScreen} (tn3270e=${tn3270eMode})`);
  }
}

function log(msg)   { console.log(`${new Date().toISOString()} [INFO ] ${msg}`); }
function debug(msg) { if (LOG) console.log(`${new Date().toISOString()} [DEBUG] ${msg}`); }

const server = net.createServer(handleConnection);
server.listen(PORT, '0.0.0.0', () => {
  log('─────────────────────────────────────────────────────');
  log(`  WebTerm/3270 Mock LPAR Daemon`);
  log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  log(`  System ID     ${SYSNAME}`);
  log(`  LU Name       ${LU_NAME}`);
  log(`  Protocol      TN3270E + classic TN3270 fallback`);
  log('─────────────────────────────────────────────────────');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') log(`ERROR: Port ${PORT} already in use`);
  else log(`ERROR: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT',  () => { log('Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('Shutting down...'); server.close(() => process.exit(0)); });
