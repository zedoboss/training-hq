// HTTP handler for the Mac server: the sync API and, for use on the Mac itself, the app's files.
// Listens on 127.0.0.1 only; the phone reaches it through Tailscale's HTTPS proxy.
// Every API route except health and pairing needs a device token from pairing.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { MAX_DEMO_BYTES } from './demos.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
const MAX_BODY = 20 * 1024 * 1024;
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Run an import step; its own errors (wrong file, unknown time zone) become plain 4xx answers. */
function importCall(fn) {
  try { return fn(); } catch (e) {
    if (e?.name === 'ImportError' || e?.constructor?.name === 'ImportError') throw new HttpError(e.status || 400, e.message);
    if (/not a Hevy or Strong/.test(e?.message || '')) throw new HttpError(400, e.message);
    throw e;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** Raw request body (a video or an import file), refused past `limit` bytes. */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `file too large (max ${Math.round(limit / 1048576)} MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {string} o.appDir folder with the app's files
 * @param {string[]} o.allowedOrigins extra origins allowed to call the API (e.g. the GitHub Pages site)
 * @param {ReturnType<import('./demos.mjs').openDemos>} [o.demos] exercise demo clips (2.17)
 * @param {ReturnType<import('./imports.mjs').openImports>} [o.imports] Hevy and Strong imports (step 3)
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]
 */
export function createApp({ store, appDir, allowedOrigins = [], demos = null, imports = null, now = () => Date.now(), log = () => {} }) {
  const failedPairs = [];

  const originAllowed = (origin, host) => {
    if (!origin) return false;
    if (allowedOrigins.includes(origin)) return true;
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
      return host && u.host === host; // same origin (e.g. the Mac's Tailscale HTTPS name)
    } catch { return false; }
  };

  function cors(req, res) {
    const origin = req.headers.origin;
    if (originAllowed(origin, req.headers.host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
    }
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function auth(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const device = m && store.deviceForToken(m[1]);
    if (!device) throw new HttpError(401, 'not paired');
    return device;
  }

  function pairingLocked() {
    const cutoff = now() - 10 * 60 * 1000;
    while (failedPairs.length && failedPairs[0] < cutoff) failedPairs.shift();
    return failedPairs.length >= 5;
  }

  const routes = {
    'GET /api/health': async () => ({ ok: true, app: 'training-hq', time: now() }),

    'POST /api/pair': async (req) => {
      if (pairingLocked()) throw new HttpError(429, 'too many wrong codes; wait 10 minutes');
      const { code, deviceId, name } = await readJson(req);
      const token = store.redeemPairingCode(String(code ?? '').trim(), deviceId, name);
      if (!token) {
        failedPairs.push(now());
        throw new HttpError(403, 'wrong or expired code');
      }
      log(`paired device ${deviceId} (${name})`);
      return { token, epoch: store.epoch() };
    },

    'GET /api/whoami': async (req) => ({ device: auth(req), epoch: store.epoch() }),

    'POST /api/pair/code': async (req) => {
      auth(req);
      return store.createPairingCode();
    },

    'GET /api/devices': async (req) => {
      auth(req);
      return { devices: store.listDevices() };
    },

    'POST /api/devices/revoke': async (req) => {
      const me = auth(req);
      const { id } = await readJson(req);
      if (id === me.id) throw new HttpError(400, 'a device cannot unpair itself here');
      return { revoked: store.revokeDevice(id) };
    },

    // Exercise demo clips (2.17). The id is the exercise id, passed as ?id=.
    'GET /api/demos': async (req) => {
      auth(req);
      if (!demos) throw new HttpError(404, 'no demo folder');
      return demos.rescan();
    },

    'POST /api/demo': async (req, url) => {
      auth(req);
      if (!demos) throw new HttpError(404, 'no demo folder');
      const body = await readRaw(req, MAX_DEMO_BYTES);
      try {
        const rec = demos.save(url.searchParams.get('id'), req.headers['content-type'], body);
        log(`demo saved: ${rec.file} (${rec.bytes} bytes)`);
        return rec;
      } catch (e) { throw new HttpError(e.status || 500, e.message); }
    },

    'GET /api/demo': async (req, url, res) => {
      auth(req);
      const clip = demos?.read(url.searchParams.get('id'));
      if (!clip) throw new HttpError(404, 'no demo for this exercise');
      res.writeHead(200, { 'Content-Type': clip.type, 'Content-Length': clip.body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(clip.body);
    },

    'POST /api/demo/delete': async (req) => {
      auth(req);
      if (!demos) throw new HttpError(404, 'no demo folder');
      const { id } = await readJson(req);
      try { return { removed: demos.remove(id) }; } catch (e) { throw new HttpError(e.status || 500, e.message); }
    },

    // Imports (step 3). The file is sent as text; the Mac keeps it, previews, and on commit writes the records.
    'POST /api/import/preview': async (req, url) => {
      auth(req);
      if (!imports) throw new HttpError(404, 'imports not available');
      const text = (await readRaw(req, MAX_IMPORT_BYTES)).toString('utf8');
      return importCall(() => imports.preview({ text, fileName: url.searchParams.get('name') || '', tz: url.searchParams.get('tz') || 'UTC' }));
    },

    'POST /api/import/plan': async (req) => {
      auth(req);
      if (!imports) throw new HttpError(404, 'imports not available');
      const { fileId, tz, matches } = await readJson(req);
      return importCall(() => imports.plan({ fileId, tz, matches }));
    },

    'POST /api/import/commit': async (req) => {
      auth(req);
      if (!imports) throw new HttpError(404, 'imports not available');
      const { fileId, tz, matches, remember } = await readJson(req);
      const out = importCall(() => imports.commit({ fileId, tz, matches, remember: remember !== false }));
      log(`import ${out.id}: ${out.summary.sessions} sessions, ${out.summary.sets} sets from ${out.file}`);
      return out;
    },

    'POST /api/import/undo': async (req) => {
      auth(req);
      if (!imports) throw new HttpError(404, 'imports not available');
      const { importId } = await readJson(req);
      const out = importCall(() => imports.undo({ importId }));
      log(`import ${importId} undone: ${JSON.stringify(out)}`);
      return out;
    },

    'POST /api/sync': async (req) => {
      const device = auth(req);
      const body = await readJson(req);
      const changes = Array.isArray(body.changes) ? body.changes : [];
      const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
      const result = store.applyChanges(changes, device.id);
      if (result.rejected.length) log(`sync from ${device.id}: rejected ${JSON.stringify(result.rejected).slice(0, 500)}`);
      const pull = store.changesSince(body.epoch === store.epoch() ? since : 0, 2000);
      return {
        epoch: store.epoch(),
        stored: result.stored,
        duplicates: result.duplicates,
        rejected: result.rejected,
        seq: pull.seq,
        more: pull.more,
        records: pull.records.map(({ seq, ...r }) => r),
      };
    },
  };

  async function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = normalize(join(appDir, rel));
    if (!full.startsWith(normalize(appDir + sep)) && full !== normalize(appDir)) throw new HttpError(404, 'not found');
    let st;
    try { st = await stat(full); } catch { throw new HttpError(404, 'not found'); }
    if (!st.isFile()) throw new HttpError(404, 'not found');
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (url.pathname.startsWith('/api/')) {
        const handler = routes[`${req.method} ${url.pathname}`];
        if (!handler) throw new HttpError(404, 'no such endpoint');
        const out = await handler(req, url, res);
        if (!res.headersSent) send(res, 200, out);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      await serveStatic(req, res, url.pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log(`error on ${req.method} ${url.pathname}: ${e.stack || e}`);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'server error' : e.message });
      else res.end();
    }
  });
}
