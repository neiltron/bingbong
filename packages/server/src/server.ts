/**
 * Bingbong Server
 *
 * Receives events from agent hooks and broadcasts them to connected
 * clients for audio rendering. Transport only — terminal rendering and
 * client assets are injected by the host (e.g. the CLI).
 */

import {
  PlainLogger,
  type RuntimeLogger,
  type RuntimeStats,
  type RuntimeStatsProvider,
} from "./logger";
import { SessionRegistry } from "./session-registry";
import {
  PROTOCOL_VERSION,
  type BingbongEvent,
  type EnrichedEvent,
  type EventMessage,
  type InitMessage,
} from "@bingbong/protocol";

export interface LoggerContext {
  port: number;
  version: string;
  getStats: RuntimeStatsProvider;
}

export interface StartServerOptions {
  port: number;
  version: string;
  /** Bun HTML bundle served at "/" (e.g. the browser client's index.html import). */
  client?: unknown;
  createLogger?: (ctx: LoggerContext) => RuntimeLogger;
}

export interface StartServerResult {
  server: Bun.Server;
  logger: RuntimeLogger;
  dispose(): void;
}

export async function startServer(
  options: StartServerOptions,
): Promise<StartServerResult> {
  const { port, version } = options;
  const sessionRegistry = new SessionRegistry();
  const wsClients = new Set<WebSocket>();

  function getRuntimeStats(): RuntimeStats {
    return sessionRegistry.stats(wsClients.size);
  }

  const logger = options.createLogger
    ? options.createLogger({ port, version, getStats: getRuntimeStats })
    : new PlainLogger();

  function logInfo(message: string) {
    logger.info(message);
  }

  function logError(message: string, err?: unknown) {
    logger.error(message, err);
  }

  function enrichEvent(event: BingbongEvent): EnrichedEvent {
    const result = sessionRegistry.enrich(event);

    if (result.createdSession) {
      const { key, label, index, pan } = result.createdSession;
      logInfo(
        `[Session] New session: ${label} [${key}] (index=${index}, pan=${pan.toFixed(2)})`,
      );
    }

    return result.event;
  }

  function broadcast(event: EnrichedEvent) {
    const message = JSON.stringify({ type: "event", event } satisfies EventMessage);
    for (const client of wsClients) {
      try {
        client.send(message);
      } catch (err) {
        logError("[WS] Failed to send:", err);
        wsClients.delete(client);
      }
    }
  }

  const staleSessionInterval = setInterval(() => {
    for (const key of sessionRegistry.removeStale()) {
      logInfo(`[Session] Removing stale session: ${key}`);
    }
  }, 60 * 1000);

  const server = Bun.serve({
    port,
    routes: options.client ? { "/": options.client } : {},

    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // WebSocket upgrade for /ws
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      // HTTP POST for events from hooks
      if (req.method === "POST" && url.pathname === "/events") {
        try {
          const event = (await req.json()) as BingbongEvent;
          const enriched = enrichEvent(event);

          logInfo(
            `[Event] ${enriched.event_type} | session=${enriched.session_id.slice(0, 8)} | tool=${enriched.tool_name || "n/a"}`,
          );

          broadcast(enriched);

          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          logError("[HTTP] Error processing event:", err);
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // GET /sessions - list active sessions
      if (req.method === "GET" && url.pathname === "/sessions") {
        return new Response(JSON.stringify(sessionRegistry.snapshots()), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // GET /health - health check / info
      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            name: "Bingbong Server",
            version,
            sessions: getRuntimeStats().sessionCount,
            clients: wsClients.size,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        logInfo(`[WS] Client connected (total: ${wsClients.size})`);

        // Send current sessions to new client
        ws.send(
          JSON.stringify({
            type: "init",
            protocol_version: PROTOCOL_VERSION,
            sessions: sessionRegistry.snapshots(),
          } satisfies InitMessage),
        );
      },

      close(ws) {
        wsClients.delete(ws);
        logInfo(`[WS] Client disconnected (total: ${wsClients.size})`);
      },

      message(_ws, message) {
        // Handle any client messages if needed
        logInfo(`[WS] Received: ${String(message)}`);
      },
    },
  });

  return {
    server,
    logger,
    dispose() {
      clearInterval(staleSessionInterval);
      logger.dispose();
    },
  };
}
