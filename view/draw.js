// Hold the Line: view/draw.js. Drawing the board each frame: the mat, the floor and its marks, shadows, pillars and minis in depth order, and the
// effects on top.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

/* ---------- drawing ---------- */
function draw(now) {
  drawCount++;
  const c = L.cell;
  V.now = now;
  prof.mark('wait'); // anything the browser was still doing from before: the last frame, say
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  ctx.drawImage(img(boardCache), 0, 0, L.W, L.H);
  prof.mark('mat');
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
  prof.mark('floor');
  drawRoutes(now);
  prof.mark('routes');
  drawTavernHits(now);
  drawPlacement();
  drawBadSquares(now);
  prof.mark('marks');

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
  drawMotes(now);
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
    const ring = (col, r, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, c * 0.03); ctx.beginPath();
      const rx = c * st.sp.rx * r, ry = rx * 0.38, cy = st.gy + c * 0.02;
      if (!dash.length) ctx.ellipse(st.gx, cy, rx, ry, 0, 0, TAU);
      else { // dashes by hand, as for the routes
        const n = Math.max(4, Math.round(Math.PI * (rx + ry) / (dash[0] + dash[1]))), on = TAU / n * dash[0] / (dash[0] + dash[1]);
        for (let k = 0; k < n; k++) { const a0 = k * TAU / n; ctx.moveTo(st.gx + rx * Math.cos(a0), cy + ry * Math.sin(a0)); ctx.ellipse(st.gx, cy, rx, ry, 0, a0, a0 + on); }
      }
      ctx.stroke();
    };
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
  ctx.drawImage(img(level > 0 ? shaded(pp ? key + '|' + st.pose : key, s, level) : s.cv), -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k);
  if (st.sp.stone) ctx.filter = 'none';
  if (st.flash > 0) { ctx.globalAlpha = st.alpha * st.flash * 0.8; ctx.drawImage(img(pp ? pp.white : sprW(bear ? '__bear' : st.sp.type)), -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k); }
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
  ctx.drawImage(img(s.cv), -s.ax * k, -s.ay * k, s.cv.width * k, s.cv.height * k); ctx.restore(); ctx.globalAlpha = 1;
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
// A dashed line drawn by hand, as short strokes in one path. Safari's own dashes are very slow (it turns every dash
// into a shape of its own), and the routes' dashes move every frame. offset works like lineDashOffset.
function strokeDashed(pts, on, off, offset) {
  if (pts.length < 2) return;
  const period = on + off, seg = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); total += l; }
  let i = 0, base = 0; // walks forward along the path as the dashes do
  const at = d => {
    while (i < seg.length - 1 && d > base + seg[i]) { base += seg[i]; i++; }
    const t = seg[i] ? Math.min(1, Math.max(0, (d - base) / seg[i])) : 0, a = pts[i], b = pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  ctx.beginPath();
  for (let st = -(((offset % period) + period) % period); st < total; st += period) {
    const a = Math.max(0, st), b = Math.min(total, st + on); if (b <= a) continue;
    const p = at(a), q = at(b); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
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
  const stroke = (pts, col, dash) => { ctx.strokeStyle = col; strokeDashed(pts, dash[0], dash[1], -now * c * 0.5); };
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
    ctx.lineWidth = Math.max(2, c * 0.045);
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
