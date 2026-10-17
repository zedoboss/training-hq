// TRAIN: programme viewer in step 1; the full workout tracker arrives in step 2.
import { laterCard } from './later.js';

export function render(view) {
  view.innerHTML = laterCard('Train', 2, [
    'The workout tracker: routines, sessions, sets, rest timer and the exercise library.',
  ]);
}
