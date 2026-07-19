// Bingbong OpenCode plugin
// Emits OpenCode events to the Bingbong server for audio rendering.

import os from "node:os";

const DEFAULT_URL = "http://localhost:3334";

const BINGBONG_URL = Bun.env.BINGBONG_URL || DEFAULT_URL;
const BINGBONG_ENABLED = (Bun.env.BINGBONG_ENABLED || "true").toLowerCase() !== "false";
const MACHINE_ID = Bun.env.BINGBONG_MACHINE_ID || os.hostname();

const TOOL_EVENT_TYPES = new Set(["tool.execute.before", "tool.execute.after"]);

// High-frequency / non-session bus events that would flood the soundscape.
// message.part.* fires on every streaming delta; session.next.* is the new
// fine-grained streaming event family.
const IGNORED_PREFIXES = [
  "message.part.",
  "session.next.",
  "lsp.",
  "tui.",
  "pty.",
  "installation.",
  "file.watcher.",
  "models-dev.",
  "catalog.",
];
const IGNORED_TYPES = new Set(["server.connected", "global.disposed"]);

const shouldIgnore = (type) =>
  IGNORED_TYPES.has(type) || IGNORED_PREFIXES.some((p) => type.startsWith(p));

const nowIso = () => new Date().toISOString();

const safeJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
};

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

const mapEventType = (eventType) => EVENT_TYPE_MAP[eventType] || eventType;

// session.idle (deprecated) and session.status{type:"idle"} are both published
// on current OpenCode; suppress the duplicate Stop within a short window.
const lastStopAt = new Map();
const isDuplicateStop = (sessionId) => {
  const now = Date.now();
  const last = lastStopAt.get(sessionId) || 0;
  lastStopAt.set(sessionId, now);
  return now - last < 1500;
};

const sendEvent = async ({
  eventType,
  sessionId,
  cwd,
  toolName = "",
  toolInput = {},
  toolOutput = {},
}) => {
  if (!BINGBONG_ENABLED) return;

  const mappedEventType = mapEventType(eventType);
  if (mappedEventType === "Stop" && isDuplicateStop(sessionId)) return;

  const output =
    mappedEventType === eventType
      ? toolOutput
      : { ...safeJson(toolOutput), original_event_type: eventType };

  const payload = {
    event_type: mappedEventType,
    session_id: sessionId,
    machine_id: MACHINE_ID,
    timestamp: nowIso(),
    cwd,
    tool_name: toolName,
    tool_input: safeJson(toolInput),
    tool_output: output,
  };

  try {
    await fetch(`${BINGBONG_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never block OpenCode execution on telemetry failures.
  }
};

export const BingbongPlugin = async ({ directory }) => {
  return {
    event: async ({ event }) => {
      if (!event || TOOL_EVENT_TYPES.has(event.type) || shouldIgnore(event.type)) return;

      // session.status replaces the deprecated session.idle; only the idle
      // transition is audibly interesting.
      if (event.type === "session.status") {
        if (event.properties?.status?.type !== "idle") return;
        await sendEvent({
          eventType: "session.idle",
          sessionId: extractSessionId(event),
          cwd: extractCwd(event, directory),
        });
        return;
      }

      await sendEvent({
        eventType: event.type || "unknown",
        sessionId: extractSessionId(event),
        cwd: extractCwd(event, directory),
        toolName: event.tool || event.tool_name || "",
        toolInput: event.tool_input || {},
        toolOutput: event.tool_output || {},
      });
    },

    // input: { tool, sessionID, callID }, output: { args }
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

    // input: { tool, sessionID, callID, args }, output: { title, output, metadata }
    "tool.execute.after": async (input, output) => {
      await sendEvent({
        eventType: "tool.execute.after",
        sessionId: extractSessionId(input || output),
        cwd: extractCwd(output, directory),
        toolName: input?.tool || "",
        toolInput: input?.args || output?.args || {},
        toolOutput: {
          title: output?.title,
          output: output?.output,
          metadata: output?.metadata,
        },
      });
    },
  };
};
