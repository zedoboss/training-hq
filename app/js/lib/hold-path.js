// A hold path (Thu 10/22, his words: "a few more sessions on the Smith machine flat bench hold, and then after that
// switch over to dumbbells or barbell... and to take it from there slow"): one hold of an area moves through stages,
// each with its own exercise and load. A stage passes after `passDays` Push days with a round of it, every set within
// his pain limit (3-4/10, his note); then the app asks the next morning and moves only when he says yes ("not worse
// the morning after?"). The new stage replaces the hold before it. He starts the path himself. The stages and loads
// are his data (the tendon seed); nothing here is advice of the app's own.
import { painOk, holdBase, isHoldSet } from './holds.js';

/** The path on one of an area's holds, or null. */
export const pathOf = (hold) => (hold?.path?.stages?.length > 1 ? hold.path : null);

/**
 * Where he is: {started, at, stage, next, quietDays, need, ready}. quietDays: Push days since this stage began with a
 * round of it, every set within his pain limit. ready: enough of them, a stage after this one, and a quiet day since a
 * "not yet". dayOf(ms) gives the date in his zone.
 */
export function pathState({ hold, area, sessions = [], sets = [], dayOf }) {
  const path = pathOf(hold);
  if (!path) return null;
  const started = Number.isInteger(path.at);
  const at = started ? path.at : 0;
  const stage = path.stages[at]; const next = path.stages[at + 1] || null;
  const need = path.passDays || 2;
  if (!started) return { started, at, stage, next, quietDays: [], need, ready: false };
  const done = sessions.filter((s) => s?.status === 'done' && s.startedAt && dayOf(s.startedAt) >= path.since);
  const pushDays = new Set(done.filter((s) => s.kind !== 'holds' && s.dayType === 'push').map((s) => dayOf(s.startedAt)));
  const name = holdBase(stage.exercise);
  const ok = new Map(); // date -> every set of the stage's hold within his limit
  for (const s of done) {
    const d = dayOf(s.startedAt);
    if (!pushDays.has(d) || (s.kind === 'holds' && s.area !== area.id)) continue;
    for (const e of (s.exercises || []).filter((x) => holdBase(x.name) === name)) {
      const hs = sets.filter((x) => x.sessionId === s.id && x.exKey === e.key && x.done && (s.kind === 'holds' || isHoldSet(x, e)));
      if (hs.length) ok.set(d, (ok.get(d) ?? true) && hs.every((x) => painOk(x.pain)));
    }
  }
  const quietDays = [...ok].filter(([, fine]) => fine).map(([d]) => d).sort();
  const waited = !path.notYetOn || quietDays.some((d) => d > path.notYetOn);
  return { started, at, stage, next, quietDays, need, ready: Boolean(next) && quietDays.length >= need && waited };
}

/** The hold after a move: 'start' (the first stage, counted from today), 'up', 'back', or 'not-yet' (one more quiet day first). */
export function movePath(hold, how, today) {
  const path = pathOf(hold);
  if (!path) return hold;
  if (how === 'not-yet') return { ...hold, path: { ...path, notYetOn: today } };
  const at = Number.isInteger(path.at) ? path.at : 0;
  const to = how === 'start' ? 0 : how === 'up' ? Math.min(path.stages.length - 1, at + 1) : how === 'back' ? Math.max(0, at - 1) : at;
  const st = path.stages[to];
  return {
    ...hold, exercise: st.exercise, loadKg: st.loadKg ?? null, loadNote: st.loadNote || '',
    path: { ...path, at: to, since: today, notYetOn: null, log: [...(path.log || []), { how, at: to, on: today }] },
  };
}

/** "Stage 2 of 5: Flat dumbbells (20 kg)" */
export const stageText = (path, at) => `Stage ${at + 1} of ${path.stages.length}: ${path.stages[at].label}${path.stages[at].loadKg != null ? ` (${path.stages[at].loadKg} kg)` : ''}`;

/** Every hold with a path on these areas, with where he is on it. */
export const pathsOf = ({ areas = [], sessions = [], sets = [], dayOf }) => areas.flatMap((area) => (area.holds || [])
  .map((hold, i) => ({ area, hold, i, state: pathState({ hold, area, sessions, sets, dayOf }) })).filter((x) => x.state));
