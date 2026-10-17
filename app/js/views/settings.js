// SETTINGS: link to the Mac (pairing, sync status) and app details.
import { appVersion } from '../lib/sw-client.js';
import { getState, subscribe } from '../lib/store.js';
import { ready, pair, unpair, syncNow, newPairingCode, sameOriginMac } from '../lib/data.js';
import { formatTime, formatDay } from '../lib/time.js';
import { toast } from '../ui/toast.js';

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

export function render(view) {
  view.innerHTML = `
    <h1 class="view-title">Settings</h1>
    <div class="section-label">Mac link</div>
    <dl class="card kv" id="mac-kv"></dl>
    <div id="mac-actions" class="stack"></div>
    <div class="section-label">App</div>
    <dl class="card kv">
      <dt>Version</dt><dd id="set-version">…</dd>
      <dt>Installed</dt><dd id="set-installed">…</dd>
      <dt>This device</dt><dd id="set-device">…</dd>
    </dl>`;

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

  const draw = (s) => { drawKv(s); drawActions(s); };
  draw(getState());
  const unsub = subscribe(draw);

  appVersion().then((v) => { view.querySelector('#set-version').textContent = v; });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  view.querySelector('#set-installed').textContent = standalone ? 'Home Screen app' : 'Browser tab';
  ready.then((repo) => { view.querySelector('#set-device').textContent = repo.device; });
  return unsub;
}
