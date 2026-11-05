// Run against the local Vite server: npm run dev -- --host 127.0.0.1
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({headless: true,
  ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
await mkdir('test-results', {recursive: true});
let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); console.log(`PASS: ${message}`); passed++; };
try {
  for (const viewport of [{width: 1024, height: 650}, {width: 390, height: 720}]) {
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // These checks never connect to a live battle or send credentials.
    await page.goto(base);
    await page.waitForSelector('#switch-1');
    await page.locator('#switch-1').focus(); await page.keyboard.press('i');
    await page.waitForSelector('.set-role');
    check(await page.locator('#modal-title').innerText() === 'Grumpig', 'R3 / I opens Pokémon details');
    for (const label of ['Attack', 'Defense', 'Sp. Atk', 'Sp. Def']) {
      check(await page.locator('.info-facts > div').filter({has: page.getByText(label, {exact: true})}).locator('dd').innerText() === '150', `Exact private ${label} appears`);
    }
    check(await page.locator('#inspect-move-1').innerText().then(t => t.includes('32 / 32')), 'Your known active moves show current PP');
    check((await page.locator('.possible-sets').innerText()).includes('Snapshot'), 'Possible sets has source and freshness');
    check((await page.locator('.set-role').first().innerText()).includes('Tera types'), 'Role cards include abilities, items and Tera types');
    await page.screenshot({path: `test-results/pokemon-${viewport.width}.png`});
    const candidate = page.locator('[data-origin="possible"][data-info-move]').first();
    await candidate.focus();
    await candidate.scrollIntoViewIfNeeded();
    await page.screenshot({path: `test-results/possible-sets-${viewport.width}.png`});
    const focusId = await candidate.getAttribute('id');
    await page.keyboard.press('i');
    check((await page.locator('#modal-body').innerText()).includes('not confirmed'), 'R3 opens candidate reference without claiming a reveal');
    check((await page.locator('#modal-body').innerText()).includes('base PP'), 'Possible move details never borrow private PP');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.activeElement.id) === focusId, 'B returns to original move card');
    check(await page.evaluate(() => {
      const rect = document.activeElement.getBoundingClientRect(), dialog = document.querySelector('dialog').getBoundingClientRect();
      return rect.top >= dialog.top && rect.bottom <= dialog.bottom;
    }), 'Back restores scroll position');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.activeElement.id) === 'switch-1', 'Closing returns to the roster');
    await page.locator('#all-moves').click();
    check(await page.locator('.move-pool').count() === 6, 'All six own slots remain browsable, including fainted Pokémon');
    check(await page.locator('[data-info-move]').count() === 24, 'All known own moves appear');
    await page.locator('#moves-opponent').click();
    check(await page.locator('.move-pool').count() === 6, 'All six opponent slots remain inspectable');
    check(await page.locator('[data-info-move]').count() === 2, 'Opponent view includes only the two publicly revealed moves');
    await page.locator('#moves-possible').click();
    check(await page.locator('[data-info-move]').count() > 2, 'Separate possible view contains the larger candidate pool');
    check(await page.locator('.move-pool').nth(3).locator('[data-info-move]').count() === 0, 'Unrevealed slots never receive a candidate pool');
    await page.screenshot({path: `test-results/all-moves-${viewport.width}.png`});
    const lastMove = page.locator('[data-info-move]').last();
    await lastMove.focus(); await page.keyboard.press('ArrowRight');
    check(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), 'Directional focus stays inside the information dialog');
    check(await page.evaluate(() => {
      const d = document.querySelector('dialog'); return d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth;
    }), 'Phone/tablet dialog has no horizontal overflow');
    await page.keyboard.press('Escape');
    await page.locator('#view-opponent').click(); await page.locator('#opponent-4').click();
    check(await page.locator('.possible-sets').count() === 0, 'Unknown Pokémon exposes no possible sets');
    await page.keyboard.press('Escape');
    await page.route('**/users/mepc36363636.json', route => route.fulfill({json: {userid: 'mepc36363636', ratings: {gen9randombattle: {elo: 1375.16, gxe: 54.5, w: 228, l: 244}}}}));
    await page.locator('#toggle-tools').click(); await page.locator('#rating').click();
    await page.waitForFunction(() => document.querySelector('#modal-body').textContent.includes('1375'));
    check(await page.locator('#modal-title').innerText() === 'Your rating', 'Public rating is reachable from More controls');
    await page.screenshot({path: `test-results/rating-${viewport.width}.png`});
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => document.activeElement.id) === 'rating', 'Rating closes back to its controller focus');
    check(errors.length === 0, `No runtime errors: ${errors.join(', ')}`);
    await page.close();
  }

  const delayed = await browser.newPage();
  let release;
  const gate = new Promise(resolve => release = resolve);
  await delayed.route('**/users/mepc36363636.json', async route => { await gate; await route.fulfill({status: 503, body: 'Unavailable'}); });
  await delayed.goto(base); await delayed.waitForSelector('#toggle-tools');
  await delayed.locator('#toggle-tools').click(); await delayed.locator('#rating').click();
  await delayed.keyboard.press('Escape');
  const delayedResponse = delayed.waitForResponse(response => response.url().includes('/users/mepc36363636.json'));
  release(); await delayedResponse;
  check(!await delayed.locator('#modal').isVisible(), 'A late rating response cannot reopen a closed dialog');
  await delayed.locator('#rating').click();
  await delayed.waitForFunction(() => document.querySelector('#modal-body').textContent.includes('Could not load'));
  check(await delayed.locator('#refresh-rating').isEnabled(), 'Rating failure exposes a retry without breaking controls');
  await delayed.close();

  // Data failures must not disable the existing information or battle controls.
  const failed = await browser.newPage();
  await failed.route('**/data/gen9randombattle.json', route => route.fulfill({status: 503, body: 'unavailable'}));
  await failed.goto(base); await failed.waitForSelector('#all-moves');
  await failed.locator('#all-moves').click(); await failed.locator('#moves-possible').click();
  await failed.waitForSelector('#retry-sets');
  check((await failed.locator('#modal-body').innerText()).includes('Known and revealed moves still work'), 'Fetch failure is explicit and recoverable');
  await failed.locator('#moves-known').click();
  check(await failed.locator('[data-info-move]').count() === 24, 'Known move cards survive a dataset failure');
  await failed.unroute('**/data/gen9randombattle.json');
  await failed.locator('#moves-possible').click(); await failed.locator('#retry-sets').click();
  await failed.waitForSelector('.set-source');
  check(await failed.locator('[data-info-move]').count() > 24, 'Retry restores candidate pools');
  await failed.close();

  const renderer = await browser.newPage();
  await renderer.goto(`${base}/test/renderer.html`);
  await renderer.waitForFunction(() => typeof document.querySelector('#run').onclick === 'function');
  await renderer.locator('#run').click();
  await renderer.waitForFunction(() => document.querySelector('#results').textContent.includes('All checks passed') || document.querySelector('#results').textContent.includes('FAIL'));
  const rendererResult = await renderer.locator('#results').innerText();
  check(!rendererResult.includes('FAIL'), rendererResult);
  await renderer.close();

  const cancel = await browser.newPage();
  await cancel.goto(`${base}/test/cancel.html`); await cancel.waitForSelector('#switch-1');
  await cancel.locator('#primary').click();
  await cancel.waitForFunction(() => document.querySelector('#mode').textContent.includes('12345'));
  await cancel.locator('#all-moves').click(); await cancel.locator('#pool-1-1').click();
  await cancel.keyboard.press('Escape'); await cancel.keyboard.press('Escape');
  check(!(await cancel.locator('#test-commands').innerText()).includes('/choose'), 'Information browsing never submits a move');
  await cancel.locator('#move-1').click();
  check((await cancel.locator('#test-commands').innerText()).includes('/choose move 1|1'), 'Battle choices still submit immediately');
  await cancel.keyboard.press('Escape');
  check((await cancel.locator('#test-commands').innerText()).includes('/undo |1'), 'Existing B / Escape action still invokes Showdown undo');
  await cancel.close();

  // Exercise native Web Audio loop scheduling, not just mocked source properties.
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
  console.log(`All ${passed} browser checks passed.`);
} finally { await browser.close(); }
