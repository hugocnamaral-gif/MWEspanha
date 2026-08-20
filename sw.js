/* Service worker — Mobilwave Espanha
   Guarda o "esqueleto" da app para instalar e funcionar offline.
   NÃO intercepta chamadas ao Supabase nem POSTs — esses vão sempre à rede. */
const CACHE = 'mw-espanha-v1';
const SHELL = ['./', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () {})
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // deixa passar logins/gravações (POST)
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // deixa passar Supabase, fontes e CDNs
  // mesma origem (app): rede primeiro, cache como reserva (offline)
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
