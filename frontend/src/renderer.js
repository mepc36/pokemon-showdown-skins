import {Battle, Pokemon} from '../vendor/pokemon-showdown/battle';
import {ModifiableValue} from '../vendor/pokemon-showdown/battle-tooltips';
import {BattleSound} from '../vendor/pokemon-showdown/battle-sound';
import {PokemonSprite} from '../vendor/pokemon-showdown/battle-animations';
import {Dex} from '../vendor/pokemon-showdown/battle-dex';
import {isBattleEvent} from './protocol.mjs';
import {opponentSlots, pokemonSpeed, ownPokemonStats, ownDisplayedHealth} from './information.mjs';
import {possibleSets} from './possible-sets.mjs';
import {moveCue, speedCue} from './battle-hints.mjs';
import uiData from './showdown-ui-data.json';

// @pkmn/dex omits non-damage type immunities. Supply the pinned upstream
// fields so Showdown's own tooltip calculation handles Toxic, powders, etc.
for (const [type, immunities] of Object.entries(uiData.typeImmunities)) {
  Object.assign(Dex.types.get(type).damageTaken, immunities);
}

// Audio is controlled by the single looping Web Audio source in music.js.
BattleSound.setMute(true);

// A Pokémon's cry sounds as it switches in. Showdown's own audio stays muted, so the switch-in animations report
// the species and the seconds until the Pokémon appears, and main.js has music.js play the cry. Nothing is
// reported while the renderer skips animations (a seek, a snapshot).
let cryHandler = () => {};
export function onCry(handler) { cryHandler = handler; }
const {animSummon, animDragIn} = PokemonSprite.prototype;
PokemonSprite.prototype.animSummon = function (pokemon, slot, instant) {
  // The Pokémon leaves its ball 300 ms into the animation, which itself waits for whatever is still playing.
  if (this.scene.animating && !instant) cryHandler(pokemon.getSpecies(), (this.scene.timeOffset + 300 / this.scene.acceleration) / 1000);
  return animSummon.call(this, pokemon, slot, instant);
};
PokemonSprite.prototype.animDragIn = function (pokemon, slot) {
  // A Pokémon dragged in (Roar, Whirlwind) slides onto the field after 300 ms.
  if (this.scene.animating) cryHandler(pokemon.getSpecies(), 0.3);
  return animDragIn.call(this, pokemon, slot);
};

export class Arena {
  constructor(frame, log, onUpdate = () => {}) {
    this.frame = frame; this.log = log;
    this.onUpdate = onUpdate;
    this.fit = 'wide';
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(frame.parentElement);
    for (const selector of ['.arena-top', '.command-panel', 'footer']) { const el = document.querySelector(selector); if (el) this.observer.observe(el); }
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }
  setFit(fit) { this.fit = fit === 'original' ? 'original' : 'wide'; this.resize(); }
  reset(room) {
    this.battle?.destroy();
    this.room = room; this.finished = false;
    this.battle = new Battle({id: room, $frame: window.$(this.frame), $logFrame: window.$(this.log), paused: false, autoresize: false});
    this.battle.subscribe(() => this.scheduleUpdate());
    this.battle.messageShownTime = 700;
    this.resize();
  }
  resize() {
    const parent = this.frame.parentElement;
    const width = parent.clientWidth;
    const below = ['.command-panel', 'footer'].reduce((sum, selector) => sum + (document.querySelector(selector)?.offsetHeight || 0), 0);
    // visualViewport follows Safari's toolbars. Reserve measured controls, never
    // cover the player's Pokémon with the dock or retain a stale maximum height.
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const safeBottom = parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom) || 0;
    const available = Math.max(0, viewportHeight - (parent.getBoundingClientRect().top + window.scrollY) - below - safeBottom);
    const scaleY = Math.min(width / 640, width >= 600 ? available / 360 : Infinity);
    const scaleX = Math.min(width / 640, scaleY * (this.fit === 'wide' ? 1.25 : 1));
    this.frame.style.transform = `scale(${scaleX}, ${scaleY})`;
    this.frame.style.left = `${(width - 640 * scaleX) / 2}px`;
    parent.style.height = `${360 * scaleY}px`;
  }
  receive({room, lines, snapshot, request}) {
    if (snapshot || !this.battle || this.room !== room) this.reset(room);
    const events = lines.filter(isBattleEvent);
    // Once the battle has a result, everything the renderer shows is a replay of it.
    if (events.some(line => /^\|(win|tie)(\||$)/.test(line))) this.finished = true;
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
    this.followAnimations();
  }
  scheduleUpdate() {
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => { this.updateQueued = false; this.onUpdate(); });
  }
  // The renderer only notifies on turn boundaries. While it is still animating
  // a chunk, refresh the custom rosters a few times a second so their HP bars
  // follow each damage line as it plays, after the move animation.
  followAnimations() {
    if (this.following) return;
    this.following = setInterval(() => {
      this.onUpdate();
      if (!this.battle || this.battle.atQueueEnd) { clearInterval(this.following); this.following = 0; }
    }, 250);
  }
  opponents() { return opponentSlots(this.battle?.farSide); }
  // Replaying = the battle ended and the renderer is behind its queue end. The renderer's own `ended`
  // flag is cleared whenever a replay seeks backwards, so the result seen in the log decides.
  get replaying() { return !!this.battle && this.finished && !this.battle.atQueueEnd; }
  // After the battle the roster marks whoever is on the field at the replay's current point.
  ownActive(pokemon) {
    if (!this.finished) return !!pokemon?.active;
    const client = this.battle?.mySide?.pokemon?.find(p => p.ident === pokemon?.ident);
    return !!client && this.battle.mySide.active.includes(client);
  }
  ownHealth(pokemon) { return ownDisplayedHealth(this.battle, pokemon, this.replaying); }
  speed(side, index) { return pokemonSpeed(this.battle, side, index); }
  stats(index) { return ownPokemonStats(this.battle, index); }
  ownView(index, tera = false) {
    const battle = this.battle, server = battle?.myPokemon?.[index - 1];
    if (!server || !battle.atQueueEnd || server.fainted || /fnt/.test(server.condition || '')) return null;
    const client = battle.mySide.pokemon.find(p => p.ident === server.ident);
    if (server.active && (!client || !battle.mySide.active.includes(client))) return null;
    if (client?.volatiles.transform) return null;
    // A read-only view lets the official calculations inspect unrevealed bench
    // Pokémon without constructing sprites or changing renderer battle state.
    const view = Object.assign(Object.create(Pokemon.prototype), {
      volatiles: {}, turnstatuses: {}, movestatuses: {}, boosts: {}, moddedType: [],
      ...(server.active ? client : {}), ...server, side: battle.mySide,
      ability: server.ability || client?.ability || server.baseAbility || '',
      item: Dex.items.get(server.item).name,
      terastallized: tera ? server.teraType : client?.terastallized || (server.terastallized ? server.teraType : ''),
    });
    return {view, server};
  }
  moveHint(index, id, tera = false) {
    const own = this.ownView(index, tera), target = this.battle?.farSide.active[0];
    if (!own || !target || target.fainted) return {};
    const tooltips = this.battle.scene.tooltips, move = this.battle.dex.moves.get(id);
    const [type, category] = tooltips.getMoveType(move, new ModifiableValue(this.battle, own.view, own.server));
    const factor = tooltips.getMoveEffectiveness(own.view, move, type, category, target);
    const cue = moveCue({...move, category}, factor);
    const label = !cue ? '' : factor === 0 ? 'Immune / blocked' : category === 'Status' ? 'No known immunity' : `${factor}× effectiveness`;
    return {cue, label, type, factor, target: target.getSpeciesForme()};
  }
  speedHint(index, snapshot) {
    const own = this.ownView(index), target = this.battle?.farSide.active[0];
    if (!own || !target || target.fainted || target.volatiles.transform || !Number.isFinite(own.server.stats?.spe)) return {};
    const battle = this.battle, tooltips = battle.scene.tooltips;
    const roles = possibleSets(snapshot, target.getSpeciesForme(), target.level).flatMap(set => set.roles);
    // Hidden options widen the estimate; independent options are never treated
    // as evidence that a particular complete set has been revealed.
    const abilities = target.ability ? [target.ability] : [...new Set(roles.flatMap(role => Object.keys(role.abilities)))];
    const items = target.item ? [target.item] : target.prevItem ? [''] : [...new Set(roles.flatMap(role => Object.keys(role.items || {'': 1})))];
    if (!abilities.length || !items.length) return {};
    const range = tooltips.getSpeedRange(target);
    const bases = [range.min, range.ev84];
    // The upstream calculator reads mySide for Tailwind. Give it a separate
    // opponent-side context, without changing the real battle's viewpoint.
    const opponentCalculator = Object.create(tooltips);
    opponentCalculator.battle = Object.assign(Object.create(battle), {mySide: battle.farSide, farSide: battle.mySide});
    const candidates = [];
    for (const spe of bases) for (const ability of abilities) for (const item of items) {
      const server = {speciesForme: target.speciesForme, ability, item, hp: target.hp, maxhp: target.maxhp,
        stats: {atk: 1, def: 1, spa: 1, spd: 1, spe}};
      candidates.push(opponentCalculator.calculateModifiedStats(target, server).spe);
    }
    const value = tooltips.calculateModifiedStats(own.view, own.server).spe;
    const cue = speedCue(value, candidates);
    const relation = {green: 'Faster', yellow: 'Same Speed', red: 'Slower'}[cue] || 'Speed uncertain';
    return {cue, value, fastest: Math.max(...candidates), label: `${relation} vs ${target.getSpeciesForme()} (${Math.min(...candidates)}–${Math.max(...candidates)} estimated). Includes known modifiers and possible hidden items/abilities; not move priority or Trick Room.`};
  }
  // Side-panel matchup: one own Pokémon (by request index) against the opposing
  // active Pokémon. Own values are exact request stats; opposing values are the
  // Random Battle spread (level, 31 IVs, 84 EVs, neutral nature) from species
  // base stats, before boosts. Speed uses the fastest estimate for the opponent.
  // foeIndex: a revealed opponent roster slot to compare against instead of their active Pokémon.
  matchup(index, snapshot, foeIndex = null) {
    const server = this.battle?.myPokemon?.[index - 1];
    const target = foeIndex ? this.battle?.farSide.pokemon?.[foeIndex - 1] : this.battle?.farSide.active[0];
    if (!server?.stats || !target?.speciesForme || !foeIndex && target.fainted) return null;
    const species = target.getSpecies();
    const estimate = base => Math.floor(Math.floor(2 * base + 31 + 21) * target.level / 100) + 5;
    const foe = Object.fromEntries(['atk', 'def', 'spa', 'spd', 'spe'].map(stat => [stat, estimate(species.baseStats[stat])]));
    // Speed hints read the active opponent; a previewed slot uses the plain estimate.
    const speedHint = foeIndex && !target.isActive?.() ? {} : this.speedHint(index, snapshot);
    const ownSpeed = speedHint.value || server.stats.spe;
    const foeSpeed = speedHint.fastest || foe.spe;
    foe.spe = foeSpeed;
    return {own: {...server.stats, spe: ownSpeed}, foe, foeName: target.getSpeciesForme(),
      first: ownSpeed > foeSpeed ? 'own' : ownSpeed < foeSpeed ? 'foe' : 'tie'};
  }
  // Exact own stats for the side panel when no opponent is on the field.
  // Random-battle opponents: 31 IVs, 85 EVs, neutral nature, the same estimate the side panels use.
  foeStats(index) {
    const target = this.battle?.farSide.pokemon?.[index - 1];
    const species = target?.speciesForme ? this.battle.dex.species.get(target.speciesForme) : null;
    if (!species?.baseStats) return null;
    const estimate = base => Math.floor(Math.floor(2 * base + 31 + 21) * target.level / 100) + 5;
    return Object.fromEntries(['atk', 'def', 'spa', 'spd'].map(stat => [stat, estimate(species.baseStats[stat])]));
  }
  ownStats(index) { const server = this.battle?.myPokemon?.[index - 1]; return server?.stats ? {...server.stats} : null; }
  replay() { if (this.battle) { this.battle.seekTurn(0); this.battle.play(); this.followAnimations(); } }
  // True once the renderer has shown everything in the log: the live battle is caught up, or a replay has reached its last step.
  get atEnd() { return !this.battle || this.battle.atQueueEnd; }
  // Play on from wherever the replay is paused.
  play() { if (this.battle) { this.battle.play(); this.followAnimations(); } }
  // End-of-battle controls: jump to a turn and hold there.
  get turn() { return this.battle?.turn ?? 0; }
  // Turn 0 is the pre-battle state; paused there, Showdown shows its own Play overlay. Paused seeks stop at turn 1.
  seekTurn(turn) { if (this.battle) { this.battle.seekTurn(Math.max(1, turn)); this.battle.pause(); this.followAnimations(); this.onUpdate(); } }
  icon(name) { return Dex.getPokemonIcon(name); }
}
