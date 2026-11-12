'use strict';
/* Hold the Line view: motes. Dust, drips, embers, spores, sparks, leaves or snow drifting over the battle, from its theme.
   After the Dungeon Delve's particles (msdd_view3d.js, the PVS shader and PKIND), on the 2D canvas: each mote is four
   random numbers, and where it is follows from the time alone, so nothing is kept from frame to frame. Each colour's soft
   dot is drawn once into a small canvas and stamped. Off under Settings → Drifting motes; gentler with reduced motion. */

// the kinds of mote: how many over a 5 × 10 mat, and whether it glows (drawn brighter, added to the light)
const MOTE_KINDS = { dust: { n: 30, glow: false }, drip: { n: 14, glow: false }, leaves: { n: 12, glow: false }, snow: { n: 46, glow: false },
  embers: { n: 30, glow: true }, spores: { n: 26, glow: true }, sparks: { n: 24, glow: true } };
// each theme's mote and colour: the Delve's zones as they are (msdd_materials.js ZONES … parts), then the house's own
const MOTE_THEMES = { damp: ['drip', '#9fc4d8'], sunken: ['drip', '#a8d8ee'], sewer: ['drip', '#b4c080'], overgrown: ['leaves', '#a08a3a'],
  lava: ['embers', '#ff8a30'], infernal: ['embers', '#ff4a20'], arcane: ['sparks', '#c79bff'], frost: ['snow', '#e8f4ff'],
  crypt: ['dust', '#d8cbb0'], ossuary: ['dust', '#d0c8b0'], tomb: ['dust', '#e8d0a0'], dwarven: ['dust', '#e0c090'], mine: ['dust', '#c8b898'],
  fungal: ['spores', '#50ffd8'], lodge: ['dust', '#d8c8a8'],
  kitchen: ['embers', '#ffb050'], yard: ['dust', '#e8d8a0'], garden: ['leaves', '#b4b04a'] };

let motes = null; // { kind, col, seeds, dot, rect } for the battle on the board, or null
// the battle's theme: its own, or for the back room's battles the cellar battle they're built on, or the cellar's dust
function themeOf(S) {
  const b = HTL.battle(S); if (b.theme) return b.theme;
  const base = String(S.battle).split(':')[1], o = base && HTL.BATTLES.find(x => x.id === base);
  return (o && o.theme) || 'lodge';
}
function setupMotes() { // after every layout: the mat's size and the pixels change
  motes = null;
  if (!SET.motes || !S || !L) return;
  const [kind, col] = MOTE_THEMES[themeOf(S)] || MOTE_THEMES.lodge, K = MOTE_KINDS[kind], c = L.cell;
  const rect = L.horiz ? { x: L.ox, y: L.oy - c * 0.3, w: (L.TAV + L.MW) * c, h: L.MH * c + c * 0.3 } : { x: L.ox, y: L.oy - c * 0.3, w: L.MH * c, h: (L.MW + L.TAV) * c + c * 0.3 };
  const n = Math.round(K.n * Math.min(2, (L.MW * L.MH) / 50) * (calm() ? 0.6 : 1));
  const rnd = mulberry(7); // the same motes every time a battle is laid out
  const seeds = []; for (let i = 0; i < n; i++) seeds.push([rnd(), rnd(), rnd(), rnd()]);
  const r = Math.max(2, Math.round(c * (kind === 'snow' ? 0.05 : kind === 'dust' ? 0.035 : kind === 'embers' ? 0.06 : 0.045) * L.dpr)), dot = document.createElement('canvas');
  dot.width = dot.height = r * 2;
  const g = dot.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, col); grad.addColorStop(K.glow ? 0.35 : 0.5, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2);
  motes = { kind, col, glow: K.glow, seeds, dot, size: r * 2 / L.dpr, rect };
}
const frac = v => v - Math.floor(v);
function drawMotes(now) {
  if (!motes) return;
  const { kind, seeds, dot, size, rect, glow } = motes, t = calm() ? now * 0.5 : now, c = L.cell, flick = !calm();
  if (glow) ctx.globalCompositeOperation = 'lighter';
  if (kind === 'leaves') ctx.fillStyle = motes.col;
  for (const [a, b, d, e] of seeds) {
    const sp = 0.5 + e;
    let fx = a, fy = b, al = 1, s = size * (0.6 + 0.8 * e), ph;
    switch (kind) {
      case 'embers': ph = frac(b + t * 0.07 * sp); fy = 1 - ph; fx = a + Math.sin(t * 0.9 + e * 30) * 0.02; al = Math.sin(Math.PI * ph) * (flick ? 0.6 + 0.4 * Math.sin(t * 9 + a * 50) : 0.8); break;
      case 'spores': ph = frac(b + t * 0.025 * sp); fy = 1 - ph; fx = a + Math.sin(t * 0.4 + e * 20) * 0.03; al = Math.sin(Math.PI * ph) * 0.8; break;
      case 'snow': ph = frac(b + t * 0.05 * sp); fy = ph; fx = a + Math.sin(t * 0.8 + e * 30) * 0.02; al = Math.min(1, Math.sin(Math.PI * ph) * 2) * 0.85; break;
      case 'sparks': al = flick ? Math.pow(0.5 + 0.5 * Math.sin(t * 5 + e * 60), 6) : 0.35; fx = a + Math.sin(t * 0.5 + e * 9) * 0.01; break;
      case 'drip': ph = frac(b + t * 0.18 * sp); fy = d * 0.6 + ph * 0.25; al = Math.sin(Math.PI * ph) * 0.7; break;
      case 'leaves': ph = frac(b + t * 0.035 * sp); fy = ph; fx = a + Math.sin(t * 1.2 + e * 30) * 0.03; al = Math.min(1, Math.sin(Math.PI * ph) * 2) * 0.75; break;
      default: fx = a + Math.sin(t * 0.15 + e * 40) * 0.04; fy = b + Math.sin(t * 0.1 + a * 9) * 0.03; al = 0.35 + 0.25 * Math.sin(t * 0.3 + d * 20); // dust hangs in the light
    }
    if (al <= 0.02) continue;
    const x = rect.x + frac(fx) * rect.w, y = rect.y + Math.min(1, Math.max(0, fy)) * rect.h;
    ctx.globalAlpha = al * (glow ? 0.9 : kind === 'leaves' ? 0.85 : 0.6);
    if (kind === 'drip') ctx.drawImage(dot, x - s * 0.18, y - s * 1.2, s * 0.36, s * 2.4);
    else if (kind === 'leaves') {
      const ang = t * (0.8 + e) + d * 6; ctx.beginPath(); ctx.ellipse(x, y, c * 0.075 * (0.7 + e * 0.6), c * 0.034 * Math.abs(Math.cos(ang)) + c * 0.01, ang * 0.5, 0, TAU); ctx.fill();
    } else ctx.drawImage(dot, x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
