// SQUAT DEPTH (#/squat, #/squat/set/<sessionId>/<exKey>) (step 5): the Squat Depth app inside Training HQ. It watches
// a squat from the side through the camera and dings the moment the knee angle reaches the target (75°).
// The rep logic (lib/squat-core.js) and the pipeline below (camera, pose model, frame loop, audio) are Squat Depth's
// own, unchanged apart from the screen ids; only the look follows Training HQ. Added on top: each camera run is kept
// in 'squats' (5.4), its result can fill the squat set being logged (5.3), and the pose files stay on the device
// for use with no connection (5.2, lib/squat-offline.js).
import SquatCore from '../lib/squat-core.js';
import { MP_LOCAL as mpLocal, MODEL_LOCAL, offlineStatus, keepOffline, isDownloading, approxBytes, mb } from '../lib/squat-offline.js';
import { SETTINGS_KEY, startRun, addRepEvent, uncountRep, reviewEstimates, resetReps, summarizeRun, finishRun, fillChoices, fillSet, runText, repDeg, isSquatExercise } from '../lib/squat-log.js';
import { ready } from '../lib/data.js';
import { formatDay, formatTime } from '../lib/time.js';
import { kg as fmtKg } from '../lib/loads.js';
import { overlay, actionSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const C = SquatCore;
const $ = (id) => document.getElementById(`sq-${id}`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ===== Pipeline constants =====
const MP_VERSION = '1.1.0';
const MP_LOCAL = mpLocal();                 // vendored copy, same origin (preferred)
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_CDN = (m) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;

const CAMERA_FPS = 60;
const CAMERA_FPS_OK = 50;                   // below this, try other resolutions for a 60 fps mode
const CAMERA_WIDTH = 960, CAMERA_HEIGHT = 540;
const CAMERA_FALLBACKS = [[1280, 720], [640, 480]]; // never 1080p: more pixels, no accuracy gain

const STALE_FRAME_MS = 120;                 // a live frame older than this is skipped, not processed
const MAX_STALE_STREAK = 2;                 // ...but never skip more than this many in a row
const LOST_RESET_MS = 3000;                 // body gone this long: disarm until seen standing again
const DETECT_ERRORS_BEFORE_CPU = 5;         // consecutive GPU failures before rebuilding on CPU
const WARMUP_RUNS = 3;
const HUD_ANGLE_INTERVAL_MS = 100;
const DEBUG_INTERVAL_MS = 500;
const FLASH_MS = 280;
const SHALLOW_BANNER_MS = 1500;
const UNSEEN_BANNER_MS = 2500;
const AUDIO_LATENCY_WARN_MS = 60;           // reported output latency above this smells like Bluetooth
const BLUETOOTH_LABEL_RE = /bluetooth|airpods|buds|beats|headphone|headset|hands-?free/i;
const LOG_MAX = 300;

const DEFAULT_SETTINGS = {
  targetDeg: C.TARGET_DEG_DEFAULT,
  countDeg: C.COUNT_DEG_DEFAULT,
  standDeg: C.STAND_DEG_DEFAULT,
  sound: true,
  buzz: true,
  model: 'lite',
  anticipate: true,
  extraLeadMs: 0,
  perfMode: false,
  debug: true,
};

// ===== Settings =====
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { /* private mode, bad JSON */ }
  // Saved before there was a count line: a ding of 75 was the old default, so it moves to the new one.
  if (saved.countDeg === undefined && saved.targetDeg === 75) delete saved.targetDeg;
  const s = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(s)) if (typeof saved[k] === typeof s[k]) s[k] = saved[k];
  if (s.model !== 'full') s.model = 'lite';
  return s;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
const settings = loadSettings();

// ===== State =====
// The screen's elements exist while #/squat is open (mount() sets them); everything else lives as long as the app,
// so the pose model stays warm between visits.
let video = null, overlayCanvas = null, runEl = null, g = null;
const estimator = new C.DepthEstimator();
const machine = new C.RepMachine(settings, estimator);
const tracker = new C.AngleTracker();
const kneeGuard = new C.KneeGuard();
const sidePicker = new C.SidePicker();
const stats = { fps: 0, inferMs: 0, frameToDoneMs: 0, dropped: 0, stale: 0, frames: 0, clock: '-', warmupMs: 0 };
const latencyLog = [];
const run = {
  active: false, mode: null, stream: null, fileUrl: null, camera: '',
  lastCb: 0, lastPresented: 0, lastMediaTime: -1, staleStreak: 0, detectErrors: 0,
  lostSince: 0, lastHud: 0, lastDebug: 0, shownAngle: null, shownState: null, lockText: '',
};
let mpTs = 0; // MediaPipe wants strictly increasing timestamps
const nextMpTs = (t) => (mpTs = Math.max(Math.round(t), mpTs + 1));

// Training HQ: the run being recorded (lib/squat-log.js) and the set it is for.
let current = null;
let link = null;

// ===== Audio: built once on the Start tap, then kept hot =====
const audio = {
  ctx: null, dingBuf: null, buzzBuf: null, readyBuf: null, nextDing: null, idleTimer: 0,

  /** Must be called synchronously from a tap: iOS only unlocks audio inside a user gesture. */
  unlock() {
    clearTimeout(this.idleTimer);
    if (!this.ctx) {
      // Play through the speaker even with the ring/silent switch on silent (Safari 16.4+).
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      this.dingBuf = this._render(0.32, (t) => {
        // Hard attack (the onset is what you hear as "now"), bell-like decay.
        const env = Math.exp(-t / 0.07);
        return env * (0.6 * Math.sin(2 * Math.PI * 1175 * t) + 0.3 * Math.sin(2 * Math.PI * 2350 * t) + 0.1 * Math.sin(2 * Math.PI * 3525 * t));
      });
      this.buzzBuf = this._render(0.28, (t) => {
        // Low sawtooth: phone speakers can't do real bass, the harmonics carry it.
        const env = Math.min(1, t / 0.005) * Math.min(1, (0.28 - t) / 0.03);
        return env * 0.5 * (2 * ((t * 175) % 1) - 1);
      });
      // Two soft low pips: "I can see you standing, go ahead". Deliberately nothing like the ding.
      this.readyBuf = this._render(0.2, (t) => {
        const pip = (t0) => (t >= t0 && t < t0 + 0.05 ? Math.sin(Math.PI * (t - t0) / 0.05) * Math.sin(2 * Math.PI * 520 * t) : 0);
        return 0.35 * (pip(0) + pip(0.11));
      });
      // A looping near-silent buffer keeps the audio hardware awake, so the ding
      // never pays an output start-up delay.
      const idle = ctx.createBufferSource();
      idle.buffer = this._render(1, () => (Math.random() - 0.5) * 2e-4);
      idle.loop = true; idle.connect(ctx.destination); idle.start();
      ctx.onstatechange = () => { if (ctx.state !== 'running' && run.active && document.visibilityState === 'visible') ctx.resume().catch(() => {}); };
      this._arm();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  },
  _render(seconds, fn) {
    const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, Math.round(seconds * sr), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = fn(i / sr);
    return buf;
  },
  /** Pre-build the next ding so firing it is a single start() call. */
  _arm() {
    if (!this.ctx) return; // shut down in the meantime
    const s = this.ctx.createBufferSource();
    s.buffer = this.dingBuf; s.connect(this.ctx.destination);
    this.nextDing = s;
  },
  ding() {
    if (!this.ctx) return;
    if (!this.nextDing) this._arm();
    this.nextDing.start();
    this.nextDing = null;
    setTimeout(() => this._arm(), 0);
  },
  buzz() { this._play(this.buzzBuf); },
  ready() { this._play(this.readyBuf); },
  _play(buffer) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.connect(this.ctx.destination); s.start();
  },
  /**
   * Let go of the phone's audio completely. While the context is open iOS lists this page as
   * "playing" (Dynamic Island, lock screen, Control Center), so it must not outlive the session.
   */
  shutdown() {
    clearTimeout(this.idleTimer);
    const ctx = this.ctx;
    this.ctx = null; this.nextDing = null;
    if (ctx) { ctx.onstatechange = null; ctx.close().catch(() => {}); }
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch { /* not supported */ }
  },
  /** For the test buttons on the start screen: play, then release the audio channel again. */
  releaseSoonIfIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!run.active) this.shutdown(); }, 1500);
  },
  /** Output latency the browser reports, in ms (0 if it doesn't say). */
  latencyMs() {
    if (!this.ctx) return 0;
    return ((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000;
  },
};

/** Best effort: browsers don't expose the audio route, so look for hints. */
async function checkAudioRoute() {
  const reasons = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const bt = devices.find((d) => d.kind === 'audiooutput' && BLUETOOTH_LABEL_RE.test(d.label));
    if (bt) reasons.push(bt.label);
  } catch { /* enumerateDevices unavailable */ }
  const lat = audio.latencyMs();
  if (lat > AUDIO_LATENCY_WARN_MS) reasons.push(`output latency ${Math.round(lat)} ms`);
  const el = $('audioWarn');
  if (!el) return;
  el.hidden = reasons.length === 0;
  if (reasons.length) el.textContent = 'BLUETOOTH? USE PHONE SPEAKER';
  if (reasons.length) console.warn('[squat] audio output looks slow:', reasons.join(', '));
}

// ===== Pose model =====
const pose = { vision: null, fileset: null, base: '', landmarker: null, delegate: '', model: '', ready: null, forceCpu: false, status: ['Loading pose model…', ''] };

function setModelStatus(text, cls = '') {
  pose.status = [text, cls];
  const el = $('modelStatus');
  if (!el) return;
  el.textContent = text; el.className = `hud sq-status ${cls === 'ok' ? 'c-green' : cls === 'err' ? 'c-red' : 'c-muted'}`;
}

async function loadVisionLib() {
  if (pose.vision) return;
  try {
    pose.vision = await import(`${MP_LOCAL}/vision_bundle.mjs`);
    pose.base = MP_LOCAL;
  } catch {
    pose.vision = await import(`${MP_CDN}/vision_bundle.mjs`);
    pose.base = MP_CDN;
  }
  pose.fileset = await pose.vision.FilesetResolver.forVisionTasks(`${pose.base}/wasm`);
}

async function fetchModel(model) {
  // One download, reused for the GPU attempt and the CPU fallback.
  for (const url of [MODEL_LOCAL(model), MODEL_CDN(model)]) {
    try {
      const res = await fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch { /* try the next source */ }
  }
  throw new Error(`Could not download the ${model} pose model`);
}

/** Run a few dummy frames so graph setup and shader compilation don't land on the first rep. */
function warmUp(landmarker) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const x = c.getContext('2d');
  x.fillStyle = '#444'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#bbb'; x.fillRect(140, 40, 40, 160);
  const t0 = performance.now();
  for (let i = 0; i < WARMUP_RUNS; i++) landmarker.detectForVideo(c, nextMpTs(performance.now()));
  return performance.now() - t0;
}

async function buildLandmarker(model) {
  setModelStatus(`Loading ${model} pose model…`);
  await loadVisionLib();
  const buffer = await fetchModel(model);
  const delegates = pose.forceCpu ? ['CPU'] : ['GPU', 'CPU'];
  let lastErr;
  for (const delegate of delegates) {
    let lm = null;
    try {
      lm = await pose.vision.PoseLandmarker.createFromOptions(pose.fileset, {
        baseOptions: { modelAssetBuffer: buffer, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      stats.warmupMs = warmUp(lm);
      const old = pose.landmarker;
      pose.landmarker = lm; pose.delegate = delegate; pose.model = model;
      try { old?.close(); } catch { /* already gone */ }
      setModelStatus(`Pose model ready: ${model}, ${delegate}${pose.base === MP_LOCAL ? '' : ', from CDN'} (warm-up ${Math.round(stats.warmupMs)} ms)`, 'ok');
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[squat] ${delegate} delegate failed`, e);
      try { lm?.close(); } catch { /* ignore */ }
    }
  }
  throw lastErr || new Error('Pose model failed to start');
}

function loadPose() {
  pose.ready = buildLandmarker(settings.model).catch((e) => {
    setModelStatus(`Pose model failed to load: ${e.message || e}. Check your connection and reload.`, 'err');
    throw e;
  });
  pose.ready.catch(() => {});
  pose.ready.then(() => drawOffline()).catch(() => drawOffline());
  return pose.ready;
}

// ===== Camera / video source =====
async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('The camera needs HTTPS. Open the app from its https:// address.');
  }
  // Video only: asking for the mic would switch iOS into a call-style audio mode.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: CAMERA_WIDTH }, height: { ideal: CAMERA_HEIGHT },
      frameRate: { ideal: CAMERA_FPS },
    },
  });
  const track = stream.getVideoTracks()[0];
  // iPhones only offer 60 fps at some sizes. If we didn't get it, look for a mode that has it.
  if ((track.getSettings().frameRate || 0) < CAMERA_FPS_OK) {
    for (const [width, height] of [[CAMERA_WIDTH, CAMERA_HEIGHT], ...CAMERA_FALLBACKS]) {
      try {
        await track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { min: CAMERA_FPS_OK, ideal: CAMERA_FPS } });
        if ((track.getSettings().frameRate || 0) >= CAMERA_FPS_OK) break;
      } catch { /* this size has no 60 fps mode */ }
    }
  }
  const st = track.getSettings();
  run.camera = `${st.width}×${st.height}@${Math.round(st.frameRate || 0)}`;
  run.stream = stream;
  video.srcObject = stream;
  await video.play();
}

async function startFile(url) {
  run.camera = 'file';
  video.srcObject = null;
  video.loop = false;
  video.src = url;
  await video.play();
}

function stopSource() {
  run.stream?.getTracks().forEach((t) => t.stop());
  run.stream = null;
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  }
  if (run.fileUrl) { URL.revokeObjectURL(run.fileUrl); run.fileUrl = null; }
}

// ===== Wake lock =====
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* low power mode, or not supported */ }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }

// ===== Frame loop =====
const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function requestFrame() {
  if (hasRVFC) video.requestVideoFrameCallback(onVideoFrame);
  else requestAnimationFrame(onAnimFrame);
}
// The next callback is requested before the work, and detection is synchronous, so frames
// that arrive while we're busy are simply never delivered: nothing queues, nothing is stale.
function onVideoFrame(now, meta) {
  if (!run.active) return;
  requestFrame();
  processFrame(meta);
}
function onAnimFrame() {
  if (!run.active) return;
  requestFrame();
  if (video.currentTime === run.lastMediaTime) return; // no new frame since last time
  run.lastMediaTime = video.currentTime;
  processFrame(null);
}

function processFrame(meta) {
  const lm = pose.landmarker;
  if (!lm || video.readyState < 2 || !video.videoWidth) return;
  const tCb = performance.now();
  const live = run.mode === 'camera';

  // When did this frame happen? Best available clock: sensor capture > compositor present > now.
  let tFrame = tCb, clock = 'callback';
  if (meta) {
    const cap = meta.captureTime, pres = meta.presentationTime;
    if (live && cap > 0 && tCb - cap >= 0 && tCb - cap < 1000) { tFrame = cap; clock = 'capture'; }
    else if (pres > 0 && tCb - pres >= 0 && tCb - pres < 1000) { tFrame = pres; clock = 'present'; }
    if (run.lastPresented && meta.presentedFrames > run.lastPresented) stats.dropped += meta.presentedFrames - run.lastPresented - 1;
    run.lastPresented = meta.presentedFrames;
    if (live && tCb - meta.presentationTime > STALE_FRAME_MS && run.staleStreak < MAX_STALE_STREAK) {
      run.staleStreak++; stats.stale++;
      return;
    }
  }
  run.staleStreak = 0;
  stats.clock = clock;
  // Time base for velocity: real time for the camera, media time for a file (survives seeks and stutter).
  const tSample = live ? tFrame : (meta ? meta.mediaTime : video.currentTime) * 1000;

  let result;
  try {
    result = lm.detectForVideo(video, nextMpTs(tCb));
    run.detectErrors = 0;
  } catch (e) {
    if (++run.detectErrors >= DETECT_ERRORS_BEFORE_CPU && pose.delegate === 'GPU') {
      console.warn('[squat] GPU inference keeps failing, switching to CPU', e);
      run.detectErrors = 0; pose.forceCpu = true; pose.landmarker = null;
      loadPose();
    }
    return;
  }
  const tDet = performance.now();

  const points = result.landmarks && result.landmarks[0];
  let sample = null, side = null, knee = null, lockText = "CAN'T SEE YOU HEAD TO FEET", lockCls = 'bad';
  if (points) {
    const w = video.videoWidth, h = video.videoHeight;
    const problemL = C.legProblem(points, 'L', w, h), problemR = C.legProblem(points, 'R', w, h);
    side = sidePicker.update(points, !problemL, !problemR);
    const problem = side === 'L' ? problemL : problemR;
    if (!problem) {
      const [hi, ki, ai] = C.LEG[side];
      const hip = points[hi], kneePoint = points[ki];
      const raw = C.kneeAngle(hip, kneePoint, points[ai], w, h);
      const thigh = Math.hypot((hip.x - kneePoint.x) * w, (hip.y - kneePoint.y) * h);
      if (kneeGuard.check(raw, hip.y * h, thigh, machine)) {
        knee = raw; // this frame's knee angle can be believed
        lockText = `LOCK · ${side === 'L' ? 'LEFT' : 'RIGHT'} LEG`; lockCls = 'good';
      } else {
        lockText = LEG_PROBLEM_LABEL.knee; lockCls = 'warn'; // the knee opened without the hip rising: not believed
      }
    } else {
      lockText = LEG_PROBLEM_LABEL[problem]; lockCls = 'warn';
    }
    if (knee !== null) sample = tracker.update(knee, tSample);
  }

  // The ding comes first: nothing of the depth estimate runs before a measured knee's ding has been played.
  if (sample) {
    run.lostSince = 0;
    const ev = machine.update(sample.angle, sample.vel, tSample, sample.dtMs, sample.restarted);
    if (ev) onRepEvent(ev, sample, tFrame, tCb, tDet, clock);
  }
  if (points) {
    // Then the estimate follows the hip and head. On a frame whose knee isn't believed, it can ding by itself.
    estimator.frame({ knee, ...C.bodyHeights(points, side, video.videoWidth, video.videoHeight) }, machine);
    if (knee === null) {
      const ev = machine.hidden(tSample);
      if (ev) onRepEvent(ev, null, tFrame, tCb, tDet, clock);
    }
  }
  if (!sample) {
    if (!run.lostSince) run.lostSince = tDet;
    else if (tDet - run.lostSince > LOST_RESET_MS && machine.state !== C.State.UNKNOWN) { machine.resetState(); tracker.reset(); }
  }

  // ----- Everything below is display only; the ding has already been fired. -----
  const tDone = performance.now();
  stats.frames++;
  if (run.lastCb) stats.fps += 0.1 * (1000 / (tCb - run.lastCb) - stats.fps);
  run.lastCb = tCb;
  stats.inferMs += 0.1 * (tDet - tCb - stats.inferMs);
  stats.frameToDoneMs += 0.1 * (tDone - tFrame - stats.frameToDoneMs);

  if (lockText !== run.lockText) {
    run.lockText = lockText;
    const el = $('lock'); el.textContent = lockText; el.className = 'sq-pill ' + lockCls;
  }
  if (!settings.perfMode) {
    drawOverlay(points, side);
    if (tDone - run.lastHud >= HUD_ANGLE_INTERVAL_MS) {
      run.lastHud = tDone;
      const shown = sample ? Math.round(sample.angle) : null;
      if (shown !== run.shownAngle) { run.shownAngle = shown; $('hudAngle').textContent = shown === null ? '–' : shown + '°'; }
      if (machine.state !== run.shownState) {
        run.shownState = machine.state;
        const el = $('hudState');
        el.textContent = STATE_LABEL[machine.state];
        el.className = 'sq-state' + (machine.state === C.State.DEPTH ? ' depth' : '');
      }
    }
  }
  if (settings.debug && tDone - run.lastDebug >= DEBUG_INTERVAL_MS) {
    run.lastDebug = tDone;
    renderDebug();
  }
}

const LEG_PROBLEM_LABEL = {
  frame: 'PART OF YOU IS OUT OF FRAME',
  hidden: 'LEG HIDDEN',
  shape: 'TURN SIDE-ON',
  knee: 'LOST YOUR KNEE',   // not from legProblem(): the knee opened at the bottom without the hip rising
};
const STATE_LABEL = {
  [C.State.UNKNOWN]: 'STAND TALL',
  [C.State.STANDING]: 'READY',
  [C.State.DESCENDING]: 'GOING DOWN',
  [C.State.DEPTH]: 'DEPTH ✓ STAND UP',
};

function onRepEvent(ev, sample, tFrame, tCb, tDet, clock) {
  if (ev.type === 'depth') {
    if (settings.sound) audio.ding();
    const tDing = performance.now();
    flash('hit');
    const entry = {
      ding: machine.dings, anticipated: ev.anticipated, late: ev.late, estimated: ev.estimated,
      angle: +(sample ? sample.angle : ev.angle).toFixed(1), velDegPerSec: sample ? +sample.vel.toFixed(0) : 0,
      frameClock: clock,                       // what tFrame means: capture | present | callback
      tFrame: +tFrame.toFixed(1), tCallback: +tCb.toFixed(1), tDetectDone: +tDet.toFixed(1), tDingScheduled: +tDing.toFixed(1),
      frameToDingMs: +(tDing - tFrame).toFixed(1), inferMs: +(tDet - tCb).toFixed(1),
      audioOutputMs: +audio.latencyMs().toFixed(1), audioCtxTime: audio.ctx ? +audio.ctx.currentTime.toFixed(4) : null,
      sound: settings.sound,
    };
    latencyLog.push(entry);
    if (latencyLog.length > LOG_MAX) latencyLog.shift();
    console.log('[squat] ding', JSON.stringify(entry));
  } else if (ev.type === 'armed') {
    if (settings.sound) audio.ready();
    if (ev.rep) { onRepEvent(ev.rep, sample, tFrame, tCb, tDet, clock); return; } // verdict on a rep lost at its bottom (logs it)
  } else if (ev.type === 'rep') {
    // Counted with no ding during the rep (an estimate, or a bottom between the ding and a deeper count line).
    // Shown, not dinged: the ding means "go up", and he is already up.
    if (ev.judged) {
      flash('hit');
      showBanner('COUNTED', SHALLOW_BANNER_MS, 'good', ev.estimated ? `ESTIMATED ~${Math.round(ev.minAngle)}°` : `${Math.round(ev.minAngle)}°`);
    }
    renderCounts();
    if (ev.anticipated && !ev.confirmed) console.log(`[squat] early ding was not confirmed: min ${ev.minAngle.toFixed(1)}° vs target ${machine.targetDeg}°`);
  } else if (ev.type === 'shallow') {
    if (settings.sound && settings.buzz) audio.buzz();
    flash('shallow');
    showBanner('TOO SHALLOW', SHALLOW_BANNER_MS, '', `${ev.estimated ? 'ESTIMATED ~' : ''}${Math.round(ev.minAngle)}° · COUNTS AT ${machine.countDeg}°`);
    renderCounts();
    console.log(`[squat] shallow rep: min ${ev.minAngle.toFixed(1)}°${ev.estimated ? ` (estimated ±${ev.band.toFixed(1)})` : ''}`);
  } else if (ev.type === 'unseen') {
    // Nothing to estimate from (no clean reps to calibrate on yet): not counted either way.
    flash('unseen');
    showBanner("DIDN'T SEE THE BOTTOM", UNSEEN_BANNER_MS, 'warn');
    renderCounts();
    console.log(`[squat] bottom not seen: deepest reading before it was lost ${ev.minAngle.toFixed(1)}°`);
  }
  addRepEvent(current, ev); // Training HQ: keep the rep for the log (after the ding, never before it)
}

/** DON'T COUNT: his call on the last rep, counted on the estimate's benefit of the doubt. Nothing waits on it. */
function uncountLatest() {
  const d = machine.uncount();
  if (!d) return;
  uncountRep(current);
  renderCounts();
  showBanner('NOT COUNTED', SHALLOW_BANNER_MS, 'info', `~${Math.round(d.angle)}°, YOUR CALL`);
}

// ===== Display =====
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
const COL = { leg: '#ffb84d', depth: '#46e08c', bone: 'rgba(232,243,249,0.6)', knee: '#e8f3f9' }; // Training HQ theme

function drawOverlay(points, side) {
  const w = video.videoWidth, h = video.videoHeight;
  if (overlayCanvas.width !== w || overlayCanvas.height !== h) { overlayCanvas.width = w; overlayCanvas.height = h; } // also handles rotation
  g.clearRect(0, 0, w, h);
  if (!points) return;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = Math.max(2, w / 320);
  g.strokeStyle = COL.bone;
  g.beginPath();
  for (const [a, b] of BONES) {
    const p = points[a], q = points[b];
    if ((p.visibility ?? 0) < 0.3 || (q.visibility ?? 0) < 0.3) continue;
    g.moveTo(p.x * w, p.y * h); g.lineTo(q.x * w, q.y * h);
  }
  g.stroke();
  if (!side) return;
  const [hi, ki, ai] = C.LEG[side];
  const hip = points[hi], knee = points[ki], ankle = points[ai];
  g.lineWidth = Math.max(5, w / 110);
  g.strokeStyle = machine.state === C.State.DEPTH ? COL.depth : COL.leg;
  g.beginPath();
  g.moveTo(hip.x * w, hip.y * h); g.lineTo(knee.x * w, knee.y * h); g.lineTo(ankle.x * w, ankle.y * h);
  g.stroke();
  g.fillStyle = COL.knee;
  g.beginPath(); g.arc(knee.x * w, knee.y * h, Math.max(5, w / 110), 0, Math.PI * 2); g.fill();
}

function renderCounts() {
  if (!$('hudReps')) return;
  $('hudReps').textContent = machine.good;
  const sh = $('hudShallow');
  sh.textContent = `shallow ${machine.shallow}`;
  sh.className = 'sq-sub' + (machine.shallow ? ' some' : '');
  const un = $('hudUnseen');
  un.hidden = !machine.unseen; un.textContent = `not seen ${machine.unseen}`;
  $('hudLast').textContent = machine.lastMin === null ? 'last –' : `last ${machine.lastEstimated ? '~' : ''}${Math.round(machine.lastMin)}°`;
  const d = machine.doubtful; // the last rep counted on the estimate's benefit of the doubt: he can take it back
  $('btnUncount').hidden = !d;
  if (d) $('btnUncount').textContent = `DON'T COUNT · ~${Math.round(d.angle)}°`;
}

function renderDebug() {
  const frameLabel = stats.clock === 'capture' ? 'cam→done' : stats.clock === 'present' ? 'frame→done' : 'cb→done';
  const early = machine.early
    ? ` · early ${machine.early}/${machine.dings}` +
      (machine.earlyConfirmed ? ` (~${Math.round(machine.earlyLeadSumMs / machine.earlyConfirmed)} ms)` : '') +
      (machine.earlyMissed ? ` ${machine.earlyMissed} missed` : '')
    : '';
  const late = machine.late ? ` · late ${machine.late}` : '';
  $('debug').textContent =
    `${stats.fps.toFixed(0)} fps · infer ${stats.inferMs.toFixed(0)} ms · ${frameLabel} ${stats.frameToDoneMs.toFixed(0)} ms` +
    ` · ${run.camera} · ${pose.delegate} ${pose.model}` +
    ` · audio +${audio.latencyMs().toFixed(0)} ms · drop ${stats.dropped}${stats.stale ? ' stale ' + stats.stale : ''}` +
    `${wakeLock ? ' · awake' : ''}${early}${late}`;
}

let flashTimer = 0, bannerTimer = 0;
function flash(cls) {
  runEl.classList.remove('hit', 'shallow', 'unseen');
  runEl.classList.add(cls);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => runEl?.classList.remove(cls), FLASH_MS);
}
function showBanner(text, ms = 0, kind = '', sub = '') { // kind: '' (red), 'warn' (amber), 'info' (dark, small)
  const el = $('banner');
  el.textContent = text; el.className = kind; el.hidden = false;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function hideBanner() { clearTimeout(bannerTimer); if ($('banner')) $('banner').hidden = true; }

function applyDisplaySettings() {
  runEl.classList.toggle('perf', settings.perfMode);
  $('debug').hidden = !settings.debug;
  if (settings.perfMode) { g.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); run.shownAngle = null; run.shownState = null; }
}

// ===== Start / stop =====
function resetSession() {
  machine.resetCounts(); tracker.reset(); kneeGuard.reset(); estimator.reset(); sidePicker.reset();
  Object.assign(stats, { fps: 0, inferMs: 0, frameToDoneMs: 0, dropped: 0, stale: 0, frames: 0 });
  Object.assign(run, { lastCb: 0, lastPresented: 0, lastMediaTime: -1, staleStreak: 0, detectErrors: 0, lostSince: 0, shownAngle: null, shownState: null });
  $('hudAngle').textContent = '–'; $('hudState').textContent = ' ';
  renderCounts();
}

async function start(mode, fileUrl = null) {
  audio.unlock(); // first thing, still inside the tap
  run.mode = mode; run.fileUrl = fileUrl && fileUrl.startsWith('blob:') ? fileUrl : null;
  $('start').hidden = true; runEl.hidden = false;
  document.documentElement.classList.add('sq-running');
  $('btnReplay').hidden = mode !== 'file';
  $('startNotice').hidden = true;
  resetSession(); applyDisplaySettings();
  current = startRun({ mode, targetDeg: settings.targetDeg, countDeg: settings.countDeg, standDeg: settings.standDeg, link });
  showBanner(mode === 'camera' ? 'Starting camera…' : 'Loading video…', 0, 'info');
  try {
    if (mode === 'camera') await startCamera(); else await startFile(fileUrl);
    if (!pose.landmarker) { showBanner('Loading pose model…', 0, 'info'); await (pose.ready || loadPose()); }
    hideBanner();
    run.active = true;
    requestFrame();
    acquireWakeLock();
    checkAudioRoute();
  } catch (e) {
    console.error('[squat] start failed', e);
    stop({ quiet: true });
    const el = $('startNotice');
    el.textContent = e.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow the camera for Training HQ (iPhone Settings > Training HQ > Camera, or in Safari: aA menu > Website Settings > Camera) and try again.'
      : `Could not start: ${e.message || e}`;
    el.hidden = false;
  }
}

/** quiet: leaving the screen or a failed start, so keep the run but ask nothing. */
function stop({ quiet = false } = {}) {
  run.active = false;
  audio.shutdown();
  stopSource();
  releaseWakeLock();
  hideBanner();
  if (runEl) runEl.hidden = true;
  if ($('start')) $('start').hidden = false;
  document.documentElement.classList.remove('sq-running');
  // Training HQ: keep what the run did, then offer to fill the set.
  const done = current;
  current = null;
  if (done && done.reps.length) afterRun(done, { quiet });
}

function replay() {
  resetSession();
  resetReps(current);
  hideBanner();
  video.currentTime = 0;
  video.play().catch(() => {});
}

// ===== Training HQ: the run's record, filling the set, the offline copy =====
let repo = null;
const viewAlive = () => !!$('start');

/** One rep in a rep list: green counted, red shallow; "~" marks an estimate. */
const repSpan = (x) => `<span class="${x.good ? 'c-green' : 'c-red'}">${repDeg(x)}</span>`;

async function afterRun(r, { quiet }) {
  // The verdict at the end of the set: estimates judged without a ding are judged again with every rep's calibration.
  reviewEstimates(r, (drops) => estimator.estimate(drops));
  const summary = summarizeRun(r);
  repo ||= await ready;
  // Camera runs are squat-depth sessions (calendar, coach); a replayed video is a test, not a session.
  const doc = r.mode === 'camera' ? finishRun(r) : null;
  if (doc) await repo.put('squats', doc.id, doc);
  if (quiet || !viewAlive()) return;
  // Which session to fill: the linked one, else a workout in progress with a squat in it.
  const sessions = await repo.list('sessions');
  const session = (r.sessionId && sessions.find((s) => s.id === r.sessionId && s.status === 'active'))
    || sessions.find((s) => s.status === 'active' && s.kind !== 'holds' && (s.exercises || []).some(isSquatExercise));
  const sets = session ? (await repo.list('sets')).filter((s) => s.sessionId === session.id) : [];
  resultSheet({ run: r, doc, summary, session, sets });
}

function resultSheet({ run: r, doc, summary, session, sets }) {
  const { choices, defaultId } = fillChoices(session, sets, { exKey: r.exKey });
  let pick = defaultId;
  const names = [...new Set(choices.map((c) => c.name))];
  const chip = (c) => `<button class="chip ${c.setId === pick ? 'is-on' : ''}" data-set="${esc(c.setId)}" type="button">${names.length > 1 ? `${esc(c.name.replace(/\s*\(.*\)$/, ''))} ` : ''}${c.label === 'W' ? 'Warm-up' : `Set ${esc(c.label)}`}${c.kg != null ? ` · ${fmtKg(c.kg)} kg` : ''}${c.done ? ' ✓' : ''}</button>`;
  const repsLine = r.reps.map(repSpan).join(' ');
  const doubtful = r.reps.map((x, i) => ({ x, i })).filter(({ x }) => x.doubtful && x.good);
  const countDeg = r.countDeg ?? summary.targetDeg;
  const { el, close } = overlay(`
    <div class="hud c-muted sheet-title">SQUAT DEPTH · ${doc ? 'SAVED' : 'VIDEO TEST, NOT SAVED'}</div>
    <div class="sq-result"><span><b class="c-green">${summary.good}</b><span class="hud">GOOD</span></span>${summary.shallow ? `<span><b class="c-red">${summary.shallow}</b><span class="hud">SHALLOW</span></span>` : ''}
      <span><b class="c-cyan">${summary.lowDeg != null ? `${Math.round(summary.lowDeg)}°` : '–'}</b><span class="hud">LOWEST</span></span></div>
    <p class="hint">Each rep's lowest knee angle (counts at ${esc(countDeg)}° or deeper): ${repsLine}${summary.estimated ? `<br>~ is estimated from your hip and head where the camera lost your knee. It counts unless its whole range is above ${esc(countDeg)}°.` : ''}</p>
    ${doubtful.length ? `<p class="hint">Counted on the benefit of the doubt (${esc(countDeg)}° was inside the estimate's range). Take one back if it wasn't deep enough:</p>
      <div class="chips wrap">${doubtful.map(({ x, i }) => `<button class="chip" data-uncount="${i}" type="button">Don't count rep ${i + 1} · ${repDeg(x)}</button>`).join('')}</div>` : ''}
    ${choices.length ? `<div class="hud c-muted">FILL INTO ${esc(session.title.toUpperCase())}</div>
      <div class="chips wrap" data-k="chips">${choices.map(chip).join('')}</div>
      <button class="btn-primary" data-fill="good" type="button">Fill ${summary.good} rep${summary.good === 1 ? '' : 's'}</button>
      ${summary.shallow ? `<button class="sheet-btn" data-fill="all" type="button">Fill ${summary.good + summary.shallow} reps (with ${summary.shallow} shallow)</button>` : ''}`
      : `<p class="hint">${session ? `No squat sets in ${esc(session.title)} to fill.` : 'No workout in progress, so nothing to fill. The run is kept under Recent runs and on the calendar.'}</p>`}
    <button class="sheet-btn sheet-cancel" data-cancel type="button">${choices.length ? "Don't fill" : 'Close'}</button>`);
  el.querySelector('[data-k="chips"]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    pick = b.dataset.set;
    el.querySelectorAll('[data-set]').forEach((x) => x.classList.toggle('is-on', x === b));
  });
  el.querySelectorAll('[data-uncount]').forEach((b) => b.addEventListener('click', async () => {
    // His call on a doubtful estimate: it doesn't count. Keep it in the saved run, then show the sheet again.
    uncountRep(r, +b.dataset.uncount);
    const again = doc ? finishRun(r, doc.endedAt) : null;
    if (again) await repo.put('squats', again.id, again);
    close();
    resultSheet({ run: r, doc: again, summary: summarizeRun(r), session, sets });
  }));
  el.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', async () => {
    const set = sets.find((s) => s.id === pick);
    if (!set) return;
    const filled = fillSet(set, summary, { runId: doc?.id ?? null, withShallow: b.dataset.fill === 'all' });
    await repo.put('sets', filled.id, filled);
    if (doc) await repo.put('squats', doc.id, { ...doc, sessionId: session.id, exKey: set.exKey, setId: set.id, exerciseName: choices.find((c) => c.setId === pick)?.name ?? null });
    const c = choices.find((x) => x.setId === pick);
    close();
    toast(`${c.label === 'W' ? 'Warm-up' : `Set ${c.label}`}: ${filled.reps} reps, lowest ${Math.round(summary.lowDeg)}°. Tick it when you're ready.`);
    location.hash = `#/session/${session.id}`;
  }));
  el.querySelector('[data-cancel]').addEventListener('click', () => close());
}

async function drawOffline() {
  const el = $('offline');
  if (!el) return;
  const st = await offlineStatus(settings.model).catch(() => ({ ready: false, unsupported: true }));
  if (!$('offline')) return;
  const size = mb(approxBytes(settings.model));
  el.innerHTML = st.unsupported
    ? '<span class="hud c-amber">OFFLINE COPY · NOT POSSIBLE IN THIS BROWSER</span>'
    : st.ready
      ? `<span class="hud c-green">ON THIS DEVICE · WORKS WITH NO CONNECTION</span><span class="hint">Pose ${esc(settings.model)} model and library, ${esc(mb(st.bytes || approxBytes(settings.model)))}.</span>`
      : isDownloading()
        ? '<span class="hud c-cyan" data-k="pct">SAVING FOR OFFLINE…</span>'
        : `<span class="hud c-amber">NOT SAVED FOR OFFLINE YET</span><span class="hint">Without it, Squat Depth needs a connection to load. About ${esc(size)}, once.</span>
           <button class="btn-ghost small" id="sq-keep" type="button">Save for offline (${esc(size)})</button>`;
  $('keep')?.addEventListener('click', () => saveOffline());
}

async function saveOffline() {
  const p = keepOffline(settings.model, ({ done, total }) => {
    const t = $('offline')?.querySelector('[data-k="pct"]');
    if (t) t.textContent = `SAVING FOR OFFLINE · ${Math.min(100, Math.round((done / total) * 100))}% OF ${mb(total)}`;
  });
  drawOffline();
  try { await p; toast('Squat Depth now works with no connection.'); } catch (e) { toast(`Couldn't save it: ${e.message || e}. Try again with a connection.`); }
  drawOffline();
}

async function drawRuns() {
  const box = $('runs');
  if (!box) return;
  repo ||= await ready;
  const runs = (await repo.list('squats')).filter((r) => r.reps?.length).sort((a, b) => b.startedAt - a.startedAt);
  const last = runs[0];
  const tl = $('lastLine');
  if (tl) tl.textContent = last ? `LAST ${last.good} REPS · LOW ${Math.round(last.lowDeg)}° · TARGET ${settings.targetDeg}°` : `TARGET ${settings.targetDeg}°`;
  if (!$('runs')) return;
  box.innerHTML = runs.slice(0, 8).map((r) => `<li class="sq-run-row">
      <div><b>${esc(formatDay(new Date(r.startedAt)))}, ${esc(formatTime(new Date(r.startedAt)))}</b>
        <div class="hint">${esc(runText(r))}${r.exerciseName ? ` · ${esc(r.exerciseName)}` : ''}</div>
        <div class="hud sq-reps">${r.reps.map(repSpan).join(' ')}</div></div>
      <button class="icon-mini" data-run="${esc(r.id)}" type="button" aria-label="Options for this run">···</button></li>`).join('')
    || '<li class="hint pad">No runs yet. Each camera run with at least one rep is kept here and on the calendar.</li>';
  box.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => {
    const r = runs.find((x) => x.id === b.dataset.run);
    actionSheet(`${formatDay(new Date(r.startedAt))}, ${formatTime(new Date(r.startedAt))}`, [
      { label: 'Delete this run', danger: true, run: async () => { if (await confirmSheet('Delete this Squat Depth run? A set it filled keeps its reps.', { ok: 'Delete', danger: true })) await repo.remove('squats', r.id); } },
    ]);
  }));
}

// ===== Settings sheet =====
function openSettings() {
  const { el, close } = overlay(`
    <div class="hud c-muted sheet-title">SQUAT DEPTH · SETTINGS</div>
    <label class="sq-row"><span class="sq-name">Ding at</span><span class="sq-val" id="sq-vTarget"></span>
      <input id="sq-sTarget" type="range" step="1">
      <span class="hint">Knee angle that earns the ding: counted, go up. Lower = deeper. Thighs parallel usually reads about 75&ndash;80&deg; here; 90&deg; is well above parallel.</span></label>
    <label class="sq-row"><span class="sq-name">Counts at</span><span class="sq-val" id="sq-vCount"></span>
      <input id="sq-sCount" type="range" step="1">
      <span class="hint">A rep counts when its bottom is at or below this, measured, or estimated from your hip and head when the camera loses your knee. Set it apart from the ding if you want; with the ding at or below it, every ding counts.</span></label>
    <label class="sq-row"><span class="sq-name">Standing / re-arm</span><span class="sq-val" id="sq-vStand"></span>
      <input id="sq-sStand" type="range" step="1">
      <span class="hint">You must come back above this to finish the rep and arm the next ding. Lower it if you don't lock out fully.</span></label>
    <label class="sq-row"><span class="sq-name">Sound</span><input id="sq-sSound" type="checkbox">
      <span class="hint">The ding at depth, and two soft blips when it first sees you standing and is ready for a rep.</span></label>
    <label class="sq-row"><span class="sq-name">Buzz on shallow reps</span><input id="sq-sBuzz" type="checkbox"></label>
    <label class="sq-row"><span class="sq-name">Anticipation</span><input id="sq-sAnticipate" type="checkbox">
      <span class="hint">Dings one frame early when you're clearly about to cross the target, to cancel some of the pipeline delay.</span></label>
    <label class="sq-row"><span class="sq-name">Extra anticipation lead</span><span class="sq-val" id="sq-vLead"></span>
      <input id="sq-sLead" type="range" min="0" max="150" step="10">
      <span class="hint">Predict further ahead to cancel camera and speaker delay too. More lead = more dings on reps that stop just short. 0 is safest.</span></label>
    <label class="sq-row"><span class="sq-name">Performance mode</span><input id="sq-sPerf" type="checkbox">
      <span class="hint">No skeleton, no live angle. Every millisecond goes to the ding.</span></label>
    <label class="sq-row"><span class="sq-name">Full model</span><input id="sq-sFull" type="checkbox">
      <span class="hint">Steadier tracking in bad light or baggy clothes, but slower per frame. Lite is the low-latency default. The full model is saved for offline the first time it loads.</span></label>
    <label class="sq-row"><span class="sq-name">Debug line</span><input id="sq-sDebug" type="checkbox"></label>
    <div class="sq-tools">
      <button class="btn-ghost small" id="sq-btnTestDing" type="button">Test ding</button>
      <button class="btn-ghost small" id="sq-btnTestBuzz" type="button">Test buzz</button>
      <button class="btn-ghost small" id="sq-btnTestReady" type="button">Test ready blip</button>
      <button class="btn-ghost small" id="sq-btnReset" type="button">Reset counts</button>
      <button class="btn-ghost small" id="sq-btnCopyLog" type="button">Copy latency log</button>
    </div>
    <button class="sheet-btn sheet-cancel" data-cancel type="button">Done</button>`, () => { drawOffline(); drawRuns(); });
  el.querySelector('[data-cancel]').addEventListener('click', () => close());
  for (const id of ['sTarget', 'sCount', 'sStand', 'sLead', 'sSound', 'sBuzz', 'sAnticipate', 'sPerf', 'sFull', 'sDebug']) {
    $(id).addEventListener('input', onSettingChange);
  }
  $('btnTestDing').addEventListener('click', () => { audio.unlock(); audio.ding(); audio.releaseSoonIfIdle(); });
  $('btnTestBuzz').addEventListener('click', () => { audio.unlock(); audio.buzz(); audio.releaseSoonIfIdle(); });
  $('btnTestReady').addEventListener('click', () => { audio.unlock(); audio.ready(); audio.releaseSoonIfIdle(); });
  $('btnReset').addEventListener('click', () => { machine.resetCounts(); resetReps(current); renderCounts(); });
  $('btnCopyLog').addEventListener('click', copyLog);
  syncSettingsUi();
}

function syncSettingsUi() {
  if (!$('sTarget')) return; // sheet closed
  $('sTarget').min = C.TARGET_DEG_MIN; $('sTarget').max = C.TARGET_DEG_MAX; $('sTarget').value = settings.targetDeg;
  $('sCount').min = C.TARGET_DEG_MIN; $('sCount').max = C.TARGET_DEG_MAX; $('sCount').value = settings.countDeg;
  $('sStand').min = C.STAND_DEG_MIN; $('sStand').max = C.STAND_DEG_MAX; $('sStand').value = settings.standDeg;
  $('sLead').value = settings.extraLeadMs;
  $('vTarget').textContent = settings.targetDeg + '°';
  $('vCount').textContent = settings.countDeg + '°';
  $('vStand').textContent = settings.standDeg + '°';
  $('vLead').textContent = settings.extraLeadMs ? `1 frame + ${settings.extraLeadMs} ms` : '1 frame';
  $('sSound').checked = settings.sound; $('sBuzz').checked = settings.buzz;
  $('sAnticipate').checked = settings.anticipate; $('sPerf').checked = settings.perfMode;
  $('sFull').checked = settings.model === 'full'; $('sDebug').checked = settings.debug;
}
function onSettingChange() {
  const prevModel = settings.model;
  settings.targetDeg = +$('sTarget').value;
  settings.countDeg = +$('sCount').value;
  settings.standDeg = +$('sStand').value;
  settings.extraLeadMs = +$('sLead').value;
  settings.sound = $('sSound').checked; settings.buzz = $('sBuzz').checked;
  settings.anticipate = $('sAnticipate').checked; settings.perfMode = $('sPerf').checked;
  settings.model = $('sFull').checked ? 'full' : 'lite'; settings.debug = $('sDebug').checked;
  machine.configure(settings);
  saveSettings(); syncSettingsUi(); if (runEl) applyDisplaySettings();
  if ($('targetLine')) $('targetLine').textContent = `${settings.targetDeg}°`;
  if (settings.model !== prevModel) loadPose(); // the old model keeps running until the new one is warm
}

async function copyLog() {
  const text = JSON.stringify({
    when: new Date().toISOString(), userAgent: navigator.userAgent, settings, camera: run.camera,
    delegate: pose.delegate, model: pose.model, warmupMs: Math.round(stats.warmupMs),
    fps: +stats.fps.toFixed(1), inferMs: +stats.inferMs.toFixed(1), droppedFrames: stats.dropped, staleFrames: stats.stale,
    dings: machine.dings, lateDings: machine.late, earlyDings: machine.early, earlyMissed: machine.earlyMissed, unseenReps: machine.unseen,
    estimatedReps: machine.estimated,
    earlyAvgLeadMs: machine.earlyConfirmed ? +(machine.earlyLeadSumMs / machine.earlyConfirmed).toFixed(1) : null,
    log: latencyLog,
  }, null, 1);
  const btn = $('btnCopyLog');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = `Copied ${latencyLog.length} dings`;
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'squat-latency-log.json'; a.click();
    btn.textContent = 'Saved as file';
  }
  setTimeout(() => { if ($('btnCopyLog')) $('btnCopyLog').textContent = 'Copy latency log'; }, 2000);
}

// Coming back from the lock screen / another app: iOS drops the wake lock, suspends audio,
// and may end the camera track.
async function onVisibility() {
  if (document.visibilityState === 'hidden') { audio.ctx?.suspend().catch(() => {}); return; }
  if (!run.active) return;
  acquireWakeLock();
  audio.ctx?.resume().catch(() => {});
  machine.resetState(); tracker.reset();
  if (run.mode === 'camera') {
    const track = run.stream?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      try { run.stream?.getTracks().forEach((t) => t.stop()); await startCamera(); } catch (e) { console.warn('[squat] camera restart failed', e); stop(); }
    } else {
      video.play().catch(() => {});
    }
  }
}
const onDeviceChange = () => { if (run.active) checkAudioRoute(); };

// ===== The screen =====
const ICON = '<svg aria-hidden="true" width="44" height="44" viewBox="0 0 180 180" fill="none"><rect width="180" height="180" rx="36" fill="#000000"/><path d="M44 70L126 80L98 146" stroke="#46e08c" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><circle cx="126" cy="80" r="13" fill="#e8f3f9"/></svg>';
export const SQUAT_ICON = ICON;

const SETUP = `
  <li><b>Phone at your side, upright.</b> Tripod at about hip height, 2&ndash;3&nbsp;m away. Upright (portrait) fits a standing person; sideways only works if the phone is far enough back that your head stays in the picture.</li>
  <li><b>Stand sideways to the camera</b>, the same way you'll squat under the bar. Not facing it, not with your back to it.</li>
  <li><b>Head to feet in the picture, standing <i>and</i> at the bottom.</b> If your head is cut off when you stand, the app can't see you standing and the ding comes late or not at all.</li>
  <li><b>Wait for the double blip.</b> Stand still where you'll squat. Two soft blips and READY mean it has you. No blip: fix the framing first. Then do one unloaded rep and listen for the ding.</li>
  <li><b>Phone speaker, volume up.</b> No Bluetooth: it delays the ding by 150&ndash;300&nbsp;ms.</li>`;

export function render(view, params = []) {
  // #/squat/set/<sessionId>/<exKey>: started from a squat in a session; the result fills one of its sets.
  link = params[0] === 'set' && params[1] ? { sessionId: params[1], exKey: params[2] || null, setId: null, exerciseName: null } : null;
  const back = link ? `#/session/${encodeURIComponent(link.sessionId)}` : '#/train';
  view.innerHTML = `
    <div id="sq-start" class="sq-start">
      <div class="lib-head"><a class="pill" href="${back}">${link ? 'Back to session' : 'Back'}</a><span class="hud c-muted" id="sq-lastLine"></span></div>
      <div class="sq-title">${ICON}<div><h1 class="view-title">Squat Depth</h1><p class="view-sub">A ding the instant your knee hits depth. Target <b class="c-text" id="sq-targetLine">${esc(settings.targetDeg)}°</b>.</p></div></div>
      <section class="card pad-card" id="sq-for" hidden></section>
      <div id="sq-startNotice" class="card pad-card sq-notice" hidden></div>
      <div class="sq-actions">
        <button id="sq-btnStart" class="btn-primary big" type="button">Start camera</button>
        <button id="sq-btnTest" class="btn-ghost" type="button">Test with video</button>
        <button id="sq-btnSettings" class="btn-ghost" type="button">Settings</button>
      </div>
      <input id="sq-fileInput" type="file" accept="video/*" hidden>
      <div id="sq-modelStatus" class="hud sq-status c-muted">Loading pose model…</div>
      <div id="sq-offline" class="card pad-card sq-offline"></div>
      <div class="section-label">Recent runs</div>
      <ul class="sq-runs" id="sq-runs"></ul>
      <div class="section-label">Setup</div>
      <ol class="sq-setup">${SETUP}</ol>
    </div>
    <section id="sq-run" class="sq-run" hidden>
      <video id="sq-video" playsinline webkit-playsinline muted></video>
      <canvas id="sq-overlay"></canvas>
      <div id="sq-flash"></div>
      <div class="sq-hud angle">
        <span class="sq-lbl">KNEE</span>
        <span id="sq-hudAngle" class="sq-big">&ndash;</span>
        <span id="sq-hudState" class="sq-state">&nbsp;</span>
      </div>
      <div class="sq-hud reps">
        <span class="sq-lbl">GOOD REPS</span>
        <span id="sq-hudReps" class="sq-huge">0</span>
        <span id="sq-hudShallow" class="sq-sub">shallow 0</span>
        <span id="sq-hudUnseen" class="sq-sub" hidden>not seen 0</span>
        <span id="sq-hudLast" class="sq-sub">last &ndash;</span>
      </div>
      <div id="sq-banner" hidden></div>
      <div class="sq-bottom">
        <span id="sq-lock" class="sq-pill bad">CAN'T SEE YOU HEAD TO FEET</span>
        <span id="sq-audioWarn" class="sq-pill warn" hidden></span>
        <span id="sq-forPill" class="sq-pill" hidden></span>
        <div id="sq-debug" hidden></div>
      </div>
      <button id="sq-btnUncount" type="button" hidden>DON'T COUNT</button>
      <div class="sq-btns">
        <button id="sq-btnReplay" type="button" aria-label="Replay video" hidden>&#x27F2;</button>
        <button id="sq-btnSettingsRun" type="button" aria-label="Settings">&#x2699;&#xFE0E;</button>
        <button id="sq-btnStop" type="button" aria-label="Stop">&#x2715;</button>
      </div>
    </section>`;
  video = $('video'); overlayCanvas = $('overlay'); runEl = $('run');
  g = overlayCanvas.getContext('2d');
  if (run.active) stop({ quiet: true }); // a run from an earlier visit (should not happen: leaving stops it)

  // ===== Wiring =====
  const testUrl = new URLSearchParams(location.search).get('video'); // ?video=clip.mp4 skips the file picker
  $('btnStart').addEventListener('click', () => start('camera'));
  $('btnTest').addEventListener('click', () => {
    audio.unlock(); // the file picker eats the gesture, so unlock audio now
    if (testUrl) start('file', testUrl); else { $('fileInput').click(); audio.idleTimer = setTimeout(() => { if (!run.active) audio.shutdown(); }, 60000); }
  });
  $('fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) start('file', URL.createObjectURL(file));
  });
  $('btnStop').addEventListener('click', () => stop());
  $('btnUncount').addEventListener('click', uncountLatest);
  $('btnReplay').addEventListener('click', replay);
  video.addEventListener('ended', () => {
    if (run.active && run.mode === 'file') showBanner(`Video ended: ${machine.good} good, ${machine.shallow} shallow${machine.estimated ? ` (${machine.estimated} estimated)` : ''}${machine.unseen ? `, ${machine.unseen} not seen` : ''}. Tap ⟲ to replay, ✕ to finish.`, 0, 'info');
  });
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSettingsRun').addEventListener('click', openSettings);
  document.addEventListener('visibilitychange', onVisibility);
  navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

  if (!window.isSecureContext) {
    const el = $('startNotice');
    el.textContent = 'This page is not on HTTPS, so the camera is blocked. Video-file test mode still works.';
    el.hidden = false;
  }
  if (testUrl) $('btnTest').textContent = 'Test: ' + testUrl.split('/').pop();

  setModelStatus(...pose.status);
  if (!pose.ready) loadPose();
  drawOffline();
  let off = () => {};
  ready.then(async (r) => {
    repo = r;
    if (!viewAlive()) return;
    drawRuns();
    off = repo.onChange((cols) => { if (cols.includes('squats')) drawRuns(); });
    if (link) {
      const session = await repo.get('sessions', link.sessionId);
      const ex = session?.exercises?.find((e) => e.key === link.exKey) || session?.exercises?.find(isSquatExercise);
      if (!session || session.status !== 'active' || !ex || !viewAlive()) { link = null; return; }
      link.exKey = ex.key; link.exerciseName = ex.name;
      const sets = (await repo.list('sets')).filter((s) => s.sessionId === session.id);
      const { choices, defaultId } = fillChoices(session, sets, { exKey: ex.key });
      const c = choices.find((x) => x.setId === defaultId);
      link.setId = c?.setId ?? null;
      const line = c ? `${c.label === 'W' ? 'Warm-up' : `Set ${c.label}`}${c.kg != null ? ` · ${fmtKg(c.kg)} kg` : ''}` : '';
      $('for').hidden = false;
      $('for').innerHTML = `<span class="hud c-cyan">FOR ${esc(session.title.toUpperCase())}</span><b>${esc(ex.name)}${line ? ` · ${esc(line)}` : ''}</b>
        <span class="hint">After the set, tap ✕: the reps and lowest depth go into this set (you can pick another).</span>`;
      $('forPill').hidden = false;
      $('forPill').textContent = `${ex.name.replace(/\s*\(.*\)$/, '').toUpperCase()}${line ? ` · ${line.toUpperCase()}` : ''}`;
    }
  });

  // For poking at from the console (as in the original), plus feed(): angles straight into the rep logic, as if the
  // camera saw them, for testing without a person in front of it.
  window.squat = { settings, machine, tracker, kneeGuard, estimator, stats, latencyLog, pose, run, audio, get current() { return current; },
    feed(angles, fps = 30) {
      const dt = 1000 / fps;
      let t = performance.now();
      for (const raw of angles) {
        t += dt;
        const sample = tracker.update(raw, t);
        if (!sample) continue;
        const ev = machine.update(sample.angle, sample.vel, t, sample.dtMs, sample.restarted);
        if (ev) onRepEvent(ev, sample, t, t, t, 'callback');
      }
      return { good: machine.good, shallow: machine.shallow };
    } };

  return () => {
    if (run.active || current) stop({ quiet: true });
    off();
    document.removeEventListener('visibilitychange', onVisibility);
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    document.documentElement.classList.remove('sq-running');
    video = null; overlayCanvas = null; runEl = null; g = null; link = null;
  };
}
