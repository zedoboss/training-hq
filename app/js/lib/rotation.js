// Rotation (step 4): where today sits in Pull, Push, Legs, Rest.
// Rules (brief decision 15, section 2): the next day type comes from the last completed session, not the calendar.
// A rest day he adds (going out, or the readiness check moving the session) doesn't change the last completed
// session, so the same day type is next afterwards and nothing is made up twice. The rotation's own Rest comes after
// three training days in a row (Tue 10/20, his words: "3 then 1 rest"), whatever the day types were; the day type
// carries on where it left off. Day records live in the synced collection 'days', one per date: {date, rest,
// sessionTime, readiness}.
import { daysBetween, isoDate, hmOf } from './time.js';
import { activeBridge } from './history.js';

export const ROTATION = ['pull', 'push', 'legs'];
// Tue 11/10, his words: "Upper A upper B. One working set for two weeks starting today... do not remove push-pull legs":
// a block of other day types for a set span (synced doc schedule/block: {from, to, order, then, workingSets}), run
// Upper, Lower, rest, alternating the uppers. Pull, Push and Legs stay as they are and come back after it, from `then`.
// Tue 11/10, his words: "you should be able to build the routines and everything... form splits, workouts, modify":
// the coach builds any split (split_plan). A v2 block carries its own day types {id: {label, covers, neck}} and its
// cycle with 'rest' entries ("upper-a", "lower", "rest", ...); `to` null = until he ends it. Day types once defined stay
// known (their sessions keep moving the rotation after the split changes); the first block's three are built in.
export const BLOCK_TYPES = ['upper-a', 'upper-b', 'lower'];
const BUILT_IN = { 'upper-a': { label: 'Upper A', covers: ['pull', 'push'] }, 'upper-b': { label: 'Upper B', covers: ['pull', 'push'] }, lower: { label: 'Lower', covers: ['legs'] } };
const BASE_LABEL = { pull: 'Pull', push: 'Push', legs: 'Legs', neck: 'Neck' };
export const LABEL = { ...BASE_LABEL, 'upper-a': 'Upper A', 'upper-b': 'Upper B', lower: 'Lower' };

/** The block in its full form: its day types (built-in ones included) and its cycle with rest days. A block from before
 *  v2 (no 'rest' in order) rests after every Lower, as the first Upper/Lower block did. Null when it isn't a block. */
export function normBlock(b) {
  if (!b?.from || !Array.isArray(b.order) || !b.order.some((t) => t !== 'rest')) return null;
  if (b.norm) return b;
  const types = { ...BUILT_IN, ...(b.types || {}) };
  const order = b.v >= 2 || b.order.includes('rest') ? b.order : b.order.flatMap((t) => (t === 'lower' ? [t, 'rest'] : [t]));
  return { ...b, to: b.to || null, types, order, norm: true };
}

let current = null;
/** The block in use when a caller doesn't pass one (the app and the Mac set it from schedule/block as it syncs). */
export function useBlock(block) {
  current = normBlock(block);
  for (const k of Object.keys(LABEL)) if (!BASE_LABEL[k] && !BUILT_IN[k]) delete LABEL[k];
  for (const [id, t] of Object.entries(current?.types || {})) if (!BASE_LABEL[id] && t?.label) LABEL[id] = t.label;
  return current;
}
export const currentBlock = () => current;
const typesOf = (block) => normBlock(block)?.types || current?.types || BUILT_IN;
export const isBlockType = (t, block = current) => !!t && !BASE_LABEL[t] && !!typesOf(block)[t];
export const inRotation = (t, block = current) => ROTATION.includes(t) || isBlockType(t, block);
/** What a day type holds of Pull, Push and Legs: its holds, neck place and check-in areas follow those days. */
export const coversOf = (t, block = current) => (ROTATION.includes(t) ? [t] : (isBlockType(t, block) && typesOf(block)[t].covers) || []);
/** A day type's own neck plan: true = neck after it, false = never after it, null = by what it covers. */
export const neckOf = (t, block = current) => (isBlockType(t, block) ? typesOf(block)[t].neck ?? null : null);
export const labelOf = (t, block = current) => LABEL[t] || typesOf(block)[t]?.label || t;

/** The cycle in words: "Upper A, Lower, rest, Upper B, Lower, rest". */
export const cycleText = (block) => (normBlock(block)?.order || []).map((t) => (t === 'rest' ? 'rest' : labelOf(t, block))).join(', ');

/** One line for Train: "Upper/Lower until Monday 11/23: Upper, Lower, rest. 1 working set per exercise." */
export function blockLine(block) {
  const b = normBlock(block);
  if (!b) return '';
  const d = b.to ? new Date(`${b.to}T12:00:00Z`) : null;
  const end = d ? `until ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}` : 'until you end it';
  const sets = b.workingSets ? ` ${b.workingSets} working set${b.workingSets > 1 ? 's' : ''} per exercise.` : '';
  const cyc = b.v >= 2 ? cycleText(b) : 'Upper, Lower, rest';
  return `${b.name || 'Upper/Lower'} ${end}: ${cyc}.${sets} Pull, Push and Legs come back after it.`;
}

/** The block when `date` falls inside it, else null. */
export const activeBlock = (block, date) => { const b = normBlock(block); return b && date >= b.from && (!b.to || date <= b.to) ? b : null; };

/**
 * Where `last` sits in the block's cycle (an index into order), or -1. His block sessions newest first (last.recent)
 * are matched against the cycle backwards, so a type that comes twice (Lower after Upper A and after Upper B) is told
 * apart; a tie goes to the place the count of block sessions points at.
 */
function cyclePos(b, last) {
  if (!last || last.date < b.from) return -1;
  const recent = last.recent?.length ? last.recent : [last, ...(last.lastUpper && last.lastUpper !== last.dayType ? [{ dayType: last.lastUpper, date: last.date }] : [])];
  const seq = recent.filter((x) => x.date >= b.from && x.dayType).map((x) => x.dayType);
  if (seq[0] !== last.dayType) return -1;
  const train = b.order.map((t, i) => (t === 'rest' ? -1 : i)).filter((i) => i >= 0);
  const L = train.length;
  const want = train[(seq.length - 1) % L];
  let best = -1; let score = -1;
  for (let p = 0; p < L; p++) {
    if (b.order[train[p]] !== seq[0]) continue;
    let sc = 0;
    for (let k = 1; k < Math.min(seq.length, L); k++) { if (b.order[train[(p - k + L * k) % L]] === seq[k]) sc++; else break; }
    if (sc > score || (sc === score && train[p] === want)) { best = train[p]; score = sc; }
  }
  return best;
}
const firstOf = (b) => b.order.find((t) => t !== 'rest');
function nextInCycle(b, pos) {
  for (let i = 1; i <= b.order.length; i++) { const t = b.order[(pos + i) % b.order.length]; if (t !== 'rest') return t; }
  return firstOf(b);
}

/** Next day type after the last completed one (rest days are not sessions). */
export function nextDayType(lastDayType) {
  const i = ROTATION.indexOf(lastDayType);
  return i < 0 ? 'pull' : ROTATION[(i + 1) % ROTATION.length];
}

/** ISO date n days after iso. */
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Last completed rotation session: finished workouts (Training HQ and imported) with a Pull, Push or Legs day type
 * (or a block's Upper A, Upper B, Lower), else the Hevy bridge. Neck and untyped sessions don't move the rotation.
 * @returns {{dayType:string, date:string, sessionId:string|null, streak:number, lastUpper:string|null}|null}  streak:
 *   training days in a row up to and including that day; lastUpper: the newest Upper A or Upper B
 */
export function lastRotationSession(sessions, rawBridge = null, tz) {
  const mine = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds' && inRotation(s.dayType)).sort((a, b) => b.startedAt - a.startedAt);
  const own = mine[0];
  const bridge = activeBridge(rawBridge, sessions)?.lastSessions?.find((s) => inRotation(s.dayType));
  const ownIso = own ? isoDate(new Date(own.startedAt), tz) : null;
  if (own && (!bridge || ownIso >= bridge.date)) {
    const dates = new Set(mine.map((s) => isoDate(new Date(s.startedAt), tz)));
    let streak = 1;
    while (dates.has(addDays(ownIso, -streak))) streak++;
    const lastUpper = mine.find((x) => /^upper-/.test(x.dayType))?.dayType;
    // His sessions newest first, while a split is in use or was: where the last one sits in its cycle.
    const recent = current || mine.some((x) => isBlockType(x.dayType)) ? { recent: mine.slice(0, 12).map((x) => ({ dayType: x.dayType, date: isoDate(new Date(x.startedAt), tz) })) } : {};
    return { dayType: own.dayType, date: ownIso, sessionId: own.id, streak, ...recent, ...(lastUpper ? { lastUpper } : {}) };
  }
  return bridge ? { dayType: bridge.dayType, date: bridge.date, sessionId: null, streak: 1 } : null;
}

/** Rest days after `last`: in a block, the 'rest' entries after its place in the cycle; else one after three training
 *  days in a row (3 on, 1 off). */
export function restDaysAfter(last, block = current) {
  if (!last) return 0;
  const b = activeBlock(block, last.date);
  const pos = b ? cyclePos(b, last) : -1;
  if (pos >= 0) {
    let n = 0;
    while (n < b.order.length - 1 && b.order[(pos + 1 + n) % b.order.length] === 'rest') n++;
    // Tue 11/10, his words: "two weeks... upper lower. And then I'm going to switch back to push-pull legs": a cycle
    // rest that would fall after the block's last day doesn't happen; Pull, Push and Legs start the day after it
    // (Lower on Monday 11/23, Pull on Tuesday 11/24), unless he keeps the block (its `to` moves on).
    // Past the end, the rotation's own rule (three days on, one off) decides.
    if (b.to && n > daysBetween(last.date, b.to)) return Math.max(daysBetween(last.date, b.to), (last.streak || 1) >= 3 ? 1 : 0);
    return n;
  }
  if (isBlockType(last.dayType, block)) return last.dayType === 'lower' ? 1 : 0;
  return (last.streak || 1) >= 3 ? 1 : 0;
}
export const restAfter = (last, block = current) => restDaysAfter(last, block) > 0;

/**
 * The day type after `last` for a session on `date`. Inside a block: its first type until a block session is done,
 * then the next in its cycle (the uppers alternate in Upper/Lower). Outside one (or after it): Pull, Push, Legs,
 * carrying on from the block's `then` (the PPL day that was next when it started) after a block session.
 */
export function nextTypeOn(last, date, block = current) {
  const b = activeBlock(block, date);
  const t = last?.dayType;
  if (b) {
    const pos = cyclePos(b, last);
    return pos < 0 ? firstOf(b) : nextInCycle(b, pos);
  }
  if (isBlockType(t, block)) return ROTATION.includes(block?.then) ? block.then : 'pull';
  return nextDayType(t);
}

/** In the block, a day type that comes after a rest day in its cycle (so its session was the first after a rest). */
export const followsRest = (t, block = current) => {
  const b = normBlock(block);
  return !!b && b.order.some((x, i) => x === t && b.order[(i - 1 + b.order.length) % b.order.length] === 'rest');
};

const restOf = (days, date) => days?.[date]?.rest || null;

/** First date from `from` on that isn't marked as a rest day. */
function firstTrainingDate(days, from) {
  let d = from;
  for (let i = 0; i < 60 && restOf(days, d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Today in the rotation.
 * @param {object} o
 * @param {{dayType:string, date:string}|null} o.last  last completed rotation session
 * @param {string} o.today   YYYY-MM-DD
 * @param {object} [o.days]  day records by date ({rest: {reason, at}}; reason 'added', 'moved' or 'rest-holds')
 * @returns {{today: {kind:'train'|'rest'|'done', dayType:string|null, reason:string|null},
 *   next: {dayType:string, date:string}, last: object|null}}
 *   kind 'rest' reasons: 'rotation' (the day after Legs), or the day record's reason.
 */
export function rotationDay({ last, today, days = {}, block = current }) {
  const r = rotationDayOf({ last, today, days, block });
  const c = chosenNext(days, last, r.next.date, block);
  if (!c || c.dayType === r.next.dayType) return r;
  return { ...r, today: r.today.kind === 'train' ? { ...r.today, dayType: c.dayType } : r.today, next: { ...r.next, dayType: c.dayType, chosen: c.date } };
}

/**
 * Thu 11/5: the day type he chose for his next session ("Legs next, not Pull"), kept on a day record as
 * days[date].nextType = {dayType, at, by}. It holds from that date (the next training day when he said it) until a
 * rotation session is done on or after it, rest days in between included; then the rotation carries on from that
 * session as always. The newest such choice up to `upTo` wins. {date, dayType} or null.
 */
export function chosenNext(days, last, upTo, block = current) {
  let best = null;
  for (const [date, doc] of Object.entries(days || {})) {
    const t = doc?.nextType?.dayType;
    if (!inRotation(t, block) || date > upTo || (last && date <= last.date)) continue;
    if (!best || date > best.date) best = { date, dayType: t };
  }
  return best;
}

/** Day record with his chosen next day type (or with it taken away again: dayType null). */
export function withNextType(doc, date, dayType, { at = Date.now(), by = 'app', said = '' } = {}) {
  const base = doc || { date };
  if (!dayType) {
    const { nextType, ...rest } = base;
    return { ...rest, date };
  }
  return { ...base, date, nextType: { dayType, at, by, ...(said ? { said: String(said).slice(0, 200) } : {}) } };
}

function rotationDayOf({ last, today, days = {}, block = null }) {
  const at = (date) => ({ dayType: nextTypeOn(last, date, block), date });
  // In a block, today says so (Upper A, Lower... and its rest days): rest-day holds are asked even before an upper day.
  const inBlock = activeBlock(block, today) ? { block: true } : {};
  if (last && last.date === today) {
    // Trained today. After three days in a row (in a block: after Lower) the next day is the rotation's Rest.
    const from = addDays(today, 1 + restDaysAfter(last, block));
    return { today: { kind: 'done', dayType: last.dayType, reason: null, ...inBlock }, next: at(firstTrainingDate(days, from)), last };
  }
  const marked = restOf(days, today);
  if (marked) {
    return { today: { kind: 'rest', dayType: null, reason: marked.reason || 'added', ...inBlock }, next: at(firstTrainingDate(days, addDays(today, 1))), last };
  }
  const gap = last ? daysBetween(last.date, today) : 0;
  if (gap >= 1 && gap <= restDaysAfter(last, block)) {
    return { today: { kind: 'rest', dayType: null, reason: 'rotation', ...inBlock }, next: at(firstTrainingDate(days, addDays(today, 1))), last };
  }
  const n = at(today);
  return { today: { kind: 'train', dayType: n.dayType, reason: null, ...inBlock }, next: n, last };
}

/**
 * On a rest day, the next session's day type when that session is tomorrow, else null (Sat 10/24: a weekly gym hold
 * isn't asked on a rest day before a training day; he's at the gym tomorrow and it goes after that session).
 */
export const sessionTomorrow = (rot, date) => (rot?.today?.kind === 'rest' && !rot.today.block && rot.next?.date === addDays(date, 1) ? rot.next.dayType : null);

/**
 * On a training day, yesterday's date when yesterday was a rest day (so today's session was its next one), else null:
 * the weekly gym hold not asked then comes after today's session (holdSlots carriedFrom). Once today's session is done
 * the rotation's own rest is read from the type (the day after a rest is the first of the rotation).
 */
export const afterRestDay = (rot, date, days = {}) => {
  const k = rot?.today?.kind;
  const y = addDays(date, -1);
  const rest = k === 'train' ? !!rot.last && rot.last.date < y && rotationDay({ last: rot.last, today: y, days }).today.kind === 'rest'
    : k === 'done' && (rot.last?.streak || 1) === 1 && (!!restOf(days, y) || rot.last.dayType === nextDayType('legs') || followsRest(rot.last.dayType));
  return rest ? y : null;
};

/** Day record with an added rest day (or with it taken away again). */
export function withRest(doc, date, reason, at = Date.now()) {
  const base = doc || { date };
  if (!reason) {
    const { rest, ...restOfDoc } = base;
    return { ...restOfDoc, date };
  }
  return { ...base, date, rest: { reason, at } };
}

/** Plain words for a rest day's reason. */
export const REST_TEXT = {
  rotation: 'Rest day in the rotation (three days on, one off; in a split, its rest days)',
  added: 'Rest day you added',
  moved: 'Session moved to tomorrow (check-in)',
  'rest-holds': 'Rest and tendon holds (check-in)',
};

/** Day records as a map by date, from the 'days' collection list. */
export const daysByDate = (list) => Object.fromEntries((list || []).filter((d) => d?.date).map((d) => [d.date, d]));

/** Day record with a session time ("HH:MM", 24-hour) set, or cleared with null. */
export function withTime(doc, date, hm, at = Date.now()) {
  const base = doc || { date };
  if (!hm) {
    const { sessionTime, timeSetAt, ...rest } = base;
    return { ...rest, date };
  }
  return { ...base, date, sessionTime: hm, timeSetAt: at };
}

/**
 * The usual start time: the middle one of the last 10 rotation sessions' start times (local clock), "HH:MM", or
 * null. Used to prefill the time picker; he always sets the time himself (decision 15).
 */
export function usualStart(sessions, tz, n = 10) {
  const hms = sessions.filter((s) => s.status === 'done' && s.kind !== 'holds' && inRotation(s.dayType) && s.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt).slice(0, n).map((s) => hmOf(new Date(s.startedAt), tz)).sort();
  if (!hms.length) return null;
  const mid = hms[Math.floor((hms.length - 1) / 2)];
  // Round to 5 minutes.
  const [h, m] = mid.split(':').map(Number);
  const r = Math.round((h * 60 + m) / 5) * 5 % 1440;
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}
