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
 * Headless unit tests for cards & sanctions, singles and doubles.
 * Run with:  node tests/test_sanctions.js
 *
 * Ladder (FFTT manual p.13): 1st = yellow (no point); 2nd = yellow+red, +1 to
 * the opponent; 3rd = yellow+red, +2; 4th = red, referee called.
 */

const { TTScorer, sanctionForCount } = require('../www/js/scorer.js');
const { DoublesScorer } = require('../www/js/doubles.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

// --- ladder helper ----------------------------------------------------------
ok(JSON.stringify(sanctionForCount(1)) ===
   JSON.stringify({ cards: ['yellow'], penalty: 0, refereeCall: false }),
  '1st infraction: yellow, no point');
ok(sanctionForCount(2).penalty === 1 && sanctionForCount(2).cards.join('+') === 'yellow+red',
  '2nd: yellow+red, +1');
ok(sanctionForCount(3).penalty === 2, '3rd: +2');
ok(sanctionForCount(4).refereeCall === true && sanctionForCount(4).cards[0] === 'red',
  '4th: red + referee call');

// --- singles ----------------------------------------------------------------
let s = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
let r1 = s.sanction(0);
ok(r1.cards.join('+') === 'yellow' && r1.penalty === 0, 'singles 1st: yellow only');
ok(s.view().points[1] === 0, 'singles 1st: opponent score unchanged');
ok(s.view().infractions[0] === 1, 'singles: infraction recorded');

let r2 = s.sanction(0);
ok(r2.penalty === 1 && s.view().points[1] === 1, 'singles 2nd: +1 to opponent');

let r3 = s.sanction(0);
ok(r3.penalty === 2 && s.view().points[1] === 3, 'singles 3rd: +2 to opponent (total 3)');

let r4 = s.sanction(0);
ok(r4.refereeCall === true && s.view().refereeCalled === true,
  'singles 4th: referee called');

// --- penalty can finish a game ---------------------------------------------
let s2 = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
for (let i = 0; i < 10; i++) { s2.pointTo(1); } // B at 10-0
s2.sanction(0); // 1st: nothing
s2.sanction(0); // 2nd: +1 to B -> 11-0, game B
ok(s2.view().games[1] === 1, 'penalty point can win the game');

// --- undo reverts a sanction (count + points) ------------------------------
let s3 = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
s3.sanction(0); s3.sanction(0); // infraction 2, +1 to B
ok(s3.view().points[1] === 1 && s3.view().infractions[0] === 2, 'before undo');
s3.undo();
ok(s3.view().points[1] === 0 && s3.view().infractions[0] === 1,
  'undo reverts the 2nd sanction (count and penalty point)');

// --- doubles: penalty goes to the opposing pair ----------------------------
let d = new DoublesScorer({
  playerNames: ['X', 'Y', 'A', 'B'], firstServer: 0, firstReceiver: 3
});
d.sanction(2); // player on team 1, 1st -> yellow, no point
ok(d.view().infractions[2] === 1 && d.view().points[0] === 0,
  'doubles 1st: yellow, no point');
d.sanction(2); // 2nd -> +1 to team 0
ok(d.view().points[0] === 1, 'doubles 2nd: +1 to the opposing pair (team 0)');
d.sanction(0); // a player on team 0, 1st -> yellow only
ok(d.view().infractions[0] === 1 && d.view().points[1] === 0,
  'doubles: per-player ladder is independent');

console.log(fails === 0 ? '\nALL SANCTION TESTS PASSED'
  : '\n' + fails + ' SANCTION TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
