import { describe, expect, it } from "bun:test";
import {
  applyAudioConfigPatch,
  createDefaultAudioConfigSnapshot,
  parseClientAudioConfigMessage,
} from "./audio-protocol";

describe("audio config protocol parsing", () => {
  it("parses replace messages and normalizes values", () => {
    const parsed = parseClientAudioConfigMessage(
      JSON.stringify({
        type: "audio_config.replace",
        version: 1,
        payload: {
          global: {
            volume: 1.8,
            reverb: -0.2,
            muted: 1,
          },
          session_positions: {
            "machine:session-a": { x: 1.4, y: 0.2 },
            "machine:session-b": { x: 0.4, y: "oops" },
          },
        },
      })
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("replace");
    if (!parsed || parsed.type !== "replace") return;

    expect(parsed.payload.global).toEqual({
      volume: 1,
      reverb: 0,
      muted: true,
    });

    expect(parsed.payload.session_positions["machine:session-a"]).toEqual({
      x: 1,
      y: 0.2,
    });

    expect(parsed.payload.session_positions["machine:session-b"]).toEqual({
      x: 0.4,
      y: 0.5,
    });
  });

  it("parses patch messages with add/remove session updates", () => {
    const parsed = parseClientAudioConfigMessage(
      JSON.stringify({
        type: "audio_config.patch",
        version: 1,
        payload: {
          global: {
            volume: 0.45,
          },
          session_positions: {
            "machine:session-a": { x: 0.1, y: 0.9 },
            "machine:session-b": null,
            bad: "oops",
          },
        },
      })
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("patch");
    if (!parsed || parsed.type !== "patch") return;

    expect(parsed.payload).toEqual({
      global: { volume: 0.45 },
      session_positions: {
        "machine:session-a": { x: 0.1, y: 0.9 },
        "machine:session-b": null,
      },
    });
  });

  it("rejects unknown protocol versions", () => {
    const parsed = parseClientAudioConfigMessage(
      JSON.stringify({
        type: "audio_config.patch",
        version: 2,
        payload: {
          global: { volume: 0.5 },
        },
      })
    );

    expect(parsed).toBeNull();
  });
});

describe("audio config patch application", () => {
  it("applies global updates and removes positions", () => {
    const starting = createDefaultAudioConfigSnapshot();
    starting.session_positions["machine:session-a"] = { x: 0.2, y: 0.4 };
    starting.session_positions["machine:session-b"] = { x: 0.8, y: 0.6 };

    const next = applyAudioConfigPatch(starting, {
      global: { muted: true, reverb: 0.9 },
      session_positions: {
        "machine:session-a": null,
        "machine:session-c": { x: 0.5, y: 0.5 },
      },
    });

    expect(next.global).toEqual({
      volume: 0.7,
      reverb: 0.9,
      muted: true,
    });

    expect(next.session_positions).toEqual({
      "machine:session-b": { x: 0.8, y: 0.6 },
      "machine:session-c": { x: 0.5, y: 0.5 },
    });
  });
});
