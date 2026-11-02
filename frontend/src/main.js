import './styles.css';
import './battle-data.ts';
import {ShowdownSession} from './session.mjs';
import {ShowdownAuth} from './auth.mjs';
import {availableChoices} from './protocol.mjs';
import {startController, navigate} from './controller.mjs';
import {Music} from './music.js';
import {demoLines, demoRequest} from './demo.mjs';
import {moveInformation, effectName} from './information.mjs';

const $ = id => document.getElementById(id);
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const btn = (id, label, row, disabled = false, extra = '') => `<button id="${id}" data-nav data-row="${row}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
let arena, session, auth, config, state = {}, fixture = true, tera = false, lastRequest, selectedRequest, localNotice = '', ignoreButtons = new Set();
let diagnosticLines = [];
let modalReturnFocus = '', displayFit = 'wide';
let rosterSide = 'own', selectedMoveId = '', infoPage = null;
try { if (localStorage.getItem('ps-mve-display-fit') === 'original') displayFit = 'original'; } catch {}
const modal = $('modal');
const music = new Music(() => updateMusic());
const safe = fn => { try { fn(); } catch (error) { localNotice = error.message; render(); } };

function updateMusic() {
  const button = $('music');
  if (button) button.textContent = !music.enabled ? 'Music off' : music.unlocked ? 'Music on' : 'Tap for music';
}

function showModal(title, content) {
  const previousFocus = modal.open ? document.activeElement?.id : '';
  if (!modal.open) modalReturnFocus = document.activeElement?.id || '';
  infoPage = null;
  $('modal-title').textContent = title; $('modal-body').innerHTML = content;
  if (!modal.open) modal.showModal();
  ($(previousFocus) || $('modal-close')).focus({preventScroll: true});
}
function closeModal() {
  infoPage = null;
  modal.close();
  $(modalReturnFocus)?.focus({preventScroll: true});
}
$('modal-close').onclick = closeModal;
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });

function displaySettings() {
  showModal('Battlefield display', `<p>Choose how the battlefield fits above the controls. This preference is saved on this device.</p>
    <div class="modal-actions">${btn('fit-wide', 'Wide field', 'display-options', false, `aria-pressed="${displayFit === 'wide'}"`)}${btn('fit-original', 'Original proportions', 'display-options', false, `aria-pressed="${displayFit === 'original'}"`)}</div>
    <p class="small">Wide field allows up to 25% horizontal stretching, like your console skin. Original proportions keeps the sprites at their native shape. Both keep the controls below the battlefield.</p>`);
  for (const value of ['wide', 'original']) $(`fit-${value}`).onclick = () => {
    displayFit = value;
    try { localStorage.setItem('ps-mve-display-fit', value); } catch {}
    arena.setFit(value);
    for (const option of ['wide', 'original']) $(`fit-${option}`).setAttribute('aria-pressed', String(option === value));
  };
}
$('display').onclick = displaySettings;

function showTools(open, focusId) {
  $('utility').hidden = !open;
  $('toggle-tools').setAttribute('aria-expanded', String(open));
  $('toggle-tools').textContent = open ? 'Fewer controls' : 'More controls';
  if (focusId) $(focusId)?.focus({preventScroll: true});
}
$('toggle-tools').onclick = () => showTools($('utility').hidden);

function setup() {
  showModal('Connect your account', `<p>This example uses Showdown’s own sign-in page. Your password stays on Showdown.</p>
    <ol><li>Choose the public hosting address.</li><li><a href="https://forms.gle/VAoSjqHn4zwem7tp9" target="_blank" rel="noopener noreferrer">Register a Showdown application</a> for that origin.</li><li>Paste the public client ID below, then connect and sign in.</li></ol>
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
$('setup').onclick = setup;

function diagnostics() {
  showModal('Controller check', `<p>Press each button once. The log shows what this browser receives. Mapping follows your userscript; SN30 connection modes can change button numbers.</p>
    <pre id="input-log"></pre><label for="ignored-buttons">Ignore button numbers (comma separated)</label><input id="ignored-buttons" type="text" inputmode="numeric" value="${[...ignoreButtons].join(', ')}" placeholder="For example: 4, 5, 6, 7">
    <p class="small">Ignored buttons have no action in this app. iPadOS shortcuts may still run; a website cannot cancel system-reserved controls.</p>${btn('save-ignored', 'Save ignored buttons', 'modal-actions')}`);
  $('input-log').textContent = diagnosticLines.join('\n') || 'Tap the page, then press a controller button.';
  $('save-ignored').onclick = () => {
    ignoreButtons = new Set($('ignored-buttons').value.split(',').filter(x => x.trim()).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x < 64));
    localStorage.setItem('ps-mve-ignored', JSON.stringify([...ignoreButtons])); closeModal();
  };
}
$('diagnostics').onclick = diagnostics;

const currentRequest = () => fixture ? demoRequest : state.request;
const ownTeam = () => (fixture ? demoRequest : lastRequest)?.side?.pokemon || [];
const facts = entries => `<dl class="info-facts">${entries.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;

function showInfo(page) {
  let title, content, moves = [];
  if (page.kind === 'move') {
    const currentMoves = currentRequest()?.active?.[0]?.moves || [];
    const isActiveMove = !page.parent || page.parent.side === 'own' && ownTeam()[page.parent.index - 1]?.active;
    const currentMove = isActiveMove ? currentMoves.find(m => m.id === page.id) : null;
    const move = moveInformation(page.id, currentMove);
    title = move.name;
    content = `<p class="info-kicker" data-type="${escape(move.type)}">${escape(move.type)} · ${escape(move.category)}</p>${facts([
      ['Base power', move.power], ['Base accuracy', move.accuracy], ['PP', move.pp],
      ['Priority', move.priority], ['Target', move.target], ['Contact', move.contact],
    ])}<p class="move-description">${escape(move.description)}</p>
    ${move.disabled ? '<p class="info-warning">This move is currently unavailable.</p>' : ''}
    <p class="small">Gen 9 reference values. Power, type, accuracy and damage can change with battle conditions. PP is current only when supplied by your active request.</p>`;
    if (!page.parent) moves = currentMoves.map(m => ({id: m.id, name: moveInformation(m.id).name}));
  } else if (page.kind === 'pokemon' && page.side === 'opponent') {
    const p = arena.opponents()[page.index - 1];
    title = p.revealed ? p.name : `Opponent · slot ${page.index}`;
    content = p.revealed ? `<p class="info-kicker">Opponent · ${p.active ? 'Active · ' : ''}Level ${escape(p.level)} · ${escape(p.types.join(' / '))}</p>${facts([
      ['Last shown HP', p.health], ['Status', p.status || 'None shown'], ['Ability', p.ability || 'Not revealed'],
      ['Item', p.item || 'Not revealed'], ['Tera type', p.teraType || 'Not revealed'],
      ...(p.previousItem ? [['Previous item', `${p.previousItem}${p.previousItemEffect ? ` (${p.previousItemEffect})` : ''}`]] : []),
    ])}<h3>Revealed moves</h3>${p.moves.length ? '' : '<p>No moves revealed yet.</p>'}
    <p class="small">Public information through the displayed battle turn. Unseen moves, items and abilities stay unknown; HP is approximate.</p>` :
      '<p>This Pokémon has not been revealed. Its species, moves, ability, item and Tera type are unknown.</p>';
    moves = p.moves;
  } else if (page.kind === 'pokemon') {
    const p = ownTeam()[page.index - 1];
    title = p?.details.split(',')[0] || 'Your Pokémon';
    content = p ? `<p class="info-kicker">Your team · ${escape(p.details)}</p>${facts([
      ['HP / status', p.condition], ['Ability', effectName('abilities', p.ability || p.baseAbility) || 'Unknown'],
      ['Item', effectName('items', p.item) || 'No item'], ['Tera type', p.teraType || 'Unknown'],
    ])}<h3>Moves</h3>` : '<p>Your team will appear when a battle starts.</p>';
    moves = (p?.moves || []).map(id => ({id, name: moveInformation(id).name}));
  } else {
    title = 'Your team';
    content = `<div class="team-info">${ownTeam().map((p, i) => btn(`inspect-own-${i + 1}`, `${escape(p.details.split(',')[0])}<small>${escape(p.condition)}</small>`, 'inspect-team')).join('')}</div>`;
  }
  if (moves.length) content += `<div class="info-moves" role="group" aria-label="Move information">${moves.map((m, i) => btn(`inspect-move-${i + 1}`, `${escape(m.name)}${m.copied ? ' (copied)' : ''}`, 'inspect-moves', false, `aria-pressed="${page.kind === 'move' && page.id === m.id}"`)).join('')}</div>`;
  if (page.parent) content += `<div class="modal-actions">${btn('info-back', 'Back to Pokémon', 'info-back')}</div>`;
  showModal(title, content);
  infoPage = page;
  moves.forEach((m, i) => $(`inspect-move-${i + 1}`).onclick = () => showInfo({kind: 'move', id: m.id, parent: page.kind === 'move' ? page.parent : page}));
  if ($('info-back')) $('info-back').onclick = () => showInfo(page.parent);
  if (page.kind === 'team') ownTeam().forEach((p, i) => $(`inspect-own-${i + 1}`).onclick = () => showInfo({kind: 'pokemon', side: 'own', index: i + 1}));
}

function info(index) {
  if (Number.isInteger(index)) { showInfo({kind: 'pokemon', side: 'own', index}); return; }
  const focusedId = document.activeElement?.id || '';
  const slot = focusedId.match(/^(switch|opponent)-(\d+)$/);
  if (slot) { showInfo({kind: 'pokemon', side: slot[1] === 'switch' ? 'own' : 'opponent', index: Number(slot[2])}); return; }
  const moveIndex = Number(focusedId.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[moveIndex - 1];
  if (move) { showInfo({kind: 'move', id: move.id}); return; }
  showInfo({kind: 'team'});
}
$('move-details').onclick = () => {
  const moves = currentRequest()?.active?.[0]?.moves || [];
  const move = moves.find(m => m.id === selectedMoveId) || moves[0];
  if (move) showInfo({kind: 'move', id: move.id});
};
document.addEventListener('focusin', event => {
  const index = Number(event.target.id?.match(/^move-(\d+)$/)?.[1]);
  const move = currentRequest()?.active?.[0]?.moves?.[index - 1];
  if (move) selectedMoveId = move.id;
});

function renderRoster() {
  if (!$('roster')) return;
  const focusId = document.activeElement?.id;
  for (const side of ['own', 'opponent']) $(`view-${side}`).setAttribute('aria-pressed', String(rosterSide === side));
  const request = currentRequest();
  const disabled = !fixture && (!state.authenticated || state.pending || state.recovering || state.ended || !request || request.wait);
  const choices = availableChoices(request);
  const team = rosterSide === 'own' ? ownTeam().map((p, i) => {
    const health = p.condition.match(/^(\d+)\/(\d+)/), fainted = /fnt/.test(p.condition);
    return {index: i + 1, name: p.details.split(',')[0], revealed: true, fainted,
      percent: fainted ? 0 : health ? Math.max(0, Math.min(100, Number(health[1]) / Number(health[2]) * 100)) : 100,
      health: fainted ? 'Fainted' : `${p.active ? 'Active · ' : ''}${p.condition}`,
      canSwitch: !disabled && choices.switches.some(choice => choice.index === i + 1 && choice.enabled)};
  }) : arena.opponents();
  $('roster').setAttribute('aria-label', rosterSide === 'own' ? 'Your six Pokémon' : 'Opponent’s six Pokémon');
  $('roster').innerHTML = team.map(p => {
    const status = rosterSide === 'opponent' ? p.revealed ? `${p.active ? 'Active · ' : ''}${p.health}` : `Slot ${p.index}` : p.health;
    const icon = p.revealed ? `<span class="picon" aria-hidden="true" style="${escape(arena.icon(p.name))}"></span>` : '<span class="unknown-pokemon" aria-hidden="true">?</span>';
    return btn(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`, `${icon}<strong>${escape(p.name)}</strong><small>${escape(status)}</small>${p.percent != null ? `<span class="team-hp" aria-hidden="true" data-health="${p.percent <= 20 ? 'critical' : p.percent <= 50 ? 'low' : 'healthy'}"><span style="width:${p.percent}%"></span></span>` : ''}`, 'team', false,
      `data-unavailable="${!p.canSwitch}" data-fainted="${!!p.fainted}" aria-label="${rosterSide === 'opponent' ? `Opponent slot ${p.index}, ` : ''}${escape(p.name)}, ${escape(status)}. ${p.canSwitch ? 'Switch Pokémon' : 'View details'}"`);
  }).join('');
  for (const p of team) $(`${rosterSide === 'own' ? 'switch' : 'opponent'}-${p.index}`).onclick = () => {
    if (rosterSide === 'opponent') showInfo({kind: 'pokemon', side: 'opponent', index: p.index});
    else if (p.canSwitch) choose('switch', p.index);
    else info(p.index);
  };
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
  safe(() => { localNotice = ''; session.choose(kind, index, kind === 'move' && tera); });
}

function render() {
  const focusId = document.activeElement?.id;
  const request = fixture ? demoRequest : state.request;
  if (request?.side) lastRequest = request;
  if (request !== selectedRequest) { selectedRequest = request; tera = false; }
  const choices = availableChoices(request);
  const disabled = !fixture && (!state.authenticated || state.pending || state.recovering || state.ended || !request || request.wait);
  $('connection').textContent = fixture ? 'Offline preview' : state.status;
  $('connection-dot').classList.toggle('online', !!state.authenticated);
  $('account').textContent = `${config?.username || 'mepc36363636'} · Gen 9 singles`;
  const activePokemon = request?.side?.pokemon?.find(p => p.active);
  $('mode').textContent = fixture ? 'OFFLINE PREVIEW' : state.room || 'LIVE CONNECTION';
  $('turn-label').textContent = activePokemon ? `HP ${activePokemon.condition}` : '';
  $('prompt').textContent = fixture ? `What will ${activePokemon.details.split(',')[0]} do?` : state.ended ? 'Battle complete' : state.recovering ? 'Restoring your battle…' : state.pending || request?.wait ? 'Waiting for the next turn' : request?.forceSwitch ? 'Choose a Pokémon' : activePokemon ? `What will ${activePokemon.details.split(',')[0]} do?` : state.searching ? 'Finding an opponent…' : 'Let’s play';
  $('notice').textContent = localNotice || state.notice || (fixture ? 'Try the D-pad and A. No match is running.' : !auth?.clientId ? 'Open Setup to add your registered Showdown application ID.' : state.recovering ? 'Restoring your battle. No choice will be resubmitted.' : state.searching ? 'Searching with registered bots blocked.' : '');
  const primary = $('primary');
  primary.disabled = false;
  primary.textContent = fixture || session?.stopped ? 'Connect to Showdown' : !state.authenticated ? 'Sign in with Showdown' : state.searching ? 'Cancel search' : 'Find Random Battle';
  if (!fixture && !session?.stopped) primary.disabled = !state.authenticated ? !state.challenge : !!state.room && !state.ended;
  $('reconnect').hidden = fixture || session?.stopped;
  $('move-details').disabled = !request?.active?.[0]?.moves?.length;
  $('choices').innerHTML = `<div class="moves" role="group" aria-label="Moves">${choices.moves.map(move => {
    const type = window.BattleMovedex[move.id]?.type || '';
    return btn(`move-${move.index}`, `<strong>${escape(move.move)}</strong><small>${escape(type)} <span>${escape(move.pp ?? '—')} / ${escape(move.maxpp ?? '—')} PP</span></small>`, 'moves', disabled || !move.enabled, `data-type="${escape(type)}" aria-description="R3 or I for move information"`);
  }).join('')}</div>
    <div class="team-toolbar"><div role="group" aria-label="Team to inspect">${btn('view-own', 'Your team', 'team-tabs', false, `aria-pressed="${rosterSide === 'own'}" aria-controls="roster"`)}${btn('view-opponent', 'Opponent', 'team-tabs', false, `aria-pressed="${rosterSide === 'opponent'}" aria-controls="roster"`)}</div><span>R3: details</span></div>
    <div id="roster" class="team" role="group"></div>`;
  for (const side of ['own', 'opponent']) $(`view-${side}`).onclick = () => { rosterSide = side; renderRoster(); };
  renderRoster();
  const inBattle = fixture || !!state.room && !state.ended;
  $('utility').innerHTML = `${btn('tera', tera ? '✓ Tera selected' : 'Terastallize', 'tools', disabled || !choices.tera, `aria-pressed="${tera}"`)}
    ${btn('undo', 'Undo choice', 'tools', !fixture && (!state.pending || !request || request.noCancel || !state.authenticated))}
    ${btn('info', 'Team info', 'tools', !lastRequest && !fixture)}${btn('skip', 'Skip animation', 'tools', !inBattle)}
    ${btn('timer-on', 'Timer on', 'tools', !inBattle || !fixture && !state.authenticated)}${btn('timer-off', 'Timer off', 'tools', !inBattle || !fixture && !state.authenticated)}
    ${btn('music', 'Tap for music', 'tools')}${btn('forfeit', 'Forfeit…', 'tools', !inBattle || !fixture && !state.authenticated)}
    ${state.ended ? btn('replay', 'Watch this battle again', 'tools') : ''}`;
  for (const move of choices.moves) $(`move-${move.index}`).onclick = () => choose('move', move.index);
  $('tera').onclick = () => { tera = !tera; render(); };
  $('undo').onclick = () => fixture ? (localNotice = 'Controller check: undo.', render()) : safe(() => session.undo());
  $('info').onclick = () => info(); $('skip').onclick = () => arena.skip(); $('music').onclick = () => music.toggle(); $('forfeit').onclick = forfeit;
  for (const toggle of ['on', 'off']) $(`timer-${toggle}`).onclick = () => fixture ? (localNotice = `Controller check: timer ${toggle}.`, render()) : safe(() => session.roomCommand(`/timer ${toggle}`));
  if ($('replay')) $('replay').onclick = () => arena.replay();
  $('timer-status').textContent = state.timer || '';
  updateMusic();
  if (modal.open && infoPage) showInfo(infoPage);
  if (focusId && !modal.open) { const target = $(focusId); if (target && !target.disabled) target.focus({preventScroll: true}); }
}

function startLive() {
  fixture = false; localNotice = ''; lastRequest = null; rosterSide = 'own'; selectedMoveId = '';
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
$('reconnect').onclick = () => { localNotice = ''; session.connect(); };
document.addEventListener('pointerdown', () => music.unlock(), {passive: true});
document.addEventListener('keydown', event => { if (!event.repeat && event.isTrusted) music.unlock(); });

async function init() {
  config = await fetch('./config.json', {cache: 'no-store'}).then(response => response.json());
  auth = new ShowdownAuth(localStorage.getItem('ps-mve-client-id') || config.clientId);
  try { ignoreButtons = new Set(JSON.parse(localStorage.getItem('ps-mve-ignored') || '[]')); } catch {}
  const {Arena} = await import('./renderer.js');
  arena = new Arena($('arena'), $('hidden-log'), () => {
    if (rosterSide === 'opponent') renderRoster();
    if (modal.open && infoPage?.side === 'opponent') showInfo(infoPage);
  });
  arena.setFit(displayFit);
  arena.receive({room: 'battle-gen9randombattle-0', lines: demoLines, snapshot: true, request: demoRequest});
  session = new ShowdownSession({url: config.server, username: config.username, auth, storage: localStorage,
    onState(next) { if (state.room && !next.room) lastRequest = null; state = next; music.update(!fixture && !!state.room && !state.ended && state.authenticated); render(); },
    onBattle(packet) { try {
      if (arena.room !== packet.room) { lastRequest = null; rosterSide = 'own'; if (modal.open && infoPage) closeModal(); }
      arena.receive(packet);
    } catch { localNotice = 'The battle display encountered an error. Controls still use the server request; reconnect to rebuild the display.'; } },
  });
  state = session.state;
  render();
  startController({ignored: () => ignoreButtons, diagnostic(line) {
    diagnosticLines = [...diagnosticLines.slice(-13), line];
    if ($('input-log')) $('input-log').textContent = diagnosticLines.join('\n');
  }, action(action) {
    if (['up', 'down', 'left', 'right'].includes(action)) { navigate(action); return; }
    if (action === 'cancel') {
      if (modal.open) { if (infoPage?.parent) showInfo(infoPage.parent); else closeModal(); }
      else $('undo')?.click();
      return;
    }
    if (action === 'confirm') {
      if (document.activeElement?.matches('button[data-nav]')) document.activeElement.click();
      else navigate('right');
      return;
    }
    if (modal.open) return;
    ({tera: () => { $('tera')?.click(); showTools(true); }, music: () => music.toggle(), timer: () => showTools(true, 'timer-on'), menu: forfeit, info})[action]?.();
  }});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { music.update(false); return; }
    if (!fixture && !session.stopped && Date.now() - session.lastMessage > 30000) session.connect();
    music.update(!fixture && !!state.room && !state.ended && state.authenticated);
  });
}
init().catch(error => { $('connection').textContent = 'Could not start the example'; $('notice').textContent = error.message; });
