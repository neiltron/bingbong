// Sonicify OpenCode plugin
// Emits OpenCode events to the Sonicify server for audio rendering.

import os from "node:os";

const DEFAULT_URL = "http://localhost:3333";

const SONICIFY_URL = Bun.env.SONICIFY_URL || DEFAULT_URL;
const SONICIFY_ENABLED = (Bun.env.SONICIFY_ENABLED || "true").toLowerCase() !== "false";
const MACHINE_ID = Bun.env.SONICIFY_MACHINE_ID || os.hostname();

const TOOL_EVENT_TYPES = new Set(["tool.execute.before", "tool.execute.after"]);

const nowIso = () => new Date().toISOString();

const safeJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
};

const extractSessionId = (candidate) =>
  candidate?.session?.id ||
  candidate?.sessionId ||
  candidate?.session_id ||
  candidate?.threadId ||
  candidate?.thread_id ||
  candidate?.id ||
  "unknown";

const extractCwd = (event, directory) => event?.cwd || event?.directory || directory || "";

const sendEvent = async ({
  eventType,
  sessionId,
  cwd,
  toolName = "",
  toolInput = {},
  toolOutput = {},
}) => {
  if (!SONICIFY_ENABLED) return;

  const payload = {
    event_type: eventType,
    session_id: sessionId,
    machine_id: MACHINE_ID,
    timestamp: nowIso(),
    cwd,
    tool_name: toolName,
    tool_input: safeJson(toolInput),
    tool_output: safeJson(toolOutput),
  };

  try {
    await fetch(`${SONICIFY_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never block OpenCode execution on telemetry failures.
  }
};

export const SonicifyPlugin = async ({ directory }) => {
  return {
    event: async ({ event }) => {
      if (!event || TOOL_EVENT_TYPES.has(event.type)) return;

      await sendEvent({
        eventType: event.type || "unknown",
        sessionId: extractSessionId(event),
        cwd: extractCwd(event, directory),
        toolName: event.tool || event.tool_name || "",
        toolInput: event.tool_input || {},
        toolOutput: event.tool_output || {},
      });
    },

    "tool.execute.before": async (input, output) => {
      await sendEvent({
        eventType: "tool.execute.before",
        sessionId: extractSessionId(input || output),
        cwd: extractCwd(output, directory),
        toolName: input?.tool || "",
        toolInput: output?.args || {},
        toolOutput: {},
      });
    },

    "tool.execute.after": async (input, output) => {
      await sendEvent({
        eventType: "tool.execute.after",
        sessionId: extractSessionId(input || output),
        cwd: extractCwd(output, directory),
        toolName: input?.tool || "",
        toolInput: output?.args || {},
        toolOutput: output?.result || output || {},
      });
    },
  };
};
