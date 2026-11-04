// The coach's workout tools (Thu 11/5): what his screens can do that the coach had no tool for. Each only on his words.
// workout_edit: the workout in progress (as the session screen edits it). past_workout: finished workouts of any age
// (the Edit session and Delete session screens) and a workout he did without the app. timer: pause or resume his rest,
// pause, resume or restart a hold counting down. Same record shapes as the phone; the 30% cap still warns.
import { snapshot, dayText, timeText, loadText, repsText, plural, findByName, wrote, refuse, k } from './shared.mjs';
import { offered, saidNow, confirmedNow } from './tools-app.mjs';
import { put, del, num, guardFor, addNote } from './tools-write.mjs';
import { currentExercise } from './tools-read.mjs';
import { LABEL, inRotation } from '../../app/js/lib/rotation.js';
import { newSetId, elapsedMs, summarize, BODYWEIGHT_TYPES, addedTarget, swapEntry } from '../../app/js/lib/session.js';
import { comebackStartOf } from '../../app/js/lib/finish.js';
import { restDefault, restText } from '../../app/js/lib/settings.js';
import { warmupSets } from '../../app/js/lib/plates.js';
import { newId, newKey } from '../../app/js/lib/routines.js';
import { weekColumn } from '../../app/js/lib/programme.js';
import { modeOf } from '../../app/js/lib/progression.js';
import { currentBodyweight } from '../../app/js/lib/health.js';
import { zonedTime, hmOf } from '../../app/js/lib/time.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HM = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: '24-hour "HH:MM" in his time zone' };
const SET_TYPE = { type: 'string', enum: ['warmup', 'normal', 'dropset', 'failure', 'hold'] };
const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });

// ---- shared helpers ------------------------------------------------------------------------------------------------

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const words = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// Every word he said is in the name, one of them outside the brackets (as workout_exercise finds a library exercise).
const fullMatch = (q, name) => {
  const has = (hay) => (w) => hay.some((h) => h.startsWith(w));
  return words(q).length > 0 && words(q).every(has(words(name))) && words(q).some(has(words(String(name).replace(/\([^)]*\)/g, ' '))));
};
const timedType = (type) => type === 'duration' || type === 'weight_duration';
const isWork = (x) => x.type !== 'warmup' && x.type !== 'hold';
const NO = /^\s*(no|nope|nah|don'?t|do not|stop|cancel|wait|keep it|not now|never mind)\b/i;
const REMOVE = /\b(remove|delete|take (?:it |that |them )?off|drop|get rid of|scrap|bin|cut|erase)\b/i;
const DELETE = /\b(delete|remove|scrap|bin|trash|get rid of|erase|wipe)\b[^.?!]{0,40}?\b(workout|session|training|it|this|that|one|legs|push|pull|neck)\b/i;

/** Asked first and not yet confirmed: the coach's last reply asked (the tool's "asked first"), or he said yes to it. */
const askFirstDone = (s, ctx, tool, key, told, question) => (offered(s, ctx, tool, key) && !NO.test(saidNow(s, ctx))) || confirmedNow(s, ctx, told, question ? { question } : {});

/** An exercise on a workout's card by what he called it; `occurrence` when it is on it more than once. */
function onCard(session, name, occurrence) {
  const list = session.exercises || [];
  const names = list.map((e) => e.name).join('; ') || 'none';
  if (!name) return { error: `Which exercise? In ${session.title}: ${names}.` };
  const { item, ambiguous } = findByName(list, name);
  if (!item) return { error: ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : `"${name}" isn't in ${session.title}. Its exercises: ${names}.` };
  const twins = list.filter((e) => sameName(e.name, item.name));
  if (twins.length < 2) return { ex: item };
  if (occurrence && twins[occurrence - 1]) return { ex: twins[occurrence - 1] };
  return { error: `${item.name} is on it ${twins.length} times: say which with occurrence (1 = first on the card).` };
}

/** An exercise from his library (his logged one wins when the words name more than one). */
function fromLibrary(s, name) {
  if (!String(name || '').trim()) return { error: 'Which exercise from his library? Give its name.' };
  const lib = [...s.lib().values()];
  const r = findByName(lib, name || '');
  let item = r.item && fullMatch(name, r.item.name) ? r.item : null;
  const ambiguous = r.item ? [] : r.ambiguous;
  if (!item && ambiguous.length) { const mine = ambiguous.filter((n) => s.history().lastLifted(n)); if (mine.length === 1) item = lib.find((e) => e.name === mine[0]); }
  if (!item) return { error: ambiguous.length ? `Which one: ${ambiguous.join('; ')}? Ask him if his words don't say.` : `No exercise called "${name}" in his library.` };
  return { def: item };
}

const entryFor = (def, notes = '') => ({ key: newKey(), exerciseId: def.id, name: def.name, type: def.type || 'weight_reps', capClass: def.capClass ?? null, barKg: def.barKg ?? null, restSeconds: def.restSeconds ?? null, notes, role: null, supersetId: null, target: null });

/** His last load on it since the comeback (none from before it), as workout_exercise add uses. */
function lastNowOf(s, name, sessionId) {
  const last = s.history(sessionId).lastLifted(name);
  const start = comebackStartOf(s.meta());
  return { last, now: last && !(start && last.date < start) ? last : null };
}

const valuesText = (ex, x) => (x.type === 'hold' ? `hold ${x.durationS ?? '?'} s${x.kg != null ? ` at ${loadText(x.kg, ex.barKg)}` : ''}`
  : BODYWEIGHT_TYPES.includes(ex.type) ? `${x.kg ? `${ex.type === 'assisted_bodyweight' ? '-' : '+'}${k(x.kg)} kg` : 'bodyweight'} × ${x.reps ?? '?'}`
    : timedType(ex.type) ? `${x.kg != null ? `${loadText(x.kg, ex.barKg)} ` : ''}${x.durationS ?? '?'} s`
      : `${loadText(x.kg, ex.barKg)} × ${x.reps ?? '?'}`);
/** An unticked set as planned: its load and target reps. */
const plannedText = (ex, x) => {
  const kgv = x.kg ?? x.target?.kg ?? null;
  if (x.type === 'hold' || timedType(ex.type)) return `${kgv != null ? `${loadText(kgv, ex.barKg)} ` : ''}${x.durationS ?? 30} s`;
  return `${kgv != null ? loadText(kgv, ex.barKg) : 'no load'}${x.target?.reps ? ` × ${repsText(x.target.reps)}` : ''}`;
};
const kindWord = (x) => (x.type === 'normal' ? '' : x.type === 'warmup' ? 'warm-up ' : `${x.type} `);
/** "#1 warm-up 60 kg × 5, #2 100 kg × 5 (not ticked: 100 kg × 5-8)": numbered as `set` counts them (warm-ups too). */
const setsLine = (ex, mine) => mine.map((x, i) => `#${i + 1} ${kindWord(x)}${x.done ? valuesText(ex, x) : `not ticked: ${plannedText(ex, x)}`}${x.note ? ` ("${x.note}")` : ''}`).join(', ') || 'no sets';
const sortedSets = (sets, key) => sets.filter((x) => x.exKey === key).sort((p, q) => p.order - q.order);
const zoneOf = (s, session) => session?.tz || s.tz;
const durText = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** Superset ids used by one exercise only are cleared (a group of one is no superset). */
function tidySupersets(list) {
  const count = new Map();
  for (const e of list) if (e.supersetId) count.set(e.supersetId, (count.get(e.supersetId) || 0) + 1);
  return list.map((e) => (e.supersetId && count.get(e.supersetId) < 2 ? { ...e, supersetId: null } : e));
}

/** The 30% cap on a load, as on the day of the workout (`date`). */
const guardOn = (s, session, ex, kgVal, date = s.today) => (kgVal == null ? null : guardFor({ ...s, today: date }, session, ex, kgVal));

/** A card: every exercise with its numbered sets, rest, note and superset. */
function cardText(s, session, sets) {
  const st = s.settings();
  const groups = new Map();
  for (const e of session.exercises || []) if (e.supersetId) groups.set(e.supersetId, [...(groups.get(e.supersetId) || []), e.name]);
  return (session.exercises || []).map((e, i) => {
    const bits = [`${i + 1}. ${e.name}${e.skipped ? ' (skipped today)' : ''}: ${setsLine(e, sortedSets(sets, e.key))}`];
    if (session.status === 'active') bits.push(`rest ${e.restSeconds == null ? `default ${restText(restDefault(e, st))}` : restText(e.restSeconds)}`);
    if (e.supersetId) bits.push(`superset with ${groups.get(e.supersetId).filter((n) => n !== e.name).join(' + ')}`);
    if (e.notes) bits.push(`note: "${e.notes}"`);
    return bits.join('; ');
  }).join('\n');
}

// ---- the workout in progress -----------------------------------------------------------------------------------

async function workoutEdit(a, ctx) {
  const s = snap(ctx);
  const session = s.active();
  if (!session) return refuse('No workout in progress. A finished one: past_workout.');
  const sets = s.setsOf(session.id);
  const list = session.exercises || [];
  const save = (patch, extra = []) => s.store.writeLocalMany([...extra, { col: 'sessions', id: session.id, data: { ...session, ...patch } }]);
  const setEx = (key, patch) => list.map((e) => (e.key === key ? { ...e, ...patch } : e));
  const focus = (exercises, all = sets) => { const cur = currentExercise({ ...session, exercises }, all); if (cur) ctx.action({ kind: 'focus', sessionId: session.id, exKey: cur.key }); };
  const act = a.action;

  if (act === 'show') return { text: `${session.title}, started ${timeText(session.startedAt, zoneOf(s, session))}. Set numbers as \`set\` counts them (warm-ups too):\n${cardText(s, session, sets)}`, summary: 'card' };

  if (act === 'rename') {
    const title = String(a.title || '').trim().slice(0, 60);
    if (!title) return refuse('What should it be called? Give title.');
    save({ title });
    return wrote(`Renamed the workout in progress: ${session.title} is now ${title}.`, `renamed ${title}`);
  }

  if (act === 'times') {
    const tz = zoneOf(s, session);
    const pausedNow = (session.pausedMs || 0) + (session.pausedAt ? s.now - session.pausedAt : 0);
    let startedAt = session.startedAt;
    if (a.start) {
      startedAt = zonedTime(a.date || s.date(s.now), a.start, tz);
      if (!a.date && startedAt > s.now) startedAt -= 86400000;
    } else if (num(a.shift_minutes) !== undefined) startedAt += Math.round(num(a.shift_minutes)) * 60000;
    else if (num(a.minutes) !== undefined) startedAt = s.now - Math.round(num(a.minutes)) * 60000 - pausedNow;
    else return refuse('What changes: start (HH:MM he started), shift_minutes (-10 = started 10 minutes earlier) or minutes (how long he has been training).');
    if (startedAt > s.now) return refuse(`That start (${timeText(startedAt, tz)}) is after now.`);
    if (s.now - startedAt > 12 * 3600000) return refuse(`That start (${dayText(s.date(startedAt), s.today)}, ${timeText(startedAt, tz)}) is over 12 hours ago. Check it with him.`);
    save({ startedAt });
    const min = Math.round(elapsedMs({ ...session, startedAt }, s.now) / 60000);
    return wrote(`${session.title}: started ${timeText(startedAt, tz)} (was ${timeText(session.startedAt, tz)}); ${durText(min)} on the clock now.`, `start ${timeText(startedAt, tz)}`);
  }

  if (act === 'note' && !a.exercise) {
    if (a.note === undefined) return refuse('Which note? Give note.');
    const note = a.replace_note ? String(a.note).trim().slice(0, 1000) : addNote(session.note, a.note);
    save({ note });
    return wrote(`Workout note on ${session.title}: "${note}" (it shows on the Finish screen).`, 'workout note');
  }

  const { ex, error } = onCard(session, a.exercise, a.occurrence);
  if (error) return refuse(error);
  const mine = sortedSets(sets, ex.key);

  if (act === 'remove') {
    const ticked = mine.filter((x) => x.done);
    const key = `remove:${ex.key}`;
    if (ticked.length && !askFirstDone(s, ctx, 'workout_edit', key, (t) => REMOVE.test(t))) {
      return { text: `Not removed. ${ex.name} has ${plural(ticked.length, 'logged set')}. Ask him first: "Remove ${ex.name} and its ${plural(ticked.length, 'logged set')}?" Only a yes in his next message removes it: then call workout_edit remove again. Not doing it today but keeping it for next time: workout skip.`, summary: `asked first: ${key}` };
    }
    const exercises = tidySupersets(list.filter((e) => e.key !== ex.key));
    save({ exercises }, mine.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })));
    ctx.action({ kind: 'sync' });
    focus(exercises, sets.filter((x) => x.exKey !== ex.key));
    return wrote(`Removed ${ex.name} from ${session.title}${mine.length ? ` with its ${plural(mine.length, 'set')}${ticked.length ? ` (${ticked.length} logged)` : ''}` : ''}. Order now: ${exercises.map((e) => e.name).join(', ') || 'no exercises'}.`, `removed ${ex.name}`);
  }

  if (act === 'replace') {
    const { def, error: e2 } = fromLibrary(s, a.with);
    if (e2) return refuse(e2);
    if (sameName(def.name, ex.name)) return refuse(`${ex.name} is already that exercise.`);
    const ticked = mine.filter((x) => x.done);
    const open = mine.filter((x) => !x.done);
    const type = def.type || 'weight_reps';
    const timed = timedType(type);
    const { last, now: lastNow } = lastNowOf(s, def.name, session.id);
    const work = open.filter((x) => x.type !== 'warmup');
    const oldReps = ex.target?.reps ?? work[0]?.target?.reps ?? null;
    const reps = timed ? null : (a.reps_min || a.reps_max) ? [a.reps_min ?? a.reps_max, a.reps_max ?? a.reps_min] : Array.isArray(oldReps) ? oldReps : [8, 12];
    // Thu 11/5: no kg from him or the coach: the app's target from its own history (a gap = no step; before the
    // layoff only = an estimate), the same one the phone builds.
    const ft = timed ? null : addedTarget({ name: def.name, history: s.history(session.id), meta: s.meta(), today: s.today, dayType: session.dayType ?? null, reps, barKg: def.barKg ?? null, equipment: def.equipment ?? null, smallestPlate: s.minPlate() });
    const kgVal = num(a.kg) ?? ft?.kg ?? null;
    const n = a.sets ?? (work.length || 2);
    const why = String(a.why || '').trim().slice(0, 160) || (a.kg != null ? (lastNow ? '' : 'coach\'s estimate') : ft?.why || '');
    const target = { kg: kgVal, reps, sets: n, ...((a.kg != null && !lastNow) || (a.kg == null && ft?.approx) ? { approx: true } : {}), ...(why ? { why } : {}) };
    // No set logged yet: the new exercise takes its place (same card). Sets logged: those stay as they were, and the
    // new exercise comes right after it with the sets left.
    const keep = !ticked.length;
    const fresh = entryFor(def);
    // Thu 11/5: a swap for today: the card says what it replaces and the next workout brings the original back.
    const entry = keep ? { ...swapEntry(ex, def, target), addedBy: 'coach' }
      : { ...fresh, supersetId: ex.supersetId ?? null, target, addedBy: 'coach', swappedFrom: { exerciseId: ex.exerciseId ?? null, name: ex.name } };
    const exercises = keep ? setEx(ex.key, entry) : list.flatMap((e) => (e.key === ex.key ? [e, entry] : [e]));
    let order = open.length ? Math.min(...open.map((x) => x.order)) : (mine.length ? Math.max(...mine.map((x) => x.order)) : Math.max(-1, ...sets.map((x) => x.order))) + 0.01;
    const row = (t, kg, r, durationS = null) => ({ id: newSetId(), sessionId: session.id, exKey: entry.key, order: (order += 0.001), done: false, doneAt: null, rpe: null, note: '', type: t, kg, reps: null, durationS, target: { kg, reps: r } });
    const rows = [...(a.warmups || []).map((w) => row('warmup', num(w.kg) ?? null, w.reps ? [w.reps, w.reps] : null)),
      ...Array.from({ length: n }, () => row('normal', kgVal, reps, timed ? a.seconds ?? 30 : null))];
    s.store.writeLocalMany([...open.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })), ...rows.map((x) => ({ col: 'sets', id: x.id, data: x })), { col: 'sessions', id: session.id, data: { ...session, exercises } }]);
    ctx.action({ kind: 'sync' });
    focus(exercises, [...sets.filter((x) => x.done || x.exKey !== ex.key), ...rows]);
    const warn = guardOn(s, session, entry, kgVal);
    const what = `${plural(n, 'set')}${reps ? ` × ${repsText(reps)}` : ` × ${a.seconds ?? 30} s`}${kgVal != null ? ` at ${loadText(kgVal, entry.barKg)}` : ''}`;
    return wrote(`Replaced ${ex.name} with ${def.name} in ${session.title}${keep ? ', same place' : `: the ${plural(ticked.length, 'set')} he logged stay as ${ex.name}, ${def.name} comes right after it`}: ${what}${rows.some((x) => x.type === 'warmup') ? ', warm-ups first' : ''}. On his phone now, marked as a swap for today (the next workout brings ${ex.name} back).${a.kg == null && ft?.why && kgVal != null ? ` Its target (say it, with the number): ${ft.why}.` : ''}${kgVal == null ? ` No load on it: ${last ? `his last (${k(last.heaviest?.kg)} kg, ${dayText(last.date, s.today)}) is from before the comeback` : 'he has never logged it'}. Give him a number and label it your estimate, or ask; then workout_edit target sets it.` : ''}${warn ? `\n${warn}` : ''}`, `${ex.name} -> ${def.name}`);
  }

  if (act === 'target') {
    let targets;
    if (a.set) {
      const x = mine[a.set - 1];
      if (!x) return refuse(`${ex.name} has ${plural(mine.length, 'set')}: ${setsLine(ex, mine)}.`);
      if (x.done) return refuse(`${ex.name} #${a.set} is ticked (${valuesText(ex, x)}). To change what he did: correct_set.`);
      targets = [x];
    } else targets = mine.filter((x) => !x.done && (a.type ? x.type === a.type : x.type !== 'warmup'));
    if (!targets.length) return refuse(`${ex.name} has no unticked ${a.type ? `${a.type} ` : ''}sets left: ${setsLine(ex, mine)}. More sets: add_sets.`);
    const kgVal = num(a.kg);
    const reps = (a.reps_min || a.reps_max) ? [a.reps_min ?? a.reps_max, a.reps_max ?? a.reps_min] : null;
    const secs = num(a.seconds);
    if (kgVal === undefined && !reps && secs === undefined) return refuse('What changes: kg (TOTAL), reps_min / reps_max or seconds.');
    const next = targets.map((x) => ({ ...x, ...(kgVal !== undefined ? { kg: kgVal } : {}), ...(reps ? { reps: null } : {}), ...(secs !== undefined ? { durationS: Math.round(secs) } : {}),
      target: { ...(x.target || {}), ...(kgVal !== undefined ? { kg: kgVal } : {}), ...(reps ? { reps } : {}) } }));
    const why = String(a.why || '').trim().slice(0, 160);
    const exPatch = !a.set ? { target: { ...(ex.target || {}), ...(kgVal !== undefined ? { kg: kgVal } : {}), ...(reps ? { reps } : {}), ...(why ? { why } : {}) } } : null;
    s.store.writeLocalMany([...next.map((x) => ({ col: 'sets', id: x.id, data: x })), ...(exPatch ? [{ col: 'sessions', id: session.id, data: { ...session, exercises: setEx(ex.key, exPatch) } }] : [])]);
    const warn = next.some(isWork) && kgVal !== undefined ? guardOn(s, session, ex, kgVal) : null;
    const nos = next.map((x) => `#${mine.findIndex((y) => y.id === x.id) + 1}`).join(', ');
    return wrote(`${ex.name} ${nos} now ${plannedText(ex, next[0])} on his phone (not ticked yet).${warn ? `\n${warn}` : ''}`, `${ex.name} target ${plannedText(ex, next[0])}`);
  }

  if (act === 'add_sets') {
    const type = a.type || 'normal';
    const count = Math.max(1, Math.min(10, a.count ?? 1));
    const st = s.settings();
    let rows = [];
    if (type === 'warmup') {
      const firstOrder = mine.length ? Math.min(...mine.map((x) => x.order)) : Math.max(-1, ...sets.map((x) => x.order)) + 1;
      let ws;
      if (num(a.kg) !== undefined) ws = Array.from({ length: count }, () => ({ kg: num(a.kg), reps: a.reps_min ?? a.reps_max ?? null }));
      else {
        // As the session screen's "Add warm-up sets": from the first working weight, his warm-up steps (Settings).
        const work = mine.find((x) => isWork(x) && (x.kg ?? x.target?.kg) != null);
        ws = warmupSets(work ? work.kg ?? work.target.kg : ex.target?.kg, { barKg: ex.barKg, steps: st.warmup.steps, smallestPlate: s.minPlate() });
        if (!ws.length) return refuse(`No working weight on ${ex.name} to build warm-ups from. Give the warm-up kg (and reps).`);
      }
      rows = ws.map((w, i) => ({ id: newSetId(), sessionId: session.id, exKey: ex.key, order: firstOrder - (ws.length - i) * 0.01, done: false, doneAt: null, rpe: null, note: '', type: 'warmup', kg: w.kg ?? null, reps: null, durationS: null, target: { kg: w.kg ?? null, reps: w.reps ? [w.reps, w.reps] : null } }));
    } else {
      const last = mine.filter((x) => x.type !== 'warmup').at(-1) || mine.at(-1);
      const base = mine.length ? Math.max(...mine.map((x) => x.order)) : Math.max(-1, ...sets.map((x) => x.order)) + 1;
      const kgVal = num(a.kg) ?? last?.kg ?? last?.target?.kg ?? ex.target?.kg ?? null;
      const reps = (a.reps_min || a.reps_max) ? [a.reps_min ?? a.reps_max, a.reps_max ?? a.reps_min] : last?.target?.reps ?? ex.target?.reps ?? null;
      const durationS = num(a.seconds) ?? last?.durationS ?? (type === 'hold' || timedType(ex.type) ? 30 : null);
      rows = Array.from({ length: count }, (_, i) => ({ id: newSetId(), sessionId: session.id, exKey: ex.key, order: base + (i + 1) * 0.01, done: false, doneAt: null, rpe: null, note: '', type, kg: kgVal, reps: null, durationS, target: { kg: kgVal, reps } }));
    }
    s.store.writeLocalMany(rows.map((x) => ({ col: 'sets', id: x.id, data: x })));
    ctx.action({ kind: 'sync' });
    const after = [...mine, ...rows].sort((p, q) => p.order - q.order);
    const warn = type !== 'warmup' && type !== 'hold' ? guardOn(s, session, ex, rows[0].kg) : null;
    return wrote(`Added ${plural(rows.length, type === 'warmup' ? 'warm-up set' : `${type === 'normal' ? '' : `${type} `}set`)} to ${ex.name}: ${rows.map((x) => plannedText(ex, x)).join(', ')}. ${ex.name} now: ${setsLine(ex, after)}.${warn ? `\n${warn}` : ''}`, `${ex.name} +${rows.length} ${type}`);
  }

  if (act === 'remove_sets') {
    let gone;
    if (a.set) {
      const x = mine[a.set - 1];
      if (!x) return refuse(`${ex.name} has ${plural(mine.length, 'set')}: ${setsLine(ex, mine)}.`);
      if (x.done) return refuse(`${ex.name} #${a.set} is ticked (${valuesText(ex, x)}). A logged set: correct_set remove, only when he says it was never done.`);
      gone = [x];
    } else {
      const pool = mine.filter((x) => !x.done && (a.type ? x.type === a.type : x.type !== 'warmup'));
      gone = a.type === 'warmup' && !a.count ? pool : pool.slice(-Math.max(1, a.count ?? 1));
    }
    if (!gone.length) return refuse(`${ex.name} has no unticked ${a.type ? `${a.type} ` : ''}sets to remove: ${setsLine(ex, mine)}.`);
    s.store.writeLocalMany(gone.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })));
    const after = mine.filter((x) => !gone.includes(x));
    return wrote(`Removed ${plural(gone.length, 'unticked set')} from ${ex.name}. ${ex.name} now: ${setsLine(ex, after)}.`, `${ex.name} -${gone.length} sets`);
  }

  if (act === 'rest') {
    const secs = num(a.seconds) === undefined ? null : Math.round(num(a.seconds));
    if (secs != null && (secs < 0 || secs > 600)) return refuse('Rest from 0 (off) to 600 seconds.');
    const st = s.settings();
    const said = (v) => (v == null ? `the default (${restText(restDefault(ex, st))})` : restText(v));
    save({ exercises: setEx(ex.key, { restSeconds: secs }) });
    return wrote(`${ex.name} rest in this workout: ${said(secs)} (was ${said(ex.restSeconds ?? null)}). Warm-ups and holds keep their own rest from Settings.${ex.supersetId ? ' In its superset the rest comes after the last exercise of it.' : ''}`, `${ex.name} rest ${restText(secs ?? restDefault(ex, st))}`);
  }

  if (act === 'note') {
    if (a.note === undefined) return refuse('Which note? Give note.');
    const notes = a.replace_note ? String(a.note).trim().slice(0, 1000) : addNote(ex.notes, a.note);
    save({ exercises: setEx(ex.key, { notes }) });
    return wrote(`Note on ${ex.name} in this workout: "${notes}"${ex.notes && !a.replace_note ? ' (added to the note already there)' : ''}. It shows under its name on his phone and next time he looks back.`, `${ex.name} note`);
  }

  if (act === 'superset') {
    const { ex: other, error: e2 } = onCard(session, a.with, a.with_occurrence);
    if (e2) return refuse(e2);
    if (other.key === ex.key) return refuse('Superset it with which other exercise?');
    const sid = other.supersetId || ex.supersetId || `ss-${s.now.toString(36)}`;
    const exercises = tidySupersets(list.map((e) => (e.key === ex.key || e.key === other.key ? { ...e, supersetId: sid } : e)));
    save({ exercises });
    const group = exercises.filter((e) => e.supersetId === sid);
    return wrote(`Superset on his phone: ${group.map((e) => e.name).join(' + ')}. The rest timer starts after ${group.at(-1).name}.`, `superset ${group.map((e) => e.name).join(' + ')}`);
  }

  if (act === 'unsuperset') {
    if (!ex.supersetId) return refuse(`${ex.name} isn't in a superset.`);
    const exercises = tidySupersets(setEx(ex.key, { supersetId: null }));
    save({ exercises });
    return wrote(`${ex.name} is out of its superset: its own rest after every set again.`, `${ex.name} out of superset`);
  }

  return refuse('Which action: show, rename, times, remove, replace, target, add_sets, remove_sets, rest, note, superset or unsuperset?');
}

// ---- finished workouts, and one done without the app ---------------------------------------------------------------

const doneWorkouts = (s) => s.list('sessions').filter((x) => x.status === 'done' && x.kind !== 'holds').sort((p, q) => q.startedAt - p.startedAt);
const headText = (s, x) => {
  const tz = zoneOf(s, x);
  const min = x.endedAt ? Math.round(elapsedMs({ ...x, pausedMs: x.pausedMs || 0 }) / 60000) : null;
  return `${x.title}, ${dayText(s.date(x.startedAt), s.today)}, ${timeText(x.startedAt, tz)}${x.endedAt ? ` - ${timeText(x.endedAt, tz)} (${min} min)` : ''} (id ${x.id})`;
};

/** The finished workout he means: by id, or date and which (title or day type), else his latest. */
function pickPast(s, a) {
  const done = doneWorkouts(s);
  if (a.id) {
    const x = done.find((d) => d.id === a.id);
    if (x) return { session: x };
    return { error: s.active()?.id === a.id ? 'That workout is in progress: workout_edit.' : `No finished workout with id ${a.id}.` };
  }
  let pool = a.date ? done.filter((x) => s.date(x.startedAt) === a.date) : done;
  if (a.which) {
    const w = String(a.which).toLowerCase().trim();
    pool = pool.filter((x) => fullMatch(a.which, x.title) || x.dayType === w || (LABEL[x.dayType] && fullMatch(a.which, LABEL[x.dayType])));
  }
  if (!pool.length) {
    const near = done.slice(0, 5).map((x) => headText(s, x)).join('; ');
    return { error: `No finished workout${a.date ? ` on ${dayText(a.date, s.today)}` : ''}${a.which ? ` called "${a.which}"` : ''}. Latest: ${near || 'none'}.` };
  }
  if (a.date && pool.length > 1) return { error: `${pool.length} workouts on ${dayText(a.date, s.today)}: ${pool.map((x) => headText(s, x)).join('; ')}. Say which (which, or id).` };
  return { session: pool[0] };
}

const toldToDelete = (t) => DELETE.test(String(t || ''));

/** The routine a day type's workout belongs to (as start_session picks it). */
function routineOf(s, dayType) {
  const routines = s.list('routines');
  const mode = modeOf(s.one('progression', 'modes'), dayType);
  return routines.filter((r) => r.dayType === dayType && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((x, y) => x.order - y.order)[0] || routines.find((r) => r.dayType === dayType) || null;
}

/** Done sets from his words: [{kg, reps, seconds, type, rpe, note, count}]. */
function doneRows(session, ex, list, { order, doneAt }) {
  const out = [];
  for (const w of list) {
    for (let i = 0; i < Math.max(1, Math.min(10, w.count ?? 1)); i++) {
      const type = w.type || 'normal';
      out.push({ id: newSetId(), sessionId: session.id, exKey: ex.key, order: order(), done: true, doneAt: doneAt(), rpe: num(w.rpe) ?? null, note: w.note ? String(w.note).trim().slice(0, 300) : '',
        type, kg: num(w.kg) ?? null, reps: num(w.reps) !== undefined ? Math.round(num(w.reps)) : null, durationS: num(w.seconds) !== undefined ? Math.round(num(w.seconds)) : null, target: null });
    }
  }
  return out;
}

const heaviestWork = (rows) => { const w = rows.filter((x) => isWork(x) && x.kg != null); return w.length ? Math.max(...w.map((x) => x.kg)) : null; };

async function pastWorkout(a, ctx) {
  const s = snap(ctx);
  const act = a.action;
  if (act === 'log') return logPast(s, a, ctx);
  const { session, error } = pickPast(s, a);
  if (error) return refuse(error);
  const sets = s.setsOf(session.id);
  const list = session.exercises || [];
  const day = s.date(session.startedAt);
  const tz = zoneOf(s, session);
  const saveSession = (patch, extra = []) => s.store.writeLocalMany([...extra, { col: 'sessions', id: session.id, data: { ...session, ...patch } }]);

  if (act === 'show') {
    return { text: `${headText(s, session)}${session.note ? `. Note: "${session.note}"` : ''}. Set numbers as \`set\` counts them (warm-ups too):\n${cardText(s, session, sets)}`, summary: `showed ${session.title}` };
  }

  if (act === 'delete') {
    const key = `delete:${session.id}`;
    if (!askFirstDone(s, ctx, 'past_workout', key, toldToDelete, /\bdelete\b/i)) {
      return { text: `Not deleted. Ask him first: "Delete ${session.title} from ${dayText(day, s.today)} and its ${plural(sets.length, 'set')}? It leaves history, records and the rotation." Only a yes in his next message deletes it: then call past_workout delete again with id ${session.id}.`, summary: `asked first: ${key}` };
    }
    const photos = s.list('photos').filter((p) => p.sessionId === session.id);
    s.store.writeLocalMany([...sets.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })), ...photos.map((p) => ({ col: 'photos', id: p.id, data: null, deleted: true })), { col: 'sessions', id: session.id, data: null, deleted: true }]);
    ctx.action({ kind: 'sync' });
    return wrote(`Deleted ${session.title} from ${dayText(day, s.today)} with its ${plural(sets.length, 'set')}${photos.length ? ` and ${plural(photos.length, 'photo')}` : ''}.`, `${session.title} ${day} deleted`);
  }

  if (act === 'details') {
    const patch = {};
    const lines = [];
    if (a.title !== undefined) { const t = String(a.title).trim().slice(0, 60); if (!t) return refuse('An empty title? Give the new title.'); patch.title = t; lines.push(`title ${t}`); }
    if (a.gym !== undefined) { patch.gym = String(a.gym).trim().slice(0, 60) || null; lines.push(`gym ${patch.gym || 'none'}`); }
    if (a.new_date || a.start || num(a.shift_minutes) !== undefined || num(a.minutes) !== undefined) {
      let startedAt = session.startedAt;
      if (a.new_date || a.start) startedAt = zonedTime(a.new_date || day, a.start || hmOf(new Date(session.startedAt), tz), tz);
      if (num(a.shift_minutes) !== undefined) startedAt += Math.round(num(a.shift_minutes)) * 60000;
      if (startedAt > s.now) return refuse(`That start (${dayText(s.date(startedAt), s.today)}, ${timeText(startedAt, tz)}) is in the future.`);
      const paused = session.pausedMs || 0;
      const durMs = num(a.minutes) !== undefined ? Math.round(num(a.minutes)) * 60000 : session.endedAt ? session.endedAt - session.startedAt - paused : null;
      if (durMs != null && (durMs < 60000 || durMs > 6 * 3600000)) return refuse('A duration from 1 minute to 6 hours.');
      patch.startedAt = startedAt;
      patch.endedAt = durMs == null ? session.endedAt : startedAt + durMs + paused;
      if (patch.endedAt != null && patch.endedAt > s.now) return refuse(`It would end at ${timeText(patch.endedAt, tz)}, after now. Check the start and duration with him.`);
      if (session.logFor) patch.logFor = s.date(startedAt) < s.today ? s.date(startedAt) : undefined;
      lines.push(`${dayText(s.date(startedAt), s.today)}, ${timeText(startedAt, tz)}${patch.endedAt ? ` - ${timeText(patch.endedAt, tz)} (${Math.round((patch.endedAt - startedAt - paused) / 60000)} min)` : ''}`);
    }
    if (!lines.length) return refuse('What changes: title, new_date, start, shift_minutes, minutes or gym. Its note: action note.');
    // The sets move with it (their tick times stay inside the workout).
    const delta = patch.startedAt != null ? patch.startedAt - session.startedAt : 0;
    const moved = delta ? sets.filter((x) => x.doneAt).map((x) => ({ col: 'sets', id: x.id, data: { ...x, doneAt: x.doneAt + delta } })) : [];
    saveSession(patch, moved);
    const dayMoved = patch.startedAt != null && s.date(patch.startedAt) !== day;
    return wrote(`${session.title} (was ${dayText(day, s.today)}, ${timeText(session.startedAt, tz)}): ${lines.join('; ')}.${dayMoved && inRotation(session.dayType) ? ' The rotation counts it on the new day.' : ''}`, `${session.title} details`);
  }

  if (act === 'note' && !a.exercise) {
    if (a.note === undefined) return refuse('Which note? Give note.');
    const note = a.replace_note ? String(a.note).trim().slice(0, 1000) : addNote(session.note, a.note);
    saveSession({ note });
    return wrote(`Workout note on ${session.title} (${dayText(day, s.today)}): "${note}".`, 'workout note');
  }

  if (act === 'add_exercise') {
    const { def, error: e2 } = fromLibrary(s, a.exercise);
    if (e2) return refuse(e2);
    if (!a.sets?.length) return refuse(`Which sets did he do on ${def.name}? Give sets [{kg, reps}].`);
    const entry = entryFor(def, a.note ? String(a.note).trim().slice(0, 1000) : '');
    const at = a.position ? Math.min(list.length, Math.max(0, a.position - 1)) : list.length;
    const exercises = [...list.slice(0, at), entry, ...list.slice(at)];
    let order = Math.max(-1, ...sets.map((x) => x.order)) + 1;
    const rows = doneRows(session, entry, a.sets, { order: () => order++, doneAt: () => session.endedAt || session.startedAt });
    saveSession({ exercises }, rows.map((x) => ({ col: 'sets', id: x.id, data: x })));
    ctx.action({ kind: 'sync' });
    const warn = entry.capClass === 'main' ? guardOn(s, session, entry, heaviestWork(rows), day) : null;
    return wrote(`Added ${def.name} to ${session.title} (${dayText(day, s.today)}), number ${at + 1}: ${setsLine(entry, rows)}.${warn ? `\n${warn}` : ''}`, `${def.name} added to ${day}`);
  }

  const { ex, error: e3 } = onCard(session, a.exercise, a.occurrence);
  if (e3) return refuse(e3);
  const mine = sortedSets(sets, ex.key);

  if (act === 'note') {
    if (a.note === undefined) return refuse('Which note? Give note.');
    const notes = a.replace_note ? String(a.note).trim().slice(0, 1000) : addNote(ex.notes, a.note);
    saveSession({ exercises: list.map((e) => (e.key === ex.key ? { ...e, notes } : e)) });
    return wrote(`Note on ${ex.name} in ${session.title} (${dayText(day, s.today)}): "${notes}".`, `${ex.name} note`);
  }

  if (act === 'remove_exercise') {
    const key = `remove:${session.id}:${ex.key}`;
    if (mine.some((x) => x.done) && !askFirstDone(s, ctx, 'past_workout', key, (t) => REMOVE.test(t))) {
      return { text: `Not removed. Ask him first: "Remove ${ex.name} and its ${plural(mine.length, 'set')} from ${session.title} on ${dayText(day, s.today)}?" Only a yes in his next message removes it: then call past_workout remove_exercise again.`, summary: `asked first: ${key}` };
    }
    saveSession({ exercises: tidySupersets(list.filter((e) => e.key !== ex.key)) }, mine.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })));
    ctx.action({ kind: 'sync' });
    return wrote(`Removed ${ex.name} and its ${plural(mine.length, 'set')} from ${session.title} (${dayText(day, s.today)}).`, `${ex.name} removed from ${day}`);
  }

  if (act === 'add_set') {
    const w = { kg: a.kg, reps: a.reps, seconds: a.seconds, type: a.type, rpe: a.rpe, note: a.note, count: a.count };
    if (num(w.kg) === undefined && num(w.reps) === undefined && num(w.seconds) === undefined) return refuse('What did he do: kg (TOTAL) and reps, or seconds.');
    const type = a.type || 'normal';
    const last = mine.at(-1);
    let o = type === 'warmup' ? (mine.length ? Math.min(...mine.map((x) => x.order)) : 0) - 0.01 * Math.max(1, a.count ?? 1) : (last ? last.order : Math.max(-1, ...sets.map((x) => x.order))) + 0.01;
    const rows = doneRows(session, ex, [{ ...w, type }], { order: () => (o += 0.001), doneAt: () => last?.doneAt ?? session.endedAt ?? session.startedAt });
    s.store.writeLocalMany(rows.map((x) => ({ col: 'sets', id: x.id, data: x })));
    const after = [...mine, ...rows].sort((p, q) => p.order - q.order);
    const warn = isWork(rows[0]) ? guardOn(s, session, ex, rows[0].kg, day) : null;
    return wrote(`Added to ${ex.name} in ${session.title} (${dayText(day, s.today)}): ${rows.map((x) => valuesText(ex, x)).join(', ')}. ${ex.name} now: ${setsLine(ex, after)}.${warn ? `\n${warn}` : ''}`, `${ex.name} +${rows.length} set ${day}`);
  }

  const x = a.set ? mine[a.set - 1] : null;
  if (!x) return refuse(`Which set (set = its number)? ${ex.name}: ${setsLine(ex, mine)}.`);

  if (act === 'remove_set') {
    del(s, 'sets', x.id);
    return wrote(`Removed ${ex.name} #${a.set} (${valuesText(ex, x)}) from ${session.title} (${dayText(day, s.today)}). ${ex.name} now: ${setsLine(ex, mine.filter((y) => y !== x))}.`, `${ex.name} #${a.set} removed ${day}`);
  }

  if (act === 'edit_set') {
    const next = { ...x };
    if (num(a.kg) !== undefined) next.kg = num(a.kg);
    if (num(a.reps) !== undefined) next.reps = Math.round(num(a.reps));
    if (num(a.seconds) !== undefined) next.durationS = Math.round(num(a.seconds));
    if (a.type) next.type = a.type;
    if (num(a.rpe) !== undefined) next.rpe = num(a.rpe);
    if (a.note !== undefined) next.note = a.replace_note ? String(a.note).slice(0, 300) : addNote(x.note, a.note);
    if (JSON.stringify(next) === JSON.stringify(x)) return refuse(`Nothing to change on ${ex.name} #${a.set} (${valuesText(ex, x)}): give kg, reps, seconds, type, rpe or note.`);
    if (!next.done) { next.done = true; next.doneAt = x.doneAt ?? session.endedAt ?? session.startedAt; }
    put(s, 'sets', x.id, next);
    const warn = next.kg !== x.kg && isWork(next) ? guardOn(s, session, ex, next.kg, day) : null;
    return wrote(`${ex.name} #${a.set} of ${session.title} (${dayText(day, s.today)}) is now ${kindWord(next)}${valuesText(ex, next)} (was ${valuesText(ex, x)}).${next.note !== (x.note || '') ? ` Note: "${next.note}".` : ''}${warn ? `\n${warn}` : ''}`, `${ex.name} #${a.set}: ${valuesText(ex, next)}`);
  }

  return refuse('Which action: show, details, note, edit_set, add_set, remove_set, add_exercise, remove_exercise, delete or log?');
}

/** A workout he did without the app, saved as a finished one exactly like the phone's (history, records, rotation). */
function logPast(s, a, ctx) {
  const tz = s.tz;
  if (!a.date || !a.start) return refuse('When was it? Give date and start (HH:MM); ask him if he didn\'t say.');
  if (!a.exercises?.length) return refuse('Which exercises and sets did he do? Give exercises [{name, sets: [{kg, reps}]}].');
  const startedAt = zonedTime(a.date, a.start, tz);
  const minutes = Math.round(num(a.minutes) ?? 60);
  if (minutes < 1 || minutes > 360) return refuse('A duration from 1 minute to 6 hours.');
  const endedAt = startedAt + minutes * 60000;
  if (endedAt > s.now) return refuse(`It would end at ${timeText(endedAt, tz)} on ${dayText(a.date, s.today)}, after now. A workout he is doing now: start_session.`);
  const dayType = a.dayType || null;
  const routine = dayType ? routineOf(s, dayType) : null;
  const title = String(a.title || '').trim().slice(0, 60) || routine?.title || LABEL[dayType] || 'Workout';
  const same = doneWorkouts(s).find((x) => s.date(x.startedAt) === a.date && (dayType ? x.dayType === dayType : sameName(x.title, title)));
  if (same && !a.again) return refuse(`Already in history: ${headText(s, same)}. To fix that one: past_workout with id ${same.id}. A second one that day: again: true.`);
  const errors = []; const defs = [];
  for (const e of a.exercises) {
    const { def, error } = fromLibrary(s, e.name);
    if (error) errors.push(error); else if (!e.sets?.length) errors.push(`No sets for ${def.name}.`); else defs.push([def, e]);
  }
  if (errors.length) return refuse(`Nothing saved. ${errors.join(' ')}`);
  const st = s.settings();
  const meta = s.meta();
  const session = {
    id: newId('session'), kind: 'workout', title, routineId: routine?.id ?? null, dayType, week: dayType && meta?.firstSessions?.[dayType] ? weekColumn(meta.firstSessions[dayType], a.date) : null,
    startedAt, endedAt, pausedMs: 0, pausedAt: null, status: 'done', note: a.note ? String(a.note).trim().slice(0, 1000) : '', photos: [], gym: st.gym?.name || null,
    bodyweightKg: currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: st.bodyweight, now: startedAt })?.kg ?? null, source: 'training-hq',
    exercises: [], ...(a.date < s.today ? { logFor: a.date } : {}),
  };
  const total = defs.reduce((n, [, e]) => n + e.sets.reduce((m, w) => m + Math.max(1, Math.min(10, w.count ?? 1)), 0), 0);
  let order = 0; let i = 0;
  const rows = [];
  const warns = [];
  for (const [def, e] of defs) {
    const entry = entryFor(def, e.note ? String(e.note).trim().slice(0, 1000) : '');
    session.exercises.push(entry);
    const mine = doneRows(session, entry, e.sets, { order: () => order++, doneAt: () => startedAt + Math.round(((++i) * minutes * 60000) / (total + 1)) });
    rows.push(...mine);
    const w = entry.capClass === 'main' ? guardOn(s, session, entry, heaviestWork(mine), a.date) : null;
    if (w) warns.push(`${def.name}: ${w}`);
  }
  // Sets first, as the phone saves them: no workout without its sets.
  s.store.writeLocalMany([...rows.map((x) => ({ col: 'sets', id: x.id, data: x })), { col: 'sessions', id: session.id, data: { ...session, tz } }]);
  ctx.action({ kind: 'sync' });
  const sum = summarize(session, rows);
  const after = snapshot(s.store, { tz, now: s.now });
  const rot = dayType && inRotation(dayType) ? after.rotation() : null;
  return wrote([`Logged ${title} on ${dayText(a.date, s.today)}, ${timeText(startedAt, tz)} - ${timeText(endedAt, tz)} (${minutes} min${num(a.minutes) === undefined ? ', assumed: ask him how long' : ''}): ${plural(session.exercises.length, 'exercise')}, ${plural(sum.done, 'set')}, ${sum.volume.toLocaleString('en-US')} kg volume. It counts in history and records like a workout in the app (id ${session.id}).`,
    ...session.exercises.map((e) => `${e.name}: ${setsLine(e, rows.filter((x) => x.exKey === e.key))}`),
    ...(rot ? [`The rotation counts it: next is ${LABEL[rot.next.dayType] || rot.next.dayType} (${dayText(rot.next.date, s.today)}).`] : []),
    ...warns].join('\n'), `logged ${title} ${a.date}`);
}

// ---- his phone's timers ------------------------------------------------------------------------------------------

const TIMER = {
  rest_pause: ['rest-pause', 'Rest timer paused on his phone: it stands still until resumed (nothing happens if no rest is running).'],
  rest_resume: ['rest-resume', 'Rest timer running again on his phone from where it stopped.'],
  hold_pause: ['hold-pause', 'The hold counting down on his workout screen is paused: it stands still, PAUSED on the screen, until resumed.'],
  hold_resume: ['hold-resume', 'The hold counts down again on his workout screen from where it stopped.'],
  hold_restart: ['hold-restart', 'The hold starts again from the top on his workout screen (GET READY first, then the full time).'],
};

function timer(a, ctx) {
  const t = TIMER[a.action];
  if (!t) return refuse(`Which: ${Object.keys(TIMER).join(', ')}?`);
  ctx.action({ kind: t[0] });
  return { text: t[1], summary: a.action.replace('_', ' ') };
}

// ---- the tools ---------------------------------------------------------------------------------------------------

const tool = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const WARMUPS = { type: 'array', maxItems: 6, items: obj({ kg: { type: 'number', minimum: 0 }, reps: { type: 'integer', minimum: 1, maximum: 100 } }) };
const DONE_SETS = { type: 'array', minItems: 1, maxItems: 30, items: obj({ kg: { type: 'number', minimum: 0, description: 'TOTAL kg incl. the bar; weighted pull-ups: the added kg' }, reps: { type: 'integer', minimum: 0, maximum: 200 }, seconds: { type: 'integer', minimum: 1, maximum: 3600 }, type: SET_TYPE, rpe: { type: 'number', minimum: 1, maximum: 10 }, note: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 10, description: 'how many such sets ("3 x 10 at 50" = count 3)' } }) };
const ONLY_HIS = 'Only when he tells you to (his words), never on your own idea.';

export const WORKOUT_TOOLS = [
  tool('workout_edit', 'Edit the workout in progress', `The workout in progress, as the session screen edits it. ${ONLY_HIS} show: every exercise with its numbered sets (set = that number, warm-ups count), rest and notes. rename: title. times: when he started (start HH:MM, or shift_minutes -10 = "I started 10 minutes earlier", or minutes = how long he has trained so far). remove: an exercise and its sets (logged sets: ask him first, then only his yes). replace: exercise with another from his library (with = its name), same place, new target from his last load since the comeback (or kg he agreed), sets left kept; logged sets stay as the old exercise. target: an unticked set's load or reps (set = its number; none = every unticked working set): kg TOTAL, reps_min/reps_max, seconds. add_sets: count sets of type (warmup = before the first set; no kg = his warm-up steps from the working weight). remove_sets: unticked sets (set, or count from the end; type warmup = all unticked warm-ups). rest: this exercise's rest in seconds today (0 = off, no seconds = back to the default). note: on the exercise (machine settings and such; added to the one there, replace_note to rewrite), or without exercise the workout's note. superset: exercise with another (with); unsuperset. Add or move an exercise: workout_exercise; skip: workout; a ticked set: correct_set.`,
    obj({ action: { type: 'string', enum: ['show', 'rename', 'times', 'remove', 'replace', 'target', 'add_sets', 'remove_sets', 'rest', 'note', 'superset', 'unsuperset'] }, exercise: { type: 'string' }, occurrence: { type: 'integer', minimum: 1, description: 'which one when it is on the card more than once: 1 = first' }, with: { type: 'string', description: 'replace: the new exercise; superset: the other exercise' }, with_occurrence: { type: 'integer', minimum: 1 }, set: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1, maximum: 10 }, type: SET_TYPE, kg: { type: 'number', minimum: 0 }, reps_min: { type: 'integer', minimum: 1, maximum: 100 }, reps_max: { type: 'integer', minimum: 1, maximum: 100 }, seconds: { type: 'integer', minimum: 0, maximum: 3600, description: 'timed sets; for rest: the rest seconds' }, sets: { type: 'integer', minimum: 1, maximum: 10 }, warmups: WARMUPS, why: { type: 'string' }, note: { type: 'string' }, replace_note: { type: 'boolean' }, title: { type: 'string' }, start: HM, date: ISO, shift_minutes: { type: 'integer', minimum: -240, maximum: 240 }, minutes: { type: 'integer', minimum: 0, maximum: 720 } }, ['action']), workoutEdit),
  tool('past_workout', 'A finished workout', `Finished workouts of any age, as History > Edit session does it, and one he did without the app. ${ONLY_HIS} Which: id, or date (+ which = title or day type when there are several), default his latest. show: its exercises and numbered sets (set = that number, warm-ups count). details: title, new_date (same time), start HH:MM, shift_minutes, minutes (duration), gym. note: on an exercise, or without exercise the workout's note (added; replace_note to rewrite). edit_set: exercise + set with kg TOTAL, reps, seconds, type, rpe, note. add_set: a set he did (count for several). remove_set: exercise + set. add_exercise: exercise from his library with sets [{kg, reps}], position. remove_exercise (logged sets: ask him first). delete: the whole workout, its sets and photos: ask him first, then only his yes to that question. log: a workout he did without the app: date, start, minutes (ask him), dayType when it was his Pull/Push/Legs/Neck (the rotation counts it), title, note, exercises [{name, note, sets [{kg, reps, seconds, type, count}]}]; saved like a workout in the app (history, records, rotation). The 30% cap warns as on that day.`,
    obj({ action: { type: 'string', enum: ['show', 'details', 'note', 'edit_set', 'add_set', 'remove_set', 'add_exercise', 'remove_exercise', 'delete', 'log'] }, id: { type: 'string' }, date: ISO, which: { type: 'string' }, exercise: { type: 'string' }, occurrence: { type: 'integer', minimum: 1 }, set: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1, maximum: 10 }, kg: { type: 'number', minimum: 0 }, reps: { type: 'integer', minimum: 0, maximum: 200 }, seconds: { type: 'integer', minimum: 1, maximum: 3600 }, type: SET_TYPE, rpe: { type: 'number', minimum: 1, maximum: 10 }, note: { type: 'string' }, replace_note: { type: 'boolean' }, sets: DONE_SETS, position: { type: 'integer', minimum: 1 }, title: { type: 'string' }, gym: { type: 'string' }, new_date: ISO, start: HM, shift_minutes: { type: 'integer', minimum: -1440, maximum: 1440 }, minutes: { type: 'integer', minimum: 1, maximum: 360 }, dayType: { type: 'string', enum: ['pull', 'push', 'legs', 'neck'] }, again: { type: 'boolean', description: 'log: a second workout of that kind on that day' },
      exercises: { type: 'array', minItems: 1, maxItems: 20, items: obj({ name: { type: 'string' }, note: { type: 'string' }, sets: DONE_SETS }, ['name', 'sets']) } }, ['action']), pastWorkout),
  tool('timer', 'Rest and hold timers', `His phone's timers. ${ONLY_HIS} rest_pause / rest_resume: the rest timer stands still and runs on (start, +/- seconds and skip: rest_timer). hold_pause / hold_resume / hold_restart: the hold (or timed set) counting down on his workout screen; restart = from the top, GET READY first.`,
    obj({ action: { type: 'string', enum: Object.keys(TIMER) } }, ['action']), timer),
];
