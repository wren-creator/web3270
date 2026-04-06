/**
 * mock-lpar/mock-lpar.js
 * ─────────────────────────────────────────────────────────────────
 * Lightweight mock LPAR daemon for WebTerm/3270 demonstrations.
 *
 * Listens on TCP (default port 3270 or set MOCK_PORT) and speaks
 * real TN3270 protocol — Telnet option negotiation, EBCDIC-encoded
 * 3270 datastreams, AID key handling — so the bridge connects to it
 * exactly as it would a real z/OS mainframe.
 *
 * Simulates a realistic z/OS session flow:
 *   1. TSO/E Logon screen
 *   2. ISPF Primary Option Menu  (after ENTER on logon)
 *   3. ISPF Edit — JCL member    (option 2 + ENTER)
 *   4. SDSF Output Display       (option M/SDSF + ENTER)
 *   5. Error / unknown command    (any unrecognised input)
 *   PF3 always goes back one screen.
 *
 * Usage:
 *   node mock-lpar/mock-lpar.js
 *   MOCK_PORT=339 node mock-lpar/mock-lpar.js
 *   MOCK_PORT=339 LOG_LEVEL=debug node mock-lpar/mock-lpar.js
 *
 * No extra npm packages required — uses only Node.js built-ins.
 */

'use strict';

const net    = require('net');
const path   = require('path');

// ── Config ─────────────────────────────────────────────────────────
const PORT     = parseInt(process.env.MOCK_PORT  || '3270', 10);
const LOG      = (process.env.LOG_LEVEL || 'info') === 'debug';
const LU_NAME  = process.env.MOCK_LU    || 'MOCKLU01';
const SYSNAME  = process.env.MOCK_SYSID || 'MOCKPROD';

// ── Telnet constants ───────────────────────────────────────────────
const IAC  = 0xFF, DONT = 0xFE, DO   = 0xFD;
const WONT = 0xFC, WILL = 0xFB, SB   = 0xFA, SE = 0xF0;
const EOR  = 0xEF, NOP  = 0xF1;

const OPT_BINARY  = 0x00;
const OPT_EOR     = 0x19;
const OPT_TTYPE   = 0x18;
const OPT_TN3270E = 0x28;

// TN3270E sub-option function codes
const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

// 3270 write commands
const CMD_ERASE_WRITE  = 0xF5;
const CMD_WRITE        = 0xF1;

// 3270 orders
const ORDER_SF  = 0x1D; // Start Field
const ORDER_SBA = 0x11; // Set Buffer Address
const ORDER_IC  = 0x13; // Insert Cursor

// Field attribute bytes (EBCDIC-encoded)
const FA_PROTECTED        = 0x60; // protected, normal intensity
const FA_PROTECTED_HIGH   = 0xE0; // protected, high intensity
const FA_UNPROTECTED      = 0x40; // unprotected (input field)
const FA_UNPROTECTED_NUM  = 0x50; // unprotected, numeric

// AID bytes
const AID_ENTER = 0x7D;
const AID_CLEAR = 0x6D;
const AID_PF3   = 0xF3;
const AID_PF7   = 0xF7;
const AID_PF8   = 0xF8;

// ── EBCDIC CP037 (ASCII → EBCDIC) ─────────────────────────────────
// Full 256-entry reverse table built from the CP037 definition
const ASCII_TO_EBCDIC = Buffer.alloc(256, 0x3F); // 0x3F = '?'
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
for (let eb = 0; eb < 256; eb++) {
  const asc = EBCDIC_TO_ASCII[eb];
  if (ASCII_TO_EBCDIC[asc] === 0x3F) ASCII_TO_EBCDIC[asc] = eb;
}

function toEbcdic(str) {
  const buf = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = ASCII_TO_EBCDIC[str.charCodeAt(i)] ?? 0x3F;
  return buf;
}

function fromEbcdic(buf) {
  let s = '';
  for (const b of buf) {
    const a = EBCDIC_TO_ASCII[b];
    s += String.fromCharCode(a >= 0x20 && a < 0x7F ? a : 0x20);
  }
  return s;
}

// ── 3270 buffer address encoding ───────────────────────────────────
function encodeAddr(addr) {
  const hi = (addr >> 6) & 0x3F;
  const lo =  addr       & 0x3F;
  const encode6 = n => n < 0x3F ? 0x40 + n : 0xC0 + (n - 0x3F);
  return [encode6(hi), encode6(lo)];
}

function sba(row, col) {
  const addr = row * 80 + col;
  return [ORDER_SBA, ...encodeAddr(addr)];
}

// ── Screen builder ─────────────────────────────────────────────────
// Each screen is a function that returns a 3270 datastream Buffer.
// Lines are 80 chars wide (model 3278-2).

const COLS = 80;
const ROWS = 24;

function buildScreen(eraseFirst, fields) {
  // fields: [{ row, col, text, fa, isInput }]
  const parts = [eraseFirst ? CMD_ERASE_WRITE : CMD_WRITE, 0xC3]; // WCC: reset MDT, unlock kbd

  for (const f of fields) {
    // Set Buffer Address
    parts.push(...sba(f.row, f.col));

    if (f.fa !== undefined) {
      // Start Field with attribute
      parts.push(ORDER_SF, f.fa);
    }

    if (f.text) {
      // Text content (EBCDIC-encoded)
      for (const b of toEbcdic(f.text)) parts.push(b);
    }
  }

  return Buffer.from(parts);
}

// ── Screens ────────────────────────────────────────────────────────

function screenLogon() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '/');

  return buildScreen(true, [
    // Title
    { row:1, col:20, fa: FA_PROTECTED_HIGH },
    { row:1, col:21, text: `IBM z/OS  -  ${SYSNAME}  -  TSO/E LOGON` },

    // Subtitle
    { row:2, col:0, fa: FA_PROTECTED },
    { row:3, col:2, text: 'Enter LOGON parameters below:' },
    { row:3, col:40, text: 'RACF LOGON parameters:' },

    // Userid label + input
    { row:5, col:2, fa: FA_PROTECTED },
    { row:5, col:2, text: 'Userid  ===>' },
    { row:5, col:14, fa: FA_UNPROTECTED },
    { row:5, col:14, text: '        ' },  // 8-char input field

    // Password label + input (protected display — masked)
    { row:6, col:2, fa: FA_PROTECTED },
    { row:6, col:2, text: 'Password===>' },
    { row:6, col:14, fa: FA_UNPROTECTED_NUM },
    { row:6, col:14, text: '        ' },

    // Procedure
    { row:7, col:2, fa: FA_PROTECTED },
    { row:7, col:2, text: 'Procedure==> TSOPROC' },

    // Acct
    { row:7, col:40, fa: FA_PROTECTED },
    { row:7, col:40, text: 'Acct Nmbr===> DEMO01' },

    // Notes
    { row:10, col:2, fa: FA_PROTECTED },
    { row:10, col:2, text: "Enter an 'S' before each option desired below:" },
    { row:11, col:18, text: '-Nomail         -Nonotice       -Reconnect' },

    // PF key hints
    { row:13, col:2, fa: FA_PROTECTED },
    { row:13, col:2, text: 'PF1/PF13 ==> Help   PF3/PF15 ==> Logoff   PA1 ==> Attention' },

    // Footer / version
    { row:15, col:2, fa: FA_PROTECTED },
    { row:15, col:2, text: `${SYSNAME} - Mock LPAR Daemon v1.0  ${dateStr}  ${timeStr}` },

    // Cursor on userid field
    { row:5, col:14, fa: undefined, text: '' },

    // Insert cursor here
    ...(() => {
      const addr = 5 * COLS + 14;
      return [{ row:5, col:14, fa: undefined, text: '' }];
    })(),
  ]);
}

function screenISPF(userid = 'DEMO') {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
  return buildScreen(true, [
    { row:0, col:24, fa: FA_PROTECTED_HIGH },
    { row:0, col:25, text: 'ISPF Primary Option Menu' },

    { row:2, col:2, fa: FA_PROTECTED_HIGH },
    { row:2, col:2, text: 'Option ===>' },
    { row:2, col:13, fa: FA_UNPROTECTED },
    { row:2, col:13, text: '    ' },

    { row:4, col:2, fa: FA_PROTECTED },
    { row:4, col:5, text: '0' },
    { row:4, col:8, text: 'Settings       Terminal and user parameters' },

    { row:5, col:5, text: '1' },
    { row:5, col:8, text: 'View           Display source data or listings' },

    { row:6, col:5, text: '2' },
    { row:6, col:8, text: 'Edit           Create or change source data' },

    { row:7, col:5, text: '3' },
    { row:7, col:8, text: 'Utilities      Perform utility functions' },

    { row:8, col:5, text: '4' },
    { row:8, col:8, text: 'Foreground     Interactive language processing' },

    { row:9, col:5, text: '5' },
    { row:9, col:8, text: 'Batch          Submit job for language processing' },

    { row:10, col:5, text: '6' },
    { row:10, col:8, text: 'Command        Enter TSO or Workstation commands' },

    { row:11, col:5, text: 'M' },
    { row:11, col:8, text: 'SDSF           System Display and Search Facility' },

    { row:13, col:5, text: 'X' },
    { row:13, col:8, text: 'Exit           Terminate ISPF using log/list defaults' },

    { row:20, col:1, fa: FA_PROTECTED },
    { row:20, col:1, text: ` User ID . : ${userid.padEnd(8)}    Time. . .: ${timeStr}` },
    { row:21, col:1, text: ` System ID : ${SYSNAME.padEnd(8)}    Terminal .: 3278` },

    { row:23, col:0, fa: FA_PROTECTED },
    { row:23, col:0, text: 'F1=Help   F2=Split  F3=Exit   F7=Backward  F8=Forward  F12=Cancel' },
  ]);
}

function screenEdit() {
  return buildScreen(true, [
    { row:0, col:0, fa: FA_PROTECTED_HIGH },
    { row:0, col:1, text: `Edit - DEMO.JCL.CNTL(MYJOB) - 01.00          Columns 00001 00072` },

    { row:1, col:1, fa: FA_PROTECTED },
    { row:1, col:1, text: 'Command ===>' },
    { row:1, col:13, fa: FA_UNPROTECTED },
    { row:1, col:13, text: '                                    ' },
    { row:1, col:50, fa: FA_PROTECTED },
    { row:1, col:50, text: 'Scroll ===> CSR' },

    { row:2, col:0, fa: FA_PROTECTED },
    { row:2, col:0,  text: '000001 //MYJOB    JOB (DEMO),' },
    { row:3, col:0,  text: "000002 //             'DEMO BATCH JOB'," },
    { row:4, col:0,  text: '000003 //             CLASS=A,MSGCLASS=X,' },
    { row:5, col:0,  text: '000004 //             NOTIFY=&SYSUID' },
    { row:6, col:0,  text: '000005 //*' },
    { row:7, col:0,  text: '000006 //* ─── STEP 1: COPY INPUT FILE ───────────────────' },
    { row:8, col:0,  text: '000007 //*' },
    { row:9, col:0,  text: '000008 //COPY     EXEC PGM=IEBGENER' },
    { row:10, col:0, text: '000009 //SYSPRINT DD SYSOUT=*' },
    { row:11, col:0, text: '000010 //SYSUT1   DD DSN=PROD.INPUT.DATA,DISP=SHR' },
    { row:12, col:0, text: '000011 //SYSUT2   DD DSN=WORK.OUTPUT.DATA,' },
    { row:13, col:0, text: '000012 //             DISP=(NEW,CATLG,DELETE),' },
    { row:14, col:0, text: '000013 //             SPACE=(CYL,(5,2),RLSE),' },
    { row:15, col:0, text: '000014 //             DCB=(RECFM=FB,LRECL=80,BLKSIZE=27920)' },
    { row:16, col:0, text: '000015 //SYSIN    DD DUMMY' },
    { row:17, col:0, text: '000016 //*' },
    { row:18, col:0, text: '000017 //* ─── STEP 2: RUN BATCH PROGRAM ────────────────' },
    { row:19, col:0, text: "000018 //BATCH    EXEC PGM=IKJEFT01,PARM='CALL'" },
    { row:20, col:0, text: '000019 //SYSTSPRT DD SYSOUT=*' },
    { row:21, col:0, text: '000020 //SYSTSIN  DD *' },

    { row:23, col:0, fa: FA_PROTECTED },
    { row:23, col:0, text: 'F2=Split  F3=Exit  F5=Rfind  F6=Rchange  F7=Up  F8=Down  F14=Save' },
  ]);
}

function screenSDSF() {
  return buildScreen(true, [
    { row:0, col:0, fa: FA_PROTECTED_HIGH },
    { row:0, col:1, text: 'SDSF OUTPUT DISPLAY MYJOB   JOB07432  DSID   2 LINE 0    COLUMNS 02-81' },

    { row:1, col:1, fa: FA_PROTECTED },
    { row:1, col:1, text: 'COMMAND INPUT ===>' },
    { row:1, col:18, fa: FA_UNPROTECTED },
    { row:1, col:18, text: '                              ' },
    { row:1, col:49, fa: FA_PROTECTED },
    { row:1, col:49, text: 'SCROLL ===> PAGE' },

    { row:3, col:0, fa: FA_PROTECTED },
    { row:3, col:9,  text: '1 //MYJOB    JOB (DEMO),CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID' },
    { row:4, col:9,  text: '2 //*' },
    { row:5, col:9,  text: '3 //STEP1    EXEC PGM=IEFBR14' },
    { row:6, col:9,  text: '4 //DD1      DD   DSN=PROD.DATA.FILE,DISP=SHR' },
    { row:8, col:1,  text: 'IEF236I ALLOC. FOR MYJOB STEP1' },
    { row:9, col:1,  text: 'IEF237I DD1     ALLOCATED TO PROD.DATA.FILE' },
    { row:10, col:1, text: 'IEF142I MYJOB STEP1 - STEP WAS EXECUTED - COND CODE 0000' },
    { row:11, col:1, text: 'IEF285I   PROD.DATA.FILE                             KEPT' },
    { row:12, col:1, text: 'IEF373I STEP/STEP1  /START 2024077.1032' },
    { row:13, col:1, text: 'IEF374I STEP/STEP1  /STOP  2024077.1032 CPU 0MIN 00.01SEC' },
    { row:14, col:1, text: 'IEF375I  JOB/MYJOB  /START 2024077.1032' },
    { row:15, col:1, text: 'IEF376I  JOB/MYJOB  /STOP  2024077.1032 CPU 0MIN 00.01SEC' },
    { row:16, col:1, text: 'IEF377I  JOB/MYJOB  ELAPSED TIME  00:00:01' },

    { row:18, col:1, fa: FA_PROTECTED_HIGH },
    { row:18, col:1, text: '*** END OF DATA ***' },

    { row:23, col:0, fa: FA_PROTECTED },
    { row:23, col:0, text: 'F1=Help  F3=End  F5=RFind  F7=Up  F8=Down  F10=Left  F11=Right' },
  ]);
}

function screenError(cmd) {
  return buildScreen(true, [
    { row:0, col:0, fa: FA_PROTECTED_HIGH },
    { row:0, col:1, text: 'ISPF  ***  ERROR  ***' },

    { row:2, col:2, fa: FA_PROTECTED },
    { row:2, col:2, text: `Unknown option: '${(cmd || '').trim()}'` },
    { row:4, col:2, text: 'Valid primary options: 0 1 2 3 4 5 6 M X' },
    { row:5, col:2, text: 'Press PF3 to return to the Primary Option Menu.' },

    { row:7, col:2, fa: FA_PROTECTED_HIGH },
    { row:7, col:2, text: 'IKJ56500I COMMAND NOT FOUND' },

    { row:23, col:0, fa: FA_PROTECTED },
    { row:23, col:0, text: 'F3=Return  F12=Cancel' },
  ]);
}

// ── Wrap a 3270 datastream in IAC EOR for transmission ────────────
function wrapEOR(data) {
  const escaped = [];
  for (const b of data) {
    escaped.push(b);
    if (b === IAC) escaped.push(IAC); // escape IAC bytes
  }
  escaped.push(IAC, EOR);
  return Buffer.from(escaped);
}

// ── Connection handler ─────────────────────────────────────────────
let connCount = 0;

function handleConnection(socket) {
  const id = ++connCount;
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  log(`[${id}] Connected from ${remote}`);

  let recvBuf        = Buffer.alloc(0);
  let negotiated     = false;
  let tn3270eMode    = false;
  let currentScreen  = 'logon'; // logon | ispf | edit | sdsf | error
  let lastScreen     = null;
  let userid         = 'DEMO';

  // Track negotiation state
  let sentWillBinary = false, sentWillEOR = false, sentWillTType = false;
  let sentWillTN3270E = false;

  // ── Send initial Telnet negotiation ──────────────────────────────
  // We offer TN3270E, Binary, EOR — exactly what a real z/OS host does
  const initNeg = Buffer.from([
    IAC, DO,   OPT_TN3270E,
    IAC, DO,   OPT_BINARY,
    IAC, WILL, OPT_BINARY,
    IAC, DO,   OPT_EOR,
    IAC, WILL, OPT_EOR,
  ]);
  socket.write(initNeg);
  debug(`[${id}] → Sent initial negotiation (DO TN3270E, DO/WILL BINARY, DO/WILL EOR)`);

  socket.on('data', chunk => {
    recvBuf = Buffer.concat([recvBuf, chunk]);
    processBuffer();
  });

  socket.on('end',   () => log(`[${id}] Disconnected (FIN)`));
  socket.on('error', err => log(`[${id}] Error: ${err.message}`));

  function processBuffer() {
    let i = 0;
    while (i < recvBuf.length) {
      if (recvBuf[i] !== IAC) { i++; continue; }

      const cmd = recvBuf[i + 1];
      if (cmd === undefined) break;

      if (cmd === NOP) { i += 2; continue; }

      if (cmd === EOR) {
        // End of a 3270 data record — handle AID
        if (state.record.length > 0) {
          handle3270Record(Buffer.from(state.record));
          state.record = [];
        }
        i += 2;
        continue;
      }

      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= recvBuf.length) break;
        handleTelnetCmd(cmd, recvBuf[i + 2]);
        i += 3;
        continue;
      }

      if (cmd === SB) {
        const seIdx = findSE(i + 2);
        if (seIdx === -1) break;
        handleSubneg(recvBuf.slice(i + 2, seIdx));
        i = seIdx + 2;
        continue;
      }

      if (cmd === IAC) {
        // Escaped 0xFF data byte — part of a 3270 record
        state.record.push(0xFF);
        i += 2;
        continue;
      }

      i += 2;
    }

    // Any remaining non-IAC bytes are 3270 data record content
    // (handled above via state.record accumulation)
    recvBuf = recvBuf.slice(i);
  }

  const state = { record: [] };

  function findSE(start) {
    for (let j = start; j < recvBuf.length - 1; j++) {
      if (recvBuf[j] === IAC && recvBuf[j + 1] === SE) return j;
    }
    return -1;
  }

  function handleTelnetCmd(cmd, opt) {
    const names = { [DO]:'DO',[DONT]:'DONT',[WILL]:'WILL',[WONT]:'WONT' };
    const onames = { [OPT_BINARY]:'BINARY',[OPT_EOR]:'EOR',[OPT_TTYPE]:'TTYPE',[OPT_TN3270E]:'TN3270E' };
    debug(`[${id}] ← ${names[cmd]} ${onames[opt] || opt}`);

    if (opt === OPT_TN3270E) {
      if (cmd === WILL) {
        // Client agrees to TN3270E — send device-type request
        tn3270eMode = true;
        const devReq = Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_REQUEST,
          ...Buffer.from('IBM-3278-2'),
          IAC, SE,
        ]);
        socket.write(devReq);
        debug(`[${id}] → SB TN3270E DEVICE-TYPE REQUEST IBM-3278-2`);
      }
      return;
    }

    if (opt === OPT_TTYPE && cmd === WILL) {
      // Classic TN3270 — ask for terminal type
      socket.write(Buffer.from([IAC, SB, OPT_TTYPE, TN3E_SEND, IAC, SE]));
      return;
    }

    if (opt === OPT_BINARY) {
      if (cmd === WILL) socket.write(Buffer.from([IAC, DO, OPT_BINARY]));
    }

    if (opt === OPT_EOR) {
      if (cmd === WILL) socket.write(Buffer.from([IAC, DO, OPT_EOR]));
    }
  }

  function handleSubneg(data) {
    const opt = data[0];

    if (opt === OPT_TN3270E) {
      const func = data[1];
      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_IS) {
        // Client confirmed device type — send FUNCTIONS IS (empty = none required)
        const fnIs = Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_IS, IAC, SE]);
        socket.write(fnIs);
        debug(`[${id}] → TN3270E FUNCTIONS IS (none)`);

        // Negotiation complete — send first screen
        setImmediate(() => sendCurrentScreen());
      }

      if (func === TN3E_FUNCTIONS && data[2] === TN3E_IS) {
        // Functions confirmed — send first screen (classic TN3270 path)
        setImmediate(() => sendCurrentScreen());
      }
    }

    if (opt === OPT_TTYPE && data[1] === TN3E_IS) {
      const ttype = data.slice(2).toString('ascii');
      debug(`[${id}] ← TTYPE IS ${ttype}`);
      // Classic TN3270 negotiation done — send first screen
      setImmediate(() => sendCurrentScreen());
    }
  }

  // ── Handle incoming 3270 AID records ──────────────────────────────
  function handle3270Record(data) {
    // TN3270E mode: skip 5-byte header
    const payload = tn3270eMode ? data.slice(5) : data;
    if (payload.length === 0) return;

    const aid = payload[0];
    debug(`[${id}] ← AID 0x${aid.toString(16).toUpperCase()} on screen '${currentScreen}'`);

    // Extract any field data the client sent (simplified — read after cursor address)
    let inputText = '';
    if (payload.length > 3) {
      // Skip AID + 2-byte cursor addr; remaining is field data
      // Each field: SBA(2) + data — read first unprotected field content
      let j = 3;
      while (j < payload.length) {
        if (payload[j] === 0x11 && j + 2 < payload.length) {
          j += 3; // skip SBA + addr bytes
        } else {
          const b = payload[j];
          if (b >= 0x40) inputText += String.fromCharCode(EBCDIC_TO_ASCII[b] || 0x20);
          j++;
        }
      }
      inputText = inputText.trim();
    }

    debug(`[${id}] Input text: '${inputText}'`);

    switch (currentScreen) {
      case 'logon':
        if (aid === AID_ENTER) {
          userid = inputText || 'DEMO';
          if (userid.length > 8) userid = userid.slice(0, 8);
          log(`[${id}] Logon: userid='${userid}'`);
          currentScreen = 'ispf';
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          // PF3 on logon = disconnect
          socket.end();
        }
        break;

      case 'ispf':
        if (aid === AID_ENTER) {
          const opt = inputText.toUpperCase();
          if (opt === '2') {
            lastScreen = 'ispf';
            currentScreen = 'edit';
          } else if (opt === 'M' || opt === 'SDSF') {
            lastScreen = 'ispf';
            currentScreen = 'sdsf';
          } else if (opt === 'X') {
            socket.end();
            return;
          } else if (opt === '') {
            // No input — stay on ISPF
          } else {
            lastScreen = 'ispf';
            currentScreen = 'error';
            state.errorCmd = opt;
          }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end(); // PF3 on primary = logoff
        }
        break;

      case 'edit':
      case 'sdsf':
      case 'error':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = lastScreen || 'ispf';
          sendCurrentScreen();
        } else if (aid === AID_PF7) {
          // PF7 scroll up — resend same screen (simplified)
          sendCurrentScreen();
        } else if (aid === AID_PF8) {
          // PF8 scroll down — resend same screen (simplified)
          sendCurrentScreen();
        }
        break;
    }
  }

  function sendCurrentScreen() {
    let datastream;
    switch (currentScreen) {
      case 'logon': datastream = screenLogon();               break;
      case 'ispf':  datastream = screenISPF(userid);          break;
      case 'edit':  datastream = screenEdit();                break;
      case 'sdsf':  datastream = screenSDSF();                break;
      case 'error': datastream = screenError(state.errorCmd); break;
      default:      datastream = screenISPF(userid);
    }

    if (tn3270eMode) {
      // TN3270E header: data-type=0x00 (3270-DATA), request=0x00, response=0x00, seq=0x00 0x00
      const header = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      datastream = Buffer.concat([header, datastream]);
    }

    socket.write(wrapEOR(datastream));
    log(`[${id}] → Screen: ${currentScreen}`);
  }
}

// ── Logger ─────────────────────────────────────────────────────────
function log(msg)   { console.log(`${new Date().toISOString()} [INFO ] ${msg}`); }
function debug(msg) { if (LOG) console.log(`${new Date().toISOString()} [DEBUG] ${msg}`); }

// ── Start server ───────────────────────────────────────────────────
const server = net.createServer(handleConnection);

server.listen(PORT, '0.0.0.0', () => {
  log('─────────────────────────────────────────────────────');
  log(`  WebTerm/3270 Mock LPAR Daemon`);
  log(`  Listening on  tcp://0.0.0.0:${PORT}`);
  log(`  System ID     ${SYSNAME}`);
  log(`  LU Name       ${LU_NAME}`);
  log(`  Protocol      TN3270E + classic TN3270 fallback`);
  log(`  Screens       Logon → ISPF → Edit / SDSF`);
  log('─────────────────────────────────────────────────────');
  log(`  Connect the bridge: MOCK_HOST=127.0.0.1 MOCK_PORT=${PORT}`);
  log(`  Or add to .env:     PROD01_HOST=127.0.0.1 PROD01_PORT=${PORT}`);
  log('─────────────────────────────────────────────────────');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    log(`ERROR: Port ${PORT} is already in use. Set MOCK_PORT to a different port.`);
  } else {
    log(`ERROR: ${err.message}`);
  }
  process.exit(1);
});

process.on('SIGINT',  () => { log('Shutting down mock LPAR...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { log('Shutting down mock LPAR...'); server.close(() => process.exit(0)); });
