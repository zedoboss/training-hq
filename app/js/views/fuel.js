// FUEL (#/fuel, #/fuel/<YYYY-MM-DD>): the day's meals and totals against his daily targets, LOG MEAL (camera), meals
// without a photo, his meal times. #/fuel/check/<date>/<HHMM> answers a meal-time reminder: eaten, cooking or skipping.
// Supplements and the sauna join this screen later in step 6.
import { ready, saveSettings } from '../lib/data.js';
import { withDefaults } from '../lib/settings.js';
import { mealTimesOf, MEAL_NUDGE } from '../lib/fuel-reminders.js';
import { MEAL_NAMES } from '../lib/meals.js';
import { actionSheet, overlay } from '../ui/sheet.js';
import { formatHm } from '../lib/time.js';
import { getState, subscribe } from '../lib/store.js';
import { isoDate, formatDay, formatTime, daysBetween, timeAt } from '../lib/time.js';
import { addDays } from '../lib/rotation.js';
import { dayTotals, mealTotals, mealState, STATE_SHORT, presetsOf, mealFromPreset, itemTotals } from '../lib/meals.js';
import { newId } from '../lib/routines.js';
import { logMealFromFile, logMealManual, cameraInput, presetsNear } from './meal.js';
import { photoTime } from '../lib/photos.js';
import { wakingDayAt } from '../lib/waking-day.js';
import { dayKindOn } from './supps.js';
import { checklist } from '../lib/supplements.js';
import { toast } from '../ui/toast.js';
import { fastingOn, withFast } from '../lib/fast.js';
import { daysByDate } from '../lib/rotation.js';
import { loadFoods, planItems, SOURCE_NOTE, myFoods, itemAmount } from '../lib/foods.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAMERA = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const n0 = (x) => Math.round(x || 0).toLocaleString('en-US');
const dayLabel = (iso) => formatDay(new Date(`${iso}T12:00:00`));

/** His daily targets from the fuel plan (brief section 3, decision 19), or null before the first sync. */
export const targetsOf = (plan) => (plan && plan.kcal ? { kcal: Number(plan.kcal), proteinG: Number(plan.proteinG) } : null);

/** Meal times editor (Settings > Fuel and the Fuel screen). Saves settings fuel.mealTimes. */
export function editMealTimes() {
  return new Promise((resolve) => {
    let rows = mealTimesOf(withDefaults(getState().settings).fuel.mealTimes).map((t) => ({ ...t }));
    const { el, close } = overlay(`<form class="sheet-form meal-edit"><div class="hud c-muted sheet-title">YOUR USUAL MEAL TIMES</div>
      <p class="hint">When one passes with nothing logged, the app asks: eaten, cooking, or skipping? With a latest time it asks at the meal time and says when it's late; with cook minutes it tells you when to start cooking. None set: no meal-time reminders.</p>
      <div class="me-rows"></div><button class="btn-ghost" type="button" data-add>+ Add a meal time</button>
      <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Save</button></div></form>`, () => resolve());
    const box = el.querySelector('.me-rows');
    const read = () => [...box.querySelectorAll('.mt-row')].map((r) => ({
      name: r.querySelector('[data-f=name]').value.trim(), time: r.querySelector('[data-f=time]').value,
      latest: r.querySelector('[data-f=latest]').value || null, cookMin: Number(r.querySelector('[data-f=cook]').value) || null,
    }));
    const draw = () => {
      box.innerHTML = rows.map((t, i) => `<div class="mt-row" data-i="${i}"><input class="input" data-f="name" value="${esc(t.name)}" maxlength="30" aria-label="Meal name">
        <input class="input" type="time" data-f="time" value="${esc(t.time)}" aria-label="Time"><button class="icon-mini" type="button" data-del aria-label="Remove">✕</button>
        <label class="mt-sub">Latest<input class="input" type="time" data-f="latest" value="${esc(t.latest || '')}" aria-label="Latest time for ${esc(t.name)}"></label>
        <label class="mt-sub">Cook<input class="input" inputmode="numeric" data-f="cook" value="${t.cookMin ? esc(t.cookMin) : ''}" placeholder="min" aria-label="Minutes to cook ${esc(t.name)}"></label></div>`).join('') || '<p class="hint">None yet.</p>';
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { rows = read(); rows.splice(Number(b.closest('.mt-row').dataset.i), 1); draw(); }));
    };
    draw();
    el.querySelector('[data-add]').onclick = () => { rows = read(); rows.push({ name: MEAL_NAMES.find((n) => !rows.some((r) => r.name === n)) || 'Meal', time: '12:00' }); draw(); };
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const clean = mealTimesOf(read());
      if (clean.length !== read().length) { toast('Each meal time needs a name and a time.'); return; }
      if (read().some((t) => t.latest && t.latest <= t.time)) { toast('A latest time has to be after the meal time.'); return; }
      await saveSettings({ fuel: { mealTimes: clean.map(({ name, time, latest, cookMin }) => ({ name, time, ...(latest ? { latest } : {}), ...(cookMin ? { cookMin } : {}) })) } });
      toast(clean.length ? `Meal times saved: ${clean.map((t) => `${t.name} ${formatHm(t.time)}${t.latest ? ` (latest ${formatHm(t.latest)})` : ''}`).join(', ')}.` : 'No meal times: no meal-time reminders.');
      close();
    });
  });
}

/** His planned day (A6): the foods of his diet plan with USDA (or label) values, against his targets. */
async function showPlan(repo) {
  const [plan, db] = await Promise.all([repo.get('fuel', 'plan'), loadFoods().catch(() => null)]);
  if (!plan?.foods?.length) { toast('No planned foods yet.'); return; }
  const p = planItems(db, plan);
  const n1 = (x) => String(Math.round((x || 0) * 10) / 10);
  const { el, close } = overlay(`<div class="sheet-form plan-day"><div class="hud c-muted sheet-title">YOUR PLANNED DAY</div>
    <div class="meal-est-head hud c-muted"><span>FOOD</span><span>G · KCAL · PROTEIN</span></div>
    ${p.items.map((x, i) => `<div class="meal-row"><span>${esc(x.name)}${x.source === 'usda' ? '<span class="src-tag">USDA</span>' : x.source === 'label' ? '<span class="src-tag">LABEL</span>' : ''}${plan.foods[i].perDay ? ` <span class="c-faint">${esc(plan.foods[i].perDay)}</span>` : ''}</span><span class="mono">${n0(x.grams)} · ${n0(x.kcal)} · ${n1(x.protein)}</span></div>`).join('')}
    <div class="meal-total"><span>Planned day</span><span class="mono c-cyan">${n0(p.kcal)} kcal · ${n1(p.protein)} g</span></div>
    ${plan.kcal ? `<p class="hint">Your targets: ${n0(plan.kcal)} kcal, ${plan.proteinG} g protein a day.${plan.bottomUpNote ? ` ${esc(plan.bottomUpNote)}` : ''}</p>` : ''}
    <p class="hint">${esc(SOURCE_NOTE)}; raw weights unless it says cooked. ${esc(plan.foodsSource || '')}</p>
    <div class="btn-row"><button class="btn-primary" type="button" data-close>Close</button></div></div>`, () => {});
  el.querySelector('.sheet').classList.add('sheet-tall');
  el.querySelector('[data-close]').onclick = () => close();
}

/** Targets editor: kcal and protein per day, saved in the fuel plan with a dated change note. */
async function editTargets(repo) {
  const plan = await repo.get('fuel', 'plan') || {};
  const { el, close } = overlay(`<form class="sheet-form"><div class="hud c-muted sheet-title">DAILY TARGETS</div>
    <p class="hint">${esc(plan.source || 'Your own numbers.')}</p>
    <label class="opt"><span>Kcal per day</span><input class="input mini num" id="t-kcal" inputmode="decimal" value="${plan.kcal ?? ''}"></label>
    <label class="opt"><span>Protein per day (g)</span><input class="input mini num" id="t-prot" inputmode="decimal" value="${plan.proteinG ?? ''}"></label>
    <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Save</button></div></form>`);
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kcal = Number(el.querySelector('#t-kcal').value); const p = Number(el.querySelector('#t-prot').value);
    if (!(kcal >= 800 && kcal <= 8000) || !(p >= 20 && p <= 500)) { toast('Kcal 800-8,000 and protein 20-500 g.'); return; }
    if (kcal === plan.kcal && p === plan.proteinG) { close(); return; }
    const on = isoDate(new Date());
    await repo.put('fuel', 'plan', { ...plan, kind: 'plan', kcal, proteinG: p, changes: [...(plan.changes || []), { on, text: `Changed in the app: ${kcal} kcal, ${p} g protein (was ${plan.kcal ?? 'none'} kcal, ${plan.proteinG ?? 'none'} g).` }] });
    toast('Targets saved.');
    close();
  });
}

const ANSWER = { eaten: 'Eaten', soon: 'About to cook', cooking: 'Cooking', skipped: 'Skipping' };
/** Today at "HH:MM" on this device (which preset suits a meal time). */
const zonedTimeLocal = (hm) => { const d = new Date(); d.setHours(Number(hm.slice(0, 2)), Number(hm.slice(3)), 0, 0); return d.getTime(); };

/** "Eaten, cooking, or skipping?" for one meal time (from a reminder). */
async function answerCheck(repo, date, hmId) {
  const slot = mealTimesOf(withDefaults(getState().settings).fuel.mealTimes).find((t) => t.time.replace(':', '') === hmId);
  const name = slot?.name || 'Meal';
  const save = (answer) => repo.put('meal-checks', `${date}.${hmId}`, { id: `${date}.${hmId}`, date, slot: slot?.time ?? null, name, answer, at: Date.now() });
  // Thu 10/22 (his words: "a button which should log a normal meal from the ones I already have"): eaten as usual, one
  // tap, the preset for this meal time first.
  const usual = (await presetsNear(slot ? zonedTimeLocal(slot.time) : Date.now())).map((p) => ({ label: `Eaten: ${p.name}, as usual`, run: async () => {
    const id = newId('meal');
    const at = Date.now();
    await repo.put('meals', id, mealFromPreset({ id, at, preset: p, date: await wakingDayAt(repo, at) }));
    await save('eaten');
    const pt = itemTotals(p.items);
    toast(`Logged ${p.name}: ${n0(pt.kcal)} kcal, ${pt.protein} g protein. Tap it below to change it.`);
  } }));
  actionSheet(`${name}: eaten, cooking, or skipping?`, [
    ...usual,
    // The camera must open inside the tap itself (iPhone rule), so it is clicked before the answer is saved.
    { label: 'Eaten: take the photo now', run: () => { document.querySelector('#f-cam')?.click(); save('eaten'); } },
    { label: 'Eaten: log it without a photo', run: () => { document.querySelector('#f-manual')?.click(); save('eaten'); } },
    { label: 'About to cook: ask me in 5 minutes', run: async () => { await save('soon'); toast('Asking again in 5 minutes.'); } },
    { label: `Cooking: check back in ${MEAL_NUDGE.cookingMin} minutes`, run: async () => { await save('cooking'); toast(`Checking back in ${MEAL_NUDGE.cookingMin} minutes.`); } },
    { label: 'Skipping it', run: async () => { await save('skipped'); toast(`${name} skipped.`); } },
  ]);
}

export function render(view, params) {
  // Today is his waking day (Sat 10/24): after midnight, before he has slept, Fuel is still the day before.
  let today = isoDate(new Date());
  const checking = params[0] === 'check';
  const dateParam = checking ? params[1] : params[0];
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : null;
  let date = asked || today;
  view.innerHTML = `<div id="f-body"><p class="view-sub">Loading…</p></div>${cameraInput('f-cam')}`;
  const body = view.querySelector('#f-body');
  let repo; let alive = true; let off = () => {};
  view.querySelector('#f-cam').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { location.hash = `#/meal/${await logMealFromFile(f, { at: await photoTime(f) })}`; } catch { toast('That photo could not be read.'); }
  });

  const draw = async () => {
    today = await wakingDayAt(repo);
    if (!asked) date = today;
    const [meals, estimates, photos, plan, checks, dayList, presetDoc] = await Promise.all([repo.list('meals'), repo.list('meal-estimates'), repo.list('meal-photos'), repo.get('fuel', 'plan'), repo.list('meal-checks'), repo.list('days'), repo.get('fuel', 'presets')]);
    if (!alive) return;
    // A fasting day (Wed 10/21): no target, no "to go"; a meal logged after it began ends it.
    const days = daysByDate(dayList);
    const fasting = fastingOn(days, date, meals);
    const fast = days[date]?.fast;
    const tg = targetsOf(plan);
    const times = mealTimesOf(withDefaults(getState().settings).fuel.mealTimes);
    const presets = presetsOf(presetDoc);
    const mine = myFoods(plan);
    const dayChecks = checks.filter((c) => c.date === date && c.answer !== 'eaten');
    const n1 = (x) => String(Math.round((x || 0) * 10) / 10);
    const bar = (label, val, target, unit, cls, f = n0) => `<div class="fuel-bar"><span class="hud c-muted">${label}</span>
      <span class="fuel-track"><span class="fuel-fill ${cls}" style="width:${Math.min(100, Math.round((val / target) * 100))}%"></span></span>
      <span class="mono">${f(val)}${unit} <span class="c-faint">/ ${f(target)}${unit}</span></span></div>`;
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
      ${fasting ? `<section class="card pad-card fuel-fast" id="f-fast"><div class="hud c-cyan">FASTING ${date === today ? 'TODAY' : ''} · SINCE ${esc(formatTime(new Date(fast.at)).toUpperCase())}</div>
        <p class="hint c-text">No food target, no cooking, meal-time or supplement reminders ${date === today ? 'today' : 'that day'}. Walks are the push. ${date === today ? 'Tomorrow is back to normal by itself; logging a meal ends the fast now.' : ''}</p>
        ${date === today ? '<button class="btn-ghost" id="f-fast-end" type="button">End the fast</button>' : ''}</section>` : ''}
      <section class="card pad-card fuel-totals" id="f-totals"${fasting ? ' hidden' : ''}>
        <div class="fuel-total"><span class="hud c-muted">KCAL</span><b>${n0(t.kcal)}</b>${tg ? `<small>${tg.kcal > t.kcal ? `${n0(tg.kcal - t.kcal)} to go` : 'target reached'}</small>` : ''}</div>
        <div class="fuel-total"><span class="hud c-muted">PROTEIN</span><b>${Math.round(t.protein * 10) / 10} g</b>${tg ? `<small>${tg.proteinG > t.protein ? `${n1(tg.proteinG - t.protein)} g to go` : 'target reached'}</small>` : ''}</div>
        <div class="fuel-total"><span class="hud c-muted">MEALS</span><b>${t.meals}</b></div>
        ${tg ? `${bar('KCAL', t.kcal, tg.kcal, '', '')}${bar('PROTEIN', t.protein, tg.proteinG, ' g', 'is-protein', n1)}
          <button class="link-btn" id="f-targets" type="button">Targets: ${n0(tg.kcal)} kcal · ${tg.proteinG} g protein a day</button>
          ${plan?.foods?.length ? '<button class="link-btn" id="f-plan" type="button">Your planned day ›</button>' : ''}` : '<p class="hint">Targets arrive with the first sync from your Mac.</p>'}
        ${t.estimated || t.unread ? `<p class="hint">${[t.estimated ? `${t.estimated} meal${t.estimated === 1 ? '' : 's'} still an estimate (not confirmed)` : '', t.unread ? `${t.unread} still being read by the Mac` : ''].filter(Boolean).join(' · ')}.</p>` : ''}
      </section>
      ${date === today ? `<div class="fuel-log">
        <label class="btn-primary fuel-cam file-btn" for="f-cam">${CAMERA}<span>LOG MEAL</span></label>
        <button class="btn-ghost" id="f-manual" type="button">No photo</button></div>
        ${presets.length ? `<div class="fuel-presets" id="f-presets"><span class="hud c-muted">SAME AS USUAL · ONE TAP LOGS IT</span>${presets.map((p) => { const pt = itemTotals(p.items); return `<button class="btn-ghost fuel-preset" type="button" data-preset="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.items.map((x) => { const w = itemAmount(x, mine); return /with shell/.test(w) ? w : x.portion || x.name.split(/[,(]/)[0].trim(); }).join(', '))} · ${n0(pt.kcal)} kcal · ${pt.protein} g protein</small></button>`; }).join('')}</div>` : ''}
        ${!fasting ? '<button class="link-btn" id="f-fast-start" type="button">Fasting today?</button>' : ''}
        <p class="hint">Take the before photo. The Mac names the foods and estimates grams from your packs and usual amounts; kcal and protein come from USDA values. You confirm or fix (Fix has one-tap packs and counts).</p>` : ''}
      ${queued ? '<p class="hint c-amber">Mac unreachable: photos are kept on this phone and read when it is back.</p>' : ''}
      ${date === today ? `<section class="card pad-card fuel-times"><div class="ex-head"><span class="hud c-muted">MEAL TIMES</span><button class="link-btn" id="f-times" type="button">${times.length ? 'Change' : 'Set them'}</button></div>
        ${times.length ? `<p class="hint c-text">${times.map((x) => `${esc(x.name)} ${formatHm(x.time)}`).join(' · ')}</p>` : '<p class="hint">Not set yet, so no meal-time reminders. Set your usual times and the app asks when one passes with nothing logged.</p>'}
        ${dayChecks.length ? `<p class="hint">${dayChecks.map((c) => `${esc(c.name)}: ${ANSWER[c.answer].toLowerCase()}`).join(' · ')}</p>` : ''}</section>` : ''}
      ${date === today ? `<a class="card supp-card" href="#/supps" id="f-supps"><span class="hud c-amber">SUPPLEMENTS</span><span class="supp-card-line" id="f-supps-line">Your checklist</span><span class="pill is-on">Open</span></a>` : ''}
      <a class="card supp-card" href="#/micro/${esc(date)}" id="f-micro"><span class="hud c-cyan">VITAMINS & MINERALS</span><span class="supp-card-line">From what you logged, against your Diet.html references</span><span class="pill is-on">Open</span></a>
      ${date === today ? '<a class="card supp-card" href="#/sauna" id="f-sauna"><span class="hud c-cyan">SAUNA</span><span class="supp-card-line">The ladder, the checklist and the hard stops</span><span class="pill is-on">Open</span></a>' : ''}
      <div class="section-label">${list.length ? `Meals · ${list.length}` : 'No meals logged'}</div>
      <ul class="meal-list">${list.map((m) => {
        const mt = mealTotals(m, estimates);
        const s = mealState(m, estimates);
        const img = thumb.get(m.before?.photoId);
        return `<li><a class="card meal-item" href="#/meal/${esc(m.id)}">
          ${img ? `<img class="meal-thumb" src="${img}" alt="">` : '<span class="meal-thumb is-empty" aria-hidden="true"></span>'}
          <span class="meal-item-main"><b>${esc(m.name)}</b> <span class="c-muted">${esc(timeAt(m.at, m))}</span>
            <span class="hint">${mt.known ? `${n0(mt.kcal)} kcal · ${Math.round(mt.protein * 10) / 10} g protein${mt.estimated ? ' · estimate' : ''}` : ''}</span></span>
          <span class="hud ${s === 'done' ? 'c-green' : 'c-amber'} meal-state">${esc(STATE_SHORT[s])}</span></a></li>`;
      }).join('')}</ul>`;
    // Supplements card: taken of due today, and the next time with something open.
    const line = body.querySelector('#f-supps-line');
    if (line) {
      const [supps, slog, dk] = await Promise.all([repo.list('supplements'), repo.list('supp-log'), dayKindOn(repo, date)]);
      const groups = checklist({ supps, log: slog, date, dayKind: dk });
      const due = groups.flatMap((g) => g.items);
      const next = groups.find((g) => g.open.length);
      if (alive) line.textContent = due.length ? `${due.filter((i) => i.entry?.status === 'taken').length} of ${due.length} taken${next ? ` · next: ${next.label}${next.time ? ` ${formatHm(next.time)}` : ''}` : ' · all answered'}` : 'Nothing scheduled today';
    }
    body.querySelector('#f-targets')?.addEventListener('click', () => editTargets(repo));
    body.querySelector('#f-plan')?.addEventListener('click', () => showPlan(repo));
    body.querySelector('#f-times')?.addEventListener('click', () => editMealTimes());
    const fastStart = body.querySelector('#f-fast-start');
    if (fastStart) fastStart.onclick = async () => {
      await repo.put('days', today, withFast(days[today], today, { on: true, by: 'tap' }, Date.now()));
      toast('Fasting today: no food or supplement reminders until tomorrow.');
    };
    const fastEnd = body.querySelector('#f-fast-end');
    if (fastEnd) fastEnd.onclick = async () => {
      await repo.put('days', today, withFast(days[today], today, { on: false }, Date.now()));
      toast('Fast ended: meal and supplement reminders are back.');
    };
    // Thu 10/22 (his words: "have them as presets basically"): one tap logs a preset as eaten now.
    body.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = async () => {
      const preset = presets.find((p) => p.id === b.dataset.preset);
      if (!preset) return;
      b.disabled = true;
      const id = newId('meal');
      const at = Date.now();
      await repo.put('meals', id, mealFromPreset({ id, at, preset, date: await wakingDayAt(repo, at) }));
      const pt = itemTotals(preset.items);
      toast(`Logged ${preset.name}: ${n0(pt.kcal)} kcal, ${pt.protein} g protein. Tap it below to change or delete.`);
    }; });
    const man = body.querySelector('#f-manual');
    // Thu 10/22: nothing is saved until he saves what he ate (an empty meal, saved at the tap, synced while he typed and
    // the Mac took it for his second meal: "Dinner done. Get up and take your collagen now"). His presets come first.
    if (man) man.onclick = async () => {
      const { editItems } = await import('./meal.js');
      const items = await editItems('WHAT YOU ATE', [], { presets: await presetsNear() });
      if (!items?.length) return;
      const id = await logMealManual({ items });
      const pt = itemTotals(items);
      toast(`Logged ${items.presetName || 'it'}: ${n0(pt.kcal)} kcal, ${pt.protein} g protein.`);
      location.hash = `#/meal/${id}`;
    };
  };

  // Redraw when the Mac link or the waiting count changes, not on every sync tick.
  let net = null;
  const unsub = subscribe((s) => { const k = `${s.paired}|${s.mac.reachable}|${s.sync.pending > 0}`; if (k !== net) { const first = net === null; net = k; if (!first && alive && repo) draw(); } });
  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.some((c) => ['meals', 'meal-estimates', 'meal-photos', 'settings', 'fuel', 'meal-checks', 'supplements', 'supp-log', 'days', 'sleep-log'].includes(c))) draw(); });
    draw().then(() => { if (checking && alive) answerCheck(repo, date, params[2]); });
  });
  return () => { alive = false; off(); unsub(); };
}
