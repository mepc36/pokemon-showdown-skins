// Presentation rules only. The renderer supplies Showdown's calculations.
export function moveCue(move, factor) {
  if (!['normal', 'any', 'randomNormal', 'allAdjacent', 'allAdjacentFoes', 'adjacentFoe'].includes(move.target)) return '';
  if (factor === 0) return 'red';
  if (move.category === 'Status') return 'yellow';
  if (!Number.isFinite(factor)) return '';
  return factor > 1 ? 'green' : factor === 1 ? 'yellow' : '';
}

export function speedCue(own, opponents) {
  if (!(own > 0) || !opponents?.length || opponents.some(value => !Number.isFinite(value) || value <= 0)) return '';
  const min = Math.min(...opponents), max = Math.max(...opponents);
  return own > max ? 'green' : own < min ? 'red' : own === min && own === max ? 'yellow' : '';
}

export function statRanks(entries) {
  const values = [...new Set(entries.map(([, value]) => value).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => b - a);
  if (values.length < 2) return {};
  return Object.fromEntries(entries.map(([name, value]) => [name,
    value === values[0] ? 'green' : value === values.at(-1) ? 'red' : value === values[1] ? 'yellow' : '']));
}
