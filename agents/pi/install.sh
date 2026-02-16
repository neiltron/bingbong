#!/bin/bash
# Install Bingbong extension for pi-coding-agent (global).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_FILE="$SCRIPT_DIR/extensions/bingbong.ts"

PI_EXTENSIONS_DIR_DEFAULT="$HOME/.pi/agent/extensions"
PI_EXTENSIONS_DIR="${PI_EXTENSIONS_DIR:-$PI_EXTENSIONS_DIR_DEFAULT}"

BINGBONG_HOST="${BINGBONG_HOST:-localhost}"
BINGBONG_PORT="${BINGBONG_PORT:-3334}"
BINGBONG_URL_DEFAULT="http://${BINGBONG_HOST}:${BINGBONG_PORT}"
BINGBONG_URL="${BINGBONG_URL:-$BINGBONG_URL_DEFAULT}"

TARGET_FILE="$PI_EXTENSIONS_DIR/bingbong.ts"

mkdir -p "$PI_EXTENSIONS_DIR"

python3 - <<PY
from pathlib import Path
src = Path("$SRC_FILE").read_text()
content = src.replace("__BINGBONG_URL__", "$BINGBONG_URL")
Path("$TARGET_FILE").write_text(content)
PY

chmod 644 "$TARGET_FILE"

echo "Installed Bingbong extension to: $TARGET_FILE"
