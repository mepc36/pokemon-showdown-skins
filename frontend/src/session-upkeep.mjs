// Runs on Showdown's origin in the launcher. The browser manages the cookie.
// Only a challenge-bound assertion and the expected username leave this origin.
export class ShowdownSessionAuth {
  constructor(username, {origin = globalThis.origin, request = (...args) => globalThis.fetch(...args)} = {}) {
    this.username = username;
    this.origin = origin;
    this.request = request;
  }
  get configured() { return true; }
  hasToken() { return this.origin === 'https://play.pokemonshowdown.com'; }
  async assertion(challenge, {signal} = {}) {
    if (!this.hasToken()) throw new Error('Session login is available only inside the controller userscript on Showdown.');
    if (typeof challenge !== 'string' || !/^\d+\|[a-z0-9]+(?:\|[^\r\n]*)?$/.test(challenge) || challenge.length > 4096) {
      throw new Error('Reconnect to get a new Showdown login challenge.');
    }
    const url = new URL('/api/upkeep', this.origin);
    url.searchParams.set('challstr', challenge);
    let response, text;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    try {
      response = await this.request(url.href, {credentials: 'same-origin', mode: 'same-origin', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal});
      text = await response.text();
    } catch { throw new Error('Could not reach Showdown’s login service. Try signing in again.'); }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
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
