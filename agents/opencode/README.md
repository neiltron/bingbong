# OpenCode Integration

This directory contains the OpenCode plugin that emits Bingbong events.

## Install

```bash
bingbong install-hooks opencode
```

This installs the plugin globally to `~/.config/opencode/plugins/bingbong.js`.

## Configuration

Optional environment variables (read by the plugin at runtime):

- `BINGBONG_URL` (default: `http://localhost:3334`)
- `BINGBONG_ENABLED` (`false` disables all events)
- `BINGBONG_MACHINE_ID` (override hostname)

## Event mapping

See [docs/agents/event-coverage.md](../../docs/agents/event-coverage.md) for the
full mapping of OpenCode bus events to Bingbong event types.
