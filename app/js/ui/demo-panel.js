// Demo slot for one exercise (2.17): the looping clip, the animated demo, or a neutral placeholder with "Add demo".
// Used on the exercise page and in a sheet from the session screen.
// An animated demo is a self-contained page from the Mac's demos folder. It runs in a sandboxed frame (scripts only, no
// access to the app or its data) and tells the app its height. part picks what it shows: 'stage' (the moving figure),
// 'info' (what it works, cues, mistakes, rules) or 'all'.
import { getRepo, uploadDemo, fetchDemo, deleteDemo } from '../lib/data.js';
import { cachedClip, keepClip, forgetClip, shrinkClip, MAX_SECONDS } from '../lib/demos.js';
import { demoFileName } from '../lib/library.js';
import { confirmSheet } from './sheet.js';
import { toast } from './toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/></svg>';
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const isPage = (rec) => rec?.type === 'text/html';

/** The demo page marked for embedding: it hides its own title and shows only the requested part. */
export const embedPage = (html, part) => String(html).replace(/<html([^>]*)>/i, (m, attrs) => `<html${attrs} class="embed part-${part}">`);

/**
 * Draw the slot into `box`. Returns a cleanup function (frees the clip from memory).
 * @param {HTMLElement} box
 * @param {{id:string, name:string}} ex
 * @param {{part?: 'stage'|'info'|'all'}} [opts] for an animated demo; 'info' draws nothing when there is none
 */
export function demoPanel(box, ex, { part = 'stage' } = {}) {
  let url = null;
  let alive = true;
  let onMessage = null;
  const free = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    if (onMessage) window.removeEventListener('message', onMessage);
    onMessage = null;
  };
  const infoOnly = part === 'info';

  const placeholder = (msg = '') => {
    if (infoOnly) { box.innerHTML = ''; return; }
    box.innerHTML = `<section class="demo-slot" aria-label="Demo">
      ${ICON}<div class="hud c-faint">${msg ? esc(msg) : 'NO DEMO YET'}</div>
      <label class="btn-ghost small file-btn center">Add demo<input type="file" accept="video/*" hidden data-file></label>
      <div class="hint demo-name">Saved on the Mac as ${esc(demoFileName(ex))}</div></section>`;
    wireFile();
  };

  const player = (rec, blob, from) => {
    free();
    if (infoOnly) { box.innerHTML = ''; return; }
    url = URL.createObjectURL(blob);
    box.innerHTML = `<section class="demo-box" aria-label="Demo clip">
      <video class="demo-video" src="${url}" autoplay loop muted playsinline disablepictureinpicture></video>
      <div class="demo-foot"><span class="hud c-muted">${esc(rec.file)} · ${Math.max(1, Math.round(rec.bytes / 1024))} KB · ${from}</span>
        <span class="btn-row tight"><label class="btn-ghost small file-btn center">Replace<input type="file" accept="video/*" hidden data-file></label>
        <button class="btn-ghost small btn-danger" type="button" data-del>Remove</button></span></div></section>`;
    wireFile();
    box.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmSheet(`Remove the demo for ${ex.name}? The file is deleted from the Mac.`, { ok: 'Remove', danger: true }))) return;
      try { await deleteDemo(ex.id); await forgetClip(ex.id); free(); draw(); toast('Demo removed.'); } catch (e) { toast(e.message); }
    };
  };

  const animation = async (rec, blob, from) => {
    free();
    const html = await blob.text();
    if (!alive) return;
    box.innerHTML = `<section class="demo-box" aria-label="Animated demo">
      <iframe class="demo-frame" title="Animated demo: ${esc(ex.name)}" sandbox="allow-scripts"></iframe>
      ${infoOnly ? '' : `<div class="demo-foot"><span class="hud c-muted">ANIMATED DEMO · ${from}</span>
        <label class="btn-ghost small file-btn center">Use my own clip<input type="file" accept="video/*" hidden data-file></label></div>`}</section>`;
    const frame = box.querySelector('iframe');
    onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.data?.thqDemo !== 'height') return;
      const h = Number(e.data.h);
      if (Number.isFinite(h)) frame.style.height = `${Math.min(Math.max(Math.ceil(h), 60), 6000)}px`;
    };
    window.addEventListener('message', onMessage);
    frame.srcdoc = embedPage(html, part);
    wireFile();
  };

  const show = (rec, blob, from) => (isPage(rec) ? animation(rec, blob, from) : player(rec, blob, from));

  const wireFile = () => {
    const input = box.querySelector('[data-file]');
    if (!input) return;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('video/')) { toast('Pick a video.'); return; }
      const hud = () => box.querySelector('.hud');
      if (hud()) hud().textContent = 'MAKING IT SMALL… 0%';
      const { blob, shrunk, seconds } = await shrinkClip(file, { onProgress: (f) => { if (hud()) hud().textContent = `MAKING IT SMALL… ${Math.round(f * 100)}%`; } });
      if (!alive) return;
      if (!EXT[blob.type.split(';')[0]]) { toast('That video type can\'t be used. Use MP4, MOV or WebM.'); draw(); return; }
      if (hud()) hud().textContent = 'SENDING TO THE MAC…';
      try {
        const rec = await uploadDemo(ex.id, blob);
        await keepClip(ex.id, rec, blob);
        if (!alive) return;
        player(rec, blob, 'kept on this device');
        toast(`Demo saved${shrunk ? `: ${Math.round(blob.size / 1024)} KB, ${Math.round(seconds)} s, no sound` : ''}.${seconds >= MAX_SECONDS ? ` Only the first ${MAX_SECONDS} seconds are kept.` : ''}`);
      } catch (e) { toast(e.message); draw(); }
    };
  };

  async function draw() {
    const rec = await getRepo()?.get('demos', ex.id);
    if (!alive) return;
    if (!rec || (infoOnly && !isPage(rec))) { placeholder(); return; }
    const kept = await cachedClip(ex.id, rec);
    if (kept) { show(rec, kept, 'kept on this device'); return; }
    if (!infoOnly) box.innerHTML = `<section class="demo-slot" aria-label="Demo">${ICON}<div class="hud c-faint">LOADING DEMO…</div></section>`;
    try {
      const blob = await fetchDemo(ex.id);
      await keepClip(ex.id, rec, blob);
      if (alive) show(rec, blob, 'now kept on this device');
    } catch (e) { if (alive) placeholder(/unreachable/i.test(e.message) ? 'DEMO ON THE MAC · NOT REACHABLE NOW' : 'DEMO COULD NOT LOAD'); }
  }

  draw();
  return () => { alive = false; free(); };
}
