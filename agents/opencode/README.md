# OpenCode Integration

This directory contains the OpenCode plugin that emits Bingbong events.

## Install

```bash
./agents/opencode/install.sh
```

This installs the plugin globally to `~/.config/opencode/plugins/`.

## Configuration

Optional environment variables:

- `BINGBONG_URL` (default: `http://localhost:3333`)
- `BINGBONG_ENABLED` (`false` disables all events)
- `BINGBONG_MACHINE_ID` (override hostname)
