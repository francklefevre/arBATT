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
  // 2026-10-18 (v0.1.22): no code -> "Mode tablette" code entry form.
  const bad = loadCourt('');
  await wait(10);
  const B = bad.window.document;
  ok(!B.getElementById('ct-pair').classList.contains('hidden') &&
     B.getElementById('ct-main').classList.contains('hidden'),
    'no code: the tablet asks for the pairing code');
  B.getElementById('ct-code').value = '12a3';
  B.getElementById('ct-code').dispatchEvent(new bad.window.Event('input', { bubbles: true }));
  ok(B.getElementById('ct-code').value === '123', 'code entry keeps digits only');
  B.getElementById('ct-pair').dispatchEvent(new bad.window.Event('submit', { bubbles: true, cancelable: true }));
  ok(/6 chiffres/.test(B.getElementById('ct-pair-err').textContent) &&
     bad.window.localStorage.getItem('arbatt.court.code') === null,
    'too short a code is refused');
  const badCode = loadCourt('?code=12345');
  await wait(10);
  ok(!badCode.window.document.getElementById('ct-pair').classList.contains('hidden') &&
     /invalide/.test(badCode.window.document.getElementById('ct-pair-err').textContent),
    'malformed ?code= asks again');

  const app = loadApp(null, { broadcast: true });
  await wait(10);
  const A = app.window.document;
  const $a = function (id) { return A.getElementById(id); };
  const click = function (el) { el.dispatchEvent(new app.window.Event('click', { bubbles: true })); };
  const ch = app.window.arbattStudio.getChannel();

  // The broadcast panel gives the tablet address on the same channel.
  click(A.querySelector('#screen-menu .open-live'));
  ok($a('court-url').value === 'http://localhost/court.html?code=' + ch, 'tablet address in the broadcast panel');
  ok($a('live-code').textContent === ch.slice(0, 3) + ' ' + ch.slice(3), 'pairing code shown in the panel');
  ok(A.getElementById('menu-tablet').getAttribute('href') === 'court.html', 'menu offers the tablet mode');
  // 2026-10-11 (v0.1.21): QR code of the tablet address (hidden by default).
  ok($a('court-qr').classList.contains('hidden') && $a('court-qr').querySelector('svg'),
    'tablet QR code drawn, hidden until asked');
  click($a('court-qr-btn'));
  ok(!$a('court-qr').classList.contains('hidden') &&
     $a('court-qr-btn').getAttribute('aria-expanded') === 'true', 'QR code shown on demand');
  const ref = app.window.qrcode(0, 'M');
  ref.addData($a('court-url').value);
  ref.make();
  // Compare the drawn modules (path "d"): jsdom re-serialises the markup.
  const refPath = /<path d="([^"]+)"/.exec(ref.createSvgTag({ cellSize: 4, margin: 16, scalable: true }))[1];
  ok($a('court-qr').querySelector('path').getAttribute('d') === refPath,
    'QR code encodes exactly the tablet address');
  click($a('live-close'));

  const court = loadCourt('?code=' + ch, { broadcast: true });
  const C = court.window.document;
  const $c = function (id) { return C.getElementById(id); };
  const side = function (s) { return C.getElementById('ct-side-' + s); };
  await wait(30);
  ok(/attente de la partie/.test($c('ct-wait').textContent) &&
     $c('ct-pair').classList.contains('hidden'), 'tablet connected, waiting for a match');
  ok(court.window.localStorage.getItem('arbatt.court.code') === ch, 'code remembered on the tablet');

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
