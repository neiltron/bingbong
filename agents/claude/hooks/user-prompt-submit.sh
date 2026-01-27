#!/bin/bash
# Sonicify: UserPromptSubmit hook wrapper (user submits prompt)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/sonicify-hook.sh" "UserPromptSubmit"
