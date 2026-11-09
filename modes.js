/* Hold the Line: the modes. Endless, the Daily Challenge, the Boss Rush and the puzzles.
   Each is a battle the rules make from an id (endless:417, daily:2026-11-08, rush:1, puzzle:2), so the same id makes the
   same battle on any machine. Waves come from their own seeded dice, never the battle's, and nothing here reads a clock:
   the game hands in today's date. Loaded after the rules (it reads HTL and adds its makers to it). */
var HTL_MODES = (function (HTL) {
  'use strict';
  const M = HTL.MONSTERS, H = HTL.HEROES;

  /* ---------- seeded dice for making waves ---------- */
  // FNV-1a: any string to 32 bits
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // mulberry32: small, fast, and the same in every browser
  function dice(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  function shuffle(r, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---------- what the waves are made of ---------- */
  const threatOf = t => Math.max(0.5, M[t].level);
  const isBoss = t => !!M[t].traits.boss;
  // every monster the campaign sends through a door (summoned ones such as risen skeletons come up in waves too)
  const SENT = []; HTL.BATTLES.forEach(b => b.monsters.forEach(t => { if (SENT.indexOf(t) < 0) SENT.push(t); }));
  const FOES = SENT.filter(t => !isBoss(t)).sort((a, b) => M[a].level - M[b].level || (a < b ? -1 : 1));
  const BOSSES = SENT.filter(isBoss).sort((a, b) => M[a].level - M[b].level || (a < b ? -1 : 1));
  // each campaign battle is a theme: its map, its rank and file, and its boss
  const THEMES = HTL.BATTLES.map(b => ({ id: b.id, map: b.map, pool: b.monsters.filter(t => !isBoss(t)), boss: b.monsters.filter(isBoss).pop() || null,
    threats: b.waves.map(w => w.parsed.reduce((a, p) => a + p.count * threatOf(p.type), 0)),
    waves: b.waves.map(w => w.parsed.map(p => p.type).filter((t, i, a) => !isBoss(t) && a.indexOf(t) === i)), gold: b.gold }));
  const MAP_IDS = Object.keys(HTL.MAPS);

  /* One wave: monsters drawn from pool until their levels add up to threat, spread over the rounds; a boss comes
     two thirds of the way through and counts double. */
  function makeWave(r, pool, threat, o) {
    o = o || {};
    const list = [];
    let sum = o.boss ? threatOf(o.boss) * 2 : 0;
    const cap = o.cap || 24;
    while (sum < threat && list.length < cap) { const t = pick(r, pool); list.push(t); sum += threatOf(t); }
    list.sort((a, b) => M[a].level - M[b].level); // the small ones first, roughly
    for (let i = 0; i < list.length - 1; i++) if (r() < 0.35) { const t = list[i]; list[i] = list[i + 1]; list[i + 1] = t; }
    const span = Math.min(14, 9 + Math.floor(list.length / 5)), at = {};
    list.forEach((t, i) => {
      const round = list.length < 2 ? 0 : Math.round(i * span / (list.length - 1));
      const key = round + ' ' + t; at[key] = (at[key] || 0) + 1;
    });
    if (o.boss) { const key = Math.round(span * 0.6) + ' ' + o.boss; at[key] = (at[key] || 0) + 1; }
    const tokens = Object.keys(at).map(k => { const [round, t] = k.split(' '); return { round: +round, t, n: at[k] }; })
      .sort((a, b) => a.round - b.round || (a.t < b.t ? -1 : 1))
      .map(x => x.t + ':' + x.round + (x.n > 1 ? '*' + x.n : ''));
    const top = (o.boss ? [o.boss] : []).concat(list.slice().sort((a, b) => M[b].level - M[a].level))[0];
    return { name: o.name, by: o.by || 'Mitz', line: o.line || (M[top].name + ' at the head of them. ' + HTL.describe(top)), spawns: tokens.join(' '), hp: o.hp };
  }

  /* ---------- Endless: waves keep coming, each a little worse, until the door gives ---------- */
  const ENDLESS_GOLD = 200;
  function endlessWave(seed, i) {
    const r = dice(hash('endless:' + seed + ':' + i));
    const top = Math.min(10, 1 + Math.floor(i * 0.6)), low = Math.max(1, top - 4);
    let pool = FOES.filter(t => M[t].level >= low && M[t].level <= top);
    if (pool.length < 3) pool = FOES.filter(t => M[t].level <= top).slice(-6);
    const bossy = BOSSES.filter(t => M[t].level <= top + 1), boss = i % 5 === 4 && bossy.length ? pick(r, bossy.slice(-2)) : null;
    return makeWave(r, pool, 10 * Math.pow(1.15, i), { boss, cap: 30, by: i % 2 ? 'Simz' : 'Mitz', name: 'Wave ' + (i + 1),
      hp: i >= 10 ? Math.round(Math.pow(1.08, i - 9) * 100) / 100 : 1 }); // from wave 11 every monster is tougher by 8% a wave
  }
  function endless(arg) {
    const seed = parseInt(arg, 10);
    if (!(seed > 0)) return null;
    const r = dice(hash('endless:' + seed));
    return { name: 'Endless', mode: 'endless', endless: true, seed, map: pick(r, MAP_IDS), gold: ENDLESS_GOLD, by: 'Simz', pool: SENT.slice(),
      line: 'They keep coming. See how long the Cat & Mouse holds.', more: i => endlessWave(seed, i) };
  }
  // how many waves a finished endless game held off
  function held(s) { return s.phase === 'won' ? s.wave + 1 : s.waveActive ? Math.max(0, s.wave) : s.wave + 1; }

  /* ---------- the Daily Challenge: the same battle, party and dice for everyone that day ---------- */
  // the day's party: the three staples (a wall, a bow and a song for the till), a healer, and two more chosen by the day
  const STAPLES = ['fighter', 'ranger', 'bard'], SUPPORT = ['cleric', 'druid', 'paladin'];
  const DAILY_NAMES = ['First knock', 'More at the door', 'The cellar fills', 'Hold fast', 'The last of them'];
  function daily(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const seed = hash('daily:' + date), r = dice(seed);
    const theme = pick(r, THEMES), other = pick(r, THEMES);
    const top = Math.max.apply(null, theme.pool.map(t => M[t].level));
    // each wave draws on what that wave of the theme sends, with a few strangers from another battle of no higher level
    const strangers = shuffle(r, other.pool.filter(t => theme.pool.indexOf(t) < 0));
    const poolFor = i => { const own = theme.waves[i], hi = Math.max.apply(null, own.map(t => M[t].level));
      return own.concat(strangers.filter(t => M[t].level <= hi).slice(0, 2)); };
    const boss = theme.boss || pick(r, BOSSES.filter(t => M[t].level <= top + 2).concat(BOSSES[0]));
    const map = theme.map; // the theme's own ground: its monsters were made for it
    r(); // (kept so the rest of the day's choices fall as they did)
    const k = 0.85 + r() * 0.2; // about as hard as the battle it borrows from
    const waves = theme.threats.map((t, i) => makeWave(r, poolFor(i), t * k, { boss: i === theme.threats.length - 1 ? boss : null, name: DAILY_NAMES[i] || 'Wave ' + (i + 1), by: i % 2 ? 'Simz' : 'Mitz' }));
    const rest = HTL.HERO_TYPES.slice();
    const party = STAPLES.concat(pick(r, SUPPORT));
    for (const t of shuffle(r, rest)) if (party.length < HTL.PARTY && party.indexOf(t) < 0) party.push(t);
    return { name: 'Daily Challenge', mode: 'daily', date, fixed: true, seed, difficulty: 'medium', party: HTL.HERO_TYPES.filter(t => party.indexOf(t) >= 0),
      map, gold: theme.gold, by: 'Mitz', line: 'Everyone at every Cat & Mouse gets this battle today, with this party and these dice.', waves };
  }
  // the day's score: monsters slain, lives kept, and a win counts for a lot
  function dailyScore(s) { return s.stats.kills * 10 + s.lives * 100 + (s.phase === 'won' ? 500 : 0); }

  /* ---------- the Boss Rush: every boss in turn, each with its own escort ---------- */
  function rush(arg) {
    if (arg !== '1') return null;
    const r = dice(hash('rush:1'));
    const waves = BOSSES.map((boss, i) => {
      const home = THEMES.find(th => th.boss === boss) || THEMES.find(th => HTL.battleById(th.id).monsters.indexOf(boss) >= 0) || THEMES[0];
      return makeWave(r, home.pool, 12 + 10 * i + threatOf(boss) * 2, { boss, name: M[boss].name, by: i % 2 ? 'Simz' : 'Mitz', line: 'Next up from ' + HTL.battleById(home.id).name + ': ' + HTL.describe(boss) });
    });
    return { name: 'Boss Rush', mode: 'rush', map: 'classic', gold: 300, by: 'Simz', line: 'Every boss under the tavern, one after another, each with its friends.', waves };
  }

  /* ---------- puzzles: a set of heroes, a battle, and one life ----------
     Each puzzle has a solution the tests play through, so every one is proven winnable. */
  const PUZZLES = [
    {name: 'Holy Ground', map: 'flooded', seed: 202, by: 'Mitz', heroes: {fighter: 1, cleric: 1, ranger: 1}, line: 'Undead that start a turn on holy ground burn. Make them stand on it.', waves: [{name: 'The restless', by: 'Mitz', line: 'Skeletons, all down the middle.', spawns: 'skeleton:0@2 skeleton:2@2 skeleton:4@2 skeleton:6@2 skeleton:8@2'}, {name: 'Hungry dead', by: 'Simz', line: 'Ghouls: their claws can paralyse.', spawns: 'ghoul:0@2 skeleton:2@2 ghoul:4@2 skeleton:6@2 ghoul:8@2'}], solution: [['fighter', 2, 4], ['cleric', 2, 1], ['ranger', 2, 2]]},
    {name: 'Little and Often', map: 'pillars', seed: 505, by: 'Simz', heroes: {ranger: 2, barricade: 2, caltrops: 1}, line: 'A lot of rats, two Rangers, and a few things from the cellar to slow them down.', waves: [{name: 'Scurry', by: 'Simz', line: 'Rats are quick. Most come down the middle, but not all.', spawns: 'direRat:0@2 direRat:1@2 direRat:2@2 direRat:4@1 direRat:5@3 direRat:6@2 direRat:7@2'}, {name: 'Scurry again', by: 'Mitz', line: 'More of them, all through the middle.', spawns: 'direRat:0@2 direRat:1@2 direRat:2@2 direRat:3@2 direRat:4@2 direRat:5@2 direRat:6@2 direRat:7@2'}], solution: [['ranger', 2, 1], ['ranger', 2, 0], ['barricade', 1, 8], ['barricade', 3, 8], ['caltrops', 2, 6]]},
    {name: 'Over the Top', map: 'classic', seed: 101, by: 'Simz', heroes: {fighter: 2, ranger: 2}, line: 'Bats fly straight over the first hero in a row. Two rows, four heroes.', waves: [{name: 'Wings', by: 'Simz', line: 'Goblins walk. Bats fly over whoever stands in front.', spawns: 'goblin:0@1 goblin:2@3 caveBat:4@1 caveBat:5@3 goblin:7@1 goblin:8@3'}, {name: 'More wings', by: 'Mitz', line: 'Archers stand back and shoot.', spawns: 'caveBat:0@1 caveBat:1@3 goblin:3@1 goblin:3@3 caveBat:5@1 caveBat:6@3 goblinArcher:8@1 goblinArcher:9@3'}], solution: [['fighter', 1, 5], ['ranger', 1, 1], ['fighter', 3, 5], ['ranger', 3, 1]]},
    {name: 'Mind the Gap', map: 'bridge', seed: 303, by: 'Simz', heroes: {fighter: 1, ranger: 2}, line: 'Walkers go round the chasm and cross the bridge. Bats do not bother.', waves: [{name: 'Across', by: 'Simz', line: 'Everything that walks ends up on the bridge.', spawns: 'goblin:0@0 goblin:1@4 goblin:3@1 goblin:4@3 goblin:6@0 goblin:7@4'}, {name: 'Over', by: 'Mitz', line: 'And now something that flies.', spawns: 'goblin:0@0 caveBat:2@1 goblin:3@4 caveBat:5@3 goblin:6@2 caveBat:7@1 goblin:8@2'}], solution: [['fighter', 2, 2], ['ranger', 1, 2], ['ranger', 3, 2]]},
    {name: 'Lights, Please', map: 'classic', seed: 404, by: 'Mitz', heroes: {ranger: 2, font: 2}, line: 'Imps cannot be seen unless they are near a light. A Ranger can only shoot what it can see.', waves: [{name: 'Something in the dark', by: 'Mitz', line: 'You will hear them before you see them.', spawns: 'imp:0@1 imp:3@3 imp:6@1 imp:8@3'}, {name: 'More of them', by: 'Simz', line: 'They sting, and the sting is poisoned.', spawns: 'imp:0@1 imp:1@3 imp:4@1 imp:5@3 imp:8@1 imp:9@3'}], solution: [['ranger', 1, 1], ['ranger', 3, 1], ['font', 1, 8], ['font', 3, 8]]}
  ];
  function puzzle(arg) {
    const p = PUZZLES[parseInt(arg, 10) - 1];
    if (!p || String(parseInt(arg, 10)) !== arg) return null;
    return { name: p.name, mode: 'puzzle', index: parseInt(arg, 10), seed: p.seed, map: p.map, gold: 0, by: p.by, line: p.line,
      puzzle: { heroes: Object.assign({}, p.heroes), gold: p.gold || 0, lives: 1 }, waves: p.waves.map(w => Object.assign({}, w)) };
  }

  /* ---------- Reverse: you send the monsters from a battle you have won, and Simz keeps the tavern ---------- */
  const REVERSE = { purse: 60, income: 20, rounds: 40 };
  function reverse(arg) {
    const theme = THEMES.find(th => th.id === arg);
    if (!theme) return null;
    // Simz keeps the tavern with his standard six: you choose the monsters, so a party picked for the battle's own would be the wrong one
    const src = HTL.battleById(arg), party = ['bard', 'fighter', 'ranger', 'wizard', 'cleric', 'rogue'];
    return { name: src.name + ' in reverse', mode: 'reverse', theme: arg, fixed: true, seed: hash('reverse:' + arg), difficulty: 'medium', party,
      map: theme.map, gold: theme.gold, by: 'Simz', line: 'My turn behind the bar. Send what you like up those steps. You won’t get past me.',
      pool: theme.pool.concat(theme.boss ? [theme.boss] : []), waves: [],
      reverse: { pool: theme.pool.slice(), boss: theme.boss, purse: REVERSE.purse, income: REVERSE.income, rounds: REVERSE.rounds } };
  }

  HTL.addMaker('endless', endless);
  HTL.addMaker('reverse', reverse);
  HTL.addMaker('daily', daily);
  HTL.addMaker('rush', rush);
  HTL.addMaker('puzzle', puzzle);

  const MODES = [
    { id: 'endless', name: 'Endless', line: 'Waves that keep coming and keep getting worse. How many can you hold?' },
    { id: 'daily', name: 'Daily Challenge', line: 'One battle a day, the same for everyone: the same waves, the same party, the same dice.' },
    { id: 'rush', name: 'Boss Rush', line: 'Every boss under the tavern, one after another.' },
    { id: 'puzzle', name: 'Puzzles', line: 'A handful of heroes, one life, and a battle with a way through it.' },
    { id: 'reverse', name: 'Reverse', line: 'You send the monsters up the steps, and Simz keeps the tavern.' }
  ];
  return { MODES, PUZZLES, BOSSES, hash, dice, makeWave, endlessWave, held, dailyScore,
    reverseId: id => 'reverse:' + id, REVERSE,
    endlessId: seed => 'endless:' + ((seed >>> 0) || 1), dailyId: date => 'daily:' + date, rushId: () => 'rush:1', puzzleId: n => 'puzzle:' + n };
})(HTL);
if (typeof module !== 'undefined' && module.exports) module.exports = HTL_MODES;
