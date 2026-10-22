import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkDue, withAsk, withAnswer, usualWalkHm, walkLines, planAt, stepsText, emptyWalk } from '../app/js/lib/walks.js';

const TZ = 'Asia/Bangkok';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, goal: 8000, wakeHm: '10:00', bedHm: '00:00' };
const steps = (n, hm) => ({ steps: n, asOf: at(hm) });

test('walks: ask, 5 minutes later ask for a time, then every 15 minutes until he answers', () => {
  let doc = null;
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '14:00'), ...o });
  assert.equal(due('10:30'), null, 'not in the first hour after he wakes');
  const a = due('14:30');
  assert.equal(a.kind, 'ask');
  assert.equal(a.text, 'Walk: 3,000 of 8,000 steps as of 2:00 PM: 5,000 to go, about 50 minutes of walking. Go out for a walk now. When are you going?');
  doc = withAsk(doc, D, 'ask', at('14:30'));
  assert.equal(due('14:34'), null);
  assert.deepEqual(due('14:35'), { kind: 'follow', text: 'No answer on the walk. When are you going? Tell me a time and I leave you alone until then.' });
  doc = withAsk(doc, D, 'follow', at('14:35'));
  assert.equal(due('14:45'), null);
  assert.equal(due('14:50').kind, 'nag');
  assert.equal(due('14:50', { busy: true }), null, 'never during a workout or the sauna');
  assert.equal(due('23:30'), null, 'not in the last hour before bed');
});

test('walks: "I\'ll go in an hour": quiet until then, walk time, then the follow-ups; a walk, then back?', () => {
  let doc = withAsk(null, D, 'ask', at('14:30'));
  doc = withAnswer(doc, D, { action: 'plan', at: planAt({ inMinutes: 60, now: at('14:32'), tz: TZ }), said: "I'll go in an hour" }, at('14:32'));
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '14:00'), ...o });
  assert.equal(due('14:40'), null);
  assert.equal(due('15:31'), null, 'quiet until the time he said');
  const p = due('15:32');
  assert.equal(p.kind, 'plan');
  assert.match(p.text, /^Walk time: you said "I'll go in an hour"\. Go now\./);
  doc = withAsk(doc, D, 'plan', at('15:32'));
  assert.equal(due('15:37').kind, 'plan-follow');
  doc = withAnswer(doc, D, { action: 'going' }, at('15:38'));
  assert.equal(due('16:10'), null, 'out walking');
  assert.deepEqual(due('16:18'), { kind: 'back', text: 'Back from the walk? How many minutes did you go?' });
  doc = withAsk(doc, D, 'back', at('16:18'));
  doc = withAnswer(doc, D, { action: 'done', minutes: 35 }, at('16:20'));
  assert.equal(due('17:30'), null, 'a walk done: the step count catches up first');
  // Thu 10/22 audit: no "go for a walk" on a step count from before the walk; a newer one, or 3 hours on.
  assert.equal(due('17:51'), null, 'no step count since the walk yet');
  assert.equal(due('17:51', { steps: steps(6500, '17:45') }).kind, 'ask');
  assert.equal(due('19:21').kind, 'ask');
  assert.deepEqual(due('17:51', { steps: steps(8100, '17:45') }), { kind: 'goal', calm: true, text: "8,100 steps: today's 8,000 is done. Well done." });
  assert.equal(due('23:23', { steps: steps(8295, '23:20') }).text, "8,295 steps: today's 8,000 is done. Well done. Have a good night, catch you in the morning.", 'late: a good night, no cutoff');
  doc = withAsk(doc, D, 'goal', at('17:51'));
  assert.equal(due('19:00', { steps: steps(8400, '18:55') }), null, 'goal met: no more asks today');
});

test('walks: an answer with no time asks again after 30 minutes; "not now" waits an hour; stale steps say so', () => {
  let doc = withAsk(null, D, 'ask', at('14:30'));
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '14:00'), ...o });
  assert.equal(due('14:36', { lastUserAt: at('14:33') }), null, 'he replied: no follow-up');
  assert.equal(due('15:04', { lastUserAt: at('14:33') }).kind, 'ask');
  doc = withAnswer(doc, D, { action: 'skip', reason: 'raining' }, at('14:40'));
  assert.equal(due('15:20'), null);
  assert.equal(due('15:41').kind, 'ask');
  assert.equal(stepsText({ steps: steps(3000, '09:00'), goal: 8000, now: at('14:00'), tz: TZ }), 'No step count from your phone since 9:00 AM (opening the app sends it). Goal 8,000.');
});

test('walks: memory: his usual walk hour and the last days for the coach', () => {
  const docs = ['2026-03-14', '2026-03-15', '2026-03-16'].map((d, i) => ({ ...emptyWalk(d), walks: [{ at: at(i === 1 ? '18:10' : '17:20', d), minutes: 30 }] }));
  assert.equal(usualWalkHm(docs, { today: D, tz: TZ }), '17:00');
  const today = withAnswer(withAsk(null, D, 'ask', at('14:30')), D, { action: 'plan', at: at('17:00'), said: 'at 5' }, at('14:31'));
  const lines = walkLines([...docs, today], { today: D, now: at('15:00'), tz: TZ, steps: steps(3000, '14:00'), usualHm: '17:00' });
  assert.equal(lines[0], 'Walk today: 3,000 of 8,000 steps as of 2:00 PM: 5,000 to go, about 50 minutes of walking; he said he\'d go at 5:00 PM ("at 5"). He usually walks around 5:00 PM.');
  assert.match(lines[1], /^Walks, last days: 03-16: walked 5:20 PM 30 min; 03-15: walked 6:10 PM 30 min; 03-14: walked 5:20 PM 30 min\.$/);
});

test('walks and the weather (Wed 10/21): never "go now" in strong sun or heat; the coach plans it for the next safe hour', async () => {
  const { hourRisk, nextWalkTime, safeWindowsText } = await import('../app/js/lib/walks.js');
  const hour = (hm, uv, feels, rain = 10) => ({ at: at(hm), uv, feels, rain });
  const weather = { hours: [hour('12:00', 8.4, 38.6), hour('13:00', 8, 38.9), hour('14:00', 6.5, 39), hour('15:00', 5.1, 38), hour('16:00', 2.9, 33), hour('17:00', 1, 31, 53), hour('18:00', 0, 30.5, 75), hour('19:00', 0, 31.5, 65), hour('20:00', 0, 31.5), hour('21:00', 0, 32.1), hour('22:00', 0, 32), hour('23:00', 0, 31.9)] };
  assert.deepEqual(['12:00', '15:00', '16:00', '17:00'].map((h) => hourRisk(weather.hours.find((x) => x.at === at(h)))), ['never', 'never', 'safe', 'safe']);
  assert.equal(hourRisk({ uv: 4, feels: 34 }), 'caution');
  assert.equal(nextWalkTime(weather, at('12:30'), at('23:00')).at, at('16:00'));
  assert.equal(safeWindowsText(weather, at('12:30'), at('23:00'), TZ), '4:00 PM-11:00 PM (UV 2.9 at most, feels 31-33°C)');
  let doc = null;
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '12:00'), weather, ...o });
  const p = due('12:30');
  assert.equal(p.kind, 'planned');
  assert.equal(p.planAt, at('16:00'));
  assert.match(p.text, /^Walk: too hot or bright now \(UV 8\.4, feels 39°C\)\. I planned it for 4:00 PM, when it's UV 2\.9, feels 33°C\./);
  doc = withAnswer(withAsk(null, D, 'planned', at('12:30')), D, { action: 'plan', at: p.planAt, said: 'planned by the coach' }, at('12:30'));
  assert.equal(due('13:00'), null, 'quiet until then');
  assert.equal(due('16:00').kind, 'plan');
  assert.match(due('16:00').text, /Go now\./);
  // His own time lands in the heat: moved once to the next good hour.
  let mine = withAnswer(withAsk(null, D, 'ask', at('11:00')), D, { action: 'plan', at: at('13:00'), said: 'at 1' }, at('11:05'));
  const m = walkDue({ ...base, now: at('13:00'), doc: mine, steps: steps(3000, '12:00'), weather });
  assert.equal(m.kind, 'moved');
  assert.match(m.text, /^It's UV 8, feels 39°C now: not a walk to do\. I moved your walk to 4:00 PM/);
  // No weather known: as before.
  assert.equal(walkDue({ ...base, now: at('12:30'), doc: null, steps: steps(3000, '12:00') }).kind, 'ask');
});

test('walks and rain (Wed 10/21): raining now -> planned for the first safe hour under 50% rain; the coach sees it', async () => {
  const { rainingNow } = await import('../app/js/lib/walks.js');
  const hour = (hm, uv, feels, rain) => ({ at: at(hm), uv, feels, rain });
  const weather = { current: { at: at('17:30'), precip: 0.6, code: 80 }, hours: [hour('17:00', 1.1, 31, 53), hour('18:00', 0.1, 31, 63), hour('19:00', 0, 32, 65), hour('20:00', 0, 32, 55), hour('21:00', 0, 32, 39)] };
  assert.deepEqual(rainingNow(weather, at('17:40')), { words: 'forecast model: rain showers, 0.6 mm in the last hour', sure: false, source: 'model' });
  assert.equal(rainingNow({ current: { ...weather.current, precip: 0, code: 2 } }, at('17:40')), null);
  assert.equal(rainingNow(weather, at('20:00')), null, 'old conditions are not trusted');
  const p = walkDue({ ...base, now: at('17:40'), doc: null, steps: steps(356, '17:01'), weather });
  assert.equal(p.kind, 'planned');
  assert.equal(p.planAt, at('21:00'));
  assert.match(p.text, /^Walk: rain likely now \(forecast model: rain showers, 0\.6 mm in the last hour\), not confirmed\. I planned it for 9:00 PM, when it's UV 0, feels 32°C, rain 39%\..* Dry where you are\? Tell me and you go now\.$/);
});

test('rain is a forecast until confirmed (Thu 10/22: "drizzle, take an umbrella" while it was dry)', async () => {
  const { rainingNow, umbrellaWorth, rainChanceText } = await import('../app/js/lib/walks.js');
  const { metarObs } = await import('../server/weather.mjs');
  const hour = (hm, rain, mm) => ({ at: at(hm), uv: 0.5, feels: 31, rain, mm });
  // What the model said that afternoon: drizzle code 53, 0.2 mm, rain 47%, one model of four wet.
  const w = { current: { at: at('16:00'), precip: 0.2, code: 53 }, hours: [hour('16:00', 47, [0.1, 0, 0.7, 0]), hour('17:00', 54, [0.7, 0.4, 0.9, 0.5])] };
  assert.equal(rainingNow(w, at('16:08')), null, 'a drizzle code under 0.3 mm is not rain');
  assert.equal(umbrellaWorth(w, at('16:08')), false);
  assert.equal(rainChanceText(w.hours[0]), 'rain 47%, 1 of 4 models show rain (models split, leaning dry)');
  assert.equal(rainChanceText(w.hours[1]), 'rain 54%, 4 of 4 models show rain (models agree: rain)');
  // The airport station: a real observation; no rain there vetoes a model-only shower.
  const dry = metarObs({ icaoId: 'XXXX', obsTime: at('16:00') / 1000, clouds: [{ cover: 'FEW' }, { cover: 'SCT' }] }, 20);
  assert.deepEqual(dry, { at: at('16:00'), id: 'XXXX', km: 20, rain: false, near: false, wx: 'no rain', sky: 'partly cloudy' });
  const shower = { ...w, current: { at: at('16:00'), precip: 0.8, code: 80 } };
  assert.equal(rainingNow({ ...shower, obs: dry }, at('16:10')), null);
  const wet = metarObs({ icaoId: 'XXXX', obsTime: at('16:00') / 1000, wxString: '-SHRA BR', clouds: [{ cover: 'BKN' }] }, 20);
  assert.equal(wet.wx, 'showers');
  assert.equal(metarObs({ obsTime: 1, wxString: 'VCSH' }, 5).wx, 'showers nearby');
  assert.deepEqual(rainingNow({ ...shower, obs: wet }, at('16:10')), { words: 'rain showers, 0.8 mm in the last hour; the station 20 km away reports showers', sure: true, source: 'model+station' });
  assert.equal(umbrellaWorth({ ...shower, obs: wet }, at('16:10')), true);
  // His word beats both, for an hour.
  const seen = { at: at('16:20'), raining: false, said: 'clouds, no rain' };
  assert.equal(rainingNow({ ...shower, obs: wet, seen }, at('16:30')), null);
  assert.equal(umbrellaWorth({ ...shower, obs: wet, seen }, at('16:30')), false);
  assert.equal(rainingNow({ ...shower, obs: wet, seen }, at('17:25')).sure, true, 'after an hour the sources count again');
  assert.equal(rainingNow({ seen: { ...seen, raining: true, said: 'pouring' } }, at('16:30')).words, 'he says it\'s raining ("pouring")');
  // The walk isn't moved for a model drizzle.
  assert.equal(walkDue({ ...base, now: at('16:08'), doc: null, steps: steps(3000, '16:00'), weather: w }).kind, 'ask');
  // Thu 10/22 audit: 2 of 4 is a tie, not "leaning rain"; a high forecast alone is no umbrella (7:00 PM: 73%, 3 of 4,
  // the station reporting thunderstorms nearby but no rain).
  assert.equal(rainChanceText(hour('21:00', 41, [0.5, 0, 0.4, 0])), 'rain 41%, 2 of 4 models show rain (models split evenly)');
  assert.equal(rainChanceText(hour('19:00', 73, [0.5, 0.6, 0.4, 0])), 'rain 73%, 3 of 4 models show rain (models split, leaning rain)');
  const storm = { at: at('19:00'), id: 'XXXX', km: 19, rain: false, near: true, wx: 'thunderstorms nearby', sky: 'mostly cloudy' };
  const high = { current: { at: at('19:00'), precip: 0, code: 3 }, hours: [hour('19:00', 73, [0.5, 0.6, 0.4, 0])], obs: storm };
  assert.equal(umbrellaWorth(high, at('19:10')), false, 'a forecast stays a forecast');
  assert.equal(umbrellaWorth({ ...high, seen: { at: at('19:05'), raining: true, said: 'pouring' } }, at('19:10')), true, 'his word confirms it');
});
