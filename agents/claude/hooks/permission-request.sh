#!/bin/bash
# Sonicify: PermissionRequest hook wrapper (requires user attention!)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sonicify-hook.sh" "PermissionRequest"
