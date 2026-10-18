// VOICE (step 9, brief section 12): only his voice. Settings > Voice.
//   #/voice                  where it stands: calibration rounds, the test, strictness, listening on this device
//   #/voice/calibrate/home   read the phrases out loud at home (quiet room), about a minute
//   #/voice/calibrate/gym    the same at the gym with the music on
//   #/voice/test             talk and see the match score; someone else talks and is rejected
// The voiceprint is made and kept on the Mac (private folder only); this screen only records and shows scores.
import { ready, macGet, macPost, macSendRaw, saveSettings } from '../lib/data.js';
import { getState, subscribe } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { micSession } from '../lib/voice-rec.js';
import { calibrationPhrases, REASON_TEXT, ENROL_PROBLEM } from '../lib/voice-text.js';
import * as voice from '../lib/voice.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vs = () => withDefaults(getState().settings).voice;
const COND = { home: { title: 'Home round', where: 'at home, in a quiet room', label: 'HOME' }, gym: { title: 'Gym round', where: 'at the gym, with the music playing', label: 'GYM · MUSIC ON' } };
const STRICT = [['strict', 'Strict'], ['normal', 'Normal'], ['relaxed', 'Relaxed']];

const meter = () => '<div class="v-meter" aria-hidden="true"><i class="v-level"></i><b class="v-th"></b></div>';
/** Mic level on a log scale (quiet room near the left, shouting near the right). */
const levelPct = (x) => Math.max(0, Math.min(100, ((Math.log10(Math.max(x, 1e-4)) + 4) / 3.6) * 100));
function drawMeter(box, level, th) {
  const l = box.querySelector('.v-level'); const t = box.querySelector('.v-th');
  if (l) l.style.width = `${levelPct(level)}%`;
  if (t) t.style.left = `${levelPct(th)}%`;
}

const scoreLine = (st) => (st.self ? `Your own phrases score ${st.self.low} to ${st.self.median} and up against each other; ${STRICT.find(([k]) => k === st.strictness)?.[1].toLowerCase()} needs ${st.threshold}. ${st.self.missRate ? `About ${st.self.missRate}% of your phrases would be missed at this setting.` : 'None of your phrases would be missed.'}` : '');

function hub(view) {
  let gone = false; let st = null; let err = null;
  const draw = () => {
    if (gone) return;
    const s = vs();
    const listen = voice.listening();
    const r = st?.rounds;
    const round = (c) => (r ? `${r[c].count} phrase${r[c].count === 1 ? '' : 's'}${r[c].done ? ' · DONE' : ''}` : '…');
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/settings">Settings</a><a class="pill" href="#/coach">Talk</a></div>
      <h1 class="view-title">Voice</h1>
      <p class="hint">The coach acts on your voice only. Your Mac checks every word it hears against your voiceprint before anything happens; anyone else, and music, is ignored completely. Your voiceprint stays in your private folder on the Mac.</p>
      ${err ? `<div class="card pad-card"><div class="hud c-amber">${esc(err)}</div><p class="hint">Voice needs your Mac (the check runs there). Try again when it's connected.</p></div>` : ''}
      ${st?.engine?.missing?.length ? `<div class="card pad-card"><div class="hud c-amber">VOICE CHECK NOT INSTALLED ON THE MAC</div><p class="hint">Run <code>node scripts/voice-setup.mjs</code> in the code folder on the Mac.</p></div>` : ''}
      <div class="section-label">1 · Calibrate</div>
      <ul class="lib-list">
        <li><a class="lib-row" href="#/voice/calibrate/home"><span class="lib-name">Home round</span><span class="lib-meta ${r?.home.done ? 'c-green' : ''}">${round('home')} · quiet room, about a minute</span></a></li>
        <li><a class="lib-row" href="#/voice/calibrate/gym"><span class="lib-name">Gym round</span><span class="lib-meta ${r?.gym.done ? 'c-green' : ''}">${round('gym')} · at the gym with music, so it knows you there</span></a></li>
      </ul>
      <div class="section-label">2 · Test</div>
      <ul class="lib-list">
        <li><a class="lib-row" href="#/voice/test"><span class="lib-name">Test it</span><span class="lib-meta ${st?.tested ? 'c-green' : ''}">${st ? (st.tested ? `PASSED · you ${st.tests.meMatched}/${st.tests.me}, others rejected ${st.tests.otherRejected}/${st.tests.other}` : st.calibrated ? 'Talk and see your match score; then let someone else try' : 'After the home round') : '…'}</span></a></li>
      </ul>
      <div class="section-label">3 · Listen</div>
      <div class="card opt-list">
        <div class="opt"><div class="opt-text">Listen on this ${/iPhone|iPad/.test(navigator.userAgent) ? 'phone' : 'device'}<small>${st?.canListen ? 'While Training HQ is open and on screen. The screen stays on while it listens. Tap the mic in the header to pause.' : 'Stays off until the home round is done and a test has passed (brief section 12).'}</small></div>
          <input class="switch" type="checkbox" role="switch" id="v-listen" ${listen ? 'checked' : ''} ${st?.canListen || listen ? '' : 'disabled'}></div>
        <div class="opt"><div class="opt-text">How sure it must be that it's you<small>${esc(scoreLine(st || {}) || 'Strict (the default) misses you now and then (repeat yourself or tap); it never acts on a voice it isn\'t sure of.')}</small></div></div>
        <div class="seg" role="group" id="v-strict">${STRICT.map(([k, l]) => `<button class="pill ${s.strictness === k ? 'is-on' : ''}" type="button" data-k="${k}" aria-pressed="${s.strictness === k}">${l}</button>`).join('')}</div>
        <div class="opt"><div class="opt-text">Answer out loud<small>The coach's voice comes from your Mac (ElevenLabs). Off: answers only on screen.</small></div><input class="switch" type="checkbox" role="switch" id="v-speak" ${s.speak ? 'checked' : ''}></div>
        <div class="opt"><div class="opt-text">Show "not you" readout<small>A small silent line in the header when speech was heard and ignored, and why (NOT YOU, MUSIC, NOISE).</small></div><input class="switch" type="checkbox" role="switch" id="v-readout" ${s.readout ? 'checked' : ''}></div>
      </div>
      <div class="section-label">What it can't guarantee</div>
      <div class="card pad-card"><ul class="v-list hint">
        <li>A recording of your own voice played back (a video, a voice note) sounds like you and can pass.</li>
        <li>Someone whose voice is very like yours may pass now and then; strict makes that rare, not impossible.</li>
        <li>It misses you sometimes, more at the gym with loud music, when you shout, whisper or have a cold. Repeat yourself, or tap.</li>
        <li>Only while the app is open and on screen: iPhone stops the microphone when it locks or you switch apps.</li>
        <li>Very short words ("yes", "next") carry little of your voice; strict may ignore them. Say a few words.</li>
      </ul></div>
      <div class="section-label">Start again</div>
      <div class="btn-row"><button class="btn-ghost small" type="button" id="v-redo-gym" ${r?.gym.count ? '' : 'disabled'}>Redo gym round</button><button class="btn-ghost small" type="button" id="v-forget" ${st?.samples ? '' : 'disabled'}>Delete voiceprint</button></div>`;
    const $ = (q) => view.querySelector(q);
    $('#v-listen').onchange = async (ev) => {
      if (ev.target.checked) {
        try { await voice.start({ tap: true }); toast('Listening while the app is open.'); } catch (e) { ev.target.checked = false; toast(e.message); }
      } else { voice.stop(); toast('Not listening on this device.'); }
      draw();
    };
    view.querySelectorAll('#v-strict [data-k]').forEach((b) => b.addEventListener('click', async () => { await saveSettings({ voice: { strictness: b.dataset.k } }); await load(); }));
    $('#v-speak').onchange = (ev) => saveSettings({ voice: { speak: ev.target.checked } });
    $('#v-readout').onchange = (ev) => saveSettings({ voice: { readout: ev.target.checked } });
    $('#v-redo-gym').onclick = async () => {
      if (!(await confirmSheet('Delete the gym round? Record it again at the gym.', { ok: 'Delete gym round', danger: true }))) return;
      try { st = (await macPost('/api/voice/forget', { condition: 'gym' })).status; draw(); } catch (e) { toast(e.message); }
    };
    $('#v-forget').onclick = async () => {
      if (!(await confirmSheet('Delete your voiceprint and all calibration recordings on the Mac? Listening switches off until you calibrate and test again.', { ok: 'Delete', danger: true }))) return;
      try { voice.stop(); st = (await macPost('/api/voice/forget', {})).status; toast('Voiceprint deleted.'); draw(); } catch (e) { toast(e.message); }
    };
  };
  const load = async () => {
    try { st = await macGet('/api/voice/status'); err = null; } catch (e) { err = e.message; }
    draw();
  };
  view.innerHTML = '<p class="view-sub">Loading…</p>';
  ready.then(load);
  const unsub = subscribe(() => { if (st) draw(); });
  const offVoice = voice.onChange(() => { if (st) draw(); });
  return () => { gone = true; unsub(); offVoice(); };
}

function calibrate(view, cond) {
  const c = COND[cond] || COND.home;
  let gone = false; let rec = null; let i = 0; let kept = 0; let busy = false; let phrases = calibrationPhrases();
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/voice">Voice</a><span class="hud c-faint">${c.label}</span></div>
    <h1 class="view-title">${c.title}</h1>
    <p class="hint">Read each line out loud ${c.where}, the way you'd say it between sets. It moves on by itself when it has heard you. About a minute.</p>
    <div class="card pad-card v-cal">
      <div class="hud c-muted" id="v-count"></div>
      <p class="v-phrase" id="v-phrase"></p>
      ${meter()}
      <div class="hud v-state" id="v-state">TAP START</div>
    </div>
    <div class="btn-row"><button class="btn-primary" type="button" id="v-go">Start</button><button class="btn-ghost small" type="button" id="v-skip" disabled>Skip this one</button></div>
    <p class="hint" id="v-note"></p>`;
  const $ = (q) => view.querySelector(q);
  const setState = (t, cls = 'c-cyan') => { const el = $('#v-state'); if (el) { el.textContent = t; el.className = `hud v-state ${cls}`; } };
  const show = () => {
    $('#v-count').textContent = `PHRASE ${Math.min(i + 1, phrases.length)} / ${phrases.length} · KEPT ${kept}`;
    $('#v-phrase').textContent = i < phrases.length ? `"${phrases[i]}"` : '';
  };
  const finish = async () => {
    rec?.close(); rec = null;
    $('#v-go').textContent = 'Done'; $('#v-go').onclick = () => { location.hash = '#/voice'; };
    $('#v-skip').disabled = true;
    let st = null;
    try { st = await macGet('/api/voice/status'); } catch { /* shown below */ }
    const done = st?.rounds?.[cond]?.done;
    setState(done ? `${c.label} ROUND DONE` : 'NOT ENOUGH PHRASES YET', done ? 'c-green' : 'c-amber');
    $('#v-phrase').textContent = '';
    $('#v-note').textContent = done ? (st.tested || cond === 'gym' ? 'Saved on your Mac.' : 'Saved on your Mac. Next: test it (Voice > Test it).') : `Kept ${kept}. It needs at least 8: start again to add more.`;
  };
  const onClip = async (wav) => {
    if (busy || gone || i >= phrases.length) return;
    busy = true; rec.pause();
    setState('CHECKING…');
    try {
      const r = await macSendRaw(`/api/voice/enrol?condition=${cond}&phrase=${encodeURIComponent(phrases[i])}`, wav);
      if (gone) return;
      if (r.ok) {
        kept++; i++;
        setState(`GOT IT · ${r.speechSec} S`, 'c-green');
        $('#v-note').textContent = cond === 'home' && r.music > 0.4 ? 'There is music in the background: the home round should be quiet.' : '';
      } else {
        setState('AGAIN', 'c-amber');
        $('#v-note').textContent = ENROL_PROBLEM[r.problem] || 'Say it again.';
      }
    } catch (e) {
      setState('MAC UNREACHABLE', 'c-amber');
      $('#v-note').textContent = e.message;
    }
    busy = false;
    if (gone) return;
    show();
    if (i >= phrases.length) { finish(); return; }
    setTimeout(() => { if (!gone && rec) { rec.resume(); setState('LISTENING · SAY IT NOW'); } }, 700);
  };
  $('#v-go').onclick = async () => {
    if (rec) { rec.close(); rec = null; $('#v-go').textContent = 'Start'; $('#v-skip').disabled = true; setState('PAUSED'); return; }
    try {
      rec = await micSession({
        onClip,
        onLevel: (l, th) => drawMeter(view, l, th),
        onEvent: (e) => { if (e.type === 'start') setState('HEARING YOU…'); else if (e.type === 'noise' && !busy) setState('LISTENING · SAY IT NOW'); },
        onEnded: () => { rec = null; setState('MICROPHONE STOPPED · TAP START', 'c-amber'); $('#v-go').textContent = 'Start'; },
      });
      if (gone) { rec.close(); return; }
      $('#v-go').textContent = 'Pause'; $('#v-skip').disabled = false;
      setState('LISTENING · SAY IT NOW');
    } catch (e) { toast(e.message); setState(e.message.toUpperCase(), 'c-amber'); }
  };
  $('#v-skip').onclick = () => { i++; show(); if (i >= phrases.length) finish(); };
  ready.then(async (repo) => {
    // His own supplement names go into two of the phrases.
    const supps = (await repo.list('supplements')).filter((x) => !x.removedAt && !x.paused).map((x) => x.name);
    if (!gone) { phrases = calibrationPhrases(supps); show(); }
  });
  show();
  return () => { gone = true; rec?.close(); };
}

function testScreen(view) {
  let gone = false; let rec = null; let kind = 'me'; let busy = false;
  const results = [];
  view.innerHTML = `
    <div class="lib-head"><a class="pill" href="#/voice">Voice</a></div>
    <h1 class="view-title">Test your voice</h1>
    <p class="hint">Talk normally and watch your score. Then pick "Someone else" and let another person talk (or play a video of someone speaking): they must be rejected. Nothing said here is acted on.</p>
    <div class="seg" role="group" id="v-kind"><button class="pill is-on" type="button" data-k="me" aria-pressed="true">Me</button><button class="pill" type="button" data-k="other" aria-pressed="false">Someone else</button></div>
    <div class="card pad-card v-test">
      <div class="hud c-muted">MATCH SCORE</div>
      <div class="v-score" id="v-score">—</div>
      <div class="hud v-verdict" id="v-verdict">TAP START, THEN TALK</div>
      ${meter()}
    </div>
    <div class="btn-row"><button class="btn-primary" type="button" id="v-go">Start</button></div>
    <div class="section-label">This test</div>
    <div class="card supp-group" id="v-results"><p class="hint pad">Nothing yet.</p></div>`;
  const $ = (q) => view.querySelector(q);
  const drawResults = () => {
    $('#v-results').innerHTML = results.slice(-8).reverse().map((r) => {
      const good = r.kind === 'me' ? r.ok : !r.ok;
      return `<div class="supp-item"><div class="supp-main"><b>${r.kind === 'me' ? 'You' : 'Someone else'} · ${esc(REASON_TEXT[r.reason] || r.reason)}</b><span class="hint">score ${r.score ?? '—'} · needs ${r.threshold} · ${r.speechSec} s of speech</span></div><span class="hud ${good ? 'c-green' : 'c-amber'}">${good ? 'AS IT SHOULD' : r.kind === 'me' ? 'MISSED YOU' : 'LET IN!'}</span></div>`;
    }).join('') || '<p class="hint pad">Nothing yet.</p>';
  };
  view.querySelectorAll('#v-kind [data-k]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.k;
    view.querySelectorAll('#v-kind [data-k]').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
  }));
  const onClip = async (wav) => {
    if (busy || gone) return;
    busy = true; rec.pause();
    $('#v-verdict').textContent = 'CHECKING…';
    try {
      const r = await macSendRaw(`/api/voice/test?kind=${kind}`, wav);
      if (gone) return;
      results.push({ ...r, kind });
      $('#v-score').textContent = r.score == null ? '—' : r.score.toFixed(2);
      $('#v-score').className = `v-score ${r.ok ? 'c-green' : 'c-amber'}`;
      $('#v-verdict').textContent = `${r.ok ? 'MATCH · YOU' : REASON_TEXT[r.reason] || r.reason} · NEEDS ${r.threshold}`;
      $('#v-verdict').className = `hud v-verdict ${r.ok ? 'c-green' : 'c-amber'}`;
      drawResults();
      if (r.status?.canListen && kind === 'me' && r.ok && !voice.listening()) toast('Test passed. Listening can be switched on (Voice).');
    } catch (e) {
      $('#v-verdict').textContent = e.message.toUpperCase();
    }
    busy = false;
    if (!gone && rec) rec.resume();
  };
  $('#v-go').onclick = async () => {
    if (rec) { rec.close(); rec = null; $('#v-go').textContent = 'Start'; $('#v-verdict').textContent = 'PAUSED'; return; }
    try {
      rec = await micSession({ onClip, onLevel: (l, th) => drawMeter(view, l, th), onEvent: (e) => { if (e.type === 'start') $('#v-verdict').textContent = 'HEARING…'; }, onEnded: () => { rec = null; $('#v-go').textContent = 'Start'; } });
      if (gone) { rec.close(); return; }
      $('#v-go').textContent = 'Stop';
      $('#v-verdict').textContent = 'LISTENING · TALK NOW';
    } catch (e) { toast(e.message); }
  };
  // Listening elsewhere in the app pauses while this screen tests (one microphone user at a time).
  voice.hold(true);
  return () => { gone = true; rec?.close(); voice.hold(false); };
}

export function render(view, params = []) {
  if (params[0] === 'calibrate') { voice.hold(true); const off = calibrate(view, params[1]); return () => { off(); voice.hold(false); }; }
  if (params[0] === 'test') return testScreen(view);
  return hub(view);
}
