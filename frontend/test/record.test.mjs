import test from 'node:test';
import assert from 'node:assert/strict';
import {readRecord, recordResult, recordElo, resetRecord, ratingChange, sinceLabel} from '../src/record.mjs';

function storage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('an empty or unreadable store reads as no wins, no losses and no peak', () => {
  const store = storage();
  assert.deepEqual(readRecord(store), {wins: 0, losses: 0, peak: null, counted: [], recent: [], since: null});
  store.setItem('ps-mve-record', '{not json');
  assert.deepEqual(readRecord(store), {wins: 0, losses: 0, peak: null, counted: [], recent: [], since: null});
});

test('each battle room counts once, as a win or a loss', () => {
  const store = storage();
  recordResult(store, 'battle-gen9randombattle-1', true);
  recordResult(store, 'battle-gen9randombattle-1', true);
  recordResult(store, 'battle-gen9randombattle-2', false);
  const record = readRecord(store);
  assert.equal(record.wins, 1); assert.equal(record.losses, 1);
});

test('reset clears wins, losses and the last results, keeps the peak, and a counted battle stays counted', () => {
  const store = storage();
  recordResult(store, 'battle-gen9randombattle-1', true); recordElo(store, 1456);
  resetRecord(store);
  recordResult(store, 'battle-gen9randombattle-1', true);
  assert.deepEqual({...readRecord(store), counted: undefined, since: undefined}, {wins: 0, losses: 0, peak: 1456, counted: undefined, recent: [], since: undefined});
});

test('the last 10 results are kept oldest first, and reset clears them', () => {
  const store = storage();
  const results = [true, true, false, true, false, false, true, true, true, false, false, true];
  results.forEach((won, game) => recordResult(store, `battle-gen9randombattle-${game}`, won));
  assert.equal(readRecord(store).recent.join(''), 'LWLLWWWLLW');
  recordResult(store, 'battle-gen9randombattle-11', false);
  assert.equal(readRecord(store).recent.join(''), 'LWLLWWWLLW');
  resetRecord(store);
  assert.deepEqual(readRecord(store).recent, []);
  recordResult(store, 'battle-gen9randombattle-12', true);
  assert.equal(readRecord(store).recent.join(''), 'W');
});

test('the wins and losses count from the first result or from the last reset', () => {
  const store = storage();
  assert.equal(readRecord(store).since, null);
  recordResult(store, 'battle-gen9randombattle-1', true, 1000);
  recordResult(store, 'battle-gen9randombattle-2', true, 2000);
  assert.equal(readRecord(store).since, 1000);
  resetRecord(store, 3000);
  assert.equal(readRecord(store).since, 3000);
  recordResult(store, 'battle-gen9randombattle-3', false, 4000);
  assert.equal(readRecord(store).since, 3000);
});

test('a record saved before the reset time existed has no time until the next reset', () => {
  const store = storage();
  store.setItem('ps-mve-record', JSON.stringify({wins: 4, losses: 2, peak: 1456, counted: []}));
  recordResult(store, 'battle-gen9randombattle-1', true, 1000);
  assert.equal(readRecord(store).since, null);
  assert.equal(sinceLabel(readRecord(store).since), 'Since last reset');
});

test('the heading reads the stored time as "Since 10:15 AM on 11/26"', () => {
  assert.equal(sinceLabel(new Date(2026, 10, 26, 10, 15).getTime()), 'Since 10:15 AM on 11/26');
  assert.equal(sinceLabel(new Date(2026, 0, 5, 0, 5).getTime()), 'Since 12:05 AM on 1/5');
  assert.equal(sinceLabel(new Date(2026, 11, 31, 12, 0).getTime()), 'Since 12:00 PM on 12/31');
  assert.equal(sinceLabel(new Date(2026, 6, 4, 23, 59).getTime()), 'Since 11:59 PM on 7/4');
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
