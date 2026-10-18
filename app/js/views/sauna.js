// SAUNA (brief section 11): a safety system first, a tracker second. Every safety rule and line here is the brief's;
// the app adds no medical advice. The ladder, the hard stops and the checklist are fixed rules.
//   #/sauna            today's step on the ladder, the doctor question when due, plan, history
//   #/sauna/check      the checklist before a session (or: skip today), then start
//   #/sauna/run/<id>   rounds: going in / out, the overdue alarm, I FEEL OFF, breaks with the symptom question,
//                      after the last round the 15-minutes-after question
//   #/sauna/settings   maintenance level, emergency contact, sauna name and usual temperature
import { ready, syncNow } from '../lib/data.js';
import { isoDate, formatTime, formatDay, formatDate, formatHm } from '../lib/time.js';
import {
  LADDER, GOAL_STEP, PASSES_TO_UNLOCK, OVERDUE_MIN, SYMPTOMS, GET_OUT, CHECKLIST, DOCTOR_QUESTION, DOCTOR_ANSWERS,
  stepText, stepShort, ladderState, todayStep, doctorDue, gates, phaseOf, fluidLost, hadSymptoms, passed,
  feelOffState, endHereState, afterAnswerState, proposeSaunaDays, planSaunaDay, SAUNA_TIME,
} from '../lib/sauna.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL } from '../lib/rotation.js';
import { projectRotation, expectedOn } from '../lib/scans.js';
import { newId } from '../lib/routines.js';
import * as alarm from '../lib/alarm.js';
import { confirmSheet, promptTime } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const NOTE = 'Your own notes from videos, not medical advice. The ladder, the hard stops and this checklist are fixed rules.';

async function loadAll(repo) {
  const [sessions, plan] = await Promise.all([repo.list('sauna'), repo.get('sauna-plan', 'main')]);
  return { sessions, plan: plan || {} };
}
const savePlan = (repo, plan) => repo.put('sauna-plan', 'main', { id: 'main', ...plan });

/** Is a lifting session planned today and not done yet? (Never before lifting.) */
async function liftingLeft(repo) {
  const [sessions, bridge, dayList] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days')]);
  const today = isoDate(new Date());
  const rot = rotationDay({ last: lastRotationSession(sessions, bridge), today, days: daysByDate(dayList) });
  return { left: rot.today.kind === 'train', energy: daysByDate(dayList)[today]?.readiness?.ratings?.E ?? null };
}

/** The rotation ahead (for proposing sauna days): last session, day records, the next 8 days. */
async function schedule(repo) {
  const [sessions, bridge, dayList] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days')]);
  const days = daysByDate(dayList);
  const last = lastRotationSession(sessions, bridge);
  return { last, days, rotation: projectRotation({ last, days, from: isoDate(new Date()), n: 8 }) };
}

function suggestHtml(p) {
  if (!p.items.length) return `<p class="hint">Nothing to suggest this week: ${p.perWeek === 1 ? 'once a week at your level' : 'about two a week while building up'}, already planned or no day fits.</p>`;
  return `<div class="hud c-cyan">SUGGESTED · ${p.perWeek === 1 ? 'ONCE A WEEK AT YOUR LEVEL' : 'ABOUT TWO A WEEK WHILE BUILDING UP'}</div>
    ${p.items.map((x, i) => `<div class="ex-head"><span>${esc(formatDay(new Date(`${x.date}T12:00:00`)))}, ${esc(formatHm(x.time))} <span class="hint">${x.kind === 'rest' ? 'rest day' : `after ${esc(LABEL[x.dayType] || 'the session')}`}</span></span><button class="pill" type="button" data-plan-i="${i}">Plan</button></div>`).join('')}
    <p class="hint">Rest days first; never before lifting. You decide.</p>
    ${p.items.length > 1 ? '<button class="btn-ghost small" id="s-plan-all" type="button">Plan all</button>' : ''}`;
}

function ladderHtml(step) {
  return `<ol class="sauna-ladder">${LADDER.map((s, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-now' : ''}"><span>${stepShort(i)}</span></li>`).join('')}</ol>`;
}

function doctorCard(ctx) {
  return `<section class="card pad-card confirm-card" id="doc"><div class="hud c-amber">${ctx === 'first' ? 'BEFORE YOUR FIRST SESSION' : ctx === 'past-two-rounds' ? 'BEFORE GOING PAST TWO ROUNDS' : 'AFTER TWO SESSIONS WITH SYMPTOMS'}</div>
    <p class="c-text">${esc(DOCTOR_QUESTION)}</p><p class="hint">Your answer is recorded. The app gives no other medical advice.</p>
    <div class="btn-row">${DOCTOR_ANSWERS.map(([v, l]) => `<button class="btn-ghost small" type="button" data-doc="${v}">${esc(l)}</button>`).join('')}</div></section>`;
}

function renderHome(view, repo, alive) {
  const draw = async () => {
    const today = isoDate(new Date());
    const { sessions, plan } = await loadAll(repo);
    if (!alive()) return;
    const st = ladderState(sessions, today, plan);
    const active = sessions.find((s) => s.status === 'active');
    const afterOpen = sessions.filter((s) => ['done', 'ended'].includes(s.status) && s.after && !s.after.answeredAt).sort((a, b) => b.startedAt - a.startedAt)[0];
    const doc = doctorDue(plan, st, st.step);
    const history = sessions.filter((s) => s.status !== 'active').sort((a, b) => b.startedAt - a.startedAt);
    const planned = (plan.planned || []).filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const sched = await schedule(repo);
    const proposal = proposeSaunaDays({ sessions, plan, rotation: projectRotation({ last: sched.last, days: sched.days, from: today, n: 8 }), days: sched.days, today });
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel">Fuel</a><a class="pill" href="#/sauna/settings">Settings</a></div>
      <h1 class="view-title">Sauna</h1>
      <p class="hint">${esc(NOTE)}</p>
      ${active ? `<a class="card confirm-card sauna-resume" href="#/sauna/run/${esc(active.id)}"><span class="hud c-amber">SESSION IN PROGRESS</span><span>Open it</span></a>` : ''}
      ${afterOpen ? `<a class="card confirm-card sauna-resume" href="#/sauna/run/${esc(afterOpen.id)}"><span class="hud c-amber">15 MINUTES AFTER</span><span>${Date.now() >= afterOpen.after.dueAt ? 'Any symptoms? Answer now.' : `I'll ask at ${esc(formatTime(new Date(afterOpen.after.dueAt)))}.`}</span></a>` : ''}
      <section class="card pad-card sauna-step">
        <div class="hud c-muted">TODAY'S STEP${Number.isInteger(plan.maintenanceStep) && st.step === st.cap ? ' · YOUR MAINTENANCE LEVEL' : ''}</div>
        <b class="sauna-big">${esc(stepText(st.step))}</b>
        <span class="hint">Clean sessions in a row at this step: ${st.passes} of ${PASSES_TO_UNLOCK}${st.step < st.cap ? `. Then: ${esc(stepShort(st.step + 1))}.` : st.step === GOAL_STEP ? '. This is the goal.' : '.'}</span>
        ${st.reasons.map((r) => `<span class="hint c-amber">${esc(r)}</span>`).join('')}
        ${ladderHtml(st.step)}
      </section>
      ${doc ? doctorCard(doc) : ''}
      ${active ? '' : `<a class="btn-primary center big" href="#/sauna/check" id="s-start" ${doc ? 'aria-disabled="true" style="opacity:.45;pointer-events:none"' : ''}>Before a session: checklist</a>`}
      <div class="section-label">Planned · ${planned.length}</div>
      <section class="card pad-card">${planned.map((p, i) => `<div class="ex-head"><span>${esc(formatDay(new Date(`${p.date}T12:00:00`)))}${p.time ? `, ${formatHm(p.time)}` : ''}</span><button class="link-btn" type="button" data-unplan="${i}">Remove</button></div>`).join('') || '<p class="hint">No sauna days planned.</p>'}
        <div id="s-suggest">${suggestHtml(proposal)}</div>
        <p class="hint">Your usual sauna time: <button class="link-btn" id="s-time" type="button">${esc(formatHm(proposal.time))}</button></p>
        <p class="hint">While building up, two or three short sessions a week on separate days; the goal is once a week. Your call. Never before lifting.</p>
        <button class="btn-ghost" type="button" id="s-plan">Plan a sauna day</button></section>
      <div class="section-label">History · ${history.length}</div>
      <ul class="lib-list">${history.map((s) => `<li class="lib-row sauna-hist"><span class="lib-name">${esc(formatDate(new Date(s.startedAt)))}</span>
        <span class="lib-meta">${esc(stepShort(s.stepIndex))}${s.hotter ? ' · hotter sauna' : ''} · ${(s.rounds || []).filter((r) => r.outAt).map((r) => `${Math.round((r.outAt - r.inAt) / 60000)} min`).join(', ') || 'no rounds'}${s.tempC ? ` · ${s.tempC}°C` : ''}</span>
        <span class="lib-meta ${hadSymptoms(s) ? 'c-red' : passed(s) ? 'c-green' : 'c-amber'}">${hadSymptoms(s) ? `Stopped: ${esc([...(s.symptoms || []).flatMap((x) => x.what), ...(s.after?.what || [])].join(', ') || 'symptoms')}` : passed(s) ? 'Clean' : s.after && !s.after.answeredAt ? 'After-question open' : 'Not completed as planned'}</span>
        <button class="link-btn" type="button" data-del="${esc(s.id)}">Delete (a test, not a real session)</button></li>`).join('') || '<li class="hint pad">No sessions yet.</li>'}</ul>`;
    view.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
      await savePlan(repo, { ...plan, doctor: [...(plan.doctor || []), { at: Date.now(), answer: b.dataset.doc, context: doc }] });
      toast('Answer recorded.');
    }));
    view.querySelector('#s-plan').onclick = async () => {
      const { overlay } = await import('../ui/sheet.js');
      const { el, close } = overlay(`<form class="sheet-form"><div class="hud c-muted sheet-title">PLAN A SAUNA DAY</div>
        <input class="input" type="date" id="pd" min="${today}" value="${today}" required><input class="input" type="time" id="pt" value="${esc(plan.time || SAUNA_TIME)}" required>
        <p class="hint">A reminder comes at that time with the day's step and the checklist.</p>
        <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Plan it</button></div></form>`);
      el.querySelector('[data-cancel]').onclick = () => close();
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = el.querySelector('#pd').value; const time = el.querySelector('#pt').value;
        const sc = await schedule(repo); // fresh: a session time may have been set since the screen was drawn
        const exp = date >= today ? expectedOn({ last: sc.last, days: sc.days, today, date }) : null;
        const r = planSaunaDay(plan, { date, time }, { today, kind: exp?.kind, sessionTime: sc.days[date]?.sessionTime || null });
        if (r.error) { toast(r.error); return; }
        await savePlan(repo, r.plan);
        close();
      });
    };
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmSheet('Delete this sauna session? Only for a test: a real session, symptoms included, belongs in the ladder.', { ok: 'Delete', danger: true }))) return;
      await repo.remove('sauna', b.dataset.del);
    }));
    // A9: proposed days (rest days first, never before lifting); he plans each, or all.
    const planOne = async (d) => {
      const cur = (await loadAll(repo)).plan;
      const sc = await schedule(repo);
      const exp = expectedOn({ last: sc.last, days: sc.days, today, date: d.date });
      const r = planSaunaDay(cur, d, { today, kind: exp?.kind, sessionTime: sc.days[d.date]?.sessionTime || null });
      if (r.error) { toast(r.error); return; }
      await savePlan(repo, r.plan);
    };
    view.querySelectorAll('[data-plan-i]').forEach((b) => b.addEventListener('click', () => planOne(proposal.items[Number(b.dataset.planI)])));
    const all = view.querySelector('#s-plan-all');
    if (all) all.onclick = async () => { for (const d of proposal.items) await planOne(d); toast('Planned. A reminder comes at each time with the step and the checklist.'); };
    view.querySelector('#s-time').onclick = async () => {
      const hm = await promptTime('Your usual sauna time', proposal.time);
      if (hm) await savePlan(repo, { ...(await loadAll(repo)).plan, time: hm });
    };
    view.querySelectorAll('[data-unplan]').forEach((b) => b.addEventListener('click', async () => {
      const p = planned[Number(b.dataset.unplan)];
      await savePlan(repo, { ...plan, planned: (plan.planned || []).filter((x) => x.date !== p.date) });
    }));
  };
  draw();
  return repo.onChange((cols) => { if (cols.some((c) => ['sauna', 'sauna-plan', 'days', 'sessions'].includes(c))) draw(); });
}

function renderCheck(view, repo, alive) {
  const ticks = {}; let hotter = false; let lower = null;
  const draw = async () => {
    const today = isoDate(new Date());
    const [{ sessions, plan }, lift] = await Promise.all([loadAll(repo), liftingLeft(repo)]);
    if (!alive()) return;
    if (sessions.some((s) => s.status === 'active')) { location.hash = `#/sauna/run/${sessions.find((s) => s.status === 'active').id}`; return; }
    const st = ladderState(sessions, today, plan);
    if (lift.energy != null) ticks.energy = lift.energy >= 2;
    const proposed = todayStep(st, { hotter });
    const step = lower != null && lower < proposed ? lower : proposed;
    const doc = doctorDue(plan, st, step);
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/sauna">Sauna</a><span class="hud c-muted">${esc(formatDay(new Date()).toUpperCase())}</span></div>
      <h1 class="view-title">Before a session</h1>
      <p class="hint">Tick every line, or skip today. ${esc(NOTE)}</p>
      ${lift.left ? '<section class="card pad-card confirm-card"><div class="hud c-red">NEVER BEFORE LIFTING</div><p class="c-text">A lifting session is planned today and not done yet. Train first, or make today a rest day.</p></section>' : ''}
      <section class="card sauna-check">${CHECKLIST.map((c) => {
        const fromCheckin = c.id === 'energy' && lift.energy != null;
        if (c.optional) {
          return `<div class="sauna-tick"><span>${esc(c.text)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>
            <span class="seg"><button class="pill ${ticks[c.id] === 'yes' ? 'is-on' : ''}" type="button" data-opt="yes">Yes</button><button class="pill ${ticks[c.id] === 'not-possible' ? 'is-on' : ''}" type="button" data-opt="not-possible">Not possible</button></span></div>`;
        }
        return `<button class="sauna-tick ${ticks[c.id] ? 'is-on' : ''}" type="button" data-tick="${c.id}" ${fromCheckin ? 'disabled' : ''} aria-pressed="${!!ticks[c.id]}">
          <span>${esc(c.text)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}${fromCheckin ? `<small>From today's check-in: energy ${lift.energy}.</small>` : ''}</span><i class="sauna-box" aria-hidden="true">${ticks[c.id] ? '✓' : ''}</i></button>`;
      }).join('')}</section>
      <section class="card pad-card sauna-opts">
        <button class="sauna-tick ${hotter ? 'is-on' : ''}" type="button" id="c-hot" aria-pressed="${hotter}"><span>This sauna is clearly hotter than usual<small>Then today is two steps back and doesn't count towards the next step.</small></span><i class="sauna-box" aria-hidden="true">${hotter ? '✓' : ''}</i></button>
        <label class="opt"><span>Sauna temperature (°C), if shown</span><input class="input mini num" id="c-temp" inputmode="decimal" value="${plan.usualTempC ?? ''}"></label>
        <label class="opt"><span>Weigh-in before (kg), optional</span><input class="input mini num" id="c-kg" inputmode="decimal"></label>
        <label class="opt"><span>Step today</span><select class="input mini" id="c-step">${LADDER.slice(0, proposed + 1).map((_, i) => `<option value="${i}" ${i === step ? 'selected' : ''}>${esc(stepShort(i))}${i === proposed ? ' (proposed)' : ''}</option>`).join('')}</select></label>
        <p class="hint">Proposed: ${esc(stepText(proposed))}. A lower step is fine; never a higher one.</p>
      </section>
      ${doc ? '<p class="hint c-amber">Answer the doctor question on the Sauna screen first.</p>' : ''}
      <div id="c-skip"></div>
      <button class="btn-primary big" type="button" id="c-go" ${doc ? 'disabled' : ''}>Start: ${esc(stepShort(step))}</button>`;
    view.querySelectorAll('[data-tick]').forEach((b) => b.addEventListener('click', () => { ticks[b.dataset.tick] = !ticks[b.dataset.tick]; draw(); }));
    view.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => { ticks.company = b.dataset.opt; draw(); }));
    view.querySelector('#c-hot').onclick = () => { hotter = !hotter; lower = null; draw(); };
    view.querySelector('#c-step').onchange = (e) => { lower = Number(e.target.value); draw(); };
    view.querySelector('#c-go').onclick = async () => {
      const why = gates({ ticks, energy: lift.energy, liftingLeft: lift.left });
      if (why.length) {
        view.querySelector('#c-skip').innerHTML = `<section class="card pad-card confirm-card sauna-skip"><div class="hud c-red">SKIP TODAY</div>${why.map((w) => `<p class="c-text">${esc(w)}</p>`).join('')}<p class="hint">Your rule: tick every line before a session, or skip today.</p></section>`;
        view.querySelector('#c-skip').scrollIntoView({ block: 'center' });
        return;
      }
      const num = (sel) => { const v = Number(view.querySelector(sel).value.replace(',', '.')); return view.querySelector(sel).value.trim() && Number.isFinite(v) ? v : null; };
      const s = LADDER[step];
      const id = newId('sauna');
      await repo.put('sauna', id, {
        id, date: today, startedAt: Date.now(), endedAt: null, stepIndex: step, proposedStep: proposed, plannedRounds: s.rounds, roundMin: s.min, hotter, tempC: num('#c-temp'),
        saunaName: plan.saunaName || '', status: 'active', checklist: { ...ticks }, energy: lift.energy, rounds: [], breaks: [], symptoms: [], after: null,
        weighIn: num('#c-kg') != null ? { beforeKg: num('#c-kg'), afterKg: null } : null, note: '',
      });
      syncNow();
      location.hash = `#/sauna/run/${id}`;
    };
  };
  draw();
  return () => {};
}

function renderRun(view, repo, alive, id) {
  let s = null; let plan = {}; let timer = null; let wake = null; let felt = new Set(); let stoppedView = false;
  const save = async (next) => { s = next; await repo.put('sauna', s.id, s); syncNow(); };
  const keepAwake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ } };
  const onVis = () => { if (s?.status === 'active') keepAwake(); };
  document.addEventListener('visibilitychange', onVis);

  const feelOff = async (when = 'button') => {
    alarm.stop();
    await save(feelOffState(s, { when }));
    stoppedView = true;
    draw();
  };

  const draw = async () => {
    if (!s) { s = await repo.get('sauna', id); plan = (await repo.get('sauna-plan', 'main')) || {}; }
    if (!alive()) return;
    if (!s) { view.innerHTML = '<div class="lib-head"><a class="pill" href="#/sauna">Sauna</a></div><p class="hint">Not found.</p>'; return; }
    const now = Date.now();
    const ph = s.status === 'active' ? phaseOf(s, now) : { phase: s.status };
    const total = s.plannedRounds;
    const offBtn = s.status === 'active' ? '<button class="sauna-off" type="button" id="r-off">I FEEL OFF</button>' : '';
    let body = '';
    if (s.status === 'stopped' || stoppedView) {
      const last = (s.symptoms || []).at(-1) || { what: [] };
      body = `<section class="sauna-stop"><div class="sauna-stop-title">GET OUT NOW</div><p>${esc(GET_OUT)}</p></section>
        <p class="hint">The session has ended. Next time the ladder goes back a step (your rule).</p>
        <div class="section-label">What did you feel?</div>
        <div class="chips sauna-felt">${SYMPTOMS.map((x) => `<button class="chip ${felt.has(x) || last.what.includes(x) ? 'is-on' : ''}" type="button" data-felt="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <button class="btn-ghost" type="button" id="r-felt">Save what I felt</button>
        <a class="btn-ghost center" href="#/sauna">Done</a>`;
    } else if (ph.phase === 'ready') {
      body = `<div class="hud c-cyan">ROUND ${1} OF ${total}</div><div class="sauna-big-time">${s.roundMin} MINUTES</div>
        <p class="c-text">Phone stays outside. Use the sauna's own clock or sand timer: ${s.roundMin} minutes.</p>
        <p class="hint">For the last minute, sit on the lowest bench, then stand up slowly.</p>
        <button class="btn-primary big" type="button" id="r-in">GOING IN</button>`;
    } else if (ph.phase === 'in') {
      const r = s.rounds.find((x) => !x.outAt);
      const left = ph.plannedEnd - now;
      body = `<div class="sauna-in ${ph.overdue ? 'is-overdue' : ''}"><div class="hud ${ph.overdue ? '' : 'c-cyan'}">IN THE SAUNA · ROUND ${r.n} OF ${total} · ${r.planned} MIN</div>
        <div class="sauna-big-time" id="r-clock">${ph.over ? `+${mmss(now - ph.plannedEnd)}` : mmss(left)}</div>
        <p>${ph.overdue ? `OVERDUE. ${OVERDUE_MIN} minutes past your time. Tap OUT.` : ph.over ? "Time's up. Come out slowly." : `Out by ${esc(formatTime(new Date(ph.plannedEnd)))}. Alarm at ${esc(formatTime(new Date(ph.overdueAt)))} if you haven't tapped out.`}</p>
        ${left <= 60000 && !ph.over ? '<p class="c-amber">Last minute: sit on the lowest bench, then stand up slowly.</p>' : ''}
        ${ph.overdue && plan.emergency?.phone ? `<a class="btn-ghost center" href="tel:${esc(plan.emergency.phone.replace(/[^\d+]/g, ''))}">Call ${esc(plan.emergency.name || plan.emergency.phone)}</a>` : ''}
        ${alarm.armed() ? '' : '<button class="btn-ghost" type="button" id="r-arm">Tap to arm the overdue alarm (the app was reopened)</button>'}
        <button class="btn-primary big sauna-out" type="button" id="r-out">OUT</button></div>`;
    } else if (ph.phase === 'break') {
      const br = s.breaks.find((b) => b.after === ph.round);
      const next = ph.round + 1;
      body = `<div class="hud c-cyan">BREAK AFTER ROUND ${ph.round} OF ${total}</div><div class="sauna-big-time" id="r-clock">${mmss(ph.breakEnd - now)}</div>
        <p class="c-text">Sit down outside and drink. No cold water in the break; a normal shower is fine.</p>
        ${br?.symptoms == null ? `<div class="section-label">Any symptoms?</div><div class="btn-row"><button class="btn-ghost big" type="button" id="r-sym-yes">Yes</button><button class="btn-primary big" type="button" id="r-sym-no">No</button></div>`
          : `<p class="hint c-green">No symptoms: round ${next} unlocks when the break is over.</p>
            <button class="btn-primary big" type="button" id="r-next" ${ph.ready ? '' : 'disabled'}>Round ${next} of ${total} · ${s.roundMin} min · GOING IN</button>`}
        <p class="hint">For the last minute of a round, sit on the lowest bench, then stand up slowly.</p>
        <button class="link-btn" type="button" id="r-end">End here (no symptoms)</button>`;
    } else {
      // Done or ended: sit, drink, and the question 15 minutes later.
      const a = s.after || {};
      const lost = fluidLost(s.weighIn);
      const due = now >= (a.dueAt ?? 0);
      body = `<div class="hud c-green">${s.status === 'done' ? 'ALL ROUNDS DONE' : 'SESSION ENDED'}</div>
        <p class="c-text">Sit for a few minutes before walking off, and drink.</p>
        ${a.answeredAt ? `<p class="hint ${a.symptoms ? 'c-red' : 'c-green'}">15 minutes after: ${a.symptoms ? `symptoms (${esc((a.what || []).join(', ') || 'noted')}). ${esc(GET_OUT)}` : 'no symptoms.'}</p>`
          : due ? `<section class="card pad-card confirm-card" id="r-after"><div class="hud c-amber">15 MINUTES AFTER</div><p class="c-text">Any symptoms now?</p>
              <div class="btn-row"><button class="btn-ghost big" type="button" id="r-a-yes">Yes</button><button class="btn-primary big" type="button" id="r-a-no">No</button></div></section>`
            : `<p class="hint">I'll ask once more at ${esc(formatTime(new Date(a.dueAt)))} (15 minutes after), because last time it hit you after you got out. <span id="r-clock">${mmss(a.dueAt - now)}</span></p>`}
        ${a.symptoms === true && !a.what?.length ? `<div class="chips sauna-felt">${SYMPTOMS.map((x) => `<button class="chip ${felt.has(x) ? 'is-on' : ''}" type="button" data-felt="${esc(x)}">${esc(x)}</button>`).join('')}</div><button class="btn-ghost" type="button" id="r-a-felt">Save what I felt</button>` : ''}
        <label class="opt"><span>Weigh-in after (kg), optional</span><input class="input mini num" id="r-kg" inputmode="decimal" value="${s.weighIn?.afterKg ?? ''}"></label>
        ${lost != null ? `<p class="c-text">${lost} kg lost: about ${lost} litres to drink back.</p>` : ''}
        <label class="opt"><span>Note</span><input class="input" id="r-note" value="${esc(s.note || '')}" maxlength="300"></label>
        <a class="btn-ghost center" href="#/sauna">Back to Sauna</a>`;
    }
    view.innerHTML = `<div class="lib-head"><a class="pill" href="#/sauna">Sauna</a><span class="hud c-muted">${esc(stepShort(s.stepIndex))}${s.hotter ? ' · HOTTER SAUNA' : ''}</span></div>
      <div class="sauna-run">${body}</div>${offBtn}`;

    const $ = (q) => view.querySelector(q);
    if ($('#r-off')) $('#r-off').onclick = () => feelOff('button');
    if ($('#r-in')) $('#r-in').onclick = async () => {
      alarm.arm(); keepAwake();
      await save({ ...s, rounds: [...s.rounds, { n: 1, planned: s.roundMin, inAt: Date.now(), outAt: null }] });
      draw();
    };
    if ($('#r-arm')) $('#r-arm').onclick = () => { alarm.arm(); keepAwake(); draw(); };
    if ($('#r-out')) $('#r-out').onclick = async () => {
      alarm.stop();
      const now2 = Date.now();
      const rounds = s.rounds.map((r) => (!r.outAt ? { ...r, outAt: now2 } : r));
      const n = rounds.filter((r) => r.outAt).length;
      if (n >= s.plannedRounds) await save({ ...s, rounds, status: 'done', endedAt: now2, after: { dueAt: now2 + 15 * 60000, answeredAt: null, symptoms: null, what: [] } });
      else await save({ ...s, rounds, breaks: [...s.breaks, { after: n, startAt: now2, endAt: null, symptoms: null }] });
      draw();
    };
    if ($('#r-sym-no')) $('#r-sym-no').onclick = async () => {
      await save({ ...s, breaks: s.breaks.map((b) => (b.symptoms == null ? { ...b, symptoms: false, answeredAt: Date.now() } : b)) });
      draw();
    };
    if ($('#r-sym-yes')) $('#r-sym-yes').onclick = () => feelOff('break');
    if ($('#r-next')) $('#r-next').onclick = async () => {
      alarm.arm(); keepAwake();
      const n = s.rounds.length + 1;
      await save({ ...s, breaks: s.breaks.map((b) => (b.after === n - 1 ? { ...b, endAt: Date.now() } : b)), rounds: [...s.rounds, { n, planned: s.roundMin, inAt: Date.now(), outAt: null }] });
      draw();
    };
    if ($('#r-end')) $('#r-end').onclick = async () => {
      if (!(await confirmSheet('End the session here, with no symptoms?', { ok: 'End here' }))) return;
      await save(endHereState(s));
      draw();
    };
    view.querySelectorAll('[data-felt]').forEach((b) => b.addEventListener('click', () => { const x = b.dataset.felt; if (felt.has(x)) felt.delete(x); else felt.add(x); b.classList.toggle('is-on'); }));
    if ($('#r-felt')) $('#r-felt').onclick = async () => {
      const sym = [...s.symptoms]; sym[sym.length - 1] = { ...sym.at(-1), what: [...felt] };
      await save({ ...s, symptoms: sym });
      toast('Saved.');
    };
    if ($('#r-a-no')) $('#r-a-no').onclick = async () => { await save(afterAnswerState(s, { symptoms: false })); draw(); };
    if ($('#r-a-yes')) $('#r-a-yes').onclick = async () => { await save(afterAnswerState(s, { symptoms: true })); draw(); };
    if ($('#r-a-felt')) $('#r-a-felt').onclick = async () => { await save({ ...s, after: { ...s.after, what: [...felt] } }); draw(); };
    $('#r-kg')?.addEventListener('change', async (e) => {
      const v = Number(e.target.value.replace(',', '.'));
      await save({ ...s, weighIn: { beforeKg: s.weighIn?.beforeKg ?? null, afterKg: e.target.value.trim() && Number.isFinite(v) ? v : null } });
      draw();
    });
    $('#r-note')?.addEventListener('change', (e) => save({ ...s, note: e.target.value.trim() }));
  };

  // The clock: timers on screen, the overdue alarm (loud and continuous until OUT), the after question when due.
  // The screen is redrawn only when the phase changes (time's up, overdue, last minute, break over, question due).
  let key = '';
  const keyOf = (ph, now) => (ph.phase === 'in' ? `in|${ph.over}|${ph.overdue}|${ph.plannedEnd - now <= 60000}` : ph.phase === 'break' ? `break|${ph.ready}` : ph.phase);
  const tick = () => {
    if (!s || !alive()) return;
    const now = Date.now();
    const clock = view.querySelector('#r-clock');
    if (s.status === 'active') {
      const ph = phaseOf(s, now);
      if (ph.phase === 'in' && ph.overdue && !alarm.ringing()) alarm.start();
      const k = keyOf(ph, now);
      if (k !== key) { key = k; draw(); return; }
      if (clock && ph.phase === 'in') clock.textContent = ph.over ? `+${mmss(now - ph.plannedEnd)}` : mmss(ph.plannedEnd - now);
      if (clock && ph.phase === 'break') clock.textContent = mmss(ph.breakEnd - now);
    } else if (s.after && !s.after.answeredAt) {
      const k = `after|${now >= s.after.dueAt}`;
      if (k !== key) { key = k; draw(); return; }
      if (clock) clock.textContent = mmss(s.after.dueAt - now);
    }
  };
  draw().then(() => { timer = setInterval(tick, 500); if (s?.status === 'active' && phaseOf(s).phase === 'in') keepAwake(); });
  const off = repo.onChange(async (cols, origin) => {
    if (cols.includes('sauna-plan')) plan = (await repo.get('sauna-plan', 'main')) || {};
    // Changed elsewhere (the coach recorded symptoms or ended it from the Mac): follow it; a stop silences the alarm.
    if (origin === 'remote' && cols.includes('sauna')) {
      const next = await repo.get('sauna', id);
      if (!next || !alive()) return;
      const wasActive = s?.status === 'active';
      s = next;
      if (s.status !== 'active') { alarm.stop(); if (wasActive && s.status === 'stopped') stoppedView = true; }
      key = ''; draw();
    }
  });
  return () => { clearInterval(timer); alarm.stop(); off(); document.removeEventListener('visibilitychange', onVis); wake?.release?.().catch(() => {}); };
}

function renderSettings(view, repo, alive) {
  const draw = async () => {
    const { sessions, plan } = await loadAll(repo);
    if (!alive()) return;
    const st = ladderState(sessions, isoDate(new Date()), { ...plan, maintenanceStep: null });
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/sauna">Sauna</a></div>
      <h1 class="view-title">Sauna settings</h1>
      <section class="card opt-list">
        <label class="opt"><span>Maintenance level<small>You can stop the ladder at any step and make it your level: once a week there; a missed week repeats it.</small></span>
          <select class="input mini" id="ss-maint"><option value="">None (climb to 4 × 30)</option>${LADDER.map((_, i) => `<option value="${i}" ${plan.maintenanceStep === i ? 'selected' : ''} ${i > st.step ? 'disabled' : ''}>${esc(stepShort(i))}</option>`).join('')}</select></label>
        <label class="opt"><span>Which sauna</span><input class="input" id="ss-name" value="${esc(plan.saunaName || '')}" maxlength="60" placeholder="name"></label>
        <label class="opt"><span>Its usual temperature (°C)</span><input class="input mini num" id="ss-temp" inputmode="decimal" value="${plan.usualTempC ?? ''}"></label>
        <label class="opt"><span>Emergency contact on the overdue alarm<small>Optional. Shown as a Call button when the alarm goes off.</small></span>
          <span class="row-fields"><input class="input" id="ss-ename" value="${esc(plan.emergency?.name || '')}" placeholder="name" maxlength="40"><input class="input" id="ss-ephone" type="tel" value="${esc(plan.emergency?.phone || '')}" placeholder="phone" maxlength="30"></span></label>
      </section>
      <button class="btn-primary" type="button" id="ss-save">Save</button>
      ${(plan.doctor || []).length ? `<div class="section-label">Doctor question: your answers</div><section class="card pad-card">${plan.doctor.map((d) => `<p class="hint">${esc(formatDate(new Date(d.at)))}: ${esc(DOCTOR_ANSWERS.find(([v]) => v === d.answer)?.[1] || d.answer)}</p>`).join('')}</section>` : ''}`;
    view.querySelector('#ss-save').onclick = async () => {
      const m = view.querySelector('#ss-maint').value;
      const t = view.querySelector('#ss-temp').value.trim();
      const ename = view.querySelector('#ss-ename').value.trim(); const ephone = view.querySelector('#ss-ephone').value.trim();
      await savePlan(repo, { ...plan, maintenanceStep: m === '' ? null : Number(m), saunaName: view.querySelector('#ss-name').value.trim(), usualTempC: t && Number.isFinite(Number(t)) ? Number(t) : null, emergency: ephone ? { name: ename, phone: ephone } : null });
      toast('Saved.');
      location.hash = '#/sauna';
    };
  };
  draw();
  return () => {};
}

export function render(view, params) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  ready.then((repo) => {
    if (!alive) return;
    const a = () => alive;
    off = params[0] === 'check' ? renderCheck(view, repo, a)
      : params[0] === 'run' ? renderRun(view, repo, a, params[1])
        : params[0] === 'settings' ? renderSettings(view, repo, a)
          : renderHome(view, repo, a);
  });
  return () => { alive = false; off?.(); };
}
