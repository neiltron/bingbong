# pi-coding-agent Integration

This directory contains the global extension for pi
(`@earendil-works/pi-coding-agent`, formerly `@mariozechner/pi-coding-agent`).

## Install (global)

```bash
bingbong install-hooks pi
```

This installs the extension to `~/.pi/agent/extensions/bingbong.ts`.

## Configuration

The installer accepts environment variables:

- `PI_EXTENSIONS_DIR` (default: `~/.pi/agent/extensions`)
- `BINGBONG_URL` (default: `http://localhost:3334`, baked into the installed file)

At runtime the extension also reads:

- `BINGBONG_URL` (overrides the baked-in URL)
- `BINGBONG_ENABLED` (`false` disables all events)
- `BINGBONG_MACHINE_ID` (override hostname)

## Event mapping

See [agents/event-coverage.md](../../agents/event-coverage.md) for the
full mapping of pi extension events to Bingbong event types.
