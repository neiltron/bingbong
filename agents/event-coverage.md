# Agent harness event coverage

Last full audit: **2026-07-19** (partial re-audits in the history table below)

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
- **Payload notes:** common fields `session_id`, `transcript_path`, `cwd`, `hook_event_name`; tool events carry `tool_name`, `tool_input`, `tool_use_id`, and `tool_response` (normalized to `tool_output` in `emit.ts`). Optional common fields as of 2.1.2xx: `prompt_id`, `permission_mode`, `effort`, `agent_id`/`agent_type` (set inside subagents). SessionStart `source` values are now `startup|resume|clear|compact|fork` (forks report `fork`, not `resume`, since 2.1.214) — we don't matcher-filter SessionStart, so no impact. Hook handler types beyond `"command"` exist (`http`, `mcp_tool`, `prompt`, `agent`) — not used. `bingbong emit` always exits 0, so hooks can never block actions.

**Registered (19):** PreToolUse, PostToolUse, PostToolUseFailure, SessionStart,
SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PermissionRequest,
PermissionDenied, Notification, PreCompact, PostCompact, TaskCreated,
TaskCompleted, TeammateIdle, Setup, UserPromptSubmit — all pass through as-is
(names are already canonical).

**Known upstream, deliberately skipped (too noisy / not audibly useful — each
hook spawns a process):** PostToolBatch, FileChanged, CwdChanged, ConfigChange,
InstructionsLoaded, WorktreeCreate, WorktreeRemove, Elicitation,
ElicitationResult, MessageDisplay, UserPromptExpansion, DirectoryAdded (new in
2.1.219 — fires on `/add-dir`; workspace meta, not audibly useful).

## Cursor

- **Integration:** `bingbong emit <event>` hooks written to `~/.cursor/hooks.json` (`version: 1`) by `install-hooks.ts` (`CURSOR_EVENTS`); camelCase names normalized to canonical types by `CURSOR_EVENT_MAP` in `packages/cli/src/emit.ts`.
- **Source of truth:** https://cursor.com/docs/hooks + https://cursor.com/changelog (not open source).
- **Payload notes:** session identity is `conversation_id` (normalized in `emit.ts`); `session_id` only on sessionStart/sessionEnd. Exit code 2 from a hook blocks actions — `bingbong emit` always exits 0. hooks.json entries may now carry extra fields beyond `command` (`type: "prompt"`, `timeout`, `loop_limit`, `failClosed`, `matcher`) — our installer only strips/appends its own entries, so foreign entries with these fields are preserved untouched. Cloud agents run command hooks only and don't support sessionStart/sessionEnd or the MCP/tab/workspace hooks.

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
- **Source of truth (open source):** repo moved to https://github.com/anomalyco/opencode in July 2026 (sst/opencode URLs redirect)
  - `packages/plugin/src/index.ts` on the `dev` branch (hook interface)
  - `packages/schema/src/` on the `dev` branch (bus event definitions; `event-manifest.ts` is the full inventory)
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

**Pending (found 2026-07-29, not yet applied):** the v2 runtime publishes
`permission.v2.asked` (`{id, sessionID, action, resources}` — different shape
from v1's `permission`/`patterns`) which we don't map to PermissionRequest yet;
`question.v2.asked/replied/rejected` are similarly unmapped. `session.error`'s
`sessionID` is optional in the schema — extraction falls back to "unknown".
The SSE stream also emits `{type: "sync"}` envelope events, but plugin `event`
hooks never receive those — no change needed for us.

## pi

- **Integration:** extension at `agents/pi/extensions/bingbong.ts`, installed to `~/.pi/agent/extensions/bingbong.ts`.
- **Source of truth (open source):** repo moved to https://github.com/earendil-works/pi (was badlogic/pi-mono; npm `@earendil-works/pi-coding-agent`, formerly `@mariozechner/pi-coding-agent`)
  - `packages/coding-agent/src/core/extensions/types.ts` (`ExtensionEvent` union)
  - `packages/coding-agent/docs/extensions.md`
  - `packages/coding-agent/CHANGELOG.md` (breaking changes)
- **Payload notes:** session id via `ctx.sessionManager.getSessionId()` (falls back to `getSessionFile()`); tool events carry `toolName`, `input`, `content`/`details`/`isError`, and (since 0.81.0) an optional `usage` on tool_result. Extensions are torn down and re-created on `/new`, `/resume`, `/fork` (`session_shutdown` → `session_start` with `event.reason`). Since 0.82.0 bash subprocesses also get `PI_SESSION_ID`/`PI_SESSION_FILE` env vars — a possible alternate session-id channel.

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
  - https://learn.chatgpt.com/docs/hooks (docs; developers.openai.com/codex/hooks redirects there)
  - https://github.com/openai/codex — event enum `HookEventName` in `codex-rs/protocol/src/protocol.rs`, config shape in `codex-rs/config/src/hook_config.rs`, JSON Schemas in `codex-rs/hooks/schema/generated/`
- **Payload notes:** Codex's hooks are deliberately Claude-shaped — same config schema `{matcher, hooks: [{type: "command", command}]}` and same stdin fields (`session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`), so events pass through `bingbong emit` with no mapping. Event names are already canonical.
- **Trust model:** unlike Claude Code, Codex requires one-time user approval of new/changed hooks (hash-keyed) via the `/hooks` TUI. Reinstalls that change entries need re-approval; `--dangerously-bypass-hook-trust` exists for automation.

**Registered (11):** PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop,
SubagentStart, SubagentStop, PermissionRequest, PreCompact, PostCompact,
UserPromptSubmit.

**Version notes:** hooks stable as of rust-v0.144.x; `SessionEnd` shipped
2026-07-17 and needs >= 0.145 (fire-and-forget: 1s default timeout, no output
schema). Re-verified against rust-v0.146.0 (2026-07-29): still exactly these
11 events, no payload changes. `UserPromptSubmit` and `Stop` ignore matchers
upstream (empty matcher is correct). The legacy `notify` config option
(`agent-turn-complete` only, JSON via argv) is superseded — not used.

**Known upstream, not applicable:** Codex has no PostToolUseFailure /
Notification / task events yet (failure signal requested in #34289). Known
issues: hooks flaky in Codex Desktop (openai/codex#33992, #21639, #35863);
`tool_input` lacks per-call workdir (#33986); project-level
`<repo>/.codex/hooks.json` can be silently skipped (#35306) — bingbong installs
globally to `~/.codex/hooks.json`, unaffected.

---

## Audit history

| Date | Notes |
|---|---|
| 2026-07-19 | Initial audit. Added 8 new Claude Code hooks + 6 Cursor hooks; Cursor camelCase → canonical mapping in emit.ts; fixed OpenCode `tool.execute.after` arg shapes + `properties.sessionID` extraction + stream-event flood control; pi: dropped removed events, `session_before_branch`→`session_before_fork`, added `agent_settled`, switched to `getSessionId()`; new sounds for 12 canonical event types. |
| 2026-07-19 | Added Codex support (`install-hooks codex` → `~/.codex/hooks.json`, 11 Claude-shaped hook events, no mapping needed). |
| 2026-07-29 | Codex-only re-audit vs rust-v0.146.0: no event/payload/config drift — no code changes. Docs URL moved to learn.chatgpt.com/docs/hooks; noted `SessionEnd` 1s fire-and-forget timeout, matcher-ignoring events, and new upstream issues (#34289 no failure event, #35306 project-level hooks skipped, #35863 Desktop SessionStart). |
| 2026-07-29 | Re-audit of Claude Code (2.1.220), Cursor, OpenCode, pi (0.83.0): no renames/removals anywhere, all registrations/subscriptions valid, no code changes. Claude Code added `DirectoryAdded` (2.1.219) → skipped list; OpenCode repo moved sst→anomalyco; recorded pending OpenCode deltas (`permission.v2.asked`, `question.v2.*` unmapped); pi tool_result gained optional `usage`. |
