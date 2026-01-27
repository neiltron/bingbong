# OpenCode Integration

This directory contains the OpenCode plugin that emits Bingbong events.

## Install (project)

1. Create the OpenCode plugin directory in your repo:

```bash
mkdir -p .opencode/plugins
```

2. Copy the plugin:

```bash
cp agents/opencode/plugins/bingbong.js .opencode/plugins/bingbong.js
```

## Install (system-wide)

1. Create the global plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
```

2. Copy the plugin:

```bash
cp agents/opencode/plugins/bingbong.js ~/.config/opencode/plugins/bingbong.js
```

## Configuration

Optional environment variables:

- `BINGBONG_URL` (default: `http://localhost:3333`)
- `BINGBONG_ENABLED` (`false` disables all events)
- `BINGBONG_MACHINE_ID` (override hostname)
