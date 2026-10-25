// The coach's memory of every day (Thu 10/22, his words: "add smart memory... it remembers for each day what I've
// done, what hour, 1 minute, everything... every note I've written... as up-to-date as possible"). Nothing new is
// stored for it: the timeline is read live from the records the app already keeps (messages, notifications, meals,
// supplements, sets, holds, walks, sleep, scans, sauna, notes, reminders, changes...), so it is never out of date and
// never disagrees with the screens. recall searches everything he wrote and was told. Deterministic, no AI.
import { formatTime, formatDay, formatHm, isoDate, zonedTime } from '../../app/js/lib/time.js';
import { addDays, LABEL } from '../../app/js/lib/rotation.js';
import { kg as k } from '../../app/js/lib/loads.js';
import { oneArm, armOf } from './shared.mjs';
import { coachPlanned } from '../../app/js/lib/walks.js';
import { itemAmount, myFoods } from '../../app/js/lib/foods.js';

/** What the timeline can show; kinds: [...] picks some. */
export const TIMELINE_KINDS = ['sleep', 'messages', 'notifications', 'meals', 'supplements', 'workouts', 'holds', 'checkins', 'health', 'walks', 'scans', 'sauna', 'squats', 'notes', 'reminders', 'changes', 'holdoffs', 'days', 'diary'];
export const MAX_DAYS = 7;
export const MAX_LINES = 700;

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const plural = (n, w) => `${n} ${n === 1 ? w : `${w}s`}`;
const TYPE_WORD = { warmup: 'warm-up', dropset: 'drop set', failure: 'to failure', hold: 'hold' };
const ASK_WORD = { ask: 'asked for a change', amend: 'added to his change request', verify: 'asked to double-check a change', review: 'the check on the Mac found' };

/** "2026-10-22" or "2026-10-22 15:00" (or with a T) to a moment in his zone. */
function momentOf(text, tz, end = false) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(String(text || '').trim());
  if (!m) return null;
  if (m[2]) return zonedTime(m[1], m[2], tz);
  return zonedTime(end ? addDays(m[1], 1) : m[1], '00:00', tz);
}

/**
 * The window asked for: a date (that whole day), or from/to (dates or "YYYY-MM-DD HH:MM"; to is inclusive for a date).
 * Default: today. At most 7 days. Returns {from, to (exclusive), error?}.
 */
export function windowOf({ date = null, from = null, to = null } = {}, { tz, today }) {
  if (date) {
    const a = momentOf(date, tz); const b = momentOf(date, tz, true);
    return a == null ? { error: `Not a date: ${date} (YYYY-MM-DD).` } : { from: a, to: b };
  }
  const a = from ? momentOf(from, tz) : momentOf(today, tz);
  const b = to ? momentOf(to, tz, true) : from && /\d{2}:\d{2}$/.test(from) ? a + 3600000 : momentOf(from ? String(from).slice(0, 10) : today, tz, true);
  if (a == null || b == null) return { error: 'from and to: YYYY-MM-DD, or YYYY-MM-DD HH:MM.' };
  if (b <= a) return { error: 'to is before from.' };
  if (b - a > MAX_DAYS * 86400000 + 3600000) return { error: `At most ${MAX_DAYS} days at a time; use kinds or a shorter window.` };
  return { from: a, to: b };
}

/** Every event of the records in the snapshot, unsorted: {at, kind, text}. */
function allEvents(s) {
  const out = [];
  const ev = (at, kind, text) => { if (Number.isFinite(at) && text) out.push({ at, kind, text }); };
  const t = (ms) => formatTime(new Date(ms), s.tz);

  // Sleep: what he told the coach, else Apple Health.
  const told = new Set();
  for (const l of s.list('sleep-log')) {
    told.add(l.date);
    ev(l.bed, 'sleep', `Went to bed (he said; night to ${l.date})`);
    ev(l.wake, 'sleep', `Woke up: ${Math.round((l.asleepMin ?? l.inBedMin ?? 0) / 6) / 10} h asleep${l.quality ? `, quality ${l.quality}/5` : ''}${l.note ? `. ${clip(l.note, 200)}` : ''}`);
  }
  for (const h of s.list('health')) {
    if (h.sleep?.bed && !told.has(h.date) && !h.sleep.told) {
      ev(h.sleep.bed, 'sleep', 'Fell asleep (Apple Health)');
      ev(h.sleep.wake, 'sleep', `Woke up (Apple Health): ${Math.round((h.sleep.asleepMin ?? h.sleep.inBedMin ?? 0) / 6) / 10} h asleep`);
    }
    const stepsAt = h.fileAt || h.updatedAt;
    if (h.steps != null && stepsAt) ev(stepsAt, 'health', `${isoDate(new Date(stepsAt), s.tz) === h.date ? 'Steps so far' : `Steps for ${formatDay(new Date(`${h.date}T12:00:00Z`), 'UTC')}`} (Apple Health): ${Number(h.steps).toLocaleString('en-US')}`);
    for (const w of h.weights || []) ev(w.at, 'health', `Weight (Apple Health): ${k(w.kg)} kg`);
    for (const w of h.workouts || []) ev(w.start, 'health', `Apple Health workout: ${w.activity || 'workout'}${w.minutes ? `, ${Math.round(w.minutes)} min` : ''}${w.kcal ? `, ${Math.round(w.kcal)} kcal` : ''}`);
  }

  // Messages: his words in full, the coach's replies short, the app's notifications in the coach's name.
  for (const m of s.list('coach-messages')) {
    if (m.role === 'user') ev(m.at, 'messages', `He${m.via === 'voice' ? ' (voice)' : ''}: "${clip(m.text, 600)}"`);
    else if (m.role === 'assistant' && m.kind) ev(m.at, 'notifications', `Sent to him (${m.kind}): "${clip(m.text, 180)}"`);
    else if (m.role === 'assistant' && !m.error) ev(m.at, 'messages', `Coach: "${clip(m.text, 180)}"${m.tools?.length ? ` [${[...new Set(m.tools.map((x) => x.summary || x.name))].slice(0, 4).map((x) => clip(x, 60)).join('; ')}]` : ''}`);
  }

  // Meals and his answers about them.
  const mine = myFoods(s.one('fuel', 'plan'));
  for (const meal of s.list('meals')) {
    const items = meal.before?.items || [];
    const kcal = Math.round(items.reduce((n, x) => n + (Number(x.kcal) || 0), 0));
    const protein = Math.round(items.reduce((n, x) => n + (Number(x.protein) || 0), 0));
    ev(meal.at, 'meals', `Meal: ${meal.name || 'meal'}: ${items.length ? items.map((x) => `${x.name} ${itemAmount(x, mine)}`).join(', ') : meal.before?.photoId ? 'photo, items being read' : 'nothing entered (an empty meal: counts as no meal)'}${items.length ? `; ${kcal} kcal, ${protein} g protein` : ''}${meal.before?.photoId ? '; before photo' : ''}${meal.date && isoDate(new Date(meal.at), s.tz) !== meal.date ? ` (for ${meal.date}, his waking day)` : ''}${meal.note ? `. Note: ${clip(meal.note, 200)}` : ''}`);
    if (meal.after?.at && (meal.after.photoId || meal.after.none)) ev(meal.after.at, 'meals', `After the ${String(meal.name || 'meal').toLowerCase()}: ${meal.after.none ? 'ate it all' : 'after photo (leftovers)'}`);
  }
  for (const c of s.list('meal-checks')) ev(c.at, 'meals', `Meal answer (${c.name || c.slot}): ${c.answer}${c.until ? `, done by ${c.until}` : ''}`);

  // Supplements: each tick or skip with his reason; restock and planning answers.
  const supps = new Map(s.list('supplements').map((x) => [x.id, x.short || x.name]));
  for (const l of s.list('supp-log')) ev(l.at, 'supplements', `Supplement ${l.status === 'taken' ? 'taken' : l.status}: ${supps.get(l.suppId) || l.suppId}${l.dose ? ` (${l.dose})` : ''}${l.reason ? `, reason: ${clip(l.reason, 160)}` : ''}${l.date && l.at && isoDate(new Date(l.at), s.tz) !== l.date ? ` (for ${l.date})` : ''}`);
  for (const a of s.list('supp-answers')) ev(a.at, 'supplements', `Supplement answer (${a.kind || 'plan'}${a.suppId ? `, ${supps.get(a.suppId) || a.suppId}` : ''}): ${a.answer || ''}${a.text ? `: ${clip(a.text, 160)}` : ''}`);

  // Workouts and holds rounds, set by set.
  const sets = new Map();
  for (const x of s.list('sets')) { if (!sets.has(x.sessionId)) sets.set(x.sessionId, []); sets.get(x.sessionId).push(x); }
  for (const se of s.list('sessions')) {
    if (!se.startedAt) continue;
    const holds = se.kind === 'holds';
    const kind = holds ? 'holds' : 'workouts';
    const exs = new Map((se.exercises || []).map((e) => [e.key, e]));
    const mine = (sets.get(se.id) || []).filter((x) => x.done).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0) || a.order - b.order);
    const from = se.source && se.source !== 'training-hq' ? ` (from ${se.source[0].toUpperCase()}${se.source.slice(1)})` : '';
    const title = holds ? `Holds round (${se.area || se.title || 'holds'}${se.round ? `, ${se.round}` : ''})` : `Workout: ${se.title || LABEL[se.dayType] || 'session'}${se.week ? ` (week ${se.week})` : ''}`;
    ev(se.startedAt, kind, `${title} started${from}${se.status === 'active' ? ' (still open)' : se.status === 'discarded' ? ' (discarded)' : ''}`);
    const n = new Map();
    // Sat 10/24: a one-arm exercise (his notes: "single arm", "desna pa leva") says each set's round and arm.
    const arms = new Map((se.exercises || []).map((e) => [e.key, holds ? false : e.oneArm || oneArm(s, e.name, [e.notes, ...mine.filter((x) => x.exKey === e.key).map((x) => x.note)])]));
    const setText = (x) => {
      const e = exs.get(x.exKey) || {};
      const arm = arms.get(x.exKey) ? armOf(mine, x) : null;
      const c = (n.get(x.exKey) || 0) + (x.type === 'warmup' ? 0 : 1); n.set(x.exKey, c);
      const load = x.kg != null ? `${k(x.kg)} kg` : '';
      const what = [load, x.reps != null ? `× ${x.reps}` : '', x.durationS ? `${x.durationS} s` : ''].filter(Boolean).join(' ') || 'done';
      return `${e.name || 'exercise'} ${x.type === 'warmup' ? 'warm-up' : `set ${c}`}${arm ? ` (round ${arm.round}, ${arm.arm} arm)` : ''}: ${what}${x.type && x.type !== 'normal' && x.type !== 'warmup' ? ` (${TYPE_WORD[x.type] || x.type})` : ''}${num(x.rpe) != null ? `, RPE ${x.rpe}` : ''}${num(x.pain) != null ? `, pain ${x.pain}/10` : ''}${num(x.shaking) != null ? `, shaking ${x.shaking}` : ''}${x.arm && !arm ? `, ${x.arm} arm` : ''}${x.note ? `. Note: ${clip(x.note, 200)}` : ''}`;
    };
    const timed = mine.filter((x) => x.doneAt);
    for (const x of timed) ev(x.doneAt, kind, setText(x));
    // Imported sessions have no set times: one line per exercise at the start.
    const untimed = mine.filter((x) => !x.doneAt);
    for (const key of [...new Set(untimed.map((x) => x.exKey))]) ev(se.startedAt + 1, kind, `(no set times) ${untimed.filter((x) => x.exKey === key).map(setText).join('; ')}`);
    for (const e of se.exercises || []) {
      if (e.notes) ev(se.startedAt + 2, kind, `Note on ${e.name}: ${clip(e.notes, 300)}`);
      if (e.skipped) ev(e.skipped.at || se.startedAt, kind, `Skipped ${e.name}${e.skipped.reason ? `: ${clip(e.skipped.reason, 200)}` : ''}`);
    }
    if (se.endedAt && se.status !== 'discarded') {
      const work = mine.filter((x) => x.type !== 'warmup');
      ev(se.endedAt, kind, `${title} ended: ${Math.round((se.endedAt - se.startedAt - (se.pausedMs || 0)) / 60000)} min, ${plural(work.length, 'set')}${se.note ? `. Note: ${clip(se.note, 300)}` : ''}`);
    }
  }

  // The day records: readiness check-ins, fasting, rest days, session times, rest-day holds.
  for (const d of s.list('days')) {
    const r = d.readiness;
    if (r?.at) {
      const T = Object.entries(r.ratings?.T || {}).map(([a, v]) => `${a} ${v}${r.ratings?.W?.[a] ? ' (worse than yesterday)' : ''}`);
      const rest = ['L', 'B', 'E'].filter((x) => Number.isInteger(r.ratings?.[x])).map((x) => `${{ L: 'legs', B: 'back', E: 'energy' }[x]} ${r.ratings[x]}`);
      ev(r.at, 'checkins', `Readiness check-in${r.dayType ? ` (${LABEL[r.dayType] || r.dayType})` : ''}: ${[...T, ...rest].join(', ')} -> ${r.action || 'decided'}${r.lighterExercises?.length ? ` (lighter: ${r.lighterExercises.join(', ')})` : ''}`);
    }
    if (d.fast?.at) ev(d.fast.at, 'days', `Fasting today${d.fast.said ? ` ("${clip(d.fast.said, 120)}")` : ''}`);
    if (d.fast?.endedAt) ev(d.fast.endedAt, 'days', 'Fast ended');
    if (d.rest?.at) ev(d.rest.at, 'days', `Rest day (${d.rest.reason || 'added'}) for ${d.date}`);
    if (d.sessionTime && d.timeSetAt) ev(d.timeSetAt, 'days', `Session time for ${d.date} set: ${formatHm(d.sessionTime)}`);
    for (const [area, c] of Object.entries(d.restHolds || {})) ev(c.at, 'holds', `Rest-day hold (${area}): ${c.choice}${c.hold ? ` (${clip(c.hold, 80)})` : ''}`);
  }

  // Walks.
  for (const w of s.list('walks')) {
    if (w.plan?.setAt) ev(w.plan.setAt, 'walks', `Walk planned for ${t(w.plan.at)}${coachPlanned(w.plan) ? ' (by the app, for the weather)' : ''}${w.plan.said && !coachPlanned(w.plan) ? ` ("${clip(w.plan.said, 120)}")` : ''}`);
    if (w.going?.at) ev(w.going.at, 'walks', 'Out walking');
    for (const x of w.walks || []) ev(x.at, 'walks', `Walk done${x.minutes ? `: ${x.minutes} min` : ''}${x.steps ? `, ${x.steps} steps` : ''}`);
    for (const x of w.skips || []) ev(x.at, 'walks', `Walk skipped${x.reason ? `: ${clip(x.reason, 120)}` : ''}`);
    if (w.goalAt) ev(w.goalAt, 'walks', 'Step goal reached');
  }

  // Body: scans, weigh-ins, photos; Squat Depth; sauna.
  const metric = (sc, re) => (sc.metrics?.length ? sc.metrics : sc.pdf?.metrics || []).find((m) => re.test(m.label || '')) || (sc.pdf?.metrics || []).find((m) => re.test(m.label || ''));
  for (const sc of s.list('body-scans')) {
    if (sc.status !== 'done') continue;
    const at = sc.at || (sc.pdf?.hm ? zonedTime(sc.date, sc.pdf.hm, s.tz) : sc.createdAt);
    const parts = [[/^weight$/i, 'weight', 'kg'], [/body fat percent|^pbf|percent body fat/i, 'body fat', '%'], [/lean body mass/i, 'lean mass', 'kg'], [/skeletal muscle/i, 'muscle', 'kg']]
      .map(([re, name, unit]) => { const m = metric(sc, re); return m ? `${name} ${m.text ?? m.value}${m.unit || unit ? ` ${m.unit || unit}` : ''}` : ''; }).filter(Boolean);
    ev(at, 'scans', `Body scan (Evolt)${parts.length ? `: ${parts.join(', ')}` : ''}${sc.unusual ? `. Unusual: ${clip(sc.unusual, 120)}` : ''}`);
  }
  for (const m of s.list('measurements')) if (m.at && m.weightKg != null) ev(m.at, 'scans', `Weigh-in${m.source ? ` (${m.source})` : ''}: ${k(m.weightKg)} kg${m.fatPercent != null ? `, ${m.fatPercent}% fat` : ''}`);
  for (const p of s.list('body-photos')) if (p.at) ev(p.at, 'scans', `Progress photo${p.pose ? ` (${p.pose})` : ''}`);
  for (const r of s.list('squats')) if (r.startedAt) ev(r.startedAt, 'squats', `Squat Depth: ${r.good ?? 0} good, ${r.shallow ?? 0} shallow${r.estimated ? ` (${r.estimated} estimated)` : ''}${r.lowDeg != null ? `, lowest ${Math.round(r.lowDeg)}°` : ''}`);
  for (const x of s.list('sauna')) {
    if (!x.startedAt) continue;
    ev(x.startedAt, 'sauna', `Sauna started: ${x.plannedRounds || '?'} × ${x.roundMin || '?'} min${x.tempC ? `, ${x.tempC}°C` : ''}`);
    for (const r of x.rounds || []) { if (r.inAt) ev(r.inAt, 'sauna', `Sauna round ${r.n}: in`); if (r.outAt) ev(r.outAt, 'sauna', `Sauna round ${r.n}: out after ${Math.round((r.outAt - r.inAt) / 60000)} min`); }
    for (const y of x.symptoms || []) ev(y.at, 'sauna', `SAUNA SYMPTOMS (${y.when || 'during'}): ${(y.what || []).join(', ') || 'symptoms'}`);
    if (x.endedAt) ev(x.endedAt, 'sauna', `Sauna ${x.status === 'stopped' ? 'stopped (symptoms)' : 'ended'}${x.note ? `. Note: ${clip(x.note, 200)}` : ''}`);
    if (x.after?.answeredAt) ev(x.after.answeredAt, 'sauna', `After the sauna: ${x.after.symptoms ? `symptoms (${(x.after.what || []).join(', ')})` : 'no symptoms'}`);
  }

  // The coach's own records: notes (and facts that expired), reminders, hold-offs, changes, the nightly diary.
  for (const n of s.list('coach-notes')) {
    ev(n.at, 'notes', `Coach note${n.topic ? ` (${n.topic})` : ''}: ${clip(n.text, 300)}`);
    if (n.edited && n.replaced?.length) ev(n.edited, 'notes', `Note ${n.id} reworded (was: ${clip(n.replaced.at(-1).text, 160)})`);
    if (n.expiredAt) ev(n.expiredAt, 'notes', `Fact expired${n.replacedBy ? ` (replaced by ${n.replacedBy})` : ''}: ${clip(n.text, 160)}`);
  }
  for (const r of s.list('coach-reminders')) {
    ev(r.createdAt ?? r.at, 'reminders', `Reminder set${r.trigger ? ' for when he starts his workout log' : ` for ${t(r.at)}`}: "${clip(r.text, 200)}" [${r.id}]`);
    if (r.firedAt) ev(r.firedAt, 'reminders', `Reminder went off [${r.id}]`);
    if (r.cancelledAt) ev(r.cancelledAt, 'reminders', `Reminder cancelled: "${clip(r.text, 120)}" [${r.id}]`);
  }
  for (const h of s.list('coach-holds')) {
    ev(h.at, 'holdoffs', `He asked the app to hold off ${(h.areas || []).join(', ')} until ${t(h.until)}${h.reason ? ` ("${clip(h.reason, 120)}")` : ''}`);
    if (h.cancelledAt) ev(h.cancelledAt, 'holdoffs', `Hold-off lifted: ${(h.areas || []).join(', ')}`);
  }
  for (const c of s.list('coach-changes')) {
    const asks = Array.isArray(c.asks) && c.asks.length ? c.asks : [{ at: c.at, said: c.said, kind: 'ask' }];
    for (const a of asks) ev(a.at, 'changes', `${a.kind === 'review' ? 'The check on the Mac found' : `He ${ASK_WORD[a.kind] || 'asked for a change'}`}: "${clip(a.said, 300)}" [${c.id}]`);
    if (c.doneAt && c.status !== 'cancelled') ev(c.doneAt, 'changes', `Change ${c.status}: ${clip(c.answer, 200)} [${c.id}]`);
    if (c.status === 'cancelled') ev(c.doneAt || c.at, 'changes', `Change cancelled [${c.id}]`);
  }
  for (const d of s.list('coach-diary')) if (d.at && d.summary) ev(d.at, 'diary', `Nightly diary for ${d.date} written`);
  return out;
}

/** The events between from and to (ms), oldest first; kinds picks some. */
export function timelineEvents(s, { from, to, kinds = null } = {}) {
  const want = kinds?.length ? new Set(kinds) : null;
  return allEvents(s).filter((e) => e.at >= from && e.at < to && (!want || want.has(e.kind))).sort((a, b) => a.at - b.at || TIMELINE_KINDS.indexOf(a.kind) - TIMELINE_KINDS.indexOf(b.kind));
}

/** The timeline as text: a day header per day, then "4:52 AM [workouts] ..." lines. */
export function timelineText(s, args = {}) {
  const w = windowOf(args, { tz: s.tz, today: s.today });
  if (w.error) return w.error;
  const kinds = (args.kinds || []).filter((x) => TIMELINE_KINDS.includes(x));
  const events = timelineEvents(s, { from: w.from, to: w.to, kinds });
  const midnight = (ms) => formatTime(new Date(ms), s.tz) === '12:00 AM';
  const span = midnight(w.from) && midnight(w.to) && w.to - w.from <= 25 * 3600000 ? formatDay(new Date(w.from), s.tz)
    : `${formatDay(new Date(w.from), s.tz)}, ${formatTime(new Date(w.from), s.tz)} to ${formatDay(new Date(w.to), s.tz)}, ${formatTime(new Date(w.to), s.tz)}`;
  if (!events.length) return `Nothing recorded ${span}${kinds.length ? ` (${kinds.join(', ')})` : ''}.`;
  const lines = [`Timeline, ${span}${kinds.length ? ` (${kinds.join(', ')})` : ''}: ${plural(events.length, 'event')}, from the app's records (exact times).`];
  let day = '';
  for (const e of events.slice(0, MAX_LINES)) {
    const d = isoDate(new Date(e.at), s.tz);
    if (d !== day) { day = d; lines.push(`${formatDay(new Date(e.at), s.tz)}:`); }
    lines.push(`${formatTime(new Date(e.at), s.tz)} [${e.kind}] ${e.text}`);
  }
  if (events.length > MAX_LINES) lines.push(`… ${events.length - MAX_LINES} more: ask for fewer kinds or a shorter window.`);
  return lines.join('\n');
}

// ---- recall --------------------------------------------------------------------------------------------------------

const CYRILLIC = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh' };
/** Lower case, no accents (č = c), Macedonian Cyrillic in Latin letters. Same length as the text for Latin script. */
export const lightFold = (text) => String(text ?? '').toLowerCase().replace(/[Ѐ-ӿ]/g, (c) => CYRILLIC[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '');
/** For matching: also the ways Macedonian is typed in Latin letters (ch/č = c, sh/š = s, zh/ž = z, kj/ќ = k, gj/ѓ = g). */
export const fold = (text) => lightFold(text).replace(/dzh/g, 'dz').replace(/([csz])h/g, '$1').replace(/kj/g, 'k').replace(/gj/g, 'g').replace(/[^a-z0-9%°.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Everything he wrote and was told, as {at, src, text}. */
function sayings(s) {
  const out = [];
  const add = (at, src, text) => { if (Number.isFinite(at) && text && String(text).trim()) out.push({ at, src, text: String(text) }); };
  for (const m of s.list('coach-messages')) {
    if (m.role === 'user') add(m.at, m.via === 'voice' ? 'he said (voice)' : 'he wrote', m.text);
    else if (m.role === 'assistant' && !m.error) add(m.at, m.kind ? `notification (${m.kind})` : 'coach', m.text);
  }
  for (const n of s.list('coach-notes')) {
    add(n.at, `coach note${n.topic ? ` (${n.topic})` : ''}${n.expiredAt ? ', expired' : ''}`, n.text);
    for (const r of n.replaced || []) add(r.from || n.at, 'coach note, old wording', r.text);
  }
  const sets = new Map();
  for (const x of s.list('sets')) if (x.note) { if (!sets.has(x.sessionId)) sets.set(x.sessionId, []); sets.get(x.sessionId).push(x); }
  for (const se of s.list('sessions')) {
    if (!se.startedAt) continue;
    const exs = new Map((se.exercises || []).map((e) => [e.key, e]));
    const what = se.kind === 'holds' ? 'holds' : se.title || 'workout';
    if (se.note) add(se.endedAt || se.startedAt, `${what} note`, se.note);
    for (const e of se.exercises || []) {
      if (e.notes) add(se.startedAt, `exercise note (${e.name}, ${what})`, e.notes);
      if (e.skipped?.reason) add(e.skipped.at || se.startedAt, `skipped ${e.name} (${what})`, e.skipped.reason);
    }
    for (const x of sets.get(se.id) || []) add(x.doneAt || se.startedAt, `set note (${exs.get(x.exKey)?.name || 'exercise'}, ${what})`, x.note);
  }
  for (const meal of s.list('meals')) {
    const items = (meal.before?.items || []).map((x) => `${x.name} ${Math.round(Number(x.grams) || 0)} g`).join(', ');
    add(meal.at, `meal (${meal.name || 'meal'})`, [items, meal.note].filter(Boolean).join('. '));
  }
  const supps = new Map(s.list('supplements').map((x) => [x.id, x.short || x.name]));
  for (const l of s.list('supp-log')) if (l.reason) add(l.at, `supplement ${l.status} (${supps.get(l.suppId) || l.suppId})`, l.reason);
  for (const a of s.list('supp-answers')) if (a.text || a.answer) add(a.at, 'supplement answer', [a.answer, a.text].filter(Boolean).join(': '));
  for (const r of s.list('coach-reminders')) add(r.createdAt || r.at, 'reminder', r.text);
  for (const h of s.list('coach-holds')) if (h.reason) add(h.at, `hold-off (${(h.areas || []).join(', ')})`, h.reason);
  for (const c of s.list('coach-changes')) {
    for (const a of (Array.isArray(c.asks) && c.asks.length ? c.asks : [{ at: c.at, said: c.said, want: c.want }])) add(a.at, 'change he asked for', [a.said, a.want ? `wants: ${a.want}` : ''].filter(Boolean).join(' -> '));
    if (c.answer) add(c.doneAt || c.at, 'change answer', c.answer);
  }
  for (const d of s.list('days')) if (d.fast?.said) add(d.fast.at, 'fasting', d.fast.said);
  for (const w of s.list('walks')) {
    if (w.plan?.said && !coachPlanned(w.plan)) add(w.plan.setAt || w.plan.at, 'walk plan', w.plan.said);
    for (const x of w.skips || []) if (x.reason) add(x.at, 'walk skipped', x.reason);
  }
  for (const x of s.list('sauna')) {
    if (x.note) add(x.endedAt || x.startedAt, 'sauna note', x.note);
    for (const y of x.symptoms || []) add(y.at, 'sauna symptoms', (y.what || []).join(', '));
  }
  for (const q of s.list('coach-questions')) if (q.answered?.answer) add(q.answered.at, 'his answer to an open question', `${q.q ? `${clip(q.q, 120)} -> ` : ''}${q.answered.answer}`);
  for (const d of s.list('coach-diary')) {
    if (d.summary) add(d.at, `diary (${d.date})`, d.summary);
    for (const x of d.words || []) add(x.at || d.at, `his words that mattered (${d.date})`, x.text || x);
    for (const x of d.decisions || []) add(d.at, `decision (${d.date})`, x);
    for (const x of d.open || []) add(d.at, `open thread (${d.date})`, x);
  }
  return out;
}

/** A piece of the text around the first match, about 260 characters. */
function snippet(text, words) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= 260) return t;
  const lf = lightFold(t);
  const pos = Math.max(0, Math.min(...words.map((w) => { const i = lf.indexOf(w); return i < 0 ? Infinity : i; })));
  const at = Number.isFinite(pos) ? Math.max(0, pos - 80) : 0;
  return `${at > 0 ? '…' : ''}${t.slice(at, at + 260)}${at + 260 < t.length ? '…' : ''}`;
}

/**
 * Searches everything he wrote and was told (messages both ways, notifications, every kind of note, skip reasons,
 * reminders, change requests, the diary) for all the words of query, ignoring case and accents. Newest first.
 */
export function recallHits(s, { query, from = null, to = null, limit = 30 } = {}) {
  const words = fold(query).split(' ').filter((w) => w.length >= 2 || /\d/.test(w));
  if (!words.length) return { words, hits: [], total: 0, any: false };
  const lo = from ? momentOf(from, s.tz) : -Infinity; const hi = to ? momentOf(to, s.tz, true) : Infinity;
  const light = lightFold(query).split(/\s+/).filter(Boolean);
  const pool = sayings(s).filter((x) => x.at >= lo && x.at < hi).map((x) => ({ ...x, f: ` ${fold(x.text)} `, l: lightFold(x.text) }));
  // Exact spellings first (case and accents aside), then the Macedonian-in-Latin variants (ch = č = c...), newest first.
  const phrase = light.join(' ');
  const exact = (x) => (light.length > 1 && x.l.replace(/\s+/g, ' ').includes(phrase) ? 2 : light.every((w) => x.l.includes(w)) ? 1 : 0);
  let hits = pool.filter((x) => words.every((w) => x.f.includes(w))).sort((a, b) => exact(b) - exact(a) || b.at - a.at);
  let any = false;
  if (!hits.length && words.length > 1) { any = true; hits = pool.filter((x) => words.some((w) => x.f.includes(` ${w}`))).map((x) => ({ ...x, n: words.filter((w) => x.f.includes(` ${w}`)).length })).sort((a, b) => b.n - a.n || b.at - a.at); }
  return { words, total: hits.length, any, hits: hits.slice(0, Math.min(Math.max(Number(limit) || 30, 1), 80)).map((x) => ({ at: x.at, src: x.src, text: snippet(x.text, light) })) };
}

export function recallText(s, args = {}) {
  const r = recallHits(s, args);
  if (!r.words.length) return 'What should I look for? (query: words he used)';
  if (!r.total) return `Nothing he wrote or was told matches "${args.query}"${args.from || args.to ? ' in that window' : ''}. Try other words (his words, English or Macedonian), or the timeline for a day.`;
  return [`${r.any ? `No record has all of "${args.query}"; records with some of the words` : `Matches for "${args.query}"`} (${r.total}${r.total > r.hits.length ? `, ${r.hits.length} shown` : ''}), ${r.any ? 'most words first' : 'exact matches first, then newest first'}:`,
    ...r.hits.map((h) => `- ${formatDay(new Date(h.at), s.tz)}, ${formatTime(new Date(h.at), s.tz)} · ${h.src}: ${h.text}`)].join('\n');
}
