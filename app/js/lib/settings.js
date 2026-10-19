// Settings: two synced documents, col 'settings' ids 'main' and 'equipment'. Pure helpers here; data.js keeps the
// current values in the app state. Code defaults are generic; personal values (bar weights, gym, rest times) come
// from the private seed on the Mac and from what is changed on the Settings screen.

export const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
export const restText = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'off');

/** Rest-end sounds, made in the app (no sound files). */
export const SOUNDS = [
  { id: 'beeps', label: 'Three beeps' },
  { id: 'chime', label: 'Chime' },
  { id: 'bell', label: 'Bell' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'rise', label: 'Rising' },
];

export const WEEK_DAYS = [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']];

/** Plate sizes offered on the Settings screen (kg). Custom sizes can be added. */
export const PLATE_CHOICES = [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5];

export const DEFAULT_SETTINGS = {
  units: { weight: 'kg', distance: 'km', body: 'cm' },
  rest: { mainS: 180, lightS: 90, holdS: 120 },
  sounds: { restEnd: 'beeps', timerVolume: 80, tickVolume: 40, recordVolume: 80 },
  firstDayOfWeek: 1,
  keepAwake: true,
  previousFrom: 'any',
  warmup: { steps: [{ pct: 50, reps: 8 }, { pct: 75, reps: 4 }], countInStats: false },
  show: { plateCalc: true, rpe: true, supersetJump: true, inlineTimer: true, recordBanner: true },
  gym: { name: '' },
  // Until Apple Health is connected (step 7): bodyweight for pull-ups and other bodyweight exercises.
  bodyweight: { kg: null, at: null },
  // Step 4: the readiness check-in comes this many minutes before the session time he sets.
  // Hold reminders (decision 18: he confirms the times the first time).
  // Notifications from the Mac: which kinds, the evening round-up time, the weekday of the neck reminder (0 = Sunday).
  notify: { readinessMin: 30, holdsMorning: '07:30', holdsEvening: '19:30', holdTimesConfirmedOn: null, eveningCheck: '20:30', neckWeekday: 0, kinds: {},
    // Step 6: supplements are asked again every 45 minutes, 3 times, until answered; the weekly planning question day.
    suppFollowMin: 45, suppFollowMax: 3, suppPlanWeekday: 0,
    // Step 7: body scan reminders two evenings before and the evening before, at this time.
    scanEvening: '20:00',
    // A13: recovery reminders (weekly check-in, things to do, photos) at this time.
    recoveryHm: '20:15',
    // The coach's nudges (Mon 10/19): every this many minutes (0 = off) inside his waking hours, the most important
    // thing still open (lib/nudges.js). His own hours are set on the phone (Settings > Coach).
    nudgeEveryMin: 20, wakeHm: '07:00', bedHm: '22:00', nudgePausedUntil: 0 },
  // Step 6: which Claude reads meal photos on the Mac ('fast' Sonnet 5.5 low, 'deep' Opus 5.5 high); his usual meal
  // times [{name, time 'HH:MM'}] (none until he sets them: brief section 10).
  fuel: { visionModel: 'fast', mealTimes: [] },
  // Step 7: a daily step goal of his own for the Body chart and the core's steps ring (none until he sets one).
  // Step 7: which Claude reads body scan result photos on the Mac (Opus 5.5 high by default: every number counts).
  body: { stepGoal: null, scanModel: 'deep' },
  // Step 8: the coach's Claude ('fast' Sonnet 5.5 at low effort, the default; 'deep' Opus 5.5 at high effort).
  // A15 (brief decision 30): the coach's moods (Calm is always on: it takes over whenever a safety rule applies), how
  // hard it pushes (1-5), and whether it talks during sets and holds, and how often ('often' | 'steady' | 'once').
  // A16: rep calls ("two more") on squat sets with the camera: off until an iPhone test shows the ding is untouched;
  // until then the coach is silent during squat-camera sets.
  coach: { model: 'fast', moods: { commander: true, hype: true, dark: true, warrior: true, rival: true }, intensity: 3, talk: { during: true, every: 'steady' }, squatCalls: false },
  // A14: tendon holds start with this many seconds of GET READY before the hold itself.
  holds: { getReadyS: 15 },
  // Step 9: the voice lock's strictness on the Mac ('strict' default, 'normal', 'relaxed'), whether the coach answers
  // out loud, and the silent readout when speech was heard but not acted on. Listening itself is switched on per
  // device (not synced), so the phone and the Mac's browser never both act on the same words.
  voice: { strictness: 'strict', speak: true, readout: true },
};

export const DEFAULT_EQUIPMENT = {
  bars: [],
  plates: [20, 15, 10, 5, 2.5, 1.25],
  extraPlates: [],
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge of plain objects; arrays and values from `over` replace the ones in `base`. Unknown keys are kept. */
export function mergeDeep(base, over) {
  if (!isObj(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? mergeDeep(base[k], v) : structuredClone(v);
  }
  return out;
}

export const withDefaults = (doc) => mergeDeep(DEFAULT_SETTINGS, doc);

export function equipmentWithDefaults(doc) {
  const e = mergeDeep(DEFAULT_EQUIPMENT, doc);
  e.plates = [...new Set((e.plates || []).map(Number).filter((p) => p > 0))].sort((a, b) => b - a);
  if (!e.plates.length) e.plates = [...DEFAULT_EQUIPMENT.plates];
  e.bars = (e.bars || []).filter((b) => b && Number(b.kg) > 0).map((b) => ({ ...b, equipment: b.equipment || null }));
  return e;
}

/** Smallest plate he has: loads are rounded to bar + 2 × multiples of it. */
export const smallestPlate = (equipment) => Math.min(...equipmentWithDefaults(equipment).plates);

/** Equipment type an exercise uses, for matching a bar. Smith in the name counts as the Smith machine. */
const equipmentOf = (ex) => (/smith/i.test(ex?.name || '') ? 'smith' : ex?.equipment || null);

/**
 * Bar weight for an exercise: the bar chosen for that exercise (barId, or 'none'), else the bar set for its
 * equipment on the Settings screen, else the exercise's own bar weight (from the programme seed), else none.
 * A bar with no equipment type applies only to exercises that choose it (e.g. an EZ bar).
 */
export function barKgFor(ex, equipment) {
  if (ex?.barId === 'none') return null;
  if (ex?.barId) {
    const chosen = (equipment?.bars || []).find((b) => b.id === ex.barId && Number(b.kg) > 0);
    if (chosen) return Number(chosen.kg);
  }
  const eq = equipmentOf(ex);
  const bar = eq ? (equipment?.bars || []).find((b) => b.equipment === eq && Number(b.kg) > 0) : null;
  if (bar) return Number(bar.kg);
  return ex?.barKg ?? null;
}

/** Default rest when an exercise has none set: main lifts get the long rest, everything else the short one. */
export function restDefault(ex, settings) {
  const r = withDefaults(settings).rest;
  return ex?.capClass === 'main' ? r.mainS : r.lightS;
}

/** Rest after a ticked set: the exercise's own time (0 = off), else the default. Holds use the hold rest. */
export function restFor(ex, setType, settings) {
  if (setType === 'hold') return withDefaults(settings).rest.holdS;
  return ex?.restSeconds ?? restDefault(ex, settings);
}

// Units. Everything is stored in kg and metres; only the screen shows lb, km or miles.
export const LB = 0.45359237;
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** Weight unit for an exercise: its own (set from the exercise menu), else the Settings default. */
export const weightUnitFor = (ex, settings) => ex?.unit || withDefaults(settings).units.weight;

export function toUnit(kg, unit) {
  if (kg == null) return null;
  return unit === 'lb' ? round(kg / LB, 1) : kg;
}

export function fromUnit(value, unit) {
  if (value == null) return null;
  return unit === 'lb' ? round(value * LB, 3) : value;
}

export function toDistance(m, unit) {
  if (m == null) return null;
  return unit === 'mi' ? round(m / 1609.344, 2) : round(m / 1000, 3);
}

export function fromDistance(value, unit) {
  if (value == null) return null;
  return Math.round(unit === 'mi' ? value * 1609.344 : value * 1000);
}

/** Clean warm-up steps typed on the Settings screen: 1-99 %, 1-30 reps, lightest first. */
export function cleanWarmupSteps(steps) {
  return (steps || [])
    .map((s) => ({ pct: Math.round(Number(s.pct)), reps: Math.round(Number(s.reps)) }))
    .filter((s) => s.pct >= 1 && s.pct <= 99 && s.reps >= 1 && s.reps <= 30)
    .sort((a, b) => a.pct - b.pct);
}
