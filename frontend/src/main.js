import './styles.css';
import './battle-data.ts';
import {ShowdownSession} from './session.mjs';
import {ShowdownAuth} from './auth.mjs';
import {availableChoices} from './protocol.mjs';
import {startController, navigate} from './controller.mjs';
import {PlayerRating} from './rating.mjs';
import {Music, musicActive} from './music.js';
import {PossibleSets, possibleSets, narrowSets} from './possible-sets.mjs';
import {escapeHtml, facts, typeBadges, moveList, rolePages, movePages, itemIcon, regionalForm} from './info-components.mjs';
import {demoLines, demoRequest} from './demo.mjs';
import {moveInformation, effectName, knownOwnMoves, speciesInformation, stableOwnOrder} from './information.mjs';

const $ = id => document.getElementById(id);
const escape = escapeHtml;
// Species name with a small region tag for regional forms.
const nameTag = (name, tagClass = 'form-tag') => { const form = regionalForm(name); return `<span class="mon-name">${escapeHtml(form.base)}</span>${form.region ? `<small class="${tagClass}">${escapeHtml(form.region.toUpperCase())}</small>` : ''}`; };
const btn = (id, label, row, disabled = false, extra = '') => `<button id="${id}" data-nav data-row="${row}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
let arena, session, auth, config, state = {}, fixture = true, tera = false, lastRequest, lastMovesRequest, selectedRequest, localNotice = '', ignoreButtons = new Set();
let diagnosticLines = [];
let ownOrder = [];
let shownTeam = 'own';
let previewIndex = null;
let foePreviewIndex = null; // opponent roster slot under the cursor; the panels compare against it instead of their active Pokémon
let teraLabel = null; // Tera button text for the active Pokémon, restored after a bench preview
let modalReturnFocus = '';
let selectedMoveId = '', infoPage = null, rating = null, ratingPage = false, autoTimerRoom = '';
const modal = $('modal');
// Music is always enabled, including on devices with the old saved mute setting.
const music = new Music(undefined, {storage: null});
const sets = new PossibleSets();
const safe = fn => { try { fn(); } catch (error) { localNotice = error.message; render(); } };

function updateTimer() {
  const on = fixture || state.timerOn;
  const seconds = session?.timerRemaining();
  const clock = value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  $('timer-value').textContent = !on ? 'Timer off' : seconds == null ? 'Timer on' : clock(seconds);
  // The opponent's clock is only known from server warnings; it shows the last warned value, not a countdown.
  $('foe-timer-value').textContent = on && state.foeTimerSeconds != null ? clock(state.foeTimerSeconds) : '—';
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

// Chat: a modal that shows one turn of Showdown's battle log at a time. Showdown writes the whole
// log into #hidden-log; each turn starts with an <h2 class="battle-history">Turn N</h2> heading.
let chatTurn = null; // index of the shown turn; null = the latest turn
function chatTurns() {
  const turns = [[]];
  for (const node of $('hidden-log').querySelectorAll('.inner > *')) { if (node.tagName === 'H2') turns.push([]); turns.at(-1).push(node); }
  return turns.filter(turn => turn.length);
}
function showChat(step = 0) {
  const turns = chatTurns();
  const latest = Math.max(0, turns.length - 1);
  // The current turn has nothing in it yet, so the chat opens on the last turn that has lines.
  const hasLines = turn => turn.some(node => node.tagName !== 'H2');
  const opening = chatTurn ?? Math.max(0, turns.findLastIndex(hasLines));
  const index = Math.min(Math.max(opening + step, 0), latest);
  chatTurn = index;
  const turn = turns[index] || [];
  const title = turn[0]?.tagName === 'H2' ? turn[0].textContent : 'Battle start';
  const lines = turn.filter(node => node.tagName !== 'H2').map(node => node.outerHTML).join('');
  showModal(title, `<div class="chat-turn">${lines || '<p class="small">Nothing happened yet.</p>'}</div>`, 'chat');
}
// New log lines while the chat is open re-render the shown turn but never move it. Showdown
// appends lines as the animation plays, after the arena callback, so the log element is watched.
let chatRefreshQueued = false;
function refreshChat() {
  if (!modal.open || modal.dataset.view !== 'chat' || chatRefreshQueued) return;
  chatRefreshQueued = true;
  requestAnimationFrame(() => { chatRefreshQueued = false; if (modal.open && modal.dataset.view === 'chat') showChat(); });
}
new MutationObserver(refreshChat).observe($('hidden-log'), {childList: true, subtree: true});
// Menu: Select (or H) opens the secondary controls in a modal. There is no header row.
function showMenu() {
  const reopen = modal.open && modal.dataset.view === 'menu';
  // Two rows of three so the d-pad moves between rows instead of jumping to the close button.
  showModal('Menu', `<div class="menu-grid">${btn('chat', 'Chat', 'menu-1')}${btn('rating', 'Rating', 'menu-1')}${btn('open-replay', 'Open replay', 'menu-1', !state.replayUrl)}
    ${btn('setup', 'Setup', 'menu-2')}${btn('diagnostics', 'Controller check', 'menu-2')}${btn('source', 'Source', 'menu-2')}</div>`, 'menu');
  $('chat').onclick = () => { chatTurn = null; showChat(); };
  $('rating').onclick = () => showRating();
  $('setup').onclick = setup; $('diagnostics').onclick = diagnostics;
  $('open-replay').onclick = () => { if (state.replayUrl) window.open(state.replayUrl, '_blank', 'noopener'); };
  $('source').onclick = () => { const link = document.createElement('a'); link.href = './source.zip'; link.download = ''; link.click(); };
  if (!reopen) $('chat').focus({preventScroll: true});
}
// Start (9) opens the battle menu: sign in / find a battle / cancel the search, and Forfeit.
let searchAfterLogin = false;
function showBattleMenu() {
  const reopen = modal.open && modal.dataset.view === 'battle';
  const inBattle = fixture || !!state.room && !state.ended;
  const primaryLabel = fixture || session?.stopped ? 'Connect to Showdown' : !state.authenticated ? 'Sign in with Showdown' : state.searching ? 'Cancel search' : 'Find Random Battle';
  const primaryDisabled = !fixture && !session?.stopped && (!state.authenticated ? !state.challenge : !!state.room && !state.ended);
  showModal('Battle', `<div class="menu-grid battle-grid">${btn('primary', primaryLabel, 'menu-1', primaryDisabled, 'class="primary"')}${btn('forfeit', 'Forfeit…', 'menu-1', !inBattle || !fixture && !state.authenticated)}</div>`, 'battle');
  $('primary').onclick = () => safe(() => {
    localNotice = ''; closeModal();
    // Connecting or signing in from the menu searches for a battle as soon as Showdown confirms the login.
    if (fixture || session.stopped) { searchAfterLogin = true; startLive(); return; }
    if (!state.authenticated) { if (!auth.clientId) setup(); else { searchAfterLogin = true; void session.login(true); } }
    else if (state.searching) session.cancelSearch();
    else session.search();
  });
  $('forfeit').onclick = forfeit;
  if (!reopen) $('primary').focus({preventScroll: true});
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
// Set inference is pure in the slot's revealed facts, and the roster re-renders several times a
// second during animations, so each opponent's result is cached until one of those facts changes.
const inferenceCache = new Map(); let inferenceSnapshot = null;
function inferSets(slot) {
  if (inferenceSnapshot !== sets.snapshot) { inferenceCache.clear(); inferenceSnapshot = sets.snapshot; }
  const key = JSON.stringify([slot.name, slot.level, !!slot.transformed, slot.baseAbility || '', slot.teraType || '',
    (slot.moves || []).map(move => [move.id || move.name, !!move.copied])]);
  if (!inferenceCache.has(key)) inferenceCache.set(key, narrowSets(sets.snapshot, slot.name, slot.level, slot));
  return inferenceCache.get(key);
}
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
      const inference = own ? null : inferSets(slot);
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
      banner = `<div class="inspection-banner"><div class="identity-types">${typeBadges(own ? species.types : p.types)}</div>
        <div class="identity-hp"><small>${own ? 'HP' : 'Last shown HP'}</small><strong>${escape(hp)}</strong></div></div>`;
      const abilityEntry = [!own && !ability ? 'Possible abilities' : 'Ability', abilityText];
      const summary = own ? [abilityEntry, ['Item', effectName('items', p.item) || 'No item', {item: true}], ['Tera', p.teraType || 'Unknown', p.teraType]] :
        [abilityEntry, ['Item', p.item || (p.previousItem ? `Lost ${p.previousItem}` : 'Not revealed'), {item: !!p.item}],
          inference?.teraType ? ['Tera · inferred', inference.teraType, {type: inference.teraType, cue: 'green', hint: 'All remaining set definitions have this Tera type'}] : ['Tera', p.teraType || 'Not revealed', p.teraType]];
      // Opponent pages show the same five stat boxes as the own page, estimated (~) from base stats and level.
      const foeStats = own ? null : arena.foeStats(page.index);
      const statCells = stats ? [...stats.entries.map(([name, value]) => [name, value]),
        ['Speed', speed.kind === 'known' && speed.modified != null && speed.modified !== speed.value ? `${speed.value} → ${speed.modified}` : speed.value]] :
        foeStats ? [['Attack', `~${foeStats.atk}`], ['Defense', `~${foeStats.def}`], ['Sp. Atk', `~${foeStats.spa}`], ['Sp. Def', `~${foeStats.spd}`], ['Speed', speed.kind === 'estimate' ? `~${speed.value}` : speed.value]] : null;
      const moves = knownMoves(page.side, page.index);
      const count = Math.max(1, Math.ceil(moves.length / 4));
      pages = Array.from({length: count}, (_, i) => ({key: `overview:${i}`, label: count > 1 ? `Overview ${i + 1}/${count}` : 'Overview',
        content: `<div class="overview-layout">${facts(summary)}<h3>${stats?.label.startsWith('Original') ? 'Original stats · before Transform' : stats ? 'Stats (before modifiers)' : 'Speed estimate · before modifiers'}</h3>
          ${statCells ? `<div class="stats-layout">${facts(statCells)}</div>` : `<div class="stats-layout">${speedInfo}</div>`}
          <h3>${own ? 'Moves' : 'Revealed moves'}</h3>${moveList(moves.slice(i * 4, i * 4 + 4), 4)}</div>`,
        note: moves.some(m => m.copied) ? '* Copied move' : own ? '' : inference?.identified ? `Role inferred: ${inference.role}. Unrevealed moves/items remain candidates.` : inference?.status === 'unmatched' ? 'Reveals do not match this snapshot; showing all candidates.' : 'Unrevealed information stays unknown.'}));
      // Opponents get one page per role: revealed facts on top, that role's possible sets below, revealed moves highlighted.
      if (!own) pages = rolePages(sets, slot.name, slot.level, statCells ? `<div class="stats-layout">${facts(statCells)}</div>` : `<div class="stats-layout">${speedInfo}</div>`, inference, {known: {ability, item: p.item, previousItem: p.previousItem, teraType: p.teraType, inferredTera: inference?.teraType}, revealed: new Set(moves.map(m => moveInformation(m.id).id))});
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
  showModal(current.title || title, `${banner}${tabs}<div id="info-content" role="tabpanel"${single ? '' : ` aria-labelledby="info-tab-${tab}"`}>${current.content}</div>${current.note ? `<p class="inspection-note">${escape(current.note)}</p>` : ''}${nav}`, page.kind);
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
  if (move) { showInfo({kind: 'move', id: move.id}); return; }
  // A grayed preview move belongs to the previewed opponent, or to the previewed bench Pokémon.
  const previewMoveIndex = Number(focusedId.match(/^preview-move-(\d+)$/)?.[1]);
  const foeMove = foeMoveIndex ? foeMoveSlots(arena?.opponents()[foeMoveIndex - 1]).moves[previewMoveIndex - 1] : null;
  if (foeMove?.id) { showInfo({kind: 'move', id: foeMove.id}); return; }
  const previewMove = previewIndex && !foeMoveIndex ? knownMoves('own', previewIndex)[previewMoveIndex - 1] : null;
  if (previewMove) showInfo({kind: 'move', id: previewMove.id});
}
document.addEventListener('focusin', event => {
  const id = event.target.id || '';
  const index = Number(id.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[index - 1];
  if (move) selectedMoveId = move.id;
  // The cursor on a bench Pokémon previews it; anywhere in the move row or header returns to the active one.
  const own = id.match(/^switch-(\d+)$/);
  if (own) setPreview(Number(own[1]));
  else if (move || event.target.closest('.moves') && !event.target.classList.contains('move-preview')) setPreview(null);
  // The cursor on an opponent roster button swaps that Pokémon into the side panels and the move row.
  const foe = id.match(/^opponent-(\d+)$/);
  setFoePreview(foe ? Number(foe[1]) : null);
  if (foe || move || event.target.closest('.moves') && !event.target.classList.contains('move-preview') || own) setFoeMovePreview(foe ? Number(foe[1]) : null);
});
function focusFirstMove() {
  setPreview(null); setFoeMovePreview(null);
  (document.querySelector('#choices .moves > button[id^="move-"]:not([hidden])') || document.querySelector('#choices .moves > button:not([hidden])'))?.focus({preventScroll: true});
}
// Which opponent the move row describes. null = the own side (active or previewed own Pokémon).
let foeMoveIndex = null;
function setFoeMovePreview(index) {
  if (index === foeMoveIndex) return;
  foeMoveIndex = index;
  renderMovePreview();
}
// The opponent's four move slots: revealed moves first; the rest come from the identified role only
// when that role has exactly as many unrevealed moves as there are empty slots. Otherwise they stay blank.
function foeMoveSlots(slot) {
  const revealed = slot?.moves || [];
  const inference = slot?.revealed && sets.snapshot ? inferSets(slot) : null;
  const revealedIds = new Set(revealed.map(m => moveInformation(m.id).id));
  const pool = inference?.identified ? inference.sets.flatMap(set => set.roles.flatMap(role => Object.keys(role.moves))).map(name => moveInformation(name)).filter(move => !revealedIds.has(move.id)) : [];
  // Revealed moves first, then the identified role's remaining candidates. When candidates outnumber
  // the empty slots, the last slot counts the rest; the R3 page lists them all.
  const empty = 4 - revealed.length;
  const candidates = pool.map(move => ({id: move.id, name: move.name, type: move.type, candidate: true}));
  const filled = candidates.length <= empty ? candidates : [...candidates.slice(0, empty - 1), {more: candidates.length - (empty - 1)}];
  return {moves: [...revealed, ...filled], teraType: slot?.teraType || inference?.teraType || ''};
}
function setFoePreview(index) {
  const slot = index ? arena?.opponents()[index - 1] : null;
  const next = slot?.revealed && !slot.active ? index : null;
  if (next === foePreviewIndex) return;
  foePreviewIndex = next;
  renderMatchup();
}

// Preview: which own Pokémon the move row and side panels describe. null = the active one.
function setPreview(index) {
  // After the battle the move row holds only the replay controls; nothing is previewed.
  const next = index && !state.ended && !ownTeam()[index - 1]?.active ? index : null;
  if (next === previewIndex) return;
  previewIndex = next;
  renderMovePreview();
  renderMatchup();
}
// Bench preview: the focused Pokémon's four known moves, with effectiveness cues. The cursor can
// land on them, but pressing one does nothing; only the active Pokémon's moves can be chosen.
// Tera button: the type name plus Showdown's Tera gem for that type. Selection and active state are drawn, not written.
function teraMarkup(type, active = false) {
  const gem = type && type !== 'Unknown' ? `<img class="tera-gem" src="https://play.pokemonshowdown.com/sprites/types/Tera${encodeURIComponent(type)}.png" alt="" width="20" height="20">` : '';
  return `<span class="tera-type">${escape(type)}</span>${gem}${active ? '<span class="tera-active" aria-label="Terastallized"></span>' : ''}`;
}

function renderMovePreview() {
  const row = document.querySelector('#choices .moves');
  if (!row) return;
  for (const el of row.querySelectorAll('.move-preview')) el.remove();
  row.dataset.preview = String(!!previewIndex);
  // The Tera button follows the previewed Pokémon too, and returns to the active one's type.
  const previewed = previewIndex ? ownTeam()[previewIndex - 1] : null;
  // Once anyone on the team has Terastallized, the previewed Pokémon's Tera button is grayed out too.
  const teraUsed = ownTeam().some(p => p.terastallized);
  if (foeMoveIndex) {
    const slot = arena?.opponents()[foeMoveIndex - 1];
    const foe = foeMoveSlots(slot);
    row.dataset.preview = 'true';
    $('tera').innerHTML = teraMarkup(foe.teraType || 'Unknown'); $('tera').dataset.type = foe.teraType || 'Unknown'; $('tera').disabled = true;
    row.insertAdjacentHTML('afterbegin', Array.from({length: 4}, (_, i) => previewMoveButton(foe.moves[i], i, foe.moves[i]?.candidate ? "Not selectable: candidate move from the identified role" : "Not selectable: opponent's move", foe.moves[i]?.candidate ? 'data-candidate="true"' : foe.moves[i] && !foe.moves[i].more ? 'data-seen="true"' : '')).join(''));
    return;
  }
  if (previewed) { const type = previewed.terastallized || previewed.teraType || 'Unknown'; $('tera').innerHTML = teraMarkup(type); $('tera').dataset.type = type; $('tera').disabled = teraLabel ? teraLabel.disabled || teraUsed : teraUsed; }
  else if (teraLabel) { $('tera').innerHTML = teraLabel.html; $('tera').dataset.type = teraLabel.type; $('tera').disabled = teraLabel.disabled; }
  if (!previewIndex) return;
  const moves = knownMoves('own', previewIndex);
  row.insertAdjacentHTML('afterbegin', Array.from({length: 4}, (_, i) => {
    const move = moves[i];
    const pp = move?.current ? `${escape(move.current.pp ?? '—')} / ${escape(move.current.maxpp ?? '—')} PP` : '';
    return previewMoveButton(move, i, 'Not selectable: this Pokémon is on the bench', move ? `data-cue="${escape(move.cue || '')}" title="${escape(move.label || '')}"` : '', pp);
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
  const data = pokemon ? arena.matchup(pokemon.serverIndex, sets.snapshot, foePreviewIndex) : null;
  const own = data?.own || arena.ownStats?.(pokemon?.serverIndex) || {};
  const foe = data?.foe || {};
  const box = (label, value, estimate = false, cue = '') => `<div class="stat-box" data-stat="${cue}"><small>${escape(label)}</small><strong>${value == null ? '—' : `${estimate ? '~' : ''}${escape(value)}`}</strong></div>`;
  // Every column shows the higher of its pair green and the lower red; a tie turns both yellow. Unknowns get no cue.
  const higher = (a, b) => a == null || b == null ? ['', ''] : a === b ? ['tie', 'tie'] : a > b ? ['high', 'low'] : ['low', 'high'];
  const lower = higher;
  const [ownAtk, ownSpa] = higher(own.atk, own.spa), [foeDef, foeSpd] = lower(foe.def, foe.spd);
  const [foeAtk, foeSpa] = higher(foe.atk, foe.spa), [ownDef, ownSpd] = lower(own.def, own.spd);
  const badge = side => !data || data.first === 'tie' ? '<div class="speed-badge" data-first="true"><span aria-hidden="true">🐇</span>1</div>'
    : (data.first === 'own') === (side === 'own') ? '<div class="speed-badge" data-first="true"><span aria-hidden="true">🐇</span>1</div>' : '<div class="speed-badge" data-first="false"><span aria-hidden="true">🐢</span>2</div>';
  const cols = (first, second) => `<div class="matchup-cols" aria-hidden="true"><span>${first}</span><span>${second}</span></div>`;
  const name = pokemon ? pokemon.details.split(',')[0] : '—', foeName = data?.foeName || '—';
  // Both names sit above the columns: the attacker over ⚔️, the defender over 🛡️.
  const names = (first, second) => `<h4 class="matchup-names"><span>${nameTag(first, 'form-tag panel-form-tag')}</span><span>${nameTag(second, 'form-tag panel-form-tag')}</span></h4>`;
  left.innerHTML = `${names(name, foeName)}${cols('⚔️', '🛡️')}
    <div class="stat-pair">${box('Atk', own.atk, false, ownAtk)}${box('Def', foe.def, true, foeDef)}</div>
    <div class="stat-pair">${box('SpA', own.spa, false, ownSpa)}${box('SpD', foe.spd, true, foeSpd)}</div>
    <div class="stat-pair">${box('Spe', own.spe)}${data ? badge('own') : box('Spe', null)}</div>`;
  // The attacker is always the left column: their name, ⚔️ and attack stats; yours defend on the right.
  right.innerHTML = `${names(foeName, name)}${cols('⚔️', '🛡️')}
    <div class="stat-pair">${box('Atk', foe.atk, true, foeAtk)}${box('Def', own.def, false, ownDef)}</div>
    <div class="stat-pair">${box('SpA', foe.spa, true, foeSpa)}${box('SpD', own.spd, false, ownSpd)}</div>
    <div class="stat-pair">${box('Spe', foe.spe, true)}${data ? badge('foe') : box('Spe', null)}</div>`;
}

// Nothing can be chosen while signed out, recovering, after the battle, or without a request.
const choicesDisabled = request => !fixture && (!state.authenticated || state.recovering || state.ended || !request);
// One grayed preview-move button, shared by own bench previews and foe previews.
function previewMoveButton(move, index, description, extra = '', pp = '') {
  if (move?.more) return `<button id="preview-move-${index + 1}" class="move-preview more-moves" data-nav data-row="moves" aria-disabled="true" aria-description="More candidate moves; R3 on the Pokémon lists them"><strong>+${move.more} more</strong></button>`;
  if (!move) return `<button id="preview-move-${index + 1}" class="move-preview unknown-move" data-nav data-row="moves" aria-disabled="true" aria-label="Unknown move">—</button>`;
  const type = move.type || window.BattleMovedex[move.id]?.type || '';
  return `<button id="preview-move-${index + 1}" class="move-preview" data-nav data-row="moves" aria-disabled="true" data-type="${escape(type)}" ${extra} aria-description="${description}"><strong>${escape(move.name)}</strong><small><span class="move-type">${escape(type)}</span><span>${pp}</span></small></button>`;
}

function renderRoster() {
  if (!$('roster')) return;
  const focusId = document.activeElement?.id;
  const request = currentRequest();
  const disabled = choicesDisabled(request);
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
    // Between battles your row keeps six empty slots so the field above never resizes.
    if (rosterSide === 'own' && !fixture && !team.length) for (let slot = 1; slot <= 6; slot++) team.push({index: slot, serverIndex: null, name: '', revealed: false, fainted: false, active: false, item: '', ability: '', teraType: '', percent: null, health: '', status: '', canSwitch: false});
    roster.innerHTML = team.map(p => {
      const inference = rosterSide === 'opponent' && p.revealed ? inferSets(p) : null;
      // Speed and stat comparisons live in the side panels now, not on borders.
      const speed = rosterSide === 'own' ? {} : inference?.identified ? {cue: 'green', label: `Role inferred: ${inference.role}${inference.teraType ? `; Tera inferred: ${inference.teraType}` : ''}. Open details.`} : {};
      // No HP numbers or "Active" text on the roster: the bar shows HP, the
      // status tag sits on the name line, and the active Pokémon is marked by style.
      const status = p.revealed && !p.fainted ? (p.status || '').toUpperCase() : '';
      const spoken = !p.revealed ? `Slot ${p.index}` : p.fainted ? 'Fainted' : `${p.active ? 'Active, ' : ''}${p.health}`;
      const icon = p.revealed ? `<span class="picon" aria-hidden="true" style="${escape(arena.icon(p.name))}"></span>` : '<span class="unknown-pokemon" aria-hidden="true">?</span>';
      // Below the name: ability as small text, then the held item sprite and a Tera type badge.
      // Opponents show each only once revealed (or, for Tera, once inferred).
      // Opponents: revealed values first; otherwise what every remaining set agrees on, marked inferred.
      const shown = p.revealed; // fainted Pokémon keep ability, item and Tera visible
      const abilityInferred = shown && !p.ability && !!inference?.ability, itemInferred = shown && !p.item && !!inference?.item;
      const ability = shown ? p.ability || inference?.ability || '' : '';
      const itemName = shown ? p.item || inference?.item || '' : '';
      const held = itemName ? itemIcon(itemName, `item-icon roster-item${itemInferred ? ' inferred' : ''}`) : '';
      const teraType = shown ? p.teraType || inference?.teraType || '' : '';
      const teraBadge = teraType ? `<span class="type-badge roster-tera${!p.teraType && inference?.teraType ? ' inferred' : ''}" data-type="${escape(teraType)}" title="Tera ${escape(teraType)}">${escape(teraType)}</span>` : '';
      const details = ability || held || teraBadge ? `<span class="roster-details" aria-hidden="true"><small class="roster-ability${abilityInferred ? ' inferred' : ''}">${escape(ability)}</small><span class="roster-held">${held}${teraBadge}</span></span>` : '';
      return btn(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`, `${icon}<strong>${p.revealed ? nameTag(p.name) : '<span class="mon-name">Unknown</span>'}${status ? `<small class="status-tag">${escape(status)}</small>` : ''}</strong>${details}${p.percent != null ? `<span class="team-hp" aria-hidden="true" data-health="${p.percent <= 20 ? 'critical' : p.percent <= 50 ? 'low' : 'healthy'}"><span style="width:${p.percent}%"></span></span>` : ''}`, `team-${rosterSide}`, false,
        `data-unavailable="${!p.canSwitch}" data-fainted="${!!p.fainted}" data-active="${!!p.active}" data-cue="${speed.cue || ''}" title="${escape(speed.label || '')}" aria-label="${rosterSide === 'opponent' ? `Opponent slot ${p.index}, ` : ''}${escape(p.name)}, ${escape(spoken)}.${ability ? ` ${abilityInferred ? 'Likely ' : ''}${escape(ability)}.` : ''}${itemName ? ` ${itemInferred ? 'Likely ' : ''}${escape(itemName)}.` : ''}${teraType ? ` Tera ${escape(teraType)}.` : ''} ${escape(speed.label || '')} ${p.canSwitch ? 'Switch Pokémon' : 'View details'}"`);
    }).join('');
    for (const p of team) $(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`).onclick = () => {
      if (rosterSide === 'opponent') showInfo({kind: 'pokemon', side: 'opponent', index: p.index});
      else if (p.canSwitch) choose('switch', p.serverIndex);
      else if (p.revealed) info(p.index);
    };
  }
  if (!modal.open && focusId) $(focusId)?.focus({preventScroll: true});
  renderMatchup();
}

// One team row shows at a time; a bumper (10) or F flips between them. The right stick does nothing.
// Focus always lands on the shown side's active Pokémon, wherever the cursor was.
function showTeam(side = shownTeam === 'own' ? 'opponent' : 'own') {
  shownTeam = side;
  const focused = document.activeElement?.id.match(/^(switch|opponent)-(\d+)$/);
  for (const row of document.querySelectorAll('.team-row')) row.hidden = row.dataset.side !== side;
  const active = document.querySelector(`.team-row[data-side="${side}"] [data-active="true"]`) || $(`${side === 'own' ? 'switch' : 'opponent'}-${focused?.[2] || 1}`);
  // Flipping to the opponent lands on their active Pokémon's first move, mirroring B on the own side.
  const foeIndex = Number(active?.id.match(/^opponent-(\d+)$/)?.[1]);
  if (foeIndex) { setFoePreview(foeIndex); setFoeMovePreview(foeIndex); }
  // Flipping back to the own side lands on the active Pokémon's first move, like B does.
  if (side === 'own' && !modal.open && document.querySelector('#choices .moves > button[id^="move-"]')) focusFirstMove();
  else ((foeIndex && document.querySelector('#choices .moves > #preview-move-1')) || active)?.focus({preventScroll: true});
  arena?.resize();
}

function forfeit() {
  if (fixture) { localNotice = 'Forfeit opens a confirmation during a live battle.'; render(); return; }
  if (!state.room || state.ended) return;
  showModal('Forfeit battle?', `<p>This counts as a loss on Showdown.</p><div class="modal-actions">${btn('keep-playing', 'Keep playing', 'modal-actions')}${btn('confirm-forfeit', 'Forfeit', 'modal-actions', false, 'class="danger"')}</div>`);
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
  });
}

function render() {
  const focusId = document.activeElement?.id;
  if (searchAfterLogin && !fixture && (state.authenticated || state.status === 'Sign in required')) {
    searchAfterLogin = false;
    if (state.authenticated && !state.searching && !(state.room && !state.ended)) safe(() => session.search());
  }
  const request = fixture ? demoRequest : state.request;
  if (request?.side) lastRequest = request;
  if (request?.active?.[0]?.moves?.length) lastMovesRequest = request;
  if (request !== selectedRequest) { selectedRequest = request; tera = false; }
  const choices = availableChoices(request);
  // While the opponent picks a replacement, keep showing the active Pokémon's four moves, locked.
  if (!fixture && (request?.wait || request?.forceSwitch) && !state.ended && lastMovesRequest) choices.moves = availableChoices({...lastMovesRequest, wait: false}).moves;
  const disabled = choicesDisabled(request);
  // While a choice is pending or the opponent is moving, moves stay focusable for review but cannot be chosen.
  const waiting = !fixture && !disabled && (state.pending || !!request.wait || !!request.forceSwitch);
  const activePokemon = request?.side?.pokemon?.find(p => p.active) || lastRequest?.side?.pokemon?.find(p => p.active);
  const teraType = request?.active?.[0]?.canTerastallize || activePokemon?.teraType || 'Unknown';
  $('tera').hidden = !activePokemon || !!state.ended;
  $('tera').disabled = disabled || waiting || !choices.tera;
  $('tera').innerHTML = teraMarkup(teraType, !!activePokemon?.terastallized);
  $('tera').dataset.active = String(!!activePokemon?.terastallized);
  $('tera').dataset.type = teraType;
  teraLabel = {html: $('tera').innerHTML, type: teraType, disabled: $('tera').disabled};
  $('tera').setAttribute('aria-pressed', String(tera));
  $('tera').title = choices.tera ? 'Toggle Terastallize for your next move (X)' : 'This Pokémon’s Tera type; Terastallize is unavailable right now.';
  const canCancel = !fixture && state.pending && request && !request.noCancel && state.authenticated && !state.recovering && !state.ended;
  // No Cancel button in the row: B is cancel. The node stays in #action-slots so B can trigger it.
  $('undo').hidden = true;
  $('undo').disabled = !canCancel;
  $('arena-wrap').dataset.room = state.room || '';
  // A sent choice (move or switch) grays the move row and the active Pokémon until the server answers.
  $('choices').dataset.pending = String(!fixture && !!state.pending);
  // The heading row is gone; the few states worth words share the notice strip.
  const prompt = fixture || state.ended ? '' : state.recovering ? 'Restoring your battle…' : state.pending || request?.wait ? '' : request?.forceSwitch ? 'Choose a Pokémon' : '';
  // Searching shows as an overlay on the field, so nothing below it moves.
  $('search-overlay').hidden = fixture || !state.searching;
  const redundantNotice = state.ended && /won the battle\.$|ended in a tie\.$/.test(state.notice || '') || state.notice === 'Choice sent. Waiting for the server.';
  $('notice').textContent = localNotice || (!redundantNotice && state.notice) || (!fixture && !state.authenticated ? state.status : prompt);
  $('notice').parentElement.hidden = true; // the top strip never shows; it would resize the field
  $('action-slots').append($('tera'), $('undo'));
  // After the battle the move row holds the replay controls instead of moves.
  const endControls = !fixture && state.ended ? [btn('replay', 'Replay battle', 'moves'), btn('first-turn', 'First turn', 'moves'), btn('prev-turn', 'Prev turn', 'moves'), btn('next-turn', 'Next turn', 'moves'), btn('end-turn', 'Last turn', 'moves')].map(html => html.replace('<button ', '<button class="end-control" ')).join('') : '';
  if (!fixture && state.ended) previewIndex = null;
  $('choices').innerHTML = `<div class="moves${endControls ? ' end-row' : ''}" role="group" aria-label="Moves">${endControls}${choices.moves.map(move => {
    const type = window.BattleMovedex[move.id]?.type || '';
    return btn(`move-${move.index}`, `<strong>${escape(move.move)}</strong><small><span class="move-type">${escape(type)}</span><span>${escape(move.pp ?? '—')} / ${escape(move.maxpp ?? '—')} PP</span></small>`, 'moves', disabled || !waiting && !move.enabled, `data-type="${escape(type)}" data-locked="${waiting || !move.enabled}" aria-description="R3 or I for move information"`);
  }).join('')}</div>
    <div class="team-row" data-side="own" ${shownTeam === 'own' ? '' : 'hidden'}><span class="team-label">You</span><div id="roster" class="team" role="group" aria-label="Your six Pokémon"></div></div>
    <div class="team-row" data-side="opponent" ${shownTeam === 'opponent' ? '' : 'hidden'}><span class="team-label">Foe</span><div id="opponent-roster" class="team" role="group" aria-label="Opponent’s six Pokémon"></div></div>`;
  // Tera and Cancel keep their nodes and handlers; they sit at the end of the move row.
  $('choices').querySelector('.moves').append($('tera'));
  renderRoster();
  refreshMoveHints();
  renderMovePreview();
  for (const move of choices.moves) $(`move-${move.index}`).onclick = () => { if (!waiting && move.enabled) choose('move', move.index); };
  if (endControls) {
    $('replay').onclick = () => arena.replay();
    $('first-turn').onclick = () => arena.seekTurn(1);
    $('prev-turn').onclick = () => arena.seekTurn(arena.turn - 1);
    $('next-turn').onclick = () => arena.seekTurn(arena.turn + 1);
    $('end-turn').onclick = () => arena.seekTurn(Infinity);
  }
  $('tera').onclick = () => { tera = !tera; render(); };
  $('undo').onclick = () => safe(() => {
    localNotice = ''; tera = false; session.undo();
    const previous = choices.moves.find(move => move.id === selectedMoveId && move.enabled) || choices.moves.find(move => move.enabled);
    if (previous) $(`move-${previous.index}`)?.focus({preventScroll: true});
  });
  // The timer starts itself once per battle; there is no Timer button.
  if (!fixture && state.room && !state.ended && state.authenticated && !state.recovering && !state.timerOn && !state.timerPending && autoTimerRoom !== state.room) {
    autoTimerRoom = state.room; safe(() => session.toggleTimer());
  }
  updateTimer();
  arena?.resize();
  if (modal.open && infoPage) showInfo(infoPage);
  if (modal.open && modal.dataset.view === 'menu') showMenu();
  if (modal.open && modal.dataset.view === 'battle') showBattleMenu();
  if (focusId && !modal.open) { const target = $(focusId); if (target && !target.disabled) target.focus({preventScroll: true}); }
}

function startLive() {
  fixture = false; localNotice = ''; lastRequest = null; lastMovesRequest = null; ownOrder = []; selectedMoveId = '';
  arena.reset('battle-gen9randombattle-0');
  session.connect();
}
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
    onState(next) { if (state.room && !next.room) { lastRequest = null; lastMovesRequest = null; ownOrder = []; } state = next; music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped})); render(); },
    onBattle(packet) { try {
      if (arena.room !== packet.room) { lastRequest = null; lastMovesRequest = null; ownOrder = []; if (modal.open && infoPage) closeModal(); }
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
      if (modal.open && modal.dataset.view === 'chat') { if (action === 'up') showChat(-1); if (action === 'down') showChat(1); return; }
      navigate(action); return;
    }
    if (action === 'cancel') {
      // B on the battle screen undoes a pending choice and puts the cursor on the active Pokémon's first move.
      if (modal.open && modal.dataset.view === 'chat') showMenu();
      else if (modal.open) closeModal();
      else { $('undo')?.click(); if (shownTeam !== 'own') showTeam('own'); focusFirstMove(); }
      return;
    }
    if (action === 'team' && modal.open) { flipInfoTeam(); return; }
    if (action === 'confirm') {
      if (document.activeElement?.matches('[data-nav], [data-info-tab], .inspection-footer button')) document.activeElement.click();
      else navigate('right');
      return;
    }
    // Select closes the Select menu and Start closes the Start menu; either still opens its own menu from the battle screen.
    if (action === 'tools' && modal.open && modal.dataset.view === 'menu') { closeModal(); return; }
    if (action === 'battle' && modal.open && modal.dataset.view === 'battle') { closeModal(); return; }
    if (modal.open) return;
    ({tera: () => $('tera')?.click(), info, team: () => showTeam(), tools: showMenu, battle: showBattleMenu, chat: () => { chatTurn = null; showChat(); }})[action]?.();
  }});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { music.update(false); return; }
    if (!fixture && !session.stopped && Date.now() - session.lastMessage > 30000) session.connect();
    music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped}));
  });
}
init().catch(error => { $('notice').textContent = error.message; console.error(error); });
