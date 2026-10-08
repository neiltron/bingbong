/**
 * Bingbong Server
 *
 * Thin Bun adapter over BingbongHub: owns the listener and the /ws
 * upgrade. Terminal rendering and client assets are injected by the
 * host (e.g. the CLI).
 */

import { BingbongHub } from "./hub";
import {
  PlainLogger,
  type RuntimeLogger,
  type RuntimeStatsProvider,
} from "./logger";

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

  // Hub first: the terminal logger calls getStats() in its constructor,
  // so the hub forwards to a logger that doesn't exist yet.
  const hub = new BingbongHub({
    version,
    logger: {
      info: (msg) => logger.info(msg),
      error: (msg, err) => logger.error(msg, err),
    },
  });
  const logger: RuntimeLogger = options.createLogger
    ? options.createLogger({ port, version, getStats: () => hub.stats() })
    : new PlainLogger();

  const server = Bun.serve({
    port,
    routes: options.client ? { "/": options.client } : {},

    fetch(req) {
      // OPTIONS falls through to the hub's CORS preflight, as before
      if (req.method !== "OPTIONS" && new URL(req.url).pathname === "/ws") {
        if (!server.upgrade(req)) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }
      return hub.fetch(req);
    },

    websocket: {
      open(ws) {
        hub.addClient(ws);
      },

      close(ws) {
        hub.removeClient(ws);
      },

      message(_ws, message) {
        logger.info(`[WS] Received: ${String(message)}`);
      },
    },
  });

  return {
    server,
    logger,
    dispose() {
      logger.dispose();
    },
  };
}
