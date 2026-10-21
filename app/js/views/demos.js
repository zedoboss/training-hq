// DEMOS (#/demos): which exercises have a demo (a clip or an animated demo) and which still need one (2.17). His own exercises first
// (routines, history, custom), then the rest of the library. Rescan picks up clips copied into the Mac's folder.
import { ready, rescanDemos, fetchDemo } from '../lib/data.js';
import { mergeLibrary, demoFileName } from '../lib/library.js';
import { keptIds, keepClip } from '../lib/demos.js';
import { getState } from '../lib/store.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function render(view) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo; let off = () => {}; let alive = true;

  const draw = async () => {
    const [exercises, routines, demos, bridge, kept] = await Promise.all([
      repo.list('exercises'), repo.list('routines'), repo.list('demos'), repo.get('bridge', 'last-loads'), keptIds(),
    ]);
    if (!alive) return;
    const all = mergeLibrary(exercises, getState().equipment);
    const has = new Map(demos.map((d) => [d.id, d]));
    const inRoutines = new Set(routines.flatMap((r) => r.exercises.map((e) => e.exerciseId)));
    const logged = new Set([...exercises.map((e) => e.id)]);
    const used = new Set(Object.keys(bridge?.exercises || {}));
    const routineEx = all.filter((e) => inRoutines.has(e.id));
    const loggedEx = all.filter((e) => !inRoutines.has(e.id) && (logged.has(e.id) || used.has(e.name)));
    const mine = [...routineEx, ...loggedEx];
    const others = all.filter((e) => !mine.includes(e));
    const row = (e) => `<li><a class="lib-row" href="#/exercise/${esc(e.id)}"><span class="lib-name">${esc(e.name)}</span>
      <span class="lib-meta"><span class="fname">${esc(has.has(e.id) ? has.get(e.id).file : demoFileName(e))}</span>${has.has(e.id) && kept.has(e.id) ? ' · ON THIS DEVICE' : ''}</span>
      ${has.has(e.id) ? `<span class="tag tag-hold">${has.get(e.id).type === 'text/html' ? 'ANIMATED' : 'CLIP'}</span>` : ''}</a></li>`;
    const missingRoutine = routineEx.filter((e) => !has.has(e.id));
    const missingLogged = loggedEx.filter((e) => !has.has(e.id));
    const withDemo = all.filter((e) => has.has(e.id));
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/library">Library</a><span class="hud c-muted">${withDemo.length} OF ${all.length} HAVE A DEMO</span></div>
      <h1 class="view-title">Demos</h1>
      <p class="hint">Animated demos and clips live in the Mac's folder <code>training-hq-private/data/demos</code>, named after
        the exercise (for example <code>${esc(demoFileName(routineEx[0] || all[0]))}</code>); tap Rescan after copying files in.
        Add a clip of your own from any exercise page: it plays instead of the animation. Clips are trimmed to 15 seconds,
        silent and small.</p>
      <div class="btn-row"><button class="btn-ghost" id="d-scan" type="button">Rescan Mac folder</button>
        <button class="btn-ghost" id="d-keep" type="button" ${withDemo.some((e) => !kept.has(e.id)) ? '' : 'disabled'}>Keep all on this device</button></div>
      <div class="section-label">In your routines, no demo yet · ${missingRoutine.length}</div>
      <ul class="lib-list">${missingRoutine.map(row).join('') || '<li class="hint pad">Every exercise in your routines has a demo.</li>'}</ul>
      ${missingLogged.length ? `<details class="notes"><summary>Others you have logged, no demo yet · ${missingLogged.length}</summary>
        <ul class="lib-list">${missingLogged.map(row).join('')}</ul></details>` : ''}
      ${withDemo.length ? `<div class="section-label">With a demo · ${withDemo.length}</div><ul class="lib-list">${withDemo.map(row).join('')}</ul>` : ''}
      <details class="notes"><summary>Rest of the library, no demo yet · ${others.filter((e) => !has.has(e.id)).length}</summary>
        <ul class="lib-list">${others.filter((e) => !has.has(e.id)).map(row).join('')}</ul></details>`;
    view.querySelector('#d-scan').onclick = async () => {
      try { const r = await rescanDemos(); toast(`${r.clips} demo${r.clips === 1 ? '' : 's'} on the Mac${r.added ? `, ${r.added} new` : ''}${r.removed ? `, ${r.removed} gone` : ''}.`); draw(); } catch (e) { toast(e.message); }
    };
    view.querySelector('#d-keep').onclick = async () => {
      let n = 0;
      for (const e of withDemo.filter((x) => !kept.has(x.id))) {
        try { await keepClip(e.id, has.get(e.id), await fetchDemo(e.id)); n++; } catch (err) { toast(err.message); break; }
      }
      if (n) toast(`${n} demo${n === 1 ? '' : 's'} kept on this device for the gym.`);
      draw();
    };
  };

  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.includes('demos')) draw(); });
    draw();
  });
  return () => { alive = false; off(); };
}
