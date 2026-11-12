// Browser tests: the game in a real browser (Chromium, through Playwright), served from a sub-folder the way GitHub
// Pages serves it. These check what the page does, not how its source is written: the tab, the credits and their
// links, the support line, menus that stop redrawing the board, the board's pixel budget and how it adapts to a slow
// browser, the battle clock, the drawing calls Safari is slow at, and a campaign played to its end.
//
// Usage: node tests/browser.test.js [--require] [--only <part of a test's name>]
//   Needs Playwright with Chromium:  npm i -D playwright && npx playwright install chromium
//   Without it the tests are skipped (exit 0), unless --require is given.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('Browser tests skipped: Playwright is not installed (npm i -D playwright && npx playwright install chromium).');
  process.exit(process.argv.includes('--require') ? 1 : 0);
}

const ROOT = path.join(__dirname, '..');
const BASE = '/mitznsimz-hold-the-line/';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SETTINGS = 'htl-settings-v1';

/* ---------- a tiny static server, so the game is served from a sub-folder as on GitHub Pages ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
    let file = path.join(ROOT, url.slice(BASE.length) || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

/* ---------- the harness ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(ok, msg) { if (!ok) throw new Error(msg); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let browser, url;
// a fresh page: its own storage, a window size, a user agent, and anything to run before the game loads
async function open({ w = 1280, h = 800, dpr = 1, ua = CHROME, settings = { sound: false }, campaign = false, before = [], offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, userAgent: ua, acceptDownloads: true,
    serviceWorkers: offline ? 'allow' : 'block' }); // the offline worker only where a test is about it
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) page.errors.push(m.text()); });
  await page.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, [SETTINGS, JSON.stringify(settings)]);
  for (const s of before) await page.addInitScript(s);
  await page.goto(url);
  await page.waitForFunction(() => window.HTL_VIEW && window.HTL_CAMPAIGN);
  if (campaign) { // every battle won on Medium: the whole cellar and house open
    await page.evaluate(() => {
      const C = window.HTL_CAMPAIGN, c = C.fresh();
      for (const id of C.CELLAR.concat(C.HOUSE)) { c.wins[id] = { medium: 1 }; c.totals.battles++; c.totals.wins++; }
      c.takings = c.earned = 2000;
      C.save(localStorage, c);
    });
    await page.reload();
    await page.waitForFunction(() => window.HTL_VIEW);
  }
  await page.waitForTimeout(300);
  page.ctx = ctx;
  return page;
}
const info = page => page.evaluate(() => window.HTL_VIEW.info());
const supportLine = page => page.evaluate(() => { const l = document.querySelector('#overlay:not([hidden]) .support-line'); return l ? l.textContent.trim() : null; });
async function battle(page, room, id, { diff = null, auto = true, speed = 1 } = {}) {
  await page.click('.room[data-room="' + room + '"]');
  await page.click('.battle[data-id="' + id + '"]');
  if (diff) await page.click('.diff button[data-d="' + diff + '"]');
  await page.click('#btnGo');
  await page.waitForFunction(() => window.HTL_VIEW.info().started);
  if (auto && await page.getAttribute('#btnAuto', 'aria-pressed') !== 'true') await page.click('#btnAuto'); // Auto stays on from the last battle
  if (speed !== 1) await page.evaluate(n => window.HTL_VIEW.speed(n), speed);
}
async function playToEnd(page, limitMs = 120000) {
  await page.waitForFunction(() => window.HTL_VIEW.info().phase !== 'running', null, { timeout: limitMs, polling: 500 });
  await page.waitForSelector('#overlay:not([hidden]) #btnChoose', { timeout: 10000 });
  return page.evaluate(() => window.HTL_VIEW.info().phase);
}
// drawing slowed in proportion to the board's pixels, the way a slow browser behaves
const SLOW = cost => `(() => { const di = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img, x, y, w, h) {
    if (this.canvas && this.canvas.id === 'board' && arguments.length === 5 && x === 0 && y === 0) {
      const ms = this.canvas.width * this.canvas.height / 1e6 * ${cost}, t = performance.now(); while (performance.now() - t < ms) {} }
    return di.apply(this, arguments); }; })()`;
// frames held to 30 a second, as a battery saver does
const CAP30 = `(() => { const raf = window.requestAnimationFrame.bind(window); let next = 0;
  window.requestAnimationFrame = cb => raf(function tick(ts) { if (ts < next) return raf(tick); next = ts + 31.3; cb(ts); }); })()`;
const saved = page => page.evaluate(k => (JSON.parse(localStorage.getItem(k) || '{}').boardPx) || null, SETTINGS);

/* ---------- the page ---------- */
test('the page loads with no errors on a desktop and a phone, with its tab name and icons', async () => {
  for (const size of [{ w: 1280, h: 800 }, { w: 390, h: 844, dpr: 3 }]) {
    const page = await open(size);
    assert(await page.title() === 'Mitz & Simz: Hold the Line', 'tab name: ' + await page.title());
    for (const f of ['icon.svg', 'icon-32.png', 'icon-180.png']) {
      const r = await page.request.get(url + f);
      assert(r.status() === 200, f + ' answered ' + r.status());
    }
    const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel*=icon]')].map(l => l.getAttribute('href')));
    assert(['icon.svg', 'icon-32.png', 'icon-180.png'].every(f => icons.includes(f)), 'the page links its icons: ' + icons);
    assert(!page.errors.length, 'errors: ' + page.errors.join(' | '));
    await page.ctx.close();
  }
});

test('the credits show the version and every link, the shared way', async () => {
  const page = await open({ w: 390, h: 844, dpr: 2 });
  await page.click('#btnCredits');
  const { text, links } = await page.evaluate(() => ({
    text: document.querySelector('#overlay').textContent,
    links: [...document.querySelectorAll('#overlay a')].map(a => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel }))
  }));
  const v = (await info(page)).version;
  assert(text.includes('version ' + v), 'the credits name version ' + v);
  const has = (t, h) => links.some(l => l.text === t && l.href === h);
  assert(has('☕ Enjoying it? Buy Pete some dice, or Mitz & Simz some treats.', 'https://ko-fi.com/mitznsimz'), 'the Ko-fi words, exactly');
  assert(has('🛡 MitzNSimz.co.uk', 'https://mitznsimz.co.uk') && text.includes('3D-printed miniatures and tools for Dungeon Masters'), 'the website words');
  for (const h of ['https://mitznsimz-cpu.github.io/mitznsimz-dungeon-delve/', 'https://mitznsimz-cpu.github.io/mitznsimz-tarokk/',
    'https://mitznsimz-cpu.github.io/DnD-Encounter-Tracker/', 'https://github.com/mitznsimz-cpu/mitznsimz-hold-the-line/issues', 'mailto:mitznsimz@gmail.com'])
    assert(links.some(l => l.href === h), 'the credits link ' + h);
  assert(text.includes('Made by Pete at MitzNSimz, Folkestone') && text.includes('No ads and no tracking'), 'who made it, and no ads or tracking');
  for (const l of links.filter(l => l.target === '_blank')) assert(l.rel === 'noopener noreferrer', l.href + ' opens a new tab without rel="noopener noreferrer"');
  assert(!links.some(l => /mitznsimz\.com|utm_|[?&]ref=/i.test(l.href)), 'always .co.uk, and no tracking tags');
  const overflow = await page.evaluate(() => { const p = document.querySelector('.credits').getBoundingClientRect(); return [...document.querySelectorAll('.credits a')].filter(a => a.getBoundingClientRect().right > p.right + 1).map(a => a.textContent); });
  assert(!overflow.length, 'links run off a phone screen: ' + overflow.join(', '));
  await page.ctx.close();
});

test('the support line is on the tavern screen, and not when the tavern is opened from a paused battle', async () => {
  const fresh = await open();
  assert(await supportLine(fresh) === '☕ Enjoying it? Buy Pete some dice, or Mitz & Simz some treats. · 🛡 MitzNSimz.co.uk', 'a new player sees it: ' + await supportLine(fresh));
  await fresh.ctx.close();
  const page = await open({ campaign: true });
  assert(await supportLine(page), 'a returning player sees it');
  await battle(page, 'cellar', 'vaults', { auto: false });
  await page.click('#btnPause');
  await page.click('#overlay button:has-text("Back to the tavern")');
  assert(await page.evaluate(() => !!document.querySelector('#overlay:not([hidden]) .hub')), 'the tavern opened from the pause screen');
  assert(await supportLine(page) === null, 'no support line while a battle is paused underneath');
  await page.ctx.close();
});

test('each battle has drifting motes to suit it, and Settings turns them off and on again', async () => {
  const page = await open({ campaign: true });
  await battle(page, 'cellar', 'forge', { auto: false });
  let m = (await info(page)).motes;
  assert(m && m.kind === 'embers' && m.n > 10, 'the forge has embers: ' + JSON.stringify(m));
  const before = (await info(page)).draws; await page.waitForTimeout(400);
  assert((await info(page)).draws > before, 'the board keeps drawing');
  await page.click('#btnPause');
  await page.click('#overlay button:has-text("Settings")');
  await page.click('[data-set="motes"]');
  assert((await info(page)).motes === null, 'off');
  await page.click('[data-set="motes"]');
  assert((await info(page)).motes.kind === 'embers', 'and on again');
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
});
test('the minis are lit, their poses are lit in the background before the fighting, and Settings turns it off', async () => {
  const page = await open();
  await battle(page, 'cellar', 'warren', { auto: false });
  let l = (await info(page)).lit;
  assert(l.on && l.standing >= 10, 'the standing minis are lit as the board is laid out: ' + JSON.stringify(l));
  await page.waitForFunction(() => window.HTL_VIEW.info().lit.waiting === 0, null, { timeout: 15000 });
  l = (await info(page)).lit;
  assert(l.poses >= 10, 'and the poses soon after: ' + JSON.stringify(l));
  await page.click('#btnPause');
  await page.click('#overlay button:has-text("Settings")');
  await page.click('[data-set="lit"]');
  l = (await info(page)).lit;
  assert(!l.on && l.standing === 0 && l.poses === 0, 'off: ' + JSON.stringify(l));
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
});
test('each battle is laid with its themed floor, Settings goes back to the mat, and without WebGL 2 the mat stays', async () => {
  let page = await open();
  await battle(page, 'cellar', 'warren', { auto: false });
  let f = (await info(page)).floor;
  assert(f && f.theme === 'damp' && f.px > 16, 'the warren is laid with damp flagstones: ' + JSON.stringify(f));
  await page.click('#btnPause');
  await page.click('#overlay button:has-text("Settings")');
  await page.click('[data-set="floors"]');
  assert((await info(page)).floor === null, 'off: the vinyl mat');
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
  page = await open({ before: [() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { return k === 'webgl2' ? null : get.call(this, k, o); }; }] });
  await battle(page, 'cellar', 'warren', { auto: false });
  assert((await info(page)).floor === null && (await info(page)).started, 'no WebGL 2: the mat, and the battle runs');
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
});
test('the trophy wall hangs a plaque for every trophy, won or not', async () => {
  const page = await open({ campaign: true });
  await page.click('.room[data-room="trophies"]');
  const r = await page.evaluate(() => ({ n: HTL_CAMPAIGN.TROPHIES.length, drawn: [...document.querySelectorAll('#overlay canvas.plaque')].filter(c => c.width > 0).length,
    got: document.querySelectorAll('#overlay .trophy.got canvas.plaque').length }));
  assert(r.drawn === r.n && r.n >= 30, 'plaques: ' + JSON.stringify(r));
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
});
test('Export saves the campaign to a file, and Import brings it back after asking, keeping the old one aside', async () => {
  const page = await open({ campaign: true });
  await page.click('#btnSettings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  assert(/^hold-the-line-campaign-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), 'file name: ' + dl.suggestedFilename());
  const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert(file.game === 'mitznsimz-hold-the-line' && file.campaign && file.campaign.takings === 2000, 'the file holds the campaign');
  assert(/downloads/.test(await page.textContent('#campMsg')), 'it says where the file went');
  // a file that isn't a campaign is turned away, and nothing changes
  await page.setInputFiles('#impFile', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.waitForFunction(() => /isn’t a Hold the Line campaign/.test(document.getElementById('campMsg').textContent));
  // the campaign from the file, with different takings, replaces this one only when asked
  file.campaign.takings = 1234;
  await page.setInputFiles('#impFile', { name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.waitForSelector('#btnReplace');
  const ask = await page.textContent('#overlay .panel');
  assert(/2,000 gold/.test(ask) && /1,234 gold/.test(ask), 'it shows both campaigns: ' + ask);
  await page.click('#btnKeep');
  assert(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).takings, 'mitzsimz.holdTheLine.campaign') === 2000, 'Keep changes nothing');
  await page.setInputFiles('#impFile', { name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await page.click('#btnReplace');
  const st = await page.evaluate(k => [JSON.parse(localStorage.getItem(k)).takings, JSON.parse(localStorage.getItem(k + '.before-import')).takings], 'mitzsimz.holdTheLine.campaign');
  assert(st[0] === 1234 && st[1] === 2000, 'imported, with the old campaign kept aside: ' + st);
  await page.click('#btnSettings'); // and the tavern behind shows the imported campaign
  await page.click('#btnBack');
  assert(/1,234/.test(await page.textContent('.takings')), 'the tavern shows the imported takings');
  // mid-battle, the tavern's Settings have no Export or Import
  await battle(page, 'cellar', 'warren', { auto: false });
  await page.click('#btnPause');
  await page.click('#overlay button:has-text("Back to the tavern")');
  await page.click('#btnSettings');
  assert(!(await page.$('#btnImport')), 'no Import while a battle is paused underneath');
  assert(!page.errors.length, page.errors.join('\n'));
  await page.ctx.close();
});
test('after one visit the game installs to the home screen and plays with no connection', async () => {
  const page = await open({ offline: true });
  const man = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json()));
  assert(man.start_url === './' && man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'the manifest');
  for (const i of man.icons) assert((await page.evaluate(src => fetch(src).then(r => r.status), i.src)) === 200, 'icon ' + i.src);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  await page.ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.HTL_VIEW, null, { timeout: 10000 });
  assert((await info(page)).version, 'the game loads offline');
  await battle(page, 'cellar', 'warren');
  await page.waitForFunction(() => window.HTL_VIEW.info().time > 3, null, { timeout: 20000 });
  assert(!page.errors.filter(e => !/Failed to load resource|fonts/.test(e)).length, page.errors.join('\n'));
  await page.ctx.setOffline(false);
  await page.ctx.close();
});
test('every room of the tavern opens, and every game in the back room starts, with no errors', async () => {
  const page = await open({ w: 1280, h: 800, campaign: true });
  const rooms = await page.evaluate(() => [...document.querySelectorAll('#overlay .room[data-room]:not([disabled])')].map(b => b.dataset.room));
  assert(rooms.length >= 6, 'rooms open in a full campaign: ' + rooms.join(', '));
  for (const r of rooms) {
    await page.click('.room[data-room="' + r + '"]');
    assert(await page.evaluate(() => !document.getElementById('overlay').hidden && !!document.getElementById('ovTitle')), 'the ' + r + ' did not open');
    await page.reload(); await page.waitForFunction(() => window.HTL_VIEW);
  }
  await page.click('.room[data-room="games"]');
  const modes = await page.evaluate(() => [...document.querySelectorAll('#overlay .room[data-mode]')].map(b => b.dataset.mode));
  assert(modes.length >= 5, 'games in the back room: ' + modes.join(', '));
  for (const m of modes) {
    await page.click('.room[data-mode="' + m + '"]');
    const started = () => page.evaluate(() => window.HTL_VIEW.info().started);
    for (let i = 0; i < 3 && !(await started()) && !(await page.$('#overlay:not([hidden]) #btnGo')); i++) { // a game may ask one more thing first: take the first offer
      const next = await page.$('#overlay:not([hidden]) .room:not([disabled]), #overlay:not([hidden]) .battle:not([disabled]), #overlay:not([hidden]) .btnrow button.primary:not([disabled])');
      if (!next) break; await next.click();
    }
    if (!(await started())) { // most games go through the common room; Reverse starts as soon as a cellar is picked
      const go = await page.$('#overlay:not([hidden]) #btnGo:not([disabled])');
      assert(go, m + ': no way into a battle');
      await go.click();
    }
    await page.waitForFunction(() => window.HTL_VIEW.info().started, null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    await page.reload(); await page.waitForFunction(() => window.HTL_VIEW);
    await page.click('.room[data-room="games"]');
  }
  assert(!page.errors.length, 'errors: ' + page.errors.join(' | '));
  await page.ctx.close();
});

/* ---------- menus ---------- */
test('a menu stops the board redrawing: no blur, it settles, and a resize redraws it once', async () => {
  const page = await open({ w: 1440, h: 900, dpr: 2, campaign: true });
  await battle(page, 'cellar', 'vaults', { auto: false });
  await page.click('#btnPause');
  const blur = await page.evaluate(() => getComputedStyle(document.getElementById('overlay')).backdropFilter || 'none');
  assert(blur === 'none', 'the menu blurs the board: ' + blur);
  await page.waitForTimeout(2000); // it finishes what's moving
  const t0 = (await info(page)).time;
  await page.click('#overlay button:has-text("Settings")'); await page.waitForTimeout(800);
  assert((await info(page)).time === t0, 'the battle ran on under a menu');
  const a = (await info(page)).draws; await page.waitForTimeout(1000); const b = (await info(page)).draws;
  assert(b === a, 'the board kept redrawing under the menu: ' + (b - a) + ' draws in a second');
  await page.setViewportSize({ width: 1200, height: 800 }); await page.waitForTimeout(400);
  const c = (await info(page)).draws;
  assert(c > b, 'a resize under the menu redraws the board');
  await page.waitForTimeout(2200); const d = (await info(page)).draws; await page.waitForTimeout(800);
  assert((await info(page)).draws === d, 'and then it rests again');
  await page.ctx.close();
});

/* ---------- the board's pixels ---------- */
test('the board keeps to its pixel budget: about a million in Safari, 4.2 million elsewhere, full sharpness when it fits', async () => {
  const s = await open({ w: 1440, h: 900, dpr: 2, ua: SAFARI });
  let i = await info(s);
  assert(i.webkit && i.board[0] * i.board[1] <= 1.1e6 && i.dpr >= 1, 'Safari on a laptop: ' + i.board + ' at ' + i.dpr);
  await s.ctx.close();
  const p = await open({ w: 390, h: 844, dpr: 3, ua: SAFARI.replace('Macintosh; Intel Mac OS X 10_15_7', 'iPhone; CPU iPhone OS 18_1 like Mac OS X') });
  i = await info(p);
  assert(i.board[0] * i.board[1] <= 1.1e6 && i.dpr > 1.5, 'an iPhone stays sharp on its small board: ' + i.board + ' at ' + i.dpr);
  await p.ctx.close();
  const c = await open({ w: 1440, h: 900, dpr: 2, ua: CHROME });
  i = await info(c);
  assert(!i.webkit && i.board[0] * i.board[1] > 2e6 && i.board[0] * i.board[1] <= 4.3e6, 'Chrome on a laptop: ' + i.board + ' at ' + i.dpr);
  await c.ctx.close();
});

test('on a slow browser the board drops to what it can draw within a few seconds, and remembers', async () => {
  const page = await open({ w: 1728, h: 1117, dpr: 2, campaign: true, before: [SLOW(9)] });
  const start = await info(page);
  await battle(page, 'cellar', 'lair');
  await page.waitForTimeout(4000);
  const now = await info(page), px = now.board[0] * now.board[1];
  assert(px < 0.6 * start.board[0] * start.board[1] && now.dpr >= 1, 'the board did not drop: ' + start.board + ' -> ' + now.board);
  assert(await saved(page), 'the level is saved for next time');
  await page.reload(); await page.waitForFunction(() => window.HTL_VIEW); await page.waitForTimeout(300);
  const again = await info(page);
  assert(near(again.board[0] * again.board[1], px, px * 0.1), 'after a reload it starts at the saved level: ' + again.board);
  await page.ctx.close();
});

test('a battery saver holding frames to 30 a second is left alone, and so is a fast browser', async () => {
  for (const before of [[CAP30], []]) {
    const page = await open({ w: 1728, h: 1117, dpr: 2, campaign: true, before });
    await battle(page, 'cellar', 'lair');
    const start = await info(page); // the board's size in battle (the HUD takes a little room)
    await page.waitForTimeout(5000);
    const now = await info(page);
    assert(now.dpr === start.dpr && now.board[0] === start.board[0], (before.length ? 'capped' : 'fast') + ': the board changed ' + start.board + ' at ' + start.dpr + ' -> ' + now.board + ' at ' + now.dpr);
    assert(!(await saved(page)), (before.length ? 'capped' : 'fast') + ': a level was saved');
    await page.ctx.close();
  }
});

test('a slow browser still plays the battle at the right speed', async () => {
  const page = await open({ w: 1728, h: 1117, dpr: 2, campaign: true, before: [SLOW(30)] });
  await battle(page, 'cellar', 'lair');
  await page.waitForTimeout(1500);
  const a = await page.evaluate(() => [window.HTL_VIEW.info().time, performance.now()]);
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => [window.HTL_VIEW.info().time, performance.now()]);
  const rate = (b[0] - a[0]) / ((b[1] - a[1]) / 1000);
  assert(rate > 0.9 && rate < 1.1, 'game time ran at ' + rate.toFixed(2) + ' of real time');
  await page.ctx.close();
});

/* ---------- what the board draws with ---------- */
test('a battle draws without the calls Safari is slow at, from bitmaps, and builds only the minis it needs', async () => {
  const COUNT = `(() => { window.__calls = { dash: 0, filter: 0, bitmaps: 0 }; const P = CanvasRenderingContext2D.prototype;
    const sd = P.setLineDash; P.setLineDash = function (a) { if (this.canvas && this.canvas.id === 'board' && a && a.length) window.__calls.dash++; return sd.apply(this, arguments); };
    const fd = Object.getOwnPropertyDescriptor(P, 'filter'); Object.defineProperty(P, 'filter', { get: fd.get, set(v) { if (this.canvas && this.canvas.id === 'board') window.__calls.filter++; fd.set.call(this, v); } });
    const cb = window.createImageBitmap; window.createImageBitmap = function () { window.__calls.bitmaps++; return cb.apply(this, arguments); }; })()`;
  const page = await open({ w: 1440, h: 900, dpr: 1, campaign: true, before: [COUNT] });
  await battle(page, 'cellar', 'vaults', { auto: false }); // between waves: the marching routes are showing
  await page.waitForTimeout(2500);
  const calls = await page.evaluate(() => window.__calls), i = await info(page);
  assert(calls.dash === 0, 'canvas line dashes: ' + calls.dash);
  assert(calls.filter === 0, 'the canvas filter was touched ' + calls.filter + ' times with no mini turned to stone');
  assert(calls.bitmaps > 0, 'nothing was drawn from a bitmap');
  assert(i.sprites > 0 && i.sprites < i.monsterTypes, 'minis built: ' + i.sprites + ' of ' + i.monsterTypes + ' monster types');
  await page.ctx.close();
});

test('the board image has rounded corners and is fully opaque inside them', async () => {
  const page = await open({ w: 1280, h: 800, campaign: true });
  await battle(page, 'cellar', 'vaults', { auto: false });
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => { const c = document.getElementById('board'), g = c.getContext('2d');
    return { corner: g.getImageData(1, 1, 1, 1).data[3], middle: g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] }; });
  assert(a.corner === 0, 'the corner is not cut: alpha ' + a.corner);
  assert(a.middle === 255, 'the board is see-through in the middle: alpha ' + a.middle);
  await page.ctx.close();
});

test('the page around the board stays still: the board on its own layer, the grain painted once, no needless writes', async () => {
  const page = await open({ w: 1280, h: 800, campaign: true });
  const css = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundImage, grain: getComputedStyle(document.body, '::before').backgroundImage,
    board: getComputedStyle(document.getElementById('board')).willChange, clip: getComputedStyle(document.querySelector('.board')).overflow
  }));
  assert(css.body === 'none' && /gradient/.test(css.grain), 'the grain should be on body::before, not the body: ' + JSON.stringify(css));
  assert(css.board === 'transform' && css.clip !== 'hidden', 'the board should be its own layer and not clipped: ' + JSON.stringify(css));
  await battle(page, 'cellar', 'vaults');
  await page.evaluate(() => { window.__same = 0; new MutationObserver(rs => { for (const r of rs) if (r.oldValue === r.target.getAttribute(r.attributeName)) window.__same++; })
    .observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-pressed', 'disabled', 'data-cool', 'style', 'class'] }); });
  await page.waitForTimeout(2500);
  const same = await page.evaluate(() => window.__same);
  assert(same === 0, same + ' writes that changed nothing in 2.5 seconds of battle');
  await page.ctx.close();
});

test('Frame timings show in a battle only when switched on', async () => {
  for (const on of [true, false]) {
    const page = await open({ campaign: true, settings: { sound: false, perf: on } });
    await battle(page, 'cellar', 'vaults');
    await page.waitForTimeout(1200);
    const box = await page.evaluate(() => { const b = document.getElementById('perf'); return b ? b.textContent : null; });
    assert(on ? /fps/.test(box || '') : box === null, 'Frame timings ' + (on ? 'on' : 'off') + ': ' + box);
    await page.ctx.close();
  }
});

/* ---------- a campaign to its end ---------- */
test('winning the last battle of the house shows the Ko-fi line, an ordinary win does not, and every trophy feat is passed on', async () => {
  const page = await open({ w: 1280, h: 800, campaign: true });
  await page.evaluate(() => { const C = window.HTL_CAMPAIGN, rec = C.record; C.record = function (c, md) { window.__recorded = JSON.parse(JSON.stringify(md)); return rec.apply(this, arguments); }; });
  await battle(page, 'house', 'attic', { diff: 'easy', speed: 8 });
  assert(await playToEnd(page) === 'won', 'Simz lost the Attic on Easy');
  const asked = new Set([...fs.readFileSync(path.join(ROOT, 'campaign.js'), 'utf8').matchAll(/s\.feats\.(\w+)/g)].map(m => m[1]));
  const feats = await page.evaluate(() => window.__recorded && window.__recorded.feats);
  assert(feats, 'the battle handed no feats to the campaign');
  const missing = [...asked].filter(k => !(k in feats));
  assert(!missing.length, 'trophy feats never passed on: ' + missing.join(', '));
  assert(/Enjoying it\? Buy Pete some dice/.test(await supportLine(page) || ''), 'no Ko-fi line after the last house battle');
  await page.click('#btnChoose');
  await battle(page, 'cellar', 'warren', { diff: 'easy', speed: 8 });
  assert(await playToEnd(page) === 'won', 'Simz lost the Warren on Easy');
  assert(await supportLine(page) === null, 'an ordinary win shows the support line');
  assert(!page.errors.length, 'errors: ' + page.errors.join(' | '));
  await page.ctx.close();
});

/* ---------- run ---------- */
(async () => {
  const server = await serve();
  url = 'http://127.0.0.1:' + server.address().port + BASE;
  browser = await chromium.launch();
  let passed = 0, failed = 0; const t0 = Date.now();
  const only = process.argv.indexOf('--only') > 0 ? process.argv[process.argv.indexOf('--only') + 1] : null; // run the tests whose names contain this
  for (const t of tests.filter(t => !only || t.name.includes(only))) {
    try { await t.fn(); passed++; console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + String(e && e.message || e).split('\n')[0]); }
  }
  await browser.close(); server.close();
  console.log(passed + ' passed, ' + failed + ' failed (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  process.exit(failed ? 1 : 0);
})();
