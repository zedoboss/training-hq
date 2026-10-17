// EXERCISE page: muscles and equipment, demo slot, pinned note, recent sessions.
// Charts and records over the full history arrive with the import in step 3.
import { ready } from '../lib/data.js';
import { mergeLibrary } from '../lib/library.js';
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
    if (!ex) { view.innerHTML = '<h1 class="view-title">Not found</h1><p class="view-sub">This exercise is not in the library.</p>'; return; }
    const bridge = await repo.get('bridge', 'last-loads');
    const recent = bridge?.exercises?.[ex.name] || [];
    const tags = [muscleLabel(ex.primary || 'other'), ...(ex.secondary || []).map((m) => `+ ${muscleLabel(m)}`), ex.equipment, ex.barKg ? `BAR ${kg(ex.barKg)}` : null, ex.capClass === 'main' ? '30% CAP' : null].filter(Boolean);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="javascript:history.back()">Back</a></div>
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
      body.innerHTML = '<p class="hint">Full history arrives with the Hevy and Strong import in step 3.</p>';
    } else {
      body.innerHTML = `<p class="hint">${ex.howTo ? esc(ex.howTo) : 'No written instructions yet. They are optional and written fresh for Training HQ.'}</p>`;
    }
    view.querySelectorAll('[data-tab-x]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tabX; draw(repo); }));
    offDemo();
    offDemo = demoPanel(view.querySelector('#demo'), ex);
  };
  let offDemo = () => {};

  let off = () => {};
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.includes('exercises') || cols.includes('bridge') || cols.includes('demos')) draw(repo); });
    draw(repo);
  });
  return () => { off(); offDemo(); };
}
