// "Rest over" from the Mac (Thu 10/22, his words at the gym: "when our rest time is over, basically when it gets to
// zero, make it send me a notification that the rest time is over"). The rest timer runs on the phone, but iPhone
// stops a web app's sounds and timers when the screen locks or another app is in front, and its audio sometimes stays
// silent. So the phone tells the Mac when each rest ends (start, ±15 s, skip), and the Mac sends a push at that moment
// to that phone, which iPhone shows and sounds on its own. Kept in meta, so a server restart mid-rest still sends it.
// Off with the 'rest' notification kind.
import { withDefaults } from '../app/js/lib/settings.js';
import { lockScreen } from './push.mjs';

export const META = 'rest:alarms';
export const MAX_AHEAD_MS = 30 * 60000;
/** Sent this late at most (the Mac was asleep or restarting); later than that it is old news. */
export const STALE_MS = 2 * 60000;

/** The notification for a rest that just ended. */
export const restBody = (label) => lockScreen(label ? `Rest over. ${label}: next set.` : 'Rest over. Next set.');

export function openRestPush({ store, push, log = () => {}, now = () => Date.now() }) {
  const load = () => store.getMeta(META) || {};
  const save = (v) => store.setMeta(META, v);

  /** The phone's rest: {endsAt, label, url} sets it, endsAt null cancels it. */
  function set(deviceId, { endsAt = null, label = '', url = '' } = {}) {
    const all = load();
    const t = Number(endsAt);
    if (!endsAt || !Number.isFinite(t) || t <= now() || t > now() + MAX_AHEAD_MS) delete all[deviceId];
    else all[deviceId] = { endsAt: t, label: String(label || '').slice(0, 80), url: /^#\/[\w/.%-]*$/.test(url || '') ? url : '#/train' };
    save(all);
    return all[deviceId] || null;
  }

  /** Once a second: send the rests that have ended. */
  async function tick() {
    const all = load();
    const due = Object.entries(all).filter(([, a]) => a.endsAt <= now());
    if (!due.length) return 0;
    for (const [id] of due) delete all[id];
    save(all);
    const on = withDefaults(store.getRecord('settings', 'main')?.data).notify.kinds?.rest !== false;
    let sent = 0;
    for (const [deviceId, a] of due) {
      if (!on || now() - a.endsAt > STALE_MS) continue;
      try {
        const r = await push.notify({ title: 'Rest over', body: restBody(a.label), url: a.url, tag: 'rest' }, { deviceId });
        sent += r.sent || 0;
        log(`rest over: ${a.label || 'rest'} (${r.sent} sent, ${now() - a.endsAt} ms late)`);
      } catch (e) { log(`rest over: ${e.message}`); }
    }
    return sent;
  }

  return { set, tick, list: load };
}
