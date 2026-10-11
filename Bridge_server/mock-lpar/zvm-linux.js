/**
 * mock-lpar/zvm-linux.js
 * Mock z/VM: the Linux-guest-to-hypervisor boundary.
 *
 * Training target for the z/Linux on z/VM audit tools (ROADMAP "z/Linux on
 * z/VM"). Two seeded Linux guests, one correctly provisioned and one that
 * was handed CP privilege it should never have had, plus the handful of CP
 * commands those audits drive. Kept out of mock-zvm.js so it can be tested
 * on its own; mock-zvm.js only calls in here.
 *
 * Message IDs follow the HCP naming style this mock already uses. They are
 * stand-ins, not captured from a live system, which is why the client-side
 * classifier keys on wording and the HCP...E shape rather than exact codes.
 */
'use strict';

// Directory entries for the Linux guests. LNXGST01 is the well-behaved one,
// class G, the shape every application-serving guest should have. LNXGST02
// is the finding: someone gave the guest ABEG "to make the monitoring agent
// work". Both ship a weak console password, which is the first thing the
// console audit is meant to catch.
const LINUX_GUESTS = {
  LNXGST01: { pass: 'LINUX',   classes: 'G',    host: 'lnxgst01' },
  LNXGST02: { pass: 'LNXPRIV', classes: 'ABEG', host: 'lnxgst02' },
};

const isLinuxGuest = u => Object.prototype.hasOwnProperty.call(LINUX_GUESTS, (u || '').toUpperCase());
const hasAnyClass = (have, needAny) => [...needAny].some(c => (have || 'G').includes(c));

// Read-only commands that real z/VM does not give a class G user. The
// privilege check runs these and sees whether CP executes or refuses.
// Classes are the commonly documented ones, to be confirmed against the
// customer's z/VM level before a finding is written up.
const GATED_QUERIES = [
  { re: /^INDICATE\s+LOAD\b/i, need: 'E', name: 'INDICATE LOAD' },
  { re: /^(Q|QUERY)\s+SRM\b/i, need: 'E', name: 'QUERY SRM' },
];

// Per-system spool state. Shared across connections, same simplification
// LOGGED_ON_USERS already makes. Seeded so QUERY RDR ALL has something to show.
const RDR_QUEUES = {
  LNXGST01: [{ id: '0007', from: 'OPERATOR', name: 'WELCOME', type: 'TEXT' }],
};

// Pending SPOOL PUNCH target per connection lives in the caller's state
// object, so one tester's setting never leaks into another's session.
function newGuestState() { return { punchTo: null, secuser: null }; }

const VSWITCH_TABLE = [
  'VSWITCH SYSTEM VSW1  Type: QDIO    Connected: 2    Maxconn: INFINITE',
  '  PERSISTENT  RESTRICTED    NONROUTER                 Accounting: OFF',
  '  VLAN Unaware',
  '  MAC address: 02-00-00-00-00-01     MAC Protection: Unspecified',
  '  IPTimeout: 5         QueueStorage: 8',
  '  Isolation Status: OFF',
].join('\n');

// Stand-in layout and class. Not captured from a live system, and the real
// privilege class for the access list is unconfirmed. The audit treats a
// refusal here as "could not read", never as a finding.
const VSWITCH_ACCESSLIST = [
  'Authorized users for VSWITCH SYSTEM VSW1:',
  '  LNXGST01  LNXGST02  TCPIP',
].join('\n');

const VMLAN_TABLE = 'LAN SYSTEM HIPER1  Type: HIPERS  Connected: 3  Maxconn: INFINITE\n  PERSISTENT  UNRESTRICTED  IP  MFS: 8K  Accounting: OFF';

/**
 * Handle one CP command from a user. Returns the output text, or null when
 * this module does not own the command (caller falls through to its own
 * dispatch).
 *
 *   userid   the caller
 *   classes  the caller's privilege classes as a string, e.g. 'G' or 'ABEG'
 *   gs       per-connection state from newGuestState()
 *   roster   userids currently logged on, for SMSG/SEND targets
 */
function handleGuestCommand(raw, userid, classes, gs, roster = []) {
  const cmd = String(raw || '').trim();
  const U = userid.toUpperCase();
  const done = '\nReady; T=0.01/0.01';

  for (const g of GATED_QUERIES) {
    if (g.re.test(cmd)) {
      if (!hasAnyClass(classes, g.need)) {
        return `HCPCQF040E ${g.name} not available -- privilege class ${g.need} required${'\nReady(00040); T=0.01/0.01'}`;
      }
      return g.name === 'INDICATE LOAD'
        ? `AVGPROC-012% 02\nXSTORE-000012/SEC MIGRATE-0000/SEC\nMDC READS-000010/SEC WRITES-000002/SEC HIT RATIO-099%${done}`
        : `IABIAS : INTENSITY=90%; DURATION=2\nLDUBUF : Q1=100% Q2=75% Q3=50%${done}`;
    }
  }

  if (/^(Q|QUERY)\s+VSWITCH\s+\S+\s+ACCESSLIST\b/i.test(cmd)) {
    if (!hasAnyClass(classes, 'B')) {
      return `HCPQVS040E QUERY VSWITCH ACCESSLIST not available -- privilege class B required\nReady(00040); T=0.01/0.01`;
    }
    return VSWITCH_ACCESSLIST + done;
  }
  if (/^(Q|QUERY)\s+VSWITCH\b/i.test(cmd)) return VSWITCH_TABLE + done;
  if (/^(Q|QUERY)\s+(VMLAN|LAN)\b/i.test(cmd)) return VMLAN_TABLE + done;

  if (/^(Q|QUERY)\s+(RDR|READER)\b/i.test(cmd)) {
    // Real CP shows a class G user their own reader only. Another user's
    // queue needs spool-operator class, so the mock refuses it.
    const asksOther = /\bUSER(?:ID)?\s+(\S+)/i.exec(cmd);
    if (asksOther && asksOther[1].toUpperCase() !== U && !hasAnyClass(classes, 'D')) {
      return `HCPQRD040E QUERY READER for another user not available -- privilege class D required\nReady(00040); T=0.01/0.01`;
    }
    const q = RDR_QUEUES[U] || [];
    if (!q.length) return `HCPQRD032E No files found${'\nReady(00032); T=0.01/0.01'}`;
    return ['ORIGINID FILE CLASS RECORDS CPY HOLD DATE TIME NAME TYPE DIST',
      ...q.map(f => `${f.from.padEnd(8)} ${f.id} A PUN 0000001 001 NONE 10/11 12:00:00 ${f.name} ${f.type}`)].join('\n') + done;
  }

  const sp = cmd.match(/^SPOOL\s+(?:PUN(?:CH)?|PUNCH)\s+(?:TO\s+)?(\S+)/i);
  if (sp) {
    gs.punchTo = sp[1].toUpperCase();
    return `PUNCH ${U.padEnd(8)} TO ${gs.punchTo}${done}`;
  }
  const pu = cmd.match(/^PUNCH\s+(\S+)/i);
  if (pu) {
    // Mock simplification: real PUNCH is a CMS command that reads a file;
    // here any PUNCH after a SPOOL PUNCH TO delivers a one-record file.
    if (!gs.punchTo) return `HCPPUN031E Punch not spooled to a user${'\nReady(00031); T=0.01/0.01'}`;
    const target = gs.punchTo;
    const known = Object.prototype.hasOwnProperty.call(RDR_QUEUES, target) || roster.includes(target) || isLinuxGuest(target) || /^(MAINT|OPERATOR|AUTOLOG1|TCPIP)$/.test(target);
    if (!known) return `HCPPUN045E User ${target} not logged on or not in directory${'\nReady(00045); T=0.01/0.01'}`;
    const n = String((RDR_QUEUES[target] || []).length + 8).padStart(4, '0');
    (RDR_QUEUES[target] = RDR_QUEUES[target] || []).push({ id: n, from: U, name: pu[1].toUpperCase(), type: 'TEXT' });
    return `RDR FILE ${n} SENT FROM ${U.padEnd(8)} PUN WAS ${n} RECS 0001 CPY 001 A NOHOLD NOKEEP${done}`;
  }

  const sec = cmd.match(/^SET\s+(SECUSER|OBSERVER)\s+(\S+)/i);
  if (sec) {
    // Accurate to real CP: this redirects the CALLER's own console output.
    // Reaching someone else's console takes SEND CP, below, which is gated.
    gs.secuser = sec[2].toUpperCase();
    return `${sec[1].toUpperCase()} set to ${gs.secuser}${done}`;
  }

  // The class SEND CP actually needs is unconfirmed against IBM's own
  // manual: one third-party source lists it as a plain general-user (class
  // G) command, which would make this gate wrong. Kept as a stand-in so the
  // probe has something to distinguish; the client-side finding treats the
  // mock's exact class as illustrative, not authoritative, and reports
  // only "CP executed it" vs "CP refused it".
  const sendcp = cmd.match(/^SEND\s+CP\s+(\S+)\s+(.+)$/i);
  if (sendcp) {
    if (!hasAnyClass(classes, 'ABC')) {
      return `HCPSEN040E SEND CP not available -- privilege class A, B or C required\nReady(00040); T=0.01/0.01`;
    }
    return `Ready; T=0.01/0.01 (command sent to ${sendcp[1].toUpperCase()})`;
  }

  const smsg = cmd.match(/^SMSG\s+(\S+)\s*(.*)$/i);
  if (smsg) {
    const t = smsg[1].toUpperCase();
    return roster.includes(t) ? `Ready; T=0.01/0.01` : `HCPMSG045E User ${t} not logged on or not receiving${'\nReady(00045); T=0.01/0.01'}`;
  }

  return null;
}

/** What a Linux guest's 3270 console shows right after a successful logon. */
function linuxConsoleBanner(userid) {
  const g = LINUX_GUESTS[(userid || '').toUpperCase()];
  const h = g ? g.host : 'linux';
  return [
    `Ubuntu 22.04.3 LTS ${h} ttysclp0`,
    '',
    `${h} login:`,
  ].join('\n');
}

/** Non-#CP input at a Linux console is a login attempt. */
function linuxLoginResponse(userid, typed) {
  const g = LINUX_GUESTS[(userid || '').toUpperCase()];
  const h = g ? g.host : 'linux';
  return `${typed}\nPassword:\nLogin incorrect\n\n${h} login:`;
}

module.exports = {
  LINUX_GUESTS, RDR_QUEUES, GATED_QUERIES,
  isLinuxGuest, hasAnyClass, newGuestState,
  handleGuestCommand, linuxConsoleBanner, linuxLoginResponse,
};
