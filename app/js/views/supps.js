// SUPPLEMENTS (part of Fuel, its own screen; brief section 6 SUPPLEMENTS).
//   #/supps[/<date>]  the day's checklist by time of day: one tap = taken, or skipped with a reason (6.5)
//   #/supps/list      his list: add, edit, pause, remove (6.4)
// The app only tracks what he decides to take. It never recommends a supplement or a dose, and never changes his list.
import { ready } from '../lib/data.js';
import { isoDate, formatHm, formatDay, formatTime } from '../lib/time.js';
import { FOOD_TEXT, daysText, statusOn, stockStatus, lastsText, adherence, checklist, logEntry, dayKindFor, scheduledOn, logId, streak } from '../lib/supplements.js';
import { rotationDay, lastRotationSession, daysByDate, addDays } from '../lib/rotation.js';
import { actionSheet, promptText } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name);
const pct = (a) => (a.pct == null ? '—' : `${a.pct}%`);

/** One line of facts about a supplement: dose, rest-day dose, time, food, days. */
export function suppFacts(s) {
  return [s.dose, s.doseRest ? `rest days ${s.doseRest}` : '', s.time ? formatHm(s.time) : 'no time set', s.withFood ? FOOD_TEXT[s.withFood] : '', daysText(s.days)]
    .filter(Boolean).join(' · ');
}

function renderList(view, repo, alive) {
  const draw = async () => {
    const today = isoDate(new Date());
    const [all, log] = await Promise.all([repo.list('supplements'), repo.list('supp-log')]);
    if (!alive()) return;
    const by = (st) => all.filter((s) => statusOn(s, today) === st).sort(byOrder);
    const row = (s) => {
      const stock = stockStatus(s, log);
      const a7 = adherence(s, log, today, 7); const a30 = adherence(s, log, today, 30);
      return `<li><a class="lib-row supp-row" href="#/supp/${esc(s.id)}"><span class="lib-name">${esc(s.name)}</span>
        <span class="lib-meta">${esc(suppFacts(s))}</span>
        <span class="lib-meta">${stock ? `${stock.left} servings left · ${lastsText(stock.days)}${stock.low ? ' · <b class="c-amber">LOW</b>' : ''}` : 'Stock not tracked'} · 7 days ${pct(a7)} · 30 days ${pct(a30)}</span></a></li>`;
    };
    const active = by('active'); const paused = by('paused'); const removed = by('removed');
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/supps">Today</a><a class="pill is-on" href="#/supp/new">+ Add</a></div>
      <h1 class="view-title">My supplements</h1>
      <p class="hint">Your list, as you set it. Training HQ only tracks what you decide to take: it doesn't suggest supplements or doses.</p>
      <div class="section-label">Taking · ${active.length}</div>
      <ul class="lib-list">${active.map(row).join('') || '<li class="hint pad">Nothing on the list.</li>'}</ul>
      ${paused.length ? `<div class="section-label">Paused · ${paused.length}</div><ul class="lib-list">${paused.map(row).join('')}</ul>` : ''}
      ${removed.length ? `<details class="notes"><summary>Removed · ${removed.length}</summary><ul class="lib-list">${removed.map(row).join('')}</ul></details>` : ''}`;
  };
  draw();
  return repo.onChange((cols) => { if (cols.some((c) => ['supplements', 'supp-log'].includes(c))) draw(); });
}

const SKIP_REASONS = ['Day off', 'Ran out', 'Forgot it', 'Not today'];

/** Training or rest day for a date (magnesium's dose), from the rotation and the sessions. */
export async function dayKindOn(repo, date) {
  const [sessions, bridge, dayList] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days')]);
  const today = isoDate(new Date());
  const rot = rotationDay({ last: lastRotationSession(sessions, bridge), today: date > today ? date : today, days: daysByDate(dayList) });
  const workoutDates = new Set(sessions.filter((x) => x.kind !== 'holds' && x.status === 'done').map((x) => isoDate(new Date(x.startedAt))));
  return dayKindFor(date, { today, rotKind: rot.today.kind, workoutDates });
}

/** Mark one supplement taken or skipped on a date (also used by the Fuel card and, later, by voice). */
export async function answerSupp(repo, supp, date, status, reason = '') {
  const dayKind = await dayKindOn(repo, date);
  const e = logEntry({ supp, date, dayKind, status, reason });
  await repo.put('supp-log', e.id, e);
  return e;
}

function renderDay(view, repo, alive, dateParam) {
  const today = isoDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') && dateParam <= today ? dateParam : today;
  const draw = async () => {
    const [all, log, dayKind] = await Promise.all([repo.list('supplements'), repo.list('supp-log'), dayKindOn(repo, date)]);
    if (!alive()) return;
    const groups = checklist({ supps: all, log, date, dayKind });
    const due = groups.flatMap((g) => g.items);
    const taken = due.filter((i) => i.entry?.status === 'taken').length;
    const setup = all.filter((s) => scheduledOn(s, today) && (!s.time || !s.withFood || !s.stock));
    // Streak and adherence over every supplement on the list (each one's own is on My list).
    const st = streak({ supps: all, log, today });
    const sumOf = (n) => all.map((x) => adherence(x, log, today, n)).reduce((a, x) => ({ taken: a.taken + x.taken, scheduled: a.scheduled + x.scheduled }), { taken: 0, scheduled: 0 });
    const asPct = (x) => ({ pct: x.scheduled ? Math.round((x.taken / x.scheduled) * 100) : null });
    const a7 = asPct(sumOf(7)); const a30 = asPct(sumOf(30));
    const worstOne = all.filter((x) => statusOn(x, today) === 'active').map((x) => ({ x, a: adherence(x, log, today, 7) })).filter((y) => y.a.pct != null).sort((p, q) => p.a.pct - q.a.pct)[0];
    const worst = worstOne ? `${worstOne.x.short || worstOne.x.name} ${worstOne.a.pct}% this week` : '';
    const row = (i) => {
      const s = i.supp; const e = i.entry;
      const restDose = dayKind === 'rest' && s.doseRest;
      return `<div class="supp-item ${e ? `is-${e.status}` : ''}" data-id="${esc(s.id)}">
        <div class="supp-main"><b>${esc(s.name)}</b><span class="hint">${esc(i.dose)}${restDose ? ' · rest day' : s.doseRest ? ' · training day' : ''}${s.withFood ? ` · ${esc(FOOD_TEXT[s.withFood])}` : ''}</span>
          ${e?.status === 'skipped' ? `<span class="hint c-amber">Skipped${e.reason ? `: ${esc(e.reason)}` : ''}</span>` : ''}</div>
        ${e ? `<span class="supp-done"><span class="hud ${e.status === 'taken' ? 'c-green' : 'c-amber'}">${e.status === 'taken' ? `TAKEN ${esc(formatTime(new Date(e.at)))}` : 'SKIPPED'}</span>
          <button class="link-btn" type="button" data-undo>Undo</button></span>`
          : '<span class="supp-btns"><button class="btn-primary small" type="button" data-take>Taken</button><button class="btn-ghost small" type="button" data-skip>Skip</button></span>'}
      </div>`;
    };
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel">Fuel</a><a class="pill" href="#/supps/list">My list</a></div>
      <div class="fuel-head"><a class="pill" href="#/supps/${addDays(date, -1)}" aria-label="Day before">‹</a>
        <span class="hud c-muted">${date === today ? 'TODAY · ' : ''}${esc(formatDay(new Date(`${date}T12:00:00`)).toUpperCase())} · ${dayKind === 'rest' ? 'REST DAY' : 'TRAINING DAY'}</span>
        ${date < today ? `<a class="pill" href="#/supps/${addDays(date, 1)}" aria-label="Next day">›</a>` : '<span class="pill is-off" aria-hidden="true">›</span>'}</div>
      <h1 class="view-title">Supplements</h1>
      <section class="card pad-card supp-sum" id="s-sum"><div><span class="hud c-muted">TAKEN</span><b>${taken} of ${due.length}</b></div>
        <div><span class="hud c-muted">STREAK</span><b>${st.days} day${st.days === 1 ? '' : 's'}</b></div>
        <div><span class="hud c-muted">7 DAYS</span><b>${pct(a7)}</b></div><div><span class="hud c-muted">30 DAYS</span><b>${pct(a30)}</b></div>
        <p class="hint">Streak: days in a row with everything taken. 7 and 30 days: taken out of scheduled, from the first day you ticked anything${a7.pct == null ? '' : `; lowest: ${esc(worst)}`}.</p></section>
      ${date === today && setup.length ? `<section class="card pad-card confirm-card"><div class="hud c-amber">SET THEM UP (YOU SAID YOU'D ENTER THESE HERE)</div>
        <p class="hint c-text">Time, with food or not, and servings left are still missing on: ${setup.map((s) => `<a href="#/supp/${esc(s.id)}">${esc(s.short || s.name)}</a>`).join(', ')}.</p></section>` : ''}
      ${groups.map((g) => `<div class="section-label">${esc(g.label)}${g.time ? ` · ${formatHm(g.time)}` : ''}</div>
        <section class="card supp-group" data-group="${esc(g.key)}">${g.items.map(row).join('')}
          ${g.open.length > 1 ? `<button class="btn-ghost supp-all" type="button" data-all="${esc(g.key)}">All ${g.open.length} taken</button>` : ''}</section>`).join('')
        || '<p class="hint">Nothing scheduled on this day.</p>'}`;
    const find = (el) => due.find((i) => i.supp.id === el.closest('[data-id]').dataset.id);
    view.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => { await answerSupp(repo, find(b).supp, date, 'taken'); }));
    view.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', () => {
      const i = find(b);
      actionSheet(`Skip ${i.supp.name}? Why?`, [...SKIP_REASONS.map((r) => ({ label: r, run: () => answerSupp(repo, i.supp, date, 'skipped', r) })),
        { label: 'Other reason…', run: async () => { const r = await promptText('Why skip it?', '', { placeholder: 'reason' }); if (r !== null) answerSupp(repo, i.supp, date, 'skipped', r); } },
        { label: 'No reason', run: () => answerSupp(repo, i.supp, date, 'skipped', '') }]);
    }));
    view.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => { await repo.remove('supp-log', logId(date, find(b).supp.id)); }));
    view.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', async () => {
      const g = groups.find((x) => x.key === b.dataset.all);
      for (const i of g.open) await answerSupp(repo, i.supp, date, 'taken');
      toast(`${g.open.length} taken.`);
    }));
  };
  draw();
  let t = null;
  return repo.onChange((cols) => { if (cols.some((c) => ['supplements', 'supp-log', 'sessions', 'days'].includes(c))) { clearTimeout(t); t = setTimeout(draw, 60); } });
}

export function render(view, params) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  ready.then((repo) => {
    if (!alive) return;
    off = params[0] === 'list' ? renderList(view, repo, () => alive) : renderDay(view, repo, () => alive, params[0]);
  });
  return () => { alive = false; off(); };
}
