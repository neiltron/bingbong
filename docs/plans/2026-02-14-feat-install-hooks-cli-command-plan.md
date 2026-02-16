---
title: "feat: install-hooks CLI command"
type: feat
date: 2026-02-14
revised: 2026-02-15
---

# feat: `bingbong install-hooks` CLI Command

## Overview

Add a `bingbong install-hooks <agent>` subcommand that programmatically installs bingbong hooks into supported coding agents. Replaces the current per-agent shell scripts with native TypeScript installers that run on Bun, providing consistent UX, idempotent installs, and zero external dependencies (no jq, no python3).

## Problem Statement / Motivation

Currently each agent has its own standalone installer script with inconsistent UX:
- **Claude Code**: Prints JSON to stdout and asks the user to manually paste it into `~/.claude/settings.json` — the worst experience
- **Cursor**: Fully automated shell script, but depends on `jq`
- **OpenCode**: Simple file copy, but requires user to find and run the script
- **Pi**: Requires `python3` for template substitution

Users must navigate to the `agents/` directory and run the correct script. A unified `bingbong install-hooks cursor` command is more discoverable and reliable.

## Proposed Solution

```
bingbong install-hooks <agent>    # Install hooks for a specific agent
bingbong install-hooks            # Print usage with available agents
```

Available agents: `claude`, `cursor`, `opencode`, `pi`

## Acceptance Criteria

- [x] `bingbong install-hooks claude` merges hooks into `~/.claude/settings.json` programmatically
- [x] `bingbong install-hooks cursor` merges hooks into `~/.cursor/hooks.json` programmatically
- [x] `bingbong install-hooks opencode` copies plugin to `~/.config/opencode/plugins/`
- [x] `bingbong install-hooks pi` substitutes URL template and copies to `~/.pi/agent/extensions/`
- [x] Running with no agent prints usage listing available agents and their config paths
- [x] All installers are idempotent — remove old bingbong hooks before adding new ones
- [x] Existing user hooks/settings are preserved during merge (all non-hooks keys untouched)
- [x] Invalid agent name prints error with list of valid agents
- [x] `bingbong --help` updated to mention `install-hooks` subcommand
- [x] `agents/` added to `package.json` `files` array for npm publishing

## Technical Approach

### Architecture: One New File

All install logic lives in a single file: `src/install-hooks.ts`. Four functions, one lookup map, ~200 lines.

```
bin/cli.ts                    # Add 5-line subcommand check + update help text
src/install-hooks.ts          # Command handler + all 4 agent installers
```

No interface file. No installer directory. No abstractions. Four agents are known at compile time.

### Subcommand Detection in `bin/cli.ts`

Insert before `parseArgs()` at the top of `main()`:

```typescript
const firstArg = process.argv[2];
if (firstArg === "install-hooks") {
  const { installHooks } = await import("../src/install-hooks");
  await installHooks(process.argv.slice(3));
  process.exit(0);
}
```

Update `printHelp()` to add:
```
Commands:
  install-hooks <agent>  Install bingbong hooks for a coding agent
```

### No-Argument Behavior

Print static usage text (no interactive picker — eliminates stdin, TTY detection, and a class of edge cases):

```
Usage: bingbong install-hooks <agent>

Available agents:
  claude     Claude Code (~/.claude/settings.json)
  cursor     Cursor (~/.cursor/hooks.json)
  opencode   OpenCode (~/.config/opencode/plugins/)
  pi         Pi (~/.pi/agent/extensions/)

Example: bingbong install-hooks cursor
```

### Path Resolution

Resolve `agents/` directory relative to the source file via `import.meta.dir`. Works for both source checkout and global npm install (since npm preserves directory structure and Bun follows symlinks to real paths).

```typescript
const ROOT_DIR = path.resolve(import.meta.dir, "..");
const AGENTS_DIR = path.join(ROOT_DIR, "agents");
```

Validate that `AGENTS_DIR` exists at runtime — if not (e.g., bundled build), print a clear error and exit.

### Agent Installers

#### Shared Patterns

For JSON merge installers (Claude, Cursor):
1. Resolve config path using `os.homedir()`
2. Create parent directories if needed
3. Read existing file — treat missing or empty files as default (`{}` or `{version:1, hooks:{}}`)
4. Parse JSON — if invalid, print the `SyntaxError` message with file path and bail (do not modify)
5. Strip old bingbong entries using a specific discriminator (not bare `"bingbong"` substring)
6. Append fresh bingbong entries
7. Preserve all non-hooks keys untouched (`{ ...existing, hooks: merged }`)
8. Write with `JSON.stringify(result, null, 2)` + trailing newline
9. Atomic write: temp file **in the same directory** as target (avoids EXDEV on cross-filesystem rename), then `fs.rename`
10. Validate output by parsing before writing (catch merge bugs)
11. Verify referenced hook scripts exist on disk

#### Claude Code (`installClaude`)

**Config**: `~/.claude/settings.json`

**Bingbong detection**: Filter entries where nested `command` contains `/agents/claude/hooks/` (specific path, not bare "bingbong")

**Events** (11): `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `PermissionRequest`, `Notification`, `PreCompact`, `Setup`, `UserPromptSubmit`

**Format**: Each event gets an entry with `matcher` (".*" for tool-use events, "" for others) and nested hooks array with `{ type: "command", command: "<abs-path>" }`

**Note**: `agents/claude/setup.sh` (old installer) and `agents/claude/hooks/setup.sh` (Setup event hook) are different files — don't confuse them.

#### Cursor (`installCursor`)

**Config**: `~/.cursor/hooks.json`

**Default if missing**: `{ version: 1, hooks: {} }`

**Bingbong detection**: Filter entries where `.command` contains `bingbong-hook.sh`

**Events** (10): `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `afterAgentResponse`, `afterAgentThought`, `stop`

**Format**: Each event gets `{ command: "<abs-path>/bingbong-hook.sh <event>" }`

#### OpenCode (`installOpencode`)

**Target**: `~/.config/opencode/plugins/bingbong.js`

**Strategy**: Copy `agents/opencode/plugins/bingbong.js` to target. Create parent dirs if needed. ~5 lines.

#### Pi (`installPi`)

**Target**: `~/.pi/agent/extensions/bingbong.ts` (or `$PI_EXTENSIONS_DIR`)

**Strategy**: Read `agents/pi/extensions/bingbong.ts`, replace `__BINGBONG_URL__` with `http://localhost:3334` (or `BINGBONG_URL` env var), write to target. ~10 lines.

### Success Output

Keep it minimal — one line per install:

```
Installed hooks for Claude Code in ~/.claude/settings.json
```

## Prerequisite Changes (separate commits)

These should land before the install-hooks feature:

1. **Fix default ports** (3333 → 3334) in:
   - `agents/cursor/hooks/bingbong-hook.sh`
   - `agents/opencode/plugins/bingbong.js`
   - `agents/pi/extensions/bingbong.ts`
   - `agents/pi/install.sh`

2. **Add `agents/` to `package.json` `files` array** — required for npm publishing

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `bin/cli.ts` | Edit | Add subcommand detection, update help text |
| `src/install-hooks.ts` | Create | Command handler + all 4 agent installers (~200 lines) |
| `package.json` | Edit | Add `agents/` to `files` array |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File structure | Single file, no interface | 4 known agents, no plugin system needed |
| No-arg behavior | Static usage text | Eliminates stdin/TTY complexity; users run this once |
| Agent aliases | None (defer) | Error message lists valid names; add later if needed |
| JSON merge | Strip bingbong entries by specific path pattern, then append | Idempotent, preserves user hooks, avoids false positives |
| Path resolution | `import.meta.dir` + runtime validation | Works for source and npm installs; fails clearly for bundled builds |
| Atomic writes | Temp file in same directory + rename | Prevents corruption, avoids EXDEV |
| Backup | No | Atomic writes prevent partial writes; keeps it simple |
| Non-hooks keys | Spread preserved (`{ ...existing, hooks: merged }`) | Never touch permissions, $schema, etc. |
| Output JSON format | 2-space indent + trailing newline | Matches existing files, human-editable |

## Out of Scope

- `bingbong uninstall-hooks` (deferred per brainstorm)
- Interactive picker (YAGNI — static usage is sufficient)
- Agent aliases (add when someone asks)
- `--dry-run` flag
- Windows support for hook scripts
- Agent-installed detection/warnings
- Port normalization (separate commit)

## References

- Brainstorm: `docs/brainstorms/2026-02-14-install-hooks-cli-command-brainstorm.md`
- Prior CLI plan: `docs/plans/2026-01-28-feat-unified-cli-launch-command-plan.md`
- Current CLI: `bin/cli.ts`
- Claude hooks example: `agents/claude/hooks/claude-code-settings.example.json`
- Cursor installer (reference): `agents/cursor/install-hooks.sh`
