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
 * ---------------------------------------------------------------------------
 * Countdown timer engine (no DOM, no real-clock dependency).
 *
 * Used for the warm-up period (2 min max) and for time-outs (1 min). The
 * current time source is INJECTABLE (`opts.now`) so the engine can be unit
 * tested deterministically without waiting for real seconds to elapse.
 *
 * Design: rather than decrementing a counter on a tick, the timer stores the
 * accumulated running time and recomputes `remaining()` from the time source.
 * This keeps it accurate across pause/resume and immune to missed ticks.
 *
 * Event number convention in this file: 4xxx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  function log(eid, msg) {
    if (typeof global.arbattLog === "function") {
      global.arbattLog("TIMER", eid, msg);
    }
  }

  var defaultNow = (typeof Date.now === "function")
    ? function () { return Date.now(); }
    : function () { return new Date().getTime(); };

  /**
   * CountdownTimer
   *
   * @param {number} durationMs       Total countdown duration in milliseconds.
   * @param {Object} [opts]
   * @param {function():number} [opts.now]  Time source returning ms (testable).
   * @param {string} [opts.label]     Optional human label (e.g. "Échauffement").
   */
  function CountdownTimer(durationMs, opts) {
    opts = opts || {};
    this.durationMs = Math.max(0, durationMs | 0);
    this._now = opts.now || defaultNow;
    this.label = opts.label || "";
    this._running = false;
    this._accumulatedMs = 0; // running time banked while paused
    this._startedAt = 0;     // time source value at last start()
  }

  /** Internal: total elapsed running time so far. */
  CountdownTimer.prototype._elapsed = function () {
    var e = this._accumulatedMs;
    if (this._running) { e += (this._now() - this._startedAt); }
    return e;
  };

  /** Start (or resume) the countdown. No-op if already running or finished. */
  CountdownTimer.prototype.start = function () {
    if (this._running) { return false; }
    if (this.isFinished()) { return false; }
    this._running = true;
    this._startedAt = this._now();
    log(4000, "start " + this.label + " (" + this.durationMs + "ms)");
    return true;
  };

  /** Pause the countdown, banking the elapsed running time. */
  CountdownTimer.prototype.pause = function () {
    if (!this._running) { return false; }
    this._accumulatedMs += (this._now() - this._startedAt);
    this._running = false;
    log(4001, "pause " + this.label + " remaining=" + this.remainingMs() + "ms");
    return true;
  };

  /** Stop and reset to the full duration. */
  CountdownTimer.prototype.reset = function () {
    this._running = false;
    this._accumulatedMs = 0;
    this._startedAt = 0;
    log(4002, "reset " + this.label);
    return true;
  };

  /** Milliseconds remaining (never negative). */
  CountdownTimer.prototype.remainingMs = function () {
    var r = this.durationMs - this._elapsed();
    return r > 0 ? r : 0;
  };

  /** Whole seconds remaining, rounded UP (so "1s" shows until truly zero). */
  CountdownTimer.prototype.remainingSeconds = function () {
    return Math.ceil(this.remainingMs() / 1000);
  };

  /** True once the countdown has reached zero. */
  CountdownTimer.prototype.isFinished = function () {
    return this._elapsed() >= this.durationMs;
  };

  CountdownTimer.prototype.isRunning = function () {
    return this._running && !this.isFinished();
  };

  /** Fraction elapsed in [0, 1], handy for a progress ring/bar. */
  CountdownTimer.prototype.progress = function () {
    if (this.durationMs === 0) { return 1; }
    var p = this._elapsed() / this.durationMs;
    if (p < 0) { return 0; }
    return p > 1 ? 1 : p;
  };

  /** Format mm:ss from a number of seconds. */
  function formatMMSS(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  var api = { CountdownTimer: CountdownTimer, formatMMSS: formatMMSS };
  global.arbattTimer = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
