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
 * 2026-10-11 (v0.1.15): app.js no longer falls back on built-in durations
 * when app-config.json is missing or invalid. This suite checks that the
 * error is VISIBLE (banner #config-error, "v?" badge) and that actions which
 * need the durations (new match, warm-up timer) are blocked, while a valid
 * config keeps the banner hidden.
 *
 * Run with:  node tests/test_config_error_dom.js   (or: npm run test:config-error)
 */

const { loadApp, version } = require('./dom_harness');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

/** Boot the app with the given harness options and return helpers. */
async function boot(opts) {
  const dom = loadApp(null, opts);
  const win = dom.window;
  const doc = win.document;
  win.__alerts = [];
  win.alert = function (m) { win.__alerts.push(String(m)); };
  await tick(); await tick(); // let loadAppConfig's promise chain settle
  const $ = function (id) { return doc.getElementById(id); };
  return {
    win: win,
    $: $,
    bannerShown: function () { return !$('config-error').classList.contains('hidden'); },
    submit: function () {
      $('form-newmatch').dispatchEvent(
        new win.Event('submit', { bubbles: true, cancelable: true }));
    },
    scoreVisible: function () { return !$('screen-score').classList.contains('hidden'); }
  };
}

async function run() {
  // --- valid config: no banner, match starts --------------------------------
  let a = await boot({});
  ok(!a.bannerShown(), 'valid config: error banner hidden');
  ok(a.$('version').textContent === 'v' + version, 'valid config: version shown');
  a.submit();
  ok(a.scoreVisible(), 'valid config: match starts');
  ok(a.win.__alerts.length === 0, 'valid config: no alert');

  // --- app-config.json unreachable (404) ------------------------------------
  let b = await boot({ configStatus: 404 });
  ok(b.bannerShown(), '404: error banner shown');
  ok(b.$('config-error').textContent.indexOf('HTTP 404') >= 0, '404: banner gives the cause');
  ok(b.$('version').textContent === 'v?', '404: version badge is v?');
  b.submit();
  ok(!b.scoreVisible(), '404: match start blocked');
  ok(b.win.__alerts.length === 1, '404: user alerted on match start');
  b.$('menu-warmup').dispatchEvent(new b.win.Event('click', { bubbles: true }));
  ok(b.win.__alerts.length === 2, '404: warm-up timer blocked too');

  // --- a required key missing (stale / hand-edited file) --------------------
  let c = await boot({ configDrop: ['restSeconds'] });
  ok(c.bannerShown(), 'missing key: error banner shown');
  ok(c.$('config-error').textContent.indexOf('restSeconds') >= 0,
    'missing key: banner names the key');
  c.submit();
  ok(!c.scoreVisible(), 'missing key: match start blocked');

  console.log(fails === 0 ? 'ALL CONFIG-ERROR TESTS PASSED' : fails + ' FAILURE(S)');
  process.exit(fails === 0 ? 0 : 1);
}

run().catch(function (e) { console.log('FAIL: exception', e); process.exit(1); });
