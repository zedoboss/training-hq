// SUPPLEMENTS (part of Fuel, its own screen; brief section 6 SUPPLEMENTS).
//   #/supps[/<date>]  the day's checklist by time of day: one tap = taken, or skipped with a reason (6.5)
//   #/supps/list      his list: add, edit, pause, remove (6.4)
//   #/supps/plan[/<id>]  restocking and "planning to get anything?" answers, and his considering list (6.7)
// The app only tracks what he decides to take. It never recommends a supplement or a dose, and never changes his list.
import { ready } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { isoDate, formatHm, formatDay, formatTime } from '../lib/time.js';
import { FOOD_TEXT, daysText, statusOn, stockStatus, lastsText, adherence, checklist, logEntry, dayKindFor, scheduledOn, logId, streak } from '../lib/supplements.js';
import { rotationDay, lastRotationSession, daysByDate, addDays } from '../lib/rotation.js';
import { actionSheet, promptText, promptLong, confirmSheet } from '../ui/sheet.js';
import { lowAnswered, weeklyAnsweredSince } from '../lib/fuel-reminders.js';
import { newId } from '../lib/routines.js';
import { formatDate } from '../lib/time.js';
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
    const [all, log, dayKind, answers] = await Promise.all([repo.list('supplements'), repo.list('supp-log'), dayKindOn(repo, date), repo.list('supp-answers')]);
    if (!alive()) return;
    const groups = checklist({ supps: all, log, date, dayKind });
    // Running low (about a week or less) and not answered for this count yet.
    const low = all.filter((x) => statusOn(x, today) === 'active').map((x) => ({ x, st: stockStatus(x, log) })).filter((y) => y.st?.low && !lowAnswered(y.x, answers));
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
        <div class="supp-main"><b>${esc(s.name)}</b><span class="hint">${esc(i.dose)}${restDose ? ' · rest day' : s.doseRest ? ' · training day' : ''}${s.withFood ? ` · ${esc(FOOD_TEXT[s.withFood])}` : ''}${(() => { const k = stockStatus(s, log); return k ? ` · <span class="${k.low ? 'c-amber' : ''}">${k.left} left</span>` : ''; })()}</span>
          ${e?.status === 'skipped' ? `<span class="hint c-amber">Skipped${e.reason ? `: ${esc(e.reason)}` : ''}</span>` : ''}</div>
        ${e ? `<span class="supp-done"><span class="hud ${e.status === 'taken' ? 'c-green' : 'c-amber'}">${e.status === 'taken' ? `TAKEN ${esc(formatTime(new Date(e.at)))}` : 'SKIPPED'}</span>
          <button class="link-btn" type="button" data-undo>Undo</button></span>`
          : '<span class="supp-btns"><button class="btn-primary small" type="button" data-take>Taken</button><button class="btn-ghost small" type="button" data-skip>Skip</button></span>'}
      </div>`;
    };
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel">Fuel</a><span class="btn-row tight" style="gap:6px"><a class="pill" href="#/supps/plan">Plan</a><a class="pill" href="#/supps/list">My list</a></span></div>
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
      ${date === today ? low.map(({ x, st: k }) => `<a class="card confirm-card supp-low" href="#/supps/plan/${esc(x.id)}"><span class="hud c-amber">RUNNING LOW</span>
        <span>${esc(x.short ? x.short.charAt(0).toUpperCase() + x.short.slice(1) : x.name)}: ${k.left} serving${k.left === 1 ? '' : 's'} left, ${esc(lastsText(k.days))}. Restocking?</span></a>`).join('') : ''}
      ${date === today && new Date(`${today}T12:00:00Z`).getUTCDay() === withDefaults(getState().settings).notify.suppPlanWeekday && !weeklyAnsweredSince(answers, addDays(today, -6))
        ? '<a class="card confirm-card supp-low" href="#/supps/plan"><span class="hud c-amber">THIS WEEK</span><span>Planning to get anything? Restock, or add something new?</span></a>' : ''}
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


const ANSWER_TEXT = { restock: 'Restocking', 'not-now': 'Not now', stop: 'Stopping it', nothing: 'Nothing this week', 'restock-some': 'Restocking', add: 'Adding something new' };

/** Restock questions, "planning to get anything?" and the considering list. Answers are kept; the list is never changed here. */
function renderPlan(view, repo, alive, suppId) {
  const draw = async () => {
    const today = isoDate(new Date());
    const [all, log, answers, considering] = await Promise.all([repo.list('supplements'), repo.list('supp-log'), repo.list('supp-answers'), repo.list('supp-considering')]);
    if (!alive()) return;
    const active = all.filter((x) => statusOn(x, today) === 'active').sort(byOrder);
    const lowOnes = active.map((x) => ({ x, st: stockStatus(x, log) })).filter((y) => y.st?.low);
    const asked = suppId ? all.find((x) => x.id === suppId) : null;
    const focus = asked ? [{ x: asked, st: stockStatus(asked, log) }] : [];
    const lowList = [...focus, ...lowOnes.filter((y) => y.x.id !== suppId)];
    const weeklyDone = answers.filter((a) => a.kind === 'weekly' && a.date >= addDays(today, -6)).sort((a, b) => b.at - a.at)[0];
    const recent = [...answers].sort((a, b) => b.at - a.at).slice(0, 8);
    const name = (id) => all.find((x) => x.id === id)?.name || 'a removed item';
    const open = considering.filter((c) => c.status === 'considering').sort((a, b) => a.addedOn.localeCompare(b.addedOn));
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/supps">Today</a><a class="pill" href="#/supps/list">My list</a></div>
      <h1 class="view-title">Restock and plans</h1>
      <p class="hint">Your answers are kept here. Nothing on your list changes unless you change it.</p>
      ${lowList.map(({ x, st }) => {
        const done = lowAnswered(x, answers);
        const a = answers.filter((y) => y.kind === 'low' && y.suppId === x.id && y.countedAt === x.stock?.countedAt).sort((p, q) => q.at - p.at)[0];
        return `<section class="card pad-card" data-low="${esc(x.id)}"><div class="hud ${st?.low ? 'c-amber' : 'c-muted'}">${st?.low ? 'RUNNING LOW' : 'STOCK'}</div>
          <p class="c-text">${esc(x.name)}: ${st ? `${st.left} serving${st.left === 1 ? '' : 's'} left, ${esc(lastsText(st.days))}.` : 'stock not tracked.'}${done ? '' : ' Restocking?'}</p>
          ${done ? `<p class="hint">Your answer, ${esc(formatDay(new Date(a.at)))}: ${esc(ANSWER_TEXT[a.answer] || a.answer)}${a.text ? ` (${esc(a.text)})` : ''}. When the new pack arrives, enter the count on <a href="#/supp/${esc(x.id)}">${esc(x.name)}</a>.</p>`
            : `<div class="btn-row"><button class="btn-primary small" data-ans="restock" type="button">Restocking</button><button class="btn-ghost small" data-ans="not-now" type="button">Not now</button><button class="btn-ghost small" data-ans="stop" type="button">Stopping it</button></div>`}
        </section>`;
      }).join('')}
      <section class="card pad-card" id="p-week"><div class="hud c-muted">THIS WEEK</div>
        <p class="c-text">Planning to get anything? Restock something, or add something new?</p>
        ${weeklyDone ? `<p class="hint">Answered ${esc(formatDay(new Date(weeklyDone.at)))}: ${esc(ANSWER_TEXT[weeklyDone.answer] || weeklyDone.answer)}${weeklyDone.text ? `: ${esc(weeklyDone.text)}` : ''}.</p>` : ''}
        <div class="btn-row"><button class="btn-ghost small" data-week="nothing" type="button">Nothing this week</button><button class="btn-ghost small" data-week="restock-some" type="button">Restock something</button>
          <button class="btn-ghost small" data-week="add" type="button">Something new</button></div></section>
      <div class="section-label">Considering · ${open.length}</div>
      <section class="card supp-group">${open.map((c) => `<div class="supp-item" data-c="${esc(c.id)}"><div class="supp-main"><b>${esc(c.name)}</b>
          <span class="hint">Since ${esc(formatDay(new Date(`${c.addedOn}T12:00:00`)))}${c.note ? ` · ${esc(c.note)}` : ''}</span></div>
          <span class="supp-btns"><a class="btn-ghost small center" href="#/supp/new?name=${encodeURIComponent(c.name)}&from=${encodeURIComponent(c.id)}">Got it</a><button class="btn-ghost small" type="button" data-drop>Not now</button></span></div>`).join('')
        || '<p class="hint pad">Nothing yet. Add what you might get; it stays here until you decide.</p>'}
        <button class="btn-ghost supp-all" type="button" id="p-add">+ Something I might get</button></section>
      ${recent.length ? `<details class="notes"><summary>Your answers</summary>${recent.map((a) => `<p class="hint">${esc(formatDate(new Date(a.at)))}: ${a.kind === 'low' ? `${esc(name(a.suppId))}, ` : 'this week, '}${esc(ANSWER_TEXT[a.answer] || a.answer)}${a.text ? ` (${esc(a.text)})` : ''}</p>`).join('')}</details>` : ''}`;
    const answer = (rec) => repo.put('supp-answers', rec.id, rec);
    view.querySelectorAll('[data-low] [data-ans]').forEach((b) => b.addEventListener('click', async () => {
      const x = all.find((y) => y.id === b.closest('[data-low]').dataset.low);
      const text = b.dataset.ans === 'stop' ? '' : '';
      await answer({ id: newId('ans'), kind: 'low', suppId: x.id, countedAt: x.stock?.countedAt ?? null, answer: b.dataset.ans, text, at: Date.now(), date: today });
      if (b.dataset.ans === 'stop') toast(`Noted. ${x.name} stays on your list until you remove it (My list).`);
      else toast('Noted.');
    }));
    view.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.week;
      let text = '';
      if (kind === 'restock-some') {
        text = await promptText('What are you restocking?', '', { placeholder: 'e.g. creatine, omega-3' });
        if (text === null) return;
      } else if (kind === 'add') {
        text = await promptText('What might you get?', '', { placeholder: 'name' });
        if (!text) return;
        await repo.put('supp-considering', newId('consider'), { id: newId('consider'), name: text, note: '', addedOn: today, status: 'considering' });
      }
      await answer({ id: newId('ans'), kind: 'weekly', answer: kind, text: text || '', at: Date.now(), date: today });
      toast('Noted.');
    }));
    view.querySelector('#p-add').onclick = async () => {
      const n = await promptText('Something you might get', '', { placeholder: 'name' });
      if (!n) return;
      const note = await promptLong('Why, or a note (optional)', '', { ok: 'Add' });
      const id = newId('consider');
      await repo.put('supp-considering', id, { id, name: n, note: note || '', addedOn: today, status: 'considering' });
    };
    view.querySelectorAll('[data-c] [data-drop]').forEach((b) => b.addEventListener('click', async () => {
      const c = considering.find((y) => y.id === b.closest('[data-c]').dataset.c);
      if (!(await confirmSheet(`Take ${c.name} off the considering list?`, { ok: 'Take off' }))) return;
      await repo.put('supp-considering', c.id, { ...c, status: 'dropped', droppedOn: today });
    }));
  };
  draw();
  return repo.onChange((cols) => { if (cols.some((c) => ['supplements', 'supp-log', 'supp-answers', 'supp-considering'].includes(c))) draw(); });
}

export function render(view, params) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  ready.then((repo) => {
    if (!alive) return;
    off = params[0] === 'list' ? renderList(view, repo, () => alive)
      : params[0] === 'plan' ? renderPlan(view, repo, () => alive, params[1])
        : renderDay(view, repo, () => alive, params[0]);
  });
  return () => { alive = false; off(); };
}
