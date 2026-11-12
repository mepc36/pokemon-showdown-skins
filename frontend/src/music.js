// The 19 battle themes and their loop points from setBgm in pinned Showdown battle-animations.ts.
// Loop points are milliseconds there, seconds here.
const track = (name, loopStart, loopEnd) => ({url: `./audio/${name}.mp3`, loopStart: loopStart / 1000, loopEnd: loopEnd / 1000});
export const VOLUME = 0.22;
export const TRACKS = [
  track('bw2-homika-dogars', 1661, 68131), track('xd-miror-b', 9000, 57815), track('colosseum-miror-b', 896, 47462),
  track('dpp-trainer', 13440, 96959), track('dpp-rival', 13888, 66352), track('hgss-johto-trainer', 23731, 125086),
  track('hgss-kanto-trainer', 13003, 94656), track('bw-trainer', 14629, 110109), track('bw-rival', 19180, 57373),
  track('bw-subway-trainer', 15503, 110984), track('bw2-kanto-gym-leader', 14626, 58986), track('bw2-rival', 7152, 68708),
  track('xy-trainer', 7802, 82469), track('xy-rival', 7802, 58634), track('oras-trainer', 13579, 91548),
  track('oras-rival', 14303, 69149), track('sm-trainer', 8323, 89230), track('spl-elite4', 3962, 152509),
  track('sm-rival', 11389, 62158)];

// Your clock sounds a short tone each time it counts down past one of these seconds.
export const TIMER_TONES = [60, 30, 20, 15, 10, 5];
export function timerToneDue(previous, current) {
  return previous != null && current != null && current < previous && TIMER_TONES.some(mark => previous > mark && current <= mark);
}

// The cry file of a species, by the rule in pinned battle-dex.ts (getSpriteData): the base species' cry, except
// for the formes that have their own.
const CRY_FORMES = ['-bloodmoon', '-crowned', '-eternal', '-eternamax', '-four', '-hangry', '-hero', '-lowkey', '-noice', '-primal',
  '-rapidstrike', '-roaming', '-school', '-sky', '-starter', '-super', '-therian', '-unbound'];
const CRY_SPECIES = ['calyrex', 'kyurem', 'cramorant', 'indeedee', 'lycanroc', 'necrozma', 'oinkologne', 'oricorio', 'slowpoke', 'tatsugiri', 'zygarde'];
export function cryFile({baseSpecies, formeid, isMega}) {
  const base = baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, '');
  const own = isMega || formeid && (CRY_FORMES.includes(formeid) || CRY_SPECIES.includes(base));
  const suffix = !own ? '' : isMega && (base === 'meowstic' || base === 'tatsugiri') ? '-mega' : formeid;
  return `./audio/cries/${base}${suffix}.mp3`;
}

export function musicActive(state, {fixture = false, hidden = false, stopped = false, replaying = false} = {}) {
  // Authentication drops during reconnect; the battle itself has not ended.
  // After the battle, music plays only while a replay of it plays.
  return !fixture && !hidden && !stopped && !!state.room && (!state.ended || replaying);
}

// Replay music runs from the moment a replay begins until the replay reaches its last step or the finished
// battle is left. Pausing on a turn (First, Prev, Next) does not end it.
export function replayMusicOver(state, atEnd) { return !state.ended || atEnd; }

export function loopPosition(seconds, {loopStart, loopEnd}) {
  return seconds < loopEnd ? Math.max(0, seconds) : loopStart + (seconds - loopStart) % (loopEnd - loopStart);
}

export class Music {
  constructor(onChange = () => {}, {storage = globalThis.localStorage,
    createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
    fetcher = (...args) => fetch(...args), random = Math.random} = {}) {
    Object.assign(this, {onChange, storage, createContext, fetcher, random});
    this.enabled = true;
    try { this.enabled = storage?.getItem('ps-mve-music') !== 'off'; } catch {}
    this.active = false; this.offset = 0; this.error = ''; this.loading = null;
    this.track = this.otherTrack();
  }
  get unlocked() { return this.context?.state === 'running'; }
  get label() {
    if (!this.enabled) return 'Music off';
    if (this.error) return 'Music · tap to retry';
    if (!this.unlocked) return 'Music · tap to resume';
    if (this.loading) return 'Music loading…';
    return 'Music on';
  }
  unlock() {
    if (!this.enabled) return;
    // Called directly in a trusted gesture, before any network/decode await.
    // Reattempt resume even if an earlier autoplay attempt is still pending.
    this.error = '';
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = VOLUME;
        this.gain.connect(this.context.destination);
        this.context.addEventListener('statechange', () => this.sync());
      }
      if (!this.unlocked) {
        Promise.resolve(this.context.resume()).then(() => this.sync()).catch(() => {
          this.onChange(); // A later touch/keypress can resume an interrupted context.
        });
      }
      this.sync();
    } catch { this.error = 'Audio is unavailable. Tap to retry.'; this.onChange(); }
  }
  load() {
    if (this.loading || this.buffer || this.error) return;
    const track = this.track;
    const loading = this.loading = Promise.resolve().then(async () => {
      let buffer = null, error = '';
      try {
        const response = await this.fetcher(track.url, {mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('Audio download failed');
        buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (buffer.duration < track.loopEnd) throw new Error('Audio is shorter than the pinned loop');
      } catch { buffer = null; error = 'Music could not load. Tap to retry.'; }
      // A new battle picked another tune while this one downloaded: its own download owns the result.
      if (this.loading !== loading) return;
      this.buffer = buffer; this.error = error; this.loading = null; this.sync();
    });
  }
  sync() {
    const wanted = this.enabled && this.active && this.unlocked;
    if (!wanted) this.pause();
    else if (!this.buffer) this.load();
    else if (!this.source && !this.error) {
      try {
        const source = this.context.createBufferSource();
        source.buffer = this.buffer;
        source.loop = true; source.loopStart = this.track.loopStart; source.loopEnd = this.track.loopEnd;
        source.connect(this.gain);
        source.start(0, this.offset);
        this.startedAt = this.context.currentTime; this.source = source;
      } catch { this.error = 'Music could not start. Tap to retry.'; }
    }
    this.onChange();
  }
  pause() {
    if (!this.source) return;
    this.offset = loopPosition(this.offset + this.context.currentTime - this.startedAt, this.track);
    this.source.stop(); this.source.disconnect(); this.source = null;
  }
  update(active) { this.active = active; this.sync(); }
  // A replay starts the song from its very beginning, intro included.
  rewind() { this.pause(); this.offset = 0; }
  otherTrack() {
    const others = TRACKS.filter(candidate => candidate !== this.track);
    return others[Math.floor(this.random() * others.length)];
  }
  // A new battle plays a different tune from its very beginning.
  newBattle() {
    this.pause();
    this.track = this.otherTrack();
    this.offset = 0; this.buffer = null; this.loading = null; this.error = '';
    this.sync();
  }
  // A short warning tone. It needs the same unlocked audio context as the music, and it is not part of the tune:
  // it goes straight to the output, so it sounds whether or not music is playing.
  tone() {
    if (!this.unlocked) return;
    const now = this.context.currentTime, oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    oscillator.connect(gain); gain.connect(this.context.destination);
    oscillator.start(now); oscillator.stop(now + 0.25);
  }
  // A Pokémon's cry: a short file under ./audio/cries/, downloaded and decoded once, then kept. It starts `delay`
  // seconds from now at the music's volume, and it is not part of the tune. A cry that is still not ready a second
  // after its moment is skipped, because it would no longer match the animation.
  cry(url, delay = 0) {
    if (!this.unlocked) return;
    const due = this.context.currentTime + delay;
    this.cries ||= new Map();
    if (!this.cries.has(url)) {
      this.cries.set(url, Promise.resolve().then(async () => {
        const response = await this.fetcher(url, {credentials: 'omit', signal: AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('Cry download failed');
        return await this.context.decodeAudioData(await response.arrayBuffer());
      }).catch(() => { this.cries.delete(url); return null; }));
    }
    this.cries.get(url).then(buffer => {
      if (!buffer || !this.unlocked || this.context.currentTime > due + 1) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer; source.connect(this.gain);
      source.start(Math.max(due, this.context.currentTime));
    });
  }
  toggle() {
    this.enabled = !this.enabled;
    try { this.storage?.setItem('ps-mve-music', this.enabled ? 'on' : 'off'); } catch {}
    if (this.enabled) this.unlock();
    else this.sync();
  }
  retryOrToggle() {
    if (this.enabled && (this.error || !this.unlocked)) this.unlock();
    else this.toggle();
  }
}
