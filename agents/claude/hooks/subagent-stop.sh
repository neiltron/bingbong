#!/bin/bash
# Bingbong: SubagentStop hook wrapper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/bingbong-hook.sh" "SubagentStop"
