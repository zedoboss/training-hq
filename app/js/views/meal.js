// MEAL (#/meal/<id>): one meal, laid out as the design board "Fuel: log a meal". BEFORE and AFTER photos, the scale
// reading, the Mac's estimate (items, grams, kcal, protein) and his confirmation. Photos are kept on the phone and
// go to the Mac with the next sync; the Mac reads them (6.2) and its estimate comes back by sync.
import { ready, syncNow } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { fileToJpeg, newPhotoId } from '../lib/photos.js';
import { newId } from '../lib/routines.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, formatTime, isoDate, timeAt, dayAt } from '../lib/time.js';
import {
  MEAL_NAMES, defaultMealName, newMeal, cleanItems, itemTotals, regram, scaleTo, currentEstimate, beforeItems, leftovers,
  netItems, mealState, STATE_TEXT, afterPhotoAt,
} from '../lib/meals.js';
import { actionSheet, confirmSheet, promptText, promptLong, overlay } from '../ui/sheet.js';
import { loadFoods, searchFoods, foodItem, withUsda, per100, shortName, SOURCE_NOTE } from '../lib/foods.js';

const SOURCE_LABEL = 'SR Legacy and Foundation Foods';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAMERA = '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const MIC = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const n0 = (x) => Math.round(x || 0).toLocaleString('en-US');
const n1 = (x) => String(Math.round((x || 0) * 10) / 10);

/** A new meal from a before photo: the photo is stored first, then the meal, and both sync to the Mac. */
export async function logMealFromFile(file, { at = Date.now() } = {}) {
  const repo = await ready;
  const dataUrl = await fileToJpeg(file);
  const mealId = newId('meal');
  const photoId = newPhotoId();
  await repo.put('meal-photos', photoId, { id: photoId, mealId, kind: 'before', dataUrl, at });
  const name = defaultMealName(at, withDefaults(getState().settings).fuel?.mealTimes);
  await repo.put('meals', mealId, newMeal({ id: mealId, at, photoId, name }));
  syncNow();
  return mealId;
}

/** A meal typed in by hand (no photo). */
export async function logMealManual({ at = Date.now() } = {}) {
  const repo = await ready;
  const mealId = newId('meal');
  const name = defaultMealName(at, withDefaults(getState().settings).fuel?.mealTimes);
  await repo.put('meals', mealId, newMeal({ id: mealId, at, name }));
  return mealId;
}

/**
 * The camera input. It lives outside the part of the screen that redraws (labels point at it with for=), so a sync
 * or an estimate arriving while the camera is open can't swap it out from under the photo.
 */
export const cameraInput = (id) => `<input type="file" accept="image/*" capture="environment" hidden id="${id}">`;

/** His own foods (fuel plan) with a USDA id: suggested first, named his way. */
async function myFoodsList() {
  const plan = await (await ready).get('fuel', 'plan');
  return (plan?.foods || []).filter((f) => f?.fdcId).map((f) => ({ fdcId: Number(f.fdcId), name: f.name }));
}

const SOURCE_TEXT = { usda: 'USDA', typed: 'your numbers', estimate: 'estimate', label: 'pack label' };

/**
 * Item editor sheet. Resolves to the new items, or null if cancelled.
 * A5: the food box suggests his own foods, then USDA FoodData Central foods; a USDA food's kcal and protein follow its
 * grams exactly. Typing kcal or protein makes them his numbers. On Save, a typed name with no numbers is matched to
 * USDA when it can be.
 */
export function editItems(title, items) {
  return new Promise((resolve) => {
    let result = null;
    let rows = cleanItems(items);
    if (!rows.length) rows = [{ name: '', grams: 0, kcal: 0, protein: 0, unsure: false }];
    let db = null; let mine = [];
    const dbReady = Promise.all([loadFoods(), myFoodsList()]).then(([d, m]) => { db = d; mine = m; }).catch(() => {});
    const { el, close } = overlay(`<form class="sheet-form meal-edit"><div class="hud c-muted sheet-title">${esc(title)}</div>
      <div class="me-head hud c-faint"><span>FOOD</span><span>G</span><span>KCAL</span><span>PROT</span><span></span></div>
      <div class="me-rows"></div>
      <button class="btn-ghost" type="button" data-add>+ Add item</button>
      <p class="hint">${esc(SOURCE_NOTE)} (${esc(SOURCE_LABEL)}).</p>
      <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Save</button></div></form>`,
    () => resolve(result));
    el.querySelector('.sheet').classList.add('sheet-tall');
    const box = el.querySelector('.me-rows');
    const val = (r, f) => r.querySelector(`[data-f=${f}]`).value;
    // The row's numbers as shown, keeping what the screen doesn't show (USDA id, where the numbers came from).
    const read = () => [...box.querySelectorAll('.me-row')].map((r, i) => ({
      ...rows[i], name: val(r, 'name').trim(), grams: Number(val(r, 'grams')) || 0, kcal: Number(val(r, 'kcal')) || 0, protein: Number(val(r, 'protein')) || 0, unsure: false,
    }));
    const usdaFor = (x) => (db && x.fdcId && x.source === 'usda' ? db.byId.get(x.fdcId) : null);
    const line = (x) => {
      const f = usdaFor(x);
      if (f) return `USDA · ${f.name} · ${Math.round(per100(db, f, 'kcal') ?? 0)} kcal, ${per100(db, f, 'protein') ?? 0} g protein per 100 g`;
      return x.source ? SOURCE_TEXT[x.source] || '' : '';
    };
    const draw = () => {
      box.innerHTML = rows.map((x, i) => `<div class="me-item" data-i="${i}"><div class="me-row">
        <input class="input" data-f="name" value="${esc(x.name)}" placeholder="Food" aria-label="Food" maxlength="80" autocomplete="off">
        <input class="input" data-f="grams" inputmode="decimal" value="${x.grams || ''}" aria-label="Grams">
        <input class="input" data-f="kcal" inputmode="decimal" value="${x.kcal || ''}" aria-label="Kcal">
        <input class="input" data-f="protein" inputmode="decimal" value="${x.protein || ''}" aria-label="Protein grams">
        <button class="icon-mini" type="button" data-del aria-label="Remove">✕</button></div>
        <div class="me-src hint">${esc(line(x))}</div><div class="me-sugg" hidden></div></div>`).join('');
      box.querySelectorAll('.me-item').forEach((item) => {
        const i = Number(item.dataset.i);
        const name = item.querySelector('[data-f=name]');
        const sugg = item.querySelector('.me-sugg');
        let t = null;
        name.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            await dbReady;
            const q = name.value.trim();
            if (!db || q.length < 2) { sugg.hidden = true; return; }
            const found = searchFoods(db, q, { limit: 6, prefer: mine.map((m) => m.fdcId) });
            const minesFirst = mine.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()) && !found.some((r) => r.food.id === m.fdcId)).map((m) => ({ food: db.byId.get(m.fdcId) })).filter((r) => r.food);
            const list = [...minesFirst, ...found].slice(0, 6);
            sugg.innerHTML = list.map((r) => { const m = mine.find((y) => y.fdcId === r.food.id); return `<button class="me-pick" type="button" data-id="${r.food.id}"><span>${esc(m ? m.name : r.food.name)}</span><span class="hud ${m ? 'c-cyan' : 'c-faint'}">${m ? 'YOUR FOOD' : 'USDA'}</span></button>`; }).join('');
            sugg.hidden = !list.length;
            sugg.querySelectorAll('.me-pick').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
            sugg.querySelectorAll('.me-pick').forEach((b) => b.addEventListener('click', () => {
              const food = db.byId.get(Number(b.dataset.id));
              const cur = read();
              const m = mine.find((y) => y.fdcId === food.id);
              cur[i] = foodItem(db, food, cur[i].grams || 0, { name: m ? m.name : shortName(food.name) });
              rows = cur; draw();
              box.querySelector(`.me-item[data-i="${i}"] [data-f=grams]`)?.focus();
            }));
          }, 150);
        });
        name.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 150));
        item.querySelector('[data-f=grams]').addEventListener('change', (e) => {
          const cur = read();
          const f = usdaFor(rows[i]);
          if (f) cur[i] = foodItem(db, f, Number(e.target.value) || 0, { name: cur[i].name });
          else if (rows[i]?.grams) cur[i] = regram({ ...cur[i], grams: rows[i].grams, kcal: cur[i].kcal, protein: cur[i].protein }, Number(e.target.value) || 0);
          rows = cur; draw();
        });
        for (const f of ['kcal', 'protein']) {
          item.querySelector(`[data-f=${f}]`).addEventListener('change', () => { const cur = read(); cur[i] = { ...cur[i], source: 'typed' }; rows = cur; draw(); });
        }
        item.querySelector('[data-del]').addEventListener('click', () => { rows = read(); rows.splice(i, 1); draw(); });
      });
    };
    draw();
    el.querySelector('[data-add]').onclick = () => { rows = [...read(), { name: '', grams: 0, kcal: 0, protein: 0 }]; draw(); box.querySelector('.me-item:last-child [data-f=name]').focus(); };
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await dbReady;
      // A typed name with no numbers of his: USDA values when it matches.
      const list = read().filter((x) => x.name || x.grams || x.kcal);
      result = cleanItems(list.map((x) => {
        if (!db) return x;
        if (x.fdcId && x.source === 'usda') return withUsda(db, [x], { prefer: mine })[0];
        if (x.fdcId || x.kcal || x.protein || x.source) return x;
        const [y] = withUsda(db, [{ ...x, source: undefined }], { prefer: mine });
        return y.source === 'usda' ? y : { ...x, source: 'typed' };
      }));
      close();
    });
  });
}

/** Leftover editor: grams left of each item on the plate. Resolves to [{name, grams, index}] or null. */
function editLeftovers(items, left) {
  return new Promise((resolve) => {
    let result = null;
    const gramsLeft = (i) => (left.find((y) => y.index === i) || left.find((y) => y.index == null && y.name === items[i].name))?.grams ?? 0;
    const { el, close } = overlay(`<form class="sheet-form meal-edit"><div class="hud c-muted sheet-title">LEFT ON THE PLATE (GRAMS)</div>
      ${items.map((x, i) => `<label class="me-left"><span>${esc(x.name)} <span class="c-faint">of ${n0(x.grams)} g</span></span>
        <input class="input" inputmode="decimal" data-i="${i}" value="${gramsLeft(i) || ''}" placeholder="0" aria-label="Grams of ${esc(x.name)} left"></label>`).join('')}
      <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Save</button></div></form>`,
    () => resolve(result));
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      result = [...el.querySelectorAll('[data-i]')].map((inp) => ({ index: Number(inp.dataset.i), name: items[Number(inp.dataset.i)].name, grams: Math.max(0, Math.min(items[Number(inp.dataset.i)].grams, Number(inp.value) || 0)) })).filter((x) => x.grams > 0);
      close();
    });
  });
}

export function render(view, [id]) {
  view.innerHTML = `<div id="m-body"><p class="view-sub">Loading…</p></div>${cameraInput('m-before')}${cameraInput('m-after')}`;
  const body = view.querySelector('#m-body');
  let repo; let alive = true; let off = () => {}; let pollTimer = null; let pollStart = Date.now();
  // A new photo for this meal (before or after); replaces the old one of that kind.
  const addPhoto = (kind) => async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !repo) return;
    try {
      const meal = await repo.get('meals', id);
      const pid = newPhotoId(); const at = Date.now();
      await repo.put('meal-photos', pid, { id: pid, mealId: id, kind, dataUrl: await fileToJpeg(f), at });
      const old = meal[kind]?.photoId;
      await repo.put('meals', id, { ...meal, ...(kind === 'before' ? { before: { photoId: pid, at, scaleG: null, items: null, confirmedAt: null }, source: 'photo' } : { after: { photoId: pid, at, scaleG: null, leftovers: null, none: false, confirmedAt: null } }) });
      if (old) await repo.remove('meal-photos', old);
      pollStart = Date.now(); clearInterval(pollTimer); pollTimer = null;
      syncNow();
    } catch { toast('That photo could not be read.'); }
  };
  view.querySelector('#m-before').addEventListener('change', addPhoto('before'));
  view.querySelector('#m-after').addEventListener('change', addPhoto('after'));
  // Redraw when the Mac link changes (reachable or not), not on every sync tick: typing in the scale box stays put.
  let net = null;
  const unsub = subscribe((s) => { const k = `${s.paired}|${s.mac.reachable}`; if (k !== net) { const first = net === null; net = k; if (!first && alive && repo) draw(); } });

  const draw = async () => {
    const meal = await repo.get('meals', id);
    if (!alive) return;
    if (!meal) { body.innerHTML = '<div class="lib-head"><a class="pill" href="#/fuel">Fuel</a></div><p class="hint">This meal was deleted.</p>'; return; }
    const [photos, estimates] = await Promise.all([repo.list('meal-photos'), repo.list('meal-estimates')]);
    if (!alive) return;
    const photo = (pid) => photos.find((p) => p.id === pid);
    const before = photo(meal.before?.photoId);
    const after = photo(meal.after?.photoId);
    const state = mealState(meal, estimates);
    const estB = currentEstimate(meal, estimates, 'before');
    const estA = currentEstimate(meal, estimates, 'after');
    const b = beforeItems(meal, estimates);
    const l = leftovers(meal, estimates);
    const items = b.items || [];
    const eaten = netItems(items, l.items);
    const tot = itemTotals(eaten);
    const st = getState();
    const offline = st.paired && st.mac.reachable === false;
    const waiting = state === 'reading' || state === 'reading-after';
    const scaleG = meal.before?.scaleG ?? estB?.scaleG ?? null;
    const askAt = formatTime(new Date(afterPhotoAt(meal)));
    const leftName = (i) => items[i]?.name;
    const statusLine = waiting
      ? (!st.paired ? 'Not paired with your Mac: the photo stays on this phone until you pair (Settings).'
        : offline ? 'Mac unreachable. The photo is kept on this phone and read as soon as the Mac is back.'
          : 'Sent to your Mac. Its estimate appears here in a few seconds.')
      : state === 'failed' || state === 'failed-after' ? `${STATE_TEXT[state]}${(state === 'failed' ? estB : estA)?.error ? `: ${(state === 'failed' ? estB : estA).error}` : ''}. Ask again, or type the items in with Fix.`
        : '';
    const headTag = meal.source === 'manual' ? 'WHAT YOU ATE' : meal.before?.confirmedAt ? 'CONFIRMED' : "COACH'S ESTIMATE";
    body.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel/${esc(meal.date)}">Fuel</a>
        <span class="hud c-muted">FUEL · ${esc(dayAt(meal.at, meal).toUpperCase())} · ${esc(timeAt(meal.at, meal).toUpperCase())}</span></div>
      <button class="link-btn meal-name" id="m-name" type="button"><h1 class="view-title">${esc(meal.name)}</h1></button>
      ${meal.source === 'manual' && !before ? '' : `<div class="meal-photos">
        ${before ? `<button class="meal-tile has-photo" type="button" data-photo="before"><img src="${before.dataUrl}" alt="Before photo"><span class="hud c-green">BEFORE · ${esc(timeAt(meal.before.at, meal).toUpperCase())}</span></button>`
          : `<label class="meal-tile is-empty file-btn" for="m-before">${CAMERA}<span class="hud">BEFORE</span></label>`}
        ${after ? `<button class="meal-tile has-photo" type="button" data-photo="after"><img src="${after.dataUrl}" alt="After photo"><span class="hud c-green">AFTER · ${esc(timeAt(meal.after.at, meal).toUpperCase())}</span></button>`
          : meal.after?.none ? '<div class="meal-tile is-none"><span class="hud c-green">AFTER</span><span>Ate it all</span><button class="link-btn" type="button" id="m-undo-none">Undo</button></div>'
            : `<label class="meal-tile is-empty file-btn" for="m-after">${CAMERA}<span class="hud">AFTER</span><span class="hint">I'll ask at ${esc(askAt)}</span></label>`}
      </div>
      ${!meal.after && meal.before?.photoId ? '<button class="btn-ghost" id="m-none" type="button">Ate it all: no after photo</button>' : ''}`}
      ${statusLine ? `<p class="hint ${offline || state.startsWith('failed') ? 'c-amber' : ''}" id="m-status">${esc(statusLine)}</p>` : ''}
      ${meal.before?.photoId ? `<label class="card meal-scale"><span><span class="hud c-muted">SCALE READING</span><span class="hint">${scaleG != null ? 'Read from the photo. Tap to correct.' : estB ? 'No scale seen in the photo. Type it if you weighed it.' : 'Read from the photo when the Mac has it.'}</span></span>
        <span class="meal-scale-in"><input class="input" id="m-scale" inputmode="decimal" value="${scaleG ?? ''}" aria-label="Grams on the scale"><span class="c-muted">g</span></span></label>` : ''}
      <section class="card meal-est">
        <div class="meal-est-head hud c-muted"><span>${headTag}</span><span>G · KCAL · PROTEIN</span></div>
        ${items.length ? items.map((x, i) => `<div class="meal-row"><span>${esc(x.name)}${x.unsure && b.estimated ? ' <span class="tag-unsure">UNSURE</span>' : ''}${x.source === 'usda' ? '<span class="src-tag">USDA</span>' : x.source === 'estimate' ? '<span class="src-tag">EST.</span>' : ''}</span><span class="mono">${n0(x.grams)} · ${n0(x.kcal)} · ${n1(x.protein)}</span></div>`).join('')
          : `<p class="hint">${waiting ? 'Waiting for the estimate.' : meal.source === 'manual' ? 'Nothing yet. Tap Fix to type what you ate.' : 'No items.'}</p>`}
        ${l.items.length ? `<div class="meal-left hud c-amber">LEFT ON THE PLATE${l.estimated ? ' · ESTIMATE' : ''}</div>${l.items.map((x) => `<div class="meal-row c-muted"><span>− ${esc(leftName(x.index) || x.name)}</span><span class="mono">${n0(x.grams)} g</span></div>`).join('')}` : ''}
        ${l.pending && meal.after?.photoId ? '<p class="hint">Leftovers: waiting for the Mac to read the after photo.</p>' : ''}
        <div class="meal-total"><span>${meal.after ? 'Eaten' : 'Total'}</span><span class="mono c-cyan">${n0(tot.grams)} · ${n0(tot.kcal)} · ${n1(tot.protein)}</span></div>
        ${estB?.notes && b.estimated ? `<p class="hint">${esc(estB.notes)}</p>` : ''}
        ${items.some((x) => x.source === 'usda') ? `<p class="hint" id="m-usda">${esc(SOURCE_NOTE)}${items.some((x) => x.source === 'estimate') ? '; EST. = no USDA match, the Mac\'s estimate' : ''}.</p>` : ''}
        <p class="hint">The after photo subtracts what's left on the plate.</p>
      </section>
      <div class="meal-actions">
        <button class="btn-primary meal-ok" id="m-ok" type="button" ${state === 'confirm' || state === 'confirm-after' ? '' : 'disabled'}>LOOKS RIGHT</button>
        <button class="btn-ghost" id="m-fix" type="button">FIX</button>
        <button class="mic-round" id="m-mic" type="button" aria-label="Tell the coach by voice">${MIC}</button>
      </div>
      ${state === 'done' ? `<p class="hint c-green">${meal.source === 'manual' ? 'Saved.' : 'Confirmed.'} Counted in today's totals.</p>` : ''}
      <div class="btn-row"><button class="btn-ghost" id="m-again" type="button" ${meal.before?.photoId ? '' : 'hidden'}>Ask the Mac again</button>
        <button class="btn-ghost" id="m-more" type="button">More</button></div>`;

    // While the Mac is reading a photo, ask it every 3 seconds (for up to 2 minutes) so the estimate shows promptly.
    if (waiting && st.paired && !offline) {
      if (!pollTimer) pollTimer = setInterval(() => { if (!alive || Date.now() - pollStart > 120000) { clearInterval(pollTimer); pollTimer = null; } else syncNow(); }, 3000);
    } else { clearInterval(pollTimer); pollTimer = null; pollStart = Date.now(); }
    const $ = (s) => body.querySelector(s);
    const save = (patch) => repo.put('meals', id, { ...meal, ...patch });
    $('#m-name').onclick = () => actionSheet('Which meal?', [...MEAL_NAMES.map((n) => ({ label: n, run: () => save({ name: n }) })),
      { label: 'Other name…', run: async () => { const n = await promptText('Meal name', meal.name); if (n) save({ name: n }); } }]);
    if ($('#m-none')) $('#m-none').onclick = () => save({ after: { photoId: null, at: Date.now(), none: true, leftovers: [], confirmedAt: Date.now() } });
    if ($('#m-undo-none')) $('#m-undo-none').onclick = () => save({ after: null });
    body.querySelectorAll('[data-photo]').forEach((t) => t.addEventListener('click', () => {
      const kind = t.dataset.photo;
      actionSheet(kind === 'before' ? 'Before photo' : 'After photo', [
        { label: 'View full size', run: () => { const p = photo(meal[kind].photoId); overlay(`<img class="meal-full" src="${p.dataUrl}" alt="${kind} photo">`); } },
        { label: 'Delete this photo', danger: true, run: async () => {
          if (!(await confirmSheet(`Delete the ${kind} photo?${kind === 'before' ? ' The estimate from it goes too.' : ''}`, { ok: 'Delete', danger: true }))) return;
          await repo.remove('meal-photos', meal[kind].photoId);
          await save(kind === 'before' ? { before: { ...meal.before, photoId: null, items: meal.before.confirmedAt ? meal.before.items : (b.items || []) }, source: 'manual' } : { after: null });
        } },
      ]);
    }));
    const scaleIn = $('#m-scale');
    if (scaleIn) scaleIn.addEventListener('change', () => {
      const g = Number(scaleIn.value);
      const val = scaleIn.value.trim() === '' || !Number.isFinite(g) || g <= 0 ? null : g;
      const nextItems = val && items.length ? scaleTo(items, val) : (meal.before.items || null);
      save({ before: { ...meal.before, scaleG: val, ...(val && items.length ? { items: nextItems, confirmedAt: meal.before.confirmedAt || null, edited: true } : {}) } });
      if (val && items.length && b.estimated) toast(`Items scaled to ${n0(val)} g. Tap Looks right to confirm.`);
    });
    $('#m-ok').onclick = async () => {
      const now = Date.now();
      if (state === 'confirm') {
        const keep = meal.before.edited ? cleanItems(meal.before.items) : items;
        await save({ before: { ...meal.before, items: keep, scaleG: scaleG ?? null, confirmedAt: now } });
        toast(meal.after || meal.before?.photoId == null ? 'Confirmed.' : `Confirmed. After photo at ${askAt}, or tap Ate it all.`);
      } else if (state === 'confirm-after') {
        await save({ after: { ...meal.after, leftovers: l.items, scaleG: estA?.scaleG ?? null, confirmedAt: now } });
        toast('Leftovers confirmed.');
      }
    };
    $('#m-fix').onclick = async () => {
      const opts = [{ label: meal.after && !meal.after.none ? 'Fix what was on the plate' : 'Fix the items', run: async () => {
        const next = await editItems('WHAT WAS ON THE PLATE', items);
        if (next) await save({ before: { ...meal.before, items: next, confirmedAt: Date.now(), edited: true } });
      } }];
      if (meal.after?.photoId && items.length) opts.push({ label: 'Fix what was left over', run: async () => {
        const next = await editLeftovers(items, l.items);
        if (next) await save({ after: { ...meal.after, leftovers: next, confirmedAt: Date.now() } });
      } });
      if (opts.length === 1) opts[0].run(); else actionSheet('Fix', opts);
    };
    $('#m-mic').onclick = () => toast('Voice arrives in step 9. Use Fix, or Ask the Mac again with a note.');
    $('#m-again').onclick = async () => {
      const hint = await promptLong('Tell the Mac what it got wrong (optional)', meal.hint || '', { placeholder: 'e.g. it is beef tri-tip, about 200 g, and brown rice', ok: 'Ask again' });
      if (hint === null) return;
      pollStart = Date.now(); clearInterval(pollTimer); pollTimer = null;
      await save({ hint, round: (meal.round || 0) + 1, before: { ...meal.before, confirmedAt: null, items: null, edited: false }, ...(meal.after?.photoId ? { after: { ...meal.after, confirmedAt: null, leftovers: null } } : {}) });
      syncNow();
      toast('Asked again. The new estimate replaces this one.');
    };
    $('#m-more').onclick = () => actionSheet(meal.name, [
      { label: 'Note…', run: async () => { const t = await promptLong('Note on this meal', meal.note || ''); if (t !== null) save({ note: t }); } },
      { label: 'Change the time', run: async () => {
        const hm = await import('../ui/sheet.js').then((m) => m.promptTime('Meal time', new Date(meal.at).toTimeString().slice(0, 5)));
        if (!hm) return;
        const d = new Date(meal.at); d.setHours(Number(hm.slice(0, 2)), Number(hm.slice(3)), 0, 0);
        save({ at: d.getTime(), date: isoDate(d) });
      } },
      { label: 'Delete this meal', danger: true, run: async () => {
        if (!(await confirmSheet('Delete this meal and its photos?', { ok: 'Delete', danger: true }))) return;
        for (const p of photos.filter((x) => x.mealId === id)) await repo.remove('meal-photos', p.id);
        await repo.remove('meals', id);
        location.hash = `#/fuel/${meal.date}`;
      } },
    ]);
  };

  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.some((c) => ['meals', 'meal-photos', 'meal-estimates'].includes(c))) draw(); });
    draw();
  });
  return () => { alive = false; clearInterval(pollTimer); off(); unsub(); };
}
