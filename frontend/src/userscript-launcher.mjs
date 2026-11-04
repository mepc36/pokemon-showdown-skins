import {ShowdownSessionAuth} from './session-upkeep.mjs';

// Only our own shadow root is queried. No official client globals, component
// selectors, cookies or battle sockets are inspected or intercepted.
export function installControllerLauncher({
  origin = 'https://play.pokemonshowdown.com',
  frontendUrl = 'https://showdown-controller-pr-preview.almondearth2048.chatgpt.site/',
  username = 'mepc36363636',
  auth = new ShowdownSessionAuth(username, {origin}),
} = {}) {
  if (window.top !== window || window.location.origin !== origin) return;
  if (document.getElementById('ps-independent-controller-launcher')) return;
  const target = new URL(frontendUrl);
  if (target.protocol !== 'https:' && target.origin !== origin) throw new Error('The controller must use HTTPS.');
  const host = document.createElement('div');
  host.id = 'ps-independent-controller-launcher';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;font:15px system-ui;color:#263440}
    :host([data-open]){inset:0;display:block;background:#edf2f5}
    button{font:600 15px system-ui;cursor:pointer;border:1px solid #345e7c;border-radius:8px;padding:12px 16px;background:#467fa8;color:white;box-shadow:0 2px 10px #0003}
    button:focus-visible{outline:3px solid #d02860;outline-offset:3px}
    iframe{display:block;width:100%;height:100%;border:0;background:#edf2f5}
    .exit{position:absolute;right:12px;top:12px;background:#fff;color:#263440}
    [hidden]{display:none!important}
    .failure{position:absolute;inset:50% 12px auto;text-align:center;background:#fff;padding:16px;border:1px solid #c3cdd6;border-radius:8px}
  </style><button type="button" class="open">Open controller UI</button>
    <button type="button" class="exit" hidden>Close controller</button><p class="failure" role="status" hidden></p>`;
  document.body.append(host);
  const open = root.querySelector('.open'), exit = root.querySelector('.exit'), failure = root.querySelector('.failure');
  let frame, timer, nonce;
  const pending = new Map();
  function close() {
    clearTimeout(timer);
    for (const request of pending.values()) request.abort();
    pending.clear();
    frame?.remove(); frame = null; nonce = null;
    host.removeAttribute('data-open');
    open.hidden = false; exit.hidden = true; failure.hidden = true;
    open.focus();
  }
  exit.onclick = close;
  open.onclick = () => {
    if (frame) return;
    nonce = crypto.randomUUID();
    host.setAttribute('data-open', '');
    open.hidden = true; exit.hidden = false;
    frame = document.createElement('iframe');
    frame.title = 'Independent Showdown controller';
    frame.allow = 'autoplay; gamepad; fullscreen';
    frame.referrerPolicy = 'no-referrer';
    // The fragment stays in the browser; it is not sent to the static host.
    target.hash = new URLSearchParams({'ps-controller': nonce}).toString();
    frame.src = target.href;
    root.prepend(frame);
    timer = setTimeout(() => {
      failure.textContent = 'The controller did not finish loading. Close it, check your connection, and reopen it.';
      failure.hidden = false;
    }, 20000);
  };
  window.addEventListener('message', async event => {
    const message = event.data;
    if (!frame || event.source !== frame.contentWindow || event.origin !== target.origin || message?.nonce !== nonce) return;
    if (message.type === 'ps-controller-ready') {
      clearTimeout(timer); exit.hidden = true; failure.hidden = true;
      frame.focus();
    } else if (message.type === 'ps-controller-close') close();
    else if (message.type === 'ps-controller-auth') {
      if (typeof message.id !== 'string' || !/^[a-f0-9-]{36}$/.test(message.id) || pending.has(message.id)) return;
      const recipient = frame.contentWindow, frameNonce = nonce;
      const reply = values => {
        if (frame?.contentWindow === recipient && nonce === frameNonce) {
          recipient.postMessage({type: 'ps-controller-auth-result', nonce: frameNonce, id: message.id, ...values}, target.origin);
        }
      };
      if (pending.size >= 4) { reply({error: 'Sign-in is busy. Wait a moment and reconnect.'}); return; }
      const controller = new AbortController();
      pending.set(message.id, controller);
      try {
        const {assertion, user} = await auth.assertion(message.challenge, {signal: controller.signal});
        if (!controller.signal.aborted) reply({assertion, user});
      } catch (error) {
        if (!controller.signal.aborted) reply({error: error.message});
      } finally { if (pending.get(message.id) === controller) pending.delete(message.id); }
    }
  });
}
