// The microphone (step 9): open it with the phone's echo cancellation, noise suppression and level control, and hand
// 16 kHz frames to a callback. One audio context is shared with the coach's voice, so echo cancellation knows what
// the speaker is playing. Works only while the app is open and on screen (iPhone rule).

let ctx = null;

/** The app's audio context for voice (made on a tap, so iPhone lets it play). */
export function audioContext() {
  if (!ctx || ctx.state === 'closed') ctx = new (window.AudioContext || window.webkitAudioContext)();
  // 'interrupted' is iPhone's state after something else took the audio (Tue 10/20: iPhone Mirroring).
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

/** Whether the shared audio context is running (false when there is none yet). */
export const audioRunning = () => !!ctx && ctx.state === 'running';

/** Drop the shared audio context, so the next audioContext() makes a fresh one (best from a tap). */
export function resetAudio() {
  const old = ctx; ctx = null;
  try { old?.close(); } catch { /* already closed */ }
}

// Tue 10/20: after iPhone Mirroring had the microphone, the app said "Listening" but heard nothing: its audio
// context stayed stopped and no sound came through. A mic that gives no frames this soon is not trusted.
const FIRST_FRAME_MS = 2500;

/**
 * @param {{onFrame: (f: Float32Array) => void, onEnded?: () => void}} o
 * @returns {Promise<{close: () => void, stream: MediaStream}>}
 */
export async function openMic({ onFrame, onEnded = () => {} }) {
  try {
    return await openMicOnce({ onFrame, onEnded });
  } catch (e) {
    if (e?.code !== 'silent') throw e;
    // No sound at all: a fresh audio context and a fresh microphone, once.
    resetAudio();
    try { return await openMicOnce({ onFrame, onEnded }); } catch (e2) {
      if (e2?.code === 'silent') throw new Error('No sound from the microphone. Tap the mic to start it again.');
      throw e2;
    }
  }
}

async function openMicOnce({ onFrame, onEnded }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No microphone access in this browser.');
  // iPhone: record and play at the same time, through the speaker (Safari's audio session, where it exists).
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* older Safari */ }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    throw new Error(e?.name === 'NotAllowedError' ? 'Microphone not allowed. Allow it for Training HQ, then try again.' : `Microphone: ${e?.message || e}`);
  }
  const ac = audioContext();
  await ac.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url).href);
  const src = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, 'thq-mic');
  // The tap must reach the output to run; at zero volume nothing is heard.
  const mute = ac.createGain();
  mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ac.destination);
  let gotFrame = false;
  node.port.onmessage = (e) => { gotFrame = true; onFrame(e.data); };
  const track = stream.getAudioTracks()[0];
  const ended = () => onEnded();
  track?.addEventListener('ended', ended);
  let closed = false;
  const mic = {
    stream,
    close() {
      if (closed) return;
      closed = true;
      track?.removeEventListener('ended', ended);
      node.port.onmessage = null;
      try { src.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      for (const t of stream.getTracks()) t.stop();
    },
  };
  if (ac.state !== 'running') await ac.resume().catch(() => {});
  const t0 = Date.now();
  while (!gotFrame && Date.now() - t0 < FIRST_FRAME_MS) await new Promise((r) => setTimeout(r, 100));
  if (!gotFrame) {
    mic.close();
    const e = new Error('silent'); e.code = 'silent';
    throw e;
  }
  return mic;
}
