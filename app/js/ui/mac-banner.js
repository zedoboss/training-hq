// Thu 11/5 (missing feature 13): a plain banner under the header when the Mac has been unreachable for 2 minutes while
// the phone is online (lib/mac-reach.js). Its X hides it until the Mac has answered once and gone quiet again.
import { getState, subscribe } from '../lib/store.js';
import { downSinceNext, reachWarning } from '../lib/mac-reach.js';

export function mountMacBanner(after) {
  const el = document.createElement('div');
  el.className = 'mac-banner';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  after.after(el);
  let downSince = null; let closedFor = null;
  const draw = () => {
    const s = getState();
    downSince = downSinceNext(downSince, s.mac?.reachable ?? null, Date.now());
    if (downSince == null) closedFor = null;
    const text = closedFor != null && closedFor === downSince ? null : reachWarning({ paired: s.paired, online: navigator.onLine !== false, downSince, now: Date.now() });
    el.hidden = !text;
    if (!text) return;
    el.innerHTML = `<span class="hud c-amber">MAC UNREACHABLE</span><span class="mb-text"></span><button class="mb-x" type="button" aria-label="Hide">✕</button>`;
    el.querySelector('.mb-text').textContent = text;
    el.querySelector('.mb-x').addEventListener('click', () => { closedFor = downSince; el.hidden = true; });
  };
  subscribe(draw);
  window.addEventListener('online', draw);
  window.addEventListener('offline', draw);
  setInterval(draw, 30000);
  draw();
}
