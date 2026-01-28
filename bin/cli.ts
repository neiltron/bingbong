#!/usr/bin/env bun

/**
 * Bingbong CLI
 *
 * Unified command to run the Bingbong server and client.
 */

import { startServer } from "../src/server";

const VERSION = "0.1.0";

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
          `Error: Invalid port "${portStr}". Must be a number between 1 and 65535.`
        );
        process.exit(1);
      }
      args.port = port;
    } else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option "${arg}". Run bingbong --help for usage.`);
      process.exit(1);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
bingbong - Soundscapes for coding agents

Usage: bingbong [options]

Options:
  -p, --port <number>  Port to run server on (default: 3334)
  -o, --open           Open browser automatically
  -h, --help           Show this help message
  -v, --version        Show version number

Examples:
  bingbong              Start server on port 3334
  bingbong --open       Start and open browser
  bingbong --port 8080  Use custom port
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
      `Error: Port ${args.port} is already in use. Try: bingbong --port ${args.port + 1}`
    );
    process.exit(1);
  }

  // Start the server
  const server = await startServer(args.port);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    server.stop();
    process.exit(0);
  });

  // Open browser if requested
  if (args.open) {
    const url = `http://localhost:${args.port}`;
    console.log(`Opening browser...`);
    openBrowser(url);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
