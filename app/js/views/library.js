// LIBRARY: search and filter every exercise (general library + own + custom); add a custom exercise.
import { ready } from '../lib/data.js';
import { mergeLibrary, searchLibrary, newCustomExercise, slug } from '../lib/library.js';
import { TYPES, MUSCLES, EQUIPMENT, muscleLabel } from '../lib/exercise-types.js';
import { toast } from '../ui/toast.js';
import { getState } from '../lib/store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const state = { q: '', muscle: null, equipment: null };

/** Ids of exercises from the most recent sessions (history bridge now, real sessions from step 2.6). */
export async function recentExerciseIds(repo) {
  const bridge = await repo.get('bridge', 'last-loads');
  const ids = [];
  for (const s of bridge?.lastSessions || []) for (const n of s.exercises) { const id = slug(n); if (!ids.includes(id)) ids.push(id); }
  return ids;
}

export function render(view, params = []) {
  if (params[0] === 'new') return renderNew(view);
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let all = [];
  let recent = [];

  const draw = () => {
    const list = searchLibrary(all, { ...state, recent });
    const listEl = view.querySelector('#lib-list');
    listEl.innerHTML = list.slice(0, 200).map((e) => `
      <li><a class="lib-row" href="#/exercise/${esc(e.id)}">
        <span class="lib-name">${esc(e.name)}</span>
        <span class="lib-meta">${esc(muscleLabel(e.primary || 'other'))} · ${esc(e.equipment || '')}</span>
        ${e.source !== 'library' ? `<span class="tag">${e.custom ? 'CUSTOM' : 'MINE'}</span>` : ''}
      </a></li>`).join('') || '<li class="hint">Nothing matches.</li>';
    view.querySelector('#lib-count').textContent = `${list.length} EXERCISES`;
    view.querySelectorAll('[data-muscle]').forEach((b) => b.classList.toggle('is-on', (b.dataset.muscle || null) === state.muscle));
    view.querySelectorAll('[data-equipment]').forEach((b) => b.classList.toggle('is-on', (b.dataset.equipment || null) === state.equipment));
  };

  view.innerHTML = `
    <div class="lib-head">
      <h1 class="view-title">Library</h1>
      <span class="btn-row tight"><a class="pill" href="#/demos">Demos</a><a class="pill" href="#/library/new">+ Custom</a></span>
    </div>
    <input class="input" id="lib-q" type="search" placeholder="Search exercises" autocomplete="off" value="${esc(state.q)}" aria-label="Search exercises">
    <div class="chips" role="group" aria-label="Muscle">
      <button class="chip" data-muscle="" type="button">All</button>
      ${MUSCLES.map((m) => `<button class="chip" data-muscle="${m}" type="button">${esc(muscleLabel(m))}</button>`).join('')}
    </div>
    <div class="chips" role="group" aria-label="Equipment">
      <button class="chip" data-equipment="" type="button">Any</button>
      ${EQUIPMENT.map((m) => `<button class="chip" data-equipment="${m}" type="button">${esc(muscleLabel(m))}</button>`).join('')}
    </div>
    <div class="hud c-muted" id="lib-count"></div>
    <ul class="lib-list" id="lib-list"></ul>`;

  view.querySelector('#lib-q').addEventListener('input', (e) => { state.q = e.target.value; draw(); });
  view.querySelectorAll('[data-muscle]').forEach((b) => b.addEventListener('click', () => { state.muscle = b.dataset.muscle || null; draw(); }));
  view.querySelectorAll('[data-equipment]').forEach((b) => b.addEventListener('click', () => { state.equipment = b.dataset.equipment || null; draw(); }));

  let off = () => {};
  ready.then(async (repo) => {
    const load = async () => { all = mergeLibrary(await repo.list('exercises'), getState().equipment); recent = await recentExerciseIds(repo); draw(); };
    off = repo.onChange((cols) => { if (cols.includes('exercises')) load(); });
    await load();
  });
  return () => off();
}

function renderNew(view) {
  view.innerHTML = `
    <h1 class="view-title">Custom exercise</h1>
    <form class="card pair-form" id="cx-form">
      <div class="field"><label for="cx-name">Name</label><input class="input" id="cx-name" name="name" required maxlength="80" placeholder="e.g. Toes Wall Squat Hold"></div>
      <div class="field"><label for="cx-type">Type</label><select class="input" id="cx-type" name="type">
        ${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="cx-primary">Main muscle</label><select class="input" id="cx-primary" name="primary">
        ${MUSCLES.map((m) => `<option value="${m}">${esc(muscleLabel(m))}</option>`).join('')}</select></div>
      <fieldset class="field cx-secondary"><legend>Other muscles</legend>
        <div class="chips wrap">${MUSCLES.map((m) => `<label class="chip"><input type="checkbox" name="secondary" value="${m}"> ${esc(muscleLabel(m))}</label>`).join('')}</div>
      </fieldset>
      <div class="field"><label for="cx-eq">Equipment</label><select class="input" id="cx-eq" name="equipment">
        ${EQUIPMENT.map((m) => `<option value="${m}">${esc(muscleLabel(m))}</option>`).join('')}</select></div>
      <div class="btn-row"><a class="btn-ghost center" href="#/library">Cancel</a><button class="btn-primary" type="submit">Save</button></div>
    </form>`;
  view.querySelector('#cx-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      const ex = newCustomExercise({
        name: f.get('name'), type: f.get('type'), primary: f.get('primary'),
        secondary: f.getAll('secondary').filter((m) => m !== f.get('primary')), equipment: f.get('equipment'),
      });
      const repo = await ready;
      if (mergeLibrary(await repo.list('exercises')).some((e) => e.id === ex.id)) { toast('An exercise with that name already exists.'); return; }
      await repo.put('exercises', ex.id, ex);
      toast('Saved.');
      location.hash = `#/exercise/${ex.id}`;
    } catch (e) { toast(e.message); }
  });
}
