// Tendon holds: what is due per area, from each area's phase (the owner's tendon note) and the rounds logged.
// A round is 3 holds of ~30 s. Rounds come from hold sessions (kind "holds") and from hold sets inside workouts.
import { isoDate } from './time.js';

/**
 * Rounds per area logged on each date: {areaId: {'YYYY-MM-DD': count}}.
 * Hold sets on an area's hold exercises or on the exercises that load it count for that area.
 * bridge: Hevy history (hold sets marked hold:true), used until the full import in step 3.
 */
export function roundsByDate(areas, sessions, sets, bridge = null) {
  const holdSessions = sessions.filter((s) => s.status === 'done');
  const byArea = Object.fromEntries(areas.map((a) => [a.id, {}]));
  const exToArea = new Map();
  for (const a of areas) {
    for (const n of a.loadsArea?.exercises || []) exToArea.set(n, a.id);
    for (const h of a.holds || []) exToArea.set(h.exercise, a.id);
  }
  const own = new Set();
  for (const [name, list] of Object.entries(bridge?.exercises || {})) {
    const area = exToArea.get(name);
    if (!area) continue;
    for (const e of list) {
      if (!e.sets?.some((x) => x.hold)) continue;
      const key = `${area}|${e.date}`;
      if (own.has(key)) continue;
      own.add(key);
      byArea[area][e.date] = (byArea[area][e.date] || 0) + 1;
    }
  }
  for (const s of holdSessions) {
    const date = isoDate(new Date(s.startedAt));
    if (s.kind === 'holds' && s.area && byArea[s.area]) {
      byArea[s.area][date] = (byArea[s.area][date] || 0) + 1;
      continue;
    }
    // Hold sets logged inside a workout count as one round for their area.
    const counted = new Set();
    for (const ex of s.exercises || []) {
      const area = exToArea.get(ex.name);
      if (!area || counted.has(area)) continue;
      if (sets.some((x) => x.sessionId === s.id && x.exKey === ex.key && x.done && x.type === 'hold')) {
        byArea[area][date] = (byArea[area][date] || 0) + 1;
        counted.add(area);
      }
    }
  }
  return byArea;
}

/** What is due for one area today. */
export function areaStatus(area, rounds, today) {
  const todayCount = rounds[today] || 0;
  if (area.phase === 'heal') {
    return { kind: 'daily', done: todayCount, target: 2, due: todayCount < 2, text: `${todayCount} / 2 today (morning and evening)` };
  }
  if (area.phase === 'fix' || area.phase === 'maintenance') {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const since = start.toISOString().slice(0, 10);
    const week = Object.entries(rounds).filter(([d]) => d >= since && d <= today).reduce((n, [, c]) => n + c, 0);
    const target = area.phase === 'fix' ? [3, 4] : [1, 1];
    return { kind: 'weekly', done: week, target, due: week < target[0], today: todayCount, text: `${week} in the last 7 days (aim ${target[0] === target[1] ? target[0] : `${target[0]}-${target[1]}`})` };
  }
  if (area.phase === 'none') return { kind: 'none', done: 0, target: 0, due: false, text: 'No holds unless it starts to hurt' };
  return { kind: 'unscheduled', done: todayCount, target: null, due: false, text: 'Not scheduled yet' };
}

const DAY_NAME = { pull: 'Pull', push: 'Push', legs: 'Legs' };

/** Holds due after this kind of workout, from the tendon data: holds whose timing says "after Push" and so on. */
export function holdsAfter(areas, dayType) {
  const day = DAY_NAME[dayType];
  if (!day) return [];
  const after = new RegExp(`\\bafter ${day}\\b`, 'i');
  return areas.flatMap((a) => (a.holds || []).filter((h) => [...(h.timing || []), h.when || ''].some((t) => after.test(t)))
    .map((h) => ({ area: a.label, exercise: h.exercise, sets: h.sets || 3, seconds: h.seconds || 30 })));
}

/** Pain rule from the tendon note: up to 3-4 out of 10 is fine if it isn't worse the next day. */
export const painOk = (pain) => pain == null || pain <= 4;

export const PHASE_TEXT = {
  heal: 'Heal phase: 3 holds twice a day, morning and evening',
  fix: 'Fix phase: 3-4 times a week for 4-8 weeks',
  maintenance: 'Maintenance: after a workout, or one day a week',
  none: 'Nothing reported',
  unknown: 'Phase not set yet',
};
