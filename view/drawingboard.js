'use strict';
/* Hold the Line view: Mitz's Drawing Board, the cellar editor. Draw a floor square by square, see the way the monsters
   will walk, and play it. The rules side, the checks and turning a drawing into a battle, is cellars.js; this file is
   the screen. Cellars of your own are kept in this browser, apart from the campaign, and earn nothing in it.
   Opens when the Red Wyrm's Lair is won. */

const CELLARS_KEY = 'mitzsimz.holdTheLine.cellars';
const KC = typeof HTL_CELLARS !== 'undefined' ? HTL_CELLARS : null;
// the cellars drawn in this browser: [{ id, saved, cellar }], newest first
function loadCellars() {
  try { const raw = JSON.parse(localStorage.getItem(CELLARS_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(x => x && { id: String(x.id), saved: String(x.saved || ''), cellar: KC.clean(x.cellar), friend: !!x.friend }).filter(x => x && x.cellar).slice(0, 30) : []; }
  catch (e) { return []; }
}
function saveCellars(list) { try { localStorage.setItem(CELLARS_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { /* full: the drawing stays on screen */ } }
let drawing = null; // { id, cellar } being drawn
const pen = { ch: '#', routes: true };

// the tiles as the board draws them, near enough, so the grid reads like the mat
const TILE_LOOK = { '.': ['#4c5c54', ''], '#': ['#2a2420', '▮'], '~': ['#2f5a6e', '≈'], '^': ['#6b6a48', '▲'], '+': ['#8a7a3a', '✚'], 'o': ['#120e0c', '○'],
  '%': ['#3f5a2a', '♣'], '=': ['#9cc4d8', '≡'], '*': ['#7a2a14', '✱'], 'G': ['#6a4a2a', '⋕'], 'D': ['#a3202a', '⌂'], 'H': ['#5a3a6a', '⊡'], '@': ['#284a5a', '◎'], ' ': ['transparent', ''] };

function showDrawingBoard(from) {
  const o = $('overlay'), list = loadCellars();
  o.innerHTML = '<div class="panel wide" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Mitz’s drawing board</span><h2 id="ovTitle">Cellars of your own</h2>' +
    '<p class="persona"><span>Mitz:</span> The landlord gave me the plans. Draw a cellar, fill it with monsters, and see if it holds. Nothing down here counts for the takings, mind.</p>' +
    (list.length ? '<div class="items cellar-list">' + list.map(x => '<div class="item"><b>' + esc(x.cellar.name) + (x.friend ? ' <em>From a friend</em>' : KC.canShare(x.cellar) ? ' <em>Beaten on Medium</em>' : '') + '</b><span>' +
      x.cellar.rows.length + ' rows by ' + x.cellar.rows[0].length + ', ' + x.cellar.waves.length + (x.cellar.waves.length === 1 ? ' wave' : ' waves') + ', ' +
      (KC.THEMES.find(([k]) => k === x.cellar.theme) || [0, ''])[1].toLowerCase() + (x.saved ? '. ' + (x.friend ? 'Added ' : 'Drawn ') + x.saved : '') + '</span><div class="btnrow">' +
      '<button class="secondary" type="button" data-open="' + x.id + '">' + (x.friend ? 'Play it' : 'Open') + '</button><button class="secondary" type="button" data-del="' + x.id + '">Throw away</button></div></div>').join('') + '</div>'
      : '<p class="diff-line">No cellars yet. Start with a plain floor and draw on it.</p>') +
    '<p class="diff-line" id="impMsg" role="status"></p>' +
    '<div class="btnrow"><button class="primary" id="btnNewCellar" type="button">Draw a new cellar</button><button class="secondary" id="btnImportCellar" type="button">Import a cellar</button>' +
    '<input id="impCellar" type="file" accept=".json,application/json,text/plain" hidden><button class="secondary" id="btnBack" type="button">Back to the tavern</button></div></div>';
  o.hidden = false;
  $('btnNewCellar').addEventListener('click', () => { drawing = { id: 'c' + Date.now().toString(36), cellar: KC.blank() }; keepDrawing(); showEditor(from); });
  $('btnBack').addEventListener('click', () => showTavern(from));
  o.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const x = loadCellars().find(y => y.id === b.dataset.open); if (!x) return;
    drawing = { id: x.id, cellar: x.cellar, friend: !!x.friend };
    if (!x.friend) return showEditor(from);
    const id = KC.play(x.cellar); if (id) showParty(id, 'board'); // a friend's cellar is played as it came, not drawn on
  }));
  $('btnImportCellar').addEventListener('click', () => $('impCellar').click());
  $('impCellar').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    f.text().then(text => {
      const got = KC.importText(text);
      if (got.error) { $('impMsg').textContent = got.error; return; }
      const list = loadCellars(); list.unshift({ id: 'f' + Date.now().toString(36), saved: today(), cellar: got.cellar, friend: true }); saveCellars(list);
      showDrawingBoard(from); $('impMsg').textContent = got.cellar.name + ' is in. Play it from the list.';
    }, () => { $('impMsg').textContent = 'That file couldn’t be opened.'; });
  });
  o.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const x = loadCellars().find(y => y.id === b.dataset.del); if (!x) return;
    b.parentNode.innerHTML = '<span class="diff-line">Throw away ' + esc(x.cellar.name) + '?</span><button class="primary" type="button" data-sure="1">Throw it away</button><button class="secondary" type="button" data-keep="1">Keep it</button>';
    o.querySelector('[data-sure]').addEventListener('click', () => { saveCellars(loadCellars().filter(y => y.id !== x.id)); showDrawingBoard(from); });
    o.querySelector('[data-keep]').addEventListener('click', () => showDrawingBoard(from));
  }));
  $('btnNewCellar').focus();
}
// every change is kept at once: there is no Save to forget
function keepDrawing() {
  const list = loadCellars().filter(x => x.id !== drawing.id);
  list.unshift({ id: drawing.id, saved: today(), cellar: drawing.cellar, friend: !!drawing.friend });
  saveCellars(list);
  if (drawing.friend) return;
  edTrophy('firstPlans');
  if (list.filter(x => !x.friend).length >= 10) edTrophy('masterBuilder');
}
// the editor's trophies: worth no gold, but on the wall all the same
function edTrophy(id) {
  const t = CAMP.cellarTrophy(camp, id, today()); if (!t) return;
  saveCamp(); hint('Trophy: ' + t.name + '. ' + t.text, 3200, 'Trophy');
}
// back from a cellar's battle or party screen: to the drawing, or to the list for a friend's cellar
function cellarBack() { if (drawing && !drawing.friend) showEditor('end'); else showDrawingBoard('end'); }
// a cellar's battle is over: its seals and trophies
function cellarFinished(won) {
  if (!drawing) return;
  const c = drawing.cellar, d = S.difficulty;
  if (drawing.friend) { if (won) edTrophy('guestCellar'); return; }
  if (!won) { edTrophy('petard'); return; }
  edTrophy('proof');
  if (d === 'medium') KC.markBeaten(c, 'you');
  if (d === 'deadly') { KC.markDeadly(c, { you: true }); if (c.deadly.simz === 0) edTrophy('simzStumped'); }
  keepDrawing();
}
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function showEditor(from) {
  const o = $('overlay'), c = drawing.cellar;
  o.innerHTML = '<div class="panel wide editor" role="dialog" aria-labelledby="ovTitle"><span class="eyebrow">Mitz’s drawing board</span>' +
    '<h2 id="ovTitle" class="sr-only">Drawing a cellar</h2><label class="ed-name"><span class="lbl">Name</span><input id="edName" type="text" maxlength="' + KC.LIMITS.name + '" value="' + esc(c.name) + '"></label>' +
    '<div class="ed-wrap"><div class="ed-tavern" aria-hidden="true">Tavern</div><div class="ed-grid" id="edGrid" role="grid" aria-label="The floor: pick a tile below, then tap squares to paint them"></div></div>' +
    '<div class="ed-pal" id="edPal" role="radiogroup" aria-label="Tiles"></div><p class="diff-line" id="edTip"></p>' +
    '<div class="ed-opts">' +
      '<div class="ed-step"><span class="lbl">Rows</span><button class="secondary" type="button" data-rs="-1" aria-label="One row fewer">−</button><b id="edRows"></b><button class="secondary" type="button" data-rs="1" aria-label="One row more">+</button></div>' +
      '<div class="ed-step"><span class="lbl">Length</span><button class="secondary" type="button" data-ls="-1" aria-label="One square shorter">−</button><b id="edLen"></b><button class="secondary" type="button" data-ls="1" aria-label="One square longer">+</button></div>' +
      '<div class="ed-step"><span class="lbl">Gold</span><button class="secondary" type="button" data-gs="-25" aria-label="25 gold less">−</button><b id="edGold"></b><button class="secondary" type="button" data-gs="25" aria-label="25 gold more">+</button></div>' +
      '<label class="ed-step"><span class="lbl">Looks like</span><select id="edTheme">' + KC.THEMES.map(([k, n]) => '<option value="' + k + '"' + (k === c.theme ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<label class="ed-check"><input type="checkbox" id="edForks"' + (c.forks ? ' checked' : '') + '> On a fork, monsters take the way you guard least</label>' +
      '<label class="ed-check"><input type="checkbox" id="edRoutes"' + (pen.routes ? ' checked' : '') + '> Show the ways the monsters walk</label>' +
    '</div><h3 class="pick">Waves</h3><p class="diff-line">Only monsters you have met below can be sent. Rounds count from the start of each wave.</p><div class="ed-waves" id="edWaves"></div>' +
    '<div class="btnrow"><button class="secondary" id="btnAddWave" type="button">Add a wave</button></div>' +
    '<div class="ed-checks" id="edChecks" aria-live="polite"></div>' +
    '<h3 class="pick">Test and share</h3><div class="ed-trial" id="edTrial" aria-live="polite"></div>' +
    '<div class="btnrow"><button class="secondary" id="btnTrial" type="button">Let Simz try it</button><button class="secondary" id="btnExportCellar" type="button">Export it</button></div>' +
    '<p class="diff-line" id="edShare"></p>' +
    '<div class="btnrow"><button class="primary" id="btnPlayCellar" type="button">Play it</button><button class="secondary" id="btnMine" type="button">My cellars</button>' +
    '<button class="secondary" id="btnBack" type="button">Back to the tavern</button></div></div>';
  o.hidden = false;
  const pal = $('edPal');
  pal.innerHTML = KC.TILES.map(t => '<button type="button" role="radio" class="ed-tile" data-ch="' + (t.ch === ' ' ? 'sp' : esc(t.ch)) + '" aria-checked="' + (t.ch === pen.ch) + '">' +
    '<i style="background:' + TILE_LOOK[t.ch][0] + '">' + TILE_LOOK[t.ch][1] + '</i>' + t.name + '</button>').join('');
  pal.querySelectorAll('.ed-tile').forEach(b => b.addEventListener('click', () => { pen.ch = b.dataset.ch === 'sp' ? ' ' : b.dataset.ch; edRefresh(); }));
  o.querySelectorAll('[data-rs],[data-ls]').forEach(b => b.addEventListener('click', () => { KC.resize(c, +(b.dataset.rs || 0), +(b.dataset.ls || 0)); edChanged(); }));
  o.querySelectorAll('[data-gs]').forEach(b => b.addEventListener('click', () => { c.gold = Math.min(KC.LIMITS.gold[1], Math.max(KC.LIMITS.gold[0], c.gold + +b.dataset.gs)); edChanged(); }));
  $('edName').addEventListener('input', e => { c.name = e.target.value.slice(0, KC.LIMITS.name); edChanged(true); });
  $('edTheme').addEventListener('change', e => { c.theme = e.target.value; edChanged(); });
  $('edForks').addEventListener('change', e => { c.forks = e.target.checked; edChanged(); });
  $('edRoutes').addEventListener('change', e => { pen.routes = e.target.checked; edRefresh(); });
  $('btnMine').addEventListener('click', () => showDrawingBoard(from));
  $('btnTrial').addEventListener('click', runTrial);
  $('btnExportCellar').addEventListener('click', () => {
    if (!KC.canShare(c)) { edShare(true); return; }
    const url = URL.createObjectURL(new Blob([KC.exportText(c)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'cellar-' + (c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mine') + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('edShare').textContent = 'Exported: look for ' + a.download + ' in your downloads, and send it to a friend to import in their drawing board.';
  });
  $('btnAddWave').addEventListener('click', () => {
    if (c.waves.length >= KC.LIMITS.waves) return;
    const first = metTypes()[0] || 'goblin';
    c.waves.push({ name: 'Wave ' + (c.waves.length + 1), by: c.waves.length % 2 ? 'Mitz' : 'Simz', line: '', spawns: first + ':0*2' });
    edChanged(); edWaves(); const last = $('edWaves').querySelector('.ed-wave:last-child input'); if (last) last.focus();
  });
  $('btnBack').addEventListener('click', () => showTavern(from));
  $('btnPlayCellar').addEventListener('click', () => {
    const id = KC.play(c, { met: metTypes() });
    if (!id) { edRefresh(); const box = $('edChecks'); box.classList.add('shake'); setTimeout(() => box.classList.remove('shake'), 400); return; } // what stops it, given a shake
    showParty(id, 'board');
  });
  // painting: press and drag across the squares
  const grid = $('edGrid'); let down = false;
  const paintAt = el => { if (!el || !el.dataset.l) return; if (KC.paint(c, +el.dataset.l, +el.dataset.q, pen.ch)) edChanged(); };
  grid.addEventListener('pointerdown', e => { down = true; paintAt(e.target.closest('.ed-sq')); e.preventDefault(); });
  grid.addEventListener('pointermove', e => { if (down) paintAt(document.elementFromPoint(e.clientX, e.clientY)?.closest('.ed-sq')); });
  window.addEventListener('pointerup', () => { down = false; }, { once: false });
  grid.addEventListener('keydown', e => { const el = e.target.closest('.ed-sq'); if (el && (e.key === 'Enter' || e.key === ' ')) { paintAt(el); e.preventDefault(); } });
  edRefresh(); edWaves(); edShare();
  $('edName').focus();
}
// whether it can be shared yet, and why not
function edShare(nudge) {
  const c = drawing.cellar, el = $('edShare'); if (!el) return;
  const ok = KC.canShare(c);
  $('btnExportCellar').setAttribute('aria-disabled', String(!ok));
  el.textContent = ok ? 'Beaten on Medium by ' + (c.beaten.by === 'simz' ? 'Simz' : 'you') + ', so it can be shared: Export it makes a small file for a friend to import.'
    : 'Beat it on Medium, or let Simz beat it, before you share it: nobody wants a cellar that can’t be held.' + (nudge ? ' ' : '');
  if (nudge) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 400); }
}
// Simz plays it five times on each difficulty, a game at a time between frames, and says where it gave
let trialRun = 0;
function runTrial() {
  const c = drawing.cellar, run = ++trialRun, box = $('edTrial'), btn = $('btnTrial');
  if (!KC.play(c, { met: metTypes() })) { edChecks(); box.innerHTML = '<p class="ed-bad">Sort out the problems above first.</p>'; return; }
  const key = KC.layoutKey(c), jobs = [], res = {}, leaks = {};
  for (const d of KC.TRIAL_DIFFS) { res[d] = 0; for (const seed of KC.TRIAL_SEEDS) jobs.push([d, seed]); }
  btn.disabled = true; let done = 0;
  const step = () => {
    if (run !== trialRun || !document.body.contains(box)) return; // left the editor, or started again
    if (KC.layoutKey(c) !== key) { btn.disabled = false; box.innerHTML = '<p class="ed-note">The cellar changed while Simz was playing. Try again.</p>'; return; }
    const [d, seed] = jobs[done], r = KC.trialGame(c, d, seed);
    if (r.won) res[d]++;
    for (const l in r.leaks) leaks[l] = (leaks[l] || 0) + r.leaks[l];
    done++;
    box.innerHTML = '<p class="ed-note">Simz is playing it: game ' + done + ' of ' + jobs.length + '…</p>';
    if (done < jobs.length) { setTimeout(step, 0); return; }
    btn.disabled = false;
    const n = KC.TRIAL_SEEDS.length, worst = Object.keys(leaks).sort((a, b) => leaks[b] - leaks[a])[0];
    if (res.medium) KC.markBeaten(c, 'simz');
    KC.markDeadly(c, { simz: res.deadly });
    if (res.deadly) edTrophy('simzApproves'); else if (c.deadly.you) edTrophy('simzStumped');
    keepDrawing(); edShare();
    box.innerHTML = '<div class="ed-results">' + KC.TRIAL_DIFFS.map(d => '<div><span class="lbl">' + HTL.DIFFICULTY[d].name + '</span><b>' + res[d] + ' of ' + n + '</b></div>').join('') + '</div>' +
      '<p class="persona"><span>Simz:</span> ' + (res.easy === 0 ? 'I couldn’t hold it even on Easy. Is it meant to be fair?' : res.deadly === n ? 'Held it every time, even on Deadly. You could make it nastier.' :
        res.medium === n ? 'Held it every time on Medium.' : res.medium ? 'I held it on Medium, mostly.' : 'It beat me on Medium.') +
      (worst != null ? ' Most got through on row ' + (+worst + 1) + '.' : ' Nothing got through the door.') + '</p>';
  };
  setTimeout(step, 0);
}
// the monsters you have met, easiest first: the only ones a cellar of yours can send
function metTypes() {
  return Object.keys(camp.seen.monsters).filter(t => HTL.MONSTERS[t]).sort((a, b) => HTL.MONSTERS[a].level - HTL.MONSTERS[b].level || HTL.MONSTERS[a].name.localeCompare(HTL.MONSTERS[b].name));
}
// the waves, each a card: its name and line, its monsters (who, which round, how many, which way in), and how hard it is
function edWaves() {
  const c = drawing.cellar, box = $('edWaves'); if (!box) return;
  const met = metTypes(), ways = (c.rows.join('').match(/[DH@]/g) || []).length;
  const opt = (t, sel) => '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + esc(HTL.MONSTERS[t].name) + ' (level ' + HTL.MONSTERS[t].level + ')</option>';
  box.innerHTML = c.waves.map((w, i) => {
    const list = KC.entries(w), th = KC.threat(c, i);
    return '<div class="ed-wave" data-w="' + i + '"><div class="ed-whead"><b>Wave ' + (i + 1) + '</b>' +
      '<button class="secondary" type="button" data-wup="' + i + '" aria-label="Move wave ' + (i + 1) + ' earlier"' + (i ? '' : ' disabled') + '>↑</button>' +
      '<button class="secondary" type="button" data-wdown="' + i + '" aria-label="Move wave ' + (i + 1) + ' later"' + (i < c.waves.length - 1 ? '' : ' disabled') + '>↓</button>' +
      '<button class="secondary" type="button" data-wdel="' + i + '"' + (c.waves.length > 1 ? '' : ' disabled') + '>Remove</button></div>' +
      '<label class="ed-field"><span class="lbl">Name</span><input type="text" maxlength="' + KC.LIMITS.name + '" data-wname="' + i + '" value="' + esc(w.name) + '"></label>' +
      '<label class="ed-field"><span class="lbl">What ' + (w.by || 'Mitz') + ' says</span><input type="text" maxlength="140" data-wline="' + i + '" value="' + esc(w.line || '') + '" placeholder="A warning, a joke, a clue"></label>' +
      '<div class="ed-spawns">' + list.map((e, k) => '<div class="ed-spawn" data-k="' + k + '">' +
        '<select data-f="type" aria-label="Monster">' + (met.indexOf(e.type) < 0 ? opt(e.type, e.type) : '') + met.map(t => opt(t, e.type)).join('') + '</select>' +
        '<span class="ed-mini"><span class="lbl">Round</span><button class="secondary" type="button" data-f="at" data-d="-1" aria-label="A round earlier">−</button><b>' + e.at + '</b><button class="secondary" type="button" data-f="at" data-d="1" aria-label="A round later">+</button></span>' +
        '<span class="ed-mini"><span class="lbl">How many</span><button class="secondary" type="button" data-f="count" data-d="-1" aria-label="One fewer">−</button><b>' + e.count + '</b><button class="secondary" type="button" data-f="count" data-d="1" aria-label="One more">+</button></span>' +
        '<select data-f="door" aria-label="Way in"><option value="">Any way in</option>' + Array.from({ length: Math.max(ways, e.door != null ? e.door + 1 : 0) }, (_, d) => '<option value="' + d + '"' + (e.door === d ? ' selected' : '') + '>Way in ' + (d + 1) + '</option>').join('') + '</select>' +
        '<button class="secondary ed-x" type="button" data-f="del" aria-label="Take this one out">✕</button></div>').join('') + '</div>' +
      '<div class="btnrow"><button class="secondary" type="button" data-wadd="' + i + '">Add a monster</button></div>' +
      (th ? '<p class="ed-threat">About as tough as <b>' + esc(th.like.wave) + '</b> in ' + esc(th.like.battle) + '. ' + th.words + '</p>' : '') + '</div>';
  }).join('');
  const set = (i, list) => { c.waves[i].spawns = KC.spawnsOf(list); edChanged(true); edWaves(); edChecks(); };
  box.querySelectorAll('[data-wname]').forEach(el => el.addEventListener('input', () => { c.waves[+el.dataset.wname].name = el.value; edChanged(true); }));
  box.querySelectorAll('[data-wline]').forEach(el => el.addEventListener('input', () => { c.waves[+el.dataset.wline].line = el.value; edChanged(true); }));
  box.querySelectorAll('[data-wdel]').forEach(el => el.addEventListener('click', () => { c.waves.splice(+el.dataset.wdel, 1); edChanged(true); edWaves(); edChecks(); }));
  box.querySelectorAll('[data-wup],[data-wdown]').forEach(el => el.addEventListener('click', () => {
    const i = +(el.dataset.wup || el.dataset.wdown), j = el.dataset.wup ? i - 1 : i + 1; [c.waves[i], c.waves[j]] = [c.waves[j], c.waves[i]];
    edChanged(true); edWaves(); edChecks();
  }));
  box.querySelectorAll('[data-wadd]').forEach(el => el.addEventListener('click', () => {
    const i = +el.dataset.wadd, list = KC.entries(c.waves[i]), last = list[list.length - 1];
    list.push({ type: last ? last.type : (met[0] || 'goblin'), at: Math.min(KC.MAX_ROUND, last ? last.at + 2 : 0), count: 1, door: null }); set(i, list);
  }));
  box.querySelectorAll('.ed-spawn').forEach(row => {
    const i = +row.closest('.ed-wave').dataset.w, k = +row.dataset.k;
    row.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'click', () => {
      const list = KC.entries(c.waves[i]), e = list[k], f = el.dataset.f;
      if (f === 'del') list.splice(k, 1); // an empty wave is allowed while drawing; the checks say it needs monsters
      else if (f === 'type') e.type = el.value;
      else if (f === 'door') e.door = el.value === '' ? null : +el.value;
      else if (f === 'at') e.at = Math.min(KC.MAX_ROUND, Math.max(0, e.at + +el.dataset.d));
      else if (f === 'count') e.count = Math.min(KC.MAX_COUNT, Math.max(1, e.count + +el.dataset.d));
      set(i, list);
    }));
  });
}
function edChanged(quiet) { keepDrawing(); if (!quiet) edRefresh(); else edChecks(); edShare(); } // a changed cellar must be beaten again to share
function edRefresh() {
  const c = drawing.cellar, grid = $('edGrid'); if (!grid) return;
  const ch = KC.check(c, { met: metTypes() }), onRoute = {};
  if (pen.routes) ch.routes.forEach(r => r.forEach((p, i) => { if (i) onRoute[p.lane * 100 + p.sq] = true; }));
  grid.style.gridTemplateColumns = 'repeat(' + c.rows[0].length + ', var(--ed-sq))';
  grid.innerHTML = c.rows.map((r, l) => [...r].map((t, q) => '<div class="ed-sq' + (t === ' ' ? ' out' : '') + (onRoute[l * 100 + q] ? ' route' : '') + '" role="gridcell" tabindex="0" data-l="' + l + '" data-q="' + q +
    '" style="background:' + TILE_LOOK[t][0] + '" aria-label="Row ' + (l + 1) + ', square ' + (q + 1) + ': ' + KC.TILES.find(x => x.ch === t).name + '">' + TILE_LOOK[t][1] + '</div>').join('')).join('');
  $('edPal').querySelectorAll('.ed-tile').forEach(b => b.setAttribute('aria-checked', String((b.dataset.ch === 'sp' ? ' ' : b.dataset.ch) === pen.ch)));
  const t = KC.TILES.find(x => x.ch === pen.ch); $('edTip').innerHTML = '<b>' + t.name + ':</b> ' + t.tip;
  $('edRows').textContent = c.rows.length; $('edLen').textContent = c.rows[0].length; $('edGold').textContent = c.gold;
  edChecks(ch);
}
function edChecks(ch) {
  ch = ch || KC.check(drawing.cellar, { met: metTypes() });
  $('edChecks').innerHTML = (ch.ok ? '<p class="ed-ok">Ready to play.</p>' : '') +
    ch.problems.map(p => '<p class="ed-bad">' + esc(p) + '</p>').join('') + ch.notes.map(p => '<p class="ed-note">' + esc(p) + '</p>').join('');
}
