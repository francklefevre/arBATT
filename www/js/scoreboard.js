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
 * Public scoreboard overlay renderer (scoreboard.html) — OBS mode.
 *
 * 2026-10-06 (v0.1.12): created. Receives full snapshots from the referee
 * app through live.js and renders them. Animations are derived by DIFFING the
 * new snapshot with the previous one (point scored, game won, match won,
 * card, acceleration, time-out, team score change); an undo therefore never
 * triggers a celebration (only increases animate), and a reconnecting overlay
 * simply renders the current state without replaying anything.
 *
 * Event number convention in this file: 85xx.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  var Live = window.arbattLive;

  var STAGE_W = 1920, STAGE_H = 1080;
  var BANNER_MS = 3800;        // regular event banner duration
  var MATCH_BANNER_MS = 9000;  // match-won banner duration
  var TIMER_WARN_S = 10;       // countdown turns red below this
  var CONFETTI = 90;           // pieces spawned for a match win

  var params = new URLSearchParams(window.location.search);
  // 2026-10-18 (v0.1.22): the channel is the 6-digit pairing code ?code=
  // (was ?ch=<uuid>).
  var channel = Live.codeFromParams(params);
  var inObs = !!window.obsstudio;   // OBS Browser source exposes this object

  var prev = null;                  // previous snapshot (for diffing)
  var timerSnap = null;             // countdown as received + local receipt time
  var bannerQueue = [];
  var bannerBusy = false;
  var bannerTimer = null;           // pending "hide current banner" timeout

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------ page setup
  function applyParams() {
    var stage = $("stage");
    var pos = params.get("pos") || "bl";
    if (["bl", "br", "tl", "tr", "bc"].indexOf(pos) < 0) {
      arbattLog("WARN", 8500, "Unknown pos=" + pos + ", using bl");
      pos = "bl";
    }
    stage.classList.add("pos-" + pos);
    var k = parseFloat(params.get("scale"));
    if (k > 0) { document.documentElement.style.setProperty("--k", String(k)); }
    var bg = params.get("bg");
    if (bg) {
      // Accept "00b140" as well as any CSS color ("#00b140", "green"...).
      document.body.style.background = /^[0-9a-f]{3,8}$/i.test(bg) ? "#" + bg : bg;
    }
  }

  /** Scale the 1920x1080 stage to the viewport (1:1 in a 1080p OBS source). */
  function fitStage() {
    var s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    $("stage").style.transform = "scale(" + s + ")";
  }

  // --------------------------------------------------------------- helpers
  function sum(a) { return a[0] + a[1]; }

  /** Card list for a cumulative infraction count (mirrors the app's ladder). */
  function cardKinds(count) {
    if (count <= 0) { return []; }
    if (count === 1) { return ["y"]; }
    if (count === 2) { return ["y", "r"]; }
    if (count === 3) { return ["y", "r", "r"]; }
    return ["r"];
  }

  /** Infraction counts of the players of a side (1 in singles, 2 in doubles). */
  function sidePlayers(m, side) {
    return m.mode === "doubles" ? [2 * side, 2 * side + 1] : [side];
  }

  // 2026-10-11 (v0.1.20): pointFlag() moved to live.js (shared with court.js).
  var pointFlag = Live.pointFlag;

  /** Restart a CSS animation class on an element. */
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add(cls);
  }

  function setText(el, txt) {
    if (el.textContent !== String(txt)) { el.textContent = txt; }
  }

  // ------------------------------------------------------------- score bug
  function renderBug(st) {
    var m = st.match;
    var bug = $("bug");
    var show = !!(m && st.display && st.display.scorebug);
    bug.classList.toggle("hidden", !show);
    if (!show) { return; }
    bug.classList.toggle("finished", !!m.finished); // hides the points column

    // Team score chip (team meeting) when a sheet with encounters exists.
    var team = $("bug-team");
    var sh = st.sheet;
    // 2026-10-11 (v0.1.18): the free-match history is no team meeting.
    var hasTeam = !!(sh && !sh.history && sh.encounters.length);
    team.classList.toggle("hidden", !hasTeam);
    if (hasTeam) {
      setText(team, sh.teams[0] + " " + sh.score[0] + " – " + sh.score[1] + " " + sh.teams[1]);
    }

    // Context: game number, deciding game, encounter number.
    var ctx = [];
    if (hasTeam && m.encounterId) {
      var enc = sh.encounters.filter(function (e) { return e.id === m.encounterId; })[0];
      if (enc) { ctx.push("Rencontre " + enc.num + "/" + sh.encounters.length); }
    }
    ctx.push(m.finished ? "Terminé" : "Manche " + (m.gameIndex + 1));
    $("bug-ctx").innerHTML = "";
    $("bug-ctx").appendChild(document.createTextNode(ctx.join(" · ")));
    if (m.isDeciding && !m.finished) {
      var d = document.createElement("span");
      d.className = "deciding";
      d.textContent = " · Décisive";
      $("bug-ctx").appendChild(d);
    }

    for (var side = 0; side < 2; side++) {
      var row = $("row-" + side);
      row.classList.toggle("serving", m.servingSide === side);
      row.classList.toggle("winner", m.finished && m.winner === side);
      setText(row.querySelector(".b-name"), m.sides[side]);

      // Cards of the side's player(s).
      var cards = row.querySelector(".b-cards");
      cards.innerHTML = "";
      sidePlayers(m, side).forEach(function (p) {
        cardKinds(m.infractions[p] || 0).forEach(function (k) {
          var i = document.createElement("i");
          i.className = k;
          cards.appendChild(i);
        });
      });

      // Game point / match point.
      var flag = pointFlag(m, side);
      var fl = row.querySelector(".b-flag");
      setText(fl, flag === "match" ? "BALLE DE MATCH" : flag === "game" ? "BALLE DE MANCHE" : "");
      fl.classList.toggle("match", flag === "match");

      // Completed games history.
      var sets = row.querySelector(".b-sets");
      sets.innerHTML = "";
      m.completedGames.forEach(function (g) {
        var s = document.createElement("span");
        s.textContent = g.points[side];
        if (g.winner === side) { s.className = "won"; }
        sets.appendChild(s);
      });

      setText(row.querySelector(".b-games"), m.games[side]);
      setText(row.querySelector(".b-points"), m.finished ? "" : m.points[side]);
    }

    // Acceleration pill.
    var accel = $("pill-accel");
    var accelOn = m.accelerated && !m.finished;
    accel.classList.toggle("hidden", !accelOn);
    if (accelOn) {
      setText(accel, "⏩ Accélération · renvois " + m.returnCount + "/" + m.accelReturns);
    }
    refreshFoot();
  }

  function refreshFoot() {
    var anyPill = !$("pill-accel").classList.contains("hidden") ||
                  !$("pill-timer").classList.contains("hidden");
    $("bug-foot").classList.toggle("hidden", !anyPill);
  }

  // --------------------------------------------------------- countdown pill
  function receiveTimer(st) {
    timerSnap = Live.receiveTimer(st.timer); // 2026-10-11: shared helper
    tickTimer();
  }

  /** Local countdown between snapshots (receipt-time based: no clock skew). */
  function tickTimer() {
    var pill = $("pill-timer");
    var show = !!(timerSnap && prev && prev.display && prev.display.scorebug && prev.match);
    pill.classList.toggle("hidden", !show);
    if (show) {
      // 2026-10-11 (v0.1.20): shared countdown helpers of live.js.
      var secs = Live.timerSecondsLeft(timerSnap);
      pill.innerHTML = "";
      pill.appendChild(document.createTextNode("⏱ " + timerSnap.label));
      var b = document.createElement("b");
      b.textContent = Live.formatSeconds(secs);
      pill.appendChild(b);
      pill.classList.toggle("warn", secs <= TIMER_WARN_S);
    }
    refreshFoot();
  }

  // ------------------------------------------------------------ sheet panel
  function renderSheet(st) {
    var panel = $("sheet-panel");
    var sh = st.sheet;
    var show = !!(sh && st.display && st.display.sheet);
    panel.classList.toggle("hidden", !show);
    if (!show) { return; }
    setText($("sp-title"), sh.title || "");
    // 2026-10-11 (v0.1.18): free-match history has no teams nor team score.
    $("sheet-panel").classList.toggle("history", !!sh.history);
    setText($("sp-team-a"), sh.teams[0]);
    setText($("sp-team-b"), sh.teams[1]);
    setText($("sp-score-a"), sh.score[0]);
    setText($("sp-score-b"), sh.score[1]);

    var liveId = st.match && !st.match.finished ? st.match.encounterId : null;
    var list = $("sp-list");
    list.innerHTML = "";
    // 2026-10-11 (v0.1.20): team standing of the free matches.
    if (sh.standings) {
      renderStandings(list, sh.standings);
      return;
    }
    // 2026-10-11 (v0.1.19): explicit empty state (an empty panel looked like
    // "nothing happens" when the referee ticked the sheet display).
    if (!sh.encounters.length) {
      var empty = document.createElement("li");
      empty.className = "sp-empty";
      empty.textContent = sh.history ? "Aucune partie terminée pour l’instant"
        : "Aucune rencontre sur la feuille";
      list.appendChild(empty);
    }
    sh.encounters.forEach(function (e) {
      var li = document.createElement("li");
      // Doubles rows use a smaller font (4 names) instead of a "(double)"
      // tag, which only made the names truncate earlier (seen in Chrome).
      li.className = "sp-row" + (e.id === liveId ? " live" : "") +
        (e.kind === "doubles" ? " doubles" : "");
      var cells = [
        ["sp-n", String(e.num)],
        ["sp-a" + (e.result && e.result.winner === 0 ? " win" : ""), e.sides[0]],
        ["sp-vs", "vs"],
        ["sp-b" + (e.result && e.result.winner === 1 ? " win" : ""), e.sides[1]],
        ["sp-res", e.result ? e.result.games.join("-")
          : (e.id === liveId ? st.match.games.join("-") : "")]
      ];
      cells.forEach(function (c) {
        var span = document.createElement("span");
        span.className = c[0];
        span.textContent = c[1];
        li.appendChild(span);
      });
      list.appendChild(li);
    });
  }

  /**
   * Team standing rows: rank, team, "W V · L D". 2026-10-11 (v0.1.20).
   * Same .sp-row grid as the encounters (name spans the 3 middle columns).
   */
  function renderStandings(list, rows) {
    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "sp-empty";
      empty.textContent = "Aucune équipe déclarée (menu 👥 Équipes de l’arbitre)";
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (r, i) {
      var li = document.createElement("li");
      li.className = "sp-row sp-team-row";
      [["sp-n", String(i + 1)], ["sp-a" + (i === 0 && r.won > 0 ? " win" : ""), r.name],
       ["sp-res", r.won + " V · " + r.lost + " D"]].forEach(function (c) {
        var span = document.createElement("span");
        span.className = c[0];
        span.textContent = c[1];
        li.appendChild(span);
      });
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- banners
  /**
   * Queue a banner. b = {kind:"" | "card" | "match", kicker, main, sub,
   * cards:["y","r"], ms}. Banners play one after the other.
   */
  function queueBanner(b) {
    // 2026-10-06: the match-won banner must not wait behind a queue of minor
    // banners (seen in Chrome: victory delayed ~8 s behind game/card ones):
    // it drops the queue and cuts the current banner short.
    if (b.kind === "match") {
      bannerQueue = [b];
      if (bannerBusy) { hideBanner(); }
      else { nextBanner(); }
      return;
    }
    bannerQueue.push(b);
    if (!bannerBusy) { nextBanner(); }
  }

  /** Play the exit animation of the current banner, then show the next one. */
  function hideBanner() {
    clearTimeout(bannerTimer);
    $("banner").classList.add("out");
    bannerTimer = setTimeout(nextBanner, 450);
  }

  function nextBanner() {
    var b = bannerQueue.shift();
    var el = $("banner");
    if (!b) { bannerBusy = false; el.classList.add("hidden"); return; }
    bannerBusy = true;
    el.className = "banner" + (b.kind ? " " + b.kind : "");
    setText($("banner-kicker"), b.kicker || "");
    var main = $("banner-main");
    main.innerHTML = "";
    (b.cards || []).forEach(function (k) {
      var c = document.createElement("span");
      c.className = "big-card " + k;
      main.appendChild(c);
    });
    main.appendChild(document.createTextNode(b.main || ""));
    setText($("banner-sub"), b.sub || "");
    if (b.kind === "match") { confetti(); }
    arbattLog("UI", 8510, "Banner: " + (b.kicker || "") + " " + (b.main || ""));
    bannerTimer = setTimeout(hideBanner, b.ms || BANNER_MS);
  }

  function confetti() {
    var stage = $("stage");
    var colors = ["#f4b740", "#12a374", "#ffffff", "#e0413b", "#ffd23f"];
    for (var i = 0; i < CONFETTI; i++) {
      var c = document.createElement("span");
      c.className = "confetti";
      c.style.left = (Math.random() * STAGE_W) + "px";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.5 + Math.random() * 3) + "s";
      c.style.animationDelay = (Math.random() * 1.2) + "s";
      stage.appendChild(c);
      setTimeout(c.remove.bind(c), 7000);
    }
  }

  // --------------------------------------------------------- event diffing
  function scoresLine(m) {
    return m.completedGames.map(function (g) {
      return g.points[0] + "-" + g.points[1];
    }).join("  ");
  }

  function penaltyText(count) {
    if (count === 2) { return "+1 point à l'adversaire"; }
    if (count === 3) { return "+2 points à l'adversaire"; }
    if (count >= 4) { return "Recours au juge-arbitre"; }
    return "Avertissement";
  }

  /** Derive animations/banners from what changed since the previous snapshot. */
  function animate(st, old) {
    var m = st.match;
    var pm = old && old.match;

    // Team score changed (sheet): pulse wherever it is shown.
    if (old && old.sheet && st.sheet &&
        (old.sheet.score[0] !== st.sheet.score[0] || old.sheet.score[1] !== st.sheet.score[1])) {
      replay($("sp-score-a"), "pulse");
      replay($("sp-score-b"), "pulse");
      replay($("bug-team"), "pulse");
    }
    if (!m || !st.display.scorebug) { return; }

    // A NEW match: intro banner (only when it really starts at 0-0).
    if (!pm || pm.matchId !== m.matchId) {
      if (old && !m.finished && sum(m.games) === 0 && sum(m.points) === 0) {
        var kicker = "Au meilleur des " + m.bestOf + " manches";
        if (st.sheet && m.encounterId) {
          var enc = st.sheet.encounters.filter(function (e) { return e.id === m.encounterId; })[0];
          if (enc) { kicker = "Rencontre " + enc.num + " · " + kicker; }
        }
        queueBanner({ kicker: kicker, main: m.sides[0] + "  vs  " + m.sides[1] });
      }
      return;
    }

    // Points scored (increase only: an undo is not celebrated).
    for (var s = 0; s < 2; s++) {
      var row = $("row-" + s);
      if (m.gameIndex === pm.gameIndex && m.points[s] > pm.points[s]) {
        replay(row.querySelector(".b-points"), "bump");
      }
      if (m.games[s] > pm.games[s]) { replay(row.querySelector(".b-games"), "bump"); }
    }

    // Game / match won.
    if (m.completedGames.length > pm.completedGames.length) {
      var last = m.completedGames[m.completedGames.length - 1];
      if (m.finished && !pm.finished) {
        queueBanner({
          kind: "match", kicker: "Victoire", main: m.sides[m.winner],
          sub: m.games[m.winner] + " manches à " + m.games[1 - m.winner] +
            "   ·   " + scoresLine(m),
          ms: MATCH_BANNER_MS
        });
      } else if (!m.finished) {
        queueBanner({
          kicker: "Manche " + m.completedGames.length,
          main: m.sides[last.winner],
          sub: last.points[0] + "-" + last.points[1] + "   ·   manches " +
            m.games[0] + "-" + m.games[1]
        });
      }
    }

    // Cards (per player).
    for (var p = 0; p < m.infractions.length; p++) {
      if (m.infractions[p] > (pm.infractions[p] || 0)) {
        queueBanner({
          kind: "card", kicker: "Carton", cards: cardKinds(m.infractions[p]),
          main: m.names[p], sub: penaltyText(m.infractions[p])
        });
      }
    }

    // Acceleration rule.
    if (m.accelerated && !pm.accelerated) {
      queueBanner({
        kicker: "Règle d'accélération", main: "Service à chaque point",
        sub: m.accelReturns + " renvois du relanceur = point pour le relanceur"
      });
    }

    // Time-outs.
    for (var t = 0; t < 2; t++) {
      if (m.timeoutsUsed[t] && !pm.timeoutsUsed[t]) {
        queueBanner({ kicker: "Temps mort", main: m.sides[t], ms: 2500 });
      }
    }
  }

  // ------------------------------------------------------------------ entry
  function onState(st) {
    var old = prev;
    prev = st;
    renderBug(st);
    renderSheet(st);
    receiveTimer(st);
    animate(st, old);
    // Connected but nothing to show (no match yet, sheet not displayed): say
    // so outside OBS, otherwise the operator would face a blank page.
    var visible = !$("bug").classList.contains("hidden") ||
                  !$("sheet-panel").classList.contains("hidden");
    if (visible) {
      $("waiting").classList.add("hidden");
    } else {
      showWaiting("✓ Connecté à l'arbitre" +
        "<small>Le score apparaîtra au début de la partie (ce message n'apparaît pas dans OBS).</small>");
    }
  }

  function showWaiting(html) {
    if (inObs) { return; } // never pollute the broadcast with setup hints
    var w = $("waiting");
    w.innerHTML = html;
    w.classList.remove("hidden");
  }

  // -------------------------------------------------------------- bootstrap
  document.addEventListener("DOMContentLoaded", function () {
    applyParams();
    fitStage();
    window.addEventListener("resize", fitStage);
    setInterval(tickTimer, 250);

    // 2026-10-11 (v0.1.20): demo generator moved to live.js (shared with
    // the courtside tablet page).
    if (params.get("demo")) {
      Live.startDemo(onState, params.get("demo") === "sheet");
      arbattLog("BOOT", 8520, "Demo mode");
      return;
    }

    if (!Live.isPairingCode(channel)) {
      arbattLog("ERROR", 8501, "Missing or invalid ?code= parameter: nothing to display");
      showWaiting("arBATT — code d'appairage manquant ou invalide." +
        "<small>Adresse attendue : …/scoreboard.html?code=123456 (code à " +
        Live.PAIRING_CODE_DIGITS + " chiffres du panneau « Diffusion / OBS » de l'arbitre).</small>");
      return;
    }
    showWaiting("arBATT — en attente de l'arbitre…<small>code " +
      channel + " (ce message n'apparaît pas dans OBS)</small>");

    // 2026-10-11 (v0.1.20): shared with court.js (Live.subscribe).
    Live.subscribe(channel, params.get("relay") !== "0", onState);
    arbattLog("BOOT", 8502, "Scoreboard overlay on channel " + channel +
      (inObs ? " (inside OBS)" : ""));
  });
})();
