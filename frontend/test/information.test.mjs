import test from 'node:test';
import assert from 'node:assert/strict';
import {moveInformation, opponentSlots, pokemonSpeed} from '../src/information.mjs';

test('unrevealed opponent slots stay unknown without inferred sets', () => {
  const slots = opponentSlots({pokemon: []});
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.map(p => p.index), [1, 2, 3, 4, 5, 6]);
  assert.ok(slots.every(p => !p.revealed && !p.item && !p.ability && !p.teraType && !p.moves.length));
  const knownSpecies = opponentSlots({pokemon: [{speciesForme: 'Landorus', hp: 31, maxhp: 100,
    // A private/request-style moves array must never become an opponent reveal.
    moves: ['earthpower'], moveTrack: []}]})[0];
  assert.equal(knownSpecies.ability, '');
  assert.equal(knownSpecies.item, '');
  assert.deepEqual(knownSpecies.moves, []);
});

test('public opponent HP, fainting, reveals and copied moves are represented without exact PP', () => {
  const pokemon = {speciesForme: 'Rotom-Wash', hp: 16, maxhp: 48, status: 'par',
    ability: 'Levitate', prevItem: 'Leftovers', prevItemEffect: 'knocked off',
    terastallized: 'Electric', moveTrack: [['Hydro Pump', 2], ['*Shadow Ball', 1]]};
  const side = {pokemon: [pokemon], active: [pokemon]};
  const p = opponentSlots(side)[0];
  assert.equal(p.health, '~33% HP');
  assert.equal(p.active, true);
  assert.equal(p.item, '');
  assert.equal(p.previousItem, 'Leftovers');
  assert.equal(p.teraType, 'Electric');
  assert.deepEqual(p.moves, [{id: 'hydropump', name: 'Hydro Pump', copied: false}, {id: 'shadowball', name: 'Shadow Ball', copied: true}]);
  pokemon.fainted = true;
  assert.equal(opponentSlots(side)[0].health, 'Fainted');
  assert.equal(opponentSlots(side)[0].percent, 0);
  assert.equal(opponentSlots(null).filter(p => p.revealed).length, 0);
});

test('move information uses current request PP and distinguishes baseline from variable damage', () => {
  const move = moveInformation('shadowball', {pp: 2, maxpp: 24, disabled: true});
  assert.equal(move.power, 80);
  assert.equal(move.accuracy, '100%');
  assert.equal(move.pp, '2 / 24');
  assert.equal(move.disabled, true);
  assert.match(move.description, /20%/);
  assert.equal(moveInformation('nastyplot').power, '—');
  assert.equal(moveInformation('nastyplot').accuracy, 'No accuracy check');
  assert.equal(moveInformation('gyroball').power, 'Variable');
  assert.equal(moveInformation('seismictoss').power, 'User’s level');
  assert.equal(moveInformation('dragonrage').power, '40 damage');
  assert.equal(moveInformation('fissure').power, 'One-hit KO');
  assert.equal(moveInformation('quickattack').priority, '+1');
  assert.equal(moveInformation('shadowball').pp, '15 base PP');
});

test('own Speed follows request identity rather than renderer party order', () => {
  const active = {ident: 'p1: Grumpig', volatiles: {}}, bench = {ident: 'p1: Palossand', volatiles: {}};
  const request = {ident: active.ident, active: true, stats: {spe: 200}};
  const battle = {myPokemon: [request, {ident: bench.ident, stats: {spe: 102}}],
    mySide: {pokemon: [bench, active], active: [active]}, atQueueEnd: true,
    scene: {tooltips: {calculateModifiedStats(pokemon, server) {
      assert.equal(pokemon, active); assert.equal(server, request); return {spe: 300};
    }}}};
  assert.deepEqual([pokemonSpeed(battle, 'own', 1).value, pokemonSpeed(battle, 'own', 1).modified], [200, 300]);
  assert.equal(pokemonSpeed(battle, 'own', 2).value, 102);
  assert.equal(pokemonSpeed(battle, 'own', 2).modified, undefined);
  battle.atQueueEnd = false;
  assert.equal(pokemonSpeed(battle, 'own', 1).modified, undefined, 'replay must not mix old boosts with the latest request');
  battle.atQueueEnd = true;
  active.fainted = true;
  assert.equal(pokemonSpeed(battle, 'own', 1).modified, undefined);
  battle.mySide.active = [bench];
  active.fainted = false;
  assert.equal(pokemonSpeed(battle, 'own', 1).modified, undefined, 'request and displayed active Pokémon must agree');
});

test('missing own stats and unrevealed opponents do not acquire invented Speed', () => {
  const battle = {myPokemon: [{ident: 'p1: Grumpig'}], mySide: {pokemon: [], active: []},
    farSide: {pokemon: []}, scene: {tooltips: {}}};
  for (const [side, index] of [['own', 1], ['opponent', 1], ['opponent', 6], ['own', 0], ['own', 7], ['own', 1.5]]) {
    assert.equal(pokemonSpeed(battle, side, index).kind, 'unknown');
  }
  assert.equal(pokemonSpeed(null, 'own', 1).kind, 'unknown');
});

test('opponent Speed uses only public species estimates, not the private team', () => {
  const raikou = {speciesForme: 'Raikou', getSpecies: () => ({exists: true})};
  const battle = {get myPokemon() { throw new Error('Opponent must never read the private request'); },
    farSide: {pokemon: [raikou]}, tier: '[Gen 9] Random Battle', gen: 9,
    scene: {tooltips: {getSpeedRange(pokemon) {
      assert.equal(pokemon, raikou); return {min: 193, ev84: 236, max: 270};
    }}}};
  const speed = pokemonSpeed(battle, 'opponent', 1);
  assert.equal(speed.kind, 'estimate'); assert.equal(speed.value, '193 or 236');
  assert.equal(speed.modified, undefined); assert.match(speed.note, /not a revealed stat/);
  battle.tier = '[Gen 9] OU';
  assert.equal(pokemonSpeed(battle, 'opponent', 1).value, '193–270');
  battle.gen = 1; battle.tier = '[Gen 1] Random Battle';
  assert.equal(pokemonSpeed(battle, 'opponent', 1).value, '270');
});

test('Transform uses an estimate instead of reporting the original private stat as current', () => {
  const ditto = {ident: 'p1: Ditto', speciesForme: 'Ditto', volatiles: {transform: []}, getSpecies: () => ({exists: true})};
  const battle = {myPokemon: [{ident: ditto.ident, stats: {spe: 150}, active: true}],
    mySide: {pokemon: [ditto], active: [ditto]}, atQueueEnd: true, tier: '[Gen 9] Random Battle', gen: 9,
    scene: {tooltips: {getSpeedRange: () => ({min: 193, ev84: 236, max: 270})}}};
  assert.equal(pokemonSpeed(battle, 'own', 1).kind, 'estimate');
  assert.equal(pokemonSpeed(battle, 'own', 1).value, '193 or 236');
});


test('known moves are not replaced by Struggle or a restricted action request', async () => {
  const {knownOwnMoves} = await import('../src/information.mjs');
  const pokemon = {ident: 'p1: Raikou', active: true, moves: ['thunderbolt', 'scald', 'calmmind', 'substitute']};
  const request = {side: {pokemon: [pokemon]}, active: [{moves: [{id: 'struggle', pp: 1}]}]};
  assert.deepEqual(knownOwnMoves(pokemon, request).map(m => m.id), pokemon.moves);
  assert.ok(knownOwnMoves(pokemon, request).every(m => !m.current));
  request.active[0].moves = [{id: 'thunderbolt', pp: 0, maxpp: 24, disabled: true}];
  assert.equal(knownOwnMoves(pokemon, request)[0].current.pp, 0);
  assert.equal(knownOwnMoves(pokemon, request).length, 4);
});

test('known own move PP cannot come from another active Pokémon or a stale request', async () => {
  const {knownOwnMoves} = await import('../src/information.mjs');
  const pokemon = {ident: 'p1: Ditto', active: true, moves: ['thunderbolt', 'scald']};
  const request = {side: {pokemon: [{ident: 'p1: Raikou', active: true}]}, active: [{moves: [{id: 'thunderbolt', pp: 9}]}]};
  assert.deepEqual(knownOwnMoves(pokemon, request).map(m => m.id), ['thunderbolt', 'scald']);
  assert.ok(knownOwnMoves(pokemon, request).every(m => !m.current));
  assert.ok(knownOwnMoves(pokemon, {wait: true}).every(m => !m.current));
});

test('own Attack, Defense, Sp. Atk and Sp. Def use exact private stats for every slot', async () => {
  const {ownPokemonStats} = await import('../src/information.mjs');
  const stats = {atk: 143, def: 205, spa: 311, spd: 178, spe: 250};
  const battle = {myPokemon: [{ident: 'p1: first', stats}, {ident: 'p1: bench', stats: {...stats, atk: 222}}],
    mySide: {pokemon: [{ident: 'p1: bench', volatiles: {}}, {ident: 'p1: first', volatiles: {}}]}};
  assert.deepEqual(ownPokemonStats(battle, 1).entries, [['Attack', 143], ['Defense', 205], ['Sp. Atk', 311], ['Sp. Def', 178]]);
  assert.equal(ownPokemonStats(battle, 2).entries[0][1], 222);
  assert.ok(ownPokemonStats(battle, 7).entries.every(([, value]) => value === 'Unknown'));
});

test('missing stats stay unknown and Transform labels original rather than copied stats', async () => {
  const {ownPokemonStats} = await import('../src/information.mjs');
  const battle = {myPokemon: [{ident: 'p1: Ditto', stats: {atk: 150, def: NaN, spa: 0}}],
    mySide: {pokemon: [{ident: 'p1: Ditto', volatiles: {transform: ['transform']}}]}};
  const value = ownPokemonStats(battle, 1);
  assert.match(value.label, /Original stats/); assert.match(value.note, /not the copied/);
  assert.deepEqual(value.entries.map(([, n]) => n), [150, 'Unknown', 'Unknown', 'Unknown']);
});


test('identity exposes species types and possible abilities without claiming a reveal', async () => {
  const {speciesInformation} = await import('../src/information.mjs');
  assert.deepEqual(speciesInformation('Camerupt').types, ['Fire', 'Ground']);
  assert.ok(speciesInformation('Ursaring').abilities.includes('Guts'));
  assert.deepEqual(speciesInformation('Not revealed').types, []);
  const p = opponentSlots({pokemon: [{speciesForme: 'Landorus', gender: 'M', hp: 100, maxhp: 100}]})[0];
  assert.equal(p.gender, 'M'); assert.equal(p.ability, '');
});

test('own roster order keeps the lead first and maps each slot to its current request index', async () => {
  const {stableOwnOrder} = await import('../src/information.mjs');
  const lead = {ident: 'p1: Grumpig', active: true}, bench = {ident: 'p1: Palossand'}, third = {ident: 'p1: Excadrill'};
  const first = stableOwnOrder([lead, bench, third]);
  assert.deepEqual(first.order, ['p1: Grumpig', 'p1: Palossand', 'p1: Excadrill']);
  assert.deepEqual(first.team.map(p => p.serverIndex), [1, 2, 3]);
  // After switching, the server lists the new active Pokémon first.
  const after = stableOwnOrder([{...third, active: true}, bench, {...lead, active: false}], first.order);
  assert.deepEqual(after.team.map(p => p.ident), ['p1: Grumpig', 'p1: Palossand', 'p1: Excadrill']);
  assert.deepEqual(after.team.map(p => p.serverIndex), [3, 2, 1]);
  assert.equal(after.team[2].active, true);
  // A missing ident is not shown, but the remembered order survives until it returns.
  const partial = stableOwnOrder([bench, third], after.order);
  assert.deepEqual(partial.team.map(p => p.ident), ['p1: Palossand', 'p1: Excadrill']);
  assert.deepEqual(stableOwnOrder([], partial.order).order, after.order);
  assert.deepEqual(stableOwnOrder([third, lead, bench], partial.order).team.map(p => p.ident), ['p1: Grumpig', 'p1: Palossand', 'p1: Excadrill']);
});

test('exact HP reads current/full with the percentage to one decimal place', async () => {
  const {ownExactHealth} = await import('../src/information.mjs');
  const battle = {mySide: {pokemon: [{ident: 'p1: Grumpig', hp: 75, maxhp: 301, status: 'par'}, {ident: 'p1: Breloom', hp: 0, maxhp: 261, fainted: true}]}};
  assert.equal(ownExactHealth(battle, {ident: 'p1: Grumpig', condition: '301/301'}), '75/301 (24.9%)');
  assert.equal(ownExactHealth(null, {ident: 'p1: Grumpig', condition: '100/200'}), '100/200 (50%)');
  assert.equal(ownExactHealth(null, {ident: 'p1: Grumpig', condition: '297/297 par'}), '297/297 (100%)');
  assert.equal(ownExactHealth(battle, {ident: 'p1: Breloom', condition: '0 fnt'}), '0/261 (0%)');
  assert.equal(ownExactHealth(null, {ident: 'p1: Breloom', condition: '0 fnt'}), '0 (0%)');
  assert.equal(ownExactHealth(null, {ident: 'p1: Breloom', condition: ''}), '—');
});

test('own roster HP follows the renderer copy and falls back to the request when it has none', async () => {
  const {ownDisplayedHealth} = await import('../src/information.mjs');
  const request = {ident: 'p1: Grumpig', condition: '100/297'};
  // The request already knows this turn’s result; the renderer has not animated it yet.
  const battle = {mySide: {pokemon: [{ident: 'p1: Grumpig', hp: 297, maxhp: 297, status: 'par'}]}};
  assert.deepEqual(ownDisplayedHealth(battle, request), {percent: 100, fainted: false, condition: '297/297 par'});
  battle.mySide.pokemon[0].hp = 0; battle.mySide.pokemon[0].fainted = true;
  assert.deepEqual(ownDisplayedHealth(battle, request), {percent: 0, fainted: true, condition: '0 fnt'});
  // Bench Pokémon the renderer has never seen use the request.
  assert.deepEqual(ownDisplayedHealth(battle, {ident: 'p1: Breloom', condition: '118/324'}).percent, Math.max(0, 118 / 324 * 100));
  assert.equal(ownDisplayedHealth(null, {ident: 'p1: Breloom', condition: '0 fnt'}).fainted, true);
  assert.deepEqual(ownDisplayedHealth(battle, {ident: 'p1: Breloom', condition: '0 fnt par'}, true), {percent: 100, fainted: false, condition: ''}, 'a replay shows unseen Pokémon at full health with no status');
  assert.deepEqual(ownDisplayedHealth(battle, {ident: 'p1: Breloom', condition: '12/324 par'}, true), {percent: 100, fainted: false, condition: '324/324'});
  assert.equal(ownDisplayedHealth(null, {ident: 'p1: Breloom', condition: '0 fnt'}).percent, 0);
});
