// The coach's tool server (8.2): a small MCP server over HTTP on 127.0.0.1 at a secret path, written by hand like the
// celestial-globe plugin's bridge (JSON-RPC: initialize, ping, tools/list, tools/call; notifications get 202; no
// event stream). Only the coach's own Claude Code process knows the address. Every call goes through onCall, which
// gives the tool its context (the turn it belongs to) and reports it to the chat.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const PROTOCOL = '2025-06-18';

/**
 * @param {object} o
 * @param {Array<{name:string, title:string, description:string, inputSchema:object, run:Function}>} o.tools
 * @param {(tool:object, args:object) => Promise<{text:string, isError?:boolean}>} o.onCall
 */
export function openMcp({ tools, onCall, log = () => {} }) {
  const secret = randomBytes(16).toString('hex');
  const path = `/mcp/${secret}`;
  const byName = new Map(tools.map((t) => [t.name, t]));
  let url = null;

  const reply = (res, status, body) => {
    res.writeHead(status, body ? { 'content-type': 'application/json' } : {});
    res.end(body ? JSON.stringify(body) : undefined);
  };
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function handle(m) {
    const id = m?.id;
    switch (m?.method) {
      case 'initialize':
        return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'training-hq', version: '1' } });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) })) });
      case 'tools/call': {
        const tool = byName.get(m.params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${m.params?.name}`);
        let out;
        try { out = await onCall(tool, m.params?.arguments || {}); } catch (e) { out = { text: `Error: ${e.message}`, isError: true }; }
        return ok(id, { content: [{ type: 'text', text: String(out?.text ?? '') }], ...(out?.isError ? { isError: true } : {}) });
      }
      default:
        return fail(id, -32601, `method not found: ${m?.method}`);
    }
  }

  const server = createServer((req, res) => {
    if (req.url !== path) { reply(res, 404); return; }
    if (req.method !== 'POST') { reply(res, 405); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', async () => {
      let m;
      try { m = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(res, 400, fail(null, -32700, 'parse error')); return; }
      if (Array.isArray(m)) { reply(res, 400, fail(null, -32600, 'batches are not supported')); return; }
      if (m.id === undefined) { reply(res, 202); return; } // a notification
      try { reply(res, 200, await handle(m)); } catch (e) { log(`mcp: ${e.stack || e}`); reply(res, 200, fail(m.id, -32603, 'internal error')); }
    });
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${server.address().port}${path}`; resolve(url); });
  });
  server.unref?.();

  return { ready, url: () => url, close: () => new Promise((r) => server.close(() => r())) };
}
