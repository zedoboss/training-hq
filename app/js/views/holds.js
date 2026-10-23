// TENDON HOLDS: checklist (#/holds) and the hold timer (#/holds/<area>/<holdIndex>).
// Rules come from the owner's tendon note; the app adds no rehab advice of its own.
import { ready, saveSettings, macPost } from '../lib/data.js';
import { setQuiet } from '../lib/quiet.js';
import { roundsByDate, areaStatus, painOk, PHASE_TEXT, holdSlots, restChoices, withRestChoice, restChoiceText, REST_CHOICES, holdBase } from '../lib/holds.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL, sessionTomorrow } from '../lib/rotation.js';
import { isoDate, formatDay, formatHm } from '../lib/time.js';
import { newId, newKey } from '../lib/routines.js';
import { kg as fmtKg } from '../lib/loads.js';
import * as rest from '../lib/rest-timer.js';
import { getState } from '../lib/store.js';
import { withDefaults, restText } from '../lib/settings.js';
import { confirmSheet, promptText } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { holdScript } from '../lib/coach-talk.js';
import * as talk from '../lib/talk.js';
import { pathOf, pathState, movePath, stageText } from '../lib/hold-path.js';

/** Rest between holds, from Settings (default 2:00). */
const holdRestS = () => withDefaults(getState().settings).rest.holdS || 120;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const loadText = (h) => (h.loadKg != null ? `${fmtKg(h.loadKg)} kg` : h.load || 'bodyweight');
/** Seconds on the ring: whole seconds big for GET READY and the hold (m:ss from a minute), m:ss for rest. */
const clockText = (left, big) => {
  const n = Math.ceil(left - 0.001);
  return big && n < 60 ? String(Math.max(0, n)) : `${Math.floor(n / 60)}:${String(Math.max(0, n) % 60).padStart(2, '0')}`;
};
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return formatDay(d); };
// When each area's holds are done: written in the tendon data (timingText), shown for confirmation the first time.
const timingOf = (a) => a.timingText || 'Not set yet.';

// Thu 10/22: a hold that moves through stages (lib/hold-path.js): he starts it, the app asks to step up, he confirms.
const dayOfLocal = (ms) => isoDate(new Date(ms));
function pathHtml(a, h, i, sessions, sets) {
  const path = pathOf(h);
  if (!path) return '';
  const st = pathState({ hold: h, area: a, sessions, sets, dayOf: dayOfLocal });
  const steps = path.stages.map((x, j) => `<span class="${st.started && j === st.at ? 'c-cyan' : j < st.at ? 'c-green' : 'c-muted'}">${esc(x.label)}</span>`).join(' → ');
  const btn = (how, label, cls = 'btn-ghost') => `<button class="${cls} small" type="button" data-path="${how}" data-area="${esc(a.id)}" data-i="${i}">${label}</button>`;
  if (!st.started) {
    return `<div class="hold-path"><div class="hud c-muted">${esc((path.name || 'Hold path').toUpperCase())} · NOT STARTED</div><div class="hint">${steps}</div>
      <div class="hint">Each stage replaces the one before; after ${st.need} quiet Push days the app asks you to step up.</div>
      <div class="btn-row">${btn('start', 'Start the path', 'btn-primary')}</div></div>`;
  }
  return `<div class="hold-path"><div class="hud c-cyan">${esc((path.name || 'Hold path').toUpperCase())} · ${esc(stageText(path, st.at).toUpperCase())}</div><div class="hint">${steps}</div>
    <div class="hint">${st.next ? `Quiet Push days at this stage: ${Math.min(st.quietDays.length, st.need)} of ${st.need} (every set at most 3-4/10).` : 'Last stage.'}</div>
    ${st.ready ? `<div class="hint c-amber">Ready for ${esc(st.next.label)}${st.next.loadNote ? ` (${esc(st.next.loadNote)})` : ''}. Shoulder not worse the morning after?</div>
      <div class="btn-row">${btn('up', 'Step up', 'btn-primary')}${btn('not-yet', 'Not yet')}</div>` : ''}
    ${st.at > 0 ? `<div class="btn-row">${btn('back', 'Back one stage')}</div>` : ''}</div>`;
}

async function loadAreas(repo) {
  return (await repo.list('tendons')).filter((d) => d.kind === 'area').sort((a, b) => ['knees', 'shoulder', 'wrist'].indexOf(a.id) - ['knees', 'shoulder', 'wrist'].indexOf(b.id));
}

function renderList(view, repo) {
  // The hold path's buttons (start, step up, not yet, back one stage).
  const onPath = async (b) => {
    const today = isoDate(new Date());
    const doc = (await repo.list('tendons')).find((d) => d.kind === 'area' && d.id === b.dataset.area);
    if (!doc) return;
    const i = Number(b.dataset.i); const how = b.dataset.path;
    if (how === 'back' && !(await confirmSheet('Back one stage?', { ok: 'Back one stage' }))) return;
    const holds = doc.holds.map((h, j) => (j === i ? movePath(h, how, today) : h));
    await repo.put('tendons', `area.${doc.id}`, { ...doc, holds });
    const h = holds[i];
    toast(how === 'not-yet' ? 'Asking again after one more quiet Push day.' : `${stageText(h.path, h.path.at)}.`);
  };
  const draw = async () => {
    const today = isoDate(new Date());
    const [areas, sessions, sets, bridge, dayList] = await Promise.all([loadAreas(repo), repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'), repo.list('days')]);
    const days = daysByDate(dayList);
    const todayDoc = days[today];
    const rot = rotationDay({ last: lastRotationSession(sessions, bridge), today, days });
    const prefs = withDefaults(getState().settings).notify;
    // Today's check-in: W = yes or T = 3 means less weight or less effort for that area's holds (his note's rule).
    const ease = new Set(todayDoc?.readiness?.easeHolds || []);
    const rounds = roundsByDate(areas, sessions, sets, bridge);
    const dayType = rot.today.kind === 'rest' ? null : rot.today.dayType;
    // Sat 10/24: on a rest day before a session, a weekly gym hold goes after that session (not asked today).
    const nextSession = sessionTomorrow(rot, today);
    const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType, roundsToday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[today] || 0])), times: { morning: prefs.holdsMorning, evening: prefs.holdsEvening }, restChoices: restChoices(days, today), nextSession });
    const areaOf = (id) => areas.find((a) => a.id === id);
    // Thu 10/22, his words: "the shoulder should be there in this tendons": an area behind its weekly count (fix or
    // maintenance) with nothing planned today is listed under today too, to do any day.
    const weekly = areas.filter((a) => a.holds?.length && (a.phase === 'fix' || a.phase === 'maintenance') && !slots.some((x) => x.area === a.id))
      .map((a) => ({ a, st: areaStatus(a, rounds[a.id] || {}, today) })).filter(({ st }) => st.due);
    // A2: the rest-day question (the gym for this hold, another hold he names, or skip today). No hold is suggested.
    const lastText = (x) => (x.last ? `<div class="hint">Last rest day (${esc(formatDay(new Date(`${x.last.date}T12:00:00`)))}): ${esc(restChoiceText(x.last, areaOf(x.area)))}.</div>` : '');
    const askRow = (x) => `<div class="hold-row slot-row rest-ask" data-slot="${esc(x.area)}:rest"><div><span class="hud c-amber">REST DAY · ${esc(formatHm(x.time))} · WHAT TODAY?</span>
          <div><b>${esc(x.label)}</b> · the ${esc(x.restHold)} hold needs the gym.</div>${lastText(x)}
          <div class="chips wrap">${REST_CHOICES.map(([k, label]) => `<button class="chip" data-rc="${k}" data-area="${esc(x.area)}" type="button">${esc(label)}</button>`).join('')}</div></div></div>`;
    const slotRow = (x) => {
      if (x.ask && !x.done) return askRow(x);
      if (x.skipped && !x.done) return `<div class="hold-row slot-row is-skipped" data-slot="${esc(x.area)}:rest"><div><span class="hud c-muted">REST DAY · SKIPPED TODAY (YOUR CHOICE)</span>
          <div><b>${esc(x.label)}</b> · no hold today</div></div><button class="pill" data-rc-change="${esc(x.area)}" type="button">Change</button></div>`;
      return `<div class="hold-row slot-row${x.done ? ' is-done' : ''}" data-slot="${esc(x.area)}:${esc(x.slot)}"><div><span class="hud ${x.done ? 'c-green' : 'c-cyan'}">${esc(slotWhen(x).toUpperCase())}${x.slot === 'rest' && x.holdIndex === 'other' ? ' · YOUR HOLD' : ''}</span>
          <div><b>${esc(x.label)}</b> · ${esc(x.exercise)}${x.where ? ` <span class="hint">(${esc(x.where)})</span>` : ''}${x.also?.length ? `<div class="hint">then ${esc(x.also.join(', '))}</div>` : ''}</div>
          ${x.slot === 'rest' && !x.done ? `<button class="link-btn" data-rc-change="${esc(x.area)}" type="button">Change today's choice</button>` : ''}</div>
          ${x.done ? '<span class="hud c-green">DONE</span>' : `<a class="pill is-on" href="#/holds/${esc(x.area)}/${x.holdIndex}">Start</a>`}</div>`;
    };
    const slotWhen = (x) => (x.slot === 'after' ? `After ${LABEL[dayType]}` : x.slot === 'rest' ? `Rest day · ${formatHm(x.time)}` : `${x.slot === 'morning' ? 'Morning' : 'Evening'} · ${formatHm(x.time)}`);
    const timesOpen = !prefs.holdTimesConfirmedOn;
    const unconfirmed = areas.filter((a) => a.holds?.length && a.phase !== 'unknown'
      && (a.timingConfirmed === false || a.timesConfirmed === false || a.holds.some((h) => h.timingConfirmed === false)));
    const confirmArea = (a, extra = {}) => ({ ...a, ...extra, timingConfirmed: true, timesConfirmed: true, timingConfirmedOn: today, holds: a.holds.map((h) => ({ ...h, timingConfirmed: true })) });
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/train">Back</a></div>
      <h1 class="view-title">Tendon holds</h1>
      <p class="hint">Your rules: hold at least 30 seconds, 3 sets, using the movement that hurts. Pain up to 3-4 out of 10 is fine if it isn't worse the next day; if it is, use less weight or push less hard.</p>
      <section class="card pad-card hold-today">
        <div class="hud c-muted">TODAY · ${esc(formatDay(new Date()).toUpperCase())} · ${rot.today.kind === 'rest' ? 'REST DAY' : `${esc(LABEL[dayType]).toUpperCase()} DAY`}</div>
        ${slots.length ? slots.map(slotRow).join('') : weekly.length ? '' : '<p class="hint">Nothing scheduled today.</p>'}
        ${weekly.map(({ a, st }) => `<div class="hold-row slot-row" data-slot="${esc(a.id)}:week"><div><span class="hud c-amber">THIS WEEK · ${st.done} OF ${st.target[0] === st.target[1] ? st.target[0] : `${st.target[0]}-${st.target[1]}`} · ${nextSession && a.holds[0].where !== 'home' ? `AFTER ${esc(LABEL[nextSession]).toUpperCase()} TOMORROW` : 'ANY DAY'}</span>
          <div><b>${esc(a.label)}</b> · ${esc(a.holds[0].exercise)}${a.holds[0].where ? ` <span class="hint">(${esc(a.holds[0].where)})</span>` : ''}${a.holds.length > 1 ? `<div class="hint">then ${esc(a.holds.slice(1).map((h) => h.exercise).join(', '))}</div>` : ''}</div></div><a class="pill is-on" href="#/holds/${esc(a.id)}/0">Start</a></div>`).join('')}
      </section>
      ${unconfirmed.length || timesOpen ? `<section class="card pad-card confirm-card"><div class="hud c-amber">CONFIRM YOUR HOLD TIMES (FIRST TIME)</div>
        ${unconfirmed.map((a) => `<p class="hint c-text"><b>${esc(a.label)}:</b> ${esc(timingOf(a))}</p>`).join('')}
        <p class="hint c-text">Reminders for holds at home (and rest-day holds):</p>
        <div class="time-pair"><label>Morning <input class="input" type="time" id="t-morning" value="${esc(prefs.holdsMorning)}"></label><label>Evening <input class="input" type="time" id="t-evening" value="${esc(prefs.holdsEvening)}"></label></div>
        <div class="btn-row"><button class="btn-primary" id="t-ok" type="button">Confirm</button><button class="btn-ghost" id="t-change" type="button">Change</button></div></section>` : ''}
      ${areas.filter((a) => a.holds?.length).map((a) => {
        const st = areaStatus(a, rounds[a.id] || {}, today);
        return `<section class="card pad-card">
          <div class="ex-head"><b class="area-name">${esc(a.label)}</b><span class="hud ${st.due ? 'c-amber' : 'c-green'}">${esc(st.text.toUpperCase())}</span></div>
          <div class="hint">${esc(PHASE_TEXT[a.phase] || '')}</div>
          ${ease.has(a.id) ? '<div class="hint c-amber ease-note">Check-in: worse than yesterday or above your limit. Use less weight or push less hard today (your rule).</div>' : ''}
          ${a.openQuestion ? `<div class="hint c-amber">To decide: ${esc(a.openQuestion.text)}</div>` : ''}
          ${a.holds.map((h, i) => `<div class="hold-row"><div><b>${esc(h.exercise)}</b><div class="hint">${esc(loadText(h))} · ${h.sets || 3} × ${h.seconds || 30} s${h.where ? ` · ${esc(h.where)}` : ''}</div></div>
            <a class="pill is-on" href="#/holds/${esc(a.id)}/${i}">Start</a></div>`).join('')}
          ${a.holds.map((h, i) => pathHtml(a, h, i, sessions, sets)).join('')}
        </section>`;
      }).join('')}`;
    view.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => onPath(b)));
    const answer = async (areaId, choice) => {
      let holdName = null;
      if (choice === 'other') {
        const prev = restChoices(days, today)[areaId];
        const named = [prev?.today, prev?.last, prev?.lastPlan].find((c) => c?.choice === 'other')?.holdName || '';
        holdName = (await promptText('Which hold today?', named, { placeholder: 'The hold, in your words' }))?.trim();
        if (!holdName) return;
      }
      await repo.put('days', today, withRestChoice(days[today], today, areaId, { choice, holdName }));
      toast(choice === 'skip' ? 'Skipped today. Asks again next rest day.' : choice === 'other' ? `${holdName}: 3 × 30 s, your rule.` : 'Gym it is.');
    };
    view.querySelectorAll('[data-rc]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.area, b.dataset.rc)));
    view.querySelectorAll('[data-rc-change]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.rcChange;
      const { restHolds, ...rest } = days[today] || {};
      const left = { ...(restHolds || {}) }; delete left[id];
      await repo.put('days', today, { ...rest, date: today, ...(Object.keys(left).length ? { restHolds: left } : {}) });
    }));
    const ok = view.querySelector('#t-ok');
    if (ok) {
      const saveTimes = async () => {
        const m = view.querySelector('#t-morning').value; const e = view.querySelector('#t-evening').value;
        if (!/^\d\d:\d\d$/.test(m) || !/^\d\d:\d\d$/.test(e) || m >= e) { toast('Morning must be before evening.'); return false; }
        await saveSettings({ notify: { holdsMorning: m, holdsEvening: e, holdTimesConfirmedOn: today } });
        return true;
      };
      ok.onclick = async () => {
        if (!(await saveTimes())) return;
        for (const a of unconfirmed) await repo.put('tendons', `area.${a.id}`, confirmArea(a));
        toast('Hold times confirmed.');
        draw();
      };
      view.querySelector('#t-change').onclick = async () => {
        const text = await promptText('What should change?', '', { placeholder: 'e.g. shoulder holds only after Push' });
        if (!text) return;
        if (!(await saveTimes())) return;
        for (const a of unconfirmed) await repo.put('tendons', `area.${a.id}`, confirmArea(a, { timingNote: { text, on: today } }));
        toast('Saved. The schedule follows your note from step 4.');
        draw();
      };
    }
  };
  draw();
  // Redraw when a round, a rest day, the tendon data or the reminder times change (also when they arrive by sync).
  let pending = null;
  return repo.onChange((cols) => {
    if (!cols.some((c) => ['sessions', 'sets', 'days', 'tendons', 'settings'].includes(c))) return;
    clearTimeout(pending);
    pending = setTimeout(draw, 150);
  });
}

function renderRun(view, repo, areaId, index) {
  // Phases: ready (waiting for Start) -> getready (A14: 15 s to set up, then 3, 2, 1) -> holding -> rate -> rest -> ...
  let area; let hold; let session = null; let setNo = 1; let phase = 'ready'; let endsAt = 0; let timer = null; let startedSet = 0; let endedSet = 0;
  let bank = null; let script = null; let playing = null; let calm = false; let offTalk = () => {};
  // Thu 10/22, his words: "I'm doing one arm at a time... per round it should have two timers": a hold with sides
  // (cupping: right arm, then left) runs each side in turn inside one set. Then: "2 minutes rest time per arm... in
  // between, it should be only 5 seconds", and "after it's done, it should prompt me... the pain, and then 5 seconds for
  // the other arm". So each arm is rated when it stops, then 5 s to switch; each arm's rest runs from the moment that
  // arm stops (the right arm's is already going while the left one holds), and the next set's GET READY starts on its
  // own inside the right arm's rest, so that arm holds again 2:00 after it stopped.
  const SWITCH_S = 5;
  let side = 0; let readyOf = 0; let armEnds = []; let restTo = 0;
  const sides = () => (hold?.sides?.length > 1 ? hold.sides : null);
  const sideLabel = () => (sides() ? sides()[side] : '');
  const moreSides = () => Boolean(sides()) && side < sides().length - 1;
  const total = () => hold.sets || 3;
  const secs = () => hold.seconds || 30;
  const getReadyS = () => withDefaults(getState().settings).holds.getReadyS ?? 15;

  // A14/A15: the next hold's lines are worked out and fetched while he gets in position or rests, so they play on time.
  const plan = () => {
    script = holdScript({ getReadyS: getReadyS(), holdS: secs(), setNo, bank, ...talk.talkPrefs(), calm: calm || talk.isCalm(), avoid: new Set(talk.recentLines()) });
    talk.prepare(script, { force: true });
  };
  // Thu 10/22, his words: the count out loud even with the coach off, and a notification at go and at stop.
  const alarms = (items) => { if (getState().paired) macPost('/api/alarms', { kind: 'hold', items: items.map((x) => ({ ...x, url: location.hash })) }).catch(() => {}); };
  const sideAlarms = (t0, gr) => {
    const who = sideLabel() ? ` ${sideLabel().toLowerCase()}` : '';
    const last = !sides() || side === sides().length - 1;
    alarms([...(gr ? [{ at: t0 + gr * 1000, title: 'Hold: go', body: `${hold.exercise}${who}: hold ${secs()} s now. Set ${setNo} of ${total()}.` }] : []),
      { at: t0 + (gr + secs()) * 1000, title: 'Hold: stop', body: last ? `${hold.exercise}${who}: set ${setNo} of ${total()} done. Stop.` : `${hold.exercise}: ${sideLabel().toLowerCase()} done. Stop, rate it, then the ${sides()[side + 1].toLowerCase()}.` }]);
  };
  /** One arm is done and rated: the next one after a short switch, voiced and notified the same way. */
  const nextSide = () => {
    side++;
    const t0 = Date.now();
    const sc = holdScript({ getReadyS: SWITCH_S, holdS: secs(), setNo, bank, ...talk.talkPrefs(), calm: calm || talk.isCalm(), avoid: new Set(talk.recentLines()) });
    sc.cues[0] = { ...sc.cues[0], text: `Switch. ${sideLabel()}.` };
    talk.prepare(sc, { force: true });
    playing = talk.run(sc, { t0, force: true });
    sideAlarms(t0, SWITCH_S);
    setQuiet('hold', true);
    readyOf = SWITCH_S; phase = 'getready'; endsAt = t0 + SWITCH_S * 1000;
    tickLoop(); draw();
  };
  const begin = () => {
    rest.unlockAudio(); talk.unlock();
    if (!script || script.setNo !== setNo) plan();
    side = 0; armEnds = []; readyOf = script.getReadyS || 0;
    const t0 = Date.now();
    playing = talk.run(script, { t0, force: true });
    sideAlarms(t0, script.getReadyS || 0);
    setQuiet('hold', true);
    if (script.getReadyS > 0) { phase = 'getready'; endsAt = t0 + script.getReadyS * 1000; } else { phase = 'holding'; startedSet = t0; endsAt = t0 + secs() * 1000; }
    script = null;
    tickLoop(); draw();
  };

  const saveSet = async (pain, shaking) => {
    const now = Date.now();
    if (!session) {
      session = {
        id: newId('session'), kind: 'holds', area: areaId, title: `${area.label} holds`, startedAt: startedSet, endedAt: null, pausedMs: 0, pausedAt: null,
        status: 'active', round: new Date().getHours() < 12 ? 'morning' : 'evening', exercises: [{ key: newKey(), exerciseId: null, name: hold.exercise, type: hold.loadKg != null ? 'weight_duration' : 'duration' }], source: 'training-hq', note: '',
      };
      await repo.put('sessions', session.id, session);
    }
    // One set per arm for a hold with sides ("Right arm" in its note), in the order held.
    const set = {
      id: newId('set'), sessionId: session.id, exKey: session.exercises[0].key, order: setNo + (sides() ? side / 10 : 0), type: 'hold', kg: hold.loadKg ?? null,
      durationS: Math.round(((endedSet || now) - startedSet) / 1000), done: true, doneAt: now, pain, shaking, note: sideLabel(),
    };
    await repo.put('sets', set.id, set);
  };

  const finishRound = async () => {
    clearInterval(timer); playing?.stop();
    if (session) { session = { ...session, status: 'done', endedAt: Date.now() }; await repo.put('sessions', session.id, session); }
    toast(session ? 'Round saved.' : 'Nothing logged.');
    location.hash = '#/holds';
  };

  const ring = (left, of) => {
    const c = 2 * Math.PI * 104;
    return `<svg role="img" aria-label="${Math.ceil(left)} seconds left" width="240" height="240" viewBox="0 0 240 240" fill="none">
      <circle cx="120" cy="120" r="104" stroke="var(--divider)" stroke-width="10"/>
      <circle cx="120" cy="120" r="104" stroke="var(--cyan)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - left / of)).toFixed(1)}" transform="rotate(-90 120 120)"/></svg>`;
  };

  // The other arms' rests, running while this arm switches and holds (his "the 2-minute timer would be at 1:30").
  const armRestText = () => {
    if (!sides() || !(phase === 'rate' || (side > 0 && (phase === 'getready' || phase === 'holding')))) return '';
    const upTo = phase === 'rate' ? side + 1 : side;
    return armEnds.slice(0, upTo).map((t, i) => (t ? `${sides()[i].toUpperCase()} REST ${clockText(Math.max(0, (t + holdRestS() * 1000 - Date.now()) / 1000), false)}` : '')).filter(Boolean).join(' · ');
  };
  const armRestHtml = () => (armRestText() ? `<span class="hud c-muted" data-k="armrest">${esc(armRestText())}</span>` : '');

  const draw = () => {
    const left = Math.max(0, (endsAt - Date.now()) / 1000);
    const body = view.querySelector('#h-body');
    if (!body) return;
    if (phase === 'ready' || phase === 'getready' || phase === 'holding' || phase === 'rest') {
      const of = phase === 'rest' ? holdRestS() : phase === 'getready' ? readyOf || getReadyS() : secs();
      const shown = phase === 'ready' ? secs() : phase === 'rest' && sides() ? Math.max(0, (restTo - Date.now()) / 1000) : left;
      body.innerHTML = `
        <div class="hold-ring ${phase === 'getready' ? 'is-getready' : phase === 'holding' ? 'is-holding' : ''}">${ring(shown, of)}<div class="hold-ring-text">${phase === 'getready' || phase === 'holding' ? `<span class="hold-phase">${phase === 'getready' ? 'GET READY' : 'HOLD'}</span>` : ''}<b>${clockText(shown, phase !== 'rest' && phase !== 'ready')}</b>
          <span class="hud c-muted">${phase === 'rest' ? (sides() ? `REST · ${esc(sides()[0].toUpperCase())} NEXT` : 'REST') : `SET ${setNo} OF ${total()}`}</span>${sides() && (phase === 'getready' || phase === 'holding') ? `<span class="hud c-cyan">${esc(sideLabel().toUpperCase())}${phase === 'getready' && side > 0 ? ' · SWITCH' : ''}</span>` : ''}${armRestHtml()}</div></div>
        <div class="btn-row">${phase === 'ready' ? `<button class="btn-primary big" data-h="go" type="button">Start set ${setNo}${sides() ? ` · ${esc(sides()[0].toLowerCase())} first` : ''}</button>`
          : phase === 'getready' ? '<button class="btn-ghost big" data-h="cancel" type="button">Not yet</button>'
          : phase === 'holding' ? `<button class="btn-primary big" data-h="end" type="button">${sides() ? `End ${esc(sideLabel().toLowerCase())}` : 'End set'}</button>`
          : `<button class="btn-primary big" data-h="next" type="button">Start set ${setNo} now</button>`}</div>
        ${phase === 'rest' && sides() ? `<p class="hint">Each arm rests ${restText(holdRestS())} from when it stopped. GET READY starts on its own ${getReadyS()} s before the ${esc(sides()[0].toLowerCase())}'s rest ends.</p>`
          : phase === 'ready' || phase === 'rest' ? `<p class="hint">Start gives you ${getReadyS()} s to get in position, then 3, 2, 1 and the ${secs()} s hold${sides() ? ` with the ${esc(sides()[0].toLowerCase())}. Rate it, then ${SWITCH_S} s and the ${esc(sides().slice(1).join(', ').toLowerCase())}. Each arm rests ${restText(holdRestS())} from when it stops` : ''}.</p>` : ''}`;
    } else if (phase === 'rate') {
      body.innerHTML = `
        <section class="card pad-card">
          <div class="hud c-muted">SET ${setNo}${sides() ? ` · ${esc(sideLabel().toUpperCase())}` : ''} · PAIN DURING THE HOLD <span class="c-green">· LIMIT 3-4 / 10</span></div>
          <div class="pain-grid" role="group" aria-label="Pain out of 10">${Array.from({ length: 11 }, (_, i) => `<button class="pain ${i > 4 ? 'over' : ''}" data-p="${i}" type="button">${i}</button>`).join('')}</div>
          <div class="hud c-muted">SHAKING</div>
          <div class="btn-row" role="group" aria-label="Shaking">${['none', 'some', 'a lot'].map((x) => `<button class="pill" data-s="${x}" type="button">${x}</button>`).join('')}</div>
          <p class="hint c-amber" data-k="over" hidden>Over your 3-4 limit. Your note: next time use less weight or push less hard.</p>
          <button class="btn-primary big" data-h="save" type="button" disabled>${moreSides() ? `Save, ${SWITCH_S} s to the ${esc(sides()[side + 1].toLowerCase())}` : `Save set ${setNo}`}</button>
          ${armRestHtml()}
        </section>`;
      let pain = null; let shaking = null;
      const upd = () => {
        body.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.p) === pain));
        body.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('is-on', b.dataset.s === shaking));
        body.querySelector('[data-k="over"]').hidden = painOk(pain);
        body.querySelector('[data-h="save"]').disabled = pain == null;
      };
      body.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { pain = Number(b.dataset.p); upd(); }));
      body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { shaking = b.dataset.s; upd(); }));
      // The rated arm's rest keeps counting while he rates.
      if (sides()) { clearInterval(timer); timer = setInterval(() => { const ar = view.querySelector('[data-k="armrest"]'); if (ar) ar.textContent = armRestText(); }, 500); }
      body.querySelector('[data-h="save"]').addEventListener('click', async () => {
        await saveSet(pain, shaking);
        // Over his 3-4 limit: Calm for the rest of the round (A15).
        if (!painOk(pain)) calm = true;
        if (moreSides()) { nextSide(); return; }
        if (setNo >= total()) { await finishRound(); return; }
        setNo++; plan();
        if (sides()) {
          restTo = (armEnds[0] || endedSet) + holdRestS() * 1000;
          if (restTo - Date.now() <= getReadyS() * 1000) { begin(); return; }
          phase = 'rest'; endsAt = restTo - getReadyS() * 1000;
        } else { phase = 'rest'; endsAt = Date.now() + holdRestS() * 1000; }
        tickLoop(); draw();
      });
    }
    body.querySelectorAll('[data-h]').forEach((b) => {
      if (b.dataset.h === 'go' || b.dataset.h === 'next') b.onclick = begin;
      // Not in position yet: back to Start, nothing saved.
      if (b.dataset.h === 'cancel') b.onclick = () => { clearInterval(timer); playing?.stop(); setQuiet('hold', false); phase = 'ready'; plan(); draw(); };
      // Stopped early: the seconds actually held are saved.
      if (b.dataset.h === 'end') b.onclick = () => {
        clearInterval(timer); playing?.stop(); setQuiet('hold', false); endedSet = Date.now(); armEnds[side] = endedSet; rest.beep(1);
        alarms([]); phase = 'rate'; draw();
      };
    });
  };

  const tickLoop = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (Date.now() >= endsAt) {
        // GET READY is over: the hold starts now (the voice or the sound says so). The hold's time starts here.
        if (phase === 'getready') { startedSet = endsAt; endsAt = startedSet + secs() * 1000; phase = 'holding'; draw(); return; }
        clearInterval(timer);
        if (phase === 'rest' && sides()) { begin(); return; }
        // The end of a hold is marked by the script (voice, else its beeps); the end of a rest by two beeps.
        if (phase !== 'holding') rest.beep(2);
        if (phase === 'holding') { endedSet = endsAt; armEnds[side] = endedSet; }
        setQuiet('hold', false);
        phase = phase === 'holding' ? 'rate' : 'ready';
        if (phase === 'ready' && script?.setNo !== setNo) plan();
        draw();
        return;
      }
      const t = view.querySelector('.hold-ring-text b');
      const left = Math.max(0, ((phase === 'rest' && sides() ? restTo : endsAt) - Date.now()) / 1000);
      if (t) t.textContent = clockText(left, phase === 'getready' || phase === 'holding');
      const ar = view.querySelector('[data-k="armrest"]');
      if (ar) ar.textContent = armRestText();
      const svg = view.querySelector('.hold-ring');
      if (svg) svg.firstElementChild.outerHTML = ring(left, phase === 'rest' ? holdRestS() : phase === 'getready' ? readyOf || getReadyS() : secs());
    }, 200);
  };

  (async () => {
    const areas = await loadAreas(repo);
    area = areas.find((a) => a.id === areaId);
    if (index === 'other') {
      // A2: the hold he named for today's rest day (his words; his note's 3 × 30 s).
      const today = isoDate(new Date());
      const rc = restChoices(daysByDate(await repo.list('days')), today)[areaId] || {};
      const c = [rc.today, rc.lastPlan].find((x) => x?.choice === 'other');
      hold = c ? { exercise: c.holdName, load: 'load your choice', sets: 3, seconds: 30 } : null;
    } else hold = area?.holds?.[index];
    if (!hold) { view.innerHTML = '<h1 class="view-title">Hold not found</h1><p class="hint"><a href="#/holds">Back</a></p>'; return; }
    // A15: his lines; Calm when today's check-in eased this area's holds (a safety rule applies).
    bank = await repo.get('coach-lines', 'bank');
    const todayDoc = (await repo.list('days')).find((d) => d.date === isoDate(new Date()));
    calm = (todayDoc?.readiness?.easeHolds || []).includes(areaId);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/holds">Back</a><span class="hud c-muted">${esc(area.label.toUpperCase())} · ${esc((PHASE_TEXT[area.phase] || '').split(':')[0].toUpperCase())}</span><button class="pill" id="h-mute" type="button" aria-pressed="false">Coach on</button></div>
      <div><h1 class="view-title">${esc(hold.exercise)}</h1><div class="hint">${esc(loadText(hold))} · ${total()} × ${index === 'other' ? `${secs()} s` : `<button class="link-btn" id="h-secs" type="button">${secs()} s</button>`}${sides() ? ' per arm' : ''} · ${restText(holdRestS())} ${sides() ? 'rest per arm' : 'between'}</div></div>
      <div class="pinned small" id="h-note" hidden></div>
      <div id="h-body"></div>
      <p class="hint">Next-day check: ${esc(tomorrow())}${area.phase === 'heal' ? ', with the morning round' : ''}.</p>
      <button class="btn-ghost" id="h-stop" type="button">End round</button>`;
    // Thu 10/22, his words: "my cupping hold notes aren't here": the exercise's pinned note, as on the workout card.
    const exs = await repo.list('exercises');
    const ex = exs.find((e) => e.name === hold.exercise) || exs.find((e) => holdBase(e.name) === holdBase(hold.exercise));
    const note = ex?.pinnedNote?.text ?? ex?.pinnedNote ?? hold.note ?? '';
    if (note) { const n = view.querySelector('#h-note'); n.textContent = note; n.hidden = false; }
    const muteBtn = view.querySelector('#h-mute');
    const showMute = () => { muteBtn.textContent = talk.isMuted() ? 'Coach muted' : 'Coach on'; muteBtn.setAttribute('aria-pressed', String(talk.isMuted())); muteBtn.classList.toggle('is-on', !talk.isMuted()); };
    muteBtn.onclick = () => { talk.setMuted(!talk.isMuted()); showMute(); };
    showMute();
    offTalk = talk.onChange(showMute);
    // Hold length per hold (his note: at least 30 s).
    view.querySelector('#h-secs')?.addEventListener('click', async () => {
      if (phase === 'getready' || phase === 'holding') return;
      const t = await promptText('Hold length in seconds (your note: at least 30)', String(secs()), { placeholder: '30' });
      if (t == null) return;
      const v = Math.round(Number(t));
      if (!(v >= 10 && v <= 300)) { toast('Between 10 and 300 seconds.'); return; }
      const doc = await repo.get('tendons', `area.${area.id}`);
      if (!doc?.holds?.[index]) return;
      const holds = doc.holds.map((h, i) => (i === index ? { ...h, seconds: v } : h));
      await repo.put('tendons', `area.${area.id}`, { ...doc, holds });
      hold = holds[index];
      view.querySelector('#h-secs').textContent = `${v} s`;
      plan(); draw();
      toast(`${hold.exercise}: ${v} s holds.`);
    });
    view.querySelector('#h-stop').onclick = async () => {
      if (phase === 'getready' || phase === 'holding') alarms([]);
      if (phase === 'holding' && !(await confirmSheet('End the round now? The hold in progress is not saved.', { ok: 'End round' }))) return;
      finishRound();
    };
    plan();
    draw();
  })();
  return () => { clearInterval(timer); playing?.stop(); offTalk(); talk.setMuted(false); setQuiet('hold', false); };
}

export function render(view, params = []) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let cleanup = () => {};
  ready.then((repo) => {
    if (params[0] && params[1] != null) cleanup = renderRun(view, repo, params[0], params[1] === 'other' ? 'other' : Number(params[1])) || cleanup;
    else if (params[0]) location.replace('#/holds');
    else cleanup = renderList(view, repo) || cleanup;
  });
  return () => cleanup();
}
