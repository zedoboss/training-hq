// BODY > Apple Health (#/body/health, 7.1): how the iPhone Shortcut gets steps, sleep, weight and workouts to the Mac
// (brief section 7: the Shortcut saves a file to iCloud Drive, an automation runs it morning and evening, the Mac reads
// the folder), what arrived last, and buttons to run the Shortcut now, ask the Mac to look, or send a file by hand.
import { ready, scanHealth, uploadHealth } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { formatDay, formatTime } from '../lib/time.js';
import { toast } from '../ui/toast.js';

export const SHORTCUT_NAME = 'Training HQ Health';
export const runShortcutUrl = (name = SHORTCUT_NAME) => `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (ms) => `${formatDay(new Date(ms))}, ${formatTime(new Date(ms))}`;
const shortDay = (iso, year = false) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}${year ? `/${iso.slice(0, 4)}` : ''}`;

// The line each Text action writes. Words in capitals are replaced by the Shortcut's variables.
export const LINES = {
  steps: '{"type":"steps","value":"VALUE","unit":"UNIT","start":"START","end":"END","source":"SOURCE"}',
  sleep: '{"type":"sleep","value":"VALUE","start":"START","end":"END","source":"SOURCE"}',
  weight: '{"type":"weight","value":"VALUE","unit":"UNIT","start":"START","source":"SOURCE"}',
  workout: '{"type":"workout","activity":"TYPE","start":"START","end":"END","duration":"DURATION","kcal":"ENERGY","distance":"DISTANCE","source":"SOURCE"}',
  export: '{"type":"export","at":"NOW"}',
};

const codeLine = (key) => `<div class="hk-code"><code>${esc(LINES[key])}</code><button class="btn-ghost small" type="button" data-copy="${key}">Copy</button></div>`;

/** The walkthrough, in his words: what to tap in the Shortcuts app. */
function steps() {
  const block = (n, title, find, key, vars) => `<li><b>${title}.</b> ${find}
    Then add <b>Repeat with Each</b> (it takes the samples). Inside the repeat add <b>Text</b>, paste this line, and replace each word in capitals with ${vars}:${codeLine(key)}</li>`;
  return `
    <ol class="hk-steps">
      <li>Open <b>Shortcuts</b>, tap <b>+</b>, and name the new shortcut <b>${SHORTCUT_NAME}</b> (exactly, so the Update button finds it).</li>
      ${block('1', 'Steps', 'Add <b>Find Health Samples</b>. Type: <b>Steps</b>. Add the filter <b>Start Date is in the last 30 days</b>. Group By: <b>Day</b> (if your phone has no Group By, leave it: the Mac adds the samples up). Sort by Start Date, Oldest First, no limit.', 'steps', 'the Repeat Item\'s Value, Unit, Start Date, End Date and Source')}
      ${block('2', 'Sleep', 'Add <b>Find Health Samples</b>. Type: <b>Sleep</b> (Sleep Analysis). Filter <b>Start Date is in the last 8 days</b>. No grouping.', 'sleep', 'Value, Start Date, End Date and Source')}
      ${block('3', 'Weight', 'Add <b>Find Health Samples</b>. Type: <b>Weight</b>. Filter <b>Start Date is in the last 400 days</b> (so your weight history comes over once and stays).', 'weight', 'Value, Unit, Start Date and Source')}
      ${block('4', 'Workouts (if your phone has it)', 'Add <b>Find Workouts</b>. Filter <b>Start Date is in the last 30 days</b>.', 'workout', 'the workout\'s Type, Start Date, End Date, Duration, Active Energy, Distance and Source (leave out any your phone doesn\'t offer; the Mac works out minutes from start and end)')}
      <li><b>How to replace a word.</b> Select the word (for example VALUE, keep the quote marks around it), tap <b>Repeat Item</b> in the bar above the keyboard, then tap the blue Repeat Item bubble and pick the detail (Value, Unit, Start Date ...). For <b>Start Date</b> and <b>End Date</b> also set <b>Date Format: ISO 8601</b> with the time included.</li>
      <li><b>One file.</b> After the last repeat add one more <b>Text</b>. First line: paste this and replace NOW with <b>Current Date</b> (Date Format ISO 8601):${codeLine('export')}
        Then, each on its own line below it, the <b>Repeat Results</b> of each repeat (steps, sleep, weight, workouts).</li>
      <li>Add <b>Save File</b>: save that Text to <b>Shortcuts</b>. Turn off <b>Ask Where to Save</b>. Subpath: <code>Training HQ/health.json</code>. Turn on <b>Overwrite If File Exists</b>.</li>
      <li>Tap <b>▶</b> to run it once. Allow Health access for Steps, Sleep, Weight and Workouts, and allow saving to iCloud Drive. Within about 5 minutes the card above says what the Mac read.</li>
    </ol>
    <div class="section-label">Run it by itself, twice a day</div>
    <ol class="hk-steps">
      <li>Shortcuts &gt; <b>Automation</b> &gt; <b>+</b> &gt; <b>Time of Day</b>: <b>7:30 AM</b>, Daily. Choose <b>Run Immediately</b> and turn off Notify When Run. Next: pick <b>${SHORTCUT_NAME}</b>. Done.</li>
      <li>The same again for <b>7:30 PM</b>. (The same times as your hold reminders, when the phone is usually in your hand.)</li>
    </ol>
    <div class="section-label">What it can't do</div>
    <ul class="hk-steps">
      <li>The iPhone keeps Health locked while the phone is locked, so a run at a moment it is locked may save nothing. Nothing is lost: every run covers days back (sleep 8 days, steps 30, weight 400), and <b>Update now</b> above runs it while you hold the phone.</li>
      <li>It goes one way: Training HQ reads Health; it can't write your workouts into Health.</li>
      <li>The Mac only reads the file. It never changes or deletes anything in iCloud Drive.</li>
    </ul>`;
}

export function render(view) {
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/body">Back</a></div>
    <h1 class="view-title">Apple Health</h1>
    <p class="view-sub">Steps, sleep, weight and workouts come from a Shortcut on your iPhone. It saves a file to iCloud Drive; your Mac reads it and the numbers arrive here.</p>
    <section class="card pad-card" id="hk-status"><p class="hint">Loading…</p></section>
    <div class="hk-actions">
      <a class="btn-primary center" id="hk-run" href="${runShortcutUrl()}">Update now</a>
      <button class="btn-ghost" id="hk-scan" type="button">Check the Mac</button>
    </div>
    <label class="link-btn file-btn" for="hk-file">Send a Health file by hand instead</label>
    <input id="hk-file" type="file" accept=".json,.jsonl,.txt,application/json,text/plain" hidden>
    <div class="section-label">Make the Shortcut (once, about 10 minutes)</div>
    <section class="card pad-card hk-guide">${steps()}</section>`;

  const box = view.querySelector('#hk-status');
  let alive = true; let repo; let off = () => {};
  const draw = async () => {
    const st = await repo.get('health-meta', 'status');
    const docs = await repo.list('health');
    if (!alive) return;
    const s = getState();
    const lines = [];
    if (!s.paired) lines.push('<p class="hint c-amber">Pair with your Mac first (Settings).</p>');
    if (!st) lines.push('<p class="hint">Nothing from your iPhone yet. Make the Shortcut below and run it once.</p>');
    else {
      if (st.error) lines.push(`<p class="hint c-amber">${esc(st.error)}</p>`);
      if (st.folderFound === false) lines.push('<p class="hint">The Mac doesn\'t see the folder <b>iCloud Drive &gt; Shortcuts &gt; Training HQ</b> yet. It appears after the Shortcut\'s first run (iCloud can take a few minutes).</p>');
      const l = st.last;
      if (l) {
        const types = Object.entries(l.types || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
        lines.push(`<dl class="kv hk-kv">
          <dt>Last file</dt><dd>${esc(l.name)}${l.from === 'phone' ? ' (sent from this phone)' : ''}</dd>
          <dt>Made</dt><dd>${esc(when(l.at))}</dd>
          <dt>Read by the Mac</dt><dd>${esc(when(l.readAt))}</dd>
          <dt>Samples</dt><dd>${l.samples}${types ? ` <span class="c-faint">(${esc(types)})</span>` : ''}</dd>
          ${l.range ? `<dt>Days</dt><dd>${shortDay(l.range[0], l.range[0].slice(0, 4) !== l.range[1].slice(0, 4))} to ${shortDay(l.range[1], l.range[0].slice(0, 4) !== l.range[1].slice(0, 4))} · ${l.changed} updated</dd>` : ''}
          ${l.bad ? `<dt>Not read</dt><dd class="c-amber">${l.bad} line${l.bad === 1 ? '' : 's'}</dd>` : ''}</dl>`);
        if (l.bad && !l.samples) lines.push('<p class="hint c-amber">Nothing in the file could be read. Check that each Text line is pasted exactly, with the variables inside the quote marks.</p>');
      }
    }
    lines.push(`<p class="hint">${docs.length ? `${docs.length} day${docs.length === 1 ? '' : 's'} of Health data on this phone.` : 'No Health days on this phone yet.'}</p>`);
    box.innerHTML = `<span class="hud c-cyan">FROM YOUR IPHONE</span>${lines.join('')}`;
  };

  // Update now opens Shortcuts; when he comes back, ask the Mac to look for the new file.
  let ranAt = 0;
  view.querySelector('#hk-run').addEventListener('click', () => { ranAt = Date.now(); });
  const back = async () => {
    if (document.visibilityState !== 'visible' || !ranAt || Date.now() - ranAt > 10 * 60000) return;
    ranAt = 0;
    toast('Asking the Mac for the new file…');
    // iCloud needs a moment to bring the file to the Mac.
    for (const wait of [3000, 15000, 40000]) {
      await new Promise((r) => setTimeout(r, wait));
      if (!alive) return;
      try { const out = await scanHealth(); if (out.last && Date.now() - out.last.readAt < 70000) { toast(`The Mac read ${out.last.samples} samples.`); return; } } catch (e) { toast(e.message); return; }
    }
    toast('No new file on the Mac yet. iCloud can take a few minutes; it is read as soon as it arrives.');
  };
  document.addEventListener('visibilitychange', back);
  view.querySelector('#hk-scan').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const out = await scanHealth(); toast(out.error || (out.folderFound === false ? 'The Mac doesn\'t see the folder yet.' : out.last ? `Last file read ${formatTime(new Date(out.last.readAt))}.` : 'The folder is there but has no file yet.')); }
    catch (err) { toast(err.message); } finally { e.target.disabled = false; }
  });
  view.querySelector('#hk-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { const out = await uploadHealth(await f.text(), f.name); toast(`The Mac read ${out.samples} samples from ${f.name}.`); } catch (err) { toast(err.message); }
  });
  view.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(LINES[b.dataset.copy]); toast('Copied. Paste it into the Text action.'); } catch { toast('Copy did not work here: select the line and copy it.'); }
  }));
  let paired = getState().paired;
  const unsub = subscribe((st) => { if (st.paired !== paired) { paired = st.paired; if (alive && repo) draw(); } });
  ready.then((r) => { repo = r; off = repo.onChange((cols) => { if (cols.includes('health-meta') || cols.includes('health')) draw(); }); draw(); });
  return () => { alive = false; off(); unsub(); document.removeEventListener('visibilitychange', back); };
}
