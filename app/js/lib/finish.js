// Finishing a session: records, the "update routine?" check, and turning a session into a routine.
import { heaviestOf } from './history.js';
import { newId, newKey } from './routines.js';

export const COMEBACK_START = '2026-09-24';

/**
 * Bests in this session compared with history. "Comeback best" = heaviest working set since the comeback
 * started; "all-time" needs the full history (step 3 import), so it is only claimed when history is complete.
 */
export function sessionBests(session, sets, history, { comebackStart = COMEBACK_START, fullHistory = false, isFirstEver = (n) => !history.all(n).length } = {}) {
  const out = [];
  for (const ex of session.exercises) {
    const mine = sets.filter((s) => s.exKey === ex.key && s.done).map((s) => ({ ...s, hold: s.type === 'hold' }));
    const best = heaviestOf(mine);
    if (!best?.kg || isFirstEver(ex.name)) continue;
    const past = history.all(ex.name).filter((e) => e.sessionId !== session.id);
    const sinceComeback = past.filter((e) => e.date >= comebackStart && e.heaviest?.kg != null);
    const prevComeback = sinceComeback.reduce((m, e) => Math.max(m, e.heaviest.kg), 0);
    const prevAll = past.reduce((m, e) => Math.max(m, e.heaviest?.kg ?? 0), 0);
    if (best.kg > prevComeback) {
      out.push({ name: ex.name, kg: best.kg, reps: best.reps, kind: fullHistory && best.kg > prevAll ? 'all-time' : 'comeback', previous: prevComeback || null });
    }
  }
  return out;
}

/**
 * Record banner (P27): does this ticked set beat the comeback best? Heaviest working weight, against history since
 * the comeback started and the sets already ticked in this session. Never on an exercise's first-ever session.
 * @returns {{kg:number, reps:number|null, previous:number|null}|null}
 */
export function setRecord({ set, name, sessionId, otherSets = [], history, comebackStart = COMEBACK_START }) {
  if (!set?.done || set.kg == null || set.type === 'warmup' || set.type === 'hold') return null;
  const past = history.all(name).filter((e) => e.sessionId !== sessionId);
  if (!past.length) return null;
  const prevComeback = past.filter((e) => e.date >= comebackStart && e.heaviest?.kg != null).reduce((m, e) => Math.max(m, e.heaviest.kg), 0);
  const today = heaviestOf(otherSets.filter((x) => x.done && x.id !== set.id).map((x) => ({ ...x, hold: x.type === 'hold' })))?.kg ?? 0;
  const bar = Math.max(prevComeback, today);
  if (set.kg <= bar) return null;
  return { kg: set.kg, reps: set.reps ?? null, previous: bar || null };
}

/** True when the logged structure differs from the routine: exercises added, removed, reordered, or set counts changed. */
export function structureChanged(session, sets, routine) {
  if (!routine) return false;
  const ids = session.exercises.map((e) => e.exerciseId);
  const rIds = routine.exercises.map((e) => e.exerciseId);
  if (ids.join('|') !== rIds.join('|')) return true;
  // A skipped exercise (nothing ticked) is not a change to the routine.
  return session.exercises.some((e, i) => {
    const re = routine.exercises[i];
    if (re.plan) return false;
    // Warm-ups made by the routine's "warm-up sets" option are not part of its structure.
    const done = sets.filter((s) => s.exKey === e.key && s.done && !(re.warmup && s.type === 'warmup')).length;
    return done > 0 && done !== (re.sets?.length ?? 0);
  });
}

/** Routine whose exercises and sets follow this session (programme links kept where the exercise is unchanged). */
export function routineFromSession(session, sets, routine = null) {
  return {
    id: routine?.id ?? newId('routine'),
    title: routine?.title ?? session.title,
    folderId: routine?.folderId ?? null,
    order: routine?.order ?? 99,
    dayType: session.dayType ?? routine?.dayType ?? null,
    notes: routine?.notes ?? '',
    exercises: session.exercises.map((e) => {
      const re = routine?.exercises.find((x) => x.exerciseId === e.exerciseId);
      const mine = sets.filter((s) => s.exKey === e.key && s.done && !(re?.warmup && s.type === 'warmup')).sort((a, b) => a.order - b.order);
      return {
        key: re?.key ?? newKey(), exerciseId: e.exerciseId, name: e.name, restSeconds: e.restSeconds ?? null, notes: re?.notes ?? e.notes ?? '',
        plan: re?.plan ?? null, role: re?.role ?? e.role ?? null, supersetId: e.supersetId ?? null, warmup: re?.warmup ?? false,
        sets: re?.plan ? [] : !mine.length && re ? re.sets
          : mine.map((s) => ({ type: s.type, kg: s.kg ?? null, reps: s.reps != null ? [s.reps, s.reps] : null, durationS: s.durationS ?? null })),
      };
    }),
    updatedAt: Date.now(),
  };
}

/** The last finished workout before this one of the same kind: same day type, else same routine, else same title. */
export function previousSame(session, sessions) {
  const same = session.dayType ? (s) => s.dayType === session.dayType
    : session.routineId ? (s) => s.routineId === session.routineId
      : (s) => s.title === session.title;
  return sessions.filter((s) => s.id !== session.id && s.status === 'done' && s.kind !== 'holds' && s.startedAt < session.startedAt && same(s))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}
