/**
 * bingbong emit
 *
 * Reads hook payload JSON from stdin, spreads it into the POST body
 * with event_type/timestamp/machine_id overlaid, and sends it to
 * the bingbong server's /events endpoint.
 *
 * Always exits 0. Completely silent (no stdout, no stderr).
 */

import os from "node:os";

export async function emit(argv: string[]): Promise<void> {
  const enabled = (process.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const eventType = argv[0];
  if (!eventType) return;

  const url = process.env.BINGBONG_URL || "http://localhost:3334";

  // Read stdin: if TTY (no pipe), use {}. Otherwise read with a 1s timeout
  // to handle edge case where stdin is not a TTY but no data is piped.
  let input: Record<string, unknown> = {};
  if (!process.stdin.isTTY) {
    try {
      const raw = await Promise.race([
        Bun.stdin.text(),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), 1000)),
      ]);
      if (raw.trim()) input = JSON.parse(raw);
    } catch {
      // Malformed JSON — proceed with empty input
    }
  }

  // Normalize session_id — agents use different field names
  const sessionId = (input.session_id ?? input.conversation_id ?? input.generation_id ?? "unknown") as string;

  // Spread stdin payload, overlay our fields
  const payload = {
    ...input,
    event_type: eventType,
    session_id: sessionId,
    machine_id: process.env.BINGBONG_MACHINE_ID || os.hostname(),
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Network error, timeout, etc. — swallow silently
  }
}
