// What the coach says, on screen (Tue 10/20, his words: "if the coach is talking to me I want him to somehow pop a
// GUI... I still want to be able to do the exercise and log... I want to also be able to read the transcript just in
// case I mishear anything because I'm at the gym"). A small banner at the top, under the iPhone's status bar: it
// never blocks the screen, a tap or its X closes it. Sentences of one answer add up in the same banner. Anything can
// show a line: window event 'thq:coach-say' {text}.
// Thu 10/22, his words: "There should be an X button... if it's a long-ass text, it should just disappear by itself. It
// should always wait for the coach to finish talking and then disappear a second after": while the coach's voice plays
// (window event 'thq:coach-speaking' {speaking}) it stays, and goes a second after; a line with no voice goes on a
// timer by its length.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const JOIN_MS = 8000;
const AFTER_SPEECH_MS = 1000;
// A voice that never reports its end can't keep the banner up for ever.
const SPEAKING_MAX_MS = 90000;

export function mountCoachCaption() {
  const el = document.createElement('div');
  el.className = 'coach-caption';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.append(el);
  let text = ''; let last = 0; let hide = null; let speaking = false;
  const close = () => { el.classList.remove('is-on'); clearTimeout(hide); hide = setTimeout(() => { el.hidden = true; text = ''; }, 250); };
  const later = (ms) => { clearTimeout(hide); hide = setTimeout(close, ms); };
  el.addEventListener('click', close);
  window.addEventListener('thq:coach-speaking', (e) => {
    speaking = Boolean(e.detail?.speaking);
    if (el.hidden) return;
    later(speaking ? SPEAKING_MAX_MS : AFTER_SPEECH_MS);
  });
  window.addEventListener('thq:coach-say', (e) => {
    const t = String(e.detail?.text || '').trim();
    if (!t) return;
    const now = Date.now();
    text = text && now - last < JOIN_MS ? `${text} ${t}` : t;
    last = now;
    if (text.length > 400) text = `…${text.slice(-400)}`;
    el.innerHTML = `<div class="cc-head"><span class="hud c-cyan">COACH</span><button class="cc-x" type="button" aria-label="Close">✕</button></div><span class="cc-text">${esc(text)}</span>`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-on'));
    // Not spoken (yet): by its length; the voice starting takes over.
    later(speaking ? SPEAKING_MAX_MS : Math.min(15000, 4000 + text.length * 55));
  });
}
