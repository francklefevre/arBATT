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
 *   - version.json is always fetched network-first so a freshly deployed
 *     version number is reflected as soon as the device is online.
 *
 * Bump CACHE_VERSION whenever shipped assets change to invalidate old caches.
 * ---------------------------------------------------------------------------
 */

var CACHE_VERSION = "arbatt-v0_1_6";

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/log.js",
  "./js/timer.js",
  "./js/scorer.js",
  "./js/doubles.js",
  "./js/app.js",
  "./icons/icon.svg",
  "./icons/BATT_Man_2026.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
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
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        return resp;
      });
    })
  );
});
