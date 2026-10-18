// ONE SUPPLEMENT (#/supp/<id>, #/supp/new): his own entry, edited by him only (brief section 6 SUPPLEMENTS,
// decision 20: he enters times, with-food rules and servings left here). Pause, resume, remove (history is kept).
// Every change is dated on the item. The app never suggests a supplement or a dose.
import { ready } from '../lib/data.js';
import { isoDate, formatHm } from '../lib/time.js';
import { WEEKDAYS, FOOD_TEXT, daysText, stockStatus, lastsText, statusOn } from '../lib/supplements.js';
import { newId } from '../lib/routines.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FOOD = [['with', 'With food'], ['without', 'Without'], ['either', 'Either'], ['', 'Not set']];

/** A dated history entry; a second change on the same day replaces the first. */
export function withStatus(supp, status, on) {
  const history = (supp.history || []).filter((h) => h.on !== on);
  return { ...supp, status, history: [...history, { on, status }].sort((a, b) => a.on.localeCompare(b.on)) };
}

/** What changed, in words, for the item's change log. */
function describe(a, b) {
  const out = [];
  if (a.name !== b.name) out.push(`name ${b.name}`);
  if (a.dose !== b.dose) out.push(`dose ${b.dose}`);
  if ((a.doseRest || '') !== (b.doseRest || '')) out.push(b.doseRest ? `rest-day dose ${b.doseRest}` : 'no separate rest-day dose');
  if ((a.time || '') !== (b.time || '')) out.push(b.time ? `time ${formatHm(b.time)}` : 'no time');
  if ((a.withFood || '') !== (b.withFood || '')) out.push(b.withFood ? FOOD_TEXT[b.withFood] : 'with food not set');
  if (JSON.stringify(a.days) !== JSON.stringify(b.days)) out.push(daysText(b.days));
  if (JSON.stringify(a.stock?.servings) !== JSON.stringify(b.stock?.servings) || a.stock?.countedAt !== b.stock?.countedAt) out.push(b.stock ? `${b.stock.servings} servings left` : 'stock not tracked');
  if (JSON.stringify(a.perTake) !== JSON.stringify(b.perTake)) out.push(`servings per tick ${b.perTake.train} (training day) / ${b.perTake.rest} (rest day)`);
  if ((a.note || '') !== (b.note || '')) out.push('note');
  return out.join(', ');
}

export function render(view, [id]) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo; let alive = true;
  const isNew = id === 'new';

  const draw = async () => {
    const today = isoDate(new Date());
    const [all, log] = await Promise.all([repo.list('supplements'), repo.list('supp-log')]);
    if (!alive) return;
    const cur = isNew ? { id: newId('supp'), kind: 'supplement', name: '', short: '', dose: '', doseRest: null, time: null, withFood: null, days: { type: 'daily' }, status: 'active',
      history: [{ on: today, status: 'active' }], stock: null, perTake: { train: 1, rest: 1 }, note: '', order: all.length, source: `Added in the app, ${today}`, changes: [] }
      : all.find((x) => x.id === id);
    if (!cur) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/supps/list">Back</a></div><p class="hint">Not found.</p>'; return; }
    const st = stockStatus(cur, log);
    const status = statusOn(cur, today);
    let days = { ...cur.days };
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/supps/list">My list</a>${!isNew ? `<span class="hud ${status === 'active' ? 'c-green' : 'c-amber'}">${esc(status.toUpperCase())}</span>` : ''}</div>
      <h1 class="view-title">${isNew ? 'Add a supplement' : esc(cur.name)}</h1>
      <form class="card pad-card supp-form" id="sf">
        <div class="field"><label for="sf-name">Name</label><input class="input" id="sf-name" value="${esc(cur.name)}" maxlength="60" required></div>
        <div class="field"><label for="sf-dose">Dose</label><input class="input" id="sf-dose" value="${esc(cur.dose)}" maxlength="80" placeholder="as on your label"></div>
        <div class="field"><label for="sf-rest">Different dose on rest days (optional)</label><input class="input" id="sf-rest" value="${esc(cur.doseRest || '')}" maxlength="80"></div>
        <div class="field"><label for="sf-time">Time of day</label><span class="row-fields"><input class="input" type="time" id="sf-time" value="${esc(cur.time || '')}"><button class="btn-ghost small" type="button" id="sf-notime">No time</button></span></div>
        <div class="field"><label>With food</label><div class="seg" role="group">${FOOD.map(([v, l]) => `<button class="pill ${(cur.withFood || '') === v ? 'is-on' : ''}" type="button" data-food="${v}">${l}</button>`).join('')}</div></div>
        <div class="field"><label>Which days</label><div class="seg" role="group">
          <button class="pill" type="button" data-days="daily">Every day</button><button class="pill" type="button" data-days="weekdays">Some days</button><button class="pill" type="button" data-days="perWeek">Days a week</button></div>
          <div id="sf-days"></div></div>
        <div class="field"><label for="sf-stock">Servings left</label><span class="row-fields"><input class="input mini num" id="sf-stock" inputmode="decimal" value="${st ? st.left : ''}" placeholder="count">
          <span class="hint">${st ? `${lastsText(st.days)} at your pace` : 'Leave empty to not track stock'}</span></span></div>
        <div class="field"><label>Servings one tick uses</label><span class="row-fields"><span class="hint">Training day</span><input class="input mini num" id="sf-pt" inputmode="decimal" value="${cur.perTake?.train ?? 1}">
          <span class="hint">Rest day</span><input class="input mini num" id="sf-pr" inputmode="decimal" value="${cur.perTake?.rest ?? 1}"></span></div>
        <div class="field"><label for="sf-note">Note</label><textarea class="input area" id="sf-note" rows="2" maxlength="400">${esc(cur.note || '')}</textarea></div>
        <button class="btn-primary" type="submit">Save</button>
      </form>
      ${!isNew ? `<div class="btn-row">${status === 'active' ? '<button class="btn-ghost" id="sf-pause" type="button">Pause</button>' : '<button class="btn-ghost" id="sf-resume" type="button">Take it again</button>'}
        ${status !== 'removed' ? '<button class="btn-ghost btn-danger" id="sf-remove" type="button">Remove from my list</button>' : ''}</div>` : ''}
      ${cur.source || cur.changes?.length ? `<details class="notes"><summary>Source and changes</summary><p class="hint">${esc(cur.source || '')}</p>
        ${(cur.changes || []).map((c) => `<p class="hint">${esc(c.on)}: ${esc(c.text)}</p>`).join('')}</details>` : ''}`;

    const $ = (s) => view.querySelector(s);
    let food = cur.withFood || '';
    let time = cur.time || '';
    const drawDays = () => {
      view.querySelectorAll('[data-days]').forEach((b) => b.classList.toggle('is-on', b.dataset.days === days.type));
      const box = $('#sf-days');
      if (days.type === 'weekdays') box.innerHTML = `<div class="chips">${WEEKDAYS.map((d, i) => `<button class="chip ${(days.weekdays || []).includes(i) ? 'is-on' : ''}" type="button" data-wd="${i}">${d.slice(0, 3)}</button>`).join('')}</div>`;
      else if (days.type === 'perWeek') box.innerHTML = `<span class="row-fields"><select class="input mini" id="sf-count">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${days.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">days a week, day off</span>
        <select class="input mini" id="sf-off"><option value="">not set</option>${WEEKDAYS.map((d, i) => `<option value="${i}" ${days.offDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></span>
        ${days.count === 6 ? '' : '<p class="hint">With fewer than 6 days, pick the days with Some days instead; this setting counts it for stock only.</p>'}`;
      else box.innerHTML = '';
      box.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.wd); const set = new Set(days.weekdays || []);
        if (set.has(i)) set.delete(i); else set.add(i);
        days = { type: 'weekdays', weekdays: [...set].sort() }; drawDays();
      }));
      $('#sf-count')?.addEventListener('change', (e) => { days = { ...days, count: Number(e.target.value) }; drawDays(); });
      $('#sf-off')?.addEventListener('change', (e) => { days = { ...days, offDay: e.target.value === '' ? null : Number(e.target.value) }; });
    };
    drawDays();
    view.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.days;
      days = t === 'daily' ? { type: 'daily' } : t === 'weekdays' ? { type: 'weekdays', weekdays: cur.days?.weekdays || [] } : { type: 'perWeek', count: cur.days?.count || 6, offDay: cur.days?.offDay ?? null };
      drawDays();
    }));
    view.querySelectorAll('[data-food]').forEach((b) => b.addEventListener('click', () => {
      food = b.dataset.food;
      view.querySelectorAll('[data-food]').forEach((x) => x.classList.toggle('is-on', x === b));
    }));
    $('#sf-time').addEventListener('change', (e) => { time = e.target.value; });
    $('#sf-notime').onclick = () => { time = ''; $('#sf-time').value = ''; };
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#sf-name').value.trim();
      if (!name) { toast('Give it a name.'); return; }
      if (days.type === 'weekdays' && !(days.weekdays || []).length) { toast('Pick at least one day.'); return; }
      const stockIn = $('#sf-stock').value.trim();
      const stockN = stockIn === '' ? null : Number(stockIn.replace(',', '.'));
      if (stockN != null && !(stockN >= 0 && stockN < 10000)) { toast('Servings left: a number.'); return; }
      const pt = Number($('#sf-pt').value.replace(',', '.')); const pr = Number($('#sf-pr').value.replace(',', '.'));
      if (!(pt >= 0 && pt <= 20) || !(pr >= 0 && pr <= 20)) { toast('Servings per tick: 0 to 20.'); return; }
      const stock = stockN == null ? null : (st && stockN === st.left ? cur.stock : { servings: stockN, countedAt: Date.now() });
      const next = {
        ...cur, name, short: cur.short && cur.name === name ? cur.short : name, dose: $('#sf-dose').value.trim(), doseRest: $('#sf-rest').value.trim() || null,
        time: time || null, withFood: food || null, days, stock, perTake: { train: pt, rest: pr }, note: $('#sf-note').value.trim(),
      };
      const what = isNew ? 'Added in the app.' : describe(cur, next);
      if (!what) { location.hash = '#/supps/list'; return; }
      next.changes = [...(cur.changes || []), { on: today, text: isNew ? what : `Changed in the app: ${what}.` }];
      await repo.put('supplements', next.id, next);
      toast(isNew ? `${name} added to your list.` : 'Saved.');
      location.hash = '#/supps/list';
    });
    const setStatus = async (s, text) => {
      const next = withStatus(cur, s, today);
      next.changes = [...(cur.changes || []), { on: today, text }];
      await repo.put('supplements', cur.id, next);
      draw();
    };
    if ($('#sf-pause')) $('#sf-pause').onclick = () => setStatus('paused', 'Paused in the app.');
    if ($('#sf-resume')) $('#sf-resume').onclick = () => setStatus('active', 'Taken again from today.');
    if ($('#sf-remove')) $('#sf-remove').onclick = async () => {
      if (!(await confirmSheet(`Remove ${cur.name} from your list? Its history stays.`, { ok: 'Remove', danger: true }))) return;
      await setStatus('removed', 'Removed in the app.');
      location.hash = '#/supps/list';
    };
  };

  ready.then((r) => { repo = r; draw(); });
  return () => { alive = false; };
}
