// Settings > Notifications: turn push on for this device (from a tap), send a test, turn it off.
import { getState } from '../lib/store.js';
import { pushSupported, isStandalone, permission, currentSubscription, enablePush, disablePush, testPush, pushStatus } from '../lib/push.js';
import { toast } from './toast.js';

const isPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export function notifyPanel(el) {
  const draw = async () => {
    const s = getState();
    if (!s.paired) { el.innerHTML = '<p class="hint">Pair with your Mac first: the Mac sends the notifications.</p>'; return; }
    if (!pushSupported()) {
      el.innerHTML = `<p class="hint">${isPhone() && !isStandalone() ? 'Open Training HQ from your Home Screen to turn on notifications (iOS 16.4 or later). Safari tabs can\'t get them.' : 'This browser can\'t show notifications from Training HQ.'}</p>`;
      return;
    }
    const local = await currentSubscription().catch(() => null);
    let server = null;
    try { server = await pushStatus(); } catch { /* Mac unreachable */ }
    const on = !!local && permission() === 'granted' && server?.subscribed !== false;
    el.innerHTML = `
      <dl class="card kv">
        <dt>This device</dt><dd id="push-state">${on ? '<span class="c-green">On</span>' : permission() === 'denied' ? '<span class="c-amber">Blocked in iPhone Settings</span>' : 'Off'}${server == null ? ' <span class="c-muted">(Mac unreachable)</span>' : ''}</dd>
      </dl>
      <div class="btn-row">${on
        ? '<button class="btn-ghost" id="push-test" type="button">Send a test</button><button class="btn-ghost" id="push-off" type="button">Turn off</button>'
        : '<button class="btn-primary" id="push-on" type="button">Turn on notifications</button>'}</div>
      <p class="hint">Your Mac sends them, so they arrive while it is on and online. Tapping one opens the right screen.</p>`;
    const onBtn = el.querySelector('#push-on');
    if (onBtn) onBtn.onclick = () => {
      onBtn.disabled = true;
      enablePush(isPhone() ? 'iPhone' : 'Mac browser')
        .then(() => toast('Notifications on. Sending a test…'))
        .then(() => testPush().catch(() => null))
        .catch((e) => toast(/Failed to fetch|unreachable/i.test(e.message) ? 'Mac unreachable. Try again when it is connected.' : e.message))
        .finally(draw);
    };
    const test = el.querySelector('#push-test');
    if (test) test.onclick = async () => {
      try { await testPush(); toast('Sent. It should arrive in a few seconds.'); } catch (e) { toast(e.message); }
    };
    const off = el.querySelector('#push-off');
    if (off) off.onclick = async () => { await disablePush(); toast('Notifications off on this device.'); draw(); };
  };
  draw();
  return draw;
}
