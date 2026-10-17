// EXERCISE page: muscles and equipment, demo slot, pinned note, recent sessions.
// Charts and records over the full history arrive with the import in step 3.
import { ready } from '../lib/data.js';
import { mergeLibrary, duplicateExercise, exerciseUsed, routinesUsing } from '../lib/library.js';
import { buildHistory } from '../lib/history.js';
import { actionSheet, confirmSheet, promptLong } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { demoPanel } from '../ui/demo-panel.js';
import { TYPES, SET_TYPES, muscleLabel } from '../lib/exercise-types.js';
import { formatDay } from '../lib/time.js';
import { kg } from '../lib/loads.js';
import { getState } from '../lib/store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (iso) => formatDay(new Date(`${iso}T12:00:00`));

export function setText(s) {
  const t = s.hold ? 'H' : SET_TYPES[s.type]?.short || '';
  const load = s.kg != null ? kg(s.kg) : 'BW';
  const amount = s.hold ? `${s.durationS ?? 30}s` : s.reps != null ? `× ${s.reps}` : s.durationS != null ? `${s.durationS}s` : '';
  return `${t ? `<b class="st">${t}</b> ` : ''}${load} ${amount}`;
}

export function render(view, params = []) {
  const id = params[0];
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let tab = 'summary';

  const draw = async (repo) => {
    const ex = mergeLibrary(await repo.list('exercises'), getState().equipment).find((e) => e.id === id);
    if (!alive) return;
    if (!ex) { view.innerHTML = '<h1 class="view-title">Not found</h1><p class="view-sub">This exercise is not in the library.</p>'; return; }
    const [bridge, sessions, sets, routines] = await Promise.all([repo.get('bridge', 'last-loads'), repo.list('sessions'), repo.list('sets'), repo.list('routines')]);
    if (!alive) return; // left this page while loading: don't draw over the next one
    const recent = bridge?.exercises?.[ex.name] || [];
    const history = buildHistory({ sessions, sets, bridge }).all(ex.name);
    const own = ex.source !== 'library';
    const tags = [muscleLabel(ex.primary || 'other'), ...(ex.secondary || []).map((m) => `+ ${muscleLabel(m)}`), ex.equipment, ex.barKg ? `BAR ${kg(ex.barKg)}` : null, ex.capClass === 'main' ? '30% CAP' : null].filter(Boolean);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="javascript:history.back()">Back</a><button class="pill" id="ex-more" type="button" aria-label="Exercise options">···</button></div>
      <h1 class="view-title">${esc(ex.name)}</h1>
      <div class="tags">${tags.map((t) => `<span class="tag ${t === '30% CAP' ? 'tag-main' : ''}">${esc(String(t).toUpperCase())}</span>`).join('')}</div>
      <div id="demo"></div>
      ${ex.pinnedNote ? `<div class="pinned"><span class="hud c-muted">PINNED NOTE</span> ${esc(ex.pinnedNote.text ?? ex.pinnedNote)}<span class="c-faint"> ${ex.pinnedNote.from ? `(${esc(ex.pinnedNote.from)})` : ''}</span></div>` : ''}
      <nav class="seg" aria-label="Exercise sections">
        ${[['summary', 'Summary'], ['history', 'History'], ['howto', 'How-to']].map(([k, l]) => `<button class="pill ${tab === k ? 'is-on' : ''}" data-tab-x="${k}" type="button">${l}</button>`).join('')}
      </nav>
      <div id="ex-tab"></div>`;
    const body = view.querySelector('#ex-tab');
    if (tab === 'summary') {
      body.innerHTML = `
        <dl class="card kv">
          <dt>Type</dt><dd>${esc(TYPES[ex.type]?.label || 'Weight × reps')}</dd>
          ${ex.restSeconds ? `<dt>Rest</dt><dd>${Math.floor(ex.restSeconds / 60)}:${String(ex.restSeconds % 60).padStart(2, '0')}</dd>` : ''}
          ${recent[0]?.heaviest ? `<dt>Last heaviest</dt><dd>${kg(recent[0].heaviest.kg)} kg × ${recent[0].heaviest.reps}, ${esc(day(recent[0].date))}</dd>` : ''}
        </dl>
        <div class="section-label">Recent sessions</div>
        ${recent.length ? `<ul class="ex-list">${recent.map((r) => `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(day(r.date))}</span><span class="hud c-muted">${esc(r.title)}</span></div>
          <div class="ex-line sets-line">${r.sets.map(setText).join(' <span class="c-faint">·</span> ')}</div></li>`).join('')}</ul>` : '<p class="hint">No sessions yet.</p>'}
        <p class="hint">Charts and records over your full history arrive with the import in step 3.</p>`;
    } else if (tab === 'history') {
      body.innerHTML = `${history.length ? `<ul class="ex-list">${history.map((h) => `<li class="ex"><div class="ex-head">${h.sessionId ? `<a class="ex-name" href="#/finish/${esc(h.sessionId)}">${esc(day(h.date))}</a>` : `<span class="ex-name">${esc(day(h.date))}</span>`}<span class="hud c-muted">${esc(h.title || '')} · ${h.source === 'hevy' ? 'HEVY' : 'TRAINING HQ'}</span></div>
          <div class="ex-line sets-line">${h.sets.map(setText).join(' <span class="c-faint">·</span> ')}</div></li>`).join('')}</ul>` : '<p class="hint">Not logged yet.</p>'}
        <p class="hint">Sessions logged in Training HQ, plus your last Hevy sessions. Your full Hevy and Strong history arrives with the import in step 3.</p>`;
    } else {
      body.innerHTML = `${ex.howTo ? `<div class="card pad-card howto">${esc(ex.howTo).replace(/\n/g, '<br>')}</div>` : '<p class="hint">No written how-to yet. It is optional: write your own cues, in your own words.</p>'}
        <button class="btn-ghost" id="howto-edit" type="button">${ex.howTo ? 'Edit how-to' : 'Write a how-to'}</button>`;
      body.querySelector('#howto-edit').onclick = () => editText('howTo', 'How-to (your own cues)', ex.howTo || '');
    }
    view.querySelectorAll('[data-tab-x]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tabX; draw(repo); }));

    /** Save a text field on this exercise's own record (a library exercise gets a small record that extends it). */
    const editText = async (field, title, value) => {
      const t = await promptLong(title, value);
      if (t == null) return;
      const rec = (await repo.get('exercises', ex.id)) || { id: ex.id };
      const v = field === 'pinnedNote' ? (t ? { text: t, from: `Training HQ, ${formatDay(new Date())}` } : null) : t || null;
      await repo.put('exercises', ex.id, { ...rec, [field]: v });
    };
    const used = exerciseUsed(ex, { sessions, bridge });
    const inRoutines = routinesUsing(ex, routines);
    view.querySelector('#ex-more').onclick = () => actionSheet(ex.name, [
      ...(own ? [{ label: 'Edit exercise', run: () => { location.hash = `#/library/edit/${ex.id}`; } }] : []),
      { label: 'Duplicate as a custom exercise', run: async () => {
        const all = mergeLibrary(await repo.list('exercises'));
        const copy = duplicateExercise(ex, new Set(all.map((e) => e.id)));
        await repo.put('exercises', copy.id, copy);
        toast(`Made "${copy.name}". It starts with no history.`);
        location.hash = `#/library/edit/${copy.id}`;
      } },
      { label: `Bar (${ex.barKg ? `${kg(ex.barKg)} kg` : 'none'})`, run: () => {
        const bars = getState().equipment?.bars || [];
        const choose = async (barId) => { const rec = (await repo.get('exercises', ex.id)) || { id: ex.id }; await repo.put('exercises', ex.id, { ...rec, barId }); toast(barId === 'none' ? 'No bar: loads are plain totals.' : 'Saved. Loads stay totals including the bar.'); };
        actionSheet('Bar for this exercise', [
          ...bars.map((b) => ({ label: `${b.label || 'Bar'} · ${kg(b.kg)} kg${ex.barId === b.id ? ' (now)' : ''}`, run: () => choose(b.id) })),
          { label: `No bar${ex.barId === 'none' ? ' (now)' : ''}`, run: () => choose('none') },
          { label: `By equipment type (default)${!ex.barId ? ' (now)' : ''}`, run: () => choose(null) },
        ]);
      } },
      { label: ex.pinnedNote ? 'Edit pinned note' : 'Pin a note (shows every time)', run: () => editText('pinnedNote', 'Pinned note', ex.pinnedNote?.text ?? ex.pinnedNote ?? '') },
      { label: ex.howTo ? 'Edit how-to' : 'Write a how-to', run: () => editText('howTo', 'How-to (your own cues)', ex.howTo || '') },
      ...(ex.custom ? [{ label: 'Delete exercise', danger: true, run: async () => {
        if (used) { toast('It has logged sets, so it stays: your history needs it.'); return; }
        if (inRoutines.length) { toast(`It is in ${inRoutines.map((r) => r.title).join(', ')}. Remove it there first.`); return; }
        if (!(await confirmSheet(`Delete ${ex.name}?`, { ok: 'Delete', danger: true }))) return;
        await repo.remove('exercises', ex.id);
        location.hash = '#/library';
      } }] : []),
    ]);
    offDemo();
    offDemo = demoPanel(view.querySelector('#demo'), ex);
  };
  let offDemo = () => {};

  let off = () => {};
  let alive = true;
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.includes('exercises') || cols.includes('bridge') || cols.includes('sessions') || cols.includes('demos')) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); offDemo(); };
}
