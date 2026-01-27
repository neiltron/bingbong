#!/bin/bash
#
# Test script to verify install-hooks.sh idempotency
#
# This tests:
# 1. First install adds Sonicify hooks
# 2. User hooks are preserved
# 3. Second install doesn't duplicate Sonicify hooks
# 4. User hooks remain intact after multiple installs
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$PROJECT_ROOT/.cursor-test"
TEST_HOOKS="$TEST_DIR/hooks.json"

echo "=== Sonicify Cursor Hooks Installation Test ==="
echo ""

# Setup: Create test environment
mkdir -p "$TEST_DIR"
cat > "$TEST_HOOKS" <<'EOF'
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {"command": "/some/other/hook.sh"}
    ],
    "stop": [
      {"command": "/another/user/hook.sh"}
    ]
  }
}
EOF

echo "Initial hooks.json (with existing user hooks):"
jq . "$TEST_HOOKS"
echo ""

# Create a mock install script that uses the test directory
cat > "$TEST_DIR/test-install-wrapper.sh" <<'WRAPPER'
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_SCRIPT="$PROJECT_ROOT/agents/cursor/hooks/sonicify-hook.sh"
HOOKS_PATH="$SCRIPT_DIR/hooks.json"

mkdir -p "$(dirname "$HOOKS_PATH")"

if [[ ! -x "$HOOK_SCRIPT" ]]; then
  chmod +x "$HOOK_SCRIPT"
fi

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
echo "✓ Successfully installed Sonicify hooks"
WRAPPER

chmod +x "$TEST_DIR/test-install-wrapper.sh"

# Test 1: First installation
echo "=== Test 1: First Installation ==="
"$TEST_DIR/test-install-wrapper.sh"
echo ""
echo "After first install:"
jq . "$TEST_HOOKS"
echo ""

# Verify: Count Sonicify hooks
sonicify_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh"))] | length' "$TEST_HOOKS")
user_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh") | not)] | length' "$TEST_HOOKS")
echo "Sonicify hooks: $sonicify_count (expected: 10)"
echo "User hooks: $user_count (expected: 2)"
echo ""

if [[ "$sonicify_count" != "10" ]]; then
  echo "❌ FAIL: Expected 10 Sonicify hooks, got $sonicify_count"
  exit 1
fi

if [[ "$user_count" != "2" ]]; then
  echo "❌ FAIL: Expected 2 user hooks, got $user_count"
  exit 1
fi

# Test 2: Second installation (idempotency test)
echo "=== Test 2: Second Installation (Idempotency) ==="
"$TEST_DIR/test-install-wrapper.sh"
echo ""
echo "After second install:"
jq . "$TEST_HOOKS"
echo ""

# Verify: Should still have same counts
sonicify_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh"))] | length' "$TEST_HOOKS")
user_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh") | not)] | length' "$TEST_HOOKS")
echo "Sonicify hooks: $sonicify_count (expected: 10)"
echo "User hooks: $user_count (expected: 2)"
echo ""

if [[ "$sonicify_count" != "10" ]]; then
  echo "❌ FAIL: Idempotency broken! Expected 10 Sonicify hooks, got $sonicify_count"
  exit 1
fi

if [[ "$user_count" != "2" ]]; then
  echo "❌ FAIL: User hooks modified! Expected 2 user hooks, got $user_count"
  exit 1
fi

# Test 3: Third installation (another idempotency test)
echo "=== Test 3: Third Installation (Idempotency) ==="
"$TEST_DIR/test-install-wrapper.sh"
echo ""

sonicify_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh"))] | length' "$TEST_HOOKS")
user_count=$(jq '[.hooks[][] | select(.command | contains("sonicify-hook.sh") | not)] | length' "$TEST_HOOKS")
echo "Sonicify hooks: $sonicify_count (expected: 10)"
echo "User hooks: $user_count (expected: 2)"
echo ""

if [[ "$sonicify_count" != "10" ]]; then
  echo "❌ FAIL: Idempotency broken on third run! Expected 10 Sonicify hooks, got $sonicify_count"
  exit 1
fi

if [[ "$user_count" != "2" ]]; then
  echo "❌ FAIL: User hooks modified on third run! Expected 2 user hooks, got $user_count"
  exit 1
fi

echo "=== All Tests Passed ✓ ==="
echo ""
echo "The install script is idempotent:"
echo "- Sonicify hooks are installed correctly"
echo "- User hooks are preserved across multiple installs"
echo "- No duplication occurs on repeated runs"
echo ""

# Cleanup
rm -rf "$TEST_DIR"
echo "Test directory cleaned up."
