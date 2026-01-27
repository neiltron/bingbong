#!/bin/bash
# Install Sonicify extension for pi-coding-agent (global).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_FILE="$SCRIPT_DIR/extensions/sonicify.ts"

PI_EXTENSIONS_DIR_DEFAULT="$HOME/.pi/agent/extensions"
PI_EXTENSIONS_DIR="${PI_EXTENSIONS_DIR:-$PI_EXTENSIONS_DIR_DEFAULT}"

SONICIFY_HOST="${SONICIFY_HOST:-localhost}"
SONICIFY_PORT="${SONICIFY_PORT:-3333}"
SONICIFY_URL_DEFAULT="http://${SONICIFY_HOST}:${SONICIFY_PORT}"
SONICIFY_URL="${SONICIFY_URL:-$SONICIFY_URL_DEFAULT}"

TARGET_FILE="$PI_EXTENSIONS_DIR/sonicify.ts"

mkdir -p "$PI_EXTENSIONS_DIR"

python3 - <<PY
from pathlib import Path
src = Path("$SRC_FILE").read_text()
content = src.replace("__SONICIFY_URL__", "$SONICIFY_URL")
Path("$TARGET_FILE").write_text(content)
PY

chmod 644 "$TARGET_FILE"

echo "Installed Sonicify extension to: $TARGET_FILE"
