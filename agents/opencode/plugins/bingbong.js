// Bingbong OpenCode plugin
// Emits OpenCode events to the Bingbong server for audio rendering.

import os from "node:os";

const DEFAULT_URL = "http://localhost:3334";

const BINGBONG_URL = Bun.env.BINGBONG_URL || DEFAULT_URL;
const BINGBONG_ENABLED = (Bun.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
const MACHINE_ID = Bun.env.BINGBONG_MACHINE_ID || os.hostname();

const nowIso = () => new Date().toISOString();

const extractSessionId = (candidate) =>
  candidate?.properties?.sessionID ||
  candidate?.properties?.info?.id ||
  candidate?.sessionID ||
  candidate?.session?.id ||
  candidate?.sessionId ||
  candidate?.session_id ||
  candidate?.threadId ||
  candidate?.thread_id ||
  candidate?.id ||
  "unknown";

const extractCwd = (event, directory) => event?.cwd || event?.directory || directory || "";

const EVENT_TYPE_MAP = {
  "tool.execute.before": "PreToolUse",
  "tool.execute.after": "PostToolUse",
  "session.created": "SessionStart",
  "session.deleted": "SessionEnd",
  "session.idle": "Stop", // deprecated upstream in favor of session.status, still published
  "session.error": "Stop",
  "session.compacted": "PostCompact",
  "permission.asked": "PermissionRequest",
};

// session.idle (deprecated) and session.status{type:"idle"} are both published
// on current OpenCode; suppress the duplicate Stop within a short window.
const lastStopAt = new Map();
const isDuplicateStop = (sessionId) => {
  const now = Date.now();
  const last = lastStopAt.get(sessionId) || 0;
  lastStopAt.set(sessionId, now);
  return now - last < 1500;
};

const sendEvent = ({ eventType, sessionId, cwd, toolName = "", toolInput = {} }) => {
  if (!BINGBONG_ENABLED) return;

  const mappedEventType = EVENT_TYPE_MAP[eventType];
  if (mappedEventType === "Stop" && isDuplicateStop(sessionId)) return;

  const payload = {
    event_type: mappedEventType,
    session_id: sessionId,
    machine_id: MACHINE_ID,
    timestamp: nowIso(),
    cwd,
    tool_name: toolName,
    // Only the keys the client reads (eventDetail in apps/client/src/main.ts).
    tool_input: {
      command: toolInput.command,
      file_path: toolInput.file_path,
      pattern: toolInput.pattern,
      url: toolInput.url,
      action: toolInput.action,
    },
  };

  // Fire and forget: never block OpenCode on telemetry. The timeout frees the
  // socket if the server stalls.
  void fetch(`${BINGBONG_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(1000),
  }).catch(() => {});
};

export const BingbongPlugin = async ({ directory }) => {
  return {
    // Only mapped bus events; everything else (incl. high-frequency
    // message.part.* streaming deltas) is dropped.
    event: async ({ event }) => {
      // session.status replaces the deprecated session.idle; only the idle
      // transition is audibly interesting.
      const type =
        event?.type === "session.status" && event.properties?.status?.type === "idle"
          ? "session.idle"
          : event?.type;
      if (!EVENT_TYPE_MAP[type]) return;
      sendEvent({
        eventType: type,
        sessionId: extractSessionId(event),
        cwd: extractCwd(event, directory),
      });
    },

    // input: { tool, sessionID, callID }, output: { args }
    "tool.execute.before": async (input, output) => {
      sendEvent({
        eventType: "tool.execute.before",
        sessionId: extractSessionId(input || output),
        cwd: extractCwd(output, directory),
        toolName: input?.tool || "",
        toolInput: output?.args || {},
      });
    },

    // input: { tool, sessionID, callID, args }, output: { title, output, metadata }
    "tool.execute.after": async (input, output) => {
      sendEvent({
        eventType: "tool.execute.after",
        sessionId: extractSessionId(input || output),
        cwd: extractCwd(output, directory),
        toolName: input?.tool || "",
        toolInput: input?.args || output?.args || {},
      });
    },
  };
};
