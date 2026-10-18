// The sauna's overdue alarm (brief section 11): loud and continuous until he taps OUT. Web Audio, no sound file.
// arm() must run inside a tap (iPhone rule); after that the alarm can start on its own while the app is on screen.
// Where Safari supports it, the audio session is set to 'playback' so the ring/silent switch doesn't mute it.
let ctx = null;
let osc = null;
let gain = null;
let timer = null;

export function arm() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* not supported */ }
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // A silent blip keeps iOS from suspending the context before it is needed.
    const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0001;
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05);
  } catch { /* no audio */ }
}

export const ringing = () => !!osc;
/** Armed: audio is ready to sound without another tap (false after the app was reopened mid-round). */
export const armed = () => !!ctx && ctx.state !== 'closed';

/** Start the alarm: a two-tone square wave at full volume, switching every half second. */
export function start() {
  if (osc || !ctx) return false;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.9;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    let hi = true;
    timer = setInterval(() => { hi = !hi; if (osc) osc.frequency.setValueAtTime(hi ? 880 : 660, ctx.currentTime); }, 500);
    return true;
  } catch { osc = null; return false; }
}

export function stop() {
  clearInterval(timer); timer = null;
  try { osc?.stop(); } catch { /* already stopped */ }
  osc = null; gain = null;
}
