/* Hold the Line: Simz, the cats' own player. He plays by the rules like anyone else: everything he does goes through
   HTL (sim.js), the same calls the page makes for a player, and the few questions about the board he asks are the ones
   HTL.look answers. Used by the Auto button, by the balance and stall tests, and in Reverse, where he keeps the tavern.
   Loaded straight after sim.js. Deterministic, like the rules: the same battle and seed play out the same. */
var HTL_SIMZ = (function (HTL) {
  'use strict';
  const { HEROES, MONSTERS, place, canPlace, recall, unitAt, mapOf, battle, upgradeCost, levelUp, trapAt, usePower, powerTargets,
    canThrow, throwItem, canShutGate, shutGate, stepOf } = HTL;
  const { PLACEABLE, SIGHT_BLOCK, near, within, seen, free, placeable, monsterAt, clearRow, clearCol, isObject, traits } = HTL.look;

  // Simz's own use of the cats' powers: swat whatever is about to reach the door, pounce on the thickest crowd
  function simzPowers(s) {
    const mons = s.units.filter(u => u.alive && u.kind === 'monster');
    if (!mons.length) return;
    const sw = s.powers.swat;
    if (sw && s.round >= sw.ready) {
      const m = mons.filter(u => !traits(u).boss).sort((a, b) => a.sq - b.sq || b.hp - a.hp || a.id - b.id)[0];
      if (m && m.sq <= 2) usePower(s, 'swat', m.lane, m.sq);
    }
    const po = s.powers.pounce;
    if (po && s.round >= po.ready) {
      let best = null;
      for (const m of mons) {
        if (!m.alive) continue;
        const n = powerTargets(s, 'pounce', m.lane, m.sq).length;
        if (!best || n > best.n || (n === best.n && m.sq < best.m.sq)) best = { m, n };
      }
      if (best && (best.n >= 3 || best.m.sq <= 2)) usePower(s, 'pounce', best.m.lane, best.m.sq);
    }
  }


  /* Simz plays: a steady build used by the autoplay button and by the balance tests.
     Bards at the back, a Ranger in every row, a Fighter wall, then Wizards, then depth.
     On other maps the same plan is fitted to the squares a hero can stand on. */
  const PLAN = [
    ['bard', 2, 0], ['bard', 1, 0], ['ranger', 2, 1], ['bard', 3, 0],
    ['ranger', 1, 1], ['ranger', 3, 1], ['ranger', 0, 1], ['ranger', 4, 1],
    ['fighter', 2, 4], ['fighter', 1, 4], ['fighter', 3, 4], ['fighter', 0, 4], ['fighter', 4, 4],
    ['wizard', 2, 2], ['bard', 0, 0], ['wizard', 1, 2], ['wizard', 3, 2], ['bard', 4, 0], ['wizard', 0, 2], ['wizard', 4, 2],
    ['cleric', 1, 3], ['cleric', 3, 3],
    ['fighter', 0, 5], ['fighter', 2, 5], ['fighter', 4, 5], ['rogue', 1, 5], ['rogue', 3, 5],
    ['ranger', 2, 3], ['ranger', 0, 3], ['ranger', 4, 3]
  ];
  // a square Simz keeps clear: a hatch that may burst open, or one an oven flares onto (only Phase 7 floors have either).
  // Barrel chutes are not on the list: a barrel costs a d6 and a turn, less than leaving the row open, and his barricades
  // break the barrels before they reach his line.
  function risky(map, l, q) {
    if (map.rows[l] && map.rows[l][q] === 'H') return true;
    return !!(map.oven && map.oven.hot.some(h => h.lane === l && h.sq === q));
  }
  function derivePlan(map) {
    const ok = (l, q, t) => l >= 0 && l < map.h && q >= 0 && q < map.w && PLACEABLE.indexOf(map.rows[l][q]) >= 0 && !risky(map, l, q, t);
    const taken = new Set(), out = [], later = [];
    // a floor wider than five rows: the plan's rows spread across it, and the rows between borrow their neighbour's
    let plan = PLAN;
    if (map.h > 5) {
      const at = l => Math.round(l * (map.h - 1) / 4), used = new Set([0, 1, 2, 3, 4].map(at));
      plan = PLAN.map(([t, l, q]) => [t, at(l), q]);
      for (let l = 0; l < map.h; l++) if (!used.has(l)) {
        const near = [0, 1, 2, 3, 4].reduce((a, b) => (Math.abs(at(b) - l) < Math.abs(at(a) - l) ? b : a), 0);
        PLAN.forEach(([t, l0, q]) => { if (l0 === near && t !== 'bard') plan.push([t, l, q]); });
      }
    }
    plan.forEach(([t, l, q], i) => {
      if (l >= map.h) return;
      if (ok(l, q)) { taken.add(l * 100 + q); out[i] = [t, l, q]; } else later.push(i);
    });
    for (const i of later) { // the nearest free square in the same row, toward the tavern first
      const [t, l, q] = plan[i];
      for (const dq of [-1, -2, -3, 1, 2, 3, -4, 4, -5, 5]) {
        if (ok(l, q + dq) && !taken.has(l * 100 + q + dq)) { taken.add(l * 100 + q + dq); out[i] = [t, l, q + dq]; break; }
      }
      if (!out[i] && map.turns) { // a bent cellar may have nothing in that row: then the free square nearest the tavern along the way
        let best = null, bd = Infinity;
        for (let l2 = 0; l2 < map.h; l2++) for (let q2 = 0; q2 < map.w; q2++) {
          const d2 = map.distWalk[l2][q2];
          if (ok(l2, q2) && !taken.has(l2 * 100 + q2) && isFinite(d2) && (d2 < bd || (d2 === bd && l2 * 100 + q2 < best))) { bd = d2; best = l2 * 100 + q2; }
        }
        if (best != null) { taken.add(best); out[i] = [t, Math.floor(best / 100), best % 100]; }
      }
    }
    return out.filter(Boolean);
  }
  // Simz's plan names the core six by job. With a party, each job goes to the heroes in it who can do that job: the planned
  // hero (or the cheapest one who can) takes most of the squares, and every third square goes to the others in turn
  const ROLE_OF = { bard: 'income', fighter: 'wall', ranger: 'shooter', wizard: 'caster', cleric: 'healer', rogue: 'flank' };
  const ROLES = { income: ['bard'], wall: ['fighter', 'monk', 'paladin'], shooter: ['ranger', 'warlock', 'tinker', 'sorcerer'],
    caster: ['wizard', 'druid', 'sorcerer'], healer: ['cleric', 'paladin', 'druid'], flank: ['rogue', 'monk', 'tinker'] };
  function planTypes(s, sub) {
    const map = mapOf(s), key = map.id + '|' + (s.loadout || []).join(',');
    if (s.simzPlan && s.simzPlan.key === key) return s.simzPlan.types;
    const inParty = ty => !s.loadout || s.loadout.indexOf(ty) >= 0, used = {};
    const types = map.plan.map(([planned]) => {
      const role = ROLE_OF[planned];
      if (!role || !s.loadout) return sub(planned);
      const have = ROLES[role].filter(inParty);
      if (role === 'wall' && !inParty('fighter')) have.unshift('barricade'); // no Fighter: barricades hold the line, anyone else who can takes every third
      if (!have.length) return sub(planned);
      const first = inParty(planned) ? planned : role === 'wall' ? have[0] : have.slice().sort((x, y) => HEROES[x].cost - HEROES[y].cost)[0];
      const rest = have.filter(ty => ty !== first), k = used[role] = (used[role] || 0) + 1;
      return rest.length && k % 3 === 0 ? rest[(k / 3 - 1) % rest.length] : first;
    });
    s.simzPlan = { key, types };
    return types;
  }
  const SUBS = { ranger: ['warlock', 'sorcerer', 'tinker'], fighter: ['paladin', 'monk'], wizard: ['sorcerer', 'druid'],
    cleric: ['paladin', 'druid', 'sorcerer'], rogue: ['monk', 'paladin', 'tinker'] };
  const SHOOTERS = ['ranger', 'wizard', 'warlock', 'sorcerer', 'druid', 'tinker'], WALLS = ['fighter', 'paladin', 'monk'];
  function autoplay(s) {
    if (s.phase !== 'running') return 0;
    if (s.powers) simzPowers(s);
    const map = mapOf(s);
    let placed = 0;
    const inParty = ty => !s.loadout || s.loadout.indexOf(ty) >= 0;
    const T = ty => inParty(ty) ? ty : ty === 'fighter' && s.loadout ? 'barricade' : ((SUBS[ty] || []).find(inParty) || ty); // the party's stand-in for a hero it left behind; a barricade for a Fighter
    // on a floor with hatches or ovens Simz keeps off them, moving a square or two along the row when he can
    const put = (type, lane, sq) => {
      if (risky(map, lane, sq, T(type))) {
        const alt = [1, -1, 2, -2].map(dq => sq + dq).find(q => q >= 0 && !risky(map, lane, q, T(type)) && canPlace(s, T(type), lane, q) === null);
        if (alt == null) return false;
        sq = alt;
      }
      if (!place(s, T(type), lane, sq)) { placed++; return true; } return false;
    };
    // a hero in a row only helps against a monster it can see past the pillars
    const shootFrom = (type, lane, sqs, front) => {
      const seen = sqs.filter(q => q < front.sq && clearRow(s, lane, q, front.sq));
      for (const q of seen) if (put(type, lane, q)) return true;
      if (seen.length || sqs.every(q => q >= front.sq)) return false;
      for (let q = 4; q < front.sq; q++) if (clearRow(s, lane, q, front.sq) && put(type, lane, q)) return true;
      return false;
    };
    for (let lane = 0; lane < map.h; lane++) {
      let front = null;
      for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && (!front || u.sq < front.sq)) front = u;
      if (!front) continue;
      const mine = s.units.filter(u => u.alive && u.kind === 'hero' && u.lane === lane && u.sq < front.sq);
      const shooters = mine.filter(u => SHOOTERS.indexOf(u.type) >= 0 && clearRow(s, lane, u.sq, front.sq));
      let placedHere = false;
      if (traits(front).resist && !mine.some(u => (u.type === 'wizard' || u.type === 'sorcerer' || u.type === 'warlock') && clearRow(s, lane, u.sq, front.sq)))
        placedHere = shootFrom('wizard', lane, [2, 1, 3], front);
      if (!placedHere && !shooters.length) placedHere = shootFrom('ranger', lane, [1, 2, 3], front);
      if (traits(front).regen && front.hp > front.maxHp * 0.6 && mine.filter(u => (SHOOTERS.indexOf(u.type) >= 0 || u.type === 'cleric') && clearRow(s, lane, u.sq, front.sq)).length < 3) {
        // something that heals faster than this row hurts it: bring what stops the healing, or more damage
        const tr0 = traits(front), pick = tr0.radiantStops ? ['cleric', 'paladin', 'wizard'] : tr0.fireStops ? ['wizard', 'druid', 'sorcerer'] : ['wizard', 'sorcerer', 'ranger'];
        const ty = pick.find(inParty);
        let done = false;
        if (ty) for (const q of [2, 3, 1, 4, 0]) if (q < front.sq && !risky(map, lane, q) && clearRow(s, lane, q, front.sq) && place(s, ty, lane, q) === null) { placed++; done = true; break; }
        if (ty && !done) { // no room: a Bard in that row makes way
          const bard = mine.find(u => HEROES[u.type].income && clearRow(s, lane, u.sq, front.sq));
          if (bard && s.gold >= HEROES[ty].cost * 2) { const q = bard.sq; recall(s, bard.id); if (place(s, ty, lane, q) === null) placed++; done = true; }
        }
        const smiter = tr0.radiantStops && ['paladin', 'cleric'].find(inParty);
        if (smiter && !done && s.gold >= HEROES[smiter].cost * 2) { // still no room: whoever stands in front of it makes way for something that sears
          const by = mine.find(u => u.sq === front.sq - 1 && u.type !== 'paladin' && u.type !== 'cleric' && !HEROES[u.type].ally && !u.inside);
          if (by) { const q = by.sq; recall(s, by.id); if (place(s, smiter, lane, q) === null) placed++; }
        }
      }
      if (traits(front).invisible && !seen(s, front)) { // something invisible: bring a light into that row
        const lamp = ['cleric', 'paladin'].find(inParty);
        if (lamp) for (const q of [3, 2, 4, 1]) if (q < front.sq && !risky(map, lane, q) && place(s, lamp, lane, q) === null) { placed++; break; }
      }
      const wall = mine.some(u => WALLS.indexOf(u.type) >= 0 || HEROES[u.type].inert);
      if (!wall && front.sq >= 2 && front.sq <= 6) put('fighter', lane, front.sq - 1);
    }
    let planDone = true;
    const kinds = planTypes(s, T);
    for (let i = 0; i < map.plan.length; i++) {
      const [, lane, sq] = map.plan[i], type = kinds[i], why = canPlace(s, type, lane, sq);
      if (why === 'occupied' || why === 'off' || why === 'locked') continue;
      if (why) { planDone = false; break; }
      if (HEROES[type].income && monsterAt(s, lane, sq + 1)) continue; // a Bard would only be fed to whatever is next to that square
      put(type, lane, sq);
    }
    // a Barbarian at the worst row: a boss, a crowd, or something close to the tavern
    let best = null, bestScore = 0;
    for (let lane = 0; lane < map.h; lane++) {
      let front = null;
      for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && u.sq <= map.w - 2 && (!front || u.sq < front.sq)) front = u;
      if (!front) continue;
      let score = 0, crowd = 0;
      for (const m of s.units) if (m.alive && m.kind === 'monster' && near(m, front)) { score += m.hp; crowd++; }
      if (MONSTERS[front.type].traits.boss) score += 150;
      if (front.sq <= 3) score += 120;
      if (crowd >= 3) score += 60;
      if (score > bestScore) { best = front; bestScore = score; }
    }
    if (best && bestScore >= 60 && (planDone || bestScore >= 150))
      for (let sq = best.sq - 1; sq >= 0; sq--) {
        if (unitAt(s, best.lane, sq) || !placeable(s, best.lane, sq)) continue;
        if (!clearRow(s, best.lane, sq, best.sq)) break;
        put('barbarian', best.lane, sq); break;
      }
    if (map.chutes) placed += chuteGuard(s);
    if (map.gate) simzGate(s);
    if (map.turns && !map.forks) placed += guardRoute(s, inParty); // on a ring the plan covers both ways; chasing the front monster would plug the doors
    if (s.belt) throwSome(s);
    if (planDone && s.loadout) placed += seatTheRest(s);
    if (planDone) placed += levelSome(s);
    return placed;
  }
  // Simz and the yard gate: he drops it when three monsters, or a boss, are about to come through it
  function simzGate(s) {
    if (canShutGate(s)) return;
    const m = mapOf(s);
    let n = 0, boss = false;
    for (const u of s.units) {
      if (!u.alive || u.kind !== 'monster' || u.dormant) continue;
      const t = traits(u), f = t.flying ? m.fields.fly : t.amphibious ? m.fields.swim : m.fields.walk;
      let p = stepOf(s, u);
      for (let k = 0; k < 5 && p && !p.exit; k++) { if (m.rows[p.lane][p.sq] === 'G') { n++; boss = boss || !!t.boss; break; } p = f.next[p.lane][p.sq]; }
    }
    if (n >= 3 || boss) shutGate(s);
  }
  // Simz and the barrels: a barricade a few squares in from the tavern end of each chute, so the barrels bowl the
  // monsters in front of it and smash on it before they reach the heroes behind
  function chuteGuard(s) {
    const map = mapOf(s), ch = map.chutes;
    if (s.gold < HEROES.barricade.cost + 25 || !s.units.some(u => u.alive && u.kind === 'hero' && HEROES[u.type].income)) return 0;
    for (const l of ch.lanes) {
      if (s.units.some(u => u.alive && u.lane === l && u.kind === 'hero' && HEROES[u.type].defender)) continue;
      const floor = [];
      for (let q = 0; q < map.w; q++) if (PLACEABLE.indexOf(map.rows[l][q]) >= 0) floor.push(q);
      for (const q of floor.slice(3, 6).concat(floor.slice(0, 3).reverse())) if (canPlace(s, 'barricade', l, q) === null) { place(s, 'barricade', l, q); return 1; }
    }
    return 0;
  }
  // Simz and the belt: holy water on a pile of the dead, fire or acid on any crowd, a net or bearings on what's nearly through
  function throwSome(s) {
    if (s.thrownRound === s.round) return;
    const piles = {};
    for (const m of s.units) if (m.alive && m.kind === 'monster' && !m.dormant) (piles[m.lane * 100 + m.sq] = piles[m.lane * 100 + m.sq] || []).push(m);
    let best = null, bestScore = 0;
    for (const k in piles) {
      const ms = piles[k], lane = ms[0].lane, sq = ms[0].sq, near = sq <= 2;
      const dead = ms.filter(m => traits(m).undead || traits(m).fiend).length;
      const opts = [];
      if (dead >= 2 || (dead && ms.some(m => traits(m).radiantStops))) opts.push(['holyWater', 30 * dead]);
      if (ms.length >= 2) opts.push(['alchemistFire', 22 * ms.length], ['acid', 20 * ms.length]);
      if (near && ms.some(m => m.maxHp < 60)) opts.push(['net', 45]);
      for (const [kind, sc] of opts) if (s.belt[kind] > 0 && sc + (near ? 20 : 0) > bestScore && !canThrow(s, kind, lane, sq)) { best = [kind, lane, sq]; bestScore = sc + (near ? 20 : 0); }
    }
    if (best && bestScore >= 40) throwItem(s, best[0], best[1], best[2]);
  }
  /* Where the way turns, rows are not enough: Simz looks at the monsters nearest the tavern along their route, and any
     that nothing can reach gets a shooter on a square with a straight, clear line to it, along its column or its row. */
  const shootsAt = (s, h, m) => { const t = HEROES[h.type].targeting;
    if (t !== 'lane' && t !== 'lanes') return false;
    return (h.lane === m.lane && m.sq > h.sq && clearRow(s, h.lane, h.sq, m.sq)) || (h.sq === m.sq && clearCol(s, h.sq, h.lane, m.lane)); };
  function guardRoute(s, inParty) {
    const map = mapOf(s), dist = (u) => map.distWalk[u.lane][u.sq];
    const mons = s.units.filter(u => u.alive && u.kind === 'monster' && !u.dormant && isFinite(dist(u))).sort((a, b) => dist(a) - dist(b) || a.id - b.id);
    const ty = ['ranger', 'warlock', 'sorcerer', 'wizard', 'cleric'].find(t => inParty(t));
    let n = 0;
    for (const m of mons.slice(0, 2)) {
      if (!ty || s.gold < HEROES[ty].cost) break;
      if (s.units.some(h => h.alive && h.kind === 'hero' && !isObject(h) && !h.inside && (within(h, m, 1) || shootsAt(s, h, m)))) continue;
      const spots = [], free = (l, q) => placeable(s, l, q) && !unitAt(s, l, q) && !trapAt(s, l, q) && !risky(map, l, q);
      for (let l = 0; l < map.h; l++) if (l !== m.lane && free(l, m.sq) && clearCol(s, m.sq, l, m.lane)) spots.push({ lane: l, sq: m.sq, d: Math.abs(l - m.lane) });
      for (let q = m.sq - 1; q >= 0; q--) { if (SIGHT_BLOCK.indexOf(map.rows[m.lane][q]) >= 0) break; if (free(m.lane, q)) spots.push({ lane: m.lane, sq: q, d: m.sq - q }); }
      spots.sort((a, b) => (a.d < 2) - (b.d < 2) || a.d - b.d || a.lane - b.lane);
      for (const sp of spots) if (!place(s, ty, sp.lane, sp.sq)) { n++; break; }
    }
    return n;
  }
  // with the plan done and gold to spare, Simz levels up one hero a round: lowest level first, damage dealers first
  const SIMZ_PATH = { bard: 'coinsinger', fighter: 'champion', ranger: 'hunter', wizard: 'evoker', cleric: 'life', rogue: 'cutthroat', barbarian: 'stonehide',
    paladin: 'devotion', druid: 'land', monk: 'openhand', warlock: 'fiend', sorcerer: 'draconic', tinker: 'siegewright' };
  const SIMZ_ORDER = ['wizard', 'sorcerer', 'ranger', 'warlock', 'druid', 'tinker', 'fighter', 'paladin', 'monk', 'cleric', 'rogue', 'bard'];
  function simzPath(s, u) {
    if (u.type === 'cleric' && battle(s).monsters.filter(ty => MONSTERS[ty].traits.undead).length >= 3) return 'dawnkeeper';
    return SIMZ_PATH[u.type];
  }
  // a party member the plan never called for still gets a square, in the busiest row, once the plan is built
  function seatTheRest(s) {
    const load = {}, map = mapOf(s);
    for (const m of s.units) if (m.alive && m.kind === 'monster') load[m.lane] = (load[m.lane] || 0) + m.hp;
    const rows = Array.from({ length: map.h }, (_, l) => l).sort((x, y) => (load[y] || 0) - (load[x] || 0) || x - y);
    for (const ty of s.loadout) {
      if (ty === 'barbarian' || HEROES[ty].income || s.units.some(u => u.alive && u.type === ty)) continue;
      for (const l of rows) for (const q of [3, 2, 4, 1, 5, 0, 6, 7, 8]) if (!risky(map, l, q) && canPlace(s, ty, l, q) === null) { place(s, ty, l, q); return 1; }
    }
    return 0;
  }
  function levelSome(s) {
    const load = {};
    for (const m of s.units) if (m.alive && m.kind === 'monster') load[m.lane] = (load[m.lane] || 0) + m.hp;
    const rank = ty => SIMZ_ORDER.indexOf(ty);
    const cands = s.units.filter(u => u.alive && u.kind === 'hero' && rank(u.type) >= 0 && upgradeCost(u) != null);
    cands.sort((a, b) => (a.level - b.level) || (rank(a.type) - rank(b.type)) || ((load[b.lane] || 0) - (load[a.lane] || 0)) || (a.id - b.id));
    for (const u of cands) {
      if (s.gold - upgradeCost(u) < 100) continue; // keep enough back for a Barbarian or a gap in the line
      if (!levelUp(s, u.id, u.level === 2 ? simzPath(s, u) : undefined)) return 1;
    }
    return 0;
  }

  // every floor without a plan in the pack gets Simz's plan, worked out from its shape
  for (const m of Object.values(HTL.MAPS)) if (!m.plan) m.plan = derivePlan(m);
  HTL.autoplay = autoplay; // the Auto button and the tests call him as HTL.autoplay
  HTL._risky = risky;
  HTL.setKeeper(autoplay);
  return { autoplay, derivePlan, risky };
})(HTL);
if (typeof module !== 'undefined' && module.exports) module.exports = HTL_SIMZ;
