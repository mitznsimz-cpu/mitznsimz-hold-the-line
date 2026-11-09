(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const PACK = HTL.PACK, ROUND = HTL.ROUND;
  const trayFor = party => party.concat(HTL.DEFENDER_TYPES); // the party, then the cheap defenders that are always to hand
  // what the tray holds: your monsters in Reverse, the bench in a puzzle, otherwise the party and the defenders
  const trayOrder = () => { const rv = HTL.battle(S).reverse; return rv ? rv.pool.concat(rv.boss ? [rv.boss] : []) : S.free ? Object.keys(S.free) : trayFor(S.loadout || HTL.HERO_TYPES); };
  let HERO_ORDER = trayFor(HTL.HERO_TYPES.slice(0, HTL.PARTY));
  // a hero stands as his figure or hers (minis 2.5.0 has both for every hero); the campaign remembers which
  let LOOKS = {};
  const herFigure = fig => { const root = (MitzMinis.id(fig) || fig).replace(/\.m$/, ''); return MitzMinis.has(root + '.f') ? root + '.f' : null; };
  const figType = type => { const fig = (PACK.heroes[type] && PACK.heroes[type].figure) || (PACK.monsters[type] && PACK.monsters[type].figure) || type; return LOOKS[type] === 'f' && PACK.heroes[type] && !PACK.heroes[type].figure ? herFigure(fig) || fig : fig; };
  // a hero sculpted facing left is turned to face the monsters on a board that runs left to right
  const canLook = type => !!(PACK.heroes[type] && !PACK.heroes[type].figure && herFigure(type));
  const facesLeft = type => { const f = TableMinis.figure(figType(type)); return !!(f && f.sculpt && f.sculpt.face === 'left'); };
  // a borrowed figure stands on a hero base; a figure the library doesn't have yet shows as the proxy, on its side's base
  const figOpts = type => (PACK.heroes[type] && PACK.heroes[type].figure) || !TableMinis.has(figType(type)) ? { faction: PACK.heroes[type] ? 'hero' : 'monster' } : undefined;
  const TICK = 0.05;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // table settings, one viewer's own: sound, motion, and every effect that can be switched off
  const SET_KEY = 'htl-settings-v1';
  const SET_DEFAULT = { sound: true, volume: 0.7, motion: reduceMotion ? 'reduced' : 'full', hitstop: true, tumble: true, bits: true, paws: true, torch: true, poses: true };
  const SET = (() => { try { return Object.assign({}, SET_DEFAULT, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) { return Object.assign({}, SET_DEFAULT); } })();
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) { /* not remembered: fine */ } }
  const calm = () => SET.motion === 'reduced';
  const motionLevel = () => (calm() ? 0.35 : 1);
  const SND = MitzSound.create({ enabled: SET.sound, volume: SET.volume });
  const sfx = (name, gain) => { if (SET.sound) SND.play(name, gain == null ? undefined : { gain }); };
  // what each mini is made of, for what flies off it when struck: the shared library says (minis 2.3 carries the map)
  const materialOf = type => (MitzMinis.material ? MitzMinis.material(figType(type)) : 'flesh');
  const matOf = sp => (sp.stone ? 'stone' : materialOf(sp.type));
  // how each one falls: constructs and the bony crumble, spirits drift up, oozes melt; the rest topple, and the cats tidy up
  const DEATH = { animatedArmour: 'crumble', ironSentinel: 'crumble', clayGolem: 'crumble', stoneColossus: 'crumble', gargoyle: 'crumble', skeleton: 'crumble', skelArcher: 'crumble', risen: 'crumble', boneTitan: 'crumble',
    barricade: 'crumble', ballista: 'crumble', font: 'crumble', wraith: 'drift', shadeWisp: 'drift', emberWisp: 'drift', shade: 'drift', gloom: 'melt', gelCube: 'melt' };
  const HIT_SOUND = { metal: 'clang', bone: 'crack', stone: 'crack', wood: 'crack', ooze: 'squish', spirit: 'whiff', ember: 'thud', flesh: 'thud' };
  const VERSION = '1.7.12'; // shown in the credits, so testers can say which version they were playing
  const UIF = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';

  const cv = $('board'), ctx = cv.getContext('2d');
  const tcv = $('track'), tctx = tcv.getContext('2d');

  let S = null, acc = 0, speed = 1, diceOn = true, paused = false, started = false, autoOn = false, lastAutoRound = -1;
  let selected = null, hover = null, lastTs = 0;
  const BOARD_PIXELS = 4.2e6;
  // How many board pixels this browser draws smoothly, learned in battle and remembered. Some browsers slow down in a big
  // window: when frames come slowly, the board is drawn a step softer (never below the screen's own 1x), and a smaller
  // window that fits the budget keeps full sharpness.
  const boardBudget = () => Math.min(BOARD_PIXELS, SET.boardPx > 0 ? SET.boardPx : BOARD_PIXELS);
  const pace = { last: 0, gaps: [], stepAt: 0, from: 0 };
  let coveredAt = 0, coveredFor = null; // when a menu last covered the board, and what was drawn under it
  const WON_KEY = 'mitzsimz.holdTheLine.won';
  function loadWon() { try { const v = JSON.parse(localStorage.getItem(WON_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  let L = null, boardCache = null, V = null;
  const SPR = {}, SPRW = {}, SPRS = new Map(); // sprites, their white hit-flash silhouettes, and shaded copies for dark battles
  const PASS_FLOOR = '.~^+DH=G'; // squares a barrel rolls along
  const SPRP = new Map(); // posed sprites (minis 2.4.0), by type|pose: { sp, white }, or null when the figure has no such pose
  const SPRL = new Set(); // heroes whose figure is sculpted facing left: turned round on a left-to-right board
  const turned = sp => L.horiz && sp.form !== 'bear' && SPRL.has(sp.type);

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);
  const easeIn = t => t * t;
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clock = () => (S ? S.time + acc : 0);

  function resetView() {
    V = { sprites: new Map(), fx: [], pops: [], coins: [], impacts: [], scorch: [], tavern: [], bad: [],
      shake: null, fireballAt: {}, bounty: {}, hitAt: {}, swing: {}, seen: new Set(), pawTurn: 0, now: 0, feats: freshFeats(), recorded: false, result: null };
  }

  /* ---------- layout and board mapping ---------- */
  function currentMap() { return S ? HTL.mapOf(S) : HTL.MAPS.classic; }
  function layout() {
    const wrap = $('boardWrap');
    const W = Math.max(1, wrap.clientWidth), H = Math.max(1, wrap.clientHeight);
    // the board's pixels have a budget: past about four million, a big screen gains little sharpness and every frame pays
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(boardBudget() / (W * H))));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const M = currentMap(), MW = M.w, MH = M.h; // squares along a row, and rows
    const horiz = W > H * 1.15;
    const TAV = 0.7, TOP = 0.55, PAD = 0.12;
    let cell, ox, oy;
    if (horiz) {
      cell = Math.floor(Math.min(W / (TAV + MW + PAD * 2), H / (MH + TOP + PAD)));
      ox = Math.round((W - (TAV + MW) * cell) / 2);
      oy = Math.round((H - MH * cell) / 2 + TOP * cell / 2);
    } else {
      cell = Math.floor(Math.min(W / (MH + PAD * 2), H / (TOP + MW + TAV + PAD)));
      ox = Math.round((W - MH * cell) / 2);
      oy = Math.round((H - (MW + TAV) * cell) / 2 + TOP * cell / 2);
    }
    cell = Math.max(cell, 12);
    L = { W, H, dpr, horiz, cell, ox, oy, TAV, MW, MH, map: M, pillars: [], dark: isDark() };
    // two torches on the tavern wall light the mat and throw the minis' shadows away from the tavern
    L.torches = horiz ? [0.22, 0.78].map(f => ({ x: ox + TAV * cell, y: oy + MH * cell * f })) : [0.22, 0.78].map(f => ({ x: ox + MH * cell * f, y: oy + MW * cell }));
    for (let l = 0; l < MH; l++) for (let q = 0; q < MW; q++) if (M.rows[l][q] === '#') L.pillars.push({ lane: l, sq: q });
    buildBoard();
    buildSprites();
    PILLAR = renderPillar(L.cell * L.dpr);
    coveredFor = null; // redraw the board, even under a menu
    warmSprites();
  }
  // this battle's heroes and monsters, drawn when the board is laid out rather than mid-fight; anything else (a summons,
  // a monster the Reverse player sends) is drawn the first time it's needed
  function warmSprites() {
    if (!S) return;
    const types = new Set(HERO_ORDER);
    const waves = JSON.stringify(HTL.battle(S).waves || []), re = /([A-Za-z]+):/g; let m;
    while ((m = re.exec(waves))) if (PACK.monsters[m[1]]) types.add(m[1]);
    for (const t of types) if (PACK.heroes[t] || PACK.monsters[t]) { spr(t); sprW(t); }
  }
  function gpos(lane, sq) {
    const c = L.cell;
    if (L.horiz) return { x: L.ox + L.TAV * c + (sq + 0.5) * c, y: L.oy + (lane + 0.5) * c };
    return { x: L.ox + (lane + 0.5) * c, y: L.oy + (L.MW - 1 - sq + 0.5) * c };
  }
  function laneVec(sign) { // screen direction along a lane; sign +1 points toward the dungeon
    return L.horiz ? { x: sign, y: 0, lean: sign } : { x: 0, y: -sign, lean: 0 };
  }
  function squareAt(px, py) {
    const c = L.cell; let lane, sq;
    if (L.horiz) { lane = Math.floor((py - L.oy) / c); sq = Math.floor((px - L.ox - L.TAV * c) / c); }
    else { lane = Math.floor((px - L.ox) / c); sq = L.MW - 1 - Math.floor((py - L.oy) / c); }
    if (lane < 0 || lane >= L.MH || sq < 0 || sq >= L.MW) return null;
    return { lane, sq };
  }
  function matRect() { const c = L.cell; return L.horiz ? { x: L.ox + L.TAV * c, y: L.oy, w: L.MW * c, h: L.MH * c } : { x: L.ox, y: L.oy, w: L.MH * c, h: L.MW * c }; }
  function tavRect() { const c = L.cell; return L.horiz ? { x: L.ox, y: L.oy, w: L.TAV * c, h: L.MH * c } : { x: L.ox, y: L.oy + L.MW * c, w: L.MH * c, h: L.TAV * c }; }
  // a corner of the grid: lb counts row edges from the top row, qb counts square edges from the tavern
  function corner(lb, qb) { const c = L.cell; return L.horiz ? { x: L.ox + (L.TAV + qb) * c, y: L.oy + lb * c } : { x: L.ox + lb * c, y: L.oy + (L.MW - qb) * c }; }
  function cellAt(lane, sq) { const m = L.map; return lane >= 0 && lane < m.h && sq >= 0 && sq < m.w ? m.rows[lane][sq] : ' '; }
  const inMap = ([lane, sq]) => lane >= 0 && lane < L.MH && sq >= 0 && sq < L.MW;
  const LEDGE = 0.12; // how far a raised ledge lifts what stands on it, in squares
  // the square on each side of a square as it appears on screen
  function screenNear(lane, sq) {
    return L.horiz ? { up: [lane - 1, sq], down: [lane + 1, sq], left: [lane, sq - 1], right: [lane, sq + 1] }
                   : { up: [lane, sq + 1], down: [lane, sq - 1], left: [lane - 1, sq], right: [lane + 1, sq] };
  }
  function sqRect(lane, sq) { const p = gpos(lane, sq), c = L.cell; return { x: p.x - c / 2, y: p.y - c / 2, w: c, h: c }; }
  function rrPath(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- the table, the mat, the dungeon threshold, the tavern wall ---------- */
  function buildBoard() {
    const b = boardCache = document.createElement('canvas');
    b.width = cv.width; b.height = cv.height;
    const g = b.getContext('2d'); g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    const c = L.cell, W = L.W, H = L.H, r = mulberry(11);

    // walnut planks
    const pw = Math.max(46, c * 1.25), woods = ['#211712', '#1c130f', '#24190f', '#1f1511', '#22170f'];
    for (let y = -r() * pw; y < H; y += pw) {
      g.fillStyle = woods[Math.floor(r() * woods.length)]; g.fillRect(0, y, W, pw);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, y, W, 1);
      g.strokeStyle = 'rgba(255,225,190,.035)'; g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const gy = y + r() * pw; g.beginPath(); g.moveTo(0, gy);
        g.bezierCurveTo(W * .3, gy + (r() - .5) * 6, W * .7, gy + (r() - .5) * 6, W, gy + (r() - .5) * 4); g.stroke();
      }
    }

    // vinyl battle mat
    const m = matRect(), mg = c * 0.1;
    g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = c * 0.4; g.shadowOffsetY = c * 0.06;
    rrPath(g, m.x - mg, m.y - mg, m.w + mg * 2, m.h + mg * 2, c * 0.12); g.fillStyle = '#4c5c54'; g.fill(); g.restore();
    const mgrad = g.createRadialGradient(m.x + m.w / 2, m.y + m.h / 2, c, m.x + m.w / 2, m.y + m.h / 2, Math.max(m.w, m.h) * 0.75);
    mgrad.addColorStop(0, 'rgba(255,255,240,.06)'); mgrad.addColorStop(1, 'rgba(0,0,0,.12)');
    rrPath(g, m.x - mg, m.y - mg, m.w + mg * 2, m.h + mg * 2, c * 0.12); g.fillStyle = mgrad; g.fill();
    for (let i = 0; i < (m.w * m.h) / 90; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)';
      g.fillRect(m.x + r() * m.w, m.y + r() * m.h, 1, 1);
    }

    // terrain, square by square. Water and holy ground are wet-erase pen on the vinyl mat; doors are flagstones;
    // ledges, rock and pillars are unpainted resin terrain pieces, like the minis (pillars stand up, so they are drawn with them)
    const M = L.map, near = (l, q, side) => { const n = screenNear(l, q)[side]; return cellAt(n[0], n[1]); };
    const flat = ch => ch !== ' ' && ch !== 'o' && ch !== '*';
    const stone = (x0, y0, inset, cols, light) => {
      const stones = [[0, 0, .55, .45], [.55, 0, .45, .45], [0, .45, .38, .55], [.38, .45, .62, .55]];
      for (const s of stones) {
        const x = x0 + s[0] * c + c * inset, y = y0 + s[1] * c + c * inset, w = s[2] * c - c * inset * 2, h = s[3] * c - c * inset * 2;
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        rrPath(g, x, y, w, h, c * 0.04); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + light + ')'; g.fillRect(x + 2, y + 1, w - 4, Math.max(1, c * 0.02));
      }
    };
    for (let l = 0; l < M.h; l++) for (let q = 0; q < M.w; q++) {
      const ch = M.rows[l][q], s = sqRect(l, q);
      if (ch === 'D') { // dungeon threshold: flagstones, darkening toward the dark beyond the door
        g.fillStyle = '#1f1d1c'; g.fillRect(s.x, s.y, s.w, s.h);
        stone(s.x, s.y, 0.035, ['#3b3734', '#35312e', '#403b37', '#383431'], 0.05);
        const dg = L.horiz ? g.createLinearGradient(s.x + c, 0, s.x, 0) : g.createLinearGradient(0, s.y, 0, s.y + c);
        dg.addColorStop(0, 'rgba(8,6,5,.7)'); dg.addColorStop(1, 'rgba(8,6,5,0)');
        g.fillStyle = dg; g.fillRect(s.x, s.y, s.w, s.h);
      } else if (ch === ' ') { // solid rock: rough dark blocks, running out over the edge of the mat
        const ex = mg + 1, grow = side => cellAt(screenNear(l, q)[side][0], screenNear(l, q)[side][1]) === ' ' && !inMap(screenNear(l, q)[side]);
        const x = s.x - (grow('left') ? ex : 0), y = s.y - (grow('up') ? ex : 0);
        const w = s.x + s.w + (grow('right') ? ex : 0) - x, h = s.y + s.h + (grow('down') ? ex : 0) - y;
        g.fillStyle = '#120f0d'; g.fillRect(x, y, w, h);
        // rough boulders, not cut stone: lumpy shapes lit from the top left
        const lumps = [[.27, .3, .25], [.72, .26, .24], [.3, .74, .26], [.74, .72, .25], [.5, .5, .17]];
        for (const [fx, fy, fr] of lumps) {
          const cx = x + fx * w, cy = y + fy * h, rr = fr * c, n = 7, pts = [];
          for (let k = 0; k < n; k++) { const a = k / n * TAU + r() * 0.5, d = rr * (0.78 + r() * 0.3); pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85]); }
          g.beginPath(); pts.forEach((pt, i) => i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1])); g.closePath();
          const lg = g.createLinearGradient(cx - rr, cy - rr, cx + rr, cy + rr);
          lg.addColorStop(0, '#4a4540'); lg.addColorStop(1, '#221e1b');
          g.fillStyle = lg; g.fill();
          g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = Math.max(1, c * 0.02); g.stroke();
        }
      } else if (ch === '~') { // water: a blue wash and ripples, continuous across neighbouring water
        g.fillStyle = 'rgba(58,104,130,.45)'; g.fillRect(s.x, s.y, s.w, s.h);
        g.save(); g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip();
        g.strokeStyle = 'rgba(126,186,224,.5)'; g.lineWidth = Math.max(1.2, c * 0.028); g.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const y0 = s.y + (i + 0.5) * s.h / 4, ph = i * 1.7 + (L.horiz ? 0 : l * 0.9);
          g.beginPath();
          for (let x = s.x - 3, first = true; x <= s.x + s.w + 3; x += 3, first = false) {
            const yy = y0 + Math.sin(x / c * TAU + ph) * c * 0.035;
            if (first) g.moveTo(x, yy); else g.lineTo(x, yy);
          }
          g.stroke();
        }
        g.restore();
      } else if (ch === 'o') { // a hole in the floor: black, with its far wall showing
        g.fillStyle = '#090706'; g.fillRect(s.x, s.y, s.w, s.h);
        if (near(l, q, 'up') !== 'o') {
          const wall = g.createLinearGradient(0, s.y, 0, s.y + c * 0.42);
          wall.addColorStop(0, '#45403b'); wall.addColorStop(1, 'rgba(9,7,6,0)');
          g.fillStyle = wall; g.fillRect(s.x, s.y, s.w, c * 0.42);
          g.fillStyle = '#5a554f';
          for (let x = s.x; x < s.x + s.w; x += c * 0.12) g.fillRect(x, s.y, c * 0.12 - 1, Math.max(1.5, c * (0.03 + r() * 0.03)));
        }
        g.fillStyle = 'rgba(160,150,138,.35)';
        if (near(l, q, 'down') !== 'o') g.fillRect(s.x, s.y + s.h - Math.max(1.5, c * 0.03), s.w, Math.max(1.5, c * 0.03));
        if (near(l, q, 'left') !== 'o') g.fillRect(s.x, s.y, Math.max(1, c * 0.02), s.h);
        if (near(l, q, 'right') !== 'o') g.fillRect(s.x + s.w - Math.max(1, c * 0.02), s.y, Math.max(1, c * 0.02), s.h);
      } else if (ch === '@') { // the well: a ring of stones round dark water, a little light on the far side
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2, R = c * 0.42;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(cx + c * 0.03, cy + c * 0.05, R, 0, TAU); g.fill();
        for (let k = 0; k < 12; k++) { // the stones of the rim
          const a0 = k / 12 * TAU, a1 = (k + 0.92) / 12 * TAU;
          g.fillStyle = ['#6e6a64', '#5f5b56', '#77736c'][k % 3];
          g.beginPath(); g.arc(cx, cy, R, a0, a1); g.arc(cx, cy, R * 0.68, a1, a0, true); g.closePath(); g.fill();
        }
        const wg = g.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, R * 0.68);
        wg.addColorStop(0, '#1d3a4a'); wg.addColorStop(1, '#05090c');
        g.fillStyle = wg; g.beginPath(); g.arc(cx, cy, R * 0.66, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(126,186,224,.35)'; g.lineWidth = Math.max(1, c * 0.02);
        g.beginPath(); g.arc(cx + R * 0.1, cy + R * 0.12, R * 0.3, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
      } else if (ch === 'H' && M.skylights) { // a skylight: four dusty panes in a dark frame, let into the floor of the attic
        const pad = c * 0.1, x = s.x + pad, y = s.y + pad, w = s.w - pad * 2, h = s.h - pad * 2;
        g.fillStyle = '#2b2520'; g.fillRect(x - c * 0.03, y - c * 0.03, w + c * 0.06, h + c * 0.06);
        for (let k = 0; k < 4; k++) {
          const px = x + (k % 2) * w / 2 + c * 0.02, py = y + Math.floor(k / 2) * h / 2 + c * 0.02, pw = w / 2 - c * 0.04, ph = h / 2 - c * 0.04;
          const pg = g.createLinearGradient(px, py, px + pw, py + ph);
          pg.addColorStop(0, 'rgba(150,170,180,.55)'); pg.addColorStop(1, 'rgba(70,84,92,.55)');
          g.fillStyle = pg; g.fillRect(px, py, pw, ph);
        }
        g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + c * 0.05, y + c * 0.05, w * 0.18, Math.max(1, c * 0.02));
      } else if (ch === 'H' && M.lawn) { // a molehill: a mound of turned earth, crumbs scattered round it
        const cx = s.x + s.w / 2, cy = s.y + s.h * 0.55, rx = c * 0.32, ry = c * 0.22;
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(cx + c * 0.02, cy + c * 0.05, rx, ry, 0, 0, TAU); g.fill();
        const mg2 = g.createRadialGradient(cx - rx * 0.35, cy - ry * 0.6, ry * 0.1, cx, cy, rx);
        mg2.addColorStop(0, '#7a6450'); mg2.addColorStop(0.6, '#4d3d2f'); mg2.addColorStop(1, '#2c231b');
        g.fillStyle = mg2; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
        g.fillStyle = '#5d4b3a';
        for (let k = 0; k < 9; k++) { const a = r() * TAU, d = rx * (1.05 + r() * 0.35); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, c * (0.015 + r() * 0.02), 0, TAU); g.fill(); }
      } else if (ch === '%') { // a low box hedge: flocked terrain, running on into the next hedge square
        const pad = c * 0.07, joins = side => near(l, q, side) === '%';
        const x = s.x + (joins('left') ? 0 : pad), y = s.y + (joins('up') ? 0 : pad);
        const w = s.x + s.w - (joins('right') ? 0 : pad) - x, h = s.y + s.h - (joins('down') ? 0 : pad) - y;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + c * 0.03, y + c * 0.06, w, h); // its shadow on the mat
        g.fillStyle = '#25361f'; g.fillRect(x, y, w, h);
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        for (let k = 0; k < 64; k++) { // overlapping leafy clumps, lit from the top left
          const cx = x + r() * w, cy = y + r() * h, rr = c * (0.055 + r() * 0.05);
          const lg = g.createRadialGradient(cx - rr * 0.4, cy - rr * 0.4, rr * 0.1, cx, cy, rr);
          lg.addColorStop(0, '#62804b'); lg.addColorStop(1, '#22351d');
          g.fillStyle = lg; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
        }
        g.restore();
        if (!joins('up')) { g.fillStyle = 'rgba(170,200,130,.35)'; g.fillRect(x, y, w, Math.max(1, c * 0.03)); }
        if (!joins('down')) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, y + h - Math.max(1, c * 0.04), w, Math.max(1, c * 0.04)); }
      } else if (ch === 'H') { // a trapdoor: old planks set in the floor, an iron ring to lift it by
        const pad = c * 0.1, x = s.x + pad, y = s.y + pad, w = s.w - pad * 2, h = s.h - pad * 2;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
        const n = 4;
        for (let k = 0; k < n; k++) {
          g.fillStyle = ['#6e5440', '#654c39', '#735843', '#5f4835'][k];
          if (L.horiz) g.fillRect(x, y + k * h / n + 0.5, w, h / n - 1); else g.fillRect(x + k * w / n + 0.5, y, w / n - 1, h);
        }
        g.fillStyle = '#3d3a37'; // two iron straps
        if (L.horiz) { g.fillRect(x + w * 0.18, y, Math.max(2, c * 0.05), h); g.fillRect(x + w * 0.78, y, Math.max(2, c * 0.05), h); }
        else { g.fillRect(x, y + h * 0.18, w, Math.max(2, c * 0.05)); g.fillRect(x, y + h * 0.78, w, Math.max(2, c * 0.05)); }
        g.strokeStyle = '#2c2a28'; g.lineWidth = Math.max(1.5, c * 0.035);
        g.beginPath(); g.arc(s.x + s.w / 2, s.y + s.h / 2, c * 0.1, 0, TAU); g.stroke();
      } else if (ch === '*') { // an oven: a brick block in the wall, its mouth glowing toward the floor
        g.fillStyle = '#2a1c16'; g.fillRect(s.x, s.y, s.w, s.h);
        for (let row = 0; row < 4; row++) for (let k = 0; k < 3; k++) {
          const bw = s.w / 3, bh = s.h / 4, off = row % 2 ? bw / 2 : 0, bx = s.x + k * bw + off - (off ? bw : 0) * (k === 2 ? 0 : 0);
          g.fillStyle = ['#6b3a2a', '#5e3326', '#73412f'][(row + k) % 3];
          g.fillRect(Math.max(s.x, bx) + 1, s.y + row * bh + 1, Math.min(bw, s.x + s.w - bx) - 2, bh - 2);
        }
        for (const side of ['up', 'down', 'left', 'right']) {
          const n2 = screenNear(l, q)[side]; if (!inMap(n2) || !flat(cellAt(n2[0], n2[1]))) continue;
          const mx = side === 'left' ? s.x : side === 'right' ? s.x + s.w * 0.7 : s.x + s.w * 0.2, my = side === 'up' ? s.y : side === 'down' ? s.y + s.h * 0.7 : s.y + s.h * 0.2;
          const mw = side === 'left' || side === 'right' ? s.w * 0.3 : s.w * 0.6, mh = side === 'up' || side === 'down' ? s.h * 0.3 : s.h * 0.6;
          g.fillStyle = '#140c08'; g.fillRect(mx, my, mw, mh);
          const fg = g.createRadialGradient(mx + mw / 2, my + mh / 2, 0, mx + mw / 2, my + mh / 2, Math.max(mw, mh) * 0.7);
          fg.addColorStop(0, 'rgba(255,150,60,.75)'); fg.addColorStop(1, 'rgba(255,90,30,0)');
          g.fillStyle = fg; g.fillRect(mx, my, mw, mh);
        }
      } else if (ch === '=') { // ice: a pale sheen, with cracks
        g.fillStyle = 'rgba(200,228,242,.42)'; g.fillRect(s.x, s.y, s.w, s.h);
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1, c * 0.018);
        g.beginPath(); g.moveTo(s.x + s.w * 0.15, s.y + s.h * (0.3 + r() * 0.3)); g.lineTo(s.x + s.w * 0.5, s.y + s.h * (0.4 + r() * 0.2)); g.lineTo(s.x + s.w * 0.85, s.y + s.h * (0.2 + r() * 0.5)); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(s.x + s.w * 0.12, s.y + s.h * 0.12, s.w * 0.3, Math.max(1, c * 0.03));
      } else if (ch === 'G') { // the yard gate's posts, either side of the way through
        g.fillStyle = 'rgba(120,90,60,.25)'; g.fillRect(s.x, s.y, s.w, s.h);
      } else if (ch === '+') { // holy ground: a gold sun in wet-erase pen, a little glow
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rr = c * 0.36;
        const gl = g.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.3);
        gl.addColorStop(0, 'rgba(240,205,110,.24)'); gl.addColorStop(1, 'rgba(240,205,110,0)');
        g.fillStyle = gl; g.fillRect(s.x, s.y, s.w, s.h);
        g.strokeStyle = 'rgba(240,205,110,.78)'; g.lineWidth = Math.max(1.2, c * 0.028); g.lineCap = 'round';
        g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.93, 0.2, 0, TAU); g.stroke();
        g.beginPath(); g.arc(cx, cy, rr * 0.28, 0, TAU); g.stroke();
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = k * TAU / 8 + 0.2, r1 = rr * 0.42, r2 = rr * (k % 2 ? 0.62 : 0.8);
          g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        }
        g.stroke();
      }
    }

    // barrel chutes: two worn rails along the row, from the far end to the tavern
    if (M.chutes) for (const ln of M.chutes.lanes) {
      g.strokeStyle = 'rgba(150,112,72,.55)'; g.lineWidth = Math.max(1.5, c * 0.03);
      for (let q = 0; q < M.w; q++) {
        if (PASS_FLOOR.indexOf(M.rows[ln][q]) < 0) continue;
        const sq = sqRect(ln, q);
        g.beginPath();
        if (L.horiz) { for (const f of [0.3, 0.7]) { g.moveTo(sq.x, sq.y + sq.h * f); g.lineTo(sq.x + sq.w, sq.y + sq.h * f); } }
        else { for (const f of [0.3, 0.7]) { g.moveTo(sq.x + sq.w * f, sq.y); g.lineTo(sq.x + sq.w * f, sq.y + sq.h); } }
        g.stroke();
      }
    }
    // grid: every edge once, wherever there is floor on either side
    g.strokeStyle = 'rgba(230,238,226,.2)'; g.lineWidth = Math.max(1, c * 0.016);
    g.beginPath();
    for (let lb = 0; lb <= M.h; lb++) for (let q = 0; q < M.w; q++) {
      if (!flat(cellAt(lb - 1, q)) && !flat(cellAt(lb, q))) continue;
      const a = corner(lb, q), b = corner(lb, q + 1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    for (let qb = 0; qb <= M.w; qb++) for (let l = 0; l < M.h; l++) {
      if (!flat(cellAt(l, qb - 1)) && !flat(cellAt(l, qb))) continue;
      const a = corner(l, qb), b = corner(l + 1, qb); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    g.stroke();

    // raised ledges sit on top of the grid: a resin slab, its top a little higher than the mat
    const ledges = [];
    for (let l = 0; l < M.h; l++) for (let q = 0; q < M.w; q++) if (M.rows[l][q] === '^') ledges.push(sqRect(l, q));
    ledges.sort((a, b) => a.y - b.y);
    for (const s of ledges) {
      const lip = c * LEDGE;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(s.x + c * 0.06, s.y + s.h - lip * 0.2, s.w, lip * 0.6);
      const wood = !!M.skylights; // in the attic the raised squares are rafters: a beam of old oak, not a slab of stone
      g.fillStyle = wood ? '#4a3424' : '#625f5a'; g.fillRect(s.x + 1, s.y + s.h - lip, s.w - 2, lip);
      const top = g.createLinearGradient(s.x, s.y - lip, s.x + s.w, s.y + s.h - lip);
      top.addColorStop(0, wood ? '#8a6648' : '#9b978f'); top.addColorStop(1, wood ? '#6a4c35' : '#7d7973');
      g.fillStyle = top; g.fillRect(s.x + 1, s.y - lip + 1, s.w - 2, s.h - 1);
      g.strokeStyle = wood ? 'rgba(40,24,14,.45)' : 'rgba(40,36,32,.55)'; g.lineWidth = Math.max(1, c * 0.016);
      g.beginPath();
      if (wood) for (let k = 1; k < 5; k++) { const yy = s.y - lip + s.h * k / 5; g.moveTo(s.x + s.w * 0.06, yy + (k % 2 ? 1 : -1)); g.lineTo(s.x + s.w * 0.94, yy); } // the grain
      else { // a few cracks so it reads as stone
        g.moveTo(s.x + s.w * 0.18, s.y - lip + s.h * 0.3); g.lineTo(s.x + s.w * 0.42, s.y - lip + s.h * 0.42); g.lineTo(s.x + s.w * 0.5, s.y - lip + s.h * 0.7);
        g.moveTo(s.x + s.w * 0.7, s.y - lip + s.h * 0.15); g.lineTo(s.x + s.w * 0.78, s.y - lip + s.h * 0.4);
      }
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(s.x + 1, s.y - lip + 1, s.w - 2, Math.max(1, c * 0.02));
      g.strokeStyle = 'rgba(25,22,20,.7)'; g.strokeRect(s.x + 1.5, s.y - lip + 1.5, s.w - 3, s.h + lip - 3);
    }

    // tavern wall
    const t = tavRect();
    g.fillStyle = '#5b3e2a'; g.fillRect(t.x, t.y, t.w, t.h);
    g.strokeStyle = 'rgba(25,14,8,.55)'; g.lineWidth = Math.max(1, c * 0.02);
    const plank = c * 0.34;
    g.beginPath();
    if (L.horiz) for (let y = t.y + plank; y < t.y + t.h; y += plank) { g.moveTo(t.x, y); g.lineTo(t.x + t.w, y); }
    else for (let x = t.x + plank; x < t.x + t.w; x += plank) { g.moveTo(x, t.y); g.lineTo(x, t.y + t.h); }
    g.stroke();
    g.fillStyle = '#3a2618';
    if (L.horiz) g.fillRect(t.x + t.w - c * 0.12, t.y - c * 0.1, c * 0.12, t.h + c * 0.2);
    else g.fillRect(t.x - c * 0.1, t.y, t.w + c * 0.2, c * 0.12);
    const sh = L.horiz ? g.createLinearGradient(t.x + t.w, 0, t.x + t.w + c * 0.3, 0) : g.createLinearGradient(0, t.y, 0, t.y - c * 0.3);
    sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    if (L.horiz) g.fillRect(t.x + t.w, t.y, c * 0.3, t.h); else g.fillRect(t.x, t.y - c * 0.3, t.w, c * 0.3);
    // hanging sign
    g.save();
    const fs = Math.max(8, Math.round(c * 0.17));
    g.translate(t.x + t.w / 2 + (L.horiz ? -c * 0.04 : 0), t.y + t.h / 2 + (L.horiz ? 0 : c * 0.04));
    if (L.horiz) g.rotate(-Math.PI / 2);
    g.font = '700 ' + fs + 'px ' + UIF;
    const label = 'THE CAT & MOUSE', tw = g.measureText(label).width + fs * 1.4;
    rrPath(g, -tw / 2, -fs * 0.85, tw, fs * 1.7, fs * 0.3); g.fillStyle = '#2a1a10'; g.fill();
    g.lineWidth = 1; g.strokeStyle = '#d4a537'; g.stroke();
    g.fillStyle = '#e8c66a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, fs * 0.06);
    g.restore();
    // a dark battle: the floor darkens away from the tavern's torches, once, here; the minis are shaded as they're drawn
    if (L.dark) {
      const m = matRect(), gr = L.horiz ? g.createLinearGradient(m.x, 0, m.x + m.w, 0) : g.createLinearGradient(0, m.y + m.h, 0, m.y);
      DARK_STOPS.forEach(([f, a]) => gr.addColorStop(f, 'rgba(8,6,14,' + a + ')'));
      g.fillStyle = gr; g.fillRect(m.x, m.y, m.w, m.h);
    }
  }
  const DARK_STOPS = [[0, 0], [0.16, 0.06], [0.45, 0.42], [1, 0.6]]; // shade by how far across the mat from the tavern
  function isDark() { return !!(SET.torch && S && HTL.battle(S).dark); }

  /* ---------- pillars: unpainted resin columns, drawn in among the minis so they hide what stands behind them ---------- */
  let PILLAR = null;
  function renderPillar(u) {
    const W = Math.ceil(u * 1.0), H = Math.ceil(u * 1.95), cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), cx = W / 2, sq = TableMinis.VIEWS.tabletop, lw = Math.max(1, u * 0.018), ol = 'rgba(30,28,26,.85)';
    const base = H - u * 0.04, pw = u * 0.84, ph = u * 0.13, pd = pw * sq;
    const block = (x, y, w, h, d, front, top) => { // a square block seen from the table: front face and top face
      g.fillStyle = front; g.fillRect(x, y, w, h);
      g.fillStyle = top; g.fillRect(x, y - d, w, d);
      g.strokeStyle = ol; g.lineWidth = lw; g.strokeRect(x, y - d, w, d + h);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke();
    };
    block(cx - pw / 2, base - ph, pw, ph, pd, '#6c6862', '#a29e96');
    const sw = u * 0.48, sBot = base - ph - pd * 0.5, sTop = sBot - u * 1.12, er = sw / 2 * sq;
    const sh = g.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    sh.addColorStop(0, '#9d9991'); sh.addColorStop(0.28, '#c3bfb7'); sh.addColorStop(0.62, '#8e8a83'); sh.addColorStop(1, '#5a5751');
    g.fillStyle = sh;
    g.beginPath(); g.moveTo(cx - sw / 2, sTop); g.lineTo(cx - sw / 2, sBot); g.ellipse(cx, sBot, sw / 2, er, 0, Math.PI, 0, true); g.lineTo(cx + sw / 2, sTop); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,37,34,.32)'; g.lineWidth = Math.max(1, u * 0.014);
    for (const f of [-0.3, -0.1, 0.1, 0.3]) { const x = cx + f * sw; g.beginPath(); g.moveTo(x, sTop + u * 0.02); g.lineTo(x, sBot + er * Math.sqrt(1 - (f * 2) * (f * 2)) - u * 0.02); g.stroke(); }
    g.strokeStyle = ol; g.lineWidth = lw;
    g.beginPath(); g.moveTo(cx - sw / 2, sTop); g.lineTo(cx - sw / 2, sBot); g.ellipse(cx, sBot, sw / 2, er, 0, Math.PI, 0, true); g.lineTo(cx + sw / 2, sTop); g.stroke();
    g.strokeStyle = 'rgba(30,28,26,.45)'; g.beginPath(); g.moveTo(cx + sw * 0.12, sTop + u * 0.35); g.lineTo(cx + sw * 0.2, sTop + u * 0.5); g.lineTo(cx + sw * 0.14, sTop + u * 0.62); g.stroke(); // a chip
    const cw = u * 0.64, chh = u * 0.12;
    block(cx - cw / 2, sTop - chh, cw, chh, cw * sq, '#77736c', '#b6b2aa');
    return { cv, ax: cx, ay: base - ph - pd * 0.5 };
  }
  function drawPillar(st, list) {
    const s = PILLAR, k = 1 / L.dpr, c = L.cell;
    let alpha = 1; // see-through while a mini stands behind it
    for (const o of list) if (!o.pillar && o.alpha > 0.3 && o.gy < st.gy - c * 0.2 && o.gy > st.gy - c * 1.7 && Math.abs(o.gx - st.gx) < c * 0.6) { alpha = 0.5; break; }
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(st.gx + c * 0.04, st.gy + c * 0.12, c * 0.48, c * 0.2, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.drawImage(s.cv, st.gx - s.ax * k, st.gy - s.ay * k, s.cv.width * k, s.cv.height * k);
    ctx.globalAlpha = 1;
  }
  const TERRAIN = {
    '#': ['Pillar', 'Nothing can stand on a pillar, and nobody can shoot past one, heroes or monsters.'],
    '~': ['Water', 'Walkers wade at half speed, so most of them go round. Heroes can stand in it.'],
    '^': ['Raised ledge', 'A hero standing up here gets +2 to hit.'],
    '+': ['Holy ground', 'Undead that start a turn here take 2 radiant damage.'],
    'o': ['Chasm', 'Walkers have to go round. Flyers go straight over. Nobody can stand in it.'],
    'D': ['Door', 'Monsters come in here. Heroes can’t stand in a doorway.'],
    'H': ['Trapdoor', 'Floor you can stand on, until a monster comes up through it. Then it’s a door, and whoever stood on it is thrown aside and loses a turn.'],
    '*': ['Oven', 'Every few rounds it flares and burns whatever stands on the squares in front of it, heroes and monsters alike. It glows the round before.'],
    '=': ['Ice', 'Walkers slide across it twice as fast. No hero can stand on it.'],
    'G': ['The yard gate', 'Drop it once a battle and it shuts this way through for a few rounds: everything goes round the other way.'],
    '%': ['Box hedge', 'Walkers have to go round. Flyers go straight over. Nobody can stand in it, but everyone can see across it.'],
    '@': ['The well', 'Monsters climb out of it, right in the middle of the floor. Nobody can stand on it.']
  };
  const MOLEHILL = ['Molehill', 'Lawn you can stand on, until something comes up through it. Then it’s a way in, and whoever stood on it is thrown aside and loses a turn.'];
  const SKYLIGHT = ['Skylight', 'Floor you can stand on, until something breaks in through it from the roof. Then it’s a way in, whoever stood on it is thrown aside, and daylight falls on it and the squares round it: anything undead there burns, and can’t heal.'];
  const RAFTER = ['Rafter', 'A hero up on a beam gets +2 to hit.'];
  const tipOf = ch => (ch === 'H' && L.map.lawn ? MOLEHILL : ch === 'H' && L.map.skylights ? SKYLIGHT : ch === '^' && L.map.skylights ? RAFTER : TERRAIN[ch]);

  /* ---------- minis come from the shared library, through Hold the Line’s TableMinis adapter ---------- */
  // Minis are drawn into sprites at the board's size when first needed, not all 80-odd at once: on a big screen the
  // full set came to hundreds of megabytes of canvas, which a browser can be slow to juggle.
  let SPRU = 0;
  function buildSprites() {
    TableMinis.clearCache(); SPRS.clear(); SPRP.clear(); SPRL.clear();
    for (const k in SPR) delete SPR[k];
    for (const k in SPRW) delete SPRW[k];
    for (const t of Object.keys(PACK.heroes)) if (facesLeft(t)) SPRL.add(t);
    SPRU = L.cell * L.dpr;
  }
  function spr(type) {
    return SPR[type] || (SPR[type] = type === '__bear' ? TableMinis.sprite('caveBear', SPRU, { faction: 'hero' }) : TableMinis.sprite(figType(type), SPRU, figOpts(type)));
  }
  function sprW(type) { return SPRW[type] || (SPRW[type] = TableMinis.flash(spr(type))); }

  // a sprite in the dark, baked once per shade step, so a shaded mini costs one draw like any other
  const SHADE_STEP = 0.12;
  function shaded(key, sp, level) {
    const id = key + '|' + level;
    let c = SPRS.get(id);
    if (!c) {
      c = document.createElement('canvas'); c.width = sp.cv.width; c.height = sp.cv.height;
      const g = c.getContext('2d');
      g.drawImage(sp.cv, 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, level * SHADE_STEP); // darken the mini's own pixels only
      g.fillStyle = '#08060e'; g.fillRect(0, 0, c.width, c.height);
      SPRS.set(id, c);
    }
    return c;
  }


  /* ---------- sprites and animation ---------- */
  // base radius and standing height of a mini, in squares, so effects sit on the right spot for any size
  function figureSize(type) {
    const f = TableMinis.figure(figType(type)), sz = TableMinis.SIZES[f.size];
    return { rx: sz.rx, ht: f.height || -sz.top };
  }
  function addSprite(ev, how, at) {
    const fs = figureSize(ev.unitType), t0 = at != null ? at : ev.t;
    const sp = { id: ev.id, kind: ev.kind, type: ev.unitType, lane: ev.lane, sq: ev.sq, dispHp: ev.hp, maxHp: ev.maxHp || ev.hp,
      rx: fs.rx, ht: fs.ht, anims: [], dead: false, removeAt: 0, busyUntil: 0, stunned: false };
    if (how === 'drop') sp.anims.push({ k: 'drop', t0, dur: 0.3, hide: true }, { k: 'land', t0: t0 + 0.3, dur: 0.22 });
    else if (how === 'split') sp.anims.push({ k: 'emerge', t0, dur: 0.45, hide: true, fromLane: ev.lane, fromSq: ev.sq });
    else if (how === 'summon') sp.anims.push({ k: 'rise', t0, dur: 0.55, hide: true });
    V.sprites.set(ev.id, sp);
    return sp;
  }

  // in a crowded battle the small ones share a square: spread them a little so all three show
  const STACK = { 2: [[-0.18, -0.07], [0.18, 0.07]], 3: [[-0.22, -0.1], [0.22, -0.1], [0, 0.12]] };
  function stackSprites() {
    const piles = new Map();
    for (const sp of V.sprites.values()) { sp.stack = null; if (sp.kind !== 'monster' || sp.dead) continue; const k = sp.lane * 100 + sp.sq; (piles.get(k) || piles.set(k, []).get(k)).push(sp); }
    for (const pile of piles.values()) if (pile.length > 1) { pile.sort((a, b) => a.id - b.id); const offs = STACK[Math.min(3, pile.length)]; pile.forEach((sp, i) => { sp.stack = offs[i % offs.length]; }); }
  }
  function spriteState(sp, now) {
    const e = FXM.evaluate(sp, now), gp = gpos(e.lane, e.sq), up = cellAt(Math.round(e.lane), Math.round(e.sq)) === '^' ? LEDGE : 0, st = sp.stack;
    const ps = poseOf(sp, now);
    return { sp, gx: gp.x + (e.dx + (st ? st[0] : 0)) * L.cell, gy: gp.y + (e.dy - up + (st ? st[1] : 0)) * L.cell, lift: e.lift, rot: e.rot, alpha: e.alpha, pivot: e.pivot, flash: e.flash, scale: e.scale,
      pose: ps.pose, flip: ps.flip };
  }

  /* ---------- poses (minis 2.4.0): a mini takes a stance while it acts, and leans back when it is hit or falls ---------- */
  const POSE_OF = { strike: ['strike'], recoil: ['strike'], cast: ['cast', 'breath'], knock: ['hurt'], shake: ['hurt'], dodge: ['guard'] };
  const DYING = new Set(['topple', 'crumble', 'drift', 'melt', 'swat', 'pickup', 'fade']);
  const spriteKey = sp => (sp.form === 'bear' ? '__bear' : sp.type);
  function poseSprite(key, pose) {
    const id = key + '|' + pose;
    let p = SPRP.get(id);
    if (p === undefined) {
      const bear = key === '__bear', fig = bear ? 'caveBear' : figType(key);
      p = null;
      if (TableMinis.hasPose(fig, pose)) {
        const sp = TableMinis.sprite(fig, L.cell * L.dpr, Object.assign({}, bear ? { faction: 'hero' } : figOpts(key), { pose }));
        p = { sp, white: TableMinis.flash(sp) };
      }
      SPRP.set(id, p);
    }
    return p;
  }
  // FXM.evaluate has just dropped finished anims (hit-stop included), so any anim that has started is playing now
  const NO_POSE = { pose: '', flip: false };
  function poseOf(sp, now) {
    if (!SET.poses || sp.stone || sp.inside) return NO_POSE;
    const key = spriteKey(sp);
    let best = null, dying = null;
    for (const a of sp.anims) {
      if (now < a.t0) continue;
      if (DYING.has(a.k)) { dying = a; break; }
      if (POSE_OF[a.k] && (!best || a.t0 >= best.t0)) best = a;
    }
    const a = dying || best;
    if (!a) return NO_POSE;
    for (const n of dying ? ['hurt'] : POSE_OF[a.k]) if (poseSprite(key, n)) return { pose: n, flip: enemyX(sp, a) < -0.2 };
    return NO_POSE;
  }
  // Poses are sculpted with the enemy to the right (a strike lunges right, hurt leans left), so a mini whose enemy is
  // on its left is mirrored. The anim says where the enemy is; failing that, a mini faces down its lane.
  function enemyX(sp, a) {
    let x = a.k === 'knock' ? -a.vx : (a.k === 'topple' || a.k === 'dodge') ? -a.dir : a.vx;
    if (!Number.isFinite(x) || Math.abs(x) < 0.2) x = laneVec(sp.kind === 'hero' ? 1 : -1).x;
    return x;
  }

  function shake(amp) { if (!calm()) V.shake = { t0: clock(), amp }; }

  function killSprite(t, at, dir) {
    if (t.dead) return;
    t.dead = true;
    const b = V.bounty[t.id];
    if (b) { spawnCoins(t.lane, t.sq, b >= 20 ? 3 : b >= 10 ? 2 : 1, at + 0.15); delete V.bounty[t.id]; }
    const style = t.stone ? 'crumble' : DEATH[t.type];
    if (style) { // constructs and bones crumble, spirits drift up, oozes melt away
      const dur = style === 'drift' ? 0.95 : style === 'melt' ? 0.85 : 0.75, mat = matOf(t);
      t.anims.push({ k: style, t0: at, dur, persist: true });
      t.removeAt = at + dur;
      if (style === 'crumble' && SET.bits) V.fx.push({ k: 'bits', t0: at + 0.08, dur: MitzMotion.MATERIALS[mat].life + 0.2, lane: t.lane, sq: t.sq, ht: t.ht * 0.5, mat, ang: Math.PI / 2, seed: t.id * 31 + 7, scale: 2 });
      V.impacts.push({ at, fn: () => sfx(style === 'crumble' ? 'crumble' : style === 'melt' ? 'squish' : 'whoosh', 0.7) });
      return;
    }
    t.anims.push({ k: 'topple', t0: at, dur: 0.45, dir, persist: true });
    V.impacts.push({ at: at + 0.3, fn: () => sfx('thump') });
    if (t.kind === 'monster' && SET.paws && !calm()) { pawSwat(t, at); return; }
    if (t.kind === 'hero' && !calm()) { // a fallen hero is lifted off the mat, back to the tavern
      t.anims.push({ k: 'pickup', t0: at + 0.85, dur: 0.6, persist: true });
      t.removeAt = at + 1.45;
      return;
    }
    t.anims.push({ k: 'fade', t0: at + 0.95, dur: 0.5, persist: true });
    t.removeAt = at + 1.5;
  }
  // the two cats are both black, so each wears a collar in the house colours, and its tag swings at the table's edge
  // where its paw comes in: Mitz red with a gold tag, Simz gold with a red tag
  const CATS = { Mitz: { collar: '#c9353e', tag: '#e8c15a', ink: '#5a1418' }, Simz: { collar: '#d9a93a', tag: '#b8323a', ink: '#fff1d6' } };
  function catTag(who, lane, sq, ex, ey, t0, dur) { (V.tags || (V.tags = [])).push({ who, lane, sq, ex, ey, t0, dur }); }
  function drawTags(now) {
    if (!V.tags || !V.tags.length) return;
    V.tags = V.tags.filter(t => now < t.t0 + t.dur + 0.4);
    const c = L.cell, m = matRect();
    for (const t of V.tags) {
      if (now < t.t0) continue;
      const age = now - t.t0, a = Math.min(1, age / 0.15, (t.t0 + t.dur + 0.4 - now) / 0.4), cat = CATS[t.who], g = gpos(t.lane, t.sq);
      // just inside the edge of the table where the paw comes in, a little to one side of the leg (outside it, the hero
      // tray or the screen's edge could hide it)
      const x = t.ex ? (t.ex < 0 ? m.x + c * 0.3 : m.x + m.w - c * 0.3) : g.x + c * 0.55, y = t.ey ? (t.ey < 0 ? m.y - c * 0.05 : m.y + m.h - c * 0.85) : g.y - c * 0.35;
      const swing = calm() ? 0 : Math.sin(age * 9) * 0.55 * Math.exp(-age * 1.6);
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = c * 0.16; ctx.lineCap = 'round'; // the collar, a band of colour
      ctx.beginPath(); ctx.arc(0, -c * 0.12, c * 0.3, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
      ctx.strokeStyle = cat.collar; ctx.lineWidth = c * 0.12;
      ctx.beginPath(); ctx.arc(0, -c * 0.12, c * 0.3, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
      ctx.translate(0, c * 0.18); ctx.rotate(swing); // the tag on its ring, swinging
      ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = Math.max(1, c * 0.03); ctx.beginPath(); ctx.arc(0, c * 0.04, c * 0.05, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(c * 0.02, c * 0.27, c * 0.17, 0, TAU); ctx.fill();
      ctx.fillStyle = cat.tag; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = Math.max(1, c * 0.02);
      ctx.beginPath(); ctx.arc(0, c * 0.25, c * 0.17, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = cat.ink; ctx.font = '700 ' + Math.round(c * 0.2) + 'px ' + UIF; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.who[0], 0, c * 0.26);
      ctx.rotate(-swing); ctx.fillStyle = cat.collar; ctx.font = '700 ' + Math.max(10, Math.round(c * 0.17)) + 'px ' + UIF; // the name beside it
      ctx.fillText(t.who.toUpperCase(), 0, c * 0.6);
      ctx.restore();
    }
  }
  // Mitz and Simz take turns clearing the fallen, a swipe at a time. The bodies lie where they fell until three are down
  // on one side of the table or the oldest has lain five seconds; then one paw sweeps everything on that side off at once.
  // Swipes come at least two seconds apart, so a busy fight is a few good sweeps rather than a paw for every goblin
  function pawSwat(t, at) {
    t.removeAt = Infinity; // it lies there until a paw takes it
    (V.fallen || (V.fallen = [])).push({ sp: t, at });
  }
  function sweepFallen(now) {
    if (!V.fallen || !V.fallen.length || now < (V.nextSweep || 0)) return;
    V.fallen = V.fallen.filter(f => V.sprites.get(f.sp.id) === f.sp); // anything already gone from the mat
    const down = V.fallen.filter(f => now >= f.at + 0.6); // the ones that have finished falling
    if (!down.length) return;
    const side = f => { const e = edgeFor(f.sp.lane, f.sp.sq); return e.ex * 2 + e.ey; };
    const sides = {}; for (const f of down) (sides[side(f)] = sides[side(f)] || []).push(f);
    let group = Object.values(sides).find(g => g.length >= 3);
    if (!group && now >= down[0].at + 5) group = sides[side(down[0])];
    if (!group) return;
    group = group.slice(0, 8);
    V.fallen = V.fallen.filter(f => group.indexOf(f) < 0);
    let far = group[0], fe = edgeFor(far.sp.lane, far.sp.sq);
    for (const f of group) { const e = edgeFor(f.sp.lane, f.sp.sq); if (e.reach > fe.reach) { far = f; fe = e; } } // reach over them all
    const sq = group.reduce((a, f) => a + f.sp.sq, 0) / group.length, t0 = now, dur = 1.0, contact = t0 + 0.4 * dur;
    const who = V.pawTurn++ % 2 ? 'Simz' : 'Mitz';
    V.fx.push({ k: 'paw', t0, dur, lane: far.sp.lane, sq, ex: fe.ex, ey: fe.ey, reach: fe.reach, fur: '#151316', rim: '#57525e' });
    catTag(who, far.sp.lane, sq, fe.ex, fe.ey, t0, dur);
    group.forEach((f, i) => {
      const t = f.sp, e = edgeFor(t.lane, t.sq);
      t.anims.push({ k: 'swat', t0: contact + i * 0.04, dur: 0.6 * dur, vx: e.ex, vy: e.ey, dist: e.reach, dir: t.id % 2 ? 1 : -1, persist: true });
      t.removeAt = t0 + dur + i * 0.04;
    });
    V.impacts.push({ at: contact, fn: () => sfx('swat') });
    V.nextSweep = now + 2.0;
  }
  // a d20 rolls across the mat and settles on the roll: for crits, and for the blow that fells a boss
  function tumbleDie(ev, a, t, at, sign) {
    const t0 = Math.max(ev.t, at - 0.52), lane = t.lane + 0.42;
    V.fx.push({ k: 'tumble', t0, dur: 1.05, from: { lane, sq: t.sq - sign * 2.3 }, to: { lane, sq: t.sq - sign * 0.55 }, face: ev.roll, side: a.kind, gold: !!ev.crit });
    V.impacts.push({ at: t0, fn: () => sfx('dice') });
  }

  function spawnCoins(lane, sq, n, t0) {
    for (let i = 0; i < n; i++) V.coins.push({ t0: t0 + i * 0.08, lane, sq, vx: (Math.random() - 0.5) * 0.9, peak: 0.45 + Math.random() * 0.25 });
  }

  /* ---------- simulation events become animation ---------- */
  function onEvent(ev) {
    trackFeats(ev);
    switch (ev.type) {
      case 'place': addSprite(ev, 'drop').level = ev.level || 1; V.impacts.push({ at: ev.t + 0.3, fn: () => sfx('clack') }); break;
      case 'spawn': onSpawn(ev); break;
      case 'move': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const m = HTL.MONSTERS[sp.type];
        const dur = ev.leap ? 0.62 : (m && m.speed >= 1.5 ? 0.3 : 0.42);
        const t0 = Math.max(ev.t, sp.busyUntil);            // a sprint is two hops, one after the other
        const fromLane = ev.fromLane != null ? ev.fromLane : sp.lane, toLane = ev.lane != null ? ev.lane : sp.lane;
        sp.anims.push({ k: ev.leap ? 'leap' : 'hop', t0, dur, from: ev.from, to: ev.to, fromLane, toLane, lean: toLane === fromLane ? laneVec(-1).lean : 0 });
        sp.busyUntil = t0 + dur;
        sp.sq = ev.to; sp.lane = toLane; break;
      }
      case 'summon': { const sp = V.sprites.get(ev.id); if (sp) sp.anims.push({ k: 'cast', t0: ev.t, dur: 0.5 }); break; }
      case 'cure': {
        const c = V.sprites.get(ev.from), t = V.sprites.get(ev.id); if (!t) break;
        const at = ev.t + 0.3;
        if (c) {
          c.anims.push({ k: 'cast', t0: ev.t, dur: 0.45 });
          if (c !== t) V.fx.push({ k: 'beam', t0: ev.t + 0.05, dur: 0.5, col: '240,214,140', from: { lane: c.lane, sq: c.sq, ht: c.ht }, to: { lane: t.lane, sq: t.sq, ht: t.ht } });
        }
        V.impacts.push({ at, fn: () => { t.dispHp = Math.min(t.maxHp, t.dispHp + ev.amount); if (ev.cured) t.stunned = false; } });
        if (ev.amount > 0) V.pops.push({ t0: at, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'heal', amount: ev.amount });
        if (ev.cured) V.pops.push({ t0: at + 0.15, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'label', text: 'CURED', col: '#f0cd6e', slot: 1 });
        V.fx.push({ k: 'sparkle', t0: at, dur: 0.9, lane: t.lane, sq: t.sq });
        break;
      }
      case 'charge': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const dur = 0.4, tg = V.sprites.get(ev.target);
        sp.anims.push({ k: 'charge', t0: ev.t, dur, from: ev.from, to: ev.to, lean: laneVec(1).lean });
        sp.busyUntil = ev.t + dur; sp.sq = ev.to;
        V.pops.push({ t0: ev.t, lane: sp.lane, sq: ev.from, ht: sp.ht, kind: 'label', text: 'RAGE!', col: '#f2a46b' });
        if (tg) V.fx.push({ k: 'whirl', t0: ev.t + dur, dur: 0.55, lane: tg.lane, sq: tg.sq });
        break;
      }
      case 'spent': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt['by' + ev.id] || ev.t) + 0.3;
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'SPENT', col: '#d9cfc0' });
        killSprite(sp, at, L.horiz ? -1 : (sp.id % 2 ? 1 : -1));
        break;
      }
      case 'regen': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = ev.drain && V.hitAt['by' + ev.id] != null ? V.hitAt['by' + ev.id] + 0.12 : ev.t;
        V.impacts.push({ at, fn: () => { sp.dispHp = Math.min(sp.maxHp, sp.dispHp + ev.amount); } });
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'heal', amount: ev.amount, monster: true, slot: ev.drain ? 1 : 0 });
        V.fx.push({ k: 'sparkle', t0: at, dur: 0.8, lane: sp.lane, sq: sp.sq, col: '154,214,140' });
        break;
      }
      case 'mend': {
        const pr = V.sprites.get(ev.from), t = V.sprites.get(ev.id); if (!t) break;
        const at = ev.t + 0.3;
        if (pr) pr.anims.push({ k: 'cast', t0: ev.t, dur: 0.45 });
        if (pr && pr !== t) V.fx.push({ k: 'beam', t0: ev.t + 0.05, dur: 0.5, from: { lane: pr.lane, sq: pr.sq, ht: pr.ht }, to: { lane: t.lane, sq: t.sq, ht: t.ht } });
        V.impacts.push({ at, fn: () => { t.dispHp = Math.min(t.maxHp, t.dispHp + ev.amount); } });
        V.pops.push({ t0: at, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'heal', amount: ev.amount, monster: true });
        V.fx.push({ k: 'sparkle', t0: at, dur: 0.8, lane: t.lane, sq: t.sq, col: '154,214,140' });
        break;
      }
      case 'paralyse': {
        const t = V.sprites.get(ev.id); if (!t) break;
        const at = (V.hitAt[ev.id] != null ? V.hitAt[ev.id] : ev.t) + 0.05;
        V.impacts.push({ at, fn: () => { t.stunned = true; } });
        V.pops.push({ t0: at + 0.2, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'label', text: 'PARALYSED', col: '#a9cdf0', slot: 1 });
        break;
      }
      case 'stunned': {
        const t = V.sprites.get(ev.id); if (!t) break;
        V.pops.push({ t0: ev.t, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'label', text: ev.stuck ? 'STUCK FAST' : ev.prone ? 'FALLS OVER' : 'LOSES A TURN', col: '#a9cdf0' });
        V.impacts.push({ at: ev.t + 0.6, fn: () => { t.stunned = false; } });
        break;
      }
      case 'recall': { // picked up off the mat and taken back to the tavern
        const sp = V.sprites.get(ev.id); if (!sp) break;
        sp.anims.push({ k: 'pickup', t0: ev.t, dur: 0.5, persist: true }); sp.dead = true; sp.removeAt = ev.t + 0.52;
        V.pops.push({ t0: ev.t + 0.05, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '+' + ev.refund + ' GOLD', col: '#f0cd6e' });
        spawnCoins(sp.lane, sp.sq, 2, ev.t + 0.1);
        break;
      }
      case 'sprung': {
        V.fx.push({ k: 'boom', t0: ev.t, dur: ev.kind === 'oil' ? 0.6 : 0.3, lane: ev.lane, sq: ev.sq });
        if (ev.kind === 'oil') shake(0.8);
        break;
      }
      case 'throw': { // a flask or a net lands on its square
        V.fx.push({ k: 'boom', t0: ev.t + 0.15, dur: ev.kind === 'net' || ev.kind === 'ballBearings' ? 0.25 : 0.45, lane: ev.lane, sq: ev.sq });
        V.pops.push({ t0: ev.t + 0.1, lane: ev.lane, sq: ev.sq, ht: 0.9, kind: 'label', text: HTL.THROWS[ev.kind].name.toUpperCase(), col: '#f0cd6e', slot: -1 });
        sfx(ev.kind === 'net' || ev.kind === 'ballBearings' ? 'clack' : 'crack', 0.7); break;
      }
      case 'trapHit': case 'thorns': case 'acid': case 'scorch': case 'splash': {
        const sp = V.sprites.get(ev.to || ev.id); if (!sp) break;
        const at = ev.t + 0.12;
        V.impacts.push({ at, fn: () => {
          if (ev.dmg > 0) { sp.anims.push({ k: 'shake', t0: at, dur: 0.3 }, { k: 'flash', t0: at, dur: 0.2 }); sp.dispHp = Math.max(0, sp.dispHp - ev.dmg); }
          const sk = ev.type === 'splash' ? ev.kind : '', acid = ev.type === 'acid' || sk === 'acid';
          const word = ev.type === 'scorch' ? (ev.saved ? ' (SAVED)' : ' FIRE') : acid ? ' ACID' : sk === 'holyWater' ? ' HOLY' : ev.type === 'thorns' ? ' THORNS' : '';
          if (ev.dmg > 0 || ev.kind !== 'bearings') V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '−' + ev.dmg + word, col: acid ? '#9fd68c' : sk === 'holyWater' ? '#f0cd6e' : '#f2a46b' });
          if (ev.killed) killSprite(sp, at, sp.id % 2 ? 1 : -1);
        } });
        break;
      }
      case 'entangle': {
        for (let dl = -1; dl <= 1; dl++) for (let dq = -1; dq <= 1; dq++) V.fx.push({ k: 'sparkle', t0: ev.t + 0.1, dur: 0.8, lane: ev.lane + dl, sq: ev.sq + dq, col: '154,214,140' });
        const sp = V.sprites.get(ev.from); if (sp) sp.anims.push({ k: 'cast', t0: ev.t, dur: 0.45 });
        break;
      }
      case 'jump': { // lightning arcs from one monster to the next
        const a = V.sprites.get(ev.a), b = V.sprites.get(ev.b); if (!a || !b) break;
        V.fx.push({ k: 'bolt', t0: ev.t + 0.2, dur: 0.18, from: { lane: a.lane, sq: a.sq, ht: a.ht }, to: { lane: b.lane, sq: b.sq, ht: b.ht } });
        break;
      }
      case 'shape': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.1;
        V.impacts.push({ at, fn: () => { sp.form = ev.form; sp.anims.push({ k: 'wobble', t0: at, dur: 0.6 }); } });
        V.fx.push({ k: 'sparkle', t0: at, dur: 0.8, lane: sp.lane, sq: sp.sq, col: '154,214,140' });
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: ev.form === 'bear' ? 'WILD SHAPE' : 'DRUID AGAIN', col: '#9fd68c' });
        break;
      }
      case 'dive': { // the thing under the lawn goes back under, to come up somewhere further on
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.1;
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'DIVES UNDER', col: '#e4dccd' });
        sp.anims.push({ k: 'fade', t0: at, dur: 0.45, persist: true }); sp.dead = true; sp.removeAt = at + 0.46;
        if (SET.bits) V.fx.push({ k: 'bits', t0: at, dur: MitzMotion.MATERIALS.stone.life, lane: sp.lane, sq: sp.sq, ht: 0.1, mat: 'stone', ang: -Math.PI / 2, seed: ev.id * 7 + 3, scale: 1.4 });
        sfx('crumble', 0.7);
        break;
      }
      case 'unhorse': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.05;
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'UNHORSED', col: '#e4dccd' });
        sp.anims.push({ k: 'fade', t0: at, dur: 0.25, persist: true }); sp.dead = true; sp.removeAt = at + 0.26;
        break;
      }
      case 'engulf': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = (V.hitAt[ev.id] || ev.t) + 0.15;
        V.pops.push({ t0: at, lane: ev.lane, sq: ev.sq, ht: sp.ht, kind: 'label', text: 'SWALLOWED', col: '#9fd68c' });
        V.impacts.push({ at, fn: () => { sp.inside = true; } });
        break;
      }
      case 'release': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = ev.t + 0.4;
        V.impacts.push({ at, fn: () => { sp.inside = false; sp.lane = ev.lane; sp.sq = ev.sq; sp.anims.push({ k: 'drop', t0: at, dur: 0.3 }, { k: 'land', t0: at + 0.3, dur: 0.22 }); } });
        V.pops.push({ t0: at + 0.3, lane: ev.lane, sq: ev.sq, ht: sp.ht, kind: 'label', text: 'FREE', col: '#f0cd6e' });
        break;
      }
      case 'rust': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        V.pops.push({ t0: (V.hitAt[ev.id] || ev.t) + 0.2, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'RUSTED · AC ' + ev.ac, col: '#d9a46b', slot: 1 });
        break;
      }
      case 'gaze': {
        const a = V.sprites.get(ev.from), t = V.sprites.get(ev.to); if (!a || !t) break;
        a.anims.push({ k: 'cast', t0: ev.t, dur: 0.45 });
        V.fx.push({ k: 'beam', t0: ev.t + 0.05, dur: 0.5, col: ev.charm ? '201,53,62' : '200,200,160', from: { lane: a.lane, sq: a.sq, ht: a.ht }, to: { lane: t.lane, sq: t.sq, ht: t.ht } });
        if (ev.saved) V.pops.push({ t0: ev.t + 0.4, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'label', text: 'RESISTS', col: '#d9cfc0' });
        break;
      }
      case 'petrify': {
        const t = V.sprites.get(ev.id), a = V.sprites.get(ev.from); if (!t) break;
        if (a) { a.anims.push({ k: 'cast', t0: ev.t, dur: 0.45 }); V.fx.push({ k: 'beam', t0: ev.t + 0.05, dur: 0.5, col: '200,200,160', from: { lane: a.lane, sq: a.sq, ht: a.ht }, to: { lane: t.lane, sq: t.sq, ht: t.ht } }); }
        V.impacts.push({ at: ev.t + 0.45, fn: () => { t.stone = true; t.dispHp = 40; t.maxHp = 40; t.anims.push({ k: 'shake', t0: ev.t + 0.45, dur: 0.3 }); } });
        V.pops.push({ t0: ev.t + 0.45, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'label', text: 'TURNED TO STONE', col: '#d9cfc0' });
        break;
      }
      case 'charmed': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'CHARMED', col: '#e88a9a' });
        break;
      }
      case 'breath': { // fire down the whole row toward the tavern
        const sp = V.sprites.get(ev.from); if (!sp) break;
        sp.anims.push({ k: 'cast', t0: ev.t, dur: 0.5 });
        for (let q = ev.sq - 1, i = 0; q >= 0; q--, i++) V.fx.push({ k: 'boom', t0: ev.t + 0.08 + i * 0.05, dur: 0.5, lane: ev.lane, sq: q });
        shake(1.3);
        break;
      }
      case 'levelup': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const extra = ev.maxHp - sp.maxHp;
        sp.maxHp = ev.maxHp; sp.dispHp += extra; sp.level = ev.level;
        sp.anims.push({ k: 'cast', t0: ev.t, dur: 0.5 });
        V.fx.push({ k: 'sparkle', t0: ev.t, dur: 1.1, lane: sp.lane, sq: sp.sq });
        sfx('chime');
        const word = ev.path ? HTL.PATHS[sp.type][ev.path].name.toUpperCase() : 'LEVEL ' + ev.level;
        V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: word, col: '#f0cd6e' });
        break;
      }
      case 'shove': case 'flee': { // pushed or scared back a square toward the door
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const t0 = Math.max(ev.t, (V.hitAt[ev.id] || ev.t) + 0.1, sp.busyUntil);
        sp.anims.push({ k: 'hop', t0, dur: 0.3, from: ev.from, to: ev.to, fromLane: ev.lane, toLane: ev.lane, lean: laneVec(1).lean });
        sp.busyUntil = t0 + 0.3; sp.sq = ev.to;
        if (ev.type === 'flee') V.pops.push({ t0, lane: ev.lane, sq: ev.to, ht: sp.ht, kind: 'label', text: 'FLEES', col: '#e8c9a0' });
        break;
      }
      case 'pocket': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = (V.hitAt['by' + ev.id] || ev.t) + 0.1;
        spawnCoins(sp.lane, sp.sq, 1, at);
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '+' + ev.amount + ' GOLD', col: '#f0cd6e', slot: 1 });
        break;
      }
      case 'stand': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt['by' + ev.id] || ev.t) + 0.3;
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'STANDS FAST', col: '#d9cfc0' });
        break;
      }
      case 'crumble': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'BACK TO BONES', col: '#d9cfc0' });
        killSprite(sp, ev.t + 0.2, sp.id % 2 ? 1 : -1);
        break;
      }
      case 'status': {
        const sp = V.sprites.get(ev.id), st = HTL.STATUSES[ev.status]; if (!sp || !st) break;
        V.pops.push({ t0: ev.t + 0.2, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: st.word, col: STATUS_COL[ev.status] || '#e4dccd', slot: 1 });
        break;
      }
      case 'poison': case 'burn': case 'flames': { // damage that comes from the ground, the blood or the fire, not from an attack
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const holy = ev.type === 'burn', fire = ev.type === 'flames', at = ev.t + (holy ? 0.25 : 0.1);
        if (holy) V.fx.push({ k: 'radiant', t0: ev.t, dur: 0.5, lane: sp.lane, sq: sp.sq, ht: sp.ht, hit: true });
        V.impacts.push({ at, fn: () => {
          sp.anims.push({ k: 'shake', t0: at, dur: 0.3 }, { k: 'flash', t0: at, dur: 0.2 });
          sp.dispHp = Math.max(0, sp.dispHp - ev.dmg);
          V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '−' + ev.dmg + (ev.sun ? ' SUNLIGHT' : holy ? ' HOLY' : fire ? ' FIRE' : ' POISON'), col: holy ? '#f0cd6e' : fire ? '#f2a46b' : '#9fd68c' });
          if (ev.killed) killSprite(sp, at, sp.id % 2 ? 1 : -1);
        } });
        break;
      }
      case 'attack': onAttack(ev); break;
      case 'pounce': onPounce(ev); break;
      case 'rise': { // the drowned get back up
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.35;
        V.impacts.push({ at, fn: () => { sp.dispHp = ev.hp; sp.anims.push({ k: 'wobble', t0: at, dur: 0.6 }); } });
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'GETS BACK UP', col: '#b9d4d8' });
        break;
      }
      case 'wake': { const sp = V.sprites.get(ev.id); if (sp) { sp.anims.push({ k: 'wobble', t0: ev.t, dur: 0.7 }); V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'MIMIC!', col: '#e88a9a' }); sfx('crack', 0.7); } break; }
      case 'scald': { // a salamander burns the hand that strikes it
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const at = Math.max(ev.t, V.hitAt[ev.by] || ev.t) + 0.1;
        V.impacts.push({ at, fn: () => { sp.anims.push({ k: 'flash', t0: at, dur: 0.2 }); sp.dispHp = Math.max(0, sp.dispHp - ev.dmg); if (ev.killed) killSprite(sp, at, -1); } });
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '−' + ev.dmg + ' FIRE', col: '#f2a46b', slot: 1 });
        break;
      }
      case 'send': { const d = HTL.mapOf(S).doors[ev.door]; V.pops.push({ t0: ev.t, lane: d.lane, sq: d.sq, ht: 0.4, kind: 'label', text: PACK.monsters[ev.unitType].name.toUpperCase(), col: '#f0cd6e' }); sfx('door', 0.6); break; }
      case 'restless': { const sp = V.sprites.get(ev.id); if (sp) V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'HAD ENOUGH', col: '#e4dccd', slot: -1 }); break; }
      case 'swat': onSwat(ev); break;
      case 'fireball': onFireball(ev); break;
      case 'save': onSave(ev); break;
      case 'death': if (ev.bounty) V.bounty[ev.id] = ev.bounty; break;
      case 'income': {
        const b = V.sprites.get(ev.id); if (!b) break;
        b.anims.push({ k: 'wobble', t0: ev.t, dur: 0.9 });
        V.fx.push({ k: 'notes', t0: ev.t, dur: 1.2, lane: b.lane, sq: b.sq, seed: Math.random() * 1000 });
        spawnCoins(b.lane, b.sq, 2, ev.t + 0.25); break;
      }
      case 'leak': {
        const sp = V.sprites.get(ev.id);
        if (sp) { sp.anims.push({ k: 'leak', t0: ev.t, dur: 0.6, from: sp.sq, persist: true }); sp.dead = true; sp.removeAt = ev.t + 0.62; }
        V.tavern.push({ lane: ev.lane, t0: ev.t + 0.42 });
        V.impacts.push({ at: ev.t + 0.42, fn: () => { shake(1.4); sfx('door'); } });
        break;
      }
      case 'heal': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        sp.dispHp = Math.min(sp.maxHp, sp.dispHp + ev.amount);
        sp.stunned = false;
        V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'heal', amount: ev.amount });
        V.fx.push({ k: 'sparkle', t0: ev.t, dur: 0.9, lane: sp.lane, sq: sp.sq }); break;
      }
      case 'incoming': {
        const b = HTL.battle(S), cp = campaignOf(b), i = cp ? cp.i : -1;
        const where = i >= 0 ? (cp.house ? 'The house · battle ' : 'Battle ') + (i + 1) + ' of ' + cp.list.length : b.mode === 'puzzle' ? 'Puzzle ' + b.index + ' of ' + MODES.PUZZLES.length : b.mode === 'daily' ? 'Daily Challenge · ' + b.date : b.mode === 'endless' ? 'Endless' : b.mode === 'reverse' ? 'Reverse · ' + b.reverse.rounds + ' rounds to take it' : 'Boss Rush';
        toast(where + (b.reverse ? '' : ' · first wave in ' + ev.rounds + ' rounds'), b.mode === 'daily' ? HTL.MAPS[b.map].name : b.name, b.by + ': ' + b.line);
        const kinds = new Set(L.map.rows.join(''));
        for (const ch of '#~^+oH*=G%@') if (kinds.has(ch)) queueHint(tipOf(ch)[0], tipOf(ch)[1]);
        break;
      }
      case 'hatchWarn': (V.rattle || (V.rattle = {}))[ev.door] = ev.t; sfx('door', 0.35); break;
      case 'hatch': {
        sfx('crack', 0.8); shake(0.5);
        const lawn = L.map.lawn, sky = L.map.skylights, mat = lawn || sky ? 'stone' : 'wood';
        V.pops.push({ t0: ev.t, lane: ev.lane, sq: ev.sq, ht: 0.3, kind: 'label', text: lawn ? 'UP THROUGH THE LAWN!' : sky ? 'THROUGH THE SKYLIGHT!' : 'TRAPDOOR!', col: '#f0cd6e' });
        if (SET.bits) V.fx.push({ k: 'bits', t0: ev.t, dur: MitzMotion.MATERIALS[mat].life, lane: ev.lane, sq: ev.sq, ht: 0.1, mat, ang: -Math.PI / 2, seed: ev.door * 97 + 5, scale: 1.2 });
        break;
      }
      case 'shove': {
        const sp = V.sprites.get(ev.id); if (!sp) break;
        const t0 = Math.max(ev.t, sp.busyUntil);
        sp.anims.push({ k: 'leap', t0, dur: 0.5, from: ev.from, to: ev.to, fromLane: ev.fromLane, toLane: ev.lane, lean: 0 });
        sp.busyUntil = t0 + 0.5; sp.sq = ev.to; sp.lane = ev.lane;
        V.pops.push({ t0: t0 + 0.3, lane: ev.lane, sq: ev.to, ht: sp.ht, kind: 'label', text: 'THROWN', col: '#e8dcc6' });
        break;
      }
      case 'ovenWarn': V.ovenWarn = ev.t; break;
      case 'gate': sfx(ev.shut ? 'clang' : 'door', 0.8); if (ev.shut) { shake(0.4); toast('The yard gate', 'Down for ' + (ev.until - S.round) + ' rounds', 'Everything goes round the other way until it lifts.'); } updateGate(); break;
      case 'barrelWarn': V.barrelWarn = { lane: ev.lane, t0: ev.t }; sfx('thump', 0.4); break;
      case 'barrel': onBarrel(ev); break;
      case 'flare': V.flare = ev.t + 0.05; V.ovenWarn = null; sfx('whoosh', 0.9); sfx('boom', 0.35); break;
      case 'wave': toast('Wave ' + (ev.index + 1) + (ev.total ? ' of ' + ev.total : ''), ev.name, ev.by + ': ' + ev.line); sfx('horn', 0.8); break;
      case 'rest': toast('Short rest', 'Wave ' + (ev.next + 1) + ' in ' + ev.rounds + ' rounds', 'Your heroes recover half their lost hit points.'); break;
      case 'victory': case 'defeat': { const won = (ev.type === 'victory') !== (S.purse != null); finishBattle(won); setTimeout(() => showEnd(won), 1400); break; } // in Reverse the tavern falling is your win
    }
  }

  const STATUS_COL = { paralysed: '#a9cdf0', slowed: '#c9c2e8', poisoned: '#9fd68c', frightened: '#e8c9a0', burnt: '#f2a46b', seared: '#f0cd6e', charmed: '#e88a9a', rotting: '#b9c48a', stuck: '#d8c49a', aflame: '#f2a46b', netted: '#d8c49a', prone: '#c9c2e8' };
  function onSpawn(ev) {
    const m = HTL.MONSTERS[ev.unitType];
    if (ev.how === 'split') {
      const parent = V.sprites.get(ev.from);
      const at = Math.max(ev.t, V.hitAt[ev.from] != null ? V.hitAt[ev.from] : ev.t) + 0.06;
      const sp = addSprite(ev, 'split', at);
      if (parent) {
        sp.anims[0].fromLane = parent.lane; sp.anims[0].fromSq = parent.sq;
        V.impacts.push({ at, fn: () => { parent.dispHp = Math.max(1, parent.dispHp - ev.hp); parent.anims.push({ k: 'wobble', t0: at, dur: 0.6 }); } });
      }
      V.pops.push({ t0: at + 0.1, lane: ev.lane, sq: ev.sq, ht: sp.ht, kind: 'label', text: 'SPLITS', col: '#e4dccd' });
      return;
    }
    if (ev.how === 'rise') { // a Graveseer's skeleton gets back up on your side
      const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.9;
      addSprite(ev, 'summon', at);
      V.fx.push({ k: 'sigil', t0: at - 0.25, dur: 0.8, lane: ev.lane, sq: ev.sq });
      V.pops.push({ t0: at, lane: ev.lane, sq: ev.sq, ht: 0.9, kind: 'label', text: 'RISES', col: '#d9cfc0' });
      return;
    }
    if (ev.how === 'raise') { // a necromancer's skeleton climbs back up
      const at = Math.max(ev.t, V.hitAt[ev.id] || ev.t) + 0.9;
      addSprite(ev, 'summon', at);
      V.fx.push({ k: 'sigil', t0: at - 0.25, dur: 0.8, lane: ev.lane, sq: ev.sq });
      return;
    }
    if (ev.how === 'disguised') { // a mimic set down on the mat like any treasure chest
      addSprite(ev, 'drop', ev.t + 0.1);
      V.pops.push({ t0: ev.t + 0.4, lane: ev.lane, sq: ev.sq, ht: 0.6, kind: 'label', text: 'A CHEST?', col: '#f0cd6e' });
      return;
    }
    if (ev.how === 'unhorse') { addSprite(ev, 'drop', Math.max(ev.t, V.hitAt[ev.from] || ev.t) + 0.1); return; }
    if (ev.how === 'surface') { // back up through a molehill, as hurt as it went down
      addSprite(ev, 'summon', ev.t + 0.2);
      V.pops.push({ t0: ev.t + 0.4, lane: ev.lane, sq: ev.sq, ht: 0.9, kind: 'label', text: 'IT’S BACK', col: '#f0cd6e' });
      shake(0.4);
      return;
    }
    if (ev.how === 'summon') {
      addSprite(ev, 'summon', ev.t + 0.32);
      V.fx.push({ k: 'sigil', t0: ev.t + 0.05, dur: 0.8, lane: ev.lane, sq: ev.sq });
      return;
    }
    addSprite(ev, 'drop');
    if (!m) return;
    if (m.traits.boss) toast('Boss on the mat', m.name, HTL.describe(ev.unitType));
    else if (!V.seen.has(ev.unitType)) queueHint('New: ' + m.name, HTL.describe(ev.unitType));
    V.seen.add(ev.unitType);
  }

  function onAttack(ev) {
    const a = V.sprites.get(ev.from), t = V.sprites.get(ev.to);
    if (!a || !t) return;
    const sign = Math.sign(t.sq - a.sq) || (a.kind === 'hero' ? 1 : -1);
    // aim along the real line from attacker to target, so a Rogue's sideways stab leans sideways
    const ga = gpos(a.lane, a.sq), gt = gpos(t.lane, t.sq);
    let vx = gt.x - ga.x, vy = gt.y - ga.y; const len = Math.hypot(vx, vy) || 1; vx /= len; vy /= len;
    const dv = { x: vx, y: vy, lean: L.horiz ? Math.sign(vx) : Math.sign(vx) * 0.5 };
    const ang = Math.atan2(ga.y - gt.y, ga.x - gt.x);
    // a second swing in the same turn plays out after the first; a Barbarian's sweep is quicker
    const prev = V.swing[a.id], n = prev && prev.t === ev.t ? prev.n + 1 : 0;
    V.swing[a.id] = { t: ev.t, n };
    const start = Math.max(ev.t, a.busyUntil || 0) + n * (a.type === 'barbarian' ? 0.13 : 0.34);
    let at;
    if (ev.kind === 'melee') { // lean back, then drive in: the blow lands at the strike's contact point
      a.anims.push({ k: 'strike', t0: start, dur: 0.42, vx: dv.x, vy: dv.y, lean: dv.lean });
      at = start + 0.42 * MitzMotion.STRIKE_CONTACT;
      V.impacts.push({ at, fn: () => {
        V.fx.push({ k: ev.fx === 'smash' ? 'smash' : 'slash', t0: at, dur: ev.fx === 'smash' ? 0.42 : 0.2, lane: t.lane, sq: t.sq, ang, ht: t.ht, rx: t.rx, hit: ev.hit });
        hitTarget(ev, a, t, at, sign, n, dv, ang);
      } });
    } else if (ev.fx === 'radiant') { // Sacred Flame: a column of light falls on the target
      a.anims.push({ k: 'cast', t0: start, dur: 0.4 });
      at = start + 0.28;
      V.fx.push({ k: 'radiant', t0: start + 0.05, dur: 0.55, lane: t.lane, sq: t.sq, ht: t.ht, hit: ev.hit });
      V.impacts.push({ at: start, fn: () => sfx('whoosh', 0.6) });
      V.impacts.push({ at, fn: () => hitTarget(ev, a, t, at, sign, n, dv, ang) });
    } else {
      a.anims.push({ k: ev.fx === 'arrow' ? 'recoil' : 'cast', t0: start, dur: 0.3, vx: dv.x, vy: dv.y, lean: dv.lean });
      const dist = Math.abs(t.sq - a.sq) + Math.abs(t.lane - a.lane);
      const fl = ev.fx === 'arrow' ? 0.1 + dist * 0.045 : 0.14 + dist * 0.06;
      const t0 = start + 0.05; at = t0 + fl;
      V.fx.push({ k: ev.fx, t0, dur: fl, from: { lane: a.lane, sq: a.sq, ht: a.ht }, to: { lane: t.lane, sq: t.sq, ht: t.ht }, sign, miss: ev.hit ? 0 : (Math.random() < 0.5 ? -1 : 1) });
      V.impacts.push({ at: t0, fn: () => sfx(ev.fx === 'arrow' ? 'twang' : 'whoosh', ev.fx === 'arrow' ? 0.7 : 0.5) });
      V.impacts.push({ at, fn: () => hitTarget(ev, a, t, at, sign, n, dv, ang) });
    }
    const boss = HTL.MONSTERS[t.type] && HTL.MONSTERS[t.type].traits.boss;
    if (SET.tumble && !calm() && ev.hit && (ev.crit || (ev.killed && boss))) tumbleDie(ev, a, t, at, sign);
    V.hitAt[t.id] = at; V.hitAt['by' + a.id] = at;
  }

  function hitTarget(ev, a, t, at, sign, slot, dv, ang) {
    let stop = 0;
    const mat = matOf(t);
    if (ev.hit) {
      // hit-stop: crits and heavy blows freeze attacker and target for a beat, then the target is knocked back
      const big = ev.crit || ev.killed || ev.dmg >= Math.max(8, (t.maxHp || 10) * 0.35);
      stop = SET.hitstop && big ? (ev.crit ? 0.12 : 0.08) : 0;
      if (stop) { FXM.hold(a, at, stop); FXM.hold(t, at, stop); }
      const amt = clamp(0.05 + 0.3 * ev.dmg / Math.max(1, t.maxHp || ev.dmg), 0.05, 0.3);
      t.anims.push(dv ? { k: 'knock', t0: at + stop, dur: 0.34, vx: dv.x, vy: dv.y, lean: dv.lean, amt } : { k: 'shake', t0: at + stop, dur: 0.3 }, { k: 'flash', t0: at, dur: 0.22 + stop });
      t.dispHp = Math.max(0, t.dispHp - ev.dmg);
      if (ev.crit) shake(1); else if (ev.fx === 'smash' && a.kind === 'monster') shake(0.7);
      if (SET.bits) V.fx.push({ k: 'bits', t0: at, dur: MitzMotion.MATERIALS[mat].life, lane: t.lane, sq: t.sq, ht: t.ht, mat, ang, seed: (Math.random() * 1e5) | 0, scale: (ev.crit ? 1.6 : 1) * (calm() ? 0.5 : 1) });
      sfx(HIT_SOUND[mat] || 'thud');
    } else {
      t.anims.push({ k: 'dodge', t0: at, dur: 0.32, dir: L.horiz ? (sign > 0 ? 1 : -1) : (t.id % 2 ? 1 : -1) });
      const glance = ev.kind === 'melee' && mat === 'metal'; // a blade skidding off armour
      if (glance && SET.bits) V.fx.push({ k: 'bits', t0: at, dur: 0.3, lane: t.lane, sq: t.sq, ht: t.ht, mat: 'metal', ang, seed: (Math.random() * 1e5) | 0, scale: 0.6 });
      sfx(glance ? 'clang' : 'whiff', glance ? 0.45 : 0.8);
    }
    V.pops.push({ t0: at, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'atk', side: a.kind, roll: ev.roll, low: ev.low, hit: ev.hit, crit: ev.crit, fumble: ev.fumble,
      dmg: ev.dmg, resisted: ev.resisted, sneak: ev.sneak, holy: ev.holy, slot: a.type === 'barbarian' ? 0 : (slot || 0) });
    if (ev.killed) killSprite(t, at + stop, L.horiz ? (sign > 0 ? 1 : -1) : (t.id % 2 ? 1 : -1));
  }

  function onFireball(ev) {
    const a = V.sprites.get(ev.from); if (!a) return;
    a.anims.push({ k: 'cast', t0: ev.t, dur: 0.42 });
    sfx('whoosh', 0.8);
    const dist = Math.abs(ev.sq - a.sq) + Math.abs(ev.lane - a.lane);
    const t0 = ev.t + 0.12, fl = 0.22 + dist * 0.07, at = t0 + fl;
    V.fx.push({ k: 'fireball', t0, dur: fl, from: { lane: a.lane, sq: a.sq, ht: a.ht }, to: { lane: ev.lane, sq: ev.sq, ht: 0.8 } });
    V.fireballAt[ev.from] = at;
    V.impacts.push({ at, fn: () => {
      V.fx.push({ k: 'boom', t0: at, dur: 0.6, lane: ev.lane, sq: ev.sq });
      V.scorch.push({ lane: ev.lane, sq: ev.sq, t0: at });
      shake(1.2); sfx('boom');
    } });
  }

  function onSave(ev) {
    const t = V.sprites.get(ev.to); if (!t) return;
    const at = (V.fireballAt[ev.from] != null ? V.fireballAt[ev.from] : ev.t) + 0.03;
    V.hitAt[t.id] = at;
    V.impacts.push({ at, fn: () => {
      if (ev.dmg > 0) { t.anims.push({ k: 'shake', t0: at, dur: 0.32 }, { k: 'flash', t0: at, dur: 0.26 }); t.dispHp = Math.max(0, t.dispHp - ev.dmg); }
      V.pops.push({ t0: at, lane: t.lane, sq: t.sq, ht: t.ht, kind: 'save', roll: ev.roll, saved: ev.saved, dmg: ev.dmg });
      if (ev.killed) killSprite(t, at, t.id % 2 ? 1 : -1);
    } });
  }

  function runImpacts(now) { FXM.runImpacts(now); }

  /* ---------- drawing ---------- */
  function draw(now) {
    const c = L.cell;
    V.now = now;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.drawImage(boardCache, 0, 0, L.W, L.H);
    if (V.fallen && V.fallen.length) {
      if (SET.paws && !calm()) sweepFallen(now);
      else { for (const f of V.fallen) { f.sp.anims.push({ k: 'fade', t0: now, dur: 0.5, persist: true }); f.sp.removeAt = now + 0.5; } V.fallen = []; } // paws switched off: they fade as before
    }
    if (V.shake) {
      const p = (now - V.shake.t0) / 0.35;
      if (p >= 0 && p < 1) { const a = V.shake.amp * c * 0.05 * (1 - p); ctx.translate(Math.sin(p * 55) * a, Math.cos(p * 41) * a * 0.6); }
      else if (p >= 1) V.shake = null;
    }
    drawScorch(now);
    drawGround(now);
    if (L.map.hatches || L.map.oven || L.map.chutes || L.map.gate) drawFloorState(now);
    if (S.traps && S.traps.length) drawTraps();
    drawRoutes(now);
    drawTavernHits(now);
    drawPlacement();
    drawBadSquares(now);
    prof.mark('board');

    live.clear(); for (const u of S.units) if (u.alive) live.set(u.id, u);
    if (HTL.battle(S).crowds) stackSprites();
    const list = [];
    for (const sp of V.sprites.values()) {
      if (sp.removeAt && now >= sp.removeAt) { V.sprites.delete(sp.id); continue; }
      list.push(spriteState(sp, now));
    }
    for (const p of L.pillars) { const g = gpos(p.lane, p.sq); list.push({ pillar: true, gx: g.x, gy: g.y }); }
    list.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    if (L.dark) shadeAll(list);
    for (const st of list) if (!st.pillar) drawShadow(st);
    prof.mark('shadows');
    for (const st of list) if (st.pillar) drawPillar(st, list); else { drawSprite(st); if (st.sp.level > 1 && !st.sp.dead) drawLevel(st); }
    prof.mark('minis');
    drawGlows(list);
    drawTorches();
    for (const st of list) if (!st.pillar) drawHp(st);
    drawGhost();
    drawAim();
    drawFx(now);
    drawTags(now);
    drawPops(now);
    drawCoins(now);
    prof.mark('effects');
  }

  const live = new Map(); // the sim's units by id, refreshed every frame
  function drawShadow(st) {
    const c = L.cell, k = (1 - clamp(st.lift, 0, 1.5) * 0.35) * st.scale, rx = st.sp.rx * 1.1;
    ctx.globalAlpha = 0.5 * st.alpha * k; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(st.gx, st.gy + c * 0.06, c * rx * k, c * rx * 0.38 * k, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (SET.torch && st.alpha > 0.05) { // torchlight throws a longer, softer shadow away from the nearer torch
      const T = L.torches, i = Math.hypot(st.gx - T[0].x, st.gy - T[0].y) <= Math.hypot(st.gx - T[1].x, st.gy - T[1].y) ? 0 : 1;
      const len = c * (st.sp.ht || 0.8) * (0.42 + 0.08 * flicker(i)) * k, ang = Math.atan2(st.gy - T[i].y, st.gx - T[i].x);
      ctx.globalAlpha = 0.2 * st.alpha; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(st.gx + Math.cos(ang) * len * 0.55, st.gy + c * 0.05 + Math.sin(ang) * len * 0.55, len * 0.6, c * st.sp.rx * 0.55 * k, ang, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const u = st.sp.kind === 'hero' || st.sp.kind === 'monster' ? live.get(st.sp.id) : null;
    if (u && !st.sp.dead) { // slowed and poisoned show as rings round the base
      const ring = (col, r, dash) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, c * 0.03); ctx.setLineDash(dash); ctx.beginPath(); ctx.ellipse(st.gx, st.gy + c * 0.02, c * st.sp.rx * r, c * st.sp.rx * r * 0.38, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]); };
      if (HTL.hasStatus(u, 'poisoned')) ring('rgba(159,214,140,.8)', 1.18, []);
      if (HTL.hasStatus(u, 'slowed')) ring('rgba(201,194,232,.8)', 1.42, [c * 0.06, c * 0.05]);
    }
    if (st.sp.stunned && !st.sp.dead) { // paralysed: a pale ring of frost round the base
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 160);
      ctx.strokeStyle = 'rgba(169,205,240,' + pulse.toFixed(3) + ')'; ctx.lineWidth = Math.max(2, c * 0.035);
      ctx.beginPath(); ctx.ellipse(st.gx, st.gy + c * 0.02, c * st.sp.rx * 1.3, c * st.sp.rx * 0.5, 0, 0, TAU); ctx.stroke();
    }
  }
  function drawSprite(st) {
    const bear = st.sp.form === 'bear', key = spriteKey(st.sp), pp = st.pose ? poseSprite(key, st.pose) : null, k = 1 / L.dpr, c = L.cell;
    const s = pp ? pp.sp : spr(bear ? '__bear' : st.sp.type);
    if (st.sp.inside) return; // swallowed by a gelatinous cube
    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.translate(st.gx + st.pivot * c, st.gy - st.lift * c);
    if (st.rot) ctx.rotate(st.rot);
    ctx.translate(-st.pivot * c, 0);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    if (pp ? st.flip : turned(st.sp)) ctx.scale(-1, 1); // a sprite is centred on its ground point, so this mirrors it in place
    if (st.sp.stone) ctx.filter = 'brightness(0.62) contrast(0.85)'; // only a mini turned to stone touches the filter: some browsers slow down for any filter
    const level = st.shade ? Math.round(st.shade / SHADE_STEP) : 0;
    ctx.drawImage(level > 0 ? shaded(pp ? key + '|' + st.pose : key, s, level) : s.cv, -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k);
    if (st.sp.stone) ctx.filter = 'none';
    if (st.flash > 0) { ctx.globalAlpha = st.alpha * st.flash * 0.8; ctx.drawImage(pp ? pp.white : sprW(bear ? '__bear' : st.sp.type), -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k); }
    ctx.restore();
  }
  function drawLevel(st) { // one gold chevron per level past the first, painted on the front of the base
    const c = L.cell, n = st.sp.level - 1, w = c * 0.075, y = st.gy - st.lift * c + c * st.sp.rx * 0.14;
    ctx.globalAlpha = st.alpha; ctx.fillStyle = '#f0cd6e'; ctx.strokeStyle = 'rgba(20,12,6,.9)'; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const x = st.gx + (i - (n - 1) / 2) * w * 1.5;
      ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x, y + w * 0.6); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + w * 0.45); ctx.lineTo(x, y + w * 1.05); ctx.lineTo(x - w / 2, y + w * 0.45); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawHp(st) {
    const sp = st.sp;
    if (sp.dead || sp.dispHp >= sp.maxHp || st.alpha < 0.5) return;
    const c = L.cell, w = c * Math.max(0.46, sp.rx * 1.4), h = Math.max(3, c * 0.06);
    const x = st.gx - w / 2, y = st.gy + c * (sp.rx * 0.36 + 0.06);
    ctx.fillStyle = 'rgba(10,6,4,.8)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = sp.kind === 'hero' ? '#d4a537' : '#c9353e';
    ctx.fillRect(x, y, w * clamp(sp.dispHp / sp.maxHp, 0, 1), h);
  }

  function drawPlacement() {
    if (!selected || !started || paused || S.phase !== 'running') return;
    if (S.purse != null) { // Reverse: light the doors, and the one a tap would send through
      const ds = HTL.mapOf(S).doors, pick = hover ? doorFor(hover.lane, hover.sq) : -1;
      ds.forEach((d, i) => { const r = sqRect(d.lane, d.sq); ctx.fillStyle = i === pick ? 'rgba(240,205,110,.35)' : 'rgba(240,205,110,.12)'; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); });
      return;
    }
    ctx.fillStyle = 'rgba(240,205,110,.09)';
    for (let lane = 0; lane < L.MH; lane++) for (let sq = 0; sq < L.MW; sq++) {
      if (!HTL.canPlace(S, selected, lane, sq)) { const r = sqRect(lane, sq); ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); }
    }
    if (hover) {
      const why = HTL.canPlace(S, selected, hover.lane, hover.sq), r = sqRect(hover.lane, hover.sq);
      ctx.lineWidth = 2; ctx.strokeStyle = why ? 'rgba(201,53,62,.9)' : '#f0cd6e';
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
  }
  function drawGhost() {
    if (!selected || !hover || !started || paused || HTL.canPlace(S, selected, hover.lane, hover.sq)) return;
    const s = spr(selected), k = 1 / L.dpr, p = gpos(hover.lane, hover.sq);
    ctx.globalAlpha = 0.5; ctx.save(); ctx.translate(p.x, p.y); if (L.horiz && SPRL.has(selected)) ctx.scale(-1, 1);
    ctx.drawImage(s.cv, -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k); ctx.restore(); ctx.globalAlpha = 1;
  }
  function drawBadSquares(now) {
    V.bad = V.bad.filter(b => now - b.t0 < 0.5);
    for (const b of V.bad) {
      const r = sqRect(b.lane, b.sq), p = (now - b.t0) / 0.5;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(201,53,62,' + (1 - p) + ')'; ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
  }
  // the holy ground glows a little, all the time
  // traps lie on the mat: caltrops, an oil flask, a Tinker's spring trap
  // Phase 7 floors: a trapdoor that has burst open is a dark hole with its lid thrown back; one about to open rattles;
  // an oven about to flare glows on the squares in front of it, and when it flares, fire rolls across them
  function drawFloorState(now) {
    const c = L.cell, M = L.map;
    if (M.hatches) M.doors.forEach((dr, i) => {
      if (!M.hatches[i]) return;
      const sq = sqRect(dr.lane, dr.sq), pad = c * 0.1;
      if (M.skylights) { // a skylight: once broken, daylight pours down onto it and the squares round it
        const cx = sq.x + sq.w / 2, cy = sq.y + sq.h / 2;
        if (S.opened && S.opened[i]) {
          const glow = ctx.createRadialGradient(cx, cy, c * 0.2, cx, cy, c * 1.6);
          glow.addColorStop(0, 'rgba(255,236,170,.32)'); glow.addColorStop(1, 'rgba(255,236,170,0)');
          ctx.fillStyle = glow; ctx.fillRect(cx - c * 1.5, cy - c * 1.5, c * 3, c * 3);
          ctx.fillStyle = 'rgba(255,244,205,.5)'; ctx.fillRect(sq.x + pad, sq.y + pad, sq.w - pad * 2, sq.h - pad * 2);
          ctx.strokeStyle = 'rgba(60,60,60,.7)'; ctx.lineWidth = Math.max(1, c * 0.02); // what is left of the frame, and a shard or two
          ctx.strokeRect(sq.x + pad, sq.y + pad, sq.w - pad * 2, sq.h - pad * 2);
          ctx.beginPath(); ctx.moveTo(sq.x + pad, sq.y + pad + c * 0.2); ctx.lineTo(sq.x + pad + c * 0.18, sq.y + pad); ctx.moveTo(sq.x + sq.w - pad, sq.y + sq.h - pad - c * 0.15); ctx.lineTo(sq.x + sq.w - pad - c * 0.22, sq.y + sq.h - pad); ctx.stroke();
        } else if (V.rattle && V.rattle[i] && now - V.rattle[i] < 2.2) {
          const p = (now - V.rattle[i]) / 2.2, a = Math.sin(p * 60) * c * 0.02 * (1 - p);
          ctx.strokeStyle = 'rgba(240,205,110,' + (0.7 * (1 - p)).toFixed(3) + ')'; ctx.lineWidth = Math.max(2, c * 0.04);
          ctx.strokeRect(sq.x + pad + a, sq.y + pad, sq.w - pad * 2, sq.h - pad * 2);
        }
        return;
      }
      if (M.lawn) { // a molehill: once open, a dark hole with the earth thrown up round it; before that it heaves
        const cx = sq.x + sq.w / 2, cy = sq.y + sq.h * 0.55;
        if (S.opened && S.opened[i]) {
          ctx.fillStyle = '#3a2e23'; ctx.beginPath(); ctx.ellipse(cx, cy, c * 0.4, c * 0.3, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#0b0807'; ctx.beginPath(); ctx.ellipse(cx, cy, c * 0.27, c * 0.18, 0, 0, TAU); ctx.fill();
        } else if (V.rattle && V.rattle[i] && now - V.rattle[i] < 2.2) {
          const p = (now - V.rattle[i]) / 2.2, a = Math.abs(Math.sin(p * 40)) * c * 0.05 * (1 - p);
          ctx.strokeStyle = 'rgba(240,205,110,' + (0.7 * (1 - p)).toFixed(3) + ')'; ctx.lineWidth = Math.max(2, c * 0.04);
          ctx.beginPath(); ctx.ellipse(cx, cy - a, c * 0.36, c * 0.25, 0, 0, TAU); ctx.stroke();
        }
        return;
      }
      if (S.opened && S.opened[i]) {
        ctx.fillStyle = '#0b0807'; ctx.fillRect(sq.x + pad, sq.y + pad, sq.w - pad * 2, sq.h - pad * 2);
        const dg = ctx.createLinearGradient(sq.x, sq.y + pad, sq.x, sq.y + sq.h - pad);
        dg.addColorStop(0, 'rgba(60,50,44,.8)'); dg.addColorStop(1, 'rgba(11,8,7,0)');
        ctx.fillStyle = dg; ctx.fillRect(sq.x + pad, sq.y + pad, sq.w - pad * 2, (sq.h - pad * 2) * 0.4);
        ctx.fillStyle = '#5f4835'; // the lid, thrown back against the floor
        if (L.horiz) ctx.fillRect(sq.x + pad, sq.y - c * 0.02, sq.w - pad * 2, pad * 0.9); else ctx.fillRect(sq.x - c * 0.02, sq.y + pad, pad * 0.9, sq.h - pad * 2);
      } else if (V.rattle && V.rattle[i] && now - V.rattle[i] < 2.2) {
        const p = (now - V.rattle[i]) / 2.2, a = Math.sin(p * 60) * c * 0.025 * (1 - p);
        ctx.strokeStyle = 'rgba(240,205,110,' + (0.7 * (1 - p)).toFixed(3) + ')'; ctx.lineWidth = Math.max(2, c * 0.04);
        ctx.strokeRect(sq.x + pad + a, sq.y + pad, sq.w - pad * 2, sq.h - pad * 2);
      }
    });
    if (M.gate) for (let l = 0; l < M.h; l++) for (let q = 0; q < M.w; q++) {
      if (M.rows[l][q] !== 'G') continue;
      const sq = sqRect(l, q), shut = S.gate && S.gate.until;
      ctx.fillStyle = '#4a3626'; // the gateposts at either end of the way through, not between its squares
      const lo = !(M.rows[l - 1] && M.rows[l - 1][q] === 'G'), hi = !(M.rows[l + 1] && M.rows[l + 1][q] === 'G');
      if (L.horiz) { if (lo) ctx.fillRect(sq.x + sq.w * 0.42, sq.y, sq.w * 0.16, c * 0.12); if (hi) ctx.fillRect(sq.x + sq.w * 0.42, sq.y + sq.h - c * 0.12, sq.w * 0.16, c * 0.12); }
      else { if (lo) ctx.fillRect(sq.x, sq.y + sq.h * 0.42, c * 0.12, sq.h * 0.16); if (hi) ctx.fillRect(sq.x + sq.w - c * 0.12, sq.y + sq.h * 0.42, c * 0.12, sq.h * 0.16); }
      if (!shut) continue;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(sq.x + c * 0.08, sq.y + sq.h * 0.5, sq.w - c * 0.1, c * 0.1);
      ctx.fillStyle = '#7a5a3c'; ctx.strokeStyle = '#2b2018'; ctx.lineWidth = Math.max(1, c * 0.02);
      for (let k = 0; k < 4; k++) { // upright planks across the way, with a rail
        if (L.horiz) { const x = sq.x + sq.w * (0.12 + k * 0.22); ctx.fillRect(x, sq.y + c * 0.04, sq.w * 0.14, sq.h - c * 0.08); ctx.strokeRect(x, sq.y + c * 0.04, sq.w * 0.14, sq.h - c * 0.08); }
        else { const y = sq.y + sq.h * (0.12 + k * 0.22); ctx.fillRect(sq.x + c * 0.04, y, sq.w - c * 0.08, sq.h * 0.14); ctx.strokeRect(sq.x + c * 0.04, y, sq.w - c * 0.08, sq.h * 0.14); }
      }
    }
    if (V.barrelWarn && now >= V.barrelWarn.t0 && now - V.barrelWarn.t0 < ROUND * 1.1) { // the next barrel shudders at the head of its chute
      let q = M.w - 1; while (q > 0 && PASS_FLOOR.indexOf(M.rows[V.barrelWarn.lane][q]) < 0) q--;
      const g0 = gpos(V.barrelWarn.lane, q), wob = Math.sin((now - V.barrelWarn.t0) * 30) * 0.06;
      drawBarrel(g0.x, g0.y, wob, 0.85);
    }
    for (const br of V.barrels || []) {
      const p = (now - br.t0) / br.dur; if (p < 0 || p > 1) continue;
      const q = br.from + (br.to - br.from) * p, g0 = gpos(br.lane, q);
      drawBarrel(g0.x, g0.y, (br.from - q) * 1.4 * (L.horiz ? -1 : 1), 1);
    }
    if (V.barrels) V.barrels = V.barrels.filter(br => now - br.t0 < br.dur + 0.2);
    if (M.oven) {
      const warn = V.ovenWarn != null && now >= V.ovenWarn && now - V.ovenWarn < ROUND * 1.2, fl = V.flare != null && now >= V.flare && now - V.flare < 1.2;
      if (warn || fl) for (const h of M.oven.hot) {
        const sq = sqRect(h.lane, h.sq);
        if (fl) {
          const p = (now - V.flare) / 1.2, a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
          const gr = ctx.createRadialGradient(sq.x + sq.w / 2, sq.y + sq.h * 0.6, 0, sq.x + sq.w / 2, sq.y + sq.h * 0.6, c * 0.75);
          gr.addColorStop(0, 'rgba(255,214,110,' + (0.95 * a).toFixed(3) + ')'); gr.addColorStop(0.55, 'rgba(245,110,35,' + (0.7 * a).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(200,40,20,0)');
          ctx.fillStyle = gr; ctx.fillRect(sq.x, sq.y, sq.w, sq.h);
          ctx.fillStyle = 'rgba(255,190,80,' + (0.8 * a).toFixed(3) + ')'; // tongues of flame, flickering upward
          for (let k = 0; k < 3; k++) {
            const fx = sq.x + sq.w * (0.22 + k * 0.28), fh = c * (0.35 + 0.2 * Math.sin(now * 23 + k * 2 + h.sq)) * a, fb = sq.y + sq.h * 0.85;
            ctx.beginPath(); ctx.moveTo(fx - c * 0.08, fb); ctx.quadraticCurveTo(fx - c * 0.05, fb - fh * 0.6, fx, fb - fh); ctx.quadraticCurveTo(fx + c * 0.05, fb - fh * 0.6, fx + c * 0.08, fb); ctx.fill();
          }
        } else {
          const pulse = 0.18 + 0.12 * Math.sin((now - V.ovenWarn) * 9);
          ctx.fillStyle = 'rgba(255,120,40,' + pulse.toFixed(3) + ')'; ctx.fillRect(sq.x + 1, sq.y + 1, sq.w - 2, sq.h - 2);
        }
      }
    }
  }
  // a barrel on its side, rolling along the row (rot turns it as it goes)
  function drawBarrel(x, y, rot, alpha) {
    const c = L.cell, rx = c * 0.3, ry = c * 0.22;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y - c * 0.12);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, c * 0.2, rx, c * 0.07, 0, 0, TAU); ctx.fill();
    ctx.rotate(L.horiz ? 0 : Math.PI / 2);
    ctx.fillStyle = '#7a5332'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b2622'; ctx.lineWidth = Math.max(1.5, c * 0.035);
    for (const f of [-0.55, 0, 0.55]) { const xx = rx * f + Math.sin(rot) * rx * 0.25; ctx.beginPath(); ctx.ellipse(xx, 0, c * 0.04, ry * 0.98, 0, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(30,20,12,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  // a barrel rolls the row at about seven squares a second, knocking over what it meets as it gets there
  function onBarrel(ev) {
    const span = Math.max(0.5, ev.from - ev.to), dur = Math.min(1.6, 0.25 + span * 0.14), t0 = ev.t + 0.05;
    (V.barrels || (V.barrels = [])).push({ lane: ev.lane, from: ev.from, to: ev.to, t0, dur });
    V.barrelWarn = null; sfx('thump', 0.7);
    for (const h of ev.hits) {
      const sp = V.sprites.get(h.id); if (!sp) continue;
      const at = t0 + dur * (ev.from - h.sq) / span;
      V.impacts.push({ at, fn: () => {
        if (h.saved) { sp.anims.push({ k: 'leap', t0: at, dur: 0.35, from: sp.sq, to: sp.sq, fromLane: sp.lane, toLane: sp.lane, lean: 0 }); V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'JUMPED CLEAR', col: '#e8dcc6' }); return; }
        sp.anims.push({ k: 'knock', t0: at, dur: 0.34, vx: L.horiz ? -1 : 0, vy: L.horiz ? 0 : 1, lean: L.horiz ? -1 : 0, amt: 0.25 }, { k: 'flash', t0: at, dur: 0.2 });
        sp.dispHp = Math.max(0, sp.dispHp - h.dmg); sfx(h.big ? 'crack' : 'thud', 0.8);
        V.pops.push({ t0: at, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: '−' + h.dmg + (h.big ? ' SMASHED' : ' BOWLED'), col: '#f2a46b' });
        if (h.killed) killSprite(sp, at, -1);
        if (h.big && SET.bits) V.fx.push({ k: 'bits', t0: at, dur: MitzMotion.MATERIALS.wood.life, lane: sp.lane, sq: sp.sq, ht: 0.2, mat: 'wood', ang: 0, seed: h.id * 13 + 1, scale: 1.4 });
      } });
    }
    if (ev.downed >= 3) V.impacts.push({ at: t0 + dur, fn: () => V.pops.push({ t0: t0 + dur, lane: ev.lane, sq: Math.max(0, ev.to), ht: 0.8, kind: 'label', text: 'STRIKE!', col: '#f0cd6e' }) });
  }
  function drawTraps() {
    const c = L.cell;
    for (const tp of S.traps) {
      const p = gpos(tp.lane, tp.sq);
      ctx.save(); ctx.translate(p.x, p.y + c * 0.12);
      ctx.strokeStyle = '#2c2d2c'; ctx.lineWidth = Math.max(1, c * 0.018); ctx.fillStyle = '#b3b3ad';
      if (tp.kind === 'bearings') {
        ctx.fillStyle = '#c9c7c0';
        for (const [dx, dy] of [[-0.2, -0.06], [0.14, -0.12], [0.03, 0.05], [-0.08, -0.17], [0.22, 0.04], [-0.14, 0.08], [0.08, -0.02]]) { ctx.beginPath(); ctx.arc(dx * c, dy * c, c * 0.028, 0, TAU); ctx.fill(); ctx.stroke(); }
      } else if (tp.kind === 'caltrops') {
        for (const [dx, dy] of [[-0.18, -0.05], [0.12, -0.1], [0.02, 0.06], [-0.06, -0.16], [0.2, 0.05]]) {
          ctx.beginPath();
          for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + dx * 9; ctx.moveTo(dx * c, dy * c); ctx.lineTo((dx + Math.cos(a) * 0.06) * c, (dy + Math.sin(a) * 0.035) * c); }
          ctx.stroke();
        }
      } else if (tp.kind === 'oil') {
        ctx.beginPath(); ctx.ellipse(0, 0, c * 0.22, c * 0.09, 0, 0, TAU); ctx.fillStyle = 'rgba(30,22,10,.45)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -c * 0.1, c * 0.09, c * 0.11, 0, 0, TAU); ctx.fillStyle = '#9a7a45'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#5b4426'; ctx.fillRect(-c * 0.025, -c * 0.27, c * 0.05, c * 0.08);
      } else { // spring trap: jaws
        ctx.beginPath(); ctx.ellipse(0, 0, c * 0.2, c * 0.08, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        for (let k = -3; k <= 3; k++) { ctx.moveTo(k * c * 0.05, -c * 0.03); ctx.lineTo(k * c * 0.05 + c * 0.02, -c * 0.09); }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawGround(now) {
    const c = L.cell, m = L.map, a = 0.1 + 0.06 * Math.sin(now * 2.2);
    for (let l = 0; l < m.h; l++) for (let q = 0; q < m.w; q++) {
      if (m.rows[l][q] !== '+') continue;
      const p = gpos(l, q), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, c * 0.6);
      g.addColorStop(0, 'rgba(255,226,140,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,226,140,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - c / 2, p.y - c / 2, c, c);
    }
  }
  // between waves: the doors the next wave will use, and the way it will come
  function drawRoutes(now) {
    if (!started || S.phase !== 'running') return;
    const pv = HTL.preview(S); if (!pv) return;
    const m = L.map, c = L.cell, pulse = 0.5 + 0.5 * Math.sin(now * 4);
    const flyers = Object.keys(pv.counts).some(type => HTL.MONSTERS[type].traits.flying);
    const route = (next, d) => {
      const pts = []; let at = { lane: d.lane, sq: d.sq }, lane = d.lane, guard = 0;
      while (at && !at.exit && guard++ < 200) { pts.push(gpos(at.lane, at.sq)); lane = at.lane; at = next[at.lane][at.sq]; }
      if (at && at.exit) pts.push(gpos(lane, -0.55)); // on into the tavern
      return pts;
    };
    // on a ring floor, one line takes every fork's first way and one its last; with the gate down, the ways round it
    const src = S.gate && S.gate.until ? m.shut : m, STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
    const ways = (f, d) => {
      if (!m.forks) return [route(f.next, d)];
      const go = pick => {
        const pts = []; let at = { lane: d.lane, sq: d.sq }, lane = d.lane, guard = 0;
        while (at && !at.exit && guard++ < 200) {
          pts.push(gpos(at.lane, at.sq)); lane = at.lane;
          const nx = f.next[at.lane][at.sq], here = f.dist[at.lane][at.sq], opts = [];
          if (nx && !nx.exit) for (const [dl, dq] of STEPS) {
            const l = at.lane + dl, q = at.sq + dq;
            if (l >= 0 && l < m.h && q >= 0 && q < m.w && isFinite(f.dist[l][q]) && Math.abs(f.cost(l, q) + f.dist[l][q] - here) < 1e-9) opts.push({ lane: l, sq: q });
          }
          at = opts.length > 1 ? pick(opts) : nx;
        }
        if (at && at.exit) pts.push(gpos(lane, -0.55));
        return pts;
      };
      const a = go(o => o[0]), b = go(o => o[o.length - 1]);
      return a.map(q => q.x + ',' + q.y).join() === b.map(q => q.x + ',' + q.y).join() ? [a] : [a, b];
    };
    const stroke = (pts, col, dash) => {
      ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineDashOffset = -now * c * 0.5;
      ctx.beginPath(); pts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)); ctx.stroke();
    };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const i of pv.doors) {
      const d = m.doors[i], r = sqRect(d.lane, d.sq);
      const walks = ways(src.fields.walk, d), walk = walks[0];
      ctx.lineWidth = Math.max(2, c * 0.05);
      for (const w of walks) stroke(w, 'rgba(201,53,62,.6)', [c * 0.05, c * 0.16]);
      if (flyers) {
        const fly = route(src.nextFly, d);
        if (fly.map(q => q.x + ',' + q.y).join() !== walk.map(q => q.x + ',' + q.y).join()) { ctx.lineWidth = Math.max(1.5, c * 0.03); stroke(fly, 'rgba(232,222,204,.45)', [c * 0.12, c * 0.12]); }
      }
      ctx.setLineDash([]); ctx.lineWidth = Math.max(2, c * 0.045);
      ctx.strokeStyle = 'rgba(201,53,62,' + (0.45 + 0.45 * pulse).toFixed(3) + ')';
      ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    }
    ctx.restore();
  }
  function drawScorch(now) {
    V.scorch = V.scorch.filter(s => now - s.t0 < 4);
    for (const s of V.scorch) {
      const p = gpos(s.lane, s.sq), a = 0.32 * (1 - (now - s.t0) / 4), c = L.cell;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, c * 1.3);
      g.addColorStop(0, 'rgba(15,8,4,' + a + ')'); g.addColorStop(1, 'rgba(15,8,4,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, c * 1.3, c * 1.05, 0, 0, TAU); ctx.fill();
    }
  }
  function drawTavernHits(now) {
    V.tavern = V.tavern.filter(h => now - h.t0 < 0.7);
    const t = tavRect(), c = L.cell;
    for (const h of V.tavern) {
      const p = (now - h.t0) / 0.7; if (p < 0) continue;
      ctx.fillStyle = 'rgba(201,53,62,' + (0.65 * (1 - p)) + ')';
      if (L.horiz) ctx.fillRect(t.x, t.y + h.lane * c, t.w, c); else ctx.fillRect(t.x + h.lane * c, t.y, c, t.h);
    }
  }

  // torch flicker, 0 to 1, in real time so the flames still move while the game is paused
  function flicker(i) { // gentler with reduced motion
    const t = performance.now() / 1000, w = 0.25 * Math.sin(t * 11 + i * 1.7) + 0.15 * Math.sin(t * 17.3 + i * 3.1) + 0.1 * Math.sin(t * 29.1 + i);
    return clamp(0.5 + w * (calm() ? 0.3 : 1), 0, 1);
  }
  function drawTorches() {
    if (!SET.torch) return;
    const c = L.cell;
    L.torches.forEach((tq, i) => {
      const fl = flicker(i), x = tq.x, y = tq.y;
      ctx.fillStyle = '#2a211b'; ctx.fillRect(x - c * 0.045, y - c * 0.03, c * 0.09, c * 0.17);
      ctx.fillStyle = '#6b5440'; ctx.fillRect(x - c * 0.075, y - c * 0.06, c * 0.15, c * 0.05);
      ctx.globalCompositeOperation = 'lighter';
      const r = c * (0.55 + 0.1 * fl), gl = ctx.createRadialGradient(x, y - c * 0.14, 0, x, y - c * 0.14, r);
      gl.addColorStop(0, 'rgba(255,190,90,' + (0.32 + 0.14 * fl).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y - c * 0.14, r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      const h = c * (0.2 + 0.06 * fl), w = c * 0.065, sway = (fl - 0.5) * c * 0.035, b = y - c * 0.06;
      ctx.fillStyle = '#ef8f34'; ctx.beginPath(); ctx.moveTo(x - w, b); ctx.quadraticCurveTo(x - w, b - h * 0.55, x + sway, b - h); ctx.quadraticCurveTo(x + w, b - h * 0.55, x + w, b); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.moveTo(x - w * 0.5, b); ctx.quadraticCurveTo(x - w * 0.5, b - h * 0.35, x + sway * 0.6, b - h * 0.62); ctx.quadraticCurveTo(x + w * 0.5, b - h * 0.35, x + w * 0.5, b); ctx.closePath(); ctx.fill();
    });
  }
  // dark battles: who stands where the torchlight doesn't reach, less any light a hero carries, or an ember gives off
  function lightsOf(list) {
    const out = [];
    for (const st of list) {
      if (st.pillar || st.sp.dead) continue;
      const h = PACK.heroes[st.sp.type], light = h && h.light ? h.light : materialOf(st.sp.type) === 'ember' ? 1 : 0;
      if (light) out.push({ x: st.gx, y: st.gy, r: L.cell * (light + 0.6), glow: L.cell * (0.7 + light * 0.35) });
    }
    return out;
  }
  function shadeAll(list) {
    const m = matRect(), lights = lightsOf(list);
    for (const st of list) {
      if (st.pillar) continue;
      const f = clamp(L.horiz ? (st.gx - m.x) / m.w : (m.y + m.h - st.gy) / m.h, 0, 1);
      let i = 1; while (i < DARK_STOPS.length - 1 && DARK_STOPS[i][0] < f) i++;
      const [f0, a0] = DARK_STOPS[i - 1], [f1, a1] = DARK_STOPS[i];
      let shade = a0 + (a1 - a0) * clamp((f - f0) / (f1 - f0), 0, 1), lit = 0;
      for (const l of lights) lit = Math.max(lit, clamp(1 - Math.hypot(st.gx - l.x, st.gy - l.y) / l.r, 0, 1));
      st.shade = shade * (1 - lit * 0.85);
    }
    V.lights = lights;
  }
  // warm pools round the light-bearers and blasts on a dark battle: a few small glows, cheap on a crowded mat
  function drawGlows(list) {
    if (!L.dark) return;
    const c = L.cell, fl = (flicker(0) + flicker(1)) / 2;
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,186,110,' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    };
    for (const l of V.lights || []) glow(l.x, l.y - c * 0.15, l.glow, 0.2 + 0.05 * fl);
    for (const f of V.fx) {
      const p = (V.now - f.t0) / f.dur; if (p < 0 || p >= 1) continue;
      if (f.k === 'boom') { const gp = gpos(f.lane, f.sq); glow(gp.x, gp.y, c * 2.4 * (1 - p * 0.5), 0.3 * (1 - p)); }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawFx(now) { FXM.drawFx(now); }
  function drawPops(now) { FXM.drawPops(now); }
  function drawCoins(now) { FXM.drawCoins(now); }
  function purseTarget() {
    const pr = $('purse').getBoundingClientRect(), cr = cv.getBoundingClientRect();
    return { x: pr.left + 14 - cr.left, y: pr.top + pr.height / 2 - cr.top };
  }
  let pursePulse = 0;
  function coinLanded() {
    sfx('coin', 0.5);
    if (performance.now() - pursePulse < 150) return;
    pursePulse = performance.now(); const el = $('purse'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }
  // motion and effects come from the shared module; the board tells it where things are
  const FXM = MitzMotion.create({
    ctx: () => ctx, layout: () => L, state: () => V, motion: motionLevel, font: UIF,
    toScreen: (lane, sq) => gpos(lane, sq), laneVec, dice: () => diceOn, mat: matRect, purse: purseTarget, onCoin: coinLanded
  });

  /* ---------- initiative track ---------- */
  function drawTrack(now) {
    const dpr = L ? L.dpr : 1, w = tcv.clientWidth, h = tcv.clientHeight;
    if (!w || !h) return;
    if (tcv.width !== Math.round(w * dpr) || tcv.height !== Math.round(h * dpr)) { tcv.width = Math.round(w * dpr); tcv.height = Math.round(h * dpr); }
    const g = tctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '600 11px ' + UIF; g.fillStyle = '#b8a78a'; g.fillText('ROUND', 0, h / 2 + 1);
    g.font = '700 19px ' + UIF; g.fillStyle = '#f1e7d2'; g.fillText(String(S.round), 44, h / 2 + 1);
    const x0 = 72, x1 = w - 6, ym = h / 2;
    g.fillStyle = '#3a2a20'; g.fillRect(x0, ym - 1, x1 - x0, 2);
    g.fillStyle = '#4b392b'; for (let i = 0; i <= 4; i++) g.fillRect(x0 + (x1 - x0) * i / 4 - 0.5, ym - 4, 1, 8);
    const rs = S.nextRoundAt - ROUND;
    for (const u of S.units) {
      if (!u.alive) continue;
      const f = clamp((u.actAt - rs) / ROUND, 0, 1), x = x0 + f * (x1 - x0), done = u.actedRound >= S.round, hero = u.kind === 'hero';
      g.globalAlpha = done ? 0.32 : 1; g.fillStyle = hero ? '#d4a537' : '#c9353e';
      g.beginPath(); g.arc(x, hero ? ym - 5 : ym + 5, 3, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    if (S.round > 0 && S.phase === 'running') {
      const f = clamp((now - rs) / ROUND, 0, 1), px = x0 + f * (x1 - x0);
      g.fillStyle = '#f1e7d2'; g.fillRect(px - 1, 3, 2, h - 6);
    }
  }

  /* ---------- HUD, tray, overlays ---------- */
  const shown = { gold: -1, lives: -1, wave: -2, phase: '', round: -1 };
  function hud() {
    if (S.gate) updateGate();
    const money = S.purse != null ? S.purse : S.gold, rv = HTL.battle(S).reverse;
    if (money !== shown.gold || S.phase !== shown.phase || S.round !== shown.round) {
      $('gold').textContent = money; shown.gold = money; shown.phase = S.phase; shown.round = S.round; updateCards();
      if (rv) $('wave').textContent = Math.max(0, rv.rounds - S.round);
    }
    if (S.lives !== shown.lives) {
      const el = $('lives'); el.innerHTML = '';
      for (let i = 0; i < S.maxLives; i++) { const p = document.createElement('span'); p.className = 'pip' + (i < S.lives ? '' : ' lost'); el.appendChild(p); }
      el.setAttribute('aria-label', 'Tavern lives: ' + S.lives + ' of ' + S.maxLives);
      shown.lives = S.lives;
    }
    if (!rv && S.wave !== shown.wave) { $('wave').textContent = S.wave < 0 ? '–' : (S.wave + 1) + (HTL.battle(S).endless ? '' : '/' + HTL.battle(S).waves.length); shown.wave = S.wave; }
  }

  function buildTray() {
    const tray = $('tray'); tray.innerHTML = '';
    tray.style.setProperty('--n', HERO_ORDER.length);
    const rev = S && S.purse != null;
    HERO_ORDER.forEach((type, i) => {
      const h = rev ? { name: PACK.monsters[type].name, cost: HTL.sendCost(type), role: HTL.MONSTERS[type].traits.boss ? 'Boss, once only' : 'Level ' + HTL.MONSTERS[type].level } : PACK.heroes[type];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'card' + (h.defender ? ' kit' : ''); b.id = 'card-' + type; b.dataset.type = type;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', h.name + (S && S.free ? '' : ', ' + h.cost + ' gold') + '. ' + h.role + '.');
      b.innerHTML = '<canvas width="88" height="88" aria-hidden="true"></canvas><span class="nm">' + h.name + '</span>' +
        '<span class="meta">' + (S && S.free ? '<span class="left">× ' + S.free[type] + '</span>' : '<span class="coin" aria-hidden="true"></span>' + h.cost) + '<span class="role">· ' + h.role + '</span></span><span class="key">' + (i < 9 ? i + 1 : i === 9 ? 0 : '') + '</span>' +
        (!rev && h.recharge ? '<span class="cool" aria-hidden="true"></span>' : '');
      b.addEventListener('click', () => selectHero(type));
      tray.appendChild(b);
    });
    drawTrayMinis();
  }
  function drawTrayMinis() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    for (const type of HERO_ORDER) {
      const c = document.querySelector('#card-' + type + ' canvas'); if (!c) continue;
      const css = c.clientWidth || 44; c.width = Math.round(css * dpr); c.height = Math.round(css * dpr);
      const m = TableMinis.render(figType(type), c.width * 0.66, figOpts(type)), g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / m.cv.width, c.height / m.cv.height);
      g.drawImage(m.cv, (c.width - m.cv.width * s) / 2, c.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
    }
  }
  const recharging = type => !!PACK.heroes[type] && !!PACK.heroes[type].recharge && S.round < (S.ready[type] || 0);
  // a hero can be placed: enough gold, or in a puzzle, one of them left on the bench
  const affords = type => (S.purse != null ? !HTL.canSend(S, type) : S.free ? S.free[type] > 0 : S.gold >= PACK.heroes[type].cost);
  function updateCards() {
    if (selected && (!affords(selected) || S.phase !== 'running' || recharging(selected))) selected = null;
    for (const type of HERO_ORDER) {
      const b = $('card-' + type); if (!b) continue;
      if (S.free) { const el = b.querySelector('.left'), t = '× ' + (S.free[type] || 0); if (el && el.textContent !== t) el.textContent = t; }
      b.disabled = !affords(type) || S.phase !== 'running' || recharging(type);
      b.setAttribute('aria-pressed', selected === type ? 'true' : 'false');
    }
  }
  // the shade over a recharging card drains away as the rounds pass
  function drawCooldowns(now) {
    for (const type of HERO_ORDER) {
      const h = PACK.heroes[type]; if (!h || !h.recharge) continue;
      const el = document.querySelector('#card-' + type + ' .cool'); if (!el) continue;
      const roundNow = S.round + clamp((now - (S.nextRoundAt - ROUND)) / ROUND, 0, 1);
      const left = clamp(((S.ready[type] || 0) - roundNow) / h.recharge, 0, 1);
      el.style.setProperty('--cool', left.toFixed(3));
    }
  }
  const SEND_WHY = { closed: 'The rounds are up: no more can be sent.', once: 'Only one boss to a battle.', purse: 'Not enough in the purse yet.', over: 'The battle is over.' };
  function selectHero(type) {
    if (!started || paused || S.phase !== 'running') return;
    if (cardId) closeCard();
    if (S.purse != null) { // Reverse: pick a monster to send
      const why = HTL.canSend(S, type);
      if (why) { hint(SEND_WHY[why] || 'That one can’t be sent.'); return; }
      selected = selected === type ? null : type; updateCards();
      if (selected) hint('Tap a door, or any square in its row, to send the ' + PACK.monsters[type].name + ' up the steps.');
      return;
    }
    if (recharging(type)) { const n = S.ready[type] - S.round; hint('The ' + PACK.heroes[type].name + ' is getting their breath back. Ready in ' + n + (n === 1 ? ' round.' : ' rounds.')); return; }
    if (!affords(type)) { hint(S.free ? 'No ' + PACK.heroes[type].name + ' left on the bench.' : 'Not enough gold for a ' + PACK.heroes[type].name + ' yet.'); return; }
    selected = selected === type ? null : type; aiming = null; updatePowers();
    updateCards();
    if (selected) hint('Tap a square on the mat to place your ' + PACK.heroes[type].name + '.');
  }

  let toastTimer = 0, hintTimer = 0, hintBusy = false;
  const hintQ = [];
  function toast(eye, title, line) {
    const t = $('toast');
    t.querySelector('.t-eye').textContent = eye; t.querySelector('.t-title').textContent = title; t.querySelector('.t-line').textContent = line;
    t.hidden = false; t.classList.remove('out');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.add('out'); toastTimer = setTimeout(() => { t.hidden = true; }, 380); }, 3800);
  }
  function hint(text, ms, label) {
    const h = $('hint'); h.textContent = '';
    if (label) { const b = document.createElement('b'); b.className = 'hk'; b.textContent = label; h.appendChild(b); }
    h.appendChild(document.createTextNode(text));
    h.hidden = false; h.classList.remove('out'); hintBusy = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      h.classList.add('out');
      hintTimer = setTimeout(() => {
        h.hidden = true; hintBusy = false;
        if (hintQ.length) { const n = hintQ.shift(); hint(n[1], 3600, n[0]); }
      }, 320);
    }, ms || 2200);
  }
  function dropHint() { // a hint whose job is done fades now rather than waiting out its time
    const h = $('hint'); if (h.hidden) return;
    clearTimeout(hintTimer); h.classList.add('out');
    hintTimer = setTimeout(() => { h.hidden = true; hintBusy = false; if (hintQ.length) { const n = hintQ.shift(); hint(n[1], 3600, n[0]); } }, 320);
  }
  // new monsters introduce themselves one at a time
  function queueHint(label, text) { if (hintBusy) hintQ.push([label, text]); else hint(text, 3600, label); }
  const REASONS = { inside: 'That hero is inside a gelatinous cube.', locked: 'That hero stayed at the bar for this battle.', recharging: 'The Barbarian is still getting their breath back.', occupied: 'That square is taken.', off: 'Heroes can’t stand on doors, pillars or pits. Pick an open square.', gold: 'Not enough gold yet.', over: 'The battle is over.', limit: 'None of those left on the bench.' };

  /* ---------- the Cat & Mouse: the hub between battles, with rooms that open as you win ---------- */
  const CAMP = HTL_CAMPAIGN;
  const store = () => { try { return window.localStorage; } catch (e) { return null; } };
  let camp = CAMP.load(store(), loadWon());
  LOOKS = camp.looks;
  const saveCamp = () => CAMP.save(store(), camp);
  const today = () => new Date().toISOString().slice(0, 10);
  const starRow = (n, of) => '<span class="stars" aria-label="' + n + ' of ' + (of || 3) + ' stars">' + '★'.repeat(n) + '<i>' + '★'.repeat((of || 3) - n) + '</i></span>';
  const coins = n => '<span class="coin" aria-hidden="true"></span>' + n.toLocaleString('en-GB');
  // a mini drawn into a card's canvas, standing on its base
  function miniInto(c, type, px, opts) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5); c.width = c.height = Math.round(px * dpr);
    const m = TableMinis.render(figType(type), c.width * 0.66, opts || figOpts(type)), g = c.getContext('2d'), s = Math.min(c.width / m.cv.width, c.height / m.cv.height);
    g.drawImage(m.cv, (c.width - m.cv.width * s) / 2, c.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
  }
  function catLine() {
    const n = cellarWins(), total = CAMP.CELLAR.length, who = (camp.totals.battles % 2) ? 'Simz' : 'Mitz';
    const lines = n === 0 ? ['Something has been nicking the cheese from the cellar. Something with a lot of cousins.', 'The cellar door is rattling again. Pick a few regulars and have a look.']
      : n >= total ? ['That was everything under the tavern. The regulars are telling it taller every night.', 'Quiet down there now. Too quiet. Fancy another go on Deadly?']
      : ['The cellar goes deeper than anyone thought. ' + (total - n) + ' to go.', 'The regulars are getting good at this. The takings are getting better too.', 'Mind the steps. And the things on the steps.'];
    return { who, line: lines[camp.totals.battles % lines.length] };
  }
  function showTavern(from) {
    const o = $('overlay'), n = cellarWins(), total = CAMP.CELLAR.length, rooms = CAMP.rooms(camp), cat = catLine();
    const buyable = Object.keys(CAMP.UPGRADES).filter(k => { const u = CAMP.nextUpgrade(camp, k); return u.open && u.next && camp.takings >= u.next.cost; }).length;
    const status = { cellar: n + ' of ' + total + ' won', trophies: Object.keys(camp.trophies).length + ' of ' + CAMP.TROPHIES.length + ' trophies',
      works: buyable ? buyable + (buyable === 1 ? ' upgrade' : ' upgrades') + ' to buy' : 'Nothing you can afford yet',
      armoury: camp.items.length + ' of ' + Object.keys(HTL.ITEMS).length + ' found', cats: (CAMP.duty(camp) === 'mitz' ? 'Mitz' : 'Simz') + ' is on watch next',
      games: MODES ? modeStatus('daily') : '', house: CAMP.HOUSE.filter(id => CAMP.won(camp, id)).length + ' of ' + CAMP.HOUSE.length + ' won' };
    o.innerHTML = '<div class="panel wide hub" role="dialog" aria-labelledby="ovTitle">' +
      '<span class="eyebrow">Mitz &amp; Simz’s tavern</span><h2 id="ovTitle">The Cat &amp; Mouse</h2>' +
      '<p class="persona"><span>' + cat.who + ':</span> ' + cat.line + '</p>' +
      (camp.totals.battles ? '' : '<ul class="how">' +
        '<li><b>Tap a hero, then a square</b> to put the mini on the mat.</li>' +
        '<li><b>Bards earn gold.</b> Slain monsters drop it too.</li>' +
        '<li><b>Every attack is a d20 roll</b> against armour class. Tap any mini to see what it does.</li>' +
        '<li><b>Win battles</b> to open the next one down, earn the takings and fix up the tavern.</li>' +
        '<li>Press <b>Auto</b> and Simz places heroes for you, so you can sit back and watch.</li></ul>') +
      '<div class="takings"><span class="lbl">The takings</span><b>' + coins(camp.takings) + '</b></div>' +
      '<div class="rooms">' + rooms.map(r => '<button type="button" class="room" data-room="' + r.id + '"' + (r.open ? '' : ' disabled') + '>' +
        '<b>' + r.name + '</b><span>' + (r.open ? r.line : r.shut || 'Boarded up. Opens after your ' + (r.wins === 1 ? 'first win' : r.wins + ' wins') + '.') + '</span>' +
        (r.open ? '<em>' + status[r.id] + '</em>' : '') + '</button>').join('') + '</div>' +
      '<h3 class="pick">Tonight’s regulars</h3><div class="regulars" aria-label="' + CAMP.roster(camp).map(t => PACK.heroes[t].name).join(', ') + '"><canvas aria-hidden="true"></canvas></div>' +
      '<div class="btnrow">' + (from === 'pause' ? '<button class="secondary" id="btnBack" type="button">Back</button>' : '') +
      '<button class="secondary" id="btnSettings" type="button">Settings</button><button class="secondary" id="btnCredits" type="button">Credits</button></div>' +
      (from === 'pause' ? '' : '<p class="support-line">' + KOFI_LINE + ' <span aria-hidden="true">·</span> ' + SITE_LINK + '</p>') + '</div>';
    o.hidden = false;
    o.querySelectorAll('.room').forEach(btn => btn.addEventListener('click', () => {
      const r = btn.dataset.room;
      if (r === 'cellar') showCellar(from); else if (r === 'trophies') showTrophies(from, 'trophies'); else if (r === 'works') showWorks(from);
      else if (r === 'armoury') showArmoury(from); else if (r === 'cats') showCats(from); else if (r === 'games' && MODES) showGames(from);
      else if (r === 'house') showHouse(from);
    }));
    if ($('btnBack')) $('btnBack').addEventListener('click', showPause);
    $('btnSettings').addEventListener('click', () => showSettings(() => showTavern(from)));
    $('btnCredits').addEventListener('click', () => showCredits(from));
    drawRegulars();
    (o.querySelector('.room:not([disabled])') || $('btnSettings')).focus();
  }
  // the roster lined up along the bar
  function drawRegulars() {
    const c = document.querySelector('#overlay .regulars canvas'); if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#3a281c'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a1d16'; g.fillRect(0, h - 9, w, 9);
    const types = CAMP.roster(camp), u = Math.min(h / 1.25, 44), step = Math.min(u * 0.9, (w - 16) / types.length), x0 = (w - step * types.length) / 2;
    types.forEach((t, i) => { const sp = TableMinis.sprite(figType(t), u * dpr, figOpts(t)); g.drawImage(sp.cv, x0 + (i + 0.5) * step - sp.ax / dpr, h - 10 - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr); });
  }

  /* ---------- the cellar map: every battle in order, with its stars, opening one by one ---------- */
  function battleCard(b, i, list) {
    const st = CAMP.stars(camp, b.id), open = CAMP.unlocked(camp, b.id);
    const prev = HTL.battleById(i > 0 ? list[i - 1] : CAMP.HOUSE_OPENS); // the house's first battle opens with the Red Wyrm's Lair
    const meta = (b.map !== 'classic' ? HTL.MAPS[b.map].name + ' · ' : '') + 'Monster levels ' + b.levels[0] + '–' + b.levels[1] + ' · ' + b.monsters.length + ' kinds · ' + b.waves.length + ' waves';
    return '<button class="battle' + (open ? '' : ' locked') + '" type="button" data-id="' + b.id + '"' + (open ? '' : ' disabled') +
      ' aria-label="Battle ' + (i + 1) + ': ' + b.name + (open ? (st ? ', ' + st + ' of 3 stars' : '') : ', opens when ' + prev.name + ' is won') + '">' +
      '<canvas aria-hidden="true"></canvas>' +
      '<span class="b-name"><span class="b-num">' + (i + 1) + '</span>' + b.name + (st ? starRow(st) : '') + '</span>' +
      '<span class="b-meta">' + (open ? meta : 'Win ' + prev.name + ' to open') + '</span></button>';
  }
  function showCellar(from) {
    const o = $('overlay');
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
      '<span class="eyebrow">Under the Cat &amp; Mouse</span><h2 id="ovTitle">The cellar map</h2>' +
      '<p class="lede">Each battle opens when the one before it is won. Stars are for lives kept: three for none lost, two for one or two.</p>' +
      '<div class="battles">' + CAMP.CELLAR.map((id, i) => battleCard(HTL.battleById(id), i, CAMP.CELLAR)).join('') + '</div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => showParty(btn.dataset.id, from)));
    $('btnBack').addEventListener('click', () => showTavern(from));
    drawStrips();
    const open = [...o.querySelectorAll('.battle:not([disabled])')]; (open[open.length - 1] || $('btnBack')).focus();
  }

  // which campaign a battle belongs to, and where it stands in it
  function campaignOf(b) {
    if (!b || b.mode) return null;
    const h = CAMP.HOUSE.indexOf(b.id);
    if (h >= 0) return { list: CAMP.HOUSE, i: h, house: true };
    const i = CAMP.CELLAR.indexOf(b.id);
    return i >= 0 ? { list: CAMP.CELLAR, i, house: false } : null;
  }
  const cellarWins = () => CAMP.CELLAR.filter(id => CAMP.won(camp, id)).length;

  /* ---------- the house plan: the rest of the Cat & Mouse, part by part ---------- */
  function showHouse(from) {
    const o = $('overlay'), parts = PACK.parts || {}, ids = CAMP.HOUSE;
    const groups = Object.keys(parts).map(k => ({ k, part: parts[k], ids: ids.filter(id => HTL.battleById(id).part === k) })).filter(g => g.ids.length);
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
      '<span class="eyebrow">The rest of the Cat &amp; Mouse</span><h2 id="ovTitle">The house plan</h2>' +
      '<p class="lede">The monsters have found the other ways in. Each battle opens when the one before it is won, and every part of the house has a trick of its own.</p>' +
      groups.map(g => '<h3 class="pick">' + g.part.name + '</h3><p class="part-line">' + g.part.line + '</p>' +
        '<div class="battles">' + g.ids.map(id => battleCard(HTL.battleById(id), ids.indexOf(id), ids)).join('') + '</div>').join('') +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => showParty(btn.dataset.id, from)));
    $('btnBack').addEventListener('click', () => showTavern(from));
    drawStrips();
    const open = [...o.querySelectorAll('.battle:not([disabled])')]; (open[open.length - 1] || $('btnBack')).focus();
  }

  /* ---------- repairs and extensions: the takings, spent on the tavern ---------- */
  function showWorks(from) {
    const o = $('overlay');
    const row = k => {
      const u = CAMP.nextUpgrade(camp, k), can = u.open && u.next && camp.takings >= u.next.cost;
      return '<div class="work' + (u.open ? '' : ' shut') + '"><div class="work-lab"><b>' + u.name + '</b>' +
        '<span class="work-lvl">' + starRow(u.level, u.max) + '</span>' +
        '<span>' + (u.now ? 'Now: ' + u.now : 'Not yet built.') + '</span>' +
        (u.open ? (u.next ? '<span class="work-next">Next: ' + u.next.text + '</span>' : '<span class="work-next">Finished.</span>') : '<span class="work-next">Opens after your ' + (u.opensAt === 1 ? 'first win' : u.opensAt + ' wins') + '.</span>') +
        '</div>' + (u.open && u.next ? '<button class="buy" type="button" data-k="' + k + '"' + (can ? '' : ' disabled') + '>' + coins(u.next.cost) + '</button>' : '') + '</div>';
    };
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">Repairs and extensions</h2>' +
      '<p class="lede">Every win pays into the takings. Spend them here: each improvement helps in every battle from now on.</p>' +
      '<div class="takings"><span class="lbl">The takings</span><b id="takingsNow">' + coins(camp.takings) + '</b></div>' +
      '<div class="works">' + Object.keys(CAMP.UPGRADES).map(row).join('') + '</div>' +
      '<div class="btnrow"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.buy').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.k, why = CAMP.buy(camp, k);
      if (why) { hint(why === 'takings' ? 'Not enough in the takings yet.' : 'That can’t be built yet.', 1800); return; }
      saveCamp(); sfx('coin'); sfx('clack');
      hint(CAMP.UPGRADES[k].name + ': ' + CAMP.nextUpgrade(camp, k).now, 2600);
      showWorks(from);
    }));
    $('btnBack').addEventListener('click', () => showTavern(from));
    $('btnBack').focus();
  }

  /* ---------- the armoury: magic items, each given to one kind of hero ---------- */
  function showArmoury(from) {
    const o = $('overlay'), ros = CAMP.roster(camp);
    const source = id => { const b = Object.keys(CAMP.DROPS).find(k => CAMP.DROPS[k] === id); if (b) return 'Comes up from ' + HTL.battleById(b).name + ' the first time it is won.';
      const t = CAMP.TROPHIES.find(x => x.item === id); return t ? 'The reward for the trophy “' + t.name + '”.' : ''; };
    const card = id => {
      const it = HTL.ITEMS[id], owned = camp.items.indexOf(id) >= 0;
      if (!owned) return '<div class="item unmet"><b>Not found yet</b><span>' + source(id) + '</span></div>';
      const who = it.for.filter(t => ros.indexOf(t) >= 0), on = Object.keys(camp.equip).find(t => camp.equip[t] === id);
      return '<div class="item"><b>' + it.name + '</b><span>' + it.text + '</span>' +
        (who.length ? '<div class="givers" role="group" aria-label="Give the ' + it.name + ' to">' + who.map(t => '<button type="button" data-item="' + id + '" data-t="' + t + '" aria-pressed="' + (on === t) + '">' +
          PACK.heroes[t].name + (camp.equip[t] && camp.equip[t] !== id ? ' (has ' + HTL.ITEMS[camp.equip[t]].name + ')' : '') + '</button>').join('') + '</div>'
          : '<span class="item-none">Nobody at the tavern can carry this yet.</span>') + '</div>';
    };
    const ids = Object.keys(HTL.ITEMS).sort((a, b) => (camp.items.indexOf(b) >= 0) - (camp.items.indexOf(a) >= 0));
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The armoury</h2>' +
      '<p class="lede">Give each item to one kind of hero, and every one of them carries it into battle. Tap again to take it back.</p>' +
      '<p class="diff-line">' + camp.items.length + ' of ' + ids.length + ' found.</p>' +
      '<div class="items">' + ids.map(card).join('') + '</div>' +
      '<h3 class="pick">The belt<span class="count">' + coins(camp.takings) + '</span></h3>' +
      '<p class="diff-line">Things to throw in battle, one a round, onto a single square: everything piled there is hit. Bought from the takings; each throw uses one up. They stay behind on Deadly.</p>' +
      '<div class="items">' + Object.keys(HTL.THROWS).map(k => { const th = HTL.THROWS[k], n = camp.belt[k] || 0;
        return '<div class="item"><b>' + th.name + ' <em class="have">' + n + '</em></b><span>' + th.text + '</span><div class="givers"><button type="button" data-buy="' + k + '"' +
          (camp.takings < th.cost || n >= CAMP.BELT_MAX ? ' disabled' : '') + '>Buy one for ' + th.cost + '</button></div></div>'; }).join('') + '</div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      if (CAMP.buyThrow(camp, b.dataset.buy)) return; saveCamp(); sfx('coin'); showArmoury(from);
      const again = document.querySelector('[data-buy="' + b.dataset.buy + '"]'); if (again && !again.disabled) again.focus();
    }));
    o.querySelectorAll('.givers button[data-item]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.item, t = b.dataset.t;
      CAMP.equip(camp, t, camp.equip[t] === id ? null : id); saveCamp(); sfx('clack');
      showArmoury(from);
      const again = document.querySelector('.givers button[data-item="' + id + '"][data-t="' + t + '"]'); if (again) again.focus();
    }));
    $('btnBack').addEventListener('click', () => showTavern(from));
    if (!document.activeElement || document.activeElement === document.body) $('btnBack').focus({ preventScroll: true });
  }

  /* ---------- the cats' corner: Mitz and Simz, and whose turn it is to keep watch ---------- */
  function showCats(from) {
    const o = $('overlay'), duty = CAMP.duty(camp), P = HTL.POWERS;
    const card = k => { const p = P[k], on = p.cat === duty, name = p.cat === 'mitz' ? 'Mitz' : 'Simz';
      return '<div class="item' + (on ? ' duty' : '') + '"><b>' + name + '’s ' + p.name + (on ? ' <em>On watch</em>' : '') + '</b><span>' + p.text + '</span>' +
        '<span class="item-none">Ready every ' + p.every[on ? 1 : 0] + ' rounds' + (on ? ', twice as often as usual.' : '.') + ' Key: ' + (k === 'pounce' ? 'Q' : 'W') + '.</span></div>'; };
    o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The cats’ corner</h2>' +
      '<p class="persona"><span>' + (duty === 'mitz' ? 'Mitz' : 'Simz') + ':</span> ' + (duty === 'mitz' ? 'My turn on watch. Anything that comes up those steps in a bunch is getting pounced.' : 'My turn on watch. If it’s not the big one, it’s going off the table.') + '</p>' +
      '<div class="items">' + card('pounce') + card('swat') + '</div>' +
      '<p class="diff-line">They take turns keeping watch, battle by battle. In a battle, tap a cat in the bar at the top, then the mat.</p>' +
      '<div class="btnrow"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    $('btnBack').addEventListener('click', () => showTavern(from));
    $('btnBack').focus();
  }

  /* ---------- the belt in battle: pick a throwable, then a square ---------- */
  let throwing = null;
  const THROW_WHY = { once: 'One throw a round.', empty: 'None left in the belt.', target: 'Throw it where the monsters are.', occupied: 'Something is already there.', off: 'Not there.' };
  function buildBelt() {
    const box = $('belt'); if (!box) return;
    box.innerHTML = ''; box.hidden = !S.belt;
    if (!S.belt) return;
    for (const k in S.belt) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pw th'; b.id = 'th-' + k; b.dataset.kind = k;
      b.title = HTL.THROWS[k].name + ': ' + HTL.THROWS[k].text;
      b.innerHTML = '<b>' + HTL.THROWS[k].name + '</b><span class="pw-cd" id="thn-' + k + '"></span>';
      b.addEventListener('click', () => {
        if (!started || paused || S.phase !== 'running') return;
        const why = HTL.canThrow(S, k, -1, -1); if (why === 'once' || why === 'empty') { hint(THROW_WHY[why]); return; }
        selected = null; aiming = null; throwing = throwing === k ? null : k; updateCards(); updatePowers(); updateBelt();
        if (throwing) hint('Tap a square to throw the ' + HTL.THROWS[k].name.toLowerCase() + '. ' + HTL.THROWS[k].text, 3400); else dropHint();
      });
      box.appendChild(b);
    }
  }
  function updateBelt() {
    if (!S.belt) return;
    for (const k in S.belt) {
      const b = $('th-' + k); if (!b) continue;
      const n = S.belt[k], t = '× ' + n;
      if ($('thn-' + k).textContent !== t) $('thn-' + k).textContent = t;
      b.disabled = !n || S.phase !== 'running' || S.thrownRound === S.round;
      b.setAttribute('aria-pressed', throwing === k ? 'true' : 'false');
    }
  }

  /* ---------- the cats' powers in battle ---------- */
  let aiming = null;
  const POWER_WHY = { cooldown: 'Not ready yet.', target: 'Nothing there to pounce on.', boss: 'Not even Simz can shift the boss.', none: '', over: '' };
  function aim(k) {
    if (!started || paused || S.phase !== 'running' || !S.powers || !S.powers[k]) return;
    const left = S.powers[k].ready - S.round;
    if (left > 0) { hint((k === 'pounce' ? 'Mitz' : 'Simz') + ' is ready in ' + left + (left === 1 ? ' round.' : ' rounds.')); return; }
    if (cardId) closeCard();
    selected = null; aiming = aiming === k ? null : k; updateCards(); updatePowers();
    if (!aiming) dropHint();
    else hint(k === 'pounce' ? 'Tap a square: Mitz pounces on every monster in the 3 × 3 around it.' : 'Tap a monster: Simz swats it off the table. Not the boss.', 3200);
  }
  // the yard gate: one drop a battle, shut for a few rounds
  const GATE_WHY = { none: 'There is no gate here.', over: 'The battle is over.', used: 'The gate has been dropped once already this battle.', blocked: 'Something is standing in the gateway.' };
  function updateGate() {
    const box = $('gatebox'); if (!box) return;
    const has = !!(S && L && L.map.gate && S.gate);
    if (box.hidden !== !has) box.hidden = !has;
    if (!has) return;
    const label = S.gate.until ? 'shut · ' + Math.max(0, S.gate.until - S.round) : S.gate.used ? 'used' : 'ready';
    if ($('cd-gate').textContent !== label) $('cd-gate').textContent = label;
    const off = !!HTL.canShutGate(S);
    if ($('btnGate').disabled !== off) $('btnGate').disabled = off;
  }
  function dropGate() {
    if (!S || !S.gate) return;
    const why = HTL.shutGate(S);
    if (why) { hint(GATE_WHY[why] || 'Not now.'); return; }
    updateGate();
  }
  function updatePowers() {
    updateGate();
    const box = $('cats'); if (!box) return;
    box.hidden = !(S && S.powers);
    if (box.hidden) return;
    for (const k in S.powers) {
      const b = $('pw-' + k), left = Math.max(0, S.powers[k].ready - S.round);
      b.disabled = S.phase !== 'running' || left > 0;
      b.setAttribute('aria-pressed', aiming === k ? 'true' : 'false');
      b.classList.toggle('duty', HTL.POWERS[k].cat === S.duty);
      const cd = left ? 'in ' + left : 'ready';
      if ($('cd-' + k).textContent !== cd) $('cd-' + k).textContent = cd;
    }
  }
  // which edge of the table a paw comes from: the nearer of the two along the rows
  function edgeFor(lane, sq) {
    const c = L.cell, g = gpos(lane, sq), m = matRect();
    if (L.horiz) { const up = g.y - m.y, down = m.y + m.h - g.y; return up <= down ? { ex: 0, ey: -1, reach: up / c + 1.1 } : { ex: 0, ey: 1, reach: down / c + 1.1 }; }
    const left = g.x - m.x, right = m.x + m.w - g.x; return left <= right ? { ex: -1, ey: 0, reach: left / c + 1.1 } : { ex: 1, ey: 0, reach: right / c + 1.1 };
  }
  function onPounce(ev) {
    const e = edgeFor(ev.lane, ev.sq), t0 = ev.t, hit = t0 + (calm() ? 0 : 0.28);
    if (!calm()) V.fx.push({ k: 'paw', t0, dur: 0.7, lane: ev.lane, sq: ev.sq, ex: e.ex, ey: e.ey, reach: e.reach, fur: '#151316', rim: '#57525e' });
    catTag('Mitz', ev.lane, ev.sq, e.ex, e.ey, t0, 0.9); // Pounce is Mitz's
    V.impacts.push({ at: hit, fn: () => { sfx('thump'); sfx('swat', 0.6); shake(0.6); } });
    V.pops.push({ t0: hit, lane: ev.lane, sq: ev.sq, ht: 0.6, kind: 'label', text: 'POUNCE', col: '#e8dcc6', slot: -1 });
    for (const id of ev.ids) { const sp = V.sprites.get(id); if (sp) { if (!calm()) sp.anims.push({ k: 'wobble', t0: hit, dur: 0.5 }); V.impacts.push({ at: hit, fn: () => { sp.stunned = true; } }); } }
  }
  function onSwat(ev) {
    const sp = V.sprites.get(ev.id); if (!sp) return;
    const e = edgeFor(sp.lane, sp.sq), t0 = ev.t, contact = t0 + 0.4;
    sp.dead = true; sp.swatted = true;
    catTag('Simz', sp.lane, sp.sq, e.ex, e.ey, t0, 1.0); // Swat is Simz's
    if (calm()) { sp.anims.push({ k: 'fade', t0: contact, dur: 0.5, persist: true }); sp.removeAt = contact + 0.5; }
    else {
      V.fx.push({ k: 'paw', t0, dur: 1.0, lane: sp.lane, sq: sp.sq, ex: e.ex, ey: e.ey, reach: e.reach, fur: '#151316', rim: '#57525e' });
      sp.anims.push({ k: 'swat', t0: contact, dur: 0.6, vx: e.ex, vy: e.ey, dist: e.reach, dir: sp.id % 2 ? 1 : -1, persist: true });
      sp.removeAt = t0 + 1.0;
    }
    V.pops.push({ t0: contact, lane: sp.lane, sq: sp.sq, ht: 0.5, kind: 'label', text: 'SWAT', col: '#e8dcc6', slot: -1 });
    V.impacts.push({ at: contact, fn: () => { sfx('swat'); const b = V.bounty[sp.id]; if (b) { spawnCoins(sp.lane, sp.sq, b >= 20 ? 3 : b >= 10 ? 2 : 1, contact); delete V.bounty[sp.id]; } } });
  }
  function drawAim() {
    if ((!aiming && !throwing) || !hover || !started || paused) return;
    const sq = (l, q, col) => { if (l < 0 || q < 0 || l >= L.MH || q >= L.MW) return; const r = sqRect(l, q); ctx.fillStyle = col; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); };
    if (throwing) { sq(hover.lane, hover.sq, 'rgba(240,205,110,.32)'); return; }
    if (aiming === 'pounce') { for (let l = -1; l <= 1; l++) for (let q = -1; q <= 1; q++) sq(hover.lane + l, hover.sq + q, 'rgba(240,205,110,.22)'); }
    else { const m = HTL.unitAt(S, hover.lane, hover.sq); sq(hover.lane, hover.sq, m && m.kind === 'monster' ? ((HTL.MONSTERS[m.type].traits || {}).boss ? 'rgba(201,53,62,.35)' : 'rgba(240,205,110,.3)') : 'rgba(241,231,210,.12)'); }
  }

  /* ---------- the back room: Endless, the Daily Challenge, the Boss Rush and the puzzles ---------- */
  const MODES = typeof HTL_MODES !== 'undefined' ? HTL_MODES : null;
  const newSeed = () => ((Math.random() * 4294967295) >>> 0) || 1;
  function modeStatus(id) {
    const m = camp.modes, d = m.daily[today()];
    if (id === 'endless') return m.endless ? 'Best: ' + m.endless + (m.endless === 1 ? ' wave' : ' waves') : 'Not tried yet';
    if (id === 'daily') return d ? (d.won ? 'Won today · ' : 'Tried today · ') + 'best score ' + d.score : 'Today’s battle is waiting';
    if (id === 'reverse') { const n = Object.keys(m.reverse).length; return n ? n + ' of ' + CAMP.CELLAR.length + ' taken' : 'Win a battle, then try taking it'; }
    if (id === 'rush') return m.rush ? 'Won, keeping ' + m.rush + (m.rush === 1 ? ' life' : ' lives') + ' at best' : 'Not won yet';
    return Object.keys(m.puzzles).length + ' of ' + MODES.PUZZLES.length + ' solved';
  }
  function showGames(from) {
    const o = $('overlay');
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The back room</h2>' +
      '<p class="lede">Where the regulars go when the cellar is quiet. Wins here pay into the takings, and every monster slain counts on the trophy wall.</p>' +
      '<div class="rooms modes">' + MODES.MODES.map(md => '<button type="button" class="room" data-mode="' + md.id + '"><b>' + md.name + '</b><span>' + md.line + '</span><em>' + modeStatus(md.id) + '</em></button>').join('') + '</div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.room').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.mode;
      if (k === 'endless') showParty(MODES.endlessId(newSeed()), from);
      else if (k === 'daily') showDaily(from);
      else if (k === 'rush') showParty(MODES.rushId(), from);
      else if (k === 'reverse') showReverse(from);
      else showPuzzles(from);
    }));
    $('btnBack').addEventListener('click', () => showTavern(from));
    o.querySelector('.room').focus();
  }
  // a party shown as minis in a row, for the battles that bring their own
  function partyStrip(types) {
    return '<div class="party fixed">' + types.map(t => '<div class="regular" data-t="' + t + '"><canvas aria-hidden="true"></canvas><b>' + PACK.heroes[t].name +
      '</b></div>').join('') + '</div>';
  }
  function drawStripMinis() { document.querySelectorAll('#overlay .party.fixed .regular canvas').forEach(c => miniInto(c, c.parentNode.dataset.t, 40)); }
  function showDaily(from) {
    const o = $('overlay'), date = today(), id = MODES.dailyId(date), b = HTL.battleById(id), d = camp.modes.daily[date];
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">' + date + ' · ' + HTL.MAPS[b.map].name + '</span><h2 id="ovTitle">The Daily Challenge</h2>' +
      '<p class="persona"><span>Mitz:</span> ' + b.line + '</p>' +
      '<p class="diff-line">Medium, ' + b.waves.length + ' waves, and none of the tavern’s help. The score is 10 for each monster slain, 100 for each life kept, and 500 for a win. A new battle comes at midnight (UTC).' +
      (d ? ' Your best today: <b>' + d.score + '</b>' + (d.won ? ', and a win' : '') + '.' : '') + '</p>' +
      '<h3 class="pick">Today’s party</h3>' + partyStrip(b.party) +
      '<div class="battles"><div class="battle static" data-id="' + id + '"><canvas aria-hidden="true"></canvas><span class="b-name">What’s coming</span><span class="b-meta">Monster levels ' + b.levels[0] + '–' + b.levels[1] + ' · ' + b.monsters.length + ' kinds</span></div></div>' +
      '<div class="btnrow"><button class="primary" id="btnGo" type="button">Play today’s battle</button><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    drawStripMinis(); drawStrips();
    $('btnGo').addEventListener('click', () => newGame(id, true, {}));
    $('btnBack').addEventListener('click', () => showGames(from));
    $('btnGo').focus();
  }
  /* Reverse: every battle you have won, to take from the other side of the bar */
  function showReverse(from) {
    const o = $('overlay'), taken = camp.modes.reverse, R = MODES.REVERSE;
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The back room</span><h2 id="ovTitle">Reverse</h2>' +
      '<p class="persona"><span>Simz:</span> My turn behind the bar. You send the monsters up the steps, and I’ll keep the tavern.</p>' +
      '<p class="lede">Pick a monster, then tap a door to send it. Your purse starts at ' + R.purse + ' and gains ' + R.income + ' a round; you have ' + R.rounds + ' rounds. Take every life and the tavern is yours. A steady trickle won’t do it: a crowd at the right door might.</p>' +
      '<div class="battles">' + CAMP.CELLAR.map(id => HTL.battleById(id)).map((b, i) => {
        const open = CAMP.won(camp, b.id), ok = !!taken[b.id];
        return '<button class="battle' + (open ? '' : ' locked') + '" type="button" data-id="' + b.id + '"' + (open ? '' : ' disabled') + ' aria-label="' + b.name + (ok ? ', taken' : open ? '' : ', win it first') + '"><canvas aria-hidden="true"></canvas>' +
          '<span class="b-name"><span class="b-num">' + (i + 1) + '</span>' + b.name + (ok ? '<span class="solved">Taken</span>' : '') + '</span><span class="b-meta">' + (open ? 'Simz keeps it with ' + HTL.battleById(MODES.reverseId(b.id)).party.length + ' heroes' : 'Win it in the cellar first') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => { newGame(MODES.reverseId(btn.dataset.id), true, {}); hint('Pick a monster from the tray, then tap a door to send it.', 4000); }));
    $('btnBack').addEventListener('click', () => showGames(from));
    drawStrips();
    (o.querySelector('.battle:not([disabled])') || $('btnBack')).focus();
  }
  function showPuzzles(from) {
    const o = $('overlay'), solved = camp.modes.puzzles;
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The back room</span><h2 id="ovTitle">Puzzles</h2>' +
      '<p class="lede">Each puzzle gives you a few heroes and no gold, and one life: a single monster through the door and it’s lost. There is always a way.</p>' +
      '<div class="battles">' + MODES.PUZZLES.map((p, i) => {
        const n = i + 1, b = HTL.battleById(MODES.puzzleId(n)), ok = !!solved[n];
        const kit = Object.keys(p.heroes).map(t => p.heroes[t] + ' × ' + PACK.heroes[t].name).join(', ');
        return '<button class="battle" type="button" data-id="' + b.id + '" aria-label="Puzzle ' + n + ': ' + p.name + (ok ? ', solved' : '') + '"><canvas aria-hidden="true"></canvas>' +
          '<span class="b-name"><span class="b-num">' + n + '</span>' + p.name + (ok ? '<span class="solved">Solved</span>' : '') + '</span><span class="b-meta">' + HTL.MAPS[b.map].name + ' · ' + kit + '</span></button>';
      }).join('') + '</div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.battle').forEach(btn => btn.addEventListener('click', () => showPuzzle(btn.dataset.id, from)));
    $('btnBack').addEventListener('click', () => showGames(from));
    drawStrips();
    const first = [...o.querySelectorAll('.battle')].find(x => !/solved/.test(x.getAttribute('aria-label'))) || o.querySelector('.battle'); first.focus();
  }
  function showPuzzle(id, from) {
    const o = $('overlay'), b = HTL.battleById(id), kit = Object.keys(b.puzzle.heroes);
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Puzzle ' + b.index + ' · ' + HTL.MAPS[b.map].name + '</span><h2 id="ovTitle">' + b.name + '</h2>' +
      '<p class="persona"><span>' + b.by + ':</span> ' + b.line + '</p>' +
      '<p class="diff-line">' + b.waves.length + ' waves and one life. Place your heroes while the cellar is quiet; the first wave comes after a few rounds. Tap a mini on the mat to see what it does; the next wave’s doors show on the mat between waves.</p>' +
      '<h3 class="pick">Your heroes</h3>' + partyStrip(kit) +
      '<div class="btnrow"><button class="primary" id="btnGo" type="button">Start the puzzle</button><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.party.fixed .regular').forEach(x => { const t = x.dataset.t; x.querySelector('b').textContent = b.puzzle.heroes[t] + ' × ' + PACK.heroes[t].name; });
    drawStripMinis();
    $('btnGo').addEventListener('click', () => newGame(id, true, {}));
    $('btnBack').addEventListener('click', () => showPuzzles(from));
    $('btnGo').focus();
  }

  /* ---------- the trophy wall: trophies, every monster met, and the regulars ---------- */
  function showTrophies(from, tab) {
    const o = $('overlay'), M = HTL.MONSTERS, met = Object.keys(M).filter(t => camp.seen.monsters[t]);
    const tabs = [['trophies', 'Trophies'], ['beasts', 'Monsters met'], ['heroes', 'The regulars']];
    let body = '';
    if (tab === 'trophies') {
      body = '<div class="trophies">' + CAMP.TROPHIES.map(t => { const got = camp.trophies[t.id];
        return '<div class="trophy' + (got ? ' got' : '') + '"><b>' + t.name + '</b><span>' + t.text + '</span><em>' + (got ? 'Won ' + got : (t.reward ? '+' + t.reward + ' takings' : '')) + '</em></div>'; }).join('') + '</div>';
    } else if (tab === 'beasts') {
      const where = t => { const b = HTL.BATTLES.find(x => x.monsters.indexOf(t) >= 0); return b ? b.name : ''; };
      body = '<p class="lede">' + met.length + ' of ' + Object.keys(M).length + ' met.</p><div class="beasts">' + Object.keys(M).sort((a, b) => M[a].level - M[b].level).map(t => {
        const s = camp.seen.monsters[t];
        if (!s) return '<div class="beast unmet"><div class="b-fig">?</div><div><b>Not yet met</b><span>Lurks in ' + where(t) + '.</span></div></div>';
        const st = PACK.monsters[t];
        return '<div class="beast"><canvas data-t="' + t + '" aria-hidden="true"></canvas><div><b>' + st.name + '</b><span class="beast-stats">Level ' + M[t].level + ' · ' + st.hp + ' HP · AC ' + st.ac + ' · slain ' + s.slain + '</span><span>' + HTL.describe(t) + '</span></div></div>';
      }).join('') + '</div>';
    } else {
      const ros = CAMP.roster(camp), joinsAfter = t => { for (const id in CAMP.JOINS) if (CAMP.JOINS[id].indexOf(t) >= 0) return HTL.battleById(id).name; return ''; };
      body = '<div class="beasts">' + HTL.HERO_TYPES.map(t => {
        const h = PACK.heroes[t], paths = HTL.PATHS[t] ? Object.values(HTL.PATHS[t]).map(p => p.name).join(' or ') : '';
        if (ros.indexOf(t) < 0) return '<div class="beast unmet"><div class="b-fig">?</div><div><b>Not at the tavern yet</b><span>Joins after you win ' + joinsAfter(t) + '.</span></div></div>';
        const placed = (camp.seen.heroes[t] || {}).placed || 0;
        return '<div class="beast"><canvas data-t="' + t + '" aria-hidden="true"></canvas><div><b>' + h.name + '</b><span class="beast-stats">' + h.cost + ' gold · ' + h.hp + ' HP · AC ' + h.ac + ' · placed ' + placed + '</span><span>' + HTL.describe(t) + '</span>' +
          (paths ? '<span class="beast-stats">At level 3: ' + paths + '</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The trophy wall</h2>' +
      '<div class="tabs" role="group" aria-label="Show">' + tabs.map(([k, n]) => '<button type="button" data-tab="' + k + '" aria-pressed="' + (k === tab) + '">' + n + '</button>').join('') + '</div>' +
      body + '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTrophies(from, b.dataset.tab)));
    o.querySelectorAll('.beast canvas').forEach(c => miniInto(c, c.dataset.t, 54));
    $('btnBack').addEventListener('click', () => showTavern(from));
    o.querySelector('.tabs button[aria-pressed="true"]').focus();
  }

  /* ---------- what each battle brings back: feats seen on the mat, recorded when it ends ---------- */
  function freshFeats() { return { met: {}, slain: {}, placed: {}, bards: 0, paths: 0, crits: 0, bosses: 0, charge3: false, fireball5: false, charging: {}, ball: null }; }
  function trackFeats(ev) {
    const F = V.feats; if (!F) return;
    switch (ev.type) {
      case 'spawn': if (ev.kind === 'monster') F.met[ev.unitType] = 1; break;
      case 'place': F.placed[ev.unitType] = (F.placed[ev.unitType] || 0) + 1; if (ev.unitType === 'bard') F.bards++; break;
      case 'levelup': if (ev.path) F.paths++; break;
      case 'attack': if (ev.side === 'hero' && ev.crit && ev.hit) F.crits++; break;
      case 'charge': F.charging[ev.id] = { t: ev.t, n: 0 }; break;
      case 'barrel': if (ev.downed >= 3) F.strike = true; break;
      case 'dive': F.dived = true; break;
      case 'fireball': F.ball = { from: ev.from, t: ev.t, n: 0 }; break;
      case 'save': if (F.ball && ev.from === F.ball.from && ev.t - F.ball.t < 1 && ++F.ball.n >= 5) F.fireball5 = true; break;
      case 'death': {
        const u = S.units.find(x => x.id === ev.id) || V.sprites.get(ev.id); // the rules may already have cleared it away
        if (!u || u.kind !== 'monster' || !HTL.MONSTERS[u.type]) break;
        F.slain[u.type] = (F.slain[u.type] || 0) + 1;
        if (HTL.MONSTERS[u.type].traits.boss) F.bosses++;
        if (HTL.MONSTERS[u.type].traits.surface && !F.dived) F.mown = true; // down before it could go back under
        if (HTL.MONSTERS[u.type].traits.soak && '~@'.indexOf(HTL.cellAt(S, u.lane, u.sq)) < 0) F.dry = true; // caught out of the water
        const ch = F.charging[ev.by]; if (ch && ev.t - ch.t < ROUND * 1.5 && ++ch.n >= 3) F.charge3 = true;
        break;
      }
    }
  }
  function finishBattle(won) {
    if (V.recorded) return; V.recorded = true;
    const F = V.feats || freshFeats();
    const b = HTL.battle(S), md = b.mode && MODES ? { mode: b.mode, waves: MODES.held(S), date: b.date, score: MODES.dailyScore(S), puzzle: b.index, lives: S.lives, theme: b.theme } : {};
    if (b.reverse) { F.slain = {}; F.placed = {}; } // in Reverse the heroes were Simz's, and the slain were yours
    if (S.thrown) md.thrown = Object.assign({}, S.thrown);
    V.result = CAMP.record(camp, Object.assign(md, { battle: S.battle, difficulty: S.difficulty, won, livesLost: S.maxLives - S.lives, goldLeft: S.gold,
      met: Object.keys(F.met), slain: F.slain, placed: F.placed,
      feats: { bards: F.bards, paths: F.paths, crits: F.crits, bosses: F.bosses, charge3: F.charge3, fireball5: F.fireball5, strike: !!F.strike, mown: !!F.mown, dry: !!F.dry } }), today());
    saveCamp();
  }
  // each battle card shows its monsters lined up on a strip of battle mat
  function drawStrips() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    document.querySelectorAll('#overlay .battle').forEach(btn => {
      const b = HTL.battleById(btn.dataset.id), c = btn.querySelector('canvas');
      const w = c.clientWidth, h = c.clientHeight; if (!b || !w || !h) return;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#4c5c54'; g.fillRect(0, 0, w, h);
      const types = b.monsters.slice().sort((x, y) => HTL.MONSTERS[x].level - HTL.MONSTERS[y].level);
      const tallest = Math.max.apply(null, types.map(t => figureSize(t).ht));
      const pad = 8, u = Math.min((h - 10) / tallest, 34), step = (w - pad * 2) / types.length, ground = h - 7;
      g.strokeStyle = 'rgba(230,238,226,.16)'; g.lineWidth = 1; g.beginPath();
      for (let x = pad + step; x < w - pad - 1; x += step) { g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, h); }
      g.stroke();
      types.forEach((t, i) => {
        const sp = TableMinis.sprite(figType(t), u * dpr, figOpts(t)), x = pad + (i + 0.5) * step;
        g.drawImage(sp.cv, x - sp.ax / dpr, ground - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr);
      });
    });
  }
  /* ---------- the common room: pick the party and the difficulty, with the cats' suggestions ---------- */
  const DIFF_KEY = 'mitzsimz.holdTheLine.difficulty';
  function loadDiff() { try { const v = localStorage.getItem(DIFF_KEY); return HTL.DIFFICULTY[v] ? v : 'medium'; } catch (e) { return 'medium'; } }
  function saveDiff(v) { try { localStorage.setItem(DIFF_KEY, v); } catch (e) { /* not remembered: fine */ } }
  function showParty(battleId, from) {
    const o = $('overlay'), b = HTL.battleById(battleId), roster = CAMP.roster(camp), sug = HTL.suggestLoadout(battleId, roster);
    let pick = sug.pick.slice(), diff = b.mode ? 'medium' : loadDiff(); // the modes are played on Medium
    o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
      '<span class="eyebrow">' + b.name + (b.map !== 'classic' ? ' · ' + HTL.MAPS[b.map].name : '') + '</span><h2 id="ovTitle">The common room</h2>' +
      '<p class="lede">Pick up to ' + sug.size + ' of the regulars to go down the cellar steps. Mitz and Simz have a few ideas.</p>' + tavernLine() +
      (b.mode ? '<p class="persona"><span>' + b.by + ':</span> ' + b.line + '</p><p class="diff-line" id="diffLine"></p>' :
      '<h3 class="pick">How hard</h3><div class="diff" role="group" aria-label="Difficulty">' +
      Object.keys(HTL.DIFFICULTY).map(k => '<button type="button" data-d="' + k + '">' + HTL.DIFFICULTY[k].name + '</button>').join('') + '</div>' +
      '<p class="diff-line" id="diffLine"></p>') +
      '<h3 class="pick">The party<span class="count" id="partyCount"></span></h3><div class="party">' +
      roster.map((t, i) => '<div class="regwrap' + (canLook(t) ? ' looks' : '') + '"><button type="button" class="regular" data-t="' + t + '"><canvas aria-hidden="true"></canvas><b>' + PACK.heroes[t].name + (camp.equip[t] ? ' · ' + HTL.ITEMS[camp.equip[t]].name : '') +
        ' · ' + PACK.heroes[t].cost + ' gold</b><span>' + (i % 2 ? 'Simz' : 'Mitz') + ': ' + sug.why[t] + '</span></button>' +
        (canLook(t) ? '<button type="button" class="look" data-look="' + t + '"></button>' : '') + '</div>').join('') + '</div>' +
      '<div class="btnrow"><button class="primary" id="btnGo" type="button">Down the cellar steps</button>' +
      '<button class="secondary" id="btnCats" type="button">The cats’ picks</button>' +
      '<button class="secondary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    const sync = () => {
      o.querySelectorAll('.diff button').forEach(x => x.setAttribute('aria-pressed', x.dataset.d === diff ? 'true' : 'false'));
      $('diffLine').textContent = b.mode ? 'Played on Medium, with the tavern’s help.' : HTL.DIFFICULTY[diff].line;
      if ($('tavernLine')) $('tavernLine').classList.toggle('deadly', diff === 'deadly');
      o.querySelectorAll('.regular').forEach(x => x.setAttribute('aria-pressed', pick.indexOf(x.dataset.t) >= 0 ? 'true' : 'false'));
      o.querySelectorAll('.look').forEach(x => { const t = x.dataset.look, her = LOOKS[t] === 'f', n = PACK.heroes[t].name;
        x.textContent = her ? 'Her' : 'Him'; x.title = her ? 'Swap to his figure' : 'Swap to her figure';
        x.setAttribute('aria-label', n + ': ' + (her ? 'her' : 'his') + ' figure. Swap to ' + (her ? 'his' : 'hers')); });
      $('partyCount').textContent = pick.length + ' of ' + sug.size;
      $('btnGo').disabled = !pick.length;
    };
    o.querySelectorAll('.diff button').forEach(x => x.addEventListener('click', () => { diff = x.dataset.d; saveDiff(diff); sync(); }));
    o.querySelectorAll('.regular').forEach(x => x.addEventListener('click', () => {
      const t = x.dataset.t, i = pick.indexOf(t);
      if (i >= 0) pick.splice(i, 1);
      else if (pick.length < sug.size) pick.push(t);
      else { hint('The party is full. Leave someone at the bar first.'); return; }
      sync();
    }));
    o.querySelectorAll('.look').forEach(x => x.addEventListener('click', () => {
      const t = x.dataset.look; CAMP.setLook(camp, t, LOOKS[t] === 'f' ? 'm' : 'f'); saveCamp();
      miniInto(x.parentNode.querySelector('canvas'), t, 40); sync();
    }));
    $('btnCats').addEventListener('click', () => { pick = sug.pick.slice(); sync(); });
    $('btnBack').addEventListener('click', () => (b.mode ? showGames(from) : b.stage === 2 ? showHouse(from) : showCellar(from)));
    let warned = false; // without a Bard nothing earns gold: say so once, then go if they still want to
    $('btnGo').addEventListener('click', () => {
      if (pick.indexOf('bard') < 0 && roster.indexOf('bard') >= 0 && !warned) { warned = true; hint('No Bard in the party: nothing will earn gold but the bounties. Press again to go anyway.', 5000); return; }
      newGame(battleId, true, Object.assign({ difficulty: diff, loadout: HTL.HERO_TYPES.filter(t => pick.indexOf(t) >= 0) }, CAMP.battleOptions(camp)));
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    o.querySelectorAll('.regular canvas').forEach(c => miniInto(c, c.parentNode.dataset.t, 40));
    sync();
    $('btnGo').focus();
  }
  // sound, motion and every effect that can be switched off; kept in this browser
  const SETTINGS = [
    ['sound', 'Sound', 'Dice, clangs and spells, made in the browser. M turns it on and off.'],
    ['reduced', 'Reduced motion', 'Gentler movement and flicker: no screen shake, tumbling dice, paws or lifting.'],
    ['hitstop', 'Hit-stop', 'A beat of stillness when a crit or a heavy blow lands.'],
    ['tumble', 'Tumbling dice', 'A d20 rolls across the mat on crits and the blow that fells a boss.'],
    ['poses', 'Poses', 'Minis lunge, cast or raise a shield as they act, and flinch when they’re hit.'],
    ['bits', 'Hit effects', 'Sparks off armour, bone chips, stone dust, splats and embers.'],
    ['paws', 'Cats tidy up', 'Mitz and Simz take turns swatting fallen monsters off the table.'],
    ['torch', 'Torchlight', 'Flickering torches, moving shadows, and dark crypts and caves.'],
    ['perf', 'Frame timings', 'Frames a second and where the time goes, in the corner of the screen. Handy for a bug report.']
  ];
  const getSet = key => (key === 'reduced' ? calm() : !!SET[key]);
  function setSet(key, on) {
    if (key === 'reduced') SET.motion = on ? 'reduced' : 'full'; else SET[key] = on;
    if (key === 'sound') { SND.enabled(on); if (on) { SND.unlock(); SND.play('clack'); } }
    if (key === 'torch' && L) layout(); // a dark battle's floor is part of the board image
    saveSettings();
  }
  function toggleSound() { setSet('sound', !SET.sound); hint(SET.sound ? 'Sound on.' : 'Sound off.', 1400); }
  function showSettings(back) {
    const o = $('overlay');
    const row = ([key, label, note]) => '<div class="setrow"><div class="setlab"><b>' + label + '</b><span>' + note + '</span></div>' +
      '<button class="toggle" type="button" data-set="' + key + '" aria-pressed="' + getSet(key) + '" aria-label="' + label + '">' + (getSet(key) ? 'On' : 'Off') + '</button></div>';
    o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">At the table</span><h2 id="ovTitle">Settings</h2>' +
      '<div class="setlist">' + row(SETTINGS[0]) +
      '<div class="setrow"><div class="setlab"><b>Volume</b></div><input id="setVol" type="range" min="0" max="100" step="5" value="' + Math.round(SET.volume * 100) + '" aria-label="Volume"></div>' +
      SETTINGS.slice(1).map(row).join('') + '</div>' +
      '<div class="btnrow"><button class="primary" id="btnBack" type="button">Done</button></div></div>';
    o.hidden = false;
    o.querySelectorAll('.toggle').forEach(b => b.addEventListener('click', () => {
      setSet(b.dataset.set, !getSet(b.dataset.set));
      const on = getSet(b.dataset.set); b.setAttribute('aria-pressed', on); b.textContent = on ? 'On' : 'Off';
    }));
    $('setVol').addEventListener('input', e => { SET.volume = +e.target.value / 100; SND.volume(SET.volume); });
    $('setVol').addEventListener('change', () => { saveSettings(); SND.unlock(); sfx('coin'); });
    $('btnBack').addEventListener('click', back);
    $('btnBack').focus();
  }

  /* Support and links: Pete's standard for every Mitz & Simz game (the roadmap's "Support and links"). Same words everywhere,
     on the credits, one quiet line on the tavern's front screen and the end of a campaign, and never during a battle. */
  const LINKS = { kofi: 'https://ko-fi.com/mitznsimz', site: 'https://mitznsimz.co.uk', repo: 'https://github.com/mitznsimz-cpu/mitznsimz-hold-the-line',
    delve: 'https://mitznsimz-cpu.github.io/mitznsimz-dungeon-delve/', tarokk: 'https://mitznsimz-cpu.github.io/mitznsimz-tarokk/',
    tracker: 'https://mitznsimz-cpu.github.io/DnD-Encounter-Tracker/' };
  const ext = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  const KOFI_LINE = ext(LINKS.kofi, '☕ Enjoying it? Buy Pete some dice, or Mitz &amp; Simz some treats.');
  const SITE_LINK = ext(LINKS.site, '🛡 MitzNSimz.co.uk');
  function showCredits(from) {
    const o = $('overlay');
    o.innerHTML = '<div class="panel credits" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Mitz &amp; Simz present</span><h2 id="ovTitle">Credits</h2>' +
      '<p><strong>Mitz &amp; Simz: Hold the Line</strong>, version ' + VERSION + '. Made by Pete at ' + ext(LINKS.site, 'MitzNSimz') + ', Folkestone.</p>' +
      '<p class="support">' + KOFI_LINE + '</p>' +
      '<p>' + SITE_LINK + ': 3D-printed miniatures and tools for Dungeon Masters.</p>' +
      '<p>More from Mitz &amp; Simz: ' + ext(LINKS.delve, 'Dungeon Delve') + ', ' + ext(LINKS.tarokk, 'Tarokk') + ' and the ' + ext(LINKS.tracker, 'D&amp;D Encounter Tracker') + '.</p>' +
      '<p>Found a bug, or had an idea? Tell us on ' + ext(LINKS.repo + '/issues', 'GitHub') + ' or at <a href="mailto:mitznsimz@gmail.com">mitznsimz@gmail.com</a>, and say which version you were playing.</p>' +
      '<p>No ads and no tracking. Your progress is saved in this browser and never leaves it.</p>' +
      '<p>The minis are drawn in code, unpainted, the way they come off the printer. Mitz and Simz supervised.</p>' +
      '<p class="legal">The code is under the MIT licence, on ' + ext(LINKS.repo, 'GitHub') + '. ' +
      'It doesn’t cover Mitz &amp; Simz, their characters, the miniature artwork or the icon, which are © MitzNSimz.</p>' +
      '<p class="legal">This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at ' +
      ext('https://dnd.wizards.com/resources/systems-reference-document', 'https://dnd.wizards.com/resources/systems-reference-document') + '. ' +
      'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at ' +
      ext('https://creativecommons.org/licenses/by/4.0/legalcode', 'https://creativecommons.org/licenses/by/4.0/legalcode') + '.</p>' +
      '<div class="btnrow"><button class="primary" id="btnBack" type="button">Back</button></div></div>';
    o.hidden = false;
    $('btnBack').addEventListener('click', () => showTavern(from));
    $('btnBack').focus();
  }
  function showPause() {
    const o = $('overlay'), b = HTL.battle(S);
    o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">' + b.name + ' · round ' + S.round + '</span><h2 id="ovTitle">Paused</h2>' +
      '<p class="lede">The minis will wait. Take your time.</p>' +
      '<div class="btnrow"><button class="primary" id="btnResume" type="button">Resume</button>' +
      '<button class="secondary" id="btnRestart" type="button">Restart</button>' +
      '<button class="secondary" id="btnChoose" type="button">Back to the tavern</button>' +
      '<button class="secondary" id="btnSettings" type="button">Settings</button></div></div>';
    o.hidden = false;
    $('btnResume').addEventListener('click', togglePause);
    $('btnSettings').addEventListener('click', () => showSettings(showPause));
    $('btnRestart').addEventListener('click', () => newGame(S.battle, true, lastOpts));
    $('btnChoose').addEventListener('click', () => showTavern('pause'));
    $('btnResume').focus();
  }
  // what the tavern says about its upgrades, before a battle
  function tavernLine() {
    const t = camp.upgrades, bits = [];
    if (t.door) bits.push((t.door === 1 ? 'one more life' : t.door + ' more lives'));
    if (t.till) bits.push(25 * t.till + ' more gold');
    if (t.kitchen) bits.push(t.kitchen === 1 ? 'hearty rests' : 'full rests');
    if (t.training) bits.push(t.training === 1 ? 'the first of each kind at level 2' : 'everyone at level 2');
    return bits.length || Object.keys(camp.equip).length ? '<p class="diff-line" id="tavernLine">' + (bits.length ? '<span class="tl-help">From the tavern: ' + bits.join(', ') + '.</span> ' : '') + '<span class="deadly-note">On Deadly the tavern’s upgrades and the armoury stay behind; only the cats come along.</span></p>' : '';
  }
  function showEnd(won) {
    const o = $('overlay'), st = S.stats, b = HTL.battle(S), cp = campaignOf(b), next = cp && cp.list[cp.i + 1] ? HTL.battleById(cp.list[cp.i + 1]) : null, r = V.result;
    const mode = b.mode && MODES ? b.mode : null, rm = r && r.mode;
    const held = mode === 'endless' ? MODES.held(S) : 0, score = mode === 'daily' ? MODES.dailyScore(S) : 0;
    const nextPuzzle = mode === 'puzzle' && won && b.index < MODES.PUZZLES.length ? MODES.puzzleId(b.index + 1) : null;
    const line = mode === 'endless' ? 'Held for ' + held + (held === 1 ? ' wave' : ' waves') + (rm && rm.best ? '. That’s a new best.' : '. ' + (camp.modes.endless > held ? 'The best is still ' + camp.modes.endless + '.' : 'Not bad at all.'))
      : mode === 'daily' ? 'Today’s score: ' + score + '. ' + (rm && rm.best ? 'Your best today.' : 'Your best today is still ' + (camp.modes.daily[b.date] || {}).score + '.')
      : mode === 'puzzle' ? (won ? 'That’s the way through.' : 'One got past. Have a think and try again.')
      : mode === 'reverse' ? (won ? 'Fine. Fair play. The drinks are on me.' : 'Told you. Nobody gets past me.')
      : won ? (next || mode ? 'Drinks are on the house. Well, on the Bard.' : cp && cp.house ? 'The whole house is quiet, cellar to rafters. The lodger has moved out, and the drinks are on the house.' : 'That was everything under the tavern. Drinks are on the house, forever.')
            : 'Everyone roll up a new character. Same time next week?';
    let buttons;
    const nextOpen = won && next && CAMP.unlocked(camp, next.id);
    if (mode) buttons = (nextPuzzle ? '<button class="primary" id="btnNext" type="button">Next puzzle</button>' : '') +
      '<button class="' + (nextPuzzle ? 'secondary' : 'primary') + '" id="btnAgain" type="button">' + (mode === 'endless' ? 'Another night' : 'Try again') + '</button>' +
      '<button class="secondary" id="btnGames" type="button">Back to the back room</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
    else if (nextOpen) buttons = '<button class="primary" id="btnNext" type="button">Next: ' + next.name + '</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
    else if (won) buttons = '<button class="primary" id="btnChoose" type="button">Back to the tavern</button><button class="secondary" id="btnAgain" type="button">Play again</button>';
    else buttons = '<button class="primary" id="btnAgain" type="button">Try again</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
    const gains = [];
    if (r) {
      const pay = r.takings - r.trophies.reduce((n, t) => n + t.reward, 0);
      const why = rm ? (rm.kind === 'reverse' ? 'for taking the tavern' : rm.kind === 'endless' ? 'for ' + rm.waves + (rm.waves === 1 ? ' wave' : ' waves') : rm.kind === 'daily' ? 'for today’s win' : rm.kind === 'rush' ? 'for the Boss Rush' : 'for solving it')
        : won ? (r.best ? 'for the win' : 'for a replay') : 'the cats found all the same';
      if (pay) gains.push('<li><b>' + coins(pay) + '</b> ' + why + '</li>');
      r.trophies.forEach(t => gains.push('<li>Trophy: <b>' + t.name + '</b>' + (t.reward ? ' (+' + t.reward + ')' : '') + '</li>'));
      r.joined.forEach(t => gains.push('<li><b>' + PACK.heroes[t].name + '</b> joins the regulars.</li>'));
      r.items.forEach(id => gains.push('<li>Found: <b>' + HTL.ITEMS[id].name + '</b>. Give it to someone in the armoury.</li>'));
      r.rooms.forEach(id => { const room = CAMP.ROOMS.find(x => x.id === id); if (room) gains.push('<li><b>' + room.name + '</b> is open.</li>'); });
      r.upgrades.forEach(k => { if (!r.rooms.length || k !== 'door' && k !== 'till') gains.push('<li><b>' + CAMP.UPGRADES[k].name + '</b> can be built now.</li>'); });
    }
    o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle">' +
      '<span class="eyebrow">' + (mode === 'endless' ? 'Endless' : (won ? 'Victory' : 'Defeat') + ' · ' + b.name) + '</span><h2 id="ovTitle">' +
      (mode === 'endless' ? 'The long night is over' : mode === 'puzzle' ? (won ? 'Solved' : 'Not quite') : mode === 'reverse' ? (won ? 'The tavern is yours' : 'Simz held the tavern') : won ? 'The tavern stands' : 'The tavern has fallen') + '</h2>' +
      (won && r && r.stars ? '<p class="result-stars">' + starRow(r.stars) + (r.best ? '<span>Best yet</span>' : '') + '</p>' : '') +
      '<p class="persona"><span>' + (mode === 'reverse' || !won ? 'Simz' : 'Mitz') + ':</span> ' + line + '</p>' +
      '<div class="tally">' +
      (mode === 'endless' ? '<div><span class="lbl">Waves held</span><b>' + held + '</b></div>' : mode === 'daily' ? '<div><span class="lbl">Score</span><b>' + score + '</b></div>' :
       '<div><span class="lbl">Rounds fought</span><b>' + S.round + '</b></div>') +
      (mode === 'reverse' ? '<div><span class="lbl">Monsters sent</span><b>' + (S.sent || 0) + '</b></div><div><span class="lbl">Lives taken</span><b>' + (S.maxLives - S.lives) + '</b></div>' :
      '<div><span class="lbl">Monsters slain</span><b>' + st.kills + '</b></div>') +
      (mode === 'reverse' ? '' : '<div><span class="lbl">Natural 20s</span><b>' + st.crits + '</b></div>' +
      '<div><span class="lbl">Got through the door</span><b>' + st.leaks + '</b></div>') +
      '</div>' + (gains.length ? '<ul class="gains">' + gains.join('') + '</ul>' : '') + '<div class="btnrow">' + buttons + '</div>' +
      (won && !mode && !next ? '<p class="support-line">' + KOFI_LINE + '</p>' : '') + '</div>';
    o.hidden = false;
    if ($('btnNext')) $('btnNext').addEventListener('click', () => (nextPuzzle ? showPuzzle(nextPuzzle, 'end') : showParty(next.id, 'end')));
    if ($('btnAgain')) $('btnAgain').addEventListener('click', () => newGame(mode === 'endless' ? MODES.endlessId(newSeed()) : b.id, true, Object.assign({}, lastOpts, CAMP.battleOptions(camp))));
    if ($('btnGames')) $('btnGames').addEventListener('click', () => showGames('end'));
    $('btnChoose').addEventListener('click', () => showTavern('end'));
    (($('btnNext') || $('btnAgain') || $('btnChoose'))).focus();
  }
  function togglePause() {
    if (!started || S.phase !== 'running') return;
    paused = !paused;
    $('btnPause').textContent = paused ? 'Resume' : 'Pause';
    if (paused) { selected = null; updateCards(); closeCard(); showPause(); }
    else { $('overlay').hidden = true; lastTs = performance.now(); }
  }

  let lastOpts = {};
  function eyebrow() {
    const b = HTL.battle(S);
    return 'Mitz & Simz · ' + (b.mode === 'puzzle' ? 'Puzzle ' + b.index + ' · ' : '') + b.name + (b.date ? ' · ' + b.date : '') + (S.difficulty && S.difficulty !== 'medium' ? ' · ' + HTL.DIFFICULTY[S.difficulty].name : '');
  }
  // the status bar reads differently in Reverse: your purse, and the rounds you have left
  function hudLabels() {
    const rev = S.purse != null;
    $('purse').querySelector('.lbl').textContent = rev ? 'Purse' : 'Gold';
    $('waveLbl').textContent = rev ? 'Rounds left' : 'Wave';
  }
  // the door a tap means: the one in that row, or else the nearest
  function doorFor(lane, sq) {
    const ds = HTL.mapOf(S).doors; let best = 0, bd = Infinity;
    ds.forEach((d, i) => { const dist = (d.lane === lane ? 0 : 100 * Math.abs(d.lane - lane)) + Math.abs(d.sq - sq); if (dist < bd) { bd = dist; best = i; } });
    return best;
  }
  // a puzzle is yours to solve: Simz keeps his paws off
  function autoAllowed() {
    const ok = !S.free && S.purse == null; $('btnAuto').disabled = !ok;
    if (!ok && autoOn) { autoOn = false; $('btnAuto').setAttribute('aria-pressed', 'false'); }
  }
  function newGame(battleId, autostart, opts) {
    lastOpts = opts || {};
    S = HTL.newGame((Math.random() * 4294967295) >>> 0, battleId, lastOpts);
    HERO_ORDER = trayOrder(); buildTray(); buildBelt();
    acc = 0; selected = null; aiming = null; throwing = null; hover = null; lastAutoRound = -1; resetView(); closeCard(); nextKey = '';
    hintQ.length = 0;
    shown.gold = shown.lives = shown.round = -1; shown.wave = -2; shown.phase = '';
    $('toast').hidden = true; $('hint').hidden = true;
    $('battleEye').textContent = eyebrow(); autoAllowed(); hudLabels();
    if (L && (L.map !== HTL.mapOf(S) || L.dark !== isDark())) layout();
    paused = false; $('btnPause').textContent = 'Pause';
    if (autostart) { started = true; $('overlay').hidden = true; lastTs = performance.now(); }
    else { started = false; showTavern(); }
    hud(); updateCards();
  }

  /* ---------- the card for a mini on the mat: what it is, how it's doing, and Recall for heroes ---------- */
  let cardId = 0, cardLevel = 0;
  function openCard(u) {
    const hero = u.kind === 'hero', info = hero ? PACK.heroes[u.type] : PACK.monsters[u.type], ally = hero && info.ally;
    const path = hero && u.path ? HTL.PATHS[u.type][u.path] : null;
    cardId = u.id; cardLevel = u.level || 0;
    $('uName').textContent = info.name + (hero && !ally ? ' · level ' + u.level + (path ? ' · ' + path.name : '') : hero ? ' · ' + info.role : ' · level ' + info.level);
    $('uDesc').textContent = HTL.describe(u.type) + (path ? ' ' + path.rule : '') + (u.item ? ' Carries the ' + HTL.ITEMS[u.item].name + ': ' + HTL.ITEMS[u.item].text.charAt(0).toLowerCase() + HTL.ITEMS[u.item].text.slice(1) : '');
    $('uPaths').hidden = true; $('uButtons').hidden = false;
    const b = $('btnRecall'); b.hidden = !hero || ally;
    if (hero && !ally) b.textContent = 'Recall for ' + HTL.refundOf(u) + ' gold';
    $('btnLevel').hidden = !hero || ally || HTL.upgradeCost(u) == null;
    const cvs = $('unitCard').querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cvs.width = cvs.height = Math.round(46 * dpr);
    const m = TableMinis.render(figType(u.type), cvs.width * 0.7, figOpts(u.type)), g = cvs.getContext('2d'), s = Math.min(cvs.width / m.cv.width, cvs.height / m.cv.height);
    g.clearRect(0, 0, cvs.width, cvs.height);
    g.drawImage(m.cv, (cvs.width - m.cv.width * s) / 2, cvs.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
    $('hint').hidden = true;
    $('unitCard').hidden = false;
    updateCard();
  }
  function updateCard() {
    if (!cardId) return;
    const u = S.units.find(x => x.id === cardId && x.alive);
    if (!u || S.phase !== 'running' || !started) { closeCard(); return; }
    const bits = ['HP ' + u.hp + '/' + u.maxHp, 'AC ' + u.ac];
    for (const k in u.status) if (u.status[k] > 0 && HTL.STATUSES[k]) bits.push(HTL.STATUSES[k].word.toLowerCase());
    if (u.kind === 'hero' && cellAt(u.lane, u.sq) === '^') bits.push('+2 to hit up here');
    const txt = bits.join(' · ');
    if ($('uStats').textContent !== txt) $('uStats').textContent = txt;
    if (u.kind === 'hero' && u.level !== cardLevel) { openCard(u); return; }
    const cost = u.kind === 'hero' ? HTL.upgradeCost(u) : null;
    if (cost != null) {
      const lt = 'Level ' + (u.level + 1) + ' for ' + cost + ' gold';
      if ($('btnLevel').textContent !== lt) $('btnLevel').textContent = lt;
      $('btnLevel').disabled = S.gold < cost;
      $('uPaths').querySelectorAll('.path').forEach(p => { p.disabled = S.gold < cost; });
    }
  }
  // level 2 is one tap; level 3 asks which path
  function levelCarded() {
    const u = S.units.find(x => x.id === cardId && x.alive); if (!u) return;
    if (u.level === 1) { const why = HTL.levelUp(S, u.id); if (why === 'gold') hint('Not enough gold for that yet.'); return; }
    const paths = HTL.PATHS[u.type], cost = HTL.upgradeCost(u), box = $('uPaths');
    box.innerHTML = '';
    for (const key of Object.keys(paths)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'path'; b.disabled = S.gold < cost;
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = paths[key].name;
      b.querySelector('span').textContent = paths[key].rule;
      b.setAttribute('aria-label', paths[key].name + ' for ' + cost + ' gold. ' + paths[key].rule);
      b.addEventListener('click', () => { if (!HTL.levelUp(S, u.id, key)) closeCard(); });
      box.appendChild(b);
    }
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'secondary'; back.textContent = 'Back';
    back.addEventListener('click', () => openCard(u));
    box.appendChild(back);
    $('uButtons').hidden = true; box.hidden = false;
    box.querySelector('.path').focus();
  }
  function closeCard() { cardId = 0; $('unitCard').hidden = true; }
  function recallCarded() {
    const u = S.units.find(x => x.id === cardId && x.alive); if (!u || u.kind !== 'hero') return;
    const name = PACK.heroes[u.type].name, refund = HTL.refundOf(u);
    if (!HTL.recall(S, u.id)) { closeCard(); hint('The ' + name + ' heads back to the tavern. ' + refund + ' gold back in the purse.'); }
  }
  $('btnRecall').addEventListener('click', recallCarded);
  $('btnLevel').addEventListener('click', levelCarded);
  $('btnUnitClose').addEventListener('click', closeCard);

  /* ---------- the next wave, shown in the HUD between waves ---------- */
  let nextKey = '';
  function updateNext() {
    const pv = started && S.phase === 'running' ? HTL.preview(S) : null, el = $('next');
    if (!pv) { if (!el.hidden) { el.hidden = true; nextKey = ''; } return; }
    const key = S.battle + ':' + pv.index + ':' + pv.rounds;
    if (key === nextKey) return;
    const drawStrip = !nextKey || nextKey.split(':')[1] !== String(pv.index) || el.hidden;
    nextKey = key; el.hidden = false;
    const r = pv.rounds;
    $('nextLbl').textContent = r > 0 ? 'Next wave · ' + r + (r === 1 ? ' round' : ' rounds') : 'Next wave';
    const types = Object.keys(pv.counts).sort((x, y) => HTL.MONSTERS[x].level - HTL.MONSTERS[y].level);
    $('nextText').textContent = 'Wave ' + (pv.index + 1) + ', ' + pv.name + ', in ' + r + ' rounds: ' + types.map(ty => pv.counts[ty] + ' ' + HTL.MONSTERS[ty].name).join(', ') + '.';
    if (drawStrip) drawNextStrip(types, pv.counts);
  }
  function drawNextStrip(types, counts) {
    const c = $('nextStrip'), dpr = Math.min(window.devicePixelRatio || 1, 2.5), slot = 30, h = 28;
    const w = Math.max(30, types.length * slot);
    c.style.width = w + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const tallest = Math.max.apply(null, types.map(ty => figureSize(ty).ht)), u = Math.min((h - 2) / tallest, 22);
    types.forEach((ty, i) => {
      const sp = TableMinis.sprite(figType(ty), u * dpr, figOpts(ty)), x = (i + 0.42) * slot;
      g.drawImage(sp.cv, x - sp.ax / dpr, h - 3 - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr);
      g.font = '700 11px ' + UIF; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.lineWidth = 3; g.strokeStyle = '#2a1d16'; g.strokeText('×' + counts[ty], (i + 1) * slot - 1, h - 1);
      g.fillStyle = '#f0cd6e'; g.fillText('×' + counts[ty], (i + 1) * slot - 1, h - 1);
    });
  }

  /* ---------- input ---------- */
  function localPoint(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  cv.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const p = localPoint(e); hover = squareAt(p.x, p.y); });
  cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('pointerdown', e => {
    if (!started || paused) return;
    const p = localPoint(e), q = squareAt(p.x, p.y);
    if (cardId) closeCard();
    if (!q) { if (selected || aiming || throwing) { selected = null; aiming = null; throwing = null; updateCards(); updatePowers(); updateBelt(); } return; }
    if (throwing) {
      const why = HTL.throwItem(S, throwing, q.lane, q.sq);
      if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); if (THROW_WHY[why]) hint(THROW_WHY[why]); }
      else { throwing = null; dropHint(); }
      updateBelt(); return;
    }
    if (selected && S.purse != null) {
      const door = doorFor(q.lane, q.sq), why = HTL.send(S, selected, door);
      if (why) { if (SEND_WHY[why]) hint(SEND_WHY[why]); }
      if (!affords(selected)) selected = null; // keep sending the same kind while the purse lasts
      updateCards(); return;
    }
    if (aiming) {
      const why = HTL.usePower(S, aiming, q.lane, q.sq);
      if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); if (POWER_WHY[why]) hint(POWER_WHY[why]); }
      else { aiming = null; dropHint(); }
      updatePowers();
      return;
    }
    if (selected) {
      const why = HTL.place(S, selected, q.lane, q.sq);
      if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); hint(REASONS[why] || 'You can’t place a hero there.'); }
      else { selected = null; updateCards(); }
      return;
    }
    const u = HTL.unitAt(S, q.lane, q.sq), ch = cellAt(q.lane, q.sq);
    if (u) openCard(u);
    else if (ch === 'H' && S.opened && L.map.doorAt && S.opened[L.map.doorAt[q.lane * 100 + q.sq]]) hint('It has burst open. Monsters come up through it now, and nobody can stand on it.', 3600, 'Open trapdoor');
    else if (tipOf(ch)) hint(tipOf(ch)[1], 3600, tipOf(ch)[0]);
    else if (ch === ' ') return;
    else hint('Pick a hero from the tray first.');
  });
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const n = parseInt(e.key, 10);
    if (n >= 0 && n <= 9 && !isNaN(n)) { const t = HERO_ORDER[n === 0 ? 9 : n - 1]; if (t) { selectHero(t); return; } }
    if (e.key === 'm' || e.key === 'M') { toggleSound(); return; }
    if (e.key === 'q' || e.key === 'Q') { aim('pounce'); return; }
    if (e.key === 'w' || e.key === 'W') { aim('swat'); return; }
    if ((e.key === 'g' || e.key === 'G') && S && S.gate) { dropGate(); return; }
    if (e.key === 'Escape') { if (cardId) closeCard(); else if (aiming) { aiming = null; updatePowers(); } else if (selected) { selected = null; updateCards(); } else if (started && paused) togglePause(); return; }
    if ((e.key === 'r' || e.key === 'R') && cardId && !paused) { recallCarded(); return; }
    if ((e.key === ' ' || e.key === 'p' || e.key === 'P') && started && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); togglePause(); }
  });
  $('btnPause').addEventListener('click', togglePause);
  $('pw-pounce').addEventListener('click', () => aim('pounce'));
  $('btnGate').addEventListener('click', dropGate);
  $('pw-swat').addEventListener('click', () => aim('swat'));
  $('btnSpeed').addEventListener('click', () => { speed = speed === 1 ? 2 : 1; $('btnSpeed').textContent = speed + '×'; $('btnSpeed').setAttribute('aria-pressed', speed === 2 ? 'true' : 'false'); });
  $('btnDice').addEventListener('click', () => { diceOn = !diceOn; $('btnDice').setAttribute('aria-pressed', diceOn ? 'true' : 'false'); });
  $('btnAuto').addEventListener('click', () => {
    autoOn = !autoOn; lastAutoRound = -1;
    $('btnAuto').setAttribute('aria-pressed', autoOn ? 'true' : 'false');
    hint(autoOn ? 'Simz is placing heroes for you. Press Auto again to take over.' : 'Your turn to place the heroes.', 2600);
  });

  /* ---------- main loop ---------- */
  // Frame timings (Settings): how many frames a second, and how long each part of a frame takes, averaged over half a
  // second and shown in a corner, so a tester can say where a slow browser spends its time.
  const prof = (() => {
    const parts = ['sim', 'board', 'shadows', 'minis', 'effects', 'panels'], sum = {}, el = () => $('perf');
    let t = 0, frames = 0, from = 0, lastFrame = 0, gaps = 0;
    parts.forEach(p => { sum[p] = 0; });
    return {
      start(ts) {
        if (!SET.perf) { if (el()) el().remove(); return; }
        if (lastFrame) gaps += ts - lastFrame; lastFrame = ts; frames++; t = performance.now();
        if (!from) from = ts;
        if (ts - from >= 500) {
          let box = el();
          if (!box) { box = document.createElement('div'); box.id = 'perf'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
          const n = Math.max(1, frames - 1), ms = p => (sum[p] / frames).toFixed(1);
          box.textContent = Math.round(1000 * n / Math.max(1, gaps)) + ' fps · ' + (gaps / n).toFixed(0) + ' ms a frame · board ' + cv.width + '×' + cv.height + ' (' + (L ? L.dpr.toFixed(2) : '?') + '×)\n' +
            parts.map(p => p + ' ' + ms(p)).join(' · ') + ' ms';
          parts.forEach(p => { sum[p] = 0; }); frames = 0; gaps = 0; from = ts;
        }
      },
      mark(part) { if (!SET.perf) return; const now = performance.now(); sum[part] += now - t; t = now; }
    };
  })();
  // watch the gaps between frames in a battle; if most of 90 come slower than about 40 a second, draw the board a step softer
  // A step that doesn't help (a browser holding frames to 30 a second to save battery, say) is undone, and the
  // board is left alone for the rest of the visit.
  function keepPace(ts) {
    if (pace.off) return;
    const gap = pace.last ? ts - pace.last : 0; pace.last = ts;
    if (gap > 0 && gap < 1000) pace.gaps.push(gap); // a longer gap is the tab waking up, not the drawing
    if (!pace.from) pace.from = ts;
    if (pace.gaps.length < 12 || ts - pace.from < 2000) return; // judge every two seconds of battle
    pace.from = ts;
    const sorted = pace.gaps.sort((a, b) => a - b), median = sorted[sorted.length >> 1]; pace.gaps = [];
    if (pace.tried) { // did the last step help?
      const t = pace.tried; pace.tried = null;
      if (median > t.median * 0.95) { pace.off = true; SET.boardPx = t.budget; saveSettings(); pace.last = 0; layout(); return; }
    }
    if (median <= 24 || L.dpr <= 1.01 || ts - pace.stepAt < 2000) return;
    pace.tried = { median, budget: SET.boardPx };
    const f = median > 50 ? 0.4 : 0.64; // very slow (under 20 frames a second): a bigger step
    SET.boardPx = Math.max(Math.round(L.W * L.H), Math.round(cv.width * cv.height * f)); saveSettings();
    pace.stepAt = ts; pace.last = 0; pace.from = 0;
    layout();
  }
  function frame(ts) {
    const dt = Math.min(0.25, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts; // up to 5 ticks a frame, so a slow browser plays at the right speed, if choppily
    prof.start(ts);
    if (started && !paused) {
      acc += dt * speed;
      while (acc >= TICK) { HTL.step(S, TICK); acc -= TICK; }
      if (autoOn && !S.free && S.purse == null && S.phase === 'running' && S.round !== lastAutoRound) { lastAutoRound = S.round; HTL.autoplay(S); }
    }
    if (S.events.length) { const evs = S.events.splice(0); for (const ev of evs) onEvent(ev); }
    prof.mark('sim');
    // Under a menu the board is still: let what's moving settle for a moment, then stop redrawing it until the menu
    // closes, the battle changes or the window is resized. Redrawing a full-window board behind every menu made them slow.
    const covered = !$('overlay').hidden, key = covered && S && L ? S : null;
    if (!covered) coveredFor = null;
    else if (coveredFor !== key || coveredFor === null) { coveredFor = key; coveredAt = ts; }
    if (!covered && started && !paused && S.phase === 'running') keepPace(ts); else pace.last = 0;
    if (!covered || ts - coveredAt < 1500) {
      const now = clock();
      runImpacts(now);
      draw(now);
      drawTrack(now);
      hud();
      drawCooldowns(now);
      updateCard();
      updateNext();
      updatePowers(); updateBelt();
      prof.mark('panels');
    }
    requestAnimationFrame(frame);
  }

  let resizeT = 0;
  const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { layout(); drawTrayMinis(); if (!$('overlay').hidden) { drawStrips(); drawRegulars(); } }, 60); });

  function boot(data) {
    resetView();
    if (data && data.S && data.S.v === 4 && HTL.battleById(data.S.battle)) {
      S = data.S; speed = data.speed || 1; diceOn = data.diceOn !== false; started = !!data.started; autoOn = !!data.autoOn; paused = false; acc = 0;
      S.events = []; lastOpts = { difficulty: S.difficulty, loadout: S.loadout };
      if (!S.traps) S.traps = []; // a game saved before traps existed
      if (S.stats && S.stats.sprung == null) S.stats.sprung = 0;
      HERO_ORDER = trayOrder(); buildTray(); buildBelt();
      for (const u of S.units) if (u.alive) addSprite({ id: u.id, kind: u.kind, unitType: u.type, lane: u.lane, sq: u.sq, hp: u.hp, maxHp: u.maxHp, t: S.time }, null).level = u.level || 0;
      $('btnSpeed').textContent = speed + '×'; $('btnSpeed').setAttribute('aria-pressed', speed === 2 ? 'true' : 'false');
      $('btnDice').setAttribute('aria-pressed', diceOn ? 'true' : 'false');
      $('btnAuto').setAttribute('aria-pressed', autoOn ? 'true' : 'false');
      $('battleEye').textContent = eyebrow(); autoAllowed(); hudLabels();
      if (started && S.phase === 'running') $('overlay').hidden = true; else if (!started) showTavern(); else showEnd(S.phase === 'won');
      hud();
    } else newGame(HTL.BATTLES[0].id, false);
    layout();
    ro.observe($('boardWrap'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); drawTrayMinis(); });
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ S: JSON.parse(JSON.stringify(Object.assign({}, S, { events: [] }))), speed, diceOn, started, autoOn }));
  if (hot && hot.probe) hot.probe({ gpos, squareAt, state: () => S }); // read-only, for checks run from outside the page
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
