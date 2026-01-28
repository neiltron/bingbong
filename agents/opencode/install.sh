#!/bin/bash
#
# Install Bingbong OpenCode plugin globally
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_FILE="$SCRIPT_DIR/plugins/bingbong.js"
TARGET_DIR="$HOME/.config/opencode/plugins"

echo "Installing Bingbong plugin to OpenCode..."

mkdir -p "$TARGET_DIR"
cp "$PLUGIN_FILE" "$TARGET_DIR/bingbong.js"

echo "✓ Plugin installed to: $TARGET_DIR/bingbong.js"
echo ""
echo "Configuration (optional):"
echo "  export BINGBONG_URL=http://localhost:3334"
echo "  export BINGBONG_ENABLED=true"
echo "  export BINGBONG_MACHINE_ID=my-machine"
