/**
 * bingbong install-hooks
 *
 * Installs and uninstalls bingbong hooks for supported coding agents.
 * All agent installers live in this single file.
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, chmodSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import opencodePluginSource from "../../../agents/opencode/plugins/bingbong.js" with { type: "text" };
import piExtensionSource from "../../../agents/pi/extensions/bingbong.ts" with { type: "text" };
import { loadConfig } from "./config";

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
const AGENTS: Record<string, { display: string; configHint: string; path: string }> = {
  claude:   { display: "Claude Code", configHint: "~/.claude/settings.json",     path: join(homedir(), ".claude", "settings.json") },
  cursor:   { display: "Cursor",      configHint: "~/.cursor/hooks.json",        path: join(homedir(), ".cursor", "hooks.json") },
  opencode: { display: "OpenCode",    configHint: "~/.config/opencode/plugins/", path: join(homedir(), ".config", "opencode", "plugins", "bingbong.js") },
  pi:       { display: "Pi",          configHint: "~/.pi/agent/extensions/",     path: join(process.env.PI_EXTENSIONS_DIR || join(homedir(), ".pi", "agent", "extensions"), "bingbong.ts") },
  codex:    { display: "Codex",       configHint: "~/.codex/hooks.json",         path: join(homedir(), ".codex", "hooks.json") },
};

const INSTALLERS: Record<string, (dryRun: boolean) => Promise<string>> = {
  claude: installClaude,
  cursor: installCursor,
  opencode: installOpencode,
  pi: installPi,
  codex: installCodex,
};

function printUsage(cmd: string) {
  console.log(`
Usage: bingbong ${cmd} [--dry-run] <agent>

Options:
  --dry-run  Preview changes without writing any files

Available agents:
  claude     Claude Code (${AGENTS.claude.configHint})
  cursor     Cursor (${AGENTS.cursor.configHint})
  opencode   OpenCode (${AGENTS.opencode.configHint})
  pi         Pi (${AGENTS.pi.configHint})
  codex      Codex (${AGENTS.codex.configHint})

Examples:
  bingbong ${cmd} cursor
  bingbong ${cmd} --dry-run claude
`);
}

export async function installHooks(argv: string[], uninstall = false) {
  const cmd = uninstall ? "uninstall-hooks" : "install-hooks";
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter(a => a !== "--dry-run");
  const agentName = args[0];

  if (!agentName || agentName === "--help" || agentName === "-h") {
    printUsage(cmd);
    return;
  }

  if (agentName.startsWith("-")) {
    console.error(`Error: Unknown option "${agentName}".`);
    printUsage(cmd);
    process.exit(1);
  }

  const installer = INSTALLERS[agentName];
  if (!installer) {
    console.error(`Error: Unknown agent "${agentName}".`);
    console.error(`\nAvailable agents: ${Object.keys(AGENTS).join(", ")}`);
    process.exit(1);
  }

  if (uninstall && !(await uninstallAgent(agentName, dryRun))) {
    console.log(`No bingbong hooks found for ${AGENTS[agentName].display}.`);
    return;
  }

  const configPath = uninstall ? AGENTS[agentName].path : await installer(dryRun);
  if (dryRun) {
    console.log(`\nRun without --dry-run to apply these changes.`);
  } else if (uninstall) {
    console.log(`Removed hooks for ${AGENTS[agentName].display} from ${configPath}`);
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

// Remove bingbong entries from a hooks map in place, dropping event arrays
// left empty. Returns true if anything was removed.
function stripBingbongEntries(hooks: Record<string, any>, isBingbong: (entry: any) => boolean): boolean {
  let removed = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry: any) => !isBingbong(entry));
    if (kept.length === entries.length) continue;
    removed = true;
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Claude Code installer
// ---------------------------------------------------------------------------

// Audibly-useful subset of Claude Code hook events. The full upstream list
// (~30 events) and the rationale for exclusions live in agents/event-coverage.md.
const CLAUDE_EVENTS: Array<{ event: string; matcher: string }> = [
  { event: "PreToolUse",         matcher: ".*" },
  { event: "PostToolUse",        matcher: ".*" },
  { event: "PostToolUseFailure", matcher: ".*" },
  { event: "SessionStart",       matcher: "" },
  { event: "SessionEnd",         matcher: "" },
  { event: "Stop",               matcher: "" },
  { event: "StopFailure",        matcher: "" },
  { event: "SubagentStart",      matcher: "" },
  { event: "SubagentStop",       matcher: "" },
  { event: "PermissionRequest",  matcher: "" },
  { event: "PermissionDenied",   matcher: "" },
  { event: "Notification",       matcher: "" },
  { event: "PreCompact",         matcher: "" },
  { event: "PostCompact",        matcher: "" },
  { event: "TaskCreated",        matcher: "" },
  { event: "TaskCompleted",      matcher: "" },
  { event: "TeammateIdle",       matcher: "" },
  { event: "Setup",              matcher: "" },
  { event: "UserPromptSubmit",   matcher: "" },
];

function isBingbongClaudeEntry(entry: any): boolean {
  const hooks = entry?.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h: any) => {
    const cmd = typeof h?.command === "string" ? h.command : "";
    return cmd.includes("/agents/claude/hooks/") || cmd.includes("bingbong emit");
  });
}

async function installClaude(dryRun: boolean): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = AGENTS.claude.path;

  const settings = await readJsonFile(configPath, {});
  const cleanedHooks: Record<string, any[]> = settings.hooks || {};

  // Strip old bingbong entries (both shell script paths and bingbong emit commands)
  stripBingbongEntries(cleanedHooks, isBingbongClaudeEntry);

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

// Cursor hook events (camelCase upstream names). `bingbong emit` maps these to
// canonical bingbong event types — see CURSOR_EVENT_MAP in emit.ts.
// Cursor's generic preToolUse/postToolUse are intentionally skipped: they overlap
// the specific before*/after* hooks and would double-fire sounds.
const CURSOR_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "beforeSubmitPrompt",
  "afterAgentResponse",
  "afterAgentThought",
  "postToolUseFailure",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "stop",
];

function isBingbongCursorEntry(entry: any): boolean {
  const cmd = typeof entry?.command === "string" ? entry.command : "";
  return cmd.includes("bingbong-hook.sh") || cmd.includes("bingbong emit");
}

async function installCursor(dryRun: boolean): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = AGENTS.cursor.path;

  const config = await readJsonFile(configPath, { version: 1, hooks: {} });
  config.version = config.version || 1;
  config.hooks = config.hooks || {};

  // Strip old bingbong entries (both bingbong-hook.sh and bingbong emit commands)
  stripBingbongEntries(config.hooks, isBingbongCursorEntry);

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

async function installOpencode(dryRun: boolean): Promise<string> {
  const targetPath = AGENTS.opencode.path;

  if (dryRun) {
    const existingContent = existsSync(targetPath) ? await readFile(targetPath, "utf-8") : null;
    printPreview(targetPath, existingContent, opencodePluginSource);
    return targetPath;
  }

  ensureDir(dirname(targetPath));
  await writeFile(targetPath, opencodePluginSource, "utf-8");

  return targetPath;
}

// ---------------------------------------------------------------------------
// Pi installer
// ---------------------------------------------------------------------------

async function installPi(dryRun: boolean): Promise<string> {
  const targetPath = AGENTS.pi.path;
  const { url, token } = loadConfig();
  const fill = (tokenLiteral: string) =>
    piExtensionSource.replace("__BINGBONG_URL__", url).replace('"__BINGBONG_TOKEN__"', () => tokenLiteral);
  // JSON-quoted so any token is a valid string literal
  const transformed = fill(JSON.stringify(token ?? ""));

  if (dryRun) {
    const existingContent = existsSync(targetPath) ? await readFile(targetPath, "utf-8") : null;
    // Never print the baked token; compare against the real content for "No changes".
    const preview = token ? fill('"<redacted>"') : transformed;
    printPreview(targetPath, existingContent === transformed ? preview : existingContent, preview);
    return targetPath;
  }

  ensureDir(dirname(targetPath));
  await writeFile(targetPath, transformed, "utf-8");
  if (token) chmodSync(targetPath, 0o600); // the baked token is a secret

  return targetPath;
}

// ---------------------------------------------------------------------------
// Codex installer
// ---------------------------------------------------------------------------

// Codex hook events (Claude-style lifecycle hooks, ~/.codex/hooks.json).
// Event names and payloads mirror Claude Code's (session_id, cwd, tool_name,
// tool_input, tool_response), so events pass straight through `bingbong emit`.
// SessionEnd requires Codex >= 0.145; unknown events in hooks.json are the
// user's Codex version's problem to ignore — drop it here if it errors.
const CODEX_EVENTS: Array<{ event: string; matcher: string }> = [
  { event: "PreToolUse",        matcher: ".*" },
  { event: "PostToolUse",       matcher: ".*" },
  { event: "SessionStart",      matcher: "" },
  { event: "SessionEnd",        matcher: "" },
  { event: "Stop",              matcher: "" },
  { event: "SubagentStart",     matcher: "" },
  { event: "SubagentStop",      matcher: "" },
  { event: "PermissionRequest", matcher: "" },
  { event: "PreCompact",        matcher: "" },
  { event: "PostCompact",       matcher: "" },
  { event: "UserPromptSubmit",  matcher: "" },
];

async function installCodex(dryRun: boolean): Promise<string> {
  const bingbongCmd = getBingbongCommand();
  const configPath = AGENTS.codex.path;

  const config = await readJsonFile(configPath, { hooks: {} });
  const cleanedHooks: Record<string, any[]> = config.hooks || {};

  // Strip old bingbong entries so reinstalls are idempotent
  stripBingbongEntries(cleanedHooks, isBingbongClaudeEntry);

  for (const { event, matcher } of CODEX_EVENTS) {
    const bingbongEntry = {
      matcher,
      hooks: [{ type: "command", command: `${bingbongCmd} emit ${event}` }],
    };

    if (!cleanedHooks[event]) {
      cleanedHooks[event] = [];
    }
    cleanedHooks[event].push(bingbongEntry);
  }

  const proposed = { ...config, hooks: cleanedHooks };

  if (dryRun) {
    const existingContent = existsSync(configPath) ? await readFile(configPath, "utf-8") : null;
    printPreview(configPath, existingContent, JSON.stringify(proposed, null, 2) + "\n");
    return configPath;
  }

  ensureDir(dirname(configPath));
  await atomicWriteJson(configPath, proposed);

  console.log(
    "\nNote: Codex requires one-time approval of new/changed hooks.\n" +
    "Run `/hooks` inside Codex to review and trust the bingbong entries."
  );

  return configPath;
}

// ---------------------------------------------------------------------------
// Uninstaller
// ---------------------------------------------------------------------------

// Returns true if anything was (or, with dryRun, would be) removed.
async function uninstallAgent(agentName: string, dryRun: boolean): Promise<boolean> {
  const path = AGENTS[agentName].path;
  if (!existsSync(path)) return false;

  if (agentName === "opencode" || agentName === "pi") {
    if (dryRun) console.log(`Would remove: ${path.replace(homedir(), "~")}`);
    else unlinkSync(path);
    return true;
  }

  const config = await readJsonFile(path, {});
  const hooks = config.hooks || {};
  if (!stripBingbongEntries(hooks, agentName === "cursor" ? isBingbongCursorEntry : isBingbongClaudeEntry)) return false;
  // settings.json holds all Claude settings; don't leave an empty hooks key behind
  if (agentName === "claude" && Object.keys(hooks).length === 0) delete config.hooks;

  if (dryRun) {
    printPreview(path, await readFile(path, "utf-8"), JSON.stringify(config, null, 2) + "\n");
  } else {
    await atomicWriteJson(path, config);
  }
  return true;
}
