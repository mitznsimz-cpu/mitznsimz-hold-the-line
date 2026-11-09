/* Hold the Line campaign v1: the Cat & Mouse's progress between battles.
   Battles open in order and earn 1 to 3 stars for lives kept; wins pay takings that buy the tavern's upgrades; heroes join
   along the way; trophies reward feats; the trophy wall fills in as monsters are met.
   Pure: no page and no clock. The game hands in its storage and today's date, so Node can test every rule here.
   Loaded after the rules (it reads HTL). */
var HTL_CAMPAIGN = (function (HTL) {
  'use strict';
  const VERSION = 1, KEY = 'mitzsimz.holdTheLine.campaign';
  const DIFFS = ['easy', 'medium', 'hard', 'deadly'];
  const B = HTL.BATTLES, IDS = B.map(b => b.id), IDX = {};
  IDS.forEach((id, i) => { IDX[id] = i; });
  // two campaigns: the cellar under the tavern, then the rest of the house, which opens once the Red Wyrm's Lair is won
  const CELLAR = B.filter(b => (b.stage || 1) === 1).map(b => b.id), HOUSE = B.filter(b => b.stage === 2).map(b => b.id);
  const HOUSE_OPENS = 'lair';

  /* ---------- who's at the tavern ---------- */
  const START = ['fighter', 'ranger', 'wizard', 'cleric', 'bard'];
  // a regular who turns up after a battle is first won; the cats' picks always join before their battle
  const JOINS = { warren: ['rogue'], caves: ['paladin'], crypt: ['barbarian'], vaults: ['druid'], road: ['warlock', 'monk'], march: ['tinker'], flooded: ['sorcerer'] };

  /* ---------- the rooms, opening as you win ---------- */
  const ROOMS = [
    { id: 'cellar', name: 'The cellar map', wins: 0, line: 'Every battle under the tavern, in the order the monsters come up.' },
    { id: 'trophies', name: 'The trophy wall', wins: 1, line: 'Trophies for feats, and every monster you have met.' },
    { id: 'works', name: 'Repairs and extensions', wins: 1, line: 'Spend the takings on the tavern: a stouter door, a deeper till, a kitchen, a training room.' },
    { id: 'armoury', name: 'The armoury', wins: 1, line: 'Magic items won below, each given to one kind of hero, and the belt of things to throw.' },
    { id: 'cats', name: 'The cats’ corner', wins: 2, line: 'Mitz pounces, Simz swats. One of them is on watch each battle.' },
    { id: 'games', name: 'The back room', wins: 3, line: 'Endless, the Daily Challenge, the Boss Rush and the puzzles.' },
    { id: 'house', name: 'The house plan', wins: 0, needs: HOUSE_OPENS, shut: 'Boarded up. Opens when the Red Wyrm’s Lair is won.',
      line: 'The monsters have found the other ways in. The rest of the Cat & Mouse, part by part.' }
  ].filter(r => r.id !== 'house' || HOUSE.length);
  const PUZZLE_COUNT = typeof HTL_MODES !== 'undefined' ? HTL_MODES.PUZZLES.length : 0;

  /* ---------- magic items: the first win of each battle brings one up from below ---------- */
  const DROPS = { warren: 'longsword', caves: 'longbow', crypt: 'mace', vaults: 'tankard', road: 'wand', march: 'shield', flooded: 'bracers',
    barrow: 'belt', bridge: 'staff', halls: 'dagger', lair: 'cloak' };
  // who is on watch for the next battle: they take turns, battle by battle
  const duty = c => (c.totals.battles % 2 ? 'simz' : 'mitz');

  /* ---------- the tavern's upgrades: names, prices and what they do in battle ---------- */
  const UPGRADES = {
    door: { name: 'A stouter door', room: 'The front door', wins: 1, levels: [
      { cost: 150, text: 'One more life in every battle.' }, { cost: 400, text: 'Two more lives in every battle.' }] },
    till: { name: 'A deeper till', room: 'The bar', wins: 1, levels: [
      { cost: 100, text: 'Start every battle with 25 more gold.' }, { cost: 250, text: 'Start with 50 more gold.' }, { cost: 500, text: 'Start with 75 more gold.' }] },
    kitchen: { name: 'The kitchen', room: 'The kitchen', wins: 2, levels: [
      { cost: 200, text: 'Short rests heal three quarters of lost hit points.' }, { cost: 450, text: 'Short rests heal every hero fully.' }] },
    training: { name: 'The training room', room: 'The training room', wins: 4, levels: [
      { cost: 350, text: 'The first hero of each kind joins at level 2.' }, { cost: 900, text: 'Every hero joins at level 2.' }] }
  };

  /* ---------- takings ---------- */
  const DIFF_PAY = { easy: 0.75, medium: 1, hard: 1.4, deadly: 1.8 };
  const STAR_PAY = [0, 1, 1.2, 1.5];
  const round5 = v => Math.max(0, Math.round(v / 5) * 5);
  const DAILY_KEEP = 60; // days of Daily Challenge scores kept
  const BELT_MAX = 9; // how many of each throwable the armoury will keep
  const basePay = id => 50 + 10 * (IDX[id] || 0);
  // 3 stars: no lives lost; 2 stars: one or two lost; 1 star: a win all the same
  function starsFor(livesLost) { return livesLost <= 0 ? 3 : livesLost <= 2 ? 2 : 1; }

  /* ---------- trophies: feats, each with a little something for the tavern ---------- */
  const allBattles = (c, fn) => CELLAR.every(id => fn(c.wins[id] || {})); // the cellar trophies stay about the cellar
  const TROPHIES = [
    { id: 'open', name: 'Open for business', text: 'Win your first battle.', reward: 50, test: s => s.won },
    { id: 'flawless', name: 'Not a scratch on the door', text: 'Win a battle without losing a life.', reward: 75, item: 'ammo', test: s => s.won && s.livesLost === 0 },
    { id: 'boss', name: 'The bigger they are', text: 'Fell a boss.', reward: 50, test: s => s.feats.bosses > 0 },
    { id: 'path', name: 'Fully trained', text: 'Take a hero to level 3 and choose its path.', reward: 40, item: 'amulet', test: s => s.feats.paths > 0 },
    { id: 'charge3', name: 'Three in one charge', text: 'One Barbarian charge drops three monsters.', reward: 100, test: s => s.feats.charge3 },
    { id: 'fireball5', name: 'Crowd control', text: 'Catch five monsters in one Fireball.', reward: 80, test: s => s.feats.fireball5 },
    { id: 'crits', name: 'Twenty is a lucky number', text: 'Your heroes roll ten crits in one battle.', reward: 60, test: s => s.feats.crits >= 10 },
    // a party can't win without a Bard (nothing else earns gold), so the trophy asks for just the one; the id stays for old saves
    { id: 'nobard', name: 'One-man band', text: 'Win placing just one Bard.', reward: 100, test: s => s.won && s.feats.bards === 1 },
    { id: 'thrifty', name: 'Money in the till', text: 'Win with 300 gold unspent.', reward: 40, test: s => s.won && s.goldLeft >= 300 },
    { id: 'hard', name: 'Hard going', text: 'Win a battle on Hard.', reward: 60, test: s => s.won && (s.difficulty === 'hard' || s.difficulty === 'deadly') },
    { id: 'deadly', name: 'Deadly serious', text: 'Win a battle on Deadly.', reward: 100, test: s => s.won && s.difficulty === 'deadly' },
    { id: 'swept', name: 'Well swept', text: 'Slay 500 monsters in all.', reward: 100, test: (s, c) => c.totals.kills >= 500 },
    { id: 'bestiary', name: 'A full trophy wall', text: 'Meet every kind of monster.', reward: 150, test: (s, c) => Object.keys(HTL.MONSTERS).every(t => c.seen.monsters[t]) },
    { id: 'campaign', name: 'The cellar is quiet', text: 'Win every battle in the cellar.', reward: 300, test: (s, c) => allBattles(c, w => DIFFS.some(d => w[d])) },
    { id: 'wholehouse', name: 'Cellar to rafters', text: 'Win every battle in the house.', reward: 300, test: (s, c) => HOUSE.every(id => won(c, id)) },
    { id: 'stars', name: 'Three stars everywhere', text: 'Three stars on every battle in the cellar.', reward: 400, test: (s, c) => allBattles(c, w => DIFFS.some(d => w[d] === 3)) },
    { id: 'deadlyflawless', name: 'Not a scratch, even then', text: 'Win a battle on Deadly without losing a life.', reward: 200, test: s => s.won && s.difficulty === 'deadly' && s.livesLost === 0 },
    { id: 'deadlyboss', name: 'The bigger they are, on Deadly', text: 'Win a battle with a boss in it on Deadly.', reward: 150, test: s => s.won && s.difficulty === 'deadly' && s.feats.bosses > 0 },
    { id: 'deadlysix', name: 'Half the cellar, the hard way', text: 'Win six different battles on Deadly.', reward: 300, test: (s, c) => CELLAR.filter(id => (c.wins[id] || {}).deadly).length >= 6 },
    { id: 'deadlylair', name: 'Wyrmslayer', text: 'Win the Red Wyrm’s Lair on Deadly.', reward: 300, test: s => s.won && s.difficulty === 'deadly' && s.battle === 'lair' },
    { id: 'alldeadly', name: 'Every battle on Deadly', text: 'Win every battle in the cellar on Deadly.', reward: 600, test: (s, c) => allBattles(c, w => w.deadly) },
    { id: 'endless10', name: 'The long night', text: 'Hold for ten waves in Endless.', reward: 100, test: (s, c) => c.modes.endless >= 10 },
    { id: 'endless25', name: 'Last orders, never', text: 'Hold for twenty-five waves in Endless.', reward: 250, test: (s, c) => c.modes.endless >= 25 },
    { id: 'daily', name: 'One of the regulars', text: 'Win a Daily Challenge.', reward: 50, test: s => s.mode === 'daily' && s.modeWon },
    { id: 'rush', name: 'One after another', text: 'Win the Boss Rush.', reward: 150, test: (s, c) => c.modes.rush > 0 },
    { id: 'reverse', name: 'Under new management', text: 'Take the tavern in Reverse.', reward: 80, test: s => s.mode === 'reverse' && s.modeWon },
    { id: 'reverseall', name: 'Both sides of the bar', text: 'Take the tavern in Reverse from every battle in the cellar.', reward: 300, test: (s, c) => CELLAR.every(id => c.modes.reverse[id]) },
    { id: 'ringhold', name: 'Both ways covered', text: 'Win a battle round the hay barn without losing a life.', reward: 100,
      test: s => s.won && s.livesLost === 0 && IDX[s.battle] != null && !!(HTL.MAPS[B[IDX[s.battle]].map] || {}).forks },
    { id: 'dryland', name: 'High and dry', text: 'Beat the Thing in the Well out of the water.', reward: 120, test: s => s.feats.dry },
    { id: 'mown', name: 'Mown down', text: 'Beat the Thing Under the Lawn before it can dive.', reward: 120, test: s => s.feats.mown },
    { id: 'strike', name: 'Strike!', text: 'Bowl over three monsters with one barrel.', reward: 80, test: s => s.feats.strike },
    { id: 'puzzles', name: 'Brains as well as brawn', text: 'Solve every puzzle.', reward: 150, test: (s, c) => PUZZLE_COUNT > 0 && Object.keys(c.modes.puzzles).length >= PUZZLE_COUNT }
  ];

  /* ---------- the save ---------- */
  function fresh() {
    return { v: VERSION, takings: 0, earned: 0, wins: {}, upgrades: { door: 0, till: 0, kitchen: 0, training: 0 }, trophies: {}, items: [], equip: {},
      seen: { monsters: {}, heroes: {} }, totals: { battles: 0, wins: 0, kills: 0, crits: 0 },
      modes: { endless: 0, daily: {}, rush: 0, puzzles: {}, reverse: {} }, belt: {}, looks: {} }; // looks: hero → 'f' for her figure (him by default) // belt: throwables on the shelf, kind → how many // reverse: battle id → true once the tavern fell to you // endless: most waves held; daily: date → { score, won }; rush: most lives kept in a win
  }
  // anything missing or malformed in a stored save comes back as a fresh value, so an old or hand-edited save still loads
  function clean(raw) {
    const c = fresh();
    if (!raw || typeof raw !== 'object') return c;
    const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);
    c.takings = num(raw.takings, 0, 1e9); c.earned = num(raw.earned, 0, 1e9);
    for (const id of IDS) {
      const w = raw.wins && raw.wins[id];
      if (!w) continue;
      const out = {};
      for (const d of DIFFS) if (w[d]) out[d] = num(w[d], 1, 3);
      if (Object.keys(out).length) c.wins[id] = out;
    }
    for (const k in c.upgrades) c.upgrades[k] = num(raw.upgrades && raw.upgrades[k], 0, UPGRADES[k].levels.length);
    for (const t of TROPHIES) if (raw.trophies && raw.trophies[t.id]) c.trophies[t.id] = String(raw.trophies[t.id]).slice(0, 10);
    for (const t in HTL.MONSTERS) { const m = raw.seen && raw.seen.monsters && raw.seen.monsters[t]; if (m) c.seen.monsters[t] = { slain: num(m.slain, 0, 1e9) }; }
    for (const t in HTL.HEROES) { const h = raw.seen && raw.seen.heroes && raw.seen.heroes[t]; if (h) c.seen.heroes[t] = { placed: num(h.placed, 0, 1e9) }; }
    for (const k in c.totals) c.totals[k] = num(raw.totals && raw.totals[k], 0, 1e9);
    (Array.isArray(raw.items) ? raw.items : []).forEach(id => { if (HTL.ITEMS[id] && c.items.indexOf(id) < 0) c.items.push(id); });
    for (const t in (raw.equip || {})) equip(c, t, raw.equip[t]);
    const md = raw.modes || {};
    c.modes.endless = num(md.endless, 0, 1e6); c.modes.rush = num(md.rush, 0, 99);
    Object.keys(md.daily || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-DAILY_KEEP).forEach(d => {
      const v = md.daily[d]; if (v && typeof v === 'object') c.modes.daily[d] = { score: num(v.score, 0, 1e9), won: !!v.won }; });
    for (let i = 1; i <= PUZZLE_COUNT; i++) if (md.puzzles && md.puzzles[i]) c.modes.puzzles[i] = true;
    for (const id of IDS) if (md.reverse && md.reverse[id]) c.modes.reverse[id] = true;
    for (const k in (HTL.THROWS || {})) { const n = num(raw.belt && raw.belt[k], 0, BELT_MAX); if (n) c.belt[k] = n; }
    for (const t in HTL.HEROES) if (raw.looks && raw.looks[t] === 'f') c.looks[t] = 'f';
    return c;
  }
  // which figure stands for a kind of hero: hers or his. Only the look changes; the rules don't.
  function setLook(c, type, look) { if (!HTL.HEROES[type]) return false; if (look === 'f') c.looks[type] = 'f'; else delete c.looks[type]; return true; }
  // before the campaign, the game only remembered which battles were won: those count as one-star wins on Medium
  function migrate(oldWins) {
    const c = fresh();
    (Array.isArray(oldWins) ? oldWins : []).forEach(id => { if (IDX[id] != null) { c.wins[id] = { medium: 1 }; c.totals.wins++; c.totals.battles++; } });
    c.takings = c.earned = 50 * Object.keys(c.wins).length; // a welcome back for the regulars
    return c;
  }
  function load(storage, oldWins) {
    try {
      const raw = storage && storage.getItem(KEY);
      if (raw) return clean(JSON.parse(raw));
    } catch (e) { /* unreadable: start again below */ }
    return oldWins && oldWins.length ? migrate(oldWins) : fresh();
  }
  function save(storage, c) { try { storage.setItem(KEY, JSON.stringify(c)); return true; } catch (e) { return false; } }

  /* ---------- reading the campaign ---------- */
  const won = (c, id) => !!c.wins[id] && DIFFS.some(d => c.wins[id][d]);
  const winsCount = c => IDS.filter(id => won(c, id)).length;
  function stars(c, id, difficulty) {
    const w = c.wins[id] || {};
    return difficulty ? (w[difficulty] || 0) : DIFFS.reduce((m, d) => Math.max(m, w[d] || 0), 0);
  }
  function unlocked(c, id) {
    const h = HOUSE.indexOf(id);
    if (h >= 0) return won(c, h === 0 ? HOUSE_OPENS : HOUSE[h - 1]);
    const i = CELLAR.indexOf(id); return i === 0 || (i > 0 && won(c, CELLAR[i - 1]));
  }
  function roster(c) {
    const out = START.slice();
    for (const id of IDS) if (won(c, id) && JOINS[id]) JOINS[id].forEach(t => { if (out.indexOf(t) < 0) out.push(t); });
    return HTL.HERO_TYPES.filter(t => out.indexOf(t) >= 0);
  }
  function rooms(c) { const n = winsCount(c); return ROOMS.map(r => Object.assign({ open: n >= r.wins && (!r.needs || won(c, r.needs)) }, r)); }
  function nextUpgrade(c, key) {
    const u = UPGRADES[key], lvl = c.upgrades[key] || 0;
    return { key, name: u.name, room: u.room, level: lvl, max: u.levels.length, open: winsCount(c) >= u.wins, opensAt: u.wins,
      next: lvl < u.levels.length ? u.levels[lvl] : null, now: lvl ? u.levels[lvl - 1].text : null };
  }
  function buy(c, key) {
    const u = nextUpgrade(c, key);
    if (!UPGRADES[key]) return 'unknown';
    if (!u.open) return 'closed';
    if (!u.next) return 'max';
    if (c.takings < u.next.cost) return 'takings';
    c.takings -= u.next.cost; c.upgrades[key]++;
    return null;
  }
  // give an item to a kind of hero (null takes it back); an item goes to one kind at a time
  function equip(c, type, id) {
    if (!HTL.HEROES[type] || HTL.HEROES[type].ally || HTL.HEROES[type].defender) return 'hero';
    if (id == null) { delete c.equip[type]; return null; }
    const it = HTL.ITEMS[id];
    if (!it || c.items.indexOf(id) < 0) return 'item';
    if (it.for.indexOf(type) < 0) return 'wrong';
    for (const t in c.equip) if (c.equip[t] === id) delete c.equip[t];
    c.equip[type] = id;
    return null;
  }
  const roomOpen = (c, id) => rooms(c).some(r => r.id === id && r.open);
  // buy one throwable for the belt, from the takings
  function buyThrow(c, kind) {
    const th = (HTL.THROWS || {})[kind];
    if (!th) return 'unknown';
    if ((c.belt[kind] || 0) >= BELT_MAX) return 'full';
    if (c.takings < th.cost) return 'takings';
    c.takings -= th.cost; c.belt[kind] = (c.belt[kind] || 0) + 1;
    return null;
  }
  // what to hand the rules for a battle
  function battleOptions(c) {
    return { tavern: Object.assign({}, c.upgrades), items: Object.assign({}, c.equip), cats: roomOpen(c, 'cats') ? { duty: duty(c) } : null,
      belt: Object.keys(c.belt).length ? Object.assign({}, c.belt) : null };
  }

  // what a win would pay: the battle's worth, the difficulty, the stars, and whether it is new
  function pay(c, id, difficulty, st) {
    const prev = (c.wins[id] || {})[difficulty] || 0;
    const k = !won(c, id) ? 2 : !prev ? 1.25 : st > prev ? 1 : 0.4;
    return round5(basePay(id) * (DIFF_PAY[difficulty] || 1) * STAR_PAY[st] * k);
  }

  /* ---------- after a battle ----------
     sum: { battle, difficulty, won, livesLost, goldLeft, met: [monster types], slain: { type: n }, placed: { type: n },
            feats: { bosses, paths, charge3, fireball5, crits, bards } }
     Returns what to tell the player: stars, takings, trophies (with rewards), heroes who joined, rooms that opened. */
  function record(c, sum, today) {
    const before = { roster: roster(c), rooms: rooms(c).filter(r => r.open).map(r => r.id), ups: Object.keys(UPGRADES).filter(k => nextUpgrade(c, k).open) };
    const feats = Object.assign({ bosses: 0, paths: 0, charge3: false, fireball5: false, crits: 0, bards: 0 }, sum.feats || {});
    // a win in one of the modes is not a campaign win: the campaign's trophies wait for the cellar's own battles
    const s = Object.assign({}, sum, { feats, won: !!sum.won && !sum.mode, modeWon: !!sum.won && !!sum.mode });
    const out = { stars: 0, takings: 0, best: false, trophies: [], joined: [], rooms: [], upgrades: [], items: [], mode: null };
    const gain = id => { if (id && HTL.ITEMS[id] && c.items.indexOf(id) < 0) { c.items.push(id); out.items.push(id); } };
    c.totals.battles++;
    (sum.met || []).forEach(t => { if (HTL.MONSTERS[t] && !c.seen.monsters[t]) c.seen.monsters[t] = { slain: 0 }; });
    for (const t in (sum.slain || {})) if (HTL.MONSTERS[t]) { (c.seen.monsters[t] = c.seen.monsters[t] || { slain: 0 }).slain += sum.slain[t]; c.totals.kills += sum.slain[t]; }
    for (const t in (sum.placed || {})) if (HTL.HEROES[t]) (c.seen.heroes[t] = c.seen.heroes[t] || { placed: 0 }).placed += sum.placed[t];
    c.totals.crits += feats.crits || 0;
    for (const k in (sum.thrown || {})) if (c.belt[k]) { c.belt[k] = Math.max(0, c.belt[k] - Math.max(0, Math.floor(sum.thrown[k]) || 0)); if (!c.belt[k]) delete c.belt[k]; } // what was thrown is gone
    const d = DIFFS.indexOf(sum.difficulty) >= 0 ? sum.difficulty : 'medium';
    if (sum.won && IDX[sum.battle] != null) {
      if (!won(c, sum.battle)) gain(DROPS[sum.battle]);
      out.stars = starsFor(sum.livesLost || 0);
      out.takings = pay(c, sum.battle, d, out.stars);
      const w = c.wins[sum.battle] = c.wins[sum.battle] || {};
      if (out.stars > (w[d] || 0)) { w[d] = out.stars; out.best = true; }
      c.totals.wins++;
    } else if (IDX[sum.battle] != null) {
      out.takings = round5(basePay(sum.battle) * (DIFF_PAY[d] || 1) * 0.25); // the cats found a few coins all the same
    }
    if (sum.mode) out.mode = recordMode(c, sum, out);
    for (const t of TROPHIES) {
      if (c.trophies[t.id]) continue;
      let ok = false; try { ok = !!t.test(s, c); } catch (e) { ok = false; }
      if (ok) { c.trophies[t.id] = today || '1970-01-01'; out.trophies.push({ id: t.id, name: t.name, reward: t.reward }); out.takings += t.reward; gain(t.item); }
    }
    c.takings += out.takings; c.earned += out.takings;
    out.joined = roster(c).filter(t => before.roster.indexOf(t) < 0);
    out.rooms = rooms(c).filter(r => r.open && before.rooms.indexOf(r.id) < 0).map(r => r.id);
    out.upgrades = Object.keys(UPGRADES).filter(k => nextUpgrade(c, k).open && before.ups.indexOf(k) < 0);
    return out;
  }

  /* ---------- the modes ----------
     sum.mode: endless (sum.waves held), daily (sum.date, sum.score), rush, or puzzle (sum.puzzle, its number). */
  const MODE_PAY = { wave: 5, daily: 100, rush: 200, rushAgain: 50, puzzle: 60, reverse: 80 };
  function recordMode(c, sum, out) {
    const m = c.modes, res = { kind: sum.mode, best: false, first: false };
    if (sum.mode === 'endless') {
      const w = Math.max(0, Math.floor(sum.waves || 0));
      res.waves = w; res.best = w > m.endless; if (res.best) m.endless = w;
      out.takings += round5(MODE_PAY.wave * w);
    } else if (sum.mode === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(sum.date || '')) {
      const prev = m.daily[sum.date], score = Math.max(0, Math.floor(sum.score || 0));
      res.score = score; res.best = !prev || score > prev.score; res.first = !!sum.won && !(prev && prev.won);
      m.daily[sum.date] = { score: Math.max(score, prev ? prev.score : 0), won: !!sum.won || !!(prev && prev.won) };
      if (res.first) out.takings += MODE_PAY.daily;
      const keep = Object.keys(m.daily).sort().slice(-DAILY_KEEP), all = m.daily; m.daily = {}; keep.forEach(k => { m.daily[k] = all[k]; });
    } else if (sum.mode === 'rush' && sum.won) {
      const kept = Math.max(1, (sum.lives || 0)); res.first = !m.rush; res.best = kept > m.rush;
      if (res.best) m.rush = kept;
      out.takings += res.first ? MODE_PAY.rush : MODE_PAY.rushAgain;
    } else if (sum.mode === 'reverse' && sum.won && IDX[sum.theme] != null) { // won: the tavern fell to your monsters
      res.first = !m.reverse[sum.theme]; m.reverse[sum.theme] = true;
      if (res.first) out.takings += MODE_PAY.reverse;
    } else if (sum.mode === 'puzzle' && sum.won && sum.puzzle >= 1 && sum.puzzle <= PUZZLE_COUNT) {
      res.first = !m.puzzles[sum.puzzle]; m.puzzles[sum.puzzle] = true;
      if (res.first) out.takings += MODE_PAY.puzzle;
    }
    return res;
  }

  return { VERSION, KEY, DIFFS, CELLAR, HOUSE, HOUSE_OPENS, START, JOINS, ROOMS, UPGRADES, TROPHIES, DROPS, MODE_PAY, BELT_MAX, recordMode, buyThrow, setLook, fresh, clean, migrate, load, save,
    won, winsCount, stars, starsFor, unlocked, roster, rooms, nextUpgrade, buy, equip, duty, battleOptions, pay, record };
})(HTL);
if (typeof module !== 'undefined' && module.exports) module.exports = HTL_CAMPAIGN;
