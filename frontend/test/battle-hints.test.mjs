import test from 'node:test';
import assert from 'node:assert/strict';
import {moveCue, speedCue} from '../src/battle-hints.mjs';

test('unknown and overlapping Speed estimates never claim a tie or an advantage', () => {
  assert.equal(speedCue(200, [158, 198]), 'green');
  assert.equal(speedCue(150, [158, 198]), 'red');
  assert.equal(speedCue(175, [158, 198]), '');
  assert.equal(speedCue(198, [158, 198]), '');
  assert.equal(speedCue(198, [198]), 'yellow');
  assert.equal(speedCue(198, [198, NaN]), '');
  assert.equal(speedCue(198, []), '');
});

test('status immunity, unclassified moves and resisted attacks have distinct rules', () => {
  const attack = {category: 'Special', target: 'normal'};
  assert.deepEqual([0, 0.5, 1, 2, 4, null].map(n => moveCue(attack, n)), ['red', '', 'yellow', 'green', 'green', '']);
  const status = {...attack, category: 'Status'};
  assert.equal(moveCue(status, 0), 'red');
  assert.equal(moveCue(status, null), 'yellow');
  for (const target of ['self', 'allySide', 'foeSide', 'all']) assert.equal(moveCue({...status, target}, 1), '');
});
