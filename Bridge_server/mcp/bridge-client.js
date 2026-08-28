// Thin client for the WebTerm/3270 bridge. Holds one WebSocket terminal
// session and talks to the bridge's HTTP routes for everything else. The MCP
// server (server.js) wraps this; nothing here is MCP-specific.

import { WebSocket } from 'ws';

const NONDISPLAY = '#';

export class BridgeClient {
  constructor({ bridgeUrl = 'ws://127.0.0.1:8081', macroRunKey = null } = {}) {
    this.bridgeUrl = bridgeUrl.replace(/\/+$/, '');
    this.httpBase = this.bridgeUrl.replace(/^ws/, 'http');
    this.macroRunKey = macroRunKey;

    this.ws = null;
    this.wsId = null;
    this.lastScreen = null;
    this.lastStatus = null;
    this.lastError = null;
    this._screenWaiters = [];
    this._macro = null; // { resolve, reject, progress: [] } while a macro.run is in flight
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && this.lastStatus?.state === 'connected';
  }

  // ── terminal session over WebSocket ──────────────────────────────────

  async connect(params) {
    if (this.ws) throw new Error('already connected — call disconnect first');
    const frame = {
      type: 'connect',
      host: params.host,
      port: params.port ?? 23,
      tls: params.tls,
      protocol: params.protocol || '3270',
      model: params.model,
      luName: params.luName ?? null,
      tn3270e: params.tn3270e ?? true,
      codepage: params.codepage,
    };
    if (!frame.host) throw new Error('connect needs a host');

    this.ws = new WebSocket(this.bridgeUrl);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', raw => this._onMessage(raw));
    this.ws.on('close', () => { this.wsId = null; this.lastStatus = { state: 'disconnected' }; });

    const firstScreen = this._nextScreen(params.timeoutMs ?? 12000);
    this.ws.send(JSON.stringify(frame));
    const screen = await firstScreen;
    return { wsId: this.wsId, screen: this.formatScreen(screen) };
  }

  async disconnect() {
    if (!this.ws) return;
    try { this.ws.send(JSON.stringify({ type: 'disconnect' })); } catch { /* already gone */ }
    await new Promise(r => setTimeout(r, 100));
    try { this.ws.close(); } catch { /* ignore */ }
    this.ws = null;
    this.wsId = null;
  }

  _requireSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('no terminal session — call connect_lpar first');
    }
  }

  async typeAt(row, col, text) {
    this._requireSession();
    this.ws.send(JSON.stringify({ type: 'type', row, col, text }));
  }

  async sendAid(aid, fields = []) {
    this._requireSession();
    const next = this._nextScreen(8000);
    this.ws.send(JSON.stringify({ type: 'key', aid, fields }));
    const screen = await next.catch(() => this.lastScreen);
    return this.formatScreen(screen);
  }

  async runMacroWs(name, vars = {}) {
    this._requireSession();
    if (this._macro) throw new Error('a macro is already running');
    return new Promise((resolve, reject) => {
      this._macro = { resolve, reject, progress: [], vars };
      const timer = setTimeout(() => {
        if (this._macro) { const m = this._macro; this._macro = null; m.reject(new Error('macro timed out')); }
      }, 120000);
      this._macro._timer = timer;
      this.ws.send(JSON.stringify({ type: 'macro.run', name }));
    });
  }

  currentScreen() {
    return this.lastScreen ? this.formatScreen(this.lastScreen) : null;
  }

  _nextScreen(timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        this._screenWaiters = this._screenWaiters.filter(x => x !== w);
        reject(new Error('screen timeout'));
      }, timeoutMs);
      this._screenWaiters.push(w);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'status':
        this.lastStatus = msg;
        if (msg.wsId !== undefined) this.wsId = msg.wsId;
        break;
      case 'screen': {
        this.lastScreen = msg;
        const waiters = this._screenWaiters;
        this._screenWaiters = [];
        for (const w of waiters) { clearTimeout(w.timer); w.resolve(msg); }
        break;
      }
      case 'error':
        this.lastError = msg.message;
        break;
      case 'esm.fingerprint':
        this.lastEsm = msg;
        break;
      case 'macro.progress':
        if (this._macro) this._macro.progress.push(`${msg.step + 1}/${msg.total}`);
        break;
      case 'macro.prompt':
        if (this._macro) {
          const v = this._macro.vars?.[msg.var];
          if (v !== undefined) this.ws.send(JSON.stringify({ type: 'macro.prompt.response', var: msg.var, value: v }));
          else this._finishMacro(null, new Error(`macro needs a value for "${msg.var}" — pass it in vars`));
        }
        break;
      case 'macro.completed':
        this._finishMacro({ status: 'completed', progress: this._macro?.progress ?? [] });
        break;
      case 'macro.failed':
        this._finishMacro(null, new Error(`macro "${msg.name}" failed at step ${msg.step + 1}: ${msg.error}`));
        break;
    }
  }

  _finishMacro(result, err) {
    if (!this._macro) return;
    clearTimeout(this._macro._timer);
    const m = this._macro;
    this._macro = null;
    if (err) m.reject(err);
    else m.resolve({ ...result, screen: this.currentScreen() });
  }

  // ── HTTP routes ─────────────────────────────────────────────────────

  async http(path, { method = 'GET', body = null, headers = {} } = {}) {
    const res = await fetch(this.httpBase + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    return json;
  }

  listProfiles()      { return this.http('/api/profiles'); }
  getNegotiation()    { return this.http('/api/negotiate'); }
  getTraffic(limit)   { return this.http('/api/traffic').then(t => (limit ? t.slice(-limit) : t)); }
  getWire()           { return this.http('/api/wire'); }
  getEsmFingerprint() { return this.http('/api/esm-fingerprint'); }
  listMacros()        { return this.http('/api/macros'); }

  runMacroHeadless(body) {
    if (!this.macroRunKey) throw new Error('run_macro_headless needs MACRO_RUN_API_KEY');
    return this.http('/api/macro-run', { method: 'POST', body, headers: { 'X-Macro-Run-Key': this.macroRunKey } });
  }

  startRecording() {
    if (!this.wsId) throw new Error('no session to record');
    return this.http(`/api/recording/start?session=${this.wsId}`, { method: 'POST' });
  }
  stopRecording() {
    if (!this.wsId) throw new Error('no session recording');
    return this.http(`/api/recording/stop?session=${this.wsId}`, { method: 'POST' });
  }

  // ── screen formatting ──────────────────────────────────────────────

  formatScreen(screen) {
    if (!screen || !screen.rows) return null;
    const cols = screen.cols || 80;
    const text = screen.rows.map(row =>
      row.map(c => {
        if (c.nondisplay && c.char && c.char !== ' ') return NONDISPLAY;
        return c.char && c.char !== '\x00' ? c.char : ' ';
      }).join('').replace(/\s+$/, '')
    ).join('\n');

    const fields = (screen.fields || []).map(f => {
      const dataAddr = (f.startAddr + 1);
      return {
        row: Math.floor(dataAddr / cols),
        col: dataAddr % cols,
        protected: !!f.protected,
        numeric: !!f.numeric,
        nondisplay: !!f.nondisplay,
        mdt: !!f.modified,
        content: f.nondisplay ? NONDISPLAY.repeat((f.content || '').trim().length) : (f.content || '').replace(/\s+$/, ''),
      };
    });

    return {
      text,
      cursor: { row: screen.cursorRow ?? 0, col: screen.cursorCol ?? 0 },
      size: { rows: screen.numRows ?? screen.rows.length, cols },
      fields,
      anomalies: screen.anomalies || [],
    };
  }
}
