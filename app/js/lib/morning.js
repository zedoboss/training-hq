// His morning routine as a checklist (Thu 11/5, missing feature 9: "No checklist for your morning routine"). The items
// are his: settings.notify.morning.items when he has set them (Settings, or the coach on his words), else the parts of
// his morning text (settings.notify.morning.text, the one the morning nudge reads) split at commas, "then", "and" and
// full stops. Ticks belong to the day: days/<date>.morning = {ticks: {<item>: at}}. No notifications of its own.

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Split his routine text into items: "Banana, bathroom, then stretch and get some sunlight. Coffee ..." */
export function itemsFromText(text) {
  const out = [];
  // Brackets stay with their item ("Coffee about 90 minutes after waking (after the Evolt on gym days)").
  const parts = String(text || '').split(/\.\s+|,(?![^(]*\))|\bthen\b(?![^(]*\))|\band\b(?![^(]*\))/i);
  for (const p of parts) {
    const t = cap(clean(p).replace(/^(and|then)\s+/i, ''));
    if (t && t.length > 1 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t.slice(0, 120));
  }
  return out.slice(0, 20);
}

/** His checklist items: his own list, else from his routine text. */
export function morningItems(morning) {
  if (Array.isArray(morning?.items)) return morning.items.map((x) => clean(x).slice(0, 120)).filter(Boolean).slice(0, 20);
  return itemsFromText(morning?.text);
}

/** A list typed one item per line (Settings): trimmed, no empty or repeated lines. */
export function itemsFromLines(text) {
  const out = [];
  for (const l of String(text || '').split(/\n+/)) {
    const t = clean(l.replace(/^[-•*\d.)\s]+/, ''));
    if (t && !out.includes(t)) out.push(t.slice(0, 120));
  }
  return out.slice(0, 20);
}

/** Today's items with their ticks: [{item, at|null}]. */
export function morningState(items, day) {
  const ticks = day?.morning?.ticks || {};
  return items.map((item) => ({ item, at: ticks[item] ?? null }));
}

/** The day record with one item ticked (on) or unticked. */
export function withMorningTick(day, date, item, on, now = Date.now()) {
  const ticks = { ...(day?.morning?.ticks || {}) };
  if (on) ticks[item] = ticks[item] ?? now; else delete ticks[item];
  return { ...(day || {}), date, morning: { ...(day?.morning || {}), ticks } };
}

/** Which item his words mean: its number (1-based), the whole item, or the one item containing every word. */
export function findItem(items, q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return items[Number(s) - 1] ?? null;
  const exact = items.find((x) => x.toLowerCase() === s);
  if (exact) return exact;
  const words = s.split(/\s+/);
  const hits = items.filter((x) => words.every((w) => x.toLowerCase().includes(w)));
  return hits.length === 1 ? hits[0] : null;
}
