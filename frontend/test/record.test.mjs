import test from 'node:test';
import assert from 'node:assert/strict';
import {readRecord, recordResult, recordElo, resetRecord, ratingChange} from '../src/record.mjs';

function storage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('an empty or unreadable store reads as no wins, no losses and no peak', () => {
  const store = storage();
  assert.deepEqual(readRecord(store), {wins: 0, losses: 0, peak: null, counted: []});
  store.setItem('ps-mve-record', '{not json');
  assert.deepEqual(readRecord(store), {wins: 0, losses: 0, peak: null, counted: []});
});

test('each battle room counts once, as a win or a loss', () => {
  const store = storage();
  recordResult(store, 'battle-gen9randombattle-1', true);
  recordResult(store, 'battle-gen9randombattle-1', true);
  recordResult(store, 'battle-gen9randombattle-2', false);
  const record = readRecord(store);
  assert.equal(record.wins, 1); assert.equal(record.losses, 1);
});

test('reset clears wins and losses, keeps the peak, and a counted battle stays counted', () => {
  const store = storage();
  recordResult(store, 'battle-gen9randombattle-1', true); recordElo(store, 1456);
  resetRecord(store);
  recordResult(store, 'battle-gen9randombattle-1', true);
  assert.deepEqual({...readRecord(store), counted: undefined}, {wins: 0, losses: 0, peak: 1456, counted: undefined});
});

test('the peak only ever goes up', () => {
  const store = storage();
  recordElo(store, 1432); recordElo(store, 1400); recordElo(store, NaN); recordElo(store, 0);
  assert.equal(readRecord(store).peak, 1432);
  recordElo(store, 1456);
  assert.equal(readRecord(store).peak, 1456);
});

test('the server rating line after a rated battle is read', () => {
  assert.deepEqual(ratingChange("mepc36363636's rating: 1432 &rarr; <strong>1456</strong><br />(+24 for winning)"), {name: 'mepc36363636', before: 1432, after: 1456});
  assert.equal(ratingChange('<div class="broadcast-blue">Something else</div>'), null);
});
