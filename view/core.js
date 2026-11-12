// Hold the Line: view/core.js. The view's setup: settings, the battle state it draws, and laying the board out to fit the window.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
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
const VERSION = '1.8.3'; // shown in the credits, so testers can say which version they were playing
const UIF = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';

const cv = $('board'), ctx = cv.getContext('2d');
const tcv = $('track'), tctx = tcv.getContext('2d');

let S = null, acc = 0, speed = 1, diceOn = true, paused = false, started = false, autoOn = false, lastAutoRound = -1;
let selected = null, hover = null, lastTs = 0, drawCount = 0; // drawCount: boards drawn, for the browser tests
// Safari, and every browser on an iPhone or iPad (they're all Safari underneath), draws a canvas much more slowly than
// Chrome or Firefox: on a Mac laptop a full-window board at 2x ran at 17 frames a second and at 1x at 58. So WebKit
// starts with a budget of about a million board pixels (1x to 1.14x on a laptop window, nearer 2x on a phone).
const WEBKIT = (() => { try { const ua = navigator.userAgent; return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|SamsungBrowser/.test(ua); } catch (e) { return false; } })();
const BOARD_PIXELS = WEBKIT ? 1.0e6 : 4.2e6;
// How many board pixels this browser draws smoothly, learned in battle and remembered. Some browsers slow down in a big
// window: when frames come slowly, the board is drawn softer (never below the screen's own 1x), and a smaller
// window that fits the budget keeps full sharpness.
const boardBudget = () => Math.min(BOARD_PIXELS, SET.boardPx > 0 ? SET.boardPx : BOARD_PIXELS);
const pace = { last: 0, gaps: [], from: 0, counting: false };
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
  pace.last = 0; pace.from = 0; pace.counting = false; // and judge its pace afresh
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
