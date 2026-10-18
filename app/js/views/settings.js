// SETTINGS: link to the Mac (pairing, sync status), workout settings (2.19), equipment, units, app details.
// Settings are synced documents (col 'settings', ids 'main' and 'equipment'); every change saves at once.
import { appVersion, latestVersion, checkForUpdate, reloadAppFiles } from '../lib/sw-client.js';
import { getState, subscribe } from '../lib/store.js';
import { ready, pair, unpair, syncNow, newPairingCode, sameOriginMac, saveSettings, saveEquipment } from '../lib/data.js';
import { formatTime, formatDay } from '../lib/time.js';
import { REST_CHOICES, restText, SOUNDS, WEEK_DAYS, PLATE_CHOICES, withDefaults, equipmentWithDefaults, cleanWarmupSteps, smallestPlate } from '../lib/settings.js';
import { EQUIPMENT } from '../lib/exercise-types.js';
import { warmupSets } from '../lib/plates.js';
import { kg as fmtKg } from '../lib/loads.js';
import { unlockAudio, play } from '../lib/sounds.js';
import { notifyPanel } from '../ui/notify-panel.js';
import { toast } from '../ui/toast.js';
import { confirmSheet } from '../ui/sheet.js';

const isPhone = /iPhone|iPad|Android/.test(navigator.userAgent);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function when(ms) {
  if (!ms) return 'never';
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? formatTime(d) : `${formatDay(d)}, ${formatTime(d)}`;
}

function statusLine(s) {
  if (!s.paired) return '<span class="c-amber">Not paired</span>';
  if (s.sync.running) return '<span class="c-cyan">Syncing…</span>';
  if (s.mac.reachable === false) return `<span class="c-amber">Mac unreachable${s.mac.lastSeen ? ` since ${when(s.mac.lastSeen)}` : ''}</span>`;
  if (s.mac.lastError) return `<span class="c-amber">${esc(s.mac.lastError)}</span>`;
  if (s.mac.reachable) return '<span class="c-green">Connected</span>';
  return '<span class="c-muted">Checking…</span>';
}

const sel = (name, options, value) => `<select class="input mini" data-s="${name}">${options.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
const seg = (name, options, value) => `<div class="seg" role="group">${options.map(([v, label]) => `<button class="pill ${String(v) === String(value) ? 'is-on' : ''}" data-seg="${name}" data-v="${esc(v)}" type="button" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`).join('')}</div>`;
const sw = (name, on) => `<input class="switch" type="checkbox" role="switch" data-s="${name}" ${on ? 'checked' : ''}>`;
const opt = (text, sub, control) => `<div class="opt"><div class="opt-text">${text}${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;
const restOptions = REST_CHOICES.map((x) => [x, restText(x)]);
const EQ_LABEL = { smith: 'Smith machine', barbell: 'Barbell', machine: 'Plate machine', cable: 'Cable', plate: 'Plate', kettlebell: 'Kettlebell', dumbbell: 'Dumbbell', band: 'Band', other: 'Other' };
const BAR_EQUIPMENT = EQUIPMENT.filter((e) => e !== 'bodyweight' && e !== 'band');

function prefsHtml(st, eq) {
  const sizes = [...new Set([...PLATE_CHOICES, ...eq.extraPlates, ...eq.plates])].sort((a, b) => b - a);
  const example = warmupSets(60, { steps: st.warmup.steps, smallestPlate: smallestPlate(eq) });
  return `
    <div class="section-label">Workout</div>
    <div class="card opt-list">
      ${opt('Rest after main lifts', 'Used when an exercise has no rest time of its own', sel('rest.mainS', restOptions, st.rest.mainS))}
      ${opt('Rest after light work', 'Isolation, grip and abs', sel('rest.lightS', restOptions, st.rest.lightS))}
      ${opt('Rest between holds', '', sel('rest.holdS', restOptions, st.rest.holdS))}
      ${opt('Bodyweight', 'For pull-ups and other bodyweight exercises, until Apple Health is connected', `<span class="row-fields"><input class="input mini num" data-s="bodyweight.kg" inputmode="decimal" value="${st.bodyweight.kg ?? ''}" placeholder="78" aria-label="Bodyweight in kg"><span class="hint">kg</span></span>`)}
      ${opt('Keep the screen awake', 'During a session', sw('keepAwake', st.keepAwake))}
      ${opt('Previous column', 'Last time you did the exercise in any session, or only in the same routine', '')}
      ${seg('previousFrom', [['any', 'Any session'], ['same-routine', 'Same routine']], st.previousFrom)}
    </div>
    <div class="section-label">Sounds</div>
    <div class="card opt-list">
      ${opt('Rest timer ends', '', `<span class="btn-row tight">${sel('sounds.restEnd', SOUNDS.map((x) => [x.id, x.label]), st.sounds.restEnd)}<button class="btn-ghost small" data-test="restEnd" type="button">Test</button></span>`)}
      ${opt('Timer volume', 'Rest timer and hold timer', `<input class="range" type="range" min="0" max="100" step="5" data-s="sounds.timerVolume" value="${st.sounds.timerVolume}" aria-label="Timer volume">`)}
      ${opt('Set tick volume', '', `<input class="range" type="range" min="0" max="100" step="5" data-s="sounds.tickVolume" value="${st.sounds.tickVolume}" aria-label="Set tick volume">`)}
      ${opt('Record volume', '', `<input class="range" type="range" min="0" max="100" step="5" data-s="sounds.recordVolume" value="${st.sounds.recordVolume}" aria-label="Record volume">`)}
      <p class="hint pad-s">The iPhone plays these only while the app is open, and not when the side switch is on silent.</p>
    </div>
    <div class="section-label">While logging</div>
    <div class="card opt-list">
      ${opt('Plate calculator', 'Plates button and bar + plates per side under each exercise', sw('show.plateCalc', st.show.plateCalc))}
      ${opt('RPE', 'Offer RPE in the set menu', sw('show.rpe', st.show.rpe))}
      ${opt('Superset jump', 'After a set, scroll to the next exercise in the superset', sw('show.supersetJump', st.show.supersetJump))}
      ${opt('Timer in duration sets', 'Start and stop buttons in time-based set rows', sw('show.inlineTimer', st.show.inlineTimer))}
      ${opt('Record banner', 'When a ticked set beats your best', sw('show.recordBanner', st.show.recordBanner))}
    </div>
    <div class="section-label">Warm-up sets</div>
    <div class="card opt-list" id="warmup">
      ${st.warmup.steps.map((x, i) => `<div class="opt"><div class="row-fields">
        <input class="input mini num" data-w="pct" data-i="${i}" inputmode="numeric" value="${x.pct}" aria-label="Percent of working weight"><span class="hint">% ×</span>
        <input class="input mini num" data-w="reps" data-i="${i}" inputmode="numeric" value="${x.reps}" aria-label="Reps"><span class="hint">reps</span></div>
        <button class="icon-mini" data-w-del="${i}" type="button" aria-label="Remove this step">✕</button></div>`).join('')}
      <div class="opt"><span class="hint">${example.length ? `Working 60 kg: ${example.map((x) => `${fmtKg(x.kg)} × ${x.reps}`).join(' · ')}` : 'No warm-up steps.'}</span>
        <button class="btn-ghost small" data-w-add type="button">+ Step</button></div>
      ${opt('Count warm-ups in statistics', 'Sets per muscle and volume charts', sw('warmup.countInStats', st.warmup.countInStats))}
    </div>
    <div class="section-label">Equipment</div>
    <div class="card opt-list" id="bars">
      <p class="hint pad-s">Loads are always the total including the bar. A bar applies to every exercise with that equipment, or only to the exercises that choose it (exercise page ··· > Bar).</p>
      ${eq.bars.map((b, i) => `<div class="opt"><div class="row-fields grow">
        <input class="input mini grow" data-b="label" data-i="${i}" value="${esc(b.label || '')}" maxlength="30" aria-label="Bar name">
        <select class="input mini" data-b="equipment" data-i="${i}" aria-label="Used for"><option value="" ${!b.equipment ? 'selected' : ''}>Chosen exercises</option>${BAR_EQUIPMENT.map((e) => `<option value="${e}" ${b.equipment === e ? 'selected' : ''}>${EQ_LABEL[e] || e}</option>`).join('')}</select>
        <input class="input mini num" data-b="kg" data-i="${i}" inputmode="decimal" value="${fmtKg(b.kg)}" aria-label="Bar weight in kg"><span class="hint">kg</span></div>
        <button class="icon-mini" data-b-del="${i}" type="button" aria-label="Remove this bar">✕</button></div>`).join('')}
      <div class="opt"><span class="hint">${eq.bars.length ? '' : 'No bars: every load is entered as a plain total.'}</span><button class="btn-ghost small" data-b-add type="button">+ Bar</button></div>
    </div>
    <div class="card opt-list">
      ${opt('Plates you have', 'Per side. The plate calculator, targets and warm-ups round to these.', '')}
      <div class="chips wrap" id="plates">${sizes.map((p) => `<button class="chip ${eq.plates.includes(p) ? 'is-on' : ''}" data-p="${p}" type="button" aria-pressed="${eq.plates.includes(p)}">${fmtKg(p)}</button>`).join('')}</div>
      <div class="opt"><div class="row-fields"><input class="input mini num" id="p-new" inputmode="decimal" placeholder="kg" aria-label="New plate size in kg"></div>
        <button class="btn-ghost small" id="p-add" type="button">+ Plate size</button></div>
    </div>
    <div class="section-label">Units</div>
    <div class="card opt-list">
      ${opt('Weight', 'Stored in kg. One exercise can use lb from its menu in a session.', '')}
      ${seg('units.weight', [['kg', 'kg'], ['lb', 'lb']], st.units.weight)}
      ${opt('Distance', '', '')}
      ${seg('units.distance', [['km', 'km'], ['mi', 'miles']], st.units.distance)}
      ${opt('Body measurements', '', '')}
      ${seg('units.body', [['cm', 'cm'], ['in', 'inches']], st.units.body)}
    </div>
    <div class="section-label">Calendar</div>
    <div class="card opt-list">
      ${opt('First day of the week', 'Calendar, weekly sets and streaks', '')}
      ${seg('firstDayOfWeek', WEEK_DAYS, st.firstDayOfWeek)}
    </div>
    <div class="section-label">Gym</div>
    <div class="card opt-list">
      ${opt('Gym on new sessions', 'Change it on a session when you train somewhere else', '')}
      <div class="opt"><input class="input" data-s="gym.name" value="${esc(st.gym.name)}" maxlength="60" placeholder="Gym name" aria-label="Gym name"></div>
    </div>`;
}

/** {a: {b: v}} from 'a.b' and a value. */
const patchOf = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);

function wirePrefs(box) {
  const st = () => withDefaults(getState().settings);
  const eq = () => equipmentWithDefaults(getState().equipment);
  const changed = () => `Changed in Settings, ${formatDay(new Date())}`;
  /** Save one value. A group that carries a source note (seeded from the brief) gets a dated change note. */
  const save = (path, value) => {
    const patch = patchOf(path, value);
    const top = path.split('.')[0];
    if (path.includes('.') && st()[top]?.source) patch[top].source = changed();
    return saveSettings(patch);
  };
  const preview = (path) => {
    const s = st().sounds;
    unlockAudio();
    if (path === 'sounds.timerVolume' || path === 'sounds.restEnd') play(s.restEnd, s.timerVolume);
    if (path === 'sounds.tickVolume') play('tick', s.tickVolume);
    if (path === 'sounds.recordVolume') play('record', s.recordVolume);
  };

  box.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.s) {
      const path = t.dataset.s;
      let v = t.type === 'checkbox' ? t.checked : t.value;
      if (t.type === 'range' || /^rest\./.test(path)) v = Number(v);
      if (path === 'gym.name') v = String(v).trim();
      if (path === 'bodyweight.kg') {
        v = t.value.trim() === '' ? null : Number(t.value.replace(',', '.'));
        if (v != null && !(v > 30 && v < 250)) { toast('Bodyweight must be between 30 and 250 kg.'); t.value = st().bodyweight.kg ?? ''; return; }
        await saveSettings({ bodyweight: { kg: v, at: v == null ? null : Date.now() } });
        return;
      }
      await save(path, v);
      preview(path);
    } else if (t.dataset.w) {
      const steps = st().warmup.steps.map((x) => ({ ...x }));
      steps[Number(t.dataset.i)][t.dataset.w] = t.value;
      const clean = cleanWarmupSteps(steps);
      if (clean.length !== steps.length) toast('Warm-up steps need 1-99 % and 1-30 reps.');
      await saveSettings({ warmup: { steps: clean } });
    } else if (t.dataset.b) {
      const bars = eq().bars.map((x) => ({ ...x }));
      const b = bars[Number(t.dataset.i)];
      if (t.dataset.b === 'kg') {
        const v = Number(String(t.value).replace(',', '.'));
        if (!(v > 0 && v < 100)) { toast('Bar weight must be between 0 and 100 kg.'); t.value = fmtKg(b.kg); return; }
        b.kg = v;
      } else b[t.dataset.b] = t.dataset.b === 'equipment' ? t.value || null : t.value.trim();
      if (b.source) b.source = changed();
      await saveEquipment({ ...eq(), bars });
    }
  });

  box.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.seg) {
      const v = t.dataset.seg === 'firstDayOfWeek' ? Number(t.dataset.v) : t.dataset.v;
      await save(t.dataset.seg, v);
    } else if (t.dataset.test) {
      preview('sounds.restEnd');
    } else if (t.dataset.wDel != null) {
      await saveSettings({ warmup: { steps: st().warmup.steps.filter((_, i) => i !== Number(t.dataset.wDel)) } });
    } else if (t.hasAttribute('data-w-add')) {
      const steps = st().warmup.steps;
      const last = steps[steps.length - 1];
      await saveSettings({ warmup: { steps: [...steps, { pct: Math.min(95, (last?.pct ?? 40) + 15), reps: Math.max(1, (last?.reps ?? 10) - 3) }] } });
    } else if (t.dataset.bDel != null) {
      await saveEquipment({ ...eq(), bars: eq().bars.filter((_, i) => i !== Number(t.dataset.bDel)) });
    } else if (t.hasAttribute('data-b-add')) {
      await saveEquipment({ ...eq(), bars: [...eq().bars, { id: `bar-${Date.now().toString(36)}`, label: 'Barbell', equipment: 'barbell', kg: 20 }] });
    } else if (t.dataset.p) {
      const p = Number(t.dataset.p);
      const on = eq().plates.includes(p);
      if (on && eq().plates.length === 1) { toast('Keep at least one plate size.'); return; }
      await saveEquipment({ ...eq(), plates: on ? eq().plates.filter((x) => x !== p) : [...eq().plates, p] });
    } else if (t.id === 'p-add') {
      const input = box.querySelector('#p-new');
      const p = Math.round(Number(String(input.value).replace(',', '.')) * 100) / 100;
      if (!(p > 0 && p <= 50)) { toast('Plate size must be between 0 and 50 kg.'); return; }
      const e2 = eq();
      await saveEquipment({ ...e2, plates: [...e2.plates, p], extraPlates: PLATE_CHOICES.includes(p) ? e2.extraPlates : [...new Set([...e2.extraPlates, p])] });
    }
  });
}

export function render(view) {
  view.innerHTML = `
    <h1 class="view-title">Settings</h1>
    <div class="section-label">Mac link</div>
    <dl class="card kv" id="mac-kv"></dl>
    <div id="mac-actions" class="stack"></div>
    <div class="section-label">Notifications</div>
    <div id="notify" class="stack"></div>
    <div id="prefs" class="stack"></div>
    <div class="section-label">Import and export</div>
    <ul class="lib-list">
      <li><a class="lib-row" href="#/import"><span class="lib-name">Import history</span><span class="lib-meta">From Hevy or Strong · undo past imports</span></a></li>
      <li><a class="lib-row" href="#/export"><span class="lib-name">Export your data</span><span class="lib-meta">Everything as CSV in one ZIP · works offline</span></a></li>
    </ul>
    <div class="section-label">App</div>
    <dl class="card kv">
      <dt>Version</dt><dd id="set-version">…</dd>
      <dt>Latest</dt><dd id="set-latest">…</dd>
      <dt>Installed</dt><dd id="set-installed">…</dd>
      <dt>This device</dt><dd id="set-device">…</dd>
    </dl>
    <div class="btn-row"><button class="btn-ghost" id="upd-check" type="button">Check for update</button>
      <button class="btn-ghost" id="upd-reload" type="button">Reload app files</button></div>
    <p class="hint">Reload app files fetches the app again from the web if an update won't come through. Your data on this device stays.</p>`;

  const kv = view.querySelector('#mac-kv');
  const actions = view.querySelector('#mac-actions');
  let shownPaired = null;

  const drawKv = (s) => {
    kv.innerHTML = `
      <dt>Status</dt><dd>${statusLine(s)}</dd>
      <dt>Mac</dt><dd>${s.macUrl ? esc(s.macUrl.replace(/^https?:\/\//, '')) : '—'}</dd>
      <dt>Last sync</dt><dd>${when(s.sync.lastAt)}</dd>
      <dt>Waiting to send</dt><dd>${s.sync.pending ?? 0}</dd>`;
  };

  const drawActions = async (s) => {
    if (shownPaired === s.paired) return;
    shownPaired = s.paired;
    if (s.paired) {
      actions.innerHTML = `
        <div class="btn-row">
          <button class="btn-primary" id="sync-now" type="button">Sync now</button>
          <button class="btn-ghost" id="pair-other" type="button">Pair another device</button>
        </div>
        <p class="hint" id="code-out" hidden></p>
        <button class="btn-ghost btn-danger" id="unpair" type="button">Unpair this device</button>`;
      actions.querySelector('#sync-now').onclick = async () => {
        const r = await syncNow();
        toast(r.ok ? `Synced. Sent ${r.pushed}, received ${r.pulled}.` : r.reason === 'unreachable' ? 'Mac unreachable. Your data is safe on this device.' : `Sync failed: ${r.reason}`);
      };
      actions.querySelector('#pair-other').onclick = async () => {
        try {
          const { code, expiresAt } = await newPairingCode();
          const out = actions.querySelector('#code-out');
          out.hidden = false;
          out.innerHTML = `Code for the other device: <b class="code">${code.slice(0, 3)} ${code.slice(3)}</b> · valid until ${formatTime(new Date(expiresAt))}`;
        } catch (e) { toast(e.message); }
      };
      actions.querySelector('#unpair').onclick = async () => {
        if (!confirm('Unpair this device? Data on it stays, and anything not yet sent is kept until you pair again.')) return;
        await unpair();
      };
    } else {
      const guess = await sameOriginMac();
      actions.innerHTML = `
        <form class="card pair-form" id="pair-form">
          <p class="hint">On the Mac, run <code>node server/pair.mjs</code> in the training-hq folder (or ask Claude), then enter the code here.</p>
          <div class="field"><label for="pf-url">Mac address</label>
            <input class="input" id="pf-url" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="your-mac.your-tailnet.ts.net" value="${esc(guess ? (guess.startsWith('https://') ? guess.slice(8) : guess) : '')}"></div>
          <div class="field"><label for="pf-code">Pairing code</label>
            <input class="input" id="pf-code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" maxlength="7"></div>
          <div class="field"><label for="pf-name">Name for this device</label>
            <input class="input" id="pf-name" name="name" value="${isPhone ? 'iPhone' : 'Mac browser'}" maxlength="40"></div>
          <button class="btn-primary" type="submit">Pair with Mac</button>
        </form>`;
      actions.querySelector('#pair-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await pair({ macUrl: f.get('url'), code: f.get('code'), name: f.get('name') });
          toast('Paired. Your programme is loading.');
        } catch (e) {
          toast(/Failed to fetch|NetworkError|Load failed/.test(e.message) ? 'Could not reach that address. Check Tailscale is on.' : e.message);
        } finally { btn.disabled = false; }
      };
    }
  };

  const prefs = view.querySelector('#prefs');
  let shownPrefs = null;
  const drawPrefs = (s) => {
    if (!s.settings || (shownPrefs && shownPrefs[0] === s.settings && shownPrefs[1] === s.equipment)) return;
    // Don't redraw under his fingers: a field being typed in keeps its value until it is left.
    if (prefs.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]):not([type=range]), select')) {
      document.activeElement.addEventListener('blur', () => setTimeout(() => drawPrefs(getState()), 0), { once: true });
      return;
    }
    shownPrefs = [s.settings, s.equipment];
    const y = window.scrollY;
    prefs.innerHTML = prefsHtml(withDefaults(s.settings), equipmentWithDefaults(s.equipment));
    window.scrollTo(0, y);
  };
  wirePrefs(prefs);

  const redrawNotify = notifyPanel(view.querySelector('#notify'));
  let wasPaired = getState().paired;
  const draw = (s) => { drawKv(s); drawActions(s); drawPrefs(s); if (s.paired !== wasPaired) { wasPaired = s.paired; redrawNotify(); } };
  draw(getState());
  const unsub = subscribe(draw);
  ready.then(() => drawPrefs(getState()));

  const showVersions = async () => {
    const [v, latest] = await Promise.all([appVersion(), latestVersion()]);
    view.querySelector('#set-version').textContent = v;
    view.querySelector('#set-latest').innerHTML = latest == null ? '<span class="c-muted">offline</span>'
      : latest === v ? '<span class="c-green">up to date</span>' : `<span class="c-amber">${esc(latest)} available</span>`;
  };
  showVersions();
  view.querySelector('#upd-check').onclick = async () => {
    const r = await checkForUpdate();
    toast(r === 'reloading' ? 'Updating… the app reloads in a moment.' : r === 'slow' ? 'Still downloading. It asks to reload when ready.' : r === 'no-worker' ? 'Offline mode is not set up in this browser.' : 'You have the latest version.');
    showVersions();
  };
  view.querySelector('#upd-reload').onclick = async () => {
    if (!navigator.onLine) { toast('No connection: the app files can\'t be fetched now.'); return; }
    if (await confirmSheet('Fetch the app again from the web? Your data on this device stays.', { ok: 'Reload' })) reloadAppFiles();
  };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  view.querySelector('#set-installed').textContent = standalone ? 'Home Screen app' : 'Browser tab';
  ready.then((repo) => { view.querySelector('#set-device').textContent = repo.device; });
  return unsub;
}
