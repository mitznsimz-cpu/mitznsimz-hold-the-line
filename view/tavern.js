// Hold the Line: view/tavern.js. The Cat & Mouse between battles: the hub and its rooms (the cellar map, the house plan, repairs, the armoury, the cats'
// corner, the back room, the trophy wall), what each battle brings back, and the common room where a party is picked.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

/* ---------- the Cat & Mouse: the hub between battles, with rooms that open as you win ---------- */
const CAMP = HTL_CAMPAIGN;
const store = () => { try { return window.localStorage; } catch (e) { return null; } };
let camp = CAMP.load(store(), loadWon());
LOOKS = camp.looks;
const saveCamp = () => CAMP.save(store(), camp);
const today = () => new Date().toISOString().slice(0, 10);
const starRow = (n, of) => '<span class="stars" aria-label="' + n + ' of ' + (of || 3) + ' stars">' + '★'.repeat(n) + '<i>' + '★'.repeat((of || 3) - n) + '</i></span>';
const coins = n => '<span class="coin" aria-hidden="true"></span>' + n.toLocaleString('en-GB');
// a mini drawn into a card's canvas, standing on its base
function miniInto(c, type, px, opts) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5); c.width = c.height = Math.round(px * dpr);
  const m = TableMinis.render(figType(type), c.width * 0.66, opts || figOpts(type)), g = c.getContext('2d'), s = Math.min(c.width / m.cv.width, c.height / m.cv.height);
  g.drawImage(m.cv, (c.width - m.cv.width * s) / 2, c.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
}
function catLine() {
  const n = cellarWins(), total = CAMP.CELLAR.length, who = (camp.totals.battles % 2) ? 'Simz' : 'Mitz';
  const lines = n === 0 ? ['Something has been nicking the cheese from the cellar. Something with a lot of cousins.', 'The cellar door is rattling again. Pick a few regulars and have a look.']
    : n >= total ? ['That was everything under the tavern. The regulars are telling it taller every night.', 'Quiet down there now. Too quiet. Fancy another go on Deadly?']
    : ['The cellar goes deeper than anyone thought. ' + (total - n) + ' to go.', 'The regulars are getting good at this. The takings are getting better too.', 'Mind the steps. And the things on the steps.'];
  return { who, line: lines[camp.totals.battles % lines.length] };
}
function showTavern(from) {
  const o = $('overlay'), n = cellarWins(), total = CAMP.CELLAR.length, rooms = CAMP.rooms(camp), cat = catLine();
  const buyable = Object.keys(CAMP.UPGRADES).filter(k => { const u = CAMP.nextUpgrade(camp, k); return u.open && u.next && camp.takings >= u.next.cost; }).length;
  const status = { cellar: n + ' of ' + total + ' won', trophies: Object.keys(camp.trophies).length + ' of ' + CAMP.TROPHIES.length + ' trophies',
    works: buyable ? buyable + (buyable === 1 ? ' upgrade' : ' upgrades') + ' to buy' : 'Nothing you can afford yet',
    armoury: camp.items.length + ' of ' + Object.keys(HTL.ITEMS).length + ' found', cats: (CAMP.duty(camp) === 'mitz' ? 'Mitz' : 'Simz') + ' is on watch next',
    games: MODES ? modeStatus('daily') : '', house: CAMP.HOUSE.filter(id => CAMP.won(camp, id)).length + ' of ' + CAMP.HOUSE.length + ' won' };
  o.innerHTML = '<div class="panel wide hub" role="dialog" aria-labelledby="ovTitle">' +
    '<span class="eyebrow">Mitz &amp; Simz’s tavern</span><h2 id="ovTitle">The Cat &amp; Mouse</h2>' +
    '<p class="persona"><span>' + cat.who + ':</span> ' + cat.line + '</p>' +
    (camp.totals.battles ? '' : '<ul class="how">' +
      '<li><b>Tap a hero, then a square</b> to put the mini on the mat.</li>' +
      '<li><b>Bards earn gold.</b> Slain monsters drop it too.</li>' +
      '<li><b>Every attack is a d20 roll</b> against armour class. Tap any mini to see what it does.</li>' +
      '<li><b>Win battles</b> to open the next one down, earn the takings and fix up the tavern.</li>' +
      '<li>Press <b>Auto</b> and Simz places heroes for you, so you can sit back and watch.</li></ul>') +
    '<div class="takings"><span class="lbl">The takings</span><b>' + coins(camp.takings) + '</b></div>' +
    '<div class="rooms">' + rooms.map(r => '<button type="button" class="room" data-room="' + r.id + '"' + (r.open ? '' : ' disabled') + '>' +
      '<b>' + r.name + '</b><span>' + (r.open ? r.line : r.shut || 'Boarded up. Opens after your ' + (r.wins === 1 ? 'first win' : r.wins + ' wins') + '.') + '</span>' +
      (r.open ? '<em>' + status[r.id] + '</em>' : '') + '</button>').join('') + '</div>' +
    '<h3 class="pick">Tonight’s regulars</h3><div class="regulars" aria-label="' + CAMP.roster(camp).map(t => PACK.heroes[t].name).join(', ') + '"><canvas aria-hidden="true"></canvas></div>' +
    '<div class="btnrow">' + (from === 'pause' ? '<button class="secondary" id="btnBack" type="button">Back</button>' : '') +
    '<button class="secondary" id="btnSettings" type="button">Settings</button><button class="secondary" id="btnCredits" type="button">Credits</button></div>' +
    (from === 'pause' ? '' : '<p class="support-line">' + KOFI_LINE + ' <span aria-hidden="true">·</span> ' + SITE_LINK + '</p>') + '</div>';
  o.hidden = false;
  o.querySelectorAll('.room').forEach(btn => btn.addEventListener('click', () => {
    const r = btn.dataset.room;
    if (r === 'cellar') showCellar(from); else if (r === 'trophies') showTrophies(from, 'trophies'); else if (r === 'works') showWorks(from);
    else if (r === 'armoury') showArmoury(from); else if (r === 'cats') showCats(from); else if (r === 'games' && MODES) showGames(from);
    else if (r === 'house') showHouse(from);
  }));
  if ($('btnBack')) $('btnBack').addEventListener('click', showPause);
  $('btnSettings').addEventListener('click', () => showSettings(() => showTavern(from), from !== 'pause'));
  $('btnCredits').addEventListener('click', () => showCredits(from));
  drawRegulars();
  (o.querySelector('.room:not([disabled])') || $('btnSettings')).focus();
}
// the roster lined up along the bar
function drawRegulars() {
  const c = document.querySelector('#overlay .regulars canvas'); if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#3a281c'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a1d16'; g.fillRect(0, h - 9, w, 9);
  const types = CAMP.roster(camp), u = Math.min(h / 1.25, 44), step = Math.min(u * 0.9, (w - 16) / types.length), x0 = (w - step * types.length) / 2;
  types.forEach((t, i) => { const sp = TableMinis.sprite(figType(t), u * dpr, figOpts(t)); g.drawImage(sp.cv, x0 + (i + 0.5) * step - sp.ax / dpr, h - 10 - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr); });
}

/* ---------- the cellar map: every battle in order, with its stars, opening one by one ---------- */
function battleCard(b, i, list) {
  const st = CAMP.stars(camp, b.id), open = CAMP.unlocked(camp, b.id);
  const prev = HTL.battleById(i > 0 ? list[i - 1] : CAMP.HOUSE_OPENS); // the house's first battle opens with the Red Wyrm's Lair
  const meta = (b.map !== 'classic' ? HTL.MAPS[b.map].name + ' · ' : '') + 'Monster levels ' + b.levels[0] + '–' + b.levels[1] + ' · ' + b.monsters.length + ' kinds · ' + b.waves.length + ' waves';
  return '<button class="battle' + (open ? '' : ' locked') + '" type="button" data-id="' + b.id + '"' + (open ? '' : ' disabled') +
    ' aria-label="Battle ' + (i + 1) + ': ' + b.name + (open ? (st ? ', ' + st + ' of 3 stars' : '') : ', opens when ' + prev.name + ' is won') + '">' +
    '<canvas aria-hidden="true"></canvas>' +
    '<span class="b-name"><span class="b-num">' + (i + 1) + '</span>' + b.name + (st ? starRow(st) : '') + '</span>' +
    '<span class="b-meta">' + (open ? meta : 'Win ' + prev.name + ' to open') + '</span></button>';
}
function showCellar(from) {
  const o = $('overlay');
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
    '<span class="eyebrow">Under the Cat &amp; Mouse</span><h2 id="ovTitle">The cellar map</h2>' +
    '<p class="lede">Each battle opens when the one before it is won. Stars are for lives kept: three for none lost, two for one or two.</p>' +
    '<div class="battles">' + CAMP.CELLAR.map((id, i) => battleCard(HTL.battleById(id), i, CAMP.CELLAR)).join('') + '</div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => showParty(btn.dataset.id, from)));
  $('btnBack').addEventListener('click', () => showTavern(from));
  drawStrips();
  const open = [...o.querySelectorAll('.battle:not([disabled])')]; (open[open.length - 1] || $('btnBack')).focus();
}

// which campaign a battle belongs to, and where it stands in it
function campaignOf(b) {
  if (!b || b.mode) return null;
  const h = CAMP.HOUSE.indexOf(b.id);
  if (h >= 0) return { list: CAMP.HOUSE, i: h, house: true };
  const i = CAMP.CELLAR.indexOf(b.id);
  return i >= 0 ? { list: CAMP.CELLAR, i, house: false } : null;
}
const cellarWins = () => CAMP.CELLAR.filter(id => CAMP.won(camp, id)).length;

/* ---------- the house plan: the rest of the Cat & Mouse, part by part ---------- */
function showHouse(from) {
  const o = $('overlay'), parts = PACK.parts || {}, ids = CAMP.HOUSE;
  const groups = Object.keys(parts).map(k => ({ k, part: parts[k], ids: ids.filter(id => HTL.battleById(id).part === k) })).filter(g => g.ids.length);
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
    '<span class="eyebrow">The rest of the Cat &amp; Mouse</span><h2 id="ovTitle">The house plan</h2>' +
    '<p class="lede">The monsters have found the other ways in. Each battle opens when the one before it is won, and every part of the house has a trick of its own.</p>' +
    groups.map(g => '<h3 class="pick">' + g.part.name + '</h3><p class="part-line">' + g.part.line + '</p>' +
      '<div class="battles">' + g.ids.map(id => battleCard(HTL.battleById(id), ids.indexOf(id), ids)).join('') + '</div>').join('') +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => showParty(btn.dataset.id, from)));
  $('btnBack').addEventListener('click', () => showTavern(from));
  drawStrips();
  const open = [...o.querySelectorAll('.battle:not([disabled])')]; (open[open.length - 1] || $('btnBack')).focus();
}

/* ---------- repairs and extensions: the takings, spent on the tavern ---------- */
function showWorks(from) {
  const o = $('overlay');
  const row = k => {
    const u = CAMP.nextUpgrade(camp, k), can = u.open && u.next && camp.takings >= u.next.cost;
    return '<div class="work' + (u.open ? '' : ' shut') + '"><div class="work-lab"><b>' + u.name + '</b>' +
      '<span class="work-lvl">' + starRow(u.level, u.max) + '</span>' +
      '<span>' + (u.now ? 'Now: ' + u.now : 'Not yet built.') + '</span>' +
      (u.open ? (u.next ? '<span class="work-next">Next: ' + u.next.text + '</span>' : '<span class="work-next">Finished.</span>') : '<span class="work-next">Opens after your ' + (u.opensAt === 1 ? 'first win' : u.opensAt + ' wins') + '.</span>') +
      '</div>' + (u.open && u.next ? '<button class="buy" type="button" data-k="' + k + '"' + (can ? '' : ' disabled') + '>' + coins(u.next.cost) + '</button>' : '') + '</div>';
  };
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">Repairs and extensions</h2>' +
    '<p class="lede">Every win pays into the takings. Spend them here: each improvement helps in every battle from now on.</p>' +
    '<div class="takings"><span class="lbl">The takings</span><b id="takingsNow">' + coins(camp.takings) + '</b></div>' +
    '<div class="works">' + Object.keys(CAMP.UPGRADES).map(row).join('') + '</div>' +
    '<div class="btnrow"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.buy').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.k, why = CAMP.buy(camp, k);
    if (why) { hint(why === 'takings' ? 'Not enough in the takings yet.' : 'That can’t be built yet.', 1800); return; }
    saveCamp(); sfx('coin'); sfx('clack');
    hint(CAMP.UPGRADES[k].name + ': ' + CAMP.nextUpgrade(camp, k).now, 2600);
    showWorks(from);
  }));
  $('btnBack').addEventListener('click', () => showTavern(from));
  $('btnBack').focus();
}

/* ---------- the armoury: magic items, each given to one kind of hero ---------- */
function showArmoury(from) {
  const o = $('overlay'), ros = CAMP.roster(camp);
  const source = id => { const b = Object.keys(CAMP.DROPS).find(k => CAMP.DROPS[k] === id); if (b) return 'Comes up from ' + HTL.battleById(b).name + ' the first time it is won.';
    const t = CAMP.TROPHIES.find(x => x.item === id); return t ? 'The reward for the trophy “' + t.name + '”.' : ''; };
  const card = id => {
    const it = HTL.ITEMS[id], owned = camp.items.indexOf(id) >= 0;
    if (!owned) return '<div class="item unmet"><b>Not found yet</b><span>' + source(id) + '</span></div>';
    const who = it.for.filter(t => ros.indexOf(t) >= 0), on = Object.keys(camp.equip).find(t => camp.equip[t] === id);
    return '<div class="item"><b>' + it.name + '</b><span>' + it.text + '</span>' +
      (who.length ? '<div class="givers" role="group" aria-label="Give the ' + it.name + ' to">' + who.map(t => '<button type="button" data-item="' + id + '" data-t="' + t + '" aria-pressed="' + (on === t) + '">' +
        PACK.heroes[t].name + (camp.equip[t] && camp.equip[t] !== id ? ' (has ' + HTL.ITEMS[camp.equip[t]].name + ')' : '') + '</button>').join('') + '</div>'
        : '<span class="item-none">Nobody at the tavern can carry this yet.</span>') + '</div>';
  };
  const ids = Object.keys(HTL.ITEMS).sort((a, b) => (camp.items.indexOf(b) >= 0) - (camp.items.indexOf(a) >= 0));
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The armoury</h2>' +
    '<p class="lede">Give each item to one kind of hero, and every one of them carries it into battle. Tap again to take it back.</p>' +
    '<p class="diff-line">' + camp.items.length + ' of ' + ids.length + ' found.</p>' +
    '<div class="items">' + ids.map(card).join('') + '</div>' +
    '<h3 class="pick">The belt<span class="count">' + coins(camp.takings) + '</span></h3>' +
    '<p class="diff-line">Things to throw in battle, one a round, onto a single square: everything piled there is hit. Bought from the takings; each throw uses one up. They stay behind on Deadly.</p>' +
    '<div class="items">' + Object.keys(HTL.THROWS).map(k => { const th = HTL.THROWS[k], n = camp.belt[k] || 0;
      return '<div class="item"><b>' + th.name + ' <em class="have">' + n + '</em></b><span>' + th.text + '</span><div class="givers"><button type="button" data-buy="' + k + '"' +
        (camp.takings < th.cost || n >= CAMP.BELT_MAX ? ' disabled' : '') + '>Buy one for ' + th.cost + '</button></div></div>'; }).join('') + '</div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
    if (CAMP.buyThrow(camp, b.dataset.buy)) return; saveCamp(); sfx('coin'); showArmoury(from);
    const again = document.querySelector('[data-buy="' + b.dataset.buy + '"]'); if (again && !again.disabled) again.focus();
  }));
  o.querySelectorAll('.givers button[data-item]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.item, t = b.dataset.t;
    CAMP.equip(camp, t, camp.equip[t] === id ? null : id); saveCamp(); sfx('clack');
    showArmoury(from);
    const again = document.querySelector('.givers button[data-item="' + id + '"][data-t="' + t + '"]'); if (again) again.focus();
  }));
  $('btnBack').addEventListener('click', () => showTavern(from));
  if (!document.activeElement || document.activeElement === document.body) $('btnBack').focus({ preventScroll: true });
}

/* ---------- the cats' corner: Mitz and Simz, and whose turn it is to keep watch ---------- */
function showCats(from) {
  const o = $('overlay'), duty = CAMP.duty(camp), P = HTL.POWERS;
  const card = k => { const p = P[k], on = p.cat === duty, name = p.cat === 'mitz' ? 'Mitz' : 'Simz';
    return '<div class="item' + (on ? ' duty' : '') + '"><b>' + name + '’s ' + p.name + (on ? ' <em>On watch</em>' : '') + '</b><span>' + p.text + '</span>' +
      '<span class="item-none">Ready every ' + p.every[on ? 1 : 0] + ' rounds' + (on ? ', twice as often as usual.' : '.') + ' Key: ' + (k === 'pounce' ? 'Q' : 'W') + '.</span></div>'; };
  o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The cats’ corner</h2>' +
    '<p class="persona"><span>' + (duty === 'mitz' ? 'Mitz' : 'Simz') + ':</span> ' + (duty === 'mitz' ? 'My turn on watch. Anything that comes up those steps in a bunch is getting pounced.' : 'My turn on watch. If it’s not the big one, it’s going off the table.') + '</p>' +
    '<div class="items">' + card('pounce') + card('swat') + '</div>' +
    '<p class="diff-line">They take turns keeping watch, battle by battle. In a battle, tap a cat in the bar at the top, then the mat.</p>' +
    '<div class="btnrow"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  $('btnBack').addEventListener('click', () => showTavern(from));
  $('btnBack').focus();
}

/* ---------- the back room: Endless, the Daily Challenge, the Boss Rush and the puzzles ---------- */
const MODES = typeof HTL_MODES !== 'undefined' ? HTL_MODES : null;
const newSeed = () => ((Math.random() * 4294967295) >>> 0) || 1;
function modeStatus(id) {
  const m = camp.modes, d = m.daily[today()];
  if (id === 'endless') return m.endless ? 'Best: ' + m.endless + (m.endless === 1 ? ' wave' : ' waves') : 'Not tried yet';
  if (id === 'daily') return d ? (d.won ? 'Won today · ' : 'Tried today · ') + 'best score ' + d.score : 'Today’s battle is waiting';
  if (id === 'reverse') { const n = Object.keys(m.reverse).length; return n ? n + ' of ' + CAMP.CELLAR.length + ' taken' : 'Win a battle, then try taking it'; }
  if (id === 'rush') return m.rush ? 'Won, keeping ' + m.rush + (m.rush === 1 ? ' life' : ' lives') + ' at best' : 'Not won yet';
  return Object.keys(m.puzzles).length + ' of ' + MODES.PUZZLES.length + ' solved';
}
function showGames(from) {
  const o = $('overlay');
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The back room</h2>' +
    '<p class="lede">Where the regulars go when the cellar is quiet. Wins here pay into the takings, and every monster slain counts on the trophy wall.</p>' +
    '<div class="rooms modes">' + MODES.MODES.map(md => '<button type="button" class="room" data-mode="' + md.id + '"><b>' + md.name + '</b><span>' + md.line + '</span><em>' + modeStatus(md.id) + '</em></button>').join('') + '</div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.room').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.mode;
    if (k === 'endless') showParty(MODES.endlessId(newSeed()), from);
    else if (k === 'daily') showDaily(from);
    else if (k === 'rush') showParty(MODES.rushId(), from);
    else if (k === 'reverse') showReverse(from);
    else showPuzzles(from);
  }));
  $('btnBack').addEventListener('click', () => showTavern(from));
  o.querySelector('.room').focus();
}
// a party shown as minis in a row, for the battles that bring their own
function partyStrip(types) {
  return '<div class="party fixed">' + types.map(t => '<div class="regular" data-t="' + t + '"><canvas aria-hidden="true"></canvas><b>' + PACK.heroes[t].name +
    '</b></div>').join('') + '</div>';
}
function drawStripMinis() { document.querySelectorAll('#overlay .party.fixed .regular canvas').forEach(c => miniInto(c, c.parentNode.dataset.t, 40)); }
function showDaily(from) {
  const o = $('overlay'), date = today(), id = MODES.dailyId(date), b = HTL.battleById(id), d = camp.modes.daily[date];
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">' + date + ' · ' + HTL.MAPS[b.map].name + '</span><h2 id="ovTitle">The Daily Challenge</h2>' +
    '<p class="persona"><span>Mitz:</span> ' + b.line + '</p>' +
    '<p class="diff-line">Medium, ' + b.waves.length + ' waves, and none of the tavern’s help. The score is 10 for each monster slain, 100 for each life kept, and 500 for a win. A new battle comes at midnight (UTC).' +
    (d ? ' Your best today: <b>' + d.score + '</b>' + (d.won ? ', and a win' : '') + '.' : '') + '</p>' +
    '<h3 class="pick">Today’s party</h3>' + partyStrip(b.party) +
    '<div class="battles"><div class="battle static" data-id="' + id + '"><canvas aria-hidden="true"></canvas><span class="b-name">What’s coming</span><span class="b-meta">Monster levels ' + b.levels[0] + '–' + b.levels[1] + ' · ' + b.monsters.length + ' kinds</span></div></div>' +
    '<div class="btnrow"><button class="primary" id="btnGo" type="button">Play today’s battle</button><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  drawStripMinis(); drawStrips();
  $('btnGo').addEventListener('click', () => newGame(id, true, {}));
  $('btnBack').addEventListener('click', () => showGames(from));
  $('btnGo').focus();
}
/* Reverse: every battle you have won, to take from the other side of the bar */
function showReverse(from) {
  const o = $('overlay'), taken = camp.modes.reverse, R = MODES.REVERSE;
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The back room</span><h2 id="ovTitle">Reverse</h2>' +
    '<p class="persona"><span>Simz:</span> My turn behind the bar. You send the monsters up the steps, and I’ll keep the tavern.</p>' +
    '<p class="lede">Pick a monster, then tap a door to send it. Your purse starts at ' + R.purse + ' and gains ' + R.income + ' a round; you have ' + R.rounds + ' rounds. Take every life and the tavern is yours. A steady trickle won’t do it: a crowd at the right door might.</p>' +
    '<div class="battles">' + CAMP.CELLAR.map(id => HTL.battleById(id)).map((b, i) => {
      const open = CAMP.won(camp, b.id), ok = !!taken[b.id];
      return '<button class="battle' + (open ? '' : ' locked') + '" type="button" data-id="' + b.id + '"' + (open ? '' : ' disabled') + ' aria-label="' + b.name + (ok ? ', taken' : open ? '' : ', win it first') + '"><canvas aria-hidden="true"></canvas>' +
        '<span class="b-name"><span class="b-num">' + (i + 1) + '</span>' + b.name + (ok ? '<span class="solved">Taken</span>' : '') + '</span><span class="b-meta">' + (open ? 'Simz keeps it with ' + HTL.battleById(MODES.reverseId(b.id)).party.length + ' heroes' : 'Win it in the cellar first') + '</span></button>';
    }).join('') + '</div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.battle:not([disabled])').forEach(btn => btn.addEventListener('click', () => { newGame(MODES.reverseId(btn.dataset.id), true, {}); hint('Pick a monster from the tray, then tap a door to send it.', 4000); }));
  $('btnBack').addEventListener('click', () => showGames(from));
  drawStrips();
  (o.querySelector('.battle:not([disabled])') || $('btnBack')).focus();
}
function showPuzzles(from) {
  const o = $('overlay'), solved = camp.modes.puzzles;
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The back room</span><h2 id="ovTitle">Puzzles</h2>' +
    '<p class="lede">Each puzzle gives you a few heroes and no gold, and one life: a single monster through the door and it’s lost. There is always a way.</p>' +
    '<div class="battles">' + MODES.PUZZLES.map((p, i) => {
      const n = i + 1, b = HTL.battleById(MODES.puzzleId(n)), ok = !!solved[n];
      const kit = Object.keys(p.heroes).map(t => p.heroes[t] + ' × ' + PACK.heroes[t].name).join(', ');
      return '<button class="battle" type="button" data-id="' + b.id + '" aria-label="Puzzle ' + n + ': ' + p.name + (ok ? ', solved' : '') + '"><canvas aria-hidden="true"></canvas>' +
        '<span class="b-name"><span class="b-num">' + n + '</span>' + p.name + (ok ? '<span class="solved">Solved</span>' : '') + '</span><span class="b-meta">' + HTL.MAPS[b.map].name + ' · ' + kit + '</span></button>';
    }).join('') + '</div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.battle').forEach(btn => btn.addEventListener('click', () => showPuzzle(btn.dataset.id, from)));
  $('btnBack').addEventListener('click', () => showGames(from));
  drawStrips();
  const first = [...o.querySelectorAll('.battle')].find(x => !/solved/.test(x.getAttribute('aria-label'))) || o.querySelector('.battle'); first.focus();
}
function showPuzzle(id, from) {
  const o = $('overlay'), b = HTL.battleById(id), kit = Object.keys(b.puzzle.heroes);
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Puzzle ' + b.index + ' · ' + HTL.MAPS[b.map].name + '</span><h2 id="ovTitle">' + b.name + '</h2>' +
    '<p class="persona"><span>' + b.by + ':</span> ' + b.line + '</p>' +
    '<p class="diff-line">' + b.waves.length + ' waves and one life. Place your heroes while the cellar is quiet; the first wave comes after a few rounds. Tap a mini on the mat to see what it does; the next wave’s doors show on the mat between waves.</p>' +
    '<h3 class="pick">Your heroes</h3>' + partyStrip(kit) +
    '<div class="btnrow"><button class="primary" id="btnGo" type="button">Start the puzzle</button><button class="secondary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.party.fixed .regular').forEach(x => { const t = x.dataset.t; x.querySelector('b').textContent = b.puzzle.heroes[t] + ' × ' + PACK.heroes[t].name; });
  drawStripMinis();
  $('btnGo').addEventListener('click', () => newGame(id, true, {}));
  $('btnBack').addEventListener('click', () => showPuzzles(from));
  $('btnGo').focus();
}

/* ---------- the trophy wall: trophies, every monster met, and the regulars ---------- */
function showTrophies(from, tab) {
  const o = $('overlay'), M = HTL.MONSTERS, met = Object.keys(M).filter(t => camp.seen.monsters[t]);
  const tabs = [['trophies', 'Trophies'], ['beasts', 'Monsters met'], ['heroes', 'The regulars']];
  let body = '';
  if (tab === 'trophies') {
    body = '<div class="trophies">' + CAMP.TROPHIES.map(t => { const got = camp.trophies[t.id];
      return '<div class="trophy' + (got ? ' got' : '') + '"><b>' + t.name + '</b><span>' + t.text + '</span><em>' + (got ? 'Won ' + got : (t.reward ? '+' + t.reward + ' takings' : '')) + '</em></div>'; }).join('') + '</div>';
  } else if (tab === 'beasts') {
    const where = t => { const b = HTL.BATTLES.find(x => x.monsters.indexOf(t) >= 0); return b ? b.name : ''; };
    body = '<p class="lede">' + met.length + ' of ' + Object.keys(M).length + ' met.</p><div class="beasts">' + Object.keys(M).sort((a, b) => M[a].level - M[b].level).map(t => {
      const s = camp.seen.monsters[t];
      if (!s) return '<div class="beast unmet"><div class="b-fig">?</div><div><b>Not yet met</b><span>Lurks in ' + where(t) + '.</span></div></div>';
      const st = PACK.monsters[t];
      return '<div class="beast"><canvas data-t="' + t + '" aria-hidden="true"></canvas><div><b>' + st.name + '</b><span class="beast-stats">Level ' + M[t].level + ' · ' + st.hp + ' HP · AC ' + st.ac + ' · slain ' + s.slain + '</span><span>' + HTL.describe(t) + '</span></div></div>';
    }).join('') + '</div>';
  } else {
    const ros = CAMP.roster(camp), joinsAfter = t => { for (const id in CAMP.JOINS) if (CAMP.JOINS[id].indexOf(t) >= 0) return HTL.battleById(id).name; return ''; };
    body = '<div class="beasts">' + HTL.HERO_TYPES.map(t => {
      const h = PACK.heroes[t], paths = HTL.PATHS[t] ? Object.values(HTL.PATHS[t]).map(p => p.name).join(' or ') : '';
      if (ros.indexOf(t) < 0) return '<div class="beast unmet"><div class="b-fig">?</div><div><b>Not at the tavern yet</b><span>Joins after you win ' + joinsAfter(t) + '.</span></div></div>';
      const placed = (camp.seen.heroes[t] || {}).placed || 0;
      return '<div class="beast"><canvas data-t="' + t + '" aria-hidden="true"></canvas><div><b>' + h.name + '</b><span class="beast-stats">' + h.cost + ' gold · ' + h.hp + ' HP · AC ' + h.ac + ' · placed ' + placed + '</span><span>' + HTL.describe(t) + '</span>' +
        (paths ? '<span class="beast-stats">At level 3: ' + paths + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">The Cat &amp; Mouse</span><h2 id="ovTitle">The trophy wall</h2>' +
    '<div class="tabs" role="group" aria-label="Show">' + tabs.map(([k, n]) => '<button type="button" data-tab="' + k + '" aria-pressed="' + (k === tab) + '">' + n + '</button>').join('') + '</div>' +
    body + '<div class="btnrow" style="margin-top:14px"><button class="secondary" id="btnBack" type="button">Back to the bar</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTrophies(from, b.dataset.tab)));
  o.querySelectorAll('.beast canvas').forEach(c => miniInto(c, c.dataset.t, 54));
  $('btnBack').addEventListener('click', () => showTavern(from));
  o.querySelector('.tabs button[aria-pressed="true"]').focus();
}

/* ---------- what each battle brings back: feats seen on the mat, recorded when it ends ---------- */
function freshFeats() { return { met: {}, slain: {}, placed: {}, bards: 0, paths: 0, crits: 0, bosses: 0, charge3: false, fireball5: false, charging: {}, ball: null }; }
function trackFeats(ev) {
  const F = V.feats; if (!F) return;
  switch (ev.type) {
    case 'spawn': if (ev.kind === 'monster') F.met[ev.unitType] = 1; break;
    case 'place': F.placed[ev.unitType] = (F.placed[ev.unitType] || 0) + 1; if (ev.unitType === 'bard') F.bards++; break;
    case 'levelup': if (ev.path) F.paths++; break;
    case 'attack': if (ev.side === 'hero' && ev.crit && ev.hit) F.crits++; break;
    case 'charge': F.charging[ev.id] = { t: ev.t, n: 0 }; break;
    case 'barrel': if (ev.downed >= 3) F.strike = true; break;
    case 'dive': F.dived = true; break;
    case 'fireball': F.ball = { from: ev.from, t: ev.t, n: 0 }; break;
    case 'save': if (F.ball && ev.from === F.ball.from && ev.t - F.ball.t < 1 && ++F.ball.n >= 5) F.fireball5 = true; break;
    case 'death': {
      const u = S.units.find(x => x.id === ev.id) || V.sprites.get(ev.id); // the rules may already have cleared it away
      if (!u || u.kind !== 'monster' || !HTL.MONSTERS[u.type]) break;
      F.slain[u.type] = (F.slain[u.type] || 0) + 1;
      if (HTL.MONSTERS[u.type].traits.boss) F.bosses++;
      if (HTL.MONSTERS[u.type].traits.surface && !F.dived) F.mown = true; // down before it could go back under
      if (HTL.MONSTERS[u.type].traits.soak && '~@'.indexOf(HTL.cellAt(S, u.lane, u.sq)) < 0) F.dry = true; // caught out of the water
      const ch = F.charging[ev.by]; if (ch && ev.t - ch.t < ROUND * 1.5 && ++ch.n >= 3) F.charge3 = true;
      break;
    }
  }
}
function finishBattle(won) {
  if (V.recorded) return; V.recorded = true;
  const F = V.feats || freshFeats();
  const b = HTL.battle(S), md = b.mode && MODES ? { mode: b.mode, waves: MODES.held(S), date: b.date, score: MODES.dailyScore(S), puzzle: b.index, lives: S.lives, theme: b.theme } : {};
  if (b.reverse) { F.slain = {}; F.placed = {}; } // in Reverse the heroes were Simz's, and the slain were yours
  if (S.thrown) md.thrown = Object.assign({}, S.thrown);
  V.result = CAMP.record(camp, Object.assign(md, { battle: S.battle, difficulty: S.difficulty, won, livesLost: S.maxLives - S.lives, goldLeft: S.gold,
    met: Object.keys(F.met), slain: F.slain, placed: F.placed,
    feats: { bards: F.bards, paths: F.paths, crits: F.crits, bosses: F.bosses, charge3: F.charge3, fireball5: F.fireball5, strike: !!F.strike, mown: !!F.mown, dry: !!F.dry } }), today());
  saveCamp();
}
// each battle card shows its monsters lined up on a strip of battle mat
function drawStrips() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  document.querySelectorAll('#overlay .battle').forEach(btn => {
    const b = HTL.battleById(btn.dataset.id), c = btn.querySelector('canvas');
    const w = c.clientWidth, h = c.clientHeight; if (!b || !w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#4c5c54'; g.fillRect(0, 0, w, h);
    const types = b.monsters.slice().sort((x, y) => HTL.MONSTERS[x].level - HTL.MONSTERS[y].level);
    const tallest = Math.max.apply(null, types.map(t => figureSize(t).ht));
    const pad = 8, u = Math.min((h - 10) / tallest, 34), step = (w - pad * 2) / types.length, ground = h - 7;
    g.strokeStyle = 'rgba(230,238,226,.16)'; g.lineWidth = 1; g.beginPath();
    for (let x = pad + step; x < w - pad - 1; x += step) { g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, h); }
    g.stroke();
    types.forEach((t, i) => {
      const sp = TableMinis.sprite(figType(t), u * dpr, figOpts(t)), x = pad + (i + 0.5) * step;
      g.drawImage(sp.cv, x - sp.ax / dpr, ground - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr);
    });
  });
}
/* ---------- the common room: pick the party and the difficulty, with the cats' suggestions ---------- */
const DIFF_KEY = 'mitzsimz.holdTheLine.difficulty';
function loadDiff() { try { const v = localStorage.getItem(DIFF_KEY); return HTL.DIFFICULTY[v] ? v : 'medium'; } catch (e) { return 'medium'; } }
function saveDiff(v) { try { localStorage.setItem(DIFF_KEY, v); } catch (e) { /* not remembered: fine */ } }
function showParty(battleId, from) {
  const o = $('overlay'), b = HTL.battleById(battleId), roster = CAMP.roster(camp), sug = HTL.suggestLoadout(battleId, roster);
  let pick = sug.pick.slice(), diff = b.mode ? 'medium' : loadDiff(); // the modes are played on Medium
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle">' +
    '<span class="eyebrow">' + b.name + (b.map !== 'classic' ? ' · ' + HTL.MAPS[b.map].name : '') + '</span><h2 id="ovTitle">The common room</h2>' +
    '<p class="lede">Pick up to ' + sug.size + ' of the regulars to go down the cellar steps. Mitz and Simz have a few ideas.</p>' + tavernLine() +
    (b.mode ? '<p class="persona"><span>' + b.by + ':</span> ' + b.line + '</p><p class="diff-line" id="diffLine"></p>' :
    '<h3 class="pick">How hard</h3><div class="diff" role="group" aria-label="Difficulty">' +
    Object.keys(HTL.DIFFICULTY).map(k => '<button type="button" data-d="' + k + '">' + HTL.DIFFICULTY[k].name + '</button>').join('') + '</div>' +
    '<p class="diff-line" id="diffLine"></p>') +
    '<h3 class="pick">The party<span class="count" id="partyCount"></span></h3><div class="party">' +
    roster.map((t, i) => '<div class="regwrap' + (canLook(t) ? ' looks' : '') + '"><button type="button" class="regular" data-t="' + t + '"><canvas aria-hidden="true"></canvas><b>' + PACK.heroes[t].name + (camp.equip[t] ? ' · ' + HTL.ITEMS[camp.equip[t]].name : '') +
      ' · ' + PACK.heroes[t].cost + ' gold</b><span>' + (i % 2 ? 'Simz' : 'Mitz') + ': ' + sug.why[t] + '</span></button>' +
      (canLook(t) ? '<button type="button" class="look" data-look="' + t + '"></button>' : '') + '</div>').join('') + '</div>' +
    '<div class="btnrow"><button class="primary" id="btnGo" type="button">Down the cellar steps</button>' +
    '<button class="secondary" id="btnCats" type="button">The cats’ picks</button>' +
    '<button class="secondary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  const sync = () => {
    o.querySelectorAll('.diff button').forEach(x => x.setAttribute('aria-pressed', x.dataset.d === diff ? 'true' : 'false'));
    $('diffLine').textContent = b.mode ? 'Played on Medium, with the tavern’s help.' : HTL.DIFFICULTY[diff].line;
    if ($('tavernLine')) $('tavernLine').classList.toggle('deadly', diff === 'deadly');
    o.querySelectorAll('.regular').forEach(x => x.setAttribute('aria-pressed', pick.indexOf(x.dataset.t) >= 0 ? 'true' : 'false'));
    o.querySelectorAll('.look').forEach(x => { const t = x.dataset.look, her = LOOKS[t] === 'f', n = PACK.heroes[t].name;
      x.textContent = her ? 'Her' : 'Him'; x.title = her ? 'Swap to his figure' : 'Swap to her figure';
      x.setAttribute('aria-label', n + ': ' + (her ? 'her' : 'his') + ' figure. Swap to ' + (her ? 'his' : 'hers')); });
    $('partyCount').textContent = pick.length + ' of ' + sug.size;
    $('btnGo').disabled = !pick.length;
  };
  o.querySelectorAll('.diff button').forEach(x => x.addEventListener('click', () => { diff = x.dataset.d; saveDiff(diff); sync(); }));
  o.querySelectorAll('.regular').forEach(x => x.addEventListener('click', () => {
    const t = x.dataset.t, i = pick.indexOf(t);
    if (i >= 0) pick.splice(i, 1);
    else if (pick.length < sug.size) pick.push(t);
    else { hint('The party is full. Leave someone at the bar first.'); return; }
    sync();
  }));
  o.querySelectorAll('.look').forEach(x => x.addEventListener('click', () => {
    const t = x.dataset.look; CAMP.setLook(camp, t, LOOKS[t] === 'f' ? 'm' : 'f'); saveCamp();
    miniInto(x.parentNode.querySelector('canvas'), t, 40); sync();
  }));
  $('btnCats').addEventListener('click', () => { pick = sug.pick.slice(); sync(); });
  $('btnBack').addEventListener('click', () => (b.mode ? showGames(from) : b.stage === 2 ? showHouse(from) : showCellar(from)));
  let warned = false; // without a Bard nothing earns gold: say so once, then go if they still want to
  $('btnGo').addEventListener('click', () => {
    if (pick.indexOf('bard') < 0 && roster.indexOf('bard') >= 0 && !warned) { warned = true; hint('No Bard in the party: nothing will earn gold but the bounties. Press again to go anyway.', 5000); return; }
    newGame(battleId, true, Object.assign({ difficulty: diff, loadout: HTL.HERO_TYPES.filter(t => pick.indexOf(t) >= 0) }, CAMP.battleOptions(camp)));
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  o.querySelectorAll('.regular canvas').forEach(c => miniInto(c, c.parentNode.dataset.t, 40));
  sync();
  $('btnGo').focus();
}
// sound, motion and every effect that can be switched off; kept in this browser
const SETTINGS = [
  ['sound', 'Sound', 'Dice, clangs and spells, made in the browser. M turns it on and off.'],
  ['reduced', 'Reduced motion', 'Gentler movement and flicker: no screen shake, tumbling dice, paws or lifting.'],
  ['hitstop', 'Hit-stop', 'A beat of stillness when a crit or a heavy blow lands.'],
  ['tumble', 'Tumbling dice', 'A d20 rolls across the mat on crits and the blow that fells a boss.'],
  ['poses', 'Poses', 'Minis lunge, cast or raise a shield as they act, and flinch when they’re hit.'],
  ['bits', 'Hit effects', 'Sparks off armour, bone chips, stone dust, splats and embers.'],
  ['paws', 'Cats tidy up', 'Mitz and Simz take turns swatting fallen monsters off the table.'],
  ['torch', 'Torchlight', 'Flickering torches, moving shadows, and dark crypts and caves.'],
  ['motes', 'Drifting motes', 'Dust, drips, embers, spores, leaves or snow drifting over each battle, to suit where it is.'],
  ['perf', 'Frame timings', 'Frames a second and where the time goes, in the corner of the screen. Handy for a bug report.']
];
const getSet = key => (key === 'reduced' ? calm() : !!SET[key]);
function setSet(key, on) {
  if (key === 'reduced') SET.motion = on ? 'reduced' : 'full'; else SET[key] = on;
  if (key === 'sound') { SND.enabled(on); if (on) { SND.unlock(); SND.play('clack'); } }
  if (key === 'torch' && L) layout(); // a dark battle's floor is part of the board image
  if (key === 'motes') setupMotes();
  saveSettings();
}
function toggleSound() { setSet('sound', !SET.sound); hint(SET.sound ? 'Sound on.' : 'Sound off.', 1400); }
function showSettings(back, atTavern) { // atTavern: the campaign's Export and Import, which never show mid-battle
  const o = $('overlay');
  const row = ([key, label, note]) => '<div class="setrow"><div class="setlab"><b>' + label + '</b><span>' + note + '</span></div>' +
    '<button class="toggle" type="button" data-set="' + key + '" aria-pressed="' + getSet(key) + '" aria-label="' + label + '">' + (getSet(key) ? 'On' : 'Off') + '</button></div>';
  o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">At the table</span><h2 id="ovTitle">Settings</h2>' +
    '<div class="setlist">' + row(SETTINGS[0]) +
    '<div class="setrow"><div class="setlab"><b>Volume</b></div><input id="setVol" type="range" min="0" max="100" step="5" value="' + Math.round(SET.volume * 100) + '" aria-label="Volume"></div>' +
    SETTINGS.slice(1).map(row).join('') + '</div>' +
    (atTavern ? '<div class="setrow camprow"><div class="setlab"><b>Your campaign</b><span>Saved in this browser. Export it to keep a copy, or to carry it to another browser and Import it there.</span>' +
      '<span id="campMsg" role="status"></span></div><div class="btnrow"><button class="secondary" id="btnExport" type="button">Export</button>' +
      '<button class="secondary" id="btnImport" type="button">Import</button><input id="impFile" type="file" accept=".json,application/json,text/plain" hidden></div></div>' : '') +
    '<div class="btnrow"><button class="primary" id="btnBack" type="button">Done</button></div></div>';
  o.hidden = false;
  o.querySelectorAll('.toggle').forEach(b => b.addEventListener('click', () => {
    setSet(b.dataset.set, !getSet(b.dataset.set));
    const on = getSet(b.dataset.set); b.setAttribute('aria-pressed', on); b.textContent = on ? 'On' : 'Off';
  }));
  $('setVol').addEventListener('input', e => { SET.volume = +e.target.value / 100; SND.volume(SET.volume); });
  $('setVol').addEventListener('change', () => { saveSettings(); SND.unlock(); sfx('coin'); });
  $('btnBack').addEventListener('click', back);
  if (atTavern) {
    $('btnExport').addEventListener('click', () => { exportCampaign(); $('campMsg').textContent = 'Exported: look for ' + campFileName() + ' in your downloads.'; });
    $('btnImport').addEventListener('click', () => $('impFile').click());
    $('impFile').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      f.text().then(text => {
        const got = CAMP.importText(text);
        if (got.error) { $('campMsg').textContent = got.error; return; }
        confirmImport(got, back);
      }, () => { $('campMsg').textContent = 'That file couldn’t be opened.'; });
    });
  }
  $('btnBack').focus();
}
// the campaign as a file to download: hold-the-line-campaign-2026-11-12.json
const campFileName = () => 'hold-the-line-campaign-' + today() + '.json';
function exportCampaign() {
  const url = URL.createObjectURL(new Blob([CAMP.exportText(camp, today())], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = campFileName(); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// an imported campaign replaces this browser's only once the player says so; the one it replaces is kept aside first
function confirmImport(got, back) {
  const o = $('overlay');
  o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Import a campaign</span><h2 id="ovTitle">Replace this campaign?</h2>' +
    '<p><b>In this browser now:</b> ' + CAMP.summary(camp) + '.</p>' +
    '<p><b>In the file' + (got.saved ? ', saved ' + got.saved : '') + ':</b> ' + CAMP.summary(got.campaign) + '.</p>' +
    '<p>The campaign here is replaced by the one in the file. Export this one first if you might want it back.</p>' +
    '<div class="btnrow"><button class="primary" id="btnReplace" type="button">Replace it</button><button class="secondary" id="btnKeep" type="button">Keep this one</button></div></div>';
  o.hidden = false;
  $('btnReplace').addEventListener('click', () => {
    try { const st = store(); if (st) st.setItem(CAMP.KEY + '.before-import', JSON.stringify(camp)); } catch (e) { /* full: the import still goes ahead */ }
    camp = got.campaign; LOOKS = camp.looks; saveCamp();
    hint('Campaign imported.', 1800); back();
  });
  $('btnKeep').addEventListener('click', () => showSettings(back, true));
  $('btnKeep').focus();
}

/* Support and links: Pete's standard for every Mitz & Simz game (the roadmap's "Support and links"). Same words everywhere,
   on the credits, one quiet line on the tavern's front screen and the end of a campaign, and never during a battle. */
const LINKS = { kofi: 'https://ko-fi.com/mitznsimz', site: 'https://mitznsimz.co.uk', repo: 'https://github.com/mitznsimz-cpu/mitznsimz-hold-the-line',
  delve: 'https://mitznsimz-cpu.github.io/mitznsimz-dungeon-delve/', tarokk: 'https://mitznsimz-cpu.github.io/mitznsimz-tarokk/',
  tracker: 'https://mitznsimz-cpu.github.io/DnD-Encounter-Tracker/' };
const ext = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
const KOFI_LINE = ext(LINKS.kofi, '☕ Enjoying it? Buy Pete some dice, or Mitz &amp; Simz some treats.');
const SITE_LINK = ext(LINKS.site, '🛡 MitzNSimz.co.uk');
function showCredits(from) {
  const o = $('overlay');
  o.innerHTML = '<div class="panel credits" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Mitz &amp; Simz present</span><h2 id="ovTitle">Credits</h2>' +
    '<p><strong>Mitz &amp; Simz: Hold the Line</strong>, version ' + VERSION + '. Made by Pete at ' + ext(LINKS.site, 'MitzNSimz') + ', Folkestone.</p>' +
    '<p class="support">' + KOFI_LINE + '</p>' +
    '<p>' + SITE_LINK + ': 3D-printed miniatures and tools for Dungeon Masters.</p>' +
    '<p>More from Mitz &amp; Simz: ' + ext(LINKS.delve, 'Dungeon Delve') + ', ' + ext(LINKS.tarokk, 'Tarokk') + ' and the ' + ext(LINKS.tracker, 'D&amp;D Encounter Tracker') + '.</p>' +
    '<p>Found a bug, or had an idea? Tell us on ' + ext(LINKS.repo + '/issues', 'GitHub') + ' or at <a href="mailto:mitznsimz@gmail.com">mitznsimz@gmail.com</a>, and say which version you were playing.</p>' +
    '<p>No ads and no tracking. Your progress is saved in this browser and never leaves it.</p>' +
    '<p>The minis are drawn in code, unpainted, the way they come off the printer. Mitz and Simz supervised.</p>' +
    '<p class="legal">The code is under the MIT licence, on ' + ext(LINKS.repo, 'GitHub') + '. ' +
    'It doesn’t cover Mitz &amp; Simz, their characters, the miniature artwork or the icon, which are © MitzNSimz.</p>' +
    '<p class="legal">This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at ' +
    ext('https://dnd.wizards.com/resources/systems-reference-document', 'https://dnd.wizards.com/resources/systems-reference-document') + '. ' +
    'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at ' +
    ext('https://creativecommons.org/licenses/by/4.0/legalcode', 'https://creativecommons.org/licenses/by/4.0/legalcode') + '.</p>' +
    '<div class="btnrow"><button class="primary" id="btnBack" type="button">Back</button></div></div>';
  o.hidden = false;
  $('btnBack').addEventListener('click', () => showTavern(from));
  $('btnBack').focus();
}
function showPause() {
  const o = $('overlay'), b = HTL.battle(S);
  o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">' + b.name + ' · round ' + S.round + '</span><h2 id="ovTitle">Paused</h2>' +
    '<p class="lede">The minis will wait. Take your time.</p>' +
    '<div class="btnrow"><button class="primary" id="btnResume" type="button">Resume</button>' +
    '<button class="secondary" id="btnRestart" type="button">Restart</button>' +
    '<button class="secondary" id="btnChoose" type="button">Back to the tavern</button>' +
    '<button class="secondary" id="btnSettings" type="button">Settings</button></div></div>';
  o.hidden = false;
  $('btnResume').addEventListener('click', togglePause);
  $('btnSettings').addEventListener('click', () => showSettings(showPause));
  $('btnRestart').addEventListener('click', () => newGame(S.battle, true, lastOpts));
  $('btnChoose').addEventListener('click', () => showTavern('pause'));
  $('btnResume').focus();
}
// what the tavern says about its upgrades, before a battle
function tavernLine() {
  const t = camp.upgrades, bits = [];
  if (t.door) bits.push((t.door === 1 ? 'one more life' : t.door + ' more lives'));
  if (t.till) bits.push(25 * t.till + ' more gold');
  if (t.kitchen) bits.push(t.kitchen === 1 ? 'hearty rests' : 'full rests');
  if (t.training) bits.push(t.training === 1 ? 'the first of each kind at level 2' : 'everyone at level 2');
  return bits.length || Object.keys(camp.equip).length ? '<p class="diff-line" id="tavernLine">' + (bits.length ? '<span class="tl-help">From the tavern: ' + bits.join(', ') + '.</span> ' : '') + '<span class="deadly-note">On Deadly the tavern’s upgrades and the armoury stay behind; only the cats come along.</span></p>' : '';
}
function showEnd(won) {
  const o = $('overlay'), st = S.stats, b = HTL.battle(S), cp = campaignOf(b), next = cp && cp.list[cp.i + 1] ? HTL.battleById(cp.list[cp.i + 1]) : null, r = V.result;
  const mode = b.mode && MODES ? b.mode : null, rm = r && r.mode;
  const held = mode === 'endless' ? MODES.held(S) : 0, score = mode === 'daily' ? MODES.dailyScore(S) : 0;
  const nextPuzzle = mode === 'puzzle' && won && b.index < MODES.PUZZLES.length ? MODES.puzzleId(b.index + 1) : null;
  const line = mode === 'endless' ? 'Held for ' + held + (held === 1 ? ' wave' : ' waves') + (rm && rm.best ? '. That’s a new best.' : '. ' + (camp.modes.endless > held ? 'The best is still ' + camp.modes.endless + '.' : 'Not bad at all.'))
    : mode === 'daily' ? 'Today’s score: ' + score + '. ' + (rm && rm.best ? 'Your best today.' : 'Your best today is still ' + (camp.modes.daily[b.date] || {}).score + '.')
    : mode === 'puzzle' ? (won ? 'That’s the way through.' : 'One got past. Have a think and try again.')
    : mode === 'reverse' ? (won ? 'Fine. Fair play. The drinks are on me.' : 'Told you. Nobody gets past me.')
    : won ? (next || mode ? 'Drinks are on the house. Well, on the Bard.' : cp && cp.house ? 'The whole house is quiet, cellar to rafters. The lodger has moved out, and the drinks are on the house.' : 'That was everything under the tavern. Drinks are on the house, forever.')
          : 'Everyone roll up a new character. Same time next week?';
  let buttons;
  const nextOpen = won && next && CAMP.unlocked(camp, next.id);
  if (mode) buttons = (nextPuzzle ? '<button class="primary" id="btnNext" type="button">Next puzzle</button>' : '') +
    '<button class="' + (nextPuzzle ? 'secondary' : 'primary') + '" id="btnAgain" type="button">' + (mode === 'endless' ? 'Another night' : 'Try again') + '</button>' +
    '<button class="secondary" id="btnGames" type="button">Back to the back room</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
  else if (nextOpen) buttons = '<button class="primary" id="btnNext" type="button">Next: ' + next.name + '</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
  else if (won) buttons = '<button class="primary" id="btnChoose" type="button">Back to the tavern</button><button class="secondary" id="btnAgain" type="button">Play again</button>';
  else buttons = '<button class="primary" id="btnAgain" type="button">Try again</button><button class="secondary" id="btnChoose" type="button">Back to the tavern</button>';
  const gains = [];
  if (r) {
    const pay = r.takings - r.trophies.reduce((n, t) => n + t.reward, 0);
    const why = rm ? (rm.kind === 'reverse' ? 'for taking the tavern' : rm.kind === 'endless' ? 'for ' + rm.waves + (rm.waves === 1 ? ' wave' : ' waves') : rm.kind === 'daily' ? 'for today’s win' : rm.kind === 'rush' ? 'for the Boss Rush' : 'for solving it')
      : won ? (r.best ? 'for the win' : 'for a replay') : 'the cats found all the same';
    if (pay) gains.push('<li><b>' + coins(pay) + '</b> ' + why + '</li>');
    r.trophies.forEach(t => gains.push('<li>Trophy: <b>' + t.name + '</b>' + (t.reward ? ' (+' + t.reward + ')' : '') + '</li>'));
    r.joined.forEach(t => gains.push('<li><b>' + PACK.heroes[t].name + '</b> joins the regulars.</li>'));
    r.items.forEach(id => gains.push('<li>Found: <b>' + HTL.ITEMS[id].name + '</b>. Give it to someone in the armoury.</li>'));
    r.rooms.forEach(id => { const room = CAMP.ROOMS.find(x => x.id === id); if (room) gains.push('<li><b>' + room.name + '</b> is open.</li>'); });
    r.upgrades.forEach(k => { if (!r.rooms.length || k !== 'door' && k !== 'till') gains.push('<li><b>' + CAMP.UPGRADES[k].name + '</b> can be built now.</li>'); });
  }
  o.innerHTML = '<div class="panel" role="dialog" aria-labelledby="ovTitle">' +
    '<span class="eyebrow">' + (mode === 'endless' ? 'Endless' : (won ? 'Victory' : 'Defeat') + ' · ' + b.name) + '</span><h2 id="ovTitle">' +
    (mode === 'endless' ? 'The long night is over' : mode === 'puzzle' ? (won ? 'Solved' : 'Not quite') : mode === 'reverse' ? (won ? 'The tavern is yours' : 'Simz held the tavern') : won ? 'The tavern stands' : 'The tavern has fallen') + '</h2>' +
    (won && r && r.stars ? '<p class="result-stars">' + starRow(r.stars) + (r.best ? '<span>Best yet</span>' : '') + '</p>' : '') +
    '<p class="persona"><span>' + (mode === 'reverse' || !won ? 'Simz' : 'Mitz') + ':</span> ' + line + '</p>' +
    '<div class="tally">' +
    (mode === 'endless' ? '<div><span class="lbl">Waves held</span><b>' + held + '</b></div>' : mode === 'daily' ? '<div><span class="lbl">Score</span><b>' + score + '</b></div>' :
     '<div><span class="lbl">Rounds fought</span><b>' + S.round + '</b></div>') +
    (mode === 'reverse' ? '<div><span class="lbl">Monsters sent</span><b>' + (S.sent || 0) + '</b></div><div><span class="lbl">Lives taken</span><b>' + (S.maxLives - S.lives) + '</b></div>' :
    '<div><span class="lbl">Monsters slain</span><b>' + st.kills + '</b></div>') +
    (mode === 'reverse' ? '' : '<div><span class="lbl">Natural 20s</span><b>' + st.crits + '</b></div>' +
    '<div><span class="lbl">Got through the door</span><b>' + st.leaks + '</b></div>') +
    '</div>' + (gains.length ? '<ul class="gains">' + gains.join('') + '</ul>' : '') + '<div class="btnrow">' + buttons + '</div>' +
    (won && !mode && !next ? '<p class="support-line">' + KOFI_LINE + '</p>' : '') + '</div>';
  o.hidden = false;
  if ($('btnNext')) $('btnNext').addEventListener('click', () => (nextPuzzle ? showPuzzle(nextPuzzle, 'end') : showParty(next.id, 'end')));
  if ($('btnAgain')) $('btnAgain').addEventListener('click', () => newGame(mode === 'endless' ? MODES.endlessId(newSeed()) : b.id, true, Object.assign({}, lastOpts, CAMP.battleOptions(camp))));
  if ($('btnGames')) $('btnGames').addEventListener('click', () => showGames('end'));
  $('btnChoose').addEventListener('click', () => showTavern('end'));
  (($('btnNext') || $('btnAgain') || $('btnChoose'))).focus();
}
function togglePause() {
  if (!started || S.phase !== 'running') return;
  paused = !paused;
  $('btnPause').textContent = paused ? 'Resume' : 'Pause';
  if (paused) { selected = null; updateCards(); closeCard(); showPause(); }
  else { $('overlay').hidden = true; lastTs = performance.now(); }
}

let lastOpts = {};
function eyebrow() {
  const b = HTL.battle(S);
  return 'Mitz & Simz · ' + (b.mode === 'puzzle' ? 'Puzzle ' + b.index + ' · ' : '') + b.name + (b.date ? ' · ' + b.date : '') + (S.difficulty && S.difficulty !== 'medium' ? ' · ' + HTL.DIFFICULTY[S.difficulty].name : '');
}
// the status bar reads differently in Reverse: your purse, and the rounds you have left
function hudLabels() {
  const rev = S.purse != null;
  $('purse').querySelector('.lbl').textContent = rev ? 'Purse' : 'Gold';
  $('waveLbl').textContent = rev ? 'Rounds left' : 'Wave';
}
// the door a tap means: the one in that row, or else the nearest
function doorFor(lane, sq) {
  const ds = HTL.mapOf(S).doors; let best = 0, bd = Infinity;
  ds.forEach((d, i) => { const dist = (d.lane === lane ? 0 : 100 * Math.abs(d.lane - lane)) + Math.abs(d.sq - sq); if (dist < bd) { bd = dist; best = i; } });
  return best;
}
// a puzzle is yours to solve: Simz keeps his paws off
function autoAllowed() {
  const ok = !S.free && S.purse == null; $('btnAuto').disabled = !ok;
  if (!ok && autoOn) { autoOn = false; $('btnAuto').setAttribute('aria-pressed', 'false'); }
}
function newGame(battleId, autostart, opts) {
  lastOpts = opts || {};
  S = HTL.newGame((Math.random() * 4294967295) >>> 0, battleId, lastOpts);
  HERO_ORDER = trayOrder(); buildTray(); buildBelt();
  acc = 0; selected = null; aiming = null; throwing = null; hover = null; lastAutoRound = -1; resetView(); closeCard(); nextKey = '';
  hintQ.length = 0;
  shown.gold = shown.lives = shown.round = -1; shown.wave = -2; shown.phase = '';
  $('toast').hidden = true; $('hint').hidden = true;
  $('battleEye').textContent = eyebrow(); autoAllowed(); hudLabels();
  if (L && (L.map !== HTL.mapOf(S) || L.dark !== isDark())) layout();
  paused = false; $('btnPause').textContent = 'Pause';
  if (autostart) { started = true; $('overlay').hidden = true; lastTs = performance.now(); }
  else { started = false; showTavern(); }
  hud(); updateCards();
}
