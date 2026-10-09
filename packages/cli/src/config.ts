/**
 * Per-user bingbong config: $XDG_CONFIG_HOME/bingbong/config.json.
 * Precedence: env (BINGBONG_*) > file > defaults. Loaded on every hook
 * `emit`, so loadConfig stays a single synchronous read.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

export interface BingbongConfig {
  url: string;
  token?: string;
  machine_id: string;
  payload: "metadata" | "full";
}

const KEYS = ["url", "token", "machine_id", "payload"] as const;
type Key = (typeof KEYS)[number];
const envName = (k: Key) => `BINGBONG_${k.toUpperCase()}`;

export function configPath(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "bingbong", "config.json");
}

/** A malformed config file; cli.ts prints it as a clean `Error:` line. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// A missing file is the default case. Anything unreadable or malformed throws,
// so a damaged file holding a token can't silently start the server open.
function readFile(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(`cannot read config ${path}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`invalid JSON in config ${path}: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ConfigError(`config ${path} must be a JSON object`);
  }
  const file = data as Record<string, unknown>;
  for (const k of KEYS) {
    const v = file[k];
    if (v === undefined) continue;
    if (k === "payload" ? v !== "metadata" && v !== "full" : typeof v !== "string") {
      const want = k === "payload" ? '"metadata" or "full"' : "a string";
      throw new ConfigError(`invalid "${k}" in config ${path}: expected ${want}`);
    }
  }
  return file;
}

export function loadConfig(path = configPath()): BingbongConfig {
  const file = readFile(path);
  const get = (k: Key) => {
    const v = process.env[envName(k)] || file[k];
    return typeof v === "string" && v ? v : undefined;
  };
  return {
    url: (get("url") || "http://localhost:3334").replace(/\/$/, ""),
    token: get("token"),
    machine_id: get("machine_id") || hostname(),
    payload: get("payload") === "full" ? "full" : "metadata",
  };
}

export function saveConfig(patch: Partial<BingbongConfig>, path = configPath()): BingbongConfig {
  const file = readFile(path);
  for (const k of KEYS) if (k in patch) file[k] = patch[k]; // undefined is dropped by stringify
  mkdirSync(dirname(path), { recursive: true });
  // Temp file in the same directory + rename, so a failed write can't truncate
  // the config. 0600 since it may hold a token; the rename replaces (and so
  // tightens) an existing looser file.
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return loadConfig(path);
}

/** `bingbong config [set <key> <value> | unset <key>]` */
export function configCommand(argv: string[]): void {
  const [action, key, value] = argv;
  if (action === "set" || action === "unset") {
    if (!KEYS.includes(key as Key)) fail(`unknown key "${key}" (expected ${KEYS.join(", ")})`);
    if (action === "set" && value === undefined) fail(`usage: bingbong config set ${key} <value>`);
    if (action === "set" && key === "payload" && value !== "metadata" && value !== "full") {
      fail(`payload must be "metadata" or "full"`);
    }
    saveConfig({ [key]: action === "set" ? value : undefined });
  } else if (action !== undefined) {
    fail(`unknown config action "${action}" (expected set, unset)`);
  }

  const config = loadConfig();
  // Only show a suffix when it leaves most of the token hidden.
  if (config.token) config.token = config.token.length > 8 ? "****" + config.token.slice(-4) : "****";
  const fromEnv = KEYS.filter((k) => process.env[envName(k)]);
  console.log(JSON.stringify(config, null, 2));
  console.log(`# ${configPath()}${fromEnv.length ? ` (from env: ${fromEnv.join(", ")})` : ""}`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
