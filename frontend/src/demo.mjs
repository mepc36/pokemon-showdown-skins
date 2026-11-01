export const demoRequest = {
  rqid: 1, active: [{canTerastallize: 'Electric', moves: [
    {move: 'Thunderbolt', id: 'thunderbolt', pp: 24, maxpp: 24},
    {move: 'Surf', id: 'surf', pp: 24, maxpp: 24},
    {move: 'Grass Knot', id: 'grassknot', pp: 32, maxpp: 32},
    {move: 'Volt Switch', id: 'voltswitch', pp: 32, maxpp: 32},
  ]}], side: {id: 'p1', name: 'mepc36363636', pokemon: [
    ['Pikachu', 'Electric', true], ['Charizard', 'Fire'], ['Blastoise', 'Water'],
    ['Venusaur', 'Grass'], ['Snorlax', 'Normal'], ['Gengar', 'Ghost'],
  ].map(([name, teraType, active]) => ({ident: `p1: ${name}`, details: `${name}, L80, M`, condition: '240/240', active: !!active, stats: {atk: 150, def: 150, spa: 150, spd: 150, spe: 150}, moves: ['thunderbolt', 'surf', 'grassknot', 'voltswitch'], baseAbility: 'Static', item: 'lightball', pokeball: 'pokeball', teraType}))},
};
export const demoLines = ['|gen|9', '|gametype|singles', '|player|p1|mepc36363636|1', '|player|p2|Display fixture|2', '|teamsize|p1|6', '|teamsize|p2|6', '|tier|[Gen 9] Random Battle', '|start', '|switch|p1a: Pikachu|Pikachu, L80, M|240/240', '|switch|p2a: Dragonite|Dragonite, L80, M|100/100', '|turn|1'];
