/**
 * Per-user bingbong config: $XDG_CONFIG_HOME/bingbong/config.json.
 * Precedence: env (BINGBONG_*) > file > defaults. Loaded on every hook
 * `emit`, so loadConfig stays a single synchronous read.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function readFile(path: string): Record<string, unknown> {
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
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
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
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
  if (config.token) config.token = "****" + config.token.slice(-4);
  const fromEnv = KEYS.filter((k) => process.env[envName(k)]);
  console.log(JSON.stringify(config, null, 2));
  console.log(`# ${configPath()}${fromEnv.length ? ` (from env: ${fromEnv.join(", ")})` : ""}`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
