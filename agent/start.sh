#!/data/data/com.termux/files/usr/bin/bash
# Start the TikTok agent in the BACKGROUND (detached) in Termux.
#
#   bash start.sh              # run live (auto-post)
#   bash start.sh --dry-run    # rehearse, stop before the final Post tap
#   bash start.sh --catch-up   # ack the backlog without posting
#
# Extra args are passed through to agent.js. Tracked via a pidfile so stop.sh
# can find it. Logs go to ~/tiktok-agent.log.  Use:  bash stop.sh  to stop it.
set -euo pipefail

cd "$(dirname "$0")"

PIDFILE="$HOME/.tiktok-agent.pid"
LOGFILE="$HOME/tiktok-agent.log"

# Already running? Don't start a second copy.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[start] already running (pid $(cat "$PIDFILE")). Use: bash stop.sh"
  exit 0
fi

# Keep the CPU awake so Android doesn't suspend the agent when the screen is off.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true

# Ensure the on-device adb loopback is up (needed for taps / uiautomator).
command -v adb >/dev/null 2>&1 && { adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true; }

echo "[start] launching agent ${*:-(live)} in background..."
nohup node agent.js "$@" >"$LOGFILE" 2>&1 &
echo $! >"$PIDFILE"
sleep 1
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[start] running as pid $(cat "$PIDFILE"). Logs: $LOGFILE"
  echo "[start] follow logs:  tail -f $LOGFILE"
else
  echo "[start] FAILED to start — check $LOGFILE"
  exit 1
fi
