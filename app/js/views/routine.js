// ROUTINE: view (#/routine/<id>) and edit (#/routine/<id>/edit).
import { ready } from '../lib/data.js';
import {
  addExercises, removeExercise, moveExercise, replaceExercise, updateExercise, detachFromPlan, setsSummary, duplicateRoutine,
} from '../lib/routines.js';
import { SET_TYPES } from '../lib/exercise-types.js';
import { pickExercises } from '../ui/picker.js';
import { actionSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const restText = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'off');
const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

export function render(view, params = []) {
  const [id, mode] = params;
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo; let r; let folders = [];

  const save = async (next) => { r = { ...next, updatedAt: Date.now() }; await repo.put('routines', r.id, r); };

  const drawView = () => {
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/train">Back</a>
        <div class="btn-row tight"><a class="pill" href="#/routine/${esc(r.id)}/edit">Edit</a></div></div>
      <h1 class="view-title">${esc(r.title)}</h1>
      ${r.notes ? `<p class="hint">${esc(r.notes)}</p>` : ''}
      ${r.exercises.some((e) => e.plan) ? `<p class="hint">Sets and targets for exercises marked PLAN come from The Comeback when you start: this week's column, capped at your last load + 30%. <a href="#/programme/${esc(r.dayType || '')}">See the table</a>.</p>` : ''}
      <ul class="ex-list">${r.exercises.map((e, i) => `<li class="ex">
        <div class="ex-head"><a class="ex-name plain" href="#/exercise/${esc(e.exerciseId)}">${i + 1}. ${esc(e.name)}</a>
          <span class="tag ${e.plan ? 'tag-main' : e.role === 'tendon-hold' ? 'tag-hold' : ''}">${e.plan ? 'PLAN' : e.role === 'tendon-hold' ? 'HOLD' : esc(setsSummary(e.sets))}</span></div>
        <div class="ex-line c-muted">Rest ${restText(e.restSeconds)}${e.notes ? ` · ${esc(e.notes)}` : ''}</div></li>`).join('')}</ul>
      <a class="btn-primary center big" href="#/session/start/${esc(r.id)}">Start ${esc(r.title)}</a>`;
  };

  const setRow = (e, s, i) => {
    const isTime = s.type === 'hold' || s.durationS != null;
    const reps = Array.isArray(s.reps) ? s.reps : [s.reps ?? '', s.reps ?? ''];
    return `<div class="set-edit" data-key="${esc(e.key)}" data-i="${i}">
      <select class="input mini" data-f="type" aria-label="Set type">${Object.entries(SET_TYPES).map(([k, t]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${t.short || 'N'} · ${t.label}</option>`).join('')}</select>
      ${isTime
        ? `<input class="input mini" data-f="durationS" inputmode="numeric" value="${esc(s.durationS ?? 30)}" aria-label="Seconds"><span class="hint">s</span>`
        : `<input class="input mini" data-f="r0" inputmode="numeric" value="${esc(reps[0])}" aria-label="Reps from"><span class="hint">-</span><input class="input mini" data-f="r1" inputmode="numeric" value="${esc(reps[1])}" aria-label="Reps to">`}
      <input class="input mini" data-f="kg" inputmode="decimal" placeholder="kg" value="${esc(s.kg ?? '')}" aria-label="Weight in kg">
      <button class="icon-mini" data-del-set type="button" aria-label="Remove set">×</button>
    </div>`;
  };

  const drawEdit = () => {
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/routine/${esc(r.id)}">Done</a>
        <button class="pill" id="r-more" type="button">···</button></div>
      <div class="field"><label for="r-title">Name</label><input class="input" id="r-title" value="${esc(r.title)}" maxlength="60"></div>
      <div class="field"><label for="r-folder">Folder</label><select class="input" id="r-folder">
        <option value="">No folder</option>${folders.map((f) => `<option value="${esc(f.id)}" ${r.folderId === f.id ? 'selected' : ''}>${esc(f.title)}</option>`).join('')}</select></div>
      <div class="field"><label for="r-notes">Routine note</label><textarea class="input area" id="r-notes" rows="2">${esc(r.notes)}</textarea></div>
      <ul class="ex-list" id="r-ex">${r.exercises.map((e, i) => `<li class="ex" data-key="${esc(e.key)}">
        <div class="ex-head"><span class="ex-name">${i + 1}. ${esc(e.name)}</span>
          <span class="btn-row tight">
            <button class="icon-mini" data-act="up" type="button" aria-label="Move up">↑</button>
            <button class="icon-mini" data-act="down" type="button" aria-label="Move down">↓</button>
            <button class="icon-mini" data-act="more" type="button" aria-label="Exercise options">···</button>
          </span></div>
        <div class="row-fields">
          <label class="hint">Rest <select class="input mini" data-act="rest">${REST_CHOICES.map((s) => `<option value="${s}" ${(e.restSeconds ?? 0) === s ? 'selected' : ''}>${restText(s)}</option>`).join('')}</select></label>
          <input class="input mini grow" data-act="notes" placeholder="Note for this exercise" value="${esc(e.notes)}">
        </div>
        ${e.plan
          ? `<p class="hint">Follows The Comeback: sets and targets are set when you start. <button class="link-btn" data-act="detach" type="button">Set my own sets</button></p>`
          : `${e.sets.map((s, si) => setRow(e, s, si)).join('')}<button class="link-btn" data-act="add-set" type="button">+ Set</button>`}
      </li>`).join('')}</ul>
      <button class="btn-ghost" id="r-add" type="button">+ Add exercises</button>`;

    const titleEl = view.querySelector('#r-title');
    titleEl.addEventListener('change', () => save({ ...r, title: titleEl.value.trim() || r.title }));
    view.querySelector('#r-folder').addEventListener('change', (ev) => save({ ...r, folderId: ev.target.value || null }));
    view.querySelector('#r-notes').addEventListener('change', (ev) => save({ ...r, notes: ev.target.value }));
    view.querySelector('#r-add').addEventListener('click', async () => {
      const picked = await pickExercises({ multi: true });
      if (picked.length) { await save(addExercises(r, picked)); drawEdit(); }
    });
    view.querySelector('#r-more').addEventListener('click', () => actionSheet(r.title, [
      { label: 'Duplicate', run: async () => { const d = duplicateRoutine(r); await repo.put('routines', d.id, d); location.hash = `#/routine/${d.id}/edit`; } },
      { label: 'Delete routine', danger: true, run: async () => { if (await confirmSheet(`Delete "${r.title}"? Past sessions stay.`, { ok: 'Delete', danger: true })) { await repo.remove('routines', r.id); location.hash = '#/train'; } } },
    ]));

    view.querySelectorAll('#r-ex > li').forEach((li) => {
      const key = li.dataset.key;
      const e = r.exercises.find((x) => x.key === key);
      const act = (name) => li.querySelector(`[data-act="${name}"]`);
      act('up').onclick = async () => { await save(moveExercise(r, key, -1)); drawEdit(); };
      act('down').onclick = async () => { await save(moveExercise(r, key, 1)); drawEdit(); };
      act('rest').onchange = (ev) => save(updateExercise(r, key, { restSeconds: Number(ev.target.value) || null }));
      act('notes').onchange = (ev) => save(updateExercise(r, key, { notes: ev.target.value }));
      act('more').onclick = () => actionSheet(e.name, [
        { label: 'Replace', run: async () => { const [ex] = await pickExercises({ multi: false, title: 'Replace with' }); if (ex) { await save(replaceExercise(r, key, ex)); drawEdit(); } } },
        { label: 'Remove', danger: true, run: async () => { await save(removeExercise(r, key)); drawEdit(); } },
      ]);
      if (e.plan) {
        act('detach').onclick = async () => {
          if (!(await confirmSheet('Stop following The Comeback for this exercise and set your own sets? The 30% guard still applies.', { ok: 'Set my own' }))) return;
          await save(detachFromPlan(r, key, [{ type: 'normal', reps: [8, 10] }, { type: 'normal', reps: [8, 10] }]));
          drawEdit();
        };
      } else {
        act('add-set').onclick = async () => {
          const last = e.sets[e.sets.length - 1] || { type: 'normal', reps: [8, 12] };
          await save(updateExercise(r, key, { sets: [...e.sets, { ...last, type: last.type === 'warmup' ? 'normal' : last.type }] }));
          drawEdit();
        };
        li.querySelectorAll('.set-edit').forEach((row) => {
          const i = Number(row.dataset.i);
          const patchSet = async (patch, redraw = false) => {
            const cur = r.exercises.find((x) => x.key === key);
            const sets = cur.sets.map((s, si) => (si === i ? { ...s, ...patch } : s));
            await save(updateExercise(r, key, { sets }));
            if (redraw) drawEdit();
          };
          row.querySelector('[data-f="type"]').onchange = (ev) => patchSet({ type: ev.target.value, ...(ev.target.value === 'hold' ? { durationS: 30 } : {}) }, true);
          row.querySelector('[data-f="kg"]').onchange = (ev) => patchSet({ kg: ev.target.value === '' ? null : Number(ev.target.value) });
          const dur = row.querySelector('[data-f="durationS"]');
          if (dur) dur.onchange = (ev) => patchSet({ durationS: Number(ev.target.value) || 30 });
          const r0 = row.querySelector('[data-f="r0"]');
          const r1 = row.querySelector('[data-f="r1"]');
          if (r0) {
            const upd = () => { const a = Number(r0.value) || null; const b = Number(r1.value) || a; patchSet({ reps: a ? [a, Math.max(a, b)] : null }); };
            r0.onchange = upd; r1.onchange = upd;
          }
          row.querySelector('[data-del-set]').onclick = async () => {
            const cur = r.exercises.find((x) => x.key === key);
            await save(updateExercise(r, key, { sets: cur.sets.filter((_, si) => si !== i) }));
            drawEdit();
          };
        });
      }
    });
  };

  const draw = async () => {
    r = await repo.get('routines', id);
    folders = (await repo.list('folders')).sort((a, b) => a.order - b.order);
    if (!r) { view.innerHTML = '<h1 class="view-title">Routine not found</h1><p class="hint"><a href="#/train">Back to Train</a></p>'; return; }
    if (mode === 'edit') drawEdit(); else drawView();
  };

  ready.then((x) => { repo = x; draw(); });
  return () => {};
}

export { toast };
