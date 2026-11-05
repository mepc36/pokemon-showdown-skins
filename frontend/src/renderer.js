import {Battle} from '../vendor/pokemon-showdown/battle';
import {BattleSound} from '../vendor/pokemon-showdown/battle-sound';
import {Dex} from '../vendor/pokemon-showdown/battle-dex';
import {isBattleEvent} from './protocol.mjs';
import {opponentSlots, pokemonSpeed, ownPokemonStats} from './information.mjs';

// Audio is controlled by the single looping Web Audio source in music.js.
BattleSound.setMute(true);

export class Arena {
  constructor(frame, log, onUpdate = () => {}) {
    this.frame = frame; this.log = log;
    this.onUpdate = onUpdate;
    this.fit = 'wide';
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(frame.parentElement);
    for (const selector of ['.app-header', '.arena-top', '.command-panel', '.controller-bar', 'footer']) this.observer.observe(document.querySelector(selector));
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }
  setFit(fit) { this.fit = fit === 'original' ? 'original' : 'wide'; this.resize(); }
  reset(room) {
    this.battle?.destroy();
    this.room = room;
    this.battle = new Battle({id: room, $frame: window.$(this.frame), $logFrame: window.$(this.log), paused: false, autoresize: false});
    this.battle.subscribe(() => this.scheduleUpdate());
    this.battle.messageShownTime = 700;
    this.resize();
  }
  resize() {
    const parent = this.frame.parentElement;
    const width = parent.clientWidth;
    const below = ['.command-panel', '.controller-bar', 'footer'].reduce((sum, selector) => sum + document.querySelector(selector).offsetHeight, 0);
    // visualViewport follows Safari's toolbars. Reserve measured controls, never
    // cover the player's Pokémon with the dock or retain a stale maximum height.
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const safeBottom = parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom) || 0;
    const available = Math.max(160, viewportHeight - (parent.getBoundingClientRect().top + window.scrollY) - below - safeBottom);
    const scaleY = Math.min(width / 640, width >= 600 ? available / 360 : Infinity);
    const scaleX = Math.min(width / 640, scaleY * (this.fit === 'wide' ? 1.25 : 1));
    this.frame.style.transform = `scale(${scaleX}, ${scaleY})`;
    this.frame.style.left = `${(width - 640 * scaleX) / 2}px`;
    parent.style.height = `${360 * scaleY}px`;
  }
  receive({room, lines, snapshot, request}) {
    if (snapshot || !this.battle || this.room !== room) this.reset(room);
    const events = lines.filter(isBattleEvent);
    for (const line of events) this.battle.add(line);
    if (snapshot) this.battle.seekTurn(Infinity);
    if (request?.side) {
      this.battle.setViewpoint(request.side.id);
      this.battle.myPokemon = request.side.pokemon.map(raw => {
        const pokemon = {...raw};
        const name = raw.ident?.slice(4) || raw.details.split(',')[0];
        this.battle.parseDetails(name, raw.ident, raw.details, pokemon);
        this.battle.parseHealth(raw.condition, pokemon);
        return pokemon;
      });
      this.battle.scene.updateSidebars();
    }
    this.battle.play();
    this.scheduleUpdate();
  }
  scheduleUpdate() {
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => { this.updateQueued = false; this.onUpdate(); });
  }
  opponents() { return opponentSlots(this.battle?.farSide); }
  speed(side, index) { return pokemonSpeed(this.battle, side, index); }
  stats(index) { return ownPokemonStats(this.battle, index); }
  replay() { if (this.battle) { this.battle.seekTurn(0); this.battle.play(); } }
  skip() { this.battle?.seekTurn(Infinity); }
  icon(name) { return Dex.getPokemonIcon(name); }
}
