// Coach tools for features the app was missing (Thu 11/5, his words: "dive even deeper figure out more stuff regarding
// missing features"):
//   morning_checklist  his morning routine as a checklist on Today (lib/morning.js): list it, tick or untick items on his
//                      words, or set his items (his words). No notifications of its own.
//   clinic_summary     what the one-page clinic summary shows (lib/clinic.js), from his records only; open it with
//                      open_screen clinic_summary. No advice and no reading of the numbers.
import { snapshot, dayText, wrote, refuse, formatHm } from './shared.mjs';
import { put } from './tools-write.mjs';
import { morningItems, morningState, withMorningTick, findItem } from '../../app/js/lib/morning.js';
import { clinicSummary } from '../../app/js/lib/clinic.js';
import { comebackStartOf } from '../../app/js/lib/finish.js';
import { hmOf } from '../../app/js/lib/time.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ISO = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const HIS_WORDS = 'Only when he tells you to (his words), never on your own idea.';
const snap = (ctx) => snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });

function morningChecklist(a, ctx) {
  const s = snap(ctx);
  const cur = s.one('settings', 'main') || {};
  const items = morningItems(s.settings().notify.morning);
  if (a.action === 'set') {
    const next = (a.items || []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 20);
    put(s, 'settings', 'main', { ...cur, notify: { ...(cur.notify || {}), morning: { ...(cur.notify?.morning || {}), items: next } } });
    return wrote(next.length ? `His morning checklist on Today: ${next.join('; ')}.` : 'Morning checklist cleared: nothing on Today.', `morning checklist ${next.length} items`);
  }
  const date = a.date || s.foodDay();
  if (date > s.today) return refuse('Not a future date.');
  const day = s.days()[date] || null;
  const state = morningState(items, day);
  if (!items.length) return refuse('No morning checklist set. Set his items (his words) with action set.');
  if (a.action === 'tick') {
    const want = a.items || [];
    if (!want.length) return refuse(`Which? ${items.map((x, i) => `${i + 1}. ${x}`).join('; ')}.`);
    const found = []; const bad = [];
    for (const q of want) { const it = findItem(items, q); if (it) found.push(it); else bad.push(q); }
    if (bad.length) return refuse(`Not on his checklist: ${bad.join(', ')}. Items: ${items.map((x, i) => `${i + 1}. ${x}`).join('; ')}.`);
    const on = a.done !== false;
    let rec = day;
    for (const it of found) rec = withMorningTick(rec, date, it, on, s.now);
    put(s, 'days', date, rec);
    const left = morningState(items, rec).filter((x) => !x.at).map((x) => x.item);
    return wrote(`${on ? 'Ticked' : 'Unticked'}: ${found.join('; ')} (${dayText(date, s.today)}). ${left.length ? `Still open: ${left.join('; ')}.` : 'All done.'}`, `morning ${on ? 'tick' : 'untick'} ${found.length}`);
  }
  return state.map((x, i) => `${i + 1}. ${x.item}: ${x.at ? `done ${formatHm(hmOf(new Date(x.at), s.tz))}` : 'open'}`).join('\n');
}

function clinicText(a, ctx) {
  const s = snap(ctx);
  const c = clinicSummary({ today: s.today, tz: s.tz, recPlan: s.one('recovery', 'main'), recState: s.one('recovery', 'state'), notes: s.list('coach-notes'), tendons: s.list('tendons'),
    sessions: s.list('sessions'), sets: s.list('sets'), bridge: s.one('bridge', 'last-loads'), exercises: s.list('exercises'), scans: s.list('body-scans'), comebackStart: comebackStartOf(s.one('programme', 'meta')) });
  const out = [`Clinic summary (his records only, from ${dayText(c.from, s.today)}). Open it with open_screen clinic_summary; he prints it there.`];
  if (c.recovery) out.push(`${c.recovery.title}: ${c.recovery.sinceText || ''}${c.recovery.checkup ? `; checkup ${dayText(c.recovery.checkup, s.today)}` : ''}; ${c.recovery.checkIns.length} check-ins.`);
  out.push(`Tendon areas: ${c.tendons.map((t) => `${t.label} (${t.phase}): ${t.rounds} rounds on ${t.days} of the last ${t.of} days`).join('; ') || 'none with a phase'}.`);
  out.push(`Pain written down: ${c.pain.map((p) => `${dayText(p.date, s.today)} ${p.exercise ? `${p.exercise}${p.skipped ? ' (skipped)' : ''}: ` : ''}${p.text}`).join(' | ') || 'none'}.`);
  out.push(`Main lifts: ${c.lifts.map((l) => `${l.name} ${l.first.kg} kg -> ${l.last.kg} kg`).join('; ') || 'none'}.`);
  if (c.scans) out.push(`Body scans: ${c.scans.count}, ${dayText(c.scans.first, s.today)} to ${dayText(c.scans.last, s.today)}: ${c.scans.rows.map((x) => `${x.label} ${x.first ?? '—'} -> ${x.last ?? '—'}${x.unit ? ` ${x.unit}` : ''}`).join('; ')}.`);
  return out.join('\n');
}

const write = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });
const read = (name, title, description, inputSchema, fn) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: true }, run: async (args, ctx) => {
  const text = fn(args || {}, ctx);
  return { text, summary: text.split('\n')[0].slice(0, 120) };
} });

export const EXTRA_TOOLS = [
  write('morning_checklist', 'Morning checklist', `His morning routine as a checklist on Today, ticked per day. list: today's items, done or open. tick (${HIS_WORDS}): items he says he has done (their words or numbers); done: false unticks; date default his day now, never the future. set (${HIS_WORDS}): his items in his words, in his order ([] clears it). Never add items of your own; no reminders for it.`,
    obj({ action: { type: 'string', enum: ['list', 'tick', 'set'] }, items: { type: 'array', items: { type: 'string' } }, done: { type: 'boolean' }, date: ISO }, ['action']),
    async (a, ctx) => { const r = morningChecklist(a || {}, ctx); return typeof r === 'string' ? { text: r, summary: r.split('\n')[0].slice(0, 120) } : r; }),
  read('clinic_summary', 'Clinic summary', 'What his one-page clinic summary shows, from his records only: his recovery check-ins, tendon areas with phase and holds in the last 28 days, pain he wrote down in workouts, main lifts first and latest since the comeback, body scans first and latest. Read it out as it is: no advice, no reading of the numbers.',
    obj({}), clinicText),
];
