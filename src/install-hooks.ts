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
      return "bingbong";
    }
  } catch {}

  console.error(
    "Error: Could not find `bingbong` on PATH.\n" +
    "Install it first (curl installer), then re-run `bingbong install-hooks <agent>`."
  );
  process.exit(1);
}

// Agent registry — known at compile time, no interface needed
const AGENTS: Record<string, { display: string; configHint: string }> = {
  claude:   { display: "Claude Code", configHint: "~/.claude/settings.json" },
  cursor:   { display: "Cursor",      configHint: "~/.cursor/hooks.json" },
  opencode: { display: "OpenCode",    configHint: "~/.config/opencode/plugins/" },
  pi:       { display: "Pi",          configHint: "~/.pi/agent/extensions/" },
};

const INSTALLERS: Record<string, (agentsDir: string, dryRun: boolean) => Promise<string>> = {
  claude: installClaude,
  cursor: installCursor,
  opencode: installOpencode,
  pi: installPi,
};

function printUsage() {
  console.log(`
Usage: bingbong install-hooks [--dry-run] <agent>

Options:
  --dry-run  Preview changes without writing any files

Available agents:
  claude     Claude Code (${AGENTS.claude.configHint})
  cursor     Cursor (${AGENTS.cursor.configHint})
  opencode   OpenCode (${AGENTS.opencode.configHint})
  pi         Pi (${AGENTS.pi.configHint})

Examples:
  bingbong install-hooks cursor
  bingbong install-hooks --dry-run claude
`);
}

export async function installHooks(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter(a => a !== "--dry-run");
  const agentName = args[0];

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
      `This can happen with bundled builds. Install from source checkout or binary release package.`
    );
    process.exit(1);
  }

  const configPath = await installer(AGENTS_DIR, dryRun);
  if (dryRun) {
    console.log(`\nRun without --dry-run to apply these changes.`);
  } else {
    console.log(`Installed hooks for ${AGENTS[agentName].display} in ${configPath}`);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function printPreview(filePath: string, existingContent: string | null, proposedContent: string) {
  const displayPath = filePath.replace(homedir(), "~");

  if (existingContent !== null && existingContent === proposedContent) {
    console.log(`No changes needed in ${displayPath}`);
    return;
  }

  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const green = useColor ? "\x1b[32m" : "";
  const cyan = useColor ? "\x1b[36m" : "";
  const reset = useColor ? "\x1b[0m" : "";
  const label = existingContent === null ? "create" : "update";

  console.log(`${cyan}Would ${label}: ${displayPath}${reset}\n`);
  for (const line of proposedContent.split("\n")) {
    if (line) console.log(`${green}  ${line}${reset}`);
  }
}

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

async function installClaude(_agentsDir: string, dryRun: boolean): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = join(homedir(), ".claude", "settings.json");

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

  const proposed = { ...settings, hooks: cleanedHooks };

  if (dryRun) {
    const existingContent = existsSync(configPath) ? await readFile(configPath, "utf-8") : null;
    printPreview(configPath, existingContent, JSON.stringify(proposed, null, 2) + "\n");
    return configPath;
  }

  ensureDir(dirname(configPath));
  await atomicWriteJson(configPath, proposed);
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

async function installCursor(_agentsDir: string, dryRun: boolean): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = join(homedir(), ".cursor", "hooks.json");

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

  if (dryRun) {
    const existingContent = existsSync(configPath) ? await readFile(configPath, "utf-8") : null;
    printPreview(configPath, existingContent, JSON.stringify(config, null, 2) + "\n");
    return configPath;
  }

  ensureDir(dirname(configPath));
  await atomicWriteJson(configPath, config);
  return configPath;
}

// ---------------------------------------------------------------------------
// OpenCode installer
// ---------------------------------------------------------------------------

async function installOpencode(agentsDir: string, dryRun: boolean): Promise<string> {
  const sourcePath = join(agentsDir, "opencode", "plugins", "bingbong.js");
  const targetPath = join(homedir(), ".config", "opencode", "plugins", "bingbong.js");

  if (!existsSync(sourcePath)) {
    console.error(`Error: Source plugin not found: ${sourcePath}`);
    process.exit(1);
  }

  const content = await readFile(sourcePath, "utf-8");

  if (dryRun) {
    const existingContent = existsSync(targetPath) ? await readFile(targetPath, "utf-8") : null;
    printPreview(targetPath, existingContent, content);
    return targetPath;
  }

  ensureDir(dirname(targetPath));
  await writeFile(targetPath, content, "utf-8");

  return targetPath;
}

// ---------------------------------------------------------------------------
// Pi installer
// ---------------------------------------------------------------------------

async function installPi(agentsDir: string, dryRun: boolean): Promise<string> {
  const sourcePath = join(agentsDir, "pi", "extensions", "bingbong.ts");
  const extensionsDir = process.env.PI_EXTENSIONS_DIR || join(homedir(), ".pi", "agent", "extensions");
  const targetPath = join(extensionsDir, "bingbong.ts");
  const bingbongUrl = process.env.BINGBONG_URL || "http://localhost:3334";

  if (!existsSync(sourcePath)) {
    console.error(`Error: Source extension not found: ${sourcePath}`);
    process.exit(1);
  }

  const content = await readFile(sourcePath, "utf-8");
  const transformed = content.replace("__BINGBONG_URL__", bingbongUrl);

  if (dryRun) {
    const existingContent = existsSync(targetPath) ? await readFile(targetPath, "utf-8") : null;
    printPreview(targetPath, existingContent, transformed);
    return targetPath;
  }

  ensureDir(extensionsDir);
  await writeFile(targetPath, transformed, "utf-8");

  return targetPath;
}
