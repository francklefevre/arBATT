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
  'test_ui_dom.js'
];

let failed = 0;
console.log('arBATT — running ' + SUITES.length + ' test suites\n');

SUITES.forEach(function (file) {
  const full = path.join(__dirname, file);
  const res = spawnSync(process.execPath, [full], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const lastLine = out.trim().split('\n').filter(Boolean).pop() || '(no output)';
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
