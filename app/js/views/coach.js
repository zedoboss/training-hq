// TALK (step 8): the coach by text, on the phone and in the Mac's browser. Same conversation on both (it syncs).
//   #/coach        the log (time, who, the words, the tools used) and the box to type in; Sonnet or Opus
//   #/coach/notes  notes the coach kept for him and the reminders it set
// The coach itself runs on the Mac (Claude Code); this screen needs the Mac. Voice arrives in step 9.
import { ready, syncNow, coachSend, macPost, saveSettings } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, formatTimeSec, formatTime, isoDate } from '../lib/time.js';
import * as rest from '../lib/rest-timer.js';
import { conversationOf, MODEL_LABEL, toolLabel, runAction, textHtml } from '../lib/coach.js';
import { actionSheet, confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DRAFT = 'thq.coach.draft';
const draftGet = () => { try { return localStorage.getItem(DRAFT) || ''; } catch { return ''; } };
const draftSet = (v) => { try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* private mode */ } };
const modelOf = () => withDefaults(getState().settings).coach.model;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const SEND = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>';

/** Actions the coach asked this device for (its rest timer, a sync, moving the session screen to an exercise). */
const deps = {
  rest,
  sync: () => { syncNow(); },
  focus: (a) => window.dispatchEvent(new CustomEvent('thq:coach-focus', { detail: a })),
};

function msgHtml(m, { live = false } = {}) {
  const who = m.role === 'user' ? 'YOU' : 'COACH';
  const cls = m.role === 'user' ? 'is-user' : m.error ? 'is-error' : 'is-coach';
  const tools = (m.tools || []);
  const opens = (m.actions || []).filter((a) => a.kind === 'open' && /^#\//.test(a.url || ''));
  return `<article class="c-msg ${cls}${live ? ' is-live' : ''}" data-id="${esc(m.id || '')}">
    <div class="hud c-meta"><span>${esc(formatTimeSec(new Date(m.at || Date.now())))} · ${who}</span>${m.role === 'assistant' && m.model ? `<span class="c-faint">${esc(MODEL_LABEL[m.model] || '')}</span>` : ''}</div>
    <p class="c-words">${m.text ? textHtml(m.text) : live ? '<span class="c-dots" aria-label="Thinking"><i></i><i></i><i></i></span>' : ''}</p>
    ${tools.length ? `<div class="hud c-tools">${tools.map((t) => `<span class="${t.ok ? '' : 'c-amber'}" title="${esc(t.summary || '')}">${esc(toolLabel(t))}${t.ok ? '' : ' !'}</span>`).join('<span class="c-faint"> · </span>')}</div>` : ''}
    ${opens.length ? `<div class="c-acts">${opens.map((a) => `<a class="pill is-on" href="${esc(a.url)}">${esc(a.label || 'Open')}</a>`).join('')}</div>` : ''}
  </article>`;
}

function renderChat(view) {
  let repo; let stored = []; let live = []; let busy = null; let gone = false; let pendingLive = null;
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/today">Today</a><span class="btn-row tight" style="gap:6px"><a class="pill" href="#/coach/notes">Notes</a><button class="pill" id="c-more" type="button" aria-label="More">···</button></span></div>
    <div class="coach-head">
      <div><div class="hud c-muted">COACH · BY TEXT</div><div class="hud coach-state" id="c-state">…</div></div>
      <div class="seg" role="group" id="c-model">${Object.entries(MODEL_LABEL).map(([k, l]) => `<button class="pill" type="button" data-model="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    </div>
    <div class="coach-log" id="c-log" aria-live="polite"></div>
    <form class="coach-compose" id="c-form" autocomplete="off">
      <textarea class="input coach-input" id="c-text" rows="1" placeholder="Ask, or tell it what you did: 80 for 8" aria-label="Message to the coach"></textarea>
      <button class="btn-primary coach-send" id="c-send" type="submit" aria-label="Send">${SEND}</button>
    </form>
    <p class="hint coach-foot" id="c-foot">The coach runs on your Mac with your programme, history and rules. Voice arrives in step 9.</p>`;
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
  const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(160, box.scrollHeight)}px`; };

  const draw = ({ scroll = true } = {}) => {
    const msgs = conversationOf(stored, live.filter((m) => m !== pendingLive));
    let lastDay = '';
    const parts = [];
    for (const m of msgs) {
      const d = isoDate(new Date(m.at));
      if (d !== lastDay) { parts.push(`<div class="section-label">${esc(formatDay(new Date(m.at)).toUpperCase())}</div>`); lastDay = d; }
      parts.push(msgHtml(m));
    }
    if (pendingLive) parts.push(msgHtml(pendingLive, { live: true }));
    $('#c-log').innerHTML = parts.join('') || `<div class="card pad-card coach-empty"><div class="hud c-muted">ASK ANYTHING ABOUT YOUR TRAINING</div>
      <p class="hint c-text">"What's today?" · "Bench number?" · "80 for 8" · "Took creatine and mag" · "Knees 2, not worse; legs 1, back 0, energy 2" · "Set tomorrow at 4:30".</p>
      <p class="hint">It reads your programme, history, food, supplements, body and sauna, and logs what you tell it. It follows your rules and gives no medical or supplement advice.</p></div>`;
    if (scroll) window.scrollTo(0, document.documentElement.scrollHeight);
  };

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
      await coachSend({
        text, model, tz: tz(), signal: ctrl.signal,
        onEvent: (e) => {
          if (gone) return;
          if (e.type === 'user') { live = live.filter((m) => m !== userTemp); live.push(e.message); pendingLive.at = e.message.at + 1; draw(); setState('THINKING…'); }
          else if (e.type === 'text') { pendingLive.text += e.delta; updateLive(); }
          else if (e.type === 'tool-start') setState(`USING ${String(e.name || '').toUpperCase().replace(/_/g, ' ')}…`);
          else if (e.type === 'tool') { pendingLive.tools.push(e.tool); updateLive(); setState('THINKING…'); }
          else if (e.type === 'action') { pendingLive.actions.push(e.action); runAction(e.action, deps); if (e.action.kind === 'open') updateLive(); }
          else if (e.type === 'done') { live.push(e.message); pendingLive = null; draw(); }
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
  return () => { gone = true; busy?.abort(); unsub(); off(); };
}

function renderNotes(view) {
  let gone = false;
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  ready.then((repo) => {
    const draw = async () => {
      const [notes, rems] = await Promise.all([repo.list('coach-notes'), repo.list('coach-reminders')]);
      if (gone) return;
      const now = Date.now();
      const upcoming = rems.filter((r) => !r.cancelledAt && r.at > now - 3600000).sort((a, b) => a.at - b.at);
      const sorted = notes.sort((a, b) => b.at - a.at);
      view.innerHTML = `
        <div class="lib-head"><a class="pill" href="#/coach">Talk</a></div>
        <h1 class="view-title">Coach notes</h1>
        <p class="hint">What the coach wrote down for you, and the reminders it set. Ask it to note something, or to remind you at a time.</p>
        <div class="section-label">Reminders · ${upcoming.length}</div>
        <section class="card supp-group">${upcoming.map((r) => `<div class="supp-item" data-rem="${esc(r.id)}"><div class="supp-main"><b>${esc(r.text)}</b>
          <span class="hint">${esc(formatDay(new Date(r.at)))}, ${esc(formatTime(new Date(r.at)))}</span></div><span class="supp-btns"><button class="btn-ghost small" type="button" data-cancel>Cancel</button></span></div>`).join('')
          || '<p class="hint pad">None set.</p>'}</section>
        <div class="section-label">Notes · ${sorted.length}</div>
        <section class="card supp-group">${sorted.map((n) => `<div class="supp-item" data-note="${esc(n.id)}"><div class="supp-main"><b>${textHtml(n.text)}</b>
          <span class="hint">${esc(formatDay(new Date(n.at)))}, ${esc(formatTime(new Date(n.at)))}${n.topic ? ` · ${esc(n.topic)}` : ''}</span></div><span class="supp-btns"><button class="btn-ghost small" type="button" data-del>Delete</button></span></div>`).join('')
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
    const off = repo.onChange((cols) => { if (cols.some((c) => ['coach-notes', 'coach-reminders'].includes(c))) draw(); });
    view._off = off;
  });
  return () => { gone = true; view._off?.(); };
}

export function render(view, params = []) {
  if (params[0] === 'notes') return renderNotes(view);
  return renderChat(view);
}
