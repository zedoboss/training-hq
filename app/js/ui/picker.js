// Exercise picker: full-height sheet with search and filters. Pick one (replace) or several (add).
import { overlay } from './sheet.js';
import { mergeLibrary, searchLibrary } from '../lib/library.js';
import { MUSCLES, muscleLabel } from '../lib/exercise-types.js';
import { ready } from '../lib/data.js';
import { recentExerciseIds } from '../views/library.js';
import { getState } from '../lib/store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Resolves to an array of library exercises (empty if cancelled). */
export async function pickExercises({ multi = true, title = 'Add exercises' } = {}) {
  const repo = await ready;
  const all = mergeLibrary(await repo.list('exercises'), getState().equipment);
  const recent = await recentExerciseIds(repo);
  return new Promise((resolve) => {
    const chosen = new Map();
    let q = ''; let muscle = null; let result = [];
    const { el, close } = overlay(`
      <div class="picker">
        <div class="picker-head"><span class="hud c-muted">${esc(title)}</span>
          <button class="pill is-on" type="button" data-done ${multi ? '' : 'hidden'}>Add 0</button></div>
        <input class="input" type="search" placeholder="Search exercises" data-q aria-label="Search exercises">
        <div class="chips" role="group" aria-label="Muscle"><button class="chip is-on" data-m="" type="button">All</button>
          ${MUSCLES.map((m) => `<button class="chip" data-m="${m}" type="button">${esc(muscleLabel(m))}</button>`).join('')}</div>
        <ul class="lib-list picker-list" data-list></ul>
        <button class="sheet-btn sheet-cancel" type="button" data-cancel>Cancel</button>
      </div>`, () => resolve(result));
    el.querySelector('.sheet').classList.add('sheet-tall');
    const list = el.querySelector('[data-list]');
    const done = el.querySelector('[data-done]');
    const draw = () => {
      const items = searchLibrary(all, { q, muscle, recent }).slice(0, 150);
      list.innerHTML = items.map((e) => `<li><button class="lib-row pick-row ${chosen.has(e.id) ? 'is-picked' : ''}" data-id="${esc(e.id)}" type="button">
        <span class="lib-name">${esc(e.name)}</span><span class="lib-meta">${esc(muscleLabel(e.primary || 'other'))} · ${esc(e.equipment || '')}</span>
        <span class="pick-mark" aria-hidden="true">${chosen.has(e.id) ? '✓' : ''}</span></button></li>`).join('') || '<li class="hint">Nothing matches.</li>';
      done.textContent = `Add ${chosen.size}`;
      el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('is-on', (b.dataset.m || null) === muscle));
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const ex = all.find((x) => x.id === b.dataset.id);
      if (!multi) { result = [ex]; close(); return; }
      if (chosen.has(ex.id)) chosen.delete(ex.id); else chosen.set(ex.id, ex);
      draw();
    });
    el.querySelector('[data-q]').addEventListener('input', (e) => { q = e.target.value; draw(); });
    el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { muscle = b.dataset.m || null; draw(); }));
    done.addEventListener('click', () => { result = [...chosen.values()]; close(); });
    el.querySelector('[data-cancel]').addEventListener('click', () => close());
    draw();
  });
}
