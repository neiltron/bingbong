#!/usr/bin/env bash
set -euo pipefail

# Local end-to-end release/install test for Bingbong.
#
# What it validates:
# 1) Cross-compiled release tarballs can be produced locally
# 2) checksums.txt is generated and used by installer
# 3) Installer takes prebuilt path (no source fallback)
# 4) Installed binary serves embedded UI assets
#
# Usage:
#   scripts/test-local-release.sh
#
# Optional env vars:
#   BINGBONG_TEST_PORT=8876   # optional; auto-picks a free port when unset
#   BINGBONG_APP_PORT=3399
#   BINGBONG_TEST_WORKDIR=/tmp/bingbong-local-release-test
#   KEEP_BINGBONG_TEST_WORKDIR=1

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${BINGBONG_TEST_PORT:-}"
APP_PORT="${BINGBONG_APP_PORT:-3399}"
WORKDIR="${BINGBONG_TEST_WORKDIR:-/tmp/bingbong-local-release-test-$$}"
RELEASE_DOWNLOAD_DIR="$WORKDIR/releases/latest/download"
INSTALL_DIR="$WORKDIR/install/bin"
INSTALL_SCRIPT_LOCAL="$WORKDIR/install-local.sh"
INSTALL_LOG="$WORKDIR/install.log"
SERVER_LOG="$WORKDIR/release-server.log"
APP_LOG="$WORKDIR/app.log"

SERVER_PID=""
APP_PID=""

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[test-local-release] missing required command: $1" >&2
    exit 1
  }
}

pick_port() {
  if [[ -n "$PORT" ]]; then
    echo "$PORT"
    return
  fi

  local candidate
  for candidate in $(seq 8876 8976); do
    if python3 - "$candidate" <<'PY' >/dev/null 2>&1
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
    then
      echo "$candidate"
      return
    fi
  done

  echo "[test-local-release] unable to find free test port" >&2
  exit 1
}

cleanup() {
  set +e

  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ "${KEEP_BINGBONG_TEST_WORKDIR:-0}" != "1" ]]; then
    rm -rf "$WORKDIR"
  else
    echo "[test-local-release] kept workdir: $WORKDIR"
  fi
}

trap cleanup EXIT

need_cmd bun
need_cmd curl
need_cmd tar
need_cmd python3
need_cmd perl
need_cmd rg
need_cmd shasum

mkdir -p "$RELEASE_DOWNLOAD_DIR"

PORT="$(pick_port)"

echo "[test-local-release] workdir: $WORKDIR"
echo "[test-local-release] building binaries..."

TARGETS=(
  "darwin-x64:bun-darwin-x64"
  "darwin-arm64:bun-darwin-arm64"
  "linux-x64:bun-linux-x64"
)

for entry in "${TARGETS[@]}"; do
  target_name="${entry%%:*}"
  bun_target="${entry##*:}"

  stage_dir="$WORKDIR/stage/$target_name"
  mkdir -p "$stage_dir"

  bun build "$ROOT_DIR/bin/cli.ts" --compile --target="$bun_target" --outfile "$stage_dir/bingbong" >/dev/null
  chmod +x "$stage_dir/bingbong"
  tar -C "$stage_dir" -czf "$RELEASE_DOWNLOAD_DIR/bingbong-$target_name.tar.gz" bingbong
done

(
  cd "$RELEASE_DOWNLOAD_DIR"
  shasum -a 256 bingbong-*.tar.gz > checksums.txt
)

echo "[test-local-release] starting local release server on :$PORT"
(
  cd "$WORKDIR"
  python3 -m http.server "$PORT" >"$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/releases/latest/download/checksums.txt" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -fsS "http://127.0.0.1:$PORT/releases/latest/download/checksums.txt" >/dev/null 2>&1; then
  echo "[test-local-release] FAIL: local release server failed to serve checksums" >&2
  sed -n '1,80p' "$SERVER_LOG" >&2 || true
  exit 1
fi

echo "[test-local-release] patching installer to use local release endpoint"
cp "$ROOT_DIR/scripts/install.sh" "$INSTALL_SCRIPT_LOCAL"
perl -0777 -pe "s#https://github.com/\\$\\{REPO\\}/releases#http://127.0.0.1:${PORT}/releases#g" -i "$INSTALL_SCRIPT_LOCAL"
chmod +x "$INSTALL_SCRIPT_LOCAL"

echo "[test-local-release] running installer (prebuilt path)"
mkdir -p "$INSTALL_DIR"
BINGBONG_INSTALL_DIR="$INSTALL_DIR" "$INSTALL_SCRIPT_LOCAL" >"$INSTALL_LOG" 2>&1

if rg -n "Falling back to source build" "$INSTALL_LOG" >/dev/null; then
  echo "[test-local-release] FAIL: installer fell back to source build" >&2
  sed -n '1,120p' "$INSTALL_LOG" >&2
  exit 1
fi

echo "[test-local-release] smoke test: bingbong --help"
"$INSTALL_DIR/bingbong" --help >/dev/null

echo "[test-local-release] smoke test: serve UI on :$APP_PORT"
"$INSTALL_DIR/bingbong" --port "$APP_PORT" >"$APP_LOG" 2>&1 &
APP_PID=$!
sleep 1

root_html="$WORKDIR/root.html"
status="$(curl -s -o "$root_html" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/")"
if [[ "$status" != "200" ]]; then
  echo "[test-local-release] FAIL: GET / returned $status" >&2
  exit 1
fi

rg -q "Bingbong" "$root_html" || {
  echo "[test-local-release] FAIL: root HTML does not look like Bingbong UI" >&2
  exit 1
}

js_path="$(rg -o 'src="([^"]+\\.js)"' -r '$1' "$root_html" | head -n1 || true)"
css_path="$(rg -o 'href="([^"]+\\.css)"' -r '$1' "$root_html" | head -n1 || true)"

if [[ -n "$js_path" ]]; then
  js_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/$js_path")"
  [[ "$js_status" == "200" ]] || { echo "[test-local-release] FAIL: JS asset $js_path returned $js_status" >&2; exit 1; }
fi

if [[ -n "$css_path" ]]; then
  css_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/$css_path")"
  [[ "$css_status" == "200" ]] || { echo "[test-local-release] FAIL: CSS asset $css_path returned $css_status" >&2; exit 1; }
fi

echo "[test-local-release] PASS"
echo "  - installer used prebuilt artifacts"
echo "  - checksum verification path executed"
echo "  - installed binary served embedded UI assets"
echo "  - install log: $INSTALL_LOG"
