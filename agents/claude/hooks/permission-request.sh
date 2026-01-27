#!/bin/bash
# Bingbong: PermissionRequest hook wrapper (requires user attention!)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/bingbong-hook.sh" "PermissionRequest"
