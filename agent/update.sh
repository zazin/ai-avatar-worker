#!/data/data/com.termux/files/usr/bin/bash
# Update the on-device TikTok agent in place: pull latest code, install deps,
# and restart it. Run from inside Termux:  bash update.sh
#
# Safe to re-run. Your local agent/config.json (gitignored) is never touched.
set -euo pipefail

cd "$(dirname "$0")"

echo "[update] fetching latest code..."
git fetch --quiet origin
# Keep local-only files (config.json) but take upstream for tracked files.
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"

echo "[update] installing dependencies..."
npm install --omit=dev --no-audit --no-fund

# Restart via the shared start/stop scripts (handles pidfile + wake lock).
echo "[update] restarting agent..."
bash stop.sh || true
bash start.sh "$@"
echo "[update] done."
