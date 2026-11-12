// Hold the Line: view/hud.js. The battle's panels: the initiative track, the HUD and the hero tray, the belt and the cats' powers, the card for a
// mini on the mat, and the next wave.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

/* ---------- initiative track ---------- */
function drawTrack(now) {
  const dpr = L ? L.dpr : 1, w = tcv.clientWidth, h = tcv.clientHeight;
  if (!w || !h) return;
  setIf(tcv, 'width', Math.round(w * dpr)); setIf(tcv, 'height', Math.round(h * dpr)); // a canvas is cleared by any size write, even to the same size
  const g = tctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = '600 11px ' + UIF; g.fillStyle = '#b8a78a'; g.fillText('ROUND', 0, h / 2 + 1);
  g.font = '700 19px ' + UIF; g.fillStyle = '#f1e7d2'; g.fillText(String(S.round), 44, h / 2 + 1);
  const x0 = 72, x1 = w - 6, ym = h / 2;
  g.fillStyle = '#3a2a20'; g.fillRect(x0, ym - 1, x1 - x0, 2);
  g.fillStyle = '#4b392b'; for (let i = 0; i <= 4; i++) g.fillRect(x0 + (x1 - x0) * i / 4 - 0.5, ym - 4, 1, 8);
  const rs = S.nextRoundAt - ROUND;
  for (const u of S.units) {
    if (!u.alive) continue;
    const f = clamp((u.actAt - rs) / ROUND, 0, 1), x = x0 + f * (x1 - x0), done = u.actedRound >= S.round, hero = u.kind === 'hero';
    g.globalAlpha = done ? 0.32 : 1; g.fillStyle = hero ? '#d4a537' : '#c9353e';
    g.beginPath(); g.arc(x, hero ? ym - 5 : ym + 5, 3, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  if (S.round > 0 && S.phase === 'running') {
    const f = clamp((now - rs) / ROUND, 0, 1), px = x0 + f * (x1 - x0);
    g.fillStyle = '#f1e7d2'; g.fillRect(px - 1, 3, 2, h - 6);
  }
}

/* ---------- HUD, tray, overlays ---------- */
const shown = { gold: -1, lives: -1, wave: -2, phase: '', round: -1 };
function hud() {
  if (S.gate) updateGate();
  const money = S.purse != null ? S.purse : S.gold, rv = HTL.battle(S).reverse;
  if (money !== shown.gold || S.phase !== shown.phase || S.round !== shown.round) {
    $('gold').textContent = money; shown.gold = money; shown.phase = S.phase; shown.round = S.round; updateCards();
    if (rv) $('wave').textContent = Math.max(0, rv.rounds - S.round);
  }
  if (S.lives !== shown.lives) {
    const el = $('lives'); el.innerHTML = '';
    for (let i = 0; i < S.maxLives; i++) { const p = document.createElement('span'); p.className = 'pip' + (i < S.lives ? '' : ' lost'); el.appendChild(p); }
    el.setAttribute('aria-label', 'Tavern lives: ' + S.lives + ' of ' + S.maxLives);
    shown.lives = S.lives;
  }
  if (!rv && S.wave !== shown.wave) { $('wave').textContent = S.wave < 0 ? '–' : (S.wave + 1) + (HTL.battle(S).endless ? '' : '/' + HTL.battle(S).waves.length); shown.wave = S.wave; }
}

function buildTray() {
  const tray = $('tray'); tray.innerHTML = '';
  tray.style.setProperty('--n', HERO_ORDER.length);
  const rev = S && S.purse != null;
  HERO_ORDER.forEach((type, i) => {
    const h = rev ? { name: PACK.monsters[type].name, cost: HTL.sendCost(type), role: HTL.MONSTERS[type].traits.boss ? 'Boss, once only' : 'Level ' + HTL.MONSTERS[type].level } : PACK.heroes[type];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card' + (h.defender ? ' kit' : ''); b.id = 'card-' + type; b.dataset.type = type;
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', h.name + (S && S.free ? '' : ', ' + h.cost + ' gold') + '. ' + h.role + '.');
    b.innerHTML = '<canvas width="88" height="88" aria-hidden="true"></canvas><span class="nm">' + h.name + '</span>' +
      '<span class="meta">' + (S && S.free ? '<span class="left">× ' + S.free[type] + '</span>' : '<span class="coin" aria-hidden="true"></span>' + h.cost) + '<span class="role">· ' + h.role + '</span></span><span class="key">' + (i < 9 ? i + 1 : i === 9 ? 0 : '') + '</span>' +
      (!rev && h.recharge ? '<span class="cool" aria-hidden="true"></span>' : '');
    b.addEventListener('click', () => selectHero(type));
    tray.appendChild(b);
  });
  drawTrayMinis();
}
function drawTrayMinis() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const type of HERO_ORDER) {
    const c = document.querySelector('#card-' + type + ' canvas'); if (!c) continue;
    const css = c.clientWidth || 44; c.width = Math.round(css * dpr); c.height = Math.round(css * dpr);
    const m = TableMinis.render(figType(type), c.width * 0.66, figOpts(type)), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / m.cv.width, c.height / m.cv.height);
    g.drawImage(m.cv, (c.width - m.cv.width * s) / 2, c.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
  }
}
const recharging = type => !!PACK.heroes[type] && !!PACK.heroes[type].recharge && S.round < (S.ready[type] || 0);
// a hero can be placed: enough gold, or in a puzzle, one of them left on the bench
const affords = type => (S.purse != null ? !HTL.canSend(S, type) : S.free ? S.free[type] > 0 : S.gold >= PACK.heroes[type].cost);
function updateCards() {
  if (selected && (!affords(selected) || S.phase !== 'running' || recharging(selected))) selected = null;
  for (const type of HERO_ORDER) {
    const b = $('card-' + type); if (!b) continue;
    if (S.free) { const el = b.querySelector('.left'), t = '× ' + (S.free[type] || 0); if (el && el.textContent !== t) el.textContent = t; }
    setIf(b, 'disabled', !affords(type) || S.phase !== 'running' || recharging(type));
    setAttrIf(b, 'aria-pressed', selected === type ? 'true' : 'false');
  }
}
// the shade over a recharging card drains away as the rounds pass
function drawCooldowns(now) {
  for (const type of HERO_ORDER) {
    const h = PACK.heroes[type]; if (!h || !h.recharge) continue;
    const el = document.querySelector('#card-' + type + ' .cool'); if (!el) continue;
    const roundNow = S.round + clamp((now - (S.nextRoundAt - ROUND)) / ROUND, 0, 1);
    const left = clamp(((S.ready[type] || 0) - roundNow) / h.recharge, 0, 1), v = left.toFixed(2);
    if (el.dataset.cool !== v) { el.dataset.cool = v; el.style.setProperty('--cool', v); } // only when it has visibly moved
  }
}
const SEND_WHY = { closed: 'The rounds are up: no more can be sent.', once: 'Only one boss to a battle.', purse: 'Not enough in the purse yet.', over: 'The battle is over.' };
function selectHero(type) {
  if (!started || paused || S.phase !== 'running') return;
  if (cardId) closeCard();
  if (S.purse != null) { // Reverse: pick a monster to send
    const why = HTL.canSend(S, type);
    if (why) { hint(SEND_WHY[why] || 'That one can’t be sent.'); return; }
    selected = selected === type ? null : type; updateCards();
    if (selected) hint('Tap a door, or any square in its row, to send the ' + PACK.monsters[type].name + ' up the steps.');
    return;
  }
  if (recharging(type)) { const n = S.ready[type] - S.round; hint('The ' + PACK.heroes[type].name + ' is getting their breath back. Ready in ' + n + (n === 1 ? ' round.' : ' rounds.')); return; }
  if (!affords(type)) { hint(S.free ? 'No ' + PACK.heroes[type].name + ' left on the bench.' : 'Not enough gold for a ' + PACK.heroes[type].name + ' yet.'); return; }
  selected = selected === type ? null : type; aiming = null; updatePowers();
  updateCards();
  if (selected) hint('Tap a square on the mat to place your ' + PACK.heroes[type].name + '.');
}

let toastTimer = 0, hintTimer = 0, hintBusy = false;
const hintQ = [];
function toast(eye, title, line) {
  const t = $('toast');
  t.querySelector('.t-eye').textContent = eye; t.querySelector('.t-title').textContent = title; t.querySelector('.t-line').textContent = line;
  t.hidden = false; t.classList.remove('out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('out'); toastTimer = setTimeout(() => { t.hidden = true; }, 380); }, 3800);
}
function hint(text, ms, label) {
  const h = $('hint'); h.textContent = '';
  if (label) { const b = document.createElement('b'); b.className = 'hk'; b.textContent = label; h.appendChild(b); }
  h.appendChild(document.createTextNode(text));
  h.hidden = false; h.classList.remove('out'); hintBusy = true;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    h.classList.add('out');
    hintTimer = setTimeout(() => {
      h.hidden = true; hintBusy = false;
      if (hintQ.length) { const n = hintQ.shift(); hint(n[1], 3600, n[0]); }
    }, 320);
  }, ms || 2200);
}
function dropHint() { // a hint whose job is done fades now rather than waiting out its time
  const h = $('hint'); if (h.hidden) return;
  clearTimeout(hintTimer); h.classList.add('out');
  hintTimer = setTimeout(() => { h.hidden = true; hintBusy = false; if (hintQ.length) { const n = hintQ.shift(); hint(n[1], 3600, n[0]); } }, 320);
}
// new monsters introduce themselves one at a time
function queueHint(label, text) { if (hintBusy) hintQ.push([label, text]); else hint(text, 3600, label); }
const REASONS = { inside: 'That hero is inside a gelatinous cube.', locked: 'That hero stayed at the bar for this battle.', recharging: 'The Barbarian is still getting their breath back.', occupied: 'That square is taken.', off: 'Heroes can’t stand on doors, pillars or pits. Pick an open square.', gold: 'Not enough gold yet.', over: 'The battle is over.', limit: 'None of those left on the bench.' };

/* ---------- the belt in battle: pick a throwable, then a square ---------- */
let throwing = null;
const THROW_WHY = { once: 'One throw a round.', empty: 'None left in the belt.', target: 'Throw it where the monsters are.', occupied: 'Something is already there.', off: 'Not there.' };
function buildBelt() {
  const box = $('belt'); if (!box) return;
  box.innerHTML = ''; box.hidden = !S.belt;
  if (!S.belt) return;
  for (const k in S.belt) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pw th'; b.id = 'th-' + k; b.dataset.kind = k;
    b.title = HTL.THROWS[k].name + ': ' + HTL.THROWS[k].text;
    b.innerHTML = '<b>' + HTL.THROWS[k].name + '</b><span class="pw-cd" id="thn-' + k + '"></span>';
    b.addEventListener('click', () => {
      if (!started || paused || S.phase !== 'running') return;
      const why = HTL.canThrow(S, k, -1, -1); if (why === 'once' || why === 'empty') { hint(THROW_WHY[why]); return; }
      selected = null; aiming = null; throwing = throwing === k ? null : k; updateCards(); updatePowers(); updateBelt();
      if (throwing) hint('Tap a square to throw the ' + HTL.THROWS[k].name.toLowerCase() + '. ' + HTL.THROWS[k].text, 3400); else dropHint();
    });
    box.appendChild(b);
  }
}
function updateBelt() {
  if (!S.belt) return;
  for (const k in S.belt) {
    const b = $('th-' + k); if (!b) continue;
    const n = S.belt[k], t = '× ' + n;
    if ($('thn-' + k).textContent !== t) $('thn-' + k).textContent = t;
    setIf(b, 'disabled', !n || S.phase !== 'running' || S.thrownRound === S.round);
    setAttrIf(b, 'aria-pressed', throwing === k ? 'true' : 'false');
  }
}

// the panels are refreshed every frame; touching the page only when something changed keeps the browser from
// restyling and repainting them sixty times a second
function setIf(el, prop, v) { if (el[prop] !== v) el[prop] = v; }
function setAttrIf(el, name, v) { if (el.getAttribute(name) !== v) el.setAttribute(name, v); }
/* ---------- the cats' powers in battle ---------- */
let aiming = null;
const POWER_WHY = { cooldown: 'Not ready yet.', target: 'Nothing there to pounce on.', boss: 'Not even Simz can shift the boss.', none: '', over: '' };
function aim(k) {
  if (!started || paused || S.phase !== 'running' || !S.powers || !S.powers[k]) return;
  const left = S.powers[k].ready - S.round;
  if (left > 0) { hint((k === 'pounce' ? 'Mitz' : 'Simz') + ' is ready in ' + left + (left === 1 ? ' round.' : ' rounds.')); return; }
  if (cardId) closeCard();
  selected = null; aiming = aiming === k ? null : k; updateCards(); updatePowers();
  if (!aiming) dropHint();
  else hint(k === 'pounce' ? 'Tap a square: Mitz pounces on every monster in the 3 × 3 around it.' : 'Tap a monster: Simz swats it off the table. Not the boss.', 3200);
}
// the yard gate: one drop a battle, shut for a few rounds
const GATE_WHY = { none: 'There is no gate here.', over: 'The battle is over.', used: 'The gate has been dropped once already this battle.', blocked: 'Something is standing in the gateway.' };
function updateGate() {
  const box = $('gatebox'); if (!box) return;
  const has = !!(S && L && L.map.gate && S.gate);
  if (box.hidden !== !has) box.hidden = !has;
  if (!has) return;
  const label = S.gate.until ? 'shut · ' + Math.max(0, S.gate.until - S.round) : S.gate.used ? 'used' : 'ready';
  if ($('cd-gate').textContent !== label) $('cd-gate').textContent = label;
  const off = !!HTL.canShutGate(S);
  if ($('btnGate').disabled !== off) $('btnGate').disabled = off;
}
function dropGate() {
  if (!S || !S.gate) return;
  const why = HTL.shutGate(S);
  if (why) { hint(GATE_WHY[why] || 'Not now.'); return; }
  updateGate();
}
function updatePowers() {
  updateGate();
  const box = $('cats'); if (!box) return;
  setIf(box, 'hidden', !(S && S.powers));
  if (box.hidden) return;
  for (const k in S.powers) {
    const b = $('pw-' + k), left = Math.max(0, S.powers[k].ready - S.round);
    setIf(b, 'disabled', S.phase !== 'running' || left > 0);
    setAttrIf(b, 'aria-pressed', aiming === k ? 'true' : 'false');
    if (b.classList.contains('duty') !== (HTL.POWERS[k].cat === S.duty)) b.classList.toggle('duty', HTL.POWERS[k].cat === S.duty);
    const cd = left ? 'in ' + left : 'ready';
    if ($('cd-' + k).textContent !== cd) $('cd-' + k).textContent = cd;
  }
}
// which edge of the table a paw comes from: the nearer of the two along the rows
function edgeFor(lane, sq) {
  const c = L.cell, g = gpos(lane, sq), m = matRect();
  if (L.horiz) { const up = g.y - m.y, down = m.y + m.h - g.y; return up <= down ? { ex: 0, ey: -1, reach: up / c + 1.1 } : { ex: 0, ey: 1, reach: down / c + 1.1 }; }
  const left = g.x - m.x, right = m.x + m.w - g.x; return left <= right ? { ex: -1, ey: 0, reach: left / c + 1.1 } : { ex: 1, ey: 0, reach: right / c + 1.1 };
}
function onPounce(ev) {
  const e = edgeFor(ev.lane, ev.sq), t0 = ev.t, hit = t0 + (calm() ? 0 : 0.28);
  if (!calm()) V.fx.push({ k: 'paw', t0, dur: 0.7, lane: ev.lane, sq: ev.sq, ex: e.ex, ey: e.ey, reach: e.reach, fur: '#151316', rim: '#57525e' });
  catTag('Mitz', ev.lane, ev.sq, e.ex, e.ey, t0, 0.9); // Pounce is Mitz's
  V.impacts.push({ at: hit, fn: () => { sfx('thump'); sfx('swat', 0.6); shake(0.6); } });
  V.pops.push({ t0: hit, lane: ev.lane, sq: ev.sq, ht: 0.6, kind: 'label', text: 'POUNCE', col: '#e8dcc6', slot: -1 });
  for (const id of ev.ids) { const sp = V.sprites.get(id); if (sp) { if (!calm()) sp.anims.push({ k: 'wobble', t0: hit, dur: 0.5 }); V.impacts.push({ at: hit, fn: () => { sp.stunned = true; } }); } }
}
function onSwat(ev) {
  const sp = V.sprites.get(ev.id); if (!sp) return;
  const e = edgeFor(sp.lane, sp.sq), t0 = ev.t, contact = t0 + 0.4;
  sp.dead = true; sp.swatted = true;
  catTag('Simz', sp.lane, sp.sq, e.ex, e.ey, t0, 1.0); // Swat is Simz's
  if (calm()) { sp.anims.push({ k: 'fade', t0: contact, dur: 0.5, persist: true }); sp.removeAt = contact + 0.5; }
  else {
    V.fx.push({ k: 'paw', t0, dur: 1.0, lane: sp.lane, sq: sp.sq, ex: e.ex, ey: e.ey, reach: e.reach, fur: '#151316', rim: '#57525e' });
    sp.anims.push({ k: 'swat', t0: contact, dur: 0.6, vx: e.ex, vy: e.ey, dist: e.reach, dir: sp.id % 2 ? 1 : -1, persist: true });
    sp.removeAt = t0 + 1.0;
  }
  V.pops.push({ t0: contact, lane: sp.lane, sq: sp.sq, ht: 0.5, kind: 'label', text: 'SWAT', col: '#e8dcc6', slot: -1 });
  V.impacts.push({ at: contact, fn: () => { sfx('swat'); const b = V.bounty[sp.id]; if (b) { spawnCoins(sp.lane, sp.sq, b >= 20 ? 3 : b >= 10 ? 2 : 1, contact); delete V.bounty[sp.id]; } } });
}
function drawAim() {
  if ((!aiming && !throwing) || !hover || !started || paused) return;
  const sq = (l, q, col) => { if (l < 0 || q < 0 || l >= L.MH || q >= L.MW) return; const r = sqRect(l, q); ctx.fillStyle = col; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); };
  if (throwing) { sq(hover.lane, hover.sq, 'rgba(240,205,110,.32)'); return; }
  if (aiming === 'pounce') { for (let l = -1; l <= 1; l++) for (let q = -1; q <= 1; q++) sq(hover.lane + l, hover.sq + q, 'rgba(240,205,110,.22)'); }
  else { const m = HTL.unitAt(S, hover.lane, hover.sq); sq(hover.lane, hover.sq, m && m.kind === 'monster' ? ((HTL.MONSTERS[m.type].traits || {}).boss ? 'rgba(201,53,62,.35)' : 'rgba(240,205,110,.3)') : 'rgba(241,231,210,.12)'); }
}

/* ---------- the card for a mini on the mat: what it is, how it's doing, and Recall for heroes ---------- */
let cardId = 0, cardLevel = 0;
function openCard(u) {
  const hero = u.kind === 'hero', info = hero ? PACK.heroes[u.type] : PACK.monsters[u.type], ally = hero && info.ally;
  const path = hero && u.path ? HTL.PATHS[u.type][u.path] : null;
  cardId = u.id; cardLevel = u.level || 0;
  $('uName').textContent = info.name + (hero && !ally ? ' · level ' + u.level + (path ? ' · ' + path.name : '') : hero ? ' · ' + info.role : ' · level ' + info.level);
  $('uDesc').textContent = HTL.describe(u.type) + (path ? ' ' + path.rule : '') + (u.item ? ' Carries the ' + HTL.ITEMS[u.item].name + ': ' + HTL.ITEMS[u.item].text.charAt(0).toLowerCase() + HTL.ITEMS[u.item].text.slice(1) : '');
  $('uPaths').hidden = true; $('uButtons').hidden = false;
  const b = $('btnRecall'); b.hidden = !hero || ally;
  if (hero && !ally) b.textContent = 'Recall for ' + HTL.refundOf(u) + ' gold';
  $('btnLevel').hidden = !hero || ally || HTL.upgradeCost(u) == null;
  const cvs = $('unitCard').querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cvs.width = cvs.height = Math.round(46 * dpr);
  const m = TableMinis.render(figType(u.type), cvs.width * 0.7, figOpts(u.type)), g = cvs.getContext('2d'), s = Math.min(cvs.width / m.cv.width, cvs.height / m.cv.height);
  g.clearRect(0, 0, cvs.width, cvs.height);
  g.drawImage(m.cv, (cvs.width - m.cv.width * s) / 2, cvs.height - m.cv.height * s, m.cv.width * s, m.cv.height * s);
  $('hint').hidden = true;
  $('unitCard').hidden = false;
  updateCard();
}
function updateCard() {
  if (!cardId) return;
  const u = S.units.find(x => x.id === cardId && x.alive);
  if (!u || S.phase !== 'running' || !started) { closeCard(); return; }
  const bits = ['HP ' + u.hp + '/' + u.maxHp, 'AC ' + u.ac];
  for (const k in u.status) if (u.status[k] > 0 && HTL.STATUSES[k]) bits.push(HTL.STATUSES[k].word.toLowerCase());
  if (u.kind === 'hero' && cellAt(u.lane, u.sq) === '^') bits.push('+2 to hit up here');
  const txt = bits.join(' · ');
  if ($('uStats').textContent !== txt) $('uStats').textContent = txt;
  if (u.kind === 'hero' && u.level !== cardLevel) { openCard(u); return; }
  const cost = u.kind === 'hero' ? HTL.upgradeCost(u) : null;
  if (cost != null) {
    const lt = 'Level ' + (u.level + 1) + ' for ' + cost + ' gold';
    if ($('btnLevel').textContent !== lt) $('btnLevel').textContent = lt;
    $('btnLevel').disabled = S.gold < cost;
    $('uPaths').querySelectorAll('.path').forEach(p => { p.disabled = S.gold < cost; });
  }
}
// level 2 is one tap; level 3 asks which path
function levelCarded() {
  const u = S.units.find(x => x.id === cardId && x.alive); if (!u) return;
  if (u.level === 1) { const why = HTL.levelUp(S, u.id); if (why === 'gold') hint('Not enough gold for that yet.'); return; }
  const paths = HTL.PATHS[u.type], cost = HTL.upgradeCost(u), box = $('uPaths');
  box.innerHTML = '';
  for (const key of Object.keys(paths)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'path'; b.disabled = S.gold < cost;
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = paths[key].name;
    b.querySelector('span').textContent = paths[key].rule;
    b.setAttribute('aria-label', paths[key].name + ' for ' + cost + ' gold. ' + paths[key].rule);
    b.addEventListener('click', () => { if (!HTL.levelUp(S, u.id, key)) closeCard(); });
    box.appendChild(b);
  }
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'secondary'; back.textContent = 'Back';
  back.addEventListener('click', () => openCard(u));
  box.appendChild(back);
  $('uButtons').hidden = true; box.hidden = false;
  box.querySelector('.path').focus();
}
function closeCard() { cardId = 0; $('unitCard').hidden = true; }
function recallCarded() {
  const u = S.units.find(x => x.id === cardId && x.alive); if (!u || u.kind !== 'hero') return;
  const name = PACK.heroes[u.type].name, refund = HTL.refundOf(u);
  if (!HTL.recall(S, u.id)) { closeCard(); hint('The ' + name + ' heads back to the tavern. ' + refund + ' gold back in the purse.'); }
}
$('btnRecall').addEventListener('click', recallCarded);
$('btnLevel').addEventListener('click', levelCarded);
$('btnUnitClose').addEventListener('click', closeCard);

/* ---------- the next wave, shown in the HUD between waves ---------- */
let nextKey = '';
function updateNext() {
  const pv = started && S.phase === 'running' ? HTL.preview(S) : null, el = $('next');
  if (!pv) { if (!el.hidden) { el.hidden = true; nextKey = ''; } return; }
  const key = S.battle + ':' + pv.index + ':' + pv.rounds;
  if (key === nextKey) return;
  const drawStrip = !nextKey || nextKey.split(':')[1] !== String(pv.index) || el.hidden;
  nextKey = key; el.hidden = false;
  const r = pv.rounds;
  $('nextLbl').textContent = r > 0 ? 'Next wave · ' + r + (r === 1 ? ' round' : ' rounds') : 'Next wave';
  const types = Object.keys(pv.counts).sort((x, y) => HTL.MONSTERS[x].level - HTL.MONSTERS[y].level);
  $('nextText').textContent = 'Wave ' + (pv.index + 1) + ', ' + pv.name + ', in ' + r + ' rounds: ' + types.map(ty => pv.counts[ty] + ' ' + HTL.MONSTERS[ty].name).join(', ') + '.';
  if (drawStrip) drawNextStrip(types, pv.counts);
}
function drawNextStrip(types, counts) {
  const c = $('nextStrip'), dpr = Math.min(window.devicePixelRatio || 1, 2.5), slot = 30, h = 28;
  const w = Math.max(30, types.length * slot);
  c.style.width = w + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const tallest = Math.max.apply(null, types.map(ty => figureSize(ty).ht)), u = Math.min((h - 2) / tallest, 22);
  types.forEach((ty, i) => {
    const sp = TableMinis.sprite(figType(ty), u * dpr, figOpts(ty)), x = (i + 0.42) * slot;
    g.drawImage(sp.cv, x - sp.ax / dpr, h - 3 - sp.ay / dpr, sp.cv.width / dpr, sp.cv.height / dpr);
    g.font = '700 11px ' + UIF; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.lineWidth = 3; g.strokeStyle = '#2a1d16'; g.strokeText('×' + counts[ty], (i + 1) * slot - 1, h - 1);
    g.fillStyle = '#f0cd6e'; g.fillText('×' + counts[ty], (i + 1) * slot - 1, h - 1);
  });
}
