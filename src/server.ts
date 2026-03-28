/**
 * Bingbong Server
 *
 * Receives events from Claude Code hooks and broadcasts them
 * to connected frontend clients for audio rendering.
 */

import clientIndex from "../client/index.html";

const VERSION = "0.1.8";
const MAX_EVENT_LOG_LINES = 1000;

interface RuntimeLogger {
  info(message: string): void;
  error(message: string, err?: unknown): void;
  dispose(): void;
}

export type { RuntimeLogger };

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

interface StartServerResult {
  server: Bun.Server;
  logger: RuntimeLogger;
}

class PlainLogger implements RuntimeLogger {
  info(message: string) {
    console.log(message);
  }

  error(message: string, err?: unknown) {
    if (err !== undefined) {
      console.error(message, err);
      return;
    }

    console.error(message);
  }

  dispose() {}
}

class TerminalLayoutLogger implements RuntimeLogger {
  private readonly isInteractive: boolean;
  private readonly maxLines: number;
  private readonly port: number;
  private readonly resizeHandler: (() => void) | null;
  private logLines: string[] = [];
  private plainMode: boolean;

  constructor(port: number, maxLines = MAX_EVENT_LOG_LINES) {
    this.port = port;
    this.maxLines = maxLines;
    this.isInteractive = Boolean(process.stdout.isTTY);
    this.plainMode = !this.isInteractive;

    if (this.plainMode) {
      this.writePlainHeader();
      this.resizeHandler = null;
      return;
    }

    this.resizeHandler = () => {
      this.render();
    };

    process.stdout.on("resize", this.resizeHandler);
    this.render();
  }

  info(message: string) {
    this.writeMessage(message, "stdout");
  }

  error(message: string, err?: unknown) {
    const fullMessage =
      err === undefined
        ? message
        : `${message} ${this.formatUnknownError(err)}`;

    this.writeMessage(fullMessage, "stderr");
  }

  dispose() {
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
    }

    if (this.isInteractive && !this.plainMode) {
      process.stdout.write("\x1b[?25h");
    }
  }

  private writeMessage(message: string, target: "stdout" | "stderr") {
    const lines = this.normalizeMessageLines(message);

    if (this.plainMode) {
      this.writePlainLines(lines, target);
      return;
    }

    this.logLines.push(...lines);
    if (this.logLines.length > this.maxLines) {
      this.logLines = this.logLines.slice(-this.maxLines);
    }

    this.render();
  }

  private render() {
    if (this.plainMode) return;

    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    const headerLines = createHeaderLines(this.port, cols);
    const headerCount = headerLines.length;

    // Very small terminal: degrade to plain append-only mode.
    if (rows <= headerCount + 1) {
      this.switchToPlainMode();
      return;
    }

    // Reserve 1 row for the cursor line at the bottom
    const viewportRows = rows - headerCount - 1;
    const visibleLogs = this.logLines.slice(-viewportRows);
    const paddingRows = Math.max(0, viewportRows - visibleLogs.length);
    const innerW = cols - 2;

    const lines: string[] = [];
    lines.push(...headerLines);

    // Log lines with side borders
    for (const line of visibleLogs) {
      const fitted = this.fitToWidth(line, innerW);
      const linePad = Math.max(0, innerW - fitted.length);
      lines.push(
        `${BG}${FG_DIM}${BOX.v}${RESET} ${FG_BRIGHT}${fitted}${" ".repeat(Math.max(0, linePad - 1))}${BG}${FG_DIM}${BOX.v}${RESET}`,
      );
    }

    // Empty padding rows with side borders
    for (let i = 0; i < paddingRows; i++) {
      lines.push(
        `${BG}${FG_DIM}${BOX.v}${" ".repeat(innerW)}${BOX.v}${RESET}`,
      );
    }

    // Bottom border + blinking cursor line
    lines.push(
      `${BG}${FG_DIM}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${RESET}`,
    );

    let output = "\x1b[?25l\x1b[2J\x1b[H";
    output += lines.join("\n");

    process.stdout.write(output);
  }

  private switchToPlainMode() {
    this.plainMode = true;

    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
    }

    process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
    this.writePlainHeader();
    this.writePlainLines(this.logLines, "stdout");
  }

  private writePlainHeader() {
    const cols = process.stdout.columns ?? 80;
    this.writePlainLines(createHeaderLines(this.port, cols), "stdout");
  }

  private writePlainLines(lines: string[], target: "stdout" | "stderr") {
    const stream = target === "stderr" ? process.stderr : process.stdout;
    for (const line of lines) {
      stream.write(`${line}\n`);
    }
  }

  private fitToWidth(line: string, width: number): string {
    if (width <= 0) return "";
    if (line.length <= width) return line;
    if (width === 1) return "…";
    return `${line.slice(0, width - 1)}…`;
  }

  private normalizeMessageLines(message: string): string[] {
    const rawLines = message.split(/\r?\n/);
    return rawLines.map((line) => this.sanitizeLine(line));
  }

  private sanitizeLine(line: string): string {
    // Strip control characters to avoid terminal escape sequence injection in logs.
    return line
      .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  }

  private formatUnknownError(err: unknown): string {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}`;
    }

    if (typeof err === "string") {
      return err;
    }

    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
}

// ANSI styling constants
const BG = "\x1b[48;2;13;27;42m"; // #0d1b2a dark navy bg
const FG = "\x1b[38;2;42;80;112m"; // #2a5070 steel-blue
const FG_BRIGHT = "\x1b[38;2;120;160;190m"; // brighter steel-blue for values
const FG_DIM = "\x1b[38;2;30;55;78m"; // dimmer for borders
const FG_LABEL = "\x1b[38;2;80;120;150m"; // label color
const FG_ACCENT = "\x1b[38;2;78;205;196m"; // #4ECDC4 teal accent
const FG_GREEN = "\x1b[38;2;107;155;107m"; // #6b9b6b muted green
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// Box-drawing characters
const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  tj: "┬",
  bj: "┴",
  lj: "├",
  rj: "┤",
  x: "┼",
};

function createHeaderLines(port: number, width: number): string[] {
  if (width < 20) return [`${BG}${FG}${BOLD} bingbong ${RESET}`];

  const url = `http://localhost:${port}`;
  const innerW = width - 2; // account for border chars

  const lines: string[] = [];

  // Top border
  lines.push(`${BG}${FG_DIM}${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}${RESET}`);

  // Title line: "│ bingbong v0.1.4                    http://localhost:3334 │"
  const titleLeft = `bingbong v${VERSION}`;
  const titleRight = url;
  const titleGap = Math.max(1, innerW - titleLeft.length - titleRight.length - 2);
  const titleContent =
    ` ${BG}${FG}${BOLD}bingbong${RESET}${BG}${FG} v${VERSION}` +
    `${" ".repeat(titleGap)}${FG_BRIGHT}${titleRight} `;
  lines.push(`${BG}${FG_DIM}${BOX.v}${titleContent}${FG_DIM}${BOX.v}${RESET}`);

  // Separator
  lines.push(`${BG}${FG_DIM}${BOX.lj}${BOX.h.repeat(innerW)}${BOX.rj}${RESET}`);

  // Status line: "│ HOST: localhost  ESTABLISHED   TIME: HH:MM:SS UTC      │"
  const now = new Date();
  const timeStr = now.toISOString().slice(11, 19) + " UTC";
  const connStatus = wsClients.size > 0 ? "ESTABLISHED" : "LISTENING";
  const connColor = wsClients.size > 0 ? FG_GREEN : FG_DIM;
  const hostVal = `localhost`;
  const sessionCount = sessions.size;
  const clientCount = wsClients.size;

  // Build status content
  const statusParts =
    ` ${FG_LABEL}HOST:${RESET}${BG} ${FG_BRIGHT}${hostVal}${RESET}${BG}` +
    `  ${connColor}${BOLD}${connStatus}${RESET}${BG}` +
    `   ${FG_LABEL}TIME:${RESET}${BG} ${FG_BRIGHT}${timeStr}${RESET}${BG}`;

  // Measure visible chars for padding
  const visibleStatusLen =
    1 + 5 + 1 + hostVal.length + 2 + connStatus.length + 3 + 5 + 1 + timeStr.length;
  const statusPad = Math.max(1, innerW - visibleStatusLen - 1);
  const statusLine = `${statusParts}${" ".repeat(statusPad)} `;

  lines.push(`${BG}${FG_DIM}${BOX.v}${statusLine}${FG_DIM}${BOX.v}${RESET}`);

  // Separator
  lines.push(`${BG}${FG_DIM}${BOX.lj}${BOX.h.repeat(innerW)}${BOX.rj}${RESET}`);

  // Sessions/clients line
  const sessionsStr = sessionCount === 0 ? "none" : `${sessionCount}`;
  const eventsStr = `${Array.from(sessions.values()).reduce((sum, s) => sum + s.event_count, 0)}`;
  const clientsStr = `${clientCount}`;

  const infoContent =
    ` ${FG_LABEL}SESSIONS:${RESET}${BG} ${FG_ACCENT}${sessionsStr}${RESET}${BG}` +
    `   ${FG_LABEL}CLIENTS:${RESET}${BG} ${FG_BRIGHT}${clientsStr}${RESET}${BG}` +
    `   ${FG_LABEL}EVENTS:${RESET}${BG} ${FG_BRIGHT}${eventsStr}${RESET}${BG}`;

  const visibleInfoLen =
    1 + 9 + 1 + sessionsStr.length + 3 + 8 + 1 + clientsStr.length + 3 + 7 + 1 + eventsStr.length;
  const infoPad = Math.max(1, innerW - visibleInfoLen - 1);
  const infoLine = `${infoContent}${" ".repeat(infoPad)} `;

  lines.push(`${BG}${FG_DIM}${BOX.v}${infoLine}${FG_DIM}${BOX.v}${RESET}`);

  // Bottom border
  lines.push(`${BG}${FG_DIM}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${RESET}`);

  return lines;
}

let runtimeLogger: RuntimeLogger = new PlainLogger();

function logInfo(message: string) {
  runtimeLogger.info(message);
}

function logError(message: string, err?: unknown) {
  runtimeLogger.error(message, err);
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

    logInfo(
      `[Session] New session: ${key} (index=${index}, pan=${session.pan.toFixed(2)})`,
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
      logError("[WS] Failed to send:", err);
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
      logInfo(`[Session] Removing stale session: ${key}`);
      sessions.delete(key);
    }
  }
}, 60 * 1000);

export async function startServer(port: number): Promise<StartServerResult> {
  const logger = new TerminalLayoutLogger(port);
  runtimeLogger = logger;

  const server = Bun.serve({
    port,
    routes: {
      "/": clientIndex,
    },

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
        const sessionList = Array.from(sessions.values());
        ws.send(
          JSON.stringify({
            type: "init",
            sessions: sessionList,
          }),
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

  return { server, logger };
}
