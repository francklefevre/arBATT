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
 * Match sheet ("feuille de match") model — pure functions, no DOM.
 *
 * 2026-10-06 (v0.1.12): created for the scoreboard/OBS mode. A sheet lists the
 * encounters (singles or doubles) of a team meeting between team A and team
 * B. Each encounter can be refereed from the sheet; its result is recorded
 * automatically when the match ends, and the team score (encounters won by
 * each team) is derived from the results — never stored — so it can't drift.
 *
 * Sheet JSON format (version 1), also used by export / import:
 *   {
 *     "format": "arbatt-sheet", "v": 1,
 *     "id": "<uuid>", "title": "Championnat — J3",
 *     "teams": ["BATT", "Visiteurs"],
 *     "encounters": [
 *       { "id": "<uuid>", "kind": "singles" | "doubles",
 *         "sides": [["Alice"], ["Bruno"]],          // doubles: 2 names each
 *         "result": null | { "winner": 0|1, "games": [3, 1],
 *                            "scores": [[11, 5], [9, 11], ...] } }
 *     ]
 *   }
 *
 * Event number convention in this file: 7xxx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  var FORMAT = "arbatt-sheet";
  var VERSION = 1;

  function log(eid, msg) {
    if (typeof global.arbattLog === "function") {
      global.arbattLog("SHEET", eid, msg);
    }
  }

  /** RFC 4122 v4 UUID (crypto-based; crypto is available in browsers and Node 19+). */
  function uuid() {
    var c = global.crypto;
    if (c && typeof c.randomUUID === "function") { return c.randomUUID(); }
    // Insecure contexts (plain-HTTP LAN address) lack randomUUID but still
    // provide getRandomValues: build the v4 UUID by hand from 16 random bytes.
    var b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) {
      return (x + 0x100).toString(16).slice(1);
    }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" +
      h.slice(16, 20) + "-" + h.slice(20);
  }

  /** Split a side entry ("Alice / Bob" or ["Alice","Bob"]) into trimmed names. */
  function parseSide(side, kind) {
    var names = Array.isArray(side) ? side.slice() : String(side || "").split("/");
    names = names.map(function (n) { return String(n).trim(); })
      .filter(function (n) { return n.length > 0; });
    var need = kind === "doubles" ? 2 : 1;
    if (names.length !== need) {
      throw new Error("A " + kind + " side needs exactly " + need +
        " name(s), got: " + JSON.stringify(side));
    }
    return names;
  }

  function createSheet(opts) {
    opts = opts || {};
    var sheet = {
      format: FORMAT,
      v: VERSION,
      id: uuid(),
      title: opts.title || "",
      teams: [(opts.teams && opts.teams[0]) || "Équipe A",
              (opts.teams && opts.teams[1]) || "Équipe B"],
      encounters: []
    };
    log(7000, "New sheet " + sheet.id);
    return sheet;
  }

  /** Append an encounter. `sides` items may be strings ("A / B") or arrays. */
  function addEncounter(sheet, kind, sides) {
    if (kind !== "singles" && kind !== "doubles") {
      throw new Error("Unknown encounter kind: " + kind);
    }
    var enc = {
      id: uuid(),
      kind: kind,
      sides: [parseSide(sides[0], kind), parseSide(sides[1], kind)],
      result: null
    };
    sheet.encounters.push(enc);
    log(7001, "Encounter added: " + sideLabel(enc, 0) + " vs " + sideLabel(enc, 1));
    return enc;
  }

  function findEncounter(sheet, id) {
    for (var i = 0; i < sheet.encounters.length; i++) {
      if (sheet.encounters[i].id === id) { return sheet.encounters[i]; }
    }
    return null;
  }

  function indexOfEncounter(sheet, id) {
    for (var i = 0; i < sheet.encounters.length; i++) {
      if (sheet.encounters[i].id === id) { return i; }
    }
    return -1;
  }

  function removeEncounter(sheet, id) {
    var i = indexOfEncounter(sheet, id);
    if (i < 0) { return false; }
    sheet.encounters.splice(i, 1);
    log(7002, "Encounter removed: " + id);
    return true;
  }

  /** Move an encounter up (delta=-1) or down (+1). Returns true if moved. */
  function moveEncounter(sheet, id, delta) {
    var i = indexOfEncounter(sheet, id);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= sheet.encounters.length) { return false; }
    var tmp = sheet.encounters[i];
    sheet.encounters[i] = sheet.encounters[j];
    sheet.encounters[j] = tmp;
    return true;
  }

  /**
   * Record the result of an encounter from a scoring-engine view
   * (TTScorer/DoublesScorer `view()` of a FINISHED match). Side 0 of the
   * match is always team A of the sheet (the match is pre-filled that way).
   */
  function recordResultFromView(sheet, id, view) {
    var enc = findEncounter(sheet, id);
    if (!enc) { throw new Error("Unknown encounter: " + id); }
    if (!view.finished) { throw new Error("Match not finished"); }
    enc.result = {
      winner: view.winner,
      games: view.games.slice(),
      scores: view.completedGames.map(function (g) { return g.points.slice(); })
    };
    log(7003, "Result recorded for " + id + ": " + enc.result.games.join("-"));
    return enc;
  }

  function clearResult(sheet, id) {
    var enc = findEncounter(sheet, id);
    if (!enc || !enc.result) { return false; }
    enc.result = null;
    log(7004, "Result cleared for " + id);
    return true;
  }

  /** Team score = number of encounters won by each team. */
  function teamScore(sheet) {
    var s = [0, 0];
    sheet.encounters.forEach(function (e) {
      if (e.result) { s[e.result.winner] += 1; }
    });
    return s;
  }

  /** First encounter without a result, or null. */
  function nextPending(sheet) {
    for (var i = 0; i < sheet.encounters.length; i++) {
      if (!sheet.encounters[i].result) { return sheet.encounters[i]; }
    }
    return null;
  }

  function sideLabel(enc, side) {
    return enc.sides[side].join(" / ");
  }

  /** "11-5 9-11 11-7" — game scores seen from team A. */
  function scoresLabel(enc) {
    if (!enc.result) { return ""; }
    return enc.result.scores.map(function (p) { return p[0] + "-" + p[1]; }).join(" ");
  }

  /**
   * Generate encounters from two rosters: every player of A meets every player
   * of B, by rounds of rotation (round k: A[i] vs B[(i+k) mod |B|]) so that
   * consecutive encounters mostly involve different players, then `doubles` doubles placeholders built from the first
   * players. The referee then prunes/reorders to match the official sheet.
   */
  function generateCross(sheet, rosterA, rosterB, doubles) {
    var a = rosterA.filter(Boolean), b = rosterB.filter(Boolean);
    var added = 0;
    // Round k pairs a[i] with b[(i+k) % len(b)]: a classic rotation.
    for (var k = 0; k < b.length; k++) {
      for (var i = 0; i < a.length; i++) {
        addEncounter(sheet, "singles", [[a[i]], [b[(i + k) % b.length]]]);
        added++;
      }
    }
    for (var d = 0; d < (doubles || 0); d++) {
      if (a.length < 2 || b.length < 2) { break; }
      var ia = (2 * d) % a.length, ib = (2 * d) % b.length;
      addEncounter(sheet, "doubles", [[a[ia], a[(ia + 1) % a.length]],
                                      [b[ib], b[(ib + 1) % b.length]]]);
      added++;
    }
    log(7005, "Generated " + added + " encounters (" + a.length + "x" +
      b.length + ", doubles=" + (doubles || 0) + ")");
    return added;
  }

  /** Validate an imported object; throws an Error describing the problem. */
  function validateSheet(obj) {
    if (!obj || obj.format !== FORMAT) { throw new Error("Not an arBATT sheet"); }
    if (obj.v !== VERSION) { throw new Error("Unsupported sheet version: " + obj.v); }
    if (!Array.isArray(obj.teams) || obj.teams.length !== 2) {
      throw new Error("A sheet needs exactly 2 teams");
    }
    if (!Array.isArray(obj.encounters)) { throw new Error("Missing encounters"); }
    obj.encounters.forEach(function (e, i) {
      if (!e.id || (e.kind !== "singles" && e.kind !== "doubles")) {
        throw new Error("Encounter #" + (i + 1) + " is malformed");
      }
      parseSide(e.sides && e.sides[0], e.kind);
      parseSide(e.sides && e.sides[1], e.kind);
      if (e.result && e.result.winner !== 0 && e.result.winner !== 1) {
        throw new Error("Encounter #" + (i + 1) + " has an invalid result");
      }
    });
    return obj;
  }

  var api = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    uuid: uuid,
    parseSide: parseSide,
    createSheet: createSheet,
    addEncounter: addEncounter,
    findEncounter: findEncounter,
    indexOfEncounter: indexOfEncounter,
    removeEncounter: removeEncounter,
    moveEncounter: moveEncounter,
    recordResultFromView: recordResultFromView,
    clearResult: clearResult,
    teamScore: teamScore,
    nextPending: nextPending,
    sideLabel: sideLabel,
    scoresLabel: scoresLabel,
    generateCross: generateCross,
    validateSheet: validateSheet
  };
  global.arbattSheet = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
