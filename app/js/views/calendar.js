// CALENDAR (#/calendar, #/calendar/<YYYY-MM>, #/calendar/<YYYY-MM-DD>, #/calendar/year/<YYYY>, #/calendar/all) (3.7):
// month, year and all-years views of every finished session, imported years included. Days are coloured by day
// type; tapping a day shows its sessions set by set with links to open or edit them, or to log one after the fact.
import { ready } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { isoDate, formatDate, formatTime, timeAt, zoneOf } from '../lib/time.js';
import { addMonths, monthOf } from '../lib/stats.js';
import { elapsedMs } from '../lib/session.js';
import {
  dayMarks, workoutDates, weekStreak, restDaysSince, sessionsPerWeek, monthGrid, yearMonths, yearsList, dayColour, dayDetail, SOURCE_LABEL,
} from '../lib/calendar.js';
import { squatMarks } from '../lib/squat-log.js';
import { mealMarks } from '../lib/meals.js';
import { suppMarks } from '../lib/supplements.js';
import { saunaMarks } from '../lib/sauna.js';
import { scanMarks } from '../lib/scans.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const TYPE_LABEL = { pull: 'Pull', push: 'Push', legs: 'Legs', neck: 'Neck', other: 'Other' };
const longDay = (iso) => formatDate(new Date(`${iso}T12:00:00`));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/** What the URL asks for: {mode: 'month'|'year'|'all', month, year, day}. */
function parse(params, today) {
  const [a, b] = params;
  if (a === 'all') return { mode: 'all' };
  if (a === 'year') return { mode: 'year', year: /^\d{4}$/.test(b || '') ? b : today.slice(0, 4) };
  if (ISO_DAY.test(a || '')) return { mode: 'month', month: a.slice(0, 7), day: a };
  if (ISO_MONTH.test(a || '')) return { mode: 'month', month: a, day: null };
  return { mode: 'month', month: monthOf(today), day: today };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summaryTiles(marks, today, firstDay) {
  const dates = workoutDates(marks);
  const streak = weekStreak(dates, today, firstDay);
  const rest = restDaysSince(dates, today);
  const pw = sessionsPerWeek(marks, today, { firstDay });
  return `<div class="stat-grid cal-stats">
    <div class="card stat"><span class="hud c-muted">STREAK</span><b>${plural(streak.current, 'week')}</b><span class="c-faint">best ${plural(streak.best, 'week')}${streak.current && !streak.thisWeek ? ' · none yet this week' : ''}</span></div>
    <div class="card stat"><span class="hud c-muted">THIS WEEK</span><b>${plural(pw.thisWeek, 'session')}</b><span class="c-faint">${pw.average} a week over the ${pw.weeks} weeks before</span></div>
    <div class="card stat"><span class="hud c-muted">REST DAYS</span><b>${rest.days == null ? '-' : rest.days === 0 ? 'Trained today' : plural(rest.days, 'day')}</b><span class="c-faint">${rest.last ? `since ${esc(longDay(rest.last))}` : 'no sessions yet'}</span></div>
  </div>`;
}

function legend() {
  return `<div class="legend cal-legend">${['pull', 'push', 'legs', 'neck', 'other'].map((t) => `<span><i class="key cal-key t-${t}"></i>${TYPE_LABEL[t]}</span>`).join('')}
    <span><i class="key cal-key-holds"></i>Holds</span><span><i class="key cal-key-squat"></i>Squat Depth</span>
    <span><i class="key cal-key-meals"></i>Meals logged</span><span><i class="key cal-key-supps"></i>Supplements all taken</span><span><i class="key cal-key-sauna"></i>Sauna</span><span><i class="key cal-key-scan"></i>Body scan</span><span class="c-faint">No colour: rest day</span></div>`;
}

function dayTip(d, m) {
  const parts = [];
  for (const w of m?.workouts || []) parts.push(w.title);
  if (m?.holds.length) parts.push('tendon holds');
  for (const e of m?.extra || []) parts.push(e.label);
  return `${longDay(d)}: ${parts.length ? parts.join(', ') : 'rest day'}`;
}

function monthView(month, marks, { firstDay, today, day }) {
  const { lead, days } = monthGrid(month, firstDay);
  const heads = Array.from({ length: 7 }, (_, i) => DAY_LETTERS[(firstDay + i) % 7]);
  const next = addMonths(month, 1);
  return `<div class="month-step"><a class="pill" href="#/calendar/${addMonths(month, -1)}" aria-label="Previous month">‹</a>
      <h2 class="month-name"><a href="#/calendar/year/${month.slice(0, 4)}">${esc(monthName(month))}</a></h2>
      ${next <= monthOf(today) ? `<a class="pill" href="#/calendar/${next}" aria-label="Next month">›</a>` : '<span class="pill" aria-disabled="true">›</span>'}</div>
    <div class="cal cal-big" role="grid" aria-label="${esc(monthName(month))}">
      ${heads.map((h) => `<span class="cal-head" aria-hidden="true">${h}</span>`).join('')}
      ${'<span></span>'.repeat(lead)}
      ${days.map((d) => {
        const m = marks.get(d);
        const c = dayColour(m);
        const tip = dayTip(d, m);
        const many = (m?.workouts.length || 0) > 1;
        return `<button type="button" class="cal-day ${c ? `has t-${c}` : ''} ${d === today ? 'is-today' : ''} ${d === day ? 'is-sel' : ''} ${d > today ? 'is-future' : ''}" data-day="${d}" aria-label="${esc(tip)}" aria-pressed="${d === day}">
          <span class="cal-num">${Number(d.slice(8))}</span>
          ${m?.holds.length ? '<i class="cal-holds" aria-hidden="true"></i>' : ''}
          ${m?.extra.some((e) => e.kind === 'squat') ? '<i class="cal-squat" aria-hidden="true"></i>' : ''}
          ${m?.extra.some((e) => e.kind === 'meals') ? '<i class="cal-meals" aria-hidden="true"></i>' : ''}
          ${m?.extra.some((e) => e.kind === 'sauna') ? `<i class="cal-sauna ${m.extra.some((e) => e.kind === 'sauna' && e.symptoms) ? 'is-symptoms' : ''}" aria-hidden="true"></i>` : ''}
          ${m?.extra.some((e) => e.kind === 'scan') ? '<i class="cal-scan" aria-hidden="true"></i>' : ''}
          ${m?.extra.some((e) => e.kind === 'supps') ? `<i class="cal-supps ${m.extra.find((e) => e.kind === 'supps').all ? 'is-all' : ''}" aria-hidden="true"></i>` : ''}
          ${many ? `<i class="cal-more" aria-hidden="true">${m.workouts.length}</i>` : ''}
        </button>`;
      }).join('')}
    </div>
    ${legend()}`;
}

function yearView(year, marks, { firstDay, today }) {
  const months = yearMonths(marks, year);
  const total = months.reduce((n, m) => n + m.workouts, 0);
  const nextYear = String(Number(year) + 1);
  return `<div class="month-step"><a class="pill" href="#/calendar/year/${Number(year) - 1}" aria-label="Previous year">‹</a>
      <h2 class="month-name">${esc(year)} · ${plural(total, 'session')}</h2>
      ${nextYear <= today.slice(0, 4) ? `<a class="pill" href="#/calendar/year/${nextYear}" aria-label="Next year">›</a>` : '<span class="pill" aria-disabled="true">›</span>'}</div>
    <div class="year-grid">${months.map((mo) => {
      const { lead, days } = monthGrid(mo.month, firstDay);
      const label = `${monthName(mo.month)}: ${plural(mo.workouts, 'session')}`;
      return `<a class="year-month card" href="#/calendar/${mo.month}" aria-label="${esc(label)}">
        <span class="year-month-head"><span>${MONTHS[Number(mo.month.slice(5)) - 1].slice(0, 3)}</span><b class="c-amber">${mo.workouts || ''}</b></span>
        <span class="mini-cal" aria-hidden="true">${'<i class="pad"></i>'.repeat(lead)}${days.map((d) => {
          const c = dayColour(marks.get(d));
          return `<i class="${c ? `t-${c}` : ''} ${d === today ? 'is-today' : ''}"></i>`;
        }).join('')}</span></a>`;
    }).join('')}</div>
    ${legend()}`;
}

function allYearsView(marks) {
  const years = yearsList(marks);
  if (!years.length) return '<p class="hint">Nothing logged yet. Sessions you log or import show up here.</p>';
  const max = Math.max(1, ...years.flatMap((y) => y.months.map((m) => m.workouts)));
  return `<p class="hint">Sessions per month. Brighter = more sessions. Tap a year to open it.</p>
    <ul class="years-list">${years.map((y) => `<li><a class="card years-row" href="#/calendar/year/${y.year}">
      <span class="years-head"><b>${y.year}</b><span class="c-muted">${plural(y.workouts, 'session')}</span></span>
      <span class="years-months">${y.months.map((m) => {
        const tip = `${monthName(m.month)}: ${plural(m.workouts, 'session')}`;
        const lvl = m.workouts ? Math.min(4, Math.ceil((m.workouts / max) * 4)) : 0;
        return `<span class="h${lvl}" title="${esc(tip)}" aria-label="${esc(tip)}">${m.workouts || ''}</span>`;
      }).join('')}</span>
      <span class="years-letters" aria-hidden="true">${MONTHS.map((n) => `<span>${n[0]}</span>`).join('')}</span></a></li>`).join('')}</ul>`;
}

function dayPanel(day, marks, ctx, today) {
  if (!day) return '';
  const m = marks.get(day);
  const detail = dayDetail(m, ctx.byId, ctx.setsBySession);
  const extra = m?.extra || [];
  return `<section class="day-panel" aria-live="polite">
    <div class="section-label">${esc(longDay(day))}</div>
    ${detail.length || extra.length ? (!m?.workouts.length && day < today ? '<p class="hint">Rest day.</p>' : '') : `<p class="hint">${day > today ? 'Nothing planned here yet.' : day === today ? 'Nothing logged yet today.' : 'Rest day. Nothing logged.'}</p>`}
    ${detail.map(({ session: s, source, exercises, working, holds: held }) => {
      const holds = s.kind === 'holds';
      const c = holds ? 'holds' : (s.dayType || 'other');
      const mins = s.endedAt ? Math.round(elapsedMs(s) / 60000) : null;
      return `<article class="card day-sess">
        <div class="day-sess-head"><i class="dot t-${c}"></i><b>${esc(s.title)}</b><span class="tag">${esc((SOURCE_LABEL[source] || source).toUpperCase())}</span></div>
        <div class="hint">${esc(s.endedAt ? formatTime(new Date(s.startedAt), zoneOf(s)) : timeAt(s.startedAt, s))}${s.endedAt ? ` - ${esc(timeAt(s.endedAt, s))}` : ''}${mins != null ? ` · ${mins} min` : ''} · ${holds ? plural(held, 'hold') : `${plural(working, 'set')}${held ? ` + ${plural(held, 'hold')}` : ''}`}</div>
        ${exercises.map((e) => `<div class="day-ex"><div class="day-ex-name">${esc(e.name)}${e.importedName ? ` <span class="c-faint">(${esc(e.importedName)} in ${esc(SOURCE_LABEL[source] || source)})</span>` : ''}</div>
          <div class="day-sets">${e.sets.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>`).join('')}
        ${s.note ? `<p class="hint">Note: ${esc(s.note)}</p>` : ''}
        <div class="btn-row">${holds ? '' : `<a class="btn-ghost center" href="#/finish/${esc(s.id)}/c/${day}">Open</a>`}<a class="btn-ghost center" href="#/session/${esc(s.id)}/edit">Edit</a></div>
      </article>`;
    }).join('')}
    ${extra.filter((e) => e.kind === 'squat').map((e) => {
      const r = ctx.squatsById?.get(e.id);
      return `<a class="card day-squat" href="#/squat"><span class="hud c-green">SQUAT DEPTH</span><span>${esc(e.label.replace(/^Squat Depth /, ''))}</span>
        ${r ? `<span class="hud sq-reps">${r.reps.map((x) => `<span class="${x.good ? 'c-green' : 'c-red'}">${Math.round(x.minDeg)}°</span>`).join(' ')}</span>` : ''}</a>`;
    }).join('')}
    ${extra.filter((e) => e.kind === 'meals').map((e) => `<a class="card day-squat" href="#/fuel/${day}"><span class="hud c-green">MEALS</span><span>${esc(e.label.replace(/^Meals: /, ''))}</span></a>`).join('')}
    ${extra.filter((e) => e.kind === 'supps').map((e) => `<a class="card day-squat" href="#/supps/${day}"><span class="hud c-amber">SUPPLEMENTS</span><span>${esc(e.label.replace(/^Supplements: /, ''))}</span></a>`).join('')}
    ${extra.filter((e) => e.kind === 'sauna').map((e) => `<a class="card day-squat" href="#/sauna"><span class="hud ${e.symptoms ? 'c-red' : 'c-cyan'}">SAUNA</span><span>${esc(e.label.replace(/^Sauna: /, ''))}</span></a>`).join('')}
    ${extra.filter((e) => e.kind === 'scan').map((e) => `<a class="card day-squat" href="#/body/scan/r/${day}"><span class="hud c-cyan">BODY SCAN</span><span>${esc(e.label.replace(/^Body scan:? ?/, '') || 'Results')}</span></a>`).join('')}
    ${extra.filter((e) => !['squat', 'meals', 'supps', 'sauna', 'scan'].includes(e.kind)).map((e) => `<p class="hint">${esc(e.label)}</p>`).join('')}
    ${day <= today ? `<a class="btn-ghost center" href="#/session/start/empty/${day}">${day === today ? 'Start an empty session' : 'Log a session on this day'}</a>` : ''}
  </section>`;
}

export function render(view, params = []) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true;
  let off = () => {};
  let ctx = null;
  let route = null;

  const load = async (repo) => {
    const [sessions, sets, squats, meals, estimates, supps, suppLog, saunas, scans] = await Promise.all([repo.list('sessions'), repo.list('sets'), repo.list('squats'),
      repo.list('meals'), repo.list('meal-estimates'), repo.list('supplements'), repo.list('supp-log'), repo.list('sauna'), repo.list('body-scans')]);
    const setsBySession = new Map();
    for (const x of sets) {
      if (!setsBySession.has(x.sessionId)) setsBySession.set(x.sessionId, []);
      setsBySession.get(x.sessionId).push(x);
    }
    return { marks: dayMarks({ sessions, sets, extra: [...squatMarks(squats), ...mealMarks(meals, estimates), ...suppMarks(supps, suppLog), ...saunaMarks(saunas), ...scanMarks(scans)] }), byId: new Map(sessions.map((s) => [s.id, s])), setsBySession, squatsById: new Map(squats.map((r) => [r.id, r])) };
  };

  const draw = () => {
    if (!alive || !ctx) return;
    const today = isoDate(new Date());
    const firstDay = withDefaults(getState().settings).firstDayOfWeek;
    route ||= parse(params, today);
    const { mode } = route;
    const seg = `<nav class="seg" aria-label="Calendar view">
      <a class="pill ${mode === 'month' ? 'is-on' : ''}" href="#/calendar/${route.month || monthOf(today)}">Month</a>
      <a class="pill ${mode === 'year' ? 'is-on' : ''}" href="#/calendar/year/${route.year || (route.month || today).slice(0, 4)}">Year</a>
      <a class="pill ${mode === 'all' ? 'is-on' : ''}" href="#/calendar/all">All years</a></nav>`;
    const body = mode === 'all' ? allYearsView(ctx.marks)
      : mode === 'year' ? yearView(route.year, ctx.marks, { firstDay, today })
        : monthView(route.month, ctx.marks, { firstDay, today, day: route.day });
    view.innerHTML = `<div class="lib-head"><a class="pill" href="#/train">Back</a><a class="pill" href="#/history">History</a>
        <label class="jump"><span class="hud c-muted">GO TO</span><input class="input" type="date" id="cal-jump" max="${today}" value="${route.day || today}" aria-label="Go to a date"></label></div>
      <h1 class="view-title">Calendar</h1>
      ${summaryTiles(ctx.marks, today, firstDay)}
      ${seg}
      ${body}
      <div id="day-panel">${mode === 'month' ? dayPanel(route.day, ctx.marks, ctx, today) : ''}</div>`;

    view.querySelector('#cal-jump').addEventListener('change', (e) => {
      const v = e.target.value;
      if (ISO_DAY.test(v)) location.hash = `#/calendar/${v}`;
    });
    view.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      route = { ...route, day: b.dataset.day };
      history.replaceState(null, '', `#/calendar/${b.dataset.day}`);
      view.querySelector('#cal-jump').value = b.dataset.day;
      view.querySelectorAll('[data-day]').forEach((x) => { x.classList.toggle('is-sel', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      view.querySelector('#day-panel').innerHTML = dayPanel(route.day, ctx.marks, ctx, today);
      view.querySelector('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  };

  ready.then(async (repo) => {
    ctx = await load(repo);
    draw();
    off = repo.onChange(async (cols) => {
      if (!cols.some((c) => ['sessions', 'sets', 'squats', 'meals', 'meal-estimates', 'supplements', 'supp-log', 'sauna', 'body-scans'].includes(c))) return;
      ctx = await load(repo);
      const y = window.scrollY;
      draw();
      window.scrollTo(0, y);
    });
  });
  return () => { alive = false; off(); };
}
