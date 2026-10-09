import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { PROTOCOL_VERSION, type BingbongEvent } from "@bingbong/protocol";
import { BingbongHub, type HubClient } from "./hub";
import { SessionRegistry } from "./session-registry";

const event = (session_id: string): BingbongEvent => ({
  event_type: "PreToolUse",
  session_id,
  machine_id: "m1",
  timestamp: new Date().toISOString(),
  cwd: "/work/repo",
  tool_name: "Bash",
});

const recorder = () => {
  const sent: any[] = [];
  const client: HubClient = { send: (data) => sent.push(JSON.parse(data)) };
  return { client, sent };
};

const req = (method: string, path: string, body?: string) =>
  new Request(`http://hub${path}`, { method, body });

describe("BingbongHub", () => {
  afterEach(() => setSystemTime());

  test("ingest enriches, broadcasts, and drops a throwing client", () => {
    const hub = new BingbongHub({ version: "t" });
    const a = recorder();
    const b = recorder();
    hub.addClient(a.client);
    hub.addClient(b.client);
    hub.addClient({ send: (d) => { if (d.includes('"event"')) throw new Error("gone"); } });
    expect(hub.clientCount).toBe(3);

    const enriched = hub.ingest(event("s1"));
    expect(enriched.session_label).toBe("repo");
    expect(enriched.session_index).toBe(0);
    expect(a.sent[1]).toEqual({ type: "event", event: enriched });
    expect(b.sent[1]).toEqual({ type: "event", event: enriched });
    expect(hub.clientCount).toBe(2);
  });

  test("addClient sends init with protocol version and sessions", () => {
    const hub = new BingbongHub({ version: "t" });
    hub.ingest(event("s1"));
    const a = recorder();
    hub.addClient(a.client);
    expect(a.sent[0].type).toBe("init");
    expect(a.sent[0].protocol_version).toBe(PROTOCOL_VERSION);
    expect(a.sent[0].sessions.map((s: any) => s.session_id)).toEqual(["s1"]);
    hub.removeClient(a.client);
    expect(hub.clientCount).toBe(0);
  });

  test("fetch routes", async () => {
    const hub = new BingbongHub({ version: "9.9.9" });

    const ok = await hub.fetch(req("POST", "/events", JSON.stringify(event("s1"))));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const bad = await hub.fetch(req("POST", "/events", "{nope"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid JSON" });

    const sessions = await (await hub.fetch(req("GET", "/sessions"))).json();
    expect(sessions.map((s: any) => s.label)).toEqual(["repo"]);

    expect(await (await hub.fetch(req("GET", "/health"))).json()).toEqual({
      name: "Bingbong Server",
      version: "9.9.9",
      sessions: 1,
      clients: 0,
    });

    const opts = await hub.fetch(req("OPTIONS", "/events"));
    expect(opts.status).toBe(200);
    expect(opts.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(opts.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");

    const missing = await hub.fetch(req("GET", "/ws"));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
  });

  test("token guards /events and /sessions, leaves /health open", async () => {
    const hub = new BingbongHub({ version: "t", token: "s3cret" });
    const body = JSON.stringify(event("s1"));
    const bearer = (method: string, path: string, b?: string, token = "s3cret") =>
      new Request(`http://hub${path}`, { method, body: b, headers: { Authorization: `Bearer ${token}` } });

    const denied = await hub.fetch(req("POST", "/events", body));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await hub.fetch(req("GET", "/sessions"))).status).toBe(401);
    expect((await hub.fetch(bearer("POST", "/events", body, "wrong"))).status).toBe(401);

    expect((await hub.fetch(bearer("POST", "/events", body))).status).toBe(200);
    expect((await hub.fetch(bearer("GET", "/sessions"))).status).toBe(200);
    expect((await hub.fetch(req("POST", "/events?token=s3cret", body))).status).toBe(200);
    expect((await hub.fetch(req("GET", "/sessions?token=s3cret"))).status).toBe(200);

    expect((await hub.fetch(req("GET", "/health"))).status).toBe(200);
    expect((await hub.fetch(req("OPTIONS", "/events"))).status).toBe(200);

    expect(hub.authorized(req("GET", "/ws?token=s3cret"))).toBe(true);
    expect(hub.authorized(req("GET", "/ws?token=s3cre"))).toBe(false);
    expect(hub.authorized(req("GET", "/ws"))).toBe(false);
    expect(new BingbongHub({ version: "t" }).authorized(req("GET", "/ws"))).toBe(true);
  });

  test("a client whose init send throws is dropped, not propagated", () => {
    const errors: string[] = [];
    const hub = new BingbongHub({
      version: "t",
      logger: { info() {}, error: (m) => errors.push(m) },
    });
    expect(() =>
      hub.addClient({ send: () => { throw new Error("gone"); } }),
    ).not.toThrow();
    expect(hub.clientCount).toBe(0);
    expect(errors).toEqual(["[WS] Failed to send:"]);
  });

  describe("lazy pruning", () => {
    const min = 60 * 1000;
    afterEach(() => setSystemTime());

    test("prunes stale sessions lazily, at most once per 60s", () => {
      const t0 = Date.now();
      setSystemTime(t0);
      const logs: string[] = [];
      const hub = new BingbongHub({
        version: "t",
        logger: { info: (m) => logs.push(m), error() {} },
      });
      hub.ingest(event("s1"));

      setSystemTime(t0 + 29.5 * min); // prune runs, session not yet stale
      hub.addClient(recorder().client);
      expect(hub.registry.snapshots()).toHaveLength(1);

      setSystemTime(t0 + 30 * min + 10_000); // stale, but only 40s since last prune
      hub.addClient(recorder().client);
      expect(hub.registry.snapshots()).toHaveLength(1);

      setSystemTime(t0 + 30.5 * min); // 60s since last prune
      hub.addClient(recorder().client);
      expect(hub.registry.snapshots()).toHaveLength(0);
      expect(logs).toContain("[Session] Removing stale session: m1:s1");
    });

    test("a session ingested after a clock jump is not pruned as stale", () => {
      const t0 = Date.now();
      setSystemTime(t0);
      const hub = new BingbongHub({ version: "t" });
      hub.ingest(event("old"));

      setSystemTime(t0 + 31 * min);
      hub.addClient(recorder().client);
      expect(hub.registry.snapshots()).toHaveLength(0);

      hub.ingest(event("fresh"));
      setSystemTime(t0 + 32 * min);
      hub.addClient(recorder().client);
      expect(hub.registry.snapshots().map((s) => s.session_id)).toEqual(["fresh"]);
    });
  });

  test("onChange fires after ingest and after a pruning addClient, not on a plain addClient", () => {
    const min = 60 * 1000;
    const t0 = Date.now();
    setSystemTime(t0);
    let changes = 0;
    const hub = new BingbongHub({ version: "t", onChange: () => changes++ });

    hub.addClient(recorder().client);
    expect(changes).toBe(0);

    hub.ingest(event("s1"));
    hub.ingest(event("s1"));
    expect(changes).toBe(2);

    setSystemTime(t0 + 29.5 * min); // prune runs but removes nothing
    hub.addClient(recorder().client);
    expect(changes).toBe(2);

    setSystemTime(t0 + 31 * min); // prune removes s1
    hub.addClient(recorder().client);
    expect(hub.registry.snapshots()).toHaveLength(0);
    expect(changes).toBe(3);
  });

  test("a freshly constructed hub prunes on its first activity (Durable Object wake)", () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const registry = SessionRegistry.fromJSON({
      counter: 1,
      sessions: [
        { session_id: "stale", machine_id: "m1", label: "old", pan: 0, index: 0, color: "#FF6B6B", event_count: 1, first_seen: old, last_seen: old },
      ],
    });
    const hub = new BingbongHub({ version: "t", registry });
    hub.ingest(event("fresh"));
    expect(hub.registry.snapshots().map((s) => s.session_id)).toEqual(["fresh"]);
  });

  test("addClient with sendInit: false sends nothing but still receives broadcasts", () => {
    const hub = new BingbongHub({ version: "t" });
    const a = recorder();
    hub.addClient(a.client, { sendInit: false });
    expect(a.sent).toEqual([]);
    const enriched = hub.ingest(event("s1"));
    expect(a.sent).toEqual([{ type: "event", event: enriched }]);
  });

  test("move_source updates the snapshot, broadcasts session_update to every client, fires onChange", () => {
    let changes = 0;
    const hub = new BingbongHub({ version: "t", onChange: () => changes++ });
    hub.ingest(event("s1"));
    const a = recorder();
    const b = recorder();
    hub.addClient(a.client);
    hub.addClient(b.client);
    expect(a.sent[0].protocol_version).toBe(2);
    expect(a.sent[0].sessions[0].position).toEqual({ x: 0.5, y: 0.5 });

    const move = { type: "move_source", machine_id: "m1", session_id: "s1", x: 0.2, y: 1.5 };
    hub.handleMessage(a.client, JSON.stringify(move));
    const session = hub.registry.snapshots()[0];
    expect(session.position).toEqual({ x: 0.2, y: 1 });
    expect(a.sent[1]).toEqual({ type: "session_update", session });
    expect(b.sent[1]).toEqual({ type: "session_update", session });
    expect(changes).toBe(2);

    // binary frames decode the same way
    hub.handleMessage(a.client, new TextEncoder().encode(JSON.stringify({ ...move, x: 0.7 })));
    expect(hub.registry.snapshots()[0].position).toEqual({ x: 0.7, y: 1 });
    expect(changes).toBe(3);
  });

  test("malformed, unknown, or unmatched messages don't throw or broadcast", () => {
    let changes = 0;
    const logs: string[] = [];
    const hub = new BingbongHub({
      version: "t",
      onChange: () => changes++,
      logger: { info: (m) => logs.push(m), error() {} },
    });
    hub.ingest(event("s1"));
    const a = recorder();
    hub.addClient(a.client);
    for (const raw of ["garbage", "null", "42", '{"type":"nope"}', "{}"]) {
      expect(() => hub.handleMessage(a.client, raw)).not.toThrow();
    }
    hub.handleMessage(a.client, JSON.stringify({ type: "move_source", machine_id: "m1", session_id: "zz", x: 0, y: 0 }));
    hub.handleMessage(a.client, JSON.stringify({ type: "move_source", machine_id: "m1", session_id: "s1", x: "a", y: 0 }));
    // non-string ids: an array would coerce into "m1:s1", a toString-less object would throw
    hub.handleMessage(a.client, JSON.stringify({ type: "move_source", machine_id: ["m1"], session_id: "s1", x: 0.1, y: 0.1 }));
    hub.handleMessage(a.client, JSON.stringify({ type: "move_source", machine_id: "m1", session_id: ["s1"], x: 0.1, y: 0.1 }));
    const noString = '{"type":"move_source","machine_id":{"toString":null},"session_id":"s1","x":0.1,"y":0.1}';
    expect(() => hub.handleMessage(a.client, noString)).not.toThrow();
    expect(hub.registry.snapshots()[0].position).toEqual({ x: 0.5, y: 0.5 });
    expect(a.sent).toHaveLength(1); // init only
    expect(changes).toBe(1);
    expect(logs).toContain("[WS] Received: garbage");
    expect(logs).toContain('[WS] Received: {"type":"nope"}');
  });
});
