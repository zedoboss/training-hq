// EXPORT (#/export, from Settings): everything on this device as CSV files in one ZIP (3.6, P56). Works offline.
// Two taps on purpose: Prepare reads the local copy; Save then hands over the file inside a fresh tap, which the
// iPhone requires for its share sheet.
import { ready } from '../lib/data.js';
import { exportFiles, zipFiles } from '../lib/export.js';
import { deviceTimeZone, isoDate, formatTime, formatDay } from '../lib/time.js';
import { getState } from '../lib/store.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x, one, many = `${one}s`) => `${(x ?? 0).toLocaleString('en-US')} ${x === 1 ? one : many}`;
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function render(view) {
  let alive = true;
  let url = null;
  let file = null;
  let counts = null;
  let busy = false;

  const draw = () => {
    if (!alive) return;
    const s = getState();
    const last = s.sync?.lastAt;
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/settings">Settings</a><span class="hud c-muted">IMPORT AND EXPORT</span></div>
      <h1 class="view-title">Export your data</h1>
      <p class="hint">Everything on this device as CSV files in one ZIP: every set of every session (your Hevy and Strong history
        too) in <code>workouts.csv</code>, every other record in <code>data/</code>, and session photos. Loads are total kg
        including the bar. Works without the Mac.</p>
      ${s.paired ? `<p class="hint">Last sync with the Mac: ${last ? `${esc(formatDay(new Date(last)))}, ${esc(formatTime(new Date(last)))}` : 'never'}. Anything logged on another device after that is not in this file yet.</p>` : ''}
      <button class="btn-primary" id="ex-make" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Preparing…' : file ? 'Prepare again' : 'Prepare export'}</button>
      ${file ? `<div class="card pad-card">
        <span class="hud c-green">READY · ${esc(size(file.size))}</span>
        <div>${n(counts.sessions, 'session')}, ${n(counts.sets, 'set')}, ${n(counts.collections, 'kind')} of record${counts.photos ? `, ${n(counts.photos, 'photo')}` : ''}.</div>
        <div class="fname">${esc(file.name)}</div>
        ${canShare ? '<button class="btn-primary" id="ex-share" type="button">Save or share…</button>' : ''}
        <a class="${canShare ? 'btn-ghost' : 'btn-primary'} center" id="ex-save" href="${url}" download="${esc(file.name)}">Download</a>
      </div>` : ''}`;
  };

  view.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.id === 'ex-make') {
      busy = true; draw();
      try {
        const repo = await ready;
        const data = {};
        for (const col of await repo.cols()) data[col] = await repo.list(col);
        const out = exportFiles(data, { tz: deviceTimeZone() });
        const bytes = zipFiles(out.files);
        if (url) URL.revokeObjectURL(url);
        file = new File([bytes], `training-hq-export-${isoDate(new Date())}.zip`, { type: 'application/zip' });
        url = URL.createObjectURL(file);
        counts = out.counts;
      } catch (e) { toast(`Export failed: ${e.message}`); } finally { busy = false; draw(); }
    } else if (b.id === 'ex-share' && file) {
      try { await navigator.share({ files: [file], title: file.name }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed. Use Download instead.'); }
    }
  });

  draw();
  return () => { alive = false; if (url) URL.revokeObjectURL(url); };
}
