// The coach's read tools (8.2, brief sections 7 and 11): schedule and programme, history and calendar, Health,
// meals, supplements, body scans, sauna, squat sessions, notes. Each answers in short lines with the formats he
// asked for, computed by the app's own rules (the same modules the phone uses), so the coach repeats them instead of
// working anything out.
import { snapshot, dayText, whenText, timeText, loadText, repsText, mmss, plural, findByName, k, formatHm } from './shared.mjs';
import { LABEL, addDays } from '../../app/js/lib/rotation.js';
import { weekColumn } from '../../app/js/lib/programme.js';
import { buildSession, summarize, elapsedMs } from '../../app/js/lib/session.js';
import { targetFor, lastNotes } from '../../app/js/lib/targets.js';
import { confirmedKg, modeOf, isConfirmed } from '../../app/js/lib/progression.js';
import { currentBodyweight, healthDays, hoursText, weightSeries, withSleepLog } from '../../app/js/lib/health.js';
import { roundsByDate, areaStatus, holdSlots, PHASE_TEXT, restChoices, restChoiceText, roundSeconds } from '../../app/js/lib/holds.js';
import { ACTION_TEXT, askedAreas } from '../../app/js/lib/readiness.js';
import { dayMarks, setText, weekStreak, workoutDates, sessionsPerWeek, sourceOf, SOURCE_LABEL } from '../../app/js/lib/calendar.js';
import { sessionPoints, records, repRecords } from '../../app/js/lib/records.js';
import { dayTotals, mealTotals, beforeItems, leftovers, netItems, mealState, STATE_SHORT, mealMarks, itemTotals, presetsOf } from '../../app/js/lib/meals.js';
import { amountsLine } from '../../app/js/lib/foods.js';
import { dayMicro, weekMicro, plannedMicro, microRows } from '../../app/js/lib/micro.js';
import { foodsDb } from '../foods.mjs';
import { reviewOpen, checklist, outOfStock, statusOn, stockStatus, lastsText, adherence, streak, dayKindFrom, daysText, FOOD_TEXT, suppMarks, doseFor } from '../../app/js/lib/supplements.js';
import { lowAnswered, mealTimesOf } from '../../app/js/lib/fuel-reminders.js';
import { walkLines, usualWalkHm, hourRisk, weatherWords, safeWindowsText, weatherCodeText, rainingNow } from '../../app/js/lib/walks.js';
import { fastingOn } from '../../app/js/lib/fast.js';
import { activeHolds } from '../../app/js/lib/holdoffs.js';
import { scanStatus, protocolOf, lastDone, isDone, conditionNotes, latestChange, scanMarks, SAFETY_ASK, projectRotation, projectRotationEitherWay } from '../../app/js/lib/scans.js';
import { ladderState, stepText, LADDER, PASSES_TO_UNLOCK, doctorDue, DOCTOR_QUESTION, hadSymptoms, passed, phaseOf, saunaMarks, CHECKLIST, SYMPTOMS, GET_OUT, BREAK_MIN, OVERDUE_MIN, proposeSaunaDays, SAUNA_TIME, proposalDayText } from '../../app/js/lib/sauna.js';
import { runText, squatMarks } from '../../app/js/lib/squat-log.js';
import { latestByField } from '../../app/js/lib/body.js';
import { neckAsk, neckToday, neckDoneOn, placeLabel } from '../../app/js/lib/neck.js';
import { addMinutesHm, formatTime, hmOf, zonedTime } from '../../app/js/lib/time.js';
import { recoveryLines, checkIns, photoStatus, endsOn } from '../../app/js/lib/recovery.js';
import { checkInLead } from '../../app/js/lib/reminders.js';
import { MOOD_LABEL } from '../../app/js/lib/coach-talk.js';
import { activityDays, DISCIPLINE, WEEKDAYS } from '../../app/js/lib/activities.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DAY_TYPE = { type: 'string', enum: ['pull', 'push', 'legs', 'neck'] };

// ---- the active session -------------------------------------------------------------------------------------------

/** The exercise he is on: the one he ticked last if it still has sets left, else the first with sets left. */
export function currentExercise(session, sets) {
  // Thu 10/22: an exercise he skipped today is never "next".
  const skipped = new Set((session.exercises || []).filter((e) => e.skipped).map((e) => e.key));
  const open = (key) => !skipped.has(key) && sets.some((x) => x.exKey === key && !x.done);
  const lastTicked = [...sets].filter((x) => x.done && x.doneAt).sort((a, b) => b.doneAt - a.doneAt)[0];
  if (lastTicked && open(lastTicked.exKey)) return session.exercises.find((e) => e.key === lastTicked.exKey) || null;
  return session.exercises.find((e) => open(e.key)) || null;
}

/** "set 2 of 3: 60 kg total (...) × 8-10 (target)" for the next set of an exercise. */
export function nextSetText(ex, sets) {
  const mine = sets.filter((x) => x.exKey === ex.key);
  const i = mine.findIndex((x) => !x.done);
  if (i < 0) return `${ex.name}: all ${mine.length} sets done`;
  const x = mine[i];
  const t = x.target || {};
  const kgv = x.kg ?? t.kg;
  const what = x.type === 'hold' ? `hold ${x.durationS ?? 30} s${kgv != null ? ` at ${loadText(kgv, ex.barKg)}` : ''}` : `${kgv != null ? loadText(kgv, ex.barKg) : ex.type === 'reps_only' ? 'bodyweight' : 'no load set'}${t.reps ? ` × ${repsText(t.reps)}` : ''}`;
  return `${ex.name}, set ${i + 1} of ${mine.length}${x.type !== 'normal' ? ` (${x.type})` : ''}: ${what}`;
}

export function activeText(s, session) {
  const sets = s.setsOf(session.id);
  const sum = summarize(session, sets);
  const cur = currentExercise(session, sets);
  const ticked = sets.filter((x) => x.done).length;
  return `Session in progress: ${session.title}, started ${timeText(session.startedAt, s.tz)} (${Math.round(elapsedMs(session, s.now) / 60000)} min), ${ticked} of ${sets.length} sets ticked, volume ${sum.volume.toLocaleString('en-US')} kg.${cur ? ` Now: ${nextSetText(cur, sets)}.` : ' Every set is ticked: finish it on the phone.'}`;
}

// ---- today --------------------------------------------------------------------------------------------------------

const weekOf = (s, dayType, date) => weekColumn(s.meta()?.firstSessions?.[dayType], date);

/** The days ahead from today, if each planned session happens on its day: [{date, kind, dayType}]. */
export const ahead = (s, n = 8) => projectRotation({ last: s.last(), days: s.days(), from: s.today, n });

/** "Coming up ...": dates and day types from the app's rotation, so nobody works out a weekday by hand. */
function comingUp(s, n = 8) {
  const fmt = (list) => list.map((d) => `${dayText(d.date, s.today)} ${d.kind === 'rest' ? 'rest' : `${LABEL[d.dayType]} (week ${weekOf(s, d.dayType, d.date)})`}`).join('; ');
  const line = `Coming up, if each planned session happens on its day: ${fmt(ahead(s, n).filter((d) => d.date > s.today))}.`;
  const t = s.rotation().today;
  if (t.kind !== 'train') return line;
  // Today's session isn't done: if it doesn't happen today it carries over (nothing is skipped, decision 15), so
  // tomorrow is not settled yet. Give the coach both versions so it never states tomorrow as fact.
  const carried = projectRotation({ last: s.last(), days: s.days(), from: addDays(s.today, 1), n: n - 1 });
  return `${line} If today's ${LABEL[t.dayType]} is NOT done today, it carries over: ${fmt(carried)}. Today's session isn't done, so don't state tomorrow's day as fact: give both, or ask whether he trains today.`;
}

function rotationLines(s) {
  const rot = s.rotation(); const t = rot.today; const days = s.days();
  const out = [];
  const nxt = rot.next;
  const wk = weekOf(s, nxt.dayType, nxt.date);
  if (t.kind === 'train') out.push(`Today: ${LABEL[t.dayType]} (week ${wk} column), not done yet.`);
  else if (t.kind === 'done') out.push(`Today: ${LABEL[t.dayType]} done. Next: ${LABEL[nxt.dayType]}, ${dayText(nxt.date, s.today)} (week ${wk} column).`);
  else out.push(`Today: rest (${t.reason === 'rotation' ? 'the rest day after Legs' : t.reason === 'moved' ? 'session moved to tomorrow at the check-in' : t.reason === 'rest-holds' ? 'rest and tendon holds, from the check-in' : 'a rest day he added'}). Next: ${LABEL[nxt.dayType]}, ${dayText(nxt.date, s.today)} (week ${wk} column).`);
  const hm = days[nxt.date]?.sessionTime;
  const pre = s.settings().notify.readinessMin;
  const lead = hm ? checkInLead(days[nxt.date], nxt.date, s.tz, pre) : null;
  out.push(hm ? `Session time ${nxt.date === s.today ? 'today' : dayText(nxt.date, s.today)}: ${formatHm(hm)}, check-in ${lead == null ? 'just before he leaves (no reminder: its time had passed when he set the session time)' : formatHm(addMinutesHm(hm, -lead))}.` : `No session time set for ${nxt.date === s.today ? 'today' : dayText(nxt.date, s.today)} (he sets it on Train).`);
  const rd = days[s.today]?.readiness;
  if (t.kind !== 'rest' || rd) out.push(rd ? `Check-in today: rule ${rd.rule}, ${ACTION_TEXT[rd.action] || rd.action}${rd.lighterExercises?.length ? ` (${rd.lighterExercises.join(', ')})` : ''}` : 'Check-in today: not done.');
  const last = s.last();
  if (last) out.push(`Last rotation session: ${LABEL[last.dayType]}, ${dayText(last.date, s.today)}.`);
  out.push(comingUp(s));
  const modes = s.one('progression', 'modes');
  if (modeOf(modes, nxt.dayType) === 'comeback' && wk >= 5 && !isConfirmed(s.list('progression'), nxt.dayType, wk)) out.push(`Week ${wk} numbers for ${LABEL[nxt.dayType]} need his OK (Train > Review); until then the last confirmed numbers apply.`);
  return out;
}

function holdLines(s) {
  const areas = s.list('tendons').filter((a) => a.kind === 'area');
  const rot = s.rotation();
  const rounds = roundsByDate(areas, s.list('sessions'), s.list('sets'), s.one('bridge', 'last-loads'));
  const st = s.settings().notify;
  const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType: rot.today.kind === 'rest' ? null : rot.today.dayType, roundsToday: Object.fromEntries(Object.entries(rounds).map(([id, d]) => [id, d[s.today] || 0])), times: { morning: st.holdsMorning, evening: st.holdsEvening }, restChoices: restChoices(s.days(), s.today) });
  if (!slots.length) return ['Tendon holds today: none planned.'];
  // How long a round takes, so the coach never guesses (Tue 10/20 it said "3 minutes"): 3 × 30 s, his rest between
  // holds, and the timer's GET READY before each.
  const set = s.settings();
  const getReadyS = set.holds?.getReadyS ?? 15; const restS = set.rest?.holdS ?? 120;
  const sec = roundSeconds({ getReadyS, restS });
  const roundLine = `A round of 3 × 30 s takes ${mmss(sec)} on his hold timer: ${getReadyS} s GET READY before each hold, ${mmss(restS)} rest between holds. Say that length, never a guess.`;
  // A morning round still open after its time: one now, the evening one at its time, not back to back (brief section 4, example 8).
  const nowHm = hmOf(new Date(s.now), s.tz);
  const lateMorning = slots.filter((x) => x.slot === 'morning' && !x.done && !x.skipped && x.time && nowHm >= x.time);
  const evening = slots.find((x) => x.slot === 'evening' && !x.done && x.time && nowHm < x.time);
  const out = [`Tendon holds today: ${slots.map((x) => `${x.label} ${x.slot === 'after' ? 'after the session' : x.slot === 'rest' ? `rest day (${formatHm(x.time)})` : `${x.slot} ${formatHm(x.time)}`}: ${x.skipped ? 'skipped today (his choice)' : `${x.exercise}${x.also?.length ? ` + ${x.also.join(', ')}` : ''}${x.slot === 'rest' && x.holdIndex === 'other' ? ' (his own hold)' : ''}, ${x.done ? 'DONE' : x.ask ? 'not answered yet' : 'open'}`}`).join('; ')}.`];
  out.push(roundLine);
  if (lateMorning.length) out.push(`The morning round${lateMorning.length > 1 ? 's' : ''} (${lateMorning.map((x) => x.label).join(', ')}, due ${formatHm(lateMorning[0].time)}) ${lateMorning.length > 1 ? 'are' : 'is'} late: call it late, not "morning". One round now${evening ? `, the evening one at ${formatHm(evening.time)}` : ' and one later'}; not back to back.`);
  // A2: the rest-day question. He answers; the coach never suggests a hold.
  for (const x of slots.filter((y) => y.slot === 'rest' && y.ask)) {
    const area = areas.find((a) => a.id === x.area);
    out.push(`Rest-day ${x.label.toLowerCase()} hold: ask him what he wants today: the gym just for the ${x.restHold} hold, another hold he names, or skip today (record it with rest_day_hold). Never suggest a hold yourself.${x.last ? ` Last rest day (${dayText(x.last.date, s.today)}): ${restChoiceText(x.last, area)}.` : ''}`);
  }
  return out;
}

function suppDayKind(s, date) {
  return dayKindFrom({ sessions: s.list('sessions'), bridge: s.one('bridge', 'last-loads'), days: s.list('days'), date, today: s.today, tz: s.tz });
}

function suppLine(s) {
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const groups = checklist({ supps, log, date: s.today, dayKind: suppDayKind(s, s.today) });
  const items = groups.flatMap((g) => g.items);
  const taken = items.filter((i) => i.entry?.status === 'taken').length;
  const skipped = items.filter((i) => i.entry?.status === 'skipped').length;
  const open = items.filter((i) => !i.entry).map((i) => i.supp.short || i.supp.name);
  const outs = outOfStock(supps, log, s.today);
  return `Supplements today: ${items.length ? `${taken} of ${items.length} taken${skipped ? `, ${skipped} skipped` : ''}${open.length ? `; open: ${open.join(', ')}` : ''}` : 'none scheduled'}.${outs.length ? ` Out of stock (off his day until back; record his restock answers with supplement_plan kind out): ${outs.map(({ supp, since }) => `${supp.short || supp.name} since ${dayText(since, s.today)}`).join(', ')}.` : ''}`;
}

function foodLine(s) {
  const plan = s.one('fuel', 'plan') || {};
  const t = dayTotals(s.list('meals'), s.list('meal-estimates'), s.today);
  return `Food today: ${t.kcal.toLocaleString('en-US')} kcal of ${plan.kcal ? plan.kcal.toLocaleString('en-US') : '?'}, ${t.protein} g protein of ${plan.proteinG ?? '?'} g (${plural(t.meals, 'meal')}${t.estimated ? `, ${t.estimated} still estimates` : ''}${t.unread ? `, ${t.unread} being read` : ''}).`;
}

/** The weather now and the next 12 hours (Wed 10/21: "check if it's raining for me"). */
function weatherText(s) {
  const w = s.store.getMeta?.('weather');
  if (!w?.hours?.length) return 'No weather data on the Mac yet (it fetches from Open-Meteo about every 30 minutes).';
  const cur = w.current;
  const hours = w.hours.filter((h) => h.at + 3600000 > s.now && h.at <= s.now + 12 * 3600000);
  return [`Weather at ${w.label || 'his place'} (Open-Meteo forecast model, updated ${timeText(w.fetchedAt, s.tz)}; it models the area, it isn't a rain gauge at his door).`,
    cur ? `Now: ${weatherCodeText(cur.code) || 'unknown'}${cur.precip != null ? `, ${cur.precip} mm of rain in the last hour` : ''}, ${Math.round(cur.temp)}°C, feels ${Math.round(cur.feels)}°C.` : '',
    `Next hours: ${hours.map((h) => `${timeText(h.at, s.tz)} UV ${Math.round(h.uv * 10) / 10}, feels ${Math.round(h.feels)}°C, rain ${h.rain}% (${hourRisk(h)})`).join('; ')}.`,
    'Walking rule: safe = UV under 3 and feels 33°C or less; never at UV 6+ or feels 36°C+.'].filter(Boolean).join('\n');
}

/** His meal times (Tue 10/20): the coach guides him by them: when to cook, when to eat, the latest. */
/** The walk coach's state (Tue 10/20): today in one line, and the last days as memory (week: true). */
export function walkTextLines(s, { week = false } = {}) {
  if (s.settings().notify?.kinds?.walk === false) return [];
  const docs = s.list('walks');
  const health = s.one('health', s.today);
  const steps = health?.steps != null ? { steps: health.steps, asOf: health.fileAt ?? null } : null;
  const lines = walkLines(docs, { today: s.today, now: s.now, tz: s.tz, steps, goal: s.settings().body?.stepGoal || 8000, usualHm: usualWalkHm(docs, { today: s.today, tz: s.tz }) });
  // Wed 10/21: UV and heat (Open-Meteo, his area), so walks are planned in safe weather only.
  const w = s.store.getMeta?.('weather');
  const nowH = (w?.hours || []).find((h) => h.at <= s.now && s.now < h.at + 3600000);
  if (nowH) {
    const end = zonedTime(addDays(s.today, 1), '00:00', s.tz);
    const windows = safeWindowsText(w, s.now, end, s.tz);
    const cur = w.current && s.now - w.current.at < 2 * 3600000 ? w.current : null;
    const next = (w.hours || []).filter((h) => h.at > s.now && h.at <= s.now + 4 * 3600000).map((h) => `${timeText(h.at, s.tz)} rain ${h.rain ?? '?'}%`).join(', ');
    lines.splice(1, 0, `Walking weather (${w.label || 'his area'}, Open-Meteo forecast model, updated ${timeText(w.fetchedAt, s.tz)}; not a rain gauge at his door): ${cur ? `now ${weatherCodeText(cur.code) || 'unknown'}${cur.precip != null ? `, ${cur.precip} mm in the last hour` : ''}, ` : 'now '}${weatherWords(nowH)}: ${rainingNow(w, s.now) ? 'RAINING now: walk with an umbrella only if he wants; otherwise the first drier hour' : { safe: 'fine to walk', caution: 'only with shade and water, and only if nothing safer is left today', never: 'NOT safe to walk' }[hourRisk(nowH)] || 'unknown'}. Chance of rain next hours: ${next || 'unknown'}. Safe windows left today (UV under 3, feels 33°C or less): ${windows || 'none'}. Never suggest a walk at UV 6+ or feels 36°C+; plan it in a safe window.`);
  }
  return week ? lines : lines.slice(0, nowH ? 2 : 1);
}

export function mealTimesLine(s) {
  const times = mealTimesOf(s.settings().fuel?.mealTimes);
  if (!times.length) return 'Meal times: none set (Settings > Fuel).';
  return `His meal times, every day: ${times.map((t) => `${t.name} ${formatHm(t.time)}${t.latest ? ` (${formatHm(t.latest)} at the latest)` : ''}${t.cookMin ? `, start cooking ${formatHm(addMinutesHm(t.time, -t.cookMin))}` : ''}`).join('; ')}. Guide him by these: when to cook, when to eat, and say it plainly when one is late.`;
}

function scanLine(s) {
  const st = scanStatus({ plan: s.one('scan-plan', 'main') || {}, scans: s.list('body-scans'), today: s.today, last: s.last(), days: s.days() });
  if (st.next) return `Body scan: ${st.cadence === 'training' ? 'every training day; ' : ''}next ${dayText(st.next.date, s.today)}${st.next.date === s.today ? ' (TODAY, first thing at the gym)' : ''}${st.cadence === 'training' ? '' : ', confirmed'}.`;
  return `Body scan: none confirmed; the app proposes ${dayText(st.proposal.date, s.today)}.`;
}

/** Everything that matters today, in lines (the 'today' tool). */
export function todayText(s) {
  const lines = [...rotationLines(s)];
  const arrived = s.days()[s.today]?.arrivedAt;
  if (arrived) lines.push(`At the gym since ${timeText(arrived, s.tz)} (his iPhone arrival automation).`);
  const active = s.active();
  if (active) lines.push(activeText(s, active));
  lines.push(...holdLines(s), suppLine(s), foodLine(s), mealTimesLine(s), ...walkTextLines(s, { week: true }), scanLine(s));
  const neck = s.one('schedule', 'neck');
  if (s.list('routines').some((r) => r.dayType === 'neck')) {
    if (neck?.planned) {
      const t = s.rotation().today;
      const due = neckToday(neck, t.kind, t.dayType);
      const done = neckDoneOn(s.list('sessions'), s.today, s.date);
      lines.push(`Neck: his plan puts it ${placeLabel(neck.place).replace(/^\w/, (c) => c.toLowerCase())}${!due ? '.' : done ? '; done today.' : `; due today${t.kind === 'done' ? ', now' : t.dayType ? ` after ${LABEL[t.dayType]}` : ''} (Train offers it).`}`);
    } else if (neckAsk(neck, s.today)) lines.push('Neck: his Neck routine is still unplanned (the app asks once a week where it goes).');
  }
  const sauna = s.list('sauna').find((x) => x.status === 'active');
  if (sauna) lines.push(`Sauna session in progress (${stepText(sauna.stepIndex ?? 0)}).`);
  lines.push(...recoveryContext(s));
  return lines.join('\n');
}

/** The context block of every message: the rotation and the session in progress (short; the 'today' tool has the rest). */
export function contextLine({ store, tz, now, screen = null }) {
  const s = snapshot(store, { tz, now });
  const lines = [...rotationLines(s).slice(0, 3), comingUp(s, 6)];
  // Tue 10/20: the meal he is looking at, so "10 eggs, not 5" corrects it without a lookup first.
  const mealId = /^#\/meal\/([\w.-]+)/.exec(screen || '')?.[1];
  const meal = mealId && s.one('meals', mealId);
  if (meal) {
    const items = meal.before?.items || [];
    const t = itemTotals(items);
    lines.push(`The meal on his screen: ${meal.name} (${timeText(meal.at, s.tz)}, ${dayText(meal.date, s.today)}) [id ${meal.id}]: ${items.length ? items.map((x) => `${x.name} ${Math.round(x.grams)} g`).join(', ') : 'no items yet'}; ${t.kcal} kcal, ${t.protein} g protein${meal.after?.none ? '; he ate it all' : meal.after?.photoId ? '; after photo taken' : ''}${meal.before?.confirmedAt ? '; confirmed' : '; not confirmed yet'}. What he says about the plate corrects it: correct_meal with this id and every item as it should be.`);
  }
  const active = s.active();
  if (active) lines.push(activeText(s, active));
  lines.push(moodLine(s));
  // Thu 10/22: asked "what's up?" he repeated a wrong 2:13 PM notification ("0 of 4 taken") as today's supplements; the
  // live count is here with every message, ahead of what the notifications said.
  lines.push(`Now: ${suppLine(s)}`);
  lines.push(...recoveryContext(s));
  lines.push(...noticeLines(s));
  lines.push(...situationLines(s));
  return lines.join('\n');
}

/**
 * Wed 10/21 (his words: "like a human coach, with proper two-way communication... with good memory"): what he has
 * told you that the app now follows (a fast, hold-offs), and your notes on him (memory), with every message.
 */
function situationLines(s) {
  const out = [...walkTextLines(s)];
  const f = s.days()[s.today]?.fast;
  if (fastingOn(s.days(), s.today, s.list('meals'))) out.push(`He is FASTING today (his decision, ${timeText(f.at, s.tz)}${f.said ? `: "${f.said}"` : ''}): the app sends no food, cooking or supplement prompts. Never argue it or count his kcal against him; walks are the push; no sauna today (his checklist wants food in the last few hours). If he eats, the fast ends.`);
  const holds = activeHolds(s.list('coach-holds'), s.now);
  if (holds.length) out.push(`He asked the app to hold off (it does): ${holds.map((h) => `${h.areas.join(', ')} until ${dayText(s.date(h.until), s.today)} ${timeText(h.until, s.tz)}${h.reason ? ` (${h.reason})` : ''} [id ${h.id}]`).join('; ')}.`);
  out.push(...changeLines(s));
  out.push(...activityLines(s));
  const notes = s.list('coach-notes').sort((a, b) => b.at - a.at).slice(0, 15);
  if (notes.length) out.push(`Your notes on him (your memory; use them, never ask again what they answer): ${notes.map((n) => `[${dayText(n.date || s.date(n.at), s.today)}${n.topic ? `, ${n.topic}` : ''}] ${String(n.text).slice(0, 160)}`).join(' | ')}`);
  return out;
}

/** Thu 10/22: his flexibility and boxing / kickboxing plans (activity_plan), what he did, his last kick test. */
function activityLines(s) {
  const flex = s.one('schedule', 'flex'); const combat = s.one('schedule', 'combat');
  const done = activityDays({ sessions: s.list('sessions'), sets: s.list('sets'), tz: s.tz });
  const lastOf = (set) => [...set].sort().at(-1) || null;
  const test = s.list('coach-notes').filter((n) => /^flex/i.test(n.topic || '')).sort((a, b) => b.at - a.at)[0];
  const day = (d) => (d ? dayText(d, s.today) : 'never');
  const out = [];
  if (flex) out.push(`Flexibility plan: ${flex.when === 'after-workout' ? `after each workout (else ${formatHm(flex.hm)})` : `every day at ${formatHm(flex.hm)}`}; last done ${day(lastOf(done.flex))}; last kick test ${test ? `${day(test.date)}: ${String(test.text).slice(0, 120)}` : 'none yet'}.`);
  else out.push('Flexibility: no plan yet (the open question flex-plan asks when it fits; set it with activity_plan).');
  if (combat) out.push(`Classes: ${DISCIPLINE[combat.discipline]}${combat.gym ? ` at ${combat.gym}` : ''}, ${(combat.days || []).map((i) => WEEKDAYS[i].slice(0, 3)).join('/') || 'no fixed days'} at ${formatHm(combat.hm)}${combat.trial ? `, trial ${day(combat.trial)}` : ''}; last class ${day(lastOf(done.combat))}.`);
  return out;
}

/**
 * Thu 10/22: changes he asked for (request_change). While the Mac builds one, follow it already; a finished one is
 * in your rules or the app now, so he can ask "is it done?".
 */
function changeLines(s) {
  const all = s.list('coach-changes');
  const open = all.filter((c) => c.status === 'queued' || c.status === 'working').sort((a, b) => a.at - b.at);
  const recent = all.filter((c) => ['done', 'failed', 'question'].includes(c.status) && s.now - (c.doneAt || 0) < 86400000).sort((a, b) => b.doneAt - a.doneAt).slice(0, 5);
  const when = (ms) => `${dayText(s.date(ms), s.today)} ${timeText(ms, s.tz)}`;
  return [
    open.length ? `Changes he asked for, being built on the Mac (follow them yourself already): ${open.map((c) => `[${when(c.at)}, ${c.status === 'working' ? 'building now' : 'waiting'}] "${String(c.said).slice(0, 200)}"${c.want ? ` -> wants: ${String(c.want).slice(0, 200)}` : ''} [id ${c.id}]`).join(' | ')}` : '',
    recent.length ? `Changes finished in the last day (already in the app or your rules; the app told him): ${recent.map((c) => `[${when(c.doneAt)}, ${c.status}] "${String(c.said).slice(0, 120)}" -> ${String(c.answer || '').slice(0, 200)} [id ${c.id}]`).join(' | ')}` : '',
  ].filter(Boolean);
}

/** Mon 10/19: what the app (as the coach) sent him lately, so a short reply ("done", "yes", "82.4") makes sense, and
 * whether today's weigh-in and last night's sleep are in. */
function noticeLines(s) {
  const recent = s.list('coach-messages').filter((m) => (m.kind === 'nudge' || m.kind === 'reminder' || m.kind === 'initiative') && s.now - (m.at || 0) <= 3 * 3600000)
    .sort((a, b) => b.at - a.at).slice(0, 4);
  const health = s.one('health', s.today);
  const weighed = s.list('measurements').some((m) => m.date === s.today && m.weightKg != null) || Boolean(health?.weights?.length)
    || s.list('body-scans').some((x) => x.date === s.today && isDone(x));
  const slept = Boolean(health?.sleep || s.one('sleep-log', s.today));
  return [
    recent.length ? `Your notifications to him in the last 3 hours, newest first (he may be answering one; their numbers were true when sent, possibly wrong, and the "Now:" lines are what's true now): ${recent.map((m) => `${formatTime(new Date(m.at), s.tz)} "${m.text}"`).join('; ')}.` : '',
    `Today: weigh-in ${weighed ? 'logged' : 'not logged (Evolt at the gym before training; save it with log_weight)'}; last night's sleep ${slept ? 'known' : 'not logged (he has no watch: ask, save with log_sleep)'}.`,
  ].filter(Boolean);
}

/** A15: his mood settings, so the coach's replies follow the same dial as the app's lines. */
function moodLine(s) {
  const c = s.settings().coach;
  const on = ['commander', 'hype', 'dark', 'warrior', 'rival'].filter((m) => c.moods?.[m] !== false);
  return `Coach moods (his settings): ${on.length ? on.map((m) => MOOD_LABEL[m]).join(', ') : 'none (plain)'}, plus Calm always; intensity ${c.intensity ?? 3} of 5; the app talks during sets and holds: ${c.talk?.during === false ? 'off' : `on (${c.talk?.every || 'steady'})`}.`;
}

// ---- recovery (A13) -----------------------------------------------------------------------------------------------

/** Photos without their pixels (only the dates and poses matter here). */
const photoMarks = (s) => s.list('body-photos').map((p) => ({ date: p.date, pose: p.pose, dataUrl: Boolean(p.dataUrl) }));

/** His recovery record's state for today, from the app (the day count, what is due): for every message. */
function recoveryContext(s) {
  const plan = s.one('recovery', 'main');
  if (!plan) return [];
  return recoveryLines({ plan, state: s.one('recovery', 'state'), notes: s.list('coach-notes'), photos: photoMarks(s), date: s.today });
}

function recoveryText(s) {
  const plan = s.one('recovery', 'main');
  if (!plan) return 'No recovery record in the app.';
  const state = s.one('recovery', 'state');
  const lines = recoveryContext(s);
  lines.push(`Check-in questions: ${(plan.checkIn?.questions || []).map((q) => `${q.label} (${q.choices ? q.choices.join(' / ') : 'his words'})`).join('; ')}.`);
  const done = (plan.tasks || []).filter((t) => state?.tasks?.[t.id]?.doneAt);
  if (done.length) lines.push(`Done: ${done.map((t) => `${t.text} (${dayText(s.date(state.tasks[t.id].doneAt), s.today)})`).join('; ')}.`);
  if (state?.checkup?.date) lines.push(`Checkup booked: ${dayText(state.checkup.date, s.today)}.`);
  else if (endsOn(plan, state)) lines.push(`Checkup not booked yet${plan.untilText ? `: ${plan.untilText}` : ''}.`);
  if (plan.checkupQuestions?.length) lines.push(`His list for the checkup: ${plan.checkupQuestions.join('; ')}.`);
  const ph = photoStatus(plan, photoMarks(s), s.today);
  if (ph) lines.push(`Photo poses: ${ph.poses.join(', ')}, every ${plan.photos.minDays || 14}-${plan.photos.maxDays || 28} days. ${plan.photos.how || ''}`.trim());
  const ci = checkIns(s.list('coach-notes')).slice(0, 8);
  lines.push(ci.length ? `Check-ins, newest first: ${ci.map((n) => `${dayText(n.date, s.today)}: ${n.text}`).join(' | ')}` : 'No check-ins yet.');
  return lines.join('\n');
}

// ---- programme ----------------------------------------------------------------------------------------------------

function programmeText(s, { dayType = null, week = null } = {}) {
  const rot = s.rotation();
  const type = dayType || rot.next.dayType;
  const date = type === rot.next.dayType ? rot.next.date : ahead(s, 14).find((d) => d.kind !== 'rest' && d.dayType === type && d.date >= s.today)?.date || s.today;
  const wkNow = weekOf(s, type, date);
  const wk = week || wkNow;
  const modes = s.one('progression', 'modes');
  const mode = modeOf(modes, type);
  const routines = s.list('routines');
  const routine = routines.filter((r) => r.dayType === type && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((a, b) => a.order - b.order)[0] || routines.find((r) => r.dayType === type);
  if (!routine) return `No routine for ${LABEL[type] || type}.`;
  const progDocs = s.list('programme').filter((d) => d.kind === 'routine');
  const progress = s.list('progression');
  const lib = s.lib();
  const history = s.history();
  const st = s.settings();
  const rd = s.days()[s.today]?.readiness;
  const lighter = !week && rd && rd.dayType === type && (rd.action === 'lighter-all' || rd.action === 'lighter-area') ? { all: rd.action === 'lighter-all', names: rd.lighterExercises || [], params: rd.params, rule: rd.rule } : null;
  const head = `${routine.title}${mode === 'normal' ? ' (Normal programme)' : ''}, ${week ? `week ${wk} column (asked for)` : `${date === s.today ? 'today' : dayText(date, s.today)}, week ${wk} column`}${lighter ? `, lighter from today's check-in (rule ${lighter.rule})` : ''}. Loads are total kg.`;
  const lines = [head];
  if (!week || week === wkNow) {
    // Exactly what Start would give today (the same function as the phone's Start button).
    const { session, sets } = buildSession({
      routine, meta: s.meta(), programmeRoutines: progDocs, lib, history, today: date, now: s.now,
      smallestPlate: s.minPlate(), gym: null, warmupSteps: st.warmup.steps, sameRoutine: st.previousFrom === 'same-routine',
      bodyweightKg: currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: st.bodyweight, now: s.now })?.kg ?? null, progress, lighter,
    });
    session.exercises.forEach((ex, i) => {
      const mine = sets.filter((x) => x.exKey === ex.key);
      const work = mine.filter((x) => x.type !== 'warmup');
      const warm = mine.length - work.length;
      const t = ex.target || {};
      const kgv = t.kg ?? work.find((x) => x.kg != null)?.kg ?? null;
      const reps = t.reps || work[0]?.target?.reps;
      const load = t.bodyweight ? 'bodyweight' : t.added ? `+${k(kgv)} kg added` : kgv != null ? loadText(kgv, ex.barKg) : 'no load yet';
      const last = history.last(ex.name);
      lines.push(`${i + 1}. ${ex.name}: ${plural(work.length, 'set')}${warm ? ` (+${warm} warm-up)` : ''} × ${repsText(reps) || '?'} at ${load}${t.why ? `. Why: ${t.why}` : ''}${t.gated ? ' (gated on form on video)' : ''}${last ? `. Last: ${dayText(last.date, s.today)}, ${last.sets.filter((x) => x.type !== 'warmup').map((x) => setText(x, ex.type)).join(', ')}` : ''}.`);
    });
  } else {
    for (const [i, re] of routine.exercises.entries()) {
      const pe = re.plan ? progDocs.find((d) => d.id === re.plan.routine)?.exercises.find((e) => e.comebackName === re.plan.name) : null;
      const ex = lib.get(re.exerciseId) || { barKg: null };
      if (!pe) { lines.push(`${i + 1}. ${re.name}: not in the table (follows his last load).`); continue; }
      const last = history.last(re.name);
      const t = targetFor({ plan: pe, week: wk, last: last?.heaviest ? { ...last.heaviest, date: last.date } : null, notes: lastNotes(history.all(re.name)), barKg: ex.barKg ?? null, smallestPlate: s.minPlate(), progressKg: wk > 4 ? confirmedKg(progress, type, wk, pe.name)?.kg ?? null : null, equipment: ex.equipment ?? null, name: re.name });
      const cell = pe.weeks?.find((w) => w.week === Math.min(4, wk));
      lines.push(`${i + 1}. ${re.name}: ${t.bodyweight ? 'bodyweight' : t.kg != null ? loadText(t.kg, ex.barKg) : '?'} × ${repsText(t.reps)}, ${plural(t.sets ?? 0, 'set')}. Why: ${t.why}.${cell ? ` Table: ${cell.text}.` : ''}`);
    }
  }
  return lines.join('\n');
}

// ---- tendons ------------------------------------------------------------------------------------------------------

function tendonsText(s) {
  const areas = s.list('tendons').filter((a) => a.kind === 'area');
  const rounds = roundsByDate(areas, s.list('sessions'), s.list('sets'), s.one('bridge', 'last-loads'));
  const lines = ['Tendon areas (from his tendon note and his decisions; the app adds no rehab advice):'];
  for (const a of areas) {
    const st = areaStatus(a, rounds[a.id] || {}, s.today);
    lines.push(`- ${a.label}: ${PHASE_TEXT[a.phase] || a.phase}. ${st.text}.${a.reported ? ` Reported: ${a.reported}` : ''}`);
    for (const h of a.holds || []) {
      const load = h.loadNote || (h.loadKg != null ? `${k(h.loadKg)} kg total` : h.load === 'full stack' ? `full stack${h.loadKgLogged != null ? ` (logged as ${k(h.loadKgLogged)} kg)` : ''}` : h.loadKgLogged != null ? `${k(h.loadKgLogged)} kg` : h.load || 'load not recorded');
      const when = Array.isArray(h.timing) ? h.timing.join(' and ') : h.when || '';
      lines.push(`  hold: ${h.exercise}, ${load}, ${h.sets ?? 3} × ${h.seconds ?? 30} s${h.where ? `, at ${h.where}` : ''}${when ? `, ${when}` : ''}.`);
    }
    if (a.loadsArea?.exercises?.length) lines.push(`  loads this area: ${a.loadsArea.exercises.join(', ')}.`);
  }
  lines.push(...holdLines(s));
  lines.push('Rules (his note): hold at least 30 s, 3 sets; pain during a hold may reach 3-4 out of 10 if it is not worse the next day; if it is, less weight or push less hard. Heal: 3 sets twice a day, then 3-4 times a week for 4-8 weeks. Maintenance: 5-10 minutes after a workout or one day a week.');
  const table = s.one('tendons', 'readiness');
  if (table) lines.push(`Readiness table: ${table.status === 'confirmed' ? `confirmed${table.confirmedOn ? ` ${dayText(table.confirmedOn, s.today)}` : ''}` : 'a DRAFT he has not confirmed yet (he confirms it on the check-in screen before its first use)'}. Asked: ${askedAreas(areas).map((a) => a.label).join(', ')}, legs/back by day type, energy.`);
  const rd = s.days()[s.today]?.readiness;
  if (rd) lines.push(`Today's check-in: rule ${rd.rule}, ${ACTION_TEXT[rd.action] || rd.action}.`);
  return lines.join('\n');
}

// ---- history ------------------------------------------------------------------------------------------------------

function sessionText(s, session, lib, { detail = true } = {}) {
  const sets = s.setsOf(session.id).filter((x) => x.done);
  const mins = session.endedAt ? Math.round(elapsedMs(session) / 60000) : null;
  const sum = summarize(session, sets);
  const head = `${whenText(session.startedAt, s.tz, s.today)} · ${session.title}${session.dayType ? '' : ''} (${SOURCE_LABEL[sourceOf(session)] || sourceOf(session)})${mins ? ` · ${mins} min` : ''} · ${sum.done} sets · ${sum.volume.toLocaleString('en-US')} kg volume${session.status === 'active' ? ' · IN PROGRESS' : ''}`;
  if (!detail) return head;
  const ex = (session.exercises || []).map((e) => {
    const mine = sets.filter((x) => x.exKey === e.key);
    return mine.length ? `  ${e.name}: ${mine.map((x) => setText(x, e.type)).join(', ')}${e.notes ? ` (note: ${e.notes})` : ''}` : null;
  }).filter(Boolean);
  return [head, ...ex, ...(session.note ? [`  Session note: ${session.note}`] : [])].join('\n');
}

function historyText(s, { exercise = null, from = null, to = null, dayType = null, limit = null }) {
  const lib = s.lib();
  if (exercise) {
    const history = s.history();
    const names = new Set();
    for (const x of s.list('sessions')) for (const e of x.exercises || []) names.add(e.name);
    for (const n of Object.keys(s.one('bridge', 'last-loads')?.exercises || {})) names.add(n);
    const { item, ambiguous } = findByName([...names].map((name) => ({ name })), exercise);
    if (!item) return ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : `No exercise in his history matches "${exercise}".`;
    const entries = history.all(item.name);
    const type = [...lib.values()].find((e) => e.name === item.name)?.type || 'weight_reps';
    const n = Math.min(limit || 8, 30);
    const lines = [`${item.name}: ${plural(entries.length, 'session')} in his history.`];
    for (const e of entries.slice(0, n)) lines.push(`${dayText(e.date, s.today)} (${SOURCE_LABEL[e.source] || e.source}): ${e.sets.map((x) => setText(x, type)).join(', ')}`);
    const pts = sessionPoints(entries, type);
    const rec = records(pts, type);
    if (rec.length) lines.push(`Records: ${rec.map((r) => `${r.label} ${k(r.value)}${r.unit ? ` ${r.unit}` : ''}${r.set ? ` (${setText(r.set, type)})` : ''}, ${dayText(r.date, s.today)}`).join('; ')}.`);
    const rr = repRecords(entries, 15);
    if (rr.length) lines.push(`Best weight by reps: ${rr.map((r) => `${r.reps}: ${k(r.kg)} kg`).join(', ')}.`);
    return lines.join('\n');
  }
  const end = to || s.today;
  const start = from || addDays(end, -13);
  let list = s.list('sessions').filter((x) => x.kind !== 'holds' && (x.status === 'done' || x.status === 'active'))
    .filter((x) => { const d = s.date(x.startedAt); return d >= start && d <= end; })
    .filter((x) => !dayType || x.dayType === dayType)
    .sort((a, b) => b.startedAt - a.startedAt);
  const total = list.length;
  list = list.slice(0, Math.min(limit || 12, 40));
  if (!total) return `No sessions from ${dayText(start, s.today)} to ${dayText(end, s.today)}${dayType ? ` (${LABEL[dayType]})` : ''}.`;
  return [`${plural(total, 'session')} from ${dayText(start, s.today)} to ${dayText(end, s.today)}, newest first${total > list.length ? ` (showing ${list.length})` : ''}:`, ...list.map((x, i) => sessionText(s, x, lib, { detail: i < 8 }))].join('\n');
}

// ---- calendar -----------------------------------------------------------------------------------------------------

function calendarText(s, { month = null, from = null, to = null }) {
  const ym = month || s.today.slice(0, 7);
  const [y, mo] = ym.split('-').map(Number);
  const monthEnd = addDays(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`, -1);
  const start = from || `${ym}-01`;
  const end = to || (month ? monthEnd : s.today);
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const marks = dayMarks({ sessions: s.list('sessions'), sets: s.list('sets'), tz: s.tz, extra: [...squatMarks(s.list('squats'), s.tz), ...mealMarks(s.list('meals'), s.list('meal-estimates'), s.tz), ...suppMarks(supps, log), ...saunaMarks(s.list('sauna')), ...scanMarks(s.list('body-scans'))] });
  const days = s.days();
  const lines = [];
  for (let d = start; d <= end && lines.length < 62; d = addDays(d, 1)) {
    const m = marks.get(d);
    const parts = [];
    for (const w of m?.workouts || []) parts.push(`${w.title} (${SOURCE_LABEL[w.source] || w.source})`);
    if (m?.holds?.length) parts.push(`holds ×${m.holds.length}`);
    for (const e of m?.extra || []) parts.push(e.label);
    if (days[d]?.rest) parts.push(`rest day (${days[d].rest.reason})`);
    if (parts.length) lines.push(`${dayText(d, s.today)}: ${parts.join('; ')}`);
  }
  const dates = workoutDates(marks);
  const firstDay = s.settings().firstDayOfWeek;
  const streak = weekStreak(dates, s.today, firstDay);
  const per = sessionsPerWeek(marks, s.today, { firstDay, weeks: 4 });
  return [`From ${dayText(start, s.today)} to ${dayText(end, s.today)}:`, ...(lines.length ? lines : ['Nothing logged.']),
    `Week streak: ${streak.current} week${streak.current === 1 ? '' : 's'} in a row with a workout (best ${streak.best}). Sessions this week: ${per.thisWeek}; average over the ${per.weeks} weeks before: ${per.average}.`].join('\n');
}

// ---- health -------------------------------------------------------------------------------------------------------

function healthText(s, { days = 14 }) {
  const n = Math.min(Math.max(Number(days) || 14, 1), 120);
  const docs = withSleepLog(s.list('health'), s.list('sleep-log')).filter((d) => d.date >= addDays(s.today, -(n - 1)) && d.date <= s.today).sort((a, b) => (a.date < b.date ? 1 : -1));
  const meta = s.one('health-meta', 'status');
  const lines = [meta?.last?.at ? `Apple Health: last file from the iPhone made ${whenText(meta.last.at, s.tz, s.today)}.` : 'Apple Health: no file from the iPhone yet (the Shortcut is his to set up).'];
  for (const d of docs) {
    const parts = [];
    if (d.steps != null) parts.push(`${Number(d.steps).toLocaleString('en-US')} steps`);
    if (d.sleep?.asleepMin || d.sleep?.inBedMin) parts.push(`slept ${hoursText(d.sleep.asleepMin || d.sleep.inBedMin)}${d.sleep.bed && d.sleep.wake ? ` (${timeText(d.sleep.bed, s.tz)} to ${timeText(d.sleep.wake, s.tz)})` : ''}`);
    if (d.weights?.length) parts.push(`weight ${k(d.weights.at(-1).kg)} kg`);
    for (const w of d.workouts || []) parts.push(`workout: ${w.activity || 'other'}${w.minutes ? ` ${Math.round(w.minutes)} min` : ''}${w.start ? ` at ${timeText(w.start, s.tz)}` : ''}`);
    if (parts.length) lines.push(`${dayText(d.date, s.today)}: ${parts.join(', ')}`);
  }
  const bw = currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: s.settings().bodyweight, now: s.now });
  if (bw) lines.push(`Bodyweight used for pull-ups: ${k(bw.kg)} kg (${bw.from === 'health' ? 'Apple Health' : 'typed in'}${bw.at ? `, ${whenText(bw.at, s.tz, s.today)}` : ''}).`);
  const shown = latestByField(s.list('measurements')).map((f) => `${f.label} ${k(f.value)}${f.kind === 'kg' ? ' kg' : f.kind === 'cm' ? ' cm' : f.kind === '%' ? '%' : ''} (${dayText(f.date, s.today)}${f.prev != null ? `; before ${k(f.prev)}` : ''})`);
  if (shown.length) lines.push(`Latest measurements: ${shown.join('; ')}.`);
  return lines.join('\n');
}

// ---- meals --------------------------------------------------------------------------------------------------------

export function mealsText(s, { date = null }) {
  const d = date || s.today;
  const meals = s.list('meals').filter((m) => m.date === d).sort((a, b) => a.at - b.at);
  const est = s.list('meal-estimates');
  const plan = s.one('fuel', 'plan') || {};
  const t = dayTotals(s.list('meals'), est, d);
  const lines = [`${dayText(d, s.today)}: ${t.kcal.toLocaleString('en-US')} kcal, ${t.protein} g protein (targets ${plan.kcal ?? '?'} kcal, ${plan.proteinG ?? '?'} g protein; his September plan).`];
  for (const m of meals) {
    const b = beforeItems(m, est);
    const l = leftovers(m, est);
    const eaten = b.items ? netItems(b.items, l.items) : null;
    const mt = mealTotals(m, est);
    lines.push(`- ${m.name} ${timeText(m.at, s.tz)} [id ${m.id}] (${STATE_SHORT[mealState(m, est, s.now)] || mealState(m, est, s.now)}${b.estimated && b.items ? ', estimate' : ''}): ${eaten ? eaten.map((x) => `${x.name} ${Math.round(x.grams)} g`).join(', ') || 'nothing' : 'being read'}${mt.known ? `; ${mt.kcal} kcal, ${mt.protein} g protein` : ''}${m.note ? `; note: ${m.note}` : ''}`);
  }
  if (!meals.length) lines.push('No meals logged.');
  lines.push(mealTimesLine(s));
  if (plan.foods?.length) lines.push(`His planned day (his diet analysis): ${plan.foods.map((f) => `${f.name} ${f.perDay || `${f.gramsPerDay} g`}`).join('; ')}.`);
  const amounts = amountsLine(plan);
  if (amounts) lines.push(`No kitchen scale: he goes by packs and counts: ${amounts}.`);
  const presets = presetsOf(s.one('fuel', 'presets'));
  if (presets.length) lines.push(`His presets (log_meal preset; one tap on Fuel): ${presets.map((p) => { const t = itemTotals(p.items); return `${p.name}: ${p.items.map((x) => `${x.name} ${x.portion || `${Math.round(x.grams)} g`}`).join(', ')} (${t.kcal} kcal, ${t.protein} g protein)`; }).join('; ')}.`);
  return lines.join('\n');
}

// ---- supplements --------------------------------------------------------------------------------------------------

function supplementsText(s, { date = null }) {
  const d = date || s.today;
  const supps = s.list('supplements'); const log = s.list('supp-log');
  const dayKind = suppDayKind(s, d);
  const groups = checklist({ supps, log, date: d, dayKind });
  const lines = [`Supplements for ${dayText(d, s.today)} (${dayKind === 'rest' ? 'rest day' : 'training day'}). He decides what he takes; never suggest a supplement or a dose.`];
  for (const g of groups) {
    lines.push(`${g.label}${g.time ? ` (${formatHm(g.time)})` : ''}: ${g.items.map((i) => `${i.supp.name} ${i.dose}: ${i.entry ? `${i.entry.status.toUpperCase()}${i.entry.reason ? ` (${i.entry.reason})` : ''} ${timeText(i.entry.at, s.tz)}` : 'open'}`).join('; ')}`);
  }
  const answers = s.list('supp-answers');
  lines.push('His list:');
  for (const x of supps.filter((y) => statusOn(y, s.today) !== 'removed').sort((a, b) => (a.order ?? 99) - (b.order ?? 99))) {
    const stock = stockStatus(x, log);
    const a7 = adherence(x, log, s.today, 7); const a30 = adherence(x, log, s.today, 30);
    lines.push(`- ${x.name} [id ${x.id}]: ${doseFor(x, dayKind)}${x.doseRest ? ` (rest days ${x.doseRest}, training days ${x.dose})` : ''}, ${x.time ? formatHm(x.time) : 'no time set'}, ${x.withFood ? FOOD_TEXT[x.withFood] : 'food not set'}, ${daysText(x.days)}${statusOn(x, s.today) === 'paused' ? ', PAUSED' : ''}; ${stock ? `${stock.left} servings left, ${lastsText(stock.days)}${stock.low ? ` LOW${lowAnswered(x, answers) ? ' (answered)' : ' (restock not asked yet)'}` : ''}` : 'stock not tracked'}; taken ${a7.pct ?? '-'}% of 7 days, ${a30.pct ?? '-'}% of 30.`);
  }
  const st = streak({ supps, log, today: s.today });
  lines.push(`Streak: ${plural(st.days, 'day')} in a row with everything taken.`);
  const cons = s.list('supp-considering').filter((c) => c.status === 'considering');
  lines.push(cons.length ? `Considering: ${cons.map((c) => `${c.name}${c.note ? ` (${c.note})` : ''}`).join('; ')}.` : 'Considering: nothing.');
  const weekly = answers.filter((a) => a.kind === 'weekly').sort((a, b) => b.at - a.at)[0];
  if (weekly) lines.push(`Last weekly planning answer: ${dayText(weekly.date, s.today)}, ${weekly.answer}${weekly.text ? ` (${weekly.text})` : ''}.`);
  // A6: lines of his Diet.html that differ from his list, still to confirm (he may be asked; never decide for him).
  const open = reviewOpen(s.one('fuel', 'supp-review'), supps);
  if (open.length) lines.push(`Not confirmed yet, his Diet.html words these differently (ask him which is right when it fits; record it with supplement_review): ${open.map((x) => `${supps.find((y) => y.id === x.suppId)?.name}: list "${x.brief}" vs Diet.html "${x.diet}"`).join('; ')}.`);
  return lines.join('\n');
}

// ---- body scans ---------------------------------------------------------------------------------------------------

function scansText(s) {
  const plan = s.one('scan-plan', 'main') || {};
  const scans = s.list('body-scans');
  const st = scanStatus({ plan, scans, today: s.today, last: s.last(), days: s.days() });
  const items = protocolOf(plan);
  const lines = [`Body scans (Evolt 360 at his gym; ${st.cadence === 'training' ? 'every training day' : 'every 4 weeks'}, first thing at the gym before the workout, same conditions). Describe changes in numbers; never diagnose.${st.cadence === 'training' ? ' Day to day, the numbers move with water and food: compare weekly averages, not one day to the next.' : ''}`];
  lines.push(st.next ? `Next scan: ${dayText(st.next.date, s.today)} (${st.cadence === 'training' ? 'the next training day' : 'confirmed'})${st.onRest ? `; that is now a rest day in the rotation, the next training day is ${dayText(st.onRest.to, s.today)}` : ''}.` : `No date confirmed. Proposed: ${dayText(st.proposal.date, s.today)}${st.proposal.dayType ? ` (a ${LABEL[st.proposal.dayType]} day)` : st.proposal.either ? ` (a training day either way: ${LABEL[st.proposal.either.ifMoved]} if today's ${LABEL[st.proposal.open]} moves to tomorrow, ${LABEL[st.proposal.either.ifDone]} if he does it today)` : ''}${st.proposal.lastDate ? `, 4 weeks after ${dayText(st.proposal.lastDate, s.today)}` : ', the first scan'}.`);
  if (st.missed) lines.push(`Missed: the scan confirmed for ${dayText(st.missed, s.today)} has no results.`);
  lines.push(plan.safety?.readAt ? `Safety notice read: ${whenText(plan.safety.readAt, s.tz, s.today)}.` : `Safety notice: not read yet. ${SAFETY_ASK}`);
  if (plan.staff?.length) lines.push(`What his gym's staff said: ${plan.staff.map((x) => x.text).join(' | ')}`);
  const rec = st.next ? scans.find((x) => x.date === st.next.date) : null;
  lines.push(`Preparation checklist${rec ? ` for ${dayText(rec.date, s.today)}` : ''}: ${items.map((i) => `${i.text} (${i.id})${rec?.prep?.ticks?.[i.id] ? ' [ticked]' : ''}`).join(' / ')}`);
  const done = scans.filter(isDone).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const x of done.slice(0, 4)) {
    const notes = conditionNotes(x, items);
    lines.push(`Scan ${dayText(x.date, s.today)}${x.at ? ` ${timeText(x.at, s.tz)}` : ''}${notes.length ? ` (different conditions: ${notes.join('; ')})` : ''}: ${(x.metrics || []).slice(0, 30).map((m) => `${m.label} ${m.text ?? m.value}${m.unit ? ` ${m.unit}` : ''}`).join('; ')}`);
  }
  if (!done.length) lines.push('No scan results yet.');
  const ch = latestChange(scans, items);
  if (ch?.lines?.length) lines.push(`Latest change over ${ch.days} days: ${ch.lines.map((l) => (typeof l === 'string' ? l : l.text || JSON.stringify(l))).join('; ')}${ch.reasons?.length ? ` (not directly comparable: ${ch.reasons.join('; ')})` : ''}.`);
  return lines.join('\n');
}

// ---- vitamins and minerals (A12) ------------------------------------------------------------------------------------

function microText(s, { date = null, week = false }) {
  const d = date || s.today;
  const micro = s.one('fuel', 'micro');
  const db = foodsDb();
  if (!micro?.references?.length || !db) return 'No micronutrient references or food values on the Mac yet.';
  const plan = s.one('fuel', 'plan') || {};
  const o = { meals: s.list('meals'), estimates: s.list('meal-estimates'), plan, micro, supplements: s.list('supplements'), suppLog: s.list('supp-log'), date: d, dayKind: suppDayKind(s, d), dayKindOf: (x) => suppDayKind(s, x) };
  const t = week ? weekMicro(db, o) : dayMicro(db, o);
  const rows = microRows(micro, t, plannedMicro(db, { plan, micro }));
  const n = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  const lines = [`Vitamins and minerals, ${week ? `average of ${t.days} logged day(s) in the 7 to ${dayText(d, s.today)}` : dayText(d, s.today)}: food as eaten (his analysis's cooking factors) + supplements ticked taken, against HIS references (his Diet.html). Numbers only: never advise, never suggest a supplement or dose; his accepted points are not problems.`];
  if (t.notCounted.length) lines.push(`Not counted (no USDA match): ${t.notCounted.join(', ')}.`);
  for (const r of rows) {
    lines.push(`- ${r.name}: ${n(r.total)} ${r.unit}${r.pct != null ? ` (${r.pct}% of ${r.atLeast ? '≥' : ''}${n(r.ref)})` : r.within ? ` (${r.within} ${r.ref.join('-')})` : ''}${r.supp ? `, ${n(r.supp)} from supplements` : ''}; planned ${n(r.planned)}${r.ul ? `; ${r.limitUsed}% of the ${r.ulInfo ? 'reference level' : 'limit'} ${r.ul} (${r.ulNote})` : ''}${r.accepted ? `; accepted: ${r.accepted}` : ''}${r.incomplete.length ? `; incomplete (no USDA value: ${r.incomplete.join(', ')})` : ''}`);
  }
  return lines.join('\n');
}

// ---- sauna --------------------------------------------------------------------------------------------------------

function saunaText(s) {
  const sessions = s.list('sauna');
  const plan = s.one('sauna-plan', 'main') || {};
  const st = ladderState(sessions, s.today, plan);
  const lines = [`Sauna ladder (fixed rules in the app; never suggest more than this): today's step ${stepText(st.step)} (step ${st.step + 1} of ${LADDER.length}); ${st.passes} of ${PASSES_TO_UNLOCK} clean sessions in a row at this step.${st.reasons.length ? ` ${st.reasons.join(' ')}` : ''}`];
  const due = doctorDue(plan, st, st.step);
  const answers = plan.doctor || [];
  lines.push(`Doctor question ("${DOCTOR_QUESTION}"): ${answers.length ? `answered ${answers.map((a) => `${a.answer} (${dayText(s.date(a.at), s.today)}, ${a.context})`).join('; ')}` : 'not asked yet'}${due ? `; due again now (${due})` : ''}. The app records the answer and gives no other medical advice.`);
  const active = sessions.find((x) => x.status === 'active');
  if (active) {
    const ph = phaseOf(active, s.now);
    lines.push(`IN PROGRESS: ${stepText(active.stepIndex ?? 0)}; ${ph.phase === 'in' ? `in round ${ph.round}, planned out at ${timeText(ph.plannedEnd, s.tz)}${ph.overdue ? ', OVERDUE (alarm)' : ''}` : ph.phase === 'break' ? `break after round ${ph.round}${ph.answered ? ', answered no symptoms' : ', symptom question open'}` : ph.phase}.`);
  }
  const open = sessions.find((x) => x.status !== 'active' && x.after && !x.after.answeredAt);
  if (open) lines.push(`The question 15 minutes after the session of ${dayText(open.date, s.today)} is open${s.now >= open.after.dueAt ? ' (due now)' : ` (due ${timeText(open.after.dueAt, s.tz)})`}.`);
  for (const x of [...sessions].filter((y) => y.status !== 'active').sort((a, b) => b.startedAt - a.startedAt).slice(0, 5)) {
    const mins = (x.rounds || []).filter((r) => r.outAt).map((r) => Math.round((r.outAt - r.inAt) / 60000));
    lines.push(`- ${dayText(x.date, s.today)}: ${stepText(x.stepIndex ?? 0)}, did ${mins.join(', ') || 0} min${x.tempC ? `, ${x.tempC}°C` : ''}; ${hadSymptoms(x) ? `STOPPED, symptoms: ${[...(x.symptoms || []).flatMap((y) => y.what || []), ...(x.after?.what || [])].join(', ') || 'noted'}` : passed(x) ? 'clean' : x.status === 'ended' ? 'ended early (no symptoms)' : 'not completed as planned'}${x.note ? `; note: ${x.note}` : ''}`);
  }
  lines.push(`Before a session he ticks: ${CHECKLIST.map((c) => c.text.replace(/\.$/, '')).join(' / ')}. Never before lifting. Break ${BREAK_MIN} min; alarm ${OVERDUE_MIN} min past the round time. Any of these ends the round and the session: ${SYMPTOMS.join(', ')}. Then: ${GET_OUT}`);
  if (plan.saunaName || plan.usualTempC) lines.push(`His sauna: ${plan.saunaName || 'not named'}${plan.usualTempC ? `, usually ${plan.usualTempC}°C` : ''}.`);
  // A9: planned days, and what the app would propose (he confirms; sauna_plan plans them).
  const planned = (plan.planned || []).filter((p) => p.date >= s.today);
  lines.push(planned.length ? `Planned sauna days: ${planned.map((p) => `${dayText(p.date, s.today)} ${formatHm(p.time || SAUNA_TIME)}`).join('; ')}.` : 'No sauna days planned.');
  const prop = saunaProposal(s);
  lines.push(prop.items.length ? `The app would propose (${prop.perWeek === 1 ? 'once a week at his level' : 'about two a week while building up, separate days'}; rest days first, never before lifting): ${prop.items.map((x) => `${dayText(x.date, s.today)} ${formatHm(x.time)} (${proposalDayText(x, LABEL)})`).join('; ')}.${prop.items.some((x) => x.maybe) ? ` Today's session isn't done, so where a day reads "X, or Y": X if today's session moves to tomorrow, Y if he does it today; the time is after lifting either way.` : ''} Offer them; plan only what he agrees to (sauna_plan).` : `Nothing more to propose this week (${prop.perWeek} a week${planned.length ? ', already planned' : ''}).`);
  return lines.join('\n');
}

/** A9: the proposal for the coming week from the rotation and his session times. */
export function saunaProposal(s) {
  // While today's session is open, the days ahead depend on it (decision 15): a day that is rest only if he trains
  // today counts as training, so nothing is proposed before lifting either way.
  const rotation = projectRotationEitherWay({ last: s.last(), days: s.days(), from: s.today, n: 8 });
  return proposeSaunaDays({ sessions: s.list('sauna'), plan: s.one('sauna-plan', 'main') || {}, rotation, days: s.days(), today: s.today });
}

// ---- squat depth --------------------------------------------------------------------------------------------------

function squatText(s, { limit = 5 }) {
  const runs = s.list('squats').filter((r) => r.reps?.length).sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.min(Number(limit) || 5, 20));
  if (!runs.length) return 'No Squat Depth runs yet.';
  return [`Squat Depth runs (target ${runs[0].targetDeg ?? 75}°; thighs parallel is about 72°), newest first:`, ...runs.map((r) => `${whenText(r.startedAt, s.tz, s.today)}: ${runText(r)}${r.reps?.length ? ` (reps ${r.reps.map((x) => `${Math.round(x.minDeg)}°`).join(', ')})` : ''}${r.link?.sessionId ? ' · filled into a squat set' : ''}`)].join('\n');
}

// ---- notes --------------------------------------------------------------------------------------------------------

function notesText(s, { limit = 20 }) {
  const notes = s.list('coach-notes').sort((a, b) => b.at - a.at).slice(0, Math.min(Number(limit) || 20, 60));
  const rem = s.list('coach-reminders').filter((r) => !r.cancelledAt).sort((a, b) => a.at - b.at);
  const lines = [notes.length ? 'Notes, newest first:' : 'No notes yet.', ...notes.map((n) => `- ${whenText(n.at, s.tz, s.today)}${n.topic ? ` [${n.topic}]` : ''} [id ${n.id}]: ${n.text}`)];
  const upcoming = rem.filter((r) => (r.trigger ? !r.firedAt : r.at >= s.now - 3600000));
  if (upcoming.length) lines.push('Reminders set:', ...upcoming.map((r) => `- ${r.trigger ? `when he starts his workout log, ${dayText(r.date, s.today)} or later` : whenText(r.at, s.tz, s.today)} [id ${r.id}]: ${r.text}`));
  return lines.join('\n');
}

const read = (name, title, description, inputSchema, fn) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true }, run: async (args, ctx) => {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const text = fn(s, args || {});
  return { text, summary: text.split('\n')[0].slice(0, 120) };
} });

export const READ_TOOLS = [
  read('weather', 'Weather', "The weather at his place now and the next hours (Open-Meteo forecast model): raining or not now, chance of rain, UV and how hot it feels, and today's safe walking windows. For 'is it raining?', 'should I walk now?'.", obj(), (s) => weatherText(s)),
  read('today', 'Today', "Everything about today: the rotation (today's day type, week column, or why it's a rest day, and the next session), the session time and check-in, the session in progress with the next set, tendon holds due, supplements, food so far, the next body scan. Call it first for any question about today or tomorrow.", obj(), (s) => todayText(s)),
  read('programme', 'Programme', "A day's routine with each exercise's target for the next session (exactly what Start gives: total kg with the bar and plates per side, reps, sets, and why: table, 30% cap, check-in), plus last time. dayType defaults to the next session; week shows another week's column.", obj({ dayType: DAY_TYPE, week: { type: 'integer', minimum: 1, maximum: 12 } }), (s, a) => programmeText(s, a)),
  read('tendons', 'Tendons', 'His tendon areas with their phase, holds (load, sets, seconds, where, when), what is done and due, his note\'s rules, the readiness table and today\'s check-in.', obj(), (s) => tendonsText(s)),
  read('history', 'History', "His training history (Strong, Hevy and Training HQ, all imported). With exercise: that exercise's sessions set by set, its records and best weight per rep count. Without: the sessions in a date range (default the last 14 days), set by set.", obj({ exercise: { type: 'string', description: 'what he calls it, e.g. "squat", "cable row"' }, from: ISO, to: ISO, dayType: DAY_TYPE, limit: { type: 'integer', minimum: 1, maximum: 40 } }), (s, a) => historyText(s, a)),
  read('calendar', 'Calendar', 'Day by day what happened: sessions, holds, meals, supplements, squat depth, sauna, body scans, rest days, plus the week streak. A month (YYYY-MM, default this month) or a date range.', obj({ month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, from: ISO, to: ISO }), (s, a) => calendarText(s, a)),
  read('health', 'Apple Health', 'Steps, sleep, weight and workouts per day from Apple Health (the iPhone Shortcut), the bodyweight used for pull-ups, and his latest body measurements.', obj({ days: { type: 'integer', minimum: 1, maximum: 120 } }), (s, a) => healthText(s, a)),
  read('meals', 'Meals', 'Meals on a day (default today) with items, grams, kcal and protein, their state, the day total against his targets, and his usual foods.', obj({ date: ISO }), (s, a) => mealsText(s, a)),
  read('micronutrients', 'Vitamins and minerals', "Vitamins, minerals, EPA/DHA and carnitine for a day (default today) or the 7 days up to it: from the food he logged (USDA values, his analysis's cooking factors) and the supplements he ticked taken, against the references of his own diet analysis, with his planned day beside it. Numbers only: no advice.", obj({ date: ISO, week: { type: 'boolean' } }), (s, a) => microText(s, a)),
  read('supplements', 'Supplements', "His supplement list as he set it (dose, rest-day dose, time, with food, days, stock left), the checklist for a day (default today), streak, adherence, considering list and planning answers. Tracking only: never suggest a supplement or a dose.", obj({ date: ISO }), (s, a) => supplementsText(s, a)),
  read('body_scans', 'Body scans', 'The Evolt 360 scan plan: next date or proposal, safety notice, staff instructions, preparation checklist, past results with their conditions, the latest change.', obj(), (s) => scansText(s)),
  read('sauna', 'Sauna', "The sauna ladder (today's step, clean sessions needed), the doctor question, a session in progress, the last sessions with symptoms, and the fixed rules. The ladder and hard stops can't be changed.", obj(), (s) => saunaText(s)),
  read('squat_sessions', 'Squat Depth', 'Recent Squat Depth runs: good and shallow reps, the lowest angle, each rep.', obj({ limit: { type: 'integer', minimum: 1, maximum: 20 } }), (s, a) => squatText(s, a)),
  read('recovery', 'Recovery', "His recovery record's state in the app: days since it started, the weekly check-in (due or not, his past answers), what he still has to do, the checkup date, the photos. His record itself (what is CURRENT, what EXPIRED) is in your instructions.", obj(), (s) => recoveryText(s)),
  read('notes', 'Notes', 'Notes the coach wrote for him, and reminders set.', obj({ limit: { type: 'integer', minimum: 1, maximum: 60 } }), (s, a) => notesText(s, a)),
];

export { suppDayKind };
