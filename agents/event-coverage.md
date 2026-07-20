# Agent harness event coverage

Last audited: **2026-07-19**

This document is the source of truth for which upstream harness events bingbong
consumes, how they map to bingbong's canonical event vocabulary, and where each
harness's authoritative event list lives. Re-audit with the `/sync-agent-events`
skill (see `.claude/skills/sync-agent-events/SKILL.md`).

## Canonical event vocabulary

The server and client key sounds/visuals off these `event_type` values
(see `apps/client/src/config.ts` and `apps/client/src/audio-engine.ts`):

`SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`,
`SubagentStop`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
`PreCompact`, `PostCompact`, `UserPromptSubmit`, `Notification`,
`PermissionRequest`, `PermissionDenied`, `TaskCreated`, `TaskCompleted`,
`TeammateIdle`, `Setup`

`PreToolUse`/`PostToolUse` additionally use `tool_name` to pick tool-specific
sounds. Unknown event types fall back to the default blip. When an integration
maps a harness-native event to a canonical type, it preserves the native name in
`original_event_type` (top-level for the CLI emit path, inside `tool_output` for
the OpenCode/pi integrations).

---

## Claude Code

- **Integration:** `bingbong emit <Event>` hooks written to `~/.claude/settings.json` by `packages/cli/src/install-hooks.ts` (`CLAUDE_EVENTS`).
- **Source of truth:** https://code.claude.com/docs/en/hooks.md (hooks reference; not open source).
- **Payload notes:** common fields `session_id`, `transcript_path`, `cwd`, `hook_event_name`; tool events carry `tool_name`, `tool_input`, and `tool_response` (normalized to `tool_output` in `emit.ts`). `bingbong emit` always exits 0, so hooks can never block actions.

**Registered (19):** PreToolUse, PostToolUse, PostToolUseFailure, SessionStart,
SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PermissionRequest,
PermissionDenied, Notification, PreCompact, PostCompact, TaskCreated,
TaskCompleted, TeammateIdle, Setup, UserPromptSubmit — all pass through as-is
(names are already canonical).

**Known upstream, deliberately skipped (too noisy / not audibly useful — each
hook spawns a process):** PostToolBatch, FileChanged, CwdChanged, ConfigChange,
InstructionsLoaded, WorktreeCreate, WorktreeRemove, Elicitation,
ElicitationResult, MessageDisplay, UserPromptExpansion.

## Cursor

- **Integration:** `bingbong emit <event>` hooks written to `~/.cursor/hooks.json` (`version: 1`) by `install-hooks.ts` (`CURSOR_EVENTS`); camelCase names normalized to canonical types by `CURSOR_EVENT_MAP` in `packages/cli/src/emit.ts`.
- **Source of truth:** https://cursor.com/docs/hooks + https://cursor.com/changelog (not open source).
- **Payload notes:** session identity is `conversation_id` (normalized in `emit.ts`); `session_id` only on sessionStart/sessionEnd. Exit code 2 from a hook blocks actions — `bingbong emit` always exits 0.

| Cursor event | Canonical type | tool_name |
|---|---|---|
| sessionStart / sessionEnd | SessionStart / SessionEnd | — |
| beforeShellExecution / afterShellExecution | PreToolUse / PostToolUse | Bash |
| beforeMCPExecution / afterMCPExecution | PreToolUse / PostToolUse | from payload |
| beforeReadFile | PreToolUse | Read |
| afterFileEdit | PostToolUse | Edit |
| beforeSubmitPrompt | UserPromptSubmit | — |
| postToolUseFailure | PostToolUseFailure | from payload |
| subagentStart / subagentStop | SubagentStart / SubagentStop | — |
| preCompact | PreCompact | — |
| stop | Stop | — |
| afterAgentResponse / afterAgentThought | (raw passthrough) | — |

**Known upstream, deliberately skipped:** preToolUse/postToolUse (would
double-fire alongside the specific before*/after* hooks), beforeTabFileRead,
afterTabFileEdit (tab completions — constant noise), workspaceOpen (no
conversation context).

## OpenCode

- **Integration:** plugin at `agents/opencode/plugins/bingbong.js`, installed to `~/.config/opencode/plugins/bingbong.js`.
- **Source of truth (open source):**
  - https://github.com/sst/opencode/blob/dev/packages/plugin/src/index.ts (hook interface)
  - https://github.com/sst/opencode/blob/dev/packages/schema/src/ (bus event definitions)
  - https://opencode.ai/docs/plugins (docs; has been stale before — prefer source)
- **Payload notes:** bus events arrive as `{ type, properties }`; session id is `properties.sessionID` (or `properties.info.id`). Tool hooks: `tool.execute.before(input: {tool, sessionID, callID}, output: {args})`, `tool.execute.after(input: {tool, sessionID, callID, args}, output: {title, output, metadata})`.

| OpenCode event | Canonical type |
|---|---|
| tool.execute.before / after (hooks) | PreToolUse / PostToolUse |
| session.created / session.deleted | SessionStart / SessionEnd |
| session.idle (deprecated upstream) | Stop |
| session.status → status.type === "idle" | Stop (deduped vs session.idle, 1.5s window) |
| session.error | Stop |
| session.compacted | PostCompact |
| permission.asked | PermissionRequest |
| everything else not ignored | raw passthrough (default blip) |

**Ignored (flood control):** `message.part.*`, `session.next.*`, `lsp.*`,
`tui.*`, `pty.*`, `installation.*`, `file.watcher.*`, `models-dev.*`,
`catalog.*`, `server.connected`, `global.disposed`.

## pi

- **Integration:** extension at `agents/pi/extensions/bingbong.ts`, installed to `~/.pi/agent/extensions/bingbong.ts`.
- **Source of truth (open source):** repo moved to https://github.com/earendil-works/pi (was badlogic/pi-mono; npm `@earendil-works/pi-coding-agent`, formerly `@mariozechner/pi-coding-agent`)
  - `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionEvent` union)
  - `packages/coding-agent/docs/extensions.md`
  - `packages/coding-agent/CHANGELOG.md` (breaking changes)
- **Payload notes:** session id via `ctx.sessionManager.getSessionId()` (falls back to `getSessionFile()`); tool events carry `toolName`, `input`, `content`/`details`/`isError`. Extensions are torn down and re-created on `/new`, `/resume`, `/fork` (`session_shutdown` → `session_start` with `event.reason`).

| pi event | Canonical type |
|---|---|
| tool_call / tool_result | PreToolUse / PostToolUse |
| session_start / session_shutdown | SessionStart / SessionEnd |
| session_before_compact / session_compact | PreCompact / PostCompact |
| agent_settled, agent_end | Stop (deduped, 1.5s window) |
| session_info_changed, session_before_switch, session_before_fork, session_before_tree, session_tree, before_agent_start, agent_start, turn_start, context, turn_end | raw passthrough |

**Removed upstream (don't resubscribe):** `session_switch`, `session_branch`,
`session_fork` — replaced by `session_start` with `reason: "new"|"resume"|"fork"`.

**Known upstream, deliberately skipped:** `message_*`, `tool_execution_*`
(redundant with tool_call/tool_result), `before_provider_*`,
`after_provider_response`, `model_select`, `thinking_level_select`,
`project_trust`, `resources_discover`, `user_bash`, `input`.

## Codex

- **Integration:** `bingbong emit <Event>` hooks written to `~/.codex/hooks.json` by `install-hooks.ts` (`CODEX_EVENTS`).
- **Source of truth (open source):**
  - https://developers.openai.com/codex/hooks (docs)
  - https://github.com/openai/codex — `codex-rs/hooks/` crate, JSON Schemas in `codex-rs/hooks/schema/generated/`
- **Payload notes:** Codex's hooks are deliberately Claude-shaped — same config schema `{matcher, hooks: [{type: "command", command}]}` and same stdin fields (`session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`), so events pass through `bingbong emit` with no mapping. Event names are already canonical.
- **Trust model:** unlike Claude Code, Codex requires one-time user approval of new/changed hooks (hash-keyed) via the `/hooks` TUI. Reinstalls that change entries need re-approval; `--dangerously-bypass-hook-trust` exists for automation.

**Registered (11):** PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop,
SubagentStart, SubagentStop, PermissionRequest, PreCompact, PostCompact,
UserPromptSubmit.

**Version notes:** hooks stable as of rust-v0.144.x; `SessionEnd` shipped
2026-07-17 and needs >= 0.145. The legacy `notify` config option
(`agent-turn-complete` only, JSON via argv) is superseded — not used.

**Known upstream, not applicable:** Codex has no PostToolUseFailure /
Notification / task events yet. Known issues: hooks flaky in Codex Desktop
(openai/codex#33992, #21639); `tool_input` lacks per-call workdir (#33986).

---

## Audit history

| Date | Notes |
|---|---|
| 2026-07-19 | Initial audit. Added 8 new Claude Code hooks + 6 Cursor hooks; Cursor camelCase → canonical mapping in emit.ts; fixed OpenCode `tool.execute.after` arg shapes + `properties.sessionID` extraction + stream-event flood control; pi: dropped removed events, `session_before_branch`→`session_before_fork`, added `agent_settled`, switched to `getSessionId()`; new sounds for 12 canonical event types. |
| 2026-07-19 | Added Codex support (`install-hooks codex` → `~/.codex/hooks.json`, 11 Claude-shaped hook events, no mapping needed). |
