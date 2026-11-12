import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowdownSession} from '../src/session.mjs';
import {choiceCommand, availableChoices, parsePacket, isBattleEvent} from '../src/protocol.mjs';
import {risingEdges} from '../src/controller.mjs';
import {demoRequest} from '../src/demo.mjs';

const room = 'battle-gen9randombattle-12345';
const request = () => structuredClone(demoRequest);
function fixture(options = {}) {
  const sockets = [], timers = new Map(), values = new Map();
  class Socket {
    readyState = 0; sent = [];
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(message) { assert.equal(this.readyState, 1); this.sent.push(message); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { this.onmessage?.({data: message}); }
  }
  const auth = options.auth || {hasToken: () => false, assertion: async () => ({assertion: 'signed-assertion', user: 'mepc36363636'})};
  const snapshots = [];
  const session = new ShowdownSession({url: 'wss://test.invalid', username: 'mepc36363636', Socket, auth,
    storage: {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)},
    schedule: callback => { const key = Symbol(); timers.set(key, callback); return key; }, cancel: key => timers.delete(key),
    onState: state => snapshots.push(state), ...options});
  session.connect();
  const socket = sockets.at(-1); socket.open(); socket.receive('|challstr|4|challenge');
  return {session, socket, sockets, snapshots, timers, values,
    authenticate() { socket.receive('|updateuser|mepc36363636|1|1'); },
    battle(extra = '') { socket.receive(`>${room}\n|init|battle\n|request|${JSON.stringify(request())}${extra}`); },
  };
}

test('room routing preserves payload pipes', () => {
  assert.deepEqual(parsePacket(`>${room}\n|request|{}\n|sentchoice|move 1`), {room, lines: ['|request|{}', '|sentchoice|move 1']});
});
test('timer toggle follows server acknowledgement and ignores duplicate requests', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.session.toggleTimer(); f.session.toggleTimer();
  assert.equal(f.socket.sent.filter(value => value.endsWith('|/timer on')).length, 1);
  assert.equal(f.session.state.timerOn, false);
  f.socket.receive(`>${room}\n|inactive|Time left: 150 sec this turn | 150 sec total`);
  assert.equal(f.session.state.timerOn, true); assert.equal(f.session.state.timerPending, false);
  assert.equal(f.session.timerRemaining(f.session.state.timerAt + 20000), 130);
  f.session.toggleTimer(); assert.equal(f.socket.sent.at(-1), `${room}|/timer off`);
  f.socket.receive(`>${room}\n|inactiveoff|Battle timer is OFF.`);
  assert.equal(f.session.state.timerOn, false); assert.equal(f.session.timerRemaining(), null);
});
test('their clock shows only what the server announced this turn', () => {
  const start = fixture(); start.authenticate(); start.battle();
  assert.equal(start.session.state.foeTimerSeconds, null);
  start.socket.receive(`>${room}\n|inactive|Time left: 150 sec this turn | 150 sec total`);
  assert.equal(start.session.state.foeTimerSeconds, null, 'our own clock says nothing about theirs');
  start.socket.receive(`>${room}\n|inactive|Opponent has 120 seconds left.`);
  start.socket.receive(`>${room}\n|inactive|Time left: 150 sec this turn | 160 sec total`);
  assert.equal(start.session.state.foeTimerSeconds, 120, 'a later message about our clock leaves their announced value alone');
  start.socket.receive(`>${room}\n|turn|4`);
  assert.equal(start.session.state.foeTimerSeconds, null, 'a new turn drops last turn\'s value');
  start.socket.receive(`>${room}\n|turn|5\n|inactive|Opponent has 25 seconds left this turn.`);
  assert.equal(start.session.state.foeTimerSeconds, 25, 'a low clock is announced again right after the turn line');
  start.socket.receive(`>${room}\n|-message|mepc36363636 lost due to inactivity.`);
  assert.equal(start.session.state.foeTimerSeconds, 25, 'our own timeout leaves their clock alone');
  start.socket.receive(`>${room}\n|-message|Opponent lost due to inactivity.`);
  assert.equal(start.session.state.foeTimerSeconds, 0, 'their timeout shows 0');
});
test('opponent timer warnings never replace our clock and new rooms reset it', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.socket.receive(`>${room}\n|inactive|Time left: 120 sec this turn | 150 sec total`);
  assert.equal(f.session.state.foeTimerSeconds, null);
  f.socket.receive(`>${room}\n|inactive|Opponent has 15 seconds left.`);
  assert.equal(f.session.state.timerSeconds, 120); assert.equal(f.session.state.foeTimerSeconds, 15);
  f.socket.receive(`>${room}\n|inactive|mepc36363636 has 30 seconds left.`);
  assert.equal(f.session.state.timerSeconds, 30);
  f.session.choose('move', 1); assert.equal(f.session.state.timerRunning, false);
  f.session.undo(); assert.equal(f.session.state.timerRunning, true);
  f.socket.receive(`>${room}\n|win|mepc36363636`); f.session.search();
  assert.equal(f.session.state.timerOn, false); assert.equal(f.session.state.foeTimerSeconds, null);
});
test('a silently ignored timer-off request remains on and allows retry', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.socket.receive(`>${room}\n|inactive|Battle timer is ON (requested by Opponent).`);
  f.session.toggleTimer();
  assert.equal(f.session.state.timerPending, true);
  [...f.timers.values()].at(-1)();
  assert.equal(f.session.state.timerPending, false); assert.equal(f.session.state.timerOn, true);
  f.session.toggleTimer();
  assert.equal(f.socket.sent.filter(value => value.endsWith('|/timer off')).length, 2);
});
test('search is gated on server-confirmed identity and blocks registered bots first', async () => {
  const f = fixture(); await f.session.login();
  assert.throws(() => f.session.search());
  assert.equal(f.socket.sent[0], '|/trn mepc36363636,0,signed-assertion');
  f.authenticate(); f.session.search();
  assert.deepEqual(f.socket.sent.slice(-3), ['|/noreply /blockbots', '|/utm null', '|/search gen9randombattle']);
});
test('another account does not unlock matchmaking', () => {
  const f = fixture(); f.socket.receive('|updateuser|someoneelse|1|1');
  assert.throws(() => f.session.search());
});
test('legal moves use current rqid; duplicate press cannot submit twice', () => {
  const f = fixture(); f.authenticate(); f.battle(); f.session.choose('move', 1, true);
  assert.equal(f.socket.sent.at(-1), `${room}|/choose move 1 terastallize|1`);
  assert.throws(() => f.session.choose('move', 2));
});
test('forced switches, trapping, fainting, and revival restrict available choices', () => {
  const r = request(); r.active[0].trapped = true;
  assert.equal(availableChoices(r).switches.some(p => p.enabled), false);
  delete r.active; r.forceSwitch = [true];
  assert.equal(availableChoices(r).moves.length, 0);
  r.side.pokemon[1].condition = '0 fnt';
  assert.throws(() => choiceCommand(r, 'switch', 2));
  r.side.pokemon[0].reviving = true;
  assert.equal(choiceCommand(r, 'switch', 2), '/choose switch 2|1');
});
test('wait requests and disabled moves cannot be selected', () => {
  const r = request(); r.active[0].moves[0].disabled = true;
  assert.throws(() => choiceCommand(r, 'move', 1));
  r.wait = true; assert.throws(() => choiceCommand(r, 'move', 2));
});
test('restored request + sentchoice is exposed atomically as pending', () => {
  const f = fixture(); f.authenticate(); const before = f.snapshots.length;
  f.battle('\n|sentchoice|move 2');
  assert.equal(f.snapshots.length, before + 1); assert.equal(f.snapshots.at(-1).pending, true);
  assert.throws(() => f.session.choose('move', 1));
});
test('invalid choice unlocks a revised same-rqid request', () => {
  const f = fixture(); f.authenticate(); f.battle(); f.session.choose('move', 1);
  const revised = request(); revised.active[0].moves[0].disabled = true;
  f.socket.receive(`>${room}\n|error|[Unavailable choice] Move disabled\n|request|${JSON.stringify(revised)}`);
  assert.equal(f.session.state.pending, false);
  assert.throws(() => f.session.choose('move', 1)); f.session.choose('move', 2);
});
test('reconnect authenticates and rejoins but never replays a submitted choice', () => {
  const f = fixture(); f.authenticate(); f.battle(); f.session.choose('move', 1);
  f.session.connect(); const second = f.sockets.at(-1); second.open();
  assert.equal(f.session.state.request, null); assert.equal(f.session.state.recovering, true);
  second.receive('|challstr|4|new-challenge'); second.receive('|updateuser|mepc36363636|1|1');
  assert.deepEqual(second.sent, ['|/noreply /blockbots', `|/join ${room}`]);
  second.receive(`>${room}\n|init|battle\n|request|${JSON.stringify(request())}\n|sentchoice|move 1`);
  assert.equal(f.session.state.pending, true); assert.equal(second.sent.some(x => x.includes('/choose')), false);
});
test('late assertion from an old connection is discarded', async () => {
  let resolve;
  const f = fixture({auth: {hasToken: () => false, assertion: () => new Promise(r => { resolve = r; })}});
  const signingIn = f.session.login(); f.session.connect(); f.sockets.at(-1).open();
  resolve({assertion: 'stale', user: 'mepc36363636'}); await signingIn;
  assert.equal(f.sockets.at(-1).sent.length, 0);
});
test('disconnect locks inputs, and an unrelated room cannot alter the battle request', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.socket.receive('>battle-gen9randombattle-999\n|request|{"rqid":5}');
  assert.equal(f.session.state.request.rqid, 1);
  f.socket.close(); assert.equal(f.session.state.request, null);
  assert.throws(() => f.session.choose('move', 1));
});
test('expired battle is forgotten without silently starting another match', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.socket.receive(`>${room}\n|noinit|nonexistent|Room unavailable`);
  assert.equal(f.session.state.room, ''); assert.equal(f.values.has('ps-mve-room'), false);
  assert.equal(f.session.state.searching, false);
});
test('battle end allows an explicit next search and removes recovery marker', () => {
  const f = fixture(); f.authenticate(); f.battle(); f.socket.receive(`>${room}\n|win|mepc36363636`);
  assert.equal(f.session.state.ended, true); assert.equal(f.values.has('ps-mve-room'), false);
  f.session.search(); assert.equal(f.socket.sent.at(-1), '|/search gen9randombattle');
});
test('chat and raw HTML never enter the renderer', () => {
  for (const line of ['|c|somebody|hello', '|raw|<img src=x>', '|html|<script>', '|uhtml|x|y', '|users|x']) assert.equal(isBattleEvent(line), false);
  for (const line of ['|move|p1a: A|Tackle|p2a: B', '|-damage|p1a: A|50/100', '|win|A']) assert.equal(isBattleEvent(line), true);
});
test('holding confirm only triggers once until released', () => {
  assert.deepEqual(risingEdges([false, true], [false, false]), [1]);
  assert.deepEqual(risingEdges([false, true], [false, true]), []);
});
test('undo uses a command separator, unlocks locally, and respects noCancel', () => {
  const f = fixture(); f.authenticate(); f.battle(); f.session.choose('move', 1); f.session.undo();
  assert.equal(f.socket.sent.at(-1), `${room}|/undo |1`);
  assert.equal(f.session.state.pending, false);
  f.session.choose('move', 2); f.session.state.request.noCancel = true;
  const count = f.socket.sent.length; f.session.undo();
  assert.equal(f.socket.sent.length, count);
});

test('a remembered room that the server no longer lists gives way to the live battle', () => {
  // The client remembers an old battle. On login the server lists only a new one and sends its snapshot first.
  const f = fixture(); f.session.state.room = 'battle-gen9randombattle-111'; f.values.set('ps-mve-room', 'battle-gen9randombattle-111');
  f.session.connect(); const socket = f.sockets.at(-1); socket.open(); socket.receive('|challstr|4|challenge');
  socket.receive('|updateuser|mepc36363636|1|1');
  assert.equal(f.session.state.room, 'battle-gen9randombattle-111');
  socket.receive(`|updatesearch|${JSON.stringify({searching: [], games: {[room]: '[Gen 9] Random Battle'}})}`);
  assert.equal(f.session.state.room, room, 'switches to the battle the server says is live');
  assert.ok(socket.sent.some(value => value.endsWith(`/join ${room}`)));
  socket.receive(`>${room}\n|init|battle\n|request|${JSON.stringify(request())}`);
  assert.equal(f.session.state.recovering, false);
  assert.ok(f.session.state.request, 'the live battle request is accepted, not dropped as a foreign room');
});

test('a finished remembered battle still listed by the server does not block a newer live one', () => {
  const f = fixture(); f.authenticate(); f.battle();
  f.socket.receive(`>${room}\n|win|Opponent`);
  const next = 'battle-gen9randombattle-222';
  f.socket.receive(`|updatesearch|${JSON.stringify({searching: [], games: {[room]: '[Gen 9] Random Battle', [next]: '[Gen 9] Random Battle'}})}`);
  assert.equal(f.session.state.room, next);
  assert.equal(f.session.state.ended, false);
});

test('a remembered battle the server lists no game for is forgotten, so Find Random Battle works', () => {
  const f = fixture(); f.session.state.room = 'battle-gen9randombattle-111';
  f.session.connect(); const socket = f.sockets.at(-1); socket.open(); socket.receive('|challstr|4|challenge');
  socket.receive('|updateuser|mepc36363636|1|1');
  assert.equal(f.session.state.recovering, true);
  socket.receive(`|updatesearch|${JSON.stringify({searching: [], games: null})}`);
  assert.equal(f.session.state.room, '');
  assert.equal(f.session.state.recovering, false);
  f.session.search();
  assert.ok(socket.sent.some(value => value.endsWith('/search gen9randombattle')));
});

test('a side that Terastallized stays recorded for the battle, and a new battle starts clean', () => {
  const f = fixture(); f.authenticate(); f.battle();
  assert.deepEqual(f.session.state.teraSides, []);
  f.socket.receive(`>${room}\n|-terastallize|p2a: Landorus|Water`);
  assert.deepEqual(f.session.state.teraSides, ['p2']);
  f.socket.receive(`>${room}\n|-terastallize|p1a: Gengar|Ghost\n|faint|p1a: Gengar`);
  // The request after the faint no longer marks any Pokémon as Terastallized.
  f.socket.receive(`>${room}\n|request|${JSON.stringify(request())}`);
  assert.deepEqual(f.session.state.teraSides, ['p2', 'p1']);
  f.socket.receive(`>battle-gen9randombattle-67890\n|init|battle\n|request|${JSON.stringify(request())}`);
  assert.deepEqual(f.session.state.teraSides, [], 'the next battle has its Tera again');
});
