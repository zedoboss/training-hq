// A16: rep calls on squat-camera sets must never touch the depth ding. They run on their own timer outside the frame
// loop, speak only while he stands at the top, and stop the moment he starts down. Here his real gym set
// (tests/squat-gym-set.json, 60 fps) goes through the app's pipeline with the watcher polled every 50 ms of set time,
// and no call may be sounding when a ding fires.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import SquatCore from '../app/js/lib/squat-core.js';
import { repCall, watchReps, CALLS, POLL_MS } from '../app/js/lib/squat-calls.js';

const { RepMachine, AngleTracker, KneeGuard, DepthEstimator, State } = SquatCore;
const gym = JSON.parse(readFileSync(new URL('./squat-gym-set.json', import.meta.url), 'utf8'));

test('rep calls: two more, last one, the target (the bottom of his range); nothing else', () => {
  assert.deepEqual([4, 5, 6, 7, 8, 9].map((g) => repCall(g, [8, 10])), [null, null, 'Two more.', 'Last one.', "That's the target.", null]);
  assert.equal(repCall(3, 5), 'Two more.');
  assert.equal(repCall(0, [2, 2]), null, 'too few reps to call');
  assert.equal(repCall(5, null), null);
  assert.ok(Object.values(CALLS).every((t) => !/come on|push|more weight/i.test(t)), 'plain words, no push');
});

/** A fake talk module on a fake clock: lines last `durMs`; stop() cuts them. */
function fakeTalk(now, durMs = 900) {
  const log = [];
  let cur = null;
  return {
    log,
    talkOn: () => true,
    prepare: () => Promise.resolve(),
    running: () => Boolean(cur && now() < cur.end && !cur.cutAt),
    run: (script) => { cur = { start: now(), end: now() + durMs, text: script.cues[0].text, cutAt: null }; log.push(cur); },
    stop: () => { if (cur && !cur.cutAt && now() < cur.end) cur.cutAt = now(); },
  };
}

test('his gym set at 60 fps: every call starts at the top and no call is sounding when a ding fires', () => {
  let t = 0;
  const dt = 1000 / gym.fps;
  const tracker = new AngleTracker(); const guard = new KneeGuard(); const est = new DepthEstimator();
  const m = new RepMachine({}, est);
  const talk = fakeTalk(() => t);
  const timers = [];
  // The watcher's timer runs in set time: one tick every 50 ms (3 frames at 60 fps), as setInterval would.
  const stop = watchReps({ talk, read: () => ({ good: m.good, state: m.state }), targetReps: [8, 10], standing: State.STANDING, setTimer: (fn, ms) => { timers.push({ fn, ms, next: ms }); return timers.length - 1; }, clearTimer: () => {} });
  const dings = []; const states = [];
  gym.frames.forEach(([angle, hipY, thigh, scale, headY], i) => {
    t = i * dt;
    for (const tm of timers) while (tm.next <= t) { tm.fn(); tm.next += tm.ms; }
    const trusted = angle !== null && guard.check(angle, hipY, thigh, m);
    const take = (ev) => { const e = ev && (ev.rep || ev); if (e?.type === 'depth') dings.push(t); };
    if (trusted) { const s = tracker.update(angle, t); if (s) take(m.update(s.angle, s.vel, t, s.dtMs, s.restarted)); }
    est.frame({ knee: trusted ? angle : null, hipY: angle !== null ? hipY : null, headY, scale: scale ?? 0 }, m);
    if (!trusted) take(m.hidden(t));
    states.push([t, m.state]);
  });
  stop();
  if (process.env.SHOW) console.log(JSON.stringify({ dings: dings.map(Math.round), calls: talk.log.map((c) => ({ text: c.text, start: Math.round(c.start), end: Math.round(c.cutAt ?? c.end), cut: c.cutAt != null })) }));
  const stateAt = (ms) => states.findLast(([x]) => x <= ms)?.[1];
  assert.ok(dings.length >= 6, `dings: ${dings.length}`);
  assert.ok(talk.log.length >= 2, `calls: ${talk.log.map((c) => c.text).join(', ')}`);
  for (const c of talk.log) {
    assert.equal(stateAt(c.start), State.STANDING, `"${c.text}" started at the top`);
    const end = c.cutAt ?? c.end;
    const during = dings.filter((d) => d >= c.start && d <= end);
    assert.deepEqual(during, [], `"${c.text}" (${Math.round(c.start)}-${Math.round(end)} ms) was not sounding at a ding`);
    const next = dings.find((d) => d > end);
    if (next != null) assert.ok(next - end >= 150, `"${c.text}": ${Math.round(next - end)} ms of silence before the next ding`);
  }
});

test('the margin: from leaving STANDING (stand - 10 = 150°) to the earliest possible ding (93°) is far over one poll', () => {
  const k = gym.frames.map((f) => f[0]); const dt = 1000 / gym.fps;
  const gaps = gym.reps.map((r, n) => {
    const to = gym.reps[n + 1]?.from ?? k.length;
    let i150 = null; let i93 = null;
    for (let i = r.from; i < to; i++) { const a = k[i]; if (a == null) continue; if (i150 === null && a < 150) i150 = i; if (i150 !== null && i93 === null && a <= 93) { i93 = i; break; } }
    return Math.round((i93 - i150) * dt);
  });
  assert.ok(Math.min(...gaps) >= 6 * POLL_MS, `his fastest descent from 150° to 93°: ${Math.min(...gaps)} ms (polled every ${POLL_MS} ms); all: ${gaps.join(', ')}`);
});
