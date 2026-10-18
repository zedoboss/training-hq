// FUEL (#/fuel, #/fuel/<YYYY-MM-DD>): the day's meals and totals, LOG MEAL (camera), meals without a photo.
// Supplements and the sauna join this screen later in step 6.
import { ready } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { isoDate, formatDay, formatTime, daysBetween } from '../lib/time.js';
import { addDays } from '../lib/rotation.js';
import { dayTotals, mealTotals, mealState, STATE_SHORT } from '../lib/meals.js';
import { logMealFromFile, logMealManual, cameraInput } from './meal.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAMERA = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const n0 = (x) => Math.round(x || 0).toLocaleString('en-US');
const dayLabel = (iso) => formatDay(new Date(`${iso}T12:00:00`));

export function render(view, [dateParam]) {
  const today = isoDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : today;
  view.innerHTML = `<div id="f-body"><p class="view-sub">Loading…</p></div>${cameraInput('f-cam')}`;
  const body = view.querySelector('#f-body');
  let repo; let alive = true; let off = () => {};
  view.querySelector('#f-cam').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { location.hash = `#/meal/${await logMealFromFile(f)}`; } catch { toast('That photo could not be read.'); }
  });

  const draw = async () => {
    const [meals, estimates, photos] = await Promise.all([repo.list('meals'), repo.list('meal-estimates'), repo.list('meal-photos')]);
    if (!alive) return;
    const list = meals.filter((m) => m.date === date).sort((a, b) => a.at - b.at);
    const t = dayTotals(meals, estimates, date);
    const thumb = new Map(photos.filter((p) => p.kind === 'before').map((p) => [p.id, p.dataUrl]));
    const st = getState();
    const queued = st.sync.pending > 0 && st.paired && st.mac.reachable === false;
    const ago = daysBetween(date, today);
    body.innerHTML = `
      <div class="fuel-head">
        <a class="pill" href="#/fuel/${addDays(date, -1)}" aria-label="Day before">‹</a>
        <div class="hud c-muted">${ago === 0 ? 'TODAY · ' : ''}${esc(dayLabel(date).toUpperCase())}</div>
        ${date < today ? `<a class="pill" href="#/fuel/${addDays(date, 1)}" aria-label="Next day">›</a>` : '<span class="pill is-off" aria-hidden="true">›</span>'}
      </div>
      <h1 class="view-title">Fuel</h1>
      <section class="card pad-card fuel-totals" id="f-totals">
        <div class="fuel-total"><span class="hud c-muted">KCAL</span><b>${n0(t.kcal)}</b></div>
        <div class="fuel-total"><span class="hud c-muted">PROTEIN</span><b>${Math.round(t.protein * 10) / 10} g</b></div>
        <div class="fuel-total"><span class="hud c-muted">MEALS</span><b>${t.meals}</b></div>
        ${t.estimated || t.unread ? `<p class="hint">${[t.estimated ? `${t.estimated} meal${t.estimated === 1 ? '' : 's'} still an estimate (not confirmed)` : '', t.unread ? `${t.unread} still being read by the Mac` : ''].filter(Boolean).join(' · ')}.</p>` : ''}
      </section>
      ${date === today ? `<div class="fuel-log">
        <label class="btn-primary fuel-cam file-btn" for="f-cam">${CAMERA}<span>LOG MEAL</span></label>
        <button class="btn-ghost" id="f-manual" type="button">No photo</button></div>
        <p class="hint">Take the before photo with the kitchen scale in it if you weighed the food. The Mac reads it and estimates items, grams, kcal and protein; you confirm or fix.</p>` : ''}
      ${queued ? '<p class="hint c-amber">Mac unreachable: photos are kept on this phone and read when it is back.</p>' : ''}
      <div class="section-label">${list.length ? `Meals · ${list.length}` : 'No meals logged'}</div>
      <ul class="meal-list">${list.map((m) => {
        const mt = mealTotals(m, estimates);
        const s = mealState(m, estimates);
        const img = thumb.get(m.before?.photoId);
        return `<li><a class="card meal-item" href="#/meal/${esc(m.id)}">
          ${img ? `<img class="meal-thumb" src="${img}" alt="">` : '<span class="meal-thumb is-empty" aria-hidden="true"></span>'}
          <span class="meal-item-main"><b>${esc(m.name)}</b> <span class="c-muted">${esc(formatTime(new Date(m.at)))}</span>
            <span class="hint">${mt.known ? `${n0(mt.kcal)} kcal · ${Math.round(mt.protein * 10) / 10} g protein${mt.estimated ? ' · estimate' : ''}` : ''}</span></span>
          <span class="hud ${s === 'done' ? 'c-green' : 'c-amber'} meal-state">${esc(STATE_SHORT[s])}</span></a></li>`;
      }).join('')}</ul>`;
    const man = body.querySelector('#f-manual');
    if (man) man.onclick = async () => {
      const id = await logMealManual();
      location.hash = `#/meal/${id}`;
      const { editItems } = await import('./meal.js');
      const items = await editItems('WHAT YOU ATE', []);
      if (items) { const m = await repo.get('meals', id); await repo.put('meals', id, { ...m, before: { ...m.before, items, confirmedAt: Date.now() } }); }
    };
  };

  // Redraw when the Mac link or the waiting count changes, not on every sync tick.
  let net = null;
  const unsub = subscribe((s) => { const k = `${s.paired}|${s.mac.reachable}|${s.sync.pending > 0}`; if (k !== net) { const first = net === null; net = k; if (!first && alive && repo) draw(); } });
  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.some((c) => ['meals', 'meal-estimates', 'meal-photos', 'settings'].includes(c))) draw(); });
    draw();
  });
  return () => { alive = false; off(); unsub(); };
}
