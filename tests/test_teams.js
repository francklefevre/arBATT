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
 * 2026-10-11 (v0.1.20): unit tests of the free-match teams model
 * (www/js/teams.js): name matching, doubles sides, standings, validation.
 * Run with:  node tests/test_teams.js   (or: npm run test:teams)
 */

require('../www/js/sheet.js'); // provides arbattSheet.uuid() on globalThis
const T = require('../www/js/teams.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}
function throws(fn, msg) {
  try { fn(); ok(false, msg); } catch (e) { ok(true, msg); }
}

// --- roster + name matching -------------------------------------------------
const r = T.createRoster();
const t1 = T.addTeam(r, 'BATT 1');
const t2 = T.addTeam(r, '');
t1.players = T.parsePlayers('Alice\n  Émma ;Bruno');
t2.players = T.parsePlayers('Claire, Denis');
ok(t2.name === 'Équipe 2', 'unnamed team gets a default label');
ok(t1.players.length === 3 && t1.players[1] === 'Émma', 'players parsed (lines, ; and ,)');
ok(T.teamOfPlayer(r, '  emma ') === t1, 'case/accent/space-insensitive match');
ok(T.teamOfPlayer(r, 'Zoé') === null, 'unknown player has no team');
ok(T.teamOfSide(r, ['Alice', 'Bruno']) === t1, 'doubles side of one team');
ok(T.teamOfSide(r, ['Alice', 'Claire']) === null, 'mixed doubles side has no team');
ok(T.allPlayers(r).length === 5, 'all players listed for the datalist');

// --- standings ---------------------------------------------------------------
const enc = function (a, b, w) { return { sides: [a, b], result: { winner: w, games: [2, 0] } }; };
const hist = [
  enc(['Alice'], ['Claire'], 0),          // BATT 1 beats Équipe 2
  enc(['Bruno'], ['Denis'], 1),           // Équipe 2 beats BATT 1
  enc(['Emma'], ['Claire'], 0),           // BATT 1 beats Équipe 2
  enc(['Alice'], ['Zoé'], 1),             // BATT 1 loses to a player without team
  enc(['Alice'], ['Bruno'], 0),           // internal match: 1 win + 1 loss
  { sides: [['Alice'], ['Denis']], result: null } // unfinished: ignored
];
const st = T.standings(r, hist);
ok(st[0].id === t1.id && st[0].won === 3 && st[0].lost === 3 && st[0].played === 6,
  'BATT 1: 3 wins, 3 losses (incl. internal match and team-less opponent)');
ok(st[1].won === 1 && st[1].lost === 2 && st[1].played === 3, 'Équipe 2: 1 win, 2 losses');
const empty = T.createRoster();
T.addTeam(empty, 'Solo');
ok(T.standings(empty, hist)[0].played === 0, 'a team without match is still listed');

// --- removal + validation ----------------------------------------------------
ok(T.removeTeam(r, t2.id) && r.teams.length === 1, 'team removed');
ok(T.teamOfPlayer(r, 'Claire') === null, 'players of a removed team lose their team');
ok(T.validateRoster(JSON.parse(JSON.stringify(r))) && true, 'roster survives storage');
throws(function () { T.validateRoster({ format: 'arbatt-sheet', v: 1, teams: [] }); },
  'a sheet is not a team list');
throws(function () { T.validateRoster({ format: 'arbatt-teams', v: 1, teams: [{ name: 'x' }] }); },
  'malformed team rejected');

console.log(fails === 0 ? 'ALL TEAMS TESTS PASSED' : fails + ' TEAMS TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
