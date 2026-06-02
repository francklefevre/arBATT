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
 * Headless unit tests for the ACCELERATION ("expedite") rule, in both singles
 * and doubles. Run with:  node tests/test_acceleration.js
 *
 * Rule recall (FFTT manual, p.16): once active, the server changes after EVERY
 * point; it stays active until the end of the match. (The 13-return mechanic is
 * handled in the UI — see tests/test_ui_dom.js.)
 */

const { TTScorer, acceleratedBlocks } = require('../www/js/scorer.js');
const { DoublesScorer } = require('../www/js/doubles.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

// --- acceleratedBlocks helper ----------------------------------------------
ok(acceleratedBlocks(0, 0, 11, null) === 0, 'helper: null -> normal (0)');
ok(acceleratedBlocks(2, 1, 11, null) === 1, 'helper: null -> normal cadence (1)');
ok(acceleratedBlocks(3, 2, 11, 0) === 5, 'helper: from 0 -> every point (total)');
ok(acceleratedBlocks(5, 3, 11, 5) === 5, 'helper: mid-game from total 5 -> 2+(8-5)');

// --- singles: activate at 0-0 ----------------------------------------------
let s = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
ok(s.activateAcceleration() === true, 'singles: acceleration activated');
ok(s.activateAcceleration() === false, 'singles: cannot activate twice');
ok(s.view().accelerated === true, 'singles: view reports accelerated');
ok(s.server() === 0, 'accel 0-0: server is first server');
s.pointTo(0); // 1-0
ok(s.server() === 1, 'accel: server flips after 1 point');
s.pointTo(1); // 1-1
ok(s.server() === 0, 'accel: server flips again after 2nd point');
s.pointTo(0); // 2-1
ok(s.server() === 1, 'accel: server flips every single point');

// --- singles: activate MID-game --------------------------------------------
let s2 = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
for (let i = 0; i < 3; i++) { s2.pointTo(0); } // 3-0
s2.pointTo(1); s2.pointTo(1); // 3-2, total 5, normal cadence -> server 0
ok(s2.server() === 0, 'pre-accel: server at 3-2 (normal cadence)');
s2.activateAcceleration(); // from total 5
let seq = [];
seq.push(s2.server());           // total 5 -> 0
s2.pointTo(0); seq.push(s2.server()); // total 6 -> flip
s2.pointTo(1); seq.push(s2.server()); // total 7 -> flip
s2.pointTo(0); seq.push(s2.server()); // total 8 -> flip
ok(JSON.stringify(seq) === JSON.stringify([0, 1, 0, 1]),
  'mid-game accel: server flips every point from activation');

// --- singles: persists into the next game ----------------------------------
let s3 = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
s3.activateAcceleration();
for (let i = 0; i < 11; i++) { s3.pointTo(0); } // win game 1
ok(s3.view().accelerated === true, 'acceleration persists after a game');
let g2srv = s3.server();        // 0-0 of game 2
s3.pointTo(1);
ok(s3.server() === 1 - g2srv, 'next game still accelerated (flip every point)');

// --- singles: undo reverts acceleration ------------------------------------
let s4 = new TTScorer({ playerNames: ['A', 'B'], firstServer: 0 });
s4.activateAcceleration();
s4.undo();
ok(s4.view().accelerated === false, 'undo reverts acceleration');
s4.pointTo(0); // 1-0 normal cadence -> server still 0 (changes every 2)
ok(s4.server() === 0, 'after undo: back to normal every-2 cadence');

// --- doubles: activate at 0-0 ----------------------------------------------
let d = new DoublesScorer({
  playerNames: ['X', 'Y', 'A', 'B'], firstServer: 0, firstReceiver: 3
}); // serveOrder [0,3,1,2]
ok(d.activateAcceleration() === true, 'doubles: acceleration activated');
ok(d.view().accelerated === true, 'doubles: view reports accelerated');
ok(d.server() === 0 && d.receiver() === 3, 'accel 0-0: X serves B');
d.pointTo(0); // total 1 -> block 1
ok(d.server() === 3 && d.receiver() === 1, 'accel: rotate every point (B serves Y)');
d.pointTo(1); // total 2 -> block 2
ok(d.server() === 1 && d.receiver() === 2, 'accel: rotate again (Y serves A)');

// --- doubles: undo reverts acceleration ------------------------------------
let d2 = new DoublesScorer({
  playerNames: ['X', 'Y', 'A', 'B'], firstServer: 0, firstReceiver: 3
});
d2.activateAcceleration();
d2.undo();
ok(d2.view().accelerated === false, 'doubles: undo reverts acceleration');

console.log(fails === 0 ? '\nALL ACCELERATION TESTS PASSED'
  : '\n' + fails + ' ACCELERATION TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
