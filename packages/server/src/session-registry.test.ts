import { describe, expect, test } from "bun:test";
import type { BingbongEvent } from "@bingbong/protocol";
import { SessionRegistry, type RegistryState } from "./session-registry";

const event = (session_id: string, cwd?: string): BingbongEvent => ({
  event_type: "PreToolUse",
  session_id,
  machine_id: "m1",
  timestamp: new Date().toISOString(),
  cwd,
});

describe("SessionRegistry toJSON/fromJSON", () => {
  test("round-trips sessions, continues the counter, keeps label semantics", () => {
    const original = new SessionRegistry();
    original.enrich(event("s1", "/work/repo"));
    original.enrich(event("s2-abcdefgh")); // id-fallback label, no cwd yet
    original.enrich(event("s1", "/work/repo"));

    const restored = SessionRegistry.fromJSON(
      JSON.parse(JSON.stringify(original)) as RegistryState,
    );
    expect(restored.snapshots()).toEqual(original.snapshots());
    expect(restored.toJSON()).toEqual(original.toJSON());

    // counter continues: next session gets index 2 and the third colour
    const s3 = restored.enrich(event("s3", "/work/repo")).event;
    expect(s3.session_index).toBe(2);
    expect(s3.color).toBe("#45B7D1");
    expect(s3.session_label).toBe("repo (2)"); // dedupes against restored "repo"

    // id-fallback label still upgrades once a cwd arrives; cwd label does not change
    expect(restored.enrich(event("s2-abcdefgh", "/work/other")).event.session_label).toBe("other");
    expect(restored.enrich(event("s1", "/work/elsewhere")).event.session_label).toBe("repo");
  });

  test("bad or missing input gives an empty registry", () => {
    for (const bad of [undefined, null, {}, { counter: "x", sessions: "nope" }, "junk", 42]) {
      const r = SessionRegistry.fromJSON(bad as any);
      expect(r.snapshots()).toEqual([]);
      expect(r.enrich(event("s1", "/w/a")).event.session_index).toBe(0);
    }
  });

  test("drops malformed session entries", () => {
    const r = SessionRegistry.fromJSON({
      counter: 1,
      sessions: [null, { session_id: "x" }, { session_id: "y", machine_id: "m", index: 0, last_seen: "nope" }] as any,
    });
    expect(r.snapshots()).toEqual([]);
    expect(r.enrich(event("s1")).event.session_index).toBe(1);
  });
});
