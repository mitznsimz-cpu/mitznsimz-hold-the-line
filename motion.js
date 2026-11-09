/* Mitz & Simz motion and effects v1.1.0: how the minis move and what flies between them.
   Shared by Hold the Line and Dungeon Delve. Owned by Hold the Line; the Delve maps its rank slots onto the same calls.
   No DOM. A game creates one with a host that says where things are on its screen:
     const fx = MitzMotion.create({
       ctx: () => context, layout: () => ({ cell, horiz, dpr }), state: () => view,  // view holds fx, pops, coins, impacts arrays
       motion: 1,                     // 0.35 or so for reduced motion; or a function, read every frame
       font: 'Barlow Semi Condensed, sans-serif',
       toScreen: (lane, sq) => ({ x, y }),   // the ground point under a mini standing at that place
       laneVec: sign => ({ x, y, lean }),    // which way is forward on screen
       dice: () => true,                      // show d20 badges on hits
       mat: () => ({ x, y, w, h }),           // optional: the play area, which blast scorch stays inside
       purse: () => ({ x, y }), onCoin: () => {} });
   A mini's anims: { k, t0, dur, ... } with k one of drop, land, hop, leap, charge, emerge, rise, leak, lunge, recoil, cast,
   wobble, shake, dodge, flash, topple, fade, pickup; since 1.1: strike (a lunge with a wind-up; the blow lands at
   MitzMotion.STRIKE_CONTACT of its duration), knock (pushed back along vx, vy by amt squares), and the deaths drift
   (spirits rise), crumble (constructs shake apart), melt (oozes slump) and swat (knocked off the table along vx, vy).
   fx.evaluate(sprite, now) gives where and how to draw it this frame. fx.hold(sprite, at, dur) is hit-stop: every anim
   that began before `at` stands still for `dur`, so a blow can freeze attacker and target for a beat.
   Effects pushed to view.fx: arrow, bolt, shadow, fireball, boom, smash, slash, radiant, whirl, sigil, beam, sparkle, notes;
   since 1.1: tumble (a d20 rolled across the mat: from, to, face, side), bits (particles off a struck mini by material:
   lane, sq, ht, mat, ang, seed; MitzMotion.MATERIALS lists them and how long each lasts) and paw (a cat's paw reaching
   in from the edge along ex, ey to lane, sq, then dragging back: fur, rim).
   Pops pushed to view.pops: atk (a d20 badge and damage), save, heal, label. Coins pushed to view.coins fly to the purse.
   Impacts pushed to view.impacts ({ at, fn }) run in time order: effects land on the beat of the hit. */
var MitzMotion = (function () {
  'use strict';
  const VERSION = '1.1.0';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);
  const easeIn = t => t * t;
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const STRIKE_CONTACT = 0.5; // a strike lands halfway through: wind-up before, follow-through after
  // what flies off a struck mini, by what it is made of; life is the effect's duration in seconds
  const MATERIALS = {
    metal:  { life: 0.35, n: 7, speed: 2.4, grav: 2.0, spread: 1.4, kind: 'spark', col: '255,226,150' },
    bone:   { life: 0.6, n: 6, speed: 1.4, grav: 4.5, spread: 1.6, kind: 'chip', col: '236,230,214' },
    stone:  { life: 0.65, n: 6, speed: 1.2, grav: 4.5, spread: 1.7, kind: 'chip', col: '156,150,142', dust: '178,170,158' },
    ooze:   { life: 0.65, n: 6, speed: 1.1, grav: 3.8, spread: 1.5, kind: 'blob', col: '150,192,120' },
    flesh:  { life: 0.4, n: 5, speed: 1.0, grav: 2.5, spread: 1.8, kind: 'puff', col: '236,228,214' },
    ember:  { life: 0.85, n: 8, speed: 0.9, grav: -1.4, spread: 2.2, kind: 'ember', col: '255,168,64' },
    spirit: { life: 0.85, n: 6, speed: 0.6, grav: -1.0, spread: 2.4, kind: 'wisp', col: '214,224,240' },
    wood:   { life: 0.55, n: 6, speed: 1.5, grav: 4.5, spread: 1.6, kind: 'splinter', col: '176,134,92' }
  };

  function create(host) {
    let ctx = null, L = null, V = null;
    const bind = () => { ctx = host.ctx(); L = host.layout(); V = host.state(); };
    const motionLevel = () => (typeof host.motion === 'function' ? host.motion() : (host.motion == null ? 1 : host.motion));
    const UIF = host.font || 'sans-serif';
    const gpos = (lane, sq) => host.toScreen(lane, sq);
    const laneVec = sign => (host.laneVec ? host.laneVec(sign) : { x: sign, y: 0, lean: sign });

    /* ---------- tweens ---------- */
    function evaluate(sp, now) {
      let sq = sp.sq, lane = sp.lane, dx = 0, dy = 0, lift = 0, rot = 0, alpha = 1, pivot = 0, flash = 0, scale = 1, moved = false;
      const keep = [], MOTION = motionLevel(), holds = sp.holds;
      if (holds) { sp.holds = holds.filter(h => now < h.at + h.dur + 3); if (!sp.holds.length) delete sp.holds; }
      for (const a of sp.anims) {
        let tn = now;
        if (holds) for (const h of holds) if (a.t0 < h.at && now > h.at) tn -= Math.min(now - h.at, h.dur); // hit-stop
        let p = (tn - a.t0) / a.dur;
        if (p < 0) {
          keep.push(a);
          if (a.hide) alpha = 0;                                   // not on the mat yet
          if ((a.k === 'hop' || a.k === 'leap') && !moved) { sq = a.from; if (a.fromLane != null) lane = a.fromLane; moved = true; } // queued hop: wait where it starts
          continue;
        }
        if (p >= 1) { if (!a.persist) continue; p = 1; }
        keep.push(a);
        switch (a.k) {
          case 'drop': lift += (1 - easeIn(p)) * 1.3 * MOTION; alpha *= clamp(p * 4, 0, 1); break;
          case 'land': lift += Math.sin(p * Math.PI) * 0.07 * MOTION * (1 - p); break;
          case 'hop': if (!moved) { const e = easeInOut(p); sq = lerp(a.from, a.to, e); if (a.fromLane != null) lane = lerp(a.fromLane, a.toLane, e); moved = true; } lift += Math.sin(Math.PI * p) * 0.24 * MOTION; rot += Math.sin(Math.PI * p) * 0.1 * a.lean * MOTION; break;
          case 'leap': if (!moved) { const e = easeInOut(p); sq = lerp(a.from, a.to, e); if (a.fromLane != null) lane = lerp(a.fromLane, a.toLane, e); moved = true; } lift += Math.sin(Math.PI * p) * 1.0 * MOTION; rot += Math.sin(Math.PI * 2 * p) * 0.18 * a.lean * MOTION; break;
          case 'charge': if (!moved) { sq = lerp(a.from, a.to, easeIn(p)); moved = true; } lift += Math.abs(Math.sin(Math.PI * 3 * p)) * 0.12 * MOTION; rot += a.lean * 0.22 * MOTION; break;
          case 'emerge': { const e = easeOut(p); lane = lerp(a.fromLane, sp.lane, e); sq = lerp(a.fromSq, sp.sq, e); lift += Math.sin(Math.PI * p) * 0.35 * MOTION; scale *= 0.55 + 0.45 * e; break; }
          case 'rise': alpha *= clamp(p * 1.8, 0, 1); scale *= 0.6 + 0.4 * easeOutBack(p); break;
          case 'leak': sq = lerp(a.from, -1.05, easeIn(p)); lift += Math.sin(Math.PI * p) * 0.25 * MOTION; alpha *= 1 - clamp((p - 0.55) / 0.45, 0, 1); break;
          case 'lunge': {
            const q = p < 0.35 ? easeOut(p / 0.35) : 1 - easeInOut((p - 0.35) / 0.65);
            dx += a.vx * q * 0.24 * MOTION; dy += a.vy * q * 0.24 * MOTION; rot += a.lean * q * 0.2 * MOTION; lift += q * 0.05 * MOTION; break;
          }
          case 'strike': { // lean back, drive in to land the blow at STRIKE_CONTACT, settle back
            const q = p < 0.3 ? -0.38 * easeOut(p / 0.3) : p < STRIKE_CONTACT ? lerp(-0.38, 1, easeIn((p - 0.3) / (STRIKE_CONTACT - 0.3))) : 1 - easeInOut((p - STRIKE_CONTACT) / (1 - STRIKE_CONTACT));
            dx += a.vx * q * 0.26 * MOTION; dy += a.vy * q * 0.26 * MOTION; rot += a.lean * q * 0.24 * MOTION; lift += Math.max(0, q) * 0.05 * MOTION; break;
          }
          case 'knock': { // driven back by a blow, further for a heavier one
            const q = p < 0.16 ? easeOut(p / 0.16) : 1 - easeInOut((p - 0.16) / 0.84), amt = a.amt == null ? 0.1 : a.amt;
            dx += a.vx * q * amt * MOTION; dy += a.vy * q * amt * MOTION; rot += (a.lean || 0) * q * amt * 1.6 * MOTION; break;
          }
          case 'drift': lift += easeIn(p) * 0.9 * Math.max(MOTION, 0.4); rot += Math.sin(p * Math.PI * 2) * 0.08 * MOTION; alpha *= 1 - easeIn(p); scale *= 1 + p * 0.12; break;
          case 'crumble': rot += Math.sin(p * 61) * 0.035 * (1 - p) * MOTION; dy += easeIn(p) * 0.08; alpha *= 1 - clamp((p - 0.3) / 0.7, 0, 1); scale *= 1 - easeIn(p) * 0.25; break;
          case 'melt': scale *= 1 - easeIn(p) * 0.6; dy += p * 0.03; alpha *= 1 - clamp((p - 0.45) / 0.55, 0, 1); break;
          case 'swat': { const e = easeIn(p), d = a.dist || 3; dx += a.vx * e * d; dy += a.vy * e * d; rot += (a.dir || 1) * p * 6 * MOTION; lift += Math.sin(Math.PI * p) * 0.15 * MOTION; alpha *= 1 - clamp((p - 0.75) / 0.25, 0, 1); break; }
          case 'recoil': { const q = Math.sin(Math.PI * p); dx -= a.vx * q * 0.06 * MOTION; dy -= a.vy * q * 0.06 * MOTION; rot -= a.lean * q * 0.09 * MOTION; break; }
          case 'cast': lift += Math.sin(Math.PI * p) * 0.1 * MOTION; break;
          case 'wobble': rot += Math.sin(p * Math.PI * 3) * 0.14 * (1 - p) * MOTION; lift += Math.abs(Math.sin(p * Math.PI * 3)) * 0.04 * MOTION; break;
          case 'shake': dx += Math.sin(p * 38) * 0.045 * (1 - p) * Math.max(MOTION, 0.5); break;
          case 'dodge': rot += a.dir * Math.sin(Math.PI * p) * 0.22 * MOTION; break;
          case 'flash': flash = Math.max(flash, 1 - p); break;
          case 'topple': rot += a.dir * (Math.PI / 2) * Math.min(easeOutBack(p), 1.06); pivot = a.dir * sp.rx; break;
          case 'fade': alpha *= 1 - p; break;
          case 'pickup': lift += easeIn(p) * 1.5 * MOTION; rot += Math.sin(Math.PI * p) * 0.12 * MOTION; alpha *= 1 - clamp((p - 0.45) / 0.55, 0, 1); break;
        }
      }
      sp.anims = keep;
      return { lane, sq, dx, dy, lift, rot, alpha, pivot, flash, scale };
    }

    function hold(sp, at, dur) { if (sp && dur > 0) (sp.holds || (sp.holds = [])).push({ at, dur }); }

    /* ---------- impacts, in time order ---------- */
    function runImpacts(now) {
      bind();
      if (!V.impacts.length) return;
      V.impacts.sort((a, b) => a.at - b.at);
      while (V.impacts.length && V.impacts[0].at <= now) V.impacts.shift().fn();
    }

    /* ---------- effects, pops and coins ---------- */
    const FX = {
      arrow(f, p) { projectile(f, p, 0.16, (x, y, ang) => {
        const c = L.cell, len = c * 0.34;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = '#d8c7a0'; ctx.lineWidth = Math.max(1.4, c * 0.025); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = '#9c9a94'; ctx.beginPath(); ctx.moveTo(c * 0.06, 0); ctx.lineTo(-c * 0.01, -c * 0.03); ctx.lineTo(-c * 0.01, c * 0.03); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c9353e'; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(-len - c * 0.05, -c * 0.035); ctx.lineTo(-len + c * 0.07, 0); ctx.lineTo(-len - c * 0.05, c * 0.035); ctx.closePath(); ctx.fill();
        ctx.restore();
      }); },
      bolt(f, p) { projectile(f, p, 0.1, (x, y) => orb(x, y, L.cell * 0.09, 1)); trail(f, p, 0.1, 0.09); },
      shadow(f, p) { projectile(f, p, 0.12, (x, y) => orb(x, y, L.cell * 0.1, 1, true)); trail(f, p, 0.12, 0.1, true); },
      sigil(f, p) { // a summoning circle opening on the mat
        const g = gpos(f.lane, f.sq), c = L.cell, a = Math.sin(Math.PI * p), r = c * (0.18 + 0.22 * easeOut(p));
        ctx.save(); ctx.translate(g.x, g.y + c * 0.03); ctx.scale(1, 0.4);
        ctx.strokeStyle = 'rgba(150,95,200,' + (0.9 * a).toFixed(3) + ')'; ctx.lineWidth = Math.max(1.5, c * 0.03);
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
        ctx.rotate(p * 2);
        for (let i = 0; i < 6; i++) { const t = i / 6 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(t) * r * 0.55, Math.sin(t) * r * 0.55); ctx.lineTo(Math.cos(t + 2.1) * r * 0.55, Math.sin(t + 2.1) * r * 0.55); ctx.stroke(); }
        ctx.restore();
      },
      beam(f, p) { // a Fallen Priest's mending: a thin ribbon from priest to patient
        const a = chest(f.from.lane, f.from.sq, f.from.ht), b = chest(f.to.lane, f.to.sq, f.to.ht), al = Math.sin(Math.PI * p);
        ctx.strokeStyle = 'rgba(' + (f.col || '154,214,140') + ',' + (0.75 * al).toFixed(3) + ')'; ctx.lineWidth = Math.max(1.5, L.cell * 0.03); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - L.cell * 0.4, b.x, b.y); ctx.stroke();
      },
      fireball(f, p) { projectile(f, p, 0.55, (x, y) => orb(x, y, L.cell * 0.15, 1)); trail(f, p, 0.55, 0.15); },
      radiant(f, p) { // Sacred Flame: a falling column of light, brightest as it lands
        const g = gpos(f.lane, f.sq), c = L.cell, a = Math.sin(Math.PI * p);
        const top = g.y - c * ((f.ht || 0.9) + 1.1) * Math.min(1, p * 2.2), w = c * 0.26 * (1 - p * 0.35);
        const gr = ctx.createLinearGradient(0, top, 0, g.y);
        gr.addColorStop(0, 'rgba(255,250,225,0)'); gr.addColorStop(0.55, 'rgba(255,242,190,' + (0.85 * a).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(255,226,150,' + (0.6 * a).toFixed(3) + ')');
        ctx.fillStyle = gr; ctx.fillRect(g.x - w / 2, top, w, g.y - top);
        ctx.fillStyle = 'rgba(255,236,170,' + (0.45 * a).toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(g.x, g.y + c * 0.03, c * 0.36, c * 0.13, 0, 0, TAU); ctx.fill();
      },
      whirl(f, p) { // the Barbarian's sweep: one great arc round the square it lands on
        const g = gpos(f.lane, f.sq), c = L.cell, a = 1 - p;
        ctx.save(); ctx.translate(g.x, g.y - c * 0.35); ctx.scale(1, 0.55);
        ctx.strokeStyle = 'rgba(255,240,215,' + (0.85 * a).toFixed(3) + ')'; ctx.lineWidth = c * 0.09 * a + 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, c * (0.9 + 0.35 * p), -Math.PI * 0.2 + p * TAU * 0.9, Math.PI * 1.1 + p * TAU * 0.9); ctx.stroke();
        ctx.restore();
      },
      slash(f, p) {
        if (!f.hit) return;
        const g = gpos(f.lane, f.sq), c = L.cell, y = g.y - c * f.ht * 0.5;
        const base = f.ang; // the side the blow comes from
        ctx.strokeStyle = 'rgba(255,248,230,' + (1 - p) + ')'; ctx.lineWidth = c * 0.06 * (1 - p) + 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(g.x, y, c * 0.3, base - 0.9 + p * 0.6, base + 0.5 + p * 0.6); ctx.stroke();
      },
      smash(f, p) {
        const g = gpos(f.lane, f.sq), c = L.cell;
        ctx.strokeStyle = 'rgba(240,225,200,' + (0.8 * (1 - p)) + ')'; ctx.lineWidth = c * 0.05 * (1 - p) + 1;
        ctx.beginPath(); ctx.ellipse(g.x, g.y + c * 0.04, c * (f.rx * 0.8 + p * 0.45), c * (f.rx * 0.3 + p * 0.16), 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(200,190,170,' + (0.5 * (1 - p)) + ')';
        for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.arc(g.x + Math.cos(a) * c * (0.2 + p * 0.4), g.y + Math.sin(a) * c * (0.07 + p * 0.14) - p * c * 0.1, c * 0.035, 0, TAU); ctx.fill(); }
      },
      boom(f, p) {
        const g = gpos(f.lane, f.sq), c = L.cell, r = c * (0.3 + easeOut(p) * 1.35), a = Math.pow(1 - p, 1.4);
        ctx.fillStyle = 'rgba(255,170,60,' + (0.16 * a) + ')';
        const x0 = Math.min(gpos(f.lane - 1, f.sq - 1).x, gpos(f.lane + 1, f.sq + 1).x) - c / 2;
        const y0 = Math.min(gpos(f.lane - 1, f.sq - 1).y, gpos(f.lane + 1, f.sq + 1).y) - c / 2;
        const m = host.mat ? host.mat() : null;
        ctx.save();
        if (m) { ctx.beginPath(); ctx.rect(m.x, m.y, m.w, m.h); ctx.clip(); } // the blast area stays on the play area
        ctx.fillRect(x0, y0, c * 3, c * 3);
        ctx.restore();
        const gr = ctx.createRadialGradient(g.x, g.y - c * 0.2, 0, g.x, g.y - c * 0.2, r);
        gr.addColorStop(0, 'rgba(255,250,220,' + a + ')'); gr.addColorStop(0.35, 'rgba(255,190,70,' + (0.9 * a) + ')');
        gr.addColorStop(0.7, 'rgba(214,80,30,' + (0.6 * a) + ')'); gr.addColorStop(1, 'rgba(120,30,10,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(g.x, g.y - c * 0.2, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,90,' + a + ')';
        for (let i = 0; i < 12; i++) { const ang = i / 12 * TAU + 0.3; ctx.beginPath(); ctx.arc(g.x + Math.cos(ang) * r * 0.95, g.y - c * 0.2 + Math.sin(ang) * r * 0.75 - p * c * 0.3, c * 0.03 * (1 - p) + 0.5, 0, TAU); ctx.fill(); }
      },
      notes(f, p) {
        const g = gpos(f.lane, f.sq), c = L.cell;
        for (let i = 0; i < 3; i++) {
          const q = clamp(p * 1.25 - i * 0.12, 0, 1); if (q <= 0 || q >= 1) continue;
          const x = g.x + c * (0.12 + Math.sin(f.seed + i * 2.1 + q * 4) * 0.12) * (i % 2 ? -1 : 1);
          const y = g.y - c * (0.75 + q * 0.6);
          ctx.globalAlpha = Math.sin(q * Math.PI); note(x, y, c * 0.085);
        }
        ctx.globalAlpha = 1;
      },
      tumble(f, p) { // a d20 thrown across the mat: three bounces, spinning, then it settles on its face
        const c = L.cell, a = gpos(f.from.lane, f.from.sq), b = gpos(f.to.lane, f.to.sq), tr = easeOut(Math.min(1, p / 0.72));
        const x = lerp(a.x, b.x, tr), gy = lerp(a.y, b.y, tr), r = c * 0.2, settled = p >= 0.72;
        const hop = settled ? 0 : Math.abs(Math.sin(tr * Math.PI * 3)) * (1 - tr) * c * 0.6, spin = (1 - tr) * (1 - tr) * 13;
        const fade = p > 0.86 ? 1 - (p - 0.86) / 0.14 : 1;
        ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, gy + r * 0.55, r * (1 - Math.min(0.5, hop / c)), r * 0.35, 0, 0, TAU); ctx.fill();
        const hero = f.side === 'hero', fill = f.gold ? '#f0cd6e' : hero ? '#d4a537' : '#a3202a';
        const stroke = f.gold ? '#a3202a' : hero ? '#6b4e12' : '#4a0c10', tc = f.gold || hero ? '#2a1a10' : '#fff3e0';
        if (settled && f.gold) { ctx.fillStyle = 'rgba(240,205,110,' + (0.4 * fade).toFixed(3) + ')'; ctx.save(); ctx.translate(x, gy - r * 0.4); ctx.rotate(p * 3); star(0, 0, r * 2.1); ctx.restore(); }
        ctx.save(); ctx.translate(x, gy - r * 0.4 - hop); ctx.rotate(settled ? 0 : spin);
        d20(0, 0, r, fill, stroke, settled ? String(f.face) : String(1 + Math.floor(spin * 4.7) % 20), tc);
        ctx.restore(); ctx.globalAlpha = 1;
      },
      bits(f, p) { // what flies off a struck mini: sparks, chips, dust, splats, embers, wisps, splinters
        const m = MATERIALS[f.mat] || MATERIALS.flesh, g = gpos(f.lane, f.sq), c = L.cell, t = p * m.life, a = 1 - p;
        const x0 = g.x, y0 = g.y - c * (f.ht || 0.8) * 0.55, away = f.ang == null ? -Math.PI / 2 : f.ang + Math.PI;
        let seed = ((f.seed || 1) * 7919) % 233280; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
        if (m.dust) { ctx.fillStyle = 'rgba(' + m.dust + ',' + (0.35 * a).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(g.x, g.y, c * (0.2 + 0.4 * p), c * (0.07 + 0.14 * p), 0, 0, TAU); ctx.fill(); }
        const n = Math.max(2, Math.round(m.n * (f.scale || 1)));
        for (let i = 0; i < n; i++) {
          const ang = away + (rnd() - 0.5) * m.spread, sp = m.speed * (0.55 + 0.7 * rnd()), up = 0.6 + rnd() * 0.6, r0 = rnd();
          const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp * 0.7 - up * (m.grav > 0 ? 1 : 0.3);
          const x = x0 + vx * t * c, y = y0 + (vy * t + 0.5 * m.grav * t * t) * c;
          switch (m.kind) {
            case 'spark': { const k = c * 0.075, vyn = vy + m.grav * t; ctx.strokeStyle = 'rgba(' + m.col + ',' + a.toFixed(3) + ')'; ctx.lineWidth = Math.max(1, c * 0.016); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vx * k, y - vyn * k); ctx.stroke(); break; }
            case 'chip': { const z = c * (0.03 + r0 * 0.025); ctx.fillStyle = 'rgba(' + m.col + ',' + a.toFixed(3) + ')'; ctx.save(); ctx.translate(x, y); ctx.rotate(t * 14 * (r0 - 0.5)); ctx.beginPath(); ctx.moveTo(-z, -z * 0.6); ctx.lineTo(z, -z * 0.2); ctx.lineTo(-z * 0.2, z); ctx.closePath(); ctx.fill(); ctx.restore(); break; }
            case 'blob': ctx.fillStyle = 'rgba(' + m.col + ',' + (a * 0.9).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(x, y, c * (0.04 + r0 * 0.025), c * (0.034 + r0 * 0.025) * (1 + 0.4 * p), 0, 0, TAU); ctx.fill(); break;
            case 'puff': ctx.fillStyle = 'rgba(' + m.col + ',' + (a * 0.45).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x, y, c * (0.04 + p * 0.08), 0, TAU); ctx.fill(); break;
            case 'ember': ctx.fillStyle = 'rgba(' + m.col + ',' + (a * (0.6 + 0.4 * Math.sin(t * 40 + i))).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x + Math.sin(t * 9 + i) * c * 0.03, y, c * (0.02 + r0 * 0.014), 0, TAU); ctx.fill(); break;
            case 'wisp': ctx.fillStyle = 'rgba(' + m.col + ',' + (a * 0.5).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x + Math.sin(t * 6 + i) * c * 0.05, y, c * (0.034 + p * 0.035), 0, TAU); ctx.fill(); break;
            case 'splinter': { const l = c * (0.04 + r0 * 0.035), rr = t * 10 * (r0 - 0.5) + ang; ctx.strokeStyle = 'rgba(' + m.col + ',' + a.toFixed(3) + ')'; ctx.lineWidth = Math.max(1, c * 0.012); ctx.beginPath(); ctx.moveTo(x - Math.cos(rr) * l, y - Math.sin(rr) * l); ctx.lineTo(x + Math.cos(rr) * l, y + Math.sin(rr) * l); ctx.stroke(); break; }
          }
        }
      },
      paw(f, p) { // a cat reaches in from the table's edge along (ex, ey), hooks the fallen mini and drags it off
        const c = L.cell, g = gpos(f.lane, f.sq), ex = f.ex || 0, ey = f.ey == null ? -1 : f.ey, reach = (f.reach || 3) * c;
        const tx = g.x - ex * c * 0.12, ty = g.y - c * 0.1, ox = tx + ex * reach, oy = ty + ey * reach;
        const k = p < 0.4 ? easeOut(p / 0.4) : 1 - easeIn((p - 0.4) / 0.6);
        const px = lerp(ox, tx, k), py = lerp(oy, ty, k), ang = Math.atan2(-ey, -ex), fur = f.fur || '#161417', rim = f.rim || '#5a5560';
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
        // the leg, back to beyond the edge, then the paw with four toes leading
        ctx.lineCap = 'round'; ctx.strokeStyle = rim; ctx.lineWidth = c * 0.46; ctx.beginPath(); ctx.moveTo(-c * 0.1, 0); ctx.lineTo(-c * 4, 0); ctx.stroke();
        ctx.strokeStyle = fur; ctx.lineWidth = c * 0.42; ctx.beginPath(); ctx.moveTo(-c * 0.1, 0); ctx.lineTo(-c * 4, 0); ctx.stroke();
        ctx.fillStyle = fur; ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1.5, c * 0.025);
        ctx.beginPath(); ctx.ellipse(0, 0, c * 0.2, c * 0.25, 0, 0, TAU); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 4; i++) { const yy = (i - 1.5) * c * 0.115, xx = c * 0.17 - Math.abs(i - 1.5) * c * 0.04; ctx.beginPath(); ctx.ellipse(xx, yy, c * 0.075, c * 0.062, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = Math.max(1, c * 0.015);
        ctx.beginPath(); ctx.arc(-c * 0.02, -c * 0.06, c * 0.12, -2.4, -1.2); ctx.stroke();
        ctx.restore();
      },
      sparkle(f, p) {
        const g = gpos(f.lane, f.sq), c = L.cell;
        ctx.fillStyle = 'rgba(' + (f.col || '240,205,110') + ',' + (1 - p).toFixed(3) + ')';
        for (let i = 0; i < 5; i++) { const x = g.x + (i - 2) * c * 0.1, y = g.y - c * (0.3 + p * 0.6 + (i % 2) * 0.1); star(x, y, c * 0.04); }
      }
    };
    function chest(lane, sq, ht) { const g = gpos(lane, sq); return { x: g.x, y: g.y - L.cell * (ht || 0.8) * 0.55 }; }
    function projectile(f, p, arc, drawFn) {
      const a = chest(f.from.lane, f.from.sq, f.from.ht), b = chest(f.to.lane, f.to.sq, f.to.ht);
      if (f.miss) { const v = laneVec(f.sign || 1); b.x += (L.horiz ? 0 : f.miss * 0.32 * L.cell) + v.x * 0.25 * L.cell; b.y += (L.horiz ? f.miss * 0.32 * L.cell : 0) + v.y * 0.25 * L.cell; }
      const pt = q => ({ x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) - Math.sin(Math.PI * q) * arc * L.cell });
      const c0 = pt(p), c1 = pt(Math.min(1, p + 0.02));
      drawFn(c0.x, c0.y, Math.atan2(c1.y - c0.y, c1.x - c0.x));
    }
    function trail(f, p, arc, r, dark) {
      for (let i = 1; i <= 4; i++) {
        const q = p - i * 0.06; if (q < 0) break;
        projectile(f, q, arc, (x, y) => { ctx.globalAlpha = 0.5 * (1 - i / 5); orb(x, y, L.cell * r * (1 - i * 0.15), 0.6, dark); ctx.globalAlpha = 1; });
      }
    }
    function orb(x, y, r, a, dark) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      if (dark) { g.addColorStop(0, 'rgba(236,222,255,' + a + ')'); g.addColorStop(0.35, 'rgba(126,72,178,' + a + ')'); g.addColorStop(1, 'rgba(36,10,58,0)'); }
      else { g.addColorStop(0, 'rgba(255,248,215,' + a + ')'); g.addColorStop(0.35, 'rgba(255,180,60,' + a + ')'); g.addColorStop(1, 'rgba(220,70,20,0)'); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
    }
    function note(x, y, s) {
      ctx.fillStyle = '#f0cd6e'; ctx.strokeStyle = '#f0cd6e'; ctx.lineWidth = Math.max(1, s * 0.25);
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.55, s * 0.4, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.5, y - s * 1.6); ctx.quadraticCurveTo(x + s * 1.2, y - s * 1.1, x + s * 1.1, y - s * 0.7); ctx.stroke();
    }
    function star(x, y, r) {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = i % 2 ? r * 0.4 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
    }
    function drawFx(now) {
      const keep = [];
      for (const f of V.fx) {
        const p = (now - f.t0) / f.dur;
        if (p < 0) { keep.push(f); continue; }
        if (p >= 1) continue;
        keep.push(f); FX[f.k](f, p);
      }
      V.fx = keep;
    }

    function d20(x, y, r, fill, stroke, text, textCol) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * TAU / 6; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = Math.max(1.2, r * 0.12); ctx.strokeStyle = stroke; ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; ctx.lineTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62); }
      ctx.closePath(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke();
      ctx.fillStyle = textCol; ctx.font = '700 ' + Math.round(r * 1.05) + 'px ' + UIF; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + r * 0.06);
    }
    function outlinedText(txt, x, y, size, fill, align) {
      ctx.font = '700 ' + Math.round(size) + 'px ' + UIF; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, size * 0.2); ctx.strokeStyle = 'rgba(16,10,7,.92)'; ctx.lineJoin = 'round';
      ctx.strokeText(txt, x, y); ctx.fillStyle = fill; ctx.fillText(txt, x, y);
    }
    function drawPops(now) {
      const c = L.cell, keep = [];
      for (const p of V.pops) {
        const age = now - p.t0;
        if (age < 0) { keep.push(p); continue; }
        if (age > 1.15) continue;
        keep.push(p);
        const g = gpos(p.lane, p.sq);
        const rise = easeOut(Math.min(1, age / 0.9)) * 0.36 * c;
        const alpha = age < 0.82 ? 1 : 1 - (age - 0.82) / 0.33;
        const pop = age < 0.14 ? easeOutBack(age / 0.14) : 1;
        const fsz = Math.max(12, c * 0.3);
        const x = g.x + (p.slot || 0) * c * 0.4, y = Math.max(fsz, g.y - c * ((p.ht || 0.9) + 0.12) - rise);
        ctx.globalAlpha = clamp(alpha, 0, 1);
        if (p.kind === 'heal') { outlinedText('+' + p.amount, x, y, fsz, p.monster ? '#9fd68c' : '#f0cd6e', 'center'); ctx.globalAlpha = 1; continue; }
        if (p.kind === 'label') { outlinedText(p.text, x, y, fsz * 0.62, p.col, 'center'); ctx.globalAlpha = 1; continue; }
        let r = Math.max(9, c * 0.17) * pop;
        const show = host.dice();
        let dmgX = x;
        if (show) {
          let fill, stroke, tc;
          if (p.kind === 'save') {
            if (p.saved) { fill = '#5b5752'; stroke = '#2a2725'; tc = '#efe7d6'; } else { fill = '#c2561d'; stroke = '#5a220a'; tc = '#fff4e2'; }
          } else if (!p.hit) { fill = '#3a3532'; stroke = '#171412'; tc = p.fumble ? '#ef6b6b' : '#cfc6b8'; }
          else if (p.crit) { r *= 1.3; fill = '#f0cd6e'; stroke = '#a3202a'; tc = '#2a1a10'; }
          else if (p.side === 'hero') { fill = '#d4a537'; stroke = '#6b4e12'; tc = '#2a1a10'; }
          else { fill = '#a3202a'; stroke = '#4a0c10'; tc = '#fff3e0'; }
          if (p.crit && p.hit) {
            ctx.fillStyle = 'rgba(240,205,110,.35)'; ctx.save(); ctx.translate(x - r * 0.9, y); ctx.rotate(age * 2); star(0, 0, r * 1.9); ctx.restore();
          }
          if (p.low) d20(x - r * 2.15, y + r * 0.35, r * 0.72, '#3a3532', '#171412', String(p.low), '#8f857a'); // advantage: the die it threw away
          d20(x - r * 0.9, y, r, fill, stroke, String(p.roll), tc);
          dmgX = x + r * 0.35;
          if (p.crit && p.hit) outlinedText('CRIT', x - r * 0.9, y + r * 1.35, fsz * 0.55, '#f0cd6e', 'center');
          else if (p.fumble) outlinedText('FUMBLE', x - r * 0.9, y + r * 1.35, fsz * 0.5, '#ef6b6b', 'center');
          else if (p.kind === 'save') outlinedText(p.saved ? 'SAVED' : 'FAILED', x - r * 0.9, y + r * 1.35, fsz * 0.5, p.saved ? '#cfc6b8' : '#f2a46b', 'center');
          else if (p.sneak && p.hit) outlinedText('SNEAK ATTACK', x - r * 0.9, y + r * 1.35, fsz * 0.5, '#f0cd6e', 'center');
          else if (p.holy && p.hit) outlinedText('RADIANT', x - r * 0.9, y + r * 1.35, fsz * 0.5, '#fff0b8', 'center');
          else if (p.resisted) outlinedText('RESISTED', x - r * 0.9, y + r * 1.35, fsz * 0.5, '#cfc6b8', 'center');
        }
        if (p.dmg > 0) outlinedText('−' + p.dmg, dmgX, y, p.crit ? fsz * 1.25 : fsz, p.crit ? '#f0cd6e' : '#fff6e6', show ? 'left' : 'center');
        else if (p.kind === 'atk') outlinedText('miss', dmgX, y, fsz * 0.7, '#b8a78a', show ? 'left' : 'center');
        ctx.globalAlpha = 1;
      }
      V.pops = keep;
    }

    function drawCoins(now) {
      if (!V.coins.length) return;
      const c = L.cell, tgt = host.purse ? host.purse() : { x: 0, y: 0 }, keep = [];
      for (const k of V.coins) {
        const age = now - k.t0;
        if (age < 0) { keep.push(k); continue; }
        if (age > 1.0) { if (host.onCoin) host.onCoin(); continue; }
        keep.push(k);
        const g = gpos(k.lane, k.sq), sx = g.x, sy = g.y - c * 0.5;
        let x, y;
        if (age < 0.4) { const q = age / 0.4; x = sx + k.vx * c * q; y = sy - Math.sin(q * Math.PI * 0.85) * k.peak * c; }
        else {
          const ex = sx + k.vx * c, ey = sy - Math.sin(Math.PI * 0.85) * k.peak * c, q = easeIn((age - 0.4) / 0.6);
          x = lerp(ex, tgt.x, q); y = lerp(ey, tgt.y, q);
        }
        const r = Math.max(4, c * 0.075), sxk = Math.max(0.2, Math.abs(Math.cos(age * 11)));
        ctx.fillStyle = '#7d5b12'; ctx.beginPath(); ctx.ellipse(x, y + 1, r * sxk, r, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d4a537'; ctx.beginPath(); ctx.ellipse(x, y, r * sxk, r, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f6dc8e'; ctx.beginPath(); ctx.ellipse(x - r * 0.25 * sxk, y - r * 0.25, r * 0.35 * sxk, r * 0.35, 0, 0, TAU); ctx.fill();
      }
      V.coins = keep;
    }


    const pub = name => fn => function () { bind(); return fn.apply(null, arguments); };
    return { evaluate, runImpacts, hold, drawFx: pub('fx')(drawFx), drawPops: pub('pops')(drawPops), drawCoins: pub('coins')(drawCoins) };
  }

  return { VERSION, create, clamp, lerp, ease: { out: easeOut, in: easeIn, inOut: easeInOut, outBack: easeOutBack }, STRIKE_CONTACT, MATERIALS };
})();
