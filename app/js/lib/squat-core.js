// Squat Depth rep logic (step 5.1), copied unchanged from the Squat Depth app (index.html, <script id="core">).
// Pure logic, no DOM: tests/squat-core.test.mjs runs it in Node. Keep it free of browser APIs, and change the
// thresholds here only on purpose: they decide what counts as a rep.
const SquatCore = (() => {
  'use strict';

  // ===== Thresholds (degrees). The numbers that decide what counts as a rep. =====
  const TARGET_DEG_DEFAULT = 75;    // knee angle that earns the ding. Thighs parallel reads about 70-75,
                                    // not 90: the shins lean forward, which closes the knee angle further.
  const TARGET_DEG_MIN = 60;
  const TARGET_DEG_MAX = 130;
  const STAND_DEG_DEFAULT = 160;    // above this = standing; also the re-arm threshold
  const STAND_DEG_MIN = 150;
  const STAND_DEG_MAX = 175;
  const DESCEND_MARGIN_DEG = 10;    // DESCENDING starts at stand - 10 (150 by default)
  const SHALLOW_DEG = 130;          // went below this without hitting target = shallow rep
  const SHALLOW_MIN_GAP_DEG = 15;   // shallow zone is always at least this far above the target

  // ===== Anticipation =====
  const ANTICIPATE_MIN_VEL = 20;    // deg/s; must be falling at least this fast to fire early
  const ANTICIPATE_MAX_DEG = 15;    // never fire more than this many degrees above the target
  const ANTICIPATE_MAX_FRAME_MS = 50; // "one frame" is capped here so a stutter can't inflate the lead

  // ===== Angle filter (One Euro: heavy smoothing when still, almost none when moving) =====
  const FILTER_MIN_CUTOFF_HZ = 1.0;
  const FILTER_BETA = 0.3;          // cutoff grows by this many Hz per deg/s of movement
  const FILTER_D_CUTOFF_HZ = 1.0;
  const MAX_DEG_PER_SEC = 600;      // faster than any real knee: treat as a tracking glitch
  const MAX_TRUSTED_GAP_MS = 100;   // ...and a dropout never buys more than this much movement (60 deg)
  const MAX_OUTLIER_STREAK = 2;     // ...unless it persists, then believe it
  const GAP_RESET_MS = 400;         // no samples for this long: tracking was interrupted, start over
  const ARM_HOLD_MS = 250;          // must be seen standing this long before the first ding is armed
  const DEPTH_HOLD_MS = 300;        // not armed, but held steadily at depth this long: ding anyway (late beats never)
  const DEPTH_HOLD_RANGE_DEG = 12;  // "steadily": every reading in the hold within this band...
  const DEPTH_HOLD_MIN_FRAMES = 6;  // ...and at least this many of them

  // ===== Is this really a leg we can measure? =====
  const FRAME_MARGIN = 0.02;        // hip/knee/ankle closer than this to the frame edge count as cut off
  const LIMB_RATIO_MIN = 0.5;       // thigh : shin length seen from the side is close to 1;
  const LIMB_RATIO_MAX = 2.0;       // far outside that, the pose is a guess or not side-on

  // ===== Side selection =====
  // Standing side-on, the model rates both legs about equally visible. Only once the knees bend
  // does the far leg disappear behind the near one, so the choice has to be able to change mid-rep.
  const SIDE_SWITCH_MARGIN = 0.15;  // other leg's knee and ankle must be this much more visible...
  const SIDE_SWITCH_FRAMES = 3;     // ...for this many frames in a row (immediately if the current leg is unusable)
  const MIN_VISIBILITY = 0.4;       // hip/knee/ankle below this: don't trust the angle
  const LEG = { L: [23, 25, 27], R: [24, 26, 28] }; // MediaPipe indices: hip, knee, ankle
  const SHOULDER = { L: 11, R: 12 };

  const State = Object.freeze({
    UNKNOWN: 'UNKNOWN',       // not armed yet: must be seen standing first
    STANDING: 'STANDING',     // armed
    DESCENDING: 'DESCENDING', // below stand - margin, target not reached yet
    DEPTH: 'DEPTH',           // target reached, ding played, waiting for the stand-up
  });

  /**
   * Interior angle at the knee, in degrees, from normalized image landmarks.
   * Landmarks are 0..1 of width and height, so scale by the frame size first,
   * otherwise a 16:9 frame squashes every angle.
   */
  function kneeAngle(hip, knee, ankle, width, height) {
    const ax = (hip.x - knee.x) * width, ay = (hip.y - knee.y) * height;
    const bx = (ankle.x - knee.x) * width, by = (ankle.y - knee.y) * height;
    const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (mag === 0) return NaN;
    const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / mag));
    return Math.acos(cos) * 180 / Math.PI;
  }

  /**
   * Why the leg can't be measured in this frame, or null if it can.
   * When part of the body is outside the picture the model still returns landmarks, extrapolated
   * past the frame edge with made-up angles. Those must never reach the rep logic.
   *   'frame'  -> hip, knee or ankle is cut off (or the shoulder is outside the picture)
   *   'hidden' -> a joint is occluded
   *   'shape'  -> thigh and shin lengths don't look like a leg seen from the side
   */
  function legProblem(lm, side, width, height) {
    const [h, k, a] = LEG[side];
    const hip = lm[h], knee = lm[k], ankle = lm[a], shoulder = lm[SHOULDER[side]];
    const inside = (p, m) => p.x >= m && p.x <= 1 - m && p.y >= m && p.y <= 1 - m;
    if (!inside(hip, FRAME_MARGIN) || !inside(knee, FRAME_MARGIN) || !inside(ankle, FRAME_MARGIN)) return 'frame';
    if (!inside(shoulder, 0)) return 'frame';
    if (Math.min(hip.visibility ?? 0, knee.visibility ?? 0, ankle.visibility ?? 0) < MIN_VISIBILITY) return 'hidden';
    const thigh = Math.hypot((hip.x - knee.x) * width, (hip.y - knee.y) * height);
    const shin = Math.hypot((ankle.x - knee.x) * width, (ankle.y - knee.y) * height);
    if (shin === 0 || thigh / shin < LIMB_RATIO_MIN || thigh / shin > LIMB_RATIO_MAX) return 'shape';
    return null;
  }

  class OneEuroFilter {
    constructor(minCutoff = FILTER_MIN_CUTOFF_HZ, beta = FILTER_BETA, dCutoff = FILTER_D_CUTOFF_HZ) {
      this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
      this.reset();
    }
    reset() { this.x = null; this.raw = 0; this.dx = 0; }
    static alpha(cutoffHz, dtSec) { return 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtSec)); }
    filter(x, dtSec) {
      if (this.x === null) { this.x = x; this.raw = x; this.dx = 0; return x; }
      const rawDx = (x - this.raw) / dtSec;
      this.raw = x;
      this.dx += OneEuroFilter.alpha(this.dCutoff, dtSec) * (rawDx - this.dx);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      this.x += OneEuroFilter.alpha(cutoff, dtSec) * (x - this.x);
      return this.x;
    }
  }

  /**
   * Raw per-frame angle in, { angle, vel, dtMs, restarted } out. Rejects single-frame glitches,
   * applies the light filter, and estimates angular velocity from the last 2-3 frames.
   *
   * After any interruption (first frame, a gap, a jump that persists) it emits nothing until two
   * consecutive samples agree, and flags the first one it does emit as `restarted`. A lone reading
   * that appears out of nowhere is exactly what a mis-detected pose looks like.
   */
  class AngleTracker {
    constructor() {
      this.filter = new OneEuroFilter();
      this.sample = { angle: 0, vel: 0, dtMs: 0, restarted: false };
      this.reset();
    }
    reset() {
      this.filter.reset();
      this.lastT = null; this.lastRaw = 0; this.outliers = 0;
      this.locked = false;                                      // true once two samples in a row agree
      this.a1 = null; this.t1 = 0; this.a2 = null; this.t2 = 0; // previous two filtered samples
      this.dtMs = 0;
    }
    /** @returns {{angle:number, vel:number, dtMs:number, restarted:boolean}|null} null when nothing trustworthy yet */
    update(raw, tMs) {
      if (!Number.isFinite(raw)) return null;
      if (this.lastT !== null) {
        const gap = tMs - this.lastT;
        if (gap <= 0 || gap > GAP_RESET_MS) this.reset();
      }
      if (this.lastT === null) {            // first sample after a (re)start: a candidate, not yet believed
        this.lastT = tMs; this.lastRaw = raw;
        return null;
      }
      const dt = tMs - this.lastT;
      // After a dropout the allowance stops growing: a reading far from the last trusted one is
      // not "he moved a lot while hidden", it is a different (probably wrong) pose until proven otherwise.
      const tooFast = Math.abs(raw - this.lastRaw) > MAX_DEG_PER_SEC * Math.min(dt, MAX_TRUSTED_GAP_MS) / 1000;
      let restarted = false;
      if (!this.locked) {
        if (tooFast) { this.lastT = tMs; this.lastRaw = raw; return null; } // the pair disagrees: newest becomes the candidate
        this.locked = true; restarted = true;
        this.a1 = this.filter.filter(this.lastRaw, 0); this.t1 = this.lastT; // seed the filter with the first of the pair
      } else if (tooFast) {
        if (++this.outliers <= MAX_OUTLIER_STREAK) return null;
        // It persisted, so it's a real jump (e.g. the tracker re-locked). Start over from here.
        this.reset();
        this.lastT = tMs; this.lastRaw = raw;
        return null;
      }
      this.outliers = 0;
      const angle = this.filter.filter(raw, dt / 1000);
      // Velocity over the last one and two frame intervals; keep whichever is closer to zero,
      // so a single noisy frame can't fake a fast descent.
      const v1 = (angle - this.a1) / (tMs - this.t1) * 1000;
      const v2 = this.a2 === null ? v1 : (angle - this.a2) / (tMs - this.t2) * 1000;
      const vel = Math.sign(v1) !== Math.sign(v2) ? 0 : (Math.abs(v1) < Math.abs(v2) ? v1 : v2);
      this.a2 = this.a1; this.t2 = this.t1; this.a1 = angle; this.t1 = tMs;
      this.dtMs = this.dtMs ? this.dtMs + 0.2 * (dt - this.dtMs) : dt;
      this.lastT = tMs; this.lastRaw = raw;
      const s = this.sample;
      s.angle = angle; s.vel = vel; s.dtMs = this.dtMs; s.restarted = restarted;
      return s;
    }
  }

  /**
   * The rep state machine. Feed it one filtered angle per frame.
   * update() returns at most one event:
   *   { type: 'depth', anticipated, late, angle } -> play the ding NOW
   *   { type: 'rep', minAngle }              -> good rep finished (back to standing)
   *   { type: 'shallow', minAngle }          -> dipped past the shallow line, never hit target
   *   { type: 'armed' }                      -> seen standing after not being armed: ready for a rep
   *
   * Double dings are impossible by construction: after 'depth' the machine sits in DEPTH and
   * only re-arms once the angle is back above standDeg. The gap between descendDeg and
   * standDeg is the hysteresis that stops jitter at the top from starting phantom reps.
   *
   * A ding also requires an unbroken view of the descent: seen standing, then seen going down,
   * frame after frame. If tracking is interrupted before the ding (`restarted`), the machine
   * disarms and waits to see a standing leg again rather than trust a reading from nowhere.
   */
  class RepMachine {
    constructor(cfg = {}) {
      this.configure(cfg);
      this.resetCounts();
    }
    configure(cfg = {}) {
      const clamp = (v, lo, hi, d) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d;
      this.targetDeg = clamp(cfg.targetDeg, TARGET_DEG_MIN, TARGET_DEG_MAX, TARGET_DEG_DEFAULT);
      this.standDeg = clamp(cfg.standDeg, STAND_DEG_MIN, STAND_DEG_MAX, STAND_DEG_DEFAULT);
      this.descendDeg = this.standDeg - DESCEND_MARGIN_DEG;
      this.shallowDeg = Math.min(this.descendDeg, Math.max(SHALLOW_DEG, this.targetDeg + SHALLOW_MIN_GAP_DEG));
      this.anticipate = cfg.anticipate !== false;
      this.extraLeadMs = clamp(cfg.extraLeadMs, 0, 500, 0);
    }
    resetState() {
      this.state = State.UNKNOWN;
      this.minAngle = Infinity;
      this._armSince = null; this._holdSince = null; this._holdLo = 0; this._holdHi = 0; this._holdFrames = 0;
      this._anticipated = false; this._confirmed = false; this._depthT = 0;
    }
    resetCounts() {
      this.resetState();
      this.good = 0; this.shallow = 0; this.lastMin = null;
      this.dings = 0;               // total dings
      this.late = 0;                // dings given late, after a hold at depth, because the descent wasn't seen
      this.early = 0;               // dings fired by anticipation, before angle <= target
      this.earlyMissed = 0;         // ...where the knee then never actually reached target
      this.earlyLeadSumMs = 0;      // for confirmed early dings: how far ahead of the real crossing
      this.earlyConfirmed = 0;
    }
    /** True when no rep is in progress (safe moment to switch legs, etc). */
    get idle() { return this.state === State.UNKNOWN || this.state === State.STANDING; }

    update(angle, velDegPerSec = 0, tMs = 0, frameDtMs = 0, restarted = false) {
      // Tracking was interrupted. Once the ding has sounded that doesn't matter (we only wait for
      // the stand-up), but before it, what we see now may not continue what we saw before.
      if (restarted && this.state !== State.DEPTH) this.resetState();
      if (this.state === State.UNKNOWN) {
        if (angle >= this.standDeg) {
          this._holdSince = null;
          if (this._armSince === null) this._armSince = tMs;
          if (tMs - this._armSince < ARM_HOLD_MS) return null;
          this.state = State.STANDING;
          return { type: 'armed' };
        }
        this._armSince = null;
        // The descent wasn't watched (tracking dropped out on the way down), but he is now sitting
        // steadily at depth. Under a loaded bar a late ding beats none, so give it once it has held.
        if (angle > this.targetDeg) { this._holdSince = null; return null; }
        if (this._holdSince !== null) {
          this._holdLo = Math.min(this._holdLo, angle); this._holdHi = Math.max(this._holdHi, angle);
          if (this._holdHi - this._holdLo > DEPTH_HOLD_RANGE_DEG) this._holdSince = null; // still moving: start again from here
        }
        if (this._holdSince === null) { this._holdSince = tMs; this._holdLo = this._holdHi = angle; this._holdFrames = 0; }
        this._holdFrames++;
        if (tMs - this._holdSince < DEPTH_HOLD_MS || this._holdFrames < DEPTH_HOLD_MIN_FRAMES) return null;
        this.minAngle = this._holdLo;
        return this._depth(false, angle, tMs, true);
      }
      if (this.state === State.STANDING) {
        if (angle < this.descendDeg) { this.state = State.DESCENDING; this.minAngle = angle; }
        return null; // never ding on the frame a descent starts: depth has to be approached, not appear
      }
      if (angle < this.minAngle) this.minAngle = angle;

      if (this.state === State.DESCENDING) {
        if (angle >= this.standDeg) {
          const min = this.minAngle;
          this.state = State.STANDING; this.minAngle = Infinity;
          if (min >= this.shallowDeg) return null;   // just a wiggle at the top
          this.shallow++; this.lastMin = min;
          return { type: 'shallow', minAngle: min };
        }
        if (angle <= this.targetDeg) return this._depth(false, angle, tMs);
        if (this.anticipate && velDegPerSec <= -ANTICIPATE_MIN_VEL) {
          const leadSec = (Math.min(frameDtMs, ANTICIPATE_MAX_FRAME_MS) + this.extraLeadMs) / 1000;
          const leadDeg = Math.min(-velDegPerSec * leadSec, ANTICIPATE_MAX_DEG);
          if (angle - leadDeg <= this.targetDeg) return this._depth(true, angle, tMs);
        }
        return null;
      }

      // State.DEPTH
      if (this._anticipated && !this._confirmed && angle <= this.targetDeg) {
        this._confirmed = true;
        this.earlyConfirmed++;
        this.earlyLeadSumMs += tMs - this._depthT;
      }
      if (angle >= this.standDeg) {
        const ev = { type: 'rep', minAngle: this.minAngle, anticipated: this._anticipated, confirmed: !this._anticipated || this._confirmed };
        if (this._anticipated && !this._confirmed) this.earlyMissed++;
        this.good++; this.lastMin = this.minAngle;
        this.state = State.STANDING; this.minAngle = Infinity;
        return ev;
      }
      return null;
    }
    _depth(anticipated, angle, tMs, late = false) {
      this.state = State.DEPTH;
      this.dings++;
      if (anticipated) this.early++;
      if (late) this.late++;
      this._anticipated = anticipated; this._confirmed = false; this._depthT = tMs;
      return { type: 'depth', anticipated, late, angle };
    }
  }

  /**
   * Picks the leg (L/R) to measure, frame by frame, with hysteresis so it doesn't flap.
   * The tracker is deliberately not reset on a switch: in a side view both knees read within a few
   * degrees of each other, and if they don't, the tracker's own jump guard treats it as an interruption.
   */
  class SidePicker {
    constructor() { this.reset(); }
    reset() { this.side = null; this.streak = 0; }
    /** How well the lower leg is seen. The hip scores ~1 on both sides whatever happens, so it is left out. */
    static score(lm, side) {
      const [, k, a] = LEG[side];
      return Math.min(lm[k].visibility ?? 0, lm[a].visibility ?? 0);
    }
    /** @param okL,okR whether each leg is measurable right now (legProblem() returned null) */
    update(lm, okL = true, okR = true) {
      const score = { L: SidePicker.score(lm, 'L'), R: SidePicker.score(lm, 'R') }, ok = { L: okL, R: okR };
      if (this.side === null) {
        this.side = okL !== okR ? (okL ? 'L' : 'R') : (score.L >= score.R ? 'L' : 'R');
        this.streak = 0;
        return this.side;
      }
      const cur = this.side, other = cur === 'L' ? 'R' : 'L';
      const better = ok[other] && (!ok[cur] || score[other] > score[cur] + SIDE_SWITCH_MARGIN);
      this.streak = better ? this.streak + 1 : 0;
      if (better && (!ok[cur] || this.streak >= SIDE_SWITCH_FRAMES)) { this.side = other; this.streak = 0; }
      return this.side;
    }
  }

  return {
    State, LEG, kneeAngle, legProblem, OneEuroFilter, AngleTracker, RepMachine, SidePicker,
    TARGET_DEG_DEFAULT, TARGET_DEG_MIN, TARGET_DEG_MAX,
    STAND_DEG_DEFAULT, STAND_DEG_MIN, STAND_DEG_MAX,
    DESCEND_MARGIN_DEG, SHALLOW_DEG, MIN_VISIBILITY, MAX_DEG_PER_SEC,
    ANTICIPATE_MIN_VEL, ANTICIPATE_MAX_DEG, SIDE_SWITCH_MARGIN, SIDE_SWITCH_FRAMES, GAP_RESET_MS, ARM_HOLD_MS, DEPTH_HOLD_MS, FRAME_MARGIN,
  };
})();

export default SquatCore;
