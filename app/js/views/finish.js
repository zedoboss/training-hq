// FINISH (#/finish/<id>): save an active session, then its summary: time, volume, sets, bests,
// tendon hold prompt, "update routine?", save as routine, delete.
import { ready } from '../lib/data.js';
import { mergeLibrary } from '../lib/library.js';
import { buildHistory, activeBridge } from '../lib/history.js';
import { summarize, elapsedMs, copySession } from '../lib/session.js';
import { fileToJpeg, newPhotoId } from '../lib/photos.js';
import { sessionBests, structureChanged, routineFromSession, previousSame, comebackStartOf } from '../lib/finish.js';
import { dayMarks, workoutDates, weekStreak, SOURCE_LABEL, sourceOf } from '../lib/calendar.js';
import { changePct } from '../lib/stats.js';
import { isoDate, formatDate, formatDay, formatTime } from '../lib/time.js';
import { kg as fmtKg } from '../lib/loads.js';
import * as rest from '../lib/rest-timer.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { getState } from '../lib/store.js';
import { holdsAfter } from '../lib/holds.js';
import { withDefaults } from '../lib/settings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const localInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function render(view, params = []) {
  const id = params[0];
  // Opened from the calendar (#/finish/<id>/c/<day>), the history list (#/finish/<id>/h) or an exercise page
  // (#/finish/<id>/e/<exercise id>): Back returns there.
  const back = params[1] === 'c' && /^\d{4}-\d{2}-\d{2}$/.test(params[2] || '') ? `#/calendar/${params[2]}`
    : params[1] === 'h' ? '#/history' : params[1] === 'e' && params[2] ? `#/exercise/${encodeURIComponent(params[2])}` : null;
  let repo;

  const draw = async () => {
    const session = await repo.get('sessions', id);
    if (!session) { view.innerHTML = '<h1 class="view-title">Session not found</h1>'; return; }
    const all = (await repo.list('sets')).filter((s) => s.sessionId === id);
    const sum = summarize(session, all);
    const durMin = Math.round(elapsedMs(session) / 60000);

    if (session.status === 'active') {
      // Gyms for the tag: the default from Settings plus every gym used before.
      const gyms = [...new Set([withDefaults(getState().settings).gym.name, ...(await repo.list('sessions')).map((x) => x.gym)].filter(Boolean))];
      const unticked = all.filter((s) => !s.done).length;
      view.innerHTML = `
        <div class="lib-head"><a class="pill" href="#/session/${esc(id)}">Back</a></div>
        <h1 class="view-title">Finish ${esc(session.title)}</h1>
        <section class="stat-row">
          <div class="card stat"><span class="hud c-muted">TIME</span><b>${Math.floor(durMin / 60)}:${String(durMin % 60).padStart(2, '0')}</b></div>
          <div class="card stat"><span class="hud c-muted">VOLUME</span><b>${sum.volume.toLocaleString('en-US')}</b></div>
          <div class="card stat"><span class="hud c-muted">SETS</span><b>${sum.done}</b></div>
        </section>
        <form class="card pair-form" id="f-form">
          <div class="field"><label for="f-title">Title</label><input class="input" id="f-title" value="${esc(session.title)}" maxlength="60"></div>
          <div class="field"><label for="f-start">Started</label><input class="input" id="f-start" type="datetime-local" value="${session.logFor ? `${session.logFor}${localInput(session.startedAt).slice(10)}` : localInput(session.startedAt)}"></div>
          <div class="field"><label for="f-dur">Duration (minutes)</label><input class="input" id="f-dur" inputmode="numeric" value="${durMin}"></div>
          <div class="field"><label for="f-gym">Gym</label><input class="input" id="f-gym" list="f-gyms" value="${esc(session.gym || '')}" maxlength="60" autocomplete="off">
            <datalist id="f-gyms">${gyms.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
          <div class="field"><label for="f-note">Session note</label><textarea class="input area" id="f-note" rows="2">${esc(session.note)}</textarea></div>
          ${unticked ? `<p class="hint c-amber">${unticked} set${unticked > 1 ? 's are' : ' is'} not ticked and will not be saved.</p>` : ''}
          <button class="btn-primary big" type="submit">Save session</button>
        </form>`;
      view.querySelector('#f-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!sum.done && !(await confirmSheet('No sets are ticked. Save an empty session?', { ok: 'Save anyway' }))) return;
        const startedAt = new Date(view.querySelector('#f-start').value).getTime() || session.startedAt;
        const minutes = Number(view.querySelector('#f-dur').value) || durMin;
        for (const s of all.filter((x) => !x.done)) await repo.remove('sets', s.id);
        await repo.put('sessions', id, {
          ...session, title: view.querySelector('#f-title').value.trim() || session.title, note: view.querySelector('#f-note').value,
          gym: view.querySelector('#f-gym').value.trim() || null, startedAt, endedAt: startedAt + minutes * 60000 + (session.pausedMs || 0), pausedAt: null, status: 'done',
        });
        rest.clear();
        toast('Session saved.');
        draw();
      });
      return;
    }

    // Saved session summary.
    const [sessions, sets, bridge, routine, exercises] = await Promise.all([
      repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'), session.routineId ? repo.get('routines', session.routineId) : null, repo.list('exercises'),
    ]);
    const history = buildHistory({ sessions, sets, bridge });
    const done = all.filter((s) => s.done);
    const fullHistory = !activeBridge(bridge, sessions) && sessions.some((s) => s.source === 'hevy' && s.status === 'done');
    const comebackStart = comebackStartOf(await repo.get('programme', 'meta'));
    const bests = sessionBests(session, done, history, { fullHistory, comebackStart });
    const inComeback = !comebackStart || isoDate(new Date(session.startedAt)) >= comebackStart;
    const workouts = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds');
    const number = workouts.filter((s) => s.startedAt <= session.startedAt).length + (activeBridge(bridge, sessions)?.sessionCount ?? 0);
    // P29: week streak as of this session, and volume against the last session of the same kind.
    const day = isoDate(new Date(session.startedAt));
    const streak = weekStreak(workoutDates(dayMarks({ sessions: workouts })), day, withDefaults(getState().settings).firstDayOfWeek).current;
    const prev = previousSame(session, workouts);
    const prevVol = prev ? summarize(prev, sets.filter((x) => x.sessionId === prev.id)).volume : null;
    const pct = prev ? changePct(sum.volume, prevVol) : null;
    const source = SOURCE_LABEL[sourceOf(session)] || sourceOf(session);
    const areas = (await repo.list('tendons')).filter((d) => d.kind === 'area' && d.phase !== 'none');
    const due = holdsAfter(areas, session.dayType);
    const hold = due.length ? { text: due.map((h) => `${h.exercise} hold, ${h.sets} × ${h.seconds} s`).join(' · ') } : null;
    // The prompt goes away once that day's tendon holds are logged; a hold on some other exercise doesn't count.
    const dueNames = new Set(due.map((h) => h.exercise));
    const holdDone = done.some((s) => s.type === 'hold' && dueNames.has(session.exercises.find((e) => e.key === s.exKey)?.name));
    const changed = structureChanged(session, done, routine);
    const lib = new Map(mergeLibrary(exercises, getState().equipment).map((e) => [e.id, e]));
    void lib;
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="${back || '#/train'}">${back ? 'Back' : 'Train'}</a>
        <span class="hud c-muted">${esc(formatDay(new Date(session.startedAt)).toUpperCase())} · ${esc(formatTime(new Date(session.startedAt)))} - ${esc(formatTime(new Date(session.endedAt)))}</span></div>
      <div><div class="hud c-green">${esc(session.title.toUpperCase())} DONE <span class="c-muted">· ${esc(source.toUpperCase())}</span></div><h1 class="view-title">Session ${number}</h1></div>
      <section class="stat-row">
        <div class="card stat"><span class="hud c-muted">TIME</span><b>${Math.round(elapsedMs(session) / 60000)} min</b></div>
        <div class="card stat"><span class="hud c-muted">VOLUME</span><b>${sum.volume.toLocaleString('en-US')}</b></div>
        <div class="card stat"><span class="hud c-muted">SETS</span><b>${sum.done}</b></div>
      </section>
      <p class="hint">Streak: ${streak} week${streak === 1 ? '' : 's'}${prev ? ` · Volume ${pct == null ? 'not comparable' : `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}%`} vs the last ${esc(prev.title)} (${esc(formatDate(new Date(prev.startedAt)))}, ${prevVol.toLocaleString('en-US')} kg)` : ''}</p>
      <section class="card pad-card">
        <div class="hud c-muted">${inComeback ? 'COMEBACK BESTS' : 'ALL-TIME BESTS'} · ${bests.length}</div>
        ${bests.map((b) => `<div class="best"><span>${esc(b.name)}${b.kind === 'all-time' ? ' <span class="tag tag-main">ALL-TIME</span>' : ''}</span><b>${fmtKg(b.kg)} × ${b.reps}${b.previous ? ` <span class="c-faint">was ${fmtKg(b.previous)}</span>` : ''}</b></div>`).join('') || '<p class="hint">None this time.</p>'}
        <p class="hint">${fullHistory ? (inComeback ? 'Heaviest working set since the comeback started, against the sessions before this one. ALL-TIME: heaviest ever, Hevy and Strong included.' : 'Heaviest working set ever at the time, Hevy and Strong included.') : 'All-time bests show once your Hevy history is imported (Settings > Import and export).'}</p>
      </section>
      ${hold && !holdDone ? `<a class="card hold-prompt" href="#/holds"><span><span class="hud c-cyan">TENDON HOLD NOW</span><br>${esc(hold.text)}</span><span class="pill is-on">Start</span></a>` : ''}
      ${changed ? `<section class="card pad-card" id="upd"><p class="hint c-text">This session differs from the ${esc(routine.title)} routine. Update the routine, or keep it as it was?</p>
        <div class="btn-row"><button class="btn-ghost" data-u="update" type="button">Update routine</button><button class="btn-ghost" data-u="keep" type="button">Keep as is</button></div></section>` : ''}
      ${session.gym ? `<p class="hint">Gym: ${esc(session.gym)}</p>` : ''}
      ${session.note ? `<p class="hint">Note: ${esc(session.note)}</p>` : ''}
      <section class="card pad-card"><div class="hud c-muted">PHOTOS</div><div class="photo-grid" id="photos"></div>
        <label class="btn-ghost center file-btn">Add photos<input type="file" accept="image/*" multiple hidden id="photo-in"></label></section>
      <div class="btn-row"><a class="btn-ghost center" href="#/session/${esc(id)}/edit">Edit session</a><button class="btn-ghost" id="repeat" type="button">Repeat session</button></div>
      <div class="btn-row"><button class="btn-ghost" id="as-routine" type="button">Save as routine</button>
        <button class="btn-ghost btn-danger" id="del" type="button">Delete session</button></div>`;
    view.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.u === 'update') { await repo.put('routines', routine.id, routineFromSession(session, done, routine)); toast('Routine updated.'); }
      view.querySelector('#upd').remove();
    }));
    view.querySelector('#as-routine').onclick = async () => {
      const r = routineFromSession(session, done, null);
      r.title = `${session.title} (from ${formatDay(new Date(session.startedAt))})`;
      await repo.put('routines', r.id, r);
      toast('Saved as a new routine.');
    };
    const drawPhotos = async () => {
      const ps = (await repo.list('photos')).filter((x) => x.sessionId === id).sort((a, b) => a.at - b.at);
      view.querySelector('#photos').innerHTML = ps.map((x) => `<button class="photo" data-ph="${esc(x.id)}" type="button" aria-label="Photo options"><img src="${x.dataUrl}" alt="Session photo"></button>`).join('') || '<span class="hint">No photos.</span>';
      view.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', async () => {
        if (await confirmSheet('Delete this photo?', { ok: 'Delete', danger: true })) { await repo.remove('photos', b.dataset.ph); drawPhotos(); }
      }));
    };
    drawPhotos();
    view.querySelector('#photo-in').addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        const pid = newPhotoId();
        try { await repo.put('photos', pid, { id: pid, sessionId: id, dataUrl: await fileToJpeg(f), at: Date.now() }); } catch { toast('That photo could not be read.'); }
      }
      drawPhotos();
    });
    view.querySelector('#repeat').onclick = async () => {
      const active = sessions.find((x) => x.status === 'active' && x.kind !== 'holds');
      if (active) { toast('Finish or discard the session in progress first.'); return; }
      const { session: ns, sets: nsets } = copySession(session, done);
      for (const x of nsets) await repo.put('sets', x.id, x);
      await repo.put('sessions', ns.id, ns);
      location.hash = `#/session/${ns.id}`;
    };
    view.querySelector('#del').onclick = async () => {
      if (!(await confirmSheet('Delete this session and all its sets?', { ok: 'Delete', danger: true }))) return;
      for (const s of all) await repo.remove('sets', s.id);
      for (const x of (await repo.list('photos')).filter((p) => p.sessionId === id)) await repo.remove('photos', x.id);
      await repo.remove('sessions', id);
      location.hash = back || '#/train';
    };
  };

  ready.then((r) => { repo = r; draw(); });
  return () => {};
}
