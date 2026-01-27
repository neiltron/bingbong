#!/bin/bash
# Sonicify: Notification hook wrapper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sonicify-hook.sh" "Notification"
