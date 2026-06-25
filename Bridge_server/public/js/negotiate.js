import { saveAs } from './utils.js';

// ── TN3270E Negotiation Analyzer + LU Fixation + Handshake Inspector ──────
// Fetches /api/negotiate and surfaces TLS cipher, certificate chain,
// TN3270E negotiation trace, LU fixation result, and session resumption.

const _WEAK_CIPHERS = [
  /RC4/i, /DES(?!3)/i, /3DES/i, /NULL/i, /EXPORT/i, /ANON/i, /MD5/i, /RC2/i,
];

const RISK_C = { CRITICAL: '#e06060', HIGH: '#e0a060', MEDIUM: '#cccc60', OK: '#3a6a3a', NONE: '#e06060', INFO: '#446688' };

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
  if (entry.certSelfSigned)  findings.push({ risk: 'HIGH',   msg: 'Self-signed certificate' });
  if (!entry.certSubject)    findings.push({ risk: 'MEDIUM', msg: 'No peer certificate presented' });
  if (entry.certExpiry) {
    const daysLeft = Math.floor((new Date(entry.certExpiry) - Date.now()) / 86400000);
    if (daysLeft < 0)   findings.push({ risk: 'CRITICAL', msg: `Certificate expired ${Math.abs(daysLeft)}d ago` });
    else if (daysLeft < 30) findings.push({ risk: 'HIGH', msg: `Certificate expires in ${daysLeft}d` });
  }
  return findings;
}

function _luFixationFinding(s) {
  if (s.luFixation === 'ACCEPTED') return { risk: 'MEDIUM', msg: `LU fixation accepted — requested "${s.luRequested}" was granted (client controls audit identity)` };
  if (s.luFixation === 'REJECTED') return { risk: 'INFO',   msg: `LU fixation rejected — requested "${s.luRequested}", host assigned "${s.lu}" (pool assignment, normal)` };
  if (s.luFixation === 'NOT_REQUESTED') return null;
  return null;
}

// ── Main session card ──────────────────────────────────────────────────────

function _renderNegotiate() {
  const el = document.getElementById('negotiateOut');
  if (!el) return;
  if (!_negotiateData.length) {
    el.innerHTML = '<div style="color:#333;font-size:10px;padding:4px 0">No active sessions — connect to a host first, then click Refresh.</div>';
    return;
  }
  const esc = s => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  el.innerHTML = _negotiateData.map(s => {
    const isPlain    = !s.tls || s.tls === 'PLAIN';
    const cipherFlag = _flagCipher(s.cipher);
    const luFix      = _luFixationFinding(s);
    const allFindings = [
      ...(isPlain ? [{ risk: 'CRITICAL', msg: 'No TLS — plaintext TN3270' }] : []),
      ...(!s.tn3270e ? [{ risk: 'MEDIUM', msg: 'TN3270E not negotiated — using classic TN3270' }] : []),
      ...(cipherFlag.risk !== 'OK' && !isPlain ? [{ risk: cipherFlag.risk, msg: `${cipherFlag.label}: ${s.cipher || 'none'}` }] : []),
      ..._flagCert(s),
      ...(luFix ? [luFix] : []),
      ...(s.sessionReused ? [{ risk: 'INFO', msg: 'TLS session resumed (ticket/session ID reuse)' }] : []),
    ];

    const worstRisk = allFindings.reduce((w, f) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3, OK: 4, NONE: 5 };
      return (order[f.risk] ?? 6) < (order[w] ?? 6) ? f.risk : w;
    }, 'OK');

    const rows = [
      ['Host',          `${esc(s.host)}:${s.port}`],
      ['TLS',           isPlain ? '⚠ PLAIN' : `✓ ${esc(s.tls)}`],
      ['Cipher',        esc(s.cipher)],
      ['Session reuse', s.sessionReused ? 'Yes (ticket/ID)' : 'No'],
      ['Cert CN',       esc(s.certSubject)],
      ['Cert issuer',   esc(s.certIssuer)],
      ['Cert expiry',   esc(s.certExpiry)],
      ['TN3270E',       s.tn3270e ? '✓ Active' : '✗ Not negotiated'],
      ['Model',         esc(s.model)],
      ['LU requested',  esc(s.luRequested)],
      ['LU granted',    esc(s.lu)],
      ['LU fixation',   esc(s.luFixation)],
    ].map(([k, v]) =>
      `<tr><td style="padding:2px 8px 2px 0;color:var(--text-muted);white-space:nowrap;font-size:9px">${k}</td>` +
      `<td style="padding:2px 0;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:9px">${v}</td></tr>`
    ).join('');

    const findings = allFindings.map(f =>
      `<div style="font-size:9px;padding:1px 0"><span style="color:${RISK_C[f.risk] || '#aaa'};font-weight:700;margin-right:5px">${f.risk}</span><span style="color:#777">${esc(f.msg)}</span></div>`
    ).join('') || `<div style="font-size:9px;color:#3a6a3a">No weaknesses detected</div>`;

    // Certificate chain
    const chainHtml = (s.certChain && s.certChain.length > 1)
      ? `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #111">` +
        `<div style="font-size:9px;color:var(--text-muted);margin-bottom:3px">CERT CHAIN (${s.certChain.length} certs)</div>` +
        s.certChain.map((c, i) =>
          `<div style="font-size:9px;padding:1px 0 1px ${i * 10}px;color:#555;font-family:'IBM Plex Mono',monospace">` +
          `${i === 0 ? '▶' : '└'} ${esc(c.subject)}` +
          `<span style="color:#333;margin-left:6px">${esc(c.validTo)}</span>` +
          (c.selfSigned ? `<span style="color:#e0a060;margin-left:6px">self-signed</span>` : '') +
          `</div>`
        ).join('') + `</div>`
      : '';

    // TN3270E negotiation trace
    const traceHtml = (s.tn3270eLog && s.tn3270eLog.length)
      ? `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #111">` +
        `<div style="font-size:9px;color:var(--text-muted);margin-bottom:3px">TN3270E HANDSHAKE TRACE</div>` +
        s.tn3270eLog.map(e =>
          `<div style="font-size:9px;padding:1px 0;font-family:'IBM Plex Mono',monospace">` +
          `<span style="color:${e.dir === 'sent' ? '#446688' : '#6a8844'};min-width:36px;display:inline-block">${e.dir === 'sent' ? '→ C' : '← S'}</span>` +
          `<span style="color:#777;margin-left:4px">${esc(e.decoded)}</span>` +
          `</div>`
        ).join('') + `</div>`
      : '';

    return `<div style="margin-bottom:10px;padding:6px 8px;background:#0a0a0a;border:1px solid #1a1a1a;border-left:3px solid ${RISK_C[worstRisk] || '#333'};border-radius:2px">` +
      `<div style="font-size:10px;font-weight:600;color:#aaa;margin-bottom:4px">Session ${s.wsId} — ${esc(s.host)}</div>` +
      `<table style="border-collapse:collapse;margin-bottom:6px">${rows}</table>` +
      `<div style="border-top:1px solid #1a1a1a;padding-top:4px">${findings}</div>` +
      chainHtml + traceHtml +
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
  const rows = [['wsId', 'host', 'port', 'tls', 'cipher', 'sessionReused', 'certSubject', 'certIssuer',
    'certExpiry', 'certSelfSigned', 'certChainDepth', 'tn3270e', 'model', 'luRequested', 'lu', 'luFixation']];
  for (const s of _negotiateData) {
    rows.push([s.wsId, s.host, s.port, s.tls || 'PLAIN', s.cipher || '',
      s.sessionReused ? 'YES' : 'NO', s.certSubject || '', s.certIssuer || '',
      s.certExpiry || '', s.certSelfSigned ? 'YES' : 'NO',
      (s.certChain || []).length,
      s.tn3270e ? 'YES' : 'NO', s.model || '',
      s.luRequested || '', s.lu || '', s.luFixation || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  saveAs(new Blob([csv], { type: 'text/csv' }), `negotiate-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
}

Object.assign(window, { negotiateRefresh, negotiateExportCsv });
