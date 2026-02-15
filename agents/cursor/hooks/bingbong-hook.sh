#!/bin/bash
#
# Bingbong Hook for Cursor IDE
#
# This script is called by Cursor hooks and emits events
# to the Bingbong backend for audio rendering.
#
# Usage: Called automatically by Cursor via hooks.json
#
# Environment:
#   BINGBONG_URL     - Backend server URL (default: http://localhost:3334)
#   BINGBONG_ENABLED - Set to "false" to disable (default: true)
#

set -euo pipefail

# Configuration
BINGBONG_URL="${BINGBONG_URL:-http://localhost:3334}"
BINGBONG_ENABLED="${BINGBONG_ENABLED:-true}"

# Exit early if disabled
if [[ "$BINGBONG_ENABLED" == "false" ]]; then
  exit 0
fi

# Read the hook input from stdin
INPUT=$(cat)

# Extract event type from first argument, fallback to hook payload
EVENT_TYPE="${1:-}"
if [[ -z "$EVENT_TYPE" || "$EVENT_TYPE" == "unknown" ]]; then
  EVENT_TYPE=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')
fi

# Extract common fields from input
SESSION_ID=$(echo "$INPUT" | jq -r '.conversation_id // .generation_id // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // (.workspace_roots[0] // "")')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Preserve all input fields for downstream processing
TOOL_INPUT=$(echo "$INPUT" | jq -c '. // {}')
TOOL_OUTPUT="{}"

# Build the event payload
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
HOSTNAME=$(hostname)
MACHINE_ID="${BINGBONG_MACHINE_ID:-$HOSTNAME}"

EVENT_PAYLOAD=$(jq -n \
  --arg event_type "$EVENT_TYPE" \
  --arg session_id "$SESSION_ID" \
  --arg machine_id "$MACHINE_ID" \
  --arg timestamp "$TIMESTAMP" \
  --arg cwd "$CWD" \
  --arg tool_name "$TOOL_NAME" \
  --argjson tool_input "$TOOL_INPUT" \
  --argjson tool_output "$TOOL_OUTPUT" \
  '{
      event_type: $event_type,
      session_id: $session_id,
      machine_id: $machine_id,
      timestamp: $timestamp,
      cwd: $cwd,
      tool_name: $tool_name,
      tool_input: $tool_input,
      tool_output: $tool_output
  }')

# Send event to backend (fire and forget, non-blocking)
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$EVENT_PAYLOAD" \
  --max-time 2 \
  "${BINGBONG_URL}/events" \
  > /dev/null 2>&1 &

# Always exit successfully to not block Cursor
exit 0
