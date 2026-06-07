#!/data/data/com.termux/files/usr/bin/bash
# Stop the background TikTok agent started by start.sh.
#
#   bash stop.sh
set -euo pipefail

cd "$(dirname "$0")"

PIDFILE="$HOME/.tiktok-agent.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "[stop] no pidfile ($PIDFILE) — agent not running (or wasn't started via start.sh)."
  # Release any stray wake lock just in case.
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null || true
  exit 0
fi

PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "[stop] stopping agent (pid $PID)..."
  kill "$PID" 2>/dev/null || true
  # Give it a moment to exit, then force-kill if still alive.
  for _ in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "[stop] still alive, force-killing..."
    kill -9 "$PID" 2>/dev/null || true
  fi
  echo "[stop] stopped."
else
  echo "[stop] pid $PID not running (stale pidfile)."
fi

rm -f "$PIDFILE"

# Release the wake lock now that the agent is down.
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null || true
echo "[stop] done."
