import { WebSocket } from 'ws';
import fs from 'fs';
import Tn3270Session from '../tn3270/session.js';
import Tn5250Session from '../tn5250/session.js';
import MacroHandler from '../macros/handler.js';
import { MacroStore } from '../macros/store.js';
import CopilotHandler from '../copilot/copilot-handler.js';

import send from '../utils/send.js';
import { logTraffic } from '../features/traffic.js';
import { captureRaw } from '../features/pcap.js';
import { recordings } from '../features/recording.js';
import { handleSshConnect } from '../features/ssh.js';
import { handleFuzz } from '../features/fuzz.js';
import * as mitm from '../features/mitm.js';
import { createHandlers as createXferHandlers, screenToLinesMasked } from '../features/transfer.js';

function buildTlsOptions(params, config) {
  const opts = { rejectUnauthorized: params.verifyTls ?? config.bridge.verifyTls };
  if (params.clientCert) opts.cert = fs.readFileSync(params.clientCert);
  if (params.clientKey)  opts.key  = fs.readFileSync(params.clientKey);
  if (params.caCert)     opts.ca   = fs.readFileSync(params.caCert);
  return opts;
}

export function createWsHandler({ config, logger, sessions, Ebcdic }) {
  const macroStore = new MacroStore();
  let nextId = 1;

  const xfer = createXferHandlers({ logger, send, Ebcdic });

  return function handleConnection(ws, req) {
    const wsId   = nextId++;
    const origin = req.socket.remoteAddress;
    logger.info(`[ws:${wsId}] Browser connected from ${origin}`);

    ws.once('message', rawMsg => {
      let params;
      try   { params = JSON.parse(rawMsg); }
      catch {
        send(ws, { type: 'error', message: 'Invalid connect payload — expected JSON' });
        ws.close(); return;
      }

      // ── SSH connect ──────────────────────────────────────────────
      if (params.type === 'ssh.connect') {
        handleSshConnect(ws, wsId, params, send, logger);
        return;
      }

      if (params.type !== 'connect') {
        send(ws, { type: 'error', message: `Expected type:"connect", got "${params.type}"` });
        ws.close(); return;
      }

      const { host, luName = null } = params;
      const port      = parseInt(params.port, 10) || 339;
      const useTls    = params.tls ?? (port === 992);
      const codepage  = params.codepage || config.defaults.codepage;
      const protocol  = (params.protocol || '3270').toLowerCase();

      if (!host) {
        send(ws, { type: 'error', message: 'Missing required field: host' });
        ws.close(); return;
      }

      send(ws, { type: 'status', state: 'connecting', host, port });

      // ── Create session (protocol-specific engine, shared event API) ──
      let session;
      const keepAliveSec = parseInt(params.keepAliveSec, 10) || 0;

      if (protocol === '5250') {
        const model = params.model || '3179-2';
        logger.info(`[ws:${wsId}] Connecting (TN5250) → ${host}:${port} tls=${useTls} devname=${luName||'any'} model=${model}`);
        session = new Tn5250Session({
          wsId, host, port, useTls, luName, model, codepage,
          user: params.user,
          keepAliveSec,
          tlsOptions: buildTlsOptions(params, config),
        });
      } else {
        const model = params.model || config.defaults.model;
        const useTn3270e = params.tn3270e ?? true;
        logger.info(`[ws:${wsId}] Connecting (TN3270) → ${host}:${port} tls=${useTls} tn3270e=${useTn3270e} lu=${luName||'any'} model=${model}`);
        session = new Tn3270Session({
          wsId, host, port, useTls, luName, model, codepage,
          useTn3270e,
          keepAliveSec,
          tlsOptions: buildTlsOptions(params, config),
        });
      }

      sessions.set(wsId, session);

      const macroHandler = new MacroHandler(session, ws, wsId, macroStore);
      CopilotHandler.sendProviderInfo(ws);

      // ── Session → Browser events ─────────────────────────────────
      session.on('connected', ({ tlsVersion } = {}) => {
        logger.info(`[ws:${wsId}] TCP connected to ${host}:${port}`);
        session.tlsVersion = tlsVersion || 'PLAIN';
        send(ws, { type: 'status', state: 'connected', host, port, lu: session.negotiatedLu, model: session.model, tlsVersion, wsId });
      });

      session.on('screen', screenData => {
        session.lastScreen = screenData;
        session.lastScreen.fields = screenData.fields || [];
        send(ws, { type: 'screen', ...screenData });
        logTraffic({
          ts: new Date().toISOString(),
          wsId,
          direction: 'host→client',
          aid: '',
          tls: session.tlsVersion || 'PLAIN',
          screenText: screenToLinesMasked(screenData).filter(l => l.trim()).join(' | ').substring(0, 300),
        });
        if (recordings.has(wsId)) {
          const rec = recordings.get(wsId);
          rec.events.push({ t: Date.now() - rec.start, dir: 'host→client', type: 'screen', data: screenData });
        }
      });

      session.on('raw', ({ dir, data }) => captureRaw(wsId, host, port, dir, data));

      session.on('oia',          oiaData => { send(ws, { type: 'oia', ...oiaData }); });
      session.on('lu',           lu      => { send(ws, { type: 'status', state: 'lu', lu }); });
      session.on('error',        err     => { logger.error(`[ws:${wsId}] Session error: ${err.message}`); send(ws, { type: 'error', message: err.message }); });
      session.on('disconnected', reason  => { logger.info(`[ws:${wsId}] Disconnected: ${reason}`); send(ws, { type: 'status', state: 'disconnected', reason }); });

      // ── IND$FILE events ──────────────────────────────────────────
      session.on('indfile-complete', info => {
        logTraffic({
          ts: new Date().toISOString(), wsId,
          direction: info.direction === 'download' ? 'host→client' : 'client→host',
          aid: 'IND$FILE',
          tls: session.tlsVersion || 'PLAIN',
          screenText: `IND$FILE ${info.direction}: ${info.bytes} bytes`,
        });
        if (info.direction === 'download') {
          const saveAs  = session._indFileSaveAs || 'transfer.bin';
          const encoded = info.data.toString('base64');
          send(ws, { type: 'xfer.data', data: encoded, saveAs, bytes: info.bytes });
          logger.info(`[ws:${wsId}] IND$FILE download complete: ${info.bytes} bytes → ${saveAs}`);
        } else {
          send(ws, { type: 'xfer.ok', message: `Upload complete (${info.bytes} bytes)` });
          logger.info(`[ws:${wsId}] IND$FILE upload complete: ${info.bytes} bytes`);
        }
        session._indFileSaveAs = null;
      });
      session.on('indfile-error',    info => { send(ws, { type: 'xfer.error', message: info.message }); });
      session.on('indfile-progress', info => { send(ws, { type: 'xfer.progress', direction: info.direction, bytes: info.bytes }); });

      // ── Browser → Session messages ───────────────────────────────
      ws.on('message', rawMsg => {
        let msg;
        try { msg = JSON.parse(rawMsg); } catch { return; }

        if (recordings.has(wsId) && (msg.type === 'key' || msg.type === 'type')) {
          const rec = recordings.get(wsId);
          rec.events.push({ t: Date.now() - rec.start, dir: 'client→host', type: msg.type, data: msg });
        }

        if (typeof msg.type === 'string' && msg.type.startsWith('macro.')) {
          macroHandler.handle(msg); return;
        }
        if (msg.type === 'copilot.chat' || msg.type === 'copilot.configure' || msg.type === 'copilot.list-models') {
          CopilotHandler.handle(msg, ws, wsId); return;
        }

        // ── Transfer messages ────────────────────────────────────
        if (msg.type === 'xfer.queue-upload')  { xfer.handleXferQueueUpload(msg, ws, wsId, session); return; }
        if (msg.type === 'xfer.download')      { xfer.handleXferDownload(msg, ws, wsId, session); return; }
        if (msg.type === 'xfer.tso-upload')    { xfer.handleXferTsoUpload(msg, ws, wsId, session); return; }
        if (msg.type === 'xfer.tso-download')  { xfer.handleXferTsoDownload(msg, ws, wsId, session); return; }
        if (msg.type === 'xfer.listdatasets')  { xfer.handleXferListDatasets(msg, ws, wsId, session); return; }
        if (msg.type === 'xfer.ensure-cms') {
          xfer.ensureCmsReady(session, ws, wsId)
            .then(() => send(ws, { type: 'xfer.cms-ready' }))
            .catch(err => send(ws, { type: 'xfer.error', message: err.message }));
          return;
        }

        macroHandler.interceptIfRecording(msg);

        switch (msg.type) {

          case 'key': {
            if (mitm.isEnabled(wsId)) {
              mitm.interceptKey(wsId, ws, session, msg, send, logger);
            } else {
              session.sendAid(msg.aid, (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : session.getModifiedFields());
              logTraffic({
                ts: new Date().toISOString(), wsId, direction: 'client→host', aid: msg.aid,
                tls: session.tlsVersion || 'PLAIN',
                screenText: session.lastScreen ? screenToLinesMasked(session.lastScreen).filter(l => l.trim()).join(' | ').substring(0, 300) : '',
              });
            }
            break;
          }

          case 'type':
            session.typeAt(msg.row, msg.col, msg.text);
            break;

          case 'cursor':
            session.moveCursor(msg.row, msg.col);
            break;

          case 'erase':
            session.eraseAt(msg.row, msg.col);
            break;

          case 'fillField':
            session.fillField(msg.row, msg.col, msg.text);
            break;

          case 'sec.patchFa':
            if (typeof msg.addr === 'number' && typeof msg.fa === 'number') {
              session.patchFieldAttr(msg.addr, msg.fa);
            }
            break;

          case 'sec.mitm.toggle':   mitm.toggle(wsId, ws, send, logger);   break;
          case 'sec.mitm.release':  mitm.release(wsId, ws, session, msg, send, logger, logTraffic);  break;
          case 'sec.mitm.drop':     mitm.drop(wsId, ws, send, logger);     break;
          case 'sec.mitm.replay':   mitm.replay(wsId, ws, session, send, logger, logTraffic);  break;

          case 'sec.fuzz':
            handleFuzz(msg, ws, wsId, session, send, logger);
            break;

          case 'sec.wireReplay':
            if (typeof msg.hex === 'string' && msg.hex.length) {
              logger.info(`[ws:${wsId}] Wire Inspector: replaying ${msg.hex.length / 2}B outbound record`);
              session.sendRawAid(Buffer.from(msg.hex, 'hex'));
              send(ws, { type: 'sec.wire.replayed', no: msg.no });
            }
            break;

          case 'disconnect':
            session.disconnect('client request');
            break;

          default:
            logger.warn(`[ws:${wsId}] Unknown message type: ${msg.type}`);
        }
      });

      ws.on('close', () => {
        logger.info(`[ws:${wsId}] Browser disconnected`);
        session.disconnect('browser closed');
        sessions.delete(wsId);
        mitm.cleanup(wsId);
      });

      ws.on('error', err => {
        logger.error(`[ws:${wsId}] WebSocket error: ${err.message}`);
      });

      session.connect();
    });
  };
}
