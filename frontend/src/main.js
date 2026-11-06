import './styles.css';
import './battle-data.ts';
import {ShowdownSession} from './session.mjs';
import {ShowdownAuth} from './auth.mjs';
import {availableChoices} from './protocol.mjs';
import {startController, navigate} from './controller.mjs';
import {PlayerRating} from './rating.mjs';
import {Music, musicActive} from './music.js';
import {PossibleSets, possibleSets, narrowSets} from './possible-sets.mjs';
import {escapeHtml, facts, typeBadges, moveList, rolePages, movePages} from './info-components.mjs';
import {demoLines, demoRequest} from './demo.mjs';
import {moveInformation, effectName, knownOwnMoves, speciesInformation} from './information.mjs';
import {statRanks} from './battle-hints.mjs';

const $ = id => document.getElementById(id);
const escape = escapeHtml;
const btn = (id, label, row, disabled = false, extra = '') => `<button id="${id}" data-nav data-row="${row}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
let arena, session, auth, config, state = {}, fixture = true, tera = false, lastRequest, selectedRequest, localNotice = '', ignoreButtons = new Set();
let diagnosticLines = [];
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

function showTools(open, focusId) {
  $('utility').hidden = !open;
  $('toggle-tools').setAttribute('aria-expanded', String(open));
  $('toggle-tools').textContent = open ? 'Fewer controls' : 'More controls';
  if (focusId) $(focusId)?.focus({preventScroll: true});
  arena?.resize();
}
$('toggle-tools').onclick = () => showTools($('utility').hidden);

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
const ownTeam = () => (fixture ? demoRequest : lastRequest)?.side?.pokemon || [];
function teamSlots(side) {
  return side === 'opponent' ? arena.opponents() : Array.from({length: 6}, (_, i) => {
    const p = ownTeam()[i];
    return {index: i + 1, revealed: !!p, name: p?.details.split(',')[0] || 'Not available',
      level: Number(p?.details.match(/, L(\d+)/)?.[1] || 100), gender: p?.details.match(/, ([MF])(?:,|$)/)?.[1] || ''};
  });
}

function knownMoves(side, index) {
  if (side === 'opponent') return arena.opponents()[index - 1]?.moves || [];
  return knownOwnMoves(ownTeam()[index - 1], currentRequest()).map(move => ({...move, ...arena.moveHint(index, move.id, ownTeam()[index - 1]?.active && tera)}));
}

function refreshMoveHints() {
  if (!arena) return;
  const index = ownTeam().findIndex(p => p.active) + 1;
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
    if ($('rating')) $('rating').textContent = rating.label;
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
    title = slot.revealed ? `${slot.name} ${slot.gender === 'M' ? '♂' : slot.gender === 'F' ? '♀' : '⚲'} · Lv ${slot.level}` : `Unknown Pokémon · slot ${page.index}`;
    if (!slot.revealed) {
      banner = `<div class="inspection-banner"><strong>${page.side === 'own' ? 'Your team' : 'Opponent'} · ${page.index}/6</strong></div>`;
      pages = [{key: 'overview', label: 'Overview', content: '<p class="empty-info">This Pokémon has not been revealed.</p>', note: 'Species, abilities, Speed and moves are unknown.'}];
    } else {
      const own = page.side === 'own', p = own ? ownTeam()[page.index - 1] : slot;
      const species = speciesInformation(slot.name);
      const inference = own ? null : narrowSets(sets.snapshot, slot.name, slot.level, slot);
      const candidates = inference?.sets || possibleSets(sets.snapshot, slot.name, slot.level);
      const abilities = [...new Set(candidates.flatMap(set => set.roles.flatMap(role => Object.keys(role.abilities))))];
      const ability = own ? effectName('abilities', p.ability || p.baseAbility) : p.ability;
      const abilityText = ability || (own ? 'Unknown' : (abilities.length ? abilities : species.abilities).join(' / ') || 'Unknown');
      const stats = own ? arena.stats(page.index) : null;
      const speed = arena.speed(page.side, page.index);
      const ranks = stats && !stats.label.startsWith('Original') ? statRanks([...stats.entries, ['Speed', p.stats?.spe]]) : {};
      const speedLabel = speed.kind === 'estimate' ? 'Speed · estimated' : 'Speed';
      const speedInfo = `<div class="identity-speed" data-cue="${ranks.Speed || ''}"><small>${escape(speedLabel)}</small><strong>${escape(speed.value)}</strong>${speed.kind === 'estimate' ? '<small>before modifiers</small>' : speed.modified != null && speed.modified !== speed.value ? `<small>Current: ${escape(speed.modified)}</small>` : ''}</div>`;
      banner = `<div class="inspection-banner"><div class="identity-types">${typeBadges(own ? species.types : p.types)}<small data-identified="${!!inference?.identified}">${own ? 'Your team' : 'Opponent'} · ${page.index}/6${inference?.identified ? ' · Role identified' : ''}</small></div>
        <div class="identity-ability"><small>${!own && !ability ? 'Possible abilities' : 'Ability'}</small><strong>${escape(abilityText)}</strong></div></div>`;
      const summary = own ? [['HP / status', p.condition], ['Item', effectName('items', p.item) || 'No item', {item: true}], ['Tera', p.teraType || 'Unknown', p.teraType]] :
        [['Last shown HP', p.health], ['Status', p.status || 'None shown'], ['Item', p.item || (p.previousItem ? `Lost ${p.previousItem}` : 'Not revealed'), {item: !!p.item}],
          inference?.teraType ? ['Tera · inferred', inference.teraType, {type: inference.teraType, cue: 'green', hint: 'All remaining set definitions have this Tera type'}] : ['Tera', p.teraType || 'Not revealed', p.teraType]];
      const moves = knownMoves(page.side, page.index);
      const count = Math.max(1, Math.ceil(moves.length / 4));
      pages = Array.from({length: count}, (_, i) => ({key: `overview:${i}`, label: count > 1 ? `Overview ${i + 1}/${count}` : 'Overview',
        content: `<div class="overview-layout"><section>${facts(summary)}<h3>${stats?.label.startsWith('Original') ? 'Original stats · before Transform' : stats ? 'Stats (before battle modifiers)' : 'Speed estimate · before battle modifiers'}</h3><div class="stats-layout">${speedInfo}${stats ? facts(stats.entries.map(([name, value]) => [name, value, {cue: ranks[name]}])) : ''}</div></section>
          <section><h3>${own ? 'Your moves' : 'Revealed moves'}</h3>${moveList(moves.slice(i * 4, i * 4 + 4), 4)}</section></div>`,
        note: moves.some(m => m.copied) ? '* Copied move' : own ? 'Exact team stats include IVs, EVs and nature.' : inference?.identified ? `Role inferred: ${inference.role}. Unrevealed moves/items remain candidates.` : inference?.status === 'unmatched' ? 'Reveals do not match this snapshot; showing all candidates.' : 'Unrevealed information stays unknown.'}));
      if (!own) pages.push(...rolePages(sets, slot.name, slot.level, speedInfo, inference));
    }
  }
  const tab = Math.max(0, Math.min(page.tab || 0, pages.length - 1));
  const current = pages[tab];
  const tabs = `<div class="inspection-tabs" role="tablist" aria-label="Information pages">${pages.map((p, i) => `<button id="info-tab-${i}" role="tab" aria-selected="${i === tab}" aria-controls="info-content" data-info-tab="${i}">${escape(p.label)}</button>`).join('')}</div>`;
  const nav = `<div class="inspection-footer"><div class="inspection-paging"><button id="prev-info-page" aria-label="Previous page" ${pages.length < 2 ? 'disabled' : ''}>←</button><span>Page ${tab + 1} / ${pages.length}</span><button id="next-info-page" aria-label="Next page" ${pages.length < 2 ? 'disabled' : ''}>→</button></div>
    ${page.kind === 'pokemon' ? '<div class="inspection-paging"><button id="prev-info-mon" aria-label="Previous Pokémon">↑</button><span>Pokémon</span><button id="next-info-mon" aria-label="Next Pokémon">↓</button></div>' : ''}<span><kbd>B</kbd> Close</span></div>`;
  showModal(title, `${banner}${tabs}<div id="info-content" role="tabpanel" aria-labelledby="info-tab-${tab}">${current.content}</div><p class="inspection-note">${escape(current.note)}</p>${nav}`, page.kind);
  infoPage = {...page, tab, total: pages.length};
  for (const button of modal.querySelectorAll('[data-info-tab]')) button.onclick = () => showInfo({...infoPage, tab: Number(button.dataset.infoTab)});
  $('prev-info-page').onclick = () => navigateInfo('left'); $('next-info-page').onclick = () => navigateInfo('right');
  if ($('prev-info-mon')) { $('prev-info-mon').onclick = () => navigateInfo('up'); $('next-info-mon').onclick = () => navigateInfo('down'); }
  if ($('retry-sets')) {
    $('retry-sets').onclick = () => { const loading = sets.load(); showInfo(infoPage); void loading.then(refreshInformation); };
    $('retry-sets').focus({preventScroll: true});
  }
}

function navigateInfo(direction) {
  if (direction === 'left' || direction === 'right') showInfo({...infoPage, tab: (infoPage.tab + (direction === 'left' ? -1 : 1) + infoPage.total) % infoPage.total});
  else if (infoPage.kind === 'pokemon') showInfo({...infoPage, index: (infoPage.index - 1 + (direction === 'up' ? -1 : 1) + 6) % 6 + 1, tab: 0});
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
  const index = Number(event.target.id?.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[index - 1];
  if (move) selectedMoveId = move.id;
});

function renderRoster() {
  if (!$('roster')) return;
  const focusId = document.activeElement?.id;
  const request = currentRequest();
  const disabled = !fixture && (!state.authenticated || state.pending || state.recovering || state.ended || !request || request.wait);
  const choices = availableChoices(request);
  for (const rosterSide of ['own', 'opponent']) {
    const roster = $(rosterSide === 'own' ? 'roster' : 'opponent-roster');
    const team = rosterSide === 'own' ? ownTeam().map((p, i) => {
      const health = p.condition.match(/^(\d+)\/(\d+)/), fainted = /fnt/.test(p.condition);
      return {index: i + 1, name: p.details.split(',')[0], revealed: true, fainted,
        percent: fainted ? 0 : health ? Math.max(0, Math.min(100, Number(health[1]) / Number(health[2]) * 100)) : 100,
        health: fainted ? 'Fainted' : `${p.active ? 'Active · ' : ''}${p.condition}`,
        canSwitch: !disabled && choices.switches.some(choice => choice.index === i + 1 && choice.enabled)};
    }) : arena.opponents();
    roster.innerHTML = team.map(p => {
      const inference = rosterSide === 'opponent' && p.revealed ? narrowSets(sets.snapshot, p.name, p.level, p) : null;
      const speed = rosterSide === 'own' ? arena.speedHint(p.index, sets.snapshot) : inference?.identified ? {cue: 'green', label: `Role inferred: ${inference.role}${inference.teraType ? `; Tera inferred: ${inference.teraType}` : ''}. Open details.`} : {};
      const status = rosterSide === 'opponent' ? p.revealed ? `${p.active ? 'Active · ' : ''}${p.health}` : `Slot ${p.index}` : p.health;
      const icon = p.revealed ? `<span class="picon" aria-hidden="true" style="${escape(arena.icon(p.name))}"></span>` : '<span class="unknown-pokemon" aria-hidden="true">?</span>';
      return btn(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`, `${icon}<strong>${escape(p.name)}</strong><small>${escape(status)}</small>${p.percent != null ? `<span class="team-hp" aria-hidden="true" data-health="${p.percent <= 20 ? 'critical' : p.percent <= 50 ? 'low' : 'healthy'}"><span style="width:${p.percent}%"></span></span>` : ''}`, `team-${rosterSide}`, false,
        `data-unavailable="${!p.canSwitch}" data-fainted="${!!p.fainted}" data-cue="${speed.cue || ''}" title="${escape(speed.label || '')}" aria-label="${rosterSide === 'opponent' ? `Opponent slot ${p.index}, ` : ''}${escape(p.name)}, ${escape(status)}. ${escape(speed.label || '')} ${p.canSwitch ? 'Switch Pokémon' : 'View details'}"`);
    }).join('');
    for (const p of team) $(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`).onclick = () => {
      if (rosterSide === 'opponent') showInfo({kind: 'pokemon', side: 'opponent', index: p.index});
      else if (p.canSwitch) choose('switch', p.index);
      else info(p.index);
    };
  }
  if (!modal.open && focusId) $(focusId)?.focus({preventScroll: true});
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
  $('tera').setAttribute('aria-pressed', String(tera));
  $('tera').title = choices.tera ? 'Toggle Terastallize for your next move (X)' : 'This Pokémon’s Tera type; Terastallize is unavailable right now.';
  const canCancel = !fixture && state.pending && request && !request.noCancel && state.authenticated && !state.recovering && !state.ended;
  $('undo').hidden = !canCancel;
  $('undo').disabled = !canCancel;
  $('arena-wrap').dataset.room = state.room || '';
  $('turn-label').textContent = activePokemon ? `HP ${activePokemon.condition}` : '';
  $('prompt').textContent = fixture ? `What will ${activePokemon.details.split(',')[0]} do?` : state.ended ? 'Battle complete' : state.recovering ? 'Restoring your battle…' : state.pending || request?.wait ? 'Waiting for the next turn' : request?.forceSwitch ? 'Choose a Pokémon' : activePokemon ? `What will ${activePokemon.details.split(',')[0]} do?` : state.searching ? 'Finding an opponent…' : 'Let’s play';
  const redundantNotice = state.ended && /won the battle\.$|ended in a tie\.$/.test(state.notice || '') || state.notice === 'Choice sent. Waiting for the server.';
  $('notice').textContent = localNotice || (!redundantNotice && state.notice) || (!fixture && state.recovering ? 'Restoring your battle…' : !fixture && !state.authenticated ? state.status : '');
  $('notice').parentElement.hidden = !$('notice').textContent;
  const primary = $('primary');
  primary.disabled = false;
  primary.textContent = fixture || session?.stopped ? 'Connect to Showdown' : !state.authenticated ? 'Sign in with Showdown' : state.searching ? 'Cancel search' : 'Find Random Battle';
  if (!fixture && !session?.stopped) primary.disabled = !state.authenticated ? !state.challenge : !!state.room && !state.ended;
  $('choices').innerHTML = `<div class="moves" role="group" aria-label="Moves">${choices.moves.map(move => {
    const type = window.BattleMovedex[move.id]?.type || '';
    return btn(`move-${move.index}`, `<strong>${escape(move.move)}</strong><small><span class="move-type">${escape(type)}</span><span>${escape(move.pp ?? '—')} / ${escape(move.maxpp ?? '—')} PP</span></small>`, 'moves', disabled || !move.enabled, `data-type="${escape(type)}" aria-description="R3 or I for move information"`);
  }).join('')}</div>
    <div class="team-row"><span class="team-label">You</span><div id="roster" class="team" role="group" aria-label="Your six Pokémon"></div></div>
    <div class="team-row"><span class="team-label">Foe</span><div id="opponent-roster" class="team" role="group" aria-label="Opponent’s six Pokémon"></div></div>`;
  renderRoster();
  refreshMoveHints();
  const inBattle = fixture || !!state.room && !state.ended;
  $('utility').innerHTML = `
    ${btn('timer-toggle', `Timer: ${(fixture ? fixtureTimer : state.timerOn) ? 'on' : 'off'}`, 'tools', !inBattle || !fixture && (!state.authenticated || state.recovering || state.timerPending), `aria-pressed="${!!(fixture ? fixtureTimer : state.timerOn)}"`)}
    ${btn('rating', rating?.label || 'Rating', 'tools')}${btn('forfeit', 'Forfeit…', 'tools', !inBattle || !fixture && !state.authenticated)}
    ${state.ended ? btn('replay', 'Replay', 'tools') : ''}${btn('setup', 'Setup', 'tools')}${btn('diagnostics', 'Controller check', 'tools')}
    <a id="source" data-nav data-row="tools" href="./source.zip" download>Source</a>`;
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
  fixture = false; localNotice = ''; lastRequest = null; selectedMoveId = '';
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
    onState(next) { if (state.room && !next.room) lastRequest = null; state = next; music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped})); render(); },
    onBattle(packet) { try {
      if (arena.room !== packet.room) { lastRequest = null; if (modal.open && infoPage) closeModal(); }
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
    if (['up', 'down', 'left', 'right'].includes(action)) { if (modal.open && infoPage) navigateInfo(action); else navigate(action); return; }
    if (action === 'cancel') {
      if (modal.open) closeModal();
      else $('undo')?.click();
      return;
    }
    if (action === 'confirm') {
      if (document.activeElement?.matches('[data-nav], [data-info-tab], .inspection-footer button')) document.activeElement.click();
      else navigate('right');
      return;
    }
    if (modal.open) return;
    ({tera: () => $('tera')?.click(), timer: () => showTools(true, 'timer-toggle'), menu: forfeit, info})[action]?.();
  }});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { music.update(false); return; }
    if (!fixture && !session.stopped && Date.now() - session.lastMessage > 30000) session.connect();
    music.update(musicActive(state, {fixture, hidden: document.hidden, stopped: session.stopped}));
  });
}
init().catch(error => { $('notice').textContent = error.message; $('notice').parentElement.hidden = false; });
