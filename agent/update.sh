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

# Restart: kill the previous run (tracked via pidfile) and relaunch detached.
PIDFILE="$HOME/.tiktok-agent.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[update] stopping previous agent (pid $(cat "$PIDFILE"))..."
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 2
fi

echo "[update] starting agent..."
nohup node agent.js >"$HOME/tiktok-agent.log" 2>&1 &
echo $! >"$PIDFILE"
echo "[update] done. running as pid $(cat "$PIDFILE"); logs: ~/tiktok-agent.log"
