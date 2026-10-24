// Exercise history from two sources: finished sessions (logged in Training HQ or imported from Hevy and Strong) and
// the Hevy history bridge, a stand-in for the last few Hevy sessions that is ignored once Hevy history is imported.
// Newest first. Each entry: {date, source, dayType, routineId, sets:[{type, kg, reps, durationS, hold, depth?}], heaviest:{kg, reps}|null}.
import { isoDate } from './time.js';

const isWorking = (s) => !s.hold && s.type !== 'warmup' && s.type !== 'hold';

/** The bridge, or null once any Hevy session has been imported (the import holds the same sessions in full). */
export const activeBridge = (bridge, sessions = []) => (bridge && !sessions.some((s) => s.source === 'hevy' && s.status === 'done') ? bridge : null);

export function heaviestOf(sets) {
  return sets.filter(isWorking).reduce((best, x) => (x.kg != null && (!best || x.kg > best.kg || (x.kg === best.kg && (x.reps ?? 0) > (best.reps ?? 0))) ? { kg: x.kg, reps: x.reps } : best), null);
}

/**
 * Same routine: the same Training HQ routine when both have one; otherwise (Hevy history) the same day type.
 * A session with neither (started empty) matches everything.
 */
export function sameRoutine(entry, { routineId = null, dayType = null } = {}) {
  if (!routineId && !dayType) return true;
  if (routineId && entry.routineId) return entry.routineId === routineId;
  return !!dayType && entry.dayType === dayType;
}

/**
 * @param {object} o
 * @param {Array} o.sessions  Training HQ sessions
 * @param {Array} o.sets      Training HQ sets
 * @param {object|null} o.bridge  history bridge doc
 * @param {string|null} o.excludeSessionId  the session being logged (not history yet)
 */
export function buildHistory({ sessions = [], sets = [], bridge: rawBridge = null, excludeSessionId = null }) {
  const bridge = activeBridge(rawBridge, sessions);
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
      const mine = ss.filter((x) => x.exKey === ex.key).map((x) => ({ type: x.type, kg: x.kg ?? null, reps: x.reps ?? null, durationS: x.durationS ?? null, distanceM: x.distanceM ?? null, hold: x.type === 'hold', ...(x.depth ? { depth: x.depth } : {}) }));
      if (!mine.length) continue;
      const date = isoDate(new Date(s.startedAt));
      // Thu 10/22: his notes that day (the exercise's and the sets'), so the next target can see "back pain" and such.
      const note = [ex.notes, ...ss.filter((x) => x.exKey === ex.key && x.note).map((x) => x.note)].filter(Boolean).join(' | ');
      push(ex.name, { date, at: s.startedAt, source: s.source || 'training-hq', sessionId: s.id, title: s.title, dayType: s.dayType ?? null, routineId: s.routineId ?? null, bodyweightKg: s.bodyweightKg ?? null, sets: mine, heaviest: heaviestOf(mine), ...(note ? { note } : {}), ...(ex.oneArm ? { oneArm: true } : {}) });
      ownDates.set(`${ex.name}|${date}`, true);
    }
  }
  for (const [name, list] of Object.entries(bridge?.exercises || {})) {
    for (const e of list) {
      if (ownDates.has(`${name}|${e.date}`)) continue;
      push(name, { date: e.date, at: Date.parse(`${e.start || e.date}`), source: 'hevy', title: e.title, dayType: e.dayType ?? null, routineId: null, sets: e.sets, heaviest: e.heaviest, note: e.note });
    }
  }
  for (const list of byName.values()) list.sort((a, b) => (b.at || 0) - (a.at || 0) || b.date.localeCompare(a.date));

  return {
    /** Newest entry for an exercise name, or null. */
    last: (name) => byName.get(name)?.[0] ?? null,
    all: (name) => byName.get(name) ?? [],
    /**
     * Sessions with rep sets (not holds or warm-ups only), newest first (Sat 10/24, his words: "Why is there no previous weight on
     * cupping??"): an exercise he does both as reps and as a hold builds today's weight on his last rep sets, not on a
     * hold-only session in between.
     */
    lifted: (name) => (byName.get(name) || []).filter((e) => e.sets.some(isWorking)),
    lastLifted: (name) => (byName.get(name) || []).find((e) => e.sets.some(isWorking)) ?? null,
    /** [{date, kg}] heaviest working set per session, for the 30% guard. */
    guardHistory: (name) => (byName.get(name) || []).filter((e) => e.heaviest?.kg != null).map((e) => ({ date: e.date, kg: e.heaviest.kg })),
    /**
     * Previous values for the set table, split by kind so warm-ups line up with warm-ups.
     * same: {routineId, dayType} to use only sessions of the same routine (Settings: previous column).
     */
    previous: (name, same = null) => {
      const list = (byName.get(name) || []).filter((x) => !same || sameRoutine(x, same));
      if (!list.length) return { warmup: [], working: [], hold: [] };
      // Rep rows from the last session with rep sets, hold rows from the last one with holds (Sat 10/24: a hold-only
      // session doesn't blank the rep rows' previous).
      const isHold = (s) => s.hold || s.type === 'hold';
      const e = list.find((x) => x.sets.some(isWorking)) || list[0];
      const h = list.find((x) => x.sets.some(isHold)) || list[0];
      return {
        warmup: e.sets.filter((s) => s.type === 'warmup' && !s.hold),
        working: e.sets.filter(isWorking),
        hold: h.sets.filter(isHold),
      };
    },
  };
}
