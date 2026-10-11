// Unit tests for zlinux-parse.js. Run: node --test (from Bridge_server/)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrivClasses, classifyCpResult, classifyConsole, consoleHostname,
  privFindings, consoleFindings, smapiFindings, PRIV_PROBES,
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
