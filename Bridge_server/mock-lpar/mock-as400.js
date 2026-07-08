/**
 * mock-lpar/mock-as400.js
 * ─────────────────────────────────────────────────────────────────
 * Lightweight TN5250 server simulating an IBM i (AS/400) SIGNON screen,
 * a main menu with a few sub-menus, and a DSPMSG-style message queue,
 * for local development/testing of the bridge's TN5250 engine
 * (tn5250/session.js) without a real IBM i host.
 *
 * The menu tree lives in the MENUS table below — add an entry there to
 * add a new menu; options without a `goto`/`action` automatically land
 * on a generic "not implemented" stub screen rather than dead-ending.
 *
 * Byte-level protocol values (GDS record header, ESC commands, WTD
 * orders, field attribute bytes, AID codes) are the same ones verified
 * against the open-source tn5250 project (lib5250) when session.js was
 * built — see that file's header comment for references.
 */

'use strict';

const net = require('net');

const PORT    = parseInt(process.env.MOCK_AS400_PORT  || '3272', 10);
const LOG     = (process.env.LOG_LEVEL || 'info') === 'debug';
const SYSNAME = process.env.MOCK_AS400_SYSID || 'AS400MOCK';

const IAC  = 0xFF, DONT = 0xFE, DO = 0xFD, WONT = 0xFC, WILL = 0xFB;
const SB   = 0xFA, SE   = 0xF0, EOR = 0xEF, NOP = 0xF1;

const OPT_BINARY = 0x00;
const OPT_TIMING = 0x06;
const OPT_TTYPE  = 0x18;
const OPT_EOR    = 0x19;
const OPT_NEWENV = 0x27; // 39

const ENV_IS = 0x00, ENV_SEND = 0x01;

const ESC = 0x04;
const CMD_CLEAR_UNIT           = 0x40;
const CMD_CLEAR_UNIT_ALTERNATE = 0x20;
const CMD_WRITE_TO_DISPLAY     = 0x11;
const CMD_READ_INPUT_FIELDS    = 0x42;

const ORDER_SBA = 0x11;
const ORDER_IC  = 0x13;
const ORDER_SF  = 0x1D;

const ATTR_GREEN      = 0x20;
const ATTR_WHITE       = 0x22;
const ATTR_NONDISPLAY  = 0x27;
const ATTR_RED         = 0x28;

// Field Format Word bits — input field, MDT not set, alpha-shift.
const FFW_INPUT_ALPHA = 0x0000;
const FFW_INPUT_NONDISPLAY_ALPHA = 0x0000; // nondisplay comes from the attr byte, not FFW

const GDS_HI = 0x12, GDS_LO = 0xA0;
const FLOW_DISPLAY = 0x0000;
const OPCODE_PUT_GET = 3;

// ── EBCDIC (CP037) — same table as the other mocks/session.js ───────
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

// ── 5250 screen builders ─────────────────────────────────────────────
// fields: { row, col, text, input, nondisplay, length }
// (row/col are 0-based here; converted to 1-based at the SBA/SF layer.)
function buildScreen(cols, fields, insertCursor) {
  const parts = [];

  // CC1, CC2 — no special keyboard-lock semantics needed for a mock.
  parts.push(0x00, 0x00);

  for (const f of fields) {
    parts.push(ORDER_SBA, f.row + 1, f.col + 1);

    if (f.input) {
      const ffw = f.nondisplay ? FFW_INPUT_NONDISPLAY_ALPHA : FFW_INPUT_ALPHA;
      const attr = f.nondisplay ? ATTR_NONDISPLAY : ATTR_GREEN;
      const length = f.length || 20;
      parts.push(ORDER_SF, (ffw >> 8) & 0xFF, ffw & 0xFF, attr, (length >> 8) & 0xFF, length & 0xFF);
      if (f.text) parts.push(...toEbcdic(f.text.padEnd(length, ' ').slice(0, length)));
    } else {
      parts.push(ORDER_SF, f.attr || ATTR_WHITE);
      if (f.text) parts.push(...toEbcdic(f.text));
    }
  }

  // Insert Cursor order — places the display cursor at the first input
  // field so the operator can type immediately. IC = 0x13, row+1, col+1.
  if (insertCursor) {
    parts.push(ORDER_IC, insertCursor.row + 1, insertCursor.col + 1);
  }

  return Buffer.from(parts);
}

function wrapEsc(cmd, body) {
  return Buffer.concat([Buffer.from([ESC, cmd]), body]);
}

// Parse a client's field-data response into per-SBA text runs, so field
// values can be matched by (row, col) instead of blindly concatenating
// every character in the response (which merges User + Password into one
// blob and can't tell one input field from another).
function parseFieldRuns(fieldData) {
  const runs = [];
  let i = 0;
  let cur = null;
  while (i < fieldData.length) {
    if (fieldData[i] === ORDER_SBA) {
      if (cur) runs.push(cur);
      cur = { row: fieldData[i + 1] - 1, col: fieldData[i + 2] - 1, text: '' };
      i += 3;
      continue;
    }
    if (cur) {
      const ch = EBCDIC_TO_ASCII[fieldData[i]];
      cur.text += (ch >= 0x20 && ch < 0x7F) ? String.fromCharCode(ch) : ' ';
    }
    i++;
  }
  if (cur) runs.push(cur);
  return runs;
}

function fieldAt(runs, row) {
  const run = runs.find(r => r.row === row);
  return run ? run.text.trim() : '';
}

function screenSignon() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US');
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });

  const clearUnit = Buffer.from([ESC, CMD_CLEAR_UNIT]);
  const wtd = wrapEsc(CMD_WRITE_TO_DISPLAY, buildScreen(80, [
    { row: 1,  col: 30, text: 'Sign On', input: false },
    { row: 3,  col: 2,  text: `System  . . . . . :   ${SYSNAME}`, input: false },
    { row: 4,  col: 2,  text: `Subsystem . . . . :   QINTER`, input: false },
    { row: 5,  col: 2,  text: `Display . . . . . :   QPADEV0001`, input: false },
    { row: 7,  col: 2,  text: 'User  . . . . . . . . . . . . .', input: false },
    { row: 7,  col: 53, text: '', input: true, length: 10 },
    { row: 8,  col: 2,  text: 'Password  . . . . . . . . . . .', input: false },
    { row: 8,  col: 53, text: '', input: true, length: 10, nondisplay: true },
    { row: 9,  col: 2,  text: 'Program/procedure . . . . . . .', input: false },
    { row: 9,  col: 53, text: '', input: true, length: 10 },
    { row: 10, col: 2,  text: 'Menu  . . . . . . . . . . . . .', input: false },
    { row: 10, col: 53, text: '', input: true, length: 10 },
    { row: 11, col: 2,  text: 'Current library . . . . . . . .', input: false },
    { row: 11, col: 53, text: '', input: true, length: 10 },
    { row: 22, col: 2,  text: `${dateStr}  ${timeStr}`, input: false },
    { row: 23, col: 2,  text: '(C) COPYRIGHT MOCK AS/400 1988, 2026.', input: false },
  ], { row: 7, col: 53 }));
  const readCmd = Buffer.from([ESC, CMD_READ_INPUT_FIELDS]);

  return Buffer.concat([clearUnit, wtd, readCmd]);
}

// ── Menu tree ─────────────────────────────────────────────────────
// Data-driven so adding a menu or option is just adding data, not a new
// render function. Each option either:
//   goto:     <menu id>   — jump to another menu in this table
//   action:   'messages'  — jump to the Display Messages screen
//   (neither)              — jump to a generic "not implemented" stub
// '90' (sign off) is handled universally, not listed per menu, matching
// real AS/400 menus where it's always available.
const MENUS = {
  MAIN: {
    title: 'MAIN MENU',
    options: [
      { num: '1', label: 'User tasks',                    goto: 'USER' },
      { num: '2', label: 'Office tasks',                   goto: 'OFFICE' },
      { num: '3', label: 'General system tasks',           goto: 'SYSTEM' },
      { num: '4', label: 'Files, libraries, and folders' },
      { num: '9', label: 'Display messages',                action: 'messages' },
    ],
  },
  USER: {
    title: 'USER TASKS',
    parent: 'MAIN',
    options: [
      { num: '1', label: 'Send messages' },
      { num: '2', label: 'Display messages',                action: 'messages' },
      { num: '3', label: 'Work with spooled files' },
      { num: '4', label: 'Work with batch jobs' },
    ],
  },
  OFFICE: {
    title: 'OFFICE TASKS',
    parent: 'MAIN',
    options: [
      { num: '1', label: 'Work with calendar' },
      { num: '2', label: 'Send/receive documents' },
      { num: '3', label: 'Work with mail' },
    ],
  },
  SYSTEM: {
    title: 'GENERAL SYSTEM TASKS',
    parent: 'MAIN',
    options: [
      { num: '1', label: 'Work with active jobs',           run: 'WRKACTJOB' },
      { num: '2', label: 'Work with printers' },
      { num: '3', label: 'Display system status' },
      { num: '4', label: 'Work with subsystems',            run: 'WRKSBS' },
      { num: '5', label: 'Work with system values',         run: 'WRKSYSVAL' },
      { num: '6', label: 'Work with user profiles',         run: 'WRKUSRPRF' },
      { num: '7', label: 'Work with objects (public auth)', run: 'WRKOBJ' },
    ],
  },
};

// ── Seeded security posture (deliberately weak, for tooling) ────────
// This is the IBM i analog of the mock z/OS host's exposed RACF gaps:
// a realistic *insecure* baseline so security tools built against the
// mock have genuine findings to surface. `weak`/privileged flags drive
// the red highlighting on the panels below. Harden a value by editing
// its entry here — nothing else needs to change.

// System values a real security review would pull (DSPSYSVAL/WRKSYSVAL).
const SYSVALS = {
  QSECURITY:  { value: '30',      text: 'System security level',              weak: true,
                note: 'Level 30 enforces password + resource security but NOT object ownership integrity; level 40 or 50 is recommended.' },
  QMAXSIGN:   { value: '*NOMAX',  text: 'Maximum sign-on attempts allowed',   weak: true,
                note: 'Unlimited sign-on attempts let an attacker brute-force passwords with no lockout. Set a finite limit (e.g. 3).' },
  QMAXSGNACN: { value: '1',       text: 'Action when sign-on attempts reached', weak: true,
                note: 'Action 1 disables only the device, not the profile, so a guessed profile stays enabled. Use 3 (disable both).' },
  QPWDEXPITV: { value: '*NOMAX',  text: 'Password expiration interval',       weak: true,
                note: 'Passwords never expire — compromised credentials stay valid indefinitely.' },
  QPWDMINLEN: { value: '1',       text: 'Minimum password length',            weak: true,
                note: 'One-character passwords are permitted.' },
  QPWDRQDDIF: { value: '0',       text: 'Duplicate password control',         weak: true,
                note: '0 = users may reuse any previous password immediately.' },
  QPWDLVL:    { value: '0',       text: 'Password level',                     weak: true,
                note: 'Level 0 caps passwords at 10 chars and stores weak NetServer hashes.' },
  QINACTITV:  { value: '*NONE',   text: 'Inactive job time-out',              weak: true,
                note: 'Idle sessions are never disconnected — an unattended terminal stays signed on.' },
  QLMTSECOFR: { value: '0',       text: 'Limit security officer device access', weak: true,
                note: '0 = *ALLOBJ/*SERVICE users can sign on at ANY device, not just controlled ones.' },
  QALWOBJRST: { value: '*ALL',    text: 'Allow object restore option',        weak: true,
                note: '*ALL permits restoring security-sensitive and state programs — a supply-chain/restore attack vector.' },
  QCRTAUT:    { value: '*CHANGE', text: 'Default public authority for new objects', weak: true,
                note: 'New objects default to *PUBLIC *CHANGE — over-permissive out of the box.' },
  QRETSVRSEC: { value: '1',       text: 'Retain server security data',        weak: true,
                note: '1 = decryptable passwords are retained on the system for server functions.' },
  QAUDCTL:    { value: '*NONE',   text: 'Auditing control',                   weak: true,
                note: 'Security auditing is OFF — no audit journal of privileged actions.' },
  QDSPSGNINF: { value: '1',       text: 'Sign-on information display',        weak: false,
                note: 'Users are shown last sign-on info — a good setting.' },
};
const SYSVAL_KEYS = Object.keys(SYSVALS);

// User profiles (DSPUSRPRF/WRKUSRPRF) with special authorities.
const USRPRFS = [
  { name: 'QSECOFR',  text: 'Security officer',              status: '*ENABLED',  group: '*NONE',
    specialAuth: ['*ALLOBJ','*SECADM','*SAVSYS','*JOBCTL','*SERVICE','*SPLCTL','*AUDIT','*IOSYSCFG'],
    lmtcpb: '*NO',  pwdExpiry: '*NOMAX',  pwdDefault: true,  lastSignon: '07/06/26 08:14:22' },
  { name: 'QPGMR',    text: 'Programmer',                    status: '*ENABLED',  group: '*NONE',
    specialAuth: ['*JOBCTL','*SPLCTL','*SAVSYS'],
    lmtcpb: '*NO',  pwdExpiry: '*NOMAX',  pwdDefault: false, lastSignon: '07/05/26 17:02:10' },
  { name: 'APPADMIN', text: 'Application service account',   status: '*ENABLED',  group: '*NONE',
    specialAuth: ['*ALLOBJ','*JOBCTL'],
    lmtcpb: '*NO',  pwdExpiry: '*NOMAX',  pwdDefault: false, lastSignon: '07/07/26 02:00:05' },
  { name: 'JSMITH',   text: 'John Smith - Accounting',       status: '*ENABLED',  group: 'GRPACCT',
    specialAuth: [],
    lmtcpb: '*YES', pwdExpiry: '*SYSVAL', pwdDefault: false, lastSignon: '07/06/26 09:30:44' },
  { name: 'QSYSOPR',  text: 'System operator',               status: '*ENABLED',  group: '*NONE',
    specialAuth: ['*JOBCTL','*SAVSYS'],
    lmtcpb: '*NO',  pwdExpiry: '*SYSVAL', pwdDefault: false, lastSignon: '07/06/26 06:00:00' },
  { name: 'QUSER',    text: 'Default user profile',          status: '*ENABLED',  group: '*NONE',
    specialAuth: [],
    lmtcpb: '*NO',  pwdExpiry: '*SYSVAL', pwdDefault: false, lastSignon: '*NONE' },
  { name: 'QSRV',     text: 'Service representative',        status: '*DISABLED', group: '*NONE',
    specialAuth: ['*ALLOBJ','*SERVICE'],
    lmtcpb: '*NO',  pwdExpiry: '*NOMAX',  pwdDefault: true,  lastSignon: '*NONE' },
];

// Objects and their *PUBLIC / private authorities (DSPOBJAUT/WRKOBJ).
const OBJECTS = [
  { name: 'EMPMAST', lib: 'PAYROLL', type: '*FILE',   owner: 'APPADMIN', publicAuth: '*ALL',     authList: '*NONE',
    priv: [ { user: 'APPADMIN', auth: '*ALL' }, { user: '*PUBLIC', auth: '*ALL' }, { user: 'JSMITH', auth: '*CHANGE' } ] },
  { name: 'PAYROLL', lib: 'QSYS',    type: '*LIB',    owner: 'APPADMIN', publicAuth: '*CHANGE',  authList: '*NONE',
    priv: [ { user: 'APPADMIN', auth: '*ALL' }, { user: '*PUBLIC', auth: '*CHANGE' } ] },
  { name: 'QGPL',    lib: 'QSYS',    type: '*LIB',    owner: 'QSYS',     publicAuth: '*CHANGE',  authList: '*NONE',
    priv: [ { user: '*PUBLIC', auth: '*CHANGE' } ] },
  { name: 'USRPRF',  lib: 'QSYS',    type: '*USRPRF', owner: 'QSECOFR',  publicAuth: '*EXCLUDE', authList: '*NONE',
    priv: [ { user: '*PUBLIC', auth: '*EXCLUDE' } ] },
  { name: 'CONFIG',  lib: 'APPLIB',  type: '*FILE',   owner: 'APPADMIN', publicAuth: '*USE',     authList: 'SECAUTL',
    priv: [ { user: '*PUBLIC', auth: '*USE' }, { user: 'GRPACCT', auth: '*CHANGE' } ] },
  { name: 'QCMD',    lib: 'QSYS',    type: '*CMD',    owner: 'QSYS',     publicAuth: '*USE',     authList: '*NONE',
    priv: [ { user: '*PUBLIC', auth: '*USE' } ] },
];

// ── Wave 2 surfaces ────────────────────────────────────────────────
// Network attributes (DSPNETA). Weak inbound-request settings are remote
// job / command execution vectors.
const NETA = {
  SYSNAME:   { value: SYSNAME,   text: 'Current system name',            weak: false },
  LCLLOCNAME:{ value: 'MOCKLOC', text: 'Local location name',            weak: false },
  JOBACN:    { value: '*FILE',   text: 'Job action (inbound requests)',  weak: true,
               note: '*FILE runs submitted job streams automatically — remote job/command execution. Use *REJECT or *SEARCH.' },
  DDMACC:    { value: '*ALL',    text: 'DDM/DRDA request access',        weak: true,
               note: '*ALL lets any remote system run DDM/DRDA (remote SQL and commands). Restrict with a DDM exit program.' },
  PCSACC:    { value: '*REGFAC', text: 'Client request access',          weak: true,
               note: '*REGFAC allows Client Access host-server functions broadly; gate them with registered exit programs.' },
  ALWANYNET: { value: '*ANYNET', text: 'Allow AnyNet support',           weak: true,
               note: '*ANYNET permits APPC-over-TCP tunnelling — widens the remote attack surface. Use *NONE unless required.' },
  ALRSTS:    { value: '*ON',     text: 'Alert status',                   weak: false },
};

// Job descriptions (WRKJOBD/DSPJOBD). A JOBD that names a real USER() and is
// usable by *PUBLIC lets any user SBMJOB and run code as that user — the
// classic IBM i privilege-escalation path when the user is privileged.
const JOBDS = [
  { name: 'QDFTJOBD', lib: 'QGPL',   user: '*RQD',     publicAuth: '*USE',     jobq: 'QBATCH', rtgdta: 'QCMDI', text: 'Default job description' },
  { name: 'QBATCH',   lib: 'QGPL',   user: '*RQD',     publicAuth: '*USE',     jobq: 'QBATCH', rtgdta: 'QCMDB', text: 'Batch job description' },
  { name: 'APPJOBD',  lib: 'APPLIB', user: 'QSECOFR',  publicAuth: '*USE',     jobq: 'QBATCH', rtgdta: 'QCMDB', text: 'Application batch submit' },
  { name: 'WEBJOBD',  lib: 'APPLIB', user: 'APPADMIN', publicAuth: '*CHANGE',  jobq: 'QBATCH', rtgdta: 'QCMDB', text: 'Web backend jobs' },
  { name: 'OPSJOBD',  lib: 'QGPL',   user: 'QSYSOPR',  publicAuth: '*EXCLUDE', jobq: 'QBATCH', rtgdta: 'QCMDB', text: 'Operations jobs' },
];

// Authorization lists (WRKAUTL/DSPAUTL). Over-permissive *PUBLIC on an authl
// cascades to every object it secures.
const AUTLS = [
  { name: 'SECAUTL',  owner: 'QSECOFR',  publicAuth: '*EXCLUDE', text: 'Security config objects',
    users: [ { user: '*PUBLIC', auth: '*EXCLUDE' }, { user: 'APPADMIN', auth: '*USE' } ],
    secured: [ 'APPLIB/CONFIG' ] },
  { name: 'PAYAUTL',  owner: 'APPADMIN', publicAuth: '*CHANGE',  text: 'Payroll objects',
    users: [ { user: '*PUBLIC', auth: '*CHANGE' }, { user: 'JSMITH', auth: '*ALL' } ],
    secured: [ 'PAYROLL/EMPMAST', 'QSYS/PAYROLL' ] },
  { name: 'QSYSAUTL', owner: 'QSYS',     publicAuth: '*USE',     text: 'System shared objects',
    users: [ { user: '*PUBLIC', auth: '*USE' } ],
    secured: [ 'QSYS/QGPL' ] },
];

// Active jobs (WRKACTJOB). Jobs running under a privileged profile are the
// interesting finding — an *ALLOBJ batch job or a broadly-reachable host server.
const ACTJOBS = [
  { sbs: 'QINTER',  job: 'DSP01',      user: 'JSMITH',   type: 'INT', func: 'CMD-WRKACTJOB', status: 'RUN' },
  { sbs: 'QBATCH',  job: 'NIGHTLYRUN', user: 'APPADMIN', type: 'BCH', func: 'PGM-PAYRPT',    status: 'ACTIVE' },
  { sbs: 'QSYSWRK', job: 'QZDASOINIT', user: 'QUSER',    type: 'PJ',  func: 'PGM-QZDASO',    status: 'ACTIVE' },
  { sbs: 'QCMN',    job: 'QRWTSRVR',   user: 'QUSER',    type: 'PJ',  func: '*',             status: 'ACTIVE' },
  { sbs: 'QSYSWRK', job: 'MAINTJOB',   user: 'QSECOFR',  type: 'BCH', func: 'PGM-MAINT',     status: 'ACTIVE' },
];

// Subsystems (WRKSBS) — mostly informational context for the active-job view.
const SBS = [
  { name: 'QINTER',  status: 'ACTIVE', maxJobs: '*NOMAX', text: 'Interactive subsystem' },
  { name: 'QBATCH',  status: 'ACTIVE', maxJobs: '*NOMAX', text: 'Batch subsystem' },
  { name: 'QSYSWRK', status: 'ACTIVE', maxJobs: '*NOMAX', text: 'System work subsystem' },
  { name: 'QCMN',    status: 'ACTIVE', maxJobs: '*NOMAX', text: 'Communications subsystem' },
  { name: 'QTCP',    status: 'ACTIVE', maxJobs: '*NOMAX', text: 'TCP/IP subsystem' },
];

// Which user names denote a privileged profile (for red-highlighting jobs /
// JOBDs that run as them). Derived from USRPRFS so it stays in sync.
const PRIV_USERS = new Set(USRPRFS.filter(p =>
  p.specialAuth.includes('*ALLOBJ') || p.specialAuth.includes('*SECADM')).map(p => p.name));

// ── CL command interpreter ─────────────────────────────────────────
// Parses a command typed on any "Selection or command" / panel command
// line into a navigation result the connection state machine applies.
// Recognizes the security-relevant DSP*/WRK* verbs the mock models;
// anything else yields a realistic CPF/CPD "not found" message.
function parseParams(str) {
  const params = {};
  const re = /(\w+)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str)) !== null) params[m[1].toUpperCase()] = m[2].trim().toUpperCase();
  return params;
}

function runCommand(raw) {
  const cmd = raw.trim().toUpperCase();
  if (!cmd) return { type: 'none' };
  const verb = cmd.split(/[\s(]/)[0];
  const params = parseParams(cmd);

  switch (verb) {
    case 'WRKSYSVAL': return { type: 'screen', screen: 'SYSVAL_LIST' };
    case 'DSPSYSVAL': {
      const name = params.SYSVAL;
      if (!name)            return { type: 'error', message: 'CPD0043 - Keyword SYSVAL required for DSPSYSVAL.' };
      if (!SYSVALS[name])   return { type: 'error', message: `CPF1053 - System value ${name} not found.` };
      return { type: 'detail', screen: 'SYSVAL_DETAIL', target: name };
    }
    case 'WRKUSRPRF': return { type: 'screen', screen: 'USRPRF_LIST' };
    case 'DSPUSRPRF': {
      const name = params.USRPRF;
      if (!name)                                  return { type: 'error', message: 'CPD0043 - Keyword USRPRF required for DSPUSRPRF.' };
      if (!USRPRFS.find(p => p.name === name))    return { type: 'error', message: `CPF2204 - User profile ${name} not found.` };
      return { type: 'detail', screen: 'USRPRF_DETAIL', target: name };
    }
    case 'WRKOBJ': return { type: 'screen', screen: 'OBJ_LIST' };
    case 'DSPOBJAUT': {
      const obj = params.OBJ; // LIB/NAME or NAME
      if (!obj) return { type: 'error', message: 'CPD0043 - Keyword OBJ required for DSPOBJAUT.' };
      const [lib, name] = obj.includes('/') ? obj.split('/') : ['*LIBL', obj];
      const idx = OBJECTS.findIndex(o => o.name === name && (lib === '*LIBL' || o.lib === lib));
      if (idx === -1) return { type: 'error', message: `CPF9801 - Object ${obj} not found.` };
      return { type: 'detail', screen: 'OBJ_DETAIL', target: idx };
    }
    case 'DSPNETA': return { type: 'detail', screen: 'NETA', target: null };
    case 'WRKJOBD': return { type: 'screen', screen: 'JOBD_LIST' };
    case 'DSPJOBD': {
      const jobd = params.JOBD;
      if (!jobd) return { type: 'error', message: 'CPD0043 - Keyword JOBD required for DSPJOBD.' };
      const nm = jobd.includes('/') ? jobd.split('/')[1] : jobd;
      if (!JOBDS.find(j => j.name === nm)) return { type: 'error', message: `CPF9801 - Object ${jobd} not found.` };
      return { type: 'detail', screen: 'JOBD_DETAIL', target: nm };
    }
    case 'WRKAUTL': return { type: 'screen', screen: 'AUTL_LIST' };
    case 'DSPAUTL': {
      const name = params.AUTL;
      if (!name) return { type: 'error', message: 'CPD0043 - Keyword AUTL required for DSPAUTL.' };
      if (!AUTLS.find(a => a.name === name)) return { type: 'error', message: `CPF2289 - Authorization list ${name} not found.` };
      return { type: 'detail', screen: 'AUTL_DETAIL', target: name };
    }
    case 'WRKACTJOB': return { type: 'screen', screen: 'ACTJOB_LIST' };
    case 'WRKSBS':     return { type: 'screen', screen: 'SBS_LIST' };
    case 'DSPMSG':  return { type: 'messages' };
    case 'SIGNOFF': return { type: 'signoff' };
    default:
      return { type: 'error', message: `CPD0030 - Command ${verb} not found in library *LIBL.` };
  }
}

// On a "Work with" panel, find the first list row whose Opt input is
// non-blank and map it back to an index into that panel's data array.
function pickOption(runs, startRow, count) {
  for (const r of runs) {
    if (r.row >= startRow && r.row < startRow + count && r.text.trim()) {
      return { index: r.row - startRow, opt: r.text.trim() };
    }
  }
  return null;
}

// Shared panel geometry: list rows begin at LIST_START_ROW (one per
// line), the panel command line sits at LIST_CMD_ROW.
const LIST_START_ROW = 6;
const LIST_CMD_ROW   = 21;

// Which "Work with" list panels exist, how many rows each has, and (if the
// panel supports 5=Display) how a picked row maps to a detail screen + target.
// list-only panels set detail:null. The connection state machine drives all of
// this generically, so a new panel is just an entry here + a screen builder.
const LIST_META = {
  SYSVAL_LIST: { count: () => SYSVAL_KEYS.length, detail: i => ['SYSVAL_DETAIL', SYSVAL_KEYS[i]] },
  USRPRF_LIST: { count: () => USRPRFS.length,     detail: i => ['USRPRF_DETAIL', USRPRFS[i].name] },
  OBJ_LIST:    { count: () => OBJECTS.length,      detail: i => ['OBJ_DETAIL', i] },
  JOBD_LIST:   { count: () => JOBDS.length,        detail: i => ['JOBD_DETAIL', JOBDS[i].name] },
  AUTL_LIST:   { count: () => AUTLS.length,        detail: i => ['AUTL_DETAIL', AUTLS[i].name] },
  ACTJOB_LIST: { count: () => ACTJOBS.length,      detail: null },
  SBS_LIST:    { count: () => SBS.length,           detail: null },
};
// Detail/display screens where Enter/F3/F12 all navigate back one level.
const DETAIL_SCREENS = new Set([
  'SYSVAL_DETAIL', 'USRPRF_DETAIL', 'OBJ_DETAIL', 'NETA', 'JOBD_DETAIL', 'AUTL_DETAIL',
]);

const AID_F3  = 0x33;
const AID_F12 = 0x3C;

function screenMenu(menuId, ctx) {
  const menu = MENUS[menuId];
  const fields = [
    { row: 0, col: Math.max(0, 40 - Math.floor(menu.title.length / 2)), text: menu.title, input: false },
    { row: 0, col: 65, text: 'MOCKMENU', input: false },
    { row: 2, col: 2, text: `System:   ${SYSNAME}`, input: false },
    { row: 4, col: 2, text: 'Select one of the following:', input: false },
  ];
  menu.options.forEach((opt, idx) => {
    fields.push({ row: 6 + idx, col: 5, text: `${opt.num}. ${opt.label}`, input: false });
  });
  fields.push({ row: 6 + menu.options.length, col: 5, text: '90. Sign off', input: false });

  if (menu.parent) {
    fields.push({ row: 16, col: 2, text: 'F3=Exit   F12=Cancel', input: false });
  }
  fields.push({ row: 18, col: 2, text: `Signed on as: ${ctx.user || 'UNKNOWN'}`, input: false });
  if (ctx.unreadCount > 0) {
    fields.push({
      row: 19, col: 2,
      text: `*** You have ${ctx.unreadCount} new message${ctx.unreadCount === 1 ? '' : 's'} — option 9 to view ***`,
      input: false, attr: ATTR_RED,
    });
  }
  if (ctx.message) {
    fields.push({ row: 20, col: 2, text: ctx.message, input: false, attr: ATTR_RED });
  }
  fields.push({ row: 22, col: 2, text: 'Selection or command', input: false });
  fields.push({ row: 22, col: 25, text: '', input: true, length: 40 });

  const clearUnit = Buffer.from([ESC, CMD_CLEAR_UNIT]);
  const wtd = wrapEsc(CMD_WRITE_TO_DISPLAY, buildScreen(80, fields, { row: 22, col: 25 }));
  const readCmd = Buffer.from([ESC, CMD_READ_INPUT_FIELDS]);
  return Buffer.concat([clearUnit, wtd, readCmd]);
}

function screenMessages(ctx) {
  const fields = [
    { row: 0, col: 30, text: 'Display Messages', input: false },
    { row: 1, col: 2,  text: `Queue: ${(ctx.user || 'QSYSOPR')}`, input: false },
    { row: 1, col: 40, text: `System: ${SYSNAME}`, input: false },
  ];
  ctx.messages.forEach((m, idx) => {
    const row = 3 + idx;
    if (row > 19) return; // don't overflow the screen — a real DSPMSG pages
    fields.push({
      row, col: 2,
      text: `${m.date} ${m.time}  ${m.from.padEnd(10, ' ')} ${m.text}`.slice(0, 78),
      input: false,
    });
  });
  if (ctx.messages.length === 0) {
    fields.push({ row: 3, col: 2, text: '(No messages)', input: false });
  }
  fields.push({ row: 22, col: 2, text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2, text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });

  const clearUnit = Buffer.from([ESC, CMD_CLEAR_UNIT]);
  const wtd = wrapEsc(CMD_WRITE_TO_DISPLAY, buildScreen(80, fields, { row: 22, col: 44 }));
  const readCmd = Buffer.from([ESC, CMD_READ_INPUT_FIELDS]);
  return Buffer.concat([clearUnit, wtd, readCmd]);
}

function screenStub(label, ctx) {
  const fields = [
    { row: 0, col: Math.max(0, 40 - Math.floor(label.length / 2)), text: label, input: false },
    { row: 2, col: 2, text: `User:     ${ctx.user || 'UNKNOWN'}`, input: false },
    { row: 4, col: 2, text: 'This function is not implemented in the mock — extend', input: false },
    { row: 5, col: 2, text: 'mock-as400.js (MENUS table) to add real content here.', input: false },
    { row: 22, col: 2, text: 'Press Enter to return', input: false },
    { row: 23, col: 2, text: 'F3=Exit   F12=Cancel', input: false },
    { row: 22, col: 44, text: '', input: true, length: 1 },
  ];
  const clearUnit = Buffer.from([ESC, CMD_CLEAR_UNIT]);
  const wtd = wrapEsc(CMD_WRITE_TO_DISPLAY, buildScreen(80, fields, { row: 22, col: 44 }));
  const readCmd = Buffer.from([ESC, CMD_READ_INPUT_FIELDS]);
  return Buffer.concat([clearUnit, wtd, readCmd]);
}

// ── Security panels (WRKSYSVAL/WRKUSRPRF/WRKOBJ + their DSP details) ──
// Red = a weak/privileged value a security tool should flag; green = OK.
function authAttr(weak) { return weak ? ATTR_RED : ATTR_GREEN; }

function wrapPanel(fields, cursor) {
  const clearUnit = Buffer.from([ESC, CMD_CLEAR_UNIT]);
  const wtd = wrapEsc(CMD_WRITE_TO_DISPLAY, buildScreen(80, fields, cursor));
  const readCmd = Buffer.from([ESC, CMD_READ_INPUT_FIELDS]);
  return Buffer.concat([clearUnit, wtd, readCmd]);
}

// Command line + F-key footer shared by every "Work with" list panel.
function listTrailer(fields, message) {
  if (message) fields.push({ row: 20, col: 2, text: message, input: false, attr: ATTR_RED });
  fields.push({ row: LIST_CMD_ROW, col: 2,  text: 'Command', input: false });
  fields.push({ row: LIST_CMD_ROW, col: 10, text: '===>',    input: false });
  fields.push({ row: LIST_CMD_ROW, col: 15, text: '', input: true, length: 50 });
  fields.push({ row: 23, col: 2, text: 'F3=Exit   F12=Cancel', input: false });
}

function screenSysvalList(ctx) {
  const fields = [
    { row: 0, col: 26, text: 'Work with System Values', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 3, col: 4,  text: '5=Display', input: false },
    { row: 5, col: 2,  text: 'Opt  System Value    Current value', input: false },
  ];
  SYSVAL_KEYS.forEach((name, idx) => {
    const sv = SYSVALS[name];
    const row = LIST_START_ROW + idx;
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: name.padEnd(13, ' '), input: false });
    fields.push({ row, col: 20, text: sv.value, input: false, attr: authAttr(sv.weak) });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenSysvalDetail(name) {
  const sv = SYSVALS[name] || { value: '', text: '', weak: false, note: '' };
  const fields = [
    { row: 0, col: 28, text: 'Display System Value', input: false },
    { row: 2, col: 2,  text: `System value . . . . . . . :   ${name}`, input: false },
    { row: 3, col: 2,  text: `Description  . . . . . . . :   ${sv.text}`, input: false },
    { row: 6, col: 2,  text: 'Current value  . . . . . . :', input: false },
    { row: 6, col: 33, text: sv.value, input: false, attr: authAttr(sv.weak) },
  ];
  if (sv.note) {
    const words = sv.note.split(' ');
    let line = '', r = 9;
    for (const w of words) {
      if ((line + ' ' + w).trim().length > 72) { fields.push({ row: r++, col: 4, text: line.trim(), input: false }); line = ''; }
      line += ' ' + w;
    }
    if (line.trim()) fields.push({ row: r, col: 4, text: line.trim(), input: false });
  }
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

function screenUsrprfList(ctx) {
  const fields = [
    { row: 0, col: 28, text: 'Work with User Profiles', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 3, col: 4,  text: '5=Display', input: false },
    { row: 5, col: 2,  text: 'Opt  Profile     Text                      Special authority', input: false },
  ];
  USRPRFS.forEach((p, idx) => {
    const row = LIST_START_ROW + idx;
    const priv = p.specialAuth.includes('*ALLOBJ') || p.specialAuth.includes('*SECADM');
    let sa = p.specialAuth.length ? p.specialAuth.join(' ') : '*NONE';
    if (sa.length > 30) sa = sa.slice(0, 27) + '...';
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: p.name.padEnd(11, ' '), input: false });
    fields.push({ row, col: 17, text: p.text.slice(0, 24).padEnd(24, ' '), input: false });
    fields.push({ row, col: 42, text: sa, input: false, attr: authAttr(priv) });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenUsrprfDetail(name) {
  const p = USRPRFS.find(u => u.name === name);
  if (!p) return screenStub(`USER ${name} NOT FOUND`, { user: name });
  const fields = [
    { row: 0,  col: 26, text: 'Display User Profile - Basic', input: false },
    { row: 2,  col: 2,  text: `User profile . . . . . . . . . :   ${p.name}`, input: false },
    { row: 3,  col: 2,  text: `Text . . . . . . . . . . . . . :   ${p.text}`, input: false },
    { row: 4,  col: 2,  text: `Status . . . . . . . . . . . . :   ${p.status}`, input: false, attr: p.status === '*DISABLED' ? ATTR_RED : ATTR_WHITE },
    { row: 5,  col: 2,  text: `Group profile  . . . . . . . . :   ${p.group}`, input: false },
    { row: 6,  col: 2,  text: `Limit capabilities . . . . . . :   ${p.lmtcpb}`, input: false, attr: p.lmtcpb === '*NO' ? ATTR_RED : ATTR_WHITE },
    { row: 7,  col: 2,  text: `Password expiration interval . :   ${p.pwdExpiry}`, input: false, attr: p.pwdExpiry === '*NOMAX' ? ATTR_RED : ATTR_WHITE },
    { row: 8,  col: 2,  text: `Last sign-on . . . . . . . . . :   ${p.lastSignon}`, input: false },
    { row: 10, col: 2,  text: 'Special authority  . . . . . . :', input: false },
  ];
  const sa = p.specialAuth.length ? p.specialAuth : ['*NONE'];
  sa.forEach((a, i) => {
    const priv = a === '*ALLOBJ' || a === '*SECADM' || a === '*SERVICE';
    fields.push({ row: 11 + i, col: 36, text: a, input: false, attr: priv ? ATTR_RED : ATTR_GREEN });
  });
  if (p.pwdDefault) {
    fields.push({ row: 20, col: 2, text: '*** WARNING: password matches profile name (default) ***', input: false, attr: ATTR_RED });
  }
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

function screenObjList(ctx) {
  const fields = [
    { row: 0, col: 30, text: 'Work with Objects', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 3, col: 4,  text: '5=Display authority', input: false },
    { row: 5, col: 2,  text: 'Opt  Object     Library    Type       Owner      *PUBLIC', input: false },
  ];
  OBJECTS.forEach((o, idx) => {
    const row = LIST_START_ROW + idx;
    const weak = o.publicAuth === '*ALL' || o.publicAuth === '*CHANGE';
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: o.name.padEnd(10, ' '), input: false });
    fields.push({ row, col: 17, text: o.lib.padEnd(10, ' '), input: false });
    fields.push({ row, col: 28, text: o.type.padEnd(10, ' '), input: false });
    fields.push({ row, col: 39, text: o.owner.padEnd(10, ' '), input: false });
    fields.push({ row, col: 50, text: o.publicAuth, input: false, attr: authAttr(weak) });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenObjDetail(idx) {
  const o = OBJECTS[idx];
  if (!o) return screenStub('OBJECT NOT FOUND', { user: '' });
  const weak = o.publicAuth === '*ALL' || o.publicAuth === '*CHANGE';
  const fields = [
    { row: 0, col: 28, text: 'Display Object Authority', input: false },
    { row: 2, col: 2,  text: `Object . . . . . . :   ${o.lib}/${o.name}`, input: false },
    { row: 2, col: 48, text: `Type . :   ${o.type}`, input: false },
    { row: 3, col: 2,  text: `Owner  . . . . . . :   ${o.owner}`, input: false },
    { row: 4, col: 2,  text: `Authorization list :   ${o.authList}`, input: false },
    { row: 5, col: 2,  text: '*PUBLIC authority  :', input: false },
    { row: 5, col: 24, text: o.publicAuth, input: false, attr: authAttr(weak) },
    { row: 7, col: 2,  text: 'User          Authority', input: false },
  ];
  o.priv.forEach((a, i) => {
    const w = a.user === '*PUBLIC' && (a.auth === '*ALL' || a.auth === '*CHANGE');
    fields.push({ row: 8 + i, col: 2,  text: a.user.padEnd(12, ' '), input: false });
    fields.push({ row: 8 + i, col: 16, text: a.auth, input: false, attr: w ? ATTR_RED : ATTR_GREEN });
  });
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

// ── Wave 2 panels ────────────────────────────────────────────────────
function screenNetaDetail() {
  const fields = [
    { row: 0, col: 27, text: 'Display Network Attributes', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
  ];
  let r = 2;
  for (const [name, a] of Object.entries(NETA)) {
    fields.push({ row: r, col: 2,  text: `${name.padEnd(11, ' ')}. . . . . . . :`, input: false });
    fields.push({ row: r, col: 33, text: a.value, input: false, attr: authAttr(a.weak) });
    r++;
  }
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

function screenJobdList(ctx) {
  const fields = [
    { row: 0, col: 27, text: 'Work with Job Descriptions', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 3, col: 4,  text: '5=Display', input: false },
    { row: 5, col: 2,  text: 'Opt  Job Desc    Library    User         *PUBLIC', input: false },
  ];
  JOBDS.forEach((j, idx) => {
    const row = LIST_START_ROW + idx;
    const runsAs = j.user !== '*RQD';
    const weak = runsAs && ['*USE', '*CHANGE', '*ALL'].includes(j.publicAuth);
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: j.name.padEnd(10, ' '), input: false });
    fields.push({ row, col: 17, text: j.lib.padEnd(10, ' '), input: false });
    fields.push({ row, col: 28, text: j.user.padEnd(11, ' '), input: false, attr: authAttr(runsAs) });
    fields.push({ row, col: 40, text: j.publicAuth, input: false, attr: authAttr(weak) });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenJobdDetail(name) {
  const j = JOBDS.find(x => x.name === name);
  if (!j) return screenStub('JOB DESCRIPTION NOT FOUND', { user: '' });
  const runsAs = j.user !== '*RQD';
  const usable = ['*USE', '*CHANGE', '*ALL'].includes(j.publicAuth);
  const fields = [
    { row: 0,  col: 28, text: 'Display Job Description', input: false },
    { row: 2,  col: 2,  text: `Job description  . . . . . :   ${j.name}`, input: false },
    { row: 3,  col: 2,  text: `Library  . . . . . . . . . :   ${j.lib}`, input: false },
    { row: 4,  col: 2,  text: `Text . . . . . . . . . . . :   ${j.text}`, input: false },
    { row: 6,  col: 2,  text: 'User . . . . . . . . . . . :', input: false },
    { row: 6,  col: 33, text: j.user, input: false, attr: authAttr(runsAs) },
    { row: 7,  col: 2,  text: `Job queue  . . . . . . . . :   ${j.jobq}`, input: false },
    { row: 8,  col: 2,  text: `Routing data . . . . . . . :   ${j.rtgdta}`, input: false },
    { row: 10, col: 2,  text: '*PUBLIC authority  :', input: false },
    { row: 10, col: 24, text: j.publicAuth, input: false, attr: authAttr(runsAs && usable) },
  ];
  if (runsAs && usable) {
    fields.push({ row: 12, col: 2, text: `*** WARNING: *PUBLIC can SBMJOB this JOBD to run as ${j.user} ***`, input: false, attr: ATTR_RED });
  }
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

function screenAutlList(ctx) {
  const fields = [
    { row: 0, col: 28, text: 'Work with Authorization Lists', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 3, col: 4,  text: '5=Display', input: false },
    { row: 5, col: 2,  text: 'Opt  Auth List   Owner      *PUBLIC    Text', input: false },
  ];
  AUTLS.forEach((a, idx) => {
    const row = LIST_START_ROW + idx;
    const weak = a.publicAuth === '*ALL' || a.publicAuth === '*CHANGE';
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: a.name.padEnd(11, ' '), input: false });
    fields.push({ row, col: 17, text: a.owner.padEnd(10, ' '), input: false });
    fields.push({ row, col: 28, text: a.publicAuth.padEnd(10, ' '), input: false, attr: authAttr(weak) });
    fields.push({ row, col: 39, text: a.text.slice(0, 30), input: false });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenAutlDetail(name) {
  const a = AUTLS.find(x => x.name === name);
  if (!a) return screenStub('AUTHORIZATION LIST NOT FOUND', { user: '' });
  const weak = a.publicAuth === '*ALL' || a.publicAuth === '*CHANGE';
  const fields = [
    { row: 0, col: 28, text: 'Display Authorization List', input: false },
    { row: 2, col: 2,  text: `Authorization list :   ${a.name}`, input: false },
    { row: 3, col: 2,  text: `Owner  . . . . . . :   ${a.owner}`, input: false },
    { row: 4, col: 2,  text: '*PUBLIC authority  :', input: false },
    { row: 4, col: 24, text: a.publicAuth, input: false, attr: authAttr(weak) },
    { row: 6, col: 2,  text: 'User          Authority', input: false },
  ];
  a.users.forEach((u, i) => {
    const w = u.user === '*PUBLIC' && (u.auth === '*ALL' || u.auth === '*CHANGE');
    fields.push({ row: 7 + i, col: 2,  text: u.user.padEnd(12, ' '), input: false });
    fields.push({ row: 7 + i, col: 16, text: u.auth, input: false, attr: w ? ATTR_RED : ATTR_GREEN });
  });
  let sr = 7 + a.users.length + 1;
  fields.push({ row: sr++, col: 2, text: 'Secured objects:', input: false });
  a.secured.forEach(obj => fields.push({ row: sr++, col: 4, text: obj, input: false, attr: weak ? ATTR_RED : ATTR_WHITE }));
  if (weak) fields.push({ row: sr + 1, col: 2, text: `*** *PUBLIC ${a.publicAuth} cascades to all secured objects ***`, input: false, attr: ATTR_RED });
  fields.push({ row: 22, col: 2,  text: 'Press Enter to continue', input: false });
  fields.push({ row: 23, col: 2,  text: 'F3=Exit   F12=Cancel', input: false });
  fields.push({ row: 22, col: 44, text: '', input: true, length: 1 });
  return wrapPanel(fields, { row: 22, col: 44 });
}

function screenActjobList(ctx) {
  const fields = [
    { row: 0, col: 30, text: 'Work with Active Jobs', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 5, col: 2,  text: 'Opt  Job         Subsystem   User         Type  Function      Status', input: false },
  ];
  ACTJOBS.forEach((j, idx) => {
    const row = LIST_START_ROW + idx;
    const priv = PRIV_USERS.has(j.user);
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: j.job.slice(0, 10).padEnd(10, ' '), input: false });
    fields.push({ row, col: 17, text: j.sbs.padEnd(10, ' '), input: false });
    fields.push({ row, col: 28, text: j.user.padEnd(11, ' '), input: false, attr: authAttr(priv) });
    fields.push({ row, col: 40, text: j.type.padEnd(5, ' '), input: false });
    fields.push({ row, col: 46, text: j.func.padEnd(13, ' '), input: false });
    fields.push({ row, col: 60, text: j.status, input: false });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function screenSbsList(ctx) {
  const fields = [
    { row: 0, col: 30, text: 'Work with Subsystems', input: false },
    { row: 0, col: 68, text: SYSNAME, input: false },
    { row: 2, col: 2,  text: 'Type options, press Enter.', input: false },
    { row: 5, col: 2,  text: 'Opt  Subsystem   Status     Max Active   Text', input: false },
  ];
  SBS.forEach((s, idx) => {
    const row = LIST_START_ROW + idx;
    fields.push({ row, col: 2,  text: '', input: true, length: 2 });
    fields.push({ row, col: 6,  text: s.name.padEnd(11, ' '), input: false });
    fields.push({ row, col: 17, text: s.status.padEnd(10, ' '), input: false });
    fields.push({ row, col: 28, text: s.maxJobs.padEnd(12, ' '), input: false });
    fields.push({ row, col: 41, text: s.text.slice(0, 30), input: false });
  });
  listTrailer(fields, ctx.message);
  return wrapPanel(fields, { row: LIST_START_ROW, col: 2 });
}

function seedMessages(user) {
  const now = new Date();
  const date = now.toLocaleDateString('en-US');
  const time = now.toLocaleTimeString('en-US', { hour12: false });
  return [
    { from: 'QSYSOPR', date, time, text: `Welcome to ${SYSNAME}, ${user}.` },
    { from: 'QSYSOPR', date, time, text: 'System backup scheduled for 23:00 tonight.' },
  ];
}

// ── Connection handling ───────────────────────────────────────────
let connCount = 0;

function handleConnection(socket) {
  const id = ++connCount;
  log(`[${id}] Connected from ${socket.remoteAddress}:${socket.remotePort}`);

  let recvBuf = Buffer.alloc(0);
  let currentRecord = null;
  let negotiated = { ttype: false, newenv: false, binary: false, eor: false };
  let screen = 'signon';   // 'signon' | a MENUS key | 'MESSAGES' | 'STUB'
  let user = null;
  let menuMessage = '';
  let messages = [];
  let unreadCount = 0;
  let returnTo = 'MAIN';   // menu to go back to from MESSAGES/STUB
  let stubLabel = '';      // which option led to the current STUB screen
  let cmdTarget = null;    // detail target: sysval name / profile name / object index
  let navStack = [];       // back-navigation stack for the WRK/DSP security panels

  // Navigate one level deeper (remember where we came from), back up one
  // level, or apply a parsed CL command's navigation result.
  function goTo(next, target = null) { navStack.push(screen); screen = next; cmdTarget = target; menuMessage = ''; }
  function goBack() { screen = navStack.pop() || 'MAIN'; menuMessage = ''; }
  function applyCommand(res) {
    switch (res.type) {
      case 'screen':   goTo(res.screen); break;
      case 'detail':   goTo(res.screen, res.target); break;
      case 'messages': returnTo = screen; screen = 'MESSAGES'; break;
      case 'signoff':  screen = 'signon'; user = null; messages = []; unreadCount = 0; navStack = []; break;
      case 'error':    menuMessage = res.message; break;
      case 'none':     break;
    }
  }

  socket.on('data', chunk => { recvBuf = Buffer.concat([recvBuf, chunk]); processBuffer(); });
  socket.on('end',   () => log(`[${id}] Disconnected`));
  socket.on('error', err => log(`[${id}] Error: ${err.message}`));

  // Initial negotiation, per RFC 4777 §3: NEW-ENVIRON + TERMINAL-TYPE
  // before EOR/BINARY.
  socket.write(Buffer.from([
    IAC, DO, OPT_NEWENV,
    IAC, DO, OPT_TTYPE,
  ]));
  debug(`[${id}] -> DO NEW-ENVIRON, DO TERMINAL-TYPE`);

  function processBuffer() {
    let i = 0;
    while (i < recvBuf.length) {
      const b = recvBuf[i];
      if (b !== IAC) { accum(b); i++; continue; }

      const cmd = recvBuf[i + 1];
      if (cmd === undefined) break;
      if (cmd === NOP) { i += 2; continue; }

      if (cmd === EOR) {
        i += 2;
        if (currentRecord && currentRecord.length > 0) {
          handleRecord(Buffer.from(currentRecord));
          currentRecord = null;
        }
        continue;
      }

      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= recvBuf.length) break;
        const opt = recvBuf[i + 2];
        handleTelnetCmd(cmd, opt);
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

      if (cmd === IAC) { accum(0xFF); i += 2; continue; }
      i += 2;
    }
    recvBuf = recvBuf.slice(i);
  }

  function accum(byte) { if (!currentRecord) currentRecord = []; currentRecord.push(byte); }

  function findSE(start) {
    for (let j = start; j < recvBuf.length - 1; j++) {
      if (recvBuf[j] === IAC && recvBuf[j + 1] === SE) return j;
    }
    return -1;
  }

  function handleTelnetCmd(cmd, opt) {
    debug(`[${id}] <- ${cmd === DO ? 'DO' : cmd === DONT ? 'DONT' : cmd === WILL ? 'WILL' : 'WONT'} 0x${opt.toString(16)}`);

    if (opt === OPT_TTYPE && cmd === WILL) {
      socket.write(Buffer.from([IAC, SB, OPT_TTYPE, ENV_SEND, IAC, SE]));
      return;
    }
    if (opt === OPT_NEWENV && cmd === WILL) {
      socket.write(Buffer.from([IAC, SB, OPT_NEWENV, ENV_SEND, IAC, SE]));
      return;
    }
    if (opt === OPT_BINARY && cmd === WILL) { negotiated.binary = true; socket.write(Buffer.from([IAC, DO, OPT_BINARY])); }
    if (opt === OPT_EOR    && cmd === WILL) { negotiated.eor = true;    socket.write(Buffer.from([IAC, DO, OPT_EOR])); }
    maybeStart();
  }

  function handleSubneg(data) {
    const opt = data[0];
    if (opt === OPT_TTYPE && data[1] === ENV_IS) {
      const ttype = data.slice(2).toString('ascii');
      debug(`[${id}] <- TERMINAL-TYPE IS ${ttype}`);
      negotiated.ttype = true;
      // Ask for BINARY/EOR next, matching RFC 4777's recommended order.
      socket.write(Buffer.from([IAC, DO, OPT_BINARY]));
      socket.write(Buffer.from([IAC, DO, OPT_EOR]));
      maybeStart();
      return;
    }
    if (opt === OPT_NEWENV && data[1] === ENV_IS) {
      debug(`[${id}] <- NEW-ENVIRON IS (${data.length} bytes)`);
      negotiated.newenv = true;
      maybeStart();
    }
  }

  function maybeStart() {
    if (negotiated.ttype && negotiated.newenv && negotiated.binary && negotiated.eor && !negotiated.started) {
      negotiated.started = true;
      setImmediate(() => sendScreen());
    }
  }

  function sendScreen() {
    let ds;
    if (screen === 'signon') {
      ds = screenSignon();
    } else if (screen === 'MESSAGES') {
      ds = screenMessages({ user, messages });
    } else if (screen === 'STUB') {
      ds = screenStub(stubLabel, { user });
    } else if (screen === 'SYSVAL_LIST') {
      ds = screenSysvalList({ message: menuMessage });
    } else if (screen === 'SYSVAL_DETAIL') {
      ds = screenSysvalDetail(cmdTarget);
    } else if (screen === 'USRPRF_LIST') {
      ds = screenUsrprfList({ message: menuMessage });
    } else if (screen === 'USRPRF_DETAIL') {
      ds = screenUsrprfDetail(cmdTarget);
    } else if (screen === 'OBJ_LIST') {
      ds = screenObjList({ message: menuMessage });
    } else if (screen === 'OBJ_DETAIL') {
      ds = screenObjDetail(cmdTarget);
    } else if (screen === 'NETA') {
      ds = screenNetaDetail();
    } else if (screen === 'JOBD_LIST') {
      ds = screenJobdList({ message: menuMessage });
    } else if (screen === 'JOBD_DETAIL') {
      ds = screenJobdDetail(cmdTarget);
    } else if (screen === 'AUTL_LIST') {
      ds = screenAutlList({ message: menuMessage });
    } else if (screen === 'AUTL_DETAIL') {
      ds = screenAutlDetail(cmdTarget);
    } else if (screen === 'ACTJOB_LIST') {
      ds = screenActjobList({ message: menuMessage });
    } else if (screen === 'SBS_LIST') {
      ds = screenSbsList({ message: menuMessage });
    } else if (MENUS[screen]) {
      ds = screenMenu(screen, { user, unreadCount, message: menuMessage });
    } else {
      screen = 'MAIN';
      ds = screenMenu(screen, { user, unreadCount, message: '' });
    }
    sendRecord(ds, OPCODE_PUT_GET);
    log(`[${id}] -> Screen: ${screen}`);
  }

  function sendRecord(data, opcode) {
    const totalLen = data.length + 10;
    const header = Buffer.from([
      (totalLen >> 8) & 0xFF, totalLen & 0xFF,
      GDS_HI, GDS_LO,
      (FLOW_DISPLAY >> 8) & 0xFF, FLOW_DISPLAY & 0xFF,
      4, 0x00, 0x00, opcode,
    ]);
    const payload = Buffer.concat([header, data]);
    const escaped = [];
    for (const b of payload) { escaped.push(b); if (b === IAC) escaped.push(IAC); }
    escaped.push(IAC, EOR);
    socket.write(Buffer.from(escaped));
  }

  function handleRecord(record) {
    if (record.length < 10 || record[2] !== GDS_HI || record[3] !== GDS_LO) {
      debug(`[${id}] Non-GDS or short record (${record.length} bytes) — ignoring`);
      return;
    }
    const body = record.slice(10);
    // Per lib5250 session.c tn5250_session_send_fields: cursor row+1,
    // cursor col+1, THEN the AID byte, then SBA-prefixed field data.
    if (body.length < 3) return;
    const aid = body[2];
    const fieldData = body.slice(3);
    const runs = parseFieldRuns(fieldData);

    debug(`[${id}] <- AID=0x${aid.toString(16)} screen=${screen} runs=${JSON.stringify(runs)}`);

    if (screen === 'signon') {
      // Field rows match screenSignon()'s layout: User at row 7, Password
      // at row 8 (unused by this mock beyond being present — no real
      // credential check, same as before).
      const typedUser = fieldAt(runs, 7);
      if (typedUser) {
        user = typedUser.toUpperCase();
        messages = seedMessages(user);
        unreadCount = messages.length;
        returnTo = 'MAIN';
        screen = 'MAIN';
        menuMessage = '';
      }
      // Blank Enter on signon just redraws it — a real AS/400 would show
      // "User missing", which isn't worth modeling for this mock.
    } else if (screen === 'MESSAGES') {
      // Viewing the messages marks them read, like real DSPMSG.
      unreadCount = 0;
      screen = returnTo;
      menuMessage = '';
    } else if (screen === 'STUB') {
      screen = returnTo;
      menuMessage = '';
    } else if (LIST_META[screen]) {
      const meta = LIST_META[screen];
      const cmdLine = fieldAt(runs, LIST_CMD_ROW);
      if (aid === AID_F3 || aid === AID_F12) {
        goBack();
      } else if (cmdLine) {
        applyCommand(runCommand(cmdLine));
      } else if (meta.detail) {
        // Any non-blank Opt acts as 5=Display in the mock.
        const pick = pickOption(runs, LIST_START_ROW, meta.count());
        if (pick) { const [scr, tgt] = meta.detail(pick.index); goTo(scr, tgt); }
        // bare Enter with no option typed → redraw as-is
      }
      // list-only panels (no meta.detail) ignore Opt and just redraw
    } else if (DETAIL_SCREENS.has(screen)) {
      // Enter, F3, or F12 all return to the panel we came from.
      goBack();
    } else if (MENUS[screen]) {
      const menu = MENUS[screen];
      const sel = fieldAt(runs, 22);

      if ((aid === AID_F3 || aid === AID_F12) && menu.parent) {
        screen = menu.parent;
        menuMessage = '';
      } else if (sel === '') {
        // bare Enter — redraw the menu as-is
      } else if (sel === '90') {
        screen = 'signon';
        user = null;
        messages = [];
        unreadCount = 0;
        navStack = [];
      } else if (/^\d+$/.test(sel)) {
        const opt = menu.options.find(o => o.num === sel);
        if (!opt) {
          menuMessage = `Selection ${sel} is not valid.`;
        } else if (opt.action === 'messages') {
          returnTo = screen;
          screen = 'MESSAGES';
        } else if (opt.run) {
          applyCommand(runCommand(opt.run));
        } else if (opt.goto) {
          screen = opt.goto;
          menuMessage = '';
        } else {
          returnTo = screen;
          stubLabel = opt.label.toUpperCase();
          screen = 'STUB';
        }
      } else {
        // Non-numeric input on the command line — run it as a CL command.
        applyCommand(runCommand(sel));
      }
    }
    sendScreen();
  }
}

function log(msg)   { console.log(`${new Date().toISOString()} [INFO ] ${msg}`); }
function debug(msg) { if (LOG) console.log(`${new Date().toISOString()} [DEBUG] ${msg}`); }

const server = net.createServer(handleConnection);
server.listen(PORT, '0.0.0.0', () => {
  log(`Mock AS/400 (TN5250) listening on 0.0.0.0:${PORT}`);
});
