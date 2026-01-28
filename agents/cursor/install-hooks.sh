#!/bin/bash
#
# Install Bingbong Cursor hooks globally.
# Idempotent: Can be run multiple times - removes old Bingbong hooks before adding new ones.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/bingbong-hook.sh"
HOOKS_PATH="$HOME/.cursor/hooks.json"

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

# Step 1: Remove ALL existing Bingbong hooks from all events
# This ensures clean state before adding new ones (handles path changes, updates, etc.)
echo "Removing any existing Bingbong hooks..."
jq '
  .version = (.version // 1) |
  .hooks = (.hooks // {}) |
  .hooks = (.hooks |
    with_entries(
      .value = [.value[]? | select(.command | contains("bingbong-hook.sh") | not)]
    )
  )
' "$tmpfile" > "${tmpfile}.cleaned"
mv "${tmpfile}.cleaned" "$tmpfile"

# Step 2: Add our hooks to the specified events
echo "Installing Bingbong hooks for ${#EVENTS[@]} events..."
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
echo "✓ Successfully installed Bingbong hooks globally:"
echo "  $HOOKS_PATH"
echo ""
echo "Events hooked: ${EVENTS[*]}"
echo ""
echo "To verify, run: jq '.hooks' $HOOKS_PATH"
