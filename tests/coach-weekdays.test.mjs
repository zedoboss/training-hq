// Thu 11/19 (his words: "Saturday 11/15 and Sunday 11/16 have no D3 logged"; that 2026 week, 11/14 was a Saturday,
// 11/15 a Sunday, 11/16 a Monday): every weekday the coach says next to a date is the calendar's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixWeekdays } from '../app/js/lib/time.js';
import { openStore } from '../server/store.mjs';
import { openCoach, conversation } from '../server/coach/index.mjs';
import { calendarLine } from '../server/coach/tools-read.mjs';

const TODAY = '2026-11-19'; // a Thursday
const HIS = 'Last 3 days: the log only has D3 for Tuesday 11/17, at the old 10,000 IU dose. Saturday 11/15 and Sunday 11/16 have no D3 logged.';

test('his Wednesday reply: the weekdays are corrected, the dates kept', () => {
  assert.equal(fixWeekdays(HIS, TODAY), 'Last 3 days: the log only has D3 for Tuesday 11/17, at the old 10,000 IU dose. Sunday 11/15 and Monday 11/16 have no D3 logged.');
});

test('right weekdays and text without dates are left exactly as written', () => {
  for (const s of ['Saturday 11/14, Sunday 11/15, Monday 11/16.', 'Pull at 4:30 AM, Thursday 11/19.', 'Sun 11/15 and Mon 11/16', 'Rest on Sunday, train Monday.', 'Cable row 3/4 of the stack, Sunday.', '60 kg total: 20 kg bar + 20 kg a side', '', 'Monday 13/45'])
    assert.equal(fixWeekdays(s, TODAY), s);
});

test('every form: short names, case, a comma, the year, month names, the weekday after the date', () => {
  const cases = [
    ['Sat 11/15', 'Sun 11/15'],
    ['sat 11/15', 'sun 11/15'],
    ['SATURDAY 11/15', 'SUNDAY 11/15'],
    ['Saturday, 11/15', 'Sunday, 11/15'],
    ['Thurs. 11/20', 'Fri. 11/20'],
    ['Tues 11/19', 'Thu 11/19'],
    ['Saturday the 11/15', 'Sunday the 11/15'],
    ['Saturday 11/15/2026', 'Sunday 11/15/2026'],
    ['Sunday 10/11/2023', 'Wednesday 10/11/2023'],
    ['Saturday, November 15', 'Sunday, November 15'],
    ['Saturday Nov 15th, 2026', 'Sunday Nov 15th, 2026'],
    ['11/15 (Saturday)', '11/15 (Sunday)'],
  ];
  for (const [said, right] of cases) assert.equal(fixWeekdays(said, TODAY), right, said);
});

test('a date without a year is the one nearest today, across New Year both ways', () => {
  assert.equal(fixWeekdays('Wednesday 12/31 and Thursday 1/1', TODAY), 'Thursday 12/31 and Friday 1/1', 'Thu 12/31/2026, Fri 1/1/2027');
  assert.equal(fixWeekdays('Monday 12/28', '2027-01-03'), 'Monday 12/28', 'Mon 12/28/2026, seen from January');
  assert.equal(fixWeekdays('Friday 1/2', '2026-12-30'), 'Saturday 1/2', 'Sat 1/2/2027, seen from December');
  assert.equal(fixWeekdays('Saturday 2/29', TODAY), 'Saturday 2/29', 'no 2/29 near 2026: left alone');
});

test('a bad or missing today leaves the text alone', () => {
  assert.equal(fixWeekdays(HIS, null), HIS);
  assert.equal(fixWeekdays(null, TODAY), null);
});

function fakeProcess(text) {
  const p = { fresh: true };
  p.turn = async ({ content, onEvent = () => {} }) => { content({ fresh: p.fresh }); p.fresh = false; onEvent({ type: 'text', delta: text }); return { text, ms: 5 }; };
  p.warm = () => true; p.stop = () => false; p.status = () => ({ running: true, busy: false }); p.close = () => {};
  return p;
}

test('the reply he reads (and the one the coach starts itself) carries the calendar weekday, on his day in his zone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thq-weekdays-'));
  const store = openStore(join(dir, 'db.sqlite'));
  try {
    // Wed 11/18, 10:46 AM in Ho Chi Minh City (3:46 AM UTC).
    let clock = Date.UTC(2026, 10, 18, 3, 46);
    const coach = openCoach({ store, process: fakeProcess(HIS), now: () => clock++, tz: 'Asia/Ho_Chi_Minh' });
    const msg = await coach.send({ text: 'took all supps also i take 3 d3 now pills And have been last 3 days update' });
    assert.match(msg.text, /Sunday 11\/15 and Monday 11\/16 have no D3 logged/);
    assert.match(msg.text, /Tuesday 11\/17/);
    assert.equal(conversation(store).at(-1).text, msg.text, 'saved as corrected, so every device shows it');
    const init = await coach.initiate({ instruction: 'x' });
    assert.match(init.text, /Sunday 11\/15 and Monday 11\/16/);
    await coach.close();
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the coach sees the last two weeks with their weekdays, to copy from', () => {
  const line = calendarLine({ today: TODAY });
  assert.match(line, /Saturday 11\/14, Sunday 11\/15, Monday 11\/16, Tuesday 11\/17, Wednesday 11\/18; today Thursday 11\/19\.$/);
  assert.match(line, /^Calendar, the last 14 days .*: Thursday 11\/5, /);
});
