#!/data/data/com.termux/files/usr/bin/bash
# Run the on-device TikTok agent in Termux.
#
#   bash run.sh                # run live (auto-post), foreground (Ctrl-C to stop)
#   bash run.sh --dry-run      # rehearse the flow, stop before the final Post tap
#   bash run.sh --catch-up     # ack the existing backlog without posting
#   bash run.sh --once         # process one message then exit
#
# Any extra args are passed straight through to agent.js.
set -euo pipefail

cd "$(dirname "$0")"

# Keep the CPU awake so Android doesn't suspend the agent when the screen is off.
# (Acquires a partial wake lock; released automatically when this script exits.)
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  trap 'termux-wake-unlock 2>/dev/null || true' EXIT
fi

# Make sure the on-device adb loopback is up (needed for taps / uiautomator).
# Harmless if already connected. tcpip resets on reboot — re-enable from USB if so.
if command -v adb >/dev/null 2>&1; then
  adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
fi

echo "[run] starting agent ${*:-(live)}"
exec node agent.js "$@"
