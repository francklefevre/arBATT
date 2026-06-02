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
 * Headless unit tests for the DOUBLES scoring engine.
 * Run with:  node tests/test_doubles.js
 *
 * Player indices: team0 = {0,1}, team1 = {2,3}.
 * The flagship scenario mirrors the FFTT manual example (p.9):
 *   Xavier(0)/Yves(1) vs André(2)/Bernard(3), Xavier serves on Bernard.
 */

const { DoublesScorer, teamOf, partnerOf, buildServeOrder } =
  require('../www/js/doubles.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

// --- helpers ----------------------------------------------------------------
ok(teamOf(0) === 0 && teamOf(1) === 0, 'teamOf 0/1 -> team0');
ok(teamOf(2) === 1 && teamOf(3) === 1, 'teamOf 2/3 -> team1');
ok(partnerOf(0) === 1 && partnerOf(3) === 2, 'partnerOf 0->1, 3->2');
ok(JSON.stringify(buildServeOrder(0, 3)) === JSON.stringify([0, 3, 1, 2]),
  'buildServeOrder(0,3) = [0,3,1,2]');

// --- rotation against the manual example -----------------------------------
function freshExample(extra) {
  return new DoublesScorer(Object.assign({
    playerNames: ['Xavier', 'Yves', 'André', 'Bernard'],
    firstServer: 0, firstReceiver: 3, gamesToWin: 3
  }, extra || {}));
}

let d = freshExample();
ok(d.server() === 0 && d.receiver() === 3, '0-0: Xavier serves Bernard');

d.pointTo(0); d.pointTo(1); // 1-1, block 1
ok(d.server() === 3 && d.receiver() === 1, 'block1: Bernard serves Yves');

d.pointTo(0); d.pointTo(0); // 3-1, block 2
ok(d.server() === 1 && d.receiver() === 2, 'block2: Yves serves André');

d.pointTo(1); d.pointTo(1); // 3-3, block 3
ok(d.server() === 2 && d.receiver() === 0, 'block3: André serves Xavier');

d.pointTo(0); d.pointTo(0); // 5-3, block 4 -> cycles back to block0 pairing
ok(d.server() === 0 && d.receiver() === 3, 'block4: back to Xavier serves Bernard');

// --- deuce: server changes every point -------------------------------------
let dd = freshExample();
for (let i = 0; i < 10; i++) { dd.pointTo(0); dd.pointTo(1); } // 10-10
ok(dd.server() === 1 && dd.receiver() === 2, '10-10: server=Yves receiver=André');
dd.pointTo(0); // 11-10
ok(dd.server() === 2, '11-10: server changed every point at deuce');
dd.pointTo(1); // 11-11 -> deuce cycles all four servers: 1,2,0,3 ...
ok(dd.server() === 0, '11-11: next server in the deuce cycle (Xavier)');

// --- deciding game: ends + receiving order reversed at 5 --------------------
let dg = freshExample({ gamesToWin: 2, firstTeamLeftSide: 0 });
for (let i = 0; i < 11; i++) { dg.pointTo(0); } // game1 team0
for (let i = 0; i < 11; i++) { dg.pointTo(1); } // game2 team1 -> 1-1 deciding
ok(dg.isDecidingGame(), 'deciding game reached at 1-1');
ok(!dg.isReceivingInverted(), 'not inverted before 5');
let leftBefore = dg.leftTeam();
let srvBefore = dg.server(), rcvBefore = dg.receiver();
ok(srvBefore === 1 && rcvBefore === 2, 'deciding 0-0: server=1 receiver=2');

for (let i = 0; i < 5; i++) { dg.pointTo(0); } // team0 reaches 5
ok(dg.isReceivingInverted(), 'receiving inverted once a pair reaches 5');
ok(dg.leftTeam() === 1 - leftBefore, 'ends change at 5 in deciding game');
// At 5-0 the block is 2 -> base server order[2]=0, base receiver order[3]=3,
// inverted -> partner(3) = 2.
ok(dg.server() === 0 && dg.receiver() === 2,
  'inverted receiver = partner of base receiver');

// --- match completion -------------------------------------------------------
let dm = freshExample({ gamesToWin: 3 });
for (let g = 0; g < 3; g++) { for (let i = 0; i < 11; i++) { dm.pointTo(0); } }
let vm = dm.view();
ok(vm.finished && vm.winner === 0 && vm.games[0] === 3,
  'team0 wins best-of-5 (3-0)');
ok(dm.pointTo(0) === false, 'no point accepted after match finished');

// --- setGameStart override + validation ------------------------------------
let ds = freshExample();
ok(ds.setGameStart(1, 2) === true, 'setGameStart at 0-0 accepted');
ok(ds.server() === 1 && ds.receiver() === 2, 'override applied');
ds.pointTo(0);
ok(ds.setGameStart(0, 3) === false, 'setGameStart refused mid-game');

let threw = false;
try { ds.setGameStart(0, 1); } catch (e) { threw = true; }
ok(threw, 'setGameStart throws on same-team pair');

let ctorThrew = false;
try { new DoublesScorer({ firstServer: 0, firstReceiver: 1 }); }
catch (e) { ctorThrew = true; }
ok(ctorThrew, 'constructor throws on same-team server/receiver');

// --- time-outs (one per pair) ----------------------------------------------
let dt = freshExample();
ok(dt.callTimeout(0) === true, 'team0 time-out granted');
ok(dt.callTimeout(0) === false, 'team0 second time-out refused');
ok(dt.callTimeout(1) === true, 'team1 time-out granted');
ok(dt.view().timeoutsUsed[0] === true && dt.view().timeoutsUsed[1] === true,
  'both pairs flagged as having used their time-out');

// --- undo -------------------------------------------------------------------
let du = freshExample();
du.pointTo(0); du.pointTo(0); du.undo();
ok(du.view().points[0] === 1, 'undo back to 1-0');
du.callTimeout(0); du.undo();
ok(du.view().timeoutsUsed[0] === false, 'undo also reverts a time-out');

console.log(fails === 0 ? '\nALL DOUBLES TESTS PASSED'
  : '\n' + fails + ' DOUBLES TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
