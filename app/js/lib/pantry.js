// Food stock and the shopping list (Thu 11/5, his list of missing features: "No food stock list (beef, eggs, almonds
// and so on) or shopping list"). He counts what he has; the app works out how long it lasts from his own data and
// lists what runs out within a few days. Nothing is bought, suggested or changed by itself. Pure functions.
//
// pantry  {id: 'pantry.<slug>', name, amount (what he counted), unit: 'g'|'kg'|'count'|'pack', countedAt,
//          perDay: number|null (his own daily use, in the unit), onList: boolean (he put it on the list himself),
//          unitGrams: number|null (grams of one piece or pack, when he said), note}
//
// Daily use, first that applies: his own number (perDay); his logged meals (the average of the last 7 days that have
// meals, at least 3 such days); his planned day (fuel plan foods, gramsPerDay). Left now: his count minus what his
// logged meals used since; a past day with no meal logged at all counts at the daily pace (marked "about").
import { sameFood } from './foods.js';
import { addDays } from './rotation.js';

export const UNITS = ['g', 'kg', 'count', 'pack'];
export const SHOP_DAYS = 3;
const r1 = (x) => Math.round(x * 10) / 10;

export const pantryId = (name) => `pantry.${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}`;

/** The planned-day food this stock item is (same food by name), or null. */
export function planFoodFor(item, plan) {
  const foods = (plan?.foods || []).filter((f) => f?.name);
  return foods.find((f) => f.name === item.food) || foods.find((f) => sameFood(item.name, f.name)) || null;
}

/** Grams in one of the item's units, or null when the app can't tell (a count with no piece weight). */
export function gramsPerUnit(item, plan) {
  if (item.unit === 'g') return 1;
  if (item.unit === 'kg') return 1000;
  if (Number(item.unitGrams) > 0) return Number(item.unitGrams);
  const f = planFoodFor(item, plan);
  if (item.unit === 'count') return Number(f?.unit?.grams || f?.gramsEach) || null;
  if (item.unit === 'pack') return Number(f?.pack?.grams) || null;
  return null;
}

/** Does a meal item (name, fdcId) belong to this stock item? */
function matches(mealItem, item, food) {
  if (food?.fdcId && mealItem.fdcId && Number(mealItem.fdcId) === Number(food.fdcId)) return true;
  return sameFood(mealItem.name, item.name) || (food ? sameFood(mealItem.name, food.name) : false);
}

const mealDate = (m) => m.date;
const loggedMeals = (meals = []) => meals.filter((m) => m && (m.before?.items || []).length);

/** Grams of this item in one meal (what was served). */
const gramsIn = (m, item, food) => (m.before?.items || []).filter((x) => matches(x, item, food)).reduce((a, x) => a + (Number(x.grams) || 0), 0);

/**
 * Daily use in the item's unit: {perDay, from: 'his'|'meals'|'plan'|null}. meals: his logged meals; today: his day
 * (today itself is never in the average, it isn't over).
 */
export function dailyUse(item, { plan = null, meals = [], today }) {
  if (Number(item.perDay) > 0) return { perDay: Number(item.perDay), from: 'his' };
  const g = gramsPerUnit(item, plan);
  if (!g) return { perDay: null, from: null };
  const food = planFoodFor(item, plan);
  const from = addDays(today, -7);
  const days = new Map();
  for (const m of loggedMeals(meals)) {
    const d = mealDate(m);
    if (!(d >= from && d < today)) continue;
    days.set(d, (days.get(d) || 0) + gramsIn(m, item, food));
  }
  if (days.size >= 3) {
    const avg = [...days.values()].reduce((a, x) => a + x, 0) / days.size;
    return { perDay: r1(avg / g), from: 'meals' };
  }
  if (Number(food?.gramsPerDay) > 0) return { perDay: r1(Number(food.gramsPerDay) / g), from: 'plan' };
  return { perDay: null, from: null };
}

/**
 * Where an item stands: {left, perDay, from, days, runsOut, about}. days: whole days it lasts (null without a daily
 * use); runsOut: the date it runs out; about: some of the use since his count is the daily pace, not logged meals.
 */
export function pantryStatus(item, { plan = null, meals = [], today, tzDate = null }) {
  const use = dailyUse(item, { plan, meals, today });
  const g = gramsPerUnit(item, plan);
  const food = planFoodFor(item, plan);
  const countedOn = item.countedOn || (tzDate && item.countedAt ? tzDate(item.countedAt) : null);
  let used = 0; let about = false;
  if (g && item.countedAt) {
    const after = loggedMeals(meals).filter((m) => (m.before?.at ?? m.at) > item.countedAt);
    used += after.reduce((a, m) => a + gramsIn(m, item, food), 0) / g;
    // Whole past days since the count with no meal logged at all: the daily pace.
    if (use.perDay && countedOn) {
      const withMeals = new Set(loggedMeals(meals).map(mealDate));
      for (let d = addDays(countedOn, 1); d < today; d = addDays(d, 1)) if (!withMeals.has(d)) { used += use.perDay; about = true; }
    }
  } else if (!g && use.perDay && countedOn) {
    // His own daily number for something the meals can't count (a count with no piece weight): the pace only.
    for (let d = addDays(countedOn, 1); d <= today; d = addDays(d, 1)) { used += use.perDay; about = true; }
  }
  const left = Math.max(0, r1(Number(item.amount || 0) - used));
  const days = use.perDay ? Math.floor(left / use.perDay + 1e-9) : null;
  return { left, perDay: use.perDay, from: use.from, days, runsOut: days == null ? null : addDays(today, days), about };
}

/**
 * The shopping list: what runs out within `within` days (default 3), what is already gone, and what he put on it
 * himself. Soonest first. [{item, st, why: 'out'|'soon'|'his'}]
 */
export function shoppingList(items = [], ctx, { within = SHOP_DAYS } = {}) {
  return items.filter((i) => i && !i.removed).map((item) => ({ item, st: pantryStatus(item, ctx) }))
    .map((x) => ({ ...x, why: x.st.left <= 0 ? 'out' : x.st.days != null && x.st.days <= within ? 'soon' : x.item.onList ? 'his' : null }))
    .filter((x) => x.why)
    .sort((a, b) => (a.st.days ?? 99) - (b.st.days ?? 99) || a.item.name.localeCompare(b.item.name));
}

/** "2 packs", "1 pack", "600 g", "1.2 kg", "10 eggs" (count with the plan's word for one). */
export function amountOf(item, n, plan = null) {
  const v = r1(n);
  if (item.unit === 'g') return `${Math.round(v).toLocaleString('en-US')} g`;
  if (item.unit === 'kg') return `${v} kg`;
  if (item.unit === 'pack') return `${v} pack${v === 1 ? '' : 's'}`;
  const f = planFoodFor(item, plan);
  const word = v === 1 ? f?.unit?.label : f?.unit?.plural;
  return word ? `${v} ${word}` : `${v}`;
}

/** "lasts 3 days", "runs out today", "daily use unknown". */
export function lastsText(st) {
  if (st.left <= 0) return 'none left';
  if (st.days == null) return 'daily use unknown';
  if (st.days === 0) return 'runs out today';
  return `lasts ${st.about ? 'about ' : ''}${st.days} day${st.days === 1 ? '' : 's'}`;
}

export const FROM_TEXT = { his: 'your number', meals: 'your logged meals, last 7 days', plan: 'your planned day' };

/** A stock item as the screen and the coach save it. */
export function stockItem({ name, amount, unit = 'g', perDay = null, unitGrams = null, now = Date.now(), countedOn = null, cur = null }) {
  const clean = String(name || '').trim().slice(0, 40);
  return {
    ...(cur || {}), id: cur?.id || pantryId(clean), name: cur?.name || clean, amount: Number(amount), unit: UNITS.includes(unit) ? unit : 'g',
    countedAt: now, countedOn, perDay: perDay == null ? cur?.perDay ?? null : Number(perDay) > 0 ? Number(perDay) : null,
    unitGrams: unitGrams == null ? cur?.unitGrams ?? null : Number(unitGrams) > 0 ? Number(unitGrams) : null, onList: false, removed: false,
  };
}
