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
 * Test runner: executes every test suite in its own Node process and prints a
 * compact PASS/FAIL summary. Exit code is non-zero if any suite fails.
 * Run with:  node tests/run_all.js   (or: npm test)
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  'test_scorer.js',
  'test_timer.js',
  'test_doubles.js',
  'test_acceleration.js',
  'test_sanctions.js',
  'test_chrono.js',
  'test_ui_dom.js',
  // 2026-10-06 (v0.1.12): scoreboard / OBS mode.
  'test_sheet.js',
  'test_live_dom.js',
  'test_live_relay.py',
  // 2026-10-07 (v0.1.14): single app-config builder + versioned file in sync.
  'test_app_config.py',
  // 2026-10-11 (v0.1.15): no silent config fallback in app.js.
  'test_config_error_dom.js',
  // 2026-10-11 (v0.1.20): teams of the free matches.
  'test_teams.js',
  // 2026-10-11 (v0.1.20): courtside tablet display.
  'test_court_dom.js'
];

let failed = 0;
console.log('arBATT — running ' + SUITES.length + ' test suites\n');

SUITES.forEach(function (file) {
  const full = path.join(__dirname, file);
  // .py suites (server-side relay) run with python3, the others with Node.
  const cmd = file.endsWith('.py') ? 'python3' : process.execPath;
  const res = spawnSync(cmd, [full], { encoding: 'utf8', timeout: 60000 });
  const out = (res.stdout || '') + (res.stderr || '');
  // 2026-10-06: summary taken from STDOUT (the suite's verdict line); stderr
  // warnings printed later used to hide it.
  const lastLine = (res.stdout || out).trim().split('\n').filter(Boolean).pop() ||
    '(no output)';
  if (res.status === 0) {
    console.log('  ✓ ' + file + ' — ' + lastLine);
  } else {
    failed++;
    console.log('  ✗ ' + file + ' — FAILED (exit ' + res.status + ')');
    // Show the failing lines to make CI logs actionable.
    out.split('\n').filter(function (l) { return l.indexOf('FAIL') === 0; })
      .forEach(function (l) { console.log('       ' + l); });
  }
});

console.log('\n' + (failed === 0
  ? 'ALL SUITES PASSED'
  : failed + ' SUITE(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
