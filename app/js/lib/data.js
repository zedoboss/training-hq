// Connects the app to its local database and to the Mac: pairing, the sync loop, and status for the screens.
import { openRepo } from './repo.js';
import { idbAdapter } from './idb.js';
import { syncOnce } from './sync.js';
import { setState } from './store.js';
import { summarizeProgramme } from './programme.js';
import { withDefaults, equipmentWithDefaults, mergeDeep } from './settings.js';

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
  const [main, equipment] = await Promise.all([repo.get('settings', 'main'), repo.get('settings', 'equipment')]);
  setState({ settings: withDefaults(main), equipment: equipmentWithDefaults(equipment) });
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
  const t = setTimeout(() => ctrl.abort(), 20000);
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
  scheduleSync(300);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300);
  });
  window.addEventListener('online', () => scheduleSync(300));
}
