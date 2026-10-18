// Session list (3.8): every finished workout, newest first, with the app it came from; search by exercise.
import { isoDate, zoneOf } from './time.js';
import { elapsedMs, summarize } from './session.js';
import { sourceOf } from './calendar.js';

/**
 * One row per finished workout (hold rounds left out), newest first.
 * {id, title, dayType, source, startedAt, date, durationMs, sets, volume, exercises: [names], also: [names as imported]}
 */
export function sessionRows({ sessions = [], sets = [], tz } = {}) {
  const bySession = new Map();
  for (const x of sets) {
    if (!bySession.has(x.sessionId)) bySession.set(x.sessionId, []);
    bySession.get(x.sessionId).push(x);
  }
  return sessions.filter((s) => s.status === 'done' && s.kind !== 'holds')
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => {
      const ss = bySession.get(s.id) || [];
      const done = new Set(ss.filter((x) => x.done).map((x) => x.exKey));
      const sum = summarize(s, ss);
      const exs = (s.exercises || []).filter((e) => done.has(e.key));
      return {
        id: s.id, title: s.title, dayType: s.dayType ?? null, source: sourceOf(s), startedAt: s.startedAt, tz: s.tz ?? null,
        date: isoDate(new Date(s.startedAt), zoneOf(s, tz)), durationMs: s.endedAt ? elapsedMs(s) : null, sets: sum.done, volume: sum.volume,
        exercises: [...new Set(exs.map((e) => e.name))], also: [...new Set(exs.map((e) => e.importedName).filter(Boolean))],
      };
    });
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Rows whose exercises match every word of q (the name in Training HQ or as it was called in Hevy or Strong),
 * from one source or all. Each kept row gets `hits`: the matching exercise names.
 */
export function filterRows(rows, { q = '', source = null } = {}) {
  const words = norm(q).split(' ').filter(Boolean);
  const out = [];
  for (const r of rows) {
    if (source && r.source !== source) continue;
    if (!words.length) { out.push(r); continue; }
    const hits = [...r.exercises, ...r.also].filter((n) => { const t = norm(n); return words.every((w) => t.includes(w)); });
    if (hits.length) out.push({ ...r, hits });
  }
  return out;
}

/** Rows grouped by local month, keeping their order: [{month: 'YYYY-MM', rows}]. */
export function byMonth(rows) {
  const out = [];
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (out.at(-1)?.month !== m) out.push({ month: m, rows: [] });
    out.at(-1).rows.push(r);
  }
  return out;
}

/** How many rows each source has: {all, 'training-hq', hevy, strong}. */
export function sourceCounts(rows) {
  const out = { all: rows.length };
  for (const r of rows) out[r.source] = (out[r.source] || 0) + 1;
  return out;
}
