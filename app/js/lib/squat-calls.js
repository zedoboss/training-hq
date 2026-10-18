// Rep calls on a squat set with the camera (A16): "Two more.", "Last one.", "That's the target." from the live count.
// The depth ding must stay untouched, so this never runs in the camera, pose or ding path: it watches the rep
// machine from its own timer (every 50 ms), after the reps have been counted, and it speaks only while he stands at
// the top. The moment he starts down again (the machine leaves STANDING), the line stops. No beeps: a sound could be
// taken for the ding. Plain words only, and only up to the bottom of his target range (never past the target).
// `talk` is lib/talk.js (passed in, so the timing can be tested without a browser).

export const CALLS = { 2: 'Two more.', 1: 'Last one.', 0: "That's the target." };
export const POLL_MS = 50;

/** The line for a count, or null: two left, one left, target reached (the bottom of his range). */
export function repCall(good, targetReps) {
  const lo = Array.isArray(targetReps) ? Number(targetReps[0]) : Number(targetReps);
  if (!(lo >= 3)) return null;
  const left = lo - good;
  return CALLS[left] ?? null;
}

/**
 * Start watching. `read()` gives {good, state} from the rep machine; `standing` is the machine's standing state.
 * Returns stop(). Nothing happens unless talking is on (Settings > Coach) and the set has a target.
 */
export function watchReps({ talk, read, targetReps, standing = 'STANDING', pollMs = POLL_MS, setTimer = setInterval, clearTimer = clearInterval }) {
  const lo = Number(Array.isArray(targetReps) ? targetReps[0] : targetReps);
  if (!talk.talkOn() || !(lo >= 3)) return () => {};
  talk.prepare({ cues: Object.values(CALLS).map((text) => ({ text })) });
  let spokenFor = read().good;
  const id = setTimer(() => {
    const { good, state } = read();
    // Going down, at the bottom or out of sight: silent, and any line still playing stops now.
    if (state !== standing) { if (talk.running()) talk.stop(); return; }
    if (good === spokenFor) return;
    spokenFor = good;
    const text = repCall(good, targetReps);
    if (text && talk.talkOn()) talk.run({ cues: [{ at: 0, kind: 'rep', text }] });
  }, pollMs);
  return () => { clearTimer(id); if (talk.running()) talk.stop(); };
}
