import { describe, expect, it } from "bun:test";
import { ServerAudioEngine } from "./server-audio-engine";

describe("ServerAudioEngine config handling", () => {
  it("replaces and patches config snapshots", () => {
    const engine = new ServerAudioEngine();

    engine.replaceConfig({
      global: {
        volume: 0.2,
        reverb: 0.8,
        muted: true,
      },
      session_positions: {
        "machine:session-a": { x: 0.1, y: 0.9 },
      },
    });

    engine.patchConfig({
      global: { muted: false },
      session_positions: {
        "machine:session-a": null,
        "machine:session-b": { x: 0.3, y: 0.7 },
      },
    });

    expect(engine.getConfigSnapshot()).toEqual({
      global: {
        volume: 0.2,
        reverb: 0.8,
        muted: false,
      },
      session_positions: {
        "machine:session-b": { x: 0.3, y: 0.7 },
      },
    });
  });

  it("is safe to call playEvent before init", () => {
    const engine = new ServerAudioEngine();
    expect(() =>
      engine.playEvent({
        event_type: "Stop",
        tool_name: "",
        pan: 0,
        machine_id: "machine",
        session_id: "session",
      })
    ).not.toThrow();
  });
});
