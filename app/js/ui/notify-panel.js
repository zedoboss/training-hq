// Settings > Notifications: turn push on for this device (from a tap), send a test, turn it off.
import { getState } from '../lib/store.js';
import { ready, saveSettings } from '../lib/data.js';
import { withDefaults } from '../lib/settings.js';
import { KINDS, remindersFor, reminderState } from '../lib/reminders.js';
import { isoDate, formatTime, formatDay } from '../lib/time.js';
import { fixedReminders, shortcutPayload, shortcutUrl, icsFor, icsName } from '../lib/backup-reminders.js';
import { pushSupported, isStandalone, permission, currentSubscription, enablePush, disablePush, testPush, pushStatus } from '../lib/push.js';
import { toast } from './toast.js';

const isPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadState() {
  const repo = await ready;
  const [sessions, sets, tendons, bridge, settings, meta, days, neck, meals, mealChecks, supplements, suppLog, suppAnswers, sauna, saunaPlan, scans, scanPlan] = await Promise.all([
    repo.list('sessions'), repo.list('sets'), repo.list('tendons'), repo.get('bridge', 'last-loads'), repo.get('settings', 'main'),
    repo.get('programme', 'meta'), repo.list('days'), repo.get('schedule', 'neck'), repo.list('meals'), repo.list('meal-checks'),
    repo.list('supplements'), repo.list('supp-log'), repo.list('supp-answers'), repo.list('sauna'), repo.get('sauna-plan', 'main'), repo.list('body-scans'), repo.get('scan-plan', 'main'),
  ]);
  return reminderState({ sessions, sets, tendons, bridge, settings, meta, days, neck, meals, mealChecks, supplements, suppLog, suppAnswers, sauna, saunaPlan, scans, scanPlan });
}

/** Today's reminders worked out on this device, the same way the Mac does. */
export async function todaysReminders(date = isoDate(new Date())) {
  return remindersFor({ ...(await loadState()), date });
}

const SHORTCUT_STEPS = [
  'Open the Shortcuts app, tap +, and name the new shortcut exactly: Training HQ Reminders.',
  'If the top of the editor says "Receive ... input from ...", set it to receive Text.',
  'Add the action "Get Dictionary from Input" (input: Shortcut Input).',
  'Optional, to replace old ones: add "Find Reminders" where List is Training HQ and Is Completed is off, then "Remove Reminders" (switch off "Confirm Before Removing" if it is shown).',
  'Add "Get Dictionary Value": Get Value for "items" in Dictionary.',
  'Add "Repeat with Each" item in Dictionary Value.',
  'Inside the repeat: "Get Dictionary Value" for "due" in Repeat Item, then "Get Dates from Input" (input: that Dictionary Value).',
  'Still inside: "Add New Reminder": the title is Repeat Item\'s "title" (tap the variable, choose Repeat Item, then key title), list Training HQ (create the list in Reminders first), turn on "Remind Me" At Time with Dates, notes = Repeat Item\'s "notes".',
  'Done. Back in Training HQ, tap "Send to Reminders": Shortcuts opens, runs, and the reminders appear in the Training HQ list.',
];

function backupHtml(items) {
  const first = items[0]; const last = items[items.length - 1];
  return `<div class="hud c-muted rem-head">BACKUP REMINDERS ON THIS IPHONE</div>
    <section class="card pad-card" id="backup">
      <p class="hint c-text">If your Mac is off or offline, notifications stop. This puts the next 7 days' fixed reminders (check-ins and sessions you set a time for, tendon holds) into the iPhone's own Reminders or Calendar, so they ring anyway. Do it again after you change a time.</p>
      <p class="hint" id="backup-count">${items.length ? `${items.length} reminders, ${esc(formatDay(new Date(first.at)))} to ${esc(formatDay(new Date(last.at)))}.` : 'Nothing to add for the next 7 days.'}</p>
      <div class="btn-row"><button class="btn-primary" id="bk-shortcut" type="button" ${items.length ? '' : 'disabled'}>Send to Reminders</button>
        <button class="btn-ghost" id="bk-ics" type="button" ${items.length ? '' : 'disabled'}>Calendar file</button></div>
      <details class="bk-steps"><summary>Make the Shortcut once (about 3 minutes)</summary>
        <ol>${SHORTCUT_STEPS.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        <p class="hint">"Calendar file" needs no Shortcut: it opens the calendar file; tap Add All. Re-adding can make doubles; delete the old ones in Calendar first.</p>
      </details>
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
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    box.querySelector('#bk-shortcut').onclick = () => {
      saveSettings({ notify: { backupSentOn: today } });
      location.href = shortcutUrl(shortcutPayload(items, tz));
    };
    box.querySelector('#bk-ics').onclick = () => {
      const blob = new Blob([icsFor(items)], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = icsName(today);
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      saveSettings({ notify: { backupSentOn: today } });
    };
  }

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
  // Keep the lists current when data arrives by sync or changes elsewhere (not the whole panel: no fighting a tap).
  let pending = null;
  ready.then((repo) => {
    draw.off = repo.onChange((cols) => {
      if (!cols.some((c) => ['days', 'settings', 'sessions', 'sets', 'tendons', 'programme', 'schedule'].includes(c))) return;
      clearTimeout(pending);
      pending = setTimeout(() => { listToday(); drawBackup(); }, 300);
    });
  });
  return draw;
}
