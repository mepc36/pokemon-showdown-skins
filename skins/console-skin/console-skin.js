// ==UserScript==
// @name        PS Fullscreen Battle (Mac + iPad)
// @match       *://play.pokemonshowdown.com/*
// @run-at      document-idle
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
    width: 170px;
    height: 44px;
    font-size: 10pt;
    padding-top: 5px;
  }
  .movebutton small { font-size: 8pt; }
  .switchmenu button, .allyparty button {
    width: 160px;
    min-height: 40px;
    font-size: 10pt;
    padding: 4px 6px 6px 6px;
  }
  .switchmenu button .picon, .allyparty button .picon {
    transform: scale(1.2);
    margin: -4px 6px -4px 2px;
  }
  .megaevo-box { padding-top: 2px; }
  .megaevo { width: 200px; font-size: 10pt; padding: 4px 6px; }
  .megaevo img { transform: scale(1.1); margin-left: 4px; }
  .battle-controls .controls > p { gap: 8px; }
  .battle-controls .controls > p button,
  .battle-controls .controls > p a.button { font-size: 11pt; padding: 6px 12px; }
}
 
/* iPad landscape: controls float over the battle, pinned to the
   real bottom edge (iOS innerHeight is unreliable) */
@media (pointer: coarse) and (orientation: landscape) {
  .ps-room .battle-controls {
    top: auto !important;
    bottom: 0 !important;
    background: rgba(238, 242, 245, 0.88) !important;
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