/**
 * tn3270/session.js
 * ─────────────────────────────────────────────────────────────────
 * Manages one TCP connection to a mainframe TN3270(E) host.
 * Handles:
 *   • Telnet option negotiation (DO/DONT/WILL/WONT)
 *   • TN3270E sub-negotiation (device-type, connect, LU binding)
 *   • 3270 datastream parsing → screen model
 *   • AID key transmission (ENTER, PFn, PAn, CLEAR, SYSREQ)
 *   • Cursor tracking
 *
 * Protocol references:
 *   RFC 1576  — TN3270
 *   RFC 2355  — TN3270E
 *   IBM GA23-0059 — 3270 Data Stream Programmer's Reference
 */

'use strict';

const net    = require('net');
const tls    = require('tls');
const { EventEmitter } = require('events');
const Ebcdic = require('./ebcdic');
const logger = require('../logger');

// ── Telnet constants ───────────────────────────────────────────────
const IAC  = 0xFF;
const DONT = 0xFE;
const DO   = 0xFD;
const WONT = 0xFC;
const WILL = 0xFB;
const SB   = 0xFA;  // start subnegotiation
const SE   = 0xF0;  // end subnegotiation
const EOR  = 0xEF;  // end of record (marks end of 3270 data record)
const NOP  = 0xF1;

// Telnet options
const OPT_BINARY        = 0x00;
const OPT_EOR           = 0x19;
const OPT_TTYPE         = 0x18;
const OPT_TN3270E       = 0x28;

// TN3270E sub-option function codes
const TN3E_ASSOCIATE    = 0x00;
const TN3E_CONNECT      = 0x01;
const TN3E_DEVICE_TYPE  = 0x02;
const TN3E_FUNCTIONS    = 0x03;
const TN3E_IS           = 0x04;
const TN3E_REASON       = 0x05;
const TN3E_REJECT       = 0x06;
const TN3E_REQUEST      = 0x07;
const TN3E_SEND         = 0x08;

// 3270 AID bytes
const AIDS = {
  NONE:   0x60,
  ENTER:  0x7D,
  CLEAR:  0x6D,
  PA1:    0x6C,
  PA2:    0x6E,
  PA3:    0x6B,
  SYSREQ: 0xF0,
  PF1:    0xF1, PF2:  0xF2, PF3:  0xF3, PF4:  0xF4,
  PF5:    0xF5, PF6:  0xF6, PF7:  0xF7, PF8:  0xF8,
  PF9:    0xF9, PF10: 0x7A, PF11: 0x7B, PF12: 0x7C,
  PF13:   0xC1, PF14: 0xC2, PF15: 0xC3, PF16: 0xC4,
  PF17:   0xC5, PF18: 0xC6, PF19: 0xC7, PF20: 0xC8,
  PF21:   0xC9, PF22: 0x4A, PF23: 0x4B, PF24: 0x4C,
};

// 3270 orders
const ORDER_SF   = 0x1D;  // Start Field
const ORDER_SFE  = 0x29;  // Start Field Extended
const ORDER_SBA  = 0x11;  // Set Buffer Address
const ORDER_SA   = 0x28;  // Set Attribute
const ORDER_MF   = 0x2C;  // Modify Field
const ORDER_IC   = 0x13;  // Insert Cursor
const ORDER_PT   = 0x05;  // Program Tab
const ORDER_RA   = 0x3C;  // Repeat to Address
const ORDER_EUA  = 0x12;  // Erase Unprotected to Address
const ORDER_GE   = 0x08;  // Graphic Escape
const WCC_RESET  = 0x40;

// Field attribute bits (FA byte, EBCDIC encoded)
const FA_PROTECTED   = 0x20;
const FA_NUMERIC     = 0x10;
const FA_MDT         = 0x01;  // Modified Data Tag
const FA_INTENSITY   = 0x0C;  // 2-bit intensity field

class Tn3270Session extends EventEmitter {
  constructor(opts) {
    super();
    this.wsId      = opts.wsId;
    this.host      = opts.host;
    this.port      = opts.port;
    this.useTls    = opts.useTls;
    this.luName    = opts.luName;
    this.model     = opts.model || '3278-2';
    this.codepage  = opts.codepage || 37;
    this.tlsOpts   = opts.tlsOptions || {};
    // If false, refuse TN3270E — use classic TN3270 (required for z/VM)
    this.useTn3270e = opts.useTn3270e ?? true;

    // Determine screen dimensions from model
    const dims     = modelDimensions(this.model);
    this.rows      = dims.rows;
    this.cols      = dims.cols;

    // Screen buffer: array of {char, fa, color, highlight, protected}
    this.buffer    = newBuffer(this.rows, this.cols);
    this.cursorAddr = 0;

    // Telnet / TN3270E state
    this.tn3270eEnabled   = false;
    this.negotiatedLu     = null;
    this.recvBuf          = Buffer.alloc(0);

    // Negotiation flags
    this._willSend  = false;  // we've sent WILL TN3270E
    this._doSent    = false;  // host sent DO TN3270E

    this.socket    = null;
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
      logger.debug(`[ws:${this.wsId}] TCP socket open`);
      this.emit('connected');
      // Negotiation begins: host will send DO options
    });

    this.socket.on('data', chunk => this._onData(chunk));
    this.socket.on('error', err  => { this.emit('error', err); this._cleanup(); });
    this.socket.on('close', ()   => { this.emit('disconnected', 'tcp close'); this._cleanup(); });
    this.socket.setTimeout(config().bridge.socketTimeoutMs, () => {
      this.emit('error', new Error('Socket timeout'));
      this._cleanup();
    });
  }

  disconnect(reason = 'client') {
    if (this._destroyed) return;
    this._destroyed = true;
    logger.debug(`[ws:${this.wsId}] Disconnect: ${reason}`);
    this._cleanup();
    this.emit('disconnected', reason);
  }

  /**
   * Transmit an AID key with optional modified field data.
   * fields: [{ addr: bufferAddr, data: 'EBCDIC string' }]
   */
  sendAid(aidName, fields = []) {
    const aidByte = AIDS[aidName.toUpperCase()] ?? AIDS.ENTER;

    const parts = [Buffer.from([aidByte])];

    // Append cursor address (SBA + 2-byte buffer address)
    parts.push(this._encodeSBA(this.cursorAddr));

    // Append all modified fields
    for (const f of fields) {
      parts.push(this._encodeSBA(f.addr));
      parts.push(Ebcdic.fromAscii(f.data, this.codepage));
    }

    const data = Buffer.concat(parts);
    this._sendDataRecord(data);
    logger.debug(`[ws:${this.wsId}] AID ${aidName} sent (${fields.length} fields)`);
  }

  typeAt(row, col, text) {
    const addr = row * this.cols + col;
    const eb = Ebcdic.fromAscii(text, this.codepage);
    for (let i = 0; i < eb.length && addr + i < this.buffer.length; i++) {
       	if (this.buffer[addr + i]) {
      this.buffer[addr + i].char = eb[i];
      this.buffer[addr + i].modified = true;
	}
    }
  }

  moveCursor(row, col) {
    this.cursorAddr = Math.min(row * this.cols + col, this.rows * this.cols - 1);
  }

  // ── Incoming data handling ─────────────────────────────────────

  _onData(chunk) {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    this._processBuffer();
  }

  _processBuffer() {
    let i = 0;
    while (i < this.recvBuf.length) {
      const b = this.recvBuf[i];

      // Non-IAC byte — accumulate into the current 3270 data record
      if (b !== IAC) {
        this._accumRecord(b);
        i++;
        continue;
      }

      // IAC — need at least one more byte
      const cmd = this.recvBuf[i + 1];
      if (cmd === undefined) break; // wait for more data

      if (cmd === NOP) { i += 2; continue; }

      if (cmd === EOR) {
        // End of 3270 data record — process it
        i += 2;
        if (this._currentRecord && this._currentRecord.length > 0) {
          this._handle3270Record(Buffer.from(this._currentRecord));
          this._currentRecord = null;
        }
        continue;
      }

      // DO / DONT / WILL / WONT — three-byte
      if ([DO, DONT, WILL, WONT].includes(cmd)) {
        if (i + 2 >= this.recvBuf.length) break;
        const opt = this.recvBuf[i + 2];
        this._handleTelnetOption(cmd, opt);
        i += 3;
        continue;
      }

      // Subnegotiation SB … IAC SE
      if (cmd === SB) {
        const seIdx = this._findSE(i + 2);
        if (seIdx === -1) break; // wait for more
        const subdata = this.recvBuf.slice(i + 2, seIdx);
        this._handleSubneg(subdata);
        i = seIdx + 2;
        continue;
      }

      // IAC IAC → escaped 0xFF data byte in record
      if (cmd === IAC) {
        this._accumRecord(0xFF);
        i += 2;
        continue;
      }

      i += 2; // unknown two-byte command, skip
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

  // ── Telnet option negotiation ──────────────────────────────────

  _handleTelnetOption(cmd, opt) {
    logger.debug(`[ws:${this.wsId}] Telnet ${cmdName(cmd)} ${optName(opt)}`);

    // 1. Terminal Type — must agree or host won't send the login screen
    if (opt === OPT_TTYPE) {
      if (cmd === DO) {
        this._send(Buffer.from([IAC, WILL, OPT_TTYPE]));
        logger.debug(`[ws:${this.wsId}] Sent WILL TTYPE`);
      }
      return;
    }

    // 2. TN3270E
    if (opt === OPT_TN3270E) {
      if (cmd === DO) {
        if (!this.useTn3270e) {
          logger.info(`[ws:${this.wsId}] TN3270E disabled — sending WONT TN3270E`);
          this._send(Buffer.from([IAC, WONT, OPT_TN3270E]));
          this._initClassicTn3270();
        } else {
          // Set tn3270eEnabled NOW so screen data arriving before FUNCTIONS IS is handled correctly
          this.tn3270eEnabled = true;
          this._send(Buffer.from([IAC, WILL, OPT_TN3270E]));
          this._sendTn3270eDeviceType();
        }
      } else if (cmd === DONT) {
        this._send(Buffer.from([IAC, WONT, OPT_TN3270E]));
        this._initClassicTn3270();
      }
      return;
    }

    // 3. Binary and EOR — required for 3270 data stream to flow
    if (opt === OPT_BINARY) {
      if (cmd === DO && !this._binaryNegotiated) {
        this._binaryNegotiated = true;
        this._send(Buffer.from([IAC, WILL, OPT_BINARY]));
      }
      if (cmd === WILL && !this._binaryDoSent) {
        this._binaryDoSent = true;
        this._send(Buffer.from([IAC, DO, OPT_BINARY]));
      }
      return;
    }

    if (opt === OPT_EOR) {
      if (cmd === DO && !this._eorNegotiated) {
        this._eorNegotiated = true;
        this._send(Buffer.from([IAC, WILL, OPT_EOR]));
      }
      if (cmd === WILL && !this._eorDoSent) {
        this._eorDoSent = true;
        this._send(Buffer.from([IAC, DO, OPT_EOR]));
      }
      return;
    }

    // Refuse anything else
    if (cmd === DO)   this._send(Buffer.from([IAC, WONT, opt]));
    if (cmd === WILL) this._send(Buffer.from([IAC, DONT, opt]));
  }

  _sendTn3270eDeviceType() {
    // SB TN3270E DEVICE-TYPE REQUEST IBM-model [CONNECT lu-name] IAC SE
    const deviceType = `IBM-${this.model}`;
    const parts = [IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_REQUEST,
                   ...Buffer.from(deviceType)];
    if (this.luName) {
      parts.push(TN3E_CONNECT, ...Buffer.from(this.luName));
    }
    parts.push(IAC, SE);
    this._send(Buffer.from(parts));
  }

  _initClassicTn3270() {
    logger.info(`[ws:${this.wsId}] Falling back to classic TN3270`);
    this.tn3270eEnabled = false;
  }

_handleSubneg(data) {
  logger.debug(`[ws:${this.wsId}] Subneg opt=0x${data[0].toString(16)} func=0x${(data[1]||0).toString(16)}`);
  const opt = data[0];
  if (opt === OPT_TN3270E) {
    const func = data[1];

    // Host is requesting our device type — send IS response
    if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REQUEST) {
      const deviceType = `IBM-${this.model}`;
      const response = [
        IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS,
        ...Buffer.from(deviceType),
      ];
      if (this.luName) {
        response.push(TN3E_CONNECT, ...Buffer.from(this.luName));
      }
      response.push(IAC, SE);
      this._send(Buffer.from(response));
      logger.debug(`[ws:${this.wsId}] Sent DEVICE-TYPE IS ${deviceType}`);
      return;
    }

    if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_IS) {
      // IS response: device-type confirmed, LU name follows CONNECT marker
      this.tn3270eEnabled = true;
      const connIdx = data.indexOf(TN3E_CONNECT, 3);
      if (connIdx !== -1) {
        this.negotiatedLu = data.slice(connIdx + 1).toString('ascii');
        logger.info(`[ws:${this.wsId}] TN3270E active, LU=${this.negotiatedLu}`);
      }
      // Request BIND-IMAGE and RESPONSES functions
      this._send(Buffer.from([
        IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST,
        0x00, 0x02,
        IAC, SE,
      ]));
    } else if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REJECT) {
      logger.warn(`[ws:${this.wsId}] TN3270E device-type rejected`);
      this._initClassicTn3270();
    } else if (func === TN3E_FUNCTIONS && data[2] === TN3E_IS) {
      logger.debug(`[ws:${this.wsId}] TN3270E functions negotiated`);
    }
  }

  if (opt === OPT_TTYPE && data[1] === TN3E_SEND /* 0x01 = SEND */) {
    // Host is asking for our terminal type — respond with IBM-model
    const ttype = `IBM-${this.model}`;
    const response = [
      IAC, SB, OPT_TTYPE, TN3E_IS,
      ...Buffer.from(ttype),
      IAC, SE,
    ];
    this._send(Buffer.from(response));
    logger.info(`[ws:${this.wsId}] Sent TTYPE IS ${ttype}`);
  }
}
  // ── 3270 datastream processing ─────────────────────────────────

  _handle3270Record(bytes) {
    if (this.tn3270eEnabled) {
      // TN3270E header is 5 bytes: data-type, request, response, seq(2)
      // data-type 0x00 = 3270-DATA, 0x05 = BIND-IMAGE, 0x06 = UNBIND
      const dataType = bytes[0];
      if (dataType !== 0x00) return; // ignore non-data records for now
      bytes = bytes.slice(5);
    }

    const cmd = bytes[0];

    if (cmd === 0xF5 || cmd === 0x7E) {
      // Write / Erase Write
      this._processWriteCommand(bytes.slice(1), cmd === 0x7E /* erase */);
    } else if (cmd === 0xF1) {
      // Write Structured Field
      this._processWriteStructuredField(bytes.slice(1));
    } else if (cmd === 0xF3) {
      // Erase All Unprotected
      this._eraseAllUnprotected();
    } else if (cmd === 0x6F) {
      // Read Buffer
      // (host polling — we respond with our buffer)
      this._sendReadBuffer();
    }
  }

  _processWriteCommand(data, erase) {
    if (erase) {
      this.buffer = newBuffer(this.rows, this.cols);
    }

    const wcc = data[0]; // Write Control Character
    if (wcc & WCC_RESET) {
      this._resetModifiedTags();
    }

    let addr = 0;
    let i = 1;

    while (i < data.length) {
      const b = data[i];

      if (b === ORDER_SF) {
        // Start Field — next byte is field attribute
        i++;
        const fa = data[i];
        this.buffer[addr] = { char: 0x00, fa, modified: false };
        addr = (addr + 1) % (this.rows * this.cols);
        i++;

      } else if (b === ORDER_SBA) {
        // Set Buffer Address — next 2 bytes encode the address
        i++;
        addr = decode3270Address(data[i], data[i + 1], this.cols);
        i += 2;

      } else if (b === ORDER_IC) {
        // Insert Cursor
        this.cursorAddr = addr;
        i++;

      } else if (b === ORDER_RA) {
        // Repeat to Address
        i++;
        const toAddr = decode3270Address(data[i], data[i + 1], this.cols);
        const charByte = data[i + 2];
        i += 3;
        while (addr !== toAddr) {
          this.buffer[addr].char = charByte;
          addr = (addr + 1) % (this.rows * this.cols);
        }

      } else if (b === ORDER_EUA) {
        // Erase Unprotected to Address
        i++;
        const toAddr = decode3270Address(data[i], data[i + 1], this.cols);
        i += 2;
        while (addr !== toAddr) {
          if (!this.buffer[addr].fa && !this._isProtected(addr)) {
            this.buffer[addr].char = 0x00;
          }
          addr = (addr + 1) % (this.rows * this.cols);
        }

      } else if (b === ORDER_PT) {
        // Program Tab — advance to next unprotected field
        i++;
        while (addr < this.rows * this.cols && !this._isFieldStart(addr)) addr++;

      } else if (b === ORDER_GE) {
        // Graphic Escape — next byte is a graphic character (skip for now)
        i += 2;

      } else if (b === ORDER_SFE || b === ORDER_SA || b === ORDER_MF) {
        // Extended orders with attribute pairs — currently skipped.
        // TODO: parse attribute pairs for color, highlighting, and extended field attrs.
        // Each pair is: type(1) + value(1). Needed for full 3279 color support.
        i++;
        const pairCount = data[i]; i++;
        i += pairCount * 2; // skip attribute type + value pairs

      } else {
        // Regular character — store in buffer
        this.buffer[addr] = this.buffer[addr] || {};
        this.buffer[addr].char = b;
        addr = (addr + 1) % (this.rows * this.cols);
        i++;
      }
    }

    this._emitScreen();
  }

_processWriteStructuredField(data) {
  let i = 0;
  while (i < data.length) {
    const len = (data[i] << 8) | data[i + 1];
    if (len === 0) break;
    const sfId = data[i + 2];

    // Query (0x01) — host is asking what we support, send Query Reply
    if (sfId === 0x01) {
      this._sendQueryReply();
    }

    i += len;
  }
}

_sendQueryReply() {
  // Minimal Query Reply — Summary saying we support only the basics
  const reply = Buffer.from([
    0x88,        // AID — structured field reply
    0x00, 0x00,  // cursor address (irrelevant)
    // Query Reply (Summary)
    0x00, 0x0E,  // length = 14
    0x81,        // Query Reply
    0x80,        // Summary
    0x80,        // Summary reply
    0x81, 0x84, 0x85, 0x86, 0x87, 0x88, 0x95, 0xA1,
    // Query Reply (Usable Area)
    0x00, 0x16,  // length = 22
    0x81,        // Query Reply
    0x01,        // Usable Area
    0x01,        // 12/14-bit addressing
    0x00,        // variable cells not supported
    0x00, 0x50,  // width = 80
    0x00, 0x18,  // height = 24
    0x01,        // units = mm
    0x00, 0x00, 0x06, 0x00,
    0x00, 0x00, 0x06, 0x00,
    0x00, 0x50,  // columns = 80
    0x00, 0x18,  // rows = 24
  ]);
  this._sendDataRecord(reply);
  logger.debug(`[ws:${this.wsId}] Sent Query Reply`);
}

 _eraseAllUnprotected() {
    for (let a = 0; a < this.buffer.length; a++) {
      if (!this._isProtected(a)) {
        this.buffer[a].char    = 0x00;
        this.buffer[a].modified = false;
      }
    }
    this._emitScreen();
  }

  _resetModifiedTags() {
    for (const cell of this.buffer) cell.modified = false;
  }

  _isProtected(addr) {
    // Walk back to find the most recent SF order
    for (let a = addr; a >= 0; a--) {
      if (this.buffer[a] && this.buffer[a].fa !== undefined) {
        return !!(this.buffer[a].fa & FA_PROTECTED);
      }
    }
    return false;
  }

  _isFieldStart(addr) {
    return this.buffer[addr] && this.buffer[addr].fa !== undefined;
  }

  // ── Screen emission ────────────────────────────────────────────

  _emitScreen() {
    const fields = this._extractFields();
    const rows   = this._bufferToRows();
    // ── DEBUG: row/field counts ──────────────────────────────────────
    const nonEmptyRows = rows.filter(cells => cells.map(c => c.char || ' ').join('').trim().length > 0);
    logger.debug(`[ws:${this.wsId}] _emitScreen → rows=${this.rows} nonEmptyRows=${nonEmptyRows.length} fields=${fields.length} (protected=${fields.filter(f=>f.protected).length} input=${fields.filter(f=>!f.protected).length})`);
    // ────────────────────────────────────────────────────────────────
    const nonEmpty = rows
      .map((cells, r) => ({ r, text: cells.map(c => c.char || ' ').join('') }))
      .filter(x => x.text.trim().length > 0);

    logger.info(`[ws:${this.wsId}] ── Screen ─── ${nonEmpty.length} rows  ${fields.length} fields  cursor=${Math.floor(this.cursorAddr/this.cols)+1}:${this.cursorAddr%this.cols+1}`);
    nonEmpty.forEach(({ r, text }) =>
      logger.info(`[ws:${this.wsId}]  ${String(r+1).padStart(2,'0')} │ ${text.substring(0,78)}`)
    );
    const inputFields = fields.filter(f => !f.protected);
    if (inputFields.length) {
      logger.info(`[ws:${this.wsId}] ── Input fields (${inputFields.length})`);
      inputFields.forEach((f, i) => {
        const row = Math.floor(f.startAddr / this.cols) + 1;
        const col = (f.startAddr % this.cols) + 1;
        logger.info(`[ws:${this.wsId}]   [${i}] row=${row} col=${col} content='${f.content.substring(0,40)}'`);
      });
    }
    logger.info(`[ws:${this.wsId}] ─────────────────────────────────────────────────`);

    this.emit('screen', {
      rows,
      cols: this.cols,
      numRows: this.rows,
      cursorRow: Math.floor(this.cursorAddr / this.cols),
      cursorCol: this.cursorAddr % this.cols,
      fields,
    });
  }

  _bufferToRows() {
    const rows = [];
    for (let r = 0; r < this.rows; r++) {
      const cells = [];
      for (let c = 0; c < this.cols; c++) {
        const cell = this.buffer[r * this.cols + c];
        cells.push({
          char: cell.char ? Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage) : ' ',
          fa:   cell.fa,
          modified: cell.modified,
        });
      }
      rows.push(cells);
    }
    return rows;
  }

  _extractFields() {
    const fields = [];
    let currentField = null;
    for (let a = 0; a < this.buffer.length; a++) {
      const cell = this.buffer[a];
      if (cell.fa !== undefined) {
        if (currentField) fields.push(currentField);
        currentField = {
          startAddr: a,
          fa: cell.fa,
          protected: !!(cell.fa & FA_PROTECTED),
          numeric:   !!(cell.fa & FA_NUMERIC),
          modified:  !!(cell.fa & FA_MDT),
          content:   '',
        };
      } else if (currentField) {
        if (cell.char) {
          currentField.content += Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage);
        }
      }
    }
    if (currentField) fields.push(currentField);
    return fields;
  }

  // ── Sending data ───────────────────────────────────────────────

  _sendDataRecord(data) {
    // Escape IAC bytes and wrap with IAC EOR
    const escaped = [];
    for (const b of data) {
      escaped.push(b);
      if (b === IAC) escaped.push(IAC); // escape
    }
    escaped.push(IAC, EOR);
    this._send(Buffer.from(escaped));
  }

  _encodeSBA(addr) {
    // Encode a buffer address using 12-bit or 14-bit encoding
    const hi = (addr >> 6) & 0x3F;
    const lo =  addr       & 0x3F;
    const code = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ @£$¥·←→↑↓';
    // Standard 6-bit encoding table (0x40-based):
    const encode6 = n => {
      if (n < 0x3F) return 0x40 + n;
      return 0xC0 + (n - 0x3F);
    };
    return Buffer.from([ORDER_SBA, encode6(hi), encode6(lo)]);
  }

  _sendReadBuffer() {
    // Not typically needed for emulator-initiated sessions but included for completeness
    logger.debug(`[ws:${this.wsId}] Read Buffer requested by host`);
  }

  _send(buf) {
    if (this.socket && !this._destroyed) {
      this.socket.write(buf);
    }
  }

  _cleanup() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────────

function decode3270Address(b1, b2, cols) {
  // 3270 uses a 6-bit encoding per byte; decode to a buffer offset
  const decode6 = b => {
    if (b >= 0x40 && b <= 0x7F) return b - 0x40;
    if (b >= 0xC0 && b <= 0xFF) return b - 0xC0 + 0x3F;
    return b & 0x3F;
  };
  return (decode6(b1) << 6) | decode6(b2);
}

function newBuffer(rows, cols) {
  return Array.from({ length: rows * cols }, () => ({ char: 0x00, fa: undefined, modified: false }));
}

function modelDimensions(model) {
  const map = {
    '3278-2': { rows: 24,  cols: 80  },
    '3278-3': { rows: 32,  cols: 80  },
    '3278-4': { rows: 43,  cols: 80  },
    '3278-5': { rows: 27,  cols: 132 },
    '3279-2': { rows: 24,  cols: 80  },
    '3279-5': { rows: 27,  cols: 132 },
  };
  return map[model] || { rows: 24, cols: 80 };
}

function cmdName(c) {
  return { [DO]:'DO',[DONT]:'DONT',[WILL]:'WILL',[WONT]:'WONT' }[c] || c;
}
function optName(o) {
  return { [OPT_BINARY]:'BINARY',[OPT_EOR]:'EOR',[OPT_TTYPE]:'TTYPE',[OPT_TN3270E]:'TN3270E' }[o] || `0x${o.toString(16)}`;
}

function config() { return require('../config'); }

module.exports = Tn3270Session;
