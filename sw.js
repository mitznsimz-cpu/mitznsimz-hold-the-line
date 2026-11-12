/* Hold the Line: the service worker, so the game can be put on a home screen and played with no connection.
   Network first, always: online, every file comes fresh from the site as it would without this, so an update shows
   on the next load and nobody is left on an old version. Each file that arrives is kept, and offline the kept copy
   is used instead. The game's own files are fetched once when this worker installs, so it works offline after a
   single visit. The fonts are kept the same way once they've loaded; without them the game falls back to the
   system's own fonts. Nothing here touches the save, which lives in the browser's storage. */
'use strict';
const CACHE = 'hold-the-line';
// every file the page loads (the tests check this against index.html)
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'mitznsimz_minis.js', 'motion.js', 'sound.js', 'pack-core.js', 'msdd_materials.js', 'sim.js', 'simz.js', 'modes.js', 'campaign.js',
  'view/core.js', 'view/board.js', 'view/events.js', 'view/draw.js', 'view/motes.js', 'view/floors.js', 'view/plaques.js', 'view/hud.js', 'view/tavern.js', 'view/app.js'];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !(url.origin === self.location.origin || FONTS.test(req.url))) return; // anything else: the browser as usual
  e.respondWith(fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit ||
    (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
