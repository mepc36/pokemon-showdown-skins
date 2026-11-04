// The launcher touches only its own host. No official client globals, component
// selectors, login cookies, or battle sockets are inspected or intercepted.
export function installControllerLauncher(html, {origin = 'https://play.pokemonshowdown.com'} = {}) {
  if (window.top !== window || window.location.origin !== origin) return;
  if (document.getElementById('ps-independent-controller-launcher')) return;
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
  function close() {
    clearTimeout(timer);
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
    // srcdoc inherits the Showdown origin. This isolates CSS and JS globals,
    // not security privileges; the installed script is trusted on this site.
    frame.allow = 'autoplay; gamepad; fullscreen';
    frame.srcdoc = html.replace('__CONTROLLER_LAUNCHER_NONCE__', nonce);
    root.prepend(frame);
    timer = setTimeout(() => {
      failure.textContent = 'The controller did not finish loading. Close it and check that the full userscript is installed and enabled.';
      failure.hidden = false;
    }, 20000);
  };
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'ps-controller-ready') {
      clearTimeout(timer); exit.hidden = true; failure.hidden = true;
      frame.focus();
    } else if (event.data.type === 'ps-controller-close') close();
  });
}
