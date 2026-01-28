/**
 * Bingbong Server
 *
 * Receives events from Claude Code hooks and broadcasts them
 * to connected frontend clients for audio rendering.
 */

const VERSION = "0.1.0";

// Types
interface BingbongEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  timestamp: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: Record<string, unknown>;
}

interface EnrichedEvent extends BingbongEvent {
  // Enriched fields added by server
  pan: number; // -1 (left) to 1 (right)
  session_index: number;
  color: string;
}

interface Session {
  session_id: string;
  machine_id: string;
  first_seen: Date;
  last_seen: Date;
  event_count: number;
  pan: number;
  index: number;
  color: string;
}

// Session registry
const sessions = new Map<string, Session>();
let sessionCounter = 0;

// Colors for visual differentiation
const SESSION_COLORS = [
  "#FF6B6B", // red
  "#4ECDC4", // teal
  "#45B7D1", // blue
  "#96CEB4", // green
  "#FFEAA7", // yellow
  "#DDA0DD", // plum
  "#98D8C8", // mint
  "#F7DC6F", // gold
  "#BB8FCE", // purple
  "#85C1E9", // sky
];

// WebSocket clients
const wsClients = new Set<WebSocket>();

function getOrCreateSession(event: BingbongEvent): Session {
  const key = `${event.machine_id}:${event.session_id}`;

  let session = sessions.get(key);
  if (!session) {
    const index = sessionCounter++;
    // Spread sessions across stereo field
    // First session is center, then alternate left/right
    const pan =
      index === 0 ? 0 : ((index % 2 === 1 ? -1 : 1) * Math.ceil(index / 2)) / 5;

    session = {
      session_id: event.session_id,
      machine_id: event.machine_id,
      first_seen: new Date(),
      last_seen: new Date(),
      event_count: 0,
      pan: Math.max(-1, Math.min(1, pan)), // clamp to [-1, 1]
      index,
      color: SESSION_COLORS[index % SESSION_COLORS.length],
    };
    sessions.set(key, session);

    console.log(
      `[Session] New session: ${key} (index=${index}, pan=${session.pan.toFixed(2)})`
    );
  }

  session.last_seen = new Date();
  session.event_count++;

  return session;
}

function enrichEvent(event: BingbongEvent): EnrichedEvent {
  const session = getOrCreateSession(event);

  return {
    ...event,
    pan: session.pan,
    session_index: session.index,
    color: session.color,
  };
}

function broadcast(event: EnrichedEvent) {
  const message = JSON.stringify(event);
  for (const client of wsClients) {
    try {
      client.send(message);
    } catch (err) {
      console.error("[WS] Failed to send:", err);
      wsClients.delete(client);
    }
  }
}

// Clean up stale sessions (no activity for 30 minutes)
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 30 * 60 * 1000;

  for (const [key, session] of sessions) {
    if (now - session.last_seen.getTime() > staleThreshold) {
      console.log(`[Session] Removing stale session: ${key}`);
      sessions.delete(key);
    }
  }
}, 60 * 1000);

function printBanner(port: number) {
  console.log(`
╔═══════════════════════════════════════════════════╗
║               Bingbong v${VERSION}                   ║
╠═══════════════════════════════════════════════════╣
║  Client:    http://localhost:${port.toString().padEnd(5)}               ║
║  WebSocket: ws://localhost:${port.toString().padEnd(5)}/ws             ║
║  Events:    POST http://localhost:${port.toString().padEnd(5)}/events  ║
╚═══════════════════════════════════════════════════╝
`);
}

export async function startServer(port: number) {
  const server = Bun.serve({
    port,

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

          console.log(
            `[Event] ${enriched.event_type} | session=${enriched.session_id.slice(0, 8)} | tool=${enriched.tool_name || "n/a"}`
          );

          broadcast(enriched);

          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (err) {
          console.error("[HTTP] Error processing event:", err);
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }
      }

      // GET /sessions - list active sessions
      if (req.method === "GET" && url.pathname === "/sessions") {
        const sessionList = Array.from(sessions.values()).map((s) => ({
          session_id: s.session_id,
          machine_id: s.machine_id,
          pan: s.pan,
          index: s.index,
          color: s.color,
          event_count: s.event_count,
          last_seen: s.last_seen.toISOString(),
        }));

        return new Response(JSON.stringify(sessionList), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // GET / - serve client HTML
      if (req.method === "GET" && url.pathname === "/") {
        const clientPath = new URL("../client/index.html", import.meta.url)
          .pathname;
        const file = Bun.file(clientPath);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }
        // Fallback to health check if client not found
        return new Response(
          JSON.stringify({
            name: "Bingbong Server",
            version: VERSION,
            sessions: sessions.size,
            clients: wsClients.size,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      // GET /health - health check / info
      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            name: "Bingbong Server",
            version: VERSION,
            sessions: sessions.size,
            clients: wsClients.size,
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        console.log(`[WS] Client connected (total: ${wsClients.size})`);

        // Send current sessions to new client
        const sessionList = Array.from(sessions.values());
        ws.send(
          JSON.stringify({
            type: "init",
            sessions: sessionList,
          })
        );
      },

      close(ws) {
        wsClients.delete(ws);
        console.log(`[WS] Client disconnected (total: ${wsClients.size})`);
      },

      message(ws, message) {
        // Handle any client messages if needed
        console.log(`[WS] Received: ${message}`);
      },
    },
  });

  printBanner(port);

  return server;
}
