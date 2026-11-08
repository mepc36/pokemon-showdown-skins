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
    check(await page.locator('#opponent-roster').isVisible() && !await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'opponent-3', 'Right stick flips to the opponent row and keeps the same slot focused');
    check((await page.locator('#opponent-3 strong').innerText()).replace(/\s+/g, ' ') === 'Rotom-Wash PAR', 'Status sits on the name line of the roster button');
    await page.keyboard.press('f');
    check(await page.locator('#roster').isVisible() && await page.evaluate(() => document.activeElement.id) === 'switch-3', 'F flips back to your row');
    check(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#switch-1 strong')).fontSize)) >= 14.5, 'Roster names are larger');
    check(await page.locator('#battle-timer').evaluate(el => getComputedStyle(el).color) !== 'rgb(17, 17, 17)', 'Timer is no longer black');
    check(await page.locator('.moves > #tera').count() === 1 && await page.locator('.command-heading, #prompt').count() === 0 && await page.locator('#tera').evaluate(el => el.getBoundingClientRect().right > document.querySelector('#move-4').getBoundingClientRect().right), 'Tera sits at the right end of the move row and the heading row is gone');
    check(await page.locator('#roster button[data-cue]:not([data-cue=""])').count() === 0, 'Own roster no longer carries speed cue borders');
    await page.waitForFunction(() => document.querySelector('#matchup-foe .matchup-names span:first-child')?.textContent === 'Landorus', null, {timeout: 20000});
    await pad(page, 12);
    const panelNames = async id => page.locator(`${id} .matchup-names > span`).allInnerTexts();
    check(JSON.stringify(await panelNames('#matchup-own')) === '["Grumpig","Landorus"]' && JSON.stringify(await panelNames('#matchup-foe')) === '["Landorus","Grumpig"]', 'Both panels name the attacker on the left and the defender on the right');
    check(await page.locator('.matchup-names span').evaluateAll(els => els.every(el => getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).overflow === 'hidden')), 'Panel names clip with an ellipsis');
    const cues = async id => page.locator(`${id} .stat-box`).evaluateAll(els => els.map(el => `${el.querySelector('small').textContent}:${el.dataset.stat}`));
    check(JSON.stringify(await cues('#matchup-own')) === '["Atk:","Def:","SpA:","SpD:low","Spe:"]', `Left panel marks their lower defense red and leaves your tied attack stats uncued: ${await cues('#matchup-own')}`);
    check(JSON.stringify(await cues('#matchup-foe')) === '["Atk:high","Def:","SpA:","SpD:","Spe:"]', `Right panel puts their attack stats left, marking the higher one green: ${await cues('#matchup-foe')}`);
    check(await page.evaluate(() => { const style = el => getComputedStyle(el); const high = document.querySelector('.stat-box[data-stat=high]'), low = document.querySelector('.stat-box[data-stat=low]'), plain = document.querySelector('.stat-box[data-stat=""]'); const key = el => style(el).borderTopColor + style(el).backgroundColor; return key(high) !== key(plain) && key(low) !== key(plain) && key(high) !== key(low); }), 'Cued stat boxes look different from plain ones and from each other');
    const pairs = await page.locator('#matchup-own .stat-pair small').allInnerTexts();
    check(JSON.stringify(pairs) === JSON.stringify(['Atk', 'Def', 'SpA', 'SpD', 'Spe']) && (await page.locator('#matchup-own .stat-pair strong').allInnerTexts()).slice(0, 2).join() === '150,~' + (Math.floor(Math.floor(2 * 90 + 31 + 21) * 76 / 100) + 5), 'Left panel pairs your Attack with their estimated Defense');
    check(await page.locator('#matchup-own .speed-badge').count() === 1 && await page.locator('#matchup-foe .speed-badge').count() === 1 && ((await page.locator('#matchup-own .speed-badge').innerText()).includes('1') !== (await page.locator('#matchup-foe .speed-badge').innerText()).includes('1') || (await page.locator('.speed-badge[data-first=true]').count()) === 2), 'Exactly one side moves first unless tied');
    await page.locator('#switch-2').focus();
    check((await panelNames('#matchup-own'))[0] === 'Palossand' && await page.locator('.move-preview').count() === 4 && !await page.locator('#move-1').isVisible() && (await page.locator('.move-preview strong').allInnerTexts()).includes('Earth Power'), 'Cursor on a bench Pokémon previews its moves and matchup');
    check(await page.locator('#tera').innerText() === 'Tera: Water', 'The Tera button follows the previewed Pokémon');
    check(await page.locator('.form-tag').count() === 0 && await page.evaluate(() => { const name = document.querySelector('#switch-1 .mon-name'); return name.scrollWidth <= name.clientWidth + 1; }), 'Roster names fit; no region tags on the demo team');
    await pad(page, 12);
    await page.locator('#switch-2').focus(); await pad(page, 13);
    check(/^preview-move-\d$/.test(await page.evaluate(() => document.activeElement.id)) && await page.locator('.move-preview').count() === 4, 'The cursor can move onto a previewed move without ending the preview');
    check(await page.locator('#preview-move-1').evaluate(el => getComputedStyle(el).opacity) === '1', 'Previewed moves are not grayed out');
    await pad(page, 1);
    check(await page.locator('.move-preview').count() === 4 && !(await page.locator('#notice').innerText()).includes('selected'), 'Pressing a previewed move selects nothing');
    await page.locator('#switch-2').focus();
    await pad(page, 12);
    check(await page.locator('.move-preview').count() === 0 && await page.locator('#move-1').isVisible() && await page.evaluate(() => document.activeElement.id === 'move-1'), 'Up from the bench returns to the active Pokémon\'s real moves');
    check(await page.locator('#tera').innerText() === 'Tera: Psychic', 'Leaving the preview restores the active Pokémon\'s Tera type');
    await page.locator('#switch-2').focus(); await pad(page, 0);
    check(await page.locator('.move-preview').count() === 0 && await page.evaluate(() => document.activeElement.id === 'switch-1'), 'B ends the preview and lands on the active Pokémon');
    check(await page.locator('.info-facts > div[data-cue]:not([data-cue=""])').count() === 0, 'No stale cue borders remain outside the panels');
    check(await height(page, '#switch-1') >= 60, 'Roster buttons are at least 60px tall');
    check(await height(page, '#switch-1 .team-hp') >= 8, 'Roster HP bars are at least 8px tall');
    check(await page.locator('#switch-4').getAttribute('data-fainted') === 'true' && (await page.locator('#switch-4').getAttribute('aria-label')).includes('Fainted') && await page.locator('#switch-4 .status-tag').count() === 0, 'Fainted Pokémon are styled and announced, with no tag or numbers');
    await page.screenshot({path: `test-results/${engineName}-battle-${viewport.width}-${viewport.height}.png`});
    check(!(await fit(page)).length, `Battle and header controls fit ${viewport.width}×${viewport.height}: ${await fit(page)}`);
    await page.locator('#switch-1').focus(); await pad(page, 8);
    check(await page.locator('dialog[open]').count() === 1 && await page.locator('#modal-title').innerText() === 'Menu' && await page.locator('#modal #primary, #modal #chat, #modal #rating, #modal #forfeit, #modal #setup, #modal #diagnostics, #modal #source').count() === 7, 'Select opens a menu modal with the secondary controls and Find Random Battle');
    check(await page.locator('#source').evaluate(el => el.tagName) === 'BUTTON' && await page.locator('a#source').count() === 0, 'Source is a button, not a hyperlink');
    await page.locator('#setup').focus(); await pad(page, 12);
    check(await page.evaluate(() => document.activeElement.id) === 'primary', 'Up from the second menu row lands on the button above, not the close button');
    await pad(page, 13);
    check(await page.evaluate(() => document.activeElement.id) === 'setup', 'Down returns to the second row');
    check(await page.locator('#modal #replay').count() === 0, 'Replay is not in the menu');
    check(!(await fit(page)).length, `Menu has no scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-menu-${viewport.width}-${viewport.height}.png`});
    await pad(page, 0);
    check(await page.locator('dialog[open]').count() === 0 && await page.evaluate(() => document.activeElement.id) === 'switch-1', 'B closes the menu and returns to the battle choices');
    await pad(page, 10); await page.keyboard.press('t');
    check(await page.locator('dialog[open]').count() === 0, 'L3 and T do nothing now');
    const fieldBefore = await page.locator('#arena').evaluate(el => el.getBoundingClientRect().width);
    await page.keyboard.press('h'); await page.locator('#chat').click();
    check(await page.locator('dialog[open]').count() === 0, 'Chat from the menu closes the menu');
    await page.keyboard.press('h');
    check(await page.locator('#chat-drawer').isVisible() && await page.locator('#chat').getAttribute('aria-pressed') === 'true' && await page.locator('#arena').evaluate(el => el.getBoundingClientRect().width) === fieldBefore, 'Chat button opens the drawer over the field without resizing it');
    await page.keyboard.press('Escape');
    check(await page.locator('#chat-drawer').evaluate(el => { const r = el.getBoundingClientRect(), w = el.parentElement.getBoundingClientRect(); return Math.abs(r.right - w.right) < 2 && r.width < w.width / 2; }), 'Chat drawer sits on the right side');
    await page.keyboard.press('c');
    await page.keyboard.press('h');
    check(!await page.locator('#chat-drawer').isVisible() && await page.locator('#chat').getAttribute('aria-pressed') === 'false', 'C closes the chat drawer');
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
    check((await page.locator('#modal-title').innerText()).includes('Grumpig') && await page.locator('.role-layout').count() === 0, 'Down on an own Pokémon has no pages to reveal');
    await pad(page, 15);
    check((await page.locator('#modal-title').innerText()).includes('Palossand'), 'D-pad right moves to the next Pokémon, matching the roster');
    await stick(page, -1);
    check((await page.locator('#modal-title').innerText()).includes('Corviknight') && await page.locator('#info-tab-0').count() === 1, 'Right stick inside R3 jumps to the other team, same slot number');
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
    await pad(page, 12); await page.locator('#move-2').focus(); await pad(page, 11);
    check(await page.locator('#modal-title').innerText() === 'Shadow Ball' && (await page.locator('#info-content').innerText()).includes('20%'), 'R3 on a main move opens its detailed effects');
    check(!(await fit(page)).length, `Move details fit: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-move-${viewport.width}-${viewport.height}.png`});
    await pad(page, 0);
    check(await page.evaluate(() => document.activeElement.id) === 'move-2', 'Move details close directly to the battle move');
    await page.keyboard.press('f'); await page.locator('#opponent-1').focus(); await pad(page, 11);
    check((await page.locator('#modal-title').innerText()) === 'Landorus · Lv 76' && (await page.locator('.overview-layout > .info-facts').innerText()).includes('Sheer Force') && (await page.locator('.identity-hp').innerText()).includes('31%'), 'Opponent identity shows level, revealed ability and last shown HP');
    await page.waitForSelector('#info-tab-1'); await pad(page, 13);
    check(await page.locator('.role-layout').count() === 1, 'D-pad down opens the opponent possible-role page');
    const roleTitle = await page.locator('[aria-selected=true]').innerText();
    await page.locator('.compact-move').first().click(); await pad(page, 11);
    check(await page.locator('[aria-selected=true]').innerText() === roleTitle, 'R3 on a role move never opens another menu');
    check(await page.locator('#info-content .move-description, #info-content .move-metrics, #info-content .move-summary, #info-content .info-facts').count() === 0, 'Role move lists omit power and descriptions');
    check(!(await fit(page)).length, `Role fits without scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/${engineName}-possible-role-${viewport.width}-${viewport.height}.png`});
    await pad(page, 15); await pad(page, 15);
    check((await page.locator('.overview-layout > .info-facts').innerText()).includes('Possible abilities') && (await page.locator('.identity-speed').innerText()).includes('estimated') && await page.locator('[aria-selected=true]').innerText() === 'Overview', 'Right moves to the next opponent and resets to Overview; unrevealed ability and Speed are labelled as estimates');
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
  await pools.waitForSelector('#info-tab-1'); await pools.keyboard.press('ArrowDown');
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
  await failed.waitForSelector('.role-layout');
  check(await failed.locator('.role-layout').count() === 1, 'Retry restores a possible-role page at the same depth');
  await failed.close();

  const renderer = await browser.newPage();
  await renderer.goto(`${base}/test/renderer.html`);
  await renderer.waitForFunction(() => typeof document.querySelector('#run').onclick === 'function');
  await renderer.locator('#run').click();
  await renderer.waitForFunction(() => document.querySelector('#results').textContent.includes('All checks passed') || document.querySelector('#results').textContent.includes('FAIL'));
  const rendererResult = await renderer.locator('#results').innerText();
  check(!rendererResult.includes('FAIL'), rendererResult); await renderer.close();

  const cancel = await browser.newPage(); await gamepad(cancel);
  await cancel.goto(`${base}/test/cancel.html`); await cancel.waitForSelector('#switch-1');
  await cancel.keyboard.press('h'); await cancel.locator('#primary').click();
  await cancel.waitForFunction(() => document.querySelector('#arena-wrap').dataset.room.includes('12345'));
  await cancel.waitForFunction(() => document.querySelector('#test-commands').textContent.includes('/timer on'));
  check((await cancel.locator('#test-commands').innerText()).match(/\/timer on/g).length === 1 && await cancel.locator('#timer-toggle').count() === 0, 'The timer starts itself once when the battle starts');
  check(await cancel.locator('dialog[open]').count() === 0, 'Find Random Battle closes the menu');
  await cancel.locator('#switch-2').focus(); await cancel.keyboard.press('i'); await cancel.keyboard.press('ArrowRight'); await cancel.keyboard.press('ArrowDown'); await cancel.keyboard.press('Escape');
  check(!(await cancel.locator('#test-commands').innerText()).includes('/choose'), 'Flat information navigation never sends a battle choice');
  await cancel.keyboard.press('ArrowUp'); await cancel.locator('#move-1').click();
  check((await cancel.locator('#test-commands').innerText()).includes('/choose move 1|1'), 'Battle choices still submit immediately');
  await cancel.keyboard.press('ArrowLeft'); await cancel.locator('#move-2').click();
  check(await cancel.locator('#move-2').evaluate(el => !el.disabled && el.dataset.locked === 'true' && document.activeElement === el) && !(await cancel.locator('#test-commands').innerText()).includes('/choose move 2'), 'Moves stay focusable for review while a choice is pending but cannot be chosen');
  await cancel.keyboard.press('Escape');
  check((await cancel.locator('#test-commands').innerText()).includes('/undo |1'), 'Existing B / Escape still invokes Showdown undo');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|inactive|mepc36363636 has 30 seconds left.'}));
  check((await cancel.locator('#timer-warning').innerText()).includes('30s'), 'Server countdown warning appears in the prominent timer');
  await cancel.screenshot({path: `test-results/${engineName}-timer-warning.png`});
  await cancel.setViewportSize({width: 1024, height: 540});
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|switch|p2a: Raichu|Raichu, L88, M|100/100\n|turn|17'}));
  await cancel.waitForFunction(() => document.querySelector('#opponent-4')?.textContent.includes('Raichu'));
  await cancel.keyboard.press('f'); await cancel.locator('#opponent-4').focus(); await cancel.keyboard.press('i');
  check(await cancel.locator('[data-info-tab]').count() > 2 && !(await cancel.locator('.identity-types').innerText()).includes('Role identified'), 'Ambiguous opponent keeps all matching roles');
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Tera Blast|p1a: Grumpig\n|turn|18'}));
  await cancel.waitForSelector('.identity-types small[data-identified=true]');
  const inferredTera = cancel.locator('.info-facts > div').filter({has: cancel.getByText('Tera · inferred', {exact: true})});
  check(await inferredTera.locator('dd').innerText() === 'Ice' && await inferredTera.getAttribute('data-cue') === 'green', 'A unique live move infers the fixed Tera and marks it green');
  check(await cancel.locator('[data-info-tab]').count() === 2 && (await cancel.locator('.inspection-note').innerText()).includes('Tera Blast user'), 'Live inference removes incompatible sibling pages');
  check(await cancel.locator('#opponent-4').getAttribute('data-cue') === 'green', 'Identified opponent gets a green roster border');
  check(!(await fit(cancel)).length, `Inferred overview fits the smallest viewport: ${await fit(cancel)}`);
  await cancel.screenshot({path: `test-results/${engineName}-inferred-set.png`});
  await cancel.evaluate(() => window.testSocket.onmessage({data: '>battle-gen9randombattle-12345\n|move|p2a: Raichu|Spore|p1a: Grumpig\n|turn|19'}));
  await cancel.waitForFunction(() => document.querySelector('.inspection-note').textContent.includes('do not match'));
  check(await cancel.locator('#opponent-4').getAttribute('data-cue') === '' && await cancel.getByText('Tera · inferred', {exact: true}).count() === 0, 'Contradictory reveals clear inferred certainty and restore the full list');
  await cancel.keyboard.press('Escape'); await cancel.keyboard.press('f');

  // The server request already knows the turn's result; the roster must wait for the hit to land.
  const barWidth = async id => cancel.locator(`${id} .team-hp > span`).evaluate(el => parseFloat(el.style.width));
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
  const names = id => cancel.locator(`${id} strong`).evaluateAll(els => els.map(el => el.firstChild.textContent));
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
  await cancel.locator('#chat-drawer').evaluate(el => { el.hidden = false; el.innerHTML = '<div style="height:3000px"></div>'; el.scrollTop = 0; });
  await stick(cancel, 1, 3);
  check(await cancel.locator('#chat-drawer').evaluate(el => el.scrollTop) > 0, 'Right stick down scrolls the chat drawer');
  await stick(cancel, -1, 3);
  await cancel.keyboard.press('c');
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
  check(await cancel.locator('.moves #replay, .moves #first-turn, .moves #prev-turn, .moves #next-turn, .moves #end-turn, .moves #upload-replay').count() === 6 && await cancel.locator('#download-replay, #rematch, #main-menu').count() === 0, 'After the battle the move row holds Replay, First turn, Prev turn, Next turn, End and Upload replay');
  await cancel.locator('#upload-replay').click();
  check((await cancel.locator('#test-commands').innerText()).includes('|/savereplay'), 'Upload replay sends /savereplay to the room');
  await cancel.locator('#first-turn').click(); await cancel.locator('#prev-turn').click(); await cancel.locator('#next-turn').click(); await cancel.locator('#end-turn').click();
  check(await cancel.locator('.moves #first-turn').count() === 1, 'First turn and Prev turn seek without error');
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
  const publicRating = await audio.evaluate(async () => {
    const {PlayerRating} = await import('/src/rating.mjs');
    const rating = new PlayerRating('mepc36363636'); await rating.load();
    return {status: rating.status, value: rating.value};
  });
  check(['ready', 'unrated'].includes(publicRating.status), 'Official public rating API works with browser CORS and no credentials');
  await audio.close();
  }
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log(`All ${passed} ${engineName} browser checks passed.`);
} finally { await browser.close(); }
