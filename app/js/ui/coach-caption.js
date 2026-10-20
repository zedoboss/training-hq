// What the coach says, on screen (Tue 10/20, his words: "if the coach is talking to me I want him to somehow pop a
// GUI... I still want to be able to do the exercise and log... I want to also be able to read the transcript just in
// case I mishear anything because I'm at the gym"). A small banner at the top, under the iPhone's status bar: it
// never blocks the screen, stays a few seconds (longer for longer lines), a tap closes it. Sentences of one answer
// add up in the same banner. Anything can show a line: window event 'thq:coach-say' {text}.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const JOIN_MS = 8000;

export function mountCoachCaption() {
  const el = document.createElement('div');
  el.className = 'coach-caption';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.append(el);
  let text = ''; let last = 0; let hide = null;
  const close = () => { el.classList.remove('is-on'); clearTimeout(hide); hide = setTimeout(() => { el.hidden = true; text = ''; }, 250); };
  el.addEventListener('click', close);
  window.addEventListener('thq:coach-say', (e) => {
    const t = String(e.detail?.text || '').trim();
    if (!t) return;
    const now = Date.now();
    text = text && now - last < JOIN_MS ? `${text} ${t}` : t;
    last = now;
    if (text.length > 400) text = `…${text.slice(-400)}`;
    el.innerHTML = `<span class="hud c-cyan">COACH</span><span class="cc-text">${esc(text)}</span>`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-on'));
    clearTimeout(hide);
    hide = setTimeout(close, Math.min(15000, 4000 + text.length * 55));
  });
}
