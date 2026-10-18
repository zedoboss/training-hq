// TODAY: home screen, design option E ("AI core").
// Phone: one column. Mac (wide screens): corner-bracket readouts on both sides of the core.
import { coreSvg } from '../ui/core.js';
import { toast } from '../ui/toast.js';
import { getState, subscribe } from '../lib/store.js';
import { formatTime, formatTimeSec, weekdayShort, isoDate, isoWeek, gmtOffset, formatDay, formatHm, addMinutesHm } from '../lib/time.js';
import { withDefaults } from '../lib/settings.js';
import { ready } from '../lib/data.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL, REST_TEXT } from '../lib/rotation.js';
import { weekColumn } from '../lib/programme.js';
import { roundsByDate, holdSlots } from '../lib/holds.js';
import { logMealFromFile, cameraInput } from './meal.js';
import { dayTotals } from '../lib/meals.js';

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
  const slots = holdSlots({ areas, dayKind: t.kind, dayType: t.kind === 'rest' ? null : t.dayType, roundsToday: Object.fromEntries(areas.map((a) => [a.id, rounds[a.id]?.[today] || 0])), times: { morning: n.holdsMorning, evening: n.holdsEvening } });
  const open = slots.filter((x) => !x.done).length;
  const holds = slots.length ? { readout: open ? `${open} OPEN` : 'DONE', progress: (slots.length - open) / slots.length } : { readout: 'NONE TODAY', progress: null };
  const hm = daysByDate(dayList)[rot.next.date]?.sessionTime;
  const at = hm ? ` at ${formatHm(hm)}` : '';
  const check = hm ? ` Check-in at ${formatHm(addMinutesHm(hm, -withDefaults(getState().settings).notify.readinessMin))}.` : ' No time set yet.';
  if (t.kind === 'train') return { holds, readout: `${next}${wk ? ` · WK ${wk}` : ''}`, progress: 0, line: `Today: ${next}${at}${wk ? `, week ${wk} column` : ''}.${check}` };
  const nextText = `Next: ${next}${at}, ${dayOf(rot.next.date)}${wk ? `, week ${wk} column` : ''}.${hm ? check : ''}`;
  if (t.kind === 'done') return { holds, readout: `${LABEL[t.dayType]} DONE`, progress: 1, line: `${LABEL[t.dayType]} done today. ${nextText}` };
  return { holds, readout: 'REST', progress: null, line: `${REST_TEXT[t.reason] || 'Rest day'}. ${nextText}` };
}

/** Today's kcal against the target, for the FUEL readout and the core's fuel ring. */
async function fuelToday(repo) {
  const [meals, estimates, plan] = await Promise.all([repo.list('meals'), repo.list('meal-estimates'), repo.get('fuel', 'plan')]);
  const t = dayTotals(meals, estimates, isoDate(new Date()));
  const kcal = Math.round(t.kcal).toLocaleString('en-US');
  if (!plan?.kcal) return { readout: `${kcal} KCAL`, progress: null };
  return { readout: `${kcal} / ${Number(plan.kcal).toLocaleString('en-US')} KCAL<br>${Math.round(t.protein)} G PROTEIN`, progress: Math.min(1, t.kcal / plan.kcal) };
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
        ${readout('bl', 'STEPS', '—', 'c-cyan')}
        ${readout('br', 'FUEL', '—', 'c-green', 'r-fuel')}
      </div>

      <div class="home-status hud">
        <span class="c-muted">VOICE · STEP 9</span>
        <span class="model-chip">SONNET 5.5 · LOW</span>
      </div>

      <section class="card spoke">
        <div class="hud c-muted spoke-head"><span>STATUS</span><span data-k="clock-short"></span></div>
        <p class="spoke-text" data-k="spoke"></p>
        <div class="spoke-actions" data-k="spoke-actions"></div>
      </section>

      <div class="dock">
        <label class="dock-btn file-btn" for="t-cam">${CAMERA}LOG MEAL</label>${cameraInput('t-cam')}
        <div class="dock-mid">
          <button class="mic-btn" type="button" data-later="talk" aria-label="Talk to the coach">${MIC}</button>
          <div class="dock-voice">
            <div class="hud c-text dock-name">CLAUDE</div>
            <div class="level" aria-hidden="true">${'<span></span>'.repeat(8)}</div>
            <div class="hud c-muted dock-state">VOICE OFF</div>
          </div>
        </div>
        <button class="dock-btn" type="button" data-later="checkin">${CHECK}CHECK IN</button>
      </div>
    </section>

    <section class="home-side home-right" aria-label="Clock and voice">
      <div class="bracket-tr hud home-block">
        REC <span data-k="clock-long"></span><br>
        <span class="c-cyan-dim">TURN 0000 · MIC OFF</span>
      </div>
      <div class="card voice-card">
        <div class="hud c-muted voice-head">VOICE</div>
        <p>Always-on listening, your voice only, arrives in step 9 after calibration. Coach by text arrives in step 8.</p>
      </div>
      <div class="bracket-br hud home-block">
        TALK TODAY —<br><span class="c-cyan-dim">TOOLS 0 CALLS · 0 ERRORS</span>
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
  const draw = (s) => {
    set('weekcols', weekColumnsLine(s));
    set('r-train', train ? train.readout : '—');
    set('r-fuel', fuel ? `<a class="readout-link" href="#/fuel">${fuel.readout}</a>` : '—');
    set('r-tendons', train ? `<a class="readout-link" href="#/holds">${train.holds.readout}</a>` : '—');
    const m = macLine(s);
    set('mac', `<span class="${m.cls}">${m.text}</span>`);
    set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase().replace('_', ' '));
    set('spoke', s.paired && s.programme && train ? train.line : spokeText(s));
    set('spoke-actions', s.paired ? '' : '<a class="btn-ghost spoke-btn" href="#/settings">PAIR WITH MAC</a>');
    set('core', coreSvg({ train: train?.progress ?? null, fuel: fuel?.progress ?? null, steps: null, tendons: train?.holds.progress ?? null },
      `AI core. ${train ? train.line : 'Nothing logged yet today.'}`));
  };

  tick();
  draw(getState());
  const timer = setInterval(tick, 1000);
  const unsub = subscribe(draw);
  let off = () => {};
  let gone = false;
  ready.then((repo) => {
    const refresh = async () => { train = await trainToday(repo); fuel = await fuelToday(repo); if (!gone) draw(getState()); };
    off = repo.onChange((cols) => { if (cols.some((c) => ['sessions', 'sets', 'days', 'bridge', 'programme', 'tendons', 'settings', 'meals', 'meal-estimates', 'fuel'].includes(c))) refresh(); });
    refresh();
  });
  return () => { gone = true; clearInterval(timer); unsub(); off(); };
}
