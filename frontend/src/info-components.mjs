import {moveInformation} from './information.mjs';
import {possibleSets, percent, SET_SOURCE} from './possible-sets.mjs';

export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const escape = escapeHtml;

// Information-only buttons: these components have no access to session.choose.
export function moveCards(moves, {prefix, origin = 'known', side = 'own', index = 0} = {}) {
  return `<div class="info-moves" role="group" aria-label="${origin === 'possible' ? 'Possible move information' : 'Known move information'}">${moves.map((m, i) => {
    const move = moveInformation(m.id, origin === 'possible' ? undefined : m.current);
    return `<button id="${prefix}-${i + 1}" data-nav data-row="${prefix}-${Math.floor(i / 2)}" class="move-card"
      data-info-move="${escape(m.id)}" data-origin="${origin}" data-side="${side}" data-index="${index}">
      <strong>${escape(move.name)}${m.copied ? ' (copied)' : ''}</strong>
      <small>${escape(move.type)} · ${escape(move.category)}${m.frequency != null ? ` · ${percent(m.frequency)}` : ''}</small>
      <span class="move-metrics">Power ${escape(move.power)} · Accuracy ${escape(move.accuracy)} · ${escape(move.pp)}${origin !== 'possible' && m.current ? ' PP' : ''}</span>
      <span class="move-summary">${escape(move.summary)}</span></button>`;
  }).join('')}</div>`;
}

export function setStatus(store) {
  if (store.status === 'error') return '<p>Possible sets are unavailable. Known and revealed moves still work.</p><button id="retry-sets" data-nav data-row="retry-sets">Retry set data</button>';
  if (!store.snapshot) return '<p>Loading possible sets…</p>';
  const source = store.snapshot.source;
  return `<p class="small set-source">Source: <a id="set-source-link" data-nav data-row="set-source" href="${SET_SOURCE}/tree/${source.commit}" target="_blank" rel="noopener noreferrer">pkmn/randbats</a> · Gen 9 Random Battle · Snapshot ${escape(source.updatedAt.slice(0, 10))} (UTC).
    Bundled snapshot; live sets may have changed.</p>`;
}

const frequencies = values => values ? Object.entries(values).map(([name, weight]) =>
  `<span>${escape(name)} <small>${percent(weight)}</small></span>`).join(' · ') : 'No item';

export function setSection(store, name, level, context) {
  const sets = possibleSets(store.snapshot, name, level);
  return `<section class="possible-sets" aria-label="Possible sets"><h3>Possible sets</h3>
    <p class="small">Candidates for the displayed species, not its actual set. Role percentages are shares of simulated sets for that form; option percentages are frequencies within that role. Moves can occur together, so their percentages need not total 100%. These are not adjusted by revealed information. Illusion or Transform may make the displayed species misleading.</p>
    ${setStatus(store)}${store.snapshot && !sets.length ? '<p>No matching set data for this species or form.</p>' : ''}
    ${sets.map((set, s) => `<div class="set-form"><h4>${escape(set.name)} · dataset level ${set.level}</h4>
      ${set.levelMismatch ? '<p class="small">The displayed level differs from this snapshot; balance or form data may have changed.</p>' : ''}
      ${set.roles.map((role, r) => `<article class="set-role"><h4>${escape(role.name)} <small>${percent(role.weight)} of simulated sets</small></h4>
        <dl class="set-options"><dt>Abilities</dt><dd>${frequencies(role.abilities)}</dd><dt>Items</dt><dd>${frequencies(role.items)}</dd><dt>Tera types</dt><dd>${frequencies(role.teraTypes)}</dd></dl>
        <h5>Possible moves · within this role</h5>${moveCards(Object.entries(role.moves).map(([name, frequency]) => ({id: moveInformation(name).id, frequency})),
          {...context, prefix: `set-${s}-${r}`, origin: 'possible'})}</article>`).join('')}</div>`).join('')}</section>`;
}
