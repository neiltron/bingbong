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
  expect(session).toMatchObject({ session_id: "s1", machine_id: "m1", event_count: 1, last_seen: event.timestamp });
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
