import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkDue, withAsk, withAnswer, usualWalkHm, walkLines, planAt, stepsText, emptyWalk } from '../app/js/lib/walks.js';

const TZ = 'Asia/Bangkok';
const D = '2026-03-17';
const at = (hm, d = D) => Date.parse(`${d}T${hm}:00+07:00`);
const base = { tz: TZ, goal: 8000, wakeHm: '10:00', bedHm: '00:00' };
const steps = (n, hm) => ({ steps: n, asOf: at(hm) });

test('walks: ask, then 3 check-ins (20, 60, 120 minutes), each in new words, then quiet until he answers', () => {
  let doc = null;
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '14:00'), ...o });
  assert.equal(due('10:30'), null, 'not in the first hour after he wakes');
  const a = due('14:30');
  assert.equal(a.kind, 'ask');
  assert.equal(a.text, 'Walk: 3,000 of 8,000 steps as of 2:00 PM: 5,000 to go, about 50 minutes of walking. Go out for a walk now. When are you going?');
  doc = withAsk(doc, D, 'ask', at('14:30'));
  assert.equal(due('14:35'), null, 'not after 5 minutes any more (Sun 10/25)');
  assert.equal(due('14:49'), null);
  assert.deepEqual(due('14:50'), { kind: 'check', text: 'No answer on the walk. When are you going? Tell me a time and I leave you alone until then.' });
  assert.equal(due('14:50', { busy: true }), null, 'never during a workout or the sauna');
  doc = withAsk(doc, D, 'check', at('14:50'));
  assert.equal(due('15:29'), null);
  assert.match(due('15:30').text, /^Still no time for your walk\. 3,000 of 8,000 steps/);
  doc = withAsk(doc, D, 'check', at('15:30'));
  assert.equal(due('16:29'), null);
  assert.equal(due('16:30').text, 'Last check on the walk: going, a time, or skipping it today?');
  doc = withAsk(doc, D, 'check', at('16:30'));
  assert.equal(due('17:00'), null, 'then it stops');
  assert.equal(due('21:00'), null, 'all evening');
  assert.equal(due('21:30', { lastUserAt: at('21:00') }), null, 'he writes about something else: still quiet (Tue 10/27)');
  doc = withAnswer(doc, D, { action: 'none' }, at('21:00'));
  assert.equal(due('21:30').kind, 'ask', 'he answers about the walk with no time: a fresh ask 30 minutes on');
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
  assert.match(p.text, /^Walk time: you said "I'll go in an hour"\. Did you start walking\?/);
  doc = withAsk(doc, D, 'plan', at('15:32'));
  assert.equal(due('15:37'), null, 'no 5-minute follow-up (Sun 10/25)');
  assert.equal(due('15:52').text, 'Walk: you said 3:32 PM. Out yet? Going now, or a new time?');
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
  doc = withAnswer(doc, D, { action: 'none' }, at('14:33'));
  assert.equal(due('14:36'), null, 'he replied: no follow-up');
  assert.equal(due('15:02'), null);
  assert.equal(due('15:03').kind, 'ask');
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

test('walks and the weather (Wed 10/21, UV only since Tue 10/27): UV 3+ -> the coach plans the first hour under 3; heat never counts', async () => {
  const { hourRisk, nextWalkTime, safeWindowsText } = await import('../app/js/lib/walks.js');
  const hour = (hm, uv, feels, rain = 10) => ({ at: at(hm), uv, feels, rain });
  const weather = { hours: [hour('12:00', 8.4, 38.6), hour('13:00', 8, 38.9), hour('14:00', 6.5, 39), hour('15:00', 5.1, 38), hour('16:00', 2.9, 37), hour('17:00', 1, 36, 53), hour('18:00', 0, 35, 75), hour('19:00', 0, 31.5, 65), hour('20:00', 0, 31.5), hour('21:00', 0, 32.1), hour('22:00', 0, 32), hour('23:00', 0, 31.9)] };
  assert.deepEqual(['12:00', '15:00', '16:00', '17:00', '18:00'].map((h) => hourRisk(weather.hours.find((x) => x.at === at(h)))), ['never', 'caution', 'safe', 'safe', 'safe']);
  assert.equal(hourRisk({ uv: 4, feels: 30 }), 'caution');
  assert.equal(hourRisk({ uv: 0.9, feels: 35 }), 'safe', 'his words: anything under 3 UV is okay');
  assert.equal(hourRisk({ uv: 2.9, feels: 40 }), 'safe', 'not the temperature');
  assert.equal(hourRisk({ uv: 0, feels: null }), 'safe');
  assert.equal(nextWalkTime(weather, at('12:30'), at('23:00')).at, at('16:00'));
  assert.equal(nextWalkTime(weather, at('17:30'), at('23:00')).at, at('17:30'), 'a rainy hour under UV 3 is not skipped');
  assert.equal(safeWindowsText(weather, at('12:30'), at('23:00'), TZ), '4:00 PM-11:00 PM (UV 2.9 at most)');
  let doc = null;
  const due = (hm, o = {}) => walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '12:00'), weather, ...o });
  const p = due('12:30');
  assert.equal(p.kind, 'planned');
  assert.equal(p.planAt, at('16:00'));
  assert.match(p.text, /^Walk: UV 8\.4 now, too strong\. I planned it for 4:00 PM, when it's UV 2\.9\./);
  assert.doesNotMatch(p.text, /feels|°C|hot/);
  doc = withAnswer(withAsk(null, D, 'planned', at('12:30')), D, { action: 'plan', at: p.planAt, said: 'planned by the coach', by: 'coach' }, at('12:30'));
  assert.equal(due('13:00'), null, 'quiet until then');
  assert.equal(due('16:00').kind, 'plan');
  assert.match(due('16:00').text, /Go now\./);
  // The app's own time lands at UV 3+: moved once to the next hour under 3.
  const coachPlan = withAnswer(withAsk(null, D, 'planned', at('11:00')), D, { action: 'plan', at: at('13:00'), by: 'coach' }, at('11:00'));
  const cm = walkDue({ ...base, now: at('13:00'), doc: coachPlan, steps: steps(3000, '12:00'), weather });
  assert.equal(cm.kind, 'moved');
  assert.match(cm.text, /^It's UV 8 now, too strong for a walk\. I moved it to 4:00 PM \(UV 2\.9\)\./);
  // Tue 10/27: a time he set himself is never moved for the weather: at his time, "Did you start walking?", the UV as a fact.
  const mine = withAnswer(withAsk(null, D, 'ask', at('11:00')), D, { action: 'plan', at: at('13:00'), said: 'at 1' }, at('11:05'));
  const m = walkDue({ ...base, now: at('13:00'), doc: mine, steps: steps(3000, '12:00'), weather });
  assert.equal(m.kind, 'plan');
  assert.match(m.text, /^Walk time: you said "at 1"\. Did you start walking\? UV 8 now, strong sun: shade and a hat; under 3 from 4:00 PM\./);
  assert.equal(m.planAt, undefined);
  // UV 3 to 6 with no hour under 3 left before bed: go now, with shade (not held).
  const late = { hours: [hour('20:00', 4, 30), hour('21:00', 4, 30), hour('22:00', 4, 30), hour('23:00', 4, 30)] };
  const c = walkDue({ ...base, now: at('20:10'), doc: null, steps: steps(3000, '20:00'), weather: late });
  assert.equal(c.kind, 'ask');
  assert.match(c.text, /Go out for a walk now \(UV 4: shade and a hat\)\./);
  // No weather known: as before.
  assert.equal(walkDue({ ...base, now: at('12:30'), doc: null, steps: steps(3000, '12:00') }).kind, 'ask');
});

test('Tue 10/27: UV under 3 = walk on, whatever the heat; rain is told as his risk, never holds or moves a walk', () => {
  // His 5:57 PM: "Walk: too hot or bright now (UV 0.9, feels 35°C, rain 55%). I planned it for 7:00 PM, when it's UV 0, feels 32°C."
  const hour = (hm, uv, feels, rain) => ({ at: at(hm), uv, feels, rain });
  const weather = { hours: [hour('17:00', 0.9, 35, 55), hour('18:00', 0.1, 34, 42), hour('19:00', 0, 32, 30), hour('20:00', 0, 31, 20)] };
  const a = walkDue({ ...base, now: at('17:57'), doc: null, steps: steps(379, '17:43'), weather });
  assert.equal(a.kind, 'ask');
  assert.equal(a.planAt, undefined);
  assert.match(a.text, /Go out for a walk now\. When are you going\? Rain chance is high, 55%: it could rain\. If you walk, you take the risk\. Your call\.$/);
  assert.doesNotMatch(a.text, /UV|feels|°C|hot|bright/);
  // His 6:11 PM: his own time ("in 10-15 minutes") at UV 0.1, feels 34°C, rain 42%: not moved; asked if he started.
  const mine = withAnswer(withAsk(null, D, 'ask', at('17:57')), D, { action: 'plan', at: at('18:11'), said: 'in 10-15 minutes' }, at('17:59'));
  const p = walkDue({ ...base, now: at('18:11'), doc: mine, steps: steps(379, '17:43'), weather });
  assert.equal(p.kind, 'plan');
  assert.match(p.text, /^Walk time: you said "in 10-15 minutes"\. Did you start walking\? 379 of 8,000 steps/);
  assert.doesNotMatch(p.text, /UV|feels|°C|moved|not a walk|rain/i);
  // Raining now (model only, or confirmed) with UV under 3: still "go", the rain said as his risk.
  const shower = { ...weather, current: { at: at('18:00'), precip: 0.6, code: 80 } };
  const r = walkDue({ ...base, now: at('18:11'), doc: null, steps: steps(379, '17:43'), weather: shower });
  assert.equal(r.kind, 'ask');
  assert.match(r.text, /Rain likely now \(forecast model: rain showers, 0\.6 mm in the last hour\), not confirmed: if you walk, you take the risk of getting wet\. Your call\.$/);
  const sure = { ...shower, seen: { at: at('18:05'), raining: true, said: 'pouring' } };
  const rs = walkDue({ ...base, now: at('18:11'), doc: mine, steps: steps(379, '17:43'), weather: sure });
  assert.equal(rs.kind, 'plan');
  assert.match(rs.text, /Raining now \(he says it's raining \("pouring"\)\): if you walk, you take the risk of getting wet \(umbrella\)\. Your call\.$/);
  // A coach-planned time in rain at UV 0: not moved either.
  const coach = withAnswer(withAsk(null, D, 'planned', at('17:00')), D, { action: 'plan', at: at('18:00'), by: 'coach' }, at('17:00'));
  assert.equal(walkDue({ ...base, now: at('18:11'), doc: coach, steps: steps(379, '17:43'), weather: sure }).kind, 'plan');
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

test('Sun 10/25: a walk the coach planned for the weather: 3 check-ins, new words, then stop; never "you set" or "you said"', () => {
  // Saturday 10/24: planned at 2:02 PM for 6:00 PM (too hot), then the same "walk you set for 6:00 PM" every 15 minutes
  // till 10:56 PM, and at 6:00 PM "you said "planned by the coach for cooler weather"".
  const plan = { action: 'plan', at: at('18:00'), by: 'coach' };
  for (const start of [withAnswer(withAsk(null, D, 'planned', at('14:02')), D, plan, at('14:02')),
    // A record from before the change: the coach's note in "said".
    withAnswer(withAsk(null, D, 'planned', at('14:02')), D, { ...plan, by: undefined, said: 'planned by the coach for cooler weather' }, at('14:02'))]) {
    let doc = start;
    const sent = [];
    for (let m = 18 * 60; m < 23 * 60; m++) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const due = walkDue({ ...base, now: at(hm), doc, steps: steps(1820, '17:00'), lastUserAt: at('13:00') });
      if (!due) continue;
      sent.push({ hm, ...due });
      doc = withAsk(doc, D, due.kind, at(hm));
    }
    assert.deepEqual(sent.map((x) => `${x.hm} ${x.kind}`), ['18:00 plan', '18:20 check', '19:00 check', '20:00 check']);
    assert.match(sent[0].text, /^Walk time: 6:00 PM, the hour I picked for the weather\. Go now\./);
    assert.equal(new Set(sent.map((x) => x.text.slice(0, 40))).size, 4, 'each one in new words');
    for (const x of sent) assert.doesNotMatch(x.text, /you set|you said|planned by the coach/i, x.text);
    assert.match(walkLines([doc], { today: D, now: at('19:00'), tz: TZ })[0], /the app planned it for 6:00 PM \(for the weather;/);
  }
  // His own time keeps his words.
  const mine = withAnswer(null, D, { action: 'plan', at: at('18:00'), said: 'at 6' }, at('14:02'));
  assert.match(walkDue({ ...base, now: at('18:00'), doc: mine, steps: steps(1820, '17:00') }).text, /^Walk time: you said "at 6"\./);
});

test('Tue 10/27: his message about something else never restarts the walk check-ins; at most 3, new words, then quiet', () => {
  // Monday 10/26: the app planned the walk for 5:00 PM (heat). Walk time 5:02, check-in 5:23; at 5:32 PM he logged lunch
  // with the coach; that counted as an answer: a fresh "Out yet?" at 6:02, then 6:22, 7:02, 8:02 PM, three the same.
  const start = withAnswer(withAsk(null, D, 'planned', at('15:07')), D, { action: 'plan', at: at('17:00'), by: 'coach' }, at('15:07'));
  const replay = (talks, answers = []) => {
    let doc = start;
    const sent = [];
    for (let m = 17 * 60; m < 23 * 60; m++) {
      const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const ans = answers.find((x) => x === hm);
      if (ans) doc = withAnswer(doc, D, { action: 'none' }, at(hm));
      const lastUserAt = Math.max(0, ...talks.filter((t) => t <= hm).map((t) => at(t)));
      const due = walkDue({ ...base, now: at(hm), doc, steps: steps(36, '13:52'), lastUserAt });
      if (!due) continue;
      sent.push({ hm, ...due });
      doc = withAsk(doc, D, due.kind, at(hm));
    }
    return sent;
  };
  const mon = replay(['17:32']);
  assert.deepEqual(mon.map((x) => `${x.hm} ${x.kind}`), ['17:00 plan', '17:20 check', '18:02 check', '19:00 check']);
  assert.equal(new Set(mon.map((x) => x.text.slice(0, 30))).size, 4, 'each one in new words');
  assert.match(mon[3].text, /^Last check on the walk/);
  // He keeps writing all evening about other things: still never more than 3 check-ins, and none within 30 minutes of
  // a message.
  const chatty = replay(['17:10', '17:45', '18:30', '19:15', '20:00', '21:00']);
  assert.equal(chatty.filter((x) => x.kind === 'check').length, 3);
  assert.deepEqual(chatty.map((x) => x.kind), ['plan', 'check', 'check', 'check']);
  // No time set at all (the no-plan stream): the same.
  let doc = withAsk(null, D, 'ask', at('14:30'));
  const sent = [];
  for (let m = 14 * 60 + 31; m < 23 * 60; m++) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const due = walkDue({ ...base, now: at(hm), doc, steps: steps(3000, '14:00'), lastUserAt: at('15:00') });
    if (!due) continue;
    sent.push(due.kind);
    doc = withAsk(doc, D, due.kind, at(hm));
  }
  assert.deepEqual(sent, ['check', 'check', 'check'], 'a message at 3:00 PM about something else: no fresh ask');
  // A real answer with no time ("not sure yet"): one new round, its opening unlike the check-ins before it.
  const ans = replay([], ['18:10']);
  assert.deepEqual(ans.map((x) => `${x.hm} ${x.kind}`), ['17:00 plan', '17:20 check', '18:00 check', '18:40 again', '19:00 check', '19:40 check', '20:40 check']);
  assert.match(ans[3].text, /^Back to the walk: 5:00 PM was the hour I picked for the weather, and no new time yet\./);
  for (const x of ans) assert.doesNotMatch(x.text, /you set|you said/i);
});
