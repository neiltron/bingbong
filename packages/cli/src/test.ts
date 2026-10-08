/**
 * bingbong test
 *
 * Smoke-test command that verifies a running bingbong server is reachable
 * and can accept events. Sends a short burst of synthetic events so the
 * user hears sounds and sees the UI react.
 *
 * `--count <n> [--sessions <n>]` instead sends n spaced-out events as a UI
 * history fixture, with a HISTORY_FIND_MARKER event for native Find.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — server unreachable
 *   2 — event send failed
 */

import { parseArgs } from "node:util";
import type { BingbongEvent, HealthResponse } from "@bingbong/protocol";
import { loadConfig } from "./config";

const TIMEOUT = 2000;

const TOOL_SEQUENCE = ["Read", "Edit", "Bash"];

function buildEvent(
  sessionId: string,
  eventType: string,
  toolName: string = "",
): BingbongEvent {
  return {
    event_type: eventType,
    session_id: sessionId,
    machine_id: "test",
    timestamp: new Date().toISOString(),
    cwd: "/test",
    tool_name: toolName,
    tool_input: {},
    tool_output: {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) return false;

    const data = (await res.json()) as HealthResponse;
    return data.name === "Bingbong Server";
  } catch {
    return false;
  }
}

async function sendEvent(url: string, event: BingbongEvent): Promise<boolean> {
  try {
    const res = await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function test(argv: string[]): Promise<void> {
  const { url } = loadConfig();
  const sessionId = `bingbong-test-${Date.now()}`;
  const { values } = parseArgs({
    args: argv,
    options: { count: { type: "string" }, sessions: { type: "string", default: "4" } },
  });

  // Step 1: Health check
  const healthy = await checkHealth(url);
  if (!healthy) {
    console.error(`❌ Could not reach server at ${url}`);
    console.error(`   Try: bingbong --open`);
    console.error(`   Or run: bingbong config set url http://localhost:<port>`);
    process.exit(1);
  }
  console.log(`✅ Server reachable at ${url}`);

  if (values.count) {
    const count = Number(values.count);
    const sessions = Number(values.sessions);
    // Payload timestamps 0.2–5s apart, ending around now, so the lanes axis
    // gets realistic width without real sleeps
    let ms = Date.now() - count * 2600;
    for (let i = 0; i < count; i++) {
      ms += 200 + Math.random() * 4800;
      const tool =
        i === Math.floor(count / 4) ? "HISTORY_FIND_MARKER" : TOOL_SEQUENCE[i % 3];
      const type = i % 2 ? "PostToolUse" : "PreToolUse";
      const event = buildEvent(`${sessionId}-${i % sessions}`, type, tool);
      event.timestamp = new Date(ms).toISOString();
      event.cwd = `/test/session-${i % sessions}`;
      event.tool_input = { command: `${tool} ${i + 1}` };
      if (!(await sendEvent(url, event))) {
        console.error(`❌ Event ${i + 1} rejected`);
        process.exit(2);
      }
    }
    console.log(`✅ Sent ${count} events across ${sessions} sessions`);
    return;
  }

  // Step 2: Send event burst
  const events: Array<{ type: string; tool: string }> = [
    { type: "SessionStart", tool: "" },
  ];

  for (const tool of TOOL_SEQUENCE) {
    events.push({ type: "PreToolUse", tool });
    events.push({ type: "PostToolUse", tool });
  }

  events.push({ type: "Stop", tool: "" });

  let sent = 0;
  for (const { type, tool } of events) {
    const ok = await sendEvent(url, buildEvent(sessionId, type, tool));
    if (!ok) {
      console.error(`❌ Failed to send ${type}${tool ? ` (${tool})` : ""} event`);
      console.error(`   Server is reachable but rejected the event.`);
      process.exit(2);
    }
    sent++;
    if (sent < events.length) {
      await sleep(250);
    }
  }

  const toolNames = TOOL_SEQUENCE.join(", ");
  console.log(`✅ Sent ${sent} events (SessionStart, ${toolNames}, Stop)`);
  console.log(`✅ bingbong test passed`);
}
