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
 * 2026-10-06 (v0.1.12): headless tests of the match sheet model (sheet.js)
 * and of the shared live snapshot builder (live.js matchSnapshot).
 * Run with:  node tests/test_sheet.js
 */

const S = require('../www/js/sheet.js');
const Live = require('../www/js/live.js');
const { TTScorer } = require('../www/js/scorer.js');
const { DoublesScorer } = require('../www/js/doubles.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}
function throws(fn, msg) {
  try { fn(); ok(false, msg + ' (did not throw)'); } catch (e) { ok(true, msg); }
}

// --- creation / UUIDs -------------------------------------------------------
const sh = S.createSheet({ title: 'J3', teams: ['BATT', 'Caen'] });
ok(/^[0-9a-f-]{36}$/.test(sh.id), 'sheet id is a UUID');
ok(sh.format === 'arbatt-sheet' && sh.v === 1, 'format tag + version');
ok(sh.teams[0] === 'BATT' && sh.teams[1] === 'Caen', 'team names kept');
ok(S.createSheet({}).teams.join('|') === 'Équipe A|Équipe B', 'default team names');

// --- encounters -----------------------------------------------------------
const e1 = S.addEncounter(sh, 'singles', ['Alice', 'Bruno']);
const e2 = S.addEncounter(sh, 'doubles', ['Alice / Claire', ['Bruno', 'Denis']]);
ok(e1.id !== e2.id, 'encounters get distinct ids');
ok(S.sideLabel(e2, 0) === 'Alice / Claire', 'doubles side parsed from "A / B"');
throws(function () { S.addEncounter(sh, 'doubles', ['Alice', 'Bruno / Denis']); },
  'doubles side with one name is rejected');
throws(function () { S.addEncounter(sh, 'singles', ['', 'Bruno']); },
  'empty singles side is rejected');
throws(function () { S.addEncounter(sh, 'mixed', ['A', 'B']); }, 'unknown kind rejected');
ok(sh.encounters.length === 2, 'rejected encounters were not added');

ok(S.moveEncounter(sh, e2.id, -1) && sh.encounters[0] === e2, 'move up');
ok(!S.moveEncounter(sh, e2.id, -1), 'cannot move above the first row');
S.moveEncounter(sh, e2.id, 1);
ok(sh.encounters[0] === e1, 'move down');
ok(S.nextPending(sh) === e1, 'next pending = first without result');

// --- results from a real finished match -----------------------------------
const m = new TTScorer({ playerNames: ['Alice', 'Bruno'], gamesToWin: 2 });
for (let g = 0; g < 2; g++) { for (let i = 0; i < 11; i++) { m.pointTo(0); } }
throws(function () { S.recordResultFromView(sh, e1.id, new TTScorer({}).view()); },
  'unfinished match cannot be recorded');
S.recordResultFromView(sh, e1.id, m.view());
ok(e1.result.winner === 0 && e1.result.games.join('-') === '2-0', 'result recorded');
ok(S.scoresLabel(e1) === '11-0 11-0', 'game scores label');
ok(S.teamScore(sh).join('-') === '1-0', 'team score derived from results');
ok(S.nextPending(sh) === e2, 'next pending skips finished encounters');
ok(S.clearResult(sh, e1.id) && S.teamScore(sh).join('-') === '0-0', 'clear result');
ok(S.removeEncounter(sh, e2.id) && sh.encounters.length === 1, 'remove encounter');

// --- generator --------------------------------------------------------------
const g = S.createSheet({});
const n = S.generateCross(g, ['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], 1);
ok(n === 10 && g.encounters.length === 10, '3x3 cross + 1 double = 10 encounters');
const pairs = new Set(g.encounters.filter(function (e) { return e.kind === 'singles'; })
  .map(function (e) { return e.sides[0][0] + '-' + e.sides[1][0]; }));
ok(pairs.size === 9, 'every A player meets every B player exactly once');
ok(g.encounters[9].kind === 'doubles' && g.encounters[9].sides[0].length === 2,
  'double appended with 2 players per side');

// --- validation (import) ----------------------------------------------------
const copy = JSON.parse(JSON.stringify(sh));
ok(S.validateSheet(copy) === copy, 'a serialised sheet validates');
throws(function () { S.validateSheet({ format: 'other' }); }, 'foreign JSON rejected');
throws(function () { S.validateSheet(Object.assign({}, copy, { v: 99 })); }, 'future version rejected');
const bad = JSON.parse(JSON.stringify(copy));
bad.encounters[0].result = { winner: 5 };
throws(function () { S.validateSheet(bad); }, 'invalid result rejected');

// --- live snapshot builder ----------------------------------------------------
const d = new DoublesScorer({ playerNames: ['A1', 'A2', 'B1', 'B2'] });
d.pointTo(1);
const snap = Live.matchSnapshot(d.view(), {
  mode: 'doubles', matchId: 'x', pointsPerGame: 11, accelReturns: 13, encounterId: 'e'
});
ok(snap.sides[0] === 'A1 / A2' && snap.sides[1] === 'B1 / B2', 'doubles side labels');
ok(snap.points.join('-') === '0-1' && snap.servingSide === 0, 'points + serving team');
ok(snap.names.length === 4 && snap.infractions.length === 4, 'per-player arrays kept');
ok(snap.encounterId === 'e' && snap.matchId === 'x', 'ids propagated');
const fin = Live.matchSnapshot(m.view(), { mode: 'singles', matchId: 'y' });
ok(fin.finished && fin.winner === 0 && fin.servingSide === null, 'finished snapshot');

console.log(fails === 0 ? 'ALL SHEET TESTS PASSED' : fails + ' SHEET TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
