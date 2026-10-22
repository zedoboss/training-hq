// The coach works the app for him (Tue 10/20, his words: "give it some tools like that so it can navigate through the
// app itself... If I say 'Open the chat', it should open. If I say 'Go start a new workout push', I want it to be
// able to modify and use the app itself"; "make sure he has all of the tools needed so he can do everything inside the
// app"). Opening any screen, finishing, discarding, pausing or resuming the workout in progress, the app's settings,
// and the phone itself (microphone off, newest version, sync). The data tools (sets, meals, supplements, scans, sauna,
// check-in, reminders, notes) are in tools-write.mjs; together they cover what his screens do.
import { snapshot, findByName, wrote, refuse, plural } from './shared.mjs';
import { activeText, currentExercise } from './tools-read.mjs';
import { SCREENS, SCREEN_IDS, screenById } from '../../app/js/lib/screens.js';
import { summarize, elapsedMs } from '../../app/js/lib/session.js';
import { REST_CHOICES, SOUNDS } from '../../app/js/lib/settings.js';
import { LABEL } from '../../app/js/lib/rotation.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const OFFER_MS = 30 * 60 * 1000;

/** His words in this turn. */
export function saidNow(s, ctx) {
  return s.list('coach-messages').find((m) => m.turnId === ctx.turnId && m.role === 'user')?.text || '';
}

// He tells the coach to do it ("start Push", "go start a new workout", "Jarvis, finish the session", "let's start
// legs"), as opposed to talking about it ("about to start squats", "when I finish this"). The verb opens a clause or
// follows a word that makes it a request.
const LEAD = String.raw`(?:^|[.!?,;:]\s*|\b(?:jarvis|coach|ai|please|go|ok|okay|alright|yo|now|so|then|and|can you|could you|would you|will you|let's|lets|let us)\s+)(?:go\s+(?:and\s+)?|just\s+|please\s+)?`;
const START = new RegExp(`${LEAD}(?:start|begin|launch|kick off|fire up|open up|load up)\\b[^.?!]{0,40}?\\b(?:workout|session|push|pull|legs?|leg day|training|routine|neck|empty)\\b`, 'i');
const FINISH = new RegExp(`${LEAD}(?:finish|end|save|close|wrap up|complete|stop)\\b[^.?!]{0,30}?\\b(?:workout|session|training)\\b`, 'i');
/** He told the coach to start a workout now, not just talked about training. */
export const toldToStart = (text) => START.test(String(text || ''));
/** He told the coach to finish the workout. */
export const toldToFinish = (text) => FINISH.test(String(text || ''));

/** The coach's last reply (within 30 minutes) asked about exactly this. */
export function offered(s, ctx, tool, key) {
  const before = s.list('coach-messages').filter((m) => m.turnId !== ctx.turnId && m.role !== 'marker').sort((x, y) => x.at - y.at);
  const last = before.at(-1);
  if (!ctx.turnId || last?.role !== 'assistant' || s.now - last.at > OFFER_MS) return false;
  return (last.tools || []).some((t) => t.name === tool && t.summary === `asked first: ${key}`);
}

const YES = /^\s*(yes|yeah|yep|yup|ya|sure|ok|okay|do it|go|go ahead|confirm|confirmed|correct|right|y)\b/i;
/**
 * He answered yes to a question the coach asked in its own words (Tue 10/20 on his phone: "Discard this workout" ->
 * the coach asked "Yes or no?" without the tool -> "Yes" was refused and he had to say it twice). Counts when his
 * message now is a yes, the coach's reply before it (within 30 minutes) asked a question, and his message before
 * that told it to do this (`told`).
 */
export function confirmedNow(s, ctx, told, { question = /\?/ } = {}) {
  if (!ctx.turnId || !YES.test(saidNow(s, ctx))) return false;
  const before = s.list('coach-messages').filter((m) => m.turnId !== ctx.turnId && m.role !== 'marker').sort((x, y) => x.at - y.at);
  const reply = before.at(-1); const asked = before.at(-2);
  return reply?.role === 'assistant' && s.now - reply.at <= OFFER_MS && /\?/.test(reply.text || '') && question.test(reply.text || '') && asked?.role === 'user' && told(asked.text || '');
}
const DISCARD = new RegExp(`${LEAD}(?:discard|delete|scrap|cancel|bin|throw away|get rid of|trash)\\b[^.?!]{0,30}?\\b(?:workout|session|training|it|this|that)\\b`, 'i');
/** He told the coach to discard the workout. */
export const toldToDiscard = (text) => DISCARD.test(String(text || ''));

// ---- open a screen ---------------------------------------------------------------------------------------------

async function openScreen(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const sc = screenById(a.screen);
  if (!sc) return refuse(`No screen called "${a.screen}". Screens: ${SCREEN_IDS.join(', ')}.`);
  let url = sc.hash; let what = sc.label;
  if (sc.needs === 'session') {
    const active = s.active();
    if (!active) return refuse('No workout in progress. Start one with start_session (ask him first unless he told you to start it).');
    url = `${sc.hash}${active.id}`; what = `${sc.label}: ${active.title}`;
    const cur = sc.id === 'session' ? currentExercise(active, s.setsOf(active.id)) : null;
    if (cur) ctx.action({ kind: 'focus', sessionId: active.id, exKey: cur.key });
  } else if (sc.needs === 'exercise' || sc.needs === 'routine' || sc.needs === 'supplement') {
    if (!a.name) return refuse(`Which ${sc.needs}?`);
    const items = sc.needs === 'exercise' ? [...s.lib().values()] : sc.needs === 'routine' ? s.list('routines') : s.list('supplements').filter((x) => !x.removedAt);
    const nameOf = sc.needs === 'routine' ? (r) => r.title : (x) => x.name;
    const { item, ambiguous } = findByName(items, a.name, nameOf, sc.needs === 'routine' ? (r) => [r.dayType, LABEL[r.dayType]] : () => []);
    if (!item) return refuse(ambiguous.length ? `Which one: ${ambiguous.join('; ')}?` : `No ${sc.needs} called "${a.name}".`);
    url = `${sc.hash}${item.id}`; what = `${sc.label}: ${nameOf(item)}`;
  } else if (sc.needs === 'meal') {
    // A meal by its id, or "latest" / nothing: his latest meal.
    const meals = s.list('meals').filter((m) => m?.id && m.at).sort((a, b) => b.at - a.at);
    const m = (a.name && meals.find((x) => x.id === a.name)) || meals[0];
    if (!m) return refuse('No meals logged yet.');
    url = `${sc.hash}${m.id}`; what = `${sc.label.replace(/ \(.*$/, '')}: ${m.name || 'meal'}`;
  } else if (sc.needs === 'date') {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : s.today;
    url = `${sc.hash}${d}`; what = `${sc.label} (${d})`;
  }
  ctx.action({ kind: 'go', url, label: what });
  return { text: `Opened on his phone: ${what}.`, summary: `open ${a.screen}` };
}

// ---- the workout in progress -----------------------------------------------------------------------------------

async function workout(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  const active = s.active();
  if (!active) return refuse('No workout in progress.');
  const sets = s.setsOf(active.id);
  const ticked = sets.filter((x) => x.done);
  const save = (data, extra = []) => s.store.writeLocalMany([...extra, { col: 'sessions', id: active.id, data }]);

  if (a.action === 'pause' || a.action === 'resume') {
    if (a.action === 'pause' && active.pausedAt) return refuse('The clock is already paused.');
    if (a.action === 'resume' && !active.pausedAt) return refuse('The clock is running.');
    save(a.action === 'pause' ? { ...active, pausedAt: s.now } : { ...active, pausedMs: (active.pausedMs || 0) + (s.now - active.pausedAt), pausedAt: null });
    return wrote(`${active.title}: clock ${a.action === 'pause' ? 'paused' : 'running again'}.`, `clock ${a.action}d`);
  }

  if (a.action === 'finish') {
    // Unticked sets are dropped when a workout is saved (as on the phone's Finish screen): ask, unless he told you to.
    const key = `finish:${active.id}`;
    if (!toldToFinish(saidNow(s, ctx)) && !offered(s, ctx, 'workout', key) && !confirmedNow(s, ctx, toldToFinish)) {
      return { text: `Not finished. Ask him first, in a few words: "Finish ${active.title} now? ${ticked.length} of ${sets.length} sets ticked${sets.length > ticked.length ? '; the unticked ones are dropped' : ''}." Only a yes in his next message finishes it: then call workout finish again.`, summary: `asked first: ${key}` };
    }
    const pausedMs = (active.pausedMs || 0) + (active.pausedAt ? s.now - active.pausedAt : 0);
    const done = { ...active, title: String(a.title || '').trim().slice(0, 60) || active.title, note: a.note != null ? String(a.note) : active.note,
      pausedMs, pausedAt: null, endedAt: s.now, status: 'done' };
    save(done, sets.filter((x) => !x.done).map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })));
    ctx.action({ kind: 'rest-skip' });
    ctx.action({ kind: 'go', url: `#/finish/${active.id}`, label: 'The workout summary' });
    const sum = summarize(done, ticked);
    const min = Math.round(elapsedMs(done, s.now) / 60000);
    return wrote(`Saved ${done.title}: ${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}, ${plural(ticked.length, 'set')}, ${sum.volume.toLocaleString('en-US')} kg volume${sets.length > ticked.length ? `; ${plural(sets.length - ticked.length, 'unticked set')} dropped` : ''}. The summary (records, what's next) is open on his phone.`, `${done.title} saved`);
  }

  if (a.action === 'discard') {
    // Deletes every set logged in it: always his yes to this exact question first.
    const key = `discard:${active.id}`;
    if (!offered(s, ctx, 'workout', key) && !confirmedNow(s, ctx, toldToDiscard)) {
      return { text: `Not discarded. Ask him first: "Discard ${active.title}? ${plural(ticked.length, 'logged set')} will be deleted." Only a yes in his next message discards it: then call workout discard again.`, summary: `asked first: ${key}` };
    }
    save({ ...active, status: 'discarded', endedAt: s.now }, sets.map((x) => ({ col: 'sets', id: x.id, data: null, deleted: true })));
    ctx.action({ kind: 'rest-skip' });
    ctx.action({ kind: 'go', url: '#/train', label: 'Train' });
    return wrote(`Discarded ${active.title} and its ${plural(sets.length, 'set')}.`, `${active.title} discarded`);
  }

  if (a.action === 'status') return { text: activeText(s, active), summary: 'status' };
  return refuse('Which: finish, discard, pause, resume or status?');
}

// ---- settings ----------------------------------------------------------------------------------------------------

const MOODS = ['commander', 'hype', 'dark', 'warrior', 'rival'];
const KINDS = ['readiness', 'session', 'holds', 'supps', 'meals', 'sauna', 'scan', 'recovery', 'coach', 'neck', 'evening', 'dishes'];
/** What the coach may change, as on the Settings screen: [path, kind, choices or [min, max], what it is]. */
export const SETTINGS = [
  ['coach.model', 'enum', ['fast', 'deep'], 'Coach model: fast = Sonnet 5.5 medium, deep = Opus 5.5 high (also one tap on Today)'],
  ['coach.intensity', 'int', [1, 5], 'How hard the coach pushes, 1 plain to 5 everything'],
  ...MOODS.map((m) => [`coach.moods.${m}`, 'bool', null, `Mood ${m} on or off`]),
  ['coach.talk.during', 'bool', null, 'The coach talks during sets and holds'],
  ['coach.talk.every', 'enum', ['often', 'steady', 'once'], 'How often it talks during a set or hold'],
  ['coach.squatCalls', 'bool', null, 'Rep calls on squat-camera sets'],
  ['voice.speak', 'bool', null, 'The coach answers out loud'],
  ['voice.readout', 'bool', null, 'The small readout when speech was ignored (NOT YOU, NOISE)'],
  ['voice.strictness', 'enum', ['strict', 'normal', 'relaxed'], 'How sure the voice lock must be that it is him'],
  ['rest.mainS', 'enum', REST_CHOICES, 'Default rest after main lifts, seconds'],
  ['rest.lightS', 'enum', REST_CHOICES, 'Default rest after light exercises, seconds'],
  ['rest.holdS', 'enum', REST_CHOICES, 'Default rest after holds, seconds'],
  ['rest.warmupS', 'enum', REST_CHOICES, 'Rest after a warm-up set, every exercise, seconds'],
  ['sounds.restEnd', 'enum', SOUNDS.map((x) => x.id), 'Sound when a rest ends'],
  ['sounds.timerVolume', 'int', [0, 100], 'Timer volume %'],
  ['sounds.tickVolume', 'int', [0, 100], 'Tick volume %'],
  ['sounds.recordVolume', 'int', [0, 100], 'Record sound volume %'],
  ['units.weight', 'enum', ['kg', 'lb'], 'Weight unit'],
  ['units.distance', 'enum', ['km', 'mi'], 'Distance unit'],
  ['units.body', 'enum', ['cm', 'in'], 'Body measurement unit'],
  ['firstDayOfWeek', 'enum', [1, 0, 6], 'First day of the week: 1 Monday, 0 Sunday, 6 Saturday'],
  ['keepAwake', 'bool', null, 'Screen stays on during a workout'],
  ['previousFrom', 'enum', ['any', 'same-routine'], 'The "previous" column comes from any session or the same routine'],
  ...['plateCalc', 'rpe', 'supersetJump', 'inlineTimer', 'recordBanner'].map((k) => [`show.${k}`, 'bool', null, `Show ${k} on the workout screen`]),
  ['gym.name', 'text', [0, 60], 'His gym'],
  ['body.stepGoal', 'int', [1000, 50000], 'Daily step goal'],
  ['body.scanModel', 'enum', ['fast', 'deep'], 'Which Claude reads body scan photos'],
  ['fuel.visionModel', 'enum', ['fast', 'deep'], 'Which Claude reads meal photos'],
  ['holds.getReadyS', 'int', [0, 60], 'GET READY seconds before a hold'],
  ['notify.readinessMin', 'int', [0, 180], 'Check-in reminder, minutes before the session time'],
  ['notify.holdsMorning', 'hm', null, 'Morning holds reminder time'],
  ['notify.holdsEvening', 'hm', null, 'Evening holds reminder time'],
  ['notify.eveningCheck', 'hm', null, 'Evening round-up time'],
  ['notify.scanEvening', 'hm', null, 'Body scan evening reminder time'],
  ['notify.recoveryHm', 'hm', null, 'Recovery reminder time'],
  ...KINDS.map((k) => [`notify.kinds.${k}`, 'bool', null, `Notifications for ${k}`]),
];
/** Say the models as he knows them (Tue 10/20: the coach said "deep"). */
const MODEL_WORDS = { fast: 'Sonnet 5.5 (medium)', deep: 'Opus 5.5 (high)' };
const SETTING = new Map(SETTINGS.map(([path, kind, choices, label]) => [path, { path, kind, choices, label }]));

/** His value as the setting needs it, or an error text. */
export function parseSetting(def, raw) {
  const v = String(raw ?? '').trim();
  if (def.kind === 'bool') {
    if (/^(true|on|yes|1|enable|enabled)$/i.test(v)) return { value: true };
    if (/^(false|off|no|0|disable|disabled)$/i.test(v)) return { value: false };
    return { error: 'on or off' };
  }
  if (def.kind === 'int') {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < def.choices[0] || n > def.choices[1]) return { error: `a number from ${def.choices[0]} to ${def.choices[1]}` };
    return { value: n };
  }
  if (def.kind === 'enum') {
    const hit = def.choices.find((c) => String(c).toLowerCase() === v.toLowerCase());
    return hit === undefined ? { error: `one of ${def.choices.join(', ')}` } : { value: hit };
  }
  if (def.kind === 'hm') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: '24-hour HH:MM' };
    return { value: `${m[1].padStart(2, '0')}:${m[2]}` };
  }
  if (def.kind === 'text') return v.length > def.choices[1] ? { error: `at most ${def.choices[1]} characters` } : { value: v };
  return { error: 'not changeable' };
}

const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, path, value) {
  const keys = path.split('.'); const out = structuredClone(o || {});
  let cur = out;
  for (const k of keys.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[keys.at(-1)] = value;
  return out;
}

async function appSettings(a, ctx) {
  const s = snapshot(ctx.store, { tz: ctx.tz, now: ctx.now() });
  if (!a.setting) return { text: `Settings he can change through you (path: now): ${SETTINGS.map(([p, , , l]) => `${p} = ${JSON.stringify(getPath(s.settings(), p))} (${l})`).join('; ')}. Nudges and waking hours: the nudges tool.`, summary: 'listed settings' };
  const def = SETTING.get(a.setting);
  if (!def) return refuse(`No setting "${a.setting}". Call app_settings without a setting to see the list.`);
  const p = parseSetting(def, a.value);
  if (p.error) return refuse(`${def.label}: give ${p.error}.`);
  const before = getPath(s.settings(), def.path);
  const say = (v) => (/model$|Model$/.test(def.path) ? MODEL_WORDS[v] || v : JSON.stringify(v));
  const name = def.label.replace(/\s*[(:].*$/, '');
  if (before === p.value) return { text: `${name} is already ${say(p.value)}.`, summary: 'no change' };
  s.store.writeLocal('settings', 'main', { ...setPath(s.one('settings', 'main') || {}, def.path, p.value), id: 'main' });
  return wrote(`${name}: ${say(before)} to ${say(p.value)}. His phone has it on the next sync (seconds).`, `${def.path} = ${JSON.stringify(p.value)}`);
}

// ---- the phone itself --------------------------------------------------------------------------------------------

async function phone(a, ctx) {
  if (a.action === 'mic_off') { ctx.action({ kind: 'mic-off' }); return { text: 'The microphone goes off on his phone after your answer. Only he can switch it back on (a tap on the mic chip).', summary: 'mic off' }; }
  if (a.action === 'reload') { ctx.action({ kind: 'reload' }); return { text: 'His phone loads the newest version of the app after your answer (a few seconds; the screen reloads).', summary: 'reload' }; }
  if (a.action === 'sync') { ctx.action({ kind: 'sync' }); return { text: 'His phone syncs with the Mac now.', summary: 'sync' }; }
  return refuse('Which: mic_off, reload or sync?');
}

const tool = (name, title, description, inputSchema, run) => ({ name, title, description, inputSchema, run });

export const APP_TOOLS = [
  tool('open_screen', 'Open a screen', `Open a screen of the app on his phone, at once, when he asks to open, show or go to something ("open the chat", "show me my supplements", "go to the session"). Screens: ${SCREENS.map((x) => `${x.id} (${x.label}${x.needs ? `; needs ${x.needs === 'session' ? 'a workout in progress' : x.needs === 'date' ? 'date, default today' : x.needs === 'meal' ? 'name: a meal id, or none for his latest meal' : `name of the ${x.needs}`}` : ''})`).join(', ')}.`,
    obj({ screen: { type: 'string', enum: SCREEN_IDS }, name: { type: 'string' }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['screen']), openScreen),
  tool('workout', 'The workout in progress', 'The workout in progress: status; pause or resume its clock; finish it (saved like the phone\'s Finish screen, unticked sets dropped; optional title and note; then its summary opens); discard it (deletes its sets). Finish needs his yes unless he told you to finish it; discard always needs his yes to your question.',
    obj({ action: { type: 'string', enum: ['status', 'pause', 'resume', 'finish', 'discard'] }, title: { type: 'string' }, note: { type: 'string' } }, ['action']), workout),
  tool('app_settings', 'App settings', 'Read or change his app settings (the Settings screen), only when he asks for the change. No setting: lists every setting with its current value. With setting (its path) and value: changes it.',
    obj({ setting: { type: 'string', enum: [...SETTING.keys()] }, value: { type: 'string' } }), appSettings),
  tool('phone', 'His phone', 'Things only his phone can do: mic_off (stop listening; only he can switch it back on), reload (load the newest version of the app), sync (sync with the Mac now). Only when he asks.',
    obj({ action: { type: 'string', enum: ['mic_off', 'reload', 'sync'] } }, ['action']), phone),
];
