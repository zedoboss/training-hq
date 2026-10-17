// HTTP handler for the Mac server: the sync API and, for use on the Mac itself, the app's files.
// Listens on 127.0.0.1 only; the phone reaches it through Tailscale's HTTPS proxy.
// Every API route except health and pairing needs a device token from pairing.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
const MAX_BODY = 20 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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

/**
 * @param {object} o
 * @param {ReturnType<import('./store.mjs').openStore>} o.store
 * @param {string} o.appDir folder with the app's files
 * @param {string[]} o.allowedOrigins extra origins allowed to call the API (e.g. the GitHub Pages site)
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]
 */
export function createApp({ store, appDir, allowedOrigins = [], now = () => Date.now(), log = () => {} }) {
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
        send(res, 200, await handler(req));
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
