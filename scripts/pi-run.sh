#!/usr/bin/env bash
# Runs ON THE PI: starts llama-server, then pi-service, and stops both on exit.
# Normally started for you by scripts/run.sh on the Mac, but works standalone too:
#   ~/pi-run.sh
# Override any of these with environment variables, e.g.  THREADS=3 ~/pi-run.sh
set -euo pipefail

LLAMA_BIN="${LLAMA_BIN:-$HOME/llama/llama-server}"
MODEL="${MODEL:-$HOME/models/gemma-3-270m-it-qat-Q4_0.gguf}"
LLAMA_PORT="${LLAMA_PORT:-8081}"
CTX="${CTX:-512}"
THREADS="${THREADS:-4}"
SERVICE="${SERVICE:-$HOME/pi-service}"
# Loopback by default (reached through the Mac's SSH tunnel). Once the USB link exists,
# use BIND=192.168.7.1:3000 instead.
BIND="${BIND:-127.0.0.1:3000}"
LLAMA_LOG="${LLAMA_LOG:-$HOME/pet-llama.log}"
# Set by run.sh: stop everything when our stdin closes (i.e. the SSH session ended).
WATCH_STDIN="${WATCH_STDIN:-0}"

die() { echo "pi-run: $*" >&2; exit 1; }

for f in "$LLAMA_BIN" "$SERVICE"; do
  [ -x "$f" ] || die "not found or not executable: $f  (chmod +x it, or set LLAMA_BIN / SERVICE)"
done
[ -f "$MODEL" ] || die "model not found: $MODEL  (set MODEL=...)"
command -v curl >/dev/null || die "curl is required (sudo apt install curl)"

LLAMA_PID=""
SERVICE_PID=""
WATCH_PID=""
cleanup() {
  trap - EXIT INT TERM HUP
  for pid in "$SERVICE_PID" "$LLAMA_PID" "$WATCH_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

llama_ready() { curl -fs "http://127.0.0.1:${LLAMA_PORT}/health" >/dev/null 2>&1; }

if llama_ready; then
  echo "pi-run: llama-server already running on :${LLAMA_PORT}, reusing it"
else
  echo "pi-run: starting llama-server (log: $LLAMA_LOG)"
  "$LLAMA_BIN" -m "$MODEL" --host 127.0.0.1 --port "$LLAMA_PORT" -c "$CTX" -t "$THREADS" \
    >"$LLAMA_LOG" 2>&1 &
  LLAMA_PID=$!
  for _ in $(seq 1 120); do
    llama_ready && break
    kill -0 "$LLAMA_PID" 2>/dev/null || { tail -n 15 "$LLAMA_LOG" >&2; die "llama-server exited"; }
    sleep 1
  done
  llama_ready || die "llama-server did not become ready in 120s (see $LLAMA_LOG)"
  echo "pi-run: llama-server ready"
fi

echo "pi-run: starting pi-service on $BIND"
LLAMA_URL="http://127.0.0.1:${LLAMA_PORT}" BIND="$BIND" "$SERVICE" &
SERVICE_PID=$!

if [ "$WATCH_STDIN" = "1" ]; then
  # Without a tty, sshd does not stop our children when the connection drops.
  # Stdin reaches EOF in that case, so use it as the signal to shut down.
  # (A background command's stdin is /dev/null in a script, so dup the real one first.)
  exec 4<&0
  ( cat <&4 >/dev/null; kill -TERM $$ 2>/dev/null ) &
  WATCH_PID=$!
fi

# Exit as soon as either process dies (cleanup then stops the other one).
wait -n "$SERVICE_PID" ${LLAMA_PID:+"$LLAMA_PID"} || true
echo "pi-run: a process exited, shutting down" >&2
