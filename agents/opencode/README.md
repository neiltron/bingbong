# OpenCode Integration

This directory contains the OpenCode plugin that emits Sonicify events.

## Install (project)

1. Create the OpenCode plugin directory in your repo:

```bash
mkdir -p .opencode/plugins
```

2. Copy the plugin:

```bash
cp agents/opencode/plugins/sonicify.js .opencode/plugins/sonicify.js
```

## Install (system-wide)

1. Create the global plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
```

2. Copy the plugin:

```bash
cp agents/opencode/plugins/sonicify.js ~/.config/opencode/plugins/sonicify.js
```

## Configuration

Optional environment variables:

- `SONICIFY_URL` (default: `http://localhost:3333`)
- `SONICIFY_ENABLED` (`false` disables all events)
- `SONICIFY_MACHINE_ID` (override hostname)
