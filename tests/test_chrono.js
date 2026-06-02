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
 * Tests for the game chronometry + automatic acceleration trigger.
 * Run with:  node tests/test_chrono.js
 *
 *  - Pure unit tests for shouldAutoAccelerate().
 *  - A jsdom scenario with gameMinutes = 0 so the game clock is "finished"
 *    immediately, proving the auto-acceleration wiring fires; and a default
 *    scenario proving it does NOT fire before the limit.
 */

const { shouldAutoAccelerate } = require('../www/js/timer.js');
const { loadApp } = require('./dom_harness');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}
const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

// --- pure decision ----------------------------------------------------------
ok(shouldAutoAccelerate(true, 10, 18, false) === true,
  'reached + 10<18 + not accel -> auto-accelerate');
ok(shouldAutoAccelerate(true, 18, 18, false) === false,
  '18 points (== threshold) -> no auto-accelerate');
ok(shouldAutoAccelerate(true, 25, 18, false) === false,
  '>= threshold -> no');
ok(shouldAutoAccelerate(false, 4, 18, false) === false,
  'clock not reached -> no');
ok(shouldAutoAccelerate(true, 4, 18, true) === false,
  'already accelerated -> no');

// --- jsdom helpers ----------------------------------------------------------
function controls(dom) {
  const win = dom.window, doc = win.document;
  return {
    win: win, doc: doc,
    $: function (id) { return doc.getElementById(id); },
    visible: function (id) { return !doc.getElementById(id).classList.contains('hidden'); },
    click: function (el) { el.dispatchEvent(new win.Event('click', { bubbles: true })); },
    submit: function () {
      doc.getElementById('form-newmatch').dispatchEvent(
        new win.Event('submit', { bubbles: true, cancelable: true }));
    }
  };
}

async function scenarioAutoAccel() {
  // gameMinutes = 0 -> the game clock is finished as soon as it starts.
  const dom = loadApp({ gameMinutes: 0 });
  const c = controls(dom);
  await tick();
  c.click(c.$('screen-menu').querySelector("[data-target='screen-newmatch']"));
  c.submit(); // start a singles match
  ok(c.visible('accel-panel'),
    'gameMinutes=0: acceleration auto-activates at game start (panel shown)');
  ok(c.$('btn-accel').disabled === true,
    'auto-accel: the Acceleration button is now disabled (already active)');
  dom.window.close();
}

async function scenarioNoAccel() {
  const dom = loadApp(); // default gameMinutes (10)
  const c = controls(dom);
  await tick();
  c.click(c.$('screen-menu').querySelector("[data-target='screen-newmatch']"));
  c.submit();
  ok(c.$('accel-panel').classList.contains('hidden'),
    'default 10 min: no auto-acceleration before the limit');
  ok(c.$('gc-time').textContent === '00:00', 'game clock starts at 00:00');
  ok(c.$('gc-limit').textContent === '/ 10:00', 'game clock shows the 10:00 limit');
  // Pause toggle flips the label.
  c.click(c.$('gc-toggle'));
  ok(c.$('gc-toggle').textContent === '▶', 'game clock pause toggles the label');
  dom.window.close();
}

(async function () {
  await scenarioAutoAccel();
  await scenarioNoAccel();
  console.log(fails === 0 ? '\nALL CHRONO TESTS PASSED'
    : '\n' + fails + ' CHRONO TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
})();
