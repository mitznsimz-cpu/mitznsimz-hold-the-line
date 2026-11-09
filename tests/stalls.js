// Stall hunt: plays every battle many times with Simz in charge and looks for games that never end.
// Each game varies the difficulty, the tavern's upgrades, the items carried, the cat on watch, and which
// path each hero takes at level 3 (every other game takes the paths Simz never picks).
// Usage: node tests/stalls.js [games per battle, default 10]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = new Function(['pack-core.js', 'sim.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\nreturn HTL;')();

const n = +(process.argv[2] || 10), DK = ['easy', 'medium', 'hard', 'deadly'];
const ALT = { bard: 'lore', fighter: 'shieldwarden', ranger: 'houndmaster', wizard: 'graveseer', cleric: 'dawnkeeper', rogue: 'thief', barbarian: 'berserker' };
const items = {}; for (const id in H.ITEMS) for (const t of H.ITEMS[id].for) if (!items[t]) { items[t] = id; break; }
let stalls = 0, games = 0, won = 0;
const t0 = Date.now();
for (const b of H.BATTLES) for (let i = 0; i < n; i++) {
  const seed = 53 + i * 7919, odd = i % 2 === 1;
  const tavern = { door: i % 3, till: i % 4, kitchen: i % 3, training: i % 3 };
  const s = H.newGame(seed, b.id, { difficulty: DK[i % 4], loadout: H.HERO_TYPES.slice(), tavern, items, cats: { duty: odd ? 'simz' : 'mitz' } });
  const brain = x => {
    if (odd) for (const u of x.units) if (u.alive && u.kind === 'hero' && ALT[u.type] && H.upgradeCost(u) != null && x.gold >= H.upgradeCost(u) + 60)
      H.levelUp(x, u.id, u.level === 2 ? ALT[u.type] : undefined);
    H.autoplay(x);
  };
  let last = -1, g = 0;
  while (s.phase === 'running' && g++ < 40000) { if (s.round !== last) { last = s.round; brain(s); } H.step(s, 0.25); s.events.length = 0; }
  games++; if (s.phase === 'won') won++;
  if (s.phase === 'running') {
    stalls++;
    console.log('STALL', b.id, 'seed', seed, DK[i % 4], 'round', s.round, s.units.filter(u => u.alive && u.kind === 'monster').map(u => u.type + '@' + u.lane + ',' + u.sq + ' ' + u.hp).join(' '));
  }
}
console.log(games + ' games across ' + H.BATTLES.length + ' battles, ' + won + ' won, ' + stalls + ' that never ended, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
process.exit(stalls ? 1 : 0);
