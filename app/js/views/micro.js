// VITAMINS AND MINERALS (#/micro[/<YYYY-MM-DD>][/week]) (A12): his diet analysis inside the app, from what he logged
// that day (or the 7 days up to it), as eaten and raw, beside his planned day, against the references his analysis
// uses with their sources. Numbers only: no advice, nothing suggested; his accepted points are noted, not flagged.
import { ready } from '../lib/data.js';
import { isoDate, formatDay, formatDate } from '../lib/time.js';
import { addDays } from '../lib/rotation.js';
import { loadFoods } from '../lib/foods.js';
import { dayMicro, weekMicro, plannedMicro, microRows, GROUPS } from '../lib/micro.js';
import { dayKindOn } from './supps.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => { const a = Math.abs(v); return a >= 100 ? Math.round(v).toLocaleString('en-US') : a >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100); };
const refText = (r) => (r.ref == null ? 'no reference' : Array.isArray(r.ref) ? `${num(r.ref[0])}-${num(r.ref[1])} ${r.unit}` : `${r.atLeast ? '≥' : ''}${num(r.ref)} ${r.unit}`);

export function render(view, params = []) {
  const today = isoDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : today;
  const week = params.includes('week');
  const dayName = (d) => (d.slice(0, 4) === today.slice(0, 4) ? formatDay : formatDate)(new Date(`${d}T12:00:00`));
  let alive = true; let off = () => {};
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/fuel">Fuel</a></div><p class="view-sub">Loading…</p>';

  const draw = async (repo) => {
    const [db, meals, estimates, plan, micro, supplements, suppLog] = await Promise.all([
      loadFoods(), repo.list('meals'), repo.list('meal-estimates'), repo.get('fuel', 'plan'), repo.get('fuel', 'micro'), repo.list('supplements'), repo.list('supp-log'),
    ]);
    if (!alive) return;
    if (!micro?.references?.length) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/fuel">Fuel</a></div><h1 class="view-title">Vitamins and minerals</h1><p class="hint">Your references arrive with the next sync from your Mac.</p>'; return; }
    const kinds = new Map();
    for (const d of Array.from({ length: 7 }, (_, i) => addDays(date, i - 6))) kinds.set(d, await dayKindOn(repo, d));
    const o = { meals, estimates, plan: plan || {}, micro, supplements, suppLog, date, dayKind: kinds.get(date), dayKindOf: (d) => kinds.get(d) };
    const t = week ? weekMicro(db, o) : dayMicro(db, o);
    const planned = plannedMicro(db, { plan: plan || {}, micro });
    const rows = microRows(micro, t, planned);
    const logged = week ? t.days : t.items;
    const row = (r) => {
      const fill = r.pct != null ? Math.min(100, r.pct) : r.within === 'within' ? 100 : r.within === 'above' ? 100 : r.ref ? Math.min(100, Math.round((r.total / (Array.isArray(r.ref) ? r.ref[0] : r.ref)) * 100)) : 0;
      const status = r.pct != null ? `${r.pct}%` : r.within ? r.within : '';
      return `<li class="micro-row ${r.over ? 'is-over' : ''}" data-key="${esc(r.key)}">
        <div class="micro-top"><b>${esc(r.name)}</b><span class="mono">${num(r.total)} ${esc(r.unit)}${status ? ` <span class="c-muted">· ${esc(status)}</span>` : ''}</span></div>
        <span class="micro-track"><span class="micro-fill" style="width:${fill}%"></span></span>
        <div class="hint">${r.raw !== r.total ? `raw ${num(r.raw)} · ` : ''}${r.supp ? `supplements ${num(r.supp)} · ` : ''}planned ${num(r.planned)} · ref ${esc(refText(r))} (${esc(r.refNote)})</div>
        ${r.ul ? `<div class="hint ${r.over ? 'c-amber' : ''}">${r.ulInfo ? 'level' : 'limit'} ${num(r.ul)} ${esc(r.unit)} (${esc(r.ulNote)}): ${r.limitUsed}% used${r.ulSupplementalOnly ? ' by supplements' : ''}${r.altLimit ? ` · ${esc(r.altLimit.note)} ${num(r.altLimit.value)}: ${r.altLimit.used}%` : ''}</div>` : r.ulNote ? `<div class="hint">limit: ${esc(r.ulNote)}</div>` : ''}
        ${r.accepted ? `<div class="hint c-green">${esc(r.accepted)}</div>` : ''}
        ${r.incomplete.length ? `<div class="hint c-faint">No USDA value for: ${esc(r.incomplete.join(', '))}</div>` : ''}</li>`;
    };
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel/${esc(date)}">Fuel</a>
        <span class="seg"><a class="pill ${week ? '' : 'is-on'}" href="#/micro/${esc(date)}">Day</a><a class="pill ${week ? 'is-on' : ''}" href="#/micro/${esc(date)}/week">7 days</a></span></div>
      <div class="fuel-head"><a class="pill" href="#/micro/${addDays(date, -1)}${week ? '/week' : ''}" aria-label="Day before">‹</a>
        <div class="hud c-muted">${week ? `7 DAYS TO ${esc(dayName(date).toUpperCase())}` : esc(dayName(date).toUpperCase())}</div>
        ${date < today ? `<a class="pill" href="#/micro/${addDays(date, 1)}${week ? '/week' : ''}" aria-label="Next day">›</a>` : '<span class="pill is-off" aria-hidden="true">›</span>'}</div>
      <h1 class="view-title">Vitamins and minerals</h1>
      <p class="hint">${week ? `Average of the ${t.days} day${t.days === 1 ? '' : 's'} with food logged (of 7).` : `${t.items} food item${t.items === 1 ? '' : 's'} logged.`} As eaten: your analysis's cooking factors on raw beef and eggs. Supplements on the days you ticked them taken, by label stoichiometry. Against the references in your Diet.html.</p>
      ${t.notCounted.length ? `<p class="hint c-amber">Not counted (no USDA match): ${esc(t.notCounted.join(', '))}.</p>` : ''}
      ${logged ? '' : '<p class="hint">Nothing logged yet for this day: only supplements show.</p>'}
      ${GROUPS.map(([g, label]) => { const list = rows.filter((r) => r.group === g); return list.length ? `<div class="section-label">${esc(label)}</div><ul class="card pad-card micro-list">${list.map(row).join('')}</ul>` : ''; }).join('')}
      <p class="hint">${esc(micro.source)} Planned: your planned day computed here from the bundled USDA values; your Diet.html may differ a little where it used other USDA records. ${esc(micro.plannedNote || '')}</p>
      <p class="hint">${esc(micro.retention?.source || '')} ${esc(micro.supplements?.source || '')}</p>`;
  };

  ready.then((repo) => {
    if (!alive) return;
    draw(repo);
    off = repo.onChange((cols) => { if (cols.some((c) => ['meals', 'meal-estimates', 'fuel', 'supplements', 'supp-log'].includes(c))) draw(repo); });
  });
  return () => { alive = false; off(); };
}
