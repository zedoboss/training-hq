// IMPORT (#/import, from Settings): bring in workout history from Hevy or Strong (3.3, 3.4, P57).
// The Mac does the work: it keeps the file in the private folder, previews, imports, and undoes; the sessions reach
// this device by sync. Nothing is saved until Import is tapped.
import { ready, previewImport, planImport, commitImport, undoImport } from '../lib/data.js';
import { reviewOrder } from '../lib/import.js';
import { deviceTimeZone, formatDate, formatTime, formatDay } from '../lib/time.js';
import { getState } from '../lib/store.js';
import { pickExercises } from '../ui/picker.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x, one, many = `${one}s`) => `${(x ?? 0).toLocaleString('en-US')} ${x === 1 ? one : many}`;
const APP = { hevy: 'Hevy', strong: 'Strong' };
const HOW = { 'same name': 'SAME NAME', remembered: 'REMEMBERED', chosen: 'CHOSEN', new: 'NEW' };

const HOWTO = `
  <details class="notes"><summary>How to export from Hevy</summary>
    <ul><li>In Hevy: Profile, then Settings (gear), then Export &amp; Import Data, then Export Workouts.</li>
      <li>Save the CSV file to Files (or AirDrop it to the Mac), then choose it here.</li>
      <li>Body measurements are a separate export in Hevy; they come in with the Body screen later.</li></ul></details>
  <details class="notes"><summary>How to export from Strong</summary>
    <ul><li>In Strong: Profile, then Settings (gear), then Export Strong Data.</li>
      <li>Save the CSV file to Files (or AirDrop it to the Mac), then choose it here.</li>
      <li>Strong set to lb is fine: every load is stored in kg.</li></ul>
    <p class="hint">Menu names can differ a little between app versions.</p></details>`;

function timeZones(current) {
  let all = [];
  try { all = Intl.supportedValuesOf('timeZone'); } catch { all = []; }
  return [...new Set([current, deviceTimeZone(), 'UTC', ...all])];
}

const when = (ms) => (ms == null ? '—' : `${formatDate(new Date(ms))}, ${formatTime(new Date(ms))}`);
// A time from the file itself ("2023-10-10T04:53:00"), shown as written there.
const wall = (s) => {
  if (!s) return '—';
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `${wd} ${m}/${day}/${y}, ${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function render(view) {
  let alive = true;
  let repo = null;
  let off = () => {};
  const st = { busy: null, p: null, matches: {}, result: null, error: null, imports: [] };

  const summaryHtml = (p) => {
    const s = p.summary;
    const reasons = Object.entries(s.reasons || {});
    const notDone = s.notDone || [];
    return `
      <div class="section-label">${esc(APP[p.source])} file${p.fileName ? ` · ${esc(p.fileName)}` : ''}</div>
      <div class="stat-row">
        <div class="card stat"><span class="hud c-muted">SESSIONS</span><b>${s.sessions.toLocaleString('en-US')}</b></div>
        <div class="card stat"><span class="hud c-muted">SETS</span><b>${s.sets.toLocaleString('en-US')}</b></div>
        <div class="card stat"><span class="hud c-muted">HOLDS</span><b>${s.holds.toLocaleString('en-US')}</b></div>
      </div>
      <dl class="card kv">
        <dt>From</dt><dd>${when(s.from)}</dd>
        <dt>To</dt><dd>${when(s.to)}</dd>
        <dt>In the file</dt><dd>${n(s.fileSessions, 'session')}</dd>
        <dt>New exercises</dt><dd>${s.newExercises}</dd>
        <dt>Skipped</dt><dd>${s.skipped ? `<span class="c-amber">${n(s.skipped, 'session')}</span>` : '0'}</dd>
        <dt>Left out</dt><dd>${notDone.length ? `${n(notDone.length, 'block')} not done` : '0'}</dd>
        ${s.badRows ? `<dt>Unreadable rows</dt><dd class="c-amber">${s.badRows}</dd>` : ''}
        <dt>Kept on the Mac</dt><dd><code>imports/${esc(p.fileId)}</code></dd>
      </dl>
      <div class="card opt-list">
        <div class="opt"><div class="opt-text">Time zone of the file<small>Hevy and Strong write local times without a zone. Changing it moves every session.</small></div></div>
        <div class="opt"><select class="input" id="imp-tz" aria-label="Time zone">${timeZones(p.tz).map((z) => `<option ${z === p.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      </div>
      ${reasons.length ? `<details class="notes" ${s.sessions ? '' : 'open'}><summary>Skipped and why · ${s.skipped}</summary>
        ${reasons.map(([r, c]) => `<div class="hud c-muted imp-reason">${esc(r.toUpperCase())} · ${c}</div>
          <ul>${p.skipped.filter((x) => x.reason === r).map((x) => `<li>${esc(wall(x.start))} · ${esc(x.title)} · ${n(x.sets, 'set')}${x.clash
            ? `<br><span class="c-muted">Already here: ${esc(x.clash.title || 'session')} (${esc(APP[x.clash.source] || 'Training HQ')}), ${esc(when(x.clash.startedAt))}</span>` : ''}</li>`).join('')}</ul>`).join('')}
      </details>` : ''}
      ${notDone.length ? `<details class="notes"><summary>Left out: logged but not done · ${notDone.length}</summary>
        <ul>${notDone.map((b) => `<li>${esc(wall(b.start))} · ${esc(b.title)} · ${esc(b.name)}, ${n(b.sets, 'set')}${b.note ? `<br><span class="c-muted">Note: ${esc(b.note)}</span>` : ''}</li>`).join('')}</ul>
      </details>` : ''}`;
  };

  const matchRow = (e) => {
    const chips = e.suggestions.filter((x) => x.id !== e.id).map((x) => `<button class="chip" type="button" data-use="${esc(x.id)}" data-name="${esc(e.name)}">${esc(x.name)}</button>`).join('');
    return `<li class="imp-match">
      <div class="ex-head"><span class="lib-name">${esc(e.name)}</span><span class="tag ${e.how === 'new' ? 'tag-main' : 'tag-hold'}">${HOW[e.how] || esc(e.how)}</span></div>
      <div class="lib-meta">${n(e.sets, 'set')} · ${n(e.sessions, 'session')}</div>
      <div class="ex-line">${e.id ? `→ <b>${esc(e.matchName)}</b>` : `Added as your own exercise <span class="c-muted">(${esc((e.newExercise?.primary || 'other').replace('_', ' '))}, ${esc(e.newExercise?.equipment || '')})</span>`}</div>
      ${chips ? `<div class="chips wrap">${e.id ? '' : '<span class="hint">Same as:</span>'}${chips}</div>` : ''}
      <div class="btn-row tight"><button class="btn-ghost small" type="button" data-choose="${esc(e.name)}">Choose…</button>
        ${e.id ? `<button class="btn-ghost small" type="button" data-new="${esc(e.name)}">Keep as its own</button>` : ''}</div>
    </li>`;
  };

  const matchesHtml = (p) => {
    const list = reviewOrder(p.exercises);
    const look = list.filter((e) => e.how === 'new' || e.how === 'chosen');
    const fine = list.filter((e) => !look.includes(e));
    return `
      <div class="section-label">Exercise names · ${p.exercises.length}</div>
      <p class="hint">Each name in the file is paired with your library. Pick the same exercise when it is one, or keep it as its own. Your choices are remembered for the next import.</p>
      ${look.length ? `<ul class="lib-list imp-list">${look.map(matchRow).join('')}</ul>` : ''}
      ${fine.length ? `<details class="notes"><summary>Matched already · ${fine.length}</summary><ul class="lib-list imp-list">${fine.map(matchRow).join('')}</ul></details>` : ''}`;
  };

  const pastHtml = () => {
    if (!st.imports.length) return '';
    return `<div class="section-label">Past imports</div>
      <ul class="lib-list">${st.imports.map((d) => `<li class="imp-past">
        <div><div class="lib-name">${esc(APP[d.source] || d.source)} · ${n(d.summary?.sessions, 'session')}, ${n(d.summary?.sets, 'set')}</div>
          <div class="lib-meta">${esc(formatDay(new Date(d.at)))}, ${esc(formatTime(new Date(d.at)))}${d.summary?.from ? ` · ${esc(formatDate(new Date(d.summary.from)))} to ${esc(formatDate(new Date(d.summary.to)))}` : ''}</div>
          ${d.undoneAt ? `<div class="hint">Undone ${esc(formatDay(new Date(d.undoneAt)))}, ${esc(formatTime(new Date(d.undoneAt)))}</div>` : ''}</div>
        ${d.undoneAt ? '<span class="tag">UNDONE</span>' : `<button class="btn-ghost small btn-danger" type="button" data-undo="${esc(d.id)}">Undo</button>`}
      </li>`).join('')}</ul>`;
  };

  const draw = () => {
    if (!alive) return;
    const paired = getState().paired;
    const { p, busy, result } = st;
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/settings">Settings</a><span class="hud c-muted">IMPORT AND EXPORT</span></div>
      <h1 class="view-title">Import history</h1>
      ${paired ? '' : '<p class="cap-warn">Imports run on your Mac. Pair this device with it first (Settings).</p>'}
      <section class="stack">
        <p class="hint">Choose a workout export from Hevy or Strong (a CSV file). You see what it holds before anything is saved. Importing the same file again, or two apps covering the same days, never doubles a session.</p>
        <label class="btn-primary center file-btn ${paired && !busy ? '' : 'is-off'}">${p ? 'Choose another file' : 'Choose file'}<input type="file" accept=".csv,text/csv,text/comma-separated-values" hidden id="imp-file" ${paired && !busy ? '' : 'disabled'}></label>
        ${HOWTO}
      </section>
      ${busy ? `<p class="hud c-cyan">${esc(busy)}</p>` : ''}
      ${st.error ? `<p class="cap-warn">${esc(st.error)}</p>` : ''}
      ${result ? `<div class="card pad-card"><span class="hud c-green">IMPORTED</span>
        <div>${n(result.summary.sessions, 'session')}, ${n(result.summary.sets, 'set')}${result.summary.newExercises ? `, ${n(result.summary.newExercises, 'new exercise')}` : ''}${result.skipped?.length ? `. ${n(result.skipped.length, 'session')} skipped.` : '.'}</div>
        <p class="hint">They are in your history now, on this device too. Undo removes exactly these again.</p>
        <a class="btn-ghost center" href="#/stats">Open statistics</a></div>` : ''}
      ${p ? summaryHtml(p) + matchesHtml(p) : ''}
      ${p ? `<div class="stack"><button class="btn-primary" id="imp-go" type="button" ${p.summary.sessions && !busy ? '' : 'disabled'}>${p.summary.sessions ? `Import ${n(p.summary.sessions, 'session')}` : 'Nothing new to import'}</button>
        <button class="btn-ghost" id="imp-cancel" type="button">Cancel</button></div>` : ''}
      ${pastHtml()}`;
  };

  const loadPast = async () => {
    st.imports = (await repo.list('imports')).sort((a, b) => b.at - a.at);
  };

  const run = async (label, fn) => {
    st.busy = label; st.error = null; draw();
    try { await fn(); } catch (e) { st.error = e.message; } finally { st.busy = null; draw(); }
  };

  const replan = (scrollKeep = true) => run('Updating the preview…', async () => {
    const y = window.scrollY;
    const r = await planImport(st.p.fileId, st.p.tz, st.matches);
    st.p = { ...st.p, ...r };
    if (scrollKeep) requestAnimationFrame(() => window.scrollTo(0, y));
  });

  view.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'imp-file' && t.files?.[0]) {
      const f = t.files[0];
      st.result = null; st.p = null; st.matches = {};
      await run(`Reading ${f.name} on the Mac…`, async () => {
        const text = await f.text();
        st.p = await previewImport(text, { name: f.name, tz: deviceTimeZone() });
      });
    } else if (t.id === 'imp-tz' && st.p) {
      st.p = { ...st.p, tz: t.value };
      await replan();
    }
  });

  view.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b || st.busy) return;
    if (b.dataset.use) {
      st.matches[b.dataset.name] = b.dataset.use;
      await replan();
    } else if (b.dataset.new) {
      st.matches[b.dataset.new] = 'new';
      await replan();
    } else if (b.dataset.choose) {
      const [ex] = await pickExercises({ multi: false, title: `Same as "${b.dataset.choose}"` });
      if (!ex) return;
      st.matches[b.dataset.choose] = ex.id;
      await replan();
    } else if (b.id === 'imp-cancel') {
      st.p = null; st.matches = {}; st.error = null;
      draw();
    } else if (b.id === 'imp-go') {
      const p = st.p;
      const s = p.summary;
      const ok = await confirmSheet(`Import ${n(s.sessions, 'session')} and ${n(s.sets, 'set')} from ${APP[p.source]}${s.newExercises ? `, adding ${n(s.newExercises, 'new exercise')}` : ''}? You can undo it later.`, { ok: 'Import' });
      if (!ok) return;
      await run(`Importing ${n(s.sessions, 'session')}… then syncing them to this device.`, async () => {
        st.result = await commitImport(p.fileId, p.tz, st.matches);
        st.p = null; st.matches = {};
        await loadPast();
        window.scrollTo(0, 0);
      });
    } else if (b.dataset.undo) {
      const d = st.imports.find((x) => x.id === b.dataset.undo);
      const ok = await confirmSheet(`Undo this ${APP[d.source]} import? Its ${n(d.summary?.sessions, 'session')} and their sets are removed, and exercises it added that nothing else uses. Sessions you logged in Training HQ are not touched.`, { ok: 'Undo import', danger: true });
      if (!ok) return;
      await run('Undoing…', async () => {
        const r = await undoImport(d.id);
        toast(`Removed ${n(r.sessions, 'session')}, ${n(r.sets, 'set')}${r.exercises ? `, ${n(r.exercises, 'exercise')}` : ''}.`);
        st.result = null;
        await loadPast();
      });
    }
  });

  draw();
  ready.then(async (r) => {
    repo = r;
    off = repo.onChange(async (cols) => { if (cols.includes('imports') && !st.busy) { await loadPast(); draw(); } });
    await loadPast();
    draw();
  });
  return () => { alive = false; off(); };
}
