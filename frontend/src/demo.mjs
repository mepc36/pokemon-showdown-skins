// Display-only data inspired by the user's screenshot; this never runs a match.
const team = [
  ['Grumpig', '297/297', 'Psychic', 'Thick Fat', ['nastyplot', 'shadowball', 'dazzlinggleam', 'psyshock']],
  ['Palossand', '118/324', 'Water', 'Water Compaction', ['earthpower', 'shadowball', 'shoreup', 'stealthrock']],
  ['Excadrill', '126/330', 'Ground', 'Mold Breaker', ['earthquake', 'ironhead', 'rapidspin', 'swordsdance']],
  ['Breloom', '0 fnt', 'Fighting', 'Technician', ['machpunch', 'bulletseed', 'spore', 'swordsdance']],
  ['Amoonguss', '294/336', 'Water', 'Regenerator', ['spore', 'gigadrain', 'sludgebomb', 'foulplay']],
  ['Iron Hands', '0 fnt', 'Water', 'Quark Drive', ['drainpunch', 'wildcharge', 'icepunch', 'swordsdance']],
];
export const demoRequest = {
  rqid: 1,
  active: [{canTerastallize: 'Psychic', moves: [
    {move: 'Nasty Plot', id: 'nastyplot', pp: 32, maxpp: 32},
    {move: 'Shadow Ball', id: 'shadowball', pp: 24, maxpp: 24},
    {move: 'Dazzling Gleam', id: 'dazzlinggleam', pp: 16, maxpp: 16},
    {move: 'Psyshock', id: 'psyshock', pp: 16, maxpp: 16},
  ]}],
  side: {id: 'p1', name: 'mepc36363636', pokemon: team.map(([name, condition, teraType, baseAbility, moves], i) => ({
    ident: `p1: ${name}`, details: `${name}, L${i === 0 ? 92 : 80}${i === 0 ? ', F' : ''}`, condition, active: i === 0,
    stats: {atk: 150, def: 150, spa: 150, spd: 150, spe: 150}, moves, baseAbility, item: 'leftovers', pokeball: 'pokeball', teraType,
  }))},
};
export const demoLines = [
  '|gen|9', '|gametype|singles', '|player|p1|mepc36363636|1', '|player|p2|Offline preview|2',
  '|teamsize|p1|6', '|teamsize|p2|6', '|tier|[Gen 9] Random Battle', '|start',
  '|switch|p1a: Breloom|Breloom, L80|100/100', '|faint|p1a: Breloom',
  '|switch|p1a: Iron Hands|Iron Hands, L80|100/100', '|faint|p1a: Iron Hands',
  '|switch|p1a: Palossand|Palossand, L80|118/324',
  '|switch|p1a: Excadrill|Excadrill, L80|126/330',
  '|switch|p1a: Amoonguss|Amoonguss, L80|294/336',
  '|switch|p1a: Grumpig|Grumpig, L92, F|297/297',
  '|switch|p2a: Landorus|Landorus, L76, M|31/100', '|turn|16',
];
