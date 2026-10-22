// Connects the app to its local database and to the Mac: pairing, the sync loop, and status for the screens.
import { openRepo } from './repo.js';
import { idbAdapter } from './idb.js';
import { syncOnce } from './sync.js';
import { setState } from './store.js';
import { summarizeProgramme } from './programme.js';
import { withDefaults, equipmentWithDefaults, mergeDeep } from './settings.js';
import { lineReader } from './coach.js';
import { setHomeZone, deviceTimeZone } from './time.js';

let repo = null;
let timer = null;
let running = null;
let again = false;

export const ready = (async () => {
  repo = await openRepo(await idbAdapter());
  repo.onChange((cols) => {
    if (cols.includes('programme')) refreshProgramme();
    if (cols.includes('settings')) refreshSettings();
    scheduleSync(1500);
  });
  await refreshPairing();
  await refreshProgramme();
  await refreshSettings();
  setState({
    sync: { lastAt: (await repo.getMeta('lastSyncAt')) ?? null, pending: await repo.pendingCount() },
    mac: { lastSeen: (await repo.getMeta('macLastSeen')) ?? null },
  });
  startLoop();
  return repo;
})();

export const getRepo = () => repo;

async function refreshPairing() {
  const macUrl = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  setState({ paired: !!(macUrl && token), macUrl: macUrl ?? null });
}

async function refreshProgramme() {
  setState({ programme: summarizeProgramme(await repo.list('programme')) });
}

async function refreshSettings() {
  const [main, equipment, zones] = await Promise.all([repo.get('settings', 'main'), repo.get('settings', 'equipment'), repo.get('settings', 'zones')]);
  // A3: logs without a zone of their own (everything before, and imports) are shown in the home zone.
  setHomeZone(zones?.home || null);
  setState({ settings: withDefaults(main), equipment: equipmentWithDefaults(equipment), homeZone: zones?.home || null });
}

/** Save the home zone (settings/zones). */
export async function saveHomeZone(tz) {
  await ready;
  await repo.put('settings', 'zones', { ...((await repo.get('settings', 'zones')) || {}), home: tz, changedAt: Date.now() });
}

/**
 * A3: this device's time zone, kept in the synced doc here/<device> whenever it changes (and twice a day), so the
 * Mac's reminders follow the phone when he travels.
 */
async function reportZone() {
  const tz = deviceTimeZone();
  const last = await repo.getMeta('zoneReported');
  if (last?.tz === tz && Date.now() - last.at < 12 * 3600000) return;
  const phone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  await repo.put('here', repo.device, { device: repo.device, tz, at: Date.now(), phone });
  await repo.setMeta('zoneReported', { tz, at: Date.now() });
}

/** Save settings: 'main' takes a patch deep-merged over the current values; 'equipment' is saved whole. */
export async function saveSettings(patch) {
  await ready;
  const cur = withDefaults(await repo.get('settings', 'main'));
  const next = withDefaults(mergeDeep(cur, patch));
  await repo.put('settings', 'main', next);
  return next;
}

export async function saveEquipment(doc) {
  await ready;
  const next = equipmentWithDefaults(doc);
  await repo.put('settings', 'equipment', next);
  return next;
}

/** The app is being served by the Mac server itself (e.g. http://localhost:4317 on the Mac). */
export async function sameOriginMac() {
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    const j = await r.json();
    return j.app === 'training-hq' ? new URL('.', location.href).href.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

const normalizeUrl = (u) => {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
};

export async function pair({ macUrl, code, name }) {
  await ready;
  const url = normalizeUrl(macUrl);
  const res = await fetch(`${url}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: String(code).replace(/\s+/g, ''), deviceId: repo.device, name }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Mac answered ${res.status}`);
  await repo.setMeta('macUrl', url);
  await repo.setMeta('token', j.token);
  // Keep an existing epoch: if the Mac's database was replaced, the first sync then restores it from here.
  if (!(await repo.getMeta('epoch'))) await repo.setMeta('epoch', j.epoch);
  await refreshPairing();
  await syncNow();
}

export async function unpair() {
  await ready;
  await repo.setMeta('token', null);
  await refreshPairing();
}

async function post(path, body) {
  const url = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    clearTimeout(t);
  }
}

/** A call to the Mac that isn't JSON sync (demo clips). Throws with a plain message when it can't be reached. */
async function macFetch(path, { method = 'GET', body, type, timeoutMs = 60000 } = {}) {
  await ready;
  const url = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  if (!url || !token) throw new Error('Pair with your Mac first (Settings).');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url + path, { method, body, signal: ctrl.signal, headers: { authorization: `Bearer ${token}`, ...(type ? { 'content-type': type } : {}) } });
  } catch {
    throw new Error('Mac unreachable. Try again when it is connected.');
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Mac answered ${res.status}`);
  return res;
}

/** Upload a demo clip for an exercise; the Mac stores it as <exercise id>.<type> and syncs a small record. */
export async function uploadDemo(id, blob) {
  const res = await macFetch(`/api/demo?id=${encodeURIComponent(id)}`, { method: 'POST', body: blob, type: blob.type || 'video/mp4', timeoutMs: 180000 });
  syncNow();
  return res.json();
}

export const fetchDemo = async (id) => (await macFetch(`/api/demo?id=${encodeURIComponent(id)}`)).blob();

export async function deleteDemo(id) {
  const res = await macFetch('/api/demo/delete', { method: 'POST', body: JSON.stringify({ id }), type: 'application/json' });
  syncNow();
  return res.json();
}

/** Ask the Mac to look for clips copied into its demos folder by hand. */
export async function rescanDemos() {
  const res = await macFetch('/api/demos');
  await syncNow();
  return res.json();
}

/** JSON calls to the Mac (push subscriptions and other small requests). */
export const macGet = async (path) => (await macFetch(path, { timeoutMs: 20000 })).json();
/** A small file (a voice clip) to the Mac; the answer is JSON. */
export const macSendRaw = async (path, body, type = 'audio/wav', timeoutMs = 30000) => (await macFetch(path, { method: 'POST', body, type, timeoutMs })).json();
export const macPost = async (path, body = {}) => (await macFetch(path, { method: 'POST', body: JSON.stringify(body), type: 'application/json', timeoutMs: 30000 })).json();

// Imports (step 3) run on the Mac: it keeps the file, plans, and writes the records; they come back by sync.
const postJson = async (path, body, timeoutMs = 120000) =>
  (await macFetch(path, { method: 'POST', body: JSON.stringify(body), type: 'application/json', timeoutMs })).json();

/** Send a Hevy or Strong CSV to the Mac; it keeps the file and answers with what an import would do. */
export async function previewImport(text, { name = '', tz }) {
  const res = await macFetch(`/api/import/preview?name=${encodeURIComponent(name)}&tz=${encodeURIComponent(tz)}`, { method: 'POST', body: text, type: 'text/csv', timeoutMs: 180000 });
  return res.json();
}

/** The same preview with another time zone or other exercise matches ({file name: exercise id | 'new'}). */
export const planImport = (fileId, tz, matches) => postJson('/api/import/plan', { fileId, tz, matches });

export async function commitImport(fileId, tz, matches) {
  const out = await postJson('/api/import/commit', { fileId, tz, matches, remember: true }, 300000);
  await syncNow();
  return out;
}

export async function undoImport(importId) {
  const out = await postJson('/api/import/undo', { importId });
  await syncNow();
  return out;
}

// Apple Health (step 7): the Mac reads the iPhone Shortcut's file from iCloud Drive; these ask it to look now, or
// send it a file picked on the phone. The days come back by sync.
export async function scanHealth() {
  const out = await postJson('/api/apple-health/scan', {}, 60000);
  await syncNow();
  return out;
}

export async function uploadHealth(text, name) {
  const res = await macFetch(`/api/apple-health/upload?name=${encodeURIComponent(name || 'health.json')}`, { method: 'POST', body: text, type: 'text/plain', timeoutMs: 120000 });
  const out = await res.json();
  await syncNow();
  return out;
}

// The coach (step 8) runs on the Mac. A message goes there and the reply streams back as JSON lines: the words as
// they are written, the tools used, actions for this device. The whole conversation also syncs ('coach-messages').
export async function coachSend({ text, model, tz, screen, onEvent, signal }) {
  await ready;
  const url = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  if (!url || !token) throw new Error('Pair with your Mac first (Settings).');
  let res;
  try {
    res = await fetch(`${url}/api/coach/send`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ text, model, tz, screen }) });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    setState({ mac: { reachable: false } });
    throw new Error('Mac unreachable. The coach runs on your Mac: try again when it is connected.');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Mac answered ${res.status}`);
  setState({ mac: { reachable: true, lastSeen: Date.now() } });
  const lines = lineReader(onEvent);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lines.push(dec.decode(value, { stream: true }));
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('The connection to the Mac dropped. The answer is kept there and arrives with the next sync.');
  }
  lines.push(dec.decode());
  lines.end();
}

// Voice (step 9). A stretch of speech goes to the Mac; the answer streams back like a typed message's, after a first
// {type:'heard'} line (the voice lock's verdict). The coach's voice comes back as raw audio, one sentence at a time.
export async function voiceUtterance({ wav, model, tz, screen, onEvent, signal }) {
  await ready;
  const url = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  if (!url || !token) throw new Error('Pair with your Mac first (Settings).');
  let res;
  try {
    res = await fetch(`${url}/api/voice/utterance?model=${encodeURIComponent(model || 'fast')}&tz=${encodeURIComponent(tz || '')}&screen=${encodeURIComponent(screen || '')}`, { method: 'POST', signal, headers: { 'content-type': 'audio/wav', authorization: `Bearer ${token}` }, body: wav });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    setState({ mac: { reachable: false } });
    throw new Error('Mac unreachable.');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Mac answered ${res.status}`);
  setState({ mac: { reachable: true, lastSeen: Date.now() } });
  const lines = lineReader(onEvent);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    lines.push(dec.decode(value, { stream: true }));
  }
  lines.push(dec.decode());
  lines.end();
}

/** The coach's voice for one sentence: a streaming response of raw 24 kHz 16-bit audio. */
export async function voiceSpeech(text, signal) {
  await ready;
  const url = await repo.getMeta('macUrl');
  const token = await repo.getMeta('token');
  return fetch(`${url}/api/voice/speak`, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ text }) });
}

/** Ask the Mac for a pairing code for another device. */
export async function newPairingCode() {
  await ready;
  const r = await post('/api/pair/code', {});
  if (r.status !== 200) throw new Error(r.json?.error || `Mac answered ${r.status}`);
  return r.json;
}

export async function syncNow() {
  await ready;
  if (!(await repo.getMeta('token')) || !(await repo.getMeta('macUrl'))) return { ok: false, reason: 'unpaired' };
  if (running) { again = true; return running; }
  setState({ sync: { running: true } });
  running = (async () => {
    let result;
    do {
      again = false;
      result = await syncOnce({
        repo,
        post,
        onStatus: async (s) => {
          if (s.reachable) await repo.setMeta('macLastSeen', Date.now());
          setState({
            mac: { reachable: s.reachable, lastError: s.error ?? null, ...(s.reachable ? { lastSeen: Date.now() } : {}) },
            ...(s.lastAt ? { sync: { lastAt: s.lastAt } } : {}),
          });
        },
      });
    } while (again && result.ok);
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
    setState({ sync: { running: false, pending: await repo.pendingCount() } });
  }
}

function scheduleSync(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().finally(() => scheduleSync(30000)); }, ms);
}

function startLoop() {
  reportZone().catch(() => {});
  scheduleSync(300);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { reportZone().catch(() => {}); scheduleSync(300); }
  });
  window.addEventListener('online', () => scheduleSync(300));
}

/** A10: the link for his iPhone "arrive at the gym" Shortcut: the Mac address this device uses + the private path. */
export async function arriveLink({ renew = false } = {}) {
  const out = await postJson('/api/arrive/link', { renew }, 30000);
  return (await repo.getMeta('macUrl')) + out.path;
}

/**
 * The backup reminders' calendar subscription (server/calendar.mjs): {webcal} makes the iPhone offer to subscribe;
 * {url} (the Mac address this device uses, https through Tailscale) is for adding it by hand in Settings.
 */
export async function calendarLink({ renew = false } = {}) {
  const out = await postJson('/api/calendar/link', { renew }, 30000);
  const url = (await repo.getMeta('macUrl')) + out.path;
  return { url, webcal: url.replace(/^https?:/, 'webcal:') };
}

/** The Health Shortcut's link: it sends its file straight to the Mac (Wed 10/21: through iCloud alone it took 78 min). */
export async function healthLink({ renew = false } = {}) {
  const out = await postJson('/api/apple-health/link', { renew }, 30000);
  return (await repo.getMeta('macUrl')) + out.path;
}

/** Call the link the way the Shortcut will (a test from the app). */
export async function arriveTest(link) {
  let res;
  try { res = await fetch(link, { cache: 'no-store' }); } catch { throw new Error('Mac unreachable. Try again when it is connected.'); }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `Mac answered ${res.status}`);
  syncNow(); // the arrival noted on the Mac comes back with the next sync; don't wait for it
  return j;
}

/** A11: send an Evolt results PDF to the Mac; the numbers read from it come back to check (nothing saved yet). */
export async function uploadScanPdf(file) {
  const res = await macFetch('/api/scan/pdf', { method: 'POST', body: file, type: 'application/pdf', timeoutMs: 60000 });
  return res.json();
}
