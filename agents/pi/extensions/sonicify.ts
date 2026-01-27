import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import os from "node:os";

const DEFAULT_URL = "http://localhost:3333";
const BUILT_URL = "__SONICIFY_URL__";

const envUrl = process.env.SONICIFY_URL;
const url = envUrl && envUrl.length > 0 ? envUrl : BUILT_URL || DEFAULT_URL;
const enabled = (process.env.SONICIFY_ENABLED || "true").toLowerCase() !== "false";
const machineId = process.env.SONICIFY_MACHINE_ID || os.hostname();

const EVENT_TYPE_MAP: Record<string, string> = {
  tool_call: "PreToolUse",
  tool_result: "PostToolUse",
  session_start: "SessionStart",
  session_shutdown: "SessionEnd",
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
    const sessionId = ctx?.sessionManager?.getSessionFile?.() || "ephemeral";
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

  // Session events
  on("session_start");
  on("session_before_switch");
  on("session_switch");
  on("session_before_branch");
  on("session_branch");
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

  // Tool events
  on("tool_call");
  on("tool_result");
}
