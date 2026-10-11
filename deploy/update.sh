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
# 2026-10-07 (v0.1.14): delegated to the single builder of arbatt_config.py
# (was an inline copy of the key list, which had drifted from server.py).
if command -v python3 >/dev/null 2>&1; then
  echo "[arBATT] Refreshing www/app-config.json from config/param.json…"
  python3 arbatt_config.py --write www
fi

mkdir -p "$DEST"
echo "[arBATT] Copying www/ -> $DEST"
cp -a www/. "$DEST"/

# 2026-10-06 (v0.1.13): the PHP live relay (www/api/live.php) is copied with
# www/. In a COPY deployment it cannot find config/ next to it, so we point
# it at this repository's config/ (ARBATT_LIVE_TOKEN, relay settings). Done
# after EVERY copy because cp overwrites api/.htaccess (a hand-made SetEnv
# would be lost at the next update).
if [ -f "$DEST/api/.htaccess" ]; then
  printf '\n<IfModule mod_env.c>\n  SetEnv ARBATT_CONFIG_DIR %s/config\n</IfModule>\n' \
    "$(pwd)" >> "$DEST/api/.htaccess"
  echo "[arBATT] Live relay configured with $(pwd)/config"
fi

echo "[arBATT] Done. Deployed version:"
cat "$DEST/app-config.json"; echo
