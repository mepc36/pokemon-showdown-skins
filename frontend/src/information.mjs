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

export function speciesInformation(name) {
  const species = Dex.species.get(name);
  return {types: species.exists ? species.types : [], abilities: species.exists ? [...new Set(Object.values(species.abilities))] : [], gender: species.gender || ''};
}

export function effectName(kind, id) { return id ? Dex[kind].get(id).name : ''; }

// The server request lists the active Pokémon first, so its order changes on
// every switch. Keep the first order seen (the lead first) and remember each
// entry's current request position, which is what /choose switch needs.
export function stableOwnOrder(team, previousOrder = []) {
  const idents = team.map(pokemon => pokemon.ident);
  // Remembered idents stay in place even while a request is missing, so a
  // reconnect or an empty request between turns never resets the order.
  const order = [...previousOrder, ...idents.filter(ident => !previousOrder.includes(ident))];
  return {order, team: order.filter(ident => idents.includes(ident)).map(ident => {
    const serverIndex = idents.indexOf(ident) + 1;
    return {...team[serverIndex - 1], serverIndex};
  })};
}

// Renderer HP for the player's own Pokémon. The request already knows the
// result of the turn before the hit animates, so roster bars read the
// renderer's copy, which only changes when the damage line plays.
export function ownDisplayedHealth(battle, pokemon) {
  const client = battle?.mySide?.pokemon?.find(p => p.ident === pokemon?.ident);
  if (client && Number.isFinite(client.hp) && client.maxhp > 0) {
    return {percent: client.fainted ? 0 : Math.max(0, Math.min(100, client.hp / client.maxhp * 100)),
      fainted: !!client.fainted, condition: client.fainted ? '0 fnt' : `${client.hp}/${client.maxhp}${client.status ? ` ${client.status}` : ''}`};
  }
  const health = pokemon?.condition?.match(/^(\d+)\/(\d+)/), fainted = /fnt/.test(pokemon?.condition || '');
  return {percent: fainted ? 0 : health ? Math.max(0, Math.min(100, Number(health[1]) / Number(health[2]) * 100)) : 100,
    fainted, condition: pokemon?.condition || ''};
}

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

// Own private request values already include IVs, EVs and nature. These are
// unmodified stats, not species base stats or a guess at an opponent's spread.
export function ownPokemonStats(battle, index) {
  const server = Number.isInteger(index) && index >= 1 && index <= 6 ? battle?.myPokemon?.[index - 1] : null;
  const pokemon = battle?.mySide?.pokemon?.find(p => p.ident === server?.ident);
  const transformed = !!pokemon?.volatiles?.transform;
  const fields = [['Attack', 'atk'], ['Defense', 'def'], ['Sp. Atk', 'spa'], ['Sp. Def', 'spd']];
  return {label: transformed ? 'Original stats · before Transform' : 'Your stats · before battle modifiers',
    entries: fields.map(([name, id]) => [name, Number.isFinite(server?.stats?.[id]) && server.stats[id] > 0 ? server.stats[id] : 'Unknown']),
    note: transformed ? 'These are the original request stats, not the copied opponent’s current stats.' :
      'Exact values from your private team request, including IVs, EVs and nature. Boosts, items and other battle modifiers are not applied.'};
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
    return {...base, name: pokemon.getSpeciesForme?.() || pokemon.speciesForme, level: pokemon.level, gender: pokemon.gender || '',
      active: !!side.active?.includes(pokemon), fainted: !!pokemon.fainted, percent,
      health: pokemon.fainted ? 'Fainted' : percent === null ? 'HP unknown' : `~${Math.round(percent)}% HP`,
      status: pokemon.status || '', types: pokemon.getTypeList?.() || Dex.species.get(pokemon.speciesForme).types,
      ability: pokemon.ability || pokemon.baseAbility || '', item: pokemon.item || '',
      baseAbility: pokemon.baseAbility || '', transformed: !!pokemon.volatiles?.transform,
      previousItem: pokemon.prevItem || '', previousItemEffect: pokemon.prevItemEffect || '',
      teraType: pokemon.terastallized || pokemon.teraType || '',
      // moveTrack contains publicly observed moves. A '*' marks a copied move.
      moves: (pokemon.moveTrack || []).map(([name]) => ({id: Dex.moves.get(name.replace(/^\*/, '')).id,
        name: Dex.moves.get(name.replace(/^\*/, '')).name, copied: name.startsWith('*')}))};
  });
}
