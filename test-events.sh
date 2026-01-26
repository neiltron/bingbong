#!/bin/bash
#
# Test script that sends simulated events to the Sonicify server
# Useful for testing the audio/visual frontend without Claude Code
#

SERVER_URL="${SONICIFY_URL:-http://localhost:3334}"

# Generate a random session ID
SESSION_ID="test-$(date +%s)-$(head /dev/urandom | tr -dc 'a-z0-9' | head -c 6)"
MACHINE_ID="test-machine"

echo "Sending test events to $SERVER_URL"
echo "Session ID: $SESSION_ID"
echo ""

send_event() {
    local event_type="$1"
    local tool_name="$2"

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")

    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{
            \"event_type\": \"$event_type\",
            \"session_id\": \"$SESSION_ID\",
            \"machine_id\": \"$MACHINE_ID\",
            \"timestamp\": \"$timestamp\",
            \"cwd\": \"/test\",
            \"tool_name\": \"$tool_name\",
            \"tool_input\": {},
            \"tool_output\": {}
        }" \
        "${SERVER_URL}/events" > /dev/null

    echo "Sent: $event_type ${tool_name:+($tool_name)}"
}

# Simulate a Claude Code session
echo "=== Simulating Claude Code session ==="
echo ""

send_event "SessionStart" ""
sleep 0.5

# Simulate some tool usage
tools=("Read" "Read" "Grep" "Glob" "Read" "Edit" "Write" "Bash" "Read" "Task")

for tool in "${tools[@]}"; do
    send_event "PreToolUse" "$tool"
    sleep $(echo "scale=2; 0.2 + ($RANDOM % 30) / 100" | bc)
    send_event "PostToolUse" "$tool"
    sleep $(echo "scale=2; 0.3 + ($RANDOM % 50) / 100" | bc)
done

# Simulate subagent
send_event "PreToolUse" "Task"
sleep 0.3
send_event "PostToolUse" "Task"
sleep 1
send_event "SubagentStop" ""

sleep 0.5

# Session complete
send_event "Stop" ""
sleep 0.3
send_event "SessionEnd" ""

echo ""
echo "=== Test session complete ==="
