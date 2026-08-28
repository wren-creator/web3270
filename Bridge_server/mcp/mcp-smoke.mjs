// Spins up server.js over stdio, lists tools, and calls a couple.
// Assumes the bridge + z/OS mock are already running.
//
//   node mcp-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['server.js'],
  env: { ...process.env, BRIDGE_URL: 'ws://127.0.0.1:8081' },
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`${tools.length} tools:`, tools.map(t => t.name).join(', '));

const lpars = await client.callTool({ name: 'list_lpars', arguments: {} });
console.log('list_lpars →', lpars.content[0].text.slice(0, 200), '...');

const conn = await client.callTool({ name: 'connect_lpar', arguments: { host: '127.0.0.1', port: 3270, model: '3278-2' } });
const parsed = JSON.parse(conn.content[0].text);
console.log('connect_lpar → wsId', parsed.wsId, '| screen row1:', parsed.screen.text.split('\n')[1]?.trim());

const esm = await client.callTool({ name: 'esm_fingerprint', arguments: {} });
console.log('esm_fingerprint →', JSON.parse(esm.content[0].text)[0]?.product);

await client.callTool({ name: 'disconnect', arguments: {} });
await client.close();
process.exit(0);
