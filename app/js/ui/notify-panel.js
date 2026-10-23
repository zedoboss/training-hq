// Settings > Notifications: turn push on for this device (from a tap), send a test, turn it off.
import { getState } from '../lib/store.js';
import { ready, saveSettings } from '../lib/data.js';
import { withDefaults } from '../lib/settings.js';
import { KINDS, remindersFor, reminderState } from '../lib/reminders.js';
import { isoDate, formatTime, formatDay } from '../lib/time.js';
import { fixedReminders, backupStatusText, BACKUP_CALENDAR } from '../lib/backup-reminders.js';
import { macGet } from '../lib/data.js';
import { pushSupported, isStandalone, permission, currentSubscription, enablePush, disablePush, testPush, pushStatus } from '../lib/push.js';
import { toast } from './toast.js';

const isPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadState() {
  const repo = await ready;
  const [sessions, sets, tendons, bridge, settings, meta, days, neck, meals, mealChecks, supplements, suppLog, suppAnswers, sauna, saunaPlan, scans, scanPlan, coachReminders] = await Promise.all([
    repo.list('sessions'), repo.list('sets'), repo.list('tendons'), repo.get('bridge', 'last-loads'), repo.get('settings', 'main'),
    repo.get('programme', 'meta'), repo.list('days'), repo.get('schedule', 'neck'), repo.list('meals'), repo.list('meal-checks'),
    repo.list('supplements'), repo.list('supp-log'), repo.list('supp-answers'), repo.list('sauna'), repo.get('sauna-plan', 'main'), repo.list('body-scans'), repo.get('scan-plan', 'main'),
    repo.list('coach-reminders'),
  ]);
  const recoveryPlan = await repo.get('recovery', 'main');
  const recovery = recoveryPlan ? { recoveryPlan, recoveryState: await repo.get('recovery', 'state'), notes: await repo.list('coach-notes'), photos: await repo.list('body-photos') } : {};
  return reminderState({ sessions, sets, tendons, bridge, settings, meta, days, neck, meals, mealChecks, supplements, suppLog, suppAnswers, sauna, saunaPlan, scans, scanPlan, coachReminders, ...recovery });
}

/** Today's reminders worked out on this device, the same way the Mac does. */
export async function todaysReminders(date = isoDate(new Date())) {
  return remindersFor({ ...(await loadState()), date });
}

function backupHtml(items) {
  const first = items[0]; const last = items[items.length - 1];
  return `<div class="hud c-muted rem-head">BACKUP REMINDERS ON THIS IPHONE</div>
    <section class="card pad-card" id="backup">
      <p class="hint c-text">If your Mac is off or offline, notifications stop. So the Mac keeps the next 3 days' fixed reminders (check-ins and sessions you set a time for, holds, reminders you asked the coach for) in a calendar in your iCloud, "${esc(BACKUP_CALENDAR)}". iCloud updates your iPhone within seconds: one the Mac sent, moved or you did is gone before it would ring. With the Mac off they stay, and ring 20 minutes after their time.</p>
      <p class="hint" id="backup-status">Asking the Mac…</p>
      <p class="hint" id="backup-count">${items.length ? `${items.length} reminders in the next 7 days, ${esc(formatDay(new Date(first.at)))} to ${esc(formatDay(new Date(last.at)))}.` : 'Nothing to back up for the next days.'}</p>
      <details class="bk-steps"><summary>Set it up once</summary><ol>
        <li>On your iPhone: Calendar, Calendars, Add Calendar, name it ${esc(BACKUP_CALENDAR)}, account iCloud, Done.</li>
        <li>On the Mac: when macOS asks whether "node" may control Calendar, click OK.</li>
        <li>If you subscribed to the old Training HQ link: iPhone Settings, Apps, Calendar, Calendar Accounts, the subscribed Training HQ, Delete Account. Your iPhone stopped refreshing it, so its alerts rang at old times.</li>
        <li>Nothing to change in Do Not Disturb: with it on, a backup alert lands quietly in Notification Center, and only when the Mac couldn't send it (Thu 10/22, his choice: only Training HQ comes through).</li>
      </ol></details>
    </section>`;
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
        <dt>This device</dt><dd id="push-state">${on ? '<span class="c-green">On</span>' : permission() === 'denied' ? `<span class="c-amber">Blocked in ${isPhone() ? 'iPhone Settings' : 'this browser\'s settings'}</span>` : 'Off'}${server == null ? ' <span class="c-muted">(Mac unreachable)</span>' : ''}</dd>
      </dl>
      <div class="btn-row">${on
        ? '<button class="btn-ghost" id="push-test" type="button">Send a test</button><button class="btn-ghost" id="push-off" type="button">Turn off</button>'
        : '<button class="btn-primary" id="push-on" type="button">Turn on notifications</button>'}</div>
      <p class="hint">Your Mac sends them, so they arrive while it is on and online. Tapping one opens the right screen.</p>`;
    }
    el.innerHTML = `${top}
      ${prefsHtml(withDefaults(s.settings).notify)}
      <div class="hud c-muted rem-head">TODAY'S REMINDERS</div>
      <ul class="rem-list" id="rem-list"><li class="hint">…</li></ul>
      <div id="backup-box"></div>`;
    drawBackup();
    el.querySelectorAll('[data-kind]').forEach((c) => c.addEventListener('change', () => saveSettings({ notify: { kinds: { [c.dataset.kind]: c.checked } } }).then(listToday)));
    el.querySelectorAll('[data-n]').forEach((c) => c.addEventListener('change', () => {
      const v = c.dataset.n === 'readinessMin' ? Number(c.value) : c.value;
      if (c.type === 'time' && !/^\d\d:\d\d$/.test(v)) return;
      saveSettings({ notify: { [c.dataset.n]: v } }).then(() => { listToday(); drawBackup(); });
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

  async function drawBackup() {
    const box = el.querySelector('#backup-box');
    if (!box) return;
    const st = await loadState();
    const today = isoDate(new Date());
    const items = fixedReminders(st, today, 7);
    box.innerHTML = backupHtml(items);
    // Thu 10/22: how the iCloud backup stands, from the Mac.
    try {
      const bs = await macGet('/api/backup/status');
      const v = backupStatusText(bs.icloud, { enabled: bs.enabled, formatTime: (ms) => formatTime(new Date(ms)) });
      const el2 = box.querySelector('#backup-status');
      if (el2) { el2.textContent = v.text; el2.className = `hint ${v.ok ? 'c-green' : 'c-amber'}`; }
    } catch (e) { const el2 = box.querySelector('#backup-status'); if (el2) el2.textContent = `Couldn't ask the Mac: ${e.message}`; }
  }

  async function listToday() {
    const ul = el.querySelector('#rem-list');
    if (!ul) return;
    const items = await todaysReminders();
    const today = isoDate(new Date());
    // A run of check-ins (a meal he hasn't answered) is one line: its first, then how many more follow.
    const firstOf = new Map();
    for (const i of items) if (i.group && !(firstOf.get(i.group)?.at <= i.at)) firstOf.set(i.group, i);
    const more = (g) => items.filter((x) => x.group === g).length - 1;
    const mine = items.filter((i) => isoDate(new Date(i.at)) === today && (!i.group || firstOf.get(i.group) === i))
      .map((i) => (i.group ? { ...i, body: `${i.body}${more(i.group) > 0 ? ` No answer: ${more(i.group)} more check-in${more(i.group) > 1 ? 's' : ''}, further apart.` : ''}`, due: items.some((x) => x.group === i.group && x.due) } : i));
    ul.innerHTML = mine.length ? mine.map((i) => `<li class="rem ${i.due ? '' : 'is-done'}"><span class="hud ${i.due ? 'c-cyan' : 'c-muted'}">${formatTime(new Date(i.at))}</span>
      <span><b>${esc(i.title)}</b><br><span class="hint">${esc(i.body)}${i.due ? '' : ' · nothing to send'}</span></span></li>`).join('')
      : '<li class="hint">Nothing today. Set a session time on Train to get the check-in and session reminders.</li>';
  }
  draw();
  // Keep the lists current when data arrives by sync or changes elsewhere (not the whole panel: no fighting a tap).
  let pending = null;
  ready.then((repo) => {
    draw.off = repo.onChange((cols) => {
      if (!cols.some((c) => ['days', 'settings', 'sessions', 'sets', 'tendons', 'programme', 'schedule', 'recovery'].includes(c))) return;
      clearTimeout(pending);
      pending = setTimeout(() => { listToday(); drawBackup(); }, 300);
    });
  });
  return draw;
}
