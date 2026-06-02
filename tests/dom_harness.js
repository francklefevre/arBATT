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
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const PARAM = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config', 'param.json'), 'utf8'));

// Default client config = what server.py would publish from param.json.
const DEFAULT_CONFIG = {
  version: PARAM.version,
  warmupSeconds: PARAM.ARBATT_WARMUP_SECONDS,
  timeoutSeconds: PARAM.ARBATT_TIMEOUT_SECONDS,
  accelReturns: PARAM.ARBATT_ACCEL_RETURNS,
  gameMinutes: PARAM.ARBATT_GAME_MINUTES,
  accelPointsThreshold: PARAM.ARBATT_ACCEL_POINTS_THRESHOLD
};

function loadApp(configOverride) {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
    .replace(/<script src="[^"]+"><\/script>/g, '');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const cfg = Object.assign({}, DEFAULT_CONFIG, configOverride || {});
  win.fetch = function () {
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve(cfg); }
    });
  };

  ['js/log.js', 'js/timer.js', 'js/scorer.js', 'js/doubles.js', 'js/app.js']
    .forEach(function (rel) {
      win.eval(fs.readFileSync(path.join(WWW, rel), 'utf8'));
    });

  return dom;
}

module.exports = { loadApp, version: PARAM.version, DEFAULT_CONFIG };
