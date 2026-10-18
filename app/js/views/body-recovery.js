// BODY > Recovery (#/body/recovery, A13): his recovery record in the app. The weekly check-in until the checkup (his
// answers saved as dated notes, which the coach reads too), the things he has to do (book the checkup, get something
// in writing) with the checkup date, and the recovery photos every few weeks (Body > Progress photos, the plan's
// poses). Everything personal (what it is about, the questions, dates, poses) comes from his private seed. The app
// asks, keeps and reminds; it gives no advice.
import { ready } from '../lib/data.js';
import { formatDay, formatTime, isoDate } from '../lib/time.js';
import { checkInStatus, checkIns, checkInNote, missingAnswers, openTasks, photoStatus, sinceText, withTask, withCheckup, noteId } from '../lib/recovery.js';
import { POSES } from '../lib/body.js';
import { overlay } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dayName = (iso) => formatDay(new Date(`${iso}T12:00:00`));
const POSE = Object.fromEntries(POSES);

export function render(view) {
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Recovery</h1><p class="view-sub">Loading…</p>';
  let alive = true; let off = () => {};
  let answers = {}; let touched = false;

  const draw = async (repo) => {
    const [plan, state, notes, photos] = await Promise.all([repo.get('recovery', 'main'), repo.get('recovery', 'state'), repo.list('coach-notes'), repo.list('body-photos')]);
    if (!alive) return;
    const today = isoDate(new Date());
    if (!plan?.since) {
      view.innerHTML = '<div class="lib-head"><a class="pill" href="#/body">Body</a></div><h1 class="view-title">Recovery</h1><p class="hint">No recovery record on this device. It comes from your Mac.</p>';
      return;
    }
    const st = checkInStatus(plan, state, notes, today);
    const todays = notes.find((n) => n.id === noteId(today));
    if (!touched) answers = { ...(todays?.answers || {}) };
    const tasks = plan.tasks || [];
    const open = openTasks(plan, state);
    const ph = photoStatus(plan, photos, today);
    const history = checkIns(notes).slice(0, 12);
    const qs = plan.checkIn?.questions || [];
    const firstPose = ph ? (ph.poses.find((p) => !photos.some((x) => x.date === today && x.pose === p && x.dataUrl)) || ph.poses[0]) : null;
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/body">Body</a></div>
      <h1 class="view-title">${esc(plan.title || 'Recovery')}</h1>
      <p class="view-sub">${esc(sinceText(plan, today) || '')} since ${esc(plan.sinceText || dayName(plan.since))}.${st.endsOn ? ` Check-ins until ${esc(state?.checkup?.date ? `your checkup, ${dayName(st.endsOn)}` : plan.untilText || dayName(st.endsOn))}.` : ''}</p>

      ${st.active ? `<section class="card pad-card" id="rc-check">
        <div class="hud ${st.due && !todays ? 'c-amber' : 'c-cyan'}">WEEKLY CHECK-IN · ${todays ? 'DONE TODAY' : st.due ? 'DUE' : `NEXT ${esc(dayName(st.dueOn).toUpperCase())}`}</div>
        ${st.last && !todays ? `<p class="hint">Last: ${esc(dayName(st.last.date))}. ${esc(st.last.text.replace(/^[^:]*:\s*/, ''))}</p>` : ''}
        <form id="rc-form">
          ${qs.map((q) => `<div class="field"><label${q.choices ? '' : ` for="rc-${esc(q.key)}"`}>${esc(q.ask || q.label)}</label>${q.choices
            ? `<div class="seg" role="group" aria-label="${esc(q.label)}">${q.choices.map((c) => `<button class="pill ${answers[q.key] === c ? 'is-on' : ''}" type="button" data-q="${esc(q.key)}" data-a="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
            : `<textarea class="input" id="rc-${esc(q.key)}" data-text="${esc(q.key)}" rows="2" placeholder="Nothing new? Leave it empty.">${esc(answers[q.key] || '')}</textarea>`}</div>`).join('')}
          <button class="btn-primary big" type="submit">${todays ? 'Save changes' : 'Save check-in'}</button>
        </form>
      </section>` : `<p class="hint">The weekly check-ins have ended${st.endsOn ? ` (${esc(dayName(st.endsOn))})` : ''}.</p>`}

      ${tasks.length ? `<section class="card pad-card" id="rc-tasks">
        <div class="hud ${open.length ? 'c-amber' : 'c-cyan'}">TO DO · ${open.length ? `${open.length} OPEN` : 'ALL DONE'}</div>
        ${tasks.map((t) => {
          const done = state?.tasks?.[t.id]?.doneAt;
          return `<div class="rc-task ${done ? 'is-done' : ''}"><div><b>${esc(t.text)}</b>${t.detail ? `<div class="hint">${esc(t.detail)}</div>` : ''}${done ? `<div class="hud c-muted">DONE ${esc(dayName(isoDate(new Date(done))).toUpperCase())}</div>` : ''}${t.setsCheckup && state?.checkup?.date ? `<div class="hud c-cyan">CHECKUP ${esc(dayName(state.checkup.date).toUpperCase())}</div>` : ''}</div>
            <div class="rc-task-btns">${t.setsCheckup ? `<button class="pill" type="button" data-checkup="1">${state?.checkup?.date ? 'Change date' : 'Booked: date'}</button>` : ''}<button class="pill ${done ? '' : 'is-on'}" type="button" data-task="${esc(t.id)}">${done ? 'Undo' : 'Done'}</button></div></div>`;
        }).join('')}
      </section>` : ''}

      ${ph ? `<section class="card pad-card" id="rc-photos">
        <div class="hud ${ph.due && !ph.takenToday ? 'c-amber' : 'c-cyan'}">PHOTOS · ${ph.takenToday ? 'TAKEN TODAY' : ph.due ? 'DUE' : `NEXT FROM ${esc(dayName(ph.dueOn).toUpperCase())}`}</div>
        <p class="hint">${ph.last ? `Last ones ${esc(dayName(ph.last))}.` : 'None yet.'} ${esc(plan.photos.how || '')} Every ${plan.photos.minDays || 14} to ${plan.photos.maxDays || 28} days.</p>
        <p class="hint">Poses: ${ph.poses.map((p) => esc(POSE[p] || p)).join(', ')}.</p>
        <a class="btn-${ph.due && !ph.takenToday ? 'primary' : 'ghost'} big center" href="#/body/photos/take/${esc(firstPose)}/${esc(ph.poses.join(','))}">Take the recovery photos</a>
      </section>` : ''}

      ${plan.checkupQuestions?.length ? `<section class="card pad-card"><div class="hud c-cyan">YOUR LIST FOR THE CHECKUP</div><ul class="rc-list">${plan.checkupQuestions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>` : ''}

      <section class="card pad-card" id="rc-history"><div class="hud c-cyan">CHECK-INS</div>
        ${history.length ? history.map((n) => `<div class="rc-row"><span class="hud c-muted">${esc(dayName(n.date).toUpperCase())}${n.at ? ` · ${esc(formatTime(new Date(n.at)))}` : ''}${n.by === 'coach' ? ' · COACH' : ''}</span><span>${esc(n.text.replace(/^[^:]*:\s*/, ''))}</span></div>`).join('') : '<p class="hint">None yet. They also show on Talk > Notes, and the coach reads them.</p>'}
      </section>`;

    view.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      touched = true;
      answers[b.dataset.q] = answers[b.dataset.q] === b.dataset.a ? undefined : b.dataset.a;
      view.querySelectorAll(`[data-q="${b.dataset.q}"]`).forEach((x) => x.classList.toggle('is-on', answers[b.dataset.q] === x.dataset.a));
    }));
    view.querySelectorAll('[data-text]').forEach((t) => t.addEventListener('input', () => { touched = true; answers[t.dataset.text] = t.value; }));
    view.querySelector('#rc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const missing = missingAnswers(plan, answers);
      if (missing.length) { toast(`Answer ${qs.filter((q) => missing.includes(q.key)).map((q) => q.label.toLowerCase()).join(' and ')} first.`); return; }
      const note = checkInNote(plan, answers, { date: today, at: Date.now(), by: 'app' });
      await repo.put('coach-notes', note.id, note);
      touched = false;
      toast('Check-in saved.');
    });
    view.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', async () => {
      const cur = await repo.get('recovery', 'state');
      const done = !cur?.tasks?.[b.dataset.task]?.doneAt;
      await repo.put('recovery', 'state', withTask(cur, b.dataset.task, done));
      toast(done ? 'Done.' : 'Open again.');
    }));
    view.querySelector('[data-checkup]')?.addEventListener('click', () => pickCheckup(repo, plan, state, today));
  };

  ready.then((repo) => {
    off = repo.onChange((cols) => { if (cols.some((c) => ['recovery', 'coach-notes', 'body-photos'].includes(c))) draw(repo); });
    draw(repo);
  });
  return () => { alive = false; off(); };
}

/** The checkup date he booked; saving it ticks "book the checkup". */
function pickCheckup(repo, plan, state, today) {
  const { el, close } = overlay(`<form class="sheet-form"><label class="hud c-muted sheet-title" for="rc-date">CHECKUP DATE</label>
    <input class="input" type="date" id="rc-date" min="${today}" value="${esc(state?.checkup?.date || '')}" required>
    <p class="hint">The weekly check-ins run until this date; a reminder comes the evening before.</p>
    <div class="btn-row">${state?.checkup?.date ? '<button class="btn-ghost" type="button" data-clear>Clear</button>' : '<button class="btn-ghost" type="button" data-cancel>Cancel</button>'}<button class="btn-primary" type="submit">Save</button></div></form>`);
  el.querySelector('[data-cancel]')?.addEventListener('click', () => close());
  el.querySelector('[data-clear]')?.addEventListener('click', async () => {
    close();
    await repo.put('recovery', 'state', withCheckup(await repo.get('recovery', 'state'), null));
    toast('Checkup date cleared.');
  });
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = el.querySelector('#rc-date').value;
    if (!date || date < today) { toast('Pick today or later.'); return; }
    close();
    let next = withCheckup(await repo.get('recovery', 'state'), date);
    const booking = (plan.tasks || []).find((t) => t.setsCheckup);
    if (booking) next = withTask(next, booking.id, true);
    await repo.put('recovery', 'state', next);
    toast(`Checkup: ${dayName(date)}.`);
  });
}
