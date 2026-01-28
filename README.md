# Bingbong

Soundscapes for coding agents. Transform AI agent sessions into spatial audio feedback.

## What is this?

Bingbong turns AI coding agent activity into spatial audio feedback. Each tool and action produces distinct sounds, sessions are positioned in stereo space, and you can monitor agent activity without visual attention.

**Supported agents:** Claude Code, Cursor, OpenCode, Pi

## Prerequisites

- [Bun](https://bun.sh) (or Node.js)
- At least one supported agent installed

## Quick Start

**1. Start the server:**
```bash
cd server
bun install
bun run index.ts
```

**2. Open the client:**
```bash
cd client
open index.html
# or serve via HTTP:
python -m http.server 8000
```

Click "Connect" in the browser.

**3. Install agent hooks:**

| Agent | Installation |
|-------|-------------|
| **Claude Code** | `./agents/claude/setup.sh` |
| **Cursor** | `./agents/cursor/install-hooks.sh` |
| **OpenCode** | `./agents/opencode/install.sh` |
| **Pi** | `./agents/pi/install.sh` |

**4. Use your agent** - every action will produce audio feedback.

## Configuration

Server defaults to `http://localhost:3334`. Configure via environment:

```bash
BINGBONG_URL=http://localhost:3334
BINGBONG_ENABLED=true
BINGBONG_MACHINE_ID=my-laptop
```

## Testing

Send test events without running an agent:
```bash
./test-events.sh
```

You should hear sounds and see particles in the visualizer.

## Troubleshooting

**No sounds?**
- Click "Connect" in browser
- Verify server is running on port 3334
- Click anywhere on page (browsers require user interaction for audio)

**Hooks not firing?**
- Check scripts are executable: `chmod +x agents/*/hooks/*.sh`
- Verify paths in agent config are absolute
- Test manually: `echo '{"session_id":"test"}' | ./agents/claude/hooks/pre-tool-use.sh`

**Server connection failed?**
- Check nothing else is using port 3334
- Verify server is running: `curl http://localhost:3334/`

## Architecture

Simple three-tier design:

**Agent Hooks** → emit events via HTTP → **Server** (session tracking, spatial assignment) → WebSocket → **Client** (Web Audio synthesis + visualization)

Each agent has hooks that fire on tool use, session start/stop, and other events. The server assigns each session a stereo position and broadcasts enriched events to connected clients, which render audio in real-time.

## Event Types

Events are normalized across agents:

| Event | Description | Priority |
|-------|-------------|----------|
| `SessionStart` | New agent session | High |
| `SessionEnd` | Agent session ends | High |
| `Stop` | Agent completes task | High |
| `PreToolUse` / `PostToolUse` | Before/after tool execution | Medium |
| `PermissionRequest` | User approval needed | Critical |
| `PreCompact` | Context compression | Low |

Each tool (Read, Write, Bash, etc.) gets distinct sound characteristics.

## Sound Design

**Priority levels:**
- **Critical** (PermissionRequest): Immediately noticeable, persistent
- **High** (Stop, Session events): Clear and distinctive
- **Medium** (Tool operations): Pleasant, non-intrusive
- **Low** (PreCompact, etc.): Subtle background tones

**Tool-specific mappings:**
- `Read` → Page turn, soft (A4, 80ms)
- `Write` → Typewriter click (E4, 120ms)
- `Edit` → Pencil scratch (D4, 100ms)
- `Bash` → Terminal beep (F3, 150ms, square wave)
- `Task` → Dual tone for subagent launch (G4+B4, 250ms)
- `Grep/Glob` → Quick search ping (B4/C5, 60ms)
- `Stop` → Major triad completion chord (C5+E5+G5)

## Project Structure

```
agents/
  claude/hooks/          # Claude Code hook scripts
  cursor/                # Cursor hooks + installer
  opencode/plugins/      # OpenCode plugin
  pi/extensions/         # Pi extension
server/                  # Bun WebSocket server
client/                  # Web Audio client (single HTML file)
```

## Development Status

**Current phase:** Phase 3 complete ✓

- ✓ Phase 1: Hook scripts (Claude Code, Cursor, OpenCode, Pi)
- ✓ Phase 2: WebSocket server with session tracking
- ✓ Phase 3: Web Audio client with synthesis + visualization
- ⧗ Phase 4: Advanced 3D audio (HRTF, reverb zones)
- ⧗ Phase 5: Multi-machine orchestration

## Future Work

**Codex integration:** Event support is [in development](https://github.com/openai/codex/issues/2109) by the Codex team.

**Claude Code Web:** Tentative at best. Would require CCW plugin support of some kind.

## References

- [Claude Code hooks](https://docs.anthropic.com/claude-code/hooks)
- [Cursor hooks](https://docs.cursor.com/advanced/hooks)
- [Pi extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions)
- [OpenCode events](https://opencode.ai/docs/plugins/#events)
