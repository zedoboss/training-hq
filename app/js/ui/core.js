// The animated AI core on the home screen (design option E). Four arcs around it show the day's progress:
// tendons (top left), train (top right), fuel (bottom right), steps (bottom left).
// A progress of null draws the quadrant dim, meaning "nothing to show yet".

const R = 120;
const C = 150;
const QUADRANTS = {
  train: { from: -86, to: -4, color: 'var(--amber)' },
  fuel: { from: 4, to: 86, color: 'var(--green)' },
  steps: { from: 94, to: 176, color: 'var(--cyan)' },
  tendons: { from: 184, to: 266, color: 'var(--pale)' },
};

const pt = (deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(C + R * Math.cos(a)).toFixed(1)} ${(C + R * Math.sin(a)).toFixed(1)}`;
};
const arc = (from, to) => `M${pt(from)} A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;

function quadrant(q, progress) {
  if (progress == null) {
    return `<path d="${arc(q.from, q.to)}" stroke="var(--border-strong)" stroke-width="5" stroke-linecap="round"/>`;
  }
  const p = Math.max(0, Math.min(1, progress));
  const track = `<path d="${arc(q.from, q.to)}" stroke="var(--divider)" stroke-width="5" stroke-linecap="round"/>`;
  if (p === 0) return track;
  const end = q.from + (q.to - q.from) * p;
  return `${track}<path d="${arc(q.from, end)}" stroke="${q.color}" stroke-width="5" stroke-linecap="round"/>`;
}

/**
 * @param {{train?: number|null, fuel?: number|null, steps?: number|null, tendons?: number|null}} progress
 * @param {string} label accessible description of the core's state
 */
export function coreSvg(progress, label) {
  const bars = [
    [112, 128, 44, -0.9], [124, 118, 64, -0.3], [136, 124, 52, -0.6], [148, 110, 80, -0.1],
    [160, 124, 52, -0.75], [172, 118, 64, -0.45], [184, 128, 44, -0.2],
  ];
  return `
<svg class="core-svg" role="img" aria-label="${label}" viewBox="0 0 300 300" fill="none">
  <circle cx="150" cy="150" r="146" stroke="var(--ring)" stroke-width="1"/>
  <circle class="hq-spin" cx="150" cy="150" r="138" stroke="var(--border-strong)" stroke-width="6" stroke-dasharray="2 9"/>
  ${Object.entries(QUADRANTS).map(([k, q]) => quadrant(q, progress[k] ?? null)).join('')}
  <circle class="hq-spin-rev" cx="150" cy="150" r="100" stroke="var(--cyan)" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="46 16"/>
  <circle class="hq-spin" cx="150" cy="150" r="88" stroke="var(--border-strong)" stroke-width="0.8" stroke-dasharray="3 5"/>
  <g class="hq-orbit"><circle cx="150" cy="50" r="3.5" fill="var(--pale)"/><circle cx="237" cy="200" r="2.5" fill="var(--cyan)"/><circle cx="63" cy="200" r="2.5" fill="var(--cyan)"/></g>
  <circle class="hq-pulse" cx="150" cy="150" r="78" fill="var(--cyan)" fill-opacity="0.12"/>
  <circle cx="150" cy="150" r="66" fill="var(--core)" stroke="var(--cyan)" stroke-width="1.5"/>
  <path d="M150 84v-14M150 230v-14M84 150H70M230 150h-14" stroke="var(--cyan)" stroke-width="1.2"/>
  <g fill="var(--pale)">
    ${bars.map(([x, y, h, d]) => `<rect class="hq-eq" x="${x}" y="${y}" width="6" height="${h}" rx="3" style="animation-delay:${d}s"/>`).join('')}
  </g>
</svg>`;
}
