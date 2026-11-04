import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowdownBridgeAuth, sessionBridgeConfig, SHOWDOWN_ORIGIN} from '../src/session-bridge.mjs';
import {ShowdownSessionAuth} from '../src/session-upkeep.mjs';
import {installControllerLauncher} from '../src/userscript-launcher.mjs';
import {ShowdownSession} from '../src/session.mjs';
import {demoRequest} from '../src/demo.mjs';
import {createStorage} from '../src/storage.mjs';

const username = 'mepc36363636';
const frontend = 'https://controller.example.test';
const nonce = '11111111-1111-4111-a111-111111111111';
const signed = challenge => `${challenge.split('|')[1]},${username},2,1234567890,sim3.psim.us;signature`;
const flush = () => new Promise(resolve => setImmediate(resolve));
function view() {
  const listeners = new Set();
  return {location: {origin: frontend, hash: ''},
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { listeners.delete(fn); },
    deliver(event) { for (const fn of listeners) fn(event); },
  };
}
function client(t, options = {}) {
  const child = view(), sent = [];
  child.parent = {postMessage: (data, origin) => sent.push({data, origin})};
  const auth = new ShowdownBridgeAuth(username, {view: child, nonce, ...options});
  t.after(() => auth.dispose());
  const reply = (data = {}, event = {}) => child.deliver({source: child.parent, origin: SHOWDOWN_ORIGIN,
    data: {type: 'ps-controller-auth-result', nonce, id: sent.at(-1)?.data.id,
      assertion: signed('4|challengea'), user: username, ...data}, ...event});
  return {child, sent, auth, reply};
}

test('bridge configuration never takes an origin/account/server from URL input', () => {
  const child = view(); child.parent = {};
  assert.deepEqual(sessionBridgeConfig(child), {});
  child.location.hash = `#ps-controller=${nonce}&parentOrigin=https://evil.test&username=other`;
  assert.deepEqual(sessionBridgeConfig(child), {authMode: 'showdown-session', launcherNonce: nonce, parentOrigin: SHOWDOWN_ORIGIN});
  child.parent = child;
  assert.deepEqual(sessionBridgeConfig(child), {});
});

test('standalone pages and invalid challenges cannot request session authentication', async t => {
  const {child, auth, sent} = client(t);
  await assert.rejects(auth.assertion('4|bad\n/forfeit'), /new Showdown login challenge/);
  child.parent = child;
  assert.equal(auth.hasToken(), false);
  await assert.rejects(auth.assertion('4|challengea'), /using the userscript/);
  assert.equal(sent.length, 0);
});

test('child ignores forged origins, other windows, stale nonces and unrelated requests', async t => {
  const {auth, reply, sent} = client(t);
  let done = false;
  const result = auth.assertion('4|challengea').then(value => { done = true; return value; });
  assert.equal(sent[0].origin, SHOWDOWN_ORIGIN);
  reply({}, {origin: 'https://play.pokemonshowdown.com.evil.test'});
  reply({}, {source: {}});
  reply({nonce: crypto.randomUUID()});
  reply({id: crypto.randomUUID()});
  reply({type: 'ps-controller-ready'});
  await flush(); assert.equal(done, false);
  reply();
  assert.deepEqual(await result, {assertion: signed('4|challengea'), user: username});
  assert.equal(auth.pending.size, 0);
});

test('child validates the expected account and the challenge inside each assertion', async t => {
  for (const payload of [{user: 'someoneelse'}, {assertion: signed('4|challengeb')},
    {assertion: signed('4|challengea').replace(username, 'someoneelse')},
    {assertion: signed('4|challengea') + '\n/forfeit'}, {assertion: ';'}]) {
    const {auth, reply} = client(t);
    const result = auth.assertion('4|challengea'); reply(payload);
    await assert.rejects(result, /invalid assertion/);
  }
});

test('bridge timeouts and closing release requests; late responses cannot revive them', async t => {
  const {auth, reply} = client(t, {timeoutMs: 5});
  await assert.rejects(auth.assertion('4|challengea'), /did not respond/);
  reply(); assert.equal(auth.pending.size, 0);
  const result = auth.assertion('4|challengeb'); auth.dispose();
  await assert.rejects(result, /closed/);
  assert.equal(auth.hasToken(), false);
});

// Minimal DOM fixture. Only selectors inside the launcher's own shadow root are
// available: querying any official component would make these tests fail.
function launcher(t, auth) {
  const parent = view(); parent.location.origin = SHOWDOWN_ORIGIN; parent.top = parent;
  const old = {window: globalThis.window, document: globalThis.document};
  const hosts = [], frames = [], buttons = Object.fromEntries(['.open', '.exit', '.failure'].map(key => [key, {hidden: false, focus() {}}]));
  let currentChild;
  parent.postMessage = (data, origin) => {
    assert.equal(origin, SHOWDOWN_ORIGIN);
    const source = currentChild;
    queueMicrotask(() => parent.deliver({data, source, origin: frontend}));
  };
  const root = {querySelector(selector) { assert.ok(buttons[selector]); return buttons[selector]; },
    prepend(frame) { frames.push(frame); currentChild = frame.contentWindow; }};
  globalThis.window = parent;
  globalThis.document = {
    getElementById(id) { assert.equal(id, 'ps-independent-controller-launcher'); return hosts[0]; },
    body: {append(host) { hosts.push(host); }},
    createElement(tag) {
      if (tag === 'div') return {attachShadow: () => root, setAttribute() {}, removeAttribute() {}};
      assert.equal(tag, 'iframe');
      const child = view(); child.parent = parent;
      const messages = [];
      child.postMessage = (data, origin) => {
        messages.push({data, origin}); assert.equal(origin, frontend);
        queueMicrotask(() => child.deliver({data, source: parent, origin: SHOWDOWN_ORIGIN}));
      };
      return {contentWindow: child, messages, remove() { this.removed = true; }, focus() {}};
    },
  };
  const options = {frontendUrl: frontend + '/', auth};
  installControllerLauncher(options); installControllerLauncher(options);
  assert.equal(hosts.length, 1);
  buttons['.open'].onclick();
  const frameNonce = () => new URL(frames.at(-1).src).hash.slice('#ps-controller='.length);
  const send = (data = {}, event = {}) => parent.deliver({source: frames.at(-1).contentWindow, origin: frontend,
    data: {nonce: frameNonce(), type: 'ps-controller-auth', id: crypto.randomUUID(), challenge: '4|challengea', ...data}, ...event});
  t.after(() => { buttons['.exit'].onclick(); Object.assign(globalThis, old); });
  return {parent, frames, buttons, send, frameNonce};
}

test('parent requests assertions only for its exact frame, origin and nonce', async t => {
  const calls = [];
  const harness = launcher(t, {assertion: async challenge => { calls.push(challenge); return {assertion: signed(challenge), user: username}; }});
  const {send, frames} = harness;
  send({}, {origin: 'https://evil.test'}); send({}, {source: {}});
  send({nonce}); send({type: 'other'}); send({id: 'bad'});
  await flush(); assert.deepEqual(calls, []);
  send({url: 'https://evil.test', username: 'someoneelse'});
  await flush();
  assert.deepEqual(calls, ['4|challengea']);
  assert.equal(frames[0].messages[0].data.user, username);
  assert.equal(frames[0].messages[0].origin, frontend);
  assert.equal(frames[0].srcdoc, undefined);
  assert.equal(frames[0].allow, 'autoplay; gamepad; fullscreen');
});

test('closing aborts upkeep; an old frame cannot receive credentials after reopening', async t => {
  let finish, signal;
  const {send, frames, buttons, frameNonce} = launcher(t, {assertion: (challenge, options) => {
    signal = options.signal; return new Promise(resolve => { finish = () => resolve({assertion: signed(challenge), user: username}); });
  }});
  const oldNonce = frameNonce(), oldFrame = frames[0];
  const id = crypto.randomUUID(); send({id}); send({id});
  buttons['.exit'].onclick(); assert.equal(signal.aborted, true);
  buttons['.open'].onclick(); assert.notEqual(frameNonce(), oldNonce);
  finish(); await flush();
  assert.equal(oldFrame.messages.length, 0); assert.equal(frames[1].messages.length, 0);
  send({nonce: oldNonce}, {source: oldFrame.contentWindow});
  await flush(); assert.equal(frames[1].messages.length, 0);
});

test('full bridge authenticates fresh socket challenges and restores a pending turn without replay', async t => {
  const challenges = [], sockets = [];
  const upkeep = new ShowdownSessionAuth(username, {origin: SHOWDOWN_ORIGIN, request: async url => {
    const challenge = new URL(url).searchParams.get('challstr'); challenges.push(challenge);
    return new Response(']' + JSON.stringify({loggedin: true, username, assertion: signed(challenge)}));
  }});
  const {frames, frameNonce} = launcher(t, upkeep);
  const auth = new ShowdownBridgeAuth(username, {view: frames[0].contentWindow, nonce: frameNonce()});
  t.after(() => auth.dispose());
  class Socket { readyState = 1; sent = []; constructor() { sockets.push(this); } close() {} send(text) { this.sent.push(text); } }
  const session = new ShowdownSession({url: 'wss://test.invalid', username, auth, Socket, storage: createStorage(() => { throw Error(); }), schedule() {}, cancel() {}});
  session.connect(); session.receive('|challstr|4|challengea'); await flush();
  assert.deepEqual(sockets[0].sent, [`|/trn ${username},0,${signed('4|challengea')}`]);
  session.receive(`|updateuser|${username}|1|1`);
  const room = 'battle-gen9randombattle-12345', snapshot = `>${room}\n|init|battle\n|request|${JSON.stringify(demoRequest)}`;
  session.receive(snapshot); session.choose('move', 1);
  session.connect(); session.receive('|challstr|4|challengeb'); await flush();
  session.receive(`|updateuser|${username}|1|1`);
  session.receive(snapshot + '\n|sentchoice|move 1');
  assert.deepEqual(challenges, ['4|challengea', '4|challengeb']);
  assert.equal(sockets[1].sent[0], `|/trn ${username},0,${signed('4|challengeb')}`);
  assert.ok(sockets[1].sent.includes(`|/join ${room}`));
  assert.equal(session.state.pending, true);
  assert.equal(sockets[1].sent.some(message => /\/choose|\/search/.test(message)), false);
  session.stop();
});

test('denied iframe storage falls back to memory for room recovery within the frame', () => {
  const storage = createStorage(() => { throw new DOMException('Blocked', 'SecurityError'); });
  storage.setItem('ps-mve-room', 'battle-gen9randombattle-12345');
  assert.equal(storage.getItem('ps-mve-room'), 'battle-gen9randombattle-12345');
  storage.removeItem('ps-mve-room'); assert.equal(storage.getItem('ps-mve-room'), null);
});
