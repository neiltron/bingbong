#!/bin/bash
#
# Bingbong Hook for Claude Code
#
# This script is called by Claude Code hooks and emits events
# to the Bingbong backend for audio rendering.
#
# Usage: Called automatically by Claude Code via hook configuration
#
# Environment:
#   BINGBONG_URL     - Backend server URL (default: http://localhost:3333)
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

# Extract event type from first argument (passed by wrapper scripts)
EVENT_TYPE="${1:-unknown}"

# Extract common fields from input
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# For tool hooks, extract additional info
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
TOOL_OUTPUT=$(echo "$INPUT" | jq -c '.tool_output // {}')

# Build the event payload
# Generate ISO 8601 timestamp with milliseconds (portable across macOS and Linux)
if date --version >/dev/null 2>&1; then
    # GNU date (Linux) - supports nanoseconds
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
else
    # BSD date (macOS) - use Python for milliseconds
    TIMESTAMP=$(python3 -c "from datetime import datetime; print(datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z')" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
fi
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
# Use timeout to prevent hanging if server is down
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$EVENT_PAYLOAD" \
    --max-time 2 \
    "${BINGBONG_URL}/events" \
    > /dev/null 2>&1 &

# Always exit successfully to not block Claude Code
exit 0
