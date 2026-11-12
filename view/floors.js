'use strict';
/* Hold the Line view: themed floors. Each battle's mat is laid with stone, cobbles, tiles or boards to suit its theme,
   like dungeon terrain tiles on the table, instead of the plain vinyl mat. The material is the Dungeon Delve's:
   msdd_materials.js, copied across as it is, bakes a tileable texture with WebGL 2 (colour, and height in alpha). Here
   it is baked once per theme, read back, lit from the top left by its height, given a little of the theme's covering
   (moss, soot and glowing cracks, frost, dust, spores) and kept as a picture, so it costs nothing per frame.
   Without WebGL 2, or with Settings → Themed floors off, the vinyl mat stays. */

// the house's own themes, for the parts of the house the Delve has no zone for
const HOUSE_FLOORS = {
  kitchen: { floor: 'tiles', stone: ['#8a5a3c', '#a0704a', '#3a2418'], floorTone: 0.85, cover: { style: 4, a: '#a08a70', b: '#c8b8a0', emit: '#000000', amt: 0.25 } },
  yard: { floor: 'cobble', stone: ['#6e665a', '#857c6c', '#2a251e'], floorTone: 0.85, cover: { style: 4, a: '#a8986c', b: '#d0c090', emit: '#000000', amt: 0.4 } },
  garden: { floor: 'flagstone', stone: ['#6c7060', '#828670', '#2c3024'], floorTone: 0.85, cover: { style: 0, a: '#34501c', b: '#5e7e2c', emit: '#000000', amt: 0.6 } }
};
const floorTiles = new Map(); // theme → the lit tile (512 square, two squares of the board), or null where it can't be made
let floorGL = null; // one WebGL 2 context, kept for every bake: browsers allow only a few
function floorLook(theme) { return HOUSE_FLOORS[theme] || (window.MSDDMat && MSDDMat.ZONES[theme]) || null; }
function floorTile(theme) {
  if (floorTiles.has(theme)) return floorTiles.get(theme);
  let tile = null;
  try { tile = bakeFloor(theme); } catch (e) { tile = null; } // no WebGL 2, or it failed: the vinyl mat
  floorTiles.set(theme, tile);
  return tile;
}
function bakeFloor(theme) {
  const Z = floorLook(theme);
  if (!Z || !window.MSDDMat || !MSDDMat.MATS[Z.floor]) return null;
  if (!floorGL) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: false, antialias: false });
    if (!gl) return null;
    floorGL = { gl, baker: new MSDDMat.Baker(gl), fb: gl.createFramebuffer() };
  }
  const { gl, baker, fb } = floorGL, N = 512;
  const t = baker.get(Z.floor, Z.stone, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  const raw = new Uint8Array(N * N * 4);
  gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // light it by its height, from the top left, and lay the covering into the low places (the mortar and the cracks)
  const hex = MSDDMat.hex, tone = Z.floorTone || 0.85, cv = Z.cover || { style: -1, amt: 0 };
  const ca = hex(cv.a || '#000000'), cb = hex(cv.b || '#000000'), ce = hex(cv.emit || '#000000');
  const out = document.createElement('canvas'); out.width = out.height = N;
  const g = out.getContext('2d'), img = g.createImageData(N, N), px = img.data;
  // the soft patches for the covering, and a speckle, from tables: both tile with the texture
  const SU = new Float32Array(N), CV = new Float32Array(N), SD = new Float32Array(2 * N);
  for (let k = 0; k < N; k++) { SU[k] = Math.sin(k * TAU * 2 / N + 1.3); CV[k] = Math.cos(k * TAU * 3 / N + 0.4); }
  for (let k = 0; k < 2 * N; k++) SD[k] = Math.sin(k * TAU * 5 / N);
  const noise = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const amt = cv.amt || 0, st = cv.style, M = N - 1;
  for (let y = 0; y < N; y++) {
    const up = ((y - 1) & M) * N, dn = ((y + 1) & M) * N, row = y * N;
    for (let x = 0; x < N; x++) {
      const i = (row + x) * 4, h = raw[i + 3] / 255;
      const nx = (raw[(row + ((x - 1) & M)) * 4 + 3] - raw[(row + ((x + 1) & M)) * 4 + 3]) / 85, ny = (raw[(up + x) * 4 + 3] - raw[(dn + x) * 4 + 3]) / 85;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1), d = (-0.5 * nx - 0.6 * ny + 0.62) * inv;
      const lit = (0.62 + 0.55 * (d > -0.3 ? (d + 0.3) / 1.3 : 0)) * tone;
      let r = raw[i] * lit, gg = raw[i + 1] * lit, b = raw[i + 2] * lit;
      const low = h < 0.55 ? (0.55 - h) / 0.55 : 0, patch = 0.5 + 0.25 * SU[x] * CV[y] + 0.25 * SD[x + y];
      if (st === 0 || st === 7) { // moss and damp in the low places and in patches
        let k = (low * 1.4 * amt + (patch > 0.62 ? (patch - 0.62) * amt * 1.6 : 0)) * (0.7 + 0.3 * noise(x, y)); if (k > 1) k = 1;
        const m = patch > 0.5 ? cb : ca;
        r += (m[0] * 204 - r) * k; gg += (m[1] * 204 - gg) * k; b += (m[2] * 204 - b) * k;
      } else if (st === 1 || st === 5 || st === 9) { // soot, with the cracks glowing: lava, fungus, ore
        let soot = (patch * 0.6 + low * 0.5) * amt; if (soot > 1) soot = 1;
        const keep = 1 - soot * 0.45; r *= keep; gg *= keep; b *= keep;
        const glow = low * low * low * amt * (st === 9 ? (noise(x >> 3, y >> 3) > 0.8 ? 0.5 : 0) : 0.75);
        r += ce[0] * 255 * glow; gg += ce[1] * 255 * glow; b += ce[2] * 255 * glow;
      } else if (st === 2) { // crystal: a violet sheen in the joints
        const k = low * amt * 0.4; r += (ce[0] * 255 - r) * k; gg += (ce[1] * 255 - gg) * k; b += (ce[2] * 255 - b) * k;
      } else if (st === 3 || st === 4 || st === 8) { // frost, dust or sand settling in the low places and in drifts
        let k = (low * 0.9 + (patch > 0.6 ? (patch - 0.6) * 1.2 : 0)) * amt * (0.75 + 0.25 * noise(x, y)); if (k > 1) k = 1;
        const m = st === 3 ? cb : ca;
        r += (m[0] * 230 - r) * k; gg += (m[1] * 230 - gg) * k; b += (m[2] * 230 - b) * k;
      }
      px[i] = r > 255 ? 255 : r; px[i + 1] = gg > 255 ? 255 : gg; px[i + 2] = b > 255 ? 255 : b; px[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}
// the theme's floor, scaled for this board: one tile covers two squares, as in the Delve
let floorPat = null;
function floorPattern(g) {
  floorPat = null;
  if (!SET.floors || !S) return null;
  const tile = floorTile(themeOf(S)); if (!tile) return null;
  const px = Math.max(16, Math.round(2 * L.cell * L.dpr)), c = document.createElement('canvas');
  c.width = c.height = px; c.getContext('2d').drawImage(tile, 0, 0, px, px);
  const p = g.createPattern(c, 'repeat');
  floorPat = { theme: themeOf(S), px };
  return p;
}
