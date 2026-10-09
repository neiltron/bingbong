#!/usr/bin/env bun

/**
 * Bingbong CLI
 *
 * Unified command to run the Bingbong server and client.
 */

import type { BingbongEvent } from "@bingbong/protocol";
import { startServer, type RuntimeLogger } from "@bingbong/server";
import clientIndex from "../../../apps/client/index.html";
import { TerminalLayoutLogger } from "../src/runtime-logger";

const VERSION = "0.1.14";

let activeLogger: RuntimeLogger | null = null;

interface Args {
  port: number;
  open: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    port: 3334,
    open: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--version" || arg === "-v") {
      args.version = true;
    } else if (arg === "--open" || arg === "-o") {
      args.open = true;
    } else if (arg === "--port" || arg === "-p") {
      const portStr = argv[++i];
      if (!portStr) {
        console.error("Error: --port requires a value");
        process.exit(1);
      }
      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(
          `Error: Invalid port "${portStr}". Must be a number between 1 and 65535.`,
        );
        process.exit(1);
      }
      args.port = port;
    } else if (arg.startsWith("-")) {
      console.error(
        `Error: Unknown option "${arg}". Run bingbong --help for usage.`,
      );
      process.exit(1);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
bingbong - Soundscapes for coding agents

Usage: bingbong [options]
       bingbong <command> [options]

Commands:
  emit <EventType>         Emit an event to the bingbong server (used by hooks)
  install-hooks <agent>    Install bingbong hooks for a coding agent
  uninstall-hooks <agent>  Remove bingbong hooks for a coding agent
  ping [label]             Send one Ping event to the configured server
  test                     Smoke-test a running bingbong server
  config                   Show and validate config (url, token, machine_id, payload)
  config set <key> <val>   Set a config value (e.g. config set url https://...)
  config unset <key>       Remove a config value

Options:
  -p, --port <number>  Port to run server on (default: 3334)
  -o, --open           Open browser automatically
  -h, --help           Show this help message
  -v, --version        Show version number

Examples:
  bingbong                        Start server on port 3334
  bingbong --open                 Start and open browser
  bingbong install-hooks cursor   Install Cursor hooks
  make build; bingbong ping done  Ping when a command finishes
`);
}

function printVersion() {
  console.log(`bingbong v${VERSION}`);
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  try {
    Bun.spawn([cmd, url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch (err) {
    console.warn(`Could not open browser: ${err}`);
  }
}

async function checkPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      fetch() {
        return new Response("test");
      },
    });
    server.stop();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Subcommand detection — check before flag parsing
  const firstArg = process.argv[2];
  if (firstArg === "emit") {
    try {
      const { emit } = await import("../src/emit");
      await emit(process.argv.slice(3));
    } catch {} // incl. a malformed config: send nothing, never block the agent's hook
    process.exit(0);
  }

  if (firstArg === "install-hooks" || firstArg === "uninstall-hooks") {
    const { installHooks } = await import("../src/install-hooks");
    await installHooks(process.argv.slice(3), firstArg === "uninstall-hooks");
    process.exit(0);
  }

  if (firstArg === "ping") {
    const { loadConfig } = await import("../src/config");
    const { url, machine_id } = loadConfig();
    const label = process.argv.slice(3).join(" ");
    const event: BingbongEvent = {
      event_type: "Ping",
      session_id: "ping",
      machine_id,
      timestamp: new Date().toISOString(),
      // tool_input.action is what the client event log renders as detail
      tool_input: label ? { action: label } : undefined,
    };
    try {
      const res = await fetch(`${url}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
    } catch (err) {
      console.error(`Error: could not ping ${url}: ${(err as Error).message}`);
      process.exit(1);
    }
    console.log(`Pinged ${url}${label ? `: ${label}` : ""}`);
    process.exit(0);
  }

  if (firstArg === "config") {
    const { configCommand } = await import("../src/config");
    configCommand(process.argv.slice(3));
    process.exit(0);
  }

  if (firstArg === "test") {
    const { test } = await import("../src/test");
    await test(process.argv.slice(3));
    process.exit(0);
  }

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  // Check if port is available
  const portAvailable = await checkPortAvailable(args.port);
  if (!portAvailable) {
    console.error(
      `Error: Port ${args.port} is already in use. Try: bingbong --port ${args.port + 1}`,
    );
    process.exit(1);
  }

  // Refuse to start on a malformed config rather than silently ignoring it.
  const { loadConfig } = await import("../src/config");
  loadConfig();

  // Start the server: terminal rendering and the browser client bundle
  // are CLI concerns, injected into the transport-only server package.
  const runtime = await startServer({
    port: args.port,
    version: VERSION,
    client: clientIndex,
    createLogger: (ctx) => new TerminalLayoutLogger(ctx),
  });
  activeLogger = runtime.logger;

  function shutdown() {
    runtime.logger.info("Shutting down...");
    runtime.dispose();
    runtime.server.stop();
    process.exit(0);
  }

  // Handle graceful shutdown
  process.on("SIGINT", shutdown);

  process.on("SIGTERM", shutdown);

  // Open browser if requested
  if (args.open) {
    const url = `http://localhost:${args.port}`;
    runtime.logger.info("Opening browser...");
    openBrowser(url);
  }
}

main().catch((err) => {
  // Malformed config (server start, config, ping, test): clean error, no stack.
  if (err?.name === "ConfigError") {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (activeLogger) {
    activeLogger.error("Fatal error:", err);
    activeLogger.dispose();
  } else {
    console.error("Fatal error:", err);
  }

  process.exit(1);
});
