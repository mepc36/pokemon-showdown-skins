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

export function effectName(kind, id) { return id ? Dex[kind].get(id).name : ''; }

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
