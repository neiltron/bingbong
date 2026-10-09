import { afterAll, beforeAll, expect, test } from "bun:test";
import { startServer, type StartServerResult } from "@bingbong/server";
import { BingbongClient, sessionKey, type BingbongEvent, type ClientEventMap } from "./index";

let runtime: StartServerResult;
let url: string;
const clients: BingbongClient[] = [];

const silent = { info() {}, error() {}, dispose() {} };

beforeAll(async () => {
  runtime = await startServer({
    port: 0,
    version: "test",
    token: "t",
    createLogger: () => silent as never,
  });
  url = `http://localhost:${runtime.server.port}`;
});

afterAll(() => {
  for (const c of clients) c.disconnect();
  runtime.server.stop(true);
  runtime.dispose();
});

function client(token?: string, reconnect?: boolean): BingbongClient {
  const c = new BingbongClient({ url, token, reconnect });
  clients.push(c);
  return c;
}

function next<K extends keyof ClientEventMap>(c: BingbongClient, name: K): Promise<ClientEventMap[K]> {
  return new Promise((resolve) => {
    const off = c.on(name, (...args) => {
      off();
      resolve(args);
    });
  });
}

const event: BingbongEvent = {
  event_type: "PreToolUse",
  session_id: "s1",
  machine_id: "m1",
  timestamp: "2026-10-08T00:00:00.000Z",
  tool_name: "Bash",
};

test("connects with the token, receives init, then event + session", async () => {
  const c = client("t");
  const init = next(c, "init");
  c.connect();
  await next(c, "connected");
  expect(c.connected).toBe(true);
  expect(await init).toEqual([[]]);

  const gotSession = next(c, "session");
  const gotEvent = next(c, "event");
  const res = await c.emit(event);
  expect(res.status).toBe(200);

  const [session] = await gotSession;
  const [enriched] = await gotEvent;
  expect(enriched.session_id).toBe("s1");
  expect(session).toMatchObject({ session_id: "s1", machine_id: "m1", event_count: 1 });
  // receipt time on the client clock, not the producer's (here backdated) timestamp
  expect(session.last_seen).not.toBe(event.timestamp);
  expect(Date.now() - Date.parse(session.last_seen!)).toBeLessThan(5000);
  expect(session.first_seen).toBe(session.last_seen);
  expect(c.sessions.get(sessionKey("m1", "s1"))).toEqual(session);
});

test("fetchSessions and health use the token", async () => {
  const c = client("t");
  const sessions = await c.fetchSessions();
  expect(sessions.map((s) => s.session_id)).toContain("s1");
  expect((await c.health()).version).toBe("test");
  await expect(client().fetchSessions()).rejects.toThrow("401");
});

test("without the token: reconnecting(true), never connected", async () => {
  const c = client(undefined, false);
  let connected = false;
  c.on("connected", () => (connected = true));
  const reconnecting = next(c, "reconnecting");
  c.connect();
  expect(await reconnecting).toEqual([true]);
  expect(connected).toBe(false);
  expect(c.active).toBe(false);
});

test("disconnect() stops reconnecting", async () => {
  const c = client("t");
  c.connect();
  await next(c, "connected");
  let reconnects = 0;
  c.on("reconnecting", () => reconnects++);
  const disconnected = next(c, "disconnected");
  c.disconnect();
  await disconnected;
  expect(c.active).toBe(false);
  expect(c.connected).toBe(false);
  expect(reconnects).toBe(0);
});

test("options are copied: a shared or frozen object doesn't leak between clients", async () => {
  const seen: (string | null)[] = [];
  const fakeFetch = (async (_url: URL, init: RequestInit) => {
    seen.push(new Headers(init.headers).get("Authorization"));
    return Response.json([]);
  }) as unknown as typeof fetch;
  const shared = { url, token: "t", fetch: fakeFetch };
  const a = new BingbongClient(shared);
  const b = new BingbongClient(Object.freeze({ ...shared }));
  shared.token = "x";
  await a.fetchSessions();
  await b.fetchSessions();
  expect(seen).toEqual(["Bearer t", "Bearer t"]);
});

class FakeWebSocket {
  static last: FakeWebSocket;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }
  send() {}
  close() {}
  deliver(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

test("a malformed frame is ignored without touching the session cache", () => {
  const c = new BingbongClient({ url, WebSocket: FakeWebSocket as never });
  c.connect();
  const ws = FakeWebSocket.last;
  ws.onopen?.();
  ws.deliver({ type: "event", event: { ...event, pan: 0, session_index: 0, color: "#fff" } });
  expect(c.sessions.size).toBe(1);
  expect(() => ws.deliver({ type: "init", sessions: null })).not.toThrow();
  expect(() => ws.deliver({ type: "event", event: { session_id: 1 } })).not.toThrow();
  expect(c.sessions.size).toBe(1);
  c.disconnect();
});

test("a throwing message listener doesn't block bookkeeping or later listeners", async () => {
  const c = client("t");
  c.on("message", () => {
    throw new Error("boom");
  });
  c.connect();
  await next(c, "connected");
  const gotEvent = next(c, "event");
  await c.emit({ ...event, session_id: "s2" });
  expect((await gotEvent)[0].session_id).toBe("s2");
  expect(c.sessions.has(sessionKey("m1", "s2"))).toBe(true);
});

test("a throwing disconnected listener doesn't prevent the retry", async () => {
  const c = client(undefined, false);
  c.on("disconnected", () => {
    throw new Error("boom");
  });
  const reconnecting = next(c, "reconnecting");
  c.connect();
  expect(await reconnecting).toEqual([true]);
});

test("disconnect(); connect() retires the old socket: one connected, no retry", async () => {
  const c = client("t");
  c.connect();
  await next(c, "connected");
  let connects = 0;
  let reconnects = 0;
  c.on("connected", () => connects++);
  c.on("reconnecting", () => reconnects++);
  c.disconnect();
  c.connect();
  await Bun.sleep(1200);
  expect(connects).toBe(1);
  expect(reconnects).toBe(0);
  expect(c.connected).toBe(true);
});

test("moveSource: another client sees the new position", async () => {
  const [a, b] = [client("t"), client("t")];
  for (const c of [a, b]) {
    const init = next(c, "init");
    c.connect();
    await init;
  }
  const moved = next(b, "session");
  a.moveSource({ machine_id: "m1", session_id: "s1" }, 0.2, 0.8);
  const [session] = await moved;
  expect(session).toMatchObject({ session_id: "s1", position: { x: 0.2, y: 0.8 } });
  expect(b.sessions.get(sessionKey("m1", "s1"))?.position).toEqual({ x: 0.2, y: 0.8 });
});
