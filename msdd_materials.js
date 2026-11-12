/* msdd_materials.js — procedural materials and zones for Dungeon Delve's 3D view (v6.0).
 *
 * Two halves:
 *   1. BAKE: a fragment shader that draws a tileable material (brick, ashlar,
 *      rubble, flagstone, cave rock, cobble, tiles, planks, iron) into a texture
 *      once: colour in RGB, height in A. A few KB of code, any number of looks.
 *      The photo tiles from msdd_assets.js go through the same door, with their
 *      brightness standing in for height, so both kinds mix freely.
 *   2. COVER: a shader chunk the corridor shader includes. It lights the stone
 *      (relief from the baked height, torch, wall lamps, specular) and lays the
 *      zone's covering over it in world space, so it runs on across squares:
 *      moss and damp, soot and glowing lava cracks, violet crystal, frost, dust,
 *      glowing fungus.
 *
 * MSDDMat.ZONES and MSDDMat.MATS are plain data, so a pack can name a zone per
 * floor and override any part of it.
 */
(function (root) {
  'use strict';

  /* ---------------- the materials ----------------
     pat: which pattern the bake shader draws. p: its four numbers.
     period: world units one texture covers (walls are 1 unit square). */
  var MATS = {
    brick:     { name: 'Brick',        pat: 0, p: [18, 4, 0.05, 0.07], period: 2, spec: 0.25 },
    ashlar:    { name: 'Ashlar',       pat: 1, p: [6, 3, 0.025, 0.06], period: 2, spec: 0.3 },
    rubble:    { name: 'Rubble',       pat: 2, p: [9, 1.0, 0.03, 0.14], period: 2, spec: 0.2 },
    flagstone: { name: 'Flagstone',    pat: 3, p: [4, 1.0, 0.018, 0.035], period: 2, spec: 0.3 },
    cave:      { name: 'Cave rock',    pat: 4, p: [3, 0, 0, 0], period: 2, spec: 0.25 },
    cobble:    { name: 'Cobbles',      pat: 5, p: [12, 1.0, 0.06, 0.16], period: 2, spec: 0.35 },
    tiles:     { name: 'Tiles',        pat: 6, p: [6, 0, 0.035, 0.02], period: 2, spec: 0.7 },
    bones:     { name: 'Skulls and bones', pat: 11, p: [8, 7, 0, 0], period: 1, spec: 0.3, cols: ['#d6c9aa', '#b9a882', '#3a2e22'] },
    dwarven:   { name: 'Dwarven carved', pat: 12, p: [9, 3, 0.03, 0.05], period: 2, spec: 0.4 },
    boards:    { name: 'Wood: boards',      pat: 13, p: [9, 0, 0, 0], period: 2, spec: 0.15, wood: true },
    logs:      { name: 'Wood: logs',        pat: 13, p: [7, 1, 0, 0], period: 2, spec: 0.12, wood: true },
    panels:    { name: 'Wood: panelling',   pat: 13, p: [6, 2, 0, 0], period: 2, spec: 0.3, wood: true },
    timber:    { name: 'Wood: half-timber', pat: 13, p: [2, 3, 0, 0], period: 2, spec: 0.15, wood: true },
    // doors (1 unit, drawn on the door leaf)
    planks:    { name: 'Door: banded oak',   pat: 7, p: [6, 0, 0, 0], period: 1, spec: 0.15, wood: true, door: true },
    studded:   { name: 'Door: studded oak',  pat: 7, p: [5, 1, 0, 0], period: 1, spec: 0.2, wood: true, door: true },
    double:    { name: 'Door: double oak',   pat: 7, p: [8, 2, 0, 0], period: 1, spec: 0.15, wood: true, door: true },
    cell:      { name: 'Door: cell door',    pat: 7, p: [6, 3, 0, 0], period: 1, spec: 0.15, wood: true, door: true },
    rotten:    { name: 'Door: rotten',       pat: 7, p: [6, 4, 0, 0], period: 1, spec: 0.1, wood: true, door: true, cols: ['#4a3a2a', '#5e4a34', '#1a120a'] },
    iron:      { name: 'Door: iron plate',   pat: 8, p: [2, 3, 0, 0], period: 1, spec: 0.6, metal: true, door: true },
    slab:      { name: 'Door: rune slab',    pat: 9, p: [0, 0, 0, 0], period: 1, spec: 0.3, door: true, runes: true },
    bronze:    { name: 'Door: bronze',       pat: 10, p: [0, 0, 0, 0], period: 1, spec: 0.9, door: true, cols: ['#a07a3a', '#3f7a62', '#2a1f12'] },
    portcullis:{ name: 'Door: portcullis',   pat: 8, p: [2, 3, 0, 0], period: 1, spec: 0.6, metal: true, door: true, bars: true }
  };
  // the CC0 photo tiles already in the game (msdd_assets.js)
  var PHOTOS = ['stone.tower', 'stone.warren', 'stone.lab', 'stone.bright', 'stone.brick', 'stone.terra',
                'floor', 'floor.flagstone', 'floor.terra', 'door.plain', 'door.gate', 'metal'];

  var WOOD = ['#5e3f24', '#77512f', '#21160d'], IRON = ['#3d3c3e', '#6b3f22', '#131213'];

  /* ---------------- the zones ----------------
     stone: the main colour, a second for variety, and the mortar.
     cover.style: 0 moss, 1 lava, 2 crystal, 3 frost, 4 dust, 5 fungus.
     torch / lamp / amb / fog / glow: the light of the place. */
  /* water: colour under the torch, how much it hides the floor, any glow of its own */
  var WATERS = {
    none:  null,
    clear: { name: 'Clear',        c: '#1c4c66', murk: 0.45, e: '#000000' },
    teal:  { name: 'Teal',         c: '#1f5a52', murk: 0.6,  e: '#000000' },
    murky: { name: 'Murky sewer',  c: '#38401c', murk: 0.85, e: '#000000' },
    peat:  { name: 'Peat brown',   c: '#3e2a12', murk: 0.8,  e: '#000000' },
    blood: { name: 'Blood red',    c: '#4c0a0a', murk: 0.9,  e: '#140000' },
    glow:  { name: 'Arcane glow',  c: '#30185a', murk: 0.7,  e: '#2a0f5a' }
  };

  /* decor: what stands about. rubble, blocks, webs, bones, skulls, stalactites,
     stalagmites, beams, crates, barrels, mushrooms, crystals, coffins, urns, chains.
     parts: the particles in the air. */
  var Z = function (o) { return o; };
  var ZONES = {
    damp:   Z({ name: 'Damp halls',   wall: 'brick',   floor: 'flagstone', ceil: 'rubble',  door: 'planks',  prop: 'rubble',
              stone: ['#6f6b5e', '#8a8170', '#2f2b24'], floorTone: 0.85,
              cover: { style: 0, a: '#34491b', b: '#66762c', emit: '#000000', amt: 0.55 },
              torch: '#ffd2a2', lamp: '#ffb878', amb: '#0b0e09', fog: '#030402', glow: '#000000', wet: 0.7,
              water: 'none', decor: ['rubble', 'webs', 'chains', 'barrels'], parts: { kind: 'drip', col: '#9fc4d8' } }),
    sunken: Z({ name: 'Sunken halls', wall: 'ashlar',  floor: 'flagstone', ceil: 'cave',    door: 'iron',    prop: 'ashlar',
              stone: ['#5f6a66', '#7b8580', '#232a28'], floorTone: 0.8,
              cover: { style: 0, a: '#2c4a32', b: '#4f7a4a', emit: '#000000', amt: 0.45 },
              torch: '#ffdcb4', lamp: '#a0e0ff', amb: '#050c10', fog: '#020608', glow: '#0a2a30', glowUp: 0, wet: 0.9,
              water: 'clear', decor: ['blocks', 'chains', 'stalactites'], parts: { kind: 'drip', col: '#a8d8ee' } }),
    sewer:  Z({ name: 'Sewers',       wall: 'brick',   floor: 'cobble',    ceil: 'brick',   door: 'cell',    prop: 'brick',
              stone: ['#5a4a3c', '#6e5a48', '#211912'], floorTone: 0.8,
              cover: { style: 0, a: '#3a4418', b: '#5c6620', emit: '#000000', amt: 0.6 },
              torch: '#ffd2a2', lamp: '#d8e070', amb: '#090a04', fog: '#040502', glow: '#000000', wet: 0.95,
              water: 'murky', decor: ['rubble', 'barrels', 'crates', 'webs'], parts: { kind: 'drip', col: '#b4c080' } }),
    overgrown: Z({ name: 'Overgrown ruin', wall: 'rubble', floor: 'flagstone', ceil: 'cave', door: 'rotten',  prop: 'rubble',
              stone: ['#7a7462', '#938a72', '#2e2a20'], floorTone: 0.85,
              cover: { style: 7, a: '#2c4a1a', b: '#5a7a26', emit: '#000000', amt: 0.6 },
              torch: '#ffd8aa', lamp: '#ffc890', amb: '#0a0e08', fog: '#040603', glow: '#3a4a26', glowUp: 1, wet: 0.35,
              water: 'none', decor: ['rubble', 'blocks', 'webs'], parts: { kind: 'leaves', col: '#a08a3a' } }),
    lava:   Z({ name: 'Lava forge',   wall: 'cave',    floor: 'flagstone', ceil: 'cave',    door: 'iron',    prop: 'cave',
              stone: ['#3b312d', '#57473d', '#120d0b'], floorTone: 0.8,
              cover: { style: 1, a: '#0a0807', b: '#2a1408', emit: '#ff5512', amt: 0.6 },
              torch: '#ffc69a', lamp: '#ff9a58', amb: '#170604', fog: '#0d0302', glow: '#ff4810', wet: 0.1,
              water: 'none', decor: ['rubble', 'stalactites', 'stalagmites', 'chains'], parts: { kind: 'embers', col: '#ff8a30' } }),
    infernal: Z({ name: 'Infernal pit', wall: 'ashlar', floor: 'flagstone', ceil: 'cave',   door: 'bronze',  prop: 'cave',
              stone: ['#4a2420', '#64302a', '#140806'], floorTone: 0.8,
              cover: { style: 1, a: '#120605', b: '#3a0a06', emit: '#ff2a10', amt: 0.5 },
              torch: '#ffc0a0', lamp: '#ff4a2a', amb: '#1a0303', fog: '#0e0101', glow: '#c01808', wet: 0.2,
              water: 'blood', decor: ['bones', 'skulls', 'chains', 'stalagmites'], parts: { kind: 'embers', col: '#ff4a20' } }),
    arcane: Z({ name: 'Arcane vault', wall: 'ashlar',  floor: 'tiles',     ceil: 'ashlar',  door: 'slab',    prop: 'ashlar',
              stone: ['#6a6577', '#8a8498', '#23202c'], floorTone: 0.75,
              cover: { style: 2, a: '#6b34c0', b: '#c39bff', emit: '#a860ff', amt: 0.5 },
              torch: '#ffe0c0', lamp: '#b77bff', amb: '#09061a', fog: '#04020b', glow: '#3a1470', wet: 0.3,
              water: 'none', decor: ['crystals', 'blocks', 'urns'], parts: { kind: 'sparks', col: '#c79bff' } }),
    frost:  Z({ name: 'Frost vault',  wall: 'ashlar',  floor: 'flagstone', ceil: 'cave',    door: 'iron',    prop: 'ashlar',
              stone: ['#5b6570', '#7b8794', '#232a32'], floorTone: 0.9,
              cover: { style: 3, a: '#e2f1ff', b: '#9fc6ee', emit: '#000000', amt: 0.6 },
              torch: '#ffd8b0', lamp: '#9fd0ff', amb: '#060a13', fog: '#03060b', glow: '#0a1a33', wet: 0.85,
              water: 'none', decor: ['stalactites', 'blocks', 'coffins'], parts: { kind: 'snow', col: '#e8f4ff' } }),
    crypt:  Z({ name: 'Dry crypt',    wall: 'rubble',  floor: 'cobble',    ceil: 'flagstone', door: 'studded', prop: 'rubble',
              stone: ['#8b7b63', '#a28f72', '#3b3125'], floorTone: 0.8,
              cover: { style: 4, a: '#b9ae99', b: '#ddd5c4', emit: '#000000', amt: 0.5 },
              torch: '#ffd2a2', lamp: '#ffb878', amb: '#0c0a07', fog: '#050403', glow: '#000000', wet: 0.05,
              water: 'none', decor: ['coffins', 'webs', 'bones', 'urns'], parts: { kind: 'dust', col: '#d8cbb0' } }),
    ossuary: Z({ name: 'Ossuary',     wall: 'bones',   floor: 'flagstone', ceil: 'rubble',  door: 'cell',    prop: 'rubble',
              stone: ['#7d7260', '#958870', '#30281c'], floorTone: 0.8,
              cover: { style: 4, a: '#b0a68e', b: '#d8d0bc', emit: '#000000', amt: 0.45 },
              torch: '#ffd2a2', lamp: '#d0ffb0', amb: '#0a0b07', fog: '#040503', glow: '#000000', wet: 0.1,
              water: 'none', decor: ['skulls', 'bones', 'webs', 'urns'], parts: { kind: 'dust', col: '#d0c8b0' } }),
    tomb:   Z({ name: 'Sandstone tomb', wall: 'ashlar', floor: 'tiles',   ceil: 'ashlar',  door: 'slab',    prop: 'ashlar',
              stone: ['#b8955e', '#cfa96c', '#5a4224'], floorTone: 0.85,
              cover: { style: 8, a: '#d6b47a', b: '#ffd060', emit: '#000000', amt: 0.5 },
              torch: '#ffd8a8', lamp: '#ffc070', amb: '#100b05', fog: '#060402', glow: '#000000', wet: 0.0,
              water: 'none', decor: ['coffins', 'urns', 'blocks'], parts: { kind: 'dust', col: '#e8d0a0' } }),
    dwarven: Z({ name: 'Dwarven hall', wall: 'dwarven', floor: 'tiles',   ceil: 'ashlar',  door: 'bronze',  prop: 'ashlar',
              stone: ['#5e5a56', '#77716a', '#1e1c1a'], floorTone: 0.8,
              cover: { style: 4, a: '#a09888', b: '#c8bca8', emit: '#000000', amt: 0.3 },
              torch: '#ffd2a2', lamp: '#ffa850', amb: '#0c0906', fog: '#050403', glow: '#000000', wet: 0.1,
              water: 'none', decor: ['barrels', 'crates', 'blocks', 'chains'], parts: { kind: 'dust', col: '#e0c090' } }),
    mine:   Z({ name: 'Old mine',     wall: 'cave',    floor: 'cobble',    ceil: 'cave',    door: 'planks',  prop: 'cave',
              stone: ['#5a5048', '#6e6258', '#1e1a16'], floorTone: 0.85,
              cover: { style: 9, a: '#9a8c78', b: '#d8b860', emit: '#40a0ff', amt: 0.5 },
              torch: '#ffd2a2', lamp: '#ffb878', amb: '#0a0806', fog: '#040302', glow: '#000000', wet: 0.15,
              water: 'none', decor: ['beams', 'rubble', 'crates', 'barrels'], parts: { kind: 'dust', col: '#c8b898' } }),
    fungal: Z({ name: 'Fungal deep',  wall: 'cave',    floor: 'cobble',    ceil: 'cave',    door: 'rotten',  prop: 'cave',
              stone: ['#4b4352', '#5f5566', '#1b1720'], floorTone: 0.85,
              cover: { style: 5, a: '#3b2449', b: '#6d3f6a', emit: '#2cffcf', amt: 0.55 },
              torch: '#ffd2a2', lamp: '#40ffd0', amb: '#030f0c', fog: '#010504', glow: '#06302a', wet: 0.45,
              water: 'none', decor: ['mushrooms', 'stalactites', 'stalagmites', 'rubble'], parts: { kind: 'spores', col: '#50ffd8' } }),
    lodge:  Z({ name: 'Timber cellar', wall: 'timber', floor: 'boards',    ceil: 'boards',  door: 'double',  prop: 'rubble',
              stone: ['#6a5a48', '#7e6c56', '#2a2219'], floorTone: 0.9,
              cover: { style: 4, a: '#a89a84', b: '#c9bea8', emit: '#000000', amt: 0.35 },
              torch: '#ffd2a2', lamp: '#ffb878', amb: '#0c0906', fog: '#050302', glow: '#000000', wet: 0.05,
              water: 'none', decor: ['barrels', 'crates', 'webs', 'beams'], parts: { kind: 'dust', col: '#d8c8a8' } }),
    tower:  Z({ name: 'Ashkeld tower (photo tiles)', wall: 'photo:stone.tower', floor: 'photo:floor', ceil: 'photo:stone.tower', door: 'photo:door.plain', prop: 'rubble',
              stone: ['#c69a60', '#c69a60', '#c69a60'], floorTone: 1,
              cover: { style: 4, a: '#a89a84', b: '#c9bea8', emit: '#000000', amt: 0.3 },
              torch: '#ffd2a2', lamp: '#ffb878', amb: '#0a0806', fog: '#040302', glow: '#000000', wet: 0.1,
              water: 'none', decor: ['rubble', 'webs', 'barrels'], parts: { kind: 'dust', col: '#d8c8a8' } })
  };

  /* ---------------- the bake shader ---------------- */
  var BAKE_VS = '#version 300 es\nout vec2 vUv;\nvoid main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  var BAKE_FS = [
    '#version 300 es', 'precision highp float;',
    'in vec2 vUv; out vec4 o;',
    'uniform int uPat; uniform vec3 uA, uB, uM; uniform float uSeed; uniform vec4 uP;',
    'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed * 0.1371); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'vec2 h22(vec2 p){ float a = h21(p); return vec2(a, h21(p + a * 17.13 + 3.1)); }',
    // periodic value noise and fbm: everything tiles
    'float vn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = h21(mod(i, per)), b = h21(mod(i + vec2(1, 0), per)), c = h21(mod(i + vec2(0, 1), per)), d = h21(mod(i + vec2(1, 1), per));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }',
    'float fbm(vec2 uv, float s){ vec2 per = vec2(s); vec2 p = uv * s; float t = 0.0, a = 0.5;',
    '  for (int i = 0; i < 5; i++){ t += a * vn(p, per); p *= 2.0; per *= 2.0; a *= 0.5; } return t / 0.96875; }',
    // periodic voronoi: nearest, second nearest, and the nearest cell's id
    'vec2 vR;',
    'vec4 voro(vec2 uv, float n, float jit){ vec2 p = uv * n, i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0);',
    '  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(x, y), c = mod(i + g, n);',
    '    vec2 r = g + 0.5 + (h22(c) - 0.5) * jit - f; float d = dot(r, r);',
    '    if (d < d1){ d2 = d1; d1 = d; id = c; vR = r; } else if (d < d2) d2 = d; }',
    '  return vec4(sqrt(d1), sqrt(d2), id); }',
    'vec3 tone(vec2 id, float n){ vec3 c = mix(uA, uB, h21(id + 0.37)); c *= 0.78 + 0.44 * h21(id + 5.1); return c * (0.72 + 0.5 * n); }',
    'float grain(){ return fbm(vUv, 96.0); }',
    'float pits(){ return 1.0 - 0.6 * smoothstep(0.62, 0.78, fbm(vUv + 0.5, 64.0)) - 0.4 * smoothstep(0.7, 0.85, fbm(vUv, 20.0)); }',
    // a row of blocks: brick (fixed count) or ashlar (each row its own)
    'vec4 blocks(bool ash){ float rows = uP.x; float row = floor(vUv.y * rows);',
    '  float per = ash ? floor(mix(uP.y * 0.6, uP.y * 1.5, h21(vec2(row, 7.0))) + 0.5) : uP.y;',
    '  float off = ash ? h21(vec2(row, 3.0)) : mod(row, 2.0) * 0.5;',
    '  float qx = vUv.x * per + off; vec2 id = vec2(mod(floor(qx), per), row); vec2 f = vec2(fract(qx), fract(vUv.y * rows));',
    '  float e = min(min(f.x, 1.0 - f.x) * rows / per, min(f.y, 1.0 - f.y));',
    '  float nd = fbm(vUv, 16.0), nf = fbm(vUv, 48.0);',
    '  e += (nd - 0.5) * 0.10;',                                         // chipped edges
    '  float body = smoothstep(uP.z, uP.z + uP.w, e);',
    '  float lean = (h21(id + 9.1) - 0.5) * 0.25;',                        // each block sits a little proud or sunk
    '  float gr = grain(), pt = pits();',
    '  float h = body * (0.55 + lean + 0.18 * nf + 0.14 * gr + 0.16 * smoothstep(0.0, 0.3, e)) * mix(0.82, 1.0, pt);',
    '  vec3 c = mix(uM * (0.85 + 0.4 * gr), tone(id, nf * 0.6 + gr * 0.4) * mix(0.8, 1.0, pt), body);',
    '  return vec4(c, h); }',
    'void main(){',
    '  vec3 c; float h;',
    '  if (uPat == 0 || uPat == 1){ vec4 r = blocks(uPat == 1); c = r.rgb; h = r.a; }',
    '  else if (uPat == 2 || uPat == 3 || uPat == 5){',                    // rubble, flagstone, cobble
    '    vec4 v = voro(vUv, uP.x, uP.y); float edge = v.y - v.x; float nf = fbm(vUv, 40.0), nd = fbm(vUv, 12.0);',
    '    edge += (nd - 0.5) * 0.12;',
    '    float body = smoothstep(uP.z, uP.z + uP.w, edge);',
    '    float pillow = sqrt(clamp(edge / (uPat == 5 ? 0.5 : 0.38), 0.0, 1.0));',
    '    float dome = uPat == 3 ? 0.85 + 0.1 * nd : 0.35 + 0.65 * pillow;',
    '    float gr = grain(), pt = pits();',
    '    h = body * (dome * 0.7 + 0.15 * nf + 0.15 * gr) * mix(0.85, 1.0, pt); c = mix(uM * (0.85 + 0.4 * gr), tone(v.zw, nf * 0.6 + gr * 0.4) * mix(0.82, 1.0, pt) * (0.8 + 0.25 * dome), body); }',
    '  else if (uPat == 4){',                                              // cave rock: broken faces, cracks, faint strata
    '    vec4 v = voro(vUv, 5.0, 1.0); float edge = v.y - v.x + (fbm(vUv, 16.0) - 0.5) * 0.25;',
    '    float crack = smoothstep(0.0, 0.07, edge);',
    '    float n1 = fbm(vUv + h21(v.zw) * 0.3, 8.0), rdg = 1.0 - abs(fbm(vUv, 24.0) * 2.0 - 1.0), gr = grain();',
    '    float tilt = dot(-vR, h22(v.zw) - 0.5) * 0.6;',      // each face leans its own way
    '    h = clamp(crack * (0.45 + tilt + 0.25 * n1 + 0.15 * rdg + 0.15 * gr), 0.0, 1.0);',
    '    float strata = fbm(vec2(vUv.x, vUv.y * 6.0), 4.0);',
    '    c = mix(uA, uB, smoothstep(0.35, 0.65, strata) * 0.6 + h21(v.zw) * 0.4) * (0.65 + 0.45 * gr + 0.2 * rdg);',
    '    c = mix(uM, c, crack); }',
    '  else if (uPat == 6){',                                              // glazed tiles, an inlay on every other one
    '    vec2 q = vUv * uP.x, id = floor(q), f = fract(q); float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));',
    '    float body = smoothstep(uP.z, uP.z + uP.w, e); float nf = fbm(vUv, 32.0);',
    '    float inlay = mod(id.x + id.y, 2.0) * smoothstep(0.035, 0.0, abs(abs(f.x - 0.5) + abs(f.y - 0.5) - 0.3));',
    '    h = body * (0.8 - 0.25 * inlay + 0.05 * nf); c = mix(uM, mix(tone(id, nf), uM * 1.6, inlay * 0.8), body); }',
    '  else if (uPat == 7){',                                              // planks: banded, studded, double, cell, rotten
    '    int vt = int(uP.y + 0.5);',
    '    float q = vUv.x * uP.x, id = floor(q), f = fract(q);',
    '    float grain = fbm(vec2(vUv.x * 2.0 + id * 0.37, vUv.y * 0.25), 8.0), fine = fbm(vec2(vUv.x * 6.0, vUv.y * 0.5) + id, 32.0);',
    '    float groove = smoothstep(0.0, 0.06, f) * smoothstep(1.0, 0.94, f);',
    '    vec3 wood = mix(uA, uB, h21(vec2(id, 1.0))) * (0.7 + 0.5 * grain) * (0.85 + 0.3 * fine);',
    '    vec3 iron = vec3(0.16, 0.155, 0.15) * (0.7 + 0.6 * fine);',
    '    h = groove * (0.5 + 0.15 * grain); c = wood * mix(0.5, 1.0, groove);',
    '    if (vt == 2){ float sp = smoothstep(0.0, 0.012, abs(vUv.x - 0.5)); h *= sp; c *= mix(0.25, 1.0, sp); }',  // two leaves
    '    if (vt == 1){',                                                    // battens and a Z brace, studded
    '      float bat = max(smoothstep(0.06, 0.05, abs(vUv.y - 0.18)), smoothstep(0.06, 0.05, abs(vUv.y - 0.82)));',
    '      vec2 a0 = vec2(0.12, 0.24), a1 = vec2(0.88, 0.76), d = a1 - a0; float t = clamp(dot(vUv - a0, d) / dot(d, d), 0.0, 1.0);',
    '      float br = smoothstep(0.05, 0.04, length(vUv - (a0 + d * t)));',
    '      float wb = max(bat, br); vec3 w2 = mix(uA, uB, 0.7) * (0.75 + 0.4 * fbm(vUv * vec2(0.3, 3.0), 16.0));',
    '      c = mix(c, w2, wb); h = mix(h, 0.85, wb);',
    '      vec2 sq = fract(vUv * vec2(uP.x, 9.0)) - 0.5; float stud = smoothstep(0.16, 0.1, length(sq * vec2(1.0 / uP.x, 1.0 / 9.0) * vec2(uP.x, 9.0) * 0.5));',
    '      stud *= step(0.5, mod(floor(vUv.y * 9.0), 2.0)) * (1.0 - wb);',
    '      c = mix(c, iron * 1.8, stud); h = mix(h, 1.0, stud);',
    '    } else {',
    '      float band = max(smoothstep(0.045, 0.035, abs(vUv.y - 0.2)), smoothstep(0.045, 0.035, abs(vUv.y - 0.8)));',
    '      float nail = smoothstep(0.016, 0.01, length(vec2((f - 0.5) / uP.x, abs(vUv.y - 0.2) < 0.1 ? vUv.y - 0.2 : vUv.y - 0.8)));',
    '      if (vt == 4){ float r = smoothstep(0.5, 0.8, fbm(vUv, 6.0)); iron = mix(iron, vec3(0.32, 0.15, 0.06), r); }',
    '      c = mix(c, iron, band); h = mix(h, 0.8, band); c = mix(c, iron * 1.6, nail); h = mix(h, 1.0, nail);',
    '    }',
    '    if (vt == 3){',                                                    // a cell door: a barred window
    '      vec2 w = abs(vUv - vec2(0.5, 0.72)); float win = step(w.x, 0.17) * step(w.y, 0.09);',
    '      float fr = step(w.x, 0.2) * step(w.y, 0.12) * (1.0 - win);',
    '      float bars = win * smoothstep(0.016, 0.008, abs(fract((vUv.x - 0.33) * 12.0 / 0.34 * 0.34) - 0.5) * 0.34 / 12.0 * 12.0);',
    '      c = mix(c, iron * 1.3, fr); h = mix(h, 0.9, fr);',
    '      c = mix(c, vec3(0.01), win); h = mix(h, 0.0, win);',
    '      float bx = abs(fract((vUv.x - 0.33) / 0.0567) - 0.5); float bar = win * smoothstep(0.16, 0.08, bx);',
    '      c = mix(c, iron * 1.5, bar); h = mix(h, 1.0, bar);',
    '    }',
    '    if (vt == 4){',                                                    // rotten: gaps, broken ends, split planks
    '      float lose = h21(vec2(id, 4.0)); float cut = lose * 0.45 + (fbm(vUv, 24.0) - 0.5) * 0.08;',
    '      float gone = step(lose, 0.55) * step(vUv.y, cut);',
    '      float split = smoothstep(0.012, 0.0, abs(f - 0.3 - 0.4 * h21(vec2(id, 9.0)) + (fbm(vUv, 12.0) - 0.5) * 0.2)) * step(0.6, h21(vec2(id, 6.0)));',
    '      c *= 0.75 + 0.25 * fbm(vUv, 40.0); c = mix(c, vec3(0.01), max(gone, split)); h = mix(h, 0.0, max(gone, split));',
    '    }',
    '  }',
    '  else if (uPat == 8){',                                              // riveted iron plates, rusting
    '    vec2 q = vUv * vec2(uP.x, uP.y), id = floor(q), f = fract(q); float e = min(min(f.x, 1.0 - f.x) / uP.x, min(f.y, 1.0 - f.y) / uP.y);',
    '    float seam = smoothstep(0.0, 0.012, e); float rust = smoothstep(0.45, 0.75, fbm(vUv, 8.0) + 0.15 * fbm(vUv, 48.0));',
    '    vec2 rv = fract(q * vec2(1.0, 4.0)) - 0.5; float riv = smoothstep(0.09, 0.05, length(vec2(min(f.x, 1.0 - f.x) * 4.0 - 0.18, rv.y * 0.9)));',
    '    float nf = fbm(vUv, 64.0);',
    '    c = mix(uA * (0.8 + 0.4 * nf), uB * (0.7 + 0.6 * nf), rust) * seam; h = seam * (0.6 - 0.15 * rust + 0.05 * nf);',
    '    c = mix(c, uA * 1.7, riv); h = mix(h, 1.0, riv); }',
    '  else if (uPat == 9){',                                              // a stone slab: carved border and a rune ring
    '    vec2 d = abs(vUv - 0.5); float box = max(d.x, d.y); float gr = grain(), nf = fbm(vUv, 16.0);',
    '    float border = smoothstep(0.012, 0.0, abs(box - 0.43)) + smoothstep(0.008, 0.0, abs(box - 0.46));',
    '    vec2 cq = vUv - vec2(0.5, 0.55); float r = length(cq), an = atan(cq.y, cq.x);',
    '    float ring = smoothstep(0.01, 0.0, abs(r - 0.26)) + smoothstep(0.008, 0.0, abs(r - 0.21));',
    '    float seg = floor((an + 3.14159) / 6.28318 * 12.0); float ra = fract((an + 3.14159) / 6.28318 * 12.0);',
    '    float rune = step(0.21, r) * step(r, 0.26) * smoothstep(0.08, 0.0, abs(ra - 0.5 - (h21(vec2(seg, 2.0)) - 0.5) * 0.4) - 0.02 * step(0.5, h21(vec2(seg, 5.0))));',
    '    float star = smoothstep(0.012, 0.0, abs(max(abs(cq.x) * 0.87 + cq.y * 0.5, -cq.y) - 0.1));',
    '    float cut = clamp(border + ring + rune + star, 0.0, 1.0);',
    '    h = (0.75 + 0.15 * nf + 0.1 * gr) * (1.0 - cut * 0.85); c = mix(uA, uB, nf) * (0.8 + 0.35 * gr) * (1.0 - cut * 0.55); }',
    '  else if (uPat == 10){',                                             // a bronze door: squares within squares, verdigris
    '    vec2 d = abs(vUv - 0.5); float box = max(d.x, d.y); float nf = fbm(vUv, 32.0);',
    '    float lines = smoothstep(0.012, 0.0, abs(fract(box * 9.0) - 0.5) / 9.0 - 0.0);',
    '    float diag = smoothstep(0.01, 0.0, abs(d.x - d.y)) * step(box, 0.33);',
    '    float bosses = smoothstep(0.035, 0.025, length(d - vec2(0.38))) ;',
    '    float green = smoothstep(0.5, 0.8, fbm(vUv, 6.0) + 0.3 * (1.0 - smoothstep(0.0, 0.3, vUv.y)));',
    '    vec3 br = mix(uA * (0.8 + 0.4 * nf), uB, green * 0.8);',
    '    float cut = clamp(lines + diag, 0.0, 1.0); h = 0.7 - cut * 0.4 + bosses * 0.3 + 0.05 * nf;',
    '    c = br * (1.0 - cut * 0.5) + uA * bosses * 0.5; }',
    '  else if (uPat == 11){',                                             // an ossuary wall: rows of skulls between bones
    '    float rows = uP.x, row = floor(vUv.y * rows), fy = fract(vUv.y * rows); float nf = fbm(vUv, 48.0), gr = grain();',
    '    bool skulls = mod(row, 2.0) < 0.5; vec3 bone = mix(uA, uB, nf) * (0.75 + 0.4 * gr);',
    '    if (skulls){',
    '      float per = uP.y, qx = vUv.x * per + 0.5 * mod(row, 4.0) * 0.5, id = floor(qx); vec2 f = vec2(fract(qx), fy) - 0.5; f.x *= rows / per * 0.5 * 2.0;',
    '      f.x *= per / rows * 2.0;',
    '      float sk = smoothstep(0.42, 0.36, length(f * vec2(1.0, 1.05) - vec2(0.0, 0.04)));',
    '      float jaw = smoothstep(0.24, 0.18, length((f - vec2(0.0, -0.28)) * vec2(1.0, 1.6)));',
    '      float eyes = smoothstep(0.11, 0.07, length(vec2(abs(f.x) - 0.15, f.y - 0.05)));',
    '      float nose = smoothstep(0.05, 0.03, length((f - vec2(0.0, -0.1)) * vec2(1.4, 1.0)));',
    '      float body = max(sk, jaw) * (1.0 - max(eyes, nose));',
    '      h = body * (0.6 + 0.3 * (1.0 - length(f))) ; c = mix(mix(uM, uA * 0.35, nf), bone * (0.85 + 0.2 * h21(vec2(id, row))), body);',
    '    } else {',
    '      float sub = floor(fy * 3.0), sy = fract(fy * 3.0) - 0.5; float off = h21(vec2(row, sub)) * 3.0;',
    '      float qx = vUv.x * 5.0 + off, id = floor(qx), fx = fract(qx) - 0.5;',
    '      float shaft = smoothstep(0.32, 0.26, abs(sy)) * step(abs(fx), 0.4);',
    '      float knob = smoothstep(0.44, 0.36, length(vec2((abs(fx) - 0.42) * 2.2, abs(sy) - 0.12))) * step(0.36, abs(fx));',
    '      float body = max(shaft, knob);',
    '      h = body * (0.5 + 0.3 * (0.5 - abs(sy))); c = mix(mix(uM, uA * 0.35, nf), bone * (0.8 + 0.25 * h21(vec2(id, row + sub))), body);',
    '    } }',
    '  else if (uPat == 12){',                                             // a dwarven wall: ashlar with a bronze-inlaid band
    '    vec4 r = blocks(false); c = r.rgb; h = r.a;',
    '    float rows = uP.x, row = floor(vUv.y * rows), fy = fract(vUv.y * rows);',
    '    if (mod(row, 3.0) < 0.5){',
    '      float qx = vUv.x * uP.y * 4.0; float z = abs(fract(qx) - 0.5) * 2.0;',
    '      float zig = smoothstep(0.08, 0.0, abs(fy - 0.5 - (z - 0.5) * 0.5)) + smoothstep(0.08, 0.0, abs(fy - 0.5 + (z - 0.5) * 0.5));',
    '      float rim = smoothstep(0.06, 0.0, abs(fy - 0.15)) + smoothstep(0.06, 0.0, abs(fy - 0.85));',
    '      float inl = clamp(zig + rim, 0.0, 1.0) * step(0.3, h);',
    '      c = mix(c, vec3(0.62, 0.42, 0.18) * (0.8 + 0.4 * fbm(vUv, 64.0)), inl); h = mix(h, h * 0.8, inl);',
    '    } }',
    '  else if (uPat == 13){',                                             // wooden walls: boards, logs, panels, half-timber
    '    int vt = int(uP.y + 0.5); float nf = fbm(vUv, 32.0);',
    '    if (vt == 0 || vt == 1){',                                         // boards or logs, running sideways
    '      float rows = uP.x, row = floor(vUv.y * rows), f = fract(vUv.y * rows);',
    '      float len = 2.0 + floor(h21(vec2(row, 3.0)) * 2.0), qx = vUv.x * len + h21(vec2(row, 1.0)), id = floor(qx), fx = fract(qx);',
    '      float grain = fbm(vec2(vUv.x * 0.25, vUv.y * rows * 0.5 + row * 0.37), 8.0);',
    '      vec3 wood = mix(uA, uB, h21(vec2(id, row))) * (0.65 + 0.55 * grain) * (0.85 + 0.3 * nf);',
    '      if (vt == 0){ float g = smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.93, f) * smoothstep(0.0, 0.01, fx) * smoothstep(1.0, 0.99, fx);',
    '        h = g * (0.55 + 0.2 * grain + 0.1 * f); c = wood * mix(0.35, 1.0, g);',
    '        float nail = smoothstep(0.03, 0.015, length(vec2((fx - 0.05) * 4.0 / rows * len, f - 0.5) * vec2(rows, 1.0) * vec2(0.25, 0.4)));',
    '        c = mix(c, vec3(0.12), nail); }',
    '      else { float rnd = sqrt(max(0.0, 1.0 - pow(f * 2.0 - 1.0, 2.0)));',
    '        float endgrain = step(fx, 0.03) + step(0.97, fx); h = rnd * (0.8 + 0.1 * grain); c = wood * (0.35 + 0.75 * rnd);',
    '        c = mix(c, uB * 1.2 * (0.7 + 0.3 * sin(length(vec2(fx, f - 0.5)) * 60.0)), endgrain * 0.0); }',
    '    } else if (vt == 2){',                                             // raised panels with a rail
    '      vec2 q = vUv * vec2(uP.x * 0.5, 2.0), id = floor(q), f = fract(q); vec2 d = abs(f - 0.5);',
    '      float frame = step(0.38, max(d.x, d.y)); float bevel = smoothstep(0.38, 0.3, max(d.x, d.y));',
    '      float grain = fbm(vec2(vUv.x * 4.0, vUv.y * 0.6) + id, 16.0);',
    '      vec3 wood = mix(uA, uB, h21(id)) * (0.7 + 0.5 * grain);',
    '      h = frame * 0.85 + (1.0 - frame) * (0.45 + 0.3 * bevel); c = wood * (frame > 0.5 ? 0.85 : 0.75 + 0.3 * bevel);',
    '    } else {',                                                         // half-timber: dark beams, pale plaster
    '      vec2 q = vUv * vec2(2.0, 2.0), id = floor(q), f = fract(q);',
    '      float post = step(abs(f.x - 0.5), 0.06) + step(f.x, 0.04) + step(0.96, f.x);',
    '      float rail = step(abs(f.y - 0.5), 0.05) + step(f.y, 0.04) + step(0.96, f.y);',
    '      float brace = step(abs((f.y - 0.5) - (f.x - 0.5) * (mod(id.x + id.y, 2.0) < 0.5 ? 1.0 : -1.0)), 0.05) * step(abs(f.x - 0.5), 0.5);',
    '      float beam = clamp(post + rail + brace, 0.0, 1.0);',
    '      float grain = fbm(vec2(vUv.x * 2.0, vUv.y * 8.0), 8.0);',
    '      vec3 plaster = vec3(0.78, 0.72, 0.6) * (0.8 + 0.25 * nf) * (1.0 - 0.3 * smoothstep(0.6, 0.85, fbm(vUv, 6.0)));',
    '      vec3 timber = mix(uA, uB, 0.3) * 0.55 * (0.6 + 0.6 * grain);',
    '      h = mix(0.45 + 0.1 * nf, 0.85 + 0.1 * grain, beam); c = mix(plaster, timber, beam);',
    '    }',
    '  }',
    '  o = vec4(c, clamp(h, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* ---------------- the corridor shader's material and cover chunk ----------------
     Needs: vPos (world), vNrm, vUv; uniforms below. Returns lit colour. */
  var COVER = [
    'uniform sampler2D uMat; uniform float uPeriod; uniform int uUvMode; uniform float uSpec; uniform vec3 uTintC;',
    'uniform int uStyle; uniform vec3 uCovA, uCovB, uEmitC; uniform float uAmt, uWet, uTime; uniform int uSurf;',
    'uniform vec3 uTorchC, uLampC, uAmbC, uGlowC; uniform float uGlowUp, uRunes; uniform float uWater, uWaterMurk; uniform vec3 uWaterC, uWaterE; uniform int uTerr;',
    'float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'float fb3(vec3 p){ return (0.5 * n3(p) + 0.25 * n3(p * 2.03) + 0.125 * n3(p * 4.01) + 0.0625 * n3(p * 8.07)) / 0.9375; }',
    'float lumc(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }',
    // which way the texture runs on this face, in world terms
    'void frame(vec3 N, out vec2 uv, out vec3 T, out vec3 B){',
    '  vec3 a = abs(N);',
    '  if (a.y > 0.7){ uv = vPos.xz; T = vec3(1,0,0); B = vec3(0,0,1); }',
    '  else if (a.x > a.z){ uv = vec2(vPos.z, vPos.y); T = vec3(0,0,1); B = vec3(0,1,0); }',
    '  else { uv = vec2(vPos.x, vPos.y); T = vec3(1,0,0); B = vec3(0,1,0); } }',
    // L: the torch; Ls/Lc: wall lamps
    'vec3 shadeStone(vec3 eye, vec3 torch, float torchI, vec4 lamps[6], int nlamps){',
    '  vec3 N = normalize(vNrm), T, B; vec2 uv; frame(N, uv, T, B);',
    '  if (uUvMode == 1) uv = vUv * uPeriod;',
    '  vec2 tuv = uv / uPeriod; float e = 1.0 / 512.0;',
    '  vec4 t = texture(uMat, tuv); float hgt = t.a;',
    '  float hx = texture(uMat, tuv + vec2(e, 0.0)).a, hy = texture(uMat, tuv + vec2(0.0, e)).a;',
    '  float depth = uUvMode == 1 ? 0.014 : 0.032, k = depth / (e * uPeriod);',
    '  vec3 grad;',
    '  if (uUvMode == 1){',                                              // doors: mesh uvs, frame from derivatives
    '    vec3 dpx = dFdx(vPos), dpy = dFdy(vPos); vec2 dux = dFdx(vUv), duy = dFdy(vUv);',
    '    float det = dux.x * duy.y - dux.y * duy.x; T = normalize((dpx * duy.y - dpy * dux.y) * sign(det)); B = normalize((dpy * dux.x - dpx * duy.x) * sign(det)); }',
    '  grad = (hx - hgt) * k * T + (hy - hgt) * k * B;',
    '  N = normalize(N - grad);',
    '  vec3 base = pow(t.rgb, vec3(2.2)) * uTintC;',
    '  base *= mix(0.55, 1.0, smoothstep(0.0, 0.5, hgt));',          // crevices hold the dark
    // ---- the covering, in world space so it runs on from square to square ----
    '  float crev = smoothstep(0.42, 0.12, hgt);',
    '  float n = fb3(vPos * 3.1), n2 = fb3(vPos * 10.7 + 7.3), y = vPos.y;',
    '  float spec = uSpec, wet = 0.0; vec3 emit = vec3(0.0); float rough = 24.0;',
    '  bool wall = uSurf == 0 || uSurf == 3, flo = uSurf == 1, ceil = uSurf == 2;',
    '  float less = (1.0 - uAmt) + (uSurf == 3 ? 0.45 : 0.0);',            // doors are kept clearer
    '  if (uStyle == 0){',                                               // moss and damp
    '    float g = flo ? 0.45 : ceil ? 0.1 : smoothstep(0.75, 0.0, y);',
    '    float m = smoothstep(0.52, 0.74, n * 0.75 + g * 0.5 + crev * 0.3 - less * 0.6);',
    '    vec3 moss = mix(uCovA, uCovB, smoothstep(0.3, 0.8, n2)) * (0.8 + 0.4 * n2);',
    '    base = mix(base, moss, m); wet = clamp(uWet * (g * 0.8 + crev * 0.5 + (ceil ? 0.3 * smoothstep(0.55, 0.7, n2) : 0.0)), 0.0, 1.0) * (1.0 - m * 0.6);',
    '    if (wall) wet = max(wet, uWet * smoothstep(0.62, 0.7, n2) * smoothstep(1.0, 0.4, y) * 0.8);', // drip streaks
    '  } else if (uStyle == 1){',                                        // soot and lava
    '    float s = ceil ? 0.85 : flo ? 0.15 : smoothstep(0.3, 1.0, y);',
    '    float soot = smoothstep(0.45, 0.75, n * 0.6 + s * 0.6 + crev * 0.25 - less * 0.5);',
    '    base = mix(base, uCovA, soot * 0.9);',
    '    float reach = flo ? 0.25 : wall ? smoothstep(0.7, 0.0, y) * 0.3 - 0.05 : -0.3;',
    '    float crack = smoothstep(0.34, 0.06, hgt) * smoothstep(0.42, 0.62, n2 + reach + uAmt * 0.15);',
    '    float pulse = 0.72 + 0.28 * sin(uTime * 1.6 + n * 14.0);',
    '    if (uSurf == 3) crack = 0.0;',
    '    emit = uEmitC * crack * pulse * 3.0; base = mix(base, uCovB, crack * 0.6); spec *= 0.6;',
    '  } else if (uStyle == 2){',                                        // violet crystal growth
    '    float lift = wall ? smoothstep(0.55, 0.0, y) * 0.35 : flo ? 0.12 : -0.1;',
    '    float grow = smoothstep(0.66, 0.74, n + lift + crev * 0.1 - less * 0.45);',
    '    float edge = smoothstep(0.6, 0.66, n + lift + crev * 0.1 - less * 0.45) - grow;',
    '    float facet = floor(n2 * 7.0) / 7.0; float glint = smoothstep(0.9, 0.97, fb3(vPos * 31.0)) * grow;',
    '    base = mix(base, uCovA * (0.35 + 0.9 * facet), grow);',
    '    emit = uEmitC * (edge * 1.6 + grow * (0.18 + 0.25 * facet) + glint * 2.5) * (0.85 + 0.15 * sin(uTime * 2.1 + n * 20.0));',
    '    if (uSurf != 3) emit += uEmitC * 0.45 * smoothstep(0.2, 0.04, hgt) * smoothstep(0.55, 0.7, n2);', // runes of light in the joints
    '    spec += grow * 1.4; rough = mix(rough, 90.0, grow);',
    '  } else if (uStyle == 3){',                                        // frost and ice
    '    float top = ceil ? 0.7 : flo ? 0.4 : smoothstep(0.45, 1.0, y) * 0.5 + smoothstep(0.35, 0.0, y) * 0.35;',
    '    float rime = smoothstep(0.45, 0.7, n * 0.6 + top * 0.5 + hgt * 0.25 - less * 0.5);',
    '    base = mix(base, mix(uCovB, uCovA, n2), rime * 0.92);',
    '    spec += rime * 0.9 + (flo ? 0.7 * (1.0 - rime) * uWet : 0.0); rough = mix(rough, 70.0, rime);',
    '    wet = flo ? uWet * 0.5 * (1.0 - rime) : 0.0;',
    '  } else if (uStyle == 5){',                                        // fungus that glows
    '    float g = flo ? 0.4 : ceil ? 0.15 : smoothstep(0.8, 0.0, y);',
    '    float m = smoothstep(0.52, 0.72, n * 0.7 + g * 0.5 + crev * 0.3 - less * 0.6);',
    '    base = mix(base, mix(uCovA, uCovB, n2), m);',
    '    vec3 cp = vPos * 9.0; vec3 ci = floor(cp); float cd = length(fract(cp) - 0.5 - (vec3(h3(ci), h3(ci + 3.1), h3(ci + 7.7)) - 0.5) * 0.5);',
    '    float caps = smoothstep(0.2, 0.12, cd) * step(0.45, h3(ci + 1.7)) * smoothstep(0.25, 0.5, m + g * 0.3);',
    '    emit = uEmitC * caps * (1.4 + 0.4 * sin(uTime * 1.3 + n * 9.0));',
    '    wet = uWet * m * 0.5;',
    '  } else if (uStyle == 7){',                                        // overgrown: roots down the walls, ivy from above
    '    float g = ceil ? 0.6 : flo ? 0.15 : smoothstep(0.2, 1.0, y);',
    '    float ivy = smoothstep(0.55, 0.72, n * 0.7 + g * 0.5 - less * 0.6);',
    '    vec3 leaf = mix(uCovA, uCovB, n2) * (0.55 + 0.7 * fb3(vPos * 41.0));',
    '    base = mix(base, leaf, ivy);',
    '    float along = flo || ceil ? vPos.x + vPos.z * 0.37 : (abs(N.x) > 0.5 ? vPos.z : vPos.x);',
    '    float rr = abs(fract(along * 1.7 + (fb3(vec3(along * 1.3, y * 1.4, 2.0)) - 0.5) * 1.6) - 0.5);',
    '    float rw = (flo ? 0.035 : 0.02 + 0.05 * smoothstep(0.0, 1.0, y)) * step(0.45, fb3(vec3(floor(along * 1.7 + 0.5), 1.0, 5.0)) + 0.1);',
    '    float root = smoothstep(rw, rw * 0.5, rr) * (1.0 - ivy * 0.5);',
    '    base = mix(base, vec3(0.16, 0.10, 0.05) * (0.6 + 0.8 * clamp(1.0 - rr / max(rw, 0.004), 0.0, 1.0)), root);',
    '    if (flo){ float lit = smoothstep(0.6, 0.75, fb3(vPos * 14.0)); base = mix(base, mix(vec3(0.35, 0.18, 0.05), vec3(0.45, 0.32, 0.08), n2), lit * 0.8); }',
    '    wet = uWet * crev * 0.4;',
    '  } else if (uStyle == 8){',                                        // a tomb: sand drifts, gold glints
    '    if (flo){ float drift = smoothstep(0.3, 0.6, n + 0.25 - less * 0.5); float rip = sin(vPos.x * 38.0 + vPos.z * 9.0 + n * 10.0);',
    '      base = mix(base, uCovA * (0.88 + 0.12 * rip), drift); N = normalize(N + vec3(cos(vPos.x * 38.0 + vPos.z * 9.0 + n * 10.0) * 0.12 * drift, 0.0, 0.0)); spec *= 1.0 - drift; }',
    '    else { float d = smoothstep(0.22, 0.0, y - (n - 0.5) * 0.25 - uAmt * 0.12) * (ceil ? 0.0 : 1.0); base = mix(base, uCovA, d);',
    '      float dust = smoothstep(0.5, 0.75, n * 0.6 + crev * 0.3 - less * 0.4); base = mix(base, uCovA * 0.8, dust * 0.4); }',
    '    float gl = smoothstep(0.9, 0.97, fb3(vPos * 57.0)) * step(0.45, hgt); spec += gl * 4.0; rough = mix(rough, 140.0, gl);',
    '    base = mix(base, uCovB, gl * 0.6);',
    '  } else if (uStyle == 9){',                                        // a mine: dust, veins of ore, the odd crystal
    '    float up = flo ? 0.55 : clamp(N.y, 0.0, 1.0) * 0.6;',
    '    float d = smoothstep(0.42, 0.72, n * 0.6 + up + crev * 0.2 - less * 0.5); base = mix(base, uCovA * (0.35 + 0.3 * n2), d * 0.5);',
    '    float vein = smoothstep(0.035, 0.0, abs(fb3(vPos * 1.6 + 3.0) - 0.5)) * (flo ? 0.3 : 1.0);',
    '    float speck = smoothstep(0.8, 0.92, fb3(vPos * 48.0)) * smoothstep(0.1, 0.0, abs(fb3(vPos * 1.6 + 3.0) - 0.5));',
    '    base = mix(base, uCovB * 0.8, max(vein * 0.7, speck)); spec += speck * 3.0 + vein * 0.6; rough = mix(rough, 120.0, speck);',
    '    float cry = smoothstep(0.86, 0.9, fb3(vPos * 6.0 + 9.0)) * smoothstep(0.5, 0.0, y) * (ceil ? 0.0 : 1.0);',
    '    emit += uEmitC * cry * 1.5; base = mix(base, uEmitC * 0.3, cry);',
    '  } else {',                                                        // 4 and anything else: dust
    '    float up = flo ? 0.55 : clamp(N.y, 0.0, 1.0) * 0.6;',
    '    float d = smoothstep(0.42, 0.72, n * 0.6 + up + crev * 0.2 - less * 0.5);',
    '    base = mix(base, uCovA * (0.35 + 0.3 * n2), d * 0.55); spec *= 1.0 - d;',
    '  }',
    '  if (uWater > 0.0){',                                               // water: a layer of its own over any zone
    '    if (flo){ float tt = uTime; vec2 w = vPos.xz;',
    '      vec2 rg = vec2(cos(w.x * 7.0 + tt * 1.3) + 0.6 * cos((w.x + w.y) * 11.0 - tt * 1.7), cos(w.y * 8.0 - tt * 1.1) + 0.5 * cos((w.y - w.x) * 13.0 + tt * 2.0)) * 0.03;',
    '      N = normalize(vec3(-rg.x, 1.0, -rg.y)); base = mix(base * 0.35, uWaterC, uWaterMurk); spec = 1.8; rough = 160.0; wet = 0.0;',
    '      emit += uWaterE * (0.6 + 0.4 * sin(w.x * 3.0 + w.y * 2.0 + tt * 0.8));',
    '    } else if (!ceil){',
    '      float line = smoothstep(0.03, 0.0, abs(y - 0.13 - (n - 0.5) * 0.03));',
    '      float below = smoothstep(0.15, 0.1, y); base = mix(base, uWaterC * 0.6, max(line * 0.8, below * 0.6));',
    '      base *= mix(1.0, 0.6, smoothstep(0.45, 0.1, y));',
    '      float cs = pow(0.5 + 0.5 * sin(vPos.x * 9.0 + vPos.z * 7.0 + sin(y * 14.0 + uTime * 1.8) * 1.6 + uTime * 1.2), 8.0);',
    '      emit += (uWaterC * 0.5 + uWaterE * 3.0) * cs * smoothstep(0.7, 0.15, y) * 0.3;',
    '    }',
    '  }',
    '  if (uTerr == 2){ float hot = smoothstep(0.42, 0.68, n2 + 0.2);',              // terrain (the game): embers
    '    base = mix(base, vec3(0.05, 0.02, 0.01), 0.7); emit += vec3(1.0, 0.33, 0.07) * (0.25 + 1.8 * crev * hot) * (0.75 + 0.25 * sin(uTime * 2.0 + n * 10.0)); }',
    '  else if (uTerr == 3){ vec2 q = fract(vPos.xz + 0.5) - 0.5; float r = length(q);',      // holy ground
    '    float ring = smoothstep(0.02, 0.0, abs(r - 0.33)) + smoothstep(0.014, 0.0, abs(r - 0.27));',
    '    float star = smoothstep(0.02, 0.0, abs(max(abs(q.x) * 0.87 + q.y * 0.5, -q.y) - 0.13));',
    '    emit += vec3(1.0, 0.8, 0.42) * (ring + star) * 1.3 * (0.8 + 0.2 * sin(uTime * 1.5)); emit += vec3(0.4, 0.3, 0.12) * smoothstep(0.5, 0.0, r) * 0.25; }',
    '  else if (uTerr == 4){ base = vec3(lumc(base)) * 0.75; emit += vec3(0.32, 0.14, 0.6) * smoothstep(0.28, 0.06, hgt) * 0.7; }',   // dead magic
    '  else if (uTerr == 5){ base = mix(base, vec3(0.72, 0.84, 0.95), 0.75); spec = 1.6; rough = 140.0; }',                        // ice
    '  else if (uTerr == 6){ base = mix(base, vec3(0.07, 0.09, 0.04), 0.6); spec += 0.5; }',                                         // rotten, sodden boards
    '  if (uSurf == 3 && uRunes > 0.0) emit += (dot(uEmitC, vec3(1.0)) > 0.01 ? uEmitC : uLampC) * smoothstep(0.35, 0.15, hgt) * uRunes * (0.75 + 0.25 * sin(uTime * 2.0));',
    '  base = max(base, vec3(0.0)); emit = max(emit, vec3(0.0));',
    '  base *= mix(1.0, 0.6, wet); spec += wet * 0.8; rough = mix(rough, 60.0, wet);',
    // ---- light ----
    '  vec3 V = normalize(eye - vPos);',
    '  vec3 L = torch - vPos; float d = length(L); L /= d;',
    '  float att = torchI / (1.0 + 0.6 * d + 2.2 * d * d);',
    '  float nl = max(dot(N, L), 0.0);',
    '  vec3 Hh = normalize(L + V); float sp = pow(max(dot(N, Hh), 0.0), rough) * spec * nl;',
    '  vec3 Ng = normalize(vNrm); float shT = shadowT(vPos, Ng);',
    '  vec3 diff = uTorchC * nl * att * shT, specl = uTorchC * sp * att * shT;',
    '  for (int i = 0; i < 6; i++){ if (i >= nlamps) break;',
    '    vec3 Lw = lamps[i].xyz - vPos; float dw = length(Lw); Lw /= dw; float aw = lamps[i].w / (1.0 + 1.2 * dw + 3.0 * dw * dw) * shadowL(i, vPos, Ng);',
    '    float nw = max(dot(N, Lw), 0.0); diff += uLampC * nw * aw;',
    '    specl += uLampC * pow(max(dot(N, normalize(Lw + V)), 0.0), rough) * spec * nw * aw; }',
    // the zone's own light: lava glow from below, a cold or violet fill from the stone itself
    '  float gy = mix(y, 1.0 - y, uGlowUp);',
    '  vec3 glow = uGlowC * (smoothstep(0.9, 0.0, gy) * (0.5 + 0.5 * n)) * (uGlowUp > 0.5 ? (ceil ? 0.3 : 1.0) : (flo ? 0.6 : 1.0)) * (0.85 + 0.15 * sin(uTime * 1.1 + n * 6.0));',
    '  vec3 c = base * (uAmbC + diff + glow) + specl + emit;',
    '  return c; }'
  ].join('\n');

  /* Shadows from point lights: a cube map per light holding the distance to the
     nearest surface, packed into RGBA8 so it works on every WebGL 2 device. */
  var SHADOW = [
    'uniform samplerCube uShT, uSh0, uSh1; uniform vec3 uShTP, uShP0, uShP1; uniform float uShOn, uShFar, uShL0, uShL1;',
    'float unpack4(vec4 v){ return dot(v, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }',
    'float shCube(samplerCube s, vec3 lp, vec3 p, vec3 n){',
    '  vec3 q = p + n * 0.012 - lp; float d = length(q) / uShFar - 0.0025;',
    '  vec3 a = q / length(q); vec3 t1 = normalize(cross(a, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(a, t1);',
    '  float r = 0.006 + 0.02 * d, k = 0.0;',
    '  k += step(d, unpack4(texture(s, a + (t1 + t2) * r))); k += step(d, unpack4(texture(s, a + (t1 - t2) * r)));',
    '  k += step(d, unpack4(texture(s, a - (t1 - t2) * r))); k += step(d, unpack4(texture(s, a - (t1 + t2) * r)));',
    '  return k * 0.25; }',
    'float shadowT(vec3 p, vec3 n){ return uShOn > 0.5 ? shCube(uShT, uShTP, p, n) : 1.0; }',
    'float shadowL(int i, vec3 p, vec3 n){ if (uShOn < 0.5) return 1.0;',
    '  if (i == 0 && uShL0 > 0.5) return shCube(uSh0, uShP0, p, n); if (i == 1 && uShL1 > 0.5) return shCube(uSh1, uShP1, p, n); return 1.0; }'
  ].join('\n');
  var NO_SHADOW = 'float shadowT(vec3 p, vec3 n){ return 1.0; }\nfloat shadowL(int i, vec3 p, vec3 n){ return 1.0; }';
  var SHADOW_FS = '#version 300 es\nprecision highp float;\nin vec3 vPos; in vec2 vUv; out vec4 o; uniform vec3 uLight; uniform float uFar, uAlpha; uniform sampler2D uTex;\n' +
    'vec4 pack4(float f){ vec4 e = fract(clamp(f, 0.0, 0.9999) * vec4(1.0, 255.0, 65025.0, 16581375.0)); e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0); return e; }\n' +
    'void main(){ if (uAlpha > 0.0 && texture(uTex, vUv).a < uAlpha) discard; o = pack4(length(vPos - uLight) / uFar); }';

  function hex(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

  /* ---------------- baking ---------------- */
  function Baker(gl, atlasImg, atlasIndex) {
    this.gl = gl; this.cache = {}; this.atlasImg = atlasImg; this.atlasIndex = atlasIndex || {};
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    var p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, BAKE_VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, BAKE_FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.U = {}; var self = this;
    ['uPat', 'uA', 'uB', 'uM', 'uSeed', 'uP'].forEach(function (n) { self.U[n] = gl.getUniformLocation(p, n); });
    this.fb = gl.createFramebuffer(); this.vao = gl.createVertexArray();
  }
  Baker.prototype.finish = function (t) {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    var ext = gl.getExtension('EXT_texture_filter_anisotropic'); if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return t;
  };
  /* key: a MATS name, or 'photo:<atlas name>'. colours: [a, b, mortar]. */
  Baker.prototype.get = function (key, colours, seed) {
    seed = seed || 1;
    var id = key + '|' + colours.join(',') + '|' + seed;
    if (this.cache[id]) return this.cache[id];
    var gl = this.gl, m, t = gl.createTexture(), size = 512;
    if (key.indexOf('photo:') === 0) {
      var name = key.slice(6), r = this.atlasIndex[name], c = document.createElement('canvas'); c.width = c.height = 256;
      var g = c.getContext('2d');
      if (r && this.atlasImg) g.drawImage(this.atlasImg, r[0], r[1], r[2], r[3], 0, 0, 256, 256); else { g.fillStyle = '#777'; g.fillRect(0, 0, 256, 256); }
      var px = g.getImageData(0, 0, 256, 256), d = px.data;
      for (var i = 0; i < d.length; i += 4) d[i + 3] = Math.round(Math.min(255, (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 1.4));
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // bottom row first, like the baked ones
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(d.buffer));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      m = { name: 'Photo: ' + name, period: /^door|^metal/.test(name) ? 1 : 1, spec: 0.2, photo: true };
    } else {
      m = MATS[key]; if (!m) throw new Error('no material ' + key);
      var cols = m.cols || (m.wood ? WOOD : m.metal ? IRON : colours);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.viewport(0, 0, size, size); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(this.prog);
      gl.uniform1i(this.U.uPat, m.pat); gl.uniform4fv(this.U.uP, m.p); gl.uniform1f(this.U.uSeed, seed);
      // the bake writes linear-ish colour that the corridor shader treats as sRGB
      gl.uniform3fv(this.U.uA, hex(cols[0])); gl.uniform3fv(this.U.uB, hex(cols[1])); gl.uniform3fv(this.U.uM, hex(cols[2]));
      gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return (this.cache[id] = { tex: this.finish(t), period: m.period, spec: m.spec, photo: !!m.photo, name: m.name, runes: !!m.runes, bars: !!m.bars });
  };
  Baker.prototype.clear = function () { var gl = this.gl; Object.keys(this.cache).forEach(function (k) { gl.deleteTexture(this.cache[k].tex); }, this); this.cache = {}; };

  root.MSDDMat = { SHADOW: SHADOW, NO_SHADOW: NO_SHADOW, SHADOW_FS: SHADOW_FS, MATS: MATS, ZONES: ZONES, WATERS: WATERS, PHOTOS: PHOTOS, COVER: COVER, Baker: Baker, hex: hex };
})(typeof window !== 'undefined' ? window : this);
