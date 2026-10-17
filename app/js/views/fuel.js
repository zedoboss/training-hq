// FUEL: meals and supplements, built in step 6.
import { laterCard } from './later.js';

export function render(view) {
  view.innerHTML = laterCard('Fuel', 6, [
    'Meals with before and after photos, estimates you confirm, and your supplement checklist.',
  ]);
}
