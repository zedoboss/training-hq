// HISTORY (#/history) (3.8): every finished session, newest first, grouped by month, with the app it came from
// (Training HQ, Hevy or Strong). Search by exercise; filter by app. Tap a session to open it.
import { withBodyweights, dailyWeightsOf } from '../lib/health.js';
import { ready } from '../lib/data.js';
import { formatDate, formatTime } from '../lib/time.js';
import { SOURCE_LABEL } from '../lib/calendar.js';
import { sessionRows, filterRows, byMonth, sourceCounts } from '../lib/session-list.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const PAGE = 80;
// Kept while the app is open, so going into a session and back keeps the search.
const state = { q: '', source: null, shown: PAGE };

const mins = (ms) => (ms == null ? '' : `${Math.round(ms / 60000)} min`);

function row(r) {
  return `<li><a class="lib-row hist-row" href="#/finish/${esc(r.id)}/h">
    <span class="hist-title"><i class="dot t-${esc(r.dayType || 'other')}"></i><span class="lib-name">${esc(r.title)}</span></span>
    <span class="lib-meta">${esc(formatDate(new Date(r.startedAt)))} · ${esc(formatTime(new Date(r.startedAt)))}${r.durationMs != null ? ` · ${mins(r.durationMs)}` : ''} · ${r.sets} set${r.sets === 1 ? '' : 's'} · ${r.volume.toLocaleString('en-US')} kg</span>
    ${r.hits ? `<span class="hist-hits">${r.hits.map((h) => esc(h)).join(' · ')}</span>` : ''}
    <span class="tag">${esc((SOURCE_LABEL[r.source] || r.source).toUpperCase())}</span>
  </a></li>`;
}

export function render(view) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let rows = [];
  let off = () => {};
  let alive = true;

  const drawList = () => {
    const list = filterRows(rows, state);
    const groups = byMonth(list.slice(0, state.shown));
    view.querySelector('#h-count').textContent = `${list.length.toLocaleString('en-US')} SESSION${list.length === 1 ? '' : 'S'}`;
    view.querySelector('#h-list').innerHTML = groups.map((g) => `
      <div class="section-label">${esc(monthName(g.month))}</div>
      <ul class="ex-list">${g.rows.map(row).join('')}</ul>`).join('')
      || `<p class="hint">${state.q ? `No session has an exercise matching "${esc(state.q)}".` : 'No finished sessions yet.'}</p>`;
    const more = view.querySelector('#h-more');
    more.hidden = list.length <= state.shown;
    more.textContent = `Show more (${(list.length - state.shown).toLocaleString('en-US')} left)`;
    view.querySelectorAll('[data-src]').forEach((b) => {
      const on = (b.dataset.src || null) === state.source;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };

  const draw = () => {
    const counts = sourceCounts(rows);
    const chips = [[null, 'All', counts.all], ...['training-hq', 'hevy', 'strong'].filter((k) => counts[k]).map((k) => [k, SOURCE_LABEL[k], counts[k]])];
    view.innerHTML = `<div class="lib-head"><a class="pill" href="#/train">Back</a><a class="pill" href="#/calendar">Calendar</a></div>
      <h1 class="view-title">History</h1>
      <input class="input" id="h-q" type="search" placeholder="Search by exercise, e.g. squat" value="${esc(state.q)}" autocomplete="off" aria-label="Search by exercise">
      <div class="chips wrap" role="group" aria-label="App">${chips.map(([k, label, n]) => `<button class="pill" type="button" data-src="${k || ''}">${esc(label)} · ${n}</button>`).join('')}</div>
      <div class="hud c-muted" id="h-count"></div>
      <div id="h-list"></div>
      <button class="btn-ghost" id="h-more" type="button" hidden>Show more</button>`;
    view.querySelector('#h-q').addEventListener('input', (e) => { state.q = e.target.value; state.shown = PAGE; drawList(); });
    view.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { state.source = b.dataset.src || null; state.shown = PAGE; drawList(); }));
    view.querySelector('#h-more').addEventListener('click', () => { state.shown += PAGE * 2; drawList(); });
    drawList();
  };

  const load = async (repo) => {
    const [rawSessions, sets, daily] = await Promise.all([repo.list('sessions'), repo.list('sets'), dailyWeightsOf(repo)]);
    const sessions = withBodyweights(rawSessions, daily);
    rows = sessionRows({ sessions, sets });
  };

  ready.then(async (repo) => {
    await load(repo);
    if (!alive) return;
    draw();
    off = repo.onChange(async (cols) => {
      if (!cols.includes('sessions') && !cols.includes('sets')) return;
      await load(repo);
      if (alive) drawList();
    });
  });
  return () => { alive = false; off(); };
}
