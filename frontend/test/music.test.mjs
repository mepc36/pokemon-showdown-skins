import test from 'node:test';
import assert from 'node:assert/strict';
import {Music, TRACKS, loopPosition, musicActive} from '../src/music.js';
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
