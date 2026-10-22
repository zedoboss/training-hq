// The workout in progress, on every other screen (Thu 10/22, his words: "if I'm in the homepage and I have a workout
// ongoing, there should be a small GUI reminding me that I'm mid-workout. It can show the rest time there, what's up
// next... Should be visible everywhere I go. And if I click on it, it takes me back to the workout"). A slim bar at the
// bottom: day type and clock, the rest countdown while it runs, the next set; a tap opens the workout. Hidden on the
// workout's own screens. The page keeps room for it (body.has-wbar), so the home dock and Talk's box stay clear.
import { ready } from '../lib/data.js';
import { elapsedMs, clock, nextSetText } from '../lib/session.js';
import * as rest from '../lib/rest-timer.js';
import { LABEL } from '../lib/rotation.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Screens that are the workout itself (or need the whole screen). */
const HIDE = /^#\/(session|finish|squat)(\/|$)/;

export function mountWorkoutBar() {
  const el = document.createElement('a');
  el.className = 'wbar';
  el.hidden = true;
  el.setAttribute('aria-label', 'Back to the workout');
  document.body.append(el);
  let session = null; let sets = [];

  const draw = () => {
    const show = Boolean(session) && !HIDE.test(location.hash);
    el.hidden = !show;
    document.body.classList.toggle('has-wbar', show);
    if (!show) return;
    el.href = `#/session/${encodeURIComponent(session.id)}`;
    const r = rest.status();
    const name = (LABEL[session.dayType] || session.title || 'Workout').toUpperCase();
    const next = nextSetText(session, sets);
    el.innerHTML = `<span class="wbar-top"><span class="hud c-amber">● ${esc(name)} · ${session.pausedAt ? 'PAUSED' : clock(elapsedMs(session))}</span>
      ${r ? `<span class="hud c-cyan wbar-rest">REST ${mmss(r.leftMs)}</span>` : '<span class="hud c-muted">IN PROGRESS</span>'}<span class="wbar-go" aria-hidden="true">›</span></span>
      <span class="wbar-next">${next ? `Next: ${esc(next)}` : 'Every set ticked. Finish it.'}</span>`;
  };

  ready.then((repo) => {
    const load = async () => {
      session = (await repo.list('sessions')).find((s) => s.status === 'active' && s.kind !== 'holds') || null;
      sets = session ? (await repo.list('sets')).filter((s) => s.sessionId === session.id) : [];
      draw();
    };
    load();
    repo.onChange((cols) => { if (cols.some((c) => c === 'sessions' || c === 'sets')) load(); });
  }).catch(() => {});
  window.addEventListener('hashchange', draw);
  rest.subscribe(() => { if (!el.hidden) draw(); });
  setInterval(() => { if (!el.hidden) draw(); }, 1000);
}
