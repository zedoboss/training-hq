// Reading the training programme that syncs from the Mac (collection "programme").
// Docs: "meta" (sources, first-session dates, ceilings, change log) and "routine.<id>" (one per routine).
import { isoDate, daysBetween } from './time.js';

/**
 * Week column for a day type: week 1 starts on the first session of that day type and moves up every
 * 7 days after it (brief decision 5). Weeks keep counting past 4; week 5+ targets are proposed separately.
 */
export function weekColumn(firstIso, todayIso) {
  if (!firstIso) return null;
  const d = daysBetween(firstIso, todayIso);
  return d < 0 ? null : Math.floor(d / 7) + 1;
}

/** Short summary for the home screen; null until the programme has synced. */
export function summarizeProgramme(docs, today = isoDate(new Date())) {
  const meta = docs.find((d) => d?.kind === 'meta');
  const routines = docs.filter((d) => d?.kind === 'routine');
  if (!meta || !routines.length) return null;
  const names = new Set();
  for (const r of routines) for (const e of r.exercises || []) names.add(e.name);
  const f = meta.firstSessions || {};
  return {
    title: meta.title,
    routineCount: routines.length,
    exerciseCount: names.size,
    weekColumns: { pull: weekColumn(f.pull, today), push: weekColumn(f.push, today), legs: weekColumn(f.legs, today) },
  };
}
