# Brainstorm: `bingbong install-hooks` CLI Command

**Date:** 2026-02-14
**Status:** Complete

## What We're Building

A `bingbong install-hooks <agent>` CLI command that programmatically installs bingbong hooks into supported coding agents (Claude Code, Cursor, OpenCode, Pi). This replaces the current per-agent shell scripts with a unified, native TypeScript experience.

Running `bingbong install-hooks` with no arguments presents an interactive picker of available agents. Running with an agent name (e.g., `bingbong install-hooks cursor`) installs hooks for that specific agent.

### Goals
- Improve onboarding for new users — one command to get going
- Give existing users a clean way to manage hooks across agents
- Consistent, high-quality UX regardless of which agent is being configured

## Why This Approach

### Command Name: `install-hooks`

Considered alternatives:
- `install` — Clean but ambiguous. Could mean installing bingbong itself, plugins, etc.
- `setup` — Too generic. Matches Claude's setup.sh but doesn't convey what's happening.
- `connect` — Nice mental model but doesn't match the technical reality (hooks are one-directional).

**Decision:** `install-hooks` — descriptive, unambiguous about what's being installed. Worth the extra characters for clarity.

### Architecture: Subcommand Router

The CLI currently has no subcommand support (only server-start flags). We'll add a lightweight subcommand detection layer:

1. `cli.ts` checks if `argv[0]` is a known subcommand
2. If yes, delegate to a handler module (e.g., `src/commands/install-hooks.ts`)
3. If no, fall through to existing server-start flag parsing

This pattern is extensible for future commands (uninstall-hooks, status, etc.) without cluttering the main entry point.

### Installers: Native TypeScript

Each agent gets its own installer module under `src/installers/` that implements a common interface. This replaces the existing shell scripts with Bun-native code for:
- Consistent colored output and progress feedback
- Proper error handling with helpful messages
- No external dependencies (no jq, no python3)
- Idempotent installs (safe to run multiple times)

Current agent install strategies that need to be reimplemented:

| Agent | Current Strategy | Config Location |
|-------|-----------------|-----------------|
| Claude Code | Prints JSON, user manually merges | `~/.claude/settings.json` |
| Cursor | Shell script with jq merge | `~/.cursor/hooks.json` |
| OpenCode | File copy | `~/.config/opencode/plugins/` |
| Pi | Python template + copy | `~/.pi/agent/extensions/` |

The biggest UX win is Claude Code — currently the worst experience (manual paste). The new installer should programmatically merge hooks into `settings.json`.

## Key Decisions

1. **Command name:** `install-hooks` (not `install`, `setup`, or `connect`)
2. **Architecture:** Subcommand router pattern in cli.ts, with handler modules per command
3. **Agent names:** Use short names (`claude`, `cursor`, `opencode`, `pi`) with common aliases (`claude-code`, `claudecode` → `claude`)
4. **No-arg behavior:** Interactive picker showing available agents
5. **Installer implementation:** Rewrite all installers in TypeScript (no shell scripts)
6. **Uninstall:** Deferred to a future `uninstall-hooks` command — not in initial scope

## Open Questions

- Should the installer detect if the agent is actually installed on the system and warn/skip if not?
- Should there be a `--dry-run` flag to preview changes before writing?
- How to handle path resolution when bingbong is installed globally via npm vs running from source?
- Should the interactive picker allow multi-select (install hooks for multiple agents at once)?
