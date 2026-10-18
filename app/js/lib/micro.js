// Vitamins and minerals (A12): his diet analysis inside the app, computed from what he actually logs. Food from the
// bundled USDA per-100 g values (lib/foods.js), as eaten (his analysis's cooking factors on raw beef and eggs) and raw;
// supplements by label stoichiometry on the days he ticked them taken; against the references his analysis uses, each
// with its source (fuel doc 'micro', private). Numbers only: no advice, nothing suggested, his accepted points noted.
import { valuesFor } from './foods.js';
import { beforeItems, leftovers, netItems } from './meals.js';
import { addDays } from './rotation.js';

const r2 = (x) => Math.round(x * 100) / 100;

/** What he ate on a date: every meal's items, leftovers off (confirmed numbers, else the estimate). */
export function eatenItems(meals = [], estimates = [], date) {
  return meals.filter((m) => m.date === date).flatMap((m) => {
    const b = beforeItems(m, estimates);
    if (!b.items) return [];
    return netItems(b.items, leftovers(m, estimates).items);
  });
}

/**
 * Nutrients in food items: {eaten, raw, missing: {key: [food names without a USDA value]}, notCounted: [names]}.
 * EPA and DHA in mg (USDA gives grams). Carnitine: USDA has none; his analysis counts about 350 mg a day from 500 g
 * beef, so the same per gram for his beef.
 */
export function foodNutrients(db, items = [], { micro = {}, plan = {} } = {}) {
  const eaten = {}; const raw = {}; const missing = {}; const notCounted = [];
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const factors = micro.retention?.factors || {};
  const cooked = new Set(micro.retention?.foods || []);
  const overrides = new Map((plan.foods || []).filter((f) => f.fdcId && f.per100Override).map((f) => [Number(f.fdcId), f.per100Override]));
  const carn = (micro.references || []).find((r) => r.key === 'carnitine');
  const beefIds = new Set((plan.foods || []).filter((f) => /beef/i.test(f.name) && f.fdcId).map((f) => Number(f.fdcId)));
  const beefGrams = (plan.foods || []).filter((f) => beefIds.has(Number(f.fdcId))).reduce((a, f) => a + (Number(f.gramsPerDay) || 0), 0);
  for (const x of items) {
    const g = Number(x.grams) || 0;
    if (!g) continue;
    const food = x.fdcId && db?.byId.get(Number(x.fdcId));
    if (!food) {
      if (x.source === 'label' && x.labelSodiumMg != null) add(raw, 'sodium', x.labelSodiumMg), add(eaten, 'sodium', x.labelSodiumMg);
      else if (x.source !== 'label') notCounted.push(x.name);
      continue;
    }
    const v = valuesFor(db, food, g);
    for (const [k, per100] of Object.entries(overrides.get(food.id) || {})) if (typeof per100 === 'number') v[k] = per100 * g / 100;
    for (const k of ['epa', 'dha']) if (v[k] != null) v[k] *= 1000;
    for (const [k, val] of Object.entries(v)) {
      if (['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugars', 'satFat'].includes(k)) continue;
      // A food without a value for this nutrient makes the total incomplete, unless it is a small amount (salt).
      if (val == null) { if (g >= 10) (missing[k] ||= []).push(x.name); continue; }
      add(raw, k, val);
      add(eaten, k, cooked.has(food.id) && factors[k] ? val * factors[k] : val);
    }
    if (carn?.dietMg && beefGrams && beefIds.has(food.id)) { const c = carn.dietMg * g / beefGrams; add(raw, 'carnitine', c); add(eaten, 'carnitine', c); }
  }
  return { eaten, raw, missing, notCounted };
}

/** Supplements taken on a date by his label stoichiometry: {amounts: {key: n}, taken: [{id, name, amounts}]}. */
export function suppNutrients(micro = {}, { supplements = [], log = [], date, dayKind = 'train' } = {}) {
  const amounts = {}; const taken = [];
  const spec = micro.supplements || {};
  for (const s of supplements) {
    const sp = spec[s.id];
    if (!sp) continue;
    const e = log.find((x) => x.date === date && x.suppId === s.id);
    if (e?.status !== 'taken') continue;
    const a = { ...(sp.perDay || {}) };
    if (sp.perTablet) { const n = sp.tablets?.[dayKind] ?? 1; for (const [k, v] of Object.entries(sp.perTablet)) a[k] = (a[k] || 0) + v * n; }
    for (const [k, v] of Object.entries(a)) amounts[k] = (amounts[k] || 0) + v;
    if (Object.keys(a).length) taken.push({ id: s.id, name: s.name, amounts: a });
  }
  return { amounts, taken };
}

/** Food + supplements for one date: {eaten, raw, supp, missing, notCounted, items, taken}. */
export function dayMicro(db, { meals, estimates, plan, micro, supplements, suppLog, date, dayKind }) {
  const items = eatenItems(meals, estimates, date).map((x) => (x.source === 'label' ? { ...x, labelSodiumMg: labelSodium(plan, x) } : x));
  const f = foodNutrients(db, items, { micro, plan });
  const s = suppNutrients(micro, { supplements, log: suppLog, date, dayKind });
  return { ...f, supp: s.amounts, taken: s.taken, items: items.length };
}

const labelSodium = (plan, x) => { const f = (plan?.foods || []).find((p) => p.label && p.name === x.name); return f?.label?.sodiumMg != null ? f.label.sodiumMg * (Number(x.grams) || 0) / (f.label.perGrams || 100) : null; };

/** Seven days ending on `date`, averaged over the days with food logged (supplements over the same days). */
export function weekMicro(db, o) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(o.date, i - 6));
  const per = days.map((d) => ({ date: d, ...dayMicro(db, { ...o, date: d, dayKind: o.dayKindOf ? o.dayKindOf(d) : o.dayKind }) })).filter((x) => x.items > 0);
  const avg = (key) => { const out = {}; for (const x of per) for (const [k, v] of Object.entries(x[key])) out[k] = (out[k] || 0) + v / per.length; return out; };
  const missing = {}; for (const x of per) for (const [k, v] of Object.entries(x.missing)) missing[k] = [...new Set([...(missing[k] || []), ...v])];
  return { eaten: avg('eaten'), raw: avg('raw'), supp: avg('supp'), missing, notCounted: [...new Set(per.flatMap((x) => x.notCounted))], days: per.length, items: per.reduce((a, x) => a + x.items, 0) };
}

/** His planned day (fuel plan foods) and the supplements as his analysis averages them. */
export function plannedMicro(db, { plan, micro }) {
  const items = (plan?.foods || []).filter((f) => f.fdcId).map((f) => ({ name: f.name, fdcId: f.fdcId, grams: f.gramsPerDay }));
  const f = foodNutrients(db, items, { micro, plan });
  const sodium = (plan?.foods || []).filter((x) => x.label?.sodiumMg).reduce((a, x) => a + x.label.sodiumMg * (x.gramsPerDay || 0) / (x.label.perGrams || 100), 0);
  if (sodium) { f.eaten.sodium = (f.eaten.sodium || 0) + sodium; f.raw.sodium = (f.raw.sodium || 0) + sodium; }
  return { ...f, supp: { ...(micro?.plannedSupplements || {}) } };
}

const pctOf = (v, ref) => (ref ? Math.round((v / ref) * 100) : null);

/**
 * One row per reference: {key, name, unit, group, eaten, raw, supp, total, ref text, pct, ul, limitUsed, accepted,
 * incomplete: [foods without a value], over: true when above the limit and not one he accepted}.
 */
export function microRows(micro = {}, t, plannedT = null) {
  const val = (src, k) => (src?.[k] || 0);
  const total = (T, ref, side = 'eaten') => {
    if (!T) return null;
    if (ref.sumOf) return ref.sumOf.reduce((a, k) => a + val(T[side], k) + val(T.supp, k), 0);
    if (ref.fromSodium) return (val(T[side], 'sodium') + val(T.supp, 'sodium')) * ref.fromSodium;
    return val(T[side], ref.key) + val(T.supp, ref.key);
  };
  return (micro.references || []).map((ref) => {
    const amount = total(t, ref);
    const rawAmount = total(t, ref, 'raw');
    const refVal = ref.perMJ ? ref.perMJ * (micro.energyBasisMJ || 0) : ref.ref;
    const lo = Array.isArray(refVal) ? refVal[0] : refVal; const hi = Array.isArray(refVal) ? refVal[1] : null;
    const supp = ref.sumOf ? ref.sumOf.reduce((a, k) => a + val(t?.supp, k), 0) : val(t?.supp, ref.key);
    const limitBase = ref.ulSupplementalOnly ? supp : amount;
    const limitUsed = ref.ul ? Math.round((limitBase / ref.ul) * 100) : null;
    const missing = ref.sumOf ? [...new Set(ref.sumOf.flatMap((k) => t?.missing?.[k] || []))] : ref.fromSodium ? (t?.missing?.sodium || []) : (t?.missing?.[ref.key] || []);
    // His accepted points (no nagging), only in the situation he accepted: thiamin a little under, zinc above, ...
    const acc = micro.accepted?.[ref.key];
    const pct = pctOf(amount, lo);
    const fits = !acc || typeof acc === 'string' ? !!acc
      : acc.minPct != null ? pct != null && pct >= acc.minPct
        : acc.above ? (pct != null && pct > 100) || (ref.ul && limitBase > ref.ul)
          : acc.within ? (hi ? amount >= lo && amount <= hi : true) : true;
    const accepted = fits ? (typeof acc === 'string' ? acc : acc.text) : null;
    return {
      key: ref.key, name: ref.name, unit: ref.unit, group: ref.group,
      total: r2(amount || 0), raw: r2(rawAmount || 0), supp: r2(supp || 0),
      planned: plannedT ? r2(total(plannedT, ref) || 0) : null,
      ref: refVal == null ? null : Array.isArray(refVal) ? refVal : r2(refVal), refNote: ref.refNote, atLeast: !!ref.atLeast,
      pct: hi ? null : pct, within: hi ? (amount < lo ? 'below' : amount > hi ? 'above' : 'within') : null,
      ul: ref.ul, ulNote: ref.ulNote, ulSupplementalOnly: !!ref.ulSupplementalOnly, ulInfo: !!ref.ulInfo, limitUsed,
      altLimit: ref.ulAlt ? { value: ref.ulAlt.value, note: ref.ulAlt.note, used: Math.round((limitBase / ref.ulAlt.value) * 100) } : null,
      accepted, incomplete: missing, over: !!(ref.ul && !ref.ulInfo && limitBase > ref.ul && !accepted),
    };
  });
}

export const GROUPS = [['vitamins', 'Vitamins'], ['minerals', 'Minerals'], ['fatty', 'Fatty acids'], ['other', 'Other']];
