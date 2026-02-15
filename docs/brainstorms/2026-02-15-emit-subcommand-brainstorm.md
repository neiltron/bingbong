# Brainstorm: `bingbong emit` Subcommand

**Date:** 2026-02-15
**Status:** Complete

## What We're Building

A `bingbong emit <EventType>` CLI subcommand that reads hook payload JSON from stdin, normalizes fields, and POSTs the event to the bingbong server's `/events` endpoint. This replaces the shell scripts (and their `jq`/`curl`/`python3` dependencies) as the mechanism that agent hooks call.

### The Problem

Currently, `install-hooks` writes absolute paths to shell scripts in the user's agent config:
```json
{"command": "/Users/neil/projects/bingbong/agents/claude/hooks/pre-tool-use.sh"}
```

These paths break when:
- The user moves or deletes the repo checkout
- The user switches from source to global npm install (or vice versa)
- The user uses `npx bingbong` (no persistent install)

Additionally, the shell scripts depend on `jq` and `curl` at runtime.

### The Solution

Hook configs point to `bingbong` itself:
```json
{"command": "bingbong emit PreToolUse"}
```

If bingbong is globally installed, it's on PATH and this just works (~12ms startup). The `install-hooks` command detects whether `bingbong` is on PATH and falls back to `npx bingbong emit PreToolUse` if not (slower, ~200-500ms, documented tradeoff).

## Why This Approach

### Agent-agnostic normalization

Different agents send different field names in their stdin JSON (Claude uses `session_id`, Cursor uses `conversation_id`). Rather than agent-specific code, `emit` uses a fallback chain:
- `session_id // conversation_id // generation_id // "unknown"`
- `cwd // workspace_roots[0] // ""`
- etc.

One code path handles all agents. Future agents that use external-command hooks work automatically.

### Which agents this affects

| Agent | Hook mechanism | Affected by emit? |
|-------|---------------|-------------------|
| Claude Code | External command (stdin JSON) | Yes — replaces shell scripts |
| Cursor | External command (stdin JSON) | Yes — replaces shell scripts |
| OpenCode | In-process JS plugin (fetch()) | No — unchanged |
| Pi | In-process TS extension (fetch()) | No — unchanged |

### Subsumes the ping plan

The existing plan at `docs/plans/2026-02-01-feat-cli-ping-event-source-plan.md` described a `bingbong ping` command for ad-hoc event emission. `bingbong emit` generalizes this — a ping is just `echo '{}' | bingbong emit Ping`.

## Key Decisions

1. **Command name:** `emit` (verb that describes what it does — emits an event to the server)
2. **Input method:** Hybrid — event type as positional arg, remaining fields from stdin JSON
3. **Normalization:** Agent-agnostic with fallback chains (no `--agent` flag)
4. **install-hooks update:** Write `bingbong emit X` if on PATH, `npx bingbong emit X` otherwise
5. **Performance:** Global install ~12ms (recommended), npx ~200-500ms (documented tradeoff)
6. **Behavior:** Fire-and-forget, always exit 0, never block the host agent
7. **Server URL:** `BINGBONG_URL` env var or default `http://localhost:3334`

## Open Questions

- Should `bingbong emit` also support a `--json` flag for passing payload as an argument instead of stdin? (Useful for ad-hoc testing, but adds complexity)
- Should the existing shell scripts in `agents/` be removed, deprecated, or kept as-is for manual use?
- Should `emit` validate the event type against a known list, or accept anything?
