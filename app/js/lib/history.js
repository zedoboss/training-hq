// Exercise history from two sources: sessions logged in Training HQ and the Hevy history bridge.
// Newest first. Each entry: {date, source, sets:[{type, kg, reps, durationS, hold}], heaviest:{kg, reps}|null}.
import { isoDate } from './time.js';

const isWorking = (s) => !s.hold && s.type !== 'warmup' && s.type !== 'hold';

export function heaviestOf(sets) {
  return sets.filter(isWorking).reduce((best, x) => (x.kg != null && (!best || x.kg > best.kg || (x.kg === best.kg && (x.reps ?? 0) > (best.reps ?? 0))) ? { kg: x.kg, reps: x.reps } : best), null);
}

/**
 * @param {object} o
 * @param {Array} o.sessions  Training HQ sessions
 * @param {Array} o.sets      Training HQ sets
 * @param {object|null} o.bridge  history bridge doc
 * @param {string|null} o.excludeSessionId  the session being logged (not history yet)
 */
export function buildHistory({ sessions = [], sets = [], bridge = null, excludeSessionId = null }) {
  const byName = new Map();
  const push = (name, entry) => { if (!byName.has(name)) byName.set(name, []); byName.get(name).push(entry); };

  const done = sessions.filter((s) => s.status === 'done' && s.id !== excludeSessionId);
  const setsBySession = new Map();
  for (const x of sets) {
    if (!x.done) continue;
    if (!setsBySession.has(x.sessionId)) setsBySession.set(x.sessionId, []);
    setsBySession.get(x.sessionId).push(x);
  }
  const ownDates = new Map();
  for (const s of done) {
    const ss = (setsBySession.get(s.id) || []).sort((a, b) => a.order - b.order);
    for (const ex of s.exercises || []) {
      const mine = ss.filter((x) => x.exKey === ex.key).map((x) => ({ type: x.type, kg: x.kg ?? null, reps: x.reps ?? null, durationS: x.durationS ?? null, hold: x.type === 'hold' }));
      if (!mine.length) continue;
      const date = isoDate(new Date(s.startedAt));
      push(ex.name, { date, at: s.startedAt, source: 'training-hq', sessionId: s.id, title: s.title, sets: mine, heaviest: heaviestOf(mine) });
      ownDates.set(`${ex.name}|${date}`, true);
    }
  }
  for (const [name, list] of Object.entries(bridge?.exercises || {})) {
    for (const e of list) {
      if (ownDates.has(`${name}|${e.date}`)) continue;
      push(name, { date: e.date, at: Date.parse(`${e.start || e.date}`), source: 'hevy', title: e.title, sets: e.sets, heaviest: e.heaviest, note: e.note });
    }
  }
  for (const list of byName.values()) list.sort((a, b) => (b.at || 0) - (a.at || 0) || b.date.localeCompare(a.date));

  return {
    /** Newest entry for an exercise name, or null. */
    last: (name) => byName.get(name)?.[0] ?? null,
    all: (name) => byName.get(name) ?? [],
    /** [{date, kg}] heaviest working set per session, for the 30% guard. */
    guardHistory: (name) => (byName.get(name) || []).filter((e) => e.heaviest?.kg != null).map((e) => ({ date: e.date, kg: e.heaviest.kg })),
    /** Previous values for the set table, split by kind so warm-ups line up with warm-ups. */
    previous: (name) => {
      const e = byName.get(name)?.[0];
      if (!e) return { warmup: [], working: [], hold: [] };
      return {
        warmup: e.sets.filter((s) => s.type === 'warmup' && !s.hold),
        working: e.sets.filter(isWorking),
        hold: e.sets.filter((s) => s.hold || s.type === 'hold'),
      };
    },
  };
}
