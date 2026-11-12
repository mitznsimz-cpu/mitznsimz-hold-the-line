// Hold the Line: view/events.js. What the rules tell the view: each event from the sim becomes animation, sound and words on the board.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

/* ---------- simulation events become animation ---------- */
// Every event the rules send (HTL.EVENTS) is a case below, or is here with the reason the board needs nothing for it.
// The tests check that no event is left out of both.
const SHOWN_FROM_STATE = {
  round: 'the round counter reads S.round', trap: 'traps are drawn from S.traps', trapGone: 'traps are drawn from S.traps',
  fork: 'the next square is enough: the monster just moves on', waveCleared: 'the wave banner and the break come with rest'
};
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
    case 'windup': { // a boss rears back: a pulsing ! over it until the blow lands or comes apart
      const sp = V.sprites.get(ev.id); if (!sp) break;
      sp.windup = ev.t; sp.anims.push({ k: 'cast', t0: ev.t, dur: 0.6 });
      V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: 'WINDING UP', col: '#f0cd6e' });
      if (!V.windupTold) { V.windupTold = true; hint('A boss is winding up a crushing blow for the heroes in front of it. Hurt it hard, or pounce on it, to break it.', 4200, 'Wind-up'); }
      break;
    }
    case 'stagger': {
      const sp = V.sprites.get(ev.id); if (!sp) break;
      sp.windup = 0; sp.anims.push({ k: 'shake', t0: ev.t, dur: 0.4 });
      V.pops.push({ t0: ev.t, lane: sp.lane, sq: sp.sq, ht: sp.ht, kind: 'label', text: ev.why === 'hurt' ? 'STAGGERED' : 'BROKEN OFF', col: '#a9cdf0' });
      break;
    }
    case 'unleash': { // the blow lands down the row in front of it
      const sp = V.sprites.get(ev.id); if (!sp) break;
      sp.windup = 0; sp.anims.push({ k: 'strike', t0: ev.t, dur: 0.45 });
      for (let q = ev.sq - 1, i = 0; q >= Math.max(0, ev.sq - 3); q--, i++) V.fx.push({ k: 'boom', t0: ev.t + 0.12 + i * 0.05, dur: 0.45, lane: ev.lane, sq: q });
      shake(1.6);
      break;
    }
    case 'trapHit': case 'thorns': case 'acid': case 'scorch': case 'splash': case 'crushed': {
      const sp = V.sprites.get(ev.to || ev.id); if (!sp) break;
      const at = ev.t + 0.12;
      V.impacts.push({ at, fn: () => {
        if (ev.dmg > 0) { sp.anims.push({ k: 'shake', t0: at, dur: 0.3 }, { k: 'flash', t0: at, dur: 0.2 }); sp.dispHp = Math.max(0, sp.dispHp - ev.dmg); }
        const sk = ev.type === 'splash' ? ev.kind : '', acid = ev.type === 'acid' || sk === 'acid';
        const word = ev.type === 'crushed' ? ' CRUSHED' : ev.type === 'scorch' ? (ev.saved ? ' (SAVED)' : ' FIRE') : acid ? ' ACID' : sk === 'holyWater' ? ' HOLY' : ev.type === 'thorns' ? ' THORNS' : '';
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
