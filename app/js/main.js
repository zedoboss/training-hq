// Training HQ entry point: draws the shell (header, section tabs) and switches views by URL hash.
import { registerServiceWorker } from './lib/sw-client.js';
import './lib/data.js';
import * as today from './views/today.js';
import * as train from './views/train.js';
import * as fuel from './views/fuel.js';
import * as body from './views/body.js';
import * as settings from './views/settings.js';
import * as library from './views/library.js';
import * as exercise from './views/exercise.js';
import * as routine from './views/routine.js';
import * as programme from './views/programme.js';
import * as session from './views/session.js';
import * as finish from './views/finish.js';
import * as holds from './views/holds.js';
import * as demos from './views/demos.js';
import * as stats from './views/stats.js';
import * as importView from './views/import.js';
import * as exportView from './views/export.js';
import * as calendar from './views/calendar.js';
import * as historyView from './views/history.js';
import * as progression from './views/progression.js';
import * as readiness from './views/readiness.js';

const VIEWS = {
  today: { mod: today, label: 'Today' },
  train: { mod: train, label: 'Train' },
  fuel: { mod: fuel, label: 'Fuel' },
  body: { mod: body, label: 'Body' },
  settings: { mod: settings, label: 'Settings', hidden: true },
  library: { mod: library, label: 'Library', hidden: true, tab: 'train' },
  exercise: { mod: exercise, label: 'Exercise', hidden: true, tab: 'train' },
  routine: { mod: routine, label: 'Routine', hidden: true, tab: 'train' },
  programme: { mod: programme, label: 'Programme', hidden: true, tab: 'train' },
  session: { mod: session, label: 'Session', hidden: true, tab: 'train' },
  finish: { mod: finish, label: 'Finish', hidden: true, tab: 'train' },
  holds: { mod: holds, label: 'Holds', hidden: true, tab: 'train' },
  demos: { mod: demos, label: 'Demos', hidden: true, tab: 'train' },
  stats: { mod: stats, label: 'Statistics', hidden: true, tab: 'train' },
  calendar: { mod: calendar, label: 'Calendar', hidden: true, tab: 'train' },
  history: { mod: historyView, label: 'History', hidden: true, tab: 'train' },
  progression: { mod: progression, label: 'Progression', hidden: true, tab: 'train' },
  checkin: { mod: readiness, label: 'Check-in', hidden: true, tab: 'today' },
  readiness: { mod: { render: (view, params) => readiness.render(view, params, 'readiness') }, label: 'Readiness table', hidden: true, tab: 'train' },
  import: { mod: importView, label: 'Import', hidden: true, tab: 'settings' },
  export: { mod: exportView, label: 'Export', hidden: true, tab: 'settings' },
};

const BRAND_MARK = `<svg class="brand-mark" aria-hidden="true" width="44" height="30" viewBox="0 0 44 30" fill="none"><path d="M2 15C8 5 16 2 22 2s14 3 20 13c-6 10-14 13-20 13S8 25 2 15z" stroke="#2b5268" stroke-width="1.4"/><circle cx="22" cy="15" r="9" fill="#0b2a3a" stroke="#4fd8ff" stroke-width="1.6"/><circle cx="22" cy="15" r="3.6" fill="#4fd8ff"/></svg>`;
const GEAR = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>`;

function shell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        ${BRAND_MARK}
        <div>
          <div class="brand-name">TRAINING <b>HQ</b></div>
          <div class="brand-tag">NO REP LEFT BEHIND</div>
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">
        ${Object.entries(VIEWS).filter(([, v]) => !v.hidden)
          .map(([id, v]) => `<a class="pill" href="#/${id}" data-tab="${id}">${v.label}</a>`).join('')}
      </nav>
      <div class="top-right">
        <div class="model-readout">
          <div class="hud c-faint" style="letter-spacing:.4em">ACTIVE MODEL</div>
          <div class="hud c-cyan" style="font-size:16px;letter-spacing:.24em;margin-top:6px">SONNET 5.5 · LOW</div>
        </div>
        <a class="icon-btn" href="#/settings" data-tab="settings" aria-label="Settings">${GEAR}</a>
      </div>
    </header>
    <main id="view" class="view"></main>`;
}

let cleanup = null;

function route() {
  const [first, ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const id = VIEWS[first] ? first : 'today';
  const entry = VIEWS[id];
  const tab = entry.tab || id;
  for (const el of document.querySelectorAll('[data-tab]')) {
    if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  if (typeof cleanup === 'function') cleanup();
  const view = document.getElementById('view');
  view.innerHTML = '';
  view.className = `view view-${id}`;
  cleanup = entry.mod.render(view, params) || null;
  window.scrollTo(0, 0);
}

shell();
window.addEventListener('hashchange', route);
route();
registerServiceWorker();
