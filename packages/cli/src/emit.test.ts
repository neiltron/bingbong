import { describe, expect, test } from "bun:test";
import type { BingbongEvent } from "@bingbong/protocol";
import { shapePayload } from "./emit";

const base = {
  event_type: "PreToolUse",
  session_id: "abc",
  machine_id: "laptop",
  timestamp: "2026-01-01T00:00:00.000Z",
};

const claudePayload = {
  ...base,
  cwd: "/tmp/x",
  tool_name: "Bash",
  original_event_type: "beforeShellExecution",
  tool_input: { command: "ls -la", description: "secret", timeout: 5 },
  tool_output: { stdout: "big" },
  tool_response: { stdout: "big" },
  transcript_path: "/home/me/.claude/t.jsonl",
  prompt: "do the thing",
} as BingbongEvent;

describe("shapePayload metadata", () => {
  test("keeps whitelisted keys and strips everything else", () => {
    expect(shapePayload(claudePayload, "metadata")).toEqual({
      ...base,
      cwd: "/tmp/x",
      tool_name: "Bash",
      original_event_type: "beforeShellExecution",
      tool_input: { command: "ls -la" },
    } as BingbongEvent);
  });

  test("reduces tool_input to string display keys, truncated to 256 chars", () => {
    const out = shapePayload(
      {
        ...base,
        tool_input: {
          command: "x".repeat(1000),
          file_path: "/a/b.ts",
          pattern: "foo",
          url: "https://e.x",
          action: "click",
          content: "file body",
          old_string: "a",
        },
      },
      "metadata",
    );
    expect(out.tool_input).toEqual({
      command: "x".repeat(256),
      file_path: "/a/b.ts",
      pattern: "foo",
      url: "https://e.x",
      action: "click",
    });
  });

  test("omits tool_input when nothing displayable is left", () => {
    const out = shapePayload({ ...base, tool_input: { content: "x", command: 42 } }, "metadata");
    expect(out).toEqual(base as BingbongEvent);
    expect("tool_input" in out).toBe(false);
  });

  test("forwards a string parent_session_id, drops a non-string one", () => {
    expect(shapePayload({ ...base, parent_session_id: "root" }, "metadata")).toEqual({
      ...base,
      parent_session_id: "root",
    } as BingbongEvent);
    const malformed = { ...base, parent_session_id: { prompt: "secret" } } as unknown as BingbongEvent;
    const out = shapePayload(malformed, "metadata");
    expect(out).toEqual(base as BingbongEvent);
    expect("parent_session_id" in out).toBe(false);
    expect(shapePayload(malformed, "full")).toEqual(malformed);
  });
});

test("shapePayload full passes everything through unchanged", () => {
  expect(shapePayload(claudePayload, "full")).toEqual(claudePayload);
});
