// Squat Depth's unit tests (angle math, filter, rep state machine, depth estimate, the gym regression), copied
// unchanged from the Squat Depth app (tests/run-tests.mjs). Only the loading changed: the logic now lives in
// app/js/lib/squat-core.js instead of a <script id="core"> block in index.html, and the gym set is
// tests/squat-gym-set.json.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import SquatCore from '../app/js/lib/squat-core.js';

const C = SquatCore;
const { RepMachine, AngleTracker, KneeGuard, DepthEstimator, SidePicker, State, kneeAngle, legProblem } = C;

const FPS = 30;
const DT = 1000 / FPS;

/** Linear angle ramp, one value per frame, at the given speed. Excludes `from`, includes `to`. */
function ramp(from, to, degPerSec = 120, fps = FPS) {
  const step = degPerSec / fps * Math.sign(to - from);
  const out = [];
  for (let a = from + step; step > 0 ? a < to : a > to; a += step) out.push(a);
  out.push(to);
  return out;
}
const hold = (angle, frames) => Array(frames).fill(angle);
const STAND = 10; // frames of standing at the start: comfortably longer than ARM_HOLD_MS at 30 fps
/** One squat: stand, go down to `bottom`, pause, come back up. */
const squat = (bottom, speed = 120, top = 172) =>
  [...hold(top, STAND), ...ramp(top, bottom, speed), ...hold(bottom, 3), ...ramp(bottom, top, speed), ...hold(top, 5)];

/** Feed angles straight into a RepMachine with finite-difference velocity. Returns the events. */
function feed(machine, angles, fps = FPS) {
  const dt = 1000 / fps;
  const events = [];
  let prev = angles[0];
  machine._t = machine._t ?? 0;
  angles.forEach((angle, i) => {
    const vel = (angle - prev) / dt * 1000;
    prev = angle;
    machine._t += dt;
    const ev = machine.update(angle, vel, machine._t, dt);
    if (ev && (ev.type !== 'armed' || machine._keepArmed)) events.push({ ...ev, frame: i, at: angle });
  });
  return events;
}
const types = (events) => events.map((e) => e.type);
// The synthetic sequences below are written around a 90 degree target, whatever the app's default is.
const noAnticipation = (cfg = {}) => new RepMachine({ anticipate: false, targetDeg: 90, ...cfg });
const withAnticipation = (cfg = {}) => new RepMachine({ anticipate: true, targetDeg: 90, ...cfg });

// ---------- Angle math ----------

test('kneeAngle: straight leg is 180, right angle is 90', () => {
  const p = (x, y) => ({ x, y });
  assert.ok(Math.abs(kneeAngle(p(0.5, 0.2), p(0.5, 0.5), p(0.5, 0.8), 100, 100) - 180) < 1e-6);
  assert.ok(Math.abs(kneeAngle(p(0.2, 0.5), p(0.5, 0.5), p(0.5, 0.8), 100, 100) - 90) < 1e-6);
});

test('kneeAngle: corrects for the frame aspect ratio', () => {
  const hip = { x: 0.4, y: 0.4 }, knee = { x: 0.5, y: 0.5 }, ankle = { x: 0.4, y: 0.6 };
  // In a square frame this is a right angle; in a 16:9 frame the same normalized points are not.
  assert.ok(Math.abs(kneeAngle(hip, knee, ankle, 100, 100) - 90) < 1e-6);
  const wide = kneeAngle(hip, knee, ankle, 1600, 900);
  const expected = 2 * Math.atan2(0.1 * 900, 0.1 * 1600) * 180 / Math.PI;
  assert.ok(Math.abs(wide - expected) < 1e-6, `got ${wide}, expected ${expected}`);
});

test('kneeAngle: degenerate points give NaN, not a crash', () => {
  const p = { x: 0.5, y: 0.5 };
  assert.ok(Number.isNaN(kneeAngle(p, p, p, 100, 100)));
});

// ---------- Rep state machine ----------

test('full rep: one ding on the first frame at or below target, rep counted on stand-up', () => {
  const m = noAnticipation();
  const angles = squat(80);
  const events = feed(m, angles);
  assert.deepEqual(types(events), ['depth', 'rep']);
  const depth = events[0];
  assert.ok(depth.at <= 90, 'ding fired at or below target');
  assert.ok(angles[depth.frame - 1] > 90, 'the frame before was still above target: no confirmation delay');
  assert.equal(depth.anticipated, false);
  assert.ok(events[1].at >= 160, 'rep completes only once back above the standing threshold');
  assert.equal(m.good, 1);
  assert.equal(m.shallow, 0);
  assert.equal(Math.round(m.lastMin), 80);
  assert.equal(m.state, State.STANDING);
});

test('rep count does not increase until the stand-up', () => {
  const m = noAnticipation();
  feed(m, [...hold(172, STAND), ...ramp(172, 80), ...hold(80, 10)]);
  assert.equal(m.dings, 1);
  assert.equal(m.good, 0);
  assert.equal(m.state, State.DEPTH);
  feed(m, ramp(80, 172));
  assert.equal(m.good, 1);
});

test('shallow rep: below 130 but above target gives a shallow event and no ding', () => {
  const m = noAnticipation();
  const events = feed(m, squat(110));
  assert.deepEqual(types(events), ['shallow']);
  assert.equal(m.dings, 0);
  assert.equal(m.good, 0);
  assert.equal(m.shallow, 1);
  assert.equal(Math.round(m.lastMin), 110);
});

test('a small dip that stays above 130 is ignored', () => {
  const m = noAnticipation();
  const events = feed(m, squat(140));
  assert.deepEqual(events, []);
  assert.equal(m.shallow, 0);
  assert.equal(m.state, State.STANDING);
});

test('jitter around the target: exactly one ding', () => {
  const m = noAnticipation();
  const wobble = Array.from({ length: 60 }, (_, i) => 90 + (i % 2 ? 2.5 : -2.5)); // 87.5 / 92.5 / 87.5 ...
  const events = feed(m, [...hold(172, STAND), ...ramp(172, 93), ...wobble, ...ramp(93, 172), ...hold(172, 5)]);
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.equal(m.dings, 1);
});

test('jitter around the standing threshold: no phantom reps', () => {
  const m = noAnticipation();
  const wobble = Array.from({ length: 200 }, (_, i) => 160 + 4 * Math.sin(i * 1.7)); // 156..164
  assert.deepEqual(feed(m, [...hold(172, STAND), ...wobble]), []);
  assert.equal(m.good + m.shallow + m.dings, 0);
});

test('jitter around the descend threshold: no phantom reps', () => {
  const m = noAnticipation();
  const wobble = Array.from({ length: 200 }, (_, i) => 150 + 4 * Math.sin(i * 1.3)); // 146..154
  assert.deepEqual(feed(m, [...hold(172, STAND), ...wobble, ...hold(172, 5)]), []);
});

test('must re-arm: no second ding until back above the standing threshold', () => {
  const m = noAnticipation();
  // Down, half-way up to 150 (below the 160 re-arm line), down again.
  let events = feed(m, [...hold(172, STAND), ...ramp(172, 80), ...ramp(80, 150), ...ramp(150, 80)]);
  assert.deepEqual(types(events), ['depth']);
  // Now a proper lock-out, then the next rep dings again.
  events = feed(m, [...ramp(80, 172), ...hold(172, 3), ...ramp(172, 80), ...ramp(80, 172)]);
  assert.deepEqual(types(events), ['rep', 'depth', 'rep']);
  assert.equal(m.good, 2);
  assert.equal(Math.round(m.lastMin), 80);
});

test('five reps in a row: five dings, five good reps', () => {
  const m = noAnticipation();
  const events = feed(m, Array.from({ length: 5 }, () => squat(85)).flat());
  assert.equal(events.filter((e) => e.type === 'depth').length, 5);
  assert.equal(m.good, 5);
  assert.equal(m.shallow, 0);
});

test('mixed set: good, shallow, good', () => {
  const m = noAnticipation();
  const events = feed(m, [...squat(85), ...squat(115), ...squat(88)]);
  assert.deepEqual(types(events), ['depth', 'rep', 'shallow', 'depth', 'rep']);
  assert.equal(m.good, 2);
  assert.equal(m.shallow, 1);
});

test('not armed until seen standing: a brief crouch or a pass through depth does not ding', () => {
  const m = noAnticipation();
  // Comes into view already low, stays there 200 ms (under DEPTH_HOLD_MS), stands up.
  let events = feed(m, [...hold(80, 6), ...ramp(80, 172), ...hold(172, STAND)]);
  assert.deepEqual(events, []);
  assert.equal(m.state, State.STANDING);
  events = feed(m, squat(80).slice(STAND));
  assert.deepEqual(types(events), ['depth', 'rep']);
});

test('held at depth without a watched descent: one late ding, and the rep counts on stand-up', () => {
  const m = noAnticipation();
  const frames = hold(80, 30); // one second sitting at depth
  const events = feed(m, frames);
  assert.deepEqual(types(events), ['depth']);
  assert.equal(events[0].late, true);
  const heldMs = events[0].frame * DT;
  assert.ok(heldMs >= C.DEPTH_HOLD_MS && heldMs < C.DEPTH_HOLD_MS + 2 * DT, `late ding after ${heldMs.toFixed(0)} ms`);
  assert.equal(m.late, 1);
  assert.deepEqual(types(feed(m, [...ramp(80, 172), ...hold(172, 5)])), ['rep']);
  assert.equal(m.good, 1);
  // Hovering just above the target never earns the late ding.
  const m2 = noAnticipation();
  assert.deepEqual(feed(m2, hold(95, 60)), []);
});

test('late ding needs an unbroken hold: an interruption restarts the clock', () => {
  const m = noAnticipation();
  feed(m, hold(80, 7));                                   // 233 ms at depth
  assert.equal(m.update(80, 0, m._t + DT, DT, true), null); // tracking restarted
  m._t += DT;
  assert.deepEqual(feed(m, hold(80, 7)), []);             // another 233 ms: still not enough since the restart
  assert.deepEqual(types(feed(m, hold(80, 6))), ['depth']);
});

test('resetState mid-rep disarms without touching the counts', () => {
  const m = noAnticipation();
  feed(m, squat(80));
  feed(m, [...hold(172, 3), ...ramp(172, 120)]);
  m.resetState();
  const events = feed(m, [...ramp(120, 80), ...hold(80, 5)]);
  assert.deepEqual(events, []);
  assert.equal(m.good, 1);
});

test('custom thresholds: target 110, standing 150', () => {
  const m = noAnticipation({ targetDeg: 110, standDeg: 150 });
  assert.equal(m.descendDeg, 140);
  const angles = [...hold(155, STAND), ...ramp(155, 105), ...ramp(105, 155), ...hold(155, 5)];
  const events = feed(m, angles);
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.ok(events[0].at <= 110 && angles[events[0].frame - 1] > 110);
  assert.ok(events[1].at >= 150);
});

test('thresholds stay ordered at the slider extremes', () => {
  for (const targetDeg of [60, 90, 130]) {
    for (const standDeg of [150, 160, 175]) {
      const m = new RepMachine({ targetDeg, standDeg });
      assert.ok(m.targetDeg < m.shallowDeg, `target < shallow (${targetDeg}/${standDeg})`);
      assert.ok(m.shallowDeg <= m.descendDeg, `shallow <= descend (${targetDeg}/${standDeg})`);
      assert.ok(m.descendDeg < m.standDeg, `descend < stand (${targetDeg}/${standDeg})`);
    }
  }
  const junk = new RepMachine({ targetDeg: 'abc', standDeg: 999 });
  assert.equal(junk.targetDeg, C.TARGET_DEG_DEFAULT);
  assert.equal(junk.standDeg, 175);
});

test('arming needs a sustained stand, not a single standing frame', () => {
  const m = noAnticipation();
  // Two standing frames (67 ms), then straight down: never armed, so no ding.
  let events = feed(m, [...hold(172, 2), ...ramp(172, 80), ...hold(80, 3)]); // too brief at depth for the late ding
  assert.deepEqual(events, []);
  assert.equal(m.state, State.UNKNOWN);
  // A wobble below the line restarts the hold.
  events = feed(m, [...ramp(80, 172), ...hold(172, 4), 150, ...hold(172, 4), ...ramp(172, 80)]);
  assert.deepEqual(events, []);
});

test('armed event: fires once when first seen standing, and again only after being disarmed', () => {
  const m = noAnticipation();
  m._keepArmed = true;
  let events = feed(m, hold(172, STAND));
  assert.deepEqual(types(events), ['armed']);
  assert.ok(Math.abs(events[0].frame * DT - C.ARM_HOLD_MS) <= DT, 'after ARM_HOLD_MS of standing');
  // A normal rep re-arms silently: no second blip between reps.
  events = feed(m, squat(80).slice(STAND));
  assert.deepEqual(types(events), ['depth', 'rep']);
  // Tracking interrupted while standing: disarmed, then armed (and announced) again.
  m.update(172, 0, m._t + 600, DT, true); m._t += 600;
  assert.deepEqual(types(feed(m, hold(172, STAND))), ['armed']);
});

test('depth never fires on the frame a descent starts', () => {
  const m = noAnticipation();
  feed(m, hold(172, STAND));
  assert.equal(m.update(60, -3000, m._t + DT, DT), null, 'standing to 60 degrees in one frame is not a squat');
  assert.equal(m.state, State.DESCENDING);
});

test('an interruption before the ding disarms; after the ding it does not', () => {
  const m = noAnticipation();
  feed(m, [...hold(172, STAND), ...ramp(172, 120)]);
  assert.equal(m.state, State.DESCENDING);
  // Tracking restarts mid-descent and comes back already at depth: no ding, and no shallow buzz later.
  assert.equal(m.update(80, 0, m._t + 600, DT, true), null);
  assert.equal(m.state, State.UNKNOWN);
  m._t += 600;
  assert.deepEqual(feed(m, [...hold(80, 5), ...ramp(80, 172), ...hold(172, STAND)]), []);
  // Fully watched rep, with a restart while he is at the bottom after the ding: the rep still counts.
  let events = feed(m, [...ramp(172, 80)]);
  assert.deepEqual(types(events), ['depth']);
  assert.equal(m.update(80, 0, m._t + 600, DT, true), null);
  assert.equal(m.state, State.DEPTH);
  m._t += 600;
  events = feed(m, ramp(80, 172));
  assert.deepEqual(types(events), ['rep']);
  assert.equal(m.good, 1);
  assert.equal(m.shallow, 0);
});

// ---------- Anticipation ----------

test('anticipation: dings one frame before the crossing on a steady descent', () => {
  const angles = squat(80);
  const plain = feed(noAnticipation(), angles)[0];
  const m = withAnticipation();
  const events = feed(m, angles);
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.equal(events[0].anticipated, true);
  assert.equal(events[0].frame, plain.frame - 1, 'exactly one frame earlier than without anticipation');
  assert.ok(events[0].at > 90);
  assert.equal(m.early, 1);
  assert.equal(m.earlyMissed, 0);
  assert.equal(m.earlyConfirmed, 1);
  assert.ok(Math.abs(m.earlyLeadSumMs - DT) < 1, 'logged lead is one frame');
});

test('anticipation: no early ding on a slow creep toward the target', () => {
  const m = withAnticipation();
  // 10 deg/s is below ANTICIPATE_MIN_VEL, so the ding must wait for the real crossing.
  const angles = [...hold(172, STAND), ...ramp(172, 100), ...ramp(100, 88, 10), ...ramp(88, 172)];
  const events = feed(m, angles);
  assert.equal(events[0].type, 'depth');
  assert.equal(events[0].anticipated, false);
  assert.ok(events[0].at <= 90);
  assert.equal(m.early, 0);
});

test('anticipation: never fires on the way up', () => {
  const m = withAnticipation();
  // Bottoms out at 93 (above target), then rises: velocity is positive right next to the target.
  const events = feed(m, [...hold(172, STAND), ...ramp(172, 100), ...ramp(100, 93, 15), ...hold(93, 3), ...ramp(93, 172)]);
  assert.deepEqual(types(events), ['shallow']);
});

test('anticipation: an early ding that never reaches target is counted as missed', () => {
  const m = withAnticipation();
  // Fast descent that stops dead at 92: the prediction fires, the knee never gets to 90.
  const events = feed(m, [...hold(172, STAND), ...ramp(172, 92, 150), ...hold(92, 5), ...ramp(92, 172)]);
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.equal(events[0].anticipated, true);
  assert.equal(events[1].confirmed, false);
  assert.equal(m.early, 1);
  assert.equal(m.earlyMissed, 1);
  assert.equal(m.good, 1, 'he heard a ding, so the rep counts; the miss shows up in the log');
});

test('anticipation: lead is capped, a velocity spike cannot fire far above target', () => {
  const m = withAnticipation({ extraLeadMs: 150 });
  m.update(172, 0, 0, DT);
  m.update(172, 0, C.ARM_HOLD_MS, DT);               // armed
  const t = C.ARM_HOLD_MS;
  m.update(140, -690, t + DT, DT);                   // descending, absurd velocity
  assert.equal(m.update(90 + C.ANTICIPATE_MAX_DEG + 1, -690, t + 2 * DT, DT), null);
  assert.equal(m.update(90 + C.ANTICIPATE_MAX_DEG - 1, -690, t + 3 * DT, DT).type, 'depth');
});

test('anticipation: extra lead fires earlier than one frame', () => {
  const angles = squat(80);
  const oneFrame = feed(withAnticipation(), angles)[0];
  const extra = feed(withAnticipation({ extraLeadMs: 60 }), angles)[0];
  assert.ok(extra.frame < oneFrame.frame);
  assert.ok(oneFrame.frame - extra.frame <= 3, '60 ms at 30 fps is about two more frames');
});

// ---------- Angle tracker (filter, velocity, glitch rejection) ----------

function track(tracker, angles, fps = FPS, t0 = 0) {
  const dt = 1000 / fps;
  return angles.map((a, i) => { const s = tracker.update(a, t0 + i * dt); return s ? { ...s } : null; });
}

test('tracker: filter lag on a steady 120 deg/s descent stays under 3 degrees', () => {
  for (const fps of [30, 60]) {
    const angles = [...hold(170, 10), ...ramp(170, 80, 120, fps)];
    const out = track(new AngleTracker(), angles, fps);
    const i = angles.findIndex((a) => a <= 95);
    const lag = out[i].angle - angles[i];
    assert.ok(lag >= 0 && lag < 3, `lag at ${fps} fps was ${lag.toFixed(2)} deg`);
  }
});

test('tracker: velocity estimate matches a steady ramp', () => {
  const out = track(new AngleTracker(), [...hold(170, 10), ...ramp(170, 80, 120)]);
  const mid = out[out.length - 5];
  assert.ok(mid.vel < -100 && mid.vel > -130, `velocity was ${mid.vel.toFixed(1)}`);
  assert.ok(Math.abs(mid.dtMs - DT) < 1);
});

test('tracker: standing jitter is reduced (the filter is deliberately light) and velocity stays small', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // White noise of +/-1 degree is harsher than real landmark jitter, which MediaPipe pre-smooths.
  const out = track(new AngleTracker(), Array.from({ length: 240 }, () => 170 + rand()));
  const tail = out.slice(30);
  const spread = Math.max(...tail.map((s) => s.angle)) - Math.min(...tail.map((s) => s.angle));
  assert.ok(spread < 1.4, `filtered spread ${spread.toFixed(2)} should be under the raw 2.0`);
  const speeds = tail.map((s) => Math.abs(s.vel)).sort((a, b) => a - b);
  assert.ok(speeds[speeds.length >> 1] < C.ANTICIPATE_MIN_VEL / 4, 'typical jitter velocity is far below the anticipation gate');
});

test('tracker: a single-frame glitch is rejected and never reaches the state machine', () => {
  const t = new AngleTracker();
  const m = noAnticipation();
  const angles = [...hold(172, 20), 60, ...hold(172, 20)]; // one wild frame
  let events = 0, rejected = 0;
  angles.forEach((a, i) => {
    const s = t.update(a, i * DT);
    if (!s) { if (i > 0) rejected++; return; } // frame 0 is always held back as a candidate
    const ev = m.update(s.angle, s.vel, i * DT, s.dtMs, s.restarted);
    if (ev && ev.type !== 'armed') events++;
  });
  assert.equal(rejected, 1);
  assert.equal(events, 0);
  assert.equal(m.state, State.STANDING);
});

test('tracker: a jump that persists is accepted after a few frames, flagged as a restart', () => {
  const out = track(new AngleTracker(), [...hold(172, 10), ...hold(100, 10)]);
  assert.deepEqual(out.slice(10, 13), [null, null, null]); // two outliers, then a held-back candidate
  assert.ok(out[13] && Math.abs(out[13].angle - 100) < 1e-9);
  assert.equal(out[13].restarted, true);
  assert.equal(out[14].restarted, false);
});

test('tracker: the first sample is held back until a second one agrees', () => {
  const t = new AngleTracker();
  assert.equal(t.update(172, 0), null);
  const s = t.update(171, DT);
  assert.ok(s && s.restarted === true);
  assert.equal(t.update(170, 2 * DT).restarted, false);
  // A lone reading followed by a wildly different one is never emitted.
  const u = new AngleTracker();
  assert.equal(u.update(41, 0), null);
  assert.equal(u.update(172, DT), null);
  assert.ok(u.update(172, 2 * DT));
});

test('tracker: restarts cleanly after a gap or a backwards timestamp', () => {
  const t = new AngleTracker();
  track(t, hold(172, 10));
  const t0 = 10 * DT + C.GAP_RESET_MS + 1;
  assert.equal(t.update(100, t0), null);              // candidate after the gap
  const afterGap = t.update(100, t0 + DT);
  assert.equal(afterGap.angle, 100);
  assert.equal(afterGap.vel, 0);
  assert.equal(afterGap.restarted, true);
  assert.equal(t.update(150, 5), null);               // file replay: time goes backwards, start over
  const rewound = t.update(150, 5 + DT);
  assert.equal(rewound.angle, 150);
  assert.equal(rewound.restarted, true);
  assert.equal(t.update(NaN, 50), null);
});

// ---------- End to end: noisy synthetic set through tracker + machine ----------

test('end to end: noisy 8-rep set at 30 and 60 fps, every ding lands within one frame of the true crossing', () => {
  for (const fps of [30, 60]) {
    for (const anticipate of [false, true]) {
      let seed = 42;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const dt = 1000 / fps, period = 3; // seconds per rep
      const lead = 0.5; // seconds of standing before the first rep, so the machine arms
      const truth = (tSec) => tSec < lead ? 172 : 126 + 46 * Math.cos(2 * Math.PI * (tSec - lead) / period); // 172 at the top, 80 at the bottom
      const tracker = new AngleTracker(), m = new RepMachine({ anticipate, targetDeg: 90 });
      const dingTimes = [];
      const frames = Math.round((lead + 8 * period) * fps);
      for (let i = 0; i <= frames; i++) {
        const tMs = i * dt;
        const s = tracker.update(truth(tMs / 1000) + 1.5 * rand(), tMs);
        if (!s) continue;
        const ev = m.update(s.angle, s.vel, tMs, s.dtMs, s.restarted);
        if (ev?.type === 'depth') dingTimes.push(tMs);
      }
      assert.equal(dingTimes.length, 8, `${fps} fps anticipate=${anticipate}: dings`);
      assert.ok(m.good >= 7, `${fps} fps: good reps ${m.good}`); // the 8th finishes on the last frame
      assert.equal(m.shallow, 0);
      // True crossing of 90 deg in each rep: cos(x) = (90-126)/46
      const phase = Math.acos((90 - 126) / 46) / (2 * Math.PI) * period * 1000;
      dingTimes.forEach((tDing, rep) => {
        const late = tDing - (lead * 1000 + rep * period * 1000 + phase);
        assert.ok(late < 2 * dt + 20, `${fps} fps anticipate=${anticipate} rep ${rep}: ding ${late.toFixed(0)} ms after crossing`);
        assert.ok(late > -3 * dt - 20, `${fps} fps anticipate=${anticipate} rep ${rep}: ding ${(-late).toFixed(0)} ms early`);
      });
    }
  }
});

// ---------- Regression: phantom rep when the body is half out of frame (seen on the phone) ----------

/** Run raw angles (null = no usable pose that frame) through tracker + machine, like the app does. */
function pipeline(rawAngles, { fps = 60, anticipate = true } = {}) {
  const dt = 1000 / fps, tracker = new AngleTracker(), m = new RepMachine({ anticipate, targetDeg: 90 });
  const events = [];
  rawAngles.forEach((raw, i) => {
    if (raw === null) return;
    const s = tracker.update(raw, i * dt);
    if (!s) return;
    const ev = m.update(s.angle, s.vel, i * dt, s.dtMs, s.restarted);
    if (ev && ev.type !== 'armed') events.push(ev.type);
  });
  return { events, m };
}

test('phantom rep: a stray low reading after a tracking gap does not ding or count', () => {
  // Standing lock, body lost for half a second, one garbage frame at 41 degrees, then standing again.
  const { events, m } = pipeline([...hold(173, 30), ...Array(30).fill(null), 41, 172, 172, 172, ...hold(172, 60)]);
  assert.deepEqual(events, []);
  assert.equal(m.dings + m.good + m.shallow, 0);
  assert.equal(m.state, State.STANDING, 're-armed once he is seen standing again');
});

test('phantom rep: garbage that persists for several frames after a gap still does not ding', () => {
  const { events, m } = pipeline([...hold(173, 30), ...Array(30).fill(null), ...hold(41, 6), ...Array(30).fill(null), ...hold(172, 60)]);
  assert.deepEqual(events, []);
  assert.equal(m.dings + m.good + m.shallow, 0);
});

test('phantom rep: flickering lock with wild readings never produces an event', () => {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const raw = [...hold(173, 30)];
  for (let i = 0; i < 600; i++) raw.push(rand() < 0.6 ? null : 15 + 165 * rand()); // 10 s of noise
  const { m } = pipeline(raw);
  assert.equal(m.dings, 0);
  assert.equal(m.good, 0);
});

test('phantom rep: a big jump across a short dropout is not trusted as movement', () => {
  // Descent under way, 250 ms of lost frames, then a reading 100 degrees lower that lingers, then standing.
  const down = ramp(172, 140, 120, 60);
  const { events, m } = pipeline([...hold(172, 30), ...down, ...Array(15).fill(null), ...hold(38, 8), ...hold(172, 60)]);
  assert.deepEqual(events, []);
  assert.equal(m.dings + m.good + m.shallow, 0);
});

test('short dropouts during a real descent do not cost the ding', () => {
  // 60 fps rep with three frames (50 ms) missing every now and then.
  const rep = squat(80, 120).flatMap((a, i, arr) => [a, i + 1 < arr.length ? (a + arr[i + 1]) / 2 : a]);
  const holes = rep.map((a, i) => (i % 17 >= 14 ? null : a));
  const { events, m } = pipeline(holes);
  assert.deepEqual(events, ['depth', 'rep']);
  assert.equal(m.good, 1);
});

test('a real rep right after a tracking gap still dings once he has been seen standing', () => {
  const rep = squat(80, 120).flatMap((a, i, arr) => [a, i + 1 < arr.length ? (a + arr[i + 1]) / 2 : a]); // 30 -> 60 fps
  const { events, m } = pipeline([...hold(173, 30), ...Array(40).fill(null), ...rep]);
  assert.deepEqual(events, ['depth', 'rep']);
  assert.equal(m.good, 1);
});

// ---------- Leg plausibility ----------

function body({ shoulder = [0.5, 0.2], hip = [0.5, 0.45], knee = [0.5, 0.65], ankle = [0.5, 0.85], vis = 0.9 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i, [x, y]) => { lm[i] = { x, y, visibility: vis }; };
  put(11, shoulder); put(C.LEG.L[0], hip); put(C.LEG.L[1], knee); put(C.LEG.L[2], ankle);
  return lm;
}

test('legProblem: a whole, visible, side-on leg is fine', () => {
  assert.equal(legProblem(body(), 'L', 960, 540), null);
  assert.equal(legProblem(body({ hip: [0.35, 0.62], knee: [0.55, 0.65], ankle: [0.5, 0.88] }), 'L', 540, 960), null); // deep squat
});

test('legProblem: joints outside or at the edge of the frame are rejected', () => {
  assert.equal(legProblem(body({ ankle: [0.5, 1.08] }), 'L', 960, 540), 'frame');   // feet below the picture
  assert.equal(legProblem(body({ ankle: [0.5, 0.995] }), 'L', 960, 540), 'frame');  // pinned to the edge
  assert.equal(legProblem(body({ hip: [0.5, -0.1], knee: [0.5, 0.01] }), 'L', 960, 540), 'frame'); // the phantom-rep frame
  assert.equal(legProblem(body({ shoulder: [0.5, -0.3] }), 'L', 960, 540), 'frame'); // legs only: torso cut off
});

test('legProblem: occluded joints and impossible proportions are rejected', () => {
  assert.equal(legProblem(body({ vis: 0.3 }), 'L', 960, 540), 'hidden');
  assert.equal(legProblem(body({ hip: [0.5, 0.62], knee: [0.5, 0.65] }), 'L', 960, 540), 'shape'); // thigh a sliver of the shin
  assert.equal(legProblem(body({ ankle: [0.5, 0.65] }), 'L', 960, 540), 'shape');                  // zero-length shin
});

// ---------- Side picker ----------

function landmarks(visL, visR) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  for (const i of C.LEG.L) lm[i].visibility = visL;
  for (const i of C.LEG.R) lm[i].visibility = visR;
  return lm;
}

test('side picker: starts on the more visible leg, or the only usable one', () => {
  assert.equal(new SidePicker().update(landmarks(0.9, 0.4)), 'L');
  assert.equal(new SidePicker().update(landmarks(0.3, 0.8)), 'R');
  assert.equal(new SidePicker().update(landmarks(0.9, 0.4), false, true), 'R');
});

test('side picker: switches to a clearly better leg after a few frames, not on a flicker', () => {
  const p = new SidePicker();
  p.update(landmarks(0.6, 0.55));
  assert.equal(p.side, 'L');
  // One frame where the other leg looks better, then back: no switch.
  p.update(landmarks(0.3, 0.8)); p.update(landmarks(0.6, 0.55));
  assert.equal(p.side, 'L');
  // Nearly equal visibility (inside the margin) never switches.
  for (let i = 0; i < 100; i++) p.update(landmarks(0.6, 0.7));
  assert.equal(p.side, 'L');
  // Clearly better for SIDE_SWITCH_FRAMES in a row: switch.
  for (let i = 0; i < C.SIDE_SWITCH_FRAMES - 1; i++) p.update(landmarks(0.45, 0.75));
  assert.equal(p.side, 'L');
  p.update(landmarks(0.45, 0.75));
  assert.equal(p.side, 'R');
});

test('side picker: leaves an unusable leg immediately when the other one is fine', () => {
  const p = new SidePicker();
  p.update(landmarks(0.6, 0.55));
  assert.equal(p.update(landmarks(0.3, 0.7), false, true), 'R'); // far leg went behind the near one
  // ...but stays put if the other leg is unusable too.
  const q = new SidePicker();
  q.update(landmarks(0.6, 0.55));
  assert.equal(q.update(landmarks(0.2, 0.9), false, false), 'L');
});

test('regression: far leg picked while standing, hidden once the knees bend: the rep still dings', () => {
  // What happened on the phone: both legs look alike standing, the far (left) one is picked, then it
  // disappears behind the near leg during the descent. The picker must hand over without losing the rep.
  const fps = 60, dt = 1000 / fps;
  const angles = squat(70, 120).flatMap((a, i, arr) => [a, i + 1 < arr.length ? (a + arr[i + 1]) / 2 : a]);
  const picker = new SidePicker(), tracker = new AngleTracker(), m = new RepMachine({ anticipate: false, targetDeg: 75 });
  const events = [];
  angles.forEach((angle, i) => {
    const bent = angle < 150;
    const lm = landmarks(bent ? 0.3 : 0.57, bent ? 0.7 : 0.5);   // left is the far leg
    const okL = !bent, okR = true;                               // far leg drops under MIN_VISIBILITY when bent
    const side = picker.update(lm, okL, okR);
    if (!(side === 'L' ? okL : okR)) return;
    const raw = side === 'L' ? angle + 4 : angle;                // the two legs read a few degrees apart
    const s = tracker.update(raw, i * dt);
    if (!s) return;
    const ev = m.update(s.angle, s.vel, i * dt, s.dtMs, s.restarted);
    if (ev && ev.type !== 'armed') events.push(ev.type);
  });
  assert.deepEqual(events, ['depth', 'rep']);
  assert.equal(picker.side, 'R');
  assert.equal(m.late, 0, 'a normal ding, not the late fallback');
});

test('default target is 75 degrees', () => {
  assert.equal(C.TARGET_DEG_DEFAULT, 75);
  assert.equal(new RepMachine().targetDeg, 75);
});

// ---------- Bottom not seen: no shallow call on a rep whose bottom the camera missed ----------
// (These machines have no depth estimator, so a hidden bottom ends as 'unseen'. With one, see the next section.)

/** Like feed(), but `null` frames have no trusted reading: time passes and the machine hears nothing. */
function feedWithGaps(machine, angles, fps = FPS) {
  const dt = 1000 / fps, events = [];
  let prev = null;
  machine._t = machine._t ?? 0;
  angles.forEach((angle, i) => {
    machine._t += dt;
    if (angle === null) return;
    const vel = prev === null ? 0 : (angle - prev) / dt * 1000;
    prev = angle;
    const ev = machine.update(angle, vel, machine._t, dt);
    if (ev && ev.type !== 'armed') events.push({ ...ev, frame: i, at: angle });
  });
  return events;
}
const blind = (ms, fps = FPS) => Array(Math.round(ms * fps / 1000)).fill(null);

test('blind spot at the bottom, nothing to estimate from: not called shallow, reported as not seen, not counted', () => {
  const m = noAnticipation();
  const events = feedWithGaps(m, [...hold(172, STAND), ...ramp(172, 100), ...hold(100, 2), ...blind(200),
    ...hold(108, 2), ...ramp(108, 172), ...hold(172, 5)]);
  assert.deepEqual(types(events), ['unseen']);
  assert.equal(Math.round(events[0].minAngle), 100);
  assert.equal(m.unseen, 1);
  assert.equal(m.shallow + m.good + m.dings, 0);
  assert.equal(m.lastMin, null, 'no number for a rep it could not measure');
  assert.equal(m.state, State.STANDING);
  // The next rep is judged normally.
  assert.deepEqual(types(feedWithGaps(m, squat(80).slice(STAND))), ['depth', 'rep']);
});

test('blind spot after he was seen coming back up: still a shallow rep', () => {
  const m = noAnticipation();
  const events = feedWithGaps(m, [...hold(172, STAND), ...ramp(172, 100), ...hold(100, 2), ...ramp(100, 115),
    ...blind(200), ...ramp(125, 172), ...hold(172, 5)]);
  assert.deepEqual(types(events), ['shallow']);
  assert.equal(m.unseen, 0);
});

test('blind spot on the way down that comes back deeper: the bottom is still watched', () => {
  const m = noAnticipation();
  const events = feedWithGaps(m, [...hold(172, STAND), ...ramp(172, 120), ...blind(200), ...ramp(116, 100),
    ...hold(100, 2), ...ramp(100, 172), ...hold(172, 5)]);
  assert.deepEqual(types(events), ['shallow']);
  assert.equal(Math.round(m.lastMin), 100);
});

test('a flicker at the bottom shorter than BOTTOM_GAP_MS does not hide it', () => {
  const m = noAnticipation();
  assert.ok(2 * DT < C.BOTTOM_GAP_MS);
  const events = feedWithGaps(m, [...hold(172, STAND), ...ramp(172, 100), ...hold(100, 2), null, // one lost frame
    ...hold(106, 2), ...ramp(106, 172), ...hold(172, 5)]);
  assert.deepEqual(types(events), ['shallow']);
});

test('tracking lost at the bottom: no shallow call; the verdict comes when he is back standing', () => {
  const m = noAnticipation();
  m._keepArmed = true;
  feed(m, [...hold(172, STAND), ...ramp(172, 100), ...hold(100, 3)]);
  assert.equal(m.update(110, 0, m._t + 600, DT, true), null); // tracking restarts on the way up
  m._t += 600;
  const events = feed(m, [...ramp(110, 172), ...hold(172, STAND)]);
  assert.deepEqual(types(events), ['armed'], 'the ready blip, as after any interruption');
  assert.equal(events[0].rep.type, 'unseen');
  assert.equal(Math.round(events[0].rep.minAngle), 100);
  assert.equal(m.unseen, 1);
  assert.equal(m.shallow + m.good + m.dings, 0);
  // Lost on the way down, before the shallow line: nothing to report.
  feed(m, ramp(172, 140));
  assert.equal(m.update(160, 0, m._t + 600, DT, true), null);
  m._t += 600;
  const again = feed(m, hold(172, STAND));
  assert.deepEqual(types(again), ['armed']);
  assert.equal(again[0].rep, undefined);
  assert.equal(m.unseen, 1);
});

test('tracking lost at the bottom, then held at depth: the late ding judges the rep', () => {
  const m = noAnticipation();
  m._keepArmed = true;
  feed(m, [...hold(172, STAND), ...ramp(172, 100)]);
  m.update(85, 0, m._t + 600, DT, true);
  m._t += 600;
  const events = feed(m, [...hold(85, 12), ...ramp(85, 172), ...hold(172, STAND)]);
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.equal(events[0].late, true);
  assert.equal(m.unseen, 0);
});

test('knee guard: an opening knee is only believed if the hip rises with it', () => {
  const m = noAnticipation(), guard = new KneeGuard();
  const step = (angle, hipY) => {
    const ok = guard.check(angle, hipY, 120, m);
    if (ok) { m._t = (m._t ?? 0) + DT; m.update(angle, 0, m._t, DT); }
    return ok;
  };
  hold(172, STAND).forEach((a) => assert.ok(step(a, 700)));
  const down = ramp(172, 100);
  down.forEach((a, i) => assert.ok(step(a, 700 + 120 * (i + 1) / down.length))); // hip sinks to 820
  // The knee point slides down the shin: the angle opens while the hip is still sinking. Not believed.
  assert.equal(step(112, 822), false);
  assert.equal(step(125, 824), false);
  assert.equal(m.minAngle, 100);
  // Wobble close to the deepest reading is fine.
  assert.equal(step(104, 824), true);
  // Coming back up for real: the hip rises with the knee.
  assert.equal(step(115, 805), true);
  assert.equal(step(140, 770), true);
  assert.deepEqual(types(feed(m, ramp(140, 172))), ['shallow']);
  assert.equal(guard.check(60, 700, 120, m), true, 'between reps nothing is checked');
});

// ---------- Depth estimate from the hip and head, when the knee is lost at the bottom ----------

/** A body whose hip and head drop in step with the knee: standing hip 700, head 450, leg 240 px. */
const bodyAt = (angle) => ({ hipY: 700 + 240 * (175 - angle) / 200, headY: 450 + 240 * (175 - angle) / 180, scale: 240 });
/**
 * Frames through estimator and machine the way the screen does it: {a: true knee angle, seen: knee believed}.
 * A frame whose knee isn't seen still feeds the estimator (the hip and head are in view) and asks hidden().
 */
function feedBody(m, est, frames, fps = FPS) {
  const dt = 1000 / fps, events = [];
  let prev = null;
  m._t = m._t ?? 0;
  for (const { a, seen = true } of frames) {
    m._t += dt;
    est.frame({ knee: seen ? a : null, ...bodyAt(a) }, m);
    let ev;
    if (seen) { ev = m.update(a, prev === null ? 0 : (a - prev) / dt * 1000, m._t, dt); prev = a; } else ev = m.hidden(m._t);
    if (ev && (ev.type !== 'armed' || ev.rep)) events.push(ev);
    if (ev && ev.rep) events.push(ev.rep);
  }
  return events;
}
const seen = (angles) => angles.map((a) => ({ a }));
const unseen = (angles) => angles.map((a) => ({ a, seen: false }));
/** Standing, then three clean reps to 70: the calibration. */
function calibrated() {
  const est = new DepthEstimator(), m = new RepMachine({ anticipate: false, targetDeg: 75 }, est);
  const events = feedBody(m, est, seen([...hold(172, STAND), ...[1, 2, 3].flatMap(() => [...ramp(172, 70), ...hold(70, 3), ...ramp(70, 172), ...hold(172, 5)])]));
  assert.deepEqual(types(events), ['depth', 'rep', 'depth', 'rep', 'depth', 'rep']);
  return { est, m };
}
/** A rep seen down to 100, the knee lost from there through its bottom and back to 105, then seen up to standing. */
const hiddenRep = (bottom) => [...seen(ramp(172, 100)), ...unseen([...ramp(100, bottom), ...hold(bottom, 3), ...ramp(bottom, 105)]),
  ...seen([...ramp(105, 172), ...hold(172, 5)])];

test('estimate: calibrated on clean reps of the set, the hip and head give the knee angle', () => {
  const { est } = calibrated();
  const b = bodyAt(72), drop = (y, k) => (y - est.ref[k]) / est.ref.scale; // below the standing heights it learned
  const e = est.estimate({ hip: drop(b.hipY, 'hip'), head: drop(b.headY, 'head') });
  assert.ok(Math.abs(e.angle - 72) < 1, `estimated ${e.angle}`);
  assert.equal(e.band, C.EST_BAND_MIN_DEG, 'a perfect fit still keeps the minimum band');
  assert.equal(new DepthEstimator().estimate({ hip: 0.5, head: 0.5 }), null, 'nothing to say before any clean rep');
});

test('estimate: hidden bottom, clearly deep enough: dings while the knee is lost, and counts', () => {
  const { est, m } = calibrated();
  const events = feedBody(m, est, hiddenRep(60));
  assert.deepEqual(types(events), ['depth', 'rep']);
  assert.equal(events[0].estimated, true, 'the ding came from the estimate');
  assert.ok(events[0].angle <= 75 - C.EST_BAND_MIN_DEG);
  assert.equal(events[1].estimated, true);
  assert.equal(m.good, 4);
  assert.equal(m.lastEstimated, true);
});

test('estimate: hidden bottom, clearly short: shallow, with the estimate', () => {
  const { est, m } = calibrated();
  const events = feedBody(m, est, hiddenRep(90));
  assert.deepEqual(types(events), ['shallow']);
  assert.equal(events[0].estimated, true);
  assert.ok(Math.abs(events[0].minAngle - 90) < 2, `estimated ${events[0].minAngle}`);
  assert.equal(m.shallow, 1);
  assert.equal(m.estimated, 1);
});

test('estimate: hidden bottom, too close to call: NOT SURE, not counted until he says so', () => {
  const { est, m } = calibrated();
  const events = feedBody(m, est, hiddenRep(77));
  assert.deepEqual(types(events), ['unsure']);
  assert.ok(Math.abs(events[0].minAngle - 77) < 2);
  assert.ok(events[0].minAngle - events[0].band <= 75 && events[0].minAngle + events[0].band > 75);
  assert.deepEqual([m.good, m.shallow, m.unsure], [3, 0, 1]);
  const p = m.countUnsure();
  assert.equal(p.angle, events[0].minAngle);
  assert.deepEqual([m.good, m.unsure, m.pending.length], [4, 0, 0]);
  assert.equal(m.countUnsure(), null, 'nothing left to count');
});

test('estimate: lost at the bottom with a tracking restart, the verdict comes on re-arming', () => {
  const { est, m } = calibrated();
  m._keepArmed = true;
  feedBody(m, est, [...seen(ramp(172, 100)), ...unseen([...ramp(100, 90), ...hold(90, 3)])]);
  m.update(110, 0, m._t + DT, DT, true); // tracking comes back on the way up
  m._t += DT;
  const events = feedBody(m, est, seen([...ramp(110, 172), ...hold(172, STAND)]));
  assert.deepEqual(types(events), ['armed', 'shallow']);
  assert.equal(events[0].rep, events[1]);
  assert.equal(events[1].estimated, true);
});

test('estimate: one stray hip reading cannot make a rep deep, and a rep stops calibrating once its knee is lost', () => {
  const { est, m } = calibrated();
  feedBody(m, est, seen(ramp(172, 100)));
  const deepest = (bodyAt(100).hipY - est.ref.hip) / est.ref.scale;
  est.frame({ knee: 100, hipY: 700 + 240 * 0.9, headY: bodyAt(100).headY, scale: 240 }, m); // one wild hip point
  est.frame({ knee: 100, ...bodyAt(100) }, m);
  const pairs = est.pairs.hip.length;
  assert.ok(Math.abs(est.rep.hip - deepest) < 1e-9, 'the deepest point needs two frames of three');
  est.frame({ knee: null, ...bodyAt(98) }, m);
  est.frame({ knee: 96, ...bodyAt(96) }, m);
  assert.equal(est.pairs.hip.length, pairs, 'nothing from after the knee was lost');
});

// ---------- Regression: the loaded set filmed at the gym ----------
// tests/squat-gym-set.json: every frame of the set, read off a screen recording of the app (see "about" in the file).

const gym = JSON.parse(readFileSync(new URL('./squat-gym-set.json', import.meta.url), 'utf8'));

/** The whole set through the app's pipeline. old: as the app was (no knee guard, no estimate). */
function replaySet({ old = false } = {}) {
  const dt = 1000 / gym.fps, tracker = new AngleTracker(), guard = new KneeGuard();
  const est = old ? null : new DepthEstimator(), m = new RepMachine({}, est);
  const events = [];
  gym.frames.forEach(([angle, hipY, thigh, scale, headY], i) => {
    const t = i * dt;
    const trusted = angle !== null && (old || guard.check(angle, hipY, thigh, m));
    est?.frame({ knee: trusted ? angle : null, hipY: angle !== null ? hipY : null, headY, scale: scale ?? 0 }, m);
    let ev = null;
    if (trusted) { const s = tracker.update(angle, t); if (s) ev = m.update(s.angle, s.vel, t, s.dtMs, s.restarted); } else if (est) ev = m.hidden(t);
    const e = ev && (ev.rep || ev);
    if (e && e.type !== 'armed') events.push({ ...e, rep: gym.reps.findLastIndex((r) => r.from <= i) + 1 });
  });
  return { events, m, est, ofRep: (n) => events.filter((e) => e.rep === n).map((e) => e.type) };
}

test('regression (gym): as the app was, the third rep was called shallow on a reading from before its bottom', () => {
  const { events, ofRep } = replaySet({ old: true });
  assert.deepEqual(ofRep(3), ['shallow']);
  const e = events.find((x) => x.rep === 3);
  assert.ok(e.minAngle > 80 && e.minAngle < 85, `shallow at ${e.minAngle}`);
});

test('regression (gym): now the third rep gets an estimate from the hip and head, too close to call: his decision', () => {
  const { events, ofRep, est, m } = replaySet();
  assert.deepEqual(ofRep(3), ['unsure']);
  const e = events.find((x) => x.rep === 3);
  assert.ok(e.minAngle > 74 && e.minAngle < 86, `estimated ${e.minAngle}`);
  assert.ok(e.minAngle - e.band <= 75 && e.minAngle + e.band > 75, `75 within ${e.minAngle} ± ${e.band}`);
  // The verdict at the end of the set, with every rep's calibration, still can't call it.
  const end = est.estimate(e.drops);
  assert.equal(DepthEstimator.verdict(end, 75), 'unsure');
  assert.ok(Math.abs(end.angle - e.minAngle) < 6, `end of set ${end.angle}`);
  assert.equal(m.unseen, 0, 'never the bare "not seen"');
});

test('regression (gym): the clean reps of the set still ding and count as before', () => {
  const now = replaySet(), before = replaySet({ old: true });
  for (const n of [1, 5, 8]) {
    assert.deepEqual(now.ofRep(n), ['depth', 'rep'], `rep ${n}`);
    assert.deepEqual(before.ofRep(n), ['depth', 'rep'], `rep ${n}, as before`);
    const a = now.events.filter((e) => e.rep === n), b = before.events.filter((e) => e.rep === n);
    assert.ok(Math.abs(a[0].angle - b[0].angle) < 1 && Math.abs(a[1].minAngle - b[1].minAngle) < 1, `rep ${n} reads the same`);
    assert.ok(!a.some((e) => e.estimated), `rep ${n} needs no estimate`);
  }
});
