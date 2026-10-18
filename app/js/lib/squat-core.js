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

  // ===== Was the bottom actually seen? =====
  // A rep that misses the target is only called shallow if its bottom was watched. If tracking drops out at the
  // bottom, before he is seen coming back up, and he comes back higher, the app says it didn't see the bottom.
  const BOTTOM_GAP_MS = 100;        // no trusted reading for this long counts as a blind spot
  const TURN_SEEN_DEG = 10;         // seen this far back above the deepest reading: the turnaround was watched
  const UNSEEN_MARGIN_DEG = 3;      // back from a blind spot more than this above the deepest reading: the bottom was missed
  const KNEE_OPEN_DEG = 8;          // a reading this far above the rep's deepest one...
  const KNEE_HIP_PER_RAD = 0.25;    // ...needs the hip at least this x thigh length x (that opening, in radians) above its lowest point

  // ===== Depth estimate when the knee is lost =====
  // The hip and head go down with the knee. How far each has dropped below standing is calibrated against the knee
  // angle on the set's own clean frames, so a rep whose bottom the knee point missed still gets a number.
  const EST_MAX_KNEE_DEG = 110;     // calibration pairs come from trusted knee readings below this (the deep half)
  const EST_MIN_PAIRS = 12;         // a signal needs at least this many pairs...
  const EST_MIN_SPAN = 0.04;        // ...spread over at least this much drop (in leg lengths) to be fitted
  const EST_BAND_SD = 1.5;          // NOT SURE band, either side of the estimate: this many standard deviations of the fit...
  const EST_BAND_MIN_DEG = 4;       // ...and never narrower than this
  const EST_EXTRAP_SHARE = 0.5;     // past the deepest calibrated drop, half the extrapolated change is added to the band
  const EST_MAX_PAIRS = 900;        // pairs kept per signal (a set is far fewer)
  const STAND_TOP_SLACK_DEG = 1;    // standing heights come from the most upright frame between reps (the latest within this)

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
   * Catches the knee point sliding off the knee at the bottom of a squat. Seen at the gym: with a Smith machine
   * upright in front of the hip, the pose model lost the knee for the deepest half second of a rep and put it on
   * the shin, so the angle read 105-126 while he was still sinking, and the rep was called shallow on the reading
   * from before the bottom. A knee can only open if the hip rises with it, so a reading well above the rep's
   * deepest one is not believed while the hip is no higher than its lowest point. Call it before the tracker.
   */
  class KneeGuard {
    constructor() { this.reset(); }
    reset() { this.inRep = false; this.hipLow = -Infinity; this.thigh = 0; }
    /**
     * @param raw     this frame's knee angle (deg)
     * @param hipY    hip height in image px (y grows downward)
     * @param thigh   hip-to-knee length in image px
     * @param machine the RepMachine the reading would go to (its state, and the rep's deepest reading so far)
     * @returns {boolean} false when the knee opened without the hip rising: don't use this frame
     */
    check(raw, hipY, thigh, machine) {
      if (machine.idle) { this.reset(); return true; }
      if (!this.inRep) { this.inRep = true; this.thigh = thigh; } // the rep has just started: the thigh is at full length
      this.hipLow = Math.max(this.hipLow, hipY);
      const opened = raw - machine.minAngle;
      if (!(opened >= KNEE_OPEN_DEG)) return true;
      return this.hipLow - hipY >= KNEE_HIP_PER_RAD * this.thigh * opened * Math.PI / 180;
    }
  }

  const HEAD = [0, 7, 8]; // MediaPipe indices: nose, ears

  /**
   * What the depth estimate follows: hip and head heights in px (null when not seen) and thigh + shin in px.
   * The shoulders are left out on purpose: the bar sits on them and the model places them badly under it.
   */
  function bodyHeights(lm, side, width, height) {
    const seen = (p) => !!p && (p.visibility ?? 0) >= MIN_VISIBILITY && p.y >= 0 && p.y <= 1;
    const [h, k, a] = LEG[side];
    const head = HEAD.map((i) => lm[i]).filter(seen);
    const len = (p, q) => Math.hypot((p.x - q.x) * width, (p.y - q.y) * height);
    return {
      hipY: seen(lm[h]) ? lm[h].y * height : null,
      headY: head.length ? head.reduce((sum, p) => sum + p.y, 0) / head.length * height : null,
      scale: len(lm[h], lm[k]) + len(lm[k], lm[a]),
    };
  }

  /**
   * Estimates the knee angle at the bottom of a rep from how far the hip and head dropped, for when the knee itself
   * was lost there. Each drop (below its standing height, in standing leg lengths) is fitted against the trusted
   * knee readings of the same set, deep half only, and the two estimates are averaged, weighted by how well each fits.
   * Once a rep has lost its knee, the rest of that rep doesn't calibrate: readings just after the knee point comes
   * back can still be off. Feed it every frame with a pose, before that frame's machine update.
   */
  class DepthEstimator {
    constructor() { this.reset(); }
    /** A new set: forget the calibration. */
    reset() {
      this.pairs = { hip: [], head: [] }; this.ref = null; this.rep = null;
      this._top = null; this._recent = { hip: [], head: [] }; this._tainted = false;
    }
    /**
     * @param f {knee, hipY, headY, scale}: knee = this frame's knee angle when it is trusted, else null
     * @param machine the RepMachine the frame goes to
     */
    frame({ knee = null, hipY = null, headY = null, scale = 0 }, machine) {
      if (!machine.inRep) {
        this.rep = null; this._recent = { hip: [], head: [] }; this._tainted = false;
        // Between reps: remember the most upright frame. Right after a rep counts he is often still a little bent.
        if (knee !== null && knee >= machine.standDeg && scale > 0 && (!this._top || knee >= this._top.knee - STAND_TOP_SLACK_DEG)) {
          this._top = { knee, hip: hipY, head: headY, scale };
        }
        return;
      }
      if (!this.rep) {
        // A rep starts: measure it from where he stood just before.
        const top = this._top, old = this.ref;
        if (top) this.ref = { hip: top.hip ?? old?.hip ?? null, head: top.head ?? old?.head ?? null, scale: top.scale };
        this._top = null;
        if (!this.ref) return;
        this.rep = { hip: -Infinity, head: -Infinity };
      }
      if (knee === null) this._tainted = true;
      for (const [k, y] of [['hip', hipY], ['head', headY]]) {
        if (y === null || this.ref[k] === null) continue;
        const drop = (y - this.ref[k]) / this.ref.scale;
        const recent = this._recent[k];
        recent.push(drop);
        if (recent.length > 3) recent.shift();
        // The deepest point needs two frames of three: one stray landmark can't make a rep deep.
        if (recent.length === 3) this.rep[k] = Math.max(this.rep[k], [...recent].sort((a, b) => a - b)[1]);
        if (knee !== null && knee <= EST_MAX_KNEE_DEG && !this._tainted) {
          this.pairs[k].push([drop, knee]);
          if (this.pairs[k].length > EST_MAX_PAIRS) this.pairs[k].shift();
        }
      }
    }
    /** The bottom of the current rep, or of an earlier one given its drops: {angle, band}, or null if it can't say. */
    estimate(drops = this.rep) {
      if (!drops) return null;
      let wSum = 0, angleSum = 0, bandSum = 0;
      for (const k of ['hip', 'head']) {
        const q = drops[k], fit = Number.isFinite(q) ? this._fit(k) : null;
        if (!fit) continue;
        const band = Math.max(EST_BAND_MIN_DEG, EST_BAND_SD * fit.sd) + EST_EXTRAP_SHARE * -fit.b * Math.max(0, q - fit.maxDrop);
        const w = 1 / (fit.sd * fit.sd + 1); // +1: a suspiciously perfect fit doesn't take all the weight
        wSum += w; angleSum += w * (fit.a + fit.b * q); bandSum += w * band;
      }
      return wSum ? { angle: angleSum / wSum, band: bandSum / wSum } : null;
    }
    /** Least squares knee = a + b * drop over the pairs so far, or null when there aren't enough of them. */
    _fit(k) {
      const p = this.pairs[k], n = p.length;
      if (n < EST_MIN_PAIRS) return null;
      let sx = 0, sy = 0, sxx = 0, sxy = 0, lo = Infinity, hi = -Infinity;
      for (const [x, y] of p) { sx += x; sy += y; sxx += x * x; sxy += x * y; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      const vx = sxx - sx * sx / n;
      if (hi - lo < EST_MIN_SPAN || !(vx > 0)) return null;
      const b = (sxy - sx * sy / n) / vx, a = (sy - b * sx) / n;
      if (b >= 0) return null; // deeper has to mean a smaller angle; anything else is noise
      let ss = 0;
      for (const [x, y] of p) ss += (y - a - b * x) ** 2;
      return { a, b, sd: Math.sqrt(ss / (n - 2)), maxDrop: hi };
    }
    /** 'good' (clearly at or past the target), 'shallow' (clearly above it) or 'unsure'. */
    static verdict(est, targetDeg) {
      return est.angle + est.band <= targetDeg ? 'good' : est.angle - est.band > targetDeg ? 'shallow' : 'unsure';
    }
  }

  /**
   * The rep state machine. Feed it one filtered angle per frame.
   * update() returns at most one event:
   *   { type: 'depth', anticipated, late, angle, estimated } -> play the ding NOW (estimated: from the hip and head,
   *                                             the knee was lost at the bottom)
   *   { type: 'rep', minAngle, estimated, judged } -> good rep finished (back to standing). judged: counted from the
   *                                             estimate only now, with no ding during the rep: ding as it counts
   *   { type: 'shallow', minAngle, estimated } -> dipped past the shallow line, never hit target (estimated: the bottom
   *                                             was hidden and the estimate is clearly above the target)
   *   { type: 'unsure', minAngle, band }     -> the bottom was hidden and the estimate is within `band` of the target:
   *                                             not counted unless he says so (countUnsure)
   *   { type: 'unseen', minAngle }           -> the bottom was hidden and there is nothing to estimate from: not counted
   *   { type: 'armed', rep }                 -> seen standing after not being armed: ready for a rep. rep: the verdict
   *                                             (one of the events above) on a rep whose tracking was lost at its bottom
   * Estimated events also carry band (the estimate's uncertainty, either side), drops (to estimate it again later) and
   * seenAngle (the deepest trusted reading: he was at least that deep).
   *
   * Double dings are impossible by construction: after 'depth' the machine sits in DEPTH and
   * only re-arms once the angle is back above standDeg. The gap between descendDeg and
   * standDeg is the hysteresis that stops jitter at the top from starting phantom reps.
   *
   * A ding also requires an unbroken view of the descent: seen standing, then seen going down,
   * frame after frame. If tracking is interrupted before the ding (`restarted`), the machine
   * disarms and waits to see a standing leg again rather than trust a reading from nowhere.
   *
   * A shallow call needs a watched bottom too. A blind spot of BOTTOM_GAP_MS or more (or an interruption) after
   * the deepest reading and before he is seen coming back up means the bottom wasn't seen. Then the estimator
   * (hip and head) judges it: clearly deep enough counts, clearly short is shallow, too close to call is 'unsure'.
   */
  class RepMachine {
    /** @param estimator optional DepthEstimator, fed by the caller, for reps whose bottom the knee point missed */
    constructor(cfg = {}, estimator = null) {
      this.estimator = estimator;
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
      this._lastT = null;           // time of the previous reading, to spot blind spots
      this._turnSeen = false;       // seen coming back up from the deepest reading of this rep
      this._bottomUnseen = false;   // ...or a blind spot hid the bottom
      this._lostMin = null;         // tracking was lost at the bottom of a rep: its deepest reading, reported on re-arming
      this._est = null;             // the ding came from the estimate: {band, drops}
    }
    resetCounts() {
      this.resetState();
      this.good = 0; this.shallow = 0; this.lastMin = null;
      this.unseen = 0;              // reps whose bottom the camera didn't see and couldn't estimate: neither good nor shallow
      this.unsure = 0;              // reps whose estimate was too close to call, waiting for him (pending)
      this.pending = [];            // ...their {angle, band, drops}, oldest first
      this.estimated = 0;           // good or shallow reps judged from the estimate
      this.lastEstimated = false;   // lastMin is an estimate
      this.dings = 0;               // total dings
      this.late = 0;                // dings given late, after a hold at depth, because the descent wasn't seen
      this.early = 0;               // dings fired by anticipation, before angle <= target
      this.earlyMissed = 0;         // ...where the knee then never actually reached target
      this.earlyLeadSumMs = 0;      // for confirmed early dings: how far ahead of the real crossing
      this.earlyConfirmed = 0;
    }
    /** True when no rep is in progress (safe moment to switch legs, etc). */
    get idle() { return this.state === State.UNKNOWN || this.state === State.STANDING; }
    /** A rep is under way, or was lost at its bottom and waits for its verdict. */
    get inRep() { return !this.idle || this._lostMin !== null; }

    update(angle, velDegPerSec = 0, tMs = 0, frameDtMs = 0, restarted = false) {
      // Tracking was interrupted. Once the ding has sounded that doesn't matter (we only wait for
      // the stand-up), but before it, what we see now may not continue what we saw before.
      if (restarted && this.state !== State.DEPTH) {
        // Lost at the bottom of a rep (past the shallow line, not yet seen coming back up): say so once he's back.
        const lostMin = this.state === State.DESCENDING && !this._turnSeen && this.minAngle < this.shallowDeg
          ? this.minAngle : this._lostMin;
        this.resetState();
        this._lostMin = lostMin;
      }
      const blind = this._lastT !== null && tMs - this._lastT >= BOTTOM_GAP_MS; // no reading since the last one
      this._lastT = tMs;
      if (this.state === State.UNKNOWN) {
        if (angle >= this.standDeg) {
          this._holdSince = null;
          if (this._armSince === null) this._armSince = tMs;
          if (tMs - this._armSince < ARM_HOLD_MS) return null;
          this.state = State.STANDING;
          const lostMin = this._lostMin;
          this._lostMin = null;
          return lostMin === null ? { type: 'armed' } : { type: 'armed', rep: this._hiddenVerdict(lostMin) };
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
        if (angle < this.descendDeg) {
          this.state = State.DESCENDING; this.minAngle = angle; this._turnSeen = false; this._bottomUnseen = false;
        }
        return null; // never ding on the frame a descent starts: depth has to be approached, not appear
      }

      if (this.state === State.DESCENDING) {
        // Back from a blind spot higher than he went in, before he was seen coming up: the bottom was out of sight.
        if (blind && !this._turnSeen && angle > this.minAngle + UNSEEN_MARGIN_DEG) this._bottomUnseen = true;
        if (angle < this.minAngle) { this.minAngle = angle; this._turnSeen = false; this._bottomUnseen = false; }
        else if (angle >= this.minAngle + TURN_SEEN_DEG) this._turnSeen = true;
        if (angle >= this.standDeg) {
          const min = this.minAngle;
          this.state = State.STANDING; this.minAngle = Infinity;
          if (min >= this.shallowDeg) return null;   // just a wiggle at the top
          if (this._bottomUnseen) return this._hiddenVerdict(min);
          this.shallow++; this.lastMin = min; this.lastEstimated = false;
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
      if (angle < this.minAngle) this.minAngle = angle;
      if (this._anticipated && !this._confirmed && angle <= this.targetDeg) {
        this._confirmed = true;
        this.earlyConfirmed++;
        this.earlyLeadSumMs += tMs - this._depthT;
      }
      if (angle >= this.standDeg) {
        const ev = { type: 'rep', minAngle: this.minAngle, anticipated: this._anticipated, confirmed: !this._anticipated || this._confirmed };
        if (this._anticipated && !this._confirmed) this.earlyMissed++;
        if (this._est) { Object.assign(ev, { estimated: true }, this._est); this.estimated++; }
        this.good++; this.lastMin = this.minAngle; this.lastEstimated = !!this._est;
        this.state = State.STANDING; this.minAngle = Infinity;
        return ev;
      }
      return null;
    }
    _depth(anticipated, angle, tMs, late = false, est = null) {
      this.state = State.DEPTH;
      this._lostMin = null; // a late ding after losing him judges that rep after all
      this.dings++;
      if (anticipated) this.early++;
      if (late) this.late++;
      this._anticipated = anticipated; this._confirmed = false; this._depthT = tMs; this._est = est;
      return { type: 'depth', anticipated, late, angle, estimated: !!est };
    }
    /**
     * A frame where the knee isn't believed but the rest of him is in view. If the hip and head already put him
     * clearly at or past the target, ding now, from the estimate, instead of waiting for a knee that may not come back.
     */
    hidden(tMs) {
      const lost = this.state === State.UNKNOWN && this._lostMin !== null;
      if (!this.estimator || (this.state !== State.DESCENDING && !lost)) return null;
      const est = this.estimator.estimate();
      if (!est || DepthEstimator.verdict(est, this.targetDeg) !== 'good') return null;
      this.minAngle = Math.min(lost ? this._lostMin : this.minAngle, est.angle);
      return this._depth(false, est.angle, tMs, false, { band: est.band, drops: { ...this.estimator.rep } });
    }
    /** The verdict on a rep whose bottom the knee point missed, from the hip-and-head estimate if there is one. */
    _hiddenVerdict(minAngle) {
      const est = this.estimator ? this.estimator.estimate() : null;
      if (!est) { this.unseen++; this.lastMin = null; return { type: 'unseen', minAngle }; }
      // A trusted reading deeper than the estimate wins: he was at least that deep.
      const angle = Math.min(est.angle, minAngle), band = est.band, drops = { ...this.estimator.rep }, seenAngle = minAngle;
      const verdict = DepthEstimator.verdict({ angle, band }, this.targetDeg);
      this.lastMin = angle; this.lastEstimated = true;
      // Clearly deep enough but only known now (no ding during the rep): judged: the screen dings as it counts it.
      if (verdict === 'good') {
        this.good++; this.estimated++; this.dings++;
        return { type: 'rep', minAngle: angle, estimated: true, judged: true, band, drops, seenAngle };
      }
      if (verdict === 'shallow') { this.shallow++; this.estimated++; return { type: 'shallow', minAngle: angle, estimated: true, band, drops, seenAngle }; }
      this.unsure++;
      this.pending.push({ angle, band, drops });
      return { type: 'unsure', minAngle: angle, band, drops, seenAngle };
    }
    /** He says the NOT SURE rep was deep enough: count the latest one as good. Returns it, or null if none is waiting. */
    countUnsure() {
      const p = this.pending.pop();
      if (!p) return null;
      this.unsure--; this.good++;
      return p;
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
    State, LEG, kneeAngle, legProblem, bodyHeights, OneEuroFilter, AngleTracker, KneeGuard, DepthEstimator, RepMachine, SidePicker,
    TARGET_DEG_DEFAULT, TARGET_DEG_MIN, TARGET_DEG_MAX,
    STAND_DEG_DEFAULT, STAND_DEG_MIN, STAND_DEG_MAX,
    DESCEND_MARGIN_DEG, SHALLOW_DEG, MIN_VISIBILITY, MAX_DEG_PER_SEC,
    ANTICIPATE_MIN_VEL, ANTICIPATE_MAX_DEG, SIDE_SWITCH_MARGIN, SIDE_SWITCH_FRAMES, GAP_RESET_MS, ARM_HOLD_MS, DEPTH_HOLD_MS, FRAME_MARGIN,
    BOTTOM_GAP_MS, TURN_SEEN_DEG, UNSEEN_MARGIN_DEG, KNEE_OPEN_DEG, EST_MAX_KNEE_DEG, EST_BAND_MIN_DEG,
  };
})();

export default SquatCore;
