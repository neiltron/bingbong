import { DurableObject } from "cloudflare:workers";
// subpaths, not the barrel: "@bingbong/server" also re-exports the Bun adapter
import { BingbongHub, type HubLogger } from "@bingbong/server/hub";
import { SessionRegistry, type RegistryState } from "@bingbong/server/session-registry";
import pkg from "../package.json";

interface Env {
  HUB: DurableObjectNamespace<BingbongDurableObject>;
  ASSETS: Fetcher;
  BINGBONG_TOKEN?: string;
}

const API_PATHS = new Set(["/events", "/sessions", "/health", "/ws"]);

const logger: HubLogger = {
  info: (msg) => console.log(msg),
  error: (msg, err) => (err === undefined ? console.error(msg) : console.error(msg, err)),
};

export default {
  fetch(req, env) {
    if (!API_PATHS.has(new URL(req.url).pathname)) return env.ASSETS.fetch(req);
    // ponytail: single tenant; per-user DO ids + per-tenant tokens when sharing
    return env.HUB.get(env.HUB.idFromName("default")).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class BingbongDurableObject extends DurableObject<Env> {
  private hub!: BingbongHub;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.hub = new BingbongHub({
        version: pkg.version,
        token: env.BINGBONG_TOKEN,
        logger,
        registry: SessionRegistry.fromJSON(await ctx.storage.get<RegistryState>("registry")),
        onChange: (r) => void ctx.storage.put("registry", r.toJSON()),
      });
      // hibernated sockets survive an eviction; re-register them so broadcasts still reach them
      for (const ws of ctx.getWebSockets()) this.hub.addClient(ws, { sendInit: false });
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "OPTIONS" && new URL(req.url).pathname === "/ws") {
      if (!this.hub.authorized(req)) return new Response("Unauthorized", { status: 401 });
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      this.hub.addClient(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return this.hub.fetch(req);
  }

  webSocketMessage() {}

  webSocketClose(ws: WebSocket) {
    this.hub.removeClient(ws);
  }

  webSocketError(ws: WebSocket) {
    this.hub.removeClient(ws);
  }
}
