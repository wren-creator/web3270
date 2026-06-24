import { saveAs } from './utils.js';

// ── TN3270E Negotiation Analyzer ───────────────────────────────────────────
// Fetches /api/negotiate and surfaces TLS cipher, certificate details,
// TN3270E status, model, and LU — flagging weak ciphers and plain sessions.

const _WEAK_CIPHERS = [
  /RC4/i, /DES(?!3)/i, /3DES/i, /NULL/i, /EXPORT/i, /ANON/i, /MD5/i, /RC2/i,
];

let _negotiateData = [];

function _negotiateStatus(msg) {
  const el = document.getElementById('negotiateStatus');
  if (el) el.textContent = msg;
}

function _flagCipher(cipher) {
  if (!cipher) return { risk: 'NONE', label: 'No cipher (plaintext)' };
  if (_WEAK_CIPHERS.some(p => p.test(cipher))) return { risk: 'HIGH', label: 'Weak cipher' };
  if (/CHACHA20|AES_256|AES-256/i.test(cipher))  return { risk: 'OK',   label: 'Strong' };
  if (/AES_128|AES-128/i.test(cipher))            return { risk: 'OK',   label: 'Adequate' };
  return { risk: 'MEDIUM', label: 'Unknown strength' };
}

function _flagCert(entry) {
  const findings = [];
  if (entry.certSelfSigned)              findings.push({ risk: 'HIGH',   msg: 'Self-signed certificate' });
  if (!entry.certSubject)                findings.push({ risk: 'MEDIUM', msg: 'No peer certificate presented' });
  if (entry.certExpiry) {
    const expiry = new Date(entry.certExpiry);
    const daysLeft = Math.floor((expiry - Date.now()) / 86400000);
    if (daysLeft < 0)   findings.push({ risk: 'CRITICAL', msg: `Certificate expired ${Math.abs(daysLeft)}d ago` });
    else if (daysLeft < 30) findings.push({ risk: 'HIGH', msg: `Certificate expires in ${daysLeft}d` });
  }
  return findings;
}

function _renderNegotiate() {
  const el = document.getElementById('negotiateOut');
  if (!el) return;
  if (!_negotiateData.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:4px 0">No active sessions — connect to a host first, then click Refresh.</div>';
    return;
  }
  const esc = s => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#cccc60', OK: '#3a6a3a', NONE: '#e06060' };

  el.innerHTML = _negotiateData.map(s => {
    const isPlain     = !s.tls || s.tls === 'PLAIN';
    const cipherFlag  = _flagCipher(s.cipher);
    const certFindings = _flagCert(s);
    const allFindings = [
      ...(isPlain ? [{ risk: 'CRITICAL', msg: 'No TLS — plaintext TN3270' }] : []),
      ...(!s.tn3270e ? [{ risk: 'MEDIUM', msg: 'TN3270E not negotiated — using classic TN3270' }] : []),
      ...(cipherFlag.risk !== 'OK' && !isPlain ? [{ risk: cipherFlag.risk, msg: `${cipherFlag.label}: ${s.cipher || 'none'}` }] : []),
      ...certFindings,
    ];

    const worstRisk = allFindings.reduce((w, f) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, OK: 3, NONE: 4 };
      return (order[f.risk] ?? 5) < (order[w] ?? 5) ? f.risk : w;
    }, 'OK');

    const rows = [
      ['Host',       `${esc(s.host)}:${s.port}`],
      ['TLS',        isPlain ? '⚠ PLAIN' : `✓ ${esc(s.tls)}`],
      ['Cipher',     esc(s.cipher)],
      ['Cert CN',    esc(s.certSubject)],
      ['Cert issuer',esc(s.certIssuer)],
      ['Cert expiry',esc(s.certExpiry)],
      ['TN3270E',    s.tn3270e ? '✓ Active' : '✗ Not negotiated'],
      ['Model',      esc(s.model)],
      ['LU',         esc(s.lu)],
    ].map(([k, v]) =>
      `<tr><td style="padding:2px 8px 2px 0;color:var(--text-muted);white-space:nowrap;font-size:9px">${k}</td>` +
      `<td style="padding:2px 0;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:9px">${v}</td></tr>`
    ).join('');

    const findings = allFindings.map(f =>
      `<div style="font-size:9px;padding:1px 0"><span style="color:${RISK_C[f.risk]};font-weight:700;margin-right:5px">${f.risk}</span><span style="color:#777">${esc(f.msg)}</span></div>`
    ).join('') || `<div style="font-size:9px;color:#3a6a3a">No weaknesses detected</div>`;

    return `<div style="margin-bottom:10px;padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${RISK_C[worstRisk] || '#333'};border-radius:2px">` +
      `<div style="font-size:10px;font-weight:600;color:#aaa;margin-bottom:4px">Session ${s.wsId} — ${esc(s.host)}</div>` +
      `<table style="border-collapse:collapse;margin-bottom:6px">${rows}</table>` +
      `<div style="border-top:1px solid #1a1a1a;padding-top:4px">${findings}</div>` +
      `</div>`;
  }).join('');
}

export async function negotiateRefresh() {
  if (window.location.protocol === 'file:') { _negotiateStatus('Not available in file mode'); return; }
  try {
    _negotiateStatus('Fetching…');
    const res = await fetch('/api/negotiate');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _negotiateData = await res.json();
    _renderNegotiate();
    _negotiateStatus(`${_negotiateData.length} session(s)`);
  } catch (err) {
    _negotiateStatus('Error: ' + err.message);
  }
}

export function negotiateExportCsv() {
  if (!_negotiateData.length) return;
  const rows = [['wsId', 'host', 'port', 'tls', 'cipher', 'certSubject', 'certIssuer', 'certExpiry', 'certSelfSigned', 'tn3270e', 'model', 'lu']];
  for (const s of _negotiateData) {
    rows.push([s.wsId, s.host, s.port, s.tls || 'PLAIN', s.cipher || '', s.certSubject || '',
      s.certIssuer || '', s.certExpiry || '', s.certSelfSigned ? 'YES' : 'NO',
      s.tn3270e ? 'YES' : 'NO', s.model || '', s.lu || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `negotiate-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, { negotiateRefresh, negotiateExportCsv });
