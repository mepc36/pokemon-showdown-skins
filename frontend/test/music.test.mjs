import test from 'node:test';
import assert from 'node:assert/strict';
import {Music, cryFile, TRACKS, TIMER_TONES, timerToneDue, loopPosition, musicActive, replayMusicOver} from '../src/music.js';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
function setup({fetcher, suspended = false, resume, random} = {}) {
  const sources = [], saved = new Map();
  const context = {state: suspended ? 'suspended' : 'running', currentTime: 0,
    createGain: () => ({gain: {}, connect() {}}), addEventListener(_, callback) { this.change = callback; },
    resume: resume || (() => { context.state = 'running'; return Promise.resolve(); }),
    decodeAudioData: async () => ({duration: 200}),
    createBufferSource: () => {
      const source = {connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(_, offset) { this.offset = offset; }};
      sources.push(source); return source;
    }};
  const storage = {getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value)};
  const music = new Music(() => {}, {createContext: () => context, storage, ...(random ? {random} : {}),
    fetcher: fetcher || (async (_, options) => { assert.equal(options.credentials, 'omit'); return {ok: true, arrayBuffer: async () => new ArrayBuffer(1)}; })});
  return {music, context, sources, saved};
}

test('one native loop source survives turn updates and preserves loop points', async () => {
  const {music, sources} = setup();
  music.update(true); assert.equal(sources.length, 0);
  music.unlock(); await flush();
  for (let i = 0; i < 100; i++) music.update(true);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  assert.equal(sources[0].loopStart, music.track.loopStart);
  assert.equal(sources[0].loopEnd, music.track.loopEnd);
  assert.equal(sources[0].offset, 0);
});

test('toggle stops sound immediately and resumes position after multiple loops', async () => {
  const {music, context, sources, saved} = setup();
  music.update(true); music.unlock(); await flush();
  context.currentTime = 310;
  music.toggle();
  assert.equal(saved.get('ps-mve-music'), 'off');
  assert.ok(sources[0].stopped);
  const offset = loopPosition(310, music.track);
  assert.ok(offset >= music.track.loopStart && offset < music.track.loopEnd);
  context.currentTime = 400;
  music.toggle();
  assert.equal(sources[1].offset, offset);
  music.update(false); music.update(true);
  assert.ok(Math.abs(sources[2].offset - offset) < 1e-9);
});

test('mute or battle end while audio downloads cannot start stale playback', async () => {
  for (const stop of [m => m.toggle(), m => m.update(false)]) {
    const pending = deferred();
    const {music, sources} = setup({fetcher: () => pending.promise});
    music.update(true); music.unlock(); stop(music);
    pending.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(1)});
    await flush();
    assert.equal(sources.length, 0);
    assert.ok(music.buffer);
  }
});

test('late context resume obeys latest enabled and active state', async () => {
  const pending = deferred();
  const {music, context, sources} = setup({suspended: true, resume: () => pending.promise});
  music.update(true); music.unlock(); music.toggle();
  context.state = 'running'; pending.resolve(); await flush();
  assert.equal(sources.length, 0);
});

test('OS suspension pauses at the current position and a gesture can resume', async () => {
  const {music, context, sources} = setup();
  music.update(true); music.unlock(); await flush();
  context.currentTime = 25; context.state = 'interrupted'; context.change();
  assert.ok(sources[0].stopped); assert.equal(music.unlocked, false);
  music.unlock(); await flush();
  assert.equal(sources[1].offset, 25);
});

test('load failures do not retry on every update; gesture explicitly retries', async () => {
  let attempts = 0;
  const {music, sources} = setup({fetcher: async () => {
    if (++attempts === 1) throw new Error('offline');
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(1)};
  }});
  music.update(true); music.unlock(); await flush();
  for (let i = 0; i < 20; i++) music.update(true);
  assert.equal(attempts, 1); assert.match(music.label, /retry/);
  music.retryOrToggle(); await flush();
  assert.equal(attempts, 2); assert.equal(sources.length, 1);
});

test('background updates, explicit sign out and ended battles stay silent; reconnect keeps music', () => {
  const battle = {room: 'battle-gen9randombattle-1', authenticated: true};
  assert.equal(musicActive(battle), true);
  assert.equal(musicActive({...battle, authenticated: false, recovering: true}), true);
  for (const options of [{hidden: true}, {fixture: true}, {stopped: true}]) assert.equal(musicActive(battle, options), false);
  assert.equal(musicActive({...battle, ended: true}), false);
  assert.equal(musicActive({}), false);
});

test('after the battle, music plays only while its replay plays', () => {
  const ended = {room: 'battle-gen9randombattle-1', authenticated: true, ended: true};
  assert.equal(musicActive(ended, {replaying: true}), true);
  assert.equal(musicActive(ended, {replaying: false}), false);
  assert.equal(musicActive(ended, {replaying: true, hidden: true}), false);
});

test('rewind restarts the song from its very beginning, intro included', async () => {
  const {music, context, sources} = setup();
  music.update(true); music.unlock(); await flush();
  context.currentTime = 40; music.update(false); music.update(true);
  assert.equal(sources.at(-1).offset, 40);
  music.rewind(); music.update(true);
  assert.ok(sources.at(-2).stopped);
  assert.equal(sources.at(-1).offset, 0);
});

test('loop boundary wraps to upstream intro-free start', () => {
  for (const track of TRACKS) {
    assert.equal(loopPosition(0, track), 0);
    assert.equal(loopPosition(track.loopEnd, track), track.loopStart);
    assert.ok(Math.abs(loopPosition(track.loopEnd + 0.5, track) - track.loopStart - 0.5) < 1e-6);
  }
});

test('all 19 battle themes are listed once with a loop inside the file', () => {
  assert.equal(TRACKS.length, 19);
  assert.equal(new Set(TRACKS.map(track => track.url)).size, 19);
  assert.ok(TRACKS.every(track => /^\.\/audio\/[a-z0-9-]+\.mp3$/.test(track.url) && track.loopStart > 0 && track.loopEnd > track.loopStart));
});

test('a new battle starts a different tune from its very beginning', async () => {
  const urls = [];
  const {music, context, sources} = setup({fetcher: async url => { urls.push(url); return {ok: true, arrayBuffer: async () => new ArrayBuffer(1)}; }});
  music.newBattle(); const first = music.track;
  music.update(true); music.unlock(); await flush();
  assert.equal(urls.at(-1), first.url); assert.equal(sources.at(-1).offset, 0);
  context.currentTime = 40;
  for (let battle = 0; battle < 50; battle++) {
    const previous = music.track, started = sources.length;
    music.update(false); music.newBattle(); music.update(true); await flush();
    assert.notEqual(music.track, previous);
    assert.equal(urls.at(-1), music.track.url);
    assert.equal(sources.length, started + 1);
    assert.equal(sources.at(-1).offset, 0);
    assert.equal(sources.at(-1).loopStart, music.track.loopStart);
    assert.equal(sources.at(-1).loopEnd, music.track.loopEnd);
  }
});

test('a tune still downloading when the next battle starts never plays', async () => {
  const pending = [];
  const {music, sources} = setup({fetcher: url => { const wait = deferred(); pending.push({url, wait}); return wait.promise; }});
  music.newBattle(); music.update(true); music.unlock(); await flush();
  music.newBattle(); await flush();
  assert.equal(pending.length, 2); assert.equal(pending[1].url, music.track.url); assert.notEqual(pending[0].url, pending[1].url);
  pending[0].wait.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(1)}); await flush();
  assert.equal(sources.length, 0); assert.equal(music.buffer, null);
  pending[1].wait.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(1)}); await flush();
  assert.equal(sources.length, 1); assert.equal(sources[0].loopEnd, music.track.loopEnd);
});

test('your clock sounds one tone as it passes 60, 30, 20, 15, 10 and 5 seconds, and none otherwise', () => {
  assert.deepEqual(TIMER_TONES, [60, 30, 20, 15, 10, 5]);
  const tones = []; let previous = null;
  for (let seconds = 150; seconds >= 0; seconds--) { if (timerToneDue(previous, seconds)) tones.push(seconds); previous = seconds; }
  assert.deepEqual(tones, [60, 30, 20, 15, 10, 5]);
  assert.equal(timerToneDue(null, 30), false, 'the first reading of a clock is silent');
  assert.equal(timerToneDue(30, null), false, 'a clock that stops is silent');
  assert.equal(timerToneDue(25, 150), false, 'a clock that goes back up is silent');
  assert.equal(timerToneDue(30, 30), false, 'a clock that holds still is silent');
  assert.equal(timerToneDue(100, 25), true, 'a jump past several marks sounds once');
});

test('the tone plays only once audio is unlocked and does not touch the tune', async () => {
  const {music, context, sources} = setup({suspended: true});
  const oscillators = [];
  context.createOscillator = () => { const oscillator = {frequency: {}, connect() {}, start(at) { this.startedAt = at; }, stop(at) { this.stoppedAt = at; }}; oscillators.push(oscillator); return oscillator; };
  context.createGain = () => ({gain: {setValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}});
  music.tone(); assert.equal(oscillators.length, 0);
  music.update(true); music.unlock(); await flush();
  music.tone();
  assert.equal(oscillators.length, 1); assert.ok(oscillators[0].stoppedAt > oscillators[0].startedAt);
  assert.equal(sources.length, 1); assert.equal(sources[0].stopped, undefined);
});

test('replay music lasts until the replay reaches its last step or the finished battle is left', () => {
  assert.equal(replayMusicOver({ended: true}, false), false, 'a replay paused on a turn, or still playing, keeps its music');
  assert.equal(replayMusicOver({ended: true}, true), true, 'the last step ends it');
  assert.equal(replayMusicOver({ended: false}, false), true, 'a new search or battle ends it');
});

const cryPlayers = (context, sources) => { context.createBufferSource = () => { const source = {connect(target) { this.target = target; }, start(at) { this.startedAt = at; }}; sources.push(source); return source; }; };
test('a cry plays once audio is unlocked, at its moment, and each file is downloaded once', async () => {
  const urls = [];
  const {music, context, sources} = setup({suspended: true, fetcher: async url => { urls.push(url); return {ok: true, arrayBuffer: async () => new ArrayBuffer(1)}; }});
  cryPlayers(context, sources);
  music.cry('./audio/cries/raichu.mp3', 0.8); await flush();
  assert.equal(urls.length, 0, 'locked audio downloads and plays nothing');
  music.unlock(); await flush();
  context.currentTime = 10;
  music.cry('./audio/cries/raichu.mp3', 0.8); await flush();
  assert.deepEqual(urls, ['./audio/cries/raichu.mp3']);
  assert.equal(sources.length, 1); assert.equal(sources[0].startedAt, 10.8); assert.equal(sources[0].loop, undefined);
  assert.equal(sources[0].target, music.gain, 'a cry uses the music volume');
  music.cry('./audio/cries/raichu.mp3', 0.8); await flush();
  assert.equal(urls.length, 1, 'the second switch-in reuses the decoded cry'); assert.equal(sources.length, 2);
});

test('a cry that is ready more than a second late is skipped, and a failed download is tried again next time', async () => {
  const slow = deferred(); let calls = 0;
  const {music, context, sources} = setup({fetcher: async () => { calls++; return calls === 1 ? slow.promise : {ok: false}; }});
  cryPlayers(context, sources);
  music.unlock(); await flush();
  music.cry('./audio/cries/landorus-therian.mp3', 0.3);
  context.currentTime = 2;
  slow.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(1)}); await flush();
  assert.equal(sources.length, 0, 'too late for the animation');
  music.cry('./audio/cries/landorus-therian.mp3', 0.3); await flush();
  assert.equal(calls, 1); assert.equal(sources.length, 1); assert.equal(sources[0].startedAt, 2.3, 'the kept cry plays on the next switch-in');
  music.cry('./audio/cries/unknown.mp3'); await flush();
  music.cry('./audio/cries/unknown.mp3'); await flush();
  assert.equal(calls, 3, 'a missing file is asked for again'); assert.equal(sources.length, 1);
});

test('a forme uses its base species cry unless Showdown has a cry for that forme', () => {
  assert.equal(cryFile({baseSpecies: 'Raichu', formeid: ''}), './audio/cries/raichu.mp3');
  assert.equal(cryFile({baseSpecies: 'Rotom', formeid: '-wash'}), './audio/cries/rotom.mp3');
  assert.equal(cryFile({baseSpecies: 'Landorus', formeid: '-therian'}), './audio/cries/landorus-therian.mp3');
  assert.equal(cryFile({baseSpecies: 'Necrozma', formeid: '-duskmane'}), './audio/cries/necrozma-duskmane.mp3');
  assert.equal(cryFile({baseSpecies: 'Ho-Oh', formeid: ''}), './audio/cries/hooh.mp3');
  assert.equal(cryFile({baseSpecies: 'Ursaluna', formeid: '-bloodmoon'}), './audio/cries/ursaluna.mp3', 'Showdown has no file for this forme');
});
