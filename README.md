# Bingbong Claude Code

An auditory monitoring system for Claude Code sessions that creates a 3D audio landscape for observing AI agent activity.

## Vision

Transform Claude Code sessions into an auditory experience where:
- Different actions produce distinct sounds (notes, tones, textures)
- Multiple agents exist in different spatial positions (3D panning)
- Sound characteristics convey meaning (amplitude = importance, reverb = depth)
- Session state is perceivable without visual attention

## Use Cases

1. **Ambient Monitoring** - Know your agent is still working without watching
2. **Completion Alerts** - Distinct tone when agent reaches a stopping point
3. **Multi-Agent Orchestra** - Monitor multiple agents across machines simultaneously
4. **Intuition Building** - Develop a "feel" for agent behavior patterns

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code Sessions                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Machine A   │  │   Machine B   │  │  CC Web      │          │
│  │   Session 1   │  │   Session 2   │  │  Session 3   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│         ▼                 ▼                  ▼                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                    Hook Scripts                       │       │
│  │  (emit events via HTTP/WebSocket to backend)         │       │
│  └──────────────────────────┬───────────────────────────┘       │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend Server                              │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  • WebSocket server for real-time event streaming       │     │
│  │  • Session registry (tracks active agents)              │     │
│  │  • Event normalization and enrichment                   │     │
│  │  • Spatial assignment (pan positions for agents)        │     │
│  │  • Optional: event persistence for replay               │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Client                             │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  • Web Audio API for spatial audio rendering            │     │
│  │  • Tone.js for synthesis and effects                    │     │
│  │  • 3D visualization (Three.js or Canvas)                │     │
│  │  • Configurable sound mappings                          │     │
│  │  • Session management UI                                │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Available Hook Events

Claude Code provides these hook events we can leverage:

| Event | Description | Sound Mapping Ideas | Priority |
|-------|-------------|---------------------|----------|
| `PreToolUse` | Before any tool executes | Soft attack, rising tone | Medium |
| `PostToolUse` | After tool completes | Completion chime, varies by tool | Medium |
| `SessionStart` | Session initialization | Welcome chord, establish position | High |
| `SessionEnd` | Session cleanup | Fade-out, descending tone | High |
| `Stop` | Main agent finishes | **Distinct completion bell** | **High** |
| `SubagentStop` | Subagent completes | Lighter completion tone | Medium |
| `PermissionRequest` | User approval needed | **Alert bell, attention-grabbing** | **Critical** |
| `Notification` | System notifications | Alert sound | Low |
| `PreCompact` | Context compaction | Compression/woosh sound | Low |
| `Setup` | Initial setup | Initialization tone | Low |
| `UserPromptSubmit` | User submits prompt | Input acknowledgment | Medium |

## Cursor IDE Hook Events (Mapped to Claude Code Baseline)

Cursor IDE exposes a separate hook system with different event names. We map these to the closest Claude Code hooks where possible (and note gaps).

| Cursor Event | Closest Claude Code Hook | Notes |
|-------------|--------------------------|-------|
| `beforeShellExecution` | `PreToolUse` | Treat as tool hook (`Bash`). |
| `afterShellExecution` | `PostToolUse` | Treat as tool hook (`Bash`). |
| `beforeMCPExecution` | `PreToolUse` | MCP tool invocation. |
| `afterMCPExecution` | `PostToolUse` | MCP tool completion. |
| `beforeReadFile` | `PreToolUse` | File read hook. |
| `afterFileEdit` | `PostToolUse` | File edit hook. |
| `beforeSubmitPrompt` | `UserPromptSubmit` | User submits prompt. |
| `afterAgentResponse` | _No direct equivalent_ | Closest is `Notification`, but we treat as a distinct Cursor event. |
| `afterAgentThought` | _No direct equivalent_ | Cursor-only signal. |
| `stop` | `Stop` | Agent finishes. |

Note: Cursor also exposes tab-completion/inline edit hooks (`beforeTabFileRead`, `afterTabFileEdit`), which we intentionally exclude for now.

### Sound Design Notes

**Critical Events** (`PermissionRequest`):
- Must be immediately noticeable and distinct from all other sounds
- Should persist or repeat until acknowledged
- Similar urgency level to `Stop` but different character
- Example: Rising alert tone, bell with reverb, or attention-grabbing chord

**High Priority Events** (`Stop`, `SessionStart`, `SessionEnd`):
- Clear, distinctive, and unmistakable
- `Stop` should feel conclusive and satisfying
- Session events establish spatial presence/departure

**Medium Priority Events** (Tool operations, `UserPromptSubmit`):
- Frequent but not overwhelming
- Should be pleasant and non-intrusive
- Tool-specific variations add context

**Low Priority Events** (`Notification`, `PreCompact`, `Setup`):
- Subtle, background-level sounds
- Should not distract during active work
- Informational rather than actionable

### Tool-Specific Sounds

For `PreToolUse`/`PostToolUse`, we can match on tool names:

| Tool | Sound Character |
|------|-----------------|
| `Read` | Page turn, soft rustle |
| `Write` | Typewriter click, pen scratch |
| `Edit` | Pencil on paper, subtle edit |
| `Bash` | Terminal beep, mechanical |
| `Task` (subagent) | New voice enters, spatial shift |
| `Grep`/`Glob` | Search sweep, radar ping |
| `WebFetch` | Network whoosh |
| `WebSearch` | Wider sweep |

## Data Available to Hooks

Each hook receives JSON via stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript",
  "cwd": "/working/directory",
  "tool_name": "Write",        // for tool hooks
  "tool_input": { ... },       // tool parameters
  "tool_output": { ... }       // for PostToolUse
}
```

## Implementation Plan

### Phase 1: Local Proof of Concept
- Simple hook scripts that play local sounds
- Test with `afplay` (macOS) or `aplay` (Linux)
- Verify hook triggering and data access

### Phase 2: Backend Server
- Node.js/Bun WebSocket server
- Event schema definition
- Session registry
- Basic spatial assignment algorithm

### Phase 3: Frontend Audio
- Web Audio API + Tone.js setup
- Sound synthesis for each event type
- Stereo panning for multiple agents
- Basic visualization

### Phase 4: Full 3D Audio
- HRTF (Head-Related Transfer Function) for true 3D
- Dynamic spatial positioning
- Reverb zones for different agent types
- Amplitude envelopes based on activity

### Phase 5: Multi-Machine Support
- Authentication/authorization
- Remote hook configuration
- Network resilience
- Latency compensation

## Claude Code Web Integration

Claude Code Web is more constrained, but potential approaches:
1. **Browser Extension** - Inject hooks into web interface
2. **Proxy Server** - Intercept API calls
3. **Official API** - If Anthropic exposes event streams

*Note: Web integration may require Anthropic cooperation or creative workarounds.*

## Cursor Hooks Setup

We ship a helper script that installs Bingbong hooks into Cursor's `hooks.json` without removing existing hooks.

Project-level (repo-local):
```
./agents/cursor/install-hooks.sh
```

User-level (applies across all Cursor projects):
```
./agents/cursor/install-hooks.sh --global
```

The script de-duplicates our hook entries so it can be safely re-run.

## Technical Considerations

### Hook Script Performance
- Hooks have 60s timeout (configurable)
- Should be non-blocking for audio emission
- Fire-and-forget HTTP POST is ideal

### Audio Latency
- Target < 100ms from event to sound
- WebSocket preferred over HTTP polling
- Consider buffering for network jitter

### Spatial Audio
- Web Audio API `PannerNode` for 3D positioning
- HRTF for headphone users
- Speaker array support for room setups

## Sound Design Principles

1. **Recognizable but not annoying** - Sounds should be pleasant over long sessions
2. **Semantically meaningful** - Similar actions should sound similar
3. **Distinguish completion** - "Done" sounds should be unmistakable
4. **Error awareness** - Failed operations should be audibly different
5. **Volume discipline** - Frequent sounds should be quieter than rare ones

## Configuration Ideas

```yaml
# bingbong.config.yaml
backend:
  url: "wss://bingbong.example.com"
  auth_token: "${BINGBONG_TOKEN}"

spatial:
  mode: "stereo"  # stereo | hrtf | surround
  auto_position: true  # assign positions automatically

sounds:
  Read:
    note: "C4"
    duration: 0.1
    envelope: "pluck"
  Write:
    note: "E4"
    duration: 0.15
    envelope: "soft"
  Stop:
    chord: ["C4", "E4", "G4"]

## Future TODOs (Cursor)

- Cursor CLI hook coverage (currently limited vs IDE hooks).
- Background Agents API webhooks for remote/background sessions.
    duration: 0.5
    envelope: "bell"

agents:
  default_pan: 0  # center
  spread: 0.8     # how much to spread agents left/right
```

## Getting Started

See `src/` for implementation code:
- `agents/claude/hooks/` - Claude Code hook scripts
- `agents/opencode/` - OpenCode plugin integration
- `agents/pi/` - pi-coding-agent extension integration
- `server/` - Backend WebSocket server
- `client/` - Frontend audio application

## References

- [Claude Code Hooks Documentation](https://docs.anthropic.com/claude-code/hooks)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Tone.js](https://tonejs.github.io/)
- [HRTF Audio](https://en.wikipedia.org/wiki/Head-related_transfer_function)
