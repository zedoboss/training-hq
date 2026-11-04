// The coach's plan tools (Thu 11/5): what his screens can do that the coach had no tool for. Each only on his words.
// Thu 11/5, his words: "What else cant u do? Figure it out and let the mac give U the tools". His routines (the
// routine screen), the exercise library (library and exercise screens), week 5+ numbers and the Normal switch
// (progression screen and Train's "Not yet"), the rotation and its week columns, rest days on other dates, tendon
// holds (holds screen), the bodyweight for pull-ups (Settings / "Bodyweight today") and his OK on the readiness table.
// They write the same records those screens write, with the app's own code. None of them can touch a fixed rule: the
// 30% cap stays on top of every number, the readiness table's levels and "go lighter" amounts are edited only on its
// screen by him, his tendon pain limit and phase rules are never written here, and nothing here touches the sauna.
import { snapshot, dayText, timeText, whenText, loadText, repsText, plural, findByName, wrote, refuse, k, formatHm } from './shared.mjs';
import { put, del, num, addNote, WRITE_TOOLS } from './tools-write.mjs';
import { holdsDueText } from './tools-read.mjs';
import { addExercises, removeExercise, replaceExercise, updateExercise, detachFromPlan, defaultSets, newId, newKey } from '../../app/js/lib/routines.js';
import { newCustomExercise, exerciseUsed, routinesUsing, searchLibrary, slug } from '../../app/js/lib/library.js';
import { TYPES, MUSCLES, EQUIPMENT, SET_TYPES } from '../../app/js/lib/exercise-types.js';
import { REST_CHOICES, restText } from '../../app/js/lib/settings.js';
import { proposeWeek, confirmWeek, progressId, normalReady, modeOf } from '../../app/js/lib/progression.js';
import { weekColumn } from '../../app/js/lib/programme.js';
import { comebackStartOf, previousSame, routineFromLast } from '../../app/js/lib/finish.js';
import { LABEL, addDays, withRest, withTime, rotationDay, withNextType, chosenNext, inRotation } from '../../app/js/lib/rotation.js';
import { painOk } from '../../app/js/lib/holds.js';
import { currentBodyweight } from '../../app/js/lib/health.js';
import { paramsOf, askedAreas } from '../../app/js/lib/readiness.js';
import { formatDay, zonedTime, hmOf } from '../../app/js/lib/time.js';
import { newSetId } from '../../app/js/lib/session.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HM = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: '24-hour "HH:MM" in his time zone' };
const DAY = { type: 'string', enum: ['pull', 'push', 'legs'] };
const SAID = { type: 'string', description: 'his words, as he said them' };
const PLACE = { position: { type: 'integer', minimum: 1, description: '1 = first' }, after: { type: 'string' }, before: { type: 'string' } };
const TIMING = { type: 'array', items: { type: 'string', enum: ['after Pull', 'after Push', 'after Legs', 'rest days'] } };
const ONLY_HIS = 'Only when he tells you to (his words), never on your own idea.';
const sayList = (xs) => xs.join('; ');
const clip = (t, n = 200) => String(t || '').trim().slice(0, n);

// ---- routines (the routine screen) ---------------------------------------------------------------------------------

/** His routine by name; a day type ("pull") is the one Train starts for it (Normal once he switched). */
function findRoutine(s, q) {
  const routines = s.list('routines');
  const t = String(q || '').trim().toLowerCase();
  if (!t) return { error: `Which routine: ${sayList(routines.map((r) => r.title))}?` };
  if (['pull', 'push', 'legs', 'neck'].includes(t)) {
    const mode = modeOf(s.one('progression', 'modes'), t);
    const r = routines.filter((x) => x.dayType === t && x.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((x, y) => (x.order ?? 0) - (y.order ?? 0))[0] || routines.find((x) => x.dayType === t);
    if (r) return { r };
  }
  const { item, ambiguous } = findByName(routines, q, (r) => r.title, (r) => [r.id]);
  if (!item) return { error: ambiguous.length ? `Which routine: ${sayList(ambiguous)}?` : `No routine called "${q}". His routines: ${sayList(routines.map((r) => r.title))}.` };
  return { r: item };
}

const isTimedSet = (x) => x.type === 'hold' || x.durationS != null;
function oneSet(x, barKg) {
  const what = isTimedSet(x) ? `${x.durationS ?? 30} s` : repsText(x.reps) || '?';
  const kind = x.type && x.type !== 'normal' ? ` (${SET_TYPES[x.type]?.label.toLowerCase() || x.type})` : '';
  return `${what}${x.kg != null ? ` at ${loadText(x.kg, barKg)}` : ''}${kind}`;
}

/** "2 × 8-12 at 40 kg", "4 × 45 s", "warm-up 40 kg × 8, then 2 × 6-8"; a programme exercise says where its sets come from. */
export function setsText(e, barKg = null) {
  if (e.plan) return 'follows The Comeback (sets and targets from the week column at Start, under the 30% cap)';
  const warm = (e.sets || []).filter((x) => x.type === 'warmup');
  const groups = [];
  for (const x of (e.sets || []).filter((y) => y.type !== 'warmup')) {
    const t = oneSet(x, barKg);
    if (groups.length && groups.at(-1).t === t) groups.at(-1).n++; else groups.push({ t, n: 1 });
  }
  const work = groups.map((g) => `${g.n} × ${g.t}`).join(', ') || 'no sets';
  const before = e.warmup ? 'calculated warm-up sets' : warm.length ? `warm-up ${warm.map((w) => (w.kg != null ? `${k(w.kg)} kg × ${repsText(w.reps) || '?'}` : w.note || 'set')).join(', ')}` : '';
  return before ? `${before}, then ${work}` : work;
}

/** Where a new or moved exercise goes: an index into `list` (which doesn't hold it), or an error. */
function placeIn(list, a, { need = false } = {}) {
  if (a.position) return { i: Math.min(list.length, a.position - 1) };
  const ref = a.after || a.before;
  if (ref) {
    const { item, ambiguous } = findByName(list, ref);
    if (!item) return { error: ambiguous.length ? `Which one: ${sayList(ambiguous)}?` : `No "${ref}" in this routine. Its exercises: ${sayList(list.map((e) => e.name))}.` };
    const i = list.indexOf(item);
    return { i: a.after ? i + 1 : i };
  }
  return need ? { error: 'Where to? Give position (1 = first), or after / before an exercise.' } : { i: list.length };
}
const placeText = (list, i) => (i === 0 ? 'first' : i === list.length - 1 ? `last, after ${list[i - 1].name}` : `number ${i + 1}, after ${list[i - 1].name}`);

/** The routine's sets changed as he said: count, reps, kg, seconds, set type; one set (`set`, 1 = first working set) or all. */
function patchSets(e, a, type) {
  const warm = (e.sets || []).filter((x) => x.type === 'warmup');
  let work = (e.sets || []).filter((x) => x.type !== 'warmup');
  if (!work.length) work = defaultSets(type);
  const n = a.sets ?? work.length;
  const tail = work.at(-1);
  const rows = Array.from({ length: n }, (_, i) => ({ ...(work[i] || { ...tail, type: tail.type === 'dropset' ? 'normal' : tail.type }) }));
  if (a.set && a.set > n) return { error: `${e.name} has ${plural(n, 'working set')} in this routine; there is no set ${a.set}.` };
  for (const i of a.set ? [a.set - 1] : rows.map((_, j) => j)) {
    const x = { ...rows[i] };
    if (a.set_type) x.type = a.set_type;
    if (a.reps_min != null || a.reps_max != null) {
      const lo = a.reps_min ?? Math.min(x.reps?.[0] ?? a.reps_max, a.reps_max);
      x.reps = [lo, Math.max(lo, a.reps_max ?? lo)];
      if (a.seconds == null && x.type !== 'hold') delete x.durationS;
    }
    if (a.kg !== undefined) x.kg = a.kg;
    if (a.clear_kg) x.kg = null;
    if (a.seconds != null) { x.durationS = a.seconds; if (a.reps_min == null && a.reps_max == null) delete x.reps; }
    if (x.type === 'hold' && x.durationS == null) x.durationS = 30;
    rows[i] = x;
  }
  return { sets: [...warm, ...rows] };
}

/** His last workout of this routine's kind since the comeback (what Train > Start copies), or null. */
function lastCopied(s, r) {
  const last = previousSame({ id: null, dayType: r.dayType, routineId: r.id, title: r.title, startedAt: s.now }, s.list('sessions'));
  const start = comebackStartOf(s.meta());
  return !last || (start && s.date(last.startedAt) < start) ? null : last;
}

/**
 * Thu 11/5: Start copies his last workout of a kind (lib/finish.js routineFromLast), so an edit to the routine alone
 * would not show. The routine first takes on what that copy would be (his last workout's exercises, order and sets;
 * a skip reason stays with that workout), then the edit goes on top, stamped editedAt: his next Start is the routine
 * as changed; the workout after that copies his last one again.
 */
function baseOf(s, r) {
  const last = lastCopied(s, r);
  if (!last) return r;
  const { copiedFrom, editedSince, ...c } = routineFromLast(r, last, s.list('sets').filter((x) => x.sessionId === last.id));
  return { ...c, exercises: c.exercises.map(({ skippedLast, ...e }) => ({ ...e, notes: skippedLast ? String(e.notes || '').split('\n').slice(0, -1).join('\n') : e.notes })) };
}

/** Said when the routine is also what his next Start copies. */
function copyNote(s, r) {
  const last = lastCopied(s, r);
  return last ? ` His next ${r.title} starts from the routine as changed now, with the rest of his last ${r.title} (${dayText(s.date(last.startedAt), s.today)}) as it was; after that, Start copies his last ${r.title} again.` : '';
}

function routineEdit(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const found = findRoutine(s, a.routine);
  if (found.error) return refuse(found.error);
  const r = a.action === 'show' || a.action === 'follow_last' ? found.r : baseOf(s, found.r);
  const lib = s.lib();
  const libEx = (e) => lib.get(e.exerciseId) || null;
  const barOf = (e) => libEx(e)?.barKg ?? null;
  const typeOf = (e) => libEx(e)?.type || 'weight_reps';
  const line = (e, i) => `${i + 1}. ${e.name}: ${setsText(e, barOf(e))}${e.restSeconds != null ? `, rest ${restText(e.restSeconds)}` : ''}${e.supersetId ? ', in a superset' : ''}${e.notes ? ` (note: ${e.notes})` : ''}`;
  const weights = r.followLast === false ? 'weights as set in the routine' : 'weights follow his last session; the routine\'s own kg fill gaps';
  if (a.action === 'show') return { text: `${r.title} (${weights}). Loads are total kg.\n${r.exercises.map(line).join('\n') || 'No exercises.'}${r.notes ? `\nRoutine note: ${r.notes}` : ''}`, summary: r.title };

  const save = (next) => put(s, 'routines', r.id, { ...next, updatedAt: s.now, ...(a.action === 'follow_last' ? {} : { editedAt: s.now }) });
  const pick = (q = a.exercise) => {
    if (!q) return { error: `Which exercise? ${r.title}: ${sayList(r.exercises.map((e) => e.name))}.` };
    const { item, ambiguous } = findByName(r.exercises, q);
    if (!item) return { error: ambiguous.length ? `Which one: ${sayList(ambiguous)}?` : `No "${q}" in ${r.title}. Its exercises: ${sayList(r.exercises.map((e) => e.name))}.` };
    return { e: item };
  };
  const fromLib = (q) => {
    const { item, ambiguous } = findByName([...lib.values()], q);
    if (!item) return { error: ambiguous.length ? `Which exercise: ${sayList(ambiguous)}?` : `No exercise called "${q}" in his library. Create it first (exercise_library create) if he wants a new one.` };
    return { ex: item };
  };
  const setsAsked = ['sets', 'reps_min', 'reps_max', 'kg', 'seconds', 'set_type', 'clear_kg'].some((x) => a[x] !== undefined);
  const kgNote = () => (a.kg !== undefined && r.followLast !== false ? ` Weights in ${r.title} follow his last session, so these kg are used only where he has no last set (follow_last off makes them the start).` : '');

  if (a.action === 'add') {
    if (!a.exercise) return refuse('Which exercise to add?');
    const { ex, error: e1 } = fromLib(a.exercise);
    if (e1) return refuse(e1);
    if (!a.again && r.exercises.some((e) => e.exerciseId === ex.id)) return refuse(`${ex.name} is already in ${r.title}. To change its place: action move; again: true adds it a second time.`);
    let entry = addExercises({ exercises: [] }, [ex]).exercises[0];
    if (setsAsked) { const p = patchSets(entry, a, ex.type); if (p.error) return refuse(p.error); entry = { ...entry, sets: p.sets }; }
    if (a.rest_seconds != null) entry = { ...entry, restSeconds: a.rest_seconds };
    if (a.note) entry = { ...entry, notes: clip(a.note, 300) };
    const at = placeIn(r.exercises, a);
    if (at.error) return refuse(at.error);
    const list = [...r.exercises]; list.splice(at.i, 0, entry);
    save({ ...r, exercises: list });
    return wrote(`Added ${ex.name} to ${r.title}, ${placeText(list, at.i)}: ${setsText(entry, ex.barKg ?? null)}.${kgNote()}${copyNote(s, r)}`, `${r.title}: + ${ex.name}`);
  }

  const { e, error: e2 } = pick();
  if (e2) return refuse(e2);
  const i = r.exercises.indexOf(e);

  if (a.action === 'remove') {
    if (!String(a.said || '').trim()) return refuse(`Removing ${e.name} from ${r.title} needs his explicit words: pass them in said. If he didn't say to remove it, ask him.`);
    save(removeExercise(r, e.key));
    return wrote(`Removed ${e.name} from ${r.title}. Past sessions keep it.${copyNote(s, r)}`, `${r.title}: - ${e.name}`);
  }
  if (a.action === 'swap') {
    if (!a.with) return refuse(`Swap ${e.name} for which exercise? Give it in with.`);
    const { ex, error: e3 } = fromLib(a.with);
    if (e3) return refuse(e3);
    const next = replaceExercise(r, e.key, ex);
    const ne = next.exercises[i];
    save(next);
    return wrote(`${r.title}: ${e.name} replaced by ${ex.name}, same place: ${setsText(ne, ex.barKg ?? null)}${e.plan ? '. It no longer follows The Comeback (a different movement): its own sets, his last load, the 30% cap on top' : ''}.${copyNote(s, r)}`, `${r.title}: ${e.name} -> ${ex.name}`);
  }
  if (a.action === 'move') {
    const rest = r.exercises.filter((x) => x.key !== e.key);
    const at = placeIn(rest, a, { need: true });
    if (at.error) return refuse(at.error);
    rest.splice(at.i, 0, e);
    save({ ...r, exercises: rest });
    return wrote(`Moved ${e.name} to ${placeText(rest, at.i)} in ${r.title}. Order now: ${rest.map((x) => x.name).join(', ')}.${copyNote(s, r)}`, `${r.title}: moved ${e.name}`);
  }
  if (a.action === 'sets') {
    if (!setsAsked) return refuse('What to change: sets (how many), reps_min / reps_max, kg (TOTAL), seconds (for timed or hold sets), set_type; set = one set (1 = first working set), else all.');
    let base = r;
    if (e.plan) {
      if (!a.detach) return refuse(`${e.name} follows The Comeback in ${r.title}: its sets and targets come from the week column at Start, under the 30% cap. Only if he says he wants his own sets for it: call again with detach: true (the 30% guard still applies).`);
      base = detachFromPlan(r, e.key, [{ type: 'normal', reps: [8, 10] }, { type: 'normal', reps: [8, 10] }]);
    }
    const be = base.exercises[i];
    const p = patchSets(be, a, typeOf(e));
    if (p.error) return refuse(p.error);
    const next = updateExercise(base, e.key, { sets: p.sets });
    save(next);
    return wrote(`${r.title}, ${e.name}: ${setsText(next.exercises[i], barOf(e))} (was ${setsText(e, barOf(e))}).${kgNote()}${copyNote(s, r)}`, `${r.title}: ${e.name} sets`);
  }
  if (a.action === 'rest') {
    if (a.rest_seconds == null && !a.default_rest) return refuse(`Rest in seconds (${REST_CHOICES.join(', ')}), or default_rest: true for his default.`);
    if (a.rest_seconds != null && !REST_CHOICES.includes(a.rest_seconds)) return refuse(`The routine's rest choices are ${REST_CHOICES.map((x) => restText(x)).join(', ')}. Pick the nearest one with him.`);
    const v = a.default_rest ? null : a.rest_seconds;
    save(updateExercise(r, e.key, { restSeconds: v }));
    return wrote(`${r.title}, ${e.name}: rest ${v == null ? 'his default' : restText(v)} from the next session on.`, `${r.title}: ${e.name} rest`);
  }
  if (a.action === 'note') {
    if (a.note == null) return refuse('The note, in his words.');
    const text = a.replace ? clip(a.note, 1000) : addNote(e.notes, a.note);
    save(updateExercise(r, e.key, { notes: text }));
    return wrote(`${r.title}, ${e.name}: note now "${text || '(none)'}". It shows on the card each session.`, `${r.title}: ${e.name} note`);
  }
  if (a.action === 'warmup') {
    if (a.on == null) return refuse('on: true for calculated warm-up sets (his Settings steps), false to remove them.');
    save(updateExercise(r, e.key, a.on ? { warmup: true, sets: (e.sets || []).filter((x) => x.type !== 'warmup') } : { warmup: false }));
    return wrote(`${r.title}, ${e.name}: ${a.on ? 'calculated warm-up sets before the first working set (steps in Settings)' : 'no calculated warm-up sets'}.`, `${r.title}: ${e.name} warm-up ${a.on ? 'on' : 'off'}`);
  }
  if (a.action === 'superset') {
    if (a.on === false) { save(updateExercise(r, e.key, { supersetId: null })); return wrote(`${e.name} is out of its superset in ${r.title}.${copyNote(s, r)}`, `${r.title}: ${e.name} no superset`); }
    if (!a.with) return refuse('Superset with which exercise of this routine? Give it in with.');
    const { e: o, error: e4 } = pick(a.with);
    if (e4) return refuse(e4);
    if (o.key === e.key) return refuse('Pick another exercise to superset it with.');
    const sid = o.supersetId || `ss-${s.now.toString(36)}`;
    save({ ...r, exercises: r.exercises.map((x) => (x.key === e.key || x.key === o.key ? { ...x, supersetId: sid } : x)) });
    return wrote(`${r.title}: ${e.name} and ${o.name} are a superset now.${copyNote(s, r)}`, `${r.title}: superset`);
  }
  if (a.action === 'follow_last') {
    if (a.on == null) return refuse('on: true = weights follow his last session; false = every session starts from the weights set in the routine.');
    save({ ...r, followLast: !!a.on });
    return wrote(`${r.title}: ${a.on ? 'weights follow his last session; the routine\'s kg fill gaps' : 'every session starts from the weights set in the routine'}. The 30% cap still applies.`, `${r.title}: follow last ${a.on ? 'on' : 'off'}`);
  }
  return refuse('action: show, add, remove, swap, move, sets, rest, note, warmup, superset or follow_last.');
}

// ---- the exercise library (library and exercise screens) ----------------------------------------------------------

function exerciseLibrary(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const all = [...s.lib().values()];
  const label = (e) => `${e.name} (${TYPES[e.type]?.label || e.type || 'weight × reps'}, ${e.equipment || 'no equipment'}${e.source === 'custom' || e.custom ? ', custom' : e.source === 'mine' ? ', his' : ''}${e.barKg ? `, ${k(e.barKg)} kg bar` : ''})`;
  const noteOf = (e) => e.pinnedNote?.text ?? e.pinnedNote ?? '';
  if (a.action === 'find') {
    const q = a.exercise || a.name || '';
    const hits = searchLibrary(all, { q }).slice(0, 10);
    if (!hits.length) return { text: `Nothing in his library matches "${q}". action create makes it, with its type and equipment, if he wants it.`, summary: 'no match' };
    return { text: hits.map((e) => `- ${label(e)}${noteOf(e) ? `; note: ${noteOf(e)}` : ''}`).join('\n'), summary: `${hits.length} found` };
  }
  if (a.action === 'create') {
    if (!clip(a.name)) return refuse('The new exercise\'s name, as he says it.');
    if (!a.type) return refuse(`Its type: ${Object.entries(TYPES).map(([id, t]) => `${id} (${t.label})`).join(', ')}. Ask him if it isn't clear.`);
    let made;
    try { made = newCustomExercise({ name: a.name, type: a.type, primary: a.primary || 'other', secondary: (a.secondary || []).filter((m) => m !== (a.primary || 'other')), equipment: a.equipment || 'other' }); } catch (e) { return refuse(e.message); }
    const twin = all.find((e) => e.id === made.id || e.name.toLowerCase() === made.name.toLowerCase());
    if (twin) return refuse(`${twin.name} is already in his library: ${label(twin)}.`);
    put(s, 'exercises', made.id, { ...made, createdAt: s.now, by: 'coach' });
    return wrote(`Made ${label({ ...made, source: 'custom' })} in his library. It starts with no history; add it to a routine with routine_edit add.`, `+ ${made.name}`);
  }
  const { item: ex, ambiguous } = findByName(all, a.exercise || '');
  if (!ex) return refuse(ambiguous.length ? `Which exercise: ${sayList(ambiguous)}?` : `No exercise called "${a.exercise || ''}" in his library (action find searches it).`);
  const rec = () => s.one('exercises', ex.id) || { id: ex.id };
  const used = () => exerciseUsed(ex, { sessions: s.list('sessions'), bridge: s.one('bridge', 'last-loads') });

  if (a.action === 'note' || a.action === 'how_to') {
    if (a.text == null) return refuse('The text, in his words.');
    const field = a.action === 'note' ? 'pinnedNote' : 'howTo';
    const old = field === 'pinnedNote' ? noteOf(ex) : ex.howTo || '';
    const text = a.replace ? clip(a.text, 1000) : addNote(old, a.text);
    const v = field === 'pinnedNote' ? (text ? { text, from: `Training HQ, ${formatDay(new Date(s.now), s.tz)}` } : null) : text || null;
    put(s, 'exercises', ex.id, { ...rec(), [field]: v });
    return wrote(`${ex.name}: ${field === 'pinnedNote' ? 'pinned note' : 'how-to'} now "${text || '(none)'}".${field === 'pinnedNote' ? ' It shows on its card every session and on its hold timer.' : ''}`, `${ex.name} ${field === 'pinnedNote' ? 'note' : 'how-to'}`);
  }
  if (a.action === 'bar') {
    const bars = s.equipment().bars || [];
    const q = String(a.bar || '').trim().toLowerCase();
    if (!q) return refuse(`Which bar: ${sayList([...bars.map((b) => `${b.label || 'Bar'} ${k(b.kg)} kg`), 'none', 'default (by equipment type)'])}?`);
    const bar = q === 'none' || q === 'default' ? null : bars.find((b) => String(b.label || '').toLowerCase() === q || String(b.id).toLowerCase() === q || Number(q.replace(/\s*kg$/, '')) === Number(b.kg)) || null;
    if (!bar && q !== 'none' && q !== 'default') return refuse(`No bar "${a.bar}" in his equipment. Bars: ${sayList(bars.map((b) => `${b.label || 'Bar'} ${k(b.kg)} kg`)) || 'none set up (Settings > Equipment)'}.`);
    put(s, 'exercises', ex.id, { ...rec(), barId: q === 'none' ? 'none' : q === 'default' ? null : bar.id });
    return wrote(`${ex.name}: ${q === 'none' ? 'no bar, loads are plain totals' : q === 'default' ? 'the bar by its equipment type' : `the ${bar.label || 'bar'} (${k(bar.kg)} kg)`}. Loads stay TOTAL kg including the bar.`, `${ex.name} bar`);
  }
  if (a.action === 'edit') {
    if (ex.source === 'library') return refuse(`${ex.name} is from the general library: only its note, how-to and bar change. For other changes he duplicates it as a custom exercise on its screen.`);
    const locked = used();
    const name = a.name ? clip(a.name, 80).replace(/\s+/g, ' ') : ex.name;
    if (locked && ((a.name && name !== ex.name) || (a.type && a.type !== ex.type))) return refuse(`${ex.name} has logged sets, so its name and type are locked (his history follows its name). Muscles and equipment can change.`);
    if (name !== ex.name && all.some((e) => e.id !== ex.id && e.name.toLowerCase() === name.toLowerCase())) return refuse(`An exercise called ${name} already exists.`);
    const primary = a.primary || ex.primary;
    const fields = { name, type: a.type || ex.type, primary, secondary: (a.secondary || ex.secondary || []).filter((m) => m !== primary), equipment: a.equipment || ex.equipment };
    put(s, 'exercises', ex.id, { ...rec(), custom: !!ex.custom, ...fields, editedAt: s.now });
    if (name !== ex.name) for (const r of routinesUsing(ex, s.list('routines'))) put(s, 'routines', r.id, { ...r, exercises: r.exercises.map((e) => (e.exerciseId === ex.id ? { ...e, name } : e)) });
    return wrote(`Saved ${label({ ...ex, ...fields })}.`, `${name} edited`);
  }
  if (a.action === 'delete') {
    if (!ex.custom) return refuse(`${ex.name} isn't a custom exercise; only custom ones can be deleted.`);
    if (!String(a.said || '').trim()) return refuse(`Deleting ${ex.name} needs his explicit words: pass them in said.`);
    if (used()) return refuse(`${ex.name} has logged sets, so it stays: his history needs it.`);
    const inR = routinesUsing(ex, s.list('routines'));
    if (inR.length) return refuse(`${ex.name} is in ${inR.map((r) => r.title).join(', ')}. Remove it there first (routine_edit remove), on his word.`);
    del(s, 'exercises', ex.id);
    return wrote(`Deleted ${ex.name} from his library.`, `- ${ex.name}`);
  }
  return refuse('action: find, create, edit, note, how_to, bar or delete.');
}

// ---- progression (the progression screen, Train's "Not yet") ------------------------------------------------------

function progressionAnswer(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const dayType = a.dayType;
  if (!['pull', 'push', 'legs'].includes(dayType)) return refuse('dayType: pull, push or legs.');
  const planRoutine = s.one('programme', `routine.${dayType}-gbi`);
  if (!planRoutine) return refuse("The programme hasn't reached the Mac's database.");
  const meta = s.meta();
  const nowWeek = weekColumn(meta?.firstSessions?.[dayType], s.today) || 1;
  const week = a.week >= 5 ? a.week : Math.max(5, nowWeek);
  const lib = [...s.lib().values()];
  const byName = new Map(lib.map((e) => [e.name, e]));
  const progress = s.list('progression');
  const proposal = proposeWeek({ planRoutine, week, progress, meta, barKgOf: (pe) => byName.get(pe.name)?.barKg ?? null, smallestPlate: s.minPlate() });
  const saved = progress.find((d) => d.dayType === dayType && d.week === week && d.confirmedAt);
  const live = proposal.items.filter((i) => !i.skip);
  const modes = s.one('progression', 'modes') || {};
  const mode = modeOf(modes, dayType);
  const nr = normalReady({ planRoutine, history: s.history(), since: comebackStartOf(meta) });
  const kgOf = (i, v) => (i.added ? `+${k(v)} kg` : `${k(v)} kg`);
  const L = LABEL[dayType];

  if (a.action === 'show') {
    const lines = [`${L} week ${week} numbers (the app's proposal; he confirms; the 30% cap against his last load still applies on top): ${saved ? `CONFIRMED ${dayText(saved.confirmedOn || s.date(saved.confirmedAt), s.today)}` : 'waiting for his OK'}.`];
    for (const i of live) lines.push(`- ${i.name}: ${kgOf(i, saved?.exercises.find((e) => e.name === i.name)?.kg ?? i.kg)} (from ${kgOf(i, i.fromKg)}; ${i.why})`);
    const skipped = proposal.items.filter((i) => i.skip);
    if (skipped.length) lines.push(`Not proposed: ${skipped.map((i) => `${i.name} (${i.why.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`);
    lines.push(`Version: ${mode === 'normal' ? 'Normal' : 'Getting Back Into'}${modes[dayType]?.on ? ` since ${dayText(modes[dayType].on, s.today)}` : ''}. Ready for Normal: ${nr.ready ? 'yes' : 'not yet'} (${nr.lifts.map((l) => `${l.name} week 4 ${k(l.week4Kg)} kg, last ${l.recent.map((x) => k(x.kg)).join(', ') || 'none'}${l.ok ? ' ✓' : ''}`).join('; ')}).`);
    return { text: lines.join('\n'), summary: `${L} week ${week}` };
  }
  if (a.action === 'confirm_week') {
    const edits = {};
    for (const i of live) { const v = saved?.exercises.find((e) => e.name === i.name)?.kg; if (v != null) edits[i.name] = v; }
    for (const x of a.kg || []) {
      const { item } = findByName(live, x.exercise);
      if (!item) return refuse(`No "${x.exercise}" in ${L} week ${week}: ${sayList(live.map((i) => i.name))}.`);
      if (!(x.kg > 0)) return refuse(`${item.name}: a weight over 0.`);
      edits[item.name] = x.kg;
    }
    if (live.some((i) => (edits[i.name] ?? i.kg) == null)) return refuse('Every exercise needs a weight: give the missing ones in kg.');
    const doc = confirmWeek(proposal, edits, { now: s.now, today: s.today });
    put(s, 'progression', progressId(dayType, week), { ...doc, by: 'coach', ...(a.said ? { said: clip(a.said) } : {}) });
    return wrote(`${L} week ${week} confirmed: ${doc.exercises.map((e) => `${e.name} ${kgOf(live.find((i) => i.name === e.name), e.kg)}${e.edited ? ' (his number)' : ''}`).join('; ')}. The 30% cap against his last load still applies at Start.${mode === 'normal' ? ` (${L} runs the Normal programme now, so these apply if he goes back to Getting Back Into.)` : ''}`, `${L} week ${week} confirmed`);
  }
  if (a.action === 'decline_week') {
    return { text: `Nothing saved: ${L} week ${week} stays unconfirmed, so targets stay on the last confirmed numbers (the week 4 table until a week is confirmed). Train keeps asking for his OK.`, summary: `${L} week ${week} not confirmed` };
  }
  const setMode = (next) => put(s, 'progression', 'modes', { ...modes, [dayType]: { mode: next, on: s.today, ...(next === 'normal' ? { ready: nr.ready } : {}), by: 'coach' } });
  if (a.action === 'normal') {
    if (mode === 'normal') return refuse(`${L} already runs the Normal programme${modes[dayType]?.on ? ` (since ${dayText(modes[dayType].on, s.today)})` : ''}.`);
    setMode('normal');
    return wrote(`${L} runs its Normal programme from now on; working loads come from his last session, the 30% cap on top.${nr.ready ? '' : ' (Not every main lift was at its week 4 number for 2 sessions: his call.)'}`, `${L} normal`);
  }
  if (a.action === 'comeback') {
    if (mode !== 'normal') return refuse(`${L} is on Getting Back Into already.`);
    setMode('comeback');
    return wrote(`${L} is back on Getting Back Into.`, `${L} comeback`);
  }
  if (a.action === 'not_yet') {
    if (mode === 'normal') return refuse(`${L} already runs the Normal programme.`);
    const latest = nr.lifts.flatMap((l) => l.recent.map((x) => x.date)).sort().pop();
    if (!latest) return refuse(`No ${L} sessions to judge the switch on yet; nothing is being asked.`);
    put(s, 'progression', 'modes', { ...modes, [dayType]: { ...(modes[dayType] || { mode: 'comeback' }), notYet: latest } });
    return wrote(`Not yet: ${L} stays on Getting Back Into; the switch is suggested again after his next ${L}.`, `${L} normal: not yet`);
  }
  return refuse('action: show, confirm_week, decline_week, normal, comeback or not_yet.');
}

// ---- the rotation and its week columns ---------------------------------------------------------------------------

function rotationSet(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const rot = s.rotation();
  const days = s.days();
  const meta = s.meta();
  const wk = (t, date) => weekColumn(meta?.firstSessions?.[t], date);
  const nextText = (r) => `${LABEL[r.next.dayType]}, ${dayText(r.next.date, s.today)}${wk(r.next.dayType, r.next.date) ? `, week ${wk(r.next.dayType, r.next.date)} column` : ''}`;
  if (a.action === 'show') {
    const c = chosenNext(days, s.last(), rot.next.date);
    return { text: `Last: ${s.last() ? `${LABEL[s.last().dayType]}, ${dayText(s.last().date, s.today)}` : 'none'}. Next: ${nextText(rot)}${c ? ` (his choice of ${dayText(c.date, s.today)})` : ''}. Week columns today: ${['pull', 'push', 'legs'].map((t) => `${LABEL[t]} ${wk(t, s.today) ?? '-'}`).join(', ')}.`, summary: 'rotation' };
  }
  if (a.action === 'next') {
    if (!inRotation(a.dayType)) return refuse('dayType: pull, push or legs.');
    if (s.active()) return refuse('A workout is in progress; the next day type is set once it is finished.');
    const date = a.date || rot.next.date;
    if (date < s.today) return refuse('That day has passed.');
    if (rot.today.kind === 'done' && date === s.today) return refuse(`He trained today; the next session is ${dayText(rot.next.date, s.today)}.`);
    if (rot.next.dayType === a.dayType && date === rot.next.date) return { text: `${LABEL[a.dayType]} is already next (${nextText(rot)}).`, summary: 'already next' };
    put(s, 'days', date, withNextType(days[date], date, a.dayType, { at: s.now, by: 'coach', said: a.said }));
    const now = rotationDay({ last: s.last(), today: s.today, days: { ...days, [date]: withNextType(days[date], date, a.dayType) } });
    const later = date > now.next.date ? ` It takes over from ${dayText(date, s.today)}; before that the rotation runs as usual (next: ${nextText(now)}).` : '';
    return wrote(`${later ? `${LABEL[a.dayType]} from ${dayText(date, s.today)}.${later}` : `Next session: ${nextText(now)}.`} After it the rotation carries on from ${LABEL[a.dayType]} as usual (3 on, 1 off).`, `next ${a.dayType}`);
  }
  if (a.action === 'clear') {
    const last = s.last();
    const pending = Object.values(days).filter((d) => d?.nextType && (!last || d.date > last.date));
    if (!pending.length) return refuse('No day type he chose is waiting; the rotation runs from his last session.');
    for (const d of pending) put(s, 'days', d.date, withNextType(d, d.date, null));
    const cleared = { ...days }; for (const d of pending) cleared[d.date] = withNextType(d, d.date, null);
    return wrote(`His choice is taken back: the rotation runs from his last session again. Next: ${nextText(rotationDay({ last, today: s.today, days: cleared }))}.`, 'next type cleared');
  }
  if (a.action === 'week') {
    if (!inRotation(a.dayType)) return refuse('dayType: pull, push or legs.');
    const fs = meta?.firstSessions || {};
    const first = fs[a.dayType];
    const cur = wk(a.dayType, s.today);
    if (!first || !cur) return refuse(`${LABEL[a.dayType]} has no week column yet (no first session date in the programme).`);
    if (!(a.week >= 1)) return refuse('week: the column he wants, 1 or more.');
    if (a.week === cur) return { text: `${LABEL[a.dayType]} is on week ${cur} already.`, summary: 'same week' };
    // Week 1 starts on the first session of the day type and moves up every 7 days (decision 5): moving the column
    // moves that date by whole weeks, so the weekday a week starts on stays.
    const moved = addDays(first, 7 * (cur - a.week));
    const layoff = meta?.lastSessionBeforeLayoff?.date;
    if (layoff && moved <= layoff) return refuse(`Week ${a.week} for ${LABEL[a.dayType]} would start ${dayText(moved, s.today)}, before the comeback (his last session before the layoff was ${dayText(layoff, s.today)}). The highest is week ${maxWeek(first, cur, layoff)}.`);
    // The comeback start (the earliest first session) stays where it was: "since the comeback" keeps meaning the same.
    const next = {
      ...meta,
      firstSessions: { ...fs, [a.dayType]: moved, ...(fs.comeback ? {} : { comeback: comebackStartOf(meta) }) },
      changes: [...(meta.changes || []), { date: s.today, what: `${LABEL[a.dayType]} week column moved from ${cur} to ${a.week} (week 1 from ${moved} instead of ${first}).`, source: `the coach, on his words${a.said ? `: "${clip(a.said)}"` : ''}` }],
    };
    put(s, 'programme', 'meta', next);
    return wrote(`${LABEL[a.dayType]} is on week ${a.week} now (was ${cur}); week ${a.week + 1} from ${dayText(addDays(moved, 7 * a.week), s.today)}. Targets at Start use that column; the 30% cap against his last load still applies on top.${a.week >= 5 ? ` Week ${a.week} numbers need his OK (progression_answer).` : ''}`, `${a.dayType} week ${a.week}`);
  }
  return refuse('action: show, next, clear or week.');
}

/** The highest week column whose week 1 still starts after his last session before the layoff. */
function maxWeek(first, cur, layoff) {
  let w = cur;
  while (addDays(first, 7 * (cur - w - 1)) > layoff) w++;
  return w;
}

// ---- rest days on other dates ---------------------------------------------------------------------------------------

async function planDay(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const date = a.date;
  if (!date) return refuse('Which date (YYYY-MM-DD)?');
  // Today goes through schedule (it also moves today's session time and says the holds).
  if (date === s.today) return WRITE_TOOLS.find((t) => t.name === 'schedule').run({ action: a.action === 'rest' ? 'rest_today' : 'undo_rest' }, ctx);
  const days = s.days();
  const doc = days[date];
  const trained = s.list('sessions').some((x) => x.status === 'done' && x.kind !== 'holds' && inRotation(x.dayType) && s.date(x.startedAt) === date);
  const D = dayText(date, s.today);
  if (a.action === 'rest') {
    if (doc?.rest) return refuse(`${D} is already a rest day.`);
    if (date < s.today && trained) return refuse(`He trained on ${D}; a day with a session can't be a rest day.`);
    const nextDays = { ...days, [date]: withRest(doc, date, 'added', s.now) };
    put(s, 'days', date, nextDays[date]);
    if (date < s.today) return wrote(`${D} is marked a rest day (in the past: the rotation still counts from his last session).`, `rest ${date}`);
    const before = s.rotation();
    const after = rotationDay({ last: s.last(), today: s.today, days: nextDays });
    // His session time on that day moves with the session, as with a rest day today.
    const hm = doc?.sessionTime;
    if (hm && date === before.next.date && after.next.date !== date && !days[after.next.date]?.sessionTime) put(s, 'days', after.next.date, withTime(days[after.next.date], after.next.date, hm, s.now));
    return wrote(`${D} is a rest day (his rule: skip it, carry on with the next day type; no make-up). ${date === before.next.date ? `Next session: ${LABEL[after.next.dayType]}, ${dayText(after.next.date, s.today)}${hm ? ` at ${formatHm(hm)}` : ''}.` : `The next session stays ${LABEL[after.next.dayType]}, ${dayText(after.next.date, s.today)}.`}`, `rest ${date}`);
  }
  if (a.action === 'undo_rest') {
    if (!doc?.rest) return refuse(`${D} has no rest day he added${date < s.today ? '' : ' (the rotation\'s own rest after three days in a row is not a record and can\'t be undone)'}.`);
    const nextDays = { ...days, [date]: withRest(doc, date, null, s.now) };
    put(s, 'days', date, nextDays[date]);
    if (date < s.today) return wrote(`${D} is no longer marked a rest day.`, `rest undone ${date}`);
    const after = rotationDay({ last: s.last(), today: s.today, days: nextDays });
    return wrote(`Rest day on ${D} taken back. Next session: ${LABEL[after.next.dayType]}, ${dayText(after.next.date, s.today)}.`, `rest undone ${date}`);
  }
  return refuse('action: rest or undo_rest.');
}

// ---- tendon holds (the holds screen) --------------------------------------------------------------------------------

const holdLoad = (h) => (h.loadKg != null ? `${k(h.loadKg)} kg total` : h.load || 'bodyweight');
const holdText = (h) => `${h.exercise}, ${holdLoad(h)}, ${h.sets ?? 3} × ${h.seconds ?? 30} s${h.where ? `, at ${h.where}` : ''}${(h.timing || []).length ? `, ${h.timing.join(' and ')}` : h.when ? `, ${h.when}` : ''}`;
const FIXED = 'His pain limit and the phase rules stay as they are.';

function tendonHold(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const areas = s.list('tendons').filter((x) => x.kind === 'area');
  const findArea = (q) => {
    const { item, ambiguous } = findByName(areas, q || '', (x) => x.label, (x) => [x.id]);
    return item ? { area: item } : { error: ambiguous.length ? `Which area: ${sayList(ambiguous)}?` : `Which area: ${sayList(areas.map((x) => x.label))}?` };
  };
  const saveArea = (area) => put(s, 'tendons', `area.${area.id}`, area);
  const holdIn = (area, q) => {
    const holds = area.holds || [];
    if (!holds.length) return { error: `${area.label} has no hold set up.` };
    if (!q) return holds.length === 1 ? { i: 0 } : { error: `Which ${area.label} hold: ${sayList(holds.map((h, i) => `${i + 1} = ${h.exercise}`))}?` };
    if (/^\d+$/.test(String(q))) return holds[Number(q) - 1] ? { i: Number(q) - 1 } : { error: `${area.label} has ${plural(holds.length, 'hold')}.` };
    const { item, ambiguous } = findByName(holds, q, (h) => h.exercise);
    return item ? { i: holds.indexOf(item) } : { error: ambiguous.length ? `Which one: ${sayList(ambiguous)}?` : `${area.label} has no hold "${q}": ${sayList(holds.map((h) => h.exercise))}.` };
  };
  const stamp = { by: 'coach', on: s.today, ...(a.said ? { said: clip(a.said) } : {}) };

  if (a.action === 'log_round') {
    let area = null; let hold = null;
    if (a.area) { const f = findArea(a.area); if (f.error) return refuse(f.error); area = f.area; }
    if (a.hold) {
      const pool = (area ? [area] : areas).flatMap((ar) => (ar.holds || []).map((h) => ({ ar, h })));
      const { item } = findByName(pool, a.hold, (x) => x.h.exercise);
      if (item) { area = item.ar; hold = item.h; } else if (area) hold = { exercise: clip(a.hold, 80) }; else return refuse(`No hold called "${a.hold}" in his tendon areas. Which area is it for: ${sayList(areas.map((x) => x.label))}?`);
    } else if (area) { const h = holdIn(area, null); if (h.error) return refuse(h.error); hold = area.holds[h.i]; } else return refuse('Which area and hold?');
    const date = a.date || s.today;
    if (date > s.today) return refuse('That day is still to come; log a round once it is done.');
    if (date < s.today && !a.time) return refuse(`What time on ${dayText(date, s.today)}?`);
    const sets = a.sets ?? hold.sets ?? 3;
    const secs = a.seconds ?? hold.seconds ?? 30;
    const kgVal = a.kg !== undefined ? a.kg : hold.loadKg ?? null;
    const sides = hold.sides?.length > 1 ? hold.sides : null;
    const restS = s.settings().rest.holdS ?? 120;
    const total = sets * secs * (sides ? sides.length : 1) + Math.max(0, sets - 1) * restS;
    const startedAt = a.time ? zonedTime(date, a.time, s.tz) : s.now - total * 1000;
    if (startedAt > s.now) return refuse('That time is still to come.');
    const key = newKey();
    const session = {
      id: newId('session'), kind: 'holds', area: area.id, title: `${area.label} holds`, startedAt, endedAt: Math.min(s.now, startedAt + total * 1000), pausedMs: 0, pausedAt: null,
      status: 'done', round: Number(hmOf(new Date(startedAt), s.tz).slice(0, 2)) < 12 ? 'morning' : 'evening', exercises: [{ key, exerciseId: null, name: hold.exercise, type: kgVal != null ? 'weight_duration' : 'duration' }], source: 'training-hq', note: clip(a.note, 300), by: 'coach',
    };
    // One set per hold (one per arm for a hold with sides, in order), as the hold timer saves them.
    const per = sides ? sides.length : 1;
    for (let i = 0; i < sets; i++) {
      for (let j = 0; j < per; j++) {
        const doneAt = Math.min(s.now, startedAt + (i * (secs * per + restS) + (j + 1) * secs) * 1000);
        const set = { id: newSetId(), sessionId: session.id, exKey: key, order: i + 1 + (sides ? j / 10 : 0), type: 'hold', kg: kgVal, durationS: secs, done: true, doneAt, pain: num(a.pain) ?? null, shaking: a.shaking || null, note: sides ? sides[j] : '' };
        put(s, 'sets', set.id, set);
      }
    }
    put(s, 'sessions', session.id, session);
    const over = a.pain != null && !painOk(a.pain) ? ` Pain ${a.pain}/10 is over his 3-4 limit. His note: next time less weight or push less hard.` : '';
    const due = date === s.today ? ` ${holdsDueText(snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() }))}` : '';
    return wrote(`Logged ${area.label}: ${hold.exercise}, ${sets} × ${secs} s${sides ? ' per arm' : ''}${kgVal != null ? ` at ${k(kgVal)} kg` : ''}, ${dayText(date, s.today)} at ${timeText(startedAt, s.tz)}.${over}${due}`, `${area.label} round`);
  }

  if (a.action === 'add_area') {
    const name = clip(a.label || a.area, 60);
    if (!name) return refuse('The area\'s name, as he says it (label).');
    const id = slug(name);
    const twin = areas.find((x) => x.id === id || x.label.toLowerCase() === name.toLowerCase());
    if (twin) return refuse(`${twin.label} is already a tendon area.`);
    const holds = a.exercise ? [{ exercise: clip(a.exercise, 80), type: 'hold', ...(a.kg != null ? { loadKg: a.kg } : {}), sets: a.sets ?? 3, seconds: a.seconds ?? 30, ...(a.where ? { where: a.where } : {}), ...(a.timing?.length ? { timing: a.timing } : {}), source: 'his words to the coach', ...stamp }] : [];
    saveArea({ kind: 'area', id, label: name, phase: 'unknown', holds, reported: clip(a.note, 300), reportedSource: `his words to the coach, ${s.today}`, addedBy: stamp });
    return wrote(`${name} is a tendon area now${holds.length ? `, hold: ${holdText(holds[0])}` : ', no hold yet'}. Its phase isn't set: ask how it feels, then tendon_phase on his answer. Which exercises load it is set on the readiness table screen. ${FIXED}`, `+ area ${name}`);
  }

  const f = findArea(a.area);
  if (f.error) return refuse(f.error);
  const area = f.area;

  if (a.action === 'remove_area') {
    if (!String(a.said || '').trim()) return refuse(`Removing ${area.label} needs his explicit words: pass them in said. If he didn't say to remove it, ask him.`);
    const plan = area.phasePlan && !area.phasePlan.done ? area.phasePlan : null;
    if (plan?.reminderId) { const r = s.one('coach-reminders', plan.reminderId); if (r && !r.cancelledAt && !r.firedAt) put(s, 'coach-reminders', r.id, { ...r, cancelledAt: s.now }); }
    del(s, 'tendons', `area.${area.id}`);
    return wrote(`${area.label} is no longer a tendon area: no holds or reminders for it. Past rounds stay in his history.`, `- area ${area.label}`);
  }
  if (a.action === 'add_hold') {
    if (!a.exercise) return refuse('Which hold, in his words (exercise)?');
    const h = { exercise: clip(a.exercise, 80), type: 'hold', ...(a.kg != null ? { loadKg: a.kg } : {}), sets: a.sets ?? 3, seconds: a.seconds ?? 30, ...(a.where ? { where: a.where } : {}), ...(a.timing?.length ? { timing: a.timing } : {}), source: 'his words to the coach', ...stamp };
    saveArea({ ...area, holds: [...(area.holds || []), h] });
    return wrote(`${area.label}: added ${holdText(h)}. ${FIXED}`, `${area.label} + hold`);
  }
  const hi = holdIn(area, a.hold);
  if (hi.error) return refuse(hi.error);
  const old = area.holds[hi.i];

  if (a.action === 'remove_hold') {
    if (!String(a.said || '').trim()) return refuse(`Removing ${old.exercise} from ${area.label} needs his explicit words: pass them in said.`);
    saveArea({ ...area, holds: area.holds.filter((_, i) => i !== hi.i) });
    return wrote(`${area.label}: ${old.exercise} is no longer one of its holds.${area.holds.length === 1 ? ' It has no hold now.' : ''} ${FIXED}`, `${area.label} - hold`);
  }
  if (a.action === 'use_hold') {
    if (!a.exercise) return refuse('Which hold he uses instead, in his words (exercise)?');
    if (old.path) return refuse(`${old.exercise} moves along his hold path: hold_path changes its stage.`);
    const { loadKg, load, loadNote, loadKgLogged, loadSource, note, ...keep } = old;
    const h = { ...keep, exercise: clip(a.exercise, 80), ...(a.kg != null ? { loadKg: a.kg } : {}), ...(a.sets ? { sets: a.sets } : {}), ...(a.seconds ? { seconds: a.seconds } : {}), ...(a.where ? { where: a.where } : {}), ...(a.timing?.length ? { timing: a.timing, when: null } : {}), replaced: { exercise: old.exercise, ...stamp } };
    saveArea({ ...area, holds: area.holds.map((x, i) => (i === hi.i ? h : x)) });
    return wrote(`${area.label}: ${h.exercise} instead of ${old.exercise}: ${holdText(h)}.${a.kg == null ? ' No load recorded for it yet: ask him what he uses.' : ''} ${FIXED}`, `${area.label}: ${h.exercise}`);
  }
  if (a.action === 'set_hold') {
    if (a.kg === undefined && !a.clear_kg && a.sets == null && a.seconds == null && !a.where && !a.timing) return refuse('What to change: kg (TOTAL), sets, seconds, where or timing.');
    if (a.seconds != null && !(a.seconds >= 10 && a.seconds <= 300)) return refuse('Hold length: 10 to 300 seconds (his note: at least 30).');
    let h = { ...old };
    if (a.kg !== undefined || a.clear_kg) { const { load, loadNote, loadKgLogged, loadSource, ...rest } = h; h = { ...rest, loadKg: a.clear_kg ? null : a.kg }; }
    if (a.sets != null) h.sets = a.sets;
    if (a.seconds != null) h.seconds = a.seconds;
    if (a.where) h.where = a.where;
    if (a.timing) h = { ...h, timing: a.timing, when: null };
    h.edited = stamp;
    saveArea({ ...area, holds: area.holds.map((x, i) => (i === hi.i ? h : x)) });
    return wrote(`${area.label}: ${holdText(h)} (was ${holdText(old)}). ${FIXED}`, `${area.label}: ${h.exercise}`);
  }
  return refuse('action: log_round, set_hold, use_hold, add_hold, remove_hold, add_area or remove_area.');
}

// ---- bodyweight for pull-ups (Settings, "Bodyweight today") -------------------------------------------------------

function bodyweight(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const raw = s.one('settings', 'main') || {};
  const cur = () => currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), manual: raw.bodyweight, now: s.now });
  const FROM = { health: 'Apple Health', evolt: 'the Evolt', scale: 'a weigh-in', manual: 'set by hand' };
  if (a.action === 'show') {
    const c = cur();
    const anyWeigh = currentBodyweight({ healthDocs: s.list('health'), measurements: s.list('measurements'), now: s.now, maxDays: 36500 });
    return { text: c ? `Pull-ups and other bodyweight exercises use ${k(c.kg)} kg (${FROM[c.from] || c.from}, ${whenText(c.at, s.tz, s.today)}).${anyWeigh && anyWeigh.at !== c.at && c.from === 'manual' ? ` Newest weigh-in: ${k(anyWeigh.kg)} kg, ${whenText(anyWeigh.at, s.tz, s.today)}.` : ''}` : `No bodyweight in the last 30 days${anyWeigh ? ` (newest weigh-in ${k(anyWeigh.kg)} kg, ${whenText(anyWeigh.at, s.tz, s.today)}, too old)` : ''}: pull-ups count only the added weight until he gives one.`, summary: 'bodyweight' };
  }
  if (a.action === 'set') {
    if (!(a.kg > 30 && a.kg < 250)) return refuse('Bodyweight must be between 30 and 250 kg.');
    put(s, 'settings', 'main', { ...raw, id: 'main', bodyweight: { kg: a.kg, at: s.now } });
    const active = s.active();
    if (active) put(s, 'sessions', active.id, { ...active, bodyweightKg: a.kg });
    return wrote(`Bodyweight ${k(a.kg)} kg from now on for pull-ups and other bodyweight exercises (volume and the 30% guard)${active ? `, ${active.title} in progress included` : ''}. A newer Apple Health or Evolt weigh-in takes over by itself.`, `bodyweight ${k(a.kg)} kg`);
  }
  if (a.action === 'clear') {
    if (raw.bodyweight?.kg == null) return refuse('No bodyweight is set by hand.');
    put(s, 'settings', 'main', { ...raw, id: 'main', bodyweight: { kg: null, at: null } });
    const c = cur();
    return wrote(`Hand-set bodyweight cleared: ${c && c.from !== 'manual' ? `${k(c.kg)} kg from ${FROM[c.from] || c.from} (${whenText(c.at, s.tz, s.today)}) is used` : 'no weigh-in in the last 30 days, so pull-ups count only the added weight'}.`, 'bodyweight cleared');
  }
  return refuse('action: show, set or clear.');
}

// ---- the readiness table: his OK, as it is ----------------------------------------------------------------------

function readinessConfirm(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const table = s.one('tendons', 'readiness');
  if (!table) return refuse("The readiness table hasn't reached the Mac yet.");
  if (table.status === 'confirmed') return refuse(`His readiness table is already confirmed (${dayText(table.confirmedOn, s.today)}). Changes to it are his, on its screen: open_screen readiness_table.`);
  // Exactly as the screen's Confirm with nothing edited: the same levels, rules and "go lighter" amounts.
  const wa = table.workingArea || {};
  const workingArea = { ...wa, ...Object.fromEntries(['pull', 'push', 'legs'].map((d) => [d, ['L', 'B'].filter((x) => (wa[d] || []).includes(x))])) };
  put(s, 'tendons', 'readiness', { ...table, params: paramsOf(table), workingArea, status: 'confirmed', confirmedOn: s.today, changes: [...(table.changes || []), { date: s.today, what: `Confirmed by him through the coach, as it was${a.said ? `: "${clip(a.said)}"` : ''}.` }] });
  for (const area of askedAreas(s.list('tendons'))) put(s, 'tendons', `area.${area.id}`, { ...area, loadsArea: { ...(area.loadsArea || {}), exercises: area.loadsArea?.exercises || [], draft: false, confirmedOn: s.today } });
  return wrote(`Readiness table confirmed as it is, ${dayText(s.today, s.today)}: the check-in uses it from now on. Edits to it are his, on its screen (open_screen readiness_table).`, 'readiness table confirmed');
}

// ---- the tools ------------------------------------------------------------------------------------------------------

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const SETS_ARGS = {
  sets: { type: 'integer', minimum: 1, maximum: 10, description: 'how many working sets' },
  set: { type: 'integer', minimum: 1, description: 'change only this working set (1 = first after warm-ups); else all' },
  reps_min: { type: 'integer', minimum: 1, maximum: 100 }, reps_max: { type: 'integer', minimum: 1, maximum: 100 },
  kg: { type: 'number', minimum: 0, description: 'TOTAL kg including the bar (added kg for weighted pull-ups)' },
  clear_kg: { type: 'boolean' },
  seconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'for timed sets and holds' },
  set_type: { type: 'string', enum: ['normal', 'failure', 'dropset', 'hold'] },
};

export const PLAN_TOOLS = [
  write('routine_edit', 'Edit a routine', `Change one of his routines the way the routine screen does. ${ONLY_HIS} routine = its name ("Flexibility · Legs") or a day type (pull = the routine Train starts for it). show = its exercises and sets. add = an exercise from his library (place: position, after or before; default last) with optional sets; remove = take one out (ONLY on his explicit words, pass them in said); swap = replace one with another (with), keeping its sets; move = a new place; sets = change sets, reps, kg (TOTAL), seconds for timed and hold sets ("holds 30 s -> 45 s": seconds 45), one set (set) or all; an exercise that follows The Comeback needs detach: true and his word to get its own sets; rest = its rest (rest_seconds, or default_rest); note = its note on the card (added to the one there; replace: true to replace); warmup on/off = calculated warm-up sets; superset with another (on: false takes it out); follow_last on/off = weights follow his last session or start from the routine. Never weakens the 30% cap: it still applies at Start.`,
    obj({ action: { type: 'string', enum: ['show', 'add', 'remove', 'swap', 'move', 'sets', 'rest', 'note', 'warmup', 'superset', 'follow_last'] }, routine: { type: 'string' }, exercise: { type: 'string' }, with: { type: 'string' }, ...PLACE, ...SETS_ARGS, detach: { type: 'boolean' }, rest_seconds: { type: 'integer', enum: REST_CHOICES }, default_rest: { type: 'boolean' }, note: { type: 'string' }, replace: { type: 'boolean' }, on: { type: 'boolean' }, again: { type: 'boolean', description: 'add it a second time when it is already in the routine' }, said: SAID }, ['action', 'routine']), routineEdit),
  write('exercise_library', 'Exercise library', `His exercise library, as the library and exercise screens do. ${ONLY_HIS} find = search it (read only). create = a custom exercise (name, type, equipment, primary and secondary muscles), as Library > Custom exercise. note = the exercise's own pinned note that shows on its card every session (machine settings, "bench setting 7"; added to the note there, replace: true to replace it). how_to = his own cues. bar = which bar its loads include (a bar's label or kg, none, or default); loads stay TOTAL kg. edit = name, type, muscles, equipment of one of his own exercises (name and type lock once it has logged sets). delete = a custom exercise with no logged sets and in no routine, only on his explicit words (said).`,
    obj({ action: { type: 'string', enum: ['find', 'create', 'edit', 'note', 'how_to', 'bar', 'delete'] }, exercise: { type: 'string', description: 'the exercise as he calls it' }, name: { type: 'string', description: 'name for a new exercise, or the new name' }, type: { type: 'string', enum: Object.keys(TYPES) }, equipment: { type: 'string', enum: EQUIPMENT }, primary: { type: 'string', enum: MUSCLES }, secondary: { type: 'array', items: { type: 'string', enum: MUSCLES } }, text: { type: 'string' }, replace: { type: 'boolean' }, bar: { type: 'string' }, said: SAID }, ['action']), exerciseLibrary),
  write('progression_answer', 'Progression answer', `Week 5+ numbers and the switch to the Normal programme, exactly as the progression screen's buttons (and Train's "Not yet") record them. He decides; you only record his answer, never decide or nudge. show = the app's proposal for dayType's week (default this week, 5 or later), whether it is confirmed, and whether the main lifts are ready for Normal (read only). confirm_week = his OK for that week, with any numbers he changed (kg: [{exercise, kg}], TOTAL kg; added kg for weighted pull-ups); decline_week = he doesn't confirm: nothing is saved and targets stay on the last confirmed numbers; normal = he switches that day type to its Normal programme; comeback = back to Getting Back Into; not_yet = he declines the suggested switch for now (asked again after his next session of that day type). The 30% cap still applies on top of every number.`,
    obj({ action: { type: 'string', enum: ['show', 'confirm_week', 'decline_week', 'normal', 'comeback', 'not_yet'] }, dayType: DAY, week: { type: 'integer', minimum: 5, maximum: 52 }, kg: { type: 'array', maxItems: 20, items: obj({ exercise: { type: 'string' }, kg: { type: 'number', minimum: 0 } }, ['exercise', 'kg']) }, said: SAID }, ['action', 'dayType']), progressionAnswer),
  write('rotation_set', 'Rotation', `The rotation (Pull, Push, Legs, 3 on and 1 off). ${ONLY_HIS} show = last session, next session and the week columns (read only). next = the day type of his next session ("Legs next, not Pull"), from date (default the next training day); it holds until he does a session, then the rotation carries on from that day type as always. clear = take that choice back. week = put a day type on another week column (week), moving its week 1 by whole weeks; targets at Start use that column, the 30% cap still on top; never before the comeback.`,
    obj({ action: { type: 'string', enum: ['show', 'next', 'clear', 'week'] }, dayType: DAY, date: ISO, week: { type: 'integer', minimum: 1, maximum: 52 }, said: SAID }, ['action']), rotationSet),
  write('plan_day', 'Rest day on a date', `A rest day he plans on a coming date, or marks on a past day, or takes back (undo_rest). ${ONLY_HIS} His rule: a rest day skips that day and carries on with the next day type, no make-up; a session time set on the next training day moves with the session. Today goes through schedule's rest_today / undo_rest. A past day he trained on can't be a rest day.`,
    obj({ action: { type: 'string', enum: ['rest', 'undo_rest'] }, date: ISO, said: SAID }, ['action', 'date']), planDay),
  write('tendon_hold', 'Tendon holds', `His tendon holds, as the holds screen does. ${ONLY_HIS} Never suggest a hold, a load or a dose. log_round = a round he did outside a session (at home, say), the way the hold timer saves it: area, hold (its name; one not set up for the area is logged under his words), sets, seconds, kg (TOTAL; default the hold's load), time (HH:MM; default just now), date (default today), pain 0-10 and shaking if he says. set_hold = change a hold's kg, sets, seconds (10-300), where (gym/home) or timing. use_hold = the area uses another hold (exercise) in place of one; add_hold = one more hold for an area; remove_hold = take one off (his explicit words in said). add_area = a new tendon area (label; optionally its first hold), phase not set (tendon_phase on his answer); remove_area = only on his explicit words (said). His tendon pain limit and phase rules are never changed here.`,
    obj({ action: { type: 'string', enum: ['log_round', 'set_hold', 'use_hold', 'add_hold', 'remove_hold', 'add_area', 'remove_area'] }, area: { type: 'string' }, label: { type: 'string' }, hold: { type: 'string', description: 'which hold: its name, or its number in the area (1 = first)' }, exercise: { type: 'string', description: 'the hold exercise he names' }, sets: { type: 'integer', minimum: 1, maximum: 10 }, seconds: { type: 'integer', minimum: 5, maximum: 600 }, kg: { type: 'number', minimum: 0, description: 'TOTAL kg' }, clear_kg: { type: 'boolean' }, where: { type: 'string', enum: ['gym', 'home'] }, timing: TIMING, time: HM, date: ISO, pain: { type: 'number', minimum: 0, maximum: 10 }, shaking: { type: 'string', enum: ['none', 'some', 'a lot'] }, note: { type: 'string' }, said: SAID }, ['action']), tendonHold),
  write('bodyweight', 'Bodyweight for pull-ups', `The bodyweight pull-ups and other bodyweight exercises count (volume and the 30% guard), as Settings > Bodyweight and the workout's "Bodyweight today" set it. ${ONLY_HIS} show = what is used now and where it is from (read only). set = his number (kg) when Apple Health is stale or wrong; it also goes on a workout in progress; a newer Apple Health or Evolt weigh-in takes over by itself. clear = drop the hand-set number. A weigh-in he reads off a scale is log_weight, not this.`,
    obj({ action: { type: 'string', enum: ['show', 'set', 'clear'] }, kg: { type: 'number', minimum: 30, maximum: 250 }, said: SAID }, ['action']), bodyweight),
  write('readiness_confirm', 'Confirm the readiness table', `Record his OK of his readiness table exactly as it is, the way its screen's Confirm does with nothing edited. Only when he says he confirms it (said = his words). It never changes the table's levels, rules or "go lighter" amounts: those are a safety rule and he edits them himself on its screen (open_screen readiness_table).`,
    obj({ said: SAID }), readinessConfirm),
];
