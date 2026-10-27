// Shared bits for the coach's tools (8.2): a snapshot of the Mac's database for one tool call (each collection read
// once), the app's own rules on top of it, and the formats he asked for: days with weekday and date, times as
// H:MM AM/PM, loads as total kg with the bar and plates per side.
import { isoDate, formatDay, formatDate, formatTime, formatHm } from '../../app/js/lib/time.js';
import { withDefaults, equipmentWithDefaults, smallestPlate } from '../../app/js/lib/settings.js';
import { mergeLibrary } from '../../app/js/lib/library.js';
import { buildHistory } from '../../app/js/lib/history.js';
import { rotationDay, lastRotationSession, daysByDate } from '../../app/js/lib/rotation.js';
import { platesPerSide, kg as k } from '../../app/js/lib/loads.js';
import { wakingDay } from '../../app/js/lib/waking-day.js';
import { signsUpTo, movingOf } from '../notify.mjs';
import { oneArmIn, armOf } from '../../app/js/lib/session.js';

export { k, formatHm };

/** One read of the database for a tool call. Everything is read lazily and kept for the call. */
export function snapshot(store, { tz, now = Date.now() } = {}) {
  const memo = new Map();
  const m = (key, f) => { if (!memo.has(key)) memo.set(key, f()); return memo.get(key); };
  const list = (col) => m(`l:${col}`, () => store.listRecords(col).map((r) => r.data).filter(Boolean));
  const one = (col, id) => m(`o:${col}/${id}`, () => { const r = store.getRecord(col, id); return r && !r.deleted ? r.data : null; });
  const s = {
    store, tz, now, today: isoDate(new Date(now), tz),
    list, one,
    settings: () => m('settings', () => withDefaults(one('settings', 'main'))),
    equipment: () => m('equipment', () => equipmentWithDefaults(one('settings', 'equipment'))),
    lib: () => m('lib', () => new Map(mergeLibrary(list('exercises'), s.equipment()).map((e) => [e.id, e]))),
    history: (excludeSessionId = null) => m(`h:${excludeSessionId}`, () => buildHistory({ sessions: list('sessions'), sets: list('sets'), bridge: one('bridge', 'last-loads'), excludeSessionId })),
    days: () => m('days', () => daysByDate(list('days'))),
    last: () => m('last', () => lastRotationSession(list('sessions'), one('bridge', 'last-loads'), tz)),
    rotation: () => m('rot', () => rotationDay({ last: s.last(), today: s.today, days: s.days() })),
    meta: () => one('programme', 'meta'),
    /** The workout in progress (not a holds round), newest first. */
    active: () => m('active', () => list('sessions').filter((x) => x.status === 'active' && x.kind !== 'holds').sort((a, b) => b.startedAt - a.startedAt)[0] || null),
    setsOf: (sessionId) => list('sets').filter((x) => x.sessionId === sessionId).sort((a, b) => a.order - b.order),
    minPlate: () => smallestPlate(s.equipment()),
    date: (ms) => isoDate(new Date(ms), tz),
    /** Sat 10/24: the day food and supplements at `ms` count toward (after midnight, before he has slept: the day before). */
    // Tue 10/27: past 6:00 AM, still up from the night (signs of him, no sleep gap): still the day before, to noon.
    // The moving schedule on (lib/moving-day.js): the day he woke on, his body clock's date.
    wakingDay: (ms = now) => { const d = isoDate(new Date(ms), tz); return wakingDay(ms, { tz, sleepLog: one('sleep-log', d), health: one('health', d), sessions: list('sessions'), signs: () => signsUpTo(store, ms), moving: movingOf(store) }); },
    /** His waking day now: food and supplements "today". */
    foodDay: () => m('foodDay', () => s.wakingDay(now)),
  };
  return s;
}

/** "Sunday 10/18", with the year when it isn't this year's. */
export function dayText(iso, today = null) {
  const d = new Date(`${iso}T12:00:00Z`);
  return today && iso.slice(0, 4) !== today.slice(0, 4) ? formatDate(d, 'UTC') : formatDay(d, 'UTC');
}

/** "Sunday 10/18, 4:30 AM" for a moment. */
export const whenText = (ms, tz, today = null) => `${dayText(isoDate(new Date(ms), tz), today)}, ${formatTime(new Date(ms), tz)}`;
export const timeText = (ms, tz) => formatTime(new Date(ms), tz);

// Sat 10/24, his words: "Theres no 1:30 there first set is right arm then left" (the coach read two preacher curl sets
// as two rounds with 1:30 rest between them). On an exercise his notes call one-arm ("single arm", "desna pa leva" =
// right then left) each logged set is one arm: right, then left straight after, a pair per round. Rest and rep drops
// count per arm, round to round, never between the two sets of a pair.
export const ONE_ARM_TEXT = 'one arm per logged set, right then left back to back, each pair is one round; no rest between the arms, rest and rep drops count per arm, round to round (right vs right)';
export { armOf };

/** True when his notes on this exercise (today's, or any past session's) say he logs one arm per set. */
export const oneArm = (s, name, notes = []) => oneArmIn(s.history(), name, notes);

/** "round 1: right 10 kg × 5, left 10 kg × 5; round 2: right ..." for one-arm sets, in order. */
export function roundsText(sets, text) {
  const out = [];
  sets.forEach((x, i) => {
    const t = `${x.arm || (i % 2 ? 'left' : 'right')} ${text(x)}`;
    if (i % 2) out[out.length - 1] += `, ${t}`; else out.push(`round ${i / 2 + 1}: ${t}`);
  });
  return out.join('; ');
}

/** "60 kg total (20 kg bar + 20 kg a side)", or "25 kg". */
export function loadText(kgVal, barKg = null) {
  if (kgVal == null) return 'no load';
  const side = barKg ? platesPerSide(kgVal, barKg) : null;
  return side != null ? `${k(kgVal)} kg total (${k(barKg)} kg bar + ${k(side)} kg a side)` : `${k(kgVal)} kg`;
}

export const repsText = (r) => (!r ? '' : Array.isArray(r) ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`) : `${r}`);
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

const norm = (x) => String(x || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const normFull = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The best match for what he called something ("squat", "cable row", "mag") among names. Exact, then every word
 * found, then the most words found. Returns the item or null; `ambiguous` lists close ties.
 */
export function findByName(items, query, nameOf = (x) => x.name, extraNames = () => []) {
  const q = normFull(query);
  if (!q) return { item: null, ambiguous: [] };
  const words = q.split(' ');
  const scored = items.map((it) => {
    const names = [nameOf(it), ...extraNames(it)].filter(Boolean);
    let best = 0;
    for (const n of names) {
      const full = normFull(n); const short = norm(n);
      if (full === q || short === q) { best = Math.max(best, 100); continue; }
      const hay = ` ${full} `;
      const hits = words.filter((w) => hay.includes(` ${w}`)).length;
      if (hits === words.length) best = Math.max(best, 60 + (short.startsWith(q) ? 10 : 0) - Math.min(9, full.split(' ').length));
      else if (hits) best = Math.max(best, 10 * hits);
    }
    return { it, best };
  }).filter((x) => x.best > 0).sort((a, b) => b.best - a.best);
  if (!scored.length) return { item: null, ambiguous: [] };
  const top = scored[0];
  const ties = scored.filter((x) => x.best === top.best);
  if (top.best < 60 && ties.length > 1) return { item: null, ambiguous: ties.slice(0, 5).map((x) => nameOf(x.it)) };
  if (top.best < 100 && ties.length > 1) return { item: null, ambiguous: ties.slice(0, 5).map((x) => nameOf(x.it)) };
  return { item: top.it, ambiguous: [] };
}

/** A tool answer that changed his data (the phone syncs right away). */
export const wrote = (text, summary) => ({ text, summary, wrote: true });
/** A tool that refused: he hears why. */
export const refuse = (text) => ({ text, summary: text.slice(0, 120), isError: false });
