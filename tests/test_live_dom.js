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
 * 2026-10-06 (v0.1.12): end-to-end test of the scoreboard / OBS mode.
 * The referee app (index.html) and the public overlay (scoreboard.html) are
 * loaded in two jsdom windows of the SAME process, linked by Node's
 * BroadcastChannel (lent by the harness). The test prepares a match sheet,
 * referees an encounter from it, and checks that the overlay follows (names,
 * points, serve, banners, team score, sheet panel) and that the result is
 * written back to the sheet. A second app instance checks the HTTP relay
 * publication path (POSTs captured by the fetch stub).
 *
 * Run with:  node tests/test_live_dom.js
 */

const { loadApp, loadOverlay } = require('./dom_harness');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); };

function helpers(win) {
  const doc = win.document;
  const $ = function (id) { return doc.getElementById(id); };
  return {
    $: $,
    doc: doc,
    visible: function (id) { return !$(id).classList.contains('hidden'); },
    click: function (el) { el.dispatchEvent(new win.Event('click', { bubbles: true })); },
    type: function (id, v) {
      $(id).value = v;
      $(id).dispatchEvent(new win.Event('input', { bubbles: true }));
    },
    check: function (id, v) {
      $(id).checked = v;
      $(id).dispatchEvent(new win.Event('change', { bubbles: true }));
    }
  };
}

async function run() {
  // ---------------------------------------------------------------- app side
  const app = loadApp(null, { broadcast: true });
  const A = helpers(app.window);
  await wait(10);

  ok(!!app.window.arbattStudio && !!app.window.arbattApp, 'studio + app bridges exposed');
  const ch = app.window.arbattStudio.getChannel();
  ok(/^[0-9a-f-]{36}$/.test(ch), 'broadcast channel is a UUID');

  // Broadcast panel
  A.click(A.doc.querySelector('#screen-menu .open-live'));
  ok(A.visible('live'), 'broadcast panel opens from the menu');
  ok(A.$('live-url').value === 'http://localhost/scoreboard.html?ch=' + ch,
    'overlay URL carries the channel');
  ok(/indisponible/.test(A.$('live-status').textContent),
    'no relay on a static host is reported');
  A.click(A.$('live-close'));

  // ---------------------------------------------------------- overlay side
  const ov = loadOverlay('?ch=' + ch, { broadcast: true });
  const O = helpers(ov.window);
  await wait(30);
  ok(O.visible('waiting') && /Connecté/.test(O.$('waiting').textContent),
    'overlay got the current state on "hello" and says it is connected');

  // ------------------------------------------------------- prepare a sheet
  A.click(A.doc.querySelector("#screen-menu [data-target='screen-sheet']"));
  ok(A.visible('screen-sheet'), 'match sheet screen opens');
  A.type('sheet-teamA', 'BATT');
  A.type('sheet-teamB', 'Caen');
  A.type('sheet-sideA', 'Alice');
  A.type('sheet-sideB', 'Bruno');
  A.click(A.$('sheet-add-btn'));
  A.$('sheet-rosterA').value = 'Claire\nEmma';
  A.$('sheet-rosterB').value = 'Denis\nFabien';
  A.$('sheet-doubles').value = '1';
  A.click(A.$('sheet-gen-btn'));
  ok(A.doc.querySelectorAll('#sheet-list .sheet-row').length === 6,
    '1 manual + 4 generated singles + 1 double = 6 rows');
  ok(A.$('sheet-name-a').textContent === 'BATT', 'team name shown in the score banner');

  // Doubles input error is explained, not added.
  A.doc.querySelector("input[name=sheet-kind][value='doubles']").checked = true;
  A.type('sheet-sideA', 'Solo');
  A.type('sheet-sideB', 'X / Y');
  A.click(A.$('sheet-add-btn'));
  ok(/2 noms/.test(A.$('sheet-add-state').textContent) &&
     A.doc.querySelectorAll('#sheet-list .sheet-row').length === 6,
    'malformed doubles entry rejected with a hint');

  // Persistence
  const stored = JSON.parse(app.window.localStorage.getItem('arbatt.sheet.v1'));
  ok(stored && stored.encounters.length === 6 && stored.teams[0] === 'BATT',
    'sheet persisted in localStorage');

  // Sheet shown on the overlay on demand
  A.check('live-show-sheet', true);
  await wait(20);
  ok(!O.visible('waiting'), 'hint hidden once something is displayed');
  ok(O.visible('sheet-panel'), 'overlay shows the match sheet when asked');
  ok(O.doc.querySelectorAll('#sp-list .sp-row').length === 6, 'overlay lists 6 encounters');
  ok(O.$('sp-team-a').textContent === 'BATT', 'overlay sheet shows team A');
  A.check('live-show-sheet', false);
  await wait(20);
  ok(!O.visible('sheet-panel'), 'overlay hides the match sheet again');

  // ---------------------------------------------- referee the 1st encounter
  A.click(A.doc.querySelector("#sheet-list button[data-act='play']"));
  ok(A.visible('screen-newmatch'), '▶ opens the pre-filled setup form');
  ok(A.$('nameA').value === 'Alice' && A.$('nameB').value === 'Bruno', 'names pre-filled');
  ok(A.visible('newmatch-encounter'), 'encounter banner shown on the form');
  A.$('gamesToWin').value = '2';
  A.$('form-newmatch').dispatchEvent(
    new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(20);

  ok(O.visible('bug'), 'overlay score bug visible once the match starts');
  ok(O.doc.querySelector('#row-0 .b-name').textContent === 'Alice', 'overlay side 0 name');
  ok(O.doc.querySelector('#row-1 .b-name').textContent === 'Bruno', 'overlay side 1 name');
  ok(O.$('bug-team').textContent === 'BATT 0 – 0 Caen', 'team score chip on the bug');
  ok(/Rencontre 1\/6/.test(O.$('bug-ctx').textContent), 'encounter number in the context');
  ok(O.visible('banner') && /Alice\s+vs\s+Bruno/.test(O.$('banner-main').textContent),
    'intro banner for the new match');
  ok(O.$('row-0').classList.contains('serving'), 'serve indicator on the first server');

  // Score points: the overlay follows, the referee keeps scoring.
  A.click(A.$('card-0'));
  A.click(A.$('card-0'));
  A.click(A.$('card-1'));
  await wait(20);
  ok(O.doc.querySelector('#row-0 .b-points').textContent === '2' &&
     O.doc.querySelector('#row-1 .b-points').textContent === '1', 'points mirrored live');
  ok(O.doc.querySelector('#row-1 .b-points').classList.contains('bump'),
    'point animation on the scoring side');
  ok(O.$('row-1').classList.contains('serving'), 'serve moved after 2 points');

  // Card -> card banner queued on the overlay
  A.click(A.$('btn-carton'));
  A.click(A.doc.querySelectorAll('#sanction-list .sanction-row')[1]
    .querySelectorAll('button')[1]);
  A.click(A.$('sanction-close'));
  await wait(20);
  ok(O.doc.querySelectorAll('#row-1 .b-cards i.y').length === 1, 'yellow card on the bug');

  // Game point flag: Alice to 10-1
  for (let i = 0; i < 8; i++) { A.click(A.$('card-0')); }
  await wait(20);
  ok(O.doc.querySelector('#row-0 .b-flag').textContent === 'BALLE DE MANCHE', 'game point flag');

  // Finish game 1 (rest overlay opens: close it), then game 2.
  A.click(A.$('card-0'));
  await wait(20);
  ok(O.doc.querySelector('#row-0 .b-games').textContent === '1', 'games mirrored');
  ok(O.visible('pill-timer') && /Repos/.test(O.$('pill-timer').textContent),
    'rest countdown shown on the overlay');
  A.click(A.$('timer-close'));
  await wait(20);
  ok(!O.visible('pill-timer'), 'countdown removed when the referee closes it');
  for (let i = 0; i < 10; i++) { A.click(A.$('card-0')); }
  await wait(20);
  ok(O.doc.querySelector('#row-0 .b-flag').textContent === 'BALLE DE MATCH', 'match point flag');
  A.click(A.$('card-0'));
  await wait(30);

  // Result written back to the sheet + overlay shows the winner.
  ok(A.visible('screen-over') && A.visible('over-sheet'), 'result screen offers the sheet');
  const sheet = app.window.arbattStudio.getSheet();
  ok(sheet.encounters[0].result && sheet.encounters[0].result.games.join('-') === '2-0',
    'result recorded on the sheet');
  ok(O.$('row-0').classList.contains('winner'), 'winner highlighted on the bug');
  ok(O.$('bug-team').textContent === 'BATT 1 – 0 Caen', 'team score updated on the overlay');
  ok(O.$('bug-ctx').textContent.indexOf('Terminé') >= 0, 'context says finished');

  A.click(A.$('over-sheet'));
  ok(A.visible('screen-sheet') && A.$('sheet-score-a').textContent === '1',
    'back on the sheet with the team score');
  ok(A.doc.querySelector('#sheet-list .sheet-row').classList.contains('done'),
    'first encounter marked done');

  // ----------------------------------------------- relay publication path
  const app2 = loadApp(null, { relay: true });
  await wait(20);
  const H2 = helpers(app2.window);
  H2.click(H2.doc.querySelector('#screen-menu .open-live'));
  ok(/actif/.test(H2.$('live-status').textContent), 'relay detected and reported active');
  H2.click(H2.doc.querySelector("#screen-menu [data-target='screen-newmatch']"));
  H2.$('form-newmatch').dispatchEvent(
    new app2.window.Event('submit', { bubbles: true, cancelable: true }));
  H2.click(H2.$('card-1'));
  await wait(30);
  const posts = app2.window.__livePosts;
  const last = posts[posts.length - 1];
  ok(posts.length >= 2, 'snapshots POSTed to the relay');
  ok(last && last.protocol === 1 && last.match && last.match.points[1] === 1,
    'last relayed snapshot carries the live score');

  // ------------------------- free matches -> history on the overlay (v0.1.18)
  // Seen on batt.club: on the 2nd free match ("Nouvelle partie", no sheet)
  // the result of the 1st was visible nowhere.
  const app3 = loadApp(null, { broadcast: true });
  await wait(10);
  const H3 = helpers(app3.window);
  const ov3 = loadOverlay('?ch=' + app3.window.arbattStudio.getChannel(), { broadcast: true });
  const O3 = helpers(ov3.window);
  await wait(20);
  H3.click(H3.doc.querySelector('#screen-menu .open-live'));
  ok(H3.$('live-history-clear').disabled, 'history clear button disabled when empty');
  H3.check('live-show-sheet', true);
  H3.click(H3.$('live-close'));
  const playFree = async function (a, b) {
    H3.click(H3.doc.querySelector("#screen-menu [data-target='screen-newmatch']"));
    H3.$('nameA').value = a;
    H3.$('nameB').value = b;
    H3.$('gamesToWin').value = '2';
    H3.$('form-newmatch').dispatchEvent(
      new app3.window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 11; i++) { H3.click(H3.$('card-0')); }
    H3.click(H3.$('timer-close'));
    for (let i = 0; i < 11; i++) { H3.click(H3.$('card-0')); }
    await wait(20);
  };
  // 2026-10-11 (v0.1.19): the ticked box must always show something.
  await wait(20); // let the overlay receive the snapshot of the checkbox
  ok(O3.visible('sheet-panel') && /Aucune partie/.test(O3.$('sp-list').textContent),
    'no sheet and no history yet: empty "Résultats" panel with a message');
  await playFree('Gil', 'Hugo');
  ok(app3.window.arbattStudio.getHistory().encounters.length === 1,
    'free match result kept in the history');
  // 2nd free match starts: the 1st result stays on screen.
  H3.click(H3.doc.querySelector("#screen-over [data-target='screen-newmatch']") ||
    H3.doc.querySelector("[data-target='screen-menu']"));
  H3.click(H3.doc.querySelector("#screen-menu [data-target='screen-newmatch']"));
  H3.$('nameA').value = 'Ines';
  H3.$('nameB').value = 'Jules';
  H3.$('form-newmatch').dispatchEvent(
    new app3.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(20);
  ok(O3.visible('sheet-panel') && O3.$('sheet-panel').classList.contains('history'),
    'overlay shows the free-match results panel during the next match');
  const rows3 = O3.doc.querySelectorAll('#sp-list .sp-row');
  ok(rows3.length === 1 && /Gil/.test(rows3[0].textContent) &&
     rows3[0].querySelector('.sp-res').textContent === '2-0',
    'previous result listed with its score');
  ok(!O3.visible('bug-team'), 'no team score chip for free matches');
  ok(JSON.parse(app3.window.localStorage.getItem('arbatt.history.v1')).encounters.length === 1,
    'history persisted in localStorage');
  H3.click(H3.doc.querySelector('#screen-score .open-live') ||
    H3.doc.querySelector('.open-live'));
  H3.click(H3.$('live-history-clear'));
  H3.click(H3.$('live-history-clear'));
  await wait(20);
  ok(app3.window.arbattStudio.getHistory() === null &&
     O3.doc.querySelectorAll('#sp-list .sp-row').length === 0,
    'history cleared (two taps) and emptied on the overlay');

  console.log(fails === 0 ? 'ALL LIVE TESTS PASSED' : fails + ' LIVE TEST(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
}

run().catch(function (e) { console.log('FAIL: exception', e); process.exit(1); });
