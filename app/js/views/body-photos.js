// BODY > Progress photos (#/body/photos, 7.3, P49): front, side and back, one per pose per day, kept private (on the
// phone and the Mac only; collection 'body-photos', id 'bodyphoto.<date>.<pose>', 1280 px JPEG).
// #/body/photos                 days newest first, take today's, add from Photos, compare
// #/body/photos/take/<pose>     the camera with the last photo of that pose as a faint overlay, flip, self-timer
// #/body/photos/view/<id>       one photo; retake (today), delete
// #/body/photos/compare/<a>/<b> two photos side by side with their dates and the days between
// Stored photos are the true image (as the iPhone Camera saves them); the front camera's preview and the overlay on
// it are mirrored together, so the overlay lines up with what he sees.
import { ready } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, isoDate, daysBetween } from '../lib/time.js';
import { POSES, photoId, lastPhoto, photoDays, posePhotos, fitSize } from '../lib/body.js';
import { fileToJpeg } from '../lib/photos.js';
import { play, unlockAudio } from '../lib/sounds.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const POSE = Object.fromEntries(POSES);
const isPose = (p) => Boolean(POSE[p]);
const daysText = (n) => (n === 0 ? 'same day' : `${n} day${n === 1 ? '' : 's'} apart`);

export function render(view, params = []) {
  const [mode, a, b] = params;
  if (mode === 'take') return take(view, isPose(a) ? a : 'front');
  if (mode === 'view') return one(view, a);
  if (mode === 'compare') return compare(view, a, b);
  return list(view);
}

/** Save a photo, asking first if that day and pose already has one. Returns true when saved. */
async function savePhoto(repo, { date, pose, dataUrl, source, camera = null }) {
  const id = photoId(date, pose);
  const old = await repo.get('body-photos', id);
  if (old && !(await confirmSheet(`Replace the ${POSE[pose].toLowerCase()} photo of ${dayName(date)}?`, { ok: 'Replace' }))) return false;
  await repo.put('body-photos', id, { id, date, pose, dataUrl, at: Date.now(), source, camera });
  return true;
}

function list(view) {
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Progress photos</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  let cmpPose = null;
  const draw = async (repo) => {
    const photos = (await repo.list('body-photos')).filter((p) => p?.date && p.dataUrl);
    if (!alive) return;
    const today = isoDate(new Date());
    const days = photoDays(photos);
    const todays = days.find((d) => d.date === today)?.photos || {};
    const comparable = POSES.filter(([p]) => posePhotos(photos, p).length >= 2);
    if (!comparable.some(([p]) => p === cmpPose)) cmpPose = comparable[0]?.[0] || null;
    const cmpList = cmpPose ? posePhotos(photos, cmpPose) : [];
    const opt = (list, sel) => list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(dayName(p.date))}</option>`).join('');
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body">Body</a></div>
      <h1 class="view-title">Progress photos</h1>
      <p class="view-sub">Private: kept on this phone and your Mac, never online. One photo per pose per day; same spot, light and distance each time.</p>
      <div class="section-label">Today</div>
      <div class="bp-take">${POSES.map(([p, l]) => `<a class="btn-${todays[p] ? 'ghost' : 'primary'} center" href="#/body/photos/take/${p}">${todays[p] ? '✓ ' : ''}${l}</a>`).join('')}</div>
      <label class="link-btn file-btn" for="bp-file">Add one from Photos instead</label>
      <input id="bp-file" type="file" accept="image/*" hidden>
      <section class="card pad-card" id="bp-add" hidden></section>
      ${comparable.length ? `<div class="section-label">Compare</div>
        <section class="card pad-card bp-cmp">
          ${comparable.length > 1 ? `<div class="seg" role="group" aria-label="Pose">${comparable.map(([p, l]) => `<button class="pill ${p === cmpPose ? 'is-on' : ''}" type="button" data-cmp="${p}">${l}</button>`).join('')}</div>` : `<span class="hud c-muted">${esc(POSE[cmpPose].toUpperCase())}</span>`}
          <div class="row-fields"><select class="input mini grow" id="bp-a" aria-label="First photo">${opt(cmpList, cmpList[0].id)}</select>
            <span class="hint">with</span><select class="input mini grow" id="bp-b" aria-label="Second photo">${opt(cmpList, cmpList.at(-1).id)}</select></div>
          <button class="btn-primary" id="bp-go" type="button">Side by side</button>
        </section>` : ''}
      <div class="section-label">${days.length ? 'Every day' : 'No photos yet'}</div>
      ${days.length ? days.map((d) => `<section class="bp-day"><div class="hud c-muted">${esc(dayName(d.date).toUpperCase())}</div>
        <div class="bp-row">${POSES.map(([p, l]) => (d.photos[p] ? `<a class="bp-thumb" href="#/body/photos/view/${esc(d.photos[p].id)}"><img src="${d.photos[p].dataUrl}" alt="${esc(l)} photo, ${esc(dayName(d.date))}" loading="lazy" decoding="async"><span>${l}</span></a>`
          : `<span class="bp-thumb is-empty"><span>${l}</span></span>`)).join('')}</div></section>`).join('')
        : '<p class="hint">Take front, side and back today, then again every few weeks. The last photo of each pose shows faintly over the camera so you can stand the same way.</p>'}`;

    const $ = (s) => view.querySelector(s);
    view.querySelectorAll('[data-cmp]').forEach((x) => x.addEventListener('click', () => { cmpPose = x.dataset.cmp; draw(repo); }));
    $('#bp-go')?.addEventListener('click', () => {
      const ia = $('#bp-a').value; const ib = $('#bp-b').value;
      if (ia === ib) { toast('Pick two different days.'); return; }
      location.hash = `#/body/photos/compare/${encodeURIComponent(ia)}/${encodeURIComponent(ib)}`;
    });
    $('#bp-file').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      let dataUrl;
      try { dataUrl = await fileToJpeg(f); } catch { toast('That file could not be read as a photo.'); return; }
      let pose = POSES.find(([p]) => !todays[p])?.[0] || 'front';
      const box = $('#bp-add');
      box.hidden = false;
      box.innerHTML = `<span class="hud c-cyan">ADD THIS PHOTO</span>
        <img class="bp-preview" src="${dataUrl}" alt="The chosen photo">
        <div class="field"><label>Pose</label><div class="seg" role="group">${POSES.map(([p, l]) => `<button class="pill ${p === pose ? 'is-on' : ''}" type="button" data-pose="${p}">${l}</button>`).join('')}</div></div>
        <div class="field"><label for="bp-date">Taken on</label><input class="input" type="date" id="bp-date" value="${today}" max="${today}"></div>
        <div class="btn-row"><button class="btn-ghost" type="button" id="bp-cancel">Cancel</button><button class="btn-primary" type="button" id="bp-save">Save</button></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box.querySelectorAll('[data-pose]').forEach((x) => x.addEventListener('click', () => {
        pose = x.dataset.pose; box.querySelectorAll('[data-pose]').forEach((y) => y.classList.toggle('is-on', y === x));
      }));
      box.querySelector('#bp-cancel').onclick = () => { box.hidden = true; box.innerHTML = ''; };
      box.querySelector('#bp-save').onclick = async () => {
        const date = box.querySelector('#bp-date').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) { toast('Pick the day it was taken (not a future date).'); return; }
        if (!(await savePhoto(repo, { date, pose, dataUrl, source: 'photos' }))) return;
        toast(`${POSE[pose]} photo saved for ${dayName(date)}.`);
        draw(repo);
      };
    });
  };
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.includes('body-photos')) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); };
}

function take(view, startPose) {
  let pose = startPose;
  let facing = 'user';
  let timer = 0;
  let ghost = 0.35;
  let stream = null; let shot = null; let alive = true; let repo = null;
  let countdown = null;
  const today = isoDate(new Date());
  const vol = () => withDefaults(getState().settings).sounds.timerVolume;
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/body/photos">Photos</a><span class="hud c-muted">${esc(dayName(today).toUpperCase())}</span></div>
    <div class="seg" role="group" aria-label="Pose" id="bt-poses">${POSES.map(([p, l]) => `<button class="pill" type="button" data-pose="${p}">${l}</button>`).join('')}</div>
    <div class="bp-stage" id="bt-stage">
      <video id="bt-video" playsinline muted autoplay></video>
      <img id="bt-ghost" class="bp-ghost" alt="" hidden>
      <img id="bt-shot" class="bp-shot" alt="The photo just taken" hidden>
      <div id="bt-count" class="bp-count" hidden></div>
      <p id="bt-msg" class="bp-msg hint" hidden></p>
    </div>
    <div id="bt-live">
      <button class="btn-primary big" id="bt-snap" type="button">Take ${esc(POSE[pose].toLowerCase())} photo</button>
      <div class="row-fields bp-tools">
        <button class="btn-ghost" id="bt-flip" type="button">Flip</button>
        <div class="seg seg-mini" role="group" aria-label="Self-timer">${[0, 5, 10].map((s) => `<button class="pill ${s === timer ? 'is-on' : ''}" type="button" data-timer="${s}">${s ? `${s} s` : 'No timer'}</button>`).join('')}</div>
      </div>
      <div class="bp-ghost-row" id="bt-ghost-row"><label class="hud c-muted" for="bt-op">Last photo <span id="bt-ghost-date"></span></label>
        <input id="bt-op" type="range" min="0" max="70" step="5" value="${ghost * 100}" aria-label="How faint the last photo is"></div>
    </div>
    <div id="bt-after" class="btn-row" hidden><button class="btn-ghost" id="bt-retake" type="button">Retake</button><button class="btn-primary" id="bt-use" type="button">Use photo</button></div>
    <div id="bt-fallback" hidden>
      <label class="btn-primary center big file-btn" for="bt-file">Open the camera</label>
      <input id="bt-file" type="file" accept="image/*" capture="user" hidden>
    </div>`;
  const $ = (s) => view.querySelector(s);
  const video = $('#bt-video');

  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; };
  const mirror = () => { const m = facing === 'user' && stream; video.classList.toggle('is-mirrored', Boolean(m)); $('#bt-ghost').classList.toggle('is-mirrored', Boolean(m)); };
  const message = (text) => { const m = $('#bt-msg'); m.hidden = !text; m.textContent = text || ''; };

  const drawPose = async () => {
    view.querySelectorAll('[data-pose]').forEach((x) => x.classList.toggle('is-on', x.dataset.pose === pose));
    $('#bt-snap').textContent = `Take ${POSE[pose].toLowerCase()} photo`;
    if (!repo) return;
    const prev = lastPhoto(await repo.list('body-photos'), pose, today);
    if (!alive) return;
    const g = $('#bt-ghost');
    g.hidden = !prev || ghost === 0 || Boolean(shot);
    if (prev) { g.src = prev.dataUrl; g.style.opacity = String(ghost); }
    $('#bt-ghost-row').hidden = !prev;
    $('#bt-ghost-date').textContent = prev ? md(prev.date) : '';
  };

  const start = async () => {
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { fallback('The camera needs the app\'s https:// address. Use the iPhone camera instead:'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } } });
      if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; video.srcObject = s;
      await video.play().catch(() => {});
      message('');
      mirror();
    } catch (e) {
      fallback(e?.name === 'NotAllowedError' ? 'Camera not allowed. Allow it for Training HQ in Settings, or use the iPhone camera:' : 'The camera did not start. Use the iPhone camera instead:');
    }
  };
  const fallback = (text) => {
    message(text);
    $('#bt-live').hidden = true;
    $('#bt-fallback').hidden = false;
  };

  const showShot = (dataUrl) => {
    shot = dataUrl;
    const img = $('#bt-shot'); img.src = dataUrl; img.hidden = false;
    $('#bt-ghost').hidden = true; video.hidden = true;
    $('#bt-live').hidden = true; $('#bt-fallback').hidden = true; $('#bt-after').hidden = false;
  };
  const capture = () => {
    if (!stream || !video.videoWidth) { toast('The camera is not ready yet.'); return; }
    const [w, h] = fitSize(video.videoWidth, video.videoHeight, 1280);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    play('record', vol());
    showShot(c.toDataURL('image/jpeg', 0.82));
  };
  const cancelCount = () => { clearInterval(countdown); countdown = null; $('#bt-count').hidden = true; };
  $('#bt-snap').addEventListener('click', () => {
    unlockAudio();
    if (countdown) { cancelCount(); $('#bt-snap').textContent = `Take ${POSE[pose].toLowerCase()} photo`; return; }
    if (!timer) { capture(); return; }
    let left = timer;
    const box = $('#bt-count'); box.hidden = false; box.textContent = String(left);
    $('#bt-snap').textContent = 'Cancel timer';
    play('tick', vol());
    countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) { cancelCount(); $('#bt-snap').textContent = `Take ${POSE[pose].toLowerCase()} photo`; capture(); return; }
      box.textContent = String(left);
      play('tick', vol());
    }, 1000);
  });
  $('#bt-retake').addEventListener('click', () => {
    shot = null;
    $('#bt-shot').hidden = true; video.hidden = false; $('#bt-after').hidden = true;
    if (stream) $('#bt-live').hidden = false; else $('#bt-fallback').hidden = false;
    drawPose();
  });
  $('#bt-use').addEventListener('click', async () => {
    if (!shot || !repo) return;
    if (!(await savePhoto(repo, { date: today, pose, dataUrl: shot, source: 'camera', camera: stream ? facing : null }))) return;
    toast(`${POSE[pose]} photo saved.`);
    const done = new Set((await repo.list('body-photos')).filter((p) => p.date === today).map((p) => p.pose));
    const nextPose = POSES.map(([p]) => p).find((p) => !done.has(p));
    if (!nextPose) { location.hash = '#/body/photos'; return; }
    pose = nextPose;
    history.replaceState(null, '', `#/body/photos/take/${pose}`);
    $('#bt-retake').click();
  });
  view.querySelectorAll('[data-pose]').forEach((x) => x.addEventListener('click', () => {
    if (shot) return;
    pose = x.dataset.pose; history.replaceState(null, '', `#/body/photos/take/${pose}`); drawPose();
  }));
  view.querySelectorAll('[data-timer]').forEach((x) => x.addEventListener('click', () => {
    timer = Number(x.dataset.timer); view.querySelectorAll('[data-timer]').forEach((y) => y.classList.toggle('is-on', y === x));
  }));
  $('#bt-op').addEventListener('input', (e) => { ghost = Number(e.target.value) / 100; const g = $('#bt-ghost'); g.style.opacity = String(ghost); g.hidden = ghost === 0 || !g.getAttribute('src'); });
  $('#bt-flip').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; start(); });
  $('#bt-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { showShot(await fileToJpeg(f)); } catch { toast('That photo could not be read.'); }
  });
  // Leaving the app (a notification, another app) stops the camera; coming back starts it again.
  const onVis = () => { if (document.hidden) { cancelCount(); stop(); } else if (alive && !shot && !$('#bt-live').hidden) start(); };
  document.addEventListener('visibilitychange', onVis);

  ready.then((r) => { repo = r; drawPose(); });
  start();
  return () => { alive = false; cancelCount(); stop(); document.removeEventListener('visibilitychange', onVis); };
}

function one(view, id) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true;
  ready.then(async (repo) => {
    const all = (await repo.list('body-photos')).filter((p) => p?.dataUrl);
    if (!alive) return;
    const p = all.find((x) => x.id === id);
    if (!p) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/photos">Photos</a></div><p class="hint">This photo is gone.</p>'; return; }
    const same = posePhotos(all, p.pose);
    const first = same[0]?.id !== p.id ? same[0] : null;
    const today = isoDate(new Date());
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/photos">Photos</a><span class="hud c-muted">${esc(POSE[p.pose]?.toUpperCase() || '')}</span></div>
      <h1 class="view-title">${esc(dayName(p.date))}</h1>
      <img class="bp-full" src="${p.dataUrl}" alt="${esc(POSE[p.pose] || '')} photo, ${esc(dayName(p.date))}">
      <div class="btn-row">
        ${first ? `<a class="btn-ghost center" href="#/body/photos/compare/${encodeURIComponent(first.id)}/${encodeURIComponent(p.id)}">Compare with the first</a>` : ''}
        ${p.date === today ? `<a class="btn-ghost center" href="#/body/photos/take/${p.pose}">Retake</a>` : ''}
      </div>
      <button class="btn-ghost btn-danger" id="bv-del" type="button">Delete this photo</button>`;
    view.querySelector('#bv-del').addEventListener('click', async () => {
      if (!(await confirmSheet(`Delete the ${POSE[p.pose]?.toLowerCase() || ''} photo of ${dayName(p.date)}? It goes from your Mac too.`, { ok: 'Delete', danger: true }))) return;
      await repo.remove('body-photos', p.id);
      toast('Photo deleted.');
      location.hash = '#/body/photos';
    });
  });
  return () => { alive = false; };
}

function compare(view, ida, idb) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true;
  ready.then(async (repo) => {
    const [pa, pb] = await Promise.all([repo.get('body-photos', ida), repo.get('body-photos', idb)]);
    if (!alive) return;
    if (!pa?.dataUrl || !pb?.dataUrl) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body/photos">Photos</a></div><p class="hint">One of these photos is gone.</p>'; return; }
    const [a, b] = pa.date <= pb.date ? [pa, pb] : [pb, pa];
    const fig = (p) => `<figure class="bp-fig"><img src="${p.dataUrl}" alt="${esc(POSE[p.pose] || '')} photo, ${esc(dayName(p.date))}"><figcaption class="hud c-muted">${esc(dayName(p.date).toUpperCase())}</figcaption></figure>`;
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body/photos">Photos</a><span class="hud c-muted">${esc(POSE[a.pose]?.toUpperCase() || '')}</span></div>
      <h1 class="view-title">${esc(daysText(daysBetween(a.date, b.date)))}</h1>
      <div class="bp-compare">${fig(a)}${fig(b)}</div>
      <p class="hint">Older on the left. Tap a photo to open it.</p>`;
    view.querySelectorAll('.bp-fig').forEach((el, i) => el.addEventListener('click', () => { location.hash = `#/body/photos/view/${encodeURIComponent([a, b][i].id)}`; }));
  });
  return () => { alive = false; };
}
