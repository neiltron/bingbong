# pi-coding-agent Integration

This directory contains the global extension for pi-coding-agent.

## Install (global)

```bash
./agents/pi/install.sh
```

## Configuration

The installer accepts environment variables:

- `PI_EXTENSIONS_DIR` (default: `~/.pi/agent/extensions`)
- `SONICIFY_URL` (default: `http://localhost:3333`)
- `SONICIFY_HOST` and `SONICIFY_PORT` (used to build `SONICIFY_URL`)

Example:

```bash
SONICIFY_HOST=127.0.0.1 SONICIFY_PORT=3333 ./agents/pi/install.sh
```
