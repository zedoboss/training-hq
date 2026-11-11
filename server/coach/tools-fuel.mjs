// The coach's fuel tools (Thu 11/5): what his screens can do that the coach had no tool for. Each only on his words.
//   supplement_list  add, remove, pause, resume or change a supplement on his list (the My list screen), or delete an
//                    old taken/skipped answer. His hard rule: the app never suggests a supplement or a dose and never
//                    changes his list by itself, so every action needs his own words (said).
//   meal_edit        move a meal to another day, copy one to today or another day, rename, delete or edit a preset.
//   my_food          save one of his usual foods with his own numbers (no USDA match), so log_meal logs it; remove one.
//   fuel_settings    his meal times (time, latest, cook minutes = the start-cooking reminder) and his daily targets.
import { snapshot, dayText, timeText, findByName, wrote, refuse, formatHm } from './shared.mjs';
import { put, del, num, ITEMS, mealItems, momentOf } from './tools-write.mjs';
import { mealsText, suppDayKind } from './tools-read.mjs';
import { newMeal, cleanItems, itemTotals, presetsOf, findPreset, beforeItems, leftovers, netItems } from '../../app/js/lib/meals.js';
import { withUsda, sameFood, gramsFor, amountText, itemAmount } from '../../app/js/lib/foods.js';
import { foodsDb, myFoods, macrosText } from '../foods.mjs';
import { WEEKDAYS, FOOD_TEXT, statusOn, withStatus, logId, daysText, doseFor, stockStatus, lastsText } from '../../app/js/lib/supplements.js';
import { mealTimesOf, mealFitIssues } from '../../app/js/lib/fuel-reminders.js';
import { withDefaults } from '../../app/js/lib/settings.js';
import { zonedTime, hmOf, isoDate, daysBetween, addMinutesHm } from '../../app/js/lib/time.js';
import { addDays } from '../../app/js/lib/rotation.js';
import { newId } from '../../app/js/lib/routines.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HM = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: '24-hour "HH:MM" in his time zone' };
const HM_OR_EMPTY = { type: 'string', pattern: '^(([01]\\d|2[0-3]):[0-5]\\d)?$', description: '24-hour "HH:MM", or "" to clear it' };
const SAID = { type: 'string', description: 'his own words asking for this, quoted from his message' };
const DAY = { type: 'string', enum: WEEKDAYS };

const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const n0 = (x) => Math.round(Number(x) || 0).toLocaleString('en-US');
const r1 = (x) => Math.round(Number(x) * 10) / 10;
const saidOf = (a) => String(a.said || '').trim().slice(0, 300);
const dayLine = (ctx, date) => mealsText(snap(ctx), { date }).split('\n')[0];

// ---- meal items (as log_meal reads them: his own foods first, then USDA; his numbers kept as his) ------------------

const itemsRefusal = ({ noSize, unknown }) => (noSize.length
  ? `No grams for ${noSize.map((x) => `"${x.name}"`).join(', ')}: packs and counts work only for his foods that have them. Ask him for the grams. Nothing changed.`
  : `No USDA match for ${unknown.map((x) => `"${x.name}"`).join(', ')}. Give its USDA description (usda), ask him for its numbers, or save it as his food (my_food). Nothing changed.`);
const itemText = (s) => { const mine = myFoods(s.one('fuel', 'plan')); return (x) => `${x.name} ${itemAmount(x, mine)}${x.source === 'label' ? ' (his numbers)' : x.source === 'typed' ? ' (his numbers)' : x.source === 'usda' ? '' : ' (estimate)'}`; };
// Wed 11/11: carbs and fat with kcal and protein (his own foods' labels need his plan, s).
const totalsText = (items, s) => { const t = itemTotals(items); return `${n0(t.kcal)} kcal, ${t.protein} g protein, ${macrosText(items, { mine: myFoods(s.one('fuel', 'plan')) })}`; };

// ---- supplement_list ----------------------------------------------------------------------------------------------

function findSupp(list, name) {
  return findByName(list, name, (x) => x.name, (x) => [x.short, String(x.id).replace(/^supp\./, '')]);
}

/** The days rule from his words: daily, some weekdays, or n days a week (6 with a day off). */
function daysFrom(a, cur) {
  if (a.days == null) return null;
  if (a.days === 'daily') return { days: { type: 'daily' } };
  if (a.days === 'weekdays') {
    const wd = [...new Set((a.weekdays || []).map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0))].sort();
    return wd.length ? { days: { type: 'weekdays', weekdays: wd } } : { error: 'weekdays: which days of the week.' };
  }
  const count = Math.round(num(a.per_week) ?? 6);
  if (!(count >= 1 && count <= 7)) return { error: 'per_week: 1 to 7 days.' };
  if (count === 7) return { days: { type: 'daily' } };
  const off = a.off_day ? WEEKDAYS.indexOf(a.off_day) : cur?.days?.type === 'perWeek' ? cur.days.offDay ?? null : null;
  return { days: { type: 'perWeek', count, offDay: off } };
}

/** What changed, in words, for the item's dated change log (as the supplement screen words it). */
function describeSupp(a, b) {
  const out = [];
  if (a.name !== b.name) out.push(`name ${b.name}`);
  if ((a.dose || '') !== (b.dose || '')) out.push(b.dose ? `dose ${b.dose}` : 'no dose');
  if ((a.doseRest || '') !== (b.doseRest || '')) out.push(b.doseRest ? `rest-day dose ${b.doseRest}` : 'no separate rest-day dose');
  if ((a.time || '') !== (b.time || '')) out.push(b.time ? `time ${formatHm(b.time)}` : 'no time');
  if ((a.withFood || '') !== (b.withFood || '')) out.push(b.withFood ? FOOD_TEXT[b.withFood] : 'with food not set');
  if (JSON.stringify(a.days || { type: 'daily' }) !== JSON.stringify(b.days || { type: 'daily' })) out.push(daysText(b.days));
  if (a.stock?.servings !== b.stock?.servings || a.stock?.countedAt !== b.stock?.countedAt) out.push(b.stock ? `${b.stock.servings} servings left` : 'stock not tracked');
  if (JSON.stringify(a.perTake || { train: 1, rest: 1 }) !== JSON.stringify(b.perTake || { train: 1, rest: 1 })) out.push(`servings per tick ${b.perTake.train} (training day) / ${b.perTake.rest} (rest day)`);
  if ((a.note || '') !== (b.note || '')) out.push('note');
  return out.join(', ');
}

/** The fields he gave, on top of a supplement. {next} or {error}. */
function withFields(s, cur, a) {
  const next = { ...cur };
  if (a.name != null && String(a.name).trim()) { const n = String(a.name).trim().slice(0, 60); if (n !== cur.name) { next.name = n; next.short = n; } }
  if (a.dose !== undefined) next.dose = String(a.dose || '').trim().slice(0, 80);
  if (a.dose_rest !== undefined) next.doseRest = String(a.dose_rest || '').trim().slice(0, 80) || null;
  if (a.time !== undefined) next.time = a.time || null;
  if (a.with_food !== undefined) next.withFood = a.with_food || null;
  if (a.note !== undefined) next.note = String(a.note || '').trim().slice(0, 400);
  const d = daysFrom(a, cur);
  if (d?.error) return { error: d.error };
  if (d) next.days = d.days;
  if (a.servings !== undefined) {
    const v = num(a.servings);
    if (!(v >= 0 && v < 10000)) return { error: 'servings: a count, 0 or more.' };
    else next.stock = { servings: v, countedAt: s.now };
  }
  if (a.per_tick != null || a.per_tick_rest != null) {
    const t = num(a.per_tick) ?? cur.perTake?.train ?? 1; const r = num(a.per_tick_rest) ?? num(a.per_tick) ?? cur.perTake?.rest ?? 1;
    if (!(t >= 0 && t <= 20) || !(r >= 0 && r <= 20)) return { error: 'Servings per tick: 0 to 20.' };
    next.perTake = { train: t, rest: r };
  }
  return { next };
}

const factsText = (x) => [x.dose || 'no dose set', x.doseRest ? `rest days ${x.doseRest}` : '', x.time ? formatHm(x.time) : 'no time set', x.withFood ? FOOD_TEXT[x.withFood] : '', daysText(x.days),
  x.stock ? `${x.stock.servings} servings left` : '', x.perTake && (x.perTake.train !== 1 || x.perTake.rest !== 1) ? `${x.perTake.train} per tick (rest days ${x.perTake.rest})` : ''].filter(Boolean).join(', ');

function daysNote(days) {
  if (days?.type !== 'perWeek') return '';
  if (days.count === 6 && days.offDay == null) return ' No day off chosen yet: it stays on every day until he picks one.';
  if (days.count < 6) return ' With fewer than 6 days the app counts it for stock only; for set days, use days: weekdays.';
  return '';
}

async function supplementList(a, ctx) {
  const s = snap(ctx);
  const today = s.today;
  const said = saidOf(a);
  if (!said) return refuse('said: his words asking for this, quoted. Only he changes his supplements; nothing changed.');
  const all = s.list('supplements');
  const onList = all.filter((x) => statusOn(x, today) !== 'removed');
  const change = (text) => ({ on: today, text: `${text} (coach, his words: "${said}")` });

  if (a.action === 'add') {
    const name = String(a.name || '').trim().slice(0, 60);
    if (!name) return refuse('Which supplement? Its name as he says it.');
    const same = all.find((x) => norm(x.name) === norm(name) || (x.short && norm(x.short) === norm(name)));
    if (same && statusOn(same, today) !== 'removed') return refuse(`${same.name} is already on his list (${statusOn(same, today)}). To change it: action change${statusOn(same, today) === 'paused' ? '; to take it again: action resume' : ''}.`);
    const base = same ? withStatus(same, 'active', today) : {
      id: newId('supp'), kind: 'supplement', name, short: name, dose: '', doseRest: null, time: null, withFood: null, days: { type: 'daily' }, status: 'active',
      history: [{ on: today, status: 'active' }], stock: null, perTake: { train: 1, rest: 1 }, note: '', order: all.length, source: `Added by the coach on his words, ${today}`, changes: [],
    };
    const f = withFields(s, base, { ...a, name: undefined });
    if (f.error) return refuse(`${f.error} Nothing changed.`);
    const next = { ...f.next, changes: [...(base.changes || []), change(same ? `Taken again: ${describeSupp(same, f.next) || 'as before'}` : 'Added')] };
    put(s, 'supplements', next.id, next);
    // From his considering list: marked added, as the screen does.
    const cons = s.list('supp-considering').find((c) => c.status === 'considering' && (norm(c.name) === norm(name) || sameFood(c.name, name)));
    if (cons) put(s, 'supp-considering', cons.id, { ...cons, status: 'added', addedToList: today, suppId: next.id });
    const missing = [!next.dose && 'dose', !next.time && 'time', !next.withFood && 'with food or not'].filter(Boolean);
    return wrote(`${same ? 'Back on his list' : 'Added to his list'}: ${next.name}: ${factsText(next)}. On his checklist from ${dayText(today, today)}.${daysNote(next.days)}${cons ? ' Off his considering list (added).' : ''}${missing.length ? ` Not set: ${missing.join(', ')}; ask him, never suggest one.` : ''}`, `${next.name} added`);
  }

  if (a.action === 'delete_answer') {
    // Any answer on any past day, also for one no longer on his list.
    const date = a.date || s.foodDay();
    if (date > today) return refuse('That day is still to come: no answers on it.');
    const { item: supp, ambiguous } = findSupp(all, a.supplement || '');
    if (!supp) return refuse(ambiguous.length ? `Which one: ${ambiguous.join(' or ')}?` : `No supplement "${a.supplement}" on his list or in its history.`);
    const e = s.one('supp-log', logId(date, supp.id));
    if (!e) return refuse(`No answer for ${supp.name} on ${dayText(date, today)}: nothing to delete.`);
    del(s, 'supp-log', e.id);
    const back = e.status === 'taken' && supp.stock && (e.at > (supp.stock.countedAt || 0)) ? ` Its ${e.servings ?? 1} serving${(e.servings ?? 1) === 1 ? '' : 's'} back on the count.` : '';
    return wrote(`Deleted his ${e.status} answer for ${supp.name} on ${dayText(date, today)} (${timeText(e.at, s.tz)}${e.reason ? `, "${e.reason}"` : ''}). That day shows it open again.${back}`, `${supp.short || supp.name} ${date}: answer deleted`);
  }

  const { item: supp, ambiguous } = findSupp(onList, a.supplement || a.name || '');
  if (!supp) {
    const gone = !ambiguous.length && findSupp(all, a.supplement || a.name || '').item;
    return refuse(ambiguous.length ? `Which one: ${ambiguous.join(' or ')}?` : gone ? `${gone.name} was removed from his list. To take it again: action add with its name.` : `"${a.supplement || a.name || ''}" isn't on his list.`);
  }
  const status = statusOn(supp, today);

  if (a.action === 'remove' || a.action === 'pause' || a.action === 'resume') {
    const to = a.action === 'remove' ? 'removed' : a.action === 'pause' ? 'paused' : 'active';
    if (status === to) return refuse(`${supp.name} is already ${to}.`);
    const text = a.action === 'remove' ? 'Removed' : a.action === 'pause' ? 'Paused' : 'Taken again from today';
    put(s, 'supplements', supp.id, { ...withStatus(supp, to, today), changes: [...(supp.changes || []), change(text)] });
    const out = { removed: `Removed ${supp.name} from his list from ${dayText(today, today)}; its history stays. Off his checklist and reminders.`, paused: `Paused ${supp.name} from ${dayText(today, today)}: off his checklist and reminders until he takes it again.`, active: `${supp.name} is back on his checklist from ${dayText(today, today)}.` };
    return wrote(out[to], `${supp.short || supp.name} ${to}`);
  }

  if (a.action === 'change') {
    const f = withFields(s, supp, a);
    if (f.error) return refuse(`${f.error} Nothing changed.`);
    const what = describeSupp(supp, f.next);
    if (!what) return refuse(`Nothing to change on ${supp.name}: give what he said (dose, rest-day dose, days, servings, servings per tick, time, with food, name or note).`);
    put(s, 'supplements', supp.id, { ...f.next, changes: [...(supp.changes || []), change(`Changed: ${what}`)] });
    const st = stockStatus(f.next, s.list('supp-log'));
    return wrote(`${f.next.name}: ${what}. Now ${factsText(f.next)}${st ? `; lasts ${lastsText(st.days)}` : ''}.${daysNote(f.next.days)} Today's dose: ${doseFor(f.next, suppDayKind(s, today)) || 'not set'}.`, `${f.next.short || f.next.name} changed`);
  }
  return refuse('action: add, remove, pause, resume, change or delete_answer.');
}

// ---- meal_edit ----------------------------------------------------------------------------------------------------

const presetsDoc = (s) => s.one('fuel', 'presets') || { kind: 'presets', presets: [] };
const presetNames = (s) => presetsOf(presetsDoc(s)).map((p) => p.name).join(', ') || 'none';
const savePresets = (s, doc, presets) => put(s, 'fuel', 'presets', { ...doc, kind: 'presets', presets });

async function mealEdit(a, ctx) {
  const s = snap(ctx);
  const today = s.today;
  const findMeal = () => (a.meal ? s.one('meals', a.meal) : null);

  if (a.action === 'move') {
    const meal = findMeal();
    if (!meal) return refuse(`No meal with id ${a.meal}. The meals tool lists the ids (meals with a date for another day).`);
    if (!a.date) return refuse('date: the day it goes to.');
    if (a.date > today) return refuse('That day is still to come. Meals are logged once eaten.');
    if (a.date === meal.date && !a.time) return refuse(`${meal.name} is already on ${dayText(meal.date, today)}. To change its time: correct_meal time.`);
    const tz = meal.tz || s.tz;
    // The same clock time on the new day (a meal after midnight for its day stays after midnight), unless he says a time.
    const at = a.time ? momentOf(s, a.date, a.time) : zonedTime(addDays(isoDate(new Date(meal.at), tz), daysBetween(meal.date, a.date)), hmOf(new Date(meal.at), tz), tz);
    if (at > s.now + 3600000) return refuse('That time is still to come. Meals are logged once eaten.');
    put(s, 'meals', meal.id, { ...meal, date: a.date, at, movedFrom: meal.date });
    return wrote(`Moved ${meal.name} [id ${meal.id}] from ${dayText(meal.date, today)} to ${dayText(a.date, today)}, ${timeText(at, s.tz)}.\n${dayLine(ctx, a.date)}\n${dayLine(ctx, meal.date)}`, `${meal.name} moved to ${a.date}`);
  }

  if (a.action === 'copy') {
    const meal = findMeal();
    if (!meal) return refuse(`No meal with id ${a.meal}. The meals tool lists the ids (meals with a date for another day).`);
    const est = s.list('meal-estimates');
    const b = beforeItems(meal, est);
    const left = leftovers(meal, est);
    const items = cleanItems(netItems(b.items || [], left.items)).filter((x) => x.grams > 0 || x.kcal > 0);
    if (!b.items || !items.length) return refuse(`${meal.name} has no items to copy yet${b.items ? '' : ' (its photo is still being read)'}. Nothing logged.`);
    const date = a.date || s.foodDay();
    if (date > today) return refuse('That day is still to come. Meals are logged once eaten.');
    const at = a.time ? momentOf(s, date, a.time) : date === s.foodDay() ? s.now : momentOf(s, date, hmOf(new Date(meal.at), meal.tz || s.tz));
    if (at > s.now + 3600000) return refuse('That time is still to come. Meals are logged once eaten.');
    const id = newId('meal');
    const next = newMeal({ id, at, name: a.name ? String(a.name).slice(0, 40) : meal.name, tz: s.tz, date });
    next.before = { ...next.before, items, confirmedAt: s.now };
    next.by = 'coach';
    next.copiedFrom = meal.id;
    if (a.away != null) next.away = Boolean(a.away);
    if (a.cooked != null) next.cooked = Boolean(a.cooked);
    put(s, 'meals', id, next);
    return wrote(`Copied ${meal.name} of ${dayText(meal.date, today)} to ${dayText(date, today)}, ${timeText(at, s.tz)} as ${next.name} [id ${id}]: ${items.map(itemText(s)).join(', ')}; ${totalsText(items, s)}${left.items.length ? ' (what he ate that day, leftovers off)' : ''}.\n${dayLine(ctx, date)}`, `${next.name} copied to ${date}`);
  }

  const doc = presetsDoc(s);
  const preset = a.preset ? findPreset(doc, a.preset) : null;
  if (!preset) return refuse(a.preset ? `No preset "${a.preset}". His presets: ${presetNames(s)}.` : `preset: which one. His presets: ${presetNames(s)}.`);
  const raw = Array.isArray(doc.presets) ? doc.presets : [];

  if (a.action === 'rename_preset') {
    const name = String(a.name || '').trim().slice(0, 40);
    if (!name) return refuse('name: the new name he says.');
    const clash = presetsOf(doc).find((p) => p.id !== preset.id && p.name.toLowerCase() === name.toLowerCase());
    if (clash) return refuse(`He already has a preset "${clash.name}". Nothing changed.`);
    savePresets(s, doc, raw.map((p) => (p.id === preset.id ? { ...p, name } : p)));
    return wrote(`Preset "${preset.name}" is now "${name}". He logs it by that name, or with one tap on Fuel.`, `preset renamed ${name}`);
  }

  if (a.action === 'delete_preset') {
    if (!saidOf(a)) return refuse('said: his words asking to delete it, quoted. Deleted only when he says so; nothing changed.');
    savePresets(s, doc, raw.filter((p) => p.id !== preset.id));
    return wrote(`Deleted his preset "${preset.name}". Meals logged from it stay as they are. Presets left: ${presetNames(snap(ctx))}.`, `preset ${preset.name} deleted`);
  }

  if (a.action === 'preset_items') {
    if (!a.items?.length && !a.add?.length && !a.drop?.length) return refuse('items (the whole new list), add (items on top) or drop (names to take out).');
    let items = a.items?.length ? null : cleanItems(preset.items);
    if (a.items?.length) {
      const r = mealItems(s, a.items);
      if (r.noSize.length || r.unknown.length) return refuse(itemsRefusal(r));
      items = r.items;
    }
    const missing = [];
    for (const d of a.drop || []) {
      const i = items.findIndex((x) => norm(x.name) === norm(d)) >= 0 ? items.findIndex((x) => norm(x.name) === norm(d)) : items.findIndex((x) => sameFood(x.name, d));
      if (i < 0) missing.push(d); else items.splice(i, 1);
    }
    if (missing.length) return refuse(`Not in "${preset.name}": ${missing.map((x) => `"${x}"`).join(', ')}. It has: ${preset.items.map((x) => x.name).join(', ')}. Nothing changed.`);
    if (a.add?.length) {
      const r = mealItems(s, a.add);
      if (r.noSize.length || r.unknown.length) return refuse(itemsRefusal(r));
      items = [...items, ...r.items];
    }
    if (!items.length) return refuse(`That leaves "${preset.name}" empty. To remove it: action delete_preset. Nothing changed.`);
    savePresets(s, doc, raw.map((p) => (p.id === preset.id ? { ...p, items: cleanItems(items), savedAt: s.now, edited: true } : p)));
    return wrote(`Preset "${preset.name}" now: ${items.map(itemText(s)).join(', ')}; ${totalsText(items, s)}. Meals logged from it before stay as they were.`, `preset ${preset.name} edited`);
  }
  return refuse('action: move, copy, rename_preset, delete_preset or preset_items.');
}

// ---- my_food ------------------------------------------------------------------------------------------------------

const ownOf = (plan) => (Array.isArray(plan?.ownFoods) ? plan.ownFoods : []);
function foodText(f) {
  const l = f.label;
  const per = `per ${l.perGrams} g: ${n0(l.kcal)} kcal, ${r1(l.protein)} g protein${l.carbs != null ? `, ${r1(l.carbs)} g carbs` : ''}${l.fat != null ? `, ${r1(l.fat)} g fat` : ''}`;
  const size = [f.pack ? `pack ${f.pack.grams} g` : '', f.unit ? `1 ${f.unit.label} = ${f.unit.grams} g` : ''].filter(Boolean).join(', ');
  return `${f.name}: ${per}${size ? `; ${size}` : ''}`;
}

async function myFood(a, ctx) {
  const s = snap(ctx);
  const plan = s.one('fuel', 'plan') || { kind: 'plan' };
  const own = ownOf(plan);
  if (a.action === 'list') return { text: own.length ? `His own foods (his numbers): ${own.map(foodText).join('; ')}.` : 'No foods of his own saved yet (my_food save).', summary: `${own.length} own foods` };
  const name = String(a.name || '').trim().slice(0, 60);
  if (!name) return refuse('name: the food as he calls it.');
  const mineIdx = own.findIndex((f) => norm(f.name) === norm(name));

  if (a.action === 'remove') {
    if (!saidOf(a)) return refuse('said: his words asking to remove it, quoted. Removed only when he says so; nothing changed.');
    const i = mineIdx >= 0 ? mineIdx : own.findIndex((f) => sameFood(f.name, name));
    if (i < 0) return refuse((plan.foods || []).some((f) => sameFood(f.name, name)) ? `${name} is a food of his planned day (his diet plan), not one he saved here: not removed.` : `No food of his called "${name}". ${own.length ? `His own foods: ${own.map((f) => f.name).join(', ')}.` : ''}`);
    put(s, 'fuel', 'plan', { ...plan, ownFoods: own.filter((_, k) => k !== i) });
    return wrote(`Removed his food "${own[i].name}". Meals already logged with it keep their numbers.`, `food ${own[i].name} removed`);
  }

  if (a.action === 'save') {
    if ((plan.foods || []).some((f) => norm(f.name) === norm(name))) return refuse(`${name} is already a food of his planned day (his diet plan), with its own values. Nothing saved.`);
    const kcal = num(a.kcal); const protein = num(a.protein);
    if (kcal == null || protein == null) return refuse('kcal and protein: his numbers from the pack label (per_grams: how many grams they are for). Ask him; never estimate them. Nothing saved.');
    const perGrams = num(a.per_grams) ?? 100;
    const carbs = num(a.carbs); const fat = num(a.fat);
    const per100 = (v) => (v / perGrams) * 100;
    if (!(perGrams > 0 && perGrams <= 5000)) return refuse('per_grams: the grams his numbers are for (100 for "per 100 g", the bar or pack weight for "per bar").');
    if (per100(kcal) > 950 || per100(protein) > 100 || (carbs != null && per100(carbs) > 100) || (fat != null && per100(fat) > 100) || protein + (carbs ?? 0) + (fat ?? 0) > perGrams * 1.05) return refuse(`Those numbers are more than ${perGrams} g of food can hold: check with him (per 100 g, per pack or per piece?). Nothing saved.`);
    const packG = num(a.pack_grams); const unitG = num(a.unit_grams);
    const old = mineIdx >= 0 ? own[mineIdx] : null;
    const food = {
      name,
      label: { perGrams, kcal, protein, ...(carbs != null ? { carbs } : {}), ...(fat != null ? { fat } : {}) },
      ...(packG ? { pack: { grams: packG, label: String(a.pack_label || `${packG} g pack`).slice(0, 40) } } : old?.pack ? { pack: old.pack } : {}),
      ...(unitG ? { unit: { grams: unitG, label: String(a.unit_label || 'piece').slice(0, 20), plural: String(a.unit_plural || `${a.unit_label || 'piece'}s`).slice(0, 20) } } : old?.unit ? { unit: old.unit } : {}),
      source: 'his numbers', addedOn: old?.addedOn || s.today, by: 'coach', ...(saidOf(a) ? { said: saidOf(a) } : {}),
    };
    put(s, 'fuel', 'plan', { ...plan, kind: plan.kind || 'plan', ownFoods: old ? own.map((f, k) => (k === mineIdx ? food : f)) : [...own, food] });
    const how = food.pack ? `packs (1 pack = ${food.pack.grams} g)` : food.unit ? `count (1 ${food.unit.label} = ${food.unit.grams} g)` : 'grams';
    return wrote(`${old ? 'Updated' : 'Saved'} his food ${foodText(food)}. log_meal now logs it by name with grams${how === 'grams' ? '' : ` or ${how}`}, with his numbers; the Fuel screen offers it too.`, `food ${name} saved`);
  }
  return refuse('action: save, remove or list.');
}

// ---- fuel_settings ------------------------------------------------------------------------------------------------

const storedTimes = (list) => list.map(({ name, time, latest, cookMin }) => ({ name, time, ...(latest ? { latest } : {}), ...(cookMin ? { cookMin } : {}) }));
const timesText = (list) => (list.length ? list.map((t) => `${t.name} ${formatHm(t.time)}${t.latest ? ` (latest ${formatHm(t.latest)})` : ''}${t.cookMin ? `, start cooking ${formatHm(addMinutesHm(t.time, -t.cookMin))} (${t.cookMin} min before)` : ''}`).join('; ') : 'none: no meal-time reminders');

/** One meal time from his words, checked as the meal times editor checks it. {row} or {error}. */
function timeRow(t, base = {}) {
  const row = { ...base };
  if (t.name != null && String(t.name).trim()) row.name = String(t.name).trim().slice(0, 30);
  if (t.time) row.time = t.time;
  if (t.latest !== undefined) row.latest = t.latest || null;
  if (t.cook_min !== undefined) { const c = Math.round(num(t.cook_min) ?? 0); if (!(c >= 0 && c <= 240)) return { error: 'cook_min: 0 to 240 minutes.' }; row.cookMin = c || null; }
  if (!row.name || !row.time) return { error: 'Each meal time needs a name and a time.' };
  if (row.latest && row.latest <= row.time) return { error: `A latest time has to be after the meal time (${row.name} ${formatHm(row.time)}).` };
  return { row };
}

async function fuelSettings(a, ctx) {
  const s = snap(ctx);
  const said = saidOf(a);
  if (a.action === 'meal_time' || a.action === 'meal_times') {
    const cur = s.one('settings', 'main') || {};
    const now = mealTimesOf(withDefaults(cur).fuel.mealTimes);
    let next;
    if (a.action === 'meal_times') {
      if (!Array.isArray(a.times)) return refuse('times: his whole list of meal times ([] = none).');
      next = [];
      for (const t of a.times) { const r = timeRow(t); if (r.error) return refuse(`${r.error} Nothing changed.`); next.push(r.row); }
    } else {
      const q = String(a.meal || '').trim();
      const i = !q ? -1 : now.findIndex((t) => t.time === q || norm(t.name) === norm(q));
      const j = i >= 0 || !q ? i : now.findIndex((t) => norm(t.name).includes(norm(q)));
      if (q && j < 0) return refuse(`No meal time "${q}". His meal times: ${timesText(now)}. To add one, leave meal out and give name and time.`);
      if (a.remove) {
        if (j < 0) return refuse('meal: which meal time to remove.');
        next = now.filter((_, k) => k !== j);
      } else {
        const r = timeRow(a, j >= 0 ? now[j] : {});
        if (r.error) return refuse(`${r.error} Nothing changed.`);
        next = j >= 0 ? now.map((t, k) => (k === j ? r.row : t)) : [...now, r.row];
      }
    }
    const names = next.map((t) => t.name.toLowerCase());
    if (new Set(names).size !== names.length) return refuse('Two meal times with the same name. Nothing changed.');
    const clean = mealTimesOf(storedTimes(next));
    if (JSON.stringify(storedTimes(clean)) === JSON.stringify(storedTimes(now))) return refuse(`Nothing to change. His meal times: ${timesText(now)}.`);
    put(s, 'settings', 'main', { ...cur, fuel: { ...(cur.fuel || {}), mealTimes: storedTimes(clean) } });
    // Thu 11/5 (his words: "not 4:30pm i go to bed at 6pm"): a time that doesn't fit his day is said at once.
    const n = withDefaults(cur).notify;
    const bad = mealFitIssues(clean, n.wakeHm, n.bedHm);
    const fit = bad.length ? ` They don't fit his day (${formatHm(n.wakeHm)} to ${formatHm(n.bedHm)}): ${bad.join('; ')}. Tell him, with a time that fits as your pick.` : '';
    return wrote(`Meal times now: ${timesText(clean)}. Meal-time and cooking reminders follow them from now.${fit}`, 'meal times changed');
  }

  if (a.action === 'targets') {
    const plan = s.one('fuel', 'plan') || { kind: 'plan' };
    const v = { kcal: num(a.kcal), proteinG: num(a.protein), fatG: num(a.fat), carbsG: num(a.carbs) };
    if (Object.values(v).every((x) => x == null)) return refuse('Which target: kcal, protein, fat or carbs (grams a day), his numbers.');
    if (v.kcal != null && !(v.kcal >= 800 && v.kcal <= 8000)) return refuse('Kcal: 800 to 8,000 a day. Nothing changed.');
    if (v.proteinG != null && !(v.proteinG >= 20 && v.proteinG <= 500)) return refuse('Protein: 20 to 500 g a day. Nothing changed.');
    if (v.fatG != null && !(v.fatG >= 0 && v.fatG <= 500)) return refuse('Fat: 0 to 500 g a day. Nothing changed.');
    if (v.carbsG != null && !(v.carbsG >= 0 && v.carbsG <= 1500)) return refuse('Carbs: 0 to 1,500 g a day. Nothing changed.');
    const UNIT = { kcal: ' kcal', proteinG: ' g protein', fatG: ' g fat', carbsG: ' g carbs' };
    const changed = Object.entries(v).filter(([key, x]) => x != null && x !== plan[key]);
    if (!changed.length) return refuse('Those are already his targets. Nothing changed.');
    const text = changed.map(([key, x]) => `${n0(x)}${UNIT[key]} (was ${plan[key] != null ? `${n0(plan[key])}${UNIT[key]}` : 'none'})`).join(', ');
    const next = { ...plan, kind: plan.kind || 'plan', ...Object.fromEntries(changed), changes: [...(plan.changes || []), { on: s.today, text: `Changed by the coach on his words${said ? ` ("${said}")` : ''}: ${text}.` }] };
    put(s, 'fuel', 'plan', next);
    const macros = changed.some(([key]) => key === 'fatG' || key === 'carbsG') ? ' Fat and carbs targets are kept in his plan; Fuel shows kcal and protein.' : '';
    return wrote(`Daily targets: ${text}. Now ${next.kcal ? `${n0(next.kcal)} kcal` : 'no kcal target'}, ${next.proteinG != null ? `${next.proteinG} g protein` : 'no protein target'}${next.fatG != null ? `, ${next.fatG} g fat` : ''}${next.carbsG != null ? `, ${next.carbsG} g carbs` : ''} a day, on Fuel from now.${macros}`, 'targets changed');
  }
  return refuse('action: meal_time, meal_times or targets.');
}

// ---- the tools ----------------------------------------------------------------------------------------------------

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const ONLY = 'Only when he tells you to, in his words; never on your own idea.';

export const FUEL_TOOLS = [
  write('supplement_list', 'His supplement list', `Change his supplement list the way the My list screen does, ONLY when he tells you to add, remove, pause, take again or change one, in his words (said, quoted); never suggest a supplement, a dose or a change, never on your own idea. add: name, and only what he said: dose as on his label, dose_rest, time, with_food, days, servings left; what he didn't say stays unset (ask him, never fill it in). A removed one he adds again comes back with its history. remove: off his list from today, its history kept. change: dose, dose_rest ('' clears), days (daily; weekdays with weekdays; per_week with per_week 1-6 and off_day, "6 days a week, Sunday off"), servings (servings left now; a new pack: its full count), per_tick / per_tick_rest (servings one tick uses), time ('' clears), with_food, name, note. delete_answer: deletes his taken or skipped answer for a supplement on a day (date; also one no longer on his list), only on his explicit words; the day shows it open again. supplement_setup still sets times, with food and after-meal.`,
    obj({ action: { type: 'string', enum: ['add', 'remove', 'pause', 'resume', 'change', 'delete_answer'] }, said: SAID, supplement: { type: 'string', description: 'the one on his list (remove, pause, resume, change, delete_answer)' }, name: { type: 'string', description: 'add: its name as he says it; change: a new name' },
      dose: { type: 'string', description: 'his words, as on his label' }, dose_rest: { type: 'string', description: "rest-day dose in his words, '' = same every day" }, time: HM_OR_EMPTY, with_food: { type: 'string', enum: ['with', 'without', 'either'] },
      days: { type: 'string', enum: ['daily', 'weekdays', 'per_week'] }, weekdays: { type: 'array', items: DAY, maxItems: 7 }, per_week: { type: 'integer', minimum: 1, maximum: 7 }, off_day: DAY,
      servings: { type: 'number', minimum: 0, description: 'servings left now' }, per_tick: { type: 'number', minimum: 0 }, per_tick_rest: { type: 'number', minimum: 0 }, note: { type: 'string' }, date: ISO }, ['action', 'said']), supplementList),
  write('meal_edit', 'Move, copy and presets', `${ONLY} move: a logged meal (its id from the meals tool) to the day he says (date), at the same clock time unless he gives time. copy: a meal of another day (id) logged again, what he ate then, to today (default, now) or a date he names (then its clock time there unless time). rename_preset: preset (its name) to name. delete_preset: only on his explicit words (said). preset_items: change what a preset holds: items = the whole new list, add = items on top, drop = names to take out (items as log_meal takes them: grams, or packs/count for his foods).`,
    obj({ action: { type: 'string', enum: ['move', 'copy', 'rename_preset', 'delete_preset', 'preset_items'] }, meal: { type: 'string', description: 'meal id (move, copy)' }, date: ISO, time: HM, name: { type: 'string', description: 'copy: the new meal\'s name; rename_preset: the new name' }, away: { type: 'boolean' }, cooked: { type: 'boolean' },
      preset: { type: 'string', description: 'the preset\'s name' }, items: ITEMS, add: ITEMS, drop: { type: 'array', items: { type: 'string' }, minItems: 1 }, said: SAID }, ['action']), mealEdit),
  write('my_food', 'His own foods', `${ONLY} save: one of his usual foods with HIS numbers from its pack label, when USDA has no match (log_meal refused it): name, kcal and protein (and carbs, fat if he gave them) for per_grams grams (100 = "per 100 g"; the bar's weight for "per bar"), and its pack size (pack_grams) or the weight of one piece (unit_grams, unit_label) if he said. Never estimate the numbers: ask him. log_meal then logs it by name with grams, packs or count. Saving the same name again updates it. remove: one he saved, only on his explicit words (said). list: the ones saved.`,
    obj({ action: { type: 'string', enum: ['save', 'remove', 'list'] }, name: { type: 'string' }, kcal: { type: 'number', minimum: 0 }, protein: { type: 'number', minimum: 0 }, carbs: { type: 'number', minimum: 0 }, fat: { type: 'number', minimum: 0 }, per_grams: { type: 'number', exclusiveMinimum: 0, description: 'the grams his numbers are for; default 100' },
      pack_grams: { type: 'number', exclusiveMinimum: 0 }, pack_label: { type: 'string' }, unit_grams: { type: 'number', exclusiveMinimum: 0 }, unit_label: { type: 'string', description: '"bar", "scoop", "slice"' }, unit_plural: { type: 'string' }, said: SAID }, ['action']), myFood),
  write('fuel_settings', 'Meal times and targets', `${ONLY} As his Fuel and Settings screens set them. meal_time: one meal time: meal = which (its name or HH:MM; leave out to add a new one with name and time), then name (new name), time, latest (the latest he wants to have eaten it, after its time; '' clears), cook_min (the start-cooking reminder, minutes before the meal time; 0 = none), or remove: true. meal_times: his whole list at once (times; [] = none, no meal-time reminders). targets: his daily kcal, protein, fat or carbs (grams a day), his numbers only; never propose a target or diet advice.`,
    obj({ action: { type: 'string', enum: ['meal_time', 'meal_times', 'targets'] }, meal: { type: 'string' }, name: { type: 'string' }, time: HM, latest: HM_OR_EMPTY, cook_min: { type: 'integer', minimum: 0, maximum: 240 }, remove: { type: 'boolean' },
      times: { type: 'array', maxItems: 8, items: obj({ name: { type: 'string' }, time: HM, latest: HM_OR_EMPTY, cook_min: { type: 'integer', minimum: 0, maximum: 240 } }, ['name', 'time']) },
      kcal: { type: 'number' }, protein: { type: 'number', description: 'grams a day' }, fat: { type: 'number', description: 'grams a day' }, carbs: { type: 'number', description: 'grams a day' }, said: SAID }, ['action']), fuelSettings),
];
