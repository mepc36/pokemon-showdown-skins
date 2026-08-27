// ==UserScript==
// @name        Gamepad Debug Overlay
// @match       *://play.pokemonshowdown.com/*
// @run-at      document-idle
// @grant       none
// ==/UserScript==

(() => {
  if (window.__gpDbgStop) window.__gpDbgStop();

  let box = document.getElementById('gp-debug-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gp-debug-box';
    box.style.cssText = 'position:fixed;top:60px;right:8px;z-index:99999;' +
      'background:rgba(0,0,0,.85);color:#0f0;font:11px monospace;' +
      'padding:8px;border-radius:6px;max-width:340px;pointer-events:none;' +
      'white-space:pre-wrap;';
    document.body.appendChild(box);
  }

  let tick = 0;
  const events = [];
  const held = {};

  function render(gp) {
    let s = 'tick: ' + tick + '\n';
    if (!gp) {
      s += 'NO GAMEPAD VISIBLE TO PAGE\n';
    } else {
      s += 'id: ' + gp.id + '\n';
      s += 'mapping: "' + gp.mapping + '"  connected: ' + gp.connected + '\n';
      const pressed = [];
      gp.buttons.forEach((b, i) => { if (b.pressed) pressed.push(i); });
      s += 'pressed now: [' + pressed.join(',') + ']\n';
      const ax = gp.axes.map(a => a.toFixed(1)).join(',');
      s += 'axes: [' + ax + ']\n';
    }
    s += '--- last events ---\n' + events.slice(-8).join('\n');
    box.textContent = s;
  }

  function poll() {
    tick++;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find(p => p);
    if (gp) {
      gp.buttons.forEach((b, i) => {
        const p = b.pressed;
        if (p && !held[i]) events.push('DOWN ' + i + ' @tick ' + tick);
        if (!p && held[i]) events.push('UP   ' + i + ' @tick ' + tick);
        held[i] = p;
      });
    }
    render(gp);
  }

  let run = true;
  window.__gpDbgStop = () => { run = false; clearInterval(window.__gpDbgInt); box.remove(); };
  if (window.__gpDbgInt) clearInterval(window.__gpDbgInt);
  window.__gpDbgInt = setInterval(() => { if (run) poll(); }, 100);
})();