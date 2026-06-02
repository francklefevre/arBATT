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
 * Table tennis SINGLES scoring engine (state machine, no DOM dependency).
 *
 * Rules implemented (FFTT "Manuel pratique d'arbitre de club", 2025/2026):
 *   - A game ("manche") is won at `pointsPerGame` (11) points with a lead of
 *     at least `winBy` (2) points; at 10-10 ("deuce") play continues until a
 *     2-point lead is reached.
 *   - Service changes every 2 points; once the score reaches 10-10 the
 *     service changes after every point.
 *   - The first server alternates from one game to the next.
 *   - Players change ends ("camp") at the end of every game; in the deciding
 *     game they also change ends as soon as one player reaches 5 points.
 *   - The score is always announced server first, then receiver.
 *   - Each player is entitled to one time-out per match.
 *   - A wiping break ("s'éponger") is allowed every 6 points (UI hint).
 *
 * NOT yet implemented (planned for later increments): doubles, the
 * acceleration rule, cards/penalties, on-table chronometry.
 *
 * Server / ends are DERIVED from the score so that undo is always exact.
 * Event number convention in this file: 3xxx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  function log(eid, msg) {
    if (typeof global.arbattLog === "function") {
      global.arbattLog("SCORE", eid, msg);
    }
  }

  /**
   * Pure helper: number of completed "service blocks" for a given score.
   *
   * Service alternates every 2 points, then every point once both players
   * have reached `pointsPerGame - 1` (deuce). The returned block count drives
   * both the singles server side and the doubles 4-player rotation, so it is
   * factored here and shared (see doubles.js).
   */
  function serviceBlocks(p0, p1, pointsPerGame) {
    var deuceThreshold = pointsPerGame - 1; // 10 for an 11-point game
    var total = p0 + p1;
    if (p0 >= deuceThreshold && p1 >= deuceThreshold) {
      // Pre-deuce produced `deuceThreshold` toggles (2 points each up to
      // 10-10); from then on every point is its own block.
      return deuceThreshold + (total - 2 * deuceThreshold);
    }
    return Math.floor(total / 2);
  }

  /**
   * Pure helper: service block count taking the ACCELERATION rule into account.
   *
   * Under the acceleration ("expedite") rule the server changes after EVERY
   * point. The rule may be switched on mid-game: `accelFromTotal` is the
   * in-game total-points value from which the every-point cadence applies
   * (0 means the whole game is accelerated; null/undefined means no
   * acceleration -> normal cadence).
   *
   * @returns {number} number of service blocks (toggles).
   */
  function acceleratedBlocks(p0, p1, pointsPerGame, accelFromTotal) {
    if (accelFromTotal === null || accelFromTotal === undefined) {
      return serviceBlocks(p0, p1, pointsPerGame);
    }
    var total = p0 + p1;
    // Before acceleration kicked in, the cadence was every 2 points. Since the
    // rule can only start below 18 points, that portion is always pre-deuce,
    // hence floor(accelFromTotal / 2) toggles; after it, one toggle per point.
    return Math.floor(accelFromTotal / 2) + (total - accelFromTotal);
  }

  /**
   * Pure helper: who serves given the first server of the game and the score.
   * Returns 0 or 1.
   */
  function serverOf(firstServer, p0, p1, pointsPerGame, winBy) {
    return (firstServer + serviceBlocks(p0, p1, pointsPerGame)) % 2;
  }

  /**
   * Pure helper: the sanction for the n-th infraction of a player (FFTT manual
   * p.13). Returns the card(s) to show, the penalty points awarded to the
   * OPPONENT, and whether the referee (juge-arbitre) must be called.
   *
   *   1st  -> yellow                       (warning, no point)
   *   2nd  -> yellow + red, +1 to opponent
   *   3rd  -> yellow + red, +2 to opponent
   *   4th+ -> red, referee called (match lost by penalty)
   */
  function sanctionForCount(n) {
    if (n <= 1) { return { cards: ["yellow"], penalty: 0, refereeCall: false }; }
    if (n === 2) { return { cards: ["yellow", "red"], penalty: 1, refereeCall: false }; }
    if (n === 3) { return { cards: ["yellow", "red"], penalty: 2, refereeCall: false }; }
    return { cards: ["red"], penalty: 0, refereeCall: true };
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * TTScorer - singles match scoring engine.
   *
   * @param {Object} opts
   * @param {string[]} opts.playerNames  Two player names.
   * @param {number}  [opts.pointsPerGame=11]
   * @param {number}  [opts.winBy=2]
   * @param {number}  [opts.gamesToWin=3]   Best-of (2*gamesToWin - 1) games.
   * @param {number}  [opts.firstServer=0]  Index (0/1) of the match's 1st server.
   * @param {number}  [opts.firstServerLeftSide=0] Index of the player starting
   *                                        on the left end in game 1.
   */
  function TTScorer(opts) {
    opts = opts || {};
    this.config = {
      playerNames: (opts.playerNames || ["Joueur A", "Joueur B"]).slice(0, 2),
      pointsPerGame: opts.pointsPerGame || 11,
      winBy: opts.winBy || 2,
      gamesToWin: opts.gamesToWin || 3,
      firstServer: typeof opts.firstServer === "number" ? opts.firstServer : 0,
      firstServerLeftSide:
        typeof opts.firstServerLeftSide === "number" ? opts.firstServerLeftSide : 0
    };
    this._undo = [];
    this._reset();
    log(3000, "New match: " + this.config.playerNames.join(" vs ") +
      " | best of " + (2 * this.config.gamesToWin - 1) +
      " | first server=" + this.config.playerNames[this.config.firstServer]);
  }

  TTScorer.prototype._reset = function () {
    this.state = {
      points: [0, 0],          // current game points
      games: [0, 0],           // games won by each player
      completedGames: [],      // [{points:[a,b], winner}]
      gameIndex: 0,            // 0-based index of the current game
      firstServerOfGame: this.config.firstServer,
      timeoutsUsed: [false, false],
      infractions: [0, 0],     // cumulative misconduct count per player
      refereeCalled: false,    // a 4th infraction occurred (match lost by JA)
      accelerated: false,      // acceleration ("expedite") rule active?
      accelGame: null,         // gameIndex when it was activated
      accelTotal: null,        // in-game total points when it was activated
      finished: false,
      winner: null
    };
  };

  /** In-game total from which the every-point cadence applies (null if off). */
  TTScorer.prototype._accelFromTotal = function () {
    if (!this.state.accelerated) { return null; }
    return (this.state.accelGame === this.state.gameIndex)
      ? this.state.accelTotal : 0;
  };

  TTScorer.prototype._snapshot = function () {
    this._undo.push(deepCopy(this.state));
    // Keep the undo history bounded but generous.
    if (this._undo.length > 400) { this._undo.shift(); }
  };

  // --- Derived getters -------------------------------------------------------

  TTScorer.prototype.isDecidingGame = function () {
    var g = this.config.gamesToWin - 1;
    return this.state.games[0] === g && this.state.games[1] === g;
  };

  /** Index (0/1) of the player who must serve right now. */
  TTScorer.prototype.server = function () {
    var blocks = acceleratedBlocks(
      this.state.points[0], this.state.points[1],
      this.config.pointsPerGame, this._accelFromTotal());
    return (this.state.firstServerOfGame + blocks) % 2;
  };

  TTScorer.prototype.receiver = function () {
    return 1 - this.server();
  };

  /** Index (0/1) of the player currently on the LEFT end. */
  TTScorer.prototype.leftPlayer = function () {
    var parity = this.state.gameIndex; // ends swap every game
    if (this.isDecidingGame()) {
      var half = Math.floor(this.config.pointsPerGame / 2); // 5 for 11-pt games
      if (this.state.points[0] >= half || this.state.points[1] >= half) {
        parity += 1; // mid-game end change in the deciding game
      }
    }
    var base = this.config.firstServerLeftSide;
    return (base + parity) % 2;
  };

  /** True when a wiping break ("s'éponger") is due (every 6 points). */
  TTScorer.prototype.wipeDue = function () {
    var total = this.state.points[0] + this.state.points[1];
    return total > 0 && total % 6 === 0 && !this.state.finished;
  };

  /** Spoken-style announcement, server score first. */
  TTScorer.prototype.announce = function () {
    if (this.state.finished) {
      return this.config.playerNames[this.state.winner] + " gagne " +
        this.state.games[this.state.winner] + " manches à " +
        this.state.games[1 - this.state.winner];
    }
    var s = this.server();
    var r = this.receiver();
    return this.state.points[s] + " - " + this.state.points[r] +
      " (service " + this.config.playerNames[s] + ")";
  };

  // --- Internal: detect end of game / match ---------------------------------

  TTScorer.prototype._checkGameEnd = function () {
    var p = this.state.points;
    var need = this.config.pointsPerGame;
    var by = this.config.winBy;
    var w = -1;
    if (p[0] >= need && p[0] - p[1] >= by) { w = 0; }
    else if (p[1] >= need && p[1] - p[0] >= by) { w = 1; }
    if (w === -1) { return; }

    this.state.completedGames.push({ points: [p[0], p[1]], winner: w });
    this.state.games[w] += 1;
    log(3001, "Game " + (this.state.gameIndex + 1) + " won by " +
      this.config.playerNames[w] + " " + p[w] + "-" + p[1 - w]);

    if (this.state.games[w] >= this.config.gamesToWin) {
      this.state.finished = true;
      this.state.winner = w;
      log(3002, "Match won by " + this.config.playerNames[w] + " " +
        this.state.games[0] + "-" + this.state.games[1]);
      return;
    }

    // Prepare next game: reset points, alternate the first server, swap ends.
    this.state.points = [0, 0];
    this.state.gameIndex += 1;
    this.state.firstServerOfGame = 1 - this.state.firstServerOfGame;
  };

  // --- Public actions --------------------------------------------------------

  /** Internal: add one point to side `i` and check for game/match end. */
  TTScorer.prototype._applyPoint = function (i) {
    if (this.state.finished) { return; }
    this.state.points[i] += 1;
    log(3004, "Point " + this.config.playerNames[i] + " -> " +
      this.state.points[0] + "-" + this.state.points[1]);
    this._checkGameEnd();
  };

  /** Award the next point to player `i` (0/1). */
  TTScorer.prototype.pointTo = function (i) {
    if (this.state.finished) {
      log(3003, "Ignored point: match already finished");
      return false;
    }
    if (i !== 0 && i !== 1) { return false; }
    this._snapshot();
    this._applyPoint(i);
    return true;
  };

  /**
   * Sanction player `i` for misconduct. Increments their infraction count,
   * shows the corresponding card(s) and awards any penalty point(s) to the
   * opponent. Returns the sanction descriptor (see sanctionForCount).
   */
  TTScorer.prototype.sanction = function (i) {
    if (this.state.finished) { return null; }
    if (i !== 0 && i !== 1) { return null; }
    this._snapshot();
    this.state.infractions[i] += 1;
    var r = sanctionForCount(this.state.infractions[i]);
    for (var k = 0; k < r.penalty; k++) { this._applyPoint(1 - i); }
    if (r.refereeCall) { this.state.refereeCalled = true; }
    log(3011, "Sanction " + this.config.playerNames[i] + " #" +
      this.state.infractions[i] + " [" + r.cards.join("+") + "] +" +
      r.penalty + " to opponent" + (r.refereeCall ? " (referee call)" : ""));
    return r;
  };

  /** Record a time-out for player `i`. Returns false if already used. */
  TTScorer.prototype.callTimeout = function (i) {
    if (this.state.timeoutsUsed[i]) {
      log(3005, "Time-out refused: already used by " + this.config.playerNames[i]);
      return false;
    }
    this._snapshot();
    this.state.timeoutsUsed[i] = true;
    log(3006, "Time-out by " + this.config.playerNames[i]);
    return true;
  };

  /**
   * Activate the acceleration ("expedite") rule. Once on it stays on until the
   * end of the match (per the rules). Returns false if already active.
   */
  TTScorer.prototype.activateAcceleration = function () {
    if (this.state.accelerated) {
      log(3009, "Acceleration already active");
      return false;
    }
    this._snapshot();
    this.state.accelerated = true;
    this.state.accelGame = this.state.gameIndex;
    this.state.accelTotal = this.state.points[0] + this.state.points[1];
    log(3010, "Acceleration rule ON (game " + (this.state.gameIndex + 1) +
      ", at " + this.state.points[0] + "-" + this.state.points[1] + ")");
    return true;
  };

  /** Undo the last state-changing action. */
  TTScorer.prototype.undo = function () {
    if (this._undo.length === 0) {
      log(3007, "Nothing to undo");
      return false;
    }
    this.state = this._undo.pop();
    log(3008, "Undo -> " + this.state.points[0] + "-" + this.state.points[1]);
    return true;
  };

  TTScorer.prototype.canUndo = function () {
    return this._undo.length > 0;
  };

  /** A plain snapshot of everything the UI needs to render. */
  TTScorer.prototype.view = function () {
    var s = this.state;
    return {
      names: this.config.playerNames.slice(),
      points: s.points.slice(),
      games: s.games.slice(),
      gameIndex: s.gameIndex,
      bestOf: 2 * this.config.gamesToWin - 1,
      server: this.state.finished ? null : this.server(),
      receiver: this.state.finished ? null : this.receiver(),
      leftPlayer: this.leftPlayer(),
      isDeciding: this.isDecidingGame(),
      wipeDue: this.wipeDue(),
      timeoutsUsed: s.timeoutsUsed.slice(),
      infractions: s.infractions.slice(),
      refereeCalled: s.refereeCalled,
      accelerated: s.accelerated,
      finished: s.finished,
      winner: s.winner,
      announce: this.announce(),
      completedGames: deepCopy(s.completedGames),
      canUndo: this.canUndo()
    };
  };

  // Export both for browser and for headless testing (Node).
  var api = {
    TTScorer: TTScorer,
    serverOf: serverOf,
    serviceBlocks: serviceBlocks,
    acceleratedBlocks: acceleratedBlocks,
    sanctionForCount: sanctionForCount
  };
  global.arbattScorer = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
