// Timer notifications from the Mac (Thu 10/22, his words at the gym: "when our rest time is over... send me a
// notification", then for holds: "send a notification when I'm supposed to start... and when I need to stop, when zero
// appears, because just the thing is quiet. I want both"). The timers run on the phone, but iPhone stops a web app's
// sounds and timers when the screen locks or another app is in front, and its audio sometimes stays silent. So the
// phone tells the Mac when each timer moment comes (rest: its end; hold: go and stop), and the Mac sends a push at
// that moment to that phone, which iPhone shows and sounds on its own. Kept in meta, so a server restart mid-rest
// still sends it. Off with the 'rest' notification kind.
import { withDefaults } from '../app/js/lib/settings.js';
import { lockScreen } from './push.mjs';

export const META = 'rest:alarms';
export const MAX_AHEAD_MS = 30 * 60000;
/** Sent this late at most (the Mac was asleep or restarting); later than that it is old news. */
export const STALE_MS = 2 * 60000;
export const KINDS = ['rest', 'hold'];

/** The notification for a rest that just ended: the set it leads to ("Rest over. Crunch (Machine): set 1, 23 kg ×
 *  10-15."; Sat 10/24, "Cupping: next set." came after his last cupping round), else the older "<exercise>: next set". */
export const restBody = (label, next = '') => lockScreen(next ? `Rest over. ${next.replace(/[.\s]+$/, '')}.` : label ? `Rest over. ${label}: next set.` : 'Rest over. Next set.');

const safeUrl = (url) => (/^#\/[\w/.%-]*$/.test(url || '') ? url : '#/train');

export function openRestPush({ store, push, log = () => {}, now = () => Date.now() }) {
  // { [deviceId]: { rest: [items], hold: [items] } }, item {at, title, body, url}. An older shape (one rest per device,
  // {endsAt, label, url}) is read as its rest item.
  const load = () => {
    const all = store.getMeta(META) || {};
    for (const [id, v] of Object.entries(all)) if (v && v.endsAt) all[id] = { rest: [{ at: v.endsAt, title: 'Rest over', body: restBody(v.label), url: safeUrl(v.url) }] };
    return all;
  };
  const save = (v) => store.setMeta(META, v);

  /** This phone's timer moments of one kind; an empty list cancels them. */
  function setAlarms(deviceId, kind, items = []) {
    if (!KINDS.includes(kind)) return [];
    const all = load();
    const ok = (items || []).map((x) => ({ at: Number(x.at), title: String(x.title || 'Training HQ').slice(0, 40), body: lockScreen(String(x.body || '')), url: safeUrl(x.url) }))
      .filter((x) => Number.isFinite(x.at) && x.at > now() && x.at <= now() + MAX_AHEAD_MS).slice(0, 6);
    const mine = { ...(all[deviceId] || {}) };
    if (ok.length) mine[kind] = ok; else delete mine[kind];
    if (Object.keys(mine).length) all[deviceId] = mine; else delete all[deviceId];
    save(all);
    return ok;
  }

  /** The phone's rest: {endsAt, label, next, url} sets it, endsAt null cancels it. */
  function set(deviceId, { endsAt = null, label = '', next = '', url = '' } = {}) {
    const [item] = setAlarms(deviceId, 'rest', endsAt ? [{ at: endsAt, title: 'Rest over', body: restBody(String(label || '').slice(0, 80), String(next || '').slice(0, 140)), url }] : []);
    return item ? { endsAt: item.at, label: String(label || '').slice(0, 80), url: item.url } : null;
  }

  /** Once a second: send the moments that have come. */
  async function tick() {
    const all = load();
    const due = [];
    for (const [deviceId, kinds] of Object.entries(all)) {
      for (const kind of Object.keys(kinds)) {
        const items = kinds[kind] || [];
        for (const x of items.filter((i) => i.at <= now())) due.push({ deviceId, kind, ...x });
        kinds[kind] = items.filter((i) => i.at > now());
        if (!kinds[kind].length) delete kinds[kind];
      }
      if (!Object.keys(kinds).length) delete all[deviceId];
    }
    if (!due.length) return 0;
    save(all);
    const on = withDefaults(store.getRecord('settings', 'main')?.data).notify.kinds?.rest !== false;
    let sent = 0;
    for (const a of due) {
      if (!on || now() - a.at > STALE_MS) continue;
      try {
        const r = await push.notify({ title: a.title, body: a.body, url: a.url, tag: a.kind }, { deviceId: a.deviceId });
        sent += r.sent || 0;
        log(`${a.kind}: ${a.title} (${r.sent} sent, ${now() - a.at} ms late)`);
      } catch (e) { log(`${a.kind}: ${e.message}`); }
    }
    return sent;
  }

  /** What is waiting, per device (for checks). */
  const list = () => Object.fromEntries(Object.entries(load()).map(([id, k]) => [id, k.rest?.[0] ? { endsAt: k.rest[0].at, url: k.rest[0].url, ...k } : k]));

  return { set, setAlarms, tick, list };
}
