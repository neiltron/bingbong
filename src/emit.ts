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

  // Read stdin: if TTY (interactive terminal), skip — no data to read.
  // Otherwise read piped data via Bun.stdin.text().
  //
  // The 1s timeout handles a Bun quirk: when a parent process spawns us
  // without piping stdin (e.g. `bun run bin/cli.ts emit Foo` during local
  // dev), process.stdin.isTTY is undefined — not false — so we enter this
  // branch, but Bun.stdin.text() hangs forever waiting for EOF that never
  // comes. The timeout lets us fall through with an empty payload instead.
  //
  // In production (Claude Code, Cursor), agents always pipe JSON on stdin,
  // so Bun.stdin.text() resolves instantly and the timeout never fires.
  // The timer is unref'd so it doesn't keep the process alive when stdin
  // wins the race — without unref(), the process would block for 1s even
  // after reading stdin successfully.
  let input: Record<string, unknown> = {};
  if (!process.stdin.isTTY) {
    try {
      const raw = await Promise.race([
        Bun.stdin.text(),
        new Promise<string>((resolve) => {
          const t = setTimeout(() => resolve(""), 1000);
          t.unref();
        }),
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
