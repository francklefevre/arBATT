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
 * Shared jsdom test harness. Loads the real www/index.html, evaluates each
 * front-end script ONCE, and lets jsdom fire its own (async) DOMContentLoaded
 * so the page bootstraps exactly once (see the long note in test_ui_dom.js).
 *
 * The default app-config served to the page mirrors config/param.json so the
 * version assertion never needs editing on a bump. Pass `configOverride` to
 * tweak values (e.g. { gameMinutes: 0 }) for a specific scenario.
 *
 * 2026-10-06 (v0.1.12): scoreboard/OBS mode support.
 *  - The page gets an http:// URL: with jsdom's default about:blank origin,
 *    localStorage throws (the studio stores the sheet and channel there).
 *  - fetch() is routed by URL: app-config.json -> config, api/live/_info ->
 *    404 unless `opts.relay` is true, POST api/live/<ch> -> recorded in
 *    window.__livePosts (so tests can inspect what the overlay would get).
 *  - loadOverlay() loads www/scoreboard.html the same way.
 *  - opts.broadcast lends Node's BroadcastChannel to the window.
 *
 * 2026-10-11 (v0.1.15): app.js has no built-in config defaults any more, so
 * the error paths must be testable:
 *  - opts.configStatus: HTTP status served for app-config.json (e.g. 404);
 *  - opts.configDrop: list of keys removed from the served config.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const PARAM = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', 'param.json'), 'utf8'));

// Default client config = EXACTLY what server.py publishes.
// 2026-10-07 (v0.1.14): produced by the single builder (arbatt_config.py
// --print) instead of a hand-written copy of the key list (it had already
// drifted: restSeconds was missing here).
const built = spawnSync('python3', ['arbatt_config.py', '--print'],
  { cwd: ROOT, encoding: 'utf8' });
if (built.status !== 0) {
  throw new Error('arbatt_config.py --print failed: ' + built.stderr);
}
const DEFAULT_CONFIG = JSON.parse(built.stdout);

function jsonResponse(status, obj) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(obj); }
  });
}

/**
 * Load an HTML page of www/ in jsdom, stub fetch, eval its scripts ONCE (in
 * the page's own <script src> order) and return the JSDOM instance.
 */
function loadPage(page, query, configOverride, opts) {
  opts = opts || {};
  const raw = fs.readFileSync(path.join(WWW, page), 'utf8');
  const scripts = [];
  raw.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) {
    scripts.push(src);
    return '';
  });
  const html = raw.replace(/<script src="[^"]+"><\/script>/g, '');

  const dom = new JSDOM(html, {
    url: 'http://localhost/' + page + (query || ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const cfg = Object.assign({}, DEFAULT_CONFIG, configOverride || {});
  (opts.configDrop || []).forEach(function (k) { delete cfg[k]; });
  const cfgStatus = opts.configStatus || 200;
  win.__livePosts = [];
  win.fetch = function (url, init) {
    url = String(url);
    if (url.indexOf('app-config.json') >= 0) {
      return jsonResponse(cfgStatus, cfgStatus === 200 ? cfg : null);
    }
    if (url.indexOf('api/live/_info') >= 0) {
      return opts.relay ? jsonResponse(200, { relay: true, tokenRequired: false })
        : jsonResponse(404, null);
    }
    if (url.indexOf('api/live/') >= 0 && init && init.method === 'POST') {
      win.__livePosts.push(JSON.parse(init.body));
      return jsonResponse(200, { seq: win.__livePosts.length });
    }
    return jsonResponse(404, null);
  };

  // jsdom has no BroadcastChannel: lend Node's one (same process => an app
  // window and an overlay window really talk to each other). unref() so an
  // open channel never keeps the test process alive.
  if (opts.broadcast) {
    win.BroadcastChannel = function (name) {
      const bc = new globalThis.BroadcastChannel(name);
      bc.unref();
      return bc;
    };
  }

  scripts.forEach(function (rel) {
    win.eval(fs.readFileSync(path.join(WWW, rel), 'utf8'));
  });

  return dom;
}

function loadApp(configOverride, opts) {
  return loadPage('index.html', '', configOverride, opts);
}

function loadOverlay(query, opts) {
  return loadPage('scoreboard.html', query, null, opts);
}

module.exports = { loadApp, loadOverlay, version: PARAM.version, DEFAULT_CONFIG };
