// TODAY: home screen, design option E ("AI core").
// Phone: one column. Mac (wide screens): corner-bracket readouts on both sides of the core.
import { coreSvg } from '../ui/core.js';
import { toast } from '../ui/toast.js';
import { getState, subscribe } from '../lib/store.js';
import { formatTime, formatTimeSec, weekdayShort, isoDate, isoWeek, gmtOffset, formatDay, formatHm, addMinutesHm, deviceTimeZone } from '../lib/time.js';
import { checkInLead } from '../lib/reminders.js';
import { withDefaults } from '../lib/settings.js';
import { ready, saveSettings } from '../lib/data.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL, REST_TEXT, sessionTomorrow, afterRestDay, addDays } from '../lib/rotation.js';
import { fastingOn } from '../lib/fast.js';
import { weekColumn } from '../lib/programme.js';
import { roundsByDate, holdSlots, restChoices, openSlots } from '../lib/holds.js';
import { logMealFromFile, cameraInput } from './meal.js';
import { dayTotals } from '../lib/meals.js';
import { checklist, dayKindFrom } from '../lib/supplements.js';
import { wakingDayAt } from '../lib/waking-day.js';
import { stepsToday, healthAsOf } from './body.js';
import { runShortcutUrl } from './body-health.js';
import { MODEL_LABEL, todayCounts } from '../lib/coach.js';
import * as voice from '../lib/voice.js';
import { elapsedMs, nextSetText } from '../lib/session.js';
import { planFor, isDone, cadenceOf } from '../lib/scans.js';

const CAMERA = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
const CHECK = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>`;
const MIC = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

const LATER = {
  talk: 'Voice arrives in step 9, after you calibrate it to your voice.',
};

function weekColumnsLine(s) {
  const w = s.programme?.weekColumns;
  if (!w) return s.paired ? 'PROGRAMME NOT SYNCED YET' : 'NOT PAIRED WITH MAC';
  return `WEEK COLS · PULL ${w.pull} · PUSH ${w.push} · LEGS ${w.legs}`;
}

function macLine(s) {
  if (!s.paired) return { text: 'MAC · NOT PAIRED', cls: 'c-amber' };
  if (s.mac.reachable === false) {
    return { text: `MAC UNREACHABLE${s.mac.lastSeen ? ` · SEEN ${formatTime(new Date(s.mac.lastSeen))}` : ''}`, cls: 'c-amber' };
  }
  if (s.sync.lastAt) return { text: `SYNCED ${formatTime(new Date(s.sync.lastAt))}`, cls: 'c-cyan-dim' };
  return { text: 'MAC · CONNECTING', cls: 'c-muted' };
}

function spokeText(s) {
  if (!s.paired) return 'Not paired with your Mac yet. Pair once in Settings and your programme loads onto this phone.';
  const p = s.programme;
  if (!p) return 'Paired. Waiting for the first sync from your Mac.';
  return `Programme loaded: ${p.routineCount} routines, ${p.exerciseCount} exercises. Training, fuel and coaching arrive in the next steps.`;
}

function readout(cls, label, value, colorCls, key = '') {
  return `<div class="core-readout ${cls}"><span class="${colorCls}">${label}</span><br><span class="c-text"${key ? ` data-k="${key}"` : ''}>${value}</span></div>`;
}

const dayOf = (iso) => formatDay(new Date(`${iso}T12:00:00`));

/** Today's place in the rotation, for the TRAIN readout and the status line. */
async function trainToday(repo) {
  const [sessions, bridge, dayList, meta] = await Promise.all([repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days'), repo.get('programme', 'meta')]);
  const today = isoDate(new Date());
  const rot = rotationDay({ last: lastRotationSession(sessions, bridge), today, days: daysByDate(dayList) });
  const wk = weekColumn(meta?.firstSessions?.[rot.next.dayType], rot.next.date);
  const next = LABEL[rot.next.dayType];
  const t = rot.today;
  // Tendon holds planned today and how many are done (decisions 17, 18).
  const [tendons, sets] = await Promise.all([repo.list('tendons'), repo.list('sets')]);
  const areas = tendons.filter((d) => d.kind === 'area');
  const rounds = roundsByDate(areas, sessions, sets, bridge);
  const n = withDefaults(getState().settings).notify;
  const slots = holdSlots({ areas, dayKind: t.kind, dayType: t.kind === 'rest' ? null : t.dayType, roundsToday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[today] || 0])), times: { morning: n.holdsMorning, evening: n.holdsEvening }, restChoices: restChoices(daysByDate(dayList), today), nextSession: sessionTomorrow(rot, today), carriedFrom: afterRestDay(rot, today, daysByDate(dayList)), roundsYesterday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[addDays(today, -1)] || 0])) });
  const open = openSlots(slots).length;
  const holds = slots.length ? { readout: open ? `${open} OPEN` : slots.every((x) => x.skipped) ? 'SKIPPED' : 'DONE', progress: (slots.length - open) / slots.length } : { readout: 'NONE TODAY', progress: null };
  const hm = daysByDate(dayList)[rot.next.date]?.sessionTime;
  const at = hm ? ` at ${formatHm(hm)}` : '';
  const lead = hm ? checkInLead(daysByDate(dayList)[rot.next.date], rot.next.date, deviceTimeZone(), withDefaults(getState().settings).notify.readinessMin) : null;
  const check = hm ? (lead == null ? ' Check-in before you leave.' : ` Check-in at ${formatHm(addMinutesHm(hm, -lead))}.`) : ' No time set yet.';
  // Thu 10/22, his words: "I'm mid-workout right now, so I should track that. And since I haven't logged the Evolt scan
  // today, it should be there as well. It should ask." A workout in progress comes first; then a scan day with no scan.
  const scans = await repo.list('body-scans');
  const planDoc = (await repo.get('scan-plan', 'main')) || {};
  const scanPlan = planFor(planDoc, { scans, today, last: lastRotationSession(sessions, bridge), days: daysByDate(dayList) });
  const trainsToday = t.kind === 'train' || t.kind === 'done';
  // After the workout the planner's next scan is tomorrow: today stays a scan day on the every-training-day plan.
  const scanDay = scanPlan?.next?.date === today || (t.kind === 'done' && (cadenceOf(planDoc) === 'training' || planDoc.next?.date === today));
  const scanOpen = trainsToday && scanDay && !scans.some((x) => x.date === today && isDone(x));
  const scanAsk = scanOpen ? ' Evolt scan not logged today: did you do it?' : '';
  const active = sessions.find((x) => x.status === 'active' && x.kind !== 'holds');
  if (active) {
    const mine = sets.filter((x) => x.sessionId === active.id);
    const nextText = nextSetText(active, mine);
    const min = Math.floor(elapsedMs(active) / 60000);
    return {
      holds, readout: `${LABEL[active.dayType] || active.title || 'Workout'} · LIVE`, progress: mine.length ? mine.filter((x) => x.done).length / mine.length : 0, scan: scanOpen, live: active.id,
      line: `${LABEL[active.dayType] || active.title || 'Workout'} in progress, ${min} min. ${nextText ? `Next: ${nextText}.` : 'Every set ticked: finish it.'}${scanAsk}`,
    };
  }
  if (t.kind === 'train') return { holds, readout: `${next}${wk ? ` · WK ${wk}` : ''}`, progress: 0, scan: scanOpen, line: `Today: ${next}${at}${wk ? `, week ${wk} column` : ''}.${check}${scanAsk}` };
  const nextText = `Next: ${next}${at}, ${dayOf(rot.next.date)}${wk ? `, week ${wk} column` : ''}.${hm ? check : ''}`;
  if (t.kind === 'done') return { holds, readout: `${LABEL[t.dayType]} DONE`, progress: 1, scan: scanOpen, line: `${LABEL[t.dayType]} done today.${scanAsk} ${nextText}` };
  return { holds, readout: 'REST', progress: null, line: `${REST_TEXT[t.reason] || 'Rest day'}. ${nextText}` };
}

/** Today's kcal against the target and supplements taken, for the FUEL readout and the core's fuel ring. */
async function fuelToday(repo) {
  const [meals, estimates, plan, supps, slog, sessions, bridge, dayList] = await Promise.all([repo.list('meals'), repo.list('meal-estimates'), repo.get('fuel', 'plan'),
    repo.list('supplements'), repo.list('supp-log'), repo.list('sessions'), repo.get('bridge', 'last-loads'), repo.list('days')]);
  // His waking day (Sat 10/24): after midnight, before he has slept, the readout is still the day before's.
  const today = await wakingDayAt(repo);
  // A fasting day (Wed 10/21, his words: "it should be over there that I'm fast just for today"): no food target, no
  // supplement count; tomorrow is back to normal by itself (the fast belongs to its date).
  const fast = daysByDate(dayList)[today]?.fast;
  if (fastingOn(daysByDate(dayList), today, meals)) return { readout: `FASTING TODAY<br>SINCE ${formatTime(new Date(fast.at)).toUpperCase()}<br>NO FOOD OR SUPPS`, progress: null };
  const t = dayTotals(meals, estimates, today);
  const kcal = Math.round(t.kcal).toLocaleString('en-US');
  const due = checklist({ supps, log: slog, date: today, dayKind: dayKindFrom({ sessions, bridge, days: dayList, date: today, today: isoDate(new Date()) }) }).flatMap((g) => g.items);
  const supp = due.length ? `<br>SUPPS ${due.filter((i) => i.entry?.status === 'taken').length}/${due.length}` : '';
  if (!plan?.kcal) return { readout: `${kcal} KCAL${supp}`, progress: null };
  return { readout: `${kcal} / ${Number(plan.kcal).toLocaleString('en-US')} KCAL<br>${Math.round(t.protein)} G PROTEIN${supp}`, progress: Math.min(1, t.kcal / plan.kcal) };
}

export function render(view) {
  view.innerHTML = `
  <div class="home">
    <section class="home-side home-left" aria-label="Status">
      <div class="bracket-tl hud home-block">
        PRIVATE // SINGLE USER // LOCAL<br>
        <span class="c-cyan-dim" data-k="session">HQ</span><br>
        <span class="home-big">TODAY</span><br>
        <span class="c-faint">SUMMARY</span><br>
        <span data-k="weekcols"></span>
      </div>
      <a class="side-btn" href="#/settings">MAC LINK <span class="side-btn-plus" aria-hidden="true">›</span></a>
      <div class="bracket-bl hud home-block">
        <span data-k="mac"></span><br>
        <span class="c-cyan-dim" data-k="tz"></span>
      </div>
    </section>

    <section class="home-center">
      <div class="home-hud hud c-cyan">
        <div><span data-k="daytag"></span><br><span class="c-muted" data-k="tz"></span></div>
        <div class="right">REC <span data-k="clock"></span><br><span data-k="mac"></span></div>
        <div class="full c-amber" data-k="weekcols"></div>
      </div>

      <div class="core-wrap">
        <div data-k="core"></div>
        ${readout('tl', 'TENDONS', '—', 'c-muted', 'r-tendons')}
        ${readout('tr', 'TRAIN', '—', 'c-amber', 'r-train')}
        ${readout('bl', 'STEPS', '—', 'c-cyan', 'r-steps')}
        ${readout('br', 'FUEL', '—', 'c-green', 'r-fuel')}
      </div>

      <div class="home-status hud">
        <span class="c-muted" data-k="voice">VOICE · OFF</span>
        <button class="model-chip" data-k="model" id="t-model" type="button" aria-label="Switch the coach between Sonnet and Opus">SONNET 5.5 · MEDIUM</button>
      </div>

      <section class="card spoke">
        <div class="hud c-muted spoke-head"><span>STATUS</span><span data-k="clock-short"></span></div>
        <p class="spoke-text" data-k="spoke"></p>
        <div class="spoke-actions" data-k="spoke-actions"></div>
      </section>

      <div class="dock">
        <label class="dock-btn file-btn" for="t-cam">${CAMERA}LOG MEAL</label>${cameraInput('t-cam')}
        <a class="dock-btn dock-mid" href="#/coach" id="t-talk" aria-label="Talk to the coach"><span class="mic-btn">${MIC}</span><span data-k="dock-voice">TALK</span></a>
        <button class="dock-btn" type="button" data-later="checkin">${CHECK}CHECK IN</button>
      </div>
    </section>

    <section class="home-side home-right" aria-label="Clock and voice">
      <div class="bracket-tr hud home-block">
        REC <span data-k="clock-long"></span><br>
        <span class="c-cyan-dim" data-k="turns">TURN 0000 · MIC OFF</span>
      </div>
      <div class="card voice-card">
        <div class="hud c-muted voice-head">VOICE</div>
        <p>The coach by text: tap the mic button (TALK). Always-on listening, your voice only, arrives in step 9 after calibration.</p>
      </div>
      <div class="bracket-br hud home-block">
        TALK TODAY —<br><span class="c-cyan-dim" data-k="toolcount">TOOLS 0 CALLS · 0 ERRORS</span>
      </div>
    </section>
  </div>`;

  const $all = (k) => view.querySelectorAll(`[data-k="${k}"]`);
  const set = (k, html) => { for (const el of $all(k)) el.innerHTML = html; };

  // LOG MEAL: the camera opens straight away; the before photo starts a meal and its screen opens.
  view.querySelector('#t-cam').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { location.hash = `#/meal/${await logMealFromFile(f)}`; } catch { toast('That photo could not be read.'); }
  });
  view.querySelectorAll('[data-later]').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.later === 'checkin') location.hash = '#/checkin'; else toast(LATER[b.dataset.later]); });
  });
  // Tue 10/20: switch the coach between Sonnet and Opus with one tap.
  view.querySelector('#t-model')?.addEventListener('click', async () => {
    const cur = withDefaults(getState().settings).coach.model;
    const next = cur === 'deep' ? 'fast' : 'deep';
    await saveSettings({ coach: { model: next } });
    toast(`Coach: ${MODEL_LABEL[next]}`);
  });

  const tick = () => {
    const now = new Date();
    set('clock', `${formatTimeSec(now)} ${gmtOffset(now)}`);
    set('clock-short', formatTime(now));
    set('clock-long', `${isoDate(now)} ${formatTimeSec(now)} ${gmtOffset(now)}`);
    set('daytag', `TODAY // WK ${isoWeek(now)} // ${weekdayShort(now)}`);
    set('session', `HQ-${String(isoWeek(now)).padStart(4, '0')} SESSION-${isoDate(now).slice(5).replace('-', '')}`);
  };

  let train = null;
  let fuel = null;
  let steps = null; let healthAt = null;
  let talk = null;
  const draw = (s) => {
    set('model', MODEL_LABEL[withDefaults(s.settings).coach.model] || MODEL_LABEL.fast);
    set('turns', `TURN ${String(talk?.turns ?? 0).padStart(4, '0')} · MIC OFF`);
    set('toolcount', `TOOLS ${talk?.tools ?? 0} CALLS · ${talk?.errors ?? 0} ERRORS`);
    set('weekcols', weekColumnsLine(s));
    set('r-train', train ? train.readout : '—');
    set('r-fuel', fuel ? `<a class="readout-link" href="#/fuel">${fuel.readout}</a>` : '—');
    set('r-tendons', train ? `<a class="readout-link" href="#/holds">${train.holds.readout}</a>` : '—');
    // Tue 10/20: his steps weren't in because the Health Shortcut hadn't run today. Stale (no file in 4 hours):
    // the readout is a tap that runs the Shortcut now.
    const stale = !healthAt || Date.now() - healthAt > 4 * 3600000;
    // Thu 10/22, his words: the TAP TO UPDATE button was gone once the steps came in; a tap on the steps runs the Health
    // Shortcut (it sends them to the Mac), fresh or not. Body has the details.
    set('r-steps', steps && !stale ? `<a class="readout-link" href="${runShortcutUrl()}">${steps.steps.toLocaleString('en-US')}${steps.asOf ? `<br>AS OF ${formatTime(new Date(steps.asOf))}` : ''}<br><span class="c-cyan">TAP TO UPDATE</span></a>`
      : `<a class="readout-link c-amber" href="${runShortcutUrl()}">${steps ? steps.steps.toLocaleString('en-US') : '—'}<br>TAP TO UPDATE${healthAt ? ` · ${formatTime(new Date(healthAt))}` : ''}</a>`);
    const m = macLine(s);
    set('mac', `<span class="${m.cls}">${m.text}</span>`);
    set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase().replace('_', ' '));
    set('spoke', s.paired && s.programme && train ? train.line : spokeText(s));
    set('spoke-actions', !s.paired ? '<a class="btn-ghost spoke-btn" href="#/settings">PAIR WITH MAC</a>'
      : [train?.live ? `<a class="btn-primary spoke-btn" href="#/session/${encodeURIComponent(train.live)}">BACK TO THE WORKOUT</a>` : '', train?.scan ? '<a class="btn-ghost spoke-btn" href="#/body/scan">LOG THE SCAN</a>' : ''].join(''));
    set('core', coreSvg({ train: train?.progress ?? null, fuel: fuel?.progress ?? null, steps: steps?.goal ? Math.min(1, steps.steps / steps.goal) : null, tendons: train?.holds.progress ?? null },
      `AI core. ${train ? train.line : 'Nothing logged yet today.'}`));
  };

  tick();
  draw(getState());
  const timer = setInterval(tick, 1000);
  const unsub = subscribe(draw);
  let off = () => {};
  let gone = false;
  let minuteTimer = null;
  ready.then((repo) => {
    const refresh = async () => {
      train = await trainToday(repo); fuel = await fuelToday(repo); steps = await stepsToday(repo); healthAt = await healthAsOf(repo);
      talk = todayCounts(await repo.list('coach-messages'), isoDate(new Date()), (ms) => isoDate(new Date(ms)));
      if (!gone) draw(getState());
    };
    off = repo.onChange((cols) => { if (cols.some((c) => ['sessions', 'sets', 'days', 'bridge', 'programme', 'tendons', 'settings', 'meals', 'meal-estimates', 'fuel', 'supplements', 'supp-log', 'health', 'coach-messages', 'body-scans', 'scan-plan', 'sleep-log'].includes(c))) refresh(); });
    refresh();
    // The workout's minutes in the status line.
    minuteTimer = setInterval(() => { if (!gone && train?.live) refresh(); }, 60000);
  });
  // Voice (step 9): whether this device is listening, under the core and in the dock.
  const VOICE_TEXT = { off: 'OFF', listening: 'LISTENING', hearing: 'HEARING', thinking: 'THINKING', speaking: 'SPEAKING', paused: 'PAUSED', tap: 'TAP THE MIC', error: 'MIC ERROR' };
  const drawVoice = (st = voice.snapshot()) => {
    const a = view.querySelector('[data-k="voice"]'); const d = view.querySelector('[data-k="dock-voice"]');
    if (a) { a.textContent = `VOICE · ${VOICE_TEXT[st.phase] || st.phase.toUpperCase()}`; a.className = st.on ? 'c-cyan' : 'c-muted'; }
    if (d) d.textContent = st.on ? 'VOICE ON' : 'TALK';
  };
  drawVoice();
  const offVoice = voice.onChange(drawVoice);
  return () => { gone = true; clearInterval(timer); clearInterval(minuteTimer); unsub(); off(); offVoice(); };
}
