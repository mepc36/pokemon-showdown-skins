import {moveInformation} from './information.mjs';
import {possibleSets} from './possible-sets.mjs';
import {Dex} from '@pkmn/dex';
import uiData from './showdown-ui-data.json' with {type: 'json'};

// Regional forms: "Ninetales-Alola" shows as Ninetales with an ALOLA tag so the region never gets clipped.
export function regionalForm(name) {
  const match = String(name || '').match(/^(.+?)-(Alola|Galar|Hisui|Paldea)(?:-(.+))?$/);
  if (!match) return {base: name || '', region: ''};
  return {base: match[3] ? `${match[1]}-${match[3]}` : match[1], region: match[2]};
}
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const escape = escapeHtml;
export function itemIcon(name, className = 'item-icon') {
  const item = Dex.items.get(name);
  // Sprite indices extracted from data/items.ts at our pinned Showdown server
  // revision 5b01be81011ec12efa25dcfff49ea279a6029d6f (MIT; vendor/SERVER-LICENSE).
  const num = uiData.itemIcons[item.id];
  return item.exists && Number.isInteger(num) ? `<span class="${className}" aria-hidden="true" title="${escape(item.name)}" style="background-position:-${num % 16 * 24}px -${Math.floor(num / 16) * 24}px"></span>` : '';
}
export function itemLabel(name) {
  return `<span class="item-label">${itemIcon(name)}<span>${escape(name)}</span></span>`;
}
export const facts = entries => `<dl class="info-facts">${entries.map(([label, value, meta = {}]) => {
  if (typeof meta === 'string') meta = {type: meta};
  return `<div${meta.type ? ` data-type="${escape(meta.type)}"` : ''}${meta.list ? ' data-list="true"' : ''}${meta.cue ? ` data-cue="${escape(meta.cue)}" title="${escape(meta.hint || {green: 'Highest stat', yellow: 'Next-highest stat', red: 'Lowest stat'}[meta.cue])}"` : ''}><dt>${escape(label)}</dt><dd>${meta.item ? itemLabel(value) : escape(value)}</dd></div>`;
}).join('')}</dl>`;
export const typeBadges = types => types.map(type => `<span class="type-badge" data-type="${escape(type)}">${escape(type)}</span>`).join('');
const chunks = (values, size) => Array.from({length: Math.ceil(values.length / size)}, (_, i) => values.slice(i * size, (i + 1) * size));

// These are deliberately static entries, never controls that open child menus.
export function moveList(moves, placeholders = 0) {
  const entries = moves.map(m => {
    const move = moveInformation(m.id);
    const type = m.type || move.type;
    return `<li class="compact-move" data-move="${escape(move.id)}" data-type="${escape(type)}" data-cue="${escape(m.cue || '')}" data-revealed="${!!m.revealed}" title="${escape(m.label || (m.revealed ? 'Revealed in battle' : ''))}"><strong>${escape(move.name)}${m.copied ? ' *' : ''}</strong>${typeBadges([type])}</li>`;
  });
  while (entries.length < placeholders) entries.push('<li class="compact-move unknown-move">Not revealed</li>');
  return `<ul class="compact-moves">${entries.join('')}</ul>`;
}

// Pages have bounded row counts. New/expanded datasets get sibling continuation
// pages instead of unbounded cards or a second menu level.
// Opponent pages use the same layout as the own-Pokémon page: three fact cards, a stats block, a
// move list. known: what the battle has revealed ({ability, item, previousItem, teraType, inferredTera}); a card
// shows the revealed fact, otherwise that role's possibilities. revealed: move ids seen in battle.
export function rolePages(store, name, level, speedInfo = '', inference, {known = {}, revealed = new Set()} = {}) {
  if (!store.snapshot) return [{key: 'sets-status', label: 'Possible sets', content: store.status === 'error' ?
    '<p>Possible sets could not load.</p><button id="retry-sets" data-nav data-row="retry-sets">Retry set data</button>' : '<p>Loading possible sets…</p>', note: 'Known and revealed information still works.'}];
  const sets = inference?.sets || possibleSets(store.snapshot, name, level);
  if (!sets.length) return [{key: 'sets-missing', label: 'Possible sets', content: '<p>No matching set data.</p>', note: 'This species or form is absent from the snapshot.'}];
  const identified = !!inference?.identified;
  return sets.flatMap(set => set.roles.flatMap(role => {
    const moves = chunks(Object.keys(role.moves).map(name => { const id = moveInformation(name).id; return {id, revealed: revealed.has(id)}; }), 8);
    const abilities = Object.keys(role.abilities), items = Object.keys(role.items || {'No item': 1}), tera = Object.keys(role.teraTypes);
    const cards = [
      known.ability ? ['Ability', known.ability] : ['Possible abilities', abilities.join(' / ') || 'Unknown', {list: true}],
      known.item ? ['Item', known.item, {item: true}] : known.previousItem ? ['Item', `Lost ${known.previousItem}`] : ['Possible items', items.join(' / '), {list: true}],
      known.teraType ? ['Tera', known.teraType, known.teraType] : known.inferredTera ? ['Tera · inferred', known.inferredTera, {type: known.inferredTera, cue: 'green', hint: 'All remaining set definitions have this Tera type'}] : ['Possible Tera', tera.join(' / ') || 'Unknown', {list: true}]];
    const count = Math.max(1, moves.length);
    return Array.from({length: count}, (_, i) => ({key: `${set.name}:${role.name}:${i}`, label: `${role.name}${count > 1 ? ` ${i + 1}/${count}` : ''}`,
      title: `${name} · Lv ${level} · ${identified ? '🎯' : '❓'} ${role.name}`,
      content: `<div class="overview-layout">${facts(cards)}<h3>Speed estimate · before modifiers</h3><div class="stats-layout">${speedInfo}</div>
        <h3>${identified ? 'Moves' : 'Possible moves'}</h3>${moveList(moves[i] || [], 4)}</div>`,
      note: `${inference?.status === 'unmatched' ? 'Reveals do not match this snapshot; showing all candidates' : identified ? 'Role identified; unrevealed moves and items remain candidates' : 'Candidates, not confirmed'}${set.levelMismatch ? ` · snapshot level ${set.level}` : ''} · snapshot ${store.snapshot.source.updatedAt.slice(0, 10)}${count > 1 ? ' · continued role' : ''}`}));
  }));
}

// Long reference descriptions are fully retained as same-level pages.
export function textPages(text, limit = 420) {
  const pages = []; let page = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (page && page.length + word.length + 1 > limit) { pages.push(page); page = ''; }
    page += `${page ? ' ' : ''}${word}`;
  }
  if (page) pages.push(page);
  return pages.length ? pages : ['No additional description.'];
}

export function movePages(move) {
  return textPages(move.description).map((text, i, all) => ({key: `move:${i}`, label: all.length > 1 ? `Details ${i + 1}/${all.length}` : 'Details',
    content: `<div class="move-detail-layout">${facts([['Power', move.power], ['Accuracy', move.accuracy], ['PP', move.pp], ['Priority', move.priority], ['Contact', move.contact], ['Target', move.target]])}<p class="move-description">${escape(text)}</p></div>`,
    note: move.disabled ? 'Currently unavailable.' : 'Gen 9 reference values · battle effects may change power or accuracy.'}));
}
