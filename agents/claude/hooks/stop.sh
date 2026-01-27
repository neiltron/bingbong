#!/bin/bash
# Bingbong: Stop hook wrapper (main agent completion)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/bingbong-hook.sh" "Stop"
