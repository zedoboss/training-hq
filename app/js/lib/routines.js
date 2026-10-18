// Routines and folders: pure helpers that return new objects (the caller saves them with repo.put).
// A routine exercise either follows the programme (plan set, sets worked out at session start: week column,
// 30% cap) or has its own explicit sets.

let n = 0;
export const newKey = () => `e${Date.now().toString(36)}${(++n).toString(36)}`;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export { nextDayType } from './rotation.js';

export function newRoutine({ title = 'New routine', folderId = null, order = 0 } = {}) {
  return { id: newId('routine'), title, folderId, order, dayType: null, notes: '', exercises: [], createdAt: Date.now() };
}

/** Copy of a routine with new ids; a copy of a programme routine keeps following the programme. */
export function duplicateRoutine(r) {
  return {
    ...structuredClone(r),
    id: newId('routine'),
    title: `${r.title} (copy)`,
    order: (r.order ?? 0) + 0.5,
    exercises: r.exercises.map((e) => ({ ...structuredClone(e), key: newKey() })),
    createdAt: Date.now(),
  };
}

/** Default sets for an exercise added by hand. */
export function defaultSets(type) {
  if (type === 'duration' || type === 'weight_duration') return [1, 2, 3].map(() => ({ type: 'normal', durationS: 30 }));
  return [1, 2].map(() => ({ type: 'normal', reps: [8, 12] }));
}

export function addExercises(r, exercises) {
  return {
    ...r,
    exercises: [...r.exercises, ...exercises.map((ex) => ({
      key: newKey(), exerciseId: ex.id, name: ex.name, restSeconds: ex.restSeconds ?? null, notes: '', plan: null, sets: defaultSets(ex.type),
    }))],
  };
}

export function removeExercise(r, key) {
  return { ...r, exercises: r.exercises.filter((e) => e.key !== key) };
}

/** Move an exercise up (-1) or down (+1). */
export function moveExercise(r, key, delta) {
  const list = [...r.exercises];
  const i = list.findIndex((e) => e.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return r;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...r, exercises: list };
}

/** Replace an exercise, keeping its sets, rest and notes; the programme link is dropped (different movement). */
export function replaceExercise(r, key, ex) {
  return {
    ...r,
    exercises: r.exercises.map((e) => (e.key === key
      ? { ...e, exerciseId: ex.id, name: ex.name, plan: null, sets: e.sets.length ? e.sets : defaultSets(ex.type) }
      : e)),
  };
}

export function updateExercise(r, key, patch) {
  return { ...r, exercises: r.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) };
}

/** Stop following the programme for one exercise: it gets explicit sets the owner edits. */
export function detachFromPlan(r, key, setsNow) {
  return updateExercise(r, key, { plan: null, sets: setsNow });
}

/** Folders sorted, each with its routines sorted; routines without a folder go last. */
export function groupByFolder(folders, routines) {
  const sorted = [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
  const groups = sorted.map((f) => ({ folder: f, routines: routines.filter((r) => r.folderId === f.id).sort(byOrder) }));
  const loose = routines.filter((r) => !folders.some((f) => f.id === r.folderId)).sort(byOrder);
  if (loose.length) groups.push({ folder: null, routines: loose });
  return groups;
}

/** Move a folder up or down; returns the folders whose order changed. */
export function moveFolder(folders, id, delta) {
  const list = [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const i = list.findIndex((f) => f.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((f, idx) => ({ ...f, order: idx })).filter((f, idx) => folders.find((x) => x.id === f.id).order !== idx);
}

/** Set summary text for a routine exercise with explicit sets: "2 × 8-12". */
export function setsSummary(sets) {
  const work = sets.filter((s) => s.type !== 'warmup');
  if (!work.length) return '';
  const first = work[0];
  if (first.type === 'hold' || first.durationS) return `${work.length} × ${first.durationS ?? 30} s`;
  const reps = Array.isArray(first.reps) ? (first.reps[0] === first.reps[1] ? `${first.reps[0]}` : `${first.reps[0]}-${first.reps[1]}`) : first.reps ?? '';
  return `${work.length} × ${reps}`;
}
