// Run against the Vite dev server. All battle traffic is simulated.
import {chromium, webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const engineName = process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({headless: true,
  ...(engineName === 'chromium' && process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
await mkdir('test-results', {recursive: true});
let passed = 0; const failures = [];
const check = (condition, message) => { if (condition) { console.log(`PASS: ${message}`); passed++; } else { failures.push(message); console.error(`FAIL: ${message}`); } };
const fit = async page => page.evaluate(() => {
  const root = document.documentElement, modal = document.querySelector('dialog[open]');
  const targets = modal ? [modal, document.querySelector('#modal-body'), document.querySelector('#info-content')].filter(Boolean) : [root, document.querySelector('#app')];
  const bad = targets.filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2).map(el => `${el.id || el.tagName}: ${el.scrollHeight}/${el.clientHeight}, ${el.scrollWidth}/${el.clientWidth}`);
  if (window.scrollX || window.scrollY || root.scrollHeight > innerHeight + 2) bad.push('document scrolled/overflowed');
  for (const el of (modal || document).querySelectorAll('button:not([hidden]):not(:disabled)')) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1) bad.push(`offscreen: ${el.id}`);
  }
  return bad;
});
// Resolve and measure in one JS turn: the rosters re-render while animations play, so a Playwright
// element handle can go stale between lookup and measurement.
const height = (page, selector) => page.evaluate(sel => document.querySelector(sel)?.getBoundingClientRect().height ?? 0, selector);
async function pad(page, index) {
  // Synchronize with the real controller poll. A fixed 55 ms pulse can fall
  // entirely between WebKit frames, especially immediately after a screenshot.
  await page.waitForFunction(() => window.testPadObserved);
  await page.evaluate(i => window.testPad.buttons[i].pressed = true, index);
  await page.waitForFunction(i => window.testPadObserved[i], index, {polling: 10});
  await page.evaluate(i => window.testPad.buttons[i].pressed = false, index);
  await page.waitForFunction(i => !window.testPadObserved[i], index, {polling: 10});
}
// Right-stick push, synchronized with the poll the same way pad() is: a fixed
// 120 ms wait can straddle WebKit frames and the flip is never observed.
async function stick(page, value, axis = 2) {
  await page.waitForFunction(() => window.testPadObserved);
  await page.evaluate(([v, a]) => { window.testPad.axes[a] = v; window.testAxisObserved = null; }, [value, axis]);
  await page.waitForFunction(([v, a]) => window.testAxisObserved?.[a] === v, [value, axis], {polling: 10});
  await page.evaluate(a => { window.testPad.axes[a] = 0; }, axis);
  await page.waitForFunction(a => window.testAxisObserved?.[a] === 0, axis, {polling: 10});
}
async function gamepad(page) {
  await page.addInitScript(() => {
    window.testPad = {id: 'Controller fixture', mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, () => ({pressed: false, value: 0}))};
    navigator.getGamepads = () => {
      window.testPadObserved = window.testPad.buttons.map(button => button.pressed);
      window.testAxisObserved = [...window.testPad.axes];
      return [window.testPad];
    };
  });
}
try {
  for (const viewport of [{width: 1024, height: 650}, {width: 1180, height: 700}, {width: 1024, height: 540}]) {
    const page = await browser.newPage({viewport, hasTouch: true, isMobile: true}); await gamepad(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.waitForSelector('#switch-1');
    check(await page.locator('#all-moves, #info, #move-details').count() === 0, 'Duplicate menus and separate Move info button are removed');
    check(await page.evaluate(async () => { const source = await fetch('/vendor/pokemon-showdown/battle-animations.ts').then(r => r.text()); return /pokemonshowdown\.com\/fx\/["'] \+ BattleEffects\[id\]\.url/.test(source) && !source.includes('window.Dex'); }), 'Effect sprite URLs are prefixed with the Showdown fx folder regardless of window.Dex');
    check(await page.locator('#roster button').count() === 6 && await page.locator('#opponent-roster button').count() === 6 && await page.locator('#roster').isVisible() && !await page.locator('#opponent-roster').isVisible(), 'Six slots per team; your row shows first, one row at a time');
    check(await page.locator('#view-own, #view-opponent, #skip, #music, #display, #reconnect, .controller-bar kbd').count() === 0, 'Redundant controls and hints are removed');
    check(await page.locator('.app-header, #utility, #timer-toggle, #toggle-tools, .controller-bar, #turn-label').count() === 0, 'The header row and the Timer button are gone');
    check(await page.locator('#arena-wrap > #battle-timer').count() === 1 && await page.locator('#battle-timer').evaluate(el => { const r = el.getBoundingClientRect(), w = el.parentElement.getBoundingClientRect(); const panel = document.querySelector('#matchup-foe').getBoundingClientRect(); return parseFloat(getComputedStyle(el).borderTopWidth) >= 2 && Math.abs(r.bottom - w.bottom) < 20 && r.left >= panel.left - 1 && r.right <= panel.right + 1; }), 'The bordered timer clock sits in the bottom-right corner of the right panel');
    check(await page.locator('#timer-value').innerText() !== 'Timer off', 'The timer is on without a Timer button');
    const rosterText = await page.locator('#roster button, #opponent-roster button').allInnerTexts();
    check(rosterText.length === 12 && rosterText.every(text => !/%|\d+\/\d+|Active/.test(text)), `Roster entries show no HP numbers and no Active text: ${rosterText.join(' | ')}`);
    check(await page.locator('#switch-1[data-active=true]').count() === 1 && await page.locator('#roster [data-active=true]').count() === 1, 'The active Pokémon is marked by attribute, not text');
    await page.locator('#switch-3').focus(); await stick(page, 1);
    check(await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'switch-3', 'The right stick no longer flips the team row');
    await pad(page, 10);
    check(await page.locator('#opponent-roster').isVisible() && !await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'preview-move-1', 'A bumper flips to the opponent row and focuses their active Pokémon\'s first move');
    const foeFirstMove = await page.locator('#preview-move-1 strong').innerText();
    await pad(page, 11); await page.waitForSelector('#info-content');
    check((await page.locator('#modal-title').innerText()).startsWith(foeFirstMove.replace(/ 👀$/, '')), `R3 on the foe's first move opens that move, not an own move: ${await page.locator('#modal-title').innerText()}`);
    await pad(page, 0);
    await page.locator('#opponent-3').focus();
    check((await page.locator('#opponent-3 strong').innerText()).replace(/\s+/g, ' ') === 'Rotom-Wash PAR', 'Status sits on the name line of the roster button');
    check(await page.locator('.move-preview').count() === 4 && await page.locator('.move-preview:not(.unknown-move)').count() >= 1 && (await page.locator('.move-preview').first().innerText()).includes('Hydro Pump') && !await page.locator('#move-1').isVisible() && await page.locator('#tera').isDisabled(), 'The cursor on an opponent shows that Pokémon\'s known moves in the move row, blanks for the rest');
    await page.locator('#opponent-5').focus();
    check(await page.locator('.move-preview.unknown-move').count() === 4, 'An unrevealed opponent shows four blank move slots');
    await page.locator('#opponent-3').focus();
    await page.waitForFunction(() => document.querySelector('#matchup-own .matchup-names > span:last-child')?.textContent === 'Rotom-Wash', null, {timeout: 20000});
    check((await page.locator('#matchup-foe .matchup-names span').first().innerText()) === 'Rotom-Wash', 'The cursor on an opponent roster button swaps that Pokémon into both side panels');
    await page.keyboard.press('f');
    check(await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'move-1', 'F flips back to your row and focuses your active Pokémon\'s first move');
    await page.waitForFunction(() => document.querySelector('#matchup-own .matchup-names > span:last-child')?.textContent === 'Landorus', null, {timeout: 20000});
    check(true, 'Leaving the opponent row returns the panels to their active Pokémon');
    check(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#switch-1 strong')).fontSize)) >= 14.5, 'Roster names are larger');
    check(await page.locator('#battle-timer').evaluate(el => getComputedStyle(el).color) !== 'rgb(17, 17, 17)', 'Timer is no longer black');
    check(await page.evaluate(() => { const badge = document.querySelector('#app-version'), timer = document.querySelector('#battle-timer'); const wrap = document.querySelector('#arena-wrap').getBoundingClientRect(), r = badge.getBoundingClientRect(); return /^\d+\.\d+\.\d+$/.test(badge.textContent) && getComputedStyle(badge).color === getComputedStyle(timer).color && r.left - wrap.left < 20 && wrap.bottom - r.bottom < 20; }), `Version badge shows a semver in the timer's blue at the bottom left: ${await page.locator('#app-version').innerText()}`);
    if (viewport.width === 1024 && viewport.height === 650) {
      const fresh = await browser.newPage(); await fresh.goto(`${base}/fresh.html`); await fresh.waitForSelector('#switch-1');
      check(/\?fresh=\d{13}$/.test(fresh.url()) && await fresh.locator('#app-version').innerText() === '1.0.1', `fresh.html redirects to the app under a timestamped query string: ${fresh.url()}`);
      await fresh.close();
    }
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#battle-timer')).alignItems === 'flex-start' && [...document.querySelectorAll('.timer-who')].every(el => getComputedStyle(el).textAlign === 'left')), 'Timer rows are left-justified');
    check(await page.locator('.moves > #tera').count() === 1 && await page.locator('.command-heading, #prompt').count() === 0 && await page.locator('#tera').evaluate(el => el.getBoundingClientRect().right > document.querySelector('#move-4').getBoundingClientRect().right), 'Tera sits at the right end of the move row and the heading row is gone');
    check(await page.evaluate(() => { const widths = [...document.querySelectorAll('.moves > button')].map(b => Math.round(b.getBoundingClientRect().width)).filter(Boolean); return widths.length === 5 && new Set(widths).size === 1 && !document.querySelector('.moves > #undo'); }), 'Four moves and Tera share one width; there is no Cancel button in the row');
    check(await page.locator('#roster button[data-cue]:not([data-cue=""])').count() === 0, 'Own roster no longer carries speed cue borders');
    await page.waitForFunction(() => document.querySelector('#matchup-foe .matchup-names span:first-child')?.textContent === 'Landorus', null, {timeout: 20000});
    await page.locator('#switch-1').focus(); // Focusing the active Pokémon ends the bench preview
    const panelNames = async id => page.locator(`${id} .matchup-names > span`).allInnerTexts();
    check(JSON.stringify(await panelNames('#matchup-own')) === '["Grumpig","Landorus"]' && JSON.stringify(await panelNames('#matchup-foe')) === '["Landorus","Grumpig"]', 'Both panels name the attacker on the left and the defender on the right');
    // Query and measure in one evaluate: the panels re-render during animations, and a two-step locator read can land on detached nodes.
    check(await page.evaluate(() => { const els = [...document.querySelectorAll('.matchup-names span')]; return els.length > 0 && els.every(el => getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).overflow === 'hidden'); }), 'Panel names clip with an ellipsis');
    const cues = async id => page.evaluate(sel => [...document.querySelectorAll(`${sel} .stat-box`)].map(el => `${el.querySelector('small').textContent}:${el.dataset.stat}`), id);
    check(JSON.stringify(await cues('#matchup-own')) === '["Atk:tie","Def:high","SpA:tie","SpD:low","Spe:"]', `Left panel marks their higher defense green and lower red, your tied attack stats yellow: ${await cues('#matchup-own')}`);
    check(JSON.stringify(await cues('#matchup-foe')) === '["Atk:high","Def:tie","SpA:low","SpD:tie","Spe:"]', `Right panel puts their attack stats left, higher green and lower red, your tied defenses yellow: ${await cues('#matchup-foe')}`);
    check(await page.evaluate(() => { const style = el => getComputedStyle(el); const high = document.querySelector('.stat-box[data-stat=high]'), low = document.querySelector('.stat-box[data-stat=low]'), plain = document.querySelector('.stat-box[data-stat=""]'); const key = el => style(el).borderTopColor + style(el).backgroundColor; return key(high) !== key(plain) && key(low) !== key(plain) && key(high) !== key(low); }), 'Cued stat boxes look different from plain ones and from each other');
    const pairs = await page.locator('#matchup-own .stat-pair small').allInnerTexts();
    check(JSON.stringify(pairs) === JSON.stringify(['Atk', 'Def', 'SpA', 'SpD', 'Spe']) && (await page.locator('#matchup-own .stat-pair strong').allInnerTexts()).slice(0, 2).join() === '150,~' + (Math.floor(Math.floor(2 * 90 + 31 + 21) * 76 / 100) + 5), 'Left panel pairs your Attack with their estimated Defense');
    check(await page.locator('#matchup-own .speed-badge').count() === 1 && await page.locator('#matchup-foe .speed-badge').count() === 1 && ((await page.locator('#matchup-own .speed-badge').innerText()).includes('1') !== (await page.locator('#matchup-foe .speed-badge').innerText()).includes('1') || (await page.locator('.speed-badge[data-first=true]').count()) === 2), 'Exactly one side moves first unless tied');
    await page.locator('#switch-2').focus();
    check((await panelNames('#matchup-own'))[0] === 'Palossand' && await page.locator('.move-preview').count() === 4 && !await page.locator('#move-1').isVisible() && (await page.locator('.move-preview strong').allInnerTexts()).includes('Earth Power'), 'Cursor on a bench Pokémon previews its moves and matchup');
    check(await page.locator('#tera .tera-type').innerText() === 'Water' && (await page.locator('#tera .tera-gem').getAttribute('src')).endsWith('TeraWater.png'), 'The Tera button follows the previewed Pokémon, name plus gem');
    check(await page.locator('.form-tag').count() === 0 && await page.evaluate(() => { const name = document.querySelector('#switch-1 .mon-name'); return name.scrollWidth <= name.clientWidth + 1; }), 'Roster names fit; no region tags on the demo team');
    await pad(page, 0);
    await page.locator('#switch-2').focus(); await pad(page, 13);
    check(/^preview-move-\d$/.test(await page.evaluate(() => document.activeElement.id)) && await page.locator('.move-preview').count() === 4, 'The cursor can move onto a previewed move without ending the preview');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('#preview-move-1')).opacity) === '1', 'Previewed moves are not grayed out');
    await pad(page, 1);
    check(await page.locator('.move-preview').count() === 4 && !(await page.locator('#notice').innerText()).includes('selected'), 'Pressing a previewed move selects nothing');
    await page.locator('#switch-2').focus();
    await pad(page, 12);
    check(await page.locator('.move-preview').count() === 4 && /^preview-move-\d$/.test(await page.evaluate(() => document.activeElement.id)) && await page.evaluate(() => getComputedStyle(document.querySelector('.move-preview')).borderTopStyle) === 'solid', 'Up from the bench lands on the benched Pokémon\'s moves, drawn solid and gray');
    await pad(page, 11);
    check(await page.locator('#modal').isVisible() && await page.locator('#modal-title').innerText() !== '', 'R3 on a grayed preview move opens that move\'s info');
    await pad(page, 0);
    check(await page.locator('.move-preview').count() === 4 && /^preview-move-\d$/.test(await page.evaluate(() => document.activeElement.id)), 'Closing the info returns to the preview move; the preview stays');
    await page.locator('#switch-2').focus(); await pad(page, 0);
    check(await page.locator('.move-preview').count() === 0 && await page.locator('#move-1').isVisible() && await page.evaluate(() => document.activeElement.id === 'move-1'), 'B on a bench Pokémon puts the cursor on the active Pokémon\'s first move and ends the preview');
    await page.keyboard.press('f'); await page.locator('#opponent-3').focus(); await pad(page, 0);
    check(await page.locator('.move-preview').count() === 0 && await page.evaluate(() => document.activeElement.id === 'move-1'), 'B on an opponent also returns to the first move');
    check(await page.locator('#roster').isVisible() && !await page.locator('#opponent-roster').isVisible(), 'B on an opponent flips the team row back to the own side');
    await page.locator('#switch-1').focus();
    check(await page.locator('#tera .tera-type').innerText() === 'Psychic', 'Leaving the preview restores the active Pokémon\'s Tera type');
    check(await page.locator('.info-facts > div[data-cue]:not([data-cue=""])').count() === 0, 'No stale cue borders remain outside the panels');
    check(await height(page, '#switch-1') >= 60, 'Roster buttons are at least 60px tall');
    check(await height(page, '#switch-1 .team-hp') >= 8, 'Roster HP bars are at least 8px tall');
    check(await page.locator('#switch-4').getAttribute('data-fainted') === 'true' && (await page.locator('#switch-4').getAttribute('aria-label')).includes('Fainted') && await page.locator('#switch-4 .status-tag').count() === 0, 'Fainted Pokémon are styled and announced, with no tag or numbers');
    await page.screenshot({path: `test-results/${engineName}-battle-${viewport.width}-${viewport.height}.png`});
    check(!(await fit(page)).length, `Battle and header controls fit ${viewport.width}×${viewport.height}: ${await fit(page)}`);
    await page.locator('#switch-1').focus(); await pad(page, 8);
    check(await page.locator('dialog[open]').count() === 1 && await page.locator('#modal-title').innerText() === 'Menu' && await page.locator('#modal #chat, #modal #rating, #modal #open-replay, #modal #setup, #modal #diagnostics, #modal #source').count() === 6 && await page.locator('#modal #primary, #modal #forfeit').count() === 0 && (await page.locator('.menu-grid button').allInnerTexts()).join(',') === 'Chat,Rating,Open replay,Setup,Controller check,Source', 'Select opens a menu modal with Chat, Rating, Open replay, Setup, Controller check, Source and no battle buttons');
    check(await page.locator('#source').evaluate(el => el.tagName) === 'BUTTON' && await page.locator('a#source').count() === 0, 'Source is a button, not a hyperlink');
    await page.locator('#setup').focus(); await pad(page, 12);
    check(await page.evaluate(() => document.activeElement.id) === 'chat', 'Up from the second menu row lands on the button above, not the close button');
    await pad(page, 13);
    check(await page.evaluate(() => document.activeElement.id) === 'setup', 'Down returns to the second row');
    check(await page.locator('#modal #replay').count() === 0, 'Replay is not in the menu');
    await pad(page, 0); await pad(page, 9);
    check(await page.locator('dialog[open]').count() === 1 && await page.locator('#modal-title').innerText() === 'Battle' && (await page.locator('.menu-grid button').allInnerTexts()).join(',') === 'Connect to Showdown,Forfeit…' && await page.evaluate(() => document.activeElement.id) === 'primary', 'Start opens the battle menu with the primary button and Forfeit, primary focused');
    await pad(page, 0);
    check(await page.locator('dialog[open]').count() === 0, 'B closes the battle menu');
    await pad(page, 9); await pad(page, 9);
    check(await page.locator('dialog[open]').count() === 0, 'Start pressed again closes the battle menu');
    await pad(page, 8); await pad(page, 8);
    check(await page.locator('dialog[open]').count() === 0, 'Select pressed again closes the Select menu');
    await pad(page, 8);
    check(!(await fit(page)).length, `Menu has no scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-menu-${viewport.width}-${viewport.height}.png`});
    await pad(page, 0);
    check(await page.locator('dialog[open]').count() === 0 && await page.evaluate(() => document.activeElement.id) === 'switch-1', 'B closes the menu and returns to the battle choices');
    await page.locator('#move-1').focus(); await pad(page, 10);
    check(await page.locator('dialog[open]').count() === 0 && await page.locator('#opponent-roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'preview-move-1' && await page.locator('.move-preview').count() === 4, 'Button 10 (bumper) from the move row flips to the opponent row, shows their active Pokémon\'s moves and focuses the first one');
    await pad(page, 10); await page.keyboard.press('t');
    check(await page.locator('dialog[open]').count() === 0 && await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'move-1', 'Button 10 flips back to the own side on the active Pokémon\'s first move; T does nothing');
    const fieldBefore = await page.locator('#arena').evaluate(el => el.getBoundingClientRect().width);
    await page.keyboard.press('h');
    check(await page.evaluate(() => document.activeElement.id) === 'chat' && await page.locator('.menu-grid button').first().evaluate(el => el.id) === 'chat', 'The menu opens with Chat as the first button and focused');
    await page.locator('#chat').click();
    const chatTitle = async () => page.locator('#modal-title').innerText();
    const turnCount = await page.locator('#hidden-log .inner > h2').count();
    // The fixture's last heading (Turn 16) has no lines under it, so the chat opens on the turn before it.
    const lastWithLines = await page.evaluate(() => { const nodes = [...document.querySelectorAll('#hidden-log .inner > *')]; let title = 'Battle start'; let lines = 0; let shown = 'Battle start'; for (const node of nodes) { if (node.tagName === 'H2') { if (lines) shown = title; title = node.textContent; lines = 0; } else lines++; } return lines ? title : shown; });
    check(await page.locator('dialog[open]').count() === 1 && await page.evaluate(() => document.querySelector('#modal').dataset.view) === 'chat' && await chatTitle() === lastWithLines && await page.locator('.chat-turn').count() === 1 && await page.locator('.chat-hint').count() === 0, `Chat opens a modal on the last turn with lines, no hint text: ${await chatTitle()}`);
    check(!await page.locator('#chat-drawer').isVisible() && await page.locator('#arena').evaluate(el => el.getBoundingClientRect().width) === fieldBefore, 'No chat drawer; the field keeps its size');
    const openedTitle = await chatTitle(); await pad(page, 12);
    const upMoved = await chatTitle() !== openedTitle;
    check(turnCount < 2 || openedTitle === 'Battle start' || upMoved, `Up shows the previous turn: ${await chatTitle()}`);
    const shownTitle = await chatTitle(); await pad(page, 14); await pad(page, 15);
    check(await chatTitle() === shownTitle && await page.evaluate(() => document.querySelector('#modal').dataset.view) === 'chat', 'Left and right do nothing in the chat');
    await pad(page, 13);
    check(!upMoved || await chatTitle() === openedTitle, 'Down returns to the opened turn');
    const latestTitle = await page.locator('#hidden-log .inner > h2').last().innerText();
    await pad(page, 13); await pad(page, 13);
    check(await chatTitle() === latestTitle, 'Down past the latest turn stays put on the current turn');
    check(!(await fit(page)).length, `Chat turn fits without scrolling: ${await fit(page)}`);
    const chatBox = async () => page.evaluate(() => { const r = document.querySelector('#modal').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    const sizeLatest = await chatBox(); await pad(page, 12); const sizePrevious = await chatBox(); await pad(page, 13);
    check(sizeLatest === sizePrevious && await page.evaluate(() => document.querySelector('#modal').getBoundingClientRect().height >= Math.min(650, innerHeight - 24) - 1), `Chat modal keeps one size across turns: ${sizeLatest} vs ${sizePrevious}`);
    await pad(page, 0);
    check(await page.locator('dialog[open]').count() === 1 && await chatTitle() === 'Menu' && await page.evaluate(() => document.activeElement.id) === 'chat', 'B in the chat returns to the menu with Chat focused');
    await page.keyboard.press('Escape');
    await page.locator('#switch-1').focus(); await pad(page, 11);
    await page.waitForSelector('#info-content');
    check(await page.locator('[data-info-tab], #prev-info-page, .inspection-note').count() === 0, 'Own Pokémon have one flat page: no Overview tab, no paging, no footnote');
    check((await page.locator('#modal-title').innerText()) === 'Grumpig · Lv 92', 'R3 shows name and level without gender');
    check((await page.locator('.inspection-banner').innerText()).includes('297/297') && await page.locator('.identity-types .type-badge').innerText() === 'Psychic', 'Types and exact HP share the banner');
    for (const label of ['Attack', 'Defense', 'Sp. Atk', 'Sp. Def']) {
      check(await page.locator('.info-facts > div').filter({has: page.getByText(label, {exact: true})}).locator('dd').innerText() === '150', `Exact private ${label} remains available`);
    }
    check(await page.locator('.compact-move').count() === 4 && await page.locator('.compact-move button').count() === 0, 'Four compact moves cannot open a nested menu');
    check(JSON.stringify(await page.locator('.stats-layout dt').allInnerTexts()) === JSON.stringify(['Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed']) && await page.locator('.identity-speed').count() === 0, 'Stats read Attack, Defense, Sp. Atk, Sp. Def, Speed in one row');
    check(JSON.stringify(await page.locator('.overview-layout > .info-facts dt').allInnerTexts()) === JSON.stringify(['Ability', 'Item', 'Tera']) && (await page.locator('.overview-layout > .info-facts').innerText()).includes('Thick Fat') && !(await page.locator('#modal-body').innerText()).includes('IVs'), 'Own overview reads Ability, Item, Tera, without the IV note');
    check(await height(page, '.overview-layout .compact-move') >= 0.85 * await height(page, '.stats-layout .info-facts > div'), 'R3 move entries are about as tall as the stat cells');
    check(await page.locator('.compact-moves').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 4, 'Known moves sit in one row of four');
    // SKIP_REMOTE_ASSETS=1 skips this where play.pokemonshowdown.com is unreachable; CI always runs it.
    if (viewport.height === 540 && !process.env.SKIP_REMOTE_ASSETS) {
      const icons = await page.evaluate(async () => {
        const {itemLabel} = await import('/src/info-components.mjs');
        const sprite = new Image(); sprite.src = 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png?v1';
        await sprite.decode();
        const snapshot = await fetch('/data/gen9randombattle.json').then(r => r.json());
        const items = new Set(Object.values(snapshot.pokemon).flatMap(p => Object.values(p.roles).flatMap(r => Object.keys(r.items || {}))));
        return {loaded: sprite.naturalWidth === 384, missing: [...items].filter(name => !itemLabel(name).includes('class="item-icon"'))};
      });
      check(icons.loaded && !icons.missing.length, `Complete item sheet loads and covers every possible held item: ${icons.missing}`);
    }
    check(!(await fit(page)).length, `Overview fits without scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-overview-${viewport.width}-${viewport.height}.png`});
    await pad(page, 13);
    check((await page.locator('#modal-title').innerText()).includes('Grumpig') && await page.locator('[data-info-tab]').count() === 0, 'Down on an own Pokémon has no pages to reveal');
    await pad(page, 15);
    check((await page.locator('#modal-title').innerText()).includes('Palossand'), 'D-pad right moves to the next Pokémon, matching the roster');
    await pad(page, 10);
    check((await page.locator('#modal-title').innerText()).includes('Corviknight') && await page.locator('.overview-layout').count() === 1, 'A bumper inside R3 jumps to the other team, same slot number');
    await page.keyboard.press('f');
    check((await page.locator('#modal-title').innerText()).includes('Palossand'), 'F flips back to your own Pokémon in R3');
    await pad(page, 14); await pad(page, 14);
    check((await page.locator('#modal-title').innerText()).includes('Iron Hands') && (await page.locator('.identity-hp').innerText()).includes('0 fnt'), 'D-pad left wraps to the sixth, fainted Pokémon');
    await pad(page, 0);
    check(!await page.locator('#modal').isVisible() && await page.evaluate(() => document.activeElement.id) === 'switch-1', 'One B closes the whole panel and restores the original roster focus');
    await page.locator('#switch-2').focus(); await pad(page, 11); await page.keyboard.press('f'); await pad(page, 0);
    check(await page.locator('#opponent-roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'opponent-2', 'Closing after a flip inside R3 lands on that opponent slot');
    await page.keyboard.press('f');
    check(!await page.locator('#arena .leftbar').isVisible() && !await page.locator('#arena .rightbar').isVisible(), 'Renderer side bars are hidden');
    await page.locator('#switch-1').focus(); await page.locator('#move-2').focus(); await pad(page, 11);
    check(await page.locator('#modal-title').innerText() === 'Shadow Ball' && (await page.locator('#info-content').innerText()).includes('20%'), 'R3 on a main move opens its detailed effects');
    check(!(await fit(page)).length, `Move details fit: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-move-${viewport.width}-${viewport.height}.png`});
    await pad(page, 0);
    check(await page.evaluate(() => document.activeElement.id) === 'move-2', 'Move details close directly to the battle move');
    await page.keyboard.press('f'); await page.locator('#opponent-1').focus(); await pad(page, 11);
    check(/^Landorus · Lv 76 · [🎯❓] /u.test(await page.locator('#modal-title').innerText()) && (await page.locator('.info-facts').first().innerText()).includes('Sheer Force') && (await page.locator('.identity-hp').innerText()).includes('31%'), 'Opponent title shows level and the role badge; cards show the revealed ability and last shown HP');
    check(await page.locator('.overview-layout').count() === 1 && await page.locator('.role-layout, .merged-overview, [data-identified]').count() === 0 && await page.evaluate(() => [...document.querySelectorAll('.role-group')].every(group => group.querySelector('.role-heading') && group.querySelector('.compact-moves'))) && await page.locator('.compact-move[data-revealed="true"]').count() >= 1, 'The opponent page uses the own-Pokémon layout, with revealed moves marked and no duplicate role tags');
    const roleTitle = await page.locator('#modal-title').innerText();
    await page.locator('.compact-move').first().click(); await pad(page, 11);
    check(await page.locator('#modal-title').innerText() === roleTitle && await page.locator('.overview-layout').count() === 1, 'R3 on a role move never opens another menu');
    check(await page.locator('#info-content .move-description, #info-content .move-metrics, #info-content .move-summary').count() === 0, 'Role move lists omit power and descriptions');
    check(!(await fit(page)).length, `Role fits without scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-possible-role-${viewport.width}-${viewport.height}.png`});
    await pad(page, 15); await pad(page, 15);
    check(await page.locator('.info-facts > div[data-list="true"]').count() >= 1 && (await page.locator('.overview-layout > h3').allInnerTexts()).join('|') === 'Stats (before modifiers)' && await page.locator('.role-group').count() >= 1 && (await page.locator('.stats-layout dt').allInnerTexts()).join(',') === 'Attack,Defense,Sp. Atk,Sp. Def,Speed' && (await page.locator('.stats-layout dd').allInnerTexts()).every(text => text.startsWith('~')), 'Right moves to the next opponent; the page uses the own layout: Ability/Item/Tera cards, five ~estimated stat boxes, one move row per role');
    await pad(page, 15);
    check(await page.locator('[data-info-tab]').count() === 0 && await page.locator('#modal .type-badge, #modal .compact-move').count() === 0, 'Unknown slots expose neither a guessed identity nor possible sets');
    await pad(page, 0); await page.keyboard.press('f');
    for (const id of ['setup', 'diagnostics']) {
      await page.keyboard.press('h'); await page.locator(`#${id}`).click();
      check(!(await fit(page)).length, `${id} has no scrolling: ${await fit(page)}`);
      await page.locator('#modal-close').click();
    }
    await page.route('**/users/mepc36363636.json', route => route.fulfill({json: {userid: 'mepc36363636', ratings: {gen9randombattle: {elo: 1375.16, gxe: 54.5, w: 228, l: 244}}}}));
    await page.keyboard.press('h'); await page.locator('#rating').click(); await page.waitForFunction(() => document.querySelector('#modal-body').textContent.includes('1375'));
    check(!(await fit(page)).length, `Rating fits: ${await fit(page)}`); await pad(page, 0);
    check(errors.length === 0, `No runtime errors: ${errors.join(', ')}`);
    await page.close();
  }

  // Render every real candidate role at the smallest supported landscape size.
  const pools = await browser.newPage({viewport: {width: 1024, height: 540}, hasTouch: true, isMobile: true});
  await pools.goto(base); await pools.waitForSelector('#switch-1');
  await pools.keyboard.press('f'); await pools.locator('#opponent-1').focus(); await pools.keyboard.press('i');
  await pools.waitForSelector('.overview-layout');
  const coverage = await pools.evaluate(async () => {
    const {rolePages} = await import('/src/info-components.mjs');
    const {narrowSets} = await import('/src/possible-sets.mjs');
    const snapshot = await fetch('/data/gen9randombattle.json').then(r => r.json());
    const failures = []; let count = 0;
    const speedInfo = '<div class="identity-speed"><small>Speed (estimated)</small><strong>312 or 376</strong><small>before modifiers</small></div>';
    for (const [name, pokemon] of Object.entries(snapshot.pokemon)) for (const page of rolePages({snapshot}, name, pokemon.level, speedInfo, narrowSets(snapshot, name, pokemon.level))) {
      const el = document.querySelector('#info-content'); el.innerHTML = page.content;
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) failures.push(`${name}/${page.label}: ${el.scrollHeight}/${el.clientHeight}`);
      count++;
    }
    return {count, failures};
  });
  check(!coverage.failures.length, `All ${coverage.count} candidate role pages fit without clipping: ${coverage.failures.slice(0, 10)}`);
  await pools.evaluate(async () => {
    const {rolePages} = await import('/src/info-components.mjs'); const snapshot = await fetch('/data/gen9randombattle.json').then(r => r.json());
    document.querySelector('#info-content').innerHTML = rolePages({snapshot}, 'Raichu', snapshot.pokemon.Raichu.level, document.querySelector('.identity-speed')?.outerHTML || '')[0].content;
  });
  await pools.screenshot({path: `test-results/${engineName}-largest-pool.png`});
  await pools.keyboard.press('Escape'); await pools.locator('#move-1').focus(); await pools.keyboard.press('i');
  const longRules = await pools.evaluate(async () => {
    const {movePages} = await import('/src/info-components.mjs'); const {moveInformation} = await import('/src/information.mjs');
    const {Dex} = await import('/node_modules/@pkmn/dex/build/index.mjs');
    const longest = Dex.moves.all().toSorted((a,b) => b.desc.length - a.desc.length)[0];
    const pages = movePages(moveInformation(longest.id)); let fits = true;
    for (const page of pages) { const el = document.querySelector('#info-content'); el.innerHTML = page.content; fits &&= el.scrollHeight <= el.clientHeight + 2; }
    return {name: longest.name, count: pages.length, fits};
  });
  check(longRules.fits, `Long move rules stay on ${longRules.count} flat pages: ${longRules.name}`);
  await pools.close();

  const failed = await browser.newPage();
  await failed.route('**/data/gen9randombattle.json', route => route.fulfill({status: 503, body: 'Unavailable'}));
  await failed.goto(base); await failed.waitForSelector('#switch-1');
  await failed.locator('#switch-1').focus(); await failed.keyboard.press('i');
  check(await failed.locator('.compact-move').count() === 4, 'Known moves survive unavailable set data');
  check(await failed.locator('#retry-sets').count() === 0, 'Own Pokémon never show a set-data retry page');
  await failed.keyboard.press('Escape'); await failed.keyboard.press('f'); await failed.locator('#opponent-1').focus(); await failed.keyboard.press('i');
  await failed.keyboard.press('ArrowDown'); await failed.waitForSelector('#retry-sets');
  await failed.unroute('**/data/gen9randombattle.json'); await failed.keyboard.press('Enter');
  await failed.waitForSelector('.overview-layout');
  check(await failed.locator('.overview-layout').count() === 1, 'Retry restores a possible-role page at the same depth');
  await failed.close();

  const renderer = await browser.newPage();
  await renderer.goto(`${base}/test/renderer.html`);
  await renderer.waitForFunction(() => typeof document.querySelector('#run').onclick === 'function');
  await renderer.locator('#run').click();
  await renderer.waitForFunction(() => document.querySelector('#results').textContent.includes('All checks passed') || document.querySelector('#results').textContent.includes('FAIL'));
  const rendererResult = await renderer.locator('#results').innerText();
  check(!rendererResult.includes('FAIL'), rendererResult); await renderer.close();

  const lobby = await browser.newPage(); await gamepad(lobby);
  await lobby.goto(`${base}/test/cancel.html?lobby`); await lobby.waitForSelector('#switch-1');
  await lobby.keyboard.press('s'); await lobby.locator('#primary').click();
  await lobby.waitForFunction(() => document.querySelector('#arena-wrap').dataset.room.includes('12345'));
  check((await lobby.locator('#test-commands').innerText()).match(/\/search gen9randombattle/g).length === 1 && await lobby.locator('dialog[open]').count() === 0, 'Connect to Showdown searches for a battle by itself once the login is confirmed');
  await lobby.close();

  const cancel = await browser.newPage(); await gamepad(cancel);
  await cancel.goto(`${base}/test/cancel.html`); await cancel.waitForSelector('#switch-1');
  await cancel.keyboard.press('s'); await cancel.locator('#primary').click();
  await cancel.waitForFunction(() => document.querySelector('#arena-wrap').dataset.room.includes('12345'));
  await cancel.waitForFunction(() => document.querySelector('#test-commands').textContent.includes('/timer on'));
  check((await cancel.locator('#test-commands').innerText()).match(/\/timer on/g).length === 1 && await cancel.locator('#timer-toggle').count() === 0, 'The timer starts itself once when the battle starts');
  check(await cancel.locator('dialog[open]').count() === 0, 'Find Random Battle closes the menu');
  await cancel.locator('#switch-2').focus(); await cancel.keyboard.press('i'); await cancel.keyboard.press('ArrowRight'); await cancel.keyboard.press('ArrowDown'); await cancel.keyboard.press('Escape');
  check(!(await cancel.locator('#test-commands').innerText()).includes('/choose'), 'Flat information navigation never sends a battle choice');
  await cancel.locator('#switch-1').focus(); await cancel.locator('#move-1').click();
  check((await cancel.locator('#test-commands').innerText()).includes('/choose move 1|1'), 'Battle choices still submit immediately');
  await cancel.keyboard.press('ArrowLeft'); await cancel.locator('#move-2').click();
  check(await cancel.evaluate(() => { const el = document.querySelector('#move-2'); return !el.disabled && el.dataset.locked === 'true' && document.activeElement === el; }) && !(await cancel.locator('#test-commands').innerText()).includes('/choose move 2'), 'Moves stay focusable for review while a choice is pending but cannot be chosen');
  check(await cancel.evaluate(() => document.querySelector('#choices').dataset.pending === 'true' && getComputedStyle(document.querySelector('#switch-1')).backgroundColor === 'rgb(211, 216, 221)' && getComputedStyle(document.querySelector('#move-1')).backgroundColor === 'rgb(211, 216, 221)'), 'A sent choice grays the move row and the active Pokémon');
  await cancel.keyboard.press('f'); await cancel.locator('#opponent-2').focus(); await cancel.keyboard.press('Escape');
  check(await cancel.evaluate(() => !document.querySelector('.team-row[data-side="own"]').hidden && document.querySelector('.team-row[data-side="opponent"]').hidden), 'B from the foe roster flips the team row back to the own side');
  check((await cancel.locator('#test-commands').innerText()).includes('/undo |1') && await cancel.evaluate(() => document.activeElement.id) === 'move-1', 'B / Escape invokes Showdown undo and lands on the first move');
  check(await cancel.locator('#foe-timer-value').innerText() === '—' && (await cancel.locator('#battle-timer .timer-who').allInnerTexts()).join(' ') === 'You: Them:', 'The opponent timer shows a dash until the server warns about them');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|inactive|Offline preview has 20 seconds left.'}));
  check(await cancel.locator('#foe-timer-value').innerText() === '0:20', 'An opponent warning fills the Them timer');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|inactive|mepc36363636 has 30 seconds left.'}));
  check((await cancel.locator('#timer-warning').innerText()).includes('30s') && await cancel.locator('#foe-timer-value').innerText() === '0:20', 'Server countdown warning appears in the prominent timer; your warning leaves the Them timer alone');
  await cancel.screenshot({path: `test-results/${engineName}-timer-warning.png`});
  await cancel.setViewportSize({width: 1024, height: 540});
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|switch|p2a: Raichu|Raichu, L88, M|100/100\n|turn|17'}));
  await cancel.waitForFunction(() => document.querySelector('#opponent-4')?.textContent.includes('Raichu'));
  await cancel.keyboard.press('f'); await cancel.locator('#opponent-4').focus(); await cancel.keyboard.press('i');
  check(await cancel.locator('[data-info-tab]').count() === 0 && await cancel.locator('.role-group').count() >= 2 && (await cancel.locator('#modal-title').innerText()).includes('❓') && (await cancel.locator('#modal-title').innerText()).includes('possible roles'), 'Ambiguous opponent lists every matching role on one page with the ❓ badge');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Tera Blast|p1a: Grumpig\n|turn|18'}));
  await cancel.waitForFunction(() => document.querySelector('#modal-title').textContent.includes('🎯'));
  const inferredTera = cancel.locator('.info-facts > div').filter({has: cancel.getByText('Tera', {exact: true})});
  check(await inferredTera.locator('dd').innerText() === 'Ice' && await inferredTera.getAttribute('data-cue') === 'green', 'A unique live move infers the fixed Tera and marks it green');
  check(await cancel.locator('.role-group').count() === 1 && await cancel.locator('.overview-layout').count() === 1 && (await cancel.locator('#modal-title').innerText()).includes('🎯 Tera Blast user'), 'Live inference removes incompatible roles, leaving one role row with the 🎯 badge');
  check(await cancel.locator('#opponent-4').getAttribute('data-cue') === 'green', 'Identified opponent gets a green roster border');
  check(!(await fit(cancel)).length, `Inferred overview fits the smallest viewport: ${await fit(cancel)}`);
  check(await cancel.locator('.compact-move[data-revealed="true"]').count() >= 1 && await cancel.evaluate(() => getComputedStyle(document.querySelector('.compact-move[data-revealed="true"] strong'), '::after').content.includes('👀')), 'Seen moves on the role page carry the 👀 mark');
  check(await cancel.evaluate(() => { const items = [...document.querySelectorAll('.compact-move:not(.unknown-move)')]; const firstUnseen = items.findIndex(li => li.dataset.revealed !== 'true'); return items[0]?.dataset.revealed === 'true' && items.slice(Math.max(firstUnseen, 0)).every(li => firstUnseen < 0 || li.dataset.revealed !== 'true'); }), 'Seen moves come first in the role page move list');
  await cancel.keyboard.press('Escape'); await cancel.locator('#opponent-3').focus(); await cancel.locator('#opponent-4').focus();
  const foeRow = await cancel.evaluate(() => { const b = [...document.querySelectorAll('.move-preview')]; return {total: b.length, revealed: b.filter(x => !x.dataset.candidate && !x.classList.contains('more-moves') && !x.classList.contains('unknown-move')).length, candidates: b.filter(x => x.dataset.candidate).length, more: b.filter(x => x.classList.contains('more-moves')).map(x => x.textContent), blanks: b.filter(x => x.classList.contains('unknown-move')).length}; });
  check(foeRow.total === 4 && foeRow.revealed === 1 && foeRow.blanks === 0 && foeRow.candidates + foeRow.more.length === 3 && (!foeRow.more.length || /^\+\d+ more$/.test(foeRow.more[0])), `An identified role fills the foe move row with candidates, no blanks: ${JSON.stringify(foeRow)}`);
  check(await cancel.evaluate(() => getComputedStyle(document.querySelector('.move-preview[data-seen="true"] strong'), '::after').content.includes('👀') && getComputedStyle(document.querySelector('.move-preview[data-candidate="true"] strong'), '::after').content.includes('🔮')), 'Foe move row marks seen moves 👀 and inferred candidates 🔮');
  await cancel.keyboard.press('s');
  check(await cancel.evaluate(() => document.activeElement.id) === 'forfeit' && await cancel.locator('#primary').isDisabled(), 'Mid-battle the Start menu opens on Forfeit because Find Random Battle is disabled');
  await cancel.locator('#forfeit').click();
  check(await cancel.evaluate(() => document.activeElement.id) === 'keep-playing' && await cancel.locator('#modal-title').innerText() === 'Forfeit battle?' && await cancel.locator('#confirm-forfeit').innerText() === 'Forfeit' && await cancel.evaluate(() => { const [left, right] = document.querySelectorAll('.modal-actions button'); return left.id === 'keep-playing' && right.id === 'confirm-forfeit' && getComputedStyle(left.parentElement).justifyContent === 'center'; }), 'The forfeit dialog is titled Forfeit battle?, opens on Keep playing (left) with Forfeit on the right, buttons centered');
  await cancel.locator('#keep-playing').click();
  await cancel.locator('#opponent-4').focus(); await cancel.keyboard.press('i'); await cancel.waitForSelector('.inspection-note');
  await cancel.screenshot({path: `test-results/${engineName}-inferred-set.png`});
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Spore|p1a: Grumpig\n|turn|19'}));
  await cancel.waitForFunction(() => document.querySelector('.inspection-note').textContent.includes('do not match'));
  check(await cancel.locator('#opponent-4').getAttribute('data-cue') === '' && await cancel.locator('.info-facts > div[data-cue="green"]').count() === 0, 'Contradictory reveals clear inferred certainty and restore the full list');
  await cancel.keyboard.press('Escape'); await cancel.keyboard.press('f');

  // The server request already knows the turn's result; the roster must wait for the hit to land.
  const barWidth = async id => cancel.evaluate(sel => parseFloat(document.querySelector(`${sel} .team-hp > span`).style.width), id);
  await cancel.evaluate(async () => {
    const {demoRequest} = await import('/src/demo.mjs');
    const hurt = {...demoRequest, rqid: 2, side: {...demoRequest.side, pokemon: demoRequest.side.pokemon.map(p => p.ident === 'p1: Grumpig' ? {...p, condition: '150/297'} : p)}};
    window.testSocket.onmessage({data: `>battle-gen9randombattle-12345\n|request|${JSON.stringify(hurt)}`});
  });
  check(await barWidth('#switch-1') === 100, 'A request that already knows the damage does not drain the roster bar early');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Thunderbolt|p1a: Grumpig\n|-damage|p1a: Grumpig|150/297\n|turn|20'}));
  check(await barWidth('#switch-1') === 100, 'The roster bar still waits while the attack animation plays');
  await cancel.waitForFunction(() => parseFloat(document.querySelector('#switch-1 .team-hp > span').style.width) < 100, null, {timeout: 15000});
  check(Math.abs(await barWidth('#switch-1') - 150 / 297 * 100) < 0.01, 'After the hit lands the roster bar drains to the renderer HP');

  // Switching reorders the server request (active first); the roster keeps the lead first.
  await cancel.evaluate(async () => {
    const {demoRequest} = await import('/src/demo.mjs');
    const team = demoRequest.side.pokemon.map(p => ({...p, active: p.ident === 'p1: Palossand'}));
    const swapped = {...demoRequest, rqid: 3, side: {...demoRequest.side, pokemon: [team[1], team[0], ...team.slice(2)]}};
    window.testSocket.onmessage({data: `>battle-gen9randombattle-12345\n|request|${JSON.stringify(swapped)}`});
    window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|switch|p1a: Palossand|Palossand, L80|118/324\n|switch|p2a: Rotom|Rotom-Wash, L80|34/100 par\n|turn|21'});
  });
  await cancel.waitForFunction(() => document.querySelector('#switch-2')?.dataset.active === 'true', null, {timeout: 15000});
  const names = id => cancel.evaluate(sel => [...document.querySelectorAll(`${sel} strong`)].map(el => el.firstChild.textContent), id);
  check(JSON.stringify(await names('#roster')) === JSON.stringify(['Grumpig', 'Palossand', 'Excadrill', 'Breloom', 'Amoonguss', 'Iron Hands']), 'Own roster keeps the lead first after a switch');
  check(await cancel.locator('#switch-2').getAttribute('data-active') === 'true' && await cancel.locator('#switch-1').getAttribute('data-active') === 'false', 'The active marker follows the Pokémon, not the slot');
  check(JSON.stringify(await names('#opponent-roster')) === JSON.stringify(['Landorus', 'Corviknight', 'Rotom-Wash', 'Raichu', 'Unknown', 'Unknown']), 'Opponent roster stays in order of first reveal after a switch');

  // The opponent's Pokémon faints and they pick the next one: the side panels stay, with my numbers and dashes for theirs.
  await cancel.evaluate(async () => {
    const {demoRequest} = await import('/src/demo.mjs');
    const team = demoRequest.side.pokemon.map(p => ({...p, active: p.ident === 'p1: Palossand'}));
    const waiting = {wait: true, rqid: 4, side: {...demoRequest.side, pokemon: [team[1], team[0], ...team.slice(2)]}};
    window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p1a: Palossand|Earth Power|p2a: Rotom\n|-damage|p2a: Rotom|0 fnt\n|faint|p2a: Rotom'});
    window.testSocket.onmessage({data: `>battle-gen9randombattle-12345\n|request|${JSON.stringify(waiting)}`});
  });
  await cancel.waitForFunction(() => document.querySelector('#matchup-foe .matchup-names span:first-child')?.textContent === '—', null, {timeout: 15000});
  await cancel.locator('#switch-2').focus();
  check(await cancel.locator('#matchup-own').isVisible() && await cancel.locator('#matchup-foe').isVisible() && await cancel.locator('#matchup-own .matchup-names span').first().innerText() === 'Palossand' && /^\d+$/.test(await cancel.locator('#matchup-own .stat-box strong').first().innerText()) && (await cancel.locator('#matchup-foe .stat-box strong').first().innerText()) === '—', 'Side panels stay while the opponent picks a replacement, keeping my columns');
  await cancel.evaluate(async () => {
    const {demoRequest} = await import('/src/demo.mjs');
    const team = demoRequest.side.pokemon.map(p => ({...p, active: p.ident === 'p1: Palossand'}));
    window.testSocket.onmessage({data: `>battle-gen9randombattle-12345\n|request|${JSON.stringify({...demoRequest, rqid: 3, side: {...demoRequest.side, pokemon: [team[1], team[0], ...team.slice(2)]}})}`});
    window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|switch|p2a: Raichu|Raichu, L88, M|100/100\n|turn|22'});
  });
  await cancel.waitForFunction(() => document.querySelector('#matchup-foe .matchup-names span:first-child')?.textContent === 'Raichu', null, {timeout: 15000});
  await cancel.locator('#switch-1').focus(); await cancel.keyboard.press('i');
  check((await cancel.locator('#modal-title').innerText()).includes('Grumpig'), 'R3 on the first roster slot still opens the lead');
  await cancel.keyboard.press('Escape');
  await cancel.locator('#switch-1').click();
  check((await cancel.locator('#test-commands').innerText()).includes('/choose switch 2|3'), 'Switching to the displayed lead sends its current server index');
  await cancel.keyboard.press('Escape');
  await cancel.keyboard.press('h');
  check(await cancel.locator('#modal-title').innerText() === 'Menu' && await cancel.locator('#replay').count() === 0, 'Keyboard H opens the menu; no replay controls while the battle runs');
  await cancel.keyboard.press('Escape');
  await cancel.keyboard.press('c');
  const openedOn = await cancel.locator('#modal-title').innerText();
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Thunderbolt|p1a: Palossand\n|turn|18'}));
  await cancel.waitForFunction(() => [...document.querySelectorAll('#hidden-log h2')].some(el => el.textContent === 'Turn 22'));
  check(await cancel.locator('#modal-title').innerText() === openedOn && await cancel.evaluate(() => document.querySelector('#modal').dataset.view) === 'chat', `A new turn arriving keeps the chat on ${openedOn}`);
  await pad(cancel, 13);
  check(await cancel.locator('#modal-title').innerText() === 'Turn 22', 'Down reaches the new turn');
  await cancel.keyboard.press('Escape'); await cancel.keyboard.press('Escape');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|switch|p2a: Ninetales|Ninetales-Alola, L78|100/100\n|turn|19'}));
  await cancel.waitForFunction(() => [...document.querySelectorAll('#opponent-roster .mon-name')].some(el => el.textContent === 'Ninetales'));
  check(await cancel.locator('#opponent-roster .form-tag').innerText() === 'ALOLA' && (await cancel.locator('#matchup-foe .matchup-names .form-tag').count()) === 1, 'Regional forms show the species with a region tag on the roster and the side panel');
  check((await cancel.locator('#opponent-roster button:has(.form-tag) .roster-ability').innerText()) === 'Snow Warning' && await cancel.locator('#opponent-roster button:has(.form-tag) .roster-item.inferred').count() === 1, 'Opponent roster shows the ability and item every remaining set agrees on, marked inferred');
  await cancel.keyboard.press('h');
  await cancel.keyboard.press('Escape');
  check(await cancel.locator('#tera').isVisible(), 'Tera shows during the battle');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|win|Opponent'}));
  await cancel.waitForFunction(() => document.querySelector('#tera').hidden);
  check(await cancel.locator('#tera').count() === 1 && !await cancel.locator('#tera').isVisible(), 'Tera is hidden once the battle ends');
  check(await cancel.locator('.moves #replay, .moves #first-turn, .moves #prev-turn, .moves #next-turn, .moves #end-turn').count() === 5 && await cancel.locator('#upload-replay, #download-replay, #rematch, #main-menu').count() === 0 && await cancel.locator('#replay').innerText() === 'Replay battle', 'After the battle the move row holds Replay battle, First turn, Prev turn, Next turn and Last turn');
  check((await cancel.locator('#test-commands').innerText()).includes('|/savereplay'), 'The replay is saved automatically when the battle ends');
  await cancel.locator('#switch-2').focus(); await cancel.waitForTimeout(100);
  check(await cancel.locator('.move-preview, .moves #move-1').count() === 0 && await cancel.locator('.moves > button:not([hidden])').count() === 5, 'After the battle the cursor on a benched Pokémon previews nothing; only the replay row shows');
  await cancel.keyboard.press('h');
  check(await cancel.locator('#open-replay').isDisabled(), 'Open replay in the menu is disabled until the upload finishes');
  await cancel.keyboard.press('Escape');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '|popup|html <p>Your replay has been uploaded! It\'s available at:</p><p> <a href="https://replay.pokemonshowdown.com/gen9randombattle-2711033563">https://replay.pokemonshowdown.com/gen9randombattle-2711033563</a>'}));
  await cancel.waitForTimeout(100);
  check(await cancel.locator('.arena-top').isHidden() && !(await cancel.locator('#notice').innerText()).includes('replay'), 'The upload popup never shows as a banner');
  await cancel.keyboard.press('h');
  check(await cancel.locator('#open-replay').isEnabled(), 'Open replay enables once the server reports the upload');
  await cancel.keyboard.press('Escape');
  await cancel.locator('#first-turn').click();
  const earliestTurn = async () => cancel.evaluate(() => ({shown: document.querySelector('#arena .turn')?.innerText, first: document.querySelector('#hidden-log h2')?.textContent, play: !!document.querySelector('#arena .playbutton')}));
  check(await earliestTurn().then(t => !t.play && t.shown === t.first), `First turn shows the earliest turn, not the pre-battle Play overlay: ${JSON.stringify(await earliestTurn())}`);
  await cancel.locator('#prev-turn').click();
  check(await earliestTurn().then(t => !t.play && t.shown === t.first), 'Prev turn never goes before the first turn');
  await cancel.locator('#next-turn').click(); await cancel.locator('#end-turn').click();
  check(await cancel.locator('.moves #first-turn').count() === 1, 'Next turn and Last turn seek without error');
  await cancel.keyboard.press('s');
  const fieldBefore = await cancel.locator('#arena-wrap').boundingBox();
  await cancel.locator('#primary').click();
  await cancel.waitForFunction(() => !document.querySelector('#search-overlay').hidden);
  await cancel.waitForTimeout(400); // let the renderer's resize settle before measuring
  const fieldAfter = await cancel.locator('#arena-wrap').boundingBox();
  check(await cancel.locator('#search-overlay').isVisible() && fieldBefore.height === fieldAfter.height && fieldBefore.width === fieldAfter.width, 'Searching shows an overlay on the field without resizing it');
  await cancel.close();

  // Audio implementation is unchanged; keep its existing Chromium regression.
  if (engineName === 'chromium') {
  const audio = await browser.newPage();
  await audio.goto(base); await audio.waitForSelector('#switch-1');
  const loop = await audio.evaluate(async () => {
    const {Music, TRACK} = await import('/src/music.js');
    const rate = 8000, offline = new OfflineAudioContext(1, rate * 2, rate);
    const context = {state: 'running', currentTime: 0, destination: offline.destination,
      createGain: () => offline.createGain(), createBufferSource: () => offline.createBufferSource(), addEventListener() {}};
    const music = new Music(() => {}, {storage: null, createContext: () => context});
    music.buffer = offline.createBuffer(1, rate * 150, rate);
    const data = music.buffer.getChannelData(0); data.fill(0.25);
    data.fill(0.5, Math.round(TRACK.loopStart * rate), Math.round((TRACK.loopStart + 2) * rate));
    music.offset = TRACK.loopEnd - 0.5;
    music.update(true); music.unlock();
    const output = (await offline.startRendering()).getChannelData(0);
    return {before: output[rate / 4], after: output[rate], nonzero: output.every(v => v > 0)};
  });
  check(Math.abs(loop.before - 0.25 * 0.22) < 1e-6 && Math.abs(loop.after - 0.5 * 0.22) < 1e-6 && loop.nonzero,
    'Native Web Audio crosses the pinned loop boundary without silence or replaying the intro');
  const actualAudio = await audio.evaluate(async () => {
    const {TRACK} = await import('/src/music.js');
    const response = await fetch(TRACK.url, {mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    const context = new OfflineAudioContext(2, 1, 44100);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    return {duration: buffer.duration, usable: buffer.duration > TRACK.loopEnd};
  });
  check(actualAudio.usable, `Packaged official MP3 fetches from the app origin and decodes (${actualAudio.duration.toFixed(2)} seconds)`);
  // Live third-party call. pokemonshowdown.com throttles shared CI runner IPs now and then, so this
  // warns with the real HTTP status instead of failing the build; parseRating is covered by unit tests.
  const publicRating = await audio.evaluate(async () => {
    const url = 'https://pokemonshowdown.com/users/mepc36363636.json';
    const response = await fetch(url, {credentials: 'omit', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000)}).catch(error => ({ok: false, status: String(error)}));
    if (!response.ok) return {status: `HTTP ${response.status}`};
    const {PlayerRating} = await import('/src/rating.mjs');
    const rating = new PlayerRating('mepc36363636'); await rating.load();
    return {status: rating.status, value: rating.value};
  });
  if (['ready', 'unrated'].includes(publicRating.status)) check(true, 'Official public rating API works with browser CORS and no credentials');
  else console.warn(`WARN: public rating API unavailable from this runner (${publicRating.status}); not failing the build`);
  await audio.close();
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log(`All ${passed} ${engineName} browser checks passed.`);
} finally { await browser.close(); }
