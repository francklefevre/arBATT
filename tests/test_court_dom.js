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
 * 2026-10-11 (v0.1.20): end-to-end test of the courtside tablet display
 * (court.html): the referee app scores, the tablet (same browser, through
 * BroadcastChannel) shows names, big points, games, serve, game point,
 * countdown, swap and winner.
 * Run with:  node tests/test_court_dom.js   (or: npm run test:court)
 */

const { loadApp, loadCourt } = require('./dom_harness');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); };

async function run() {
  // Missing channel: explicit message, nothing else.
  const bad = loadCourt('');
  await wait(10);
  ok(/manquant/.test(bad.window.document.getElementById('ct-wait').textContent) &&
     bad.window.document.getElementById('ct-main').classList.contains('hidden'),
    'missing ?ch= explained on the tablet');

  const app = loadApp(null, { broadcast: true });
  await wait(10);
  const A = app.window.document;
  const $a = function (id) { return A.getElementById(id); };
  const click = function (el) { el.dispatchEvent(new app.window.Event('click', { bubbles: true })); };
  const ch = app.window.arbattStudio.getChannel();

  // The broadcast panel gives the tablet address on the same channel.
  click(A.querySelector('#screen-menu .open-live'));
  ok($a('court-url').value === 'http://localhost/court.html?ch=' + ch, 'tablet address in the broadcast panel');
  click($a('live-close'));

  const court = loadCourt('?ch=' + ch, { broadcast: true });
  const C = court.window.document;
  const $c = function (id) { return C.getElementById(id); };
  const side = function (s) { return C.getElementById('ct-side-' + s); };
  await wait(30);
  ok(/attente de la partie/.test($c('ct-wait').textContent), 'tablet connected, waiting for a match');

  // Start a free match and score.
  click(A.querySelector("#screen-menu [data-target='screen-newmatch']"));
  $a('nameA').value = 'Alice';
  $a('nameB').value = 'Bruno';
  $a('gamesToWin').value = '2';
  $a('form-newmatch').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  click($a('card-0'));
  click($a('card-0'));
  click($a('card-1'));
  await wait(30);
  ok(!$c('ct-main').classList.contains('hidden') && $c('ct-wait').classList.contains('hidden'),
    'score shown once the match starts');
  ok(side(0).querySelector('.ct-name span').textContent === 'Alice' &&
     side(1).querySelector('.ct-name span').textContent === 'Bruno', 'names');
  ok(side(0).querySelector('.ct-points').textContent === '2' &&
     side(1).querySelector('.ct-points').textContent === '1', 'big points follow the referee');
  ok(side(1).classList.contains('serving') && !side(0).classList.contains('serving'),
    'serve indicator after 2 points');
  ok(/Manche 1/.test($c('ct-ctx').textContent), 'context line');

  // Swap button (remembered on the tablet).
  const swappedBefore = $c('ct-main').classList.contains('swapped');
  click($c('ct-flip'));
  ok($c('ct-main').classList.contains('swapped') !== swappedBefore &&
     court.window.localStorage.getItem('arbatt.court.flip') === '1', 'sides swapped and remembered');

  // Game point, then game won -> rest countdown on the tablet.
  for (let i = 0; i < 8; i++) { click($a('card-0')); }
  await wait(30);
  ok(/manche/i.test(side(0).querySelector('.ct-flag').textContent), 'game point flag');
  click($a('card-0'));
  await wait(30);
  ok(side(0).querySelector('.ct-games').textContent === '1', 'games won');
  ok(!$c('ct-timer').classList.contains('hidden') && /Repos/.test($c('ct-timer').textContent),
    'rest countdown shown on the tablet');
  click($a('timer-close'));
  await wait(30);
  ok($c('ct-timer').classList.contains('hidden'), 'countdown removed when closed');

  // Win the match.
  for (let i = 0; i < 11; i++) { click($a('card-0')); }
  await wait(30);
  ok(!$c('ct-over').classList.contains('hidden') && $c('ct-over-name').textContent === 'Alice',
    'winner shown at the end');
  ok(side(0).classList.contains('winner') && /Terminé/.test($c('ct-ctx').textContent),
    'winning side highlighted, context says finished');

  console.log(fails === 0 ? 'ALL COURT TESTS PASSED' : fails + ' COURT TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

run().catch(function (e) { console.log('FAIL: exception', e); process.exit(1); });
