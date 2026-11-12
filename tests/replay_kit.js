// Replays: every battle played start to finish by two fixed players, from fixed seeds, and boiled down to a digest:
// how many events of each kind, a fingerprint of the whole stream, and how it ended. tests/replays.json holds the
// digests as the rules play today; the game tests play the battles again and compare, so a change to how battles
// play shows up battle by battle. When a change is meant (a new rule, a rebalanced wave), record them afresh:
//   node tests/record_replays.js
// The two players use only the rules' public calls and never change, so only the rules can move a replay.
'use strict';

// a player who builds a set line and throws barbarians at a crowd (Simz as he played in v1.0)
function steady(H, s) {
  if (s.phase !== 'running') return;
  const lanes = H.mapOf(s).h, near = (a, b) => Math.abs(a.lane - b.lane) <= 1 && Math.abs(a.sq - b.sq) <= 1;
  const put = (type, lane, sq) => !H.place(s, type, lane, sq);
  for (let lane = 0; lane < lanes; lane++) {
    let front = null;
    for (const u of s.units) if (u.alive && u.kind === 'monster' && u.lane === lane && (!front || u.sq < front.sq)) front = u;
    if (!front) continue;
    const mine = s.units.filter(u => u.alive && u.kind === 'hero' && u.lane === lane && u.sq < front.sq);
    let placed = false;
    if (H.MONSTERS[front.type].traits.resist && !mine.some(u => u.type === 'wizard'))
      for (const sq of [2, 1, 3]) if (sq < front.sq && put('wizard', lane, sq)) { placed = true; break; }
    if (!placed && !mine.some(u => u.type === 'ranger' || u.type === 'wizard'))
      for (const sq of [1, 2, 3]) if (sq < front.sq && put('ranger', lane, sq)) { placed = true; break; }
    if (!mine.some(u => u.type === 'fighter') && front.sq >= 2 && front.sq <= 6) put('fighter', lane, front.sq - 1);
  }
  for (const [type, lane, sq] of PLAN) {
    if (lane >= lanes) continue;
    const why = H.canPlace(s, type, lane, sq);
    if (why === 'occupied') continue;
    if (why) break;
    put(type, lane, sq);
  }
  let best = null, bestScore = 0;
  for (const front of s.units) {
    if (!front.alive || front.kind !== 'monster' || front.sq > 8) continue;
    let score = 0, crowd = 0;
    for (const m of s.units) if (m.alive && m.kind === 'monster' && near(m, front)) { score += m.hp; crowd++; }
    if (H.MONSTERS[front.type].traits.boss) score += 150;
    if (front.sq <= 3) score += 120;
    if (crowd >= 3) score += 60;
    if (score > bestScore) { best = front; bestScore = score; }
  }
  if (best && bestScore >= 150) for (let sq = best.sq - 1; sq >= 0; sq--) if (!H.unitAt(s, best.lane, sq)) { put('barbarian', best.lane, sq); break; }
}
const PLAN = [['bard', 2, 0], ['bard', 1, 0], ['ranger', 2, 1], ['bard', 3, 0], ['ranger', 1, 1], ['ranger', 3, 1], ['ranger', 0, 1], ['ranger', 4, 1],
  ['fighter', 2, 4], ['fighter', 1, 4], ['fighter', 3, 4], ['fighter', 0, 4], ['fighter', 4, 4], ['wizard', 2, 2], ['bard', 0, 0], ['wizard', 1, 2],
  ['wizard', 3, 2], ['bard', 4, 0], ['wizard', 0, 2], ['wizard', 4, 2], ['cleric', 1, 3], ['cleric', 3, 3], ['fighter', 0, 5], ['fighter', 2, 5],
  ['fighter', 4, 5], ['rogue', 1, 5], ['rogue', 3, 5], ['ranger', 2, 3], ['ranger', 0, 3], ['ranger', 4, 3]];
// a hesitant player who places one hero every third round, wherever it will go
function slow(H, s) {
  if (s.round % 3) return;
  for (const [type, lane, sq] of [['bard', 2, 0], ['ranger', 2, 1], ['ranger', 1, 1], ['ranger', 3, 1], ['fighter', 2, 4], ['wizard', 2, 2],
    ['ranger', 0, 1], ['ranger', 4, 1], ['fighter', 1, 4], ['fighter', 3, 4], ['cleric', 2, 3], ['rogue', 1, 5], ['barbarian', 3, 2]]) {
    const why = H.canPlace(s, type, lane, sq);
    if (why === 'occupied' || why === 'recharging') continue;
    if (!why) H.place(s, type, lane, sq);
    break;
  }
}
const PLAYERS = { steady, slow };
const SEEDS = [11, 4242];

function replay(H, seed, battleId, player) {
  const s = H.newGame(seed, battleId), counts = {};
  let lastRound = -1, guard = 0, h = 2166136261; // FNV-1a over the whole event stream
  while (s.phase === 'running' && guard++ < 60000) {
    if (s.round !== lastRound) { lastRound = s.round; player(H, s); }
    H.step(s, 0.1);
    for (const ev of s.events.splice(0)) {
      counts[ev.type] = (counts[ev.type] || 0) + 1;
      const str = JSON.stringify(ev);
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    }
  }
  return { phase: s.phase, round: s.round, gold: s.gold, lives: s.lives, events: Object.values(counts).reduce((a, b) => a + b, 0),
    fingerprint: (h >>> 0).toString(16), counts: Object.fromEntries(Object.entries(counts).sort()) };
}
// every battle of the pack, each player, each seed: { 'warren steady 11': digest, ... }
function recordAll(H, seeds) {
  const out = {};
  for (const b of H.BATTLES) for (const [who, p] of Object.entries(PLAYERS)) for (const seed of seeds || SEEDS) out[b.id + ' ' + who + ' ' + seed] = replay(H, seed, b.id, p);
  return out;
}
module.exports = { PLAYERS, SEEDS, replay, recordAll };
