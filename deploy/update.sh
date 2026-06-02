#!/usr/bin/env bash
#
# arBATT - Table tennis club referee companion (PWA)
#
# Free software developed by Franck LEFEVRE for K1 ( https://k1info.com ),
# with the help of his team of kind and playful robots.
#
# ---------------------------------------------------------------------------
# One-command update of a STATIC arBATT deployment from git.
#
# Use this when the public folder is a COPY of www/ (not a symlink). It pulls
# the latest commit, refreshes www/app-config.json from config/param.json, and
# copies www/ into the destination web folder.
#
#   Usage:  deploy/update.sh <destination-www-dir>
#   Example: deploy/update.sh ~/www/arbatt
#
# If your host follows symlinks, the simpler setup is to symlink the web folder
# to this repo's www/ and just run `git pull` (see deploy/INSTALL.md).
# ---------------------------------------------------------------------------

set -euo pipefail

DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "usage: $0 <destination-www-dir>   (e.g. ~/www/arbatt)" >&2
  exit 2
fi

# Move to the repository root (this script lives in deploy/).
cd "$(dirname "$0")/.."

echo "[arBATT] Pulling latest commit…"
git pull --ff-only

# Refresh the generated client config if Python is available (optional).
if command -v python3 >/dev/null 2>&1; then
  echo "[arBATT] Refreshing www/app-config.json from config/param.json…"
  python3 - <<'PY'
import json, os
cfg = json.load(open("config/param.json"))
out = {
    "version": cfg["version"],
    "warmupSeconds": cfg["ARBATT_WARMUP_SECONDS"],
    "timeoutSeconds": cfg["ARBATT_TIMEOUT_SECONDS"],
    "restSeconds": cfg["ARBATT_REST_SECONDS"],
    "accelReturns": cfg["ARBATT_ACCEL_RETURNS"],
    "gameMinutes": cfg["ARBATT_GAME_MINUTES"],
    "accelPointsThreshold": cfg["ARBATT_ACCEL_POINTS_THRESHOLD"],
}
json.dump(out, open(os.path.join("www", "app-config.json"), "w"))
print("  ->", out["version"])
PY
fi

mkdir -p "$DEST"
echo "[arBATT] Copying www/ -> $DEST"
cp -a www/. "$DEST"/

echo "[arBATT] Done. Deployed version:"
cat "$DEST/app-config.json"; echo
