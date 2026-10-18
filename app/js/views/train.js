// TRAIN: next session from the rotation, today's tendon holds, routines grouped in folders.
import { ready } from '../lib/data.js';
import { groupByFolder, newRoutine, duplicateRoutine, moveFolder, nextDayType, newId } from '../lib/routines.js';
import { weekColumn } from '../lib/programme.js';
import { isoDate, formatDay } from '../lib/time.js';
import { actionSheet, promptText, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DOT = { pull: 'var(--pull)', push: 'var(--push)', legs: 'var(--legs)', neck: 'var(--muted)' };
const LABEL = { pull: 'Pull', push: 'Push', legs: 'Legs' };
const day = (iso) => formatDay(new Date(`${iso}T12:00:00`));

/** Last completed workout: Training HQ sessions first, then the Hevy bridge. */
export async function lastCompleted(repo) {
  const own = (await repo.list('sessions')).filter((s) => s.status === 'done' && s.kind !== 'holds' && s.dayType)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const bridge = (await repo.get('bridge', 'last-loads'))?.lastSessions?.find((s) => s.dayType);
  const ownIso = own ? isoDate(new Date(own.startedAt)) : null;
  if (own && (!bridge || ownIso >= bridge.date)) return { dayType: own.dayType, date: ownIso };
  return bridge ? { dayType: bridge.dayType, date: bridge.date } : null;
}

export function render(view) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo;

  const draw = async () => {
    const [folders, routines, meta, last, active] = await Promise.all([
      repo.list('folders'), repo.list('routines'), repo.get('programme', 'meta'), lastCompleted(repo),
      repo.list('sessions').then((ss) => ss.find((s) => s.status === 'active' && s.kind !== 'holds')),
    ]);
    const next = nextDayType(last?.dayType);
    const today = isoDate(new Date());
    const wk = meta ? weekColumn(meta.firstSessions?.[next], today) : null;
    const nextRoutine = routines.filter((r) => r.dayType === next && r.folderId === 'comeback').sort((a, b) => a.order - b.order)[0]
      || routines.find((r) => r.dayType === next);
    const lastByRoutine = new Map();
    const bridge = await repo.get('bridge', 'last-loads');
    for (const s of bridge?.lastSessions || []) if (s.dayType && !lastByRoutine.has(s.dayType)) lastByRoutine.set(s.dayType, s.date);

    view.innerHTML = `
      ${active ? `<a class="card resume" href="#/session/${esc(active.id)}"><span class="hud c-amber">SESSION IN PROGRESS</span><b>${esc(active.title)}</b><span class="pill is-on">Resume</span></a>` : ''}
      <section class="card next-card">
        <div class="hud c-muted next-top"><span>NEXT FROM ROTATION</span><span>${last ? `AFTER ${esc(LABEL[last.dayType] || last.dayType).toUpperCase()} · ${esc(day(last.date)).toUpperCase()}` : ''}</span></div>
        <div class="next-title"><span>${esc(LABEL[next])}</span>${wk ? `<span class="hud c-cyan">WEEK ${wk} COLUMN</span>` : ''}</div>
        <p class="hint">${nextRoutine ? `${nextRoutine.exercises.length} exercises · targets capped at last load + 30%` : 'No routine for this day yet.'}</p>
        <div class="btn-row next-btns">
          ${nextRoutine ? `<a class="btn-primary center" href="#/session/start/${esc(nextRoutine.id)}">Start ${esc(LABEL[next])}</a>` : ''}
          <a class="btn-ghost center" href="#/session/start/empty">Empty</a>
        </div>
      </section>
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
            ${r.folderId === 'comeback' && meta?.firstSessions?.[r.dayType] ? `<span class="hud c-cyan">WK ${weekColumn(meta.firstSessions[r.dayType], today)}</span>` : r.dayType === 'neck' ? '<span class="hud c-amber">NOT SCHEDULED</span>' : '<span></span>'}
            <button class="icon-mini" data-routine="${esc(r.id)}" type="button" aria-label="Options for ${esc(r.title)}">···</button>
          </li>`).join('') || '<li class="hint pad">Empty folder.</li>'}
        </ul>`).join('')}
      <div class="btn-row three">
        <button class="btn-ghost" id="new-routine" type="button">+ Routine</button>
        <button class="btn-ghost" id="new-folder" type="button">+ Folder</button>
        <a class="btn-ghost center" href="#/library">Library</a>
      </div>
      <div class="btn-row three"><a class="btn-ghost center" href="#/calendar">Calendar</a><a class="btn-ghost center" href="#/history">History</a><a class="btn-ghost center" href="#/stats">Statistics</a></div>`;

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
    off = repo.onChange((cols) => { if (cols.some((c) => ['folders', 'routines', 'sessions', 'programme', 'bridge'].includes(c))) draw(); });
    draw();
  });
  return () => off();
}
