// TALK (step 8): the coach by text, on the phone and in the Mac's browser. Same conversation on both (it syncs).
//   #/coach        the log (time, who, the words, the tools used) and the box to type in; Sonnet or Opus
//   #/coach/notes  notes the coach kept for him and the reminders it set
// The coach itself runs on the Mac (Claude Code); this screen needs the Mac. Spoken turns (step 9, lib/voice.js) show
// here live too, marked VOICE.
import { ready, syncNow, coachSend, macPost, saveSettings } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, formatTimeSec, formatTime, isoDate, timeAt, dayAt } from '../lib/time.js';
import * as rest from '../lib/rest-timer.js';
import { messagesOf, MODEL_LABEL, toolChips, runAction, textHtml, changeView } from '../lib/coach.js';
import { actionSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { stop as voiceStop } from '../lib/voice.js';
import { startDictation } from '../lib/dictate.js';
import { addDays } from '../lib/rotation.js';
import { updateApp } from '../lib/sw-client.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DRAFT = 'thq.coach.draft';
const draftGet = () => { try { return localStorage.getItem(DRAFT) || ''; } catch { return ''; } };
const draftSet = (v) => { try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* private mode */ } };
const modelOf = () => withDefaults(getState().settings).coach.model;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIC_ICON = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SEND = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>';

/** Actions the coach asked this device for (its rest timer, a sync, moving the session screen to an exercise).
 * Tue 10/20, the coach works the app: a screen it opens, the microphone off or an app update happen once its answer
 * is complete, so he reads it first. */
let afterDone = [];
const deps = {
  rest,
  sync: () => { syncNow(); },
  pull: () => syncNow(),
  focus: (a) => {
    // Kept for a few minutes, so the session screen opens on that exercise when he goes back to it.
    try { sessionStorage.setItem('thq.coach.focus', JSON.stringify({ ...a, at: Date.now() })); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('thq:coach-focus', { detail: a }));
  },
  go: (url) => afterDone.push(() => { if (location.hash !== url) location.hash = url; }),
  micOff: () => afterDone.push(() => voiceStop()),
  reload: () => afterDone.push(() => updateApp()),
};
const runAfterDone = () => { const fns = afterDone; afterDone = []; setTimeout(() => fns.forEach((f) => f()), 700); };

function msgHtml(m, { live = false } = {}) {
  const who = m.role === 'user' ? (m.via === 'voice' ? 'YOU · VOICE' : 'YOU') : 'COACH';
  const cls = m.role === 'user' ? 'is-user' : m.error ? 'is-error' : 'is-coach';
  const tools = (m.tools || []);
  const opens = (m.actions || []).filter((a) => a.kind === 'open' && /^#\//.test(a.url || ''));
  return `<article class="c-msg ${cls}${live ? ' is-live' : ''}" data-id="${esc(m.id || '')}">
    <div class="hud c-meta"><span>${esc(formatTimeSec(new Date(m.at || Date.now())))} · ${who}</span>${m.role === 'assistant' && m.model ? `<span class="c-faint">${esc(MODEL_LABEL[m.model] || '')}</span>` : ''}</div>
    <p class="c-words">${m.text ? textHtml(m.text) : live ? '<span class="c-dots" aria-label="Thinking"><i></i><i></i><i></i></span>' : ''}</p>
    ${tools.length ? `<div class="hud c-tools">${toolChips(tools).map((t) => `<span class="${t.ok ? '' : 'c-amber'}" title="${esc(t.summary)}">${esc(t.label)}${t.count > 1 ? ` ×${t.count}` : ''}${t.ok ? '' : ' !'}</span>`).join('<span class="c-faint"> · </span>')}</div>` : ''}
    ${opens.length ? `<div class="c-acts">${opens.map((a) => `<a class="pill is-on" href="${esc(a.url)}">${esc(a.label || 'Open')}</a>`).join('')}</div>` : ''}
  </article>`;
}

function renderChat(view) {
  let repo; let stored = []; let live = []; let busy = null; let gone = false; let pendingLive = null;
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/today">Today</a><span class="btn-row tight" style="gap:6px"><a class="pill" href="#/coach/notes">Notes</a><button class="pill" id="c-more" type="button" aria-label="More">···</button></span></div>
    <div class="coach-head">
      <div><div class="hud c-muted">COACH · TEXT AND VOICE</div><div class="hud coach-state" id="c-state">…</div></div>
      <div class="seg" role="group" id="c-model">${Object.entries(MODEL_LABEL).map(([k, l]) => `<button class="pill" type="button" data-model="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    </div>
    <div class="fuel-head coach-day"><button class="pill" id="c-prev" type="button" aria-label="Day before">‹</button>
      <div class="hud c-muted" id="c-day"></div>
      <button class="pill" id="c-next" type="button" aria-label="Next day">›</button></div>
    <div class="coach-log" id="c-log" aria-live="polite"></div>
    <form class="coach-compose" id="c-form" autocomplete="off">
      <button class="btn-ghost coach-mic" id="c-mic" type="button" aria-label="Dictate into the box" aria-pressed="false">${MIC_ICON}</button>
      <textarea class="input coach-input" id="c-text" rows="1" placeholder="Message the coach" aria-label="Message to the coach"></textarea>
      <button class="btn-primary coach-send" id="c-send" type="submit" aria-label="Send">${SEND}</button>
    </form>
    <p class="hint coach-foot" id="c-foot">The coach runs on your Mac with your programme, history and rules. To talk instead of typing: <a href="#/voice">Settings > Voice</a>, then the mic at the top.</p>`;
  const $ = (q) => view.querySelector(q);
  const box = $('#c-text');
  box.value = draftGet();

  const setState = (text, cls = 'c-cyan') => { const el = $('#c-state'); el.textContent = text; el.className = `hud coach-state ${cls}`; };
  const idleState = () => {
    const s = getState();
    if (!s.paired) setState('NOT PAIRED WITH YOUR MAC', 'c-amber');
    else if (s.mac?.reachable === false) setState('MAC UNREACHABLE', 'c-amber');
    else setState(`READY · ${MODEL_LABEL[modelOf()]}`);
  };
  const drawModel = () => {
    const m = modelOf();
    view.querySelectorAll('[data-model]').forEach((b) => { const on = b.dataset.model === m; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
  };
  // The borders aren't in scrollHeight: without them the last line was cut (Thu 10/22, his screenshot).
  const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(160, box.scrollHeight + box.offsetHeight - box.clientHeight)}px`; };

  // Tue 10/20, his words: "the chat there... is just an endless scroll from multiple days' history... make it only one
  // per day and have a calendar there where I can click the arrows". One day at a time; today by default.
  let day = isoDate(new Date());
  const today = () => isoDate(new Date());
  const draw = ({ scroll = true } = {}) => {
    const all = messagesOf(stored, live.filter((m) => m !== pendingLive));
    // A day's first message sits right after its "New day" marker: only a "New conversation" mid-day is drawn as a line.
    const msgs = all.filter((m) => isoDate(new Date(m.at)) === day && !(m.role === 'marker' && m.text === 'New day'));
    const onToday = day === today();
    $('#c-day').textContent = formatDay(new Date(`${day}T12:00:00`)).toUpperCase() + (onToday ? ' · TODAY' : '');
    $('#c-next').disabled = onToday;
    const parts = msgs.map((m) => (m.role === 'marker' ? `<div class="hud c-faint coach-line">${esc(String(m.text || 'New conversation').toUpperCase())}</div>` : msgHtml(m)));
    if (!msgs.some((m) => m.role !== 'marker')) parts.length = 0;
    if (pendingLive && onToday) parts.push(msgHtml(pendingLive, { live: true }));
    $('#c-log').innerHTML = parts.join('') || (all.length && !onToday ? '<p class="hint coach-empty">Nothing on this day.</p>' : `<div class="card pad-card coach-empty"><div class="hud c-muted">ASK ANYTHING ABOUT YOUR TRAINING</div>
      <p class="hint c-text">"What's today?" · "Bench number?" · "80 for 8" · "Took creatine and mag" · "Knees 2, not worse; legs 1, back 0, energy 2" · "Set tomorrow at 4:30".</p>
      <p class="hint">It reads your programme, history, food, supplements, body and sauna, and logs what you tell it. It follows your rules and gives no medical or supplement advice.</p></div>`);
    if (scroll && onToday) window.scrollTo(0, document.documentElement.scrollHeight);
  };
  $('#c-prev').addEventListener('click', () => { day = addDays(day, -1); draw({ scroll: false }); window.scrollTo(0, 0); });
  $('#c-next').addEventListener('click', () => { if (day < today()) { day = addDays(day, 1); draw({ scroll: day === today() }); } });
  $('#c-day').addEventListener('click', () => { day = today(); draw(); });
  // The dictation mic: tap to record, tap again to put the words in the box (nothing sent).
  let dict = null;
  $('#c-mic').addEventListener('click', async () => {
    const b = $('#c-mic'); const box = $('#c-text');
    if (dict) {
      const d = dict; dict = null; b.classList.remove('is-rec'); b.setAttribute('aria-pressed', 'false'); b.classList.add('is-busy');
      try {
        const text = await d.stop();
        if (text) { box.value = `${box.value.trim()}${box.value.trim() ? ' ' : ''}${text}`; box.dispatchEvent(new Event('input')); box.focus(); } else toast('Nothing heard.');
      } catch (e) { toast(e.message || 'The Mac could not hear that.'); }
      b.classList.remove('is-busy');
      return;
    }
    try {
      dict = await startDictation();
      b.classList.add('is-rec'); b.setAttribute('aria-pressed', 'true');
      toast('Recording. Tap the mic again when you\'re done.');
    } catch (e) { toast(e.message || 'Microphone not available.'); }
  });

  const liveEl = () => view.querySelector('.c-msg.is-live');
  const updateLive = () => {
    const el = liveEl();
    if (!el) { draw(); return; }
    el.outerHTML = msgHtml(pendingLive, { live: true });
    window.scrollTo(0, document.documentElement.scrollHeight);
  };

  async function send(text) {
    rest.unlockAudio(); // a tap: lets the rest timer's sound play later on iPhone
    const ctrl = new AbortController();
    busy = ctrl;
    $('#c-send').classList.add('is-stop');
    $('#c-send').setAttribute('aria-label', 'Stop');
    setState('SENDING…');
    try { await syncNow(); } catch { /* send anyway */ }
    const model = modelOf();
    pendingLive = { id: '', role: 'assistant', text: '', at: Date.now(), tools: [], actions: [], model };
    const userTemp = { id: `tmp-${Date.now()}`, role: 'user', text, at: Date.now() };
    live.push(userTemp);
    draw();
    try {
      afterDone = [];
      await coachSend({
        text, model, tz: tz(), screen: location.hash, signal: ctrl.signal,
        onEvent: (e) => {
          if (gone) return;
          if (e.type === 'user') { live = live.filter((m) => m !== userTemp); live.push(e.message); pendingLive.at = e.message.at + 1; draw(); setState('THINKING…'); }
          else if (e.type === 'text') { pendingLive.text += e.delta; updateLive(); }
          else if (e.type === 'tool-start') setState(`USING ${String(e.name || '').toUpperCase().replace(/_/g, ' ')}…`);
          else if (e.type === 'tool') { pendingLive.tools.push(e.tool); updateLive(); setState('THINKING…'); }
          else if (e.type === 'action') { pendingLive.actions.push(e.action); runAction(e.action, deps); if (e.action.kind === 'open') updateLive(); }
          else if (e.type === 'done') { live.push(e.message); pendingLive = null; draw(); runAfterDone(); }
          else if (e.type === 'error') { pendingLive = { ...pendingLive, text: e.error, error: true }; updateLive(); }
        },
      });
      if (pendingLive && !pendingLive.error) { pendingLive = null; draw(); }
    } catch (e) {
      const stopped = e?.name === 'AbortError';
      if (!gone) {
        // Not even his message reached the Mac: it goes back in the box. Otherwise the answer comes by sync.
        const unsent = live.includes(userTemp);
        live = live.filter((m) => m !== userTemp);
        pendingLive = null;
        if (unsent && !box.value) { box.value = text; draftSet(text); fit(); }
        if (!stopped) toast(e.message);
        draw();
      }
    } finally {
      busy = null;
      if (!gone) { $('#c-send').classList.remove('is-stop'); $('#c-send').setAttribute('aria-label', 'Send'); idleState(); }
      syncNow().catch(() => {});
    }
  }

  $('#c-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy) {
      busy.abort();
      macPost('/api/coach/stop').catch(() => {});
      toast('Stopped.');
      return;
    }
    const text = box.value.trim();
    if (!text) return;
    if (!getState().paired) { toast('Pair with your Mac first (Settings).'); return; }
    box.value = ''; draftSet(''); fit();
    send(text);
  });
  box.addEventListener('input', () => { draftSet(box.value); fit(); });
  box.addEventListener('keydown', (ev) => {
    // On the Mac: Enter sends, Shift+Enter is a new line. On the phone the keyboard's return key adds a line.
    if (ev.key === 'Enter' && !ev.shiftKey && !('ontouchstart' in window)) { ev.preventDefault(); $('#c-form').requestSubmit(); }
  });
  view.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', async () => {
    await saveSettings({ coach: { model: b.dataset.model } });
    drawModel(); idleState();
    toast(b.dataset.model === 'deep' ? 'Opus 5.5 at high effort: deeper, slower.' : 'Sonnet 5.5 at low effort: quick answers.');
    macPost('/api/coach/warm', { model: b.dataset.model }).catch(() => {});
  }));
  $('#c-more').onclick = () => actionSheet('Coach', [
    { label: 'New conversation', run: async () => {
      if (!(await confirmSheet('Start a new conversation? The coach forgets this chat (the log stays here, above a line).', { ok: 'New conversation' }))) return;
      try { await macPost('/api/coach/new'); await syncNow(); toast('New conversation.'); } catch (e) { toast(e.message); }
    } },
    { label: 'Which Claude (Settings)', run: () => { location.hash = '#/settings'; } },
  ]);

  // A spoken turn (lib/voice.js) shows here live, the same way as a typed one.
  const onVoice = (ev) => {
    const e = ev.detail || {};
    if (busy || gone) return;
    if (e.type === 'heard' && e.ok) { pendingLive = { id: '', role: 'assistant', text: '', at: Date.now(), tools: [], actions: [], model: modelOf() }; setState('THINKING…'); }
    else if (!pendingLive) return;
    else if (e.type === 'user') { live.push(e.message); pendingLive.at = e.message.at + 1; draw(); }
    else if (e.type === 'text') { pendingLive.text += e.delta; updateLive(); }
    else if (e.type === 'tool-start') setState(`USING ${String(e.name || '').toUpperCase().replace(/_/g, ' ')}…`);
    else if (e.type === 'tool') { pendingLive.tools.push(e.tool); updateLive(); setState('THINKING…'); }
    else if (e.type === 'action') { pendingLive.actions.push(e.action); if (e.action.kind === 'open') updateLive(); }
    else if (e.type === 'done') { live.push(e.message); pendingLive = null; draw(); idleState(); }
    else if (e.type === 'error') { pendingLive = null; draw(); idleState(); }
  };
  window.addEventListener('thq:voice-event', onVoice);
  const unsub = subscribe(() => { if (!busy) idleState(); drawModel(); });
  let off = () => {};
  ready.then(async (r) => {
    repo = r;
    const load = async () => { stored = (await repo.list('coach-messages')); live = live.filter((m) => !stored.some((x) => x.id === m.id)); };
    await load();
    if (gone) return;
    draw(); drawModel(); idleState(); fit();
    off = repo.onChange(async (cols) => { if (cols.includes('coach-messages')) { await load(); if (!gone) draw({ scroll: !busy }); } });
    // Start the coach's Claude on the Mac now, so the first answer comes sooner.
    if (getState().paired) macPost('/api/coach/warm', { model: modelOf() }).then(() => { if (!busy) idleState(); }).catch(() => { if (!busy) setState('MAC UNREACHABLE', 'c-amber'); });
  });
  return () => { gone = true; busy?.abort(); unsub(); off(); dict?.cancel(); window.removeEventListener('thq:voice-event', onVoice); };
}

function renderNotes(view) {
  let gone = false;
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  ready.then((repo) => {
    const draw = async () => {
      const [notes, rems, changes] = await Promise.all([repo.list('coach-notes'), repo.list('coach-reminders'), repo.list('coach-changes')]);
      if (gone) return;
      const now = Date.now();
      const upcoming = rems.filter((r) => !r.cancelledAt && !r.firedAt && (r.trigger || r.at > now - 3600000)).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
      const sorted = notes.sort((a, b) => b.at - a.at);
      // Thu 10/22: what he asked the coach to change about itself, built on the Mac; newest first.
      const asked = changes.filter((c) => c.status !== 'cancelled').sort((a, b) => b.at - a.at).slice(0, 20);
      view.innerHTML = `
        <div class="lib-head"><a class="pill" href="#/coach">Talk</a></div>
        <h1 class="view-title">Coach notes</h1>
        <p class="hint">What the coach wrote down for you, the reminders it set, and the changes you asked for. Ask it to note something, to remind you at a time, or to talk or behave differently.</p>
        <div class="section-label">Reminders · ${upcoming.length}</div>
        <section class="card supp-group">${upcoming.map((r) => `<div class="supp-item" data-rem="${esc(r.id)}"><div class="supp-main"><b>${esc(r.text)}</b>
          <span class="hint">${r.trigger ? `When you start your workout log, ${esc(formatDay(new Date(`${r.date}T12:00:00Z`), 'UTC'))} or later` : `${esc(formatDay(new Date(r.at)))}, ${esc(formatTime(new Date(r.at)))}`}</span></div><span class="supp-btns"><button class="btn-ghost small" type="button" data-cancel>Cancel</button></span></div>`).join('')
          || '<p class="hint pad">None set.</p>'}</section>
        <div class="section-label">Changes you asked for · ${asked.length}</div>
        <section class="card supp-group">${asked.map((c) => { const v = changeView(c); return `<div class="supp-item"><div class="supp-main"><b>${textHtml(c.said)}</b>
          <span class="hint"><span class="${v.cls}">${esc(v.label)}</span> · ${esc(dayAt(c.at, c))}, ${esc(timeAt(c.at, c))}${v.by ? ` · ${esc(v.by)}` : ''}</span>
          ${v.later.map((l) => `<span class="hint">${esc(timeAt(l.at, c))} ${textHtml(l.text)}</span>`).join('')}
          ${c.answer ? `<span class="hint c-text">${textHtml(c.answer)}</span>` : ''}
          ${v.checked ? `<span class="hint">${textHtml(v.checked)}</span>` : ''}</div></div>`; }).join('')
          || '<p class="hint pad">None yet. Tell the coach what you don\'t like about how it talks; the Mac changes it and the coach tells you when it\'s done.</p>'}</section>
        <div class="section-label">Notes · ${sorted.length}</div>
        <section class="card supp-group">${sorted.map((n) => `<div class="supp-item" data-note="${esc(n.id)}"><div class="supp-main"><b>${textHtml(n.text)}</b>
          <span class="hint">${esc(dayAt(n.at, n))}, ${esc(timeAt(n.at, n))}${n.topic ? ` · ${esc(n.topic)}` : ''}</span></div><span class="supp-btns"><button class="btn-ghost small" type="button" data-del>Delete</button></span></div>`).join('')
          || '<p class="hint pad">No notes yet.</p>'}</section>`;
      view.querySelectorAll('[data-rem] [data-cancel]').forEach((b) => b.addEventListener('click', async () => {
        const r = rems.find((x) => x.id === b.closest('[data-rem]').dataset.rem);
        await repo.put('coach-reminders', r.id, { ...r, cancelledAt: Date.now() });
        toast('Reminder cancelled.');
      }));
      view.querySelectorAll('[data-note] [data-del]').forEach((b) => b.addEventListener('click', async () => {
        const n = notes.find((x) => x.id === b.closest('[data-note]').dataset.note);
        if (!(await confirmSheet('Delete this note?', { ok: 'Delete', danger: true }))) return;
        await repo.remove('coach-notes', n.id);
      }));
    };
    draw();
    const off = repo.onChange((cols) => { if (cols.some((c) => ['coach-notes', 'coach-reminders', 'coach-changes'].includes(c))) draw(); });
    view._off = off;
  });
  return () => { gone = true; view._off?.(); };
}

export function render(view, params = []) {
  if (params[0] === 'notes') return renderNotes(view);
  return renderChat(view);
}
