import {Dex} from '@pkmn/dex';

const targets = {normal: 'One adjacent Pokémon', self: 'User', allAdjacent: 'All adjacent Pokémon',
  allAdjacentFoes: 'All adjacent opponents', all: 'Entire field', allySide: 'Your side', foeSide: 'Opponent’s side',
  adjacentAlly: 'One adjacent ally', adjacentAllyOrSelf: 'User or adjacent ally', any: 'Any other Pokémon',
  randomNormal: 'Random adjacent opponent', allies: 'User and allies', allyTeam: 'Your team', scripted: 'Depends on the move'};

// These are reference values, not a damage calculator or predictions about hidden sets.
export function moveInformation(id, currentMove) {
  const move = Dex.moves.get(id);
  const power = move.category === 'Status' ? '—' : move.damage === 'level' ? 'User’s level' :
    typeof move.damage === 'number' ? `${move.damage} damage` : move.ohko ? 'One-hit KO' :
    move.basePower || 'Variable';
  return {id: move.id, name: move.name, type: move.type, category: move.category,
    power, accuracy: move.accuracy === true ? 'No accuracy check' : `${move.accuracy}%`,
    priority: move.priority > 0 ? `+${move.priority}` : String(move.priority),
    target: targets[move.target] || move.target,
    pp: currentMove ? `${currentMove.pp ?? '—'} / ${currentMove.maxpp ?? '—'}` : `${move.pp} base PP`,
    contact: move.flags?.contact ? 'Yes' : 'No', disabled: !!currentMove?.disabled,
    description: move.desc || move.shortDesc || 'No additional description available.',
    summary: move.shortDesc || move.desc || ''};
}

// The party list contains all current moves, including Transform copies. An
// active action request can be reduced to a locked move or Struggle, so use it
// only to attach matching PP/disabled information, never to erase known moves.
export function knownOwnMoves(pokemon, request) {
  const matches = pokemon?.active && request?.side?.pokemon?.some(p => p.active && p.ident === pokemon.ident);
  const current = matches ? request.active?.[0]?.moves || [] : [];
  const ids = pokemon?.moves?.length ? pokemon.moves : current.map(m => m.id);
  return ids.map(id => {
    const move = Dex.moves.get(id);
    return {id: move.id, name: move.name, current: current.find(m => Dex.moves.get(m.id).id === move.id)};
  });
}

export function effectName(kind, id) { return id ? Dex[kind].get(id).name : ''; }

// Reuse the pinned client's calculator, never scrape tooltip HTML or guess a set.
export function pokemonSpeed(battle, side, index) {
  const unknown = {kind: 'unknown', value: 'Unknown', note: 'Speed is not available yet.'};
  if (!battle || !Number.isInteger(index) || index < 1 || index > 6) return unknown;
  const server = side === 'own' ? battle.myPokemon?.[index - 1] : null;
  const pokemon = side === 'own' ? battle.mySide.pokemon.find(p => p.ident === server?.ident) :
    side === 'opponent' ? battle.farSide.pokemon[index - 1] : null;
  const tooltips = battle.scene.tooltips;
  const valid = value => Number.isFinite(value) && value > 0;

  // Transform copies hidden stats: follow Showdown's tooltip and show an estimate.
  if (server && !pokemon?.volatiles.transform) {
    if (!valid(server.stats?.spe)) return unknown;
    const speed = {kind: 'known', value: server.stats.spe,
      note: 'Unmodified Speed comes from your latest team request, before boosts, status, items, abilities and field effects.'};
    // Request data can be ahead of the animation/replay. Never mix those states,
    // or apply the active Pokémon's boosts to a different party slot.
    if (battle.atQueueEnd && server.active && pokemon && !pokemon.fainted &&
        battle.mySide.active.includes(pokemon)) {
      const modified = tooltips.calculateModifiedStats(pokemon, server).spe;
      if (valid(modified)) {
        speed.modified = modified;
        speed.note += ' Modified Speed includes known battle effects. Move priority and Trick Room can change turn order.';
      }
    }
    return speed;
  }

  if (!pokemon?.speciesForme || !pokemon.getSpecies().exists) return unknown;
  const {min, ev84, max} = tooltips.getSpeedRange(pokemon);
  const random = battle.tier.includes('Random');
  const values = battle.gen < 3 && random ? [max] : random ? [min, ev84] : [min, max];
  if (!values.every(valid)) return unknown;
  return {kind: 'estimate', value: [...new Set(values)].join(random ? ' or ' : '–'),
    note: 'Showdown estimate from the displayed species and level, before boosts, status, items, abilities and field effects. This is not a revealed stat.'};
}

// The pinned renderer already tracks switches, Illusion, forms and public reveals.
// Read its far side only; never fill gaps from species abilities or random sets.
export function opponentSlots(side) {
  return Array.from({length: 6}, (_, i) => {
    const pokemon = side?.pokemon?.[i];
    const base = {index: i + 1, revealed: !!pokemon?.speciesForme};
    if (!base.revealed) return {...base, name: 'Not revealed', moves: []};
    const percent = pokemon.fainted ? 0 : Number.isFinite(pokemon.hp) && pokemon.maxhp > 0 ?
      Math.max(0, Math.min(100, pokemon.hp / pokemon.maxhp * 100)) : null;
    return {...base, name: pokemon.getSpeciesForme?.() || pokemon.speciesForme, level: pokemon.level,
      active: !!side.active?.includes(pokemon), fainted: !!pokemon.fainted, percent,
      health: pokemon.fainted ? 'Fainted' : percent === null ? 'HP unknown' : `~${Math.round(percent)}% HP`,
      status: pokemon.status || '', types: pokemon.getTypeList?.() || Dex.species.get(pokemon.speciesForme).types,
      ability: pokemon.ability || pokemon.baseAbility || '', item: pokemon.item || '',
      previousItem: pokemon.prevItem || '', previousItemEffect: pokemon.prevItemEffect || '',
      teraType: pokemon.terastallized || pokemon.teraType || '',
      // moveTrack contains publicly observed moves. A '*' marks a copied move.
      moves: (pokemon.moveTrack || []).map(([name]) => ({id: Dex.moves.get(name.replace(/^\*/, '')).id,
        name: Dex.moves.get(name.replace(/^\*/, '')).name, copied: name.startsWith('*')}))};
  });
}
