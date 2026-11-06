import {moveInformation} from './information.mjs';
import {possibleSets, percent} from './possible-sets.mjs';

export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const escape = escapeHtml;
export const facts = entries => `<dl class="info-facts">${entries.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
export const typeBadges = types => types.map(type => `<span class="type-badge" data-type="${escape(type)}">${escape(type)}</span>`).join('');
const chunks = (values, size) => Array.from({length: Math.ceil(values.length / size)}, (_, i) => values.slice(i * size, (i + 1) * size));

// These are deliberately static entries, never controls that open child menus.
export function moveList(moves, placeholders = 0) {
  const entries = moves.map(m => {
    const move = moveInformation(m.id);
    return `<li class="compact-move" data-move="${escape(move.id)}" data-type="${escape(move.type)}"><strong>${escape(move.name)}${m.copied ? ' *' : ''}</strong>${typeBadges([move.type])}</li>`;
  });
  while (entries.length < placeholders) entries.push('<li class="compact-move unknown-move">Not revealed</li>');
  return `<ul class="compact-moves">${entries.join('')}</ul>`;
}

// Pages have bounded row counts. New/expanded datasets get sibling continuation
// pages instead of unbounded cards or a second menu level.
export function rolePages(store, name, level) {
  if (!store.snapshot) return [{key: 'sets-status', label: 'Possible sets', content: store.status === 'error' ?
    '<p>Possible sets could not load.</p><button id="retry-sets" data-nav data-row="retry-sets">Retry set data</button>' : '<p>Loading possible sets…</p>', note: 'Known and revealed information still works.'}];
  const sets = possibleSets(store.snapshot, name, level);
  if (!sets.length) return [{key: 'sets-missing', label: 'Possible sets', content: '<p>No matching set data.</p>', note: 'This species or form is absent from the snapshot.'}];
  const options = (label, values, typed = false) => `<div><dt>${label}</dt><dd>${values.length ? (typed ? typeBadges(values) : values.map(name => `<span class="option-chip">${escape(name)}</span>`).join('')) : '—'}</dd></div>`;
  return sets.flatMap(set => set.roles.flatMap(role => {
    const moves = chunks(Object.keys(role.moves).map(name => ({id: moveInformation(name).id})), 10);
    const abilities = chunks(Object.keys(role.abilities), 3), items = chunks(Object.keys(role.items || {'No item': 1}), 6), tera = chunks(Object.keys(role.teraTypes), 8);
    const count = Math.max(moves.length, abilities.length, items.length, tera.length);
    return Array.from({length: count}, (_, i) => ({key: `${set.name}:${role.name}:${i}`, label: `${role.name}${count > 1 ? ` ${i + 1}/${count}` : ''}`,
      content: `<div class="role-heading"><strong>${escape(set.name)} · ${escape(percent(role.weight))}</strong><span>Possible role${set.levelMismatch ? ` · snapshot level ${set.level}` : ''}</span></div>
        <div class="role-layout"><dl class="role-options">${options('Abilities', abilities[i] || abilities[0])}${options('Items', items[i] || items[0])}${options('Tera types', tera[i] || tera[0], true)}</dl>
        <section aria-label="Possible moves">${moveList(moves[i] || [])}</section></div>`,
      note: `Candidates, not confirmed · snapshot ${store.snapshot.source.updatedAt.slice(0, 10)}${count > 1 ? ' · continued role' : ''}`}));
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
