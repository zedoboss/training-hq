// The Mac's reminder clock (step 4): once a minute it works out today's reminders from the synced data (the same
// planner the phone uses, app/js/lib/reminders.js) and sends the ones whose time has come as push notifications.
// Sent ids are remembered in the server's meta table, so nothing is sent twice; a reminder more than 30 minutes
// late (the Mac was asleep or off) is skipped rather than sent late.
import { remindersFor, dueNow, reminderState, afterGym } from '../app/js/lib/reminders.js';
import { addDays, rotationDay } from '../app/js/lib/rotation.js';
import { isoDate, deviceTimeZone, validZone } from '../app/js/lib/time.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { dayTotals, isSnack } from '../app/js/lib/meals.js';
import { mealTimesOf, MEAL_NUDGE } from '../app/js/lib/fuel-reminders.js';
import { checklist } from '../app/js/lib/supplements.js';
import { coachReminder, coachVoice, nudgeCandidates, nudgeDue, pickNudge, awakeAt, dishesDue, mealEatenAt, DISHES_TEXT, DISHES_AFTER_MIN, AFTER_MEAL2_BUMP_MIN, AFTER_WORKOUT_QUIET_MIN } from '../app/js/lib/nudges.js';
import { walkDue, withAsk, withAnswer, usualWalkHm } from '../app/js/lib/walks.js';
import { fastingOn } from '../app/js/lib/fast.js';
import { heldOff, itemHeld } from '../app/js/lib/holdoffs.js';
import { openItems, initiativePrompt } from '../app/js/lib/initiatives.js';
import { pickLine } from '../app/js/lib/coach-talk.js';
import { protocolOf, isDone, planFor, scanTakenOn } from '../app/js/lib/scans.js';
import { zonedTime, hmOf } from '../app/js/lib/time.js';
import { healthSendsText } from './health.mjs';

export const SENT = 'notify:sent';

/** Everything the planner needs, read from the Mac's database. */
export function stateFrom(store, tz) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  return reminderState({
    sessions: list('sessions'), sets: list('sets'), tendons: list('tendons'), bridge: one('bridge', 'last-loads'),
    settings: one('settings', 'main'), meta: one('programme', 'meta'), days: list('days'), neck: one('schedule', 'neck'),
    meals: list('meals'), mealChecks: list('meal-checks'), supplements: list('supplements'), suppLog: list('supp-log'), suppAnswers: list('supp-answers'), sauna: list('sauna'), saunaPlan: one('sauna-plan', 'main'),
    scans: list('body-scans'), scanPhotos: list('scan-photos'), coachHolds: list('coach-holds'), scanPlan: one('scan-plan', 'main'), coachReminders: list('coach-reminders'),
    flexPlan: one('schedule', 'flex'), combatPlan: one('schedule', 'combat'), coachNotes: list('coach-notes'),
    ...recoveryFrom(one, list),
  }, tz);
}

/** A reminder tied to his workout has gone out: the coach's lists stop showing it as waiting. */
function markFired(store, id, t) {
  const r = store.getRecord('coach-reminders', id);
  if (r && !r.deleted) store.writeLocal('coach-reminders', id, { ...r.data, firedAt: t });
}

/** A13: his recovery record and what it needs (photos only when there is a record: they are big). */
function recoveryFrom(one, list) {
  const recoveryPlan = one('recovery', 'main');
  if (!recoveryPlan) return {};
  return { recoveryPlan, recoveryState: one('recovery', 'state'), notes: list('coach-notes'), photos: list('body-photos').map((p) => ({ date: p.date, pose: p.pose, dataUrl: Boolean(p.dataUrl) })) };
}

// Tue 10/20: a 7:30 AM holds reminder woke him (he gets up at 9 now). These kinds wait for his wake time; the sauna
// alarm, reminders he set with the coach, and the check-in and session reminders at a time he chose never move.
const WAIT_FOR_WAKE = new Set(['holds', 'supps', 'meals', 'cook', 'evening', 'neck', 'recovery', 'scan', 'flex']);

/**
 * When his day started today (Thu 10/22: the scan reminders waited for his 10:00 AM wake setting though he was up
 * before 9:00 and talking to the coach at 9:15): the earliest sign he's up, his logged wake time or his first
 * message, meal or workout from 5:00 AM on, when that is before the wake time in Settings. "HH:MM".
 */
export function wakeHmToday(store, now, tz, wakeHm) {
  const date = isoDate(new Date(now), tz);
  const from = zonedTime(date, '05:00', tz);
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const signs = [
    store.getRecord('sleep-log', date)?.data?.wake,
    ...list('coach-messages').filter((m) => m.role === 'user').map((m) => m.at),
    ...list('meals').map((m) => m.at),
    ...list('sessions').filter((x) => x.status !== 'discarded').map((x) => x.startedAt),
  ].filter((t) => Number.isFinite(t) && t >= from && t <= now && isoDate(new Date(t), tz) === date);
  if (!signs.length) return wakeHm;
  const up = hmOf(new Date(Math.min(...signs)), tz);
  return up < wakeHm ? up : wakeHm;
}

// Thu 10/22: the scan reminders before his session follow the time he chose for it, like the check-in: never moved.
const SESSION_TIMED = /^scan-(morning|arrive):/;

/** Today's and tomorrow's reminders (a check-in before an early session can fall on the evening before). */
export function plan(store, now = Date.now(), tz = deviceTimeZone()) {
  const st = stateFrom(store, tz);
  const today = isoDate(new Date(now), tz);
  const n = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const wakeToday = wakeHmToday(store, now, tz, n.wakeHm);
  const wakeOn = (d) => (d === today ? wakeToday : n.wakeHm);
  const awake = (at) => awakeAt(at, tz, wakeOn(isoDate(new Date(at), tz)), n.bedHm);
  const toWake = (at) => {
    const d = isoDate(new Date(at), tz);
    const w = zonedTime(d, wakeOn(d), tz);
    return w > at ? w : zonedTime(addDays(d, 1), n.wakeHm, tz);
  };
  const items = [today, addDays(today, 1)].flatMap((date) => remindersFor({ ...st, date }))
    .map((i) => (WAIT_FOR_WAKE.has(i.kind) && !SESSION_TIMED.test(i.id || '') && !awake(i.at) ? { ...i, at: toWake(i.at) } : i));
  return afterMeals(items, mealSpansFor(store, now, tz), st.coachReminders);
}

// ---- Reminders he set that land in a meal (Thu 10/22, his words: "check those reminders if they are within the frame
// that I told you that I'm going to finish by 5:30. So I don't need to get reminded before I finish eating... After I
// log the meal... collagen and then cleaning the dishes. And only then"; then: "not that it has to test that they're
// held until the meal is logged. This is just specific right now, because of how the time frame fits"). Not a rule for
// every errand: only one whose time falls while he cooks or eats moves, to after that meal's collagen and dishes.
// Outside his meals every reminder fires on time; so does one he set during the meal or for within 30 minutes (about the
// meal or the moment: "take a shower now", "clean the dishes", "are you home? cooking?"). The coach can say which way
// when he says (meal: 'wait' | 'on-time' on the reminder).
export const MEAL_HOLD = { graceMin: 30, washMin: 10, chainMaxMin: 45, nearMin: 30 };

/**
 * Today's meals as the spans he is busy with them: from the start-cooking time (or his "about to cook" / "cooking"
 * answer) until the dishes are done: the dishes prompt plus 10 minutes, after the second meal's collagen is ticked; at
 * most 45 minutes after he ate. Not logged yet: until 30 minutes past the latest he set, or past the time he said he'd
 * finish by, whichever is later. Skipped: none. [{name, start, end, open}]; open = still on, end is the most it waits.
 */
export function mealSpans({ date, tz, now, mealTimes = [], meals = [], checks = [], dishes = {}, dishesOn = true }) {
  const slots = mealTimesOf(mealTimes);
  const win = MEAL_NUDGE.windowMin * 60000;
  const eaten = meals.filter((m) => m.date === date && m.at && !isSnack(m)).sort((a, b) => a.at - b.at);
  return slots.map((slot, k) => {
    const slotAt = zonedTime(date, slot.time, tz);
    const check = checks.find((c) => c.id === `${date}.${slot.time.replace(':', '')}`);
    if (check?.answer === 'skipped') return null;
    const nextFrom = slots[k + 1] ? zonedTime(date, slots[k + 1].time, tz) - win : Infinity;
    const meal = eaten.find((m) => m.at >= slotAt - win && m.at < nextFrom);
    const said = check && (check.answer === 'soon' || check.answer === 'cooking') ? check.at : Infinity;
    const start = Math.min(slotAt - (slot.cookMin || 0) * 60000, said, meal?.at ?? Infinity);
    if (meal) {
      const ate = mealEatenAt(meal, dishes.seen?.[meal.id] ?? meal.at);
      const w = dishes.after2?.[date];
      const collagen = w?.id === meal.id && w.asked ? w.done : ate;
      const washed = !dishesOn ? ate : dishes.sent?.[meal.id] != null ? dishes.sent[meal.id] + MEAL_HOLD.washMin * 60000 : null;
      const cap = ate + MEAL_HOLD.chainMaxMin * 60000;
      const end = collagen != null && washed != null ? Math.min(Math.max(collagen, washed), cap) : cap;
      return { name: slot.name, start, end, open: now < end && (collagen == null || washed == null) };
    }
    if (check?.answer === 'eaten') return { name: slot.name, start, end: check.at, open: false };
    const finish = Math.max(slot.latest ? zonedTime(date, slot.latest, tz) : slotAt + MEAL_NUDGE.afterMin * 60000,
      /^\d{2}:\d{2}$/.test(check?.until || '') ? zonedTime(date, check.until, tz) : 0);
    const end = finish + MEAL_HOLD.graceMin * 60000;
    return { name: slot.name, start, end, open: now < end };
  }).filter(Boolean);
}

/** The spans from the Mac's database. */
export function mealSpansFor(store, now, tz) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const st = withDefaults(store.getRecord('settings', 'main')?.data);
  const date = isoDate(new Date(now), tz);
  return mealSpans({ date, tz, now, mealTimes: st.fuel.mealTimes, meals: list('meals'), checks: list('meal-checks'), dishes: store.getMeta(DISHES) || {}, dishesOn: st.notify.kinds?.dishes !== false });
}

/**
 * Reminders he set (kind 'coach', at a clock time) that land in a meal span move to its end: not due until then while
 * the meal is still on. Unless set during that meal or for within 30 minutes, or the coach set it 'on-time'.
 */
export function afterMeals(items, spans, reminders = []) {
  if (!spans.length) return items;
  const byId = new Map(reminders.map((r) => [`coach:${r.id}`, r]));
  return items.map((i) => {
    const r = i.kind === 'coach' && !i.trigger ? byId.get(i.id) : null;
    if (!r || r.meal === 'on-time') return i;
    const set = r.createdAt ?? 0;
    const s = spans.find((x) => i.at >= x.start && i.at < x.end
      && (r.meal === 'wait' || (set < x.start && i.at - set > MEAL_HOLD.nearMin * 60000)));
    return s ? { ...i, at: s.end, afterMeal: s.name, waiting: s.open, plannedAt: i.at } : i;
  });
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

/**
 * A workout or the sauna running. A holds session counts only for its first 30 minutes: a round takes a few (Thu 10/22:
 * a wrist round left open at 11:32 AM kept the dishes after his first meal from ever coming).
 */
const HOLDS_BUSY_MIN = 30;
const WORKOUT_BUSY_MIN = 240;
/**
 * A session in progress: a workout for up to 4 hours, a holds round for its first 30 minutes. Also what holds back the
 * server's restart after a coach change (Thu 10/22: a round left open at 11:52 AM held every restart back until 1:59
 * PM, so the changes he asked for in that time weren't live).
 */
export const sessionBusy = (sessions, now) => sessions.some((x) => x?.status === 'active' && now - (x.startedAt || 0) < (x.kind === 'holds' ? HOLDS_BUSY_MIN : WORKOUT_BUSY_MIN) * 60000);
// The dishes prompt more than 15 minutes late (the Mac asleep, busy or restarting) is old news: not sent.
const DISHES_LATE_MIN = 15;
const busyNow = (list, now) => sessionBusy(list('sessions'), now)
  || list('sauna').some((x) => x.status === 'active');

/** What the nudges need, read from the Mac's database. */
export function nudgeInputs(store, now, tz) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const st = stateFrom(store, tz);
  const date = isoDate(new Date(now), tz);
  const n0 = withDefaults(one('settings', 'main')).notify;
  // His day starts when he's up (wakeHmToday), for every nudge below.
  const n = { ...n0, wakeHm: wakeHmToday(store, now, tz, n0.wakeHm) };
  const health = one('health', date);
  const plan = one('fuel', 'plan');
  const eaten = dayTotals(list('meals'), list('meal-estimates'), date);
  const trained = st.trainedDates?.has?.(date) || false;
  const rot = rotationDay({ last: st.last, today: date, days: st.days || {} });
  const groups = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: rot.today.kind === 'train' || trained ? 'train' : 'rest' });
  const untimed = groups.filter((g) => !g.time && !g.afterMeal && !g.afterMeal2).flatMap((g) => g.items);
  const afterMeal = groups.filter((g) => g.afterMeal).flatMap((g) => g.items);
  const firstMealAt = Math.min(...list('meals').filter((m) => m.date === date && m.at && !isSnack(m)).map((m) => m.at));
  const fasting = fastingOn(st.days || {}, date, list('meals'));
  return {
    date, n, fasting,
    busy: busyNow(list, now),
    lastUserAt: Math.max(0, ...list(MSGS).filter((m) => m.role === 'user').map((m) => m.at || 0)),
    args: {
      now, tz, wakeHm: n.wakeHm, bedHm: n.bedHm, fasting,
      reminders: remindersFor({ ...st, date }),
      rot,
      // The count is over everything due today that he has (Thu 10/22, his words: "0 out of 4 doesn't make sense... I've
      // only taken 3 so far"); the open names are the ones with no time (the rest have their own prompts).
      suppsUntimed: untimed.length ? { total: groups.flatMap((g) => g.items).length, taken: groups.flatMap((g) => g.items).filter((i) => i.entry?.status === 'taken').length, open: untimed.filter((i) => !i.entry).map((i) => i.supp.name) } : null,
      suppsAfterMeal: afterMeal.length && Number.isFinite(firstMealAt) ? { open: afterMeal.filter((i) => !i.entry).map((i) => i.supp.name), mealAt: firstMealAt } : null,
      sessionHm: st.days?.[date]?.sessionTime || null,
      session: { started: trained, done: trained },
      weighedToday: list('measurements').some((m) => m.date === date && m.weightKg != null) || Boolean(health?.weights?.length)
        || scanTakenOn(list('body-scans'), date, list('scan-photos').map((p) => p.scanId)),
      sleepLogged: Boolean(health?.sleep || one('sleep-log', date)),
      wokeAt: one('sleep-log', date)?.wake ?? health?.sleep?.wake ?? null,
      workoutEndedAt: Math.max(0, ...list('sessions').filter((x) => x.status === 'done' && x.kind !== 'holds' && x.endedAt && isoDate(new Date(x.endedAt), tz) === date).map((x) => x.endedAt)) || null,
      mealAfterGymAt: afterGym({ date, activity: st.activity, areas: st.areas, rounds: st.rounds, scans: st.scans, scanPlan: st.scanPlan })?.mealAt ?? null,
      lastMealAt: Math.max(0, ...list('meals').filter((m) => m.date === date && m.at).map((m) => m.at)) || null,
      // His last answer to a meal question (eaten, about to cook, cooking, skipping): the after-workout meal nudge stops on it.
      mealAnsweredAt: Math.max(0, ...list('meal-checks').filter((c) => c.date === date && c.at).map((c) => c.at)) || null,
      morning: n.morning || null,
      eaten: { kcal: eaten.kcal, protein: eaten.protein, unread: eaten.unread || 0 },
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
  const n0 = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const n = { ...n0, wakeHm: wakeHmToday(store, now, tz, n0.wakeHm) };
  const date = isoDate(new Date(now), tz);
  const meals = list('meals').filter((m) => m.date === date);
  const st = store.getMeta(DISHES);
  const state = st || { seen: {}, sent: {} };
  for (const m of meals) {
    if (!state.seen[m.id]) state.seen[m.id] = now;
    if (!st) state.sent[m.id] = now; // first run: nothing from before
  }
  for (const [id, at] of Object.entries(state.seen)) if (now - at > 2 * 86400000) { delete state.seen[id]; delete state.sent[id]; }
  const busy = busyNow(list, now);
  let out = null;
  // The first meal of the day, the moment it is logged (Tue 10/20, his words): "take your supplements" at once, with
  // the ones he takes after it that aren't ticked yet. A snack isn't his first meal (Thu 10/22, his words: "I take them
  // after the first and the second meal, not after the snack"). Then the dishes, two minutes later, as below.
  // Once a day, kept as the meal it was for (Thu 10/22: a mark left by the morning snack blocked it after breakfast).
  const first = meals.filter((m) => m.at && !isSnack(m)).sort((a, b) => a.at - b.at)[0];
  const holds = holdsOf(store);
  if (first && st && state.suppsFor?.[date] !== first.id && state.seen[first.id] === now && !heldOff('supps-after-meal', holds, now)) {
    const groups = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: 'train' });
    const open = groups.filter((g) => g.afterMeal).flatMap((g) => g.items).filter((i) => !i.entry).map((i) => i.supp.name);
    state.suppsFor = { [date]: first.id };
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
  // After the second meal (Thu 10/22, his words, lib/nudges.js): "get up and take collagen" once it is eaten, again
  // every 5 minutes until it's ticked or skipped (on the phone or to the coach); that meal's dishes wait for it, then
  // go out at once.
  const second = meals.filter((m) => m.at && !isSnack(m)).sort((a, b) => a.at - b.at)[1];
  const readyAt = {};
  if (second && st && second.at > now - 3 * 3600000) {
    const open2 = checklist({ supps: list('supplements'), log: list('supp-log'), date, dayKind: 'train' }).filter((g) => g.afterMeal2)
      .flatMap((g) => g.items).filter((i) => !i.entry).map((i) => i.supp.short || i.supp.name);
    const w = state.after2?.[date]?.id === second.id ? state.after2[date] : null;
    const say = async (text, tag) => {
      const opts = voiceOpts(store);
      const line = pickLine(opts.bank, 'nudge', { moods: opts.moods, intensity: opts.intensity });
      const body = `${text}${line?.text ? ` ${line.text}` : ''}`;
      const r = push.list().length ? await push.notify({ title: 'Coach', body, url: '#/supps', tag }) : { sent: 0 };
      sayInTalk(store, { text: body, at: now, tz, kind: 'nudge', ref: `supps-after-meal-2:${second.id}` });
      store.setMeta(LAST, now);
      log(`after second meal: ${text.slice(0, 60)} (${r.sent} sent)`);
      out = { key: 'supps-after-meal-2', body };
    };
    if (!w && mealEatenAt(second, state.seen[second.id]) <= now && !heldOff('supps-after-meal', holds, now)) {
      state.after2 = { [date]: { id: second.id, asked: open2.length ? now : null, last: now, done: open2.length ? null : now } };
      if (open2.length) await say(`${second.name || 'Second meal'} done. Get up and take your ${open2.join(', ')} now. I'll ask again every ${AFTER_MEAL2_BUMP_MIN} minutes until you tick it.`, 'supps-after-meal-2');
    } else if (w?.asked && !w.done) {
      if (!open2.length) w.done = now;
      else if (now - w.last >= AFTER_MEAL2_BUMP_MIN * 60000 && !busy && awakeAt(now, tz, n.wakeHm, n.bedHm) && !heldOff('supps-after-meal', holds, now)) {
        w.last = now;
        await say(`Still waiting: ${open2.join(', ')}. Get up and take it now, then the dishes.`, 'supps-after-meal-2');
      }
    }
    const w2 = state.after2?.[date];
    if (w2?.id === second.id && w2.asked) readyAt[second.id] = w2.done || Infinity;
  }
  const ready = n.kinds?.dishes === false || busy || !awakeAt(now, tz, n.wakeHm, n.bedHm) || heldOff('dishes', holds, now) ? [] : dishesDue({ meals, seen: state.seen, sent: state.sent, now, readyAt });
  // Late, or already said by the coach (Thu 10/22, his words: "Why did the notification get sent right now for me to do
  // the dishes?" His 1:15 PM meal's came at 1:59 PM, after the coach's own reminder at 1:34 PM): counted, not sent.
  const said = list('coach-messages').filter((x) => x.role === 'assistant' && x.kind !== 'nudge' && /\bdish/i.test(x.text || ''));
  const dueAt = (m) => (m.id in readyAt ? readyAt[m.id] : mealEatenAt(m, state.seen[m.id]) + DISHES_AFTER_MIN * 60000);
  const skip = ready.filter((m) => now - dueAt(m) > DISHES_LATE_MIN * 60000 || said.some((x) => x.at >= state.seen[m.id]));
  for (const m of skip) state.sent[m.id] = now;
  if (skip.length) log(`dishes after ${skip.map((m) => m.name || m.id).join(', ')}: not sent (late, or the coach already said it)`);
  const due = ready.filter((m) => !skip.includes(m));
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
  if (state.after2) for (const d of Object.keys(state.after2)) if (d < date) delete state.after2[d];
  store.setMeta(DISHES, state);
  return out;
}

/** The last thing he did at home since `since` (a meal answer soon, cooking or eaten; a meal; a workout or holds started), or 0. */
export function homeSince(store, since) {
  const list = (col) => store.listRecords(col).map((r) => r.data).filter(Boolean);
  const times = [
    ...list('meal-checks').filter((c) => ['soon', 'cooking', 'eaten'].includes(c.answer)).map((c) => c.at),
    ...list('meals').map((m) => m.at),
    ...list('sessions').map((x) => x.startedAt),
  ].filter((t) => Number.isFinite(t) && t > since);
  return times.length ? Math.max(...times) : 0;
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
  const due = walkDue({ now, tz, doc, steps: a.steps, goal, wakeHm: inp.n.wakeHm, bedHm: inp.n.bedHm, lastUserAt: inp.lastUserAt, busy: inp.busy, usualHm: usualWalkHm(docs, { today: date, tz }), fasting: inp.fasting, weather: store.getMeta('weather'), homeAt: doc?.going ? homeSince(store, doc.going.at) : 0 });
  if (!due) return null;
  const v = coachVoice(due.text, { ...voiceOpts(store), calm: due.calm });
  const r = push.list().length ? await push.notify({ title: v.title, body: v.body, url: '#/coach', tag: 'walk' }) : { sent: 0 };
  sayInTalk(store, { text: v.body, at: now, tz, kind: 'nudge', ref: `walk:${due.kind}` });
  // Too hot or bright: the coach planned (or moved) the walk itself; quiet until then.
  const asked = withAsk(doc, date, due.kind, now);
  store.writeLocal('walks', date, due.planAt ? withAnswer(asked, date, { action: 'plan', at: due.planAt, said: 'planned by the coach for cooler weather' }, now) : asked);
  store.setMeta(LAST, now);
  log(`walk ${due.kind}: ${v.body.slice(0, 80)} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
  return { key: `walk:${due.kind}`, body: v.body };
}

/** Which hold-off area an initiative belongs to (lib/holdoffs.js). */
const INIT_AREA = (key) => (key.startsWith('holds-') || key.startsWith('phase-') ? 'holds' : key === 'sauna' ? 'sauna-plan' : key === 'scan-safety' ? 'scan' : key.startsWith('q-') ? 'questions' : key);
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
    questions: store.listRecords('coach-questions').filter((r) => !r.deleted).map((r) => ({ id: r.id, ...r.data })),
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

/**
 * The next reminder or dishes due before the next minute's tick (Thu 10/22: the coach's "dishes in 2 minutes" was due
 * 1:33:54 PM, the clock ticked at :52, so it went out at 1:34:52 PM). Its exact time, or null.
 */
export function nextDueAt(store, now, tz, withinMs = 60000) {
  const sent = store.getMeta(SENT) || {};
  const ds = store.getMeta(DISHES) || { seen: {}, sent: {} };
  // Waiting for his collagen after the second meal: the next bump on the second, and a look every 10 seconds so the
  // dishes follow at once when he ticks it.
  const w = ds.after2?.[isoDate(new Date(now), tz)];
  const waiting = w?.asked && !w.done ? [w.last + AFTER_MEAL2_BUMP_MIN * 60000, now + 10000] : [];
  const times = [
    ...waiting,
    ...plan(store, now, tz).filter((i) => i.due && !sent[i.id]).map((i) => i.at),
    ...Object.entries(ds.seen || {}).filter(([id]) => !ds.sent?.[id] && !(w?.id === id && w.asked && !w.done)).map(([, at]) => at + DISHES_AFTER_MIN * 60000),
  ].filter((at) => at > now && at - now < withinMs);
  return times.length ? Math.min(...times) : null;
}

export function startNotifier({ store, push, coach = () => null, log = () => {}, tz = () => phoneZone(store), now = () => Date.now(), everyMs = 60000 }) {
  let busy = false;
  let lastZone = null;
  let soon = null;
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
      const due = dueNow(plan(store, t, zone), t, sent).filter((i) => !itemHeld(i, holds, t));
      // A run of repeats due at once (the meal asked every 5 minutes, the Mac asleep a while): the latest only; the
      // rest count as sent.
      const latest = new Map();
      for (const i of due) if (i.group && !(latest.get(i.group)?.at >= i.at)) latest.set(i.group, i);
      for (const i of due) if (i.group && latest.get(i.group) !== i) sent[i.id] = t;
      const items = due.filter((i) => !i.group || latest.get(i.group) === i);
      if (items.length) {
        const opts = voiceOpts(store);
        for (const i of items) {
          // The coach says it (Mon 10/19): title "Coach", the reminder's facts, one short line in his moods. A coach
          // reminder can carry live facts (Wed 10/21: "are my steps counted?" gets what the Shortcut really sent).
          const v = coachReminder(i.facts === 'health' ? { ...i, body: `${i.body} ${healthSendsText(store, { since: i.since, now: t, tz: zone })}` } : i, opts);
          const r = await push.notify({ title: v.title, body: v.body, url: i.url, tag: i.tag });
          sent[i.id] = t;
          sayInTalk(store, { text: v.body, at: t, tz: zone, kind: 'reminder', ref: i.id });
          if (i.trigger) markFired(store, i.id.slice('coach:'.length), t);
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
      // Something due before the next tick: an extra tick on the second it's due.
      clearTimeout(soon);
      const next = nextDueAt(store, t, zone, everyMs);
      soon = next ? setTimeout(tick, next - t + 250) : null;
      soon?.unref?.();
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
  return { tick, stop: () => { clearTimeout(first); clearTimeout(soon); clearInterval(timer); } };
}
