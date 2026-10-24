// HTTP handler for the Mac server: the sync API and, for use on the Mac itself, the app's files.
// Listens on 127.0.0.1 only; the phone reaches it through Tailscale's HTTPS proxy.
// Every API route except health and pairing needs a device token from pairing.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { MAX_DEMO_BYTES } from './demos.mjs';
import { validZone } from '../app/js/lib/time.js';
import { safeHash } from '../app/js/lib/screens.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
};
const MAX_BODY = 20 * 1024 * 1024;
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const MAX_CLIP_BYTES = 2 * 1024 * 1024;
// Dictation: up to 5 minutes of 16 kHz 16-bit audio (about 9.6 MB) plus room for a higher phone rate.
const MAX_DICTATE_BYTES = 24 * 1024 * 1024;

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

/** A voice call; its own refusals (no models yet, not calibrated, a bad clip) become plain answers. */
function voiceCall(fn) {
  try { return fn(); } catch (e) {
    if (e?.status) throw new HttpError(e.status, e.message);
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
 * @param {ReturnType<import('./health.mjs').openHealth>} [o.health] Apple Health files (step 7)
 * @param {ReturnType<import('./coach/index.mjs').openCoach>} [o.coach] the coach (step 8)
 * @param {ReturnType<import('./voice/index.mjs').openVoice>} [o.voice] voice (step 9)
 * @param {ReturnType<import('./voice/tts.mjs').openTts>} [o.tts] the coach's voice (step 9)
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]
 */
export function createApp({ store, appDir, allowedOrigins = [], demos = null, imports = null, push = null, health = null, coach = null, voice = null, tts = null, arrive = null, calendar = null, icloud = null, evolt = null, restPush = null, onSync = null, onOpened = null, now = () => Date.now(), log = () => {} }) {
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

  async function arriveCall(url) {
    if (!arrive) throw new HttpError(404, 'not available');
    try { return await arrive.arrive(url.searchParams.get('k')); } catch (e) { throw new HttpError(e.status || 500, e.message); }
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

    // Exercise demos (2.17): clips and animated demo pages. The id is the exercise id, passed as ?id=.
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
      // An animated demo is a page: if it is ever opened directly it runs sandboxed, with no access to this origin.
      const sandbox = clip.type === 'text/html' ? { 'Content-Security-Policy': 'sandbox allow-scripts' } : {};
      res.writeHead(200, { 'Content-Type': clip.type, 'Content-Length': clip.body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...sandbox });
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

    // Apple Health (step 7): look in the iCloud Drive folder now, or read a file picked on the phone.
    'POST /api/apple-health/scan': async (req) => {
      auth(req);
      if (!health) throw new HttpError(404, 'Apple Health not available');
      return health.scan();
    },

    'POST /api/apple-health/upload': async (req, url) => {
      auth(req);
      if (!health) throw new HttpError(404, 'Apple Health not available');
      const text = (await readRaw(req, MAX_IMPORT_BYTES)).toString('utf8');
      const out = health.upload(text, (url.searchParams.get('name') || 'health.json').slice(0, 80));
      if (!out.samples) throw new HttpError(400, out.bad ? `Nothing in that file could be read (${out.bad} lines). Is it the file from the Training HQ Health Shortcut?` : 'That file is empty.');
      return out;
    },

    // The Health Shortcut sends its file straight here: the link for it (paired devices only), and the call itself
    // (the link's own secret; no device token: the Shortcut has none).
    'POST /api/apple-health/link': async (req) => {
      auth(req);
      if (!health) throw new HttpError(404, 'Apple Health not available');
      const { renew } = await readJson(req);
      return health.link({ renew: !!renew });
    },
    'POST /api/apple-health/push': async (req, url) => {
      if (!health) throw new HttpError(404, 'Apple Health not available');
      try { health.check(url.searchParams.get('k')); } catch (e) { throw new HttpError(e.status || 500, e.message); }
      const out = health.receive((await readRaw(req, MAX_IMPORT_BYTES)).toString('utf8'));
      if (!out.samples) throw new HttpError(400, out.bad ? `Nothing in the file could be read (${out.bad} lines).` : 'The file was empty.');
      return { ok: true, samples: out.samples, changed: out.changed };
    },

    // Web push (step 4). The public key is the Mac's VAPID key: the phone subscribes with it.
    'GET /api/push/key': async (req) => {
      auth(req);
      if (!push) throw new HttpError(404, 'push not available');
      return { publicKey: push.publicKey };
    },

    'GET /api/push/status': async (req) => {
      const device = auth(req);
      if (!push) throw new HttpError(404, 'push not available');
      return push.status(device);
    },

    'POST /api/push/subscribe': async (req) => {
      const device = auth(req);
      if (!push) throw new HttpError(404, 'push not available');
      const { subscription, name } = await readJson(req);
      try { return push.subscribe(device, subscription, name); } catch (e) { throw new HttpError(e.status || 500, e.message); }
    },

    'POST /api/push/unsubscribe': async (req) => {
      const device = auth(req);
      if (!push) throw new HttpError(404, 'push not available');
      return push.unsubscribe(device);
    },

    // Thu 10/22: how the phone's timer sounds went (lib/diag.js), into this log, so a silent beep can be traced.
    'POST /api/diag': async (req) => {
      const device = auth(req);
      const b = await readJson(req);
      for (const e of (Array.isArray(b?.events) ? b.events : []).slice(0, 100)) {
        const t = new Date(Number(e.at) || now()).toISOString().slice(11, 19);
        log(`phone ${String(device.name || device.id).slice(0, 20)} ${t}Z ${JSON.stringify(e).slice(0, 220)}`);
      }
      return { ok: true };
    },

    // Thu 10/22: the phone's rest timer, so the Mac sends "Rest over" when it ends (server/rest-push.mjs).
    'POST /api/rest': async (req) => {
      const device = auth(req);
      if (!restPush) throw new HttpError(404, 'rest notifications not available');
      const b = await readJson(req);
      return { alarm: restPush.set(device.id, b || {}) };
    },
    // A hold's go and stop moments (kind 'hold', items [{at, title, body, url}]); an empty list cancels them.
    'POST /api/alarms': async (req) => {
      const device = auth(req);
      if (!restPush) throw new HttpError(404, 'timer notifications not available');
      const b = await readJson(req);
      return { alarms: restPush.setAlarms(device.id, String(b?.kind || ''), Array.isArray(b?.items) ? b.items : []) };
    },

    'POST /api/push/test': async (req) => {
      const device = auth(req);
      if (!push) throw new HttpError(404, 'push not available');
      const r = await push.notify({ title: 'Training HQ', body: 'Test from your Mac. Tap to open Settings.', url: '#/settings', tag: 'test' }, { deviceId: device.id });
      if (!r.sent) throw new HttpError(502, r.dropped ? 'This phone\'s subscription has expired. Turn notifications off and on again.' : 'The push service did not accept the test.');
      return r;
    },

    // Evolt results PDF (A11): read on the Mac, the numbers go back to the phone to check and save.
    'POST /api/scan/pdf': async (req) => {
      auth(req);
      if (!evolt) throw new HttpError(404, 'not available');
      const body = await readRaw(req, 15 * 1024 * 1024);
      try { return evolt.read(body); } catch (e) { throw new HttpError(e.status || 500, e.message); }
    },

    // "When I arrive at the gym" (A10): the link for his iPhone Shortcut (paired devices only), and the call itself
    // (the link's own secret; no device token: the Shortcut has none).
    'POST /api/arrive/link': async (req) => {
      auth(req);
      if (!arrive) throw new HttpError(404, 'not available');
      const { renew } = await readJson(req);
      return arrive.link({ renew: !!renew });
    },
    'GET /api/arrive': async (req, url) => arriveCall(url),

    // The backup reminders as a calendar the iPhone subscribes to (server/calendar.mjs): the link for paired devices,
    // and the feed itself (the link's own secret: a calendar subscription has no device token).
    'POST /api/calendar/link': async (req) => {
      auth(req);
      if (!calendar) throw new HttpError(404, 'not available');
      const { renew } = await readJson(req);
      return calendar.link({ renew: !!renew });
    },
    // Thu 10/22: how the backup in his iCloud calendar stands (icloud-calendar.mjs), for Settings > Notifications.
    'GET /api/backup/status': async (req) => {
      auth(req);
      return { icloud: icloud ? icloud.status() : null, enabled: Boolean(icloud) };
    },
    'GET /api/calendar.ics': async (req, url, res) => {
      if (!calendar) throw new HttpError(404, 'not available');
      let body;
      try { body = calendar.ics(url.searchParams.get('k'), { agent: req.headers['user-agent'] || '' }); } catch (e) { throw new HttpError(e.status || 500, e.message); }
      log(`calendar: feed fetched (${String(req.headers['user-agent'] || 'no agent').slice(0, 60)})`);
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    },
    'POST /api/arrive': async (req, url) => arriveCall(url),

    // The coach (step 8). A message is answered as a stream of JSON lines (the reply as it is written, the tools it
    // used, actions for the phone); the turn runs to the end and is saved even if the phone drops off half-way.
    'POST /api/coach/send': async (req, url, res) => {
      const device = auth(req);
      if (!coach) throw new HttpError(404, 'coach not available');
      const { text, images, model, tz, screen } = await readJson(req);
      if (!String(text ?? '').trim() && !(Array.isArray(images) && images.length)) throw new HttpError(400, 'nothing to send');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      let open = true;
      res.on('close', () => { open = false; });
      const emit = (e) => { if (open && !res.writableEnded) res.write(`${JSON.stringify(e)}\n`); };
      const ping = setInterval(() => emit({ type: 'ping' }), 10000);
      try {
        await coach.send({ text, images, model, tz: typeof tz === 'string' && tz.length < 64 && validZone(tz) ? tz : null, screen: safeHash(screen), deviceId: device.id, emit });
      } catch (e) {
        emit({ type: 'error', error: e.message });
      } finally {
        clearInterval(ping);
        if (!res.writableEnded) res.end();
      }
    },

    'POST /api/coach/warm': async (req) => {
      auth(req);
      if (!coach) throw new HttpError(404, 'coach not available');
      const { model } = await readJson(req);
      return { started: coach.warm(model), ...coach.status() };
    },

    'POST /api/coach/stop': async (req) => {
      auth(req);
      if (!coach) throw new HttpError(404, 'coach not available');
      return { stopped: coach.stop() };
    },

    'POST /api/coach/new': async (req) => {
      auth(req);
      if (!coach) throw new HttpError(404, 'coach not available');
      return { marker: coach.newConversation() };
    },

    'GET /api/coach/status': async (req) => {
      auth(req);
      if (!coach) throw new HttpError(404, 'coach not available');
      return coach.status();
    },

    // Voice (step 9). Clips are small WAV files from the phone; the voice lock runs on the Mac (server/voice).
    'GET /api/voice/status': async (req) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      return voice.status();
    },

    'POST /api/voice/enrol': async (req, url) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const bytes = await readRaw(req, MAX_CLIP_BYTES);
      return voiceCall(() => voice.enrol({ bytes, condition: url.searchParams.get('condition'), phrase: url.searchParams.get('phrase') || '' }));
    },

    // One stretch of speech while listening: answered as a stream of JSON lines like /api/coach/send, starting with
    // {type:'heard'}; when the voice lock refuses it, that is the only line (nothing else happens).
    'POST /api/voice/utterance': async (req, url, res) => {
      const device = auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const bytes = await readRaw(req, MAX_CLIP_BYTES);
      const model = url.searchParams.get('model') === 'deep' ? 'deep' : 'fast';
      const tz = url.searchParams.get('tz');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      let open = true;
      res.on('close', () => { open = false; });
      const emit = (e) => { if (open && !res.writableEnded) res.write(`${JSON.stringify(e)}\n`); };
      const ping = setInterval(() => emit({ type: 'ping' }), 10000);
      try {
        await voice.utterance({ bytes, deviceId: device.id, model, tz: tz && tz.length < 64 && validZone(tz) ? tz : null, screen: safeHash(url.searchParams.get('screen')), emit });
      } catch (e) {
        if (!e.status) log(`voice utterance: ${e.stack || e}`);
        emit({ type: 'error', error: e.message });
      } finally {
        clearInterval(ping);
        if (!res.writableEnded) res.end();
      }
    },

    // The coach's voice: one sentence in, raw 24 kHz 16-bit audio out as it is made (ElevenLabs via the Mac; the key
    // never leaves the Mac). X-Voice says which voice spoke.
    'POST /api/voice/speak': async (req, url, res) => {
      auth(req);
      if (!tts) throw new HttpError(404, 'voice not available');
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'nothing to say');
      const ctrl = new AbortController();
      res.on('close', () => ctrl.abort());
      let started = false;
      const start = (engine) => { if (!started) { started = true; res.writeHead(200, { 'Content-Type': 'audio/L16; rate=24000; channels=1', 'Cache-Control': 'no-store', 'X-Voice': engine, 'Access-Control-Expose-Headers': 'X-Voice' }); } };
      const out = await tts.speak(text, (chunk, engine) => { start(engine); if (!res.writableEnded) res.write(chunk); }, { signal: ctrl.signal });
      start(out.engine);
      if (!res.writableEnded) res.end();
    },

    // Dictation into the chat box (Tue 10/20): the words come back, nothing is sent to the coach.
    'POST /api/voice/dictate': async (req) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const bytes = await readRaw(req, MAX_DICTATE_BYTES);
      return voiceCall(() => voice.dictate(bytes));
    },

    // He started talking again while the Mac holds what it heard (Tue 10/20): keep holding for the next clip.
    'POST /api/voice/talking': async (req) => {
      const device = auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      return { held: voice.talking(device.id) };
    },

    // Barge-in: is the voice talking over the coach his? Only the voice lock, nothing transcribed or kept.
    'POST /api/voice/barge': async (req) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const bytes = await readRaw(req, MAX_CLIP_BYTES);
      const d = voiceCall(() => voice.check(bytes)).decision;
      return { me: d.ok, reason: d.reason, score: d.score };
    },

    'POST /api/voice/warm': async (req) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      return { whisper: await voice.warm(), ...voice.status() };
    },

    // What the phone's mic chip shows (Tue 10/20): written to the Mac's log, so a chip stuck on SPEAKING can be seen
    // without iPhone Mirroring (which takes the phone's microphone).
    'POST /api/voice/state': async (req) => {
      const device = auth(req);
      const { phases } = await readJson(req);
      const list = (Array.isArray(phases) ? phases : []).slice(-20).filter((p) => p && typeof p.phase === 'string' && p.phase.length < 20);
      if (list.length) log(`voice chip (${String(device.name || device.id).slice(0, 40)}): ${list.map((p) => `${new Date(Number(p.at) || Date.now()).toISOString().slice(11, 19)} ${p.phase}`).join(', ')}`);
      return { ok: true };
    },

    'POST /api/voice/forget': async (req) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const { condition } = await readJson(req);
      return voice.forget(['home', 'gym'].includes(condition) ? condition : null);
    },

    'POST /api/voice/test': async (req, url) => {
      auth(req);
      if (!voice) throw new HttpError(404, 'voice not available');
      const bytes = await readRaw(req, MAX_CLIP_BYTES);
      return voiceCall(() => voice.test({ bytes, kind: url.searchParams.get('kind') }));
    },

    // Sat 10/24: the app came on screen on this device; the phone's first open of his day gets the coach's greeting
    // (notify.mjs morningTick), written into Talk before this answers, so the sync right after brings it.
    'POST /api/app/opened': async (req) => {
      const device = auth(req);
      const { phone } = await readJson(req);
      if (phone === true && onOpened) await onOpened({ device, at: now() });
      return { ok: true };
    },

    'POST /api/sync': async (req) => {
      const device = auth(req);
      const body = await readJson(req);
      const changes = Array.isArray(body.changes) ? body.changes : [];
      const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
      const result = store.applyChanges(changes, device.id);
      if (result.rejected.length) log(`sync from ${device.id}: rejected ${JSON.stringify(result.rejected).slice(0, 500)}`);
      // New records from the phone may need work on the Mac (meal photos to read); it runs after this reply.
      if (onSync && result.stored) setImmediate(() => { try { onSync(new Set(changes.map((c) => c?.col))); } catch (e) { log(`after sync: ${e.stack || e}`); } });
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
