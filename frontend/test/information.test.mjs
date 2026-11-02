import test from 'node:test';
import assert from 'node:assert/strict';
import {moveInformation, opponentSlots} from '../src/information.mjs';

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
