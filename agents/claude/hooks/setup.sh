#!/bin/bash
# Sonicify: Setup hook wrapper (initial setup)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sonicify-hook.sh" "Setup"
