// BODY > Body scan (brief section 6 BODY SCAN, decision 22): the Evolt 360 at his gym. Every 4 weeks, first thing at
// the gym before the workout, same conditions each time. The app proposes the date and he confirms it.
//   #/body/scan            the next scan (proposed or confirmed) and its reminders, the scanner's safety notice once,
//                          the preparation checklist he ticks, what the gym's staff said
//   #/body/scan/protocol   change the checklist (his gym's instructions win), dated
//   #/body/scan/trends     each metric across scans, beside body weight and weekly training volume (one chart each,
//                          same dates); scans under different conditions flagged as not directly comparable
//   #/body/scan/r/<date>   a scan's results: photos of the results screen or printout read by Claude on the Mac (or typed
//                          in), every number as reported, checked by him; the conditions (time, fasted, trained before,
//                          checklist lines not ticked, anything unusual)
import { ready, saveSettings, syncNow } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, formatDate, formatHm, formatTime, isoDate, deviceTimeZone, hmOf, zonedTime, timeAt } from '../lib/time.js';
import { addDays, lastRotationSession, daysByDate, LABEL } from '../lib/rotation.js';
import {
  EVERY_DAYS, PROTOCOL, WHEN, SAFETY_TEXT, SAFETY_ASK, STAFF_QUESTIONS, protocolOf, scanStatus, confirmDate, cancelDate,
  withTick, unticked, withProtocol, scanReminders, expectedOn, scanId,
  METRICS, keyFor, cleanMetrics, mergeReads, conditionsFrom, withResults, metricValue, isDone, conditionNotes,
  metricsAvailable, scanSeries, latestChange,
} from '../lib/scans.js';
import { weightSeries, dailyWeights, withBodyweights, dailyWeightsOf } from '../lib/health.js';
import { setRows, weeklyVolume, weekStartOf } from '../lib/stats.js';
import { mergeLibrary } from '../lib/library.js';
import { toUnit } from '../lib/settings.js';
import { timeLine, columnChart, bindTips, bindCrosshair, tableView } from '../ui/charts.js';
import { fileToJpeg, newPhotoId } from '../lib/photos.js';
import { overlay, confirmSheet, promptLong, promptTime } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const savePlan = (repo, plan) => repo.put('scan-plan', 'main', { ...plan, id: 'main' });
const COLS = ['scan-plan', 'body-scans', 'scan-photos', 'days', 'sessions', 'settings'];
const REM_TEXT = { 'scan-alcohol': 'no alcohol from now', 'scan-eve': 'the preparation list', 'scan-arrive': 'at the gym, scan first' };

async function loadAll(repo) {
  const [planDoc, scans, sessions, bridge, dayList] = await Promise.all([
    repo.get('scan-plan', 'main'), repo.list('body-scans'), repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days'),
  ]);
  const days = daysByDate(dayList);
  const photoScans = (await repo.list('scan-photos')).map((p) => p.scanId);
  return { plan: planDoc || {}, scans: scans.filter((s) => s?.date), last: lastRotationSession(sessions, bridge), days, photoScans };
}

/** "Thursday 10/22 (Legs)" with the day type the rotation expects then, when it is a training day. */
function withType(iso, ctx, today) {
  const exp = expectedOn({ last: ctx.last, days: ctx.days, today, date: iso });
  return `${dayName(iso)}${exp?.kind === 'train' ? ` (${LABEL[exp.dayType]})` : exp?.kind === 'rest' ? ' (rest day)' : ''}`;
}

export function render(view, params = []) {
  if (params[0] === 'protocol') return protocolEditor(view);
  if (params[0] === 'trends') return trends(view, params[1] ? decodeURIComponent(params[1]) : null);
  if (params[0] === 'r' && /^\d{4}-\d{2}-\d{2}$/.test(params[1] || '')) return results(view, params[1]);
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
    const done = scans.filter(isDone).sort((a, b) => (a.date < b.date ? 1 : -1));
    const withPhotos = new Set(ctx.photoScans);
    const unsaved = scans.filter((x) => !isDone(x) && withPhotos.has(x.id));
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

      ${next && next.date === today ? `<a class="btn-primary center big" id="sc-results" href="#/body/scan/r/${today}">Scan done: add the results</a>` : ''}
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
      <div class="section-label">Scans · ${done.length}</div>
      ${unsaved.map((x) => `<a class="card confirm-card sauna-resume" href="#/body/scan/r/${esc(x.date)}"><span class="hud c-amber">RESULTS NOT SAVED</span><span>${esc(dayName(x.date))}: check and save</span></a>`).join('')}
      <ul class="lib-list" id="sc-history">${done.map((x) => { const notes = conditionNotes(x, items); const key = ['weightKg', 'fatPercent', 'muscleMassKg'].map((k) => [k, metricValue(x, k)]).filter(([, v]) => v != null);
        return `<li><a class="lib-row sc-hist" href="#/body/scan/r/${esc(x.date)}"><span class="lib-name">${esc(dayName(x.date))}${x.at ? `, ${esc(timeAt(x.at, x))}` : ''}</span>
          <span class="lib-meta">${key.map(([k, v]) => (k === 'weightKg' ? `${v} kg` : k === 'fatPercent' ? `${v}% fat` : `${v} kg muscle`)).join(' · ') || `${x.metrics.length} numbers`}</span>
          <span class="lib-meta ${notes.length ? 'c-amber' : 'c-green'}">${notes.length ? `Different conditions: ${esc(notes.join('; '))}` : 'Usual conditions'}</span></a></li>`; }).join('') || '<li class="hint pad">No scans yet.</li>'}</ul>
      ${done.length ? `<a class="card supp-card" href="#/body/scan/trends" id="sc-trends"><span class="hud c-cyan">TRENDS</span><span class="supp-card-line">${done.length > 1 ? 'Every number across your scans, beside body weight and training volume' : 'Changes show from your second scan'}</span><span class="pill is-on">Open</span></a>` : ''}
      <button class="btn-ghost" type="button" id="sc-other">Add the results of a scan</button>
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
    $('#sc-other').addEventListener('click', () => {
      const { el, close } = overlay(`<form class="sheet-form"><label class="hud c-muted sheet-title" for="sc-rdate">DAY OF THE SCAN</label>
        <input class="input" type="date" id="sc-rdate" max="${today}" value="${today}" required>
        <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Next</button></div></form>`);
      el.querySelector('[data-cancel]').onclick = () => close();
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const d = el.querySelector('#sc-rdate').value;
        if (!d || d > today) { toast('Today or earlier.'); return; }
        close();
        location.hash = `#/body/scan/r/${d}`;
      });
    });
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

/**
 * A scan's results (7.5). Photos of the results screen or printout go to the Mac, where Claude reads every number;
 * they appear here to check and correct, or he types them in. Saved as reported, with the conditions.
 */
function results(view, date) {
  let alive = true; let off = () => {}; let repo = null; let pollTimer = null; let pollStart = 0;
  let rows = null; let fromReads = false; let dirty = false; let cond = null; let hm = null; let usedAt = 0;
  const today = isoDate(new Date());

  const draw = async () => {
    const [rec, plan, photos, reads, dayDoc] = await Promise.all([
      repo.get('body-scans', scanId(date)), repo.get('scan-plan', 'main'), repo.list('scan-photos'), repo.list('scan-reads'), repo.get('days', date),
    ]);
    if (!alive) return;
    const items = protocolOf(plan || {});
    const mine = photos.filter((p) => p.scanId === scanId(date) && p.dataUrl).sort((a, b) => a.at - b.at);
    const readsOf = new Map(reads.map((r) => [r.photoId, r]));
    const myReads = mine.map((p) => readsOf.get(p.id)).filter((r) => r && (r.round ?? 0) >= (mine.find((p) => p.id === r.photoId)?.round ?? 0));
    const merged = mergeReads(myReads);
    // Rows: his saved numbers, else what the Mac read, else the usual ones to type in.
    if (!rows) {
      if (isDone(rec)) rows = rec.metrics.map((m) => ({ ...m }));
      else if (merged.length) { rows = merged.map((m) => ({ ...m })); fromReads = true; }
      else rows = METRICS.filter((m) => m.main).map((m) => ({ key: m.key, label: m.label, text: '', unit: m.unit }));
    } else if (!dirty && !isDone(rec) && merged.length && (!fromReads || merged.length !== rows.length)) {
      rows = merged.map((m) => ({ ...m })); fromReads = true;
    }
    if (!cond) cond = isDone(rec) ? { ...rec.conditions } : conditionsFrom(rec, items);
    if (hm == null) hm = rec?.at ? hmOf(new Date(rec.at)) : dayDoc?.sessionTime || (date === today ? hmOf(new Date()) : '');
    const st = getState();
    const offline = st.paired && st.mac?.reachable === false;
    const waiting = mine.filter((p) => { const r = readsOf.get(p.id); return !r || (r.round ?? 0) < (p.round ?? 0) || (r.status === 'failed' && (r.tries || 0) < 3); });
    const newerReads = merged.length && (isDone(rec) ? myReads.some((r) => r.status === 'done' && r.at > Math.max(rec.confirmedAt, usedAt)) : dirty);
    const photoLine = (p) => {
      const r = readsOf.get(p.id);
      if (r && (r.round ?? 0) >= (p.round ?? 0) && r.status === 'done') return `Read: ${r.metrics.length} numbers${r.metrics.some((m) => m.unsure) ? `, ${r.metrics.filter((m) => m.unsure).length} hard to read` : ''}${r.notes ? `. ${r.notes}` : ''}`;
      if (r && (r.round ?? 0) >= (p.round ?? 0) && r.status === 'failed') return `Not read${r.error ? `: ${r.error}` : ''}.${(r.tries || 0) >= 3 ? ' Ask again, or type the numbers in.' : ' Trying again in a few minutes.'}`;
      return offline ? 'Mac unreachable. The photo is kept on this phone and read as soon as the Mac is back.' : 'Sent to your Mac. Claude is reading it (about a minute).';
    };
    const sel = (name, val, opts) => `<span class="seg">${opts.map(([v, l]) => `<button class="pill ${val === v ? 'is-on' : ''}" type="button" data-${name}="${v}" aria-pressed="${val === v}">${esc(l)}</button>`).join('')}</span>`;

    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a><span class="hud c-muted">${esc(dayName(date).toUpperCase())}</span></div>
      <h1 class="view-title">Scan results</h1>
      <p class="hint">Photograph the results screen or printout: Claude on your Mac reads every number, you check them. Or type them in.</p>
      <section class="card pad-card" id="sr-photos"><div class="hud c-cyan">PHOTOS OF THE RESULTS</div>
        ${mine.map((p) => `<div class="sr-photo"><img src="${p.dataUrl}" alt="Results photo"><span class="hint ${readsOf.get(p.id)?.status === 'failed' || offline ? 'c-amber' : ''}">${esc(photoLine(p))}</span>
          <span class="btn-row"><button class="link-btn" type="button" data-again="${esc(p.id)}">Ask again</button><button class="link-btn c-red" type="button" data-rmphoto="${esc(p.id)}">Remove</button></span></div>`).join('')}
        <div class="btn-row"><label class="btn-primary center" for="sr-cam">Take photo</label><label class="btn-ghost center" for="sr-lib">From Photos</label></div>
      </section>
      ${newerReads ? `<section class="card pad-card confirm-card" id="sr-newer"><span class="c-text">The Mac read ${merged.length} numbers from your photo.</span><button class="btn-ghost" type="button" id="sr-use">Use them instead of what you typed</button></section>` : ''}
      <div class="section-label">Numbers · as the scanner reported them</div>
      ${fromReads && !isDone(rec) ? `<p class="hint">From your photo. Check each number against the screen${rows.some((r) => r.unsure) ? '; amber ones were hard to read' : ''}.</p>` : ''}
      <section class="card pad-card sr-rows" id="sr-rows">
        ${rows.map((r, i) => `<div class="sr-row ${r.unsure ? 'is-unsure' : ''}">
          <input class="input" data-label="${i}" value="${esc(r.label)}" aria-label="Name" maxlength="80">
          <input class="input num" data-text="${i}" value="${esc(r.text)}" inputmode="decimal" aria-label="${esc(r.label)} value" placeholder="—">
          <input class="input" data-unit="${i}" value="${esc(r.unit)}" aria-label="Unit" maxlength="16">
          <button class="icon-mini" type="button" data-rm="${i}" aria-label="Remove ${esc(r.label)}">×</button></div>`).join('')}
        <div class="btn-row"><button class="btn-ghost" type="button" id="sr-add">+ Another number</button><button class="btn-ghost" type="button" id="sr-more">+ Usual Evolt numbers</button></div>
      </section>
      <div class="section-label">Conditions</div>
      <section class="card pad-card sr-cond">
        <label class="opt"><span>Time of the scan</span><input class="input mini" type="time" id="sr-time" value="${esc(hm)}"></label>
        <div class="opt"><span>Fasted</span>${sel('fasted', cond.fasted, [[true, 'Yes'], [false, 'No']])}</div>
        <div class="opt"><span>Trained before the scan</span>${sel('trained', cond.trainedBefore, [[false, 'No'], [true, 'Yes']])}</div>
        <p class="hint" id="sr-ticks">${(() => { const open = unticked(rec, items); return open.length ? `Checklist, not ticked: ${esc(open.map((x) => x.text.replace(/\.$/, '')).join('; '))}. <a href="#/body/scan">Tick them</a> if you did them.` : 'Checklist: every line ticked.'; })()}</p>
        <label class="opt col"><span>Anything unusual</span><textarea class="input area" rows="2" id="sr-unusual" maxlength="300" placeholder="e.g. slept badly, ate late last night">${esc(cond.unusual || '')}</textarea></label>
      </section>
      <button class="btn-primary big" type="button" id="sr-save">${isDone(rec) ? 'Save changes' : 'Looks right: save'}</button>
      ${isDone(rec) ? `<p class="hint">Saved ${esc(formatDate(new Date(rec.confirmedAt)))}${rec.source === 'photo' ? ', read from your photo' : ''}.</p><button class="link-btn c-red" type="button" id="sr-del">Delete this scan</button>` : ''}`;

    const $ = (q) => view.querySelector(q);
    const keep = () => {
      view.querySelectorAll('[data-label]').forEach((x) => { const r = rows[Number(x.dataset.label)]; if (r.label !== x.value) { r.label = x.value; r.key = keyFor(x.value, r.unit) || (METRICS.find((m) => m.key === r.key)?.label === x.value ? r.key : null); } });
      view.querySelectorAll('[data-text]').forEach((x) => { rows[Number(x.dataset.text)].text = x.value.trim(); });
      view.querySelectorAll('[data-unit]').forEach((x) => { rows[Number(x.dataset.unit)].unit = x.value.trim(); });
      hm = $('#sr-time').value; cond.unusual = $('#sr-unusual').value.trim();
    };
    // Every keystroke goes into rows at once, so a redraw (a sync, a read arriving) never loses what he typed.
    view.querySelectorAll('[data-label], [data-text], [data-unit]').forEach((x) => x.addEventListener('input', () => {
      dirty = true; keep();
      const r = rows[Number(x.dataset.text ?? x.dataset.label ?? x.dataset.unit)];
      if (r && x.dataset.text != null) r.unsure = false;
    }));
    $('#sr-time').addEventListener('input', keep);
    $('#sr-unusual').addEventListener('input', keep);
    view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { keep(); dirty = true; rows.splice(Number(b.dataset.rm), 1); draw(); }));
    $('#sr-add').onclick = () => { keep(); dirty = true; rows.push({ key: null, label: '', text: '', unit: '' }); draw().then(() => view.querySelector(`[data-label="${rows.length - 1}"]`)?.focus()); };
    $('#sr-more').onclick = () => {
      keep(); dirty = true;
      const have = new Set(rows.map((r) => r.key).filter(Boolean));
      rows.push(...METRICS.filter((m) => !have.has(m.key)).map((m) => ({ key: m.key, label: m.label, text: '', unit: m.unit })));
      draw();
    };
    $('#sr-use')?.addEventListener('click', () => { rows = merged.map((m) => ({ ...m })); fromReads = true; dirty = false; usedAt = Math.max(...myReads.map((r) => r.at || 0)); draw(); });
    view.querySelectorAll('[data-fasted]').forEach((b) => b.addEventListener('click', () => { keep(); const v = b.dataset.fasted === 'true'; cond.fasted = cond.fasted === v ? null : v; draw(); }));
    view.querySelectorAll('[data-trained]').forEach((b) => b.addEventListener('click', () => { keep(); const v = b.dataset.trained === 'true'; cond.trainedBefore = cond.trainedBefore === v ? null : v; draw(); }));
    view.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', async () => {
      const p = mine.find((x) => x.id === b.dataset.again);
      const hint = await promptLong('Tell the Mac what to look out for (optional)', p.hint || '', { placeholder: 'e.g. the second column is last scan, ignore it', ok: 'Ask again' });
      if (hint == null) return;
      keep();
      await repo.put('scan-photos', p.id, { ...p, hint, round: (p.round || 0) + 1, askedAt: Date.now() });
      dirty = false; rows = isDone(rec) ? rows : null; fromReads = false;
      syncNow(); poll();
    }));
    view.querySelectorAll('[data-rmphoto]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmSheet('Remove this photo? Numbers already in the list stay.', { ok: 'Remove', danger: true }))) return;
      keep();
      await repo.remove('scan-photos', b.dataset.rmphoto);
    }));
    $('#sr-save').onclick = async () => {
      keep();
      const metrics = cleanMetrics(rows.filter((r) => r.label.trim() && r.text).map((r) => ({ key: r.key, label: r.label, text: r.text, unit: r.unit, unsure: false })));
      if (!metrics.length) { toast('Type at least one number, or take a photo of the results.'); return; }
      if (!/^\d{2}:\d{2}$/.test(hm)) { toast('Set the time of the scan.'); return; }
      const cur = await repo.get('body-scans', scanId(date));
      const conditions = { fasted: cond.fasted ?? null, trainedBefore: cond.trainedBefore ?? null, unusual: cond.unusual || '', unticked: unticked(cur, items).map((i) => i.id) };
      await repo.put('body-scans', scanId(date), withResults(cur, { date, at: zonedTime(date, hm), metrics, conditions, photos: mine.map((p) => p.id), source: fromReads && mine.length ? 'photo' : 'manual', note: cur?.note }));
      syncNow();
      toast(`Scan saved: ${metrics.length} numbers.`);
      location.hash = '#/body/scan';
    };
    $('#sr-del')?.addEventListener('click', async () => {
      if (!(await confirmSheet(`Delete the scan of ${dayName(date)}, its numbers and photos?`, { ok: 'Delete', danger: true }))) return;
      for (const p of mine) await repo.remove('scan-photos', p.id);
      await repo.remove('body-scans', scanId(date));
      location.hash = '#/body/scan';
    });
    if (waiting.length && !offline) poll(); else stopPoll();
  };

  // While the Mac reads a photo, pull every 3 s for up to 4 minutes.
  const stopPoll = () => { clearInterval(pollTimer); pollTimer = null; };
  const poll = () => {
    if (pollTimer) return;
    pollStart = Date.now();
    pollTimer = setInterval(() => { if (!alive || Date.now() - pollStart > 240000) stopPoll(); else syncNow(); }, 3000);
  };

  const addPhoto = async (file) => {
    if (!file) return;
    const dataUrl = await fileToJpeg(file, { max: 1600, quality: 0.85 });
    const id = newPhotoId();
    if (!(await repo.get('body-scans', scanId(date)))) await repo.put('body-scans', scanId(date), { id: scanId(date), date, status: 'prep', createdAt: Date.now() });
    await repo.put('scan-photos', id, { id, scanId: scanId(date), date, dataUrl, at: Date.now() });
    syncNow(); poll();
  };

  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a></div><h1 class="view-title">Scan results</h1><p class="view-sub">Loading…</p>';
  // The file inputs live outside the part that redraws, so a read arriving while the camera is open can't swap them out.
  const inputs = document.createElement('div');
  inputs.innerHTML = '<input type="file" accept="image/*" capture="environment" hidden id="sr-cam"><input type="file" accept="image/*" hidden id="sr-lib">';
  document.body.append(inputs);
  for (const inp of inputs.querySelectorAll('input')) inp.addEventListener('change', async () => { const f = inp.files?.[0]; inp.value = ''; await addPhoto(f); });

  // The Mac going away or coming back changes what the photo lines say.
  let net = null;
  const unsub = subscribe((st) => { const k = `${st.paired}|${st.mac?.reachable}`; if (k !== net) { const first = net === null; net = k; if (!first && alive && repo) draw(); } });
  ready.then((r) => {
    repo = r;
    // A change while he is typing waits until he leaves the field (redrawing would close the keyboard).
    let stale = false;
    view.addEventListener('focusout', () => setTimeout(() => { if (stale && alive && !view.contains(document.activeElement)) { stale = false; draw(); } }, 0));
    off = repo.onChange((cols) => {
      if (!cols.some((c) => ['body-scans', 'scan-photos', 'scan-reads', 'scan-plan'].includes(c))) return;
      const a = document.activeElement;
      if (a && view.contains(a) && a.matches('input, textarea')) { stale = true; return; }
      draw();
    });
    draw();
  });
  return () => { alive = false; off(); unsub(); stopPoll(); inputs.remove(); };
}

/**
 * Trends (7.6): one metric across scans, with body weight and weekly training volume over the same dates as separate
 * charts (never two scales on one chart). Scans under different conditions are hollow amber points with the reason in
 * the tooltip and the table. Changes are told as numbers; the app never judges or diagnoses.
 */
function trends(view, pick) {
  let alive = true; let off = () => {}; let untip = () => {}; let unx = [];
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a></div><h1 class="view-title">Scan trends</h1><p class="view-sub">Loading…</p>';
  const draw = async (repo) => {
    const [scans, plan, health, measurements, rawSessions, sets, exercises, daily] = await Promise.all([
      repo.list('body-scans'), repo.get('scan-plan', 'main'), repo.list('health'), repo.list('measurements'),
      repo.list('sessions'), repo.list('sets'), repo.list('exercises'), dailyWeightsOf(repo),
    ]);
    if (!alive) return;
    const items = protocolOf(plan || {});
    const st = withDefaults(getState().settings);
    const wu = st.units.weight;
    const today = isoDate(new Date());
    const done = scans.filter(isDone).sort((a, b) => (a.date < b.date ? -1 : 1));
    const avail = metricsAvailable(done);
    const id = avail.some((m) => m.id === pick) ? pick : (avail.find((m) => m.id === 'fatPercent') || avail[0])?.id;
    const metric = avail.find((m) => m.id === id);
    const series = id ? scanSeries(done, id, items) : [];
    const ch = latestChange(done, items);
    // Same dates for all three charts: from the start of the week 4 weeks before the first scan (at least 12 weeks
    // back) to today.
    const from0 = done.length ? [addDays(done[0].date, -28), addDays(today, -84)].sort()[0] : addDays(today, -84);
    const from = weekStartOf(from0, st.firstDayOfWeek);
    const t = (iso) => Date.parse(`${iso}T12:00:00`);
    const pts = series.map((p) => ({ t: t(p.date), value: p.value, flag: p.notes.length > 0, p }));
    const domain = [t(from), t(today)];
    const mChart = timeLine(pts, { label: `${metric?.label || 'Metric'} across scans`, fmt: (v) => String(v), domain });
    const weights = dailyWeights(weightSeries(health, measurements)).filter((w) => w.date >= from);
    const wPts = weights.map((w) => ({ t: t(w.date), value: toUnit(w.kg, wu), w }));
    const wChart = timeLine(wPts, { label: `Body weight in ${wu}`, fmt: (v) => String(v), domain });
    const lib = new Map(mergeLibrary(exercises, getState().equipment).map((e) => [e.id, e]));
    const rows = setRows({ sessions: withBodyweights(rawSessions, daily), sets, lib, countWarmups: st.warmup.countInStats });
    const nWeeks = Math.min(104, Math.floor((t(today) - t(from)) / (7 * 86400000)) + 1);
    const weeks = weeklyVolume(rows, { weeks: nWeeks, today, firstDay: st.firstDayOfWeek });
    const scanIn = (w) => done.filter((s) => s.date >= w.start && s.date < addDays(w.start, 7));
    const vItems = weeks.map((w) => ({ value: w.volume || null, axis: `${Number(w.start.slice(5, 7))}/${Number(w.start.slice(8, 10))}`,
      tip: `Week of ${dayName(w.start)}: ${w.volume ? `${Math.round(w.volume).toLocaleString('en-US')} kg, ${w.sets} sets` : 'no training'}${scanIn(w).length ? ` · scan ${scanIn(w).map((s) => dayName(s.date)).join(', ')}` : ''}` }));
    const kStep = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K`.replace('.0K', 'K') : String(Math.round(v)));
    const unitOf = (p) => p.unit || metric?.unit || '';
    const val = (p) => `${p.text}${unitOf(p) && unitOf(p) !== '%' ? ' ' : ''}${unitOf(p)}`;

    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/scan">Body scan</a></div>
      <h1 class="view-title">Scan trends</h1>
      ${!done.length ? '<p class="hint">No scans yet. Trends show once your first scan\'s results are in.</p>' : `
      <section class="card pad-card" id="tr-change">
        ${ch ? `<div class="hud c-muted">LATEST CHANGE · ${esc(dayName(ch.prev.date).toUpperCase())} TO ${esc(dayName(ch.cur.date).toUpperCase())} · ${Math.round(ch.days / 7 * 10) / 10} WEEKS</div>
          ${ch.lines.map((l) => `<p class="c-text tr-line">${esc(l.text)}</p>`).join('') || '<p class="hint">The two scans share none of the usual numbers.</p>'}
          ${ch.reasons.length ? `<p class="hint c-amber" id="tr-flag">Not directly comparable: ${esc(ch.reasons.join('; '))}. Part of the change may be water or timing, not real change.</p>` : '<p class="hint">Both scans taken under the usual conditions.</p>'}`
        : '<p class="hint">One scan so far. Changes show from your second scan.</p>'}
      </section>
      <div class="chips wrap" role="group" aria-label="Metric">${avail.map((m) => `<a class="chip ${m.id === id ? 'is-on' : ''}" href="#/body/scan/trends/${encodeURIComponent(m.id)}" aria-pressed="${m.id === id}">${esc(m.label)}</a>`).join('')}</div>
      <section class="card pad-card chart-card" id="tr-metric">
        <span class="hud c-muted">${esc((metric?.label || '').toUpperCase())}${metric?.unit ? ` (${esc(metric.unit.toUpperCase())})` : ''} · ${series.length} SCAN${series.length === 1 ? '' : 'S'}</span>
        <div class="chart-box" id="tr-mchart">${mChart.svg}</div>
        <p class="hint">${pts.some((p) => p.flag) ? 'Hollow amber point: taken under different conditions, not directly comparable. ' : ''}Numbers exactly as the scanner reported them.</p>
        ${tableView(['Scan', 'Value', 'Conditions'], [...series].reverse().map((p) => [dayName(p.date) + (p.at ? `, ${timeAt(p.at, p)}` : ''), val(p), p.notes.length ? `Different: ${p.notes.join('; ')}` : 'Usual']))}
      </section>
      <section class="card pad-card chart-card" id="tr-weight">
        <span class="hud c-muted">BODY WEIGHT (${wu.toUpperCase()}) · SAME DATES</span>
        <div class="chart-box" id="tr-wchart">${wChart.svg}</div>
        <p class="hint">Apple Health weigh-ins and your measurements, one per day. ${done.map((s) => dayName(s.date)).join(', ')}: scan${done.length === 1 ? '' : 's'}.</p>
        ${wPts.length ? tableView(['Day', `Weight (${wu})`], [...wPts].reverse().slice(0, 120).map((p) => [`${dayName(p.w.date)}${done.some((s) => s.date === p.w.date) ? ' (scan)' : ''}`, String(p.value)])) : ''}
      </section>
      <section class="card pad-card chart-card" id="tr-volume">
        <span class="hud c-muted">TRAINING VOLUME PER WEEK (KG) · SAME DATES</span>
        ${columnChart(vItems, { label: 'Training volume per week', fmt: kStep })}
        <p class="hint">Weight × reps of every working set, as on Statistics. Tap a week: its volume, and the scan in it.</p>
        ${tableView(['Week of', 'Volume (kg)', 'Sets', 'Scan'], [...weeks].reverse().map((w) => [dayName(w.start), w.volume ? Math.round(w.volume).toLocaleString('en-US') : '-', String(w.sets), scanIn(w).map((s) => dayName(s.date)).join(', ') || '']))}
      </section>`}`;
    unx.forEach((f) => f()); unx = [];
    const mBox = view.querySelector('#tr-mchart');
    if (mBox) unx.push(bindCrosshair(mBox, mChart, (q) => `${dayName(q.p.date)}: ${val(q.p)}${q.p.notes.length ? ` · different conditions: ${q.p.notes.join('; ')}` : ' · usual conditions'}`));
    const wBox = view.querySelector('#tr-wchart');
    if (wBox) unx.push(bindCrosshair(wBox, wChart, (q) => `${dayName(q.w.date)}: ${q.value} ${wu}${done.some((s) => s.date === q.w.date) ? ' · scan day' : ''}`));
  };
  untip = bindTips(view);
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => ['body-scans', 'scan-plan', 'health', 'measurements', 'sessions', 'sets'].includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); untip(); unx.forEach((f) => f()); };
}
