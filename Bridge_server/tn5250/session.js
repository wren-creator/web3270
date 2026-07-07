/**
 * tn5250/session.js
 * ─────────────────────────────────────────────────────────────────
 * Manages one TCP connection to an AS/400 (IBM i) TN5250 host.
 * Handles:
 *   • Telnet option negotiation (DO/DONT/WILL/WONT) — shared framing
 *     with TN3270E (RFC 854/885), verified against tn3270/session.js
 *   • TN5250 negotiation: TERMINAL-TYPE (classic, RFC 1091) + NEW-ENVIRON
 *     (RFC 1572) instead of TN3270E's DEVICE-TYPE subnegotiation
 *   • 5250 Write-to-Display datastream parsing → screen model
 *   • AID key transmission (ENTER, PFn, PAn, CLEAR, SYSREQ, ROLL)
 *   • Cursor tracking, default (24x80) vs alternate screen geometry
 *
 * Protocol references (byte-level values verified against the
 * open-source tn5250 project's lib5250, not hand-recalled from memory —
 * see codes5250.h, telnetstr.c, wtd.c, session.c, field.h):
 *   RFC 1205  — 5250 Telnet Interface
 *   RFC 2877  — 5250 Telnet Enhancements
 *   RFC 4777  — IBM's iSeries Telnet Enhancements (NEW-ENVIRON based)
 *   IBM SC30-3533 — 5494 Remote Control Unit Functions Reference
 *     (5250 Data Stream chapters)
 *
 * NOT yet implemented (logged and skipped rather than guessed):
 *   • Write Extended Attribute (WEA), Move Cursor (MC) orders
 *   • Write to Display Structured Field (WDSF) — GUI windows/scrollbars
 *   • Write Structured Field query/response (5250 QUERY)
 *   • IND$FILE-equivalent file transfer
 * These are rare on a plain 5250 signon/menu screen; add as needed.
 */

import net from 'net';
import tls from 'tls';
import { EventEmitter } from 'events';
import * as Ebcdic from '../tn3270/ebcdic.js';
import logger from '../logger.cjs';
import config from '../config.js';

// ── Telnet constants (shared framing with TN3270E) ──────────────────
const IAC  = 0xFF;
const DONT = 0xFE;
const DO   = 0xFD;
const WONT = 0xFC;
const WILL = 0xFB;
const SB   = 0xFA;
const SE   = 0xF0;
const EOR  = 0xEF;
const NOP  = 0xF1;

// Telnet options used by TN5250 (RFC 4777)
const OPT_BINARY     = 0x00;
const OPT_TIMING     = 0x06;
const OPT_TTYPE      = 0x18;
const OPT_EOR        = 0x19;
const OPT_NEWENV     = 0x27; // 39 — RFC 1572

// NEW-ENVIRON sub-option codes (RFC 1572)
const ENV_IS      = 0x00;
const ENV_SEND    = 0x01;
const ENV_INFO    = 0x02;
const ENV_VAR     = 0x00;
const ENV_VALUE   = 0x01;
const ENV_ESC     = 0x02;
const ENV_USERVAR = 0x03;

// ── 5250 top-level commands (follow an ESC=0x04 byte in the stream) ──
const ESC = 0x04;
const CMD_CLEAR_UNIT           = 0x40; // default 24x80 screen
const CMD_CLEAR_UNIT_ALTERNATE = 0x20; // alternate (model) screen size
const CMD_CLEAR_FORMAT_TABLE   = 0x50;
const CMD_WRITE_TO_DISPLAY     = 0x11;
const CMD_WRITE_ERROR_CODE     = 0x21;
const CMD_READ_INPUT_FIELDS    = 0x42;
const CMD_READ_MDT_FIELDS      = 0x52;
const CMD_READ_MDT_FIELDS_ALT  = 0x82;
const CMD_READ_IMMEDIATE       = 0x72;
const CMD_WRITE_STRUCTURED_FIELD = 0xF3;

// ── WTD orders (appear within a Write to Display command body) ──────
const ORDER_SOH  = 0x01; // Start of Header
const ORDER_RA   = 0x02; // Repeat to Address
const ORDER_EA   = 0x03; // Erase to Address
const ORDER_SBA  = 0x11; // Set Buffer Address
const ORDER_WEA  = 0x12; // Write Extended Attribute (unimplemented)
const ORDER_IC   = 0x13; // Insert Cursor
const ORDER_MC   = 0x14; // Move Cursor (unimplemented)
const ORDER_WDSF = 0x15; // Write to Display Structured Field (unimplemented)
const ORDER_SF   = 0x1D; // Start of Field

// Field Format Word bits (byte 1) — c.f. field.h TN5250_FIELD_*
const FFW_BYPASS     = 0x2000; // protected / skip-on-tab
const FFW_MODIFIED   = 0x0800; // MDT
const FFW_TYPE_MASK  = 0x0700;
const FFW_NUM_ONLY   = 0x0300;
const FFW_DIGIT_ONLY = 0x0500;
const FFW_SIGNED_NUM = 0x0700;

// 5250 AID bytes (verified against lib5250/session.h)
const AIDS = {
  ENTER:  0xF1,
  HELP:   0xF3,
  PGUP:   0xF4, ROLLDN: 0xF4,
  PGDN:   0xF5, ROLLUP: 0xF5,
  PRINT:  0xF6,
  CLEAR:  0xBD,
  F1: 0x31, F2: 0x32, F3: 0x33, F4: 0x34, F5: 0x35, F6: 0x36,
  F7: 0x37, F8: 0x38, F9: 0x39, F10: 0x3A, F11: 0x3B, F12: 0x3C,
  F13: 0xB1, F14: 0xB2, F15: 0xB3, F16: 0xB4, F17: 0xB5, F18: 0xB6,
  F19: 0xB7, F20: 0xB8, F21: 0xB9, F22: 0xBA, F23: 0xBB, F24: 0xBC,
};
// PFn is the conventional cross-protocol alias for Fn.
for (let n = 1; n <= 24; n++) AIDS[`PF${n}`] = AIDS[`F${n}`];

// Every 5250 record — both directions — is wrapped in a fixed 10-byte
// GDS (General Data Stream) header, verified against lib5250/telnetstr.c
// telnet_stream_send_packet: [lenHi,lenLo, 0x12,0xA0, flowHi,flowLo,
// 4, flags, 0x00, opcode], where `length` in bytes 0-1 covers the header
// itself (data length + 10). This precedes the ESC-command datastream
// this file parses/builds — it is NOT part of that datastream.
const GDS_RECORD_TYPE_HI = 0x12;
const GDS_RECORD_TYPE_LO = 0xA0;
const FLOW_DISPLAY = 0x0000;
const OPCODE_PUT_GET = 3; // client's reply to a Read command

// Field attribute byte (color) — bits 0-2 always 001 (range 0x20-0x3F).
const ATTR = {
  GREEN: 0x20, WHITE: 0x22, NONDISPLAY: 0x27, RED: 0x28,
  TURQ: 0x30, YELLOW: 0x32, PINK: 0x38, BLUE: 0x3A,
};
const isAttrByte = b => (b & 0xE0) === 0x20;

function modelDimensions(model) {
  // 5250 device models and their alternate screen sizes.
  const map = {
    '3179-2':   { rows: 24, cols: 80  },
    '3180-2':   { rows: 27, cols: 132 },
    '3196-A1':  { rows: 24, cols: 80  },
    '3477-FC':  { rows: 27, cols: 132 },
    '3477-FG':  { rows: 27, cols: 132 },
    '5251-11':  { rows: 24, cols: 80  },
    '5291-1':   { rows: 24, cols: 80  },
    '5292-2':   { rows: 27, cols: 132 },
    '5555-C01': { rows: 27, cols: 132 },
  };
  return map[model] || { rows: 24, cols: 80 };
}

function newBuffer(rows, cols) {
  return Array.from({ length: rows * cols }, () => ({ char: 0x00, fa: undefined, modified: false }));
}

class Tn5250Session extends EventEmitter {
  constructor(opts) {
    super();
    this.wsId     = opts.wsId;
    this.host     = opts.host;
    this.port     = opts.port;
    this.useTls   = opts.useTls;
    this.deviceName = opts.luName || null; // 5250 calls this DEVNAME
    this.model    = opts.model || '3179-2';
    this.codepage = opts.codepage || 37;
    this.tlsOpts  = opts.tlsOptions || {};
    this.user     = opts.user || null;

    this._applyModel(this.model);

    this.cursorAddr = 0;
    this._pendingAnomalies = [];

    this.recvBuf = Buffer.alloc(0);
    this._currentRecord = null;

    // Datastream write position (moved by SBA / literals / RA / SF) —
    // kept distinct from the display cursor (cursorAddr), which only the
    // IC order repositions via _pendingInsert.
    this._writeAddr = 0;
    this._pendingInsert = null;

    // Negotiation state
    this._binaryUs = false;
    this._binaryThem = false;
    this._eorUs = false;
    this._eorThem = false;
    this._ttypeSent = false;
    this._newEnvSent = false;

    // 5250 read state — set by the last CMD_READ_* the host issued;
    // determines what sendAid() reports back.
    this.readOpcode = CMD_READ_INPUT_FIELDS;

    this.socket = null;
    this._destroyed = false;
  }

  // ── Public API ─────────────────────────────────────────────────

  connect() {
    const connectFn = this.useTls ? tls.connect : net.connect;
    const opts = {
      host: this.host,
      port: this.port,
      ...(this.useTls ? this.tlsOpts : {}),
    };

    this.socket = connectFn(opts, () => {
      logger.debug(`[ws:${this.wsId}] TN5250 TCP socket open`);
      const tlsVersion = this.useTls ? (this.socket.getProtocol?.() || 'TLS') : 'PLAIN';
      this.emit('connected', { tlsVersion });
    });

    this.socket.on('data', chunk => this._onData(chunk));
    this.socket.on('error', err => { this.emit('error', err); this._cleanup(); });
    this.socket.on('close', () => { this.emit('disconnected', 'tcp close'); this._cleanup(); });
    this.socket.setTimeout(config.bridge.socketTimeoutMs, () => {
      this.emit('error', new Error('Socket timeout'));
      this._cleanup();
    });
  }

  disconnect(reason = 'client') {
    if (this._destroyed) return;
    this._destroyed = true;
    this._cleanup();
    this.emit('disconnected', reason);
  }

  /**
   * Transmit an AID key with the current field contents.
   * fields: [{ addr: bufferAddr, data: 'ascii string' }]
   *
   * Per lib5250 session.c tn5250_session_send_fields: the response is
   * cursor row+1, cursor col+1 (raw bytes), THEN the AID byte — the
   * opposite order from 3270, which sends AID first. Field data is
   * appended as SBA(row+1,col+1) + EBCDIC bytes per modified field.
   */
  sendAid(aidName, fields = []) {
    const aidByte = AIDS[aidName.toUpperCase()] ?? AIDS.ENTER;
    const parts = [];

    parts.push(Buffer.from([
      Math.floor(this.cursorAddr / this.cols) + 1,
      (this.cursorAddr % this.cols) + 1,
      aidByte,
    ]));

    for (const f of fields) {
      const row = Math.floor(f.addr / this.cols) + 1;
      const col = (f.addr % this.cols) + 1;
      parts.push(Buffer.from([ORDER_SBA, row, col]));
      parts.push(Ebcdic.fromAscii(f.data, this.codepage));
    }

    const data = Buffer.concat(parts);
    logger.info(`[ws:${this.wsId}] ── AID outbound ─── aid=${aidName} (0x${aidByte.toString(16)}) cursor=row${Math.floor(this.cursorAddr/this.cols)+1},col${this.cursorAddr%this.cols+1} fields=${fields.length}`);
    this._sendDataRecord(data);
  }

  moveCursor(row, col) {
    this.cursorAddr = Math.min(row * this.cols + col, this.rows * this.cols - 1);
  }

  eraseAt(row, col) {
    let addr = row * this.cols + col;
    if (this.buffer[addr] && this.buffer[addr].fa !== undefined) addr++;
    if (this.buffer[addr] && this.buffer[addr].fa === undefined) {
      this.buffer[addr].char = 0x00;
      this.buffer[addr].modified = true;
    }
    this.cursorAddr = addr;
    this._emitScreen();
  }

  typeAt(row, col, text) {
    const addr = row * this.cols + col;
    const eb = Ebcdic.fromAscii(text, this.codepage);
    for (let i = 0; i < eb.length && addr + i < this.buffer.length; i++) {
      if (this.buffer[addr + i] && this.buffer[addr + i].fa === undefined) {
        this.buffer[addr + i].char = eb[i];
        this.buffer[addr + i].modified = true;
      }
    }
    this.cursorAddr = Math.min(addr + eb.length, this.rows * this.cols - 1);
    this._emitScreen();
  }

  // Security-panel FA mutation is 3270-specific (SFE color/highlight
  // pairs); 5250's attribute byte is a single color enum with no
  // equivalent live-mutation hook in this pass. Log and no-op rather
  // than silently pretend to support it.
  patchFieldAttr(addr) {
    logger.warn(`[ws:${this.wsId}] patchFieldAttr not supported on TN5250 sessions (addr=${addr})`);
  }

  getModifiedFields() {
    const fields = [];
    let current = null;
    for (let a = 0; a < this.buffer.length; a++) {
      const cell = this.buffer[a];
      if (!cell) continue;
      if (cell.fa !== undefined) {
        if (current && current.mdt && current.data.length > 0) fields.push(current);
        current = { addr: a + 1, data: '', mdt: !!(cell.ffw & FFW_MODIFIED), protected: !cell.hasFfw || !!(cell.ffw & FFW_BYPASS) };
      } else if (current && !current.protected) {
        if (cell.modified) current.mdt = true;
        if (cell.char) current.data += Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage);
      }
    }
    if (current && current.mdt && current.data.length > 0) fields.push(current);
    return fields;
  }

  // ── Model / geometry ──────────────────────────────────────────

  _applyModel(model) {
    this.model = model;
    const dims = modelDimensions(model);
    this.altRows = dims.rows;
    this.altCols = dims.cols;
    this.defRows = 24;
    this.defCols = 80;
    this._setActiveGeometry(this.defRows, this.defCols);
    logger.info(`[ws:${this.wsId}] 5250 model applied: ${model} (default 24x80, alternate ${this.altRows}x${this.altCols})`);
  }

  _setActiveGeometry(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    this.rows = rows;
    this.cols = cols;
    this.buffer = newBuffer(rows, cols);
    this.cursorAddr = 0;
    logger.info(`[ws:${this.wsId}] 5250 screen geometry → ${rows}x${cols}`);
  }

  // Clear Unit / Clear Unit Alternate: blank the whole display and reset
  // the write address. Unlike _setActiveGeometry this always clears, even
  // when the size is unchanged (e.g. signon → menu, both 24x80) — a
  // clear-unit is the host explicitly wiping the screen.
  _clearUnit(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.buffer = newBuffer(rows, cols);
    this._writeAddr = 0;
    this._pendingInsert = null;
    logger.info(`[ws:${this.wsId}] 5250 clear unit → ${rows}x${cols}`);
  }

  // ── Incoming data / telnet framing ───────────────────────────────
  // Identical byte-stuffing/EOR framing to tn3270/session.js — this
  // layer (RFC 854 + RFC 885) is shared between TN3270E and TN5250.

  _onData(chunk) {
    this.emit('raw', { dir: 'recv', data: chunk });
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    this._processBuffer();
  }

  _processBuffer() {
    let i = 0;
    while (i < this.recvBuf.length) {
      const b = this.recvBuf[i];

      if (b !== IAC) { this._accumRecord(b); i++; continue; }

      const cmd = this.recvBuf[i + 1];
      if (cmd === undefined) break;

      if (cmd === NOP) { i += 2; continue; }

      if (cmd === EOR) {
        i += 2;
        if (this._currentRecord && this._currentRecord.length > 0) {
          this._handle5250Record(Buffer.from(this._currentRecord));
          this._currentRecord = null;
        }
        continue;
      }

      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= this.recvBuf.length) break;
        const opt = this.recvBuf[i + 2];
        this._handleTelnetOption(cmd, opt);
        i += 3;
        continue;
      }

      if (cmd === SB) {
        const seIdx = this._findSE(i + 2);
        if (seIdx === -1) break;
        const subdata = this.recvBuf.slice(i + 2, seIdx);
        this._handleSubneg(subdata);
        i = seIdx + 2;
        continue;
      }

      if (cmd === IAC) { this._accumRecord(0xFF); i += 2; continue; }

      i += 2;
    }
    this.recvBuf = this.recvBuf.slice(i);
  }

  _accumRecord(byte) {
    if (!this._currentRecord) this._currentRecord = [];
    this._currentRecord.push(byte);
  }

  _findSE(start) {
    for (let i = start; i < this.recvBuf.length - 1; i++) {
      if (this.recvBuf[i] === IAC && this.recvBuf[i + 1] === SE) return i;
    }
    return -1;
  }

  // ── Telnet option negotiation (RFC 4777) ─────────────────────────
  // Recommended sequence: NEW-ENVIRON before TERMINAL-TYPE completes,
  // per RFC 4777 §3. We respond WILL to whatever the host DOes and let
  // the host drive the SB SEND requests.

  _handleTelnetOption(cmd, opt) {
    logger.debug(`[ws:${this.wsId}] 5250 Telnet ${cmd === DO ? 'DO' : cmd === DONT ? 'DONT' : cmd === WILL ? 'WILL' : 'WONT'} 0x${opt.toString(16)}`);

    if (opt === OPT_TTYPE) {
      if (cmd === DO) this._send(Buffer.from([IAC, WILL, OPT_TTYPE]));
      return;
    }
    if (opt === OPT_NEWENV) {
      if (cmd === DO) this._send(Buffer.from([IAC, WILL, OPT_NEWENV]));
      return;
    }
    if (opt === OPT_BINARY) {
      if (cmd === DO && !this._binaryUs) { this._binaryUs = true; this._send(Buffer.from([IAC, WILL, OPT_BINARY])); }
      if (cmd === WILL && !this._binaryThem) { this._binaryThem = true; this._send(Buffer.from([IAC, DO, OPT_BINARY])); }
      return;
    }
    if (opt === OPT_EOR) {
      if (cmd === DO && !this._eorUs) { this._eorUs = true; this._send(Buffer.from([IAC, WILL, OPT_EOR])); }
      if (cmd === WILL && !this._eorThem) { this._eorThem = true; this._send(Buffer.from([IAC, DO, OPT_EOR])); }
      return;
    }
    if (opt === OPT_TIMING) {
      if (cmd === DO) this._send(Buffer.from([IAC, WONT, OPT_TIMING]));
      return;
    }
    // Unknown option — decline politely.
    if (cmd === DO) this._send(Buffer.from([IAC, WONT, opt]));
    else if (cmd === WILL) this._send(Buffer.from([IAC, DONT, opt]));
  }

  _handleSubneg(data) {
    const opt = data[0];

    if (opt === OPT_TTYPE && data[1] === ENV_SEND) {
      const ttype = `IBM-${this.model}`;
      this._send(Buffer.from([IAC, SB, OPT_TTYPE, ENV_IS, ...Buffer.from(ttype), IAC, SE]));
      logger.info(`[ws:${this.wsId}] Sent TERMINAL-TYPE IS ${ttype}`);
      return;
    }

    if (opt === OPT_NEWENV && data[1] === ENV_SEND) {
      // Host is asking which vars we support / their values. Answer with
      // the vars RFC 4777 actually cares about: DEVNAME, CODEPAGE, USER.
      // (IBMRSEED — password-encryption challenge — is intentionally not
      // answered here; we don't support encrypted signon in this pass.)
      const parts = [IAC, SB, OPT_NEWENV, ENV_IS];
      const pushVar = (name, value) => {
        parts.push(ENV_VAR, ...Buffer.from(name));
        if (value != null) parts.push(ENV_VALUE, ...Buffer.from(String(value)));
      };
      if (this.deviceName) pushVar('DEVNAME', this.deviceName);
      pushVar('CODEPAGE', String(this.codepage).padStart(3, '0'));
      if (this.user) parts.push(ENV_USERVAR, ...Buffer.from('USER'), ENV_VALUE, ...Buffer.from(this.user));
      parts.push(IAC, SE);
      this._send(Buffer.from(parts));
      logger.info(`[ws:${this.wsId}] Sent NEW-ENVIRON IS (devname=${this.deviceName || 'any'})`);
      return;
    }
  }

  // ── 5250 datastream ────────────────────────────────────────────

  _handle5250Record(record) {
    // Strip the 10-byte GDS header (see GDS_RECORD_TYPE_* above). We
    // don't currently act on flowtype/flags/opcode, just skip past them.
    if (record.length < 10 || record[2] !== GDS_RECORD_TYPE_HI || record[3] !== GDS_RECORD_TYPE_LO) {
      logger.warn(`[ws:${this.wsId}] 5250 record missing/invalid GDS header — dropping (${record.length} bytes)`);
      return;
    }
    const bytes = record.slice(10);
    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] !== ESC) { i++; continue; } // shouldn't happen at top level
      const cmd = bytes[i + 1];
      i += 2;
      if (cmd === CMD_CLEAR_UNIT) {
        this._clearUnit(this.defRows, this.defCols);
      } else if (cmd === CMD_CLEAR_UNIT_ALTERNATE) {
        this._clearUnit(this.altRows, this.altCols);
        i++; // one reserved/filler byte follows per lib5250 wtd.c
      } else if (cmd === CMD_CLEAR_FORMAT_TABLE) {
        // no-op for our field model — fields are derived from the buffer
      } else if (cmd === CMD_WRITE_TO_DISPLAY) {
        i = this._processWriteToDisplay(bytes, i);
      } else if (cmd === CMD_READ_INPUT_FIELDS || cmd === CMD_READ_MDT_FIELDS ||
                 cmd === CMD_READ_MDT_FIELDS_ALT || cmd === CMD_READ_IMMEDIATE) {
        this.readOpcode = cmd;
        // Host is entering read-wait mode — wait for the user's AID key.
        this._applyPendingInsert();
        this._emitScreen();
        return;
      } else if (cmd === CMD_WRITE_STRUCTURED_FIELD) {
        logger.warn(`[ws:${this.wsId}] 5250 Write Structured Field received — not yet implemented, skipping record`);
        return;
      } else {
        logger.warn(`[ws:${this.wsId}] 5250 unhandled command 0x${cmd?.toString(16)} — skipping record`);
        return;
      }
    }
    this._applyPendingInsert();
    this._emitScreen();
  }

  // The IC order sets a pending insert position; the display cursor moves
  // there once the record is fully processed. Absent an IC, the cursor
  // keeps its prior spot (a bare Write-to-Display shouldn't move it).
  _applyPendingInsert() {
    if (this._pendingInsert !== null) {
      this.cursorAddr = this._pendingInsert;
      this._pendingInsert = null;
    }
  }

  _processWriteToDisplay(bytes, i) {
    // CC1, CC2 — control characters (keyboard lock state etc.); not
    // needed for rendering, just consume them.
    i += 2;

    // A 5250 terminal tracks TWO positions (verified against lib5250):
    //   • the WRITE address — where the next datastream byte lands, moved
    //     by SBA and advanced by every literal character / RA / SF; and
    //   • the display CURSOR — where the user types, set ONLY by the IC
    //     order (as a "pending insert"). If IC never appears, the cursor
    //     keeps its prior position.
    // Conflating the two lets literal writes drag the cursor to the tail
    // of whatever text was written last (e.g. the copyright line), which
    // is exactly the "cursor not in the User field" symptom.
    while (i < bytes.length) {
      const b = bytes[i];

      if (b === ESC) break; // next top-level command begins

      if (b === ORDER_SOH) {
        const len = bytes[i + 1];
        i += 2 + len; // skip header bytes — cursor-position-on-error etc.
        continue;
      }

      if (b === ORDER_SBA) {
        const row = bytes[i + 1] - 1;
        const col = bytes[i + 2] - 1;
        this._writeAddr = Math.max(0, Math.min(row * this.cols + col, this.rows * this.cols - 1));
        i += 3;
        continue;
      }

      if (b === ORDER_IC) {
        const row = bytes[i + 1] - 1;
        const col = bytes[i + 2] - 1;
        this._pendingInsert = Math.max(0, Math.min(row * this.cols + col, this.rows * this.cols - 1));
        i += 3;
        continue;
      }

      if (b === ORDER_RA) {
        const row = bytes[i + 1] - 1;
        const col = bytes[i + 2] - 1;
        const toAddr = Math.max(0, Math.min(row * this.cols + col, this.rows * this.cols - 1));
        const ch = bytes[i + 3];
        i += 4;
        let addr = this._writeAddr ?? 0;
        while (addr <= toAddr && addr < this.buffer.length) {
          this.buffer[addr] = { char: ch, fa: undefined, modified: false };
          addr++;
        }
        this._writeAddr = addr;
        continue;
      }

      if (b === ORDER_EA) {
        const row = bytes[i + 1] - 1;
        const col = bytes[i + 2] - 1;
        const toAddr = Math.max(0, Math.min(row * this.cols + col, this.rows * this.cols - 1));
        i += 3;
        for (let a = this._writeAddr; a <= toAddr && a < this.buffer.length; a++) {
          this.buffer[a] = { char: 0x00, fa: undefined, modified: false };
        }
        continue;
      }

      if (b === ORDER_SF) {
        i = this._parseStartOfField(bytes, i + 1);
        continue;
      }

      if (b === ORDER_WEA || b === ORDER_MC || b === ORDER_WDSF) {
        logger.warn(`[ws:${this.wsId}] 5250 order 0x${b.toString(16)} not yet implemented — screen may render incompletely`);
        // These orders have variable-length arguments we don't parse yet;
        // bail out of this WTD command rather than misinterpret trailing
        // bytes as literal text.
        return bytes.length;
      }

      // Not a recognized order byte — literal EBCDIC display data.
      if (this.buffer[this._writeAddr]) {
        this.buffer[this._writeAddr] = { char: b, fa: undefined, modified: false };
      }
      this._writeAddr = Math.min(this._writeAddr + 1, this.rows * this.cols - 1);
      i++;
    }

    return i;
  }

  /**
   * Parse a Start-of-Field order per lib5250 session.c
   * tn5250_session_start_of_field: peek one byte — if it already matches
   * the attribute-byte pattern (top 3 bits = 001), this is an output-only
   * field with no FFW and NO length — just the attribute byte, and
   * literal display data follows immediately. Otherwise (an input field)
   * read FFW (2 bytes), zero or more FCW pairs (2 bytes each) until an
   * attribute-byte-pattern byte is hit, then the attribute byte, THEN 2
   * length bytes — the length only exists for input fields.
   *
   * Verified against real output empirically: treating length as always
   * present ate the first 2 literal-text bytes after every output-only
   * field's attribute byte (every label rendered missing its first two
   * characters) until this was split on hasFfw.
   */
  _parseStartOfField(bytes, i) {
    let ffw = 0;
    let hasFfw = false;
    if (!isAttrByte(bytes[i])) {
      hasFfw = true;
      ffw = (bytes[i] << 8) | bytes[i + 1];
      i += 2;
      while (i < bytes.length && !isAttrByte(bytes[i])) {
        i += 2; // skip FCW pair
      }
    }
    const attr = bytes[i]; i += 1;
    let length = 0;
    if (hasFfw) {
      length = (bytes[i] << 8) | bytes[i + 1]; i += 2;
    }

    if (this.buffer[this._writeAddr] === undefined) this._writeAddr = 0;
    // hasFfw distinguishes "no FFW at all" (output-only, always protected)
    // from "FFW present with no bits set" (a genuine, if unusual, input
    // field) — ffw alone can't tell those apart since both are 0x0000.
    this.buffer[this._writeAddr] = { char: 0x00, fa: attr, ffw, hasFfw, modified: false };
    this._writeAddr = Math.min(this._writeAddr + 1, this.rows * this.cols - 1);

    // `length` is the field's data length; the actual field content
    // arrives as subsequent literal-data bytes in the same WTD command
    // (or via a later SBA + data), so we don't pre-fill it here.
    void length;
    return i;
  }

  // ── Screen emission ───────────────────────────────────────────
  // Matches the exact event shape tn3270/session.js emits so the
  // existing frontend rendering/macro/PCAP pipeline needs no changes.

  _emitScreen() {
    const rows = this._bufferToRows();
    const fields = this._extractFields();
    this.emit('screen', {
      rows,
      cols: this.cols,
      numRows: this.rows,
      cursorRow: Math.floor(this.cursorAddr / this.cols),
      cursorCol: this.cursorAddr % this.cols,
      fields,
      anomalies: this._pendingAnomalies.splice(0),
    });
  }

  _bufferToRows() {
    const rows = [];
    for (let r = 0; r < this.rows; r++) {
      const cells = [];
      for (let c = 0; c < this.cols; c++) {
        const addr = r * this.cols + c;
        const cell = this.buffer[addr] || { char: 0x00, fa: undefined, modified: false };
        cells.push({
          char: cell.char ? Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage) : ' ',
          fa: cell.fa,
          modified: cell.modified,
          nondisplay: cell.fa === ATTR.NONDISPLAY,
          color: 0x00,
          highlight: 0x00,
        });
      }
      rows.push(cells);
    }
    return rows;
  }

  _extractFields() {
    const fields = [];
    let current = null;
    for (let a = 0; a < this.buffer.length; a++) {
      const cell = this.buffer[a];
      if (!cell) continue;
      if (cell.fa !== undefined) {
        if (current) fields.push(current);
        current = {
          startAddr: a,
          fa: cell.fa,
          protected: !cell.hasFfw || !!(cell.ffw & FFW_BYPASS),
          numeric: !!(cell.ffw & (FFW_NUM_ONLY | FFW_DIGIT_ONLY | FFW_SIGNED_NUM)),
          modified: !!(cell.ffw & FFW_MODIFIED),
          nondisplay: cell.fa === ATTR.NONDISPLAY,
          content: '',
        };
      } else if (current) {
        if (cell.char) current.content += Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage);
      }
    }
    if (current) fields.push(current);
    return fields;
  }

  // ── Sending ────────────────────────────────────────────────────

  _sendDataRecord(data, opcode = OPCODE_PUT_GET) {
    const totalLen = data.length + 10;
    const header = Buffer.from([
      (totalLen >> 8) & 0xFF, totalLen & 0xFF,
      GDS_RECORD_TYPE_HI, GDS_RECORD_TYPE_LO,
      (FLOW_DISPLAY >> 8) & 0xFF, FLOW_DISPLAY & 0xFF,
      4,    // variable-portion length (self-inclusive)
      0x00, // flags
      0x00, // reserved
      opcode,
    ]);
    const payload = Buffer.concat([header, data]);

    // Escape IAC bytes anywhere in the record (header or data) and wrap
    // with IAC EOR — same framing rule as tn3270/session.js.
    const escaped = [];
    for (const b of payload) {
      escaped.push(b);
      if (b === IAC) escaped.push(IAC);
    }
    escaped.push(IAC, EOR);
    this._send(Buffer.from(escaped));
  }

  _send(buf) {
    if (!this.socket || this.socket.destroyed) return;
    this.emit('raw', { dir: 'sent', data: buf });
    this.socket.write(buf);
  }

  _cleanup() {
    if (this.socket) {
      this.socket.removeAllListeners();
      if (!this.socket.destroyed) this.socket.destroy();
    }
  }
}

export default Tn5250Session;
