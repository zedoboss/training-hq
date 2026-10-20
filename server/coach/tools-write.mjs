// The coach's write tools (8.2, brief sections 7 and 11): the workout log (start a session, log or correct a set,
// next exercise, the rest timer), meals, supplements and restock or "considering" answers, body scans, reminders,
// notes, the sauna (start, end, symptoms) and the session time. They write the same records the phone's screens
// write, with the same rule code, on the Mac; the phone gets them at once by sync. Things only the phone can do (its
// rest timer, showing a screen) go to it as actions. Nothing here can bend a fixed rule: the 30% guard warns, the
// sauna ladder and hard stops are untouched, supplements are only what he says he took.
import { snapshot, dayText, timeText, loadText, repsText, mmss, plural, findByName, wrote, refuse, k, formatHm } from './shared.mjs';
import { offered, saidNow, toldToStart } from './tools-app.mjs';
import { currentExercise, nextSetText, activeText, mealsText, suppDayKind, saunaProposal } from './tools-read.mjs';
import { LABEL, withTime, withRest, rotationDay, addDays } from '../../app/js/lib/rotation.js';
import { buildSession, previousFor, fillForTick, restAfter, guardLoad, BODYWEIGHT_TYPES, newSetId } from '../../app/js/lib/session.js';
import { guardCheck } from '../../app/js/lib/targets.js';
import { setRecord, comebackStartOf } from '../../app/js/lib/finish.js';
import { restFor, restText } from '../../app/js/lib/settings.js';
import { modeOf } from '../../app/js/lib/progression.js';
import { currentBodyweight, weightSeries, dailyWeights } from '../../app/js/lib/health.js';
import { measureIdFor } from '../../app/js/lib/body.js';
import { newId } from '../../app/js/lib/routines.js';
import { newMeal, cleanItems, itemTotals, defaultMealName } from '../../app/js/lib/meals.js';
import { logEntry, logId, statusOn, scheduledOn, stockStatus, lastsText, checklist, reviewOpen, applyReview, answerReview } from '../../app/js/lib/supplements.js';
import { scanStatus, confirmDate, cancelDate, scanId, protocolOf, conditionsFrom, withResults, cleanMetrics, expectedEitherWay, withProtocol } from '../../app/js/lib/scans.js';
import { ladderState, stepText, feelOffState, endHereState, afterAnswerState, phaseOf, GET_OUT, SYMPTOMS, CHECKLIST, planSaunaDay, SAUNA_TIME, proposalDayText } from '../../app/js/lib/sauna.js';
import { zonedTime, addMinutesHm, LOGGED_COLS, withZone } from '../../app/js/lib/time.js';
import { restAskAreas, withRestChoice, restChoiceText } from '../../app/js/lib/holds.js';
import { withUsda, sameFood, gramsFor, amountText } from '../../app/js/lib/foods.js';
import { foodsDb, myFoods } from '../foods.mjs';
import { checkInNote, missingAnswers, withTask, withCheckup, noteId } from '../../app/js/lib/recovery.js';
import { askedAreas, loadedAreas, exercisesLoading, workingKeys, decide, complete, paramsOf, ACTION_TEXT } from '../../app/js/lib/readiness.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HM = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: '24-hour "HH:MM" in his time zone' };
const SET_TYPE = { type: 'string', enum: ['warmup', 'normal', 'dropset', 'failure', 'hold'] };

// A3: a new log made through the coach carries the zone of the phone he is talking from; an existing one keeps its own.
const put = (s, col, id, data) => s.store.writeLocal(col, id, zoned(s, col, id, data));
function zoned(s, col, id, data) {
  if (!LOGGED_COLS.has(col) || !data || typeof data !== 'object' || data.tz) return data;
  const cur = s.store.getRecord(col, id);
  if (!cur || cur.deleted || !cur.data) return withZone(col, data, s.tz);
  return cur.data.tz ? { ...data, tz: cur.data.tz } : data;
}
const del = (s, col, id) => s.store.writeLocal(col, id, null, { deleted: true });
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

// ---- the workout log ----------------------------------------------------------------------------------------------

/** The 30% guard on a load, as the session screen checks it (main lifts only; bodyweight + added for pull-ups). */
function guardFor(s, session, ex, kgVal) {
  if (!ex || kgVal == null || ex.capClass !== 'main') return null;
  const history = s.history(session.id);
  const bw = session.bodyweightKg;
  if (BODYWEIGHT_TYPES.includes(ex.type) && bw != null) {
    const hist = history.all(ex.name).map((e) => {
      const work = e.sets.filter((x) => !x.hold && x.type !== 'warmup' && x.type !== 'hold');
      return work.length ? { date: e.date, kg: guardLoad(ex.type, Math.max(...work.map((x) => x.kg ?? 0)), bw) } : null;
    }).filter(Boolean);
    const g = guardCheck({ kg: guardLoad(ex.type, kgVal, bw), capClass: ex.capClass, history: hist, today: s.today, smallestPlate: s.minPlate() });
    if (!g) return null;
    const back = (x) => Math.max(0, Math.round((ex.type === 'assisted_bodyweight' ? bw - x : x - bw) * 2) / 2);
    return `Over his 30% cap (with ${k(bw)} kg bodyweight): heaviest in the last week was +${k(back(g.basis.kg))} kg (${dayText(g.basis.date, s.today)}); +${k(kgVal)} kg is ${g.over}% more. +${k(back(g.suggest))} kg keeps him under it.`;
  }
  const g = guardCheck({ kg: kgVal, capClass: ex.capClass, history: history.guardHistory(ex.name), today: s.today, barKg: ex.barKg, smallestPlate: s.minPlate() });
  return g ? `Over his 30% cap: ${g.basis.window === '7 days' ? 'heaviest in the last 7 days' : 'last session'} was ${k(g.basis.kg)} kg (${dayText(g.basis.date, s.today)}); ${k(kgVal)} kg is ${g.over}% more; the cap is ${k(g.capKg)} kg. ${k(g.suggest)} kg keeps him under it.` : null;
}

function pickExercise(session, sets, name) {
  if (!name) return { ex: currentExercise(session, sets) };
  const { item, ambiguous } = findByName(session.exercises, name);
  if (item) return { ex: item };
  return { error: ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : `"${name}" isn't in this session. Its exercises: ${session.exercises.map((e) => e.name).join('; ')}.` };
}

function setNo(sets, set) { return sets.filter((x) => x.exKey === set.exKey).findIndex((x) => x.id === set.id) + 1; }
const valuesText = (ex, x) => (x.type === 'hold' ? `hold ${x.durationS ?? '?'} s${x.kg != null ? ` at ${loadText(x.kg, ex.barKg)}` : ''}`
  : BODYWEIGHT_TYPES.includes(ex.type) ? `${x.kg ? `${ex.type === 'assisted_bodyweight' ? '-' : '+'}${k(x.kg)} kg` : 'bodyweight'} × ${x.reps ?? '?'}`
    : `${loadText(x.kg, ex.barKg)} × ${x.reps ?? '?'}`);

async function logSet(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const session = s.active();
  if (!session) return refuse('No session in progress. Start one first (start_session), or log it on the phone.');
  const sets = s.setsOf(session.id);
  const { ex, error } = pickExercise(session, sets, a.exercise);
  if (error) return refuse(error);
  if (!ex) return refuse('Every set of this session is ticked. Add an exercise on the phone, or finish the session there.');
  const mine = sets.filter((x) => x.exKey === ex.key);
  let set = a.set ? mine[a.set - 1] : mine.find((x) => !x.done && (!a.type || x.type === a.type));
  if (set?.done) return refuse(`${ex.name} set ${a.set} is already ticked (${valuesText(ex, set)}). Use correct_set to change it.`);
  let added = false;
  if (!set) {
    const last = mine.filter((x) => x.type !== 'warmup').at(-1) || mine.at(-1);
    set = { id: newSetId(), sessionId: session.id, exKey: ex.key, order: Math.max(-1, ...sets.map((x) => x.order)) + 1, done: false, doneAt: null, rpe: null, note: '', type: a.type || (last?.type === 'warmup' ? 'normal' : last?.type) || 'normal', kg: last?.kg ?? null, reps: null, durationS: last?.durationS ?? null, target: last?.target ?? null };
    added = true;
  }
  const patch = {};
  if (num(a.kg) !== undefined) patch.kg = num(a.kg);
  if (num(a.reps) !== undefined) patch.reps = Math.round(num(a.reps));
  if (num(a.seconds) !== undefined) patch.durationS = Math.round(num(a.seconds));
  if (a.type) patch.type = a.type;
  if (num(a.rpe) !== undefined) patch.rpe = num(a.rpe);
  if (a.note) patch.note = String(a.note).slice(0, 300);
  const st = s.settings();
  const history = s.history(session.id);
  const prevAll = history.previous(ex.name, st.previousFrom === 'same-routine' ? { routineId: session.routineId, dayType: session.dayType } : null);
  const withNew = added ? [...mine, set] : mine;
  let filled = { ...set, ...patch };
  filled = { ...filled, ...fillForTick(filled, previousFor(prevAll, withNew, filled)), done: true, doneAt: s.now };
  const guard = filled.type === 'warmup' || filled.type === 'hold' ? null : guardFor(s, session, ex, filled.kg);
  const rec = setRecord({ set: filled, name: ex.name, sessionId: session.id, otherSets: withNew, history, comebackStart: comebackStartOf(s.meta()) });
  put(s, 'sets', filled.id, filled);
  const after = withNew.map((x) => (x.id === filled.id ? filled : x));
  const next = after.find((x) => !x.done);
  let restLine = '';
  if (!(set.type === 'normal' && next?.type === 'dropset') && restAfter(session.exercises, ex.key)) {
    const secs = restFor(ex, filled.type, st);
    if (secs) { ctx.action({ kind: 'rest', seconds: secs, label: ex.name }); restLine = ` Rest ${restText(secs)} started on his phone.`; }
  }
  const t = set.target || {};
  const allSets = [...sets.filter((x) => x.id !== filled.id), filled].sort((p, q) => p.order - q.order);
  const nowEx = currentExercise(session, allSets);
  const lines = [`Logged ${ex.name}, set ${setNo(after, filled)} of ${after.length}${added ? ' (an extra set)' : ''}${filled.type !== 'normal' ? ` (${filled.type})` : ''}: ${valuesText(ex, filled)}.${t.kg != null || t.reps ? ` Target was ${t.kg != null ? k(t.kg) : '?'} × ${repsText(t.reps) || '?'}.` : ''}${restLine}`];
  if (guard) lines.push(guard);
  else if (t.kg > 0 && filled.kg != null && filled.kg > t.kg * 1.5 && filled.type !== 'warmup') lines.push(`Check it: ${k(filled.kg)} kg is far above today's target of ${k(t.kg)} kg on ${ex.name}.`);
  if (rec) lines.push(`New comeback best on ${ex.name}: ${k(rec.kg)} kg${rec.previous ? ` (before: ${k(rec.previous)} kg)` : ''}.`);
  lines.push(nowEx ? `Next: ${nextSetText(nowEx, allSets)}.` : 'That was the last set of the session: he finishes it on the phone (summary and records).');
  return wrote(lines.join('\n'), `${ex.name} ${valuesText(ex, filled)}${guard ? ' · over 30% cap' : ''}`);
}

/** The session to correct: the one in progress, else the last one he finished in the past 24 hours. */
function sessionToFix(s) {
  const active = s.active();
  if (active) return active;
  return s.list('sessions').filter((x) => x.kind !== 'holds' && x.status === 'done' && (x.endedAt || x.startedAt) > s.now - 86400000).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

async function correctSet(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const session = sessionToFix(s);
  if (!session) return refuse('No session in progress or finished in the last 24 hours. Older sessions are edited on the phone (History).');
  const sets = s.setsOf(session.id);
  const { ex, error } = pickExercise(session, sets, a.exercise);
  if (error || !ex) return refuse(error || 'Which exercise?');
  const mine = sets.filter((x) => x.exKey === ex.key);
  const set = a.set ? mine[a.set - 1] : [...mine].filter((x) => x.done).sort((p, q) => (q.doneAt || 0) - (p.doneAt || 0))[0];
  if (!set) return refuse(`${ex.name} has ${plural(mine.length, 'set')}${a.set ? `; there is no set ${a.set}` : ' and none is ticked yet'}.`);
  const n = setNo(sets, set);
  if (a.remove) {
    del(s, 'sets', set.id);
    return wrote(`Removed ${ex.name} set ${n} (${valuesText(ex, set)}) from ${session.title}.`, `${ex.name} set ${n} removed`);
  }
  const next = { ...set };
  if (num(a.kg) !== undefined) next.kg = num(a.kg);
  if (num(a.reps) !== undefined) next.reps = Math.round(num(a.reps));
  if (num(a.seconds) !== undefined) next.durationS = Math.round(num(a.seconds));
  if (a.type) next.type = a.type;
  if (num(a.rpe) !== undefined) next.rpe = num(a.rpe);
  if (a.note !== undefined) next.note = String(a.note).slice(0, 300);
  if (a.done === true && !set.done) { next.done = true; next.doneAt = s.now; }
  if (a.done === false) { next.done = false; next.doneAt = null; }
  put(s, 'sets', set.id, next);
  const guard = next.kg !== set.kg && next.type !== 'warmup' && next.type !== 'hold' ? guardFor(s, session, ex, next.kg) : null;
  return wrote(`${ex.name} set ${n} of ${session.title} is now ${valuesText(ex, next)}${next.done ? '' : ' (not ticked)'} (was ${valuesText(ex, set)}).${guard ? `\n${guard}` : ''}`, `${ex.name} set ${n}: ${valuesText(ex, next)}`);
}


/** True when the coach's last reply before this turn offered this session (start_session "asked first") and his
 * message now is the next one, within 30 minutes. */
const offeredLastTurn = (s, ctx, key) => offered(s, ctx, 'start_session', key);

async function startSession(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const active = s.active();
  if (active) return refuse(`${activeText(s, active)} Finish or discard it on the phone before starting another.`);
  const routines = s.list('routines');
  let routine = null;
  if (a.empty) routine = null;
  else if (a.routine) {
    const { item, ambiguous } = findByName(routines, a.routine, (r) => r.title, (r) => [r.dayType, LABEL[r.dayType]]);
    if (!item) return refuse(ambiguous.length ? `Which routine: ${ambiguous.join('; ')}?` : `No routine called "${a.routine}". Routines: ${routines.map((r) => r.title).join('; ')}.`);
    routine = item;
  } else {
    const type = a.dayType || s.rotation().next.dayType;
    const mode = modeOf(s.one('progression', 'modes'), type);
    routine = routines.filter((r) => r.dayType === type && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((x, y) => x.order - y.order)[0] || routines.find((r) => r.dayType === type) || null;
    if (!routine) return refuse(`No routine for ${LABEL[type] || type}.`);
  }
  // His rule (Mon 10/19): the coach asks before it starts a session. A first call never starts one; it starts only
  // when his very next message answers the offer (the coach's last reply offered this same session), or (Tue 10/20,
  // "If I say 'Go start a new workout push'...") when he told it to start one in so many words.
  const key = routine?.id || 'empty';
  if (!toldToStart(saidNow(s, ctx)) && !offeredLastTurn(s, ctx, key)) {
    const name = routine ? routine.title : 'an empty session';
    return { text: `Not started. Ask him first, in a few words: "Start ${name} now?" Only a yes in his next message starts it: then call start_session again with the same choice. Talking about training ("about to start squats", "at the gym") is not a yes: hype him up and ask.`, summary: `asked first: ${key}` };
  }
  const st = s.settings();
  const rd = s.days()[s.today]?.readiness;
  const lighter = rd && routine && rd.dayType === routine.dayType && (rd.action === 'lighter-all' || rd.action === 'lighter-area') ? { all: rd.action === 'lighter-all', names: rd.lighterExercises || [], params: rd.params, rule: rd.rule } : null;
  const { session, sets } = buildSession({
    routine, meta: s.meta(), programmeRoutines: s.list('programme').filter((d) => d.kind === 'routine'), lib: s.lib(), history: s.history(), today: s.today, now: s.now,
    smallestPlate: s.minPlate(), gym: st.gym.name, warmupSteps: st.warmup.steps, sameRoutine: st.previousFrom === 'same-routine',
    bodyweightKg: currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: st.bodyweight, now: s.now })?.kg ?? null, progress: s.list('progression'), lighter,
  });
  s.store.writeLocalMany([...sets.map((x) => ({ col: 'sets', id: x.id, data: x })), { col: 'sessions', id: session.id, data: zoned(s, 'sessions', session.id, session) }]);
  ctx.action({ kind: 'go', url: `#/session/${session.id}`, label: 'Open the session' });
  const first = session.exercises.find((e) => sets.some((x) => x.exKey === e.key));
  const rot = s.rotation();
  const notes = [];
  if (routine?.dayType && rot.today.kind !== 'train') notes.push(`Today is ${rot.today.kind === 'done' ? `${LABEL[rot.today.dayType]} done already` : 'a rest day in the rotation'}.`);
  else if (routine?.dayType && rot.today.dayType !== routine.dayType) notes.push(`The rotation says ${LABEL[rot.today.dayType]} today.`);
  if (routine?.dayType && !rd) notes.push('Check-in not done today.');
  if (lighter) notes.push(`Lighter from today's check-in (rule ${lighter.rule}).`);
  return wrote(`Started ${session.title}${session.week ? ` (week ${session.week} column)` : ''}: ${plural(session.exercises.length, 'exercise')}, ${plural(sets.length, 'set')}. It is open on his phone.${first ? ` First: ${nextSetText(first, sets)}.` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`, `${session.title} started`);
}

async function nextExercise(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const session = s.active();
  if (!session) return refuse('No session in progress.');
  const sets = s.setsOf(session.id);
  const isOpen = (e) => sets.some((x) => x.exKey === e.key && !x.done);
  const open = session.exercises.filter(isOpen);
  if (!open.length) return refuse('Every set is ticked: he finishes the session on the phone.');
  // From the exercise he worked on last (or the first with sets left): the next one after it with sets left.
  const lastTicked = sets.filter((x) => x.done).sort((p, q) => (q.doneAt || 0) - (p.doneAt || 0))[0];
  const cur = lastTicked ? session.exercises.find((e) => e.key === lastTicked.exKey) : open[0];
  const i = session.exercises.findIndex((e) => e.key === cur?.key);
  const after = session.exercises.slice(i + 1).find(isOpen) || session.exercises.slice(0, Math.max(0, i)).find(isOpen) || cur;
  ctx.action({ kind: 'focus', sessionId: session.id, exKey: after.key });
  const left = cur && cur.key !== after.key ? sets.filter((x) => x.exKey === cur.key && !x.done).length : 0;
  return { text: `Next: ${nextSetText(after, sets)}.${left ? ` (${cur.name} still has ${plural(left, 'set')} unticked.)` : ''}`, summary: after.name };
}

async function restTimer(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const what = a.action || 'start';
  if (what === 'skip') { ctx.action({ kind: 'rest-skip' }); return { text: 'Rest timer skipped on his phone.', summary: 'skip' }; }
  if (what === 'add') {
    const secs = Math.round(num(a.seconds) ?? 15);
    ctx.action({ kind: 'rest-add', seconds: secs });
    return { text: `Rest timer ${secs >= 0 ? '+' : ''}${secs} s on his phone.`, summary: `${secs >= 0 ? '+' : ''}${secs} s` };
  }
  let secs = num(a.seconds);
  let label = 'Rest';
  if (secs === undefined) {
    const session = s.active();
    const sets = session ? s.setsOf(session.id) : [];
    const lastTicked = sets.filter((x) => x.done).sort((p, q) => (q.doneAt || 0) - (p.doneAt || 0))[0];
    const ex = session && (lastTicked ? session.exercises.find((e) => e.key === lastTicked.exKey) : currentExercise(session, sets));
    secs = restFor(ex || { capClass: 'main' }, lastTicked?.type || 'normal', s.settings()) || s.settings().rest.mainS;
    if (ex) label = ex.name;
  }
  secs = Math.max(5, Math.min(3600, Math.round(secs)));
  ctx.action({ kind: 'rest', seconds: secs, label });
  return { text: `Rest timer ${mmss(secs)} started on his phone.`, summary: mmss(secs) };
}

// ---- readiness check-in ------------------------------------------------------------------------------------------

const AREA_ORDER = ['knees', 'shoulder', 'wrist'];
const KEY_NAME = { L: 'legs', B: 'back' };

function routineFor(s, dayType) {
  const mode = modeOf(s.one('progression', 'modes'), dayType);
  const routines = s.list('routines');
  return routines.filter((r) => r.dayType === dayType && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((x, y) => x.order - y.order)[0] || routines.find((r) => r.dayType === dayType) || null;
}

const levelsText = (table, keyList) => keyList.map((k2) => {
  const r = (table.ratings || []).find((x) => x.key === k2);
  return r ? `${r.label.toLowerCase()} ${r.levels.map((l, i) => `${i} ${l}`).join(', ')}` : null;
}).filter(Boolean).join('; ');

/** The readiness check-in by talking: the same table, rules and record as the check-in screen (#/checkin). */
async function checkIn(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const table = s.one('tendons', 'readiness');
  if (!table) return refuse("The readiness table hasn't reached the Mac yet.");
  if (table.status !== 'confirmed') {
    ctx.action({ kind: 'open', url: '#/checkin', label: 'Open the check-in' });
    return refuse('His readiness table is still a draft. He confirms or edits it on the check-in screen first (decision 23); until then it is not used.');
  }
  const areas = askedAreas(s.list('tendons')).sort((x, y) => AREA_ORDER.indexOf(x.id) - AREA_ORDER.indexOf(y.id));
  const rot = s.rotation();
  const days = s.days();
  const dayType = rot.today.kind === 'train' ? rot.today.dayType : null;
  const routine = dayType ? routineFor(s, dayType) : null;
  const exNames = (routine?.exercises || []).map((e) => e.name);
  const loaded = dayType ? loadedAreas(areas, exNames) : [];
  const keys = dayType ? workingKeys(table, dayType) : [];
  const saved = days[s.today]?.readiness;

  if (a.apply) {
    if (!saved || !['move', 'rest-holds'].includes(saved.action)) return refuse('Nothing to apply: today\'s check-in says to train.');
    const cur = days[s.today] || { date: s.today };
    if (cur.rest) return refuse('Already done: today is a rest day.');
    const reason = saved.action === 'move' ? 'moved' : 'rest-holds';
    const next = withRest(cur, s.today, reason, s.now);
    put(s, 'days', s.today, next);
    if (cur.sessionTime) {
      const to = rotationDay({ last: s.last(), today: s.today, days: { ...days, [s.today]: next } }).next.date;
      if (!days[to]?.sessionTime) put(s, 'days', to, withTime(days[to], to, cur.sessionTime, s.now));
    }
    return wrote(saved.action === 'move' ? `${LABEL[saved.dayType]} moved to tomorrow, ${dayText(addDays(s.today, 1), s.today)}. ${LABEL[saved.dayType]} stays next.` : `Rest and tendon holds today, with less weight or less effort. ${LABEL[saved.dayType]} stays next.`, saved.action);
  }

  const ratings = { T: {}, W: {} };
  const unknown = [];
  for (const r of a.areas || []) {
    const { item } = findByName(areas, r.area || '', (x) => x.label, (x) => [x.id]);
    if (!item) { unknown.push(r.area); continue; }
    if (Number.isInteger(r.sore)) ratings.T[item.id] = r.sore;
    if (typeof r.worse === 'boolean') ratings.W[item.id] = r.worse;
  }
  if (Number.isInteger(a.legs)) ratings.L = a.legs;
  if (Number.isInteger(a.back)) ratings.B = a.back;
  if (Number.isInteger(a.energy)) ratings.E = a.energy;
  const ids = areas.map((x) => x.id);
  const ok = dayType ? complete(ratings, ids, keys) : ids.every((id) => Number.isInteger(ratings.T[id]) && typeof ratings.W[id] === 'boolean');
  if (!ok) {
    const missing = [
      ...areas.filter((x) => !Number.isInteger(ratings.T[x.id])).map((x) => `${x.label} soreness 0-3`),
      ...areas.filter((x) => typeof ratings.W[x.id] !== 'boolean').map((x) => `${x.label}: worse than yesterday, yes or no`),
      ...keys.filter((k2) => !Number.isInteger(ratings[k2])).map((k2) => `${KEY_NAME[k2]} soreness 0-3`),
      ...(dayType && !Number.isInteger(ratings.E) ? ['energy 0-3'] : []),
    ];
    return { text: `${unknown.length ? `Not an area in his check-in: ${unknown.join(', ')}. ` : ''}Still needed before the table can decide: ${missing.join('; ')}. Ask only for what's missing, in his words: "${areas.map((x) => x.label).join(', ')}${keys.length ? `, ${keys.map((k2) => KEY_NAME[k2]).join(', ')}` : ''}${dayType ? ', then energy' : ''}. Zero to three." Levels (his table): ${levelsText(table, ['T', ...keys, ...(dayType ? ['E'] : [])])}. Nothing saved yet.`, summary: 'ratings missing' };
  }
  if (saved && !a.again) return refuse(`He already checked in today (rule ${saved.rule}: ${ACTION_TEXT[saved.action] || saved.action}). To check in again, call check_in with again: true.`);
  const movedYesterday = days[addDays(s.today, -1)]?.rest?.reason === 'moved';
  const d = decide({ table, ratings, dayType, loaded, movedYesterday });
  const names = d.action === 'lighter-area' ? exercisesLoading(areas, d.lighterAreas, exNames) : [];
  const rec = { at: s.now, dayType, routineId: routine?.id ?? null, ratings, ...d, lighterExercises: names, params: paramsOf(table), by: 'coach' };
  put(s, 'days', s.today, { ...(days[s.today] || { date: s.today }), date: s.today, readiness: rec });
  const label = (id) => areas.find((x) => x.id === id)?.label || id;
  const lines = [`Check-in saved, ${dayText(s.today, s.today)}: rule ${d.rule}${d.why ? ` (${d.why})` : ''}. ${ACTION_TEXT[d.action] || d.action}`];
  if (d.action.startsWith('lighter') && routine) {
    // The lighter targets, exactly as Start will set them.
    const st = s.settings();
    const { session, sets } = buildSession({ routine, meta: s.meta(), programmeRoutines: s.list('programme').filter((x) => x.kind === 'routine'), lib: s.lib(), history: s.history(), today: s.today, now: s.now, smallestPlate: s.minPlate(), warmupSteps: st.warmup.steps, sameRoutine: st.previousFrom === 'same-routine', bodyweightKg: currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: st.bodyweight, now: s.now })?.kg ?? null, progress: s.list('progression'), lighter: { all: d.action === 'lighter-all', names, params: rec.params, rule: d.rule } });
    const easy = session.exercises.filter((e) => e.target?.lighter);
    if (easy.length) lines.push(`Lighter today: ${easy.map((e) => { const w = sets.find((x) => x.exKey === e.key && x.type !== 'warmup'); return `${e.name} ${e.target.kg != null ? loadText(e.target.kg, e.barKg) : w?.kg != null ? loadText(w.kg, e.barKg) : ''} × ${repsText(e.target.reps || w?.target?.reps)} (${e.target.why})`; }).join('; ')}.`);
  }
  if (d.easeHolds?.length) lines.push(`Holds for ${d.easeHolds.map(label).join(', ')}: less weight or less effort today (his rule).`);
  if (['move', 'rest-holds'].includes(d.action)) lines.push(`Not applied yet: when he agrees, call check_in with apply: true (or he taps it on the check-in screen). He can also train anyway.`);
  ctx.action({ kind: 'open', url: '#/checkin', label: 'Open the check-in' });
  return wrote(lines.join('\n'), `rule ${d.rule}: ${d.action}`);
}

// ---- meals --------------------------------------------------------------------------------------------------------

const ITEMS = { type: 'array', minItems: 1, maxItems: 30, items: obj({ name: { type: 'string' }, grams: { type: 'number', minimum: 0, description: 'grams, or leave out and give packs or count for one of his foods' }, packs: { type: 'number', minimum: 0, description: 'packs of one of his foods ("half a pack of almonds" = 0.5)' }, count: { type: 'number', minimum: 0, description: 'how many of one of his counted foods (eggs, bananas, scoops)' }, usda: { type: 'string', description: 'the USDA FoodData Central description of the food, in USDA words, if you know it' }, kcal: { type: 'number', minimum: 0, description: 'only if HE gave it' }, protein: { type: 'number', minimum: 0, description: 'grams of protein, only if HE gave it' } }, ['name']) };

/**
 * A5: kcal and protein from USDA FoodData Central for each item that matches (his own foods first); numbers he gave
 * himself are kept as his ('typed'); an item with no match and no numbers is estimated from nothing, so it is refused.
 */
function mealItems(s, items) {
  const db = foodsDb();
  const mine = myFoods(s.one('fuel', 'plan'));
  // A7: "half a pack of almonds", "3 eggs": grams from his packs and counts.
  const sized = (items || []).map((x) => {
    if (x.grams != null || (x.packs == null && x.count == null)) return x;
    const food = mine.find((m) => sameFood(m.name, x.name) && ((x.packs != null && m.pack) || (x.count != null && m.unit)));
    const amount = x.packs != null ? { packs: x.packs } : { count: x.count };
    return food ? { ...x, name: food.name, grams: gramsFor(food, amount), portion: amountText(food, amount), ...(food.fdcId ? { fdcId: food.fdcId } : {}) } : { ...x, grams: null };
  });
  const noSize = sized.filter((x) => x.grams == null);
  if (noSize.length) return { items: [], unknown: [], noSize };
  const marked = sized.map((x) => (x.kcal != null || x.protein != null ? { ...x, source: 'typed', kcal: x.kcal ?? 0, protein: x.protein ?? 0 } : x));
  const out = cleanItems(db ? withUsda(db, cleanItems(marked), { prefer: mine }) : marked);
  const unknown = out.filter((x, i) => x.source !== 'usda' && marked[i].kcal == null && marked[i].protein == null);
  return { items: out, unknown, noSize: [] };
}
const sizeRefusal = (noSize) => `No grams for ${noSize.map((x) => `"${x.name}"`).join(', ')}: packs and counts work only for his foods that have them (the meals tool lists them). Ask him for the grams. Nothing saved.`;
const itemText = (x) => `${x.name} ${x.portion ? `${x.portion} (${Math.round(x.grams)} g)` : `${Math.round(x.grams)} g`}${x.source === 'usda' ? '' : x.source === 'typed' ? ' (his numbers)' : ' (estimate)'}`;

const momentOf = (s, date, hm) => (hm ? zonedTime(date || s.today, hm, s.tz) : s.now);

async function logMeal(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const at = momentOf(s, a.date, a.time);
  if (at > s.now + 3600000) return refuse('That time is in the future. Meals are logged once eaten.');
  const id = newId('meal');
  const { items, unknown, noSize } = mealItems(s, a.items);
  if (noSize.length) return refuse(sizeRefusal(noSize));
  if (unknown.length) return refuse(`No USDA match for ${unknown.map((x) => `"${x.name}"`).join(', ')}. Give its USDA FoodData Central description (usda), or ask him for the kcal and protein. Nothing logged yet.`);
  const meal = newMeal({ id, at, name: a.name ? String(a.name).slice(0, 40) : defaultMealName(at, s.settings().fuel?.mealTimes, s.tz), tz: s.tz });
  meal.before = { ...meal.before, items, confirmedAt: s.now };
  meal.by = 'coach';
  if (a.note) meal.note = String(a.note).slice(0, 300);
  put(s, 'meals', id, meal);
  const t = itemTotals(items);
  const day = mealsText(snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() }), { date: meal.date }).split('\n')[0];
  return wrote(`Logged ${meal.name}, ${timeText(at, s.tz)}${meal.date !== s.today ? ` ${dayText(meal.date, s.today)}` : ''} [id ${id}]: ${items.map(itemText).join(', ')}; ${t.kcal} kcal, ${t.protein} g protein${items.some((x) => x.source === 'usda') ? ' (USDA values)' : ''}.\n${day}`, `${meal.name}: ${t.kcal} kcal, ${t.protein} g protein`);
}

async function correctMeal(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const meal = s.one('meals', a.meal) || s.list('meals').find((m) => m.id === a.meal);
  if (!meal) return refuse(`No meal with id ${a.meal}. The meals tool lists the ids.`);
  if (a.remove) { del(s, 'meals', meal.id); return wrote(`Deleted ${meal.name} (${timeText(meal.at, s.tz)}, ${dayText(meal.date, s.today)}).`, `${meal.name} deleted`); }
  const next = { ...meal };
  if (a.items) {
    const { items, unknown, noSize } = mealItems(s, a.items);
    if (noSize.length) return refuse(sizeRefusal(noSize));
    if (unknown.length) return refuse(`No USDA match for ${unknown.map((x) => `"${x.name}"`).join(', ')}. Give its USDA FoodData Central description (usda), or ask him for the kcal and protein. Nothing changed.`);
    next.before = { ...(meal.before || {}), items, confirmedAt: s.now, edited: true };
  }
  if (a.name) next.name = String(a.name).slice(0, 40);
  if (a.time) { next.at = zonedTime(meal.date, a.time, s.tz); }
  if (a.note !== undefined) next.note = String(a.note).slice(0, 300);
  put(s, 'meals', meal.id, next);
  const t = itemTotals(next.before?.items || []);
  return wrote(`${next.name} (${timeText(next.at, s.tz)}, ${dayText(next.date, s.today)}) now: ${(next.before?.items || []).map(itemText).join(', ') || 'no items'}; ${t.kcal} kcal, ${t.protein} g protein on the plate${meal.after && !meal.after.none ? ' (his leftovers still come off)' : ''}.`, `${next.name} corrected`);
}

// ---- supplements --------------------------------------------------------------------------------------------------

function findSupp(s, name) {
  const supps = s.list('supplements').filter((x) => statusOn(x, s.today) !== 'removed');
  return findByName(supps, name, (x) => x.name, (x) => [x.short, x.id.replace(/^supp\./, '')]);
}

async function supplement(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const date = a.date || s.today;
  if (date > s.today) return refuse('That day is still to come. Supplements are ticked when taken.');
  const dayKind = suppDayKind(s, date);
  const done = []; const problems = []; const notes = [];
  const log = s.list('supp-log');
  for (const name of a.names || []) {
    const { item: supp, ambiguous } = findSupp(s, name);
    if (!supp) { problems.push(ambiguous.length ? `"${name}": which one, ${ambiguous.join(' or ')}?` : `"${name}" isn't on his list.`); continue; }
    if (a.status === 'undo') { del(s, 'supp-log', logId(date, supp.id)); done.push(`${supp.short || supp.name}: answer removed`); continue; }
    if (!scheduledOn(supp, date)) notes.push(`${supp.short || supp.name} isn't scheduled ${date === s.today ? 'today' : `on ${dayText(date, s.today)}`} (${statusOn(supp, date) === 'paused' ? 'paused' : 'not one of its days'}); logged anyway.`);
    const e = logEntry({ supp, date, dayKind, status: a.status, reason: a.reason || '', at: s.now, by: 'coach' });
    put(s, 'supp-log', e.id, e);
    done.push(`${supp.short || supp.name} ${a.status === 'taken' ? `${e.dose} taken` : `skipped${a.reason ? ` (${a.reason})` : ''}`}`);
    const stock = stockStatus(supp, [...log.filter((x) => x.id !== e.id), e]);
    if (stock?.low) notes.push(`${supp.name}: ${stock.left} servings left, ${lastsText(stock.days)}.`);
  }
  if (!done.length) return refuse(problems.join(' ') || 'Which supplement?');
  const after = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const open = checklist({ supps: after.list('supplements'), log: after.list('supp-log'), date, dayKind }).flatMap((g) => g.items).filter((i) => !i.entry).map((i) => i.supp.short || i.supp.name);
  return wrote([`${dayText(date, s.today)}: ${done.join('; ')}.`, ...problems, ...notes, open.length ? `Still open: ${open.join(', ')}.` : 'Everything for the day is answered.'].join('\n'), done.join('; '));
}

async function supplementPlan(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const today = s.today;
  if (a.kind === 'restock') {
    const { item: supp, ambiguous } = findSupp(s, a.supplement || '');
    if (!supp) return refuse(ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : 'Which supplement is this about?');
    if (!['restock', 'not-now', 'stop'].includes(a.answer)) return refuse('The restock answer is restock, not-now or stop.');
    const id = newId('ans');
    put(s, 'supp-answers', id, { id, kind: 'low', suppId: supp.id, countedAt: supp.stock?.countedAt ?? null, answer: a.answer, text: a.text || '', at: s.now, date: today, by: 'coach' });
    return wrote(`Recorded for ${supp.name}: ${a.answer === 'restock' ? 'restocking' : a.answer === 'stop' ? `stopping it (it stays on his list until he removes it there)` : 'not now'}.${a.answer === 'restock' ? ' When the new pack arrives he enters the count on the supplement.' : ''}`, `${supp.short || supp.name}: ${a.answer}`);
  }
  if (a.kind === 'weekly') {
    if (!['nothing', 'restock-some', 'add'].includes(a.answer)) return refuse('The weekly answer is nothing, restock-some or add.');
    const id = newId('ans');
    put(s, 'supp-answers', id, { id, kind: 'weekly', answer: a.answer, text: a.text || '', at: s.now, date: today, by: 'coach' });
    if (a.answer === 'add' && a.text) { const cid = newId('consider'); put(s, 'supp-considering', cid, { id: cid, name: String(a.text).slice(0, 60), note: a.note || '', addedOn: today, status: 'considering' }); }
    return wrote(`Recorded this week's answer: ${a.answer === 'nothing' ? 'nothing this week' : a.answer === 'add' ? `something new${a.text ? ` (${a.text}, on the considering list)` : ''}` : `restocking${a.text ? ` ${a.text}` : ''}`}.`, `weekly: ${a.answer}`);
  }
  if (a.kind === 'considering') {
    if (!a.name) return refuse('What is he considering?');
    const id = newId('consider');
    put(s, 'supp-considering', id, { id, name: String(a.name).slice(0, 60), note: a.note || '', addedOn: today, status: 'considering' });
    return wrote(`Added to his considering list: ${a.name}. It stays there until he decides; nothing is added to his supplements.`, `considering ${a.name}`);
  }
  if (a.kind === 'drop_considering') {
    const { item } = findByName(s.list('supp-considering').filter((c) => c.status === 'considering'), a.name || '');
    if (!item) return refuse(`"${a.name}" isn't on the considering list.`);
    put(s, 'supp-considering', item.id, { ...item, status: 'dropped', droppedOn: today });
    return wrote(`Took ${item.name} off the considering list.`, `dropped ${item.name}`);
  }
  return refuse('kind is restock, weekly, considering or drop_considering.');
}

// ---- body scans ---------------------------------------------------------------------------------------------------

async function bodyScan(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const plan = s.one('scan-plan', 'main') || {};
  const savePlan = (p) => put(s, 'scan-plan', 'main', p);
  const st = scanStatus({ plan, scans: s.list('body-scans'), today: s.today, last: s.last(), days: s.days() });
  // How often (Tue 10/20, his answer: "every day except my rest days").
  if (a.action === 'every') {
    const v = a.every === 'monthly' ? 'monthly' : 'training';
    savePlan({ ...plan, cadence: v, log: [...(plan.log || []), { at: s.now, what: `every ${v === 'training' ? 'training day' : '4 weeks'}`, date: null }] });
    return wrote(v === 'training' ? 'Scans now every training day, first thing at the gym before the workout; no dates to confirm. The app nudges him on each training day until the numbers are saved.' : `Scans now every 4 weeks. The app proposes ${dayText(st.proposal.date, s.today)}: confirm it with him.`, `scans every ${v === 'training' ? 'training day' : '4 weeks'}`);
  }
  // One checklist line in his words (his gym's instructions or his own routine win), or a new one.
  if (a.action === 'checklist_line') {
    const text = String(a.text || '').trim();
    if (!text) return refuse('Which words for the line?');
    const items = protocolOf(plan).map((i) => ({ ...i }));
    const i = items.findIndex((x) => x.id === a.line);
    if (i >= 0) items[i].text = text; else items.push({ id: `own-${s.now.toString(36)}`, when: a.when === 'before' ? 'before' : 'day', text });
    savePlan(withProtocol(plan, items, `${i >= 0 ? `Changed "${a.line}"` : 'Added a line'} (coach)`, s.now));
    return wrote(`Checklist ${i >= 0 ? 'line changed' : 'line added'}: ${text}`, 'scan checklist');
  }
  if (a.action === 'confirm_date') {
    if (st.cadence === 'training') return refuse('Scans are every training day: no date to confirm. Use every: "monthly" first if he wants dates again.');
    const date = a.date || st.proposal.date;
    if (date < s.today) return refuse(`Pick today or a later day.`);
    savePlan(confirmDate(plan, date, { proposedDate: st.proposal.date, at: s.now }));
    // Tue 10/20: he wanted his scan today. No evening-before list then: give him the on-the-day checklist now.
    if (date === s.today) {
      const day = protocolOf(plan).filter((i) => i.when === 'day').map((i) => i.text.replace(/\.$/, '')).join('; ');
      return wrote(`Body scan confirmed for today, ${dayText(date, s.today)}. Go through this with him now (the app also nudges him until it's done): ${day}. If he ate something the checklist doesn't allow, record it with the results (fasted: false). Scan before the workout; then save the numbers with record_results.`, 'scan today');
    }
    return wrote(`Body scan confirmed for ${dayText(date, s.today)}${date !== st.proposal.date ? ` (the app had proposed ${dayText(st.proposal.date, s.today)})` : ''}: first thing at the gym, before the workout. Reminders two evenings before, the evening before with the list, and at his session time.`, `scan ${date}`);
  }
  if (a.action === 'cancel_date') {
    if (!st.next) return refuse('No scan date is confirmed.');
    savePlan(cancelDate(plan, s.now));
    return wrote(`The scan on ${dayText(st.next.date, s.today)} is cancelled. The app proposes ${dayText(st.proposal.date, s.today)}.`, 'scan cancelled');
  }
  if (a.action === 'safety_read') {
    savePlan({ ...plan, safety: { readAt: s.now } });
    return wrote("Recorded: he has read the scanner's own safety notice.", 'safety notice read');
  }
  if (a.action === 'staff_said') {
    if (!a.text) return refuse('What did the staff say?');
    savePlan({ ...plan, staff: [...(plan.staff || []), { at: s.now, text: String(a.text).slice(0, 1000) }] });
    return wrote(`Recorded what his gym's staff said. He can change the checklist to match on the Body scan screen.`, 'staff instructions');
  }
  if (a.action === 'record_results') {
    const date = a.date || s.today;
    const metrics = cleanMetrics((a.metrics || []).map((m) => ({ label: m.label, value: m.value, text: m.text ?? (m.value != null ? String(m.value) : ''), unit: m.unit || '' })));
    if (!metrics.length) return refuse('Which numbers? Give each as label, value and unit, exactly as the scan shows them.');
    const rec = s.one('body-scans', scanId(date));
    const items = protocolOf(plan);
    const base = conditionsFrom(rec, items);
    const conditions = { ...base, fasted: a.fasted ?? base.fasted, trainedBefore: a.trainedBefore ?? base.trainedBefore, unusual: String(a.unusual || '').slice(0, 300) };
    const hm = a.time || s.days()[date]?.sessionTime || '05:00';
    put(s, 'body-scans', scanId(date), withResults(rec, { date, at: zonedTime(date, hm, s.tz), metrics, conditions, photos: rec?.photos || [], source: 'coach', note: rec?.note || '' }, s.now));
    return wrote(`Saved the scan of ${dayText(date, s.today)} at ${formatHm(hm)}: ${metrics.map((m) => `${m.label} ${m.text}${m.unit ? ` ${m.unit}` : ''}`).join('; ')}. He can check or fix them on the Body scan screen.`, `scan ${date}: ${metrics.length} numbers`);
  }
  return refuse('action is confirm_date, cancel_date, safety_read, staff_said or record_results.');
}

// ---- reminders and notes ------------------------------------------------------------------------------------------

async function setReminder(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  if (a.cancel) {
    const r = s.one('coach-reminders', a.cancel);
    if (!r) return refuse(`No reminder with id ${a.cancel}.`);
    put(s, 'coach-reminders', r.id, { ...r, cancelledAt: s.now });
    return wrote(`Cancelled the reminder for ${dayText(s.date(r.at), s.today)}, ${timeText(r.at, s.tz)}: ${r.text}`, 'reminder cancelled');
  }
  if (!a.time || !a.text) return refuse('A reminder needs a time and what to say.');
  let date = a.date || s.today;
  let at = zonedTime(date, a.time, s.tz);
  if (!a.date && at <= s.now) { date = addDays(s.today, 1); at = zonedTime(date, a.time, s.tz); }
  if (at <= s.now) return refuse('That time has passed.');
  const id = newId('rem');
  put(s, 'coach-reminders', id, { id, at, date, hm: a.time, text: String(a.text).slice(0, 200), createdAt: s.now, by: 'coach' });
  return wrote(`Reminder set for ${dayText(date, s.today)}, ${formatHm(a.time)}: "${a.text}". It comes as a notification from the Mac (when notifications are on) [id ${id}].`, `${dayText(date, s.today)} ${formatHm(a.time)}`);
}

async function writeNote(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  if (a.remove) {
    const n = s.one('coach-notes', a.remove);
    if (!n) return refuse(`No note with id ${a.remove}.`);
    del(s, 'coach-notes', n.id);
    return wrote(`Deleted the note: ${n.text}`, 'note deleted');
  }
  if (!a.text) return refuse('What should the note say?');
  const id = newId('note');
  put(s, 'coach-notes', id, { id, at: s.now, date: s.today, text: String(a.text).slice(0, 2000), topic: a.topic ? String(a.topic).slice(0, 40) : '', by: 'coach' });
  return wrote(`Noted${a.topic ? ` (${a.topic})` : ''}: ${a.text}`, a.topic || 'note');
}

// ---- sauna --------------------------------------------------------------------------------------------------------

async function sauna(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const sessions = s.list('sauna');
  const active = sessions.find((x) => x.status === 'active');
  const openAfter = sessions.filter((x) => x.status !== 'active' && x.after && !x.after.answeredAt).sort((p, q) => q.startedAt - p.startedAt)[0];
  const words = (a.symptoms || []).map((x) => String(x).trim()).filter(Boolean).map((x) => SYMPTOMS.find((y) => y.toLowerCase().replace(/"/g, '') === x.toLowerCase().replace(/"/g, '')) || x.slice(0, 60));
  if (a.action === 'symptoms') {
    if (active) {
      put(s, 'sauna', active.id, feelOffState(active, { when: 'coach', what: words, now: s.now }));
      ctx.action({ kind: 'open', url: `#/sauna/run/${active.id}`, label: 'Open the sauna screen' });
      return wrote(`STOPPED. The round and the whole session are over; recorded: ${words.join(', ') || 'symptoms'}. Tell him exactly: ${GET_OUT} The next session goes back a step.`, `stopped: ${words.join(', ') || 'symptoms'}`);
    }
    if (openAfter) {
      put(s, 'sauna', openAfter.id, afterAnswerState(openAfter, { symptoms: true, what: words, now: s.now }));
      return wrote(`Recorded symptoms after the sauna of ${dayText(openAfter.date, s.today)}: ${words.join(', ') || 'symptoms'}. Tell him: ${GET_OUT} The next session goes back a step.`, `after: ${words.join(', ') || 'symptoms'}`);
    }
    const recent = sessions.filter((x) => x.endedAt && s.now - x.endedAt < 6 * 3600000).sort((p, q) => q.endedAt - p.endedAt)[0];
    if (recent) {
      put(s, 'sauna', recent.id, { ...recent, symptoms: [...(recent.symptoms || []), { at: s.now, when: 'later', what: words }] });
      return wrote(`Recorded symptoms after the sauna of ${dayText(recent.date, s.today)}: ${words.join(', ') || 'symptoms'}. Tell him: ${GET_OUT}`, 'symptoms later');
    }
    return { text: `No sauna session today to record it on. Still tell him: ${GET_OUT}`, summary: 'no session' };
  }
  if (a.action === 'start') {
    if (active) return refuse('A sauna session is already running on his phone.');
    const st = ladderState(sessions, s.today, s.one('sauna-plan', 'main') || {});
    ctx.action({ kind: 'open', url: '#/sauna/check', label: 'Open the sauna checklist' });
    return { text: `Today's step: ${stepText(st.step)}. He ticks the checklist on his phone (the sauna screen is open); the app decides whether today is a go. Never before lifting.`, summary: stepText(st.step) };
  }
  if (a.action === 'end') {
    if (!active) return refuse('No sauna session is running.');
    put(s, 'sauna', active.id, endHereState(active, s.now));
    ctx.action({ kind: 'open', url: `#/sauna/run/${active.id}`, label: 'Open the sauna screen' });
    return wrote(`Ended the sauna session with no symptoms. It doesn't count as a clean session for the ladder. The app asks once more in 15 minutes whether he has any symptoms.`, 'ended, no symptoms');
  }
  if (a.action === 'after_answer') {
    const target = openAfter;
    if (!target) return refuse('No question is open after a sauna session.');
    if (words.length || a.none === false) {
      put(s, 'sauna', target.id, afterAnswerState(target, { symptoms: true, what: words, now: s.now }));
      return wrote(`Recorded symptoms 15 minutes after: ${words.join(', ') || 'symptoms'}. Tell him: ${GET_OUT}`, 'after: symptoms');
    }
    put(s, 'sauna', target.id, afterAnswerState(target, { symptoms: false, now: s.now }));
    return wrote('Recorded: no symptoms 15 minutes after.', 'after: none');
  }
  return refuse('action is start, symptoms, end or after_answer.');
}

// ---- schedule -----------------------------------------------------------------------------------------------------

async function schedule(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const days = s.days();
  const rot = s.rotation();
  const pre = s.settings().notify.readinessMin;
  if (a.action === 'set_time' || a.action === 'clear_time') {
    let date = a.date || rot.next.date;
    if (date < s.today) return refuse('That day has passed.');
    // "4:30" said in the evening, with today's session not done: he means tomorrow (the rotation carries it over).
    let moved = false;
    if (!a.date && a.action === 'set_time' && date === s.today && zonedTime(date, a.time, s.tz) <= s.now) { date = addDays(s.today, 1); moved = true; }
    if (a.action === 'set_time' && !a.time) return refuse('What time?');
    put(s, 'days', date, withTime(days[date], date, a.action === 'set_time' ? a.time : null, s.now));
    const type = date === rot.next.date || moved ? rot.next.dayType : null;
    return wrote(a.action === 'set_time' ? `${type ? `${LABEL[type]} ` : ''}${dayText(date, s.today)} at ${formatHm(a.time)}; check-in ${formatHm(addMinutesHm(a.time, -pre))}.${moved ? ` (${formatHm(a.time)} today has passed, so this is for tomorrow.)` : ''}${type ? '' : ' (That day is not the next training day in the rotation.)'}` : `Session time cleared for ${dayText(date, s.today)}.`, a.action === 'set_time' ? `${dayText(date, s.today)} ${formatHm(a.time)}` : 'time cleared');
  }
  if (a.action === 'rest_today') {
    if (s.active()) return refuse('A session is in progress. Finish or discard it on the phone first.');
    if (rot.today.kind !== 'train') return refuse(rot.today.kind === 'done' ? 'He already trained today.' : 'Today is already a rest day.');
    const hm = days[s.today]?.sessionTime;
    const nextDays = { ...days, [s.today]: withRest(days[s.today], s.today, 'added', s.now) };
    put(s, 'days', s.today, nextDays[s.today]);
    const moved = rotationDay({ last: s.last(), today: s.today, days: nextDays }).next;
    if (hm && !days[moved.date]?.sessionTime) put(s, 'days', moved.date, withTime(days[moved.date], moved.date, hm, s.now));
    return wrote(`Today is a rest day now (his rule: skip it, carry on with the next day type; no make-up). Next: ${LABEL[moved.dayType]}, ${dayText(moved.date, s.today)}${hm ? ` at ${formatHm(hm)}` : ''}. Tendon holds as planned.`, 'rest today');
  }
  if (a.action === 'undo_rest') {
    const r = days[s.today]?.rest;
    if (!r || rot.today.reason === 'rotation') return refuse(rot.today.reason === 'rotation' ? "Today is the rotation's own rest day (the day after Legs); it can't be undone." : 'Today is not a rest day he added.');
    put(s, 'days', s.today, withRest(days[s.today], s.today, null, s.now));
    return wrote(`Rest day taken back: today is ${LABEL[rot.next.dayType]} again.`, 'rest undone');
  }
  return refuse('action is set_time, clear_time, rest_today or undo_rest.');
}

// ---- sauna days (A9) -----------------------------------------------------------------------------------------------

const checklistText = () => CHECKLIST.map((c) => c.text.replace(/\.$/, '') + (c.optional ? ' (if possible)' : '')).join('; ');

/** Propose sauna days from his schedule, plan the ones he agrees to, take one off, or set his usual sauna time. */
function saunaPlan(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const plan = s.one('sauna-plan', 'main') || {};
  const save = (next) => put(s, 'sauna-plan', 'main', { id: 'main', ...next });
  if (a.action === 'propose') {
    const p = saunaProposal(s);
    const st = ladderState(s.list('sauna'), s.today, plan);
    if (!p.items.length) return { text: `Nothing to propose: ${p.perWeek} a week and the coming week already has ${p.perWeek === 1 ? 'one' : 'them'} planned, or no day fits (never before lifting).`, summary: 'nothing to propose' };
    return { text: `Proposal (not planned yet; he decides): ${p.items.map((x) => `${dayText(x.date, s.today)} at ${formatHm(x.time)} (${proposalDayText(x, LABEL)}${x.kind === 'rest' ? '' : ', never before lifting'})`).join('; ')}.${p.items.some((x) => x.maybe) ? ' Today\'s session isn\'t done: "X, or Y" means X if it moves to tomorrow, Y if he does it today.' : ''} Step: ${stepText(st.step)}. ${p.perWeek === 1 ? 'Once a week at his level.' : 'While building up: about two a week on separate days (he decides).'} His checklist before each: ${checklistText()}. Say only this checklist about food and drink; never tell him to fast. Plan with action plan once he says yes.`, summary: `${p.items.length} day${p.items.length === 1 ? '' : 's'} proposed` };
  }
  if (a.action === 'set_time') {
    if (!a.time) return refuse('Give the time (HH:MM).');
    save({ ...plan, time: a.time });
    return wrote(`Usual sauna time: ${formatHm(a.time)}. Proposals use it from now on.`, `sauna time ${a.time}`);
  }
  if (a.action === 'remove') {
    if (!(plan.planned || []).some((p) => p.date === a.date)) return refuse(`No sauna planned on ${a.date ? dayText(a.date, s.today) : 'that day'}.`);
    save({ ...plan, planned: plan.planned.filter((p) => p.date !== a.date) });
    return wrote(`Sauna on ${dayText(a.date, s.today)} taken off the plan.`, 'sauna day removed');
  }
  if (a.action === 'plan') {
    const list = a.dates?.length ? a.dates : [];
    if (!list.length) return refuse('Which days? Give dates (and times) he agreed to.');
    let next = plan; const done = [];
    for (const d of list) {
      const exp = expectedEitherWay({ last: s.last(), days: s.days(), today: s.today, date: d.date });
      const r = planSaunaDay(next, d, { today: s.today, kind: exp?.kind, sessionTime: s.days()[d.date]?.sessionTime || null });
      if (r.error) return refuse(`${dayText(d.date, s.today)}: ${r.error} Nothing planned.`);
      next = r.plan; done.push(`${dayText(d.date, s.today)} ${formatHm(next.planned.find((p) => p.date === d.date).time)}`);
    }
    save(next);
    ctx.action({ kind: 'open', url: '#/sauna', label: 'Open the sauna screen' });
    return wrote(`Sauna planned: ${done.join('; ')}. A reminder comes at each time with the day's step and his checklist.`, `${done.length} sauna day${done.length === 1 ? '' : 's'} planned`);
  }
  return refuse('action is propose, plan, remove or set_time.');
}

// ---- Diet.html supplement lines (A6) ----------------------------------------------------------------------------------

/** His answer about a Diet.html line that differs from his list: use it (the supplement changes) or keep his list. */
function supplementReview(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const review = s.one('fuel', 'supp-review');
  const open = reviewOpen(review, s.list('supplements'));
  if (!open.length) return refuse('Nothing to confirm: every Diet.html line is answered.');
  const { item: supp } = findSupp(s, a.supplement || '');
  const item = supp && open.find((x) => x.suppId === supp.id);
  if (!item) return refuse(`Open lines: ${open.map((x) => s.list('supplements').find((y) => y.id === x.suppId)?.name).join(', ')}. Which one?`);
  if (a.answer === 'use') put(s, 'supplements', supp.id, applyReview(supp, item, s.today));
  put(s, 'fuel', 'supp-review', answerReview(review, supp.id, a.answer, s.today));
  return wrote(a.answer === 'use' ? `${supp.name} now reads as in his Diet.html: ${item.diet}.${item.countNote ? ` ${item.countNote}` : ''}` : `${supp.name} stays as on his list: ${item.brief}.`, `${supp.short || supp.name}: ${a.answer}`);
}

// ---- rest-day holds (A2) ----------------------------------------------------------------------------------------

/** His answer to the rest-day hold question: the gym for that hold, a hold he names, or skip today. */
function restDayHold(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const areas = restAskAreas(s.list('tendons').filter((x) => x.kind === 'area'));
  if (!areas.length) return refuse('No tendon area has a rest-day hold.');
  const area = a.area ? findByName(areas, a.area, (x) => x.label, (x) => [x.id]).item : areas[0];
  if (!area) return refuse(`Not an area with a rest-day hold: ${a.area}. Areas: ${areas.map((x) => x.label).join(', ')}.`);
  if (s.rotation().today.kind !== 'rest') return refuse('Today is not a rest day; the rest-day hold question is for rest days.');
  if (a.choice === 'other' && !String(a.hold || '').trim()) return refuse('"other" needs the hold he named, in his words. Ask him which hold; never suggest one.');
  const days = s.days();
  const doc = withRestChoice(days[s.today], s.today, area.id, { choice: a.choice, holdName: a.hold }, 'coach', s.now);
  put(s, 'days', s.today, doc);
  const c = doc.restHolds[area.id];
  ctx.action({ kind: 'open', url: '#/holds', label: 'Open tendon holds' });
  return wrote(`${area.label}, ${dayText(s.today, s.today)}: ${restChoiceText(c, area)}${c.choice === 'skip' ? ' today. Asked again next rest day.' : '. 3 × 30 s, his rule.'}`, `rest-day ${c.choice}`);
}

// ---- recovery (A13) -----------------------------------------------------------------------------------------------

/** His recovery check-in answers, a task he did, or the checkup date he booked. Only his words; no advice. */
function recoveryLog(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const plan = s.one('recovery', 'main');
  if (!plan) return refuse('No recovery record in the app.');
  const state = s.one('recovery', 'state');
  if (a.action === 'check_in') {
    const qs = plan.checkIn?.questions || [];
    const answers = {};
    for (const x of a.answers || []) {
      const q = findByName(qs, x.question, (y) => y.label, (y) => [y.key]).item;
      if (!q) return refuse(`Not a check-in question: ${x.question}. Questions: ${qs.map((y) => y.label).join(', ')}.`);
      if (q.choices) {
        const c = q.choices.find((y) => y.toLowerCase() === String(x.answer || '').trim().toLowerCase());
        if (!c) return refuse(`${q.label}: answer with one of ${q.choices.join(', ')} (his word for it).`);
        answers[q.key] = c;
      } else answers[q.key] = String(x.answer || '').trim();
    }
    const missing = missingAnswers(plan, answers);
    if (missing.length) return refuse(`Still to ask: ${missing.map((k2) => qs.find((q) => q.key === k2)?.ask || k2).join(' ')}`);
    const note = checkInNote(plan, answers, { date: s.today, at: s.now, by: 'coach' });
    put(s, 'coach-notes', noteId(s.today), note);
    return wrote(`Saved, ${dayText(s.today, s.today)}: ${note.text}`, 'check-in saved');
  }
  if (a.action === 'task_done' || a.action === 'task_undo') {
    const t = findByName(plan.tasks || [], a.task || '', (y) => y.text, (y) => [y.id]).item;
    if (!t) return refuse(`Which one? ${(plan.tasks || []).map((y) => y.text).join('; ')}.`);
    put(s, 'recovery', 'state', withTask(state, t.id, a.action === 'task_done', 'coach', s.now));
    return wrote(`${t.text}: ${a.action === 'task_done' ? 'done' : 'open again'}.${a.action === 'task_done' && t.setsCheckup && !a.date && !state?.checkup?.date ? ' Ask him for the date if he has one.' : ''}`, a.action === 'task_done' ? 'done' : 'reopened');
  }
  if (a.action === 'set_checkup') {
    if (a.date && a.date < s.today) return refuse('That date has passed.');
    let next = withCheckup(state, a.date || null, 'coach', s.now);
    const booking = (plan.tasks || []).find((t) => t.setsCheckup);
    if (a.date && booking) next = withTask(next, booking.id, true, 'coach', s.now);
    put(s, 'recovery', 'state', next);
    return wrote(a.date ? `Checkup: ${dayText(a.date, s.today)}. The check-ins run until then; a reminder comes the evening before.` : 'Checkup date cleared.', a.date ? 'checkup set' : 'checkup cleared');
  }
  return refuse('Unknown action.');
}

// ---- weigh-ins and sleep (Mon 10/19) ---------------------------------------------------------------------------------
// His rules: the Evolt at the gym every gym day, and the coach tells him; no watch, so the coach asks about his sleep.

/** His nudges, by talking: how often, his waking hours, a pause ("stop for 2 hours", "I'm going to bed"), resume. */
function nudgeSettings(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const cur = s.one('settings', 'main') || {};
  const n = { ...(cur.notify || {}) };
  const said = [];
  if (a.everyMin != null) { n.nudgeEveryMin = a.everyMin; said.push(a.everyMin ? `every ${a.everyMin} minutes` : 'off'); }
  if (a.wakeHm) { n.wakeHm = a.wakeHm; said.push(`from ${formatHm(a.wakeHm)}`); }
  if (a.bedHm) { n.bedHm = a.bedHm; said.push(`until ${formatHm(a.bedHm)}`); }
  if (a.pauseMin) { n.nudgePausedUntil = s.now + a.pauseMin * 60000; said.push(`paused until ${timeText(n.nudgePausedUntil, s.tz)}`); }
  if (a.resume) { n.nudgePausedUntil = 0; said.push('back on now'); }
  if (!said.length) {
    const st = s.settings().notify;
    return { text: `Nudges: ${st.nudgeEveryMin ? `every ${st.nudgeEveryMin} minutes` : 'off'}, ${formatHm(st.wakeHm)} to ${formatHm(st.bedHm)}${st.nudgePausedUntil > s.now ? `, paused until ${timeText(st.nudgePausedUntil, s.tz)}` : ''}.`, summary: 'nudge settings' };
  }
  s.store.writeLocal('settings', 'main', { ...cur, notify: n });
  return wrote(`Nudges ${said.join(', ')}.`, `nudges ${said.join(', ')}`);
}

const hoursText = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

/** A weigh-in (usually the Evolt before training): one entry per day in measurements, like Body > Measurements. */
function logWeight(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const kg = Number(a.kg);
  if (!(kg > 30 && kg < 300)) return refuse('Give his weight in kg exactly as the scanner showed it.');
  const date = a.date || s.today;
  if (date > s.today) return refuse('Not a future date.');
  const id = measureIdFor(date, s.list('measurements'));
  const cur = s.one('measurements', id);
  const next = { ...(cur || { id, date, source: 'evolt' }), weightKg: kg, updatedAt: s.now };
  if (!cur && date === s.today) next.at = s.now;
  if (a.bodyFatPct != null) next.fatPercent = Number(a.bodyFatPct);
  if (a.leanMassKg != null) next.leanMassKg = Number(a.leanMassKg);
  if (a.note) next.note = String(a.note).slice(0, 400);
  const before = dailyWeights(weightSeries(s.list('health'), s.list('measurements'))).filter((w) => w.date < date).at(-1);
  put(s, 'measurements', id, next);
  const diff = before ? Math.round((kg - before.kg) * 10) / 10 : null;
  const extra = [a.bodyFatPct != null ? `body fat ${a.bodyFatPct}%` : '', a.leanMassKg != null ? `lean mass ${a.leanMassKg} kg` : ''].filter(Boolean).join(', ');
  return wrote(`Saved for ${dayText(date, s.today)}: ${kg} kg${extra ? `, ${extra}` : ''}.${before ? ` ${diff >= 0 ? '+' : '−'}${Math.abs(diff)} kg since ${dayText(before.date, s.today)} (${before.kg} kg).` : ' His first weigh-in in the app.'} It shows on Body.`, `weight ${kg} kg`);
}

/** Last night's sleep as he tells it: bed and wake times; the night belongs to the morning he woke up. */
function logSleep(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const date = a.date || s.today;
  if (date > s.today) return refuse('Not a future date.');
  const wake = zonedTime(date, a.wake, s.tz);
  let bed = zonedTime(date, a.bed, s.tz);
  if (bed >= wake) bed = zonedTime(addDays(date, -1), a.bed, s.tz);
  const inBedMin = Math.round((wake - bed) / 60000);
  if (inBedMin < 60 || inBedMin > 16 * 60) return refuse(`That reads as ${hoursText(inBedMin)} in bed. Check the times with him.`);
  const awake = Math.max(0, Math.min(inBedMin, Number(a.awakeMin) || 0));
  put(s, 'sleep-log', date, { id: date, date, bed, wake, inBedMin, asleepMin: inBedMin - awake, quality: a.quality ?? null, note: a.note ? String(a.note).slice(0, 400) : '', source: 'coach', at: s.now });
  return wrote(`Sleep saved for the night to ${dayText(date, s.today)}: ${formatHm(a.bed)} to ${formatHm(a.wake)}, ${hoursText(inBedMin - awake)} asleep${awake ? ` (${awake} min awake)` : ''}. It shows on Body as last night.`, 'sleep logged');
}

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });

export const WRITE_TOOLS = [
  write('log_weight', 'Weight', "His weigh-in, usually the Evolt at the gym before training (his rule: an Evolt every gym day, and you remind him): kg exactly as shown, and body fat % or lean mass kg if he reads them out. One entry per day (another one that day replaces the numbers). Shows on Body's weight tile and chart.", obj({ kg: { type: 'number', minimum: 30, maximum: 300 }, bodyFatPct: { type: 'number', minimum: 2, maximum: 60 }, leanMassKg: { type: 'number', minimum: 20, maximum: 200 }, date: ISO, note: { type: 'string' } }, ['kg']), logWeight),
  write('log_sleep', 'Sleep', "Last night's sleep as he tells it (no watch, so you ask each morning): bed and wake times, 24-hour; date = the morning he woke up (default today); awakeMin when he says he lay awake; quality 1-5 only if he gives one. Shows on Body as last night.", obj({ bed: HM, wake: HM, date: ISO, awakeMin: { type: 'integer', minimum: 0, maximum: 600 }, quality: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: 'string' } }, ['bed', 'wake']), logSleep),
  write('nudges', 'Nudges', "The notifications you send him through the day: how often (everyMin 15, 20 or 30; 0 = off), his waking hours (wakeHm, bedHm; none outside them), a pause in minutes when he says stop for a while or he's going to bed early (pauseMin), or resume. With nothing set, says the current settings.", obj({ everyMin: { type: 'integer', enum: [0, 15, 20, 30] }, wakeHm: HM, bedHm: HM, pauseMin: { type: 'integer', minimum: 5, maximum: 1440 }, resume: { type: 'boolean' } }), nudgeSettings),
  write('start_session', 'Start a session', "Start a workout exactly like Train > Start: today's targets, the check-in's lighter targets, warm-ups. Default: the next session in the rotation; or a day type, a routine name, or empty. When he told you to start one ('start Push', 'go start a new workout', 'Jarvis, start legs'), it starts at once and opens on his phone. Otherwise it asks first (his rule): that call doesn't start it and gives you the question to ask him; call again with the same choice only after his yes in his next message. Refuses while another session is in progress. Opens it on his phone.", obj({ dayType: { type: 'string', enum: ['pull', 'push', 'legs', 'neck'] }, routine: { type: 'string' }, empty: { type: 'boolean' } }), startSession),
  write('log_set', 'Log a set', 'Tick the next set of the session in progress with what he did ("80 for 8" = kg 80, reps 8). kg is the TOTAL including the bar as he says it; for weighted pull-ups the added kg (0 = bodyweight). Missing values come from the target or last time. Default exercise: the one he is on. Returns the 30% cap warning and records if any, starts his rest timer, and names the next set.', obj({ exercise: { type: 'string' }, kg: { type: 'number', minimum: 0 }, reps: { type: 'integer', minimum: 0, maximum: 200 }, seconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'for holds and timed sets' }, type: SET_TYPE, set: { type: 'integer', minimum: 1, description: 'set number, if he names one' }, rpe: { type: 'number', minimum: 1, maximum: 10 }, note: { type: 'string' } }), logSet),
  write('correct_set', 'Correct a set', 'Change or remove a set of the session in progress, or of the session he finished in the last 24 hours. Default set: the last one he ticked of that exercise.', obj({ exercise: { type: 'string' }, set: { type: 'integer', minimum: 1 }, kg: { type: 'number', minimum: 0 }, reps: { type: 'integer', minimum: 0, maximum: 200 }, seconds: { type: 'integer', minimum: 1, maximum: 3600 }, type: SET_TYPE, rpe: { type: 'number', minimum: 1, maximum: 10 }, note: { type: 'string' }, done: { type: 'boolean' }, remove: { type: 'boolean' } }, ['exercise']), correctSet),
  write('next_exercise', 'Next exercise', 'Move his phone to the next exercise with sets left and say its next set.', obj(), nextExercise),
  write('rest_timer', 'Rest timer', "His phone's rest timer: start (default: the rest time of the exercise he just did), add seconds (+15 or -15), or skip.", obj({ action: { type: 'string', enum: ['start', 'add', 'skip'] }, seconds: { type: 'integer', minimum: -600, maximum: 3600 } }), restTimer),
  write('log_meal', 'Log a meal', 'Log a meal he describes (no photo), one item per food with grams, or packs/count for his own foods ("half a pack of almonds": packs 0.5; "3 eggs": count 3), (and usda: the USDA FoodData Central description when you know it). kcal and protein are computed by the app from USDA values; pass kcal/protein only when HE gave them. A food with no USDA match is refused: ask him for its numbers. Time defaults to now.', obj({ items: ITEMS, name: { type: 'string', description: 'Breakfast, Lunch, Dinner or Snack; default from the time' }, time: HM, date: ISO, note: { type: 'string' } }, ['items']), logMeal),
  write('correct_meal', 'Correct a meal', 'Replace the items of a meal (by its id from the meals tool), rename it, change its time or note, or delete it.', obj({ meal: { type: 'string' }, items: ITEMS, name: { type: 'string' }, time: HM, note: { type: 'string' }, remove: { type: 'boolean' } }, ['meal']), correctMeal),
  write('supplement', 'Supplements', 'Mark supplements taken or skipped (with his reason) for today or an earlier day, or undo an answer. Names as he says them ("creatine", "mag", "the morning stack" means list them). Only what he says; never assume.', obj({ names: { type: 'array', items: { type: 'string' }, minItems: 1 }, status: { type: 'string', enum: ['taken', 'skipped', 'undo'] }, reason: { type: 'string' }, date: ISO }, ['names', 'status']), supplement),
  write('supplement_plan', 'Restock and plans', "Record his answer about a supplement running low (restock, not-now, stop), the weekly 'planning to get anything?' answer (nothing, restock-some, add), or the considering list (add or drop). Never changes his supplement list.", obj({ kind: { type: 'string', enum: ['restock', 'weekly', 'considering', 'drop_considering'] }, supplement: { type: 'string' }, answer: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, text: { type: 'string' } }, ['kind']), supplementPlan),
  write('body_scan', 'Body scan', "How often he scans (every: 'training' = every training day, 'monthly' = every 4 weeks on a confirmed date); confirm the next scan date (monthly only; default: the app's proposal) or cancel it; change one preparation checklist line in his words (line: its id from body_scans, or none to add one; text; when: 'before' or 'day'); record that he read the scanner's safety notice, or what his gym's staff said; save results he reads out (every number exactly as shown: label, value, unit) with the conditions.", obj({ action: { type: 'string', enum: ['every', 'checklist_line', 'confirm_date', 'cancel_date', 'safety_read', 'staff_said', 'record_results'] }, every: { type: 'string', enum: ['training', 'monthly'] }, line: { type: 'string' }, when: { type: 'string', enum: ['before', 'day'] }, date: ISO, time: HM, text: { type: 'string' }, metrics: { type: 'array', items: obj({ label: { type: 'string' }, value: { type: 'number' }, text: { type: 'string' }, unit: { type: 'string' } }, ['label']) }, fasted: { type: 'boolean' }, trainedBefore: { type: 'boolean' }, unusual: { type: 'string' } }, ['action']), bodyScan),
  write('set_reminder', 'Set a reminder', 'A notification to his phone at a time (today, or tomorrow if the time has passed, or a date), or cancel one by id.', obj({ time: HM, date: ISO, text: { type: 'string' }, cancel: { type: 'string' } }), setReminder),
  write('write_note', 'Write a note', 'Keep a note for him (something he wants remembered, an answer to an open question), or delete one by id.', obj({ text: { type: 'string' }, topic: { type: 'string' }, remove: { type: 'string' } }), writeNote),
  write('sauna_session', 'Sauna session', "Sauna sessions. start: opens the checklist on his phone (he ticks it; the app decides). symptoms: ANY symptom he reports during or after a session: ends it at once and records what he felt. end: ends the running session here with no symptoms. after_answer: the question 15 minutes after (none: true for no symptoms). Can't add rounds or time.", obj({ action: { type: 'string', enum: ['start', 'symptoms', 'end', 'after_answer'] }, symptoms: { type: 'array', items: { type: 'string' } }, none: { type: 'boolean' } }, ['action']), sauna),
  write('check_in', 'Readiness check-in', "His readiness check-in by talking ('Sore, or good to go?'), decided by HIS table exactly as the check-in screen does. Give every rating he said: per tendon area soreness 0-3 and worse-than-yesterday yes/no; legs and back 0-3 when today's day type asks them; energy 0-3. Missing ratings come back as a list to ask for. move / rest-holds results are applied only with apply: true once he agrees.", obj({ areas: { type: 'array', items: obj({ area: { type: 'string' }, sore: { type: 'integer', minimum: 0, maximum: 3 }, worse: { type: 'boolean' } }, ['area']) }, legs: { type: 'integer', minimum: 0, maximum: 3 }, back: { type: 'integer', minimum: 0, maximum: 3 }, energy: { type: 'integer', minimum: 0, maximum: 3 }, again: { type: 'boolean' }, apply: { type: 'boolean' } }), checkIn),
  write('sauna_plan', 'Sauna days', "Plan sauna days WITH him: propose (from his rotation: rest days first, never before lifting, about two a week on separate days while building up, once a week at his level; at his usual sauna time), then plan the dates he agrees to, remove one, or set his usual sauna time. The ladder decides each session's step. About food and drink say only his checklist line (eaten and drunk in the last few hours); never tell him to fast.", obj({ action: { type: 'string', enum: ['propose', 'plan', 'remove', 'set_time'] }, dates: { type: 'array', items: obj({ date: ISO, time: HM }, ['date']) }, date: ISO, time: HM }, ['action']), saunaPlan),
  write('supplement_review', 'Diet.html line', "His answer about a line of his Diet.html that differs from his supplement list (the supplements tool lists the open ones): use = change the supplement to the Diet.html line, keep = leave his list. Only his answer; never decide for him.", obj({ supplement: { type: 'string' }, answer: { type: 'string', enum: ['use', 'keep'] } }, ['supplement', 'answer']), supplementReview),
  write('rest_day_hold', 'Rest-day hold', "His answer to the rest-day hold question (rest days only): gym = he goes to the gym just for the rest-day hold (the cable lateral raise hold for the shoulder); other = a hold HE names (pass his words in hold); skip = no hold today. Never suggest a hold or a replacement. Default area: the shoulder.", obj({ choice: { type: 'string', enum: ['gym', 'other', 'skip'] }, hold: { type: 'string' }, area: { type: 'string' } }, ['choice']), restDayHold),
  write('recovery_log', 'Recovery', "His recovery record (A13): save his weekly check-in answers in his words (check_in: one answer per question; for choice questions one of the choices the recovery tool lists; 'anything new' in his words, empty if nothing), tick or untick a thing he had to do (task_done / task_undo), or set the checkup date he booked (set_checkup). Only what he says: no advice.", obj({ action: { type: 'string', enum: ['check_in', 'task_done', 'task_undo', 'set_checkup'] }, answers: { type: 'array', items: obj({ question: { type: 'string' }, answer: { type: 'string' } }, ['question', 'answer']) }, task: { type: 'string' }, date: ISO }, ['action']), recoveryLog),
  write('schedule', 'Schedule', "Set or clear the session time for a day (default: the next session's day), make today a rest day (his rule: skip, carry on with the next day type), or undo a rest day he added.", obj({ action: { type: 'string', enum: ['set_time', 'clear_time', 'rest_today', 'undo_rest'] }, date: ISO, time: HM }, ['action']), schedule),
];
