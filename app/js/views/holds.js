// TENDON HOLDS: checklist (#/holds) and the hold timer (#/holds/<area>/<holdIndex>).
// Rules come from the owner's tendon note; the app adds no rehab advice of its own.
import { ready, saveSettings } from '../lib/data.js';
import { setQuiet } from '../lib/quiet.js';
import { roundsByDate, areaStatus, painOk, PHASE_TEXT, holdSlots, restChoices, withRestChoice, restChoiceText, REST_CHOICES } from '../lib/holds.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL } from '../lib/rotation.js';
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

async function loadAreas(repo) {
  return (await repo.list('tendons')).filter((d) => d.kind === 'area').sort((a, b) => ['knees', 'shoulder', 'wrist'].indexOf(a.id) - ['knees', 'shoulder', 'wrist'].indexOf(b.id));
}

function renderList(view, repo) {
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
    const slots = holdSlots({ areas, dayKind: rot.today.kind, dayType, roundsToday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[today] || 0])), times: { morning: prefs.holdsMorning, evening: prefs.holdsEvening }, restChoices: restChoices(days, today) });
    const areaOf = (id) => areas.find((a) => a.id === id);
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
        ${slots.length ? slots.map(slotRow).join('') : '<p class="hint">Nothing scheduled today.</p>'}
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
        </section>`;
      }).join('')}`;
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
  const total = () => hold.sets || 3;
  const secs = () => hold.seconds || 30;
  const getReadyS = () => withDefaults(getState().settings).holds.getReadyS ?? 15;

  // A14/A15: the next hold's lines are worked out and fetched while he gets in position or rests, so they play on time.
  const plan = () => {
    script = holdScript({ getReadyS: getReadyS(), holdS: secs(), setNo, bank, ...talk.talkPrefs(), calm: calm || talk.isCalm(), avoid: new Set(talk.recentLines()) });
    talk.prepare(script);
  };
  const begin = () => {
    rest.unlockAudio(); talk.unlock();
    if (!script || script.setNo !== setNo) plan();
    const t0 = Date.now();
    playing = talk.run(script, { t0 });
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
    const set = {
      id: newId('set'), sessionId: session.id, exKey: session.exercises[0].key, order: setNo, type: 'hold', kg: hold.loadKg ?? null,
      durationS: Math.round(((endedSet || now) - startedSet) / 1000), done: true, doneAt: now, pain, shaking, note: '',
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

  const draw = () => {
    const left = Math.max(0, (endsAt - Date.now()) / 1000);
    const body = view.querySelector('#h-body');
    if (!body) return;
    if (phase === 'ready' || phase === 'getready' || phase === 'holding' || phase === 'rest') {
      const of = phase === 'rest' ? holdRestS() : phase === 'getready' ? getReadyS() : secs();
      const shown = phase === 'ready' ? secs() : left;
      body.innerHTML = `
        <div class="hold-ring ${phase === 'getready' ? 'is-getready' : phase === 'holding' ? 'is-holding' : ''}">${ring(shown, of)}<div class="hold-ring-text">${phase === 'getready' || phase === 'holding' ? `<span class="hold-phase">${phase === 'getready' ? 'GET READY' : 'HOLD'}</span>` : ''}<b>${clockText(shown, phase !== 'rest' && phase !== 'ready')}</b>
          <span class="hud c-muted">${phase === 'rest' ? 'REST' : `SET ${setNo} OF ${total()}`}</span></div></div>
        <div class="btn-row">${phase === 'ready' ? `<button class="btn-primary big" data-h="go" type="button">Start set ${setNo}</button>`
          : phase === 'getready' ? '<button class="btn-ghost big" data-h="cancel" type="button">Not yet</button>'
          : phase === 'holding' ? '<button class="btn-primary big" data-h="end" type="button">End set</button>'
          : `<button class="btn-primary big" data-h="next" type="button">Start set ${setNo} now</button>`}</div>
        ${phase === 'ready' || phase === 'rest' ? `<p class="hint">Start gives you ${getReadyS()} s to get in position, then 3, 2, 1 and the ${secs()} s hold.</p>` : ''}`;
    } else if (phase === 'rate') {
      body.innerHTML = `
        <section class="card pad-card">
          <div class="hud c-muted">SET ${setNo} · PAIN DURING THE HOLD <span class="c-green">· LIMIT 3-4 / 10</span></div>
          <div class="pain-grid" role="group" aria-label="Pain out of 10">${Array.from({ length: 11 }, (_, i) => `<button class="pain ${i > 4 ? 'over' : ''}" data-p="${i}" type="button">${i}</button>`).join('')}</div>
          <div class="hud c-muted">SHAKING</div>
          <div class="btn-row" role="group" aria-label="Shaking">${['none', 'some', 'a lot'].map((x) => `<button class="pill" data-s="${x}" type="button">${x}</button>`).join('')}</div>
          <p class="hint c-amber" data-k="over" hidden>Over your 3-4 limit. Your note: next time use less weight or push less hard.</p>
          <button class="btn-primary big" data-h="save" type="button" disabled>Save set ${setNo}</button>
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
      body.querySelector('[data-h="save"]').addEventListener('click', async () => {
        await saveSet(pain, shaking);
        if (setNo >= total()) { await finishRound(); return; }
        // Over his 3-4 limit: Calm for the rest of the round (A15).
        if (!painOk(pain)) calm = true;
        setNo++; phase = 'rest'; endsAt = Date.now() + holdRestS() * 1000; plan(); tickLoop(); draw();
      });
    }
    body.querySelectorAll('[data-h]').forEach((b) => {
      if (b.dataset.h === 'go' || b.dataset.h === 'next') b.onclick = begin;
      // Not in position yet: back to Start, nothing saved.
      if (b.dataset.h === 'cancel') b.onclick = () => { clearInterval(timer); playing?.stop(); setQuiet('hold', false); phase = 'ready'; plan(); draw(); };
      // Stopped early: the seconds actually held are saved.
      if (b.dataset.h === 'end') b.onclick = () => { clearInterval(timer); playing?.stop(); setQuiet('hold', false); endedSet = Date.now(); rest.beep(1); phase = 'rate'; draw(); };
    });
  };

  const tickLoop = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (Date.now() >= endsAt) {
        // GET READY is over: the hold starts now (the voice or the sound says so). The hold's time starts here.
        if (phase === 'getready') { startedSet = endsAt; endsAt = startedSet + secs() * 1000; phase = 'holding'; draw(); return; }
        clearInterval(timer);
        // The end of a hold is marked by the script (voice, else its beeps); the end of a rest by two beeps.
        if (phase !== 'holding') rest.beep(2);
        if (phase === 'holding') endedSet = endsAt;
        setQuiet('hold', false);
        phase = phase === 'holding' ? 'rate' : 'ready';
        if (phase === 'ready' && script?.setNo !== setNo) plan();
        draw();
        return;
      }
      const t = view.querySelector('.hold-ring-text b');
      const left = Math.max(0, (endsAt - Date.now()) / 1000);
      if (t) t.textContent = clockText(left, phase === 'getready' || phase === 'holding');
      const svg = view.querySelector('.hold-ring');
      if (svg) svg.firstElementChild.outerHTML = ring(left, phase === 'rest' ? holdRestS() : phase === 'getready' ? getReadyS() : secs());
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
      <div><h1 class="view-title">${esc(hold.exercise)}</h1><div class="hint">${esc(loadText(hold))} · ${total()} × ${index === 'other' ? `${secs()} s` : `<button class="link-btn" id="h-secs" type="button">${secs()} s</button>`} · ${restText(holdRestS())} between</div></div>
      <div id="h-body"></div>
      <p class="hint">Next-day check: ${esc(tomorrow())}${area.phase === 'heal' ? ', with the morning round' : ''}.</p>
      <button class="btn-ghost" id="h-stop" type="button">End round</button>`;
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
