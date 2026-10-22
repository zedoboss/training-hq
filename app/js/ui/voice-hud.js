// The voice chip in the header (9.7, 9.3): whether this device is listening, hearing, thinking or speaking, and the
// small silent readout when speech was heard and ignored (NOT YOU 0.21, MUSIC, NOISE). Tap: listen / microphone off
// (only his mic: the coach's answer still plays). The X beside it, while the coach answers, stops the coach talking.
// Hidden on devices where voice was never switched on.
import * as voice from '../lib/voice.js';
import { REASON_TEXT, micTap, showsStop } from '../lib/voice-text.js';
import { toast } from './toast.js';

const MIC = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const X = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const LABEL = { off: 'MIC OFF', listening: 'LISTENING', hearing: 'HEARING', thinking: 'THINKING', speaking: 'SPEAKING', paused: 'PAUSED', tap: 'TAP TO LISTEN', error: 'MIC ERROR' };

export function mountVoiceHud(el, stopEl) {
  stopEl.innerHTML = X;
  stopEl.addEventListener('click', () => voice.hush());
  const draw = (s = voice.snapshot()) => {
    el.hidden = !s.used && !s.wanted;
    stopEl.hidden = !showsStop(s);
    const r = s.readout;
    const text = r ? `${REASON_TEXT[r.reason] || (r.reason === 'mac' ? 'MAC UNREACHABLE' : String(r.reason).toUpperCase())}${r.score != null ? ` · ${r.score.toFixed(2)}` : ''}` : LABEL[s.phase] || s.phase.toUpperCase();
    el.innerHTML = `${MIC}<span>${text}</span>`;
    el.className = `voice-chip is-${s.phase}${r ? ' is-readout' : ''}`;
    el.setAttribute('aria-label', `Voice: ${text}`);
  };
  el.addEventListener('click', async () => {
    const s = voice.snapshot();
    const what = micTap(s);
    if (what === 'mute') { voice.stop(); toast('Microphone off on this device. Tap the mic to listen again.'); return; }
    if (what === 'held') { toast('Voice setup is using the microphone.'); return; }
    try { await voice.start(); toast('Listening while the app is open.'); } catch (e) { toast(e.message); if (/Calibrate/.test(e.message)) location.hash = '#/voice'; }
  });
  voice.onChange(draw);
  draw();
}
