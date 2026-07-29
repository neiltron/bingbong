import type { BingbongEvent, HealthResponse } from "@bingbong/protocol";

const DEFAULT_URL = process.env.BINGBONG_URL || "http://localhost:3334";
const DEFAULT_COUNT = 1_000;
const DEFAULT_SESSIONS = 4;
const REQUEST_TIMEOUT_MS = 5_000;
const FIND_MARKER = "HISTORY_FIND_MARKER";
const TOOL_NAMES = ["Read", "Grep", "Edit", "Bash", "Write", "Task"];

interface Options {
  url: string;
  count: number;
  sessions: number;
}

function usage(): string {
  return [
    "Usage: bun scripts/stress-events.ts [options]",
    "",
    "Options:",
    `  --url <url>           Bingbong server URL (default: ${DEFAULT_URL})`,
    `  --count <number>      Events to send (default: ${DEFAULT_COUNT})`,
    `  --sessions <number>   Sessions to distribute across (default: ${DEFAULT_SESSIONS})`,
    "  -h, --help            Show this help",
  ].join("\n");
}

function positiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    url: DEFAULT_URL,
    count: DEFAULT_COUNT,
    sessions: DEFAULT_SESSIONS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--url":
        if (!argv[i + 1]) throw new Error("--url requires a value");
        options.url = argv[++i]!.replace(/\/+$/, "");
        break;
      case "--count":
        options.count = positiveInteger(argv[++i], "--count");
        break;
      case "--sessions":
        options.sessions = positiveInteger(argv[++i], "--sessions");
        break;
      case "-h":
      case "--help":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function assertHealthy(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }

  const health = (await response.json()) as HealthResponse;
  if (health.name !== "Bingbong Server") {
    throw new Error(`Unexpected health response from ${url}`);
  }
}

function buildEvent(
  runId: string,
  index: number,
  sessionIndex: number,
  markerIndex: number,
  startedAt: number,
): BingbongEvent {
  const marker = index === markerIndex;
  const toolName = marker ? FIND_MARKER : TOOL_NAMES[index % TOOL_NAMES.length]!;

  return {
    event_type: index % 2 === 0 ? "PreToolUse" : "PostToolUse",
    session_id: `stress-${runId}-${sessionIndex + 1}`,
    machine_id: "stress-machine",
    timestamp: new Date(startedAt + index * 100).toISOString(),
    cwd: `/stress/session-${sessionIndex + 1}`,
    tool_name: toolName,
    tool_input: {
      command: marker ? FIND_MARKER : `stress-event-${index + 1}`,
    },
    tool_output: {},
  };
}

async function sendEvent(url: string, event: BingbongEvent, index: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Event ${index + 1} failed: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Event ${index + 1} was rejected with HTTP ${response.status}`);
  }
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n`);
    console.error(usage());
    process.exit(1);
  }

  await assertHealthy(options.url);

  const runId = Date.now().toString(36);
  const markerIndex = Math.floor(options.count / 4);
  const startedAt = Date.now();

  console.log(`Sending ${options.count} events across ${options.sessions} sessions to ${options.url}`);
  console.log("Mute the browser client before large runs so audio does not skew the profile.");
  console.log(`Native Find marker: ${FIND_MARKER}`);

  for (let index = 0; index < options.count; index++) {
    const sessionIndex = index % options.sessions;
    const event = buildEvent(runId, index, sessionIndex, markerIndex, startedAt);
    await sendEvent(options.url, event, index);

    const sent = index + 1;
    if (sent % 500 === 0 || sent === options.count) {
      console.log(`Sent ${sent}/${options.count}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Completed: ${options.count} events accepted in ${elapsedMs}ms`);
}

main().catch((error) => {
  console.error(`Stress run failed: ${(error as Error).message}`);
  process.exit(1);
});
