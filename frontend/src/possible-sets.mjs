import {Dex} from '@pkmn/dex';
import setRules from './set-rules.json' with {type: 'json'};

export const SET_FORMAT = 'gen9randombattle';
export const SET_SOURCE = 'https://github.com/pkmn/randbats';
const id = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const frequency = value => Number.isFinite(value) && value >= 0 && value <= 1;
const distribution = value => object(value) && Object.entries(value).length > 0 &&
  Object.entries(value).every(([name, weight]) => name.length > 0 && frequency(weight));

// Fail closed on schema changes; do not reinterpret counts as probabilities.
export function validateSetData(data) {
  if (!object(data) || !Object.keys(data).length) throw new Error('Missing set data');
  for (const pokemon of Object.values(data)) {
    if (!object(pokemon) || !Number.isInteger(pokemon.level) || pokemon.level < 1 || pokemon.level > 100 ||
        !object(pokemon.roles) || !Object.keys(pokemon.roles).length) throw new Error('Invalid species data');
    for (const role of Object.values(pokemon.roles)) {
      if (!object(role) || !frequency(role.weight) || !distribution(role.moves) ||
          !distribution(role.abilities) || !distribution(role.teraTypes) ||
          role.items !== undefined && !distribution(role.items)) throw new Error('Invalid role frequencies');
    }
  }
  return data;
}

export function validateSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 1 || snapshot.format !== SET_FORMAT ||
      !/^[a-f0-9]{40}$/.test(snapshot.source?.commit || '') ||
      !Number.isFinite(Date.parse(snapshot.source?.updatedAt)) ||
      !Number.isFinite(Date.parse(snapshot.source?.retrievedAt)) ||
      !/^[a-f0-9]{64}$/.test(snapshot.source?.sha256 || '')) throw new Error('Invalid snapshot metadata');
  validateSetData(snapshot.pokemon);
  return snapshot;
}

export class PossibleSets {
  constructor({fetcher = (...args) => fetch(...args), url = './data/gen9randombattle.json'} = {}) {
    this.fetcher = fetcher; this.url = url; this.status = 'idle'; this.snapshot = null;
  }
  load() {
    if (this.pending) return this.pending;
    if (this.status === 'ready') return Promise.resolve(this.snapshot);
    this.status = 'loading';
    this.pending = Promise.resolve().then(async () => {
      try {
        const response = await this.fetcher(this.url, {credentials: 'omit', signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('Set data unavailable');
        this.snapshot = validateSnapshot(await response.json()); this.status = 'ready';
      } catch { this.snapshot = null; this.status = 'error'; }
      finally { this.pending = null; }
      return this.snapshot;
    });
    return this.pending;
  }
}

function formKey(species) {
  const base = Dex.species.get(species.baseSpecies);
  if (base.cosmeticFormes?.includes(species.name)) return id(base.name);
  if (species.baseSpecies === 'Pikachu') return 'pikachu';
  return id(typeof species.battleOnly === 'string' ? species.battleOnly : species.name);
}

// Match only known cosmetic/battle-only relationships. Do not collapse distinct
// regional forms or guess unknown forms. Ambiguous forms stay separately labelled.
export function possibleSets(snapshot, name, level) {
  const species = Dex.species.get(name);
  if (!snapshot || !species.exists) return [];
  const key = formKey(species);
  let candidates = Object.entries(snapshot.pokemon).filter(([entry]) => {
    const candidate = Dex.species.get(entry);
    return formKey(candidate) === key || species.name === 'Greninja' && entry === 'Greninja-Bond';
  });
  if (id(species.name) !== key) {
    const exact = candidates.filter(([entry]) => entry === species.name);
    if (exact.length) candidates = exact;
  }
  // The extension uses level to distinguish battle-only sets. Illusion can lie
  // about Zoroark's level, and old snapshots can have different balance levels.
  if (candidates.length > 1 && species.baseSpecies !== 'Zoroark') {
    const matching = candidates.filter(([, data]) => data.level === level);
    if (matching.length) candidates = matching;
  }
  return candidates.map(([name, data]) => ({name, level: data.level,
    levelMismatch: Number.isFinite(level) && level !== data.level && species.baseSpecies !== 'Zoroark',
    roles: Object.entries(data.roles).filter(([, role]) => role.weight > 0)
      .map(([name, role]) => ({name, ...role}))}));
}

export function possibleMoves(sets) {
  // A union only: no synthetic probabilities or filtering from public reveals.
  const moves = new Map();
  for (const set of sets) for (const role of set.roles) for (const name of Object.keys(role.moves)) {
    const move = Dex.moves.get(name);
    moves.set(move.id, {id: move.id, name: move.name});
  }
  return [...moves.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Eliminate incompatible generator definitions, never low-frequency options.
// A role can contain several definitions, and one definition can still allow
// several moves/Tera types. Keep those distinctions when marking an inference.
export function narrowSets(snapshot, name, level, reveals = {}, rules = setRules) {
  const all = possibleSets(snapshot, name, level);
  const unchanged = status => ({sets: all, status, identified: false, teraType: '', count: null});
  if (!all.length || reveals.transformed || rules.source.randbatsCommit !== snapshot?.source?.commit ||
      all.some(set => set.levelMismatch || !rules.pokemon[Dex.species.get(set.name).id])) return unchanged('unavailable');
  const moves = (reveals.moves || []).filter(move => !move.copied && id(move.id || move.name) !== 'struggle').map(move => id(move.id || move.name));
  const ability = id(reveals.baseAbility), tera = id(reveals.teraType);
  const matching = all.flatMap(set => rules.pokemon[Dex.species.get(set.name).id].sets.map(rule => ({set, rule})))
    .filter(({rule}) => moves.every(move => rule.movepool.some(option => id(option) === move)) &&
      (!ability || rule.abilities.some(option => id(option) === ability)) &&
      (!tera || rule.teraTypes.some(option => id(option) === tera)));
  // New live data, copied identity, or an unexpected reveal must never produce
  // a fabricated certainty. Keep the complete list available for inspection.
  if (!matching.length) return unchanged('unmatched');
  const union = (variants, field) => Object.fromEntries([...new Set(variants.flatMap(v => v.rule[field]))].map(value => [value, 1]));
  const sets = all.flatMap(set => {
    const variants = matching.filter(candidate => candidate.set === set);
    if (!variants.length) return [];
    const roles = [...new Set(variants.map(v => v.rule.role))].map(name => {
      const selected = variants.filter(v => v.rule.role === name);
      return {...snapshot.pokemon[set.name].roles[name], name, moves: union(selected, 'movepool'),
        abilities: union(selected, 'abilities'), teraTypes: union(selected, 'teraTypes')};
    });
    return [{...set, roles}];
  });
  const teraTypes = [...new Set(matching.flatMap(({rule}) => rule.teraTypes))];
  return {sets, status: matching.length === 1 ? 'identified' : 'ambiguous', identified: matching.length === 1,
    role: matching.length === 1 ? matching[0].rule.role : '', count: matching.length,
    teraType: !tera && teraTypes.length === 1 ? teraTypes[0] : ''};
}

export const percent = weight => weight === 0 ? '0% observed' : weight < 0.001 ? '<0.1%' :
  `${Number((weight * 100).toFixed(1))}%`;
