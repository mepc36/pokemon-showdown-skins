import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PossibleSets, possibleSets, possibleMoves, narrowSets, validateSnapshot, percent} from '../src/possible-sets.mjs';
import setRules from '../src/set-rules.json' with {type: 'json'};
import {moveList, rolePages, movePages, textPages} from '../src/info-components.mjs';
const snapshot = JSON.parse(await readFile(new URL('../public/data/gen9randombattle.json', import.meta.url)));

function inferenceFixture() {
  const data = structuredClone(snapshot);
  const source = {randbatsCommit: data.source.commit};
  const definitions = [
    {role: 'Stall', movepool: ['Leech Seed', 'Sludge Bomb'], abilities: ['Overgrow'], teraTypes: ['Steel']},
    {role: 'Slow attacker', movepool: ['Leaf Storm', 'Sludge Bomb'], abilities: ['Chlorophyll'], teraTypes: ['Grass']},
  ];
  data.pokemon.Venusaur.roles = Object.fromEntries(definitions.map((r, i) => [r.role, {weight: i ? .9999 : .0001,
    moves: Object.fromEntries(r.movepool.map(m => [m, 1])), abilities: {[r.abilities[0]]: 1}, teraTypes: {[r.teraTypes[0]]: 1}, items: {Leftovers: 1}}]));
  return {data, rules: {source, pokemon: {venusaur: {level: 84, sets: definitions}}}};
}

test('a unique revealed move identifies its set and fixed Tera without percentages', () => {
  const {data, rules} = inferenceFixture();
  assert.equal(narrowSets(data, 'Venusaur', 84, {}, rules).count, 2);
  const match = narrowSets(data, 'Venusaur', 84, {moves: [{id: 'leechseed'}]}, rules);
  assert.equal(match.identified, true); assert.equal(match.role, 'Stall'); assert.equal(match.teraType, 'Steel');
  assert.deepEqual(match.sets[0].roles.map(role => role.name), ['Stall']);
  assert.ok(!rolePages({snapshot: data}, 'Venusaur', 84, '', match)[0].content.includes('%'));
});

test('one role with multiple Tera options does not invent a fixed Tera', () => {
  const {data, rules} = inferenceFixture();
  rules.pokemon.venusaur.sets[0].teraTypes.push('Water');
  const match = narrowSets(data, 'Venusaur', 84, {moves: [{id: 'leechseed'}]}, rules);
  assert.equal(match.identified, true); assert.equal(match.teraType, '');
  assert.deepEqual(Object.keys(match.sets[0].roles[0].teraTypes), ['Steel', 'Water']);
  rules.pokemon.venusaur.sets[1].role = 'Stall';
  const ambiguous = narrowSets(data, 'Venusaur', 84, {moves: [{id: 'sludgebomb'}]}, rules);
  assert.equal(ambiguous.identified, false); assert.equal(ambiguous.count, 2);
});

test('only natural moves, original ability and revealed Tera constrain definitions', () => {
  const {data, rules} = inferenceFixture();
  assert.equal(narrowSets(data, 'Venusaur', 84, {moves: [{id: 'leechseed', copied: true}, {id: 'struggle'}], ability: 'Overgrow', item: 'Choice Specs'}, rules).count, 2);
  assert.equal(narrowSets(data, 'Venusaur', 84, {baseAbility: 'Chlorophyll'}, rules).role, 'Slow attacker');
  assert.equal(narrowSets(data, 'Venusaur', 84, {teraType: 'Steel'}, rules).role, 'Stall');
  assert.equal(narrowSets(data, 'Venusaur', 84, {transformed: true, moves: [{id: 'leechseed'}]}, rules).identified, false);
});

test('incompatible reveals or stale definitions retain the full list without certainty', () => {
  const {data, rules} = inferenceFixture();
  const match = narrowSets(data, 'Venusaur', 84, {moves: [{id: 'leechseed'}, {id: 'leafstorm'}]}, rules);
  assert.equal(match.status, 'unmatched'); assert.equal(match.sets[0].roles.length, 2); assert.equal(match.teraType, '');
  assert.equal(narrowSets(data, 'Venusaur', 85, {}, rules).status, 'unavailable');
  rules.source.randbatsCommit = 'different';
  assert.equal(narrowSets(data, 'Venusaur', 84, {}, rules).status, 'unavailable');
});

test('generator definitions cover every species and role in the paired snapshot', () => {
  assert.equal(setRules.source.randbatsCommit, snapshot.source.commit);
  for (const [name, pokemon] of Object.entries(snapshot.pokemon)) {
    const result = narrowSets(snapshot, name, pokemon.level);
    assert.ok(result.count > 0, name);
    for (const role of Object.keys(pokemon.roles)) {
      assert.ok(result.sets.some(set => set.roles.some(candidate => candidate.name === role)), `${name}: missing ${role}`);
    }
  }
});

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

test('compact candidates expose names/types without details, actions or markup injection', () => {
  const html = moveList([{id: 'thunderbolt', current: {pp: 2, maxpp: 24}}]);
  assert.match(html, /Thunderbolt/); assert.match(html, /Electric/);
  assert.doesNotMatch(html, /base PP|2 \/ 24|Power|Accuracy|button|data-nav|data-info-move/);
  const changed = structuredClone(snapshot);
  changed.pokemon.Raikou.roles['<img src=x onerror=alert(1)>'] = changed.pokemon.Raikou.roles['Fast Support'];
  const rendered = rolePages({snapshot: changed}, 'Raikou', 82).map(p => p.content).join('');
  assert.doesNotMatch(rendered, /<img/);
  assert.equal(percent(0), '0% observed'); assert.equal(percent(0.0001), '<0.1%');
});

test('every sampled Pokémon gets one page with every candidate role and move', () => {
  for (const [name, pokemon] of Object.entries(snapshot.pokemon)) {
    const pages = rolePages({snapshot}, name, pokemon.level);
    assert.equal(pages.length, 1);
    const expected = possibleSets(snapshot, name, pokemon.level).reduce((sum, set) => sum + set.roles.length, 0);
    assert.equal((pages[0].content.match(/class="role-heading"/g) || []).length, expected, `${name}: one heading per candidate role`);
    for (const move of possibleMoves(possibleSets(snapshot, name, pokemon.level))) {
      assert.ok(pages.some(p => p.content.includes(`data-move="${move.id}"`)), `${name}: missing ${move.name}`);
    }
  }
});

test('long move rules paginate without losing text or opening a child menu', () => {
  const description = 'This is an unusually long description of a move and its effects. '.repeat(40).trim();
  const pages = textPages(description);
  assert.equal(pages.join(' '), description);
  assert.ok(pages.every(p => p.length <= 420));
  const cards = movePages({description, power: 80, accuracy: '100%', pp: '10 base PP', priority: '0', contact: 'No', target: 'User'});
  assert.equal(cards.length, pages.length);
  assert.ok(cards.every(p => !p.content.includes('<button')));
});
