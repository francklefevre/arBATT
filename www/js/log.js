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
 * Client-side centralised logging facility.
 *
 * Mirrors the server-side policy: every log line goes through the single
 * routing function `arbattLog(tag, eid, message)` and is prefixed with a
 * timestamp, a bracketed [TAG] and an event number (#NNNN). The set of
 * enabled tags is configurable at runtime through `ARBATT_LOG.tags`.
 *
 * Event number convention in front-end code: 2xxx (app), 3xxx (scorer).
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  // Default tag routing. Can be tweaked live from the console, e.g.
  // ARBATT_LOG.tags.DEBUG = true;
  var ARBATT_LOG = {
    enabled: true,
    tags: {
      BOOT: true,
      UI: true,
      SCORE: true,
      TIMER: true,
      SW: true,    // service worker lifecycle
      WARN: true,
      ERROR: true,
      DEBUG: false
    },
    // In-memory ring buffer, handy for an on-screen debug console later.
    buffer: [],
    bufferMax: 500
  };

  function stamp() {
    // Local ISO-like timestamp with milliseconds.
    var d = new Date();
    return d.toISOString();
  }

  function pad4(n) {
    n = String(n);
    while (n.length < 4) { n = "0" + n; }
    return n;
  }

  /**
   * Single routing point for all client-side logging.
   * @param {string} tag  Category, e.g. "UI", "SCORE", "ERROR".
   * @param {number} eid  Stable event number identifying the call site.
   * @param {string} message Human readable message.
   */
  function arbattLog(tag, eid, message) {
    var line = stamp() + " [" + tag + "] #" + pad4(eid) + " " + message;

    ARBATT_LOG.buffer.push(line);
    if (ARBATT_LOG.buffer.length > ARBATT_LOG.bufferMax) {
      ARBATT_LOG.buffer.shift();
    }

    if (!ARBATT_LOG.enabled) { return; }
    var on = ARBATT_LOG.tags[tag];
    if (on === false) { return; }

    if (tag === "ERROR") {
      console.error(line);
    } else if (tag === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  global.ARBATT_LOG = ARBATT_LOG;
  global.arbattLog = arbattLog;
})(window);
