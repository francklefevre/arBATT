/*
 * arBATT - Table tennis club referee companion (PWA)
 *
 * Free software: you may do whatever you want with it.
 * Developed by Franck LEFEVRE for K1 ( https://k1info.com ),
 * with the help of his team of kind and playful robots.
 *
 * Please use the enormous power of this software to do good things
 * for things and people, always making sure it harms nothing and no one.
 *
 * ---------------------------------------------------------------------------
 * Service worker: makes arBATT installable and usable fully offline.
 *
 * Strategy:
 *   - App shell assets are pre-cached on install (cache-first afterwards).
 *   - app-config.json is always fetched network-first so a freshly deployed
 *     version number is reflected as soon as the device is online.
 *   - /api/ (live relay of the scoreboard mode) is never intercepted.
 *
 * Bump CACHE_VERSION whenever shipped assets change to invalidate old caches.
 * ---------------------------------------------------------------------------
 */

var CACHE_VERSION = "arbatt-v0_1_18"; // 2026-10-11: bump (free-match history)

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  // 2026-10-07 (v0.1.14): pre-cached so even the very first OFFLINE launch
  // has the version and durations (it is still fetched network-first).
  "./app-config.json",
  "./css/style.css",
  "./js/log.js",
  "./js/timer.js",
  "./js/scorer.js",
  "./js/doubles.js",
  "./js/sheet.js",
  "./js/live.js",
  "./js/studio.js",
  "./js/app.js",
  "./js/scoreboard.js",
  "./scoreboard.html",
  "./css/scoreboard.css",
  "./icons/icon.svg",
  "./icons/BATT_Man_2026.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./media/salle.jpg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) { return caches.delete(k); }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") { return; }

  var url = new URL(req.url);

  // 2026-10-06 (v0.1.12): the live relay (scoreboard/OBS mode) is real-time
  // data, including a never-ending SSE stream: it must NEVER be served from
  // or stored in the cache, so the service worker stays out of the way.
  if (url.pathname.indexOf("/api/") >= 0) { return; }

  // app-config.json: network-first, fall back to cache when offline.
  if (url.pathname.endsWith("/app-config.json")) {
    event.respondWith(
      fetch(req).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        return resp;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // Everything else: cache-first, then network (and cache the result).
  // 2026-10-07 (v0.1.14): lookups IGNORE the query string. The overlay is
  // opened as scoreboard.html?ch=<uuid> (or ?demo=1) while the pre-cached
  // entry is scoreboard.html: an exact match failed and, offline, the page
  // did not open (found by tests/check_offline_chrome.py). For the same
  // reason, responses to URLs WITH a query are not stored (one copy per
  // channel would pile up in the cache).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      return cached || fetch(req).then(function (resp) {
        if (!url.search) {
          var copy = resp.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
