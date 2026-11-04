import {createStorage} from './storage.mjs';
const storage = createStorage();

export class Music {
  constructor(onChange) {
    this.onChange = onChange;
    this.enabled = storage.getItem('ps-mve-music') !== 'off';
    this.audio = new Audio('https://play.pokemonshowdown.com/audio/bw-trainer.mp3');
    this.audio.loop = true; this.audio.volume = 0.22; this.audio.preload = 'none';
    this.unlocked = false; this.active = false;
  }
  unlock() {
    if (this.unlocked || this.unlocking || !this.enabled) return;
    this.unlocking = true;
    this.audio.volume = this.active ? 0.22 : 0;
    this.audio.play().then(() => {
      this.unlocked = true;
      if (!this.active) this.audio.pause();
      this.audio.volume = 0.22;
    }).catch(() => { this.unlocked = false; }).finally(() => { this.unlocking = false; this.onChange(); });
  }
  update(active) {
    this.active = active;
    if (!active || !this.enabled) this.audio.pause();
    else if (this.unlocked) this.audio.play().catch(() => { this.unlocked = false; this.onChange(); });
  }
  toggle() {
    this.enabled = !this.enabled;
    storage.setItem('ps-mve-music', this.enabled ? 'on' : 'off');
    if (this.enabled) this.unlock();
    this.update(this.active); this.onChange();
  }
}
