// Small SVG charts in the app's chart style (the dataviz rules used on Statistics and the exercise page): one series
// per chart in cyan, so no legend (the card title names it); recessive grid; 4 px rounded column tops on the
// baseline; 2 px lines; only the latest and one extreme labelled; every mark has a tooltip; a table view beside it.
// Used by the Body screens (step 7). Pure string builders plus one tooltip binder.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A round step for an axis from 0 to about `max` in 2-4 steps. */
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/**
 * Columns from zero. items: [{value, axis (x label), tip}]. Labels the latest and the highest column.
 * o.fmt formats axis and labels; o.ref = {value}: one dashed reference line (a goal), named in the text below.
 */
export function columnChart(items, { label, fmt = (v) => String(Math.round(v)), ref = null, H = 160 } = {}) {
  const W = 340; const L = 38; const B = 22; const T = 18;
  const max = Math.max(...items.map((w) => w.value ?? 0), ref?.value ?? 0);
  if (!items.length || !max) return '<p class="hint">Nothing to chart yet.</p>';
  const top = niceMax(max);
  const slot = (W - L) / items.length;
  const bw = Math.max(2, Math.min(22, slot - 2));
  const y = (v) => H - B - ((H - B - T) * v) / top;
  const vals = items.map((w) => w.value ?? -1);
  const iMax = vals.reduce((bi, v, i) => (v > vals[bi] ? i : bi), 0);
  const iLast = items.length - 1;
  const r = Math.min(4, bw / 2);
  const bars = items.map((w, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const hit = `<rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - B - T}" class="hit"/>`;
    if (w.value == null) return `<g data-tip="${esc(w.tip)}" aria-label="${esc(w.tip)}" role="img">${hit}</g>`;
    const tp = y(w.value);
    const h = H - B - tp;
    const k = Math.min(r, h);
    const path = h > 0 ? `<path d="M${x},${H - B} V${tp + k} Q${x},${tp} ${x + k},${tp} H${x + bw - k} Q${x + bw},${tp} ${x + bw},${tp + k} V${H - B} Z" class="col"/>` : '';
    const lab = (i === iMax || i === iLast) && w.value ? `<text x="${x + bw / 2}" y="${tp - 5}" text-anchor="middle" class="col-label">${esc(fmt(w.value))}</text>` : '';
    return `<g data-tip="${esc(w.tip)}" aria-label="${esc(w.tip)}" role="img">${hit}${path}${lab}</g>`;
  }).join('');
  const every = Math.ceil(items.length / 6);
  const xLabels = items.map((w, i) => ((i % every === 0 || i === iLast) && (i === iLast || iLast - i >= every / 2)
    ? `<text x="${L + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" class="axis">${esc(w.axis)}</text>` : '')).join('');
  const ticks = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`).join('');
  // The reference line is named in the text under the chart, so no label sits on the columns.
  const refLine = ref?.value ? `<line x1="${L}" x2="${W}" y1="${y(ref.value)}" y2="${y(ref.value)}" class="ref"/>` : '';
  return `<svg class="vol-chart body-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)}">${ticks}${bars}${refLine}${xLabels}</svg>`;
}

/**
 * A line over real time. points: [{t (ms), value, tip, flag}] oldest first. Labels the latest and the first point;
 * flagged points (not comparable) are drawn hollow. o.fmt formats values; o.zero starts the axis at 0.
 * Returns {svg, xy, W, H} so a crosshair can follow the finger.
 */
export function timeLine(points, { label, fmt = (v) => String(v), zero = false, H = 170 } = {}) {
  const pts = points.filter((p) => p.value != null);
  if (!pts.length) return { svg: '<p class="hint">Nothing to chart yet.</p>', xy: [], pts };
  const W = 340; const L = 40; const R = 16; const T = 20; const B = 22;
  const t0 = pts[0].t; const t1 = pts.at(-1).t;
  const x = (v) => (t1 === t0 ? (L + W - R) / 2 : L + ((v - t0) / (t1 - t0)) * (W - L - R));
  const vs = pts.map((p) => p.value);
  let lo = Math.min(...vs); let hi = Math.max(...vs);
  const pad = (hi - lo) * 0.2 || Math.max(0.5, Math.abs(hi) * 0.02);
  lo = zero ? 0 : lo - pad; hi += pad;
  const raw = (hi - lo) / 3;
  const p10 = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= raw) || 10 * p10;
  lo = Math.floor(lo / step) * step; hi = lo + step * Math.max(3, Math.ceil((hi - lo) / step));
  const y = (v) => H - B - ((v - lo) / (hi - lo)) * (H - B - T);
  const xy = pts.map((p) => [x(p.t), y(p.value)]);
  const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const yTicks = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${esc(fmt(Math.round(v * 100) / 100))}</text>`).join('');
  const span = (t1 - t0) / 86400000;
  const dl = (t) => { const d = new Date(t); return span > 300 ? `${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}` : `${d.getMonth() + 1}/${d.getDate()}`; };
  const last = pts.length - 1;
  // First, last, and the point nearest the middle of the time span if it has room between them.
  const mid = xy.reduce((bi, [px], i) => (Math.abs(px - (L + W - R) / 2) < Math.abs(xy[bi][0] - (L + W - R) / 2) ? i : bi), 0);
  const xIdx = [...new Set([0, ...(xy[mid][0] - xy[0][0] > 70 && xy[last][0] - xy[mid][0] > 70 ? [mid] : []), last])];
  const xLabels = xIdx.map((i) => `<text x="${xy[i][0]}" y="${H - 6}" text-anchor="${xIdx.length > 1 && i === 0 ? 'start' : xIdx.length > 1 && i === last ? 'end' : 'middle'}" class="axis">${esc(dl(pts[i].t))}</text>`).join('');
  const dots = pts.length <= 40 ? pts.map((p, i) => `<circle cx="${xy[i][0]}" cy="${xy[i][1]}" r="4" class="${p.flag ? 'pt-flag' : 'pt'}"/>`).join('') : '';
  const lab = (i) => {
    const [px, py] = xy[i];
    const anchor = px > W - R - 30 ? 'end' : px < L + 30 ? 'start' : 'middle';
    return `${pts.length > 40 ? `<circle cx="${px}" cy="${py}" r="4" class="pt"/>` : ''}<text x="${Math.min(W - R, Math.max(L, px))}" y="${py - 9}" text-anchor="${anchor}" class="pt-label">${esc(fmt(pts[i].value))}</text>`;
  };
  const svg = `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, ${pts.length} points">
    ${yTicks}<path d="${line}" class="line"/>${dots}${[...new Set([0, last])].map(lab).join('')}${xLabels}
    <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="xdot" r="4" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - B - T}"/></svg>`;
  return { svg, xy, W, H, pts };
}

/** Tooltip for every [data-tip] mark inside `root` (tap or hover). Returns a cleanup function. */
export function bindTips(root) {
  let tip = null;
  const show = (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !root.contains(t)) { if (tip) tip.hidden = true; return; }
    tip ||= Object.assign(document.createElement('div'), { className: 'chart-tip', role: 'status' });
    if (!tip.isConnected) document.body.append(tip);
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  };
  const hide = () => { if (tip) tip.hidden = true; };
  root.addEventListener('pointerover', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', hide);
  window.addEventListener('scroll', hide, { passive: true });
  return () => { window.removeEventListener('scroll', hide); tip?.remove(); };
}

/** Crosshair and tooltip that follow the finger along a timeLine chart in `box`. */
export function bindCrosshair(box, chart, textFor) {
  const svg = box.querySelector('.line-chart');
  if (!svg || !chart.xy.length) return () => {};
  const xh = svg.querySelector('.xhair'); const dot = svg.querySelector('.xdot');
  let tip = null;
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * chart.W;
    let bi = 0;
    chart.xy.forEach(([px], i) => { if (Math.abs(px - sx) < Math.abs(chart.xy[bi][0] - sx)) bi = i; });
    const [px, py] = chart.xy[bi];
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
    tip ||= Object.assign(document.createElement('div'), { className: 'chart-tip', role: 'status' });
    if (!tip.isConnected) document.body.append(tip);
    tip.textContent = textFor(chart.pts[bi]);
    tip.hidden = false;
    const cx = r.left + (px / chart.W) * r.width;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, cx - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(8, r.top + (py / chart.H) * r.height - tip.offsetHeight - 14)}px`;
  };
  const hide = () => { xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); if (tip) tip.hidden = true; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  return () => tip?.remove();
}

/** "Show as a table" under a chart. rows: arrays of cell text; the first column is the label. */
export function tableView(head, rows) {
  return `<details class="notes"><summary>Show as a table</summary><table class="mini-table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}
