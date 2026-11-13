'use strict';
/* Hold the Line view: trophy plaques. Every trophy on the wall is a little walnut plaque with a brass plate, mounting
   either a mini from the library (the bosses, the heroes) or a cast-brass emblem drawn here: a tankard, a d20, a stack
   of coins. Trophies not yet won hang dark, their mini or emblem a shadow of what's to come. Drawn in code like the
   minis, so there are no image files; a new trophy needs one line in PLAQUES (the tests check every trophy has one). */

// what each trophy mounts: { mini: a monster or hero } or { emblem: one of EMBLEMS below }
const PLAQUES = {
  open: { emblem: 'tankard' }, flawless: { emblem: 'door' }, boss: { mini: 'goblinChief' }, path: { mini: 'paladin' },
  charge3: { mini: 'barbarian' }, fireball5: { emblem: 'flame' }, crits: { emblem: 'd20' }, nobard: { mini: 'bard' },
  thrifty: { emblem: 'coins' }, hard: { emblem: 'skull' }, deadly: { emblem: 'skulls' }, swept: { emblem: 'broom' },
  bestiary: { emblem: 'book' }, campaign: { emblem: 'key' }, wholehouse: { emblem: 'house' }, stars: { emblem: 'stars' },
  deadlyflawless: { emblem: 'shield' }, deadlyboss: { mini: 'barrowLich' }, deadlysix: { emblem: 'swords' },
  deadlylair: { mini: 'redDragon' }, alldeadly: { emblem: 'crown' }, endless10: { emblem: 'candle' }, endless25: { emblem: 'moon' },
  daily: { emblem: 'sun' }, rush: { emblem: 'hourglass' }, reverse: { mini: 'goblin' }, reverseall: { mini: 'lodger' },
  ringhold: { emblem: 'horseshoe' }, dryland: { mini: 'thingInWell' }, mown: { mini: 'lawnThing' }, strike: { emblem: 'barrel' },
  puzzles: { emblem: 'cog' },
  // the cellar editor's
  firstPlans: { emblem: 'quill' }, proof: { mini: 'fighter' }, petard: { emblem: 'bomb' }, simzApproves: { emblem: 'paw' },
  simzStumped: { emblem: 'question' }, guestCellar: { emblem: 'envelope' }, masterBuilder: { emblem: 'compass' }
};

// the emblems, each drawn as one path in a box from -1 to 1, cast in brass
const EMBLEMS = {
  tankard: g => { g.rect(-0.55, -0.45, 0.8, 1.2); g.moveTo(0.25, -0.2); g.arc(0.25, 0.15, 0.35, -Math.PI / 2, Math.PI / 2); g.lineTo(0.25, 0.35); g.arc(0.25, 0.15, 0.18, Math.PI / 2, -Math.PI / 2, true); g.closePath();
    g.moveTo(-0.65, -0.45); g.arc(-0.45, -0.55, 0.22, Math.PI, 0); g.arc(-0.12, -0.62, 0.22, Math.PI, 0); g.arc(0.2, -0.55, 0.2, Math.PI, 0); g.lineTo(0.35, -0.45); g.closePath(); },
  door: g => { g.moveTo(-0.55, 0.85); g.lineTo(-0.55, -0.2); g.arc(0, -0.2, 0.55, Math.PI, 0); g.lineTo(0.55, 0.85); g.closePath(); g.moveTo(0.38, 0.2); g.arc(0.3, 0.2, 0.08, 0, TAU); },
  flame: g => { g.moveTo(0, -0.95); g.bezierCurveTo(0.35, -0.5, 0.75, -0.1, 0.55, 0.45); g.bezierCurveTo(0.4, 0.9, -0.4, 0.95, -0.55, 0.45); g.bezierCurveTo(-0.7, 0, -0.3, -0.2, -0.2, -0.55); g.bezierCurveTo(-0.05, -0.3, 0.05, -0.6, 0, -0.95); g.closePath(); },
  d20: g => { for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * TAU / 6; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.9, Math.sin(a) * 0.9); } g.closePath(); },
  coins: g => { for (let k = 0; k < 4; k++) g.ellipse(0, 0.55 - k * 0.32, 0.6, 0.22, 0, 0, TAU); g.ellipse(0.35, 0.7, 0.45, 0.17, 0, 0, TAU); },
  skull: g => { g.arc(0, -0.15, 0.62, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(0.32, 0.45); g.lineTo(0.32, 0.72); g.lineTo(-0.32, 0.72); g.lineTo(-0.32, 0.45); g.closePath();
    g.moveTo(-0.05, -0.08); g.ellipse(-0.25, -0.08, 0.17, 0.2, 0, 0, TAU); g.moveTo(0.45, -0.08); g.ellipse(0.25, -0.08, 0.17, 0.2, 0, 0, TAU); // the eyes, and the nose: holes
    g.moveTo(0, 0.18); g.lineTo(0.09, 0.34); g.lineTo(-0.09, 0.34); g.closePath(); },
  skulls: g => { g.save(); g.translate(-0.42, 0.1); g.scale(0.62, 0.62); EMBLEMS.skull(g); g.restore(); g.save(); g.translate(0.42, 0.1); g.scale(0.62, 0.62); EMBLEMS.skull(g); g.restore(); },
  broom: g => { g.rect(-0.06, -0.95, 0.12, 1.1); g.moveTo(-0.2, 0.1); g.lineTo(0.2, 0.1); g.lineTo(0.55, 0.9); g.lineTo(-0.55, 0.9); g.closePath(); },
  book: g => { g.moveTo(0, -0.55); g.quadraticCurveTo(-0.45, -0.75, -0.85, -0.6); g.lineTo(-0.85, 0.6); g.quadraticCurveTo(-0.45, 0.45, 0, 0.65); g.quadraticCurveTo(0.45, 0.45, 0.85, 0.6); g.lineTo(0.85, -0.6); g.quadraticCurveTo(0.45, -0.75, 0, -0.55); g.closePath(); },
  key: g => { g.arc(-0.45, 0, 0.32, 0, TAU); g.moveTo(-0.15, -0.08); g.rect(-0.15, -0.08, 1, 0.16); g.rect(0.55, 0.08, 0.12, 0.22); g.rect(0.75, 0.08, 0.1, 0.3); },
  house: g => { g.moveTo(0, -0.85); g.lineTo(0.8, -0.1); g.lineTo(0.6, -0.1); g.lineTo(0.6, 0.8); g.lineTo(-0.6, 0.8); g.lineTo(-0.6, -0.1); g.lineTo(-0.8, -0.1); g.closePath(); },
  stars: g => { const star = (x, y, r) => { for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, d = k % 2 ? r * 0.45 : r; g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d); } g.closePath(); };
    star(0, -0.35, 0.5); star(-0.55, 0.4, 0.38); star(0.55, 0.4, 0.38); },
  shield: g => { g.moveTo(0, -0.9); g.lineTo(0.75, -0.6); g.quadraticCurveTo(0.75, 0.45, 0, 0.92); g.quadraticCurveTo(-0.75, 0.45, -0.75, -0.6); g.closePath(); },
  swords: g => { for (const s of [1, -1]) { g.save(); g.rotate(s * Math.PI / 4); g.moveTo(0, -0.98); g.lineTo(0.12, -0.8); g.lineTo(0.12, 0.35); g.lineTo(-0.12, 0.35); g.lineTo(-0.12, -0.8); g.closePath(); g.rect(-0.38, 0.35, 0.76, 0.14); g.rect(-0.08, 0.49, 0.16, 0.42); g.restore(); } },
  crown: g => { g.moveTo(-0.8, 0.55); g.lineTo(-0.8, -0.45); g.lineTo(-0.4, 0); g.lineTo(0, -0.65); g.lineTo(0.4, 0); g.lineTo(0.8, -0.45); g.lineTo(0.8, 0.55); g.closePath(); },
  candle: g => { g.rect(-0.25, -0.25, 0.5, 1.1); g.moveTo(0, -0.95); g.quadraticCurveTo(0.25, -0.55, 0, -0.35); g.quadraticCurveTo(-0.25, -0.55, 0, -0.95); g.ellipse(0, 0.85, 0.6, 0.12, 0, 0, TAU); },
  moon: g => { g.arc(0, 0, 0.8, Math.PI * 0.35, Math.PI * 1.65); g.arc(0.35, -0.05, 0.62, Math.PI * 1.55, Math.PI * 0.45, true); g.closePath(); },
  sun: g => { g.arc(0, 0, 0.45, 0, TAU); for (let k = 0; k < 12; k++) { const a = k * TAU / 12; g.moveTo(Math.cos(a) * 0.58, Math.sin(a) * 0.58); g.lineTo(Math.cos(a + 0.12) * 0.92, Math.sin(a + 0.12) * 0.92); g.lineTo(Math.cos(a - 0.12) * 0.92, Math.sin(a - 0.12) * 0.92); g.closePath(); } },
  hourglass: g => { g.rect(-0.6, -0.9, 1.2, 0.15); g.rect(-0.6, 0.75, 1.2, 0.15); g.moveTo(-0.45, -0.75); g.lineTo(0.45, -0.75); g.lineTo(0.08, 0); g.lineTo(0.45, 0.75); g.lineTo(-0.45, 0.75); g.lineTo(-0.08, 0); g.closePath(); },
  horseshoe: g => { g.arc(0, -0.1, 0.72, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(0.75, 0.85); g.lineTo(0.42, 0.85); g.lineTo(0.42, 0.15); g.arc(0, -0.1, 0.42, Math.PI * 0.12, Math.PI * 0.88, true); g.lineTo(-0.42, 0.85); g.lineTo(-0.75, 0.85); g.closePath(); },
  barrel: g => { g.moveTo(-0.5, -0.8); g.quadraticCurveTo(-0.85, 0, -0.5, 0.8); g.lineTo(0.5, 0.8); g.quadraticCurveTo(0.85, 0, 0.5, -0.8); g.closePath(); },
  quill: g => { g.moveTo(0.75, -0.9); g.bezierCurveTo(0.2, -0.75, -0.35, -0.2, -0.45, 0.45); g.lineTo(-0.62, 0.9); g.lineTo(-0.3, 0.55); g.bezierCurveTo(0.25, 0.3, 0.6, -0.3, 0.75, -0.9); g.closePath(); },
  bomb: g => { g.arc(-0.1, 0.18, 0.62, 0, TAU); g.moveTo(0.28, -0.32); g.rect(0.18, -0.52, 0.28, 0.26); g.moveTo(0.5, -0.62); g.quadraticCurveTo(0.7, -0.95, 0.9, -0.8); g.lineTo(0.84, -0.72); g.quadraticCurveTo(0.7, -0.85, 0.56, -0.58); g.closePath(); },
  paw: g => { g.ellipse(0, 0.35, 0.48, 0.4, 0, 0, TAU); for (const [x, y] of [[-0.62, -0.18], [-0.24, -0.58], [0.24, -0.58], [0.62, -0.18]]) { g.moveTo(x + 0.2, y); g.ellipse(x, y, 0.2, 0.26, 0, 0, TAU); } },
  question: g => { g.arc(0, -0.32, 0.52, Math.PI * 1.05, Math.PI * 0.5); g.lineTo(0.12, 0.3); g.lineTo(-0.12, 0.3); g.lineTo(-0.12, 0.0); g.arc(0, -0.32, 0.28, Math.PI * 0.5, Math.PI * 1.05, true); g.closePath();
    g.moveTo(0.16, 0.66); g.arc(0, 0.66, 0.16, 0, TAU); },
  envelope: g => { g.rect(-0.85, -0.55, 1.7, 1.1); },
  compass: g => { g.moveTo(0, -0.9); g.arc(0, -0.72, 0.18, -Math.PI / 2, Math.PI * 1.5); g.moveTo(-0.1, -0.6); g.lineTo(-0.62, 0.9); g.lineTo(-0.44, 0.9); g.lineTo(0, -0.42); g.lineTo(0.44, 0.9); g.lineTo(0.62, 0.9); g.lineTo(0.1, -0.6); g.closePath(); },
  cog: g => { for (let k = 0; k < 16; k++) { const a = k * TAU / 16, r = k % 2 ? 0.62 : 0.88; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.moveTo(0.28, 0); g.arc(0, 0, 0.28, 0, TAU, true); }
};
// a few lines cast into some emblems, drawn over the brass
const EMBLEM_LINES = {
  d20: g => { const p = k => { const a = -Math.PI / 2 + k * TAU / 6; return [Math.cos(a) * 0.9, Math.sin(a) * 0.9]; }, t = [[0, -0.5], [-0.45, 0.3], [0.45, 0.3]];
    g.moveTo(...t[0]); g.lineTo(...t[1]); g.lineTo(...t[2]); g.closePath(); for (const [i, j] of [[0, 0], [1, 0], [5, 0], [2, 1], [3, 1], [3, 2], [4, 2]]) { g.moveTo(...p(i)); g.lineTo(...t[j]); } },
  door: g => { for (const x of [-0.2, 0.15]) { g.moveTo(x, -0.6); g.lineTo(x, 0.85); } },
  envelope: g => { g.moveTo(-0.85, -0.55); g.lineTo(0, 0.1); g.lineTo(0.85, -0.55); },
  compass: g => { g.moveTo(-0.4, 0.3); g.quadraticCurveTo(0, 0.55, 0.4, 0.3); },
  barrel: g => { for (const y of [-0.45, 0.45]) { g.moveTo(-0.66, y); g.lineTo(0.66, y); } },
  book: g => { g.moveTo(0, -0.55); g.lineTo(0, 0.65); },
  skull: g => { g.moveTo(-0.08, 0.5); g.lineTo(0.08, 0.5); }
};

function plaquePath(g, w, h) { // a plaque: square shoulders, a point at the foot
  const r = w * 0.12;
  g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.quadraticCurveTo(w, 0, w, r); g.lineTo(w, h * 0.72);
  g.quadraticCurveTo(w, h * 0.86, w / 2, h); g.quadraticCurveTo(0, h * 0.86, 0, h * 0.72); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath();
}
function drawPlaque(c, id, got, px) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), w = Math.round(px * dpr), h = Math.round(px * 1.18 * dpr);
  c.width = w; c.height = h; c.style.width = px + 'px'; c.style.height = Math.round(px * 1.18) + 'px';
  const g = c.getContext('2d'), P = PLAQUES[id] || { emblem: 'stars' };
  // walnut, bevelled, lit from the top left
  plaquePath(g, w, h);
  const wood = g.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, got ? '#7a4b2a' : '#3a2a20'); wood.addColorStop(1, got ? '#3e2414' : '#1f1611');
  g.fillStyle = wood; g.fill();
  g.save(); g.clip(); g.strokeStyle = got ? 'rgba(255,220,170,.08)' : 'rgba(255,255,255,.03)'; g.lineWidth = Math.max(1, w * 0.01);
  for (let k = 0; k < 9; k++) { const y = h * (k + 0.5) / 9; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + w * 0.04, w * 0.7, y - w * 0.04, w, y + w * 0.02); g.stroke(); }
  g.restore();
  g.save(); g.translate(w * 0.07, w * 0.07); g.scale(0.86, 0.88); plaquePath(g, w, h); g.restore();
  g.strokeStyle = got ? 'rgba(255,214,160,.28)' : 'rgba(255,255,255,.06)'; g.lineWidth = Math.max(1, w * 0.02); g.stroke();
  plaquePath(g, w, h); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = Math.max(1, w * 0.025); g.stroke();
  // the brass plate
  const pw = w * 0.56, ph = h * 0.1, pxx = (w - pw) / 2, py = h * 0.68;
  const brass = g.createLinearGradient(0, py, 0, py + ph);
  brass.addColorStop(0, got ? '#f2d27a' : '#5a5040'); brass.addColorStop(1, got ? '#a77a26' : '#3a3428');
  g.fillStyle = brass; g.beginPath(); g.roundRect(pxx, py, pw, ph, ph * 0.3); g.fill();
  g.fillStyle = 'rgba(40,24,8,.55)'; for (const x of [pxx + ph * 0.45, pxx + pw - ph * 0.45]) { g.beginPath(); g.arc(x, py + ph / 2, ph * 0.13, 0, TAU); g.fill(); }
  // the mount: a mini, or a cast emblem
  const box = { x: w * 0.14, y: h * 0.07, w: w * 0.72, h: h * 0.58 };
  if (P.mini && TableMinis.has(figType(P.mini))) {
    const m = TableMinis.render(figType(P.mini), box.h, Object.assign({}, figOpts(P.mini), { lit: !!got }));
    // the figure itself, without the empty margin round it, as big as the plaque allows
    const cw = m.cv.width, ch = m.cv.height, a = m.cv.getContext('2d').getImageData(0, 0, cw, ch).data;
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (a[(y * cw + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = cw - 1; y1 = ch - 1; }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1, s = Math.min(box.w * 0.95 / fw, box.h * 0.98 / fh), mw = fw * s, mh = fh * s;
    const o = document.createElement('canvas'); o.width = Math.ceil(mw); o.height = Math.ceil(mh);
    const og = o.getContext('2d'); og.drawImage(m.cv, x0, y0, fw, fh, 0, 0, mw, mh);
    if (!got) { og.globalCompositeOperation = 'source-in'; og.fillStyle = '#0d0907'; og.fillRect(0, 0, mw, mh); }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(w / 2 + w * 0.02, box.y + box.h - mh * 0.04, mw * 0.32, mh * 0.05, 0, 0, TAU); g.fill();
    g.globalAlpha = got ? 1 : 0.75; g.drawImage(o, w / 2 - mw / 2, box.y + box.h - mh); g.globalAlpha = 1;
  } else {
    const draw = EMBLEMS[P.emblem] || EMBLEMS.stars, R = Math.min(box.w, box.h) * 0.42;
    g.save(); g.translate(w / 2, box.y + box.h / 2); g.scale(R, R);
    g.beginPath(); g.save(); g.translate(0.05, 0.07); draw(g); g.restore(); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill('evenodd'); // its shadow on the wood
    g.beginPath(); draw(g);
    const metal = g.createLinearGradient(-1, -1, 1, 1);
    metal.addColorStop(0, got ? '#ffe7a0' : '#2a221c'); metal.addColorStop(0.5, got ? '#d4a537' : '#1d1814'); metal.addColorStop(1, got ? '#8a5e18' : '#120e0b');
    g.fillStyle = metal; g.fill('evenodd');
    g.lineWidth = 0.06; g.strokeStyle = got ? 'rgba(60,34,6,.8)' : 'rgba(0,0,0,.6)'; g.stroke();
    if (EMBLEM_LINES[P.emblem]) { g.beginPath(); EMBLEM_LINES[P.emblem](g); g.lineWidth = 0.05; g.strokeStyle = got ? 'rgba(80,46,8,.75)' : 'rgba(0,0,0,.5)'; g.stroke(); }
    g.restore();
  }
}
