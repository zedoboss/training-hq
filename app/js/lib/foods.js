// Food values (A5): USDA FoodData Central per-100 g values, the same source as his diet analysis, bundled in
// app/data/usda-foods.json (scripts/build-usda.mjs) so they work on the phone with no connection and on the Mac.
// A meal item that matches a USDA food carries its fdcId; its kcal and protein are computed from the USDA values and
// its grams (source 'usda'). An item with no match keeps the Mac's estimate (source 'estimate') or his own numbers
// (source 'typed'). Pure functions over an indexed database; loadFoods() fetches the file in the app.

const STOP = new Set(['and', 'with', 'of', 'the', 'a', 'an', 'in', 'or', 'for', 'to', 'from', 'w', 'plain']);
const COOKED = /\b(cooked|boiled|fried|roasted|grilled|baked|steamed|broiled|braised|stewed|scrambled|poached|pan)\b/;

const SPELLING = { iodised: 'iodized', yoghurt: 'yogurt', fibre: 'fiber', mince: 'ground', minced: 'ground', aubergine: 'eggplant', courgette: 'zucchini', prawn: 'shrimp', porridge: 'oatmeal' };
// Prepared and special-purpose groups: shown, but after plain foods unless the words point there.
const LATER = new Set(['Baby Foods', 'Fast Foods', 'Restaurant Foods', 'Meals, Entrees, and Side Dishes', 'American Indian/Alaska Native Foods', 'Snacks', 'Sweets', 'Baked Products', 'Breakfast Cereals']);

/** "Eggs, whole" -> ['egg', 'whole']: lower case, words, simple plural endings dropped. */
export function tokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !STOP.has(t)).map((t) => stem(SPELLING[t] || t));
}
function stem(t) {
  if (t.length <= 3) return t;
  if (t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.endsWith('oes')) return t.slice(0, -2);
  if (/(ches|shes|xes|sses)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
  return t;
}

/** The bundled file, indexed: {source, nutrients, keys, foods: [...], byId: Map}. */
export function indexFoods(raw) {
  const keys = raw.nutrients.map((n) => n.key);
  const foods = raw.foods.map(([id, name, ds, cat, v, portions]) => {
    const head = tokens(name.split(',')[0]);
    return { id, name, ds, category: raw.categories[cat] || '', v, portions: portions || [], tokens: tokens(name), head, filled: v.filter((x) => x != null).length };
  });
  return { source: raw.source, nutrients: raw.nutrients, keys, foods, byId: new Map(foods.map((f) => [f.id, f])) };
}

/** Per-100 g value of one nutrient (null when USDA has none). */
export const per100 = (db, food, key) => { const i = db.keys.indexOf(key); return i < 0 ? null : food.v[i] ?? null; };

/** Every nutrient for an amount of a food: {kcal, protein, fat, ...} (null where USDA has no value). */
export function valuesFor(db, food, grams) {
  const f = (Number(grams) || 0) / 100;
  return Object.fromEntries(db.keys.map((k, i) => [k, food.v[i] == null ? null : food.v[i] * f]));
}

const r1 = (x) => Math.round(x * 10) / 10;

/** A meal item for grams of a USDA food (kcal and protein from USDA). name: what he calls it, else USDA's words. */
export function foodItem(db, food, grams, { name = null, unsure = false } = {}) {
  const v = valuesFor(db, food, grams);
  return { name: name || shortName(food.name), grams: Math.round(Number(grams) || 0), kcal: Math.round(v.kcal || 0), protein: r1(v.protein || 0), unsure, fdcId: food.id, source: 'usda' };
}

/** "Rice, white, long-grain, regular, unenriched, cooked without salt" -> "Rice, white, long-grain, cooked" style. */
export function shortName(desc) {
  const parts = String(desc).split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 3) return parts.join(', ');
  const keep = parts.slice(0, 2);
  const cook = parts.slice(2).find((p) => /raw|cooked|boiled|roasted|fried|dried|grilled|baked/i.test(p));
  return [...keep, ...(cook ? [cook] : [])].join(', ');
}

/** How well a text matches a food: 0 (no) to about 1.6. Every word he typed should be found. */
export function score(food, q, { prefer = null } = {}) {
  if (!q.length) return 0;
  let got = 0; let hits = 0;
  for (const t of q) {
    if (food.tokens.includes(t)) { got += 1; hits++; } else if (t.length >= 3 && food.tokens.some((d) => d.startsWith(t))) { got += 0.8; hits++; }
  }
  const cover = got / q.length;
  if (cover < 0.5) return 0;
  let s = cover - 0.015 * Math.max(0, food.tokens.length - hits);
  // The food itself (the part before the first comma) is what he named: "Egg, whole" for eggs, not "Eggplant".
  if (food.head.length && food.head.every((h) => q.includes(h))) s += 0.1;
  const qCooked = COOKED.test(q.join(' '));
  if (!qCooked && food.tokens.includes('raw')) s += 0.03;
  if (qCooked && COOKED.test(food.tokens.join(' '))) s += 0.03;
  if (food.tokens.includes('whole') && !q.some((t) => ['yolk', 'white'].includes(t))) s += 0.01;
  if (LATER.has(food.category)) s -= 0.06;
  if (prefer?.has(food.id)) s += 0.5;
  // USDA's own words (the Mac names foods that way): that entry, not a neighbour.
  if (q.length === food.tokens.length && hits === q.length && q.every((t, i) => t === food.tokens[i])) s += 0.3;
  return s;
}

/** Foods matching a text, best first. prefer: fdcIds of his own foods, ranked first when they match. */
export function searchFoods(db, text, { limit = 8, prefer = [] } = {}) {
  const q = tokens(text);
  if (!q.length) return [];
  const pref = new Set(prefer);
  const out = [];
  for (const f of db.foods) {
    const s = score(f, q, { prefer: pref });
    if (s > 0) out.push({ food: f, score: s });
  }
  return out.sort((a, b) => b.score - a.score || b.food.filled - a.food.filled || a.food.name.length - b.food.name.length).slice(0, limit);
}

/** The best USDA food for a text, or null when nothing matches well (most of his words must be in it). */
export function matchFood(db, text, { prefer = [] } = {}) {
  const best = searchFoods(db, text, { limit: 1, prefer })[0];
  return best && best.score >= 0.75 ? best.food : null;
}

/**
 * Items with kcal and protein from USDA where possible:
 * - an item with an fdcId the database knows: values from USDA for its grams;
 * - else a match for its usda description (the Mac's reading) or its name: fdcId set, values from USDA;
 * - else kept as it is, marked 'estimate' (or 'typed' when he typed the numbers).
 * His own foods (prefer, with names) give their name and id first.
 */
export function withUsda(db, items, { prefer = [], keepTyped = true } = {}) {
  const mine = new Map(prefer.filter((p) => p?.fdcId).map((p) => [p.fdcId, p]));
  return (items || []).map((x) => {
    if (keepTyped && x.source === 'typed') return x;
    let food = x.fdcId ? db.byId.get(Number(x.fdcId)) : null;
    if (!food && x.usda) food = matchFood(db, x.usda, { prefer: [...mine.keys()] });
    if (!food && x.name) food = matchFood(db, x.name, { prefer: [...mine.keys()] });
    if (!food) { const { usda, ...rest } = x; return { ...rest, source: rest.source || 'estimate' }; }
    const name = mine.get(food.id)?.name || x.name;
    return foodItem(db, food, x.grams, { name, unsure: !!x.unsure });
  });
}

/** One line for the source of a meal's numbers. */
export const SOURCE_NOTE = 'kcal and protein: USDA FoodData Central per 100 g × grams';

let loading = null;
/** The bundled database (fetched once; the service worker keeps it for offline use). */
export function loadFoods(url = new URL('../../data/usda-foods.json', import.meta.url)) {
  if (!loading) loading = fetch(url).then((r) => { if (!r.ok) throw new Error(`foods: HTTP ${r.status}`); return r.json(); }).then(indexFoods).catch((e) => { loading = null; throw e; });
  return loading;
}
