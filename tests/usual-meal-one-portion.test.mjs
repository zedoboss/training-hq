// A usual meal he names is one usual portion. He wrote "I just ate pork ribs those remember 2 of them"; his notes held
// that meal as one portion of 2 ribs (200 g), rice and 2 eggs. The coach asked "two full portions ... or just 2
// portions of ribs?", took his "Yes full portions" (his usual, full) as two, and logged double. His words: "Bro wdym??
// 200g total ribs and 2 eggs".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, systemPrompt } from '../server/coach/prompt.mjs';
import { TOOLS } from '../server/coach/tools.mjs';

const rule = () => {
  const i = RULES.indexOf('- His usual meals');
  assert.ok(i > 0, 'the usual-meal rule is in the prompt');
  return RULES.slice(i, RULES.indexOf('\n', i));
};

test('a usual meal he names is logged at once as one usual portion, asking only about what differs', () => {
  const r = rule();
  assert.match(r, /log one usual portion at once/);
  assert.match(r, /amounts from that note or preset/);
  assert.match(r, /ask only about what he says differs/);
});

test('a count that is inside one portion ("2 of them", "2 eggs") is that portion, never a count of portions', () => {
  const r = rule();
  assert.match(r, /"2 of them" when a portion is 2 ribs, "2 eggs"\) describes that portion, never a count of portions/);
  assert.match(r, /more than one portion only when his words say so \("two portions", "double", "had it twice"\)/);
});

test('no either-or question that "yes" can answer', () => {
  assert.match(rule(), /Never ask him an either-or question that "yes" can answer\./);
});

test('the rule sits with the other meal-logging rules and reaches every system prompt', () => {
  const i = RULES.indexOf('- His usual meals');
  assert.ok(i > RULES.indexOf("On a meal's screen") && i < RULES.indexOf('- Every meal-logging reply'), 'with the meal rules');
  assert.ok(systemPrompt({ profile: 'x' }).includes(rule()));
});

test('log_meal tells the model the same: one portion of a usual meal from the notes, counts inside it are that portion', () => {
  const t = TOOLS.find((x) => x.name === 'log_meal');
  assert.ok(t, 'log_meal exists');
  const d = t.description || t.def?.description || JSON.stringify(t);
  assert.match(d, /A usual meal of his that your notes hold \(no preset\): one portion, the note's amounts/);
  assert.match(d, /\("2 of them", "2 eggs"\) is that portion, not more portions/);
});
