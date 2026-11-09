// Headless harness for Hold the Line's copy of the shared minis library (MINI CORE 2.x plus the TableMinis adapter).
// Runs it in a Node VM with a recording mock canvas, checks the core matches the canonical file, then checks the adapter.
// Usage: node tests/minis.test.js [mitznsimz_minis.js] [canonical mitznsimz_minis.js]   (the canonical copy lives with the Dungeon Delve; without it the identity check is skipped)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const RE = /\/\* ==== MINI CORE START ==== \*\/[\s\S]*?\/\* ==== MINI CORE END ==== \*\//;
const copyPath = process.argv[2] || (fs.existsSync(path.join(ROOT, 'mitznsimz_minis.js')) ? path.join(ROOT, 'mitznsimz_minis.js') : path.join(ROOT, 'hold-the-line', 'mitznsimz_minis.js'));
const canonPath = process.argv[3] || path.join(ROOT, 'shared', 'mitznsimz_minis.js');
const source = fs.readFileSync(copyPath, 'utf8');

// ---------- a canvas that records what gets drawn ----------
function mockContext(canvas) {
  const rec = { pts: [], fills: 0, strokes: 0, images: [], bad: 0 };
  const pt = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) rec.bad++; rec.pts.push([x, y]); };
  const noop = () => {};
  return {
    canvas, rec,
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop, closePath: noop, beginPath: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    moveTo: pt, lineTo: pt,
    quadraticCurveTo(cx, cy, x, y) { pt(cx, cy); pt(x, y); },
    bezierCurveTo(a, b, c, d, x, y) { pt(a, b); pt(c, d); pt(x, y); },
    arcTo(x1, y1, x2, y2) { pt(x1, y1); pt(x2, y2); },
    arc(x, y, r) { pt(x - r, y - r); pt(x + r, y + r); },
    ellipse(x, y, rx, ry, rot) {
      const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
      const hx = Math.sqrt(rx * rx * c * c + ry * ry * s * s), hy = Math.sqrt(rx * rx * s * s + ry * ry * c * c);
      pt(x - hx, y - hy); pt(x + hx, y + hy);
    },
    fill() { rec.fills++; }, stroke() { rec.strokes++; },
    drawImage(img, x, y, w, h) { rec.images.push({ img, x, y, w, h }); },
    createLinearGradient() { return { addColorStop: noop }; },
    createRadialGradient() { return { addColorStop: noop }; }
  };
}
function mockCanvas(w, h) { const c = { width: w, height: h }; const ctx = mockContext(c); c.getContext = () => ctx; return c; }

// ---------- a fake Image: 'ok' in the URL loads, anything else fails ----------
const pendingImages = [];
class FakeImage {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(url) {
    this._src = url;
    pendingImages.push(() => {
      if (/ok/.test(url)) { this.width = this.naturalWidth = 400; this.height = this.naturalHeight = 500; this.onload && this.onload(); }
      else this.onerror && this.onerror();
    });
  }
  get src() { return this._src; }
}
const flushImages = () => { while (pendingImages.length) pendingImages.shift()(); };

const sandbox = { Image: FakeImage };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'mitznsimz_minis.js' });
const M = sandbox.TableMinis, CORE = sandbox.MitzMinis;
M.setCanvasFactory(mockCanvas);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
console.log('Mitz & Simz minis v' + M.VERSION + ' harness (Hold the Line adapter)');

test('the core block is the canonical file, unchanged, and stamped 2.x', () => {
  const mine = source.match(RE);
  assert.ok(mine, 'no MINI CORE markers');
  assert.ok(/^2\./.test(sandbox.MITZ_MINIS_VERSION), 'stamp ' + sandbox.MITZ_MINIS_VERSION);
  if (!fs.existsSync(canonPath)) return console.log('       (no canonical file at ' + canonPath + ', identity not checked)');
  assert.ok(mine[0] === fs.readFileSync(canonPath, 'utf8').match(RE)[0], 'out of date: run node tools/sync-minis.js');
});

test('the adapter sits after the core and leaves the core\'s names alone', () => {
  assert.ok(source.indexOf('HOLD THE LINE ADAPTER START') > source.indexOf('MINI CORE END'));
  for (const k of ['sprite', 'flash', 'figure', 'SIZES', 'register']) assert.ok(CORE[k], 'MitzMinis.' + k + ' should stay the core\'s');
  assert.strictEqual(CORE.SIZES.small.rx, 0.24, 'the core keeps its own sizes');
});

test('every figure in the library passes the shared validator', () => {
  for (const id of CORE.list()) { const errs = CORE.check(id, CORE.figure(id)); assert.ok(!errs.length, errs.join(' ')); }
});

const ALL = M.list().concat(['proxy']);

test('the standard figures are registered, under either game\'s names', () => {
  for (const t of ['fighter', 'ranger', 'bard', 'wizard', 'goblin', 'orc', 'ogre', 'goblinArcher', 'goblin.archer', 'caveBear', 'bear']) assert.ok(M.has(t), t + ' missing');
  assert.strictEqual(M.id('caveBear'), 'bear');
});

// Dungeon Delve pack v4.0.1 bestiary: every monster id, without the 'mn.' prefix, needs a drawn mini.
const MSDD_MONSTERS = ['goblin', 'goblinArcher', 'goblinShaman', 'direRat', 'caveBat', 'skeleton', 'skelArcher', 'warrenHound',
  'rotGrub', 'tombSpider', 'goblinChief', 'boneKnight', 'shadeWisp', 'ironSentinel', 'cryptWarden', 'shade',
  'kobold', 'caveSerpent', 'deepLeech', 'direWolf', 'giantBeetle', 'caveBear', 'orcRaider', 'lizardfolk', 'orcChampion',
  'brigand', 'brigandArcher', 'renegadeMage', 'fallenPriest', 'ghoul', 'wight', 'wraith', 'barrowLich', 'boneTitan',
  'gargoyle', 'gloom', 'emberWisp', 'clayGolem', 'stoneColossus', 'deepHorror'];
test('every Dungeon Delve monster has its own mini (' + MSDD_MONSTERS.length + ')', () => {
  const missing = MSDD_MONSTERS.filter(t => !M.has(t));
  assert.ok(!missing.length, 'no mini for: ' + missing.join(', '));
  for (const t of MSDD_MONSTERS) assert.strictEqual(M.figure(t).faction, 'monster', t + ' should stand on a monster base');
});

test('every figure renders at phone, tablet and desktop sizes in both views', () => {
  for (const t of ALL) for (const u of [24, 48, 96, 180]) for (const view of ['tabletop', 'front']) {
    const sp = M.render(t, u, { view });
    const rec = sp.cv.getContext('2d').rec;
    assert.ok(rec.fills >= 6, t + ' drew too little');
    assert.strictEqual(rec.bad, 0, t + ' produced a non-numeric coordinate');
    assert.ok(sp.cv.width > 0 && sp.cv.height > 0);
  }
});

test('every figure stays inside its sprite canvas', () => {
  const slack = 0.03; // outline width
  for (const t of ALL) for (const view of ['tabletop', 'front']) {
    const b = M.box(t), sp = M.render(t, 64, { view });
    const minX = -b.ax - slack, maxX = b.w - b.ax + slack, minY = -b.ay - slack, maxY = b.h - b.ay + slack;
    for (const [x, y] of sp.cv.getContext('2d').rec.pts) {
      assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY,
        t + ' (' + view + ') reaches ' + x.toFixed(3) + ', ' + y.toFixed(3) + ' outside the ' + b.w + '×' + b.h + ' box');
    }
  }
});

test('the first-person view draws a flatter base than the tabletop view', () => {
  const tall = M.render('orc', 100, { view: 'tabletop' }).cv.getContext('2d').rec.pts;
  const flat = M.render('orc', 100, { view: 'front' }).cv.getContext('2d').rec.pts;
  const baseDepth = pts => Math.max.apply(null, pts.filter(p => p[1] > 0).map(p => p[1]));
  assert.ok(baseDepth(flat) < baseDepth(tall));
});

test('an unknown type falls back to the proxy figure', () => {
  const sp = M.render('quillbeast', 48); // the mimic was the example until minis 2.3 gave it a figure
  assert.strictEqual(sp.figure, 'proxy');
  assert.strictEqual(sp.type, 'quillbeast');
});

test('register adds figures and refuses bad definitions', () => {
  M.register('test-chest', { name: 'Chest', faction: 'neutral', size: 'small', draw(p, H) { for (let i = 0; i < 6; i++) p.solid(() => H.rr(-0.15, -0.2, 0.3, 0.18, 0.03)); } });
  assert.ok(M.has('test-chest'));
  assert.throws(() => M.register('nope', {}));
  assert.throws(() => M.register('nope', { size: 'colossal', draw() {} }));
  assert.throws(() => M.register('nope', { faction: 'pirates', draw() {} }));
});

test('sprites are cached per type, size and view', () => {
  M.clearCache();
  const a = M.sprite('goblin', 50), b = M.sprite('goblin', 50), c = M.sprite('goblin', 50, { view: 'front' }), d = M.sprite('goblin', 60);
  assert.ok(a === b); assert.ok(a !== c); assert.ok(a !== d);
});

test('an STL render replaces the drawn mini once it loads, anchored on the ground point', () => {
  M.clearCache();
  let changed = 0;
  const sp = M.sprite({ type: 'orc', image: 'renders/orc-ok.png', anchor: [0.5, 0.9], height: 1.2 }, 100, { onChange: () => changed++ });
  assert.strictEqual(sp.source, 'drawn');
  const before = sp.cv;
  flushImages();
  assert.strictEqual(sp.source, 'image'); assert.strictEqual(changed, 1); assert.ok(sp.cv !== before);
  const im = sp.cv.getContext('2d').rec.images[0];
  const s = 1.2 * 100 / 500; // 1.2 squares tall at 100 px per square, image is 500 px tall
  assert.ok(Math.abs(im.x + 0.5 * 400 * s - sp.ax) < 1e-9, 'horizontal anchor');
  assert.ok(Math.abs(im.y + 0.9 * 500 * s - sp.ay) < 1e-9, 'vertical anchor');
});

test('a render that fails to load keeps the drawn mini', () => {
  M.clearCache();
  const sp = M.sprite({ type: 'ogre', image: 'renders/missing.png' }, 80);
  flushImages();
  assert.strictEqual(sp.source, 'drawn');
});

test('the hit-flash silhouette is rebuilt when a sprite swaps to an image', () => {
  M.clearCache();
  const sp = M.sprite({ type: 'goblin', image: 'renders/goblin-ok.png' }, 64);
  const f1 = M.flash(sp);
  assert.ok(M.flash(sp) === f1, 'flash should be cached');
  flushImages();
  assert.ok(M.flash(sp) !== f1, 'flash should follow the new image');
});

// ---------- poses (minis 2.4.0) ----------
test('every pose renders whole and stays inside its sprite canvas', () => {
  const slack = 0.03;
  let n = 0;
  for (const t of CORE.list()) for (const pose of CORE.poses(t)) {
    const u = 64, sp = M.render(t, u, { pose }), rec = sp.cv.getContext('2d').rec;
    assert.strictEqual(sp.pose, pose, t + ' ' + pose + ' should say which pose it is');
    assert.ok(rec.fills >= 6, t + ' ' + pose + ' drew too little');
    assert.strictEqual(rec.bad, 0, t + ' ' + pose + ' produced a non-numeric coordinate');
    const minX = -sp.ax / u, maxX = (sp.cv.width - sp.ax) / u, minY = -sp.ay / u, maxY = (sp.cv.height - sp.ay) / u;
    for (const [x, y] of rec.pts) assert.ok(x >= minX + slack && x <= maxX - slack && y >= minY + slack && y <= maxY,
      t + ' ' + pose + ' reaches ' + x.toFixed(3) + ', ' + y.toFixed(3) + ' too near the edge of its canvas');
    n++;
  }
  assert.ok(n >= 100, 'expected the 2.4.0 poses, found ' + n);
});

test('a pose draws differently from the standing figure', () => {
  const pts = o => JSON.stringify(M.render('orc', 64, o).cv.getContext('2d').rec.pts);
  assert.notStrictEqual(pts({ pose: 'hurt' }), pts({}));
});

test('hasPose answers under either game\'s names, and only for poses the figure has', () => {
  assert.ok(M.hasPose('orc', 'hurt'));
  assert.ok(M.hasPose('goblinChief', 'strike') && M.hasPose('goblin.chief', 'strike'));
  assert.ok(M.hasPose('redDragon', 'breath'));
  assert.ok(!M.hasPose('orc', 'strike'));
  assert.ok(!M.hasPose('stoneColossus', 'hurt'), 'the colossus is too big to lean');
  assert.ok(!M.hasPose('orc', '') && !M.hasPose('orc', undefined));
});

test('posed sprites are cached apart; a missing pose gives the standing sprite', () => {
  M.clearCache();
  const stand = M.sprite('orc', 50), hurt = M.sprite('orc', 50, { pose: 'hurt' });
  assert.ok(hurt !== stand && hurt === M.sprite('orc', 50, { pose: 'hurt' }));
  assert.strictEqual(hurt.pose, 'hurt'); assert.strictEqual(stand.pose, null);
  assert.ok(M.sprite('orc', 50, { pose: 'strike' }) === stand, 'an orc has no strike pose');
  assert.ok(hurt.cv.width >= stand.cv.width && hurt.ax >= stand.ax && hurt.ay >= stand.ay, 'a posed sprite is the standing canvas plus a margin');
  const img = M.sprite({ type: 'orc', image: 'renders/orc-ok.png' }, 50), imgHurt = M.sprite({ type: 'orc', image: 'renders/orc-ok.png' }, 50, { pose: 'hurt' });
  assert.ok(img === imgHurt, 'an image has no poses');
  flushImages();
});

test('every hero has his figure and hers, found the way the game looks them up (2.5.0)', () => {
  for (const t of ['fighter', 'ranger', 'bard', 'wizard', 'cleric', 'rogue', 'barbarian', 'paladin', 'druid', 'monk', 'warlock', 'sorcerer', 'tinker']) {
    const root = (CORE.id(t) || t).replace(/\.m$/, '');
    assert.ok(M.has(root + '.f'), t + ': no ' + root + '.f');
    assert.strictEqual(M.figure(root + '.f').faction, 'hero', root + '.f stands on a hero base');
    assert.ok(CORE.poses(root + '.f').indexOf('hurt') >= 0, root + '.f has no hurt pose');
  }
  assert.strictEqual(M.figure('ranger.f').sculpt.face || 'right', 'right', 'her figure faces the monsters');
  assert.strictEqual(M.figure('ranger').sculpt.face, 'left', 'his still faces left, and the game turns him round');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
