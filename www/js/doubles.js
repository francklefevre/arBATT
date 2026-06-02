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
 * Table tennis DOUBLES scoring engine (state machine, no DOM dependency).
 *
 * Players are indexed 0..3:  team 0 = {0, 1}   team 1 = {2, 3}.
 * partner(p) = p XOR 1.
 *
 * Within a game the 4 players serve in a fixed 4-cycle. With
 *   serveOrder = [S, R, S', R']
 * (S = first server, R = first receiver, S' = S's partner, R' = R's partner):
 *   - server   at service block k = serveOrder[k mod 4]
 *   - receiver at service block k = serveOrder[(k+1) mod 4]
 * The block count comes from the shared serviceBlocks() helper (scorer.js),
 * so service changes every 2 points and every point from 10-10, exactly like
 * singles.
 *
 * Rules specific to doubles (FFTT manual, p.9):
 *   - The serving pair chooses its first server; the first receiver is
 *     designated accordingly. arBATT lets the umpire set (firstServer,
 *     firstReceiver) at the start of each game (sane defaults provided).
 *   - In the DECIDING game, as soon as a pair reaches 5 points, the players
 *     change ends AND the receiving order is reversed. We model the reversal
 *     as "receiver = partner of the base receiver" from that moment on.
 *
 * Everything (server, receiver, ends, inversion) is DERIVED from the state so
 * that undo is always exact. Event number convention in this file: 5xxx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  // Resolve the shared helpers in both browser and Node.
  var acceleratedBlocks, sanctionForCount;
  if (global.arbattScorer && global.arbattScorer.acceleratedBlocks) {
    acceleratedBlocks = global.arbattScorer.acceleratedBlocks;
    sanctionForCount = global.arbattScorer.sanctionForCount;
  } else if (typeof require === "function") {
    var scorer = require("./scorer.js");
    acceleratedBlocks = scorer.acceleratedBlocks;
    sanctionForCount = scorer.sanctionForCount;
  }

  function log(eid, msg) {
    if (typeof global.arbattLog === "function") {
      global.arbattLog("SCORE", eid, msg);
    }
  }

  function teamOf(player) { return player < 2 ? 0 : 1; }
  function partnerOf(player) { return player ^ 1; }
  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

  /**
   * Build the canonical serve order from a first server and first receiver.
   * @returns {number[]} [S, R, partner(S), partner(R)]
   */
  function buildServeOrder(firstServer, firstReceiver) {
    return [firstServer, firstReceiver, partnerOf(firstServer), partnerOf(firstReceiver)];
  }

  /**
   * DoublesScorer
   *
   * @param {Object} opts
   * @param {string[]} opts.playerNames    Four names: [t0a, t0b, t1a, t1b].
   * @param {number}  [opts.pointsPerGame=11]
   * @param {number}  [opts.winBy=2]
   * @param {number}  [opts.gamesToWin=3]
   * @param {number}  [opts.firstServer=0]   Player index serving first (game 1).
   * @param {number}  [opts.firstReceiver=2] Player index receiving first (game 1).
   * @param {number}  [opts.firstTeamLeftSide=0] Team on the left end in game 1.
   */
  function DoublesScorer(opts) {
    opts = opts || {};
    var names = (opts.playerNames ||
      ["Joueur A1", "Joueur A2", "Joueur B1", "Joueur B2"]).slice(0, 4);
    this.config = {
      playerNames: names,
      pointsPerGame: opts.pointsPerGame || 11,
      winBy: opts.winBy || 2,
      gamesToWin: opts.gamesToWin || 3,
      firstTeamLeftSide:
        typeof opts.firstTeamLeftSide === "number" ? opts.firstTeamLeftSide : 0
    };
    var firstServer = typeof opts.firstServer === "number" ? opts.firstServer : 0;
    var firstReceiver = typeof opts.firstReceiver === "number" ? opts.firstReceiver : 2;
    this._validatePair(firstServer, firstReceiver);

    this._undo = [];
    this.state = {
      points: [0, 0],
      games: [0, 0],
      completedGames: [],
      gameIndex: 0,
      serveOrder: buildServeOrder(firstServer, firstReceiver),
      timeoutsUsed: [false, false], // one time-out per PAIR (team)
      infractions: [0, 0, 0, 0],    // cumulative misconduct count per player
      refereeCalled: false,
      accelerated: false,           // acceleration ("expedite") rule active?
      accelGame: null,
      accelTotal: null,
      finished: false,
      winner: null
    };
    log(5000, "New doubles: " +
      names[0] + "/" + names[1] + " vs " + names[2] + "/" + names[3] +
      " | best of " + (2 * this.config.gamesToWin - 1) +
      " | first server=" + names[firstServer] + " receiver=" + names[firstReceiver]);
  }

  DoublesScorer.prototype._validatePair = function (server, receiver) {
    if (teamOf(server) === teamOf(receiver)) {
      throw new Error("Server and receiver must be on opposite teams");
    }
  };

  DoublesScorer.prototype._snapshot = function () {
    this._undo.push(deepCopy(this.state));
    if (this._undo.length > 400) { this._undo.shift(); }
  };

  // --- Derived getters -------------------------------------------------------

  DoublesScorer.prototype.isDecidingGame = function () {
    var g = this.config.gamesToWin - 1;
    return this.state.games[0] === g && this.state.games[1] === g;
  };

  /** True once the receiving order has been reversed (deciding game, 5 pts). */
  DoublesScorer.prototype.isReceivingInverted = function () {
    if (!this.isDecidingGame()) { return false; }
    var half = Math.floor(this.config.pointsPerGame / 2); // 5 for 11-pt games
    return this.state.points[0] >= half || this.state.points[1] >= half;
  };

  /** In-game total from which the every-point cadence applies (null if off). */
  DoublesScorer.prototype._accelFromTotal = function () {
    if (!this.state.accelerated) { return null; }
    return (this.state.accelGame === this.state.gameIndex)
      ? this.state.accelTotal : 0;
  };

  /** Current service block index (acceleration-aware). */
  DoublesScorer.prototype._blocks = function () {
    return acceleratedBlocks(this.state.points[0], this.state.points[1],
      this.config.pointsPerGame, this._accelFromTotal());
  };

  /** Current serving player index (0..3), or null when finished. */
  DoublesScorer.prototype.server = function () {
    if (this.state.finished) { return null; }
    return this.state.serveOrder[this._blocks() % 4];
  };

  /** Current receiving player index (0..3), or null when finished. */
  DoublesScorer.prototype.receiver = function () {
    if (this.state.finished) { return null; }
    var base = this.state.serveOrder[(this._blocks() + 1) % 4];
    return this.isReceivingInverted() ? partnerOf(base) : base;
  };

  DoublesScorer.prototype.servingTeam = function () {
    var s = this.server();
    return s === null ? null : teamOf(s);
  };

  /** Team index (0/1) currently on the LEFT end. */
  DoublesScorer.prototype.leftTeam = function () {
    var parity = this.state.gameIndex; // ends swap every game
    if (this.isDecidingGame()) {
      var half = Math.floor(this.config.pointsPerGame / 2);
      if (this.state.points[0] >= half || this.state.points[1] >= half) {
        parity += 1; // mid-game end change in the deciding game (at 5 pts)
      }
    }
    return (this.config.firstTeamLeftSide + parity) % 2;
  };

  DoublesScorer.prototype.wipeDue = function () {
    var total = this.state.points[0] + this.state.points[1];
    return total > 0 && total % 6 === 0 && !this.state.finished;
  };

  DoublesScorer.prototype.announce = function () {
    var names = this.config.playerNames;
    if (this.state.finished) {
      var w = this.state.winner;
      return names[2 * w] + "/" + names[2 * w + 1] + " gagne " +
        this.state.games[w] + " manches à " + this.state.games[1 - w];
    }
    var s = this.server();
    var st = teamOf(s);
    return this.state.points[st] + " - " + this.state.points[1 - st] +
      " (service " + names[s] + " sur " + names[this.receiver()] + ")";
  };

  // --- Game / match transitions ---------------------------------------------

  DoublesScorer.prototype._defaultNextOrder = function (prevOrder) {
    // Rotate the previous order left by one: the team that received first now
    // serves first, keeping a valid alternating rotation. The umpire can
    // override this with setGameStart() before resuming play.
    return [prevOrder[1], prevOrder[2], prevOrder[3], prevOrder[0]];
  };

  DoublesScorer.prototype._checkGameEnd = function () {
    var p = this.state.points;
    var need = this.config.pointsPerGame;
    var by = this.config.winBy;
    var w = -1;
    if (p[0] >= need && p[0] - p[1] >= by) { w = 0; }
    else if (p[1] >= need && p[1] - p[0] >= by) { w = 1; }
    if (w === -1) { return; }

    this.state.completedGames.push({ points: [p[0], p[1]], winner: w });
    this.state.games[w] += 1;
    log(5001, "Game " + (this.state.gameIndex + 1) + " won by team " + w +
      " " + p[w] + "-" + p[1 - w]);

    if (this.state.games[w] >= this.config.gamesToWin) {
      this.state.finished = true;
      this.state.winner = w;
      log(5002, "Doubles match won by team " + w + " " +
        this.state.games[0] + "-" + this.state.games[1]);
      return;
    }
    this.state.points = [0, 0];
    this.state.gameIndex += 1;
    this.state.serveOrder = this._defaultNextOrder(this.state.serveOrder);
  };

  // --- Public actions --------------------------------------------------------

  /** Internal: add one point to team `t` and check for game/match end. */
  DoublesScorer.prototype._applyPoint = function (t) {
    if (this.state.finished) { return; }
    this.state.points[t] += 1;
    log(5004, "Point team " + t + " -> " +
      this.state.points[0] + "-" + this.state.points[1]);
    this._checkGameEnd();
  };

  /** Award the next point to TEAM `t` (0/1). */
  DoublesScorer.prototype.pointTo = function (t) {
    if (this.state.finished) { log(5003, "Ignored point: finished"); return false; }
    if (t !== 0 && t !== 1) { return false; }
    this._snapshot();
    this._applyPoint(t);
    return true;
  };

  /**
   * Sanction player `p` (0..3) for misconduct. Penalty point(s) go to the
   * OPPOSING pair. Returns the sanction descriptor (see sanctionForCount).
   */
  DoublesScorer.prototype.sanction = function (p) {
    if (this.state.finished) { return null; }
    if (p < 0 || p > 3) { return null; }
    this._snapshot();
    this.state.infractions[p] += 1;
    var r = sanctionForCount(this.state.infractions[p]);
    var opponentTeam = 1 - teamOf(p);
    for (var k = 0; k < r.penalty; k++) { this._applyPoint(opponentTeam); }
    if (r.refereeCall) { this.state.refereeCalled = true; }
    log(5013, "Sanction " + this.config.playerNames[p] + " #" +
      this.state.infractions[p] + " [" + r.cards.join("+") + "] +" +
      r.penalty + " to team " + opponentTeam +
      (r.refereeCall ? " (referee call)" : ""));
    return r;
  };

  /**
   * Override the serve order for the CURRENT game (start-of-game designation).
   * Only meaningful at 0-0; validates the pair is cross-team.
   */
  DoublesScorer.prototype.setGameStart = function (firstServer, firstReceiver) {
    this._validatePair(firstServer, firstReceiver);
    if (this.state.points[0] !== 0 || this.state.points[1] !== 0) {
      log(5005, "setGameStart refused: game already in progress");
      return false;
    }
    this._snapshot();
    this.state.serveOrder = buildServeOrder(firstServer, firstReceiver);
    log(5006, "Game start set: server=" + this.config.playerNames[firstServer] +
      " receiver=" + this.config.playerNames[firstReceiver]);
    return true;
  };

  /** Record a time-out for TEAM `t` (0/1). Returns false if already used. */
  DoublesScorer.prototype.callTimeout = function (t) {
    if (this.state.timeoutsUsed[t]) {
      log(5009, "Time-out refused: already used by team " + t);
      return false;
    }
    this._snapshot();
    this.state.timeoutsUsed[t] = true;
    log(5010, "Time-out by team " + t);
    return true;
  };

  /**
   * Activate the acceleration ("expedite") rule. Once on it stays on until the
   * end of the match. Returns false if already active.
   */
  DoublesScorer.prototype.activateAcceleration = function () {
    if (this.state.accelerated) {
      log(5011, "Acceleration already active");
      return false;
    }
    this._snapshot();
    this.state.accelerated = true;
    this.state.accelGame = this.state.gameIndex;
    this.state.accelTotal = this.state.points[0] + this.state.points[1];
    log(5012, "Acceleration rule ON (game " + (this.state.gameIndex + 1) +
      ", at " + this.state.points[0] + "-" + this.state.points[1] + ")");
    return true;
  };

  /**
   * Remove the LAST card of player `p` (0..3) — correction of a mistake.
   * Reverses the penalty point(s) from the OPPOSING pair's current score
   * (clamped at 0). Does not "un-win" a game; use undo() for that.
   */
  DoublesScorer.prototype.removeSanction = function (p) {
    if (p < 0 || p > 3) { return null; }
    if (this.state.infractions[p] <= 0) {
      log(5014, "No card to remove for " + this.config.playerNames[p]);
      return null;
    }
    this._snapshot();
    var n = this.state.infractions[p];
    var reversed = sanctionForCount(n).penalty;
    var opponentTeam = 1 - teamOf(p);
    this.state.points[opponentTeam] =
      Math.max(0, this.state.points[opponentTeam] - reversed);
    this.state.infractions[p] = n - 1;
    this.state.refereeCalled = this.state.infractions.some(function (c) {
      return c >= 4;
    });
    log(5015, "Removed card from " + this.config.playerNames[p] + " -> level " +
      (n - 1) + ", reversed " + reversed + " penalty point(s)");
    return { removedLevel: n, penaltyReversed: reversed };
  };

  DoublesScorer.prototype.undo = function () {
    if (this._undo.length === 0) { log(5007, "Nothing to undo"); return false; }
    this.state = this._undo.pop();
    log(5008, "Undo -> " + this.state.points[0] + "-" + this.state.points[1]);
    return true;
  };

  DoublesScorer.prototype.canUndo = function () { return this._undo.length > 0; };

  DoublesScorer.prototype.view = function () {
    var s = this.state;
    return {
      names: this.config.playerNames.slice(),
      points: s.points.slice(),
      games: s.games.slice(),
      gameIndex: s.gameIndex,
      bestOf: 2 * this.config.gamesToWin - 1,
      server: this.server(),
      receiver: this.receiver(),
      servingTeam: this.servingTeam(),
      leftTeam: this.leftTeam(),
      serveOrder: s.serveOrder.slice(),
      isDeciding: this.isDecidingGame(),
      receivingInverted: this.isReceivingInverted(),
      timeoutsUsed: s.timeoutsUsed.slice(),
      infractions: s.infractions.slice(),
      refereeCalled: s.refereeCalled,
      accelerated: s.accelerated,
      wipeDue: this.wipeDue(),
      finished: s.finished,
      winner: s.winner,
      announce: this.announce(),
      completedGames: deepCopy(s.completedGames),
      canUndo: this.canUndo()
    };
  };

  var api = {
    DoublesScorer: DoublesScorer,
    teamOf: teamOf,
    partnerOf: partnerOf,
    buildServeOrder: buildServeOrder
  };
  global.arbattDoubles = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
