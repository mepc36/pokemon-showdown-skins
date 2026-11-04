import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowdownSessionAuth} from '../src/session-upkeep.mjs';
import {ShowdownSession} from '../src/session.mjs';
import {demoRequest} from '../src/demo.mjs';

const origin = 'https://play.pokemonshowdown.com';
const username = 'mepc36363636';
const signed = challenge => `${challenge.split('|')[1]},${username},2,1234567890,sim3.psim.us;signature`;
const data = challenge => ({loggedin: true, username, assertion: signed(challenge)});
const response = body => new Response(']' + JSON.stringify(body));

test('same-origin upkeep uses browser-managed cookies and returns only an assertion and name', async () => {
  const calls = [];
  const auth = new ShowdownSessionAuth(username, {origin, request: async (url, options) => {
    calls.push({url, options}); return response(data('4|challengea'));
  }});
  assert.equal(auth.configured, true);
  assert.equal(auth.hasToken(), true);
  assert.deepEqual(await auth.assertion('4|challengea'), {assertion: signed('4|challengea'), user: username});
  const url = new URL(calls[0].url);
  assert.equal(url.origin, origin); assert.equal(url.pathname, '/api/upkeep');
  assert.equal(url.searchParams.get('challstr'), '4|challengea');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.mode, 'same-origin');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers, undefined);
});

test('Pages, opaque and lookalike origins cannot use session authentication', async () => {
  for (const origin of ['https://mepc36.github.io', 'null', 'https://play.pokemonshowdown.com.example.org']) {
    let requested = false;
    const auth = new ShowdownSessionAuth(username, {origin, request: async () => { requested = true; }});
    assert.equal(auth.hasToken(), false);
    await assert.rejects(auth.assertion('4|challengea'), /only inside/);
    assert.equal(requested, false);
  }
});

test('guest and other-account sessions cannot authenticate the controller', async () => {
  for (const body of [{loggedin: false}, {...data('4|challengea'), username: 'someoneelse'}]) {
    const auth = new ShowdownSessionAuth(username, {origin, request: async () => response(body)});
    await assert.rejects(auth.assertion('4|challengea'), /Back to Showdown/);
  }
});

test('assertions for another challenge/account and malformed responses are rejected', async () => {
  for (const assertion of [signed('4|challengeb'), signed('4|challengea').replace(username, 'anotheruser'), ';', '<html>blocked</html>', signed('4|challengea') + '\n/forfeit']) {
    const auth = new ShowdownSessionAuth(username, {origin, request: async () => response({...data('4|challengea'), assertion})});
    await assert.rejects(auth.assertion('4|challengea'), /valid assertion/);
  }
});

test('a lost cookie is checked on every new assertion, never replaced by a cached assertion', async () => {
  let loggedin = true;
  const auth = new ShowdownSessionAuth(username, {origin, request: async url => response({
    ...data(new URL(url).searchParams.get('challstr')), loggedin,
  })});
  await auth.assertion('4|challengea'); loggedin = false;
  await assert.rejects(auth.assertion('4|challengeb'), /Back to Showdown/);
});

test('network, HTTP and non-JSON failures show controlled errors', async () => {
  const cases = [
    [async () => { throw new Error('network details'); }, /Could not reach/],
    [async () => new Response('blocked', {status: 403}), /HTTP 403/],
    [async () => new Response('<html>service unavailable</html>'), /unreadable/],
  ];
  for (const [request, expected] of cases) {
    const auth = new ShowdownSessionAuth(username, {origin, request});
    await assert.rejects(auth.assertion('4|challengea'), expected);
  }
});

test('invalid challenges do not contact the login endpoint', async () => {
  for (const challenge of ['', '/forfeit', '4|challenge\nextra', '4|' + 'a'.repeat(5000)]) {
    const auth = new ShowdownSessionAuth(username, {origin, request: () => { throw new Error('must not fetch'); }});
    await assert.rejects(auth.assertion(challenge), /new Showdown login challenge/);
  }
});

test('real session adapter authenticates a new socket and restores pending choices without replay', async () => {
  const requests = [], sockets = [], stored = new Map();
  const auth = new ShowdownSessionAuth(username, {origin, request: async url => {
    const challenge = new URL(url).searchParams.get('challstr'); requests.push(challenge);
    return response(data(challenge));
  }});
  class Socket {
    readyState = 1; sent = [];
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; }
    send(message) { this.sent.push(message); }
  }
  const session = new ShowdownSession({url: 'wss://test.invalid', username, auth, Socket,
    storage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key)},
    schedule: () => 0, cancel: () => {},
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  session.connect(); session.receive('|challstr|4|challengea'); await flush();
  assert.equal(sockets[0].sent[0], `|/trn ${username},0,${signed('4|challengea')}`);
  assert.equal(session.state.authenticated, false);
  session.receive(`|updateuser|${username}|1|1`);
  const room = 'battle-gen9randombattle-12345';
  const snapshot = `>${room}\n|init|battle\n|request|${JSON.stringify(demoRequest)}`;
  session.receive(snapshot); session.choose('move', 1);
  session.connect(); session.receive('|challstr|4|challengeb'); await flush();
  assert.deepEqual(requests, ['4|challengea', '4|challengeb']);
  assert.equal(sockets[1].sent[0], `|/trn ${username},0,${signed('4|challengeb')}`);
  session.receive(`|updateuser|${username}|1|1`);
  assert.ok(sockets[1].sent.includes(`|/join ${room}`));
  session.receive(snapshot + '\n|sentchoice|move 1');
  assert.equal(session.state.pending, true);
  assert.equal(sockets[1].sent.some(message => /\/choose|\/search/.test(message)), false);
  session.stop();
});

test('a delayed assertion from a disconnected socket is never sent on its replacement', async () => {
  const resolvers = [], sockets = [];
  const auth = new ShowdownSessionAuth(username, {origin, request: url => new Promise(resolve => {
    const challenge = new URL(url).searchParams.get('challstr');
    resolvers.push(() => resolve(response(data(challenge))));
  })});
  class Socket { readyState = 1; sent = []; constructor() { sockets.push(this); } close() {} send(text) { this.sent.push(text); } }
  const session = new ShowdownSession({url: 'wss://test.invalid', username, auth, Socket,
    storage: {getItem() {}, setItem() {}, removeItem() {}}, cancel() {}, schedule() {},
  });
  session.connect(); session.receive('|challstr|4|challengea');
  session.connect(); session.receive('|challstr|4|challengeb');
  resolvers[0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets[1].sent.length, 0);
  resolvers[1](); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sockets[1].sent, [`|/trn ${username},0,${signed('4|challengeb')}`]);
  session.stop();
});
