// Type-only import: erased at compile time, so this also works on older pi
// installs that still resolve the legacy @mariozechner scope.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";

const DEFAULT_URL = "http://localhost:3334";
const BUILT_URL = "__BINGBONG_URL__";

const envUrl = process.env.BINGBONG_URL;
const url = envUrl && envUrl.length > 0 ? envUrl : BUILT_URL || DEFAULT_URL;
const enabled = (process.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
const machineId = process.env.BINGBONG_MACHINE_ID || os.hostname();

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

const mapEventType = (eventType: string) => EVENT_TYPE_MAP[eventType] || eventType;

const nowIso = () => new Date().toISOString();

const safeJson = (value: unknown) => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
};

export default function (pi: ExtensionAPI) {
  // agent_end and agent_settled both map to Stop and fire back-to-back on
  // current pi; suppress the duplicate within a short window.
  let lastStopAt = 0;
  const isDuplicateStop = () => {
    const now = Date.now();
    const duplicate = now - lastStopAt < 1500;
    lastStopAt = now;
    return duplicate;
  };

  const sendEvent = async ({
    eventType,
    sessionId,
    cwd,
    toolName = "",
    toolInput = {},
    toolOutput = {},
  }: {
    eventType: string;
    sessionId: string;
    cwd: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: Record<string, unknown>;
  }) => {
    if (!enabled) return;

    const mappedEventType = mapEventType(eventType);
    if (mappedEventType === "Stop" && isDuplicateStop()) return;

    const output =
      mappedEventType === eventType
        ? toolOutput
        : { ...safeJson(toolOutput), original_event_type: eventType };

    const payload = {
      event_type: mappedEventType,
      session_id: sessionId,
      machine_id: machineId,
      timestamp: nowIso(),
      cwd,
      tool_name: toolName,
      tool_input: safeJson(toolInput),
      tool_output: output,
    };

    try {
      await fetch(`${url}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Best-effort telemetry; never block pi.
    }
  };

  const baseCtx = (ctx: any) => {
    const sessionId =
      ctx?.sessionManager?.getSessionId?.() ||
      ctx?.sessionManager?.getSessionFile?.() ||
      "ephemeral";
    const cwd = ctx?.cwd || process.cwd();
    return { sessionId, cwd };
  };

  const on = (eventType: string) => {
    pi.on(eventType as any, async (event: any, ctx: any) => {
      const { sessionId, cwd } = baseCtx(ctx);
      const isToolCall = eventType === "tool_call";
      const isToolResult = eventType === "tool_result";

      if (isToolCall) {
        await sendEvent({
          eventType,
          sessionId,
          cwd,
          toolName: event.toolName || "",
          toolInput: event.input || {},
          toolOutput: {},
        });
        return;
      }

      if (isToolResult) {
        await sendEvent({
          eventType,
          sessionId,
          cwd,
          toolName: event.toolName || "",
          toolInput: event.input || {},
          toolOutput: {
            content: event.content,
            details: event.details,
            isError: event.isError,
          },
        });
        return;
      }

      await sendEvent({
        eventType,
        sessionId,
        cwd,
        toolOutput: { event },
      });
    });
  };

  // Session events. Note: pi tears down and re-instantiates extensions on
  // /new, /resume, /fork — session_shutdown fires on the old instance, then
  // session_start (with event.reason) on the new one. The post-transition
  // events session_switch/session_branch/session_fork were removed upstream.
  on("session_start");
  on("session_info_changed");
  on("session_before_switch");
  on("session_before_fork");
  on("session_before_compact");
  on("session_compact");
  on("session_before_tree");
  on("session_tree");
  on("session_shutdown");

  // Agent events
  on("before_agent_start");
  on("agent_start");
  on("turn_start");
  on("context");
  on("turn_end");
  on("agent_end");
  on("agent_settled");

  // Tool events
  on("tool_call");
  on("tool_result");
}
