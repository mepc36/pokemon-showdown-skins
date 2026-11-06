import test from 'node:test';
import assert from 'node:assert/strict';
import {moveCue, speedCue, statRanks} from '../src/battle-hints.mjs';

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

test('stat ranks preserve ties, unknowns and lowest-stat precedence', () => {
  assert.deepEqual(statRanks([['Attack', 300], ['Defense', 200], ['Sp. Atk', 200], ['Sp. Def', 150], ['Speed', 100]]),
    {Attack: 'green', Defense: 'yellow', 'Sp. Atk': 'yellow', 'Sp. Def': '', Speed: 'red'});
  assert.deepEqual(statRanks([['Attack', 100], ['Speed', 100]]), {});
  assert.deepEqual(statRanks([['Attack', 200], ['Speed', 100], ['Defense', 'Unknown']]), {Attack: 'green', Speed: 'red', Defense: ''});
});
