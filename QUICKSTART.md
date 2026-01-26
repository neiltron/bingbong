# Sonicify Quick Start

Get audio monitoring for Claude Code in 5 minutes.

## Prerequisites

- [Bun](https://bun.sh) runtime (or Node.js)
- Claude Code CLI installed
- A modern browser with Web Audio API support

## Step 1: Start the Server

```bash
cd server
bun run index.ts
```

You should see:
```
╔═══════════════════════════════════════════════════╗
║           🎵 Sonicify Server Running 🎵            ║
╠═══════════════════════════════════════════════════╣
║  HTTP Events: http://localhost:3333/events        ║
║  WebSocket:   ws://localhost:3333/ws              ║
║  Sessions:    http://localhost:3333/sessions      ║
╚═══════════════════════════════════════════════════╝
```

## Step 2: Open the Client

Option A: Open directly
```bash
# macOS
open client/index.html

# Linux
xdg-open client/index.html
```

Option B: Serve via HTTP (recommended)
```bash
cd client
python3 -m http.server 8080
# Then open http://localhost:8080
```

## Step 3: Test Without Claude Code

Run the test script to simulate events:
```bash
./test-events.sh
```

You should hear sounds and see particles in the visualizer!

## Step 4: Configure Claude Code Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/full/path/to/sonicify-claude-code/agents/claude/hooks/pre-tool-use.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/full/path/to/sonicify-claude-code/agents/claude/hooks/post-tool-use.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/full/path/to/sonicify-claude-code/agents/claude/hooks/stop.sh"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/full/path/to/sonicify-claude-code/agents/claude/hooks/subagent-stop.sh"
          }
        ]
      }
    ]
  }
}
```

**Important:** Replace `/full/path/to/` with the actual path to this project.

Run `./agents/claude/setup.sh` to see the configuration with your actual paths.

## Step 5: Use Claude Code

Start a new Claude Code session:
```bash
claude
```

Every tool call will now emit a sound. When the agent completes, you'll hear a distinct completion chord.

## Troubleshooting

### No sounds playing?
- Click "Connect" in the browser first
- Make sure server is running on port 3333
- Check browser console for errors
- Click anywhere on the page (browsers require user interaction before playing audio)

### Hooks not firing?
- Verify hook scripts are executable: `chmod +x agents/claude/hooks/*.sh`
- Check paths in settings.json are absolute
- Test manually: `echo '{"session_id":"test"}' | ./agents/claude/hooks/pre-tool-use.sh`

### Server connection failed?
- Verify nothing else is using port 3333
- Check firewall settings
- Try `curl http://localhost:3333/` to verify server is responding

## Sound Mapping

| Tool | Sound Character |
|------|-----------------|
| Read | Quick, soft ping (A4) |
| Write | Slightly longer triangle (E4) |
| Edit | Similar to Write, slightly lower (D4) |
| Bash | Square wave, mechanical (F3) |
| Task (subagent) | Two-note chord (G4+B4) |
| Grep/Glob | Fast, high pings (B4/C5) |
| Stop (completion) | Major triad chord (C+E+G) |

## Next Steps

- Customize sounds in `client/index.html` (SOUND_CONFIG object)
- Run multiple Claude Code sessions to hear spatial separation
- Deploy server for remote machine monitoring
