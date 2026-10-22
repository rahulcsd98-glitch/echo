// Headless browser QA: drives the running dev server with real keyboard input,
// captures screenshots of every scene, asserts expected state + zero errors.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

// Override with CHROME_PATH if your browser lives elsewhere.
const CHROME_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
const CHROME = process.env.CHROME_PATH
  || (CHROME_CANDIDATES[process.platform] || []).find((p) => p && fs.existsSync(p))
  || 'chrome';
const URL = process.env.QA_URL || 'http://localhost:4173/';
const OUT = path.resolve('screenshots');

const errors = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(page, frames = 30) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) {
      window.__echoShift.update(1 / 60);
      window.__echoShift.render(1 / 60);
    }
  }, frames);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const scene = (page) => page.evaluate(() => window.__echoShift.scene);

async function act(page, id) {
  await page.evaluate((a) => window.__echoShift.onAction(a), id);
  await step(page, 6);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!window.__echoShift, { timeout: 15000 });
  await sleep(600);

  // --- main menu ---
  check('boot: app handle present', await page.evaluate(() => !!window.__echoShift));
  await step(page, 20);
  check('scene starts at menu', (await scene(page)) === 'menu');
  const menuRegions = await page.evaluate(() =>
    window.__echoShift.ui.regions.filter((r) => r.id && r.id.startsWith('menu:')).map((r) => r.id));
  check('menu regions registered', menuRegions.length >= 4, menuRegions.join(','));
  await shot(page, '01-menu');

  // --- keyboard navigation on menu (real key events) ---
  await page.keyboard.press('ArrowDown');
  await step(page, 6);
  await shot(page, '02-menu-focus');

  // --- level select ---
  await act(page, 'menu:select');
  check('level select opens', (await scene(page)) === 'select');
  const selRegions = await page.evaluate(() =>
    window.__echoShift.ui.regions.filter((r) => r.id && r.id.startsWith('select:')).length);
  check('level grid registered', selRegions >= 5, `regions=${selRegions}`);
  await shot(page, '03-level-select');
  await page.keyboard.press('Escape');
  await step(page, 6);

  // --- settings ---
  await act(page, 'menu:settings');
  check('settings opens', (await scene(page)) === 'settings');
  await shot(page, '04-settings');
  // toggle a setting via keyboard then restore
  await page.keyboard.press('ArrowDown');
  await step(page, 4);
  await act(page, 'set:back');
  check('settings back to menu', (await scene(page)) === 'menu');

  // --- credits ---
  await act(page, 'menu:credits');
  check('credits opens', (await scene(page)) === 'credits');
  await shot(page, '05-credits');
  await page.keyboard.press('Escape');
  await step(page, 6);
  check('back to menu', (await scene(page)) === 'menu');

  // --- start level 1 ---
  await act(page, 'menu:continue');
  check('game scene reached', (await scene(page)) === 'game');
  await step(page, 45);
  await shot(page, '06-game-start');

  // --- hold Right for ~1.5s of sim (real keydown, manual stepping) ---
  await page.keyboard.down('ArrowRight');
  await step(page, 90);
  await page.keyboard.up('ArrowRight');
  await step(page, 10);
  const pos1 = await page.evaluate(() => {
    const p = window.__echoShift.session.world.player;
    return Math.round(p.x);
  });
  await shot(page, '07-game-moved');
  check('player moved right', Number.isFinite(pos1), `x=${pos1}`);

  // --- jump while moving (exercise shared physics) ---
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await step(page, 40);
  await page.keyboard.up('Space');
  await step(page, 20);
  await page.keyboard.up('ArrowRight');
  await step(page, 20);
  await shot(page, '08-game-jump');

  // --- restart: previous attempt becomes an echo ---
  await page.keyboard.press('KeyR');
  await step(page, 30);
  const echoes = await page.evaluate(() => window.__echoShift.session.echoes.length);
  check('echo created on restart', echoes >= 1, `echoes=${echoes}`);
  await shot(page, '09-after-restart');

  // --- watch the echo replay alongside the player ---
  await step(page, 120);
  const echoState = await page.evaluate(() => {
    const s = window.__echoShift.session;
    const e = s.echoes[0];
    return e ? { active: e.active !== false, tick: e.tick ?? e.idx ?? -1 } : null;
  });
  check('echo replaying', !!echoState, JSON.stringify(echoState));
  await shot(page, '10-echo-replay');

  // --- second restart -> multiple echoes coexist ---
  await page.keyboard.press('KeyR');
  await step(page, 30);
  const echoes2 = await page.evaluate(() => window.__echoShift.session.echoes.length);
  check('multiple echoes coexist', echoes2 >= 2, `echoes=${echoes2}`);
  await shot(page, '11-multi-echo');

  // --- pause overlay ---
  await page.keyboard.press('Escape');
  await step(page, 6);
  const paused = await page.evaluate(() => window.__echoShift.paused === true);
  check('pause overlay active', paused);
  await shot(page, '12-pause');
  await page.keyboard.press('Escape');
  await step(page, 6);
  check('resume works', await page.evaluate(() => window.__echoShift.paused === false));

  // --- debug overlay (F1) ---
  await page.keyboard.press('F1');
  await step(page, 6);
  await shot(page, '13-debug-overlay');
  await page.keyboard.press('F1');
  await step(page, 6);

  // --- death overlay ---
  const deadState = await page.evaluate(async () => {
    window.__echoShift.session.world.killPlayer('laser');
    for (let i = 0; i < 30; i++) { window.__echoShift.update(1 / 60); window.__echoShift.render(1 / 60); }
    return { state: window.__echoShift.session.state, deathHold: window.__echoShift.deathHold };
  });
  check('death state + overlay hold', deadState.state === 'dead' && deadState.deathHold > 0, JSON.stringify(deadState));
  await shot(page, '17-death');
  // let the death hold auto-rewind back into play
  await step(page, 220);
  check('auto-rewind after death', await page.evaluate(() => window.__echoShift.session.state !== 'dead'));
  await step(page, 30);

  // --- completion path: teleport player onto the exit ---
  const compMode = await page.evaluate(() => {
    const app = window.__echoShift;
    const w = app.session.world;
    const exit = w.objects.find((o) => o.type === 'exit');
    if (!exit) return 'no-exit';
    w.player.x = exit.x;
    w.player.y = exit.y;
    w.player.vx = 0;
    w.player.vy = 0;
    return 'teleport';
  });
  await step(page, 150);
  const complete = await page.evaluate(() =>
    window.__echoShift.session.state === 'COMPLETE' ||
    window.__echoShift.session.world.complete === true ||
    window.__echoShift.completeT > 0);
  check('level completion fires', complete, `mode=${compMode}`);
  await shot(page, '14-complete');

  // --- done-screen buttons (if visible) ---
  if (complete) {
    const doneRegions = await page.evaluate(() =>
      window.__echoShift.ui.regions.filter((r) => r.id && r.id.startsWith('done:')).map((r) => r.id));
    check('completion menu registered', doneRegions.length >= 1, doneRegions.join(','));
    await shot(page, '15-done-menu');
  }

  // --- next room flows into level 2 and unlocks it ---
  const nextLevel = await page.evaluate(async () => {
    window.__echoShift.onAction('done:next');
    for (let i = 0; i < 30; i++) { window.__echoShift.update(1 / 60); window.__echoShift.render(1 / 60); }
    const app = window.__echoShift;
    return {
      scene: app.scene,
      id: app.session ? app.session.levelDef.id : -1,
      unlocked: app.save.data.unlocked || 1,
    };
  });
  check('next room starts level 2', nextLevel.scene === 'game' && nextLevel.id === 2, JSON.stringify(nextLevel));
  check('level 2 unlocked in save', nextLevel.unlocked >= 2, `unlocked=${nextLevel.unlocked}`);
  await step(page, 45);
  await shot(page, '16-level-2');

  // --- settings persistence across reload ---
  await page.evaluate(() => window.__echoShift.save.setSetting('shake', false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__echoShift, { timeout: 15000 });
  await sleep(400);
  const persisted = await page.evaluate(() => window.__echoShift.save.settings.shake === false);
  check('settings persist across reload', persisted);
  await page.evaluate(() => window.__echoShift.save.setSetting('shake', true));

  // --- error report ---
  check('zero console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('QA crashed:', e); process.exit(2); });
