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
 * Headless unit tests for the singles scoring engine.
 * Run with:  node tests/test_scorer.js
 */

const { TTScorer, serverOf } = require('../www/js/scorer.js');
let fails = 0;
function ok(cond, msg){ if(!cond){ console.log('FAIL:', msg); fails++; } else { console.log('ok  :', msg); } }

// Service alternation every 2 points, first server = 0
ok(serverOf(0,0,0,11,2)===0, 'server 0-0 -> P0');
ok(serverOf(0,1,0,11,2)===0, 'server 1-0 -> P0');
ok(serverOf(0,1,1,11,2)===1, 'server 2pts -> P1');
ok(serverOf(0,2,1,11,2)===1, 'server 2-1 -> P1');
ok(serverOf(0,2,2,11,2)===0, 'server 4pts -> P0');
// Deuce: every point
ok(serverOf(0,10,10,11,2)===0, 'server 10-10 -> P0 (firstServer)');
ok(serverOf(0,11,10,11,2)===1, 'server 11-10 -> toggled');
ok(serverOf(0,11,11,11,2)===0, 'server 12pts deuce -> back');

// Full game to 11-0
let m = new TTScorer({playerNames:['A','B'], firstServer:0, gamesToWin:3});
for(let k=0;k<11;k++) m.pointTo(0);
let v = m.view();
ok(v.games[0]===1 && v.points[0]===0 && v.points[1]===0, 'game won 11-0, points reset');
ok(v.gameIndex===1, 'gameIndex advanced');
// First server of game 2 should be the other player (B index1)
ok(m.server()===1, 'game2 first server alternated to B');

// Deuce game 12-10
m = new TTScorer({playerNames:['A','B'], firstServer:0, gamesToWin:3});
for(let k=0;k<10;k++){ m.pointTo(0); m.pointTo(1); } // 10-10
ok(m.view().points[0]===10 && m.view().points[1]===10, 'reached 10-10');
m.pointTo(0); // 11-10 not won
ok(m.view().games[0]===0, '11-10 not a win');
m.pointTo(0); // 12-10 win
ok(m.view().games[0]===1, '12-10 wins game');

// Undo
m = new TTScorer({playerNames:['A','B']});
m.pointTo(0); m.pointTo(0); m.undo();
ok(m.view().points[0]===1, 'undo back to 1');

// Ends swap each game
m = new TTScorer({playerNames:['A','B'], firstServerLeftSide:0});
ok(m.leftPlayer()===0, 'game1 left=P0');
for(let k=0;k<11;k++) m.pointTo(0);
ok(m.leftPlayer()===1, 'game2 left swapped to P1');

// Deciding game mid switch at 5 (best of 3 -> gamesToWin 2, deciding at 1-1)
m = new TTScorer({playerNames:['A','B'], gamesToWin:2, firstServerLeftSide:0});
for(let k=0;k<11;k++) m.pointTo(0); // game1 A
for(let k=0;k<11;k++) m.pointTo(1); // game2 B -> 1-1 deciding, gameIndex2
ok(m.isDecidingGame(), 'deciding game reached at 1-1');
let beforeLeft = m.leftPlayer();
for(let k=0;k<5;k++) m.pointTo(0); // reach 5
ok(m.leftPlayer()===1-beforeLeft, 'ends switch at 5 in deciding game');

// Timeout once
m = new TTScorer({playerNames:['A','B']});
ok(m.callTimeout(0)===true, 'timeout granted');
ok(m.callTimeout(0)===false, 'second timeout refused');

console.log(fails===0 ? '\nALL TESTS PASSED' : '\n'+fails+' TEST(S) FAILED');
process.exit(fails===0?0:1);
