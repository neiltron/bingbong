/**
 * Runtime-agnostic server core: session enrichment, client fan-out and
 * the HTTP routes. Hosts (Bun, Durable Objects, Node) own the listener
 * and the WebSocket upgrade, and feed clients/requests in here.
 */

import type { RuntimeStats } from "./logger";
import { SessionRegistry } from "./session-registry";
import {
  PROTOCOL_VERSION,
  type BingbongEvent,
  type EnrichedEvent,
  type EventMessage,
  type InitMessage,
} from "@bingbong/protocol";

export interface HubClient {
  send(data: string): void;
}

export interface HubLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface HubOptions {
  version: string;
  logger?: HubLogger;
  registry?: SessionRegistry;
  /** shared secret; when unset every route stays open */
  token?: string;
  /** called after registry state changes (every ingest, or a prune that removed sessions) so hosts can persist it */
  onChange?: (registry: SessionRegistry) => void;
}

const PRUNE_INTERVAL_MS = 60 * 1000;

// Constant-time for equal lengths; length itself may leak, which is fine
// for a shared secret. Pure JS so Durable Objects need no nodejs_compat.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const silentLogger: HubLogger = { info() {}, error() {} };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export class BingbongHub {
  readonly registry: SessionRegistry;
  private readonly clients = new Set<HubClient>();
  private readonly version: string;
  private readonly logger: HubLogger;
  private readonly token?: string;
  private readonly onChange?: (registry: SessionRegistry) => void;
  private lastPruneAt: number;

  constructor(opts: HubOptions) {
    this.version = opts.version;
    this.logger = opts.logger ?? silentLogger;
    this.registry = opts.registry ?? new SessionRegistry();
    this.token = opts.token;
    this.onChange = opts.onChange;
    this.lastPruneAt = Date.now();
  }

  /** enrich, log, broadcast; also prunes stale sessions. Returns the enriched event. */
  ingest(event: BingbongEvent): EnrichedEvent {
    this.pruneStale();

    const result = this.registry.enrich(event);
    if (result.createdSession) {
      const { key, label, index, pan } = result.createdSession;
      this.logger.info(
        `[Session] New session: ${label} [${key}] (index=${index}, pan=${pan.toFixed(2)})`,
      );
    }
    const enriched = result.event;

    this.logger.info(
      `[Event] ${enriched.event_type} | session=${enriched.session_id.slice(0, 8)} | tool=${enriched.tool_name || "n/a"}`,
    );

    this.broadcast(enriched);
    this.onChange?.(this.registry);
    return enriched;
  }

  /** registers a client and sends it the InitMessage; `sendInit: false` re-attaches a surviving (hibernated) socket silently */
  addClient(client: HubClient, opts: { sendInit?: boolean } = {}): void {
    if (this.pruneStale()) this.onChange?.(this.registry);

    this.clients.add(client);
    this.logger.info(`[WS] Client connected (total: ${this.clients.size})`);

    if (opts.sendInit === false) return;
    try {
      client.send(
        JSON.stringify({
          type: "init",
          protocol_version: PROTOCOL_VERSION,
          sessions: this.registry.snapshots(),
        } satisfies InitMessage),
      );
    } catch (err) {
      this.logger.error("[WS] Failed to send:", err);
      this.clients.delete(client);
    }
  }

  removeClient(client: HubClient): void {
    this.clients.delete(client);
    this.logger.info(`[WS] Client disconnected (total: ${this.clients.size})`);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  stats(): RuntimeStats {
    return this.registry.stats(this.clients.size);
  }

  /** true when no token is configured, or via `Authorization: Bearer` or `?token=` (browsers can't set WS upgrade headers) */
  authorized(req: Request): boolean {
    if (!this.token) return true;
    const header = req.headers.get("Authorization") ?? "";
    const query = new URL(req.url).searchParams.get("token") ?? "";
    return safeEqual(header, `Bearer ${this.token}`) || safeEqual(query, this.token);
  }

  /** HTTP routes only; /ws upgrade is runtime-specific and stays in the adapters. */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if ((url.pathname === "/events" || url.pathname === "/sessions") && !this.authorized(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (req.method === "POST" && url.pathname === "/events") {
      try {
        this.ingest((await req.json()) as BingbongEvent);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        this.logger.error("[HTTP] Error processing event:", err);
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      return new Response(JSON.stringify(this.registry.snapshots()), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          name: "Bingbong Server",
          version: this.version,
          sessions: this.stats().sessionCount,
          clients: this.clients.size,
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }

  private broadcast(event: EnrichedEvent) {
    const message = JSON.stringify({ type: "event", event } satisfies EventMessage);
    for (const client of this.clients) {
      try {
        client.send(message);
      } catch (err) {
        this.logger.error("[WS] Failed to send:", err);
        this.clients.delete(client);
      }
    }
  }

  // Pruned lazily on activity instead of on a setInterval: Durable Objects
  // hibernate between requests, so background timers can't be relied on.
  /** true when at least one session was removed */
  private pruneStale(): boolean {
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return false;
    this.lastPruneAt = now;
    const removed = this.registry.removeStale(now);
    for (const key of removed) {
      this.logger.info(`[Session] Removing stale session: ${key}`);
    }
    return removed.length > 0;
  }
}
