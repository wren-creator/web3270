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

const TN3E_DEVICE_TYPE = 0x02;
const TN3E_FUNCTIONS   = 0x03;
const TN3E_IS          = 0x04;
const TN3E_REQUEST     = 0x07;
const TN3E_SEND        = 0x08;

const CMD_ERASE_WRITE = 0xF5;
const CMD_WRITE       = 0xF1;
const ORDER_SF  = 0x1D;
const ORDER_SBA = 0x11;
const ORDER_IC  = 0x13;

const FA_PROTECTED       = 0x60;
const FA_PROTECTED_HIGH  = 0xE0;
const FA_UNPROTECTED     = 0x40;
const FA_UNPROTECTED_NUM = 0x50;

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
    if (f.text) for (const b of toEbcdic(f.text)) parts.push(b);
  }
  return Buffer.from(parts);
}

function screenLogon() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = now.toLocaleDateString('en-GB');
  return buildScreen(true, [
    { row:1,  col:20, fa: FA_PROTECTED_HIGH },
    { row:1,  col:21, text: `IBM z/OS  -  ${SYSNAME}  -  TSO/E LOGON` },
    { row:3,  col:2,  fa: FA_PROTECTED },
    { row:3,  col:2,  text: 'Enter LOGON parameters below:' },
    { row:3,  col:40, text: 'RACF LOGON parameters:' },
    { row:5,  col:2,  fa: FA_PROTECTED },
    { row:5,  col:2,  text: 'Userid  ===>' },
    { row:5,  col:14, fa: FA_UNPROTECTED },
    { row:5,  col:14, text: '        ' },
    { row:6,  col:2,  fa: FA_PROTECTED },
    { row:6,  col:2,  text: 'Password===>' },
    { row:6,  col:14, fa: FA_UNPROTECTED_NUM },
    { row:6,  col:14, text: '        ' },
    { row:7,  col:2,  fa: FA_PROTECTED },
    { row:7,  col:2,  text: 'Procedure==> TSOPROC' },
    { row:7,  col:40, fa: FA_PROTECTED },
    { row:7,  col:40, text: 'Acct Nmbr===> DEMO01' },
    { row:10, col:2,  fa: FA_PROTECTED },
    { row:10, col:2,  text: "Enter an 'S' before each option desired below:" },
    { row:11, col:18, text: '-Nomail         -Nonotice       -Reconnect' },
    { row:13, col:2,  fa: FA_PROTECTED },
    { row:13, col:2,  text: 'PF1/PF13 ==> Help   PF3/PF15 ==> Logoff   PA1 ==> Attention' },
    { row:15, col:2,  fa: FA_PROTECTED },
    { row:15, col:2,  text: `${SYSNAME} - Mock LPAR Daemon v1.0  ${dateStr}  ${timeStr}` },
  ]);
}

function screenISPF(userid = 'DEMO') {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
  return buildScreen(true, [
    { row:0,  col:24, fa: FA_PROTECTED_HIGH },
    { row:0,  col:25, text: 'ISPF Primary Option Menu' },
    { row:2,  col:2,  fa: FA_PROTECTED_HIGH },
    { row:2,  col:2,  text: 'Option ===>' },
    { row:2,  col:13, fa: FA_UNPROTECTED },
    { row:2,  col:13, text: '    ' },
    { row:4,  col:2,  fa: FA_PROTECTED },
    { row:4,  col:5,  text: '0' },
    { row:4,  col:8,  text: 'Settings       Terminal and user parameters' },
    { row:5,  col:5,  text: '1' },
    { row:5,  col:8,  text: 'View           Display source data or listings' },
    { row:6,  col:5,  text: '2' },
    { row:6,  col:8,  text: 'Edit           Create or change source data' },
    { row:7,  col:5,  text: '3' },
    { row:7,  col:8,  text: 'Utilities      Perform utility functions' },
    { row:8,  col:5,  text: '4' },
    { row:8,  col:8,  text: 'Foreground     Interactive language processing' },
    { row:9,  col:5,  text: '5' },
    { row:9,  col:8,  text: 'Batch          Submit job for language processing' },
    { row:10, col:5,  text: '6' },
    { row:10, col:8,  text: 'Command        Enter TSO or Workstation commands' },
    { row:11, col:5,  text: 'M' },
    { row:11, col:8,  text: 'SDSF           System Display and Search Facility' },
    { row:13, col:5,  text: 'X' },
    { row:13, col:8,  text: 'Exit           Terminate ISPF using log/list defaults' },
    { row:20, col:1,  fa: FA_PROTECTED },
    { row:20, col:1,  text: ` User ID . : ${userid.padEnd(8)}    Time. . .: ${timeStr}` },
    { row:21, col:1,  text: ` System ID : ${SYSNAME.padEnd(8)}    Terminal .: 3278` },
    { row:23, col:0,  fa: FA_PROTECTED },
    { row:23, col:0,  text: 'F1=Help   F2=Split  F3=Exit   F7=Backward  F8=Forward  F12=Cancel' },
  ]);
}

function screenEdit() {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: 'Edit - DEMO.JCL.CNTL(MYJOB) - 01.00          Columns 00001 00072' },
    { row:1,  col:1,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: 'Command ===>' },
    { row:1,  col:13, fa: FA_UNPROTECTED },
    { row:1,  col:13, text: '                                    ' },
    { row:1,  col:50, fa: FA_PROTECTED },
    { row:1,  col:50, text: 'Scroll ===> CSR' },
    { row:2,  col:0,  fa: FA_PROTECTED },
    { row:2,  col:0,  text: '000001 //MYJOB    JOB (DEMO),' },
    { row:3,  col:0,  text: "000002 //             'DEMO BATCH JOB'," },
    { row:4,  col:0,  text: '000003 //             CLASS=A,MSGCLASS=X,' },
    { row:5,  col:0,  text: '000004 //             NOTIFY=&SYSUID' },
    { row:6,  col:0,  text: '000005 //*' },
    { row:7,  col:0,  text: '000006 //COPY     EXEC PGM=IEBGENER' },
    { row:8,  col:0,  text: '000007 //SYSPRINT DD SYSOUT=*' },
    { row:9,  col:0,  text: '000008 //SYSUT1   DD DSN=PROD.INPUT.DATA,DISP=SHR' },
    { row:10, col:0,  text: '000009 //SYSUT2   DD DSN=WORK.OUTPUT.DATA,' },
    { row:11, col:0,  text: '000010 //             DISP=(NEW,CATLG,DELETE),' },
    { row:12, col:0,  text: '000011 //             SPACE=(CYL,(5,2),RLSE),' },
    { row:13, col:0,  text: '000012 //             DCB=(RECFM=FB,LRECL=80,BLKSIZE=27920)' },
    { row:14, col:0,  text: '000013 //SYSIN    DD DUMMY' },
    { row:23, col:0,  fa: FA_PROTECTED },
    { row:23, col:0,  text: 'F2=Split  F3=Exit  F5=Rfind  F6=Rchange  F7=Up  F8=Down  F14=Save' },
  ]);
}

function screenSDSF() {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: 'SDSF OUTPUT DISPLAY MYJOB   JOB07432  DSID   2 LINE 0    COLUMNS 02-81' },
    { row:1,  col:1,  fa: FA_PROTECTED },
    { row:1,  col:1,  text: 'COMMAND INPUT ===>' },
    { row:1,  col:18, fa: FA_UNPROTECTED },
    { row:1,  col:18, text: '                              ' },
    { row:1,  col:49, fa: FA_PROTECTED },
    { row:1,  col:49, text: 'SCROLL ===> PAGE' },
    { row:3,  col:0,  fa: FA_PROTECTED },
    { row:3,  col:9,  text: '1 //MYJOB    JOB (DEMO),CLASS=A,MSGCLASS=X' },
    { row:4,  col:9,  text: '2 //*' },
    { row:5,  col:9,  text: '3 //STEP1    EXEC PGM=IEFBR14' },
    { row:8,  col:1,  text: 'IEF142I MYJOB STEP1 - STEP WAS EXECUTED - COND CODE 0000' },
    { row:9,  col:1,  text: 'IEF285I   PROD.DATA.FILE                             KEPT' },
    { row:18, col:1,  fa: FA_PROTECTED_HIGH },
    { row:18, col:1,  text: '*** END OF DATA ***' },
    { row:23, col:0,  fa: FA_PROTECTED },
    { row:23, col:0,  text: 'F1=Help  F3=End  F5=RFind  F7=Up  F8=Down  F10=Left  F11=Right' },
  ]);
}

function screenError(cmd) {
  return buildScreen(true, [
    { row:0,  col:0,  fa: FA_PROTECTED_HIGH },
    { row:0,  col:1,  text: 'ISPF  ***  ERROR  ***' },
    { row:2,  col:2,  fa: FA_PROTECTED },
    { row:2,  col:2,  text: `Unknown option: '${(cmd || '').trim()}'` },
    { row:4,  col:2,  text: 'Valid primary options: 0 1 2 3 4 5 6 M X' },
    { row:5,  col:2,  text: 'Press PF3 to return to the Primary Option Menu.' },
    { row:7,  col:2,  fa: FA_PROTECTED_HIGH },
    { row:7,  col:2,  text: 'IKJ56500I COMMAND NOT FOUND' },
    { row:23, col:0,  fa: FA_PROTECTED },
    { row:23, col:0,  text: 'F3=Return  F12=Cancel' },
  ]);
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
  let currentScreen = 'logon';
  let lastScreen    = null;
  let userid        = 'DEMO';
  let negotiationComplete = false;

  // Track what we've agreed to
  let clientWillTN3270E  = false;
  let clientFunctionsDone = false;

  const state = { record: [], errorCmd: '' };

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
        state.record.push(0xFF);
        i += 2;
        continue;
      }

      i += 2;
    }
    recvBuf = recvBuf.slice(i);
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
        // Client confirmed device-type — now host must send FUNCTIONS REQUEST
        // (RFC 2355: host asks what functions client wants to use)
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST,
          IAC, SE,
        ]));
        debug(`[${id}] → TN3270E FUNCTIONS REQUEST (asking client)`);
        // Do NOT send screen yet — wait for client's FUNCTIONS IS
      }

      if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REQUEST) {
        // Client requesting device type — respond with IS
        socket.write(Buffer.from([
          IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS,
          ...Buffer.from('IBM-3278-2'),
          IAC, SE,
        ]));
        debug(`[${id}] → TN3270E DEVICE-TYPE IS IBM-3278-2`);
      }

      if (func === TN3E_FUNCTIONS && data[2] === TN3E_IS) {
        // Client told us what functions it supports — negotiation complete!
        const supported = data.slice(3);
        debug(`[${id}] ← TN3270E FUNCTIONS IS [${[...supported].map(b=>'0x'+b.toString(16)).join(' ')}]`);
        if (!negotiationComplete) {
          negotiationComplete = true;
          setImmediate(() => sendCurrentScreen());
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
          setImmediate(() => sendCurrentScreen());
        }
      }
    }

    if (opt === OPT_TTYPE && func === TN3E_IS) {
      const ttype = data.slice(2).toString('ascii');
      debug(`[${id}] ← TTYPE IS ${ttype}`);
      if (!negotiationComplete) {
        negotiationComplete = true;
        setImmediate(() => sendCurrentScreen());
      }
    }
  }

  function handle3270Record(data) {
    const payload = tn3270eMode ? data.slice(5) : data;
    if (payload.length === 0) return;

    const aid = payload[0];
    debug(`[${id}] ← AID 0x${aid.toString(16).toUpperCase()} screen='${currentScreen}'`);

    let inputText = '';
    if (payload.length > 3) {
      let j = 3;
      while (j < payload.length) {
        if (payload[j] === 0x11 && j + 2 < payload.length) {
          j += 3;
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
          userid = (inputText || 'DEMO').slice(0, 8);
          log(`[${id}] Logon: userid='${userid}'`);
          currentScreen = 'ispf';
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'ispf':
        if (aid === AID_ENTER) {
          const opt = inputText.toUpperCase();
          if      (opt === '2')              { lastScreen = 'ispf'; currentScreen = 'edit'; }
          else if (opt === 'M' || opt === 'SDSF') { lastScreen = 'ispf'; currentScreen = 'sdsf'; }
          else if (opt === 'X')              { socket.end(); return; }
          else if (opt !== '')               { lastScreen = 'ispf'; currentScreen = 'error'; state.errorCmd = opt; }
          sendCurrentScreen();
        } else if (aid === AID_PF3) {
          socket.end();
        }
        break;

      case 'edit':
      case 'sdsf':
      case 'error':
        if (aid === AID_PF3 || aid === AID_ENTER) {
          currentScreen = lastScreen || 'ispf';
          sendCurrentScreen();
        } else if (aid === AID_PF7 || aid === AID_PF8) {
          sendCurrentScreen();
        }
        break;
    }
  }

  function sendCurrentScreen() {
    let ds;
    switch (currentScreen) {
      case 'logon': ds = screenLogon();              break;
      case 'ispf':  ds = screenISPF(userid);         break;
      case 'edit':  ds = screenEdit();               break;
      case 'sdsf':  ds = screenSDSF();               break;
      case 'error': ds = screenError(state.errorCmd); break;
      default:      ds = screenISPF(userid);
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
