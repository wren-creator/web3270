/**
 * mock-lpar/mock-zvm.js
 * WebTerm/3270 — Mock z/VM CP/CMS Daemon
 *
 * Simulates a z/VM system over real TN3270(E) protocol.
 * Screen flow:
 *
 *   CP Logon screen
 *       │  ENTER (any userid / password)
 *       ▼
 *   z/VM CP Ready prompt
 *       │  "ipl cms"   or "cms"  → CMS Ready
 *       │  "cp q <x>"             → CP Query response
 *       │  "disc"                 → Disconnect (simulated)
 *       │  "logoff"               → Disconnect
 *       ▼
 *   CMS Ready prompt
 *       │  "filelist"             → FILELIST screen
 *       │  "rdrlist"              → RDRLIST screen
 *       │  "xedit <fn>"          → XEDIT screen
 *       │  "cms"   (already CMS) → CMS Ready (no-op)
 *       │  "cp"                   → back to CP Ready
 *       │  "#cp logoff"           → Disconnect
 */

'use strict';

const net = require('net');

const PORT    = parseInt(process.env.MOCK_ZVM_PORT || '3271', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const LU_NAME = process.env.MOCK_ZVM_LU    || 'ZVMLU01';
const SYSNAME = process.env.MOCK_ZVM_SYSID || 'ZVMPROD';
const VMID    = process.env.MOCK_ZVM_VMID  || 'ZVMSYS1';   // z/VM system name shown on banner

// ── Telnet / TN3270(E) constants ─────────────────────────────────
const IAC  = 0xFF, DONT = 0xFE, DO   = 0xFD;
const WONT = 0xFC, WILL = 0xFB, SB   = 0xFA, SE = 0xF0;
const EOR  = 0xEF;

const OPT_BINARY  = 0x00;
const OPT_EOR     = 0x19;
const OPT_TTYPE   = 0x18;
const OPT_TN3270E = 0x28;

const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

// ── 3270 datastream constants ─────────────────────────────────────
const CMD_ERASE_WRITE = 0xF5;
const CMD_WRITE       = 0xF1;
const ORDER_SF  = 0x1D;
const ORDER_SBA = 0x11;
const ORDER_IC  = 0x13;   // Insert Cursor

const FA_PROTECTED       = 0x60;
const FA_PROTECTED_HIGH  = 0xE0;
const FA_PROTECTED_NUM   = 0x62;
const FA_UNPROTECTED     = 0x40;
const FA_UNPROTECTED_NUM = 0x50;
const FA_DIM             = 0x68;   // protected + non-display intensity

const AID_ENTER = 0x7D;
const AID_CLEAR = 0x6D;
const AID_PF3   = 0xF3;
const AID_PF7   = 0xF7;
const AID_PF8   = 0xF8;
const AID_PF12  = 0xFB; // note: PF12 = 0xFB in 3270 encoding  (PF1=0xF1 … PF12=0xFB, 0x6B … )
// z/VM commonly uses PF3 to clear, PF12 to retrieve, Enter to submit

// ── EBCDIC ↔ ASCII (CP037) ────────────────────────────────────────
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

function sba(row, col) {
  return [ORDER_SBA, ...encodeAddr(row * 80 + col)];
}

function buildScreen(eraseFirst, fields) {
  const parts = [eraseFirst ? CMD_ERASE_WRITE : CMD_WRITE, 0xC3];
  for (const f of fields) {
    parts.push(...sba(f.row, f.col));
    if (f.fa !== undefined) parts.push(ORDER_SF, f.fa);
    if (f.ic)               parts.push(ORDER_IC);
    if (f.text) for (const b of toEbcdic(f.text)) parts.push(b);
  }
  return Buffer.from(parts);
}

function wrapEOR(data) {
  const escaped = [];
  for (const b of data) {
    escaped.push(b);
    if (b === IAC) escaped.push(IAC);   // IAC escaping
  }
  escaped.push(IAC, EOR);
  return Buffer.from(escaped);
}

// ── Screen builders ───────────────────────────────────────────────

function screenLogon() {
  const now      = new Date();
  const timeStr  = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr  = now.toLocaleDateString('en-GB');

  return buildScreen(true, [
    // Banner line
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `z/VM  Version 7 Release 3.0,  Service Level  ${VMID}` },
    { row:1,  col:1,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: `${SYSNAME} AT ${VMID}` },
    { row:2,  col:1,  text: `${dateStr}  ${timeStr}` },
    { row:3,  col:1,  text: 'IBM Confidential OCO Source Materials' },
    { row:4,  col:1,  text: '(c) Copyright IBM Corp. 1981, 2023' },
    { row:5,  col:1,  text: 'Licensed Material - Program Property of IBM' },

    // Logon box
    { row:7,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:7,  col:1,  text: 'LOGON' },
    { row:9,  col:1,  fa: FA_PROTECTED },
    { row:9,  col:1,  text: 'USERID  ==>' },
    { row:9,  col:13, fa: FA_UNPROTECTED },
    { row:9,  col:13, text: '        ' },
    { row:9,  col:13, ic: true },
    { row:10, col:1,  fa: FA_PROTECTED },
    { row:10, col:1,  text: 'PASSWORD==>' },
    { row:10, col:13, fa: FA_UNPROTECTED_NUM },
    { row:10, col:13, text: '        ' },

    { row:12, col:1,  fa: FA_PROTECTED },
    { row:12, col:1,  text: 'Command ==>' },
    { row:12, col:13, fa: FA_UNPROTECTED },
    { row:12, col:13, text: '        ' },

    { row:14, col:1,  fa: FA_PROTECTED },
    { row:14, col:1,  text: 'Enter LOGON to connect to z/VM.' },
    { row:15, col:1,  text: 'Enter DIAL  to connect to a virtual machine.' },

    // OIA-style bottom bar
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=Quit' },
  ]);
}

function screenCPReady(userid, lastMsg = '') {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

  // Build the scrollback area (rows 2–17) with some simulated CP output
  const outputLines = [
    `LOGON AT ${timeStr} ${new Date().toLocaleDateString('en-US')}`,
    `z/VM Version 7 Release 3.0`,
    `Your IPL directory entry will be used to IPL your machine.`,
    `Ready; T=0.01/0.01 ${timeStr}`,
    lastMsg,
  ].filter(Boolean);

  const fields = [
    // Header
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `z/VM CP  ${SYSNAME}      ${userid.padEnd(8)} Logged On` },
    { row:1,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: '─'.repeat(78) },
  ];

  // Output area — protected scrollback text
  outputLines.forEach((line, i) => {
    fields.push({ row: 3 + i, col: 1, fa: FA_PROTECTED });
    fields.push({ row: 3 + i, col: 1, text: line.slice(0, 78) });
  });

  // Input line at bottom
  fields.push(
    { row:20, col:0,  fa: FA_PROTECTED },
    { row:20, col:0,  text: '─'.repeat(80) },
    { row:21, col:1,  fa: FA_PROTECTED_HIGH },
    { row:21, col:1,  text: `${userid}` },
    { row:21, col:10, fa: FA_PROTECTED },
    { row:21, col:10, text: 'CP' },
    { row:21, col:13, fa: FA_UNPROTECTED },
    { row:21, col:13, text: '                                                   ' },
    { row:21, col:13, ic: true },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=Logoff  PF12=Retrieve  Enter=Submit' },
  );

  return buildScreen(true, fields);
}

function screenCMSReady(userid, lastMsg = '') {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });

  const outputLines = [
    `IPL CMS`,
    `z/VM CMS Level ${SYSNAME}`,
    `Ready; T=0.01/0.01 ${timeStr}`,
    lastMsg,
  ].filter(Boolean);

  const fields = [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `z/VM CMS  ${SYSNAME}      ${userid.padEnd(8)}` },
    { row:1,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: '─'.repeat(78) },
  ];

  outputLines.forEach((line, i) => {
    fields.push({ row: 3 + i, col: 1, fa: FA_PROTECTED });
    fields.push({ row: 3 + i, col: 1, text: line.slice(0, 78) });
  });

  fields.push(
    { row:20, col:0,  fa: FA_PROTECTED },
    { row:20, col:0,  text: '─'.repeat(80) },
    { row:21, col:1,  fa: FA_PROTECTED_HIGH },
    { row:21, col:1,  text: `${userid}` },
    { row:21, col:10, fa: FA_PROTECTED },
    { row:21, col:10, text: 'CMS' },
    { row:21, col:14, fa: FA_UNPROTECTED },
    { row:21, col:14, text: '                                                  ' },
    { row:21, col:14, ic: true },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=CP Mode  PF12=Retrieve  Enter=Submit' },
  );

  return buildScreen(true, fields);
}

function screenFilelist(userid) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `FILELIST  A0  V 169  Trunc=169 Size=8  Line=1 Col=1 Alt=0` },
    { row:1,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: 'Cmd   Filename  Filetype  Fm  Format  Lrecl  Records  Blocks  Date      Time' },
    { row:2,  col:0,  fa: FA_PROTECTED },
    { row:2,  col:1,  text: '─'.repeat(78) },

    // Sample files
    { row:3,  col:0,  fa: FA_PROTECTED },
    { row:3,  col:1,  text: '      PROFILE   EXEC      A1  V        80       42       1  2024-01-15 09:12:44' },
    { row:4,  col:1,  text: '      DEMO      REXX      A1  V        80      123       2  2024-03-10 14:22:01' },
    { row:5,  col:1,  text: '      MYJOB     JCL       A1  V        80       18       1  2024-04-01 11:05:33' },
    { row:6,  col:1,  text: '      NOTES     MEMO      A1  V        80       55       1  2024-04-20 08:44:17' },
    { row:7,  col:1,  text: '      CMSLIB    MACLIB    A1  F       400      200      50  2023-12-01 00:00:00' },
    { row:8,  col:1,  text: '      USER      DIRECT    A2  V        80       10       1  2024-02-14 16:30:00' },
    { row:9,  col:1,  text: '      BACKUP    EXEC      A1  V        80       30       1  2024-03-28 10:10:10' },
    { row:10, col:1,  text: '      AUTOEXEC  EXEC      A1  V        80       15       1  2024-01-01 00:00:00' },

    // Command line at the bottom (XEDIT-style)
    { row:20, col:0,  fa: FA_PROTECTED },
    { row:20, col:0,  text: '1= Help  2= Refresh  3= Quit  4= Sort(type)  5= Sort(date)  6= Sort(size)' },
    { row:21, col:0,  fa: FA_PROTECTED_HIGH },
    { row:21, col:1,  text: `${userid}` },
    { row:21, col:10, fa: FA_PROTECTED },
    { row:21, col:10, text: 'FILELIST' },
    { row:21, col:19, fa: FA_UNPROTECTED },
    { row:21, col:19, text: '                                               ' },
    { row:21, col:19, ic: true },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=Quit  PF7=Bkwd  PF8=Fwd  PF12=Cursor' },
  ]);
}

function screenRdrlist(userid) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `RDRLIST   A0  V 108  Trunc=108 Size=3  Line=1 Col=1 Alt=0` },
    { row:1,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: 'Cmd   Filename  Filetype  Fm  Origid   Date      Time     Recs  Class Pri Hold' },
    { row:2,  col:0,  fa: FA_PROTECTED },
    { row:2,  col:1,  text: '─'.repeat(78) },

    { row:3,  col:0,  fa: FA_PROTECTED },
    { row:3,  col:1,  text: `      MYJOB     JOB       RDR  ${userid.padEnd(8)} 04/27/24 09:14:02  250  A    1` },
    { row:4,  col:1,  text: `      REPORT    DATA      RDR  SYSTEM   04/26/24 22:00:11  512  A    2` },
    { row:5,  col:1,  text: `      SYSLOG    OUTPUT    RDR  SYSTEM   04/26/24 23:59:59 1024  A    5` },

    { row:20, col:0,  fa: FA_PROTECTED },
    { row:20, col:0,  text: '1= Help  2= Refresh  3= Quit  4= View  5= Print  6= Receive  9= Purge' },
    { row:21, col:0,  fa: FA_PROTECTED_HIGH },
    { row:21, col:1,  text: `${userid}` },
    { row:21, col:10, fa: FA_PROTECTED },
    { row:21, col:10, text: 'RDRLIST' },
    { row:21, col:19, fa: FA_UNPROTECTED },
    { row:21, col:19, text: '                                               ' },
    { row:21, col:19, ic: true },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=Quit  PF7=Bkwd  PF8=Fwd' },
  ]);
}

function screenXedit(userid, filename = 'DEMO REXX A') {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: `${filename.padEnd(24)} V 80  Trunc=80 Size=12 Line=0 Col=1 Alt=0` },
    { row:1,  col:0,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: '====>                                                          ' },
    { row:1,  col:6,  fa: FA_UNPROTECTED },
    { row:1,  col:6,  text: '                                                         ' },
    { row:1,  col:6,  ic: true },

    // Rulers and content
    { row:2,  col:0,  fa: FA_PROTECTED },
    { row:2,  col:1,  text: '       |...+....1....+....2....+....3....+....4....+....5....+....6....+....7...|' },
    { row:3,  col:1,  text: '00000 * * * Top of File * * *' },
    { row:4,  col:1,  text: "00001 /* DEMO REXX EXEC */" },
    { row:5,  col:1,  text: "00002 say 'Hello from z/VM CMS!'" },
    { row:6,  col:1,  text: "00003 say 'Running on " + SYSNAME + "'" },
    { row:7,  col:1,  text: "00004 do i = 1 to 5" },
    { row:8,  col:1,  text: "00005   say 'Iteration' i" },
    { row:9,  col:1,  text: "00006 end" },
    { row:10, col:1,  text: "00007 exit 0" },
    { row:11, col:1,  text: '00000 * * * End of File * * *' },

    { row:21, col:0,  fa: FA_PROTECTED },
    { row:21, col:0,  text: '1= Help  2= Add  3= Quit  4= Tab  5= Cchar  6= ?  7= Bkwd  8= Fwd  9= Repeat' },
    { row:22, col:0,  text: '10= Rgtleft  11= Spltjoin  12= Power input' },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `XEDIT     ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'PF3=Quit  PF7=Bkwd  PF8=Fwd' },
  ]);
}

function screenCPQuery(userid, queryResult = '') {
  const lines = queryResult.split('\n');
  const fields = [
    { row:0, col:0, fa: FA_PROTECTED_HIGH },
    { row:0, col:1, text: `CP QUERY RESPONSE  ${SYSNAME}` },
    { row:1, col:0, fa: FA_PROTECTED },
    { row:1, col:1, text: '─'.repeat(78) },
  ];

  lines.forEach((line, i) => {
    fields.push({ row: 3 + i, col: 1, fa: FA_PROTECTED });
    fields.push({ row: 3 + i, col: 1, text: line.slice(0, 78) });
  });

  fields.push(
    { row:21, col:1,  fa: FA_PROTECTED_HIGH },
    { row:21, col:1,  text: `${userid}` },
    { row:21, col:10, fa: FA_PROTECTED },
    { row:21, col:10, text: 'CP' },
    { row:21, col:13, fa: FA_UNPROTECTED },
    { row:21, col:13, text: '                                                   ' },
    { row:21, col:13, ic: true },
    { row:23, col:0,  fa: FA_PROTECTED_HIGH },
    { row:23, col:0,  text: `RUNNING   ${SYSNAME}` },
    { row:23, col:30, fa: FA_PROTECTED },
    { row:23, col:30, text: 'Enter=Continue  PF3=CP Ready' },
  );

  return buildScreen(true, fields);
}

// ── CP QUERY simulator ────────────────────────────────────────────
function simulateCPQuery(cmd) {
  const upper = cmd.toUpperCase();
  if (upper.includes('TIME')) {
    const t = new Date();
    return `TIME IS ${t.toLocaleTimeString('en-US', { hour12: false })}  DATE IS ${t.toLocaleDateString('en-US')}\nCPU TIME = 00:00:00.12  CONNECT TIME = 00:05:37`;
  }
  if (upper.includes('NAMES')) {
    return `USERS:  ${SYSNAME.padEnd(8)} ZVMOP    MAINT    TCPIP    OPERATOR\nTOTAL USERS LOGGED ON = 5`;
  }
  if (upper.includes('STORAGE') || upper.includes('STOR')) {
    return `STORAGE = 1G`;
  }
  if (upper.includes('VIRTUAL') || upper.includes('V ')) {
    return `VIRTUAL STORAGE = 256M\nCORE 0 SIZE = 512M\nEXPANDED STORAGE = 1G`;
  }
  if (upper.includes('DASD') || upper.includes('DISK')) {
    return `DASD 191 3390 MFT191  R/W  CYL 3339  BLK 555  EXT 1  LABEL SPOOL\nDASD 192 3390 MFT192  R/O  CYL 1669  BLK 0    EXT 1  LABEL WORK`;
  }
  return `HCPCQV003E Invalid option - ${cmd.split(' ').slice(2).join(' ')}\nReady(00003); T=0.01/0.01`;
}

// ── Connection handler ────────────────────────────────────────────
let connCount = 0;

function handleConnection(socket) {
  const id = ++connCount;
  log(`[${id}] New connection from ${socket.remoteAddress}:${socket.remotePort}`);

  // Per-connection state
  let buf         = Buffer.alloc(0);
  let tn3270eMode = false;
  let negotiated  = false;

  // Telnet option tracking
  let binaryUs = false, binaryThem = false;
  let eorUs    = false, eorThem    = false;
  let ttype    = false;
  let tn3270eUs = false, tn3270eThem = false;

  // Application state
  let currentScreen = 'logon';
  let userid        = 'DEMO';
  let lastCPMsg     = '';
  let lastCMSMsg    = '';
  let cpQueryResult = '';

  socket.on('close', () => log(`[${id}] Disconnected`));
  socket.on('error', err => log(`[${id}] Socket error: ${err.message}`));

  // ── Send opening Telnet negotiation ─────────────────────────────
  // Offer TN3270E, then fall back path for BINARY + EOR + TTYPE
  socket.write(Buffer.from([
    IAC, DO,   OPT_TN3270E,     // "please use TN3270E"
    IAC, WILL, OPT_TN3270E,
    IAC, DO,   OPT_BINARY,
    IAC, WILL, OPT_BINARY,
    IAC, DO,   OPT_EOR,
    IAC, WILL, OPT_EOR,
    IAC, DO,   OPT_TTYPE,
  ]));

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    debug(`[${id}] ← raw: ${[...chunk].map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
    processBuffer();
  });

  function processBuffer() {
    while (buf.length > 0) {
      if (buf[0] === IAC) {
        if (buf.length < 2) return;                   // wait for more
        const cmd = buf[1];

        if (cmd === SE || cmd === NOP) { buf = buf.slice(2); continue; }
        if (cmd === EOR) {
          // End of record — shouldn't reach here as a standalone IAC EOR
          buf = buf.slice(2); continue;
        }

        if ((cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) && buf.length >= 3) {
          handleTelnetOption(cmd, buf[2]);
          buf = buf.slice(3);
          continue;
        }

        if (cmd === SB) {
          const seIdx = buf.indexOf(Buffer.from([IAC, SE]), 2);
          if (seIdx === -1) return;                   // incomplete SB
          handleSB(buf.slice(2, seIdx));
          buf = buf.slice(seIdx + 2);
          continue;
        }

        // Unknown IAC — skip
        buf = buf.slice(2);
        continue;
      }

      // Look for IAC EOR to delimit a 3270 data record
      let eorPos = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === IAC && buf[i + 1] === EOR) { eorPos = i; break; }
      }
      if (eorPos === -1) return;   // incomplete record, wait

      const rawRecord = buf.slice(0, eorPos);
      buf = buf.slice(eorPos + 2);

      // Unescape doubled IAC
      const record = [];
      for (let i = 0; i < rawRecord.length; i++) {
        if (rawRecord[i] === IAC && i + 1 < rawRecord.length && rawRecord[i + 1] === IAC) {
          record.push(IAC); i++;
        } else {
          record.push(rawRecord[i]);
        }
      }
      handle3270Record(Buffer.from(record));
    }
  }

  function handleTelnetOption(cmd, opt) {
    debug(`[${id}] Telnet ${['DO','DONT','WILL','WONT'][cmd-0xFD]} OPT=0x${opt.toString(16)}`);
    if (cmd === WILL && opt === OPT_TN3270E) {
      tn3270eThem = true;
      // Nothing more — wait for SB TN3270E SEND DEVICE-TYPE to proceed
    } else if (cmd === DO && opt === OPT_TN3270E) {
      tn3270eUs = true;
    } else if (cmd === WILL && opt === OPT_BINARY) { binaryThem = true; checkReady(); }
    else if (cmd === DO   && opt === OPT_BINARY)   { binaryUs   = true; checkReady(); }
    else if (cmd === WILL && opt === OPT_EOR)       { eorThem    = true; checkReady(); }
    else if (cmd === DO   && opt === OPT_EOR)       { eorUs      = true; checkReady(); }
    else if (cmd === DO   && opt === OPT_TTYPE)     { ttype      = true; checkReady(); }
    else if (cmd === WILL && opt === OPT_TTYPE)     { /* send TTYPE request */ }
    else if (cmd === DONT || cmd === WONT) { /* ignore */ }
  }

  function handleSB(payload) {
    if (payload.length === 0) return;
    debug(`[${id}] SB opt=0x${payload[0].toString(16)} len=${payload.length}`);

    if (payload[0] === OPT_TN3270E) {
      const subCmd = payload[1];
      if (subCmd === TN3E_SEND && payload[2] === TN3E_DEVICE_TYPE) {
        // Client wants to negotiate device type — respond with IBM-3278-2-E
        const response = Buffer.from([
          IAC, SB, OPT_TN3270E,
          TN3E_DEVICE_TYPE, TN3E_IS,
          ...Buffer.from('IBM-3278-2-E'),
          0x01,   // CONNECT
          ...Buffer.from(LU_NAME),
          IAC, SE,
        ]);
        socket.write(response);
        log(`[${id}] Sent TN3270E DEVICE-TYPE IS IBM-3278-2-E LU=${LU_NAME}`);
      } else if (subCmd === TN3E_FUNCTIONS && payload[2] === TN3E_REQUEST) {
        // Client requesting FUNCTIONS — respond with FUNCTIONS IS (empty = basic)
        const response = Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS, IAC, SE]);
        socket.write(response);
        log(`[${id}] Sent TN3270E FUNCTIONS IS`);
        tn3270eMode = true;
        negotiated  = true;
        log(`[${id}] TN3270E negotiation complete — sending logon screen`);
        sendCurrentScreen();
      } else if (subCmd === TN3E_FUNCTIONS && payload[2] === TN3E_IS) {
        // Client accepted our FUNCTIONS IS — we're done
        tn3270eMode = true;
        negotiated  = true;
        log(`[${id}] TN3270E complete (client sent FUNCTIONS IS) — sending logon screen`);
        sendCurrentScreen();
      }
    } else if (payload[0] === OPT_TTYPE) {
      if (payload[1] === 0x00) {
        const ttype_str = payload.slice(2).toString('ascii');
        debug(`[${id}] TTYPE = ${ttype_str}`);
        // Fall-through to classic TN3270 if TN3270E wasn't accepted
        if (!negotiated) {
          negotiated = true;
          log(`[${id}] Classic TN3270 negotiation complete — sending logon screen`);
          sendCurrentScreen();
        }
      }
    }
  }

  function checkReady() {
    // Classic TN3270 path: BINARY both ways + EOR + TTYPE
    if (!negotiated && binaryUs && binaryThem && eorUs && eorThem && ttype) {
      // Request TTYPE from client
      socket.write(Buffer.from([IAC, SB, OPT_TTYPE, 0x01, IAC, SE]));
    }
  }

  function handle3270Record(data) {
    if (!negotiated) return;

    // Strip TN3270E 5-byte header if present
    const payload = tn3270eMode && data.length >= 5 ? data.slice(5) : data;
    if (payload.length === 0) return;

    const aid = payload[0];
    debug(`[${id}] ← AID 0x${aid.toString(16).padStart(2,'0')} screen='${currentScreen}'`);

    // Extract typed text from field write data
    let inputText = '';
    if (payload.length > 3) {
      let j = 3;
      while (j < payload.length) {
        if (payload[j] === 0x11 && j + 2 < payload.length) {
          j += 3;   // skip SBA + 2 address bytes
        } else {
          const b = payload[j];
          if (b >= 0x40) inputText += String.fromCharCode(EBCDIC_TO_ASCII[b] || 0x20);
          j++;
        }
      }
      inputText = inputText.trim();
    }
    debug(`[${id}] Input: '${inputText}'`);

    switch (currentScreen) {
      case 'logon':
        if (aid === AID_ENTER) {
          userid = (inputText || 'DEMO').slice(0, 8).toUpperCase();
          log(`[${id}] Logon: userid='${userid}'`);
          currentScreen = 'cp';
          lastCPMsg     = '';
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'cp': {
        const cmd = inputText.toUpperCase().trim();
        if (aid === AID_ENTER) {
          if (!cmd) { sendCurrentScreen(); break; }

          if (cmd === 'IPL CMS' || cmd === 'CMS' || cmd === 'IPL 190') {
            currentScreen = 'cms';
            lastCMSMsg    = 'IPL CMS\nz/VM CMS is loaded.\nReady; T=0.01/0.01';
            sendCurrentScreen();
          } else if (cmd.startsWith('Q ') || cmd.startsWith('QUERY ') || cmd === 'QUERY' || cmd === 'Q') {
            cpQueryResult = simulateCPQuery(inputText);
            currentScreen = 'cpquery';
            sendCurrentScreen();
          } else if (cmd === 'LOGOFF' || cmd === 'LOG' || cmd === 'DISC') {
            log(`[${id}] Logoff requested`);
            socket.end();
          } else if (cmd === 'HELP') {
            cpQueryResult = `CP COMMANDS:\n  IPL CMS       - Load CMS\n  QUERY TIME    - Display time\n  QUERY NAMES   - List logged-on users\n  QUERY STORAGE - Display storage\n  QUERY DASD    - Display DASD\n  LOGOFF        - Logoff\nReady; T=0.01/0.01`;
            currentScreen = 'cpquery';
            sendCurrentScreen();
          } else {
            lastCPMsg = `HCPCMD003E Unknown CP command: ${inputText}\nReady(00003); T=0.01/0.01`;
            sendCurrentScreen();
          }
        } else if (aid === AID_PF3) {
          // PF3 on CP = logoff in real z/VM; simulate disconnect
          socket.end();
        }
        break;
      }

      case 'cpquery':
        if (aid === AID_ENTER || aid === AID_PF3) {
          currentScreen = 'cp';
          lastCPMsg     = cpQueryResult.split('\n').pop() || '';
          sendCurrentScreen();
        }
        break;

      case 'cms': {
        const cmd = inputText.toUpperCase().trim();
        if (aid === AID_ENTER) {
          if (!cmd) { sendCurrentScreen(); break; }

          if (cmd === 'FILELIST' || cmd === 'FL') {
            currentScreen = 'filelist';
            sendCurrentScreen();
          } else if (cmd === 'RDRLIST' || cmd === 'RL') {
            currentScreen = 'rdrlist';
            sendCurrentScreen();
          } else if (cmd.startsWith('XEDIT ') || cmd.startsWith('X ')) {
            const parts    = inputText.trim().split(/\s+/);
            const filename = parts.slice(1).join(' ') || 'DEMO REXX A';
            currentScreen  = 'xedit';
            // store filename for xedit screen (re-use lastCMSMsg as a hack)
            lastCMSMsg = filename;
            sendCurrentScreen();
          } else if (cmd === 'CP') {
            // Drop back to CP mode
            currentScreen = 'cp';
            lastCPMsg     = 'CP entered.';
            sendCurrentScreen();
          } else if (cmd === '#CP LOGOFF' || cmd === 'LOGOFF') {
            socket.end();
          } else if (cmd === 'CMS') {
            lastCMSMsg = 'Already in CMS.  Ready; T=0.01/0.01';
            sendCurrentScreen();
          } else {
            lastCMSMsg = `DMSEXT002S Command not found: ${inputText}\nReady(00002); T=0.01/0.01`;
            sendCurrentScreen();
          }
        } else if (aid === AID_PF3) {
          // PF3 from CMS → back to CP
          currentScreen = 'cp';
          lastCPMsg     = 'Returned to CP from CMS.';
          sendCurrentScreen();
        }
        break;
      }

      case 'filelist':
      case 'rdrlist':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = 'cms';
          lastCMSMsg    = 'Ready; T=0.01/0.01';
          sendCurrentScreen();
        }
        break;

      case 'xedit':
        if (aid === AID_PF3) {
          currentScreen = 'cms';
          lastCMSMsg    = `File saved: ${lastCMSMsg}\nReady; T=0.01/0.01`;
          sendCurrentScreen();
        } else if (aid === AID_ENTER) {
          // Stay in XEDIT — rerender same screen
          sendCurrentScreen();
        }
        break;
    }
  }

  function sendCurrentScreen() {
    let ds;
    switch (currentScreen) {
      case 'logon':    ds = screenLogon();                          break;
      case 'cp':       ds = screenCPReady(userid, lastCPMsg);       break;
      case 'cpquery':  ds = screenCPQuery(userid, cpQueryResult);   break;
      case 'cms':      ds = screenCMSReady(userid, lastCMSMsg);     break;
      case 'filelist': ds = screenFilelist(userid);                 break;
      case 'rdrlist':  ds = screenRdrlist(userid);                  break;
      case 'xedit':    ds = screenXedit(userid, lastCMSMsg);        break;
      default:         ds = screenLogon();
    }

    if (tn3270eMode) {
      // TN3270E 5-byte header: data-type=0x00, request=0x00, response=0x00, seq=0x00 0x00
      ds = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), ds]);
    }

    socket.write(wrapEOR(ds));
    log(`[${id}] → Screen: ${currentScreen} (tn3270e=${tn3270eMode})`);
  }
}

// ── Logging ───────────────────────────────────────────────────────
function log(msg)   { console.log(`${new Date().toISOString()} [INFO ] ${msg}`); }
function debug(msg) { if (LOG) console.log(`${new Date().toISOString()} [DEBUG] ${msg}`); }

// ── Start server ──────────────────────────────────────────────────
const server = net.createServer(handleConnection);
server.listen(PORT, '0.0.0.0', () => {
  log('─────────────────────────────────────────────────────');
  log('  WebTerm/3270 Mock z/VM Daemon');
  log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  log(`  System ID     ${SYSNAME}`);
  log(`  VM ID         ${VMID}`);
  log(`  LU Name       ${LU_NAME}`);
  log('  Protocol      TN3270E + classic TN3270 fallback');
  log('  Screens       Logon → CP → CMS → FILELIST / RDRLIST / XEDIT');
  log('─────────────────────────────────────────────────────');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') log(`ERROR: Port ${PORT} already in use`);
  else log(`ERROR: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT',  () => { log('Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('Shutting down...'); server.close(() => process.exit(0)); });
