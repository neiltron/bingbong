# Event Coverage (Source of Truth)

This file is the canonical event-coverage reference for bingbong.

If event hooks/mappings change, update this file in the same PR.
README should stay concise and link here.

## Baseline: Claude Code

Claude Code is bingbong’s baseline harness.

`bingbong install-hooks claude` installs the full current Claude hook set from `src/events.ts` (`CLAUDE_HOOK_EVENT_SPECS`), including matcher-aware config behavior.

### Claude hook install matrix

Matcher installer behavior:
- `matcher: ".*"` is written **only** for events that support matchers.
- `matcher` is **omitted** for events that do not support matchers.

| Claude event | Matcher support (Claude docs) | Installer writes matcher? | Current runtime handling |
| --- | --- | --- | --- |
| `SessionStart` | Yes | Yes (`.*`) | Dedicated event sound |
| `UserPromptSubmit` | No | No | Dedicated event sound |
| `PreToolUse` | Yes | Yes (`.*`) | Tool-aware sound mapping (`tool_name`) |
| `PermissionRequest` | Yes | Yes (`.*`) | Dedicated high-priority sound |
| `PostToolUse` | Yes | Yes (`.*`) | Tool-aware sound mapping (`tool_name`) |
| `PostToolUseFailure` | Yes | Yes (`.*`) | Tool-aware failure variant (sharper timbre) |
| `Notification` | Yes | Yes (`.*`) | Dedicated event sound |
| `SubagentStart` | Yes | Yes (`.*`) | Dedicated event sound |
| `SubagentStop` | Yes | Yes (`.*`) | Dedicated event sound |
| `Stop` | No | No | Dedicated completion sound |
| `TeammateIdle` | No | No | Dedicated low-intensity sound |
| `TaskCompleted` | No | No | Dedicated completion sound |
| `InstructionsLoaded` | No | No | Dedicated event sound |
| `ConfigChange` | Yes | Yes (`.*`) | Dedicated event sound |
| `WorktreeCreate` | No | No | Dedicated event sound |
| `WorktreeRemove` | No | No | Dedicated event sound |
| `PreCompact` | Yes | Yes (`.*`) | Dedicated event sound |
| `PostCompact` | Yes | Yes (`.*`) | Dedicated event sound |
| `Elicitation` | Yes | Yes (`.*`) | Dedicated high-priority sound |
| `ElicitationResult` | Yes | Yes (`.*`) | Dedicated event sound |
| `SessionEnd` | Yes | Yes (`.*`) | Dedicated event sound |

## Normalization + mapping path

Primary normalization lives in `src/events.ts` and is applied in:
- `src/emit.ts` (CLI hook ingest)
- `src/server.ts` (defensive normalization for all `/events` input)

Behavior:
- Known harness-native aliases are normalized to Claude baseline names.
- Original names are preserved via `tool_output.original_event_type` when mapped.
- Missing/partial payload fields are defaulted safely (`session_id`, `tool_input`, `tool_output`, etc.) to avoid crashes.

## Cross-harness status (Claude baseline parity)

| Harness | Current emission model | Baseline alignment status |
| --- | --- | --- |
| Claude Code | Emits official Claude event names via `bingbong emit <EventType>` | Full baseline install coverage |
| Cursor | Installs Cursor-native hook names, normalized in `emit/server` to Claude baseline where possible | Partial parity; core lifecycle/tool flow normalized |
| OpenCode | Plugin maps core events to baseline and passes through additional OpenCode events | Core parity plus passthrough extras |
| Pi | Extension maps core events; server normalization also maps compact-related aliases | Core parity plus passthrough extras |

### Intentional gaps / follow-ups

These are intentionally not claimed as full parity today:
- Cursor/OpenCode/Pi do not expose 1:1 equivalents for every Claude lifecycle event.
- Some non-Claude native events are preserved as passthrough names (kept for observability rather than dropped).
- No strict schema validation/rejection on `/events`; normalization is permissive and best-effort by design.

## Maintenance note

When adding/removing events or changing mapping behavior:
1. Update `src/events.ts`.
2. Update this file in the same PR.
3. Keep README concise and point here.
