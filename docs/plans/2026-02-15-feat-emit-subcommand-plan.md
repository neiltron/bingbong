---
title: "feat: emit subcommand"
type: feat
date: 2026-02-15
revised: 2026-02-15
---

# feat: `bingbong emit` Subcommand

## Overview

Add a `bingbong emit <EventType>` subcommand that reads hook payload JSON from stdin, spreads it into the POST body with `event_type`/`timestamp`/`machine_id` overlaid, and sends it to the bingbong server's `/events` endpoint. Update `install-hooks` to write `bingbong emit X` commands instead of absolute paths to shell scripts.

This eliminates the `jq`/`curl`/`python3` runtime dependencies, makes hook configs portable (no absolute paths), and subsumes the planned `bingbong ping` feature.

## Problem Statement / Motivation

The `install-hooks` command (just shipped in PR #10) writes absolute paths to shell scripts:
```json
{"command": "/Users/neil/projects/bingbong/agents/claude/hooks/pre-tool-use.sh"}
```

These paths break when: the repo moves, the user reinstalls globally, or the user uses `npx`. The shell scripts also depend on `jq` and `curl` at runtime. Pointing hooks to `bingbong emit PreToolUse` solves both problems.

## Acceptance Criteria

- [x] `echo '{"session_id":"abc"}' | bingbong emit PreToolUse` POSTs event to `/events` and exits 0
- [x] `bingbong emit PreToolUse` (no stdin pipe) sends a minimal event and exits 0 (does not hang)
- [x] Always exits 0, even on network errors, malformed JSON, or missing args
- [x] Completely silent — no stdout, no stderr in any case
- [x] Honors `BINGBONG_ENABLED=false` (exits immediately)
- [x] HTTP POST has a 2-second timeout via `AbortSignal.timeout(2000)`
- [x] `install-hooks claude` writes `bingbong emit PreToolUse` (or `npx -y bingbong emit PreToolUse` if not globally installed)
- [x] `install-hooks cursor` writes `bingbong emit beforeShellExecution` (Cursor-native event names, no mapping)
- [x] install-hooks strips both old-format (shell script paths) and new-format (`bingbong emit`) entries for idempotency
- [x] `bingbong --help` shows `emit` subcommand

## Technical Approach

### Architecture: Three File Changes

1. **New file: `src/emit.ts`** — the emit subcommand (~40 lines)
2. **Edit: `src/install-hooks.ts`** — update Claude and Cursor installers to write `bingbong emit` commands, update detection patterns, remove `script`/`verifyScriptExists`
3. **Edit: `bin/cli.ts`** — add `emit` subcommand routing (with try/catch), update help text

### `src/emit.ts` — The Emit Subcommand

```typescript
import os from "node:os";

export async function emit(argv: string[]): Promise<void> {
  const enabled = (process.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const eventType = argv[0];
  if (!eventType) return;

  const url = process.env.BINGBONG_URL || "http://localhost:3334";

  // Read stdin: if TTY (no pipe), use {}. Otherwise read with Bun.stdin.text()
  let input: Record<string, unknown> = {};
  if (!process.stdin.isTTY) {
    try {
      const raw = await Bun.stdin.text();
      if (raw.trim()) input = JSON.parse(raw);
    } catch {}
  }

  // Spread stdin payload, overlay our fields
  const payload = {
    ...input,
    event_type: eventType,
    machine_id: process.env.BINGBONG_MACHINE_ID || os.hostname(),
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}
```

**Key design choices:**

- **Spread stdin JSON, don't normalize fields.** The server accepts any JSON. By spreading the entire stdin payload and overlaying `event_type`/`timestamp`/`machine_id`, we preserve all agent-specific fields (including Cursor's full payload as `tool_input`). No data loss, no fallback chains.
- **`Bun.stdin.text()`** — the Bun-native API for reading stdin. Simple, no streams.
- **TTY check only** — no timeout, no size cap. If stdin is piped, it's coming from an agent that will close the pipe promptly. Agents don't leave pipes open.
- **`AbortSignal.timeout(2000)`** — cleaner than manual AbortController. 2s matches current curl behavior.
- **No stdout, no stderr** — agents may parse stdout; stderr may surface to users.

### `src/install-hooks.ts` — Updated Installers

**Detect if bingbong is globally installed:**

```typescript
function getBingbongCommand(): string {
  try {
    const result = Bun.spawnSync(["which", "bingbong"]);
    if (result.exitCode === 0 && result.stdout.toString().trim()) {
      return "bingbong";
    }
  } catch {}
  return "npx -y bingbong";
}
```

Simple `which` check — no `_npx` path heuristics.

**Claude installer changes:**
- Write `command: "${bingbongCmd} emit ${eventName}"` instead of `command: scriptPath`
- Remove `script` field from `CLAUDE_EVENTS` — no longer needed
- Remove `verifyScriptExists` calls for Claude events
- `AGENTS_DIR` is still needed for OpenCode/Pi installers

**Cursor installer changes:**
- Write `command: "${bingbongCmd} emit ${event}"` instead of `command: "${hookScript} ${event}"`
- Pass Cursor-native event names as-is (e.g., `beforeShellExecution`)

**Detection pattern updates:**
- Claude: match commands containing `/agents/claude/hooks/` OR `bingbong emit`
- Cursor: match commands containing `bingbong-hook.sh` OR `bingbong emit`

### `bin/cli.ts` — Subcommand Routing

Add alongside the existing `install-hooks` check, **wrapped in try/catch for guaranteed silence**:

```typescript
if (firstArg === "emit") {
  try {
    const { emit } = await import("../src/emit");
    await emit(process.argv.slice(3));
  } catch {}
  process.exit(0);
}
```

Update help text to include `emit`.

### What Stays, What Goes

| Component | Status |
|---|---|
| `agents/claude/hooks/*.sh` | **Keep as-is** — no changes, no deprecation comments |
| `agents/cursor/hooks/bingbong-hook.sh` | **Keep as-is** |
| `agents/opencode/plugins/bingbong.js` | **Unchanged** — in-process plugin, not affected |
| `agents/pi/extensions/bingbong.ts` | **Unchanged** — in-process extension, not affected |

## File Changes Summary

| File | Action | Description |
|---|---|---|
| `src/emit.ts` | Create | Emit subcommand (~40 lines) |
| `src/install-hooks.ts` | Edit | Update Claude/Cursor to write `bingbong emit`, remove `script`/`verifyScriptExists`, update detection patterns |
| `bin/cli.ts` | Edit | Add `emit` routing (with try/catch), update help |

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Stdin handling | TTY check only | Agents close pipes promptly; no timeout or size cap needed |
| Payload construction | Spread stdin + overlay 3 fields | Preserves all agent-specific fields, no data loss, no normalization |
| HTTP POST | Await with `AbortSignal.timeout(2000)` | Ensures POST fires before exit; matches current curl behavior |
| Output | Complete silence (no stdout, no stderr) | Agents may parse stdout; stderr may surface to users |
| CLI routing | try/catch wrapper around emit | Guarantees silence even if import or emit throws |
| BINGBONG_ENABLED | Honored (exit 0 if false) | Matches existing shell script behavior |
| Event type validation | None — accept any string | Server accepts any event_type; simpler, future-proof |
| Cursor event names | Pass as-is, no mapping | Server already accepts Cursor-native names |
| PATH detection | Simple `which` (no heuristics) | `_npx` path rejection is too clever and will rot |
| npx fallback | `npx -y bingbong` | `-y` skips the "install?" prompt |
| Old shell scripts | Keep as-is, no changes | No deprecation comments — either delete later or leave alone |
| Missing event type arg | Exit 0 silently | No usage text — hook stdout could confuse agents |
| Bun stdin API | `Bun.stdin.text()` | Native Bun API, simpler than Node streams |

## Out of Scope

- `--json` flag for argument-based payload (defer — stdin is sufficient)
- Removing old shell scripts (follow-up PR)
- Event type mapping for Cursor (server accepts any string)
- Retry on transient failures (events are non-critical telemetry)
- `bingbong ping` as a separate command (subsumed by `echo '{}' | bingbong emit Ping`)

## Open Questions to Verify Before Implementation

1. **Does Claude Code support multi-word `command` strings?** If `"command": "bingbong emit PreToolUse"` is passed as a shell command, it works. If Claude Code expects a path to a single executable, we'd need a thin wrapper. This should be tested manually.

## References

- Brainstorm: `docs/brainstorms/2026-02-15-emit-subcommand-brainstorm.md`
- install-hooks PR: #10
- Ping plan (subsumed): `docs/plans/2026-02-01-feat-cli-ping-event-source-plan.md`
- Server events endpoint: `src/server.ts:172-193`
- Current CLI: `bin/cli.ts`
- Current install-hooks: `src/install-hooks.ts`
