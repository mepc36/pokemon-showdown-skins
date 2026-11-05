// Run against the Vite dev server. All battle traffic is simulated.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({headless: true,
  ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
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
async function pad(page, index) {
  await page.evaluate(i => window.testPad.buttons[i].pressed = true, index);
  await page.waitForTimeout(55);
  await page.evaluate(i => window.testPad.buttons[i].pressed = false, index);
  await page.waitForTimeout(55);
}
async function gamepad(page) {
  await page.addInitScript(() => {
    window.testPad = {id: 'Controller fixture', mapping: 'standard', axes: [0, 0], buttons: Array.from({length: 16}, () => ({pressed: false, value: 0}))};
    navigator.getGamepads = () => [window.testPad];
  });
}
try {
  for (const viewport of [{width: 1024, height: 650}, {width: 1180, height: 700}, {width: 1024, height: 540}]) {
    const page = await browser.newPage({viewport}); await gamepad(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.waitForSelector('#switch-1');
    check(await page.locator('#all-moves, #info, #move-details').count() === 0, 'Duplicate menus and separate Move info button are removed');
    await page.locator('#toggle-tools').click();
    check(!(await fit(page)).length, `Battle and expanded controls fit ${viewport.width}×${viewport.height}: ${await fit(page)}`);
    await page.locator('#switch-1').focus(); await pad(page, 11);
    await page.waitForFunction(() => document.querySelectorAll('[data-info-tab]').length > 1);
    check((await page.locator('#modal-title').innerText()).includes('Grumpig ♀ · Lv 92'), 'R3 shows name, gender and level');
    check((await page.locator('.inspection-banner').innerText()).includes('Thick Fat') && await page.locator('.identity-types .type-badge').innerText() === 'Psychic', 'Ability and types are prominent');
    for (const label of ['Attack', 'Defense', 'Sp. Atk', 'Sp. Def']) {
      check(await page.locator('.info-facts > div').filter({has: page.getByText(label, {exact: true})}).locator('dd').innerText() === '150', `Exact private ${label} remains available`);
    }
    check(await page.locator('.compact-move').count() === 4 && await page.locator('.compact-move button').count() === 0, 'Four compact moves cannot open a nested menu');
    check(!(await fit(page)).length, `Overview fits without scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/overview-${viewport.width}-${viewport.height}.png`});
    await pad(page, 15);
    check(await page.locator('.role-layout').count() === 1, 'D-pad right opens a sibling possible-role page');
    const roleTitle = await page.locator('[aria-selected=true]').innerText();
    await page.locator('.compact-move').first().click(); await pad(page, 11);
    check(await page.locator('[aria-selected=true]').innerText() === roleTitle, 'R3 on a role move never opens another menu');
    check(await page.locator('#info-content .move-description, #info-content .move-metrics, #info-content .move-summary, #info-content .info-facts').count() === 0, 'Role move lists omit power and descriptions');
    check(!(await fit(page)).length, `Role fits without scrolling: ${await fit(page)}`);
    await page.screenshot({path: `test-results/possible-role-${viewport.width}-${viewport.height}.png`});
    await pad(page, 13);
    check((await page.locator('#modal-title').innerText()).includes('Palossand') && await page.locator('[aria-selected=true]').innerText() === 'Overview', 'D-pad down changes Pokémon and resets to Overview');
    await pad(page, 12); await pad(page, 12);
    check((await page.locator('#modal-title').innerText()).includes('Iron Hands') && (await page.locator('#info-content').innerText()).includes('0 fnt'), 'D-pad up wraps to the sixth, fainted Pokémon');
    await pad(page, 0);
    check(!await page.locator('#modal').isVisible() && await page.evaluate(() => document.activeElement.id) === 'switch-1', 'One B closes the whole panel and restores the original roster focus');
    await page.locator('#move-2').focus(); await pad(page, 11);
    check(await page.locator('#modal-title').innerText() === 'Shadow Ball' && (await page.locator('#info-content').innerText()).includes('20%'), 'R3 on a main move opens its detailed effects');
    check(!(await fit(page)).length, `Move details fit: ${await fit(page)}`);
    await page.screenshot({path: `test-results/move-${viewport.width}-${viewport.height}.png`});
    await pad(page, 0);
    check(await page.evaluate(() => document.activeElement.id) === 'move-2', 'Move details close directly to the battle move');
    await page.locator('#view-opponent').click(); await page.locator('#opponent-1').focus(); await pad(page, 11);
    check((await page.locator('#modal-title').innerText()).includes('Landorus ♂') && (await page.locator('.identity-ability').innerText()).includes('Sheer Force'), 'Opponent identity preserves public gender and revealed ability');
    await pad(page, 13); await pad(page, 13);
    check((await page.locator('.identity-ability').innerText()).includes('Possible abilities') && (await page.locator('.identity-speed').innerText()).includes('estimated'), 'Unrevealed ability and Speed are labelled as possibilities/estimates');
    await pad(page, 13);
    check(await page.locator('[data-info-tab]').count() === 1 && await page.locator('.type-badge, .compact-move').count() === 0, 'Unknown slots expose neither a guessed identity nor possible sets');
    await pad(page, 0);
    for (const id of ['display', 'setup', 'diagnostics']) {
      await page.locator(`#${id}`).click();
      check(!(await fit(page)).length, `${id} has no scrolling: ${await fit(page)}`);
      await page.locator('#modal-close').click();
    }
    await page.route('**/users/mepc36363636.json', route => route.fulfill({json: {userid: 'mepc36363636', ratings: {gen9randombattle: {elo: 1375.16, gxe: 54.5, w: 228, l: 244}}}}));
    await page.locator('#rating').click(); await page.waitForFunction(() => document.querySelector('#modal-body').textContent.includes('1375'));
    check(!(await fit(page)).length, `Rating fits: ${await fit(page)}`); await pad(page, 0);
    check(errors.length === 0, `No runtime errors: ${errors.join(', ')}`);
    await page.close();
  }

  // Render every real candidate role at the smallest supported landscape size.
  const pools = await browser.newPage({viewport: {width: 1024, height: 540}});
  await pools.goto(base); await pools.waitForSelector('#switch-1');
  await pools.locator('#switch-1').focus(); await pools.keyboard.press('i');
  await pools.waitForSelector('#info-tab-1'); await pools.keyboard.press('ArrowRight');
  const coverage = await pools.evaluate(async () => {
    const {rolePages} = await import('/src/info-components.mjs');
    const snapshot = await fetch('/data/gen9randombattle.json').then(r => r.json());
    const failures = []; let count = 0;
    for (const [name, pokemon] of Object.entries(snapshot.pokemon)) for (const page of rolePages({snapshot}, name, pokemon.level)) {
      const el = document.querySelector('#info-content'); el.innerHTML = page.content;
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) failures.push(`${name}/${page.label}: ${el.scrollHeight}/${el.clientHeight}`);
      count++;
    }
    return {count, failures};
  });
  check(!coverage.failures.length, `All ${coverage.count} candidate role pages fit without clipping: ${coverage.failures.slice(0, 10)}`);
  await pools.evaluate(async () => {
    const {rolePages} = await import('/src/info-components.mjs'); const snapshot = await fetch('/data/gen9randombattle.json').then(r => r.json());
    document.querySelector('#info-content').innerHTML = rolePages({snapshot}, 'Raichu', snapshot.pokemon.Raichu.level)[0].content;
  });
  await pools.screenshot({path: 'test-results/largest-pool.png'});
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
  await failed.keyboard.press('ArrowRight'); await failed.waitForSelector('#retry-sets');
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

  const cancel = await browser.newPage();
  await cancel.goto(`${base}/test/cancel.html`); await cancel.waitForSelector('#switch-1');
  await cancel.locator('#primary').click();
  await cancel.waitForFunction(() => document.querySelector('#mode').title.includes('12345'));
  await cancel.locator('#switch-2').focus(); await cancel.keyboard.press('i'); await cancel.keyboard.press('ArrowRight'); await cancel.keyboard.press('ArrowDown'); await cancel.keyboard.press('Escape');
  check(!(await cancel.locator('#test-commands').innerText()).includes('/choose'), 'Flat information navigation never sends a battle choice');
  await cancel.locator('#move-1').click();
  check((await cancel.locator('#test-commands').innerText()).includes('/choose move 1|1'), 'Battle choices still submit immediately');
  await cancel.keyboard.press('Escape');
  check((await cancel.locator('#test-commands').innerText()).includes('/undo |1'), 'Existing B / Escape still invokes Showdown undo');
  await cancel.close();

  const audio = await browser.newPage();
  await audio.goto(base); await audio.waitForSelector('#all-moves');
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
  assert.equal(failures.length, 0, failures.join('\n'));
  console.log(`All ${passed} browser checks passed.`);
} finally { await browser.close(); }
