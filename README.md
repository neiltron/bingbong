# Bingbong

Soundscapes for coding agents. Transform AI agent sessions into spatial audio feedback.

## What is this?

Bingbong turns AI coding agent activity into spatial audio feedback. Each tool and action produces distinct sounds, sessions are positioned in stereo space, and you can monitor agent activity without visual attention.

**Supported agents:** Claude Code, Cursor, OpenCode, Pi

## Quick Start

See [QUICKSTART.md](./QUICKSTART.md) for setup instructions.

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

## Status

**Current phase:** Phase 3 complete ✓

- ✓ Phase 1: Hook scripts (Claude Code, Cursor, OpenCode, pi)
- ✓ Phase 2: WebSocket server with session tracking
- ✓ Phase 3: Web Audio client with synthesis + visualization
- ⧗ Phase 4: Advanced 3D audio (HRTF, reverb zones)
- ⧗ Phase 5: Multi-machine orchestration

## Agent Integration

### Claude Code

Install hooks via settings file:
```bash
./agents/claude/setup.sh
```

### Cursor IDE

Project-level:
```bash
./agents/cursor/install-hooks.sh
```

Global (all projects):
```bash
./agents/cursor/install-hooks.sh --global
```

### OpenCode

Plugin auto-loads from `~/.opencode/plugins/`

### pi-coding-agent

Extension installs via:
```bash
./agents/pi/install.sh
```

## Sound Design

**Critical events** (PermissionRequest): Immediately noticeable, persistent
**High priority** (Stop, Session events): Clear and distinctive
**Medium priority** (Tool operations): Pleasant, non-intrusive
**Low priority** (PreCompact, etc.): Subtle background tones

Tool-specific mappings:
- `Read` → Page turn, soft (A4, 80ms)
- `Write` → Typewriter click (E4, 120ms)
- `Edit` → Pencil scratch (D4, 100ms)
- `Bash` → Terminal beep (F3, 150ms, square wave)
- `Task` → Dual tone for subagent launch (G4+B4, 250ms)
- `Grep/Glob` → Quick search ping (B4/C5, 60ms)

## Configuration

Server defaults to `http://localhost:3334`. Configure via environment:

```bash
BINGBONG_URL=http://localhost:3334
BINGBONG_ENABLED=true
BINGBONG_MACHINE_ID=my-laptop
```

Client connects to `ws://localhost:3334/ws`.

## Project Structure

```
agents/
  claude/hooks/          # Claude Code hook scripts
  cursor/                # Cursor IDE hooks + installer
  opencode/plugins/      # OpenCode plugin
  pi/extensions/         # pi-coding-agent extension
server/                  # Bun WebSocket server
client/                  # Web Audio client (single HTML file)
```

## Development

**Server:**
```bash
cd server
bun install
bun run index.ts
```

**Client:**
```bash
cd client
open index.html
# or
python -m http.server 8000
```

**Testing:**
```bash
./test-events.sh  # Send sample events to server
```

## Future Work

**Codex integration:** Event support is currently in development by the Codex team. Once available, we'll add hooks for Codex sessions.

**Claude Code Web:** Browser-based integration is tentative at best. Would require either browser extension, proxy server, or official Anthropic API support.

## References

- [Claude Code Hooks](https://docs.anthropic.com/claude-code/hooks)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Cursor Hooks](https://docs.cursor.com/advanced/hooks)
