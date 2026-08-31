// ==UserScript==
// @name        PS Fullscreen Battle + Gamepad (Mac + iPad)
// @match       *://play.pokemonshowdown.com/*
// @run-at      document-idle
// @grant       none
// ==/UserScript==

(() => {
  const css = `
/* hide chat + userlist */
.ps-room .battle-log,
.ps-room .battle-log-add,
.ps-room .battle-userlist,
.battle-chat-toggle { display: none !important; }

/* battle room takes the FULL window (kills the right-hand Home/chat pane) */
.ps-room[id^="room-battle-"] {
  left: 0 !important;
  right: 0 !important;
  width: auto !important;
  background: #EEF2F5;
  z-index: 15;
}

/* stretch battle edge-to-edge (centered when stretch-capped) */
.ps-room .battle {
  transform: scale(var(--gen2-sx, 1), var(--gen2-sy, 1)) !important;
  top: 0 !important;
  left: var(--gen2-left, 0px) !important;
}

/* controls pinned below the stretched battle */
.ps-room .battle-controls {
  top: var(--gen2-ctrl-top, 370px) !important;
  left: 0 !important;
  width: 100% !important;
  box-sizing: border-box;
}

/* ---- centered, bigger controls ---- */
.battle-controls .controls { text-align: center; }
.battle-controls .whatdo {
  text-align: center;
  font-size: 13pt;
}
.battle-controls .whatdo small { font-size: 11pt; }
.movemenu, .switchmenu, .allyparty {
  display: flex !important;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 10px;
  margin: 0 !important;
  padding: 0 !important;
}
.movebutton {
  float: none !important;
  width: 230px;
  height: 62px;
  font-size: 13pt;
  padding-top: 10px;
}
.movebutton small { font-size: 10pt; }

/* switch buttons: bigger, with bigger pokemon icons */
.switchmenu button, .allyparty button {
  float: none !important;
  width: 200px;
  min-height: 56px;
  font-size: 12pt;
  margin-right: 0;
  padding: 8px 8px 10px 8px;
}
.switchmenu button .picon, .allyparty button .picon {
  transform: scale(1.7);
  transform-origin: center;
  margin: -2px 12px -2px 8px;
}

/* Attack / Switch headers */
.moveselect button, .switchselect button, .shiftselect button {
  margin: 0 auto;
  font-size: 14pt;
}

/* Terastallize box */
.megaevo-box { padding-top: 6px; }
.megaevo {
  width: 260px;
  font-size: 13pt;
  padding: 10px 8px;
}
.megaevo img {
  transform: scale(1.5);
  margin-left: 8px;
  vertical-align: -2px;
}

/* ---- end-of-battle / message buttons: one centered row, bigger ---- */
.battle-controls .controls > p {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 14px;
}
/* flatten the right-floated replay group into the same row */
.battle-controls .controls > p span {
  float: none !important;
  display: contents;
}
.battle-controls .controls > p button,
.battle-controls .controls > p a.button {
  font-size: 13pt;
  padding: 10px 20px;
}
.battle-controls .controls > p button small { font-size: 9pt; }

/* ---- touch devices (iPad): vertically compact controls so the
        battle gets more height and stretches less ---- */
@media (pointer: coarse) {
  .ps-room .battle-controls {
    padding: 6px 18px 12px 18px;
  }
  .battle-controls .whatdo {
    font-size: 10pt;
    margin: 0 !important;
    padding: 2px 8px;
  }
  .battle-controls .whatdo small { font-size: 9pt; }
  .battle-controls .controls p { margin: 2px 0 4px 0; }
  .moveselect button, .switchselect button, .shiftselect button {
    font-size: 10pt;
    padding: 1px 6px 0 6px;
  }
  .movemenu, .switchmenu, .allyparty { gap: 10px 14px; }
  .movebutton {
    width: 185px;
    height: 56px;
    font-size: 12pt;
    padding-top: 8px;
  }
  .movebutton small { font-size: 9pt; }
  .switchmenu button, .allyparty button {
    width: 165px;
    min-height: 50px;
    font-size: 11pt;
    padding: 6px 4px 8px 4px;
  }
  .switchmenu button .picon, .allyparty button .picon {
    transform: scale(1.45);
    margin: -3px 9px -3px 4px;
  }
  /* Terastallize shares the move row instead of wrapping to its own */
  .megaevo-box {
    display: inline-block;
    padding-top: 0;
    vertical-align: top;
  }
  .megaevo { width: 200px; font-size: 12pt; padding: 7px 6px; }
  .megaevo img { transform: scale(1.3); margin-left: 6px; }
  .battle-controls .controls > p { gap: 8px; }
  .battle-controls .controls > p button,
  .battle-controls .controls > p a.button { font-size: 11pt; padding: 6px 12px; }
}

/* ---- ALWAYS exactly two rows: moves+tera, then the 6 pokemon ----
   nowrap + flexible widths: buttons shrink to fit instead of wrapping */
.movemenu, .switchmenu, .allyparty {
  flex-wrap: nowrap !important;
}
.movebutton {
  flex: 1 1 0 !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: 230px;
  overflow: hidden;
}
.megaevo-box {
  flex: 1 1 0 !important;
  min-width: 0 !important;
  max-width: 250px;
  display: block !important;
  padding: 0 !important;
}
.megaevo {
  width: 100% !important;
  box-sizing: border-box;
  overflow: hidden;
}
.switchmenu button, .allyparty button {
  flex: 1 1 0 !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: 210px;
  overflow: hidden;
}

/* ---- end-of-battle: ALL buttons on one row ----
   (they live in two <p>s; flatten both into one nowrap flex row) */
.battle-controls .controls:has(button[name="saveReplay"]) {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.battle-controls .controls:has(button[name="saveReplay"]) > p {
  display: contents;
}
.battle-controls .controls:has(button[name="saveReplay"]) button,
.battle-controls .controls:has(button[name="saveReplay"]) a.button {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 11pt;
  padding: 8px 10px;
}

/* ---- replay playback controls: all on one row ----
   (these <p>s sit directly in .battle-controls, no .controls wrapper) */
.ps-room .battle-controls:has(button[name="rewindTurn"]) {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.ps-room .battle-controls:has(button[name="rewindTurn"]) > p {
  display: contents;
}
.ps-room .battle-controls:has(button[name="rewindTurn"]) button {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 11pt;
  padding: 8px 12px;
  margin: 0 !important;
}

/* iPad landscape: controls float over the battle, pinned to the
   real bottom edge (iOS innerHeight is unreliable) */
@media (pointer: coarse) and (orientation: landscape) {
  .ps-room .battle-controls {
    top: auto !important;
    bottom: 0 !important;
    background: #EEF2F5 !important; /* opaque: hides the battle's bottom edge cleanly */
  }
  /* slim the overlay: drop the decorative Attack/Switch headers */
  .moveselect, .switchselect, .shiftselect { display: none !important; }
  .battle-controls .whatdo { padding: 1px 8px; }
  .battle-controls .controls p { margin: 1px 0 3px 0; }
}
`;
  let el = document.getElementById('gen2-skin');
  if (!el) { el = document.createElement('style'); el.id = 'gen2-skin'; document.head.appendChild(el); }
  el.textContent = css;

  ['--gen2-scale', '--gen2-width', '--gen2-left'].forEach(function (p) {
    document.documentElement.style.removeProperty(p);
  });

  function gen2fit() {
    var HEADER_H = 56;
    /* measure the real height of the controls panel, but keep the LARGEST
       height seen so far — otherwise the battle jumps in size every time
       the panel changes (waiting vs. move select vs. battle end) */
    var c = document.querySelector('.ps-room .battle-controls');
    var measured = (c && c.scrollHeight > 40) ? c.scrollHeight + 16 : 0;
    window.__gen2max = Math.max(window.__gen2max || 0, measured, 265);
    var controlsH = window.__gen2max;
    /* iOS Safari's innerHeight over-reports with toolbars visible —
       visualViewport is the truth */
    var vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    var vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    var sx = Math.max(1, vw / 640);
    var sy, ctrlTop;
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    var portrait = vh > vw;
    if (coarse && !portrait) {
      /* iPad landscape: battle overlaps only HALF the control panel,
         so the player's own Pokemon stays visible above it
         (panel itself is bottom-pinned via CSS) */
      sy = Math.max(1, (vh - HEADER_H - controlsH * 0.5) / 360);
      sy = Math.min(sy, sx * 1.25);
      sx = Math.min(sx, sy * 1.25);
      ctrlTop = vh - HEADER_H - controlsH;
    } else {
      /* portrait (tight 10% stretch cap) and desktop (35%) — controls below */
      sy = Math.max(1, (vh - HEADER_H - controlsH) / 360);
      var cap = coarse ? 1.10 : 1.35;
      sy = Math.min(sy, sx * cap);
      sx = Math.min(sx, sy * cap);
      ctrlTop = 360 * sy + 8;
    }
    /* if width got capped, center the battle instead of leaving a side gap */
    var left = Math.max(0, (vw - 640 * sx) / 2);
    var r = document.documentElement.style;
    r.setProperty('--gen2-sx', sx);
    r.setProperty('--gen2-sy', sy);
    r.setProperty('--gen2-left', left + 'px');
    r.setProperty('--gen2-ctrl-top', ctrlTop + 'px');
  }
  if (window.__gen2fit) window.removeEventListener('resize', window.__gen2fit);
  window.__gen2fit = function () {
    window.__gen2max = 0;  /* re-measure from scratch after rotate/resize */
    gen2fit();
  };
  window.addEventListener('resize', window.__gen2fit);
  if (window.visualViewport) {
    if (window.__gen2vv) window.visualViewport.removeEventListener('resize', window.__gen2vv);
    window.__gen2vv = window.__gen2fit;
    window.visualViewport.addEventListener('resize', window.__gen2vv);
  }
  /* re-fit whenever the controls change (new turn, switch menu, battle end) */
  if (window.__gen2obs) window.__gen2obs.disconnect();
  window.__gen2obs = new MutationObserver(function () {
    clearTimeout(window.__gen2t);
    window.__gen2t = setTimeout(gen2fit, 100);
  });
  window.__gen2obs.observe(document.body, { childList: true, subtree: true });
  gen2fit();
})();

/* ============================================================
 * GAMEPAD LAYER (SN30 Pro+, X-input mode)
 * D-pad navigate | A confirm | B cancel | X Terastallize
 * R3 (right stick click) info | Start forfeit menu | Select timer
 * (R1 unbound: iPadOS reserves it as a system button)
 * ============================================================ */
(() => {
  if (window.__gpStop) window.__gpStop();

  let st = document.getElementById('gen2-gamepad-style');
  if (!st) { st = document.createElement('style'); st.id = 'gen2-gamepad-style'; document.head.appendChild(st); }
  st.textContent = '.gen2-gp-sel { outline: 4px solid #d02860 !important; outline-offset: -2px; }';

  const q = (s) => Array.from(document.querySelectorAll(s));
  const vis = (el) => el && el.offsetParent !== null;
  const isDisabled = (el) => el.disabled || el.classList.contains('disabled');

  /* page-context shim: unsafeWindow if a userscript sandbox exists */
  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const battleObj = () => {
    try { return (W.app && W.app.curRoom && W.app.curRoom.battle) || null; } catch (e) { return null; }
  };
  const zoneAlive = (el) => {
    const id = el.getAttribute('data-id') || '';
    const m = id.match(/^p(\d)([a-c])$/);
    if (!m) return true;
    const b = battleObj();
    if (!b) return true;
    const side = b['p' + m[1]];
    const poke = side && side.active && side.active[m[2].charCodeAt(0) - 97];
    return !!(poke && !poke.fainted && poke.hp !== 0);
  };

  const popupBox = () => { const p = q('.ps-popup').filter(vis); return p.length ? p[p.length - 1] : null; };
  const popupRow = () => {
    const p = popupBox();
    if (!p) return null;
    return Array.from(p.querySelectorAll('button, input[type="checkbox"]')).filter(vis);
  };
  const movesRow = () => {
    const row = q('.movemenu button.movebutton').filter(vis);
    const tera = document.querySelector('.megaevo');
    if (vis(tera)) row.push(tera);
    const t = q('.battle-controls button[name="openTimer"]').filter(vis)[0];
    if (t) row.push(t);   /* timer rides at the end of the moves row */
    return row;
  };
  const switchRow = () => q('.switchmenu button').filter(vis);
  const fieldRow = () => q('.battle .has-tooltip')
    .filter(el => vis(el) && zoneAlive(el))
    .sort((a, b) => (a.getAttribute('data-id') || '').localeCompare(b.getAttribute('data-id') || ''));
  const endRow = () => q('.battle-controls button, .battle-controls a.button')
    .filter(el => vis(el) && el.name !== 'openTimer');
  const homeRow = () => q('button[name="search"]').filter(vis);

  function currentRows() {
    const p = popupRow();
    if (p) return [p];
    const m = movesRow(), s = switchRow();
    if (m.length || s.length) return [m, s, fieldRow()];
    const e = endRow();
    if (e.length) return [e, fieldRow()];
    return [homeRow()];
  }

  let row = 0, idx = 0, active = false, lastDir = 1;
  let tipOn = false, tipEl = null;

  function items() { return currentRows()[row] || []; }
  function clearSel() { q('.gen2-gp-sel').forEach(el => el.classList.remove('gen2-gp-sel')); }

  function mouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  function showTip(el) { mouse(el, 'mouseover'); tipOn = true; tipEl = el; }
  function hideTip() { if (tipEl) mouse(tipEl, 'mouseout'); tipOn = false; tipEl = null; }

  function paint() {
    clearSel();
    const R = currentRows().length;
    row = ((row % R) + R) % R;
    let tries = 0;
    while (!items().length && tries < R) { row = ((row + lastDir) % R + R) % R; tries++; }
    const list = items();
    if (!list.length) { active = false; hideTip(); return; }
    idx = ((idx % list.length) + list.length) % list.length;
    list[idx].classList.add('gen2-gp-sel');
    if (tipOn) { hideTip(); showTip(list[idx]); }
  }
  function nav(drow, didx) {
    if (!active) { active = true; row = 0; idx = 0; lastDir = 1; paint(); return; }
    const R = currentRows().length;
    if (drow) { lastDir = drow > 0 ? 1 : -1; row = ((row + drow) % R + R) % R; idx = Math.min(idx, Math.max(0, items().length - 1)); }
    if (didx) idx += didx;
    paint();
  }
  function confirm() {
    if (!active) return;
    const el = items()[idx];
    if (!el) return;
    const tooltipOnly =
      (el.classList.contains('has-tooltip') && !el.matches('button')) ||
      (el.matches('.switchmenu button') && isDisabled(el));
    if (el.tagName === 'INPUT' || el.classList.contains('megaevo')) {
      hideTip();
      const c = el.tagName === 'INPUT' ? el : el.querySelector('input');
      if (c) c.click();
      paint();
    } else if (tooltipOnly) {
      if (el.matches('button')) {
        if (tipOn && tipEl === el) hideTip(); else { hideTip(); showTip(el); }
      } else {
        el.click();
      }
    } else {
      hideTip();
      el.click();
      active = false; clearSel();
    }
  }
  function cancel() {
    hideTip();
    const p = popupBox();
    if (p) {
      const c = Array.from(p.querySelectorAll('button'))
        .find(b => b.name === 'close' || /^\s*Cancel\s*$/.test(b.textContent));
      if (c) c.click();
      else { try { if (W.app && W.app.closePopup) W.app.closePopup(); } catch (e) { } }
    } else {
      const btn = q('.battle-controls button').find(b => /^\s*Cancel\s*$/.test(b.textContent));
      if (btn) btn.click();
    }
    active = false; clearSel();
  }
  function info() {
    if (!active) return;
    const el = items()[idx];
    if (!el) return;
    if (tipOn && tipEl === el) { hideTip(); return; }
    hideTip();
    showTip(el);
  }
  function closeTab() {
    const x = document.querySelector('.tabbar a.button.cur + .closebutton')
      || document.querySelector('.tabbar a.button.cur .closebutton');
    if (x) x.click();
  }

  function openSoundMenu() {
    const b = document.querySelector('button[name="openSounds"]');
    if (!b) return;
    b.click();
    /* land the cursor on the Mute sounds checkbox once the popup renders */
    setTimeout(() => {
      const p = popupRow();
      if (p && p.length) {
        active = true; row = 0;
        const mi = p.findIndex(el => el.name === 'muted');
        idx = mi >= 0 ? mi : 0;
        paint();
      }
    }, 120);
  }

  const ACTIONS = {
    14: () => nav(0, -1),
    15: () => nav(0, 1),
    12: () => nav(-1, 0),
    13: () => nav(1, 0),
    1: () => confirm(),
    0: () => cancel(),
    3: () => { const c = document.querySelector('.megaevo input'); if (c) c.click(); },  // X = Terastallize
    /* R1 (5) is reserved by iPadOS as a system button — do not bind it.
       Info lives on R3 (right stick click) instead. */
    11: () => info(),
    9: () => closeTab(),  // Start = forfeit menu (close battle tab)
    8: () => openSoundMenu()  // Select = sound menu, cursor on Mute sounds
  };

  const held = {};
  let run = true;
  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find(p => p);
    if (gp) {
      gp.buttons.forEach((b, i) => {
        const p = b.pressed;
        if (p && !held[i]) {
          /* armor: one throwing action must never kill the input loop */
          try { if (ACTIONS[i]) ACTIONS[i](); } catch (e) { }
        }
        held[i] = p;
      });
    }
  }
  window.__gpStop = () => {
    run = false;
    if (window.__gpInt) { clearInterval(window.__gpInt); window.__gpInt = null; }
  };
  /* dual polling: rAF for responsiveness + interval watchdog, because
     iPad Safari starves rAF for seconds at a time (animations, low power) */
  function loop() {
    if (!run) return;
    poll();
    requestAnimationFrame(loop);
  }
  if (window.__gpInt) clearInterval(window.__gpInt);
  window.__gpInt = setInterval(function () { if (run) poll(); }, 60);
  loop();
})();