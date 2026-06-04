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
const FA_INTENSITY   = 0x0C;  // 2-bit intensity field (bits 3,2)

// Nondisplay is the intensity value 11 (both intensity bits set):
//   00 = normal display
//   01 = display, light-pen detectable
//   10 = intensified display, detectable
//   11 = nondisplay, nondetectable  ← passwords, hidden fields
const FA_NONDISPLAY  = 0x0C;
const isNonDisplayFa = fa => (fa & FA_INTENSITY) === FA_NONDISPLAY;

// 3270 12-bit buffer address encoding table (IBM GA23-0059).
// Maps 6-bit values 0-63 to their canonical EBCDIC code points.
// The pattern mirrors EBCDIC letter/digit ranges: values 1-9→0xC1-0xC9,
// 17-25→0xD1-0xD9, 33-41→0xE1-0xE9, 48-57→0xF0-0xF9, with the
// remaining values in the 0x4x-0x7x gaps.  Using raw 0x40+n is WRONG
// for about half the entries and produces bytes the host can't decode.
const ADDR12 = [
  0x40, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,  //  0- 7
  0xC8, 0xC9, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E, 0x4F,  //  8-15
  0x50, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,  // 16-23
  0xD8, 0xD9, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F,  // 24-31
  0x60, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7,  // 32-39
  0xE8, 0xE9, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,  // 40-47
  0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,  // 48-55
  0xF8, 0xF9, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F,  // 56-63
];

// Character used to mask nondisplay-field content in bridge logs.
// The frontend renders its own mask (configurable via the Show
// Passwords toggle); this constant is for logger output only and is
// never sent to the browser.
const MASK_CHAR = '#';

// ── IND$FILE file-transfer protocol (WSF type 0xD0) ─────────────
const INDFILE_TYPE = 0xD0;
const INDFILE_CHUNK = 2048;
const INDFILE_REC = {
  CONTENTS:   0x03,
  RECORDSIZE: 0x08,
  RECORDNUM:  0x63,
  ERROR:      0x69,
  DATA:       0xC0,
};
const INDFILE_ERR = { EOF: 0x2200, CANCEL: 0x4700 };

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
    //const dims     = modelDimensions(this.model);
    //this.rows      = dims.rows;
    //this.cols      = dims.cols;
    this.model = opts.model || '3278-2';
    this._applyModel(this.model);


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

    // IND$FILE transfer state
    this.indFile = {
      state: 'idle',
      direction: null,
      contents: null,
      uploadBuffer: null,
      uploadOffset: 0,
      downloadChunks: [],
      downloadBytes: 0,
      maxChunk: INDFILE_CHUNK,
    };
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

    // Append cursor address — RAW 2 bytes, NOT preceded by SBA order.
    // Per IBM 3270 Data Stream Programmer's Reference (GA23-0059):
    // "The Read Modified data stream begins with the AID byte, followed
    // by the address of the cursor (2 bytes, not preceded by an SBA
    // order), followed by the modified data fields (each preceded by an
    // SBA order)."
    parts.push(this._encodeAddrRaw(this.cursorAddr));

    // Tag each field with whether it lives inside a nondisplay
    // (password) field, by walking back to its controlling SF.
    // We do this here so the caller doesn't have to know — also so the
    // log-masking applies whether the data came from getModifiedFields
    // or from a script/macro.
    const decorated = fields.map(f => ({
      ...f,
      nondisplay: f.nondisplay ?? this._addrIsInNonDisplayField(f.addr),
    }));

    // Append all modified fields (these DO get SBA prefixes)
    for (const f of decorated) {
      parts.push(this._encodeSBA(f.addr));
      parts.push(Ebcdic.fromAscii(f.data, this.codepage));
    }

    const data = Buffer.concat(parts);

    // ── Detailed outbound diagnostic ──────────────────────────────
    // Always logged when investigating login/AID issues — comment out
    // once login flow is verified working. Nondisplay-field content is
    // ALWAYS masked here regardless of any client-side Show Passwords
    // toggle; the toggle only affects on-screen rendering.
    logger.info(`[ws:${this.wsId}] ── AID outbound ─── aid=${aidName} (0x${aidByte.toString(16)})  cursor=row${Math.floor(this.cursorAddr/this.cols)+1},col${this.cursorAddr%this.cols+1} (addr=${this.cursorAddr})`);
    for (const f of decorated) {
      const r = Math.floor(f.addr / this.cols) + 1;
      const c = (f.addr % this.cols) + 1;
      const safeData = f.nondisplay ? MASK_CHAR.repeat(f.data.length) : f.data;
      const ndTag    = f.nondisplay ? ' (nondisplay)' : '';
      logger.info(`[ws:${this.wsId}]   field @ addr=${f.addr} (row${r},col${c})  data="${safeData}"  len=${f.data.length}${ndTag}`);
    }
    logger.info(`[ws:${this.wsId}]   outbound bytes (${data.length}): ${this._maskOutboundHex(data, decorated)}`);

    this._sendDataRecord(data);
    logger.debug(`[ws:${this.wsId}] AID ${aidName} sent (${fields.length} fields)`);
  }

  /**
   * Build a hex representation of the AID outbound buffer with each
   * nondisplay field's EBCDIC data bytes replaced by '..' pairs. Layout
   * is fixed: AID(1) + cursorAddr(2) + repeating[ SBA(3) + data(N) ].
   */
  _maskOutboundHex(data, decoratedFields) {
    if (!decoratedFields.some(f => f.nondisplay)) {
      return data.toString('hex');
    }
    const parts = [];
    let pos = 0;
    // AID (1 byte) + cursor address (2 bytes)
    parts.push(data.slice(pos, pos + 3).toString('hex'));
    pos += 3;
    for (const f of decoratedFields) {
      const dataLen = Ebcdic.fromAscii(f.data, this.codepage).length;
      // SBA (3 bytes) — always shown
      parts.push(data.slice(pos, pos + 3).toString('hex'));
      pos += 3;
      // Field data — masked if nondisplay
      if (f.nondisplay) {
        parts.push('..'.repeat(dataLen));
      } else {
        parts.push(data.slice(pos, pos + dataLen).toString('hex'));
      }
      pos += dataLen;
    }
    return parts.join('') + '  [nondisplay masked]';
  }

  typeAt(row, col, text) {
   let addr = row * this.cols + col;

   // Skip past field attribute byte if cursor is on one
   if (this.buffer[addr] && this.buffer[addr].fa !== undefined) {
     addr++;
   }

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

  eraseAt(row, col) {
   let addr = row * this.cols + col;
   if (this.buffer[addr] && this.buffer[addr].fa !== undefined) addr++;
   if (this.buffer[addr] && this.buffer[addr].fa === undefined) {
     this.buffer[addr].char = 0x00;
     this.buffer[addr].modified = true;
   }
   this.cursorAddr = addr; // stay at same position, don't advance
   this._emitScreen();
  }

  getModifiedFields() {
   const fields = [];
   let isProtected = true;
   let isNonDisplayField = false;
   let fieldAddr = 0;
   let fieldData = '';
   let fieldMDT = false;

   for (let a = 0; a < this.buffer.length; a++) {
     const cell = this.buffer[a];
     if (!cell) continue;

     if (cell.fa !== undefined) {
       // Save previous unprotected field if MDT is set (either in FA byte
       // OR via our per-cell modified tracking) and it has content.
       if (!isProtected && fieldMDT && fieldData.length > 0) {
         fields.push({ addr: fieldAddr, data: fieldData, nondisplay: isNonDisplayField });
       }
       isProtected       = !!(cell.fa & FA_PROTECTED);
       isNonDisplayField = isNonDisplayFa(cell.fa);
       // MDT is authoritative from the FA byte; WCC_RESET clears per-cell
       // modified flags but does NOT clear the FA MDT bit.
       fieldMDT  = !!(cell.fa & FA_MDT);
       fieldAddr = a + 1;
       fieldData = '';
     } else if (!isProtected) {
       // Set MDT if user typed here (per-cell flag), even if FA hasn't been
       // updated yet.
       if (cell.modified) fieldMDT = true;

       if ((fieldMDT || cell.modified) && cell.char) {
         // Per-cell debug log: mask the byte for nondisplay fields so
         // passwords don't end up in docker compose logs.
         if (isNonDisplayField) {
           logger.debug(`[ws:${this.wsId}] getModifiedFields: addr=${a} char=** (nondisplay)`);
         } else {
           logger.debug(`[ws:${this.wsId}] getModifiedFields: addr=${a} char=0x${cell.char.toString(16)}`);
         }
         fieldData += Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage);
       }
     }
   }

   // Flush the last field — the loop only saves on SF transitions, so the
   // final field in the buffer would be dropped without this.
   if (!isProtected && fieldMDT && fieldData.length > 0) {
     fields.push({ addr: fieldAddr, data: fieldData, nondisplay: isNonDisplayField });
   }

   return fields;
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

  _applyModel(model) {
  this.model = model;

  const dims = modelDimensions(model);
  this.rows = dims.rows;
  this.cols = dims.cols;

  this.buffer = newBuffer(this.rows, this.cols);
  this.cursorAddr = 0;

  logger.info(
    `[ws:${this.wsId}] Model applied: ${model} (${this.rows}x${this.cols})`
  );
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
    this._applyModel(this.model);
  }

  _handleSubneg(data) {
  logger.debug(`[ws:${this.wsId}] Subneg opt=0x${data[0].toString(16)} func=0x${(data[1]||0).toString(16)}`);
  logger.debug(`[ws:${this.wsId}] TTYPE subneg raw bytes: ${data.toString('hex')}`);
  
  const opt = data[0];

  // Handle TN3270E (RFC 2355)
  if (opt === OPT_TN3270E) {
    const func = data[1];

    if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REQUEST) {
      const deviceType = `IBM-${this.model}`;
      const response = [IAC, SB, OPT_TN3270E, TN3E_DEVICE_TYPE, TN3E_IS, ...Buffer.from(deviceType)];
      if (this.luName) {
        response.push(TN3E_CONNECT, ...Buffer.from(this.luName));
      }
      response.push(IAC, SE);
      this._send(Buffer.from(response));
      logger.debug(`[ws:${this.wsId}] Sent DEVICE-TYPE IS ${deviceType}`);
      return; // Handled
    }

    if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_IS) {
      this.tn3270eEnabled = true;
      const connIdx = data.indexOf(TN3E_CONNECT, 3);
      if (connIdx !== -1) {
        this.negotiatedLu = data.slice(connIdx + 1).toString('ascii');
        logger.info(`[ws:${this.wsId}] TN3270E active, LU=${this.negotiatedLu}`);
      }
      this._send(Buffer.from([IAC, SB, OPT_TN3270E, TN3E_FUNCTIONS, TN3E_REQUEST, 0x00, 0x02, IAC, SE]));
      return;
    } 
    
    if (func === TN3E_DEVICE_TYPE && data[2] === TN3E_REJECT) {
      logger.warn(`[ws:${this.wsId}] TN3270E device-type rejected`);
      this._initClassicTn3270();
      return;
    } 
    
    if (func === TN3E_FUNCTIONS && data[2] === TN3E_IS) {
      logger.debug(`[ws:${this.wsId}] TN3270E functions negotiated`);
      return;
    }
  }

  // Handle Classic Terminal Type (RFC 1091)
  // Note: TN3E_SEND is 0x01, which is also the standard Telnet TTYPE SEND code
  if (opt === OPT_TTYPE && data[1] === 0x01) {
    const ttype = `IBM-${this.model}`;
    const response = [IAC, SB, OPT_TTYPE, 0x00, ...Buffer.from(ttype), IAC, SE];
    this._send(Buffer.from(response));
    logger.info(`[ws:${this.wsId}] Sent TTYPE IS ${ttype}`);
    logger.debug(`[ws:${this.wsId}] TTYPE response bytes: ${Buffer.from(response).toString('hex')}`);
  }
}
  // ── 3270 datastream processing ─────────────────────────────────

  _handle3270Record(bytes) {
    console.log(`>>>>> CANARY: new code running, _handle3270Record cmd=0x${bytes[0]?.toString(16)} tn3270e=${this.tn3270eEnabled} <<<<<`);
    logger.debug(`[ws:${this.wsId}] _handler3270Record: ${bytes.length} bytes, cmd=0x${bytes[0]?.toString(16)}`);
    logger.debug(`[ws:${this.wsId} _handle3270Record: first 10 bytes: ${bytes.slice(0,10).toString('hex')}`);
    // Full hex dump for parser diagnostics — enable with TN3270_HEXDUMP=1
    if (process.env.TN3270_HEXDUMP === '1' && bytes.length > 1) {
      const hex = bytes.toString('hex');
      const lines = [];
      for (let off = 0; off < hex.length; off += 64) {
        lines.push(`  ${(off/2).toString(16).padStart(4,'0')}: ${hex.slice(off, off + 64)}`);
      }
      logger.info(`[ws:${this.wsId}] ── 3270 record hexdump (${bytes.length} bytes, cmd=0x${bytes[0]?.toString(16)}) ──\n${lines.join('\n')}`);
    }
    if (this.tn3270eEnabled) {
      const dataType = bytes[0];

      // 0x05 = BIND-IMAGE (RFC 2355)
      if (dataType === 0x05) {
        const bindBytes = bytes.slice(5);
        const bindStr = bindBytes.toString('ascii');

       // Typical format: IBM-3278-x
       const match = bindStr.match(/IBM-3278-(\d)/);
        if (match) {
          const model = `3278-${match[1]}`;
          this._applyModel(model);
        }

        return; // BIND-IMAGE has no screen data
      }

      if (dataType !== 0x00) {
        return; // Ignore non-3270-DATA
      }

      bytes = bytes.slice(5); // Strip TN3270E header
    }

    const cmd = bytes[0];

    if (cmd === 0xF5 || cmd === 0x7E || cmd === 0x05 || cmd === 0x01 || cmd === 0xF1) {
      // Write / Erase Write family.
      // Erase commands: 0x05 (Erase Write), 0xF5 (SNA Erase Write),
      //                 0x7E (Erase Write Alternate, both encodings)
      // Plain Write: 0x01 (overlay, do NOT clear buffer)
      // 0xF1 is also documented as Write in some references.
      const erase = (cmd === 0x05 || cmd === 0xF5 || cmd === 0x7E);
      this._processWriteCommand(bytes.slice(1), erase);
    } else if (cmd === 0xF3) {
      // Erase All Unprotected
      this._eraseAllUnprotected();
    } else if (cmd === 0x6F) {
      // Read Buffer
      // (host polling — we respond with our buffer)
      this._sendReadBuffer();
    } else if (cmd === 0x02) {
      // Read Buffer — respond with current buffer contents
      logger.debug(`[ws:${this.wsId}] Read Buffer command received`);
      this._sendReadBuffer();
    } else if (cmd === 0x0D || cmd === 0x6E) {
      // Read Modified / Read Modified All — respond with AID + modified fields
      logger.debug(`[ws:${this.wsId}] Read Modified command received`);
      this._sendReadModified();

    } else if (cmd === 0x11) {
      // Write Structured Field (host → terminal).
      // Carries Query, ReadPartition, OutboundDS etc. We must reply with
      // a QueryReply or the host falls back to a degraded display mode.
      logger.debug(`[ws:${this.wsId}] Write Structured Field received`);
      this._processWriteStructuredField(bytes.slice(1));

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

      } else if (b === ORDER_SFE) {
        // Start Field Extended — like SF, but with attribute pairs.
        // Format: 0x29 <pairCount> <type> <value> <type> <value> ...
        // The pair with type=0xC0 carries the basic field attribute (FA byte
        // equivalent to what SF would set). At minimum we MUST create a field
        // at this address and advance addr by one cell — otherwise every
        // subsequent character lands one cell early per SFE encountered,
        // which produces the "starts in the middle of the screen" symptom.
        i++;
        const pairCount = data[i]; i++;
        let baseFa = 0x60; // default: protected, normal intensity
        for (let p = 0; p < pairCount; p++) {
          const type  = data[i];
          const value = data[i + 1];
          if (type === 0xC0) baseFa = value; // basic field attribute
          i += 2;
        }
        this.buffer[addr] = { char: 0x00, fa: baseFa, modified: false };
        addr = (addr + 1) % (this.rows * this.cols);

      } else if (b === ORDER_SA) {
        // Set Attribute — applies a single attribute to subsequent characters.
        // Format: 0x28 <type> <value>  (NO count byte, NO addr advance)
        i += 3;

      } else if (b === ORDER_MF) {
        // Modify Field — modifies attributes of the field at current addr.
        // Format: 0x2C <pairCount> <type> <value> ...
        // Current addr must point at an existing field attribute cell.
        i++;
        const pairCount = data[i]; i++;
        for (let p = 0; p < pairCount; p++) {
          const type  = data[i];
          const value = data[i + 1];
          if (type === 0xC0 && this.buffer[addr]) {
            this.buffer[addr].fa = value;
          }
          i += 2;
        }
        addr = (addr + 1) % (this.rows * this.cols);

      } else {
        // Regular character — store in buffer
        this.buffer[addr] = this.buffer[addr] || {};
        this.buffer[addr].char = b;
        addr = (addr + 1) % (this.rows * this.cols);
        i++;
      }
    }

    this._normalizeCursor();
    this._emitScreen();
  }

  _processWriteStructuredField(data) {
    logger.debug(`[ws:${this.wsId}] _processWSF: ${data.length} bytes, first 6: ${data.slice(0,6).toString('hex')}`);
    let i = 0;
    while (i + 2 < data.length) {
      const len = (data[i] << 8) | data[i + 1];
      if (len < 3 || i + len > data.length) {
        // Some hosts send a 0-length terminator, others use single-byte
        // structured fields. Stop cleanly rather than spamming warnings.
        if (len !== 0) {
          logger.warn(`[ws:${this.wsId}] WSF bad length ${len} at i=${i}, stopping`);
        }
        break;
      }
      const sfId = data[i + 2];
      logger.debug(`[ws:${this.wsId}] WSF field at i=${i} len=${len} sfId=0x${sfId.toString(16)}`);
      // 0x01 = Read Partition.  Inside it, byte[i+3]=partition ID, byte[i+4]=type.
      // Type 0x02 = Query.  Type 0x03 = QueryList.  We treat both the same way
      // (full QueryReply).  Some hosts send Read Partition with no partition
      // byte at all (length=3); we still respond.
      if (sfId === 0x01) {
        const type = data[i + 4];
        logger.info(`[ws:${this.wsId}] ReadPartition received (type=0x${type?.toString(16)}) — sending QueryReply`);
        this._sendQueryReply();
      } else if (sfId === INDFILE_TYPE) {
        // IND$FILE structured field — extract the body after sfId
        const sfBody = data.slice(i + 3, i + len);
        this._processIndFile(sfBody);
      }
      i += len;
    }
  }

  /**
   * Sends a structured field Query Reply telling the host our capabilities.
   *
   * Modeled after the QueryReply x3270 sends to BCBSSC's z/VM 7.3 host
   * (captured via packet trace), with dimensions adjusted to match our
   * current model. Lengths are computed from actual content so there's no
   * room for length/content mismatch.
   *
   * Declares: Summary, UsableArea, AlphanumericPartitions, CharacterSets,
   * Color, Highlighting, ReplyModes, DDM, RPQNames, ImplicitPartition.
   */
  _sendQueryReply() {
    const cols = this.cols;
    const rows = this.rows;
    const u16  = n => [(n >> 8) & 0xFF, n & 0xFF];

    // Each SF is built as a body array; we prepend a 2-byte length covering
    // the length field itself plus the body.
    const sf = body => [...u16(2 + body.length), ...body];

    const parts = [0x88]; // AID = Structured Field reply

    // Summary — lists which other QueryReplies follow
    parts.push(...sf([
      0x81, 0x80,
      0x80, 0x81, 0x84, 0x85, 0x86, 0x87, 0x88, 0x95, 0xA1, 0xA6
    ]));

    // UsableArea — screen geometry
    parts.push(...sf([
      0x81, 0x81,
      0x01, 0x00,                  // flags: 12/14-bit addressing
      ...u16(cols), ...u16(rows),  // width × height in chars
      0x01,                        // units = millimeters
      0x00, 0x0A, 0x02, 0xE5,      // Xr (X-units per AW)
      0x00, 0x02, 0x00, 0x6F,      // Yr (Y-units per AH)
      0x09, 0x0C,                  // AW = 9, AH = 12 (char-box units)
      ...u16(cols * rows),         // total buffer size
    ]));

    // AlphanumericPartitions — one partition, max size
    parts.push(...sf([
      0x81, 0x84,
      0x00,                        // NA = 0 partitions defined
      ...u16(cols * rows),         // M = max partition size
      0x00,                        // flags
    ]));

    // CharacterSets — EBCDIC codepage 037
    parts.push(...sf([
      0x81, 0x85,
      0x82, 0x00,                  // flags
      0x09, 0x0C,                  // SDW, SDH
      0x00, 0x00, 0x00, 0x00,      // formtype
      0x07,                        // length of descriptor
      0x00, 0x10, 0x00, 0x02, 0xB9, 0x00, 0x25,  // PS 0x00, CGCSGID 697
    ]));

    // Color — 16 pairs (default + 7 colors, doubled for compat)
    parts.push(...sf([
      0x81, 0x86,
      0x00,                        // flags
      0x10,                        // np = 16 pairs
      0x00, 0xF4, 0xF1, 0xF1, 0xF2, 0xF2, 0xF3, 0xF3,
      0xF4, 0xF4, 0xF5, 0xF5, 0xF6, 0xF6, 0xF7, 0xF7,
      0xF8, 0xF8, 0xF9, 0xF9, 0xFA, 0xFA, 0xFB, 0xFB,
      0xFC, 0xFC, 0xFD, 0xFD, 0xFE, 0xFE, 0xFF, 0xFF,
    ]));

    // Highlighting — 5 supported highlight modes
    parts.push(...sf([
      0x81, 0x87,
      0x05,                        // np = 5
      0x00, 0xF0,                  // default → default
      0xF1, 0xF1,                  // blink
      0xF2, 0xF2,                  // reverse video
      0xF4, 0xF4,                  // underscore
      0xF8, 0xF8,                  // intensify
    ]));

    // ReplyModes — field, extended-field, character
    parts.push(...sf([
      0x81, 0x88,
      0x00, 0x01, 0x02,
    ]));

    // DDM — 16384/16384 buffer limits
    parts.push(...sf([
      0x81, 0x95,
      0x00, 0x00,                  // flags
      0x40, 0x00,                  // INLIM = 16384
      0x40, 0x00,                  // OUTLIM = 16384
      0x01, 0x01,                  // NSS, DDMSS
    ]));

    // RPQNames — identify as 'web3270'
    const name = [0xA6, 0x85, 0x82, 0xF3, 0xF2, 0xF7, 0xF0]; // 'web3270' in EBCDIC
    parts.push(...sf([
      0x81, 0xA1,
      0x00, 0x00, 0x00, 0x00,      // device type
      0x00, 0x00, 0x00, 0x00, 0x00, // model number
      name.length,
      ...name,
    ]));

    // ImplicitPartition — default partition matches our screen
    parts.push(...sf([
      0x81, 0xA6,
      0x00, 0x00,                  // flags
      0x0B,                        // length of SDP
      0x01, 0x00,                  // SDP id, flags
      ...u16(80),  ...u16(24),     // default W × H (3278-2 baseline)
      ...u16(cols), ...u16(rows),  // alternate W × H (our actual model)
    ]));

    const buf = Buffer.from(parts);
    this._sendDataRecord(buf);
    logger.info(`[ws:${this.wsId}] Sent QueryReply (${buf.length} bytes) for ${this.model} (${cols}x${rows})`);
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

  /**
   * Walk back from addr to the controlling SF and check whether the field
   * is nondisplay (intensity bits 3,2 both set — used for passwords and
   * other hidden input).
   */
  _addrIsInNonDisplayField(addr) {
    for (let a = addr; a >= 0; a--) {
      const cell = this.buffer[a];
      if (cell && cell.fa !== undefined) {
        return isNonDisplayFa(cell.fa);
      }
    }
    return false;
  }

  /**
   * If the cursor sits on a field-attribute (SF) byte, advance to the
   * first content cell of that field. Real 3270 terminals do this on
   * keyboard restore — the SF byte isn't a typable position, so the
   * visible cursor must land just past it.
   *
   * Catches the z/VM CP-READ pattern where the host's IC lands on an
   * address that becomes an SF byte later in the same write record
   * (IC at X, then SBA X + SFE at X). The cursor was set before the SF
   * was placed; this fixes it up after the whole record is processed.
   */
  _normalizeCursor() {
    const max = this.rows * this.cols;
    let c = this.cursorAddr % max;  // PT can leave addr === max; wrap it
    for (let n = 0; n < max; n++) {
      const cell = this.buffer[c];
      if (cell && cell.fa !== undefined) {
        c = (c + 1) % max;
        continue;
      }
      break;
    }
    this.cursorAddr = c;
  }

  // ── Screen emission ────────────────────────────────────────────

  _emitScreen() {
  // ── DEBUG ──
  logger.debug(`[ws:${this.wsId}] _emitScreen called`);
    const fields = this._extractFields();
    const rows   = this._bufferToRows();
    // Per-row text for logging — substitute MASK_CHAR for any non-empty
    // cell that sits inside a nondisplay field so passwords don't appear
    // in the bridge log. Empty cells stay as spaces.
    const rowText = cells => cells.map(c => {
      if (c.nondisplay && c.char && c.char !== ' ') return MASK_CHAR;
      return c.char || ' ';
    }).join('');
    const nonEmpty = rows
      .map((cells, r) => ({ r, text: rowText(cells) }))
      .filter(x => x.text.trim().length > 0);
    // ── DEBUG: row/field counts ──────────────────────────────────────
    const nonEmptyRows = rows.filter(cells => rowText(cells).trim().length > 0);
    logger.debug(`[ws:${this.wsId}] _emitScreen → rows=${this.rows} nonEmptyRows=${nonEmptyRows.length} fields=${fields.length} (protected=${fields.filter(f=>f.protected).length} input=${fields.filter(f=>!f.protected).length})`);
    // ────────────────────────────────────────────────────────────────

    logger.info(`[ws:${this.wsId}] ── Screen ─── ${nonEmpty.length} rows  ${fields.length} fields  cursor=${Math.floor(this.cursorAddr/this.cols)+1}:${this.cursorAddr%this.cols+1}`);
    nonEmpty.forEach(({ r, text }) =>
      logger.info(`[ws:${this.wsId}]  ${String(r+1).padStart(2,'0')} │ ${text.substring(0, this.cols)}`)
    );
    const inputFields = fields.filter(f => !f.protected);
    if (inputFields.length) {
      logger.info(`[ws:${this.wsId}] ── Input fields (${inputFields.length})`);
      inputFields.forEach((f, i) => {
        const row = Math.floor(f.startAddr / this.cols) + 1;
        const col = (f.startAddr % this.cols) + 1;
        // Mask nondisplay content for the log; the raw value still rides
        // the screen event so the frontend can offer a Show Passwords
        // toggle, but bridge logs are masked unconditionally.
        const safeContent = f.nondisplay
          ? MASK_CHAR.repeat(f.content.length)
          : f.content;
        const ndTag = f.nondisplay ? ' (nondisplay)' : '';
        logger.info(`[ws:${this.wsId}]   [${i}] row=${row} col=${col} content='${safeContent.substring(0,40)}'${ndTag}`);
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
    // First pass: stamp each cell with the nondisplay flag of its
    // enclosing field. We track current state as we walk the entire
    // buffer (fields cross row boundaries).
    const len = this.buffer.length;
    const ndMap = new Array(len).fill(false);
    let currentND = false;
    for (let a = 0; a < len; a++) {
      const cell = this.buffer[a];
      if (cell && cell.fa !== undefined) {
        // SF byte itself is rendered as a space and doesn't need masking;
        // it also sets the state for following content cells.
        currentND = isNonDisplayFa(cell.fa);
        ndMap[a] = false;
      } else {
        ndMap[a] = currentND;
      }
    }

    const rows = [];
    for (let r = 0; r < this.rows; r++) {
      const cells = [];
      for (let c = 0; c < this.cols; c++) {
        const addr = r * this.cols + c;
        const cell = this.buffer[addr] || { char: 0x00, fa: undefined, modified: false };
        cells.push({
          char: cell.char ? Ebcdic.toAscii(Buffer.from([cell.char]), this.codepage) : ' ',
          fa:   cell.fa,
          modified: cell.modified,
          nondisplay: ndMap[addr],
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
    if (!cell) continue; // ← ADD THIS GUARD
    if (cell.fa !== undefined) {
      if (currentField) fields.push(currentField);
      currentField = {
        startAddr: a,
        fa: cell.fa,
        protected: !!(cell.fa & FA_PROTECTED),
        numeric: !!(cell.fa & FA_NUMERIC),
        modified: !!(cell.fa & FA_MDT),
        nondisplay: isNonDisplayFa(cell.fa),
        content: '',
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
    // Encode buffer address in 14-bit format (top 2 bits of byte 1 = 00),
    // preceded by the SBA order byte. 14-bit is unambiguous and universally
    // accepted; avoids the EBCDIC-table pitfalls of 12-bit encoding.
    return Buffer.from([ORDER_SBA, (addr >> 8) & 0x3F, addr & 0xFF]);
  }

  _encodeAddrRaw(addr) {
    // Encode buffer address in 14-bit format WITHOUT the SBA order prefix.
    // Used for the cursor address in AID responses, which per IBM 3270
    // spec is sent as raw bytes, not as an SBA order.
    return Buffer.from([(addr >> 8) & 0x3F, addr & 0xFF]);
  }

  _sendReadBuffer() {
    // Not typically needed for emulator-initiated sessions but included for completeness
    logger.debug(`[ws:${this.wsId}] Read Buffer requested by host`);
  }

  _sendReadModified() {
   // Respond with AID NONE + cursor address (no modified fields).
   // Cursor address is raw 2 bytes, not preceded by SBA — same rule as
   // the AID outbound in sendAid().
   const parts = [AIDS.NONE];
   parts.push(...this._encodeAddrRaw(this.cursorAddr));
   this._sendDataRecord(Buffer.from(parts));
   logger.debug(`[ws:${this.wsId}] Sent Read Modified response (AID NONE)`);
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

  // ── IND$FILE protocol engine ──────────────────────────────────────

  /**
   * Queue file data for the next IND$FILE PUT.
   * Call this BEFORE the user types the IND$FILE command.
   */
  indFileQueueUpload(buf) {
    this.indFile.uploadBuffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.indFile.uploadOffset = 0;
    logger.info(`[ws:${this.wsId}] IND$FILE: upload queued (${this.indFile.uploadBuffer.length} bytes)`);
  }

  _indFileReset() {
    this.indFile.state = 'idle';
    this.indFile.direction = null;
    this.indFile.contents = null;
    this.indFile.uploadBuffer = null;
    this.indFile.uploadOffset = 0;
    this.indFile.downloadChunks = [];
    this.indFile.downloadBytes = 0;
  }

  /**
   * Process an incoming IND$FILE structured field (body after the 0xD0 byte).
   * Format: RT ST [sub-records...]
   */
  _processIndFile(body) {
    if (body.length < 2) return;
    const rt = body[0], st = body[1];
    const records = this._indFileParseRecords(body, 2);
    logger.info(`[ws:${this.wsId}] IND$FILE: RT=0x${rt.toString(16)} ST=0x${st.toString(16)} records=${records.length} state=${this.indFile.state}`);

    if (rt === 0x00 && st === 0x12) {
      // OPEN — host is starting a transfer
      this._indFileOpen(records);
    } else if (rt === 0x41 && st === 0x12) {
      // CLOSE — host finished
      this._indFileClose();
    } else if (rt === 0x46 && (st === 0x11 || st === 0x05)) {
      // Upload request — host wants the next chunk
      this._indFileSendChunk(records);
    } else if (rt === 0x47 && st === 0x04) {
      // Download data — host is sending a chunk
      this._indFileReceiveChunk(records);
    } else {
      logger.warn(`[ws:${this.wsId}] IND$FILE: unhandled RT=0x${rt.toString(16)} ST=0x${st.toString(16)}`);
    }
  }

  _indFileOpen(records) {
    // Determine if this is a real data transfer or a status message
    const cr = records.find(r => r.tag === INDFILE_REC.CONTENTS);
    if (cr) {
      const text = cr.data.toString('ascii').trim();
      this.indFile.contents = text.includes('FT:DATA') ? 'data' : 'msg';
      logger.info(`[ws:${this.wsId}] IND$FILE OPEN: contents=${this.indFile.contents}`);
    } else {
      this.indFile.contents = 'data';
    }

    // Check for RecordSize (max chunk the host accepts)
    const rs = records.find(r => r.tag === INDFILE_REC.RECORDSIZE);
    if (rs && rs.data.length >= 2) {
      this.indFile.maxChunk = (rs.data[0] << 8) | rs.data[1];
      logger.debug(`[ws:${this.wsId}] IND$FILE: host max record size = ${this.indFile.maxChunk}`);
    }

    // Is this upload or download? If we have queued upload data, it's upload.
    if (this.indFile.uploadBuffer) {
      this.indFile.direction = 'upload';
      this.indFile.uploadOffset = 0;
    } else {
      this.indFile.direction = 'download';
      this.indFile.downloadChunks = [];
      this.indFile.downloadBytes = 0;
    }
    this.indFile.state = 'open';

    // ACK the OPEN: reply 00/09
    this._indFileSendReply(0x00, 0x09);
    logger.info(`[ws:${this.wsId}] IND$FILE: OPEN acknowledged, direction=${this.indFile.direction}`);
  }

  _indFileReceiveChunk(records) {
    const dr = records.find(r => r.tag === INDFILE_REC.DATA);
    if (!dr) return;

    // Check if compressed (byte 2 of header: 0x00=compressed, 0x61=uncompressed)
    if (dr.header && dr.header[2] === 0x00) {
      logger.warn(`[ws:${this.wsId}] IND$FILE: compressed data not supported`);
      this._indFileAbort(INDFILE_ERR.CANCEL);
      this.emit('indfile-error', { message: 'Compressed IND$FILE data not supported' });
      return;
    }

    if (this.indFile.contents === 'msg') {
      // Status message from host — accumulate and wait for CLOSE
      this.indFile.downloadChunks.push(dr.data);
      this.indFile.downloadBytes += dr.data.length;
    } else {
      this.indFile.downloadChunks.push(dr.data);
      this.indFile.downloadBytes += dr.data.length;
      this.indFile.state = 'transferring';
      this.emit('indfile-progress', { direction: 'download', bytes: this.indFile.downloadBytes });
    }

    // ACK with buffer number: reply 47/05 + RecordNumber
    const bufNum = this.indFile.downloadChunks.length;
    this._indFileSendReply(0x47, 0x05, this._indFileRecordNumber(bufNum));
    logger.debug(`[ws:${this.wsId}] IND$FILE: received chunk ${bufNum}, ${dr.data.length} bytes (total ${this.indFile.downloadBytes})`);
  }

  _indFileSendChunk(records) {
    if (!this.indFile.uploadBuffer) {
      logger.warn(`[ws:${this.wsId}] IND$FILE: host requested upload but no data queued`);
      this._indFileAbort(INDFILE_ERR.CANCEL);
      this.emit('indfile-error', { message: 'Host requested upload data but none was queued — select a file first' });
      return;
    }

    const remaining = this.indFile.uploadBuffer.length - this.indFile.uploadOffset;
    if (remaining <= 0) {
      // All data sent — signal EOF
      this._indFileSendReply(0x46, 0x08, this._indFileErrorRecord(INDFILE_ERR.EOF));
      logger.info(`[ws:${this.wsId}] IND$FILE: upload EOF sent (${this.indFile.uploadOffset} bytes total)`);
      return;
    }

    const chunkSize = Math.min(this.indFile.maxChunk, remaining);
    const chunk = this.indFile.uploadBuffer.slice(this.indFile.uploadOffset, this.indFile.uploadOffset + chunkSize);
    this.indFile.uploadOffset += chunkSize;
    this.indFile.state = 'transferring';
    this.emit('indfile-progress', { direction: 'upload', bytes: this.indFile.uploadOffset });

    // Reply 46/05 + RecordNumber + DataRecord
    const bufIdx = Math.ceil(this.indFile.uploadOffset / this.indFile.maxChunk);
    const rn = this._indFileRecordNumber(bufIdx);
    const dr = this._indFileDataRecord(chunk);
    const extra = Buffer.concat([rn, dr]);
    this._indFileSendReply(0x46, 0x05, extra);
    logger.debug(`[ws:${this.wsId}] IND$FILE: sent chunk ${bufIdx}, ${chunkSize} bytes (${this.indFile.uploadOffset}/${this.indFile.uploadBuffer.length})`);
  }

  _indFileClose() {
    const dir = this.indFile.direction;
    const wasMsg = this.indFile.contents === 'msg';

    // Always ACK the close: reply 41/09
    this._indFileSendReply(0x41, 0x09);
    logger.info(`[ws:${this.wsId}] IND$FILE: CLOSE acknowledged (direction=${dir}, contents=${this.indFile.contents})`);

    if (dir === 'download' && !wasMsg) {
      const data = Buffer.concat(this.indFile.downloadChunks);
      this.emit('indfile-complete', { direction: 'download', data, bytes: data.length });
    } else if (dir === 'download' && wasMsg) {
      const text = Buffer.concat(this.indFile.downloadChunks).toString('latin1');
      logger.info(`[ws:${this.wsId}] IND$FILE message: ${text}`);
      this.emit('indfile-error', { message: `IND$FILE: ${text}` });
    } else if (dir === 'upload') {
      this.emit('indfile-complete', { direction: 'upload', bytes: this.indFile.uploadOffset });
    }

    this._indFileReset();
  }

  _indFileAbort(errCode) {
    this._indFileSendReply(0x47, 0x08, this._indFileErrorRecord(errCode));
    this._indFileReset();
  }

  /**
   * Send an IND$FILE structured field reply.
   * Wire format: 88 LL LL D0 cmd subcmd [extra...]
   */
  _indFileSendReply(cmd, subcmd, extra) {
    const extraLen = extra ? extra.length : 0;
    const sfLen = 1 + 1 + 1 + extraLen;  // D0 + cmd + subcmd + extra
    const total = 1 + 2 + sfLen;          // AID + LL(2) + SF body
    const buf = Buffer.alloc(total);
    buf[0] = 0x88;                        // AID = Structured Field
    buf[1] = (sfLen + 2) >> 8;            // Length high (includes the 2 length bytes)
    buf[2] = (sfLen + 2) & 0xFF;          // Length low
    buf[3] = INDFILE_TYPE;                // 0xD0
    buf[4] = cmd;
    buf[5] = subcmd;
    if (extra) extra.copy(buf, 6);
    this._sendDataRecord(buf);
    logger.debug(`[ws:${this.wsId}] IND$FILE reply: cmd=0x${cmd.toString(16)} sub=0x${subcmd.toString(16)} ${total} bytes`);
  }

  _indFileRecordNumber(n) {
    const r = Buffer.alloc(6);
    r[0] = INDFILE_REC.RECORDNUM;
    r[1] = 6;
    r.writeUInt32BE(n, 2);
    return r;
  }

  _indFileErrorRecord(code) {
    const r = Buffer.alloc(4);
    r[0] = INDFILE_REC.ERROR;
    r[1] = 4;
    r.writeUInt16BE(code, 2);
    return r;
  }

  _indFileDataRecord(chunk) {
    const r = Buffer.alloc(5 + chunk.length);
    r[0] = INDFILE_REC.DATA;
    r[1] = 0x80;
    r[2] = 0x61;                          // uncompressed
    r.writeUInt16BE(5 + chunk.length, 3);  // total length incl header
    chunk.copy(r, 5);
    return r;
  }

  /**
   * Parse type-tagged sub-records from an IND$FILE SF body.
   */
  _indFileParseRecords(buf, offset) {
    const out = [];
    let p = offset;
    while (p < buf.length) {
      const tag = buf[p];
      if (tag === INDFILE_REC.DATA) {
        // DataRecord: C0 80 [00|61] totalLenHi totalLenLo data...
        if (p + 5 > buf.length) break;
        const totalLen = (buf[p + 3] << 8) | buf[p + 4];
        if (totalLen < 5 || p + totalLen > buf.length) break;
        out.push({ tag, header: buf.slice(p, p + 5), data: buf.slice(p + 5, p + totalLen) });
        p += totalLen;
      } else {
        // Generic record: tag len data...
        if (p + 1 >= buf.length) break;
        const len = buf[p + 1] || 2;
        if (p + len > buf.length) break;
        out.push({ tag, data: buf.slice(p + 2, p + len) });
        p += len;
      }
    }
    return out;
  }
}

// ── Utilities ──────────────────────────────────────────────────────

function decode3270Address(b1, b2, cols) {
  // 3270 buffer address encoding per IBM 3270 Data Stream Programmer's Reference:
  //   • b1 top 2 bits = 00 → 14-bit format: ((b1 & 0x3F) << 8) | b2
  //   • b1 top 2 bits = 01 / 10 / 11 → 12-bit format using low 6 bits of each byte
  // Hosts use 14-bit freely (not only for high addresses), so both branches matter.
  if ((b1 & 0xC0) === 0) {
    return ((b1 & 0x3F) << 8) | (b2 & 0xFF);
  }
  return ((b1 & 0x3F) << 6) | (b2 & 0x3F);
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
    '3178': { rows: 24,  cols: 80 }, // Standard 3178 is Model 2 equivalent
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
