import './styles.css';
import './battle-data.ts';
import {ShowdownSession} from './session.mjs';
import {ShowdownAuth} from './auth.mjs';
import {availableChoices} from './protocol.mjs';
import {startController, navigate} from './controller.mjs';
import {PlayerRating} from './rating.mjs';
import {Music, musicActive} from './music.js';
import {PossibleSets, possibleSets, narrowSets} from './possible-sets.mjs';
import {escapeHtml, facts, typeBadges, moveList, rolePages, movePages, itemIcon} from './info-components.mjs';
import {demoLines, demoRequest} from './demo.mjs';
import {moveInformation, effectName, knownOwnMoves, speciesInformation, stableOwnOrder} from './information.mjs';

const $ = id => document.getElementById(id);
const escape = escapeHtml;
const btn = (id, label, row, disabled = false, extra = '') => `<button id="${id}" data-nav data-row="${row}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
let arena, session, auth, config, state = {}, fixture = true, tera = false, lastRequest, selectedRequest, localNotice = '', ignoreButtons = new Set();
let diagnosticLines = [];
let ownOrder = [];
let shownTeam = 'own';
let previewIndex = null;
let teraLabel = null; // Tera button text for the active Pokémon, restored after a bench preview
let modalReturnFocus = '';
let selectedMoveId = '', infoPage = null, rating = null, ratingPage = false, fixtureTimer = false;
const modal = $('modal');
// Music is always enabled, including on devices with the old saved mute setting.
const music = new Music(undefined, {storage: null});
const sets = new PossibleSets();
const safe = fn => { try { fn(); } catch (error) { localNotice = error.message; render(); } };

function updateTimer() {
  const on = fixture ? fixtureTimer : state.timerOn;
  const seconds = session?.timerRemaining();
  $('timer-value').textContent = !on ? 'Timer off' : seconds == null ? 'Timer on' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const warning = !fixture && Date.now() < state.timerWarningUntil ? state.timerWarning : '';
  if ($('timer-warning').textContent !== warning) $('timer-warning').textContent = warning;
}

function showModal(title, content, view = '') {
  const previousFocus = modal.open ? document.activeElement?.id : '';
  if (!modal.open) modalReturnFocus = document.activeElement?.id || '';
  infoPage = null; ratingPage = false; modal.dataset.view = view;
  $('modal-title').textContent = title; $('modal-body').innerHTML = content;
  if (!modal.open) modal.showModal();
  ($(previousFocus) || $('modal-close')).focus({preventScroll: true});
  modal.scrollTop = 0;
}
function closeModal() {
  infoPage = null; ratingPage = false;
  modal.close();
  const target = $(modalReturnFocus);
  (target && !target.disabled ? target : document.querySelector('#choices button:not(:disabled)'))?.focus({preventScroll: true});
}
$('modal-close').onclick = closeModal;
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });

// The secondary controls live in the header. Select (or H) hides and shows them.
function showTools(open, focusId) {
  const tools = $('utility');
  tools.hidden = !open;
  if (!open && tools.contains(document.activeElement)) document.querySelector('#choices button:not(:disabled)')?.focus({preventScroll: true});
  if (open && focusId) $(focusId)?.focus({preventScroll: true});
}

function setup() {
  showModal('Connect your account', `<p>Sign in through Showdown. Your password stays there.</p>
    <p class="setup-origin">This origin: <code>${escape(location.origin)}</code></p>
    <label for="client-id">Public application ID</label><input id="client-id" type="text" autocomplete="off" value="${escape(auth.clientId)}" placeholder="Assigned by Pokémon Showdown">
    <p class="small">Expected account: <strong>${escape(config.username)}</strong>. Authorization is saved in this browser. No password is stored.</p>
    <div class="modal-actions">${btn('save-setup', 'Save setup', 'modal-actions')}${btn('sign-out', 'Clear saved sign-in', 'modal-actions')}</div>`);
  $('save-setup').onclick = () => {
    const value = $('client-id').value.trim();
    if (value !== auth.clientId) { auth.forget(); session.stop(); }
    auth.clientId = value; localStorage.setItem('ps-mve-client-id', value); closeModal(); render();
  };
  $('sign-out').onclick = () => { session.stop(); auth.forget(); closeModal(); localNotice = 'Saved authorization cleared from this browser.'; render(); };
}

function diagnostics() {
  showModal('Controller check', `<p>Press a button to check its mapping.</p>
    <pre id="input-log"></pre><label for="ignored-buttons">Ignore button numbers (comma separated)</label><input id="ignored-buttons" type="text" inputmode="numeric" value="${[...ignoreButtons].join(', ')}" placeholder="For example: 4, 5, 6, 7">
    <p class="small">Ignored buttons do nothing here. iPadOS shortcuts may still run.</p>${btn('save-ignored', 'Save ignored buttons', 'modal-actions')}`);
  $('input-log').textContent = diagnosticLines.join('\n') || 'Tap the page, then press a controller button.';
  $('save-ignored').onclick = () => {
    ignoreButtons = new Set($('ignored-buttons').value.split(',').filter(x => x.trim()).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x < 64));
    localStorage.setItem('ps-mve-ignored', JSON.stringify([...ignoreButtons])); closeModal();
  };
}

const currentRequest = () => fixture ? demoRequest : state.request;
// Display order: the lead first, then the rest as first seen. Each entry keeps
// serverIndex, the position in the latest request, for stats and switches.
function ownTeam() {
  const result = stableOwnOrder((fixture ? demoRequest : lastRequest)?.side?.pokemon || [], ownOrder);
  ownOrder = result.order;
  return result.team;
}
const serverIndex = index => ownTeam()[index - 1]?.serverIndex || index;
function teamSlots(side) {
  return side === 'opponent' ? arena.opponents() : Array.from({length: 6}, (_, i) => {
    const p = ownTeam()[i];
    return {index: i + 1, revealed: !!p, name: p?.details.split(',')[0] || 'Not available',
      level: Number(p?.details.match(/, L(\d+)/)?.[1] || 100), gender: p?.details.match(/, ([MF])(?:,|$)/)?.[1] || ''};
  });
}

function knownMoves(side, index) {
  if (side === 'opponent') return arena.opponents()[index - 1]?.moves || [];
  return knownOwnMoves(ownTeam()[index - 1], currentRequest()).map(move => ({...move, ...arena.moveHint(serverIndex(index), move.id, ownTeam()[index - 1]?.active && tera)}));
}

function refreshMoveHints() {
  if (!arena) return;
  const index = ownTeam().find(p => p.active)?.serverIndex || 0;
  const moves = currentRequest()?.active?.[0]?.moves || [];
  for (const [i, move] of moves.entries()) {
    const button = $(`move-${i + 1}`);
    if (!button) continue;
    const hint = arena.moveHint(index, move.id, tera);
    button.dataset.cue = hint.cue || '';
    button.title = hint.label ? `${hint.label} vs ${hint.target}. Based on known battle information.` : '';
    if (hint.type) { button.dataset.type = hint.type; button.querySelector('.move-type').textContent = hint.type; }
  }
}

function showRating(load = true, force = false) {
  if (load) void rating.load(force).then(() => {
    if (ratingPage && modal.open) showRating(false);
  });
  const value = rating.value;
  const details = rating.status === 'loading' ? '<p>Loading your public ladder rating…</p>' :
    rating.status === 'error' ? '<p>Could not load your rating. Try Refresh rating.</p>' :
    rating.status === 'unrated' ? '<p>No Gen 9 Random Battle rating was returned for this account.</p>' :
    facts([['Elo', Math.round(value.elo)], ['GXE', value.gxe === null ? 'Unknown' : `${value.gxe}%`],
      ['Wins', value.wins ?? 'Unknown'], ['Losses', value.losses ?? 'Unknown']]);
  showModal('Your rating', `<p class="info-kicker">${escape(config.username)} · Gen 9 Random Battle</p>${details}
    <p class="small">GXE: estimated win chance against an average ladder player.</p>
    ${rating.checkedAt ? `<p class="small">Last successful check: ${escape(new Date(rating.checkedAt).toLocaleString())}. Refresh after a rated battle.</p>` : ''}
    <div class="modal-actions">${btn('refresh-rating', 'Refresh rating', 'rating-actions', rating.status === 'loading')}
      <a id="rating-source" data-nav data-row="rating-actions" href="${escape(rating.url)}" target="_blank" rel="noopener noreferrer">Showdown public data</a></div>`);
  ratingPage = true;
  $('refresh-rating').onclick = () => showRating(true, true);
}

function showInfo(page) {
  let title, banner = '', pages;
  if (page.kind === 'move') {
    const current = currentRequest()?.active?.[0]?.moves?.find(m => m.id === page.id);
    const move = moveInformation(page.id, current);
    title = move.name;
    banner = `<div class="inspection-banner move-banner">${typeBadges([move.type])}<strong>${escape(move.category)}</strong></div>`;
    pages = movePages(move);
  } else {
    const slot = teamSlots(page.side)[page.index - 1];
    title = slot.revealed ? `${slot.name} · Lv ${slot.level}` : `Unknown Pokémon · slot ${page.index}`;
    if (!slot.revealed) {
      banner = `<div class="inspection-banner"><strong>${page.side === 'own' ? 'Your team' : 'Opponent'} · slot ${page.index}</strong></div>`;
      pages = [{key: 'overview', label: 'Overview', content: '<p class="empty-info">This Pokémon has not been revealed.</p>', note: 'Species, abilities, Speed and moves are unknown.'}];
    } else {
      const own = page.side === 'own', p = own ? ownTeam()[page.index - 1] : slot;
      const species = speciesInformation(slot.name);
      const inference = own ? null : narrowSets(sets.snapshot, slot.name, slot.level, slot);
      const candidates = inference?.sets || possibleSets(sets.snapshot, slot.name, slot.level);
      const abilities = [...new Set(candidates.flatMap(set => set.roles.flatMap(role => Object.keys(role.abilities))))];
      const ability = own ? effectName('abilities', p.ability || p.baseAbility) : p.ability;
      const abilityText = ability || (own ? 'Unknown' : (abilities.length ? abilities : species.abilities).join(' / ') || 'Unknown');
      const stats = own ? arena.stats(p.serverIndex) : null;
      const speed = arena.speed(page.side, own ? p.serverIndex : page.index);
      const speedLabel = speed.kind === 'estimate' ? 'Speed · estimated' : 'Speed';
      const speedInfo = `<div class="identity-speed"><small>${escape(speedLabel)}</small><strong>${escape(speed.value)}</strong>${speed.kind === 'estimate' ? '<small>before modifiers</small>' : speed.modified != null && speed.modified !== speed.value ? `<small>Current: ${escape(speed.modified)}</small>` : ''}</div>`;
      // Same reading order as the main screen: who it is, what it holds, how fast, what it can do.
      const hp = own ? arena.ownHealth(p).condition : `${p.health}${p.status ? ` · ${p.status.toUpperCase()}` : ''}`;
      banner = `<div class="inspection-banner"><div class="identity-types">${typeBadges(own ? species.types : p.types)}${inference?.identified ? '<small data-identified="true">Role identified</small>' : ''}</div>
        <div class="identity-hp"><small>${own ? 'HP' : 'Last shown HP'}</small><strong>${escape(hp)}</strong></div></div>`;
      const abilityEntry = [!own && !ability ? 'Possible abilities' : 'Ability', abilityText];
      const summary = own ? [abilityEntry, ['Item', effectName('items', p.item) || 'No item', {item: true}], ['Tera', p.teraType || 'Unknown', p.teraType]] :
        [abilityEntry, ['Item', p.item || (p.previousItem ? `Lost ${p.previousItem}` : 'Not revealed'), {item: !!p.item}],
          inference?.teraType ? ['Tera · inferred', inference.teraType, {type: inference.teraType, cue: 'green', hint: 'All remaining set definitions have this Tera type'}] : ['Tera', p.teraType || 'Not revealed', p.teraType]];
      const statCells = stats ? [...stats.entries.map(([name, value]) => [name, value]),
        ['Speed', speed.kind === 'known' && speed.modified != null && speed.modified !== speed.value ? `${speed.value} → ${speed.modified}` : speed.value]] : null;
      const moves = knownMoves(page.side, page.index);
      const count = Math.max(1, Math.ceil(moves.length / 4));
      pages = Array.from({length: count}, (_, i) => ({key: `overview:${i}`, label: count > 1 ? `Overview ${i + 1}/${count}` : 'Overview',
        content: `<div class="overview-layout">${facts(summary)}<h3>${stats?.label.startsWith('Original') ? 'Original stats · before Transform' : stats ? 'Stats (before modifiers)' : 'Speed estimate · before modifiers'}</h3>
          ${statCells ? `<div class="stats-layout">${facts(statCells)}</div>` : `<div class="stats-layout">${speedInfo}</div>`}
          <h3>${own ? 'Moves' : 'Revealed moves'}</h3>${moveList(moves.slice(i * 4, i * 4 + 4), 4)}</div>`,
        note: moves.some(m => m.copied) ? '* Copied move' : own ? '' : inference?.identified ? `Role inferred: ${inference.role}. Unrevealed moves/items remain candidates.` : inference?.status === 'unmatched' ? 'Reveals do not match this snapshot; showing all candidates.' : 'Unrevealed information stays unknown.'}));
      if (!own) pages.push(...rolePages(sets, slot.name, slot.level, speedInfo, inference));
    }
  }
  const tab = Math.max(0, Math.min(page.tab || 0, pages.length - 1));
  const current = pages[tab];
  const single = pages.length < 2;
  // Own Pokémon have one page: no tab strip, no page footer. Left/right moves between Pokémon like the roster.
  const tabs = single ? '' : `<div class="inspection-tabs" role="tablist" aria-label="Information pages">${pages.map((p, i) => `<button id="info-tab-${i}" role="tab" aria-selected="${i === tab}" aria-controls="info-content" data-info-tab="${i}">${escape(p.label)}</button>`).join('')}</div>`;
  const pagingArrows = page.kind === 'pokemon' ? ['↑', '↓'] : ['←', '→'];
  const nav = `<div class="inspection-footer">${single ? '' : `<div class="inspection-paging"><button id="prev-info-page" aria-label="Previous page">${pagingArrows[0]}</button><span>Page ${tab + 1} / ${pages.length}</span><button id="next-info-page" aria-label="Next page">${pagingArrows[1]}</button></div>`}
    ${page.kind === 'pokemon' ? '<div class="inspection-paging"><button id="prev-info-mon" aria-label="Previous Pokémon">←</button><span>Pokémon</span><button id="next-info-mon" aria-label="Next Pokémon">→</button></div>' : ''}<span><kbd>B</kbd> Close</span></div>`;
  showModal(title, `${banner}${tabs}<div id="info-content" role="tabpanel"${single ? '' : ` aria-labelledby="info-tab-${tab}"`}>${current.content}</div>${current.note ? `<p class="inspection-note">${escape(current.note)}</p>` : ''}${nav}`, page.kind);
  infoPage = {...page, tab, total: pages.length};
  for (const button of modal.querySelectorAll('[data-info-tab]')) button.onclick = () => showInfo({...infoPage, tab: Number(button.dataset.infoTab)});
  if ($('prev-info-page')) { $('prev-info-page').onclick = () => turnPage(-1); $('next-info-page').onclick = () => turnPage(1); }
  if ($('prev-info-mon')) { $('prev-info-mon').onclick = () => navigateInfo('left'); $('next-info-mon').onclick = () => navigateInfo('right'); }
  if ($('retry-sets')) {
    $('retry-sets').onclick = () => { const loading = sets.load(); showInfo(infoPage); void loading.then(refreshInformation); };
    $('retry-sets').focus({preventScroll: true});
  }
}

const turnPage = step => showInfo({...infoPage, tab: (infoPage.tab + step + infoPage.total) % infoPage.total});
// Pokémon panels follow the roster: left/right is the next Pokémon, up/down the next page.
// Move panels have no siblings, so left/right turns their pages.
// Inside a Pokémon panel the right stick means the same as on the main screen:
// the other team, same slot number. The roster row follows so B lands there.
function flipInfoTeam() {
  if (infoPage?.kind !== 'pokemon') return;
  const side = infoPage.side === 'own' ? 'opponent' : 'own';
  showTeam(side);
  // Keep the slot that opened the panel; only the team changes.
  modalReturnFocus = modalReturnFocus.replace(/^(switch|opponent)-/, `${side === 'own' ? 'switch' : 'opponent'}-`);
  showInfo({...infoPage, side, tab: 0});
}
function navigateInfo(direction) {
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  if (infoPage.kind !== 'pokemon') { if (direction === 'left' || direction === 'right') turnPage(step); return; }
  if (direction === 'up' || direction === 'down') turnPage(step);
  else showInfo({...infoPage, index: (infoPage.index - 1 + step + 6) % 6 + 1, tab: 0});
}
function refreshInformation() { if (modal.open && infoPage) showInfo(infoPage); }

function info(index) {
  if (Number.isInteger(index)) { showInfo({kind: 'pokemon', side: 'own', index}); return; }
  const focusedId = document.activeElement?.id || '';
  const slot = focusedId.match(/^(switch|opponent)-(\d+)$/);
  if (slot) { showInfo({kind: 'pokemon', side: slot[1] === 'switch' ? 'own' : 'opponent', index: Number(slot[2])}); return; }
  const moveIndex = Number(focusedId.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[moveIndex - 1];
  if (move) showInfo({kind: 'move', id: move.id});
}
document.addEventListener('focusin', event => {
  const id = event.target.id || '';
  const index = Number(id.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[index - 1];
  if (move) selectedMoveId = move.id;
  // The cursor on a bench Pokémon previews it; anywhere in the move row or header returns to the active one.
  const own = id.match(/^switch-(\d+)$/);
  if (own) setPreview(Number(own[1]));
  else if (move || event.target.closest('.moves, .app-header')) setPreview(null);
});

// Preview: which own Pokémon the move row and side panels describe. null = the active one.
function setPreview(index) {
  const next = index && !ownTeam()[index - 1]?.active ? index : null;
  if (next === previewIndex) return;
  previewIndex = next;
  renderMovePreview();
  renderMatchup();
}
function endPreview(focusTarget) {
  setPreview(null);
  if (focusTarget === 'moves') document.querySelector('#choices .moves button:not(:disabled):not([hidden])')?.focus({preventScroll: true});
  else { const active = ownTeam().findIndex(p => p.active) + 1; if (active) $(`switch-${active}`)?.focus({preventScroll: true}); }
}
// Bench preview: the focused Pokémon's four known moves, with effectiveness cues, not pressable.
function renderMovePreview() {
  const row = document.querySelector('#choices .moves');
  if (!row) return;
  for (const el of row.querySelectorAll('.move-preview')) el.remove();
  row.dataset.preview = String(!!previewIndex);
  // The Tera button follows the previewed Pokémon too, and returns to the active one's type.
  const previewed = previewIndex ? ownTeam()[previewIndex - 1] : null;
  if (previewed) { const type = previewed.terastallized || previewed.teraType || 'Unknown'; $('tera').textContent = `Tera: ${type}`; $('tera').dataset.type = type; }
  else if (teraLabel) { $('tera').textContent = teraLabel.text; $('tera').dataset.type = teraLabel.type; }
  if (!previewIndex) return;
  const moves = knownMoves('own', previewIndex);
  row.insertAdjacentHTML('afterbegin', Array.from({length: 4}, (_, i) => {
    const move = moves[i];
    if (!move) return '<div class="move-preview unknown-move" aria-hidden="true">—</div>';
    const type = move.type || window.BattleMovedex[move.id]?.type || '';
    return `<div class="move-preview" data-type="${escape(type)}" data-cue="${escape(move.cue || '')}" title="${escape(move.label || '')}" aria-hidden="true"><strong>${escape(move.name)}</strong><small><span class="move-type">${escape(type)}</span><span>${move.current ? `${escape(move.current.pp ?? '—')} / ${escape(move.current.maxpp ?? '—')} PP` : ''}</span></small></div>`;
  }).join(''));
}
// Side panels: left is the shown own Pokémon attacking their active one, right is
// their active one attacking it. ⚔️ marks the attacking column, 🛡️ the defending one.
// The panels stay in place even with no opponent on the field, so the battlefield never resizes.
function renderMatchup() {
  const left = $('matchup-own'), right = $('matchup-foe');
  if (!left || !right || !arena) return;
  const team = ownTeam();
  const index = previewIndex || team.findIndex(p => p.active) + 1;
  const pokemon = team[index - 1];
  const data = pokemon ? arena.matchup(pokemon.serverIndex, sets.snapshot) : null;
  const own = data?.own || arena.ownStats?.(pokemon?.serverIndex) || {};
  const foe = data?.foe || {};
  const box = (label, value, estimate = false) => `<div class="stat-box"><small>${escape(label)}</small><strong>${value == null ? '—' : `${estimate ? '~' : ''}${escape(value)}`}</strong></div>`;
  const badge = side => !data || data.first === 'tie' ? '<div class="speed-badge" data-first="true"><span aria-hidden="true">🐇</span>1</div>'
    : (data.first === 'own') === (side === 'own') ? '<div class="speed-badge" data-first="true"><span aria-hidden="true">🐇</span>1</div>' : '<div class="speed-badge" data-first="false"><span aria-hidden="true">🐢</span>2</div>';
  const cols = (first, second) => `<div class="matchup-cols" aria-hidden="true"><span>${first}</span><span>${second}</span></div>`;
  const name = pokemon ? pokemon.details.split(',')[0] : '—';
  left.innerHTML = `<h4>${escape(name)}</h4>${cols('⚔️', '🛡️')}
    <div class="stat-pair">${box('Atk', own.atk)}${box('Def', foe.def, true)}</div>
    <div class="stat-pair">${box('SpA', own.spa)}${box('SpD', foe.spd, true)}</div>
    <div class="stat-pair">${box('Spe', own.spe)}${data ? badge('own') : box('Spe', null)}</div>`;
  right.innerHTML = `<h4>${escape(data?.foeName || '—')}</h4>${cols('🛡️', '⚔️')}
    <div class="stat-pair">${box('Atk', foe.atk, true)}${box('Def', own.def)}</div>
    <div class="stat-pair">${box('SpA', foe.spa, true)}${box('SpD', own.spd)}</div>
    <div class="stat-pair">${box('Spe', foe.spe, true)}${data ? badge('foe') : box('Spe', null)}</div>`;
}

function renderRoster() {
  if (!$('roster')) return;
  const focusId = document.activeElement?.id;
  const request = currentRequest();
  const disabled = !fixture && (!state.authenticated || state.pending || state.recovering || state.ended || !request || request.wait);
  const choices = availableChoices(request);
  for (const rosterSide of ['own', 'opponent']) {
    const roster = $(rosterSide === 'own' ? 'roster' : 'opponent-roster');
    const team = rosterSide === 'own' ? ownTeam().map((p, i) => {
      const shown = arena.ownHealth(p);
      return {index: i + 1, serverIndex: p.serverIndex, name: p.details.split(',')[0], revealed: true, fainted: shown.fainted, active: p.active, item: p.item || '',
        ability: effectName('abilities', p.ability || p.baseAbility) || '', teraType: p.terastallized || p.teraType || '',
        percent: shown.percent, health: shown.fainted ? 'Fainted' : shown.condition, status: shown.condition.match(/ (\w{3})$/)?.[1] || '',
        canSwitch: !disabled && choices.switches.some(choice => choice.index === p.serverIndex && choice.enabled)};
    }) : arena.opponents();
    roster.innerHTML = team.map(p => {
      const inference = rosterSide === 'opponent' && p.revealed ? narrowSets(sets.snapshot, p.name, p.level, p) : null;
      // Speed and stat comparisons live in the side panels now, not on borders.
      const speed = rosterSide === 'own' ? {} : inference?.identified ? {cue: 'green', label: `Role inferred: ${inference.role}${inference.teraType ? `; Tera inferred: ${inference.teraType}` : ''}. Open details.`} : {};
      // No HP numbers or "Active" text on the roster: the bar shows HP, the
      // status tag sits on the name line, and the active Pokémon is marked by style.
      const status = p.revealed && !p.fainted ? (p.status || '').toUpperCase() : '';
      const spoken = !p.revealed ? `Slot ${p.index}` : p.fainted ? 'Fainted' : `${p.active ? 'Active, ' : ''}${p.health}`;
      const icon = p.revealed ? `<span class="picon" aria-hidden="true" style="${escape(arena.icon(p.name))}"></span>` : '<span class="unknown-pokemon" aria-hidden="true">?</span>';
      // Below the name: ability as small text, then the held item sprite and a Tera type badge.
      // Opponents show each only once revealed (or, for Tera, once inferred).
      const ability = p.revealed && !p.fainted ? p.ability || '' : '';
      const held = p.revealed && !p.fainted && p.item ? itemIcon(p.item, 'item-icon roster-item') : '';
      const teraType = p.revealed && !p.fainted ? p.teraType || inference?.teraType || '' : '';
      const teraBadge = teraType ? `<span class="type-badge roster-tera" data-type="${escape(teraType)}" title="Tera ${escape(teraType)}">${escape(teraType)}</span>` : '';
      const details = ability || held || teraBadge ? `<span class="roster-details" aria-hidden="true"><small class="roster-ability">${escape(ability)}</small><span class="roster-held">${held}${teraBadge}</span></span>` : '';
      return btn(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`, `${icon}<strong><span class="mon-name">${p.revealed ? escape(p.name) : 'Unknown'}</span>${status ? `<small class="status-tag">${escape(status)}</small>` : ''}</strong>${details}${p.percent != null ? `<span class="team-hp" aria-hidden="true" data-health="${p.percent <= 20 ? 'critical' : p.percent <= 50 ? 'low' : 'healthy'}"><span style="width:${p.percent}%"></span></span>` : ''}`, `team-${rosterSide}`, false,
        `data-unavailable="${!p.canSwitch}" data-fainted="${!!p.fainted}" data-active="${!!p.active}" data-cue="${speed.cue || ''}" title="${escape(speed.label || '')}" aria-label="${rosterSide === 'opponent' ? `Opponent slot ${p.index}, ` : ''}${escape(p.name)}, ${escape(spoken)}.${ability ? ` ${escape(ability)}.` : ''}${p.item ? ` ${escape(p.item)}.` : ''}${teraType ? ` Tera ${escape(teraType)}.` : ''} ${escape(speed.label || '')} ${p.canSwitch ? 'Switch Pokémon' : 'View details'}"`);
    }).join('');
    for (const p of team) $(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`).onclick = () => {
      if (rosterSide === 'opponent') showInfo({kind: 'pokemon', side: 'opponent', index: p.index});
      else if (p.canSwitch) choose('switch', p.serverIndex);
      else info(p.index);
    };
  }
  if (!modal.open && focusId) $(focusId)?.focus({preventScroll: true});
  renderMatchup();
}

// One team row shows at a time; the right stick (or F) flips between them.
// Focus carries over to the same slot so the cursor does not vanish.
function showTeam(side = shownTeam === 'own' ? 'opponent' : 'own') {
  shownTeam = side;
  const focused = document.activeElement?.id.match(/^(switch|opponent)-(\d+)$/);
  for (const row of document.querySelectorAll('.team-row')) row.hidden = row.dataset.side !== side;
  if (focused) $(`${side === 'own' ? 'switch' : 'opponent'}-${focused[2]}`)?.focus({preventScroll: true});
  arena?.resize();
}

function forfeit() {
  if (fixture) { localNotice = 'Start opens a forfeit confirmation during a live battle.'; render(); return; }
  if (!state.room || state.ended) return;
  showModal('Forfeit this battle?', `<p>This counts as a loss on Showdown.</p><div class="modal-actions">${btn('keep-playing', 'Keep playing', 'modal-actions')}${btn('confirm-forfeit', 'Forfeit battle', 'modal-actions', false, 'class="danger"')}</div>`);
  $('keep-playing').onclick = () => closeModal();
  $('confirm-forfeit').onclick = () => safe(() => { session.roomCommand('/forfeit'); closeModal(); });
  $('keep-playing').focus();
}

function choose(kind, index) {
  if (fixture) {
    const name = kind === 'move' ? demoRequest.active[0].moves[index - 1].move : demoRequest.side.pokemon[index - 1].details.split(',')[0];
    localNotice = `${name}${tera && kind === 'move' ? ' + Tera' : ''} selected. Offline preview; nothing was sent.`;
    render(); return;
  }
  safe(() => {
    localNotice = ''; session.choose(kind, index, kind === 'move' && tera);
    if (!$('undo').hidden && !$('undo').disabled) $('undo').focus({preventScroll: true});
  });
}

function render() {
  const focusId = document.activeElement?.id;
  const request = fixture ? demoRequest : state.request;
  if (request?.side) lastRequest = request;
  if (request !== selectedRequest) { selectedRequest = request; tera = false; }
  const choices = availableChoices(request);
  const disabled = !fixture && (!state.authenticated || state.pending || state.recovering || state.ended || !request || request.wait);
  const activePokemon = request?.side?.pokemon?.find(p => p.active) || lastRequest?.side?.pokemon?.find(p => p.active);
  const teraType = request?.active?.[0]?.canTerastallize || activePokemon?.teraType || 'Unknown';
  $('tera').hidden = !activePokemon;
  $('tera').disabled = disabled || !choices.tera;
  $('tera').textContent = `Tera: ${teraType}${activePokemon?.terastallized ? ' · active' : tera ? ' · selected' : ''}`;
  $('tera').dataset.type = teraType;
  teraLabel = {text: $('tera').textContent, type: teraType};
  $('tera').setAttribute('aria-pressed', String(tera));
  $('tera').title = choices.tera ? 'Toggle Terastallize for your next move (X)' : 'This Pokémon’s Tera type; Terastallize is unavailable right now.';
  const canCancel = !fixture && state.pending && request && !request.noCancel && state.authenticated && !state.recovering && !state.ended;
  $('undo').hidden = !canCancel;
  $('undo').disabled = !canCancel;
  $('arena-wrap').dataset.room = state.room || '';
  // The heading row is gone; the few states worth words share the notice strip.
  const prompt = fixture || state.ended ? '' : state.recovering ? 'Restoring your battle…' : state.pending || request?.wait ? 'Waiting for the next turn' : request?.forceSwitch ? 'Choose a Pokémon' : activePokemon ? '' : state.searching ? 'Finding an opponent…' : '';
  const redundantNotice = state.ended && /won the battle\.$|ended in a tie\.$/.test(state.notice || '') || state.notice === 'Choice sent. Waiting for the server.';
  $('notice').textContent = localNotice || (!redundantNotice && state.notice) || (!fixture && !state.authenticated ? state.status : prompt);
  $('notice').parentElement.hidden = !$('notice').textContent;
  const primary = $('primary');
  primary.disabled = false;
  primary.textContent = fixture || session?.stopped ? 'Connect to Showdown' : !state.authenticated ? 'Sign in with Showdown' : state.searching ? 'Cancel search' : 'Find Random Battle';
  if (!fixture && !session?.stopped) primary.disabled = !state.authenticated ? !state.challenge : !!state.room && !state.ended;
  $('action-slots').append($('tera'), $('undo'));
  $('choices').innerHTML = `<div class="moves" role="group" aria-label="Moves">${choices.moves.map(move => {
    const type = window.BattleMovedex[move.id]?.type || '';
    return btn(`move-${move.index}`, `<strong>${escape(move.move)}</strong><small><span class="move-type">${escape(type)}</span><span>${escape(move.pp ?? '—')} / ${escape(move.maxpp ?? '—')} PP</span></small>`, 'moves', disabled || !move.enabled, `data-type="${escape(type)}" aria-description="R3 or I for move information"`);
  }).join('')}</div>
    <div class="team-row" data-side="own" ${shownTeam === 'own' ? '' : 'hidden'}><span class="team-label">You</span><div id="roster" class="team" role="group" aria-label="Your six Pokémon"></div></div>
    <div class="team-row" data-side="opponent" ${shownTeam === 'opponent' ? '' : 'hidden'}><span class="team-label">Foe</span><div id="opponent-roster" class="team" role="group" aria-label="Opponent’s six Pokémon"></div></div>`;
  // Tera and Cancel keep their nodes and handlers; they sit at the end of the move row.
  $('choices').querySelector('.moves').append($('tera'), $('undo'));
  renderRoster();
  refreshMoveHints();
  renderMovePreview();
  const inBattle = fixture || !!state.room && !state.ended;
  $('utility').innerHTML = `
    ${btn('timer-toggle', `Timer: ${(fixture ? fixtureTimer : state.timerOn) ? 'on' : 'off'}`, 'header', !inBattle || !fixture && (!state.authenticated || state.recovering || state.timerPending), `aria-pressed="${!!(fixture ? fixtureTimer : state.timerOn)}"`)}
    ${btn('rating', 'Rating', 'header')}${btn('forfeit', 'Forfeit…', 'header', !inBattle || !fixture && !state.authenticated)}
    ${state.ended ? btn('replay', 'Replay', 'header') : ''}${btn('setup', 'Setup', 'header')}${btn('diagnostics', 'Controller check', 'header')}
    <a id="source" data-nav data-row="header" href="./source.zip" download>Source</a>`;
  for (const move of choices.moves) $(`move-${move.index}`).onclick = () => choose('move', move.index);
  $('tera').onclick = () => { tera = !tera; render(); };
  $('undo').onclick = () => safe(() => {
    localNotice = ''; session.undo();
    const previous = choices.moves.find(move => move.id === selectedMoveId && move.enabled) || choices.moves.find(move => move.enabled);
    if (previous) $(`move-${previous.index}`)?.focus({preventScroll: true});
  });
  $('rating').onclick = () => showRating();
  $('forfeit').onclick = forfeit;
  $('setup').onclick = setup; $('diagnostics').onclick = diagnostics;
  $('timer-toggle').onclick = () => fixture ? (fixtureTimer = !fixtureTimer, render()) : safe(() => session.toggleTimer());
  if ($('replay')) $('replay').onclick = () => arena.replay();
  updateTimer();
  arena?.resize();
  if (modal.open && infoPage) showInfo(infoPage);
  if (focusId && !modal.open) { const target = $(focusId); if (target && !target.disabled) target.focus({preventScroll: true}); }
}

function startLive() {
  fixture = false; localNotice = ''; lastRequest = null; ownOrder = []; selectedMoveId = '';
  arena.reset('battle-gen9randombattle-0');
  session.connect();
}
$('primary').onclick = () => safe(() => {
  localNotice = '';
  if (fixture || session.stopped) { startLive(); return; }
  if (!state.authenticated) { if (!auth.clientId) setup(); else void session.login(true); }
  else if (state.searching) session.cancelSearch();
  else session.search();
});
document.addEventListener('pointerdown', () => music.unlock(), {passive: true});
document.addEventListener('keydown', event => { if (!event.repeat && event.isTrusted) music.unlock(); });

async function init() {
  config = await fetch('./config.json', {cache: 'no-store'}).then(response => response.json());
  rating = new PlayerRating(config.username);
  auth = new ShowdownAuth(localStorage.getItem('ps-mve-client-id') || config.clientId);
  try { ignoreButtons = new Set(JSON.parse(localStorage.getItem('ps-mve-ignored') || '[]')); } catch {}
  const {Arena} = await import('./renderer.js');
  arena = new Arena($('arena'), $('hidden-log'), () => {
    renderRoster();
    refreshMoveHints();
    refreshInformation();
  });
  arena.setFit('wide');
  arena.receive({room: 'battle-gen9randombattle-0', lines: demoLines, snapshot: true, request: demoRequest});
  session = new ShowdownSession({url: config.server, username: config.username, auth, storage: localStorage,
    onState(next) { if (state.room && !next.room) { lastRequest = null; ownOrder = []; } state = next; music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped})); render(); },
    onBattle(packet) { try {
      if (arena.room !== packet.room) { lastRequest = null; ownOrder = []; if (modal.open && infoPage) closeModal(); }
      arena.receive(packet);
    } catch { localNotice = 'The battle display encountered an error. Controls still use the server request; reload to rebuild the display.'; } },
  });
  state = session.state;
  render();
  setInterval(updateTimer, 1000);
  void sets.load().then(() => { renderRoster(); refreshInformation(); });
  startController({ignored: () => ignoreButtons, diagnostic(line) {
    diagnosticLines = [...diagnosticLines.slice(-2), line];
    if ($('input-log')) $('input-log').textContent = diagnosticLines.join('\n');
  }, action(action) {
    if (['up', 'down', 'left', 'right'].includes(action)) {
      if (modal.open && infoPage) { navigateInfo(action); return; }
      // Up from a previewed bench Pokémon goes back to the active Pokémon's real moves.
      if (action === 'up' && previewIndex && /^switch-\d+$/.test(document.activeElement?.id || '')) { endPreview('moves'); return; }
      navigate(action); return;
    }
    if (action === 'cancel') {
      if (modal.open) closeModal();
      else if (previewIndex) endPreview('active');
      else $('undo')?.click();
      return;
    }
    if (action === 'team' && modal.open) { flipInfoTeam(); return; }
    if (action === 'confirm') {
      if (document.activeElement?.matches('[data-nav], [data-info-tab], .inspection-footer button')) document.activeElement.click();
      else navigate('right');
      return;
    }
    if (modal.open) return;
    ({tera: () => $('tera')?.click(), timer: () => showTools(true, 'timer-toggle'), menu: forfeit, info, team: () => showTeam(),
      tools: () => showTools($('utility').hidden)})[action]?.();
  }});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { music.update(false); return; }
    if (!fixture && !session.stopped && Date.now() - session.lastMessage > 30000) session.connect();
    music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped}));
  });
}
init().catch(error => { $('notice').textContent = error.message; $('notice').parentElement.hidden = false; });
