// Body map (P38, P41): a plain front and back figure, each muscle shaded by its sets (one cyan hue, light to
// bright, like the heat grid). Every shape names itself in a tooltip and the same numbers are listed in text below,
// so nothing depends on colour. The figure is Training HQ's own simple drawing.
import { muscleLabel } from '../lib/exercise-types.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// [muscle, shape] with shapes as ellipses [cx, cy, rx, ry] or rounded rects {x, y, w, h}. Front figure centred on
// x 50, back on x 150 (mirror pairs listed once and drawn on both sides).
const pair = (d, cy, rx, ry, mid) => [[mid - d, cy, rx, ry], [mid + d, cy, rx, ry]];
const FRONT = [
  ['neck', [{ x: 46, y: 25, w: 8, h: 7 }]],
  ['shoulders', pair(17, 40, 7, 6, 50)],
  ['chest', pair(8, 48, 8, 6.5, 50)],
  ['biceps', pair(23, 58, 4.5, 9, 50)],
  ['forearms', pair(26, 79, 4, 10, 50)],
  ['abdominals', [{ x: 43, y: 57, w: 14, h: 28 }]],
  ['abductors', pair(14, 94, 3.5, 7, 50)],
  ['adductors', pair(4, 103, 3, 9, 50)],
  ['quadriceps', pair(9, 113, 6.5, 17, 50)],
  ['calves', pair(9, 150, 4.5, 13, 50)],
];
const BACK = [
  ['neck', [{ x: 146, y: 25, w: 8, h: 6 }]],
  ['traps', [[150, 36, 14, 6.5]]],
  ['shoulders', pair(17, 41, 7, 6, 150)],
  ['upper_back', [[150, 49, 11, 6]]],
  ['lats', pair(10, 62, 7, 11, 150)],
  ['triceps', pair(23, 57, 4.5, 9, 150)],
  ['forearms', pair(26, 79, 4, 10, 150)],
  ['lower_back', [{ x: 145, y: 72, w: 10, h: 14 }]],
  ['glutes', pair(7.5, 96, 7.5, 7, 150)],
  ['hamstrings', pair(9, 117, 6, 14, 150)],
  ['calves', pair(9, 150, 5, 13, 150)],
];
const SHOWN = new Set([...FRONT, ...BACK].map(([m]) => m));

/** Shade step 0 (none) .. 4 (most) of a value against the maximum. */
const step = (v, max) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
const setsText = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * @param {{[muscle:string]: number}} muscles sets per muscle (primary 1, secondary 0.5)
 * @param {string} what e.g. "last 7 days", used in tooltips
 */
export function bodyMap(muscles, what) {
  const max = Math.max(0, ...Object.values(muscles));
  const shape = (m, sh) => {
    const v = muscles[m] || 0;
    const tip = `${muscleLabel(m)}, ${what}: ${setsText(v)} sets`;
    const cls = `bm h${max ? step(v, max) : 0}`;
    return Array.isArray(sh)
      ? `<ellipse class="${cls}" cx="${sh[0]}" cy="${sh[1]}" rx="${sh[2]}" ry="${sh[3]}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></ellipse>`
      : `<rect class="${cls}" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="3" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
  };
  // Faint silhouette under the muscles: torso, hips, arms and legs.
  const body = (cx) => [[cx - 17, 31, 34, 58, 10], [cx - 15, 82, 30, 18, 6], [cx - 31, 34, 10, 58, 5], [cx + 21, 34, 10, 58, 5], [cx - 16, 95, 14, 72, 6], [cx + 2, 95, 14, 72, 6]]
    .map(([x, y, w, h, r]) => `<rect class="bm-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`).join('');
  const figure = (list, cx) => `${body(cx)}<circle class="bm-head" cx="${cx}" cy="15" r="9"/>${list.map(([m, shapes]) => shapes.map((sh) => shape(m, sh)).join('')).join('')}`;
  const listed = Object.entries(muscles).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const off = listed.filter(([m]) => !SHOWN.has(m));
  return `<figure class="body-map">
    <svg viewBox="0 0 200 184" role="img" aria-label="Sets per muscle, ${esc(what)}">
      ${figure(FRONT, 50)}${figure(BACK, 150)}
      <text x="50" y="181" text-anchor="middle" class="bm-cap">FRONT</text><text x="150" y="181" text-anchor="middle" class="bm-cap">BACK</text>
    </svg>
    <figcaption class="bm-list">${listed.length ? listed.map(([m, v]) => `<span><i class="bm-key h${step(v, max)}"></i>${esc(muscleLabel(m))} <b>${setsText(v)}</b></span>`).join('') : '<span class="hint">No sets.</span>'}
      ${off.length ? '<span class="c-faint">Not on the figure: ' + off.map(([m]) => esc(muscleLabel(m))).join(', ') + '</span>' : ''}</figcaption>
  </figure>`;
}
