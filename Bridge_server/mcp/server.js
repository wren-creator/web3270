#!/usr/bin/env node
// MCP server for the WebTerm/3270 bridge.
//
// Exposes the bridge to AI coding assistants (Claude Code, Cursor, VS Code +
// Copilot) as a set of tools. It is a *client* of the bridge — it opens one
// terminal session over the bridge's WebSocket and calls the bridge's HTTP
// routes for everything else. It changes nothing in the bridge itself.
//
// stdio transport. Run the bridge (npm start in Bridge_server) first.
//
//   BRIDGE_URL=ws://127.0.0.1:8081 node mcp/server.js
//
// Env:
//   BRIDGE_URL          bridge WebSocket URL   (default ws://127.0.0.1:8081)
//   MACRO_RUN_API_KEY   enables run_macro_headless (POST /api/macro-run)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BridgeClient } from './bridge-client.js';

const bridge = new BridgeClient({
  bridgeUrl: process.env.BRIDGE_URL || 'ws://127.0.0.1:8081',
  macroRunKey: process.env.MACRO_RUN_API_KEY || null,
});

const server = new McpServer({ name: 'webterm-3270', version: '1.0.0' });

// Wrap a handler so every tool returns pretty JSON and surfaces errors as
// isError text rather than throwing out of the transport.
function tool(name, description, inputSchema, fn) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      const result = await fn(args || {});
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true };
    }
  });
}

// ── session discovery ──────────────────────────────────────────────────

tool('list_lpars', 'List the session profiles (LPARs / hosts) the bridge knows about.', {},
  () => bridge.listProfiles());

tool('connect_lpar',
  'Open a terminal session. Give either a profileId from list_lpars, or host + port. ' +
  'Returns the session id and the first screen.',
  {
    profileId: z.string().optional().describe('id from list_lpars'),
    host: z.string().optional(),
    port: z.number().int().optional(),
    tls: z.boolean().optional(),
    protocol: z.enum(['3270', '5250']).optional(),
    model: z.string().optional(),
    luName: z.string().optional(),
    tn3270e: z.boolean().optional(),
  },
  async args => {
    let params = { ...args };
    if (args.profileId) {
      const profiles = await bridge.listProfiles();
      const p = profiles.find(x => x.id === args.profileId);
      if (!p) throw new Error(`no profile "${args.profileId}"`);
      params = { host: p.host, port: p.port, tls: p.tls, protocol: p.protocol, model: p.model, luName: p.luName, tn3270e: p.tn3270e };
    }
    return bridge.connect(params);
  });

tool('disconnect', 'Close the current terminal session.', {},
  async () => { await bridge.disconnect(); return { ok: true }; });

// ── driving the session ────────────────────────────────────────────────

tool('read_screen', 'The current screen: text, cursor, size, field list, anomalies. Nondisplay (password) fields are shown as #.', {},
  () => {
    const s = bridge.currentScreen();
    if (!s) throw new Error('no screen yet — connect_lpar first');
    return s;
  });

tool('read_field_map', 'Just the fields on the current screen with their attributes (protected, numeric, nondisplay, mdt) and positions.', {},
  () => {
    const s = bridge.currentScreen();
    if (!s) throw new Error('no screen yet — connect_lpar first');
    return s.fields;
  });

tool('send_keys', 'Type text into one or more fields (local buffer edit, nothing is transmitted until send_aid).',
  { fields: z.array(z.object({ row: z.number().int(), col: z.number().int(), text: z.string() })).min(1) },
  async ({ fields }) => {
    for (const f of fields) await bridge.typeAt(f.row, f.col, f.text);
    return bridge.currentScreen();
  });

tool('send_aid',
  'Send an AID key (transmit). Returns the screen the host sends back.',
  { key: z.enum([
      'ENTER', 'CLEAR', 'SYSREQ',
      'PA1', 'PA2', 'PA3',
      'PF1', 'PF2', 'PF3', 'PF4', 'PF5', 'PF6', 'PF7', 'PF8', 'PF9', 'PF10', 'PF11', 'PF12',
      'PF13', 'PF14', 'PF15', 'PF16', 'PF17', 'PF18', 'PF19', 'PF20', 'PF21', 'PF22', 'PF23', 'PF24',
    ]) },
  ({ key }) => bridge.sendAid(key, []));

// ── macros ─────────────────────────────────────────────────────────────

tool('list_macros', 'List saved macros (library + local + security).', {},
  () => bridge.listMacros());

tool('run_macro', 'Run a saved macro against the current session. Pass any prompted variables in vars.',
  { name: z.string(), vars: z.record(z.string()).optional() },
  ({ name, vars }) => bridge.runMacroWs(name, vars || {}));

tool('run_macro_headless',
  'Run one macro against a host without holding a session — the bridge connects, runs it, disconnects. Needs MACRO_RUN_API_KEY.',
  {
    host: z.string(),
    port: z.number().int(),
    tls: z.boolean().optional(),
    protocol: z.enum(['3270', '5250']).optional(),
    macroName: z.string().optional(),
    vars: z.record(z.string()).optional(),
    model: z.string().optional(),
    luName: z.string().optional(),
    timeoutMs: z.number().int().optional(),
  },
  args => bridge.runMacroHeadless(args));

// ── analysis (read-only) ───────────────────────────────────────────────

tool('get_traffic', 'The bridge traffic log (masked screen text + AID per direction).',
  { limit: z.number().int().max(1000).optional() },
  ({ limit }) => bridge.getTraffic(limit));

tool('get_negotiation', 'TLS / cert chain / LU fixation / TN3270E negotiation report for every live session.', {},
  () => bridge.getNegotiation());

tool('get_wire', 'Decoded 3270 wire records across captured sessions (SF/SFE/SBA/RA orders, AID records, FA decode).', {},
  () => bridge.getWire());

tool('esm_fingerprint', 'Passive external-security-manager verdict (RACF / ACF2 / Top Secret) for every live session, with the evidence trail.', {},
  () => bridge.getEsmFingerprint());

tool('start_recording', 'Start recording the current session to a .rec.json on the bridge.', {},
  () => bridge.startRecording());

tool('stop_recording', 'Stop recording the current session and return the .rec.json contents.', {},
  () => bridge.stopRecording());

// ── go ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`webterm-3270 MCP server ready — bridge ${bridge.bridgeUrl}\n`);
}

main().catch(err => {
  process.stderr.write(`fatal: ${err.stack || err}\n`);
  process.exit(1);
});
