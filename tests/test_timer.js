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
 * Headless unit tests for the countdown timer engine.
 * Run with:  node tests/test_timer.js
 *
 * A controllable fake clock is injected so the tests are deterministic and
 * instantaneous (no real seconds elapse).
 */

const { CountdownTimer, formatMMSS } = require('../www/js/timer.js');

let fails = 0;
function ok(cond, msg) {
  if (!cond) { console.log('FAIL:', msg); fails++; }
  else { console.log('ok  :', msg); }
}

// A fake clock we can advance by hand.
function makeClock() {
  let t = 1000;
  return {
    now: function () { return t; },
    advance: function (ms) { t += ms; }
  };
}

// --- formatMMSS -------------------------------------------------------------
ok(formatMMSS(0) === '00:00', 'format 0 -> 00:00');
ok(formatMMSS(5) === '00:05', 'format 5 -> 00:05');
ok(formatMMSS(65) === '01:05', 'format 65 -> 01:05');
ok(formatMMSS(120) === '02:00', 'format 120 -> 02:00');

// --- basic countdown --------------------------------------------------------
let clk = makeClock();
let t = new CountdownTimer(120000, { now: clk.now, label: 'warmup' });
ok(t.remainingMs() === 120000, 'initial remaining = duration');
ok(t.remainingSeconds() === 120, 'initial remaining seconds = 120');
ok(!t.isRunning(), 'not running before start');
ok(!t.isFinished(), 'not finished before start');

t.start();
ok(t.isRunning(), 'running after start');
clk.advance(1000);
ok(t.remainingMs() === 119000, 'after 1s remaining = 119000');
ok(t.remainingSeconds() === 119, 'after 1s remaining seconds = 119');

clk.advance(59000); // total 60s elapsed
ok(t.remainingMs() === 60000, 'after 60s remaining = 60000');
ok(Math.abs(t.progress() - 0.5) < 1e-9, 'progress = 0.5 at half');

// --- pause / resume banks elapsed time -------------------------------------
t.pause();
ok(!t.isRunning(), 'paused -> not running');
clk.advance(10000); // time passes while paused; must NOT count
ok(t.remainingMs() === 60000, 'paused: remaining unchanged after 10s wall time');
t.start(); // resume
clk.advance(60000); // consume the rest
ok(t.remainingMs() === 0, 'after resume + 60s remaining = 0');
ok(t.isFinished(), 'finished at zero');
ok(!t.isRunning(), 'finished -> not running');

// --- never goes negative ----------------------------------------------------
clk.advance(999999);
ok(t.remainingMs() === 0, 'remaining clamped at 0 (no negative)');
ok(t.remainingSeconds() === 0, 'remaining seconds clamped at 0');
ok(t.progress() === 1, 'progress clamped at 1');

// --- cannot start once finished --------------------------------------------
ok(t.start() === false, 'start refused once finished');

// --- reset restores full duration ------------------------------------------
t.reset();
ok(t.remainingMs() === 120000, 'reset restores full duration');
ok(!t.isFinished(), 'reset clears finished');
ok(t.start() === true, 'start works again after reset');

// --- remainingSeconds rounds UP --------------------------------------------
clk = makeClock();
let t2 = new CountdownTimer(60000, { now: clk.now });
t2.start();
clk.advance(59500); // 500ms left
ok(t2.remainingSeconds() === 1, 'rounds up: 500ms left shows 1s');
clk.advance(500); // exactly 0
ok(t2.remainingSeconds() === 0, 'exactly 0 shows 0s');

// --- timeout (60s) and warmup (120s) durations ------------------------------
let to = new CountdownTimer(60000, { now: makeClock().now });
ok(to.remainingSeconds() === 60, 'timeout default 60s');
let wu = new CountdownTimer(120000, { now: makeClock().now });
ok(wu.remainingSeconds() === 120, 'warmup default 120s');

console.log(fails === 0 ? '\nALL TIMER TESTS PASSED' : '\n' + fails + ' TIMER TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
