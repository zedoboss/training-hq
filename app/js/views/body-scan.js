// BODY > Body scan (brief section 6 BODY SCAN, decision 22): the Evolt 360 at his gym. Every 4 weeks, first thing at
// the gym before the workout, same conditions each time. The app proposes the date and he confirms it.
//   #/body/scan            the next scan (proposed or confirmed) and its reminders, the scanner's safety notice once,
//                          the preparation checklist he ticks, what the gym's staff said
//   #/body/scan/protocol   change the checklist (his gym's instructions win), dated
import { ready, saveSettings } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, formatDate, formatHm, formatTime, isoDate, deviceTimeZone } from '../lib/time.js';
import { addDays, lastRotationSession, daysByDate, LABEL } from '../lib/rotation.js';
import {
  EVERY_DAYS, PROTOCOL, WHEN, SAFETY_TEXT, SAFETY_ASK, STAFF_QUESTIONS, protocolOf, scanStatus, confirmDate, cancelDate,
  withTick, unticked, withProtocol, scanReminders, expectedOn, scanId,
} from '../lib/scans.js';
import { overlay, confirmSheet, promptLong, promptTime } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const savePlan = (repo, plan) => repo.put('scan-plan', 'main', { ...plan, id: 'main' });
const COLS = ['scan-plan', 'body-scans', 'days', 'sessions', 'settings'];
const REM_TEXT = { 'scan-alcohol': 'no alcohol from now', 'scan-eve': 'the preparation list', 'scan-arrive': 'at the gym, scan first' };

async function loadAll(repo) {
  const [planDoc, scans, sessions, bridge, dayList] = await Promise.all([
    repo.get('scan-plan', 'main'), repo.list('body-scans'), repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days'),
  ]);
  const days = daysByDate(dayList);
  return { plan: planDoc || {}, scans: scans.filter((s) => s?.date), last: lastRotationSession(sessions, bridge), days };
}

/** "Thursday 10/22 (Legs)" with the day type the rotation expects then, when it is a training day. */
function withType(iso, ctx, today) {
  const exp = expectedOn({ last: ctx.last, days: ctx.days, today, date: iso });
  return `${dayName(iso)}${exp?.kind === 'train' ? ` (${LABEL[exp.dayType]})` : exp?.kind === 'rest' ? ' (rest day)' : ''}`;
}

export function render(view, params = []) {
  if (params[0] === 'protocol') return protocolEditor(view);
  return home(view);
}

function home(view) {
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Body scan</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};

  const draw = async (repo) => {
    const ctx = await loadAll(repo);
    if (!alive) return;
    const { plan, scans } = ctx;
    const today = isoDate(new Date());
    const st = scanStatus({ plan, scans, today, last: ctx.last, days: ctx.days });
    const items = protocolOf(plan);
    const n = withDefaults(getState().settings).notify;
    const next = st.next;
    const rec = st.prep;
    // Ticks open from the day before the scan (the evening lines) to the day itself.
    const canTick = next && today >= addDays(next.date, -1);
    const open = next ? unticked(rec, items) : items;
    const hm = next ? ctx.days[next.date]?.sessionTime || null : null;
    const rem = next ? [-2, -1, 0].flatMap((k) => scanReminders({ date: addDays(next.date, k), tz: deviceTimeZone(), plan, scans, days: ctx.days, eveningHm: n.scanEvening })) : [];
    const remOn = n.kinds?.scan !== false;
    const p = st.proposal;
    const why = p.lastDate
      ? (p.shifted ? `4 weeks after your last scan (${dayName(p.lastDate)}) is ${dayName(p.base)}, a rest day in the rotation, so the next training day.` : `4 weeks after your last scan (${dayName(p.lastDate)}), the same weekday.`)
      : `Your first scan: the next training day${p.shifted ? ' (tomorrow is a rest day in the rotation)' : ''}.`;

    const tick = (i) => {
      const on = !!rec?.prep?.ticks?.[i.id];
      return canTick
        ? `<button class="sauna-tick ${on ? 'is-on' : ''}" type="button" data-tick="${esc(i.id)}" aria-pressed="${on}"><span>${esc(i.text)}</span><i class="sauna-box" aria-hidden="true">${on ? '✓' : ''}</i></button>`
        : `<div class="sauna-tick"><span>${esc(i.text)}</span><i class="sauna-box" aria-hidden="true"></i></div>`;
    };

    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body">Body</a></div>
      <h1 class="view-title">Body scan</h1>
      <p class="hint">Evolt 360 at your gym. Every ${EVERY_DAYS / 7} weeks, first thing at the gym before the workout, same conditions each time, so scans stay comparable.</p>
      ${plan.safety?.readAt ? '' : `<section class="card pad-card confirm-card" id="sc-safety"><div class="hud c-amber">BEFORE YOUR FIRST SCAN</div>
        <p class="c-text">${esc(SAFETY_TEXT)}</p><p class="c-text">${esc(SAFETY_ASK)}</p>
        <p class="hint">The app records that you've read it and gives no other medical advice.</p>
        <button class="btn-ghost" type="button" id="sc-read">I've read it</button></section>`}
      ${st.missed && !next ? `<p class="hint c-amber" id="sc-missed">Planned for ${esc(dayName(st.missed))}: no scan recorded.</p>` : ''}
      ${next ? `<section class="card pad-card scan-next" id="sc-next">
          <div class="hud c-cyan">NEXT SCAN${next.date === today ? ' · TODAY' : ''}</div>
          <b class="scan-big">${esc(withType(next.date, ctx, today))}</b>
          <span class="hint">First thing at the gym, before the workout. ${hm ? `Session time that day: ${formatHm(hm)}.` : "No session time set for that day yet: set it on Train the day before and the gym reminder comes then."}</span>
          ${st.onRest ? `<div class="card-note c-amber" id="sc-onrest"><span>The rotation now has a rest day on ${esc(dayName(next.date))}. The scan goes before a workout.</span>
            <button class="pill is-on" type="button" id="sc-shift">Move to ${esc(dayName(st.onRest.to))}</button></div>` : ''}
          <div class="scan-rem"><span class="hud c-muted">REMINDERS${remOn ? '' : ' · OFF IN SETTINGS'}</span>
            ${rem.filter((r) => r.at > Date.now()).map((r) => `<span class="hint">${esc(formatDay(new Date(r.at)))}, ${esc(formatTime(new Date(r.at)))}: ${esc(REM_TEXT[r.id.split(':')[0]])}</span>`).join('')}
            ${hm ? '' : '<span class="hint">On the day: at your session time, once you set it.</span>'}
            <button class="link-btn" type="button" id="sc-eve">Evening reminders at ${esc(formatHm(n.scanEvening))}: change</button></div>
          <div class="btn-row"><button class="btn-ghost" type="button" id="sc-pick">Change date</button><button class="btn-ghost" type="button" id="sc-cancel">Cancel this scan</button></div>
        </section>` : `<section class="card pad-card scan-next" id="sc-next">
          <div class="hud c-amber">PROPOSED NEXT SCAN</div>
          <b class="scan-big">${esc(withType(p.date, ctx, today))}</b>
          <span class="hint">${esc(why)} Confirm it, or pick another day.</span>
          <div class="btn-row"><button class="btn-primary" type="button" id="sc-confirm">Confirm</button><button class="btn-ghost" type="button" id="sc-pick">Pick another date</button></div>
        </section>`}

      <div class="section-label">Preparation · the same every time</div>
      <section class="card sauna-check" id="sc-check">
        ${WHEN.map(([w, label]) => { const list = items.filter((i) => (i.when === 'before' ? 'before' : 'day') === w); return list.length ? `<div class="hud c-muted scan-when">${esc(label.toUpperCase())}</div>${list.map(tick).join('')}` : ''; }).join('')}
      </section>
      <p class="hint" id="sc-check-line">${!next ? 'Tick these each time, from the day before the scan.'
        : !canTick ? `Tick these from ${esc(dayName(addDays(next.date, -1)))}.`
        : !open.length ? '<span class="c-green">All ticked. Scan first, then your workout.</span>'
        : `Not ticked: ${open.length}. A scan taken anyway is kept, marked as taken under different conditions.`}</p>
      <a class="link-btn" href="#/body/scan/protocol">Change the checklist (your gym's instructions win)</a>

      <div class="section-label">Your gym's instructions</div>
      <section class="card pad-card" id="sc-staff">
        ${(plan.staff || []).length ? (plan.staff || []).map((s) => `<p class="c-text">${esc(s.text)}</p><p class="hint">Recorded ${esc(formatDate(new Date(s.at)))}.</p>`).join('')
          : `<div class="hud c-amber">ASK THE STAFF ONCE</div><ul class="scan-q">${STAFF_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
            <p class="hint">Their instructions win over this starting checklist: change it to match.</p>`}
        <button class="btn-ghost" type="button" id="sc-staff-add">${(plan.staff || []).length ? 'Add to what they said' : 'Record what they said'}</button>
      </section>
      ${plan.safety?.readAt ? `<p class="hint">Scanner safety notice read ${esc(formatDate(new Date(plan.safety.readAt)))}.</p>` : ''}`;

    const $ = (s) => view.querySelector(s);
    $('#sc-read')?.addEventListener('click', async () => { await savePlan(repo, { ...plan, safety: { readAt: Date.now() } }); toast('Recorded: safety notice read.'); });
    $('#sc-confirm')?.addEventListener('click', async () => {
      await savePlan(repo, confirmDate(plan, p.date, { proposedDate: p.date }));
      toast(`Scan planned: ${dayName(p.date)}.`);
    });
    $('#sc-pick')?.addEventListener('click', () => pickDate(repo, ctx, plan, next?.date || p.date, p.date, today));
    $('#sc-cancel')?.addEventListener('click', async () => {
      if (!(await confirmSheet(`Cancel the scan on ${dayName(next.date)}? Its reminders stop; the app proposes a date again.`, { ok: 'Cancel the scan', danger: true }))) return;
      await savePlan(repo, cancelDate(plan));
    });
    $('#sc-shift')?.addEventListener('click', async () => {
      await savePlan(repo, confirmDate(plan, st.onRest.to, { proposedDate: st.onRest.to }));
      toast(`Scan moved to ${dayName(st.onRest.to)}.`);
    });
    $('#sc-eve')?.addEventListener('click', async () => {
      const v = await promptTime('Scan reminders, the evenings before', n.scanEvening);
      if (!v) return;
      await saveSettings({ notify: { scanEvening: v } });
      toast(`Evening reminders at ${formatHm(v)}.`);
    });
    view.querySelectorAll('[data-tick]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.tick;
      const cur = await repo.get('body-scans', scanId(next.date));
      await repo.put('body-scans', scanId(next.date), withTick(cur, next.date, items, id, !cur?.prep?.ticks?.[id]));
    }));
    $('#sc-staff-add').addEventListener('click', async () => {
      const t = await promptLong("What the gym's staff said", '', { placeholder: 'How to prepare; whether the results can be exported' });
      if (!t) return;
      await savePlan(repo, { ...plan, staff: [...(plan.staff || []), { at: Date.now(), text: t }] });
      toast('Recorded. Change the checklist to match if needed.');
    });
  };

  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => COLS.includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); };
}

/** A date of his choice; a rest day in the rotation asks first (the scan goes before a workout). */
function pickDate(repo, ctx, plan, value, proposed, today) {
  const { el, close } = overlay(`<form class="sheet-form"><label class="hud c-muted sheet-title" for="sc-date">SCAN DATE</label>
    <input class="input" type="date" id="sc-date" min="${today}" value="${esc(value)}" required>
    <p class="hint" id="sc-date-type"></p>
    <p class="hint">Proposed: ${esc(dayName(proposed))}. Same weekday and time of day each time keeps scans comparable.</p>
    <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Plan it</button></div></form>`);
  const input = el.querySelector('#sc-date');
  const show = () => { el.querySelector('#sc-date-type').textContent = input.value >= today ? withType(input.value, ctx, today) : ''; };
  input.addEventListener('input', show); show();
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = input.value;
    if (!date || date < today) { toast('Pick today or later.'); return; }
    close();
    const exp = expectedOn({ last: ctx.last, days: ctx.days, today, date });
    if (exp?.kind === 'rest' && !(await confirmSheet(`${dayName(date)} is a rest day in the rotation. The scan goes first thing at the gym, before a workout. Plan it anyway?`, { ok: 'Plan it' }))) return;
    await savePlan(repo, confirmDate(plan, date, { proposedDate: proposed }));
    toast(`Scan planned: ${dayName(date)}.`);
  });
}

/** The checklist, changed to his gym's instructions: text, the day before or on the day, add, remove; dated. */
function protocolEditor(view) {
  let alive = true; let rows = null; let repo = null; let plan = {};
  const draw = () => {
    if (!alive) return;
    const changes = plan.protocol?.changes || [];
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a></div>
      <h1 class="view-title">Preparation checklist</h1>
      <p class="hint">Started from general guidance published by gyms that use this scanner. Your gym's instructions win: change a line, add one or take one out. Every change is dated.</p>
      <form id="pr-form">
        <ul class="lib-list">${rows.map((r, i) => `<li class="lib-row scan-pr-row">
          <textarea class="input area" rows="2" data-text="${i}" maxlength="300" aria-label="Line ${i + 1}">${esc(r.text)}</textarea>
          <div class="btn-row"><select class="input mini" data-when="${i}" aria-label="When">${WHEN.map(([w, l]) => `<option value="${w}" ${(r.when === 'before' ? 'before' : 'day') === w ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <button class="link-btn c-red" type="button" data-del="${i}">Remove</button></div></li>`).join('')}</ul>
        <div class="btn-row"><button class="btn-ghost" type="button" id="pr-add">+ Line</button><button class="btn-ghost" type="button" id="pr-reset">Back to the starting list</button></div>
        <button class="btn-primary big" type="submit">Save</button>
      </form>
      ${changes.length ? `<div class="section-label">Changes</div><section class="card pad-card">${changes.map((c) => `<p class="hint">${esc(formatDate(new Date(c.at)))}: ${esc(c.note)}</p>`).join('')}</section>` : ''}`;
    const sync = () => view.querySelectorAll('[data-text]').forEach((t) => { rows[Number(t.dataset.text)].text = t.value; });
    view.querySelectorAll('[data-when]').forEach((s) => s.addEventListener('change', () => { rows[Number(s.dataset.when)].when = s.value; }));
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { sync(); rows.splice(Number(b.dataset.del), 1); draw(); }));
    view.querySelector('#pr-add').onclick = () => { sync(); rows.push({ id: `own-${Date.now().toString(36)}`, when: 'day', text: '' }); draw(); view.querySelector(`[data-text="${rows.length - 1}"]`)?.focus(); };
    view.querySelector('#pr-reset').onclick = () => { rows = PROTOCOL.map((x) => ({ ...x })); draw(); };
    view.querySelector('#pr-form').addEventListener('submit', async (e) => {
      e.preventDefault(); sync();
      if (!rows.some((r) => r.text.trim())) { toast('Keep at least one line.'); return; }
      const before = protocolOf(plan);
      const kept = rows.filter((r) => r.text.trim());
      const same = JSON.stringify(before.map((x) => [x.when, x.text])) === JSON.stringify(kept.map((x) => [x.when === 'before' ? 'before' : 'day', x.text.trim()]));
      if (!same) await repo.put('scan-plan', 'main', { ...withProtocol(plan, kept, noteFor(before, kept)), id: 'main' });
      toast(same ? 'No changes.' : 'Checklist saved.');
      location.hash = '#/body/scan';
    });
  };
  ready.then(async (r) => {
    repo = r;
    plan = (await repo.get('scan-plan', 'main')) || {};
    rows = protocolOf(plan).map((x) => ({ ...x }));
    draw();
  });
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a></div><p class="view-sub">Loading…</p>';
  return () => { alive = false; };
}

/** "Added 1, changed 2, removed 1" for the change log. */
function noteFor(before, after) {
  if (JSON.stringify(after.map((x) => [x.id, x.when, x.text.trim()])) === JSON.stringify(PROTOCOL.map((x) => [x.id, x.when, x.text]))) return 'Back to the starting list';
  const b = new Map(before.map((x) => [x.id, x])); const a = new Map(after.map((x) => [x.id, x]));
  const added = after.filter((x) => !b.has(x.id)).length;
  const removed = before.filter((x) => !a.has(x.id)).length;
  const changed = after.filter((x) => b.has(x.id) && (b.get(x.id).text !== x.text.trim() || (b.get(x.id).when === 'before') !== (x.when === 'before'))).length;
  const parts = [added && `added ${added}`, changed && `changed ${changed}`, removed && `removed ${removed}`].filter(Boolean);
  return parts.length ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())} line${added + changed + removed === 1 ? '' : 's'}` : 'Reordered';
}
