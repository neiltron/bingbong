# Bingbong

Soundscapes for coding agents. Transform AI agent sessions into spatial audio feedback.

## What is this?

Bingbong turns AI coding agent activity into spatial audio feedback. Each tool and action produces distinct sounds, sessions are positioned in stereo space, and you can monitor agent activity without visual attention.

**Supported agents:** Claude Code, Cursor, OpenCode, Pi

## Prerequisites

- [Bun](https://bun.sh) runtime
- At least one supported agent installed

## Quick Start

**1. Run bingbong:**

```bash
# Install globally
npm install -g bingbong
bingbong

# Or run directly with npx (requires Bun)
npx bingbong

# Or clone and run from source
git clone https://github.com/yourusername/bingbong
cd bingbong
bun run start
```

**2. Open in browser:**

The client is served automatically at `http://localhost:3334`. Click "Connect" to start.

Use `--open` to auto-launch your browser:
```bash
bingbong --open
```

**3. Install agent hooks:**

| Agent | Installation |
|-------|-------------|
| **Claude Code** | `./agents/claude/setup.sh` |
| **Cursor** | `./agents/cursor/install-hooks.sh` |
| **OpenCode** | `./agents/opencode/install.sh` |
| **Pi** | `./agents/pi/install.sh` |

**4. Test it out** - every action and tool use should produce a sound.

You can also test the events without burning any tokens with the test script:

```bash
./test-events.sh
```

## CLI Options

```
bingbong [options]

Options:
  -p, --port <number>  Port to run server on (default: 3334)
  -o, --open           Open browser automatically
  -h, --help           Show help message
  -v, --version        Show version number

Examples:
  bingbong              Start server on port 3334
  bingbong --open       Start and open browser
  bingbong --port 8080  Use custom port
```

## Configuration

Server defaults to `http://localhost:3334`. Configure agent hooks via environment:

```bash
BINGBONG_URL=http://localhost:3334
BINGBONG_ENABLED=true
BINGBONG_MACHINE_ID=my-laptop
```

--- 

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
bin/                     # CLI entry point
src/                     # Server source code
client/                  # Web Audio client (single HTML file)
agents/
  claude/hooks/          # Claude Code hook scripts
  cursor/                # Cursor hooks + installer
  opencode/plugins/      # OpenCode plugin
  pi/extensions/         # Pi extension
```

## Future Work
- [ ] Better 3d audio (HRTF, reverb zones)
- [ ] Multiple machine orchestration
- [ ] Use with pi-agent for workflow monitoring
- [ ] Codex integration: Event support is [in development](https://github.com/openai/codex/issues/2109) by the Codex team.
- [ ] Claude Code Web integration: Tentative at best. Would require CCW plugin support of some kind.

## References

- [Claude Code hooks](https://docs.anthropic.com/claude-code/hooks)
- [Cursor hooks](https://docs.cursor.com/advanced/hooks)
- [Pi extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions)
- [OpenCode events](https://opencode.ai/docs/plugins/#events)
