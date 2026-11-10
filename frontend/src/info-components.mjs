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

// These are deliberately static entries, never controls that open child menus.
export function moveList(moves, placeholders = 0) {
  const entries = moves.map(m => {
    const move = moveInformation(m.id);
    const type = m.type || move.type;
    return `<li class="compact-move" data-move="${escape(move.id)}" data-type="${escape(type)}" data-cue="${escape(m.cue || '')}" data-revealed="${!!m.revealed}" title="${escape(m.label || (m.revealed ? 'Revealed in battle' : ''))}"><strong>${escape(move.name)}${m.copied ? ' *' : ''}</strong>${typeBadges([type])}</li>`;
  });
  while (entries.length < placeholders) entries.push('<li class="compact-move unknown-move">Not revealed</li>');
  // Four to a row, like the battle screen's move row. A longer list wraps onto further rows; the last row may end early.
  return `<ul class="compact-moves">${entries.join('')}</ul>`;
}

// Pages have bounded row counts. New/expanded datasets get sibling continuation
// pages instead of unbounded cards or a second menu level.
// Opponent pages use the same layout as the own-Pokémon page: three fact cards, a stats block, a
// move list. known: what the battle has revealed ({ability, item, previousItem, teraType, inferredTera}); a card
// shows the revealed fact, otherwise that role's possibilities. revealed: move ids seen in battle.
// split: how many roles each page holds, e.g. [2, 1]. Left out, every role sits on one page. Page 1 carries the
// fact cards and stats; later pages hold roles only.
export function rolePages(store, name, level, statsInfo = '', inference, {known = {}, revealed = new Set(), split} = {}) {
  if (!store.snapshot) return [{key: 'sets-status', label: 'Possible sets', content: store.status === 'error' ?
    '<p>Possible sets could not load.</p><button id="retry-sets" data-nav data-row="retry-sets">Retry set data</button>' : '<p>Loading possible sets…</p>', note: 'Known and revealed information still works.'}];
  const sets = inference?.sets || possibleSets(store.snapshot, name, level);
  if (!sets.length) return [{key: 'sets-missing', label: 'Possible sets', content: '<p>No matching set data.</p>', note: 'This species or form is absent from the snapshot.'}];
  const identified = !!inference?.identified;
  const roles = sets.flatMap(set => set.roles.map(role => ({set, role})));
  const union = field => [...new Set(roles.flatMap(({role}) => Object.keys(role[field] || {})))];
  const abilities = union('abilities'), items = roles.some(({role}) => role.items) ? union('items') : ['No item'], tera = union('teraTypes');
  const cards = [
    known.ability ? ['Ability', known.ability] : ['Ability', abilities.join(' / ') || 'Unknown', {list: true}],
    known.item ? ['Item', known.item, {item: true}] : known.previousItem ? ['Item', `Lost ${known.previousItem}`] : ['Item', items.join(' / '), {list: true}],
    known.teraType ? ['Tera', known.teraType, known.teraType] : known.inferredTera ? ['Tera', known.inferredTera, {type: known.inferredTera, cue: 'green', hint: 'All remaining set definitions have this Tera type'}] : ['Tera', tera.join(' / ') || 'Unknown', {list: true}]];
  // One page: every candidate role as a heading above its moves, four to a row, seen moves first.
  // Roles share one move order: seen moves first, then moves common to the most roles, then the
  // rest, so a move that several roles share sits in the same column of every row, from the left.
  const roleCount = new Map();
  for (const {role} of roles) for (const name of Object.keys(role.moves)) { const id = moveInformation(name).id; roleCount.set(id, (roleCount.get(id) || 0) + 1); }
  const rank = move => [Number(!move.revealed), -(roleCount.get(move.id) || 0)];
  const order = (a, b) => { const [ra, rb] = [rank(a), rank(b)]; return ra[0] - rb[0] || ra[1] - rb[1] || a.id.localeCompare(b.id); };
  const groups = roles.map(({set, role}) => {
    const moves = Object.keys(role.moves).map(name => { const id = moveInformation(name).id; return {id, revealed: revealed.has(id)}; }).sort(order);
    return `<div class="role-group"><h3 class="role-heading">${escape(role.name)}${set.levelMismatch ? `<small>snapshot level ${escape(set.level)}</small>` : ''}</h3>${moveList(moves)}</div>`;
  });
  const title = identified ? `${name} · Lv ${level} · ✅ ${roles[0]?.role.name || ''}` : `${name} · Lv ${level} · ❓ ${roles.length === 1 ? roles[0].role.name : `${roles.length} possible roles`}`;
  const note = `${inference?.status === 'unmatched' ? 'Reveals do not match this snapshot; showing all candidates' : identified ? 'Role identified; unrevealed moves and items remain candidates' : 'Candidates, not confirmed'} · snapshot ${store.snapshot.source.updatedAt.slice(0, 10)}`;
  const counts = split?.length ? split : [groups.length];
  let start = 0;
  return counts.map((count, i) => {
    const shown = groups.slice(start, start + count); start += count;
    return {key: `roles:${i}`, label: counts.length > 1 ? `Roles ${i + 1}/${counts.length}` : 'Roles', title,
      content: `<div class="overview-layout" data-roles="${roles.length}">${i === 0 ? `${facts(cards)}<h3>Stats (before modifiers)</h3>${statsInfo}` : ''}${shown.join('')}</div>`, note};
  });
}
// Roles that do not fit on the page move to further pages. `content` is the live page area holding the facts,
// the stats and every role; the result says how many roles each page holds. Page 1 keeps the facts and stats.
export function roleSplit(content) {
  const groups = [...content.querySelectorAll('.role-group')];
  const height = content.clientHeight, top = content.getBoundingClientRect().top;
  const box = groups.map(group => { const rect = group.getBoundingClientRect(); return {top: rect.top - top, bottom: rect.bottom - top}; });
  const split = []; let count = 0, pageTop = 0;
  box.forEach((group, i) => {
    // A role starts a new page when it would run past the bottom. Page 1 may hold the facts and stats alone.
    if (group.bottom - pageTop > height && (count > 0 || split.length === 0)) { split.push(count); count = 0; pageTop = group.top; }
    count++;
  });
  split.push(count);
  return split;
}

// Long reference descriptions are fully retained as same-level pages.
export function movePages(move) {
  // One page per move: the whole description first, then two rows of three fact boxes in the stat-box style, each led by its emoji.
  return [{key: 'move', label: 'Details',
    content: `<div class="move-detail-layout"><p class="move-description">${escape(move.description)}</p>${facts([['💥 Power', move.power], ['🎯 Accuracy', move.accuracy], ['🔋 PP', move.pp], ['🏃 Priority', move.priority], ['🥊 Contact', move.contact], ['👥 Target', move.target]])}</div>`,
    note: move.disabled ? 'Currently unavailable.' : ''}];
}
// The whole description stays on the one page: a long one steps its text size down until the page stops overflowing.
export function fitMoveDescription(content) {
  const description = content?.querySelector('.move-description');
  if (!description) return;
  description.style.removeProperty('font-size');
  let size = parseFloat(getComputedStyle(description).fontSize);
  while (size > 1 && content.scrollHeight > content.clientHeight) { size -= 1; description.style.fontSize = `${size}px`; }
}
