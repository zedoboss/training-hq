// Quiet times (9.9, brief section 4): while a hold or a timed set is running the coach says nothing (timer sounds
// only). Screens mark when they start and end; the voice holds anything it wanted to say until quiet ends.
const on = new Set();
const subs = new Set();

/** Mark a quiet reason ('hold', 'set-timer') on or off. */
export function setQuiet(reason, value) {
  const before = on.size > 0;
  if (value) on.add(reason); else on.delete(reason);
  if (before && !on.size) for (const f of subs) f();
}
export const isQuiet = () => on.size > 0;
/** Called when the last quiet reason ends. */
export function onQuietEnd(fn) { subs.add(fn); return () => subs.delete(fn); }
