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

  test("rejects negative/unsafe indexes and counters, non-string dates", () => {
    const iso = new Date().toISOString();
    const entry = (session_id: string, extra: object) =>
      ({ session_id, machine_id: "m", index: 0, first_seen: iso, last_seen: iso, ...extra });

    const r = SessionRegistry.fromJSON({
      counter: -1,
      sessions: [
        entry("neg", { index: -1 }),
        entry("unsafe", { index: Number.MAX_SAFE_INTEGER }),
        entry("bigint", { first_seen: 1n }),
        entry("numeric", { last_seen: Date.now() }),
      ] as any,
    });
    expect(r.snapshots()).toEqual([]);
    const first = r.enrich(event("s1")).event;
    expect(first.session_index).toBe(0);
    expect(first.color).toBe("#FF6B6B");

    const big = SessionRegistry.fromJSON({ counter: 2 ** 53, sessions: [] });
    expect(big.enrich(event("a")).event.session_index).toBe(0);
    expect(big.enrich(event("b")).event.session_index).toBe(1);
  });
});

describe("SessionRegistry parent_session_id", () => {
  test("is carried into the snapshot and survives a round-trip", () => {
    const r = new SessionRegistry();
    r.enrich(event("root"));
    r.enrich({ ...event("child"), parent_session_id: "root" });
    const child = r.snapshots().find((s) => s.session_id === "child");
    expect(child?.parent_session_id).toBe("root");
    const restored = SessionRegistry.fromJSON(JSON.parse(JSON.stringify(r)));
    expect(restored.snapshots().find((s) => s.session_id === "child")?.parent_session_id).toBe("root");
    expect(restored.snapshots().find((s) => s.session_id === "root")?.parent_session_id).toBeUndefined();
  });

  test("enriched events carry the first-sight parent, matching the snapshot", () => {
    const r = new SessionRegistry();
    r.enrich(event("late"));
    expect(r.enrich({ ...event("late"), parent_session_id: "root" }).event.parent_session_id).toBeUndefined();
    expect(r.snapshots().find((s) => s.session_id === "late")?.parent_session_id).toBeUndefined();

    r.enrich({ ...event("child"), parent_session_id: "root" });
    expect(r.enrich({ ...event("child"), parent_session_id: "changed" }).event.parent_session_id).toBe("root");
    expect(r.snapshots().find((s) => s.session_id === "child")?.parent_session_id).toBe("root");
  });
});

describe("SessionRegistry positions", () => {
  // the web client's PositionManager.autoAssign, verbatim
  const legacy = (index: number) => {
    if (index === 0) return { x: 0.5, y: 0.5 };
    const angle = (index * 137.5 * Math.PI) / 180;
    const radius = 0.15 + Math.ceil(Math.sqrt(index)) * 0.1;
    return {
      x: Math.max(0.1, Math.min(0.9, 0.5 + Math.cos(angle) * radius)),
      y: Math.max(0.1, Math.min(0.9, 0.5 + Math.sin(angle) * radius)),
    };
  };

  test("auto-assigns the golden-angle spiral by index, in snapshots and events", () => {
    const r = new SessionRegistry();
    for (let i = 0; i < 4; i++) {
      expect(r.enrich(event(`s${i}`)).event.position).toEqual(legacy(i));
    }
    expect(r.snapshots().map((s) => s.position)).toEqual([0, 1, 2, 3].map(legacy));
    expect(r.snapshots()[0].position).toEqual({ x: 0.5, y: 0.5 });
  });

  test("setPosition clamps, rejects non-finite and unknown sessions", () => {
    const r = new SessionRegistry();
    r.enrich(event("s1"));
    expect(r.setPosition("m1", "s1", 0.2, 0.8)?.position).toEqual({ x: 0.2, y: 0.8 });
    expect(r.setPosition("m1", "s1", -3, 7)?.position).toEqual({ x: 0, y: 1 });
    expect(r.setPosition("m1", "s1", NaN, 0.5)).toBeNull();
    expect(r.setPosition("m1", "s1", 0.5, Infinity)).toBeNull();
    expect(r.setPosition("m1", "s1", "0.5" as any, 0.5)).toBeNull();
    expect(r.setPosition("m1", "nope", 0.5, 0.5)).toBeNull();
    expect(r.setPosition("m2", "s1", 0.5, 0.5)).toBeNull();
    expect(r.snapshots()[0].position).toEqual({ x: 0, y: 1 });
    expect(r.enrich(event("s1")).event.position).toEqual({ x: 0, y: 1 });
  });

  test("returned positions are copies, not the live object", () => {
    const r = new SessionRegistry();
    r.enrich(event("s1")).event.position.x = 0.9;
    r.snapshots()[0].position.x = 0.9;
    r.toJSON().sessions[0].position.y = 0.9;
    expect(r.snapshots()[0].position).toEqual({ x: 0.5, y: 0.5 });
    r.setPosition("m1", "s1", 0.2, 0.3)!.position.x = 0.9;
    expect(r.snapshots()[0].position).toEqual({ x: 0.2, y: 0.3 });
    r.toJSON().sessions[0].position.y = 0.9;
    expect(r.enrich(event("s1")).event.position).toEqual({ x: 0.2, y: 0.3 });
  });

  test("moved positions survive a round-trip; old state without one re-derives from index", () => {
    const r = new SessionRegistry();
    r.enrich(event("s1"));
    r.enrich(event("s2"));
    r.setPosition("m1", "s2", 0.3, 0.4);
    const state = JSON.parse(JSON.stringify(r)) as RegistryState;
    expect(SessionRegistry.fromJSON(state).snapshots()).toEqual(r.snapshots());

    for (const s of state.sessions) delete (s as any).position;
    state.sessions[0].position = { x: "bad" } as any;
    const restored = SessionRegistry.fromJSON(state).snapshots();
    expect(restored.map((s) => s.position)).toEqual([legacy(0), legacy(1)]);
  });
});
