// The coach builds his training itself (Tue 11/10). His words: "you should be able to build the routines and
// everything and modify the app as much as you can. Do not always rely on the Mac... So you can form splits, workouts,
// modify". Until then the coach could only edit routines that existed (routine_edit), so an Upper A / Upper B split had
// to be sent to the Mac. routine_build makes, copies, renames and deletes routines (from his library, with sets, reps,
// kg, holds, supersets, folders, the day type each starts); split_plan makes and changes splits (day types, their order,
// rest days, which routine each starts, what each covers for holds, neck and the check-in, a block with start and end
// that goes back or asks him) and programme-wide working sets. Each only on his words. Nothing here touches a fixed
// rule: the 30% cap still applies at Start to every number, working sets only ever cap (never add), the readiness
// table, his tendon pain limit and phase rules are never written here, and nothing here touches the sauna.
import { snapshot, dayText, findByName, wrote, refuse, plural } from './shared.mjs';
import { put, del } from './tools-write.mjs';
import { findRoutine, patchSets, setsText, rotationSet, baseOf, copyNote } from './tools-plan.mjs';
import { addExercises, duplicateRoutine, newRoutine, newId } from '../../app/js/lib/routines.js';
import { holdBase, holdName } from '../../app/js/lib/hold-names.js';
import { REST_CHOICES } from '../../app/js/lib/settings.js';
import { LABEL, ROTATION, addDays, rotationDay, useBlock, normBlock, activeBlock, cycleText } from '../../app/js/lib/rotation.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const SAID = { type: 'string', description: 'his words, as he said them' };
const COVERS = { type: 'array', items: { type: 'string', enum: ROTATION }, description: 'what of Pull, Push, Legs the day holds: its tendon holds, neck place and check-in areas follow those days' };
const FIXED = ['pull', 'push', 'legs', 'neck'];
const ONLY_HIS = 'Only when he tells you to (his words), never on your own idea.';
const clip = (t, n = 80) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const sayList = (xs) => xs.join('; ');
const typeId = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** The routine Train starts for a day type (the newest Normal/Comeback choice for Pull, Push, Legs; else the first with it). */
const routineOf = (s, t) => (t ? findRoutine(s, t).r || null : null);
const routinesOfType = (s, t) => s.list('routines').filter((r) => r.dayType === t);

// ---- exercises for a routine ----------------------------------------------------------------------------------------

const SET_FIELDS = ['sets', 'reps_min', 'reps_max', 'kg', 'seconds', 'set_type'];
const EXERCISE = obj({
  exercise: { type: 'string', description: 'as in his library; a tendon hold as "<lift> · Hold" (or hold: true)' },
  hold: { type: 'boolean', description: 'a tendon hold of that lift: hold sets of seconds at kg (default his hold load)' },
  sets: { type: 'integer', minimum: 1, maximum: 10 }, reps_min: { type: 'integer', minimum: 1, maximum: 100 }, reps_max: { type: 'integer', minimum: 1, maximum: 100 },
  kg: { type: 'number', minimum: 0, description: 'TOTAL kg including the bar' }, seconds: { type: 'integer', minimum: 1, maximum: 3600 },
  set_type: { type: 'string', enum: ['normal', 'failure', 'dropset', 'hold'] },
  rest_seconds: { type: 'integer', enum: REST_CHOICES }, note: { type: 'string' },
  superset: { type: 'string', description: 'a label; exercises with the same label are one superset' },
  warmup: { type: 'boolean', description: 'calculated warm-up sets before the first working set' },
}, ['exercise']);

/** A tendon hold's load from his holds (tendon areas), by the lift's name. */
function holdKgOf(s, name) {
  for (const a of s.list('tendons').filter((x) => x.kind === 'area')) {
    const h = (a.holds || []).find((x) => holdBase(x.exercise).toLowerCase() === name.toLowerCase());
    if (h?.loadKg != null) return h.loadKg;
  }
  return null;
}

/** One routine entry from his words: a library exercise with its sets, a hold, or a lift that follows The Comeback. */
function entryFor(s, item, sids) {
  const lib = [...s.lib().values()];
  const isHold = !!item.hold || item.set_type === 'hold' || /·\s*hold\b|\shold$/i.test(item.exercise);
  const q = isHold ? holdBase(item.exercise) : item.exercise;
  const { item: ex, ambiguous } = findByName(lib, q);
  if (!ex) return { error: ambiguous.length ? `Which exercise for "${item.exercise}": ${sayList(ambiguous)}?` : `No exercise called "${q}" in his library (exercise_library find / create).` };
  let e = addExercises({ exercises: [] }, [ex]).exercises[0];
  if (isHold) {
    const kg = item.kg ?? holdKgOf(s, ex.name);
    const one = { type: 'hold', ...(kg != null ? { kg } : {}), durationS: item.seconds ?? 30 };
    e = { ...e, name: holdName(ex.name), role: 'tendon-hold', sets: Array.from({ length: item.sets ?? 3 }, () => ({ ...one })) };
  } else if (SET_FIELDS.some((k) => item[k] !== undefined)) {
    const p = patchSets(e, item, ex.type);
    if (p.error) return p;
    e = { ...e, sets: p.sets };
  } else {
    // A lift in The Comeback keeps following it (sets and targets from the week column at Start, under the 30% cap).
    const prog = s.list('routines').filter((r) => r.folderId === 'comeback' && ROTATION.includes(r.dayType)).flatMap((r) => r.exercises);
    const linked = prog.find((x) => x.exerciseId === ex.id && x.plan);
    if (linked) e = { ...e, plan: { ...linked.plan }, sets: [] };
  }
  if (item.rest_seconds != null) e.restSeconds = item.rest_seconds;
  if (item.note) e.notes = clip(item.note, 300);
  if (item.warmup) e.warmup = true;
  if (item.superset) e.supersetId = sids[item.superset] ||= `ss-${s.now.toString(36)}-${Object.keys(sids).length}`;
  return { e, barKg: ex.barKg ?? null };
}

function entriesFor(s, items = []) {
  const sids = {}; const out = [];
  for (const it of items) { const r = entryFor(s, it, sids); if (r.error) return { error: r.error }; out.push(r); }
  return { list: out };
}

/** The folder he named: an existing one, or a new one (made when the routine is saved). */
function folderFor(s, q, fallback = null) {
  const folders = s.list('folders');
  if (!clip(q)) return { id: fallback, f: folders.find((f) => f.id === fallback) || null };
  const { item } = findByName(folders, q, (f) => f.title, (f) => [f.id]);
  if (item) return { id: item.id, f: item };
  const f = { id: newId('folder'), title: clip(q), order: Math.max(0, ...folders.map((x) => x.order ?? 0)) + 1, createdAt: s.now, by: 'coach' };
  return { id: f.id, f, made: true };
}

/** A day type for a routine: an id of his split ("upper-a") or its name ("Upper A"); Pull, Push, Legs, Neck are fixed. */
function dayTypeFor(s, q) {
  if (q == null || q === '') return { id: undefined };
  if (String(q).toLowerCase() === 'none') return { id: null };
  const b = normBlock(s.block());
  const known = Object.entries(b?.types || {}).find(([id, t]) => id === q || t.label?.toLowerCase() === String(q).toLowerCase());
  const id = known ? known[0] : typeId(q);
  if (!id) return { error: 'Which day type (its name, e.g. "Upper A")?' };
  if (FIXED.includes(id)) return { error: `${LABEL[id]} keeps its own routine. A copy gets its own day type (e.g. "${LABEL[id]} B"); split_plan can put Pull, Push or Legs in a split as they are.` };
  return { id };
}

/** Give a day type to one routine; any other routine with it lets go of it (one routine per day type). */
function claimType(s, r, id) {
  for (const o of routinesOfType(s, id)) if (o.id !== r.id) put(s, 'routines', o.id, { ...o, dayType: null, updatedAt: s.now });
}

const lineOf = (x, i) => `${i + 1}. ${x.e.name}: ${setsText(x.e, x.barKg)}${x.e.supersetId ? ', in a superset' : ''}`;
const typeNote = (s, id) => {
  if (!id) return '';
  const b = normBlock(s.block());
  return b?.order.includes(id) ? ` Train starts it on his ${LABEL[id] || id} days.` : ` Day type ${id}: not in his rotation yet (split_plan puts it in).`;
};

// ---- routine_build ---------------------------------------------------------------------------------------------------

function routineBuild(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const routines = s.list('routines');
  const folders = s.list('folders');
  const titleTaken = (t, except = null) => routines.some((r) => r.id !== except && r.title.toLowerCase() === t.toLowerCase());

  if (a.action === 'list') {
    const lines = [...folders].sort(byOrder).map((f) => {
      const rs = routines.filter((r) => r.folderId === f.id).sort(byOrder);
      return rs.length ? `${f.title}: ${rs.map((r) => `${r.title}${r.dayType ? ` [${r.dayType}]` : ''} (${plural(r.exercises.length, 'exercise')}${r.workingSets ? `, ${r.workingSets} working set${r.workingSets > 1 ? 's' : ''}${r.workingSetsUntil ? ` to ${dayText(r.workingSetsUntil, s.today)}` : ''}` : ''})`).join(', ')}` : `${f.title}: empty`;
    });
    const loose = routines.filter((r) => !folders.some((f) => f.id === r.folderId));
    if (loose.length) lines.push(`No folder: ${loose.map((r) => r.title).join(', ')}`);
    return { text: `His routines ([day type] = the routine Train starts for it):\n${lines.join('\n')}`, summary: 'routines' };
  }

  if (a.action === 'create' || a.action === 'copy') {
    let base = null;
    const from = a.action === 'copy' ? a.routine : a.copy_from;
    if (from) { const f = findRoutine(s, from); if (f.error) return refuse(f.error); base = f.r; }
    if (a.action === 'create' && !base && !a.exercises?.length) return refuse('Which exercises (from his library, with sets), or copy_from a routine?');
    const title = clip(a.title) || (base ? `${base.title} (copy)` : '');
    if (!title) return refuse('The routine\'s name, as he says it.');
    if (titleTaken(title)) return refuse(`He already has a routine called ${title}. Another name, or routine_edit to change that one.`);
    const t = dayTypeFor(s, a.day_type);
    if (t.error) return refuse(t.error);
    const built = entriesFor(s, a.exercises);
    if (built.error) return refuse(built.error);
    const fo = folderFor(s, a.folder, base?.folderId ?? null);
    const inFolder = routines.filter((r) => r.folderId === fo.id);
    let r = base ? { ...duplicateRoutine(base), title } : newRoutine({ title });
    // A copy never takes the original's day type (one routine per day type); he gives it one with day_type.
    r = { ...r, folderId: fo.id, order: Math.max(-1, ...inFolder.map((x) => x.order ?? 0)) + 1, dayType: t.id ?? null, exercises: [...r.exercises, ...built.list.map((x) => x.e)], by: 'coach', createdAt: s.now };
    delete r.editedAt; delete r.copiedFrom;
    if (a.notes != null) r.notes = clip(a.notes, 1000);
    if (a.working_sets) { r.workingSets = a.working_sets; r.workingSetsUntil = a.until || null; }
    if (fo.made) put(s, 'folders', fo.id, fo.f);
    if (r.dayType) claimType(s, r, r.dayType);
    put(s, 'routines', r.id, r);
    const lib = s.lib();
    const lines = r.exercises.map((e, i) => lineOf({ e, barKg: lib.get(e.exerciseId)?.barKg ?? null }, i));
    return wrote(`Made ${title}${base ? ` (a copy of ${base.title})` : ''} in ${fo.f?.title || 'no folder'}${fo.made ? ' (new folder)' : ''}: ${plural(r.exercises.length, 'exercise')}. Loads are total kg; the 30% cap applies at Start.${r.workingSets ? ` ${r.workingSets} working set${r.workingSets > 1 ? 's' : ''} per exercise${r.workingSetsUntil ? ` until ${dayText(r.workingSetsUntil, s.today)}` : ''}.` : ''}${typeNote(s, r.dayType)}\n${lines.join('\n')}`, `+ ${title}`);
  }

  const found = a.routine ? findRoutine(s, a.routine) : null;

  if (a.action === 'folder' && !a.routine) {
    // Rename a folder: folder = which, title = its new name.
    const { item: f, ambiguous } = findByName(folders, a.folder || '', (x) => x.title, (x) => [x.id]);
    if (!f) return refuse(ambiguous.length ? `Which folder: ${sayList(ambiguous)}?` : `Which folder: ${sayList(folders.map((x) => x.title))}? (routine moves a routine into one)`);
    if (!clip(a.title)) return refuse('The folder\'s new name in title.');
    put(s, 'folders', f.id, { ...f, title: clip(a.title), updatedAt: s.now });
    return wrote(`Folder ${f.title} is now ${clip(a.title)}.`, 'folder renamed');
  }
  if (!found) return refuse(`Which routine: ${sayList(routines.map((r) => r.title))}?`);
  if (found.error) return refuse(found.error);
  const r = found.r;
  const save = (next) => put(s, 'routines', r.id, { ...next, updatedAt: s.now });

  if (a.action === 'add') {
    if (!a.exercises?.length) return refuse('Which exercises to add (exercises: [...])?');
    const built = entriesFor(s, a.exercises);
    if (built.error) return refuse(built.error);
    const cur = baseOf(s, r);
    const dupes = built.list.filter((x) => !x.e.role && cur.exercises.some((e) => e.exerciseId === x.e.exerciseId && !e.role));
    if (dupes.length && !a.again) return refuse(`Already in ${r.title}: ${dupes.map((x) => x.e.name).join(', ')}. Leave them out, or again: true to add them a second time.`);
    save({ ...cur, exercises: [...cur.exercises, ...built.list.map((x) => x.e)], editedAt: s.now });
    return wrote(`Added to ${r.title}: ${built.list.map((x) => `${x.e.name} (${setsText(x.e, x.barKg)})`).join('; ')}.${copyNote(s, r)}`, `${r.title}: + ${built.list.length}`);
  }
  if (a.action === 'rename') {
    const title = clip(a.title);
    if (!title) return refuse('The new name in title.');
    if (titleTaken(title, r.id)) return refuse(`He already has a routine called ${title}.`);
    save({ ...r, title });
    return wrote(`${r.title} is now called ${title}. Its past workouts stay as they were.${r.dayType && !FIXED.includes(r.dayType) ? ` The day in his split keeps its name ${LABEL[r.dayType] || r.dayType} (split_plan change renames it).` : ''}`, `${r.title} -> ${title}`);
  }
  if (a.action === 'folder') {
    if (!clip(a.folder)) return refuse(`Which folder: ${sayList(folders.map((f) => f.title))} (or a new name)?`);
    const fo = folderFor(s, a.folder);
    if (fo.made) put(s, 'folders', fo.id, fo.f);
    save({ ...r, folderId: fo.id, order: Math.max(-1, ...routines.filter((x) => x.folderId === fo.id).map((x) => x.order ?? 0)) + 1 });
    return wrote(`${r.title} is in ${fo.f.title} now${fo.made ? ' (new folder)' : ''}.`, `${r.title} moved`);
  }
  if (a.action === 'notes') {
    if (a.notes == null) return refuse('The note, in his words.');
    save({ ...r, notes: clip(a.notes, 1000) });
    return wrote(`${r.title}: routine note now "${clip(a.notes, 1000) || '(none)'}".`, `${r.title} note`);
  }
  if (a.action === 'day_type') {
    if (FIXED.includes(r.dayType)) return refuse(`${r.title} is his ${LABEL[r.dayType]} routine and keeps that. Copy it (action copy, day_type) for a split day.`);
    const t = dayTypeFor(s, a.day_type);
    if (t.error) return refuse(t.error);
    if (t.id === undefined) return refuse('Which day type (its name, or "none")?');
    const b = activeBlock(s.block(), s.today);
    if (!t.id && b?.order.includes(r.dayType) && routinesOfType(s, r.dayType).length < 2) return refuse(`${r.title} is what Train starts on his ${LABEL[r.dayType]} days. Give that day another routine first (split_plan change).`);
    if (t.id) claimType(s, r, t.id);
    save({ ...r, dayType: t.id });
    return wrote(t.id ? `${r.title} is what Train starts on ${LABEL[t.id] || t.id} days.${typeNote(s, t.id)}` : `${r.title} has no day type now; it starts from Train's routine list.`, `${r.title} day type`);
  }
  if (a.action === 'delete') {
    if (!String(a.said || '').trim()) return refuse(`Deleting ${r.title} needs his explicit words: pass them in said. If he didn't say to delete it, ask him.`);
    const b = activeBlock(s.block(), s.today) || normBlock(s.block());
    const inUse = r.dayType && (FIXED.includes(r.dayType) || b?.order.includes(r.dayType));
    if (inUse && routinesOfType(s, r.dayType).length < 2) return refuse(`${r.title} is what Train starts on his ${LABEL[r.dayType] || r.dayType} days, so it stays. ${FIXED.includes(r.dayType) ? 'Pull, Push, Legs and Neck keep their routine.' : 'Change the split first (split_plan change), then delete it.'}`);
    del(s, 'routines', r.id);
    return wrote(`Deleted ${r.title}. His past workouts of it stay in his history.`, `- ${r.title}`);
  }
  return refuse('action: list, create, copy, add, rename, folder, notes, day_type or delete.');
}

// ---- split_plan ------------------------------------------------------------------------------------------------------

const DAY = obj({
  type: { type: 'string', description: 'the day\'s name ("Upper A", "Lower", "Push Day"), or "rest"; Pull, Push, Legs as they are' },
  routine: { type: 'string', description: 'the routine Train starts that day (default: the one with that day type)' },
  covers: COVERS,
  neck: { type: 'boolean', description: 'neck after this day (true) or never (false); default by what it covers and his neck plan' },
}, ['type']);

function guessCovers(label) {
  const t = label.toLowerCase();
  if (/full|whole/.test(t)) return [...ROTATION];
  if (/upper/.test(t)) return ['pull', 'push'];
  if (/lower|leg/.test(t)) return ['legs'];
  const out = ROTATION.filter((x) => new RegExp(`\\b${x}`).test(t));
  return out.length ? out : null;
}

const endQuestion = (doc) => ({
  q: `His split ${doc.name} (${cycleText(doc)}) ends today, ${dayText(doc.to)}. Keep it, or back to Pull, Push, Legs from ${dayText(addDays(doc.to, 1))}? Record his answer with split_plan extend or end, then open_question.`,
  why: `He planned ${doc.name} from ${dayText(doc.from)} to ${dayText(doc.to)}; Pull, Push and Legs come back by themselves after it unless he keeps it.`,
  priority: 80, askAfter: doc.to,
});

/** The question at the split's end: asked on its last day unless he chose "back" (or there is no end); else an open
 *  one is closed with `answer` (or why it isn't needed). */
function setEndQuestion(s, doc, answer = null) {
  const cur = s.one('coach-questions', 'block-end');
  if (!answer && doc?.to && doc.atEnd !== 'back') return put(s, 'coach-questions', 'block-end', endQuestion(doc));
  const text = answer || (doc?.to ? 'Not asked: the split goes back to Pull, Push, Legs by itself (his plan).' : 'Not asked: the split runs until he ends it.');
  if (cur && !cur.answered) put(s, 'coach-questions', 'block-end', { ...cur, answered: { at: s.now, date: s.today, answer: text } });
  return null;
}

/** Working sets on routines: a cap per exercise (warm-ups and holds stay); 0 or null takes it off. */
function capRoutines(s, rs, n, until) {
  for (const r of rs) {
    const { workingSets, workingSetsUntil, ...rest } = r;
    put(s, 'routines', r.id, n ? { ...rest, workingSets: n, workingSetsUntil: until || null, updatedAt: s.now } : { ...rest, updatedAt: s.now });
  }
}

function splitPlan(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const raw = s.block();
  const b = normBlock(raw);
  const live = b && (!b.to || b.to >= s.today) ? b : null;
  const label = (t, blk = b) => LABEL[t] || blk?.types?.[t]?.label || t;
  const nextOf = (blk) => rotationDay({ last: s.last(), today: s.today, days: s.days(), block: blk }).next;

  if (a.action === 'show') {
    if (!live) return { text: `No split running: Pull, Push, Legs, 3 on and 1 off. Next: ${LABEL[nextOf(null).dayType]}, ${dayText(nextOf(null).date, s.today)}.${b ? ` Last split: ${b.name || 'Upper/Lower'} (${cycleText(b)}), ended ${dayText(b.to, s.today)}.` : ''} split_plan set builds one.`, summary: 'no split' };
    const own = [...new Set(live.order.filter((t) => t !== 'rest'))];
    const types = own.map((t) => { const r = routineOf(s, t); return `${label(t)}: starts ${r ? `"${r.title}" (${plural(r.exercises.length, 'exercise')})` : 'NO ROUTINE'}${ROTATION.includes(t) ? '' : `, covers ${(live.types[t]?.covers || []).map((c) => LABEL[c]).join(' + ') || 'nothing'}`}${live.types[t]?.neck === true ? ', neck after it' : live.types[t]?.neck === false ? ', no neck' : ''}`; });
    const n = nextOf(live);
    return { text: `${live.name || 'Upper/Lower'}: ${cycleText(live)}, repeating; from ${dayText(live.from, s.today)} ${live.to ? `to ${dayText(live.to, s.today)}` : 'until he ends it'}. ${types.join('. ')}.${live.workingSets ? ` ${live.workingSets} working set${live.workingSets > 1 ? 's' : ''} per exercise.` : ''} At the end: ${live.atEnd === 'back' ? 'back to Pull, Push, Legs by itself' : live.to ? `ask him on ${dayText(live.to, s.today)} (keep or back to Pull, Push, Legs)` : 'none (until he ends it)'}${live.answer === 'keep' ? '; he already chose to keep it once' : ''}; then ${LABEL[live.then] || 'Pull'}. Next: ${label(n.dayType, live)}, ${dayText(n.date, s.today)}.`, summary: 'split' };
  }

  if (a.action === 'end') {
    const r = rotationSet({ action: 'block', block: 'end', said: a.said }, ctx);
    if (r.wrote) setEndQuestion(snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() }), null, `He ended it${a.said ? `: "${clip(a.said, 120)}"` : ''}.`);
    return r;
  }

  if (a.action === 'extend') {
    if (!b) return refuse('No split to extend; split_plan set builds one.');
    const to = a.open ? null : a.to || addDays(b.to && b.to > s.today ? b.to : s.today, 7 * (a.weeks || 2));
    if (to && to < s.today) return refuse('That date has passed.');
    const doc = { ...raw, to, answer: 'keep', answeredOn: s.today, ...(a.said ? { said: clip(a.said, 200) } : {}) };
    put(s, 'schedule', 'block', doc);
    // A split he keeps is asked about again at its new end, unless it runs on without one.
    setEndQuestion(s, normBlock(doc), to ? null : 'He kept it, with no end date.');
    return wrote(`${b.name || 'Upper/Lower'} runs on ${to ? `to ${dayText(to, s.today)}` : 'until he ends it'}. Pull, Push and Legs stay as routines and come back after it.`, 'split extended');
  }

  if (a.action === 'working_sets') {
    if (a.working_sets == null) return refuse('working_sets: how many working sets per exercise (1-10), or 0 to take the limit off.');
    const until = a.working_sets ? (a.until || live?.to || null) : null;
    let rs;
    if (a.routines?.length) {
      rs = [];
      for (const q of a.routines) { const f = findRoutine(s, q); if (f.error) return refuse(f.error); rs.push(f.r); }
    } else {
      const types = a.scope === 'all' ? [...new Set([...ROTATION, ...(live?.order || [])])] : live ? [...new Set(live.order)] : ROTATION;
      rs = types.filter((t) => t !== 'rest').map((t) => routineOf(s, t)).filter(Boolean);
    }
    rs = [...new Map(rs.map((r) => [r.id, r])).values()];
    capRoutines(s, rs, a.working_sets, until);
    if (live && !a.routines?.length) {
      const { workingSets, workingSetsUntil, ...rest } = raw;
      put(s, 'schedule', 'block', a.working_sets ? { ...rest, workingSets: a.working_sets, ...(a.until ? { workingSetsUntil: a.until } : {}) } : rest);
    }
    return wrote(a.working_sets ? `${a.working_sets} working set${a.working_sets > 1 ? 's' : ''} per exercise${until ? ` until ${dayText(until, s.today)}` : ''} in ${rs.map((r) => r.title).join(', ')}. Warm-ups and tendon holds stay; drop sets go. It only caps: an exercise with fewer sets keeps them, and the 30% cap still applies at Start.` : `No working-set limit in ${rs.map((r) => r.title).join(', ')}: each exercise has its own sets again.`, 'working sets');
  }

  if (a.action !== 'set' && a.action !== 'change') return refuse('action: show, set, change, extend, end or working_sets.');
  const base = a.action === 'change' ? b : null;
  if (a.action === 'change' && !b) return refuse('No split to change; split_plan set builds one.');
  const specs = a.days || (base ? base.order.map((t) => (t === 'rest' ? { type: 'rest' } : { type: label(t) })) : null);
  if (!specs?.length) return refuse('days: the split in order, e.g. [{type: "Upper A", routine: "Upper A"}, {type: "Lower"}, {type: "rest"}, ...].');
  if (specs.length > 14) return refuse('A split of up to 14 days.');

  // The day types: his names, what each covers (holds, neck, check-in) and the routine each starts.
  const order = []; const types = {}; const plan = []; const missing = [];
  for (const d of specs) {
    const name = clip(d.type, 30);
    if (/^(rest|off|rest day)$/i.test(name)) { order.push('rest'); continue; }
    const known = Object.entries(b?.types || {}).find(([id, t]) => id === name || t.label?.toLowerCase() === name.toLowerCase());
    const id = known ? known[0] : typeId(name);
    if (!id) return refuse(`"${d.type}" isn't a day name.`);
    if (id === 'neck') return refuse('Neck isn\'t a split day: plan it after a day with neck: true (or neck_plan).');
    order.push(id);
    if (!ROTATION.includes(id)) {
      const prev = types[id] || b?.types?.[id] || {};
      const covers = d.covers || prev.covers || guessCovers(name);
      if (!covers) return refuse(`What does ${name} hold of Pull, Push and Legs (covers)? Its tendon holds, neck place and check-in follow those days.`);
      types[id] = { label: types[id]?.label || (known ? prev.label : name), covers, ...(d.neck != null ? { neck: d.neck } : prev.neck != null ? { neck: prev.neck } : {}) };
    } else if (d.covers || d.neck != null) return refuse(`${LABEL[id]} is his own ${LABEL[id]} day: its holds and neck stay as they are.`);
    if (plan.some((p) => p.id === id)) continue;
    if (d.routine) {
      const f = findRoutine(s, d.routine);
      if (f.error) return refuse(f.error);
      if (ROTATION.includes(id) && f.r.dayType !== id) return refuse(`${LABEL[id]} starts his ${LABEL[id]} routine. A day with "${f.r.title}" needs its own name (e.g. "${f.r.title} Day").`);
      plan.push({ id, r: f.r });
    } else if (routineOf(s, id) && (ROTATION.includes(id) || routineOf(s, id).dayType === id)) plan.push({ id, r: routineOf(s, id) });
    else missing.push(name);
  }
  if (!order.some((t) => t !== 'rest')) return refuse('A split needs at least one training day.');
  if (missing.length) return refuse(`No routine for ${missing.join(', ')} yet: build it first (routine_build create with day_type, or copy one), or give routine for that day.`);

  const from = a.from || base?.from || s.today;
  if (a.action === 'set' && from < s.today) return refuse('It can start today at the earliest.');
  const to = a.open ? null : a.to || (a.weeks ? addDays(from, 7 * a.weeks - 1) : base ? base.to : null);
  if (to && to < from) return refuse('It ends before it starts.');
  if (to && to < s.today) return refuse('That end date has passed.');
  const then = a.then || base?.then || (live?.then) || (ROTATION.includes(nextOf(null).dayType) ? nextOf(null).dayType : 'pull');
  const atEnd = a.at_end || base?.atEnd || 'ask';
  const ws = a.working_sets === 0 ? null : a.working_sets ?? (base?.workingSets || null);

  // Routines: a routine of another day type becomes a copy for this day (Pull, Push, Legs, Neck and other split days
  // keep theirs); a routine without one takes it on.
  const done = [];
  for (const p of plan) {
    if (p.r.dayType === p.id) continue;
    if (p.r.dayType && (FIXED.includes(p.r.dayType) || order.includes(p.r.dayType) || isLive(live, p.r.dayType))) {
      const c = { ...duplicateRoutine(p.r), title: uniqueTitle(s, types[p.id]?.label || p.id), dayType: p.id, by: 'coach', createdAt: s.now };
      delete c.editedAt; delete c.copiedFrom; delete c.workingSets; delete c.workingSetsUntil;
      claimType(s, c, p.id);
      put(s, 'routines', c.id, c);
      done.push(`${c.title} is a copy of ${p.r.title}`);
      p.r = c;
    } else {
      claimType(s, p.r, p.id);
      put(s, 'routines', p.r.id, { ...p.r, dayType: p.id, updatedAt: s.now });
      done.push(`${p.r.title} starts ${types[p.id]?.label || p.id}`);
    }
  }

  const doc = {
    kind: 'block', v: 2, name: clip(a.name, 40) || base?.name || 'Split', from, to, order,
    types: { ...(raw?.types || {}), ...types }, then, atEnd,
    ...(ws ? { workingSets: ws, ...(a.until ? { workingSetsUntil: a.until } : base?.workingSetsUntil ? { workingSetsUntil: base.workingSetsUntil } : {}) } : {}),
    ...(base?.answer && a.action === 'change' ? { answer: base.answer, answeredOn: base.answeredOn } : {}),
    by: 'coach', setOn: s.today, ...(a.said ? { said: clip(a.said, 200) } : {}),
  };
  put(s, 'schedule', 'block', doc);
  // Working sets: as he said for every day's routine; else a split's limit reaches a routine that joins it.
  if (a.working_sets != null) capRoutines(s, plan.map((p) => p.r), ws, ws ? (a.until || to) : null);
  else if (ws) capRoutines(s, plan.map((p) => p.r).filter((r) => !(rec(s, r.id)?.workingSets)), ws, doc.workingSetsUntil || to);
  setEndQuestion(s, normBlock(doc));
  useBlock(doc);
  const n = rotationDay({ last: s.last(), today: s.today, days: s.days(), block: doc }).next;
  const covers = Object.entries(types).filter(([id]) => order.includes(id)).map(([id, t]) => `${t.label} takes the ${t.covers.map((c) => LABEL[c]).join(' + ')} holds${t.neck === true ? ', neck after it' : t.neck === false ? ', no neck' : ''}`);
  const end = !to ? 'It runs until he ends it.' : atEnd === 'back' ? `After ${dayText(to, s.today)} Pull, Push and Legs come back by themselves, from ${LABEL[then]}.` : `On ${dayText(to, s.today)} I ask him: keep it, or back to Pull, Push, Legs from ${LABEL[then]}.`;
  return wrote(`${doc.name}: ${cycleText(doc)}, repeating, from ${dayText(from, s.today)}${to ? ` to ${dayText(to, s.today)}` : ''}. Next session: ${label(n.dayType, normBlock(doc))}, ${dayText(n.date, s.today)}.${done.length ? ` ${done.join('; ')}.` : ''}${covers.length ? ` ${covers.join('; ')}.` : ''}${ws ? ` ${ws} working set${ws > 1 ? 's' : ''} per exercise${a.working_sets != null ? '' : ' (as before)'}.` : ''} ${end} His Pull, Push and Legs routines stay.`, `split ${doc.name}`);
}

const isLive = (live, t) => !!live && live.order.includes(t);
const rec = (s, id) => s.store.getRecord('routines', id)?.data;
function uniqueTitle(s, t) {
  const taken = new Set(s.list('routines').map((r) => r.title.toLowerCase()));
  if (!taken.has(t.toLowerCase())) return t;
  for (let i = 2; ; i++) if (!taken.has(`${t} (${i})`.toLowerCase())) return `${t} (${i})`;
}

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });

export const BUILD_TOOLS = [
  write('routine_build', 'Build routines', `Make and manage his routines yourself (Tue 11/10, his words: "you should be able to build the routines... Do not always rely on the Mac"). ${ONLY_HIS} list = his routines by folder with their day types (read only). create = a new routine: title, exercises from his library in order (each: sets, reps_min/reps_max, kg TOTAL, seconds, set_type, rest_seconds, note, superset label, warmup; a lift of The Comeback given without sets keeps following it, week column and 30% cap; a tendon hold as "<lift> · Hold" or hold: true, 3 × 30 s at his hold load unless given), or copy_from a routine plus more exercises; folder (an existing one or a new name), day_type (a day of his split, e.g. "Upper A": Train starts this routine on those days), notes, working_sets (+ until). copy = a copy of routine (title, folder, day_type; a copy never takes the original's day type). add = several exercises at once to routine (same fields; one at a time and other edits: routine_edit). rename = routine gets title. folder = move routine into folder (new name = new folder); without routine: rename folder to title. notes = the routine's note. day_type = which day of his split this routine starts ("none" takes it off); Pull, Push, Legs and Neck keep their routines. delete = ONLY on his explicit words (said); a routine Train starts for a day in use stays. Past workouts are never touched. The 30% cap still applies at Start.`,
    obj({ action: { type: 'string', enum: ['list', 'create', 'copy', 'add', 'rename', 'folder', 'notes', 'day_type', 'delete'] }, routine: { type: 'string' }, title: { type: 'string' }, copy_from: { type: 'string' }, folder: { type: 'string' }, day_type: { type: 'string' }, exercises: { type: 'array', maxItems: 25, items: EXERCISE }, notes: { type: 'string' }, working_sets: { type: 'integer', minimum: 1, maximum: 10 }, until: ISO, again: { type: 'boolean' }, said: SAID }, ['action']), routineBuild),
  write('split_plan', 'Build splits', `His training split, built and changed by you (Tue 11/10, his words: "form splits, workouts, modify"). ${ONLY_HIS} show = the split now (days, routines, what each covers, end; read only). set = a new split: name, days in order ([{type: "Upper A", routine?, covers?, neck?}, {type: "Lower"}, {type: "rest"}, ...]; Pull, Push, Legs can be days as they are), from (default today), to or weeks (none = until he ends it), at_end ask (on its last day I ask him: keep or back) or back (Pull, Push, Legs come back by themselves), then (the PPL day after it; default the one next now), working_sets (+ until). Each day needs a routine (routine_build first, or routine: a routine of another day becomes a copy for it). covers = what of Pull, Push, Legs a day holds: its tendon holds, neck place and check-in areas follow those days (guessed from "Upper", "Lower", "Push"...); neck: true plans neck after that day, false never. The rotation runs the cycle from his real sessions (a missed day carries over, no make-up). change = the running split with only what he changed (days, dates, name, at_end, then, working_sets). extend = keep it: to, weeks (default 2) or open. end = Pull, Push, Legs from the next day. working_sets = a programme-wide limit of working sets per exercise for a period (until; default the split's end): his split's routines, scope all (+ Pull, Push, Legs) or routines by name; 0 takes it off. It only caps (warm-ups and holds stay; it never adds sets). Pull, Push and Legs routines always stay. The 30% cap, the readiness table and his tendon pain limit stay on top.`,
    obj({ action: { type: 'string', enum: ['show', 'set', 'change', 'extend', 'end', 'working_sets'] }, name: { type: 'string' }, days: { type: 'array', minItems: 1, maxItems: 14, items: DAY }, from: ISO, to: ISO, weeks: { type: 'integer', minimum: 1, maximum: 52 }, open: { type: 'boolean', description: 'no end date: until he ends it' }, at_end: { type: 'string', enum: ['ask', 'back'] }, then: { type: 'string', enum: ROTATION }, working_sets: { type: 'integer', minimum: 0, maximum: 10 }, until: ISO, scope: { type: 'string', enum: ['split', 'all'] }, routines: { type: 'array', maxItems: 20, items: { type: 'string' } }, said: SAID }, ['action']), splitPlan),
];
