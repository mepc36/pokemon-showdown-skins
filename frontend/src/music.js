// Milliseconds in pinned Showdown battle-animations.ts, converted to seconds.
export const TRACK = {url: './audio/bw-trainer.mp3',
  loopStart: 14.629, loopEnd: 110.109, volume: 0.22};

export function musicActive(state, {fixture = false, hidden = false, stopped = false} = {}) {
  // Authentication drops during reconnect; the battle itself has not ended.
  return !fixture && !hidden && !stopped && !!state.room && !state.ended;
}

export function loopPosition(seconds) {
  return seconds < TRACK.loopEnd ? Math.max(0, seconds) :
    TRACK.loopStart + (seconds - TRACK.loopStart) % (TRACK.loopEnd - TRACK.loopStart);
}

export class Music {
  constructor(onChange = () => {}, {storage = globalThis.localStorage,
    createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
    fetcher = (...args) => fetch(...args)} = {}) {
    Object.assign(this, {onChange, storage, createContext, fetcher});
    this.enabled = true;
    try { this.enabled = storage?.getItem('ps-mve-music') !== 'off'; } catch {}
    this.active = false; this.offset = 0; this.error = ''; this.loading = null;
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
        this.gain.gain.value = TRACK.volume;
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
    this.loading = Promise.resolve().then(async () => {
      try {
        const response = await this.fetcher(TRACK.url, {mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(30000)});
        if (!response.ok) throw new Error('Audio download failed');
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (buffer.duration < TRACK.loopEnd) throw new Error('Audio is shorter than the pinned loop');
        this.buffer = buffer;
      } catch { this.error = 'Music could not load. Tap to retry.'; }
      finally { this.loading = null; this.sync(); }
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
        source.loop = true; source.loopStart = TRACK.loopStart; source.loopEnd = TRACK.loopEnd;
        source.connect(this.gain);
        source.start(0, this.offset);
        this.startedAt = this.context.currentTime; this.source = source;
      } catch { this.error = 'Music could not start. Tap to retry.'; }
    }
    this.onChange();
  }
  pause() {
    if (!this.source) return;
    this.offset = loopPosition(this.offset + this.context.currentTime - this.startedAt);
    this.source.stop(); this.source.disconnect(); this.source = null;
  }
  update(active) { this.active = active; this.sync(); }
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
