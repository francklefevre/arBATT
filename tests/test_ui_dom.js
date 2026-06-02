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
 * Headless DOM integration tests (jsdom). Loads the real index.html, evaluates
 * each front-end script ONCE in the window, then lets jsdom's own (async)
 * DOMContentLoaded fire the page bootstrap exactly once. It then drives the UI
 * like a user (form submit, card taps, radio change) and asserts the
 * scoreboard updates.
 *
 * Two subtleties learned the hard way:
 *  - jsdom fires DOMContentLoaded ASYNCHRONOUSLY after construction. We must
 *    eval the scripts synchronously right after `new JSDOM` so the bootstrap
 *    listener is registered before that event fires — and we must NOT dispatch
 *    DOMContentLoaded ourselves, or bootstrap would run twice (binding every
 *    handler twice, e.g. one tap counting as two points).
 *  - We strip the page's <script src> tags and eval the files ourselves so the
 *    scripts run exactly once.
 *
 * Run with:  node tests/test_ui_dom.js   (or: npm run test:ui)
 */

const { loadApp, version } = require('./dom_harness');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

async function run() {
  const dom = loadApp();
  const win = dom.window;
  const doc = win.document;
  const $ = function (id) { return doc.getElementById(id); };
  const visible = function (id) { return !$(id).classList.contains('hidden'); };
  const click = function (el) {
    el.dispatchEvent(new win.Event('click', { bubbles: true }));
  };
  const setRadio = function (el) {
    el.checked = true;
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const submit = function () {
    $('form-newmatch').dispatchEvent(
      new win.Event('submit', { bubbles: true, cancelable: true }));
  };

  await tick(); // let loadAppConfig's promise resolve

  // --- boot ---------------------------------------------------------------
  ok(visible('screen-menu'), 'menu screen visible at boot');
  ok($('version').textContent === 'v' + version, 'version banner from app-config');
  ok($('firstServer').options.length === 2, 'singles toss has 2 server options');

  // --- "période d'adaptation" rename + "déroulé de la partie" screen -------
  ok($('menu-warmup').textContent.indexOf("adaptation") >= 0,
    'warm-up menu item renamed to période d\'adaptation');
  click($('screen-menu').querySelector("[data-target='screen-flow']"));
  ok(visible('screen-flow'), 'match-flow screen shown from the menu');
  ok(doc.querySelectorAll('#screen-flow .flow-step').length === 9,
    'match-flow lists the 9 steps');
  ok(doc.querySelectorAll('#screen-flow .remember').length === 9,
    'every flow step has a "ne dois pas oublier" box');
  click($('screen-flow').querySelector("[data-target='screen-menu']"));
  ok(visible('screen-menu'), 'back to menu from the flow screen');

  // ============================ SINGLES ===================================
  click($('screen-menu').querySelector("[data-target='screen-newmatch']"));
  ok(visible('screen-newmatch'), 'setup screen shown');
  ok(visible('names-singles') && !visible('names-doubles'),
    'singles names shown, doubles hidden');

  $('nameA').value = 'Alice';
  $('nameB').value = 'Bob';
  $('nameA').dispatchEvent(new win.Event('input', { bubbles: true }));

  submit();
  ok(visible('screen-score'), 'scoreboard shown after start');
  ok($('name-0').textContent === 'Alice', 'card 0 shows Alice');
  ok($('card-0').classList.contains('serving'), 'Alice serves first (toss)');
  ok(!$('service-info').classList.contains('hidden') &&
     $('service-info').textContent.indexOf('Service') === 0,
    'single service line shown in singles');
  ok($('sets-summary').classList.contains('hidden'), 'sets summary hidden at match start');

  click($('card-0'));
  ok($('points-0').textContent === '1', 'singles: point registered (1)');
  ok(!$('btn-undo').disabled, 'undo enabled after a point');
  ok($('announce').textContent.trim() === '1 - 0', 'announce shows the score only');
  ok($('service-info').textContent === 'Service : Alice',
    'server stated once on the service line');

  click($('btn-undo'));
  ok($('points-0').textContent === '0', 'undo brings score back to 0');

  // Quick full game: 11 points to Alice ends game 1 (1-0 in games).
  for (let i = 0; i < 11; i++) { click($('card-0')); }
  ok($('games-0').textContent === '1', 'singles: game won at 11');
  ok($('points-0').textContent === '0', 'singles: points reset for game 2');
  ok($('card-1').classList.contains('serving'), 'first server alternates in game 2');

  // Past game score is now summarised, and the 1-minute rest auto-opens.
  ok(!$('sets-summary').classList.contains('hidden'), 'sets summary shown after a game');
  ok($('sets-summary').textContent.replace(/\s/g, '') === '11-0',
    'sets summary shows 11-0');
  ok(!$('timer-overlay').classList.contains('hidden'), 'between-games rest auto-opens');
  ok($('timer-title').textContent.indexOf('Repos') === 0, 'rest overlay titled "Repos"');
  click($('timer-close'));
  ok($('timer-overlay').classList.contains('hidden'), 'rest overlay closes');

  // ============================ DOUBLES ===================================
  click($('btn-quit'));
  click($('screen-menu').querySelector("[data-target='screen-newmatch']"));
  setRadio(doc.querySelector("input[name=mode][value=doubles]"));
  ok(visible('names-doubles') && !visible('names-singles'),
    'doubles names shown, singles hidden');
  ok(visible('row-firstReceiver'), 'first receiver row shown in doubles');
  ok($('firstServer').options.length === 4, 'firstServer lists 4 players');
  ok($('firstReceiver').options.length === 2, 'firstReceiver lists 2 players');

  submit();
  ok(visible('screen-score'), 'doubles scoreboard shown');
  ok($('name-0').textContent.indexOf('/') > 0, 'card shows a pair (with /)');
  ok(!$('service-info').classList.contains('hidden'), 'service line visible in doubles');
  ok($('service-info').textContent.indexOf('Service') === 0, 'service line present');
  ok(!$('btn-service').classList.contains('hidden'), 'service button visible in doubles');

  click($('card-0'));
  ok($('points-0').textContent === '1', 'doubles: team point registered');

  // Win game 1 for team A: the rest opens first, then (on close) the chooser.
  for (let i = 0; i < 10; i++) { click($('card-0')); }
  ok($('games-0').textContent === '1', 'doubles: team A won game 1');
  ok(!$('timer-overlay').classList.contains('hidden'),
    'doubles: between-games rest auto-opens');
  click($('timer-close'));
  ok(!$('dchooser').classList.contains('hidden'),
    'service chooser opens after the rest');
  ok($('dchooser-servers').querySelectorAll('button').length === 2,
    'chooser offers the 2 players of the serving pair');

  click($('dchooser-confirm'));
  ok($('dchooser').classList.contains('hidden'), 'chooser closes on confirm');
  ok($('points-0').textContent === '0' && $('points-1').textContent === '0',
    'game 2 starts at 0-0');

  // ======================== ACCELERATION (UI) =============================
  // Start a fresh singles match to exercise the acceleration panel + counter.
  click($('btn-quit'));
  click($('screen-menu').querySelector("[data-target='screen-newmatch']"));
  setRadio(doc.querySelector("input[name=mode][value=singles]"));
  submit();
  ok($('accel-panel').classList.contains('hidden'), 'accel panel hidden before activation');

  click($('btn-accel'));
  ok(!$('accel-panel').classList.contains('hidden'), 'accel panel shown after activation');
  ok($('btn-accel').disabled, 'accel button disabled once active');
  ok($('accel-max').textContent === '13', 'accel threshold shown (13)');

  // The first server is player 0; the receiver is player 1. Counting 13 good
  // returns must award the point to the receiver (player 1).
  for (let i = 0; i < 13; i++) { click($('btn-return')); }
  ok($('points-1').textContent === '1', '13 returns -> point to the receiver');
  ok($('accel-count').textContent === '0', 'return counter resets after the point');

  // A normal point (card tap) must also reset the return counter.
  click($('btn-return'));
  ok($('accel-count').textContent === '1', 'return counter increments');
  click($('card-0'));
  ok($('accel-count').textContent === '0', 'card tap resets the return counter');

  // ======================== CARDS / SANCTIONS (UI) ========================
  click($('btn-quit'));
  click($('screen-menu').querySelector("[data-target='screen-newmatch']"));
  setRadio(doc.querySelector("input[name=mode][value=singles]"));
  $('nameA').value = 'Alice';
  $('nameB').value = 'Bob';
  $('nameA').dispatchEvent(new win.Event('input', { bubbles: true }));
  submit();

  click($('btn-carton'));
  ok(!$('sanction').classList.contains('hidden'), 'sanction overlay opens');
  let rows = doc.querySelectorAll('#sanction-list .sanction-row');
  ok(rows.length === 2, 'sanction overlay lists both players (singles)');

  // Sanction Alice twice: 1st = yellow (no point), 2nd = +1 to Bob.
  // Each row has two buttons: [0] = "− Retirer", [1] = "Sanctionner".
  function sanctionBtn(rowIdx) {
    return doc.querySelectorAll('#sanction-list .sanction-row')[rowIdx]
      .querySelectorAll('button')[1];
  }
  click(sanctionBtn(0));
  ok($('cards-0').textContent === '🟨', 'first sanction shows a yellow card');
  ok($('points-1').textContent === '0', 'first sanction gives no point');
  click(sanctionBtn(0));
  ok($('points-1').textContent === '1', 'second sanction: +1 point to opponent');
  ok($('cards-0').textContent === '🟨🟥', 'second sanction shows yellow+red');

  // Remove a card put by mistake: "− Retirer" reverses card + penalty point.
  let row0 = doc.querySelectorAll('#sanction-list .sanction-row')[0];
  let removeBtn = row0.querySelectorAll('button')[0]; // "− Retirer" is first
  click(removeBtn);
  ok($('cards-0').textContent === '🟨', 'remove: back to a single yellow card');
  ok($('points-1').textContent === '0', 'remove: penalty point reversed');
  click(doc.querySelectorAll('#sanction-list .sanction-row')[0].querySelectorAll('button')[0]);
  ok($('cards-0').textContent === '', 'remove again: no card left');

  click($('sanction-close'));
  ok($('sanction').classList.contains('hidden'), 'sanction overlay closes');

  dom.window.close();
  console.log(fails === 0 ? '\nALL UI DOM TESTS PASSED'
    : '\n' + fails + ' UI DOM TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

run();
