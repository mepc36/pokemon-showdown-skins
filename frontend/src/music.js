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

export function musicActive(state, {fixture = false, hidden = false, stopped = false, replaying = false} = {}) {
  // Authentication drops during reconnect; the battle itself has not ended.
  // After the battle, music plays only while a replay of it plays.
  return !fixture && !hidden && !stopped && !!state.room && (!state.ended || replaying);
}

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
