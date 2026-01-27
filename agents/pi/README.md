# pi-coding-agent Integration

This directory contains the global extension for pi-coding-agent.

## Install (global)

```bash
./agents/pi/install.sh
```

## Configuration

The installer accepts environment variables:

- `PI_EXTENSIONS_DIR` (default: `~/.pi/agent/extensions`)
- `BINGBONG_URL` (default: `http://localhost:3333`)
- `BINGBONG_HOST` and `BINGBONG_PORT` (used to build `BINGBONG_URL`)

Example:

```bash
BINGBONG_HOST=127.0.0.1 BINGBONG_PORT=3333 ./agents/pi/install.sh
```
