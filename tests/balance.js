// Balance report: Simz plays every battle with the party he suggests, on all four difficulties,
// and a slow, hesitant builder plays it on Medium. This is the balance half of the release gate.
// Usage: node tests/balance.js [battle ids, comma-separated | all] [seeds per difficulty, default 10]
//   Gate: Simz wins at least 80% of each battle on Medium; the slow builder wins no more than 90%;
//   Simz wins at least 70% on Hard overall; Deadly overall is at least 50% and no easier than Hard.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = new Function(['pack-core.js', 'sim.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + '\nreturn HTL;')();

const want = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : H.BATTLES.map(b => b.id);
const N = +(process.argv[3] || 10);
const DIFFS = ['easy', 'medium', 'hard', 'deadly'];

const slow = s => { // a hesitant player: one hero every third round, a fixed build, no reacting to threats
  if (s.round % 3) return;
  const PLAN = [['bard', 2, 0], ['bard', 1, 0], ['ranger', 2, 1], ['ranger', 1, 1], ['ranger', 3, 1], ['ranger', 0, 1], ['ranger', 4, 1],
    ['fighter', 2, 4], ['fighter', 1, 4], ['fighter', 3, 4], ['fighter', 0, 4], ['fighter', 4, 4], ['wizard', 2, 2], ['wizard', 1, 2], ['wizard', 3, 2],
    ['fighter', 2, 5], ['fighter', 1, 5], ['fighter', 3, 5], ['wizard', 0, 2], ['wizard', 4, 2]];
  for (const [type, lane, sq] of PLAN) {
    const why = H.canPlace(s, type, lane, sq);
    if (why === 'occupied' || why === 'off') continue;
    if (!why) H.place(s, type, lane, sq);
    break;
  }
};
function play(seed, id, difficulty, brain) {
  const s = H.newGame(seed, id, brain ? { difficulty } : { difficulty, loadout: H.suggestLoadout(id).pick });
  let last = -1, g = 0;
  while (s.phase === 'running' && g++ < 200000) { if (s.round !== last) { last = s.round; (brain || H.autoplay)(s); } H.step(s, 0.1); s.events.length = 0; }
  return s;
}

const total = { easy: 0, medium: 0, hard: 0, deadly: 0 }, fails = [];
let games = 0, stalls = 0;
const t0 = Date.now();
console.log('Balance report: ' + want.length + ' battles, ' + N + ' seeds per difficulty\n');
console.log('battle'.padEnd(10) + DIFFS.map(d => d.padStart(7)).join('') + '   slow   party');
for (const id of want) {
  const row = {};
  for (const d of DIFFS) {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const s = play(1000 + i * 7919, id, d); games++;
      if (s.phase === 'won') w++;
      else if (s.phase === 'running') { stalls++; fails.push(id + ' ' + d + ' seed ' + (1000 + i * 7919) + ' never ended'); }
    }
    row[d] = w; total[d] += w;
  }
  let sw = 0;
  for (let i = 0; i < N; i++) { if (play(1000 + i * 7919, id, 'medium', slow).phase === 'won') sw++; games++; }
  if (row.medium < 0.8 * N) fails.push(id + ': Simz won ' + row.medium + '/' + N + ' on Medium (needs ' + Math.ceil(0.8 * N) + ')');
  if (sw > 0.9 * N) fails.push(id + ': the slow builder won ' + sw + '/' + N + ' on Medium (allowed ' + Math.floor(0.9 * N) + ')');
  console.log(id.padEnd(10) + DIFFS.map(d => (row[d] + '/' + N).padStart(7)).join('') + (sw + '/' + N).padStart(7) + '   ' + H.suggestLoadout(id).pick.join(' '));
}
const pct = d => total[d] / (want.length * N);
console.log('\noverall   ' + DIFFS.map(d => (Math.round(pct(d) * 100) + '%').padStart(7)).join(''));
if (want.length > 1) {
  if (pct('hard') < 0.7) fails.push('Hard overall ' + Math.round(pct('hard') * 100) + '% (needs 70%)');
  if (pct('deadly') < 0.5) fails.push('Deadly overall ' + Math.round(pct('deadly') * 100) + '% (needs 50%)');
  if (pct('deadly') > pct('hard')) fails.push('Deadly is easier than Hard');
}
console.log(games + ' games, ' + stalls + ' that never ended, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
if (fails.length) { console.log('\nGATE FAILS:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('Balance gate passes.');
