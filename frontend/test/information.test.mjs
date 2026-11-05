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
