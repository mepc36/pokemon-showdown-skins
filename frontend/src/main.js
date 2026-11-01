import './styles.css';
import './battle-data.ts';
import {ShowdownSession} from './session.mjs';
import {ShowdownAuth} from './auth.mjs';
import {availableChoices} from './protocol.mjs';
import {startController, navigate} from './controller.mjs';
import {Music} from './music.js';
import {demoLines, demoRequest} from './demo.mjs';

const $ = id => document.getElementById(id);
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const btn = (id, label, row, disabled = false, extra = '') => `<button id="${id}" data-nav data-row="${row}" ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`;
let arena, session, auth, config, state = {}, fixture = true, tera = false, lastRequest, selectedRequest, localNotice = '', ignoreButtons = new Set();
let diagnosticLines = [];
let modalReturnFocus = '', displayFit = 'wide';
try { if (localStorage.getItem('ps-mve-display-fit') === 'original') displayFit = 'original'; } catch {}
const modal = $('modal');
const music = new Music(() => updateMusic());
const safe = fn => { try { fn(); } catch (error) { localNotice = error.message; render(); } };

function updateMusic() {
  const button = $('music');
  if (button) button.textContent = !music.enabled ? 'Music off' : music.unlocked ? 'Music on' : 'Tap for music';
}

function showModal(title, content) {
  if (!modal.open) modalReturnFocus = document.activeElement?.id || '';
  $('modal-title').textContent = title; $('modal-body').innerHTML = content;
  if (!modal.open) modal.showModal();
  $('modal-close').focus();
}
$('modal-close').onclick = () => modal.close();
modal.addEventListener('close', () => $(modalReturnFocus)?.focus({preventScroll: true}));

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
    auth.clientId = value; localStorage.setItem('ps-mve-client-id', value); modal.close(); render();
  };
  $('sign-out').onclick = () => { session.stop(); auth.forget(); modal.close(); localNotice = 'Saved authorization cleared from this browser.'; render(); };
}
$('setup').onclick = setup;

function diagnostics() {
  showModal('Controller check', `<p>Press each button once. The log shows what this browser receives. Mapping follows your userscript; SN30 connection modes can change button numbers.</p>
    <pre id="input-log"></pre><label for="ignored-buttons">Ignore button numbers (comma separated)</label><input id="ignored-buttons" type="text" inputmode="numeric" value="${[...ignoreButtons].join(', ')}" placeholder="For example: 4, 5, 6, 7">
    <p class="small">Ignored buttons have no action in this app. iPadOS shortcuts may still run; a website cannot cancel system-reserved controls.</p>${btn('save-ignored', 'Save ignored buttons', 'modal-actions')}`);
  $('input-log').textContent = diagnosticLines.join('\n') || 'Tap the page, then press a controller button.';
  $('save-ignored').onclick = () => {
    ignoreButtons = new Set($('ignored-buttons').value.split(',').filter(x => x.trim()).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x < 64));
    localStorage.setItem('ps-mve-ignored', JSON.stringify([...ignoreButtons])); modal.close();
  };
}
$('diagnostics').onclick = diagnostics;

function info(index) {
  const team = (fixture ? demoRequest : lastRequest)?.side?.pokemon || [];
  const focused = Number(document.activeElement?.id?.match(/^switch-(\d+)$/)?.[1]);
  const selected = Number.isInteger(index) ? index : focused;
  const pokemon = team[selected - 1];
  const entries = pokemon ? [pokemon] : team;
  showModal(pokemon ? pokemon.details.split(',')[0] : 'Your team', entries.length ? `<div class="team-info">${entries.map(p => `<article><strong>${escape(p.details.split(',')[0])}</strong><p>${escape(p.condition)} · ${escape(p.baseAbility || p.ability)} · ${escape(p.item || 'No item')}</p><p>${escape(p.moves?.map(id => window.BattleMovedex[id]?.name || id).join(' · '))}</p><small>Tera: ${escape(p.teraType || 'Unknown')}</small></article>`).join('')}</div>` : '<p>Your team will appear when a battle starts.</p>');
}

function forfeit() {
  if (fixture) { localNotice = 'Start opens a forfeit confirmation during a live battle.'; render(); return; }
  if (!state.room || state.ended) return;
  showModal('Forfeit this battle?', `<p>This counts as a loss on Showdown.</p><div class="modal-actions">${btn('keep-playing', 'Keep playing', 'modal-actions')}${btn('confirm-forfeit', 'Forfeit battle', 'modal-actions', false, 'class="danger"')}</div>`);
  $('keep-playing').onclick = () => modal.close();
  $('confirm-forfeit').onclick = () => safe(() => { session.roomCommand('/forfeit'); modal.close(); });
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
  const team = (request?.side?.pokemon || lastRequest?.side?.pokemon || []).map((pokemon, i) => ({...pokemon, index: i + 1, enabled: choices.switches.some(p => p.index === i + 1 && p.enabled)}));
  $('choices').innerHTML = `<div class="moves" role="group" aria-label="Moves">${choices.moves.map(move => {
    const type = window.BattleMovedex[move.id]?.type || '';
    return btn(`move-${move.index}`, `<strong>${escape(move.move)}</strong><small>${escape(type)} <span>${escape(move.pp ?? '—')} / ${escape(move.maxpp ?? '—')} PP</span></small>`, 'moves', disabled || !move.enabled, `data-type="${escape(type)}"`);
  }).join('')}</div>
    <div class="team" role="group" aria-label="Your six Pokémon">${team.map(p => {
      const name = p.details.split(',')[0], fainted = /fnt/.test(p.condition), canSwitch = !disabled && p.enabled;
      const health = p.condition.match(/^(\d+)\/(\d+)/);
      const percent = fainted ? 0 : health ? Math.max(0, Math.min(100, Number(health[1]) / Number(health[2]) * 100)) : 100;
      const status = fainted ? 'Fainted' : `${p.active ? 'Active · ' : ''}${p.condition}`;
      return btn(`switch-${p.index}`, `<span class="picon" aria-hidden="true" style="${escape(arena.icon(name))}"></span><strong>${escape(name)}</strong><small>${escape(status)}</small><span class="team-hp" aria-hidden="true" data-health="${percent <= 20 ? 'critical' : percent <= 50 ? 'low' : 'healthy'}"><span style="width:${percent}%"></span></span>`, 'team', false, `data-unavailable="${!canSwitch}" data-fainted="${fainted}" aria-label="${escape(name)}, ${escape(status)}. ${canSwitch ? 'Switch Pokémon' : 'View details'}"`);
    }).join('')}</div>`;
  const inBattle = fixture || !!state.room && !state.ended;
  $('utility').innerHTML = `${btn('tera', tera ? '✓ Tera selected' : 'Terastallize', 'tools', disabled || !choices.tera, `aria-pressed="${tera}"`)}
    ${btn('undo', 'Undo choice', 'tools', !fixture && (!state.pending || !request || request.noCancel || !state.authenticated))}
    ${btn('info', 'Team info', 'tools', !lastRequest && !fixture)}${btn('skip', 'Skip animation', 'tools', !inBattle)}
    ${btn('timer-on', 'Timer on', 'tools', !inBattle || !fixture && !state.authenticated)}${btn('timer-off', 'Timer off', 'tools', !inBattle || !fixture && !state.authenticated)}
    ${btn('music', 'Tap for music', 'tools')}${btn('forfeit', 'Forfeit…', 'tools', !inBattle || !fixture && !state.authenticated)}
    ${state.ended ? btn('replay', 'Watch this battle again', 'tools') : ''}`;
  for (const move of choices.moves) $(`move-${move.index}`).onclick = () => choose('move', move.index);
  for (const p of team) $(`switch-${p.index}`).onclick = () => disabled || !p.enabled ? info(p.index) : choose('switch', p.index);
  $('tera').onclick = () => { tera = !tera; render(); };
  $('undo').onclick = () => fixture ? (localNotice = 'Controller check: undo.', render()) : safe(() => session.undo());
  $('info').onclick = () => info(); $('skip').onclick = () => arena.skip(); $('music').onclick = () => music.toggle(); $('forfeit').onclick = forfeit;
  for (const toggle of ['on', 'off']) $(`timer-${toggle}`).onclick = () => fixture ? (localNotice = `Controller check: timer ${toggle}.`, render()) : safe(() => session.roomCommand(`/timer ${toggle}`));
  if ($('replay')) $('replay').onclick = () => arena.replay();
  $('timer-status').textContent = state.timer || '';
  updateMusic();
  if (focusId && !modal.open) { const target = $(focusId); if (target && !target.disabled) target.focus({preventScroll: true}); }
}

function startLive() {
  fixture = false; localNotice = ''; lastRequest = null;
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
  arena = new Arena($('arena'), $('hidden-log'));
  arena.setFit(displayFit);
  arena.receive({room: 'battle-gen9randombattle-0', lines: demoLines, snapshot: true, request: demoRequest});
  session = new ShowdownSession({url: config.server, username: config.username, auth, storage: localStorage,
    onState(next) { state = next; music.update(!fixture && !!state.room && !state.ended && state.authenticated); render(); },
    onBattle(packet) { try { arena.receive(packet); } catch { localNotice = 'The battle display encountered an error. Controls still use the server request; reconnect to rebuild the display.'; } },
  });
  state = session.state;
  render();
  startController({ignored: () => ignoreButtons, diagnostic(line) {
    diagnosticLines = [...diagnosticLines.slice(-13), line];
    if ($('input-log')) $('input-log').textContent = diagnosticLines.join('\n');
  }, action(action) {
    if (['up', 'down', 'left', 'right'].includes(action)) { navigate(action); return; }
    if (action === 'cancel') { if (modal.open) modal.close(); else $('undo')?.click(); return; }
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
