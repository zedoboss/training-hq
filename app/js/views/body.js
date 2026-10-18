// BODY (#/body): Apple Health (steps, sleep, weight, workouts), body measurements and progress photos, Evolt 360
// body scans (step 7). Sub-screens: #/body/health (the iPhone Shortcut and what arrived).
import { laterCard } from './later.js';
import * as health from './body-health.js';

const SUB = { health };

export function render(view, params = []) {
  const sub = SUB[params[0]];
  if (sub) return sub.render(view, params.slice(1));
  view.innerHTML = `${laterCard('Body', 7, [
    'Steps, sleep, weight and workouts from Apple Health, measurements, progress photos and Evolt 360 scans.',
  ])}<a class="card supp-card" href="#/body/health"><span class="hud c-cyan">APPLE HEALTH</span><span class="supp-card-line">Set up the iPhone Shortcut</span><span class="pill is-on">Open</span></a>`;
  return null;
}
