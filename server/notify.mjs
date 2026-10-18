// The Mac's reminder clock (step 4): once a minute it works out today's reminders from the synced data (the same
// planner the phone uses, app/js/lib/reminders.js) and sends the ones whose time has come as push notifications.
// Sent ids are remembered in the server's meta table, so nothing is sent twice; a reminder more than 30 minutes
// late (the Mac was asleep or off) is skipped rather than sent late.
import { remindersFor, dueNow, reminderState } from '../app/js/lib/reminders.js';
import { addDays } from '../app/js/lib/rotation.js';
import { isoDate, deviceTimeZone, validZone } from '../app/js/lib/time.js';

const SENT = 'notify:sent';

/** Everything the planner needs, read from the Mac's database. */
export function stateFrom(store, tz) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  return reminderState({
    sessions: list('sessions'), sets: list('sets'), tendons: list('tendons'), bridge: one('bridge', 'last-loads'),
    settings: one('settings', 'main'), meta: one('programme', 'meta'), days: list('days'), neck: one('schedule', 'neck'),
    meals: list('meals'), mealChecks: list('meal-checks'), supplements: list('supplements'), suppLog: list('supp-log'), suppAnswers: list('supp-answers'), sauna: list('sauna'), saunaPlan: one('sauna-plan', 'main'),
    scans: list('body-scans'), scanPlan: one('scan-plan', 'main'), coachReminders: list('coach-reminders'),
  }, tz);
}

/** Today's and tomorrow's reminders (a check-in before an early session can fall on the evening before). */
export function plan(store, now = Date.now(), tz = deviceTimeZone()) {
  const st = stateFrom(store, tz);
  const today = isoDate(new Date(now), tz);
  return [today, addDays(today, 1)].flatMap((date) => remindersFor({ ...st, date }));
}

/**
 * Where he is (A3: reminders follow the phone's current zone): the zone a phone reported last (doc here/<device>,
 * written by the app when its zone changes), else any device's latest, else the Mac's own.
 */
export function phoneZone(store, fallback = deviceTimeZone()) {
  const here = store.listRecords('here').filter((r) => !r.deleted).map((r) => r.data).filter((d) => d && validZone(d.tz));
  const latest = (xs) => xs.sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  return (latest(here.filter((d) => d.phone)) || latest(here))?.tz || fallback;
}

export function startNotifier({ store, push, log = () => {}, tz = () => phoneZone(store), now = () => Date.now(), everyMs = 60000 }) {
  let busy = false;
  let lastZone = null;
  async function tick() {
    if (busy) return [];
    busy = true;
    try {
      const t = now();
      const zone = typeof tz === 'function' ? tz() : tz;
      if (zone !== lastZone) { if (lastZone) log(`notify: reminders now follow ${zone}`); lastZone = zone; }
      const sent = store.getMeta(SENT) || {};
      const items = dueNow(plan(store, t, zone), t, sent);
      if (!items.length) return [];
      if (!push.list().length) return [];
      for (const i of items) {
        const r = await push.notify({ title: i.title, body: i.body, url: i.url, tag: i.tag });
        sent[i.id] = t;
        log(`notify ${i.id}: ${i.title} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
      }
      // Forget ids older than 3 days.
      for (const [id, at] of Object.entries(sent)) if (t - at > 3 * 86400000) delete sent[id];
      store.setMeta(SENT, sent);
      return items;
    } catch (e) {
      log(`notify error: ${e.stack || e}`);
      return [];
    } finally {
      busy = false;
    }
  }
  const first = setTimeout(tick, 5000);
  const timer = setInterval(tick, everyMs);
  first.unref?.(); timer.unref?.();
  return { tick, stop: () => { clearTimeout(first); clearInterval(timer); } };
}
