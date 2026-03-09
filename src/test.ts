/**
 * bingbong test
 *
 * Smoke-test command that verifies a running bingbong server is reachable
 * and can accept events. Sends a short burst of synthetic events so the
 * user hears sounds and sees the UI react.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — server unreachable
 *   2 — event send failed
 */

const TIMEOUT = 2000;

interface HealthResponse {
  name: string;
  version: string;
  sessions: number;
  clients: number;
}

interface TestEvent {
  event_type: string;
  session_id: string;
  machine_id: string;
  timestamp: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: Record<string, unknown>;
}

const TOOL_SEQUENCE = ["Read", "Edit", "Bash"];

function buildEvent(sessionId: string, eventType: string, toolName: string = ""): TestEvent {
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

async function sendEvent(url: string, event: TestEvent): Promise<boolean> {
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
  const url = process.env.BINGBONG_URL || "http://localhost:3334";
  const sessionId = `bingbong-test-${Date.now()}`;

  // Step 1: Health check
  const healthy = await checkHealth(url);
  if (!healthy) {
    console.error(`❌ Could not reach server at ${url}`);
    console.error(`   Try: bingbong --open`);
    console.error(`   Or set BINGBONG_URL=http://localhost:<port>`);
    process.exit(1);
  }
  console.log(`✅ Server reachable at ${url}`);

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
