// Apple Health (step 7, brief section 7): a web app can't read Health, so an iOS Shortcut on the iPhone reads steps,
// sleep, weight and workouts and saves a file to an iCloud Drive folder; the Mac reads that folder. This file holds the
// pure parts used on both sides: reading the file the Shortcut writes, turning samples into one record per day, merging
// a newer file into what is already stored, and the numbers the screens show.
//
// The file is one JSON object per line (the Shortcut builds each line from a Text action), for example:
//   {"type":"export","at":"2026-10-18T07:30:02+07:00"}
//   {"type":"steps","value":"8423","unit":"count","start":"2026-10-17T00:00:00+07:00","end":"2026-10-18T00:00:00+07:00","source":"iPhone"}
//   {"type":"sleep","value":"Core","start":"2026-10-17T21:10:00+07:00","end":"2026-10-17T22:40:00+07:00","source":"Apple Watch"}
//   {"type":"weight","value":"78.4","unit":"kg","start":"2026-10-18T06:55:00+07:00"}
//   {"type":"workout","activity":"Walking","start":"...","end":"...","kcal":"120","distance":"1.2 km"}
// A JSON array of the same objects, or {"samples": [...]}, is read too. Every value may be a string, because the
// Shortcut writes them into text; numbers with a decimal comma, units and the Shortcuts app's own date wording
// ("Oct 18, 2026 at 4:30 AM") are understood. Lines that can't be read are counted and skipped, never guessed.
import { isoDate, zonedTime, deviceTimeZone } from './time.js';

export const HEALTH_TYPES = ['steps', 'sleep', 'weight', 'workout'];
const LB = 0.45359237;
const ASLEEP = new Set(['asleep', 'core', 'deep', 'rem']);

const TYPE_WORDS = [
  [/^(steps?|step ?count|stepcount)$/, 'steps'],
  [/^(sleep|sleep ?analysis|sleepanalysis)$/, 'sleep'],
  [/^(weight|body ?mass|bodymass|body ?weight)$/, 'weight'],
  [/^(workouts?)$/, 'workout'],
  [/^(export|header|meta)$/, 'export'],
];

/** "8,423" "78,4" "78.4 kg" " 1 234 " -> number, or null. A single comma before exactly 3 digits is a thousands mark. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s  ]/g, '');
  const m = /^-?[\d.,]+/.exec(s);
  if (!m) return null;
  s = m[0];
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A moment (ms) from the Shortcut's date text. ISO 8601 with an offset is exact; ISO without one, and the Shortcuts
 * app's wording ("Oct 18, 2026 at 4:30 AM", "18 Oct 2026 at 04:30", "10/18/26, 4:30 AM"), are read in `tz`.
 */
export function parseWhen(v, tz = deviceTimeZone()) {
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null;
  const s = String(v ?? '').trim().replace(/[  ]/g, ' ');
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return Date.parse(s);
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(s);
  if (m) {
    if (m[7]) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}${m[7].length === 5 && m[7] !== 'Z' ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : m[7]}`);
    return zonedTime(`${m[1]}-${m[2]}-${m[3]}`, `${m[4] || '00'}:${m[5] || '00'}`, tz) + Number(m[6] || 0) * 1000;
  }
  // The Shortcuts app's own wording: a date part, "at" or a comma, then a time.
  const [datePart, timePart = ''] = s.split(/\s+at\s+|,\s+(?=\d{1,2}[:.]\d{2})/i);
  let y; let mo; let d;
  if ((m = /^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(datePart.trim()))) { mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; d = Number(m[2]); y = Number(m[3]); }
  else if ((m = /^(?:[A-Za-z]+,?\s+)?(\d{1,2})\.?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(datePart.trim()))) { d = Number(m[1]); mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; y = Number(m[3]); }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(datePart.trim()))) { mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); }
  else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1990)) return null;
  let hh = 0; let mm = 0; let ss = 0;
  if (timePart.trim()) {
    const t = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?/.exec(timePart.trim());
    if (!t) return null;
    hh = Number(t[1]); mm = Number(t[2]); ss = Number(t[3] || 0);
    if (t[4]) { const pm = /^p/i.test(t[4]); hh = (hh % 12) + (pm ? 12 : 0); }
    if (hh > 23 || mm > 59) return null;
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return zonedTime(iso, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, tz) + ss * 1000;
}

const typeOf = (raw) => {
  const t = String(raw ?? '').trim().toLowerCase().replace(/^hk(quantity|category)typeidentifier/, '');
  return TYPE_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
};

/** Sleep value words (Shortcuts' names, HealthKit's numbers 0-5) -> inBed | asleep | core | deep | rem | awake. */
export function sleepStage(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^\d$/.test(s)) return ['inBed', 'asleep', 'awake', 'core', 'deep', 'rem'][Number(s)] ?? null;
  if (/in ?bed/.test(s)) return 'inBed';
  if (/awake/.test(s)) return 'awake';
  if (/core|light/.test(s)) return 'core';
  if (/deep/.test(s)) return 'deep';
  if (/rem/.test(s)) return 'rem';
  if (/asleep|sleep/.test(s)) return 'asleep';
  return null;
}

/** "1.2 km" "1200 m" "0.75 mi" -> km. A bare number is taken as km. */
function distanceKm(v, unit) {
  const n = num(v);
  if (n == null) return null;
  const u = String(unit || String(v).replace(/^[\s\d.,-]+/, '') || 'km').trim().toLowerCase();
  if (/^mi/.test(u)) return n * 1.609344;
  if (/^m$|^meter|^metre/.test(u)) return n / 1000;
  return n;
}

/** Minutes from a duration value: "35 min", "1:05:00", "2100 s", "0.6 hr"; a bare number is minutes. */
function durationMin(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  const c = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (c) return c[3] != null ? Number(c[1]) * 60 + Number(c[2]) + Number(c[3]) / 60 : Number(c[1]) + Number(c[2]) / 60;
  const n = num(s);
  if (n == null) return null;
  if (/h/.test(s.replace(/^[\d.,\s]+/, ''))) return n * 60;
  if (/^[\d.,\s]+s|sec/.test(s)) return n / 60;
  return n;
}

/**
 * One line of the file -> a clean sample, or null when it isn't usable.
 * {type, start, end, value, unit, source} plus stage (sleep), kg (weight), activity/kcal/distanceKm/minutes (workout).
 */
export function cleanSample(raw, tz) {
  if (!raw || typeof raw !== 'object') return null;
  const type = typeOf(raw.type ?? raw.kind ?? raw.name);
  if (!type || type === 'export') return null;
  const start = parseWhen(raw.start ?? raw.startDate ?? raw.date, tz);
  const end = parseWhen(raw.end ?? raw.endDate, tz) ?? start;
  if (start == null || end == null || end < start) return null;
  const source = String(raw.source ?? '').trim().slice(0, 60);
  const base = { type, start, end, source };
  if (type === 'steps') {
    const value = num(raw.value);
    return value != null && value >= 0 && value < 200000 ? { ...base, value: Math.round(value) } : null;
  }
  if (type === 'sleep') {
    const stage = sleepStage(raw.value ?? raw.stage);
    return stage && end - start <= 24 * 3600000 ? { ...base, stage } : null;
  }
  if (type === 'weight') {
    const value = num(raw.value);
    const unit = String(raw.unit || String(raw.value ?? '').replace(/^[\s\d.,-]+/, '') || 'kg').trim().toLowerCase();
    if (value == null) return null;
    const kg = /^(lb|lbs|pound)/.test(unit) ? value * LB : /^st/.test(unit) ? value * 6.35029318 : unit === 'g' ? value / 1000 : value;
    return kg > 20 && kg < 400 ? { ...base, kg: Math.round(kg * 100) / 100 } : null;
  }
  // workout
  const minutes = durationMin(raw.duration) ?? (end > start ? (end - start) / 60000 : null);
  const kcal = num(raw.kcal ?? raw.energy ?? raw.activeEnergy);
  return {
    ...base,
    activity: String(raw.activity ?? raw.workoutType ?? raw.value ?? 'Workout').trim().slice(0, 60) || 'Workout',
    minutes: minutes != null ? Math.round(minutes * 10) / 10 : null,
    kcal: kcal != null && kcal >= 0 ? Math.round(kcal) : null,
    distanceKm: raw.distance != null && raw.distance !== '' ? (() => { const k = distanceKm(raw.distance, raw.distanceUnit); return k != null ? Math.round(k * 100) / 100 : null; })() : null,
  };
}

/**
 * The whole file -> {samples, at, bad, lines}. `at` is the moment the Shortcut ran (its export line), else null.
 * Sloppy JSON from a hand-built Text action is forgiven where it is safe: a trailing comma, line breaks inside values.
 */
export function parseHealthFile(text, tz = deviceTimeZone()) {
  const src = String(text ?? '').replace(/^﻿/, '').trim();
  let rows = [];
  let bad = 0;
  if (src.startsWith('[') || src.startsWith('{')) {
    try {
      const j = JSON.parse(src);
      rows = Array.isArray(j) ? j : Array.isArray(j?.samples) ? [...(j.at ? [{ type: 'export', at: j.at }] : []), ...j.samples] : [j];
    } catch { rows = null; }
  }
  if (!rows || !rows.length) {
    rows = [];
    // One object per line; objects may also sit side by side on one line ("}{" or "},{").
    const chunks = src.replace(/\}\s*,?\s*\{/g, '}\n{').split(/\r?\n/).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
    for (const c of chunks) {
      if (c === '[' || c === ']') continue;
      try { rows.push(JSON.parse(c)); } catch { bad++; }
    }
  }
  let at = null;
  const samples = [];
  for (const r of rows) {
    if (r && typeOf(r.type) === 'export') { at = parseWhen(r.at ?? r.date, tz) ?? at; continue; }
    const s = cleanSample(r, tz);
    if (s) samples.push(s); else bad++;
  }
  return { samples, at, bad, lines: rows.length };
}

/** Intervals [start, end] merged where they overlap; total minutes. */
function unionMin(list) {
  const iv = list.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
  let total = 0; let cur = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 60000);
}

/** The night a sleep sample belongs to: the date he woke up (a sleep ending before 6 PM counts for that day). */
export const nightOf = (endMs, tz) => isoDate(new Date(endMs + 6 * 3600000), tz);

/** Sleep for one night from its samples: asleep minutes (no double counting across sources), in bed, bed and wake. */
export function sleepNight(samples) {
  if (!samples.length) return null;
  const asleep = samples.filter((s) => ASLEEP.has(s.stage));
  const inBed = samples.filter((s) => s.stage === 'inBed');
  const span = asleep.length ? asleep : samples;
  const stages = {};
  for (const k of ['core', 'deep', 'rem', 'awake']) {
    const list = samples.filter((s) => s.stage === k);
    if (list.length) stages[k] = unionMin(list);
  }
  return {
    asleepMin: asleep.length ? unionMin(asleep) : null,
    inBedMin: inBed.length ? unionMin(inBed) : unionMin(samples),
    bed: Math.min(...span.map((s) => s.start)),
    wake: Math.max(...span.map((s) => s.end)),
    stages,
  };
}

/** Steps for one day: Health's own day totals when the Shortcut groups by day; raw samples are summed per source and
 * the largest source is taken (iPhone and Watch both count the same walk). */
export function stepsOfDay(samples) {
  if (!samples.length) return null;
  const bySource = new Map();
  for (const s of samples) bySource.set(s.source, (bySource.get(s.source) || 0) + s.value);
  return Math.max(...bySource.values());
}

/**
 * Samples -> one record per local date: {date, steps, sleep, weights: [{at, kg, source}], workouts: [...],
 * covered: {steps, sleep, weight, workout}}. `covered[type]` is true when the file holds that type for the whole day
 * (any day after the first day it has that type for; the first may be cut off by the Shortcut's date range).
 */
export function healthDays(samples, tz = deviceTimeZone()) {
  const days = new Map();
  const at = (date) => {
    if (!days.has(date)) days.set(date, { date, steps: null, sleep: null, weights: [], workouts: [], covered: {} });
    return days.get(date);
  };
  const firstDate = {};
  const groups = { steps: new Map(), sleep: new Map() };
  for (const s of samples) {
    const date = s.type === 'sleep' ? nightOf(s.end, tz) : isoDate(new Date(s.start), tz);
    if (!firstDate[s.type] || date < firstDate[s.type]) firstDate[s.type] = date;
    if (s.type === 'steps' || s.type === 'sleep') {
      if (!groups[s.type].has(date)) groups[s.type].set(date, []);
      groups[s.type].get(date).push(s);
    } else if (s.type === 'weight') {
      at(date).weights.push({ at: s.start, kg: s.kg, source: s.source });
    } else {
      at(date).workouts.push({ start: s.start, end: s.end, activity: s.activity, minutes: s.minutes, kcal: s.kcal, distanceKm: s.distanceKm, source: s.source });
    }
  }
  for (const [date, list] of groups.steps) at(date).steps = stepsOfDay(list);
  for (const [date, list] of groups.sleep) at(date).sleep = sleepNight(list);
  // Every date from the first date of a type to the last date in the file is covered by that type (days with nothing,
  // e.g. no workout, are real zeros there).
  const allDates = [...days.keys()].sort();
  const last = allDates.at(-1);
  for (const type of HEALTH_TYPES) {
    const first = firstDate[type];
    if (!first) continue;
    for (const d of datesBetween(first, last)) if (d > first) at(d).covered[type] = true;
  }
  for (const d of days.values()) {
    d.weights.sort((a, b) => a.at - b.at);
    d.workouts.sort((a, b) => a.start - b.start);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function datesBetween(a, b) {
  const out = [];
  const t = new Date(`${a}T12:00:00Z`);
  for (let i = 0; i < 4000; i++) {
    const d = t.toISOString().slice(0, 10);
    if (d > b) break;
    out.push(d);
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

const minuteKey = (ms) => Math.round(ms / 60000);
const unionBy = (a = [], b = [], key) => {
  const m = new Map();
  for (const x of [...a, ...b]) m.set(key(x), x);
  return [...m.values()];
};

/**
 * A day from a newer file merged into the stored one. Covered parts replace what was there (Health is the truth);
 * a part the file only holds for part of the day can only add: more steps, a longer sleep, extra weigh-ins and
 * workouts. Weigh-ins and workouts are never dropped by a file that doesn't cover the day.
 * Returns the record to store (without bookkeeping fields), or null when nothing changed.
 */
export function mergeDay(stored, incoming) {
  const cur = stored || { date: incoming.date, steps: null, sleep: null, weights: [], workouts: [] };
  const c = incoming.covered || {};
  const next = { date: incoming.date };
  next.steps = c.steps ? incoming.steps : maxOf(cur.steps, incoming.steps);
  const sleepLen = (x) => (x ? x.asleepMin ?? x.inBedMin ?? 0 : -1);
  next.sleep = c.sleep ? incoming.sleep : sleepLen(incoming.sleep) > sleepLen(cur.sleep) ? incoming.sleep : cur.sleep ?? null;
  next.weights = c.weight ? incoming.weights : unionBy(cur.weights, incoming.weights, (w) => minuteKey(w.at)).sort((a, b) => a.at - b.at);
  next.workouts = c.workout ? incoming.workouts : unionBy(cur.workouts, incoming.workouts, (w) => `${minuteKey(w.start)}|${w.activity}`).sort((a, b) => a.start - b.start);
  const same = JSON.stringify([cur.steps ?? null, cur.sleep ?? null, cur.weights || [], cur.workouts || []]) === JSON.stringify([next.steps ?? null, next.sleep ?? null, next.weights, next.workouts]);
  return same && stored ? null : next;
}

function maxOf(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

// ---- for the screens ----

/** Every weigh-in from Health days and body measurements, oldest first: [{date, at, kg, from: 'health'|'hevy'|...}]. */
export function weightSeries(healthDocs = [], measurements = []) {
  const out = [];
  for (const d of healthDocs) for (const w of d.weights || []) out.push({ date: d.date, at: w.at, kg: w.kg, from: 'health' });
  for (const m of measurements) if (m && m.weightKg != null && m.date) out.push({ date: m.date, at: m.at ?? Date.parse(`${m.date}T12:00:00Z`), kg: Number(m.weightKg), from: m.source || 'manual' });
  return out.sort((a, b) => a.at - b.at);
}

/** One weight per day (the last weigh-in that day), oldest first. */
export function dailyWeights(series) {
  const m = new Map();
  for (const w of series) m.set(w.date, w);
  return [...m.values()];
}

/**
 * Bodyweight for bodyweight exercises (decision 12): the newest of the last Apple Health weigh-in and the value he set
 * by hand (Settings or "Bodyweight today"), as long as it is from the last `maxDays` days. {kg, at, from} or null.
 */
export function currentBodyweight({ healthDocs = [], manual = null, now = Date.now(), maxDays = 30 } = {}) {
  let health = null;
  for (const d of healthDocs) for (const w of d.weights || []) if (w.at <= now && (!health || w.at > health.at)) health = { kg: w.kg, at: w.at, from: 'health' };
  if (health && now - health.at > maxDays * 86400000) health = null;
  const hand = manual?.kg != null ? { kg: Number(manual.kg), at: manual.at ?? 0, from: 'manual' } : null;
  if (health && hand) return hand.at > health.at ? hand : health;
  return health || hand;
}

/** The weight nearest a date within `maxDays` (for history sessions logged without a bodyweight), or null. */
export function weightNear(daily, date, maxDays = 21) {
  let best = null; let bestGap = Infinity;
  const t = Date.parse(`${date}T12:00:00Z`);
  for (const w of daily) {
    const gap = Math.abs(Date.parse(`${w.date}T12:00:00Z`) - t) / 86400000;
    if (gap < bestGap) { best = w; bestGap = gap; }
  }
  return best && bestGap <= maxDays ? best.kg : null;
}

/** "7 h 25 min" */
export function hoursText(min) {
  if (min == null) return '-';
  const h = Math.floor(min / 60); const m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Average of the non-empty values, or null. */
export const average = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
