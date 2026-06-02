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
 * UI controller: screen navigation, new-match setup, and live binding of the
 * scoring engines (scorer.js for singles, doubles.js for doubles) to the
 * shared scoreboard DOM.
 *
 * Event number convention in this file: 2xxx.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  var TTScorer = window.arbattScorer.TTScorer;
  var DoublesScorer = window.arbattDoubles.DoublesScorer;
  var teamOf = window.arbattDoubles.teamOf;
  var CountdownTimer = window.arbattTimer.CountdownTimer;
  var formatMMSS = window.arbattTimer.formatMMSS;
  var shouldAutoAccelerate = window.arbattTimer.shouldAutoAccelerate;

  var match = null;          // current scoring engine (TTScorer | DoublesScorer)
  var mode = "singles";      // "singles" | "doubles"
  var lastGameIndex = 0;     // to detect game transitions (doubles designation)
  var appConfig = {          // client config, refreshed from app-config.json
    version: "?",
    warmupSeconds: 120,
    timeoutSeconds: 60,
    accelReturns: 13,
    gameMinutes: 10,
    accelPointsThreshold: 18
  };

  // Receiver's good-return counter, only meaningful under the acceleration rule.
  var returnCount = 0;

  // Single live timer instance + its UI refresh handle (one overlay at a time).
  var timer = null;
  var timerTick = null;

  // Per-game clock (counts up to the time limit, then triggers acceleration).
  var gameClock = null;
  var gameClockTick = null;
  var gameClockGameIndex = -1;    // game the current clock belongs to
  var gameClockResumeAfterModal = false;

  // -------------------------------------------------------------- navigation
  function show(screenId) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("hidden", screens[i].id !== screenId);
    }
    // Leaving the scoreboard: stop the game clock from ticking in the background.
    if (screenId !== "screen-score") {
      stopGameClockTick();
      if (gameClock && gameClock.isRunning()) { gameClock.pause(); }
    }
    arbattLog("UI", 2001, "Show screen " + screenId);
  }

  // Generic data-action="goto" handler (delegated).
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-action='goto']");
    if (el) { show(el.getAttribute("data-target")); }
  });

  // ---------------------------------------------------------- app config load
  function loadAppConfig() {
    // app-config.json is generated next to the app shell by the server so the
    // single source of truth stays config/param.json (version + durations).
    fetch("app-config.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          appConfig.version = data.version || "?";
          if (typeof data.warmupSeconds === "number") {
            appConfig.warmupSeconds = data.warmupSeconds;
          }
          if (typeof data.timeoutSeconds === "number") {
            appConfig.timeoutSeconds = data.timeoutSeconds;
          }
          if (typeof data.accelReturns === "number") {
            appConfig.accelReturns = data.accelReturns;
          }
          if (typeof data.gameMinutes === "number") {
            appConfig.gameMinutes = data.gameMinutes;
          }
          if (typeof data.accelPointsThreshold === "number") {
            appConfig.accelPointsThreshold = data.accelPointsThreshold;
          }
        }
        document.getElementById("version").textContent = "v" + appConfig.version;
        arbattLog("BOOT", 2000, "arBATT PWA config v" + appConfig.version +
          " warmup=" + appConfig.warmupSeconds + "s timeout=" +
          appConfig.timeoutSeconds + "s");
      })
      .catch(function (e) {
        document.getElementById("version").textContent = "v?";
        arbattLog("WARN", 2002, "Could not load app-config.json: " + e);
      });
  }

  // ----------------------------------------------------------- new match form
  function val(id) { return document.getElementById(id).value; }

  /** Names currently entered, depending on the selected mode. */
  function currentNames() {
    if (mode === "doubles") {
      return [
        val("name0").trim() || "Joueur A1",
        val("name1").trim() || "Joueur A2",
        val("name2").trim() || "Joueur B1",
        val("name3").trim() || "Joueur B2"
      ];
    }
    return [
      val("nameA").trim() || "Joueur A",
      val("nameB").trim() || "Joueur B"
    ];
  }

  /** Populate a <select> with {value,label} options, keeping a chosen value. */
  function fillSelect(id, options, selected) {
    var sel = document.getElementById(id);
    sel.innerHTML = "";
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(o.value) === String(selected)) { opt.selected = true; }
      sel.appendChild(opt);
    });
  }

  /** Rebuild the toss selects from the current names + mode. */
  function refreshTossSelects() {
    var names = currentNames();
    if (mode === "doubles") {
      var all = names.map(function (n, i) { return { value: i, label: n }; });
      var teamA = all.slice(0, 2);
      var teamB = all.slice(2, 4);
      fillSelect("firstServer", all, val("firstServer") || 0);
      // Default first receiver is on the opposite team of the first server.
      var srv = parseInt(document.getElementById("firstServer").value, 10) || 0;
      var oppo = teamOf(srv) === 0 ? teamB : teamA;
      fillSelect("firstReceiver", oppo, oppo[0].value);
      fillSelect("firstSide", [
        { value: 0, label: names[0] + " / " + names[1] },
        { value: 1, label: names[2] + " / " + names[3] }
      ], val("firstSide") || 0);
    } else {
      fillSelect("firstServer", [
        { value: 0, label: names[0] }, { value: 1, label: names[1] }
      ], val("firstServer") || 0);
      fillSelect("firstSide", [
        { value: 0, label: names[0] }, { value: 1, label: names[1] }
      ], val("firstSide") || 0);
    }
  }

  /** React to a Simple/Double mode change in the setup form. */
  function onModeChange() {
    mode = document.querySelector("input[name=mode]:checked").value;
    document.getElementById("names-singles").classList.toggle("hidden", mode !== "singles");
    document.getElementById("names-doubles").classList.toggle("hidden", mode !== "doubles");
    document.getElementById("row-firstReceiver").classList.toggle("hidden", mode !== "doubles");
    refreshTossSelects();
    arbattLog("UI", 2020, "Setup mode = " + mode);
  }

  function onNewMatchSubmit(ev) {
    ev.preventDefault();
    var common = {
      playerNames: currentNames(),
      gamesToWin: parseInt(val("gamesToWin"), 10),
      pointsPerGame: parseInt(val("pointsPerGame"), 10)
    };
    if (mode === "doubles") {
      match = new DoublesScorer(Object.assign({}, common, {
        firstServer: parseInt(val("firstServer"), 10),
        firstReceiver: parseInt(val("firstReceiver"), 10),
        firstTeamLeftSide: parseInt(val("firstSide"), 10)
      }));
    } else {
      match = new TTScorer(Object.assign({}, common, {
        firstServer: parseInt(val("firstServer"), 10),
        firstServerLeftSide: parseInt(val("firstSide"), 10)
      }));
    }
    lastGameIndex = 0;
    returnCount = 0;
    gameClockGameIndex = -1; // force a fresh game clock at the first render
    arbattLog("UI", 2003, "Match started (" + mode + ")");
    configureScoreboardForMode();
    render();
    show("screen-score");
  }

  /** Toggle scoreboard controls that only make sense in one mode. */
  function configureScoreboardForMode() {
    var d = mode === "doubles";
    document.getElementById("btn-service").classList.toggle("hidden", !d);
    document.getElementById("service-info").classList.toggle("hidden", !d);
    document.getElementById("btn-timeout-0").textContent = d ? "⏸️ TM Équipe A" : "⏸️ Temps mort A";
    document.getElementById("btn-timeout-1").textContent = d ? "⏸️ TM Équipe B" : "⏸️ Temps mort B";
  }

  // --------------------------------------------------------------- rendering
  function setText(id, value) { document.getElementById(id).textContent = value; }

  /** Display label for a "side" (0/1): a player in singles, a pair in doubles. */
  function sideLabel(v, side) {
    if (mode === "doubles") {
      return v.names[2 * side] + " / " + v.names[2 * side + 1];
    }
    return v.names[side];
  }

  /** Render the cards earned for a given cumulative infraction count. */
  function cardsFor(count) {
    if (count <= 0) { return ""; }
    if (count === 1) { return "🟨"; }
    if (count === 2) { return "🟨🟥"; }
    if (count === 3) { return "🟨🟥🟥"; }
    return "🟥 (JA)";
  }

  /** Cards to show on a side's card (player in singles, both players in doubles). */
  function sideCards(v, side) {
    if (mode === "doubles") {
      var parts = [];
      [2 * side, 2 * side + 1].forEach(function (p) {
        if (v.infractions[p] > 0) {
          parts.push(v.names[p] + " " + cardsFor(v.infractions[p]));
        }
      });
      return parts.join(" · ");
    }
    return cardsFor(v.infractions[side]);
  }

  function render() {
    if (!match) { return; }
    var v = match.view();

    // Names / points / games (side 0 and side 1)
    setText("name-0", sideLabel(v, 0));
    setText("name-1", sideLabel(v, 1));
    setText("points-0", v.points[0]);
    setText("points-1", v.points[1]);
    setText("games-0", v.games[0]);
    setText("games-1", v.games[1]);

    // Context line
    setText("ctx-game", "Manche " + (v.gameIndex + 1));
    setText("ctx-bestof", "· au meilleur des " + v.bestOf);
    document.getElementById("ctx-deciding").classList.toggle("hidden", !v.isDeciding);

    // Which side currently serves + which side is on the left end.
    var servingSide = (mode === "doubles") ? v.servingTeam : v.server;
    var leftSide = (mode === "doubles") ? v.leftTeam : v.leftPlayer;
    for (var i = 0; i < 2; i++) {
      document.getElementById("card-" + i)
        .classList.toggle("serving", servingSide === i);
    }
    setText("end-" + leftSide, "◀ Gauche");
    setText("end-" + (1 - leftSide), "Droite ▶");

    // Announcement
    setText("announce", v.announce);

    // Doubles: explicit "server -> receiver" line.
    if (mode === "doubles" && !v.finished) {
      document.getElementById("service-info").innerHTML =
        "Service : <b>" + v.names[v.server] + "</b> → " + v.names[v.receiver];
    } else if (mode === "doubles") {
      document.getElementById("service-info").textContent = "";
    }

    // Hints
    document.getElementById("hint-wipe").classList.toggle("hidden", !v.wipeDue);
    var deuce = v.points[0] >= (match.config.pointsPerGame - 1) &&
                v.points[1] >= (match.config.pointsPerGame - 1);
    document.getElementById("hint-deuce").classList.toggle("hidden", !deuce || v.finished);
    document.getElementById("hint-invert").classList.toggle(
      "hidden", !(mode === "doubles" && v.receivingInverted && !v.finished));

    // Acceleration panel + button state.
    document.getElementById("accel-panel").classList.toggle(
      "hidden", !v.accelerated || v.finished);
    document.getElementById("accel-max").textContent = appConfig.accelReturns;
    document.getElementById("accel-count").textContent = returnCount;
    var accelBtn = document.getElementById("btn-accel");
    accelBtn.classList.toggle("active", v.accelerated);
    accelBtn.disabled = v.accelerated || v.finished;

    // Cards / sanctions.
    document.getElementById("cards-0").textContent = sideCards(v, 0);
    document.getElementById("cards-1").textContent = sideCards(v, 1);
    document.getElementById("hint-referee").classList.toggle("hidden", !v.refereeCalled);

    // Controls availability
    document.getElementById("btn-undo").disabled = !v.canUndo;
    document.getElementById("btn-timeout-0").disabled = v.timeoutsUsed[0] || v.finished;
    document.getElementById("btn-timeout-1").disabled = v.timeoutsUsed[1] || v.finished;
    if (mode === "doubles") {
      // Service can only be (re)designated at 0-0.
      document.getElementById("btn-service").disabled =
        v.finished || v.points[0] !== 0 || v.points[1] !== 0;
    }

    // Doubles: when a new game has just begun, prompt for the designation.
    if (mode === "doubles" && !v.finished && v.gameIndex > lastGameIndex) {
      lastGameIndex = v.gameIndex;
      openServiceChooser(true);
    }
    lastGameIndex = v.gameIndex;

    // Game clock: (re)start a fresh clock when entering a new game.
    if (!v.finished && v.gameIndex !== gameClockGameIndex) {
      gameClockGameIndex = v.gameIndex;
      startGameClock();
    }
    if (v.finished) { stopGameClockTick(); }

    if (v.finished) { showResult(v); }
  }

  function showResult(v) {
    var w = v.winner;
    setText("final-result",
      sideLabel(v, w) + " gagne " + v.games[w] + " manches à " + v.games[1 - w]);
    var list = document.getElementById("games-list");
    list.innerHTML = "";
    v.completedGames.forEach(function (g, idx) {
      var li = document.createElement("li");
      li.textContent = "Manche " + (idx + 1) + " : " +
        sideLabel(v, 0) + " " + g.points[0] + " - " + g.points[1] + " " + sideLabel(v, 1);
      list.appendChild(li);
    });
    arbattLog("SCORE", 2004, "Match finished, showing result screen");
    show("screen-over");
  }

  // ----------------------------------------------------------- timer overlay
  // A single overlay reused for the warm-up (2 min) and time-outs (1 min).
  function timerEls() {
    return {
      overlay: document.getElementById("timer-overlay"),
      title: document.getElementById("timer-title"),
      ring: document.getElementById("timer-ring"),
      time: document.getElementById("timer-time"),
      state: document.getElementById("timer-state"),
      startpause: document.getElementById("timer-startpause"),
      reset: document.getElementById("timer-reset"),
      close: document.getElementById("timer-close")
    };
  }

  function beep() {
    // Short audible cue when the countdown ends (best-effort, may be blocked
    // until a user gesture has occurred on the page).
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { return; }
      var ctx = new Ctx();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      o.start(); o.stop(ctx.currentTime + 0.6);
    } catch (e) { /* audio not available: silently ignore */ }
  }

  function timerRefresh() {
    var e = timerEls();
    if (!timer) { return; }
    var secs = timer.remainingSeconds();
    e.time.textContent = formatMMSS(secs);
    e.ring.style.setProperty("--p", timer.progress());
    e.ring.classList.toggle("warn", !timer.isFinished() && secs <= 10);

    if (timer.isFinished()) {
      stopTick();
      e.ring.classList.add("done");
      e.state.textContent = "Terminé !";
      e.startpause.textContent = "Démarrer";
      e.startpause.disabled = true;
      if (navigator.vibrate) { navigator.vibrate([200, 100, 200]); }
      beep();
      arbattLog("TIMER", 2010, "Countdown finished: " + e.title.textContent);
    } else if (timer.isRunning()) {
      e.state.textContent = "En cours…";
      e.startpause.textContent = "Pause";
    } else {
      e.state.textContent = "En pause";
      e.startpause.textContent = "Reprendre";
    }
  }

  function startTick() {
    stopTick();
    timerTick = setInterval(timerRefresh, 200);
  }
  function stopTick() {
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
  }

  function openTimer(title, seconds) {
    var e = timerEls();
    timer = new CountdownTimer(seconds * 1000, { label: title });
    e.title.textContent = title;
    e.ring.classList.remove("done", "warn");
    e.startpause.disabled = false;
    e.state.textContent = "Prêt";
    e.startpause.textContent = "Démarrer";
    e.overlay.classList.remove("hidden");
    // Pause the game clock while a time-out / adaptation overlay is open.
    if (gameClock && gameClock.isRunning()) {
      gameClock.pause();
      stopGameClockTick();
      gameClockResumeAfterModal = true;
    }
    timerRefresh();
    // Auto-start: the referee usually wants the clock running immediately.
    timer.start();
    startTick();
    timerRefresh();
    arbattLog("UI", 2011, "Open timer '" + title + "' (" + seconds + "s)");
  }

  function closeTimer() {
    stopTick();
    timer = null;
    timerEls().overlay.classList.add("hidden");
    // Resume the game clock if it was running before the overlay opened.
    if (gameClockResumeAfterModal && gameClock && match && !match.view().finished) {
      gameClock.start();
      gameClockTick = setInterval(refreshGameClock, 250);
      document.getElementById("gc-toggle").textContent = "⏸";
    }
    gameClockResumeAfterModal = false;
    arbattLog("UI", 2012, "Close timer");
  }

  function bindTimer() {
    var e = timerEls();
    e.startpause.addEventListener("click", function () {
      if (!timer) { return; }
      if (timer.isRunning()) { timer.pause(); }
      else { timer.start(); startTick(); }
      timerRefresh();
    });
    e.reset.addEventListener("click", function () {
      if (!timer) { return; }
      timer.reset();
      e.ring.classList.remove("done");
      e.startpause.disabled = false;
      stopTick();
      timerRefresh();
    });
    e.close.addEventListener("click", closeTimer);

    document.getElementById("menu-warmup").addEventListener("click", function () {
      openTimer("Période d’adaptation", appConfig.warmupSeconds);
    });
    document.getElementById("setup-warmup").addEventListener("click", function () {
      openTimer("Période d’adaptation", appConfig.warmupSeconds);
    });
  }

  // --------------------------------------------------------------- game clock
  // Counts up to the game time limit; when reached with fewer than the
  // points threshold scored, the acceleration rule is auto-activated.
  function stopGameClockTick() {
    if (gameClockTick) { clearInterval(gameClockTick); gameClockTick = null; }
  }

  function startGameClock() {
    stopGameClockTick();
    var limitSec = appConfig.gameMinutes * 60;
    gameClock = new CountdownTimer(limitSec * 1000, { label: "manche" });
    document.getElementById("gc-limit").textContent = "/ " + formatMMSS(limitSec);
    document.getElementById("gc-toggle").textContent = "⏸";
    gameClock.start();
    gameClockTick = setInterval(refreshGameClock, 250);
    refreshGameClock();
    arbattLog("TIMER", 2061, "Game clock started (" + appConfig.gameMinutes + " min)");
  }

  function refreshGameClock() {
    if (!gameClock || !match) { return; }
    var limitSec = appConfig.gameMinutes * 60;
    var elapsed = limitSec - gameClock.remainingSeconds();
    if (elapsed < 0) { elapsed = 0; }
    document.getElementById("gc-time").textContent = formatMMSS(elapsed);
    document.getElementById("gameclock").classList.toggle(
      "warn", gameClock.remainingSeconds() <= 60);
    checkGameClock();
  }

  function checkGameClock() {
    if (!match) { return; }
    var v = match.view();
    if (v.finished) { stopGameClockTick(); return; }
    if (gameClock && gameClock.isFinished()) {
      var total = v.points[0] + v.points[1];
      if (shouldAutoAccelerate(true, total, appConfig.accelPointsThreshold,
                               v.accelerated)) {
        match.activateAcceleration();
        returnCount = 0;
        arbattLog("SCORE", 2060, "Auto-acceleration: " + appConfig.gameMinutes +
          " min reached with " + total + " < " + appConfig.accelPointsThreshold +
          " points");
        if (navigator.vibrate) { navigator.vibrate([150, 80, 150]); }
        beep();
        render();
      }
    }
  }

  function bindGameClock() {
    document.getElementById("gc-toggle").addEventListener("click", function () {
      if (!gameClock) { return; }
      if (gameClock.isRunning()) {
        gameClock.pause();
        stopGameClockTick();
        document.getElementById("gc-toggle").textContent = "▶";
      } else {
        gameClock.start();
        gameClockTick = setInterval(refreshGameClock, 250);
        document.getElementById("gc-toggle").textContent = "⏸";
      }
      refreshGameClock();
    });
  }

  // ------------------------------------------------ doubles service chooser
  // Lets the umpire designate (or correct) the server and receiver at 0-0.
  var chooser = { server: null, receiver: null };

  function buildChooserButtons(rowId, players, names, selected, onPick) {
    var row = document.getElementById(rowId);
    row.innerHTML = "";
    players.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = names[p];
      b.dataset.player = p;
      b.className = (p === selected) ? "sel" : "";
      b.addEventListener("click", function () { onPick(p); });
      row.appendChild(b);
    });
  }

  function highlightRow(rowId, selected) {
    var btns = document.getElementById(rowId).querySelectorAll("button");
    btns.forEach(function (b) {
      b.classList.toggle("sel", parseInt(b.dataset.player, 10) === selected);
    });
  }

  function openServiceChooser(auto) {
    var v = match.view();
    var srvTeam = v.servingTeam;
    var serverPlayers = [2 * srvTeam, 2 * srvTeam + 1];
    var receiverPlayers = [2 * (1 - srvTeam), 2 * (1 - srvTeam) + 1];
    chooser.server = v.server;
    chooser.receiver = v.receiver;

    document.getElementById("dchooser-title").textContent =
      "Manche " + (v.gameIndex + 1) + " — service";
    document.getElementById("dchooser-state").textContent = auto
      ? "Confirmez ou ajustez la désignation." : "";

    buildChooserButtons("dchooser-servers", serverPlayers, v.names,
      chooser.server, function (p) {
        chooser.server = p;
        highlightRow("dchooser-servers", p);
      });
    buildChooserButtons("dchooser-receivers", receiverPlayers, v.names,
      chooser.receiver, function (p) {
        chooser.receiver = p;
        highlightRow("dchooser-receivers", p);
      });

    document.getElementById("dchooser").classList.remove("hidden");
    arbattLog("UI", 2030, "Open doubles service chooser (auto=" + !!auto + ")");
  }

  function closeServiceChooser() {
    document.getElementById("dchooser").classList.add("hidden");
  }

  function bindServiceChooser() {
    document.getElementById("dchooser-confirm").addEventListener("click", function () {
      if (match && chooser.server !== null && chooser.receiver !== null) {
        match.setGameStart(chooser.server, chooser.receiver);
        render();
      }
      closeServiceChooser();
    });
    document.getElementById("dchooser-cancel").addEventListener("click", closeServiceChooser);
    document.getElementById("btn-service").addEventListener("click", function () {
      if (match && mode === "doubles") { openServiceChooser(false); }
    });
  }

  // ------------------------------------------------------------- score events
  /** Side (0/1) currently receiving — a player in singles, a team in doubles. */
  function receivingSide(v) {
    return (mode === "doubles") ? teamOf(v.receiver) : v.receiver;
  }

  function scorePoint(side) {
    if (!match) { return; }
    returnCount = 0; // a rally has ended: reset the acceleration return counter
    match.pointTo(side);
    render();
  }

  function bindScoreboard() {
    document.getElementById("card-0").addEventListener("click", function () {
      scorePoint(0);
    });
    document.getElementById("card-1").addEventListener("click", function () {
      scorePoint(1);
    });
    document.getElementById("btn-undo").addEventListener("click", function () {
      if (match) { match.undo(); render(); }
    });
    document.getElementById("btn-timeout-0").addEventListener("click", function () {
      if (match && match.callTimeout(0)) {
        render();
        openTimer("Temps mort — " + sideLabel(match.view(), 0), appConfig.timeoutSeconds);
      }
    });
    document.getElementById("btn-timeout-1").addEventListener("click", function () {
      if (match && match.callTimeout(1)) {
        render();
        openTimer("Temps mort — " + sideLabel(match.view(), 1), appConfig.timeoutSeconds);
      }
    });
  }

  // -------------------------------------------------------- acceleration rule
  function bindAccel() {
    document.getElementById("btn-accel").addEventListener("click", function () {
      if (match && match.activateAcceleration()) {
        returnCount = 0;
        arbattLog("SCORE", 2040, "Acceleration rule activated by umpire");
        render();
      }
    });
    document.getElementById("btn-return").addEventListener("click", function () {
      if (!match || !match.view().accelerated) { return; }
      returnCount += 1;
      arbattLog("SCORE", 2041, "Receiver return #" + returnCount);
      if (returnCount >= appConfig.accelReturns) {
        // 13 good returns: the point goes to the RECEIVER, then a new rally.
        var side = receivingSide(match.view());
        returnCount = 0;
        match.pointTo(side);
        arbattLog("SCORE", 2042, "Return threshold reached -> point to receiver");
      }
      render();
    });
    document.getElementById("btn-return-reset").addEventListener("click", function () {
      returnCount = 0;
      render();
    });
  }

  // ---------------------------------------------------------- cards / sanctions
  function buildSanctionList(v) {
    var list = document.getElementById("sanction-list");
    list.innerHTML = "";
    var players = (mode === "doubles") ? [0, 1, 2, 3] : [0, 1];
    players.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "sanction-row";
      var who = document.createElement("div");
      who.className = "who";
      who.innerHTML = "<div>" + v.names[p] + "</div><div class='cards'>" +
        (cardsFor(v.infractions[p]) || "aucun carton") + "</div>";
      var btn = document.createElement("button");
      btn.className = "btn-secondary";
      btn.textContent = "Sanctionner";
      btn.disabled = v.finished;
      btn.addEventListener("click", function () { applySanction(p); });
      row.appendChild(who);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function applySanction(p) {
    if (!match) { return; }
    var r = match.sanction(p);
    if (!r) { return; }
    var v = match.view();
    var cards = r.cards.map(function (c) { return c === "yellow" ? "🟨" : "🟥"; }).join("");
    var msg = v.names[p] + " : " + cards;
    if (r.penalty > 0) {
      msg += " — +" + r.penalty + " point" + (r.penalty > 1 ? "s" : "") +
        " à l'adversaire";
    }
    if (r.refereeCall) { msg += " — RECOURS AU JUGE-ARBITRE"; }
    document.getElementById("sanction-state").textContent = msg;
    arbattLog("SCORE", 2050, "Sanction applied: " + msg);
    buildSanctionList(v); // refresh the displayed card tallies
    render();
  }

  function bindSanction() {
    document.getElementById("btn-carton").addEventListener("click", function () {
      if (!match) { return; }
      buildSanctionList(match.view());
      document.getElementById("sanction-state").textContent = "";
      document.getElementById("sanction").classList.remove("hidden");
      arbattLog("UI", 2051, "Open sanction overlay");
    });
    document.getElementById("sanction-close").addEventListener("click", function () {
      document.getElementById("sanction").classList.add("hidden");
    });
  }

  // ----------------------------------------------------- service worker setup
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) { return; }
    navigator.serviceWorker.register("sw.js")
      .then(function () { arbattLog("SW", 2005, "Service worker registered"); })
      .catch(function (e) { arbattLog("WARN", 2006, "SW registration failed: " + e); });
  }

  // ----------------------------------------------------------------- bootstrap
  document.addEventListener("DOMContentLoaded", function () {
    arbattLog("BOOT", 2007, "DOM ready");
    document.getElementById("form-newmatch")
      .addEventListener("submit", onNewMatchSubmit);

    // Setup form: mode switch + dynamic toss selects.
    var radios = document.querySelectorAll("input[name=mode]");
    radios.forEach(function (r) { r.addEventListener("change", onModeChange); });
    ["name0", "name1", "name2", "name3", "nameA", "nameB"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.addEventListener("input", refreshTossSelects); }
    });
    document.getElementById("firstServer")
      .addEventListener("change", refreshTossSelects);
    onModeChange(); // initial population

    bindScoreboard();
    bindServiceChooser();
    bindAccel();
    bindSanction();
    bindGameClock();
    bindTimer();
    loadAppConfig();
    registerServiceWorker();
    show("screen-menu");
  });
})();
