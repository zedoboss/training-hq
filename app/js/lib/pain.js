// Pain outside the tendon areas (Thu 11/5, his words: "dive even deeper figure out more stuff regarding missing
// features"; the coach found that today's lower back pain lived only in the skip notes and nothing flagged that squats
// had hurt his back before, Thu 10/22). A pain log per body area over days, with its trend, from two sources:
// - what he wrote in his workouts (skip reasons, exercise and set notes, the session note) that says pain (targets.js
//   painIn, English or Macedonian), with the lift it was on;
// - what he logged himself, or told the coach (collection 'pain-log': {id, date, at, area, rating 0-10, lift, note}).
// And a flag when the same lift hurts the same area again. Only his words and his data: no advice, no diagnosis.
import { painIn } from './targets.js';
import { isoDate } from './time.js';

/** Body areas, his words in English or Macedonian (Latin letters, with or without č/š/ž). Most specific first. */
export const AREAS = [
  ['lower-back', 'Lower back', /\b(lower back|low back|lumbar|krst\w*|dolen (del na )?grb\w*|dolniot grb\w*)\b/i],
  ['upper-back', 'Upper back', /\b(upper back|mid back|thoracic|goren grb\w*|lopatk\w*|shoulder blade\w*)\b/i],
  ['neck', 'Neck', /\b(neck|vrat\w*)\b/i],
  ['shoulder', 'Shoulder', /\b(shoulders?|delts?|ram(o|ata|eno|eto)\w*)\b/i],
  ['elbow', 'Elbow', /\b(elbows?|lakt\w*|lak[oa]t\w*)\b/i],
  ['wrist', 'Wrist', /\b(wrists?|forearms?|zglob\w*|podlaktic\w*)\b/i],
  ['hip', 'Hip', /\b(hips?|glutes?|groin|kolk\w*|preponi?\w*|gaz\w*)\b/i],
  ['knee', 'Knee', /\b(knees?|patell\w*|kolen\w*|kolena)\b/i],
  ['hamstring', 'Hamstring', /\b(hamstrings?|hammies|zadna loza|lozi)\b/i],
  ['ankle', 'Ankle', /\b(ankles?|achilles|calf|calves|glu(z|ž|zh)d\w*|list(ot|ovi))\b/i],
  ['back', 'Back', /\b(back|grb\w*)\b/i],
];
export const AREA_LABEL = Object.fromEntries(AREAS.map(([id, label]) => [id, label]));
const AREA_IDS = AREAS.map(([id]) => id);

/** The areas a line of his names (most specific: "lower back" is not also "back"). */
export function areasIn(text) {
  const t = String(text || '');
  const hits = [];
  for (const [id, , re] of AREAS) {
    if (!re.test(t)) continue;
    if (id === 'back' && hits.some((h) => h === 'lower-back' || h === 'upper-back')) continue;
    hits.push(id);
  }
  return hits;
}

/** An area id from his word ("lower back", "krsta", "knee") or an id; null when none. */
export function areaOf(word) {
  const w = String(word || '').trim().toLowerCase();
  if (AREA_IDS.includes(w)) return w;
  return areasIn(w)[0] || null;
}

/** A pain rating 0-10 in what he wrote ("3/10", "pain 4", "tiny" ...): the number only when he wrote one. */
export function ratingIn(text) {
  const m = /\b(10|[0-9])\s*(\/\s*10|out of 10|od 10)\b/i.exec(String(text || '')) || /\b(?:pain|bolka|boli)\s*(?:is|at|e|na)?\s*(10|[0-9])\b/i.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Pain he wrote down in finished workouts: one entry per exercise and day, with the lift it was on. The session note
 * counts too (lift null). Lines the app adds itself ("Skipped last time...") never count.
 * @returns {Array<{date, at, area, lift, text, rating, source:'workout', sessionId}>}
 */
export function painFromWorkouts(sessions = [], sets = []) {
  const notesBy = new Map();
  for (const x of sets) if (x.note) { const k = `${x.sessionId}|${x.exKey}`; notesBy.set(k, [...(notesBy.get(k) || []), x.note]); }
  const out = [];
  for (const s of sessions) {
    if (!s || (s.status !== 'done' && s.status !== 'active') || !s.startedAt) continue;
    const date = isoDate(new Date(s.startedAt));
    const names = (s.exercises || []).map((e) => e.name);
    const push = (lift0, text) => {
      const said = painIn(text);
      if (!said) return;
      // "Lower back pain from squats" / "pain on bodyweight squat warm-up" on another exercise: the squat hurt.
      const from = /\b(?:from|on|during|doing) (?:the |my )?([a-z][a-z -]{2,30})/i.exec(said)?.[1]?.toLowerCase() || '';
      const first = (n) => n.toLowerCase().replace(/\(.*$/, '').trim().split(/\s+/)[0].replace(/s$/, '');
      const other = from ? names.find((n) => n !== lift0 && from.split(/\s+/).some((w) => w.replace(/s$/, '') === first(n))) : null;
      const lift = other || lift0;
      const areas = areasIn(said);
      for (const area of areas.length ? areas : ['unspecified']) out.push({ date, at: s.startedAt, area, lift, text: said.slice(0, 200), rating: ratingIn(said), source: 'workout', sessionId: s.id });
    };
    for (const ex of s.exercises || []) {
      const own = String(ex.notes || '').split('\n').filter((l) => !/^(Skipped last time|Swapped for)/.test(l.trim())).join('\n');
      push(ex.name, [ex.skipped?.reason, own, ...(notesBy.get(`${s.id}|${ex.key}`) || [])].filter(Boolean).join(' | '));
    }
    if (s.note) push(null, s.note);
  }
  return out;
}

/** His own entries (collection 'pain-log'), the same shape. */
export const painFromLog = (docs = []) => docs.filter((d) => d && d.date && d.area && !d.deleted)
  .map((d) => ({ date: d.date, at: d.at ?? Date.parse(`${d.date}T12:00:00Z`), area: d.area, lift: d.lift || null, text: d.note || '', rating: d.rating ?? null, source: 'log', id: d.id }));

/**
 * The log per area, newest day first: per day the highest rating that day (null when only words), the lifts and what
 * he said. trend: his last two rated days ("worse" / "better" / "same"), else null.
 * @returns {Array<{area, label, days: Array<{date, rating, lifts:string[], texts:string[]}>, trend, last}>}
 */
export function painByArea(entries = []) {
  const by = new Map();
  for (const e of entries) {
    if (!by.has(e.area)) by.set(e.area, new Map());
    const days = by.get(e.area);
    const d = days.get(e.date) || { date: e.date, rating: null, lifts: [], texts: [] };
    if (e.rating != null) d.rating = Math.max(d.rating ?? 0, e.rating);
    if (e.lift && !d.lifts.includes(e.lift)) d.lifts.push(e.lift);
    if (e.text && !d.texts.includes(e.text)) d.texts.push(e.text);
    days.set(e.date, d);
  }
  return [...by.entries()].map(([area, days]) => {
    const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
    const rated = list.filter((d) => d.rating != null);
    const trend = rated.length >= 2 ? (rated[0].rating > rated[1].rating ? 'worse' : rated[0].rating < rated[1].rating ? 'better' : 'same') : null;
    return { area, label: AREA_LABEL[area] || 'Somewhere (no area named)', days: list, trend, last: list[0].date };
  }).sort((a, b) => b.last.localeCompare(a.last));
}

/**
 * The same lift hurting the same area on more than one day (his squats and his lower back, Thu 10/22 and Thu 11/5).
 * @returns {Array<{lift, area, label, dates:string[]}>} newest first
 */
export function repeatFlags(entries = []) {
  const by = new Map();
  for (const e of entries) {
    if (!e.lift || e.area === 'unspecified') continue;
    const k = `${e.lift}|${e.area}`;
    if (!by.has(k)) by.set(k, { lift: e.lift, area: e.area, label: AREA_LABEL[e.area] || e.area, dates: [] });
    const f = by.get(k);
    if (!f.dates.includes(e.date)) f.dates.push(e.date);
  }
  return [...by.values()].filter((f) => f.dates.length >= 2).map((f) => ({ ...f, dates: f.dates.sort().reverse() })).sort((a, b) => b.dates[0].localeCompare(a.dates[0]));
}

/** Every entry, from both sources. */
export const painEntries = ({ sessions = [], sets = [], log = [] } = {}) => [...painFromWorkouts(sessions, sets), ...painFromLog(log)];

/** One area's line for the coach or the card: "Lower back: Thu 11/5 (squat), Thu 10/22 3/10 (squat). Trend: worse." */
export function areaText(a, dayText = (d) => d, max = 5) {
  const days = a.days.slice(0, max).map((d) => `${dayText(d.date)}${d.rating != null ? ` ${d.rating}/10` : ''}${d.lifts.length ? ` (${d.lifts.join(', ')})` : ''}`);
  return `${a.label}: ${days.join('; ')}${a.days.length > max ? `; ${a.days.length - max} more` : ''}${a.trend ? `. Trend: ${a.trend}` : ''}`;
}

/** The doc saved for an entry he logs (screen or coach). */
export function painDoc({ area, rating = null, lift = null, note = '', date, now = Date.now(), said = null }) {
  const id = `pain.${date}.${area}.${now.toString(36)}`;
  return { id, date, at: now, area, rating: rating == null || !Number.isFinite(Number(rating)) ? null : Math.max(0, Math.min(10, Math.round(Number(rating)))), lift: lift || null, note: String(note || '').slice(0, 300), ...(said ? { said: String(said).slice(0, 300) } : {}) };
}
