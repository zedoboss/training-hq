// SESSION: start (#/session/start/<routineId|empty>) and log (#/session/<id>).
import { ready } from '../lib/data.js';
import { mergeLibrary } from '../lib/library.js';
import { buildHistory } from '../lib/history.js';
import { buildSession, setsForAdded, elapsedMs, clock, summarize, previousFor, fillForTick, newSetId, typicalDurationMs, expectedFinish } from '../lib/session.js';
import { newKey } from '../lib/routines.js';
import { SET_TYPES, setFields } from '../lib/exercise-types.js';
import { isoDate, formatTime } from '../lib/time.js';
import { kg as fmtKg, platesPerSide } from '../lib/loads.js';
import * as rest from '../lib/rest-timer.js';
import { pickExercises } from '../ui/picker.js';
import { actionSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = { pull: 'PULL', push: 'PUSH', legs: 'LEGS', neck: 'NECK' };
const CHECK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const rangeText = (r) => (!r ? '' : r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function context(repo, excludeSessionId) {
  const [sessions, sets, bridge, exercises] = await Promise.all([repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'), repo.list('exercises')]);
  const lib = new Map(mergeLibrary(exercises).map((e) => [e.id, e]));
  return { history: buildHistory({ sessions, sets, bridge, excludeSessionId }), lib, sessions, bridge };
}

async function startSession(view, routineId) {
  const repo = await ready;
  const active = (await repo.list('sessions')).find((s) => s.status === 'active');
  if (active) {
    const resume = await confirmSheet(`"${active.title}" is still in progress. Resume it? (Cancel discards nothing and goes back.)`, { ok: 'Resume' });
    location.replace(resume ? `#/session/${active.id}` : '#/train');
    return;
  }
  const routine = routineId === 'empty' ? null : await repo.get('routines', routineId);
  const [meta, progDocs, ctx] = await Promise.all([repo.get('programme', 'meta'), repo.list('programme'), context(repo, null)]);
  const { session, sets } = buildSession({
    routine, meta, programmeRoutines: progDocs.filter((d) => d.kind === 'routine'), lib: ctx.lib, history: ctx.history, today: isoDate(new Date()),
  });
  await repo.put('sessions', session.id, session);
  for (const s of sets) await repo.put('sets', s.id, s);
  location.replace(`#/session/${session.id}`);
}

export function render(view, params = []) {
  if (params[0] === 'start') { view.innerHTML = '<p class="view-sub">Starting…</p>'; startSession(view, params[1]); return () => {}; }
  const id = params[0];
  let repo; let session; let sets = []; let ctx; let timer; let wakeLock = null; let offRest = () => {}; let offRepo = () => {};
  let typicalMs = null;

  const exSets = (key) => sets.filter((s) => s.exKey === key).sort((a, b) => a.order - b.order);
  const saveSession = async (patch) => { session = { ...session, ...patch }; await repo.put('sessions', session.id, session); };
  const saveSet = async (set) => { sets = sets.map((s) => (s.id === set.id ? set : s)); if (!sets.some((s) => s.id === set.id)) sets.push(set); await repo.put('sets', set.id, set); };

  const header = () => {
    const sum = summarize(session, sets);
    const el = view.querySelector('#s-head');
    if (!el) return;
    const now = Date.now();
    const elapsedMin = Math.floor(elapsedMs(session, now) / 60000);
    const eta = expectedFinish({ session, sets, typicalMs, now });
    el.querySelector('[data-k="clock"]').textContent = clock(elapsedMs(session, now));
    el.querySelector('[data-k="vol"]').textContent = sum.volume.toLocaleString('en-US');
    el.querySelector('[data-k="sets"]').textContent = `${sum.done} / ${sum.total}`;
    el.querySelector('[data-k="paused"]').hidden = !session.pausedAt;
    el.querySelector('[data-k="started"]').textContent = `STARTED ${formatTime(new Date(session.startedAt))} · ${elapsedMin} MIN AGO`;
    el.querySelector('[data-k="eta"]').textContent = eta
      ? `FINISH ~${formatTime(new Date(eta.at))} · ${Math.max(0, Math.round(eta.leftMs / 60000))} MIN LEFT`
      : 'FINISH ~ · LOG A FEW SETS';
    el.querySelector('[data-k="eta"]').title = eta ? (eta.basis === 'pace' ? 'From your pace today' : eta.basis === 'history' ? 'From your recent sessions of this type' : 'Rough estimate: 2.5 minutes a set') : '';
  };

  const setRow = (ex, s, all) => {
    const fields = setFields(ex.type, s.type);
    const prev = previousFor(ctx.history.previous(ex.name), all, s);
    const label = s.type === 'normal' ? String(all.filter((x) => x.type !== 'warmup' && x.type !== 'hold' && x.order <= s.order).length) : SET_TYPES[s.type].short;
    const prevText = prev ? (fields.includes('durationS') && !fields.includes('reps') ? `${prev.kg != null ? `${fmtKg(prev.kg)} · ` : ''}${prev.durationS ?? 30}s` : `${prev.kg != null ? fmtKg(prev.kg) : 'BW'} × ${prev.reps ?? '–'}`) : '–';
    const second = fields.includes('reps') ? 'reps' : fields.includes('durationS') ? 'durationS' : fields.includes('distanceM') ? 'distanceM' : null;
    const placeholder = second === 'reps' ? rangeText(s.target?.reps) || (prev?.reps ?? '') : second === 'durationS' ? '30' : '';
    return `<div class="set-row ${s.done ? 'is-done' : ''} type-${s.type}" data-set="${esc(s.id)}">
      <button class="set-label" data-a="type" type="button" aria-label="Set ${esc(label)}: change type or delete">${esc(label)}</button>
      <button class="set-prev" data-a="prev" type="button" ${prev ? '' : 'disabled'} aria-label="Copy previous ${esc(prevText)}">${esc(prevText)}</button>
      ${fields.includes('kg') || fields.includes('distanceM') && !fields.includes('kg')
        ? `<input class="set-in" data-f="${fields.includes('kg') ? 'kg' : 'distanceM'}" inputmode="decimal" value="${esc(fields.includes('kg') ? s.kg ?? '' : s.distanceM ?? '')}" placeholder="${fields.includes('kg') ? (s.target?.kg ?? 'kg') : 'm'}" aria-label="${fields.includes('kg') ? 'kg' : 'metres'}">`
        : '<span></span>'}
      ${second ? `<input class="set-in" data-f="${second}" inputmode="numeric" value="${esc(s[second] ?? '')}" placeholder="${esc(placeholder)}" aria-label="${second === 'reps' ? 'reps' : 'seconds'}">` : '<span></span>'}
      <button class="set-tick" data-a="tick" type="button" aria-label="${s.done ? 'Mark not done' : 'Mark done'}">${s.done ? CHECK : ''}</button>
    </div>`;
  };

  const exCard = (ex, i) => {
    const all = exSets(ex.key);
    const lib = ctx.lib.get(ex.exerciseId) || {};
    const t = ex.target;
    const live = all.find((s) => !s.done && s.kg != null && s.type !== 'hold') || all.find((s) => s.kg != null && s.type !== 'hold');
    const per = ex.barKg && live?.kg != null ? platesPerSide(live.kg, ex.barKg) : null;
    const fields = setFields(ex.type, 'normal');
    const pinned = lib.pinnedNote?.text ?? lib.pinnedNote;
    return `<section class="card s-ex ${i === 0 ? '' : ''}" data-ex="${esc(ex.key)}">
      <div class="ex-head"><a class="ex-name plain" href="#/exercise/${esc(ex.exerciseId)}">${esc(ex.name)}</a>
        <span class="btn-row tight">${ex.capClass === 'main' ? '<span class="tag tag-main">30% CAP</span>' : ex.role === 'tendon-hold' ? '<span class="tag tag-hold">HOLD</span>' : ''}
        <button class="icon-mini" data-a="ex-more" type="button" aria-label="Exercise options">···</button></span></div>
      ${pinned ? `<div class="pinned small">${esc(pinned)}</div>` : ''}
      ${ex.notes ? `<div class="hint">${esc(ex.notes)}</div>` : ''}
      ${t && (t.kg != null || t.reps) ? `<div class="target">TARGET ${t.bodyweight ? 'BW' : t.added ? `+${fmtKg(t.kg)} KG` : t.kg != null ? `${t.approx ? '~' : ''}${fmtKg(t.kg)} KG` : ''}${t.reps ? ` · ${rangeText(t.reps)}` : ''}${t.sets ? ` · ${t.sets} SET${t.sets > 1 ? 'S' : ''}` : ''}${t.why ? ` <span class="c-muted">(${esc(t.why.toUpperCase())})</span>` : ''}${t.gated ? ' <span class="c-amber">· ONLY IF FORM IS CONSISTENT ON VIDEO</span>' : ''}</div>` : ''}
      <div class="set-row set-headrow"><span>SET</span><span>PREVIOUS</span><span>${fields.includes('kg') ? 'KG' : fields.includes('distanceM') ? 'M' : ''}</span><span>${fields.includes('reps') ? 'REPS' : fields.includes('durationS') ? 'SEC' : ''}</span><span></span></div>
      ${all.map((s) => setRow(ex, s, all)).join('')}
      <div class="s-ex-foot"><span class="hud c-muted">${per != null ? `${fmtKg(ex.barKg)} BAR + ${fmtKg(per)} KG / SIDE` : ''}</span>
        <button class="btn-ghost small" data-a="add-set" type="button">+ Set</button></div>
    </section>`;
  };

  const drawCards = () => {
    const box = view.querySelector('#s-ex');
    box.innerHTML = session.exercises.map(exCard).join('') || '<p class="hint">No exercises yet. Add some below.</p>';
    header();
  };

  const redrawCard = (key) => {
    const old = view.querySelector(`[data-ex="${CSS.escape(key)}"]`);
    const ex = session.exercises.find((e) => e.key === key);
    if (!old || !ex) { drawCards(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = exCard(ex, session.exercises.indexOf(ex));
    old.replaceWith(tmp.firstElementChild);
    header();
  };

  const onSetAction = async (setId, action) => {
    const s = sets.find((x) => x.id === setId);
    const ex = session.exercises.find((e) => e.key === s.exKey);
    if (action === 'tick') {
      rest.unlockAudio();
      if (s.done) { await saveSet({ ...s, done: false, doneAt: null }); redrawCard(ex.key); return; }
      const prev = previousFor(ctx.history.previous(ex.name), exSets(ex.key), s);
      const filled = { ...s, ...fillForTick(s, prev), done: true, doneAt: Date.now() };
      await saveSet(filled);
      redrawCard(ex.key);
      const next = exSets(ex.key).find((x) => !x.done);
      if (!(s.type === 'normal' && next?.type === 'dropset')) rest.start(s.type === 'hold' ? 120 : ex.restSeconds ?? 120, ex.name);
    } else if (action === 'prev') {
      const prev = previousFor(ctx.history.previous(ex.name), exSets(ex.key), s);
      if (!prev) return;
      await saveSet({ ...s, kg: prev.kg ?? s.kg, reps: prev.reps ?? s.reps, durationS: prev.durationS ?? s.durationS });
      redrawCard(ex.key);
    } else if (action === 'type') {
      actionSheet('Set type', [
        ...Object.entries(SET_TYPES).map(([k, t]) => ({ label: `${t.short || 'N'} · ${t.label}${s.type === k ? ' (now)' : ''}`, run: async () => { await saveSet({ ...s, type: k, ...(k === 'hold' && s.durationS == null ? { durationS: 30 } : {}) }); redrawCard(ex.key); } })),
        { label: 'Delete set', danger: true, run: async () => { await repo.remove('sets', s.id); sets = sets.filter((x) => x.id !== s.id); redrawCard(ex.key); } },
      ]);
    }
  };

  const onExAction = async (key, action) => {
    const ex = session.exercises.find((e) => e.key === key);
    if (action === 'add-set') {
      const all = exSets(key);
      const last = all.filter((x) => x.type !== 'warmup').pop() || all[all.length - 1];
      const order = all.length ? Math.max(...all.map((x) => x.order)) + 0.01 : sets.length;
      await saveSet({ id: newSetId(), sessionId: session.id, exKey: key, order, done: false, doneAt: null, rpe: null, note: '', type: last?.type === 'warmup' ? 'normal' : last?.type ?? 'normal', kg: last?.kg ?? null, reps: null, durationS: last?.durationS ?? null, target: last?.target ?? null });
      redrawCard(key);
    } else if (action === 'ex-more') {
      const idx = session.exercises.indexOf(ex);
      const move = async (d) => { const list = [...session.exercises]; const j = idx + d; if (j < 0 || j >= list.length) return; [list[idx], list[j]] = [list[j], list[idx]]; await saveSession({ exercises: list }); drawCards(); };
      actionSheet(ex.name, [
        { label: 'Move up', run: () => move(-1) },
        { label: 'Move down', run: () => move(1) },
        { label: 'Replace', run: async () => {
          const [n] = await pickExercises({ multi: false, title: 'Replace with' });
          if (!n) return;
          await saveSession({ exercises: session.exercises.map((e) => (e.key === key ? { ...e, exerciseId: n.id, name: n.name, type: n.type, capClass: n.capClass ?? null, barKg: n.barKg ?? null, target: null } : e)) });
          drawCards();
        } },
        { label: 'Remove', danger: true, run: async () => {
          if (exSets(key).some((s) => s.done) && !(await confirmSheet(`Remove ${ex.name} and its logged sets?`, { ok: 'Remove', danger: true }))) return;
          for (const s of exSets(key)) await repo.remove('sets', s.id);
          sets = sets.filter((s) => s.exKey !== key);
          await saveSession({ exercises: session.exercises.filter((e) => e.key !== key) });
          drawCards();
        } },
      ]);
    }
  };

  const draw = () => {
    view.innerHTML = `
      <header class="s-head" id="s-head">
        <div class="s-row1">
          <div class="hud c-amber s-title">${esc(DAY[session.dayType] || session.title.toUpperCase())}${session.week ? ` · WK ${session.week}` : ''} <span data-k="paused" hidden>· PAUSED</span></div>
          <button class="pill" id="s-more" type="button" aria-label="Session options">···</button>
          <a class="pill is-on" href="#/finish/${esc(session.id)}">Finish</a>
        </div>
        <div class="s-row2">
          <div class="s-clock" data-k="clock">0:00:00</div>
          <div class="hud s-times"><span class="c-text" data-k="started"></span><br><span class="c-cyan" data-k="eta"></span></div>
        </div>
        <div class="hud c-muted s-stats">VOL <span class="c-text" data-k="vol">0</span> KG · SETS <span class="c-text" data-k="sets">0 / 0</span></div>
      </header>
      <div id="s-ex" class="s-ex-list"></div>
      <div class="btn-row three"><button class="btn-ghost" id="s-add" type="button">+ Exercise</button></div>
      <section class="rest-bar" id="rest" hidden aria-label="Rest timer">
        <div class="rest-track"><div class="rest-fill" data-k="fill"></div></div>
        <div class="rest-row"><div class="rest-time"><span class="hud c-muted" data-k="rlabel">REST</span><b data-k="rleft">0:00</b></div>
          <button class="btn-ghost small" data-r="-15" type="button">-15</button><button class="btn-ghost small" data-r="15" type="button">+15</button>
          <button class="btn-primary small" data-r="skip" type="button">Skip</button></div>
      </section>`;
    drawCards();

    const box = view.querySelector('#s-ex');
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const row = a.closest('[data-set]');
      if (row) onSetAction(row.dataset.set, a.dataset.a);
      else onExAction(a.closest('[data-ex]').dataset.ex, a.dataset.a);
    });
    box.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-f]');
      if (!input) return;
      const s = sets.find((x) => x.id === input.closest('[data-set]').dataset.set);
      await saveSet({ ...s, [input.dataset.f]: num(input.value) });
      header();
      view.dispatchEvent(new CustomEvent('set-changed', { detail: { setId: s.id, field: input.dataset.f } }));
    });
    view.querySelector('#s-add').onclick = async () => {
      const picked = await pickExercises({ multi: true });
      if (!picked.length) return;
      const list = [...session.exercises];
      let order = sets.length ? Math.max(...sets.map((s) => s.order)) + 1 : 0;
      for (const n of picked) {
        const entry = { key: newKey(), exerciseId: n.id, name: n.name, type: n.type || 'weight_reps', capClass: n.capClass ?? null, barKg: n.barKg ?? null, restSeconds: n.restSeconds ?? null, notes: '', role: null, target: null };
        list.push(entry);
        const last = ctx.history.last(n.name);
        for (const s of setsForAdded(session.id, entry, last?.heaviest, order)) { await saveSet(s); order++; }
      }
      await saveSession({ exercises: list });
      drawCards();
    };
    view.querySelector('#s-more').onclick = () => actionSheet(session.title, [
      session.pausedAt
        ? { label: 'Resume clock', run: async () => { await saveSession({ pausedMs: session.pausedMs + (Date.now() - session.pausedAt), pausedAt: null }); header(); } }
        : { label: 'Pause clock', run: async () => { await saveSession({ pausedAt: Date.now() }); header(); } },
      { label: 'Discard session', danger: true, run: async () => {
        if (!(await confirmSheet('Discard this session? Sets logged in it are deleted.', { ok: 'Discard', danger: true }))) return;
        for (const s of sets) await repo.remove('sets', s.id);
        await saveSession({ status: 'discarded', endedAt: Date.now() });
        rest.clear();
        location.hash = '#/train';
      } },
    ]);
    view.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.r === 'skip') rest.clear(); else rest.adjust(Number(b.dataset.r));
    }));
  };

  const drawRest = (st) => {
    const bar = view.querySelector('#rest');
    if (!bar) return;
    bar.hidden = !st;
    if (!st) return;
    bar.querySelector('[data-k="rleft"]').textContent = mmss(st.leftMs);
    bar.querySelector('[data-k="rlabel"]').textContent = `REST · ${st.label.toUpperCase().slice(0, 24)}`;
    bar.querySelector('[data-k="fill"]').style.width = `${Math.min(100, st.fraction * 100)}%`;
  };

  const keepAwake = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') { keepAwake(); header(); } };

  ready.then(async (r) => {
    repo = r;
    session = await repo.get('sessions', id);
    if (!session) { view.innerHTML = '<h1 class="view-title">Session not found</h1><p class="hint"><a href="#/train">Back to Train</a></p>'; return; }
    if (session.status !== 'active') { location.replace(`#/finish/${id}`); return; }
    sets = (await repo.list('sets')).filter((s) => s.sessionId === id);
    ctx = await context(repo, id);
    typicalMs = typicalDurationMs(session.dayType, { sessions: ctx.sessions, bridge: ctx.bridge, now: session.startedAt });
    draw();
    drawRest(rest.status());
    offRest = rest.subscribe(drawRest);
    timer = setInterval(header, 1000);
    keepAwake();
    document.addEventListener('visibilitychange', onVis);
    offRepo = repo.onChange(async (cols, origin) => {
      if (origin !== 'remote' || (!cols.includes('sets') && !cols.includes('sessions'))) return;
      if (view.contains(document.activeElement) && document.activeElement.matches('input')) return;
      session = (await repo.get('sessions', id)) || session;
      sets = (await repo.list('sets')).filter((s) => s.sessionId === id);
      if (session.status !== 'active') { location.replace(`#/finish/${id}`); return; }
      drawCards();
    });
  });

  return () => {
    clearInterval(timer); offRest(); offRepo();
    document.removeEventListener('visibilitychange', onVis);
    wakeLock?.release?.().catch(() => {});
  };
}

export { toast };
