// BODY (#/body, step 7): steps, sleep, weight and workouts from Apple Health (the iPhone Shortcut's file, read by the
// Mac), body measurements and progress photos, Evolt 360 body scans. Sub-screens: #/body/health (the Shortcut),
// #/body/measure (measurements), #/body/photos (progress photos), #/body/scan (body scans).
import { ready, saveSettings } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults, toUnit } from '../lib/settings.js';
import { formatDay, formatTime, isoDate } from '../lib/time.js';
import { addDays } from '../lib/rotation.js';
import { weightSeries, dailyWeights, hoursText, average } from '../lib/health.js';
import { columnChart, timeLine, bindTips, bindCrosshair, tableView } from '../ui/charts.js';
import { promptText } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { latestByField, photoDays, shown, unitText } from '../lib/body.js';
import * as health from './body-health.js';
import * as measure from './body-measure.js';
import * as photos from './body-photos.js';
import * as scan from './body-scan.js';
import { isDone } from '../lib/scans.js';

const SUB = { health, measure, photos, scan };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = (x) => Math.round(x || 0).toLocaleString('en-US');
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const at = (ms) => formatTime(new Date(ms));
const kStep = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K`.replace('.0K', 'K') : String(Math.round(v)));
const RANGES = [['90', '3 months'], ['365', '1 year'], ['all', 'All']];

/** Steps today for the Today screen's STEPS readout: {steps, asOf, goal} or null. */
export async function stepsToday(repo) {
  const doc = await repo.get('health', isoDate(new Date()));
  if (doc?.steps == null) return null;
  return { steps: doc.steps, asOf: doc.fileAt ?? null, goal: withDefaults(getState().settings).body.stepGoal };
}

export function render(view, params = []) {
  const sub = SUB[params[0]];
  if (sub) return sub.render(view, params.slice(1));
  view.innerHTML = '<h1 class="view-title">Body</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {}; let untip = () => {}; let unx = () => {};
  let stepDays = 14; let range = '90';

  const draw = async (repo) => {
    const [docs, status, measurements, bodyPhotos, scanPlan, scans] = await Promise.all([repo.list('health'), repo.get('health-meta', 'status'), repo.list('measurements'), repo.list('body-photos'), repo.get('scan-plan', 'main'), repo.list('body-scans')]);
    if (!alive) return;
    const st = withDefaults(getState().settings);
    const wu = st.units.weight;
    const fmtW = (kg) => `${toUnit(kg, wu)} ${wu}`;
    const today = isoDate(new Date());
    const byDate = new Map(docs.map((d) => [d.date, d]));
    const tdoc = byDate.get(today);
    const last = status?.last;

    // Tiles: steps today, last night's sleep, latest weight.
    const night = [0, -1].map((n) => byDate.get(addDays(today, n))?.sleep).find(Boolean) || null;
    const nightDate = byDate.get(today)?.sleep ? today : byDate.get(addDays(today, -1))?.sleep ? addDays(today, -1) : null;
    const weights = dailyWeights(weightSeries(docs, measurements));
    const lastW = weights.at(-1);
    const monthAgo = [...weights].reverse().find((w) => w.date <= addDays(today, -28));
    const goal = st.body.stepGoal;

    // Steps: the last 14 or 30 days.
    const stepDates = Array.from({ length: stepDays }, (_, i) => addDays(today, i - stepDays + 1));
    const stepItems = stepDates.map((d) => {
      const v = byDate.get(d)?.steps ?? null;
      return { value: v, axis: md(d), tip: `${dayName(d)}: ${v == null ? 'no steps recorded' : `${n0(v)} steps`}${d === today && v != null && tdoc?.fileAt ? ` (as of ${at(tdoc.fileAt)})` : ''}` };
    });
    const full = stepDates.filter((d) => d !== today).map((d) => byDate.get(d)?.steps ?? null);
    const avg7 = average(full.slice(-7)); const avgAll = average(full);

    // Sleep: the last 14 nights (the night is the day he woke up).
    const nights = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    const sleepItems = nights.map((d) => {
      const s = byDate.get(d)?.sleep;
      const min = s ? s.asleepMin ?? s.inBedMin : null;
      return { value: min != null ? min / 60 : null, axis: md(d), tip: s ? `Night to ${dayName(d)}: ${hoursText(min)} ${s.asleepMin != null ? 'asleep' : 'in bed'}, ${at(s.bed)} to ${at(s.wake)}` : `Night to ${dayName(d)}: no sleep recorded` };
    });
    const sleepAvg = average(nights.slice(-7).map((d) => { const s = byDate.get(d)?.sleep; return s ? s.asleepMin ?? s.inBedMin : null; }));

    // Weight over a range.
    const from = range === 'all' ? '' : addDays(today, -Number(range));
    const wPts = weights.filter((w) => w.date >= from).map((w) => ({ t: Date.parse(`${w.date}T12:00:00`), value: toUnit(w.kg, wu), w }));
    const wChart = timeLine(wPts, { label: `Weight in ${wu}`, fmt: (v) => String(v) });

    // Measurements and progress photos: what the cards say.
    const mLatest = latestByField(measurements.filter((m) => m?.date)).filter((f) => f.key !== 'weightKg');
    const mDates = [...new Set(measurements.filter((m) => m?.date).map((m) => m.date))].sort();
    const pDays = photoDays(bodyPhotos.filter((p) => p?.date && p.dataUrl));

    // Body scan: the confirmed date, else a nudge to plan one.
    const nextScan = scanPlan?.next?.date >= today && !scans.some((x) => x.date === scanPlan.next.date && isDone(x)) ? scanPlan.next.date : null;
    const lastScan = scans.filter(isDone).map((x) => x.date).sort().at(-1);
    const scanLine = nextScan ? `Next ${dayName(nextScan)}${nextScan === today ? ' (today)' : ''}` : `${lastScan ? `Last ${dayName(lastScan)} · ` : ''}Plan the next one`;

    // Workouts Apple Health has (Watch walks, other apps); Training HQ's own sessions are on Train.
    const workouts = docs.flatMap((d) => (d.workouts || []).map((w) => ({ ...w, date: d.date }))).sort((a, b) => b.start - a.start).slice(0, 8);

    view.innerHTML = `
      <h1 class="view-title">Body</h1>
      <p class="view-sub">${last ? `From Apple Health · file made ${esc(dayName(isoDate(new Date(last.at))))}, ${esc(at(last.at))}` : 'Apple Health is not set up yet: steps, sleep, weight and workouts come from a Shortcut on your iPhone.'}</p>
      ${last ? '' : '<a class="btn-primary center big" href="#/body/health">Set up Apple Health</a>'}
      <section class="body-tiles">
        <a class="card body-tile" href="#b-steps"><span class="hud c-cyan">STEPS TODAY</span><b>${tdoc?.steps != null ? n0(tdoc.steps) : '—'}</b>
          <small>${tdoc?.steps != null && tdoc.fileAt ? `as of ${esc(at(tdoc.fileAt))}` : 'nothing yet today'}${goal && tdoc?.steps != null ? ` · ${Math.round((tdoc.steps / goal) * 100)}% of ${n0(goal)}` : ''}</small></a>
        <a class="card body-tile" href="#b-sleep"><span class="hud c-cyan">LAST NIGHT</span><b>${night ? esc(hoursText(night.asleepMin ?? night.inBedMin).replace(' h ', 'h ').replace(' min', 'm')) : '—'}</b>
          <small>${night ? `${esc(at(night.bed))} to ${esc(at(night.wake))}${night.asleepMin == null ? ' · in bed' : ''}${nightDate !== today ? ` · ${esc(md(nightDate))}` : ''}` : 'no sleep recorded'}</small></a>
        <a class="card body-tile" href="#b-weight"><span class="hud c-cyan">WEIGHT</span><b>${lastW ? esc(fmtW(lastW.kg)) : '—'}</b>
          <small>${lastW ? `${esc(md(lastW.date))}${monthAgo ? ` · ${lastW.kg - monthAgo.kg >= 0 ? '+' : '−'}${Math.abs(Math.round((toUnit(lastW.kg, wu) - toUnit(monthAgo.kg, wu)) * 10) / 10)} in 4 weeks` : ''}` : 'no weigh-in yet'}</small></a>
      </section>

      <section class="card pad-card chart-card" id="b-steps">
        <div class="ex-head"><span class="hud c-muted">STEPS PER DAY</span>
          <div class="seg seg-mini" role="group" aria-label="Days">${[14, 30].map((n) => `<button class="pill ${n === stepDays ? 'is-on' : ''}" type="button" data-days="${n}" aria-pressed="${n === stepDays}">${n} days</button>`).join('')}</div></div>
        ${columnChart(stepItems, { label: `Steps per day, last ${stepDays} days`, fmt: kStep, ref: goal ? { value: goal } : null })}
        <p class="hint">${avg7 != null ? `Average ${n0(avg7)} a day over the last 7 full days${avgAll != null && stepDays > 7 ? `, ${n0(avgAll)} over ${stepDays - 1}` : ''}.` : 'No full days yet.'} ${goal ? 'Dashed line: your goal.' : ''} <button class="link-btn" id="b-goal" type="button">${goal ? `Daily goal ${n0(goal)}` : 'Set a daily goal'}</button></p>
        ${tableView(['Day', 'Steps'], [...stepItems].reverse().map((x, i) => [dayName(stepDates[stepDates.length - 1 - i]), x.value == null ? '-' : n0(x.value)]))}
      </section>

      <section class="card pad-card chart-card" id="b-sleep">
        <span class="hud c-muted">SLEEP PER NIGHT (HOURS)</span>
        ${columnChart(sleepItems, { label: 'Hours asleep per night, last 14 nights', fmt: (v) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1)) })}
        <p class="hint">${sleepAvg != null ? `Average ${hoursText(sleepAvg)} over the last 7 nights.` : 'No sleep recorded in the last week.'} A night is counted on the day you woke up.</p>
        ${tableView(['Night to', 'Asleep', 'In bed', 'Bed', 'Up'], [...nights].reverse().map((d) => { const s = byDate.get(d)?.sleep; return [dayName(d), s ? hoursText(s.asleepMin) : '-', s ? hoursText(s.inBedMin) : '-', s ? at(s.bed) : '-', s ? at(s.wake) : '-']; }))}
      </section>

      <section class="card pad-card chart-card" id="b-weight">
        <div class="ex-head"><span class="hud c-muted">WEIGHT (${wu.toUpperCase()})</span></div>
        <div class="seg" role="group" aria-label="Range">${RANGES.map(([k, l]) => `<button class="pill ${k === range ? 'is-on' : ''}" type="button" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>
        <div class="chart-box" id="b-wchart">${wChart.svg}</div>
        <p class="hint">Apple Health weigh-ins and the weights in your measurements, one per day (the last that day). Pull-ups and other bodyweight exercises use the latest.</p>
        ${wPts.length ? tableView(['Day', `Weight (${wu})`, 'From'], [...wPts].reverse().slice(0, 60).map((p) => [dayName(p.w.date), String(p.value), p.w.from === 'health' ? 'Apple Health' : p.w.from === 'hevy' ? 'Hevy' : 'You'])) : ''}
      </section>

      <div class="section-label">Workouts in Apple Health</div>
      ${workouts.length ? `<ul class="best-list">${workouts.map((w) => `<li class="best"><span>${esc(w.activity)}<br><span class="c-faint">${esc(dayName(w.date))}, ${esc(at(w.start))}${w.source ? ` · ${esc(w.source)}` : ''}</span></span>
        <b>${w.minutes != null ? `${Math.round(w.minutes)} min` : ''}${w.kcal != null ? `<br><span class="c-faint">${n0(w.kcal)} kcal${w.distanceKm != null ? ` · ${w.distanceKm} km` : ''}</span>` : ''}</b></li>`).join('')}</ul>` : '<p class="hint">None in the last 30 days. Apple Watch walks and other apps\' workouts show here; your Training HQ sessions are on Train.</p>'}

      <div class="section-label">More</div>
      <a class="card supp-card" href="#/body/scan" id="b-scan"><span class="hud c-cyan">BODY SCAN</span><span class="supp-card-line ${nextScan || scanPlan?.safety?.readAt ? '' : 'c-amber'}">${esc(scanLine)}${scanPlan?.safety?.readAt ? '' : ' · safety notice first'}</span><span class="pill is-on">Open</span></a>
      <a class="card supp-card" href="#/body/measure"><span class="hud c-cyan">MEASUREMENTS</span><span class="supp-card-line">${mDates.length ? `${mLatest.slice(0, 2).map((f) => `${esc(f.label)} ${shown(f.kind, f.value, st.units)} ${esc(unitText(f.kind, st.units))}`).join(' · ') || `${mDates.length} entries`} · last ${esc(md(mDates.at(-1)))}` : 'Weight, body fat and 14 circumferences'}</span><span class="pill is-on">Open</span></a>
      <a class="card supp-card" href="#/body/photos"><span class="hud c-cyan">PROGRESS PHOTOS</span><span class="supp-card-line">${pDays.length ? `${pDays.length} day${pDays.length === 1 ? '' : 's'} · last ${esc(dayName(pDays[0].date))}` : 'Front, side and back, private'}</span><span class="pill is-on">Open</span></a>
      <a class="card supp-card" href="#/body/health"><span class="hud c-cyan">APPLE HEALTH</span><span class="supp-card-line">${last ? `Last file ${esc(at(last.readAt))} · ${docs.length} days` : 'Set up the iPhone Shortcut'}</span><span class="pill is-on">Open</span></a>`;

    unx(); unx = bindCrosshair(view.querySelector('#b-wchart'), wChart, (p) => `${dayName(p.w.date)}: ${p.value} ${wu}${p.w.from === 'health' ? ' (Apple Health)' : p.w.from === 'hevy' ? ' (Hevy)' : ''}`);
    view.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { stepDays = Number(b.dataset.days); draw(repo); }));
    view.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = b.dataset.range; draw(repo); }));
    view.querySelectorAll('.body-tile').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); view.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    view.querySelector('#b-goal').addEventListener('click', async () => {
      const t = await promptText('Daily step goal (0 = none)', goal ? String(goal) : '', { placeholder: 'e.g. 8000' });
      if (t == null) return;
      const v = Math.round(Number(String(t).replace(/[,\s]/g, '')));
      if (!(v >= 0 && v <= 100000)) { toast('A number of steps, 0 for none.'); return; }
      await saveSettings({ body: { stepGoal: v || null } });
      toast(v ? `Step goal ${n0(v)} a day.` : 'No step goal.');
      draw(repo);
    });
  };

  untip = bindTips(view);
  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => ['health', 'health-meta', 'measurements', 'body-photos', 'settings', 'scan-plan', 'body-scans'].includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); untip(); unx(); };
}
