// SUPPLEMENTS (part of Fuel, its own screen; brief section 6 SUPPLEMENTS).
//   #/supps        today's checklist by time of day (6.5)
//   #/supps/list   his list: add, edit, pause, remove (6.4)
// The app only tracks what he decides to take. It never recommends a supplement or a dose, and never changes his list.
import { ready } from '../lib/data.js';
import { isoDate, formatHm } from '../lib/time.js';
import { FOOD_TEXT, daysText, statusOn, stockStatus, lastsText, adherence } from '../lib/supplements.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name);
const pct = (a) => (a.pct == null ? '—' : `${a.pct}%`);

/** One line of facts about a supplement: dose, rest-day dose, time, food, days. */
export function suppFacts(s) {
  return [s.dose, s.doseRest ? `rest days ${s.doseRest}` : '', s.time ? formatHm(s.time) : 'no time set', s.withFood ? FOOD_TEXT[s.withFood] : '', daysText(s.days)]
    .filter(Boolean).join(' · ');
}

function renderList(view, repo, alive) {
  const draw = async () => {
    const today = isoDate(new Date());
    const [all, log] = await Promise.all([repo.list('supplements'), repo.list('supp-log')]);
    if (!alive()) return;
    const by = (st) => all.filter((s) => statusOn(s, today) === st).sort(byOrder);
    const row = (s) => {
      const stock = stockStatus(s, log);
      const a7 = adherence(s, log, today, 7); const a30 = adherence(s, log, today, 30);
      return `<li><a class="lib-row supp-row" href="#/supp/${esc(s.id)}"><span class="lib-name">${esc(s.name)}</span>
        <span class="lib-meta">${esc(suppFacts(s))}</span>
        <span class="lib-meta">${stock ? `${stock.left} servings left · ${lastsText(stock.days)}${stock.low ? ' · <b class="c-amber">LOW</b>' : ''}` : 'Stock not tracked'} · 7 days ${pct(a7)} · 30 days ${pct(a30)}</span></a></li>`;
    };
    const active = by('active'); const paused = by('paused'); const removed = by('removed');
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/supps">Today</a><a class="pill is-on" href="#/supp/new">+ Add</a></div>
      <h1 class="view-title">My supplements</h1>
      <p class="hint">Your list, as you set it. Training HQ only tracks what you decide to take: it doesn't suggest supplements or doses.</p>
      <div class="section-label">Taking · ${active.length}</div>
      <ul class="lib-list">${active.map(row).join('') || '<li class="hint pad">Nothing on the list.</li>'}</ul>
      ${paused.length ? `<div class="section-label">Paused · ${paused.length}</div><ul class="lib-list">${paused.map(row).join('')}</ul>` : ''}
      ${removed.length ? `<details class="notes"><summary>Removed · ${removed.length}</summary><ul class="lib-list">${removed.map(row).join('')}</ul></details>` : ''}`;
  };
  draw();
  return repo.onChange((cols) => { if (cols.some((c) => ['supplements', 'supp-log'].includes(c))) draw(); });
}

export function render(view, params) {
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  ready.then((repo) => {
    if (!alive) return;
    off = params[0] === 'list' || true ? renderList(view, repo, () => alive) : () => {};
  });
  return () => { alive = false; off(); };
}
