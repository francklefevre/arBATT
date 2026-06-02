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
  `5xxx` doubles. (Acceleration reuses `30xx`/`50xx` in the engines and
  `204x` in the app.)
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
- No GIT commands. Prefer patches. Update README, history file, `output.txt`,
  `kurt.json` as work proceeds.

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

Done: doubles, warm-up/time-out timers, acceleration rule, jsdom UI tests.
Next: cards/penalties, per-game chronometry (manche 10 min + repos, which also
auto-triggers acceleration at 10 min / <18 pts), match persistence in
`dynamic/`, QR-code generation. See README "Feuille de route".
