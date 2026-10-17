// The exercise library the app shows: the general library, plus the owner's own exercises (synced collection
// "exercises": programme exercises, ones found in imported history, custom ones), plus per-exercise settings.
// A synced record with the same id as a library entry overrides or extends it (pinned note, rest time, demo).
import { LIBRARY, slug } from '../data/exercise-library.js';
import { barKgFor } from './settings.js';

export { slug };

/**
 * Merge the static library with synced exercise records. Deleted records are already filtered out.
 * With the equipment settings, every exercise also gets the bar weight that applies to it.
 */
export function mergeLibrary(records = [], equipment = null) {
  const byId = new Map(LIBRARY.map((e) => [e.id, { ...e }]));
  for (const r of records) {
    if (!r?.id) continue;
    const base = byId.get(r.id);
    byId.set(r.id, base ? { ...base, ...r, source: base.source, custom: !!r.custom } : { source: r.custom ? 'custom' : 'mine', ...r });
  }
  const out = [...byId.values()];
  if (equipment) for (const e of out) e.barKg = barKgFor(e, equipment);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Search and filter. Words match in any order ("curl ez" finds "EZ Bar Biceps Curl").
 * recent: ids used most recently first; they sort to the top, then custom/own, then the rest.
 */
export function searchLibrary(list, { q = '', muscle = null, equipment = null, recent = [] } = {}) {
  const words = norm(q).split(' ').filter(Boolean);
  const rank = new Map(recent.map((id, i) => [id, i]));
  return list
    .filter((e) => !muscle || e.primary === muscle || e.secondary?.includes(muscle))
    .filter((e) => !equipment || e.equipment === equipment)
    .filter((e) => { const n = norm(e.name); return words.every((w) => n.includes(w)); })
    .sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
      const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
      if (ra !== rb) return ra - rb;
      const oa = a.source === 'library' ? 1 : 0;
      const ob = b.source === 'library' ? 1 : 0;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
}

/** A new custom exercise record. */
export function newCustomExercise({ name, type, primary, secondary = [], equipment }) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Name is required');
  return { id: slug(clean), name: clean, type, primary, secondary, equipment, custom: true, createdAt: Date.now() };
}

/** Demo clip file name for an exercise: its id plus .mp4 (2.17). */
export const demoFileName = (ex) => `${ex.id}.mp4`;
