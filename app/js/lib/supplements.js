// Supplements (step 6, brief section 6 SUPPLEMENTS): his list, the daily checklist, streak, adherence and stock.
// The app only tracks what he decides to take: it never recommends a supplement or a dose, and never changes his list
// by itself. Pure functions; screens, reminders and the Mac pass the records in.
//
// supplements  {id, kind: 'supplement', name, short, dose, doseRest, time 'HH:MM'|null, withFood: 'with'|'without'|'either'|null,
//               days: {type: 'daily'} | {type: 'weekdays', weekdays: [0-6]} | {type: 'perWeek', count, offDay: 0-6|null},
//               status: 'active'|'paused'|'removed', history: [{on, status}], stock: {servings, countedAt}|null,
//               perTake: {train, rest} (servings used per tick), note, order, source, changes: [{on, text}]}
// supp-log     {id: '<date>.<supp id>', date, suppId, status: 'taken'|'skipped', reason, at, dose, dayKind, servings}
import { addDays } from './rotation.js';

export const LOW_DAYS = 7;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const FOOD_TEXT = { with: 'with food', without: 'without food', either: 'with or without food' };
const PARTS = [['Morning', 0, 660], ['Midday', 660, 840], ['Afternoon', 840, 1020], ['Evening', 1020, 1320], ['Night', 1320, 1440]];

const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const mins = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

/** "Morning", "Midday", "Afternoon", "Evening" or "Night" for a clock time. */
export function partOf(hm) {
  if (!/^\d{2}:\d{2}$/.test(hm || '')) return null;
  const t = mins(hm);
  return PARTS.find(([, a, b]) => t >= a && t < b)[0];
}

export const logId = (date, suppId) => `${date}.${suppId}`;
export const shortName = (s) => s.short || s.name;

/** Active, paused or removed on a date, from its dated history (before its first entry: not on the list yet). */
export function statusOn(supp, date) {
  const h = [...(supp.history || [])].sort((a, b) => a.on.localeCompare(b.on));
  if (!h.length) return supp.status || 'active';
  const last = h.filter((x) => x.on <= date).at(-1);
  return last ? last.status : 'none';
}

/** Does the days rule put it on this weekday? 6 days a week with no day off chosen yet: every day until he picks. */
export function onWeekday(days, wd) {
  if (!days || days.type === 'daily') return true;
  if (days.type === 'weekdays') return (days.weekdays || []).includes(wd);
  if (days.type === 'perWeek') return days.offDay == null || (days.count ?? 7) >= 7 ? true : wd !== days.offDay;
  return true;
}

export const scheduledOn = (supp, date) => statusOn(supp, date) === 'active' && onWeekday(supp.days, weekday(date));

/** Today's dose: the rest-day dose on a rest day when there is one (magnesium), else the dose. */
export const doseFor = (supp, dayKind) => (dayKind === 'rest' && supp.doseRest ? supp.doseRest : supp.dose);
/** Servings one tick uses, by day type. */
export const servingsFor = (supp, dayKind) => Math.max(0, Number(supp.perTake?.[dayKind === 'rest' ? 'rest' : 'train'] ?? 1));

/**
 * Training day or rest day, for magnesium's dose: a planned day from the rotation (Pull, Push, Legs = training day;
 * a done session counts too), a past day from what happened (a workout logged = training day).
 */
export function dayKindFor(date, { today, rotKind, workoutDates = new Set() }) {
  if (date >= today) return rotKind === 'rest' ? 'rest' : 'train';
  return workoutDates.has(date) ? 'train' : 'rest';
}

/** "6 days a week · day off not set", "Mon, Wed, Fri", "every day". */
export function daysText(days) {
  if (!days || days.type === 'daily') return 'every day';
  if (days.type === 'weekdays') return (days.weekdays || []).slice().sort().map((d) => WEEKDAYS[d].slice(0, 3)).join(', ') || 'no days chosen';
  if (days.type === 'perWeek') return `${days.count} days a week · ${days.offDay == null ? 'day off not set' : `${WEEKDAYS[days.offDay]} off`}`;
  return '';
}

const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name);

/**
 * The day's checklist grouped by time of day, earliest first; items with no time set come last.
 * @returns {Array<{key, label, time, items: Array<{supp, dose, servings, entry}>, open}>}
 */
export function checklist({ supps = [], log = [], date, dayKind }) {
  const entries = new Map(log.filter((e) => e.date === date).map((e) => [e.suppId, e]));
  const groups = new Map();
  for (const s of supps.filter((x) => scheduledOn(x, date)).sort(byOrder)) {
    const key = s.time || '';
    if (!groups.has(key)) groups.set(key, { key, time: s.time || null, label: s.time ? partOf(s.time) : 'No time set', items: [] });
    groups.get(key).items.push({ supp: s, dose: doseFor(s, dayKind), servings: servingsFor(s, dayKind), entry: entries.get(s.id) || null });
  }
  return [...groups.values()].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || String(a.time).localeCompare(String(b.time)))
    .map((g) => ({ ...g, open: g.items.filter((i) => !i.entry) }));
}

/** A log entry for a tick (taken) or a skip with its reason. */
export function logEntry({ supp, date, dayKind, status, reason = '', at = Date.now(), by = 'tap' }) {
  return {
    id: logId(date, supp.id), date, suppId: supp.id, status, reason: status === 'skipped' ? String(reason || '').slice(0, 200) : '',
    at, dose: doseFor(supp, dayKind), dayKind, servings: status === 'taken' ? servingsFor(supp, dayKind) : 0, by,
  };
}

/** The first date anything was answered: adherence and streaks count from here, not from before he used the app. */
export const trackingFrom = (log = []) => log.reduce((m, e) => (!m || e.date < m ? e.date : m), null);

/**
 * Days in a row, back from today, on which everything scheduled was taken. Today counts once all of it is taken and
 * doesn't break the streak while some is still open. A skip breaks it. Days with nothing scheduled are passed over.
 */
export function streak({ supps = [], log = [], today }) {
  const from = trackingFrom(log);
  if (!from) return { days: 0, today: false };
  const taken = new Set(log.filter((e) => e.status === 'taken').map((e) => e.id));
  const answered = new Set(log.map((e) => e.id));
  let days = 0; let todayDone = false;
  for (let d = today; d >= from; d = addDays(d, -1)) {
    const due = supps.filter((s) => scheduledOn(s, d));
    if (!due.length) continue;
    const all = due.every((s) => taken.has(logId(d, s.id)));
    if (d === today) {
      todayDone = all;
      // Still open today, nothing skipped: today doesn't count yet but doesn't break the streak either.
      if (!all && !due.some((s) => answered.has(logId(d, s.id)) && !taken.has(logId(d, s.id)))) continue;
    }
    if (!all) break;
    days++;
  }
  return { days, today: todayDone };
}

/** Taken / scheduled over the last n days for one supplement (today only once it is answered). pct null: nothing yet. */
export function adherence(supp, log = [], today, n = 7) {
  const from = trackingFrom(log);
  let scheduled = 0; let taken = 0;
  if (!from) return { taken, scheduled, pct: null };
  const mine = new Map(log.filter((e) => e.suppId === supp.id).map((e) => [e.date, e]));
  for (let i = 0; i < n; i++) {
    const d = addDays(today, -i);
    if (d < from) break;
    if (!scheduledOn(supp, d)) continue;
    const e = mine.get(d);
    if (d === today && !e) continue;
    scheduled++;
    if (e?.status === 'taken') taken++;
  }
  return { taken, scheduled, pct: scheduled ? Math.round((taken / scheduled) * 100) : null };
}

/** Servings left: what he counted, minus every tick since. null when he hasn't entered it. */
export function stockLeft(supp, log = []) {
  if (!supp.stock || supp.stock.servings == null) return null;
  const used = log.filter((e) => e.suppId === supp.id && e.status === 'taken' && e.at > (supp.stock.countedAt || 0))
    .reduce((a, e) => a + (e.servings ?? 1), 0);
  return Math.max(0, Math.round((supp.stock.servings - used) * 100) / 100);
}

/** Servings used on an average day: days rule share x (3 training days and 1 rest day in 4, the rotation). */
export function servingsPerDay(supp) {
  const share = !supp.days || supp.days.type === 'daily' ? 1 : supp.days.type === 'weekdays' ? (supp.days.weekdays || []).length / 7 : Math.min(7, supp.days.count ?? 7) / 7;
  return share * (0.75 * servingsFor(supp, 'train') + 0.25 * servingsFor(supp, 'rest'));
}

/** {left, days, low}: about how many days the stock lasts; low at a week or less. null when no stock is entered. */
export function stockStatus(supp, log = []) {
  const left = stockLeft(supp, log);
  if (left == null) return null;
  const per = servingsPerDay(supp);
  const days = per > 0 ? Math.floor(left / per) : null;
  return { left, days, low: days != null && days <= LOW_DAYS };
}

/** "about a week", "about 3 weeks", "2 days" */
export function lastsText(days) {
  if (days == null) return '';
  if (days <= 1) return days === 1 ? '1 day' : 'none left';
  if (days < 6) return `${days} days`;
  if (days <= 9) return 'about a week';
  if (days < 60) return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days / 30)} months`;
}

/** Calendar markers (dayMarks extra): one per day with answers: {date, kind: 'supps', label, all}. */
export function suppMarks(supps = [], log = []) {
  const by = new Map();
  for (const e of log) by.set(e.date, [...(by.get(e.date) || []), e]);
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    const due = supps.filter((s) => scheduledOn(s, date));
    const taken = list.filter((e) => e.status === 'taken');
    const skipped = list.filter((e) => e.status === 'skipped');
    const name = (id) => shortName(supps.find((s) => s.id === id) || { name: id });
    return {
      date, kind: 'supps', all: due.length > 0 && due.every((s) => taken.some((e) => e.suppId === s.id)),
      label: `Supplements: ${taken.length} of ${due.length || list.length} taken${skipped.length ? ` · skipped ${skipped.map((e) => `${name(e.suppId)}${e.reason ? ` (${e.reason})` : ''}`).join(', ')}` : ''}`,
    };
  });
}
