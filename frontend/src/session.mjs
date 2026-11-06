import {parsePacket, splitLine, toID, isBattleRoom, choiceCommand} from './protocol.mjs';

export class ShowdownSession {
  constructor({url, username, auth, storage, Socket = WebSocket, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), onState = () => {}, onBattle = () => {}}) {
    Object.assign(this, {url, expectedUser: username, auth, storage, Socket, schedule, cancel, onState, onBattle});
    this.epoch = 0;
    this.attempt = 0;
    this.stopped = true;
    this.state = {status: 'Offline', authenticated: false, challenge: '', room: '', request: null,
      pending: false, recovering: false, searching: false, ended: false, notice: '', timer: '',
      timerOn: false, timerPending: false, timerSeconds: null, timerAt: 0, timerRunning: false,
      timerWarning: '', timerWarningUntil: 0};
    const room = storage.getItem('ps-mve-room');
    if (isBattleRoom(room)) this.state.room = room;
  }
  timerRemaining(now = Date.now()) {
    if (this.state.timerSeconds == null) return null;
    return Math.max(0, this.state.timerSeconds - (this.state.timerRunning ? Math.floor((now - this.state.timerAt) / 1000) : 0));
  }
  emit() {
    const running = this.state.timerOn && this.state.timerSeconds != null && this.state.authenticated &&
      !this.stopped && !this.state.recovering && !this.state.pending && !this.state.request?.wait && !this.state.ended;
    if (running !== this.state.timerRunning) {
      this.state.timerSeconds = this.timerRemaining();
      this.state.timerAt = Date.now(); this.state.timerRunning = running;
    }
    this.onState({...this.state});
  }
  connect() {
    this.stopped = false;
    this.cancel(this.retry);
    this.cancel(this.heartbeat);
    const epoch = ++this.epoch;
    this.socket?.close();
    Object.assign(this.state, {status: 'Connecting…', authenticated: false, challenge: '', request: null,
      pending: false, searching: false, recovering: !!this.state.room, notice: ''});
    this.emit();
    const socket = this.socket = new this.Socket(this.url);
    socket.onopen = () => {
      if (epoch !== this.epoch) return;
      this.lastMessage = Date.now();
      this.state.status = 'Connected · waiting for challenge';
      this.emit();
      const pulse = () => {
        if (epoch !== this.epoch || this.stopped) return;
        if (Date.now() - this.lastMessage > 60000) { this.connect(); return; }
        this.send(`/cmd userdetails ${toID(this.expectedUser)}`);
        this.heartbeat = this.schedule(pulse, 25000);
      };
      this.heartbeat = this.schedule(pulse, 25000);
    };
    socket.onmessage = event => { if (epoch === this.epoch) { this.lastMessage = Date.now(); this.receive(event.data); } };
    socket.onerror = () => { if (epoch === this.epoch) this.state.notice = 'Connection failed. Check your network.'; };
    socket.onclose = () => {
      if (epoch !== this.epoch || this.stopped) return;
      this.cancel(this.heartbeat);
      Object.assign(this.state, {status: 'Disconnected · reconnecting…', authenticated: false,
        challenge: '', request: null, pending: false, searching: false, recovering: !!this.state.room});
      this.emit();
      this.retry = this.schedule(() => this.connect(), Math.min(1000 * 2 ** this.attempt++, 15000));
    };
  }
  stop() {
    this.stopped = true;
    ++this.epoch;
    this.cancel(this.retry); this.cancel(this.heartbeat);
    this.socket?.close();
    Object.assign(this.state, {status: 'Offline', authenticated: false, challenge: '', request: null, searching: false, pending: false});
    this.emit();
  }
  send(text, room = '') {
    if (this.socket?.readyState !== 1) throw new Error('Connection is offline.');
    this.socket.send(`${room}|${text}`);
  }
  async login(interactive = false) {
    const {challenge} = this.state;
    const epoch = this.epoch;
    if (!challenge) throw new Error('Connect before signing in.');
    this.state.status = 'Signing in…'; this.emit();
    try {
      const result = await this.auth.assertion(challenge, interactive);
      if (epoch !== this.epoch || this.state.challenge !== challenge || this.stopped) return;
      if (toID(result.user) !== toID(this.expectedUser)) throw new Error(`Choose the ${this.expectedUser} account on Showdown.`);
      if (!result.assertion || /[\r\n|]/.test(result.assertion)) throw new Error('Showdown did not return a valid login assertion.');
      this.send(`/trn ${this.expectedUser},0,${result.assertion}`);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.state.status = 'Sign in required'; this.state.notice = error.message; this.emit();
    }
  }
  receive(packet) {
    const {room, lines} = parsePacket(packet);
    const battleLines = [];
    const snapshot = lines.includes('|init|battle');
    if (snapshot && isBattleRoom(room)) {
      if (this.state.room && this.state.room !== room && !this.state.ended) return;
      Object.assign(this.state, {room, ended: false, request: null, pending: false, recovering: true, searching: false, timer: '',
        timerOn: false, timerPending: false, timerSeconds: null, timerRunning: false, timerWarning: '', timerWarningUntil: 0});
      this.storage.setItem('ps-mve-room', room);
    }
    for (const line of lines) {
      const [type, value] = splitLine(line);
      if (!room) {
        if (type === 'challstr') {
          this.state.challenge = value; this.state.status = 'Sign in required';
          if (this.auth.hasToken()) void this.login();
        } else if (type === 'updateuser') {
          const [name, named] = value.split('|');
          const authenticated = named === '1' && toID(name) === toID(this.expectedUser);
          if (authenticated && !this.state.authenticated) {
            this.state.authenticated = true; this.state.status = `Signed in as ${name}`; this.state.notice = '';
            this.attempt = 0;
            this.send('/noreply /blockbots');
            if (this.state.room && !this.state.ended) this.send(`/join ${this.state.room}`);
          }
          if (!authenticated) this.state.authenticated = false;
        } else if (type === 'nametaken' || type === 'error' || type === 'popup') {
          this.state.notice = value.replace(/\|/g, ' ');
          if (type === 'nametaken') this.state.status = 'Sign in required';
        } else if (type === 'updatesearch') {
          try {
            const data = JSON.parse(value);
            this.state.searching = !!data.searching?.length;
            const active = Object.keys(data.games || {}).find(isBattleRoom);
            if (active && !this.state.room && this.state.authenticated) {
              this.state.room = active; this.state.recovering = true;
              this.storage.setItem('ps-mve-room', active); this.send(`/join ${active}`);
            }
          } catch { this.state.notice = 'Could not read matchmaking status.'; }
        }
      }
      if (room && room === this.state.room) {
        if (type === 'request') {
          try {
            this.state.request = value ? JSON.parse(value) : null;
            this.state.pending = false; this.state.recovering = false;
          } catch { this.state.request = null; this.state.notice = 'Unreadable battle request. Reconnect to recover.'; }
        } else if (type === 'sentchoice') {
          this.state.pending = !!value;
        } else if (type === 'error') {
          this.state.notice = value;
          this.cancel(this.timerReply);
          this.state.timerPending = false;
          if (/\[(Invalid|Unavailable) choice\]/i.test(value)) this.state.pending = false;
        } else if (type === 'win' || type === 'tie') {
          this.state.ended = true; this.state.pending = false; this.state.request = null;
          this.state.recovering = false; this.state.notice = type === 'win' ? `${value} won the battle.` : 'The battle ended in a tie.';
          this.storage.removeItem('ps-mve-room');
        } else if (type === 'noinit' || type === 'deinit') {
          this.state.notice = 'This battle is no longer available on the server.';
          this.state.room = ''; this.state.request = null; this.state.recovering = false;
          this.storage.removeItem('ps-mve-room');
        } else if (type === 'inactive' || type === 'inactiveoff') {
          this.cancel(this.timerReply);
          this.state.timer = type === 'inactiveoff' ? 'Timer off' : value;
          this.state.timerOn = type === 'inactive'; this.state.timerPending = false;
          if (type === 'inactiveoff') {
            this.state.timerSeconds = null; this.state.timerWarning = ''; this.state.timerWarningUntil = 0;
          } else {
            const ownTime = value.match(/^(?:Time left: |You have )(\d+)/);
            const playerTime = value.match(/^(.+?) has (\d+) seconds left(?: this turn)?\./);
            const ownPlayer = playerTime && toID(playerTime[1]) === toID(this.expectedUser);
            if (ownTime || ownPlayer) {
              this.state.timerSeconds = Number(ownTime?.[1] ?? playerTime[2]); this.state.timerAt = Date.now();
            }
            const warningSeconds = playerTime ? Number(playerTime[2]) : /^You have /.test(value) ? Number(ownTime?.[1]) : null;
            if (warningSeconds != null && warningSeconds <= 60) {
              this.state.timerWarning = `${playerTime && !ownPlayer ? 'Opponent' : 'You'}: ${warningSeconds}s left`;
              this.state.timerWarningUntil = Date.now() + 5000;
            }
          }
        }
        battleLines.push(line);
      }
    }
    if (battleLines.length) this.onBattle({room, lines: battleLines, snapshot, request: this.state.request});
    // Publish after the entire packet, including a restored sentchoice.
    this.emit();
  }
  search() {
    if (!this.state.authenticated || this.state.searching || (this.state.room && !this.state.ended)) throw new Error('Finish the current battle or sign in before searching.');
    if (this.state.ended) { this.send('/leave', this.state.room); this.state.room = ''; }
    this.state.ended = false; this.state.request = null; this.state.pending = false;
    Object.assign(this.state, {timer: '', timerOn: false, timerPending: false, timerSeconds: null, timerRunning: false, timerWarning: '', timerWarningUntil: 0});
    this.send('/noreply /blockbots'); this.send('/utm null'); this.send('/search gen9randombattle');
    this.state.searching = true; this.state.notice = ''; this.emit();
  }
  cancelSearch() { this.send('/cancelsearch'); this.state.searching = false; this.emit(); }
  toggleTimer() {
    if (!this.state.authenticated || !this.state.room || this.state.ended || this.state.recovering || this.state.timerPending) return;
    this.roomCommand(`/timer ${this.state.timerOn ? 'off' : 'on'}`);
    this.state.timerPending = true;
    const {epoch} = this, room = this.state.room;
    this.cancel(this.timerReply);
    // Showdown can silently ignore off when only the opponent requested the
    // timer. Unlock the control without claiming the server turned it off.
    this.timerReply = this.schedule(() => {
      if (this.epoch !== epoch || this.state.room !== room || !this.state.timerPending) return;
      this.state.timerPending = false; this.emit();
    }, 5000);
    this.emit();
  }
  choose(kind, index, tera) {
    if (!this.state.authenticated || !this.state.room || this.state.pending || this.state.recovering || this.state.ended) throw new Error('Wait for the current battle request.');
    this.send(choiceCommand(this.state.request, kind, index, tera), this.state.room);
    this.state.pending = true; this.state.notice = 'Choice sent. Waiting for the server.'; this.emit();
  }
  undo() {
    if (!this.state.authenticated || !this.state.pending || !this.state.request || this.state.request.noCancel) return;
    this.send(`/undo |${this.state.request.rqid}`, this.state.room);
    // Successful undo has no acknowledgement packet. As in the official client,
    // unlock locally; rqid keeps a subsequent choice from affecting a later turn.
    this.state.pending = false;
    this.state.notice = 'Undo requested. Choose again; the server decides whether it was in time.';
    this.emit();
  }
  roomCommand(command) {
    if (!this.state.authenticated || !this.state.room || this.state.ended || this.state.recovering) return;
    if (!['/timer on', '/timer off', '/forfeit'].includes(command)) throw new Error('Unsupported command.');
    this.send(command, this.state.room);
  }
}
