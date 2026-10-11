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
 * Live link between the referee app (publisher) and the public scoreboard
 * overlay (subscriber) — "scoreboard / OBS mode".
 *
 * 2026-10-06 (v0.1.12): created. Two transports are used SIMULTANEOUSLY (they
 * are complementary, not a fallback of one another):
 *
 *   1. BroadcastChannel "arbatt-live-<channel>": instant, offline, but only
 *      between tabs/windows of the SAME browser on the SAME device (e.g. the
 *      referee app in one window and the overlay captured by OBS "Window
 *      capture" in another).
 *   2. HTTP relay (/api/live/<channel>): server.py (arbatt_live.py) or, on
 *      static Apache/PHP hosting, www/api/live.php (same API, v0.1.13).
 *      The referee's phone POSTs, the OBS "Browser source" (a separate
 *      Chromium) receives through Server-Sent Events. Detected with
 *      GET api/live/_info (a host without relay answers 404 -> relay reported
 *      "unavailable", nothing retried).
 *
 * Every message is a FULL snapshot tagged with the publisher instance id
 * (`pub`, a UUID per page load) and a sequence number (`seq`). A subscriber
 * keeps only snapshots newer than the last one it rendered, so receiving the
 * same snapshot through both transports is harmless.
 *
 * Event number convention in this file: 8xxx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  var PROTOCOL = 1;
  var BC_PREFIX = "arbatt-live-";
  var API = "api/live/";

  function log(tag, eid, msg) {
    if (typeof global.arbattLog === "function") { global.arbattLog(tag, eid, msg); }
  }

  /** Fresh UUID, delegated to the sheet module's implementation (single source). */
  function uuid() { return global.arbattSheet.uuid(); }

  /**
   * Probe the HTTP relay. Resolves with {relay, tokenRequired} or null when
   * the relay is not served (static hosting) — this is an expected situation,
   * logged as INFO, not an error.
   */
  function detectRelay(base) {
    if (typeof global.fetch !== "function") { return Promise.resolve(null); }
    return global.fetch((base || "") + API + "_info", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        log("LIVE", 8000, info ? "HTTP relay available (token " +
          (info.tokenRequired ? "required" : "off") + ")" :
          "No HTTP relay on this host (static hosting)");
        return info;
      })
      .catch(function (e) {
        log("LIVE", 8001, "HTTP relay probe failed: " + e);
        return null;
      });
  }

  function openBroadcast(channel) {
    if (typeof global.BroadcastChannel !== "function") {
      log("WARN", 8002, "BroadcastChannel unsupported: same-device link off");
      return null;
    }
    return new global.BroadcastChannel(BC_PREFIX + channel);
  }

  // ------------------------------------------------------------- publisher
  /**
   * LivePublisher — used by the referee app.
   * @param {Object} opts
   * @param {string} opts.channel  Channel id (UUID).
   * @param {string} [opts.base]   URL prefix of the relay ("" = same origin).
   * @param {boolean} [opts.relay] Whether to POST to the HTTP relay.
   * @param {string} [opts.token]  X-Arbatt-Token for a protected relay.
   * @param {Function} [opts.onStatus] Called with ("ok"|"error"|"off", detail).
   */
  function LivePublisher(opts) {
    this.channel = opts.channel;
    this.base = opts.base || "";
    this.relay = !!opts.relay;
    this.token = opts.token || "";
    this.onStatus = opts.onStatus || function () {};
    this.pub = uuid();
    this.seq = 0;
    this.last = null;          // last published snapshot (answers "hello")
    this._inflight = false;    // one POST at a time...
    this._pending = null;      // ...the newest snapshot waits for the next slot
    var self = this;
    this.bc = openBroadcast(this.channel);
    if (this.bc) {
      // A freshly opened overlay asks for the current state.
      this.bc.onmessage = function (ev) {
        if (ev.data && ev.data.type === "hello" && self.last) {
          self.bc.postMessage({ type: "state", state: self.last });
        }
      };
    }
    log("LIVE", 8010, "Publisher on channel " + this.channel +
      " (relay " + (this.relay ? "on" : "off") + ")");
  }

  LivePublisher.prototype.publish = function (state) {
    state.protocol = PROTOCOL;
    state.channel = this.channel;
    state.pub = this.pub;
    state.seq = ++this.seq;
    state.sentAt = Date.now();
    this.last = state;
    if (this.bc) { this.bc.postMessage({ type: "state", state: state }); }
    if (this.relay) { this._post(state); }
  };

  LivePublisher.prototype._post = function (state) {
    if (this._inflight) { this._pending = state; return; }
    this._inflight = true;
    var self = this;
    var headers = { "Content-Type": "application/json" };
    if (this.token) { headers["X-Arbatt-Token"] = this.token; }
    global.fetch(this.base + API + encodeURIComponent(this.channel), {
      method: "POST", headers: headers, body: JSON.stringify(state)
    }).then(function (r) {
      if (r.ok) {
        self.onStatus("ok", "seq " + state.seq);
      } else {
        log("ERROR", 8011, "Relay refused snapshot: HTTP " + r.status);
        self.onStatus("error", "HTTP " + r.status);
      }
    }).catch(function (e) {
      log("ERROR", 8012, "Relay POST failed: " + e);
      self.onStatus("error", String(e));
    }).then(function () {
      self._inflight = false;
      if (self._pending) {
        var next = self._pending;
        self._pending = null;
        self._post(next);
      }
    });
  };

  LivePublisher.prototype.close = function () {
    if (this.bc) { this.bc.close(); this.bc = null; }
  };

  // ------------------------------------------------------------ subscriber
  /**
   * LiveSubscriber — used by the overlay page.
   * @param {Object} opts
   * @param {string} opts.channel
   * @param {string} [opts.base]
   * @param {boolean} [opts.relay]   Open the SSE stream of the HTTP relay.
   * @param {Function} opts.onState  Called with each NEWER snapshot.
   * @param {Function} [opts.onStatus] ("ok"|"error", transportName).
   */
  function LiveSubscriber(opts) {
    this.channel = opts.channel;
    this.onState = opts.onState;
    this.onStatus = opts.onStatus || function () {};
    this.lastPub = null;
    this.lastSeq = 0;
    var self = this;

    this.bc = openBroadcast(this.channel);
    if (this.bc) {
      this.bc.onmessage = function (ev) {
        if (ev.data && ev.data.type === "state") { self._deliver(ev.data.state, "bc"); }
      };
      this.bc.postMessage({ type: "hello" });
    }

    this.es = null;
    if (opts.relay && typeof global.EventSource === "function") {
      var url = (opts.base || "") + API + encodeURIComponent(this.channel) + "/events";
      this.es = new global.EventSource(url);
      this.es.onopen = function () {
        log("LIVE", 8020, "SSE stream open: " + url);
        self.onStatus("ok", "relay");
      };
      this.es.onmessage = function (ev) {
        try {
          self._deliver(JSON.parse(ev.data), "relay");
        } catch (e) {
          log("ERROR", 8021, "Bad SSE payload: " + e);
        }
      };
      // EventSource reconnects by itself; we only report the outage.
      // 2026-10-06 (v0.1.13): the PHP relay ENDS each SSE response on purpose
      // (shared-host time limits) and EventSource then reconnects: that
      // normal cycle (readyState CONNECTING) is logged as LIVE info, not WARN,
      // so the console is not flooded every 25 s. A CLOSED stream (fatal,
      // e.g. relay gone) is still a WARN.
      this.es.onerror = function () {
        if (self.es && self.es.readyState === global.EventSource.CONNECTING) {
          log("LIVE", 8026, "SSE stream ended, reconnecting");
          return;
        }
        log("WARN", 8022, "SSE stream closed");
        self.onStatus("error", "relay");
      };
    }
    log("LIVE", 8023, "Subscriber on channel " + this.channel);
  }

  /** Keep only snapshots newer than the last rendered one (dedupe 2 transports). */
  LiveSubscriber.prototype._deliver = function (state, via) {
    if (!state || state.protocol !== PROTOCOL) {
      log("WARN", 8024, "Ignored snapshot with protocol " + (state && state.protocol));
      return;
    }
    // A new publisher instance (app reloaded) restarts its sequence at 1.
    if (state.pub === this.lastPub && state.seq <= this.lastSeq) { return; }
    this.lastPub = state.pub;
    this.lastSeq = state.seq;
    log("DEBUG", 8025, "Snapshot seq " + state.seq + " via " + via);
    this.onState(state);
  };

  LiveSubscriber.prototype.close = function () {
    if (this.bc) { this.bc.close(); this.bc = null; }
    if (this.es) { this.es.close(); this.es = null; }
  };

  /**
   * Open the subscription of a display page (overlay, courtside tablet):
   * detect the HTTP relay unless wantRelay is false, then subscribe.
   * 2026-10-11 (v0.1.20): factorised out of scoreboard.js for court.js.
   * Returns a Promise of the LiveSubscriber.
   */
  function subscribe(channel, wantRelay, onState) {
    return (wantRelay ? detectRelay("") : Promise.resolve(null)).then(function (info) {
      return new LiveSubscriber({ channel: channel, relay: !!info, onState: onState });
    });
  }

  // ------------------------------------------------- display-side helpers
  // 2026-10-11 (v0.1.20): shared by scoreboard.js and court.js (were local to
  // scoreboard.js).

  /** "game" / "match" when `side` is one point from winning, else "". */
  function pointFlag(m, side) {
    if (m.finished || !m.pointsPerGame) { return ""; }
    var me = m.points[side], other = m.points[1 - side];
    if (me < m.pointsPerGame - 1 || me <= other) { return ""; }
    var gamesToWin = (m.bestOf + 1) / 2;
    return m.games[side] === gamesToWin - 1 ? "match" : "game";
  }

  /** Countdown of a snapshot + local receipt time (no clock skew). */
  function receiveTimer(timer) {
    return timer ? {
      label: timer.label,
      remainingMs: timer.remainingMs,
      running: timer.running,
      at: Date.now()
    } : null;
  }

  /** Whole seconds left on a received countdown (see receiveTimer). */
  function timerSecondsLeft(ts) {
    var ms = ts.remainingMs - (ts.running ? Date.now() - ts.at : 0);
    return Math.max(0, Math.ceil(ms / 1000));
  }

  /** "m:ss" */
  function formatSeconds(secs) {
    var mm = Math.floor(secs / 60), ss = secs % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }

  // -------------------------------------------------------- match snapshot
  /**
   * Match part of a live snapshot, built from a scoring-engine view
   * (TTScorer / DoublesScorer `view()`). Shared by the referee app and the
   * overlay's demo mode so both always produce the same shape.
   * Everything is expressed per SIDE (0/1 = player in singles, pair in
   * doubles) except the per-player arrays (names, infractions).
   *
   * @param {Object} v     engine view
   * @param {Object} opts  {mode, matchId, pointsPerGame, returnCount,
   *                        accelReturns, encounterId}
   */
  function matchSnapshot(v, opts) {
    var doubles = opts.mode === "doubles";
    var side = function (s) {
      return doubles ? v.names[2 * s] + " / " + v.names[2 * s + 1] : v.names[s];
    };
    var servingSide = doubles ? v.servingTeam : v.server;
    return {
      matchId: opts.matchId,
      mode: opts.mode,
      names: v.names,
      sides: [side(0), side(1)],
      points: v.points,
      games: v.games,
      gameIndex: v.gameIndex,
      bestOf: v.bestOf,
      pointsPerGame: opts.pointsPerGame,
      isDeciding: v.isDeciding,
      finished: v.finished,
      winner: v.finished ? v.winner : null,
      servingSide: v.finished ? null : servingSide,
      server: v.finished ? null : v.server,
      receiver: v.finished ? null : v.receiver,
      leftSide: doubles ? v.leftTeam : v.leftPlayer,
      infractions: v.infractions,
      refereeCalled: v.refereeCalled,
      accelerated: v.accelerated,
      returnCount: opts.returnCount || 0,
      accelReturns: opts.accelReturns,
      timeoutsUsed: v.timeoutsUsed,
      completedGames: v.completedGames,
      encounterId: opts.encounterId || null
    };
  }

  // -------------------------------------------------------------- demo mode
  /**
   * Fake singles match driven by the real scoring engine (needs scorer.js),
   * pushed to onState every 1.5 s: positioning aid for the display pages.
   * 2026-10-11 (v0.1.20): moved from scoreboard.js (shared with court.js).
   */
  function startDemo(onState, showSheet) {
    var m = new global.arbattScorer.TTScorer({
      playerNames: ["Alice Martin", "Bruno Lefort"], gamesToWin: 3
    });
    var id = "demo";
    var seq = 0;
    var sheet = {
      title: "Démo arBATT", teams: ["BATT", "Visiteurs"], score: [2, 1],
      encounters: [
        { id: "e1", num: 1, kind: "singles", sides: ["Claire", "Denis"], result: { winner: 0, games: [3, 1] } },
        { id: "e2", num: 2, kind: "singles", sides: ["Emma", "Fabien"], result: { winner: 1, games: [2, 3] } },
        { id: "e3", num: 3, kind: "doubles", sides: ["Claire / Emma", "Denis / Fabien"], result: { winner: 0, games: [3, 0] } },
        { id: id, num: 4, kind: "singles", sides: ["Alice Martin", "Bruno Lefort"], result: null }
      ]
    };
    function push() {
      onState({
        protocol: PROTOCOL, pub: "demo", seq: ++seq,
        display: { scorebug: true, sheet: !!showSheet },
        timer: null, sheet: sheet,
        match: matchSnapshot(m.view(), {
          mode: "singles", matchId: "demo", pointsPerGame: 11,
          accelReturns: 13, encounterId: id
        })
      });
    }
    push();
    return setInterval(function () {
      if (m.view().finished) { return; }
      if (Math.random() < 0.03) { m.sanction(Math.random() < 0.5 ? 0 : 1); }
      else { m.pointTo(Math.random() < 0.55 ? 0 : 1); }
      push();
    }, 1500);
  }

  var api = {
    PROTOCOL: PROTOCOL,
    matchSnapshot: matchSnapshot,
    detectRelay: detectRelay,
    LivePublisher: LivePublisher,
    LiveSubscriber: LiveSubscriber,
    subscribe: subscribe,
    pointFlag: pointFlag,
    receiveTimer: receiveTimer,
    timerSecondsLeft: timerSecondsLeft,
    formatSeconds: formatSeconds,
    startDemo: startDemo
  };
  global.arbattLive = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
