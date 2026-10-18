import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMcp } from '../server/coach/mcp.mjs';

const TOOLS = [
  { name: 'echo', title: 'Echo', description: 'Says it back', inputSchema: { type: 'object', properties: { s: { type: 'string' } } }, run: null },
  { name: 'boom', title: 'Boom', description: 'Fails', inputSchema: { type: 'object', properties: {} }, run: null },
];

const rpc = async (url, body, method = 'POST') => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};

test('the tool server speaks MCP over HTTP at a secret path', async () => {
  const calls = [];
  const m = openMcp({ tools: TOOLS, onCall: async (tool, args) => { calls.push([tool.name, args]); if (tool.name === 'boom') throw new Error('nope'); return { text: `said ${args.s}` }; } });
  const url = await m.ready;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{32}$/);

  const init = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.json.result.protocolVersion, '2025-06-18');
  assert.ok(init.json.result.capabilities.tools);
  assert.equal((await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);

  const list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.json.result.tools.map((t) => t.name), ['echo', 'boom']);
  assert.equal(list.json.result.tools[0].run, undefined, 'only the description goes out');

  const r = await rpc(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { s: 'hi' } } });
  assert.deepEqual(r.json.result, { content: [{ type: 'text', text: 'said hi' }] });
  const bad = await rpc(url, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom', arguments: {} } });
  assert.equal(bad.json.result.isError, true);
  assert.match(bad.json.result.content[0].text, /nope/);
  const unknownTool = await rpc(url, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(unknownTool.json.error.code, -32602);
  assert.equal((await rpc(url, { jsonrpc: '2.0', id: 6, method: 'server/discover' })).json.error.code, -32601);
  assert.deepEqual((await rpc(url, { jsonrpc: '2.0', id: 7, method: 'ping' })).json.result, {});
  assert.deepEqual(calls, [['echo', { s: 'hi' }], ['boom', {}]]);

  assert.equal((await rpc(url.replace(/[0-9a-f]{32}$/, '0'.repeat(32)), { id: 1, method: 'ping' })).status, 404, 'wrong secret');
  assert.equal((await rpc(url, null, 'GET')).status, 405, 'no event stream');
  await m.close();
});
