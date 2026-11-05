import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PossibleSets, possibleSets, possibleMoves, validateSnapshot, percent} from '../src/possible-sets.mjs';
import {moveCards, setSection} from '../src/info-components.mjs';
const snapshot = JSON.parse(await readFile(new URL('../public/data/gen9randombattle.json', import.meta.url)));

test('bundled snapshot validates all species and preserves role-relative frequencies', () => {
  assert.equal(validateSnapshot(snapshot), snapshot);
  assert.ok(Object.keys(snapshot.pokemon).length > 500);
  const sets = possibleSets(snapshot, 'Raikou', 82);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].roles.length, 3);
  const role = sets[0].roles.find(r => r.name === 'Bulky Attacker');
  assert.equal(role.weight, snapshot.pokemon.Raikou.roles['Bulky Attacker'].weight);
  assert.equal(role.items['Choice Specs'], snapshot.pokemon.Raikou.roles['Bulky Attacker'].items['Choice Specs']);
  assert.ok(possibleMoves(sets).some(m => m.id === 'substitute'));
  assert.equal(new Set(possibleMoves(sets).map(m => m.id)).size, possibleMoves(sets).length);
});

test('unknown, regional, cosmetic, battle-only and ambiguous forms stay distinct', () => {
  assert.deepEqual(possibleSets(snapshot, 'Not revealed', 80), []);
  assert.deepEqual(possibleSets(snapshot, 'Invented-Form', 80), []);
  assert.equal(possibleSets(snapshot, 'Zoroark-Hisui', 1)[0].name, 'Zoroark-Hisui');
  assert.equal(possibleSets(snapshot, 'Minior-Blue', 79)[0].name, 'Minior');
  assert.equal(possibleSets(snapshot, 'Mimikyu-Busted', 80)[0].name, 'Mimikyu');
  assert.equal(possibleSets(snapshot, 'Ogerpon-Wellspring-Tera', 80)[0].name, 'Ogerpon-Wellspring');
  assert.deepEqual(possibleSets(snapshot, 'Zacian-Crowned', 64).map(s => s.name), ['Zacian-Crowned']);
  assert.deepEqual(possibleSets(snapshot, 'Zacian', 64).map(s => s.name), ['Zacian-Crowned']);
  assert.equal(possibleSets(snapshot, 'Zacian', 1).length, 2);
  assert.ok(possibleSets(snapshot, 'Raikou', 1)[0].levelMismatch);
  assert.equal(possibleSets(snapshot, 'Gastrodon-East', 80)[0].name, 'Gastrodon');
});

test('malformed metadata, counts and missing role fields are rejected', () => {
  for (const mutate of [s => s.format = 'gen8randombattle', s => s.source.commit = 'main',
    s => s.source.updatedAt = 'yesterday', s => s.pokemon.Raikou.roles['Fast Support'].weight = 3402,
    s => s.pokemon.Raikou.roles['Fast Support'].moves.Thunderbolt = -1,
    s => delete s.pokemon.Raikou.roles['Fast Support'].teraTypes]) {
    const changed = structuredClone(snapshot); mutate(changed);
    assert.throws(() => validateSnapshot(changed));
  }
});

test('failed fetch, invalid JSON and malformed snapshot remain recoverable without credentials', async () => {
  for (const fail of [async () => { throw new Error('offline'); }, async () => ({ok: false}),
    async () => ({ok: true, json: async () => { throw new Error('invalid'); }}),
    async () => ({ok: true, json: async () => ({})})]) {
    const store = new PossibleSets({fetcher: fail});
    assert.equal(await store.load(), null);
    assert.equal(store.status, 'error');
    store.fetcher = async (url, options) => {
      assert.equal(url, './data/gen9randombattle.json');
      assert.equal(options.credentials, 'omit');
      return {ok: true, json: async () => snapshot};
    };
    assert.equal(await store.load(), snapshot);
    assert.equal(store.status, 'ready');
  }
});

test('concurrent data loads share one request', async () => {
  let resolve, calls = 0;
  const store = new PossibleSets({fetcher: () => { calls++; return new Promise(r => resolve = r); }});
  const a = store.load(), b = store.load();
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ok: true, json: async () => snapshot});
  await a;
  await store.load();
  assert.equal(calls, 1);
});

test('candidate components cannot inherit current PP or inject data markup', () => {
  const html = moveCards([{id: 'thunderbolt', current: {pp: 2, maxpp: 24}}], {prefix: 'possible', origin: 'possible'});
  assert.match(html, /15 base PP/);
  assert.doesNotMatch(html, /2 \/ 24|choose|onclick/);
  const changed = structuredClone(snapshot);
  changed.pokemon.Raikou.roles['<img src=x onerror=alert(1)>'] = changed.pokemon.Raikou.roles['Fast Support'];
  const rendered = setSection({snapshot: changed}, 'Raikou', 82, {side: 'opponent', index: 1});
  assert.doesNotMatch(rendered, /<img/);
  assert.match(rendered, /&lt;img/);
  assert.match(rendered, /not adjusted by revealed information/);
  assert.equal(percent(0), '0% observed');
  assert.equal(percent(0.0001), '<0.1%');
});
