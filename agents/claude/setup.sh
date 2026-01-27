#!/bin/bash
#
# Bingbong Setup Script
# Installs hooks and configures Claude Code for audio monitoring
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/hooks"
CLAUDE_DIR="$HOME/.claude"

echo "╔═══════════════════════════════════════════════════╗"
echo "║          🎵 Bingbong Setup Script 🎵              ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# Create .claude directory if it doesn't exist
mkdir -p "$CLAUDE_DIR"

# Check if settings.json exists
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS_FILE" ]; then
    echo "Found existing settings at: $SETTINGS_FILE"
    echo "Please manually add the hooks configuration."
    echo ""
    echo "Add the following to your settings.json 'hooks' section:"
else
    echo "Creating new settings file at: $SETTINGS_FILE"
fi

# Generate the hooks configuration
cat << EOF

{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/pre-tool-use.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/post-tool-use.sh"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/session-end.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/stop.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOKS_DIR/subagent-stop.sh"
          }
        ]
      }
    ]
  }
}

EOF

echo ""
echo "═══════════════════════════════════════════════════"
echo "Quick Start:"
echo "═══════════════════════════════════════════════════"
echo ""
echo "1. Start the Bingbong server:"
echo "   cd $SCRIPT_DIR/server && bun run start"
echo ""
echo "2. Open the client in your browser:"
echo "   open $SCRIPT_DIR/client/index.html"
echo "   (or start a local server: cd $SCRIPT_DIR/client && python3 -m http.server 8080)"
echo ""
echo "3. Click 'Connect' in the client"
echo ""
echo "4. Start a Claude Code session and watch/listen!"
echo ""
