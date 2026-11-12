// Hold the Line: view/app.js. Input, settings and credits, the main loop (with Frame timings and the board's adaptive sharpness), and boot.
// The view's files are plain scripts that share one scope, loaded in order by index.html (see README, "How it fits together").
'use strict';

/* ---------- input ---------- */
function localPoint(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
cv.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; const p = localPoint(e); hover = squareAt(p.x, p.y); });
cv.addEventListener('pointerleave', () => { hover = null; });
cv.addEventListener('pointerdown', e => {
  if (!started || paused) return;
  const p = localPoint(e), q = squareAt(p.x, p.y);
  if (cardId) closeCard();
  if (!q) { if (selected || aiming || throwing) { selected = null; aiming = null; throwing = null; updateCards(); updatePowers(); updateBelt(); } return; }
  if (throwing) {
    const why = HTL.throwItem(S, throwing, q.lane, q.sq);
    if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); if (THROW_WHY[why]) hint(THROW_WHY[why]); }
    else { throwing = null; dropHint(); }
    updateBelt(); return;
  }
  if (selected && S.purse != null) {
    const door = doorFor(q.lane, q.sq), why = HTL.send(S, selected, door);
    if (why) { if (SEND_WHY[why]) hint(SEND_WHY[why]); }
    if (!affords(selected)) selected = null; // keep sending the same kind while the purse lasts
    updateCards(); return;
  }
  if (aiming) {
    const why = HTL.usePower(S, aiming, q.lane, q.sq);
    if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); if (POWER_WHY[why]) hint(POWER_WHY[why]); }
    else { aiming = null; dropHint(); }
    updatePowers();
    return;
  }
  if (selected) {
    const why = HTL.place(S, selected, q.lane, q.sq);
    if (why) { V.bad.push({ lane: q.lane, sq: q.sq, t0: clock() }); hint(REASONS[why] || 'You can’t place a hero there.'); }
    else { selected = null; updateCards(); }
    return;
  }
  const u = HTL.unitAt(S, q.lane, q.sq), ch = cellAt(q.lane, q.sq);
  if (u) openCard(u);
  else if (ch === 'H' && S.opened && L.map.doorAt && S.opened[L.map.doorAt[q.lane * 100 + q.sq]]) hint('It has burst open. Monsters come up through it now, and nobody can stand on it.', 3600, 'Open trapdoor');
  else if (tipOf(ch)) hint(tipOf(ch)[1], 3600, tipOf(ch)[0]);
  else if (ch === ' ') return;
  else hint('Pick a hero from the tray first.');
});
window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const n = parseInt(e.key, 10);
  if (n >= 0 && n <= 9 && !isNaN(n)) { const t = HERO_ORDER[n === 0 ? 9 : n - 1]; if (t) { selectHero(t); return; } }
  if (e.key === 'm' || e.key === 'M') { toggleSound(); return; }
  if ((e.key === 'i' || e.key === 'I') && SET.perf && typeof createImageBitmap === 'function') { useBitmaps = !useBitmaps; hint(useBitmaps ? 'Drawing from bitmaps.' : 'Drawing from canvases.', 1400); return; }
  if (e.key === 'q' || e.key === 'Q') { aim('pounce'); return; }
  if (e.key === 'w' || e.key === 'W') { aim('swat'); return; }
  if ((e.key === 'g' || e.key === 'G') && S && S.gate) { dropGate(); return; }
  if (e.key === 'Escape') { if (cardId) closeCard(); else if (aiming) { aiming = null; updatePowers(); } else if (selected) { selected = null; updateCards(); } else if (started && paused) togglePause(); return; }
  if ((e.key === 'r' || e.key === 'R') && cardId && !paused) { recallCarded(); return; }
  if ((e.key === ' ' || e.key === 'p' || e.key === 'P') && started && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); togglePause(); }
});
$('btnPause').addEventListener('click', togglePause);
$('pw-pounce').addEventListener('click', () => aim('pounce'));
$('btnGate').addEventListener('click', dropGate);
$('pw-swat').addEventListener('click', () => aim('swat'));
$('btnSpeed').addEventListener('click', () => { speed = speed === 1 ? 2 : 1; $('btnSpeed').textContent = speed + '×'; $('btnSpeed').setAttribute('aria-pressed', speed === 2 ? 'true' : 'false'); });
$('btnDice').addEventListener('click', () => { diceOn = !diceOn; $('btnDice').setAttribute('aria-pressed', diceOn ? 'true' : 'false'); });
$('btnAuto').addEventListener('click', () => {
  autoOn = !autoOn; lastAutoRound = -1;
  $('btnAuto').setAttribute('aria-pressed', autoOn ? 'true' : 'false');
  hint(autoOn ? 'Simz is placing heroes for you. Press Auto again to take over.' : 'Your turn to place the heroes.', 2600);
});

/* ---------- main loop ---------- */
// Frame timings (Settings): how many frames a second, and how long each part of a frame takes, averaged over half a
// second and shown in a corner, so a tester can say where a slow browser spends its time.
const prof = (() => {
  const parts = ['sim', 'wait', 'mat', 'floor', 'routes', 'marks', 'shadows', 'minis', 'effects', 'panels'], sum = {}, el = () => $('perf');
  let t = 0, frames = 0, from = 0, lastFrame = 0, gaps = 0;
  parts.forEach(p => { sum[p] = 0; });
  return {
    start(ts) {
      if (!SET.perf) { if (el()) el().remove(); return; }
      if (lastFrame) gaps += ts - lastFrame; lastFrame = ts; frames++; t = performance.now();
      if (!from) from = ts;
      if (ts - from >= 500) {
        let box = el();
        if (!box) { box = document.createElement('div'); box.id = 'perf'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
        const n = Math.max(1, frames - 1), ms = p => (sum[p] / frames).toFixed(1);
        box.textContent = Math.round(1000 * n / Math.max(1, gaps)) + ' fps · ' + (gaps / n).toFixed(0) + ' ms a frame · board ' + cv.width + '×' + cv.height + ' (' + (L ? L.dpr.toFixed(2) : '?') + '×) · ' + (useBitmaps ? 'bitmaps' : 'canvases') + ' (I)\n' +
          parts.map(p => p + ' ' + ms(p)).join(' · ') + ' ms';
        parts.forEach(p => { sum[p] = 0; }); frames = 0; gaps = 0; from = ts;
      }
    },
    mark(part) {
      if (!SET.perf) return;
      // Safari draws in the background, so a part looks free unless we wait for it: reading back one pixel waits.
      // Only while Frame timings are on.
      if (part !== 'sim' && part !== 'panels' && ctx) try { ctx.getImageData(0, 0, 1, 1); } catch (e) { /* fine */ }
      const now = performance.now(); sum[part] += now - t; t = now;
    }
  };
})();
// Watch the gaps between frames in a battle, a second at a time. If most come slower than about 40 a second, draw the
// board at about the pixels this browser can manage at 50, in one go. A browser holding frames to 30 a second to save
// battery isn't helped by that, so a step there is undone and the board left alone for the rest of the visit.
function keepPace(ts) {
  if (pace.off) return;
  const gap = pace.last ? ts - pace.last : 0; pace.last = ts;
  if (!pace.from) { pace.from = ts; pace.gaps = []; } // a fresh board: the first frames build its minis, so start counting after them
  if (ts - pace.from < 600 && !pace.counting) return;
  if (!pace.counting) { pace.counting = true; pace.from = ts; pace.gaps = []; return; }
  if (gap > 0 && gap < 5000) pace.gaps.push(gap); // a longer gap is the tab waking up, not the drawing
  if (pace.gaps.length < 3 || ts - pace.from < 1000) return; // judge every second of battle (and at least 3 frames)
  pace.from = ts;
  const sorted = pace.gaps.sort((a, b) => a - b), median = sorted[sorted.length >> 1]; pace.gaps = [];
  const capped = m => m > 30 && m < 37; // a browser holding frames to 30 a second to save battery: steady 33 ms
  if (pace.tried) { // did the last step help? Undo it only if frames were held to 30 a second before and after
    const t = pace.tried; pace.tried = null;
    if (capped(t.median) && capped(median)) { pace.off = true; SET.boardPx = t.budget; saveSettings(); layout(); return; }
  }
  if (median <= 24 || L.dpr <= 1.01) return;
  pace.tried = { median, budget: SET.boardPx };
  const f = clamp(20 / median, 0.25, 0.8); // straight to about what this browser can draw at 50 frames a second
  SET.boardPx = Math.max(Math.round(L.W * L.H), Math.round(cv.width * cv.height * f)); saveSettings();
  layout();
}
function frame(ts) {
  const dt = Math.min(0.25, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts; // up to 5 ticks a frame, so a slow browser plays at the right speed, if choppily
  prof.start(ts);
  if (started && !paused) {
    acc += dt * speed;
    while (acc >= TICK) { HTL.step(S, TICK); acc -= TICK; }
    if (autoOn && !S.free && S.purse == null && S.phase === 'running' && S.round !== lastAutoRound) { lastAutoRound = S.round; HTL.autoplay(S); }
  }
  if (S.events.length) { const evs = S.events.splice(0); for (const ev of evs) onEvent(ev); }
  prof.mark('sim');
  // Under a menu the board is still: let what's moving settle for a moment, then stop redrawing it until the menu
  // closes, the battle changes or the window is resized. Redrawing a full-window board behind every menu made them slow.
  const covered = !$('overlay').hidden, key = covered && S && L ? S : null;
  if (!covered) coveredFor = null;
  else if (coveredFor !== key || coveredFor === null) { coveredFor = key; coveredAt = ts; }
  if (!covered && started && !paused && S.phase === 'running') keepPace(ts); else pace.last = 0;
  if (!covered || ts - coveredAt < 1500) {
    const now = clock();
    runImpacts(now);
    draw(now);
    drawTrack(now);
    hud();
    drawCooldowns(now);
    updateCard();
    updateNext();
    updatePowers(); updateBelt();
    prof.mark('panels');
  }
  requestAnimationFrame(frame);
}

let resizeT = 0;
const ro = new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => { layout(); drawTrayMinis(); if (!$('overlay').hidden) { drawStrips(); drawRegulars(); } }, 60); });

function boot(data) {
  resetView();
  if (data && data.S && data.S.v === 4 && HTL.battleById(data.S.battle)) {
    S = data.S; speed = data.speed || 1; diceOn = data.diceOn !== false; started = !!data.started; autoOn = !!data.autoOn; paused = false; acc = 0;
    S.events = []; lastOpts = { difficulty: S.difficulty, loadout: S.loadout };
    if (!S.traps) S.traps = []; // a game saved before traps existed
    if (S.stats && S.stats.sprung == null) S.stats.sprung = 0;
    HERO_ORDER = trayOrder(); buildTray(); buildBelt();
    for (const u of S.units) if (u.alive) addSprite({ id: u.id, kind: u.kind, unitType: u.type, lane: u.lane, sq: u.sq, hp: u.hp, maxHp: u.maxHp, t: S.time }, null).level = u.level || 0;
    $('btnSpeed').textContent = speed + '×'; $('btnSpeed').setAttribute('aria-pressed', speed === 2 ? 'true' : 'false');
    $('btnDice').setAttribute('aria-pressed', diceOn ? 'true' : 'false');
    $('btnAuto').setAttribute('aria-pressed', autoOn ? 'true' : 'false');
    $('battleEye').textContent = eyebrow(); autoAllowed(); hudLabels();
    if (started && S.phase === 'running') $('overlay').hidden = true; else if (!started) showTavern(); else showEnd(S.phase === 'won');
    hud();
  } else newGame(HTL.BATTLES[0].id, false);
  layout();
  ro.observe($('boardWrap'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); drawTrayMinis(); });
  lastTs = performance.now();
  requestAnimationFrame(frame);
}

// For the browser tests (tests/browser.test.js): a read-only look at the view, and a faster clock so a battle can be
// played to the end in seconds. The game itself never uses it.
window.HTL_VIEW = Object.freeze({
  info: () => ({ version: VERSION, webkit: WEBKIT, budget: boardBudget(), board: [cv.width, cv.height], dpr: L ? L.dpr : 0,
    draws: drawCount, sprites: Object.keys(SPR).length, monsterTypes: Object.keys(PACK.monsters).length, adaptOff: !!pace.off,
    phase: S ? S.phase : null, battle: S ? S.battle : null, started, paused, time: S ? S.time : 0,
    motes: motes ? { kind: motes.kind, n: motes.seeds.length } : null,
    lit: { on: !!SET.lit, standing: Object.values(SPR).filter(s => /\|lit$/.test(s.key)).length, poses: [...SPRP.values()].filter(p => p && p.lit).length, waiting: toLight.length } }),
  speed: n => { speed = n; }
});
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) hot.snapshot(() => ({ S: JSON.parse(JSON.stringify(Object.assign({}, S, { events: [] }))), speed, diceOn, started, autoOn }));
if (hot && hot.probe) hot.probe({ gpos, squareAt, state: () => S }); // read-only, for checks run from outside the page
if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});

// Offline and the home screen (sw.js): only on the game's own site, never in a preview frame or from a file on disk
if ('serviceWorker' in navigator && window.isSecureContext && window.top === window && !hot)
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* no offline play here: the game is unaffected */ }); });
