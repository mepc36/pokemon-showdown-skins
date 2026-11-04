export const SHOWDOWN_ORIGIN = 'https://play.pokemonshowdown.com';
const validNonce = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const toID = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Only a nonce comes from the URL. An attacker cannot choose the parent origin,
// login endpoint, account or socket through query/hash parameters.
export function sessionBridgeConfig(view = window) {
  const nonce = new URLSearchParams(view.location.hash.slice(1)).get('ps-controller');
  return view.parent !== view && validNonce(nonce) ?
    {authMode: 'showdown-session', launcherNonce: nonce, parentOrigin: SHOWDOWN_ORIGIN} : {};
}

export class ShowdownBridgeAuth {
  constructor(username, {nonce, view = window, parentOrigin = SHOWDOWN_ORIGIN, timeoutMs = 20000} = {}) {
    Object.assign(this, {username, nonce, view, parentOrigin, timeoutMs});
    this.pending = new Map();
    this.receive = event => {
      const message = event.data;
      if (event.source !== view.parent || event.origin !== parentOrigin || message?.nonce !== nonce ||
        message.type !== 'ps-controller-auth-result') return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id); clearTimeout(request.timer);
      if (typeof message.error === 'string') { request.reject(new Error(message.error.slice(0, 500))); return; }
      const assertion = message.assertion;
      if (toID(message.user) !== toID(username) || typeof assertion !== 'string' || assertion.length > 8192 ||
        /[\r\n|]/.test(assertion) || !assertion.includes(';') ||
        assertion.split(',')[0] !== request.challenge.split('|')[1] || assertion.split(',')[1] !== toID(username)) {
        request.reject(new Error('The login bridge returned an invalid assertion. Reconnect and try again.')); return;
      }
      request.resolve({assertion, user: message.user});
    };
    view.addEventListener('message', this.receive);
  }
  get configured() { return true; }
  hasToken() { return !this.disposed && this.view.parent !== this.view && validNonce(this.nonce); }
  assertion(challenge) {
    if (!this.hasToken()) return Promise.reject(new Error('Open this controller using the userscript on play.pokemonshowdown.com, after signing in there.'));
    if (typeof challenge !== 'string' || !/^\d+\|[a-z0-9]+(?:\|[^\r\n]*)?$/.test(challenge) || challenge.length > 4096) {
      return Promise.reject(new Error('Reconnect to get a new Showdown login challenge.'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The Showdown login bridge did not respond. Close the controller, check the userscript is enabled, and reopen it.'));
      }, this.timeoutMs);
      this.pending.set(id, {resolve, reject, timer, challenge});
      this.view.parent.postMessage({type: 'ps-controller-auth', nonce: this.nonce, id, challenge}, this.parentOrigin);
    });
  }
  dispose() {
    this.disposed = true;
    this.view.removeEventListener('message', this.receive);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer); request.reject(new Error('The controller was closed.'));
    }
    this.pending.clear();
  }
}
