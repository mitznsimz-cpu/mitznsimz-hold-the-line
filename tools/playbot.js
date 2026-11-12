// The play bot: plays Hold the Line through the real screen, the way a player does.
//
// After the Dungeon Delve's tools/playbot.js. It looks at what is showing and acts only as a player can: clicks on
// buttons that are there and enabled, clicks on squares of the board, a key now and then. So it finds what the
// headless tests can't: places where the screen and the rules disagree. It reads the game only through the page's
// read-only hook (window.HTL_VIEW) and the page itself; it never calls the rules.
//
// Each run starts a fresh campaign (or, with --campaign, one with the cellar won) and wanders: rooms of the tavern,
// battles and their difficulties, the party, hero cards, the belt, the cats, pause, speed, Auto, settings, and the
// result screens. Now and then, in the tavern, it reloads the page and checks the campaign comes back the same.
//
// It reports a FAULT when the game, not the bot, is at fault:
//   page-error      an uncaught error or a console error on the page
//   frozen          a battle running, not paused, with no menu over it, whose clock does not move
//   stuck           a battle whose rounds stop coming while its clock runs, or that runs past 400 rounds
//   bad-number      gold, lives, a round or a unit's hit points that is not a sane number
//   nothing-to-do   a screen with no battle and nothing the player can press, for too long
//   reload-differs  the campaign after a page reload is not the campaign before
//
// Usage: node tools/playbot.js [--runs 8] [--ticks 600] [--seed 1] [--jobs 4] [--campaign] [--motion on|off|both]
//        [--width 1280 --height 800] [--out playbot-out] [--quiet]
// Needs Playwright (npm install playwright). Exit code 1 if anything is at fault.
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const RUNS = +opt('runs', 8), TICKS = +opt('ticks', 900), SEED0 = +opt('seed', 1), JOBS = +opt('jobs', 4);
const W = +opt('width', 1280), H = +opt('height', 800), MOTION = opt('motion', 'both');
const OUT = path.resolve(opt('out', 'playbot-out')), QUIET = args.includes('--quiet'), CAMPAIGN = args.includes('--campaign');
const ROOT = path.join(__dirname, '..'), BASE = '/mitznsimz-hold-the-line/';
fs.mkdirSync(OUT, { recursive: true });

// a small seeded generator, so a failing run can be played again exactly (the game's own dice are its own)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];
function weighted(r, list) { // [[weight, item], ...]
  const total = list.reduce((n, [w]) => n + w, 0); let x = r() * total;
  for (const [w, it] of list) { if ((x -= w) <= 0) return it; }
  return list[list.length - 1][1];
}

/* ---------- the game, served from a sub-folder as on GitHub Pages ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
    const file = path.join(ROOT, url.slice(BASE.length) || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

/* ---------- in the page: what is showing, read only ---------- */
function look() {
  const vis = el => { if (!el || el.disabled) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  const label = el => (el.id ? '#' + el.id : '') + (el.dataset.room ? '[room=' + el.dataset.room + ']' : '') + (el.dataset.id ? '[id=' + el.dataset.id + ']' : '') +
    (el.dataset.d ? '[d=' + el.dataset.d + ']' : '') + (el.dataset.type ? '[type=' + el.dataset.type + ']' : '') + ' ' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const o = document.getElementById('overlay'), menu = o && !o.hidden;
  const all = [...document.querySelectorAll(menu ? '#overlay button' : 'button')].filter(vis);
  const buttons = all.map((el, i) => { const r = el.getBoundingClientRect(); return { i, label: label(el), cls: el.className, pressed: el.getAttribute('aria-pressed'), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const V = window.HTL_VIEW, info = V ? V.info() : null;
  return { menu, buttons, info, numbers: V ? V.numbers() : null, title: menu ? (o.querySelector('h2') || {}).textContent || '' : '' };
}

/* ---------- a run ---------- */
async function run(browser, base, n) {
  const seed = SEED0 + n, r = rng(seed * 7919), calm = MOTION === 'both' ? n % 2 === 1 : MOTION === 'off';
  // two kinds of player: a busy one who places, levels, throws and fiddles all the time, and a steady one who leaves
  // Auto on and steps in now and then, so the bot reaches the end of battles, wins included
  const steady = n % 4 >= 2;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block', acceptDownloads: false });
  const page = await ctx.newPage(), faults = [], notes = [], log = [];
  const fault = async (kind, detail) => {
    if (faults.some(f => f.kind === kind && f.detail === detail)) return;
    const shot = path.join(OUT, 'run' + n + '-' + kind + '-' + faults.length + '.png');
    await page.screenshot({ path: shot }).catch(() => {});
    faults.push({ kind, detail, shot: path.relative(process.cwd(), shot), tick: log.length, last: log.slice(-8) });
  };
  page.on('pageerror', e => fault('page-error', String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) fault('page-error', m.text()); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.addInitScript(([calm, campaign]) => {
    localStorage.setItem('htl-settings-v1', JSON.stringify({ sound: false, motion: calm ? 'reduced' : 'full' }));
    if (campaign) localStorage.setItem('htl-bot-campaign', '1');
  }, [calm, CAMPAIGN]);
  await page.goto(base);
  await page.waitForFunction(() => window.HTL_VIEW, null, { timeout: 15000 });
  if (CAMPAIGN && n === 0 || CAMPAIGN) { // the cellar won, so the house and the back room are open
    await page.evaluate(() => { if (!localStorage.getItem('htl-bot-seeded')) { const C = HTL_CAMPAIGN, c = C.fresh();
      for (const b of HTL.BATTLES.slice(0, 18)) c.wins[b.id] = { medium: 1 }; c.takings = 2000;
      localStorage.setItem(C.KEY, JSON.stringify(c)); localStorage.setItem('htl-bot-seeded', '1'); } });
    await page.reload(); await page.waitForFunction(() => window.HTL_VIEW);
  }

  const played = []; let lastBattle = null, maxRound = 0, maxRoundHere = 0, lastTime = -1, still = 0, idle = 0, roundAt = { round: -1, time: 0 }, battles = 0, wins = 0, losses = 0, reloads = 0, sawResult = false;
  for (let tick = 0; tick < TICKS; tick++) {
    let L;
    try { L = await page.evaluate(look); } catch (e) { await fault('page-error', 'the page stopped answering: ' + e.message); break; }
    const { menu, buttons, info, numbers } = L;

    // the checks, every tick
    if (numbers) {
      const bad = [];
      if (!Number.isFinite(numbers.gold) || numbers.gold < 0) bad.push('gold ' + numbers.gold);
      if (!Number.isInteger(numbers.lives) || numbers.lives < 0) bad.push('lives ' + numbers.lives);
      if (!Number.isFinite(numbers.round) || numbers.round < 0) bad.push('round ' + numbers.round);
      for (const u of numbers.units) if (!Number.isFinite(u.hp)) bad.push(u.type + ' hp ' + u.hp);
      if (bad.length) await fault('bad-number', bad.join(', '));
    }
    if (info && info.started && info.phase === 'running' && !info.paused && !menu) {
      // frozen: the clock still for five real seconds (the first moments of a battle can be slow in a software-drawn browser)
      if (info.time === lastTime) { if (!still) still = Date.now(); else if (Date.now() - still > 5000) { await fault('frozen', 'the clock stood at ' + info.time.toFixed(1) + ' for ' + ((Date.now() - still) / 1000).toFixed(0) + ' s in ' + info.battle); still = 0; } }
      else still = 0;
      if (numbers.round !== roundAt.round) roundAt = { round: numbers.round, time: info.time };
      else if (info.time - roundAt.time > 30) { await fault('stuck', 'round ' + numbers.round + ' of ' + info.battle + ' for ' + (info.time - roundAt.time).toFixed(0) + ' s'); roundAt.time = info.time; }
      if (numbers.round > 400) await fault('stuck', info.battle + ' ran past 400 rounds');
      if (numbers.round === 160 && !notes.includes('long ' + info.battle)) notes.push('long ' + info.battle);
    } else still = 0;
    if (!(info && info.started)) lastBattle = null;
    lastTime = info ? info.time : -1;
    if (!buttons.length && !(info && info.started)) { if (++idle >= 15) { await fault('nothing-to-do', 'no battle and nothing to press'); idle = 0; } } else idle = 0;
    const phase = info && info.started ? info.phase : null; // a battle's end, counted once
    if ((phase === 'won' || phase === 'lost') && !sawResult) { sawResult = true; if (phase === 'won') wins++; else losses++; }
    if (phase === 'running') sawResult = false;

    // what to do
    const press = async b => { if (!b) return; log.push(b.label); await page.mouse.click(b.x, b.y); }; // where it is on the screen, as a player clicks
    const find = re => buttons.filter(b => re.test(b.label));
    if (menu) {
      const inTavern = /Cat & Mouse|tavern/i.test(L.title) && find(/\[room=/).length > 0;
      if (inTavern && r() < 0.04) { // a reload, and the campaign must come back the same
        const before = await page.evaluate(() => window.HTL_VIEW.camp());
        log.push('reload'); reloads++;
        await page.reload(); await page.waitForFunction(() => window.HTL_VIEW, null, { timeout: 15000 });
        const after = await page.evaluate(() => window.HTL_VIEW.camp());
        const canon = j => JSON.stringify(JSON.parse(j), (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
        if (canon(after) !== canon(before)) { // the same campaign, whatever order its fields are in
          const diff = [], walk = (a, b, k) => { if (JSON.stringify(a) === JSON.stringify(b)) return;
            if (a && b && typeof a === 'object' && typeof b === 'object') { for (const x of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[x], b[x], k + '.' + x); }
            else diff.push(k + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b)); };
          walk(JSON.parse(before), JSON.parse(after), 'campaign');
          await fault('reload-differs', diff.slice(0, 4).join('; '));
        }
        continue;
      }
      const choices = buttons.filter(b => !/#btnReplace|#btnImport|#btnExport|Replace it/.test(b.label)).map(b => {
        let w = 1;
        if (info && info.started && info.phase === 'running') w = /#btnResume/.test(b.label) ? 10 : /#btnRestart|#btnChoose/.test(b.label) ? 0.4 : 1; // paused: mostly back to it
        else if (/#btnGo|#btnChoose|#btnAgain|Next battle|#btnNext/.test(b.label)) w = 8;
        else if (/\[id=/.test(b.label) && /battle/.test(b.cls)) w = 5;
        else if (/\[room=(cellar|house|back)/.test(b.label)) w = 4;
        else if (/#btnSettings|#btnBack|Done|Back/.test(b.label)) w = 1.5;
        else if (/\[d=/.test(b.label)) w = 2;
        else if (/Buy |Upgrade|for \d+ gold/.test(b.label)) w = 0.3; // shopping is fine, but not all day
        return [w, b];
      });
      if (choices.length) await press(weighted(r, choices));
    } else if (info && info.started) {
      if (info.phase !== 'running') { await page.waitForTimeout(150); continue; }
      // a player in a hurry: double speed, and Auto on most of the time so battles reach their end
      const auto = find(/#btnAuto/)[0], sp = find(/#btnSpeed/)[0];
      if (numbers.round > maxRound) maxRound = numbers.round;
      if (info.battle !== lastBattle || info.time < maxRoundHere) { lastBattle = info.battle; battles++; played.push(info.battle); } // a new battle, or the same one again
      maxRoundHere = info.time;
      if (sp && / 1×/.test(sp.label) && r() < 0.5) { await press(sp); continue; }
      if (auto && auto.pressed !== 'true' && r() < (steady ? 0.9 : 0.3)) { await press(auto); continue; }
      const roll = steady ? (r() < 0.12 ? r() : 1) : r();
      if (roll < 0.25) { // a hero from the tray onto a square
        const cards = buttons.filter(b => /\bcard\b/.test(b.cls) && /\[type=/.test(b.label));
        if (cards.length && numbers.map) {
          await press(pick(r, cards));
          const at = await page.evaluate(([l, q]) => window.HTL_VIEW.at(l, q), [Math.floor(r() * numbers.map[0]), Math.floor(r() * Math.min(numbers.map[1], 6))]);
          if (at) { log.push('square'); await page.mouse.click(at.x, at.y); }
        }
      } else if (roll < 0.33) { // a unit's card: level it up, or send it home
        const h = numbers.units.filter(u => u.kind === 'hero');
        if (h.length) {
          const u = pick(r, h), at = await page.evaluate(([l, q]) => window.HTL_VIEW.at(l, q), [u.lane, u.sq]);
          if (at) { log.push('card ' + u.type); await page.mouse.click(at.x, at.y); await page.waitForTimeout(80);
            const more = (await page.evaluate(look)).buttons.filter(b => /#btnLevel|#btnRecall|#btnUnitClose|path/i.test(b.label));
            if (more.length) await press(weighted(r, more.map(b => [/#btnRecall/.test(b.label) ? 0.3 : 1, b]))); }
        }
      } else if (roll < 0.4) { // the cats, the belt, the gate
        const p = find(/#pw-|#btnGate|belt|throw/i);
        if (p.length && numbers.map) { await press(pick(r, p));
          const at = await page.evaluate(([l, q]) => window.HTL_VIEW.at(l, q), [Math.floor(r() * numbers.map[0]), Math.floor(r() * numbers.map[1])]);
          if (at) { log.push('aim'); await page.mouse.click(at.x, at.y); } }
      } else if (roll < 0.42) { await press(find(/#btnSpeed/)[0]); }
      else if (roll < 0.46) { log.push('Escape'); await page.keyboard.press('Escape'); }
      else if (roll < 0.47) { const pz = find(/#btnPause/)[0]; if (pz) await press(pz); } // pause: the menu is played next tick
    }
    await page.waitForTimeout(menu ? 60 : 150);
  }
  const summary = { run: n, seed, calm, steady, ticks: TICKS, played, battles, maxRound, wins, losses, reloads, faults, notes, last: log.slice(-12) };
  await ctx.close();
  return summary;
}

(async () => {
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port + BASE;
  const browser = await chromium.launch();
  const results = [], queue = [...Array(RUNS).keys()];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(JOBS, RUNS) }, async () => {
    while (queue.length) {
      const n = queue.shift(), res = await run(browser, base, n);
      results.push(res);
      if (!QUIET) console.log('run ' + n + (res.steady ? ' steady' : ' busy') + (res.calm ? ', reduced motion' : '') + ': ' + res.battles + ' battles (to round ' + res.maxRound + '), ' + res.wins + ' won, ' + res.losses + ' lost, ' + res.reloads + ' reloads, ' +
        (res.faults.length ? res.faults.length + ' FAULTS: ' + res.faults.map(f => f.kind + ' (' + f.detail + ')').join('; ') : 'no faults'));
    }
  }));
  await browser.close(); server.close();
  results.sort((a, b) => a.run - b.run);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  const faults = results.reduce((n, x) => n + x.faults.length, 0);
  console.log(RUNS + ' runs, ' + results.reduce((n, x) => n + x.wins, 0) + ' battles won, ' + results.reduce((n, x) => n + x.losses, 0) + ' lost, ' +
    results.reduce((n, x) => n + x.reloads, 0) + ' reloads, ' + faults + ' faults, ' + Math.round((Date.now() - t0) / 1000) + ' s' + (faults ? ': see ' + path.relative(process.cwd(), OUT) + '/report.json' : ''));
  process.exit(faults ? 1 : 0);
})();
