# Event Coverage (Source of Truth)

This file is the canonical event-coverage reference for bingbong.

If event hooks/mappings change, update this file in the same PR. Keep the README concise and link here instead of duplicating large event tables.

## Baseline: Claude Code

Claude Code is the baseline hook event source for bingbong.

`bingbong install-hooks claude` installs the following event set from `src/install-hooks.ts` (`CLAUDE_EVENTS`):

| Claude event | Installed by `install-hooks claude` | Matcher written by installer | Current runtime handling |
| --- | --- | --- | --- |
| `PreToolUse` | Yes | `.*` | Tool-aware sound mapping (`tool_name`) |
| `PostToolUse` | Yes | `.*` | Tool-aware sound mapping (`tool_name`) |
| `SessionStart` | Yes | `""` | Dedicated event sound |
| `SessionEnd` | Yes | `""` | Dedicated event sound |
| `Stop` | Yes | `""` | Dedicated event sound |
| `SubagentStop` | Yes | `""` | Dedicated event sound |
| `PermissionRequest` | Yes | `""` | Emitted/logged; currently uses default fallback sound |
| `Notification` | Yes | `""` | Emitted/logged; currently uses default fallback sound |
| `PreCompact` | Yes | `""` | Dedicated event sound |
| `Setup` | Yes | `""` | Emitted/logged; currently uses default fallback sound |
| `UserPromptSubmit` | Yes | `""` | Emitted/logged; currently uses default fallback sound |

### Claude TODO gaps (known)

Current Claude install coverage is **not yet full parity** with the latest upstream Claude hook list.

- `Setup` is currently installed but is flagged as outdated in issue #13 notes.
- Missing Claude events called out in issue #13:
  - `PostToolUseFailure`
  - `SubagentStart`
  - `TeammateIdle`
  - `TaskCompleted`
  - `InstructionsLoaded`
  - `ConfigChange`
  - `WorktreeCreate`
  - `WorktreeRemove`
  - `PostCompact`
  - `Elicitation`
  - `ElicitationResult`

## Matcher caveats (Claude)

- bingbong currently writes a `matcher` field for all installed Claude events.
- `PreToolUse`/`PostToolUse` use `.*` intentionally.
- For non-tool events, installer currently writes `matcher: ""`.
- Per Claude docs (see issue #13), at least `Stop` and `UserPromptSubmit` ignore matchers; matcher values there are effectively no-ops.

## Cross-harness mapping/status (practical)

| Harness | Current event emission model | Mapping to Claude baseline | Practical status |
| --- | --- | --- | --- |
| Claude Code | Hook commands emit Claude event names directly via `bingbong emit <EventType>` | Native baseline names | Best coverage today (installed set above), but still has known TODO gaps. |
| Cursor | Hook commands emit Cursor-native event names (`beforeShellExecution`, `afterMCPExecution`, etc.) | No normalization layer yet | Partial parity. Core lifecycle/tool moments are present, but names remain Cursor-native and not 1:1 Claude-normalized. |
| OpenCode | Plugin emits OpenCode events from `agents/opencode/plugins/bingbong.js` | Maps core events (`tool.execute.before/after`, `session.created/deleted/idle/error`) to Claude-style names; passes through others | Good baseline parity for tool/session core, with extra OpenCode events preserved as raw names. |
| Pi | Extension emits Pi events from `agents/pi/extensions/bingbong.ts` | Maps `tool_call`, `tool_result`, `session_start`, `session_shutdown`, `agent_end`; passes through other Pi events | Core parity is covered; broader Pi lifecycle events are currently Pi-native passthrough events. |

### Cursor practical equivalence notes

Current Cursor hooks install these events (`CURSOR_EVENTS` in `src/install-hooks.ts`):

- `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile` → roughly `PreToolUse`-like
- `afterShellExecution`, `afterMCPExecution`, `afterFileEdit` → roughly `PostToolUse`-like
- `beforeSubmitPrompt` → roughly `UserPromptSubmit`-like
- `afterAgentResponse`, `afterAgentThought` → notification-like lifecycle signals
- `stop` → stop/completion signal (note lowercase Cursor naming)

## Maintenance note

This file is the **source of truth** for bingbong event coverage documentation.
