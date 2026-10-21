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
import { coachReminder, coachVoice, nudgeCandidates, nudgeDue, pickNudge, awakeAt, dishesDue, DISHES_TEXT, AFTER_WORKOUT_QUIET_MIN } from '../app/js/lib/nudges.js';
import { walkDue, withAsk, usualWalkHm } from '../app/js/lib/walks.js';
import { fastingOn } from '../app/js/lib/fast.js';
import { heldOff, itemHeld } from '../app/js/lib/holdoffs.js';
import { openItems, initiativePrompt } from '../app/js/lib/initiatives.js';
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
const WAIT_FOR_WAKE = new Set(['holds', 'supps', 'meals', 'cook', 'evening', 'neck', 'recovery', 'scan']);

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
const holdsOf = (store) => store.listRecords('coach-holds').map((r) => r.data).filter(Boolean);
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
  const groups = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: rot.today.kind === 'train' || trained ? 'train' : 'rest' });
  const untimed = groups.filter((g) => !g.time && !g.afterMeal).flatMap((g) => g.items);
  const afterMeal = groups.filter((g) => g.afterMeal).flatMap((g) => g.items);
  const firstMealAt = Math.min(...list('meals').filter((m) => m.date === date && m.at).map((m) => m.at));
  const fasting = fastingOn(st.days || {}, date, list('meals'));
  return {
    date, n, fasting,
    busy: list('sessions').some((x) => x.status === 'active') || list('sauna').some((x) => x.status === 'active'),
    lastUserAt: Math.max(0, ...list(MSGS).filter((m) => m.role === 'user').map((m) => m.at || 0)),
    args: {
      now, tz, wakeHm: n.wakeHm, bedHm: n.bedHm, fasting,
      reminders: remindersFor({ ...st, date }),
      rot,
      suppsUntimed: untimed.length ? { total: untimed.length, open: untimed.filter((i) => !i.entry).map((i) => i.supp.name) } : null,
      suppsAfterMeal: afterMeal.length && Number.isFinite(firstMealAt) ? { open: afterMeal.filter((i) => !i.entry).map((i) => i.supp.name), mealAt: firstMealAt } : null,
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
      healthAt: Math.max(0, ...list('health').map((d) => d?.fileAt || 0)) || null,
      // The walk coach asks about steps now (walkTick); the nudges' own steps line only when walks are off.
      stepGoal: n.kinds?.walk === false ? withDefaults(one('settings', 'main')).body.stepGoal : null,
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
  let out = null;
  // The first meal of the day, the moment it is logged (Tue 10/20, his words): "take your supplements" at once, with
  // the ones he takes after it that aren't ticked yet. Then the dishes, two minutes later, as below.
  const first = meals.filter((m) => m.at).sort((a, b) => a.at - b.at)[0];
  const holds = holdsOf(store);
  if (first && st && !state.suppsFor?.[date] && state.seen[first.id] === now && !heldOff('supps-after-meal', holds, now)) {
    const groups = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: 'train' });
    const open = groups.filter((g) => g.afterMeal).flatMap((g) => g.items).filter((i) => !i.entry).map((i) => i.supp.name);
    state.suppsFor = { [date]: now };
    if (open.length) {
      const opts = voiceOpts(store);
      const line = pickLine(opts.bank, 'nudge', { moods: opts.moods, intensity: opts.intensity });
      const body = `${first.name || 'First meal'} logged. Take your supplements now: ${open.join(', ')}.${line?.text ? ` ${line.text}` : ''}`;
      const r = push.list().length ? await push.notify({ title: 'Coach', body, url: '#/supps', tag: 'supps-after-meal' }) : { sent: 0 };
      sayInTalk(store, { text: body, at: now, tz, kind: 'nudge', ref: `supps-after-meal:${first.id}` });
      store.setMeta(LAST, now);
      log(`supplements after ${first.name || first.id} (${r.sent} sent)`);
      out = { key: 'supps-after-meal', body };
    }
  }
  const due = n.kinds?.dishes === false || busy || !awakeAt(now, tz, n.wakeHm, n.bedHm) || heldOff('dishes', holds, now) ? [] : dishesDue({ meals, seen: state.seen, sent: state.sent, now });
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
  if (state.suppsFor) for (const d of Object.keys(state.suppsFor)) if (d < date) delete state.suppsFor[d];
  store.setMeta(DISHES, state);
  return out;
}

/**
 * The walk coach (Tue 10/20, his words: "bump me throughout the day... to get me to get those 8K steps... If I don't
 * respond within 5 minutes, it should bump me again and ask... When are you going for a walk?"). Its own timing (lib/
 * walks.js), not the nudges' 20 minutes; quiet while a workout or the sauna runs, 20 minutes after a workout, while
 * nudges are paused, within 2 minutes of another notification or of his last message. Returns what was sent, or null.
 */
export async function walkTick({ store, push, log = () => {}, now, tz }) {
  const inp = nudgeInputs(store, now, tz);
  if (inp.n.kinds?.walk === false || now < (inp.n.nudgePausedUntil || 0) || heldOff('walk', holdsOf(store), now)) return null;
  const a = inp.args;
  if (a.workoutEndedAt && now >= a.workoutEndedAt && now - a.workoutEndedAt < AFTER_WORKOUT_QUIET_MIN * 60000) return null;
  if (now - (store.getMeta(LAST) || 0) < 2 * 60000 || now - (inp.lastUserAt || 0) < 60000) return null;
  const date = isoDate(new Date(now), tz);
  const docs = store.listRecords('walks').map((r) => r.data).filter(Boolean);
  const doc = docs.find((d) => d.date === date) || null;
  const goal = withDefaults(store.getRecord('settings', 'main')?.data).body.stepGoal || 8000;
  const due = walkDue({ now, tz, doc, steps: a.steps, goal, wakeHm: inp.n.wakeHm, bedHm: inp.n.bedHm, lastUserAt: inp.lastUserAt, busy: inp.busy, usualHm: usualWalkHm(docs, { today: date, tz }), fasting: inp.fasting });
  if (!due) return null;
  const v = coachVoice(due.text, voiceOpts(store));
  const r = push.list().length ? await push.notify({ title: v.title, body: v.body, url: '#/coach', tag: 'walk' }) : { sent: 0 };
  sayInTalk(store, { text: v.body, at: now, tz, kind: 'nudge', ref: `walk:${due.kind}` });
  store.writeLocal('walks', date, withAsk(doc, date, due.kind, now));
  store.setMeta(LAST, now);
  log(`walk ${due.kind}: ${v.body.slice(0, 80)} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
  return { key: `walk:${due.kind}`, body: v.body };
}

/** Which hold-off area an initiative belongs to (lib/holdoffs.js). */
const INIT_AREA = (key) => (key.startsWith('holds-') ? 'holds' : key === 'sauna' ? 'sauna-plan' : key === 'scan-safety' ? 'scan' : key);
const INIT = 'initiative:state';
export const INITIATIVE_GAP_MIN = 180;

/**
 * Coach initiatives (Wed 10/21, his words: "I've skipped the neck workout... He should suggest or ask... When do you
 * think you want to start? Let me help you... You can fit this in that day"). At most one every 3 hours, each topic at
 * most once a day; never while a workout or the sauna runs, while he is talking to the coach (10 minutes), right after
 * another notification, outside his waking hours or while nudges are paused or held. The coach writes the message
 * itself (it may answer SKIP); it is pushed and is part of the conversation, so his reply continues it.
 */
export async function initiativeTick({ store, push, coach, log = () => {}, now, tz }) {
  if (!coach?.initiate) return null;
  const inp = nudgeInputs(store, now, tz);
  if (inp.busy || now < (inp.n.nudgePausedUntil || 0) || inp.n.kinds?.coach === false) return null;
  const awake = awakeAt(now, tz, addMinHm(inp.n.wakeHm, 60), addMinHm(inp.n.bedHm, -60));
  if (!awake || now - (store.getMeta(LAST) || 0) < 10 * 60000 || now - (inp.lastUserAt || 0) < 10 * 60000) return null;
  const state = store.getMeta(INIT) || { last: 0, byKey: {} };
  if (now - state.last < INITIATIVE_GAP_MIN * 60000) return null;
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const holds = holdsOf(store);
  const items = openItems({
    today: inp.date, sessions: list('sessions'), sets: list('sets'), neck: one('schedule', 'neck'), areas: list('tendons').filter((d) => d.kind === 'area'),
    bridge: one('bridge', 'last-loads'), sauna: list('sauna'), saunaPlan: one('sauna-plan', 'main'), readiness: one('tendons', 'readiness'), scanPlan: one('scan-plan', 'main'),
    dayOf: (ms) => isoDate(new Date(ms), tz),
  }).filter((i) => now - (state.byKey[i.key] || 0) >= 22 * 3600000 && !heldOff(INIT_AREA(i.key), holds, now) && !heldOff('all', holds, now));
  const item = items[0];
  if (!item) return null;
  state.last = now; state.byKey[item.key] = now;
  store.setMeta(INIT, state);
  const msg = await coach.initiate({ instruction: initiativePrompt(item), model: withDefaults(one('settings', 'main')).coach?.model || 'fast', ref: `init:${item.key}`, tz });
  if (!msg) return null;
  const r = push.list().length ? await push.notify({ title: 'Coach', body: msg.text, url: '#/coach', tag: `init-${item.key}` }) : { sent: 0 };
  store.setMeta(LAST, now);
  log(`initiative ${item.key}: ${msg.text.slice(0, 80)} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
  return { key: `init:${item.key}`, body: msg.text };
}
const addMinHm = (hm, m) => { const [h, mm] = String(hm || '00:00').split(':').map(Number); const t = ((h * 60 + mm + m) % 1440 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** One nudge if it's time and something is open: pushed and written into Talk. Returns what was sent, or null. */
export async function nudgeTick({ store, push, log = () => {}, now, tz }) {
  const inp = nudgeInputs(store, now, tz);
  const state = store.getMeta(NUDGES) || { last: 0, byKey: {} };
  const awake = awakeAt(now, tz, inp.n.wakeHm, inp.n.bedHm);
  if (!nudgeDue({ now, everyMin: inp.n.nudgeEveryMin, awake, lastNudgeAt: state.last, lastNoticeAt: store.getMeta(LAST) || 0, lastUserAt: inp.lastUserAt, busy: inp.busy, pausedUntil: inp.n.nudgePausedUntil })) return null;
  const holds = holdsOf(store);
  const pick = pickNudge(nudgeCandidates(inp.args).filter((c) => !heldOff(c.key, holds, now)), state.byKey, now);
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

export function startNotifier({ store, push, coach = () => null, log = () => {}, tz = () => phoneZone(store), now = () => Date.now(), everyMs = 60000 }) {
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
      // What he told the coach to hold off on is skipped (lib/holdoffs.js).
      const holds = holdsOf(store);
      const items = dueNow(plan(store, t, zone), t, sent).filter((i) => !itemHeld(i, holds, t));
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
      const walk = await walkTick({ store, push, log, now: t, tz: zone });
      // One coach notification a minute: a walk question that just went out holds the other nudges.
      const nudge = walk ? null : await nudgeTick({ store, push, log, now: t, tz: zone });
      const init = walk || nudge ? null : await initiativeTick({ store, push, coach: typeof coach === 'function' ? coach() : coach, log, now: t, tz: zone });
      return [...items, ...(dishes ? [dishes] : []), ...(walk ? [walk] : []), ...(nudge ? [nudge] : []), ...(init ? [init] : [])];
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
