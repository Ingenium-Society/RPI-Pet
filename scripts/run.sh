#!/usr/bin/env bash
# Runs ON THE MAC: one command to try the whole chain.
#   1. copies scripts/pi-run.sh to the Pi
#   2. over one SSH connection: forwards a local port to pi-service AND starts
#      llama-server + pi-service on the Pi (via pi-run.sh)
#   3. waits until the Pi answers, then starts the Vite chatbox
# Ctrl-C stops everything, including the processes on the Pi.
#
#   ./scripts/run.sh
#   PI_HOST=edgelm@192.168.22.73 ./scripts/run.sh       # if edgelm.local does not resolve
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PI_HOST="${PI_HOST:-edgelm@edgelm.local}"
LOCAL_PORT="${LOCAL_PORT:-3000}"   # port on the Mac; pi-service listens on 3000 on the Pi
LOG_DIR="logs"                     # git-ignored
PI_LOG="$LOG_DIR/pi.log"

mkdir -p "$LOG_DIR"
[ -d node_modules ] || { echo "run: npm install"; npm install; }

echo "run: copying pi-run.sh to $PI_HOST"
scp -q scripts/pi-run.sh "$PI_HOST:pi-run.sh"

# Hold a pipe open as ssh's stdin. When this script exits (or ssh dies) the pipe closes,
# and pi-run.sh sees EOF and shuts the Pi side down.
FIFO="$(mktemp -u)"
mkfifo "$FIFO"
exec 3<>"$FIFO"
rm -f "$FIFO"

SSH_PID=""
cleanup() {
  trap - EXIT INT TERM HUP
  [ -n "$SSH_PID" ] && kill "$SSH_PID" 2>/dev/null || true
  exec 3>&- 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

echo "run: starting the Pi side (log: $PI_LOG)"
ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=5 \
  -L "${LOCAL_PORT}:127.0.0.1:3000" "$PI_HOST" \
  'WATCH_STDIN=1 bash ~/pi-run.sh' <&3 >"$PI_LOG" 2>&1 &
SSH_PID=$!

echo "run: waiting for the Pi (model load takes a few seconds)"
ready=0
for _ in $(seq 1 150); do
  if ! kill -0 "$SSH_PID" 2>/dev/null; then
    echo "run: the Pi side stopped. Last lines of $PI_LOG:" >&2
    tail -n 20 "$PI_LOG" >&2
    exit 1
  fi
  if curl -fs "http://127.0.0.1:${LOCAL_PORT}/v1/health" 2>/dev/null | grep -q '"llama_configured":true'; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "run: Pi did not come up in time. Last lines of $PI_LOG:" >&2; tail -n 20 "$PI_LOG" >&2; exit 1; }

echo "run: Pi is up. Starting the chatbox, open http://localhost:5173  (Ctrl-C to stop everything)"
PI_URL="http://127.0.0.1:${LOCAL_PORT}" npm run web
