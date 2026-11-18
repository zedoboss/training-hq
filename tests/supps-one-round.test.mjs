// "Took all supps" with a meal is that meal's round only. With his first meal he said "took all supps"; the coach
// ticked all seven, his second-meal round (creatine, carnitine, collagen) too, so when he later said "I just took the
// rest of the supps 2nd round" it answered "already marked taken this morning". His words: "Wdym this morning bro???".
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { TOOLS } from '../server/coach/tools.mjs';
import { RULES } from '../server/coach/prompt.mjs';

const TZ = 'UTC';
const D = '2026-01-20';
const at = (hm) => Date.parse(`${D}T${hm}:00Z`);
let dir; let store; let clock;

const s = (id, name, short, extra = {}) => ({ id, kind: 'supplement', name, short, dose: '1', days: { type: 'daily' }, status: 'active', perTake: { train: 1, rest: 1 }, ...extra });
const HIS = [
  s('supp.c', 'Vitamin C', 'vitamin C', { order: 0, afterMeal: 'first' }),
  s('supp.d3', 'Vitamin D3 + K2 (MK-7)', 'D3 + K2', { order: 1, afterMeal: 'first' }),
  s('supp.mg', 'Magnesium bisglycinate', 'magnesium', { order: 2, atBed: true }),
  s('supp.o3', 'Omega-3 fish oil', 'omega-3', { order: 3, afterMeal: 'first' }),
  s('supp.lclt', 'L-Carnitine L-Tartrate', 'carnitine', { order: 4, afterMeal: 'second' }),
  s('supp.cr', 'Creatine monohydrate', 'creatine', { order: 5, afterMeal: 'second' }),
  s('supp.col', 'Collagen peptides', 'collagen', { order: 6, afterMeal: 'second' }),
  s('supp.ash', 'Ashwagandha KSM-66', 'ashwagandha', { order: 7, afterMeal: 'first' }),
];
const FIRST = ['vitamin C', 'D3 + K2', 'omega-3', 'ashwagandha'];
const SECOND = ['creatine', 'carnitine', 'collagen'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thq-supp-round-'));
  store = openStore(join(dir, 'db.sqlite'));
  for (const x of HIS) store.writeLocal('supplements', x.id, x);
  store.writeLocal('sleep-log', D, { id: D, date: D, bed: Date.UTC(2026, 0, 19, 22, 0), wake: at('06:00'), inBedMin: 480, asleepMin: 480, source: 'coach' });
  clock = at('10:46');
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (args) => TOOLS.find((t) => t.name === 'supplement').run(args, { store, tz: TZ, now: () => clock, action: () => {} });
const taken = () => store.listRecords('supp-log').filter((r) => !r.deleted && r.data.status === 'taken').map((r) => r.data.suppId).sort();

test('his 10:46 AM: all seven with the first meal is refused, nothing ticked, the rounds named', async () => {
  const r = await call({ names: [...FIRST, ...SECOND], status: 'taken' });
  assert.equal(r.wrote, undefined);
  assert.match(r.text, /Nothing ticked/);
  assert.match(r.text, /After your first meal: vitamin C, D3 \+ K2, omega-3, ashwagandha/);
  assert.match(r.text, /After your second meal: carnitine, creatine, collagen/);
  assert.deepEqual(taken(), []);
});

test('first round with the first meal, then "the rest, 2nd round" at 4:35 PM ticks the second round, not "already"', async () => {
  const a = await call({ names: FIRST, status: 'taken' });
  assert.equal(a.wrote, true);
  assert.match(a.text, /Still open: carnitine, creatine, collagen, magnesium\./);
  clock = at('16:35');
  const b = await call({ names: SECOND, status: 'taken' });
  assert.equal(b.wrote, true);
  assert.match(b.text, /creatine 1 taken/);
  assert.match(b.text, /Still open: magnesium\./);
  assert.deepEqual(taken(), ['supp.c', 'supp.col', 'supp.cr', 'supp.d3', 'supp.ash', 'supp.lclt', 'supp.o3'].sort());
});

test('magnesium (before bed) with a meal round is refused too; on its own at bed it is ticked', async () => {
  assert.match((await call({ names: [...SECOND, 'magnesium'], status: 'taken' })).text, /Nothing ticked.*Before bed: magnesium/);
  assert.equal((await call({ names: ['magnesium'], status: 'taken' })).wrote, true);
});

test('when his own words name more than one round, allRounds ticks them all', async () => {
  const r = await call({ names: ['vitamin C', 'creatine'], status: 'taken', allRounds: true });
  assert.equal(r.wrote, true);
  assert.deepEqual(taken(), ['supp.c', 'supp.cr']);
});

test('one with no set moment fits any round; skipped and undo across rounds are not held', async () => {
  store.writeLocal('supplements', 'supp.zn', s('supp.zn', 'Zinc', 'zinc', { order: 8 }));
  assert.equal((await call({ names: [...FIRST, 'zinc'], status: 'taken' })).wrote, true);
  assert.equal((await call({ names: [...SECOND, 'magnesium'], status: 'skipped', reason: 'out' })).wrote, true);
  assert.equal((await call({ names: ['vitamin C', 'creatine'], status: 'undo' })).wrote, true);
});

test('the prompt says "took all supps" with a meal is that round only', () => {
  assert.match(RULES, /"Took all supps" with a meal means that meal's round only/);
});
