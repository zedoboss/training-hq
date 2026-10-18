// BODY > Measurements (#/body/measure, 7.3, P48): weight, lean mass, body fat and Hevy's 14 circumferences, one
// record per date in collection 'measurements' (his own 'measure.<date>', Hevy's imported 'measure.hevy.<date>').
// Shown and typed in his units (Settings > Units: kg/lb, cm/in), stored in kg, cm and %.
// #/body/measure                latest value of each field with its change, and every entry by date
// #/body/measure/edit/<date|new> one date's numbers and note; delete
// #/body/measure/f/<key>        one field over time: chart and table
import { ready } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, isoDate } from '../lib/time.js';
import { addDays } from '../lib/rotation.js';
import { WEIGHT_FIELDS, CIRCUMFERENCES, fieldOf, shown, stored, unitText, measureIdFor, filled, fieldSeries, latestByField } from '../lib/body.js';
import { timeLine, bindCrosshair, tableView } from '../ui/charts.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const FROM = { hevy: 'Hevy', manual: 'You' };
const RANGES = [['90', '3 months'], ['365', '1 year'], ['all', 'All']];
const units = () => withDefaults(getState().settings).units;

/** "▲ 0.5 kg" / "▼ 1.2 cm" / "same", in his units. */
function changeText(f, value, prev, u) {
  if (prev == null) return '';
  const d = Math.round((shown(f.kind, value, u) - shown(f.kind, prev, u)) * 10) / 10;
  return d === 0 ? 'same' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} ${unitText(f.kind, u)}`;
}
const valueText = (f, v, u) => `${shown(f.kind, v, u)} ${unitText(f.kind, u)}`;

export function render(view, params = []) {
  const [mode, arg] = params;
  if (mode === 'edit') return editor(view, arg);
  if (mode === 'f') return fieldView(view, arg);
  return list(view);
}

function list(view) {
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Measurements</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  const draw = async (repo) => {
    const ms = (await repo.list('measurements')).filter((m) => m?.date);
    if (!alive) return;
    const u = units();
    const today = isoDate(new Date());
    const latest = latestByField(ms);
    const dated = [...ms].sort((a, b) => (a.date < b.date ? 1 : -1));
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body">Body</a></div>
      <h1 class="view-title">Measurements</h1>
      <p class="view-sub">Weight, lean mass, body fat and 14 circumferences, one entry per day, in ${esc(unitText('kg', u))} and ${esc(unitText('cm', u))} (Settings &gt; Units).</p>
      <a class="btn-primary center big" href="#/body/measure/edit/${today}">${ms.some((m) => m.date === today) ? 'Edit today\'s' : '+ Add today\'s'}</a>
      ${latest.length ? `<div class="section-label">Latest</div>
        <ul class="best-list">${latest.map((f) => `<li><a class="best measure-row" href="#/body/measure/f/${f.key}"><span>${esc(f.label)}<br><span class="c-faint">${esc(md(f.date))}${f.count > 1 ? ` · ${f.count} entries` : ''}</span></span>
          <b>${esc(valueText(f, f.value, u))}${f.prev != null ? `<br><span class="c-faint">${esc(changeText(f, f.value, f.prev, u))} since ${esc(md(f.prevDate))}</span>` : ''}</b></a></li>`).join('')}</ul>`
        : '<p class="hint">No measurements yet. Add today\'s, or bring your Hevy measurements in with Settings &gt; Import and export.</p>'}
      ${dated.length ? `<div class="section-label">Every entry</div>
        <ul class="best-list">${dated.map((m) => {
          const fs = filled(m);
          const head = fs.slice(0, 3).map((f) => valueText(f, m[f.key], u)).join(' · ');
          return `<li><a class="best measure-row" href="#/body/measure/edit/${m.date}"><span>${esc(dayName(m.date))}<br><span class="c-faint">${fs.length} number${fs.length === 1 ? '' : 's'} · ${esc(FROM[m.source] || FROM.manual)}${m.note ? ' · note' : ''}</span></span><b>${esc(head)}</b></a></li>`;
        }).join('')}</ul>` : ''}
      <a class="link-btn" href="#/body/measure/edit/new">Add a measurement on another date</a>`;
  };
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => ['measurements', 'settings'].includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); };
}

function editor(view, arg) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true;
  const today = isoDate(new Date());
  let date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : today;
  const draw = async (repo) => {
    const ms = (await repo.list('measurements')).filter((m) => m?.date);
    if (!alive) return;
    const u = units();
    const id = measureIdFor(date, ms);
    const cur = ms.find((m) => m.id === id) || null;
    const input = (f) => `<div class="field measure-field"><label for="mf-${f.key}">${esc(f.label)}</label>
      <span class="row-fields"><input class="input mini num" id="mf-${f.key}" data-key="${f.key}" inputmode="decimal" autocomplete="off" value="${cur?.[f.key] != null ? esc(shown(f.kind, cur[f.key], u)) : ''}"><span class="hint">${esc(unitText(f.kind, u))}</span></span></div>`;
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/measure">Measurements</a>${cur ? `<span class="hud c-muted">${esc(cur.source === 'hevy' ? 'FROM HEVY' : 'YOURS')}</span>` : ''}</div>
      <h1 class="view-title">${cur ? 'Edit measurement' : 'New measurement'}</h1>
      <form class="card pad-card measure-form" id="mf">
        <div class="field"><label for="mf-date">Date</label><input class="input" type="date" id="mf-date" value="${date}" max="${today}" required></div>
        <p class="hint">${cur ? `${esc(dayName(date))}: ${filled(cur).length} number${filled(cur).length === 1 ? '' : 's'} so far. Change any, clear one to remove it.` : `Nothing for ${esc(dayName(date))} yet. Fill in what you measured; leave the rest empty.`}</p>
        <div class="section-label">Weight and body fat</div>
        <div class="measure-grid">${WEIGHT_FIELDS.map(input).join('')}</div>
        <div class="section-label">Circumferences</div>
        <div class="measure-grid">${CIRCUMFERENCES.map(input).join('')}</div>
        <div class="field"><label for="mf-note">Note</label><textarea class="input area" id="mf-note" rows="2" maxlength="400" placeholder="e.g. morning, before eating">${esc(cur?.note || '')}</textarea></div>
        <button class="btn-primary" type="submit">Save</button>
      </form>
      ${cur ? '<button class="btn-ghost btn-danger" id="mf-del" type="button">Delete this entry</button>' : ''}`;
    const $ = (s) => view.querySelector(s);
    // Another date shows that date's entry (one per day), keeping nothing typed for the old date.
    $('#mf-date').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v === date) return;
      if (v > today) { toast('Not a future date.'); e.target.value = date; return; }
      date = v; history.replaceState(null, '', `#/body/measure/edit/${v}`); draw(repo);
    });
    $('#mf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = { ...(cur || { id, date, source: 'manual' }) };
      const bad = [];
      for (const el of view.querySelectorAll('[data-key]')) {
        const f = fieldOf(el.dataset.key);
        const v = stored(f.kind, el.value, u);
        if (Number.isNaN(v)) { bad.push(f.label); continue; }
        // Unchanged numbers keep their stored precision (no rounding through the shown unit).
        if (v != null && cur?.[f.key] != null && String(shown(f.kind, cur[f.key], u)) === el.value.trim().replace(',', '.')) continue;
        if (v == null) delete next[f.key]; else next[f.key] = v;
      }
      if (bad.length) { toast(`Check ${bad.join(', ')}.`); return; }
      const note = $('#mf-note').value.trim();
      if (note) next.note = note; else delete next.note;
      if (!filled(next).length) { toast(cur ? 'Every number is empty: use Delete instead.' : 'Type at least one number.'); return; }
      next.updatedAt = Date.now();
      if (date === today && !cur) next.at = Date.now();
      await repo.put('measurements', id, next);
      toast(`Saved for ${dayName(date)}.`);
      location.hash = '#/body/measure';
    });
    $('#mf-del')?.addEventListener('click', async () => {
      if (!(await confirmSheet(`Delete the measurement of ${dayName(date)}?`, { ok: 'Delete', danger: true }))) return;
      await repo.remove('measurements', id);
      toast('Deleted.');
      location.hash = '#/body/measure';
    });
  };
  if (arg === 'new') history.replaceState(null, '', `#/body/measure/edit/${today}`);
  ready.then((repo) => draw(repo));
  return () => { alive = false; };
}

function fieldView(view, key) {
  const f = fieldOf(key);
  if (!f) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/measure">Measurements</a></div><p class="hint">Not found.</p>'; return null; }
  view.innerHTML = `<div class="lib-head"><a class="pill" href="#/body/measure">Measurements</a></div><h1 class="view-title">${esc(f.label)}</h1><p class="view-sub">Loading…</p>`;
  let alive = true; let off = () => {}; let unx = () => {};
  let range = 'all';
  const draw = async (repo) => {
    const ms = (await repo.list('measurements')).filter((m) => m?.date);
    if (!alive) return;
    const u = units();
    const today = isoDate(new Date());
    const series = fieldSeries(ms, key);
    const from = range === 'all' ? '' : addDays(today, -Number(range));
    const pts = series.filter((p) => p.date >= from).map((p) => ({ t: Date.parse(`${p.date}T12:00:00`), value: shown(f.kind, p.value, u), p }));
    const chart = timeLine(pts, { label: `${f.label} in ${unitText(f.kind, u)}` });
    const first = series[0]; const last = series.at(-1);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/measure">Measurements</a></div>
      <h1 class="view-title">${esc(f.label)}</h1>
      <p class="view-sub">${last ? `${esc(valueText(f, last.value, u))} on ${esc(dayName(last.date))}${series.length > 1 ? ` · ${esc(changeText(f, last.value, first.value, u))} since ${esc(md(first.date))}` : ''}` : 'No entries yet.'}</p>
      <section class="card pad-card chart-card">
        <span class="hud c-muted">${esc(f.label.toUpperCase())} (${esc(unitText(f.kind, u).toUpperCase())})</span>
        <div class="seg" role="group" aria-label="Range">${RANGES.map(([k, l]) => `<button class="pill ${k === range ? 'is-on' : ''}" type="button" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>
        <div class="chart-box" id="mf-chart">${chart.svg}</div>
        ${key === 'weightKg' ? '<p class="hint">Only the weights you entered or imported from Hevy. The Body screen\'s weight chart adds your Apple Health weigh-ins.</p>' : ''}
        ${pts.length ? tableView(['Day', unitText(f.kind, u), 'Change', 'From'], [...pts].reverse().map((x, i, arr) => [dayName(x.p.date), String(x.value), arr[i + 1] ? changeText(f, x.p.value, arr[i + 1].p.value, u) : '', FROM[x.p.source] || FROM.manual])) : ''}
      </section>
      ${series.length ? `<div class="section-label">Entries</div><ul class="best-list">${[...series].reverse().map((p) => `<li><a class="best measure-row" href="#/body/measure/edit/${p.date}"><span>${esc(dayName(p.date))}<br><span class="c-faint">${esc(FROM[p.source] || FROM.manual)}</span></span><b>${esc(valueText(f, p.value, u))}</b></a></li>`).join('')}</ul>` : ''}
      <a class="btn-ghost center" href="#/body/measure/edit/${today}">Add today's</a>`;
    unx(); unx = bindCrosshair(view.querySelector('#mf-chart'), chart, (x) => `${dayName(x.p.date)}: ${x.value} ${unitText(f.kind, u)}`);
    view.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; draw(repo); }));
  };
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => ['measurements', 'settings'].includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); unx(); };
}
