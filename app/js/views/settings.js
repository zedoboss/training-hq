// SETTINGS: app version for now; pairing and sync status arrive in features 1.6 to 1.8.
import { appVersion } from '../lib/sw-client.js';

export function render(view) {
  view.innerHTML = `
    <h1 class="view-title">Settings</h1>
    <div class="section-label">App</div>
    <dl class="card kv">
      <dt>Version</dt><dd id="set-version">…</dd>
      <dt>Installed</dt><dd id="set-installed">…</dd>
    </dl>`;
  appVersion().then((v) => { view.querySelector('#set-version').textContent = v; });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  view.querySelector('#set-installed').textContent = standalone ? 'Home Screen app' : 'Browser tab';
}
