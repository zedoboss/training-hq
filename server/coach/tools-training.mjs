// The coach's tools for the missing training features (Thu 11/5, his words: "Also dive even deeper figure out more
// stuff regarding missing features"): pain outside the tendon areas per body area (lib/pain.js), his check-in in his
// own words mapped to the 0-3 rating he then confirms (readiness.js ratingFromWords), and the form-on-video gate for
// RDL and hip thrust (his own verdict, collection 'form-checks'; targets.js holds the step until it says consistent).
// Writes only on his words. No advice, no diagnosis: the pain log keeps what he said, the rating is his table's.
import { snapshot, dayText, findByName, wrote, refuse } from './shared.mjs';
import { put, del, num } from './tools-write.mjs';
import { AREAS, AREA_LABEL, areaOf, painEntries, painByArea, repeatFlags, areaText, painDoc } from '../../app/js/lib/pain.js';
import { ratingFromWords, askedAreas } from '../../app/js/lib/readiness.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HIS_WORDS = 'Only when he tells you to (his words), never on your own idea.';
const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const read = (name, title, description, inputSchema, fn) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true }, run: async (args, ctx) => {
  const text = fn(snap(ctx), args || {});
  return { text, summary: text.split('\n')[0].slice(0, 120) };
} });

const entriesOf = (s) => painEntries({ sessions: s.list('sessions'), sets: s.list('sets').filter((x) => x.note), log: s.list('pain-log') });

/** An exercise by his words: the ones he has logged first ("squat" is his Smith squat, not the library's barbell one). */
function findMine(s, q) {
  const names = [...s.lib().values()].map((e) => e.name);
  const h = s.history();
  const mine = names.filter((n) => h.last(n));
  const first = findByName(mine.map((name) => ({ name })), q);
  if (first.item) return { name: first.item.name, ambiguous: [] };
  const all = findByName(names.map((name) => ({ name })), q);
  return { name: all.item?.name || null, ambiguous: first.ambiguous.length ? first.ambiguous : all.ambiguous };
}

function painLog(a, s) {
  const date = a.date || s.today;
  if (date > s.today) return refuse('Not a future date.');
  if (a.action === 'delete') {
    const doc = s.one('pain-log', a.id);
    if (!doc) return refuse(`No pain entry ${a.id}. Tool pain lists them with ids.`);
    del(s, 'pain-log', a.id);
    return wrote(`Deleted: ${AREA_LABEL[doc.area] || doc.area} on ${dayText(doc.date, s.today)}${doc.rating != null ? `, ${doc.rating}/10` : ''}.`, 'pain entry deleted');
  }
  const area = areaOf(a.area);
  if (!area) return refuse(`Which area? One of: ${AREAS.map(([, l]) => l.toLowerCase()).join(', ')}.`);
  const lift = a.lift ? findMine(s, a.lift).name || String(a.lift).slice(0, 80) : null;
  const doc = painDoc({ area, rating: num(a.rating) ?? null, lift, note: a.note || '', date, now: s.now, said: a.said || null });
  put(s, 'pain-log', doc.id, doc);
  const all = entriesOf({ ...s, list: (c) => (c === 'pain-log' ? [...s.list('pain-log'), doc] : s.list(c)) });
  const again = lift ? repeatFlags(all).find((f) => f.lift === lift && f.area === area) : null;
  const byArea = painByArea(all).find((x) => x.area === area);
  return wrote(`Logged: ${AREA_LABEL[area]}${doc.rating != null ? ` ${doc.rating}/10` : ''}${lift ? ` on ${lift}` : ''}, ${dayText(date, s.today)} [id ${doc.id}]. ${byArea ? areaText(byArea, (d) => dayText(d, s.today), 4) : ''}.${again ? ` Flag: ${lift} has hurt his ${AREA_LABEL[area].toLowerCase()} ${again.dates.length} times (${again.dates.slice(0, 3).map((d) => dayText(d, s.today)).join(', ')}). Say that, nothing more: no advice.` : ''} On his Body > Pain screen.`, `pain ${AREA_LABEL[area]}`);
}

function painRead(s, a) {
  const entries = entriesOf(s);
  const areas = painByArea(a.area ? entries.filter((e) => e.area === areaOf(a.area)) : entries);
  if (!areas.length) return a.area ? `No pain logged for ${a.area}.` : 'No pain logged outside the tendon areas.';
  const flags = repeatFlags(entries);
  const own = s.list('pain-log').filter((d) => d && !d.deleted).sort((x, y) => y.at - x.at).slice(0, 10);
  return [
    'Pain per area (from his workout notes and skip reasons, and his own entries), newest first:',
    ...areas.map((x) => `- ${areaText(x, (d) => dayText(d, s.today), 8)}`),
    flags.length ? `Same lift, same area again: ${flags.map((f) => `${f.lift} and ${f.label.toLowerCase()}: ${f.dates.map((d) => dayText(d, s.today)).join(', ')}`).join('; ')}.` : '',
    own.length ? `His own entries (ids for delete): ${own.map((d) => `${dayText(d.date, s.today)} ${AREA_LABEL[d.area] || d.area}${d.rating != null ? ` ${d.rating}/10` : ''}${d.lift ? ` (${d.lift})` : ''} [id ${d.id}]`).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
}

const KEY_TEXT = { T: 'tendon area soreness', L: 'legs', B: 'back', E: 'energy' };
function rateWords(s, a) {
  const table = s.one('tendons', 'readiness');
  const key = a.key;
  const levels = (table?.ratings || []).find((r) => r.key === key)?.levels || [];
  const area = key === 'T' && a.area ? askedAreas(s.list('tendons')).find((x) => x.id === a.area || x.label.toLowerCase() === String(a.area).toLowerCase()) : null;
  const r = ratingFromWords(a.words, key, levels);
  const what = area ? `${area.label} (${KEY_TEXT.T})` : KEY_TEXT[key] || key;
  if (!r) return `"${a.words}" gives no number for ${what}. Ask him once, with his table's words: ${levels.map((l, i) => `${i} = ${l}`).join(', ')}.`;
  return `"${a.words}" reads as ${r.rating} for ${what}${r.level ? `: "${r.level}" in his table` : ''}. Ask him to confirm that number in one short line ("That's a ${r.rating}${r.level ? `, ${r.level}` : ''}. Right?"); only after his yes, give it to check_in.`;
}

function formCheck(a, s) {
  const hit = findMine(s, a.exercise);
  const name = hit.name;
  if (!name) return refuse(hit.ambiguous.length ? `Which one: ${hit.ambiguous.join('; ')}?` : `No exercise called "${a.exercise}" in his library.`);
  const date = a.date || s.today;
  if (date > s.today) return refuse('Not a future date.');
  const id = `form.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${date}`;
  const doc = { id, name, date, at: s.now, ok: !!a.ok, note: String(a.note || '').slice(0, 300), said: a.said ? String(a.said).slice(0, 300) : null, by: 'his words' };
  put(s, 'form-checks', id, doc);
  return wrote(`${name}: form ${doc.ok ? 'consistent on video' : 'not consistent yet'} (his call, ${dayText(date, s.today)}). ${doc.ok ? 'Its next target steps up again (one step, under the cap and the table).' : 'Its target repeats the last load until he says his form is consistent on video.'}`, `${name} form ${doc.ok ? 'ok' : 'not yet'}`);
}

export const TRAINING_TOOLS = [
  write('pain_log', 'Pain log', `${HIS_WORDS} Pain outside his tendon areas, per body area (Body > Pain): log = area (lower back, upper back, neck, shoulder, elbow, wrist, hip, knee, hamstring, ankle, back), rating 0-10 only if he gave one, lift = the exercise it was on, note and said = his words; date default today. delete = id (only on his explicit words). The result says when the same lift has hurt the same area before: say it plainly, no advice, no diagnosis. Pain he writes in a workout note or skip reason is in the log already; don't log it twice.`,
    obj({ action: { type: 'string', enum: ['log', 'delete'] }, area: { type: 'string' }, rating: { type: 'integer', minimum: 0, maximum: 10 }, lift: { type: 'string' }, note: { type: 'string' }, said: { type: 'string' }, date: ISO, id: { type: 'string' } }, ['action']), (a, ctx) => painLog(a, snap(ctx))),
  read('pain', 'Pain per area', 'His pain outside the tendon areas per body area over days, with its trend and the lifts it was on (workout notes, skip reasons and his own entries), and every lift that hurt the same area more than once. area: one area only.', obj({ area: { type: 'string' } }), painRead),
  read('rate_words', 'Check-in rating from his words', "When he can't give a 0-3 number at the check-in and says it in words (\"somewhat sore and a tiny tiny pain\"): key T (a tendon area; area = its id or name), L (legs), B (back) or E (energy), words = what he said. Gives the number his words map to on his table; you ask him to confirm it, then check_in.", obj({ key: { type: 'string', enum: ['T', 'L', 'B', 'E'] }, area: { type: 'string' }, words: { type: 'string' } }, ['key', 'words']), rateWords),
  write('form_check', 'Form on video', `${HIS_WORDS} His verdict on a lift gated on filmed form (RDL, hip thrust): ok true = his form was consistent on video, so its next target steps up again; ok false = not yet, the target repeats the last load. exercise = its name; note / said = his words; date default today. Never your own judgement of his form.`,
    obj({ exercise: { type: 'string' }, ok: { type: 'boolean' }, note: { type: 'string' }, said: { type: 'string' }, date: ISO }, ['exercise', 'ok']), (a, ctx) => formCheck(a, snap(ctx))),
];
