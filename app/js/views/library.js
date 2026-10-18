// LIBRARY: search and filter every exercise (general library + own + custom); add a custom exercise.
import { ready } from '../lib/data.js';
import { mergeLibrary, searchLibrary, newCustomExercise, slug, exerciseUsed, routinesUsing } from '../lib/library.js';
import { TYPES, MUSCLES, EQUIPMENT, muscleLabel } from '../lib/exercise-types.js';
import { toast } from '../ui/toast.js';
import { getState } from '../lib/store.js';
import { activeBridge } from '../lib/history.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const state = { q: '', muscle: null, equipment: null };

/** Ids of exercises from the most recent finished sessions (P32), then the Hevy bridge while it is still in use. */
export async function recentExerciseIds(repo, max = 40) {
  const [sessions, bridge] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads')]);
  const ids = [];
  const add = (id) => { if (id && !ids.includes(id) && ids.length < max) ids.push(id); };
  for (const s of sessions.filter((x) => x.status === 'done' && x.kind !== 'holds').sort((a, b) => b.startedAt - a.startedAt).slice(0, 20)) {
    for (const e of s.exercises || []) add(e.exerciseId || slug(e.name));
  }
  for (const s of activeBridge(bridge, sessions)?.lastSessions || []) for (const n of s.exercises) add(slug(n));
  return ids;
}

export function render(view, params = []) {
  if (params[0] === 'new') return renderForm(view, null);
  if (params[0] === 'edit' && params[1]) return renderForm(view, params[1]);
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

/** New custom exercise, or edit one of his own (P34). Name and type lock once the exercise has been logged. */
function renderForm(view, editId) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  ready.then(async (repo) => {
    const [records, sessions, bridge, routines] = await Promise.all([repo.list('exercises'), repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('routines')]);
    const all = mergeLibrary(records, getState().equipment);
    const cur = editId ? all.find((e) => e.id === editId) : null;
    if (editId && (!cur || cur.source === 'library')) { view.innerHTML = '<h1 class="view-title">Can\'t edit this one</h1><p class="hint">Exercises from the general library can be duplicated, then edited.</p>'; return; }
    const used = cur ? exerciseUsed(cur, { sessions, bridge }) : false;
    const ex = cur || { name: '', type: 'weight_reps', primary: 'chest', secondary: [], equipment: 'barbell' };
    view.innerHTML = `
      <h1 class="view-title">${cur ? 'Edit exercise' : 'Custom exercise'}</h1>
      ${used ? '<p class="hint">Name and type are locked: this exercise has logged sets, and your history follows its name.</p>' : ''}
      <form class="card pair-form" id="cx-form">
        <div class="field"><label for="cx-name">Name</label><input class="input" id="cx-name" name="name" required maxlength="80" placeholder="e.g. Toes Wall Squat Hold" value="${esc(ex.name)}" ${used ? 'readonly' : ''}></div>
        <div class="field"><label for="cx-type">Type</label><select class="input" id="cx-type" name="type" ${used ? 'disabled' : ''}>
          ${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${ex.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="cx-primary">Main muscle</label><select class="input" id="cx-primary" name="primary">
          ${MUSCLES.map((m) => `<option value="${m}" ${ex.primary === m ? 'selected' : ''}>${esc(muscleLabel(m))}</option>`).join('')}</select></div>
        <fieldset class="field cx-secondary"><legend>Other muscles</legend>
          <div class="chips wrap">${MUSCLES.map((m) => `<label class="chip"><input type="checkbox" name="secondary" value="${m}" ${ex.secondary?.includes(m) ? 'checked' : ''}> ${esc(muscleLabel(m))}</label>`).join('')}</div>
        </fieldset>
        <div class="field"><label for="cx-eq">Equipment</label><select class="input" id="cx-eq" name="equipment">
          ${EQUIPMENT.map((m) => `<option value="${m}" ${ex.equipment === m ? 'selected' : ''}>${esc(muscleLabel(m))}</option>`).join('')}</select></div>
        <div class="btn-row"><a class="btn-ghost center" href="${cur ? `#/exercise/${esc(cur.id)}` : '#/library'}">Cancel</a><button class="btn-primary" type="submit">Save</button></div>
      </form>`;
    view.querySelector('#cx-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const fields = { primary: f.get('primary'), secondary: f.getAll('secondary').filter((m) => m !== f.get('primary')), equipment: f.get('equipment') };
      try {
        if (!cur) {
          const made = newCustomExercise({ name: f.get('name'), type: f.get('type'), ...fields });
          if (all.some((e) => e.id === made.id)) { toast('An exercise with that name already exists.'); return; }
          await repo.put('exercises', made.id, made);
          toast('Saved.');
          location.hash = `#/exercise/${made.id}`;
          return;
        }
        const name = used ? cur.name : String(f.get('name') || '').trim().replace(/\s+/g, ' ');
        if (!name) { toast('Name is required.'); return; }
        if (name !== cur.name && all.some((e) => e.id !== cur.id && e.name.toLowerCase() === name.toLowerCase())) { toast('An exercise with that name already exists.'); return; }
        const rec = (await repo.get('exercises', cur.id)) || { id: cur.id, custom: !!cur.custom };
        await repo.put('exercises', cur.id, { ...rec, name, type: used ? cur.type : f.get('type'), ...fields, editedAt: Date.now() });
        // The id stays the same; routines that show the old name get the new one.
        if (name !== cur.name) {
          for (const r of routinesUsing(cur, routines)) await repo.put('routines', r.id, { ...r, exercises: r.exercises.map((e) => (e.exerciseId === cur.id ? { ...e, name } : e)) });
        }
        toast('Saved.');
        location.hash = `#/exercise/${cur.id}`;
      } catch (e) { toast(e.message); }
    });
  });
}
