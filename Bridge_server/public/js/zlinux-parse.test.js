// Unit tests for zlinux-parse.js. Run: node --test (from Bridge_server/)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrivClasses, classifyCpResult, classifyConsole, consoleHostname,
  privFindings, consoleFindings, smapiFindings, PRIV_PROBES,
  parseVswitches, parseVmlans, parseAccessList, networkFindings,
  classifyXautolog, xautologFindings, sendCpFindings,
} from './zlinux-parse.js';

test('parsePrivClasses reads single and multi-class replies, case-insensitively', () => {
  assert.equal(parsePrivClasses('PRIVILEGE CLASSES FOR LNXGST01: G'), 'G');
  assert.equal(parsePrivClasses('Privilege classes for LNXGST02: A B E G'), 'ABEG');
  assert.equal(parsePrivClasses('nothing here'), null);
});

test('classifyCpResult separates denied, invalid, executed, unknown', () => {
  assert.equal(classifyCpResult('HCPCQF040E INDICATE LOAD not available -- privilege class E required'), 'denied');
  assert.equal(classifyCpResult('HCPxxx041E User not authorized to issue this command'), 'denied');
  assert.equal(classifyCpResult('HCPCMD003E Unknown CP command: FOO'), 'invalid');
  assert.equal(classifyCpResult('AVGPROC-012% 02\nReady; T=0.01/0.01'), 'executed');
  assert.equal(classifyCpResult(''), 'unknown');
});

test('classifyConsole recognizes a Linux login prompt and CP', () => {
  assert.equal(classifyConsole('Ubuntu 22.04.3 LTS lnxgst01 ttysclp0\n\nlnxgst01 login:'), 'linux-login');
  assert.equal(classifyConsole('HCPLGA050E LOGON unsuccessful--incorrect password'), 'logon-failed');
  assert.equal(classifyConsole('LOGON AT 12:00\nReady; T=0.01/0.01'), 'cp');
  assert.equal(consoleHostname('x\nlnxgst01 login:'), 'lnxgst01');
});

test('privFindings: class G with every gated command refused is a pass', () => {
  const probes = PRIV_PROBES.map(p => ({ ...p, result: `HCPCQF040E ${p.name} not available -- privilege class ${p.need} required` }));
  const f = privFindings('LNXGST01', 'G', probes);
  assert.equal(f.length, 1); assert.equal(f[0].severity, 'OK');
});

test('privFindings: admin classes and an executed gated command are both CRITICAL', () => {
  const probes = PRIV_PROBES.map(p => ({ ...p, result: 'AVGPROC-012% 02\nReady; T=0.01/0.01' }));
  const f = privFindings('LNXGST02', 'ABEG', probes);
  assert.equal(f.filter(x => x.severity === 'CRITICAL').length, 1 + PRIV_PROBES.length);
  assert.ok(f[0].finding.includes('A, B, E'));
});

test('privFindings: an unreadable reply is not scored as a clean pass', () => {
  const f = privFindings('X', 'G', [{ name: 'QUERY SRM', need: 'E', result: '' }]);
  assert.equal(f[0].severity, 'INFO');
});

test('privFindings: probes swallowed by a Linux login prompt are inconclusive, never a pass', () => {
  const probes = PRIV_PROBES.map(p => ({ ...p, result: 'Password:\nLogin incorrect\n\nlnxgst01 login:' }));
  const f = privFindings('LNXGST01', null, probes);
  assert.equal(f[0].severity, 'INFO');
  assert.ok(!f.some(x => x.severity === 'OK'));
});

test('privFindings: class G read but classes unparsed still is not a pass', () => {
  const probes = PRIV_PROBES.map(p => ({ ...p, result: `HCPCQF040E ${p.name} not available -- privilege class ${p.need} required` }));
  assert.equal(privFindings('X', null, probes)[0].severity, 'INFO');
});

test('consoleFindings: reachable Linux console plus working #CP escape', () => {
  const f = consoleFindings('LNXGST01', 'lnxgst01 login:', 'PRIVILEGE CLASSES FOR LNXGST01: G\nReady; T=0.01/0.01');
  assert.deepEqual(f.map(x => [x.check, x.severity]), [['guest-console', 'HIGH'], ['cp-escape', 'HIGH']]);
});

test('consoleFindings: an escape the console swallowed is OK', () => {
  const f = consoleFindings('X', 'lnxgst01 login:', 'lnxgst01 login: #CP\nPassword:\nLogin incorrect');
  assert.equal(f.find(x => x.check === 'cp-escape').severity, 'OK');
});

test('smapiFindings: plaintext open port is HIGH, closed is OK', () => {
  const f = smapiFindings('h', [{ port: 44444, state: 'open', tls: false }, { port: 44445, state: 'closed' }]);
  assert.equal(f[0].severity, 'HIGH'); assert.equal(f[1].severity, 'OK');
});

test('privFindings evidence quotes the reply, not the screen header', () => {
  const screen = 'z/VM CP  ZVMPROD      LNXGST02 Logged On\nAVGPROC-012% 02\nLNXGST02 CP\nRUNNING   ZVMPROD';
  const f = privFindings('LNXGST02', 'G', [{ name: 'INDICATE LOAD', need: 'E', result: screen }]);
  assert.equal(f[0].evidence, 'AVGPROC-012% 02');
});

const VSW = `VSWITCH SYSTEM VSW1  Type: QDIO    Connected: 2    Maxconn: INFINITE
  PERSISTENT  RESTRICTED    NONROUTER                 Accounting: OFF
  VLAN Unaware
  MAC address: 02-00-00-00-00-01     MAC Protection: Unspecified
  Isolation Status: OFF
Ready; T=0.01/0.01`;
const LAN = `LAN SYSTEM HIPER1  Type: HIPERS  Connected: 3  Maxconn: INFINITE
  PERSISTENT  UNRESTRICTED  IP  MFS: 8K  Accounting: OFF`;

test('parseVswitches / parseVmlans read the header and its detail lines', () => {
  const [v] = parseVswitches(VSW);
  assert.deepEqual([v.name, v.type, v.connected, v.restricted, v.vlan, v.isolation], ['VSW1', 'QDIO', 2, true, 'unaware', 'OFF']);
  const [l] = parseVmlans(LAN);
  assert.deepEqual([l.name, l.type, l.restricted], ['HIPER1', 'HIPERS', false]);
});

test('UNRESTRICTED must not be read as RESTRICTED', () => {
  assert.equal(parseVmlans('LAN SYSTEM X  Type: QDIO\n  PERSISTENT  UNRESTRICTED')[0].restricted, false);
});

test('networkFindings: isolation off is MEDIUM, open HiperSockets LAN is HIGH', () => {
  const f = networkFindings('ZVMPROD', parseVswitches(VSW), parseVmlans(LAN));
  assert.ok(f.some(x => x.severity === 'MEDIUM' && /isolation is OFF/i.test(x.finding)));
  assert.ok(f.some(x => x.severity === 'HIGH' && /HiperSockets/.test(x.finding)));
});

test('networkFindings: a refused access list is INFO, a read one names the users', () => {
  const denied = networkFindings('Z', parseVswitches(VSW), [], { VSW1: { status: 'denied', users: [] } });
  assert.ok(denied.some(x => /expected result for a class G/.test(x.finding)));
  const users = parseAccessList('Authorized users for VSWITCH SYSTEM VSW1:\n  LNXGST01  LNXGST02  TCPIP\nReady; T=0.01/0.01');
  assert.deepEqual(users, ['LNXGST01', 'LNXGST02', 'TCPIP']);
  const read = networkFindings('Z', parseVswitches(VSW), [], { VSW1: { status: 'read', users } });
  assert.ok(read.some(x => /3 users authorized/.test(x.finding)));
});

test('networkFindings: nothing parsed is INFO, never OK', () => {
  assert.equal(networkFindings('Z', [], [])[0].severity, 'INFO');
});

test('networkFindings: a locked-down switch is OK', () => {
  const v = parseVswitches('VSWITCH SYSTEM V2  Type: QDIO  Connected: 1\n  PERSISTENT  RESTRICTED  NONROUTER\n  VLAN Aware\n  Isolation Status: ON');
  assert.equal(networkFindings('Z', v, [])[0].severity, 'OK');
});

test('classifyXautolog: authorized (already up or newly started), denied, unknown target', () => {
  assert.equal(classifyXautolog('HCPXAU003I User OPERATOR already logged on\nReady; T=0.01/0.01'), 'authorized');
  assert.equal(classifyXautolog('HCPXAU001I User OPERATOR has been started\nReady; T=0.01/0.01'), 'authorized');
  assert.equal(classifyXautolog('HCPXAU040E Not authorized to XAUTOLOG OPERATOR\nReady(00040); T=0.01/0.01'), 'denied');
  assert.equal(classifyXautolog('HCPXAU054E GHOST not in CP directory\nReady(00054); T=0.01/0.01'), 'unknown-target');
});

test('xautologFindings: authorized on a privileged target is HIGH, denied is OK', () => {
  const auth = xautologFindings('LNXGST02', 'OPERATOR', 'HCPXAU003I User OPERATOR already logged on\nReady; T=0.01/0.01');
  assert.equal(auth[0].severity, 'HIGH'); assert.match(auth[0].finding, /authorized to start OPERATOR/);
  const denied = xautologFindings('LNXGST01', 'OPERATOR', 'HCPXAU040E Not authorized to XAUTOLOG OPERATOR\nReady(00040); T=0.01/0.01');
  assert.equal(denied[0].severity, 'OK');
  const bad = xautologFindings('LNXGST01', 'GHOST', 'HCPXAU054E GHOST not in CP directory\nReady(00054); T=0.01/0.01');
  assert.equal(bad[0].severity, 'INFO');
});

test('sendCpFindings: executed is HIGH, refused is OK, reports no specific class', () => {
  const ok = sendCpFindings('LNXGST02', 'MAINT', 'Ready; T=0.01/0.01 (command sent to MAINT)');
  assert.equal(ok[0].severity, 'HIGH'); assert.doesNotMatch(ok[0].finding, /class [A-Z]/);
  const denied = sendCpFindings('LNXGST01', 'MAINT', 'HCPSEN040E SEND CP not available -- privilege class A, B or C required\nReady(00040); T=0.01/0.01');
  assert.equal(denied[0].severity, 'OK');
});
