/**
 * bingbong install-hooks
 *
 * Installs bingbong hooks for supported coding agents.
 * All four agent installers live in this single file.
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, chmodSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const AGENTS_DIR = join(ROOT_DIR, "agents");

// Agent registry — known at compile time, no interface needed
const AGENTS: Record<string, { display: string; configHint: string }> = {
  claude:   { display: "Claude Code", configHint: "~/.claude/settings.json" },
  cursor:   { display: "Cursor",      configHint: "~/.cursor/hooks.json" },
  opencode: { display: "OpenCode",    configHint: "~/.config/opencode/plugins/" },
  pi:       { display: "Pi",          configHint: "~/.pi/agent/extensions/" },
};

const INSTALLERS: Record<string, (agentsDir: string) => Promise<string>> = {
  claude: installClaude,
  cursor: installCursor,
  opencode: installOpencode,
  pi: installPi,
};

function printUsage() {
  console.log(`
Usage: bingbong install-hooks <agent>

Available agents:
  claude     Claude Code (${AGENTS.claude.configHint})
  cursor     Cursor (${AGENTS.cursor.configHint})
  opencode   OpenCode (${AGENTS.opencode.configHint})
  pi         Pi (${AGENTS.pi.configHint})

Example: bingbong install-hooks cursor
`);
}

export async function installHooks(argv: string[]) {
  const agentName = argv[0];

  if (!agentName || agentName === "--help" || agentName === "-h") {
    printUsage();
    return;
  }

  if (agentName.startsWith("-")) {
    console.error(`Error: Unknown option "${agentName}".`);
    printUsage();
    process.exit(1);
  }

  const installer = INSTALLERS[agentName];
  if (!installer) {
    console.error(`Error: Unknown agent "${agentName}".`);
    console.error(`\nAvailable agents: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }

  if (!existsSync(AGENTS_DIR)) {
    console.error(
      `Error: Could not find agents directory at ${AGENTS_DIR}\n` +
      `This can happen with bundled builds. Install from source or npm instead.`
    );
    process.exit(1);
  }

  const configPath = await installer(AGENTS_DIR);
  console.log(`Installed hooks for ${AGENTS[agentName].display} in ${configPath}`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function readJsonFile(filePath: string, defaultValue: object): Promise<any> {
  if (!existsSync(filePath)) return { ...defaultValue };

  const raw = await readFile(filePath, "utf-8");
  if (!raw.trim()) return { ...defaultValue };

  try {
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in ${filePath}`);
      console.error(`  ${err.message}`);
      console.error(`\nFix the JSON manually, then re-run this command.`);
      process.exit(1);
    }
    throw err;
  }
}

async function atomicWriteJson(filePath: string, data: object) {
  const content = JSON.stringify(data, null, 2) + "\n";

  // Validate by parsing before writing
  JSON.parse(content);

  // Temp file in same directory to avoid EXDEV on cross-filesystem rename
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, content, "utf-8");

    // Preserve permissions of existing file
    if (existsSync(filePath)) {
      try {
        const stats = statSync(filePath);
        chmodSync(tempPath, stats.mode);
      } catch {
        // Best effort — default permissions are fine
      }
    }

    renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tempPath); } catch {}
    throw err;
  }
}

function verifyScriptExists(scriptPath: string, label: string) {
  if (!existsSync(scriptPath)) {
    console.error(`Warning: Hook script not found: ${scriptPath} (${label})`);
  }
}

// ---------------------------------------------------------------------------
// Claude Code installer
// ---------------------------------------------------------------------------

const CLAUDE_EVENTS: Array<{ event: string; matcher: string; script: string }> = [
  { event: "PreToolUse",        matcher: ".*", script: "pre-tool-use.sh" },
  { event: "PostToolUse",       matcher: ".*", script: "post-tool-use.sh" },
  { event: "SessionStart",      matcher: "",   script: "session-start.sh" },
  { event: "SessionEnd",        matcher: "",   script: "session-end.sh" },
  { event: "Stop",              matcher: "",   script: "stop.sh" },
  { event: "SubagentStop",      matcher: "",   script: "subagent-stop.sh" },
  { event: "PermissionRequest", matcher: "",   script: "permission-request.sh" },
  { event: "Notification",      matcher: "",   script: "notification.sh" },
  { event: "PreCompact",        matcher: "",   script: "pre-compact.sh" },
  { event: "Setup",             matcher: "",   script: "setup.sh" },
  { event: "UserPromptSubmit",  matcher: "",   script: "user-prompt-submit.sh" },
];

async function installClaude(agentsDir: string): Promise<string> {
  const hooksDir = join(agentsDir, "claude", "hooks");
  const configPath = join(homedir(), ".claude", "settings.json");

  ensureDir(dirname(configPath));

  const settings = await readJsonFile(configPath, {});
  const existingHooks: Record<string, any[]> = settings.hooks || {};

  // Strip old bingbong entries from each event (match on /agents/claude/hooks/ path)
  const cleanedHooks: Record<string, any[]> = {};
  for (const [event, entries] of Object.entries(existingHooks)) {
    if (!Array.isArray(entries)) continue;
    cleanedHooks[event] = entries.filter((entry: any) => {
      const hooks = entry?.hooks;
      if (!Array.isArray(hooks)) return true;
      // Keep entry if none of its hooks reference bingbong's claude hooks dir
      return !hooks.some((h: any) =>
        typeof h?.command === "string" && h.command.includes("/agents/claude/hooks/")
      );
    });
  }

  // Add fresh bingbong entries
  for (const { event, matcher, script } of CLAUDE_EVENTS) {
    const scriptPath = join(hooksDir, script);
    verifyScriptExists(scriptPath, event);

    const bingbongEntry = {
      matcher,
      hooks: [{ type: "command", command: scriptPath }],
    };

    if (!cleanedHooks[event]) {
      cleanedHooks[event] = [];
    }
    cleanedHooks[event].push(bingbongEntry);
  }

  await atomicWriteJson(configPath, { ...settings, hooks: cleanedHooks });
  return configPath;
}

// ---------------------------------------------------------------------------
// Cursor installer
// ---------------------------------------------------------------------------

const CURSOR_EVENTS = [
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "beforeSubmitPrompt",
  "afterAgentResponse",
  "afterAgentThought",
  "stop",
];

async function installCursor(agentsDir: string): Promise<string> {
  const hookScript = join(agentsDir, "cursor", "hooks", "bingbong-hook.sh");
  const configPath = join(homedir(), ".cursor", "hooks.json");

  verifyScriptExists(hookScript, "cursor bingbong-hook.sh");
  ensureDir(dirname(configPath));

  const config = await readJsonFile(configPath, { version: 1, hooks: {} });
  config.version = config.version || 1;
  config.hooks = config.hooks || {};

  // Strip old bingbong entries from all events (match on bingbong-hook.sh)
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    config.hooks[event] = entries.filter(
      (entry: any) => !(typeof entry?.command === "string" && entry.command.includes("bingbong-hook.sh"))
    );
  }

  // Add fresh bingbong entries
  for (const event of CURSOR_EVENTS) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    config.hooks[event].push({ command: `${hookScript} ${event}` });
  }

  await atomicWriteJson(configPath, config);
  return configPath;
}

// ---------------------------------------------------------------------------
// OpenCode installer
// ---------------------------------------------------------------------------

async function installOpencode(agentsDir: string): Promise<string> {
  const sourcePath = join(agentsDir, "opencode", "plugins", "bingbong.js");
  const targetPath = join(homedir(), ".config", "opencode", "plugins", "bingbong.js");

  if (!existsSync(sourcePath)) {
    console.error(`Error: Source plugin not found: ${sourcePath}`);
    process.exit(1);
  }

  ensureDir(dirname(targetPath));

  const content = await readFile(sourcePath, "utf-8");
  await writeFile(targetPath, content, "utf-8");

  return targetPath;
}

// ---------------------------------------------------------------------------
// Pi installer
// ---------------------------------------------------------------------------

async function installPi(agentsDir: string): Promise<string> {
  const sourcePath = join(agentsDir, "pi", "extensions", "bingbong.ts");
  const extensionsDir = process.env.PI_EXTENSIONS_DIR || join(homedir(), ".pi", "agent", "extensions");
  const targetPath = join(extensionsDir, "bingbong.ts");
  const bingbongUrl = process.env.BINGBONG_URL || "http://localhost:3334";

  if (!existsSync(sourcePath)) {
    console.error(`Error: Source extension not found: ${sourcePath}`);
    process.exit(1);
  }

  ensureDir(extensionsDir);

  const content = await readFile(sourcePath, "utf-8");
  const transformed = content.replace("__BINGBONG_URL__", bingbongUrl);
  await writeFile(targetPath, transformed, "utf-8");

  return targetPath;
}
