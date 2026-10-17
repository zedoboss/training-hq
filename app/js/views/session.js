// SESSION: start (#/session/start/<routineId|empty>) and log (#/session/<id>).
import { ready } from '../lib/data.js';
import { mergeLibrary } from '../lib/library.js';
import { buildHistory } from '../lib/history.js';
import { buildSession, setsForAdded, elapsedMs, clock, summarize, previousFor, fillForTick, newSetId, typicalDurationMs, expectedFinish, supersetGroups, restAfter, RPE, setTimerView, setTimerResult } from '../lib/session.js';
import { newKey } from '../lib/routines.js';
import { SET_TYPES, setFields } from '../lib/exercise-types.js';
import { isoDate, formatTime, formatDay } from '../lib/time.js';
import { kg as fmtKg, platesPerSide } from '../lib/loads.js';
import * as rest from '../lib/rest-timer.js';
import { pickExercises } from '../ui/picker.js';
import { platesSheet, guardSheet } from '../ui/load-sheets.js';
import { guardCheck } from '../lib/targets.js';
import { warmupSets } from '../lib/plates.js';
import { setRecord } from '../lib/finish.js';
import { actionSheet, confirmSheet, promptText, overlay } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { getState } from '../lib/store.js';
import { withDefaults, equipmentWithDefaults, smallestPlate, restFor, restDefault, weightUnitFor, toUnit, fromUnit, toDistance, fromDistance, REST_CHOICES, restText } from '../lib/settings.js';
import { play } from '../lib/sounds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = { pull: 'PULL', push: 'PUSH', legs: 'LEGS', neck: 'NECK' };
const CHECK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const rangeText = (r) => (!r ? '' : r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);
const SS_COLORS = ['var(--pull)', 'var(--legs)', 'var(--push)', 'var(--cyan)'];
const prefs = () => withDefaults(getState().settings);

// Timer for a time-based set (P24): one at a time, stored so it survives a reload.
const ST_KEY = 'thq.setTimer';
const loadSetTimer = () => { try { return JSON.parse(localStorage.getItem(ST_KEY) || 'null'); } catch { return null; } };
const storeSetTimer = (v) => { try { if (v) localStorage.setItem(ST_KEY, JSON.stringify(v)); else localStorage.removeItem(ST_KEY); } catch { /* private mode */ } };

// Stopwatch from the session menu: lives while the app is open.
const stopwatch = { startedAt: null, accMs: 0 };
const swMs = () => stopwatch.accMs + (stopwatch.startedAt ? Date.now() - stopwatch.startedAt : 0);

function stopwatchSheet() {
  const { el, close } = overlay(`
    <div class="hud c-muted sheet-title">STOPWATCH</div>
    <div class="sw-time" data-k="t">0:00.0</div>
    <div class="btn-row"><button class="btn-primary" data-sw="go" type="button">Start</button><button class="btn-ghost" data-sw="reset" type="button">Reset</button></div>
    <button class="sheet-btn sheet-cancel" type="button" data-cancel>Close</button>`, () => clearInterval(t));
  const draw = () => {
    const ms = swMs();
    el.querySelector('[data-k="t"]').textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${Math.floor(ms / 100) % 10}`;
    el.querySelector('[data-sw="go"]').textContent = stopwatch.startedAt ? 'Stop' : swMs() ? 'Resume' : 'Start';
  };
  const t = setInterval(draw, 100);
  el.querySelector('[data-sw="go"]').addEventListener('click', () => {
    if (stopwatch.startedAt) { stopwatch.accMs = swMs(); stopwatch.startedAt = null; } else stopwatch.startedAt = Date.now();
    draw();
  });
  el.querySelector('[data-sw="reset"]').addEventListener('click', () => { stopwatch.startedAt = stopwatch.startedAt ? Date.now() : null; stopwatch.accMs = 0; draw(); });
  el.querySelector('[data-cancel]').addEventListener('click', () => close());
  draw();
}
const minPlate = () => smallestPlate(getState().equipment);
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function context(repo, excludeSessionId) {
  const [sessions, sets, bridge, exercises] = await Promise.all([repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'), repo.list('exercises')]);
  const lib = new Map(mergeLibrary(exercises, getState().equipment).map((e) => [e.id, e]));
  return { history: buildHistory({ sessions, sets, bridge, excludeSessionId }), lib, sessions, bridge };
}

async function startSession(view, routineId) {
  const repo = await ready;
  const active = (await repo.list('sessions')).find((s) => s.status === 'active' && s.kind !== 'holds');
  if (active) {
    const resume = await confirmSheet(`"${active.title}" is still in progress. Resume it? (Cancel discards nothing and goes back.)`, { ok: 'Resume' });
    location.replace(resume ? `#/session/${active.id}` : '#/train');
    return;
  }
  const routine = routineId === 'empty' ? null : await repo.get('routines', routineId);
  const [meta, progDocs, ctx] = await Promise.all([repo.get('programme', 'meta'), repo.list('programme'), context(repo, null)]);
  const { session, sets } = buildSession({
    routine, meta, programmeRoutines: progDocs.filter((d) => d.kind === 'routine'), lib: ctx.lib, history: ctx.history, today: isoDate(new Date()),
    smallestPlate: minPlate(), gym: prefs().gym.name, warmupSteps: prefs().warmup.steps, sameRoutine: prefs().previousFrom === 'same-routine',
  });
  // Sets first: if the app is closed half-way, no session exists without its sets.
  for (const s of sets) await repo.put('sets', s.id, s);
  await repo.put('sessions', session.id, session);
  location.replace(`#/session/${session.id}`);
}

export function render(view, params = []) {
  if (params[0] === 'start') { view.innerHTML = '<p class="view-sub">Starting…</p>'; startSession(view, params[1]); return () => {}; }
  const id = params[0];
  const editing = params[1] === 'edit';
  let repo; let session; let sets = []; let ctx; let timer; let wakeLock = null; let offRest = () => {}; let offRepo = () => {};
  let typicalMs = null;
  let setTimer = loadSetTimer();
  let setTimerTick = null;

  const exSets = (key) => sets.filter((s) => s.exKey === key).sort((a, b) => a.order - b.order);
  const saveSession = async (patch) => { session = { ...session, ...patch }; await repo.put('sessions', session.id, session); };
  const saveSet = async (set) => { sets = sets.map((s) => (s.id === set.id ? set : s)); if (!sets.some((s) => s.id === set.id)) sets.push(set); await repo.put('sets', set.id, set); };

  /** Previous values for an exercise: any session, or the same routine (Settings). */
  const prevOf = (ex) => ctx.history.previous(ex.name, prefs().previousFrom === 'same-routine' ? { routineId: session.routineId, dayType: session.dayType } : null);
  const unitOf = (ex) => weightUnitFor(ctx.lib.get(ex.exerciseId), prefs());
  const distUnit = () => prefs().units.distance;
  /** A load in the exercise's unit, for the screen. Stored loads are always kg. */
  const showKg = (ex, v) => (v == null ? '' : fmtKg(toUnit(v, unitOf(ex))));

  /** The 30% guard: main lifts only; returns the load to use (the suggestion or the entered one). */
  const checkGuard = async (ex, kg) => {
    if (!ex || kg == null || ex.capClass !== 'main') return kg;
    const g = guardCheck({ kg, capClass: ex.capClass, history: ctx.history.guardHistory(ex.name), today: isoDate(new Date()), barKg: ex.barKg, smallestPlate: minPlate() });
    return g ? guardSheet({ name: ex.name, entered: kg, guard: g }) : kg;
  };

  const header = () => {
    const sum = summarize(session, sets);
    const el = view.querySelector('#s-head');
    if (!el) return;
    if (editing) {
      el.querySelector('[data-k="clock"]').textContent = formatDay(new Date(session.startedAt));
      el.querySelector('[data-k="vol"]').textContent = sum.volume.toLocaleString('en-US');
      el.querySelector('[data-k="sets"]').textContent = `${sum.done} / ${sum.total}`;
      el.querySelector('[data-k="started"]').textContent = `EDITING A SAVED SESSION`;
      el.querySelector('[data-k="eta"]').textContent = `${formatTime(new Date(session.startedAt))} - ${formatTime(new Date(session.endedAt))}`;
      return;
    }
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

  /** Banner at the top for a few seconds when a ticked set beats the comeback best (P27). */
  const recordBanner = (ex, rec) => {
    document.querySelector('.record-banner')?.remove();
    const el = document.createElement('div');
    el.className = 'record-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="hud c-amber">NEW COMEBACK BEST</span><b>${esc(ex.name)}</b>
      <span class="hud">${showKg(ex, rec.kg)} ${unitOf(ex).toUpperCase()} × ${rec.reps ?? '–'}${rec.previous ? ` · BEFORE ${showKg(ex, rec.previous)}` : ''}</span>`;
    document.body.append(el);
    setTimeout(() => el.classList.add('is-on'), 20);
    setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => el.remove(), 400); }, 4000);
  };

  const timerLine = (s, prev) => {
    if (setTimer?.setId === s.id) {
      const v = setTimerView(setTimer);
      return `<div class="set-timer"><button class="btn-primary small" data-a="timer-stop" type="button">Stop</button><span class="hud ${v.reached ? 'c-green' : 'c-cyan'}" data-timer>${v.text}</span></div>`;
    }
    const target = s.durationS ?? prev?.durationS ?? 30;
    return `<div class="set-timer"><button class="btn-ghost small" data-a="timer-start" type="button">Start ${target} s</button></div>`;
  };

  /** Live update of the running set timer; beeps once when the target is reached. */
  const runSetTimer = () => {
    clearInterval(setTimerTick);
    if (!setTimer) return;
    setTimerTick = setInterval(() => {
      if (!setTimer) { clearInterval(setTimerTick); return; }
      const v = setTimerView(setTimer);
      if (v.reached && !setTimer.cued) { setTimer = { ...setTimer, cued: true }; storeSetTimer(setTimer); rest.beep(3); }
      const el = view.querySelector(`[data-set="${CSS.escape(setTimer.setId)}"] [data-timer]`);
      if (el) { el.textContent = v.text; el.classList.toggle('c-green', v.reached); el.classList.toggle('c-cyan', !v.reached); }
    }, 250);
  };

  const setRow = (ex, s, all) => {
    const fields = setFields(ex.type, s.type);
    const prev = previousFor(prevOf(ex), all, s);
    const label = s.type === 'normal' ? String(all.filter((x) => x.type !== 'warmup' && x.type !== 'hold' && x.order <= s.order).length) : SET_TYPES[s.type].short;
    const prevText = prev ? (fields.includes('durationS') && !fields.includes('reps') ? `${prev.kg != null ? `${showKg(ex, prev.kg)} · ` : ''}${prev.durationS ?? 30}s` : `${prev.kg != null ? showKg(ex, prev.kg) : 'BW'} × ${prev.reps ?? '–'}${prev.rpe ? ` @${prev.rpe}` : ''}`) : '–';
    const second = fields.includes('reps') ? 'reps' : fields.includes('durationS') ? 'durationS' : fields.includes('distanceM') ? 'distanceM' : null;
    const placeholder = second === 'reps' ? rangeText(s.target?.reps) || (prev?.reps ?? '') : second === 'durationS' ? '30' : '';
    return `<div class="set-row ${s.done ? 'is-done' : ''} type-${s.type}" data-set="${esc(s.id)}">
      <button class="set-label" data-a="type" type="button" aria-label="Set ${esc(label)}: change type or delete">${esc(label)}</button>
      <button class="set-prev" data-a="prev" type="button" ${prev ? '' : 'disabled'} aria-label="Copy previous ${esc(prevText)}">${esc(prevText)}</button>
      ${fields.includes('kg') || fields.includes('distanceM') && !fields.includes('kg')
        ? `<input class="set-in" data-f="${fields.includes('kg') ? 'kg' : 'distanceM'}" inputmode="decimal" value="${esc(fields.includes('kg') ? showKg(ex, s.kg) : s.distanceM != null ? toDistance(s.distanceM, distUnit()) : '')}" placeholder="${fields.includes('kg') ? (s.target?.kg != null ? showKg(ex, s.target.kg) : unitOf(ex)) : distUnit()}" aria-label="${fields.includes('kg') ? unitOf(ex) : distUnit()}">`
        : '<span></span>'}
      ${second ? `<input class="set-in" data-f="${second}" inputmode="numeric" value="${esc(s[second] ?? '')}" placeholder="${esc(placeholder)}" aria-label="${second === 'reps' ? 'reps' : 'seconds'}">` : '<span></span>'}
      <button class="set-tick" data-a="tick" type="button" aria-label="${s.done ? 'Mark not done' : 'Mark done'}">${s.done ? CHECK : ''}</button>
      ${fields.includes('durationS') && !s.done && !editing && prefs().show.inlineTimer ? timerLine(s, prev) : ''}
      ${s.rpe || s.note ? `<div class="set-meta">${s.rpe ? `RPE ${s.rpe}` : ''}${s.rpe && s.note ? ' · ' : ''}${s.note ? esc(s.note) : ''}</div>` : ''}
    </div>`;
  };

  const exCard = (ex, i) => {
    const all = exSets(ex.key);
    const lib = ctx.lib.get(ex.exerciseId) || {};
    const t = ex.target;
    const live = all.find((s) => !s.done && s.kg != null && s.type !== 'hold') || all.find((s) => s.kg != null && s.type !== 'hold');
    const plateCalc = prefs().show.plateCalc;
    const per = plateCalc && ex.barKg && live?.kg != null ? platesPerSide(live.kg, ex.barKg) : null;
    const unit = unitOf(ex).toUpperCase();
    // Column headings: an exercise done only as holds shows seconds, not reps.
    const fields = setFields(ex.type, all.length && all.every((x) => x.type === 'hold') ? 'hold' : 'normal');
    const pinned = lib.pinnedNote?.text ?? lib.pinnedNote;
    const groups = supersetGroups(session.exercises);
    const g = ex.supersetId ? groups.get(ex.supersetId) : null;
    const gi = g ? [...groups.keys()].indexOf(ex.supersetId) : -1;
    return `<section class="card s-ex ${g ? 'in-superset' : ''}" data-ex="${esc(ex.key)}" ${g ? `style="--ss:${SS_COLORS[gi % SS_COLORS.length]}"` : ''}>
      ${g ? `<div class="hud ss-label">SUPERSET ${g.letter} · ${g.keys.indexOf(ex.key) + 1} OF ${g.keys.length}</div>` : ''}
      <div class="ex-head"><a class="ex-name plain" href="#/exercise/${esc(ex.exerciseId)}">${esc(ex.name)}</a>
        <span class="btn-row tight">${ex.capClass === 'main' ? '<span class="tag tag-main">30% CAP</span>' : ex.role === 'tendon-hold' ? '<span class="tag tag-hold">HOLD</span>' : ''}
        <button class="icon-mini" data-a="ex-more" type="button" aria-label="Exercise options">···</button></span></div>
      ${pinned ? `<div class="pinned small">${esc(pinned)}</div>` : ''}
      ${ex.notes ? `<div class="hint">${esc(ex.notes)}</div>` : ''}
      ${t && (t.kg != null || t.reps) ? `<div class="target">TARGET ${t.bodyweight ? 'BW' : t.added ? `+${showKg(ex, t.kg)} ${unit}` : t.kg != null ? `${t.approx ? '~' : ''}${showKg(ex, t.kg)} ${unit}` : ''}${t.reps ? ` · ${rangeText(t.reps)}` : ''}${t.sets ? ` · ${t.sets} SET${t.sets > 1 ? 'S' : ''}` : ''}${t.why ? ` <span class="c-muted">(${esc(t.why.toUpperCase())}${unit !== 'KG' && /\d/.test(t.why) ? ', IN KG' : ''})</span>` : ''}${t.gated ? ' <span class="c-amber">· ONLY IF FORM IS CONSISTENT ON VIDEO</span>' : ''}</div>` : ''}
      <div class="set-row set-headrow"><span>SET</span><span>PREVIOUS</span><span>${fields.includes('kg') ? unit : fields.includes('distanceM') ? distUnit().toUpperCase() : ''}</span><span>${fields.includes('reps') ? 'REPS' : fields.includes('durationS') ? 'SEC' : ''}</span><span></span></div>
      ${all.map((s) => setRow(ex, s, all)).join('')}
      <div class="s-ex-foot"><span class="hud c-muted">${per != null ? `${fmtKg(ex.barKg)} BAR + ${fmtKg(per)} KG / SIDE` : ''}</span>
        <span class="btn-row tight">${fields.includes('kg') && plateCalc ? '<button class="btn-ghost small" data-a="plates" type="button">Plates</button>' : ''}
        <button class="btn-ghost small" data-a="add-set" type="button">+ Set</button></span></div>
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
    if (action === 'timer-start') {
      rest.unlockAudio();
      rest.clear();
      const prev = previousFor(prevOf(ex), exSets(ex.key), s);
      setTimer = { setId: s.id, startedAt: Date.now(), targetS: s.durationS ?? prev?.durationS ?? 30, cued: false };
      storeSetTimer(setTimer);
      redrawCard(ex.key);
      runSetTimer();
      return;
    }
    if (action === 'timer-stop' || (action === 'tick' && setTimer?.setId === s.id)) {
      const secs = setTimerResult(setTimer);
      setTimer = null; storeSetTimer(null); clearInterval(setTimerTick);
      await saveSet({ ...s, durationS: secs });
      if (!s.done) await onSetAction(setId, 'tick');
      return;
    }
    if (action === 'tick') {
      rest.unlockAudio();
      if (s.done) { await saveSet({ ...s, done: false, doneAt: null }); redrawCard(ex.key); return; }
      const prev = previousFor(prevOf(ex), exSets(ex.key), s);
      const filled = { ...s, ...fillForTick(s, prev), done: true, doneAt: Date.now() };
      const rec = !editing && prefs().show.recordBanner ? setRecord({ set: filled, name: ex.name, sessionId: session.id, otherSets: exSets(ex.key), history: ctx.history }) : null;
      if (rec) play('record', prefs().sounds.recordVolume); else play('tick', prefs().sounds.tickVolume);
      await saveSet(filled);
      redrawCard(ex.key);
      if (rec) recordBanner(ex, rec);
      const next = exSets(ex.key).find((x) => !x.done);
      if (!editing && !(s.type === 'normal' && next?.type === 'dropset') && restAfter(session.exercises, ex.key)) rest.start(restFor(ex, s.type, prefs()), ex.name);
      if (!editing && prefs().show.supersetJump && ex.supersetId && !restAfter(session.exercises, ex.key)) {
        const keys = session.exercises.filter((e) => e.supersetId === ex.supersetId).map((e) => e.key);
        view.querySelector(`[data-ex="${CSS.escape(keys[keys.indexOf(ex.key) + 1])}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (action === 'prev') {
      const prev = previousFor(prevOf(ex), exSets(ex.key), s);
      if (!prev) return;
      await saveSet({ ...s, kg: prev.kg ?? s.kg, reps: prev.reps ?? s.reps, durationS: prev.durationS ?? s.durationS });
      redrawCard(ex.key);
    } else if (action === 'type') {
      actionSheet('Set type', [
        ...Object.entries(SET_TYPES).map(([k, t]) => ({ label: `${t.short || 'N'} · ${t.label}${s.type === k ? ' (now)' : ''}`, run: async () => { await saveSet({ ...s, type: k, ...(k === 'hold' && s.durationS == null ? { durationS: 30 } : {}) }); redrawCard(ex.key); } })),
        ...(prefs().show.rpe || s.rpe ? [{ label: `RPE${s.rpe ? ` (now ${s.rpe})` : ''}`, run: () => actionSheet('RPE: how many more reps could you have done?', [
          ...RPE.map(([v, hint]) => ({ label: `${v} · ${hint}`, run: async () => { await saveSet({ ...s, rpe: v }); redrawCard(ex.key); } })),
          { label: 'Clear RPE', run: async () => { await saveSet({ ...s, rpe: null }); redrawCard(ex.key); } },
        ]) }] : []),
        { label: s.note ? 'Edit set note' : 'Add set note', run: async () => { const t = await promptText('Set note', s.note || ''); if (t != null) { await saveSet({ ...s, note: t }); redrawCard(ex.key); } } },
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
    } else if (action === 'plates') {
      const all = exSets(key);
      const cur = all.find((s) => !s.done && s.type !== 'hold' && s.type !== 'warmup') || all.find((s) => !s.done) || all[all.length - 1];
      const res = await platesSheet({ name: ex.name, kg: cur?.kg ?? ex.target?.kg ?? null, barKg: ex.barKg, plates: equipmentWithDefaults(getState().equipment).plates });
      if (!res) return;
      const ok = await checkGuard(ex, res.kg);
      const targets = res.all ? all.filter((s) => !s.done && s.type !== 'hold' && s.type !== 'warmup') : [cur].filter(Boolean);
      for (const s of targets) await saveSet({ ...s, kg: ok });
      redrawCard(key);
    } else if (action === 'ex-more') {
      const idx = session.exercises.indexOf(ex);
      const move = async (d) => { const list = [...session.exercises]; const j = idx + d; if (j < 0 || j >= list.length) return; [list[idx], list[j]] = [list[j], list[idx]]; await saveSession({ exercises: list }); drawCards(); };
      const others = session.exercises.filter((e) => e.key !== key);
      const lib = ctx.lib.get(ex.exerciseId) || {};
      actionSheet(ex.name, [
        { label: lib.pinnedNote ? 'Edit pinned note' : 'Pin a note (shows every time)', run: async () => {
          const t = await promptText('Pinned note for this exercise', lib.pinnedNote?.text ?? lib.pinnedNote ?? '');
          if (t == null) return;
          const rec = (await repo.get('exercises', ex.exerciseId)) || { id: ex.exerciseId, name: ex.name, type: ex.type };
          await repo.put('exercises', ex.exerciseId, { ...rec, pinnedNote: { text: t, from: `Training HQ, ${formatDay(new Date())}` } });
          ctx.lib.set(ex.exerciseId, { ...lib, pinnedNote: { text: t } });
          redrawCard(key);
        } },
        { label: ex.notes ? 'Edit note for this session' : 'Note for this session', run: async () => {
          const t = await promptText('Note for this exercise today', ex.notes || '');
          if (t == null) return;
          await saveSession({ exercises: session.exercises.map((e) => (e.key === key ? { ...e, notes: t } : e)) });
          redrawCard(key);
        } },
        { label: `Rest time (${ex.restSeconds == null ? `default ${restText(restDefault(ex, prefs()))}` : restText(ex.restSeconds)})`, run: () => actionSheet('Rest time', [null, ...REST_CHOICES].map((x) => ({
          label: x == null ? `Default (${restText(restDefault(ex, prefs()))})` : restText(x),
          run: async () => { await saveSession({ exercises: session.exercises.map((e) => (e.key === key ? { ...e, restSeconds: x } : e)) }); },
        }))) },
        ...(setFields(ex.type, 'normal').includes('kg') ? [{ label: `Show in ${unitOf(ex) === 'kg' ? 'lb' : 'kg'}`, run: async () => {
          const unit = unitOf(ex) === 'kg' ? 'lb' : 'kg';
          const rec = (await repo.get('exercises', ex.exerciseId)) || { id: ex.exerciseId, name: ex.name, type: ex.type };
          const keep = unit === prefs().units.weight ? null : unit;
          await repo.put('exercises', ex.exerciseId, { ...rec, unit: keep });
          ctx.lib.set(ex.exerciseId, { ...(ctx.lib.get(ex.exerciseId) || {}), unit: keep });
          toast(`${ex.name} now shows ${unit}. Stored in kg as always.`);
          redrawCard(key);
        } }] : []),
        ...(ex.supersetId
          ? [{ label: 'Remove from superset', run: async () => { await saveSession({ exercises: session.exercises.map((e) => (e.key === key ? { ...e, supersetId: null } : e)) }); drawCards(); } }]
          : others.length ? [{ label: 'Superset with…', run: () => actionSheet('Superset with', others.map((o) => ({ label: o.name, run: async () => {
            const sid = o.supersetId || `ss-${Date.now().toString(36)}`;
            await saveSession({ exercises: session.exercises.map((e) => (e.key === key || e.key === o.key ? { ...e, supersetId: sid } : e)) });
            drawCards();
          } }))) }] : []),
        { label: 'Add warm-up sets', run: async () => {
          const all = exSets(key);
          const work = all.find((s) => s.type !== 'warmup' && s.type !== 'hold' && s.kg != null);
          const ws = warmupSets(work?.kg ?? ex.target?.kg, { barKg: ex.barKg, steps: prefs().warmup.steps, smallestPlate: minPlate() });
          if (!ws.length) { toast('Enter a working weight first.'); return; }
          const first = all.length ? Math.min(...all.map((s) => s.order)) : 0;
          for (const [i, w] of ws.entries()) {
            await saveSet({ id: newSetId(), sessionId: session.id, exKey: key, order: first - (ws.length - i) * 0.01, done: false, doneAt: null, rpe: null, note: '', ...w, reps: null, target: { kg: w.kg, reps: [w.reps, w.reps] } });
          }
          redrawCard(key);
        } },
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
          <a class="pill is-on" href="#/finish/${esc(session.id)}">${editing ? 'Done' : 'Finish'}</a>
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
      const ex = session.exercises.find((x) => x.key === s.exKey);
      let value = num(input.value);
      if (input.dataset.f === 'kg') value = fromUnit(value, unitOf(ex));
      if (input.dataset.f === 'distanceM') value = fromDistance(value, distUnit());
      if (input.dataset.f === 'kg' && s.type !== 'warmup' && s.type !== 'hold') {
        value = await checkGuard(ex, value);
        input.value = showKg(ex, value);
      }
      await saveSet({ ...s, [input.dataset.f]: value });
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
      { label: 'Countdown timer', run: () => actionSheet('Countdown', [30, 60, 90, 120, 180, 300].map((x) => ({ label: restText(x), run: () => { rest.unlockAudio(); rest.start(x, 'Countdown'); } }))) },
      { label: 'Stopwatch', run: () => { rest.unlockAudio(); stopwatchSheet(); } },
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
    bar.querySelector('[data-k="rlabel"]').textContent = st.label === 'Countdown' ? 'COUNTDOWN' : `REST · ${st.label.toUpperCase().slice(0, 24)}`;
    bar.querySelector('[data-k="fill"]').style.width = `${Math.min(100, st.fraction * 100)}%`;
  };

  const keepAwake = async () => {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') { if (!editing && prefs().keepAwake) keepAwake(); header(); } };

  ready.then(async (r) => {
    repo = r;
    session = await repo.get('sessions', id);
    if (!session) { view.innerHTML = '<h1 class="view-title">Session not found</h1><p class="hint"><a href="#/train">Back to Train</a></p>'; return; }
    if (session.status !== 'active' && !(editing && session.status === 'done')) { location.replace(`#/finish/${id}`); return; }
    sets = (await repo.list('sets')).filter((s) => s.sessionId === id);
    ctx = await context(repo, id);
    typicalMs = typicalDurationMs(session.dayType, { sessions: ctx.sessions, bridge: ctx.bridge, now: session.startedAt });
    draw();
    drawRest(rest.status());
    offRest = rest.subscribe(drawRest);
    if (setTimer && !sets.some((x) => x.id === setTimer.setId && !x.done)) { setTimer = null; storeSetTimer(null); }
    runSetTimer();
    timer = setInterval(header, 1000);
    if (!editing && prefs().keepAwake) keepAwake();
    document.addEventListener('visibilitychange', onVis);
    offRepo = repo.onChange(async (cols, origin) => {
      if (origin !== 'remote' || (!cols.includes('sets') && !cols.includes('sessions'))) return;
      if (view.contains(document.activeElement) && document.activeElement.matches('input')) return;
      session = (await repo.get('sessions', id)) || session;
      sets = (await repo.list('sets')).filter((s) => s.sessionId === id);
      if (session.status !== 'active' && !editing) { location.replace(`#/finish/${id}`); return; }
      drawCards();
    });
  });

  return () => {
    clearInterval(timer); clearInterval(setTimerTick); offRest(); offRepo();
    document.removeEventListener('visibilitychange', onVis);
    wakeLock?.release?.().catch(() => {});
  };
}

export { toast };
