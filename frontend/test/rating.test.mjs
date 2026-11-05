import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerRating, parseRating} from '../src/rating.mjs';
const user = 'mepc36363636';
const profile = {userid: user, ratings: {gen9randombattle: {elo: 1375.16, gxe: 54.5, w: 228, l: 244}, gen9ou: {elo: 1800}}};
const response = body => ({ok: true, json: async () => body});

test('rating selects only Gen 9 Random Battle and validates the returned account', () => {
  assert.deepEqual(parseRating(profile, user), {elo: 1375.16, gxe: 54.5, wins: 228, losses: 244});
  assert.equal(parseRating({userid: user, ratings: {gen9ou: {elo: 1800}}}, user), null);
  assert.throws(() => parseRating({...profile, userid: 'someoneelse'}, user));
  assert.throws(() => parseRating({userid: user}, user));
  for (const elo of ['', null, 'not-a-number', -1, Infinity]) {
    assert.throws(() => parseRating({userid: user, ratings: {gen9randombattle: {elo}}}, user));
  }
});

test('missing optional rating fields stay unknown; zero wins/losses are valid', () => {
  assert.deepEqual(parseRating({userid: user, ratings: {gen9randombattle: {elo: '1000', w: 0, l: '0', gxe: null}}}, user),
    {elo: 1000, gxe: null, wins: 0, losses: 0});
});

test('rating fetch is public, token-free, deduplicated and briefly cached', async () => {
  let calls = 0, time = 1000;
  const rating = new PlayerRating(user, {now: () => time, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, `https://pokemonshowdown.com/users/${user}.json`);
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers, undefined);
    return response(profile);
  }});
  const first = rating.load(); assert.equal(first, rating.load()); await first;
  await rating.load(); assert.equal(calls, 1);
  assert.equal(rating.checkedAt, 1000); assert.equal(rating.label, 'Rating · 1375');
  await rating.load(true); assert.equal(calls, 2);
  time += 60001; await rating.load(); assert.equal(calls, 3);
});

test('failed refresh keeps previous data explicitly stale and allows recovery', async () => {
  const rating = new PlayerRating(user, {fetcher: async () => response(profile)});
  await rating.load(); const checked = rating.checkedAt;
  rating.fetcher = async () => { throw new Error('offline'); };
  await rating.load(true);
  assert.equal(rating.status, 'error'); assert.equal(rating.label, 'Rating');
  assert.equal(rating.checkedAt, checked);
  rating.fetcher = async () => response({userid: user, ratings: {}});
  await rating.load(true);
  assert.equal(rating.status, 'unrated'); assert.equal(rating.value, null);
});

test('HTTP errors and malformed JSON do not masquerade as an unrated account', async () => {
  for (const fetcher of [async () => ({ok: false}), async () => ({ok: true, json: async () => { throw new Error('bad JSON'); }})]) {
    const rating = new PlayerRating(user, {fetcher}); await rating.load();
    assert.equal(rating.status, 'error'); assert.equal(rating.value, null);
  }
});
