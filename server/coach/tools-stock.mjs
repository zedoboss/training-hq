// The coach's water and food stock tools (Thu 11/5, his list of missing features: "No water tracking", "No food stock
// list (beef, eggs, almonds and so on) or shopping list"). Each only on his words, written as his screens write them.
//   water       log what he drank (ml), take the last one back, his own daily amount (or none), the day's total.
//   food_stock  his counts (item, amount, unit), his own daily use, bought (a new count), on or off the shopping list,
//               remove; list = every item and how long it lasts; shopping = what runs out within his days.
import { snapshot, dayText, findByName, wrote, refuse, timeText } from './shared.mjs';
import { put, del, num } from './tools-write.mjs';
import { waterEntry, waterTotal, waterTarget, waterOn, mlText } from '../../app/js/lib/water.js';
import { pantryStatus, shoppingList, amountOf, lastsText, FROM_TEXT, UNITS, SHOP_DAYS, pantryId, stockItem } from '../../app/js/lib/pantry.js';
import { isoDate } from '../../app/js/lib/time.js';
import { newId } from '../../app/js/lib/routines.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const SAID = { type: 'string', description: 'his own words asking for this, quoted from his message' };
const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
const settingsOf = (s) => s.one('settings', 'main') || {};

// ---- water --------------------------------------------------------------------------------------------------------

function dayWater(s, date) {
  const t = waterTotal(s.list('water'), date);
  const goal = waterTarget(settingsOf(s));
  return `${dayText(date, s.today)}: ${mlText(t.ml)} water${t.count ? ` (${t.count} logged, last ${timeText(t.last.at, s.tz)})` : ''}${goal ? ` of his ${mlText(goal)}` : ''}.`;
}

async function water(a, ctx) {
  const s = snap(ctx);
  const date = s.foodDay();
  if (a.action === 'today') return wrote(dayWater(s, a.date || date), 'water');
  if (a.action === 'log') {
    const ml = num(a.ml) ?? (num(a.liters) != null ? num(a.liters) * 1000 : undefined);
    // Two in the same moment keep their order (undo takes the one logged last).
    const prev = waterOn(s.list('water'), date).at(-1);
    const e = waterEntry({ id: newId('water'), ml, at: Math.max(s.now, (prev?.at ?? 0) + 1), date, by: 'coach' });
    if (!e) return refuse('How much, in ml (1 to 3,000 for one drink)? Ask him if he didn\'t say. Nothing logged.');
    put(s, 'water', e.id, e);
    return wrote(`Logged ${mlText(e.ml)} water. ${dayWater(snap(ctx), date)}`, `${e.ml} ml water`);
  }
  if (a.action === 'undo_last') {
    const last = waterOn(s.list('water'), date).at(-1);
    if (!last) return refuse('No water logged today. Nothing taken back.');
    del(s, 'water', last.id);
    return wrote(`Took back ${mlText(last.ml)} (${timeText(last.at, s.tz)}). ${dayWater(snap(ctx), date)}`, 'water taken back');
  }
  if (a.action === 'target') {
    const ml = num(a.ml) ?? (num(a.liters) != null ? num(a.liters) * 1000 : undefined);
    if (ml == null) return refuse('His daily amount in ml, or 0 for none. Only his own number; never propose one.');
    if (ml !== 0 && !(ml >= 250 && ml <= 10000)) return refuse('A daily amount from 250 to 10,000 ml, or 0 for none. Nothing changed.');
    const cur = settingsOf(s);
    put(s, 'settings', 'main', { ...cur, fuel: { ...(cur.fuel || {}), waterMl: ml || null } });
    return wrote(ml ? `His daily water amount: ${mlText(ml)}, shown on Fuel. No reminders come from it.` : 'No daily water amount: Fuel shows only what he logged.', 'water amount');
  }
  return refuse('action: log, undo_last, target or today.');
}

// ---- food stock ---------------------------------------------------------------------------------------------------

const live = (s) => s.list('pantry').filter((x) => x && !x.removed);
const ctxOf = (s) => ({ plan: s.one('fuel', 'plan'), meals: s.list('meals'), today: s.foodDay(), tzDate: (at) => isoDate(new Date(at), s.tz) });

function itemLine(s, item, c = ctxOf(s)) {
  const st = pantryStatus(item, c);
  return `${item.name}: ${st.about ? 'about ' : ''}${amountOf(item, st.left, c.plan)} left, ${lastsText(st)}${st.perDay ? ` (${amountOf(item, st.perDay, c.plan)} a day, ${FROM_TEXT[st.from]})` : ''}${item.onList ? ', on his list' : ''}`;
}

function shoppingText(s) {
  const c = ctxOf(s);
  const days = Number(settingsOf(s).fuel?.shopDays) || SHOP_DAYS;
  const list = shoppingList(live(s), c, { within: days });
  return list.length ? `Shopping list (runs out within ${days} days, gone, or put on by him): ${list.map((x) => itemLine(s, x.item, c)).join('; ')}.` : `Shopping list: empty. Nothing runs out within ${days} days by his counts.`;
}

async function foodStock(a, ctx) {
  const s = snap(ctx);
  const items = live(s);
  if (a.action === 'list') return wrote(items.length ? `Food stock: ${items.map((x) => itemLine(s, x)).join('; ')}.\n${shoppingText(s)}` : 'No food stock counted yet. He adds items on Fuel > Food stock, or tells you what he has.', 'food stock');
  if (a.action === 'shopping') return wrote(shoppingText(s), 'shopping list');
  const name = String(a.item || '').trim();
  if (!name) return refuse('Which item?');
  const { item: found, ambiguous } = findByName(items, name, (x) => x.name);
  if (ambiguous?.length && !found) return refuse(`Which one: ${ambiguous.join(' or ')}?`);
  if (a.action === 'count' || a.action === 'bought') {
    const amount = num(a.amount);
    if (amount == null || amount < 0 || amount > 100000) return refuse('How much he has now (a number, with its unit). Nothing saved.');
    const unit = a.unit || found?.unit || 'g';
    if (!UNITS.includes(unit)) return refuse(`unit: ${UNITS.join(', ')}.`);
    // Bought: what he bought on top of what is left now (his words "bought 2 packs"), unless he gives the total.
    const left = found && a.action === 'bought' && !a.total && found.unit === unit ? pantryStatus(found, ctxOf(s)).left : 0;
    const next = stockItem({ name, amount: Math.round((left + amount) * 10) / 10, unit, perDay: num(a.per_day) ?? null, unitGrams: num(a.unit_grams) ?? null, now: s.now, countedOn: s.foodDay(), cur: found });
    if (!found && items.some((x) => x.id === next.id)) next.id = `${pantryId(name)}-${s.now.toString(36)}`;
    put(s, 'pantry', next.id, next);
    return wrote(`${found ? 'Counted' : 'Added'}: ${itemLine(snap(ctx), next)}.`, `${next.name} counted`);
  }
  if (!found) return refuse(`"${name}" isn't in his food stock. Stock now: ${items.map((x) => x.name).join(', ') || 'nothing'}.`);
  if (a.action === 'per_day') {
    const v = num(a.per_day);
    if (v == null || v < 0) return refuse('His daily use, in the item\'s unit, or 0 to let the app work it out.');
    put(s, 'pantry', found.id, { ...found, perDay: v > 0 ? v : null });
    return wrote(`${itemLine(snap(ctx), { ...found, perDay: v > 0 ? v : null })}.`, `${found.name} per day`);
  }
  if (a.action === 'on_list' || a.action === 'off_list') {
    put(s, 'pantry', found.id, { ...found, onList: a.action === 'on_list' });
    return wrote(`${found.name} ${a.action === 'on_list' ? 'on' : 'off'} his shopping list.\n${shoppingText(snap(ctx))}`, `${found.name} ${a.action === 'on_list' ? 'on' : 'off'} the list`);
  }
  if (a.action === 'remove') {
    if (!String(a.said || '').trim()) return refuse('Only on his explicit words (said). Nothing removed.');
    put(s, 'pantry', found.id, { ...found, removed: true });
    return wrote(`${found.name} taken off his food stock.`, `${found.name} removed`);
  }
  return refuse('action: list, shopping, count, bought, per_day, on_list, off_list or remove.');
}

// ---- the tools ----------------------------------------------------------------------------------------------------

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const ONLY = 'Only when he tells you to, in his words; never on your own idea.';

export const STOCK_TOOLS = [
  write('water', 'Water', `${ONLY} log: what he drank now (ml, or liters), on today's water; undo_last: takes today's last one back; target: his own daily amount (ml; 0 = none), never propose one or advise on drinking; today: the day's total (date for another day).`,
    obj({ action: { type: 'string', enum: ['log', 'undo_last', 'target', 'today'] }, ml: { type: 'number', minimum: 0 }, liters: { type: 'number', minimum: 0 }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, said: SAID }, ['action']), water),
  write('food_stock', 'Food stock and shopping list', `${ONLY} His food at home (Fuel > Food stock). list: every item, what's left and how long it lasts (from his own daily number, else his logged meals of the last 7 days, else his planned day); shopping: the shopping list (what runs out within his days, default ${SHOP_DAYS}, is gone, or he put on it). count: what he has now (item, amount, unit g, kg, count or pack; new items too). bought: what he just bought, added to what's left (total: true when he gives the new total). per_day: his own daily use in the item's unit (0 = let the app work it out). on_list / off_list: put it on or take it off the shopping list. remove: only on his explicit words (said). Never suggest what to buy or eat.`,
    obj({ action: { type: 'string', enum: ['list', 'shopping', 'count', 'bought', 'per_day', 'on_list', 'off_list', 'remove'] }, item: { type: 'string' }, amount: { type: 'number', minimum: 0 }, unit: { type: 'string', enum: UNITS }, total: { type: 'boolean' }, per_day: { type: 'number', minimum: 0 }, unit_grams: { type: 'number', exclusiveMinimum: 0, description: 'grams of one piece or one pack, when he says' }, said: SAID }, ['action']), foodStock),
];
