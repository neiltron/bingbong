// Type-only import: erased at compile time, so this also works on older pi
// installs that still resolve the legacy @mariozechner scope.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";

const DEFAULT_URL = "http://localhost:3334";
const BUILT_URL = "__BINGBONG_URL__";
const BUILT_TOKEN = "__BINGBONG_TOKEN__";

const envUrl = process.env.BINGBONG_URL;
const url = envUrl && envUrl.length > 0 ? envUrl : BUILT_URL || DEFAULT_URL;
const enabled = (process.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
const machineId = process.env.BINGBONG_MACHINE_ID || os.hostname();
const token = process.env.BINGBONG_TOKEN || BUILT_TOKEN;

const EVENT_TYPE_MAP: Record<string, string> = {
  tool_call: "PreToolUse",
  tool_result: "PostToolUse",
  session_start: "SessionStart",
  session_shutdown: "SessionEnd",
  session_before_compact: "PreCompact",
  session_compact: "PostCompact",
  // agent_settled is the definitive "nothing left to do" signal on current pi;
  // agent_end is kept mapped for older versions. Duplicate Stops are deduped.
  agent_settled: "Stop",
  agent_end: "Stop",
};

const nowIso = () => new Date().toISOString();

export default function (pi: ExtensionAPI) {
  if (!enabled) return;

  // agent_end and agent_settled both map to Stop and fire back-to-back on
  // current pi; suppress the duplicate within a short window.
  let lastStopAt = 0;
  const isDuplicateStop = () => {
    const now = Date.now();
    const duplicate = now - lastStopAt < 1500;
    lastStopAt = now;
    return duplicate;
  };

  const baseCtx = (ctx: any) => {
    const sessionId =
      ctx?.sessionManager?.getSessionId?.() ||
      ctx?.sessionManager?.getSessionFile?.() ||
      "ephemeral";
    const cwd = ctx?.cwd || process.cwd();
    return { sessionId, cwd };
  };

  // Only subscribe to events with a canonical mapping; the rest would just be
  // default blips (and some, like `context`, carry the whole conversation).
  // Note: pi tears down and re-instantiates extensions on /new, /resume,
  // /fork — session_shutdown fires on the old instance, then session_start
  // (with event.reason) on the new one.
  for (const [eventType, mappedEventType] of Object.entries(EVENT_TYPE_MAP)) {
    pi.on(eventType as any, async (event: any, ctx: any) => {
      if (mappedEventType === "Stop" && isDuplicateStop()) return;

      const { sessionId, cwd } = baseCtx(ctx);
      const input = event.input || {};
      const payload = {
        event_type: mappedEventType,
        session_id: sessionId,
        machine_id: machineId,
        timestamp: nowIso(),
        cwd,
        tool_name: event.toolName || "",
        // Only the keys the client reads (eventDetail in apps/client/src/main.ts).
        tool_input: {
          command: input.command,
          file_path: input.file_path,
          pattern: input.pattern,
          url: input.url,
          action: input.action,
        },
      };

      // Fire and forget: best-effort telemetry must never block pi. The
      // timeout frees the socket if the server stalls.
      const sent = fetch(`${url}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000),
      }).catch(() => {});
      // On quit pi calls process.exit() as soon as session_shutdown handlers
      // resolve, so this one send is awaited (bounded by the timeout).
      if (eventType === "session_shutdown") await sent;
    });
  }
}
