<!--
  arBATT - Table tennis club referee companion (PWA)
  Free software developed by Franck LEFEVRE for K1 ( https://k1info.com ),
  with the help of his team of kind and playful robots.
-->

# AGENTS_METHODS.md

Working knowledge base for arBATT. Read this first when resuming work; it
captures what was learned and the conventions in force, so a session can
continue without replaying previous conversations.

## What the project is

A PWA assisting a table-tennis **club referee**. Shipped offline-capable and
opened via a QR code. A minimal hermetic Python static server (`server.py`)
serves the single web-root `www/`. The flagship feature is **point counting**,
whose rules come entirely from `doc/manuel AC.pdf` (FFTT 2025/2026).

## Source of truth for the rules

`doc/manuel AC.pdf` — extracted to `doc/manuel_AC.txt` with:

```bash
pdftotext -layout "doc/manuel AC.pdf" doc/manuel_AC.txt
```

Key singles rules distilled from it (page references in the manual):

- Game to **11**, win by **2**; at **10-10** play continues until a 2-pt lead.
- Service alternates **every 2 points**; from **10-10** it changes **every point**.
- First server **alternates each game**.
- **Change ends every game**; in the **deciding game** also change ends as soon
  as a player reaches **5 points**.
- Announce **server score first**.
- **1 time-out** per player per match (max 1 min, white card).
- Wiping break ("s'éponger") allowed **every 6 points**.
- Doubles: server changes every 2 pts; the 4 players rotate. In the deciding
  game the receiving order is reversed when a pair reaches 5 (ALSO change ends).
  *(coded in doubles.js — see decision below)*
- Acceleration rule: after 10 min of effective play with < 18 points (or on
  both players' request); then server changes **every point** and **13 good
  returns** by the receiver wins the point for the receiver. *(not yet coded)*
- Cards: yellow → yellow+red (+1 pt) → yellow+red (+2 pts) → red (referee). *(not yet coded)*

## Architectural decisions

- **Server/ends are derived from the score** (`serverOf()` + `leftPlayer()`),
  never stored mutably. Consequence: **undo is exact** with a simple state
  snapshot stack. Keep this property when extending.
- **Single web-root, hermetic**: `server.py` rejects path traversal by
  normalising the URL path and ensuring the resolved file stays under the
  web-root. Verified that `/etc/passwd` etc. are never served (always 404).
  Note: `posixpath.normpath` collapses `../`, so escape resolves *inside* the
  root and returns 404; the explicit 403 SECURITY branch is defense-in-depth.
- **`version.json` is generated** into `www/` at server startup from
  `config/param.json`, keeping a single source of truth for the version.
- **Centralised logging** on both sides: `arbatt_log.py` (Python) and
  `www/js/log.js` (browser). Format `STAMP [TAG] #NNNN message`. Event-number
  convention: `1xxx` server, `2xxx` PWA app, `3xxx` scorer, `4xxx` timer,
  `5xxx` doubles, `6xxx` live hub (arbatt_live.py), `7xxx` sheet.js,
  `80xx` live.js, `85xx` scoreboard.js, `9xxx` studio.js. (Acceleration
  reuses `30xx`/`50xx` in the engines and `204x` in the app.)
- **Doubles rotation**: a game's serve order is `[S, R, S', R']`
  (S=first server, R=first receiver, primes=partners). Using the shared
  `serviceBlocks(p0,p1,pts)` block count `k`:
  `server = order[k%4]`, `receiver = order[(k+1)%4]`. This reproduces the
  manual's example (Xavier serves Bernard → Bernard serves Yves → ...).
  The **deciding-game inversion at 5 pts** is modelled as
  `receiver = partner(base receiver)` (verified: keeps every server→opponent
  valid and each player receiving once per cycle). Only the RECEIVING order
  flips; the serving sequence is unchanged. The umpire can still set/correct
  the per-game (server, receiver) via `setGameStart()` / the 🔁 Service overlay.
- **Client app config**: server generates `www/app-config.json`
  (version + warmupSeconds + timeoutSeconds) at startup; the PWA fetches it
  (network-first in the SW). Replaced the earlier bare `version.json`.
- **Timer engine** (`timer.js`): recomputes `remaining()` from an injectable
  time source rather than decrementing a counter — accurate across pause/resume
  and unit-testable with a fake clock.
- **Cards & sanctions**: shared `sanctionForCount(n)` (scorer.js, exported)
  encodes the FFTT ladder (1=🟨, 2=🟨🟥 +1, 3=🟨🟥🟥 +2, 4=🟥 referee). Both
  engines have `sanction(player)` that awards penalty points to the opponent
  via the snapshot-free `_applyPoint()` so the whole sanction is ONE undo. Per
  player (4 in doubles); penalty goes to the opposing pair. `view()` exposes
  `infractions[]` + `refereeCalled`.
- **Acceleration rule** (`acceleratedBlocks()` in scorer.js, shared with
  doubles): under acceleration the server changes EVERY point. It can start
  mid-game and PERSISTS to the end of the match. Modelled by recording the
  game index + in-game total at activation; the block count is
  `floor(accelFromTotal/2) + (total - accelFromTotal)` for the activation game
  (pre-accel portion was every-2, post is every-1), and simply `total` for
  later games. `activateAcceleration()` snapshots so undo reverts it. The
  13-return mechanic ("server loses the point") lives in the UI: a counter;
  reaching `accelReturns` (param, 13) calls `pointTo(receivingSide)`. The
  10-min / 18-point AUTO trigger waits on the future per-game chronometry.
- **Icons from the club logo**: `BATT_Man_2026.svg` is A4/Inkscape; render with
  `inkscape --export-area-drawing --export-height=900` then composite with
  Pillow onto the green theme (see history v0.1.1 / the snippet in chat).

## Conventions in force (from AGENTS.md / CLAUDE.md)

- Talk to the user in **French**, write **English** in files.
- Header licence notice on every source file (K1 / Franck LEFEVRE / kind robots).
- Everything configurable lives in `config/param.json` + `secret.json`, each
  overridable by an **env var of the same name**, each with a `.example`.
- All logs under `logs/`; errors mirrored to `<program>.err.txt`, emptied at
  startup.
- Version `x.y.z` in `param.json.example`; **bump `z` on every user request**.
- GIT used freely (since 2026-10-11): frequent commits, push. Prefer patches. Update README, history file, `output.txt`,
  `kurt.json` as work proceeds.

## Game chronometry / auto-acceleration

The scoreboard game clock reuses `CountdownTimer(gameMinutes*60s)` and shows the
ELAPSED time (limit − remaining). When `isFinished()` and the pure
`shouldAutoAccelerate(true, totalPts, threshold, accelerated)` returns true, the
app calls `match.activateAcceleration()` — no new engine code. The clock resets
per game (tracked by `gameClockGameIndex`), pauses while a modal timer overlay
is open and when leaving the scoreboard. To test the trigger headlessly, load
the app with `{ gameMinutes: 0 }` so the clock is finished immediately.

## Scoreboard / OBS mode (v0.1.12)

- **Data flow**: app.js `render()` / timer transitions -> `notifyLive()` ->
  studio.js `notify()` builds `{display, match, timer, sheet}` -> live.js
  `LivePublisher.publish()` -> BroadcastChannel `arbatt-live-<ch>` AND (if the
  relay was detected) `POST api/live/<ch>` -> `scoreboard.js` via
  `LiveSubscriber` (BC + EventSource on `api/live/<ch>/events`).
- **Full snapshots, never deltas**: a late/reconnecting overlay is instantly
  right. Dedupe = `pub` (UUID per app load) + `seq`. Overlay animations are
  computed by diffing consecutive snapshots (only increases animate -> undo
  is never celebrated). `matchId` (UUID per match) distinguishes a new match.
- **The match payload shape lives ONLY in `live.js matchSnapshot()`**
  (app + overlay demo). Change it there.
- **Relay detection, not config**: `GET api/live/_info` (404 on static
  hosting). Do NOT put a relay flag in `www/app-config.json`: that file is
  versioned and also served by the static OVH deployment.
- **SSE framing**: `LiveHub.publish` re-serialises JSON compactly, a raw
  newline would break the `data:` line. `wait_newer` uses `!=` on seq so a
  re-created (evicted) channel restarting at 1 is still delivered.
- **Service worker** must bypass `/api/` (cache-first would cache the relay
  and hang on the endless SSE response).
- **jsdom**: no BroadcastChannel -> the harness lends Node's (with `unref()`),
  which lets ONE process host the app window and the overlay window
  (tests/test_live_dom.js). jsdom needs an `http://` URL for localStorage.
- **Visual checks**: headless Chrome is available
  (`google-chrome --headless=new --window-size=1920,1080
  --virtual-time-budget=5000 --screenshot=...`). To trigger banners, serve a
  scratch driver page (iframe the overlay + post states on the BC) with
  `ARBATT_WEBROOT=<scratch dir with symlinks to www/*>` — run server.py from
  the repo dir (config/ is relative; env overrides only keys present in
  param.json). `?demo=1` / `?demo=sheet` animate a fake match.
- **PHP relay (v0.1.13)** `www/api/live.php` = same API as server.py. Keep
  the two interchangeable: `tests/test_live_relay.py` runs ONE suite against
  both (`php -S -t www tests/php_live_router.php`, PHP_CLI_SERVER_WORKERS=4
  for concurrent SSE + POST). PHP specifics: file store + flock, bounded SSE
  (shared hosts kill long scripts) + `retry:` + Last-Event-ID, env read from
  getenv / $_SERVER / `REDIRECT_<name>` (Apache renames SetEnv vars after an
  internal rewrite — confirmed on a real Apache with mod_php).
- **Real Apache test rig** (no root needed): `/usr/sbin/apache2 -f <conf> -k
  start` with Listen 127.0.0.1:8095, mpm_prefork + libphp8.3 + rewrite/env/
  headers/deflate, AllowOverride All, DocumentRoot with a WordPress-like
  root .htaccess and a symlink `arbatt -> <repo>/www`. Stop with `-k stop`.
- **Shell gotcha**: `pkill -f "python3 server.py"` (or any pattern present in
  the current command line) kills the tool's own shell (exit 144). Use
  `timeout N` on background servers instead.
- CSS gotcha: an absolutely positioned box at `left:50%` shrinks to the
  remaining half width -> use `width:max-content` for the banners.

## Client config & offline (v0.1.14)

- `www/app-config.json` has ONE builder: `arbatt_config.build_app_config()`
  driven by `ARBATT_APP_CONFIG_KEYS` (param.json). CLI `--print` / `--write`.
  The file is VERSIONED (static hosting serves it): after any param.json
  change run `python3 arbatt_config.py --write` (test_app_config.py fails
  otherwise).
- Offline proof: `npm run check:offline` (tests/check_offline_chrome.py,
  embedded CDP client, kills server.py then reloads). The SW must match
  cache entries with `ignoreSearch:true` (overlay URLs carry ?ch=/?demo=).
  SW only installs on HTTPS or localhost, not on http://<LAN IP>.
- v0.1.15: app.js has NO default config values. `APP_CONFIG_TYPES` lists
  expected keys + types only; a missing/invalid app-config.json shows the
  red `#config-error` banner and `requireAppConfig()` blocks new match /
  warm-up. New key in ARBATT_APP_CONFIG_KEYS => also declare it in
  APP_CONFIG_TYPES. Harness: `loadApp(null, {configStatus:404})` or
  `{configDrop:['key']}`; stub `win.alert` in jsdom (not implemented there).
- Workflow agreed 2026-10-11: validate everything on the local PC first
  (server.py :8080), deploy to the BATT server only after the user's go.
- Production = https://batt.club/arbatt/ (OVH, Apache+PHP), updated by
  `git pull` on the server (deploy/INSTALL.md option A-bis). Since
  2026-10-11 the agent USES GIT freely (rule changed in AGENTS.md; CLAUDE.md
  is a symlink to it): commit + push to github.com/francklefevre/arBATT,
  then pull on the server over SSH (access provided by the user); then
  verify with curl
  (app-config.json version, scoreboard.html 200, api/live/_info relay:true).
  Server: ssh alias `batt` (battclw@ssh.cluster031.hosting.ovh.net, key
  ~/.ssh/id_ed25519), repo ~/arbatt-src, web ~/www/arbatt -> symlink to
  ~/arbatt-src/www, PHP 7.4, git 2.20. Deploy = `ssh batt 'cd arbatt-src &&
  git pull --ff-only'`. Do not edit files on the server by hand: fix in the
  repo, push, pull.
- OVH has Apache MultiViews ON: it maps api/live/... to live.php before
  mod_rewrite (=> 400, no ?path=). www/api/.htaccess has Options -MultiViews.
- OVH also buffers PHP output until ~4 KB: SSE events need padding
  (ARBATT_LIVE_PHP_PAD_BYTES=4096, arbatt_sse_pad()). Measure with a
  Python urllib reader printing the arrival time of each "id:" line while
  POSTing to the channel in the background.

## Testing the UI headlessly (jsdom)

`tests/test_ui_dom.js` loads the real `www/index.html` in jsdom and drives it.
Two hard-won rules (don't regress them):
- **jsdom fires `DOMContentLoaded` asynchronously.** Eval each script ONCE
  right after `new JSDOM`, then let jsdom's own DCL fire the bootstrap. Do NOT
  `dispatchEvent` a `DOMContentLoaded` yourself — combined with jsdom's natural
  one it runs the bootstrap twice, binding every handler twice (symptom: one
  card tap counts as two points; duplicated `#2007 DOM ready` logs).
- Strip the page's `<script src>` tags and eval the files yourself so they run
  exactly once. Stub `window.fetch` (for `loadAppConfig`) in/after construction.

Run everything with `npm test` (→ `tests/run_all.js`). jsdom is a dev
dependency (`npm install` once); it is NOT needed by the runtime server.

## Useful commands

```bash
# Run all test suites
npm test

# Run server on a custom port
ARBATT_PORT=8099 python3 server.py

# Headless scorer tests
node tests/test_scorer.js

# Quick endpoint / security smoke test (server must be running on 8099)
curl -s -I http://127.0.0.1:8099/manifest.webmanifest
curl -s --path-as-is -o /dev/null -w "%{http_code}\n" \
     "http://127.0.0.1:8099/../../etc/passwd"   # expect 404, nothing leaked

# Regenerate PWA icons (needs Pillow)
python3 - <<'PY'  # see history for the full snippet
PY
```

## Environment notes

- Python 3.12, Pillow 10.2 available locally (used once to render icons).
- `pdftotext` (poppler) available; `pdfinfo` reports 17 pages, A4.
- Node.js 23 available for headless tests.

## Open TODO (roadmap)

Done: doubles, timers, acceleration, cards, game chronometry, scoreboard/OBS
mode + match sheet (v0.1.12).
Done in v0.1.13: PHP relay for static hosting.
Done in v0.1.14: single app-config builder, offline verified in Chrome.
Done in v0.1.15: no default config values in app.js (visible error).
Next / proposed: match persistence in `dynamic/`,
QR-code generation. See README "Feuille de route".
