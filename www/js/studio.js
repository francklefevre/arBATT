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
 * "Studio" (régie) of the referee app — scoreboard / OBS mode.
 *
 * 2026-10-06 (v0.1.12): created. Responsibilities:
 *   - the match sheet screen (#screen-sheet): prepare the encounters of a team
 *     meeting, referee them one by one, see the team score;
 *   - the broadcast panel (#live): overlay URL for OBS, what is shown on the
 *     public display (score bug / full match sheet), relay status;
 *   - publishing a FULL snapshot {match, timer, sheet, display} to the overlay
 *     (scoreboard.html) through live.js whenever app.js calls notify().
 *
 * Collaboration with app.js (loaded after this file) goes through
 * window.arbattApp (liveState, prefillFromEncounter, ...) and, the other way,
 * window.arbattStudio (notify, onMatchFinished). Both are resolved lazily at
 * call time, so the script order only matters for the DOMContentLoaded order.
 *
 * Browser storage (per device, via localStorage):
 *   arbatt.sheet.v1 — the current match sheet (see sheet.js for the format)
 *   arbatt.live.v1  — {channel, display:{scorebug, sheet}, token}
 *
 * Event number convention in this file: 9xxx.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  var S = window.arbattSheet;
  var T = window.arbattTeams;   // 2026-10-11 (v0.1.20): free-match teams
  var Live = window.arbattLive;

  var SHEET_KEY = "arbatt.sheet.v1";
  var LIVE_KEY = "arbatt.live.v1";
  // 2026-10-11 (v0.1.18): results of free matches (played without the sheet).
  var HISTORY_KEY = "arbatt.history.v1";
  // 2026-10-11 (v0.1.20): teams of the free matches (see teams.js).
  var TEAMS_KEY = "arbatt.teams.v1";
  var OVERLAY_PAGE = "scoreboard.html";
  var COURT_PAGE = "court.html";   // 2026-10-11 (v0.1.20): tablet display
  // Two-tap confirmation window for destructive buttons (no window.confirm:
  // it blocks the UI and is unavailable in some embedded browsers).
  var CONFIRM_MS = 3000;

  var sheet = null;            // current match sheet (null until created)
  var history = null;          // free-match results (a sheet object, see below)
  var roster = null;           // free-match teams (teams.js roster)
  var liveCfg = null;          // persisted broadcast settings
  var publisher = null;        // LivePublisher
  var relayInfo = null;        // result of detectRelay() (null = no relay)
  var relayState = { status: "pending", detail: "" };
  var ready = false;

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------- storage
  function loadJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      arbattLog("WARN", 9000, "Cannot read " + key + " from storage: " + e);
      return null;
    }
  }

  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      arbattLog("ERROR", 9001, "Cannot save " + key + " to storage: " + e);
    }
  }

  // 2026-10-11 (v0.1.18): shared by the match sheet and the free-match
  // history (both are sheet objects); was specific to the sheet.
  function loadSheetFrom(key) {
    var obj = loadJSON(key);
    if (!obj) { return null; }
    try {
      return S.validateSheet(obj);
    } catch (e) {
      arbattLog("ERROR", 9002, "Stored " + key + " is invalid, ignored: " + e.message);
      return null;
    }
  }

  function loadSheet() { return loadSheetFrom(SHEET_KEY); }

  function loadRoster() {
    var obj = loadJSON(TEAMS_KEY);
    if (!obj) { return T.createRoster(); }
    try {
      return T.validateRoster(obj);
    } catch (e) {
      arbattLog("ERROR", 9003, "Stored " + TEAMS_KEY + " is invalid, ignored: " + e.message);
      return T.createRoster();
    }
  }

  function saveRoster() { saveJSON(TEAMS_KEY, roster); }

  function saveSheet() {
    if (sheet) { saveJSON(SHEET_KEY, sheet); }
  }

  function saveLiveCfg() { saveJSON(LIVE_KEY, liveCfg); }

  // ------------------------------------------------------------- publishing
  /** Encounter as published to the overlay (labels precomputed). */
  function publicEncounter(enc, index) {
    return {
      id: enc.id,
      num: index + 1,
      kind: enc.kind,
      sides: [S.sideLabel(enc, 0), S.sideLabel(enc, 1)],
      result: enc.result,
      scores: S.scoresLabel(enc)
    };
  }

  /**
   * Sheet panel content of the overlay. 2026-10-11 (v0.1.18): the match sheet
   * when it has encounters, otherwise the free-match history (flag
   * `history: true`: the overlay then shows "Résultats" without team score).
   * 2026-10-11 (v0.1.19): the history is published even when EMPTY, so that
   * ticking "Afficher la feuille de match" always shows something (reported:
   * "no visible difference" with no sheet and no finished free match yet).
   */
  function publicSheet() {
    if (sheet && sheet.encounters.length) {
      return {
        title: sheet.title,
        teams: sheet.teams.slice(),
        score: S.teamScore(sheet),
        encounters: sheet.encounters.map(publicEncounter)
      };
    }
    var pub = {
      history: true,
      title: "Résultats",
      teams: ["", ""],
      score: [0, 0],
      encounters: history ? history.encounters.map(publicEncounter) : []
    };
    // 2026-10-11 (v0.1.20): team standing instead of the match list.
    if (liveCfg.display.results === "teams") {
      pub.title = "Classement par équipe";
      pub.standings = T.standings(roster, history ? history.encounters : []);
    }
    return pub;
  }

  /** Build and publish the full snapshot. Called by app.js after any change. */
  function notify() {
    if (!ready || !publisher) { return; }
    var app = window.arbattApp ? window.arbattApp.liveState() : { match: null, timer: null };
    publisher.publish({
      version: window.arbattApp ? window.arbattApp.version() : "?",
      display: { scorebug: !!liveCfg.display.scorebug, sheet: !!liveCfg.display.sheet },
      match: app.match,
      timer: app.timer,
      sheet: publicSheet()
    });
  }

  function onRelayStatus(status, detail) {
    relayState = { status: status, detail: detail };
    renderLiveStatus();
  }

  function createPublisher() {
    if (publisher) { publisher.close(); }
    publisher = new Live.LivePublisher({
      channel: liveCfg.channel,
      relay: !!relayInfo,
      token: liveCfg.token,
      onStatus: onRelayStatus
    });
  }

  // ------------------------------------------------------- sheet <-> match
  function onMatchFinished(encounterId, view) {
    if (!sheet || !S.findEncounter(sheet, encounterId)) {
      arbattLog("WARN", 9010, "Finished match refers to an unknown encounter " +
        encounterId);
      return;
    }
    S.recordResultFromView(sheet, encounterId, view);
    saveSheet();
    renderSheet();
    // app.js publishes right after (render -> notifyLive), no notify() here.
  }

  /** Free match finished (see app.js showResult and S.recordFreeMatch). */
  function onFreeMatchFinished(opts) {
    if (!history) { history = S.createSheet({ title: "Résultats" }); }
    var enc = S.recordFreeMatch(history, opts);
    if (!enc) { return; } // already recorded (result screen shown again)
    saveJSON(HISTORY_KEY, history);
    renderHistoryCount();
    renderStandings();
    arbattLog("SCORE", 9012, "Free match kept in history: " +
      opts.sides[0] + " vs " + opts.sides[1] + " " + enc.result.games.join("-"));
    // app.js publishes right after (render -> notifyLive), no notify() here.
  }

  function renderHistoryCount() {
    var n = history ? history.encounters.length : 0;
    $("live-history-clear").textContent = "🗑 Effacer les résultats des parties libres (" + n + ")";
    $("live-history-clear").disabled = n === 0;
  }

  function refereeEncounter(id) {
    var enc = S.findEncounter(sheet, id);
    if (!enc) { return; }
    var idx = S.indexOfEncounter(sheet, id);
    window.arbattApp.prefillFromEncounter({
      id: enc.id,
      kind: enc.kind,
      sides: enc.sides,
      label: "n° " + (idx + 1) + " — " + S.sideLabel(enc, 0) + " vs " + S.sideLabel(enc, 1)
    });
  }

  // ------------------------------------------------------------ teams screen
  // 2026-10-11 (v0.1.20). The list is rebuilt only on add/remove; typing
  // updates the model in place (no re-render: the input keeps its focus).

  function renderTeams() {
    var list = $("teams-list");
    list.innerHTML = "";
    $("teams-empty").classList.toggle("hidden", roster.teams.length > 0);
    roster.teams.forEach(function (t) {
      var li = el("li", "team-card");
      li.dataset.id = t.id;
      var head = el("div", "team-head");
      var name = el("input", "team-name");
      name.type = "text";
      name.maxLength = 24;
      name.value = t.name;
      name.dataset.field = "name";
      name.setAttribute("aria-label", "Nom de l'équipe");
      head.appendChild(name);
      head.appendChild(actionButton("team-del", t.id, "✕", "Supprimer l'équipe"));
      li.appendChild(head);
      var players = el("textarea", "team-players");
      players.rows = 3;
      players.value = t.players.join("\n");
      players.dataset.field = "players";
      players.placeholder = "Un joueur par ligne";
      players.setAttribute("aria-label", "Joueurs de " + t.name);
      li.appendChild(players);
      li.appendChild(el("small", "", t.players.length + " joueur(s)"));
      list.appendChild(li);
    });
    renderStandings();
    renderKnownPlayers();
  }

  /** Team standing on the phone (same computation as the overlay). */
  function renderStandings() {
    var list = $("teams-standings");
    if (!list) { return; }
    list.innerHTML = "";
    T.standings(roster, history ? history.encounters : []).forEach(function (r, i) {
      var li = el("li", "ts-row");
      li.appendChild(el("span", "ts-rank", String(i + 1)));
      li.appendChild(el("span", "ts-name", r.name));
      li.appendChild(el("span", "ts-rec", r.won + " V · " + r.lost + " D"));
      list.appendChild(li);
    });
  }

  /** Declared players suggested in the new-match name fields. */
  function renderKnownPlayers() {
    var dl = $("known-players");
    dl.innerHTML = "";
    T.allPlayers(roster).forEach(function (p) {
      var o = document.createElement("option");
      o.value = p;
      dl.appendChild(o);
    });
  }

  function teamsChanged() {
    saveRoster();
    renderStandings();
    renderKnownPlayers();
    notify();
  }

  function bindTeams() {
    $("teams-add").addEventListener("click", function () {
      T.addTeam(roster, "");
      saveRoster();
      renderTeams();
      notify();
    });
    $("teams-list").addEventListener("input", function (ev) {
      var card = ev.target.closest(".team-card");
      var team = card && T.findTeam(roster, card.dataset.id);
      if (!team) { return; }
      if (ev.target.dataset.field === "name") {
        team.name = ev.target.value.trim() || team.name;
      } else if (ev.target.dataset.field === "players") {
        team.players = T.parsePlayers(ev.target.value);
        card.querySelector("small").textContent = team.players.length + " joueur(s)";
      }
      teamsChanged();
    });
    $("teams-list").addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-act='team-del']");
      if (!btn) { return; }
      confirmTap(btn, function () {
        T.removeTeam(roster, btn.dataset.id);
        renderTeams();
        teamsChanged();
      });
    });
  }

  // ------------------------------------------------------------ sheet screen
  function ensureSheet() {
    if (!sheet) {
      sheet = S.createSheet({});
      saveSheet();
    }
    return sheet;
  }

  /** Small helper creating an element with class and text. */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  function actionButton(act, id, label, title, disabled) {
    var b = el("button", "sr-btn", label);
    b.type = "button";
    b.dataset.act = act;
    b.dataset.id = id;
    b.title = title;
    b.disabled = !!disabled;
    return b;
  }

  /** Team names + team score banner (no input fields: safe while typing). */
  function renderSheetHeader() {
    var score = S.teamScore(sheet);
    $("sheet-name-a").textContent = sheet.teams[0];
    $("sheet-name-b").textContent = sheet.teams[1];
    $("sheet-score-a").textContent = score[0];
    $("sheet-score-b").textContent = score[1];
  }

  function renderSheet() {
    if (!sheet || !$("screen-sheet")) { return; }
    $("sheet-title").value = sheet.title;
    $("sheet-teamA").value = sheet.teams[0];
    $("sheet-teamB").value = sheet.teams[1];
    renderSheetHeader();

    var linked = window.arbattApp ? window.arbattApp.linkedEncounterId() : null;
    var list = $("sheet-list");
    list.innerHTML = "";
    $("sheet-empty").classList.toggle("hidden", sheet.encounters.length > 0);
    sheet.encounters.forEach(function (enc, i) {
      var li = el("li", "sheet-row");
      var live = (enc.id === linked && !enc.result);
      li.classList.toggle("done", !!enc.result);
      li.classList.toggle("live", live);
      li.dataset.id = enc.id;

      li.appendChild(el("span", "sr-num", String(i + 1)));
      li.appendChild(el("span", "sr-kind", enc.kind === "doubles" ? "D" : "S"));

      var sides = el("span", "sr-sides");
      var a = el("span", "", S.sideLabel(enc, 0));
      var b = el("span", "", S.sideLabel(enc, 1));
      if (enc.result) { (enc.result.winner === 0 ? a : b).className = "win"; }
      sides.appendChild(a);
      sides.appendChild(el("span", "sr-vs", " vs "));
      sides.appendChild(b);
      li.appendChild(sides);

      var res = el("span", "sr-result");
      if (enc.result) {
        res.appendChild(el("b", "", enc.result.games.join("-")));
        res.appendChild(el("small", "", " " + S.scoresLabel(enc)));
      } else if (live) {
        res.textContent = "● en cours";
      }
      li.appendChild(res);

      var acts = el("span", "sr-actions");
      acts.appendChild(actionButton("play", enc.id, "▶", "Arbitrer cette rencontre"));
      acts.appendChild(actionButton("up", enc.id, "↑", "Monter", i === 0));
      acts.appendChild(actionButton("down", enc.id, "↓", "Descendre",
        i === sheet.encounters.length - 1));
      acts.appendChild(actionButton("clear", enc.id, "↺", "Effacer le résultat", !enc.result));
      acts.appendChild(actionButton("del", enc.id, "✕", "Supprimer"));
      li.appendChild(acts);
      list.appendChild(li);
    });
  }

  /**
   * Two-tap confirmation: the first tap arms the button (label changes), a
   * second tap within CONFIRM_MS runs `action`. Returns true when executed.
   */
  function confirmTap(btn, action) {
    if (btn.dataset.armed === "1") {
      btn.dataset.armed = "";
      btn.textContent = btn.dataset.label;
      action();
      return true;
    }
    btn.dataset.armed = "1";
    btn.dataset.label = btn.textContent;
    btn.textContent = "Confirmer ?";
    setTimeout(function () {
      if (btn.dataset.armed === "1") {
        btn.dataset.armed = "";
        btn.textContent = btn.dataset.label;
      }
    }, CONFIRM_MS);
    return false;
  }

  function sheetChanged() {
    saveSheet();
    renderSheet();
    notify();
  }

  function onSheetListClick(ev) {
    var btn = ev.target.closest("button[data-act]");
    if (!btn) { return; }
    var id = btn.dataset.id;
    switch (btn.dataset.act) {
      case "play": refereeEncounter(id); return;
      case "up": S.moveEncounter(sheet, id, -1); break;
      case "down": S.moveEncounter(sheet, id, 1); break;
      case "clear": S.clearResult(sheet, id); break;
      case "del":
        if (!confirmTap(btn, function () { S.removeEncounter(sheet, id); })) { return; }
        break;
      default: return;
    }
    sheetChanged();
  }

  function onAddEncounter() {
    var kind = document.querySelector("input[name=sheet-kind]:checked").value;
    var state = $("sheet-add-state");
    try {
      S.addEncounter(ensureSheet(), kind, [$("sheet-sideA").value, $("sheet-sideB").value]);
      $("sheet-sideA").value = "";
      $("sheet-sideB").value = "";
      state.textContent = "Rencontre ajoutée.";
      sheetChanged();
    } catch (e) {
      // User input error: shown to the referee, logged as a warning.
      state.textContent = kind === "doubles"
        ? "En double, saisissez 2 noms par côté : « Nom 1 / Nom 2 »."
        : "Saisissez un nom de chaque côté.";
      arbattLog("WARN", 9020, "Encounter not added: " + e.message);
    }
  }

  function rosterLines(id) {
    return $(id).value.split(/[\n,;]/).map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function onGenerate() {
    var a = rosterLines("sheet-rosterA");
    var b = rosterLines("sheet-rosterB");
    var doubles = parseInt($("sheet-doubles").value, 10) || 0;
    var state = $("sheet-gen-state");
    if (!a.length || !b.length) {
      state.textContent = "Saisissez au moins un joueur par équipe.";
      return;
    }
    var n = S.generateCross(ensureSheet(), a, b, doubles);
    state.textContent = n + " rencontres ajoutées — supprimez / réordonnez " +
      "pour coller à la feuille officielle.";
    sheetChanged();
  }

  function onExport() {
    var blob = new Blob([JSON.stringify(ensureSheet(), null, 2)],
      { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "arbatt-feuille-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    arbattLog("SHEET", 9030, "Sheet exported");
  }

  function onImportFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        sheet = S.validateSheet(JSON.parse(reader.result));
        $("sheet-io-state").textContent = "Feuille importée.";
        arbattLog("SHEET", 9031, "Sheet imported: " + file.name);
        sheetChanged();
      } catch (e) {
        $("sheet-io-state").textContent = "Fichier invalide : " + e.message;
        arbattLog("ERROR", 9032, "Sheet import failed: " + e.message);
      }
      ev.target.value = "";
    };
    reader.readAsText(file);
  }

  function bindSheet() {
    $("sheet-list").addEventListener("click", onSheetListClick);
    $("sheet-add-btn").addEventListener("click", onAddEncounter);
    $("sheet-gen-btn").addEventListener("click", onGenerate);
    $("sheet-export").addEventListener("click", onExport);
    $("sheet-import").addEventListener("click", function () { $("sheet-file").click(); });
    $("sheet-file").addEventListener("change", onImportFile);
    $("sheet-new").addEventListener("click", function (ev) {
      confirmTap(ev.currentTarget, function () {
        sheet = S.createSheet({});
        sheetChanged();
      });
    });
    $("sheet-next").addEventListener("click", function () {
      var enc = S.nextPending(ensureSheet());
      if (enc) { refereeEncounter(enc.id); }
      else { $("sheet-io-state").textContent = "Toutes les rencontres ont un résultat."; }
    });
    // Title / team names: saved on every keystroke.
    [["sheet-title", function (v) { sheet.title = v; }],
     ["sheet-teamA", function (v) { sheet.teams[0] = v || "Équipe A"; }],
     ["sheet-teamB", function (v) { sheet.teams[1] = v || "Équipe B"; }]
    ].forEach(function (pair) {
      $(pair[0]).addEventListener("input", function (ev) {
        ensureSheet();
        pair[1](ev.target.value.trim());
        saveSheet();
        renderSheetHeader();
        notify();
      });
    });
    // Opening the sheet screen (from the menu or the result screen).
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-target='screen-sheet']");
      if (t) { ensureSheet(); renderSheet(); }
    });
  }

  // ---------------------------------------------------------- broadcast panel
  /** Absolute URL of a display page on the current channel. */
  function displayUrl(page) {
    return new URL(page + "?ch=" + encodeURIComponent(liveCfg.channel),
      window.location.href).href;
  }

  function overlayUrl() { return displayUrl(OVERLAY_PAGE); }

  /**
   * Draw `text` as a QR code (SVG) inside the element `id`.
   * 2026-10-11 (v0.1.21): vendored qrcode-generator (window.qrcode), type
   * number 0 = smallest fitting version, error correction "M".
   */
  function renderQr(id, text) {
    var qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    $(id).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  }

  /** Fill both display addresses (overlay + tablet) and the tablet QR code. */
  function renderDisplayUrls() {
    $("live-url").value = overlayUrl();
    $("court-url").value = displayUrl(COURT_PAGE);
    renderQr("court-qr", displayUrl(COURT_PAGE));
  }

  /**
   * Copy / open buttons of one display address. 2026-10-11 (v0.1.20):
   * shared by the OBS overlay and the courtside tablet (was overlay-only).
   */
  function bindDisplayUrl(prefix, page, windowName) {
    $(prefix + "-url").addEventListener("focus", function (ev) { ev.target.select(); });
    $(prefix + "-copy").addEventListener("click", function () {
      var url = displayUrl(page);
      var done = function (ok) {
        $(prefix + "-copy-state").textContent = ok ? "Adresse copiée ✓"
          : "Copie impossible : sélectionnez l'adresse et copiez-la.";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); },
          function () { done(false); });
      } else {
        $(prefix + "-url").select();
        done(false);
      }
    });
    $(prefix + "-open").addEventListener("click", function () {
      window.open(displayUrl(page), windowName);
    });
  }

  function renderLiveStatus() {
    var st = $("live-status");
    if (!st) { return; }
    var txt;
    if (!relayInfo) {
      txt = relayState.status === "pending"
        ? "Relais réseau : détection…"
        : "Relais réseau : indisponible sur cet hébergement (ni server.py, ni " +
          "PHP api/live.php) — l'affichage public ne fonctionne que dans ce " +
          "même navigateur (autre onglet / fenêtre).";
    } else if (relayState.status === "error") {
      txt = "Relais réseau : ERREUR (" + relayState.detail + ")";
    } else {
      txt = "Relais réseau : actif ✓ — l'affichage peut être sur un autre appareil (OBS).";
    }
    st.textContent = txt;
    st.classList.toggle("bad", relayState.status === "error");
    $("live-token-row").classList.toggle("hidden", !(relayInfo && relayInfo.tokenRequired));
  }

  function openLivePanel() {
    renderDisplayUrls();
    $("court-copy-state").textContent = "";
    $("live-show-score").checked = !!liveCfg.display.scorebug;
    $("live-show-sheet").checked = !!liveCfg.display.sheet;
    document.querySelectorAll("input[name=live-results]").forEach(function (r) {
      r.checked = (r.value === liveCfg.display.results);
    });
    renderHistoryCount();
    $("live-token").value = liveCfg.token || "";
    $("live-copy-state").textContent = "";
    renderLiveStatus();
    $("live").classList.remove("hidden");
    arbattLog("UI", 9040, "Open broadcast panel (channel " + liveCfg.channel + ")");
  }

  function bindLivePanel() {
    document.addEventListener("click", function (ev) {
      if (ev.target.closest(".open-live")) { openLivePanel(); }
    });
    $("live-close").addEventListener("click", function () {
      $("live").classList.add("hidden");
    });
    bindDisplayUrl("live", OVERLAY_PAGE, "arbatt-scoreboard");
    bindDisplayUrl("court", COURT_PAGE, "arbatt-court");
    // 2026-10-11 (v0.1.21): show / hide the tablet QR code.
    $("court-qr-btn").addEventListener("click", function (ev) {
      var hidden = $("court-qr").classList.toggle("hidden");
      ev.currentTarget.setAttribute("aria-expanded", String(!hidden));
      arbattLog("UI", 9044, "Tablet QR code " + (hidden ? "hidden" : "shown"));
    });
    $("live-show-score").addEventListener("change", function (ev) {
      liveCfg.display.scorebug = ev.target.checked;
      saveLiveCfg();
      notify();
    });
    $("live-show-sheet").addEventListener("change", function (ev) {
      liveCfg.display.sheet = ev.target.checked;
      saveLiveCfg();
      notify();
    });
    // 2026-10-11 (v0.1.20): free-match results per match or per team.
    document.querySelectorAll("input[name=live-results]").forEach(function (r) {
      r.addEventListener("change", function (ev) {
        liveCfg.display.results = ev.target.value;
        saveLiveCfg();
        arbattLog("UI", 9043, "Free-match results shown " + ev.target.value);
        notify();
      });
    });
    $("live-history-clear").addEventListener("click", function (ev) {
      confirmTap(ev.currentTarget, function () {
        history = null;
        try { window.localStorage.removeItem(HISTORY_KEY); } catch (e) {
          arbattLog("ERROR", 9001, "Cannot clear " + HISTORY_KEY + ": " + e);
        }
        renderHistoryCount();
        renderStandings();
        arbattLog("UI", 9042, "Free-match history cleared");
        notify();
      });
    });
    $("live-token").addEventListener("change", function (ev) {
      liveCfg.token = ev.target.value;
      saveLiveCfg();
      createPublisher();
      notify();
    });
    $("live-newch").addEventListener("click", function (ev) {
      confirmTap(ev.currentTarget, function () {
        liveCfg.channel = S.uuid();
        saveLiveCfg();
        createPublisher();
        renderDisplayUrls();
        arbattLog("LIVE", 9041, "New broadcast channel " + liveCfg.channel);
        notify();
      });
    });
  }

  // --------------------------------------------------------------- bootstrap
  document.addEventListener("DOMContentLoaded", function () {
    sheet = loadSheet();
    history = loadSheetFrom(HISTORY_KEY);
    roster = loadRoster();
    liveCfg = loadJSON(LIVE_KEY) || {};
    if (!liveCfg.channel) { liveCfg.channel = S.uuid(); }
    liveCfg.display = liveCfg.display || { scorebug: true, sheet: false };
    liveCfg.token = liveCfg.token || "";
    // 2026-10-11 (v0.1.20): "matches" | "teams" (free-match results panel).
    if (liveCfg.display.results !== "teams") { liveCfg.display.results = "matches"; }
    saveLiveCfg();

    bindSheet();
    bindLivePanel();
    bindTeams();
    renderTeams();
    createPublisher();
    ready = true;
    arbattLog("BOOT", 9050, "Studio ready (channel " + liveCfg.channel +
      ", sheet " + (sheet ? sheet.encounters.length + " encounters" : "none") + ")");

    Live.detectRelay("").then(function (info) {
      relayInfo = info;
      relayState = { status: info ? "ok" : "off", detail: "" };
      createPublisher();
      renderLiveStatus();
      notify(); // push the current state through the newly enabled relay
    });
  });

  window.arbattStudio = {
    notify: notify,
    onMatchFinished: onMatchFinished,
    onFreeMatchFinished: onFreeMatchFinished,
    getHistory: function () { return history; },
    getRoster: function () { return roster; },
    // Exposed for tests / debugging from the console.
    getSheet: function () { return sheet; },
    getChannel: function () { return liveCfg && liveCfg.channel; },
    overlayUrl: overlayUrl
  };
})();
