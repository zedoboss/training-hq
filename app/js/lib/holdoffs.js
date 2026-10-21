// What he told the coach to hold off on (Wed 10/21, his words: "He should be like a human coach, with proper two-way
// communication, not just one way, with good memory"): "no sauna this week", "I'm busy until 3", "stop the walk
// questions today". The coach records it (tool hold_off, collection 'coach-holds'); every planned reminder and nudge
// checks it until it runs out. Safety never waits: the sauna's overdue alarm and the question after a session.

/** What each area covers: planned reminder kinds and nudge keys (the part of a key before ':'). */
export const HOLD_AREAS = {
  food: ['meals', 'cook', 'food', 'meal-after', 'dishes'],
  supps: ['supps', 'supps-untimed', 'supps-after-meal'],
  walk: ['walk', 'steps'],
  holds: ['holds'],
  sauna: ['sauna-day', 'sauna-plan'],
  scan: ['scan', 'evolt'],
  training: ['session', 'readiness', 'checkin', 'neck'],
  sleep: ['sleep', 'morning'],
  recovery: ['recovery'],
  health: ['health'],
  evening: ['evening'],
  questions: ['questions'],
  all: ['*'],
};
export const AREA_NAMES = Object.keys(HOLD_AREAS);
// Never held: the sauna's overdue alarm and after-question (safety), and reminders he asked the coach for.
const SAFETY = /^(sauna-overdue|sauna-after|coach)\b/;

/** Holds still running at `now`. */
export const activeHolds = (list = [], now = Date.now()) => list.filter((h) => h && !h.cancelledAt && h.until > now && (h.from ?? 0) <= now);

/**
 * Is this reminder or nudge held off? key: a planned reminder's id ("meal:2026-10-21:1230", "sauna-day:...") or kind,
 * or a nudge key ("food", "walk:ask").
 */
export function heldOff(key, list = [], now = Date.now()) {
  const k = String(key || '');
  if (SAFETY.test(k)) return false;
  const head = k.split(':')[0];
  return activeHolds(list, now).some((h) => (h.areas || []).some((a) => (HOLD_AREAS[a] || []).some((x) => x === '*' || x === head || x === k)));
}

/** A planned reminder item is held off by its id or its kind. */
export const itemHeld = (item, list, now) => heldOff(item.id, list, now) || (!SAFETY.test(item.id || '') && heldOff(item.kind, list, now));
