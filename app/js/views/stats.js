// STATISTICS (#/stats, #/stats/month/<YYYY-MM>) (2.18, P38, P41): the last 7 days on a body map, totals against the
// previous period, sets per muscle per week, muscle distribution, most-logged exercises, volume over time, and a
// monthly report, over Training HQ sessions and the imported Hevy and Strong history. Every chart has its numbers in
// text or a table too, so nothing depends on hover or colour.
import { ready } from '../lib/data.js';
import { mergeLibrary } from '../lib/library.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { isoDate, formatDay } from '../lib/time.js';
import { muscleLabel } from '../lib/exercise-types.js';
import { kg as fmtKg } from '../lib/loads.js';
import {
  setRows, PERIODS, periodRange, totals, distribution, weeklyMuscleSets, weeklyVolume, changePct, monthReport,
  monthOf, addMonths, addDays, muscleSets, topExercises, weekStartOf,
} from '../lib/stats.js';
import { bodyMap } from '../ui/body-map.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
let period = '4w';
let bodyWhen = '7d';

/** 1,284 · 12.9K · 1.2M */
export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Math.round(n).toLocaleString('en-US');
}
const hm = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const setsText = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function delta(now, before, what) {
  const pct = changePct(now, before);
  if (pct == null) return `<span class="c-faint">no ${esc(what)} to compare</span>`;
  return `<span class="c-muted">${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs ${esc(what)}</span>`;
}

function tiles(t, p, what) {
  return `<div class="stat-grid">
    <div class="card stat"><span class="hud c-muted">SESSIONS</span><b>${t.sessions}</b>${delta(t.sessions, p.sessions, what)}</div>
    <div class="card stat"><span class="hud c-muted">TIME</span><b>${hm(t.durationMs)}</b>${delta(t.durationMs, p.durationMs, what)}</div>
    <div class="card stat"><span class="hud c-muted">VOLUME · KG</span><b>${compact(t.volume)}</b>${delta(t.volume, p.volume, what)}</div>
    <div class="card stat"><span class="hud c-muted">SETS</span><b>${t.sets}</b>${delta(t.sets, p.sets, what)}</div>
  </div>`;
}

/** Heat steps for a value against the grid's maximum: 0 (none) .. 4 (most). */
const step = (v, max) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

/** Sets per muscle per week. Columns: weeks; for 12 months, months (average sets per week). */
function heatGrid(rows, { key, today, firstDay }) {
  let cols;
  if (key === '12m') {
    const first = addMonths(monthOf(today), -11);
    cols = Array.from({ length: 12 }, (_, i) => {
      const ym = addMonths(first, i);
      const from = `${ym}-01`;
      const to = `${addMonths(ym, 1)}-01`;
      const end = to > addDays(today, 1) ? addDays(today, 1) : to;
      const weeks = Math.max(1, (Date.parse(end) - Date.parse(from)) / (7 * 86400000));
      const m = muscleSets(rows.filter((r) => r.date >= from && r.date < to));
      for (const k of Object.keys(m)) m[k] = Math.round((m[k] / weeks) * 10) / 10;
      return { head: MONTHS[Number(ym.slice(5, 7)) - 1].slice(0, 3), tip: `${monthName(ym)}, average a week`, muscles: m };
    });
  } else {
    const n = key === '3m' ? 13 : 4;
    cols = weeklyMuscleSets(rows, { weeks: n, today, firstDay }).map((w) => ({ head: md(w.start), tip: `week of ${dayName(w.start)}`, muscles: w.muscles }));
  }
  const muscles = [...new Set(cols.flatMap((c) => Object.keys(c.muscles)))]
    .sort((a, b) => cols.reduce((s, c) => s + (c.muscles[b] || 0), 0) - cols.reduce((s, c) => s + (c.muscles[a] || 0), 0));
  if (!muscles.length) return '<p class="hint">No sets in this period.</p>';
  const max = Math.max(...cols.flatMap((c) => Object.values(c.muscles)));
  return `<div class="heat-wrap"><table class="heat" style="--cols:${cols.length}">
    <thead><tr><th scope="col"><span class="sr-only">Muscle</span></th>${cols.map((c) => `<th scope="col">${esc(c.head)}</th>`).join('')}</tr></thead>
    <tbody>${muscles.map((m) => `<tr><th scope="row">${esc(muscleLabel(m))}</th>${cols.map((c) => {
      const v = c.muscles[m] || 0;
      const tip = `${muscleLabel(m)}, ${c.tip}: ${setsText(v)} sets`;
      return `<td class="h${step(v, max)}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${v ? setsText(v) : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** This period (accent) against the previous one (grey), one row per muscle, values in text at the end. */
function distBars(list, names = { now: 'This period', before: 'Previous period' }) {
  const shown = list.filter((x) => x.now || x.before);
  if (!shown.length) return '<p class="hint">No sets in this period.</p>';
  const max = Math.max(...shown.map((x) => Math.max(x.now, x.before)));
  return `<div class="legend"><span><i class="key key-now"></i>${esc(names.now)}</span><span><i class="key key-before"></i>${esc(names.before)}</span></div>
    <ul class="dist">${shown.map((x) => {
      const tip = `${muscleLabel(x.muscle)}: ${setsText(x.now)} sets, ${names.before.toLowerCase()} ${setsText(x.before)}`;
      return `<li data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span class="dist-name">${esc(muscleLabel(x.muscle))}</span>
        <span class="dist-bars"><span class="bar-now" style="width:${(x.now / max) * 100}%"></span><span class="bar-before" style="width:${(x.before / max) * 100}%"></span></span>
        <span class="dist-val">${setsText(x.now)} <span class="c-faint">/ ${setsText(x.before)}</span></span></li>`;
    }).join('')}</ul>`;
}

/** Weekly volume columns. Single series: no legend; the latest and the highest week are labelled. */
function volumeChart(weeks) {
  const W = 340; const H = 170; const L = 36; const B = 22; const T = 16;
  const max = Math.max(...weeks.map((w) => w.volume));
  if (!max) return '<p class="hint">No volume in this period.</p>';
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p; return 10 * p; })();
  const slot = (W - L) / weeks.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const y = (v) => H - B - ((H - B - T) * v) / nice;
  const iMax = weeks.reduce((bi, w, i) => (w.volume > weeks[bi].volume ? i : bi), 0);
  const iLast = weeks.length - 1;
  const r = Math.min(4, bw / 2);
  const bars = weeks.map((w, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const top = y(w.volume);
    const h = H - B - top;
    const tip = `Week of ${dayName(w.start)}: ${w.volume.toLocaleString('en-US')} kg, ${w.sets} sets`;
    const path = h > 0 ? `<path d="M${x},${H - B} V${top + Math.min(r, h)} Q${x},${top} ${x + Math.min(r, h)},${top} H${x + bw - Math.min(r, h)} Q${x + bw},${top} ${x + bw},${top + Math.min(r, h)} V${H - B} Z" class="col"/>` : '';
    const label = (i === iMax || i === iLast) && w.volume ? `<text x="${x + bw / 2}" y="${top - 5}" text-anchor="middle" class="col-label">${compact(w.volume)}</text>` : '';
    return `<g data-tip="${esc(tip)}" aria-label="${esc(tip)}" role="img"><rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - B - T}" class="hit"/>${path}${label}</g>`;
  }).join('');
  const every = Math.ceil(weeks.length / 6);
  const xLabels = weeks.map((w, i) => (i % every === 0 || i === iLast) && (i === iLast || iLast - i >= every / 2)
    ? `<text x="${L + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" class="axis">${md(w.start)}</text>` : '').join('');
  const ticks = [0, nice / 2, nice].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${compact(v)}</text>`).join('');
  return `<svg class="vol-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Volume per week in kg">${ticks}${bars}${xLabels}</svg>
    <details class="notes"><summary>Show as a table</summary><table class="mini-table"><thead><tr><th>Week of</th><th>Volume (kg)</th><th>Sets</th></tr></thead>
      <tbody>${weeks.map((w) => `<tr><td>${esc(dayName(w.start))}</td><td>${w.volume.toLocaleString('en-US')}</td><td>${w.sets}</td></tr>`).join('')}</tbody></table></details>`;
}

function calendar(report, firstDay, today) {
  const trained = new Map();
  for (const s of report.sessions) trained.set(s.date, [...(trained.get(s.date) || []), s.title]);
  const first = report.from;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() - firstDay + 7) % 7;
  const days = [];
  for (let d = first; d < report.to; d = addDays(d, 1)) days.push(d);
  const heads = Array.from({ length: 7 }, (_, i) => DAY_LETTERS[(firstDay + i) % 7]);
  return `<div class="cal" role="grid" aria-label="${esc(monthName(report.month))}">
    ${heads.map((h) => `<span class="cal-head" aria-hidden="true">${h}</span>`).join('')}
    ${'<span></span>'.repeat(lead)}
    ${days.map((d) => {
      const t = trained.get(d);
      const tip = `${dayName(d)}: ${t ? t.join(', ') : 'no session'}`;
      return `<span class="cal-day ${t ? 'is-trained' : ''} ${d === today ? 'is-today' : ''}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${Number(d.slice(8))}</span>`;
    }).join('')}</div>`;
}

export function render(view, params = []) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  const mode = params[0] === 'month' ? 'month' : 'overview';
  let off = () => {};
  let tipEl = null;
  let alive = true;

  const draw = async (repo) => {
    const [sessions, sets, exercises, photos] = await Promise.all([repo.list('sessions'), repo.list('sets'), repo.list('exercises'), mode === 'month' ? repo.list('photos') : []]);
    if (!alive) return;
    const st = withDefaults(getState().settings);
    const lib = new Map(mergeLibrary(exercises, getState().equipment).map((e) => [e.id, e]));
    const rows = setRows({ sessions, sets, lib, countWarmups: st.warmup.countInStats });
    const today = isoDate(new Date());
    const firstDay = st.firstDayOfWeek;
    const head = `<div class="lib-head"><a class="pill" href="#/train">Back</a></div><h1 class="view-title">Statistics</h1>
      <nav class="seg" aria-label="Statistics"><a class="pill ${mode === 'overview' ? 'is-on' : ''}" href="#/stats">Overview</a><a class="pill ${mode === 'month' ? 'is-on' : ''}" href="#/stats/month">Monthly report</a></nav>`;
    const empty = !rows.length
      ? '<p class="hint">No finished sessions yet. These fill in as you log, or import your Hevy and Strong history (Settings > Import and export).</p>'
      : `<p class="hint">From every finished session: logged in Training HQ or imported from Hevy and Strong.${st.warmup.countInStats ? ' Warm-ups count as sets (Settings).' : ''}</p>`;

    if (mode === 'overview') {
      const p = periodRange(period, today);
      const what = `previous ${PERIODS[period].label}`;
      const vWeeks = Math.round(p.days / 7);
      // P38/P41: the last 7 days (or this week so far) on the body map.
      const bFrom = bodyWhen === 'week' ? weekStartOf(today, firstDay) : addDays(today, -6);
      const bTo = addDays(today, 1);
      const bWhat = bodyWhen === 'week' ? 'this week' : 'last 7 days';
      const bSessions = totals(sessions, rows, bFrom, bTo).sessions;
      const tops = topExercises(rows, p.from, p.to);
      view.innerHTML = `${head}
        <div class="section-label">${bodyWhen === 'week' ? 'This week' : 'Last 7 days'}</div>
        <div class="seg" role="group" aria-label="Body map period">${[['7d', 'Last 7 days'], ['week', 'This week']].map(([k, l]) => `<button class="pill ${k === bodyWhen ? 'is-on' : ''}" data-body="${k}" type="button" aria-pressed="${k === bodyWhen}">${l}</button>`).join('')}</div>
        <p class="hint">${bSessions} session${bSessions === 1 ? '' : 's'} ${bodyWhen === 'week' ? `since ${esc(dayName(bFrom))}` : `from ${esc(dayName(bFrom))} to today`}. Sets per muscle: brighter = more.</p>
        ${bodyMap(muscleSets(rows.filter((r) => r.date >= bFrom && r.date < bTo)), bWhat)}
        <div class="section-label">Period</div>
        <div class="seg" role="group" aria-label="Period">${Object.entries(PERIODS).map(([k, v]) => `<button class="pill ${k === period ? 'is-on' : ''}" data-period="${k}" type="button" aria-pressed="${k === period}">${v.label}</button>`).join('')}</div>
        ${empty}
        ${tiles(totals(sessions, rows, p.from, p.to), totals(sessions, rows, p.prevFrom, p.prevTo), what)}
        <div class="section-label">Sets per muscle · per week</div>
        <p class="hint">Main muscle counts 1 set, each helping muscle half a set.${period === '12m' ? ' By month: average sets a week.' : ''}</p>
        ${heatGrid(rows, { key: period, today, firstDay })}
        <div class="section-label">Muscle distribution</div>
        ${distBars(distribution(rows, p))}
        <div class="section-label">Most-logged exercises</div>
        ${tops.length ? `<ul class="best-list">${tops.map((e) => `<li><a class="best top-ex" href="#/exercise/${esc(e.exerciseId)}"><span>${esc(e.name)}<br><span class="c-faint">${e.sessions} session${e.sessions === 1 ? '' : 's'}</span></span><b>${e.sets} set${e.sets === 1 ? '' : 's'}</b></a></li>`).join('')}</ul>` : '<p class="hint">No sets in this period.</p>'}
        <div class="section-label">Volume per week · kg</div>
        ${volumeChart(weeklyVolume(rows, { weeks: vWeeks, today, firstDay }))}`;
      view.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { period = b.dataset.period; draw(repo); }));
      view.querySelectorAll('[data-body]').forEach((b) => b.addEventListener('click', () => { bodyWhen = b.dataset.body; draw(repo); }));
    } else {
      const month = /^\d{4}-\d{2}$/.test(params[1] || '') ? params[1] : monthOf(today);
      const r = monthReport({ sessions, rows, month });
      const prevName = monthName(addMonths(month, -1)).split(' ')[0];
      view.innerHTML = `${head}
        <div class="month-step"><a class="pill" href="#/stats/month/${addMonths(month, -1)}" aria-label="Previous month">‹</a>
          <h2 class="month-name">${esc(monthName(month))}</h2>
          ${month < monthOf(today) ? `<a class="pill" href="#/stats/month/${addMonths(month, 1)}" aria-label="Next month">›</a>` : '<span class="pill" aria-disabled="true">›</span>'}</div>
        ${empty}
        ${tiles(r.totals, r.previous, prevName)}
        ${calendar(r, firstDay, today)}
        <div class="section-label">Sessions · ${r.sessions.length}</div>
        ${r.sessions.length ? `<ul class="ex-list">${r.sessions.map((s) => `<li><a class="lib-row" href="#/finish/${esc(s.id)}"><span class="lib-name">${esc(s.title)}</span><span class="lib-meta">${esc(dayName(s.date))}</span></a></li>`).join('')}</ul>` : '<p class="hint">None this month.</p>'}
        <div class="section-label">Top exercises</div>
        ${r.topExercises.length ? `<ul class="best-list">${r.topExercises.map((e) => `<li class="best"><span>${esc(e.name)}</span><b>${e.sets} set${e.sets === 1 ? '' : 's'}</b></li>`).join('')}</ul>` : '<p class="hint">None this month.</p>'}
        <div class="section-label">Muscles vs ${esc(prevName)}</div>
        ${distBars(r.muscles, { now: monthName(month).split(' ')[0], before: prevName })}
        ${(() => {
          const ids = new Set(r.sessions.map((x) => x.id));
          const pics = photos.filter((ph) => ids.has(ph.sessionId)).sort((a, b) => a.at - b.at);
          return pics.length ? `<div class="section-label">Photos · ${pics.length}</div><div class="photo-grid">${pics.map((ph) => `<a class="photo" href="#/finish/${esc(ph.sessionId)}"><img src="${esc(ph.dataUrl)}" alt="Session photo" loading="lazy"></a>`).join('')}</div>` : '';
        })()}
        <div class="section-label">Bests this month</div>
        ${r.bests.length ? `<ul class="best-list">${r.bests.map((b) => `<li class="best"><span>${esc(b.name)}</span><b>${fmtKg(b.kg)} kg <span class="c-faint">was ${fmtKg(b.previous)}</span></b></li>`).join('')}</ul>` : '<p class="hint">No new bests this month. A best is your heaviest set of an exercise above everything logged before it.</p>'}`;
    }
  };

  // One tooltip for every chart: tap or hover a cell, bar or day. The same numbers are on screen or in a table.
  const showTip = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !view.contains(t)) { if (tipEl) tipEl.hidden = true; return; }
    tipEl ||= Object.assign(document.createElement('div'), { className: 'chart-tip', role: 'status' });
    if (!tipEl.isConnected) document.body.append(tipEl);
    tipEl.textContent = t.dataset.tip;
    tipEl.hidden = false;
    const r = t.getBoundingClientRect();
    tipEl.style.left = `${Math.min(window.innerWidth - tipEl.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tipEl.offsetWidth / 2))}px`;
    tipEl.style.top = `${Math.max(8, r.top - tipEl.offsetHeight - 8)}px`;
  };
  view.addEventListener('pointerover', showTip);
  view.addEventListener('pointerdown', showTip);
  const hideTip = () => { if (tipEl) tipEl.hidden = true; };
  view.addEventListener('pointerleave', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.includes('sessions') || cols.includes('sets')) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); tipEl?.remove(); window.removeEventListener('scroll', hideTip); };
}

