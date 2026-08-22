(() => {
  const css = `
/* hide chat + userlist */
.ps-room .battle-log,
.ps-room .battle-log-add,
.ps-room .battle-userlist { display: none !important; }

/* battle room takes the FULL window (kills the right-hand Home/chat pane) */
.ps-room[id^="room-battle-"] {
  left: 0 !important;
  right: 0 !important;
  width: auto !important;
  background: #EEF2F5;
  z-index: 15;
}

/* stretch battle edge-to-edge */
.ps-room .battle {
  transform: scale(var(--gen2-sx, 1), var(--gen2-sy, 1)) !important;
  top: 0 !important;
  left: 0 !important;
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
`;
  let el = document.getElementById('gen2-skin');
  if (!el) { el = document.createElement('style'); el.id = 'gen2-skin'; document.head.appendChild(el); }
  el.textContent = css;

  ['--gen2-scale', '--gen2-width', '--gen2-left'].forEach(function (p) {
    document.documentElement.style.removeProperty(p);
  });

  function gen2fit() {
    var CONTROLS_H = 265;  // space reserved below for move/switch buttons
    var HEADER_H = 56;
    var sx = Math.max(1, window.innerWidth / 640);
    var sy = Math.max(1, (window.innerHeight - HEADER_H - CONTROLS_H) / 360);
    var r = document.documentElement.style;
    r.setProperty('--gen2-sx', sx);
    r.setProperty('--gen2-sy', sy);
    r.setProperty('--gen2-ctrl-top', (360 * sy + 8) + 'px');
  }
  if (window.__gen2fit) window.removeEventListener('resize', window.__gen2fit);
  window.__gen2fit = gen2fit;
  window.addEventListener('resize', gen2fit);
  gen2fit();
})();