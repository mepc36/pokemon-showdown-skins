const API = 'https://play.pokemonshowdown.com/api/oauth/';
const KEY = 'ps-mve-auth';
const WEEK = 7 * 24 * 60 * 60 * 1000;

export class ShowdownAuth {
  constructor(clientId) { this.clientId = clientId; }
  get configured() { return !!this.clientId; }
  read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
  hasToken() { return !!this.clientId && !!this.read()?.token; }
  forget() { localStorage.removeItem(KEY); }
  async api(endpoint, values) {
    const url = new URL(`api/${endpoint}`, API);
    for (const [key, value] of Object.entries({client_id: this.clientId, ...values})) url.searchParams.set(key, value);
    const response = await fetch(url, {credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new Error('Showdown login service is unavailable or this origin is not registered.');
    const text = await response.text();
    return text.startsWith(']') ? JSON.parse(text.slice(1)) : text;
  }
  async assertion(challenge, interactive) {
    if (!this.clientId) throw new Error('Add your registered Showdown application ID in Setup.');
    if (interactive) return this.authorize(challenge);
    let stored = this.read();
    if (!stored?.token) throw new Error('Tap Sign in to authorize this app.');
    if (Date.now() - stored.created > WEEK) {
      const refresh = await this.api('refreshtoken', {token: stored.token});
      if (refresh?.success) {
        stored = {...stored, token: refresh.success, created: Date.now()};
        localStorage.setItem(KEY, JSON.stringify(stored));
      }
    }
    const assertion = await this.api('getassertion', {challenge, token: stored.token});
    if (typeof assertion !== 'string' || !assertion || assertion.startsWith(';') || assertion.startsWith('<')) {
      this.forget(); throw new Error('Your authorization expired. Tap Sign in again.');
    }
    return {assertion: assertion.trim(), user: stored.user};
  }
  authorize(challenge) {
    const state = crypto.randomUUID();
    const redirect = new URL('auth-callback.html', document.baseURI);
    redirect.searchParams.set('state', state);
    const url = new URL('authorize', API);
    for (const [key, value] of Object.entries({client_id: this.clientId, redirect_uri: redirect.href, challenge})) url.searchParams.set(key, value);
    const popup = window.open(url.href, 'showdown-login', 'popup,width=560,height=700');
    if (!popup) return Promise.reject(new Error('Allow the sign-in popup, then try again.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { window.removeEventListener('message', receive); clearInterval(poll); clearTimeout(timeout); };
      const receive = event => {
        if (event.origin !== location.origin || event.source !== popup || event.data?.type !== 'ps-oauth' || event.data.state !== state) return;
        cleanup(); popup.close();
        const {assertion, token, user} = event.data;
        if (!assertion || !token || !user) { reject(new Error('Authorization was incomplete.')); return; }
        localStorage.setItem(KEY, JSON.stringify({token, user, created: Date.now()}));
        resolve({assertion, user});
      };
      window.addEventListener('message', receive);
      const poll = setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('Sign-in window closed.')); } }, 600);
      const timeout = setTimeout(() => { cleanup(); popup.close(); reject(new Error('Sign-in timed out. Try again.')); }, 180000);
    });
  }
}

// Used only by the userscript's same-origin frame. Cookies stay under browser
// control: we never read document.cookie or transfer a cookie/token to Pages.
export class ShowdownSessionAuth {
  constructor(username, {origin = globalThis.origin, request = (...args) => globalThis.fetch(...args)} = {}) {
    this.username = username;
    this.origin = origin;
    this.request = request;
  }
  get configured() { return true; }
  hasToken() { return this.origin === 'https://play.pokemonshowdown.com'; }
  async assertion(challenge) {
    if (!this.hasToken()) throw new Error('Session login is available only inside the controller userscript on Showdown.');
    if (typeof challenge !== 'string' || !/^\d+\|[a-z0-9]+(?:\|[^\r\n]*)?$/.test(challenge) || challenge.length > 4096) {
      throw new Error('Reconnect to get a new Showdown login challenge.');
    }
    const url = new URL('/api/upkeep', this.origin);
    url.searchParams.set('challstr', challenge);
    let response, text;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      response = await this.request(url.href, {credentials: 'same-origin', mode: 'same-origin', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal});
      text = await response.text();
    } catch { throw new Error('Could not reach Showdown’s login service. Try signing in again.'); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Showdown’s login service returned HTTP ${response.status}. Try again later.`);
    let data;
    try { data = JSON.parse(text.startsWith(']') ? text.slice(1) : text); }
    catch { throw new Error('Showdown returned an unreadable sign-in response. Try again later.'); }
    const toID = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!data?.loggedin || toID(data.username) !== toID(this.username)) {
      throw new Error(`Choose Back to Showdown, sign in as ${this.username}, then reopen the controller.`);
    }
    const assertion = data.assertion;
    if (typeof assertion !== 'string' || assertion.length > 8192 || /[\r\n|]/.test(assertion) ||
      !assertion.includes(';') || assertion.split(',')[0] !== challenge.split('|')[1] ||
      assertion.split(',')[1] !== toID(this.username)) {
      throw new Error('Showdown did not return a valid assertion for this connection. Reconnect and try again.');
    }
    return {assertion, user: data.username};
  }
}
