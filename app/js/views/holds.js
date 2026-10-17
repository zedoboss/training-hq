// TENDON HOLDS: checklist (#/holds) and the hold timer (#/holds/<area>/<holdIndex>).
// Rules come from the owner's tendon note; the app adds no rehab advice of its own.
import { ready } from '../lib/data.js';
import { roundsByDate, areaStatus, painOk, PHASE_TEXT } from '../lib/holds.js';
import { isoDate, formatDay } from '../lib/time.js';
import { newId, newKey } from '../lib/routines.js';
import { kg as fmtKg } from '../lib/loads.js';
import * as rest from '../lib/rest-timer.js';
import { confirmSheet, promptText } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const loadText = (h) => (h.loadKg != null ? `${fmtKg(h.loadKg)} kg` : h.load || 'bodyweight');
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return formatDay(d); };
const TIMING = {
  shoulder: 'After Push, and on rest days.',
  knees: 'Morning and evening. On Legs days the leg extension hold at the gym counts as one; the other, and both on other days, are the toes wall squat hold at home.',
  wrist: 'Not set yet.',
};

async function loadAreas(repo) {
  return (await repo.list('tendons')).filter((d) => d.kind === 'area').sort((a, b) => ['knees', 'shoulder', 'wrist'].indexOf(a.id) - ['knees', 'shoulder', 'wrist'].indexOf(b.id));
}

function renderList(view, repo) {
  const draw = async () => {
    const [areas, sessions, sets, bridge] = await Promise.all([loadAreas(repo), repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads')]);
    const today = isoDate(new Date());
    const rounds = roundsByDate(areas, sessions, sets, bridge);
    const unconfirmed = areas.filter((a) => a.holds?.length && a.phase !== 'unknown'
      && (a.timingConfirmed === false || a.timesConfirmed === false || a.holds.some((h) => h.timingConfirmed === false)));
    const confirmArea = (a, extra = {}) => ({ ...a, ...extra, timingConfirmed: true, timesConfirmed: true, timingConfirmedOn: today, holds: a.holds.map((h) => ({ ...h, timingConfirmed: true })) });
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/train">Back</a></div>
      <h1 class="view-title">Tendon holds</h1>
      <p class="hint">Your rules: hold at least 30 seconds, 3 sets, using the movement that hurts. Pain up to 3-4 out of 10 is fine if it isn't worse the next day; if it is, use less weight or push less hard.</p>
      ${unconfirmed.length ? `<section class="card pad-card confirm-card"><div class="hud c-amber">CONFIRM YOUR HOLD TIMES (FIRST TIME)</div>
        ${unconfirmed.map((a) => `<p class="hint c-text"><b>${esc(a.label)}:</b> ${esc(TIMING[a.id] || '')}</p>`).join('')}
        <div class="btn-row"><button class="btn-primary" id="t-ok" type="button">Confirm</button><button class="btn-ghost" id="t-change" type="button">Change</button></div></section>` : ''}
      ${areas.filter((a) => a.holds?.length).map((a) => {
        const st = areaStatus(a, rounds[a.id] || {}, today);
        return `<section class="card pad-card">
          <div class="ex-head"><b class="area-name">${esc(a.label)}</b><span class="hud ${st.due ? 'c-amber' : 'c-green'}">${esc(st.text.toUpperCase())}</span></div>
          <div class="hint">${esc(PHASE_TEXT[a.phase] || '')}</div>
          ${a.holds.map((h, i) => `<div class="hold-row"><div><b>${esc(h.exercise)}</b><div class="hint">${esc(loadText(h))} · ${h.sets || 3} × ${h.seconds || 30} s${h.where ? ` · ${esc(h.where)}` : ''}</div></div>
            <a class="pill is-on" href="#/holds/${esc(a.id)}/${i}">Start</a></div>`).join('')}
        </section>`;
      }).join('')}`;
    const ok = view.querySelector('#t-ok');
    if (ok) {
      ok.onclick = async () => {
        for (const a of unconfirmed) await repo.put('tendons', `area.${a.id}`, confirmArea(a));
        toast('Hold times confirmed.');
        draw();
      };
      view.querySelector('#t-change').onclick = async () => {
        const text = await promptText('What should change?', '', { placeholder: 'e.g. shoulder holds only after Push' });
        if (!text) return;
        for (const a of unconfirmed) await repo.put('tendons', `area.${a.id}`, confirmArea(a, { timingNote: { text, on: today } }));
        toast('Saved. The schedule follows your note from step 4.');
        draw();
      };
    }
  };
  draw();
}

function renderRun(view, repo, areaId, index) {
  let area; let hold; let session = null; let setNo = 1; let phase = 'ready'; let endsAt = 0; let timer = null; let startedSet = 0; let endedSet = 0;
  const total = () => hold.sets || 3;
  const secs = () => hold.seconds || 30;

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
    clearInterval(timer);
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
    if (phase === 'ready' || phase === 'holding' || phase === 'rest') {
      const of = phase === 'rest' ? 120 : secs();
      const shown = phase === 'ready' ? secs() : left;
      body.innerHTML = `
        <div class="hold-ring">${ring(shown, of)}<div class="hold-ring-text"><b>${Math.floor(shown / 60)}:${String(Math.ceil(shown) % 60 === 0 && shown >= 60 ? 0 : Math.ceil(shown) % 60).padStart(2, '0')}</b>
          <span class="hud c-muted">${phase === 'rest' ? 'REST' : `SET ${setNo} OF ${total()}`}</span></div></div>
        <div class="btn-row">${phase === 'ready' ? `<button class="btn-primary big" data-h="go" type="button">Start set ${setNo}</button>`
          : phase === 'holding' ? '<button class="btn-primary big" data-h="end" type="button">End set</button>'
          : `<button class="btn-primary big" data-h="next" type="button">Start set ${setNo} now</button>`}</div>`;
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
        setNo++; phase = 'rest'; endsAt = Date.now() + 120000; tickLoop(); draw();
      });
    }
    body.querySelectorAll('[data-h]').forEach((b) => {
      if (b.dataset.h === 'go' || b.dataset.h === 'next') b.onclick = () => { rest.unlockAudio(); phase = 'holding'; startedSet = Date.now(); endsAt = startedSet + secs() * 1000; tickLoop(); draw(); };
      if (b.dataset.h === 'end') b.onclick = () => { clearInterval(timer); endedSet = Date.now(); rest.beep(1); phase = 'rate'; draw(); };
    });
  };

  const tickLoop = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (Date.now() >= endsAt) {
        clearInterval(timer);
        rest.beep(phase === 'holding' ? 3 : 2);
        if (phase === 'holding') endedSet = Date.now();
        phase = phase === 'holding' ? 'rate' : 'ready';
        draw();
        return;
      }
      const t = view.querySelector('.hold-ring-text b');
      const left = Math.max(0, (endsAt - Date.now()) / 1000);
      if (t) { t.textContent = `${Math.floor(left / 60)}:${String(Math.ceil(left) % 60 === 0 && left >= 60 ? 0 : Math.ceil(left) % 60).padStart(2, '0')}`; }
      const svg = view.querySelector('.hold-ring');
      if (svg) svg.firstElementChild.outerHTML = ring(left, phase === 'rest' ? 120 : secs());
    }, 200);
  };

  (async () => {
    const areas = await loadAreas(repo);
    area = areas.find((a) => a.id === areaId);
    hold = area?.holds?.[index];
    if (!hold) { view.innerHTML = '<h1 class="view-title">Hold not found</h1><p class="hint"><a href="#/holds">Back</a></p>'; return; }
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/holds">Back</a><span class="hud c-muted">${esc(area.label.toUpperCase())} · ${esc((PHASE_TEXT[area.phase] || '').split(':')[0].toUpperCase())}</span></div>
      <div><h1 class="view-title">${esc(hold.exercise)}</h1><div class="hint">${esc(loadText(hold))} · ${total()} × ${secs()} s · about 2 min between</div></div>
      <div id="h-body"></div>
      <p class="hint">Next-day check: ${esc(tomorrow())}${area.phase === 'heal' ? ', with the morning round' : ''}.</p>
      <button class="btn-ghost" id="h-stop" type="button">End round</button>`;
    view.querySelector('#h-stop').onclick = async () => {
      if (phase === 'holding' && !(await confirmSheet('End the round now? The hold in progress is not saved.', { ok: 'End round' }))) return;
      finishRound();
    };
    draw();
  })();
  return () => clearInterval(timer);
}

export function render(view, params = []) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let cleanup = () => {};
  ready.then((repo) => {
    if (params[0] && params[1] != null) cleanup = renderRun(view, repo, params[0], Number(params[1])) || cleanup;
    else if (params[0]) location.replace('#/holds');
    else renderList(view, repo);
  });
  return () => cleanup();
}
