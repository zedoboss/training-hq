// READINESS: the decision table (#/readiness: confirm or edit, decision 23) and the check-in (#/checkin).
// The table is a draft until he confirms it here; the check-in won't run on a draft. It stays editable afterwards,
// and every edit is dated in the table's change list (brief section 5).
import { ready } from '../lib/data.js';
import { askedAreas, loadedAreas, exercisesLoading, workingKeys, decide, complete, paramsOf, ACTION_TEXT, DEFAULT_PARAMS } from '../lib/readiness.js';
import { rotationDay, lastRotationSession, daysByDate, withRest, withTime, addDays, LABEL } from '../lib/rotation.js';
import { modeOf } from '../lib/progression.js';
import { isoDate, formatDay, formatHm } from '../lib/time.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const KEY_NAME = { L: 'Legs', B: 'Back' };
const AREA_ORDER = ['knees', 'shoulder', 'wrist'];

async function loadAll(repo) {
  const [table, docs, programme] = await Promise.all([repo.get('tendons', 'readiness'), repo.list('tendons'), repo.list('programme')]);
  const areas = askedAreas(docs).sort((a, b) => AREA_ORDER.indexOf(a.id) - AREA_ORDER.indexOf(b.id));
  const names = [...new Set(programme.filter((d) => d.kind === 'routine' && /-gbi$|-normal$/.test(d.id) && d.dayType !== 'neck')
    .flatMap((r) => (r.exercises || []).map((e) => e.name)).filter(Boolean))].sort();
  return { table, areas, names };
}

// ---------- the table: confirm or edit ----------

function tableHtml(table, areas, names) {
  const p = paramsOf(table);
  const wa = table.workingArea || {};
  return `
    ${table.status === 'confirmed'
      ? `<p class="hud c-green">CONFIRMED ${esc(day(table.confirmedOn).toUpperCase())} · STILL EDITABLE</p>`
      : '<p class="hud c-amber">DRAFT · CONFIRM OR EDIT IT BEFORE THE FIRST CHECK-IN (DECISION 23)</p>'}
    <p class="hint">${esc(table.origin || '')}</p>
    <section class="card pad-card">
      <div class="hud c-muted">RATINGS, 0 TO 3</div>
      ${(table.ratings || []).map((r) => `<div class="rd-rating"><b>${esc(r.label)} (${esc(r.key)})</b>
        ${r.levels.map((lv, i) => `<label class="rd-level"><span class="hud c-cyan">${i}</span><input class="input" data-level="${esc(r.key)}" data-i="${i}" value="${esc(lv)}" maxlength="80"></label>`).join('')}</div>`).join('')}
      <p class="hint">Plus, for each sore area: "${esc(table.worseQuestion?.text || 'Is the tendon worse than yesterday?')}" (yes or no). Your note's next-day test.</p>
    </section>
    <section class="card pad-card">
      <div class="hud c-muted">SORENESS THAT COUNTS EACH DAY (WORKING AREA)</div>
      ${['pull', 'push', 'legs'].map((d) => `<div class="rd-wa"><span>${LABEL[d]}</span>${['L', 'B'].map((k) => `<label class="rd-check"><input type="checkbox" data-wa="${d}" data-k="${k}" ${(wa[d] || []).includes(k) ? 'checked' : ''}> ${KEY_NAME[k]}</label>`).join('')}</div>`).join('')}
      ${wa.openQuestion ? `<p class="hint c-amber">Open: ${esc(wa.openQuestion)}</p>` : ''}
    </section>
    <section class="card pad-card">
      <div class="hud c-muted">RULES · FIRST MATCH DECIDES</div>
      <ol class="rd-rules">${(table.rules || []).map((r) => `<li><b>If</b> ${esc(r.if)}: ${esc(r.then)}</li>`).join('')}</ol>
      <ul class="rd-notes">${(table.notes || []).slice(1).map((n) => `<li class="hint">${esc(n)}</li>`).join('')}</ul>
    </section>
    <section class="card pad-card">
      <div class="hud c-muted">"GO LIGHTER" MEANS</div>
      <label class="opt">Drop the affected exercises back by <input class="input mini num" data-p="weeksBack" inputmode="numeric" value="${p.weeksBack}"> week column(s)</label>
      <label class="opt">In week 1: <input class="input mini num" data-p="week1Pct" inputmode="numeric" value="${p.week1Pct}"> % under the target</label>
      <label class="opt">Keep the sets, stop <input class="input mini num" data-p="repsShort" inputmode="numeric" value="${p.repsShort}"> reps short of the rep target</label>
      <p class="hint">A session moves to tomorrow at most once; the next time it becomes rest and holds (rules 2 and 3).</p>
    </section>
    <section class="card pad-card">
      <div class="hud c-muted">EXERCISES THAT LOAD EACH SORE AREA</div>
      <p class="hint">A sore-tendon rating only changes the session when today's session has one of these.</p>
      ${areas.map((a) => `<details class="rd-area"><summary><b>${esc(a.label)}</b> <span class="hint">${(a.loadsArea?.exercises || []).length} exercises${a.loadsArea?.draft ? ' · draft' : ''}</span></summary>
        ${names.map((n) => `<label class="rd-check block"><input type="checkbox" data-area="${esc(a.id)}" value="${esc(n)}" ${(a.loadsArea?.exercises || []).includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </details>`).join('')}
    </section>
    <div class="btn-row"><button class="btn-primary" id="rd-save" type="button">${table.status === 'confirmed' ? 'Save changes' : 'Confirm the table'}</button></div>`;
}

/** Reads the editor and saves the table (and the areas' exercise lists). Returns false when something is missing. */
async function saveTable(view, repo, table, areas) {
  const today = isoDate(new Date());
  const ratings = (table.ratings || []).map((r) => ({ ...r, levels: r.levels.map((lv, i) => view.querySelector(`[data-level="${r.key}"][data-i="${i}"]`)?.value.trim() || lv) }));
  const params = {};
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    const el = view.querySelector(`[data-p="${k}"]`);
    if (!el) { params[k] = paramsOf(table)[k]; continue; }
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 0 || (k === 'weeksBack' && v > 3) || (k === 'week1Pct' && v > 60) || (k === 'repsShort' && v > 6)) { toast('Check the "go lighter" numbers.'); el.focus(); return false; }
    params[k] = v;
  }
  const workingArea = { ...(table.workingArea || {}) };
  for (const d of ['pull', 'push', 'legs']) workingArea[d] = ['L', 'B'].filter((k) => view.querySelector(`[data-wa="${d}"][data-k="${k}"]`)?.checked);
  const changed = [];
  if (JSON.stringify(ratings) !== JSON.stringify(table.ratings)) changed.push('levels');
  if (JSON.stringify(params) !== JSON.stringify(paramsOf(table))) changed.push('go-lighter amounts');
  if (['pull', 'push', 'legs'].some((d) => JSON.stringify(workingArea[d]) !== JSON.stringify(table.workingArea?.[d] || []))) changed.push('working areas');
  const first = table.status !== 'confirmed';
  const what = first ? `Confirmed by Michael in the app${changed.length ? `, with edits: ${changed.join(', ')}` : ''}.` : `Edited in the app: ${changed.join(', ') || 'areas only'}.`;
  const next = {
    ...table, ratings, params, workingArea, status: 'confirmed', confirmedOn: table.confirmedOn || today,
    changes: [...(table.changes || []), { date: today, what }],
  };
  await repo.put('tendons', 'readiness', next);
  for (const a of areas) {
    const list = [...view.querySelectorAll(`[data-area="${a.id}"]`)].filter((x) => x.checked).map((x) => x.value);
    const same = JSON.stringify([...list].sort()) === JSON.stringify([...(a.loadsArea?.exercises || [])].sort());
    if (same && !first) continue;
    await repo.put('tendons', `area.${a.id}`, { ...a, loadsArea: { ...(a.loadsArea || {}), exercises: list, draft: false, confirmedOn: today, source: `${a.loadsArea?.source || ''}${same ? '' : ` Edited in the app ${today}.`}`.trim() } });
  }
  return true;
}

function renderTable(view, onDone = null) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  ready.then(async (repo) => {
    const { table, areas, names } = await loadAll(repo);
    if (!table) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/train">Back</a></div><p class="hint">The readiness table hasn\'t synced from your Mac yet.</p>'; return; }
    view.innerHTML = `<div class="lib-head"><a class="pill" href="${onDone ? '#/train' : '#/checkin'}">Back</a></div>
      <h1 class="view-title">${onDone ? 'First, your readiness table' : 'Readiness table'}</h1>${tableHtml(table, areas, names)}`;
    view.querySelector('#rd-save').onclick = async () => {
      if (!(await saveTable(view, repo, table, areas))) return;
      toast(table.status === 'confirmed' ? 'Table saved.' : 'Table confirmed.');
      if (onDone) onDone(); else renderTable(view);
    };
  });
}

// ---------- the check-in ----------

function segment(name, n, value, labels) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${Array.from({ length: n }, (_, i) => `<button type="button" class="pill seg-btn ${value === i ? 'is-on' : ''}" data-v="${i}" role="radio" aria-checked="${value === i}" title="${esc(labels?.[i] || '')}">${i}</button>`).join('')}</div>`;
}

function renderCheckin(view) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let repo; let ctx; const ratings = { T: {}, W: {} }; let again = false;

  const load = async () => {
    const { table, areas } = await loadAll(repo);
    const [sessions, bridge, dayList, routines, modes] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days'), repo.list('routines'), repo.get('progression', 'modes')]);
    const today = isoDate(new Date());
    const days = daysByDate(dayList);
    const last = lastRotationSession(sessions, bridge);
    const rot = rotationDay({ last, today, days });
    const dayType = rot.today.kind === 'train' ? rot.today.dayType : null;
    const mode = dayType ? modeOf(modes, dayType) : null;
    const routine = dayType ? (routines.filter((r) => r.dayType === dayType && r.folderId === (mode === 'normal' ? 'normal' : 'comeback')).sort((a, b) => a.order - b.order)[0] || routines.find((r) => r.dayType === dayType)) : null;
    const exNames = (routine?.exercises || []).map((e) => e.name);
    ctx = { table, areas, today, days, rot, last, dayType, routine, exNames, loaded: dayType ? loadedAreas(areas, exNames) : [], keys: dayType ? workingKeys(table, dayType) : [] };
  };

  const ratingLevels = (key) => (ctx.table.ratings || []).find((r) => r.key === key)?.levels || [];

  const draw = () => {
    const { table, areas, dayType, today, days } = ctx;
    if (!table) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/today">Back</a></div><p class="hint">The readiness table hasn\'t synced from your Mac yet.</p>'; return; }
    if (table.status !== 'confirmed') { renderTable(view, async () => { await load(); draw(); }); return; }
    const saved = days[today]?.readiness;
    if (saved && !again) { drawResult(saved); return; }
    const hm = days[ctx.rot.next.date]?.sessionTime;
    const ids = areas.map((a) => a.id);
    const done = dayType ? complete(ratings, ids, ctx.keys) : ids.every((id) => Number.isInteger(ratings.T[id]) && typeof ratings.W[id] === 'boolean');
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/today">Back</a><a class="pill" href="#/readiness">Table</a></div>
      <h1 class="view-title">Sore, or good to go?</h1>
      <p class="hint">${dayType ? `${esc(LABEL[dayType])} today${hm && ctx.rot.next.date === today ? ` at ${formatHm(hm)}` : ''}. ` : 'Rest day: the tendon ratings decide whether the holds are eased. '}Zero to three. Tap a number to see what it means.</p>
      ${areas.map((a) => `<section class="card pad-card rd-q" data-area-q="${esc(a.id)}">
        <div class="ex-head"><b>${esc(a.label)}</b>${ctx.loaded.includes(a.id) ? '<span class="hud c-amber">TODAY LOADS IT</span>' : ''}</div>
        <div class="hint">Sore tendon area (T)</div>
        ${segment(`${a.label} soreness`, 4, ratings.T[a.id], ratingLevels('T'))}
        <div class="hint rd-meaning">${Number.isInteger(ratings.T[a.id]) ? esc(ratingLevels('T')[ratings.T[a.id]]) : '&nbsp;'}</div>
        <div class="hint">${esc(table.worseQuestion?.text || 'Is the tendon worse than yesterday?')}</div>
        <div class="seg" data-w><button type="button" class="pill seg-btn ${ratings.W[a.id] === false ? 'is-on' : ''}" data-yes="0">No</button><button type="button" class="pill seg-btn ${ratings.W[a.id] === true ? 'is-on' : ''}" data-yes="1">Yes</button></div>
      </section>`).join('')}
      ${ctx.keys.map((k) => `<section class="card pad-card rd-q" data-key-q="${k}"><b>${KEY_NAME[k]} (${k})</b>
        ${segment(KEY_NAME[k], 4, ratings[k], ratingLevels(k))}
        <div class="hint rd-meaning">${Number.isInteger(ratings[k]) ? esc(ratingLevels(k)[ratings[k]]) : '&nbsp;'}</div></section>`).join('')}
      ${dayType ? `<section class="card pad-card rd-q" data-key-q="E"><b>Energy (E)</b>
        ${segment('Energy', 4, ratings.E, ratingLevels('E'))}
        <div class="hint rd-meaning">${Number.isInteger(ratings.E) ? esc(ratingLevels('E')[ratings.E]) : '&nbsp;'}</div></section>` : ''}
      <div class="btn-row"><button class="btn-primary" id="rd-go" type="button" ${done ? '' : 'disabled'}>See what that means</button></div>`;

    view.querySelectorAll('[data-area-q]').forEach((sec) => {
      const id = sec.dataset.areaQ;
      sec.querySelectorAll('.seg:not([data-w]) [data-v]').forEach((b) => b.addEventListener('click', () => { ratings.T[id] = Number(b.dataset.v); draw(); }));
      sec.querySelectorAll('[data-yes]').forEach((b) => b.addEventListener('click', () => { ratings.W[id] = b.dataset.yes === '1'; draw(); }));
    });
    view.querySelectorAll('[data-key-q]').forEach((sec) => {
      sec.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { ratings[sec.dataset.keyQ] = Number(b.dataset.v); draw(); }));
    });
    view.querySelector('#rd-go').onclick = async () => {
      const movedYesterday = days[addDays(today, -1)]?.rest?.reason === 'moved';
      const d = decide({ table, ratings, dayType, loaded: ctx.loaded, movedYesterday });
      const names = d.action === 'lighter-area' ? exercisesLoading(areas, d.lighterAreas, ctx.exNames) : [];
      const rec = { at: Date.now(), dayType, routineId: ctx.routine?.id ?? null, ratings: structuredClone(ratings), ...d, lighterExercises: names, params: paramsOf(table) };
      await repo.put('days', today, { ...(days[today] || { date: today }), date: today, readiness: rec });
      again = false;
      ctx.days = { ...days, [today]: { ...(days[today] || {}), date: today, readiness: rec } };
      drawResult(rec);
    };
  };

  const drawResult = (rec) => {
    const { areas, today, days, routine } = ctx;
    const label = (id) => areas.find((a) => a.id === id)?.label || id;
    const restNow = days[today]?.rest;
    const doneAction = restNow && ['moved', 'rest-holds'].includes(restNow.reason);
    const nextDay = addDays(today, 1);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/today">Back</a><a class="pill" href="#/readiness">Table</a></div>
      <h1 class="view-title">Check-in</h1>
      <section class="card pad-card rd-result" data-action="${esc(rec.action)}">
        <div class="hud ${rec.action === 'train' || rec.action === 'rest' ? 'c-green' : 'c-amber'}">${rec.rule ? `RULE ${rec.rule}` : 'REST DAY'} · ${esc(rec.why.toUpperCase())}</div>
        <p class="rd-answer">${esc(ACTION_TEXT[rec.action])}</p>
        ${rec.action === 'lighter-area' && rec.lighterExercises?.length ? `<p class="hint c-text">Lighter: ${esc(rec.lighterExercises.join(', '))}.</p>` : ''}
        ${rec.action.startsWith('lighter') ? `<p class="hint">Lighter = back ${rec.params.weeksBack} week column (week 1: ${rec.params.week1Pct}% under), same sets, stop ${rec.params.repsShort} reps short. The session's targets are set this way when you start it.</p>` : ''}
        ${rec.easeHolds?.length ? `<p class="hint c-text">Holds for ${esc(rec.easeHolds.map(label).join(', '))}: less weight or less effort today (your rule).</p>` : ''}
        <div class="btn-row">
          ${['train', 'lighter-area', 'lighter-all'].includes(rec.action) && routine ? `<a class="btn-primary center" id="rd-start" href="#/session/start/${esc(routine.id)}">Start ${esc(LABEL[rec.dayType])}${rec.action === 'train' ? '' : ' (lighter)'}</a>` : ''}
          ${rec.action === 'move' && !doneAction ? '<button class="btn-primary" id="rd-move" type="button">Move to tomorrow</button>' : ''}
          ${rec.action === 'rest-holds' && !doneAction ? '<button class="btn-primary" id="rd-rest" type="button">Rest and holds today</button>' : ''}
          ${rec.action === 'rest' || doneAction ? '<a class="btn-primary center" href="#/holds">Tendon holds</a>' : ''}
        </div>
        ${doneAction ? `<p class="hint c-green">Done: ${restNow.reason === 'moved' ? `${esc(LABEL[rec.dayType])} moved to ${esc(day(nextDay))}` : 'rest and holds today'}. ${esc(LABEL[rec.dayType] || '')} stays next.</p>` : ''}
        ${['move', 'rest-holds'].includes(rec.action) && !doneAction && routine ? `<a class="link-btn" href="#/session/start/${esc(routine.id)}">Train anyway</a>` : ''}
      </section>
      <p class="hint">Checked in ${esc(day(today))}. The rules are your table's; the app adds no advice.</p>
      <button class="link-btn" id="rd-again" type="button">Check in again</button>`;

    const move = view.querySelector('#rd-move');
    const rest = view.querySelector('#rd-rest');
    const apply = async (reason) => {
      const cur = (await repo.get('days', today)) || { date: today };
      await repo.put('days', today, withRest(cur, today, reason));
      // A session time set for today moves with the session.
      if (cur.sessionTime) {
        const to = rotationDay({ last: ctx.last, today, days: { ...ctx.days, [today]: withRest(cur, today, reason) } }).next.date;
        const target = (await repo.get('days', to)) || { date: to };
        if (!target.sessionTime) await repo.put('days', to, withTime(target, to, cur.sessionTime));
      }
      ctx.days = daysByDate(await repo.list('days'));
      drawResult(rec);
    };
    if (move) move.onclick = async () => { await apply('moved'); toast(`${LABEL[rec.dayType]} moved to tomorrow.`); };
    if (rest) rest.onclick = async () => {
      if (!(await confirmSheet(`Rest today and do your tendon holds with less weight or less effort. ${LABEL[rec.dayType]} stays next.`, { ok: 'Rest and holds' }))) return;
      await apply('rest-holds');
      location.hash = '#/holds';
    };
    view.querySelector('#rd-again').onclick = () => { again = true; draw(); };
  };

  ready.then(async (r) => { repo = r; await load(); draw(); });
  return () => {};
}

export function render(view, params = [], route = 'checkin') {
  if (route === 'readiness') { renderTable(view); return () => {}; }
  return renderCheckin(view);
}

/** Today's check-in record, for the Train card and the session builder. */
export const todaysReadiness = async (repo) => (await repo.get('days', isoDate(new Date())))?.readiness ?? null;

