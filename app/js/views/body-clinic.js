// #/body/clinic (Thu 11/5, missing feature 12): one page to show the clinic at his checkup, printable (the Print
// button, or Share > Print on the iPhone, makes a PDF). Only his own records (lib/clinic.js): no advice, no reading.
import { ready } from '../lib/data.js';
import { formatDay, isoDate } from '../lib/time.js';
import { comebackStartOf } from '../lib/finish.js';
import { clinicSummary } from '../lib/clinic.js';
import { kg as fmtKg } from '../lib/loads.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const set = (x) => `${fmtKg(x.kg)} kg${x.reps != null ? ` × ${x.reps}` : ''}`;
const num = (v, unit) => (v == null ? '—' : `${v}${unit ? ` ${unit}` : ''}`);
const signed = (v, unit) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}${unit ? ` ${unit}` : ''}`);
const HEAD = '<div class="lib-head no-print"><a class="pill" href="#/body/recovery">Recovery</a><a class="pill" href="#/body">Body</a></div>';

export function render(view) {
  view.innerHTML = `${HEAD}<h1 class="view-title">Clinic summary</h1><p class="view-sub">Loading…</p>`;
  let alive = true; let off = () => {};
  const draw = async (repo) => {
    const [recPlan, recState, notes, tendons, sessions, sets, bridge, exercises, scans, meta] = await Promise.all([repo.get('recovery', 'main'), repo.get('recovery', 'state'), repo.list('coach-notes'),
      repo.list('tendons'), repo.list('sessions'), repo.list('sets'), repo.get('bridge', 'last-loads'), repo.list('exercises'), repo.list('body-scans'), repo.get('programme', 'meta')]);
    if (!alive) return;
    const today = isoDate(new Date());
    const c = clinicSummary({ today, recPlan, recState, notes, tendons, sessions, sets, bridge, exercises, scans, comebackStart: comebackStartOf(meta) });
    const r = c.recovery;
    view.innerHTML = `${HEAD}
      <div class="clinic">
      <h1 class="view-title">${esc(r?.title || 'Training and recovery summary')}</h1>
      <p class="view-sub">${r?.sinceText ? `${esc(r.sinceText)} since ${esc(recPlan.sinceText || dayName(r.since))}. ` : ''}${r?.checkup ? `Checkup ${esc(dayName(r.checkup))}. ` : ''}Made ${esc(dayName(today))} from what was logged in the app. Training since ${esc(dayName(c.from))}.</p>
      <div class="btn-row no-print"><button class="btn-primary" type="button" id="cl-print">Print or save as PDF</button></div>

      ${r?.checkIns.length ? `<section class="card pad-card"><div class="hud c-cyan">CHECK-INS (HIS ANSWERS)</div>
        <table class="clinic-table"><tbody>${r.checkIns.map((x) => `<tr><th>${esc(dayName(x.date))}</th><td>${x.answers.map((a) => `${esc(a.label)}: ${esc(a.value)}`).join('; ')}</td></tr>`).join('')}</tbody></table></section>` : ''}

      <section class="card pad-card"><div class="hud c-cyan">TENDON AREAS · HOLDS, LAST ${c.tendons[0]?.of ?? 28} DAYS</div>
        ${c.tendons.length ? `<table class="clinic-table"><thead><tr><th>Area</th><th>Phase</th><th>Holds</th><th>Rounds</th><th>Days</th></tr></thead><tbody>${c.tendons.map((t) => `<tr><td>${esc(t.label)}</td><td>${esc(t.phase)}</td><td>${esc(t.holds.join(', ') || '—')}</td><td>${t.rounds}</td><td>${t.days} of ${t.of}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No tendon areas with a phase.</p>'}</section>

      <section class="card pad-card"><div class="hud c-cyan">PAIN WRITTEN DOWN IN WORKOUTS</div>
        ${c.pain.length ? `<table class="clinic-table"><tbody>${c.pain.map((p) => `<tr><th>${esc(dayName(p.date))}</th><td>${p.exercise ? `${esc(p.exercise)}${p.skipped ? ' (skipped)' : ''}: ` : ''}${esc(p.text)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">None written down.</p>'}</section>

      <section class="card pad-card"><div class="hud c-cyan">MAIN LIFTS · FIRST AND LATEST SESSION (TOTAL KG)</div>
        ${c.lifts.length ? `<table class="clinic-table"><thead><tr><th>Lift</th><th>First</th><th>Latest</th><th>Change</th></tr></thead><tbody>${c.lifts.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(set(l.first))}<br><span class="hint">${esc(dayName(l.first.date))}</span></td><td>${esc(set(l.last))}<br><span class="hint">${esc(dayName(l.last.date))}</span></td><td>${esc(signed(l.changeKg, 'kg'))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No main lifts logged yet.</p>'}</section>

      <section class="card pad-card"><div class="hud c-cyan">BODY SCANS${c.scans ? ` · ${c.scans.count}` : ''}</div>
        ${c.scans ? `<table class="clinic-table"><thead><tr><th></th><th>${esc(dayName(c.scans.first))}</th><th>${esc(dayName(c.scans.last))}</th><th>Change</th></tr></thead><tbody>${c.scans.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(num(x.first, x.unit))}</td><td>${esc(num(x.last, x.unit))}</td><td>${esc(signed(x.change, x.unit))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No scans with results.</p>'}</section>
      </div>`;
    view.querySelector('#cl-print')?.addEventListener('click', () => window.print());
  };
  ready.then((repo) => {
    if (!alive) return;
    draw(repo);
    off = repo.onChange((cols) => { if (cols.some((x) => ['recovery', 'coach-notes', 'tendons', 'sessions', 'sets', 'body-scans'].includes(x))) draw(repo); });
  });
  return () => { alive = false; off(); };
}
