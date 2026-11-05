#!/usr/bin/env bash
# Cross-compile pi-service for Raspberry Pi OS 64-bit (Debian trixie, glibc 2.41).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

command -v cargo-zigbuild >/dev/null 2>&1 || {
  echo "Need zig + cargo-zigbuild:  brew install zig && cargo install cargo-zigbuild" >&2
  exit 1
}

TARGET="aarch64-unknown-linux-gnu"
GLIBC="${GLIBC:-2.41}"   # match the Pi's glibc: ldd --version

cargo zigbuild --release -p pi-service --target "${TARGET}.${GLIBC}"

OUT="target/${TARGET}/release/pi-service"
ls -lh "$OUT"
echo
echo "Deploy:  scp $OUT edgelm@edgelm.local:~/"
