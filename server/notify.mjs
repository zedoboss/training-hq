// The Mac's reminder clock (step 4): once a minute it works out today's reminders from the synced data (the same
// planner the phone uses, app/js/lib/reminders.js) and sends the ones whose time has come as push notifications.
// Sent ids are remembered in the server's meta table, so nothing is sent twice; a reminder more than 30 minutes
// late (the Mac was asleep or off) is skipped rather than sent late.
import { remindersFor, dueNow, reminderState } from '../app/js/lib/reminders.js';
import { addDays, rotationDay } from '../app/js/lib/rotation.js';
import { isoDate, deviceTimeZone, validZone } from '../app/js/lib/time.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { dayTotals } from '../app/js/lib/meals.js';
import { checklist } from '../app/js/lib/supplements.js';
import { coachReminder, coachVoice, nudgeCandidates, nudgeDue, pickNudge, awakeAt, dishesDue, DISHES_TEXT } from '../app/js/lib/nudges.js';
import { pickLine } from '../app/js/lib/coach-talk.js';
import { protocolOf, isDone, planFor } from '../app/js/lib/scans.js';
import { zonedTime } from '../app/js/lib/time.js';

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
    ...recoveryFrom(one, list),
  }, tz);
}

/** A13: his recovery record and what it needs (photos only when there is a record: they are big). */
function recoveryFrom(one, list) {
  const recoveryPlan = one('recovery', 'main');
  if (!recoveryPlan) return {};
  return { recoveryPlan, recoveryState: one('recovery', 'state'), notes: list('coach-notes'), photos: list('body-photos').map((p) => ({ date: p.date, pose: p.pose, dataUrl: Boolean(p.dataUrl) })) };
}

// Tue 10/20: a 7:30 AM holds reminder woke him (he gets up at 9 now). These kinds wait for his wake time; the sauna
// alarm, reminders he set with the coach, and the check-in and session reminders at a time he chose never move.
const WAIT_FOR_WAKE = new Set(['holds', 'supps', 'meals', 'evening', 'neck', 'recovery', 'scan']);

/** Today's and tomorrow's reminders (a check-in before an early session can fall on the evening before). */
export function plan(store, now = Date.now(), tz = deviceTimeZone()) {
  const st = stateFrom(store, tz);
  const today = isoDate(new Date(now), tz);
  const n = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const awake = (at) => awakeAt(at, tz, n.wakeHm, n.bedHm);
  const toWake = (at) => {
    const d = isoDate(new Date(at), tz);
    const w = zonedTime(d, n.wakeHm, tz);
    return w > at ? w : zonedTime(addDays(d, 1), n.wakeHm, tz);
  };
  return [today, addDays(today, 1)].flatMap((date) => remindersFor({ ...st, date }))
    .map((i) => (WAIT_FOR_WAKE.has(i.kind) && !awake(i.at) ? { ...i, at: toWake(i.at) } : i));
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

const NUDGES = 'nudge:sent';
const LAST = 'notify:last';
const MSGS = 'coach-messages';

/** The coach's voice settings: his line bank, moods and intensity. */
function voiceOpts(store) {
  const r = store.getRecord('coach-lines', 'bank');
  const st = withDefaults(store.getRecord('settings', 'main')?.data);
  return { bank: r && !r.deleted ? r.data : null, moods: st.coach.moods, intensity: st.coach.intensity };
}

/** Every notification also appears in Talk as a coach message, so he can answer it there. */
function sayInTalk(store, { text, at, tz, kind, ref }) {
  const id = `n${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  store.writeLocal(MSGS, id, { id, role: 'assistant', text, at, tz, kind, ref });
}

/** What the nudges need, read from the Mac's database. */
export function nudgeInputs(store, now, tz) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const st = stateFrom(store, tz);
  const date = isoDate(new Date(now), tz);
  const n = withDefaults(one('settings', 'main')).notify;
  const health = one('health', date);
  const plan = one('fuel', 'plan');
  const eaten = dayTotals(list('meals'), list('meal-estimates'), date);
  const trained = st.trainedDates?.has?.(date) || false;
  const rot = rotationDay({ last: st.last, today: date, days: st.days || {} });
  const untimed = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: rot.today.kind === 'train' || trained ? 'train' : 'rest' })
    .filter((g) => !g.time).flatMap((g) => g.items);
  return {
    date, n,
    busy: list('sessions').some((x) => x.status === 'active') || list('sauna').some((x) => x.status === 'active'),
    lastUserAt: Math.max(0, ...list(MSGS).filter((m) => m.role === 'user').map((m) => m.at || 0)),
    args: {
      now, tz, wakeHm: n.wakeHm, bedHm: n.bedHm,
      reminders: remindersFor({ ...st, date }),
      rot,
      suppsUntimed: untimed.length ? { total: untimed.length, open: untimed.filter((i) => !i.entry).map((i) => i.supp.name) } : null,
      sessionHm: st.days?.[date]?.sessionTime || null,
      session: { started: trained, done: trained },
      weighedToday: list('measurements').some((m) => m.date === date && m.weightKg != null) || Boolean(health?.weights?.length)
        || list('body-scans').some((x) => x.date === date && isDone(x)),
      sleepLogged: Boolean(health?.sleep || one('sleep-log', date)),
      wokeAt: one('sleep-log', date)?.wake ?? health?.sleep?.wake ?? null,
      workoutEndedAt: Math.max(0, ...list('sessions').filter((x) => x.status === 'done' && x.kind !== 'holds' && x.endedAt && isoDate(new Date(x.endedAt), tz) === date).map((x) => x.endedAt)) || null,
      lastMealAt: Math.max(0, ...list('meals').filter((m) => m.date === date && m.at).map((m) => m.at)) || null,
      morning: n.morning || null,
      eaten: { kcal: eaten.kcal, protein: eaten.protein },
      targets: plan?.kcal ? { kcal: plan.kcal, protein: plan.proteinG } : null,
      steps: health?.steps != null ? { steps: health.steps, asOf: health.fileAt ?? null } : null,
      stepGoal: withDefaults(one('settings', 'main')).body.stepGoal,
      scanToday: (() => {
        const sp = planFor(one('scan-plan', 'main') || {}, { scans: list('body-scans'), today: date, last: st.last, days: st.days || {} });
        if (sp?.next?.date !== date || list('body-scans').some((x) => x.date === date && isDone(x))) return null;
        return { items: protocolOf(sp).filter((i) => i.when === 'day').map((i) => i.text.replace(/\.$/, '')) };
      })(),
    },
  };
}

const DISHES = 'dishes:state';

/**
 * The dishes after a meal (Tue 10/20): 2 minutes after he logs one, the coach tells him to get up, walk a minute or
 * two and wash up. Not while a workout or sauna runs (it waits), not outside his waking hours, off with the 'dishes'
 * notification kind. The first run only notes the meals already there.
 */
export async function dishesTick({ store, push, log = () => {}, now, tz }) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const n = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const date = isoDate(new Date(now), tz);
  const meals = list('meals').filter((m) => m.date === date);
  const st = store.getMeta(DISHES);
  const state = st || { seen: {}, sent: {} };
  for (const m of meals) {
    if (!state.seen[m.id]) state.seen[m.id] = now;
    if (!st) state.sent[m.id] = now; // first run: nothing from before
  }
  for (const [id, at] of Object.entries(state.seen)) if (now - at > 2 * 86400000) { delete state.seen[id]; delete state.sent[id]; }
  const busy = list('sessions').some((x) => x.status === 'active') || list('sauna').some((x) => x.status === 'active');
  const due = n.kinds?.dishes === false || busy || !awakeAt(now, tz, n.wakeHm, n.bedHm) ? [] : dishesDue({ meals, seen: state.seen, sent: state.sent, now });
  let out = null;
  if (due.length) {
    for (const m of due) state.sent[m.id] = now;
    const opts = voiceOpts(store);
    const line = pickLine(opts.bank, 'dishes', { moods: opts.moods, intensity: opts.intensity });
    const body = `${DISHES_TEXT}${line?.text ? ` ${line.text}` : ''}`;
    const r = push.list().length ? await push.notify({ title: 'Coach', body, url: '#/fuel', tag: 'dishes' }) : { sent: 0 };
    sayInTalk(store, { text: body, at: now, tz, kind: 'nudge', ref: `dishes:${due.at(-1).id}` });
    store.setMeta(LAST, now);
    log(`dishes after ${due.map((m) => m.name || m.id).join(', ')} (${r.sent} sent)`);
    out = { key: 'dishes', body };
  }
  store.setMeta(DISHES, state);
  return out;
}

/** One nudge if it's time and something is open: pushed and written into Talk. Returns what was sent, or null. */
export async function nudgeTick({ store, push, log = () => {}, now, tz }) {
  const inp = nudgeInputs(store, now, tz);
  const state = store.getMeta(NUDGES) || { last: 0, byKey: {} };
  const awake = awakeAt(now, tz, inp.n.wakeHm, inp.n.bedHm);
  if (!nudgeDue({ now, everyMin: inp.n.nudgeEveryMin, awake, lastNudgeAt: state.last, lastNoticeAt: store.getMeta(LAST) || 0, lastUserAt: inp.lastUserAt, busy: inp.busy, pausedUntil: inp.n.nudgePausedUntil })) return null;
  const pick = pickNudge(nudgeCandidates(inp.args), state.byKey, now);
  if (!pick) return null;
  const v = coachVoice(pick.text, { ...voiceOpts(store), calm: pick.calm });
  const r = await push.notify({ title: v.title, body: v.body, url: pick.url, tag: `nudge-${pick.key.split(':')[0]}` });
  sayInTalk(store, { text: v.body, at: now, tz, kind: 'nudge', ref: pick.key });
  state.last = now; state.byKey[pick.key] = now;
  for (const [k, at] of Object.entries(state.byKey)) if (now - at > 2 * 86400000) delete state.byKey[k];
  store.setMeta(NUDGES, state);
  store.setMeta(LAST, now);
  log(`nudge ${pick.key}: ${v.body.slice(0, 80)} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
  return { ...pick, body: v.body };
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
      if (!push.list().length) return [];
      const sent = store.getMeta(SENT) || {};
      const items = dueNow(plan(store, t, zone), t, sent);
      if (items.length) {
        const opts = voiceOpts(store);
        for (const i of items) {
          // The coach says it (Mon 10/19): title "Coach", the reminder's facts, one short line in his moods.
          const v = coachReminder(i, opts);
          const r = await push.notify({ title: v.title, body: v.body, url: i.url, tag: i.tag });
          sent[i.id] = t;
          sayInTalk(store, { text: v.body, at: t, tz: zone, kind: 'reminder', ref: i.id });
          log(`notify ${i.id}: ${i.title} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
        }
        // Forget ids older than 3 days.
        for (const [id, at] of Object.entries(sent)) if (t - at > 3 * 86400000) delete sent[id];
        store.setMeta(SENT, sent);
        store.setMeta(LAST, t);
      }
      const dishes = await dishesTick({ store, push, log, now: t, tz: zone });
      const nudge = await nudgeTick({ store, push, log, now: t, tz: zone });
      return [...items, ...(dishes ? [dishes] : []), ...(nudge ? [nudge] : [])];
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
