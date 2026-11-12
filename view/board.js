// Hold the Line: view/board.js. The board's pieces: the mat (the table, the floor, the threshold, the tavern wall), the pillars, and the minis as
// sprites, from the shared library through TableMinis, with their poses.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

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
  // the board's rounded corners, baked in here: the page used to clip the live canvas to them every frame
  g.save(); g.globalAlpha = 1; g.fillStyle = '#000'; g.globalCompositeOperation = 'destination-in'; g.beginPath(); // opaque, or it fades the board
  if (g.roundRect) g.roundRect(0, 0, W, H, 8); else g.rect(0, 0, W, H);
  g.fill(); g.restore();
}
const DARK_STOPS = [[0, 0], [0.16, 0.06], [0.45, 0.42], [1, 0.6]]; // shade by how far across the mat from the tavern
function isDark() { return !!(SET.torch && S && HTL.battle(S).dark); }

/* ---------- pillars: unpainted resin columns, drawn in among the minis so they hide what stands behind them ---------- */
let PILLAR = null;
// Safari is slow to draw one canvas onto another, and the board does that dozens of times a frame (the mat, every mini,
// every pillar). An ImageBitmap of each is the fast path: made once in the background the first time it's drawn, and
// drawn instead from then on; until it's ready, the canvas itself is. Frame timings' I key switches it off, to compare.
const BM = new WeakMap();
let useBitmaps = typeof createImageBitmap === 'function';
function img(cv) {
  if (!useBitmaps || !cv) return cv;
  const b = BM.get(cv);
  if (b && typeof b === 'object') return b;
  if (!b) { BM.set(cv, 1); createImageBitmap(cv).then(x => BM.set(cv, x), () => BM.set(cv, 2)); } // 2: no bitmap, keep the canvas
  return cv;
}
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
  ctx.drawImage(img(s.cv), st.gx - s.ax * k, st.gy - s.ay * k, s.cv.width * k, s.cv.height * k);
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
