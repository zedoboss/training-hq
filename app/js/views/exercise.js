// EXERCISE page: muscles and equipment, demo slot, pinned note; charts, records and every session of this exercise
// over the full history (Training HQ, Hevy and Strong) (3.9, P35-P37, P45, P47).
import { withBodyweights, dailyWeightsOf } from '../lib/health.js';
import { ready } from '../lib/data.js';
import { mergeLibrary, duplicateExercise, exerciseUsed, routinesUsing } from '../lib/library.js';
import { buildHistory } from '../lib/history.js';
import { actionSheet, confirmSheet, promptLong } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { demoPanel } from '../ui/demo-panel.js';
import { TYPES, SET_TYPES, muscleLabel } from '../lib/exercise-types.js';
import { formatDay, formatDate, isoDate } from '../lib/time.js';
import { kg } from '../lib/loads.js';
import { getState } from '../lib/store.js';
import { SOURCE_LABEL } from '../lib/calendar.js';
import { metricsFor, sessionPoints, inRange, records, repRecords, clockText, E1RM_MAX_REPS, family } from '../lib/records.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const longDay = (iso) => formatDate(new Date(`${iso}T12:00:00`));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RANGES = [['3m', '3 months'], ['1y', '1 year'], ['all', 'All']];
const SET_OF = { heaviest: 'heaviestSet', e1rm: 'e1rmSet', bestSet: 'bestSetSet', mostReps: 'mostRepsSet', longest: 'longestSet', pace: 'paceSet' };
const HISTORY_PAGE = 40;

export function setText(s) {
  const t = s.hold ? 'H' : SET_TYPES[s.type]?.short || '';
  const load = s.kg != null ? kg(s.kg) : 'BW';
  const amount = s.hold ? `${s.durationS ?? 30}s` : s.reps != null ? `× ${s.reps}` : s.durationS != null ? `${s.durationS}s` : '';
  return `${t ? `<b class="st">${t}</b> ` : ''}${load} ${amount}`;
}

/** A metric value in words: "45 kg", "12 reps", "1:30", "5.2 km", "4:40 /km". */
function valueText(unit, v) {
  if (v == null) return '-';
  if (unit === 'kg') return `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`;
  if (unit === 'reps') return `${v} rep${v === 1 ? '' : 's'}`;
  if (unit === 's') return clockText(v);
  if (unit === 'km') return `${v} km`;
  if (unit === 'pace') return `${clockText(v)} /km`;
  return String(v);
}
const plainSet = (s) => (s ? `${s.kg != null ? `${kg(s.kg)} kg` : 'BW'}${s.reps != null ? ` × ${s.reps}` : ''}${s.durationS != null && s.reps == null ? ` · ${clockText(s.durationS)}` : ''}` : '');
const compact = (n) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000)}K` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n * 10) / 10));

/**
 * Line chart of one metric per session, oldest to newest along real time. Single series: no legend, the chips name
 * it. The latest and the best point are labelled; the rest is in the tooltip (crosshair) and the table.
 */
function lineChart(points, m) {
  const pts = points.filter((p) => p[m.key] != null);
  if (!pts.length) return { svg: '<p class="hint">Nothing to chart in this range.</p>', pts };
  const W = 340; const H = 180; const L = 40; const R = 14; const T = 20; const B = 22;
  const t = pts.map((p) => Date.parse(`${p.date}T12:00:00Z`));
  const t0 = Math.min(...t); const t1 = Math.max(...t);
  const x = (v) => (t1 === t0 ? (L + W - R) / 2 : L + ((v - t0) / (t1 - t0)) * (W - L - R));
  const vs = pts.map((p) => p[m.key]);
  let lo = Math.min(...vs); let hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.1);
  lo = Math.max(0, lo - pad); hi += pad;
  const step = (() => { const raw = (hi - lo) / 3; const p = 10 ** Math.floor(Math.log10(raw)); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= raw) return k * p; return 10 * p; })();
  lo = Math.floor(lo / step) * step; hi = lo + step * Math.max(3, Math.ceil((hi - lo) / step));
  const y = (v) => H - B - ((v - lo) / (hi - lo)) * (H - B - T);
  const xy = pts.map((p, i) => [x(t[i]), y(p[m.key])]);
  const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = `${line} L${xy.at(-1)[0].toFixed(1)},${H - B} L${xy[0][0].toFixed(1)},${H - B} Z`;
  const bestI = vs.reduce((bi, v, i) => ((m.unit === 'pace' ? v < vs[bi] : v > vs[bi]) ? i : bi), 0);
  const lastI = pts.length - 1;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const yTicks = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${m.unit === 's' || m.unit === 'pace' ? clockText(v) : compact(v)}</text>`).join('');
  const span = (t1 - t0) / 86400000;
  const dl = (iso) => (span > 300 ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`);
  const xIdx = t1 === t0 ? [0] : [0, Math.round(lastI / 2), lastI].filter((v, i, a) => a.indexOf(v) === i);
  const xLabels = xIdx.map((i) => `<text x="${xy[i][0]}" y="${H - 6}" text-anchor="${i === 0 && xIdx.length > 1 ? 'start' : i === lastI && xIdx.length > 1 ? 'end' : 'middle'}" class="axis">${dl(pts[i].date)}</text>`).join('');
  // A label sits above its point, or below when the line runs through that spot.
  const crosses = (x0, x1, top, bottom) => xy.some(([ax, ay], k) => {
    const [bx, by] = xy[k + 1] || [ax, ay];
    if (bx < x0 || ax > x1) return false;
    const yAt = (xx) => (bx === ax ? ay : ay + ((by - ay) * (xx - ax)) / (bx - ax));
    const ya = yAt(Math.max(ax, x0)); const yb = yAt(Math.min(bx, x1));
    return Math.max(ya, yb) >= top && Math.min(ya, yb) <= bottom;
  });
  const label = (i) => {
    const [px, py] = xy[i];
    const text = valueText(m.unit, vs[i]).replace(/ reps?$/, '');
    const w = text.length * 6.2;
    const anchor = px > W - R - 30 ? 'end' : px < L + 30 ? 'start' : 'middle';
    const tx = Math.min(W - R, Math.max(L + 14, px));
    const x0 = anchor === 'end' ? tx - w : anchor === 'start' ? tx : tx - w / 2;
    const up = py - 9;
    const ty = crosses(x0, x0 + w, up - 9, up + 2) && !crosses(x0, x0 + w, py + 8, py + 19) && py + 17 < H - B ? py + 17 : up;
    return `<circle cx="${px}" cy="${py}" r="4" class="pt"/><text x="${tx}" y="${ty}" text-anchor="${anchor}" class="pt-label">${esc(text)}</text>`;
  };
  const svg = `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)} per session, ${pts.length} sessions">
    ${yTicks}<path d="${area}" class="area"/><path d="${line}" class="line"/>
    ${[...new Set([bestI, lastI])].map(label).join('')}
    ${xLabels}
    <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="xdot" r="4" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - B - T}"/></svg>`;
  return { svg, pts, xy, W };
}

export function render(view, params = []) {
  const id = params[0];
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let tab = 'summary';
  let metric = null;
  let range = 'all';
  let shown = HISTORY_PAGE;
  let tipEl = null;

  const draw = async (repo) => {
    const ex = mergeLibrary(await repo.list('exercises'), getState().equipment).find((e) => e.id === id);
    if (!alive) return;
    if (!ex) { view.innerHTML = '<h1 class="view-title">Not found</h1><p class="view-sub">This exercise is not in the library.</p>'; return; }
    const [bridge, rawSessions, sets, routines, daily] = await Promise.all([repo.get('bridge', 'last-loads'), repo.list('sessions'), repo.list('sets'), repo.list('routines'), dailyWeightsOf(repo)]);
    const sessions = withBodyweights(rawSessions, daily);
    if (!alive) return; // left this page while loading: don't draw over the next one
    const history = buildHistory({ sessions, sets, bridge }).all(ex.name);
    const type = ex.type || 'weight_reps';
    const points = sessionPoints(history, type);
    const metrics = metricsFor(type);
    if (!metrics.some((m) => m.key === metric)) metric = metrics[0].key;
    const recs = records(points, type);
    const own = ex.source !== 'library';
    const open = (sessionId) => (sessionId ? `#/finish/${esc(sessionId)}/e/${esc(ex.id)}` : null);
    const srcText = (src) => esc((SOURCE_LABEL[src] || src || '').toUpperCase());
    const tags = [muscleLabel(ex.primary || 'other'), ...(ex.secondary || []).map((m) => `+ ${muscleLabel(m)}`), ex.equipment, ex.barKg ? `BAR ${kg(ex.barKg)}` : null, ex.capClass === 'main' ? '30% CAP' : null].filter(Boolean);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="javascript:history.back()">Back</a><button class="pill" id="ex-more" type="button" aria-label="Exercise options">···</button></div>
      <h1 class="view-title">${esc(ex.name)}</h1>
      <div class="tags">${tags.map((t) => `<span class="tag ${t === '30% CAP' ? 'tag-main' : ''}">${esc(String(t).toUpperCase())}</span>`).join('')}</div>
      <div id="demo"></div>
      ${ex.pinnedNote ? `<div class="pinned"><span class="hud c-muted">PINNED NOTE</span> ${esc(ex.pinnedNote.text ?? ex.pinnedNote)}<span class="c-faint"> ${ex.pinnedNote.from ? `(${esc(ex.pinnedNote.from)})` : ''}</span></div>` : ''}
      <nav class="seg" aria-label="Exercise sections">
        ${[['summary', 'Summary'], ['history', 'History'], ['records', 'Records'], ['howto', 'How-to']].map(([k, l]) => `<button class="pill ${tab === k ? 'is-on' : ''}" data-tab-x="${k}" type="button">${l}</button>`).join('')}
      </nav>
      <div id="ex-tab"></div>`;
    const body = view.querySelector('#ex-tab');
    offInfo(); offInfo = () => {};
    const recordList = (list) => (list.length ? `<ul class="best-list rec-list">${list.map((r) => {
      const href = open(r.sessionId);
      const inner = `<span>${esc(r.label)}<br><span class="c-faint">${esc(longDay(r.date))} · ${srcText(r.source)}</span></span><b>${esc(valueText(r.unit, r.value))}${r.set && r.key !== 'heaviest' ? `<br><span class="c-faint">${esc(plainSet(r.set))}</span>` : r.set?.reps != null && r.key === 'heaviest' ? `<br><span class="c-faint">× ${r.set.reps}</span>` : ''}</b>`;
      return `<li>${href ? `<a class="best rec" href="${href}">${inner}</a>` : `<div class="best rec">${inner}</div>`}</li>`;
    }).join('')}</ul>` : '<p class="hint">No records yet: log a working set.</p>');

    if (tab === 'summary') {
      const last = history[0];
      const m = metrics.find((x) => x.key === metric);
      const today = isoDate(new Date());
      const chart = lineChart(inRange(points, range, today), m);
      body.innerHTML = `
        <dl class="card kv">
          <dt>Type</dt><dd>${esc(TYPES[ex.type]?.label || 'Weight × reps')}</dd>
          ${ex.restSeconds ? `<dt>Rest</dt><dd>${Math.floor(ex.restSeconds / 60)}:${String(ex.restSeconds % 60).padStart(2, '0')}</dd>` : ''}
          <dt>Sessions</dt><dd>${points.length}${points.length ? ` since ${esc(longDay(points[0].date))}` : ''}</dd>
          ${last?.heaviest ? `<dt>Last heaviest</dt><dd>${kg(last.heaviest.kg)} kg × ${last.heaviest.reps}, ${esc(longDay(last.date))}</dd>` : ''}
        </dl>
        <section class="card pad-card chart-card">
          <div class="chips" role="group" aria-label="Chart">${metrics.map((x) => `<button class="pill ${x.key === metric ? 'is-on' : ''}" type="button" data-metric="${x.key}" aria-pressed="${x.key === metric}">${esc(x.label)}</button>`).join('')}</div>
          <div class="seg" role="group" aria-label="Range">${RANGES.map(([k, l]) => `<button class="pill ${k === range ? 'is-on' : ''}" type="button" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>
          <div class="chart-box">${chart.svg}</div>
          ${metric === 'e1rm' ? `<p class="hint">Estimated from your best set (Epley: weight × (1 + reps ÷ 30)), sets of 1 to ${E1RM_MAX_REPS} reps.</p>` : ''}
          ${chart.pts.length ? `<details class="notes"><summary>Show as a table</summary><table class="mini-table"><thead><tr><th>Session</th><th>${esc(m.label)}</th></tr></thead>
            <tbody>${[...chart.pts].reverse().map((p) => `<tr><td>${esc(longDay(p.date))}</td><td>${esc(valueText(m.unit, p[m.key]))}${p[SET_OF[m.key]] && m.key !== 'heaviest' ? ` <span class="c-faint">(${esc(plainSet(p[SET_OF[m.key]]))})</span>` : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}
        </section>
        <div class="section-label">Records</div>
        ${recordList(recs)}`;
      body.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { metric = b.dataset.metric; draw(repo); }));
      body.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; draw(repo); }));
      const svg = body.querySelector('.line-chart');
      if (svg) {
        const xh = svg.querySelector('.xhair'); const dot = svg.querySelector('.xdot');
        const show = (e) => {
          const r = svg.getBoundingClientRect();
          const sx = ((e.clientX - r.left) / r.width) * chart.W;
          let bi = 0;
          chart.xy.forEach(([px], i) => { if (Math.abs(px - sx) < Math.abs(chart.xy[bi][0] - sx)) bi = i; });
          const [px, py] = chart.xy[bi];
          xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
          dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
          const p = chart.pts[bi];
          const set = p[SET_OF[m.key]];
          tipEl ||= Object.assign(document.createElement('div'), { className: 'chart-tip', role: 'status' });
          if (!tipEl.isConnected) document.body.append(tipEl);
          tipEl.textContent = `${longDay(p.date)}: ${valueText(m.unit, p[m.key])}${set && m.key !== 'heaviest' ? ` (${plainSet(set)})` : set?.reps != null ? ` × ${set.reps}` : ''} · ${SOURCE_LABEL[p.source] || p.source}`;
          tipEl.hidden = false;
          const cx = r.left + (px / chart.W) * r.width;
          tipEl.style.left = `${Math.min(window.innerWidth - tipEl.offsetWidth - 8, Math.max(8, cx - tipEl.offsetWidth / 2))}px`;
          tipEl.style.top = `${Math.max(8, r.top + (py / 180) * r.height - tipEl.offsetHeight - 14)}px`;
        };
        const hide = () => { xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); if (tipEl) tipEl.hidden = true; };
        svg.addEventListener('pointermove', show);
        svg.addEventListener('pointerdown', show);
        svg.addEventListener('pointerleave', hide);
      }
    } else if (tab === 'history') {
      body.innerHTML = `${history.length ? `<ul class="ex-list">${history.slice(0, shown).map((h) => `<li class="ex"><div class="ex-head">${h.sessionId ? `<a class="ex-name" href="${open(h.sessionId)}">${esc(longDay(h.date))}</a>` : `<span class="ex-name">${esc(longDay(h.date))}</span>`}<span class="hud c-muted">${esc(h.title || '')} · ${srcText(h.source)}</span></div>
          <div class="ex-line sets-line">${h.sets.map(setText).join(' <span class="c-faint">·</span> ')}</div></li>`).join('')}</ul>` : '<p class="hint">Not logged yet.</p>'}
        ${history.length > shown ? `<button class="btn-ghost" id="ex-more-hist" type="button">Show more (${history.length - shown} left)</button>` : ''}
        <p class="hint">${history.length} session${history.length === 1 ? '' : 's'}, newest first: logged in Training HQ or imported from Hevy and Strong.</p>`;
      body.querySelector('#ex-more-hist')?.addEventListener('click', () => { shown += HISTORY_PAGE * 2; draw(repo); });
    } else if (tab === 'records') {
      const reps = family(type) === 'weight' || family(type) === 'weighted_bw' ? repRecords(history) : [];
      body.innerHTML = `${recordList(recs)}
        ${reps.length ? `<div class="section-label">Best weight for each rep count</div>
          <table class="mini-table rep-table"><thead><tr><th>Reps</th><th>Weight</th><th>When</th></tr></thead>
          <tbody>${reps.map((r) => `<tr><td>${r.reps}</td><td>${kg(r.kg)} kg</td><td>${r.sessionId ? `<a href="${open(r.sessionId)}">${esc(longDay(r.date))}</a>` : esc(longDay(r.date))}</td></tr>`).join('')}</tbody></table>
          <p class="hint">Heaviest weight lifted for exactly that many reps. Warm-ups and holds don't count.</p>` : ''}`;
    } else {
      body.innerHTML = `<div id="demo-info"></div>
        ${ex.howTo ? `<div class="card pad-card howto">${esc(ex.howTo).replace(/\n/g, '<br>')}</div>` : '<p class="hint">No written how-to of your own yet. It is optional: write your own cues, in your own words.</p>'}
        <button class="btn-ghost" id="howto-edit" type="button">${ex.howTo ? 'Edit how-to' : 'Write a how-to'}</button>`;
      body.querySelector('#howto-edit').onclick = () => editText('howTo', 'How-to (your own cues)', ex.howTo || '');
      // An animated demo also explains the exercise: what it works, cues, mistakes, rules.
      offInfo = demoPanel(body.querySelector('#demo-info'), ex, { part: 'info' });
    }
    view.querySelectorAll('[data-tab-x]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tabX; draw(repo); }));

    /** Save a text field on this exercise's own record (a library exercise gets a small record that extends it). */
    const editText = async (field, title, value) => {
      const t = await promptLong(title, value);
      if (t == null) return;
      const rec = (await repo.get('exercises', ex.id)) || { id: ex.id };
      const v = field === 'pinnedNote' ? (t ? { text: t, from: `Training HQ, ${formatDay(new Date())}` } : null) : t || null;
      await repo.put('exercises', ex.id, { ...rec, [field]: v });
    };
    const used = exerciseUsed(ex, { sessions, bridge });
    const inRoutines = routinesUsing(ex, routines);
    view.querySelector('#ex-more').onclick = () => actionSheet(ex.name, [
      ...(own ? [{ label: 'Edit exercise', run: () => { location.hash = `#/library/edit/${ex.id}`; } }] : []),
      { label: 'Duplicate as a custom exercise', run: async () => {
        const all = mergeLibrary(await repo.list('exercises'));
        const copy = duplicateExercise(ex, new Set(all.map((e) => e.id)));
        await repo.put('exercises', copy.id, copy);
        toast(`Made "${copy.name}". It starts with no history.`);
        location.hash = `#/library/edit/${copy.id}`;
      } },
      { label: `Bar (${ex.barKg ? `${kg(ex.barKg)} kg` : 'none'})`, run: () => {
        const bars = getState().equipment?.bars || [];
        const choose = async (barId) => { const rec = (await repo.get('exercises', ex.id)) || { id: ex.id }; await repo.put('exercises', ex.id, { ...rec, barId }); toast(barId === 'none' ? 'No bar: loads are plain totals.' : 'Saved. Loads stay totals including the bar.'); };
        actionSheet('Bar for this exercise', [
          ...bars.map((b) => ({ label: `${b.label || 'Bar'} · ${kg(b.kg)} kg${ex.barId === b.id ? ' (now)' : ''}`, run: () => choose(b.id) })),
          { label: `No bar${ex.barId === 'none' ? ' (now)' : ''}`, run: () => choose('none') },
          { label: `By equipment type (default)${!ex.barId ? ' (now)' : ''}`, run: () => choose(null) },
        ]);
      } },
      { label: ex.pinnedNote ? 'Edit pinned note' : 'Pin a note (shows every time)', run: () => editText('pinnedNote', 'Pinned note', ex.pinnedNote?.text ?? ex.pinnedNote ?? '') },
      { label: ex.howTo ? 'Edit how-to' : 'Write a how-to', run: () => editText('howTo', 'How-to (your own cues)', ex.howTo || '') },
      ...(ex.custom ? [{ label: 'Delete exercise', danger: true, run: async () => {
        if (used) { toast('It has logged sets, so it stays: your history needs it.'); return; }
        if (inRoutines.length) { toast(`It is in ${inRoutines.map((r) => r.title).join(', ')}. Remove it there first.`); return; }
        if (!(await confirmSheet(`Delete ${ex.name}?`, { ok: 'Delete', danger: true }))) return;
        await repo.remove('exercises', ex.id);
        location.hash = '#/library';
      } }] : []),
    ]);
    offDemo();
    offDemo = demoPanel(view.querySelector('#demo'), ex);
  };
  let offDemo = () => {};
  let offInfo = () => {};

  let off = () => {};
  let alive = true;
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.includes('exercises') || cols.includes('bridge') || cols.includes('sessions') || cols.includes('demos')) draw(repo); });
    draw(repo);
  });
  const hideTip = () => { if (tipEl) tipEl.hidden = true; };
  window.addEventListener('scroll', hideTip, { passive: true });
  return () => { alive = false; off(); offDemo(); offInfo(); tipEl?.remove(); window.removeEventListener('scroll', hideTip); };
}
