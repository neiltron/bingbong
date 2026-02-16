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

function getBingbongCommand(): string {
  try {
    const result = Bun.spawnSync(["which", "bingbong"]);
    const resolved = result.stdout.toString().trim();
    if (result.exitCode === 0 && resolved) {
      // Reject npx temp paths — these won't exist after the npx session ends.
      // When `npx bingbong install-hooks` runs, npx temporarily puts bingbong
      // on PATH, so `which` finds it. But that path disappears after npx exits.
      if (resolved.includes("/_npx/") || resolved.includes("/.npm/_npx")) {
        return "npx -y bingbong";
      }
      return "bingbong";
    }
  } catch {}
  return "npx -y bingbong";
}

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

// ---------------------------------------------------------------------------
// Claude Code installer
// ---------------------------------------------------------------------------

const CLAUDE_EVENTS: Array<{ event: string; matcher: string }> = [
  { event: "PreToolUse",        matcher: ".*" },
  { event: "PostToolUse",       matcher: ".*" },
  { event: "SessionStart",      matcher: "" },
  { event: "SessionEnd",        matcher: "" },
  { event: "Stop",              matcher: "" },
  { event: "SubagentStop",      matcher: "" },
  { event: "PermissionRequest", matcher: "" },
  { event: "Notification",      matcher: "" },
  { event: "PreCompact",        matcher: "" },
  { event: "Setup",             matcher: "" },
  { event: "UserPromptSubmit",  matcher: "" },
];

function isBingbongClaudeEntry(entry: any): boolean {
  const hooks = entry?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h: any) => {
    const cmd = typeof h?.command === "string" ? h.command : "";
    return cmd.includes("/agents/claude/hooks/") || cmd.includes("bingbong emit");
  });
}

async function installClaude(_agentsDir: string): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = join(homedir(), ".claude", "settings.json");

  ensureDir(dirname(configPath));

  const settings = await readJsonFile(configPath, {});
  const existingHooks: Record<string, any[]> = settings.hooks || {};

  // Strip old bingbong entries (both shell script paths and bingbong emit commands)
  const cleanedHooks: Record<string, any[]> = {};
  for (const [event, entries] of Object.entries(existingHooks)) {
    if (!Array.isArray(entries)) continue;
    cleanedHooks[event] = entries.filter((entry: any) => !isBingbongClaudeEntry(entry));
  }

  // Add fresh bingbong entries using `bingbong emit`
  for (const { event, matcher } of CLAUDE_EVENTS) {
    const bingbongEntry = {
      matcher,
      hooks: [{ type: "command", command: `${bingbongCmd} emit ${event}` }],
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

function isBingbongCursorEntry(entry: any): boolean {
  const cmd = typeof entry?.command === "string" ? entry.command : "";
  return cmd.includes("bingbong-hook.sh") || cmd.includes("bingbong emit");
}

async function installCursor(_agentsDir: string): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = join(homedir(), ".cursor", "hooks.json");

  ensureDir(dirname(configPath));

  const config = await readJsonFile(configPath, { version: 1, hooks: {} });
  config.version = config.version || 1;
  config.hooks = config.hooks || {};

  // Strip old bingbong entries (both bingbong-hook.sh and bingbong emit commands)
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    config.hooks[event] = entries.filter((entry: any) => !isBingbongCursorEntry(entry));
  }

  // Add fresh bingbong entries using `bingbong emit`
  for (const event of CURSOR_EVENTS) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    config.hooks[event].push({ command: `${bingbongCmd} emit ${event}` });
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
