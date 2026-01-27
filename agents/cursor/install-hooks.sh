#!/bin/bash
#
# Install Sonicify Cursor hooks into hooks.json without removing existing entries.
# Idempotent: Can be run multiple times - removes old Sonicify hooks before adding new ones.
#
# Usage:
#   ./agents/cursor/install-hooks.sh        # project-level .cursor/hooks.json
#   ./agents/cursor/install-hooks.sh --global  # user-level ~/.cursor/hooks.json
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/sonicify-hook.sh"

TARGET_SCOPE="project"
HOOKS_PATH="$PROJECT_ROOT/.cursor/hooks.json"

if [[ "${1:-}" == "--global" ]]; then
  TARGET_SCOPE="global"
  HOOKS_PATH="$HOME/.cursor/hooks.json"
fi

mkdir -p "$(dirname "$HOOKS_PATH")"

if [[ ! -f "$HOOKS_PATH" ]]; then
  cat > "$HOOKS_PATH" <<'JSON'
{
  "version": 1,
  "hooks": {}
}
JSON
fi

if [[ ! -x "$HOOK_SCRIPT" ]]; then
  chmod +x "$HOOK_SCRIPT"
fi

# All Cursor events we want to hook
EVENTS=(
  "beforeShellExecution"
  "afterShellExecution"
  "beforeMCPExecution"
  "afterMCPExecution"
  "beforeReadFile"
  "afterFileEdit"
  "beforeSubmitPrompt"
  "afterAgentResponse"
  "afterAgentThought"
  "stop"
)

tmpfile="$(mktemp)"
cp "$HOOKS_PATH" "$tmpfile"

# Step 1: Remove ALL existing Sonicify hooks from all events
# This ensures clean state before adding new ones (handles path changes, updates, etc.)
echo "Removing any existing Sonicify hooks..."
jq '
  .version = (.version // 1) |
  .hooks = (.hooks // {}) |
  .hooks = (.hooks |
    with_entries(
      .value = [.value[]? | select(.command | contains("sonicify-hook.sh") | not)]
    )
  )
' "$tmpfile" > "${tmpfile}.cleaned"
mv "${tmpfile}.cleaned" "$tmpfile"

# Step 2: Add our hooks to the specified events
echo "Installing Sonicify hooks for ${#EVENTS[@]} events..."
for event in "${EVENTS[@]}"; do
  command="$HOOK_SCRIPT $event"
  jq \
    --arg event "$event" \
    --arg command "$command" \
    '
      .hooks[$event] = (.hooks[$event] // []) |
      .hooks[$event] += [{"command": $command}]
    ' "$tmpfile" > "${tmpfile}.next"
  mv "${tmpfile}.next" "$tmpfile"
done

mv "$tmpfile" "$HOOKS_PATH"

echo ""
echo "✓ Successfully installed Sonicify hooks into ${TARGET_SCOPE} hooks file:"
echo "  $HOOKS_PATH"
echo ""
echo "Events hooked: ${EVENTS[*]}"
echo ""
echo "To verify, run: jq '.hooks' $HOOKS_PATH"
