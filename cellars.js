/* Hold the Line: cellars of your own. The rules side of Mitz's Drawing Board (the page's side is view/board-editor.js).
   A cellar is plain data: a floor drawn in the same characters as the pack's maps, a theme, the starting gold and its
   waves. check() says in plain words what stops it being played, and what is worth knowing; play() turns it into a
   battle the rules run like any other (battle id 'cellar:<key>', where the key is a fingerprint of the cellar, so a
   changed cellar is a new battle and the same cellar always plays the same). Loaded after modes.js; tested headless. */
var HTL_CELLARS = (function (HTL) {
  'use strict';
  const VERSION = 1;
  const LIMITS = { rows: [3, 9], len: [6, 14], waves: 7, perWave: 40, gold: [50, 400], name: 40 };

  // what can be drawn, in the order the palette shows it, and what each does (as the pack's own maps say)
  const TILES = [
    { ch: '.', name: 'Floor', tip: 'Anyone can walk here, and heroes can stand here.' },
    { ch: '#', name: 'Pillar', tip: 'Nothing stands here, and it blocks the line of sight along its row.' },
    { ch: '~', name: 'Water', tip: 'Walkers take twice as long to wade through. Heroes can stand in it.' },
    { ch: '^', name: 'High ground', tip: 'A hero standing here gets +2 to hit.' },
    { ch: '+', name: 'Holy ground', tip: 'Undead that start a turn here take radiant damage.' },
    { ch: 'o', name: 'Pit', tip: 'Walkers go round it, flyers cross it. Nobody can stand on it.' },
    { ch: '%', name: 'Hedge', tip: 'Walkers go round, flyers go over, nobody stands in it; everyone sees over it.' },
    { ch: '=', name: 'Ice', tip: 'Walkers slide across twice as fast. Nobody can stand on it.' },
    { ch: '*', name: 'Oven', tip: 'A wall that flares every few rounds, burning whatever stands beside it.' },
    { ch: 'G', name: 'Gate', tip: 'A way through, until you drop it in battle for a few rounds.' },
    { ch: 'D', name: 'Door', tip: 'Monsters come in here. Nobody can stand on it.' },
    { ch: 'H', name: 'Hatch', tip: 'Floor until a monster bursts up through it, and a door after.' },
    { ch: '@', name: 'Well', tip: 'A way in out in the middle of the floor. Nobody can stand on it.' },
    { ch: ' ', name: 'Outside', tip: 'Not part of the mat at all.' }
  ];
  const CHARS = TILES.map(t => t.ch).join('');
  const WAYS_IN = 'DH@';
  // the looks a cellar can have: the Delve's zones and the house's own (the same names as the pack's battles)
  const THEMES = [['damp', 'Damp stone'], ['sunken', 'Flooded'], ['sewer', 'Sewer'], ['crypt', 'Crypt'], ['ossuary', 'Ossuary'], ['tomb', 'Tomb'],
    ['dwarven', 'Dwarven halls'], ['mine', 'Mine'], ['fungal', 'Fungal caves'], ['lava', 'Forge and lava'], ['frost', 'Ice'], ['lodge', 'Old boards'],
    ['kitchen', 'Kitchen tiles'], ['yard', 'Yard cobbles'], ['garden', 'Garden flags']];
  // a new cellar starts with two waves of the Warren's monsters, which everyone has met by the time the board opens
  const TRIAL_WAVES = [
    { name: 'Rats and Kobolds', by: 'Mitz', line: 'A first look at how your cellar holds.', spawns: 'direRat:0*2 kobold:3 direRat:5*2 kobold:7 goblin:9*2' },
    { name: 'Goblins', by: 'Simz', line: 'Now with archers and bats, to see where they get through.', spawns: 'goblin:0*2 goblinArcher:2 caveBat:4*2 goblin:6*2 goblinArcher:8 kobold:10*2 goblin:12*2' }
  ];
  const MAX_ROUND = 20, MAX_COUNT = 6;

  /* ---------- waves ---------- */
  // a wave's spawn line as a list the board can show: [{ type, at, count, door }] (door null: any way in)
  function entries(w) { try { return HTL.parseSpawns(w.spawns || '').map(e => ({ type: e.type, at: e.at, count: e.count, door: e.door })); } catch (e) { return []; } }
  function spawnsOf(list) {
    return list.slice().sort((a, b) => a.at - b.at).map(e => e.type + ':' + e.at + (e.count > 1 ? '*' + e.count : '') + (e.door != null ? '@' + e.door : '')).join(' ');
  }
  // how hard a monster is, roughly: what it can take, times what it deals in a turn
  function strengthOf(type) {
    const m = HTL.MONSTERS[type]; if (!m) return 0;
    const a = m.attack, hit = (a.n * (a.d + 1) / 2 + a.mod) * ((m.traits.multi && m.traits.multi > 1 ? m.traits.multi : 1));
    return m.hp * Math.max(1, hit);
  }
  const strengthOfWave = list => list.reduce((n, e) => n + strengthOf(e.type) * e.count, 0);
  let PACK_WAVES = null; // every wave of the pack's own battles, with its strength, to compare with
  function packWaves() {
    if (!PACK_WAVES) { PACK_WAVES = [];
      for (const b of HTL.BATTLES) b.waves.forEach((w, i) => PACK_WAVES.push({ battle: b.name, wave: w.name, i, gold: b.gold, s: strengthOfWave(w.parsed || entries(w)) })); }
    return PACK_WAVES;
  }
  // a wave's threat in words: the pack's wave nearest in strength, and whether it is far beyond any wave the pack sends that early
  function threat(c, i) {
    const list = entries(c.waves[i] || {}), s = strengthOfWave(list); if (!s) return null;
    const all = packWaves(); let near = all[0];
    for (const w of all) if (Math.abs(Math.log(w.s) - Math.log(s)) < Math.abs(Math.log(near.s) - Math.log(s))) near = w;
    const sameStage = all.filter(w => w.i === i), most = Math.max.apply(null, sameStage.length ? sameStage.map(w => w.s) : all.map(w => w.s));
    const words = s > most * 1.5 ? 'Much harder than any wave ' + (i + 1) + ' in the game.' : s < Math.min.apply(null, all.map(w => w.s)) ? 'Gentler than anything in the game.' : '';
    return { strength: Math.round(s), like: near, words };
  }

  function blank() {
    return { v: VERSION, name: 'A cellar of my own', theme: 'damp', forks: false, gold: 150,
      rows: ['.........D', '.........D', '.........D', '.........D', '.........D'], waves: TRIAL_WAVES.map(w => Object.assign({}, w)) };
  }
  // a cellar from anywhere (storage, a file): the right shape, or null
  function clean(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows) || !raw.rows.length) return null;
    const c = blank();
    c.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, LIMITS.name) : c.name;
    c.theme = THEMES.some(([k]) => k === raw.theme) ? raw.theme : c.theme;
    c.forks = !!raw.forks;
    c.gold = Math.min(LIMITS.gold[1], Math.max(LIMITS.gold[0], Math.round(+raw.gold) || c.gold));
    const len = Math.min(LIMITS.len[1], Math.max(LIMITS.len[0], Math.max.apply(null, raw.rows.map(r => String(r).length))));
    c.rows = raw.rows.slice(0, LIMITS.rows[1]).map(r => String(r).slice(0, len).padEnd(len, ' ').replace(new RegExp('[^' + CHARS.replace(/[\]^\\-]/g, '\\$&') + ']', 'g'), '.'));
    while (c.rows.length < LIMITS.rows[0]) c.rows.push(' '.repeat(len));
    if (Array.isArray(raw.waves) && raw.waves.length) c.waves = raw.waves.slice(0, LIMITS.waves).filter(w => w && typeof w.spawns === 'string' && entries(w).length)
      .map(w => ({ name: String(w.name || 'A wave').slice(0, LIMITS.name), by: w.by === 'Simz' ? 'Simz' : 'Mitz', line: String(w.line || '').slice(0, 140), spawns: w.spawns }));
    if (!c.waves.length) c.waves = TRIAL_WAVES.map(w => Object.assign({}, w));
    // the seals it has earned, each for the cellar as it was: beaten on Medium (needed to share it), and the Deadly record
    if (raw.beaten && typeof raw.beaten.fp === 'string') c.beaten = { fp: raw.beaten.fp.slice(0, 16), by: raw.beaten.by === 'simz' ? 'simz' : 'you' };
    if (raw.deadly && typeof raw.deadly.fp === 'string') c.deadly = { fp: raw.deadly.fp.slice(0, 16), you: !!raw.deadly.you, simz: raw.deadly.simz == null ? null : Math.max(0, Math.floor(+raw.deadly.simz) || 0) };
    return c;
  }

  /* ---------- drawing ---------- */
  function paint(c, lane, sq, ch) {
    if (CHARS.indexOf(ch) < 0 || !c.rows[lane] || sq < 0 || sq >= c.rows[lane].length) return false;
    const r = c.rows[lane]; if (r[sq] === ch) return false;
    c.rows[lane] = r.slice(0, sq) + ch + r.slice(sq + 1);
    return true;
  }
  // a row more or fewer (at the far side), a square longer or shorter (the doors stay at the far end)
  function resize(c, dRows, dLen) {
    const len = c.rows[0].length, h = c.rows.length;
    if (dLen > 0 && len < LIMITS.len[1]) c.rows = c.rows.map(r => r.slice(0, -1) + (r[len - 1] === ' ' ? ' ' : '.') + r.slice(-1));
    if (dLen < 0 && len > LIMITS.len[0]) c.rows = c.rows.map(r => r.slice(0, -2) + r.slice(-1));
    if (dRows > 0 && h < LIMITS.rows[1]) c.rows.push('.'.repeat(c.rows[0].length - 1) + 'D');
    if (dRows < 0 && h > LIMITS.rows[0]) c.rows.pop();
    return c;
  }

  /* ---------- the checks ---------- */
  const rowName = l => 'row ' + (l + 1), at = (l, q) => rowName(l) + ', square ' + (q + 1);
  // { ok, problems: [words], notes: [words], map: the floor as the rules see it (or null), routes: [[{lane, sq}...] per way in] }
  function check(c, opts) {
    const problems = [], notes = [], out = { ok: false, problems, notes, map: null, routes: [] };
    if (!c || !Array.isArray(c.rows)) { problems.push('There is no floor.'); return out; }
    const h = c.rows.length, len = c.rows[0].length;
    if (h < LIMITS.rows[0] || h > LIMITS.rows[1]) problems.push('A cellar has ' + LIMITS.rows[0] + ' to ' + LIMITS.rows[1] + ' rows.');
    if (len < LIMITS.len[0] || len > LIMITS.len[1]) problems.push('A cellar is ' + LIMITS.len[0] + ' to ' + LIMITS.len[1] + ' squares long.');
    if (c.rows.some(r => r.length !== len)) { problems.push('Every row must be the same length.'); return out; }
    if (c.rows.some(r => [...r].some(ch => CHARS.indexOf(ch) < 0))) { problems.push('Something on the floor isn’t a tile the game knows.'); return out; }
    const ways = []; c.rows.forEach((r, l) => [...r].forEach((ch, q) => { if (WAYS_IN.indexOf(ch) >= 0) ways.push({ lane: l, sq: q, ch }); }));
    if (!ways.length) problems.push('There’s no way in: draw a door, a hatch or a well for the monsters.');
    if (ways.length > 8) problems.push('No more than 8 ways in, or the monsters can’t be counted out fairly.');
    if (!c.rows.some(r => HTL.PLACEABLE.indexOf(r[0]) >= 0 || '=G'.indexOf(r[0]) >= 0)) problems.push('The tavern side (the left edge) needs at least one square of floor, so the monsters have somewhere to aim for.');
    const stand = c.rows.reduce((n, r) => n + [...r].filter(ch => HTL.PLACEABLE.indexOf(ch) >= 0 && ch !== 'H').length, 0);
    if (stand < 6) problems.push('Heroes need somewhere to stand: at least 6 squares of floor, water, high or holy ground.');
    let map = null;
    try { map = HTL.trialMap({ name: c.name, rows: c.rows, forks: c.forks }); } catch (e) { problems.push('The floor can’t be read: ' + e.message); }
    if (map) {
      out.map = map;
      ways.forEach((w, i) => {
        if (!isFinite(map.distWalk[w.lane][w.sq])) { problems.push('The ' + (w.ch === 'D' ? 'door' : w.ch === 'H' ? 'hatch' : 'well') + ' at ' + at(w.lane, w.sq) + ' has no way through to the tavern.'); out.routes.push([]); return; }
        const path = []; let p = { lane: w.lane, sq: w.sq }, guard = 0;
        while (p && !p.exit && guard++ < 400) { path.push({ lane: p.lane, sq: p.sq }); p = map.nextWalk[p.lane][p.sq]; }
        out.routes.push(path);
        void i;
      });
      const shortest = Math.min.apply(null, ways.map(w => map.distWalk[w.lane][w.sq]).filter(isFinite));
      if (isFinite(shortest) && shortest <= 4) notes.push('The nearest way in is only ' + Math.round(shortest) + ' squares from the tavern. That’s a hard cellar to hold.');
      if (map.oven) notes.push('The ovens flare every few rounds on the squares beside them.');
      if (map.gate) notes.push('The gate can be dropped in battle to hold the monsters back for a few rounds.');
      if (ways.some(w => w.ch === 'H')) notes.push('Hatches are floor until a monster bursts up through one.');
    }
    if (!(c.name || '').trim()) problems.push('Give the cellar a name.');
    // the waves: monsters the player has met (opts.met, a list of types; all of them if not given), doors that exist
    const met = opts && opts.met ? new Set(opts.met) : null;
    if (!c.waves || !c.waves.length) problems.push('Add at least one wave of monsters.');
    if (c.waves && c.waves.length > LIMITS.waves) problems.push('No more than ' + LIMITS.waves + ' waves.');
    (c.waves || []).forEach((w, i) => {
      const list = entries(w), n = list.reduce((k, e) => k + e.count, 0), name = 'Wave ' + (i + 1);
      if (!list.length) { problems.push(name + ' has no monsters in it.'); return; }
      if (n > LIMITS.perWave) problems.push(name + ' sends ' + n + ' monsters: ' + LIMITS.perWave + ' is the most.');
      for (const e of list) {
        if (met && !met.has(e.type)) problems.push(name + ': you haven’t met the ' + HTL.MONSTERS[e.type].name.replace(/^The /, '') + ' yet, so you can’t send one.');
        if (e.door != null && e.door >= ways.length) problems.push(name + ' sends monsters through way in ' + (e.door + 1) + ', but there ' + (ways.length === 1 ? 'is only 1' : 'are only ' + ways.length) + '.');
      }
    });
    out.ok = !problems.length;
    return out;
  }

  /* ---------- playing it ---------- */
  function fingerprint(c) { // the same cellar, the same key
    const str = JSON.stringify([c.name, c.theme, c.forks, c.gold, c.rows, c.waves.map(w => [w.name, w.spawns])]);
    let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  // the cellar as it plays, without its name or seals: what a seal is for, so renaming a cellar keeps them
  function layoutKey(c) { return fingerprint({ name: '', theme: c.theme, forks: c.forks, gold: c.gold, rows: c.rows, waves: c.waves.map(w => ({ name: '', spawns: w.spawns })) }); }
  const sealed = (c, seal) => !!(seal && seal.fp === layoutKey(c));
  function markBeaten(c, by) { if (!sealed(c, c.beaten)) c.beaten = { fp: layoutKey(c), by }; }
  function markDeadly(c, what) { // what: { you: true } or { simz: wins }
    if (!sealed(c, c.deadly)) c.deadly = { fp: layoutKey(c), you: false, simz: null };
    if (what.you) c.deadly.you = true;
    if (what.simz != null) c.deadly.simz = what.simz;
  }
  const canShare = c => sealed(c, c.beaten);
  const READY = {}; // key → the cellar, for the battle maker
  HTL.addMaker('cellar', key => {
    const c = READY[key]; if (!c) return null;
    const map = HTL.addMap('cellar-' + key, { name: c.name, rows: c.rows, forks: c.forks });
    return { name: c.name, theme: c.theme, map: map.id, gold: c.gold, by: 'Mitz', line: 'A cellar of your own drawing. Let’s see if it holds.',
      waves: c.waves.map(w => ({ name: w.name, by: w.by, line: w.line, spawns: w.spawns })) };
  });
  // the battle id for a cellar that passes its checks, or null
  function play(c, opts) {
    const ch = check(c, opts); if (!ch.ok) return null;
    const key = fingerprint(c); READY[key] = JSON.parse(JSON.stringify(c));
    return 'cellar:' + key;
  }
  /* Simz tries a cellar: one game, his suggested party, on a difficulty. { won, leaks: { row: n } } where monsters got
     through. Kept to one game a call so the page can run them between frames. */
  function trialGame(c, difficulty, seed) {
    const id = play(c); if (!id) return null;
    const s = HTL.newGame(seed, id, { difficulty, loadout: HTL.suggestLoadout(id).pick }), leaks = {};
    let last = -1, guard = 0;
    while (s.phase === 'running' && guard++ < 80000) {
      if (s.round !== last) { last = s.round; HTL.autoplay(s); }
      HTL.step(s, 0.1);
      for (const e of s.events.splice(0)) if (e.type === 'leak') leaks[e.lane] = (leaks[e.lane] || 0) + 1;
    }
    return { won: s.phase === 'won', leaks };
  }
  const TRIAL_DIFFS = ['easy', 'medium', 'hard', 'deadly'], TRIAL_SEEDS = [101, 202, 303, 404, 505];

  /* ---------- sharing: a cellar as a small file ---------- */
  const FILE_TAG = 'mitznsimz-hold-the-line';
  function exportText(c) {
    const out = clean(c); delete out.deadly;
    return JSON.stringify({ game: FILE_TAG, kind: 'cellar', v: VERSION, cellar: out }, null, 1);
  }
  // { cellar } or { error } in words for the player; a shared cellar must play, but its monsters needn't be ones you've met
  function importText(text) {
    let o; try { o = JSON.parse(String(text)); } catch (e) { return { error: 'That file couldn’t be read as a cellar.' }; }
    if (!o || typeof o !== 'object' || o.game !== FILE_TAG) return { error: 'That file isn’t from Hold the Line.' };
    if (o.kind !== 'cellar') return { error: o.campaign ? 'That’s a campaign, not a cellar. Import it under Settings in the tavern.' : 'That file has no cellar in it.' };
    if ((+o.v || 0) > VERSION) return { error: 'That cellar was drawn in a newer version of the game. Reload the page to get the latest, then try again.' };
    const c = clean(o.cellar); if (!c) return { error: 'That file has no cellar in it.' };
    const ch = check(c); if (!ch.ok) return { error: 'That cellar can’t be played: ' + ch.problems[0] };
    return { cellar: c };
  }
  return { VERSION, LIMITS, TILES, THEMES, TRIAL_WAVES, MAX_ROUND, MAX_COUNT, TRIAL_DIFFS, TRIAL_SEEDS, blank, clean, paint, resize, check, play, fingerprint, layoutKey,
    entries, spawnsOf, threat, strengthOf, trialGame, markBeaten, markDeadly, sealed, canShare, exportText, importText };
})(HTL);
if (typeof module !== 'undefined' && module.exports) module.exports = HTL_CELLARS;
