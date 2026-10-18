// PROGRESSION (#/progression/<dayType>[/<week>]): week 5+ numbers to confirm (decision 8) and the switch between
// Getting Back Into and Normal for a day type (decision 9). Nothing changes until he confirms.
import { ready } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { weekColumn } from '../lib/programme.js';
import { proposeWeek, confirmWeek, progressId, normalReady, modeOf } from '../lib/progression.js';
import { buildHistory } from '../lib/history.js';
import { comebackStartOf } from '../lib/finish.js';
import { mergeLibrary } from '../lib/library.js';
import { smallestPlate } from '../lib/settings.js';
import { LABEL } from '../lib/rotation.js';
import { isoDate, formatDay } from '../lib/time.js';
import { kg } from '../lib/loads.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const load = (i, v) => (i.added ? `+${kg(v)} kg` : `${kg(v)} kg`);

export function render(view, params = []) {
  const dayType = ['pull', 'push', 'legs'].includes(params[0]) ? params[0] : 'pull';
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo;

  const draw = async () => {
    const [meta, planRoutine, progress, exercises, sessions, sets, bridge] = await Promise.all([
      repo.get('programme', 'meta'), repo.get('programme', `routine.${dayType}-gbi`), repo.list('progression'), repo.list('exercises'),
      repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'),
    ]);
    if (!planRoutine) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/train">Back</a></div><p class="hint">The programme hasn\'t synced from your Mac yet.</p>'; return; }
    const today = isoDate(new Date());
    const nowWeek = weekColumn(meta?.firstSessions?.[dayType], today) || 1;
    const week = Number(params[1]) >= 5 ? Number(params[1]) : Math.max(5, nowWeek);
    const lib = mergeLibrary(exercises, getState().equipment);
    const byName = new Map(lib.map((e) => [e.name, e]));
    const proposal = proposeWeek({ planRoutine, week, progress, meta, barKgOf: (pe) => byName.get(pe.name)?.barKg ?? null, smallestPlate: smallestPlate(getState().equipment) });
    const saved = progress.find((d) => d.dayType === dayType && d.week === week && d.confirmedAt);
    const valueOf = (i) => saved?.exercises.find((e) => e.name === i.name)?.kg ?? i.kg;
    const modes = await repo.get('progression', 'modes');
    const mode = modeOf(modes, dayType);
    const nr = normalReady({ planRoutine, history: buildHistory({ sessions, sets, bridge }), since: comebackStartOf(meta) });
    const live = proposal.items.filter((i) => !i.skip);
    const skipped = proposal.items.filter((i) => i.skip);

    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/train">Back</a></div>
      <h1 class="view-title">${esc(LABEL[dayType])} · week ${week} numbers</h1>
      <p class="hint">Same kg step as week 3 to week 4, never more than 30% and never above your pre-layoff number (decision 8).
        Until you confirm, targets stay on the last confirmed numbers. Your 30% cap against your last load still applies.
        ${nowWeek < week ? `This week starts ${esc(day(addWeeks(meta.firstSessions[dayType], week - 1)))}.` : ''}</p>
      ${saved ? `<p class="hud c-green">CONFIRMED ${esc(day(saved.confirmedOn || isoDate(new Date(saved.confirmedAt))).toUpperCase())}</p>` : '<p class="hud c-amber">WAITING FOR YOUR OK</p>'}
      <section class="card pad-card">
        <ul class="prog-list">
          ${live.map((i, n) => `<li class="prog-row">
            <div class="prog-name"><b>${esc(i.name)}</b><div class="hint">from ${esc(load(i, i.fromKg))} · ${esc(i.why)}</div></div>
            <label class="prog-kg"><span class="sr-only">Week ${week} load for ${esc(i.name)}</span>${i.added ? '<span class="c-muted">+</span>' : ''}
              <input class="input mini num" inputmode="decimal" data-n="${n}" value="${esc(valueOf(i))}"><span class="c-muted">kg</span></label>
          </li>`).join('')}
        </ul>
        ${skipped.length ? `<p class="hint">Not proposed: ${skipped.map((i) => `${esc(i.name)} (${esc(i.why.replace(/\.$/, '').toLowerCase())})`).join('; ')}.</p>` : ''}
        <div class="btn-row"><button class="btn-primary" id="pg-ok" type="button">${saved ? 'Save changes' : `Confirm week ${week}`}</button></div>
      </section>
      <section class="card pad-card">
        <div class="hud c-muted">PROGRAMME VERSION</div>
        <p><b>${mode === 'normal' ? 'Normal' : 'Getting Back Into'}</b>${modes?.[dayType]?.on ? ` <span class="hint">since ${esc(day(modes[dayType].on))}</span>` : ''}</p>
        <p class="hint">Switch when the main lifts are at their week 4 numbers and stable for 2 to 3 sessions (decision 9). Lifts gated on filmed form are left out.</p>
        <ul class="prog-ready">${nr.lifts.map((l) => `<li class="${l.ok ? 'c-green' : 'c-muted'}">${l.ok ? '✓' : '·'} ${esc(l.name)}: week 4 ${kg(l.week4Kg)} kg · last ${l.recent.length ? l.recent.map((r) => kg(r.kg)).join(', ') : 'none'}</li>`).join('')}</ul>
        <div class="btn-row">${mode === 'normal'
          ? '<button class="btn-ghost" id="pg-back" type="button">Back to Getting Back Into</button>'
          : `<button class="${nr.ready ? 'btn-primary' : 'btn-ghost'}" id="pg-normal" type="button">Switch to Normal</button>`}</div>
      </section>`;

    view.querySelector('#pg-ok').onclick = async () => {
      const edits = {};
      for (const inp of view.querySelectorAll('[data-n]')) {
        const v = Number(String(inp.value).replace(',', '.'));
        if (!Number.isFinite(v) || v <= 0) { toast('Enter a weight for every exercise.'); inp.focus(); return; }
        edits[live[Number(inp.dataset.n)].name] = v;
      }
      const doc = confirmWeek(proposal, edits, { today });
      await repo.put('progression', progressId(dayType, week), doc);
      toast(`${LABEL[dayType]} week ${week} confirmed.`);
    };
    const setMode = async (next) => {
      const cur = (await repo.get('progression', 'modes')) || {};
      await repo.put('progression', 'modes', { ...cur, [dayType]: { mode: next, on: today, ...(next === 'normal' ? { ready: nr.ready } : {}) } });
    };
    const toNormal = view.querySelector('#pg-normal');
    if (toNormal) toNormal.onclick = async () => {
      const msg = nr.ready ? `Switch ${LABEL[dayType]} to its Normal programme? Working loads come from your last session.`
        : `Not every main lift is at its week 4 number for 2 sessions yet. Switch ${LABEL[dayType]} to Normal anyway?`;
      if (!(await confirmSheet(msg, { ok: 'Switch' }))) return;
      await setMode('normal');
      toast(`${LABEL[dayType]} runs the Normal programme now.`);
    };
    const back = view.querySelector('#pg-back');
    if (back) back.onclick = async () => {
      if (!(await confirmSheet(`Put ${LABEL[dayType]} back on Getting Back Into?`, { ok: 'Switch back' }))) return;
      await setMode('comeback');
    };
  };

  let off = () => {};
  ready.then((r) => {
    repo = r;
    off = repo.onChange((cols) => { if (cols.some((c) => ['progression', 'programme'].includes(c))) draw(); });
    draw();
  });
  return () => off();
}

function addWeeks(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
}
