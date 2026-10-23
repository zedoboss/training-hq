// Meals (step 6, FUEL): a BEFORE photo and an AFTER photo per meal, the Mac's estimate from each photo, and the
// numbers he confirms. Pure functions; the screens and the Mac pass the records in.
//
// meals          {id, date, at, name, before: {photoId, at, scaleG, items, confirmedAt} | null,
//                 after: {photoId, at, scaleG, leftovers, none, confirmedAt} | null, hint, round, note, source}
//                 items: [{name, grams, kcal, protein, unsure, fdcId?, source?}]; leftovers: [{name, grams, index}]
//                 fdcId: the USDA FoodData Central food; source 'usda' (kcal and protein computed from it, A5),
//                 'estimate' (the Mac's guess, no USDA match), 'typed' (his own numbers), 'label' (a pack's label).
//                 portion: his words for the amount when he has no scale ("½ pack", "3 eggs"; A7).
//                 after.none = he ate everything (no after photo needed). source 'photo' or 'manual'.
// meal-photos    {id, mealId, kind: 'before'|'after', dataUrl, at}: kept on the phone until the Mac has them.
// meal-estimates written by the Mac only, so his edits and its answers never overwrite each other:
//                {id: '<mealId>.<kind>', mealId, kind, photoId, round, status: 'done'|'failed', at, model,
//                 scaleG, items (before) | leftovers (after), notes, error, tries}
import { isoDate, formatTime, zoneOf } from './time.js';

export const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
/** A snack isn't one of his meals (Thu 10/22): his after-meal supplements wait for a real meal. */
export const isSnack = (m) => /^snack/i.test(String(m?.name || '').trim());
/** Minutes after the before photo when the app asks for the after photo (brief: about 25). */
export const AFTER_PHOTO_MIN = 25;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * A name for a meal started at `at`: his nearest meal time (within 90 minutes) when he has set them,
 * else by the clock (before 10:30 AM breakfast, before 3 PM lunch, 5 PM to 10 PM dinner, otherwise snack). night: it
 * counts for the day before (lib/waking-day.js).
 */
export function defaultMealName(at, mealTimes = [], tz, { night = false } = {}) {
  // Sat 10/24: after midnight, before he has slept (it counts for the day before): his last meal time, not breakfast.
  if (night) return [...(mealTimes || [])].filter((t) => /^\d{1,2}:\d{2}$/.test(String(t.time || ''))).sort((a, b) => String(a.time).padStart(5, '0').localeCompare(String(b.time).padStart(5, '0'))).at(-1)?.name || 'Dinner';
  const d = new Date(at);
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const [h, m] = hm.split(':').map(Number);
  const mins = h * 60 + m;
  let best = null;
  for (const t of mealTimes || []) {
    const [th, tm] = String(t.time || '').split(':').map(Number);
    if (!Number.isFinite(th)) continue;
    const diff = Math.abs(th * 60 + tm - mins);
    if (diff <= 90 && (!best || diff < best.diff)) best = { diff, name: t.name };
  }
  if (best?.name) return best.name;
  if (mins < 10 * 60 + 30) return 'Breakfast';
  if (mins < 15 * 60) return 'Lunch';
  if (mins >= 17 * 60 && mins < 22 * 60) return 'Dinner';
  return 'Snack';
}

/** A new meal from a before photo (or a manual one with no photo). */
export function newMeal({ id, at, photoId = null, name, tz, date = null }) {
  return {
    // date: the day it counts toward (his waking day, lib/waking-day.js); the calendar date of `at` when not given.
    id, date: date || isoDate(new Date(at), tz), at, name, source: photoId ? 'photo' : 'manual',
    before: photoId ? { photoId, at, scaleG: null, items: null, confirmedAt: null } : { photoId: null, at, scaleG: null, items: [], confirmedAt: null },
    after: null, hint: '', round: 0, note: '',
  };
}

/** Clean a list of food items (from the Mac's estimate or typed in). */
export const ITEM_SOURCES = ['usda', 'estimate', 'typed', 'label'];
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).map((x) => ({
    name: String(x?.name ?? '').trim().slice(0, 80) || 'Food',
    grams: Math.max(0, num(x?.grams) ?? 0),
    kcal: Math.max(0, num(x?.kcal) ?? 0),
    protein: Math.max(0, num(x?.protein) ?? 0),
    unsure: !!x?.unsure,
    ...(Number.isInteger(num(x?.fdcId)) && num(x.fdcId) > 0 ? { fdcId: num(x.fdcId) } : {}),
    ...(ITEM_SOURCES.includes(x?.source) ? { source: x.source } : {}),
    ...(x?.usda ? { usda: String(x.usda).slice(0, 200) } : {}),
    ...(x?.portion ? { portion: String(x.portion).slice(0, 40) } : {}),
  }));
}

export function itemTotals(items = []) {
  const t = { grams: 0, kcal: 0, protein: 0 };
  for (const x of items || []) { t.grams += num(x.grams) || 0; t.kcal += num(x.kcal) || 0; t.protein += num(x.protein) || 0; }
  return { grams: Math.round(t.grams), kcal: Math.round(t.kcal), protein: r1(t.protein) };
}

/** Change an item's grams and keep its kcal and protein per gram. */
export function regram(item, grams) {
  const g = Math.max(0, num(grams) ?? 0);
  if (!item.grams) return { ...item, grams: g };
  const f = g / item.grams;
  return { ...item, grams: g, kcal: Math.round(item.kcal * f), protein: r1(item.protein * f) };
}

/** Scale every item so the grams add up to the scale reading (he corrected the number read off the scale). */
export function scaleTo(items, totalG) {
  const t = itemTotals(items).grams;
  const g = num(totalG);
  if (!t || !g) return items;
  const f = g / t;
  const out = items.map((x) => ({ ...x, grams: Math.round(x.grams * f), kcal: Math.round(x.kcal * f), protein: r1(x.protein * f) }));
  // Rounding: the largest item takes the odd gram, so the items add up to the reading exactly.
  const diff = Math.round(g) - out.reduce((a, x) => a + x.grams, 0);
  if (diff) { const big = out.reduce((a, x, i) => (x.grams > out[a].grams ? i : a), 0); out[big] = { ...out[big], grams: out[big].grams + diff }; }
  return out;
}

const estOf = (estimates, mealId, kind) => (estimates instanceof Map ? estimates.get(`${mealId}.${kind}`) : (estimates || []).find((e) => e.id === `${mealId}.${kind}`)) || null;
/** The Mac's estimate for this photo, if it is for the photo the meal has now (a replaced photo makes it stale). */
export function currentEstimate(meal, estimates, kind) {
  const e = estOf(estimates, meal.id, kind);
  const part = meal[kind];
  if (!e || !part?.photoId || e.photoId !== part.photoId || (e.round ?? 0) < (meal.round ?? 0)) return null;
  return e;
}

/** Food on the plate: what he confirmed, else the Mac's estimate. */
export function beforeItems(meal, estimates) {
  if (meal.before?.confirmedAt || !meal.before?.photoId) return { items: cleanItems(meal.before?.items), estimated: false };
  // He corrected the scale reading before confirming: his rescaled items, still waiting for Looks right.
  if (meal.before.edited && Array.isArray(meal.before.items)) return { items: cleanItems(meal.before.items), estimated: true };
  const e = currentEstimate(meal, estimates, 'before');
  return e?.status === 'done' ? { items: cleanItems(e.items), estimated: true } : { items: null, estimated: true };
}

/** What was left: none when he ate it all, else confirmed, else the estimate. */
export function leftovers(meal, estimates) {
  if (!meal.after || meal.after.none) return { items: [], estimated: false, pending: false };
  if (meal.after.confirmedAt) return { items: meal.after.leftovers || [], estimated: false, pending: false };
  const e = currentEstimate(meal, estimates, 'after');
  return e?.status === 'done' ? { items: e.leftovers || [], estimated: true, pending: false } : { items: [], estimated: true, pending: true };
}

/** Eaten = on the plate minus left over, item by item (matched by position, then by name). Never below zero. */
export function netItems(before = [], left = []) {
  return before.map((x, i) => {
    const l = left.find((y) => y.index === i) || left.find((y) => y.index == null && String(y.name).toLowerCase() === String(x.name).toLowerCase());
    const g = Math.max(0, (x.grams || 0) - (num(l?.grams) || 0));
    return l ? regram(x, g) : x;
  });
}

/**
 * Where a meal stands, for the list and the meal screen:
 * 'reading' (waiting for the Mac's estimate), 'failed', 'confirm' (estimate to check), 'after' (waiting for the after
 * photo), 'reading-after', 'confirm-after', 'done'.
 */
export function mealState(meal, estimates, now = Date.now()) {
  const b = meal.before || {};
  if (b.photoId && !b.confirmedAt) {
    const e = currentEstimate(meal, estimates, 'before');
    if (!e) return 'reading';
    if (e.status === 'failed') return 'failed';
    return 'confirm';
  }
  if (!meal.after) return meal.source === 'manual' ? 'done' : 'after';
  if (meal.after.none || meal.after.confirmedAt) return 'done';
  const e = currentEstimate(meal, estimates, 'after');
  if (!e) return 'reading-after';
  if (e.status === 'failed') return 'failed-after';
  void now;
  return 'confirm-after';
}

export const STATE_TEXT = {
  reading: 'Waiting for your Mac to read the photo', failed: 'The Mac could not read it', confirm: 'Estimate ready: check it',
  after: 'After photo still to take', 'reading-after': 'Waiting for your Mac to read the after photo', 'failed-after': 'The Mac could not read the after photo',
  'confirm-after': 'Leftovers ready: check them', done: 'Done',
};

/** Short form for the meal list. */
export const STATE_SHORT = {
  reading: 'READING PHOTO', failed: 'NOT READ', confirm: 'CHECK IT', after: 'AFTER PHOTO', 'reading-after': 'READING AFTER',
  'failed-after': 'AFTER NOT READ', 'confirm-after': 'CHECK LEFTOVERS', done: 'DONE',
};

/** Totals eaten for one meal. estimated: some of it isn't confirmed yet. */
export function mealTotals(meal, estimates) {
  const b = beforeItems(meal, estimates);
  if (!b.items) return { grams: 0, kcal: 0, protein: 0, estimated: true, known: false };
  const l = leftovers(meal, estimates);
  const t = itemTotals(netItems(b.items, l.items));
  return { ...t, estimated: b.estimated || l.estimated, known: true };
}

/** Totals for one date: every meal with numbers so far, and how many are still estimates or still being read. */
export function dayTotals(meals, estimates, date) {
  const list = (meals || []).filter((m) => m.date === date);
  const out = { grams: 0, kcal: 0, protein: 0, meals: list.length, estimated: 0, unread: 0 };
  for (const m of list) {
    const t = mealTotals(m, estimates);
    if (!t.known) { out.unread++; continue; }
    out.grams += t.grams; out.kcal += t.kcal; out.protein += t.protein;
    if (t.estimated) out.estimated++;
  }
  out.protein = r1(out.protein);
  return out;
}

/** When the app asks for the after photo: AFTER_PHOTO_MIN minutes after the before photo. */
export const afterPhotoAt = (meal) => (meal.before?.at ?? meal.at) + AFTER_PHOTO_MIN * 60000;

/** Calendar markers (dayMarks extra): one per day with meals: {date, kind: 'meals', label}. */
export function mealMarks(meals = [], estimates = [], tz) {
  const by = new Map();
  for (const m of meals) by.set(m.date, [...(by.get(m.date) || []), m]);
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    const t = dayTotals(list, estimates, date);
    return { date, kind: 'meals', label: `Meals: ${list.length} · ${t.kcal.toLocaleString('en-US')} kcal · ${t.protein} g protein${t.estimated ? ' (estimate)' : ''}`, ids: list.map((m) => m.id) };
  });
}

/** "Lunch · 1:04 PM" */
export const mealTitle = (meal, tz) => `${meal.name} · ${formatTime(new Date(meal.at), zoneOf(meal, tz))}`;

// Meal presets (Thu 10/22, his words: "have them as presets basically. This meal and my next meal"): a meal he eats
// the same way again, logged with one tap (Fuel) or by name to the coach. fuel/presets {kind: 'presets',
// presets: [{id, name, items, savedAt, fromMeal?}]}; items as in a meal, with their kcal and protein.
export const presetsOf = (doc) => (Array.isArray(doc?.presets) ? doc.presets : []).filter((p) => p?.name && Array.isArray(p.items) && p.items.length);

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
/** The preset he means by name: exact (case aside), else the one whose name words are all in his words ("my usual first meal"). */
export function findPreset(doc, name) {
  const list = presetsOf(doc);
  const n = String(name || '').trim().toLowerCase();
  const exact = list.find((p) => p.name.toLowerCase() === n || p.id === name);
  if (exact) return exact;
  const said = words(name);
  const hits = list.filter((p) => words(p.name).every((w) => said.includes(w)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * A meal with nothing in it: no photo and no items (Thu 10/22: "Log it without a photo" saved an empty meal the moment
 * he tapped it, and the Mac took it for his second meal). It counts as no meal for anything.
 */
export const isEmptyMeal = (m) => Boolean(m) && !m.before?.photoId && !(m.before?.items || []).length && !m.after?.photoId;

/**
 * His presets in the order that suits a moment: first the one for the meal time nearest `hm` ("HH:MM"): the preset
 * named like that meal time, else the one in the same place (his first meal time, his first preset), then the rest.
 * slots: his meal times, sorted (fuel-reminders mealTimesOf).
 */
export function presetsFor(presets = [], slots = [], hm = null) {
  if (!presets.length || !slots.length || !/^\d{2}:\d{2}$/.test(hm || '')) return presets;
  const min = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  const i = slots.reduce((best, t, k) => (Math.abs(min(t.time) - min(hm)) < Math.abs(min(slots[best].time) - min(hm)) ? k : best), 0);
  const match = presets.find((p) => p.name.toLowerCase() === String(slots[i].name || '').toLowerCase()) || presets[i] || null;
  return match ? [match, ...presets.filter((p) => p !== match)] : presets;
}

/** A new meal from a preset, logged and confirmed at `at`. */
export function mealFromPreset({ id, at, preset, tz, name, date = null }) {
  const meal = newMeal({ id, at, name: name || preset.name, tz, date });
  return { ...meal, before: { ...meal.before, items: cleanItems(preset.items), confirmedAt: at }, preset: preset.id };
}

/** The presets doc with `name` saved from these items (a preset of the same name is replaced). */
export function withPreset(doc, { name, items, at, fromMeal = null }) {
  const clean = String(name || '').trim().slice(0, 40);
  const list = presetsOf(doc);
  const old = list.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  const preset = { id: old?.id || `preset.${words(clean).join('-') || 'meal'}`, name: clean, items: cleanItems(items), savedAt: at, ...(fromMeal ? { fromMeal } : {}) };
  return { ...(doc || {}), kind: 'presets', presets: old ? list.map((p) => (p === old ? preset : p)) : [...list, preset] };
}
