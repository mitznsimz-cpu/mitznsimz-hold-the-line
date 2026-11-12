// Headless harness for Hold the Line.
// Runs the rules engine and its content pack in a Node VM, alongside the shared minis.
// Usage: node tests/hold-the-line.test.js [path/to/game folder] [--quick]   (the folder defaults to the repo root)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const dir = args.find(a => !a.startsWith('--')) || (fs.existsSync(path.join(__dirname, '..', 'sim.js')) ? path.join(__dirname, '..') : path.join(__dirname, '..', 'hold-the-line')); // the repo root, or the working folder
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(read('pack-core.js'), sandbox, { filename: 'pack-core.js' });
vm.runInContext(read('sim.js'), sandbox, { filename: 'sim.js' });
vm.runInContext(read('simz.js'), sandbox, { filename: 'simz.js' });
vm.runInContext(read('modes.js'), sandbox, { filename: 'modes.js' });
vm.runInContext(read('campaign.js'), sandbox, { filename: 'campaign.js' });
vm.runInContext(read('mitznsimz_minis.js'), sandbox, { filename: 'mitznsimz_minis.js' });
const HTL = sandbox.HTL, Minis = sandbox.TableMinis;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ---------- helpers ----------
const TICK = 0.05;
function stepRounds(s, n) { const target = s.round + n; let guard = 0; while (s.round < target && guard++ < 100000) HTL.step(s, TICK); }
function bare(seed, battleId) { // a game with no waves scheduled, for rule tests
  const s = HTL.newGame(seed || 7, battleId);
  s.nextWaveRound = 1e9;
  return s;
}
function put(s, kind, type, lane, sq) { return HTL.addUnit(s, kind, type, lane, sq); }
function tough(u) { u.hp = u.maxHp = 999; return u; }
const events = (s, type) => s.events.filter(e => e.type === type);

function play(seed, battleId, brain, tick, opts) {
  const s = HTL.newGame(seed, battleId, opts);
  let lastRound = -1, guard = 0;
  const log = [];
  while (s.phase === 'running' && guard++ < 40000) {
    if (brain && s.round !== lastRound) { lastRound = s.round; brain(s); }
    HTL.step(s, tick || TICK);
    for (const ev of s.events.splice(0)) log.push(ev);
  }
  return { s, log };
}
const slow = s => { // a hesitant player: one hero every third round, no reacting to threats
  if (s.round % 3) return;
  const before = s.stats.placed;
  const PLAN = [['bard', 2, 0], ['bard', 1, 0], ['ranger', 2, 1], ['ranger', 1, 1], ['ranger', 3, 1], ['ranger', 0, 1], ['ranger', 4, 1],
    ['fighter', 2, 4], ['fighter', 1, 4], ['fighter', 3, 4], ['fighter', 0, 4], ['fighter', 4, 4], ['wizard', 2, 2], ['wizard', 1, 2], ['wizard', 3, 2],
    ['fighter', 2, 5], ['fighter', 1, 5], ['fighter', 3, 5], ['wizard', 0, 2], ['wizard', 4, 2]];
  for (const [type, lane, sq] of PLAN) {
    const why = HTL.canPlace(s, type, lane, sq);
    if (why === 'occupied' || why === 'off') continue;
    if (!why) HTL.place(s, type, lane, sq);
    break;
  }
  return s.stats.placed - before;
};

console.log('Hold the Line — simulation harness');

// ---------- dice and the core rules ----------
test('a natural 20 always hits and doubles the damage dice', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1); const g = put(s, 'monster', 'goblin', 2, 5);
  g.ac = 99; g.hp = 50; g.maxHp = 50;
  s.forced = [20, 8, 8];
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  const ev = events(s, 'attack')[0];
  assert.ok(ev.hit && ev.crit, 'should be a critical hit');
  assert.strictEqual(ev.dmg, 8 + 8 + 3);
});

test('a natural 1 always misses', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1); const g = put(s, 'monster', 'goblin', 2, 5);
  g.ac = 1; s.forced = [1];
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  const ev = events(s, 'attack')[0];
  assert.ok(!ev.hit && ev.fumble);
  assert.strictEqual(g.hp, 7);
});

test('a hit needs the total to meet the armour class', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1); const g = put(s, 'monster', 'goblin', 2, 5);
  s.forced = [9, 1]; // 9 + 6 = 15 vs AC 15: hit
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  s.forced = [8];    // 8 + 6 = 14: miss
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  assert.strictEqual(JSON.stringify(events(s, 'attack').map(e => e.hit)), '[true,false]');
});

test('a monster blocked by a hero attacks instead of moving', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)); const g = tough(put(s, 'monster', 'goblin', 2, 5));
  stepRounds(s, 3);
  assert.strictEqual(g.sq, 5);
  assert.ok(s.events.some(e => e.type === 'attack' && e.from === g.id && e.to === f.id));
});

test('monsters never share a square', () => {
  const s = bare(); tough(put(s, 'hero', 'fighter', 0, 4));
  const a = tough(put(s, 'monster', 'goblin', 0, 5)), b = tough(put(s, 'monster', 'goblin', 0, 7));
  stepRounds(s, 4);
  assert.strictEqual(a.sq, 5); assert.strictEqual(b.sq, 6);
});

test('everyone takes at most one turn a round, in time order', () => {
  const s = bare();
  put(s, 'hero', 'ranger', 0, 1); put(s, 'hero', 'ranger', 1, 1); tough(put(s, 'hero', 'fighter', 2, 4));
  for (let l = 0; l < 3; l++) tough(put(s, 'monster', l === 2 ? 'direWolf' : 'ogre', l, 7));
  stepRounds(s, 12);
  const acts = s.events.filter(e => e.type === 'attack' || e.type === 'move');
  assert.ok(acts.length > 20, 'expected plenty of actions');
  const turns = {};
  let lastT = -1;
  for (const e of acts) {
    const who = e.type === 'move' ? e.id : e.from;
    const key = Math.floor((e.t + 1e-9) / HTL.ROUND) + ':' + who;
    (turns[key] = turns[key] || new Set()).add(e.t.toFixed(6));
    assert.ok(turns[key].size === 1, 'unit ' + who + ' acted at two different times in one round');
    assert.ok(e.t >= lastT - 1e-9, 'actions ran out of time order');
    lastT = e.t;
  }
});

test('Fireball catches a 3×3 area and nothing outside it', () => {
  const s = bare(); const w = put(s, 'hero', 'wizard', 2, 1);
  const centre = put(s, 'monster', 'ogre', 2, 5), diag = put(s, 'monster', 'ogre', 3, 6), far = put(s, 'monster', 'ogre', 2, 7), wide = put(s, 'monster', 'ogre', 0, 5);
  HTL._fireball(s, w, centre, HTL.HEROES.wizard.spell);
  const hitIds = events(s, 'save').map(e => e.to).sort();
  assert.strictEqual(JSON.stringify(hitIds), JSON.stringify([centre.id, diag.id].sort()));
  assert.strictEqual(far.hp, far.maxHp); assert.strictEqual(wide.hp, wide.maxHp);
});

test('a successful save halves Fireball damage', () => {
  const s = bare(); const w = put(s, 'hero', 'wizard', 2, 1); const o = put(s, 'monster', 'ogre', 2, 5);
  s.forced = [6, 6, 6, 20];
  HTL._fireball(s, w, o, HTL.HEROES.wizard.spell);
  const ev = events(s, 'save')[0];
  assert.ok(ev.saved); assert.strictEqual(ev.dmg, 9);
});

test('placement checks squares, the dungeon row and gold', () => {
  const s = bare();
  assert.strictEqual(HTL.place(s, 'bard', 0, 0), null);
  assert.strictEqual(HTL.place(s, 'bard', 0, 0), 'occupied');
  assert.strictEqual(HTL.place(s, 'bard', 1, 9), 'off');
  assert.strictEqual(HTL.place(s, 'wizard', 1, 1), 'gold');
  assert.strictEqual(s.gold, 100);
});

test('a Bard earns gold on a steady beat', () => {
  const s = bare(); HTL.place(s, 'bard', 0, 0);
  const g0 = s.gold; stepRounds(s, HTL.HEROES.bard.income.every + 1);
  const per = HTL.HEROES.bard.income;
  assert.ok(s.gold - g0 >= per.gold, 'expected at least one payout');
  assert.strictEqual((s.gold - g0) % per.gold, 0);
});

test('slain monsters pay their bounty', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1); const g = put(s, 'monster', 'goblin', 2, 5);
  const g0 = s.gold; s.forced = [20, 8, 8];
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  assert.ok(!g.alive);
  assert.strictEqual(s.gold - g0, HTL.MONSTERS.goblin.bounty);
});

test('a monster through the door costs a life; five lose the game', () => {
  const s = bare();
  for (let l = 0; l < 5; l++) put(s, 'monster', 'goblin', l, 0);
  stepRounds(s, 2);
  assert.strictEqual(s.lives, 0); assert.strictEqual(s.phase, 'lost');
});

test('a short rest heals heroes half their missing hit points and clears paralysis', () => {
  const s = HTL.newGame(3);
  const f = put(s, 'hero', 'fighter', 2, 4); f.hp = 10; f.status.paralysed = 1;
  s.waveActive = true; s.wave = 0; s.pending = [];
  HTL.step(s, TICK);
  assert.strictEqual(f.hp, 20); assert.ok(!HTL.hasStatus(f, 'paralysed'));
  assert.ok(s.events.some(e => e.type === 'rest'));
});

// ---------- monster behaviours ----------
test('ranged monsters stop and shoot the nearest hero in reach', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)); const a = tough(put(s, 'monster', 'goblinArcher', 2, 9));
  stepRounds(s, 6);
  assert.strictEqual(a.sq, 8, 'should walk until the Fighter is 4 squares away, then stop');
  const shots = events(s, 'attack').filter(e => e.from === a.id);
  assert.ok(shots.length >= 3 && shots.every(e => e.to === f.id && e.kind === 'ranged'));
});

test('a halberd reaches two squares', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 1, 3)); const w = tough(put(s, 'monster', 'cryptWarden', 1, 5));
  stepRounds(s, 3);
  assert.strictEqual(w.sq, 5);
  assert.ok(events(s, 'attack').some(e => e.from === w.id && e.to === f.id));
});

test('fast monsters can cover two squares in one turn', () => {
  const s = bare(); const h = tough(put(s, 'monster', 'warrenHound', 3, 9));
  stepRounds(s, 4);
  const moves = events(s, 'move').filter(e => e.id === h.id);
  const perTurn = {};
  for (const e of moves) perTurn[e.t] = (perTurn[e.t] || 0) + 1;
  assert.ok(Object.values(perTurn).some(n => n === 2), 'expected a two-square sprint');
  assert.ok(Object.values(perTurn).every(n => n <= 2));
});

test('flying monsters leap the first hero once, then fight normally', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 0, 4)); const b = tough(put(s, 'monster', 'caveBat', 0, 5));
  const back = tough(put(s, 'hero', 'fighter', 0, 2));
  stepRounds(s, 6);
  const leaps = events(s, 'move').filter(e => e.id === b.id && e.leap);
  assert.strictEqual(leaps.length, 1);
  assert.strictEqual(leaps[0].to, 3);
  assert.strictEqual(b.sq, 3, 'blocked by the second hero');
  assert.ok(events(s, 'attack').some(e => e.from === b.id && e.to === back.id), 'should fight the second hero');
  assert.ok(events(s, 'attack').some(e => e.from === f.id && e.to === b.id), 'the leapt Fighter turns round and swings');
});

test('multiattack swings twice a turn', () => {
  const s = bare(); tough(put(s, 'hero', 'fighter', 2, 4)); const c = tough(put(s, 'monster', 'goblinChief', 2, 5));
  stepRounds(s, 3);
  const swings = events(s, 'attack').filter(e => e.from === c.id);
  const times = new Set(swings.map(e => e.t));
  assert.strictEqual(swings.length, times.size * 2);
});

test('weapons do half damage to resistant monsters; spells do full', () => {
  const s = bare(); const f = put(s, 'hero', 'fighter', 2, 4), w = put(s, 'hero', 'wizard', 2, 1);
  const k = tough(put(s, 'monster', 'boneKnight', 2, 5));
  s.forced = [20, 8, 8];
  HTL._attack(s, f, k, HTL.HEROES.fighter.attack);
  s.forced = [20, 10, 10];
  HTL._attack(s, w, k, HTL.HEROES.wizard.attack);
  const [a, b] = events(s, 'attack');
  assert.ok(a.resisted && a.dmg === Math.floor((8 + 8 + 3) / 2));
  assert.ok(!b.resisted && b.dmg === 20);
});

test('regeneration heals a little every turn', () => {
  const s = bare(); const i = put(s, 'monster', 'ironSentinel', 2, 9); i.hp = 10;
  stepRounds(s, 3);
  assert.ok(events(s, 'regen').filter(e => e.id === i.id).every(e => e.amount === 3));
  assert.ok(i.hp >= 16);
});

test('draining monsters heal by half the damage they deal', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)); f.ac = 1;
  const w = put(s, 'monster', 'wight', 2, 5); w.hp = 5;
  stepRounds(s, 3);
  const hits = events(s, 'attack').filter(e => e.from === w.id && e.hit);
  assert.ok(hits.length > 0);
  const drained = events(s, 'regen').filter(e => e.id === w.id && e.drain);
  assert.strictEqual(drained.length, hits.filter(e => e.dmg >= 2).length);
  assert.strictEqual(drained[0].amount, Math.floor(hits[0].dmg / 2));
});

test('a ghoul can paralyse a hero, who then loses a turn', () => {
  const s = bare(); const r = tough(put(s, 'hero', 'ranger', 2, 4)); r.ac = 1;
  const g = tough(put(s, 'monster', 'ghoul', 2, 5));
  s.forced = [15, 4, 4, 5]; // hit, damage 2d4, failed save
  HTL._attack(s, g, r, HTL.MONSTERS.ghoul.attack);
  assert.ok(HTL.hasStatus(r, 'paralysed'));
  assert.ok(events(s, 'paralyse').length === 1);
  s.events.length = 0;
  stepRounds(s, 2);
  assert.ok(events(s, 'stunned').some(e => e.id === r.id));
  assert.ok(!events(s, 'attack').some(e => e.from === r.id && e.t < events(s, 'stunned')[0].t + 0.001), 'no attack on the lost turn');
});

test('a gloom splits in two when first badly hurt, sharing what it has left', () => {
  const s = bare(); const w = put(s, 'hero', 'wizard', 2, 1); const g = put(s, 'monster', 'gloom', 2, 5);
  s.forced = [20, 10, 10]; // crit Fire Bolt: 20 damage, 40 -> 20
  HTL._attack(s, w, g, HTL.HEROES.wizard.attack);
  const sp = events(s, 'spawn').filter(e => e.how === 'split');
  assert.strictEqual(sp.length, 1);
  const clone = s.units.find(u => u.id === sp[0].id);
  assert.strictEqual(g.hp + clone.hp, 20);
  assert.ok(clone.minor && clone.split && g.split);
  s.forced = [20, 1, 1];
  HTL._attack(s, w, g, HTL.HEROES.wizard.attack);
  assert.strictEqual(events(s, 'spawn').filter(e => e.how === 'split').length, 1, 'splits only once');
});

test('summoners call up help on schedule, up to their limit', () => {
  const s = bare(); const lich = tough(put(s, 'monster', 'barrowLich', 2, 9));
  lich.ac = 99;
  stepRounds(s, 40);
  const made = events(s, 'spawn').filter(e => e.how === 'summon' && e.from === lich.id);
  assert.strictEqual(made.length, HTL.MONSTERS.barrowLich.traits.summon.max);
  assert.ok(made.every(e => e.unitType === 'skeleton'));
});

test('summoned and split monsters pay half bounty, and minions cannot summon', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1);
  const wisp = tough(put(s, 'monster', 'emberWisp', 2, 9));
  stepRounds(s, 4);
  const kids = s.units.filter(u => u.minor && u.type === 'emberWisp');
  assert.strictEqual(kids.length, 1);
  assert.strictEqual(kids[0].made, 0);
  const g0 = s.gold; kids[0].hp = 1; kids[0].ac = 1; s.forced = [15, 1];
  HTL._attack(s, r, kids[0], HTL.HEROES.ranger.attack);
  assert.strictEqual(s.gold - g0, Math.floor(HTL.MONSTERS.emberWisp.bounty / 2));
  void wisp;
});

test('a Fallen Priest mends the worst-hurt monster near him', () => {
  const s = bare(); const p = tough(put(s, 'monster', 'fallenPriest', 2, 9));
  const o = put(s, 'monster', 'orc', 3, 8); o.hp = 2;
  stepRounds(s, 3);
  const m = events(s, 'mend');
  assert.ok(m.length >= 1 && m[0].from === p.id && m[0].id === o.id);
  assert.ok(o.hp > 2);
});

// ---------- the newer heroes ----------
test('a Cleric heals the most hurt hero within two squares', () => {
  const s = bare(); const c = put(s, 'hero', 'cleric', 2, 3);
  const a = put(s, 'hero', 'fighter', 0, 5); a.hp = 20;   // 10 down, two squares off diagonally
  const b = put(s, 'hero', 'fighter', 2, 6); b.hp = 1;    // three squares away: out of reach
  s.forced = [5];
  HTL.step(s, 2.05); // round 1 starts and everyone acts
  const cures = events(s, 'cure');
  assert.strictEqual(cures.length, 1);
  assert.strictEqual(cures[0].id, a.id); assert.strictEqual(a.hp, 28);
  void c; void b;
});
test('a Cleric cures paralysis even when nobody is hurt', () => {
  const s = bare(); const c = put(s, 'hero', 'cleric', 2, 3); const r = put(s, 'hero', 'ranger', 3, 3); r.status.paralysed = 1;
  c.init = 30; r.init = -10; // the Cleric acts before the Ranger would lose its turn
  HTL.step(s, 2.05);
  const cure = events(s, 'cure')[0];
  assert.ok(cure && cure.id === r.id && cure.cured); assert.ok(!HTL.hasStatus(r, 'paralysed'));
});
test('with nobody to heal, Sacred Flame burns undead twice as hard', () => {
  const s = bare(); const c = put(s, 'hero', 'cleric', 2, 1);
  const sk = tough(put(s, 'monster', 'skeleton', 2, 6)), orc = tough(put(s, 'monster', 'orc', 2, 7));
  s.forced = [15, 4, 4];
  HTL._attack(s, c, sk, HTL.HEROES.cleric.attack);
  s.forced = [15, 4];
  HTL._attack(s, c, orc, HTL.HEROES.cleric.attack);
  const [a, b] = events(s, 'attack');
  assert.ok(a.holy && a.dmg === 8, 'two dice against undead');
  assert.ok(!b.holy && b.dmg === 4, 'one die against the living');
});
test('a Rogue stabs a monster in the next lane', () => {
  const s = bare(); const r = put(s, 'hero', 'rogue', 2, 3); const g = tough(put(s, 'monster', 'goblin', 3, 4));
  HTL.step(s, 2.05);
  const hits = events(s, 'attack').filter(e => e.from === r.id);
  assert.ok(hits.length === 1 && hits[0].to === g.id);
});
test('Sneak Attack adds 2d6 only when another hero is next to the target', () => {
  const s = bare(); const r = put(s, 'hero', 'rogue', 2, 3); const g = tough(put(s, 'monster', 'orc', 3, 4));
  s.forced = [15, 3, 6, 6, 1]; HTL.step(s, 2.05);       // alone: no sneak attack, the extra dice stay unrolled
  const lone = events(s, 'attack').find(e => e.from === r.id);
  assert.ok(!lone.sneak && lone.dmg === 3 + 4);
  s.forced = []; s.events.length = 0;
  put(s, 'hero', 'fighter', 3, 3);                        // now a Fighter stands beside the orc
  stepRounds(s, 1);
  const flank = events(s, 'attack').find(e => e.from === r.id);
  assert.ok(flank && flank.sneak, 'expected a sneak attack');
});
test('a Barbarian waits for a monster, then charges, sweeps the 3×3 and is spent', () => {
  const s = bare(); const b = put(s, 'hero', 'barbarian', 2, 1);
  HTL.step(s, 2.05);
  assert.ok(b.alive && !events(s, 'charge').length, 'nothing to charge at yet');
  const t = tough(put(s, 'monster', 'ogre', 2, 6)), side = tough(put(s, 'monster', 'goblin', 1, 7)), far = tough(put(s, 'monster', 'goblin', 4, 6));
  stepRounds(s, 1);
  const ch = events(s, 'charge');
  assert.strictEqual(ch.length, 1); assert.strictEqual(ch[0].to, 5);
  const swings = events(s, 'attack').filter(e => e.from === b.id);
  assert.strictEqual(JSON.stringify(swings.map(e => e.to)), JSON.stringify([t.id, side.id]));
  assert.ok(swings.every(e => e.low > 0 && e.roll >= e.low), 'rolled with advantage');
  assert.ok(!b.alive && events(s, 'spent').length === 1);
  assert.ok(!events(s, 'death').some(e => e.id === b.id) && s.stats.fallen === 0, 'spent, not killed');
  void far;
});
test('Barbarians recharge between placements', () => {
  const s = bare(); s.gold = 1000;
  assert.strictEqual(HTL.place(s, 'barbarian', 0, 1), null);
  assert.strictEqual(HTL.place(s, 'barbarian', 1, 1), 'recharging');
  stepRounds(s, HTL.HEROES.barbarian.recharge);
  assert.strictEqual(HTL.place(s, 'barbarian', 1, 1), null);
});

// ---------- maps, terrain, doors, statuses, recall ----------
const onMap = { pillars: 'vaults', flooded: 'flooded', bridge: 'bridge' }; // a battle fought on each new map
const at = (u) => u.lane + ',' + u.sq;
test('every battle is on a known map, and every map lets each door reach the tavern', () => {
  for (const b of HTL.BATTLES) assert.ok(HTL.MAPS[b.map], b.id + ' uses ' + b.map);
  for (const id in HTL.MAPS) {
    const m = HTL.MAPS[id];
    for (const d of m.doors) {
      let p = { lane: d.lane, sq: d.sq }, steps = 0;
      while (!p.exit && steps++ < 100) p = m.nextWalk[p.lane][p.sq];
      assert.ok(p && p.exit, id + ': door at ' + at(d) + ' never reaches the tavern');
    }
  }
  for (const id in onMap) assert.strictEqual(HTL.battleById(onMap[id]).map, id);
});
test('spawn tokens can name a door', () => {
  const p = HTL.parseSpawns('goblin:0 goblin:3*2@4');
  assert.strictEqual(p[0].door, null); assert.strictEqual(p[1].door, 4); assert.strictEqual(p[1].count, 2);
});
test('Simz only plans squares a hero can stand on, on every map', () => {
  for (const id in onMap) {
    const s = bare(1, onMap[id]);
    for (const [type, lane, sq] of HTL.MAPS[id].plan) assert.notStrictEqual(HTL.canPlace(s, type, lane, sq), 'off', id + ' ' + type + ' ' + lane + ',' + sq);
  }
});
test('pillars, pits and doors cannot hold a hero', () => {
  const v = bare(1, 'vaults'); v.gold = 999;
  assert.strictEqual(HTL.canPlace(v, 'fighter', 0, 4), 'off', 'pillar');
  assert.strictEqual(HTL.canPlace(v, 'fighter', 0, 9), 'off', 'door');
  assert.strictEqual(HTL.canPlace(v, 'fighter', 0, 3), null);
  const b = bare(1, 'bridge'); b.gold = 999;
  assert.strictEqual(HTL.canPlace(b, 'fighter', 0, 4), 'off', 'pit');
  assert.strictEqual(HTL.canPlace(b, 'fighter', 1, 2), null, 'high ground');
  const f = bare(1, 'flooded'); f.gold = 999;
  assert.strictEqual(HTL.canPlace(f, 'fighter', 0, 7), 'off', 'outside the mat');
  assert.strictEqual(HTL.canPlace(f, 'fighter', 1, 3), null, 'heroes can stand in the water');
});
test('walkers go round a pillar, and say which row they stepped into', () => {
  const s = bare(1, 'vaults'); const g = tough(put(s, 'monster', 'goblin', 0, 5));
  stepRounds(s, 2);
  assert.strictEqual(at(g), '1,5');
  const mv = events(s, 'move').find(e => e.id === g.id);
  assert.strictEqual(mv.fromLane, 0); assert.strictEqual(mv.lane, 1);
});
test('a pillar blocks the view both ways', () => {
  const s = bare(1, 'vaults');
  const r = put(s, 'hero', 'ranger', 0, 1), a = tough(put(s, 'monster', 'skelArcher', 0, 6));
  assert.strictEqual(HTL.nearestAhead(s, 0, 1), null, 'the Ranger cannot see past the pillar');
  assert.strictEqual(HTL.heroInReach(s, a, 4), null, 'the archer cannot see past it either');
  a.sq = 3;
  assert.strictEqual(HTL.nearestAhead(s, 0, 1), a);
  assert.strictEqual(HTL.heroInReach(s, a, 4), r);
});
test('walkers wade through water at half speed, and take the dry way round when it is shorter', () => {
  const s = bare(1, 'flooded'); const g = tough(put(s, 'monster', 'goblin', 2, 4));
  assert.strictEqual(HTL.mapOf(s).rows[2][3], '~');
  stepRounds(s, 2); assert.strictEqual(g.sq, 4, 'one turn is not enough to wade a square');
  stepRounds(s, 1); assert.strictEqual(g.sq, 3);
  const dry = HTL.MAPS.flooded.nextWalk[1][5];
  assert.strictEqual(dry.lane + ',' + dry.sq, '0,5', 'round the pool, not through it');
  const bat = HTL.MAPS.flooded.nextFly[1][5];
  assert.strictEqual(bat.lane + ',' + bat.sq, '1,4', 'flyers do not care');
});
test('walkers go round the chasm; flyers cross it', () => {
  const m = HTL.MAPS.bridge;
  let p = { lane: 0, sq: 9 }; const seen = [];
  while (!p.exit) { seen.push(m.rows[p.lane][p.sq]); p = m.nextWalk[p.lane][p.sq]; }
  assert.ok(seen.indexOf('o') < 0, 'a walker stepped into the pit');
  const f = m.nextFly[0][7];
  assert.strictEqual(f.lane + ',' + f.sq, '0,6');
  const s = bare(1, 'bridge'); const b = tough(put(s, 'monster', 'caveBat', 0, 8));
  stepRounds(s, 4);
  assert.strictEqual(b.lane, 0); assert.ok(b.sq <= 5, 'the bat flew out over the pit');
});
test('high ground gives a hero +2 to hit', () => {
  const s = bare(1, 'bridge'); const r = put(s, 'hero', 'ranger', 1, 2), g = tough(put(s, 'monster', 'goblin', 1, 7));
  s.forced = [10, 3];
  HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  const ev = events(s, 'attack')[0];
  assert.ok(ev.high); assert.strictEqual(ev.bonus, HTL.HEROES.ranger.attack.bonus + 2); assert.strictEqual(ev.total, 10 + ev.bonus);
  const low = put(s, 'hero', 'ranger', 2, 2); s.forced = [10, 3];
  HTL._attack(s, low, g, HTL.HEROES.ranger.attack);
  assert.ok(!events(s, 'attack')[1].high);
});
test('holy ground burns undead that start a turn on it, and nobody else', () => {
  const s = bare(1, 'flooded');
  assert.strictEqual(HTL.mapOf(s).rows[2][5], '+');
  const sk = put(s, 'monster', 'skeleton', 2, 5); tough(put(s, 'hero', 'fighter', 2, 4));
  stepRounds(s, 2);
  const burn = events(s, 'burn').filter(e => e.id === sk.id);
  assert.strictEqual(burn.length, 1); assert.strictEqual(burn[0].dmg, 2);
  const s2 = bare(1, 'flooded'); put(s2, 'monster', 'goblin', 2, 5); tough(put(s2, 'hero', 'fighter', 2, 4));
  stepRounds(s2, 3);
  assert.strictEqual(events(s2, 'burn').length, 0, 'a goblin is not undead');
});
test('a wave arrives only through its own doors, and a named door is used', () => {
  const s = HTL.newGame(5, 'flooded');
  stepRounds(s, HTL.battleById('flooded').waves[0].parsed.reduce((m, p) => Math.max(m, p.at), 0) + 7);
  const first = events(s, 'spawn').filter(e => e.how === 'arrive');
  assert.ok(first.length > 3);
  assert.ok(first.every(e => e.sq === 9 && e.lane >= 1 && e.lane <= 3), 'side doors stay shut in the first wave');
  const t = HTL.newGame(5, 'flooded'); t.wave = 1; t.nextWaveRound = 1;
  stepRounds(t, 2);
  const arr = events(t, 'spawn').filter(e => e.how === 'arrive' && e.unitType === 'ghoul');
  assert.strictEqual(arr.map(e => e.lane + ',' + e.sq).sort().join(' '), '0,6 4,6');
});
test('a monster whose door is blocked comes in through another door of its wave', () => {
  const s = HTL.newGame(5, 'flooded'); s.wave = 1; s.nextWaveRound = 1;
  tough(put(s, 'monster', 'ogre', 0, 6)); tough(put(s, 'monster', 'ogre', 4, 6));
  stepRounds(s, 2);
  const g = events(s, 'spawn').filter(e => e.how === 'arrive' && e.unitType === 'ghoul');
  assert.strictEqual(g.length, 2);
  assert.ok(g.every(e => e.sq === 9), 'came through the other doors');
});
test('the wave preview lists who is coming and through which doors', () => {
  const s = HTL.newGame(5, 'flooded');
  let p = HTL.preview(s);
  assert.strictEqual(p.index, 0); assert.strictEqual(p.doors.join(), '1,2,3');
  assert.strictEqual(p.counts.skeleton, 2 + 2 + 2);
  s.wave = 1;
  p = HTL.preview(s);
  assert.strictEqual(p.doors.join(), '0,1,2,3,4');
  s.waveActive = true;
  assert.strictEqual(HTL.preview(s), null, 'no preview while a wave is on the mat');
});
test('recalling a hero refunds half its cost and frees the square', () => {
  const s = bare(); s.gold = 200;
  HTL.place(s, 'wizard', 2, 2);
  const w = HTL.unitAt(s, 2, 2);
  assert.strictEqual(HTL.refundOf(w), 75);
  assert.strictEqual(HTL.recall(s, w.id), null);
  assert.strictEqual(s.gold, 50 + 75);
  assert.strictEqual(HTL.unitAt(s, 2, 2), null);
  assert.strictEqual(s.stats.recalled, 1); assert.strictEqual(s.stats.fallen, 0);
  assert.strictEqual(events(s, 'recall')[0].refund, 75);
  assert.strictEqual(HTL.recall(s, w.id), 'none', 'cannot recall twice');
  const g = put(s, 'monster', 'goblin', 1, 5);
  assert.strictEqual(HTL.recall(s, g.id), 'none', 'monsters cannot be recalled');
});
test('poison bites at the start of each turn, and wears off', () => {
  const s = bare(); const g = tough(put(s, 'monster', 'goblin', 2, 8));
  HTL.addStatus(s, g, 'poisoned', 2);
  stepRounds(s, 5);
  const bites = events(s, 'poison').filter(e => e.id === g.id);
  assert.strictEqual(bites.length, 2);
  assert.ok(bites.every(e => e.dmg >= 1 && e.dmg <= 4));
});
test('a slowed monster moves at half speed while it lasts', () => {
  const s = bare(); const g = tough(put(s, 'monster', 'goblin', 2, 8)), h = tough(put(s, 'monster', 'goblin', 3, 8));
  HTL.addStatus(s, g, 'slowed', 2);
  stepRounds(s, 3);
  assert.strictEqual(h.sq, 6); assert.strictEqual(g.sq, 7);
});
test('a short rest, or a Cleric, clears poison and slowing from heroes', () => {
  const s = HTL.newGame(3); const f = tough(put(s, 'hero', 'fighter', 2, 4));
  HTL.addStatus(s, f, 'poisoned', 5); HTL.addStatus(s, f, 'slowed', 5);
  s.waveActive = true; s.wave = 0; s.pending = [];
  HTL.step(s, TICK);
  assert.ok(!HTL.hasStatus(f, 'poisoned') && !HTL.hasStatus(f, 'slowed'));
});

test('Simz does not put a Bard in front of a monster that has got behind the line', () => {
  const s = bare(); s.gold = 50;
  tough(put(s, 'monster', 'wraith', 4, 1)).hopped = true;
  for (const [l, q] of [[0, 0], [1, 0], [2, 0], [3, 0]]) put(s, 'hero', 'bard', l, q);
  HTL.autoplay(s);
  assert.strictEqual(HTL.unitAt(s, 4, 0), null);
});

// ---------- levels, paths, allies, difficulty, the party ----------
function lvl(s, u, path) { // straight to level 3 on the given path (or level 2 if none)
  s.gold += 1000;
  assert.strictEqual(HTL.levelUp(s, u.id), null);
  if (path) assert.strictEqual(HTL.levelUp(s, u.id, path), null);
  return u;
}
test('levelling up costs gold, adds +1 to hit, +1 damage and a quarter more hit points each level', () => {
  const s = bare(); s.gold = 1000; HTL.place(s, 'ranger', 2, 1);
  const r = HTL.unitAt(s, 2, 1), hp = r.maxHp;
  assert.strictEqual(HTL.upgradeCost(r), HTL.HEROES.ranger.up[0]);
  const g0 = s.gold; assert.strictEqual(HTL.levelUp(s, r.id), null);
  assert.strictEqual(s.gold, g0 - HTL.HEROES.ranger.up[0]); assert.strictEqual(r.level, 2); assert.strictEqual(r.maxHp, hp + Math.ceil(hp / 4));
  assert.strictEqual(HTL.levelUp(s, r.id), 'path', 'level 3 needs a path');
  assert.strictEqual(HTL.levelUp(s, r.id, 'owlbear'), 'path');
  assert.strictEqual(HTL.levelUp(s, r.id, 'hunter'), null); assert.strictEqual(r.path, 'hunter');
  assert.strictEqual(HTL.levelUp(s, r.id), 'max');
  const g = tough(put(s, 'monster', 'goblin', 2, 5)); g.ac = 1; s.forced = [10, 4];
  HTL._attack(s, r, g, Object.assign({}, HTL.HEROES.ranger.attack, { bonus: HTL.HEROES.ranger.attack.bonus + 2, mod: HTL.HEROES.ranger.attack.mod + 2 }));
  assert.strictEqual(events(s, 'levelup').length, 2);
  s.gold = 0; const f = put(s, 'hero', 'fighter', 0, 4);
  assert.strictEqual(HTL.levelUp(s, f.id), 'gold');
});
test('a recalled hero refunds half of everything spent on it, upgrades included', () => {
  const s = bare(); s.gold = 1000; HTL.place(s, 'wizard', 1, 2);
  const w = HTL.unitAt(s, 1, 2); HTL.levelUp(s, w.id); HTL.levelUp(s, w.id, 'evoker');
  const spent = 150 + 100 + 150, before = s.gold;
  assert.strictEqual(HTL.refundOf(w), spent / 2);
  HTL.recall(s, w.id); assert.strictEqual(s.gold, before + spent / 2);
});
test('Lore: Cutting Words takes 2 off the attacks of monsters within two squares', () => {
  const s = bare(); lvl(s, put(s, 'hero', 'bard', 2, 0), 'lore');
  const f = tough(put(s, 'hero', 'fighter', 2, 1)), g = tough(put(s, 'monster', 'goblin', 2, 2)), far = tough(put(s, 'monster', 'goblin', 0, 6));
  s.forced = [10, 3, 10, 3];
  HTL._attack(s, g, f, HTL.MONSTERS.goblin.attack); HTL._attack(s, far, f, HTL.MONSTERS.goblin.attack);
  const [a, b] = events(s, 'attack');
  assert.ok(a.cut && a.bonus === HTL.MONSTERS.goblin.attack.bonus - 2); assert.ok(!b.cut && b.bonus === HTL.MONSTERS.goblin.attack.bonus);
});
test('Coinsinger: plays for half as much gold again', () => {
  const s = bare(); const b = lvl(s, put(s, 'hero', 'bard', 2, 0), 'coinsinger');
  stepRounds(s, 4);
  const inc = events(s, 'income').filter(e => e.id === b.id);
  assert.ok(inc.length >= 1); assert.strictEqual(inc[0].amount, Math.round((20 + 2 * 5) * 1.5));
});
test('Champion: a 19 is a critical hit', () => {
  const s = bare(); const f = lvl(s, put(s, 'hero', 'fighter', 2, 4), 'champion'), g = tough(put(s, 'monster', 'goblin', 2, 5));
  s.forced = [19, 5, 5]; HTL._attack(s, f, g, HTL.HEROES.fighter.attack);
  assert.ok(events(s, 'attack')[0].crit);
  const plain = put(s, 'hero', 'fighter', 0, 4); s.forced = [19, 5];
  HTL._attack(s, plain, g, HTL.HEROES.fighter.attack); assert.ok(!events(s, 'attack')[1].crit);
});
test('Shieldwarden: a hit shoves the monster back a square, if there is room', () => {
  const s = bare(); const f = lvl(s, put(s, 'hero', 'fighter', 2, 4), 'shieldwarden'), g = tough(put(s, 'monster', 'goblin', 2, 5));
  s.forced = [15, 5]; HTL._attack(s, f, g, HTL.HEROES.fighter.attack);
  assert.strictEqual(g.sq, 6); assert.strictEqual(events(s, 'shove').length, 1);
  tough(put(s, 'monster', 'goblin', 2, 7)); s.forced = [15, 5]; HTL._attack(s, f, g, HTL.HEROES.fighter.attack);
  assert.strictEqual(g.sq, 6, 'no room behind it');
});
test('Hunter: Volley follows each shot with one at the next monster behind', () => {
  const s = bare(); const r = lvl(s, put(s, 'hero', 'ranger', 2, 1), 'hunter');
  const a = tough(put(s, 'monster', 'goblin', 2, 6)), b = tough(put(s, 'monster', 'goblin', 2, 8));
  a.speed = 0; stepRounds(s, 2);
  const shots = events(s, 'attack').filter(e => e.from === r.id);
  assert.ok(shots.some(e => e.to === a.id) && shots.some(e => e.to === b.id));
});
test('Houndmaster: a hound holds the square in front, and another comes after it falls', () => {
  const s = bare(); const r = lvl(s, put(s, 'hero', 'ranger', 2, 1), 'houndmaster');
  const h = HTL.unitAt(s, 2, 2);
  assert.ok(h && h.type === 'hound' && h.kind === 'hero');
  assert.strictEqual(HTL.recall(s, h.id), 'none', 'allies cannot be recalled');
  h.hp = 1; const g = tough(put(s, 'monster', 'ogre', 2, 3)); g.ac = 1;
  stepRounds(s, 3);
  assert.ok(!h.alive); assert.strictEqual(s.stats.fallen, 0, 'a hound is not a fallen hero');
  g.alive = false; stepRounds(s, 6);
  assert.ok(s.units.some(u => u.alive && u.type === 'hound' && u.owner === r.id), 'a new hound came');
});
test('Evoker: a Fireball every second turn', () => {
  const s = bare(); const w = lvl(s, put(s, 'hero', 'wizard', 2, 2), 'evoker');
  for (let q = 5; q <= 8; q++) tough(put(s, 'monster', 'ogre', 2, q)).speed = 0;
  stepRounds(s, 7);
  assert.ok(events(s, 'fireball').filter(e => e.from === w.id).length >= 3);
});
test('Graveseer: a monster slain nearby rises as your skeleton, and falls at the end of the wave', () => {
  const s = HTL.newGame(3); s.waveActive = true; s.wave = 0; s.pending = [];
  lvl(s, put(s, 'hero', 'wizard', 2, 1), 'graveseer');
  const f = put(s, 'hero', 'fighter', 2, 2), g = put(s, 'monster', 'goblin', 2, 3); g.hp = 1;
  s.forced = [15, 5]; HTL._attack(s, f, g, HTL.HEROES.fighter.attack);
  const r = HTL.unitAt(s, 2, 3);
  assert.ok(r && r.type === 'risen' && r.kind === 'hero');
  HTL.step(s, TICK);
  assert.ok(!r.alive && events(s, 'crumble').length === 1);
});
test('Life: heals the two most hurt heroes in one turn', () => {
  const s = bare(); const c = lvl(s, put(s, 'hero', 'cleric', 2, 3), 'life');
  const a = put(s, 'hero', 'fighter', 2, 4), b = put(s, 'hero', 'fighter', 1, 4); a.hp = 5; b.hp = 10;
  stepRounds(s, 2);
  const cures = events(s, 'cure').filter(e => e.from === c.id);
  assert.ok(cures.length >= 2 && cures[0].t === cures[1].t && cures[0].id !== cures[1].id);
});
test('Dawnkeeper: Sacred Flame burns the 3 × 3 round the target, and undead it hurts may flee', () => {
  const s = bare(); const c = lvl(s, put(s, 'hero', 'cleric', 2, 1), 'dawnkeeper');
  const a = tough(put(s, 'monster', 'skeleton', 2, 6)), b = tough(put(s, 'monster', 'skeleton', 1, 7)); a.ac = b.ac = 1;
  s.forced = [15, 4, 4, 2, 15, 4, 4, 18];
  HTL.step(s, 2.05);
  const hits = events(s, 'attack').filter(e => e.from === c.id);
  assert.ok(hits.some(e => e.to === a.id) && hits.some(e => e.to === b.id), 'both burnt');
  assert.ok(HTL.hasStatus(a, 'frightened') && !HTL.hasStatus(b, 'frightened'), 'the failed save flees, the passed one does not');
  stepRounds(s, 2);
  assert.ok(events(s, 'flee').some(e => e.id === a.id && e.to === e.from + 1));
});
test('Thief: every hit pockets 2 gold', () => {
  const s = bare(); const r = lvl(s, put(s, 'hero', 'rogue', 2, 4), 'thief'), g = tough(put(s, 'monster', 'goblin', 2, 5));
  const before = s.gold; s.forced = [15, 3]; HTL._attack(s, r, g, HTL.HEROES.rogue.attack);
  assert.strictEqual(s.gold, before + 2); assert.strictEqual(events(s, 'pocket').length, 1);
});
test('Cutthroat: the first hit on an unhurt monster is a critical', () => {
  const s = bare(); const r = lvl(s, put(s, 'hero', 'rogue', 2, 4), 'cutthroat'), g = tough(put(s, 'monster', 'goblin', 2, 5));
  s.forced = [15, 3, 3, 15, 3];
  HTL._attack(s, r, g, HTL.HEROES.rogue.attack); HTL._attack(s, r, g, HTL.HEROES.rogue.attack);
  const [a, b] = events(s, 'attack'); assert.ok(a.crit && !b.crit);
});
test('Berserker: rages twice before it is spent', () => {
  const s = bare(); const b = lvl(s, put(s, 'hero', 'barbarian', 2, 1), 'berserker');
  tough(put(s, 'monster', 'ogre', 2, 6)).speed = 0;
  stepRounds(s, 2);
  assert.ok(b.alive && events(s, 'charge').length === 1 && b.sq === 5, 'still standing after the first rage');
  stepRounds(s, 2);
  assert.ok(!b.alive && events(s, 'charge').length === 2 && events(s, 'spent').length === 1);
});
test('Stonehide: survives its charge, gains +2 AC and stays as a blocker', () => {
  const s = bare(); const b = put(s, 'hero', 'barbarian', 2, 1), ac = b.ac; lvl(s, b, 'stonehide');
  assert.strictEqual(b.ac, ac + 2);
  const o = tough(put(s, 'monster', 'ogre', 2, 6)); o.speed = 0;
  stepRounds(s, 2);
  assert.ok(b.alive && b.blocker && b.sq === 5 && events(s, 'stand').length === 1 && !events(s, 'spent').length);
  stepRounds(s, 2);
  assert.ok(events(s, 'attack').some(e => e.from === b.id && e.name === 'Greataxe'), 'swings at what is next to it');
});
test('difficulty scales monster hit points, the purse and the lives; Medium is the game as made', () => {
  const m = HTL.newGame(5, 'warren'), d0 = HTL.newGame(5, 'warren', { difficulty: 'medium' });
  assert.strictEqual(JSON.stringify(m), JSON.stringify(d0));
  const e = HTL.newGame(5, 'warren', { difficulty: 'easy' }), x = HTL.newGame(5, 'warren', { difficulty: 'deadly' });
  assert.ok(e.gold > m.gold && x.gold < m.gold); assert.strictEqual(x.lives, 3);
  const o = put(x, 'monster', 'ogre', 2, 8); assert.strictEqual(o.maxHp, Math.round(HTL.MONSTERS.ogre.hp * HTL.DIFFICULTY.deadly.hp));
});
test('the party: only chosen heroes can be placed, and every battle suggests six with a reason for each', () => {
  const s = HTL.newGame(5, 'warren', { loadout: ['bard', 'fighter'] }); s.gold = 999;
  assert.strictEqual(HTL.canPlace(s, 'ranger', 2, 1), 'locked'); assert.strictEqual(HTL.canPlace(s, 'fighter', 2, 1), null);
  for (const b of HTL.BATTLES) {
    const l = HTL.suggestLoadout(b.id);
    assert.strictEqual(l.pick.length, HTL.PARTY, b.id);
    for (const ty of l.pick) assert.ok(l.why[ty] && l.why[ty].length > 10, b.id + ' ' + ty);
  }
  assert.ok(HTL.suggestLoadout('crypt').pick.includes('cleric'), 'undead want a Cleric');
});
test('Simz levels up her heroes once the plan is built', () => {
  const { s } = play(42, 'road', HTL.autoplay, 0.1);
  assert.ok(s.stats.levels > 0, 'no level-ups in a whole battle');
});

// ---------- Phase 3: new heroes, defenders and monsters ----------
const atk = (s, a, b, roll, ...dmg) => { s.forced = [roll, ...dmg]; return HTL._attack(s, a, b, (a.kind === 'hero' ? HTL.HEROES : HTL.MONSTERS)[a.type].attack); };
test('Paladin: heroes next to it get +1 AC, and every third hit smites', () => {
  const s = bare(); put(s, 'hero', 'paladin', 2, 4); const f = tough(put(s, 'hero', 'fighter', 1, 4)), g = tough(put(s, 'monster', 'goblin', 1, 5));
  atk(s, g, f, 10, 1); assert.strictEqual(events(s, 'attack')[0].ac, f.ac + 1);
  const pal = HTL.unitAt(s, 2, 4), o = tough(put(s, 'monster', 'skeleton', 2, 5)); o.ac = 1;
  for (let i = 0; i < 3; i++) atk(s, pal, o, 15, 1, 1, 1, 1, 1, 1);
  const hits = events(s, 'attack').filter(e => e.from === pal.id);
  assert.deepStrictEqual(hits.map(e => !!e.smite).join(), 'false,false,true');
});
test('Druid: Entangle slows the 3 × 3 round its target, and it turns into a bear once when a monster reaches it', () => {
  const s = bare(); const d0 = put(s, 'hero', 'druid', 2, 1); d0.charge = 2;
  const a = tough(put(s, 'monster', 'goblin', 2, 6)), b = tough(put(s, 'monster', 'goblin', 1, 7)); a.ac = b.ac = 1;
  s.forced = [1, 1]; HTL.step(s, 2.05);
  assert.ok(events(s, 'entangle').length === 1 && HTL.hasStatus(a, 'slowed') && HTL.hasStatus(b, 'slowed'));
  const s2 = bare(); const dr = put(s2, 'hero', 'druid', 2, 3); tough(put(s2, 'monster', 'ogre', 2, 4));
  stepRounds(s2, 2);
  assert.ok(dr.form === 'bear' && dr.tempHp > 0 && events(s2, 'shape')[0].form === 'bear');
  dr.hp = dr.maxHp = 999; const hp = dr.hp, soak = dr.tempHp; s2.forced = [20, 10, 10, 10, 10]; HTL._attack(s2, HTL.unitAt(s2, 2, 4), dr, HTL.MONSTERS.ogre.attack);
  assert.strictEqual(dr.hp, hp - Math.max(0, events(s2, 'attack').pop().dmg - soak), 'the bear soaks the blow first');
});
test('Monk: two blows a turn, a Stunning Strike, and arrows knocked aside', () => {
  const s = bare(); const m = put(s, 'hero', 'monk', 2, 4), o = tough(put(s, 'monster', 'ogre', 2, 5)); o.ac = 1; m.init = 30; o.init = -30;
  s.forced = [15, 3, 1, 15, 3]; HTL.step(s, 2.05);
  assert.strictEqual(events(s, 'attack').filter(e => e.from === m.id).length, 2);
  assert.ok(events(s, 'status').some(e => e.id === o.id && e.status === 'paralysed') && events(s, 'stunned').some(e => e.id === o.id), 'stunned on a failed save, and loses its turn');
  const a = tough(put(s, 'monster', 'goblinArcher', 2, 8)); s.forced = [18, 6, 10];
  HTL._attack(s, a, m, HTL.MONSTERS.goblinArcher.attack);
  const shot = events(s, 'attack').pop(); assert.ok(shot.hit && shot.deflected > 0 && shot.dmg === 0, 'caught');
});
test('Warlock: Eldritch Blast knocks a monster back a square', () => {
  const s = bare(); const w = put(s, 'hero', 'warlock', 2, 1), g = tough(put(s, 'monster', 'goblin', 2, 5));
  atk(s, w, g, 15, 5); assert.strictEqual(g.sq, 6); assert.strictEqual(events(s, 'shove').length, 1);
});
test('Sorcerer: the lightning jumps to a monster in the next row, twice', () => {
  const s = bare(); const so = put(s, 'hero', 'sorcerer', 2, 1);
  const a = tough(put(s, 'monster', 'ogre', 2, 5)), b = tough(put(s, 'monster', 'ogre', 1, 6)), c = tough(put(s, 'monster', 'ogre', 0, 5)); a.ac = b.ac = c.ac = 1;
  HTL.step(s, 2.05);
  assert.deepStrictEqual(events(s, 'attack').filter(e => e.from === so.id).map(e => e.to).join(), [a.id, b.id, c.id].join());
});
test('Tinker: builds a ballista in front, and lays spring traps that walkers set off', () => {
  const s = bare(); const tk = put(s, 'hero', 'tinker', 2, 1);
  stepRounds(s, 2);
  const b = HTL.unitAt(s, 2, 2); assert.ok(b && b.type === 'ballista' && b.owner === tk.id);
  tk.turns = 3; stepRounds(s, 1);
  assert.strictEqual(s.traps.length, 1); const tp = s.traps[0];
  const g = tough(put(s, 'monster', 'goblin', 2, tp.sq + 1));
  stepRounds(s, 3);
  assert.ok(events(s, 'sprung').some(e => e.on === g.id) && events(s, 'trapHit').some(e => e.to === g.id));
});
test('defenders: always to hand, a barricade holds a square, caltrops and oil lie in wait', () => {
  const s = HTL.newGame(5, 'warren', { loadout: ['bard'] }); s.gold = 999; s.nextWaveRound = 1e9;
  assert.strictEqual(HTL.place(s, 'barricade', 2, 4), null, 'not part of the party, but always to hand');
  const bar = HTL.unitAt(s, 2, 4), g = tough(put(s, 'monster', 'goblin', 2, 5));
  stepRounds(s, 3); assert.strictEqual(g.sq, 5); assert.ok(events(s, 'attack').some(e => e.to === bar.id));
  assert.ok(!events(s, 'attack').some(e => e.from === bar.id), 'a barricade does not fight');
  assert.strictEqual(HTL.place(s, 'caltrops', 1, 5), null); assert.strictEqual(HTL.canPlace(s, 'fighter', 1, 5), 'locked');
  assert.strictEqual(HTL.canPlace(s, 'oil', 1, 5), 'occupied', 'one trap a square');
  const w = tough(put(s, 'monster', 'goblin', 1, 6)); stepRounds(s, 3);
  assert.ok(HTL.hasStatus(w, 'slowed') || events(s, 'trapHit').some(e => e.to === w.id && e.kind === 'caltrops'));
  HTL.place(s, 'oil', 3, 5); const tr = tough(put(s, 'monster', 'troll', 3, 6)), near = tough(put(s, 'monster', 'goblin', 4, 5));
  stepRounds(s, 3);
  const hits = events(s, 'trapHit').filter(e => e.kind === 'oil');
  assert.ok(hits.some(e => e.to === tr.id) && hits.some(e => e.to === near.id), 'the oil burns the 3 × 3');
  assert.ok(events(s, 'status').some(e => e.id === tr.id && e.status === 'burnt'));
});
test('a holy water font makes the squares round it holy ground', () => {
  const s = bare(); s.gold = 999; HTL.place(s, 'font', 2, 3);
  const sk = tough(put(s, 'monster', 'skeleton', 2, 4)); stepRounds(s, 2);
  assert.ok(events(s, 'burn').some(e => e.id === sk.id));
});
test('ankheg: burrows under the first hero and comes up behind it', () => {
  const s = bare(); tough(put(s, 'hero', 'fighter', 2, 4)); const a = tough(put(s, 'monster', 'ankheg', 2, 5));
  stepRounds(s, 2); assert.strictEqual(a.sq, 3); assert.ok(events(s, 'move').some(e => e.id === a.id && e.burrow));
});
test('hobgoblin shield wall: arrows at monsters behind it have disadvantage, spells do not', () => {
  const s = bare(); const r = put(s, 'hero', 'ranger', 2, 1); tough(put(s, 'monster', 'hobgoblin', 2, 4)); const g = tough(put(s, 'monster', 'goblin', 2, 6));
  s.forced = [18, 4, 3]; HTL._attack(s, r, g, HTL.HEROES.ranger.attack);
  const e = events(s, 'attack')[0]; assert.ok(e.walled && e.roll === 4 && e.low === 18);
  const w = put(s, 'hero', 'wizard', 2, 0); s.forced = [18, 4]; HTL._attack(s, w, g, HTL.HEROES.wizard.attack);
  assert.ok(!events(s, 'attack')[1].walled);
});
test('imp: invisible unless a light is near, or a hero is right next to it', () => {
  const s = bare(); const i = tough(put(s, 'monster', 'imp', 2, 6));
  assert.strictEqual(HTL.nearestAhead(s, 2, 1), null);
  put(s, 'hero', 'cleric', 1, 5); assert.strictEqual(HTL.nearestAhead(s, 2, 1), i, 'the Cleric lights it up');
  void i;
});
test('wolf rider: knocked out of the saddle at half health, a goblin and a wolf from then on', () => {
  const s = bare(); const f = put(s, 'hero', 'fighter', 2, 4), w = put(s, 'monster', 'wolfRider', 2, 5); w.hp = 25;
  s.forced = [20, 8, 8]; HTL._attack(s, f, w, HTL.HEROES.fighter.attack);
  assert.ok(!w.alive && events(s, 'unhorse').length === 1);
  const kinds = events(s, 'spawn').filter(e => e.how === 'unhorse').map(e => e.unitType).sort().join();
  assert.strictEqual(kinds, 'direWolf,goblin'); assert.strictEqual(s.stats.kills, 0, 'not a kill, no bounty');
});
test('troll: regenerates, except the turn after fire', () => {
  const s = bare(); const tr = put(s, 'monster', 'troll', 2, 8); tr.hp = 20; tough(put(s, 'hero', 'fighter', 2, 7));
  stepRounds(s, 2); assert.ok(events(s, 'regen').some(e => e.id === tr.id));
  const w = put(s, 'hero', 'wizard', 2, 0); s.events.length = 0; tr.hp = 20;
  s.forced = [15, 4]; HTL._attack(s, w, tr, HTL.HEROES.wizard.attack); assert.ok(HTL.hasStatus(tr, 'burnt'));
  stepRounds(s, 2); assert.ok(!events(s, 'regen').some(e => e.id === tr.id), 'no healing while burning');
});
// ---------- Phase 6: new shapes ----------
test('L and T maps: the way turns, so blades reach up and down there, and only there', () => {
  for (const id of ['corner', 'crossing']) assert.ok(HTL.MAPS[id].turns, id);
  const s = bare(3, 'stores'), f = tough(put(s, 'hero', 'fighter', 2, 8)), o = tough(put(s, 'monster', 'orc', 3, 8));
  o.speed = 0; stepRounds(s, 2);
  assert.ok(events(s, 'attack').some(e => e.from === f.id && e.to === o.id), 'the Fighter swings down at the orc below');
  const c = bare(3, 'warren'), g = tough(put(c, 'hero', 'fighter', 2, 5)), k = tough(put(c, 'monster', 'orc', 3, 5));
  stepRounds(c, 2); assert.ok(!events(c, 'attack').some(e => e.from === g.id && e.to === k.id), 'on the old floors a blade still only reaches along its row');
});
test('U maps: where the way turns, shooters also see up and down their column, past nothing solid', () => {
  assert.ok(HTL.MAPS.horseshoe.turns && HTL.mapOf(HTL.newGame(1, 'kennels')).id === 'horseshoe');
  const s = bare(3, 'kennels'), r = put(s, 'hero', 'ranger', 0, 1), w = tough(put(s, 'monster', 'direWolf', 3, 1));
  stepRounds(s, 2); assert.ok(events(s, 'attack').some(e => e.from === r.id && e.to === w.id), 'the Ranger shoots down the left side');
  const c = bare(3, 'warren'), r2 = put(c, 'hero', 'ranger', 0, 1), w2 = tough(put(c, 'monster', 'direWolf', 3, 1));
  stepRounds(c, 2); assert.ok(!events(c, 'attack').some(e => e.from === r2.id && e.to === w2.id), 'on the old floors only along the row');
});
// ---------- Phase 6: pile-ups and the belt ----------
test('pile-ups: in a crowded battle small monsters squeeze three to a square; elsewhere, and for bigger ones, one', () => {
  const s = bare(5, 'runs'); assert.ok(HTL.battle(s).crowds);
  const f = tough(put(s, 'hero', 'fighter', 2, 2));
  for (let i = 0; i < 4; i++) tough(put(s, 'monster', 'direRat', 2, 7 + i));
  stepRounds(s, 8);
  const at3 = s.units.filter(u => u.alive && u.kind === 'monster' && u.lane === 2 && u.sq === 3).length;
  assert.strictEqual(at3, 3, 'three rats squeeze onto the square in front of the Fighter');
  const c = bare(5, 'warren'); tough(put(c, 'hero', 'fighter', 2, 2)); for (let i = 0; i < 3; i++) tough(put(c, 'monster', 'direRat', 2, 7 + i));
  stepRounds(c, 8); assert.ok(c.units.filter(u => u.alive && u.kind === 'monster' && u.lane === 2 && u.sq === 3).length <= 1, 'one to a square in the old battles');
  const o = bare(5, 'runs'); tough(put(o, 'hero', 'fighter', 2, 2)); tough(put(o, 'monster', 'goblin', 2, 3)); const hound = tough(put(o, 'monster', 'warrenHound', 2, 4));
  stepRounds(o, 4); assert.ok(!(hound.lane === 2 && hound.sq === 3), 'a hound needs a square to itself');
});
test('the belt: holy water, acid, alchemist’s fire, a net and ball bearings, one throw a round', () => {
  const s = HTL.newGame(5, 'runs', { belt: { holyWater: 1, acid: 2, alchemistFire: 1, net: 1, ballBearings: 1, owlbear: 4 } });
  s.nextWaveRound = 1e9; assert.strictEqual(JSON.stringify(s.belt), JSON.stringify({ holyWater: 1, alchemistFire: 1, acid: 2, net: 1, ballBearings: 1 }));
  const sk = tough(put(s, 'monster', 'skeleton', 2, 7)), gb = tough(put(s, 'monster', 'goblin', 2, 7));
  assert.strictEqual(HTL.canThrow(s, 'acid', 1, 7), 'target');
  s.forced = [4, 4]; assert.strictEqual(HTL.throwItem(s, 'holyWater', 2, 7), null);
  assert.ok(events(s, 'splash').some(e => e.to === sk.id && e.dmg === 8) && !events(s, 'splash').some(e => e.to === gb.id), 'holy water spares the living');
  assert.strictEqual(HTL.throwItem(s, 'acid', 2, 7), 'once', 'one throw a round');
  stepRounds(s, 1); s.events.length = 0; s.forced = [3, 3];
  assert.strictEqual(HTL.throwItem(s, 'acid', 2, 7), null); assert.strictEqual(events(s, 'splash').length, 2, 'acid hits everything piled there');
  stepRounds(s, 1); const g2 = tough(put(s, 'monster', 'goblin', 4, 8));
  assert.strictEqual(HTL.throwItem(s, 'alchemistFire', 4, 8), null); assert.ok(HTL.hasStatus(g2, 'aflame'));
  s.events.length = 0; stepRounds(s, 2); assert.ok(events(s, 'flames').some(e => e.id === g2.id), 'it burns at the start of its turn');
  const kob = put(s, 'monster', 'kobold', 3, 6);
  assert.strictEqual(HTL.throwItem(s, 'net', 3, 6), null); assert.ok(HTL.hasStatus(kob, 'netted'));
  const sa = HTL.newGame(5, 'forge', { belt: { alchemistFire: 1 } }); sa.nextWaveRound = 1e9; const sal = tough(put(sa, 'monster', 'salamander', 2, 7));
  HTL.throwItem(sa, 'alchemistFire', 2, 7); assert.ok(!HTL.hasStatus(sal, 'aflame'), 'a salamander doesn’t catch');
  const b = HTL.newGame(5, 'runs', { belt: { ballBearings: 1 } }); b.nextWaveRound = 1e9;
  assert.strictEqual(HTL.throwItem(b, 'ballBearings', 2, 5), null); const tp = b.traps.find(t => t.kind === 'bearings'); assert.ok(tp && tp.until === b.round + 3);
  stepRounds(b, 5); assert.ok(!b.traps.some(t => t.kind === 'bearings'), 'swept up after three rounds');
  assert.strictEqual(HTL.newGame(5, 'runs', { difficulty: 'deadly', belt: { acid: 3 } }).belt, undefined, 'the belt stays behind on Deadly');
  assert.strictEqual(HTL.newGame(5, 'daily:2026-11-08', { belt: { acid: 3 } }).belt, undefined, 'and out of the fixed battles');
});
test('the belt: Simz throws at the piles, and the campaign sells, carries and uses up what’s thrown', () => {
  const { s } = play(7, 'runs', HTL.autoplay, 0.25, { belt: { acid: 3, alchemistFire: 3, holyWater: 2, net: 2 } });
  assert.ok(Object.values(s.thrown || {}).reduce((a, b) => a + b, 0) >= 3, 'Simz throws: ' + JSON.stringify(s.thrown));
  const C = sandbox.HTL_CAMPAIGN, c = C.fresh(); c.takings = 100;
  assert.strictEqual(C.buyThrow(c, 'acid'), null); assert.strictEqual(c.takings, 80); assert.strictEqual(C.buyThrow(c, 'owlbear'), 'unknown');
  c.takings = 5; assert.strictEqual(C.buyThrow(c, 'net'), 'takings');
  c.takings = 1000; for (let i = 0; i < 12; i++) C.buyThrow(c, 'net'); assert.strictEqual(c.belt.net, C.BELT_MAX);
  assert.strictEqual(C.battleOptions(c).belt.acid, 1);
  C.record(c, { battle: 'runs', difficulty: 'medium', won: true, livesLost: 0, goldLeft: 0, met: [], slain: {}, placed: {}, feats: { bards: 3 }, thrown: { acid: 1, net: 2 } }, '2026-11-08');
  assert.ok(!c.belt.acid && c.belt.net === C.BELT_MAX - 2, 'what was thrown is gone');
  assert.strictEqual(JSON.stringify(C.clean(JSON.parse(JSON.stringify(c))).belt), JSON.stringify(c.belt));
});
test('looks: each hero stands as his figure or hers, the save keeps it, and a bad value is dropped', () => {
  const C = sandbox.HTL_CAMPAIGN, c = C.fresh();
  assert.strictEqual(JSON.stringify(c.looks), '{}', 'him by default');
  assert.ok(C.setLook(c, 'ranger', 'f') && C.setLook(c, 'fighter', 'f')); assert.ok(!C.setLook(c, 'owlbear', 'f'));
  C.setLook(c, 'fighter', 'm');
  assert.strictEqual(JSON.stringify(c.looks), JSON.stringify({ ranger: 'f' }));
  const back = C.clean(Object.assign(JSON.parse(JSON.stringify(c)), { looks: { ranger: 'f', bard: 'x', goblin: 'f', wizard: 'f' } }));
  assert.strictEqual(JSON.stringify(back.looks), JSON.stringify({ ranger: 'f', wizard: 'f' }));
  assert.strictEqual(JSON.stringify(C.clean({}).looks), '{}', 'an old save without looks still loads');
});
// ---------- Phase 7: the rest of the house ----------
const nextRound = s => HTL.step(s, s.nextRoundAt - s.time + 1e-6);
test('hatches: stand on one while it is shut; it bursts open when its first monster comes up, throwing the hero aside', () => {
  const s = bare(5, 'larder'), m = HTL.MAPS.larder, hi = 4, hd = m.doors[hi];
  assert.strictEqual(HTL.cellAt(s, hd.lane, hd.sq), 'H');
  assert.strictEqual(HTL.canPlace(s, 'fighter', hd.lane, hd.sq), null, 'a shut hatch is floor');
  const f = put(s, 'hero', 'fighter', hd.lane, hd.sq);
  s.pending.push({ round: s.round + 2, type: 'orc', door: hi, pool: [hi] });
  nextRound(s);
  assert.ok(events(s, 'hatchWarn').some(e => e.door === hi), 'it rattles the round before');
  s.events.length = 0; nextRound(s);
  assert.ok(events(s, 'hatch').some(e => e.door === hi), 'it bursts open');
  const shove = events(s, 'shove')[0];
  assert.ok(shove && shove.id === f.id, 'the fighter is thrown aside');
  assert.ok(f.lane !== hd.lane || f.sq !== hd.sq); assert.ok(HTL.hasStatus(f, 'prone'), 'and loses a turn');
  const orc = s.units.find(u => u.kind === 'monster' && u.type === 'orc');
  assert.ok(orc && orc.lane === hd.lane && orc.sq === hd.sq, 'the orc comes up through it');
  assert.strictEqual(HTL.canPlace(s, 'ranger', hd.lane, hd.sq), 'off', 'an open hatch is a door');
});
test('hatches: waves that name no door keep to the doors until a hatch has opened', () => {
  const s = HTL.newGame(9, 'larder'), m = HTL.MAPS.larder;
  for (let r = 0; r < 40 && s.wave < 1; r++) nextRound(s);
  const firstWave = HTL.waveOf(HTL.battle(s), 0).parsed;
  assert.ok(firstWave.every(p => p.door == null));
  for (const p of s.pending) assert.ok(!m.hatches[p.door], 'a shut hatch is never picked at random');
});
test('ovens: every few rounds they burn whatever stands in front of them, glowing the round before; fire-proof things shrug', () => {
  const s = bare(5, 'scullery'), m = HTL.MAPS.scullery, ov = m.oven;
  assert.ok(ov && ov.hot.length === 8, 'eight squares in front of the scullery ovens');
  const hot = ov.hot[0], cool = { lane: 3, sq: 2 };
  assert.ok(!ov.hot.some(h => h.lane === cool.lane && h.sq === cool.sq));
  const h1 = tough(put(s, 'hero', 'fighter', hot.lane, hot.sq)), h2 = tough(put(s, 'hero', 'fighter', cool.lane, cool.sq));
  const sal = tough(put(s, 'monster', 'salamander', ov.hot[1].lane, ov.hot[1].sq)), orc = tough(put(s, 'monster', 'orc', ov.hot[2].lane, ov.hot[2].sq));
  let warned = false, flared = false;
  for (let r = 0; r < ov.first + 1 && !flared; r++) { nextRound(s); warned = warned || events(s, 'ovenWarn').length > 0; flared = events(s, 'flare').length > 0; if (!flared) s.events.length = 0; }
  assert.ok(warned && flared, 'a glow, then a flare');
  const hit = id => events(s, 'scorch').find(e => e.to === id);
  assert.ok(hit(h1.id) && hit(h1.id).dmg > 0, 'the hero on the hot square burns');
  assert.ok(!hit(h2.id), 'the one beside it does not');
  assert.ok(hit(orc.id) && hit(orc.id).dmg > 0, 'monsters burn too');
  assert.strictEqual(hit(sal.id).dmg, 0, 'a salamander does not');
});
test('barrels: one rolls down its chute every few rounds, bowling over heroes and monsters alike until something big stops it', () => {
  const s = bare(5, 'racks'), ch = HTL.MAPS.racks.chutes;
  assert.strictEqual(JSON.stringify(ch.lanes), '[0,3,6]');
  while (s.round < ch.first - 1) nextRound(s);
  assert.ok(events(s, 'barrelWarn').some(e => e.lane === 0), 'the first barrel shudders at the head of row 0 the round before');
  HTL.step(s, s.nextRoundAt - s.time - 0.01); s.events.length = 0;
  const gob = tough(put(s, 'monster', 'goblin', 0, 8)), kob = tough(put(s, 'monster', 'kobold', 0, 7)), rng = tough(put(s, 'hero', 'ranger', 0, 6));
  const rat = tough(put(s, 'monster', 'direRat', 0, 5)), ogre = tough(put(s, 'monster', 'ogre', 0, 3)), behind = tough(put(s, 'monster', 'goblin', 0, 2));
  s.forced = [1, 2, 1, 2, 1, 2, 1, 2, 5, 5]; // every save fails; each blow 2; the ogre takes 5 + 5
  HTL.step(s, 0.02);
  const b = events(s, 'barrel')[0];
  assert.ok(b && b.lane === 0 && b.from === 9, 'it starts at the far end of the row');
  assert.strictEqual(JSON.stringify(b.hits.map(h => h.id)), JSON.stringify([gob.id, kob.id, rng.id, rat.id, ogre.id]), 'in order, from the far end');
  assert.ok(b.hits.slice(0, 4).every(h => h.dmg === 2) && HTL.hasStatus(gob, 'prone') && HTL.hasStatus(rng, 'prone'), 'bowled over: hurt and down');
  assert.strictEqual(b.stop, ogre.id); assert.strictEqual(b.hits[4].dmg, 10); assert.ok(b.hits[4].big, 'an ogre stops it and takes the smash');
  assert.ok(!b.hits.some(h => h.id === behind.id), 'nothing behind the ogre is touched');
  assert.strictEqual(b.downed, 3, 'three monsters bowled over: a strike');
  const C = sandbox.HTL_CAMPAIGN; assert.ok(C.TROPHIES.find(t => t.id === 'strike').test({ feats: { strike: true } }));
  while (!events(s, 'barrel').some(e => e.lane === 3)) { s.events.length = 0; nextRound(s); }
  assert.ok(true, 'the next one goes down row 3');
});
test('Simz meets the barrels with barricades in the chutes, and still places his shooters', () => {
  const { s } = play(1000, 'vats', HTL.autoplay, 0.1);
  const lanes = HTL.MAPS.vats.chutes.lanes, units = s.units.concat([]);
  assert.ok(s.stats.placed > 10);
  const placed = HTL.newGame(1000, 'vats'); placed.nextWaveRound = 1e9;
  for (let r = 0; r < 12; r++) { HTL.autoplay(placed); nextRound(placed); }
  const bars = placed.units.filter(u => u.alive && u.type === 'barricade');
  assert.ok(lanes.every(l => bars.some(b => b.lane === l)), 'a barricade in every chute: ' + bars.map(b => b.lane + ',' + b.sq).join(' '));
});
test('Simz keeps off hatches and hot squares, and his plan covers every row of a wide floor', () => {
  for (const id of ['larder', 'scullery', 'kitchen', 'lawn', 'maze']) {
    const m = HTL.MAPS[id];
    for (const [t, l, q] of m.plan) assert.ok(!HTL._risky(m, l, q), id + ': plan puts ' + t + ' on ' + l + ',' + q);
  }
  const k = HTL.MAPS.kitchen, rows = new Set(k.plan.map(p => p[1]));
  for (let l = 0; l < k.h; l++) if (k.rows[l].indexOf('.') >= 0) assert.ok(rows.has(l), 'kitchen row ' + l + ' has no one planned');
  const { s } = play(1000, 'kitchen', HTL.autoplay, 0.1);
  assert.ok(s.stats.placed > 8);
  const before = HTL.MAPS.classic.plan.map(p => p.join()).join(' ');
  assert.ok(before.length > 0 && HTL.MAPS.classic.plan.every(([t, l, q]) => l < 5), 'the cellar floor keeps its plan');
});
test('forks: where the ring splits, a monster takes the way the heroes cover least, and changes its mind when they move', () => {
  const way = heroes => {
    const s = bare(5, 'barn'); heroes.forEach(h => put(s, 'hero', ...h));
    return HTL.stepOf(s, put(s, 'monster', 'orc', 3, 8));
  };
  assert.strictEqual(JSON.stringify(way([['ranger', 1, 1], ['fighter', 1, 4]])), JSON.stringify({ lane: 4, sq: 8 }), 'heroes up top: it goes round the bottom');
  assert.strictEqual(JSON.stringify(way([['ranger', 5, 1], ['fighter', 5, 4]])), JSON.stringify({ lane: 2, sq: 8 }), 'heroes below: it goes over the top');
  const s = bare(5, 'barn'), a = put(s, 'monster', 'orc', 3, 8), b = put(s, 'monster', 'orc', 3, 8);
  assert.notStrictEqual(HTL.stepOf(s, a).lane, HTL.stepOf(s, b).lane, 'with nothing to choose between them, they split');
  assert.ok(!HTL.MAPS.classic.forks && !HTL.MAPS.racks.forks, 'only the ring floors have forks');
});
test('the yard gate: dropped once a battle, it sends everything round the other way for a few rounds, then lifts', () => {
  const s = bare(5, 'stables'), m = HTL.MAPS.stables;
  assert.ok(m.gate && m.rows[0][5] === 'G' && m.rows[1][5] === 'G');
  assert.strictEqual(HTL.canShutGate(bare(5, 'barn')), 'none', 'no gate in the barn');
  const blocked = bare(5, 'stables'); put(blocked, 'hero', 'fighter', 1, 5);
  assert.strictEqual(HTL.canShutGate(blocked), 'blocked', 'not on someone standing in the gateway');
  const orc = put(s, 'monster', 'orc', 0, 7);
  assert.strictEqual(JSON.stringify(HTL.stepOf(s, orc)), JSON.stringify({ lane: 0, sq: 6 }), 'open: straight on through');
  assert.strictEqual(HTL.shutGate(s), null);
  assert.ok(events(s, 'gate').some(e => e.shut && e.until === s.round + m.gate.rounds));
  assert.strictEqual(JSON.stringify(HTL.stepOf(s, orc)), JSON.stringify({ lane: 0, sq: 8 }), 'shut: it turns back to go round');
  assert.strictEqual(HTL.shutGate(s), 'used', 'once a battle');
  orc.alive = false; s.events.length = 0;
  for (let r = 0; r < m.gate.rounds; r++) nextRound(s);
  assert.ok(events(s, 'gate').some(e => !e.shut), 'it lifts');
  const next = put(s, 'monster', 'orc', 0, 7);
  assert.strictEqual(JSON.stringify(HTL.stepOf(s, next)), JSON.stringify({ lane: 0, sq: 6 }), 'and the way is open again');
  assert.strictEqual(HTL.canShutGate(s), 'used');
});
test('Simz drops the gate on a crowd, and the ring trophy wants a clean win round the barn', () => {
  const s = bare(5, 'stables');
  for (let i = 0; i < 4; i++) put(s, 'monster', 'goblin', 0, 7 + (i % 3));
  HTL.autoplay(s);
  assert.ok(s.gate.used && s.gate.until > 0, 'four goblins heading for the gate: down it comes');
  const t = bare(5, 'stables'); put(t, 'monster', 'goblin', 0, 8); HTL.autoplay(t);
  assert.ok(!t.gate.used, 'not for one goblin');
  const ring = sandbox.HTL_CAMPAIGN.TROPHIES.find(x => x.id === 'ringhold');
  assert.ok(ring.test({ battle: 'barn', won: true, livesLost: 0 }) && ring.test({ battle: 'stables', won: true, livesLost: 0 }));
  assert.ok(!ring.test({ battle: 'barn', won: true, livesLost: 1 }) && !ring.test({ battle: 'yard', won: true, livesLost: 0 }));
});
test('the house: it opens when the Red Wyrm’s Lair is won, battle by battle, and the cellar trophies stay about the cellar', () => {
  const C = sandbox.HTL_CAMPAIGN, c = C.fresh();
  const winSum = battle => ({ battle, difficulty: 'medium', won: true, livesLost: 0, goldLeft: 0, met: [], slain: {}, placed: {}, feats: { bards: 3 } });
  assert.ok(C.HOUSE.length >= 3 && C.HOUSE.every(id => HTL.battleById(id).stage === 2 && HTL.PACK.parts[HTL.battleById(id).part]));
  assert.ok(C.CELLAR.indexOf('lair') >= 0 && C.CELLAR.every(id => !HTL.battleById(id).stage));
  assert.ok(!C.unlocked(c, C.HOUSE[0]) && !C.rooms(c).find(r => r.id === 'house').open);
  for (const id of C.CELLAR.slice(0, C.CELLAR.indexOf('lair') + 1)) C.record(c, winSum(id));
  assert.ok(C.unlocked(c, C.HOUSE[0]) && C.rooms(c).find(r => r.id === 'house').open, 'the Lair opens the house');
  assert.ok(!C.unlocked(c, C.HOUSE[1]));
  C.record(c, winSum(C.HOUSE[0])); assert.ok(C.unlocked(c, C.HOUSE[1]));
  for (const id of C.CELLAR) C.record(c, winSum(id));
  assert.ok(c.trophies.campaign, 'the cellar is quiet without the house');
  assert.ok(HTL.MONSTERS.larderOgre.traits.boss && HTL.MONSTERS.larderOgre.figure === 'ogre');
});
test('box hedges: walkers go round, flyers go straight over, nobody stands in one, and everyone sees across it', () => {
  const m = HTL.MAPS.maze, s = bare(5, 'maze');
  assert.strictEqual(m.rows[1][4], '%');
  assert.strictEqual(HTL.canPlace(s, 'fighter', 1, 4), 'off', 'nobody stands in a hedge');
  assert.ok(m.fields.walk.dist[1][10] > m.fields.fly.dist[1][10], 'walkers go round the hedges, flyers over them');
  const bat = put(s, 'monster', 'caveBat', 1, 9), next = HTL.stepOf(s, bat);
  assert.strictEqual(JSON.stringify(next), JSON.stringify({ lane: 1, sq: 8 }));
  const r = put(s, 'hero', 'ranger', 0, 1), gob = tough(put(s, 'monster', 'goblin', 0, 9));
  put(s, 'monster', 'kobold', 1, 5); // over the hedge, seen from the gap
  const w = put(s, 'hero', 'wizard', 1, 1);
  assert.ok(r && gob && w);
  s.forced = [15, 4]; HTL._attack(s, w, s.units.find(u => u.type === 'kobold'), HTL.HEROES.wizard.attack);
  assert.ok(events(s, 'attack').some(e => e.from === w.id), 'a wizard in the gap reaches across the hedge row');
});
test('the Thing Under the Lawn: badly hurt, it dives, and two rounds later comes up through a molehill further on, as hurt as it went', () => {
  const s = bare(5, 'maze'), m = HTL.MAPS.maze;
  const t = put(s, 'monster', 'lawnThing', 2, 8), f = tough(put(s, 'hero', 'fighter', 2, 7));
  t.hp = Math.floor(t.maxHp / 2) + 2;
  s.forced = [19, 6, 6]; HTL._attack(s, f, t, HTL.HEROES.fighter.attack);
  const dv = events(s, 'dive')[0];
  assert.ok(dv && !t.alive, 'below half: it dives');
  assert.strictEqual(dv.door, 0, 'to the furthest molehill nearer the tavern than it is');
  const hp = t.hp; s.events.length = 0;
  nextRound(s);
  assert.ok(events(s, 'hatchWarn').some(e => e.door === 0), 'the molehill heaves the round before');
  s.events.length = 0; nextRound(s);
  const up = events(s, 'spawn').find(e => e.how === 'surface');
  assert.ok(up && up.lane === m.doors[0].lane && up.sq === m.doors[0].sq && up.hp === hp, 'up it comes, no better for the rest');
  const t2 = s.units.find(u => u.id === up.id), f2 = tough(put(s, 'hero', 'fighter', 0, 4));
  t2.hp = Math.floor(t2.maxHp / 4) + 2; s.events.length = 0;
  s.forced = [19, 6, 6]; HTL._attack(s, f2, t2, HTL.HEROES.fighter.attack);
  assert.strictEqual(events(s, 'dive')[0].door, 2, 'below a quarter it dives again, nearer still');
  nextRound(s); nextRound(s);
  const t3 = s.units.find(u => u.alive && u.type === 'lawnThing'), f3 = tough(put(s, 'hero', 'fighter', 2, 2));
  t3.hp = 5; s.events.length = 0;
  s.forced = [19, 1, 1]; HTL._attack(s, f3, t3, HTL.HEROES.fighter.attack);
  assert.ok(!events(s, 'dive').length && t3.alive, 'and no more after that');
  assert.ok(!HTL.MONSTERS.ankheg.traits.surface && HTL.MONSTERS.lawnThing.figure === 'ankheg' && HTL.MONSTERS.lawnThing.traits.boss);
});
test('the fish pond: swimmers go straight across, walkers go round by whichever side is weaker', () => {
  const m = HTL.MAPS.pond, s = bare(5, 'pond');
  assert.ok(m.fields.swim.dist[3][10] < m.fields.walk.dist[3][10]);
  const frog = put(s, 'monster', 'giantFrog', 3, 9);
  assert.strictEqual(HTL.MAPS.pond.rows[HTL.stepOf(s, frog).lane][HTL.stepOf(s, frog).sq], '~', 'the frog goes into the pond');
  const way = heroes => { const t = bare(5, 'pond'); heroes.forEach(h => put(t, 'hero', ...h)); const g = put(t, 'monster', 'goblin', 3, 9); return HTL.stepOf(t, g).lane; };
  assert.strictEqual(way([['ranger', 1, 1], ['fighter', 1, 5]]), 4, 'heroes on top: it goes round the bottom');
  assert.strictEqual(way([['ranger', 5, 1], ['fighter', 5, 5]]), 2, 'heroes below: over the top');
});
// every feat a trophy asks for is passed on from the battle: tested in tests/browser.test.js, by watching what a battle
// hands the campaign when it ends
test('the ice house: walkers slide down the ice twice as fast, nobody can stand on it, and flyers don’t care', () => {
  const m = HTL.MAPS.icehouse, s = bare(5, 'icehouse');
  assert.strictEqual(m.rows[1][4], '=');
  assert.strictEqual(HTL.canPlace(s, 'fighter', 1, 4), 'off', 'nobody stands on the ice');
  assert.strictEqual(HTL.canPlace(s, 'fighter', 2, 4), null, 'the floor beside it is fine');
  assert.ok(m.fields.walk.dist[1][9] < m.fields.fly.dist[1][9], 'walking down the ice is quicker than flying');
  const wolf = put(s, 'monster', 'direWolf', 1, 7); nextRound(s); nextRound(s);
  assert.ok(7 - wolf.sq >= 3, 'on the ice a wolf slides past the two squares a turn it manages on floor: ' + wolf.sq);
  for (const [t, l, q] of m.plan) assert.ok('.~^+'.indexOf(m.rows[l][q]) >= 0, 'Simz plans ' + t + ' on ' + l + ',' + q);
});
test('a hatch that can’t throw its hero clear still lets its monster up, on the nearest free square', () => {
  const s = bare(5, 'larder'), m = HTL.MAPS.larder, hi = 4, hd = m.doors[hi];
  const f = put(s, 'hero', 'fighter', hd.lane, hd.sq);
  for (const [dl, dq] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) put(s, 'hero', 'fighter', hd.lane + dl, hd.sq + dq); // boxed in
  s.pending.push({ round: s.round + 1, type: 'orc', door: hi, pool: [hi] });
  nextRound(s); nextRound(s);
  const orc = s.units.find(u => u.type === 'orc');
  assert.ok(orc, 'the orc came up all the same');
  assert.ok(f.lane === hd.lane && f.sq === hd.sq && (orc.lane !== hd.lane || orc.sq !== hd.sq), 'beside the hero who is still standing there');
  assert.strictEqual(s.pending.length, 0);
});
test('the well: a way in out in the middle of the floor, that nobody can stand on', () => {
  const m = HTL.MAPS.wellyard, s = bare(5, 'wellyard');
  const i = m.doors.findIndex(d => m.rows[d.lane][d.sq] === '@');
  assert.ok(i >= 0 && m.doors[i].sq === 6, 'the well is one of the doors');
  assert.strictEqual(HTL.canPlace(s, 'ranger', m.doors[i].lane, m.doors[i].sq), 'off');
  s.pending.push({ round: s.round + 1, type: 'giantFrog', door: i, pool: [i] }); nextRound(s);
  const frog = s.units.find(u => u.type === 'giantFrog');
  assert.ok(frog && frog.lane === 2 && frog.sq === 6, 'a frog climbs out of the well');
});
test('the Thing in the Well heals in water or the well, and not on dry floor', () => {
  const s = bare(5, 'well'), t = put(s, 'monster', 'thingInWell', 3, 3); // in the water
  t.hp = 100; nextRound(s); nextRound(s);
  assert.ok(events(s, 'regen').some(e => e.id === t.id && e.amount === HTL.MONSTERS.thingInWell.traits.soak), 'healed in the water');
  const d = bare(5, 'well'), u = put(d, 'monster', 'thingInWell', 0, 2); // on dry floor
  u.hp = 100; nextRound(d); nextRound(d);
  assert.ok(!events(d, 'regen').some(e => e.id === u.id), 'not on dry floor');
  assert.ok(HTL.MONSTERS.thingInWell.traits.boss && HTL.MONSTERS.thingInWell.traits.amphibious && HTL.MONSTERS.thingInWell.figure === 'horror');
  const dry = sandbox.HTL_CAMPAIGN.TROPHIES.find(x => x.id === 'dryland');
  assert.ok(dry.test({ feats: { dry: true } }) && !dry.test({ feats: {} }));
});
test('skylights: once something breaks in, daylight burns the undead on it and next to it, and stops the Lodger healing', () => {
  const s = bare(5, 'attic'), m = HTL.MAPS.attic, si = 3, sd = m.doors[si];
  assert.ok(m.skylights && m.hatches[si] && sd.lane === 2 && sd.sq === 3);
  assert.ok(!HTL.sunlit(s, 2, 4), 'no daylight while the glass is whole');
  s.pending.push({ round: s.round + 1, type: 'caveBat', door: si, pool: [si] }); nextRound(s);
  assert.ok(events(s, 'hatch').some(e => e.door === si), 'the bat breaks in');
  assert.ok(HTL.sunlit(s, 2, 4) && HTL.sunlit(s, 1, 2) && !HTL.sunlit(s, 2, 5), 'daylight on the skylight and the squares round it');
  s.units.forEach(u => { if (u.type === 'caveBat') u.alive = false; });
  const sk = tough(put(s, 'monster', 'skeleton', 2, 4)), orc = tough(put(s, 'monster', 'orc', 1, 3)), lod = put(s, 'monster', 'lodger', 3, 4);
  lod.hp = 100; s.events.length = 0; nextRound(s); nextRound(s);
  const burnt = id => events(s, 'burn').some(e => e.id === id && e.sun);
  assert.ok(burnt(sk.id), 'the skeleton burns in the daylight');
  assert.ok(!burnt(orc.id), 'the orc doesn’t care');
  assert.ok(burnt(lod.id) && !events(s, 'regen').some(e => e.id === lod.id), 'the Lodger burns and doesn’t heal');
  const dark = bare(5, 'attic'), l2 = put(dark, 'monster', 'lodger', 3, 10); l2.hp = 100; nextRound(dark); nextRound(dark);
  assert.ok(events(dark, 'regen').some(e => e.id === l2.id && e.amount === 20), 'out of the light he heals 20 a turn');
  assert.ok(HTL.MONSTERS.lodger.traits.boss && HTL.MONSTERS.lodger.figure === 'vampire');
  for (const id of ['gallery', 'rafters', 'attic']) for (const [t, l, q] of HTL.MAPS[id].plan) assert.ok(!HTL._risky(HTL.MAPS[id], l, q), id + ': Simz plans ' + t + ' on a skylight');
});
test('the house trophy: every battle in the house, cellar to rafters', () => {
  const C = sandbox.HTL_CAMPAIGN, c = C.fresh(), win = id => C.record(c, { battle: id, difficulty: 'medium', won: true, livesLost: 0, goldLeft: 0, met: [], slain: {}, placed: {}, feats: { bards: 3 } });
  assert.strictEqual(C.HOUSE.length, 18, 'eighteen battles in the house');
  C.CELLAR.forEach(win); C.HOUSE.slice(0, -1).forEach(win);
  assert.ok(!c.trophies.wholehouse);
  win(C.HOUSE[C.HOUSE.length - 1]);
  assert.ok(c.trophies.wholehouse, 'the attic finishes the house');
});
// ---------- Phase 6: the Delve's bestiary ----------
test('giant crab: arrows do half against its shell, blades do not, and water does not slow it', () => {
  const s = bare(5, 'cistern'), c = tough(put(s, 'monster', 'giantCrab', 2, 8)), r = put(s, 'hero', 'ranger', 2, 1), f = put(s, 'hero', 'fighter', 2, 7);
  s.forced = [15, 6]; HTL._attack(s, r, c, HTL.HEROES.ranger.attack); s.forced = [15, 6]; HTL._attack(s, f, c, HTL.HEROES.fighter.attack);
  const [shot, cut] = events(s, 'attack'); assert.ok(shot.resisted && !cut.resisted && shot.dmg < cut.dmg);
  const w = bare(5, 'cistern'), crab = put(w, 'monster', 'giantCrab', 1, 6), rat = put(w, 'monster', 'direRat', 3, 6);
  crab.hp = rat.hp = 999; stepRounds(w, 4);
  assert.ok(crab.lane === 1 && crab.sq <= 3, 'the crab wades straight through the water: ' + crab.lane + ',' + crab.sq);
});
test('giant frog: its tongue reaches past the first hero to the one behind', () => {
  const s = bare(), fr = put(s, 'monster', 'giantFrog', 2, 6), front = tough(put(s, 'hero', 'fighter', 2, 5)), back = tough(put(s, 'hero', 'ranger', 2, 4));
  tough(fr); stepRounds(s, 2);
  assert.ok(events(s, 'attack').some(e => e.from === fr.id && e.to === back.id), 'it goes for the Ranger behind the Fighter');
  assert.ok(!events(s, 'attack').some(e => e.from === fr.id && e.to === front.id));
});
test('drowned dead: get back up once, but not from a holy blow or a critical', () => {
  const s = bare(), d = put(s, 'monster', 'drowned', 2, 6), f = put(s, 'hero', 'fighter', 2, 5);
  d.hp = 1; s.forced = [15, 6]; HTL._attack(s, f, d, HTL.HEROES.fighter.attack);
  assert.ok(d.alive && d.hp === Math.ceil(d.maxHp / 2) && events(s, 'rise').length === 1);
  d.hp = 1; s.forced = [15, 6]; HTL._attack(s, f, d, HTL.HEROES.fighter.attack); assert.ok(!d.alive, 'only once');
  const t = bare(), e = put(t, 'monster', 'drowned', 2, 6), g = put(t, 'hero', 'fighter', 2, 5);
  e.hp = 1; t.forced = [20, 6, 6]; HTL._attack(t, g, e, HTL.HEROES.fighter.attack); assert.ok(!e.alive, 'a critical keeps it down');
});
test('animated armour: every weapon hit does two less, but spells hit fully', () => {
  const s = bare(), a = tough(put(s, 'monster', 'animatedArmour', 2, 6)), f = put(s, 'hero', 'fighter', 2, 5), w = put(s, 'hero', 'wizard', 2, 1);
  s.forced = [19, 6]; HTL._attack(s, f, a, HTL.HEROES.fighter.attack); s.forced = [19, 6]; HTL._attack(s, w, a, HTL.HEROES.wizard.attack);
  const [blow, bolt] = events(s, 'attack');
  assert.ok(blow.resisted && blow.dmg === 6 + HTL.HEROES.fighter.attack.mod - 2, 'blade: ' + blow.dmg);
  assert.ok(!bolt.resisted, 'the Wizard’s bolt is not stopped');
});
test('mimic: turns up as a chest in the middle of the mat, unseen, and wakes when a hero comes close; its hits stick', () => {
  const s = bare(9, 'tomb'); s.pending.push({ round: s.round, type: 'mimic', door: 2, pool: [2] }); stepRounds(s, 1);
  const m = s.units.find(u => u.alive && u.type === 'mimic'), map = HTL.mapOf(s);
  assert.ok(m && m.sq >= 3 && m.sq < map.w - 3 && m.dormant, 'a chest out on the mat at ' + m.lane + ',' + m.sq);
  assert.ok(events(s, 'spawn').some(e => e.id === m.id && e.how === 'disguised'));
  const r = put(s, 'hero', 'ranger', m.lane, 0); r.hp = r.maxHp = 999; s.events.length = 0; stepRounds(s, 1);
  assert.ok(!events(s, 'attack').some(e => e.to === m.id), 'nobody shoots at a treasure chest');
  const f = tough(put(s, 'hero', 'fighter', m.lane, m.sq - 1)); stepRounds(s, 1);
  assert.ok(!m.dormant && events(s, 'wake').some(e => e.id === m.id));
  s.forced = [20, 6, 6]; HTL._attack(s, m, f, HTL.MONSTERS.mimic.attack); assert.ok(HTL.hasStatus(f, 'stuck'), 'stuck fast');
});
test('mummy: a hero it hits cannot be healed for three rounds, and fire does double', () => {
  const s = bare(), mu = tough(put(s, 'monster', 'mummy', 2, 6)), f = tough(put(s, 'hero', 'fighter', 2, 5)), c = put(s, 'hero', 'cleric', 2, 3);
  s.forced = [20, 6, 6, 6, 6]; HTL._attack(s, mu, f, HTL.MONSTERS.mummy.attack);
  assert.ok(HTL.hasStatus(f, 'rotting')); f.hp = f.maxHp - 50; s.events.length = 0;
  stepRounds(s, 1); assert.ok(!events(s, 'cure').some(e => e.id === f.id), 'the Cleric can’t heal the rot');
  const t = bare(), m2 = tough(put(t, 'monster', 'mummy', 2, 6)), w = put(t, 'hero', 'wizard', 2, 1);
  t.forced = [6, 6, 6, 6, 6, 6, 6, 6, 1]; HTL._fireball(t, w, { lane: 2, sq: 6 }, HTL.HEROES.wizard.spell);
  const fb = events(t, 'fireball')[0], sv = events(t, 'save')[0]; assert.strictEqual(sv.dmg, fb.dmg * 2);
});
test('salamander: heroes who hit it up close are burned, and fire does nothing to it', () => {
  const s = bare(), sa = tough(put(s, 'monster', 'salamander', 2, 6)), f = tough(put(s, 'hero', 'fighter', 2, 5)), r = put(s, 'hero', 'ranger', 2, 1);
  s.forced = [19, 6, 4]; HTL._attack(s, f, sa, HTL.HEROES.fighter.attack); assert.ok(events(s, 'scald').some(e => e.id === f.id && e.dmg === 4));
  s.events.length = 0; s.forced = [19, 6]; HTL._attack(s, r, sa, HTL.HEROES.ranger.attack); assert.strictEqual(events(s, 'scald').length, 0, 'arrows don’t get burned');
  const w = put(s, 'hero', 'wizard', 2, 0); s.events.length = 0; HTL._fireball(s, w, { lane: 2, sq: 6 }, HTL.HEROES.wizard.spell);
  assert.strictEqual(events(s, 'save').find(e => e.to === sa.id).dmg, 0);
});
test('gelatinous cube: swallows a hero, the acid burns, and killing the cube lets it out', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)), c = put(s, 'monster', 'gelCube', 2, 5);
  s.forced = [20, 3, 3, 3, 3, 3, 3]; HTL._attack(s, c, f, HTL.MONSTERS.gelCube.attack);
  assert.ok(f.inside === c.id && f.lane === -1 && events(s, 'engulf').length === 1);
  assert.strictEqual(HTL.recall(s, f.id), 'inside');
  stepRounds(s, 2); assert.ok(events(s, 'acid').some(e => e.id === f.id));
  const w = put(s, 'hero', 'wizard', 2, 1); c.hp = 1; s.forced = [15, 5]; HTL._attack(s, w, c, HTL.HEROES.wizard.attack);
  assert.ok(!c.alive && !f.inside && f.lane === 2 && f.sq === 5 && events(s, 'release').length === 1);
});
test('rust monster: armour flakes away', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)), r = put(s, 'monster', 'rustMonster', 2, 5), ac = f.ac;
  atk(s, r, f, 20, 1, 1); assert.strictEqual(f.ac, ac - 2);
});
test('medusa: her gaze turns a hero to stone, and the statue holds the square', () => {
  const s = bare(); const f = tough(put(s, 'hero', 'fighter', 2, 4)), m = tough(put(s, 'monster', 'medusa', 2, 6)); m.turns = 2;
  s.forced = [5]; HTL.step(s, 2.05);
  assert.ok(f.petrified && events(s, 'petrify').length === 1);
  stepRounds(s, 2); assert.ok(!events(s, 'attack').some(e => e.from === f.id), 'statues do not swing');
});
test('vampire: charms a hero into attacking its friend', () => {
  const s = bare(); const a = tough(put(s, 'hero', 'fighter', 2, 4)), b = tough(put(s, 'hero', 'fighter', 1, 4)), v = tough(put(s, 'monster', 'vampire', 2, 5)); v.turns = 2;
  s.forced = [3]; HTL.step(s, 2.05);
  const charmed = [a, b].find(h => HTL.hasStatus(h, 'charmed')); assert.ok(charmed, 'someone is charmed');
  stepRounds(s, 2); assert.ok(events(s, 'charmed').some(e => e.id === charmed.id));
});
test('necromancer: monsters that fall near it get back up as skeletons', () => {
  const s = bare(); tough(put(s, 'monster', 'necromancer', 2, 7)); const f = put(s, 'hero', 'fighter', 2, 4), g = put(s, 'monster', 'goblin', 2, 5); g.hp = 1;
  atk(s, f, g, 15, 5);
  const up = HTL.unitAt(s, 2, 5); assert.ok(up && up.type === 'skeleton' && up.minor);
});
test('young red dragon: breathes fire down its whole row, a save for half', () => {
  const s = bare(); const a = tough(put(s, 'hero', 'fighter', 2, 2)), b = tough(put(s, 'hero', 'ranger', 2, 0)), other = tough(put(s, 'hero', 'fighter', 1, 2));
  const dr = tough(put(s, 'monster', 'redDragon', 2, 8)); dr.turns = 2;
  HTL.step(s, 2.05);
  const sc = events(s, 'scorch'); assert.ok(events(s, 'breath').length === 1 && sc.length === 2 && !sc.some(e => e.to === other.id));
  void a; void b;
});
test('every new hero can reach level 3 on either path', () => {
  for (const ty of ['paladin', 'druid', 'monk', 'warlock', 'sorcerer', 'tinker']) for (const path of Object.keys(HTL.PATHS[ty])) {
    const s = bare(); s.gold = 9999; HTL.place(s, ty, 2, 1); const u = HTL.unitAt(s, 2, 1);
    assert.strictEqual(HTL.levelUp(s, u.id), null); assert.strictEqual(HTL.levelUp(s, u.id, path), null, ty + ' ' + path);
  }
});
test('Simz takes every new hero into some battle, and places it', () => {
  const used = new Set();
  for (const b of HTL.BATTLES) {
    const party = HTL.suggestLoadout(b.id).pick;
    const { s } = play(7, b.id, HTL.autoplay, 0.25, { loadout: party });
    void s;
    const { log } = play(7, b.id, HTL.autoplay, 0.25, { loadout: party });
    for (const e of log) if (e.type === 'place') used.add(e.unitType);
  }
  for (const ty of ['paladin', 'druid', 'monk', 'warlock', 'sorcerer', 'tinker']) assert.ok(used.has(ty), ty + ' never placed');
});

// ---------- Phase 5: the tavern's upgrades ----------
test('tavern upgrades: a stouter door, a deeper till, and nothing changes without them', () => {
  const plain = HTL.newGame(5, 'warren'), up = HTL.newGame(5, 'warren', { tavern: { door: 2, till: 3, kitchen: 9 } });
  assert.strictEqual(up.lives, plain.lives + 2); assert.strictEqual(up.maxLives, plain.maxLives + 2);
  assert.strictEqual(up.gold, plain.gold + 75);
  assert.strictEqual(up.tavern.kitchen, 2, 'levels are capped');
  assert.strictEqual(plain.tavern.door + plain.tavern.till + plain.tavern.kitchen + plain.tavern.training, 0);
});
test('Deadly leaves the tavern\'s upgrades and the armoury behind, and only the cats come along', () => {
  const help = { tavern: { door: 2, till: 3, kitchen: 2, training: 2 }, items: { fighter: 'longsword' }, cats: { duty: 'simz' } };
  const plain = HTL.newGame(5, 'warren', { difficulty: 'deadly' }), up = HTL.newGame(5, 'warren', Object.assign({ difficulty: 'deadly' }, help));
  assert.strictEqual(up.lives, plain.lives); assert.strictEqual(up.gold, plain.gold);
  assert.strictEqual(JSON.stringify(up.tavern), JSON.stringify(plain.tavern)); assert.strictEqual(JSON.stringify(up.items), '{}');
  assert.ok(up.powers && up.duty === 'simz', 'the cats still keep watch');
  const hard = HTL.newGame(5, 'warren', Object.assign({ difficulty: 'hard' }, help));
  assert.strictEqual(hard.lives, HTL.newGame(5, 'warren', { difficulty: 'hard' }).lives + 2); assert.strictEqual(hard.items.fighter, 'longsword');
});
test('tavern upgrades: the kitchen heals more on a short rest', () => {
  const healAfterRest = kitchen => {
    const s = bare(3, 'warren'); s.tavern = HTL.tavernOf({ kitchen });
    const h = HTL.addUnit(s, 'hero', 'fighter', 2, 0); h.hp = h.maxHp - 20;
    s.waveActive = true; s.wave = 0; s.pending = [];
    HTL.step(s, TICK);
    return h.hp - (h.maxHp - 20);
  };
  assert.strictEqual(healAfterRest(0), 10); assert.strictEqual(healAfterRest(1), 15); assert.strictEqual(healAfterRest(2), 20);
});
test('tavern upgrades: the training room sends the first of each kind out at level 2, then all of them', () => {
  const s = HTL.newGame(4, 'warren', { tavern: { training: 1 } }); s.gold = 999;
  assert.strictEqual(HTL.place(s, 'fighter', 0, 0), null); assert.strictEqual(HTL.place(s, 'fighter', 1, 0), null);
  const [a, b] = s.units.filter(u => u.type === 'fighter');
  assert.strictEqual(a.level, 2); assert.strictEqual(b.level, 1); assert.strictEqual(a.maxHp, b.maxHp + Math.ceil(HTL.HEROES.fighter.hp * 0.25));
  assert.strictEqual(HTL.upgradeCost(a), HTL.HEROES.fighter.up[1], 'the next level is level 3');
  const t = HTL.newGame(4, 'warren', { tavern: { training: 2 } }); t.gold = 999;
  HTL.place(t, 'ranger', 0, 0); HTL.place(t, 'ranger', 1, 0);
  assert.ok(t.units.every(u => u.level === 2));
});
test('the party suggestion keeps to the heroes a campaign has', () => {
  const r = HTL.suggestLoadout('crypt', ['fighter', 'ranger', 'wizard', 'cleric', 'bard']);
  assert.strictEqual(r.pick.length, 5); assert.strictEqual(r.size, 5);
  assert.ok(r.pick.every(t => ['fighter', 'ranger', 'wizard', 'cleric', 'bard'].indexOf(t) >= 0));
});

// ---------- Phase 5: the modes ----------
const MODES = sandbox.HTL_MODES;
const freshBox = () => { const box = {}; vm.createContext(box); for (const f of ['pack-core.js', 'sim.js', 'simz.js', 'modes.js']) vm.runInContext(read(f), box, { filename: f }); return box; };
const simzPlays = (H, id, opts, seed) => {
  const s = H.newGame(seed || 1, id, opts || {}), log = []; let last = -1, g = 0;
  while (s.phase === 'running' && g++ < 120000) { if (s.round !== last) { last = s.round; H.autoplay(s); } H.step(s, 0.25); for (const e of s.events) log.push(e.type + (e.id || '') + (e.dmg || '') + (e.roll || '')); s.events.length = 0; }
  return { s, log: log.join(',') };
};
test('the Daily Challenge: the same date makes the same battle, party and dice on two machines', () => {
  const a = freshBox(), b = freshBox(), id = 'daily:2026-11-08';
  const ba = a.HTL.battleById(id), bb = b.HTL.battleById(id);
  assert.strictEqual(JSON.stringify(ba.waves.map(w => w.spawns)), JSON.stringify(bb.waves.map(w => w.spawns)));
  assert.strictEqual(JSON.stringify(ba.party), JSON.stringify(bb.party)); assert.strictEqual(ba.map, bb.map); assert.strictEqual(ba.seed, bb.seed);
  const ra = simzPlays(a.HTL, id, {}, 1), rb = simzPlays(b.HTL, id, { difficulty: 'deadly', tavern: { door: 2 } }, 99999);
  assert.strictEqual(ra.log, rb.log, 'every roll and every event alike, whatever seed or help the page asks for');
  assert.strictEqual(ra.s.seed, ba.seed); assert.strictEqual(rb.s.difficulty, 'medium'); assert.strictEqual(rb.s.tavern.door, 0);
  assert.notStrictEqual(JSON.stringify(a.HTL.battleById('daily:2026-11-09').waves.map(w => w.spawns)), JSON.stringify(ba.waves.map(w => w.spawns)), 'the next day is another battle');
  assert.strictEqual(a.HTL.battleById('daily:yesterday'), null);
  assert.ok(!/Date\(|Math\.random|performance\./.test(read('modes.js')), 'the modes never read a clock or roll their own dice');
});
test('the Daily Challenge: the party always has a wall, a bow, a song and a healer, and Simz wins most days', () => {
  let won = 0, n = 0;
  for (let k = 0; k < (QUICK ? 16 : 60); k++) {
    const date = new Date(Date.UTC(2026, 10, 1 + k * 3)).toISOString().slice(0, 10), b = HTL.battleById('daily:' + date);
    assert.strictEqual(b.party.length, HTL.PARTY, date);
    for (const t of ['fighter', 'ranger', 'bard']) assert.ok(b.party.indexOf(t) >= 0, date + ' has a ' + t);
    assert.ok(b.party.some(t => ['cleric', 'druid', 'paladin'].indexOf(t) >= 0), date + ' has a healer');
    const r = simzPlays(HTL, 'daily:' + date); n++; if (r.s.phase === 'won') won++;
    assert.notStrictEqual(r.s.phase, 'running', date + ' never ends');
  }
  assert.ok(won / n >= 0.8, 'Simz wins ' + won + ' of ' + n + ' dailies');
});
test('Endless: waves are made as they are needed, the same whichever order, and they keep getting harder', () => {
  const a = freshBox().HTL.battleById('endless:77'), b = freshBox().HTL.battleById('endless:77');
  HTL.waveOf(a, 12); for (let i = 12; i >= 0; i--) HTL.waveOf(b, i); // b makes them all at once from the far end
  for (let i = 0; i <= 12; i++) assert.strictEqual(a.waves[i].spawns, b.waves[i].spawns, 'wave ' + i);
  assert.ok(a.endless && a.waves.length === 13);
  const threat = w => w.parsed.reduce((n, p) => n + p.count * Math.max(0.5, HTL.MONSTERS[p.type].level), 0);
  assert.ok(threat(a.waves[12]) > threat(a.waves[2]) * 2, 'later waves are much bigger');
  assert.ok(HTL.waveOf(a, 4).parsed.some(p => HTL.MONSTERS[p.type].traits.boss), 'a boss every fifth wave');
  assert.ok((HTL.waveOf(a, 20).hp || 1) > 2, 'and from wave 11 every monster is tougher');
  const r = simzPlays(HTL, 'endless:3', {}, 3);
  assert.strictEqual(r.s.phase, 'lost', 'an endless game always ends'); assert.ok(MODES.held(r.s) >= 10, 'Simz holds a fair while: ' + MODES.held(r.s));
});
test('the Boss Rush: every boss in order of level, each with an escort from its own battle', () => {
  const b = HTL.battleById('rush:1'), bosses = b.waves.map(w => w.parsed.find(p => HTL.MONSTERS[p.type].traits.boss).type);
  assert.strictEqual(JSON.stringify(bosses), JSON.stringify(MODES.BOSSES));
  for (let i = 1; i < bosses.length; i++) assert.ok(HTL.MONSTERS[bosses[i]].level >= HTL.MONSTERS[bosses[i - 1]].level);
  assert.ok(simzPlays(HTL, 'rush:1').s.phase === 'won', 'Simz can win it');
});
test('puzzles: free heroes from a bench, no gold, one life, and every puzzle has a way through', () => {
  for (let n = 1; n <= MODES.PUZZLES.length; n++) {
    const p = MODES.PUZZLES[n - 1], id = 'puzzle:' + n, s = HTL.newGame(1, id, { difficulty: 'deadly', tavern: { door: 2 } });
    assert.strictEqual(s.gold, 0); assert.strictEqual(s.lives, 1); assert.strictEqual(s.difficulty, 'medium');
    assert.strictEqual(JSON.stringify(Object.keys(s.free)), JSON.stringify(Object.keys(p.heroes)));
    for (const [t, l, q] of p.solution) assert.strictEqual(HTL.place(s, t, l, q), null, p.name + ': ' + t);
    let g = 0; while (s.phase === 'running' && g++ < 40000) { HTL.step(s, 0.25); s.events.length = 0; }
    assert.strictEqual(s.phase, 'won', p.name + ' is solved by its solution');
    // and it is a puzzle: everything bunched into the top row loses
    const lazy = HTL.newGame(1, id), map = HTL.mapOf(lazy); let q = 0;
    for (const t in p.heroes) for (let k = 0; k < p.heroes[t]; k++) { while (HTL.canPlace(lazy, t, 0, q)) q++; HTL.place(lazy, t, 0, q); }
    g = 0; while (lazy.phase === 'running' && g++ < 40000) { HTL.step(lazy, 0.25); lazy.events.length = 0; }
    assert.strictEqual(lazy.phase, 'lost', p.name + ' is not won by just anything (' + map.id + ')');
  }
  const s = HTL.newGame(1, 'puzzle:1');
  assert.strictEqual(HTL.canPlace(s, 'wizard', 2, 1), 'locked'); assert.strictEqual(HTL.canPlace(s, 'barricade', 2, 1), 'locked');
  assert.strictEqual(HTL.place(s, 'fighter', 2, 4), null); assert.strictEqual(HTL.canPlace(s, 'fighter', 1, 1), 'limit');
  const f = s.units.find(u => u.type === 'fighter'); assert.strictEqual(HTL.recall(s, f.id), null);
  assert.strictEqual(s.free.fighter, 1, 'a recalled hero goes back on the bench'); assert.strictEqual(s.gold, 0);
});
test('a stand-off in the modes ends: long after the last arrival the nearest monster walks in; the campaign keeps its rules', () => {
  const s = HTL.newGame(1, 'endless:5'); let g = 0;
  while (s.phase === 'running' && s.round < 12 && g++ < 9000) { HTL.step(s, 0.25); s.events.length = 0; }
  assert.ok(s.arrived > 0, 'the modes note when the last monster came up');
  // pretend the last monster came up long ago: the nearest one walks in at the start of the next round
  while (s.pending.length && g++ < 9000) { HTL.step(s, 0.25); s.events.length = 0; }
  assert.ok(s.waveActive && s.units.some(u => u.alive && u.kind === 'monster'), 'the wave is still on');
  s.arrived = s.round - 60; s.events.length = 0;
  const r0 = s.round; g = 0; while (s.round === r0 && g++ < 100) HTL.step(s, 0.05);
  const rest = s.events.find(e => e.type === 'restless');
  assert.ok(rest, 'one has had enough'); assert.ok(s.events.some(e => e.type === 'leak' && e.id === rest.id), 'and walks into the tavern');
  const camp = HTL.newGame(1, 'warren'); g = 0;
  while (camp.phase === 'running' && camp.round < 12 && g++ < 9000) { HTL.step(camp, 0.25); camp.events.length = 0; }
  assert.strictEqual(camp.arrived, undefined, 'a campaign battle never starts the clock');
  const noted = id => { const t = HTL.newGame(1, id); let k = 0; while (t.phase === 'running' && t.round < 12 && k++ < 9000) { HTL.step(t, 0.25); t.events.length = 0; } return t.arrived; };
  const turned = HTL.BATTLES.find(b => !b.mode && b.stage !== 2 && HTL.MAPS[b.map] && HTL.MAPS[b.map].turns), house = HTL.BATTLES.find(b => b.stage === 2);
  assert.ok(turned && noted(turned.id) != null, 'a cellar of the new shapes starts the clock: ' + (turned && turned.id));
  assert.ok(house && noted(house.id) != null, 'so does the house: ' + (house && house.id));
});
// two attackers for Reverse: a steady trickle of the cheapest, and a crowd at the weakest door every few rounds
const ATTACK = {
  trickle: s => { const rv = HTL.battle(s).reverse, t = rv.pool.slice().sort((a, b) => HTL.sendCost(a) - HTL.sendCost(b))[0], n = HTL.mapOf(s).doors.length; while (!HTL.send(s, t, s.sent % n)); },
  crowd: s => {
    const rv = HTL.battle(s).reverse, m = HTL.mapOf(s), heroes = d => s.units.filter(u => u.alive && u.kind === 'hero' && u.lane === m.doors[d].lane).length;
    const door = m.doors.map((_, i) => i).sort((a, b) => heroes(a) - heroes(b) || a - b)[0];
    const byLv = rv.pool.slice().sort((a, b) => HTL.MONSTERS[b].level - HTL.MONSTERS[a].level);
    if (s.round % 6 === 0 || s.round >= rv.rounds - 1) { HTL.send(s, byLv[0], door); let k = 0; while (k++ < 8 && !HTL.send(s, byLv[byLv.length - 1], door)); }
    if (rv.boss && !s.bossSent && s.round > rv.rounds / 2) HTL.send(s, rv.boss, door);
  }
};
const attack = (H, id, brain) => { const s = H.newGame(1, id); let last = -1, g = 0; const log = [];
  while (s.phase === 'running' && g++ < 60000) { if (s.round !== last) { last = s.round; brain(s); } H.step(s, 0.25); for (const e of s.events) log.push(e.type + (e.id || '') + (e.roll || '')); s.events.length = 0; }
  return { s, log: log.join(',') }; };
test('Reverse: you send monsters from a purse through the doors, and Simz keeps the tavern every round', () => {
  for (const b of HTL.BATTLES) {
    const r = HTL.battleById('reverse:' + b.id);
    assert.ok(r && r.fixed && r.party.length === HTL.PARTY && !r.waves.length, b.id);
    assert.strictEqual(JSON.stringify(r.reverse.pool), JSON.stringify(b.monsters.filter(t => !HTL.MONSTERS[t].traits.boss)));
  }
  const s = HTL.newGame(1, 'reverse:warren'), R = MODES.REVERSE;
  assert.strictEqual(s.purse, R.purse); assert.strictEqual(HTL.sendCost('goblin'), 25); assert.strictEqual(HTL.sendCost('goblinChief'), 60);
  assert.strictEqual(HTL.canSend(s, 'ogre'), 'unknown'); s.purse = 20; assert.strictEqual(HTL.canSend(s, 'goblin'), 'purse'); s.purse = R.purse;
  assert.strictEqual(HTL.send(s, 'goblin', 2), null); assert.strictEqual(s.purse, R.purse - 25);
  let g = 0; while (s.round < 2 && g++ < 100) HTL.step(s, 0.25);
  const gob = s.units.find(u => u.alive && u.type === 'goblin'), door = HTL.mapOf(s).doors[2];
  assert.ok(gob && gob.lane === door.lane, 'it comes up through the door it was sent to');
  assert.ok(s.units.some(u => u.alive && u.kind === 'hero'), 'Simz has heroes out without being asked');
  while (s.round < 4 && g++ < 200) HTL.step(s, 0.25);
  assert.strictEqual(s.purse, R.purse - 25 + R.income * 3, 'the purse fills every round');
  s.purse = 999; assert.strictEqual(HTL.send(s, 'goblinChief', 0), null); assert.strictEqual(HTL.canSend(s, 'goblinChief'), 'once');
  s.round = R.rounds + 1; assert.strictEqual(HTL.canSend(s, 'goblin'), 'closed');
  const idle = attack(HTL, 'reverse:caves', () => {});
  assert.strictEqual(idle.s.phase, 'won', 'send nothing and Simz keeps the tavern when the rounds run out');
  const a = attack(freshBox().HTL, 'reverse:march', ATTACK.crowd), b = attack(freshBox().HTL, 'reverse:march', ATTACK.crowd);
  assert.strictEqual(a.log, b.log, 'the same sends play out the same');
});
test('Reverse: a trickle of the cheapest rarely takes the tavern, a crowd at the right door usually does', () => {
  const take = brain => HTL.BATTLES.filter(b => attack(HTL, 'reverse:' + b.id, brain).s.phase === 'lost').length;
  const trickle = take(ATTACK.trickle), crowd = take(ATTACK.crowd);
  assert.ok(trickle <= 4, 'a trickle takes ' + trickle + ' of ' + HTL.BATTLES.length);
  assert.ok(crowd >= 6, 'a crowd takes ' + crowd + ' of ' + HTL.BATTLES.length);
});
test('the campaign records the modes: bests, takings once, and mode wins are not campaign wins', () => {
  const C = sandbox.HTL_CAMPAIGN, c = C.fresh(), day = '2026-11-08';
  const base = { difficulty: 'medium', livesLost: 0, goldLeft: 0, met: [], slain: {}, placed: {}, feats: { bards: 1 } };
  let r = C.record(c, Object.assign({}, base, { battle: 'endless:9', mode: 'endless', won: false, waves: 12 }), day);
  assert.strictEqual(c.modes.endless, 12); assert.ok(r.mode.best); assert.strictEqual(r.takings, 60 + 100, '5 a wave, and the trophy for ten');
  assert.ok(r.trophies.some(t => t.id === 'endless10'));
  r = C.record(c, Object.assign({}, base, { battle: 'endless:10', mode: 'endless', won: false, waves: 8 }), day);
  assert.strictEqual(c.modes.endless, 12); assert.ok(!r.mode.best);
  r = C.record(c, Object.assign({}, base, { battle: 'daily:' + day, mode: 'daily', date: day, score: 1200, won: true }), day);
  assert.ok(r.mode.first && r.takings >= C.MODE_PAY.daily); assert.ok(r.trophies.some(t => t.id === 'daily'));
  assert.ok(!r.trophies.some(t => t.id === 'open' || t.id === 'flawless' || t.id === 'nobard'), 'a mode win is not a campaign win');
  r = C.record(c, Object.assign({}, base, { battle: 'daily:' + day, mode: 'daily', date: day, score: 900, won: true }), day);
  assert.strictEqual(r.takings, 0, 'the day pays once'); assert.strictEqual(c.modes.daily[day].score, 1200);
  for (let n = 1; n <= MODES.PUZZLES.length; n++) r = C.record(c, Object.assign({}, base, { battle: 'puzzle:' + n, mode: 'puzzle', puzzle: n, won: true }), day);
  assert.ok(r.trophies.some(t => t.id === 'puzzles'));
  r = C.record(c, Object.assign({}, base, { battle: 'puzzle:1', mode: 'puzzle', puzzle: 1, won: true }), day); assert.strictEqual(r.takings, 0);
  r = C.record(c, Object.assign({}, base, { battle: 'reverse:warren', mode: 'reverse', theme: 'warren', won: true }), day);
  assert.strictEqual(r.takings, C.MODE_PAY.reverse + 80); assert.ok(c.modes.reverse.warren && r.trophies.some(t => t.id === 'reverse'));
  r = C.record(c, Object.assign({}, base, { battle: 'reverse:warren', mode: 'reverse', theme: 'warren', won: true }), day); assert.strictEqual(r.takings, 0);
  r = C.record(c, Object.assign({}, base, { battle: 'rush:1', mode: 'rush', won: true, lives: 4 }), day);
  assert.strictEqual(c.modes.rush, 4); assert.ok(r.trophies.some(t => t.id === 'rush'));
  assert.strictEqual(C.winsCount(c), 0, 'no cellar battle was won'); assert.strictEqual(c.totals.wins, 0);
  const back = C.clean(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(JSON.stringify(back.modes), JSON.stringify(c.modes), 'the modes survive a save and load');
});

// ---------- the pack is plain, readable data ----------
// the pack as written, before the rules compile its maps (they add distance tables, with Infinity for walled-off squares)
const packAsWritten = () => { const box = {}; vm.createContext(box); vm.runInContext(read('pack-core.js'), box, { filename: 'pack-core.js' }); return box.HTL_PACKS.core; };
test('the pack is plain data: it survives a trip through JSON unchanged, so an editor or a JSON file can carry it', () => {
  const P = packAsWritten(), back = JSON.parse(JSON.stringify(P));
  assert.deepStrictEqual(back, JSON.parse(JSON.stringify(back)), 'round trip');
  const bad = []; (function walk(o, at) {
    if (typeof o === 'function' || o === undefined || (typeof o === 'number' && !isFinite(o))) bad.push(at);
    else if (o && typeof o === 'object') for (const k in o) walk(o[k], at + '.' + k);
  })(P, 'pack');
  assert.deepStrictEqual(bad, [], 'values JSON cannot hold');
});
test('every monster is written out with named fields, all of them present and the right kind', () => {
  const NUM = ['level', 'hp', 'ac', 'init', 'dexSave', 'speed', 'bounty'], ATK = ['bonus', 'n', 'd', 'mod', 'range'];
  for (const [id, m] of Object.entries(packAsWritten().monsters)) {
    assert.strictEqual(typeof m.name, 'string', id + ' name');
    for (const k of NUM) assert.ok(typeof m[k] === 'number' && isFinite(m[k]), id + ' ' + k);
    assert.ok(m.attack && typeof m.attack.name === 'string' && ['melee', 'ranged'].includes(m.attack.kind) && typeof m.attack.fx === 'string', id + ' attack');
    for (const k of ATK) assert.ok(typeof m.attack[k] === 'number', id + ' attack.' + k);
    assert.ok(m.traits && typeof m.traits === 'object' && !Array.isArray(m.traits), id + ' traits');
    assert.ok(m.level >= 1 && m.level <= 12 && m.hp > 0 && m.ac > 0 && m.speed > 0, id + ' sensible numbers');
  }
  assert.ok(!/\bM\(|\bA\(/.test(read('pack-core.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'no positional helpers left in the pack');
});

// ---------- motes ----------
test('every battle has a theme the page has motes for, and every theme names a kind of mote', () => {
  const M = vm.runInContext(read('view/motes.js') + '\n;({ MOTE_THEMES, MOTE_KINDS })', vm.createContext({}));
  for (const b of packAsWritten().battles) assert.ok(b.theme && M.MOTE_THEMES[b.theme], b.id + ' has no theme with motes (' + b.theme + ')');
  for (const [t, [kind, col]] of Object.entries(M.MOTE_THEMES)) { assert.ok(M.MOTE_KINDS[kind], t + ': no mote called ' + kind); assert.ok(/^#[0-9a-f]{6}$/i.test(col), t + ': colour'); }
});

test('every battle\'s theme has a floor: a Delve zone or one of the house\'s own, made of a material the Delve can bake', () => {
  const box = { window: {} }; box.window = box; vm.createContext(box);
  vm.runInContext(read('msdd_materials.js'), box);
  const F = vm.runInContext(read('view/floors.js') + '\n;({ HOUSE_FLOORS })', box), Mat = box.MSDDMat;
  for (const b of packAsWritten().battles) {
    const z = F.HOUSE_FLOORS[b.theme] || Mat.ZONES[b.theme];
    assert.ok(z && Mat.MATS[z.floor], b.id + ': no floor for the theme ' + b.theme);
    assert.ok(z.stone.length === 3 && z.stone.every(c => /^#[0-9a-f]{6}$/i.test(c)), b.id + ': floor colours');
  }
});

test('every trophy has a plaque, mounting a mini the pack has or an emblem that can be drawn', () => {
  const P = vm.runInContext('const TAU = Math.PI * 2;\n' + read('view/plaques.js') + '\n;({ PLAQUES, EMBLEMS })', vm.createContext({}));
  const TR = sandbox.HTL_CAMPAIGN.TROPHIES;
  for (const t of TR) {
    const p = P.PLAQUES[t.id];
    assert.ok(p, 'the trophy ' + t.id + ' has no plaque');
    if (p.mini) assert.ok(HTL.MONSTERS[p.mini] || HTL.HEROES[p.mini], t.id + ': no mini called ' + p.mini);
    else assert.ok(P.EMBLEMS[p.emblem], t.id + ': no emblem called ' + p.emblem);
  }
  for (const id of Object.keys(P.PLAQUES)) assert.ok(TR.some(t => t.id === id), 'a plaque for a trophy that does not exist: ' + id);
});

// ---------- offline ----------
test('the offline worker keeps every file the page loads, and only those', () => {
  const page = read('index.html'), sw = read('sw.js');
  const files = new Set(JSON.parse('[' + sw.slice(sw.indexOf('const FILES = [') + 15, sw.indexOf('];', sw.indexOf('const FILES = ['))).replace(/'/g, '"').replace(/\s+/g, ' ') + ']'));
  const local = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|mailto:|#)/.test(u));
  for (const f of local) assert.ok(files.has(f), 'sw.js does not keep ' + f);
  const man = JSON.parse(read('manifest.webmanifest'));
  for (const i of man.icons) { assert.ok(files.has(i.src), 'sw.js does not keep ' + i.src); assert.ok(fs.existsSync(path.join(dir, i.src)), i.src + ' is missing'); }
  for (const f of files) if (f !== './') assert.ok(fs.existsSync(path.join(dir, f)), 'sw.js keeps ' + f + ', which does not exist');
  assert.ok(files.has('./') && files.has('manifest.webmanifest'));
});

// ---------- the events the rules send ----------
test('every event the rules send is in HTL.EVENTS, and every entry is sent somewhere', () => {
  const src = ['sim.js', 'simz.js', 'modes.js'].map(read).join('\n');
  const sent = new Set([...src.matchAll(/emit\(s, \{ type: '(\w+)'/g)].map(m => m[1]));
  for (const t of sent) assert.ok(HTL.EVENTS[t], 'the rules send "' + t + '", which HTL.EVENTS does not list');
  for (const t of Object.keys(HTL.EVENTS)) assert.ok(sent.has(t), 'HTL.EVENTS lists "' + t + '", which nothing sends');
  assert.strictEqual((src.match(/emit\(/g) || []).length - 1, (src.match(/emit\(s, \{ type: '\w+'/g) || []).length, 'every emit names its type where the test can see it');
  const seen = new Set(); // and as battles run
  for (const id of HTL.BATTLES.map(b => b.id).concat(['rush:1', 'reverse:warren'])) {
    const s = HTL.newGame(5, id); let last = -1, g = 0;
    while (s.phase === 'running' && g++ < 60000) { if (s.round !== last) { last = s.round; if (!s.purse) HTL.autoplay(s); } HTL.step(s, 0.1); for (const e of s.events.splice(0)) seen.add(e.type); }
  }
  for (const t of seen) assert.ok(HTL.EVENTS[t], 'a battle sent "' + t + '", which HTL.EVENTS does not list');
  assert.ok(seen.size >= 40, 'only ' + seen.size + ' kinds of event in every battle; is the check still watching?');
});
test('the page shows every event, or says why it needs nothing for it', () => {
  const v = read('view/events.js');
  const cases = new Set([...v.matchAll(/case '(\w+)'/g)].map(m => m[1]));
  const block = v.slice(v.indexOf('const SHOWN_FROM_STATE = {'), v.indexOf('};', v.indexOf('const SHOWN_FROM_STATE = {')));
  const quiet = new Set([...block.matchAll(/(\w+): '/g)].map(m => m[1]));
  for (const t of Object.keys(HTL.EVENTS)) assert.ok(cases.has(t) !== quiet.has(t), t + ': ' + (cases.has(t) ? 'shown, and also listed as shown from the state' : 'neither shown nor listed in SHOWN_FROM_STATE'));
  for (const t of cases) assert.ok(HTL.EVENTS[t], 'the page handles "' + t + '", which the rules never send');
  for (const t of quiet) assert.ok(HTL.EVENTS[t], 'SHOWN_FROM_STATE lists "' + t + '", which the rules never send');
});
test('the rules play without Simz, and Reverse says plainly that it needs him', () => {
  const box = {}; vm.createContext(box);
  for (const f of ['pack-core.js', 'sim.js', 'modes.js']) vm.runInContext(read(f), box, { filename: f });
  const H = box.HTL, s = H.newGame(3, 'warren');
  assert.strictEqual(H.autoplay, undefined, 'Simz is not part of the rules');
  assert.strictEqual(H.place(s, 'fighter', 2, 4), null);
  for (let i = 0; i < 2000 && s.phase === 'running'; i++) H.step(s, 0.1);
  assert.ok(s.round > 5, 'a battle runs');
  const r = H.newGame(3, 'reverse:warren');
  assert.throws(() => { for (let i = 0; i < 200; i++) H.step(r, 0.1); }, /simz\.js/);
  assert.ok(Object.isFrozen(H.look) && Object.values(H.look).every(f => typeof f === 'function' || typeof f === 'string'), 'HTL.look holds only questions and constants');
});

// ---------- the trait registry ----------
test('every trait in the pack is in the registry, and every registry entry is used by some monster', () => {
  const used = new Set();
  for (const [id, m] of Object.entries(packAsWritten().monsters)) for (const k of Object.keys(m.traits)) {
    assert.ok(HTL.TRAITS[k], id + ' has the trait "' + k + '", which the registry in sim.js does not list');
    used.add(k);
  }
  for (const k of Object.keys(HTL.TRAITS)) {
    assert.ok(used.has(k), 'no monster has the trait "' + k + '"');
    assert.ok(typeof HTL.TRAITS[k].where === 'string' && HTL.TRAITS[k].where.length > 3, k + ' says where its rules are');
  }
});
test('every trait the rules or the page look up is in the registry', () => {
  const files = ['sim.js', 'simz.js', 'modes.js', 'campaign.js'].concat(fs.readdirSync(path.join(dir, 'view')).map(f => 'view/' + f));
  for (const f of files) {
    const src = read(f), re = /traits\([^()]*\)\.(\w+)|\.traits\.(\w+)/g; let m;
    while ((m = re.exec(src))) { const k = m[1] || m[2]; assert.ok(HTL.TRAITS[k], f + ' looks up the trait "' + k + '", which the registry does not list'); }
  }
  // and while battles run: every lookup on a monster's traits, however the rules reach them
  const read_ = new Set(), saved = {};
  for (const [id, m] of Object.entries(HTL.MONSTERS)) {
    saved[id] = m.traits;
    m.traits = new Proxy(m.traits, { get(o, k) { if (typeof k === 'string') read_.add(k); return o[k]; } });
  }
  try {
    const ids = HTL.BATTLES.map(b => b.id).concat(['rush:1', 'endless:3', 'puzzle:0', 'puzzle:1']);
    for (const id of ids) {
      const s = HTL.newGame(11, id); let last = -1, g = 0;
      while (s.phase === 'running' && g++ < 60000) { if (s.round !== last) { last = s.round; HTL.autoplay(s); } HTL.step(s, 0.1); s.events.length = 0; }
    }
    for (const t of Object.keys(HTL.MONSTERS)) HTL.describe(t);
  } finally { for (const id of Object.keys(saved)) HTL.MONSTERS[id].traits = saved[id]; }
  const odd = [...read_].filter(k => !HTL.TRAITS[k] && !['toJSON', 'constructor', 'hasOwnProperty'].includes(k));
  assert.deepStrictEqual(odd, [], 'the rules read traits the registry does not list');
  assert.ok(read_.size >= 25, 'the battles read only ' + read_.size + ' traits; is the check still watching?');
});
test('every monster card says what each of its traits does', () => {
  for (const [id, m] of Object.entries(HTL.MONSTERS)) {
    const card = HTL.describe(id);
    for (const [k, v] of Object.entries(m.traits)) {
      const tx = HTL.TRAITS[k] && HTL.TRAITS[k].text;
      if (!v || !tx) continue;
      const line = typeof tx === 'function' ? tx(v, id) : tx;
      assert.ok(card.includes(line), id + '’s card leaves out ' + k);
    }
  }
});

// ---------- coverage: every mini fights somewhere ----------
test('the page loads the shared minis, then the pack, then the rules, then the game', () => {
  const page = read('index.html'), order = ['mitznsimz_minis.js', 'motion.js', 'sound.js', 'pack-core.js', 'sim.js', 'simz.js', 'modes.js', 'campaign.js', 'view/core.js', 'view/board.js', 'view/events.js', 'view/draw.js', 'view/motes.js', 'view/floors.js', 'view/plaques.js', 'view/hud.js', 'view/tavern.js', 'view/app.js'].map(f => page.indexOf('<script src="' + f + '"></script>'));
  assert.ok(order.every(i => i > 0), 'a script tag is missing: ' + order);
  assert.ok(order.every((i, k) => !k || i > order[k - 1]), 'scripts load out of order');
  assert.ok(!/MINI CORE START/.test(page), 'the page should load mitznsimz_minis.js, not carry a copy');
  assert.strictEqual(sandbox.MITZ_MINIS_VERSION, '2.5.0', 'Hold the Line is checked against minis 2.5.0');
});
test('what each unit is made of comes from the minis library (2.3.0), and every material is one motion can draw', () => {
  const MM = sandbox.MitzMinis, fig = t => (HTL.PACK.heroes[t] && HTL.PACK.heroes[t].figure) || t;
  const want = { fighter: 'metal', paladin: 'metal', skeleton: 'bone', boneKnight: 'metal', gargoyle: 'stone', gelCube: 'ooze', redDragon: 'ember', wraith: 'spirit', barricade: 'wood', goblin: 'flesh', bard: 'flesh' };
  for (const t in want) assert.strictEqual(MM.material(fig(t)), want[t], t);
  const box = {}; vm.createContext(box); vm.runInContext(read('motion.js'), box, { filename: 'motion.js' });
  for (const t of Object.keys(HTL.PACK.heroes).concat(Object.keys(HTL.PACK.monsters))) assert.ok(box.MitzMotion.MATERIALS[MM.material(fig(t))], t + ' has a material motion knows');
});
// every unit has its own figure in the shared library since minis 2.1.0; the set stays for any future figure still to be drawn
const AWAITING_ART = new Set([]);
test('the shared motion module runs without a page, and every tween gives a finite pose', () => {
  const box = {}; vm.createContext(box);
  vm.runInContext(read('motion.js'), box, { filename: 'motion.js' });
  const M = box.MitzMotion, view = { fx: [], pops: [], coins: [], impacts: [] };
  const fx = M.create({ ctx: () => null, layout: () => ({ cell: 50, horiz: true, dpr: 1 }), state: () => view, toScreen: (l, q) => ({ x: q * 50, y: l * 50 }) });
  const kinds = ['drop', 'land', 'hop', 'leap', 'charge', 'emerge', 'rise', 'leak', 'lunge', 'recoil', 'cast', 'wobble', 'shake', 'dodge', 'flash', 'topple', 'fade', 'pickup',
    'strike', 'knock', 'drift', 'crumble', 'melt', 'swat'];
  for (const k of kinds) for (const now of [0.05, 0.2, 0.39]) {
    const sp = { lane: 2, sq: 4, rx: 0.3, anims: [{ k, t0: 0, dur: 0.4, from: 5, to: 4, fromLane: 2, toLane: 2, fromSq: 5, vx: 1, vy: 0, lean: 1, dir: 1, amt: 0.2, dist: 2.5 }] };
    const e = fx.evaluate(sp, now);
    for (const key of ['lane', 'sq', 'dx', 'dy', 'lift', 'rot', 'alpha', 'scale']) assert.ok(Number.isFinite(e[key]), k + ' ' + key + ' = ' + e[key]);
  }
  let ran = 0; view.impacts.push({ at: 2, fn: () => ran++ }, { at: 1, fn: () => ran++ }); fx.runImpacts(1.5);
  assert.strictEqual(ran, 1, 'only the impacts that are due, earliest first');
});
test('the shared motion module draws every effect, pop and coin without reaching outside itself', () => {
  const box = {}; vm.createContext(box);
  vm.runInContext(read('motion.js'), box, { filename: 'motion.js' });
  const noop = () => {}, grad = { addColorStop: noop };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => grad : k === 'measureText' ? () => ({ width: 20 }) : noop), set: (o, k, v) => { o[k] = v; return true; } });
  for (const mat of [true, false]) {
    const view = { fx: [], pops: [], coins: [], impacts: [] };
    const fx = box.MitzMotion.create({ ctx: () => ctx, layout: () => ({ cell: 50, horiz: true, dpr: 1 }), state: () => view,
      toScreen: (l, q) => ({ x: q * 50, y: l * 50 }), dice: () => true, purse: () => ({ x: 0, y: 0 }), onCoin: noop,
      mat: mat ? () => ({ x: 0, y: 0, w: 500, h: 300 }) : undefined });
    const ends = { from: { lane: 1, sq: 1, ht: 0.9 }, to: { lane: 2, sq: 6, ht: 0.9 } };
    for (const k of ['arrow', 'bolt', 'shadow', 'fireball', 'boom', 'smash', 'slash', 'radiant', 'whirl', 'sigil', 'beam', 'sparkle', 'notes', 'tumble', 'paw'])
      for (const miss of [0, 1]) view.fx.push(Object.assign({ k, t0: 0, dur: 1, lane: 2, sq: 4, rx: 0.3, ht: 0.9, ang: 0.4, hit: true, seed: 3, col: '255,200,90', sign: 1, miss,
        face: 20, side: miss ? 'monster' : 'hero', gold: !miss, ex: 0, ey: -1, reach: 3 }, ends));
    for (const mat of Object.keys(box.MitzMotion.MATERIALS)) view.fx.push({ k: 'bits', t0: 0, dur: box.MitzMotion.MATERIALS[mat].life, lane: 2, sq: 4, ht: 0.9, mat, ang: 0.4, seed: 11, scale: 1.5 });
    for (const kind of ['atk', 'save', 'heal', 'label'])
      view.pops.push({ kind, k: kind, t0: 0, lane: 2, sq: 4, roll: 14, total: 19, dmg: 7, hit: true, crit: kind === 'atk', ok: true, text: 'Stunned', n: 5, slot: 0, ht: 0.9 });
    view.coins.push({ t0: 0, x: 100, y: 100, n: 5 });
    for (const now of [0.1, 0.5, 0.9]) { fx.drawFx(now); fx.drawPops(now); fx.drawCoins(now); }
  }
});
test('motion 1.1: hit-stop holds what was moving, and the strike lands at its contact point', () => {
  const box = {}; vm.createContext(box);
  vm.runInContext(read('motion.js'), box, { filename: 'motion.js' });
  const M = box.MitzMotion, view = { fx: [], pops: [], coins: [], impacts: [] };
  assert.ok(/^1\.[1-9]/.test(M.VERSION), 'motion ' + M.VERSION);
  let level = 1;
  const fx = M.create({ ctx: () => null, layout: () => ({ cell: 50, horiz: true, dpr: 1 }), state: () => view, motion: () => level, toScreen: (l, q) => ({ x: q * 50, y: l * 50 }) });
  const mk = () => ({ lane: 0, sq: 0, rx: 0.3, anims: [{ k: 'strike', t0: 0, dur: 0.4, vx: 1, vy: 0, lean: 1 }] });
  const contact = 0.4 * M.STRIKE_CONTACT;
  const a = mk(), b = mk();
  assert.ok(fx.evaluate(a, 0.1).dx < 0, 'a strike leans back first');
  assert.ok(Math.abs(fx.evaluate(a, contact).dx - 0.26) < 1e-9, 'and is fully in at the contact point');
  fx.hold(b, contact, 0.1);
  const held = fx.evaluate(b, contact + 0.08).dx, free = fx.evaluate(mk(), contact + 0.08).dx;
  assert.ok(Math.abs(held - 0.26) < 1e-9 && free < held, 'held at the blow while the hold lasts');
  assert.ok(Math.abs(fx.evaluate(b, contact + 0.15).dx - fx.evaluate(mk(), contact + 0.05).dx) < 1e-9, 'then carries on from where it stopped');
  const late = { lane: 0, sq: 0, rx: 0.3, anims: [{ k: 'knock', t0: contact, dur: 0.3, vx: 1, vy: 0, amt: 0.2 }] };
  fx.hold(late, contact, 0.1);
  assert.ok(fx.evaluate(late, contact + 0.05).dx > 0, 'anims that start at the blow are not held');
  level = 0.35;
  assert.ok(Math.abs(fx.evaluate(mk(), contact).dx - 0.26 * 0.35) < 1e-9, 'the motion level is read every frame');
  for (const mat of ['metal', 'bone', 'stone', 'ooze', 'flesh', 'ember', 'spirit', 'wood']) assert.ok(M.MATERIALS[mat] && M.MATERIALS[mat].life > 0, mat);
});
test('the shared sound module is quiet and safe without Web Audio', () => {
  const box = {}; vm.createContext(box);
  vm.runInContext(read('sound.js'), box, { filename: 'sound.js' });
  const snd = box.MitzSound.create({ volume: 0.5 });
  assert.strictEqual(box.MitzSound.VERSION, '1.0.0');
  assert.strictEqual(snd.NAMES.length, 17);
  for (const n of snd.NAMES) assert.strictEqual(snd.play(n), false, n + ' should do nothing here');
  assert.strictEqual(snd.volume(2), 1); assert.strictEqual(snd.enabled(false), false);
  snd.unlock();
});
test('every hero has a mini and a description', () => {
  for (const t of Object.keys(HTL.HEROES)) {
    const fig = HTL.HEROES[t].figure || t; // allies borrow a monster's figure and stand on a hero base
    if (AWAITING_ART.has(t)) { assert.ok(HTL.describe(t).length > 20, t + ' has no description'); continue; }
    assert.ok(Minis.has(fig), t + ' has no mini');
    const base = HTL.DEFENDER_TYPES.indexOf(t) >= 0 ? 'neutral' : 'hero'; // defenders are objects, on the walnut base
    if (!HTL.HEROES[t].ally) assert.strictEqual(Minis.figure(fig).faction, base, t + ' should stand on a ' + base + ' base');
    assert.ok(HTL.describe(t).length > 20, t + ' has no description');
  }
});
const MONSTER_TYPES = Object.keys(HTL.MONSTERS);
test('every monster has a mini, a description and a place in a battle', () => {
  const inBattles = new Set();
  HTL.BATTLES.forEach(b => b.monsters.forEach(t => inBattles.add(t)));
  const figOf = t => HTL.MONSTERS[t].figure || t; // a boss of the house can stand on a figure the library already has
  for (const t of MONSTER_TYPES) {
    assert.ok(Minis.has(figOf(t)) || AWAITING_ART.has(t), t + ' has no mini');
    assert.ok(inBattles.has(t), t + ' never appears in a battle');
    assert.ok(HTL.describe(t).length > 5, t + ' has no description');
  }
});
test('every monster with a mini stands on a monster base, and borrowed figures exist', () => {
  for (const t of MONSTER_TYPES) if (!AWAITING_ART.has(t)) assert.strictEqual(Minis.figure(HTL.MONSTERS[t].figure || t).faction, 'monster', t);
  for (const t of MONSTER_TYPES) if (HTL.MONSTERS[t].figure) assert.ok(Minis.has(HTL.MONSTERS[t].figure), t + ' borrows ' + HTL.MONSTERS[t].figure);
  for (const t of Object.keys(HTL.HEROES)) if (HTL.HEROES[t].figure) assert.ok(Minis.has(HTL.HEROES[t].figure), t + ' borrows ' + HTL.HEROES[t].figure);
  assert.ok(Minis.has(HTL.HEROES.druid.wildShape.figure), 'the Druid’s wild shape borrows ' + HTL.HEROES.druid.wildShape.figure);
});
test('battle data parses, and every wave has spawns', () => {
  for (const b of HTL.BATTLES) {
    assert.strictEqual(b.waves.length, 5, b.id);
    for (const w of b.waves) assert.ok(HTL.parseSpawns(w.spawns).length >= 5, b.id + ': ' + w.name);
  }
  assert.throws(() => HTL.parseSpawns('goblin:0 owlbear:3'));
});

// ---------- replays: every battle plays out as recorded ----------
// tests/replays.json holds every battle played by two fixed players from fixed seeds, as the rules played it when it
// was recorded. A difference means the rules now play differently: fine if that was meant (record afresh with
// node tests/record_replays.js and say so in the release), a bug if not. Retired on 12 November: the frozen v1.0 to
// v1.2 rules this replaced, so the game could change how battles play (Pete's call).
const REPLAYS = require('./replays.json'), kit = require('./replay_kit.js');
test('every battle in the pack has its replays recorded, and nothing recorded is missing from the pack', () => {
  const want = Object.keys(REPLAYS.replays).map(k => k.split(' ')[0]);
  for (const b of HTL.BATTLES) for (const who of Object.keys(kit.PLAYERS)) for (const seed of kit.SEEDS)
    assert.ok(REPLAYS.replays[b.id + ' ' + who + ' ' + seed], b.id + ' ' + who + ' ' + seed + ' has no replay: run node tests/record_replays.js');
  for (const id of new Set(want)) assert.ok(HTL.BATTLES.some(b => b.id === id), 'a replay of a battle the pack no longer has: ' + id);
});
for (const b of HTL.BATTLES) {
  test('replay: ' + b.name + ' plays out as recorded (v' + REPLAYS.recorded + ')', () => {
    for (const [who, player] of Object.entries(kit.PLAYERS)) for (const seed of QUICK ? kit.SEEDS.slice(0, 1) : kit.SEEDS) {
      const key = b.id + ' ' + who + ' ' + seed, was = REPLAYS.replays[key], now = kit.replay(HTL, seed, b.id, player);
      if (!was) continue; // the test above says so
      const diff = ['phase', 'round', 'gold', 'lives', 'events'].filter(k => was[k] !== now[k]).map(k => k + ' ' + was[k] + ' → ' + now[k]);
      for (const t of new Set([...Object.keys(was.counts), ...Object.keys(now.counts)])) if ((was.counts[t] || 0) !== (now.counts[t] || 0)) diff.push(t + ' events ' + (was.counts[t] || 0) + ' → ' + (now.counts[t] || 0));
      if (!diff.length && was.fingerprint !== now.fingerprint) diff.push('the same events in number, but not the same events');
      assert.ok(!diff.length, key + ' plays differently: ' + diff.slice(0, 6).join(', ') + '. Meant? Record afresh: node tests/record_replays.js');
    }
  });
}

// ---------- whole games ----------
test('same seed, same choices, same game', () => {
  const a = play(42, 'crypt', HTL.autoplay), b = play(42, 'crypt', HTL.autoplay);
  assert.strictEqual(JSON.stringify(a.log), JSON.stringify(b.log));
});

const SEEDS = Array.from({ length: QUICK ? 8 : 30 }, (_, i) => 1000 + i * 7919);
test('doing nothing loses every battle', () => {
  for (const b of HTL.BATTLES) assert.strictEqual(play(SEEDS[0], b.id, null, 0.25).s.phase, 'lost', b.id);
});
const table = [];
for (const b of HTL.BATTLES) {
  test('balance: ' + b.name + ' — Simz wins most games, a slow builder loses some', () => {
    let wins = 0, leaks = 0, rounds = 0, slowWins = 0, stalls = 0;
    const seen = new Set();
    for (const seed of SEEDS) {
      const { s, log } = play(seed, b.id, HTL.autoplay, 0.1, { loadout: HTL.suggestLoadout(b.id).pick }); // Simz takes the party she suggests
      if (s.phase === 'won') wins++;
      if (s.phase === 'running') stalls++;
      leaks += s.stats.leaks; rounds += s.round;
      for (const e of log) if (e.type === 'spawn') seen.add(e.unitType);
      if (play(seed, b.id, slow, 0.1).s.phase === 'won') slowWins++;
    }
    const n = SEEDS.length;
    table.push(b.id.padEnd(7) + ' Simz ' + String(wins).padStart(2) + '/' + n + '  slow ' + String(slowWins).padStart(2) + '/' + n +
      '  leaks ' + (leaks / n).toFixed(2) + '  ' + (rounds / n * HTL.ROUND / 60).toFixed(1) + ' min');
    assert.strictEqual(stalls, 0, 'games that never ended');
    for (const t of b.monsters) assert.ok(seen.has(t), t + ' never reached the mat');
    assert.ok(wins >= n * (QUICK ? 0.7 : 0.8), 'Simz won ' + wins + '/' + n); // eight quick seeds are noisy
    assert.ok(slowWins <= n * 0.9, 'slow builder won ' + slowWins + '/' + n + ': too easy');
  });
}


// ---------- Phase 5: the campaign ----------
const C = sandbox.HTL_CAMPAIGN;
function memStore(init) { const m = Object.assign({}, init || {}); return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; }
const winSum = (battle, extra) => Object.assign({ battle, difficulty: 'medium', won: true, livesLost: 0, goldLeft: 0, met: [], slain: {}, placed: {}, feats: { bards: 3 } }, extra || {});
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, q) => (o[q] = x[q], o), {}) : x);
test('campaign: a new tavern has five regulars, one battle open and the cellar map', () => {
  const c = C.fresh();
  assert.strictEqual(C.roster(c).join(), 'bard,fighter,ranger,wizard,cleric');
  assert.deepStrictEqual(HTL.BATTLES.map(b => C.unlocked(c, b.id)).filter(Boolean).length, 1);
  assert.ok(C.unlocked(c, 'warren'));
  assert.strictEqual(C.rooms(c).filter(r => r.open).map(r => r.id).join(), 'cellar');
});
test('campaign: a flawless first win pays, opens the next battle and rooms, and a regular joins', () => {
  const c = C.fresh(), r = C.record(c, winSum('warren'), '2026-11-08');
  assert.strictEqual(r.stars, 3);
  assert.strictEqual(r.takings, 150 + 50 + 75, 'base 50 × 1.5 for three stars × 2 for a first win, plus two trophies');
  assert.strictEqual(r.trophies.map(t => t.id).join(), 'open,flawless');
  assert.strictEqual(r.joined.join(), 'rogue'); assert.ok(C.unlocked(c, 'caves')); assert.ok(!C.unlocked(c, 'crypt'));
  assert.strictEqual(r.rooms.join(), 'trophies,works,armoury'); assert.strictEqual(r.upgrades.join(), 'door,till');
  assert.strictEqual(c.takings, 275);
});
test('campaign: stars for lives kept, and replays pay less unless they do better', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 5].map(C.starsFor).join(), '3,2,2,1,1');
  const c = C.fresh();
  C.record(c, winSum('warren', { livesLost: 3 }));
  assert.strictEqual(C.stars(c, 'warren'), 1);
  assert.strictEqual(C.pay(c, 'warren', 'medium', 1), 20, 'a repeat with no better stars pays 40%');
  assert.strictEqual(C.pay(c, 'warren', 'medium', 3), 75, 'better stars pay in full');
  assert.strictEqual(C.pay(c, 'warren', 'deadly', 1), 115, 'a first win at a new difficulty pays a bonus');
  const lost = C.record(c, winSum('caves', { won: false }));
  assert.strictEqual(lost.takings, 15); assert.strictEqual(lost.stars, 0); assert.ok(!C.won(c, 'caves'));
});
test('campaign: upgrades open with wins, cost takings and reach the rules', () => {
  const c = C.fresh();
  assert.strictEqual(C.buy(c, 'door'), 'closed');
  C.record(c, winSum('warren'));
  assert.strictEqual(C.buy(c, 'kitchen'), 'closed', 'the kitchen opens after two wins');
  assert.strictEqual(C.buy(c, 'door'), null); assert.strictEqual(c.upgrades.door, 1);
  assert.strictEqual(C.buy(c, 'door'), 'takings');
  c.takings = 5000; assert.strictEqual(C.buy(c, 'door'), null); assert.strictEqual(C.buy(c, 'door'), 'max');
  const s = HTL.newGame(1, 'warren', C.battleOptions(c));
  assert.strictEqual(s.maxLives, HTL.newGame(1, 'warren').maxLives + 2);
});
test('campaign: the save survives a reload, and a broken or tampered save still loads', () => {
  const store = memStore(), c = C.fresh();
  C.record(c, winSum('warren', { met: ['goblin', 'direRat'], slain: { goblin: 4 }, placed: { fighter: 2 } }));
  C.buy(c, 'till');
  assert.ok(C.save(store, c));
  const back = C.load(store);
  assert.strictEqual(canon(back), canon(c));
  assert.strictEqual(back.seen.monsters.goblin.slain, 4); assert.ok(back.seen.monsters.direRat);
  store.setItem(C.KEY, '{not json'); assert.strictEqual(C.load(store).takings, 0);
  store.setItem(C.KEY, JSON.stringify({ takings: -50, upgrades: { door: 99 }, wins: { warren: { medium: 7 }, nowhere: { easy: 3 } }, trophies: { fake: 'x' } }));
  const t = C.load(store);
  assert.strictEqual(t.takings, 0); assert.strictEqual(t.upgrades.door, 2); assert.strictEqual(t.wins.warren.medium, 3);
  assert.ok(!t.wins.nowhere); assert.ok(!t.trophies.fake);
});
test('campaign: every saved example of an old save loads as it should (tests/saves)', () => {
  const files = fs.readdirSync(path.join(__dirname, 'saves')).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 2, 'the examples are missing');
  const shapes = new Set();
  for (const f of files) {
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, 'saves', f), 'utf8')), e = ex.expect;
    const store = Array.isArray(ex.save) ? memStore() : memStore({ [C.KEY]: JSON.stringify(ex.save) });
    const c = C.load(store, Array.isArray(ex.save) ? ex.save : []);
    shapes.add(Array.isArray(ex.save) ? 0 : ex.save.v);
    assert.strictEqual(canon(c.wins), canon(e.wins), f + ': wins');
    assert.strictEqual(c.takings, e.takings, f + ': takings');
    for (const k in e.upgrades || {}) assert.strictEqual(c.upgrades[k], e.upgrades[k], f + ': ' + k);
    for (const t of e.trophies || []) assert.ok(c.trophies[t], f + ': trophy ' + t);
    for (const m in e.slain || {}) assert.strictEqual(c.seen.monsters[m].slain, e.slain[m], f + ': slain ' + m);
    assert.strictEqual(canon(C.clean(JSON.parse(JSON.stringify(c)))), canon(c), f + ': saves and loads again unchanged');
    assert.strictEqual(c.v, C.VERSION, f + ': comes out as this version');
  }
  for (let v = 0; v <= C.VERSION; v++) assert.ok(shapes.has(v), 'there is no example of a version-' + v + ' save in tests/saves');
  for (let v = 0; v < C.VERSION; v++) assert.strictEqual(typeof C.STEPS[v], 'function', 'no step up from version ' + v);
});
test('campaign: loading keeps a copy of any save it can’t use as it is, and never overwrites that copy', () => {
  const broken = memStore({ [C.KEY]: '{not json' });
  assert.strictEqual(C.load(broken).takings, 0);
  assert.strictEqual(broken.m[C.KEY + '.unreadable'], '{not json', 'a damaged save is kept aside');
  const newer = JSON.stringify(Object.assign(C.fresh(), { v: C.VERSION + 1, takings: 70, futureThing: [1] }));
  const s2 = memStore({ [C.KEY]: newer });
  assert.strictEqual(C.load(s2).takings, 70, 'a newer save loads as well as it can');
  assert.strictEqual(s2.m[C.KEY + '.newer'], newer, 'and the newer save is kept whole');
  s2.setItem(C.KEY, JSON.stringify(Object.assign(C.fresh(), { v: C.VERSION + 1, takings: 1 }))); C.load(s2);
  assert.strictEqual(s2.m[C.KEY + '.newer'], newer, 'the first copy stays');
  const now = memStore({ [C.KEY]: JSON.stringify(C.fresh()) }); C.load(now);
  assert.deepStrictEqual(Object.keys(now.m), [C.KEY], 'a save of this version needs no copy');
});
test('campaign: Export and Import carry a campaign to another browser, and turn away anything else', () => {
  const c = C.fresh();
  C.record(c, winSum('warren', { met: ['goblin'], slain: { goblin: 3 } })); C.buy(c, 'till'); C.setLook(c, 'fighter', 'f');
  const text = C.exportText(c, '2026-11-12');
  const back = C.importText(text);
  assert.ok(!back.error, back.error);
  assert.strictEqual(canon(back.campaign), canon(c)); assert.strictEqual(back.saved, '2026-11-12');
  assert.ok(!C.importText(JSON.stringify(c)).error, 'the bare save from storage imports too');
  for (const bad of ['', 'hello', '[]', '{"game":"mitznsimz-dungeon-delve","campaign":{}}', '{"game":"mitznsimz-hold-the-line"}', '{"name":"something"}'])
    assert.ok(C.importText(bad).error, 'turned away: ' + bad);
  const later = JSON.parse(text); later.campaign.v = C.VERSION + 1;
  assert.ok(/newer/.test(C.importText(JSON.stringify(later)).error), 'a campaign from a newer game says so');
  const odd = JSON.parse(text); odd.campaign.takings = -9; odd.campaign.wins.nowhere = { easy: 3 };
  const t = C.importText(JSON.stringify(odd)).campaign;
  assert.strictEqual(t.takings, 0); assert.ok(!t.wins.nowhere, 'an edited file is cleaned like any save');
  assert.ok(/1 battle won, \d+ gold in the till, \d+ trophies/.test(C.summary(c)), C.summary(c));
});
test('campaign: wins from before the campaign carry over', () => {
  const c = C.load(memStore(), ['warren', 'caves']);
  assert.ok(C.won(c, 'caves')); assert.ok(C.unlocked(c, 'crypt'));
  assert.strictEqual(c.takings, 100);
  assert.ok(C.roster(c).indexOf('paladin') >= 0);
});
test('campaign: winning every battle in order opens each next one, and every hero joins before the cats ask for them', () => {
  const c = C.fresh();
  for (const b of HTL.BATTLES) {
    assert.ok(C.unlocked(c, b.id), b.id + ' should be open');
    for (const t in (b.cats || {})) assert.ok(C.roster(c).indexOf(t) >= 0, b.id + ': the cats pick ' + t + ' before it has joined');
    C.record(c, winSum(b.id));
  }
  assert.strictEqual(C.roster(c).length, HTL.HERO_TYPES.length);
  assert.ok(c.trophies.campaign && c.trophies.stars);
});
test('campaign: Simz wins each battle in campaign order with only the heroes it has by then', () => {
  const c = C.fresh(), seeds = SEEDS.slice(0, QUICK ? 4 : 10), short = [];
  for (const b of HTL.BATTLES) {
    const party = HTL.suggestLoadout(b.id, C.roster(c)).pick;
    let w = 0;
    for (const seed of seeds) if (play(seed, b.id, HTL.autoplay, 0.1, { loadout: party }).s.phase === 'won') w++;
    if (w < seeds.length * 0.75) short.push(b.id + ' ' + w + '/' + seeds.length + ' with ' + party.join(' '));
    C.record(c, winSum(b.id));
  }
  assert.ok(!short.length, 'too hard this early: ' + short.join('; '));
});


// ---------- Phase 5: magic items and the cats' powers ----------
test('items: a +1 weapon turns a near miss into a hit, and only for the kind that carries it', () => {
  const base = HTL.HEROES.fighter.attack.bonus;
  const swing = items => {
    const s = HTL.newGame(3, 'warren', { items }); s.nextWaveRound = 1e9;
    const f = HTL.addUnit(s, 'hero', 'fighter', 2, 2), o = tough(put(s, 'monster', 'ogre', 2, 3));
    s.forced = [o.ac - base - 1, 1, 1, 1, 1];
    return HTL._attack(s, f, o, HTL._heroAttack(f, HTL.HEROES.fighter.attack)).hit;
  };
  assert.strictEqual(swing({}), false);
  assert.strictEqual(swing({ fighter: 'longsword' }), true);
  assert.strictEqual(swing({ ranger: 'longsword' }), false, 'a ranger cannot carry a longsword, so the fighter has nothing');
});
test('items: armour, hit points, saving throws, undead and gold', () => {
  const s = HTL.newGame(3, 'warren', { items: { fighter: 'shield', ranger: 'amulet', monk: 'bracers', cleric: 'mace', bard: 'tankard', wizard: 'cloak' } });
  const plain = HTL.newGame(3, 'warren');
  const add = (g, t) => HTL.addUnit(g, 'hero', t, 0, 0);
  assert.strictEqual(add(s, 'fighter').ac, add(plain, 'fighter').ac + 1);
  assert.strictEqual(add(s, 'ranger').maxHp, add(plain, 'ranger').maxHp + Math.ceil(HTL.HEROES.ranger.hp * 0.25));
  assert.strictEqual(add(s, 'monk').ac, add(plain, 'monk').ac + 2);
  const w = add(s, 'wizard'); assert.strictEqual(w.ac, add(plain, 'wizard').ac + 1); assert.strictEqual(w.item, 'cloak');
  // the mace: 4 more damage to the undead
  const hitUndead = items => { const g = HTL.newGame(3, 'crypt', { items }); g.nextWaveRound = 1e9; const c = HTL.addUnit(g, 'hero', 'cleric', 2, 2), sk = tough(put(g, 'monster', 'skeleton', 2, 3));
    g.forced = [19, 2, 2, 2, 2]; HTL._attack(g, c, sk, HTL.HEROES.cleric.attack); return 999 - sk.hp; };
  assert.strictEqual(hitUndead({ cleric: 'mace' }) - hitUndead({}), 4);
  // the tankard: a quarter more gold per song
  const song = items => { const g = HTL.newGame(3, 'warren', { items }); g.nextWaveRound = 1e9; HTL.place(g, 'bard', 1, 0); const before = g.gold; stepRounds(g, 12); return g.gold - before; };
  assert.ok(song({ bard: 'tankard' }) > song({}), 'more gold with the tankard');
});
test('items: the Tinker’s ammunition goes to her ballista, not to her', () => {
  const s = HTL.newGame(3, 'warren', { items: { tinker: 'ammo' } });
  assert.strictEqual(HTL.itemOf(s, 'tinker'), null);
  assert.strictEqual(HTL.itemOf(s, 'ballista').id, 'ammo');
  assert.strictEqual(HTL.newGame(3, 'warren', { items: { ranger: 'ammo' } }).items.ranger, undefined);
});
test('powers: none without the cats; Mitz’s Pounce stuns a 3 × 3 square, on a cooldown that depends on who is on watch', () => {
  assert.strictEqual(HTL.usePower(bare(), 'pounce', 2, 4), 'none');
  const s = HTL.newGame(6, 'warren', { cats: { duty: 'mitz' } }); s.nextWaveRound = 1e9;
  assert.strictEqual(s.powers.pounce.every, 6); assert.strictEqual(s.powers.swat.every, 12);
  assert.strictEqual(HTL.usePower(s, 'pounce', 2, 4), 'cooldown');
  stepRounds(s, 6);
  const a = put(s, 'monster', 'orc', 2, 4), b = put(s, 'monster', 'orc', 3, 5), far = put(s, 'monster', 'orc', 0, 4);
  assert.strictEqual(HTL.usePower(s, 'pounce', 4, 1), 'target');
  assert.strictEqual(HTL.usePower(s, 'pounce', 2, 4), null);
  assert.ok(HTL.hasStatus(a, 'paralysed') && HTL.hasStatus(b, 'paralysed') && !HTL.hasStatus(far, 'paralysed'));
  assert.strictEqual(HTL.usePower(s, 'pounce', 2, 4), 'cooldown');
  assert.strictEqual(s.powers.pounce.ready, s.round + 6);
});
test('powers: Simz’s Swat takes a monster off the table, but not a boss, and nothing raises it', () => {
  const s = HTL.newGame(6, 'lair', { cats: { duty: 'simz' } }); s.nextWaveRound = 1e9; stepRounds(s, 6);
  const boss = put(s, 'monster', 'redDragon', 1, 6), orc = put(s, 'monster', 'orc', 2, 5);
  put(s, 'monster', 'necromancer', 2, 7);
  assert.strictEqual(HTL.usePower(s, 'swat', 1, 6), 'boss');
  const gold = s.gold;
  assert.strictEqual(HTL.usePower(s, 'swat', 2, 5), null);
  assert.ok(!orc.alive && orc.swatted); assert.strictEqual(s.gold, gold + HTL.MONSTERS.orc.bounty);
  HTL.step(s, TICK); stepRounds(s, 2);
  assert.ok(!s.units.some(u => u.alive && u.type === 'skeleton' && u.lane === 2 && u.sq === 5), 'the necromancer has nothing to raise');
  assert.ok(boss.alive);
});
test('powers: Simz uses the cats’ powers when she plays', () => {
  const { s } = play(1009, 'road', HTL.autoplay, 0.1, { loadout: HTL.suggestLoadout('road').pick, cats: { duty: 'mitz' } });
  assert.ok((s.stats.powers || 0) > 0, 'no powers used');
});
test('campaign: items come up with first wins and some trophies, and go to one kind of hero at a time', () => {
  const c = C.fresh();
  const r = C.record(c, winSum('warren'));
  assert.strictEqual(r.items.join(), 'longsword,ammo', 'the warren drop, and the flawless trophy');
  assert.strictEqual(C.record(c, winSum('warren')).items.length, 0, 'a replay brings nothing new');
  assert.strictEqual(C.equip(c, 'ranger', 'longsword'), 'wrong');
  assert.strictEqual(C.equip(c, 'fighter', 'longbow'), 'item');
  assert.strictEqual(C.equip(c, 'fighter', 'longsword'), null);
  assert.strictEqual(C.equip(c, 'paladin', 'longsword'), null);
  assert.ok(!c.equip.fighter && c.equip.paladin === 'longsword', 'moved, not copied');
  const opts = C.battleOptions(c);
  assert.strictEqual(opts.items.paladin, 'longsword'); assert.strictEqual(opts.cats, null, 'the cats’ corner opens after two wins');
  C.record(c, winSum('caves'));
  assert.ok(C.battleOptions(c).cats); assert.strictEqual(C.duty(c), c.totals.battles % 2 ? 'simz' : 'mitz');
  const before = C.duty(c); C.record(c, winSum('crypt', { won: false })); assert.notStrictEqual(C.duty(c), before, 'they take turns');
  const back = C.clean(JSON.parse(JSON.stringify(Object.assign({}, c, { items: c.items.concat(['excalibur']), equip: Object.assign({ ranger: 'longsword' }, c.equip) }))));
  assert.ok(back.items.indexOf('excalibur') < 0); assert.ok(!back.equip.ranger); assert.strictEqual(back.equip.paladin, 'longsword');
});

// ---------- every difficulty: easier is easier, harder is harder, and Deadly can still be won ----------
const DSEEDS = SEEDS.slice(0, QUICK ? 4 : 10), tally = {};
function sweep(dk) {
  if (tally[dk]) return tally[dk];
  const out = { simz: 0, slow: 0, n: 0, per: {} };
  for (const b of HTL.BATTLES) {
    let w = 0;
    for (const seed of DSEEDS) {
      if (play(seed, b.id, HTL.autoplay, 0.1, { difficulty: dk, loadout: HTL.suggestLoadout(b.id).pick }).s.phase === 'won') w++;
      if (play(seed, b.id, slow, 0.1, { difficulty: dk }).s.phase === 'won') out.slow++;
      out.n++;
    }
    out.simz += w; out.per[b.id] = w;
  }
  return (tally[dk] = out);
}
test('Easy: Simz wins every battle almost always, and the slow builder wins plenty', () => {
  const e = sweep('easy');
  for (const id in e.per) assert.ok(e.per[id] >= DSEEDS.length * 0.95 - 1e-9, id + ': Simz won ' + e.per[id] + '/' + DSEEDS.length);
  assert.ok(e.slow >= e.n * 0.4, 'slow builder won only ' + e.slow + '/' + e.n);
});
test('Hard: Simz still wins most games in every battle, and it is harder than Medium for the slow builder', () => {
  const h = sweep('hard'), m = sweep('medium');
  for (const id in h.per) assert.ok(h.per[id] >= DSEEDS.length * 0.7 - 1e-9, id + ': Simz won ' + h.per[id] + '/' + DSEEDS.length);
  assert.ok(h.slow <= m.slow, 'slow builder: Hard ' + h.slow + ', Medium ' + m.slow);
});
test('Deadly: winnable, but harder than Hard', () => {
  const d = sweep('deadly'), h = sweep('hard');
  assert.ok(d.simz >= d.n * 0.5, 'Simz won ' + d.simz + '/' + d.n);
  assert.ok(d.simz <= h.simz, 'Deadly ' + d.simz + ' vs Hard ' + h.simz);
});

test('One-man band: win placing just one Bard (a win with none is out of reach, so the trophy asks for one)', () => {
  const t = sandbox.HTL_CAMPAIGN.TROPHIES.find(x => x.id === 'nobard');
  assert.strictEqual(t.name, 'One-man band');
  assert.ok(t.test({ won: true, feats: { bards: 1 } }));
  assert.ok(!t.test({ won: true, feats: { bards: 2 } }) && !t.test({ won: true, feats: { bards: 0 } }) && !t.test({ won: false, feats: { bards: 1 } }));
});
test('Simz suggests a party for the monsters: always a Bard, then the wall, shooter and caster that suit them best', () => {
  const pick = id => HTL.suggestLoadout(id).pick;
  for (const b of HTL.BATTLES) {
    const p = pick(b.id); assert.strictEqual(p.length, 6, b.id); assert.ok(p.indexOf('bard') >= 0, b.id + ' has no Bard');
    assert.ok(['fighter', 'paladin', 'monk'].some(t => p.indexOf(t) >= 0), b.id + ' has no wall');
    assert.ok(['wizard', 'druid', 'sorcerer'].some(t => p.indexOf(t) >= 0), b.id + ' has no caster');
  }
  assert.ok(pick('crypt').indexOf('paladin') >= 0 && pick('crypt').indexOf('cleric') >= 0, 'undead: a Paladin and a Cleric');
  assert.ok(pick('march').indexOf('monk') >= 0, 'rust monsters: a Monk');
  assert.ok(pick('lawn').indexOf('tinker') >= 0, 'burrowers: a Tinker and his traps');
  const seen = new Set(); HTL.BATTLES.forEach(b => pick(b.id).forEach(t => seen.add(t)));
  assert.strictEqual(seen.size, HTL.HERO_TYPES.length, 'every hero is suggested somewhere');
  assert.strictEqual(HTL.suggestLoadout('warren', ['bard', 'fighter', 'ranger']).pick.join(' '), 'bard fighter ranger', 'only the heroes you have');
});
test('Simz shares each job round the party: the planned hero takes most squares, the others every third, and barricades hold the line without a Fighter', () => {
  const kinds = party => { const s = HTL.newGame(1000, 'warren', { difficulty: 'hard', loadout: party }); HTL.autoplay(s); const c = {}; s.simzPlan.types.forEach(t => c[t] = (c[t] || 0) + 1); return c; };
  const a = kinds(['bard', 'fighter', 'ranger', 'wizard', 'warlock', 'paladin']);
  assert.ok(a.warlock > 0 && a.ranger > a.warlock && a.paladin > 0 && a.fighter > 0, 'a second shooter and a second wall get squares: ' + JSON.stringify(a));
  const b = kinds(['bard', 'paladin', 'ranger', 'wizard', 'cleric', 'rogue']);
  assert.ok(b.barricade > b.paladin && !b.fighter, 'no Fighter: mostly barricades: ' + JSON.stringify(b));
  const c = kinds(['bard', 'fighter', 'ranger', 'wizard', 'cleric', 'rogue']);
  assert.strictEqual(JSON.stringify(c), JSON.stringify({ bard: 5, ranger: 8, fighter: 8, wizard: 5, cleric: 2, rogue: 2 }), 'the core six play the plan as written');
});
test('varied parties: with a Bard, very different sixes still win on Hard, and between them every hero gets a game', () => {
  const parties = [['bard', 'paladin', 'warlock', 'sorcerer', 'cleric', 'rogue'], ['bard', 'monk', 'tinker', 'druid', 'barbarian', 'warlock'],
    ['bard', 'ranger', 'paladin', 'sorcerer', 'barbarian', 'druid'], ['bard', 'sorcerer', 'druid', 'warlock', 'rogue', 'ranger'],
    ['bard', 'fighter', 'tinker', 'ranger', 'wizard', 'barbarian'], ['bard', 'druid', 'paladin', 'wizard', 'fighter', 'monk']];
  const all = new Set(); parties.forEach(p => p.forEach(t => all.add(t)));
  assert.strictEqual(all.size, HTL.HERO_TYPES.length, 'every hero is in one of the parties');
  let won = 0, n = 0; const low = [];
  for (const p of parties) { let w = 0, k = 0;
    for (const id of ['warren', 'crypt', 'bridge', 'kitchen', 'stables']) for (const seed of [1000, 8919]) {
      const s = HTL.newGame(seed, id, { difficulty: 'hard', loadout: p }); let last = -1, g = 0;
      while (s.phase === 'running' && g++ < 200000) { if (s.round !== last) { last = s.round; HTL.autoplay(s); } HTL.step(s, 0.1); s.events.length = 0; }
      k++; if (s.phase === 'won') w++; }
    won += w; n += k; if (w < k * 0.6) low.push(p.join(' ') + ' ' + w + '/' + k); }
  assert.ok(won >= n * 0.85, 'varied parties won ' + won + '/' + n);
  assert.ok(!low.length, 'a party fell short: ' + low.join('; '));
  table.push('varied   Simz ' + won + '/' + n + ' on Hard, six different parties');
});
// How the page looks and behaves in a browser (the support line, menus, the board's pixels, Safari's slow paths) is
// tested in tests/browser.test.js, against the running game rather than its source.

console.log('\n' + table.map(r => '       ' + r).join('\n'));
for (const dk of ['easy', 'medium', 'hard', 'deadly']) if (tally[dk])
  console.log('       ' + dk.padEnd(7) + ' Simz ' + tally[dk].simz + '/' + tally[dk].n + '  slow ' + tally[dk].slow + '/' + tally[dk].n);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
