// BODY > Pain (#/body/pain, Thu 11/5): pain outside the tendon areas, per body area over days, with its trend and a flag
// when the same lift hurt the same area again. From what he wrote in his workouts (skip reasons, notes) and what he
// logs here or tells the coach (collection 'pain-log'). His words and his numbers only: no advice.
import { ready } from '../lib/data.js';
import { formatDay, isoDate } from '../lib/time.js';
import { AREAS, painEntries, painByArea, repeatFlags, painDoc } from '../lib/pain.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const TREND = { worse: 'c-amber', better: 'c-cyan', same: 'c-muted' };

export function render(view) {
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Pain</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  let form = { area: 'lower-back', rating: '', lift: '', note: '' };

  const draw = async (repo) => {
    const [sessions, sets, log] = await Promise.all([repo.list('sessions'), repo.list('sets'), repo.list('pain-log')]);
    if (!alive) return;
    const entries = painEntries({ sessions, sets: sets.filter((x) => x.note), log });
    const areas = painByArea(entries);
    const flags = repeatFlags(entries);
    const lifts = [...new Set(sessions.filter((s) => s.status === 'done' || s.status === 'active').sort((a, b) => b.startedAt - a.startedAt).slice(0, 12).flatMap((s) => (s.exercises || []).map((e) => e.name)))].sort();
    const own = new Map(log.filter((d) => d && !d.deleted).map((d) => [d.id, d]));
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body">Body</a></div>
      <h1 class="view-title">Pain</h1>
      <p class="view-sub">Per area, newest first. From your workout notes and skips, and what you log here or tell the coach.</p>
      ${flags.length ? `<section class="card"><div class="hud c-amber">SAME LIFT, SAME AREA AGAIN</div>${flags.map((f) => `<p class="sheet-text">${esc(f.label)} on ${esc(f.lift)}: ${f.dates.map((d) => esc(dayName(d))).join(', ')}.</p>`).join('')}</section>` : ''}
      ${areas.length ? areas.map((a) => `<section class="card">
        <div class="ex-head"><span class="hud c-cyan">${esc(a.label.toUpperCase())}</span>${a.trend ? `<span class="hud ${TREND[a.trend]}">${a.trend.toUpperCase()}</span>` : ''}</div>
        <ul class="ex-list">${a.days.slice(0, 14).map((d) => `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(dayName(d.date))}</span><span class="hud">${d.rating != null ? `${d.rating}/10` : 'no rating'}</span></div>
          ${d.lifts.length ? `<div class="hint">${esc(d.lifts.join(', '))}</div>` : ''}
          ${d.texts.length ? `<div class="hint c-muted">${esc(d.texts.join(' · ').slice(0, 240))}</div>` : ''}</li>`).join('')}</ul>
      </section>`).join('') : '<p class="hint">Nothing logged. Pain you write in a workout note or a skip reason shows here by itself.</p>'}
      <section class="card">
        <div class="hud c-cyan">LOG PAIN</div>
        <div class="field"><label for="p-area">Area</label><select class="input" id="p-area">${AREAS.map(([id, label]) => `<option value="${id}" ${form.area === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>
        <div class="field"><label for="p-rating">Pain 0-10 (optional)</label><input class="input" id="p-rating" type="number" inputmode="numeric" min="0" max="10" value="${esc(form.rating)}"></div>
        <div class="field"><label for="p-lift">On which lift (optional)</label><select class="input" id="p-lift"><option value="">None</option>${lifts.map((n) => `<option ${form.lift === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label for="p-note">Note</label><input class="input" id="p-note" type="text" maxlength="300" value="${esc(form.note)}" placeholder="In your words"></div>
        <button class="btn-primary" id="p-save" type="button">Save for today</button>
      </section>
      ${own.size ? `<section class="card"><div class="hud c-muted">LOGGED HERE OR BY THE COACH</div><ul class="ex-list">${[...own.values()].sort((a, b) => b.at - a.at).slice(0, 20).map((d) => `<li class="ex"><div class="ex-head"><span class="ex-name">${esc(dayName(d.date))} · ${esc(AREAS.find(([id]) => id === d.area)?.[1] || d.area)}${d.rating != null ? ` · ${d.rating}/10` : ''}</span><button class="btn-ghost small" data-del="${esc(d.id)}" type="button">Delete</button></div>${d.lift || d.note ? `<div class="hint">${esc([d.lift, d.note].filter(Boolean).join(' · '))}</div>` : ''}</li>`).join('')}</ul></section>` : ''}`;
    const read = () => { form = { area: view.querySelector('#p-area').value, rating: view.querySelector('#p-rating').value, lift: view.querySelector('#p-lift').value, note: view.querySelector('#p-note').value }; };
    view.querySelectorAll('#p-area, #p-rating, #p-lift, #p-note').forEach((el) => el.addEventListener('change', read));
    view.querySelector('#p-save').onclick = async () => {
      read();
      const r = form.rating === '' ? null : Number(form.rating);
      if (r != null && !(r >= 0 && r <= 10)) { toast('Pain is 0 to 10.'); return; }
      const doc = painDoc({ area: form.area, rating: r, lift: form.lift || null, note: form.note, date: isoDate(new Date()) });
      await repo.put('pain-log', doc.id, doc);
      form = { ...form, rating: '', note: '' };
      toast('Saved.');
    };
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmSheet('Delete this entry?', { ok: 'Delete', danger: true }))) return;
      await repo.remove('pain-log', b.dataset.del);
    }));
  };

  ready.then((repo) => {
    if (!alive) return;
    draw(repo);
    off = repo.onChange((cols) => { if (cols.some((c) => ['pain-log', 'sessions', 'sets'].includes(c))) draw(repo); });
  });
  return () => { alive = false; off(); };
}
