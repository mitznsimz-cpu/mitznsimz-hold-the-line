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
    return Array.isArray(raw) ? raw.map(x => x && { id: String(x.id), saved: String(x.saved || ''), cellar: KC.clean(x.cellar) }).filter(x => x && x.cellar).slice(0, 30) : []; }
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
    (list.length ? '<div class="items cellar-list">' + list.map(x => '<div class="item"><b>' + esc(x.cellar.name) + '</b><span>' + x.cellar.rows.length + ' rows by ' + x.cellar.rows[0].length +
      ', ' + (KC.THEMES.find(([k]) => k === x.cellar.theme) || [0, ''])[1].toLowerCase() + (x.saved ? '. Drawn ' + x.saved : '') + '</span><div class="btnrow">' +
      '<button class="secondary" type="button" data-open="' + x.id + '">Open</button><button class="secondary" type="button" data-del="' + x.id + '">Throw away</button></div></div>').join('') + '</div>'
      : '<p class="diff-line">No cellars yet. Start with a plain floor and draw on it.</p>') +
    '<div class="btnrow"><button class="primary" id="btnNewCellar" type="button">Draw a new cellar</button><button class="secondary" id="btnBack" type="button">Back to the tavern</button></div></div>';
  o.hidden = false;
  $('btnNewCellar').addEventListener('click', () => { drawing = { id: 'c' + Date.now().toString(36), cellar: KC.blank() }; keepDrawing(); showEditor(from); });
  $('btnBack').addEventListener('click', () => showTavern(from));
  o.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const x = loadCellars().find(y => y.id === b.dataset.open); if (x) { drawing = { id: x.id, cellar: x.cellar }; showEditor(from); } }));
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
  list.unshift({ id: drawing.id, saved: today(), cellar: drawing.cellar });
  saveCellars(list);
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
    '</div><div class="ed-checks" id="edChecks" aria-live="polite"></div>' +
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
  $('btnBack').addEventListener('click', () => showTavern(from));
  $('btnPlayCellar').addEventListener('click', () => {
    const id = KC.play(c);
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
  edRefresh();
  $('edName').focus();
}
function edChanged(quiet) { keepDrawing(); if (!quiet) edRefresh(); else edChecks(); }
function edRefresh() {
  const c = drawing.cellar, grid = $('edGrid'); if (!grid) return;
  const ch = KC.check(c), onRoute = {};
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
  ch = ch || KC.check(drawing.cellar);
  $('edChecks').innerHTML = (ch.ok ? '<p class="ed-ok">Ready to play. For now every cellar meets two waves from the Warren; the wave builder comes next.</p>' : '') +
    ch.problems.map(p => '<p class="ed-bad">' + esc(p) + '</p>').join('') + ch.notes.map(p => '<p class="ed-note">' + esc(p) + '</p>').join('');
}
