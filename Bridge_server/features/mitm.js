'use strict';

// MITM intercept state — per-session.
// When active, outbound AID records are held until the instructor
// releases (optionally modified), drops, or replays them.
const _enabled      = new Set();   // wsId → MITM active
const _held         = new Map();   // wsId → { aid, fields, cursorAddr }
const _lastReleased = new Map();   // wsId → { aid, fields, cursorAddr } (for replay)

function isEnabled(wsId) {
  return _enabled.has(wsId);
}

function toggle(wsId, ws, send, logger) {
  const wasActive = _enabled.has(wsId);
  if (wasActive) {
    _enabled.delete(wsId);
    _held.delete(wsId);
  } else {
    _enabled.add(wsId);
  }
  const active = !wasActive;
  logger.info(`[ws:${wsId}] MITM intercept ${active ? 'enabled' : 'disabled'}`);
  send(ws, { type: 'sec.mitm.state', active });
}

function interceptKey(wsId, ws, session, msg, send, logger, logTraffic) {
  const fields     = session.getModifiedFields();
  const cursorAddr = session.cursorAddr;
  const cols       = session.cols || 80;
  _held.set(wsId, { aid: msg.aid, fields, cursorAddr });
  logger.info(`[ws:${wsId}] MITM: intercepted ${msg.aid} (${fields.length} fields) cursorAddr=${cursorAddr}`);
  send(ws, {
    type: 'sec.mitm.held',
    aid: msg.aid,
    cursorAddr,
    cursorRow: Math.floor(cursorAddr / cols),
    cursorCol:  cursorAddr % cols,
    fields: fields.map(f => ({
      addr: f.addr,
      row:  Math.floor(f.addr / cols),
      col:  f.addr % cols,
      data: f.data,
      nondisplay: f.nondisplay,
    })),
  });
}

function release(wsId, ws, session, msg, send, logger, logTraffic) {
  const held = _held.get(wsId);
  if (!held) return;
  _held.delete(wsId);
  const releaseFields = (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : held.fields;
  _lastReleased.set(wsId, { aid: held.aid, fields: releaseFields, cursorAddr: held.cursorAddr });
  logger.info(`[ws:${wsId}] MITM: releasing ${held.aid} (${releaseFields.length} fields)`);
  session.sendAid(held.aid, releaseFields);
  logTraffic({ ts: new Date().toISOString(), wsId, direction: 'client→host', aid: held.aid + ' [MITM]', screenText: '' });
  send(ws, { type: 'sec.mitm.released', aid: held.aid });
}

function drop(wsId, ws, send, logger) {
  const held = _held.get(wsId);
  if (!held) return;
  _held.delete(wsId);
  logger.info(`[ws:${wsId}] MITM: dropped ${held.aid}`);
  send(ws, { type: 'sec.mitm.dropped', aid: held.aid });
}

function replay(wsId, ws, session, send, logger, logTraffic) {
  const last = _lastReleased.get(wsId);
  if (!last) { send(ws, { type: 'sec.mitm.replay-empty' }); return; }
  logger.info(`[ws:${wsId}] MITM: replaying ${last.aid}`);
  session.sendAid(last.aid, last.fields);
  logTraffic({ ts: new Date().toISOString(), wsId, direction: 'client→host', aid: last.aid + ' [MITM-replay]', screenText: '' });
  send(ws, { type: 'sec.mitm.replayed', aid: last.aid });
}

function cleanup(wsId) {
  _enabled.delete(wsId);
  _held.delete(wsId);
  _lastReleased.delete(wsId);
}

module.exports = { isEnabled, toggle, interceptKey, release, drop, replay, cleanup };
