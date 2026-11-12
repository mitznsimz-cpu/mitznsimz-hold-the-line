/* Hold the Line: the rules engine. Deterministic: plain data in, plain data out, no DOM, no clocks.
   The page and the Node harness both drive it through HTL.step(state, dt). It reads its content from a pack (pack-core.js). */
var HTL = (function (P) {
  'use strict';
  const ROUND = 2.0;                         // real seconds per combat round
  const LIVES = 5, PREP_ROUNDS = 4, REST_ROUNDS = 4;
  const HEROES = P.heroes, PATHS = P.paths, DIFFICULTY = P.difficulty, MONSTERS = P.monsters, BATTLES = P.battles, MAPS = P.maps;
  // magic items: '*' means any hero can carry it
  const THROWS = P.throws || {}, CROWD = 3; // the belt; how many small monsters can share a square in a crowded battle
  const ITEMS = {};
  for (const id in (P.items || {})) { const it = P.items[id]; ITEMS[id] = Object.assign({ id }, it, { for: it.for === '*' ? Object.keys(HEROES).filter(t => !HEROES[t].ally && !HEROES[t].defender) : it.for }); }

  // Phase 7 floors: H a hatch (floor until it bursts open, then a door), = ice (walkers slide, no one stands),
  // * an oven (a wall that flares), G the yard gate (a way through until it is dropped). None of these is on an older map.
  const PASS_WALK = '.~^+DH=G@', PASS_FLY = '.~^+DoH=G%@', PLACEABLE = '.~^+H', SIGHT_BLOCK = '# *'; // % a low box hedge: walkers go round, flyers over, everyone sees over it
  const MAP_BY_ID = {}, BATTLE_BY_ID = {};

  function parseSpawns(str) {
    const out = [];
    for (const tok of str.split(/\s+/)) {
      if (!tok) continue;
      const m = /^([A-Za-z]+):(\d+)(?:\*(\d+))?(?:@(\d+))?$/.exec(tok);
      if (!m || !MONSTERS[m[1]]) throw new Error('Hold the Line: bad spawn token "' + tok + '"');
      out.push({ type: m[1], at: +m[2], count: m[3] ? +m[3] : 1, door: m[4] != null ? +m[4] : null });
    }
    return out;
  }

  // cost of getting from every square to the tavern: moving into a square costs 1, or 2 for walkers in water, or a half
  // for anything on foot sliding across ice
  function field(map, pass, wade, rows0) {
    const { w, h } = map, rows = rows0 || map.rows, foot = pass === PASS_WALK;
    const dist = Array.from({ length: h }, () => new Array(w).fill(Infinity));
    const cost = (l, q) => (wade && rows[l][q] === '~') ? 2 : (foot && rows[l][q] === '=') ? 0.5 : 1;
    const done = Array.from({ length: h }, () => new Array(w).fill(false));
    for (let l = 0; l < h; l++) if (pass.indexOf(rows[l][0]) >= 0) dist[l][0] = 1;
    for (;;) { // Dijkstra by scanning: the mats are tiny
      let bl = -1, bq = -1, bd = Infinity;
      for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) if (!done[l][q] && dist[l][q] < bd) { bd = dist[l][q]; bl = l; bq = q; }
      if (bl < 0) break;
      done[bl][bq] = true;
      for (const [dl, dq] of STEPS) {
        const l = bl + dl, q = bq + dq;
        if (l < 0 || l >= h || q < 0 || q >= w || pass.indexOf(rows[l][q]) < 0) continue;
        const nd = bd + cost(bl, bq);
        if (nd < dist[l][q]) dist[l][q] = nd;
      }
    }
    // the next square from each square: toward the tavern first, then up, down, back; first cheapest wins
    const next = Array.from({ length: h }, (_, l) => Array.from({ length: w }, (_, q) => {
      if (!isFinite(dist[l][q])) return null;
      let best = null, bc = Infinity;
      if (q === 0) { best = EXIT; bc = 1; }
      for (const [dl, dq] of STEPS) {
        const l2 = l + dl, q2 = q + dq;
        if (l2 < 0 || l2 >= h || q2 < 0 || q2 >= w || !isFinite(dist[l2][q2])) continue;
        const c = cost(l2, q2) + dist[l2][q2];
        if (c < bc) { best = { lane: l2, sq: q2 }; bc = c; }
      }
      return best;
    }));
    return { dist, next, cost };
  }
  const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const EXIT = { exit: true };

  function compileMap(id, src) {
    const rows = src.rows, h = rows.length, w = rows[0].length;
    if (rows.some(r => r.length !== w)) throw new Error('Hold the Line: map ' + id + ' has rows of different lengths');
    const doors = [], hatches = {}, doorAt = {};
    for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) if (rows[l][q] === 'D' || rows[l][q] === 'H' || rows[l][q] === '@') { // @ the well: a way in, out in the middle of the floor
      if (rows[l][q] === 'H') hatches[doors.length] = true;
      doorAt[l * 100 + q] = doors.length; doors.push({ lane: l, sq: q });
    }
    const map = { id, name: src.name, rows, w, h, doors, turns: !!src.turns }; // turns: the way bends, so blades reach up and down too
    const walk = field(map, PASS_WALK, true), fly = field(map, PASS_FLY, false), swim = field(map, PASS_WALK, false);
    map.nextWalk = walk.next; map.nextFly = fly.next; map.distWalk = walk.dist;
    map.nextSwim = swim.next; // the amphibious take the straight way, water or not
    map.fields = { walk, fly, swim };
    doors.forEach((dr, i) => { if (!isFinite(walk.dist[dr.lane][dr.sq])) throw new Error('Hold the Line: door ' + i + ' of map ' + id + ' has no way to the tavern'); });
    if (!doors.length) throw new Error('Hold the Line: map ' + id + ' has no doors');
    // Phase 7: what a floor can hold beyond its shape. A hatch is a door that starts shut; ovens flare on the squares in
    // front of them; barrels roll down the chutes; the yard gate can be dropped; on a fork, monsters take the weaker way.
    if (Object.keys(hatches).length) { map.hatches = hatches; map.doorAt = doorAt; }
    const hot = [];
    for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) if (PLACEABLE.indexOf(rows[l][q]) >= 0 || rows[l][q] === '=' || rows[l][q] === 'G')
      if (STEPS.some(([dl, dq]) => (rows[l + dl] || '')[q + dq] === '*')) hot.push({ lane: l, sq: q });
    if (hot.length) map.oven = Object.assign({ every: 4, first: PREP_ROUNDS + 2, n: 2, d: 6, dc: 13 }, src.oven || {}, { hot });
    if (src.chutes) map.chutes = Object.assign({ every: 6, first: PREP_ROUNDS + 3, n: 1, d: 6, dc: 12 }, src.chutes);
    if (rows.some(r => r.indexOf('G') >= 0)) {
      const shutRows = rows.map(r => r.replace(/G/g, '#'));
      const sw = field(map, PASS_WALK, true, shutRows), sf = field(map, PASS_FLY, false, shutRows), ss = field(map, PASS_WALK, false, shutRows);
      map.gate = Object.assign({ rounds: 3 }, src.gate || {});
      map.shut = { nextWalk: sw.next, nextFly: sf.next, nextSwim: ss.next, distWalk: sw.dist, fields: { walk: sw, fly: sf, swim: ss } };
    }
    if (src.forks) map.forks = true;
    if (src.lawn) map.lawn = true; // the beer garden: its hatches are molehills
    if (src.skylights) map.skylights = true; // the attic: its hatches are skylights, and daylight comes in through the open ones
    map.plan = src.plan || derivePlan(map);
    return map;
  }

  function rnd(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function d(s, n) { if (s.forced && s.forced.length) return s.forced.shift(); return 1 + Math.floor(rnd(s) * n); }
  function dice(s, n, sides) { let t = 0; for (let i = 0; i < n; i++) t += d(s, sides); return t; }
  function slot(init) { return Math.min(0.97, Math.max(0.03, (24 - init) / 25)); }
  function emit(s, ev) { ev.t = s.now; s.events.push(ev); return ev; }
  const NO_TRAITS = {};
  function traits(u) { return u.kind === 'monster' ? MONSTERS[u.type].traits : NO_TRAITS; }
  /* Every monster trait, in one place: what it says on the monster's card (text, or a function of its value) and where
     the rules act on it. A new trait is an entry here, then its rule: an entry in one of the hook lists (TURN_START,
     BEFORE_ACT, ARMOUR, ON_LANDED, WHEN_STRUCK, AFTER_HIT, AFTER_WOUND, ON_HURT) where it can be, or the named rule
     where it can't. The tests check that every trait in the pack and every one the rules read is listed here.
     The order is the order the card lists them in. */
  const TRAITS = {
    boss:         { text: 'Boss', where: 'not shoved back, not frightened; Simz plans for it' },
    undead:       { text: 'Undead', where: 'holy ground, sunlight, Sacred Flame and Smite do double, a Mace of Disruption' },
    flying:       { text: 'Flies over the first hero in its way, and over pits', where: 'monsterAct: moving; not slowed by water or ice; no traps' },
    multi:        { text: 'Attacks twice a turn', where: 'monsterAct: attacking' },
    resist:       { text: 'Takes half damage from weapons, full damage from spells', where: 'ARMOUR' },
    regen:        { text: v => 'Heals ' + v + ' hit points a turn', where: 'TURN_START: regenerate' },
    soak:         { text: v => 'Heals ' + v + ' hit points a turn while it stands in water or the well', where: 'TURN_START: regenerate' },
    drain:        { text: 'Heals itself with half the damage it deals', where: 'AFTER_HIT' },
    paralyse:     { text: 'Its hits can paralyse a hero for a turn', where: 'AFTER_WOUND' },
    split:        { text: 'Splits in two when badly hurt', where: 'ON_HURT' },
    summon:       { text: (v, type) => v.type === type ? 'Kindles another of its kind' : 'Calls up a ' + MONSTERS[v.type].name.toLowerCase() + ' every third turn', where: 'BEFORE_ACT: callHelp' },
    mend:         { text: 'Heals the monsters around it', where: 'BEFORE_ACT: mendNearby' },
    burrow:       { text: 'Burrows under the first hero in its way', where: 'monsterAct: moving; springs traps where it comes up' },
    surface:      { text: 'Badly hurt, it dives under the lawn and comes up through a molehill further on', where: 'ON_HURT: dive; spawnDue carries its wounds' },
    shieldwall:   { text: 'Arrows at monsters behind it go wide', where: 'attack: cover for the monsters behind' },
    invisible:    { text: 'Invisible unless a Cleric, a Paladin or holy water is near', where: 'seen()' },
    unhorse:      { text: 'Becomes a goblin and a wolf when badly hurt', where: 'ON_HURT' },
    fireStops:    { text: 'Fire stops it healing for a turn', where: 'AFTER_WOUND: burn; TURN_START: regenerate' },
    radiantStops: { text: 'Radiant light stops it healing for a turn', where: 'AFTER_WOUND: burn; holy ground; sunlight; TURN_START: regenerate' },
    engulf:       { text: 'Swallows a hero whole and carries it', where: 'AFTER_WOUND; heroAct: inside' },
    rust:         { text: 'Its touch rusts armour away', where: 'AFTER_WOUND' },
    gaze:         { text: 'Its gaze turns heroes to stone', where: 'BEFORE_ACT' },
    charm:        { text: 'Charms heroes into attacking their friends', where: 'BEFORE_ACT' },
    raiseDead:    { text: 'Monsters that fall near it get back up', where: 'died()' },
    rot:          { text: v => 'Its touch rots: a hero it hits can’t be healed for ' + v + ' rounds', where: 'ON_LANDED' },
    fireWeak:     { text: 'Fire does double damage to it', where: 'fireOn()' },
    fireImmune:   { text: 'Fire does nothing to it', where: 'fireOn(); the belt' },
    shell:        { text: 'A hard shell: arrows and bolts do half damage', where: 'ARMOUR' },
    amphibious:   { text: 'Water doesn’t slow it', where: 'monsterAct: moving' },
    lash:         { text: 'Its tongue reaches past the first hero to the one behind', where: 'monsterAct: attacking' },
    rises:        { text: 'Gets back up once, unless the blow was holy or a critical hit', where: 'attack: after the damage' },
    plate:        { text: v => 'Every hit on it does ' + v + ' less damage, but spells hit fully', where: 'ARMOUR' },
    disguise:     { text: 'Turns up as a treasure chest in the middle of the mat, and wakes when a hero comes close', where: 'spawnDue; monsterAct: dormant' },
    adhesive:     { text: 'Sticky: a hero it hits loses its next turn', where: 'ON_LANDED' },
    heated:       { text: 'Hot to the touch: heroes who hit it up close take fire damage', where: 'WHEN_STRUCK' },
    breath:       { text: 'Breathes fire down a whole row', where: 'BEFORE_ACT' },
    small:        { text: null, where: 'crowded battles: three can share a square' },
    fiend:        { text: null, where: 'holy water; the belt' }
  };
  function battle(s) { return BATTLE_BY_ID[s.battle] || makeBattle(s.battle) || BATTLES[0]; }
  function mapOf(s) { return MAP_BY_ID[battle(s).map]; }
  function cellAt(s, lane, sq) { const m = mapOf(s); return lane >= 0 && lane < m.h && sq >= 0 && sq < m.w ? m.rows[lane][sq] : ' '; }

  // the Cat & Mouse's own improvements, bought between battles with the takings; each felt in battle
  const TAVERN = {
    door: { max: 2 },     // a stouter door: one more life a level
    till: { max: 3 },     // a deeper till: 25 more gold to start, a level
    kitchen: { max: 2 },  // short rests heal three quarters of what was lost, then all of it
    training: { max: 2 }  // the first hero of each kind joins at level 2; then every hero does
  };
  function tavernOf(t) {
    const out = {};
    for (const k in TAVERN) out[k] = Math.max(0, Math.min(TAVERN[k].max, Math.floor((t && t[k]) || 0)));
    return out;
  }

  // opts: difficulty (easy, medium, hard, deadly; medium if left out), loadout (the heroes you can place; all of them if
  // left out) and tavern (the upgrades bought: door, till, kitchen, training; none if left out)
  function newGame(seed, battleId, opts) {
    opts = opts || {};
    const b = makeBattle(battleId) || BATTLES[0];
    if (b.seed != null) seed = b.seed; // a fixed battle rolls the same dice for everyone
    if (b.fixed || b.puzzle) opts = { difficulty: b.difficulty || 'medium', loadout: b.puzzle ? Object.keys(b.puzzle.heroes) : b.party };
    seed = (seed >>> 0) || 1;
    const dk = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'medium', D = DIFFICULTY[dk];
    const loadout = Array.isArray(opts.loadout) ? opts.loadout.filter(t => HEROES[t] && !HEROES[t].ally) : null;
    // Deadly stays deadly: the tavern's upgrades and the armoury stay behind, and only the cats come along
    const helped = dk !== 'deadly';
    const tv = tavernOf(helped ? opts.tavern : null);
    const lives = D.lives + tv.door;
    const items = {}; // one item per kind of hero, and only one it can carry
    if (helped) for (const t in (opts.items || {})) { const it = ITEMS[opts.items[t]]; if (it && it.for.indexOf(t) >= 0) items[t] = it.id; }
    const duty = opts.cats && (opts.cats.duty === 'simz' ? 'simz' : opts.cats.duty === 'mitz' ? 'mitz' : null);
    const powers = duty ? {} : null;
    if (duty) for (const k in POWERS) powers[k] = { every: POWERS[k].every[POWERS[k].cat === duty ? 1 : 0], ready: 1 + PREP_ROUNDS };
    const s = {
      v: 4, battle: b.id, seed, rng: seed, time: 0, now: 0, round: 0, nextRoundAt: 0,
      difficulty: dk, hpScale: D.hp, loadout: loadout && loadout.length ? loadout : null, tavern: tv, trained: {}, items, powers, duty,
      gold: Math.round(b.gold * D.gold / 5) * 5 + 25 * tv.till, lives, maxLives: lives, phase: 'running',
      wave: -1, waveActive: false, nextWaveRound: 1 + PREP_ROUNDS, pending: [],
      units: [], nextId: 1, events: [], ready: {},
      traps: [],
      stats: { kills: 0, leaks: 0, crits: 0, fumbles: 0, rolls: 0, placed: 0, fallen: 0, healed: 0, charges: 0, recalled: 0, levels: 0, raised: 0, pocketed: 0, sprung: 0 }
    };
    const fm = MAP_BY_ID[b.map];
    if (fm && fm.hatches) { s.opened = {}; s.warned = {}; }
    if (fm && fm.gate) s.gate = { used: false, until: 0 };
    if (b.puzzle) { s.free = Object.assign({}, b.puzzle.heroes); s.gold = b.puzzle.gold || 0; if (b.puzzle.lives) s.lives = s.maxLives = b.puzzle.lives; } // a puzzle's heroes cost nothing, and there are only so many
    else if (b.gold0 != null) s.gold = b.gold0;
    if (b.reverse) { s.purse = b.reverse.purse; s.bossSent = false; s.sent = 0; }
    if (helped && opts.belt && !b.fixed && !b.puzzle && !b.reverse) { // what's in the belt, as far as the pack knows it
      const belt = {}; let any = false;
      for (const k in THROWS) { const n = Math.max(0, Math.min(9, Math.floor(opts.belt[k] || 0))); if (n) { belt[k] = n; any = true; } }
      if (any) s.belt = belt;
    }
    return s;
  }

  function unitAt(s, lane, sq) {
    for (const u of s.units) if (u.alive && u.lane === lane && u.sq === sq) return u;
    return null;
  }
  function monsterAt(s, lane, sq) { const u = unitAt(s, lane, sq); return u && u.kind === 'monster' ? u : null; }
  // nothing solid between two squares of the same row (pillars and the edge of the mat block the view)
  function clearRow(s, lane, a, b) {
    const m = mapOf(s), lo = Math.min(a, b), hi = Math.max(a, b);
    for (let q = lo + 1; q < hi; q++) if (SIGHT_BLOCK.indexOf(m.rows[lane][q]) >= 0) return false;
    return true;
  }
  // the nearest monster ahead in a row (toward the dungeon) that a hero there can see
  function nearestAhead(s, lane, sq) {
    let best = null;
    for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && u.sq > sq && (!best || u.sq < best.sq) && seen(s, u)) best = u;
    return best && clearRow(s, lane, sq, best.sq) ? best : null;
  }
  // on a map whose way turns, a shooter can also see along its column, either way
  function clearCol(s, sq, a, b) {
    const m = mapOf(s), lo = Math.min(a, b), hi = Math.max(a, b);
    for (let l = lo + 1; l < hi; l++) if (SIGHT_BLOCK.indexOf(m.rows[l][sq]) >= 0) return false;
    return true;
  }
  function nearestInColumn(s, lane, sq) {
    let best = null;
    for (const u of s.units) if (u.alive && u.kind === 'monster' && u.sq === sq && u.lane !== lane && seen(s, u) && clearCol(s, sq, lane, u.lane) &&
      (!best || Math.abs(u.lane - lane) < Math.abs(best.lane - lane) || (Math.abs(u.lane - lane) === Math.abs(best.lane - lane) && u.id < best.id))) best = u;
    return best;
  }
  // an invisible monster can only be targeted near light: a Cleric, a Paladin, a holy water font or holy ground
  // how far a unit's light reaches: a hero always sees what is right next to it
  function lightOf(h) { const st = HEROES[h.type]; return st && st.light ? st.light + (h.path === 'lanternbearer' ? 2 : 0) : (st && !st.inert && !h.petrified ? 1 : 0); }
  function seen(s, m) {
    if (m.dormant) return false; // a mimic passing for a treasure chest
    if (!traits(m).invisible) return true;
    if (cellAt(s, m.lane, m.sq) === '+') return true;
    for (const h of s.units) if (h.alive && h.kind === 'hero' && !h.inside && lightOf(h) && within(h, m, lightOf(h))) return true;
    return false;
  }
  function seenAt(s, lane, sq) { const m = monsterAt(s, lane, sq); return m && seen(s, m) ? m : null; }
  const isObject = u => u.kind === 'hero' && (HEROES[u.type].inert || u.petrified);
  function trapAt(s, lane, sq) { for (const tp of s.traps) if (tp.lane === lane && tp.sq === sq) return tp; return null; }
  // where a monster goes next: a square, the tavern (exit), or nowhere
  function stepOf(s, u) {
    const m = mapOf(s), t = traits(u), src = gateShut(s) ? m.shut : m;
    const nx = (t.flying ? src.nextFly : t.amphibious ? src.nextSwim : src.nextWalk)[u.lane][u.sq];
    if (!m.forks || !nx || nx.exit) return nx;
    return forkStep(s, u, t.flying ? src.fields.fly : t.amphibious ? src.fields.swim : src.fields.walk, nx);
  }
  // the hero a monster can hit: whoever stands on the square it wants, or the nearest hero ahead in its row within reach
  function heroInReach(s, m, range) {
    const nx = stepOf(s, m);
    let best = null;
    if (nx && !nx.exit) { const u = unitAt(s, nx.lane, nx.sq); if (u && u.kind === 'hero') best = u; }
    for (const u of s.units) {
      if (!u.alive || u.kind !== 'hero' || u.lane !== m.lane || u.sq >= m.sq || m.sq - u.sq > range) continue;
      if (!clearRow(s, m.lane, u.sq, m.sq)) continue;
      if (!best || (best.lane === m.lane && u.sq > best.sq)) best = u;
    }
    return best;
  }
  function free(s, lane, sq) {
    const m = mapOf(s);
    return lane >= 0 && lane < m.h && sq >= 1 && sq < m.w && PASS_WALK.indexOf(m.rows[lane][sq]) >= 0 && !unitAt(s, lane, sq) && !(m.rows[lane][sq] === 'G' && gateShut(s));
  }

  function addUnit(s, kind, type, lane, sq) {
    const st = kind === 'hero' ? HEROES[type] : MONSTERS[type];
    const u = { id: s.nextId++, kind, type, lane, sq, hp: st.hp, maxHp: st.hp, ac: st.ac,
      init: d(s, 20) + st.init, acc: 0, turns: 0, charge: 0, actAt: 0, actedRound: 0, alive: true,
      status: {}, hopped: false, split: false, minor: false, made: 0 };
    if (kind === 'hero') { u.level = 1; u.path = null; u.spent = 0; carry(s, u); }
    else if (s.hpScale && s.hpScale !== 1) u.hp = u.maxHp = Math.max(1, Math.round(st.hp * s.hpScale));
    const roundStart = s.nextRoundAt - ROUND;
    u.actAt = roundStart + slot(u.init) * ROUND;
    u.actedRound = (s.round > 0 && u.actAt > s.now) ? s.round - 1 : s.round;
    s.units.push(u);
    return u;
  }

  // the item a hero of this kind carries into battle; the Tinker's ammunition goes to her ballista
  function itemOf(s, type) {
    if (!s.items) return null;
    const ally = HEROES[type] && HEROES[type].ally, owner = type === 'ballista' ? 'tinker' : type, it = ITEMS[s.items[owner]];
    if (!it || (ally && it.ally !== type) || (!ally && it.ally)) return null;
    return it;
  }
  function carry(s, u) {
    const it = itemOf(s, u.type); if (!it) return;
    u.item = it.id;
    if (it.ac) u.ac += it.ac;
    if (it.hp) { const extra = Math.ceil(HEROES[u.type].hp * it.hp); u.hp += extra; u.maxHp += extra; }
  }
  const itemBonus = (u, k) => (u.item && ITEMS[u.item][k]) || 0;

  /* Statuses: timed conditions on any unit, counted in the owner's own turns. */
  const STATUSES = {
    paralysed: { bad: true, word: 'PARALYSED' }, // loses its next turn
    slowed:    { bad: true, word: 'SLOWED' },    // moves at half speed
    poisoned:  { bad: true, word: 'POISONED' },  // 1d4 poison damage at the start of each turn
    frightened:{ bad: true, word: 'FRIGHTENED' }, // backs away a square instead of acting
    burnt:     { bad: true, word: 'BURNING' },    // a troll cannot regenerate while burning
    seared:    { bad: true, word: 'SEARED' },     // nor a vampire after radiant light
    charmed:   { bad: true, word: 'CHARMED' },    // turns on the heroes next to it
    rotting:   { bad: true, word: 'ROTTING' },    // a mummy's touch: no healing until it passes
    stuck:     { bad: true, word: 'STUCK' },      // stuck to a mimic: loses its next turn
    aflame:    { bad: true, word: 'ALIGHT' },     // alchemist's fire: 1d4 fire at the start of each turn
    netted:    { bad: true, word: 'NETTED' },     // can't move, though it can still strike
    prone:     { bad: true, word: 'DOWN' }        // slipped on ball bearings: loses its next turn
  };
  function hasStatus(u, k) { return (u.status[k] || 0) > 0; }
  function addStatus(s, u, k, turns, from) {
    if (!STATUSES[k]) throw new Error('Hold the Line: unknown status ' + k);
    u.status[k] = Math.max(u.status[k] || 0, turns);
    emit(s, { type: 'status', id: u.id, status: k, turns, from: from ? from.id : 0 });
  }
  function clearBad(u) { let any = false; for (const k in u.status) if (STATUSES[k] && STATUSES[k].bad && u.status[k] > 0) { u.status[k] = 0; any = true; } return any; }
  // the start of a unit's own turn: poison bites, slows take hold, paralysis costs the turn
  function statusStart(s, u) {
    const st = u.status;
    u.slowNow = (st.slowed || 0) > 0;
    if (u.slowNow) st.slowed--;
    if ((st.poisoned || 0) > 0) {
      st.poisoned--;
      const dmg = dice(s, 1, 4), killed = hurt(u, dmg);
      emit(s, { type: 'poison', id: u.id, dmg, killed });
      if (killed) { died(s, u, null); return true; }
    }
    if ((st.burnt || 0) > 0) st.burnt--;
    if ((st.rotting || 0) > 0) st.rotting--;
    if ((st.aflame || 0) > 0) {
      st.aflame--;
      const dmg = fireOn(u, dice(s, 1, 4)), killed = dmg > 0 ? hurt(u, dmg) : false;
      emit(s, { type: 'flames', id: u.id, dmg, killed });
      if (killed) { died(s, u, null); return true; }
      if (dmg && traits(u).fireStops) addStatus(s, u, 'burnt', 1);
    }
    if ((st.netted || 0) > 0) { st.netted--; u.netNow = true; } else if (u.netNow) u.netNow = false;
    if ((st.prone || 0) > 0) { st.prone--; emit(s, { type: 'stunned', id: u.id, prone: true }); return true; }
    if ((st.stuck || 0) > 0) { st.stuck--; emit(s, { type: 'stunned', id: u.id, stuck: true }); return true; }
    if ((st.seared || 0) > 0) st.seared--;
    if ((st.paralysed || 0) > 0) { st.paralysed--; emit(s, { type: 'stunned', id: u.id }); return true; }
    if ((st.charmed || 0) > 0) { // a charmed hero swings at a friend next to it, if it can
      st.charmed--;
      const base = HEROES[u.type] && HEROES[u.type].attack;
      const friend = s.units.filter(h => h.alive && h.kind === 'hero' && h !== u && !h.inside && near(h, u)).sort((a, b) => a.id - b.id)[0];
      emit(s, { type: 'charmed', id: u.id, to: friend ? friend.id : 0 });
      if (friend && base) attack(s, u, friend, heroAttack(u, base));
      return true;
    }
    if ((st.frightened || 0) > 0) {
      st.frightened--;
      const from = u.sq, to = backOff(s, u);
      if (to != null) u.sq = to;
      emit(s, { type: 'flee', id: u.id, from, to: u.sq, lane: u.lane });
      return true;
    }
    return false;
  }
  // the square behind a monster, back toward its door, if there is room to step into it
  function backOff(s, m) {
    const q = m.sq + 1, cell = cellAt(s, m.lane, q);
    if (unitAt(s, m.lane, q)) return null;
    return (traits(m).flying ? PASS_FLY : PASS_WALK).indexOf(cell) >= 0 ? q : null;
  }
  const within = (a, b, r) => Math.abs(a.lane - b.lane) <= r && Math.abs(a.sq - b.sq) <= r;
  // a hero's weapon at its level: +1 to hit and +1 damage for each level past the first
  function heroAttack(u, base) {
    const lv = (u.level || 1) - 1, hit = itemBonus(u, 'hit'), dmg = itemBonus(u, 'dmg');
    return lv || hit || dmg ? Object.assign({}, base, { bonus: base.bonus + lv + hit, mod: base.mod + lv + dmg }) : base;
  }

  function startRound(s) {
    const roundStart = s.nextRoundAt;
    s.round++; s.nextRoundAt += ROUND; s.now = roundStart;
    for (const u of s.units) if (u.alive) u.actAt = roundStart + slot(u.init) * ROUND;
    emit(s, { type: 'round', round: s.round });
    if (s.phase !== 'running') return;
    if (s.round === 1) emit(s, { type: 'incoming', rounds: PREP_ROUNDS, battle: s.battle });
    if (!s.waveActive && s.round >= s.nextWaveRound && s.wave < lastWave(battle(s))) beginWave(s);
    if (s.traps.length) for (const tp of s.traps.slice()) if (tp.until != null && s.round > tp.until) { s.traps.splice(s.traps.indexOf(tp), 1); emit(s, { type: 'trapGone', id: tp.id }); } // ball bearings get swept up
    spawnDue(s);
    const mp = mapOf(s);
    if (mp.hatches) for (const p of s.pending) if (p.round === s.round + 1 && hatchShut(s, p.door) && !s.warned[p.door]) {
      s.warned[p.door] = true; emit(s, { type: 'hatchWarn', door: p.door, lane: mp.doors[p.door].lane, sq: mp.doors[p.door].sq });
    }
    if (s.gate && s.gate.until && s.round >= s.gate.until) { s.gate.until = 0; for (const u of s.units) u.fork = null; emit(s, { type: 'gate', shut: false }); }
    if (mp.oven && s.phase === 'running') ovens(s);
    if (mp.chutes && s.phase === 'running') barrels(s);
    if (s.waveActive && !s.pending.length && s.arrived != null && s.round - s.arrived > PATIENCE) restless(s);
    const rv = battle(s).reverse;
    if (rv && s.phase === 'running') reverseRound(s, rv);
  }
  /* ---------- Reverse: you send the monsters, and Simz keeps the tavern ----------
     A reverse battle has reverse: { pool, boss, purse, income, rounds }. Each monster costs from your purse, which fills
     every round; Simz places heroes every round with the gold the battle gives him. Take every life before the rounds
     run out and the tavern falls; once they are up, the last of your monsters still get their chance. */
  const SEND = { base: 15, level: 10, boss: 20 }; // so a stream of the cheapest is not the answer: a crowd at the right door is
  function sendCost(t) { const m = MONSTERS[t]; return m.traits.boss ? m.level * SEND.boss : SEND.base + m.level * SEND.level; }
  function canSend(s, type) {
    const rv = battle(s).reverse;
    if (!rv || s.purse == null) return 'none';
    if (s.phase !== 'running') return 'over';
    if (s.round > rv.rounds) return 'closed';
    if (rv.pool.indexOf(type) < 0 && rv.boss !== type) return 'unknown';
    if (type === rv.boss && s.bossSent) return 'once';
    if (s.purse < sendCost(type)) return 'purse';
    return null;
  }
  function send(s, type, door) {
    const why = canSend(s, type);
    if (why) return why;
    if (!mapOf(s).doors[door]) return 'door';
    s.now = s.time;
    s.purse -= sendCost(type);
    if (type === battle(s).reverse.boss) s.bossSent = true;
    s.pending.push({ round: s.round + 1, type, door, pool: [door] });
    s.sent = (s.sent || 0) + 1;
    emit(s, { type: 'send', unitType: type, door, purse: s.purse });
    return null;
  }
  function reverseRound(s, rv) {
    if (s.round > 1) s.purse += rv.income;
    autoplay(s); // Simz keeps the tavern, every round, with whatever gold he has
    if (s.round > rv.rounds && !s.pending.length && !s.units.some(u => u.alive && u.kind === 'monster')) {
      s.phase = 'won'; emit(s, { type: 'victory', battle: battle(s).id });
    }
  }
  /* In the modes a wave cannot last for ever. Long after the last monster came up the steps, the one nearest the tavern
     loses interest in the heroes and walks in, a round at a time, so a stand-off always ends (and costs a life).
     The campaign's battles keep their own rules, so their old replays still play out exactly. */
  const PATIENCE = 50;
  function restless(s) {
    let u = null;
    for (const m of s.units) if (m.alive && m.kind === 'monster' && (!u || m.sq < u.sq || (m.sq === u.sq && m.id < u.id))) u = m;
    if (u) { emit(s, { type: 'restless', id: u.id }); leak(s, u); }
  }

  /* ---------- Phase 7: what the rest of the house throws at you ---------- */
  // a hatch is floor you can stand on until the first monster comes up through it; then it is a door
  // a square in daylight: on or next to a skylight that has been broken open
  function sunlit(s, lane, sq) {
    const m = mapOf(s);
    return !!(m.skylights && s.opened && m.doors.some((d, i) => m.hatches[i] && s.opened[i] && Math.abs(d.lane - lane) <= 1 && Math.abs(d.sq - sq) <= 1));
  }
  const hatchShut = (s, i) => { const m = mapOf(s); return !!(m.hatches && m.hatches[i] && !(s.opened && s.opened[i])); };
  function openHatch(s, i) {
    const m = mapOf(s), dr = m.doors[i];
    s.opened[i] = true;
    emit(s, { type: 'hatch', door: i, lane: dr.lane, sq: dr.sq });
    const u = unitAt(s, dr.lane, dr.sq);
    if (!u) return;
    for (const [dl, dq] of STEPS) { // whoever stood on it is thrown aside onto the nearest free square, and loses a turn
      const l = dr.lane + dl, q = dr.sq + dq;
      if (!placeable(s, l, q) || m.rows[l][q] === 'H' || unitAt(s, l, q)) continue;
      const fromLane = u.lane, from = u.sq; u.lane = l; u.sq = q;
      emit(s, { type: 'shove', id: u.id, fromLane, from, lane: l, to: q });
      if (!isObject(u)) addStatus(s, u, 'prone', 1);
      return;
    }
  }
  // ovens flare every few rounds and burn whatever stands on the squares in front of them; the round before, they glow
  function ovens(s) {
    const ov = mapOf(s).oven, r = s.round - ov.first;
    if (r + 1 >= 0 && (r + 1) % ov.every === 0) emit(s, { type: 'ovenWarn' });
    if (r < 0 || r % ov.every) return;
    emit(s, { type: 'flare' });
    const hot = new Set(ov.hot.map(h => h.lane * 100 + h.sq)), rolled = dice(s, ov.n, ov.d);
    for (const u of s.units.slice().sort((a, b) => a.id - b.id)) {
      if (!u.alive || u.inside || isObject(u) || !hot.has(u.lane * 100 + u.sq)) continue;
      const saved = d(s, 20) + (u.kind === 'monster' ? MONSTERS[u.type].dexSave : 2) >= ov.dc;
      const dmg = fireOn(u, saved ? Math.floor(rolled / 2) : rolled), killed = dmg > 0 ? hurt(u, dmg) : false;
      emit(s, { type: 'scorch', to: u.id, dmg, saved, killed });
      if (killed) { died(s, u, null); if (s.phase !== 'running') return; continue; }
      if (u.kind === 'monster') { if (traits(u).fireStops) addStatus(s, u, 'burnt', 1); for (const hook of ON_HURT) hook(s, u); }
    }
  }
  // a barrel rolls down a chute from the far end of its row to the tavern, bowling over anything in the way, heroes and
  // monsters alike (a Dex save jumps clear); something big, or a barricade, stops it dead
  const bulky = u => u.kind === 'monster' ? !!(traits(u).boss || MONSTERS[u.type].hp >= 45) : !!(HEROES[u.type].inert || HEROES[u.type].defender);
  function barrels(s) {
    const m = mapOf(s), ch = m.chutes, r = s.round - ch.first, lane = ch.lanes[(s.barrels || 0) % ch.lanes.length];
    if (r + 1 >= 0 && (r + 1) % ch.every === 0) emit(s, { type: 'barrelWarn', lane });
    if (r < 0 || r % ch.every) return;
    s.barrels = (s.barrels || 0) + 1;
    let q = m.w - 1;
    while (q > 0 && PASS_WALK.indexOf(m.rows[lane][q]) < 0) q--;
    const from = q, hits = [];
    let to = -1, stop = 0;
    for (; q >= 0 && !stop; q--) {
      if (PASS_WALK.indexOf(m.rows[lane][q]) < 0) { to = q + 1; stop = -1; break; }
      for (const u of s.units.filter(v => v.alive && !v.inside && v.lane === lane && v.sq === q).sort((a, b) => a.id - b.id)) {
        if (bulky(u)) {
          const dmg = dice(s, 2, 6), killed = hurt(u, dmg);
          hits.push({ id: u.id, kind: u.kind, sq: q, dmg, killed, big: true }); if (killed) died(s, u, null);
          to = q; stop = u.id; break;
        }
        const saved = d(s, 20) + (u.kind === 'monster' ? MONSTERS[u.type].dexSave : 2) >= ch.dc;
        if (saved) { hits.push({ id: u.id, kind: u.kind, sq: q, dmg: 0, saved: true }); continue; }
        const dmg = dice(s, ch.n, ch.d), killed = hurt(u, dmg);
        hits.push({ id: u.id, kind: u.kind, sq: q, dmg, killed });
        if (killed) died(s, u, null); else addStatus(s, u, 'prone', 1);
        if (s.phase !== 'running') break;
      }
    }
    const downed = hits.filter(h => !h.saved && !h.big && h.kind === 'monster').length;
    emit(s, { type: 'barrel', lane, from, to: stop ? to : -1, hits, stop, downed });
    s.stats.bowled = (s.stats.bowled || 0) + downed;
  }
  // the yard gate: dropped once a battle, it shuts its way for a few rounds and everything goes round the other way
  const gateShut = s => !!(s.gate && s.gate.until);
  function canShutGate(s) {
    const m = mapOf(s);
    if (!m.gate || !s.gate) return 'none';
    if (s.phase !== 'running') return 'over';
    if (s.gate.used) return 'used';
    for (const u of s.units) if (u.alive && m.rows[u.lane][u.sq] === 'G') return 'blocked';
    return null;
  }
  function shutGate(s) {
    const why = canShutGate(s);
    if (why) return why;
    s.gate.used = true; s.gate.until = s.round + mapOf(s).gate.rounds;
    for (const u of s.units) u.fork = null;
    emit(s, { type: 'gate', shut: true, until: s.gate.until });
    return null;
  }
  // where the way splits with nothing between the two, a monster takes the way the heroes cover least
  function covers(s, h, sq) {
    const at = HEROES[h.type].targeting, dl = Math.abs(h.lane - sq.lane), dq = Math.abs(h.sq - sq.sq);
    if (dl + dq <= 1) return true;
    if (at !== 'lane' && at !== 'lanes') return false;
    return (h.lane === sq.lane && sq.sq > h.sq && clearRow(s, h.lane, h.sq, sq.sq)) || (h.sq === sq.sq && clearCol(s, h.sq, h.lane, sq.lane));
  }
  function danger(s, f, start) {
    const path = [];
    for (let p = start, n = 0; p && !p.exit && n < 40; p = f.next[p.lane][p.sq], n++) path.push(p);
    let total = 0;
    for (const h of s.units) {
      if (!h.alive || h.kind !== 'hero' || h.inside || isObject(h) || !path.some(p => covers(s, h, p))) continue;
      const a = HEROES[h.type].attack;
      total += (a ? a.n * (a.d + 1) / 2 + (a.mod || 0) : 2) * (1 + 0.5 * ((h.level || 1) - 1)) + (path.some(p => p.lane === h.lane && p.sq === h.sq) ? 4 : 0);
    }
    return total;
  }
  function forkStep(s, u, f, nx) {
    const m = mapOf(s), key = u.lane * 100 + u.sq + (gateShut(s) ? 0.5 : 0);
    if (u.fork && u.fork.at === key) return u.fork.to;
    const here = f.dist[u.lane][u.sq], opts = [];
    for (const [dl, dq] of STEPS) {
      const l = u.lane + dl, q = u.sq + dq;
      if (l < 0 || l >= m.h || q < 0 || q >= m.w || !isFinite(f.dist[l][q])) continue;
      if (Math.abs(f.cost(l, q) + f.dist[l][q] - here) < 1e-9) opts.push({ lane: l, sq: q });
    }
    if (opts.length < 2) return nx;
    const dg = opts.map(o => danger(s, f, o)), low = Math.min(...dg), best = opts.filter((o, i) => dg[i] <= low + 1e-9);
    const to = best[u.id % best.length];
    u.fork = { at: key, to };
    if (opts.length > 1) emit(s, { type: 'fork', id: u.id, lane: to.lane, sq: to.sq });
    return to;
  }

  function doorPool(s, w) { return w.doors ? w.doors.slice() : mapOf(s).doors.map((_, i) => i).filter(i => !hatchShut(s, i)); }

  function beginWave(s) {
    const b = battle(s);
    s.wave++; s.waveActive = true;
    const w = waveOf(b, s.wave), pool = doorPool(s, w);
    const used = {};
    for (const sp of w.parsed) for (let k = 0; k < sp.count; k++) {
      const r = s.round + sp.at;
      const taken = used[r] || (used[r] = []);
      let door = sp.door;
      if (door == null) {
        let open = pool.filter(i => taken.indexOf(i) < 0);
        if (!open.length) open = pool.slice();
        door = open[Math.floor(rnd(s) * open.length)];
      }
      taken.push(door);
      const due = { round: r, type: sp.type, door, pool };
      if (w.hp && w.hp !== 1) due.hp = w.hp; // later endless waves send tougher monsters
      s.pending.push(due);
    }
    emit(s, { type: 'wave', index: s.wave, total: b.endless ? 0 : b.waves.length, name: w.name, by: w.by, line: w.line });
  }

  function spawnDue(s) {
    const m = mapOf(s), keep = [];
    for (const p of s.pending) {
      if (p.round > s.round) { keep.push(p); continue; }
      if (hatchShut(s, p.door)) openHatch(s, p.door);
      let door = m.doors[p.door];
      if (unitAt(s, door.lane, door.sq) && !crowdOK(s, p.type, door.lane, door.sq)) {
        const open = p.pool.filter(i => !unitAt(s, m.doors[i].lane, m.doors[i].sq) || crowdOK(s, p.type, m.doors[i].lane, m.doors[i].sq));
        if (open.length) door = m.doors[open[Math.floor(rnd(s) * open.length)]];
        else {
          // a hero still on a hatch that couldn't throw him clear: whatever comes up comes up beside him instead of waiting for ever
          const by = unitAt(s, door.lane, door.sq);
          let beside = null, bd = Infinity; // the nearest free square, however crowded it is round the hatch
          if (by && by.kind === 'hero') for (let l = 0; l < m.h; l++) for (let q = 1; q < m.w; q++) {
            const d2 = Math.abs(l - door.lane) + Math.abs(q - door.sq);
            if (d2 < bd && free(s, l, q)) { bd = d2; beside = { lane: l, sq: q }; }
          }
          if (!beside) { p.round = s.round + 1; keep.push(p); continue; }
          door = beside;
        }
      }
      let at = door;
      if (MONSTERS[p.type].traits.disguise) { // it turns up as a treasure chest, out in the middle of the mat
        const m2 = mapOf(s), spots = [];
        for (let l = 0; l < m2.h; l++) for (let q = 3; q < m2.w - 3; q++) if (placeable(s, l, q) && !unitAt(s, l, q) && !trapAt(s, l, q)) spots.push({ lane: l, sq: q });
        if (spots.length) at = spots[Math.floor(rnd(s) * spots.length)];
      }
      const u = addUnit(s, 'monster', p.type, at.lane, at.sq);
      if (at !== door) u.dormant = s.round + 2;
      if (battle(s).mode || mapOf(s).turns || battle(s).stage === 2) s.arrived = s.round; // the stand-off rule: the modes, the new shapes of cellar, and the house
      if (p.hp) u.hp = u.maxHp = Math.max(1, Math.round(u.maxHp * p.hp));
      if (p.carry) Object.assign(u, p.carry); // back up from under the lawn, as hurt as it went down
      u.actedRound = s.round; // dropped onto the mat this round, acts from next round
      emit(s, { type: 'spawn', id: u.id, kind: 'monster', unitType: u.type, lane: u.lane, sq: u.sq, hp: u.hp, maxHp: u.maxHp, how: p.carry ? 'surface' : u.dormant ? 'disguised' : 'arrive' });
    }
    s.pending = keep;
  }

  function step(s, dt) {
    const end = s.time + dt;
    while (s.phase === 'running' && s.nextRoundAt <= end + 1e-9) { // once the battle is over the clock runs on for the animations only
      processDue(s, s.nextRoundAt - 1e-6);
      s.time = s.nextRoundAt;
      startRound(s);
    }
    s.time = end;
    processDue(s, end);
    s.now = s.time;
    checkWave(s);
    let dead = false;
    for (const u of s.units) if (!u.alive) { dead = true; break; }
    if (dead) s.units = s.units.filter(u => u.alive);
  }

  function processDue(s, t) {
    if (s.phase !== 'running') return;
    for (;;) {
      let next = null;
      for (const u of s.units) {
        if (!u.alive || u.actedRound >= s.round || u.actAt > t + 1e-9) continue;
        if (!next || u.actAt < next.actAt || (u.actAt === next.actAt && u.id < next.id)) next = u;
      }
      if (!next) return;
      next.actedRound = s.round;
      s.now = next.actAt;
      if (next.kind === 'hero') heroAct(s, next); else monsterAct(s, next);
      if (s.phase !== 'running') return;
    }
  }

  function heroAct(s, u) {
    const st = HEROES[u.type], lv = u.level - 1;
    if (st.inert || u.petrified) return;
    if (u.inside) { // inside a gelatinous cube: the acid burns, and there is nothing to do but wait
      const cube = s.units.find(c => c.id === u.inside), en = cube && traits(cube).engulf;
      const dmg = en ? dice(s, en.n, en.d) : 0, killed = dmg ? hurt(u, dmg) : false;
      emit(s, { type: 'acid', id: u.id, by: u.inside, dmg, killed });
      if (killed) { if (cube) cube.holding = 0; died(s, u, cube); }
      return;
    }
    if (statusStart(s, u)) return;
    if (st.builds && tinker(s, u, st)) return;
    if (st.wildShape && !u.shaped && (seenAt(s, u.lane, u.sq + 1) || seenAt(s, u.lane, u.sq - 1))) { // Wild Shape, once a battle
      u.shaped = true; u.form = 'bear'; u.tempHp = st.wildShape.hp + lv * 5;
      emit(s, { type: 'shape', id: u.id, form: 'bear', tempHp: u.tempHp });
      return;
    }
    if (st.income) {
      u.turns++;
      if (u.turns % st.income.every === 0) {
        let gold = st.income.gold + lv * 5;
        if (u.path === 'coinsinger') gold = Math.round(gold * 1.5);
        if (itemBonus(u, 'income')) gold = Math.round(gold * (1 + itemBonus(u, 'income')));
        s.gold += gold; emit(s, { type: 'income', id: u.id, amount: gold });
      }
      return;
    }
    if (u.path === 'houndmaster' && callHound(s, u)) return;
    if (st.heal) {
      const hl = lv ? Object.assign({}, st.heal, { mod: st.heal.mod + lv }) : st.heal;
      const first = healNear(s, u, hl, null);
      if (first) { if (u.path === 'life') healNear(s, u, hl, first); return; }
    }
    if (st.targeting === 'charge' && !u.blocker) { charge(s, u, st); return; }
    const bear = u.form === 'bear';
    let target;
    if (st.targeting === 'adjacent' || u.blocker || bear) {
      target = seenAt(s, u.lane, u.sq + 1) || seenAt(s, u.lane, u.sq - 1);
      if (!target && mapOf(s).turns) target = seenAt(s, u.lane - 1, u.sq) || seenAt(s, u.lane + 1, u.sq); // where the way bends, up and down as well
    }
    else if (st.targeting === 'around') target = bestAround(s, u);
    else {
      target = nearestAhead(s, u.lane, u.sq);
      if (!target && st.targeting === 'lanes') {
        const l = nearestAhead(s, u.lane - 1, u.sq), r = nearestAhead(s, u.lane + 1, u.sq);
        target = !l ? r : !r ? l : (r.sq < l.sq ? r : l);
      }
      if (!target && mapOf(s).turns) target = nearestInColumn(s, u.lane, u.sq); // where the way turns, up and down the column too
    }
    if (!target) return;
    if (st.entangle && !bear) {
      u.charge++;
      if (u.charge >= (u.path === 'land' ? 2 : st.entangle.every)) { u.charge = 0; entangle(s, u, target, st.entangle, lv); return; }
    }
    if (st.spell) {
      u.charge++;
      if (u.charge >= (u.path === 'evoker' ? 2 : st.spell.every)) {
        u.charge = 0;
        fireball(s, u, target, lv ? Object.assign({}, st.spell, { dc: st.spell.dc + lv }) : st.spell);
        return;
      }
    }
    let atk = heroAttack(u, u.blocker ? BLOCKER_AXE : bear ? st.wildShape.attack : st.attack);
    if (st.sneak && flanked(s, target, u)) atk = Object.assign({}, atk, { extra: [st.sneak.n, st.sneak.d], sneak: true });
    if (u.path === 'fiend') atk = Object.assign({}, atk, { extra: [1, 10] });
    if (u.path === 'stormcaller') atk = Object.assign({}, atk, { extra: [1, 6] });
    if (u.heavy) atk = Object.assign({}, atk, { n: 3 });
    if (st.flurry) { // Monk: two blows (three on the Windstep), the first a Stunning Strike when it is ready
      u.turns++;
      const blows = u.path === 'windstep' ? 3 : st.flurry, stunNow = u.path === 'openhand' || u.turns % st.stun.every === 1;
      for (let i = 0; i < blows && target.alive; i++) {
        const r = attack(s, u, target, atk);
        if (i === 0 && stunNow && r.wound) stunningStrike(s, u, target, st.stun.dc + lv);
      }
      return;
    }
    attack(s, u, target, atk);
    if (st.chain) { // Sorcerer: the lightning jumps to the nearest monster in a row either side
      const hit = [target];
      let last = target;
      for (let j = 0; j < (u.path === 'draconic' ? 3 : st.chain.jumps); j++) {
        let next = null, bd = Infinity;
        for (const m of s.units) {
          if (!m.alive || m.kind !== 'monster' || hit.indexOf(m) >= 0 || Math.abs(m.lane - last.lane) !== 1 || Math.abs(m.sq - last.sq) > st.chain.reach || !seen(s, m)) continue;
          const dd = Math.abs(m.sq - last.sq) * 10 + m.id / 1e6;
          if (dd < bd) { bd = dd; next = m; }
        }
        if (!next) break;
        emit(s, { type: 'jump', from: u.id, a: last.id, b: next.id });
        attack(s, u, next, atk); hit.push(next); last = next;
      }
    }
    if (u.path === 'hunter') { // Volley: on to the next monster behind the first
      let next = null;
      for (const m of s.units) if (m.alive && m.kind === 'monster' && m.lane === target.lane && m.sq > target.sq && (!next || m.sq < next.sq) && seen(s, m)) next = m;
      if (next && clearRow(s, next.lane, u.sq, next.sq)) attack(s, u, next, atk);
    }
    if (u.path === 'dawnkeeper') { // Sacred Flame on everything round the target too
      const round = s.units.filter(m => m.alive && m.kind === 'monster' && m !== target && near(m, target) && seen(s, m)).sort((a, b) => a.id - b.id);
      for (const m of round) if (m.alive) attack(s, u, m, atk);
    }
  }
  const BLOCKER_AXE = { name: 'Greataxe', bonus: 6, n: 1, d: 12, mod: 4, kind: 'melee', fx: 'smash' };

  // Monk: a Constitution save, or the monster loses its next turn
  function stunningStrike(s, u, t, dc) {
    if (!t.alive || hasStatus(t, 'paralysed')) return;
    const roll = d(s, 20) + (traits(t).boss ? 5 : 0);
    if (roll < dc) addStatus(s, t, 'paralysed', 1, u);
  }
  // Druid: everything in the 3 × 3 round the target saves or is slowed; the Thornwarden's thorns bite as well
  function entangle(s, u, center, en, lv) {
    emit(s, { type: 'entangle', from: u.id, lane: center.lane, sq: center.sq });
    const caught = s.units.filter(m => m.alive && m.kind === 'monster' && near(m, center)).sort((a, b) => a.id - b.id);
    for (const m of caught) {
      if (u.path === 'thornwarden') {
        const dmg = dice(s, 1, 6), killed = hurt(m, dmg);
        emit(s, { type: 'thorns', from: u.id, id: m.id, dmg, killed });
        if (killed) { died(s, m, u); continue; }
      }
      const roll = d(s, 20) + MONSTERS[m.type].dexSave;
      if (roll < en.dc + lv) addStatus(s, m, 'slowed', en.turns, u);
    }
  }
  // Tinker: a ballista in front if there is none, a spring trap ahead on its trap turns, otherwise the crossbow
  function tinker(s, u, st) {
    u.turns++;
    const mine = s.units.some(b => b.alive && b.type === 'ballista' && b.owner === u.id);
    if (!mine && s.round >= (u.ballistaAt || 0) && placeable(s, u.lane, u.sq + 1) && !unitAt(s, u.lane, u.sq + 1) && !trapAt(s, u.lane, u.sq + 1)) {
      const b = addUnit(s, 'hero', 'ballista', u.lane, u.sq + 1);
      b.owner = u.id; b.actedRound = s.round;
      if (u.path === 'siegewright') { b.heavy = true; b.hp = b.maxHp = b.maxHp * 2; }
      emit(s, { type: 'spawn', id: b.id, kind: 'hero', unitType: 'ballista', lane: b.lane, sq: b.sq, hp: b.hp, maxHp: b.maxHp, how: 'build', from: u.id });
      return true;
    }
    if (u.turns % (u.path === 'trapwright' ? 2 : st.builds.trap) !== 0) return false;
    const m = mapOf(s);
    for (let q = u.sq + 2; q < m.w; q++) {
      const cell = m.rows[u.lane][q];
      if (SIGHT_BLOCK.indexOf(cell) >= 0) break;
      if (PLACEABLE.indexOf(cell) < 0 || unitAt(s, u.lane, q) || trapAt(s, u.lane, q)) continue;
      layTrap(s, 'spring', u.lane, q, u);
      return true;
    }
    return false;
  }
  const TRAPS = { spring: { uses: 1, n: 2, d: 6, slow: 1 }, bearings: { uses: 99, n: 0, d: 0, dc: 10, prone: true } };
  // in a crowded battle, small monsters squeeze up to three to a square; anything else still needs it to itself
  function crowdOK(s, type, lane, sq) {
    if (!battle(s).crowds || !MONSTERS[type] || !MONSTERS[type].traits.small) return false;
    let n = 0;
    for (const v of s.units) if (v.alive && v.lane === lane && v.sq === sq) { if (v.kind !== 'monster' || !traits(v).small) return false; n++; }
    return n < CROWD;
  }
  /* ---------- the belt: thrown onto one square, hitting everything piled there; one throw a round ---------- */
  function canThrow(s, kind, lane, sq) {
    if (!s.belt || !THROWS[kind]) return 'none';
    if (s.phase !== 'running') return 'over';
    if (!(s.belt[kind] > 0)) return 'empty';
    if (s.thrownRound === s.round) return 'once';
    const m = mapOf(s);
    if (lane < 0 || lane >= m.h || sq < 0 || sq >= m.w || PASS_FLY.indexOf(m.rows[lane][sq]) < 0) return 'off';
    if (!THROWS[kind].bearings && !s.units.some(u => u.alive && u.kind === 'monster' && u.lane === lane && u.sq === sq && !u.dormant)) return 'target';
    if (THROWS[kind].bearings && (unitAt(s, lane, sq) || trapAt(s, lane, sq))) return 'occupied';
    return null;
  }
  function throwItem(s, kind, lane, sq) {
    const why = canThrow(s, kind, lane, sq);
    if (why) return why;
    const th = THROWS[kind];
    s.now = s.time; s.belt[kind]--; s.thrownRound = s.round;
    s.thrown = s.thrown || {}; s.thrown[kind] = (s.thrown[kind] || 0) + 1;
    emit(s, { type: 'throw', kind, lane, sq, left: s.belt[kind] });
    if (th.bearings) { const tp = layTrap(s, 'bearings', lane, sq, null); tp.until = s.round + th.bearings; return null; }
    const hit = s.units.filter(u => u.alive && u.kind === 'monster' && u.lane === lane && u.sq === sq && !u.dormant).sort((a, b) => a.id - b.id);
    const rolled = th.n ? dice(s, th.n, th.d) : 0;
    for (const m of hit) {
      if (th.holy && !traits(m).undead && !traits(m).fiend) continue;
      if (th.n) {
        const killed = hurt(m, rolled);
        emit(s, { type: 'splash', kind, to: m.id, dmg: rolled, killed });
        if (killed) { died(s, m, null); continue; }
        if (th.holy && traits(m).radiantStops) addStatus(s, m, 'seared', 1);
        for (const hook of ON_HURT) hook(s, m);
      }
      if (th.aflame && !traits(m).fireImmune) addStatus(s, m, 'aflame', th.aflame);
      if (th.net && m.maxHp < 60) addStatus(s, m, 'netted', th.net);
    }
    return null;
  }
  function layTrap(s, kind, lane, sq, by) {
    const def = TRAPS[kind] || HEROES[kind].trap;
    const tp = { id: s.nextId++, kind, lane, sq, uses: def.uses };
    s.traps.push(tp);
    emit(s, { type: 'trap', id: tp.id, kind, lane, sq, by: by ? by.id : 0 });
    return tp;
  }
  // a walker steps onto a trap
  function spring(s, u, tp) {
    const def = TRAPS[tp.kind] || HEROES[tp.kind].trap;
    tp.uses--; s.stats.sprung++;
    if (tp.uses <= 0) s.traps.splice(s.traps.indexOf(tp), 1);
    emit(s, { type: 'sprung', id: tp.id, kind: tp.kind, lane: tp.lane, sq: tp.sq, on: u.id, left: tp.uses });
    const victims = def.radius ? s.units.filter(m => m.alive && m.kind === 'monster' && Math.abs(m.lane - tp.lane) <= def.radius && Math.abs(m.sq - tp.sq) <= def.radius).sort((a, b) => a.id - b.id) : [u];
    const rolled = dice(s, def.n, def.d);
    for (const m of victims) {
      let dmg = rolled, saved = false;
      if (def.dc) { saved = d(s, 20) + MONSTERS[m.type].dexSave >= def.dc; if (saved) dmg = Math.floor(dmg / 2); }
      if (def.fire) dmg = fireOn(m, dmg);
      const killed = dmg > 0 ? hurt(m, dmg) : false;
      emit(s, { type: 'trapHit', trap: tp.id, kind: tp.kind, to: m.id, dmg, saved, killed });
      if (killed) { died(s, m, null); continue; }
      if (def.fire && traits(m).fireStops) addStatus(s, m, 'burnt', 1);
      if (def.slow) addStatus(s, m, 'slowed', def.slow);
      if (def.prone && !saved) addStatus(s, m, 'prone', 1);
      for (const hook of ON_HURT) hook(s, m);
    }
  }

  // Houndmaster: a hound in the square in front, when there is none and the last one fell long enough ago
  function callHound(s, u) {
    if (s.units.some(h => h.alive && h.type === 'hound' && h.owner === u.id)) return false;
    if (s.round < (u.houndAt || 0)) return false;
    const q = u.sq + 1;
    if (!placeable(s, u.lane, q) || unitAt(s, u.lane, q)) return false;
    const h = addUnit(s, 'hero', 'hound', u.lane, q);
    h.owner = u.id; h.actedRound = s.round;
    emit(s, { type: 'spawn', id: h.id, kind: 'hero', unitType: 'hound', lane: h.lane, sq: h.sq, hp: h.hp, maxHp: h.maxHp, how: 'hound', from: u.id });
    return true;
  }

  const near = (a, b) => Math.abs(a.lane - b.lane) <= 1 && Math.abs(a.sq - b.sq) <= 1;

  // Cleric: Healing Word on the most hurt hero within reach (itself included); paralysis counts as hurt
  function healNear(s, u, hl, skip) {
    let best = null, need = 0;
    for (const h of s.units) {
      if (!h.alive || h.kind !== 'hero' || h === skip || isObject(h) || h.inside || hasStatus(h, 'rotting') || Math.abs(h.lane - u.lane) > hl.reach || Math.abs(h.sq - u.sq) > hl.reach) continue;
      const n = (h.maxHp - h.hp) + (hasStatus(h, 'paralysed') ? 8 : 0);
      if (n > need) { best = h; need = n; }
    }
    if (!best || need < 4) return false; // not worth a turn: Sacred Flame instead
    const amount = Math.min(dice(s, hl.n, hl.d) + hl.mod, best.maxHp - best.hp);
    const cured = hasStatus(best, 'paralysed');
    best.hp += amount; clearBad(best); s.stats.healed += amount;
    emit(s, { type: 'cure', from: u.id, id: best.id, amount, cured });
    return best;
  }

  // Sneak Attack needs another hero next to the target
  function flanked(s, m, by) {
    for (const h of s.units) if (h.alive && h.kind === 'hero' && h !== by && !isObject(h) && near(h, m)) return true;
    return false;
  }
  // Rogue: any monster in the eight squares around it; a Sneak Attack first, then the weakest
  function bestAround(s, u) {
    let best = null, score = -Infinity;
    for (const m of s.units) {
      if (!m.alive || m.kind !== 'monster' || !near(m, u) || !seen(s, m)) continue;
      const sc = (flanked(s, m, u) ? 1000 : 0) - m.hp;
      if (sc > score) { best = m; score = sc; }
    }
    return best;
  }

  // Barbarian: waits until a monster is ahead in its row, then rages, charges and swings at everything
  // in the 3×3 around that monster with advantage. The charge spends it: it leaves the mat, it does not die.
  function charge(s, u, st) {
    const target = nearestAhead(s, u.lane, u.sq);
    if (!target) return;
    let dest = target.sq - 1;
    if (dest !== u.sq && unitAt(s, u.lane, dest) && free(s, u.lane, target.sq + 1)) dest = target.sq + 1; // vaults it
    const stays = u.path === 'stonehide' || (u.path === 'berserker' && u.rages > 1);
    if (stays && dest !== u.sq && (unitAt(s, u.lane, dest) || !placeable(s, u.lane, dest))) dest = u.sq; // nowhere to land: swings from where it stands
    emit(s, { type: 'charge', id: u.id, from: u.sq, to: dest, target: target.id });
    if (stays) u.sq = dest;
    const around = s.units.filter(m => m.alive && m.kind === 'monster' && near(m, target));
    around.sort((a, b) => (a === target ? -1 : b === target ? 1 : a.id - b.id));
    const atk = heroAttack(u, st.attack);
    for (const m of around) if (m.alive) attack(s, u, m, atk);
    s.stats.charges++;
    if (u.path === 'berserker' && u.rages > 1) { u.rages--; return; }
    if (u.path === 'stonehide') { u.blocker = true; emit(s, { type: 'stand', id: u.id }); return; }
    u.alive = false;
    emit(s, { type: 'spent', id: u.id });
  }

  /* Monster abilities, as hooks that run in this order. A new ability is a new entry in one of these lists. */
  const TURN_START = [ // before anything else on its turn; true = it died
    function holyGround(s, u) {
      if (!traits(u).undead) return false;
      if (cellAt(s, u.lane, u.sq) !== '+' && !s.units.some(f => f.alive && f.kind === 'hero' && HEROES[f.type].holy && within(f, u, HEROES[f.type].holy))) return false;
      const killed = hurt(u, 2);
      emit(s, { type: 'burn', id: u.id, dmg: 2, killed });
      if (killed) died(s, u, null);
      else if (traits(u).radiantStops) addStatus(s, u, 'seared', 1);
      return killed;
    },
    function sunlight(s, u) { // the attic: daylight through an open skylight burns the undead under it and round it, and stops them healing
      const m = mapOf(s);
      if (!m.skylights || !traits(u).undead || !sunlit(s, u.lane, u.sq)) return false;
      const dmg = dice(s, 2, 6), killed = hurt(u, dmg);
      emit(s, { type: 'burn', id: u.id, dmg, killed, sun: true });
      if (killed) died(s, u, null);
      else if (traits(u).radiantStops) addStatus(s, u, 'seared', 1);
      return killed;
    },
    function regenerate(s, u) {
      const t = traits(u), wet = t.soak && '~@'.indexOf(cellAt(s, u.lane, u.sq)) >= 0; // the thing in the well heals only in water
      const v = t.regen || (wet ? t.soak : 0);
      if (v && u.hp < u.maxHp && !(traits(u).fireStops && hasStatus(u, 'burnt')) && !(traits(u).radiantStops && hasStatus(u, 'seared'))) { const amount = Math.min(v, u.maxHp - u.hp); u.hp += amount; emit(s, { type: 'regen', id: u.id, amount }); }
      return false;
    }
  ];
  const BEFORE_ACT = [ // instead of moving or attacking; true = the turn is used
    function callHelp(s, u) { const sm = traits(u).summon; return !!(sm && !u.minor && u.made < sm.max && u.turns % sm.every === 0 && summon(s, u, sm.type)); },
    function mendNearby(s, u) { const md = traits(u).mend; return !!(md && u.turns % md.every === 0 && mend(s, u, md)); },
    function breathe(s, u) { // young red dragon: fire down the whole row, a Dexterity save for half
      const br = traits(u).breath;
      if (!br || u.turns % br.every !== 0) return false;
      const caught = s.units.filter(h => h.alive && h.kind === 'hero' && !h.inside && h.lane === u.lane && h.sq < u.sq && clearRow(s, u.lane, h.sq, u.sq)).sort((a, b) => b.sq - a.sq);
      if (!caught.length) return false;
      const rolled = dice(s, br.n, br.d);
      emit(s, { type: 'breath', from: u.id, lane: u.lane, sq: u.sq, dmg: rolled });
      for (const h of caught) {
        const roll = d(s, 20), total = roll + 2 + itemBonus(h, 'save'), saved = total >= br.dc, dmg = saved ? Math.floor(rolled / 2) : rolled;
        const killed = hurt(h, dmg);
        emit(s, { type: 'scorch', from: u.id, to: h.id, roll, total, dc: br.dc, saved, dmg, killed });
        if (killed) died(s, h, u); else shapeCheck(s, h);
      }
      return true;
    },
    function gaze(s, u) { // medusa: the nearest hero ahead within reach saves or turns to stone
      const gz = traits(u).gaze;
      if (!gz || u.turns % gz.every !== 0) return false;
      let t = null;
      for (const h of s.units) if (h.alive && h.kind === 'hero' && !isObject(h) && !h.inside && h.lane === u.lane && h.sq < u.sq && u.sq - h.sq <= gz.range && clearRow(s, u.lane, h.sq, u.sq) && (!t || h.sq > t.sq)) t = h;
      if (!t) return false;
      const roll = d(s, 20) + itemBonus(t, 'save');
      if (roll >= gz.dc) { emit(s, { type: 'gaze', from: u.id, to: t.id, roll, saved: true }); return true; }
      t.petrified = true; t.hp = t.maxHp = 40; t.ac = 17; t.status = {}; t.form = null; t.tempHp = 0;
      emit(s, { type: 'petrify', id: t.id, from: u.id, roll });
      return true;
    },
    function charm(s, u) { // vampire: a hero nearby saves or turns on its friends for a couple of turns
      const ch = traits(u).charm;
      if (!ch || u.turns % ch.every !== 0) return false;
      const t = s.units.filter(h => h.alive && h.kind === 'hero' && !isObject(h) && !h.inside && !HEROES[h.type].ally && !hasStatus(h, 'charmed') && within(h, u, ch.range))
        .sort((a, b) => (Math.abs(a.sq - u.sq) + Math.abs(a.lane - u.lane)) - (Math.abs(b.sq - u.sq) + Math.abs(b.lane - u.lane)) || a.id - b.id)[0];
      if (!t) return false;
      const roll = d(s, 20) + itemBonus(t, 'save');
      emit(s, { type: 'gaze', from: u.id, to: t.id, roll, saved: roll >= ch.dc, charm: true });
      if (roll < ch.dc) addStatus(s, t, 'charmed', ch.turns, u);
      return true;
    }
  ];
  const ARMOUR = [ // the target's, against a hero's blow: the damage left after it, or undefined if it takes the lot
    function resist(s, a, t, atk, dmg) { if (a.kind === 'hero' && !atk.magic && traits(t).resist) return Math.max(1, Math.floor(dmg / 2)); },
    function shell(s, a, t, atk, dmg) { if (a.kind === 'hero' && atk.kind === 'ranged' && !atk.magic && traits(t).shell) return Math.max(1, Math.floor(dmg / 2)); }, // a crab's shell
    function plate(s, a, t, atk, dmg) { if (a.kind === 'hero' && !atk.magic && traits(t).plate) return Math.max(1, dmg - traits(t).plate); } // animated armour
  ];
  const WHEN_STRUCK = [ // the target's, when a blow lands on it, after the blow is reported
    function heated(s, a, t, atk) { if (a.kind === 'hero' && atk.kind !== 'ranged' && traits(t).heated && a.alive && !isObject(a)) scald(s, a, t); }
  ];
  const ON_LANDED = [ // the attacker's, when a monster's blow wounds a hero, before anything else follows from it
    function rot(s, a, t) { if (traits(a).rot) addStatus(s, t, 'rotting', traits(a).rot, a); },
    function adhesive(s, a, t) { if (traits(a).adhesive && t.alive) addStatus(s, t, 'stuck', 1, a); }
  ];
  const AFTER_HIT = [ // the attacker's, when its blow lands
    function drain(s, a, t, dmg) {
      if (!traits(a).drain || !a.alive || a.hp >= a.maxHp || dmg < 2) return;
      const amount = Math.min(Math.floor(dmg / 2), a.maxHp - a.hp);
      a.hp += amount;
      emit(s, { type: 'regen', id: a.id, amount, drain: true });
    }
  ];
  const AFTER_WOUND = [ // the attacker's, when the target survives
    function engulf(s, a, t) { // gelatinous cube: swallows the hero it hits, one at a time
      const en = traits(a).engulf;
      if (!en || a.holding || t.kind !== 'hero' || isObject(t) || !a.alive) return;
      a.holding = t.id; t.inside = a.id; t.offLane = t.lane; t.offSq = t.sq;
      t.lane = -1; t.sq = -1000 - t.id; t.status = {};
      emit(s, { type: 'engulf', id: t.id, by: a.id, lane: t.offLane, sq: t.offSq });
    },
    function rust(s, a, t) { // rust monster: armour flakes away
      const r = traits(a).rust;
      if (!r || t.kind !== 'hero' || isObject(t) || t.type === 'monk' || t.ac <= 12) return;
      t.ac = Math.max(12, t.ac - r);
      emit(s, { type: 'rust', id: t.id, from: a.id, ac: t.ac });
    },
    function paralyse(s, a, t) {
      if (!traits(a).paralyse || t.kind !== 'hero' || hasStatus(t, 'paralysed')) return;
      const save = d(s, 20) + itemBonus(t, 'save'); // DC 12 save to shake it off
      if (save < 12) { t.status.paralysed = 1; emit(s, { type: 'paralyse', id: t.id, from: a.id, roll: save }); }
    },
    function turnUndead(s, a, t) { // Dawnkeeper: undead it hurts make a DC 12 save or back away
      if (a.path !== 'dawnkeeper' || !traits(t).undead || traits(t).boss || hasStatus(t, 'frightened') || s.round < (t.braveUntil || 0)) return;
      if (d(s, 20) < 12) { addStatus(s, t, 'frightened', 1, a); t.braveUntil = s.round + 3; } // once it has run, it holds its nerve a while
    },
    function burn(s, a, t, dmg, atk) { // fire stops a troll healing, radiant light a vampire
      if (atk && atk.fire && traits(t).fireStops) addStatus(s, t, 'burnt', 1, a);
      if (atk && (atk.holy || (a.kind === 'hero' && HEROES[a.type].smite)) && traits(t).radiantStops) addStatus(s, t, 'seared', 1, a);
    },
    function hex(s, a, t) { // Hexbinder: slowed for a turn
      if (a.path === 'hexbinder' && t.kind === 'monster') addStatus(s, t, 'slowed', 1, a);
    },
    function shove(s, a, t, dmg, atk) { // Shieldwarden, and Eldritch Blast: back a square, if there is room
      if (!(a.path === 'shieldwarden' || (atk && atk.push)) || t.kind !== 'monster' || traits(t).boss) return;
      const to = backOff(s, t);
      if (to == null) return;
      const from = t.sq; t.sq = to;
      emit(s, { type: 'shove', id: t.id, from, to, lane: t.lane, by: a.id });
    }
  ];
  const ON_HURT = [ // the target's, when it survives a wound
    function split(s, t) { if (t.kind === 'monster') maybeSplit(s, t); },
    function dive(s, t) { // the thing under the lawn: badly hurt, it goes back under and comes up through a hatch further on
      const sf = traits(t).surface, m = mapOf(s), k = t.dives || 0;
      if (!sf || !t.alive || k >= sf.at.length || t.hp > t.maxHp * sf.at[k] || !m.hatches) return;
      const here = m.distWalk[t.lane][t.sq], far = i => m.distWalk[m.doors[i].lane][m.doors[i].sq];
      let to = -1;
      m.doors.forEach((d, i) => { if (m.hatches[i] && far(i) < here && (to < 0 || far(i) > far(to))) to = i; });
      if (to < 0) return;
      t.alive = false;
      emit(s, { type: 'dive', id: t.id, lane: t.lane, sq: t.sq, door: to });
      s.pending.push({ round: s.round + sf.under, type: t.type, door: to, pool: [to], carry: { hp: t.hp, maxHp: t.maxHp, dives: k + 1 } });
    },
    function unhorse(s, t) { // wolf rider: knocked out of the saddle at half health, a goblin and a wolf from then on
      const uh = traits(t).unhorse;
      if (!uh || !t.alive || t.hp * 2 > t.maxHp) return;
      t.alive = false;
      const rider = addUnit(s, 'monster', uh.rider, t.lane, t.sq);
      rider.actedRound = s.round;
      emit(s, { type: 'unhorse', id: t.id, rider: rider.id });
      emit(s, { type: 'spawn', id: rider.id, kind: 'monster', unitType: uh.rider, lane: rider.lane, sq: rider.sq, hp: rider.hp, maxHp: rider.maxHp, how: 'unhorse', from: t.id });
      for (const [l, q] of spotsNear(t)) {
        if (!free(s, l, q)) continue;
        const mount = addUnit(s, 'monster', uh.mount, l, q);
        mount.hp = Math.max(1, Math.min(mount.maxHp, t.hp)); mount.actedRound = s.round;
        emit(s, { type: 'spawn', id: mount.id, kind: 'monster', unitType: uh.mount, lane: l, sq: q, hp: mount.hp, maxHp: mount.maxHp, how: 'unhorse', from: t.id });
        break;
      }
    }
  ];
  // a Druid's bear runs out of hit points: back to the Druid
  function shapeCheck(s, t) { if (t.formEnded) { t.formEnded = false; emit(s, { type: 'shape', id: t.id, form: null }); } }

  function monsterAct(s, u) {
    const st = MONSTERS[u.type], tr = st.traits, atk = st.attack, m = mapOf(s);
    u.turns++;
    if (u.dormant) { // a mimic sits still until a hero comes close or its patience runs out
      if (s.round < u.dormant && !s.units.some(h => h.alive && h.kind === 'hero' && !isObject(h) && within(h, u, 1))) return;
      u.dormant = 0; emit(s, { type: 'wake', id: u.id });
    }
    for (const hook of TURN_START) if (hook(s, u)) return;
    if (statusStart(s, u)) return;
    for (const hook of BEFORE_ACT) if (hook(s, u)) return;

    // a giant frog's tongue goes past the first hero to the one behind it
    const lash = tr.lash ? s.units.find(h => h.alive && h.kind === 'hero' && !h.inside && h.lane === u.lane && h.sq === u.sq - 2 && clearRow(s, u.lane, h.sq, u.sq)) : null;
    const target = lash || heroInReach(s, u, atk.range);
    if (target) {
      if ((tr.flying || tr.burrow) && !u.hopped) { // flyers leap the first hero in the way; burrowers go under it
        const nx = stepOf(s, u);
        if (nx && !nx.exit && nx.lane === target.lane && nx.sq === target.sq) {
          const after = (tr.flying ? m.nextFly : m.nextWalk)[target.lane][target.sq];
          if (after && after.exit) { u.hopped = true; leak(s, u); return; }
          if (after && !unitAt(s, after.lane, after.sq)) {
            u.hopped = true; u.acc = 0;
            const from = u.sq, fromLane = u.lane; u.sq = after.sq; u.lane = after.lane;
            emit(s, { type: 'move', id: u.id, from, to: u.sq, leap: true, lane: u.lane, fromLane, burrow: !!tr.burrow });
            if (tr.burrow) { const tp = trapAt(s, u.lane, u.sq); if (tp) spring(s, u, tp); }
            return;
          }
        }
      }
      const times = tr.multi || 1;
      for (let i = 0; i < times && target.alive && u.alive; i++) attack(s, u, target, atk);
      return;
    }
    if (u.netNow) return; // held in a net: it can strike, but not move
    u.acc += st.speed * (u.slowNow ? 0.5 : 1);
    let steps = 0;
    while (steps < 4) {
      const nx = stepOf(s, u);
      if (!nx) break;
      const cell = nx.exit ? '' : m.rows[nx.lane][nx.sq];
      const cost = (!tr.flying && !tr.amphibious && cell === '~') ? 2 : (!tr.flying && cell === '=') ? 0.5 : 1;
      if (steps >= 2 && cost !== 0.5) break; // two squares a turn, or more while it slides
      if (u.acc < cost - 1e-9) break;
      if (nx.exit) { leak(s, u); return; }
      if (unitAt(s, nx.lane, nx.sq) && !crowdOK(s, u.type, nx.lane, nx.sq)) { u.acc = Math.min(u.acc, cost); break; } // queued behind another unit
      u.acc -= cost; steps++;
      const from = u.sq, fromLane = u.lane; u.sq = nx.sq; u.lane = nx.lane;
      emit(s, { type: 'move', id: u.id, from, to: u.sq, step: steps, lane: u.lane, fromLane });
      if (!tr.flying && s.traps.length) { const tp = trapAt(s, u.lane, u.sq); if (tp) { spring(s, u, tp); if (!u.alive) return; } }
      if (heroInReach(s, u, atk.range)) break;
    }
  }

  function leak(s, u) {
    u.alive = false; s.lives--; s.stats.leaks++;
    emit(s, { type: 'leak', id: u.id, lane: u.lane });
    if (u.holding) { const h = s.units.find(x => x.id === u.holding && x.alive); if (h) { h.alive = false; s.stats.fallen++; emit(s, { type: 'death', id: h.id, by: u.id, bounty: 0 }); } }
    if (s.lives <= 0) { s.lives = 0; s.phase = 'lost'; emit(s, { type: 'defeat' }); }
  }

  function attack(s, a, t, atk) {
    let roll = d(s, 20), low = 0; s.stats.rolls++;
    if (atk.reckless) { low = d(s, 20); if (low > roll) { const x = roll; roll = low; low = x; } } // advantage: keep the higher
    // shield wall: arrows at a monster behind a hobgoblin in the same row have disadvantage (spells are not stopped)
    const walled = a.kind === 'hero' && atk.kind === 'ranged' && !atk.magic && t.kind === 'monster' &&
      s.units.some(h => h.alive && h !== t && traits(h).shieldwall && h.lane === t.lane && h.sq < t.sq && h.sq > a.sq);
    if (walled) { low = d(s, 20); if (low < roll) { const x = roll; roll = low; low = x; } } // disadvantage: keep the lower
    let crit = roll >= (a.path === 'champion' ? 19 : 20);
    const fumble = roll === 1;
    const high = a.kind === 'hero' && cellAt(s, a.lane, a.sq) === '^';
    const cut = a.kind === 'monster' && s.units.some(h => h.alive && h.path === 'lore' && within(h, a, 2)); // Cutting Words
    const bonus = atk.bonus + (high ? 2 : 0) - (cut ? 2 : 0);
    const total = roll + bonus;
    const ac = t.ac + (t.kind === 'hero' && !isObject(t) ? aura(s, t) : 0); // a Paladin's aura
    const hit = !fumble && (crit || total >= ac);
    if (hit && a.path === 'cutthroat' && t.kind === 'monster' && t.hp === t.maxHp) crit = true;
    if (a.kind === 'hero') { if (crit) s.stats.crits++; if (fumble) s.stats.fumbles++; }
    let dmg = 0, killed = false, resisted = false, deflected = 0, rose = false;
    const holy = !!(atk.holy && traits(t).undead);
    const sm = a.kind === 'hero' && HEROES[a.type].smite;
    const smite = sm && hit && ((a.hits = (a.hits || 0) + 1) % (a.path === 'devotion' ? 2 : sm.every) === 0) ? sm : null; // Divine Smite
    if (hit) {
      const k = (crit ? 2 : 1) * (holy ? 2 : 1);
      dmg = dice(s, atk.n * k, atk.d) + atk.mod;
      if (atk.extra) dmg += dice(s, atk.extra[0] * (crit ? 2 : 1), atk.extra[1]);
      dmg = Math.max(1, dmg);
      if (smite) dmg += dice(s, smite.n * (crit ? 2 : 1) * (traits(t).undead ? 2 : 1), smite.d);
      if (a.kind === 'hero' && traits(t).undead) dmg += itemBonus(a, 'undead'); // a Mace of Disruption
      for (const hook of ARMOUR) { const left = hook(s, a, t, atk, dmg); if (left !== undefined) { dmg = left; resisted = true; } }
      if (t.type === 'monk' && atk.kind === 'ranged' && !atk.magic && t.kind === 'hero') { // Deflect Missiles
        const df = HEROES.monk.deflect;
        deflected = dice(s, df.n, df.d) + df.mod + (t.level - 1); dmg = Math.max(0, dmg - deflected);
      }
      killed = dmg > 0 ? hurt(t, dmg) : false;
      if (killed && traits(t).rises && !t.rose && !crit && !holy && !smite) { // the drowned get back up once, unless the blow was holy or a crit
        t.rose = true; t.alive = true; t.hp = Math.ceil(t.maxHp / 2); killed = false; rose = true;
      }
    }
    emit(s, { type: 'attack', from: a.id, to: t.id, side: a.kind, kind: atk.kind, fx: atk.fx, name: atk.name,
      roll, low, bonus, total, ac, hit, crit, fumble, dmg, killed, resisted, holy, sneak: !!atk.sneak, high, cut, walled, smite: !!smite, deflected });
    if (rose) emit(s, { type: 'rise', id: t.id, hp: t.hp });
    if (hit) for (const hook of WHEN_STRUCK) hook(s, a, t, atk);
    if (hit && dmg && !killed && a.kind === 'monster' && t.kind === 'hero') for (const hook of ON_LANDED) hook(s, a, t);
    if (!hit) return MISS;
    if (a.path === 'thief') { s.gold += 2; s.stats.pocketed += 2; emit(s, { type: 'pocket', id: a.id, amount: 2 }); }
    if (!dmg) return MISS; // caught in mid-air
    for (const hook of AFTER_HIT) hook(s, a, t, dmg);
    if (killed) { died(s, t, a); return KILL; }
    shapeCheck(s, t);
    for (const hook of AFTER_WOUND) hook(s, a, t, dmg, atk);
    for (const hook of ON_HURT) hook(s, t);
    return WOUND;
  }
  // a salamander's heated body burns whoever strikes it up close
  function scald(s, h, m) {
    const ht = traits(m).heated, dmg = dice(s, ht.n, ht.d), killed = hurt(h, dmg);
    emit(s, { type: 'scald', id: h.id, by: m.id, dmg, killed });
    if (killed) died(s, h, m);
  }
  // fire against what it is made of: salamanders shrug it off, mummies go up like kindling
  const fireOn = (m, dmg) => (traits(m).fireImmune ? 0 : traits(m).fireWeak ? dmg * 2 : dmg);
  const MISS = { hit: false }, KILL = { hit: true, killed: true }, WOUND = { hit: true, wound: true };
  // +1 AC for a hero next to a Paladin (two squares further for a Lanternbearer)
  function aura(s, t) {
    for (const p of s.units) if (p.alive && p !== t && p.kind === 'hero' && HEROES[p.type].aura && !p.petrified && !p.inside &&
      within(p, t, HEROES[p.type].aura.reach + (p.path === 'lanternbearer' ? 2 : 0))) return HEROES[p.type].aura.ac;
    return 0;
  }

  function fireball(s, u, center, sp) {
    const dmg = dice(s, sp.n, sp.d), cl = center.lane, cs = center.sq;
    emit(s, { type: 'fireball', from: u.id, lane: cl, sq: cs, dmg, name: sp.name });
    const caught = s.units.filter(m => m.alive && m.kind === 'monster' && Math.abs(m.lane - cl) <= sp.radius && Math.abs(m.sq - cs) <= sp.radius);
    for (const m of caught) {
      const roll = d(s, 20), total = roll + MONSTERS[m.type].dexSave, saved = total >= sp.dc;
      const dd = fireOn(m, saved ? Math.floor(dmg / 2) : dmg);
      const killed = dd > 0 ? hurt(m, dd) : false;
      emit(s, { type: 'save', from: u.id, to: m.id, roll, total, dc: sp.dc, saved, dmg: dd, killed });
      if (killed) { died(s, m, u); continue; }
      if (dd > 0 && traits(m).fireStops) addStatus(s, m, 'burnt', 1, u);
      for (const hook of ON_HURT) hook(s, m);
    }
  }

  function hurt(t, dmg) {
    if (t.tempHp > 0) {
      const soak = Math.min(t.tempHp, dmg);
      t.tempHp -= soak; dmg -= soak;
      if (t.tempHp <= 0 && t.form) { t.form = null; t.formEnded = true; }
    }
    t.hp -= dmg;
    if (t.hp <= 0 && t.alive) { t.hp = 0; t.alive = false; return true; }
    return false;
  }

  function died(s, t, by) {
    let bounty = 0;
    if (t.kind === 'monster') {
      bounty = MONSTERS[t.type].bounty;
      if (t.minor) bounty = Math.floor(bounty / 2);
      s.gold += bounty; s.stats.kills++;
    } else if (!HEROES[t.type].ally) s.stats.fallen++;
    else if (t.type === 'hound') { const m = s.units.find(x => x.id === t.owner); if (m) m.houndAt = s.round + 4; }
    else if (t.type === 'ballista') { const m = s.units.find(x => x.id === t.owner); if (m) m.ballistaAt = s.round + HEROES[m.type].builds.ballista; }
    emit(s, { type: 'death', id: t.id, by: by ? by.id : 0, bounty });
    if (t.kind !== 'monster') return;
    if (t.holding) { // the cube is gone: whoever it swallowed tumbles out where it died
      const h = s.units.find(x => x.id === t.holding && x.alive);
      if (h) {
        h.inside = 0; h.lane = t.lane; h.sq = t.sq;
        if (!placeable(s, t.lane, t.sq)) { // not in a doorway: the nearest open square toward the tavern
          for (const [l, q] of [[t.lane, t.sq - 1], [t.lane - 1, t.sq], [t.lane + 1, t.sq], [t.lane, t.sq - 2], [t.lane - 1, t.sq - 1], [t.lane + 1, t.sq - 1]])
            if (placeable(s, l, q) && !unitAt(s, l, q)) { h.lane = l; h.sq = q; break; }
        }
        emit(s, { type: 'release', id: h.id, lane: h.lane, sq: h.sq });
      }
      t.holding = 0;
      return;
    }
    if (t.swatted) return; // off the table: nothing gets back up from the floor
    raise(s, t);
    raiseDead(s, t);
  }
  // necromancer: a monster that falls nearby gets back up as a skeleton, three at a time
  function raiseDead(s, t) {
    if (traits(t).boss || !free(s, t.lane, t.sq)) return;
    const n = s.units.find(m => m.alive && m.kind === 'monster' && traits(m).raiseDead && within(m, t, traits(m).raiseDead.range) && m.made < traits(m).raiseDead.max);
    if (!n) return;
    const sk = addUnit(s, 'monster', 'skeleton', t.lane, t.sq);
    sk.minor = true; sk.actedRound = s.round; n.made++;
    emit(s, { type: 'summon', id: n.id, made: sk.id });
    emit(s, { type: 'spawn', id: sk.id, kind: 'monster', unitType: 'skeleton', lane: sk.lane, sq: sk.sq, hp: sk.hp, maxHp: sk.maxHp, how: 'raise', from: n.id });
  }
  // Graveseer: a monster slain within two squares gets back up on your side, two at a time per Graveseer
  function raise(s, t) {
    if (traits(t).boss || !placeable(s, t.lane, t.sq) || unitAt(s, t.lane, t.sq)) return;
    const g = s.units.find(w => w.alive && w.path === 'graveseer' && within(w, t, 2) &&
      s.units.filter(r => r.alive && r.type === 'risen' && r.owner === w.id).length < 2);
    if (!g) return;
    const r = addUnit(s, 'hero', 'risen', t.lane, t.sq);
    r.owner = g.id; r.actedRound = s.round; s.stats.raised++;
    emit(s, { type: 'spawn', id: r.id, kind: 'hero', unitType: 'risen', lane: r.lane, sq: r.sq, hp: r.hp, maxHp: r.maxHp, how: 'rise', from: g.id });
  }

  // squares a monster can put a new body into: behind it first, then the rows either side
  function spotsNear(m) {
    return [[m.lane, m.sq + 1], [m.lane - 1, m.sq], [m.lane + 1, m.sq], [m.lane - 1, m.sq + 1], [m.lane + 1, m.sq + 1]];
  }

  function maybeSplit(s, m) {
    if (!traits(m).split || m.split || !m.alive || m.hp * 2 > m.maxHp) return;
    m.split = true;
    const half = Math.floor(m.hp / 2);
    if (half < 1) return;
    for (const [l, q] of spotsNear(m)) {
      if (!free(s, l, q)) continue;
      m.hp -= half;
      const c = addUnit(s, 'monster', m.type, l, q);
      c.hp = half; c.maxHp = m.maxHp; c.split = true; c.minor = true; c.actedRound = s.round;
      emit(s, { type: 'spawn', id: c.id, kind: 'monster', unitType: c.type, lane: l, sq: q, hp: c.hp, maxHp: c.maxHp, how: 'split', from: m.id });
      return;
    }
  }

  function summon(s, u, type) {
    for (const [l, q] of spotsNear(u)) {
      if (!free(s, l, q)) continue;
      const m = addUnit(s, 'monster', type, l, q);
      m.minor = true; m.actedRound = s.round; u.made++;
      emit(s, { type: 'summon', id: u.id, made: m.id });
      emit(s, { type: 'spawn', id: m.id, kind: 'monster', unitType: type, lane: l, sq: q, hp: m.hp, maxHp: m.maxHp, how: 'summon', from: u.id });
      return true;
    }
    return false;
  }

  function mend(s, u, md) {
    let best = null;
    for (const m of s.units) {
      if (!m.alive || m.kind !== 'monster' || Math.abs(m.lane - u.lane) > 1 || Math.abs(m.sq - u.sq) > 2) continue;
      if (!best || m.maxHp - m.hp > best.maxHp - best.hp) best = m;
    }
    if (!best || best.maxHp - best.hp < 4) return false;
    const amount = Math.min(dice(s, md.n, md.d), best.maxHp - best.hp);
    best.hp += amount;
    emit(s, { type: 'mend', from: u.id, id: best.id, amount });
    return true;
  }

  function checkWave(s) {
    if (s.phase !== 'running' || !s.waveActive || s.pending.length) return;
    for (const u of s.units) if (u.alive && u.kind === 'monster') return;
    const b = battle(s);
    s.waveActive = false;
    emit(s, { type: 'waveCleared', index: s.wave });
    for (const u of s.units) if (u.alive && u.type === 'risen') { u.alive = false; emit(s, { type: 'crumble', id: u.id }); }
    if (s.wave >= lastWave(b)) { s.phase = 'won'; emit(s, { type: 'victory', battle: b.id }); return; }
    for (const u of s.units) {
      if (!u.alive || u.kind !== 'hero') continue;
      clearBad(u);
      if (u.hp < u.maxHp) {
        const k = s.tavern ? s.tavern.kitchen : 0; // the kitchen's cooking: half, three quarters, or all of it back
        const amount = k >= 2 ? u.maxHp - u.hp : Math.ceil((u.maxHp - u.hp) * (k === 1 ? 0.75 : 0.5));
        u.hp += amount;
        emit(s, { type: 'heal', id: u.id, amount });
      }
    }
    s.nextWaveRound = s.round + REST_ROUNDS;
    emit(s, { type: 'rest', rounds: REST_ROUNDS, next: s.wave + 1 });
  }

  function placeable(s, lane, sq) {
    const c = cellAt(s, lane, sq);
    if (c === 'H') { const m = mapOf(s); return !hatchOpenAt(s, m, lane, sq); }
    return PLACEABLE.indexOf(c) >= 0;
  }
  const hatchOpenAt = (s, m, lane, sq) => !!(m.doorAt && s.opened && s.opened[m.doorAt[lane * 100 + sq]]);

  function canPlace(s, type, lane, sq) {
    const h = HEROES[type];
    if (!h || h.ally) return 'unknown';
    if (s.free ? !(type in s.free) : s.loadout && !h.defender && s.loadout.indexOf(type) < 0) return 'locked';
    if (s.phase !== 'running') return 'over';
    if (!placeable(s, lane, sq)) return 'off';
    if (unitAt(s, lane, sq) || (s.traps.length && trapAt(s, lane, sq))) return 'occupied';
    if (h.recharge && s.round < (s.ready[type] || 0)) return 'recharging';
    if (s.free) return s.free[type] > 0 ? null : 'limit';
    if (s.gold < h.cost) return 'gold';
    return null;
  }

  function place(s, type, lane, sq) {
    const why = canPlace(s, type, lane, sq);
    if (why) return why;
    s.now = s.time;
    if (s.free) s.free[type]--; else s.gold -= HEROES[type].cost;
    if (HEROES[type].recharge) s.ready[type] = s.round + HEROES[type].recharge;
    s.stats.placed++;
    if (HEROES[type].trap) { layTrap(s, type, lane, sq, null); return null; }
    const u = addUnit(s, 'hero', type, lane, sq);
    u.spent = s.free ? 0 : HEROES[type].cost;
    const tr = s.tavern ? s.tavern.training : 0; // the training room sends heroes out at level 2
    if (tr >= 2 || (tr === 1 && s.trained && !s.trained[type])) {
      if (s.trained) s.trained[type] = true;
      u.level = 2; const extra = Math.ceil(HEROES[type].hp * 0.25); u.maxHp += extra; u.hp += extra;
    }
    emit(s, { type: 'place', id: u.id, kind: 'hero', unitType: type, lane, sq, hp: u.hp, level: u.level });
    return null;
  }

  /* ---------- the cats' powers ----------
     Mitz pounces: every monster in a 3 × 3 square is stunned for a round. Simz swats: a monster that is not a boss goes
     off the table, for good. Each battle one cat is on watch, and that cat's power comes round twice as often. */
  const POWERS = {
    pounce: { cat: 'mitz', name: 'Pounce', every: [12, 6], text: 'Stuns every monster in a 3 × 3 square for a round.' },
    swat: { cat: 'simz', name: 'Swat', every: [12, 6], text: 'Knocks a monster that is not a boss off the table.' }
  };
  function powerTargets(s, k, lane, sq) {
    if (k === 'pounce') return s.units.filter(u => u.alive && u.kind === 'monster' && Math.abs(u.lane - lane) <= 1 && Math.abs(u.sq - sq) <= 1);
    const m = monsterAt(s, lane, sq); return m ? [m] : [];
  }
  function usePower(s, k, lane, sq) {
    const pw = s.powers && s.powers[k];
    if (!pw) return 'none';
    if (s.phase !== 'running') return 'over';
    if (s.round < pw.ready) return 'cooldown';
    const hit = powerTargets(s, k, lane, sq);
    if (!hit.length) return 'target';
    if (k === 'swat' && traits(hit[0]).boss) return 'boss';
    s.now = s.time;
    pw.ready = s.round + pw.every;
    s.stats.powers = (s.stats.powers || 0) + 1;
    if (k === 'pounce') {
      emit(s, { type: 'pounce', lane, sq, ids: hit.map(m => m.id) });
      for (const m of hit) addStatus(s, m, 'paralysed', 1, null);
    } else {
      const m = hit[0];
      emit(s, { type: 'swat', id: m.id, lane: m.lane, sq: m.sq });
      m.hp = 0; m.alive = false; m.swatted = true;
      died(s, m, null);
    }
    return null;
  }
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

  // the price of a hero's next level, or null at level 3; level 3 needs a path
  function upgradeCost(u) { const h = HEROES[u.type]; return h && h.up && u.level < 3 ? h.up[u.level - 1] : null; }
  function levelUp(s, id, path) {
    const u = s.units.find(x => x.alive && x.id === id);
    if (!u || u.kind !== 'hero' || HEROES[u.type].ally) return 'none';
    if (s.phase !== 'running') return 'over';
    const cost = upgradeCost(u);
    if (cost == null) return 'max';
    if (u.level === 2 && !(PATHS[u.type] && PATHS[u.type][path])) return 'path';
    if (s.gold < cost) return 'gold';
    s.now = s.time; s.gold -= cost; u.spent += cost; u.level++;
    const extra = Math.ceil(HEROES[u.type].hp * 0.25);
    u.maxHp += extra; u.hp += extra;
    if (u.level === 3) {
      u.path = path;
      if (path === 'berserker') u.rages = 2;
      if (path === 'stonehide') u.ac += 2;
    }
    s.stats.levels++;
    emit(s, { type: 'levelup', id: u.id, level: u.level, path: u.path, cost, hp: u.hp, maxHp: u.maxHp });
    if (path === 'houndmaster') callHound(s, u);
    return null;
  }

  // what a hero is worth if called back to the tavern: half of what was spent on it
  function refundOf(u) { return Math.floor((u.spent != null ? u.spent : HEROES[u.type].cost) / 2); }
  function recall(s, id) {
    const u = s.units.find(x => x.alive && x.id === id);
    if (!u || u.kind !== 'hero' || HEROES[u.type].ally) return 'none';
    if (s.phase !== 'running') return 'over';
    if (u.inside) return 'inside';
    const refund = refundOf(u);
    s.now = s.time;
    u.alive = false; s.gold += refund; s.stats.recalled++;
    if (s.free && s.free[u.type] != null) s.free[u.type]++; // a puzzle's hero goes back on the bench
    emit(s, { type: 'recall', id: u.id, refund });
    return null;
  }

  // the next wave, for the preview shown during a rest: who is coming and through which doors
  function preview(s) {
    const b = battle(s);
    if (s.phase !== 'running' || s.waveActive || s.wave >= lastWave(b)) return null;
    const w = waveOf(b, s.wave + 1), counts = {};
    for (const p of w.parsed) counts[p.type] = (counts[p.type] || 0) + p.count;
    const doors = w.parsed.some(p => p.door == null) ? doorPool(s, w) : [];
    for (const p of w.parsed) if (p.door != null && doors.indexOf(p.door) < 0) doors.push(p.door);
    doors.sort((a, b) => a - b);
    return { index: s.wave + 1, total: b.endless ? 0 : b.waves.length, name: w.name, rounds: Math.max(0, s.nextWaveRound - s.round), counts, doors };
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

  /* The party: six heroes chosen before a battle, with a reason for each suggestion drawn from the battle's monsters. */
  const PARTY = 6;
  const HERO_TYPES = Object.keys(HEROES).filter(ty => !HEROES[ty].ally && !HEROES[ty].defender);
  const DEFENDER_TYPES = Object.keys(HEROES).filter(ty => HEROES[ty].defender);
  // roster: the heroes a campaign has so far (all of them if left out)
  function suggestLoadout(battleId, roster) {
    const b = makeBattle(battleId) || BATTLES[0], tr = b.monsters.map(ty => MONSTERS[ty].traits);
    const count = k => tr.filter(x => x[k]).length;
    const why = {
      bard: 'Gold pays for everything else, and only a Bard earns it.',
      fighter: 'Cheap, tough, and holds a row.',
      ranger: count('flying') ? 'Flyers leap your first hero. Rangers behind it shoot them down.' : 'Shoots anything in its row, at any range.',
      wizard: count('resist') ? (count('resist') === 1 ? 'One kind here shrugs' : count('resist') + ' kinds here shrug') + ' off weapons. Spells hit in full.' : 'Fireballs for the crowds.',
      cleric: count('undead') ? (count('undead') === 1 ? 'One kind of undead here' : count('undead') + ' kinds of undead here') + ', and Sacred Flame burns undead twice as hard.' : count('paralyse') ? 'Cures paralysis.' : 'Keeps the front line standing.',
      rogue: 'Stabs sideways, so nothing slips past in the next row.',
      barbarian: count('boss') ? 'A boss is coming. Save a charge for it.' : 'A charge for the moment a row is about to break.',
      paladin: count('invisible') ? 'Its light shows up the invisible ones, and its aura keeps neighbours standing.' : count('undead') ? 'Divine Smite burns undead twice as hard, and its aura keeps its neighbours standing.' : 'An aura that keeps its neighbours standing, and smites.',
      druid: count('fireStops') ? 'Produce Flame stops trolls healing, and Entangle slows the rush.' : 'Entangle slows a whole crowd at once.',
      monk: count('rust') ? 'No armour for the rust monsters to eat.' : 'Stuns the big ones and catches arrows.',
      warlock: count('shieldwall') ? 'Eldritch Blast is magic, so the shield wall does not stop it, and it knocks them back.' : 'Knocks monsters back a square with every hit.',
      sorcerer: 'Lightning that jumps from row to row through a crowd.',
      tinker: 'A ballista and a trap or two where the monsters have to walk.'
    };
    // how much of this battle each kind of trouble is: its share of all the monsters' hit points, wave by wave
    // (flyers by headcount instead: a swarm of bats is small in hit points and still a wave of its own)
    const share = {}; let total = 0, rangedHp = 0, heads = 0, flyers = 0;
    const tally = (st, v, n) => { total += v; heads += n; if (st.traits.flying) flyers += n; if (st.attack.kind === 'ranged') rangedHp += v; for (const k in st.traits) if (st.traits[k]) share[k] = (share[k] || 0) + v; };
    for (const w of b.waves || []) for (const sp of (w.parsed || [])) if (MONSTERS[sp.type]) tally(MONSTERS[sp.type], MONSTERS[sp.type].hp * (sp.count || 1), sp.count || 1);
    if (!total) for (const ty of b.monsters) tally(MONSTERS[ty], 1, 1);
    const p = k => k === 'flying' ? Math.max(heads ? flyers / heads : 0, total ? (share[k] || 0) / total : 0) : total ? (share[k] || 0) / total : 0, ranged = total ? rangedHp / total : 0, wide = (MAP_BY_ID[b.map] || {}).h > 5 ? 1 : 0;
    // how well each hero suits these monsters. The Bard always comes (nothing else earns gold); then the best wall, shooter and
    // caster for this battle, and two more, each from a job the party doesn't have yet unless a second of one suits far better
    const score = { bard: 200, fighter: 55 - 60 * p('rust'), paladin: 45 + 25 * p('undead') + 60 * p('invisible') + 40 * p('charm') + 40 * p('radiantStops'),
      monk: 48 + 60 * p('rust') + 30 * ranged, ranger: 55 + 40 * p('flying') - 30 * p('shieldwall') - 20 * p('resist'),
      warlock: 48 + 50 * p('shieldwall') + 40 * p('engulf') + 15 * p('resist'), tinker: 46 + 30 * p('burrow') + (b.crowds ? 6 : 0),
      sorcerer: 48 + 25 * p('small') + 4 * wide, wizard: 55 + 25 * p('resist') + 10 * p('small'), druid: 50 + 60 * p('fireStops') + 10 * p('small'),
      cleric: 44 + 30 * p('undead') + 40 * p('paralyse') + 40 * p('invisible'), rogue: 45 + 10 * p('small'), barbarian: 42 + 40 * p('boss') };
    const cats = b.cats || {}; // the cats' own picks for this battle: one of the spare places, not instead of the wall, shooter or caster
    for (const ty in cats) why[ty] = cats[ty];
    const pool = Array.isArray(roster) && roster.length ? HERO_TYPES.filter(ty => roster.indexOf(ty) >= 0) : HERO_TYPES;
    const JOB = { bard: 'income', fighter: 'wall', paladin: 'wall', monk: 'wall', ranger: 'shooter', warlock: 'shooter', tinker: 'shooter',
      sorcerer: 'caster', wizard: 'caster', druid: 'caster', cleric: 'healer', rogue: 'flank', barbarian: 'charge' };
    const rank = (list, adj) => list.filter(ty => pool.indexOf(ty) >= 0).sort((x, y) => (adj ? adj(y) - adj(x) : (score[y] || 0) - (score[x] || 0)) || HERO_TYPES.indexOf(x) - HERO_TYPES.indexOf(y));
    const chosen = [];
    for (const job of [['bard'], ['fighter', 'paladin', 'monk'], ['ranger', 'warlock', 'tinker', 'sorcerer'], ['wizard', 'druid', 'sorcerer']]) {
      const ty = rank(job.filter(t => chosen.indexOf(t) < 0))[0]; // the Sorcerer can be the shooter or the caster, not both
      if (ty) chosen.push(ty);
    }
    while (chosen.length < Math.min(PARTY, pool.length)) {
      const have = chosen.map(t => JOB[t]), adj = t => (score[t] || 0) + (cats[t] ? 25 : 0) - (have.indexOf(JOB[t]) >= 0 && !cats[t] ? 15 : 0);
      chosen.push(rank(pool.filter(t => chosen.indexOf(t) < 0), adj)[0]);
    }
    return { pick: pool.filter(ty => chosen.indexOf(ty) >= 0), why, size: Math.min(PARTY, pool.length) };
  }

  function describe(type) {
    const st = MONSTERS[type];
    if (!st) return HEROES[type] ? HEROES[type].info : '';
    const t = st.traits, a = st.attack, bits = [];
    const say = k => { const tx = TRAITS[k].text, v = t[k]; if (v && tx) bits.push(typeof tx === 'function' ? tx(v, type) : tx); };
    say('boss'); say('undead');
    if (a.range > 1) bits.push((a.kind === 'ranged' ? 'Attacks from ' : 'Reaches ') + a.range + ' squares away');
    say('flying');
    if (st.speed >= 1.5) bits.push('Fast: can move two squares a turn');
    for (const k of Object.keys(TRAITS)) if (k !== 'boss' && k !== 'undead' && k !== 'flying') say(k);
    if (a.extra && !t.charm && !t.burrow) bits.push('Poisonous bite');
    if (!bits.filter(b => b !== 'Boss' && b !== 'Undead').length) bits.push(st.speed <= 0.5 ? 'Slow and heavy' : 'Walks straight at your line');
    return bits.join('. ') + '.';
  }

  // compiled once at load, so a typo in a map or the battle data fails straight away rather than mid-game
  for (const id of Object.keys(MAPS)) MAP_BY_ID[id] = compileMap(id, MAPS[id]);
  function compileWave(b, w) {
    const map = MAP_BY_ID[b.map];
    w.parsed = parseSpawns(w.spawns);
    for (const i of (w.doors || [])) if (!map.doors[i]) throw new Error('Hold the Line: battle ' + b.id + ' uses door ' + i + ', which ' + b.map + ' does not have');
    for (const p of w.parsed) if (p.door != null && !map.doors[p.door]) throw new Error('Hold the Line: battle ' + b.id + ' sends a monster through door ' + p.door + ', which ' + b.map + ' does not have');
    return w;
  }
  /* A battle: the campaign's own, or one the modes make. endless: true with more(i) makes wave i when it is needed;
     pool then lists every monster it can send. puzzle: { heroes: { type: count } } gives those heroes free and nothing else.
     fixed: true plays the same for everyone: its own party, difficulty and seed, and none of the tavern's help.
     crowds: true lets small monsters squeeze three to a square. */
  function addBattle(b) {
    BATTLE_BY_ID[b.id] = b;
    b.map = b.map || 'classic';
    if (!MAP_BY_ID[b.map]) throw new Error('Hold the Line: battle ' + b.id + ' uses unknown map ' + b.map);
    if (b.endless) b.waves = b.waves || [];
    const types = (b.pool || []).slice();
    for (const w of b.waves) {
      compileWave(b, w);
      for (const p of w.parsed) if (types.indexOf(p.type) < 0) types.push(p.type);
    }
    for (const t of types) if (!MONSTERS[t]) throw new Error('Hold the Line: battle ' + b.id + ' sends an unknown monster, ' + t);
    for (const t in ((b.puzzle && b.puzzle.heroes) || {})) if (!HEROES[t] || HEROES[t].ally) throw new Error('Hold the Line: puzzle ' + b.id + ' gives an unknown hero, ' + t);
    b.monsters = types;
    const lv = types.map(t => MONSTERS[t].level);
    b.levels = [Math.min.apply(null, lv), Math.max.apply(null, lv)];
    return b;
  }
  for (const b of BATTLES) addBattle(b);
  // the modes make battles from an id such as daily:2026-11-08; the same id always makes the same battle
  const MAKERS = {};
  function makeBattle(id) {
    if (BATTLE_BY_ID[id]) return BATTLE_BY_ID[id];
    const m = /^([a-z]+):(.*)$/.exec(typeof id === 'string' ? id : '');
    if (!m || !MAKERS[m[1]]) return null;
    const def = MAKERS[m[1]](m[2]);
    if (!def) return null;
    def.id = id; def.mode = m[1];
    return addBattle(def);
  }
  function addMaker(kind, fn) { MAKERS[kind] = fn; }
  // wave i of a battle, made now if the battle is endless
  function waveOf(b, i) { while (b.endless && b.waves.length <= i) b.waves.push(compileWave(b, b.more(b.waves.length))); return b.waves[i]; }
  const lastWave = b => (b.endless ? Infinity : b.waves.length - 1);

  const PACK = { id: P.id, name: P.name, heroes: HEROES, monsters: MONSTERS, battles: BATTLES, maps: MAP_BY_ID, parts: P.parts || {} };
  return { ROUND, PACK, TRAITS, HEROES, MONSTERS, BATTLES, MAPS: MAP_BY_ID, STATUSES, PATHS, DIFFICULTY, PARTY, HERO_TYPES, DEFENDER_TYPES, TAVERN, tavernOf, ITEMS, POWERS, usePower, powerTargets, itemOf, _heroAttack: heroAttack, trapAt,
    newGame, step, place, canPlace, recall, refundOf, preview, levelUp, upgradeCost, suggestLoadout, unitAt, addUnit, slot, battle, mapOf, cellAt, describe, autoplay, parseSpawns,
    addStatus, hasStatus, nearestAhead, heroInReach,
    battleById: id => makeBattle(id), addMaker, waveOf, send, canSend, sendCost, SEND, THROWS, throwItem, canThrow,
    canShutGate, shutGate, stepOf, sunlit, _risky: risky, _attack: attack, _fireball: fireball };
})(HTL_PACKS.core);
