---
name: sync-agent-events
description: Audit bingbong's agent-harness integrations (Claude Code, Cursor, OpenCode, pi) against upstream event/hook APIs, report drift, and apply updates. Use when asked to check whether agent integrations are up to date, sync agent events, or when adding support for new harness events.
---

# Sync agent events

Bingbong integrates with four agent harnesses. Each ships events differently and
each drifts over time. This skill re-runs the upstream audit and updates the
integrations plus `agents/event-coverage.md`.

## Files that define bingbong's side

| File | Role |
|---|---|
| `packages/cli/src/install-hooks.ts` | `CLAUDE_EVENTS` + `CURSOR_EVENTS` hook registration lists |
| `packages/cli/src/emit.ts` | `CURSOR_EVENT_MAP` (camelCase → canonical), session-id + tool_response normalization |
| `agents/opencode/plugins/bingbong.js` | OpenCode plugin: `EVENT_TYPE_MAP`, `IGNORED_PREFIXES`, tool hook shapes |
| `agents/pi/extensions/bingbong.ts` | pi extension: `EVENT_TYPE_MAP`, `on(...)` subscriptions |
| `apps/client/src/config.ts` | `SOUND_CONFIG` — canonical event types → sounds |
| `packages/protocol/src/index.ts` | `BingbongEvent` wire shape |
| `agents/event-coverage.md` | Coverage matrix, mapping decisions, audit history |

## Procedure

1. **Read `agents/event-coverage.md`** for the current baseline, the
   canonical vocabulary, and the list of deliberately-skipped events (don't
   re-propose those without a reason).

2. **Research upstream, one subagent per harness, in parallel.** Give each
   agent the current registered/mapped event list and ask for exact event
   names, payload field names, schema changes, and deprecations/renames:
   - **Claude Code** (closed source — use docs): fetch
     https://code.claude.com/docs/en/hooks.md. Check: hook event list, matcher
     support, stdin payload fields (`tool_response` vs `tool_output`), settings
     schema for `{matcher, hooks: [{type: "command", command}]}` entries.
   - **Cursor** (closed source — use docs): fetch https://cursor.com/docs/hooks
     and https://cursor.com/changelog. Check: hook names (camelCase),
     hooks.json `version`, stdin fields (`conversation_id`), exit-code
     semantics (exit 2 blocks — bingbong must always exit 0).
   - **OpenCode** (open source): read
     `github.com/sst/opencode` `packages/plugin/src/index.ts` (hook
     interface) and `packages/schema/src/` (bus event types). Docs at
     opencode.ai/docs/plugins have been stale before — trust source over docs.
   - **pi** (open source): read `github.com/earendil-works/pi`
     `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionEvent`
     union), `docs/extensions.md`, and `CHANGELOG.md` for breaking changes.
     Note: repo/npm moved from badlogic/pi-mono / `@mariozechner/*` in 2026.

3. **Diff findings against the matrix.** Classify each delta:
   - New event worth a sound → add to registration/subscription + mapping, and
     add a `SOUND_CONFIG` entry if it's a new canonical type (notes must exist
     in `NOTE_FREQ`).
   - New event that's noisy/meta → add to the skipped list in the matrix with a
     one-line reason (for OpenCode, consider `IGNORED_PREFIXES`).
   - Renamed/removed event → update integration; never leave dead
     subscriptions (they fail silently).
   - Payload shape change → fix extraction (session id fields, tool arg
     shapes) in the affected integration.

4. **Guard rails when applying changes:**
   - Emitters must never block a harness: always exit 0 / swallow errors.
   - Avoid double sounds: when two upstream events signal the same thing
     (e.g. deprecated + replacement both firing), dedupe with a time window —
     see `isDuplicateStop` in the OpenCode plugin and pi extension.
   - Keep `original_event_type` when normalizing a native name.
   - Old harness versions still exist: prefer additive handling (subscribe to
     both old and new events with dedupe) over hard cutovers.

5. **Verify:** `bun run typecheck:client`, `bun run build:client`, and smoke
   the emit path:
   `echo '{"session_id":"test"}' | bun run packages/cli/bin/cli.ts emit PreToolUse`
   (with a server running, or assert no crash without one). `test-events.sh`
   exercises the server end-to-end.

6. **Record the audit:** update the per-harness sections and append a row to
   the audit-history table in `agents/event-coverage.md` with today's date,
   even when there is no drift ("no changes" is a valid, useful entry).
