// BODY: Apple Health, measurements, progress photos and body scans, built in step 7.
import { laterCard } from './later.js';

export function render(view) {
  view.innerHTML = laterCard('Body', 7, [
    'Steps, sleep, weight and workouts from Apple Health, measurements, progress photos and Evolt 360 scans.',
  ]);
}
