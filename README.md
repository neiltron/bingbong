# Bingbong

Soundscapes for coding agents. Transform AI agent sessions into spatial audio feedback.

## What is this?

Bingbong turns AI coding agent activity into spatial audio feedback. Each tool and action produces distinct sounds, sessions are positioned in stereo space, and you can monitor agent activity without visual attention.

**Supported agents:** Claude Code, Cursor, OpenCode, Pi

## Prerequisites

For binary install:
- `curl`
- `tar`

For source fallback install:
- [Bun](https://bun.sh)
- `git`

## Quick Start

**1. Install bingbong (no npm):**

```bash
curl -fsSL https://raw.githubusercontent.com/neiltron/bingbong/main/scripts/install.sh | bash
```

This installs:
- `bingbong` to `~/.local/bin` (preferred) or `/usr/local/bin` when writable
- embedded client assets inside the standalone binary

Then verify:

```bash
bingbong --help
```

**2. Run bingbong:**

```bash
bingbong --open
```

The client is served at `http://localhost:3334`. Click "Connect" to start.

**3. Install agent hooks:**

| Agent | Installation |
|-------|-------------|
| **Claude Code** | `bingbong install-hooks claude` |
| **Cursor** | `bingbong install-hooks cursor` |
| **OpenCode** | `bingbong install-hooks opencode` |
| **Pi** | `bingbong install-hooks pi` |

**4. Test it out** — every action and tool use should produce a sound.

```bash
./test-events.sh
```

## Source Install (Fallback)

If no matching prebuilt binary is available, the installer falls back to source build automatically.

You can also run from source directly:

```bash
git clone https://github.com/neiltron/bingbong
cd bingbong
bun install
bun run start
```

## CLI Options

```
bingbong [options]
bingbong <command> [options]

Commands:
  emit <EventType>       Emit an event to the bingbong server (used by hooks)
  install-hooks <agent>  Install bingbong hooks for a coding agent

Options:
  -p, --port <number>  Port to run server on (default: 3334)
  -o, --open           Open browser automatically
  -h, --help           Show help message
  -v, --version        Show version number

Examples:
  bingbong                        Start server on port 3334
  bingbong --open                 Start and open browser
  bingbong install-hooks cursor   Install Cursor hooks
```

## Configuration

Server defaults to `http://localhost:3334`. Configure agent hooks via environment:

```bash
BINGBONG_URL=http://localhost:3334
BINGBONG_ENABLED=true
BINGBONG_MACHINE_ID=my-laptop
BINGBONG_SERVER_AUDIO=true
```

--- 

## Troubleshooting

**No sounds?**
- Click "Connect" in browser
- Verify server is running on port 3334
- Check server logs for `[Audio] Server audio enabled (...)`
- Ensure your machine has a supported playback command (`afplay` on macOS, `aplay` on Linux)

**Hooks not firing?**
- Re-run `bingbong install-hooks <agent>` to refresh config
- Test manually: `echo '{"session_id":"test"}' | bingbong emit PreToolUse`

**`bingbong` command not found?**
- Add install dir to PATH (usually `~/.local/bin`):
  - `export PATH="$HOME/.local/bin:$PATH"`
- Restart your shell and run `bingbong --help`

**Server connection failed?**
- Check nothing else is using port 3334
- Verify server is running: `curl http://localhost:3334/`

## Architecture

Simple three-tier design:

**Agent Hooks** → emit events via HTTP → **Server** (session tracking, spatial assignment, audio synthesis/playback) → WebSocket → **Client** (visualizer + audio config transport)

Each agent has hooks that fire on tool use, session start/stop, and other events. The browser remains a visual configurator (radar UI and controls), while the server owns audio rendering and playback.

### Audio Config Protocol

Browser-to-server updates are sent over the existing WebSocket connection using versioned message types:

- `audio_config.replace` - full snapshot on connect
- `audio_config.patch` - incremental updates for volume/reverb/mute and session positions

Payload shape:

```json
{
  "type": "audio_config.patch",
  "version": 1,
  "payload": {
    "global": { "volume": 0.7, "reverb": 0.3, "muted": false },
    "session_positions": {
      "machine-a:session-123": { "x": 0.42, "y": 0.61 }
    }
  }
}
```

Inspect current server-side state:

```bash
curl http://localhost:3334/audio-config
```

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
client/                  # Web Audio client (Vite build)
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
