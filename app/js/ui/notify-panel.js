// Settings > Notifications: turn push on for this device (from a tap), send a test, turn it off.
import { getState } from '../lib/store.js';
import { ready, saveSettings } from '../lib/data.js';
import { withDefaults } from '../lib/settings.js';
import { KINDS, remindersFor, reminderState } from '../lib/reminders.js';
import { isoDate, formatTime } from '../lib/time.js';
import { pushSupported, isStandalone, permission, currentSubscription, enablePush, disablePush, testPush, pushStatus } from '../lib/push.js';
import { toast } from './toast.js';

const isPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Today's reminders worked out on this device, the same way the Mac does. */
export async function todaysReminders(date = isoDate(new Date())) {
  const repo = await ready;
  const [sessions, sets, tendons, bridge, settings, meta, days, neck] = await Promise.all([
    repo.list('sessions'), repo.list('sets'), repo.list('tendons'), repo.get('bridge', 'last-loads'), repo.get('settings', 'main'),
    repo.get('programme', 'meta'), repo.list('days'), repo.get('schedule', 'neck'),
  ]);
  return remindersFor({ ...reminderState({ sessions, sets, tendons, bridge, settings, meta, days, neck }), date });
}

function prefsHtml(n) {
  const mins = [15, 20, 30, 45, 60];
  return `<div class="card opt-list" id="notify-prefs">
    ${KINDS.map(([k, label]) => `<label class="opt"><span>${esc(label)}</span><input type="checkbox" data-kind="${k}" ${n.kinds?.[k] === false ? '' : 'checked'}></label>`).join('')}
    <label class="opt"><span>Check-in before a session</span><select class="input mini" data-n="readinessMin">${mins.map((m) => `<option value="${m}" ${m === n.readinessMin ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
    <label class="opt"><span>Morning holds</span><input class="input mini" type="time" data-n="holdsMorning" value="${esc(n.holdsMorning)}"></label>
    <label class="opt"><span>Evening holds</span><input class="input mini" type="time" data-n="holdsEvening" value="${esc(n.holdsEvening)}"></label>
    <label class="opt"><span>Evening round-up</span><input class="input mini" type="time" data-n="eveningCheck" value="${esc(n.eveningCheck)}"></label>
  </div>`;
}

export function notifyPanel(el) {
  const draw = async () => {
    const s = getState();
    if (!s.paired) { el.innerHTML = '<p class="hint">Pair with your Mac first: the Mac sends the notifications.</p>'; return; }
    let top;
    let on = false;
    if (!pushSupported()) {
      top = `<p class="hint">${isPhone() && !isStandalone() ? 'Open Training HQ from your Home Screen to turn on notifications (iOS 16.4 or later). Safari tabs can\'t get them.' : 'This browser can\'t show notifications from Training HQ.'}</p>`;
    } else {
      const local = await currentSubscription().catch(() => null);
      let server = null;
      try { server = await pushStatus(); } catch { /* Mac unreachable */ }
      on = !!local && permission() === 'granted' && server?.subscribed !== false;
      top = `
      <dl class="card kv">
        <dt>This device</dt><dd id="push-state">${on ? '<span class="c-green">On</span>' : permission() === 'denied' ? '<span class="c-amber">Blocked in iPhone Settings</span>' : 'Off'}${server == null ? ' <span class="c-muted">(Mac unreachable)</span>' : ''}</dd>
      </dl>
      <div class="btn-row">${on
        ? '<button class="btn-ghost" id="push-test" type="button">Send a test</button><button class="btn-ghost" id="push-off" type="button">Turn off</button>'
        : '<button class="btn-primary" id="push-on" type="button">Turn on notifications</button>'}</div>
      <p class="hint">Your Mac sends them, so they arrive while it is on and online. Tapping one opens the right screen.</p>`;
    }
    el.innerHTML = `${top}
      ${prefsHtml(withDefaults(s.settings).notify)}
      <div class="hud c-muted rem-head">TODAY'S REMINDERS</div>
      <ul class="rem-list" id="rem-list"><li class="hint">…</li></ul>`;
    el.querySelectorAll('[data-kind]').forEach((c) => c.addEventListener('change', () => saveSettings({ notify: { kinds: { [c.dataset.kind]: c.checked } } }).then(listToday)));
    el.querySelectorAll('[data-n]').forEach((c) => c.addEventListener('change', () => {
      const v = c.dataset.n === 'readinessMin' ? Number(c.value) : c.value;
      if (c.type === 'time' && !/^\d\d:\d\d$/.test(v)) return;
      saveSettings({ notify: { [c.dataset.n]: v } }).then(listToday);
    }));
    listToday();
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

  async function listToday() {
    const ul = el.querySelector('#rem-list');
    if (!ul) return;
    const items = await todaysReminders();
    const today = isoDate(new Date());
    const mine = items.filter((i) => isoDate(new Date(i.at)) === today);
    ul.innerHTML = mine.length ? mine.map((i) => `<li class="rem ${i.due ? '' : 'is-done'}"><span class="hud ${i.due ? 'c-cyan' : 'c-muted'}">${formatTime(new Date(i.at))}</span>
      <span><b>${esc(i.title)}</b><br><span class="hint">${esc(i.body)}${i.due ? '' : ' · nothing to send'}</span></span></li>`).join('')
      : '<li class="hint">Nothing today. Set a session time on Train to get the check-in and session reminders.</li>';
  }
  draw();
  return draw;
}
