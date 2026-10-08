/**
 * Headless bingbong client: WebSocket subscription with backoff, a live
 * session map, and the HTTP routes (emit, sessions, health). No DOM, so it
 * runs in browsers, mobile web apps, Bun and Node alike.
 */

import type {
  BingbongEvent,
  EnrichedEvent,
  HealthResponse,
  ServerMessage,
  SessionSnapshot,
} from "@bingbong/protocol";

export * from "@bingbong/protocol";

export interface ClientOptions {
  /** http(s)://host[:port] of the server; the ws(s) URL is derived from it */
  url: string;
  token?: string;
  /** default true: exponential backoff capped at 30s */
  reconnect?: boolean;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
}

export type ClientEventMap = {
  connected: [];
  disconnected: [];
  /** neverOpened: the socket closed before open, e.g. a 401 on the upgrade or the server being down */
  reconnecting: [neverOpened: boolean];
  init: [sessions: SessionSnapshot[]];
  event: [event: EnrichedEvent];
  session: [session: SessionSnapshot];
  message: [raw: ServerMessage];
};

type Listener<K extends keyof ClientEventMap> = (...args: ClientEventMap[K]) => void;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasIds(v: unknown): boolean {
  return isObject(v) && typeof v.session_id === "string" && typeof v.machine_id === "string";
}

/** enough shape to update the session map without throwing halfway through */
function isValidMessage(m: unknown): m is ServerMessage {
  if (!isObject(m) || typeof m.type !== "string") return false;
  if (m.type === "init") return Array.isArray(m.sessions) && m.sessions.every(hasIds);
  if (m.type === "event") return hasIds(m.event);
  return true;
}

/** same key the server registry uses */
export function sessionKey(machineId: string, sessionId: string): string {
  return `${machineId}:${sessionId}`;
}

export class BingbongClient {
  readonly sessions = new Map<string, SessionSnapshot>();
  private readonly opts: ClientOptions;
  private readonly listeners = new Map<keyof ClientEventMap, Set<Function>>();
  private ws: WebSocket | null = null;
  private shouldConnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ClientOptions) {
    // a copy: the caller's object may be shared between clients or frozen
    this.opts = { ...opts };
  }

  get connected(): boolean {
    return this.ws?.readyState === 1; // WebSocket.OPEN
  }

  /** connected or trying to (i.e. not user-disconnected) */
  get active(): boolean {
    return this.shouldConnect;
  }

  connect(): void {
    this.shouldConnect = true;
    this.reconnectAttempts = 0;
    this.clearTimer();
    this.openWebSocket();
  }

  /** used by the next connect() and request */
  setToken(token: string): void {
    this.opts.token = token;
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.clearTimer();
    const ws = this.ws;
    if (!ws) return;
    // detach first so a late close/message from the retired socket can't touch the next connection
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
    this.ws = null;
    this.fire("disconnected");
  }

  on<K extends keyof ClientEventMap>(name: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** POST /events: the "embed the emitter" path */
  emit(event: BingbongEvent): Promise<Response> {
    return this.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  }

  async fetchSessions(): Promise<SessionSnapshot[]> {
    return this.json("/sessions");
  }

  async health(): Promise<HealthResponse> {
    return this.json("/health");
  }

  private fire<K extends keyof ClientEventMap>(name: K, ...args: ClientEventMap[K]): void {
    for (const fn of this.listeners.get(name) ?? []) {
      // one throwing observer must not stall bookkeeping, later listeners or the retry timer
      try {
        (fn as Listener<K>)(...args);
      } catch (e) {
        console.error(`[bingbong] "${name}" listener threw:`, e);
      }
    }
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.opts.token) headers.set("Authorization", `Bearer ${this.opts.token}`);
    return (this.opts.fetch ?? fetch)(new URL(path, this.opts.url), { ...init, headers });
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.request(path);
    if (!res.ok) throw new Error(`[bingbong] GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  private openWebSocket(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    const url = new URL("/ws", this.opts.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // query, not a header: browsers can't set headers on the upgrade
    if (this.opts.token) url.searchParams.set("token", this.opts.token);
    const ws = new (this.opts.WebSocket ?? WebSocket)(url.toString());
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.reconnectAttempts = 0;
      this.fire("connected");
    };

    ws.onmessage = (msg) => {
      if (this.ws !== ws) return;
      let data: unknown;
      try {
        data = JSON.parse(String(msg.data));
      } catch (e) {
        console.warn("[bingbong] Failed to parse WebSocket message:", e);
        return;
      }
      if (!isValidMessage(data)) {
        console.warn("[bingbong] Ignoring malformed WebSocket message:", data);
        return;
      }
      this.handleMessage(data);
    };

    // onclose is the single source of truth for reconnection; onerror always precedes it
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.fire("disconnected");
      if (this.shouldConnect) this.scheduleReconnect(!opened);
    };
    ws.onerror = () => {};
  }

  private handleMessage(msg: ServerMessage): void {
    this.fire("message", msg);
    if (msg.type === "init") {
      this.sessions.clear();
      for (const s of msg.sessions) this.sessions.set(sessionKey(s.machine_id, s.session_id), s);
      this.fire("init", msg.sessions);
      for (const s of msg.sessions) this.fire("session", s);
    } else if (msg.type === "event") {
      const e = msg.event;
      const key = sessionKey(e.machine_id, e.session_id);
      const prev = this.sessions.get(key);
      // receipt time (approximated by the client clock), like init/fetchSessions; e.timestamp is
      // the producer's clock and may be deliberately backdated (bingbong test --count)
      const now = new Date().toISOString();
      const session: SessionSnapshot = {
        session_id: e.session_id,
        machine_id: e.machine_id,
        parent_session_id: e.parent_session_id ?? prev?.parent_session_id,
        label: e.session_label ?? prev?.label,
        pan: e.pan,
        position: e.position,
        index: e.session_index,
        color: e.color,
        event_count: (prev?.event_count ?? 0) + 1,
        first_seen: prev?.first_seen ?? now,
        last_seen: now,
      };
      this.sessions.set(key, session);
      // event_count moves on every event, so the snapshot always changed
      this.fire("session", session);
      this.fire("event", e);
    }
  }

  private scheduleReconnect(neverOpened: boolean): void {
    // still fired with reconnect: false so callers get the neverOpened (401?) hint
    this.fire("reconnecting", neverOpened);
    if (this.opts.reconnect === false) {
      this.shouldConnect = false;
      return;
    }
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) this.openWebSocket();
    }, delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
