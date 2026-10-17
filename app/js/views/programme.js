// PROGRAMME: read-only view of The Comeback as it synced from the Mac (all four week columns, overrides, notes).
// Reached from a routine ("See The Comeback table").
import { ready } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { weekColumn } from '../lib/programme.js';
import { isoDate, formatDay } from '../lib/time.js';
import { kg, platesPerSide, barFor } from '../lib/loads.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAYS = [['pull', 'Pull'], ['push', 'Push'], ['legs', 'Legs'], ['neck', 'Neck']];
let chosen = { day: 'pull', variant: 'getting-back-into' };

function loadText(w) {
  if (!w.load) return null;
  if (w.load.type === 'bodyweight') return 'Bodyweight';
  if (w.load.type === 'added') return `+${kg(w.load.kg)} kg`;
  return `${w.load.approx ? '~' : ''}${kg(w.load.kg)} kg`;
}
function setsText(s) {
  if (!s) return '';
  if (s.firstSession != null) return `${s.after} sets (first session ${s.firstSession})`;
  if (s.count != null) return `${s.count} set${s.count === 1 ? '' : 's'}`;
  return `${s.min}-${s.max} sets`;
}

function gbiRow(e, week, equipment) {
  if (e.role === 'tendon-hold') {
    return `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(e.name)}</span><span class="tag tag-hold">HOLD</span></div>
      <div class="ex-line c-muted">Shoulder isometric hold, last ${kg(e.lastLogged.kg)} kg, 3 × 30 s. Tendon checklist arrives in step 2.</div></li>`;
  }
  if (!e.weeks) {
    const l = e.lastLogged;
    return `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(e.name)}</span><span class="tag">LAST LOAD</span></div>
      <div class="ex-line">Last: ${kg(l.kg)} kg × ${l.reps}, ${formatDay(new Date(`${l.date}T12:00:00`))}</div>
      <div class="ex-note">${esc(e.override?.rule)}</div></li>`;
  }
  const wk = Math.min(Math.max(week || 1, 1), 4);
  const w = e.weeks[wk - 1];
  const lt = loadText(w);
  const bar = w.load?.type === 'total' ? barFor(e.name, equipment) : null;
  const per = bar ? platesPerSide(w.load.kg, bar) : null;
  const target = [lt, w.reps ? `${w.reps[0]}-${w.reps[1]} reps` : null, setsText(w.sets)].filter(Boolean).join(' · ');
  return `<li class="ex">
    <div class="ex-head"><span class="ex-name">${esc(e.name)}</span>
      <span class="tag ${e.capClass === 'main' ? 'tag-main' : ''}">${e.capClass === 'main' ? '30% CAP' : 'LIGHT'}</span></div>
    <div class="ex-line"><span class="hud-ish c-faint">TABLE</span> <b>${esc(target || w.text)}</b></div>
    ${per != null ? `<div class="ex-line c-muted hud-ish">${kg(bar)} BAR + ${kg(per)} KG/SIDE</div>` : ''}
    ${e.override ? `<div class="ex-note">${esc(e.override.rule)} <span class="c-faint">(${esc(e.override.source)})</span></div>` : ''}
    <details class="ex-weeks"><summary>All four weeks, as written</summary>
      <ol>${e.weeks.map((x) => `<li class="${x.week === wk ? 'is-now' : ''}"><span class="hud">WK ${x.week}</span> ${esc(x.text)}</li>`).join('')}</ol>
    </details>
  </li>`;
}

function normalRow(e) {
  if (e.guidance) {
    return `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(e.name)}</span></div>
      <ul class="ex-guide">${e.guidance.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></li>`;
  }
  return `<li class="ex"><div class="ex-head"><span class="ex-name">${e.order}. ${esc(e.name)}</span></div>
    <div class="ex-line"><b>${esc(e.workingSets)}</b> · ${esc(e.reps)} reps</div>
    <div class="ex-line c-muted">Warm-up: ${esc(e.warmup)}</div>
    <div class="ex-note">${esc(e.cue)}</div></li>`;
}

export function render(view, params = []) {
  if (params[0]) chosen.day = params[0];
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let docs = [];

  const draw = () => {
    const meta = docs.find((d) => d.kind === 'meta');
    const routines = docs.filter((d) => d.kind === 'routine');
    if (!meta || !routines.length) {
      view.innerHTML = `<h1 class="view-title">Train</h1>
        <section class="card later"><div class="hud c-amber">NO PROGRAMME YET</div>
        <p>${getState().paired ? 'Waiting for the first sync from your Mac.' : 'Pair with your Mac in Settings and your programme loads here.'}</p></section>`;
      return;
    }
    const today = isoDate(new Date());
    const week = chosen.day === 'neck' ? null : weekColumn(meta.firstSessions?.[chosen.day], today);
    const variants = chosen.day === 'neck' ? [] : [['getting-back-into', 'Getting back into'], ['normal', 'Normal (later)']];
    const r = chosen.day === 'neck'
      ? routines.find((x) => x.id === 'neck')
      : routines.find((x) => x.dayType === chosen.day && x.variant === chosen.variant);

    view.innerHTML = `
      <div class="train-head">
        <h1 class="view-title">${esc(meta.title)}</h1>
        <p class="hud c-muted">THE PLAN AS WRITTEN. SESSIONS USE IT WITH THE 30% CAP ON YOUR LAST LOAD.</p>
      </div>
      <nav class="seg" aria-label="Day type">${DAYS.map(([id, label]) => `<button class="pill ${chosen.day === id ? 'is-on' : ''}" data-day="${id}" type="button">${label}</button>`).join('')}</nav>
      ${variants.length ? `<nav class="seg" aria-label="Version">${variants.map(([id, label]) => `<button class="pill ${chosen.variant === id ? 'is-on' : ''}" data-variant="${id}" type="button">${label}</button>`).join('')}</nav>` : ''}
      ${week ? `<div class="hud c-cyan">WEEK ${week} COLUMN${week > 4 ? ' · SHOWING WEEK 4; WEEK 5+ PROPOSALS ARRIVE IN STEP 4' : ''} · FROM ${esc(formatDay(new Date(`${meta.firstSessions[chosen.day]}T12:00:00`)).toUpperCase())}</div>` : ''}
      ${r?.scheduled === false ? `<div class="card later"><div class="hud c-amber">NOT SCHEDULED YET</div><p>${esc(r.lastDone?.note)}</p><p>${esc(r.rule)}</p></div>` : ''}
      <ul class="ex-list">${(r?.exercises || []).map((e) => (r.variant === 'normal' ? normalRow(e) : r.id === 'neck'
        ? `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(e.name)}</span><span class="tag">LIGHT START</span></div></li>`
        : gbiRow(e, week, meta.loads?.equipment))).join('')}</ul>
      ${r?.notes?.length ? `<details class="card notes"><summary class="hud">NOTES FROM THE COMEBACK</summary><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}`;

    view.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { chosen.day = b.dataset.day; draw(); }; });
    view.querySelectorAll('[data-variant]').forEach((b) => { b.onclick = () => { chosen.variant = b.dataset.variant; draw(); }; });
  };

  let repo;
  const load = async () => { docs = await repo.list('programme'); draw(); };
  let off = () => {};
  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.includes('programme')) load(); });
    load();
  });
  const unsub = subscribe(() => { if (!docs.length) draw(); });
  return () => { off(); unsub(); };
}
