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
 * Teams of the FREE matches (pure model, no DOM) — window.arbattTeams.
 *
 * 2026-10-11 (v0.1.20): created. Free matches ("Nouvelle partie", without
 * the match sheet) are kept in a history (see sheet.recordFreeMatch). This
 * module lets the referee declare teams (2 or more), each with a list of
 * player names, and derives a TEAM STANDING from that history:
 *
 *   - a player belongs to the first team listing their name (comparison is
 *     case-, accent- and extra-space-insensitive: "  émma " == "Emma");
 *   - in doubles, a side belongs to a team only if BOTH players do;
 *   - every side that belongs to a team counts one match played for it, won
 *     or lost. A match between two players of the same team therefore counts
 *     one win AND one loss for that team; a side without a team is ignored.
 *   - ranking: most wins, then fewest losses, then name.
 *
 * The team of a side is resolved at display time from the CURRENT roster, so
 * editing the teams also re-assigns matches already played.
 *
 * Roster format (stored as arbatt.teams.v1, see studio.js):
 *   { "format": "arbatt-teams", "v": 1,
 *     "teams": [ { "id": "<uuid>", "name": "BATT 1", "players": ["Alice"] } ] }
 *
 * Event number convention in this file: 75xx.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  var FORMAT = "arbatt-teams";
  var VERSION = 1;

  function log(eid, msg) {
    if (typeof global.arbattLog === "function") { global.arbattLog("TEAMS", eid, msg); }
  }

  /** Name used for comparisons: lower case, no accents, single spaces. */
  function normalizeName(name) {
    return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  /** Player list from a textarea ("one per line"; commas/semicolons too). */
  function parsePlayers(text) {
    return String(text).split(/[\n,;]/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function createRoster() {
    return { format: FORMAT, v: VERSION, teams: [] };
  }

  function addTeam(roster, name) {
    var team = {
      id: global.arbattSheet.uuid(),
      name: String(name || "").trim() || "Équipe " + (roster.teams.length + 1),
      players: []
    };
    roster.teams.push(team);
    log(7500, "Team added: " + team.name);
    return team;
  }

  function findTeam(roster, id) {
    return roster.teams.filter(function (t) { return t.id === id; })[0] || null;
  }

  function removeTeam(roster, id) {
    var before = roster.teams.length;
    roster.teams = roster.teams.filter(function (t) { return t.id !== id; });
    if (roster.teams.length !== before) { log(7501, "Team removed: " + id); }
    return roster.teams.length !== before;
  }

  /** Team of one player name (first team listing it), or null. */
  function teamOfPlayer(roster, name) {
    var key = normalizeName(name);
    if (!key) { return null; }
    for (var i = 0; i < roster.teams.length; i++) {
      var t = roster.teams[i];
      for (var j = 0; j < t.players.length; j++) {
        if (normalizeName(t.players[j]) === key) { return t; }
      }
    }
    return null;
  }

  /** Team of a side (array of 1 or 2 names): all players in the same team. */
  function teamOfSide(roster, names) {
    if (!names || !names.length) { return null; }
    var team = teamOfPlayer(roster, names[0]);
    for (var i = 1; i < names.length && team; i++) {
      if (teamOfPlayer(roster, names[i]) !== team) { team = null; }
    }
    return team;
  }

  /**
   * Team standing over finished encounters (history entries: sides = arrays
   * of names, result.winner = 0 | 1). Returns every team of the roster, even
   * without match, sorted: [{id, name, played, won, lost}].
   */
  function standings(roster, encounters) {
    var rows = roster.teams.map(function (t) {
      return { id: t.id, name: t.name, played: 0, won: 0, lost: 0 };
    });
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    encounters.forEach(function (e) {
      if (!e.result) { return; }
      for (var s = 0; s < 2; s++) {
        var team = teamOfSide(roster, e.sides[s]);
        if (!team) { continue; }
        var row = byId[team.id];
        row.played += 1;
        if (e.result.winner === s) { row.won += 1; } else { row.lost += 1; }
      }
    });
    rows.sort(function (a, b) {
      return (b.won - a.won) || (a.lost - b.lost) || a.name.localeCompare(b.name);
    });
    return rows;
  }

  /** Every declared player, deduplicated (for the name inputs' datalist). */
  function allPlayers(roster) {
    var seen = {};
    var out = [];
    roster.teams.forEach(function (t) {
      t.players.forEach(function (p) {
        var k = normalizeName(p);
        if (!seen[k]) { seen[k] = true; out.push(p); }
      });
    });
    return out;
  }

  /** Validate a stored roster; throws an Error describing the problem. */
  function validateRoster(obj) {
    if (!obj || obj.format !== FORMAT) { throw new Error("Not an arBATT team list"); }
    if (obj.v !== VERSION) { throw new Error("Unsupported team list version: " + obj.v); }
    if (!Array.isArray(obj.teams)) { throw new Error("Missing teams"); }
    obj.teams.forEach(function (t, i) {
      if (!t.id || typeof t.name !== "string" || !Array.isArray(t.players)) {
        throw new Error("Team #" + (i + 1) + " is malformed");
      }
    });
    return obj;
  }

  var api = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    normalizeName: normalizeName,
    parsePlayers: parsePlayers,
    createRoster: createRoster,
    addTeam: addTeam,
    findTeam: findTeam,
    removeTeam: removeTeam,
    teamOfPlayer: teamOfPlayer,
    teamOfSide: teamOfSide,
    standings: standings,
    allPlayers: allPlayers,
    validateRoster: validateRoster
  };
  global.arbattTeams = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
