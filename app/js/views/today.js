// TODAY: home screen, design option E ("AI core").
// Phone: one column. Mac (wide screens): corner-bracket readouts on both sides of the core.
import { coreSvg } from '../ui/core.js';
import { toast } from '../ui/toast.js';
import { getState, subscribe } from '../lib/store.js';
import { formatTime, formatTimeSec, weekdayShort, isoDate, isoWeek, gmtOffset, formatDay } from '../lib/time.js';
import { ready } from '../lib/data.js';
import { rotationDay, lastRotationSession, daysByDate, LABEL, REST_TEXT } from '../lib/rotation.js';
import { weekColumn } from '../lib/programme.js';

const CAMERA = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
const CHECK = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>`;
const MIC = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

const LATER = {
  meal: 'Meal logging arrives in step 6.',
  talk: 'Voice arrives in step 9, after you calibrate it to your voice.',
  checkin: 'The readiness check-in arrives in step 4.',
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
  if (t.kind === 'train') return { readout: `${next}${wk ? ` · WK ${wk}` : ''}`, progress: 0, line: `Today: ${next}${wk ? `, week ${wk} column` : ''}.` };
  const nextText = `Next: ${next}, ${dayOf(rot.next.date)}${wk ? `, week ${wk} column` : ''}.`;
  if (t.kind === 'done') return { readout: `${LABEL[t.dayType]} DONE`, progress: 1, line: `${LABEL[t.dayType]} done today. ${nextText}` };
  return { readout: 'REST', progress: null, line: `${REST_TEXT[t.reason] || 'Rest day'}. ${nextText}` };
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
        ${readout('tl', 'TENDONS', '—', 'c-muted')}
        ${readout('tr', 'TRAIN', '—', 'c-amber', 'r-train')}
        ${readout('bl', 'STEPS', '—', 'c-cyan')}
        ${readout('br', 'FUEL', '—', 'c-green')}
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
        <button class="dock-btn" type="button" data-later="meal">${CAMERA}LOG MEAL</button>
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

  view.querySelectorAll('[data-later]').forEach((b) => {
    b.addEventListener('click', () => toast(LATER[b.dataset.later]));
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
  const draw = (s) => {
    set('weekcols', weekColumnsLine(s));
    set('r-train', train ? train.readout : '—');
    const m = macLine(s);
    set('mac', `<span class="${m.cls}">${m.text}</span>`);
    set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase().replace('_', ' '));
    set('spoke', s.paired && s.programme && train ? train.line : spokeText(s));
    set('spoke-actions', s.paired ? '' : '<a class="btn-ghost spoke-btn" href="#/settings">PAIR WITH MAC</a>');
    set('core', coreSvg({ train: train?.progress ?? null, fuel: null, steps: null, tendons: null },
      `AI core. ${train ? train.line : 'Nothing logged yet today.'}`));
  };

  tick();
  draw(getState());
  const timer = setInterval(tick, 1000);
  const unsub = subscribe(draw);
  let off = () => {};
  let gone = false;
  ready.then((repo) => {
    const refresh = async () => { train = await trainToday(repo); if (!gone) draw(getState()); };
    off = repo.onChange((cols) => { if (cols.some((c) => ['sessions', 'days', 'bridge', 'programme'].includes(c))) refresh(); });
    refresh();
  });
  return () => { gone = true; clearInterval(timer); unsub(); off(); };
}
