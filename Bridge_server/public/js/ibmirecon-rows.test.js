import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIbmiReconRows, buildIbmiReconServerRows, buildIbmiReconFactRows,
  IBMI_RECON_HEADER, IBMI_RECON_SERVER_HEADER,
} from './ibmirecon-rows.js';

const RESULT = {
  host: '10.0.0.7', verdict: 'FINDING',
  findings: [
    { severity: 'FINDING', text: 'as-dtaq is offered in plain text on 8472 with no TLS twin.' },
    { severity: 'INFO', text: 'The server mapper answers on 449.' },
  ],
  facts: {
    osVersion: 'V7R4M0', passwordLevel: 1, serverJob: '135258/QUSER/QZSOSIGN', tlsProtocol: 'TLSv1.3',
    servers: {
      central: { plain: 8470, secure: 9470 },
      dtaq: { plain: 8472, secure: null },
      ghost: { plain: null, secure: null },
    },
  },
};

test('no result gives just the header', () => {
  assert.deepEqual(buildIbmiReconRows(null), [IBMI_RECON_HEADER]);
  assert.deepEqual(buildIbmiReconServerRows(null), [IBMI_RECON_SERVER_HEADER]);
  assert.deepEqual(buildIbmiReconFactRows(null), []);
});

test('one findings row per finding, carrying host, verdict and severity', () => {
  const rows = buildIbmiReconRows(RESULT);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['10.0.0.7', 'FINDING', 'FINDING', 'as-dtaq is offered in plain text on 8472 with no TLS twin.']);
});

test('server rows show none for a missing twin and skip servers the mapper never named', () => {
  const rows = buildIbmiReconServerRows(RESULT);
  assert.deepEqual(rows, [
    IBMI_RECON_SERVER_HEADER,
    ['as-central', '8470', '9470'],
    ['as-dtaq', '8472', 'none'],
  ]);
});

test('fact rows list only what the sign-on server actually said', () => {
  assert.deepEqual(buildIbmiReconFactRows(RESULT), [
    ['OS release', 'V7R4M0'], ['Password level (QPWDLVL)', '1'],
    ['Sign-on server job', '135258/QUSER/QZSOSIGN'], ['Sign-on TLS', 'TLSv1.3'],
  ]);
  assert.deepEqual(buildIbmiReconFactRows({ facts: { passwordLevel: 0 } }), [['Password level (QPWDLVL)', '0']]);
});
