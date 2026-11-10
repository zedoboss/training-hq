// Thu 11/5, his words at the gym: "I finished a calf raise set and then I saw the next one was Hip Thrust and I skipped
// it... once the rest time was over... the notification said do Hip Thrust next. That doesn't update instantly... If you
// escape an active session or something like that, it should update accordingly, instantly." The rest's "next set" was
// worked out once, when the rest started. Now every change to the workout (skip, undo skip, reorder, add, remove, swap,
// an edited or unticked set; on this phone, by the coach or from the Mac) works it out again at once: the rest bar, the
// workout bar, the Mac's waiting "Rest over" and the coach's line at the end of the rest name the set he'll really do.
// A workout that ended (finished or discarded anywhere) cancels its rest, so no "Rest over" comes after it; so does one
// with nothing left to do (Tue 11/10: after the last set, Finish, not a rest).
import { nextAfter, nextAfterText, oneArmIn } from './session.js';

/** The workout a rest belongs to, and the exercise it follows: the rest's own, else the active workout and the exercise
 *  of its last ticked set (a rest started by the coach before Thu 11/5 carried neither). */
export function restSource(st, sessions, sets) {
  const session = st?.from?.sessionId ? sessions.find((x) => x.id === st.from.sessionId) || null
    : sessions.find((x) => x.status === 'active' && x.kind !== 'holds') || null;
  if (!session) return { session: null, sets: [], fromKey: null };
  const mine = sets.filter((x) => x.sessionId === session.id);
  const last = [...mine].filter((x) => x.done && x.doneAt).sort((a, b) => b.doneAt - a.doneAt)[0];
  return { session, sets: mine, fromKey: st?.from?.exKey ?? last?.exKey ?? null };
}

/** That rest's next set in words, as the workout is now (lib/session.js nextAfterText). */
export function restNextText(session, sets, fromKey, history = null) {
  const n = nextAfter(session.exercises, sets, fromKey);
  return nextAfterText(n, sets, Boolean(n) && (Boolean(n.ex.oneArm) || oneArmIn(history, n.ex.name, [n.ex.notes, ...sets.filter((x) => x.exKey === n.ex.key).map((x) => x.note)])));
}

/**
 * What to do with the running rest after a change: {clear: true} when its workout is gone or over, {next} with the set
 * it now leads to, or null (no rest, a plain countdown, or nothing to go on).
 */
export function followRest(st, sessions, sets, { history = null } = {}) {
  if (!st || !st.next || st.label === 'Countdown') return null;
  const src = restSource(st, sessions, sets);
  if (!src.session) return st.from ? { clear: true } : null;
  if (src.session.status !== 'active') return { clear: true };
  if (!src.fromKey) return null;
  // Tue 11/10: nothing left to do (the rest exercises skipped, the last set ticked): no rest, the screen shows Finish.
  if (!nextAfter(src.session.exercises, src.sets, src.fromKey)) return { clear: true };
  return { next: restNextText(src.session, src.sets, src.fromKey, history) };
}

let historyNow = () => null;
/** The workout screen lends its lift history (one-arm notes from past sessions) while it is open. */
export function lendHistory(fn) { historyNow = fn; return () => { if (historyNow === fn) historyNow = () => null; }; }

/** Keeps the running rest in step with the workout (main.js), after every change to sessions or sets. */
export function keepRestInStep(repo, rest) {
  // Only this workout's sets are copied out (not his whole history), so it stays instant (repo.where).
  const setsOf = (id) => (repo.where ? repo.where('sets', (x) => x.sessionId === id) : repo.list('sets').then((all) => all.filter((x) => x.sessionId === id)));
  let busy = null; let again = false;
  const once = async () => {
    const st = rest.status();
    if (!st || !st.next || st.label === 'Countdown') return;
    const sessions = await repo.list('sessions');
    const src = restSource(st, sessions, []);
    const sets = src.session ? await setsOf(src.session.id) : [];
    const r = followRest(rest.status(), sessions, sets, { history: historyNow() });
    if (r?.clear) rest.clear(); else if (r?.next) rest.retarget(r.next);
  };
  const run = () => {
    if (busy) { again = true; return busy; }
    busy = (async () => { do { again = false; await once(); } while (again); })().catch(() => {}).finally(() => { busy = null; });
    return busy;
  };
  const stop = repo.onChange((cols) => { if (cols.includes('sessions') || cols.includes('sets')) run(); });
  return { stop, run };
}
