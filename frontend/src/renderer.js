import {Battle} from '../vendor/pokemon-showdown/battle';
import {BattleSound} from '../vendor/pokemon-showdown/battle-sound';
import {Dex} from '../vendor/pokemon-showdown/battle-dex';
import {isBattleEvent} from './protocol.mjs';

// Audio is controlled through one primed media element in music.js.
BattleSound.setMute(true);

export class Arena {
  constructor(frame, log) {
    this.frame = frame; this.log = log;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(frame.parentElement);
    this.observer.observe(document.querySelector('.command-panel'));
    window.addEventListener('resize', () => this.resize());
  }
  reset(room) {
    this.battle?.destroy();
    this.room = room;
    this.battle = new Battle({id: room, $frame: window.$(this.frame), $logFrame: window.$(this.log), paused: false, autoresize: false});
    this.battle.messageShownTime = 700;
    this.resize();
  }
  resize() {
    const parent = this.frame.parentElement;
    const width = parent.clientWidth;
    const below = ['.command-panel', '.controller-bar', 'footer'].reduce((sum, selector) => sum + document.querySelector(selector).offsetHeight, 0);
    const available = Math.max(220, window.innerHeight - (parent.getBoundingClientRect().top + window.scrollY) - below - 45);
    const scale = Math.min(width / 640, width >= 760 ? available / 360 : Infinity);
    this.frame.style.transform = `scale(${scale})`;
    this.frame.style.left = `${(width - 640 * scale) / 2}px`;
    parent.style.height = `${360 * scale}px`;
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
  }
  replay() { if (this.battle) { this.battle.seekTurn(0); this.battle.play(); } }
  skip() { this.battle?.seekTurn(Infinity); }
  icon(name) { return Dex.getPokemonIcon(name); }
}
