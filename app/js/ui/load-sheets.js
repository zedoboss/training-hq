// Plates sheet (enter total or plates per side, see the plates) and the 30% guard warning.
import { overlay } from './sheet.js';
import { nearestLoad, platesFor, DEFAULT_PLATES } from '../lib/plates.js';
import { kg as fmt } from '../lib/loads.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PLATE_H = { 20: 64, 15: 56, 10: 48, 5: 38, 2.5: 30, 1.25: 24 };

function plateBar(plates) {
  return `<div class="plate-bar" aria-label="Plates on each side: ${plates.length ? plates.join(', ') : 'none'} kg">
    <span class="pb-sleeve" aria-hidden="true"></span>
    ${plates.map((p) => `<span class="pb-plate" style="height:${PLATE_H[p] || 22}px" aria-hidden="true"></span>`).join('')}
    <span class="pb-rest" aria-hidden="true"></span>
    <span class="hud c-muted">${plates.length ? plates.map(fmt).join(' + ') : 'BAR ONLY'}</span></div>`;
}

/**
 * Resolves to {kg, all:boolean} or null.
 * barKg null = no bar (machine/dumbbell): just a total.
 */
export function platesSheet({ name, kg, barKg, plates = DEFAULT_PLATES }) {
  return new Promise((resolve) => {
    let mode = 'total';
    let total = kg ?? barKg ?? 0;
    let result = null;
    const { el, close } = overlay(`
      <div class="hud c-muted sheet-title">${esc(name)}</div>
      ${barKg ? `<div class="seg" role="group" aria-label="Enter load as"><button class="pill is-on" data-m="total" type="button">Total kg</button><button class="pill" data-m="side" type="button">Plates / side</button></div>` : ''}
      <label class="field"><span class="hud c-muted" data-k="lab">TOTAL KG</span><input class="input big-in" data-in inputmode="decimal" value="${esc(fmt(total))}"></label>
      <div class="hud c-cyan" data-k="other"></div>
      <div data-k="bar"></div>
      <div class="hint" data-k="note"></div>
      <div class="btn-row"><button class="btn-ghost" data-use="one" type="button">Use for this set</button><button class="btn-primary" data-use="all" type="button">Use for all left</button></div>
      <button class="sheet-btn sheet-cancel" type="button" data-cancel>Cancel</button>`, () => resolve(result));
    const input = el.querySelector('[data-in]');
    const draw = () => {
      const v = Number(String(input.value).replace(',', '.'));
      if (Number.isFinite(v)) total = mode === 'side' && barKg ? barKg + v * 2 : v;
      el.querySelector('[data-k="lab"]').textContent = mode === 'side' ? 'PLATES PER SIDE (KG)' : 'TOTAL KG';
      if (barKg) {
        const per = Math.max(0, (total - barKg) / 2);
        const near = nearestLoad(total, barKg, plates);
        const exact = platesFor(per, plates).exact;
        el.querySelector('[data-k="other"]').textContent = mode === 'side' ? `TOTAL ${fmt(total)} KG` : `${fmt(barKg)} BAR + ${fmt(per)} KG / SIDE`;
        el.querySelector('[data-k="bar"]').innerHTML = plateBar(near.plates);
        el.querySelector('[data-k="note"]').textContent = exact ? '' : `Can't be loaded exactly with your plates (${plates.join(', ')}). Closest under it: ${fmt(near.total)} kg.`;
      }
    };
    el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.m;
      el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('is-on', x === b));
      input.value = mode === 'side' ? fmt(Math.max(0, (total - barKg) / 2)) : fmt(total);
      draw();
    }));
    input.addEventListener('input', draw);
    el.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
      result = { kg: Math.round(total * 100) / 100, all: b.dataset.use === 'all' };
      close();
    }));
    el.querySelector('[data-cancel]').addEventListener('click', () => close());
    draw();
    setTimeout(() => input.select(), 50);
  });
}

/** Resolves to the load to use: the suggestion, or the entered load if he keeps it. */
export function guardSheet({ name, entered, guard }) {
  return new Promise((resolve) => {
    let result = entered;
    const when = guard.basis.window === '7 days' ? 'your heaviest in the last 7 days' : 'your last session';
    const { el, close } = overlay(`
      <section class="guard" role="alert">
        <div class="hud c-amber">OVER YOUR 30% CAP</div>
        <p class="sheet-text">${esc(fmt(entered))} kg on ${esc(name)} is ${guard.over}% over ${when}: ${esc(fmt(guard.basis.kg))} kg. Your cap is ${esc(fmt(guard.capKg))}. Closest you can load under it: <b class="c-amber">${esc(fmt(guard.suggest))} kg</b>.</p>
        <div class="btn-row"><button class="btn-primary guard-use" data-g="use" type="button">Use ${esc(fmt(guard.suggest))}</button>
          <button class="btn-ghost guard-keep" data-g="keep" type="button">Keep ${esc(fmt(entered))}</button></div>
      </section>`, () => resolve(result));
    el.querySelector('[data-g="use"]').addEventListener('click', () => { result = guard.suggest; close(); });
    el.querySelector('[data-g="keep"]').addEventListener('click', () => { result = entered; close(); });
  });
}
