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
 * Courtside tablet display renderer (court.html).
 *
 * 2026-10-11 (v0.1.20): created. Same live channel and snapshots as the OBS
 * overlay (scoreboard.js), but a deliberately plain rendering: big numbers,
 * no animation. Left/right follow the table side seen by the umpire
 * (snapshot leftSide), optionally swapped (?flip=1 or the ⇄ button, kept in
 * localStorage on this tablet only). The display ignores the referee's
 * "show score on screen" switch: that one is for the broadcast.
 *
 * 2026-10-18 (v0.1.22): simplified pairing ("Mode tablette"). The channel is
 * the referee's 6-digit pairing code, read from ?code=. Without a valid code
 * the page shows a code entry form; submitting it reloads the page as
 * ?code=<code> (so a reload / bookmark stays paired). The last code is kept
 * on the tablet (arbatt.court.code) to pre-fill the form.
 *
 * Event number convention in this file: 87xx.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  var Live = window.arbattLive;

  var FLIP_KEY = "arbatt.court.flip";   // per-tablet convenience only
  var CODE_KEY = "arbatt.court.code";   // last pairing code (form pre-fill)
  var TIMER_WARN_S = 10;                // countdown turns red below this
  var TICK_MS = 250;                    // local countdown refresh

  var params = new URLSearchParams(window.location.search);
  var channel = Live.codeFromParams(params);   // 2026-10-18: was ?ch=<uuid>
  var flip = readFlip();
  var last = null;                      // last snapshot (for flip / timer)
  var timerSnap = null;                 // Live.receiveTimer() result
  var wakeLock = null;

  function $(id) { return document.getElementById(id); }

  function setText(el, txt) {
    if (el.textContent !== String(txt)) { el.textContent = txt; }
  }

  // ------------------------------------------------------------ left/right
  /** ?flip=1 wins; otherwise the choice stored on this tablet. */
  function readFlip() {
    if (params.has("flip")) { return params.get("flip") === "1"; }
    try {
      return window.localStorage.getItem(FLIP_KEY) === "1";
    } catch (e) {
      arbattLog("WARN", 8700, "Cannot read " + FLIP_KEY + ": " + e);
      return false;
    }
  }

  function toggleFlip() {
    flip = !flip;
    try {
      window.localStorage.setItem(FLIP_KEY, flip ? "1" : "0");
    } catch (e) {
      arbattLog("WARN", 8701, "Cannot store " + FLIP_KEY + ": " + e);
    }
    arbattLog("UI", 8702, "Sides swapped (flip=" + flip + ")");
    if (last) { render(last); }
  }

  // ---------------------------------------------------------------- render
  /** Context line: "Rencontre 3/6 · Manche 2 · Décisive · Accélération". */
  function contextText(st, m) {
    var ctx = [];
    var sh = st.sheet;
    if (sh && !sh.history && m.encounterId) {
      var enc = sh.encounters.filter(function (e) { return e.id === m.encounterId; })[0];
      if (enc) { ctx.push("Rencontre " + enc.num + "/" + sh.encounters.length); }
    }
    ctx.push(m.finished ? "Terminé" : "Manche " + (m.gameIndex + 1));
    if (m.isDeciding && !m.finished) { ctx.push("Décisive"); }
    if (m.accelerated && !m.finished) { ctx.push("Accélération"); }
    return ctx.join(" · ");
  }

  function renderSide(m, side) {
    var el = $("ct-side-" + side);
    setText(el.querySelector(".ct-name span"), m.sides[side]);
    setText(el.querySelector(".ct-points"), m.points[side]);
    setText(el.querySelector(".ct-games"), m.games[side]);
    el.classList.toggle("serving", m.servingSide === side);
    el.classList.toggle("winner", !!m.finished && m.winner === side);
    var flag = Live.pointFlag(m, side);
    setText(el.querySelector(".ct-flag"),
      flag === "match" ? "Balle de match" : flag === "game" ? "Balle de manche" : "");
  }

  function render(st) {
    last = st;
    var m = st.match;
    $("ct-main").classList.toggle("hidden", !m);
    if (!m) {
      $("ct-over").classList.add("hidden");
      showWait("En attente de la partie…");
      return;
    }
    showWait("");
    // Side shown on the left = the umpire's left side, unless flipped.
    var leftSide = (m.leftSide === 1 ? 1 : 0);
    if (flip) { leftSide = 1 - leftSide; }
    $("ct-main").classList.toggle("swapped", leftSide === 1);
    renderSide(m, 0);
    renderSide(m, 1);
    setText($("ct-ctx"), contextText(st, m));

    var over = $("ct-over");
    over.classList.toggle("hidden", !m.finished);
    if (m.finished) {
      setText($("ct-over-name"), m.sides[m.winner]);
      setText($("ct-over-games"), m.games.join(" – ") + "   (" +
        m.completedGames.map(function (g) { return g.points.join("-"); }).join("  ") + ")");
    }
  }

  // ------------------------------------------------------------- countdown
  function tickTimer() {
    var pill = $("ct-timer");
    var show = !!(timerSnap && last && last.match);
    pill.classList.toggle("hidden", !show);
    if (!show) { return; }
    var secs = Live.timerSecondsLeft(timerSnap);
    setText(pill, "⏱ " + timerSnap.label + "  " + Live.formatSeconds(secs));
    pill.classList.toggle("warn", secs <= TIMER_WARN_S);
  }

  function onState(st) {
    render(st);
    timerSnap = Live.receiveTimer(st.timer);
    tickTimer();
  }

  function showWait(txt) {
    var w = $("ct-wait");
    setText(w, txt);
    w.classList.toggle("hidden", !txt);
  }

  // ------------------------------------------------------- pairing code
  // 2026-10-18 (v0.1.22).

  function readStored(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (e) {
      arbattLog("WARN", 8710, "Cannot read " + key + ": " + e);
      return "";
    }
  }

  function storeCode(code) {
    try {
      window.localStorage.setItem(CODE_KEY, code);
    } catch (e) {
      arbattLog("WARN", 8711, "Cannot store " + CODE_KEY + ": " + e);
    }
  }

  /** Show the code entry form; `err` = message explaining why (or ""). */
  function showPairing(err) {
    $("ct-main").classList.add("hidden");
    $("ct-over").classList.add("hidden");
    showWait("");
    $("ct-pair").classList.remove("hidden");
    $("ct-pair-err").textContent = err || "";
    var input = $("ct-code");
    input.value = input.value || readStored(CODE_KEY);
    input.focus();
    arbattLog("UI", 8712, "Pairing code requested" + (err ? " (" + err + ")" : ""));
  }

  /** Validate the typed code; reload the page paired with it. */
  function onPairSubmit(ev) {
    ev.preventDefault();
    var code = Live.cleanPairingCode($("ct-code").value);
    if (!Live.isPairingCode(code)) {
      $("ct-pair-err").textContent = "Le code comporte " +
        Live.PAIRING_CODE_DIGITS + " chiffres.";
      arbattLog("WARN", 8713, "Rejected pairing code entry");
      return;
    }
    storeCode(code);
    arbattLog("UI", 8714, "Pairing with code " + code);
    params.set("code", code);
    window.location.search = params.toString();
  }

  function bindPairing() {
    $("ct-pair").addEventListener("submit", onPairSubmit);
    // Digits only, as typed ("123 456" pasted -> "123456").
    $("ct-code").addEventListener("input", function (ev) {
      var clean = Live.cleanPairingCode(ev.target.value);
      if (ev.target.value !== clean) { ev.target.value = clean; }
      $("ct-pair-err").textContent = "";
    });
    $("ct-recode").addEventListener("click", function (ev) {
      ev.stopPropagation();
      showPairing("");
    });
  }

  // ------------------------------------------------- full screen + awake
  function goFullScreen() {
    var d = document.documentElement;
    if (document.fullscreenElement || !d.requestFullscreen) { return; }
    d.requestFullscreen().catch(function (e) {
      arbattLog("WARN", 8703, "Full screen refused: " + e);
    });
  }

  /** Keep the tablet screen on (re-acquired when the page is shown again). */
  function keepAwake() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") { return; }
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      arbattLog("UI", 8704, "Screen wake lock acquired");
    }).catch(function (e) {
      arbattLog("WARN", 8705, "Screen wake lock refused: " + e);
    });
  }

  // -------------------------------------------------------------- bootstrap
  document.addEventListener("DOMContentLoaded", function () {
    $("ct-flip").addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleFlip();
    });
    $("ct-fs").addEventListener("click", function (ev) {
      ev.stopPropagation();
      goFullScreen();
    });
    // A tap anywhere: full screen + wake lock (both need a user gesture on
    // some browsers). 2026-10-18: not while typing the pairing code.
    document.body.addEventListener("click", function (ev) {
      if (ev.target.closest("#ct-pair")) { return; }
      goFullScreen();
      if (!wakeLock) { keepAwake(); }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { wakeLock = null; keepAwake(); }
    });
    bindPairing();
    keepAwake();
    setInterval(tickTimer, TICK_MS);

    if (params.get("demo")) {
      Live.startDemo(onState, false);
      arbattLog("BOOT", 8706, "Courtside display demo mode");
      return;
    }
    // 2026-10-18 (v0.1.22): no / bad code -> ask for it (was an error text).
    if (!Live.isPairingCode(channel)) {
      showPairing(channel ? "Code « " + channel + " » invalide." : "");
      return;
    }
    storeCode(channel);
    showWait("En attente de l'arbitre… (code " + channel + ")");
    $("ct-main").classList.add("hidden");
    Live.subscribe(channel, params.get("relay") !== "0", onState);
    arbattLog("BOOT", 8708, "Courtside display on code " + channel + " (flip=" + flip + ")");
  });

  // Exposed for tests / debugging from the console.
  window.arbattCourt = {
    isFlipped: function () { return flip; },
    lastState: function () { return last; }
  };
})();
