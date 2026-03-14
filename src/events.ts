export interface ClaudeHookEventSpec {
  event: string;
  matcherSupported: boolean;
}

export interface ClaudeInstallEvent {
  event: string;
  matcher?: string;
}

export const CLAUDE_HOOK_EVENT_SPECS: ClaudeHookEventSpec[] = [
  { event: "SessionStart", matcherSupported: true },
  { event: "UserPromptSubmit", matcherSupported: false },
  { event: "PreToolUse", matcherSupported: true },
  { event: "PermissionRequest", matcherSupported: true },
  { event: "PostToolUse", matcherSupported: true },
  { event: "PostToolUseFailure", matcherSupported: true },
  { event: "Notification", matcherSupported: true },
  { event: "SubagentStart", matcherSupported: true },
  { event: "SubagentStop", matcherSupported: true },
  { event: "Stop", matcherSupported: false },
  { event: "TeammateIdle", matcherSupported: false },
  { event: "TaskCompleted", matcherSupported: false },
  { event: "InstructionsLoaded", matcherSupported: false },
  { event: "ConfigChange", matcherSupported: true },
  { event: "WorktreeCreate", matcherSupported: false },
  { event: "WorktreeRemove", matcherSupported: false },
  { event: "PreCompact", matcherSupported: true },
  { event: "PostCompact", matcherSupported: true },
  { event: "Elicitation", matcherSupported: true },
  { event: "ElicitationResult", matcherSupported: true },
  { event: "SessionEnd", matcherSupported: true },
];

const MATCH_ALL = ".*";

export const CLAUDE_HOOK_INSTALL_EVENTS: ClaudeInstallEvent[] = CLAUDE_HOOK_EVENT_SPECS.map(
  ({ event, matcherSupported }) =>
    matcherSupported ? { event, matcher: MATCH_ALL } : { event },
);

const EVENT_TYPE_ALIASES: Record<string, string> = {
  // Cursor hook names
  beforeShellExecution: "PreToolUse",
  afterShellExecution: "PostToolUse",
  beforeMCPExecution: "PreToolUse",
  afterMCPExecution: "PostToolUse",
  beforeReadFile: "PreToolUse",
  afterFileEdit: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  afterAgentResponse: "Notification",
  afterAgentThought: "Notification",
  stop: "Stop",

  // OpenCode (fallback normalization)
  "tool.execute.before": "PreToolUse",
  "tool.execute.after": "PostToolUse",
  "session.created": "SessionStart",
  "session.deleted": "SessionEnd",
  "session.idle": "Stop",
  "session.error": "Stop",

  // Pi (fallback normalization)
  tool_call: "PreToolUse",
  tool_result: "PostToolUse",
  session_start: "SessionStart",
  session_before_compact: "PreCompact",
  session_compact: "PostCompact",
  session_shutdown: "SessionEnd",
  agent_end: "Stop",
};

const DEFAULT_TOOL_NAME_BY_EVENT: Record<string, string> = {
  beforeShellExecution: "Bash",
  afterShellExecution: "Bash",
  beforeMCPExecution: "MCP",
  afterMCPExecution: "MCP",
  beforeReadFile: "Read",
  afterFileEdit: "Edit",
  "tool.execute.before": "tool",
  "tool.execute.after": "tool",
};

export function normalizeEventType(rawEventType: string): {
  eventType: string;
  originalEventType?: string;
} {
  const trimmed = rawEventType.trim();
  if (!trimmed) {
    return { eventType: "UnknownEvent" };
  }

  const mapped = EVENT_TYPE_ALIASES[trimmed] || trimmed;
  if (mapped === trimmed) {
    return { eventType: mapped };
  }

  return {
    eventType: mapped,
    originalEventType: trimmed,
  };
}

export function inferDefaultToolName(rawEventType: string): string {
  return DEFAULT_TOOL_NAME_BY_EVENT[rawEventType] || "";
}

export function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  if (value === undefined || value === null) {
    return {};
  }

  return { value };
}

export function toString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}
