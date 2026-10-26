// The Mac's reminder clock (step 4): once a minute it works out today's reminders from the synced data (the same
// planner the phone uses, app/js/lib/reminders.js) and sends the ones whose time has come as push notifications.
// Sent ids are remembered in the server's meta table, so nothing is sent twice; a reminder more than 30 minutes
// late (the Mac was asleep or off) is skipped rather than sent late.
import { remindersFor, dueNow, reminderState, afterGym } from '../app/js/lib/reminders.js';
import { addDays, rotationDay } from '../app/js/lib/rotation.js';
import { isoDate, deviceTimeZone, validZone } from '../app/js/lib/time.js';
import { withDefaults } from '../app/js/lib/settings.js';
import { dayTotals, isSnack, isEmptyMeal } from '../app/js/lib/meals.js';
import { mealTimesOf, MEAL_NUDGE } from '../app/js/lib/fuel-reminders.js';
import { checklist } from '../app/js/lib/supplements.js';
import { coachReminder, coachVoice, heldPlanText, nudgeCandidates, nudgeDue, pickNudge, awakeAt, dishesDue, mealEatenAt, leavesDishes, DISHES_TEXT, DISHES_AFTER_MIN, AFTER_MEAL2_BUMP_MIN, AFTER_WORKOUT_QUIET_MIN, AWAY_REMIND_MIN, awaySuppsText, after2GapMin, ateOut, ownSuppsTime, morningStep, morningBodyText, lastWorkoutPain } from '../app/js/lib/nudges.js';
import { walkDue, withAsk, withAnswer, usualWalkHm } from '../app/js/lib/walks.js';
import { fastingOn } from '../app/js/lib/fast.js';
import { wakingDay } from '../app/js/lib/waking-day.js';
import { heldOff, itemHeld } from '../app/js/lib/holdoffs.js';
import { duePhasePlans } from '../app/js/lib/holds.js';
import { openItems, initiativePrompt } from '../app/js/lib/initiatives.js';
import { pickLine } from '../app/js/lib/coach-talk.js';
import { protocolOf, isDone, planFor, scanTakenOn } from '../app/js/lib/scans.js';
import { zonedTime, hmOf, formatTime } from '../app/js/lib/time.js';
import { healthSendsText } from './health.mjs';

export const SENT = 'notify:sent';

/** Everything the planner needs, read from the Mac's database. */
export function stateFrom(store, tz) {
  const list = (col) => recordsOf(store, col);
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

/** A reminder he set has gone out (timed or at his workout start; Fri 10/23): the coach's lists stop showing it as waiting. */
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
// A reminder held for his morning or a workout this long past its time, naming a time, is said as what to do now
// (heldPlanText).
const HELD_OVERDUE_MIN = 30;
const WAIT_FOR_WAKE = new Set(['holds', 'supps', 'meals', 'cook', 'evening', 'neck', 'recovery', 'scan', 'flex']);

/**
 * When his day started today (Thu 10/22: the scan reminders waited for his 10:00 AM wake setting though he was up
 * before 9:00 and talking to the coach at 9:15): the earliest sign he's up, his logged wake time or his first
 * message, meal or workout from 5:00 AM on, when that is before the wake time in Settings. "HH:MM".
 */
/** Sat 10/24: the day food and supplements count toward now (after midnight, before he has slept: the day before). */
export function foodDayOf(store, now, tz) {
  const date = isoDate(new Date(now), tz);
  const one = (col) => { const r = store.getRecord(col, date); return r && !r.deleted ? r.data : null; };
  return wakingDay(now, { tz, sleepLog: one('sleep-log'), health: one('health'), sessions: recordsOf(store, 'sessions') });
}

export function wakeHmToday(store, now, tz, wakeHm) {
  const date = isoDate(new Date(now), tz);
  const from = zonedTime(date, '05:00', tz);
  const list = (col) => recordsOf(store, col);
  const ok = (t) => Number.isFinite(t) && t >= from && t <= now && isoDate(new Date(t), tz) === date;
  // Tue 10/27: a message or meal while he's still up from the night isn't him waking (SLEEP).
  const said = [...list('coach-messages').filter((m) => m.role === 'user').map((m) => m.at), ...list('meals').map((m) => m.at)];
  const signs = [
    store.getRecord('sleep-log', date)?.data?.wake,
    ...said.filter((t) => ok(t) && wokeBy(store, t, tz)),
    ...list('sessions').filter((x) => x.status !== 'discarded').map((x) => x.startedAt),
  ].filter(ok);
  if (!signs.length) return wakeHm;
  const up = hmOf(new Date(Math.min(...signs)), tz);
  return up < wakeHm ? up : wakeHm;
}

// Thu 10/22: the scan reminders before his session follow the time he chose for it, like the check-in: never moved.
const SESSION_TIMED = /^scan-(morning|arrive):/;

// ---- His morning (Fri 10/23, lib/nudges.js morningStep): "Are you up?" at his wake time, then sleep, then his body
// (pain from his last workout first), one at a time; the day's reminders that wait for his wake time, the nudges, the
// walk coach, the coach's own questions and the overnight message wait until that's through. What came due meanwhile
// goes out after it, as one message. Reminders he set, the sauna, and the check-in and session at a time he chose keep
// their time.
export const MORNING_STATE = 'morning:state';
/** The coach's own replies in Talk (not the app's notifications). */
const COACH_REPLY = (m) => m.role === 'assistant' && !m.kind && !m.error;
const ASKS_SLEEP = /\b(sleep|slept|bed)\b[^.!?]*\?/i;
const ASKS_BODY = /\b(back|body|sore\w*|knees?|pain|hurts?|hurting)\b[^.!?]*\?/i;

// Tue 10/27, his words: "under which assumption did you assume that I went to bed when I messaged you at 1:46 AM and
// when I'm messaging you now? Isn't it more obvious to assume that I haven't slept": he was on the app at 2:16 AM, it
// opened again at 5:18 AM and "How did you sleep?" went out, the open being the first sign from 5:00 AM. He hadn't
// slept. Now a sign counts as him waking only after a real sleep gap: gapH hours with no sign of him at all (a message,
// a meal, a tick, the app opened...), the gap ending from wakeFromHm on (his bedtimes run to about 4:00 AM; a quiet
// evening isn't a night's sleep). Up through the night with no such gap: he hasn't slept, no sleep question.
// activeH: with no wake sign, a sign this recent means he's still up (not asleep): no "Are you up?" either.
export const SLEEP = { gapH: 4, wakeFromHm: '03:00', activeH: 2 };

/** Every sign of him from `since` to now, sorted: his messages, meals, meal answers, ticks, workouts, the app. */
function signsOf(store, since, now) {
  const list = (col) => recordsOf(store, col);
  return [
    ...list('coach-messages').filter((m) => m.role === 'user').map((m) => m.at),
    ...list('meals').map((m) => m.at),
    ...list('meal-checks').map((c) => c.at),
    ...list('supp-log').map((e) => e.at),
    ...list('sessions').filter((x) => x.status !== 'discarded').map((x) => x.startedAt),
    ...list('here').filter((h) => h.phone).map((h) => h.at),
    ...(store.getMeta(APP_OPENS)?.at || []),
    ...list('health').map((d) => d.fileAt),
  ].filter((t) => Number.isFinite(t) && t >= since && t <= now).sort((a, b) => a - b);
}

/** When his stretch awake that includes `t` began: back over every gap shorter than SLEEP.gapH. */
function awakeSince(signs, t) {
  let s = t;
  for (let i = signs.length - 1; i >= 0; i--) {
    if (signs[i] >= s) continue;
    if (s - signs[i] >= SLEEP.gapH * 3600000) break;
    s = signs[i];
  }
  return s;
}

/** A sign at `t` is him up after sleeping: his stretch awake began after a sleep gap ending from SLEEP.wakeFromHm. */
const wokeBy = (store, t, tz) => {
  const date = isoDate(new Date(t), tz);
  return awakeSince(signsOf(store, t - 86400000, t), t) >= zonedTime(date, SLEEP.wakeFromHm, tz);
};

/**
 * The first sign he's up today, from 5:00 AM, after a night's sleep (SLEEP): his message, a meal or his answer to a
 * meal question, a supplement ticked, a workout or holds round started, the app opened (its zone report, its open
 * report), Apple Health. His sleep log's wake time counts as it is.
 * A workout started after midnight counts too (his sessions start from 3:00 AM): with no answer to "Are you up?" the
 * day now waits for him, so an early session must not leave it waiting.
 */
export function upAtToday(store, now, tz) {
  const date = isoDate(new Date(now), tz);
  const from = zonedTime(date, '05:00', tz);
  const early = zonedTime(date, SLEEP.wakeFromHm, tz);
  const workout = recordsOf(store, 'sessions').filter((x) => x.kind !== 'holds' && x.status !== 'discarded' && Number.isFinite(x.startedAt)
    && x.startedAt <= now && isoDate(new Date(x.startedAt), tz) === date).map((x) => x.startedAt);
  const all = signsOf(store, from - 86400000, now);
  const woke = all.find((t) => t >= from && awakeSince(all, t) >= early);
  const logged = store.getRecord('sleep-log', date)?.data?.wake;
  const signs = [logged, woke].filter((t) => Number.isFinite(t) && t >= from && t <= now).concat(workout);
  return signs.length ? Math.min(...signs) : null;
}

/** A sign of him within SLEEP.activeH: with no sign he woke today, he's still up from the night, not asleep. */
const stillUp = (store, now) => signsOf(store, now - SLEEP.activeH * 3600000, now).length > 0;

/** Where his morning is now (read only): morningStep's {hold, open, ask}, with today's state and when it opened. */
export function morningGate(store, now, tz) {
  const date = isoDate(new Date(now), tz);
  const n = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const m = store.getMeta(MORNING_STATE);
  const state = m?.date === date ? m : { date };
  const off = { hold: false, open: true, ask: null, state, date, openAt: null, off: true };
  // Nudges off or paused, or he asked the coach to hold off everything: no morning questions, nothing held.
  if (!n.nudgeEveryMin || now < (n.nudgePausedUntil || 0) || heldOff('morning', holdsOf(store), now)) return off;
  const list = (col) => recordsOf(store, col);
  const health = store.getRecord('health', date)?.data;
  const wakeAt = zonedTime(date, n.wakeHm, tz);
  const upAt = upAtToday(store, now, tz);
  const msgs = list(MSGS);
  const since = Math.min(state.up || Infinity, upAt ?? Infinity, wakeAt);
  const replies = msgs.filter((x) => COACH_REPLY(x) && x.at >= since && x.at <= now);
  const askedBy = (re) => Math.max(0, ...replies.filter((x) => re.test(x.text || '')).map((x) => x.at)) || null;
  const sessions = list('sessions');
  const trainedToday = sessions.some((x) => x.kind !== 'holds' && x.status !== 'discarded' && x.startedAt && isoDate(new Date(x.startedAt), tz) === date);
  const step = morningStep({
    now, wakeAt, upAt, state, upNoSleep: !upAt && stillUp(store, now),
    sleepKnown: Boolean(health?.sleep || store.getRecord('sleep-log', date)?.data),
    bodyKnown: Boolean(store.getRecord('days', date)?.data?.readiness) || trainedToday,
    coachAsked: { sleep: askedBy(ASKS_SLEEP), body: askedBy(ASKS_BODY) },
    lastUserAt: Math.max(0, ...msgs.filter((x) => x.role === 'user').map((x) => x.at || 0)),
    lastCoachAt: Math.max(store.getMeta(LAST) || 0, ...msgs.filter((x) => x.role === 'assistant').map((x) => x.at || 0)),
    bodyText: morningBodyText(lastWorkoutPain({ sessions, sets: list('sets'), today: date, tz }), date, tz),
  });
  return { ...step, state, date, openAt: step.open ? state.open || now : null, upAt };
}

// Sat 10/24, his words: "Auto greet when i open the app Too by the coach speaking pls". He opened the app at 2:23 PM
// (no answer to "Are you up?" at 10:00 AM) and the coach said nothing until he spoke. Now the phone tells the Mac each
// time the app comes on screen (POST /api/app/opened), and the first time in his day (after midnight before he has
// slept still counts for the day before), before he has written, the coach greets him: "Morning." with the morning's
// next question in the same message, written into Talk and said out loud (lib/voice.js watchNudges). No notification:
// he is in the app. Once a day; not when the morning is off or held off, not during a workout or the sauna, not if he
// wrote first. A greeting this many minutes after the open (the Mac asleep or restarting) is old news: not sent.
export const GREET = { text: 'Morning.', freshMin: 10 };
export const APP_OPENS = 'app:opens';

/** The phone opened the app (came on screen) at `at`: kept 36 hours (the last 100). */
export function noteAppOpen(store, at, tz) {
  const date = isoDate(new Date(at), tz);
  const m = store.getMeta(APP_OPENS);
  // Tue 10/27: the last 36 hours, across midnight, so a sleep gap shows (SLEEP).
  const list = (m?.at || []).filter((t) => at - t < 36 * 3600000).concat(at).slice(-100);
  store.setMeta(APP_OPENS, { date, at: list });
}
const appOpens = (store, now, tz) => { const d = isoDate(new Date(now), tz); return (store.getMeta(APP_OPENS)?.at || []).filter((t) => t <= now && isoDate(new Date(t), tz) === d); };

/**
 * Once a minute, first: notes when the morning started holding and when it opened, and asks the next question when
 * it's time (pushed and written into Talk). His first open of the day gets the greeting. Returns what was sent, or null.
 */
export async function morningTick({ store, push, log = () => {}, now, tz }) {
  const g = morningGate(store, now, tz);
  const st = { ...g.state };
  const start = zonedTime(g.date, withDefaults(store.getRecord('settings', 'main')?.data).notify.wakeHm, tz);
  // Held from his wake time (the Mac asleep then: up to 30 minutes later, what a late reminder may still be); first
  // seen later (the server just updated mid-day): from now, so nothing older is let out.
  if (g.hold && !st.from) st.from = now - start < 30 * 60000 ? Math.min(start, now) : now;
  if (g.open && st.from && !st.open) st.open = g.openAt;
  let out = null;
  const busy = busyNow((col) => recordsOf(store, col), now);
  const today = (at) => foodDayOf(store, at, tz) === g.date;
  const opened = Math.max(0, ...appOpens(store, now, tz).filter(today)) || null;
  // Wrote first: since he woke (Tue 10/27: a message while still up from the night is not his day yet).
  const wrote = recordsOf(store, MSGS).some((m) => m.role === 'user' && m.at >= (g.upAt ?? zonedTime(g.date, '05:00', tz)) && m.at <= now && today(m.at));
  const greet = !g.off && g.upAt != null && !st.greet && !busy && !wrote && opened != null && now - opened < GREET.freshMin * 60000;
  const ask = g.ask && g.ask.key !== 'up' ? g.ask : null; // he opened the app: he's up, no need to ask
  if (greet || (g.ask && !busy)) {
    const key = greet ? (ask ? `greet:${ask.key}` : 'greet') : g.ask.key;
    const v = coachVoice(greet ? [GREET.text, ask?.text].filter(Boolean).join(' ') : g.ask.text, { calm: true });
    const r = !greet && push.list().length ? await push.notify({ title: v.title, body: v.body, url: '#/coach', tag: `morning-${key}` }) : { sent: 0 };
    sayInTalk(store, { text: v.body, at: now, tz, kind: 'nudge', ref: `morning:${key}` });
    if (greet) st.greet = now;
    const asked = greet ? ask : g.ask;
    if (asked) st[asked.key] = now;
    // The nudges' own sleep question is this one: not again today.
    if (asked?.key === 'sleep') { const ns = store.getMeta(NUDGES) || { last: 0, byKey: {} }; ns.byKey.sleep = now; store.setMeta(NUDGES, ns); }
    store.setMeta(LAST, now);
    log(`morning ${key}: ${v.body.slice(0, 80)} (${r.sent} sent)`);
    out = { key: `morning:${key}`, body: v.body };
  }
  if (JSON.stringify(st) !== JSON.stringify(g.state)) store.setMeta(MORNING_STATE, st);
  return out;
}

/** For the coach, with every message: where his morning is while it is still going. */
export function morningContext(store, now, tz) {
  const g = morningGate(store, now, tz);
  if (!g.hold) return '';
  const t = (ms) => formatTime(new Date(ms), tz);
  const asked = [['up', '"Are you up?"'], ['sleep', 'how he slept'], ['body', 'how his body feels']].filter(([k]) => g.state[k]).map(([k, w]) => `${w} at ${t(g.state[k])}`);
  return `His morning (his rule, Fri 10/23): one question at a time, in this order: is he up, how he slept, how his body feels (${morningBodyText(lastWorkoutPain({ sessions: recordsOf(store, 'sessions'), sets: recordsOf(store, 'sets'), today: g.date, tz }), g.date, tz)}), then the day's plan. The app ${asked.length ? `asked ${asked.join(', ')}` : 'has asked nothing yet'}, and holds the day's reminders until that's through. When he answers one, ask the next yourself, one question, never the plan first.`;
}

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
  const waits = (i) => WAIT_FOR_WAKE.has(i.kind) && !SESSION_TIMED.test(i.id || '');
  // His morning (morningGate): while it holds, what comes due waits; once through, it goes out then, together.
  const g = morningGate(store, now, tz);
  const from = g.state.from ?? now;
  const held = (i) => waits(i) && i.at >= from && isoDate(new Date(i.at), tz) === today;
  const items = [today, addDays(today, 1)].flatMap((date) => remindersFor({ ...st, date }))
    .map((i) => (waits(i) && !awake(i.at) ? { ...i, at: toWake(i.at) } : i))
    .map((i) => (g.hold && held(i) && i.at <= now + 60000 ? { ...i, at: now + 2 * 60000, morning: 'waiting' }
      : !g.hold && g.state.from && g.openAt && held(i) && i.at < g.openAt ? { ...i, at: g.openAt, morning: 'after', heldAt: i.at } : i));
  return afterMeals(afterWorkouts(items, workoutSpans(st, recordsOf(store, 'sessions'), now, tz), now, waits), mealSpansFor(store, now, tz), st.coachReminders);
}

// ---- A workout in progress (Sat 10/24, his words: "Why did you randomly remind me about holds... when I'm mid-workout?
// Make sure the notifications are actually being analyzed properly if I'm mid-workout"): the holds check-in "One round
// now" went out at 3:30 PM, 42 minutes into Pull. The nudges, the walk and the dishes waited for a workout (busyNow); the
// day's reminders didn't. Now what waits for his wake time (holds, supplements, meals, the evening round-up...) also
// waits while a workout runs (up to 4 hours, as sessionBusy), and what came due in it goes out once the gym is done: a
// minute after the "head home" nudge (so after the Evolt ask), together as one message. Reminders he set, the sauna, and
// the check-in, session and scan reminders at a time he chose keep their time.
export const WORKOUT_HOLD = { afterHomeMin: 1 };

/**
 * His workouts (not holds rounds, not discarded) of the last 2 days as spans: {start, end, open, release}. Open = still
 * running (end: the 4-hour cap); release = when what came due in it goes out (after the gym order, lib/reminders.js
 * afterGym; else a minute after it ended).
 */
export function workoutSpans(st, sessions, now, tz) {
  return sessions.filter((x) => x && x.kind !== 'holds' && x.status !== 'discarded' && Number.isFinite(x.startedAt) && x.startedAt <= now && now - x.startedAt < 2 * 86400000)
    .map((x) => {
      const cap = x.startedAt + WORKOUT_BUSY_MIN * 60000;
      if (x.status === 'active') return { start: x.startedAt, end: cap, open: now < cap, release: cap };
      if (x.status !== 'done' || !Number.isFinite(x.endedAt)) return null;
      const ag = afterGym({ date: isoDate(new Date(x.startedAt), tz), activity: st.activity, areas: st.areas, rounds: st.rounds, scans: st.scans, scanPlan: st.scanPlan, photoScanIds: st.photoScanIds });
      const release = (ag && ag.doneAt >= x.endedAt ? ag.homeAt : x.endedAt) + WORKOUT_HOLD.afterHomeMin * 60000;
      return { start: x.startedAt, end: x.endedAt, open: false, release };
    }).filter(Boolean);
}

/** Reminders that wait (`waits`) due while a workout runs: held while it's on, then at its release, together. */
export function afterWorkouts(items, spans, now, waits) {
  if (!spans.length) return items;
  return items.map((i) => {
    if (!waits(i)) return i;
    const s = spans.find((x) => i.at >= x.start && i.at < x.end);
    if (!s) return i;
    if (s.open) return i.at <= now + 60000 ? { ...i, at: now + 2 * 60000, workout: 'waiting' } : i;
    return { ...i, at: s.release, workout: 'after', heldAt: i.heldAt ?? i.at };
  });
}

// ---- Reminders he set that land in a meal (Thu 10/22, his words: "check those reminders if they are within the frame
// that I told you that I'm going to finish by 5:30. So I don't need to get reminded before I finish eating... After I
// log the meal... collagen and then cleaning the dishes. And only then"; then: "not that it has to test that they're
// held until the meal is logged. This is just specific right now, because of how the time frame fits"). Not a rule for
// every errand: only one whose time falls while he cooks or eats moves, to after that meal's collagen and dishes.
// Outside his meals every reminder fires on time; so does one he set during the meal or for within 30 minutes (about the
// meal or the moment: "take a shower now", "clean the dishes", "are you home? cooking?"). The coach can say which way
// when he says (meal: 'wait' | 'on-time' on the reminder).
// Thu 10/22, his words: "I don't think I've gotten the other reminders after the food supplement and dishes": he said
// "cooking" at 4:51 PM and logged the meal at 6:21 PM, and his errands went out at 5:30 PM, mid-meal, when the span of a
// meal not logged yet ended. Now a meal still not logged keeps what landed in it waiting for the meal, its collagen and
// dishes, 2 hours past that at most (pendingMaxMin, Claude's default), so nothing waits forever on a meal he never logs.
export const MEAL_HOLD = { graceMin: 30, washMin: 10, chainMaxMin: 45, nearMin: 30, pendingMaxMin: 120 };

/**
 * Today's meals as the spans he is busy with them: from the start-cooking time (or his "about to cook" / "cooking"
 * answer) until the dishes are done: the dishes prompt plus 10 minutes, after the second meal's collagen is ticked; at
 * most 45 minutes after he ate. Not logged yet: the meal runs until 30 minutes past the latest he set, or past the time
 * he said he'd finish by, whichever is later (until); still not logged after that, he is taken to be at it until he logs
 * it, up to 2 hours more (end), and what comes due meanwhile lands in it too. Skipped: none.
 * [{name, start, end, until?, open}]; a reminder lands in it from start until `until` (else end); open = still on, end
 * is the most it waits.
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
    const frameEnd = finish + MEAL_HOLD.graceMin * 60000;
    const end = frameEnd + MEAL_HOLD.pendingMaxMin * 60000;
    // Past its frame and still not logged: what comes due now (and on the next tick) lands in it as well.
    const until = now >= frameEnd ? Math.min(end, now + 60000) : frameEnd;
    return { name: slot.name, start, end, until, open: now < end };
  }).filter(Boolean);
}

/** The spans from the Mac's database. */
export function mealSpansFor(store, now, tz) {
  const list = (col) => recordsOf(store, col);
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
    const s = spans.find((x) => i.at >= x.start && i.at < (x.until ?? x.end)
      && (r.meal === 'wait' || (set < x.start && i.at - set > MEAL_HOLD.nearMin * 60000)));
    return s ? { ...i, at: s.end, afterMeal: s.name, waiting: s.open, plannedAt: i.at } : i;
  });
}

// Thu 10/22: at 4:30 PM "Last meal time... Eaten, cooking, or skipping?" and his own "Are you home? Started cooking?"
// went out in the same second, and at 4:40 PM again, 20 seconds apart. A meal ask within 3 minutes of a reminder he set
// about that meal (the coach marked it 'on-time', or its words are about cooking or eating) is left to his reminder: the
// ask counts as sent, the next one in its run comes as usual.
const MEAL_ASK = /^meal(-again|-soon|-cooking|-cook)?:/;
const ABOUT_MEAL = /\b(cook\w*|eat|eats|eaten|eating|ate|meal|meals|lunch|dinner|breakfast|food|plate)\b/i;
export const MEAL_ASK_NEAR_MIN = 3;

/** The ids among `items` (due now) that are meal asks covered by one of his reminders about the meal. */
export function coveredMealAsks(items, all, { sent = {}, now, reminders = [] }) {
  const byId = new Map(reminders.map((r) => [`coach:${r.id}`, r]));
  const near = all.filter((i) => i.kind === 'coach' && !i.trigger && i.due !== false
    && (byId.get(i.id)?.meal === 'on-time' || ABOUT_MEAL.test(i.body || '')))
    .map((i) => ({ id: i.id, at: sent[i.id] ?? i.at }))
    .filter((c) => Math.abs(c.at - now) <= MEAL_ASK_NEAR_MIN * 60000);
  return new Map(items.filter((i) => MEAL_ASK.test(i.id || '') && near.length).map((i) => [i.id, near[0].id]));
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
/** A collection's records; meals without anything in them (isEmptyMeal) left out: they count as no meal (Thu 10/22). */
export function recordsOf(store, col) {
  const all = store.listRecords(col).map((r) => r.data).filter(Boolean);
  return col === 'meals' ? all.filter((m) => !isEmptyMeal(m)) : all;
}

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
  const list = (col) => recordsOf(store, col);
  const one = (col, id) => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; };
  const st = stateFrom(store, tz);
  const date = isoDate(new Date(now), tz);
  const n0 = withDefaults(one('settings', 'main')).notify;
  // His day starts when he's up (wakeHmToday), for every nudge below.
  const n = { ...n0, wakeHm: wakeHmToday(store, now, tz, n0.wakeHm) };
  const health = one('health', date);
  const plan = one('fuel', 'plan');
  // Food and supplements: his waking day (after midnight, before he has slept, still the day before).
  const food = foodDayOf(store, now, tz);
  const eaten = dayTotals(list('meals'), list('meal-estimates'), food);
  const trained = st.trainedDates?.has?.(date) || false;
  const rot = rotationDay({ last: st.last, today: date, days: st.days || {} });
  const groups = checklist({ supps: list('supplements'), log: list('supp-log'), date: food, dayKind: rot.today.kind === 'train' || trained ? 'train' : 'rest' });
  const untimed = groups.filter((g) => !g.time && !g.afterMeal && !g.afterMeal2).flatMap((g) => g.items);
  const afterMeal = groups.filter((g) => g.afterMeal).flatMap((g) => g.items);
  const firstMeal = list('meals').filter((m) => m.date === food && m.at && !isSnack(m)).sort((a, b) => a.at - b.at)[0];
  const firstMealAt = firstMeal ? firstMeal.at : NaN;
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
      suppsAfterMeal: afterMeal.length && Number.isFinite(firstMealAt) ? { open: afterMeal.filter((i) => !i.entry).map((i) => i.supp.name), mealAt: firstMealAt, away: ateOut(firstMeal, holdsOf(store)), toldAt: store.getMeta(DISHES)?.seen?.[firstMeal.id] || null } : null,
      sessionHm: st.days?.[date]?.sessionTime || null,
      session: { started: trained, done: trained },
      weighedToday: list('measurements').some((m) => m.date === date && m.weightKg != null) || Boolean(health?.weights?.length)
        || scanTakenOn(list('body-scans'), date, list('scan-photos').map((p) => p.scanId)),
      // Tue 10/27: "How did you sleep?" only once he has slept and is up (upAtToday), never while he's still up.
      sleepLogged: Boolean(health?.sleep || one('sleep-log', date)) || upAtToday(store, now, tz) == null,
      wokeAt: one('sleep-log', date)?.wake ?? health?.sleep?.wake ?? null,
      workoutEndedAt: Math.max(0, ...list('sessions').filter((x) => x.status === 'done' && x.kind !== 'holds' && x.endedAt && isoDate(new Date(x.endedAt), tz) === date).map((x) => x.endedAt)) || null,
      mealAfterGymAt: afterGym({ date, activity: st.activity, areas: st.areas, rounds: st.rounds, scans: st.scans, scanPlan: st.scanPlan })?.mealAt ?? null,
      lastMealAt: Math.max(0, ...list('meals').filter((m) => m.date === food && m.at).map((m) => m.at)) || null,
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
  const list = (col) => recordsOf(store, col);
  const n0 = withDefaults(store.getRecord('settings', 'main')?.data).notify;
  const n = { ...n0, wakeHm: wakeHmToday(store, now, tz, n0.wakeHm) };
  // His waking day (Sat 10/24): a meal after midnight, before he has slept, is that day's second meal, not tomorrow's first.
  const date = foodDayOf(store, now, tz);
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
      // Eaten out (Fri 10/23, his words): they're at home, so "when you're back home", no push line, and the nudges ask
      // "back home yet?" later (nudgeCandidates).
      const away = ateOut(first, holds);
      const line = away ? null : pickLine(opts.bank, 'nudge', { moods: opts.moods, intensity: opts.intensity });
      const body = away ? `${first.name || 'First meal'} logged. You ate out, so take your supplements when you're back home: ${open.join(', ')}. I'll remind you later.`
        : `${first.name || 'First meal'} logged. Take your supplements now: ${open.join(', ')}.${line?.text ? ` ${line.text}` : ''}`;
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
    // Eaten out (Fri 10/23): take it once home, asked 30 minutes later, not every 5; then (Mon 10/26) the few check-ins
    // of lib/nudges.js AWAY_CHECK_MIN in new words, then quiet (after2GapMin).
    const away = ateOut(second, holds);
    const say = async (text, tag) => {
      const opts = voiceOpts(store);
      const line = away ? null : pickLine(opts.bank, 'nudge', { moods: opts.moods, intensity: opts.intensity });
      const body = `${text}${line?.text ? ` ${line.text}` : ''}`;
      const r = push.list().length ? await push.notify({ title: 'Coach', body, url: '#/supps', tag }) : { sent: 0 };
      sayInTalk(store, { text: body, at: now, tz, kind: 'nudge', ref: `supps-after-meal-2:${second.id}` });
      store.setMeta(LAST, now);
      log(`after second meal: ${text.slice(0, 60)} (${r.sent} sent)`);
      out = { key: 'supps-after-meal-2', body };
    };
    if (!w && mealEatenAt(second, state.seen[second.id]) <= now && !heldOff('supps-after-meal', holds, now)) {
      state.after2 = { [date]: { id: second.id, asked: open2.length ? now : null, last: now, done: open2.length ? null : now, ...(away ? { everyMin: AWAY_REMIND_MIN } : {}) } };
      if (open2.length) {
        await say(away ? `${second.name || 'Second meal'} done. You ate out, so take your ${open2.join(', ')} when you're back home. I'll remind you in ${AWAY_REMIND_MIN} minutes.`
          : `${second.name || 'Second meal'} done. Get up and take your ${open2.join(', ')} now. I'll ask again every ${AFTER_MEAL2_BUMP_MIN} minutes until you tick it.`, 'supps-after-meal-2');
      }
    } else if (w?.asked && !w.done) {
      if (!open2.length) w.done = now;
      // Not before the time he set himself for being home or taking it (Fri 10/23, ownSuppsTime).
      else if (now - w.last >= after2GapMin(w) * 60000 && !busy && awakeAt(now, tz, n.wakeHm, n.bedHm) && !heldOff('supps-after-meal', holds, now)
        && now >= ownSuppsTime(list('coach-reminders').filter((r) => isoDate(new Date(r.at || 0), tz) >= date), open2, second.at)) {
        w.last = now;
        const k = w.n || 0;
        if (w.everyMin) w.n = k + 1;
        await say(w.everyMin ? awaySuppsText(k, open2, false) : `Still waiting: ${open2.join(', ')}. Get up and take it now${leavesDishes(second, holds) ? ', then the dishes' : ''}.`, 'supps-after-meal-2');
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
  // Only a meal he cooked at home leaves dishes (Fri 10/23 eaten out; Sun 10/25 a Snack or takeout: leavesDishes).
  const skip = ready.filter((m) => now - dueAt(m) > DISHES_LATE_MIN * 60000 || said.some((x) => x.at >= state.seen[m.id]) || !leavesDishes(m, holds));
  for (const m of skip) state.sent[m.id] = now;
  if (skip.length) log(`dishes after ${skip.map((m) => m.name || m.id).join(', ')}: not sent (late, a snack, not cooked at home, or the coach already said it)`);
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

/**
 * Tendon phase switches he planned (Thu 10/22: "phase one for one week... then we switch to phase two"), made on their
 * day, by the Mac (the phone gets them by sync). Returns the areas switched.
 */
export function applyPhasePlans(store, now, tz, log = () => {}) {
  const areas = store.listRecords('tendons').map((r) => r.data).filter((a) => a?.kind === 'area');
  const due = duePhasePlans(areas, isoDate(new Date(now), tz));
  for (const a of due) { store.writeLocal('tendons', `area.${a.id}`, a); log(`tendons: ${a.label} moved to ${a.phase} (his plan of ${a.phasePlan.from})`); }
  return due;
}

/** The last thing he did at home since `since` (a meal answer soon, cooking or eaten; a meal; a workout or holds started), or 0. */
export function homeSince(store, since) {
  const list = (col) => recordsOf(store, col);
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
  if (inp.n.kinds?.walk === false || now < (inp.n.nudgePausedUntil || 0) || heldOff('walk', holdsOf(store), now) || morningGate(store, now, tz).hold) return null;
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
  store.writeLocal('walks', date, due.planAt ? withAnswer(asked, date, { action: 'plan', at: due.planAt, by: 'coach' }, now) : asked);
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
  if (inp.busy || now < (inp.n.nudgePausedUntil || 0) || inp.n.kinds?.coach === false || morningGate(store, now, tz).hold) return null;
  const awake = awakeAt(now, tz, addMinHm(inp.n.wakeHm, 60), addMinHm(inp.n.bedHm, -60));
  if (!awake || now - (store.getMeta(LAST) || 0) < 10 * 60000 || now - (inp.lastUserAt || 0) < 10 * 60000) return null;
  const state = store.getMeta(INIT) || { last: 0, byKey: {} };
  if (now - state.last < INITIATIVE_GAP_MIN * 60000) return null;
  const list = (col) => recordsOf(store, col);
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
  const awake = awakeAt(now, tz, inp.n.wakeHm, inp.n.bedHm) && !morningGate(store, now, tz).hold;
  if (!nudgeDue({ now, everyMin: inp.n.nudgeEveryMin, awake, lastNudgeAt: state.last, lastNoticeAt: store.getMeta(LAST) || 0, lastUserAt: inp.lastUserAt, busy: inp.busy, pausedUntil: inp.n.nudgePausedUntil })) return null;
  const holds = holdsOf(store);
  const pick = pickNudge(nudgeCandidates({ ...inp.args, sent: state.byKey }).filter((c) => !heldOff(c.key, holds, now)), state.byKey, now);
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
  const waiting = w?.asked && !w.done ? [w.last + after2GapMin(w) * 60000, now + 10000] : [];
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
      applyPhasePlans(store, t, zone, log);
      if (!push.list().length) return [];
      // His morning first: its question, and whether the rest of the day is still held.
      const morning = await morningTick({ store, push, log, now: t, tz: zone });
      const sent = store.getMeta(SENT) || {};
      // What he told the coach to hold off on is skipped (lib/holdoffs.js).
      const holds = holdsOf(store);
      const all = plan(store, t, zone);
      const due = dueNow(all, t, sent).filter((i) => !itemHeld(i, holds, t));
      // A run of repeats due at once (a meal's check-ins, the Mac asleep a while): the latest only; the
      // rest count as sent.
      const latest = new Map();
      // (Held for his morning or a workout, they're due at once: the latest by when it was meant for.)
      const meant = (i) => i.heldAt ?? i.at;
      for (const i of due) if (i.group && !(latest.has(i.group) && meant(latest.get(i.group)) >= meant(i))) latest.set(i.group, i);
      for (const i of due) if (i.group && latest.get(i.group) !== i) sent[i.id] = t;
      // A check-in too soon after the last message of its stream (Sat 10/24: the holds reminder held for his morning,
      // then its check-in minutes later): counted, not sent.
      const spaced = new Set(due.filter((i) => i.streamGapMin && (all.some((j) => j.stream === i.stream && j.id !== i.id && sent[j.id] && t - sent[j.id] < i.streamGapMin * 60000)
        || due.some((j) => j.stream === i.stream && !j.streamGapMin))));
      for (const i of spaced) { sent[i.id] = t; log(`notify ${i.id}: not sent (too soon after the last of ${i.stream})`); }
      // A meal ask his own reminder about the meal says at the same time: counted, not sent.
      const covered = coveredMealAsks(due, all, { sent, now: t, reminders: recordsOf(store, 'coach-reminders') });
      for (const [id, by] of covered) { sent[id] = t; log(`notify ${id}: not sent (his reminder ${by} says it)`); }
      // Held through a workout, a reminder and its own follow-ups (one tag) come due together: the first only.
      const firstOfTag = new Map();
      for (const i of due.filter((x) => x.workout === 'after' && (!x.group || latest.get(x.group) === x)).sort((a, b) => a.heldAt - b.heldAt)) if (!firstOfTag.has(i.tag)) firstOfTag.set(i.tag, i);
      const repeats = new Set(due.filter((i) => i.workout === 'after' && firstOfTag.has(i.tag) && firstOfTag.get(i.tag) !== i));
      for (const i of repeats) sent[i.id] = t;
      if (covered.size || spaced.size || repeats.size) store.setMeta(SENT, sent);
      const items = due.filter((i) => (!i.group || latest.get(i.group) === i) && !covered.has(i.id) && !spaced.has(i) && !repeats.has(i));
      if (items.length) {
        const opts = voiceOpts(store);
        // What waited for his morning or a workout: one short ask of what to do now (heldPlanText: one line a thing, no
        // passed times; Mon 10/26), one line in his moods at the end.
        // A single one too, half an hour overdue, when its words name a clock time (it would read back a passed one).
        const after = items.filter((i) => i.morning === 'after' || i.workout === 'after').sort((a, b) => a.heldAt - b.heldAt);
        const merged = after.length > 1 || after.some((i) => t - i.heldAt >= HELD_OVERDUE_MIN * 60000 && /\d:\d\d\s?[AP]M/i.test(`${i.title} ${i.body}`));
        if (merged) {
          const v = coachVoice(heldPlanText(after, { now: t, tz: zone }), { ...opts, calm: after.some((i) => i.calm) });
          const r = await push.notify({ title: v.title, body: v.body, url: after[0].url, tag: 'morning-plan' });
          for (const i of after) sent[i.id] = t;
          sayInTalk(store, { text: v.body, at: t, tz: zone, kind: 'reminder', ref: after.map((i) => i.id).join(',') });
          log(`notify morning plan: ${after.map((i) => i.id).join(', ')} (${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''})`);
        }
        for (const i of merged ? items.filter((x) => !after.includes(x)) : items) {
          // The coach says it (Mon 10/19): title "Coach", the reminder's facts, one short line in his moods. A coach
          // reminder can carry live facts (Wed 10/21: "are my steps counted?" gets what the Shortcut really sent).
          const v = coachReminder(i.facts === 'health' ? { ...i, body: `${i.body} ${healthSendsText(store, { since: i.since, now: t, tz: zone })}` } : i, opts);
          const r = await push.notify({ title: v.title, body: v.body, url: i.url, tag: i.tag });
          sent[i.id] = t;
          sayInTalk(store, { text: v.body, at: t, tz: zone, kind: 'reminder', ref: i.id });
          if (i.kind === 'coach') markFired(store, i.id.slice('coach:'.length), t);
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
      return [...(morning ? [morning] : []), ...items, ...(dishes ? [dishes] : []), ...(walk ? [walk] : []), ...(nudge ? [nudge] : []), ...(init ? [init] : [])];
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
