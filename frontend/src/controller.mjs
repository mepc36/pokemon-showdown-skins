// L3 (10) flips the shown team row (iPad Chrome reports every bumper as 10). Select (8) opens the menu modal. Start (9) opens the battle menu.
export const BUTTONS = {0: 'cancel', 1: 'confirm', 3: 'tera', 8: 'tools', 9: 'battle', 10: 'team', 11: 'info', 12: 'up', 13: 'down', 14: 'left', 15: 'right'};
export const risingEdges = (current, previous) => current.flatMap((pressed, index) => pressed && !previous[index] ? [index] : []);

export function startController({action, diagnostic, ignored = () => new Set()}) {
  let previous = [], device = '', repeatAt = 0, heldDirection = '', heldFlip = '';
  const keys = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Escape: 'cancel', x: 'tera', i: 'info', h: 'tools', s: 'battle', f: 'team', c: 'chat'};
  document.addEventListener('keydown', event => {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    diagnostic(`Key ${event.code} · cancelable ${event.cancelable}`);
    if (!keys[event.key]) return;
    if (event.cancelable) event.preventDefault();
    if (!event.repeat || ['up', 'down', 'left', 'right'].includes(keys[event.key])) action(keys[event.key]);
  });
  function poll(now) {
    const gamepad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
    if (!gamepad || document.hidden) { previous = []; device = ''; requestAnimationFrame(poll); return; }
    const current = gamepad.buttons.map(button => button.pressed || button.value > 0.5);
    if (gamepad.id !== device) {
      device = gamepad.id; previous = current; diagnostic(`Connected: ${device} · mapping ${gamepad.mapping || 'custom'}`);
    }
    for (const index of risingEdges(current, previous)) {
      diagnostic(`Button ${index}${ignored().has(index) ? ' · ignored' : ''}`);
      if (!ignored().has(index) && BUTTONS[index]) action(BUTTONS[index]);
    }
    let direction = '';
    for (const index of [12, 13, 14, 15]) if (current[index] && !ignored().has(index)) direction = BUTTONS[index];
    if (!direction && Math.abs(gamepad.axes[0] || 0) > .65) direction = gamepad.axes[0] > 0 ? 'right' : 'left';
    if (!direction && Math.abs(gamepad.axes[1] || 0) > .65) direction = gamepad.axes[1] > 0 ? 'down' : 'up';
    if (direction !== heldDirection) {
      heldDirection = direction; repeatAt = now + 350;
      if (direction && !current.slice(12, 16).some(Boolean)) { diagnostic(`Axis → ${direction}`); action(direction); }
    } else if (direction && now >= repeatAt) { action(direction); repeatAt = now + 150; }
    // Right stick left/right flips the shown team row; one action per push, no repeat.
    const flip = Math.abs(gamepad.axes[2] || 0) > .65 ? (gamepad.axes[2] > 0 ? 'right' : 'left') : '';
    if (flip !== heldFlip) { heldFlip = flip; if (flip) { diagnostic(`Right stick → ${flip}`); action('team'); } }
    previous = current;
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);
}

export function navigate(direction) {
  const scope = document.querySelector('dialog[open]') || document;
  const buttons = [...scope.querySelectorAll('[data-nav]')].filter(el => !el.disabled && el.getClientRects().length);
  if (!buttons.length) return;
  const focused = buttons.includes(document.activeElement) ? document.activeElement : null;
  if (!focused) { (buttons.find(el => el.dataset.row === 'moves') || buttons[0]).focus({preventScroll: true}); return; }
  const rows = [...new Set(buttons.map(el => el.dataset.row))];
  const row = buttons.filter(el => el.dataset.row === focused.dataset.row);
  let target;
  if (direction === 'left' || direction === 'right') {
    target = row[(row.indexOf(focused) + (direction === 'left' ? -1 : 1) + row.length) % row.length];
  } else {
    const nextRow = rows[(rows.indexOf(focused.dataset.row) + (direction === 'up' ? -1 : 1) + rows.length) % rows.length];
    const x = focused.getBoundingClientRect().left + focused.offsetWidth / 2;
    target = buttons.filter(el => el.dataset.row === nextRow).sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - x) - Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - x))[0];
  }
  target?.focus({preventScroll: true});
}
