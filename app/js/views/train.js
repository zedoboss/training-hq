// TRAIN: next session from the rotation, today's tendon holds, routines grouped in folders.
import { ready } from '../lib/data.js';
import { groupByFolder, newRoutine, duplicateRoutine, moveFolder, newId } from '../lib/routines.js';
import { weekColumn } from '../lib/programme.js';
import { rotationDay, lastRotationSession, daysByDate, withRest, withTime, usualStart, REST_TEXT, LABEL } from '../lib/rotation.js';
import { isConfirmed, normalReady, modeOf } from '../lib/progression.js';
import { buildHistory } from '../lib/history.js';
import { ACTION_TEXT } from '../lib/readiness.js';
import { NECK_PLACES, placeLabel, neckAsk, answerNeck, neckToday, neckTodayText, neckDoneOn } from '../lib/neck.js';
import { comebackStartOf } from '../lib/finish.js';
import { isoDate, formatDay, formatHm, addMinutesHm } from '../lib/time.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { actionSheet, promptText, confirmSheet, promptTime } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { SQUAT_ICON } from './squat.js';
import { savedTargetDeg } from '../lib/squat-log.js';
import { isDone, planFor } from '../lib/scans.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DOT = { pull: 'var(--pull)', push: 'var(--push)', legs: 'var(--legs)', neck: 'var(--muted)' };
const day = (iso) => formatDay(new Date(`${iso}T12:00:00`));

export function render(view) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo;

  const draw = async () => {
    const [folders, routines, meta, sessions, bridge, dayList, squats] = await Promise.all([
      repo.list('folders'), repo.list('routines'), repo.get('programme', 'meta'), repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days'), repo.list('squats'),
    ]);
    const lastSquat = squats.filter((r) => r.reps?.length).sort((a, b) => b.startedAt - a.startedAt)[0];
    const active = sessions.find((s) => s.status === 'active' && s.kind !== 'holds');
    const today = isoDate(new Date());
    const days = daysByDate(dayList);
    const last = lastRotationSession(sessions, bridge);
    const rot = rotationDay({ last, today, days });
    const next = rot.next.dayType;
    const wk = meta ? weekColumn(meta.firstSessions?.[next], rot.next.date) : null;
    const [progress, modes, planRoutine] = await Promise.all([repo.list('progression'), repo.get('progression', 'modes'), repo.get('programme', `routine.${next}-gbi`)]);
    const mode = modeOf(modes, next);
    const nextRoutine = routines.filter((r) => r.dayType === next && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((a, b) => a.order - b.order)[0]
      || routines.find((r) => r.dayType === next);
    // Week 5+: the week's numbers wait for his OK (decision 8). Week 4+: suggest the Normal programme (decision 9).
    const needsOk = mode === 'comeback' && wk >= 5 && !isConfirmed(progress, next, wk);
    let suggestNormal = null;
    if (mode === 'comeback' && wk >= 4 && planRoutine) {
      const nr = normalReady({ planRoutine, history: buildHistory({ sessions, sets: await repo.list('sets'), bridge }), since: comebackStartOf(meta) });
      const latest = nr.lifts.flatMap((l) => l.recent.map((r) => r.date)).sort().pop();
      if (nr.ready && modes?.[next]?.notYet !== latest) suggestNormal = { latest, n: nr.need };
    }
    // Each routine card's "last": his newest session of that day type, imported ones included (Tue 10/20: the cards
    // still showed the history bridge's dates after his Hevy and Strong history came in), else the bridge.
    const lastByRoutine = new Map();
    for (const s of sessions.filter((x) => x.dayType && x.startedAt && x.kind !== 'holds' && x.status !== 'discarded' && x.status !== 'active').sort((a, b) => b.startedAt - a.startedAt)) {
      if (!lastByRoutine.has(s.dayType)) lastByRoutine.set(s.dayType, isoDate(new Date(s.startedAt)));
    }
    for (const s of bridge?.lastSessions || []) if (s.dayType && (!lastByRoutine.has(s.dayType) || lastByRoutine.get(s.dayType) < s.date)) lastByRoutine.set(s.dayType, s.date);
    const t = rot.today;
    const headline = t.kind === 'train' ? `Today · ${LABEL[next]}` : t.kind === 'done' ? `Today · ${LABEL[t.dayType]} done` : 'Today · Rest';
    const nextLine = t.kind === 'train' ? '' : `Next: ${LABEL[next]}, ${day(rot.next.date)}`;
    const undoable = t.kind === 'rest' && t.reason !== 'rotation';
    const rd = days[today]?.readiness || null;
    // Neck (decision 14): asked weekly until it has a place; on its day, a link to start it.
    const neck = await repo.get('schedule', 'neck');
    const neckRoutine = routines.find((r) => r.dayType === 'neck');
    const askNeck = neckRoutine && neckAsk(neck, today);
    const neckDue = neckRoutine && neckToday(neck, t.kind, t.kind === 'done' ? t.dayType : next) && !neckDoneOn(sessions, today, (ms) => isoDate(new Date(ms)));
    // Session time for the next session's date (decision 15: he sets it; no fixed start time).
    const nextDate = rot.next.date;
    const hm = days[nextDate]?.sessionTime || null;
    const checkMin = withDefaults(getState().settings).notify.readinessMin;
    // Body scan day (step 7): first thing at the gym, before this session.
    const [planDoc, scans] = await Promise.all([repo.get('scan-plan', 'main'), repo.list('body-scans')]);
    const scanPlan = planFor(planDoc || {}, { scans, today, last, days });
    const scanFirst = scanPlan?.next?.date === nextDate && t.kind !== 'done' && !scans.some((x) => x.date === nextDate && isDone(x));
    const whenLine = hm
      ? `${nextDate === today ? 'Today' : esc(day(nextDate))}, ${formatHm(hm)} · check-in ${formatHm(addMinutesHm(hm, -checkMin))}`
      : `No time set for ${nextDate === today ? 'today' : esc(day(nextDate))}`;

    view.innerHTML = `
      ${active ? `<a class="card resume" href="#/session/${esc(active.id)}"><span class="hud c-amber">SESSION IN PROGRESS</span><b>${esc(active.title)}</b><span class="pill is-on">Resume</span></a>` : ''}
      <section class="card next-card" data-today="${esc(t.kind)}">
        <div class="hud c-muted next-top"><span>ROTATION</span><span>${last ? `LAST ${esc(LABEL[last.dayType]).toUpperCase()} · ${esc(day(last.date)).toUpperCase()}` : ''}</span></div>
        <div class="next-title"><span>${esc(headline)}</span>${wk && t.kind === 'train' ? `<span class="hud c-cyan">WEEK ${wk} COLUMN</span>` : ''}</div>
        ${t.kind === 'rest' ? `<p class="hint c-text rest-why">${esc(REST_TEXT[t.reason] || REST_TEXT.added)}. Tendon holds as planned.</p>` : ''}
        ${nextLine ? `<p class="hint next-line">${esc(nextLine)}${wk ? ` · week ${wk} column` : ''}</p>` : ''}
        ${t.kind === 'train' ? (rd && rd.dayType === next
          ? `<a class="card-note ${rd.action === 'train' ? '' : 'c-amber'}" id="rd-line" href="#/checkin">Check-in (rule ${rd.rule}): ${esc(ACTION_TEXT[rd.action])}${rd.action === 'lighter-area' && rd.lighterExercises?.length ? ` ${esc(rd.lighterExercises.join(', '))}.` : ''}</a>`
          : '<a class="card-note" id="rd-line" href="#/checkin">Sore, or good to go? Check in before you start ›</a>') : ''}
        ${scanFirst ? `<a class="card-note c-amber" id="scan-first" href="#/body/scan">Body scan ${nextDate === today ? 'today' : esc(day(nextDate))}: first thing at the gym, before this session. Checklist ›</a>` : ''}
        <div class="time-line"><span class="hud ${hm ? 'c-cyan' : 'c-amber'}" id="time-text">${whenLine.toUpperCase()}</span><button class="pill" id="set-time" type="button">${hm ? 'Change' : 'Set time'}</button></div>
        <p class="hint">${nextRoutine ? `${mode === 'normal' ? 'Normal programme · ' : ''}${nextRoutine.exercises.length} exercises · targets capped at last load + 30%` : 'No routine for this day yet.'}</p>
        ${needsOk ? `<a class="card-note c-amber" id="wk-ok" href="#/progression/${esc(next)}/${wk}">Week ${wk} numbers need your OK. Until then: last confirmed numbers. Review ›</a>` : ''}
        ${suggestNormal ? `<div class="card-note" id="normal-hint"><span>${esc(LABEL[next])}'s main lifts hit their week 4 numbers in the last ${suggestNormal.n} sessions. Switch to the Normal programme?</span>
          <span class="btn-row"><a class="pill is-on" href="#/progression/${esc(next)}">Review</a><button class="pill" id="normal-later" type="button">Not yet</button></span></div>` : ''}
        <div class="btn-row next-btns">
          ${nextRoutine ? `<a class="${t.kind === 'train' ? 'btn-primary' : 'btn-ghost'} center" href="#/session/start/${esc(nextRoutine.id)}">${t.kind === 'train' ? `Start ${esc(LABEL[next])}` : `${esc(LABEL[next])} now`}</a>` : ''}
          <a class="btn-ghost center" href="#/session/start/empty">Empty</a>
        </div>
        ${neckDue ? `<a class="card-note" id="neck-today" href="#/session/start/${esc(neckRoutine.id)}">${esc(neckTodayText(neck.place))} (your plan) ›</a>` : ''}
        ${t.kind === 'train' ? '<button class="link-btn" id="rest-today" type="button">Rest today instead</button>' : ''}
        ${undoable ? '<button class="link-btn" id="undo-rest" type="button">Undo rest day</button>' : ''}
      </section>
      ${askNeck ? `<section class="card pad-card neck-card" id="neck-card"><div class="hud c-amber">NECK · STILL UNPLANNED</div>
        <p class="hint c-text">Your Neck routine (${neckRoutine.exercises.length} exercises) has no place in the rotation yet. Where should it go?</p>
        <div class="chips wrap">${NECK_PLACES.map(([k, label]) => `<button class="chip" data-neck="${k}" type="button">${esc(label)}</button>`).join('')}<button class="chip" data-neck="not-yet" type="button">Not yet</button></div>
        <p class="hint">"Not yet" asks again in a week. When it restarts, your 30% cap applies from a light start.</p></section>` : ''}
      <a class="card sq-card" href="#/squat" id="squat-card">${SQUAT_ICON}<span class="sq-card-main"><b>Squat Depth</b>
        <span class="hud c-muted">${lastSquat ? `LAST ${lastSquat.good} REPS · LOW ${Math.round(lastSquat.lowDeg)}° · ` : ''}TARGET ${savedTargetDeg()}°</span></span><span class="pill is-on">Camera</span></a>
      <a class="card holds-link" href="#/holds"><span><span class="hud c-muted">TENDON HOLDS</span><br>Shoulder, knees, wrist</span><span class="pill">Open</span></a>
      ${groupByFolder(folders, routines).map(({ folder, routines: rs }) => `
        <div class="section-label folder-label">
          <span>${esc(folder ? folder.title : 'No folder')}</span>
          ${folder ? `<button class="icon-mini" data-folder="${esc(folder.id)}" type="button" aria-label="Folder options for ${esc(folder.title)}">···</button>` : ''}
        </div>
        <ul class="routine-list">
          ${rs.map((r) => `<li class="routine-row">
            <span class="dot" style="background:${DOT[r.dayType] || 'var(--border-strong)'}"></span>
            <a class="routine-main" href="#/routine/${esc(r.id)}"><b>${esc(r.title)}</b>
              <span class="hint">${r.exercises.length} exercises${lastByRoutine.has(r.dayType) && r.folderId === 'comeback' ? ` · last ${esc(day(lastByRoutine.get(r.dayType)))}` : ''}</span></a>
            ${r.folderId === 'comeback' && meta?.firstSessions?.[r.dayType] ? `<span class="hud c-cyan">WK ${weekColumn(meta.firstSessions[r.dayType], today)}</span>` : r.dayType === 'neck' ? `<button class="hud link-hud ${neck?.planned ? 'c-cyan' : 'c-amber'}" id="neck-place" type="button">${neck?.planned ? esc(placeLabel(neck.place).toUpperCase()) : 'NOT SCHEDULED'}</button>` : '<span></span>'}
            <button class="icon-mini" data-routine="${esc(r.id)}" type="button" aria-label="Options for ${esc(r.title)}">···</button>
          </li>`).join('') || '<li class="hint pad">Empty folder.</li>'}
        </ul>`).join('')}
      <div class="btn-row three">
        <button class="btn-ghost" id="new-routine" type="button">+ Routine</button>
        <button class="btn-ghost" id="new-folder" type="button">+ Folder</button>
        <a class="btn-ghost center" href="#/library">Library</a>
      </div>
      <div class="btn-row three"><a class="btn-ghost center" href="#/calendar">Calendar</a><a class="btn-ghost center" href="#/history">History</a><a class="btn-ghost center" href="#/stats">Statistics</a></div>`;

    const saveNeck = async (answer) => {
      await repo.put('schedule', 'neck', answerNeck(await repo.get('schedule', 'neck'), answer, today));
      toast(answer === 'not-yet' ? 'Asks again in a week.' : `Neck ${placeLabel(answer).toLowerCase()} from now on.`);
    };
    view.querySelectorAll('[data-neck]').forEach((b) => b.addEventListener('click', () => saveNeck(b.dataset.neck)));
    const place = view.querySelector('#neck-place');
    if (place) place.onclick = () => actionSheet('Neck routine', [
      ...NECK_PLACES.map(([k, label]) => ({ label, run: () => saveNeck(k) })),
      ...(neck?.planned ? [{ label: 'Take it out of the rotation', run: async () => { await repo.put('schedule', 'neck', { ...neck, planned: false, place: null, lastAskedOn: today }); toast('Neck is unplanned again.'); } }] : []),
    ]);
    const later = view.querySelector('#normal-later');
    if (later) later.onclick = async () => {
      const cur = (await repo.get('progression', 'modes')) || {};
      await repo.put('progression', 'modes', { ...cur, [next]: { ...(cur[next] || { mode: 'comeback' }), notYet: suggestNormal.latest } });
      toast('Asks again after your next session.');
    };
    view.querySelector('#set-time').onclick = async () => {
      const usual = usualStart(sessions);
      const v = await promptTime(`${LABEL[next]} · ${nextDate === today ? 'today' : day(nextDate)}`, hm || usual || '04:30', {
        clear: !!hm, text: `Session start. The check-in comes ${checkMin} minutes before.${usual ? ` Your usual: ${formatHm(usual)}.` : ''}`,
      });
      if (v == null) return;
      await repo.put('days', nextDate, withTime(days[nextDate], nextDate, v || null));
      toast(v ? `${LABEL[next]} at ${formatHm(v)}.` : 'Time cleared.');
    };
    const restBtn = view.querySelector('#rest-today');
    if (restBtn) restBtn.onclick = async () => {
      if (!(await confirmSheet(`Rest today? ${LABEL[next]} stays next and moves to tomorrow; nothing is made up twice.`, { ok: 'Rest today' }))) return;
      await repo.put('days', today, withRest(days[today], today, 'added'));
      // Today's time carries over to the next session's date unless that one has its own.
      const moved = rotationDay({ last, today, days: { ...days, [today]: withRest(days[today], today, 'added') } }).next.date;
      if (hm && nextDate === today && !days[moved]?.sessionTime) await repo.put('days', moved, withTime(days[moved], moved, hm));
      toast(`Rest day. ${LABEL[next]} is next.`);
    };
    const undoBtn = view.querySelector('#undo-rest');
    if (undoBtn) undoBtn.onclick = async () => {
      await repo.put('days', today, withRest(days[today], today, null));
      toast('Rest day taken back.');
    };
    view.querySelector('#new-routine').onclick = async () => {
      const title = await promptText('New routine', '', { placeholder: 'Name' });
      if (!title) return;
      const r = newRoutine({ title, folderId: null, order: routines.length });
      await repo.put('routines', r.id, r);
      location.hash = `#/routine/${r.id}/edit`;
    };
    view.querySelector('#new-folder').onclick = async () => {
      const title = await promptText('New folder', '', { placeholder: 'Name' });
      if (!title) return;
      const f = { id: newId('folder'), title, order: -1 };
      await repo.put('folders', f.id, f);
      for (const x of moveFolder([...folders, f], f.id, 0)) await repo.put('folders', x.id, x);
    };
    view.querySelectorAll('[data-routine]').forEach((b) => b.addEventListener('click', () => {
      const r = routines.find((x) => x.id === b.dataset.routine);
      actionSheet(r.title, [
        { label: 'Edit', run: () => { location.hash = `#/routine/${r.id}/edit`; } },
        { label: 'Duplicate', run: async () => { const d = duplicateRoutine(r); await repo.put('routines', d.id, d); toast('Duplicated.'); } },
        { label: 'Move to folder', run: () => actionSheet('Move to', [...folders.map((f) => ({ label: f.title, run: async () => repo.put('routines', r.id, { ...r, folderId: f.id }) })), { label: 'No folder', run: async () => repo.put('routines', r.id, { ...r, folderId: null }) }]) },
        { label: 'Delete', danger: true, run: async () => { if (await confirmSheet(`Delete the routine "${r.title}"? Past sessions stay.`, { ok: 'Delete', danger: true })) await repo.remove('routines', r.id); } },
      ]);
    }));
    view.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => {
      const f = folders.find((x) => x.id === b.dataset.folder);
      const save = async (list) => { for (const x of list) await repo.put('folders', x.id, x); };
      actionSheet(f.title, [
        { label: 'Rename', run: async () => { const t = await promptText('Rename folder', f.title); if (t) await repo.put('folders', f.id, { ...f, title: t }); } },
        { label: 'Move up', run: () => save(moveFolder(folders, f.id, -1)) },
        { label: 'Move down', run: () => save(moveFolder(folders, f.id, 1)) },
        { label: 'Delete folder', danger: true, run: async () => {
          if (!(await confirmSheet(`Delete the folder "${f.title}"? Its routines move to No folder.`, { ok: 'Delete', danger: true }))) return;
          for (const r of routines.filter((x) => x.folderId === f.id)) await repo.put('routines', r.id, { ...r, folderId: null });
          await repo.remove('folders', f.id);
        } },
      ]);
    }));
  };

  let off = () => {};
  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.some((c) => ['folders', 'routines', 'sessions', 'programme', 'bridge', 'days', 'progression', 'schedule', 'squats', 'scan-plan', 'body-scans'].includes(c))) draw(); });
    draw();
  });
  return () => off();
}
