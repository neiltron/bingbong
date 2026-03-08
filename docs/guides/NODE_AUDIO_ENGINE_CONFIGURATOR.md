# Node Audio Engine Configurator (Exploratory)

## Goal

Run the audio engine in the server process while keeping the browser UI behavior unchanged.

- Browser: radar visualization + draggable session positions + control sliders
- Server: event-to-sound mapping, synthesis, and parameter application

## Architecture

```
Agent hooks -> POST /events -> Server session enrich + server audio engine -> local speaker output
                                                |
                                                +-> WebSocket /ws -> Browser visualizer/configurator
```

## Client -> Server Control Messages

The browser is a configurator and sends explicit messages over WebSocket:

### Global audio

```json
{
  "type": "audio_config:update",
  "config": {
    "volume": 0.7,
    "reverb": 0.3,
    "muted": false
  }
}
```

### Per-session position

```json
{
  "type": "session_config:update",
  "session_key": "machine-id:session-id",
  "position": {
    "x": 0.62,
    "y": 0.35
  }
}
```

## Server Init Payload

On websocket connect, server sends:

- `sessions`: current active sessions
- `audio_config`: current server config
- `session_positions`: known per-session positions
- `audio_engine`: availability details (`enabled`, `reason`, `player`)

## Runtime Requirements

The exploratory server audio engine writes temporary WAV files and uses a local command:

- macOS: `afplay`
- Linux: `ffplay` or `aplay`

If none are present, the UI still runs and shows `Connected (server audio unavailable)`.

## Local Run

```bash
bun install
bun run start
```

Then open `http://localhost:3334`, click **Connect**, and run:

```bash
./test-events.sh
```

## Notes / Limits

- This is an exploratory vertical slice, not a final production mixer.
- Reverb is a lightweight synthesized wet tail, not a full convolution pipeline.
- Session positions are browser-persisted and forwarded to server while connected.
